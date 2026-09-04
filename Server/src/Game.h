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
    // 이 자리의 주인.
    //   s != nullptr           사람이 앉아 있다
    //   s == nullptr && is_bot 봇이 앉아 있다
    //   s == nullptr && !is_bot 빈 자리
    Session* s;

    // 봇인가. 세션이 없으므로 보낼 것도 없고 끊길 일도 없다.
    //
    // 혼자 접속하면 "한 명 더 들어오면 시작한다" 만 보고 끝난다.
    // 링크를 받은 사람이 게임을 한 번도 못 보는 것이라, 봇이 자리를 채운다
    bool is_bot;

    int px, py;          // 위치. 고정소수점 units. 타일 하나가 TILE_UNITS
    int judge_tx;        // 판정 타일. 위치와 따로 논다. 이 둘이 다른 순간이 걸치기다
    int judge_ty;

    int dir_x, dir_y;    // 지금 누르고 있는 방향. -1 / 0 / 1

    // 보고 있는 쪽 (FaceDir). 누르는 걸 놓아도 그대로 남는다.
    // 서 있는 그림도 앞뒤옆이 다르기 때문에 방향은 상태로 들고 있어야 한다
    int  face;

    // 상자를 민 뒤 쉬는 시간. 없으면 붙어서 누르는 동안 상자가 주르륵 밀려간다
    int  push_cool;

    // 상자를 미는 중이다. 방향을 대고 몇 틱째 버티고 있나,
    // 그리고 지금 밀고 있는 칸이 어디인가.
    //
    // 칸을 같이 들고 있어야 한다. 안 그러면 옆 상자로 옮겨 대도 버틴 시간이 이어져서,
    // 상자 앞을 스치듯 지나가기만 해도 마지막 상자가 밀린다
    int  push_charge;
    int  push_tx, push_ty;

    // 이번 틱에 자리가 실제로 바뀌었나.
    // 벽에 대고 누르고 있으면 dir 은 있는데 이건 꺼져 있다. 그때는 걷는 그림을 안 쓴다
    bool moving;

    int bubble_lv;       // 물풍선 아이템 수. 동시에 놓을 수 있는 개수가 늘어난다
    int power_lv;        // 물줄기 아이템 수. 폭발이 뻗는 길이가 늘어난다
    int speed_lv;        // 롤러 수

    // 대쉬. 먹었나 / 지금 나가는 중인가 / 언제 다시 쓸 수 있나 / 어느 쪽으로.
    //
    // 방향을 따로 들고 있는 이유는, 대쉬가 시작된 뒤에 키를 놓거나 다른 쪽을
    // 눌러도 나가던 방향으로 끝까지 가야 하기 때문이다. 도중에 꺾이면
    // 어디에 설지 예측이 안 돼서 쓸 수가 없다

    int      trap_ticks;    // 0 보다 크면 갇혀 있다. 아주 느리게만 움직인다
    int      invuln_ticks;  // 갇힘에서 빠져나온 직후 잠깐 무적

    bool grazing;        // 지난 틱에 걸치기로 피하는 중이었나. 같은 걸 두 번 안 띄우려고
    int  graze_streak;   // 연속 몇 번째 걸치기인가. GRAZE x2 의 숫자
    int  graze_timer;    // 남은 틱. 0 이 되면 연속이 끊긴다
    int  flood_ticks;   // 잠긴 구역 안에서 남은 시간. 0 이면 안 잠긴 데 있다
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

// 밀려가고 있는 상자.
//
// 밀리는 동안 상자는 **두 칸을 다 막는다.** 떠난 칸과 갈 칸 둘 다.
// 실제로는 그 사이 어딘가에 있는데 판은 칸 단위라, 어느 한 칸만 막으면
// 상자 그림이 사람 몸을 통과해 지나가는 순간이 생긴다.
// 둘 다 막으면 손해 보는 쪽이 미는 사람이라 억울하지 않다.
//
// 여덟 개면 넉넉하다. 미는 데 0.5초를 버텨야 하므로 스물넷이 동시에 밀 수는 없다
constexpr int MAX_SLIDING_BOX = 8;

