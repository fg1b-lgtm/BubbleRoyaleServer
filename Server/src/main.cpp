// Bubble Royale — Server
// D-11(8/27): blocking TCP 에코 서버
//
// 이 파일은 빌드 파이프라인 확인용 껍데기다. 아래 TODO는 직접 채운다.
//
// TODO 1. WSAStartup (MAKEWORD(2,2)) — 실패하면 반환값 자체가 에러 코드다
// TODO 2. listen 소켓 생성 (AF_INET / SOCK_STREAM / IPPROTO_TCP)
// TODO 3. sockaddr_in 채우기 — 포트는 htons, 주소는 INADDR_ANY
// TODO 4. bind → listen(SOMAXCONN)
// TODO 5. accept 루프
// TODO 6. recv / send 로 에코, recv 반환값 0 / SOCKET_ERROR 각각 처리
// TODO 7. closesocket → WSACleanup
//
// 상수는 매직 넘버로 두지 않는다. 포트/버퍼 크기는 여기 위쪽에 이름 붙여 선언.

#include <cstdio>

int main()
{
    std::printf("[Server] build ok - not implemented yet\n");
    return 0;
}
