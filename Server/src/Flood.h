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

    // 2) 잠긴 구역 안에 있는 사람
    for (int i = 0; i < PLAYER_MAX; ++i) {
        Player& p = g_game.players[i];
        if (p.s == nullptr || !p.alive) {
            continue;
        }

        // 몸이 있는 칸이 아니라 판정 칸으로 본다.
        // 물줄기와 같은 기준이라야 걸치기가 침수 경계에서도 똑같이 통한다
        bool inside = (SectorStateAt(p.judge_tx, p.judge_ty) == SECTOR_FLOODED);

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