struct SlidingBox
{
    bool used;
    int  fx, fy;   // 떠난 칸
    int  tx, ty;   // 갈 칸
    int  left;     // 남은 틱. 0 이 되면 떠난 칸이 비워진다
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
    SlidingBox slides[MAX_SLIDING_BOX];

    // 물줄기가 덮고 있는 칸. 남은 틱 수를 그대로 담는다
    uint8_t  blast[MAP_H][MAP_W];
    // 그 물줄기가 몇 번째 폭발인가. 나를 가둔 폭발로는 안 죽어야 해서 번호가 필요하다
    uint16_t blast_gen[MAP_H][MAP_W];
    int8_t   blast_owner[MAP_H][MAP_W];

    uint8_t item[MAP_H][MAP_W];

    uint16_t next_gen;      // 다음 폭발에 줄 번호
    MapRandom drop_rnd;     // 아이템이 나올지 굴리는 주사위

    // ── 침수 ──
    uint8_t sector_state[SECTOR_ROWS][SECTOR_COLS];
    int     flood_order[SECTOR_ROWS * SECTOR_COLS];   // 잠기는 순서. 가운데는 안 들어간다
    int     flood_outer;                              // 바깥 구역이 몇 개인가
    int     flood_done;                               // 지금까지 몇 구역이 잠겼나
    int     flood_warn[FLOOD_STAGES];                 // 예고 시각. 배속을 걸 수 있게 복사해 둔다
    int     flood_fill[FLOOD_STAGES];                 // 잠기는 시각

    // 구역을 다 잠근 뒤 최종 구역 안에서 계속 좁아지는 안전 사각형.
    // 양끝을 포함하는 타일 좌표다. ring_on 이 false 면 아직 안 쓴다
    bool    ring_on;
    int     ring_x0, ring_y0, ring_x1, ring_y1;
    int     ring_next;                                // 다음으로 좁아지는 시각
    int     ring_step;                                // 한 겹 좁아지는 간격. 배속이 걸린다

    bool spawn_used[SPAWN_TOTAL];
    int  player_count;

    // ── 판의 생명주기 ──
    uint8_t phase;
    int     phase_ticks;    // 이 단계에 들어온 뒤 지난 틱
    int     winner;         // ROUND_OVER 일 때 승자 자리. 없으면 -1
    int     round_no;
    bool    map_changed;    // 판이 새로 깔렸다. main 이 보고 WELCOME 을 다시 보낸다

    unsigned int seed;        // 지금 판의 씨앗. 다음 판에서 굴린다
    int          flood_scale; // 침수 배속. 판이 바뀌어도 유지한다

