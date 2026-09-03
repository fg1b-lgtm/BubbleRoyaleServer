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

// ── 시험 1 : 판정 칸이 몸 중심이 있는 칸인가 ─────────────────
//
// 규칙은 한 줄이다. 몸의 과반수가 있는 칸이 내가 있는 칸이다.
// 몸이 중심 기준으로 대칭이라 그건 곧 중심이 있는 칸이다.
static void Test1_Judge()
{
    printf("\n=== 시험 1: 판정 칸 ===\n");
    printf("  몸 크기 %d/%d 타일, 중심에서 %d units 씩\n",
           PLAYER_BODY_NUM, PLAYER_BODY_DEN, PLAYER_HALF);

    // 칸 안 어디에 있든 판정은 그 칸이어야 한다.
    // 늦게 따라오면 발밑이 아닌 칸에 물풍선이 깔린다
    bool ok = true;
    for (int t = 1; t < 8; ++t) {
        for (int in = 0; in < TILE_UNITS; ++in) {
            if (JudgeAxis(t * TILE_UNITS + in) != t) { ok = false; }
        }
    }
    Check(ok, "칸 안 어디에 있든 판정은 그 칸이다");

    // 경계를 넘는 순간 바로 넘어가야 한다
    Check(JudgeAxis(5 * TILE_UNITS - 1) == 4, "경계 직전은 앞 칸이다");
    Check(JudgeAxis(5 * TILE_UNITS)     == 5, "경계를 넘으면 바로 뒤 칸이다");
}

// ── 시험 2 : 몸이 두 칸에 걸칠 수 있는가 ─────────────────────
//
// 걸치기는 여기서 나온다. 몸은 두 칸에 걸쳐 있는데 중심은 한 칸에만 있다.
static void Test1b_BodySpan()
{
    printf("\n=== 시험 2: 몸이 걸쳐 있는 범위 ===\n");

    int from, to;

    // 칸 한가운데. 몸이 타일보다 작으니 한 칸 안에 다 들어간다
    BodySpanAxis(5 * TILE_UNITS + TILE_UNITS / 2, &from, &to);
    printf("  칸 한가운데: %d ~ %d\n", from, to);
    Check(from == 5 && to == 5, "한가운데 서면 한 칸에만 있다");

    // 경계 바로 앞. 몸이 다음 칸으로 넘어가 있다
    BodySpanAxis(6 * TILE_UNITS - 10, &from, &to);
    printf("  경계 10 units 앞: %d ~ %d\n", from, to);
    Check(from == 5 && to == 6, "경계 앞에서는 몸이 두 칸에 걸친다");
    Check(JudgeAxis(6 * TILE_UNITS - 10) == 5, "그때 판정은 아직 앞 칸이다");

    // 경계를 막 넘었다. 판정은 넘어갔지만 몸은 아직 뒤에 남아 있다
    BodySpanAxis(6 * TILE_UNITS + 10, &from, &to);
    printf("  경계 10 units 뒤: %d ~ %d\n", from, to);
    Check(from == 5 && to == 6, "넘어간 직후에도 몸은 두 칸에 걸친다");
    Check(JudgeAxis(6 * TILE_UNITS + 10) == 6, "그때 판정은 이미 뒤 칸이다");

    // 몸이 걸치는 구간이 얼마나 되나. 여기가 걸치기를 노릴 수 있는 폭이다
    int span = 0;
    for (int in = 0; in < TILE_UNITS; ++in) {
        BodySpanAxis(5 * TILE_UNITS + in, &from, &to);
        if (from != to) ++span;
    }
    printf("  한 칸 %d units 중 %d units 에서 두 칸에 걸친다 (%d%%)\n",
           TILE_UNITS, span, span * 100 / TILE_UNITS);
    Check(span > TILE_UNITS / 4, "걸칠 수 있는 폭이 노릴 만하다");
}

