// Server/src/Bot.h — 사람 대신 두는 봇
//
// 원래 tools/roundsim.cpp 안에만 있었다. 밸런스를 재려고 만든 것이라
// 화면도 소켓도 없이 규칙만 두들기는 용도였다.
//
// 9/1 에 헤더로 꺼냈다. **서버가 같은 두뇌를 그대로 쓴다.**
//
// 왜 꺼냈나.
//   혼자 접속하면 "한 명 더 들어오면 시작한다" 만 보고 끝난다.
//   링크를 받은 사람이 게임을 한 번도 못 보는 것이다.
//   봇이 자리를 채우면 혼자서도 판이 돈다.
//
//   AI 를 두 벌 쓰면 밸런스를 잰 판과 실제로 도는 판이 달라진다.
//   roundsim 이 "평균 3분" 이라고 말해도 그건 다른 게임 얘기가 된다.
//   그래서 한 벌만 둔다.
//
// 소유 스레드 : tick
//   여기 있는 전역(위험 지도 등)은 전부 틱 스레드만 만진다.
//   워커는 이 파일을 아예 안 본다.
//
// 봇은 세션이 없다. Player::is_bot 이 켜져 있고 s 는 nullptr 이다.
// 그래서 보낼 것도 없고 끊길 일도 없다.
#pragma once

#include "GameTick.h"

// 자리를 봇으로 몇 명까지 채울 것인가. 명령줄로 바꾼다 (Server.exe bots N).
//
// 소유 스레드 : main 이 시작할 때 한 번 쓰고, 그 뒤로는 tick 만 읽는다
inline int g_bot_target = BOT_FILL_TO;

inline const int DX[4] = {  1, -1,  0,  0 };
inline const int DY[4] = {  0,  0,  1, -1 };

// ── 봇 ───────────────────────────────────────────────────────
//
// 너무 멍청하면 자기 물풍선에 다 죽어서 숫자가 의미 없어진다.
// 너무 똑똑하면 만들다 날 샌다. 아래 다섯 줄이면 사람 흉내는 난다.
//
//   1) 지금 위험하면 안전한 칸으로 도망친다
//   2) 물에 잠긴 구역이면 가운데로 간다
//   3) 가까이 아이템이 있으면 주우러 간다
//   4) 블록 옆이고 놓고 도망칠 수 있으면 놓는다
//   5) 아니면 가운데 쪽으로 걷는다

// 위험을 두 겹으로 나눈다.
//
//   g_danger  놓인 물풍선 전부의 십자. **여기 서 있지 않는다**
//   g_soon    곧 터질 것과 이미 터진 것. **여기를 지나가지도 않는다**
//
// 처음엔 한 겹이었다. 그걸로 '지나가지 않는다' 를 하니 판 전체가 막혀서
// 봇들이 서로 못 만나고 30판에 3판이 무승부로 끝났다. 판이 안 끝나는 건 떨림보다 나쁘다.
//
// 퓨즈가 2.5초 남은 물풍선 때문에 길을 막을 이유가 없다. 지나갈 시간이 충분하다.
// 1초 안에 터질 것만 길에서 뺀다. 한 칸 가는 데 0.47초니 두 칸은 벌 수 있다.
//
// 소유 스레드 : tick
inline bool g_danger[MAP_H][MAP_W];
inline bool g_soon[MAP_H][MAP_W];

inline void BuildDangerMap(int lookahead)
{
    memset(g_danger, 0, sizeof(g_danger));
    memset(g_soon,   0, sizeof(g_soon));

    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (g_game.blast[y][x] > 0) { g_danger[y][x] = true; g_soon[y][x] = true; }
        }
    }

    for (int i = 0; i < MAX_BUBBLE; ++i) {
        const Bubble& b = g_game.bubbles[i];
        if (!b.used || b.fuse > lookahead) continue;

        // 1초 안에 터지나. 그러면 길에서도 뺀다
        const bool soon = (b.fuse <= TICK_RATE);

        g_danger[b.ty][b.tx] = true;
        if (soon) g_soon[b.ty][b.tx] = true;

        for (int d = 0; d < 4; ++d) {
            for (int step = 1; step <= b.range; ++step) {
                int x = b.tx + DX[d] * step;
                int y = b.ty + DY[d] * step;
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) break;

                uint8_t t = g_game.map.tile[y][x];
                if (t == TILE_WALL) break;
                g_danger[y][x] = true;
                if (soon) g_soon[y][x] = true;
                // 물줄기는 부술 수 있는 것에서 멈춘다. **밀 수 있는 상자도 포함**이다.
                // 9/1 에 상자를 넣고 여기를 안 고쳐서, 봇이 상자 뒤까지 위험하다고 봤다.
                // 안 죽지는 않지만 갈 수 있는 데를 안 가서 판이 늘어진다
                if (IsBreakableTile(t) || t == TILE_BUBBLE) break;
            }
        }
    }
}

