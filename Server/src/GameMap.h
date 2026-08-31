// Server/src/GameMap.h — 판이 깔리는 곳
//
// 45 x 39 칸. 맵 조각(15 x 13) 아홉 개를 3x3 으로 붙인 크기다.
//
// 소유 스레드 : tick
//   틱 스레드가 만들고 틱 스레드만 고친다. 그래서 자물쇠가 없다.
//   워커는 이 파일을 아예 안 본다.
//
// 여기는 계산만 한다. 소켓도 세션도 모른다.
// 그래야 tools/movetest.cpp 처럼 서버를 안 켜고도 판정을 시험할 수 있다.
//
// 아직 안 하는 것
//   SPEC 2.2 의 "미리 만들어둔 15종 중 9개를 랜덤 배치" 는 파일 로딩이 필요하다.
//   지금은 같은 규칙(고정 기둥, 변 가운데 통로, 스폰 주변 비우기)으로 그 자리에서 만든다.
//   조각 파일은 나중에 이 Generate 만 바꿔 끼우면 된다.
#pragma once

#include <cstdio>
#include "GameConstants.h"

// 매판 같은 맵이 나오면 안 되지만, 로그를 다시 보려면 같은 맵이 다시 나와야 한다.
// 그래서 시각이 아니라 씨앗 하나로 정한다. 씨앗만 적어두면 그 판이 그대로 재현된다.
struct MapRandom
{
    unsigned int state;

    void Seed(unsigned int s) { state = s ? s : 1; }

    // 0 이상 n 미만
    int Next(int n)
    {
        state = state * 1103515245u + 12345u;
        return (int)((state >> 16) % (unsigned int)n);
    }
};

struct GameMap
{
    uint8_t tile[MAP_H][MAP_W];

    // 스폰 자리. 판이 시작할 때 여기에 사람을 앉힌다
    int spawn_x[SPAWN_TOTAL];
    int spawn_y[SPAWN_TOTAL];
    int spawn_count = 0;

    unsigned int seed = 0;

