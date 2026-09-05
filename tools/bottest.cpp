// tools/bottest.cpp — 봇이 화면에서 이상해 보였던 행동을 작은 판으로 고정해 시험한다
//
// 실행: practice\build.bat ..\tools\bottest.cpp
//       practice\bin\bottest.exe
#include <cstdio>
#include "../Server/src/Bot.h"

static int g_pass = 0;
static int g_fail = 0;

static void Check(bool ok, const char* what)
{
    if (ok) { ++g_pass; printf("  [PASS] %s\n", what); }
    else    { ++g_fail; printf("  [FAIL] %s\n", what); }
}

static void OpenBoard(int bots)
{
    InitGame(1234, 10);
    ClearFleeTargets();

    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            bool edge = x == 0 || y == 0 || x == MAP_W - 1 || y == MAP_H - 1;
            g_game.map.tile[y][x] = edge ? TILE_WALL : TILE_EMPTY;
            g_game.item[y][x] = ITEM_NONE;
        }
    }
    for (int sy = 0; sy < SECTOR_ROWS; ++sy)
        for (int sx = 0; sx < SECTOR_COLS; ++sx)
            g_game.sector_state[sy][sx] = SECTOR_OPEN;

    for (int i = 0; i < bots; ++i) AddPlayer(nullptr, true);
    g_game.phase = ROUND_PLAYING;
}

static void Put(int slot, int x, int y)
{
    Player& p = g_game.players[slot];
    p.alive = true;
    p.px = TileCenter(x); p.py = TileCenter(y);
    p.judge_tx = x; p.judge_ty = y;
    p.dir_x = 0; p.dir_y = 0;
}

static void PrepareMaps()
{
    BuildDangerMap(BUBBLE_FUSE_TICKS + 1);
    BuildEnemyMap();
}

static void TestFloodPriority()
{
    printf("\n=== 침수 우선순위 ===\n");
    OpenBoard(1);
    Put(0, SECTOR_W - 2, SECTOR_H / 2);
    g_game.sector_state[0][0] = SECTOR_WARNING;
    PrepareMaps();
    ThinkBot(0);
    Check(g_reason[0] == R_WATER, "붉은 예고가 뜨면 파밍보다 대피를 먼저 고른다");
    Check(g_goal_x[0] >= 0 && !FloodThreatAt(g_goal_x[0], g_goal_y[0]),
          "예고 구역 밖의 안전한 칸을 목표로 잡는다");

    // 이미 아이템 목표를 들고 있어도 구역이 잠기면 버려야 한다.
    OpenBoard(1);
    Put(0, SECTOR_W - 2, SECTOR_H / 2);
    SetGoal(0, g_game.players[0], SECTOR_W - 4, SECTOR_H / 2, R_ITEM);
    g_game.sector_state[0][0] = SECTOR_FLOODED;
    PrepareMaps();
    ThinkBot(0);
    Check(g_reason[0] == R_WATER && g_goal_why[0] == R_WATER,
          "기억 중인 아이템 목표도 실제 침수가 시작되면 즉시 버린다");
}

static void TestAttackLine()
{
    printf("\n=== 공격선과 사람 통과 ===\n");
    OpenBoard(2);
    Put(0, 5, 5); Put(1, 7, 5);
    g_game.map.tile[5][6] = TILE_WALL;
    PrepareMaps();
    Check(!EnemyInBlastLine(5, 5, 3, 0), "벽 모서리 뒤의 가까운 적에게 헛물풍선을 놓지 않는다");
    g_game.map.tile[5][6] = TILE_EMPTY;
    PrepareMaps();
    Check(EnemyInBlastLine(5, 5, 3, 0), "막히지 않은 직선 안의 적은 공격 대상으로 본다");

    Put(1, 6, 5);
    PrepareMaps();
    int dx = 0, dy = 0;
    int gx = -1, gy = -1;
    bool found = FindStep(5, 5, Goal::Enemy, 6, &dx, &dy,
                          0, nullptr, false, false, &gx, &gy, true, 1);
    Check(found && !(dx == 1 && dy == 0),
          "사냥할 때 다른 봇이 선 칸을 관통하지 않고 공격 위치로 우회한다");
}

static void TestFloodedPath()
{
    printf("\n=== 기억한 길의 안전 검사 ===\n");
    OpenBoard(1);
    Put(0, SECTOR_W + 2, SECTOR_H + 2);
    g_game.sector_state[1][2] = SECTOR_FLOODED;
    PrepareMaps();
    int dx = 0, dy = 0;
    Check(!StepToward(SECTOR_W + 2, SECTOR_H + 2,
                      SECTOR_W * 2 + 2, SECTOR_H + 2, &dx, &dy, 0),
          "전에 잡은 목표라도 새로 잠긴 구역을 통과하는 길은 버린다");
}

static void TestBombEscape()
{
    printf("\n=== 물풍선 설치 전 탈출 검사 ===\n");
    OpenBoard(1);
    Put(0, 5, 5);

    // 왼쪽은 벽, 위아래도 벽인 복도다. 오른쪽 안전 칸으로 가려면
    // 1초 안에 터질 다른 물풍선의 칸(6,5)을 반드시 지나야 한다.
    g_game.map.tile[5][4] = TILE_WALL;
    for (int x = 4; x <= 8; ++x) {
        g_game.map.tile[4][x] = TILE_WALL;
        g_game.map.tile[6][x] = TILE_WALL;
    }
    PrepareMaps();
    g_soon[5][6] = true;

    int gx = -1, gy = -1;
    Check(!SafeToPlace(5, 5, 1, 3, &gx, &gy),
          "곧 터질 다른 물풍선을 지나야만 살 수 있으면 새 물풍선을 놓지 않는다");
}

int main()
{
    printf("=== 봇 판단 회귀 검사 ===\n");
    TestFloodPriority();
    TestAttackLine();
    TestFloodedPath();
    TestBombEscape();
    printf("\n===== 결과: %d PASS / %d FAIL =====\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