inline bool Passable(int x, int y)
{
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    return g_game.map.tile[y][x] == TILE_EMPTY;
}

// (x,y) 에서 d 방향으로 한 걸음 갈 때, 그 자리의 상자를 밀어낼 수 있나.
// 조건은 Game.h 의 TryPushBox 와 같아야 한다. 어긋나면 봇이 안 밀리는 상자를 향해 선다
inline bool CanPushInto(int x, int y, int d)
{
    int bx = x + DX[d],  by = y + DY[d];    // 상자가 있는 칸
    int nx = bx + DX[d], ny = by + DY[d];   // 상자가 갈 칸

    if (bx < 0 || by < 0 || bx >= MAP_W || by >= MAP_H) return false;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return false;
    if (g_game.map.tile[by][bx] != TILE_BOX)   return false;
    if (g_game.map.tile[ny][nx] != TILE_EMPTY) return false;

    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& o = g_game.players[i];
        if (!Occupied(o) || !o.alive) continue;
        if (o.judge_tx == nx && o.judge_ty == ny) return false;
    }
    return true;
}

// 목표에 닿는 첫 걸음 방향을 찾는다. 못 찾으면 false
enum class Goal { Safe, Item, Center, Block, Enemy, Prey };

// 지금 살아 있는 사람이 어느 칸에 있나. 사냥할 때 쓴다
inline int g_enemy_at[MAP_H][MAP_W];
// 그중 갇혀 있는 사람. 몸으로 부딪치면 터진다
inline int g_prey_at[MAP_H][MAP_W];

inline void BuildEnemyMap()
{
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x) {
            g_enemy_at[y][x] = -1;
            g_prey_at[y][x]  = -1;
        }

    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& p = g_game.players[i];
        if (!Occupied(p) || !p.alive) continue;
        g_enemy_at[p.judge_ty][p.judge_tx] = i;
        if (p.trap_ticks > 0) g_prey_at[p.judge_ty][p.judge_tx] = i;
    }
}

