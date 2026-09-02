// tools/bubbletest.cpp — 물풍선 규칙을 서버 없이 시험한다
//
// 소켓을 안 쓴다. 게임 규칙만 꺼내서 두들긴다.
// 여기서 통과해야 서버에 올린다.
//
// 컴파일: practice 폴더에서  build.bat ..\tools\bubbletest.cpp
// 실행  : practice\bin\bubbletest.exe
#include <cstdio>
#include "../Server/src/GameTick.h"

static int g_pass = 0;
static int g_fail = 0;

static void Check(bool ok, const char* what)
{
    if (ok) { ++g_pass; printf("  [PASS] %s\n", what); }
    else    { ++g_fail; printf("  [FAIL] %s\n", what); }
}

// ── 판 만들기 ────────────────────────────────────────────────

static int g_fake_id = 0;

// 세션 포인터는 "빈 자리인가" 를 보는 데만 쓰인다. 게임 규칙은 안을 안 본다
// 시험용 가짜 손님.
//
// 전에는 (Session*)1, (Session*)2 처럼 **주소를 지어내서** 넘겼다.
// 소켓을 안 쓰니 포인터가 서로 다르기만 하면 됐기 때문이다.
//
// 9/2 에 그게 터졌다. AddPlayer 가 자리 번호를 Session 에 적게 바뀌면서
// 주소 1 에 쓰기가 됐다. 접근 위반이다. 시험이 시험 대상보다 먼저 죽었다.
//
// 지어낸 포인터는 '지금은 안 만지니까 괜찮다' 에 기대는 것이고,
// 그 전제는 남이 코드를 고치는 순간 깨진다. 진짜 객체를 준다
static Session g_fake_sessions[PLAYER_MAX];

static Session* NextFakeSession()
{
    if (g_fake_id >= PLAYER_MAX) return nullptr;
    Session* s = &g_fake_sessions[g_fake_id++];
    s->slot = -1;
    return s;
}

// 테두리만 벽인 빈 판으로 갈아끼운다. 시험은 조건을 손으로 잡아야 한다
static void OpenBoard()
{
    InitGame(777);
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
    if (slot < 0) {
        return -1;
    }

    Player& p = g_game.players[slot];
    p.alive    = true;   // 진행 중에 들어오면 관전이 되므로 여기서 되돌린다
    p.px       = TileCenter(tx);
    p.py       = TileCenter(ty);
    p.judge_tx = tx;
    p.judge_ty = ty;
    return slot;
}

// 서버의 틱 루프와 같은 순서다. 내보낸 뒤 비우므로, 여기서는 돌기 전에 비운다
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

static int EventValue(uint8_t type)
{
    for (int i = 0; i < g_game.event_count; ++i) {
        if (g_game.events[i].type == type) return g_game.events[i].value;
    }
    return -1;
}

// ── 시험 1 : 퓨즈가 상수대로 도는가 ──────────────────────────
static void Test1_Fuse()
{
    printf("\n=== 시험 1: 퓨즈 ===\n");

    OpenBoard();
    int me = Join(10, 10);
    PlaceBubble(me);

    Check(g_game.map.tile[10][10] == TILE_BUBBLE, "놓는 순간 그 칸이 막힌다");

    int boom = -1;
    for (int t = 1; t <= BUBBLE_FUSE_TICKS + 10; ++t) {
        Tick();
        if (g_game.blast[10][10] > 0 && boom < 0) {
            boom = t;
        }
    }

    printf("  %d 틱째에 터졌다 (상수 %d, %d.%d초)\n",
           boom, BUBBLE_FUSE_TICKS,
           BUBBLE_FUSE_TICKS / TICK_RATE, (BUBBLE_FUSE_TICKS * 10 / TICK_RATE) % 10);

    Check(boom == BUBBLE_FUSE_TICKS, "상수대로 터진다");
    Check(g_game.map.tile[10][10] == TILE_EMPTY, "터지면 칸이 다시 열린다");
}