    unsigned long long tick;  // PLAYING 인 동안에만 흐른다. 침수 시각의 기준

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

// 구역 번호. 3x3 이라 0..8
inline int SectorIndex(int tx, int ty)
{
    int sx = tx / SECTOR_W;
    int sy = ty / SECTOR_H;
    if (sx >= SECTOR_COLS) sx = SECTOR_COLS - 1;
    if (sy >= SECTOR_ROWS) sy = SECTOR_ROWS - 1;
    return sy * SECTOR_COLS + sx;
}

// flood_scale 은 침수 일정을 몇 배로 당길 것인가.
// 1 이면 SPEC 그대로 6분짜리다. 손맛을 보려고 매번 6분을 기다릴 수는 없어서
// 서버를 fast 로 띄우면 10 이 들어온다. 규칙은 그대로고 시각만 나눈다
// 이번 판에 상자를 민 횟수. 소유 스레드 : tick
//
// 기능이 돌아간다는 시험과 기능이 판에 나온다는 건 다른 얘기다.
// 밀기 시험은 통과하는데 봇 판에서는 한 번도 안 밀리고 있었다. 그래서 센다
inline long long g_push_count = 0;
inline void InitGame(unsigned int seed, int flood_scale = 1)
{
    if (flood_scale < 1) {
        flood_scale = 1;
    }

    g_push_count = 0;   // 판마다 다시 센다
    g_game.map.Generate(seed);
    g_game.drop_rnd.Seed(seed ^ 0x5bf03635u);

    // 침수 일정을 복사해 둔다. 배속을 여기서 한 번만 적용한다
    for (int i = 0; i < FLOOD_STAGES; ++i) {
        g_game.flood_warn[i] = FLOOD_WARN_TICKS[i] / flood_scale;
        g_game.flood_fill[i] = FLOOD_FILL_TICKS[i] / flood_scale;
    }

    // 잠기는 순서를 섞는다. 가운데는 넣지 않는다. 거기가 최종 구역이다
    MapRandom order_rnd;
    order_rnd.Seed(seed ^ 0x9e3779b9u);

    g_game.flood_outer = 0;
    g_game.flood_done  = 0;

    g_game.ring_on = false;
    g_game.ring_x0 = 0; g_game.ring_y0 = 0;
    g_game.ring_x1 = MAP_W - 1; g_game.ring_y1 = MAP_H - 1;
    g_game.ring_next = 0;
    g_game.ring_step = RING_STEP_TICKS / flood_scale;

    // 잠기는 순서. **구석부터 잠기고 변은 나중이다.**
    //
    // 처음에는 바깥 여덟 구역을 통째로 섞었다. 그랬더니 변 두 개가 먼저 잠기면서
    // 그 사이 구석이 통째로 고립되는 판이 나왔다. 거기 있던 사람은 실력과 상관없이
    // 갇혀 죽는다. 그건 패배가 아니라 사고다.
    //
    // 구석 넷을 먼저 잠그면 남는 것이 늘 이어져 있다.
    // 구석은 이웃이 둘뿐이라 하나 잠겨도 나머지가 안 끊긴다.
    //
    //   구석 (0,0) (2,0) (0,2) (2,2)   먼저
    //   변   (1,0) (0,1) (2,1) (1,2)   나중
    //   가운데                          안 잠긴다
    //
    // 같은 무리 안에서만 섞는다. 그래서 매판 다르면서도 갇히지는 않는다
    for (int sy = 0; sy < SECTOR_ROWS; ++sy) {
        for (int sx = 0; sx < SECTOR_COLS; ++sx) {
            g_game.sector_state[sy][sx] = SECTOR_OPEN;
        }
    }

    int corners[4], edges[4];
    int nc = 0, ne = 0;

    for (int sy = 0; sy < SECTOR_ROWS; ++sy) {
        for (int sx = 0; sx < SECTOR_COLS; ++sx) {
            bool mid_x = (sx == SECTOR_COLS / 2);
            bool mid_y = (sy == SECTOR_ROWS / 2);
            if (mid_x && mid_y) {
                continue;             // 가운데는 안 잠긴다
            }
            int idx = sy * SECTOR_COLS + sx;
            if (!mid_x && !mid_y) corners[nc++] = idx;   // 구석
            else                  edges[ne++]   = idx;   // 변
        }
    }

    // 무리 안에서만 섞는다
    for (int i = nc - 1; i > 0; --i) {
        int j = order_rnd.Next(i + 1);
        int t = corners[i]; corners[i] = corners[j]; corners[j] = t;
    }
    for (int i = ne - 1; i > 0; --i) {
        int j = order_rnd.Next(i + 1);
        int t = edges[i]; edges[i] = edges[j]; edges[j] = t;
    }

    g_game.flood_outer = 0;
    for (int i = 0; i < nc; ++i) g_game.flood_order[g_game.flood_outer++] = corners[i];
    for (int i = 0; i < ne; ++i) g_game.flood_order[g_game.flood_outer++] = edges[i];

    g_game.player_count = 0;
    g_game.next_gen     = 1;
    g_game.tick         = 0;
    g_game.event_count  = 0;

    g_game.seed        = seed;
    g_game.flood_scale = flood_scale;
    g_game.winner      = -1;
    g_game.map_changed = true;   // 판이 새로 깔렸다. 붙어 있는 사람에게 다시 알려야 한다

    g_game.phase       = ROUND_WAITING;
    g_game.phase_ticks = 0;
    g_game.round_no    = 0;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        g_game.players[i].s      = nullptr;
        g_game.players[i].is_bot = false;
    }
    for (int i = 0; i < MAX_BUBBLE; ++i) {
        g_game.bubbles[i].used = false;
    }
    for (int i = 0; i < MAX_SLIDING_BOX; ++i) {
        g_game.slides[i].used = false;
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

// 이 자리에 누가 앉아 있나. 사람이든 봇이든.
//
// 봇이 생기면서 "s 가 nullptr 이면 빈 자리" 가 더는 안 맞는다.
// 그 판단을 한 곳으로 모은다. 안 그러면 봇이 안 움직이거나,
// 스냅샷에 안 나가거나, 빈 자리로 세어져서 판이 안 끝난다
inline bool Occupied(const Player& p)
{
    return p.s != nullptr || p.is_bot;
}

// 판에 앉힌다. 자리가 없으면 -1.
// bot 이 true 면 세션 없이 앉는다
// 자리를 하나 준다. 없으면 -1.
//
// **자리 번호를 Session 에도 여기서 적는다.**
//
// 9/2 에 이걸 안 해서 화면이 통째로 멈췄다. 판이 다시 깔릴 때 사람을 새 자리에 앉히는데
// Session::slot 은 옛 자리를 들고 있었다. AOI 는 그 번호로 "이 사람이 어느 구역을
// 보고 있나" 를 물어보므로, 엉뚱한 구역을 답하고 어느 묶음에도 안 걸렸다.
// 서버는 멀쩡히 판을 돌리는데 브라우저에는 스냅샷이 한 장도 안 갔다.
//
// 자리를 정하는 곳이 여기 하나이므로, 적는 곳도 여기 하나여야 한다.
// 부르는 쪽에서 따로 적게 두면 언젠가 한 군데를 빠뜨린다. 실제로 빠뜨렸다
inline int AddPlayer(Session* s, bool bot = false)
{
    int slot = -1;
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (!Occupied(g_game.players[i])) { slot = i; break; }
    }
    if (slot < 0) {
        return -1;
    }
    if (s != nullptr) {
        s->slot = slot;
    }

    // 빈 자리를 앞에서부터 주면 안 된다.
    // 두세 명만 붙었을 때 전부 같은 조각에 몰려서 시작하자마자 싸우게 된다.
    // 이미 앉은 사람들에게서 제일 먼 자리를 고른다
    int spawn = -1;
    int best_gap = -1;

    for (int i = 0; i < g_game.map.spawn_count; ++i) {
        if (g_game.spawn_used[i]) {
            continue;
        }

        int gap = 1 << 20;   // 아무도 없으면 아주 큰 값
        for (int j = 0; j < g_game.map.spawn_count; ++j) {
            if (!g_game.spawn_used[j]) {
                continue;
            }
            int dx = g_game.map.spawn_x[i] - g_game.map.spawn_x[j];
            int dy = g_game.map.spawn_y[i] - g_game.map.spawn_y[j];
            int d  = (dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy);
            if (d < gap) gap = d;
        }

        if (gap > best_gap) {
            best_gap = gap;
            spawn = i;
        }
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
    p.is_bot       = bot;
    p.push_cool    = 0;
    p.push_charge  = 0;
    p.push_tx      = -1;
    p.push_ty      = -1;
    p.face         = FACE_DOWN;   // 들어오면 화면 앞쪽을 본다
    p.moving       = false;
    p.bubble_lv    = 0;
    p.power_lv     = 0;
    p.speed_lv     = 0;
    p.trap_ticks   = 0;
    p.invuln_ticks = 0;
    p.grazing      = false;
    p.graze_streak = 0;
    p.graze_timer  = 0;
    p.flood_ticks  = 0;
    p.spawn_slot   = spawn;

    // 판이 도는 중에 들어오면 관전부터 한다.
    // 남들이 1분 파밍한 판에 빈손으로 끼워 넣으면 들어오자마자 죽는다.
    // 다음 판에서 같이 시작한다
    p.alive = (g_game.phase == ROUND_WAITING || g_game.phase == ROUND_COUNTDOWN);

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

inline int AliveCount()
{
    int n = 0;
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (Occupied(g_game.players[i]) && g_game.players[i].alive) ++n;
    }
    return n;
}

// 사람이 몇 명 앉아 있나 (봇 빼고)
inline int HumanCount()
{
    int n = 0;
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].s != nullptr) ++n;
    }
    return n;
}

