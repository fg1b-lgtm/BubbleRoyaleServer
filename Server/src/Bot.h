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

// 지금 물줄기가 있거나 곧 터질 물풍선의 십자에 걸리는 칸
inline bool g_danger[MAP_H][MAP_W];

inline void BuildDangerMap(int lookahead)
{
    memset(g_danger, 0, sizeof(g_danger));

    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (g_game.blast[y][x] > 0) g_danger[y][x] = true;
        }
    }

    for (int i = 0; i < MAX_BUBBLE; ++i) {
        const Bubble& b = g_game.bubbles[i];
        if (!b.used || b.fuse > lookahead) continue;

        g_danger[b.ty][b.tx] = true;
        for (int d = 0; d < 4; ++d) {
            for (int step = 1; step <= b.range; ++step) {
                int x = b.tx + DX[d] * step;
                int y = b.ty + DY[d] * step;
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) break;

                uint8_t t = g_game.map.tile[y][x];
                if (t == TILE_WALL) break;
                g_danger[y][x] = true;
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

inline bool FindStep(int sx, int sy, Goal goal, int max_steps, int* out_dx, int* out_dy,
                     int me = -1, int* found_dist = nullptr, bool allow_push = false)
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
inline bool SafeToPlace(int tx, int ty, int range)
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
    bool ok = FindStep(tx, ty, Goal::Safe, 8, &dx, &dy);

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

inline void ClearFleeTargets()
{
    for (int i = 0; i < PLAYER_MAX; ++i) { g_flee_x[i] = -1; g_flee_y[i] = -1; }
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

inline void ThinkBot(int slot)
{
    Player& p = g_game.players[slot];
    if (!p.alive) return;

    int tx = p.judge_tx, ty = p.judge_ty;
    int dx = 0, dy = 0;

    // 1) 위험하면 무조건 도망.
    //    한번 정한 목표가 아직 안전하면 그대로 밀고 간다
    if (g_danger[ty][tx]) {
        int fx = g_flee_x[slot], fy = g_flee_y[slot];

        bool keep = (fx >= 0) && !g_danger[fy][fx] && !(fx == tx && fy == ty);
        if (keep && StepToward(tx, ty, fx, fy, &dx, &dy)) {
            p.dir_x = dx; p.dir_y = dy;
            return;
        }

        if (FindStep(tx, ty, Goal::Safe, 10, &dx, &dy)) {
            // 목표를 기억해 둔다. 다음 틱에도 같은 데로 간다
            int gx = tx, gy = ty;
            FindStep(tx, ty, Goal::Safe, 10, &dx, &dy);
            // 첫 걸음 방향으로 안전한 칸을 다시 찾아 기억
            for (int r = 1; r <= 10; ++r) {
                int nx = tx + dx * r, ny = ty + dy * r;
                if (!Passable(nx, ny)) break;
                if (!g_danger[ny][nx]) { gx = nx; gy = ny; break; }
            }
            g_flee_x[slot] = gx; g_flee_y[slot] = gy;

            p.dir_x = dx; p.dir_y = dy;
            return;
        }
    }
    else {
        g_flee_x[slot] = -1;
    }

    // 2) 잠긴 구역이면 가운데로
    if (IsUnderWater(tx, ty)) {
        if (FindStep(tx, ty, Goal::Center, 20, &dx, &dy)) {
            p.dir_x = dx; p.dir_y = dy;
            return;
        }
    }

    int range = BLAST_BASE_RANGE + p.power_lv;

    // 2.5) 갇힌 적이 가까이 있으면 마무리하러 간다.
    //      물줄기로는 못 죽인다. 몸으로 가야 한다
    if (p.trap_ticks == 0 && FindStep(tx, ty, Goal::Prey, 12, &dx, &dy, slot)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

    // 3) 사거리 안에 적이 있으면 놓는다. 이게 없으면 아무도 안 죽어서 판이 안 끝난다
    int enemy_dist = 0;
    bool enemy_near = FindStep(tx, ty, Goal::Enemy, range, &dx, &dy, slot, &enemy_dist);
    if (enemy_near && SafeToPlace(tx, ty, range)) {
        if (PlaceBubble(slot)) {
            p.dir_x = 0; p.dir_y = 0;
            return;
        }
    }

    // 4) 아이템. 보통 길로 못 가면 상자를 밀어서라도 간다.
    //
    //    밀기를 여기 붙인 이유. 사람이 상자를 미는 건 그게 길을 막고 있을 때다.
    //    아이템은 봇이 굳이 가려는 유일한 목표라 '막혔다' 가 성립하는 자리다.
    //    도망칠 때는 안 켠다. 미는 데 쉬는 시간이 붙어서 그동안 맞는다
    if (FindStep(tx, ty, Goal::Item, 8, &dx, &dy)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }
    if (FindStep(tx, ty, Goal::Item, 8, &dx, &dy, -1, nullptr, true)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

    // 5) 블록 옆이면 놓는다
    bool near_block = false;
    for (int d = 0; d < 4; ++d) {
        if (g_game.map.IsBlock(tx + DX[d], ty + DY[d])) near_block = true;
    }
    if (near_block && SafeToPlace(tx, ty, range)) {
        if (PlaceBubble(slot)) {
            p.dir_x = 0; p.dir_y = 0;
            return;
        }
    }

    // 6) 적을 찾아 나선다. 사람은 숨어만 있지 않는다
    if (FindStep(tx, ty, Goal::Enemy, 18, &dx, &dy, slot)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

    // 7) 부술 게 있는 쪽으로
    if (FindStep(tx, ty, Goal::Block, 14, &dx, &dy)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

    if (FindStep(tx, ty, Goal::Center, 20, &dx, &dy)) {
        p.dir_x = dx; p.dir_y = dy;
        return;
    }

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