// ── 시험 2 : 십자로 뻗고 제때 멈추는가 ───────────────────────
static void Test2_Cross()
{
    printf("\n=== 시험 2: 십자 폭발 ===\n");

    OpenBoard();
    g_game.map.tile[10][13] = TILE_WALL;    // 오른쪽 세 칸 앞에 고정 벽
    g_game.map.tile[7][10]  = TILE_BLOCK;   // 위쪽 세 칸 앞에 블록

    // 사거리를 숫자로 박아두지 않는다.
    // BLAST_BASE_RANGE 를 2 에서 1 로 낮췄을 때 이 시험이 통째로 깨졌다.
    // 시험이 상수를 다시 적어두면, 상수를 고칠 때마다 시험이 거짓말을 한다
    const int RANGE = BLAST_BASE_RANGE + 2;

    int me = Join(10, 10);
    g_game.players[me].power_lv = 2;
    PlaceBubble(me);

    for (int t = 0; t < BUBBLE_FUSE_TICKS; ++t) {
        Tick();
    }

    printf("  오른쪽: 11 %d  12 %d  13(벽) %d\n",
           g_game.blast[10][11] > 0, g_game.blast[10][12] > 0, g_game.blast[10][13] > 0);
    printf("  위쪽  : 9 %d  8 %d  7(블록) %d  6 %d\n",
           g_game.blast[9][10] > 0, g_game.blast[8][10] > 0,
           g_game.blast[7][10] > 0, g_game.blast[6][10] > 0);

    Check(g_game.blast[10][11] > 0 && g_game.blast[10][12] > 0, "빈 칸으로는 뻗는다");
    Check(g_game.blast[10][13] == 0, "고정 벽은 안 덮는다");
    Check(g_game.blast[10][14] == 0, "고정 벽 너머로 안 샌다");

    Check(g_game.blast[7][10] > 0, "블록 칸은 덮는다");
    Check(g_game.map.tile[7][10] != TILE_BLOCK, "블록이 부서졌다");
    Check(g_game.blast[6][10] == 0, "블록에서 멈춘다");

    printf("  왼쪽  : 사거리 %d 이므로 %d 까지만\n", RANGE, 10 - RANGE);
    Check(g_game.blast[10][10 - RANGE] > 0 && g_game.blast[10][10 - RANGE - 1] == 0,
          "왼쪽은 사거리만큼만 간다");
}

// ── 시험 3 : 연쇄가 한 틱에 다 터지지 않는가 ─────────────────
static void Test3_ChainDelay()
{
    printf("\n=== 시험 3: 연쇄 지연 ===\n");

    // ① 늦게 놓은 것이 앞의 폭발에 걸려 터지는 경우
    OpenBoard();
    // 두 번째 물풍선을 **사거리가 정확히 닿는 자리**에 놓는다.
    // 12 라고 박아뒀더니 사거리를 1 로 낮추는 순간 안 닿아서 연쇄가 아예 안 났다
    const int REACH = BLAST_BASE_RANGE;

    int a = Join(10, 10);
    int b = Join(10 + REACH, 10);

    PlaceBubble(a);                       // (10,10)
    for (int t = 0; t < 20; ++t) Tick();  // 20틱 뒤에
    PlaceBubble(b);                       // (12,10)

    int first = -1, second = -1, chain_step = -1;

    for (int t = 1; t <= BUBBLE_FUSE_TICKS + 30; ++t) {
        Tick();

        if (first < 0 && g_game.blast[10][10] > 0) {
            first = t;
        }
        if (CountEvent(EVT_CHAIN) > 0 && second < 0) {
            second     = t;
            chain_step = EventValue(EVT_CHAIN);
        }
    }

    printf("  늦게 놓은 것: 첫 폭발 %d 틱, 연쇄 %d 틱, 간격 %d 틱 (%d ms)\n",
           first, second, second - first, (second - first) * 1000 / TICK_RATE);

    Check(second > first, "연쇄가 같은 틱에 안 터진다");
    Check(second - first == CHAIN_STEP_TICKS, "간격이 CHAIN_STEP_TICKS 와 같다");
    Check(chain_step == 1, "연쇄 단계가 1 로 붙었다");

    // ② 같이 놓은 둘. 원래는 같은 틱에 같이 터진다.
    //    그러면 큰 폭발 하나로 보여서 연쇄인 줄 모른다. 이쪽도 늦춰야 한다
    OpenBoard();
    int c = Join(10, 10);
    int d = Join(10 + REACH, 10);

    PlaceBubble(c);
    PlaceBubble(d);

    int f2 = -1, s2 = -1;
    for (int t = 1; t <= BUBBLE_FUSE_TICKS + 30; ++t) {
        Tick();
        if (f2 < 0 && g_game.blast[10][10] > 0) f2 = t;
        if (s2 < 0 && CountEvent(EVT_CHAIN) > 0) s2 = t;
    }

    printf("  같이 놓은 둘: 첫 폭발 %d 틱, 연쇄 %d 틱, 간격 %d 틱\n", f2, s2, s2 - f2);
    Check(s2 - f2 == CHAIN_STEP_TICKS, "같이 놓은 둘도 계단식으로 터진다");

    // ③ 셋을 늘어놓으면 단계가 1, 2 로 깊어져야 한다. CHAIN x3 이 이 숫자다
    OpenBoard();
    int e = Join(10, 10);
    g_game.players[e].bubble_lv = 4;

    // 시차를 두고 놓는다. 같이 놓으면 셋 다 제 퓨즈로 터져서 연쇄가 안 깊어진다
    PlaceBubble(e);
    for (int t = 0; t < 20; ++t) Tick();

    g_game.players[e].judge_tx = 10 + REACH;
    g_game.players[e].px = TileCenter(10 + REACH);
    PlaceBubble(e);
    for (int t = 0; t < 20; ++t) Tick();

    g_game.players[e].judge_tx = 10 + REACH * 2;
    g_game.players[e].px = TileCenter(10 + REACH * 2);
    PlaceBubble(e);

    int deepest = 0;
    for (int t = 1; t <= BUBBLE_FUSE_TICKS + 40; ++t) {
        Tick();
        int v = EventValue(EVT_CHAIN);
        if (v > deepest) deepest = v;
    }

    printf("  셋을 늘어놓았을 때 가장 깊은 연쇄 단계: %d\n", deepest);
    Check(deepest == 2, "연쇄가 한 칸씩 깊어진다");
}