inline int BotCount()
{
    int n = 0;
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].is_bot) ++n;
    }
    return n;
}

// 봇을 하나 빼서 사람에게 자리를 내준다.
// **죽은 봇부터** 뺀다. 살아 있는 봇을 지우면 판이 그 자리에서 어색해진다
inline bool DropOneBot()
{
    int pick = -1;
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (!g_game.players[i].is_bot) continue;
        if (!g_game.players[i].alive) { pick = i; break; }
        if (pick < 0) pick = i;
    }
    if (pick < 0) {
        return false;
    }

    g_game.spawn_used[g_game.players[pick].spawn_slot] = false;
    g_game.players[pick].is_bot = false;
    g_game.players[pick].alive  = false;
    --g_game.player_count;
    return true;
}

// 자리를 봇으로 채운다.
//
// 왜 필요한가.
//   혼자 접속하면 "한 명 더 들어오면 시작한다" 만 보고 끝난다.
//   링크를 받은 사람이 게임을 한 번도 못 보는 것이다.
//
// 사람이 들어올 자리를 남겨두지 않는다. 들어오면 그때 봇을 하나 뺀다.
// 남겨두면 사람이 안 올 때 그 자리가 계속 비어 있다
inline void FillBots(int target)
{
    if (target > PLAYER_MAX) target = PLAYER_MAX;

    while (g_game.player_count < target) {
        if (AddPlayer(nullptr, true) < 0) break;
    }
}