// ── 시험 3 : 걸어가는 동안 걸친 시간이 얼마나 되나 ───────────
static void Test2_Straddle()
{
    printf("\n=== 시험 3: 오른쪽으로 걸어가며 걸치기 구간 보기 ===\n");

    GameMap m;
    MakeOpenMap(m);

    Player p = MakePlayer(3, 5);
    p.dir_x = 1;

    printf("  틱  위치     판정 칸   몸이 걸친 칸   걸침\n");

    int straddle_ticks = 0;

    for (int t = 1; t <= 22; ++t) {
        MovePlayer(m, p);

        int from, to;
        BodySpanAxis(p.px, &from, &to);
        bool straddling = (from != to);
        if (straddling) ++straddle_ticks;

        printf("  %2d  %5d    %2d        %2d ~ %2d        %s\n",
               t, p.px, p.judge_tx, from, to, straddling ? "<-- 걸침" : "");
    }

    printf("\n  걸친 채로 지나간 틱: %d / 22\n", straddle_ticks);

    // 걸치기가 없으면 그냥 격자 게임이 된다. 이 게임의 핵심이 사라진다
    Check(straddle_ticks >= 3, "걸치기 구간이 최소 3틱은 된다 (한 틱이면 노릴 수 없다)");
    Check(straddle_ticks < 22, "늘 걸쳐 있지는 않다 (그러면 걸치기가 특별하지 않다)");
}

// ── 시험 3 : 벽을 뚫지 않는가 ────────────────────────────────
static void Test3_Wall()
{
    printf("\n=== 시험 4: 벽에 부딪히기 ===\n");

    GameMap m;
    MakeOpenMap(m);

    // 벽 **기둥 하나**만 두면 이제 코너 보정이 돌아가게 해준다 (9/1 변경).
    // 여기서 재려는 건 "안 뚫고 지나가나" 니까 돌아갈 데가 없어야 한다.
    // 세로로 통째로 막는다
    for (int y = 1; y < MAP_H - 1; ++y) {
        m.tile[y][8] = TILE_WALL;
    }

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
    Check(p.judge_tx == 7, "벽 앞에 오래 서 있으면 판정도 따라온다");

    // 9/1 부터는 **몸이** 벽에 안 닿는다. 중심이 아니라 몸 끝이 기준이다.
    // 전에는 중심이 타일 끝(8*256-1)까지 가서 몸이 벽에 0.4칸 파묻혔다
    printf("  몸 오른쪽 끝 %d, 벽이 시작하는 자리 %d\n",
           p.px + PLAYER_HALF, 8 * TILE_UNITS);
    Check(p.px + PLAYER_HALF < 8 * TILE_UNITS, "몸이 벽 칸에 한 점도 안 들어간다");
}

