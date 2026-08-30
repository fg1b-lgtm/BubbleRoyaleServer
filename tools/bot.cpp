// tools/bot.cpp — 부하 · 레이스 검증 봇 (C구역)
//
// 봇 여러 개가 동시에 접속하고, 보내고, 받고, 끊고, 다시 붙는다.
// 서버가 죽지 않고 세션이 새지 않는지를 본다.
//
// 서버 로그에서 이 둘이 같은 수여야 한다.
//   [Session] ... connected   와   [Server] ... fully closed
//
// 빌드: practice 폴더에서  build.bat ..\tools\bot.cpp
// 실행: practice\bin\bot.exe [봇수] [초]     예) bot.exe 20 10

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include "Protocol.h"

constexpr char           SERVER_IP[] = "127.0.0.1";
constexpr unsigned short SERVER_PORT = 9000;

// 여러 스레드가 같이 올린다. 그래서 Interlocked 로 센다
static LONG g_connects = 0;
static LONG g_connect_fail = 0;
static LONG g_sent = 0;
static LONG g_recv_bytes = 0;
static LONG g_errors = 0;

static volatile LONG g_stop = 0;

// 스레드마다 자기 씨앗을 들고 도는 간단한 난수.
// rand() 는 안에 상태를 하나만 두고 있어서 스레드끼리 부딪힌다
static unsigned NextRand(unsigned* seed)
{
    *seed = (*seed * 1103515245u) + 12345u;
    return (*seed >> 16) & 0x7fff;
}

static SOCKET ConnectToServer()
{
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) return INVALID_SOCKET;

    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(SERVER_PORT);
    inet_pton(AF_INET, SERVER_IP, &addr.sin_addr);

    if (connect(sock, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        closesocket(sock);
        return INVALID_SOCKET;
    }

    // 오래 안 기다린다. 브로드캐스트라 남의 것도 오므로 있는 만큼만 훑는다
    DWORD timeout = 50;
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
    return sock;
}

// 봇 하나. 붙었다 몇 번 보내고 끊기를 반복한다
static DWORD WINAPI BotThread(LPVOID param)
{
    int id = (int)(INT_PTR)param;
    unsigned seed = (unsigned)(id * 2654435761u);

    char pkt[MAX_PACKET_SIZE];
    char buf[MAX_PACKET_SIZE * 4];

    while (g_stop == 0) {
        SOCKET sock = ConnectToServer();
        if (sock == INVALID_SOCKET) {
            InterlockedIncrement(&g_connect_fail);
            Sleep(20);
            continue;
        }
        InterlockedIncrement(&g_connects);

        int rounds = 1 + (NextRand(&seed) % 5);
        for (int r = 0; r < rounds && g_stop == 0; ++r) {
            char body[32];
            int body_len = sprintf_s(body, "bot%d-%d", id, r);

            PacketHeader* h = (PacketHeader*)pkt;
            h->size = (uint16_t)(HEADER_SIZE + body_len);
            h->id   = PKT_ECHO;
            memcpy(pkt + HEADER_SIZE, body, body_len);

            if (send(sock, pkt, h->size, 0) == SOCKET_ERROR) {
                InterlockedIncrement(&g_errors);
                break;
            }
            InterlockedIncrement(&g_sent);

            // 온 만큼만 훑고 버린다. 내용 검사는 probe 가 한다
            int n = recv(sock, buf, sizeof(buf), 0);
            if (n > 0) {
                InterlockedExchangeAdd(&g_recv_bytes, n);
            }

            Sleep(NextRand(&seed) % 30);
        }

        // 절반은 정상 종료, 절반은 그냥 닫아서 강제 종료처럼 만든다
        if ((NextRand(&seed) & 1) == 0) {
            shutdown(sock, SD_SEND);
        }
        closesocket(sock);

        Sleep(NextRand(&seed) % 50);
    }
    return 0;
}

int main(int argc, char** argv)
{
    int bots    = (argc > 1) ? atoi(argv[1]) : 20;
    int seconds = (argc > 2) ? atoi(argv[2]) : 10;

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 1;

    printf("봇 %d개로 %d초 동안 두들긴다\n", bots, seconds);

    HANDLE* threads = new HANDLE[bots];
    for (int i = 0; i < bots; ++i) {
        threads[i] = CreateThread(nullptr, 0, BotThread, (LPVOID)(INT_PTR)i, 0, nullptr);
    }

    Sleep(seconds * 1000);
    InterlockedExchange(&g_stop, 1);

    for (int i = 0; i < bots; ++i) {
        WaitForSingleObject(threads[i], 3000);
        CloseHandle(threads[i]);
    }
    delete[] threads;

    printf("\n===== 결과 =====\n");
    printf("접속 성공   : %ld\n", g_connects);
    printf("접속 실패   : %ld\n", g_connect_fail);
    printf("보낸 패킷   : %ld\n", g_sent);
    printf("받은 바이트 : %ld\n", g_recv_bytes);
    printf("에러        : %ld\n", g_errors);
    printf("\n서버 로그의 connected 수와 fully closed 수가 같아야 한다.\n");

    WSACleanup();
    return 0;
}
