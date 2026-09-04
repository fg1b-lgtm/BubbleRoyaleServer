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
// 조각은 손으로 그린 10종에서 온다 (SectorTemplates.h).
// 확률로만 만들던 때는 규칙은 맞는데 어디를 가도 같은 데 같았다.
// 손으로 그린 조각에는 광장과 골목과 문턱이 있어서 "거기" 라고 부를 수 있다.
//
// 이 파일이 하는 일은 셋이다.
//   ① 10종 중 9개를 뽑아 뒤집어 가며 3x3 으로 붙인다
//   ② 조각이 '?' 로 남겨둔 자리에 블록을 확률로 깐다
//   ③ 붙이고 나서 생긴 문제만 고친다 (스폰 공정성, 놓으면 죽는 칸)
#pragma once

#include <cstdio>
#include "GameConstants.h"
#include "SectorTemplates.h"

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

constexpr int SECTOR_SLOTS = SECTOR_COLS * SECTOR_ROWS;   // 9

// 아홉 자리에 다 깔 조각. -1 이면 평소대로 뽑는다.
// 명령줄 인자 piece 로만 켠다 (예: Server.exe piece 30)
//
// 소유 스레드 : 시작할 때 한 번 쓰고 그 뒤로는 읽기만 한다
inline int g_force_piece = -1;

struct GameMap
{
    uint8_t tile[MAP_H][MAP_W];

    // 조각이 "여기는 길이다" 라고 정해둔 칸.
    //
    // 이 칸에는 나중에 무슨 일이 있어도 블록을 깔지 않는다.
    // 조각을 그릴 때 길만으로 관문과 스폰이 전부 이어지도록 검사해뒀는데,
    // 뒤에 도는 손질(BalanceSpawnBlocks)이 그 위에 블록을 하나 얹으면 그 보장이 깨진다.
    bool street[MAP_H][MAP_W];

    // 칸의 겉모습 (TileLook). 규칙에는 안 쓴다. 화면에만 보낸다.
    //
    // 판정은 tile 로만 한다. 여기에 규칙을 하나라도 걸면 "지나갈 수 있나" 를
    // 두 군데서 보게 되고, 두 곳이 어긋나는 날 벽을 뚫는다
    uint8_t look[MAP_H][MAP_W];

    // 스폰 자리. 판이 시작할 때 여기에 사람을 앉힌다
    int spawn_x[SPAWN_TOTAL];
    int spawn_y[SPAWN_TOTAL];
    int spawn_count = 0;

    // 이 판이 어떤 조각으로 짜였나. 로그와 tools/maptest 가 본다
    uint8_t sector_template[SECTOR_SLOTS] = {};

    uint8_t sector_flip[SECTOR_SLOTS]     = {};   // 1 = 좌우, 2 = 상하

