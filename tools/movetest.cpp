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

    // **줄이 안 바뀌는 것**이 규칙이다. 자리가 아니라 줄이다.
    //
    // 줄 맞춤이 내 칸 한가운데로 당기므로 세로 값 자체는 움직인다.
    // 그건 미끄러진 게 아니라 제자리를 잡은 것이다.
    // 미끄러졌다는 건 **다른 줄로 넘어갔다**는 뜻이고, 그건 절대 안 된다
    printf("  줄 %d -> %d, 칸 안 위치 %d -> %d (한가운데가 %d)\n",
           start_y / TILE_UNITS, p.py / TILE_UNITS,
           start_y % TILE_UNITS, p.py % TILE_UNITS, TILE_UNITS / 2);
    Check(p.py / TILE_UNITS == start_y / TILE_UNITS, "다른 줄로 안 넘어간다");
    Check(p.py % TILE_UNITS == TILE_UNITS / 2, "내 줄 한가운데로 맞춰진다");

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
