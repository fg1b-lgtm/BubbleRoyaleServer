// Server/src/Game.h — 판 위의 모든 것
//
// 소유 스레드 : tick
//   여기 있는 것은 전부 틱 스레드 혼자 만진다. 그래서 자물쇠가 하나도 없다.
//   워커는 이 파일을 안 본다. 워커가 받은 것은 Job Queue 를 거쳐서만 들어온다.
//   이게 8/31 에 틱 스레드를 따로 둔 이유다.
//
// 자물쇠가 없다는 건 규칙을 지킬 때만 참이다.
//   이 파일의 함수는 HandleJob 이나 GameTick 에서만 불러야 한다.
//   워커 쪽에서 부르는 순간 위의 문장이 거짓이 되고, 그때부터는 아무도 답할 수 없다.
//
// 파일 나눔
//   Game.h      자료구조 전부 + 사람 입장/퇴장/입력/이동
//   Bubble.h    물풍선, 폭발, 연쇄, 아이템, 피격
//   GameTick.h  한 틱에 무엇을 어떤 순서로 하는가
#pragma once

#include "Movement.h"
#include "Session.h"
#include "Protocol.h"

struct Player
{
    Session* s;          // 이 자리의 주인. nullptr 이면 빈 자리

    int px, py;          // 위치. 고정소수점 units. 타일 하나가 TILE_UNITS
    int judge_tx;        // 판정 타일. 위치와 따로 논다. 이 둘이 다른 순간이 걸치기다
    int judge_ty;

    int dir_x, dir_y;    // 지금 누르고 있는 방향. -1 / 0 / 1

    int bubble_lv;       // 물풍선 아이템 수. 동시에 놓을 수 있는 개수가 늘어난다
    int power_lv;        // 물줄기 아이템 수. 폭발이 뻗는 길이가 늘어난다
    int speed_lv;        // 롤러 수

    int      trap_ticks;    // 0 보다 크면 갇혀 있다. 움직일 수 없다
    uint16_t trap_gen;      // 나를 가둔 그 폭발의 번호. 같은 폭발로는 안 죽는다
    int      invuln_ticks;  // 갇힘에서 빠져나온 직후 잠깐 무적

    bool grazing;        // 지난 틱에 걸치기로 피하는 중이었나. 같은 걸 두 번 안 띄우려고
    bool alive;

    int spawn_slot;      // 어느 스폰 자리를 쓰고 있나. 나갈 때 돌려준다
};

struct Bubble
{
    bool used;
    int  owner;    // 놓은 사람 자리 번호
    int  tx, ty;
    int  fuse;     // 남은 틱. 0 이 되면 터진다
    int  range;    // 물줄기 길이. 놓는 순간의 아이템으로 정해지고 나중에 안 바뀐다
    int  chain;    // 연쇄 몇 번째 단계인가. 직접 놓은 것은 0
};

// 한 틱에 생긴 일. 틱 끝에서 한꺼번에 내보낸다.
//
// 여기 모아두는 이유는 Bubble.h 가 소켓을 모르게 하기 위해서다.
// 그래야 tools/ 에서 서버 없이 게임 규칙만 돌려볼 수 있다.
struct GameEvent
{
    uint8_t type;
    uint8_t x, y;
    uint8_t who;
    uint8_t value;
};

constexpr int MAX_EVENT_PER_TICK = 512;

struct GameState
{
    GameMap map;
    Player  players[PLAYER_MAX];
    Bubble  bubbles[MAX_BUBBLE];

    // 물줄기가 덮고 있는 칸. 남은 틱 수를 그대로 담는다
    uint8_t  blast[MAP_H][MAP_W];
    // 그 물줄기가 몇 번째 폭발인가. 나를 가둔 폭발로는 안 죽어야 해서 번호가 필요하다
    uint16_t blast_gen[MAP_H][MAP_W];
    int8_t   blast_owner[MAP_H][MAP_W];

    uint8_t item[MAP_H][MAP_W];

