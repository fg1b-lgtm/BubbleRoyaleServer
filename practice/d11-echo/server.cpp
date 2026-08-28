// 연습 — blocking TCP 에코 서버 (원본: Server/src/main.cpp)
//
// 여기는 3단계 "지우고 다시 쓰기" 자리다.
//
// 1. 원본에 달아둔 '내 말로 된 한글 주석'만 여기 옮겨 적는다. 코드는 옮기지 않는다.
// 2. 그 주석만 보고 처음부터 직접 친다. 원본은 열지 않는다.
// 3. build.bat d11-echo\server.cpp 로 컴파일한다.
// 4. 에러가 난 줄만 원본을 본다. 전체를 다시 보지 않는다.
//
// 기억나야 하는 것 — 호출 순서, 각 단계가 존재하는 이유, 실패 처리 패턴,
//                    recv 반환값이 세 갈래인 것, 어느 소켓으로 대화하는지
// 몰라도 되는 것 — 상수 이름 철자, 인자 순서, 헤더 파일 이름
//                  (IntelliSense 와 문서가 해준다. 면접관도 이건 안 묻는다)
//
// 시도 기록:
//   1차 (  8월  27일) — 막힌 곳: 에러 이유를 전부 안적었다 ex) 10048, 10061, WSAGetLastError()
//      매직넘버 상수 대소문자 형식을 통일하지 않았다
//      socket의 3번째 인자에 INADDR_ANY을 넣었다. 0을 넣어야 한다
//      server_addr을 초기화하지 않았다
//      accept실패 시 바깥 while문을 break해야 하는데 continue했다(못나감)
//   2차 (  8월  28일) — 막힌 곳:

// ↓ 여기부터 직접 쓴다
// 포트번호, 버퍼 크기 등 매직넘버 모으기 constexpr -> send 덜 나가는 문제 해결 -> WSADATA 설정
// -> socket 생성 -> bind -> listen -> accept -> recv/send 반복 -> 종료
// send는 요청한 길이를 한번에 다 못보내니 보낸만큼 빼면서 전부 나갈때까지 반복 흐 체크
// 대표번호 소켓은 accept만 하고, 실제 대화는 accept로 나온 소켓으로 한다
// 소켓은 부호없는 정수라 반드시 INVALID_SOCKET과 비교해야 한다
// 서버 자신의 주소를 채우고 그 주소를 bind한다
// 서버에서는 받은 바이트를 담는 상자 하나면 된다(받은걸 그대로 돌려주니까). 그리고 바깥 반복문을 만든다.
// 접속해온 손님의 주소가 채워질 구조체를 만든다. server_addr 과 별개의 변수여야 한다.
// in/out 인자: 넣을 때는 '이 상자가 몇 바이트냐', 나올 때는 '실제로 몇 바이트 채웠냐'로 덮어써진다.
// accept가 오면 손님 전용 소켓을 새로 만들어 돌려준다
// 사람이 읽는 문자열로 바꿔찍는다(client_addr을 따로 두어서 가능하다)
// 안쪽 반복문을 만들고 recv로 받은 바이트 수를 반환받는다 0이면 정상적으로 끊은것이고, SOCKET_ERROR이면 에러다. 나머지는 받은 바이트 수다
// buf 끝에는 문자열 끝 표시가 없다. 그래서 %s 가 아니라 %.*s 로 길이를 함께 넘긴다.
// 받을 상자를 받은 길이만큼 돌려준다. 단 길이는 상자내용인 BUF_SIZE(1024)가 아니라 실제 내용인 received이다
// 소켓은 반납해야한다는것을 잊지말자 closesocket (손님소켓은 바깥반복문 안, 서버는 바깥반복문 밖)
// WSACleanup()

#include <winsock2.h>
#include <ws2tcpip.h>
#include <cstdio>

constexpr unsigned short PORT = 9000;
constexpr int BUF_SIZE = 1024;

int send_all(SOCKET sock, const char* buf, int len) {
    int total_sent = 0;
    while (total_sent < len) {
        int sent = send(sock, buf + total_sent, len - total_sent, 0);
        if (sent == SOCKET_ERROR) {
            return SOCKET_ERROR;
        }
        total_sent += sent;
    }
    return total_sent;

}

int main() {
    WSADATA wsaData;
    int rc = WSAStartup(MAKEWORD(2, 2), &wsaData);
    if (rc != 0) {
        printf("WSAStartup failed: %d\n", rc);
        return 1;
    }


    SOCKET listen_sock = socket(AF_INET, SOCK_STREAM, 0);
    if (listen_sock == INVALID_SOCKET) {
        printf("socket failed: %d\n", WSAGetLastError());
        WSACleanup();
        return 1;
    }

    SOCKADDR_IN server_addr = {};
    server_addr.sin_family = AF_INET;
    server_addr.sin_port = htons(PORT);
    server_addr.sin_addr.s_addr = htonl(INADDR_ANY);


    if (bind(listen_sock, (SOCKADDR*)&server_addr, sizeof(server_addr)) == SOCKET_ERROR) {
        printf("bind failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    if (listen(listen_sock, SOMAXCONN) == SOCKET_ERROR) {
        printf("listen failed: %d\n", WSAGetLastError());
        closesocket(listen_sock);
        WSACleanup();
        return 1;
    }

    char buf[BUF_SIZE];

    while (true) {
        SOCKADDR_IN client_addr = {};
        int client_addr_size = sizeof(client_addr);
        SOCKET client_sock = accept(listen_sock, (SOCKADDR*)&client_addr, &client_addr_size);
        if (client_sock == INVALID_SOCKET) {
            printf("accept failed: %d\n", WSAGetLastError());
            break;
        }

        char client_ip[INET_ADDRSTRLEN];
        inet_ntop(AF_INET, &client_addr.sin_addr, client_ip, sizeof(client_ip));
        printf("Client connected: %s:%d\n", client_ip, ntohs(client_addr.sin_port));

        while (true) {
            int received = recv(client_sock, buf, BUF_SIZE, 0);
            if (received == 0) {
                printf("Client disconnected: %s:%d\n", client_ip, ntohs(client_addr.sin_port));
                break;
            } else if (received == SOCKET_ERROR) {
                printf("recv failed: %d\n", WSAGetLastError());
                break;
            }

            printf("Received %d bytes from %s:%d: %.*s\n", received, client_ip, ntohs(client_addr.sin_port), received, buf);

            int sent = send_all(client_sock, buf, received);
            if (sent == SOCKET_ERROR) {
                printf("send failed: %d\n", WSAGetLastError());
                break;
            }
        }

        closesocket(client_sock);
    }
    closesocket(listen_sock);
    WSACleanup();
    return 0;


}