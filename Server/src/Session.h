// Server/src/Session.h — 손님 하나 = 세션 하나
//
// 손님이 붙으면 생기고, 걸린 주문이 전부 끝나면 사라진다.
//
// 소유 스레드
//   main   accept 하고 만든다. 첫 주문을 건 다음엔 안 건드린다
//   worker 완료를 받은 뒤부터 소유한다. ref_count 가 0 이 되면 지운다
//
// 자물쇠는 send_buf 쪽에만 있다.
// 받기 주문은 세션당 하나뿐이라 recv_buf 를 만지는 워커도 한 명뿐이지만,
// 보내기는 브로드캐스트 때문에 여러 워커가 같이 쌓는다.
#pragma once

#include <winsock2.h>
#include <ws2tcpip.h>
#include <cstdio>
#include "RecvBuffer.h"
#include "SendBuffer.h"

// 주문 종류. 완료가 픽업대에 섞여 올라오니까 이걸로 구분한다
enum class IoType { Recv, Send };

// 주문표. 주문이 들어올 때 쓰이고 끝나면 다음 주문이 덮어쓴다.
// OS 가 여기다 직접 쓰므로 주문이 끝날 때까지 살아 있어야 한다.
// 그래서 Session 안에 두고, Session 은 ref_count 가 0 이 될 때까지 안 지운다.
struct IoContext
{
    OVERLAPPED overlapped;   // 반드시 첫 멤버. IoContext 와 주소가 같아야 ov 를 되돌릴 수 있다
    IoType     type;         // 받는 주문인지 보내는 주문인지
    WSABUF     wsabuf;       // 어디에 몇 바이트인지를 담아 WSARecv/WSASend 에 넘긴다
};

struct Session
{
    SOCKET sock;

    LONG ref_count;  // 붙잡은 수. 주문 걸면 +1, 완료되면 -1, 0 이 되면 닫고 지운다
                     // 목록에 들어 있는 동안에도 1 을 든다
    LONG closing;    // 영업 종료 팻말. 1 이면 새 주문을 안 건다
                     // 안 막으면 계속 새로 걸려서 ref_count 가 영영 0 이 안 된다

    char           ip[INET_ADDRSTRLEN];
    unsigned short port;

    IoContext  recv_io;    // 받기 주문표
    RecvBuffer recv_buf;   // 받은 바이트를 쌓아둔다. 워커 한 명만 만진다

    IoContext  send_io;    // 보내기 주문표
    SendBuffer send_buf;   // 보낼 것을 쌓아둔다. 여러 워커가 같이 만진다
    SRWLOCK    send_lock;  // send_buf 와 sending 을 같이 지킨다
    LONG       sending;    // 1 이면 보내기 주문이 하나 떠 있는 중
};

// 붙잡는다. 주문을 걸기 전이나 목록에서 꺼내 쓰기 전에 부른다
inline void AddRef(Session* s)
{
    InterlockedIncrement(&s->ref_count);
}

// 놓는다. 마지막 하나가 놓으면 그때 소켓 닫고 지운다
inline void Release(Session* s)
{
    if (InterlockedDecrement(&s->ref_count) == 0) {
        printf("[Session] %s:%d fully closed\n", s->ip, s->port);
        closesocket(s->sock);
        delete s;
    }
}
