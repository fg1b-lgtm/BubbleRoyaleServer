// tools/probe.cpp — 패킷 경계 · 브로드캐스트 검증 도구 (C구역)
//
//   시험 1 (분할) : 패킷 하나를 1바이트씩 쪼개 보낸다
//   시험 2 (연접) : 패킷 셋을 한 번에 몰아 보낸다
//   시험 3 (섞임) : 패킷 둘 + 셋째의 앞 3바이트만 보내고, 잠시 뒤 나머지를 보낸다
//   시험 4 (전파) : 셋이 붙은 상태에서 하나가 보내면 셋 다 받는가
//
// 빌드: practice 폴더에서  build.bat ..\tools\probe.cpp
// 실행: practice\bin\probe.exe   (서버를 먼저 켤 것)

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <cstdio>
#include <cstring>
#include "Protocol.h"

constexpr char           SERVER_IP[] = "127.0.0.1";
constexpr unsigned short SERVER_PORT = 9000;

static int g_pass = 0;
static int g_fail = 0;

static SOCKET ConnectToServer()
{
    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) return INVALID_SOCKET;

    sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(SERVER_PORT);
    if (inet_pton(AF_INET, SERVER_IP, &addr.sin_addr) != 1) {
        closesocket(sock);
        return INVALID_SOCKET;
    }
    if (connect(sock, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        printf("  connect failed: %d (서버를 먼저 켜라)\n", WSAGetLastError());
        closesocket(sock);
        return INVALID_SOCKET;
    }
    return sock;
}

// 패킷 하나를 dst 에 만든다. 반환은 전체 길이.
static int MakePacket(char* dst, const char* body, int body_len)
{
    PacketHeader* h = (PacketHeader*)dst;
    h->size = (uint16_t)(HEADER_SIZE + body_len);
    h->id   = PKT_ECHO;
    memcpy(dst + HEADER_SIZE, body, body_len);
    return h->size;
}

static bool RecvExact(SOCKET sock, char* dst, int len)
{
    int total = 0;
    while (total < len) {
        int n = recv(sock, dst + total, len - total, 0);
        if (n <= 0) return false;
        total += n;
    }
    return true;
}

// 답을 패킷 하나만큼 읽어서, 기대한 몸통과 같은지 확인한다.
static void ExpectReply(SOCKET sock, const char* expect)
{
    PacketHeader h = {};
    if (!RecvExact(sock, (char*)&h, HEADER_SIZE)) {
        printf("[FAIL] 헤더를 못 받았다\n");
        ++g_fail;
        return;
    }
    int body = h.size - HEADER_SIZE;
    char buf[MAX_PACKET_SIZE] = {};
    if (body > 0 && !RecvExact(sock, buf, body)) {
        printf("[FAIL] 몸통을 못 받았다\n");
        ++g_fail;
        return;
    }

    int want = (int)strlen(expect);
    if (body == want && memcmp(buf, expect, want) == 0) {
        printf("[PASS] size=%u id=%u body=\"%.*s\"\n", h.size, h.id, body, buf);
        ++g_pass;
    }
    else {
        printf("[FAIL] 기대 \"%s\" (%d) / 실제 \"%.*s\" (%d)\n", expect, want, body, buf, body);
        ++g_fail;
    }
}

int main()
{
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 1;

    char pkt[MAX_PACKET_SIZE];
    char stream[MAX_PACKET_SIZE * 4];

    // ── 시험 1 : 분할 ───────────────────────────────────────
    printf("\n=== 시험 1: 패킷 하나를 1바이트씩 쪼개 보낸다 ===\n");
    {
        SOCKET sock = ConnectToServer();
        if (sock == INVALID_SOCKET) { WSACleanup(); return 1; }

        int total = MakePacket(pkt, "SPLIT", 5);
        printf("  %d바이트를 1바이트씩 %d번 보낸다\n", total, total);
        for (int i = 0; i < total; ++i) {
            send(sock, pkt + i, 1, 0);
            Sleep(80);
        }
        printf("  ");
        ExpectReply(sock, "SPLIT");
        closesocket(sock);
    }

    // ── 시험 2 : 연접 ───────────────────────────────────────
    printf("\n=== 시험 2: 패킷 셋을 한 번에 몰아 보낸다 ===\n");
    {
        SOCKET sock = ConnectToServer();
        if (sock == INVALID_SOCKET) { WSACleanup(); return 1; }

        int n = 0;
        n += MakePacket(stream + n, "AAA", 3);
        n += MakePacket(stream + n, "BBBB", 4);
        n += MakePacket(stream + n, "CCCCC", 5);
        printf("  패킷 3개(%d바이트)를 send 한 번으로 보낸다\n", n);
        send(sock, stream, n, 0);

        printf("  ");  ExpectReply(sock, "AAA");
        printf("  ");  ExpectReply(sock, "BBBB");
        printf("  ");  ExpectReply(sock, "CCCCC");
        closesocket(sock);
    }

    // ── 시험 3 : 섞임 ───────────────────────────────────────
    printf("\n=== 시험 3: 둘 + 셋째의 앞 3바이트만, 잠시 뒤 나머지 ===\n");
    {
        SOCKET sock = ConnectToServer();
        if (sock == INVALID_SOCKET) { WSACleanup(); return 1; }

        int n = 0;
        n += MakePacket(stream + n, "ONE", 3);
        n += MakePacket(stream + n, "TWO", 3);
        int third_at = n;
        n += MakePacket(stream + n, "THREE", 5);

        int first_chunk = third_at + 3;   // 셋째 패킷의 앞 3바이트까지만
        printf("  먼저 %d바이트 (패킷 2개 + 셋째 조각)\n", first_chunk);
        send(sock, stream, first_chunk, 0);

        printf("  ");  ExpectReply(sock, "ONE");
        printf("  ");  ExpectReply(sock, "TWO");

        Sleep(400);
        printf("  나머지 %d바이트\n", n - first_chunk);
        send(sock, stream + first_chunk, n - first_chunk, 0);

        printf("  ");  ExpectReply(sock, "THREE");
        closesocket(sock);
    }

    // ── 시험 4 : 브로드캐스트 ───────────────────────────────
    printf("\n=== 시험 4: 셋이 붙은 상태에서 하나가 보내면 셋 다 받나 ===\n");
    {
        SOCKET s[3];
        bool ok = true;
        for (int i = 0; i < 3; ++i) {
            s[i] = ConnectToServer();
            if (s[i] == INVALID_SOCKET) { ok = false; break; }
        }

        if (ok) {
            Sleep(300);   // 셋 다 목록에 들어갈 시간을 준다

            int n = MakePacket(pkt, "BCAST", 5);
            printf("  0번만 보낸다 (%d바이트)\n", n);
            send(s[0], pkt, n, 0);

            for (int i = 0; i < 3; ++i) {
                printf("  %d번: ", i);
                ExpectReply(s[i], "BCAST");
            }
            for (int i = 0; i < 3; ++i) {
                closesocket(s[i]);
            }
        }
    }

    printf("\n===== 결과: %d PASS / %d FAIL =====\n", g_pass, g_fail);
    WSACleanup();
    return g_fail == 0 ? 0 : 1;
}
