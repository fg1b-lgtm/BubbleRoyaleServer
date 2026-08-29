// Bubble Royale — Client (D-11 에코 테스트용 콘솔 클라이언트)
//
// 키보드로 친 한 줄을 서버에 보내고, 서버가 돌려준 것을 화면에 찍는다.
// 오늘의 완료 조건: 여기서 친 문자열이 그대로 되돌아온다.
//
// blocking 소켓이므로 connect / send / recv 는 일이 끝날 때까지 이 스레드를 멈춰 세운다.
//
// 종료: Ctrl+Z 후 Enter (입력 끝) 또는 Ctrl+C

#include "Protocol.h"
#include <winsock2.h>
#include <ws2tcpip.h>
#include <cstdio>
#include <cstring>

// 매직 넘버 금지 — 주소/포트/버퍼 크기는 이름을 붙여 한곳에 모은다.
constexpr char SERVER_IP[] = "127.0.0.1";   // 내 PC 자신을 가리키는 주소(루프백)
constexpr unsigned short SERVER_PORT = 9000;
constexpr int BUF_SIZE = 1024;

// send 는 요청한 길이를 한 번에 다 못 보낼 수 있다.
// (커널의 송신 버퍼가 이미 차 있으면 들어간 만큼만 반환한다)
// 그래서 '보낸 만큼 빼면서 전부 나갈 때까지' 반복해야 한다.
//
//   data + total_sent : 아직 안 보낸 부분의 시작 위치
//   len  - total_sent : 아직 안 보낸 길이
//
// 반환: 전부 보냈으면 true, 실패하면 false (원인은 부른 쪽에서 WSAGetLastError 로 확인)
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

// 정확히 len 바이트를 받을 때까지 반복한다.
// recv 한 번에 다 안 올 수 있기 때문이다. 서버 쪽 분할 처리와 같은 문제다.
// 반환: 다 받았으면 true, 상대가 끊었거나 오류면 false
static bool recv_exact(SOCKET sock, char* dst, int len)
{
    int total = 0;
    while (total < len) {
        int n = recv(sock, dst + total, len - total, 0);
        if (n == 0) {
            printf("[Client] server closed the connection\n");
            return false;
        }
        if (n == SOCKET_ERROR) {
            printf("[Client] recv failed: %d\n", WSAGetLastError());
            return false;
        }
        total += n;
    }
    return true;
}


