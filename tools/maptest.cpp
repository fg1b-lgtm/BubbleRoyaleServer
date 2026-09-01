// tools/maptest.cpp — 맵이 싸울 만한 판인지 숫자로 잰다
//
// 봄버맨류 맵의 좋고 나쁨은 취향이 아니라 구조다. 잴 수 있다.
//
// 여기서 재는 것
//   ① 탈출 거리   내 물풍선을 놓고 안전한 칸까지 몇 걸음인가.
//                 못 가는 칸이 하나라도 있으면 그건 실력으로 못 사는 자리다
//   ② 막다른 길   이어진 방향이 하나뿐인 칸. 여기서 만나면 끝이다
//   ③ 스폰 공정성 스폰 주변 블록 수가 사람마다 얼마나 다른가
//   ④ 연결성      시작하자마자 블록에 갇힌 사람이 있는가
//   ⑤ 밀도        벽 / 블록 / 빈칸 비율
//
// 서버를 안 켜도 된다. 맵 생성만 꺼내서 두들긴다.
//
// 컴파일: practice 폴더에서  build.bat ..\tools\maptest.cpp
// 실행  : practice\bin\maptest.exe        요약만
//         practice\bin\maptest.exe 1234   그 씨앗 맵을 그려서 같이 본다
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "../Server/src/GameMap.h"

static int g_pass = 0;
static int g_fail = 0;

static void Check(bool ok, const char* what)
{
    if (ok) { ++g_pass; printf("  [PASS] %s\n", what); }
    else    { ++g_fail; printf("  [FAIL] %s\n", what); }
}

static const int DX[4] = {  1, -1,  0,  0 };
static const int DY[4] = {  0,  0,  1, -1 };

// 라운드가 시작된 순간 지나갈 수 있는 칸인가.
// 블록은 부수면 열리지만 지금 당장은 못 지나간다
static bool Walkable(const GameMap& m, int x, int y)
{
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    return m.tile[y][x] == TILE_EMPTY;
}

// ── ① 탈출 거리 ──────────────────────────────────────────────
//
// (sx,sy) 에 사거리 R 짜리 물풍선을 놓았다고 치고,
// 물줄기가 안 닿는 칸까지 몇 걸음인지 잰다.
//
// 봄버맨류에서 제일 중요한 숫자다. 이게 크면 자기 폭탄에 죽는다.
// 아예 못 가면 그 칸은 놓는 순간 죽는 자리다.
static int EscapeSteps(const GameMap& m, int sx, int sy, int range)
{
    // 물줄기가 덮는 칸을 먼저 칠한다
    static bool danger[MAP_H][MAP_W];
    memset(danger, 0, sizeof(danger));
    danger[sy][sx] = true;

    for (int d = 0; d < 4; ++d) {
        for (int step = 1; step <= range; ++step) {
            int x = sx + DX[d] * step;
            int y = sy + DY[d] * step;
            if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) break;

            uint8_t t = m.tile[y][x];
            if (t == TILE_WALL)  break;
            danger[y][x] = true;
            if (t == TILE_BLOCK) break;   // 블록을 부수고 거기서 멈춘다
        }
    }

    // 안전한 칸까지 너비 우선으로 걸어간다
    static int dist[MAP_H][MAP_W];
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            dist[y][x] = -1;

    static int qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];
    int head = 0, tail = 0;

    dist[sy][sx] = 0;
    qx[tail] = sx; qy[tail] = sy; ++tail;

    while (head < tail) {
        int x = qx[head], y = qy[head];
        ++head;

        if (!danger[y][x]) {
            return dist[y][x];   // 여기까지 오면 산다
        }

        for (int d = 0; d < 4; ++d) {
            int nx = x + DX[d], ny = y + DY[d];
            if (!Walkable(m, nx, ny)) continue;
            if (dist[ny][nx] >= 0)    continue;

            dist[ny][nx] = dist[y][x] + 1;
            qx[tail] = nx; qy[tail] = ny; ++tail;
        }
    }

    return -1;   // 도망칠 데가 없다
}

