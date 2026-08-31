// tools/roundsim.cpp — 봇 24명으로 한 판을 통째로 돌려본다
//
// SPEC 이 "봇 100판으로 밸런스 검증" 이라고 적어둔 그 도구다.
// 화면도 소켓도 없이 게임 규칙만 최고 속도로 돌린다. 한 판이 눈 깜짝할 사이에 끝난다.
//
// 무엇을 알고 싶은가
//   ① 판이 끝나기는 하나. 몇 분에 끝나나
//   ② 누가 죽이나. 물풍선인가 물인가.
//      물이 대부분을 죽이면 그건 배틀로얄이 아니라 의자앉기 게임이다
//   ③ 압박 곡선. 살아 있는 사람 한 명당 몇 칸인가.
//      이 숫자가 안 줄면 판이 안 좁혀지는 것이다
//   ④ 아이템이 몇 개씩 돌아가나
//
// 컴파일: practice 폴더에서  build.bat ..\tools\roundsim.cpp
// 실행  : practice\bin\roundsim.exe [판수]
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "../Server/src/GameTick.h"

static const int DX[4] = {  1, -1,  0,  0 };
static const int DY[4] = {  0,  0,  1, -1 };

static int g_fake_id = 0;
static Session* NextFakeSession() { return (Session*)(INT_PTR)(++g_fake_id); }

// ── 봇 ───────────────────────────────────────────────────────
//
// 너무 멍청하면 자기 물풍선에 다 죽어서 숫자가 의미 없어진다.
// 너무 똑똑하면 만들다 날 샌다. 아래 다섯 줄이면 사람 흉내는 난다.
//
//   1) 지금 위험하면 안전한 칸으로 도망친다
//   2) 물에 잠긴 구역이면 가운데로 간다
//   3) 가까이 아이템이 있으면 주우러 간다
//   4) 블록 옆이고 놓고 도망칠 수 있으면 놓는다
//   5) 아니면 가운데 쪽으로 걷는다

// 지금 물줄기가 있거나 곧 터질 물풍선의 십자에 걸리는 칸
static bool g_danger[MAP_H][MAP_W];

static void BuildDangerMap(int lookahead)
{
    memset(g_danger, 0, sizeof(g_danger));

    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (g_game.blast[y][x] > 0) g_danger[y][x] = true;
        }
    }

    for (int i = 0; i < MAX_BUBBLE; ++i) {
        const Bubble& b = g_game.bubbles[i];
        if (!b.used || b.fuse > lookahead) continue;

        g_danger[b.ty][b.tx] = true;
        for (int d = 0; d < 4; ++d) {
            for (int step = 1; step <= b.range; ++step) {
                int x = b.tx + DX[d] * step;
                int y = b.ty + DY[d] * step;
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) break;

                uint8_t t = g_game.map.tile[y][x];
                if (t == TILE_WALL) break;
                g_danger[y][x] = true;
                if (t == TILE_BLOCK || t == TILE_BUBBLE) break;
            }
        }
    }
}

static bool Passable(int x, int y)
{
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    return g_game.map.tile[y][x] == TILE_EMPTY;
}

// 목표에 닿는 첫 걸음 방향을 찾는다. 못 찾으면 false
enum class Goal { Safe, Item, Center, Block, Enemy };

// 지금 살아 있는 사람이 어느 칸에 있나. 사냥할 때 쓴다
static int g_enemy_at[MAP_H][MAP_W];

static void BuildEnemyMap()
{
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            g_enemy_at[y][x] = -1;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& p = g_game.players[i];
        if (p.s == nullptr || !p.alive) continue;
        g_enemy_at[p.judge_ty][p.judge_tx] = i;
    }
}

