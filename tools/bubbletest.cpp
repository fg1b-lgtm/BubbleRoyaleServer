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
static Session* NextFakeSession()
{
    return (Session*)(INT_PTR)(++g_fake_id);
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
}

static int Join(int tx, int ty)
{
    int slot = AddPlayer(NextFakeSession());
    if (slot < 0) {
        return -1;
    }

    Player& p = g_game.players[slot];
    p.px       = TileCenter(tx);
    p.py       = TileCenter(ty);
    p.judge_tx = tx;
    p.judge_ty = ty;
    return slot;
}

// 서버의 틱 루프와 같은 순서다. 내보낸 뒤 비우므로, 여기서는 돌기 전에 비운다
static void Tick()
{
    g_game.event_count = 0;
    GameTick();
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

    int me = Join(10, 10);
    g_game.players[me].power_lv = 2;        // 물줄기 2+2 = 4칸
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

    Check(g_game.blast[10][6] > 0 && g_game.blast[10][5] == 0, "왼쪽은 사거리 4 만큼만 간다");
}

// ── 시험 3 : 연쇄가 한 틱에 다 터지지 않는가 ─────────────────
static void Test3_ChainDelay()
{
    printf("\n=== 시험 3: 연쇄 지연 ===\n");

    // ① 늦게 놓은 것이 앞의 폭발에 걸려 터지는 경우
    OpenBoard();
    int a = Join(10, 10);
    int b = Join(12, 10);

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
    int d = Join(12, 10);

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

    g_game.players[e].judge_tx = 12;
    g_game.players[e].px = TileCenter(12);
    PlaceBubble(e);
    for (int t = 0; t < 20; ++t) Tick();

    g_game.players[e].judge_tx = 14;
    g_game.players[e].px = TileCenter(14);
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

    // 몸은 11번 칸에 들어갔지만 아직 판정은 10번에 남아 있는 자리로 옮긴다.
    // 임계값이 175 이므로 100 만 들어간 상태면 판정은 안 넘어갔다
    Player& p = g_game.players[me];
    p.px       = 11 * TILE_UNITS + 100;
    p.judge_tx = 10;
    p.dir_x    = 0;

    Check(p.px / TILE_UNITS == 11 && p.judge_tx == 10, "몸은 11칸, 판정은 10칸");

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

    // 갇힌 동안은 못 움직인다
    p.dir_x = 1;
    int before = p.px;
    Tick();
    Check(p.px == before, "갇힌 동안 못 움직인다");

    // 나를 가둔 그 물줄기로는 안 죽는다.
    // 안 그러면 갇히는 순간 바로 죽어서 5초를 판단할 시간이 사라진다
    for (int t = 0; t < BLAST_DURATION_TICKS + 2; ++t) {
        Tick();
    }
    Check(p.alive, "나를 가둔 물줄기로는 안 죽는다");

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

// ── 시험 6 : 다른 폭발이면 죽는가 ────────────────────────────
static void Test6_ChainKill()
{
    printf("\n=== 시험 6: 갇힌 사람을 연쇄로 잡기 ===\n");

    OpenBoard();
    int me = Join(10, 10);
    Player& p = g_game.players[me];

    SetBlast(10, 10, 0, 60);
    Tick();
    Check(p.trap_ticks > 0, "먼저 갇혔다");

    // 다른 번호의 폭발이 같은 칸을 덮는다. 이게 연쇄가 마무리 수단이 되는 지점이다
    SetBlast(10, 10, 1, 61);
    Tick();

    Check(!p.alive, "다른 폭발에 닿으면 죽는다");
    Check(CountEvent(EVT_DEATH) == 1, "DEAD 가 떴다");
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

    // 다시 들어가려고 한다
    p.dir_x = -1;
    for (int t = 0; t < 20; ++t) {
        Tick();
    }
    printf("  돌아오려 한 뒤 타일 %d\n", p.px / TILE_UNITS);
    Check(p.px / TILE_UNITS == 11, "나가면 다시 못 들어온다");
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

int main()
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    Test1_Fuse();
    Test2_Cross();
    Test3_ChainDelay();
    Test4_Graze();
    Test5_Trap();
    Test6_ChainKill();
    Test7_OwnBubble();
    Test8_Count();
    Test9_Drop();
    Test10_Pickup();

    printf("\n===== 결과: %d PASS / %d FAIL =====\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