// ── ② 막다른 길 ──────────────────────────────────────────────
static int OpenNeighbors(const GameMap& m, int x, int y)
{
    int n = 0;
    for (int d = 0; d < 4; ++d) {
        if (Walkable(m, x + DX[d], y + DY[d])) ++n;
    }
    return n;
}

// ── ④ 연결성 ─────────────────────────────────────────────────
//
// 지금 당장 걸어서 갈 수 있는 칸을 하나 골라 전부 세어 본다.
// 제일 큰 덩어리에 안 들어가는 칸은 블록에 둘러싸인 주머니다
static int LargestOpenRegion(const GameMap& m, bool* visited_out)
{
    static bool seen[MAP_H][MAP_W];
    memset(seen, 0, sizeof(seen));

    static int qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];
    int best = 0;

    static bool best_mask[MAP_H][MAP_W];
    memset(best_mask, 0, sizeof(best_mask));

    for (int sy = 0; sy < MAP_H; ++sy) {
        for (int sx = 0; sx < MAP_W; ++sx) {
            if (!Walkable(m, sx, sy) || seen[sy][sx]) continue;

            int head = 0, tail = 0;
            seen[sy][sx] = true;
            qx[tail] = sx; qy[tail] = sy; ++tail;

            while (head < tail) {
                int x = qx[head], y = qy[head];
                ++head;
                for (int d = 0; d < 4; ++d) {
                    int nx = x + DX[d], ny = y + DY[d];
                    if (!Walkable(m, nx, ny) || seen[ny][nx]) continue;
                    seen[ny][nx] = true;
                    qx[tail] = nx; qy[tail] = ny; ++tail;
                }
            }

            if (tail > best) {
                best = tail;
                memset(best_mask, 0, sizeof(best_mask));
                for (int i = 0; i < tail; ++i) best_mask[qy[i]][qx[i]] = true;
            }
        }
    }

    if (visited_out) {
        memcpy(visited_out, best_mask, sizeof(best_mask));
    }
    return best;
}

// ── 파고 나가는 비용 ─────────────────────────────────────────
//
// 시작하자마자 블록에 둘러싸여 있는 건 잘못이 아니다. 봄버맨은 원래 그렇다.
// 그게 파밍 구간이고, 맵이 시간에 따라 열리는 장치다.
//
// 그래서 재야 하는 건 "갇혔나" 가 아니라 **몇 개를 부숴야 나가나** 다.
// 블록 하나에 2.5초니까, 세 개면 7.5초다. 그 이상이면 시작이 답답하다.
static int DigDepth(const GameMap& m, int sx, int sy, int target_region_size)
{
    static uint8_t work[MAP_H][MAP_W];
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            work[y][x] = m.tile[y][x];

    static bool seen[MAP_H][MAP_W];
    static int  qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];

    for (int depth = 0; depth < 20; ++depth) {
        memset(seen, 0, sizeof(seen));
        int head = 0, tail = 0;

        seen[sy][sx] = true;
        qx[tail] = sx; qy[tail] = sy; ++tail;

        // 지금 부순 만큼으로 갈 수 있는 데를 전부 센다
        int reach = 0;
        int blocks_touched = 0;
        static int tbx[MAP_W * MAP_H], tby[MAP_W * MAP_H];

        while (head < tail) {
            int x = qx[head], y = qy[head];
            ++head;
            ++reach;

            for (int d = 0; d < 4; ++d) {
                int nx = x + DX[d], ny = y + DY[d];
                if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
                if (seen[ny][nx]) continue;

                if (work[ny][nx] == TILE_EMPTY) {
                    seen[ny][nx] = true;
                    qx[tail] = nx; qy[tail] = ny; ++tail;
                }
                else if (work[ny][nx] == TILE_BLOCK) {
                    seen[ny][nx] = true;
                    tbx[blocks_touched] = nx; tby[blocks_touched] = ny;
                    ++blocks_touched;
                }
            }
        }

        if (reach >= target_region_size) {
            return depth;
        }
        if (blocks_touched == 0) {
            return -1;   // 부술 것도 없는데 못 나간다. 고정 벽에 갇혔다
        }

        // 닿아 있는 블록을 한 겹 부순다
        for (int i = 0; i < blocks_touched; ++i) {
            work[tby[i]][tbx[i]] = TILE_EMPTY;
        }
    }

    return -1;
}

