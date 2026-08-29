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

// ↓ 여기부터 직접 쓴다
#include <winsock2.h>
#include <WS2tcpip.h>
#include <cstdio>

constexpr unsigned short SERVER_PORT = 9000;
constexpr int BUF_SIZE = 1024;

enum class IoType {Recv, Send};

// 주문표 주문이 들어올때 생기고 끝났을때 사라짐
// OS가 여기다 직접 씀 그래서 주문 끝날때까지 살아있어야함
struct IoContext {
    OVERLAPPED overlapped;  //반드시 첫번째 IoContext랑 주소가 같아야 ov를 되돌릴수 있음
    IoType type;            //받는주문인지 보내는주문인지 완료가 섞여 오니까 구분용
    WSABUF wsabuf;
    char buf[BUF_SIZE];
};

//손님이 들어올떄 생성 나갈때 사라짐
//소유 스레드
//  main   accept 하고 만듬 첫 주문 건 다음엔 안 건드림
//  worker 완료 받은 뒤부터 소유 ref_count 0되면 지움
struct Session {
    SOCKET sock;
    LONG ref_count; // 주문카운트 주문 걸면 +1 완료되면 -1 0되면 닫고 지움
    LONG closing;   // 손님이 있는가 나갔는가 확인 팻말, 나가면 1
                    // 1이면 새 주문을 안 검
                    // 안 막으면 계속 새로 걸려서 ref_count가 영영 0이 안됨
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

// 받는주문
static bool PostRecv(Session* s)
{
    ZeroMemory(&s->io.overlapped, sizeof(OVERLAPPED));
    s->io.type = IoType::Recv;
    s->io.wsabuf.buf = s->io.buf;
    s->io.wsabuf.len = BUF_SIZE;

    AddRef(s);   //걸기 전에 올림 걸고 나서 올리면 그 사이에 완료돼서 Release가 먼저 될수 있음

    DWORD flags = 0;
    DWORD recived = 0;
    int rc = WSARecv(s->sock, &s->io.wsabuf, 1, &recived, &flags, &s->io.overlapped, nullptr);  

    if (rc == SOCKET_ERROR) {
        // WSA_IO_PENDING은 실패가 아니라 진행중임 비동기라 이게 정상
        int err = WSAGetLastError();
        if (err != WSA_IO_PENDING) {
            printf("[Server]  %s:%d WSARecv faild: %d\n", s->ip, s->port, err);
            Release(s);   //주문이 안 걸렸으니 올린거 도로 내림
            return false;
        }
    }
    return true;

}

// 보내는주문
static bool PostSend(Session* s, int len){
    ZeroMemory(&s->io.overlapped, sizeof(OVERLAPPED));
    s->io.type = IoType::Send;
    s->io.wsabuf.buf = s->io.buf;
    s->io.wsabuf.len = len;

    AddRef(s);   //걸기 전에 올림 걸고 나서 올리면 그 사이에 완료돼서 Release가 먼저 될수 있음

    DWORD sent = 0;
    int rc = WSASend(s->sock, &s->io.wsabuf, 1, &sent, 0, &s->io.overlapped, nullptr);  

    if (rc == SOCKET_ERROR) {
        // WSA_IO_PENDING은 실패가 아니라 진행중임 비동기라 이게 정상
        int err = WSAGetLastError();
        if (err != WSA_IO_PENDING) {
            printf("[Server]  %s:%d WSASend faild: %d\n", s->ip, s->port, err);
            Release(s);   //주문이 안 걸렸으니 올린거 도로 내림
            return false;
        }
    }
    return true;    
}

// 주문확인하고 전달하고 안내하는 홀 직원
static DWORD WINAPI WorkerThread(LPVOID param){
    HANDLE iocp = (HANDLE)param;

    while (true){
        DWORD bytes= 0;
        ULONG_PTR key = 0;
        OVERLAPPED* ov = nullptr;

        //완성된거 나올때까지 여기서 멈춰있음
        BOOL ok = GetQueuedCompletionStatus(iocp, &bytes, (PULONG_PTR)&key, (LPOVERLAPPED*)&ov, INFINITE);

        //분기1 ov가 없음 = 손님 얘기가 아니라 픽업대가 닫힌거 여기만 Release 안함
        if (!ok && ov == nullptr){
            printf("[Worker] complition port closed\n");
            break;
        }

        Session* s = (Session*) key;     //누구인지
        IoContext* io = (IoContext*)ov;  //무슨 일인지

        //분기2 강제 종료 창 X로 닫음 프로세스 죽음 64 10054 같은거

        if (!ok) {
            printf("[Worker] %s:%d io faild: %lu\n", s->ip, s->port, GetLastError());
            CloseSession(s);
        }
        else if (io->type == IoType::Recv){
            //분기3 0바이트 = 손님이 정상적으로 끊음 에러 아님
            if (bytes == 0){
                printf("[Worker] %s:%d disconnected\n", s->ip, s->port);
                CloseSession(s);
            }
            //받은 게 있음 그대로 되돌려 보냄
            else {
                printf("[Worker] %s:%d recv %lu bytes: %.*s\n", s->ip, s->port, bytes, (int)bytes, io->buf);

                if (s->closing == 0){
                    PostSend(s, bytes);
                }
            }
        }
        //분기4 다 보냄 이제 다시 받을 준비
        else {
            if (s->closing ==0){
                PostRecv(s);
            }
        }
        Release(s);   //이 주문 하나 끝남 손님 한명 나간거
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

        //첫 주문 여기 지나면 s의 주인은 worker
        //실패하면 PostRecv 안의 Release가 이미 닫고 지웠음 여기서 또 하면 이중해제
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
