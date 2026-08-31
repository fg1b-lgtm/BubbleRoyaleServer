// 2026-08-31 — Job Queue (3단계: 안 보고 다시 쓰기)
//
// 시도 기록
//   1차 (  /  ):
//   2차 (  /  ):
//   3차 (  /  ):
//
// 무엇을 다시 쓰나
//   워커 여럿이 꽂고 틱 스레드 하나가 통째로 가져가는 주문 꽂이.
//   Server/src/JobQueue.h 에 있는 것을 안 보고 다시 쓴다.
//
// 완료 조건
//   꽂은 사람 4명이 각각 1000개를 꽂고, 가져가는 쪽이 전부 받아서
//   잃어버린 주문 0 / 내용 깨짐 0 / 남은 참조 0 이 나온다.
//
// 컴파일
//   practice 폴더에서  build.bat 2026-08-31-jobqueue\jobqueue.cpp
//
// 규칙
//   원본 탭을 닫는다. 자동완성을 끈다.
//   막힌 줄만 원본을 열어본다. 전체를 다시 보지 않는다.
//   컴파일 에러가 나는 건 정상이다. 그 에러 목록이 아직 안 익은 곳의 지도다.

#include <winsock2.h>
#include <cstdio>
#include <cstring>
#include "Protocol.h"

// ── 주어진 것. 여기는 그냥 둔다 ──────────────────────────────
//
// 진짜 Session 대신 참조 카운트만 있는 가짜다.
// 오늘 연습할 것은 꽂이지 세션이 아니다.

struct Session
{
    LONG ref_count;
};

inline void AddRef(Session* s)  { InterlockedIncrement(&s->ref_count); }
inline void Release(Session* s) { InterlockedDecrement(&s->ref_count); }

constexpr int MAX_JOB = 1024;


// ── 여기부터 직접 쓴다 ───────────────────────────────────────
//
// 아래 주석은 2단계에서 네가 자기 말로 쓴 것만 옮겨온 것이다.
// 코드는 한 줄도 없다. 주석만 보고 처음부터 친다.


// 주문 종류




// 통 두 개를 번갈아 쓴다




// main 맨 처음에 한 번 부른다




// 워커가 부른다. 꽂히면 true




// 틱 스레드가 부른다. 통을 통째로 바꿔치기 한다




// ── 여기부터는 확인용이다. 고치지 않는다 ─────────────────────

constexpr int PUSHER_COUNT = 4;
constexpr int PER_PUSHER   = 1000;

static Session g_fake   = {};
static LONG    g_pushed = 0;
static LONG    g_retry  = 0;

// 워커 흉내. 자기 번호와 몇 번째인지를 몸통에 적어서 꽂는다
static DWORD WINAPI Pusher(LPVOID param)
{
    int id = (int)(INT_PTR)param;

    for (int i = 0; i < PER_PUSHER; ++i) {
        char body[16];
        int  len = sprintf_s(body, "%d-%d", id, i);

        // 통이 차면 가져가는 쪽이 비울 때까지 기다렸다 다시 꽂는다
        while (!PushJob(JobType::Packet, &g_fake, body, len + 1)) {
            InterlockedIncrement(&g_retry);
            Sleep(0);
        }
        InterlockedIncrement(&g_pushed);
    }
    return 0;
}

// 틱 스레드 흉내
int main()
{
    setvbuf(stdout, nullptr, _IONBF, 0);
    InitJobQueue();

    HANDLE th[PUSHER_COUNT];
    for (int i = 0; i < PUSHER_COUNT; ++i) {
        th[i] = CreateThread(nullptr, 0, Pusher, (LPVOID)(INT_PTR)i, 0, nullptr);
        if (th[i] == nullptr) {
            printf("[x] CreateThread failed\n");
            return 1;
        }
    }

    const int expect = PUSHER_COUNT * PER_PUSHER;

    int got   = 0;
    int bad   = 0;
    int ticks = 0;
    int seen[PUSHER_COUNT] = {};   // 꽂은 사람별로 몇 번째까지 받았나

    while (got < expect) {
        Job* jobs  = nullptr;
        int  count = SwapJobs(&jobs);
        ++ticks;

        for (int i = 0; i < count; ++i) {
            int who = -1;
            int no  = -1;

            if (sscanf_s(jobs[i].data, "%d-%d", &who, &no) != 2) {
                ++bad;   // 내용이 깨졌다
            }
            else if (who < 0 || who >= PUSHER_COUNT || no != seen[who]) {
                ++bad;   // 순서가 어긋났거나 주문이 중복됐다
            }
            else {
                seen[who] = no + 1;
            }

            Release(jobs[i].s);
            ++got;
        }

        Sleep(1);
    }

    WaitForMultipleObjects(PUSHER_COUNT, th, TRUE, 5000);
    for (int i = 0; i < PUSHER_COUNT; ++i) {
        CloseHandle(th[i]);
    }

    bool pass = (got == expect) && (bad == 0) && (g_fake.ref_count == 0);

    printf("\n===== 결과 =====\n");
    printf("꽂은 주문        : %ld\n", g_pushed);
    printf("가져간 주문      : %d  (기대 %d)\n", got, expect);
    printf("통이 차서 재시도 : %ld  (커도 된다. 통이 찬 길도 도는지 보는 것뿐이다)\n", g_retry);
    printf("가져간 횟수      : %d\n", ticks);
    printf("내용 깨짐        : %d\n", bad);
    printf("남은 참조        : %ld  (0 이어야 한다)\n", g_fake.ref_count);
    printf("\n%s\n", pass ? "[o] PASS" : "[x] FAIL");

    return pass ? 0 : 1;
}