int main()
{
    WSADATA wsa;
    // WSAStartup 만은 반환값 자체가 에러 코드다. 여기서 WSAGetLastError 를 쓰면 안 된다.
    int rc = WSAStartup(MAKEWORD(2, 2), &wsa);
    if (rc != 0) {
        printf("[Client] WSAStartup failed: %d\n", rc);
        return 1;
    }

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        // SOCKET 은 부호 없는 정수라 `< 0` 으로는 실패를 잡을 수 없다.
        printf("[Client] socket failed: %d\n", WSAGetLastError());
        WSACleanup();
        return 1;
    }

    // 걸어야 할 서버의 주소. 클라이언트는 bind / listen 이 필요 없다 —
    // 상대 번호를 이미 알고 있으니 그냥 걸면 된다.
    sockaddr_in server_addr = {};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);

    // inet_pton 은 성공/실패를 '반환값'으로 알려준다. 결과 주소는 sin_addr 에 담긴다.
    //   1 = 성공, 0 = 주소 문자열이 잘못됨, -1 = 시스템 오류
    // 0 일 때는 시스템 오류가 아니므로 WSAGetLastError 에 아무것도 안 채워진다.
    // 그래서 여기서는 반환값 자체를 찍는다.
    int pton = inet_pton(AF_INET, SERVER_IP, &server_addr.sin_addr);
    if (pton != 1) {
        printf("[Client] inet_pton failed: ret=%d\n", pton);
        closesocket(sock);
        WSACleanup();
        return 1;
    }

    if (connect(sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        // 10061(WSAECONNREFUSED) = 그 주소:포트에서 아무도 안 듣고 있다. 서버를 먼저 켜라.
        printf("[Client] connect failed: %d\n", WSAGetLastError());
        closesocket(sock);
        WSACleanup();
        return 1;
    }
    printf("[Client] connected to %s:%d\n", SERVER_IP, SERVER_PORT);

    // 상자를 둘로 나눈 이유: '보낸 것'과 '받은 것'을 나란히 놓고 비교해야
    // 에코가 실제로 되었는지 눈으로 확인할 수 있다.
    // 하나로 쓰면 recv 가 보낸 내용을 덮어써서 비교할 대상이 사라진다.
    char input[BUF_SIZE];   // 키보드에서 읽은 것 (보낼 것)
    char buf[BUF_SIZE];     // 서버가 돌려준 것 (받은 것)

    while (true) {
        printf("> ");

        // 키보드에서 한 줄 읽는다. BUF_SIZE 를 넘겨 상자 밖으로 넘치는 것을 막는다.
        // 실패(Ctrl+Z 로 입력 끝) 하면 루프를 빠져나간다.
        if (!fgets(input, BUF_SIZE, stdin)) {
            break;
        }

        // fgets 는 네가 누른 Enter('\n')까지 같이 가져온다. 그대로 보내면
        // 서버가 되돌려준 것에도 줄바꿈이 섞이므로 떼어낸다.
        int len = (int)strlen(input);
        if (len > 0 && input[len - 1] == '\n') {
            input[len - 1] = '\0';   // 그 자리에 문자열 끝 표시를 넣어 잘라낸다
            len--;                   // 길이도 함께 줄인다
        }

        // 빈 줄을 0바이트 보내면 서버는 받은 게 없어 답할 것도 없다.
        // 그러면 여기 recv 에서 영원히 기다리게 되므로(교착) 아예 건너뛴다.
        if (len == 0) {
            continue;
        }

        // 헤더와 몸통을 한 상자에 담아서 한 번에 보낸다.
        // 나눠 보내면 중간에 다른 게 끼어들 수 있고, 상대가 조각을 오래 기다린다.
        char packet[MAX_PACKET_SIZE];

        // 상자 앞 4바이트를 헤더로 본다. 서버가 ReadPtr() 을 헤더로 본 것과 같은 방식이다.
        PacketHeader* h = (PacketHeader*)packet;
        h->size = (uint16_t)(HEADER_SIZE + len);   // 헤더 포함 전체
        h->id   = PKT_ECHO;

        memcpy(packet + HEADER_SIZE, input, len);  // 헤더 뒤에 몸통을 붙인다

        if (!send_all(sock, packet, h->size)) {
            printf("[Client] send failed: %d\n", WSAGetLastError());
            break;
        }
        

        // 1. 헤더 4바이트를 정확히 받는다
        PacketHeader reply = {};
        if (!recv_exact(sock, (char*)&reply, HEADER_SIZE)) {
            break;
        }

        // 2. 크기가 말이 되는지 확인한다. 서버가 하는 검사와 같다
        if (reply.size < HEADER_SIZE || reply.size > MAX_PACKET_SIZE) {
            printf("[Client] bad packet size %u\n", reply.size);
            break;
        }

        // 3. 몸통을 정확히 받는다
        int body = reply.size - HEADER_SIZE;
        if (body > 0 && !recv_exact(sock, buf, body)) {
            break;
        }

        printf("[Client] echo (id=%u, %d bytes): %.*s\n", reply.id, body, body, buf);

        // 보낸 것과 받은 것이 같은지 확인한다
        if (body == len && memcmp(input, buf, len) == 0) {
            printf("[Client] OK - matches what I sent\n");
        }
        else {
            printf("[Client] MISMATCH - sent %d bytes, got %d bytes\n", len, body);
        }

    }

    // 정리 순서: 소켓을 먼저 반납하고 → 마지막에 Winsock 을 내린다.
    closesocket(sock);
    WSACleanup();
    return 0;
}