// 목표 칸 자체도 돌려준다 (out_gx/out_gy).
//
// 전에는 첫 걸음 방향만 줬다. 그래서 SafeToPlace 가 '그 방향으로 직선으로' 훑어
// 안전한 칸을 다시 찾았는데, **길이 꺾이면 못 찾고 목표가 제자리로 남았다.**
// 되감기를 보면 놓기 직후 방향이 정지이고 도망목표가 자기 칸이다. 놓고 서 있는 것이다
inline bool FindStep(int sx, int sy, Goal goal, int max_steps, int* out_dx, int* out_dy,
                     int me = -1, int* found_dist = nullptr, bool allow_push = false,
                     bool allow_danger = false, int* out_gx = nullptr, int* out_gy = nullptr)
{
    static int  dist[MAP_H][MAP_W];
    static int  fromd[MAP_H][MAP_W];
    static int  qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];

    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            dist[y][x] = -1;

    int head = 0, tail = 0;
    dist[sy][sx] = 0;
    fromd[sy][sx] = -1;
    qx[tail] = sx; qy[tail] = sy; ++tail;

    int cx = MAP_W / 2, cy = MAP_H / 2;

    // 물에 잠긴 칸은 지나가지 않는다. 들어가면 카운트다운이 돈다.
    //
    // 이게 없으면 물 경계에서 덜덜 떤다. 물 밖으로 한 걸음 나오는 순간
    // '잠긴 구역이면 가운데로' 규칙이 꺼지고, 그다음 규칙이 적을 쫓아 다시 물로 넣는다.
    // 나오면 들어가고 들어가면 나온다. 관전하면 그것만 하고 아무것도 안 하는 것으로 보인다.
    //
    // 이미 물 안에 있으면 예외다. 그때는 물을 지나야만 나올 수 있다
    const bool start_wet = IsUnderWater(sx, sy);

    // **위험한 칸은 지나가지 않는다.**
    //
    // 9/2 에 되감기를 찍어보고 찾은 것이다. 봇이 두 칸 사이에서 2틱 주기로 떨었다.
    //   (41,35) 위험함  -> 도망 실패 -> '부수기' 규칙이 이겨서 위로
    //   (41,36) 안전함  -> 도망 규칙이 이겨서 아래로
    //   -> 다시 (41,35). 무한 반복. 그러다 터진다.
    //
    // 원인은 길찾기가 **목표만** 위험한지 보고 지나가는 칸은 안 본 것이다.
    // 그래서 안전한 데 서 있다가도 위험한 칸을 밟고 지나가는 길을 골랐다.
    // 도망쳐서 안전해지는 순간 다른 규칙이 이겨서 도로 들어간다.
    //
    // 안전한 데 서 있으면 위험한 칸은 아예 길로 안 친다. 그러면
    //   - 진동이 없어진다. 되돌아가는 길 자체가 없다
    //   - 자기 물풍선에도 덜 죽는다. 남의 십자로도 안 걸어 들어간다
    // 이미 위험한 칸에 있으면 예외다. 그때는 위험을 밟고서라도 나가야 한다.
    // 물을 안 지나가게 한 것과 같은 꼴이다
    const bool start_danger = g_soon[sy][sx];

    while (head < tail) {
        int x = qx[head], y = qy[head];
        ++head;

        if (dist[y][x] > max_steps) break;

        bool hit = false;
        switch (goal) {
        case Goal::Safe:
            hit = !g_danger[y][x];
            break;
        case Goal::Item:
            hit = (g_game.item[y][x] != ITEM_NONE) && !g_danger[y][x];
            break;
        case Goal::Center:
            hit = !IsUnderWater(x, y) && !g_danger[y][x]
                  && (abs(x - cx) + abs(y - cy) < abs(sx - cx) + abs(sy - cy));
            break;
        case Goal::Block:
            // 블록에 붙은 칸. 거기 서면 부술 수 있다
            for (int d = 0; d < 4; ++d) {
                if (g_game.map.IsBlock(x + DX[d], y + DY[d])) hit = true;
            }
            if (g_danger[y][x]) hit = false;
            break;
        case Goal::Enemy:
            hit = (g_enemy_at[y][x] >= 0 && g_enemy_at[y][x] != me);
            break;
        case Goal::Prey:
            // 갇힌 적. 물줄기로는 못 죽이니 직접 가서 부딪쳐야 한다
            hit = (g_prey_at[y][x] >= 0 && g_prey_at[y][x] != me) && !g_danger[y][x];
            break;
        }

        if (hit && dist[y][x] > 0) {
            if (found_dist) *found_dist = dist[y][x];
            if (out_gx) { *out_gx = x; *out_gy = y; }
            // 첫 걸음까지 되짚어 올라간다
            int bx = x, by = y;
            while (dist[by][bx] > 1) {
                int d = fromd[by][bx];
                bx -= DX[d]; by -= DY[d];
            }
            *out_dx = bx - sx;
            *out_dy = by - sy;
            return true;
        }

        for (int d = 0; d < 4; ++d) {
            int nx = x + DX[d], ny = y + DY[d];
            // 전에는 Passable 이 범위까지 봐줘서 dist 를 안전하게 읽었다.
            // 이제 막힌 칸도 들여다보므로 범위를 먼저 본다
            if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
            if (dist[ny][nx] >= 0) continue;
            if (!start_wet && IsUnderWater(nx, ny)) continue;
            if (!start_danger && !allow_danger && g_soon[ny][nx]) continue;
            if (!Passable(nx, ny)) {
                // 막힌 칸이라도 밀 수 있는 상자면 지나갈 수 있다.
                // **이 스위치는 평소에 꺼져 있다.** 켜면 BFS 가 밀기를 한 걸음으로 세는데,
                // 실제로는 한 번 밀 때마다 PUSH_COOLDOWN_TICKS 를 쉰다.
                // 그래서 보통 길로 못 갈 때만 켜서 다시 부른다
                if (!allow_push || !CanPushInto(x, y, d)) continue;
            }
            dist[ny][nx] = dist[y][x] + 1;
            fromd[ny][nx] = d;
            qx[tail] = nx; qy[tail] = ny; ++tail;
        }
    }

    return false;
}

