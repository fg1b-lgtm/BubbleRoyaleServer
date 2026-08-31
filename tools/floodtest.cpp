// tools/floodtest.cpp — 침수 규칙을 서버 없이 시험한다
//
// 6분짜리 일정을 그대로 돌리면 시험이 오래 걸리므로 배속으로 돌린다.
// 규칙은 그대로고 시각만 나뉜다. 서버의 fast 모드와 같은 길이다.
//
// 컴파일: practice 폴더에서  build.bat ..\tools\floodtest.cpp
// 실행  : practice\bin\floodtest.exe
#include <cstdio>
#include "../Server/src/GameTick.h"

static int g_pass = 0;
static int g_fail = 0;

static void Check(bool ok, const char* what)
{
    if (ok) { ++g_pass; printf("  [PASS] %s\n", what); }
    else    { ++g_fail; printf("  [FAIL] %s\n", what); }
}

static const int SCALE = 10;   // 6분을 36초로

static int g_fake_id = 0;

static Session* NextFakeSession()
{
    return (Session*)(INT_PTR)(++g_fake_id);
}

static void OpenBoard(unsigned int seed)
{
    InitGame(seed, SCALE);
    g_fake_id = 0;

    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            bool edge = (x == 0 || y == 0 || x == MAP_W - 1 || y == MAP_H - 1);
            g_game.map.tile[y][x] = edge ? TILE_WALL : TILE_EMPTY;
            g_game.item[y][x] = ITEM_NONE;
        }
    }

    // 규칙 시험이라 판이 진행 중이라고 못 박는다.
    // 안 하면 기다림 단계라 물풍선을 못 놓는다
    g_game.phase = ROUND_PLAYING;
}

static int Join(int tx, int ty)
{
    int slot = AddPlayer(NextFakeSession());
    if (slot < 0) return -1;

    Player& p = g_game.players[slot];
    p.alive    = true;   // 진행 중에 들어오면 관전이 되므로 여기서 되돌린다
    p.px       = TileCenter(tx);
    p.py       = TileCenter(ty);
    p.judge_tx = tx;
    p.judge_ty = ty;
    return slot;
}

// 규칙만 보는 시험이라 판 생명주기(기다림/카운트다운/결과)는 건너뛴다.
// GameTick 대신 게임 판정 한 틱만 직접 부른다
static void Tick()
{
    g_game.event_count = 0;
    PlayTick();
}

static int CountEvent(uint8_t type)
{
    int n = 0;
    for (int i = 0; i < g_game.event_count; ++i) {
        if (g_game.events[i].type == type) ++n;
    }
    return n;
}

// 구역 한가운데 타일 좌표
static void SectorCenter(int sector, int* tx, int* ty)
{
    int sx = sector % SECTOR_COLS;
    int sy = sector / SECTOR_COLS;
    *tx = sx * SECTOR_W + SECTOR_W / 2;
    *ty = sy * SECTOR_H + SECTOR_H / 2;
}

static int CenterSector()
{
    return (SECTOR_ROWS / 2) * SECTOR_COLS + (SECTOR_COLS / 2);
}

// ── 시험 1 : 여덟 구역이 3+2+2+1 로 잠기고 가운데는 남는가 ───
static void Test1_Schedule()
{
    printf("\n=== 시험 1: 침수 일정 ===\n");

    OpenBoard(1234);

    int last = g_game.flood_fill[FLOOD_STAGES - 1];
    int warned = 0, flooded = 0;

    for (int t = 1; t <= last + 10; ++t) {
        Tick();
        warned  += CountEvent(EVT_FLOOD_WARN);
        flooded += CountEvent(EVT_FLOOD);
    }

    printf("  예고 %d 구역, 침수 %d 구역 (바깥 구역 %d 개)\n",
           warned, flooded, g_game.flood_outer);

    Check(g_game.flood_outer == 8, "바깥 구역이 여덟이다");
    Check(flooded == 8, "여덟 구역이 다 잠겼다");
    Check(warned == flooded, "예고 없이 잠기는 구역이 없다");

    int cs = CenterSector();
    Check(g_game.sector_state[cs / SECTOR_COLS][cs % SECTOR_COLS] == SECTOR_OPEN,
          "가운데 구역은 끝까지 안 잠긴다");

    int open = 0;
    for (int sy = 0; sy < SECTOR_ROWS; ++sy) {
        for (int sx = 0; sx < SECTOR_COLS; ++sx) {
            if (g_game.sector_state[sy][sx] != SECTOR_FLOODED) ++open;
        }
    }
    printf("  끝까지 남은 구역 %d 개 (%dx%d)\n", open, SECTOR_W, SECTOR_H);
    Check(open == 1, "최종 1구역만 남는다");
}

