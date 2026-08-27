// Bubble Royale — Client (D-11 에코 테스트용 콘솔 클라이언트)
//
// 키보드로 친 한 줄을 서버에 보내고, 서버가 돌려준 것을 화면에 찍는다.
// 오늘의 완료 조건: 여기서 친 문자열이 그대로 되돌아온다.
//
// blocking 소켓이므로 connect / send / recv 는 일이 끝날 때까지 이 스레드를 멈춰 세운다.
//
// 종료: Ctrl+Z 후 Enter (입력 끝) 또는 Ctrl+C

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

        if (!send_all(sock, input, len)) {
            printf("[Client] send failed: %d\n", WSAGetLastError());
            break;
        }

        // 서버가 답할 때까지 여기서 멈춰 선다. 받은 바이트 수가 반환된다.
        int received = recv(sock, buf, BUF_SIZE, 0);

        // 0 = 서버가 정상적으로 끊었다. 에러가 아니다.
        if (received == 0) {
            printf("[Client] server closed the connection\n");
            break;
        }
        if (received == SOCKET_ERROR) {
            printf("[Client] recv failed: %d\n", WSAGetLastError());
            break;
        }

        // buf 에는 문자열 끝 표시가 없다. 그래서 %s 가 아니라 %.*s 로 길이를 함께 넘긴다.
        printf("[Client] echo (%d bytes): %.*s\n", received, received, buf);

        // 보낸 것과 받은 것이 같은지 직접 확인한다. 이것이 오늘의 완료 조건이다.
        // memcmp: 두 상자를 앞에서부터 len 바이트만큼 비교해 같으면 0 을 반환한다.
        if (received == len && memcmp(input, buf, len) == 0) {
            printf("[Client] OK - matches what I sent\n");
        }
        else {
            printf("[Client] MISMATCH - sent %d bytes, got %d bytes\n", len, received);
        }
    }

    // 정리 순서: 소켓을 먼저 반납하고 → 마지막에 Winsock 을 내린다.
    closesocket(sock);
    WSACleanup();
    return 0;
}