inline void EnterPhase(uint8_t phase)
{
    g_game.phase       = phase;
    g_game.phase_ticks = 0;
}

// 판을 새로 깔고 붙어 있는 사람을 다시 앉힌다.
//
// 세션은 그대로 두고 게임만 처음으로 돌린다. 연결을 끊지 않는다.
// 끊으면 브라우저가 다시 붙느라 몇 초가 뜨고, 그동안 다음 판이 이미 시작해 있다.
inline void RestartGame()
{
    Session* keep[PLAYER_MAX];
    int n = 0;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].s != nullptr) {
            keep[n++] = g_game.players[i].s;
            g_game.players[i].s->slot = -1;   // 새로 앉기 전까지는 자리가 없다
        }
    }

    // 씨앗을 굴린다. 맵도 새로 나오지만 처음 씨앗만 알면 순서가 재현된다
    unsigned int next = g_game.seed * 1103515245u + 12345u;
    int    scale = g_game.flood_scale;
    int    round = g_game.round_no;

    // 다시 앉힐 때 산 채로 앉아야 하므로 먼저 단계를 돌려놓는다
    g_game.phase = ROUND_WAITING;

    InitGame(next, scale);
    g_game.round_no = round + 1;

    for (int i = 0; i < n; ++i) {
        AddPlayer(keep[i]);
    }

    EnterPhase(n >= ROUND_MIN_PLAYERS ? ROUND_COUNTDOWN : ROUND_WAITING);
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
// 상자를 민다.
//
// 블록은 부수는 것 말고 할 게 없다. 길을 막고 있으면 폭탄을 놓고 2.5초를 기다린다.
// 상자는 **밀 수 있다.** 그래서 같은 벽 하나에 선택지가 둘이 된다.
//   부순다  2.5초 걸리고 아이템이 나올 수도 있다
//   민다    즉시. 대신 민 자리에 그대로 있다
//
// 밀어서 통로를 막을 수도 있고, 물에 밀어 넣을 수도 있고,
// 쫓기는 중에 뒤로 밀어 길을 끊을 수도 있다.
// 규칙 하나로 판단거리가 여럿 생기는 쪽이 좋은 규칙이다.
//
// 한 축만 누르고 있을 때만 민다. 대각선이면 어느 쪽을 미는지가 애매하다.
// 판정 칸 기준이라 몸이 조금 어긋나 있어도 밀린다.
// 밀기까지 칸에 맞추라고 하면 그건 짜증이지 난이도가 아니다

