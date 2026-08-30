// Server/src/Network.h — 주문을 걸고 뿌리는 곳
//
// 여기 있는 함수는 전부 "운영체제에 일을 걸어두고 바로 돌아온다".
// 결과는 완료 포트로 오고, WorkerThread 가 집는다.
#pragma once

#include "SessionManager.h"

// "데이터 오면 이 바구니 빈 자리에 담아둬" 주문
inline bool PostRecv(Session* s)
{
    s->recv_buf.Clean();   // 쓸 자리부터 확보한다

    ZeroMemory(&s->recv_io.overlapped, sizeof(OVERLAPPED));
    s->recv_io.type = IoType::Recv;
    s->recv_io.wsabuf.buf = s->recv_buf.WritePtr();       // 바구니 빈 자리를 가리킨다
    s->recv_io.wsabuf.len = s->recv_buf.WritableSize();   // 담을 수 있는 만큼

    AddRef(s);   // 걸기 전에 올린다. 걸고 나서 올리면 그 사이에 완료돼서 Release 가 먼저 될 수 있다

    DWORD flags = 0;
    DWORD received = 0;
    int rc = WSARecv(s->sock, &s->recv_io.wsabuf, 1, &received, &flags, &s->recv_io.overlapped, nullptr);

    if (rc == SOCKET_ERROR) {
        int err = WSAGetLastError();
        // WSA_IO_PENDING 은 실패가 아니라 진행 중이다. 비동기라 이게 정상이다
        if (err != WSA_IO_PENDING) {
            printf("[Session] %s:%d WSARecv failed: %d\n", s->ip, s->port, err);
            Release(s);   // 주문이 안 걸렸으니 올린 것을 도로 내린다
            return false;
        }
    }
    return true;
}

// 송신 큐 맨 앞의 연속 구간 하나를 실제로 건다.
// sending 이 1 인 상태에서만 불린다. 그래서 같은 세션에 두 개가 동시에 걸릴 일이 없다.
//
// 링에서 바로 보낸다. 복사하지 않는다.
// 보내는 중인 구간은 완료될 때까지 OnSent 를 안 부르므로 size 에 그대로 남아 있고,
// Push 가 Free() 를 볼 때 그 자리를 쓰지 않는다.
inline void StartSend(Session* s)
{
    AcquireSRWLockExclusive(&s->send_lock);
    char* ptr = s->send_buf.PeekPtr();
    int   len = s->send_buf.PeekSize();
    ReleaseSRWLockExclusive(&s->send_lock);

    ZeroMemory(&s->send_io.overlapped, sizeof(OVERLAPPED));
    s->send_io.type = IoType::Send;
    s->send_io.wsabuf.buf = ptr;
    s->send_io.wsabuf.len = len;

    AddRef(s);

    DWORD sent = 0;
    int rc = WSASend(s->sock, &s->send_io.wsabuf, 1, &sent, 0, &s->send_io.overlapped, nullptr);

    if (rc == SOCKET_ERROR) {
        int err = WSAGetLastError();
        if (err != WSA_IO_PENDING) {
            printf("[Session] %s:%d WSASend failed: %d\n", s->ip, s->port, err);
            // 순서가 중요하다. Release 가 먼저면 그 안에서 delete 될 수 있고,
            // 그다음 CloseSession 이 없어진 메모리를 만진다.
            // 놓는 것은 항상 맨 마지막이다.
            CloseSession(s);
            Release(s);
        }
    }
}

// 보낼 것을 큐에 쌓는다. 아무도 안 보내는 중이면 내가 시작한다.
// send_buf 와 sending 을 같은 자물쇠로 묶어서 본다.
// 따로 보면 "보낼 게 있나" 와 "보내는 중인가" 사이에 상태가 바뀔 수 있다.
inline void SendPacket(Session* s, const char* data, int len)
{
    if (s->closing == 1) {
        return;
    }

    bool need_start = false;

    AcquireSRWLockExclusive(&s->send_lock);
    bool pushed = s->send_buf.Push(data, len);
    if (pushed && s->sending == 0) {
        s->sending = 1;      // 내가 시작한다고 표시. 자물쇠 안이라 겹치지 않는다
        need_start = true;
    }
    ReleaseSRWLockExclusive(&s->send_lock);

    if (!pushed) {
        // 상대가 안 받아가서 쌓이기만 한 것. 더 봐줄 수 없다
        printf("[Session] %s:%d send buffer full\n", s->ip, s->port);
        CloseSession(s);
        return;
    }

    if (need_start) {
        StartSend(s);
    }
}

// 접속 중인 모두에게 뿌린다. except 는 제외 (nullptr 이면 전원)
//
// 자물쇠를 잡은 채로 보내면 안 된다. 다 보낼 때까지 아무도 접속하거나 나가지 못한다.
// 그래서 자물쇠 안에서는 AddRef 로 붙잡아 목록만 복사하고, 실제 전송은 밖에서 한다.
// 붙잡는 것은 반드시 자물쇠 안에서 해야 한다. 풀고 나서 붙잡으면 이미 늦다.
inline void Broadcast(const char* data, int len, Session* except)
{
    Session* targets[MAX_SESSION];
    int count = 0;

    AcquireSRWLockShared(&g_session_lock);   // 읽기 자물쇠. 여럿이 동시에 들어와도 된다
    for (int i = 0; i < MAX_SESSION; ++i) {
        Session* t = g_sessions[i];
        if (t == nullptr) continue;
        if (t == except) continue;
        if (t->closing == 1) continue;

        AddRef(t);
        targets[count++] = t;
    }
    ReleaseSRWLockShared(&g_session_lock);

    for (int i = 0; i < count; ++i) {
        SendPacket(targets[i], data, len);
        Release(targets[i]);
    }
}