// ── 시험 4 : 걸치기로 살아남는가 ─────────────────────────────
static void Test4_Graze()
{
    printf("\n=== 시험 4: GRAZE ===\n");

    OpenBoard();
    int me = Join(10, 10);

    // 중심은 10번 칸에 두고 경계에 바짝 붙인다.
    // 몸은 11번 칸까지 걸치지만 과반수는 10번에 있다
    Player& p = g_game.players[me];
    p.px       = 11 * TILE_UNITS - 10;
    p.judge_tx = JudgeAxis(p.px);
    p.dir_x    = 0;

    int from, to;
    BodySpanAxis(p.px, &from, &to);
    printf("  중심 %d (판정 %d), 몸은 %d ~ %d 칸\n", p.px, p.judge_tx, from, to);

    Check(p.judge_tx == 10, "중심이 10번 칸에 있다");
    Check(from == 10 && to == 11, "몸은 10, 11 두 칸에 걸쳐 있다");

    // 11번 칸만 물줄기로 덮는다
    SetBlast(11, 10, 0, 42);
    Tick();

    printf("  GRAZE %d 개, TRAPPED %d 개, 갇힘 %d 틱\n",
           CountEvent(EVT_GRAZE), CountEvent(EVT_TRAP), p.trap_ticks);

    Check(CountEvent(EVT_GRAZE) == 1, "GRAZE 가 떴다");
    Check(p.trap_ticks == 0, "걸치기로 피했으니 안 갇혔다");

    // 같은 물줄기로 매 틱 GRAZE 를 띄우면 화면이 도배된다
    Tick();
    Check(CountEvent(EVT_GRAZE) == 0, "같은 물줄기로 두 번 띄우지 않는다");

    // 판정까지 넘어가면 그때는 맞아야 한다
    OpenBoard();
    int me2 = Join(10, 10);
    SetBlast(10, 10, 0, 43);
    Tick();

    Check(g_game.players[me2].trap_ticks > 0, "판정 칸이 맞으면 갇힌다");
}