    // 밖은 전부 벽이라고 답한다.
    // 이렇게 해두면 이동 계산에서 맵 밖인지를 따로 안 봐도 된다.
    bool IsSolid(int tx, int ty) const
    {
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) {
            return true;
        }
        return tile[ty][tx] != TILE_EMPTY;
    }

    bool IsBlock(int tx, int ty) const
    {
        if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) {
            return false;
        }
        return tile[ty][tx] == TILE_BLOCK;
    }

    // block_percent 를 따로 받는 이유는 밀도를 바꿔가며 재보기 위해서다.
    // tools/maptest.cpp 가 여러 밀도로 돌려서 어디가 좋은지 숫자로 고른다
    void Generate(unsigned int s, int block_percent = BLOCK_FILL_PERCENT)
    {
        MapRandom rnd;
        rnd.Seed(s);
        seed = s;
        spawn_count = 0;

        // 1) 일단 전부 통로로 깔고 테두리만 벽으로 두른다
        for (int y = 0; y < MAP_H; ++y) {
            for (int x = 0; x < MAP_W; ++x) {
                bool edge = (x == 0 || y == 0 || x == MAP_W - 1 || y == MAP_H - 1);
                tile[y][x] = edge ? TILE_WALL : TILE_EMPTY;
            }
        }

        // 2) 봄버맨식 고정 기둥. x 와 y 가 둘 다 짝수인 교차점
        for (int y = 2; y < MAP_H - 1; y += 2) {
            for (int x = 2; x < MAP_W - 1; x += 2) {
                tile[y][x] = TILE_WALL;
            }
        }

        // 3) 스폰 자리를 먼저 정한다. 블록을 깔기 전에 잡아야 주변을 비울 수 있다.
        //    조각 하나에 세 자리. 서로 최대한 떨어뜨린다
        const int local_x[SPAWN_PER_SECTOR] = { 1, SECTOR_W - 2, SECTOR_W / 2 };
        const int local_y[SPAWN_PER_SECTOR] = { 1, 1,            SECTOR_H - 2 };

        for (int sy = 0; sy < SECTOR_ROWS; ++sy) {
            for (int sx = 0; sx < SECTOR_COLS; ++sx) {
                for (int i = 0; i < SPAWN_PER_SECTOR; ++i) {
                    int gx = sx * SECTOR_W + local_x[i];
                    int gy = sy * SECTOR_H + local_y[i];

                    spawn_x[spawn_count] = gx;
                    spawn_y[spawn_count] = gy;
                    ++spawn_count;
                }
            }
        }

        // 4) 파괴 가능 블록을 확률로 깐다
        for (int y = 1; y < MAP_H - 1; ++y) {
            for (int x = 1; x < MAP_W - 1; ++x) {
                if (tile[y][x] != TILE_EMPTY) {
                    continue;
                }
                if (rnd.Next(100) < block_percent) {
                    tile[y][x] = TILE_BLOCK;
                }
            }
        }

        // 5) 스폰 주변을 비운다. 시작하자마자 블록에 갇히면 안 된다.
        //    기둥까지 지운다. 시작 직후 갇히는 것보다 기둥 몇 개 없는 게 낫다
        for (int i = 0; i < spawn_count; ++i) {
            ClearAround(spawn_x[i], spawn_y[i], SPAWN_CLEAR_RADIUS);
            ConnectSpawnToLanes(spawn_x[i], spawn_y[i]);
        }

        // 6) 조각 경계의 가운데 세 칸은 반드시 통로.
        //    조각을 어떻게 붙여도 옆 조각으로 건너갈 수 있어야 한다
        OpenSectorGates();

        // 7) 스폰끼리 주변 블록 수를 비슷하게 맞춘다.
        //    블록은 곧 아이템이라, 여기가 어긋나면 1분 뒤 아이템 차이가 된다
        BalanceSpawnBlocks(rnd);

        // 8) 물풍선을 놓으면 무조건 죽는 칸을 없앤다.
        //    블록을 그냥 확률로 깔면 자잘한 주머니가 잔뜩 생기는데,
        //    그런 칸에서는 실력으로 살 방법이 없다. 그건 패배가 아니라 벌칙이다
        OpenDeathTraps(BLAST_BASE_RANGE);
    }

    void Dump() const
    {
        for (int y = 0; y < MAP_H; ++y) {
            char line[MAP_W + 1];
            for (int x = 0; x < MAP_W; ++x) {
                line[x] = (tile[y][x] == TILE_WALL)  ? '#'
                        : (tile[y][x] == TILE_BLOCK) ? '*'
                        :                              '.';
            }
            line[MAP_W] = '\0';
            printf("%s\n", line);
        }
    }

    // 여기 사거리 range 짜리 물풍선을 놓고 살아나갈 수 있나.
    //
    // 봄버맨류 맵에서 제일 중요한 질문이다.
    // 십자 폭발은 모서리를 못 돈다. 그래서 살길은 늘 "꺾어 들어가는 칸" 이다.
    // 그런 칸이 하나도 없으면 그 자리는 놓는 순간 죽는 자리다.
    bool CanEscape(int sx, int sy, int range) const
    {
        static const int DX[4] = { 1, -1,  0,  0 };
        static const int DY[4] = { 0,  0,  1, -1 };

        bool danger[MAP_H][MAP_W] = {};
        danger[sy][sx] = true;

        for (int d = 0; d < 4; ++d) {
            for (int step = 1; step <= range; ++step) {
                int x = sx + DX[d] * step;
                int y = sy + DY[d] * step;
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) break;

                uint8_t t = tile[y][x];
                if (t == TILE_WALL) break;
                danger[y][x] = true;
                if (t == TILE_BLOCK) break;
            }
        }

        bool seen[MAP_H][MAP_W] = {};
        int  qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];
        int  head = 0, tail = 0;

        seen[sy][sx] = true;
        qx[tail] = sx; qy[tail] = sy; ++tail;

        while (head < tail) {
            int x = qx[head], y = qy[head];
            ++head;

            if (!danger[y][x]) {
                return true;
            }

            for (int d = 0; d < 4; ++d) {
                int nx = x + DX[d], ny = y + DY[d];
                if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
                if (tile[ny][nx] != TILE_EMPTY || seen[ny][nx])     continue;

                seen[ny][nx] = true;
                qx[tail] = nx; qy[tail] = ny; ++tail;
            }
        }

        return false;
    }

