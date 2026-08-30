// Server/src/SessionManager.h — 접속 중인 세션 목록
//
// 이 서버에서 여러 스레드가 같이 만지는 유일한 공유물이다.
//   넣기 — main   (accept 직후)
//   빼기 — worker (CloseSession)
//   읽기 — worker (브로드캐스트)
//
// 소유자가 없으므로 자물쇠가 필요하다.
// 읽기(순회)가 압도적으로 많고 쓰기(넣기/빼기)는 드물어서 SRWLOCK 을 쓴다.
// 읽기 자물쇠는 여럿이 동시에 가질 수 있고, 쓰기 자물쇠는 혼자만 가진다.
#pragma once

#include "ServerConfig.h"
#include "Session.h"

inline Session* g_sessions[MAX_SESSION] = {};   // nullptr = 빈 자리
inline SRWLOCK  g_session_lock;

// main 맨 처음에 한 번 부른다
inline void InitSessionManager()
{
    InitializeSRWLock(&g_session_lock);
}

// 목록에 넣는다. 자리가 없으면 false
inline bool AddSession(Session* s)
{
    AcquireSRWLockExclusive(&g_session_lock);

    bool ok = false;
    for (int i = 0; i < MAX_SESSION; ++i) {
        if (g_sessions[i] == nullptr) {
            g_sessions[i] = s;
            ok = true;
            break;
        }
    }

    ReleaseSRWLockExclusive(&g_session_lock);
    return ok;
}

// 목록에서 뺀다. 여기서 빠져야 아무도 못 꺼내고 지울 수 있게 된다
inline void RemoveSession(Session* s)
{
    AcquireSRWLockExclusive(&g_session_lock);

    for (int i = 0; i < MAX_SESSION; ++i) {
        if (g_sessions[i] == s) {
            g_sessions[i] = nullptr;
            break;
        }
    }

    ReleaseSRWLockExclusive(&g_session_lock);
}

// 영업 종료 팻말을 건다. 문을 잠그지는 않는다.
// 걸린 주문이 아직 있을 수 있어서, 지우는 건 ref_count 가 0 이 될 때 Release 가 한다.
//
// InterlockedExchange 로 읽기와 쓰기를 한 덩어리로 묶는다.
// 워커가 여럿이라 그냥 읽고 쓰면 둘 다 '내가 처음' 이라 판단해서
// 목록에서 두 번 빼고 참조를 두 번 놓게 된다.
inline void CloseSession(Session* s)
{
    if (InterlockedExchange(&s->closing, 1) == 1) {
        return;   // 이미 누가 걸었다
    }

    printf("[Session] %s:%d closing\n", s->ip, s->port);

    RemoveSession(s);              // 목록에서 뺀다
    shutdown(s->sock, SD_BOTH);    // 걸린 주문들이 실패로라도 완료되게 깨운다
    Release(s);                    // 목록이 들고 있던 참조를 놓는다
}