// ── 시험 2 : 예고가 침수보다 먼저 오는가 ─────────────────────
static void Test2_Warning()
{
    printf("\n=== 시험 2: 예고 ===\n");

    OpenBoard(1234);

    int warn_at = -1, fill_at = -1;

    for (int t = 1; t <= g_game.flood_fill[0] + 5; ++t) {
        Tick();
        if (warn_at < 0 && CountEvent(EVT_FLOOD_WARN) > 0) warn_at = t;
        if (fill_at < 0 && CountEvent(EVT_FLOOD) > 0)      fill_at = t;
    }

    printf("  예고 %d 틱, 침수 %d 틱, 사이 %d 초 (배속 %d배)\n",
           warn_at, fill_at, (fill_at - warn_at) * SCALE / TICK_RATE, SCALE);

    Check(warn_at > 0 && fill_at > warn_at, "예고가 먼저 온다");
    Check((fill_at - warn_at) * SCALE / TICK_RATE == 30, "예고 30초 뒤에 잠긴다");
}

// ── 시험 3 : 같은 씨앗이면 같은 순서로 잠기는가 ──────────────
static void Test3_Determinism()
{
    printf("\n=== 시험 3: 순서 재현 ===\n");

    OpenBoard(1234);
    int a[16];
    for (int i = 0; i < g_game.flood_outer; ++i) a[i] = g_game.flood_order[i];

    OpenBoard(1234);
    bool same = true;
    for (int i = 0; i < g_game.flood_outer; ++i) {
        if (a[i] != g_game.flood_order[i]) same = false;
    }

    OpenBoard(4321);
    bool diff = false;
    for (int i = 0; i < g_game.flood_outer; ++i) {
        if (a[i] != g_game.flood_order[i]) diff = true;
    }

    printf("  씨앗 1234 의 순서:");
    OpenBoard(1234);
    for (int i = 0; i < g_game.flood_outer; ++i) printf(" %d", g_game.flood_order[i]);
    printf("\n");

    Check(same, "같은 씨앗이면 같은 순서다");
    Check(diff, "씨앗이 다르면 순서가 다르다");

    bool no_center = true;
    for (int i = 0; i < g_game.flood_outer; ++i) {
        if (g_game.flood_order[i] == CenterSector()) no_center = false;
    }
    Check(no_center, "가운데 구역은 순서에 아예 없다");
}

// ── 시험 4 : 즉사가 없고, 못 나가면 죽는가 ───────────────────
static void Test4_Drown()
{
    printf("\n=== 시험 4: 못 나가면 죽는다 ===\n");

    OpenBoard(1234);

    int sector = g_game.flood_order[0];   // 제일 먼저 잠기는 구역
    int tx, ty;
    SectorCenter(sector, &tx, &ty);

    int me = Join(tx, ty);
    Player& p = g_game.players[me];

    int drown_at = -1, dead_at = -1;

    for (int t = 1; t <= g_game.flood_fill[0] + FLOOD_ESCAPE_TICKS + 10; ++t) {
        Tick();
        if (drown_at < 0 && CountEvent(EVT_DROWN) > 0) drown_at = t;
        if (dead_at  < 0 && CountEvent(EVT_DEATH) > 0) dead_at  = t;
    }

    printf("  잠긴 뒤 %d 틱만에 카운트다운, %d 틱만에 사망 (%d초)\n",
           drown_at, dead_at, (dead_at - drown_at) / TICK_RATE);

    Check(drown_at > 0, "잠기면 카운트다운이 시작된다");
    Check(dead_at > drown_at, "즉사가 아니다");
    Check(dead_at - drown_at == FLOOD_ESCAPE_TICKS, "상수대로 버틸 시간을 준다");
    Check(!p.alive, "끝까지 안 나가면 죽는다");
}