// 밀려가는 상자를 한 틱 진행시킨다.
//
// 다 밀리면 떠난 칸을 비운다. 밀리는 동안 두 칸을 다 막고 있었으므로,
// 이 순간이 그 칸이 지나갈 수 있게 되는 순간이다.
//
// 도중에 물줄기가 와서 상자가 부서질 수 있다. 그러면 갈 칸이 이미 비어 있으니,
// 떠난 칸만 정리하고 조용히 접는다 — 부서진 상자를 다시 놓으면 안 된다.
//
// 소유 스레드 : tick
inline void StepSlidingBoxes(GameMap& map)
{
    for (int i = 0; i < MAX_SLIDING_BOX; ++i) {
        SlidingBox& sb = g_game.slides[i];
        if (!sb.used) continue;

        if (--sb.left > 0) continue;

        sb.used = false;
        if (map.tile[sb.fy][sb.fx] == TILE_BOX) {
            map.tile[sb.fy][sb.fx] = TILE_EMPTY;
        }
    }
}

// 이 칸이 지금 밀려가는 중인가. 밀리는 상자를 또 밀지 않으려고 본다
inline bool IsSliding(int tx, int ty)
{
    for (int i = 0; i < MAX_SLIDING_BOX; ++i) {
        const SlidingBox& sb = g_game.slides[i];
        if (!sb.used) continue;
        if ((sb.fx == tx && sb.fy == ty) || (sb.tx == tx && sb.ty == ty)) return true;
    }
    return false;
}