// ── 블록을 다 부순 뒤의 구조 ─────────────────────────────────
//
// 블록은 사라지는 것이라 구조가 아니다. 고정 벽만 남겼을 때가 진짜 뼈대다.
// 여기에 막다른 길이 있으면 그건 판이 끝날 때까지 남는다
static void StructureOnly(const GameMap& src, GameMap& out)
{
    out = src;
    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (out.tile[y][x] == TILE_BLOCK) out.tile[y][x] = TILE_EMPTY;
        }
    }
}

// ── 맵 하나를 재고 결과를 담는다 ─────────────────────────────
struct Report
{
    int open, wall, block;
    int dead_ends;          // 이어진 방향이 하나뿐인 칸
    int death_tiles;        // 물풍선을 놓으면 도망칠 데가 없는 칸
    int worst_escape;       // 제일 먼 탈출 거리
    int escape_sum, escape_n;
    int biggest_region;
    int spawn_block_min, spawn_block_max;

    // 블록을 다 부순 뒤의 뼈대
    int struct_open;
    int struct_dead_ends;     // 판이 끝날 때까지 남는 막다른 길
    int struct_biggest;       // 뼈대가 하나로 이어지나

    int dig_max;              // 스폰에서 나가는 데 부숴야 하는 블록 겹 수
    int dig_stuck;            // 아예 못 나가는 스폰

    // 제일 가까운 두 스폰 사이의 거리 (칸, 가로세로 중 큰 쪽).
    //
    // 조각 안에서만 떨어뜨려 놓으면 안 된다. 조각 경계 너머의 스폰과 붙기 때문이다.
    // 물줄기 사거리가 2 이므로 최소한 그 두 배는 떨어져야 시작하자마자 사정권이 아니다
    int spawn_min_gap;
};

static void Measure(const GameMap& m, int range, Report& r)
{
    memset(&r, 0, sizeof(r));
    r.worst_escape = 0;
    r.spawn_block_min = 9999;
    r.spawn_block_max = 0;

    static bool big[MAP_H][MAP_W];
    r.biggest_region = LargestOpenRegion(m, &big[0][0]);

    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            uint8_t t = m.tile[y][x];
            if (t == TILE_WALL)  { ++r.wall;  continue; }
            if (t == TILE_BLOCK) { ++r.block; continue; }
            ++r.open;

            if (OpenNeighbors(m, x, y) <= 1) {
                ++r.dead_ends;
            }

            int e = EscapeSteps(m, x, y, range);
            if (e < 0) {
                ++r.death_tiles;
            }
            else {
                r.escape_sum += e;
                ++r.escape_n;
                if (e > r.worst_escape) r.worst_escape = e;
            }
        }
    }

    // 블록을 다 부순 뒤의 뼈대를 잰다
    GameMap bones;
    StructureOnly(m, bones);
    r.struct_biggest = LargestOpenRegion(bones, nullptr);

    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (bones.tile[y][x] != TILE_EMPTY) continue;
            ++r.struct_open;
            if (OpenNeighbors(bones, x, y) <= 1) ++r.struct_dead_ends;
        }
    }

    r.spawn_min_gap = 9999;
    for (int i = 0; i < m.spawn_count; ++i) {
        for (int j = i + 1; j < m.spawn_count; ++j) {
            int dx = m.spawn_x[i] - m.spawn_x[j];
            int dy = m.spawn_y[i] - m.spawn_y[j];
            if (dx < 0) dx = -dx;
            if (dy < 0) dy = -dy;
            int gap = (dx > dy) ? dx : dy;
            if (gap < r.spawn_min_gap) r.spawn_min_gap = gap;
        }
    }

    for (int i = 0; i < m.spawn_count; ++i) {
        int sx = m.spawn_x[i], sy = m.spawn_y[i];

        // 밖으로 나가려면 블록을 몇 겹 부숴야 하나.
        // 뼈대의 절반쯤에 닿으면 "밖으로 나왔다" 고 본다
        int dig = DigDepth(m, sx, sy, r.struct_biggest / 2);
        if (dig < 0)          ++r.dig_stuck;
        else if (dig > r.dig_max) r.dig_max = dig;

        // 반경 3 안의 블록 수. SPEC 2.2 가 조각 간에 비슷하게 하라고 한 값이다
        int n = 0;
        for (int y = sy - 3; y <= sy + 3; ++y) {
            for (int x = sx - 3; x <= sx + 3; ++x) {
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
                if (m.tile[y][x] == TILE_BLOCK) ++n;
            }
        }
        if (n < r.spawn_block_min) r.spawn_block_min = n;
        if (n > r.spawn_block_max) r.spawn_block_max = n;
    }
}

