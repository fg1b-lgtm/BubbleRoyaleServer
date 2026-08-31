// tools/movetest.cpp — 이동과 걸치기 판정을 서버 없이 시험한다
//
// SPEC 9/1 완료 조건이 "클라이언트 없이 로그만으로" 라서 이 도구가 필요하다.
// 소켓도 세션도 안 쓴다. 계산만 꺼내서 두들긴다.
//
// 컴파일: practice 폴더에서  build.bat ..\tools\movetest.cpp
// 실행  : practice\bin\movetest.exe
#include <cstdio>
#include "../Server/src/Game.h"

static int g_pass = 0;
static int g_fail = 0;

static void Check(bool ok, const char* what)
{
    if (ok) { ++g_pass; printf("  [PASS] %s\n", what); }
    else    { ++g_fail; printf("  [FAIL] %s\n", what); }
}

// 가로로 뻥 뚫린 맵. 테두리만 벽이다
static void MakeOpenMap(GameMap& m)
{
    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            bool edge = (x == 0 || y == 0 || x == MAP_W - 1 || y == MAP_H - 1);
            m.tile[y][x] = edge ? TILE_WALL : TILE_EMPTY;
        }
    }
}

static Player MakePlayer(int tx, int ty)
{
    Player p = {};
    p.s        = nullptr;   // 이 도구는 세션을 안 쓴다. MovePlayer 도 안 본다
    p.px       = TileCenter(tx);
    p.py       = TileCenter(ty);
    p.judge_tx = tx;
    p.judge_ty = ty;
    p.alive    = true;
    return p;
}

// ── 시험 1 : 임계값이 정확히 상수대로인가 ────────────────────
//
// 새 타일에 TILE_SWITCH_NUM/DEN 이상 들어가야 판정이 넘어간다.
// 256 * 68 / 100 = 174.08 이므로 175 units 부터 넘어가야 맞다.
static void Test1_Threshold()
{
    printf("\n=== 시험 1: 판정이 넘어가는 지점 ===\n");

    int want = (TILE_UNITS * TILE_SWITCH_NUM + TILE_SWITCH_DEN - 1) / TILE_SWITCH_DEN;
    printf("  상수로 계산한 임계값: %d units (타일 %d 칸 중)\n", want, TILE_UNITS);

    const int judge = 5;

    // 오른쪽으로 넘어가는 경우. 새 타일(6번) 안으로 in 만큼 들어갔다
    int first_right = -1;
    bool ok_right = true;
    for (int in = 0; in < TILE_UNITS; ++in) {
        int pos = 6 * TILE_UNITS + in;
        int got = UpdateJudgeAxis(pos, judge);

        bool should = (in >= want);
        if ((got == 6) != should) { ok_right = false; }
        if (got == 6 && first_right < 0) { first_right = in; }
    }
    printf("  오른쪽: %d units 들어갔을 때 넘어갔다\n", first_right);
    Check(ok_right && first_right == want, "오른쪽 임계값이 상수와 같다");

    // 왼쪽으로 넘어가는 경우. 새 타일(4번)에 오른쪽에서 들어간다
    int first_left = -1;
    bool ok_left = true;
    for (int in = TILE_UNITS - 1; in >= 0; --in) {
        int pos = 4 * TILE_UNITS + in;
        int got = UpdateJudgeAxis(pos, judge);

        bool should = ((TILE_UNITS - in) >= want);
        if ((got == 4) != should) { ok_left = false; }
        if (got == 4 && first_left < 0) { first_left = TILE_UNITS - in; }
    }
    printf("  왼쪽  : %d units 들어갔을 때 넘어갔다\n", first_left);
    Check(ok_left && first_left == want, "왼쪽 임계값이 오른쪽과 같다 (좌우 대칭)");

    // 같은 타일 안에서는 아무 일도 없어야 한다
    bool same_ok = true;
    for (int in = 0; in < TILE_UNITS; ++in) {
        if (UpdateJudgeAxis(judge * TILE_UNITS + in, judge) != judge) { same_ok = false; }
    }
    Check(same_ok, "같은 타일 안에서는 판정이 안 흔들린다");
}

// ── 시험 2 : 걸치기가 실제로 몇 틱이나 유지되나 ──────────────
static void Test2_Straddle()
{
    printf("\n=== 시험 2: 오른쪽으로 걸어가며 걸치기 구간 보기 ===\n");

    GameMap m;
    MakeOpenMap(m);

    Player p = MakePlayer(3, 5);
    p.dir_x = 1;

    printf("  틱  위치     몸이 있는 타일  판정 타일   걸침\n");

    int straddle_ticks = 0;
    bool seen = false;

    for (int t = 1; t <= 22; ++t) {
        MovePlayer(m, p);

        int body = p.px / TILE_UNITS;
        bool straddling = (body != p.judge_tx);
        if (straddling) { ++straddle_ticks; seen = true; }

        printf("  %2d  %5d    %2d              %2d          %s\n",
               t, p.px, body, p.judge_tx, straddling ? "<-- 걸침" : "");
    }

    printf("\n  걸친 채로 지나간 틱: %d\n", straddle_ticks);
    Check(seen, "몸이 있는 타일과 판정 타일이 다른 순간이 존재한다");

    // 걸치기가 없으면 그냥 격자 게임이 된다. 이 게임의 핵심이 사라진다
    Check(straddle_ticks >= 3, "걸치기 구간이 최소 3틱은 된다 (한 틱이면 노릴 수 없다)");
}