    uint16_t next_gen;      // 다음 폭발에 줄 번호
    MapRandom drop_rnd;     // 아이템이 나올지 굴리는 주사위

    bool spawn_used[SPAWN_TOTAL];
    int  player_count;

    unsigned long long tick;

    GameEvent events[MAX_EVENT_PER_TICK];
    int       event_count;
};

// 틱 스레드가 소유한다. 전역이지만 만지는 스레드는 하나뿐이다
inline GameState g_game;

inline void PushEvent(uint8_t type, int x, int y, int who, int value)
{
    if (g_game.event_count >= MAX_EVENT_PER_TICK) {
        return;   // 한 틱에 이만큼 넘게 생길 일이 없다. 넘치면 그냥 버린다
    }

    GameEvent& e = g_game.events[g_game.event_count++];
    e.type  = type;
    e.x     = (uint8_t)x;
    e.y     = (uint8_t)y;
    e.who   = (uint8_t)who;
    e.value = (uint8_t)value;
}

inline void InitGame(unsigned int seed)
{
    g_game.map.Generate(seed);
    g_game.drop_rnd.Seed(seed ^ 0x5bf03635u);

    g_game.player_count = 0;
    g_game.next_gen     = 1;
    g_game.tick         = 0;
    g_game.event_count  = 0;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        g_game.players[i].s = nullptr;
    }
    for (int i = 0; i < MAX_BUBBLE; ++i) {
        g_game.bubbles[i].used = false;
    }
    for (int i = 0; i < SPAWN_TOTAL; ++i) {
        g_game.spawn_used[i] = false;
    }
    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            g_game.blast[y][x]       = 0;
            g_game.blast_gen[y][x]   = 0;
            g_game.blast_owner[y][x] = -1;
            g_game.item[y][x]        = ITEM_NONE;
        }
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
    p.s            = s;
    p.px           = TileCenter(tx);
    p.py           = TileCenter(ty);
    p.judge_tx     = tx;          // 시작할 때는 위치와 판정이 같다
    p.judge_ty     = ty;
    p.dir_x        = 0;
    p.dir_y        = 0;
    p.bubble_lv    = 0;
    p.power_lv     = 0;
    p.speed_lv     = 0;
    p.trap_ticks   = 0;
    p.trap_gen     = 0;
    p.invuln_ticks = 0;
    p.grazing      = false;
    p.alive        = true;
    p.spawn_slot   = spawn;

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

    // 놓고 나간 물풍선은 남겨둔다. 나가면서 판이 바뀌면 남은 사람이 억울하다.
    // 주인만 지운다
    for (int i = 0; i < MAX_BUBBLE; ++i) {
        if (g_game.bubbles[i].used && g_game.bubbles[i].owner == slot) {
            g_game.bubbles[i].owner = -1;
        }
    }

    g_game.spawn_used[g_game.players[slot].spawn_slot] = false;
    g_game.players[slot].s = nullptr;
    --g_game.player_count;
}

// 입력을 받아둔다. 이번 틱에 바로 움직이지 않고 방향만 적어둔다.
// 실제 이동은 GameTick 이 한 번에 한다. 그래야 모두가 같은 시각에 움직인다
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
    if (!p.alive || p.trap_ticks > 0) {
        return;   // 갇혀 있으면 못 움직인다. 그게 갇힘의 전부다
    }

    int speed = MOVE_SPEED_BASE + p.speed_lv * MOVE_SPEED_STEP;

    // 움직이기 전에 코너를 돌게 도와준다.
    // 한 방향만 누르고 있을 때만이다. 두 방향을 누르고 있으면 본인이 조준하는 중이라
    // 서버가 끼어들면 오히려 방해가 된다
    if (p.dir_x != 0 && p.dir_y == 0) {
        p.py = CornerAssistAxis(map, p.px, p.py, p.dir_x * speed, true, speed);
    }
    else if (p.dir_y != 0 && p.dir_x == 0) {
        p.px = CornerAssistAxis(map, p.py, p.px, p.dir_y * speed, false, speed);
    }

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
