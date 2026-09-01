// Server/src/JobQueue.h — 워커가 꽂고 틱 스레드가 가져가는 주문 꽂이
//
// 왜 있나
//   게임판을 여러 스레드가 만지면 자물쇠가 끝없이 늘어난다.
//   그래서 게임 처리는 틱 스레드 한 명에게 몰아준다.
//   워커는 "받았다" 까지만 하고 여기 꽂아두고 바로 다음 손님에게 간다.
//
// 소유 스레드
//   g_job_buf / g_job_count / g_write   여럿이 만진다. g_job_lock 이 지킨다
//   가져간 뒤의 통                       틱 스레드 혼자 본다. 자물쇠 없이 읽는다
//
// ── 9/1: 통을 둘로 나눴다 ───────────────────────────────────
//
// 주문에는 **버려도 되는 것과 못 버리는 것**이 있다.
//
//   패킷    버려도 된다. MOVE 를 하나 놓치면 한 틱 더 같은 방향으로 갈 뿐이다
//   입·퇴장 못 버린다. 퇴장을 놓치면 나간 사람이 판에 유령으로 남는다.
//           그 자리는 영영 안 비고, 세션 참조도 안 내려가서 메모리도 안 돌아온다
//
// 전에는 한 통에 같이 담았다. 통이 차면 둘 다 똑같이 버려졌다.
// AOI 를 붙여 서버가 빨라지자 부하 시험에서 접속 757 / 정리 536 이 나왔다.
// 221 개가 유령으로 남은 것이다. 통이 찬 게 원인이 아니라,
// **차면 안 되는 것까지 같이 버린 게** 원인이다.
//
// 그래서 통을 나눈다. 생명주기 통은 작아도 된다. 한 틱에 백 명이 들락날락하지는 않는다.
// 틱 스레드는 생명주기부터 처리한다. 입장이 그 사람 패킷보다 먼저여야 하기 때문이다.
// 퇴장이 남은 패킷보다 먼저 처리되는 건 괜찮다. 자리가 이미 비어서 그 패킷은 그냥 무시된다
#pragma once

#include<cstring>
#include "ServerConfig.h"
#include "Session.h"

// 주문 종류
enum class JobType { Enter, Packet, Leave };

struct Job
{
    JobType type;
    Session* s; //누구 주문인가
    int len;    // data에 든 바이트 수
    char data[MAX_PACKET_SIZE]; // 패킥 통째로 복사
};

// 입·퇴장 주문. 몸통이 없어서 작다
struct LifeJob
{
    JobType  type;
    Session* s;
};

// 통 두 개를 번갈아 쓴다. 패킷용과 생명주기용을 따로 둔다
inline Job      g_job_buf[2][MAX_JOB];
inline int      g_job_count[2];
inline LifeJob  g_life_buf[2][MAX_LIFE];
inline int      g_life_count[2];
inline int      g_write;    // 지금 워커가 꽂는 통 번호
inline SRWLOCK  g_job_lock;

// 못 버린 주문 수. 0 이 아니면 그건 사고다
inline long long g_job_dropped  = 0;
inline long long g_life_dropped = 0;

// main 맨 처음에 한 번 부른다.
inline void InitJobQueue(){
    InitializeSRWLock(&g_job_lock);
    g_job_count[0] = 0;
    g_job_count[1] = 0;
    g_life_count[0] = 0;
    g_life_count[1] = 0;
    g_write = 0;
}

// 워커가 부른다. 꽂히면 true
inline bool PushJob(JobType type, Session* s, const char* data, int len){
    AcquireSRWLockExclusive(&g_job_lock);

    // 입·퇴장은 다른 통에. 이쪽은 버리면 안 된다
    if (type != JobType::Packet) {
        int m = g_life_count[g_write];
        if (m >= MAX_LIFE) {
            ++g_life_dropped;
            ReleaseSRWLockExclusive(&g_job_lock);
            return false;
        }
        g_life_buf[g_write][m].type = type;
        g_life_buf[g_write][m].s    = s;
        g_life_count[g_write] = m + 1;
        AddRefAt(s, 1);
        ReleaseSRWLockExclusive(&g_job_lock);
        return true;
    }

    int n = g_job_count[g_write];
    if (n >= MAX_JOB) {
        ++g_job_dropped;
        ReleaseSRWLockExclusive(&g_job_lock);
        return false;
    }

    Job* j = &g_job_buf[g_write][n];
    j->type = type;
    j->s = s;
    j->len = len;
    if (len > 0){
        memcpy(j->data, data, len);
    }

    g_job_count[g_write] = n+1;

    AddRefAt(s, 1);

    ReleaseSRWLockExclusive(&g_job_lock);
    return true;
}

// 틱 스레드가 부른다. 통을 통째로 바꿔치기 한다.
//
// 두 통을 **한 번의 자물쇠 안에서 같이** 바꾼다.
// 따로 바꾸면 g_write 가 두 번 뒤집혀서 주문이 엉뚱한 통에 들어간다
inline int SwapJobs(Job** out, LifeJob** life_out, int* life_count){
    AcquireSRWLockExclusive(&g_job_lock);

    int idx = g_write;   // 지금까지 워커가 채우던 통
    int count  = g_job_count[idx];
    int lcount = g_life_count[idx];

    g_write = 1 - g_write;  // 0 이면 1, 1 이면 0. 워커는 이제 저쪽에 꽂는다.
    g_job_count[idx]  = 0;  // 다음에 이 통 차례가 오면 0부터 채운다
    g_life_count[idx] = 0;

    ReleaseSRWLockExclusive(&g_job_lock);

    *out        = g_job_buf[idx];
    *life_out   = g_life_buf[idx];
    *life_count = lcount;
    return count;
}


