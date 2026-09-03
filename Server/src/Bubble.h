// Server/src/Bubble.h — 물풍선, 폭발, 연쇄, 아이템, 피격
//
// 소유 스레드 : tick
//
// 이 파일은 소켓을 모른다. 일어난 일은 g_game.events 에 쌓아두기만 한다.
// 그래야 서버를 안 켜고도 규칙만 따로 돌려볼 수 있다.
//
// 연쇄를 재귀로 안 푼다.
//   SPEC 2.4 에는 재귀 + 방문 표시라고 적어뒀는데, 그렇게 하면 연쇄가 한 틱에 다 터진다.
//   그러면 큰 폭발 하나로 보여서 연쇄인 줄 모른다 (SPEC 2.7 의 2위 리턴이 통째로 사라진다).
//   대신 폭발이 다른 물풍선에 닿으면 그 물풍선의 퓨즈를 CHAIN_STEP_TICKS 로 줄인다.
//   그러면 다음다음 틱에 저절로 터진다. 재귀도 방문 표시도 필요 없어지고
//   무한루프도 원천적으로 안 생긴다. 번져나가는 게 눈에 보이는 건 덤이다.
#pragma once

#include "Game.h"

// 블록에서 아이템이 나올 확률. 기본은 상수 그대로다.
//
// 소유 스레드 : tick (서버는 아예 안 바꾼다)
// roundsim 만 시작할 때 한 번 덮어쓴다
inline int g_drop_percent = ITEM_DROP_PERCENT;


// 이 사람이 지금 놓아둔 물풍선 수
inline int CountBubbles(int owner)
{
    int n = 0;
    for (int i = 0; i < MAX_BUBBLE; ++i) {
        if (g_game.bubbles[i].used && g_game.bubbles[i].owner == owner) {
            ++n;
        }
    }
    return n;
}

// 물풍선을 놓는다. 놓았으면 true
//
// 놓는 자리는 위치가 아니라 판정 타일이다.
// 걸쳐 있을 때 몸이 있는 칸에 놓으면, 본인은 옛 칸에 있다고 판정받는데
// 풍선은 새 칸에 생긴다. 그 어긋남이 손맛을 망친다
inline bool PlaceBubble(int slot)
{
    if (g_game.phase != ROUND_PLAYING) {
        return false;   // 카운트다운 중이거나 판이 끝났다
    }

    Player& p = g_game.players[slot];

    if (!p.alive || p.trap_ticks > 0) {
        return false;
    }

    int tx = p.judge_tx;
    int ty = p.judge_ty;

    if (g_game.map.tile[ty][tx] != TILE_EMPTY) {
        return false;   // 이미 뭔가 있다. 물풍선도 벽이다
    }

    if (CountBubbles(slot) >= BUBBLE_BASE_COUNT + p.bubble_lv) {
        return false;
    }

    for (int i = 0; i < MAX_BUBBLE; ++i) {
        Bubble& b = g_game.bubbles[i];
        if (b.used) {
            continue;
        }

        b.used  = true;
        b.owner = slot;
        b.tx    = tx;
        b.ty    = ty;
        b.fuse  = BUBBLE_FUSE_TICKS;
        b.range = BLAST_BASE_RANGE + p.power_lv;   // 놓는 순간에 고정된다
        b.chain = 0;

        // 칸을 막는다. 놓은 사람은 나갈 수 있고 나가면 못 들어온다.
        // 예외를 따로 안 뒀는데도 그렇게 된다. 이동 판정이 가려는 칸만 보기 때문이다
        g_game.map.tile[ty][tx] = TILE_BUBBLE;

        PushEvent(EVT_BUBBLE, tx, ty, slot, b.range);
        return true;
    }

    return false;   // 판에 물풍선이 꽉 찼다. 있을 수 없지만 배열이니 확인한다
}