// 여기 놓고 살아나갈 수 있나. 놓기 전에 확인한다
// 퓨즈가 터지기 전에 몇 칸이나 갈 수 있나.
//
// 전에는 '8칸 안에 안전한 칸이 있으면 놓는다' 였다. 8 은 그냥 적어둔 수였다.
// 실제로는 퓨즈가 2.5초(75틱)이고 기본 속도로 한 칸 가는 데 14틱이 걸린다.
// **5칸밖에 못 간다.** 그래서 봇이 놓고 나서 사거리 끝까지 걸어갔다가 거기서 맞았다.
// 관전하면 한계거리에서 왔다갔다하다 자기 물풍선에 죽는 것처럼 보인다.
//
// 롤러를 먹으면 더 갈 수 있으므로 그 사람 속도로 계산한다.
// 한 칸은 빼둔다. 칸 경계에서 놓으면 첫 칸을 반만 가고 시작한다
inline int EscapeReach(const Player& p)
{
    int speed = MOVE_SPEED_BASE + p.speed_lv * MOVE_SPEED_STEP;
    int ticks_per_tile = TILE_UNITS / speed;
    if (ticks_per_tile < 1) ticks_per_tile = 1;

    int reach = BUBBLE_FUSE_TICKS / ticks_per_tile - 1;
    if (reach < 1) reach = 1;
    return reach;
}

// 여기 놓고 살아나갈 수 있나.
//
// **찾은 안전한 칸을 돌려준다.** 전에는 있다/없다만 돌려주고 버렸다.
// 그래서 놓은 뒤에 제자리에 서고, 다음 틱에 도망 목표를 처음부터 다시 골랐다.
// 그때는 10칸 범위로 골라서 **4칸밖에 못 가는데 10칸짜리 목표**를 잡았다.
// 관전하면 놓고 나서 사거리 끝까지 걸어가다 거기서 터지는 것으로 보인다.
// 놓을 때 확인한 그 칸으로 그대로 간다
inline bool SafeToPlace(int tx, int ty, int range, int reach, int* out_gx, int* out_gy)
{
    uint8_t saved = g_game.map.tile[ty][tx];
    g_game.map.tile[ty][tx] = TILE_BUBBLE;

    bool danger_backup[MAP_H][MAP_W];
    memcpy(danger_backup, g_danger, sizeof(g_danger));

    // 내가 놓을 물풍선의 십자를 위험에 더한다
    g_danger[ty][tx] = true;
    for (int d = 0; d < 4; ++d) {
        for (int step = 1; step <= range; ++step) {
            int x = tx + DX[d] * step, y = ty + DY[d] * step;
            if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) break;
            uint8_t t = g_game.map.tile[y][x];
            if (t == TILE_WALL) break;
            g_danger[y][x] = true;
            if (t != TILE_EMPTY) break;
        }
    }

    int dx, dy;
    int gx = tx, gy = ty;

    // 놓을 자리는 위험해질 자리다. 그러니 위험을 밟고 나가는 것을 허용해서 찾는다.
    // 찾은 칸을 그대로 목표로 쓴다. 직선으로 다시 훑지 않는다
    bool ok = FindStep(tx, ty, Goal::Safe, reach, &dx, &dy,
                       -1, nullptr, false, true, &gx, &gy);

    if (ok && out_gx) { *out_gx = gx; *out_gy = gy; }

    memcpy(g_danger, danger_backup, sizeof(g_danger));
    g_game.map.tile[ty][tx] = saved;
    return ok;
}

// 도망 목표를 붙잡아 둔다.
//
// 매 틱 새로 고르면 칸 경계를 넘는 순간 기준 칸이 바뀌면서
// 다른 안전한 칸이 뽑히고, 방향이 뒤집혀 제자리에서 떨린다.
// 그러다 자기 폭탄에 죽는다. 사람은 한번 정한 데로 간다
inline int g_flee_x[PLAYER_MAX], g_flee_y[PLAYER_MAX];

// 정한 방향을 몇 틱 붙잡는다.
//
// 봇이 판 경계나 구역 경계에서 좌우로 덜덜 떠는 게 보였다. 관전할 때 제일 눈에 걸린다.
// 원인은 **매 틱 처음부터 다시 정하기 때문**이다.
// 칸 경계를 넘는 순간 기준 칸이 바뀌고, 그러면 가운데로 가는 방향이 뒤집힌다.
// 다음 틱에 되돌아오고, 또 뒤집힌다.
//
// 사람은 한번 정하면 몇 걸음은 그 방향으로 간다. 그걸 흉내 낸다.
// 위험해지면 즉시 푼다. 붙잡고 있다가 맞으면 그게 더 나쁘다
inline int g_hold[PLAYER_MAX];
inline int g_hold_dx[PLAYER_MAX], g_hold_dy[PLAYER_MAX];