// ── 시험 5 : 제때 나가면 사는가 ──────────────────────────────
static void Test5_Escape()
{
    printf("\n=== 시험 5: 나가면 산다 ===\n");

    OpenBoard(1234);

    int sector = g_game.flood_order[0];
    int tx, ty;
    SectorCenter(sector, &tx, &ty);

    int me = Join(tx, ty);
    Player& p = g_game.players[me];

    // 잠길 때까지 기다린다
    for (int t = 1; t <= g_game.flood_fill[0] + 2; ++t) {
        Tick();
    }
    Check(p.flood_ticks > 0, "카운트다운이 돌고 있다");

    // 안 잠긴 가운데 구역으로 옮긴다. 실제로는 뛰어서 나가는 것이다
    int cx, cy;
    SectorCenter(CenterSector(), &cx, &cy);
    p.px = TileCenter(cx);
    p.py = TileCenter(cy);
    p.judge_tx = cx;
    p.judge_ty = cy;

    Tick();
    Check(p.flood_ticks == 0, "나오면 카운트다운이 멈춘다");

    for (int t = 0; t < FLOOD_ESCAPE_TICKS * 2; ++t) {
        Tick();
    }
    Check(p.alive, "나왔으면 안 죽는다");
}

// ── 시험 6 : 나중에 들어가도 막히지 않고 카운트다운이 도는가 ─
static void Test6_ReEnter()
{
    printf("\n=== 시험 6: 잠긴 구역에 들어가기 ===\n");

    OpenBoard(1234);

    int cx, cy;
    SectorCenter(CenterSector(), &cx, &cy);
    int me = Join(cx, cy);
    Player& p = g_game.players[me];

    for (int t = 1; t <= g_game.flood_fill[0] + 2; ++t) {
        Tick();
    }
    Check(p.alive && p.flood_ticks == 0, "가운데에 있으면 멀쩡하다");

    // 잠긴 구역으로 걸어 들어간다. 막지 않는 게 규칙이다
    int sector = g_game.flood_order[0];
    int tx, ty;
    SectorCenter(sector, &tx, &ty);
    p.px = TileCenter(tx);
    p.py = TileCenter(ty);
    p.judge_tx = tx;
    p.judge_ty = ty;

    Tick();
    printf("  들어가자마자 남은 시간 %d 틱 (%d초)\n", p.flood_ticks, p.flood_ticks / TICK_RATE);

    Check(p.flood_ticks > 0, "들어가면 카운트다운이 다시 시작된다");
    Check(CountEvent(EVT_DROWN) == 1, "DROWN 이 떴다");

    // 2초면 대여섯 칸이다. 질러가는 플레이가 성립하는 근거다
    int tiles = FLOOD_ESCAPE_TICKS * (MOVE_SPEED_BASE) / TILE_UNITS;
    printf("  버티는 동안 갈 수 있는 거리: 약 %d 칸\n", tiles);
    Check(tiles >= 4, "가로지를 만한 거리가 나온다");
}

// ── 시험 7 : 침수 경계에서도 걸치기가 통하는가 ───────────────
static void Test7_StraddleBoundary()
{
    printf("\n=== 시험 7: 침수 경계에서 걸치기 ===\n");

    OpenBoard(1234);

    // 잠기는 구역과 안 잠기는 구역이 맞닿은 세로 경계를 찾는다
    int sector = -1;
    for (int i = 0; i < g_game.flood_outer; ++i) {
        int s  = g_game.flood_order[i];
        int sx = s % SECTOR_COLS;
        int sy = s / SECTOR_COLS;
        if (sx == 0 && sy == SECTOR_ROWS / 2) { sector = s; break; }
    }

    if (sector < 0) {
        printf("  이 씨앗에는 맞는 경계가 없다. 건너뛴다\n");
        return;
    }

    int me = Join(SECTOR_W, SECTOR_H / 2 + SECTOR_H * (SECTOR_ROWS / 2));
    Player& p = g_game.players[me];

    // 중심은 안전한 구역의 첫 칸에 두고 경계에 바짝 붙인다.
    // 몸은 잠긴 구역까지 걸치지만 과반수는 안전한 쪽에 있다
    const int stand = SECTOR_W * TILE_UNITS + 10;

    for (int t = 1; t <= g_game.flood_fill[0] + 5; ++t) {
        p.px = stand;   // 매 틱 그 자리를 유지한다
        Tick();
    }

    int from, to;
    BodySpanAxis(p.px, &from, &to);

    printf("  중심은 %d번 칸(구역 %d), 몸은 %d ~ %d 칸에 걸쳐 있다\n",
           p.judge_tx, SectorIndex(p.judge_tx, p.judge_ty), from, to);
    printf("  걸친 쪽 구역: %d (%s)\n",
           SectorIndex(from, p.judge_ty),
           SectorStateAt(from, p.judge_ty) == SECTOR_FLOODED ? "잠김" : "안전");

    Check(from != to, "몸이 두 구역에 걸쳐 있다");
    Check(SectorStateAt(from, p.judge_ty) == SECTOR_FLOODED, "걸친 쪽은 잠긴 구역이다");
    Check(p.flood_ticks == 0, "중심이 안전하면 카운트다운이 안 돈다");
    Check(p.alive, "경계에 걸쳐 있으면 안 죽는다");
}