// ── 시험 5 : 갇힘 5초와 스스로 탈출 ──────────────────────────
static void Test5_Trap()
{
    printf("\n=== 시험 5: 갇힘 ===\n");

    OpenBoard();
    int me = Join(10, 10);
    Player& p = g_game.players[me];

    SetBlast(10, 10, 0, 50);
    Tick();

    Check(p.trap_ticks > 0, "갇혔다");
    Check(CountEvent(EVT_TRAP) == 1, "TRAPPED 가 떴다");

    // 갇힌 동안에도 아주 느리게는 갈 수 있다.
    // 완전히 묶어두면 5초가 죽은 시간이 된다
    p.dir_x = 1;
    int before = p.px;
    Tick();
    int crawled = p.px - before;

    printf("  갇힌 채로 한 틱에 %d units (평소 %d)\n", crawled, MOVE_SPEED_BASE);
    Check(crawled > 0, "갇혀도 움직이기는 한다");
    Check(crawled == TRAP_MOVE_SPEED, "느린 속도가 상수와 같다");
    Check(crawled < MOVE_SPEED_BASE / 2, "평소의 절반보다 훨씬 느리다");

    // 느려도 물줄기 밖으로 기어나갈 수는 있어야 한다. 그게 판단거리가 된다
    int tiles = TRAP_MOVE_SPEED * TRAP_DURATION_TICKS / TILE_UNITS;
    printf("  %d초 동안 기어서 갈 수 있는 거리: 약 %d 칸\n", TRAP_DURATION_TICKS / TICK_RATE, tiles);
    Check(tiles >= 3, "갇힌 동안 세 칸은 기어갈 수 있다");

    // 물줄기로는 갇힌 사람을 더 어쩌지 못한다. 크아가 그렇다
    for (int t = 0; t < BLAST_DURATION_TICKS + 2; ++t) {
        Tick();
    }
    Check(p.alive, "갇힌 채로 물줄기 안에 있어도 안 죽는다");

    // 다른 폭발이 와도 마찬가지다. 마무리는 몸으로만 된다
    SetBlast(10, 10, 1, 99);
    Tick();
    Check(p.alive, "다른 물줄기로도 안 죽는다");

    // 5초를 버티면 스스로 나온다
    int broke = -1;
    for (int t = 0; t < TRAP_DURATION_TICKS + 10; ++t) {
        Tick();
        if (CountEvent(EVT_BREAK) > 0) {
            broke = t;
            break;   // 무적은 1초짜리라 계속 돌리면 그새 풀린다. 나온 그 순간에 본다
        }
    }

    printf("  갇힘 %d 틱(%d초) 뒤 BREAK OUT\n", TRAP_DURATION_TICKS, TRAP_DURATION_TICKS / TICK_RATE);
    Check(broke >= 0, "5초를 버티면 스스로 나온다");
    Check(p.alive && p.trap_ticks == 0, "나온 뒤에는 움직일 수 있다");
    Check(p.invuln_ticks > 0, "나온 직후는 잠깐 무적이다");
}