static bool FindStep(int sx, int sy, Goal goal, int max_steps, int* out_dx, int* out_dy,
                     int me = -1, int* found_dist = nullptr)
{
    static int  dist[MAP_H][MAP_W];
    static int  fromd[MAP_H][MAP_W];
    static int  qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];

    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            dist[y][x] = -1;

    int head = 0, tail = 0;
    dist[sy][sx] = 0;
    fromd[sy][sx] = -1;
    qx[tail] = sx; qy[tail] = sy; ++tail;

    int cx = MAP_W / 2, cy = MAP_H / 2;

    while (head < tail) {
        int x = qx[head], y = qy[head];
        ++head;

        if (dist[y][x] > max_steps) break;

        bool hit = false;
        switch (goal) {
        case Goal::Safe:
            hit = !g_danger[y][x];
            break;
        case Goal::Item:
            hit = (g_game.item[y][x] != ITEM_NONE) && !g_danger[y][x];
            break;
        case Goal::Center:
            hit = (SectorStateAt(x, y) != SECTOR_FLOODED) && !g_danger[y][x]
                  && (abs(x - cx) + abs(y - cy) < abs(sx - cx) + abs(sy - cy));
            break;
        case Goal::Block:
            // 블록에 붙은 칸. 거기 서면 부술 수 있다
            for (int d = 0; d < 4; ++d) {
                if (g_game.map.IsBlock(x + DX[d], y + DY[d])) hit = true;
            }
            if (g_danger[y][x]) hit = false;
            break;
        case Goal::Enemy:
            hit = (g_enemy_at[y][x] >= 0 && g_enemy_at[y][x] != me);
            break;
        }

        if (hit && dist[y][x] > 0) {
            if (found_dist) *found_dist = dist[y][x];
            // 첫 걸음까지 되짚어 올라간다
            int bx = x, by = y;
            while (dist[by][bx] > 1) {
                int d = fromd[by][bx];
                bx -= DX[d]; by -= DY[d];
            }
            *out_dx = bx - sx;
            *out_dy = by - sy;
            return true;
        }

        for (int d = 0; d < 4; ++d) {
            int nx = x + DX[d], ny = y + DY[d];
            if (!Passable(nx, ny) || dist[ny][nx] >= 0) continue;
            dist[ny][nx] = dist[y][x] + 1;
            fromd[ny][nx] = d;
            qx[tail] = nx; qy[tail] = ny; ++tail;
        }
    }

    return false;
}

// 여기 놓고 살아나갈 수 있나. 놓기 전에 확인한다
static bool SafeToPlace(int tx, int ty, int range)
{
    uint8_t saved = g_game.map.tile[ty][tx];
    g_game.map.tile[ty][tx] = TILE_BUBBLE;

    bool danger_backup[MAP_H][MAP_W];
    memcpy(danger_backup, g_danger, sizeof(g_danger));

    // 내가 놓을 물풍선의 십자를 위험에 더한다
    g_danger[ty][tx] = true;
    for (int d = 0; d < 4; ++d) {
        for (int step = 1; step <= range; ++step) {
            int x = tx + DX[d] * step, y = ty + DY[d] * step;
            if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) break;
            uint8_t t = g_game.map.tile[y][x];
            if (t == TILE_WALL) break;
            g_danger[y][x] = true;
            if (t != TILE_EMPTY) break;
        }
    }

    int dx, dy;
    bool ok = FindStep(tx, ty, Goal::Safe, 8, &dx, &dy);

    memcpy(g_danger, danger_backup, sizeof(g_danger));
    g_game.map.tile[ty][tx] = saved;
    return ok;
}

// 도망 목표를 붙잡아 둔다.
//
// 매 틱 새로 고르면 칸 경계를 넘는 순간 기준 칸이 바뀌면서
// 다른 안전한 칸이 뽑히고, 방향이 뒤집혀 제자리에서 떨린다.
// 그러다 자기 폭탄에 죽는다. 사람은 한번 정한 데로 간다
static int g_flee_x[PLAYER_MAX], g_flee_y[PLAYER_MAX];