// 한 칸을 물줄기로 덮는다
inline void SetBlast(int tx, int ty, int owner, uint16_t gen)
{
    g_game.blast[ty][tx]       = BLAST_DURATION_TICKS;
    g_game.blast_gen[ty][tx]   = gen;
    g_game.blast_owner[ty][tx] = (int8_t)owner;

    // 바닥에 있던 아이템은 물줄기에 쓸려간다.
    //
    // 이게 없으면 아이템이 깔린 자리가 안전한 창고가 된다. 물풍선을 놓아도
    // 잃을 게 없으니 아무나 먼저 터뜨리고 천천히 주우면 그만이다. 쓸려가게
    // 하면 남의 아이템을 없애는 것도 한 수가 되고, 내 아이템 위에서 싸울 때는
    // 어디에 놓을지를 한 번 더 생각하게 된다.
    //
    // 블록을 부숴서 나오는 아이템은 이 뒤에 놓이므로 안 쓸려간다.
    // 부순 보상이 부순 물줄기에 사라지면 블록을 부술 이유가 없다
    if (g_game.item[ty][tx] != ITEM_NONE) {
        g_game.item[ty][tx] = ITEM_NONE;
        PushEvent(EVT_ITEM_GONE, tx, ty, 0xFF, 0);
    }

    PushEvent(EVT_BLAST, tx, ty, owner, 0);
}

// 블록을 부순다. 확률로 아이템이 나온다
inline void BreakBlock(int tx, int ty)
{
    g_game.map.tile[ty][tx] = TILE_EMPTY;
    PushEvent(EVT_BLOCK, tx, ty, 0xFF, 0);

    // 밸런스를 쓸어보려고 시뮬레이터에서만 이 값을 바꾼다.
    // 서버는 g_drop_percent 를 안 건드리므로 늘 ITEM_DROP_PERCENT 그대로다.
    // 상수를 고쳐 다시 빌드하는 대신 인자로 스무 판씩 돌려보려는 것이다
    if (g_game.drop_rnd.Next(100) >= g_drop_percent) {
        return;
    }

    // 벽에서 나오는 건 수치형 셋뿐이다.
    // 특수 아이템은 킬 드롭과 중앙에서만 나온다. 그 한 줄이 밸런스의 척추다 (SPEC 2.5)
    // 대쉬는 여기 없다. 벽에서 나오면 한 판에 백 개 넘게 나오고,
    // 그러면 전원이 갖게 되어 **누가 갖고 있나** 가 판단거리가 아니게 된다
    static const uint8_t kinds[3] = { ITEM_BUBBLE, ITEM_POWER, ITEM_ROLLER };
    g_game.item[ty][tx] = kinds[g_game.drop_rnd.Next(3)];

    PushEvent(EVT_DROP, tx, ty, 0xFF, g_game.item[ty][tx]);
}

// 물풍선 하나를 터뜨린다
inline void Explode(int index)
{
    Bubble& b = g_game.bubbles[index];
    if (!b.used) {
        return;
    }

    uint16_t gen = g_game.next_gen++;
    if (g_game.next_gen == 0) {
        g_game.next_gen = 1;   // 0 은 "폭발 없음" 이라 건너뛴다
    }

    b.used = false;
    g_game.map.tile[b.ty][b.tx] = TILE_EMPTY;   // 칸을 다시 연다

    if (b.chain > 0) {
        PushEvent(EVT_CHAIN, b.tx, b.ty, b.owner, b.chain);
    }

    SetBlast(b.tx, b.ty, b.owner, gen);

    // 네 방향으로 뻗는다
    static const int DX[4] = {  1, -1,  0,  0 };
    static const int DY[4] = {  0,  0,  1, -1 };

    for (int d = 0; d < 4; ++d) {
        for (int step = 1; step <= b.range; ++step) {
            int x = b.tx + DX[d] * step;
            int y = b.ty + DY[d] * step;

            if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) {
                break;
            }

            uint8_t t = g_game.map.tile[y][x];

            if (t == TILE_WALL) {
                break;   // 고정 벽에서 멈춘다. 그 칸은 안 덮는다
            }

            if (IsBreakableTile(t)) {
                // **물줄기를 먼저 깔고 그다음에 부순다.**
                //
                // 순서가 뒤바뀌어 있었다. SetBlast 가 그 칸의 아이템을 쓸어가게
                // 만든 순간, 부숴서 나온 아이템이 같은 물줄기에 바로 사라졌다.
                // 부순 보상이 부순 물줄기에 없어지면 블록을 부술 이유가 없다.
                //
                // 쓸려가야 하는 건 **이미 바닥에 있던** 아이템이지 방금 나온 것이 아니다
                SetBlast(x, y, b.owner, gen);
                BreakBlock(x, y);
                break;   // 블록을 부수고 거기서 멈춘다
            }

            if (t == TILE_BUBBLE) {
                // 남의 물풍선에 닿았다. 지금 터뜨리지 않고 퓨즈만 줄인다.
                // 몇 틱 뒤에 저절로 터져서 연쇄가 번져 보인다
                for (int i = 0; i < MAX_BUBBLE; ++i) {
                    Bubble& o = g_game.bubbles[i];
                    if (o.used && o.tx == x && o.ty == y) {
                        // 아직 연쇄로 안 걸린 것만 건드린다.
                        //
                        // 남은 퓨즈가 이미 더 짧아도 CHAIN_STEP_TICKS 로 늘린다.
                        // 같이 놓은 둘은 원래 같은 틱에 터지는데, 그러면 큰 폭발 하나로 보인다.
                        // 늦춰야 계단식으로 번지는 게 보인다. 그게 이걸 만든 이유다
                        if (o.chain == 0) {
                            o.fuse  = CHAIN_STEP_TICKS;
                            o.chain = b.chain + 1;
                        }
                        break;
                    }
                }
                SetBlast(x, y, b.owner, gen);
                break;   // 물풍선도 물줄기를 막는다. 그래서 풍선이 방패가 된다
            }

            SetBlast(x, y, b.owner, gen);
        }
    }
}

