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
            if (t == TILE_BLOCK || t == TILE_BOX) break;   // 부수고 거기서 멈춘다
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
// 그래서 재야 하는 건 "갇혔나" 가 아니라 **몇 겹을 부숴야 돌아다닐 수 있나** 다.
//
// 9/1 에 기준을 바꿨다. 전에는 "뼈대의 절반에 닿을 때까지" 였는데,
// 상자를 100%로 채우고 나니 그건 판을 가로지르라는 뜻이 되어 19겹이 나왔다.
// 재려던 것은 그게 아니다. 재려던 것은 **언제부터 움직일 수 있나** 다.
// 그래서 목표를 "돌아다닐 만한 넓이" 로 바꿨다 (FREEDOM_TILES).
// 이만큼 돌아다닐 수 있으면 "나왔다" 고 본다.
// 한 구역이 15x13 = 195칸이니 50칸이면 구역의 1/4 이다.
// 그쯤 되면 도망갈 방향이 두 개 이상 생긴다
static const int FREEDOM_TILES = 50;

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
                else if (work[ny][nx] == TILE_BLOCK || work[ny][nx] == TILE_BOX) {
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
            if (out.tile[y][x] == TILE_BLOCK || out.tile[y][x] == TILE_BOX) out.tile[y][x] = TILE_EMPTY;
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
    int spawn_block_min, spawn_block_max;   // 판 전체에서 (참고용으로만 남긴다)
    int spawn_block_spread_max;             // 9/4 - 같은 조각 세 스폰끼리만 비교한 최댓값

    // 블록을 다 부순 뒤의 뼈대
    int struct_open;
    int struct_dead_ends;     // 판이 끝날 때까지 남는 막다른 길
    int struct_biggest;       // 뼈대가 하나로 이어지나

    int dig_max;              // 스폰에서 나가는 데 부숴야 하는 블록 겹 수
    int dig_slot;
    int dig_x, dig_y;
    const char* dig_name;
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
            if (t == TILE_BLOCK || t == TILE_BOX) { ++r.block; continue; }
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

    // 9/4 - 이 값을 판 전체 스물일곱 스폰에서 하나로 재고 있었는데,
    // GameMap::BalanceSpawnBlocks 를 조각별로 고치면서 여기도 같이 고친다.
    // 조각이 서른한 종일 때는 다 고만고만해서 판 전체로 재도 됐는데, 지금은
    // 집·우물이 있는 마을과 텐트·장터가 있는 사막처럼 **일부러 다르게 채운**
    // 손그림 조각이다. 판 전체로 재면 조각 하나의 특징이 다른 여덟 조각의
    // 목표치를 끌어내려서, 시험을 맞추려다 맵 전체 밀도를 깎게 된다.
    // 같은 조각 세 스폰끼리만 비교하는 게 지금 규칙과 맞다
    int sec_min[9], sec_max[9];
    for (int s = 0; s < 9; ++s) { sec_min[s] = 9999; sec_max[s] = 0; }

    for (int i = 0; i < m.spawn_count; ++i) {
        int sx = m.spawn_x[i], sy = m.spawn_y[i];

        // 밖으로 나가려면 블록을 몇 겹 부숴야 하나.
        // 뼈대의 절반쯤에 닿으면 "밖으로 나왔다" 고 본다
        int dig = DigDepth(m, sx, sy, FREEDOM_TILES);
        if (dig < 0)          ++r.dig_stuck;
        else if (dig > r.dig_max) {
            r.dig_max = dig;
            // 어느 조각의 어느 스폰인지 남긴다.
            // 숫자만 보고 어느 판이 문제인지 찾느라 두 번 헛짚었다
            r.dig_slot = (sy / SECTOR_H) * 3 + (sx / SECTOR_W);
            r.dig_name = m.SectorName(r.dig_slot);
            r.dig_x = sx; r.dig_y = sy;
        }

        // 반경 3 안의 블록 수. SPEC 2.2 가 (같은 조각 안에서) 비슷하게 하라고 한 값이다
        int n = 0;
        for (int y = sy - 3; y <= sy + 3; ++y) {
            for (int x = sx - 3; x <= sx + 3; ++x) {
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
                if (m.tile[y][x] == TILE_BLOCK || m.tile[y][x] == TILE_BOX) ++n;
            }
        }
        if (n < r.spawn_block_min) r.spawn_block_min = n;
        if (n > r.spawn_block_max) r.spawn_block_max = n;

        int slot = (sy / SECTOR_H) * 3 + (sx / SECTOR_W);
        if (n < sec_min[slot]) sec_min[slot] = n;
        if (n > sec_max[slot]) sec_max[slot] = n;
    }

    r.spawn_block_spread_max = 0;
    for (int s = 0; s < 9; ++s) {
        if (sec_max[s] < sec_min[s]) continue;   // 그 자리에 스폰이 없었다
        int spread = sec_max[s] - sec_min[s];
        if (spread > r.spawn_block_spread_max) r.spawn_block_spread_max = spread;
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


// ── 조각 하나하나가 약속을 지키나 ────────────────────────────
//
// SectorTemplates.h 맨 위에 약속 넷을 적어놨는데, 지키는지는 사람이 눈으로
// 봤다. 조각이 열 개일 때는 됐다. 서른한 개가 되니 안 된다 -
// 실제로 판을 스무 개 새로 그릴 때 열넷이 약속을 어겼다.
//
// 적어둔 규칙은 재기 전까지 규칙이 아니라 바람이다
static void TemplatePromises()
{
    printf("\n--- 조각 약속 (조각 %d개) ---\n", SECTOR_TEMPLATE_COUNT);

    int bad_gate = 0, bad_link = 0, bad_spawn = 0, bad_split = 0;
    int spawn_total = 0;
    const char* first_bad = nullptr;

    for (int t = 0; t < SECTOR_TEMPLATE_COUNT; ++t) {
        const SectorTemplate& T = SECTOR_TEMPLATES[t];

        // 관문 네 곳. 좌우로 뒤집으면 좌우가, 위아래로 뒤집으면 위아래가
        // 자리를 바꾸므로 어느 쪽으로 뒤집어도 관문은 관문이다
        const int GATE[4][2] = { { SECTOR_W / 2, 0 }, { SECTOR_W / 2, SECTOR_H - 1 },
                                 { 0, SECTOR_H / 2 }, { SECTOR_W - 1, SECTOR_H / 2 } };

        // 글자 뜻. ~ 는 규칙으로 벽이고 = 은 규칙으로 길이다.
        // 겉모습만 다른 것이라 여기서는 # 과 . 으로 취급한다
        // (SectorTemplates.h 맨 위 설명과 같아야 한다)

        // 1) 관문이 길인가
        bool gate_ok = true;
        for (int i = 0; i < 4; ++i) {
            char c = T.row[GATE[i][1]][GATE[i][0]];
            if (c != '.' && c != 's' && c != '=') gate_ok = false;
        }
        if (!gate_ok) { ++bad_gate; if (!first_bad) first_bad = T.name; }

        // 2) 스폰이 안쪽에 있나. 가장자리에 붙이면 옆 조각 스폰과 세 칸이 된다
        int spawns = 0;
        bool spawn_ok = true;
        for (int y = 0; y < SECTOR_H; ++y) {
            for (int x = 0; x < SECTOR_W; ++x) {
                if (T.row[y][x] != 's') continue;
                ++spawns;
                if (x < 3 || x > SECTOR_W - 4 || y < 3 || y > SECTOR_H - 4) spawn_ok = false;
            }
        }
        spawn_total += spawns;
        if (!spawn_ok || spawns == 0) { ++bad_spawn; if (!first_bad) first_bad = T.name; }

        // 3) 길(.와 s)만으로 관문 넷과 스폰이 전부 이어지나.
        //    블록이 최악으로 깔려도 시작하자마자 안 갇힌다는 뜻이다
        bool lane[SECTOR_H][SECTOR_W] = {};
        bool seen[SECTOR_H][SECTOR_W] = {};
        for (int y = 0; y < SECTOR_H; ++y)
            for (int x = 0; x < SECTOR_W; ++x)
                lane[y][x] = (T.row[y][x] == '.' || T.row[y][x] == 's'
                              || T.row[y][x] == '=');

        int qx[SECTOR_W * SECTOR_H], qy[SECTOR_W * SECTOR_H], qn = 0;
        qx[qn] = GATE[0][0]; qy[qn] = GATE[0][1]; ++qn;
        seen[GATE[0][1]][GATE[0][0]] = true;
        for (int h = 0; h < qn; ++h) {
            for (int d = 0; d < 4; ++d) {
                int nx = qx[h] + DX[d], ny = qy[h] + DY[d];
                if (nx < 0 || ny < 0 || nx >= SECTOR_W || ny >= SECTOR_H) continue;
                if (!lane[ny][nx] || seen[ny][nx]) continue;
                seen[ny][nx] = true;
                qx[qn] = nx; qy[qn] = ny; ++qn;
            }
        }
        bool link_ok = true;
        for (int i = 0; i < 4; ++i) if (!seen[GATE[i][1]][GATE[i][0]]) link_ok = false;
        for (int y = 0; y < SECTOR_H; ++y)
            for (int x = 0; x < SECTOR_W; ++x)
                if (T.row[y][x] == 's' && !seen[y][x]) link_ok = false;
        if (!link_ok) { ++bad_link; if (!first_bad) first_bad = T.name; }

        // 4) 벽으로 갈라진 칸이 없나. 벽이 아닌 칸이 전부 한 덩어리여야 한다
        bool vis[SECTOR_H][SECTOR_W] = {};
        int open_n = 0, sx = -1, sy = -1;
        for (int y = 0; y < SECTOR_H; ++y) {
            for (int x = 0; x < SECTOR_W; ++x) {
                if (T.row[y][x] == '#' || T.row[y][x] == '~') continue;
                ++open_n;
                if (sx < 0) { sx = x; sy = y; }
            }
        }
        qn = 0; qx[qn] = sx; qy[qn] = sy; ++qn;
        vis[sy][sx] = true;
        int reach = 1;
        for (int h = 0; h < qn; ++h) {
            for (int d = 0; d < 4; ++d) {
                int nx = qx[h] + DX[d], ny = qy[h] + DY[d];
                if (nx < 0 || ny < 0 || nx >= SECTOR_W || ny >= SECTOR_H) continue;
                if (T.row[ny][nx] == '#' || T.row[ny][nx] == '~'
                    || vis[ny][nx]) continue;
                vis[ny][nx] = true; ++reach;
                qx[qn] = nx; qy[qn] = ny; ++qn;
            }
        }
        if (reach != open_n) { ++bad_split; if (!first_bad) first_bad = T.name; }
    }

    printf("  스폰 %d개 (조각당 %d.%d)\n", spawn_total,
           spawn_total / SECTOR_TEMPLATE_COUNT,
           (spawn_total * 10 / SECTOR_TEMPLATE_COUNT) % 10);
    if (first_bad) printf("  처음 어긴 조각: %s\n", first_bad);

    Check(bad_gate == 0,  "조각마다 관문 네 곳이 길이다");
    Check(bad_link == 0,  "길만으로 관문 넷과 스폰이 전부 이어진다");
    Check(bad_spawn == 0, "스폰이 조각 가장자리 세 칸 안쪽에 있다");
    Check(bad_split == 0, "벽으로 갈라져 못 가는 칸이 없다");
}

// 9/4에 잡은 버그의 재발 시험이다.
//
// 화면이 "벽이 W x H 만큼 뭉친 자리"를 스스로 찾아 집·우물 중 하나를
// 무작위로 얹던 옛 방식은, 강가처럼 우연히 벽이 뭉친 자리에도 걸려서
// 한 판에 우물 대여섯 채가 서고 집은 하나도 안 서는 일이 실제로 있었다.
// 지금은 조각을 그릴 때 자리를 못 박아 보낸다(SectorLandmark) - 이 시험은
// 그 못 박은 자리가 ① 조각 원본에서 정말 전부 벽인지 ② 판에 실제로 찍고
// 나서도(뒤집기 포함) 여전히 전부 벽인지 ③ 조각 하나가 낸 개수만큼만
// 판에 남아있는지(우연히 더 늘거나 준 게 없는지) 를 잰다
static void LandmarkPromises()
{
    printf("\n--- 큰 구조물(집·우물·텐트·얼음성 등) 약속 ---\n");

    int bad_origin = 0;
    for (int t = 0; t < SECTOR_TEMPLATE_COUNT; ++t) {
        const SectorTemplate& T = SECTOR_TEMPLATES[t];
        for (int i = 0; i < T.landmark_count; ++i) {
            const SectorLandmark& lm = T.landmark[i];
            for (int dy = 0; dy < lm.h; ++dy) {
                for (int dx = 0; dx < lm.w; ++dx) {
                    if (T.row[lm.y + dy][lm.x + dx] != '#') {
                        ++bad_origin;
                        printf("  [원본 어김] %s landmark %d 의 (%d,%d) 가 벽이 아니다 ('%c')\n",
                               T.name, i, lm.x + dx, lm.y + dy, T.row[lm.y + dy][lm.x + dx]);
                    }
                }
            }
        }
    }
    Check(bad_origin == 0, "조각 원본에서 랜드마크 자리는 전부 벽이다");

    // 씨앗 여러 개로 실제 판을 깔아서, 찍힌 뒤에도 여전히 성립하는지 본다.
    // 뒤집기(좌우·상하)가 걸리면 좌표가 바뀌므로, 여기서 진짜로 잡아낸다
    int bad_final = 0, bad_overlap = 0, bad_count = 0;
    for (unsigned s = 1; s <= 200; ++s) {
        GameMap m;
        m.Generate(s);

        int want = 0;
        for (int slot = 0; slot < SECTOR_SLOTS; ++slot) {
            want += SECTOR_TEMPLATES[m.sector_template[slot]].landmark_count;
        }
        if (m.landmark_count != want) ++bad_count;

        bool claimed[MAP_H][MAP_W] = {};
        for (int i = 0; i < m.landmark_count; ++i) {
            const auto& lm = m.landmark[i];
            int w = 2, h = 2;
            // 뼈 유적(사막 kind 2)만 2x1이다 - SectorTemplates.h 와 같은 값을 여기 한 번 더 적지
            // 않으려면 landmark 에서 w/h 를 그대로 들고 와야 하는데, 판에는 kind/theme 만
            // 남아 있어서 여기서는 "2x1도 있다"는 것만 알고 둘 다 검사한다
            if (lm.theme == 5 && lm.kind == 2) h = 1;
            for (int dy = 0; dy < h; ++dy) {
                for (int dx = 0; dx < w; ++dx) {
                    int x = lm.x + dx, y = lm.y + dy;
                    if (x >= MAP_W || y >= MAP_H || m.tile[y][x] != TILE_WALL) ++bad_final;
                    if (x < MAP_W && y < MAP_H) {
                        if (claimed[y][x]) ++bad_overlap;
                        claimed[y][x] = true;
                    }
                }
            }
        }
    }
    printf("  판 200개, 랜드마크 %d개 확인\n", 200);
    Check(bad_count == 0,   "조각이 낸 개수만큼 판에도 랜드마크가 있다");
    Check(bad_final == 0,   "뒤집힌 뒤에도 랜드마크 자리는 전부 벽이다");
    Check(bad_overlap == 0, "랜드마크끼리 자리가 안 겹친다");
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
    int dig_deep = 0, dig_deep_x = 0, dig_deep_y = 0;
    const char* dig_deep_name = nullptr;
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

        // 제일 깊이 갇힌 자리를 하나 들고 있는다. 어느 조각인지 알아야 고칠 수 있다
        if (r.dig_max > dig_deep) {
            dig_deep = r.dig_max;
            dig_deep_name = r.dig_name;
            dig_deep_x = r.dig_x; dig_deep_y = r.dig_y;
        }

        if (r.dig_max > dig_worst) dig_worst = r.dig_max;
        dig_stuck_total += r.dig_stuck;

        if (r.spawn_block_spread_max > spread_max) spread_max = r.spawn_block_spread_max;
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
    if (dig_deep_name) {
        printf("  제일 깊이 갇힌 자리: %s 조각의 (%d,%d)\n",
               dig_deep_name, dig_deep_x, dig_deep_y);
    }
    printf("  스폰에서 돌아다닐 수 있을 때까지: 최대 %d 겹 (%d.%d초)\n",
           dig_worst, dig_worst * BUBBLE_FUSE_TICKS / TICK_RATE,
           (dig_worst * BUBBLE_FUSE_TICKS * 10 / TICK_RATE) % 10);
    printf("  아예 못 나가는 스폰: %d 개\n", dig_stuck_total);

    printf("\n--- 뼈대 (블록을 다 부순 뒤) ---\n");
    printf("  빈칸 %lld 개, 그중 하나로 이어진 게 %lld 개\n",
           struct_open / TRIES, struct_big / TRIES);
    printf("  끝까지 남는 막다른 길: %lld 개\n", struct_dead / TRIES);

    printf("\n--- 공정성 (같은 조각 세 스폰끼리) ---\n");
    printf("  스폰 주변(반경3) 블록 수 차이: 최대 %d 개\n", spread_max);
    printf("  제일 가까운 두 스폰: %d 칸 (씨앗 %u)\n", gap_min, gap_seed);

    TemplatePromises();
    LandmarkPromises();

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
    Check(dig_worst <= 5,
          "스폰에서 다섯 겹 안에 돌아다닐 수 있게 된다");
    // 물줄기가 사거리 2 로 뻗으니 5칸이면 겨우 밖이다.
    // 조각 안에서 아무리 잘 떨어뜨려도 조각을 붙이는 순간 경계 너머와 가까워질 수 있어서
    // 조각이 아니라 붙여놓은 판에서 잰다
    Check(gap_min >= BLAST_BASE_RANGE * 3,
          "제일 가까운 두 스폰도 기본 사거리의 세 배만큼 떨어져 있다");
    Check(spread_max <= 12,
          "같은 조각 세 스폰끼리는 주변 블록 수 차이가 12개 이하다");

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
