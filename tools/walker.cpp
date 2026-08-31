// tools/walker.cpp — 서버에 붙어서 방향키를 눌러주는 도구
//
// 웹 클라이언트는 9/2 에 붙인다. 그때까지 이동을 눈으로 볼 방법이 필요하다.
// 이 도구는 PKT_MOVE 만 보낸다. 화면은 서버 로그다.
//
// 컴파일: practice 폴더에서  build.bat ..\tools\walker.cpp
// 실행  : practice\bin\walker.exe [사람수]
#include <winsock2.h>
#include <ws2tcpip.h>
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include "Protocol.h"
#include "GameConstants.h"

// 오른쪽 -> 아래 -> 왼쪽 -> 위 를 돌아가며 누른다.
// 벽에 부딪히면 그 축만 서므로 방 안을 돌아다니게 된다
static const int DIR_X[4] = {  1,  0, -1,  0 };
static const int DIR_Y[4] = {  0,  1,  0, -1 };

static bool SendAll(SOCKET s, const char* p, int len)
{
    int sent = 0;
    while (sent < len) {
        int n = send(s, p + sent, len - sent, 0);
        if (n <= 0) {
            return false;
        }
        sent += n;
    }
    return true;
}

static bool SendMove(SOCKET s, int dx, int dy)
{
    char buf[MOVE_PACKET_SIZE];

    PacketHeader h;
    h.size = (uint16_t)MOVE_PACKET_SIZE;
    h.id   = PKT_MOVE;
    memcpy(buf, &h, HEADER_SIZE);

    MoveBody b;
    b.dx = (int8_t)dx;
    b.dy = (int8_t)dy;
    memcpy(buf + HEADER_SIZE, &b, sizeof(b));

    return SendAll(s, buf, MOVE_PACKET_SIZE);
}

static DWORD WINAPI Walk(LPVOID param)
{
    int id = (int)(INT_PTR)param;

    SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == INVALID_SOCKET) {
        printf("[walker %d] socket failed: %d\n", id, WSAGetLastError());
        return 1;
    }

    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port   = htons(SERVER_PORT);
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);

    if (connect(s, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        printf("[walker %d] connect failed: %d\n", id, WSAGetLastError());
        closesocket(s);
        return 1;
    }

    printf("[walker %d] connected\n", id);

    // 방향마다 2초씩. 사람마다 다른 방향에서 시작한다
    for (int step = 0; step < 4; ++step) {
        int d = (id + step) % 4;

        if (!SendMove(s, DIR_X[d], DIR_Y[d])) {
            break;
        }
        printf("[walker %d] dir (%d,%d)\n", id, DIR_X[d], DIR_Y[d]);
        Sleep(2000);
    }

    SendMove(s, 0, 0);   // 손을 뗀다
    Sleep(500);

    closesocket(s);
    printf("[walker %d] done\n", id);
    return 0;
}

int main(int argc, char** argv)
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    int count = (argc > 1) ? atoi(argv[1]) : 1;
    if (count < 1)           count = 1;
    if (count > PLAYER_MAX)  count = PLAYER_MAX;

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        printf("WSAStartup failed\n");
        return 1;
    }

    printf("걷는 사람 %d 명. 서버 로그를 봐라.\n\n", count);

    HANDLE th[PLAYER_MAX];
    for (int i = 0; i < count; ++i) {
        th[i] = CreateThread(nullptr, 0, Walk, (LPVOID)(INT_PTR)i, 0, nullptr);
    }

    WaitForMultipleObjects(count, th, TRUE, 30000);
    for (int i = 0; i < count; ++i) {
        CloseHandle(th[i]);
    }

    WSACleanup();
    return 0;
}