// 밀도를 바꿔가며 재본다. 어느 밀도가 좋은지는 취향이 아니라 숫자로 고른다
static void Sweep()
{
    printf("=== 밀도별 비교 (맵 40개씩, 기본 사거리 %d) ===\n\n", BLAST_BASE_RANGE);
    printf("  밀도  블록%%  블록수  아이템  죽음칸  파는깊이  파는시간\n");

    for (int pct = 20; pct <= 60; pct += 5) {
        long long block = 0, death = 0, total = 0;
        int dig_worst = 0;

        for (int i = 0; i < 40; ++i) {
            GameMap m;
            m.Generate(2000u + i * 7919u, pct);

            Report r;
            Measure(m, BLAST_BASE_RANGE, r);

            block += r.block;
            total += r.open + r.block + r.wall;
            death += r.death_tiles;
            if (r.dig_max > dig_worst) dig_worst = r.dig_max;
        }

        long long blocks = block / 40;
        long long items  = blocks * ITEM_DROP_PERCENT / 100;

        printf("  %3d%%  %4lld%%  %6lld  %6lld  %6lld  %8d  %5d.%d초\n",
               pct, block * 100 / total, blocks, items, death / 40,
               dig_worst,
               dig_worst * BUBBLE_FUSE_TICKS / TICK_RATE,
               (dig_worst * BUBBLE_FUSE_TICKS * 10 / TICK_RATE) % 10);
    }
    printf("\n  아이템은 블록 수 x 드롭 %d%%. 24명이 나눠 먹는다.\n", ITEM_DROP_PERCENT);
    printf("  파는 깊이는 스폰에서 밖으로 나가기까지 부숴야 하는 블록 겹 수다.\n\n");
}

