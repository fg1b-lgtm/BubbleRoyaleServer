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

    // 이 세션이 앉은 자리 번호. 아직 안 앉았으면 -1.
    //
    // 소유 스레드 : tick (Enter 에서 넣고 Leave 에서 지운다)
    //
    // 왜 세션이 자리 번호를 아나.
    //   AOI 는 "이 세션이 어느 구역을 보고 있나" 를 알아야 보낼지 말지 정한다.
    //   players[] 에서 세션을 찾아 거꾸로 훑을 수도 있지만, 그러면 **세션 목록이 아니라
    //   게임판에서 세션 포인터를 꺼내게 된다.** 그 포인터는 자물쇠가 안 지켜준다.
    //   목록에서 꺼내고 자리 번호는 세션에 물어보는 쪽이 안전하다
    int        slot;
};

// 어느 자리에서 참조를 들고 놓는지 센다. 진단용.
//   0 목록/main  1 주문 꽂이  2 받기  3 보내기  4 AOI 송신
inline LONG g_ref_up[8]   = {};
inline LONG g_ref_down[8] = {};

// 붙잡는다. 주문을 걸기 전이나 목록에서 꺼내 쓰기 전에 부른다
inline void AddRefAt(Session* s, int site)
{
    InterlockedIncrement(&g_ref_up[site]);
    InterlockedIncrement(&s->ref_count);
}
inline void AddRef(Session* s) { AddRefAt(s, 0); }

// 놓는다. 마지막 하나가 놓으면 그때 소켓 닫고 지운다
// 지금 살아 있는 세션 수. 접속 수와 정리 수가 어긋날 때 이 숫자만 보면 된다.
//
// 로그 두 줄을 세어서 비교하는 건 사람이 하는 일이고, 이건 서버가 늘 알고 있어야 한다
inline volatile LONG g_live_sessions = 0;

inline void ReleaseAt(Session* s, int site)
{
    InterlockedIncrement(&g_ref_down[site]);

    if (InterlockedDecrement(&s->ref_count) == 0) {
        InterlockedDecrement(&g_live_sessions);
        printf("[Session] %s:%d fully closed\n", s->ip, s->port);
        closesocket(s->sock);
        delete s;
    }
}

inline void Release(Session* s) { ReleaseAt(s, 0); }