    // 집·우물·텐트·장터 같은 큰 그림이 실제로 서는 자리(판 전체 좌표,
    // 뒤집기까지 다 적용한 뒤). StampSector 가 조각을 붙이면서 채운다.
    // 화면은 이걸 그대로 받아서 그린다 - 벽 모양을 보고 되짚어 추측하지 않는다
    static constexpr int MAX_MAP_LANDMARK = SECTOR_SLOTS * MAX_LANDMARK;
    struct MapLandmark { uint8_t x, y, kind, theme; };
    MapLandmark landmark[MAX_MAP_LANDMARK] = {};
    int landmark_count = 0;

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
        return IsBreakableTile(tile[ty][tx]);
    }

    // block_percent 를 따로 받는 이유는 밀도를 바꿔가며 재보기 위해서다.
    // tools/maptest.cpp 가 여러 밀도로 돌려서 어디가 좋은지 숫자로 고른다
    void Generate(unsigned int s, int block_percent = BLOCK_FILL_PERCENT)
    {
        MapRandom rnd;
        rnd.Seed(s);
        seed = s;
        spawn_count = 0;
        landmark_count = 0;

        // 1) 테마를 아홉 개 뽑고, 테마마다 판을 하나씩 고른다.
        //
        //    테마는 그림(색과 물건)이고 판은 생김새(길과 막힌 데)다.
        //    테마가 겹치면 판에 마을이 둘이라 어디가 어딘지 모르게 된다 —
        //    사람이 길을 외우는 단위가 테마다. 그래서 테마는 안 겹치게 뽑고,
        //    같은 테마 안에서 어느 판이 나올지는 매번 다르다.
        //
        //    **템플릿이 하나도 없는 테마는 뽑지 않는다.**
        //
        //    SECTOR_THEME_COUNT(10)는 테마 번호의 칸수일 뿐, 지금 실제로
        //    조각이 있는 테마 수와 다를 수 있다 — 지금 마을·사막 두 개만
        //    시험 중이면 둘뿐이다. 번호만 보고 섞으면 조각이 없는 테마를
        //    뽑아서 "그 테마엔 조각이 없다" 오류로 조용히 조각[0]만 반복해서
        //    깔게 된다. 있는 테마만 추려서 섞는다
        int active_theme[SECTOR_THEME_COUNT];
        int active_count = 0;
        for (int th = 0; th < SECTOR_THEME_COUNT; ++th) {
            for (int i = 0; i < SECTOR_TEMPLATE_COUNT; ++i) {
                if (SECTOR_TEMPLATES[i].theme == th) {
                    active_theme[active_count++] = th;
                    break;
                }
            }
        }

        //    섞어놓고 앞에서 가져간다 (피셔-예이츠).
        //    "랜덤으로 하나씩 뽑고 겹치면 다시" 로 하면 뽑을수록 느려지고,
        //    운이 나쁘면 안 끝난다. 섞는 쪽은 몇 번 도는지가 정해져 있다.
        for (int i = active_count - 1; i > 0; --i) {
            int j = rnd.Next(i + 1);
            int t = active_theme[i]; active_theme[i] = active_theme[j]; active_theme[j] = t;
        }

        //    테마마다 판이 몇 개인지는 표를 훑어서 센다. 개수를 손으로 적어두면
        //    판을 하나 더 그린 날 그 판이 영영 안 나온다.
        //
        //    있는 테마가 아홉 개보다 적으면(지금 두 개) 섞은 목록을 돌려 쓴다
        int pick[SECTOR_SLOTS];
        for (int slot = 0; slot < SECTOR_SLOTS; ++slot) {
            int want = active_theme[slot % active_count];

            int n = 0;
            for (int i = 0; i < SECTOR_TEMPLATE_COUNT; ++i) {
                if (SECTOR_TEMPLATES[i].theme == want) ++n;
            }

            int k = (n > 0) ? rnd.Next(n) : 0;
            pick[slot] = 0;
            for (int i = 0; i < SECTOR_TEMPLATE_COUNT; ++i) {
                if (SECTOR_TEMPLATES[i].theme != want) continue;
                if (k-- == 0) { pick[slot] = i; break; }
            }
        }

        // 판 하나를 눈으로 보려고 아홉 자리에 다 깐다. 명령줄 인자 piece 로만 켠다.
        //
        // 조각이 서른한 개인데 그중 하나가 가운데에 올 확률은 3%다. 새로 그린
        // 조각을 확인하려고 판을 서른 번 다시 까는 건 확인이 아니라 도박이다.
        // 확률로 되는 걸 기다리지 말고 바로 볼 수 있어야 한다
        if (g_force_piece >= 0 && g_force_piece < SECTOR_TEMPLATE_COUNT) {
            for (int slot = 0; slot < SECTOR_SLOTS; ++slot) pick[slot] = g_force_piece;
        }

        // 2) 아홉 자리에 하나씩 찍는다. 자리마다 뒤집기가 따로 걸린다.
        //
        //    돌리기는 못 한다. 조각이 15x13 이라 90도 돌리면 13x15 가 되어 안 맞는다.
        //    뒤집기 넷이면 같은 조각도 매번 다르게 보인다.
        for (int slot = 0; slot < SECTOR_SLOTS; ++slot) {
            sector_template[slot] = (uint8_t)pick[slot];
            sector_flip[slot]     = (uint8_t)rnd.Next(4);   // 0 그대로 / 1 좌우 / 2 상하 / 3 둘 다

            StampSector(slot, SECTOR_TEMPLATES[pick[slot]], sector_flip[slot],
                        rnd, block_percent);
        }

        // 3) 판 바깥 테두리는 무조건 벽이다.
        //    조각은 자기가 판 끝에 놓일지 안쪽에 놓일지 모른다. 여기서 정리한다
        for (int y = 0; y < MAP_H; ++y) {
            for (int x = 0; x < MAP_W; ++x) {
                if (x == 0 || y == 0 || x == MAP_W - 1 || y == MAP_H - 1) {
                    tile[y][x]   = TILE_WALL;
                    street[y][x] = false;
                    look[y][x]   = LOOK_PLAIN;   // 테두리는 강이 아니라 판 끝이다
                }
            }
        }

#ifdef MAPGEN_TRACE
        auto __count = [this]() {
            int n = 0;
            for (int y = 0; y < MAP_H; ++y)
                for (int x = 0; x < MAP_W; ++x)
                    if (IsBreakableTile(tile[y][x])) ++n;
            return n;
        };
        printf("[trace] 0 stamp+border   : %d\n", __count());
#endif

        // 4) 테두리를 두르면서 생긴 막다른 칸을 벽으로 메운다.
        //
        //    조각은 사방이 열려 있다고 치고 그렸다. 그런데 판 가장자리에 놓이면
        //    한쪽이 통째로 막히면서, 안 그랬으면 지나가는 길이었을 칸이
        //    들어갔다 도로 나와야 하는 주머니가 된다.
        //    거기서 마주치면 피할 데가 없다. 그건 실력이 아니라 자리 운이다.
        SealDeadEnds();
#ifdef MAPGEN_TRACE
        printf("[trace] 1 SealDeadEnds   : %d\n", __count());
#endif

        // 5) 스폰 주변을 비운다.
        //
        //    3x3 이어야 한다. 가운데에 물풍선을 놓으면 사거리 1 물줄기가 십자로 덮고
        //    네 귀퉁이가 남는다. 그래서 첫 물풍선을 놓고 대각선으로 피할 수 있다.
        //    이게 없으면 시작하자마자 상자에 파묻힌 채로 아무것도 못 한다
        for (int i = 0; i < spawn_count; ++i) {
            ClearAround(spawn_x[i], spawn_y[i], SPAWN_CLEAR_RADIUS);
        }
#ifdef MAPGEN_TRACE
        printf("[trace] 2 ClearAround x%-3d: %d\n", spawn_count, __count());
#endif

        // 6) 조각과 조각이 맞닿는 자리를 확인한다.
        //    조각마다 관문을 뚫어놨으니 보통은 할 일이 없다. 안전장치다
        OpenSeams();
#ifdef MAPGEN_TRACE
        printf("[trace] 3 OpenSeams      : %d\n", __count());
#endif

        // 7) 공정성 맞추기와 죽는 칸 없애기를 **번갈아 두 번** 돈다.
        //
        //    둘 다 상자를 지우는 일이라 서로를 망가뜨린다.
        //      공정성을 먼저 하면 -> 죽는 칸 없애기가 상자를 더 지워서 다시 어긋난다
        //      죽는 칸을 먼저 하면 -> 공정성이 지운 자리가 새 죽는 칸이 된다
        //
        //    둘 다 지우기만 하고 되돌리지 않으므로, 번갈아 돌리면 변화량이 빠르게 준다.
        //    두 바퀴면 충분하다. 세 바퀴째에는 바뀌는 게 없다
        for (int pass = 0; pass < 2; ++pass) {
            BalanceSpawnBlocks(rnd);
#ifdef MAPGEN_TRACE
            printf("[trace] 4.%d BalanceSpawnBlocks: %d\n", pass, __count());
#endif
            OpenDeathTraps(BLAST_BASE_RANGE);
#ifdef MAPGEN_TRACE
            printf("[trace] 4.%d OpenDeathTraps    : %d\n", pass, __count());
#endif
        }
    }

    const char* SectorName(int slot) const
    {
        return SECTOR_TEMPLATES[sector_template[slot]].name;
    }

    void Dump() const
    {
        for (int y = 0; y < MAP_H; ++y) {
            char line[MAP_W + 1];
            for (int x = 0; x < MAP_W; ++x) {
                line[x] = (tile[y][x] == TILE_WALL)  ? '#'
                        : IsBreakableTile(tile[y][x]) ? '*'
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
                if (IsBreakableTile(t)) break;
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
    // 조각 하나를 판에 찍는다.
    //
    //   slot  0..8. 왼쪽 위부터 오른쪽 아래로
    //   flip  1 이 켜져 있으면 좌우, 2 가 켜져 있으면 상하로 뒤집는다
    //
    // 뒤집기는 읽는 자리를 바꾸는 것으로 한다. 조각을 복사해서 돌린 뒤 찍는 게 아니라,
    // 찍을 때 반대쪽 글자를 읽는다. 임시 배열이 필요 없다.
    void StampSector(int slot, const SectorTemplate& t, int flip,
                     MapRandom& rnd, int block_percent)
    {
        int ox = (slot % SECTOR_COLS) * SECTOR_W;
        int oy = (slot / SECTOR_COLS) * SECTOR_H;

        for (int ly = 0; ly < SECTOR_H; ++ly) {
            const char* row = t.row[(flip & 2) ? (SECTOR_H - 1 - ly) : ly];

            for (int lx = 0; lx < SECTOR_W; ++lx) {
                char c = row[(flip & 1) ? (SECTOR_W - 1 - lx) : lx];

                int x = ox + lx;
                int y = oy + ly;

                // 조각이 길이라고 그린 자리. 지금은 여기도 상자로 덮는다.
                // 파고 나면 드러난다. 어디를 파야 빨리 나가는지가 판단거리가 된다
                street[y][x] = (c == '.' || c == '=' || c == 's');

                // 겉모습. 규칙은 아래에서 정하고, 여기서는 어떻게 보일지만 정한다
                look[y][x] = (c == '~') ? LOOK_WATER
                           : (c == '=') ? LOOK_BRIDGE
                           :              LOOK_PLAIN;

                if (c == '#' || c == '~') {
                    tile[y][x] = TILE_WALL;
                }
                else if (c == '=') {
                    tile[y][x] = TILE_EMPTY;
                }
                else if (c == 's') {
                    tile[y][x] = TILE_EMPTY;
                    if (spawn_count < SPAWN_TOTAL) {
                        spawn_x[spawn_count] = x;
                        spawn_y[spawn_count] = y;
                        ++spawn_count;
                    }
                }
                // b/p 는 **확률이 아니라 정해진 자리**다.
                //
                // 사람이 그려온 판(마을·사막)은 상자 하나하나가 그 자리에 있으라고
                // 그려진 것이지, "대충 이 근방에 몇 개" 가 아니다. ? 로 두면 매판
                // 다른 자리에 나서 그림과 달라진다. b/p 는 늘 그 칸에 있는다
                else if (c == 'b') {
                    tile[y][x] = TILE_BLOCK;
                }
                else if (c == 'p') {
                    tile[y][x] = TILE_BOX;
                }
                else {
                    // 고정 벽과 스폰이 아니면 전부 상자 후보다.
                    // 상자가 곧 아이템이고 곧 시계다. 파낸 만큼만 판이 열린다
                    if (rnd.Next(100) < block_percent) {
                        // 그중 일부는 **밀 수 있는** 상자다.
                        // 부수는 것 말고 미는 선택지가 생긴다
                        tile[y][x] = (rnd.Next(100) < BOX_PERCENT) ? TILE_BOX : TILE_BLOCK;
                    } else {
                        tile[y][x] = TILE_EMPTY;
                    }
                }
            }
        }

        // 이 조각의 큰 그림 자리도 같이 뒤집는다.
        //
        // 타일은 "찍을 자리마다 반대쪽 글자를 읽어서" 뒤집었다(위 for문).
        // 좌표 하나(landmark)는 읽을 반대쪽이 없으니 식을 직접 쓴다 -
        // W칸짜리 덩어리를 좌우로 뒤집으면 왼쪽 끝이 (SECTOR_W - W - x) 로
        // 간다. 칸 하나하나를 (SECTOR_W-1-lx) 로 뒤집은 뒤 그 중 제일 작은
        // x를 다시 구한 것과 같은 값이다 - 위 for문과 다른 방법이지만 같은 규칙이다
        for (int i = 0; i < t.landmark_count && landmark_count < MAX_MAP_LANDMARK; ++i) {
            const SectorLandmark& lm = t.landmark[i];

            int lx = (flip & 1) ? (SECTOR_W - lm.w - lm.x) : lm.x;
            int ly = (flip & 2) ? (SECTOR_H - lm.h - lm.y) : lm.y;

            MapLandmark& out = landmark[landmark_count++];
            out.x = (uint8_t)(ox + lx);
            out.y = (uint8_t)(oy + ly);
            out.kind = lm.kind;
            out.theme = (uint8_t)t.theme;
        }
    }

    // 이웃이 하나뿐인 칸을 벽으로 메운다. 없어질 때까지 돈다.
    //
    // 왜 뚫지 않고 메우나.
    //   뚫으면 조각에 그려둔 모양이 망가진다. 벽 하나를 헐면 옆 칸이 또 이상해진다.
    //   메우는 쪽은 아무것도 안 망가뜨린다. 이웃이 하나뿐인 칸은 지나다니는 길이 아니라
    //   들어갔다 그대로 나와야 하는 끝이라서, 없애도 어디와 어디 사이가 끊기지 않는다.
    //
    // 벽이 아닌 것은 전부 열린 것으로 센다. 블록은 부수면 없어지니 구조가 아니다.
    // tools/maptest 의 "뼈대" 도 같은 기준으로 잰다.
    //
    // 스폰은 건드리지 않는다. 스폰이 사라지면 사람이 앉을 데가 없어진다
    void SealDeadEnds()
    {
        static const int DX[4] = { 1, -1,  0,  0 };
        static const int DY[4] = { 0,  0,  1, -1 };

        for (int pass = 0; pass < 8; ++pass) {
            bool changed = false;

            for (int y = 1; y < MAP_H - 1; ++y) {
                for (int x = 1; x < MAP_W - 1; ++x) {
                    if (tile[y][x] == TILE_WALL) continue;
                    if (IsSpawn(x, y))           continue;

                    int open = 0;
                    for (int d = 0; d < 4; ++d) {
                        if (tile[y + DY[d]][x + DX[d]] != TILE_WALL) ++open;
                    }

                    if (open <= 1) {
                        tile[y][x]   = TILE_WALL;
                        street[y][x] = false;
                        changed = true;
                    }
                }
            }

            if (!changed) {
                return;
            }
        }
    }

    bool IsSpawn(int x, int y) const
    {
        for (int i = 0; i < spawn_count; ++i) {
            if (spawn_x[i] == x && spawn_y[i] == y) return true;
        }
        return false;
    }

    // 조각이 맞닿는 자리에 벽이 서 있으면 헐어낸다.
    //
    // 아래 조각의 (7,12) 와 위 조각의 (7,0) 이 바로 맞닿게 좌표를 잡아뒀고,
    // 조각 열 종 전부 그 자리를 길로 그려놨다 (SectorTemplates.h 의 약속 ①).
    // 그래서 이 함수는 보통 아무것도 안 한다.
    //
    // 그래도 둔다. 나중에 조각을 하나 더 그렸는데 관문을 안 뚫어두면
    // 그 판은 구역 하나가 통째로 못 가는 데가 되고, 그건 돌려봐야만 알게 된다.
    void OpenSeams()
    {
        for (int sy = 0; sy < SECTOR_ROWS; ++sy) {
            for (int sx = 0; sx < SECTOR_COLS; ++sx) {
                int ox = sx * SECTOR_W;
                int oy = sy * SECTOR_H;

                if (sx + 1 < SECTOR_COLS) {                   // 오른쪽 조각과
                    OpenCell(ox + SECTOR_W - 1, oy + SECTOR_H / 2);
                    OpenCell(ox + SECTOR_W,     oy + SECTOR_H / 2);
                }
                if (sy + 1 < SECTOR_ROWS) {                   // 아래 조각과
                    OpenCell(ox + SECTOR_W / 2, oy + SECTOR_H - 1);
                    OpenCell(ox + SECTOR_W / 2, oy + SECTOR_H);
                }
            }
        }
    }

    // 스폰 주변 반경 3 안의 블록 수
    int BlocksNear(int cx, int cy) const
    {
        int n = 0;
        for (int y = cy - 3; y <= cy + 3; ++y) {
            for (int x = cx - 3; x <= cx + 3; ++x) {
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
                if (IsBreakableTile(tile[y][x])) ++n;
            }
        }
        return n;
    }

    // 스폰끼리 주변 블록 수를 평균 근처로 맞춘다.
    // 많은 데서는 덜어내고 적은 데는 채운다
    void BalanceSpawnBlocks(MapRandom& rnd)
    {
        // 평균이 아니라 **제일 적은 쪽**에 맞춘다.
        //
        // 예전에는 평균을 목표로 잡고 많은 데서 덜고 적은 데는 채웠다.
        // 상자를 100%로 채우고 나니 채울 빈칸이 없어서 위로는 못 올린다.
        // 그러면 적은 쪽은 그대로고 차이가 안 줄어든다.
        //
        // 아래로만 맞추면 언제나 된다. 덜어낼 상자는 늘 있기 때문이다.
        // 스폰 주변 상자가 적어지는 대신 **스물일곱 자리가 다 같아진다.**
        // 아이템은 공정성이 총량보다 중요하다. 억울해서 지는 게 제일 나쁘다
        //
        // 9/4 - "제일 적은 쪽"을 판 전체 스물일곱 자리에서 하나 고르고 있었다.
        // 조각이 서른한 종일 때는 다 고만고만해서 문제가 안 됐는데, 지금은
        // 집·우물·텐트·장터처럼 **자리마다 일부러 다르게 채운** 손그림 조각이다.
        // 어쩌다 스폰 하나가 큰 건물 옆이라 원래 낮았을 뿐인데, 그 한 자리가
        // 판 전체 스물일곱 곳의 목표를 끌어내려서 **집·우물이 없는 다른 여덟
        // 조각까지 덩달아 상자가 반토막 났다.** 재보니 이 함수와 아래
        // OpenDeathTraps 두 곳에서만 판 전체 상자의 1/3이 사라지고 있었다 -
        // "빈 공간이 너무 많다"던 것의 진짜 원인이 이거였다.
        //
        // 공정성은 **같은 조각 안 세 스폰끼리만** 맞추면 충분하다. 어차피
        // 다른 조각 스폰은 서로 옆에 붙어 있지도 않다 - 마을 스폰과 사막
        // 스폰이 얼마나 상자를 더 가졌는지는 애초에 비교할 대상이 아니었다
        // Game.h 의 SectorIndex 와 같은 식이다. 여기서 다시 적는 이유는
        // GameMap.h 가 Game.h 를 몰라야 하기 때문이다(맨 위 설명 - 소켓도
        // 세션도 모르고 tools/ 에서 서버 없이 돌아가야 한다). 식 하나 정도는
        // 두 곳에 적어도 갈릴 일이 없다 - 조각 칸 수(SECTOR_W/H)가 바뀌면
        // 둘 다 컴파일부터 깨진다
        int target[SECTOR_SLOTS];
        for (int s = 0; s < SECTOR_SLOTS; ++s) target[s] = 9999;
        for (int i = 0; i < spawn_count; ++i) {
            int s = (spawn_y[i] / SECTOR_H) * SECTOR_COLS + (spawn_x[i] / SECTOR_W);
            int n = BlocksNear(spawn_x[i], spawn_y[i]);
            if (n < target[s]) target[s] = n;
        }

        for (int i = 0; i < spawn_count; ++i) {
            int cx = spawn_x[i], cy = spawn_y[i];
            const int mySector = (cy / SECTOR_H) * SECTOR_COLS + (cx / SECTOR_W);
            const int myTarget = target[mySector];

            // 너무 많으면 덜어낸다
            for (int guard = 0; guard < 200; ++guard) {
                if (BlocksNear(cx, cy) <= myTarget + SPAWN_BLOCK_TOLERANCE) break;

                int x = cx - 3 + rnd.Next(7);
                int y = cy - 3 + rnd.Next(7);
                if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
                if (IsBreakableTile(tile[y][x])) tile[y][x] = TILE_EMPTY;
            }

            // 너무 적으면 채운다. 스폰 바로 옆은 비워둔 채로 둔다
            for (int guard = 0; guard < 200; ++guard) {
                if (BlocksNear(cx, cy) >= myTarget - SPAWN_BLOCK_TOLERANCE) break;

                int x = cx - 3 + rnd.Next(7);
                int y = cy - 3 + rnd.Next(7);
                if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
                if (tile[y][x] != TILE_EMPTY) continue;

                // 조각이 길이라고 그려둔 칸은 절대 막지 않는다.
                // 여기를 하나 막으면 "블록이 최악으로 깔려도 안 갇힌다" 는 보장이 깨진다
                if (street[y][x]) continue;

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

                if (IsBreakableTile(tile[ny][nx])) {
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

                if (IsBreakableTile(tile[ny][nx])) {
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
            // 도로 세울 때 **원래 무엇이었는지**를 기억해야 한다.
            // 그냥 TILE_BLOCK 으로 되돌리면 밀 수 있던 상자가 조용히 일반 블록이 된다.
            // 밀도는 맞고 규칙만 바뀌는 종류의 버그라 시험으로도 안 잡힌다
            uint8_t was = tile[by[i]][bx[i]];
            tile[by[i]][bx[i]] = TILE_EMPTY;

            if (CanEscape(sx, sy, range)) {
                return true;
            }
            tile[by[i]][bx[i]] = was;
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

    // 스폰 주변을 비운다. 고정 벽은 안 건드린다.
    // 벽을 지우면 조각의 뼈대가 무너지고, 뼈대는 판이 끝날 때까지 남는 것이다
    void ClearAround(int cx, int cy, int r)
    {
        for (int y = cy - r; y <= cy + r; ++y) {
            for (int x = cx - r; x <= cx + r; ++x) {
                if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) continue;
                if (IsBreakableTile(tile[y][x])) tile[y][x] = TILE_EMPTY;
            }
        }
    }

    // 한 칸을 확실히 길로 만든다.
    // street 도 같이 켠다. 뒤에 도는 손질이 여기에 블록을 얹으면 안 되기 때문이다
    void OpenCell(int x, int y)
    {
        if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) {
            return;
        }
        tile[y][x]   = TILE_EMPTY;
        street[y][x] = true;
    }
};