inline void TryPushBox(GameMap& map, Player& p)
{
    if (!p.alive || p.trap_ticks > 0) {
        return;
    }
    if (p.push_cool > 0) {
        --p.push_cool;
        return;
    }

    int dx = (p.dir_y == 0) ? p.dir_x : 0;
    int dy = (p.dir_x == 0) ? p.dir_y : 0;
    if (dx == 0 && dy == 0) {
        p.push_charge = 0;
        return;
    }

    int bx = p.judge_tx + dx;
    int by = p.judge_ty + dy;
    if (bx < 0 || by < 0 || bx >= MAP_W || by >= MAP_H) {
        return;
    }
    if (map.tile[by][bx] != TILE_BOX || IsSliding(bx, by)) {
        p.push_charge = 0;
        return;
    }

    // **0.5초를 버텨야 움직이기 시작한다.**
    //
    // 전에는 방향을 대는 순간 옆 칸으로 순간이동했다. 미는 것처럼 안 보였고,
    // 지나가다 스치기만 해도 상자가 튀어서 판이 제멋대로 바뀌었다.
    //
    // 대고 있는 칸이 바뀌면 처음부터 다시 센다. 안 그러면 상자 앞을 훑고 지나가는
    // 동안 시간이 이어져서, 마지막에 닿은 상자가 갑자기 밀린다
    if (p.push_tx != bx || p.push_ty != by) {
        p.push_tx = bx;
        p.push_ty = by;
        p.push_charge = 0;
    }
    if (++p.push_charge < PUSH_CHARGE_TICKS) {
        return;
    }
    p.push_charge = 0;

    int nx = bx + dx;
    int ny = by + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) {
        return;
    }
    if (map.tile[ny][nx] != TILE_EMPTY || IsSliding(nx, ny)) {
        return;   // 뒤가 막혔다. 밀 데가 없으면 부수는 수밖에 없다
    }

    // 사람이 있는 칸으로는 못 민다. 밀어서 깔아뭉개면 그건 다른 게임이다.
    //
    // 판정 칸이 아니라 몸이 닿는 칸을 전부 본다. 전에는 판정 칸, 그러니까 몸
    // 중심이 있는 칸만 봤다. 몸은 0.8칸이라 중심이 옆 칸에 있어도 몸의 4할은
    // 이 칸에 걸쳐 있는데, 그리로 상자가 들어오면 벽 밀어내기가 사람을 옆으로
    // 밀어낸다. 걷다가 갑자기 옆으로 밀린다는 신고가 여기서 나왔다.
    //
    // 미는 쪽이 손해를 보는 게 맞다. 상자에 밀려 몸이 튕기는 쪽이 훨씬 나쁘다
    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& o = g_game.players[i];
        if (!Occupied(o) || !o.alive) continue;

        int x0, x1, y0, y1;
        BodySpanAxis(o.px, &x0, &x1);
        BodySpanAxis(o.py, &y0, &y1);
        if (nx >= x0 && nx <= x1 && ny >= y0 && ny <= y1) return;
    }

    // 자리를 하나 잡는다. 없으면 안 민 것으로 한다 —
    // 여덟 개가 동시에 밀리는 일은 없고, 없는데 억지로 밀면 어느 칸이
    // 언제 비는지 아무도 모르게 된다
    int si = -1;
    for (int i = 0; i < MAX_SLIDING_BOX; ++i) {
        if (!g_game.slides[i].used) { si = i; break; }
    }
    if (si < 0) {
        return;
    }

    // 떠난 칸은 아직 안 비운다. 밀리는 동안 상자는 두 칸을 다 막는다
    map.tile[ny][nx] = TILE_BOX;

    SlidingBox& sb = g_game.slides[si];
    sb.used = true;
    sb.fx = bx; sb.fy = by;
    sb.tx = nx; sb.ty = ny;
    sb.left = PUSH_SLIDE_TICKS;

    p.push_cool = PUSH_COOLDOWN_TICKS;

    ++g_push_count;

    int dir = (dx > 0) ? 0 : (dx < 0) ? 1 : (dy > 0) ? 2 : 3;
    PushEvent(EVT_PUSH, bx, by, 0xFF, dir);
}

