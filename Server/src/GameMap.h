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

    void Generate(unsigned int s)
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
                if (rnd.Next(100) < BLOCK_FILL_PERCENT) {
                    tile[y][x] = TILE_BLOCK;
                }
            }
        }

        // 5) 스폰 주변을 비운다. 시작하자마자 블록에 갇히면 안 된다.
        //    기둥까지 지운다. 시작 직후 갇히는 것보다 기둥 몇 개 없는 게 낫다
        for (int i = 0; i < spawn_count; ++i) {
            ClearAround(spawn_x[i], spawn_y[i], SPAWN_CLEAR_RADIUS);
        }

        // 6) 조각 경계의 가운데 세 칸은 반드시 통로.
        //    조각을 어떻게 붙여도 옆 조각으로 건너갈 수 있어야 한다
        OpenSectorGates();
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

private:
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