// ── 시험 8 : 최종 구역 안에서 계속 좁아지는가 ────────────────
static void Test8_Ring()
{
    printf("\n=== 시험 8: 최종 구역 수위 상승 ===\n");

    OpenBoard(1234);

    // 구역이 다 잠길 때까지 돌린다
    int last = g_game.flood_fill[FLOOD_STAGES - 1];
    for (int t = 1; t <= last + 5; ++t) Tick();

    Check(g_game.ring_on, "구역을 다 잠그면 안쪽 물이 시작된다");

    int w0 = g_game.ring_x1 - g_game.ring_x0 + 1;
    int h0 = g_game.ring_y1 - g_game.ring_y0 + 1;
    printf("  시작 크기 %d x %d (조각 크기 %d x %d)\n", w0, h0, SECTOR_W, SECTOR_H);
    Check(w0 == SECTOR_W && h0 == SECTOR_H, "최종 조각 크기에서 시작한다");

    // 한 겹 좁아질 때까지
    for (int t = 0; t < g_game.ring_step + 2; ++t) Tick();
    int w1 = g_game.ring_x1 - g_game.ring_x0 + 1;
    printf("  %d초 뒤 %d x %d\n", RING_STEP_TICKS / TICK_RATE,
           w1, g_game.ring_y1 - g_game.ring_y0 + 1);
    Check(w1 < w0, "시간이 지나면 좁아진다");

    // 끝까지 좁혀본다
    for (int t = 0; t < g_game.ring_step * 12; ++t) Tick();
    int w2 = g_game.ring_x1 - g_game.ring_x0 + 1;
    int h2 = g_game.ring_y1 - g_game.ring_y0 + 1;
    printf("  끝까지 좁히면 %d x %d = %d 칸\n", w2, h2, w2 * h2);
    Check(w2 == RING_MIN_W && h2 == RING_MIN_H, "최소 크기에서 멈춘다");
    Check(w2 * h2 <= 40, "둘이 남으면 반드시 만날 만큼 좁다");
}

// ── 시험 9 : 잠긴 구역의 아이템은 남는가 ─────────────────────
//
// 물이 찼다고 아이템이 사라지면 잠긴 구역에 들어갈 이유가 지름길뿐이다.
// 남겨두면 "2초 안에 저것만 먹고 나올까" 가 판단거리가 된다 (SPEC 2.6)
static void Test9_ItemsSurviveFlood()
{
    printf("\n=== 시험 9: 잠긴 구역의 아이템 ===\n");

    OpenBoard(1234);

    int sector = g_game.flood_order[0];
    int tx, ty;
    SectorCenter(sector, &tx, &ty);

    g_game.item[ty][tx] = ITEM_POWER;

    for (int t = 1; t <= g_game.flood_fill[0] + 30; ++t) {
        Tick();
    }

    printf("  구역 %d 이 잠긴 뒤 그 칸의 아이템: %d\n", sector, g_game.item[ty][tx]);
    Check(IsUnderWater(tx, ty), "그 칸은 물에 잠겼다");
    Check(g_game.item[ty][tx] == ITEM_POWER, "아이템은 그대로 남아 있다");

    int tiles = FLOOD_ESCAPE_TICKS * MOVE_SPEED_BASE / TILE_UNITS;
    printf("  2초 동안 갈 수 있는 거리 %d 칸. 그 안이면 먹고 나올 만하다\n", tiles);
    Check(tiles >= 4, "먹고 나올 만한 거리가 나온다");
}

int main()
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    Test1_Schedule();
    Test2_Warning();
    Test3_Determinism();
    Test4_Drown();
    Test5_Escape();
    Test6_ReEnter();
    Test7_StraddleBoundary();
    Test8_Ring();
    Test9_ItemsSurviveFlood();

    printf("\n===== 결과: %d PASS / %d FAIL =====\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