static void ClearFleeTargets()
{
    for (int i = 0; i < PLAYER_MAX; ++i) { g_flee_x[i] = -1; g_flee_y[i] = -1; }
}

// 정해둔 칸으로 가는 첫 걸음
static bool StepToward(int sx, int sy, int gx, int gy, int* out_dx, int* out_dy)
{
    static int dist[MAP_H][MAP_W];
    static int fromd[MAP_H][MAP_W];
    static int qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];

    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            dist[y][x] = -1;

    int head = 0, tail = 0;
    dist[sy][sx] = 0;
    qx[tail] = sx; qy[tail] = sy; ++tail;

    while (head < tail) {
        int x = qx[head], y = qy[head];
        ++head;

        if (x == gx && y == gy) {
            if (dist[y][x] == 0) return false;
            int bx = x, by = y;
            while (dist[by][bx] > 1) {
                int d = fromd[by][bx];
                bx -= DX[d]; by -= DY[d];
            }
            *out_dx = bx - sx;
            *out_dy = by - sy;
            return true;
        }

        for (int d = 0; d < 4; ++d) {
            int nx = x + DX[d], ny = y + DY[d];
            if (!Passable(nx, ny) || dist[ny][nx] >= 0) continue;
            dist[ny][nx] = dist[y][x] + 1;
            fromd[ny][nx] = d;
            qx[tail] = nx; qy[tail] = ny; ++tail;
        }
    }
    return false;
}