// ── 시험 3 : 벽을 뚫지 않는가 ────────────────────────────────
static void Test3_Wall()
{
    printf("\n=== 시험 3: 벽에 부딪히기 ===\n");

    GameMap m;
    MakeOpenMap(m);
    m.tile[5][8] = TILE_WALL;   // (8,5) 에 벽 하나

    Player p = MakePlayer(3, 5);
    p.dir_x = 1;

    bool inside_wall = false;
    for (int t = 0; t < 200; ++t) {
        MovePlayer(m, p);
        if (m.IsSolid(p.px / TILE_UNITS, p.py / TILE_UNITS)) {
            inside_wall = true;
            break;
        }
    }

    printf("  200틱 걸어간 뒤 위치: %d (타일 %d), 판정 타일 %d\n",
           p.px, p.px / TILE_UNITS, p.judge_tx);

    Check(!inside_wall, "벽 안으로 들어가지 않았다");
    Check(p.px / TILE_UNITS == 7, "벽 바로 앞 타일에 서 있다");

    // 벽에 붙으면 판정도 결국 따라와야 한다. 안 그러면 벽에 붙은 채 계속 안 맞는다
    Check(p.judge_tx == 7, "벽 앞에 오래 서 있으면 판정도 따라온다");
}

// ── 시험 4 : 벽을 타고 미끄러지나 ────────────────────────────
static void Test4_Slide()
{
    printf("\n=== 시험 4: 벽에 비스듬히 부딪히기 ===\n");

    GameMap m;
    MakeOpenMap(m);

    // 벽 하나만 놓으면 아래로 비껴가면서 그냥 지나가버린다.
    // 가로축이 확실히 막히도록 세로로 세운다
    for (int y = 1; y < MAP_H - 1; ++y) {
        m.tile[y][8] = TILE_WALL;
    }

    Player p = MakePlayer(3, 5);
    p.dir_x = 1;
    p.dir_y = 1;   // 오른쪽 아래로 간다. 오른쪽은 곧 막힌다

    int start_y = p.py;
    for (int t = 0; t < 60; ++t) {
        MovePlayer(m, p);
    }

    printf("  가로 타일 %d 에서 멈췄고, 세로는 %d -> %d 로 계속 갔다\n",
           p.px / TILE_UNITS, start_y, p.py);

    Check(p.px / TILE_UNITS == 7, "가로는 벽 앞에서 섰다");
    Check(p.py > start_y + TILE_UNITS, "세로는 한 칸 넘게 계속 갔다");
}

// ── 시험 5 : 롤러를 먹으면 실제로 빨라지나 ───────────────────
static void Test5_Speed()
{
    printf("\n=== 시험 5: 속도 ===\n");

    GameMap m;
    MakeOpenMap(m);

    int prev = 0;
    bool rising = true;

    for (int lv = 0; lv <= 4; ++lv) {
        Player p = MakePlayer(1, 5);
        p.dir_x    = 1;
        p.speed_lv = lv;

        int start = p.px;
        for (int t = 0; t < TICK_RATE; ++t) {
            MovePlayer(m, p);
        }

        int moved = p.px - start;
        // 소수점을 안 쓰려고 100 배로 재서 정수로 찍는다
        int tiles100 = moved * 100 / TILE_UNITS;

        printf("  롤러 %d 개 : 1초에 %d.%02d 타일\n", lv, tiles100 / 100, tiles100 % 100);

        if (lv > 0 && moved <= prev) { rising = false; }
        prev = moved;
    }

    Check(rising, "롤러를 먹을수록 빨라진다");
}

// ── 시험 6 : 맵이 씨앗 하나로 똑같이 재현되나 ────────────────
static void Test6_MapDeterminism()
{
    printf("\n=== 시험 6: 같은 씨앗이면 같은 맵 ===\n");

    GameMap a, b, c;
    a.Generate(1234);
    b.Generate(1234);
    c.Generate(9999);

    bool same = true;
    bool diff = false;
    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (a.tile[y][x] != b.tile[y][x]) { same = false; }
            if (a.tile[y][x] != c.tile[y][x]) { diff = true; }
        }
    }

    Check(same, "씨앗이 같으면 맵이 완전히 같다 (로그를 다시 볼 수 있다)");
    Check(diff, "씨앗이 다르면 맵이 다르다");

    // 스폰 자리가 전부 통로여야 한다. 시작하자마자 벽 속에 있으면 안 된다
    bool spawn_ok = true;
    for (int i = 0; i < a.spawn_count; ++i) {
        if (a.IsSolid(a.spawn_x[i], a.spawn_y[i])) { spawn_ok = false; }
    }
    printf("  스폰 자리 %d 개\n", a.spawn_count);
    Check(a.spawn_count >= PLAYER_MAX, "스폰 자리가 사람 수보다 많다");
    Check(spawn_ok, "모든 스폰 자리가 통로다");
}

int main(int argc, char** argv)
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    Test1_Threshold();
    Test2_Straddle();
    Test3_Wall();
    Test4_Slide();
    Test5_Speed();
    Test6_MapDeterminism();

    printf("\n===== 결과: %d PASS / %d FAIL =====\n", g_pass, g_fail);

    // movetest.exe map  으로 부르면 맵을 눈으로 본다
    if (argc > 1 && argv[1][0] == 'm') {
        printf("\n=== 씨앗 1234 로 만든 맵 ===\n");
        GameMap m;
        m.Generate(1234);
        m.Dump();
    }

    return g_fail == 0 ? 0 : 1;
}