// ── 시험 6 : 몸으로 부딪쳐야 터진다 ──────────────────────────
// ── 시험 13 : 대쉬 ───────────────────────────────────────────
//
// 대쉬는 이 게임에서 유일하게 **한 틱에 크게 움직이는** 동작이다.
// 크게 움직이는 것은 판정을 건너뛰기 쉽다. 그래서 여기서 재는 것은
// '빠른가' 가 아니라 **'빨라도 규칙이 그대로인가'** 다.
//
//   벽을 안 뚫는다 · 물풍선에 막힌다 · 물줄기를 지나면 갇힌다 · 쿨타임이 지켜진다
static void Test13_Dash()
{
    printf("\n=== 시험 13: 대쉬 ===\n");

    OpenBoard();
    int a = Join(5, 10);
    Player& p = g_game.players[a];

    // 안 먹었으면 아무 일도 없어야 한다. 여기가 뚫리면 아이템이 의미가 없다
    StartDash(a, 1, 0);
    Check(p.dash_ticks == 0, "안 먹었으면 대쉬가 안 나간다");

    p.has_dash = true;
    int x0 = p.px;
    StartDash(a, 1, 0);
    Check(p.dash_ticks == DASH_TICKS, "먹었으면 나간다");

    for (int t = 0; t < DASH_TICKS; ++t) Tick();
    int went = (p.px - x0) * 100 / TILE_UNITS;
    printf("  탁 트인 데서 %d.%02d 칸 갔다\n", went / 100, went % 100);
    Check(went > 200, "두 칸 넘게 간다");
    Check(p.dash_ticks == 0, "정해진 틱이 지나면 멈춘다");

    // 쿨타임. 바로 또 나가면 이 아이템은 그냥 속도 아이템이다
    StartDash(a, 1, 0);
    Check(p.dash_ticks == 0, "쿨타임 중에는 안 나간다");
    printf("  남은 쿨타임 %d틱 / %d틱\n", p.dash_cd, DASH_COOLDOWN_TICKS);

    // **벽을 안 뚫는다.** 대쉬에서 제일 무서운 것이 이것이다.
    // 한 번에 96 을 옮기면 벽 너머 빈칸에 도착할 수 있어서 32 씩 쪼개 옮긴다
    {
        OpenBoard();
        int b = Join(5, 10);
        Player& q = g_game.players[b];
        q.has_dash = true;
        g_game.map.tile[10][8] = TILE_WALL;

        StartDash(b, 1, 0);
        for (int t = 0; t < DASH_TICKS + 2; ++t) Tick();

        printf("  벽이 8번 칸일 때 멈춘 칸 %d\n", q.judge_tx);
        Check(q.judge_tx < 8, "벽을 안 뚫는다");
        Check(q.px + PLAYER_HALF <= 8 * TILE_UNITS, "몸도 벽에 안 들어간다");
    }

    // **물줄기를 지나가면 갇힌다.** 무적이 아니다.
    // 판정 칸이 매 틱 갱신되고 한 틱에 0.375 칸씩만 가므로 어느 칸도 안 건너뛴다
    {
        OpenBoard();
        int c = Join(5, 10);
        Player& q = g_game.players[c];
        q.has_dash = true;

        SetBlast(7, 10, 0, 60);      // 두 칸 앞에 물줄기
        StartDash(c, 1, 0);
        for (int t = 0; t < DASH_TICKS; ++t) Tick();

        printf("  물줄기를 지난 뒤 갇힘 %d틱\n", q.trap_ticks);
        Check(q.trap_ticks > 0, "물줄기 위를 지나가면 갇힌다");
    }

    // 갇힌 채로는 못 한다. 갇힘이 제일 무거운 상태여야 한다
    {
        OpenBoard();
        int d = Join(5, 10);
        Player& q = g_game.players[d];
        q.has_dash   = true;
        q.trap_ticks = 30;
        StartDash(d, 1, 0);
        Check(q.dash_ticks == 0, "갇혀 있으면 대쉬가 안 나간다");
    }

    // 대각선으로 오면 한 축만 쓴다. 대각선을 받으면 실제 거리가 1.41배가 된다
    {
        OpenBoard();
        int e = Join(5, 10);
        Player& q = g_game.players[e];
        q.has_dash = true;
        StartDash(e, 1, 1);
        printf("  대각선으로 시켰을 때 방향 (%d, %d)\n", q.dash_dx, q.dash_dy);
        Check(q.dash_dy == 0, "대각선은 한 축으로 눕힌다");
    }
}
static void Test6_PopByTouch()
{
    printf("\n=== 시험 6: 갇힌 사람을 몸으로 터뜨리기 ===\n");

    OpenBoard();
    int victim = Join(10, 10);
    int killer = Join(20, 10);   // 멀리 세워둔다

    Player& v = g_game.players[victim];
    Player& k = g_game.players[killer];

    SetBlast(10, 10, 0, 60);
    Tick();
    Check(v.trap_ticks > 0, "먼저 갇혔다");

    // 아직 멀다. 아무 일도 없어야 한다
    for (int t = 0; t < 5; ++t) Tick();
    Check(v.alive, "멀리 있으면 아무 일도 없다");

    // 몸이 닿기 직전까지 붙인다
    k.px = v.px + POP_TOUCH_DIST + 4;
    k.py = v.py;
    k.judge_tx = JudgeAxis(k.px);
    Tick();
    printf("  %d units 떨어졌을 때: %s\n", POP_TOUCH_DIST + 4, v.alive ? "살아 있다" : "터졌다");
    Check(v.alive, "접촉 거리 밖이면 안 터진다");

    // 이제 닿는다
    k.px = v.px + POP_TOUCH_DIST - 4;
    k.judge_tx = JudgeAxis(k.px);
    Tick();

    printf("  %d units 떨어졌을 때: %s\n", POP_TOUCH_DIST - 4, v.alive ? "살아 있다" : "터졌다");
    Check(!v.alive, "몸이 닿으면 터진다");
    Check(CountEvent(EVT_POP) == 1, "POP 이 떴다");
    Check(CountEvent(EVT_DEATH) == 1, "DEAD 도 같이 떴다");
}

