// 송신 버퍼 (3단계: 안 보고 다시 쓰기)
//
// 시도 기록
//   1차 (  /  ):
//   2차 (  /  ):
//   3차 (  /  ):
//
// 무엇을 다시 쓰나
//   Server/src/SendBuffer.h 에 있는 것을 안 보고 다시 쓴다.
//   이쪽은 진짜 링이다. 수신 버퍼와 다르다. 왜 다른지 먼저 떠올려봐라.
//
// 완료 조건
//   20만 바이트를 아무렇게나 쌓고 아무렇게나 빼내도
//   나온 순서가 넣은 순서와 정확히 같고, 이음매를 넘은 횟수가 0 이 아니다.
//
// 컴파일
//   Windows :  build.bat 2026-09-01-sendbuffer\sendbuffer.cpp
//   맥      :  ./build.sh 2026-09-01-sendbuffer/sendbuffer.cpp
//
// 이 파일은 Windows API 를 안 쓴다. 맥에서 그대로 된다.
//
// 규칙
//   원본 탭을 닫는다. 자동완성을 끈다.
//   막힌 줄만 원본을 열어본다. 전체를 다시 보지 않는다.

#include <cstdio>
#include <cstring>
#include <algorithm>
#include "Protocol.h"


// ── 여기부터 직접 쓴다 ───────────────────────────────────────
//
// 아래 주석은 네가 원본에 자기 말로 써 둔 것만 옮겨온 것이다.
// 코드는 한 줄도 없다.
//
//   head = 다음에 보낼 위치 / tail = 다음에 쌓을 위치 / size = 쌓여 있는 양


// 버퍼 크기 상수




// 소유 스레드 : 없음. 여러 워커가 같이 만진다
// struct SendBuffer




    // head와 tail이 같을때 비었는지 찼는지 구분을 못하기 때문에 size를 따로 센다




    // 뒤에 쌓는다. 자리가 모자라면 false




        // 끝까지 몇칸 남았는지 보고, 넘치면 나눠 넣는다.




    // 지금 한번에 보낼 수 있는 연속 구간을 알려준다




    // 실제로 n 바이트가 나갔다고 알린다.




// ── 여기부터는 확인용이다. 고치지 않는다 ─────────────────────

constexpr int TOTAL = 200000;

static char g_src[TOTAL];   // 쌓을 바이트 전체
static char g_out[TOTAL];   // 빠져나온 바이트 전체. 둘이 같아야 한다

// 매번 같은 순서가 나오게 해 둔다. 실패하면 똑같이 재현된다
static unsigned int g_seed = 20260901;

static int NextRand(int lo, int hi)
{
    g_seed = g_seed * 1103515245u + 12345u;
    return lo + (int)((g_seed >> 16) % (unsigned int)(hi - lo + 1));
}

int main()
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    for (int i = 0; i < TOTAL; ++i) {
        g_src[i] = (char)((i * 31 + i / 251) & 0x7F);
    }

    SendBuffer sb;

    int pushed    = 0;   // 쌓은 바이트
    int drained   = 0;   // 빼낸 바이트
    int full_hits = 0;   // 자리가 모자라 거절당한 횟수
    int seam      = 0;   // 쌓인 것이 이음매에 걸쳐 갈라져 있던 횟수
    int guard     = 0;   // 무한 루프 방지

    while (drained < TOTAL) {
        if (++guard > TOTAL * 8) {
            printf("[x] 끝나지 않는다. OnSent 나 Size 가 안 맞는 것 같다\n");
            return 1;
        }

        // 1) 쌓는다. 브로드캐스트가 몰려오는 상황이다
        if (pushed < TOTAL) {
            int len = NextRand(1, MAX_PACKET_SIZE);
            if (len > TOTAL - pushed) {
                len = TOTAL - pushed;
            }

            if (sb.Push(g_src + pushed, len)) {
                pushed += len;
            }
            else {
                ++full_hits;   // 가득 찼다. 빼내야 자리가 난다
            }
        }

        // 2) 보낸다. 한 번에 나가는 건 연속된 구간까지다
        if (sb.Size() > 0) {
            if (sb.PeekSize() < sb.Size()) {
                ++seam;   // 지금 쌓인 것이 이음매를 넘어 갈라져 있다
            }

            int n = NextRand(1, 900);
            if (n > sb.PeekSize()) {
                n = sb.PeekSize();
            }

            if (n <= 0) {
                printf("[x] 쌓인 건 %d 인데 보낼 수 있는 게 0 이다. PeekSize 를 보라\n", sb.Size());
                return 1;
            }

            memcpy(g_out + drained, sb.PeekPtr(), n);
            drained += n;
            sb.OnSent(n);
        }
    }

    int mismatch = -1;
    for (int i = 0; i < TOTAL; ++i) {
        if (g_out[i] != g_src[i]) { mismatch = i; break; }
    }

    bool pass = (drained == TOTAL) && (pushed == TOTAL) && (mismatch < 0)
             && (sb.Size() == 0) && (seam > 0);

    printf("\n===== 결과 =====\n");
    printf("쌓은 바이트     : %d  (기대 %d)\n", pushed, TOTAL);
    printf("빼낸 바이트     : %d  (기대 %d)\n", drained, TOTAL);
    printf("순서/내용 어긋난 첫 위치 : %s\n", mismatch < 0 ? "없음" : "있다");
    if (mismatch >= 0) {
        printf("   -> %d 번째 바이트부터 다르다\n", mismatch);
    }
    printf("가득 차서 거절   : %d\n", full_hits);
    printf("이음매를 넘은 횟수 : %d  (0 이면 링을 안 돌았다는 뜻이다)\n", seam);
    printf("남은 바이트     : %d  (0 이어야 한다)\n", sb.Size());
    printf("\n%s\n", pass ? "[o] PASS" : "[x] FAIL");

    return pass ? 0 : 1;
}