// 한 칸 가는 데 걸리는 틱만큼 붙잡는다. 한 칸은 끝까지 간다는 뜻이다
inline int HoldTicks(const Player& p)
{
    int speed = MOVE_SPEED_BASE + p.speed_lv * MOVE_SPEED_STEP;
    int t = TILE_UNITS / speed;
    return t < 2 ? 2 : t;
}

// 목표에 도착한 뒤 잠깐 머무는 시간.
//
// 도착하면 목표가 풀리고 그 자리에서 곧바로 새 목표를 고른다.
// 그런데 '블록에 붙은 칸' 은 자기가 선 칸이 될 수 없어서(거리 0은 제외된다)
// **반드시 옆 칸이 뽑힌다.** 거기 가면 또 옆 칸이 뽑힌다. 좌우로 왔다 갔다 한다.
// 집계에서 부수기 -> 부수기 가 판당 1284회로 1등이었다.
//
// 도착했으면 잠깐 서 있는다. 그동안 물풍선을 놓을 수 있으면 놓는다.
// 사람도 목적지에 닿으면 거기서 뭔가를 하지, 바로 옆으로 다시 걷지 않는다
inline int g_settle[PLAYER_MAX];
inline int g_goal_x[PLAYER_MAX], g_goal_y[PLAYER_MAX];
inline int g_goal_ttl[PLAYER_MAX];
inline uint8_t g_goal_why[PLAYER_MAX];

inline void ClearFleeTargets()
{
    for (int i = 0; i < PLAYER_MAX; ++i) {
        g_flee_x[i] = -1; g_flee_y[i] = -1;
        g_hold[i] = 0;
        g_goal_x[i] = -1; g_goal_ttl[i] = 0; g_settle[i] = 0;
    }
}

// 정해둔 칸으로 가는 첫 걸음
inline bool StepToward(int sx, int sy, int gx, int gy, int* out_dx, int* out_dy)
{
    static int dist[MAP_H][MAP_W];
    static int fromd[MAP_H][MAP_W];
    static int qx[MAP_W * MAP_H], qy[MAP_W * MAP_H];

    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            dist[y][x] = -1;

    int head = 0, tail = 0;
    dist[sy][sx] = 0;
    qx[tail] = sx; qy[tail] = sy; ++tail;

    while (head < tail) {
        int x = qx[head], y = qy[head];
        ++head;

        if (x == gx && y == gy) {
            if (dist[y][x] == 0) return false;
            int bx = x, by = y;
            while (dist[by][bx] > 1) {
                int d = fromd[by][bx];
                bx -= DX[d]; by -= DY[d];
            }
            *out_dx = bx - sx;
            *out_dy = by - sy;
            return true;
        }

        for (int d = 0; d < 4; ++d) {
            int nx = x + DX[d], ny = y + DY[d];
            if (!Passable(nx, ny) || dist[ny][nx] >= 0) continue;
            dist[ny][nx] = dist[y][x] + 1;
            fromd[ny][nx] = d;
            qx[tail] = nx; qy[tail] = ny; ++tail;
        }
    }
    return false;
}

enum BotReason {
    R_NONE = 0,
    R_HOLD,        // 붙잡아 둔 방향으로 계속
    R_FLEE_KEEP,   // 도망 중. 아까 정한 목표로
    R_FLEE_NEW,    // 도망 목표를 새로 정했다
    R_FLEE_STUCK,  // 위험한데 갈 데가 없다
    R_WATER,       // 물에서 나가는 중
    R_PREY,        // 갇힌 적을 마무리하러
    R_PLACE_ENEMY, // 적이 사거리에 들어와서 놓았다
    R_ITEM,        // 아이템 주우러
    R_ITEM_PUSH,   // 상자를 밀고 아이템 주우러
    R_PLACE_BLOCK, // 블록을 부수려고 놓았다
    R_HUNT,        // 적을 찾아 나선다
    R_BLOCK,       // 부술 게 있는 쪽으로
    R_CENTER,      // 가운데로
    R_IDLE,        // 할 게 없다
    R_COUNT
};

