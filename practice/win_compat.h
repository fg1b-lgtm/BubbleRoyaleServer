// practice/win_compat.h — 연습 파일을 맥에서도 컴파일하려고 두는 얇은 껍데기
//
// 왜 있나
//   연습은 화·수·금 저녁에 학교에서 맥북으로 한다.
//   그런데 SRWLOCK, InterlockedIncrement, CreateThread 는 전부 Windows 것이다.
//   맥에서 컴파일이 안 되면 연습 자체가 안 된다.
//
//   그렇다고 연습용 코드를 std::mutex 로 바꿔 쓰면 안 된다.
//   면접에서 묻는 건 Windows 이름이고, 손이 기억해야 하는 것도 그 이름이다.
//   그래서 코드는 그대로 두고, 맥에서만 같은 이름의 껍데기를 씌운다.
//
// 쓰는 법
//   연습 파일 맨 위에서 <winsock2.h> 대신 이걸 넣는다.
//     #include "win_compat.h"
//   Windows 면 진짜 헤더를 부르고, 맥이면 아래 껍데기가 쓰인다.
//
// 여기 있는 것은 연습에 필요한 만큼만이다. 진짜 구현이 아니다.
// 서버 본체(Server/src/)는 이 파일을 쓰지 않는다. 거긴 Windows 전용이다.
#pragma once

#ifdef _WIN32

#include <winsock2.h>

#else   // ── 맥 / 리눅스 ────────────────────────────────────────

#include <pthread.h>
#include <unistd.h>
#include <sched.h>
#include <time.h>
#include <cstdio>
#include <cstddef>

// ── 자료형 이름 맞추기 ───────────────────────────────────────
typedef long           LONG;
typedef unsigned long  DWORD;
typedef unsigned long long ULONGLONG;
typedef void*          LPVOID;
typedef long           INT_PTR;
typedef int            BOOL;

#define WINAPI
#ifndef TRUE
#define TRUE  1
#define FALSE 0
#endif
#define INFINITE 0xFFFFFFFF

// ── 쪼갤 수 없는 한 덩어리로 만드는 것들 ─────────────────────
// Windows 의 Interlocked 계열이 하는 일과 같다.
// 가져오기 / 고치기 / 도로 넣기 사이에 아무도 못 끼어든다.
inline LONG InterlockedIncrement(LONG* p)
{
    return __atomic_add_fetch(p, 1, __ATOMIC_SEQ_CST);
}

inline LONG InterlockedDecrement(LONG* p)
{
    return __atomic_sub_fetch(p, 1, __ATOMIC_SEQ_CST);
}

inline LONG InterlockedExchange(LONG* p, LONG v)
{
    return __atomic_exchange_n(p, v, __ATOMIC_SEQ_CST);
}

// ── 읽기 여럿 / 쓰기 하나 자물쇠 ─────────────────────────────
// SRWLOCK 과 같은 역할이다. pthread 쪽 이름이 rwlock 이다.
typedef pthread_rwlock_t SRWLOCK;

inline void InitializeSRWLock(SRWLOCK* l)        { pthread_rwlock_init(l, nullptr); }
inline void AcquireSRWLockExclusive(SRWLOCK* l)  { pthread_rwlock_wrlock(l); }
inline void ReleaseSRWLockExclusive(SRWLOCK* l)  { pthread_rwlock_unlock(l); }
inline void AcquireSRWLockShared(SRWLOCK* l)     { pthread_rwlock_rdlock(l); }
inline void ReleaseSRWLockShared(SRWLOCK* l)     { pthread_rwlock_unlock(l); }

// ── 스레드 ───────────────────────────────────────────────────
typedef pthread_t* HANDLE;
typedef DWORD (*ThreadFn)(LPVOID);

struct ThreadStart { ThreadFn fn; LPVOID arg; };

inline void* ThreadTrampoline(void* p)
{
    ThreadStart* ts = (ThreadStart*)p;
    ts->fn(ts->arg);
    delete ts;
    return nullptr;
}

inline HANDLE CreateThread(void*, size_t, ThreadFn fn, LPVOID arg, DWORD, void*)
{
    pthread_t*   t  = new pthread_t;
    ThreadStart* ts = new ThreadStart{ fn, arg };

    if (pthread_create(t, nullptr, ThreadTrampoline, ts) != 0) {
        delete t;
        delete ts;
        return nullptr;
    }
    return t;
}

inline DWORD WaitForSingleObject(HANDLE h, DWORD)
{
    pthread_join(*h, nullptr);
    return 0;
}

inline DWORD WaitForMultipleObjects(DWORD n, HANDLE* h, BOOL, DWORD)
{
    for (DWORD i = 0; i < n; ++i) {
        pthread_join(*h[i], nullptr);
    }
    return 0;
}

inline void CloseHandle(HANDLE h) { delete h; }

inline void Sleep(DWORD ms)
{
    if (ms == 0) { sched_yield(); }
    else         { usleep(ms * 1000); }
}

inline ULONGLONG GetTickCount64()
{
    timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (ULONGLONG)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

// ── MSVC 전용 안전 버전 함수들 ───────────────────────────────
// 이름만 맞춰준다. 하는 일은 같다.
template <size_t N, typename... A>
inline int sprintf_s(char (&buf)[N], const char* fmt, A... a)
{
    return snprintf(buf, N, fmt, a...);
}

template <typename... A>
inline int sscanf_s(const char* s, const char* fmt, A... a)
{
    return sscanf(s, fmt, a...);
}

#endif  // _WIN32