// ── 시험 6b : 갇힌 사람끼리는 못 터뜨린다 ────────────────────
static void Test6b_TrappedCannotPop()
{
    printf("\n=== 시험 6b: 갇힌 사람끼리 ===\n");

    OpenBoard();
    int a = Join(10, 10);
    int b = Join(11, 10);

    SetBlast(10, 10, 0, 70);
    SetBlast(11, 10, 0, 70);
    Tick();

    Check(g_game.players[a].trap_ticks > 0 && g_game.players[b].trap_ticks > 0,
          "둘 다 갇혔다");

    g_game.players[b].px = g_game.players[a].px + 10;   // 딱 붙여 놓는다
    Tick();

    Check(g_game.players[a].alive && g_game.players[b].alive,
          "둘 다 갇혀 있으면 서로 못 터뜨린다");
}

// ── 시험 7 : 자기 물풍선에서 나가고 못 들어오는가 ────────────
static void Test7_OwnBubble()
{
    printf("\n=== 시험 7: 자기 물풍선 ===\n");

    OpenBoard();
    int me = Join(10, 10);
    Player& p = g_game.players[me];

    PlaceBubble(me);

    // 오른쪽으로 나간다
    p.dir_x = 1;
    for (int t = 0; t < 20; ++t) {
        Tick();
    }
    int out_tile = p.px / TILE_UNITS;
    printf("  나간 뒤 타일 %d\n", out_tile);
    Check(out_tile > 10, "놓은 칸에서 나갈 수 있다");

    // 다시 들어가려고 한다.
    //
    // 위아래를 막는다. 안 막으면 코너 보정이 물풍선을 **돌아서** 지나가게 해준다.
    // 그것도 맞는 동작이지만(물풍선은 한 칸이니까), 여기서 재려는 건 그게 아니라
    // **놓은 그 칸에 다시 못 들어온다**는 것이다
    g_game.map.tile[9][10]  = TILE_WALL;
    g_game.map.tile[11][10] = TILE_WALL;

    p.dir_x = -1;
    for (int t = 0; t < 20; ++t) {
        Tick();
    }
    printf("  돌아오려 한 뒤 타일 (%d,%d), 몸 왼쪽 끝 %d\n",
           p.judge_tx, p.judge_ty, p.px - PLAYER_HALF);

    Check(!(p.judge_tx == 10 && p.judge_ty == 10), "놓은 칸에 다시 못 들어온다");
    Check(p.px - PLAYER_HALF >= 11 * TILE_UNITS, "몸도 물풍선 칸에 안 들어간다");
}

// ── 시험 8 : 놓을 수 있는 개수 ───────────────────────────────
static void Test8_Count()
{
    printf("\n=== 시험 8: 동시 설치 개수 ===\n");

    OpenBoard();
    int me = Join(10, 10);
    Player& p = g_game.players[me];

    Check(PlaceBubble(me), "첫 개는 놓인다");

    // 같은 칸에는 두 번 못 놓는다
    Check(!PlaceBubble(me), "같은 칸에 두 번은 못 놓는다");

    // 옆 칸으로 옮겨도 아이템이 없으면 더 못 놓는다
    p.judge_tx = 12;
    p.px       = TileCenter(12);
    Check(!PlaceBubble(me), "아이템이 없으면 한 개까지다");

    p.bubble_lv = 1;
    Check(PlaceBubble(me), "물풍선 아이템 하나면 두 개까지다");
}

// ── 시험 9 : 아이템이 상수대로 나오는가 ──────────────────────
static void Test9_Drop()
{
    printf("\n=== 시험 9: 드롭 확률 ===\n");

    OpenBoard();

    const int tries = 4000;
    int dropped = 0;

    for (int i = 0; i < tries; ++i) {
        int x = 1 + (i % (MAP_W - 2));
        int y = 1 + ((i / (MAP_W - 2)) % (MAP_H - 2));

        g_game.map.tile[y][x] = TILE_BLOCK;
        g_game.item[y][x]     = ITEM_NONE;

        BreakBlock(x, y);
        if (g_game.item[y][x] != ITEM_NONE) {
            ++dropped;
        }
    }

    int pct = dropped * 100 / tries;
    printf("  블록 %d 개를 부숴서 %d 개 나왔다 = %d%% (상수 %d%%)\n",
           tries, dropped, pct, ITEM_DROP_PERCENT);

    Check(pct >= ITEM_DROP_PERCENT - 3 && pct <= ITEM_DROP_PERCENT + 3,
          "드롭 확률이 상수와 3%p 안에서 맞는다");
}