inline const char* BOT_REASON_NAME[R_COUNT] = {
    "없음", "붙잡기", "도망(유지)", "도망(새로)", "도망못함", "물탈출",
    "마무리", "놓기(적)", "아이템", "아이템(밀기)", "놓기(블록)",
    "사냥", "부수기", "가운데", "멍때림",
};

inline uint8_t g_reason[PLAYER_MAX];

// 목표를 잡는다. 한 칸 가는 시간의 네 배까지 들고 간다
inline void SetGoal(int slot, const Player& p, int gx, int gy, uint8_t why)
{
    g_goal_x[slot] = gx;
    g_goal_y[slot] = gy;
    g_goal_why[slot] = why;
    g_goal_ttl[slot] = HoldTicks(p) * 4;
}

inline void ClearGoal(int slot)
{
    g_goal_x[slot] = -1;
    g_goal_ttl[slot] = 0;
}

// 놓자마자 확인해 둔 칸으로 출발한다.
//
// 제자리에 서서 다음 틱을 기다리면 퓨즈의 첫 틱들을 그냥 버린다.
// 2.5초 안에 네 칸을 가야 하는데 한 틱도 아깝다
inline void FleeTo(int slot, Player& p, int tx, int ty, int gx, int gy)
{
    SetGoal(slot, p, gx, gy, R_FLEE_KEEP);

    int dx = 0, dy = 0;
    if (gx != tx || gy != ty) {
        if (StepToward(tx, ty, gx, gy, &dx, &dy)) {
            p.dir_x = dx; p.dir_y = dy;
            return;
        }
    }
    p.dir_x = 0; p.dir_y = 0;
}

// 이번 틱에 어느 규칙으로 방향을 정했나.
//
// 소유 스레드 : tick
//
// 봇이 이상해 보인다는 말은 고칠 수 있는 말이 아니다.
// **어느 규칙과 어느 규칙이 번갈아 나오는지**를 알아야 고칠 데가 나온다.
// 죽은 봇의 마지막 몇 초를 되감아 보려고 매 틱 남긴다.
// 서버는 이 값을 안 쓴다. roundsim 만 읽는다

// 어디로 가기로 했나. 도망 말고 나머지 목표를 기억한다.
//
// **떨림의 진짜 원인이 여기였다.** 되감기와 집계로 찾았다.
//   붙잡기 -> 아이템   판당 787회
//   부수기 -> 부수기   판당 602회
//
// 도망만 목표를 기억하고 나머지는 매 틱 처음부터 다시 골랐다.
// 칸 경계를 넘는 순간 기준 칸이 바뀌면 같은 규칙이 정반대 답을 낸다.
// 양옆에 블록이 있으면 '부수기' 가 왼쪽과 오른쪽을 번갈아 준다.
//
// 사람은 한번 정한 데까지는 간다. 목표를 들고 있다가
// 도착했거나 · 사라졌거나 · 위험해졌거나 · 오래 걸리면 새로 고른다