static void ThinkBot(int slot)
{
    Player& p = g_game.players[slot];
    if (!p.alive) return;

    int tx = p.judge_tx, ty = p.judge_ty;
    int dx = 0, dy = 0;

    // 1) 위험하면 무조건 도망.
    //    한번 정한 목표가 아직 안전하면 그대로 밀고 간다
    if (g_danger[ty][tx]) {
        int fx = g_flee_x[slot], fy = g_flee_y[slot];

        bool keep = (fx >= 0) && !g_danger[fy][fx] && !(fx == tx && fy == ty);
        if (keep && StepToward(tx, ty, fx, fy, &dx, &dy)) {
            p.dir_x = dx; p.dir_y = dy;
            return;
        }

        if (FindStep(tx, ty, Goal::Safe, 10, &dx, &dy)) {
            // 목표를 기억해 둔다. 다음 틱에도 같은 데로 간다
            int gx = tx, gy = ty;
            FindStep(tx, ty, Goal::Safe, 10, &dx, &dy);
            // 첫 걸음 방향으로 안전한 칸을 다시 찾아 기억
            for (int r = 1; r <= 10; ++r) {
                int nx = tx + dx * r, ny = ty + dy * r;
                if (!Passable(nx, ny)) break;
                if (!g_danger[ny][nx]) { gx = nx; gy = ny; break; }
            }
            g_flee_x[slot] = gx; g_flee_y[slot] = gy;

            p.dir_x = dx; p.dir_y = dy;
            return;
        }
    }
    else {
        g_flee_x[slot] = -1;
    }

    // 2) 잠긴 구역이면 가운데로
    if (SectorStateAt(tx, ty) == SECTOR_FLOODED) {
        if (FindStep(tx, ty, Goal::Center, 20, &dx, &dy)) {
            p.dir_x = dx; p.dir_y = dy;
            return;
        }
    }

    int range = BLAST_BASE_RANGE + p.power_lv;

    // 3) 사거리 안에 적이 있으면 놓는다. 이게 없으면 아무도 안 죽어서 판이 안 끝난다
    int enemy_dist = 0;
    bool enemy_near = FindStep(tx, ty, Goal::Enemy, range, &dx, &dy, slot, &enemy_dist);
    if (enemy_near && SafeToPlace(tx, ty, range)) {
        if (PlaceBubble(slot)) {
            p.dir_x = 0; p.dir_y = 0;
            return;
        }
    }

    // 4) 아이템
    if (FindStep(tx, ty, Goal::Item, 8, &dx, &dy)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

    // 5) 블록 옆이면 놓는다
    bool near_block = false;
    for (int d = 0; d < 4; ++d) {
        if (g_game.map.IsBlock(tx + DX[d], ty + DY[d])) near_block = true;
    }
    if (near_block && SafeToPlace(tx, ty, range)) {
        if (PlaceBubble(slot)) {
            p.dir_x = 0; p.dir_y = 0;
            return;
        }
    }

    // 6) 적을 찾아 나선다. 사람은 숨어만 있지 않는다
    if (FindStep(tx, ty, Goal::Enemy, 18, &dx, &dy, slot)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

    // 7) 부술 게 있는 쪽으로
    if (FindStep(tx, ty, Goal::Block, 14, &dx, &dy)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

    if (FindStep(tx, ty, Goal::Center, 20, &dx, &dy)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

    p.dir_x = 0; p.dir_y = 0;
}

// ── 한 판 ────────────────────────────────────────────────────
struct RoundResult
{
    int  ticks;
    int  alive_end;
    int  by_bubble;
    int  by_water;
    int  by_self;      // 자기가 놓은 물풍선에 죽은 수
    int  first_kill_tick;
    int  alive_at[8];        // 30초마다 살아 있는 수
    int  tiles_per_head[8];  // 30초마다 한 명당 안 잠긴 칸 수
    int  item_sum;
    int  blocks_broken;
};

static int OpenTilesNotFlooded()
{
    int n = 0;
    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (g_game.map.tile[y][x] == TILE_WALL) continue;
            if (SectorStateAt(x, y) == SECTOR_FLOODED) continue;
            ++n;
        }
    }
    return n;
}

static void PlayRound(unsigned int seed, RoundResult& r)
{
    memset(&r, 0, sizeof(r));
    r.first_kill_tick = -1;

    InitGame(seed);
    g_fake_id = 0;
    ClearFleeTargets();

    int start_blocks = 0;
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            if (g_game.map.tile[y][x] == TILE_BLOCK) ++start_blocks;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        AddPlayer(NextFakeSession());
    }

    const int MAX_TICKS = TICK_RATE * 60 * 10;   // 10분이면 무승부

    int drowning_before[PLAYER_MAX];
    bool alive_before[PLAYER_MAX];
    int sample = 0;

    for (int t = 1; t <= MAX_TICKS; ++t) {
        // 놓인 물풍선은 언제 터지든 위험한 걸로 본다.
        // 사람도 남의 폭탄 옆에 서 있지 않는다
        BuildDangerMap(BUBBLE_FUSE_TICKS + 1);
        BuildEnemyMap();

        for (int i = 0; i < PLAYER_MAX; ++i) {
            ThinkBot(i);
            drowning_before[i] = g_game.players[i].flood_ticks;
            alive_before[i]    = g_game.players[i].alive;
        }

        g_game.event_count = 0;
        GameTick();

        for (int i = 0; i < PLAYER_MAX; ++i) {
            if (alive_before[i] && !g_game.players[i].alive) {
                if (drowning_before[i] == 1) {
                    ++r.by_water;
                }
                else {
                    ++r.by_bubble;
                    // 그 칸을 덮은 물줄기가 누구 것이었나
                    const Player& d = g_game.players[i];
                    if (g_game.blast_owner[d.judge_ty][d.judge_tx] == (int8_t)i) {
                        ++r.by_self;
                    }
                }
                if (r.first_kill_tick < 0) r.first_kill_tick = t;
            }
        }

        // 30초마다 한 번씩 찍는다
        if (t % (TICK_RATE * 30) == 0 && sample < 8) {
            int alive = 0;
            for (int i = 0; i < PLAYER_MAX; ++i) if (g_game.players[i].alive) ++alive;

            r.alive_at[sample] = alive;
            r.tiles_per_head[sample] = alive > 0 ? OpenTilesNotFlooded() / alive : 0;
            ++sample;
        }

        int alive = 0;
        for (int i = 0; i < PLAYER_MAX; ++i) if (g_game.players[i].alive) ++alive;
        if (alive <= 1) {
            r.ticks = t;
            r.alive_end = alive;
            break;
        }
        r.ticks = t;
        r.alive_end = alive;
    }

    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& p = g_game.players[i];
        r.item_sum += p.bubble_lv + p.power_lv + p.speed_lv;
    }

    int left = 0;
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            if (g_game.map.tile[y][x] == TILE_BLOCK) ++left;
    r.blocks_broken = start_blocks - left;
}