// ── 시험 10 : 아이템을 먹으면 세지고 상한에서 멈추는가 ───────
static void Test10_Pickup()
{
    printf("\n=== 시험 10: 아이템 먹기 ===\n");

    OpenBoard();
    int me = Join(10, 10);
    Player& p = g_game.players[me];

    g_game.item[10][10] = ITEM_POWER;
    Tick();

    Check(p.power_lv == 1, "물줄기가 하나 늘었다");
    Check(g_game.item[10][10] == ITEM_NONE, "먹은 자리에서 사라졌다");
    Check(CountEvent(EVT_ITEM) == 1, "ITEM 이 떴다");

    // 상한에서 멈춰야 한다. 벽에서 나온 걸로는 만렙이 안 되는 게 밸런스의 척추다
    for (int i = 0; i < 10; ++i) {
        g_game.item[10][10] = ITEM_POWER;
        Tick();
    }
    printf("  열 번 더 먹은 뒤 물줄기 %d (상한 %d)\n", p.power_lv, STAT_CAP_FROM_WALL);
    Check(p.power_lv == STAT_CAP_FROM_WALL, "상한에서 멈춘다");
}

// ── 시험 11 : 죽으면 가진 것의 절반을 흘리는가 ───────────────
static void Test11_KillLoot()
{
    printf("\n=== 시험 11: 킬 드롭 ===\n");

    OpenBoard();
    int me = Join(20, 20);
    Player& p = g_game.players[me];
    p.bubble_lv = 4;
    p.power_lv  = 2;
    p.speed_lv  = 1;

    KillPlayer(me);

    int found[5] = {};
    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            uint8_t it = g_game.item[y][x];
            if (it != ITEM_NONE) ++found[it];
        }
    }

    printf("  물풍선 4 / 물줄기 2 / 롤러 1 을 가진 사람이 죽었다\n");
    printf("  흘린 것: 물풍선 %d, 물줄기 %d, 롤러 %d, 울트라 %d\n",
           found[ITEM_BUBBLE], found[ITEM_POWER], found[ITEM_ROLLER], found[ITEM_ULTRA]);

    Check(found[ITEM_BUBBLE] == 2, "물풍선 4 개 중 2 개를 흘렸다");
    Check(found[ITEM_POWER]  == 1, "물줄기 2 개 중 1 개를 흘렸다");
    Check(found[ITEM_ROLLER] == 1, "롤러 1 개도 1 개는 흘린다 (올림)");

    // 아무것도 없는 사람을 잡으면 아무것도 안 나온다
    OpenBoard();
    int poor = Join(20, 20);
    KillPlayer(poor);

    int any = 0;
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            if (g_game.item[y][x] != ITEM_NONE && g_game.item[y][x] != ITEM_ULTRA) ++any;
    Check(any == 0, "빈손인 사람을 잡으면 수치형은 안 나온다");
}

// ── 시험 12 : 울트라는 벽에서 안 나오고 상한 위로 올린다 ─────
static void Test12_Ultra()
{
    printf("\n=== 시험 12: 울트라 ===\n");

    OpenBoard();
    int me = Join(10, 10);
    Player& p = g_game.players[me];

    // 벽에서 나오는 것으로는 상한까지만
    for (int i = 0; i < 10; ++i) {
        g_game.item[10][10] = ITEM_POWER;
        Tick();
    }
    printf("  벽에서 나온 것만 먹었을 때 물줄기 %d (상한 %d)\n",
           p.power_lv, STAT_CAP_FROM_WALL);
    Check(p.power_lv == STAT_CAP_FROM_WALL, "벽에서는 상한까지만 오른다");

    // 울트라 하나면 상한 위로
    g_game.item[10][10] = ITEM_ULTRA;
    Tick();
    printf("  울트라를 먹은 뒤 물줄기 %d (울트라 상한 %d)\n",
           p.power_lv, STAT_CAP_ULTRA);
    Check(p.power_lv == STAT_CAP_ULTRA, "울트라는 상한 위로 올린다");

    // 블록을 아무리 부숴도 울트라는 안 나온다
    OpenBoard();
    int ultra_from_wall = 0;
    for (int i = 0; i < 3000; ++i) {
        int x = 1 + (i % (MAP_W - 2));
        int y = 1 + ((i / (MAP_W - 2)) % (MAP_H - 2));
        g_game.map.tile[y][x] = TILE_BLOCK;
        g_game.item[y][x] = ITEM_NONE;
        BreakBlock(x, y);
        if (g_game.item[y][x] == ITEM_ULTRA) ++ultra_from_wall;
    }
    printf("  블록 3000 개를 부숴서 나온 울트라: %d 개\n", ultra_from_wall);
    Check(ultra_from_wall == 0, "울트라는 벽에서 절대 안 나온다");
}