// 퓨즈를 줄이고 다 된 것을 터뜨린다.
//
// 두 번에 나눠 도는 이유가 있다.
//   한 번에 돌면서 터뜨리면, 그 폭발이 다른 물풍선의 퓨즈를 CHAIN_STEP_TICKS 로 바꾼다.
//   그 물풍선이 배열에서 뒤에 있으면 이번 틱에 한 번 더 깎이고, 앞에 있으면 안 깎인다.
//   같은 상황인데 연쇄 간격이 2틱이 되기도 3틱이 되기도 한다.
//   보이는 것도 다르고 설명도 못 한다. 그래서 줄이는 것과 터뜨리는 것을 갈라놨다.
inline void UpdateBubbles()
{
    // 1) 전부 하나씩 줄인다
    for (int i = 0; i < MAX_BUBBLE; ++i) {
        if (g_game.bubbles[i].used) {
            --g_game.bubbles[i].fuse;
        }
    }

    // 2) 그다음 다 된 것을 터뜨린다.
    //    여기서 새로 걸린 연쇄는 퓨즈가 CHAIN_STEP_TICKS 라 이번 틱에 안 터진다
    for (int i = 0; i < MAX_BUBBLE; ++i) {
        if (g_game.bubbles[i].used && g_game.bubbles[i].fuse <= 0) {
            Explode(i);
        }
    }
}

// 발밑에 아이템이 있으면 줍는다.
// 판정 타일이 아니라 몸이 있는 타일로 본다. 줍는 건 후하게 해도 억울하지 않다
inline void PickUpItems()
{
    for (int i = 0; i < PLAYER_MAX; ++i) {
        Player& p = g_game.players[i];
        if (!Occupied(p) || !p.alive) {
            continue;
        }

        int tx = p.px / TILE_UNITS;
        int ty = p.py / TILE_UNITS;

        uint8_t kind = g_game.item[ty][tx];
        if (kind == ITEM_NONE) {
            continue;
        }

        g_game.item[ty][tx] = ITEM_NONE;

        // 벽에서 나온 수치형은 상한 4 에서 멈춘다.
        // 상한 위는 킬 드롭과 최종 보급에서만 나온다
        if (kind == ITEM_BUBBLE && p.bubble_lv < STAT_CAP_FROM_WALL) ++p.bubble_lv;
        if (kind == ITEM_POWER  && p.power_lv  < STAT_CAP_FROM_WALL) ++p.power_lv;
        if (kind == ITEM_ROLLER && p.speed_lv  < STAT_CAP_SPEED)     ++p.speed_lv;

        // 울트라는 한 번에 상한 위까지 올린다. 이게 역전 장치다
        if (kind == ITEM_ULTRA) {
            p.power_lv = STAT_CAP_ULTRA;
        }

        PushEvent(EVT_ITEM, tx, ty, i, kind);
    }
}

