// 수신 버퍼 (3단계: 안 보고 다시 쓰기)
//
// 시도 기록
//   1차 (  /  ):
//   2차 (  /  ):
//   3차 (  /  ):
//
// 무엇을 다시 쓰나
//   Server/src/RecvBuffer.h 에 있는 것을 안 보고 다시 쓴다.
//   커서 둘짜리 일자 버퍼다. 링이 아니다.
//
// 완료 조건
//   패킷 2000개를 아무렇게나 쪼갠 조각으로 넣어도
//   잃어버린 패킷 0 / 내용 깨짐 0 / 순서 어긋남 0 이 나온다.
//
// 컴파일
//   Windows :  build.bat 2026-09-01-recvbuffer\recvbuffer.cpp
//   맥      :  ./build.sh 2026-09-01-recvbuffer/recvbuffer.cpp
//
// 이 파일은 Windows API 를 안 쓴다. 맥에서 그대로 된다.
//
// 규칙
//   원본 탭을 닫는다. 자동완성을 끈다.
//   막힌 줄만 원본을 열어본다. 전체를 다시 보지 않는다.

#include <cstdio>
#include <cstring>
#include "Protocol.h"


// ── 여기부터 직접 쓴다 ───────────────────────────────────────
//
// 아래 주석은 네가 원본에 자기 말로 써 둔 것만 옮겨온 것이다.
// 코드는 한 줄도 없다.
//
//   [ 처리끝 | 아직 안 읽음 | 빈칸 ]
//              ↑read_pos     ↑write_pos


// 버퍼 크기 상수




// 소유 스레드 : worker
// struct RecvBuffer




    // ----쓰기 쪽, WSARecv가 담는곳----




    // ----읽기 쪽, 패킷 자르는 곳----




    // 다음 WSARecv 전에 부른다, 쓸 자리를 확보한다




        // 텅 빈 경우 둘 다 처음으로 되돌린다




        // 남은게 있는데 뒤쪽자리가 모자란 경우 앞으로 당긴다




// ── 여기부터는 확인용이다. 고치지 않는다 ─────────────────────

constexpr int PACKET_COUNT = 2000;
constexpr int STREAM_CAP   = 1 << 20;   // 1MB

static char g_stream[STREAM_CAP];   // 랜선으로 흘러올 바이트 전체
static int  g_stream_len = 0;

// 매번 같은 순서가 나오게 해 둔다. 실패하면 똑같이 재현된다
static unsigned int g_seed = 12345;

static int NextRand(int lo, int hi)
{
    g_seed = g_seed * 1103515245u + 12345u;
    return lo + (int)((g_seed >> 16) % (unsigned int)(hi - lo + 1));
}

// i 번째 패킷의 j 번째 몸통 바이트는 항상 이 값이다. 나중에 이걸로 대조한다
static char BodyByte(int i, int j)
{
    return (char)((i * 7 + j * 3) & 0x7F);
}

static int BodyLen(int i)
{
    return 1 + (i * 13) % 300;
}

// 보낼 바이트를 통째로 만들어 둔다
static void BuildStream()
{
    for (int i = 0; i < PACKET_COUNT; ++i) {
        int body = BodyLen(i);
        int size = HEADER_SIZE + body;

        PacketHeader h;
        h.size = (uint16_t)size;
        h.id   = PKT_ECHO;

        memcpy(g_stream + g_stream_len, &h, HEADER_SIZE);
        g_stream_len += HEADER_SIZE;

        for (int j = 0; j < body; ++j) {
            g_stream[g_stream_len++] = BodyByte(i, j);
        }
    }
}

int main()
{
    setvbuf(stdout, nullptr, _IONBF, 0);
    BuildStream();

    RecvBuffer rb;

    int fed      = 0;   // 지금까지 버퍼에 넣은 바이트
    int got      = 0;   // 지금까지 꺼낸 패킷 수
    int bad      = 0;   // 내용이 깨졌거나 순서가 어긋난 수
    int cleans   = 0;   // 앞으로 당긴 횟수
    int max_left = 0;   // 한 번에 가장 많이 남아 있던 양

    while (got < PACKET_COUNT) {
        // 1) 다음 recv 전에 쓸 자리를 확보한다
        int before = rb.WritableSize();
        rb.Clean();
        if (rb.WritableSize() > before) {
            ++cleans;
        }

        // 2) 랜선에서 아무 크기나 도착했다고 치고 넣는다
        if (fed < g_stream_len) {
            int room  = rb.WritableSize();
            int chunk = NextRand(1, 500);

            if (chunk > room)                 chunk = room;
            if (chunk > g_stream_len - fed)   chunk = g_stream_len - fed;

            if (chunk <= 0) {
                printf("[x] 넣을 자리가 없다. Clean 이 안 도는 것 같다\n");
                return 1;
            }

            memcpy(rb.WritePtr(), g_stream + fed, chunk);
            rb.OnWrite(chunk);
            fed += chunk;
        }

        if (rb.DataSize() > max_left) {
            max_left = rb.DataSize();
        }

        // 3) 완전한 패킷을 전부 꺼낸다
        while (true) {
            if (rb.DataSize() < HEADER_SIZE) {
                break;
            }

            PacketHeader* h = (PacketHeader*)rb.ReadPtr();

            if (h->size < HEADER_SIZE || h->size > MAX_PACKET_SIZE) {
                printf("[x] 말이 안 되는 크기 %u (패킷 %d 번째에서)\n", h->size, got);
                return 1;
            }

            if (rb.DataSize() < h->size) {
                break;
            }

            int body = h->size - HEADER_SIZE;
            if (body != BodyLen(got)) {
                ++bad;
            }
            else {
                const char* p = rb.ReadPtr() + HEADER_SIZE;
                for (int j = 0; j < body; ++j) {
                    if (p[j] != BodyByte(got, j)) { ++bad; break; }
                }
            }

            rb.OnRead(h->size);
            ++got;
        }
    }

    bool pass = (got == PACKET_COUNT) && (bad == 0) && (fed == g_stream_len);

    printf("\n===== 결과 =====\n");
    printf("흘려보낸 바이트 : %d\n", g_stream_len);
    printf("꺼낸 패킷       : %d  (기대 %d)\n", got, PACKET_COUNT);
    printf("내용 깨짐       : %d\n", bad);
    printf("앞으로 당긴 횟수 : %d  (0 이면 Clean 이 안 도는 것이다)\n", cleans);
    printf("한 번에 가장 많이 남아 있던 양 : %d\n", max_left);
    printf("\n%s\n", pass ? "[o] PASS" : "[x] FAIL");

    return pass ? 0 : 1;
}
