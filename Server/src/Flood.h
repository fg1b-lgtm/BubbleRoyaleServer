// Server/src/Flood.h — 물이 차오른다 (존 축소)
//
// 소유 스레드 : tick
//
// SPEC 2.6 대로다. 레드존이 아니라 물이 차오르는 연출이라 세계관이 안 깨진다.
//
// 여기서 정한 것 두 가지가 이 규칙의 전부다.
//
//   즉사가 없다.
//     잠기는 순간 안에 있으면 FLOOD_ESCAPE_TICKS 짜리 카운트다운이 돈다.
//     그동안 대여섯 칸을 갈 수 있다. 그래서 못 나가고 죽으면 운이 아니라 판단 실수가 된다.
//
//   진입을 막지 않는다.
//     막으면 잠긴 구역 안쪽에 갇힌 사람이 억울해진다.
//     안 막으니 잠긴 구역을 질러가는 하이리스크 플레이가 생긴다. 2초면 대여섯 칸이다.
#pragma once

#include "Bubble.h"

// 이 구역 전체를 어떤 상태로 바꾼다
inline void SetSectorState(int sector, uint8_t state)
{
    int sx = sector % SECTOR_COLS;
    int sy = sector / SECTOR_COLS;
    g_game.sector_state[sy][sx] = state;
}

inline uint8_t SectorStateAt(int tx, int ty)
{
    int sector = SectorIndex(tx, ty);
    return g_game.sector_state[sector / SECTOR_COLS][sector % SECTOR_COLS];
}

// 이 칸이 물에 잠겼나.
//
// 구역 단위 침수와, 최종 구역 안에서 계속 좁아지는 사각형을 같이 본다.
// 이 함수 하나만 보면 되도록 묶어둔다
inline bool IsUnderWater(int tx, int ty)
{
    if (SectorStateAt(tx, ty) == SECTOR_FLOODED) {
        return true;
    }
    if (g_game.ring_on) {
        if (tx < g_game.ring_x0 || tx > g_game.ring_x1) return true;
        if (ty < g_game.ring_y0 || ty > g_game.ring_y1) return true;
    }
    return false;
}

// 구역을 다 잠갔으면 최종 구역 안에서 계속 좁힌다.
//
// 여기가 없으면 판이 안 끝난다. 최종 1구역은 마지막 서너 명한테 너무 넓다
inline void UpdateRing()
{
    // 아직 구역이 남았다
    if (g_game.flood_done < g_game.flood_outer) {
        return;
    }

    if (!g_game.ring_on) {
        // 최종 구역(가운데) 경계에서 시작한다
        int sx = SECTOR_COLS / 2;
        int sy = SECTOR_ROWS / 2;

        g_game.ring_on = true;
        g_game.ring_x0 = sx * SECTOR_W;
        g_game.ring_y0 = sy * SECTOR_H;
        g_game.ring_x1 = g_game.ring_x0 + SECTOR_W - 1;
        g_game.ring_y1 = g_game.ring_y0 + SECTOR_H - 1;
        g_game.ring_next = (int)g_game.tick + g_game.ring_step;

        // 최종 구역이 되면 정중앙에 보급을 하나 떨군다 (SPEC 2.5).
        //
        // 하나뿐이고 자리가 전원에게 보이므로 **먹으러 가는 것 자체가 위험**하다.
        // 그 과정에서 교전이 강제되는 것이 이 보급의 목적이다.
        DropItemNear(MAP_W / 2, MAP_H / 2, ITEM_ULTRA);

        // 대쉬도 같이 놓는다. 마지막 구역은 좁아서 걸어 다니면 못 피하는데,
        // 여기서 처음 먹는 사람이 나오면 마지막 싸움에 변수가 하나 생긴다
        DropItemNear(MAP_W / 2, MAP_H / 2, ITEM_DASH);
        return;
    }

    if ((int)g_game.tick < g_game.ring_next) {
        return;
    }
    g_game.ring_next = (int)g_game.tick + g_game.ring_step;

    bool shrank = false;

    if (g_game.ring_x1 - g_game.ring_x0 + 1 > RING_MIN_W) {
        ++g_game.ring_x0;
        --g_game.ring_x1;
        shrank = true;
    }
    if (g_game.ring_y1 - g_game.ring_y0 + 1 > RING_MIN_H) {
        ++g_game.ring_y0;
        --g_game.ring_y1;
        shrank = true;
    }

    if (shrank) {
        // 예고 없이 좁아진다. 눈에 보이는 것이 예고라서 따로 알릴 게 없다.
        // 몇 칸짜리로 줄었는지를 value 에 실어 보낸다
        PushEvent(EVT_RING, g_game.ring_x0, g_game.ring_y0, 0xFF,
                  (uint8_t)(g_game.ring_x1 - g_game.ring_x0 + 1));
    }
}

// 몇 단계까지 잠겼는지로 이번에 건드릴 구역 범위를 정한다
inline void FloodStageRange(int stage, int* from, int* count)
{
    int start = 0;
    for (int i = 0; i < stage; ++i) {
        start += FLOOD_COUNT[i];
    }

    *from  = start;
    *count = FLOOD_COUNT[stage];

    if (*from + *count > g_game.flood_outer) {
        *count = g_game.flood_outer - *from;   // 있을 수 없지만 배열이니 막아둔다
    }
}

inline void UpdateFlood()
{
    // 1) 예고와 침수 시각을 본다
    for (int stage = 0; stage < FLOOD_STAGES; ++stage) {
        int from, count;
        FloodStageRange(stage, &from, &count);

        if ((int)g_game.tick == g_game.flood_warn[stage]) {
            int seconds = (g_game.flood_fill[stage] - g_game.flood_warn[stage]) / TICK_RATE;

            for (int i = 0; i < count; ++i) {
                int sector = g_game.flood_order[from + i];
                SetSectorState(sector, SECTOR_WARNING);
                PushEvent(EVT_FLOOD_WARN, sector, 0, 0xFF, seconds);
            }
        }

        if ((int)g_game.tick == g_game.flood_fill[stage]) {
            for (int i = 0; i < count; ++i) {
                int sector = g_game.flood_order[from + i];
                SetSectorState(sector, SECTOR_FLOODED);
                PushEvent(EVT_FLOOD, sector, 0, 0xFF, 0);
                ++g_game.flood_done;
            }
        }
    }

    // 2) 구역을 다 잠갔으면 최종 구역 안에서 계속 좁힌다
    UpdateRing();

    // 3) 물에 잠긴 데 있는 사람
    for (int i = 0; i < PLAYER_MAX; ++i) {
        Player& p = g_game.players[i];
        if (!Occupied(p) || !p.alive) {
            continue;
        }

        // 몸이 있는 칸이 아니라 판정 칸으로 본다.
        // 물줄기와 같은 기준이라야 걸치기가 침수 경계에서도 똑같이 통한다
        bool inside = IsUnderWater(p.judge_tx, p.judge_ty);

        if (!inside) {
            p.flood_ticks = 0;   // 빠져나왔다
            continue;
        }

        if (p.flood_ticks == 0) {
            p.flood_ticks = FLOOD_ESCAPE_TICKS;
            PushEvent(EVT_DROWN, p.judge_tx, p.judge_ty, i, FLOOD_ESCAPE_TICKS / TICK_RATE);
            continue;
        }

        --p.flood_ticks;
        if (p.flood_ticks == 0) {
            KillPlayer(i);
        }
    }
}
