// D-10 오후 — IOCP 에코 서버
//
// select : "읽을 게 있니?" 물어보고, 있으면 내가 읽는다
// IOCP   : "읽어서 여기 담아둬" 미리 시켜놓고, 다 되면 알려준다
//
// 오늘 완료 조건
//   ① IOCP 로 에코가 동작한다
//   ② OVERLAPPED 가 왜 필요한지 코드 없이 말로 설명할 수 있다  ← 이게 진짜다
//
// 오늘 범위: 완료 포트 하나, 워커 스레드 하나, WSARecv 한 바퀴.
//   accept 와 send 는 아직 blocking 그대로 쓴다.
//   WSASend 로 바꾸면 Recv 완료와 Send 완료를 구분해야 하는데, 그게 8/29 주제다.
//
// 컴파일: practice 폴더에서  build.bat d10-iocp\server.cpp

// ↓ 여기부터 직접 쓴다
#include <winsock2.h>
#include <ws2tcpip.h>
#include <mswsock.h>
#include <cstdio>

constexpr unsigned short SERVER_PORT = 9000;
constexpr int BUF_SIZE = 1024;

struct ClientContext {
    OVERLAPPED overlapped;
    SOCKET sock;
    WSABUF wsabuf;
    char buf[BUF_SIZE];
};

static bool PostRecv(ClientContext* ctx){
    ZeroMemory(&ctx->overlapped, sizeof(OVERLAPPED));

    ctx->wsabuf.buf = ctx->buf;
    ctx->wsabuf.len = BUF_SIZE;

    DWORD flags = 0;
    DWORD received = 0;

    int rc = WSARecv(ctx->sock, &ctx->wsabuf, 1, &received, &flags, &ctx->overlapped, nullptr);
    if (rc == SOCKET_ERROR) {
        int err = WSAGetLastError();
        if (err != WSA_IO_PENDING) {
            printf("[Server] WSARecv failed: %d\n", err);
            return false;
        }
    }
    return true;


}

static DWORD WINAPI WorkerThread(LPVOID param) {
    HANDLE iocp = (HANDLE)param;

    while (true) {
        DWORD       bytes = 0;
        ULONG_PTR   key = 0;
        OVERLAPPED* overlapped = nullptr;

        BOOL ok = GetQueuedCompletionStatus(iocp, &bytes, &key, &overlapped, INFINITE);
        if (!ok && overlapped == nullptr) {
            printf("[Worker] completion port closed\n");
            break;
        }

        ClientContext* ctx = (ClientContext*)key;

        if (!ok || bytes == 0) {
            printf("[Worker] client disconnected\n");
            closesocket(ctx->sock);
            delete ctx;
            continue;
        }
        printf("[Worker] recv %d bytes: %.*s\n", bytes, (int)bytes, ctx->buf);

        int total_sent = 0;
        bool send_failed = false;
        while (total_sent < (int)bytes) {
            int sent = send(ctx->sock, ctx->buf + total_sent, bytes - total_sent, 0);
            if (sent == SOCKET_ERROR) {
                printf("[Worker] send failed: %d\n", WSAGetLastError());
                send_failed = true;
                break;
            }
            total_sent += sent;
        }
        if (send_failed) {
            closesocket(ctx->sock);
            delete ctx;
            continue;
        }

        if (!PostRecv(ctx)) {
            closesocket(ctx->sock);
            delete ctx;
            continue;
        }
    }
    return 0;

}


int main() {
    WSAData wsa;
    int rc = WSAStartup(MAKEWORD(2, 2), &wsa);
    if (rc != 0) {
        printf("[Server] WSAStartup failed: %d\n", rc);
        return 1;
    }

    HANDLE iocp = CreateIoCompletionPort(INVALID_HANDLE_VALUE, nullptr, 0, 0);
    if (iocp == nullptr) {
        printf("[Server] CreateIoCompletionPort failed: %d\n", GetLastError());
        WSACleanup();
        return 1;
    }

    HANDLE worker_thread = CreateThread(nullptr, 0, WorkerThread, iocp, 0, nullptr);
    if (worker_thread == nullptr) {
        printf("[Server] CreateThread failed: %d\n", GetLastError());
        CloseHandle(iocp);
        WSACleanup();
        return 1;
    }

    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock == INVALID_SOCKET) {
        printf("[Server] socket failed: %d\n", WSAGetLastError());
        CloseHandle(worker_thread);
        CloseHandle(iocp);
        WSACleanup();
        return 1;
    }

    sockaddr_in server_addr = {};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);

    if (bind(listen_sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        printf("[Server] bind failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        CloseHandle(worker_thread);
        CloseHandle(iocp);
        WSACleanup();
        return 1;
    }

    if (listen(listen_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("[Server] listen failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        CloseHandle(worker_thread);
        CloseHandle(iocp);
        WSACleanup();
        return 1;
    }

    printf("[Server] listening on port %d\n", SERVER_PORT);
    
    while (true) {
        sockaddr_in client_addr = {};
        int client_addr_len = sizeof(client_addr);
        SOCKET client_sock = accept(listen_sock, (sockaddr*)&client_addr, &client_addr_len);
        if (client_sock == INVALID_SOCKET) {
            printf("[Server] accept failed: %d\n", WSAGetLastError());
            break;
        }

        ClientContext* ctx = new ClientContext();
        ctx->sock = client_sock;

        if (CreateIoCompletionPort((HANDLE)client_sock, iocp, (ULONG_PTR)ctx, 0) == nullptr) {
            printf("[Server] CreateIoCompletionPort for client failed: %d\n", GetLastError());
            closesocket(client_sock);
            delete ctx;
            continue;
        }
        char client_ip[INET_ADDRSTRLEN] = {};
        inet_ntop(AF_INET, &client_addr.sin_addr, client_ip, sizeof(client_ip));
        printf("[Server] client connected: %s:%d\n", client_ip, ntohs(client_addr.sin_port));


        if (!PostRecv(ctx)) {
            closesocket(client_sock);
            delete ctx;
        }

    }

    closesocket(listen_sock);
    CloseHandle(iocp);
    WaitForSingleObject(worker_thread, 1000);
    WSACleanup();
    CloseHandle(worker_thread);
    return 0;


}