// ── 시험 13 : 상자를 밀 수 있는가 ────────────────────────────
//
// 블록은 부수는 것 말고 할 게 없다. 상자는 **밀 수 있다.**
// 그래서 같은 벽 하나에 선택지가 둘이 된다. 부수거나 밀거나.
//
// 여기서 재는 것은 넷이다.
//   ① 밀린다
//   ② 뒤가 막혀 있으면 안 밀린다 (그럴 땐 부수는 수밖에 없다)
//   ③ 한 번에 한 칸씩만 밀린다 (쿨다운이 없으면 주르륵 밀려간다)
//   ④ 사람이 서 있는 칸으로는 안 밀린다 (깔아뭉개면 그건 다른 게임이다)
static void Test12_PushBox()
{
    printf("\n=== 시험 13: 상자 밀기 ===\n");

    // ① 그냥 밀린다
    OpenBoard();
    g_game.map.tile[10][11] = TILE_BOX;

    int me = Join(10, 10);
    Player& p = g_game.players[me];
    p.dir_x = 1;

    Tick();
    printf("  민 뒤: (11,10)=%d  (12,10)=%d\n",
           g_game.map.tile[10][11], g_game.map.tile[10][12]);

    Check(g_game.map.tile[10][11] == TILE_EMPTY, "있던 자리가 비었다");
    Check(g_game.map.tile[10][12] == TILE_BOX,   "한 칸 밀렸다");

    // ③ 쿨다운. 계속 누르고 있어도 바로 또 안 밀린다
    Tick();
    Check(g_game.map.tile[10][13] != TILE_BOX, "붙어서 눌러도 연달아 안 밀린다");

    for (int t = 0; t < PUSH_COOLDOWN_TICKS + 2; ++t) Tick();
    printf("  쿨다운 뒤: (13,10)=%d\n", g_game.map.tile[10][13]);
    Check(g_game.map.tile[10][13] == TILE_BOX, "쿨다운이 지나면 또 밀린다");

    // ② 뒤가 막혀 있으면 안 밀린다
    OpenBoard();
    g_game.map.tile[10][11] = TILE_BOX;
    g_game.map.tile[10][12] = TILE_WALL;

    int q = Join(10, 10);
    g_game.players[q].dir_x = 1;
    Tick();

    Check(g_game.map.tile[10][11] == TILE_BOX, "뒤가 막혔으면 안 밀린다");

    // ④ 사람이 서 있는 칸으로는 안 밀린다
    OpenBoard();
    g_game.map.tile[10][11] = TILE_BOX;

    int a = Join(10, 10);
    int b = Join(12, 10);
    g_game.players[a].dir_x = 1;
    g_game.players[b].dir_x = 0;
    Tick();

    printf("  사람이 뒤에 서 있을 때: (11,10)=%d\n", g_game.map.tile[10][11]);
    Check(g_game.map.tile[10][11] == TILE_BOX, "사람 위로는 안 밀린다");

    // 상자도 물줄기에 부서진다. 밀기만 되고 안 부서지면 막다른 데가 생긴다
    OpenBoard();
    g_game.map.tile[10][11] = TILE_BOX;

    int c = Join(10, 10);
    PlaceBubble(c);
    for (int t = 0; t < BUBBLE_FUSE_TICKS + 2; ++t) Tick();

    printf("  물줄기가 지난 뒤: (11,10)=%d\n", g_game.map.tile[10][11]);
    Check(g_game.map.tile[10][11] == TILE_EMPTY, "상자도 물줄기에 부서진다");
}

int main()
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    Test1_Fuse();
    Test2_Cross();
    Test3_ChainDelay();
    Test4_Graze();
    Test5_Trap();
    Test6_PopByTouch();
    Test6b_TrappedCannotPop();
    Test7_OwnBubble();
    Test12_PushBox();
    Test13_Dash();
    Test8_Count();
    Test9_Drop();
    Test10_Pickup();
    Test11_KillLoot();
    Test12_Ultra();

    printf("\n===== 결과: %d PASS / %d FAIL =====\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