// 아이템 하나를 이 자리 근처의 빈 칸에 떨군다. 놓을 데가 없으면 false
inline bool DropItemNear(int cx, int cy, uint8_t kind)
{
    for (int r = 0; r <= LOOT_SPREAD; ++r) {
        for (int y = cy - r; y <= cy + r; ++y) {
            for (int x = cx - r; x <= cx + r; ++x) {
                // 테두리만 훑는다. 안쪽은 이미 지난 바퀴에서 봤다
                int ax = (x - cx < 0) ? cx - x : x - cx;
                int ay = (y - cy < 0) ? cy - y : y - cy;
                if (ax != r && ay != r) {
                    continue;
                }
                if (x <= 0 || y <= 0 || x >= MAP_W - 1 || y >= MAP_H - 1) {
                    continue;
                }
                if (g_game.map.tile[y][x] != TILE_EMPTY) {
                    continue;
                }
                if (g_game.item[y][x] != ITEM_NONE) {
                    continue;
                }

                g_game.item[y][x] = kind;
                PushEvent(EVT_DROP, x, y, 0xFF, kind);
                return true;
            }
        }
    }
    return false;
}

// 죽은 사람이 가진 것의 절반을 주변에 흘린다.
//
// 이게 없으면 사람을 잡을 이유가 "하나 줄었다" 뿐이다.
// 흘리게 하면 **잡는 것이 파밍보다 확실히 낫다** 가 되고, 그래야 서로 찾아다닌다.
//
// 반올림해서 흘린다. 하나 가진 사람을 잡아도 하나는 나와야 잡을 맛이 난다.
inline void DropKillLoot(int slot)
{
    const Player& p = g_game.players[slot];

    struct { uint8_t kind; int lv; } stat[3] = {
        { ITEM_BUBBLE, p.bubble_lv },
        { ITEM_POWER,  p.power_lv  },
        { ITEM_ROLLER, p.speed_lv  },
    };

    for (int i = 0; i < 3; ++i) {
        int n = (stat[i].lv * KILL_DROP_PERCENT + 99) / 100;   // 올림
        for (int k = 0; k < n; ++k) {
            DropItemNear(p.judge_tx, p.judge_ty, stat[i].kind);
        }
    }

    // 울트라는 벽에서 절대 안 나온다. 여기와 최종 보급에서만 나온다.
    // 뒤처진 사람이 한 번에 따라잡는 유일한 길이라 역전 장치가 된다
    if (g_game.drop_rnd.Next(100) < ULTRA_DROP_PERCENT) {
        DropItemNear(p.judge_tx, p.judge_ty, ITEM_ULTRA);
    }
}

inline void KillPlayer(int slot)
{
    Player& p = g_game.players[slot];
    p.alive      = false;
    p.trap_ticks = 0;
    p.dir_x      = 0;
    p.dir_y      = 0;

    PushEvent(EVT_DEATH, p.judge_tx, p.judge_ty, slot, 0);
    DropKillLoot(slot);
}

