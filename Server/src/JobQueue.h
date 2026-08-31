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

// 통 두 개를 번갈아 쓴다
inline Job  g_job_buf[2][MAX_JOB];
inline int  g_job_count[2];
inline int  g_write;    // 지금 워커가 꽂는 통 번호
inline SRWLOCK g_job_lock;

// main 맨 처음에 한 번 부른다.
inline void InitJobQueue(){
    InitializeSRWLock(&g_job_lock);
    g_job_count[0] = 0;
    g_job_count[1] = 0;
    g_write = 0;
}

// 워커가 부른다. 꽂히면 true
inline bool PushJob(JobType type, Session* s, const char* data, int len){
    AcquireSRWLockExclusive(&g_job_lock);

    int n = g_job_count[g_write];
    if (n >= MAX_JOB) {
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

    AddRef(s);

    ReleaseSRWLockExclusive(&g_job_lock);
    return true;
}

// 틱 스레드가 부른다. 통을 통째로 바꿔치기 한다.
inline int SwapJobs(Job** out){
    AcquireSRWLockExclusive(&g_job_lock);

    int idx = g_write;   // 지금까지 워커가 채우던 통
    int count = g_job_count[idx];

    g_write = 1 - g_write;  // 0 이면 1, 1 이면 0. 워커는 이제 저쪽에 꽂는다.
    g_job_count[idx] = 0;   // 다음에 이 통 차례가 오면 0부터 채운다

    ReleaseSRWLockExclusive(&g_job_lock);

    *out = g_job_buf[idx];
    return count;
}