inline void ThinkBot(int slot)
{
    Player& p = g_game.players[slot];
    if (!p.alive) return;

    int tx = p.judge_tx, ty = p.judge_ty;
    int dx = 0, dy = 0;

    // 방향을 몇 틱 붙잡는 장치가 여기 있었다. 뺐다.
    //
    // 목표를 기억하는 것과 방향을 붙잡는 것이 **같은 일을 다르게** 하고 있었다.
    // 둘이 번갈아 이기면서 오히려 더 떨었다 — 붙잡기에서 부수기로 뒤집는 것이
    // 판당 1058회로 1등이었다.
    //
    // 목표가 상위 개념이다. 어디로 갈지가 정해져 있으면 방향은 저절로 일관된다.
    // 두 장치가 같은 문제를 다르게 풀면 서로 싸운다

    // ── 목표 하나로 통일한다 ──────────────────────────────────
    //
    // 여기가 떨림의 뿌리였다. 집계로 나온 1·2등이 전부 같은 모양이다.
    //   도망(유지) -> 부수기  판당 1427
    //   부수기 -> 도망(유지)  판당 1426
    //
    // 도망 목표는 **위험할 때만** 쓰였다. 한 걸음 옮겨 안전해지는 순간 버려지고,
    // 그다음 규칙이 이겨서 원래 있던 위험한 쪽으로 되돌아간다. 그리고 또 도망친다.
    //
    // 도망도 목표의 한 종류로 넣는다. **도착할 때까지는 아무도 못 뺏는다.**
    // 목표를 세우는 곳은 여럿이어도 좋지만, 목표를 들고 가는 곳은 하나여야 한다
    if (g_goal_ttl[slot] > 0 && g_goal_x[slot] >= 0) {
        --g_goal_ttl[slot];

        int gx = g_goal_x[slot], gy = g_goal_y[slot];
        const bool fleeing = (g_goal_why[slot] == R_FLEE_KEEP);

        bool drop = (gx == tx && gy == ty)          // 도착했다
                 || !Passable(gx, gy)               // 막혔다
                 || g_soon[gy][gx];                 // 목표가 곧 터진다

        // 아이템을 주우러 가는 중이었는데 남이 먼저 먹었으면 그만둔다
        if (g_goal_why[slot] == R_ITEM && g_game.item[gy][gx] == ITEM_NONE) drop = true;

        // 도망이 아닌 목표는 발밑이 위험해지면 버린다. 목숨이 먼저다
        if (!fleeing && g_danger[ty][tx]) drop = true;

        if (!drop && StepToward(tx, ty, gx, gy, &dx, &dy)) {
            p.dir_x = dx; p.dir_y = dy;
            g_reason[slot] = fleeing ? R_FLEE_KEEP : g_goal_why[slot];
            return;
        }

        // 도착해서 푸는 것과 막혀서 푸는 것은 다르다.
        // 도착했으면 그 자리에서 할 일이 있다. 잠깐 머문다
        if (gx == tx && gy == ty) g_settle[slot] = HoldTicks(p) * 2;
        ClearGoal(slot);
    }

    // 1) 위험하면 도망 목표를 세운다.
    //    갈 수 있는 거리 안에서만 고른다. 10칸짜리 목표를 잡아놓고
    //    네 칸밖에 못 가면 도중에 터진다
    if (g_danger[ty][tx]) {
        int flee_reach = EscapeReach(p);
        int gx = -1, gy = -1;

        // 위험을 안 밟고 가는 길을 **먼저** 찾는다.
        //
        // 한 번에 allow_danger 로 찾으면 곧 터질 칸을 밟고 도는 길이 뽑힐 수 있다.
        // 그 길이 길면 도중에 터진다. 그래서 두 번 찾는다.
        // 깨끗한 길이 없을 때만 위험을 밟는다. 그때는 밟고서라도 나가야 한다
        bool found = FindStep(tx, ty, Goal::Safe, flee_reach, &dx, &dy,
                              -1, nullptr, false, false, &gx, &gy);
        if (!found) {
            found = FindStep(tx, ty, Goal::Safe, flee_reach, &dx, &dy,
                             -1, nullptr, false, true, &gx, &gy);
        }

        if (found) {
            SetGoal(slot, p, gx, gy, R_FLEE_KEEP);
            p.dir_x = dx; p.dir_y = dy;
            g_reason[slot] = R_FLEE_NEW;
            return;
        }
        g_reason[slot] = R_FLEE_STUCK;   // 위험한데 갈 데가 없다. 아래 규칙으로 내려간다
    }
    // 2) 잠긴 구역이면 가운데로
    if (IsUnderWater(tx, ty)) {
        if (FindStep(tx, ty, Goal::Center, 20, &dx, &dy)) {
            p.dir_x = dx; p.dir_y = dy;
            g_reason[slot] = R_WATER;
            return;
        }
    }

    int range = BLAST_BASE_RANGE + p.power_lv;

    // 2.5) 갇힌 적이 가까이 있으면 마무리하러 간다.
    //      물줄기로는 못 죽인다. 몸으로 가야 한다
    if (p.trap_ticks == 0 && FindStep(tx, ty, Goal::Prey, 12, &dx, &dy, slot)) {
        p.dir_x = dx; p.dir_y = dy;
        g_reason[slot] = R_PREY;
        return;
    }

    // 3) 사거리 안에 적이 있으면 놓는다. 이게 없으면 아무도 안 죽어서 판이 안 끝난다
    int enemy_dist = 0;
    int reach = EscapeReach(p);
    int gx = -1, gy = -1;

    bool enemy_near = FindStep(tx, ty, Goal::Enemy, range, &dx, &dy, slot, &enemy_dist);
    if (enemy_near && SafeToPlace(tx, ty, range, reach, &gx, &gy)) {
        if (PlaceBubble(slot)) {
            FleeTo(slot, p, tx, ty, gx, gy);
            g_reason[slot] = R_PLACE_ENEMY;
            return;
        }
    }

    // 4) 아이템. 보통 길로 못 가면 상자를 밀어서라도 간다.
    //
    //    밀기를 여기 붙인 이유. 사람이 상자를 미는 건 그게 길을 막고 있을 때다.
    //    아이템은 봇이 굳이 가려는 유일한 목표라 '막혔다' 가 성립하는 자리다.
    //    도망칠 때는 안 켠다. 미는 데 쉬는 시간이 붙어서 그동안 맞는다
    int gx2 = -1, gy2 = -1;
    if (FindStep(tx, ty, Goal::Item, 8, &dx, &dy, -1, nullptr, false, false, &gx2, &gy2)) {
        p.dir_x = dx; p.dir_y = dy;
        g_reason[slot] = R_ITEM;
        SetGoal(slot, p, gx2, gy2, R_ITEM);
        return;
    }
    if (FindStep(tx, ty, Goal::Item, 8, &dx, &dy, -1, nullptr, true)) {
        p.dir_x = dx; p.dir_y = dy;
        g_reason[slot] = R_ITEM_PUSH;
        return;
    }

    // 5) 블록 옆이면 놓는다
    bool near_block = false;
    for (int d = 0; d < 4; ++d) {
        if (g_game.map.IsBlock(tx + DX[d], ty + DY[d])) near_block = true;
    }
    if (near_block && SafeToPlace(tx, ty, range, reach, &gx, &gy)) {
        if (PlaceBubble(slot)) {
            FleeTo(slot, p, tx, ty, gx, gy);
            g_reason[slot] = R_PLACE_BLOCK;
            return;
        }
    }

    // 6) 적을 찾아 나선다. 사람은 숨어만 있지 않는다
    // 목표에 막 도착했으면 새 목표를 고르지 않는다. 여기서 떨었다
    if (g_settle[slot] > 0) {
        --g_settle[slot];
        g_reason[slot] = R_IDLE;
        p.dir_x = 0; p.dir_y = 0;
        return;
    }

    if (FindStep(tx, ty, Goal::Enemy, 18, &dx, &dy, slot, nullptr, false, false, &gx2, &gy2)) {
        p.dir_x = dx; p.dir_y = dy;
        g_reason[slot] = R_HUNT;
        SetGoal(slot, p, gx2, gy2, R_HUNT);
        return;
    }

    // 7) 부술 게 있는 쪽으로
    if (FindStep(tx, ty, Goal::Block, 14, &dx, &dy, -1, nullptr, false, false, &gx2, &gy2)) {
        p.dir_x = dx; p.dir_y = dy;
        g_reason[slot] = R_BLOCK;
        SetGoal(slot, p, gx2, gy2, R_BLOCK);
        return;
    }

    if (FindStep(tx, ty, Goal::Center, 20, &dx, &dy)) {
        p.dir_x = dx; p.dir_y = dy;
        g_reason[slot] = R_CENTER;
        return;
    }

    // 여기까지 왔으면 갈 데를 하나도 못 찾은 것이다. 사방이 위험으로 막혔다.
    //
    // 한 번은 여기서 '위험을 밟더라도 움직이자' 로 고쳤다가 되돌렸다.
    // 방향 뒤집기가 2682 에서 4735 로 **늘었다.** 위험 쪽으로 갔다가 도망 나오고,
    // 안전해지면 또 가는 진동이 그대로 되살아났다.
    //
    // 서 있는 게 맞다. 발밑이 안전하고 사방이 곧 터질 참이면 사람도 안 움직인다.
    // 되감기에서 59틱(2초) 서 있던 것도 그동안 안 죽었다.
    // 보기에 답답한 것과 틀린 것은 다르다
    g_reason[slot] = R_IDLE;
    p.dir_x = 0; p.dir_y = 0;
}

// ── 한 틱 ────────────────────────────────────────────────────
//
// 위험 지도와 사람 지도를 한 번 만들고, 봇마다 방향을 정한다.
// 지도를 봇마다 다시 만들면 24번 만들게 된다. 한 번이면 된다
inline void BotThinkAll()
{
    if (g_game.phase != ROUND_PLAYING) {
        return;
    }

    // 놓인 물풍선은 언제 터지든 위험한 걸로 본다.
    // 사람도 남의 폭탄 옆에 서 있지 않는다
    BuildDangerMap(BUBBLE_FUSE_TICKS + 1);
    BuildEnemyMap();

    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].is_bot) {
            ThinkBot(i);
        }
    }
}