private:
    // 스폰을 고속도로에 붙인다.
    //
    // 기둥은 x 와 y 가 둘 다 짝수인 자리에만 있다.
    // 그래서 x 나 y 가 홀수인 줄에는 기둥이 하나도 없다. 끝까지 뚫린 길이다.
    // 그 줄까지만 뚫어주면 시작하자마자 땅부터 파는 일이 없어진다.
    //
    // 홀수 줄만 건드리므로 기둥은 하나도 안 부순다. 격자 뼈대가 그대로 남는다
    void ConnectSpawnToLanes(int cx, int cy)
    {
        int lane_y = (cy % 2 == 1) ? cy : cy + 1;
        if (lane_y >= MAP_H - 1) lane_y = cy - 1;

        int lane_x = (cx % 2 == 1) ? cx : cx + 1;
        if (lane_x >= MAP_W - 1) lane_x = cx - 1;

        // 가로 고속도로까지 내려가서 좌우로 뚫는다
        OpenCell(cx, lane_y);
        for (int d = -SPAWN_LANE_REACH; d <= SPAWN_LANE_REACH; ++d) {
            OpenCell(cx + d, lane_y);
        }

        // 세로 고속도로도 같이
        OpenCell(lane_x, cy);
        for (int d = -SPAWN_LANE_REACH; d <= SPAWN_LANE_REACH; ++d) {
            OpenCell(lane_x, cy + d);
        }
    }

    // 스폰 주변 반경 3 안의 블록 수
    int BlocksNear(int cx, int cy) const
    {
        int n = 0;
        for (int y = cy - 3; y <= cy + 3; ++y) {
            for (int x = cx - 3; x <= cx + 3; ++x) {
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
                if (tile[y][x] == TILE_BLOCK) ++n;
            }
        }
        return n;
    }

    // 스폰끼리 주변 블록 수를 평균 근처로 맞춘다.
    // 많은 데서는 덜어내고 적은 데는 채운다
    void BalanceSpawnBlocks(MapRandom& rnd)
    {
        int sum = 0;
        for (int i = 0; i < spawn_count; ++i) {
            sum += BlocksNear(spawn_x[i], spawn_y[i]);
        }
        int target = sum / spawn_count;

        for (int i = 0; i < spawn_count; ++i) {
            int cx = spawn_x[i], cy = spawn_y[i];

            // 너무 많으면 덜어낸다
            for (int guard = 0; guard < 200; ++guard) {
                if (BlocksNear(cx, cy) <= target + SPAWN_BLOCK_TOLERANCE) break;

                int x = cx - 3 + rnd.Next(7);
                int y = cy - 3 + rnd.Next(7);
                if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
                if (tile[y][x] == TILE_BLOCK) tile[y][x] = TILE_EMPTY;
            }

            // 너무 적으면 채운다. 스폰 바로 옆은 비워둔 채로 둔다
            for (int guard = 0; guard < 200; ++guard) {
                if (BlocksNear(cx, cy) >= target - SPAWN_BLOCK_TOLERANCE) break;

                int x = cx - 3 + rnd.Next(7);
                int y = cy - 3 + rnd.Next(7);
                if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
                if (tile[y][x] != TILE_EMPTY) continue;

                int dx = x - cx, dy = y - cy;
                if (dx * dx + dy * dy <= SPAWN_CLEAR_RADIUS * SPAWN_CLEAR_RADIUS) continue;

                tile[y][x] = TILE_BLOCK;
            }
        }
    }

    // 이 칸이 속한 빈 주머니에 붙어 있는 블록을 전부 부순다.
    // 주머니가 넓어지면 꺾어 들어갈 칸이 생긴다
    void OpenPocketAround(int sx, int sy)
    {
        static const int DX[4] = { 1, -1,  0,  0 };
        static const int DY[4] = { 0,  0,  1, -1 };

        bool seen[MAP_H][MAP_W] = {};
        int  qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];
        int  head = 0, tail = 0;

        seen[sy][sx] = true;
        qx[tail] = sx; qy[tail] = sy; ++tail;

        while (head < tail) {
            int x = qx[head], y = qy[head];
            ++head;

            for (int d = 0; d < 4; ++d) {
                int nx = x + DX[d], ny = y + DY[d];
                if (nx <= 0 || ny <= 0 || nx >= MAP_W - 1 || ny >= MAP_H - 1) continue;
                if (seen[ny][nx]) continue;

                if (tile[ny][nx] == TILE_BLOCK) {
                    tile[ny][nx] = TILE_EMPTY;   // 벽을 헐어 길을 낸다
                    seen[ny][nx] = true;
                }
                else if (tile[ny][nx] == TILE_EMPTY) {
                    seen[ny][nx] = true;
                    qx[tail] = nx; qy[tail] = ny; ++tail;
                }
            }
        }
    }

    // 이 주머니에 붙어 있는 블록 자리를 모은다
    int CollectPocketBlocks(int sx, int sy, int* bx, int* by, int cap) const
    {
        static const int DX[4] = { 1, -1,  0,  0 };
        static const int DY[4] = { 0,  0,  1, -1 };

        bool seen[MAP_H][MAP_W] = {};
        int  qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];
        int  head = 0, tail = 0, n = 0;

        seen[sy][sx] = true;
        qx[tail] = sx; qy[tail] = sy; ++tail;

        while (head < tail) {
            int x = qx[head], y = qy[head];
            ++head;

            for (int d = 0; d < 4; ++d) {
                int nx = x + DX[d], ny = y + DY[d];
                if (nx <= 0 || ny <= 0 || nx >= MAP_W - 1 || ny >= MAP_H - 1) continue;
                if (seen[ny][nx]) continue;
                seen[ny][nx] = true;

                if (tile[ny][nx] == TILE_BLOCK) {
                    if (n < cap) { bx[n] = nx; by[n] = ny; ++n; }
                }
                else if (tile[ny][nx] == TILE_EMPTY) {
                    qx[tail] = nx; qy[tail] = ny; ++tail;
                }
            }
        }
        return n;
    }

    // 살아나갈 수 있게 만드는 블록 하나만 찾아서 부순다.
    //
    // 주머니를 통째로 헐면 밀도가 뭉텅이로 날아가서 밀도 상수가 의미를 잃는다.
    // 필요한 최소한만 헌다
    bool OpenOneBlockFor(int sx, int sy, int range)
    {
        int bx[512], by[512];
        int n = CollectPocketBlocks(sx, sy, bx, by, 512);

        for (int i = 0; i < n; ++i) {
            tile[by[i]][bx[i]] = TILE_EMPTY;

            if (CanEscape(sx, sy, range)) {
                return true;
            }
            tile[by[i]][bx[i]] = TILE_BLOCK;   // 이걸론 안 됐다. 도로 세운다
        }
        return false;
    }

    // 죽는 칸이 없어질 때까지 길을 낸다.
    // 블록 하나로 안 되면 그때만 주머니를 통째로 넓힌다
    void OpenDeathTraps(int range)
    {
        for (int pass = 0; pass < 8; ++pass) {
            bool found = false;

            for (int y = 1; y < MAP_H - 1; ++y) {
                for (int x = 1; x < MAP_W - 1; ++x) {
                    if (tile[y][x] != TILE_EMPTY) continue;
                    if (CanEscape(x, y, range))   continue;

                    found = true;
                    if (!OpenOneBlockFor(x, y, range)) {
                        OpenPocketAround(x, y);
                    }
                }
            }

            if (!found) {
                return;
            }
        }
    }

    void ClearAround(int cx, int cy, int r)
    {
        for (int y = cy - r; y <= cy + r; ++y) {
            for (int x = cx - r; x <= cx + r; ++x) {
                if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) {
                    continue;   // 테두리는 건드리지 않는다
                }
                tile[y][x] = TILE_EMPTY;
            }
        }
    }

    void OpenSectorGates()
    {
        // 세로 경계 (조각과 조각 사이의 세로줄)
        for (int sx = 1; sx < SECTOR_COLS; ++sx) {
            int x = sx * SECTOR_W;
            for (int sy = 0; sy < SECTOR_ROWS; ++sy) {
                int mid = sy * SECTOR_H + SECTOR_H / 2;
                for (int d = -1; d <= 1; ++d) {
                    OpenCell(x, mid + d);
                    OpenCell(x - 1, mid + d);   // 양옆도 뚫어야 실제로 지나간다
                    OpenCell(x + 1, mid + d);
                }
            }
        }

        // 가로 경계
        for (int sy = 1; sy < SECTOR_ROWS; ++sy) {
            int y = sy * SECTOR_H;
            for (int sx = 0; sx < SECTOR_COLS; ++sx) {
                int mid = sx * SECTOR_W + SECTOR_W / 2;
                for (int d = -1; d <= 1; ++d) {
                    OpenCell(mid + d, y);
                    OpenCell(mid + d, y - 1);
                    OpenCell(mid + d, y + 1);
                }
            }
        }
    }

    void OpenCell(int x, int y)
    {
        if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) {
            return;
        }
        tile[y][x] = TILE_EMPTY;
    }
};
