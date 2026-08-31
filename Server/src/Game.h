// Server/src/Game.h — 판 위의 사람들
//
// 소유 스레드 : tick
//   여기 있는 것은 전부 틱 스레드 혼자 만진다. 그래서 자물쇠가 하나도 없다.
//   워커는 이 파일을 안 본다. 워커가 받은 것은 Job Queue 를 거쳐서만 들어온다.
//   이게 8/31 에 틱 스레드를 따로 둔 이유다.
//
// 자물쇠가 없다는 건 규칙을 지킬 때만 참이다.
//   이 파일의 함수는 전부 HandleJob 이나 UpdateGame 에서만 불러야 한다.
//   워커 쪽에서 부르는 순간 위의 문장이 거짓이 되고, 그때부터는 아무도 답할 수 없다.
#pragma once

#include "Movement.h"
#include "Session.h"

struct Player
{
    Session* s;          // 이 자리의 주인. nullptr 이면 빈 자리

    int px, py;          // 위치. 고정소수점 units. 타일 하나가 TILE_UNITS
    int judge_tx;        // 판정 타일. 위치와 따로 논다. 이 둘이 다른 순간이 걸치기다
    int judge_ty;

    int dir_x, dir_y;    // 지금 누르고 있는 방향. -1 / 0 / 1
    int speed_lv;        // 롤러 개수
    int spawn_slot;      // 어느 스폰 자리를 쓰고 있나. 나갈 때 돌려준다
    bool alive;
};

struct GameState
{
    GameMap map;
    Player  players[PLAYER_MAX];
    bool    spawn_used[SPAWN_TOTAL];
    int     player_count;
};

// 틱 스레드가 소유한다. 전역이지만 만지는 스레드는 하나뿐이다
inline GameState g_game;

inline void InitGame(unsigned int seed)
{
    g_game.map.Generate(seed);
    g_game.player_count = 0;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        g_game.players[i].s = nullptr;
    }
    for (int i = 0; i < SPAWN_TOTAL; ++i) {
        g_game.spawn_used[i] = false;
    }
}

// 타일 한가운데 좌표. 스폰할 때 쓴다
inline int TileCenter(int t)
{
    return t * TILE_UNITS + TILE_UNITS / 2;
}

// 판에 앉힌다. 자리가 없으면 -1
inline int AddPlayer(Session* s)
{
    int slot = -1;
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].s == nullptr) { slot = i; break; }
    }
    if (slot < 0) {
        return -1;
    }

    int spawn = -1;
    for (int i = 0; i < g_game.map.spawn_count; ++i) {
        if (!g_game.spawn_used[i]) { spawn = i; break; }
    }
    if (spawn < 0) {
        return -1;
    }
    g_game.spawn_used[spawn] = true;

    int tx = g_game.map.spawn_x[spawn];
    int ty = g_game.map.spawn_y[spawn];

    Player& p = g_game.players[slot];
    p.s          = s;
    p.px         = TileCenter(tx);
    p.py         = TileCenter(ty);
    p.judge_tx   = tx;          // 시작할 때는 위치와 판정이 같다
    p.judge_ty   = ty;
    p.dir_x      = 0;
    p.dir_y      = 0;
    p.speed_lv   = 0;
    p.spawn_slot = spawn;
    p.alive      = true;

    ++g_game.player_count;
    return slot;
}

// 이 세션의 자리를 찾는다. 없으면 -1
inline int FindPlayer(Session* s)
{
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].s == s) {
            return i;
        }
    }
    return -1;
}

inline void RemovePlayer(Session* s)
{
    int slot = FindPlayer(s);
    if (slot < 0) {
        return;
    }

    g_game.spawn_used[g_game.players[slot].spawn_slot] = false;
    g_game.players[slot].s = nullptr;
    --g_game.player_count;
}

// 입력을 받아둔다. 이번 틱에 바로 움직이지 않고 방향만 적어둔다.
// 실제 이동은 UpdateGame 이 한 번에 한다. 그래야 모두가 같은 시각에 움직인다
inline void SetInput(Session* s, int dx, int dy)
{
    int slot = FindPlayer(s);
    if (slot < 0) {
        return;
    }

    Player& p = g_game.players[slot];
    p.dir_x = (dx > 0) ? 1 : (dx < 0) ? -1 : 0;
    p.dir_y = (dy > 0) ? 1 : (dy < 0) ? -1 : 0;
}

// 한 사람을 한 틱 움직인다
inline void MovePlayer(const GameMap& map, Player& p)
{
    if (!p.alive) {
        return;
    }

    int speed = MOVE_SPEED_BASE + p.speed_lv * MOVE_SPEED_STEP;

    // 가로 먼저, 그다음 세로.
    // 한 축씩 따로 보는 이유는 벽에 비스듬히 부딪혔을 때
    // 막힌 축만 서고 나머지 축은 계속 가게 하기 위해서다. 벽을 타고 미끄러진다
    p.px = StepAxis(map, p.px, p.py, p.dir_x * speed, true);
    p.py = StepAxis(map, p.py, p.px, p.dir_y * speed, false);

    // 위치가 다 정해진 뒤에 판정 타일을 따라오게 한다.
    // 순서가 중요하다. 판정을 먼저 옮기면 아직 가지도 않은 칸에서 맞는다
    p.judge_tx = UpdateJudgeAxis(p.px, p.judge_tx);
    p.judge_ty = UpdateJudgeAxis(p.py, p.judge_ty);
}

// 한 틱. 틱 스레드가 부른다
inline void UpdateGame()
{
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].s != nullptr) {
            MovePlayer(g_game.map, g_game.players[i]);
        }
    }
}