// 물줄기에 맞았는지 본다. 걸치기가 값을 하는 곳이 여기다
inline void ResolveHits()
{
    for (int i = 0; i < PLAYER_MAX; ++i) {
        Player& p = g_game.players[i];
        if (!Occupied(p) || !p.alive) {
            continue;
        }

        bool judge_hit = g_game.blast[p.judge_ty][p.judge_tx] > 0;

        // 몸이 걸쳐 있는 칸을 전부 본다.
        // 중심은 안전한 칸에 있는데 몸 일부가 물에 닿아 있으면 걸치기다
        int x0, x1, y0, y1;
        BodySpanAxis(p.px, &x0, &x1);
        BodySpanAxis(p.py, &y0, &y1);

        bool body_hit = false;
        for (int y = y0; y <= y1 && !body_hit; ++y) {
            for (int x = x0; x <= x1; ++x) {
                if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) {
                    continue;
                }
                if (g_game.blast[y][x] > 0) { body_hit = true; break; }
            }
        }

        // 몸은 물에 닿았는데 중심은 안 닿았다. 걸치기로 피한 것이다.
        // 이 게임에서 유일하게 "내 손이 좋아서 살았다" 가 성립하는 순간이라,
        // 클라이언트가 알아서 못 만든다. 서버가 알려줘야 한다
        if (!judge_hit && body_hit) {
            if (!p.grazing) {
                // 연속으로 걸치면 숫자가 올라간다. 보상은 숫자 그 자체다
                ++p.graze_streak;
                p.graze_timer = GRAZE_CHAIN_TICKS;
                PushEvent(EVT_GRAZE, p.judge_tx, p.judge_ty, i, p.graze_streak);
            }
            p.grazing = true;
            continue;
        }
        p.grazing = false;

        if (!judge_hit) {
            continue;
        }

        if (p.invuln_ticks > 0) {
            continue;   // 빠져나온 직후다. 남은 물줄기에 다시 맞으면 억울하다
        }

        if (p.trap_ticks > 0) {
            // 이미 갇혀 있다. 물줄기로는 더 어쩌지 못한다.
            // 터뜨리려면 누가 몸으로 부딪쳐야 한다. 크아가 그렇다
            continue;
        }

        p.trap_ticks   = TRAP_DURATION_TICKS;
        p.graze_streak = 0;   // 맞았으면 연속은 거기서 끝이다
        p.graze_timer  = 0;
        p.dir_x        = 0;
        p.dir_y        = 0;
        PushEvent(EVT_TRAP, p.judge_tx, p.judge_ty, i, 0);
    }
}

// 갇힌 사람에게 몸으로 부딪치면 터진다.
//
// 이게 이 게임에서 마무리를 하는 유일한 방법이다.
// 물줄기로 안 되고 거리를 좁혀야 하므로, 마무리하러 가는 것 자체가 위험을 진다.
// 그래서 SPEC 2.7 이 말한 "잡으러 갈까" 가 진짜 판단거리가 된다.
//
// 갇힌 쪽도 기어서 도망칠 수 있으니 (TRAP_MOVE_SPEED) 쫓고 쫓기는 5초가 된다.
inline void PopTrappedPlayers()
{
    for (int i = 0; i < PLAYER_MAX; ++i) {
        Player& v = g_game.players[i];
        if (!Occupied(v) || !v.alive || v.trap_ticks <= 0) {
            continue;
        }

        for (int j = 0; j < PLAYER_MAX; ++j) {
            if (i == j) {
                continue;
            }

            Player& a = g_game.players[j];
            // 갇힌 사람끼리는 서로 못 터뜨린다
            if (!Occupied(a) || !a.alive || a.trap_ticks > 0) {
                continue;
            }

            int dx = a.px - v.px; if (dx < 0) dx = -dx;
            int dy = a.py - v.py; if (dy < 0) dy = -dy;
            if (dx >= POP_TOUCH_DIST || dy >= POP_TOUCH_DIST) {
                continue;
            }

            PushEvent(EVT_POP, v.judge_tx, v.judge_ty, i, j);
            KillPlayer(i);
            break;
        }
    }
}

// 갇힘과 무적 시간을 줄인다
inline void UpdateTimers()
{
    for (int i = 0; i < PLAYER_MAX; ++i) {
        Player& p = g_game.players[i];
        if (!Occupied(p) || !p.alive) {
            continue;
        }

        if (p.trap_ticks > 0) {
            --p.trap_ticks;
            if (p.trap_ticks == 0) {
                // 5초를 버텼다. 스스로 빠져나온다
                p.invuln_ticks = INVULN_TICKS;
                PushEvent(EVT_BREAK, p.judge_tx, p.judge_ty, i, 0);
            }
        }

        if (p.invuln_ticks > 0) {
            --p.invuln_ticks;
        }

        // 한동안 안 걸치면 연속이 끊긴다
        if (p.graze_timer > 0) {
            --p.graze_timer;
            if (p.graze_timer == 0) {
                p.graze_streak = 0;
            }
        }
    }
}

// 물줄기를 한 틱 삭힌다
inline void FadeBlasts()
{
    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (g_game.blast[y][x] > 0) {
                --g_game.blast[y][x];
            }
        }
    }
}
