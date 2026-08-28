// D-9 — 세션 생명주기
//
// 오늘 IOCP 서버의 구멍 세 개를 메운다.
//   ① worker 가 blocking send 에서 멈춘다        -> WSASend 로 바꾼다
//   ② 바꾸면 Recv 완료와 Send 완료가 섞인다      -> OVERLAPPED 확장 구조체
//   ③ 끊겼을 때 언제 지워야 안전한지 모른다      -> 참조 카운트
//
// 완료 조건: 클라이언트 10개를 붙였다 랜덤하게 끊어도 서버가 죽지 않는다
//
// 컴파일: practice 폴더에서  build.bat d9-session\server.cpp

// ↓ 여기부터 직접 쓴다
# include <winsock2.h>
# include <ws2tcpip.h>
# include <cstdio>

constexpr unsigned short SERVER_PORT = 9000;
constexpr int BUF_SIZE = 1024;

enum class IoType { Recv, Send };

struct IoContext {
    OVERLAPPED  overlapped;
    IoType      type;
    WSABUF      wsabuf;
    char        buf[BUF_SIZE];
};

struct Session {
    SOCKET sock;
    LONG ref_count;
    LONG closing;
    char ip[INET_ADDRSTRLEN];
    unsigned short port;
    IoContext io;
};

static void AddRef(Session* s)
{
    InterlockedIncrement(&s->ref_count);
}

static void Release(Session* s)
{
    if (InterlockedDecrement(&s->ref_count) == 0) {
        printf("[Server]  %s:%d fully closed\n", s->ip, s->port);
        closesocket(s->sock);
        delete s;
    }
}

static void CloseSession(Session* s)
{
    if (s->closing==1){
        return;
    }
    s->closing = 1;
    printf("[Server]  %s:%d closing\n", s->ip, s->port);
    shutdown(s->sock, SD_BOTH);
}

static bool PostRecv(Session* s)
{
    ZeroMemory(&s->io.overlapped, sizeof(OVERLAPPED));
    s->io.type = IoType::Recv;
    s->io.wsabuf.buf = s->io.buf;
    s->io.wsabuf.len = BUF_SIZE;

    AddRef(s);

    DWORD flags = 0;
    DWORD recived = 0;
    int rc = WSARecv(s->sock, &s->io.wsabuf, 1, &recived, &flags, &s->io.overlapped, nullptr);  

    if (rc == SOCKET_ERROR) {
        int err = WSAGetLastError();
        if (err != WSA_IO_PENDING) {
            printf("[Server]  %s:%d WSARecv faild: %d\n", s->ip, s->port, err);
            Release(s);
            return false;
        }
    }
    return true;

}

static bool PostSend(Session* s, int len)
{
    ZeroMemory(&s->io.overlapped, sizeof(OVERLAPPED));
    s->io.type = IoType::Send;
    s->io.wsabuf.buf = s->io.buf;
    s->io.wsabuf.len = len;

    AddRef(s);

    DWORD sent = 0;
    int rc = WSASend(s->sock, &s->io.wsabuf, 1, &sent, 0, &s->io.overlapped, nullptr);

    if (rc == SOCKET_ERROR) {
        int err = WSAGetLastError();
        if (err != WSA_IO_PENDING) {
            printf("[Server]  %s:%d WSASend faild: %d\n", s->ip, s->port, err);
            Release(s);
            return false;
        }
    }
    return true;
}

static DWORD WINAPI WorkerThread(LPVOID param)
{
    HANDLE iocp = (HANDLE)param;

    while (true) {
        DWORD bytes = 0;
        ULONG_PTR key = 0;
        OVERLAPPED* ov = nullptr;

        BOOL ok = GetQueuedCompletionStatus(iocp, &bytes, (PULONG_PTR)&key, (LPOVERLAPPED*)&ov , INFINITE);
        if (!ok && ov == nullptr){
            printf("[Worker] compltion port closed\n");
            break;
        }

        Session* s = (Session*) key;
        IoContext* io = (IoContext*)ov;
        
        if (!ok) {
            printf("[Worker] %s:%d io faild: %lu\n", s->ip, s->port, GetLastError());
            CloseSession(s);
        }
        else if (io->type == IoType::Recv){
            if (bytes == 0){
                printf("[Worker] %s:%d disconnected\n", s->ip, s->port);
                CloseSession(s);
            }
            else {
                printf("[Worker] %s:%d recv %lu bytes: %.*s\n", s->ip, s->port, bytes, (int)bytes, io->buf);

                if (s->closing == 0){
                    PostSend(s, bytes);
                }
            }
        }
        else {
            if (s->closing ==0){
                PostRecv(s);
            }
        }
        Release(s);
    }
    return 0;
}

int main(){
    WSADATA wsa;
    int rc = WSAStartup(MAKEWORD(2,2), &wsa);
    if (rc != 0){
        printf("[Server] WSAStartup faild: %d\n", rc);
        return 1;
    }

    HANDLE iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 0);
    if (iocp == nullptr){
        printf("[Server] CreateIoCompletionPort faild: %lu\n", GetLastError());
        WSACleanup();
        return 1;
    }

    HANDLE worker = CreateThread(nullptr, 0, WorkerThread, iocp, 0, nullptr);
    if (worker == nullptr){
        printf("[Server] CreateThread faild: %lu\n", GetLastError());
        CloseHandle(iocp);
        WSACleanup();
        return 1;
    }


    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock == INVALID_SOCKET) {
        printf("[Server] socket faild: %d\n", WSAGetLastError());
        CloseHandle(worker);
        CloseHandle(iocp);
        WSACleanup();
        return 1;
    }

    sockaddr_in server_addr = {};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);

    if (bind(listen_sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        printf("[Server] bind faild: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    if (listen(listen_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("[Server] listen faild: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }
    printf("[Server] listening on port %d (IOCP + session)\n", SERVER_PORT);

    while (true) {
        sockaddr_in client_addr = {};
        int client_addr_len = sizeof(client_addr);

        SOCKET client_sock = accept(listen_sock, (sockaddr*)&client_addr, &client_addr_len);
        if (client_sock == INVALID_SOCKET) {
            printf("[Server] accept faild: %d\n", WSAGetLastError());
            break;
        }

        Session* s = new Session();
        s->sock = client_sock;
        s->ref_count = 0;
        s->closing = 0;
        inet_ntop(AF_INET, &client_addr.sin_addr, s->ip, sizeof(s->ip));
        s->port = ntohs(client_addr.sin_port);

        if (CreateIoCompletionPort((HANDLE)client_sock, iocp, (ULONG_PTR)s, 0) == nullptr) {
            printf("[Server] associate faild: %lu\n", GetLastError());
            closesocket(client_sock);
            delete s;
            continue;
        }

        printf("[Session] %s:%d connected\n", s->ip, s->port);

        if (!PostRecv(s)) {
            printf("[Server] first PostRecv faild\n");
        }
    }

    closesocket(listen_sock);
    CloseHandle(iocp);
    WaitForSingleObject(worker, 1000);
    CloseHandle(worker);
    WSACleanup();
    return 0;
}