inline void MovePlayer(const GameMap& map, Player& p)
{
    if (!p.alive) {
        return;
    }

    bool trapped = (p.trap_ticks > 0);

    int was_x = p.px;
    int was_y = p.py;

    // 보는 쪽을 먼저 정한다. 실제로 갔는지와 상관없이 누른 대로 돈다.
    // 벽을 보고 서 있는 것도 그림으로는 그쪽을 보는 게 맞다.
    //
    // 두 방향을 같이 누르면 가로를 쓴다. 옆모습이 앞뒤보다 알아보기 쉽다
    if (p.dir_x > 0)      p.face = FACE_RIGHT;
    else if (p.dir_x < 0) p.face = FACE_LEFT;
    else if (p.dir_y > 0) p.face = FACE_DOWN;
    else if (p.dir_y < 0) p.face = FACE_UP;

    // ── 대쉬 ──────────────────────────────────────────────────
    //
    // 갇혀도 아주 느리게는 갈 수 있다.
    // 아예 묶어두면 5초가 죽은 시간이 된다. 기어서라도 물줄기 밖으로 나갈 수 있어야
    // 그 5초가 판단하는 시간이 된다
    int speed = trapped ? TRAP_MOVE_SPEED
                        : (MOVE_SPEED_BASE + p.speed_lv * MOVE_SPEED_STEP);

    // 움직이기 전에 코너를 돌게 도와준다.
    // 한 방향만 누르고 있을 때만이다. 두 방향을 누르고 있으면 본인이 조준하는 중이라
    // 서버가 끼어들면 오히려 방해가 된다.
    // 갇혔을 때는 안 도와준다. 물방울에 갇힌 채로 미끄러지면 이상하다
    // 한 방향만 누르고 있을 때만이다.
    // 두 방향을 누르고 있으면 본인이 조준하는 중이라 끼어들면 방해가 된다
    if (p.dir_x != 0 && p.dir_y == 0) {
        p.py = CenterAxis(map, p.px, p.py, p.dir_x * speed, true, speed);
        p.py = CornerAssistAxis(map, p.px, p.py, p.dir_x * speed, true, speed);
    }
    else if (p.dir_y != 0 && p.dir_x == 0) {
        p.px = CenterAxis(map, p.py, p.px, p.dir_y * speed, false, speed);
        p.px = CornerAssistAxis(map, p.py, p.px, p.dir_y * speed, false, speed);
    }

    // 대각선(두 방향을 같이 누름)이면 가로·세로 두 축이 **각자** speed만큼
    // 간다. 그러면 대각선 이동 거리가 직선의 약 1.41배(√2)가 된다 -
    // 빗변이 두 변의 합과 같은 셈이니 당연히 더 간 것이다.
    // 사람은 이걸 몰라도 몸으로 "대각선이 더 빠르다"를 느끼고, 그러면
    // 다들 대각선으로만 다니게 된다 - 이동 자체가 왜곡된다.
    //
    // 두 축이 같이 눌렸을 때만 1/√2(≈0.7071)를 곱해 대각선 속도를 직선과
    // 맞춘다. float 을 안 쓰므로(README) 181/256(≈0.7070)로 정수 근사한다
    int diag_speed = (p.dir_x != 0 && p.dir_y != 0) ? (speed * 181 / 256) : speed;

    // 가로 먼저, 그다음 세로.
    // 한 축씩 따로 보는 이유는 벽에 비스듬히 부딪혔을 때
    // 막힌 축만 서고 나머지 축은 계속 가게 하기 위해서다. 벽을 타고 미끄러진다
    p.px = StepAxis(map, p.px, p.py, p.dir_x * diag_speed, true);
    p.py = StepAxis(map, p.py, p.px, p.dir_y * diag_speed, false);

    // 몸이 벽에 파묻혀 있으면 빼낸다.
    //
    // 옆으로 달리는 동안 위쪽 칸이 벽으로 바뀌는 경우가 있다.
    // 가는 축은 StepAxis 가 보지만 옆 축은 아무도 안 봐서, 여기서 한 번 훑는다
    {
        p.py = ClampAxis(map, p.py, p.px, false, speed);
        p.px = ClampAxis(map, p.px, p.py, true,  speed);
    }

    // 벽에 막혀 한 칸도 못 갔으면 걷는 그림을 쓰지 않는다.
    // 누르고 있는지가 아니라 갔는지를 본다. 안 그러면 벽에 대고 제자리걸음을 한다
    p.moving = (p.px != was_x || p.py != was_y);

    // 위치가 다 정해진 뒤에 판정 칸을 정한다. 몸 중심이 있는 칸이다
    p.judge_tx = JudgeAxis(p.px);
    p.judge_ty = JudgeAxis(p.py);
}