// ── 시험 4 : 벽을 타고 미끄러지나 ────────────────────────────
static void Test4_Slide()
{
    printf("\n=== 시험 5: 벽에 비스듬히 부딪히기 ===\n");

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
    printf("\n=== 시험 6: 속도 ===\n");

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
    printf("\n=== 시험 7: 같은 씨앗이면 같은 맵 ===\n");

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

// ── 시험 7 : 모서리에 걸렸을 때 서버가 돌게 도와주나 ─────────
// ── 시험 8 : 벽에 닿으면 서는가 ──────────────────────────────
//
// 9/1 에 코너 보정을 껐다. 원래는 모서리에서 옆으로 밀어줬는데,
// 돌려보니 **벽에 조금만 비벼도 대각선으로 스윽 미끄러졌다.**
// 이 게임은 물풍선을 어느 칸에 놓을지가 판단의 전부라, 서고 싶은 데 못 서면 무너진다.
//
// 그래서 여기서 재는 것이 뒤집혔다. "잘 돌아지나" 가 아니라 **"안 밀리나"** 다.
static void Test7_NoSlide()
{
    printf("\n=== 시험 8: 벽에 닿으면 선다 ===\n");

    GameMap m;
    MakeOpenMap(m);
    for (int y = 1; y < MAP_H - 1; ++y) {
        m.tile[y][8] = TILE_WALL;
    }
    m.tile[6][8] = TILE_EMPTY;   // (8,6) 한 칸만 통로

    Player p = MakePlayer(3, 5);
    p.py    = 5 * TILE_UNITS + (TILE_UNITS - 30);   // 6번 줄 경계에 바짝 붙어 있다
    p.dir_x = 1;
    p.dir_y = 0;                                    // 아래는 안 누른다

    int start_y = p.py;
    bool passed = false;
    for (int t = 0; t < 120; ++t) {
        MovePlayer(m, p);
        if (p.px / TILE_UNITS > 8) { passed = true; break; }
    }

    printf("  세로 %d -> %d, 가로 타일 %d\n", start_y, p.py, p.px / TILE_UNITS);

    Check(!passed, "옆을 안 눌렀으면 통로를 못 지난다 (안 밀어준다)");
    Check(p.px + PLAYER_HALF < 8 * TILE_UNITS, "벽 앞에서 몸이 닿는 데까지만 간다");

    // 막힌 방향을 누르고 있으면 **한 점도 안 움직여야 한다.**
    //
    // 줄 맞춤은 "좁은 데로 들어가려 할 때" 만 일한다.
    // 가려는 칸 자체가 벽이면 맞춰봐야 못 지나가므로 아무것도 안 한다.
    // 못 가는 방향을 누르고 있는데 몸이 옆으로 흐르면 그건 조작이 아니라 미끄러짐이다
    // **벽에 닿고 나서** 한 점도 안 움직여야 한다.
    //
    // 벽에 닿기 전까지는 줄 가운데로 당겨진다. 그건 맞는 동작이다 —
    // 한 축으로 걷는 동안 줄에 맞춰주지 않으면 기둥을 지날 때마다 들썩인다.
    // 여기서 보는 것은 **막힌 뒤에도 계속 흐르나** 다.
    // 못 가는 방향을 누르고 있는데 몸이 흐르면 그건 조작이 아니라 미끄러짐이다
    printf("  벽에 닿기까지 세로 %d -> %d (줄 가운데로 붙었다)\n", start_y, p.py);

    int stuck_y = p.py;
    for (int t = 0; t < 60; ++t) MovePlayer(m, p);
    printf("  벽에 닿은 뒤 60틱 더: 세로 %d -> %d\n", stuck_y, p.py);
    Check(p.py == stuck_y, "막힌 뒤에는 옆으로 한 점도 안 밀린다");

    // **걷는 동안 옆으로 안 밀린다.** 9/2 에 들어온 신고 그대로다.
    //
    // 몸이 통로에 이미 들어가는 자리(가운데에서 25 안쪽)면 줄 맞춤은 아무 일도 하면 안 된다.
    // 전에는 통로가 좁기만 하면 매 틱 가운데로 당겼는데, 상자를 100%로 채운 판은
    // 거의 모든 칸이 좁아서 사실상 늘 켜져 있었다. 그래서 좌우로 걸으면 위아래로,
    // 위아래로 걸으면 좌우로 밀렸다. **도와주는 것과 조종을 뺏는 것은 다르다.**
    {
        GameMap om;
        MakeOpenMap(om);
        for (int gy = 0; gy < MAP_H; ++gy)
            for (int gx = 0; gx < MAP_W; ++gx)
                if (gy != 6 && gx > 0 && gx < MAP_W - 1 && gy > 0 && gy < MAP_H - 1)
                    om.tile[gy][gx] = TILE_BLOCK;   // 6번 줄만 남긴 좁은 통로

        int worst = 0;
        for (int off = -25; off <= 25; off += 5) {
            Player w = MakePlayer(2, 6);
            w.py     = 6 * TILE_UNITS + TILE_UNITS / 2 + off;
            int y0   = w.py;

            w.dir_x = 1; w.dir_y = 0;
            for (int t = 0; t < 40; ++t) MovePlayer(om, w);

            int drift = w.py - y0;
            if (drift < 0) drift = -drift;
            if (drift > worst) worst = drift;
        }
        // 줄에 붙고 나면 **멈춘다.** 얼마나 당겨졌나가 아니라
        // 다 당겨진 다음에도 계속 움직이나를 본다.
        // 계속 움직이면 그건 맞춰주는 게 아니라 흔드는 것이다
        printf("  좁은 통로를 40틱 걸었을 때 세로로 움직인 최대량 %d\n", worst);

        int still = 0;
        for (int off = -25; off <= 25; off += 5) {
            Player w = MakePlayer(2, 6);
            w.py     = 6 * TILE_UNITS + TILE_UNITS / 2 + off;
            w.dir_x = 1; w.dir_y = 0;

            for (int t = 0; t < 20; ++t) MovePlayer(om, w);   // 붙을 시간을 준다
            int settled = w.py;
            for (int t = 0; t < 20; ++t) MovePlayer(om, w);
            if (w.py != settled) ++still;
        }
        printf("  붙고 나서도 계속 움직인 경우 %d / 11\n", still);
        Check(still == 0, "줄에 붙고 나면 옆으로 안 움직인다");

        // 도움을 없앤 게 아니라 조건을 좁힌 것이다. 정말 안 들어갈 때는 여전히 맞춰준다
        Player w2 = MakePlayer(2, 6);
        w2.py     = 6 * TILE_UNITS + TILE_UNITS / 2 + 95;
        w2.dir_x = 1; w2.dir_y = 0;
        for (int t = 0; t < 60; ++t) MovePlayer(om, w2);
        printf("  치우쳐 있으면 맞춰줘서 가로 타일 %d 까지\n", w2.px / TILE_UNITS);
        Check(w2.px / TILE_UNITS > 4, "안 들어가는 자리면 맞춰준다");
    }

    // 도와주지 않을 뿐이지 막는 게 아니다.
    //
    // 벽 앞까지 오른쪽으로 간 다음, 아래를 눌러 통로 줄에 맞추고, 다시 오른쪽.
    // 사람이 실제로 하는 순서 그대로다. **맞추는 일을 사람이 한다**는 게 이 변경의 요지다
    Player q = MakePlayer(3, 5);
    q.py    = 5 * TILE_UNITS + (TILE_UNITS - 30);

    q.dir_x = 1; q.dir_y = 0;
    for (int t = 0; t < 80; ++t) MovePlayer(m, q);      // 벽 앞까지

    q.dir_x = 0; q.dir_y = 1;
    for (int t = 0; t < 12; ++t) MovePlayer(m, q);      // 통로 줄로 내려간다

    q.dir_x = 1; q.dir_y = 0;
    bool passed2 = false;
    for (int t = 0; t < 120; ++t) {
        MovePlayer(m, q);
        if (q.px / TILE_UNITS > 8) { passed2 = true; break; }
    }
    printf("  맞추고 나서 가로 타일 %d, 세로 타일 %d\n", q.px / TILE_UNITS, q.py / TILE_UNITS);
    Check(passed2, "본인이 줄을 맞추면 통로를 지난다");

    // 위아래가 다 막힌 통로 안에서도 옆으로 안 밀린다
    GameMap m4;
    MakeOpenMap(m4);
    for (int x = 1; x < MAP_W - 1; ++x) {
        m4.tile[4][x] = TILE_WALL;
        m4.tile[6][x] = TILE_WALL;
    }
    m4.tile[5][10] = TILE_WALL;

    Player u = MakePlayer(3, 5);
    u.dir_x = 1;
    int uy = u.py;
    for (int t = 0; t < 60; ++t) MovePlayer(m4, u);

    printf("  막힌 통로에서 세로 %d -> %d\n", uy, u.py);
    Check(u.py == uy, "위아래가 다 막히면 옆으로 안 밀린다");
    Check(u.px + PLAYER_HALF < 10 * TILE_UNITS, "통로 끝에서도 몸이 벽에 안 닿는다");
}

// ── 시험 9 : 몸이 벽 칸에 한 점도 안 들어가는가 ──────────────
//
// 이게 이 파일에서 제일 중요한 시험이다.
//
// 중심이 있는 칸만 보면 **대각선이 빈다.** 오른쪽으로 가는데 몸이 위아래 두 줄에
// 걸쳐 있으면, 들어가려는 칸 위쪽이 벽일 때 그 벽에 몸 귀퉁이가 박힌다.
// 처음 만들었을 때 6000틱 중 1775틱이 그랬다. 눈으로는 "벽에 파묻힌 채로 다닌다".
//
// 그래서 사방으로 오래 돌아다니면서 **한 틱이라도 겹치면 잡는다.**
static void Test8_NeverInsideWall()
{
    printf("\n=== 시험 9: 몸이 벽에 안 들어간다 ===\n");

    static const int RX[4] = { 1, 0, -1, 0 };
    static const int RY[4] = { 0, 1, 0, -1 };

    GameMap m;
    MakeOpenMap(m);
    for (int y = 2; y < MAP_H - 1; y += 2) {
        for (int x = 2; x < MAP_W - 1; x += 2) {
            m.tile[y][x] = TILE_WALL;   // 봄버맨 격자
        }
    }

    for (int mode = 0; mode < 2; ++mode) {
        Player p = MakePlayer(3, 3);
        p.trap_ticks = mode ? 1000000 : 0;   // 갇힌 상태로도 똑같이 확인한다

        int overlap = 0, inside = 0;

        for (int t = 0; t < 6000; ++t) {
            int d = (t / 37) % 4;
            p.dir_x = RX[d];
            p.dir_y = RY[d];
            MovePlayer(m, p);

            if (m.IsSolid(p.px / TILE_UNITS, p.py / TILE_UNITS)) ++inside;

            int x0, x1, y0, y1;
            BodySpanAxis(p.px, &x0, &x1);
            BodySpanAxis(p.py, &y0, &y1);
            for (int y = y0; y <= y1; ++y) {
                for (int x = x0; x <= x1; ++x) {
                    if (m.tile[y][x] == TILE_WALL) ++overlap;
                }
            }
        }

        printf("  %s: 몸이 겹친 틱 %d, 중심이 벽 안인 틱 %d\n",
               mode ? "갇힘  " : "안 갇힘", overlap, inside);
        Check(overlap == 0, mode ? "갇혀서도 몸이 벽에 안 들어간다"
                                 : "돌아다녀도 몸이 벽에 안 들어간다");
        Check(inside == 0,  mode ? "갇혀서도 벽을 안 통과한다"
                                 : "벽을 안 통과한다");
    }
}

// ── 시험 10 : 진짜 판에서 옆으로 밀리나 ──────────────────────
//
// 앞의 시험들은 손으로 만든 통로에서 잰다. 그런데 신고는 **진짜 판에서**
// 밀린다는 것이었다. 손으로 만든 판은 내가 예상한 모양만 담고 있어서,
// 예상 못 한 모양에서 나는 문제를 못 잡는다.
//
// 판을 스무 개 만들고, 빈 칸마다 사람을 세워서 네 방향으로 걸어본다.
// 한 방향만 누르는 동안 **다른 축이 한 점이라도 움직이면** 그게 밀린 것이다.
//
// 처음엔 늘 칸 한가운데에서 출발시켰다. 그래서 0 번이 나왔고 다 고친 줄 알았다.
// **사람은 한가운데에 서 있지 않는다.** 아래로 걷다 오른쪽으로 꺾으면
// 꺾은 그 자리에 서 있고, 그 자리는 대개 치우쳐 있다.
// 옆으로 치우친 자리에서도 걸어봐야 신고받은 그 느낌이 재현된다
static void Test10_NoDriftOnRealMaps()
{
    printf("\n=== 시험 10: 진짜 판에서 옆으로 안 밀린다 ===\n");

    const int DX[4] = { 1, -1, 0, 0 };
    const int DY[4] = { 0, 0, 1, -1 };

    long long tried = 0, drifted = 0;
    int worst = 0, worst_x = 0, worst_y = 0, worst_d = 0;

    // **총량보다 이게 중요하다.**
    //
    // 한 방향으로 쭉 당겨져서 줄에 맞는 것은 손에 '도와줬다' 로 느껴진다.
    // 당기다 멈추고 또 당기는 것이 '밀린다' 로 느껴진다.
    // 걷다가 기둥을 지날 때마다 켜졌다 꺼지면 그게 딱 그 느낌이다.
    //
    //   episodes  안 움직이다가 다시 움직이기 시작한 횟수
    //   flips     옆으로 가던 쪽이 반대로 뒤집힌 횟수
    long long episodes = 0, flips = 0;

    // **트인 데와 좁은 데를 갈라서 센다.**
    //
    // 전에는 한 덩어리로 셌다. 그래서 "밀린 횟수" 를 0 으로 만들려다 좁은 데서
    // 줄을 맞춰주는 것까지 같이 껐고, 그러면 통로를 못 지나간다.
    //
    // 트인 데에서 밀리는 것은 무조건 틀린 것이다 - 도와줄 게 없는데 손을 댄 것이다.
    // 좁은 데에서 밀리는 것은 도와주는 것이다. 그건 세되 막지 않는다
    long long open_tried = 0, open_drift = 0;

    for (int seed = 1; seed <= 20; ++seed) {
        GameMap m{};
        m.Generate((uint32_t)seed);

        for (int ty = 1; ty < MAP_H - 1; ++ty) {
            for (int tx = 1; tx < MAP_W - 1; ++tx) {
                if (m.tile[ty][tx] != TILE_EMPTY) continue;

                for (int d = 0; d < 4; ++d) {
                for (int off = -90; off <= 90; off += 30) {
                    Player p = MakePlayer(tx, ty);
                    p.dir_x = DX[d];
                    p.dir_y = DY[d];
                    if (DX[d] != 0) p.py += off; else p.px += off;
                    p.judge_tx = JudgeAxis(p.px);
                    p.judge_ty = JudgeAxis(p.py);

                    // 스무 틱이면 360 units = 1.4칸을 간다. 그러니 한 칸만 봐서는
                    // 안 된다 - 두 칸 앞 기둥에 걸려 당겨지는 것을 트인 데로 세게 된다.
                    // **걸어갈 거리만큼** 앞을 보고, 옆으로도 세 줄을 본다
                    const int LOOK = 3;
                    bool wide = true;
                    // a=0 (지금 서 있는 칸의 옆줄)도 본다. 몸이 0.8칸이라
                    // 치우쳐 서면 옆줄에 걸치는데, 거기가 벽이면 ClampAxis 가
                    // 몸을 빼내면서 옆으로 민다. 그것도 밀리는 것이다
                    for (int a = 0; a <= LOOK && wide; ++a) {
                        for (int k = -1; k <= 1; ++k) {
                            int ax = tx + DX[d] * a + (DX[d] != 0 ? 0 : k);
                            int ay = ty + DY[d] * a + (DY[d] != 0 ? 0 : k);
                            if (ax < 0 || ay < 0 || ax >= MAP_W || ay >= MAP_H
                                || m.tile[ay][ax] != TILE_EMPTY) { wide = false; break; }
                        }
                    }

                    int side0 = (DX[d] != 0) ? p.py : p.px;

                    int prev = side0, last_dir = 0;
                    bool was_moving = false;
                    for (int t = 0; t < 20; ++t) {
                        MovePlayer(m, p);
                        int cur = (DX[d] != 0) ? p.py : p.px;
                        int dd  = cur - prev;
                        prev = cur;

                        bool moving = (dd != 0);
                        if (moving && !was_moving && t > 0) ++episodes;
                        was_moving = moving;

                        if (dd != 0) {
                            int dir = dd > 0 ? 1 : -1;
                            if (last_dir != 0 && dir != last_dir) ++flips;
                            last_dir = dir;
                        }
                    }

                    int side1 = (DX[d] != 0) ? p.py : p.px;
                    int drift = side1 - side0;
                    if (drift < 0) drift = -drift;

                    if (wide) {
                        ++open_tried;
                        if (drift > 0) ++open_drift;
                    }

                    ++tried;
                    if (drift > 0) {
                        ++drifted;
                        if (drift > worst) {
                            worst = drift; worst_x = tx; worst_y = ty; worst_d = d;
                        }
                    }
                }
                }
            }
        }
    }

    printf("  판 20개 x 빈 칸 x 네 방향 x 치우침 일곱 = %lld 번 걸어봤다\n", tried);
    printf("  옆으로 밀린 경우 %lld 번 (%lld%%),  제일 많이 밀린 양 %d units\n",
           drifted, tried ? drifted * 100 / tried : 0, worst);
    if (worst > 0) {
        printf("  제일 심한 자리 (%d,%d) 방향 %d\n", worst_x, worst_y, worst_d);
    }

    // 한 점도 안 밀려야 한다. '조금 밀린다' 는 없다 —
    // 사람은 캐릭터가 자기 손과 다르게 움직이는 걸 아주 작아도 알아챈다
    // 얼마나 밀렸나가 아니라 **몇 번 밀렸나**를 본다.
    // 한 번이라도 밀리면 사람은 그 한 번을 기억한다
    printf("  끊겼다 다시 밀린 횟수 %lld,  방향이 뒤집힌 횟수 %lld\n", episodes, flips);
    printf("  트인 데에서 %lld 번 걸어서 %lld 번 밀렸다\n", open_tried, open_drift);

    // **트인 데에서는 한 점도 안 밀려야 한다.**
    //
    // 좁은 데에서 줄을 맞춰주는 것은 도움이고 있어야 한다. 몸이 0.8칸이라
    // 안 도와주면 통로를 못 지나간다.
    //
    // 그런데 도와줄 게 없는데 손을 대면 그건 도움이 아니라 조작을 뺏는 것이다.
    // 걸치기를 하려고 일부러 치우쳐 선 사람을 서버가 도로 끌어오면 안 된다 -
    // 이 게임의 정체성이 걸치기인데 그걸 서버가 방해하는 셈이 된다
    Check(open_drift == 0, "트인 데에서는 한 점도 안 밀린다");
    Check(flips == 0, "당기는 쪽이 도중에 안 뒤집힌다");
}
// ── 시험 11 : 누른 대로 누른 만큼 가나 ───────────────────────
//
// "캐릭터가 내 마음대로 안 움직인다, 아무것도 없는데 어디선가 밀린다" 는
// 신고가 들어왔다. 시험 10 은 **옆으로** 밀리는지만 봤다.
// 여기서는 **누른 축으로 정확히 그만큼 가나**를 본다.
//
// 세 가지를 본다.
//   ① 탁 트인 데서 스무 틱을 걸으면 정확히 speed x 20 만큼 간다
//   ② 벽에 막히면 벽에 딱 붙어 서고, 거기서 더 안 떨거나 뒤로 안 간다
//   ③ 같은 자리에서 같은 키를 누르면 늘 같은 자리로 간다 (재현성)
//
// ③ 이 있는 이유는 화면이 서버 답을 미리 그리기 때문이다. 서버가 같은 입력에
// 다른 답을 내면 예측이 맞을 수가 없고, 그게 곧 "화면이 뒤로 튄다" 가 된다
static void Test11_ExactSteps()
{
    printf("\n=== 시험 11: 누른 대로 누른 만큼 가나 ===\n");

    const int DX[4] = { 1, -1, 0, 0 };
    const int DY[4] = { 0, 0, 1, -1 };
    const int TICKS = 20;
    const int speed = MOVE_SPEED_BASE;   // 롤러를 안 먹은 기본 속도

    long long open_tried = 0, open_bad = 0;
    long long wall_tried = 0, wall_bad = 0;
    long long back_step = 0;             // 누른 반대쪽으로 간 횟수
    long long repeat_bad = 0;
    int worst_short = 0;

    for (int seed = 1; seed <= 12; ++seed) {
        GameMap m{};
        m.Generate((uint32_t)seed);

        for (int ty = 1; ty < MAP_H - 1; ++ty) {
            for (int tx = 1; tx < MAP_W - 1; ++tx) {
                if (m.tile[ty][tx] != TILE_EMPTY) continue;

                for (int d = 0; d < 4; ++d) {
                    Player p = MakePlayer(tx, ty);
                    p.dir_x = DX[d];
                    p.dir_y = DY[d];

                    int start = (DX[d] != 0) ? p.px : p.py;
                    int prev  = start;
                    bool blocked = false;

                    for (int t = 0; t < TICKS; ++t) {
                        MovePlayer(m, p);
                        int cur = (DX[d] != 0) ? p.px : p.py;
                        int step = cur - prev;

                        // 누른 반대쪽으로 가면 그건 무조건 틀린 것이다
                        int want = (DX[d] != 0) ? DX[d] : DY[d];
                        if (step != 0 && ((step > 0) != (want > 0))) ++back_step;

                        // 한 틱에 speed 보다 많이 가면 그것도 틀린 것이다
                        if (step > speed || step < -speed) ++back_step;

                        if (step == 0) blocked = true;
                        prev = cur;
                    }

                    int went = prev - start;
                    if (went < 0) went = -went;

                    if (!blocked) {
                        // 탁 트였다. 정확히 speed x TICKS 여야 한다
                        ++open_tried;
                        if (went != speed * TICKS) {
                            ++open_bad;
                            int miss = speed * TICKS - went;
                            if (miss < 0) miss = -miss;
                            if (miss > worst_short) worst_short = miss;
                        }
                    } else {
                        // 막혔다. 몸이 벽 안에 들어가 있으면 안 된다
                        ++wall_tried;
                        int bx = p.px, by = p.py;
                        int t0 = JudgeAxis(bx - PLAYER_HALF), t1 = JudgeAxis(bx + PLAYER_HALF);
                        int u0 = JudgeAxis(by - PLAYER_HALF), u1 = JudgeAxis(by + PLAYER_HALF);
                        for (int yy = u0; yy <= u1; ++yy) {
                            for (int xx = t0; xx <= t1; ++xx) {
                                if (xx < 0 || yy < 0 || xx >= MAP_W || yy >= MAP_H) continue;
                                if (m.tile[yy][xx] != TILE_EMPTY) ++wall_bad;
                            }
                        }
                    }

                    // 같은 입력이면 같은 답. 한 번 더 돌려서 견준다
                    Player q = MakePlayer(tx, ty);
                    q.dir_x = DX[d];
                    q.dir_y = DY[d];
                    for (int t = 0; t < TICKS; ++t) MovePlayer(m, q);
                    if (q.px != p.px || q.py != p.py) ++repeat_bad;
                }
            }
        }
    }

    printf("  탁 트인 데 %lld 번,  막힌 데 %lld 번\n", open_tried, wall_tried);
    printf("  스무 틱에 %d units 를 못 간 경우 %lld 번 (제일 모자란 양 %d)\n",
           speed * TICKS, open_bad, worst_short);
    printf("  누른 반대쪽으로 가거나 한 틱에 %d 를 넘긴 횟수 %lld\n", speed, back_step);
    printf("  같은 입력에 다른 답이 나온 횟수 %lld\n", repeat_bad);

    Check(open_bad == 0,   "안 막혔으면 누른 만큼 정확히 간다");
    Check(back_step == 0,  "누른 반대쪽으로 가지 않고 한 틱 한도도 안 넘는다");
    Check(wall_bad == 0,   "막혔을 때 몸이 벽 안에 들어가 있지 않다");
    Check(repeat_bad == 0, "같은 자리에서 같은 키를 누르면 늘 같은 자리로 간다");
}

int main(int argc, char** argv)
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    Test1_Judge();
    Test1b_BodySpan();
    Test2_Straddle();
    Test3_Wall();
    Test4_Slide();
    Test5_Speed();
    Test6_MapDeterminism();
    Test7_NoSlide();
    Test8_NeverInsideWall();
    Test10_NoDriftOnRealMaps();
    Test11_ExactSteps();

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