int main(int argc, char** argv)
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    Sweep();

    const int range = BLAST_BASE_RANGE;   // 아이템 없는 기본 사거리로 잰다
    const int TRIES = 200;

    printf("=== 맵 %d개를 잰다 (기본 사거리 %d) ===\n", TRIES, range);

    long long open = 0, block = 0, wall = 0;
    long long dead = 0, death = 0, esc_sum = 0, esc_n = 0;
    int worst = 0, worst_seed = 0;
    int bad_maps = 0;
    int spread_max = 0;
    int gap_min = 9999;
    unsigned int gap_seed = 0;
    long long pocket_total = 0;
    long long struct_open = 0, struct_dead = 0, struct_big = 0;
    int dig_worst = 0, dig_stuck_total = 0;

    for (int i = 0; i < TRIES; ++i) {
        unsigned int seed = 1000u + i * 7919u;

        GameMap m;
        m.Generate(seed);

        Report r;
        Measure(m, range, r);

        open  += r.open;
        block += r.block;
        wall  += r.wall;
        dead  += r.dead_ends;
        death += r.death_tiles;
        esc_sum += r.escape_sum;
        esc_n   += r.escape_n;
        pocket_total += (r.open - r.biggest_region);

        struct_open += r.struct_open;
        struct_dead += r.struct_dead_ends;
        struct_big  += r.struct_biggest;

        if (r.dig_max > dig_worst) dig_worst = r.dig_max;
        dig_stuck_total += r.dig_stuck;

        int spread = r.spawn_block_max - r.spawn_block_min;
        if (spread > spread_max) spread_max = spread;
        if (r.spawn_min_gap < gap_min) { gap_min = r.spawn_min_gap; gap_seed = seed; }

        if (r.worst_escape > worst) { worst = r.worst_escape; worst_seed = (int)seed; }
        if (r.death_tiles > 0 || r.dig_stuck > 0) ++bad_maps;
    }

    long long total = open + block + wall;

    printf("\n--- 밀도 ---\n");
    printf("  빈칸 %lld%%   블록 %lld%%   고정벽 %lld%%\n",
           open * 100 / total, block * 100 / total, wall * 100 / total);

    printf("\n--- 탈출 거리 (물풍선 놓고 안전한 칸까지) ---\n");
    printf("  평균 %lld.%02lld 걸음\n", esc_sum / esc_n, (esc_sum * 100 / esc_n) % 100);
    printf("  최악 %d 걸음 (씨앗 %d)\n", worst, worst_seed);
    printf("  도망칠 데가 없는 칸: 맵당 평균 %lld.%02lld 개\n",
           death / TRIES, (death * 100 / TRIES) % 100);

    printf("\n--- 시작 시점 (블록이 아직 서 있다) ---\n");
    printf("  막다른 길 %lld 개 / 빈칸 %lld 개\n", dead / TRIES, open / TRIES);
    printf("  큰 덩어리 밖 %lld 개  ← 이건 정상이다. 파밍 구간이 여기서 나온다\n",
           pocket_total / TRIES);
    printf("  스폰에서 나가는 데 부숴야 하는 블록: 최대 %d 겹 (%d.%d초)\n",
           dig_worst, dig_worst * BUBBLE_FUSE_TICKS / TICK_RATE,
           (dig_worst * BUBBLE_FUSE_TICKS * 10 / TICK_RATE) % 10);
    printf("  아예 못 나가는 스폰: %d 개\n", dig_stuck_total);

    printf("\n--- 뼈대 (블록을 다 부순 뒤) ---\n");
    printf("  빈칸 %lld 개, 그중 하나로 이어진 게 %lld 개\n",
           struct_open / TRIES, struct_big / TRIES);
    printf("  끝까지 남는 막다른 길: %lld 개\n", struct_dead / TRIES);

    printf("\n--- 공정성 ---\n");
    printf("  스폰 주변(반경3) 블록 수 차이: 최대 %d 개\n", spread_max);
    printf("  제일 가까운 두 스폰: %d 칸 (씨앗 %u)\n", gap_min, gap_seed);

    printf("\n--- 판정 ---\n");
    Check(death == 0,
          "물풍선을 놓으면 무조건 죽는 칸이 하나도 없다");
    Check(worst <= 6,
          "제일 먼 탈출 거리가 6걸음 이하다 (2초 안에 간다)");
    Check(struct_dead == 0,
          "뼈대에 막다른 길이 없다 (판이 끝날 때까지 남는 자리)");
    Check(struct_open == struct_big,
          "블록을 다 부수면 맵이 하나로 이어진다");
    Check(dig_stuck_total == 0,
          "아무리 부숴도 못 나가는 스폰이 없다");
    Check(dig_worst <= 3,
          "스폰에서 세 겹 안에 밖으로 나간다 (7.5초)");
    // 물줄기가 사거리 2 로 뻗으니 5칸이면 겨우 밖이다.
    // 조각 안에서 아무리 잘 떨어뜨려도 조각을 붙이는 순간 경계 너머와 가까워질 수 있어서
    // 조각이 아니라 붙여놓은 판에서 잰다
    Check(gap_min >= BLAST_BASE_RANGE * 3,
          "제일 가까운 두 스폰도 기본 사거리의 세 배만큼 떨어져 있다");
    Check(spread_max <= 12,
          "스폰끼리 주변 블록 수 차이가 12개 이하다");

    printf("\n===== 결과: %d PASS / %d FAIL =====\n", g_pass, g_fail);

    if (argc > 1) {
        unsigned int seed = (unsigned int)atoi(argv[1]);
        GameMap m;
        m.Generate(seed);

        Report r;
        Measure(m, range, r);

        printf("\n=== 씨앗 %u ===\n", seed);
        printf("빈칸 %d  블록 %d  벽 %d  막다른길 %d  죽음의칸 %d  최악탈출 %d\n",
               r.open, r.block, r.wall, r.dead_ends, r.death_tiles, r.worst_escape);
        m.Dump();
    }

    return g_fail == 0 ? 0 : 1;
}
