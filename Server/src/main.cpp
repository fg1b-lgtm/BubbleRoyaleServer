// Bubble Royale — Server
// D-11(8/27): blocking TCP 에코 서버
//
// 손님(클라이언트)이 보낸 바이트를 그대로 되돌려준다.
// 손님이 끊으면 다음 손님을 기다린다.
//
// blocking 소켓이므로 accept / recv 는 일이 생길 때까지 이 스레드를 멈춰 세운다.
// 그래서 이 서버는 '동시에 한 명'만 상대할 수 있다.
// 이 한계를 없애는 것이 D-10(8/28)의 IOCP다.
//
// 종료: Ctrl+C

#include <winsock2.h>
#include <ws2tcpip.h>
#include <cstdio>

// 매직 넘버 금지 — 포트와 버퍼 크기는 이름을 붙여 한곳에 모은다.
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
    // WSAStartup 만은 반환값 자체가 에러 코드다. 여기서 WSAGetLastError 를 쓰면 안 된다
    // (아직 Winsock 이 초기화되지 않아 에러 번호가 채워지지 않는다).
    int rc = WSAStartup(MAKEWORD(2, 2), &wsa);
    if (rc != 0) {
        printf("[Server] WSAStartup failed: %d\n", rc);
        return 1;
    }

    // 대표번호 전화기. 새 손님을 받기만 하고, 대화(recv/send)에는 절대 쓰지 않는다.
    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_sock == INVALID_SOCKET) {
        // SOCKET 은 부호 없는 정수라 `< 0` 으로는 실패를 잡을 수 없다.
        // 반드시 INVALID_SOCKET 과 비교한다.
        printf("[Server] socket failed: %d\n", WSAGetLastError());
        WSACleanup();
        return 1;
    }

    // 서버 자신의 주소. 손님 주소와 섞이지 않도록 변수를 따로 둔다.
    sockaddr_in server_addr = {};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(SERVER_PORT);          // 포트는 네트워크 바이트 순서로
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);    // 이 PC 의 모든 랜카드에서 받는다

    if (bind(listen_sock, (sockaddr*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        // 10048(WSAEADDRINUSE) = 그 포트를 이미 누가 쓰고 있다.
        printf("[Server] bind failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    // SOMAXCONN = 대기 줄의 길이를 OS 가 알아서 정하게 한다.
    if (listen(listen_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("[Server] listen failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }
    printf("[Server] listening on port %d\n", SERVER_PORT);

    // 받은 바이트를 담는 상자. 서버는 이것 하나면 된다.
    // 클라이언트와 달리 '보낼 것'을 따로 만들지 않는다 — 받은 걸 그대로 돌려주니까.
    char buf[BUF_SIZE];

    // 바깥 반복문 — 손님을 한 명씩 받는다.
    while (true) {
        // 접속해온 손님의 주소가 여기에 채워진다. server_addr 과 별개의 변수여야 한다.
        sockaddr_in client_addr = {};

        // in/out 인자: 넣을 때는 '이 상자가 몇 바이트냐',
        // 나올 때는 '실제로 몇 바이트 채웠냐'로 덮어써진다.
        // 그래서 accept 를 부르기 직전마다 다시 채운다. 루프 밖에 두면 안 된다.
        int client_addr_len = sizeof(client_addr);

        // 전화가 올 때까지 여기서 멈춰 선다.
        // 성공하면 '이 손님 전용 전화기'를 새로 만들어 돌려준다.
        SOCKET client_sock = accept(listen_sock, (sockaddr*)&client_addr, &client_addr_len);
        if (client_sock == INVALID_SOCKET) {
            printf("[Server] accept failed: %d\n", WSAGetLastError());
            break;
        }

        // 손님 주소를 사람이 읽는 문자열로 바꿔 찍는다.
        // client_addr 을 따로 둔 덕분에 이게 가능하다.
        char client_ip[INET_ADDRSTRLEN] = {};
        inet_ntop(AF_INET, &client_addr.sin_addr, client_ip, sizeof(client_ip));
        printf("[Server] client connected: %s:%d\n", client_ip, ntohs(client_addr.sin_port));

        // 안쪽 반복문 — 이 손님과의 대화. 끊을 때까지 계속 듣고 되돌려준다.
        while (true) {
            // ① 손님이 말할 때까지 여기서 멈춰 선다.
            //    received 가 '몇 바이트 받았는지'를 알려준다. 아래에서는 이 숫자만 쓴다.
            int received = recv(client_sock, buf, BUF_SIZE, 0);

            // ② 0 = 손님이 정상적으로 끊었다. 에러가 아니다.
            if (received == 0) {
                printf("[Server] client disconnected\n");
                break;
            }

            // ③ SOCKET_ERROR = 진짜 사고. 원인 번호를 반드시 남긴다.
            if (received == SOCKET_ERROR) {
                printf("[Server] recv failed: %d\n", WSAGetLastError());
                break;
            }

            // ④ buf 에는 문자열 끝 표시('\0')가 없다. 그래서 %s 가 아니라 %.*s 로
            //    '딱 received 글자만 출력하라'고 길이를 함께 넘긴다.
            printf("[Server] recv %d bytes: %.*s\n", received, received, buf);

            // ⑤ 받은 상자를, 받은 길이만큼 그대로 돌려준다. 이것이 '에코'다.
            //    길이가 BUF_SIZE(1024)가 아니라 received 인 것이 핵심이다.
            //    상자는 1024칸이지만 실제 내용은 received 칸뿐이기 때문이다.
            if (!send_all(client_sock, buf, received)) {
                printf("[Server] send failed: %d\n", WSAGetLastError());
                break;
            }
        }

        // 손님 전용 전화기만 반납한다. 대표번호 전화기는 계속 살려둔다.
        closesocket(client_sock);
        printf("[Server] waiting for next client\n");
    }

    // 정리는 성공 경로에서도 똑같이 한다.
    // 순서: 전화기를 먼저 반납하고 → 마지막에 Winsock 을 내린다.
    closesocket(listen_sock);
    WSACleanup();
    return 0;
}
