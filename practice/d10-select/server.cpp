// D-10 오전 — select 기반 다중 접속 에코 서버
//
// 목적: '기다렸다가 받는다'에서 '받을 게 있는지 물어보고 받는다'로 바꾼다.
//       스레드는 여전히 하나다. 그런데 손님은 여러 명을 동시에 상대한다.
//
// 이 파일은 개념 체득용 실험이다. 오늘 오후에 IOCP 로 다시 만든다.
// select 의 한계 세 가지를 직접 확인하는 것이 목표다.
//   ① 지켜볼 수 있는 소켓 수 상한 (Windows 기본 64)
//   ② 매 바퀴 fd_set 을 처음부터 다시 채워야 함
//   ③ 누가 울렸는지 안 알려줘서 전부 훑어야 함
//
// 컴파일: practice 폴더에서  build.bat d10-select\server.cpp

// ↓ 여기부터 직접 쓴다
#include <winsock2.h>
#include <ws2tcpip.h>
#include <cstdio>

constexpr unsigned short SERVER_PORT = 9000;
constexpr int BUF_SIZE = 1024;
constexpr int MAX_CLIENTS = 64;

static bool send_all(SOCKET sock, const char* data, int len)
{
    int total_sent = 0;
    while (total_sent < len) {
        int sent = send(sock, data + total_sent, len - total_sent, 0);
        if (sent == SOCKET_ERROR) {
            return false;
        }
        total_sent += sent;
    }
    return true;
}

int main()
{
    WSADATA wsa;
    int rc = WSAStartup(MAKEWORD(2, 2), &wsa);
    if (rc != 0) {
        printf("[Server] WSAStartup failed: %d\n", rc);
        return 1;
    }

    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock == INVALID_SOCKET) {
        printf("[Server] socket failed: %d\n", WSAGetLastError());
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
        WSACleanup();
        return 1;
    }
    if (listen(listen_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("[Server] listen failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    printf("[Server] listening on port %d (select, max %d clients)\n", SERVER_PORT, MAX_CLIENTS);

    SOCKET client_socks[MAX_CLIENTS] = {};
    for (int i = 0; i < MAX_CLIENTS; ++i) {
        client_socks[i] = INVALID_SOCKET;
    }

    char buf[BUF_SIZE];

    while(true){
        fd_set read_set;
        FD_ZERO(&read_set);
        FD_SET(listen_sock, &read_set);

        for(int i=0; i<MAX_CLIENTS; ++i){
            if(client_socks[i] != INVALID_SOCKET){
                FD_SET(client_socks[i], &read_set);
            }
        }

        int ready = select(0, &read_set, nullptr, nullptr, nullptr);
        if(ready == SOCKET_ERROR){
            printf("[Server] select failed: %d\n", WSAGetLastError());
            break;
        }
        if (FD_ISSET(listen_sock, &read_set)){
            sockaddr_in client_addr = {};
            int client_addr_size = sizeof(client_addr);

            SOCKET client_sock = accept(listen_sock, (sockaddr*)&client_addr, &client_addr_size);
            if(client_sock == INVALID_SOCKET){
                printf("[Server] accept failed: %d\n", WSAGetLastError());
                break;
            }else{
                int slot = -1;
                for (int i=0; i < MAX_CLIENTS; ++i){
                    if(client_socks[i] == INVALID_SOCKET){
                        slot = i;
                        break;
                    }
                }
                if (slot < 0){
                    printf("[Server] too many clients, closing new connection\n");
                    closesocket(client_sock);
                }else{
                    client_socks[slot] = client_sock;
                    
                    char client_ip[INET_ADDRSTRLEN] = {};
                    inet_ntop(AF_INET, &client_addr.sin_addr, client_ip, sizeof(client_ip));
                    printf("[Server] client connected: %s:%d\n", client_ip, ntohs(client_addr.sin_port));
                }
            }
        }
        for (int i=0; i<MAX_CLIENTS; ++i){
            SOCKET s = client_socks[i];
            if(s == INVALID_SOCKET) continue;
            if(FD_ISSET(s, &read_set) == 0) continue;
            
            int received = recv(s, buf, BUF_SIZE, 0);

            if(received == 0){
                printf("[Server] client disconnected\n");
                closesocket(s);
                client_socks[i] = INVALID_SOCKET;
                continue;
            }

            if(received == SOCKET_ERROR){
                printf("[Server] recv failed: %d\n", WSAGetLastError());
                closesocket(s);
                client_socks[i] = INVALID_SOCKET;
                continue;
            }

            printf("[Server] recv %d bytes: %.*s\n", received, received, buf);

            if(!send_all(s, buf, received)){
                printf("[Server] send failed: %d\n", WSAGetLastError());
                closesocket(s);
                client_socks[i] = INVALID_SOCKET;
                continue;
            }
        }   
    }

    for(int i=0; i<MAX_CLIENTS; ++i){
        if(client_socks[i] != INVALID_SOCKET){
            closesocket(client_socks[i]);
        }
    }
    closesocket(listen_sock);
    WSACleanup();
    return 0;


}