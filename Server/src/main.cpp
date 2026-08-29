// Bubble Royale — Server
//
// IOCP + 세션 생명주기. 완료 포트 하나, 워커 스레드 하나.
//
// 이 파일은 본진이다. 규칙 하나만 지킨다.
//   본진에는 내가 안 보고 쓸 수 있는 코드만 들어간다.
//
// 원본(보지 말 것): practice/d9-session/server.cpp
// 이전 버전(8/27 blocking 에코)은 커밋 befb680 에 있다.
//
// ─────────────────────────────────────────────────────────────
// A. 먼저 주석만 쓴다. 코드는 한 줄도 쓰지 않는다.
//    원본을 봐도 되지만 베끼지 말고 내 문장으로 압축한다. 25줄 안쪽.
// B. 원본 탭을 닫고 자동완성을 끈 다음, 그 주석만 보고 코드를 채운다.
//
// 주석에 반드시 들어가야 하는 것
//   - 구조체 두 개가 왜 있고 각각 언제까지 사는가 (수명)
//   - 누가 만들고 누가 지우는가 (소유 스레드)
//   - main 이 하는 일 / worker 가 하는 일
//   - worker 의 분기 네 갈래
//   - 참조 카운트를 언제 올리고 언제 내리고 언제 지우는가
//   - 실패했을 때 무엇을 되돌리는가
//
// 안 적어도 되는 것
//   - 함수 인자 순서, 상수 철자, 헤더 파일 이름
//
// 시도 기록:
//   1차 (  월  일) — 막힌 곳:
//   2차 (  월  일) — 막힌 곳:
// ─────────────────────────────────────────────────────────────

// ↓ 여기부터 직접 쓴다
#include <winsock2.h>
#include <WS2tcpip.h>
#include <cstdio>

constexpr unsigned short SERVER_PORT = 9000;
constexpr int BUF_SIZE = 1024;

enum class IoType {Recv, Send};

struct IoContext {
    OVERLAPPED overlapped;
    IoType type;
    WSABUF wsabuf;
    char buf[BUF_SIZE];
};

struct Session {
    SOCKET sock;
    LONG ref_count;
    LONG closing;
    char ip[INET_ADDRSTRLEN];
    unsigned short port;
    IoContext io;
};

static void AddRef(Session* s){
    InterlockedIncrement(&s -> ref_count);
}

static void Release(Session* s){
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

static bool PostSend(Session* s, int len){
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

static DWORD WINAPI WorkerThread(LPVOID param){
    HANDLE iocp = (HANDLE)param;

    while (true){
        DWORD bytes= 0;
        ULONG_PTR key = 0;
        OVERLAPPED* ov = nullptr;

        BOOL ok = GetQueuedCompletionStatus(iocp, &bytes, (PULONG_PTR)&key, (LPOVERLAPPED*)&ov, INFINITE);
        if (!ok && ov == nullptr){
            printf("[Worker] complition port closed\n");
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
    if(rc != 0){
        printf("[Server] WSAStartup faild: %d\n", rc);
        return 1;

    }
    HANDLE iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0,0);
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