int main(int argc, char** argv)
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    int rounds = (argc > 1) ? atoi(argv[1]) : 20;
    if (rounds < 1) rounds = 1;

    printf("=== 봇 %d명, %d판 ===\n\n", PLAYER_MAX, rounds);

    long long ticks = 0, bubble = 0, water = 0, first = 0, items = 0, broken = 0;
    long long self_kill = 0;
    long long alive_at[8] = {}, tiles_at[8] = {};
    int unfinished = 0;
    int longest = 0, shortest = 999999;

    for (int i = 0; i < rounds; ++i) {
        RoundResult r;
        PlayRound(5000u + i * 104729u, r);

        ticks  += r.ticks;
        bubble += r.by_bubble;
        water  += r.by_water;
        self_kill += r.by_self;
        items  += r.item_sum;
        broken += r.blocks_broken;
        if (r.first_kill_tick > 0) first += r.first_kill_tick;
        if (r.alive_end > 1) ++unfinished;
        if (r.ticks > longest)  longest = r.ticks;
        if (r.ticks < shortest) shortest = r.ticks;

        for (int k = 0; k < 8; ++k) {
            alive_at[k] += r.alive_at[k];
            tiles_at[k] += r.tiles_per_head[k];
        }
    }

    printf("--- 판이 끝나나 ---\n");
    printf("  평균 %lld분 %lld초 (짧게 %d:%02d, 길게 %d:%02d)\n",
           ticks / rounds / TICK_RATE / 60, (ticks / rounds / TICK_RATE) % 60,
           shortest / TICK_RATE / 60, (shortest / TICK_RATE) % 60,
           longest / TICK_RATE / 60, (longest / TICK_RATE) % 60);
    printf("  10분 안에 안 끝난 판: %d / %d\n", unfinished, rounds);
    printf("  첫 사망까지: %lld초\n", first / rounds / TICK_RATE);

    printf("\n--- 누가 죽이나 ---\n");
    long long dead = bubble + water;
    printf("  물풍선 %lld명 (%lld%%)   물 %lld명 (%lld%%)\n",
           bubble / rounds, dead ? bubble * 100 / dead : 0,
           water / rounds,  dead ? water * 100 / dead : 0);
    printf("  그중 자기 물풍선에 죽은 것: %lld명 (%lld%%)\n",
           self_kill / rounds, bubble ? self_kill * 100 / bubble : 0);

    printf("\n--- 압박 곡선 (30초마다) ---\n");
    printf("  시각    생존   한 명당 칸\n");
    for (int k = 0; k < 8; ++k) {
        if (alive_at[k] == 0 && k > 0) break;
        printf("  %d:%02d   %4lld   %6lld\n",
               (k + 1) * 30 / 60, ((k + 1) * 30) % 60,
               alive_at[k] / rounds, tiles_at[k] / rounds);
    }

    printf("\n--- 아이템 ---\n");
    printf("  부순 블록 %lld 개, 사람당 아이템 %lld.%lld 개\n",
           broken / rounds,
           items / rounds / PLAYER_MAX,
           (items * 10 / rounds / PLAYER_MAX) % 10);

    return 0;
}
