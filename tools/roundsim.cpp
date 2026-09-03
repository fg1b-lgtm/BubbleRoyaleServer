// tools/roundsim.cpp — 봇 24명으로 한 판을 통째로 돌려본다
//
// SPEC 이 "봇 100판으로 밸런스 검증" 이라고 적어둔 그 도구다.
// 화면도 소켓도 없이 게임 규칙만 최고 속도로 돌린다. 한 판이 눈 깜짝할 사이에 끝난다.
//
// 무엇을 알고 싶은가
//   ① 판이 끝나기는 하나. 몇 분에 끝나나
//   ② 누가 죽이나. 물풍선인가 물인가.
//      물이 대부분을 죽이면 그건 배틀로얄이 아니라 의자앉기 게임이다
//   ③ 압박 곡선. 살아 있는 사람 한 명당 몇 칸인가.
//      이 숫자가 안 줄면 판이 안 좁혀지는 것이다
//   ④ 아이템이 몇 개씩 돌아가나
//
// 컴파일: practice 폴더에서  build.bat ..\tools\roundsim.cpp
// 실행  : practice\bin\roundsim.exe [판수]
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include "../Server/src/Bot.h"

// 봇 두뇌는 Server/src/Bot.h 에 있다.
//
// 원래 이 파일 안에 있었는데 9/1 에 꺼냈다. 서버가 같은 두뇌를 그대로 쓴다.
// 두 벌을 두면 밸런스를 잰 판과 실제로 도는 판이 달라져서,
// 여기서 나온 "평균 3분" 이 다른 게임 얘기가 된다.
// ── 한 판 ────────────────────────────────────────────────────
struct RoundResult
{
    int  ticks;
    int  alive_end;
    int  by_bubble;
    int  by_water;
    int  by_self;      // 자기가 놓은 물풍선에 죽은 수
    int  first_kill_tick;
    int  alive_at[8];        // 30초마다 살아 있는 수
    int  tiles_per_head[8];  // 30초마다 한 명당 안 잠긴 칸 수
    int  item_sum;
    int  winner_items;   // 승자가 들고 끝낸 아이템 수. 스노볼 지표다
    int  blocks_broken;
    int  boxes_pushed;   // 상자를 민 횟수. 0 이면 그 기능은 판에 없는 것이다
    int  items_at[8];    // 30초마다 살아 있는 사람의 평균 아이템 수 (10배)
    int  cap_tick;       // 누군가 처음 상한을 다 채운 틱. 그 뒤로는 성장이 없다

    // 관전하면 눈에 걸리는 두 가지를 센다. '이상해 보인다' 를 숫자로 바꾼 것이다
    int  self_deaths;    // 자기가 놓은 물풍선에 죽은 수
    int  flips;          // 방향을 한 틱 만에 정반대로 뒤집은 횟수 (덜덜 떤다)
    int  wet_flips;      // 그중 물가 한 칸 안에서 일어난 것

    // 침수 몇 단계까지 갔나. 안 걸리는 단계는 만들어놓고 안 쓰는 것이다
    int  flood_reached;

    // **갇힌 순간**을 뜯어본다. 죽은 순간이 아니라 갇힌 순간이어야 한다 —
    // 물줄기는 0.5초 남아 있다가 사라지므로, 죽을 때쯤엔 범인이 이미 없다.
    //
    // trap_age 는 그 칸의 물줄기가 **몇 틱째**였나다.
    //  1  터지는 그 틱에 거기 있었다  -> 못 피한 것. 있을 수 있는 일이다
    //  2+ 이미 깔려 있는 물줄기에 **걸어 들어갔다** -> 지속을 모르는 것이다
    int  trapped_total;
    int  trapped_walked_in;   // 3틱째 이후에 갇힌 수 = 진짜로 걸어 들어간 것
    int  trapped_own;         // 그중 자기가 놓은 것
    int  trap_age_sum;
    int  trapped_same_tile;   // 서 있던 칸 그대로 갇혔다 (걸치기가 풀린 것)
    int  trapped_grazing;     // 갇히기 직전 틱에 걸치는 중이었다
    int  trap_reason[16];     // 갇힐 때 어느 규칙으로 움직이고 있었나
};

// ── 조각별 계측 (레벨 디자인용) ─────────────────────────────
//
// 조각을 열 개 그려놓고 **조각별로 재본 적이 없었다.**
// 그림이 다른 것과 플레이가 다른 것은 다른 얘기다.
// 열 개가 전부 똑같이 플레이되면 그건 한 개짜리 맵에 페인트를 열 번 칠한 것이다.
//
// 판마다 아홉 개가 뽑히고 좌우/상하로 뒤집히므로, 등장 횟수로 나눠서 본다.
// 체류(사람이 그 조각 위에 있던 틱)로 나누는 이유는 안 가는 조각이
// 안전해 보이는 착시를 없애기 위해서다
static long long g_piece_seen[SECTOR_TEMPLATE_COUNT];    // 등장 횟수
static long long g_piece_ticks[SECTOR_TEMPLATE_COUNT];   // 사람이 머문 틱
static long long g_piece_deaths[SECTOR_TEMPLATE_COUNT];  // 거기서 죽은 사람
static long long g_piece_broken[SECTOR_TEMPLATE_COUNT];  // 거기서 부순 블록

// 이 칸이 어느 조각인가
static int PieceAt(int x, int y)
{
    int sx = x / SECTOR_W; if (sx > SECTOR_COLS - 1) sx = SECTOR_COLS - 1;
    int sy = y / SECTOR_H; if (sy > SECTOR_ROWS - 1) sy = SECTOR_ROWS - 1;
    return g_game.map.sector_template[sy * SECTOR_COLS + sx];
}

// ── 되감기 ───────────────────────────────────────────────────
//
// '봇이 자기 물풍선에 죽는다' 를 고치려면 그 봇의 마지막 몇 초를 봐야 한다.
// 매 틱 자리·방향·이유·발밑 위험을 고리 버퍼에 남겨두고, 죽는 순간 되감아 찍는다.
//
// 숫자 하나(자살 12명)로는 왜 죽었는지 알 수 없다. 그 12명이 각자 어떻게 죽었는지
// 봐야 고칠 데가 나온다
constexpr int TRACE_LEN = 120;   // 4초

struct Step
{
    int  tick;
    int  tx, ty;
    int  dx, dy;
    uint8_t why;
    bool danger;      // 발밑이 위험한가
    bool trapped;
    int  fx, fy;      // 도망 목표
};

// 방향을 뒤집을 때 **어느 규칙에서 어느 규칙으로** 바뀌었나.
//
// 되감기 몇 개로는 대표성이 없다. 판 전체에서 어느 쌍이 몇 번인지 세야
// 어디를 고칠지 정할 수 있다. 상위 몇 개가 거의 전부를 차지한다
static long long g_flip_pair[R_COUNT][R_COUNT];

static Step   g_trace[PLAYER_MAX][TRACE_LEN];
static int    g_trace_n[PLAYER_MAX];
static bool   g_dump_on = false;
static int    g_dumped  = 0;
static int    g_dump_max = 3;

static void TraceTick(int t)
{
    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& p = g_game.players[i];
        if (!Occupied(p)) continue;

        Step& st = g_trace[i][g_trace_n[i] % TRACE_LEN];
        st.tick = t;
        st.tx = p.judge_tx; st.ty = p.judge_ty;
        st.dx = p.dir_x;    st.dy = p.dir_y;
        st.why = g_reason[i];
        st.danger = g_danger[p.judge_ty][p.judge_tx];
        st.trapped = (p.trap_ticks > 0);
        st.fx = g_flee_x[i]; st.fy = g_flee_y[i];
        ++g_trace_n[i];
    }
}

static const char* DirName(int dx, int dy)
{
    if (dx > 0) return "→";
    if (dx < 0) return "←";
    if (dy > 0) return "↓";
    if (dy < 0) return "↑";
    return "·";
}

// 죽은 봇의 마지막 TRACE_LEN 틱을 찍는다
static void DumpTrace(int slot, const char* why_dead)
{
    if (!g_dump_on || g_dumped >= g_dump_max) return;
    ++g_dumped;

    printf("\n--- p%d 되감기 (%s) ---\n", slot, why_dead);
    printf("  틱     자리      방향  이유          발밑  도망목표\n");

    int n = g_trace_n[slot];
    int from = n > TRACE_LEN ? n - TRACE_LEN : 0;

    // 마지막 90틱(3초)만. 그 앞은 죽음과 상관없다
    if (n - from > 90) from = n - 90;

    int last_why = -1, run = 0;
    for (int k = from; k < n; ++k) {
        const Step& st = g_trace[slot][k % TRACE_LEN];

        // 같은 이유가 이어지면 접어서 찍는다. 안 접으면 90줄이 다 똑같아 보인다
        if ((int)st.why == last_why && k != n - 1) { ++run; continue; }
        if (run > 0) { printf("       ... 같은 이유로 %d틱\n", run); run = 0; }
        last_why = st.why;

        printf("  %5d  (%2d,%2d)  %s   %-12s  %s   %s(%d,%d)\n",
               st.tick, st.tx, st.ty, DirName(st.dx, st.dy),
               BOT_REASON_NAME[st.why],
               st.trapped ? "갇힘" : (st.danger ? "위험" : "  "),
               st.fx >= 0 ? "" : "없음", st.fx, st.fy);
    }
}

static int OpenTilesNotFlooded()
{
    int n = 0;
    for (int y = 0; y < MAP_H; ++y) {
        for (int x = 0; x < MAP_W; ++x) {
            if (g_game.map.tile[y][x] == TILE_WALL) continue;
            if (IsUnderWater(x, y)) continue;
            ++n;
        }
    }
    return n;
}

static void PlayRound(unsigned int seed, RoundResult& r)
{
    memset(&r, 0, sizeof(r));
    r.first_kill_tick = -1;

    InitGame(seed);
    ClearFleeTargets();

    int start_blocks = 0;
    int piece_blocks0[SECTOR_TEMPLATE_COUNT] = {};
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            if (IsBreakableTile(g_game.map.tile[y][x])) {
                ++start_blocks;
                ++piece_blocks0[PieceAt(x, y)];
            }

    for (int slot = 0; slot < SECTOR_SLOTS; ++slot) {
        ++g_piece_seen[g_game.map.sector_template[slot]];
    }

    // 전부 봇으로 앉힌다. 세션을 흉내 낼 필요가 없어졌다
    for (int i = 0; i < PLAYER_MAX; ++i) {
        AddPlayer(nullptr, true);
    }

    const int MAX_TICKS = TICK_RATE * 60 * 10;   // 10분이면 무승부

    int drowning_before[PLAYER_MAX];
    bool alive_before[PLAYER_MAX];
    int  trap_before[PLAYER_MAX];
    int  jt_before[PLAYER_MAX];
    bool graze_before[PLAYER_MAX];
    int  last_dx[PLAYER_MAX] = {}, last_dy[PLAYER_MAX] = {};
    uint8_t last_why[PLAYER_MAX] = {};
    int sample = 0;

    for (int t = 1; t <= MAX_TICKS; ++t) {
        BotThinkAll();

        for (int i = 0; i < PLAYER_MAX; ++i) {
            drowning_before[i] = g_game.players[i].flood_ticks;
            alive_before[i]    = g_game.players[i].alive;
            trap_before[i]     = g_game.players[i].trap_ticks;
            jt_before[i]       = g_game.players[i].judge_ty * MAP_W
                               + g_game.players[i].judge_tx;
            graze_before[i]    = g_game.players[i].grazing;

        }

        // 되감기는 **정하고 나서, 움직이기 전에** 찍는다.
        // 움직인 뒤에 찍으면 그 틱에 쓴 방향과 그때 서 있던 칸이 어긋나서
        // 되감기를 읽을 수가 없다. 처음에 그렇게 찍었다가 한참 헤맸다
        TraceTick(t);

        g_game.event_count = 0;
        GameTick();

        // 자기 물풍선에 갇히는 건 봇이 서툴다는 뜻이다. 게임 문제와 구분해서 센다
        for (int e = 0; e < g_game.event_count; ++e) {
            const GameEvent& ev = g_game.events[e];
            if (ev.type == EVT_TRAP && g_game.blast_owner[ev.y][ev.x] == (int8_t)ev.who) {
                ++r.by_self;
                DumpTrace(ev.who, "자기 물풍선에 갇혔다");
            }
        }

        // 사람이 어느 조각 위에 서 있었나. 죽은 자리와 나눠서 봐야 한다
        for (int i = 0; i < PLAYER_MAX; ++i) {
            const Player& p = g_game.players[i];
            if (Occupied(p) && p.alive) ++g_piece_ticks[PieceAt(p.judge_tx, p.judge_ty)];
        }

        // 방향을 정반대로 뒤집었나. 사람은 이렇게 안 걷는다
        for (int i = 0; i < PLAYER_MAX; ++i) {
            const Player& q = g_game.players[i];
            if (!q.alive) continue;

            if ((q.dir_x != 0 || q.dir_y != 0)
                && q.dir_x == -last_dx[i] && q.dir_y == -last_dy[i]) {
                ++r.flips;
                ++g_flip_pair[last_why[i]][g_reason[i]];

                // 물가 한 칸 안인가. 침수 경계에서 떠는 게 제일 잘 보인다
                bool near_water = false;
                for (int d = 0; d < 4; ++d) {
                    if (IsUnderWater(q.judge_tx + DX[d], q.judge_ty + DY[d])) near_water = true;
                }
                if (near_water || IsUnderWater(q.judge_tx, q.judge_ty)) ++r.wet_flips;
            }
            if (q.dir_x != 0 || q.dir_y != 0) {
                last_dx[i] = q.dir_x; last_dy[i] = q.dir_y; last_why[i] = g_reason[i];
            }
        }

        // 갓 갇힌 사람. 물줄기가 몇 틱째였는지가 이 판의 진짜 질문이다
        for (int i = 0; i < PLAYER_MAX; ++i) {
            const Player& p = g_game.players[i];
            if (!p.alive || trap_before[i] > 0 || p.trap_ticks <= 0) continue;

            int left = g_game.blast[p.judge_ty][p.judge_tx];
            if (left <= 0) continue;                       // 물줄기 말고 다른 이유
            int age = BLAST_DURATION_TICKS - left + 1;

            ++r.trapped_total;
            r.trap_age_sum += age;
            // 1~2틱째는 터지는 순간에 휘말린 것이다. 봇은 틱 앞부분에서 방향을 정하고
            // 물줄기는 그 뒤에 깔리므로, 한 틱은 어쩔 수 없이 밀린다. 그건 게임이다.
            // 3틱째부터가 **이미 깔려 있는 물에 제 발로 들어간** 것이고, 그것만 버그다
            if (age >= 3) ++r.trapped_walked_in;
            if (g_game.blast_owner[p.judge_ty][p.judge_tx] == (int8_t)i) ++r.trapped_own;
            if (jt_before[i] == p.judge_ty * MAP_W + p.judge_tx) ++r.trapped_same_tile;
            if (graze_before[i]) ++r.trapped_grazing;
            if (g_reason[i] >= 0 && g_reason[i] < 16) ++r.trap_reason[g_reason[i]];
        }

        for (int i = 0; i < PLAYER_MAX; ++i) {
            if (alive_before[i] && !g_game.players[i].alive) {
                ++g_piece_deaths[PieceAt(g_game.players[i].judge_tx,
                                         g_game.players[i].judge_ty)];
                // 죽는 길은 둘뿐이다. 물에 잠기거나, 갇힌 채로 터뜨려지거나.
                // 물줄기 자체는 사람을 못 죽인다. 가두기만 한다
                if (drowning_before[i] == 1) {
                    ++r.by_water;
                }
                else {
                    ++r.by_bubble;
                    // 나를 가둔 물줄기가 내가 놓은 것이었나
                    if (g_game.blast_owner[g_game.players[i].judge_ty]
                                          [g_game.players[i].judge_tx] == (int8_t)i) {
                        ++r.self_deaths;
                        DumpTrace(i, "자기 물풍선에 죽었다");
                    }
                }
                if (r.first_kill_tick < 0) r.first_kill_tick = t;
            }
        }

        // 30초마다 한 번씩 찍는다. 판이 실제로 도는 시간 기준이다
        // tick 이 0 인 틱(카운트다운이 막 끝난 틱)에도 나머지가 0 이라 한 번 더 찍힌다.
        // 그러면 표가 통째로 한 칸씩 밀린다
        if (g_game.phase == ROUND_PLAYING && g_game.tick > 0
            && g_game.tick % (TICK_RATE * 30) == 0 && sample < 8) {
            int alive = AliveCount();
            r.alive_at[sample] = alive;
            r.tiles_per_head[sample] = alive > 0 ? OpenTilesNotFlooded() / alive : 0;

            // 살아 있는 사람이 그 시각에 아이템을 몇 개 들고 있나.
            // 마지막 값만 보면 '승자는 만렙' 밖에 안 나온다. 언제 만렙이 됐는지가 질문이다
            int sum = 0;
            for (int i = 0; i < PLAYER_MAX; ++i) {
                const Player& q = g_game.players[i];
                if (Occupied(q) && q.alive) sum += q.bubble_lv + q.power_lv + q.speed_lv;
            }
            r.items_at[sample] = alive > 0 ? sum * 10 / alive : 0;
            ++sample;
        }

        // 처음으로 셋 다 상한을 찍은 순간. 이 뒤로는 아이템을 먹어도 아무 일이 없다
        if (r.cap_tick == 0) {
            for (int i = 0; i < PLAYER_MAX; ++i) {
                const Player& q = g_game.players[i];
                if (!Occupied(q) || !q.alive) continue;
                if (q.bubble_lv >= STAT_CAP_FROM_WALL && q.power_lv >= STAT_CAP_FROM_WALL
                    && q.speed_lv >= STAT_CAP_SPEED) {
                    r.cap_tick = (int)g_game.tick;
                    break;
                }
            }
        }

        r.ticks     = (int)g_game.tick;
        r.alive_end = AliveCount();

        // 판이 끝났다. 다음 판으로 넘어가기 전에 멈춘다
        if (g_game.phase == ROUND_OVER) {
            break;
        }
    }

    for (int i = 0; i < PLAYER_MAX; ++i) {
        const Player& p = g_game.players[i];
        int have = p.bubble_lv + p.power_lv + p.speed_lv;
        r.item_sum += have;
        if (p.alive) r.winner_items = have;
    }

    int left = 0;
    int piece_blocks1[SECTOR_TEMPLATE_COUNT] = {};
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            if (IsBreakableTile(g_game.map.tile[y][x])) {
                ++left;
                ++piece_blocks1[PieceAt(x, y)];
            }
    // 판이 끝날 때까지 침수 몇 단계가 실제로 왔나
    r.flood_reached = 0;
    for (int k = 0; k < FLOOD_STAGES; ++k) {
        if (r.ticks >= g_game.flood_fill[k]) r.flood_reached = k + 1;
    }

    r.blocks_broken = start_blocks - left;

    for (int k = 0; k < SECTOR_TEMPLATE_COUNT; ++k) {
        g_piece_broken[k] += piece_blocks0[k] - piece_blocks1[k];
    }
    r.boxes_pushed  = (int)g_push_count;
}

// 봇에게 대쉬를 준다. 이 도구는 실제 판에서 대쉬가 쓸모가 있나를 재는 데 쓴다
int main(int argc, char** argv)
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    int rounds = (argc > 1) ? atoi(argv[1]) : 20;
    if (rounds < 1) rounds = 1;

    // 두 번째 인자로 드롭 확률을 덮어쓴다. 상수를 고쳐 다시 빌드하지 않고
    // roundsim 40 20 처럼 여러 값을 연달아 돌려보라고 둔 것이다
    // roundsim 1 40 trace  -> 자살한 봇의 마지막 3초를 되감아 찍는다
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "trace") == 0) g_dump_on = true;
    }

    if (argc > 2 && strcmp(argv[2], "trace") != 0) {
        g_drop_percent = atoi(argv[2]);
        if (g_drop_percent < 0)   g_drop_percent = 0;
        if (g_drop_percent > 100) g_drop_percent = 100;
    }

    printf("=== 봇 %d명, %d판, 드롭 %d%% ===\n\n",
           PLAYER_MAX, rounds, g_drop_percent);

    long long ticks = 0, bubble = 0, water = 0, first = 0, items = 0, broken = 0;
    long long pushed = 0;
    long long capped = 0, items_at[8] = {};
    long long selfd = 0, flips = 0, wet = 0;
    long long tt = 0, tw = 0, town = 0, tage = 0, tsame = 0, tgraze = 0;
    long long treason[16] = {};
    int flood_hit[FLOOD_STAGES + 1] = {};
    int cap_rounds = 0;
    long long self_kill = 0, win_items = 0;
    long long alive_at[8] = {}, tiles_at[8] = {};
    int unfinished = 0;
    int longest = 0, shortest = 999999;

    for (int i = 0; i < rounds; ++i) {
        RoundResult r;
        PlayRound(5000u + i * 104729u, r);

        ticks  += r.ticks;
        bubble += r.by_bubble;
        water  += r.by_water;
        self_kill += r.by_self;
        items  += r.item_sum;
        win_items += r.winner_items;
        broken += r.blocks_broken;
        pushed += r.boxes_pushed;
        ++flood_hit[r.flood_reached];
        selfd += r.self_deaths;
        tt   += r.trapped_total;
        tw   += r.trapped_walked_in;
        town += r.trapped_own;
        tage += r.trap_age_sum;
        tsame  += r.trapped_same_tile;
        tgraze += r.trapped_grazing;
        for (int k = 0; k < 16; ++k) treason[k] += r.trap_reason[k];
        flips += r.flips;
        wet += r.wet_flips;
        if (r.cap_tick > 0) { capped += r.cap_tick; ++cap_rounds; }
        for (int k = 0; k < 8; ++k) items_at[k] += r.items_at[k];
        if (r.first_kill_tick > 0) first += r.first_kill_tick;
        if (r.alive_end > 1) ++unfinished;
        if (r.ticks > longest)  longest = r.ticks;
        if (r.ticks < shortest) shortest = r.ticks;

        for (int k = 0; k < 8; ++k) {
            alive_at[k] += r.alive_at[k];
            tiles_at[k] += r.tiles_per_head[k];
        }
    }

    printf("--- 판이 끝나나 ---\n");
    printf("  평균 %lld분 %lld초 (짧게 %d:%02d, 길게 %d:%02d)\n",
           ticks / rounds / TICK_RATE / 60, (ticks / rounds / TICK_RATE) % 60,
           shortest / TICK_RATE / 60, (shortest / TICK_RATE) % 60,
           longest / TICK_RATE / 60, (longest / TICK_RATE) % 60);
    printf("  10분 안에 안 끝난 판: %d / %d\n", unfinished, rounds);
    printf("  첫 사망까지: %lld초\n", first / rounds / TICK_RATE);

    printf("\n--- 누가 죽이나 ---\n");
    long long dead = bubble + water;
    printf("  터뜨려짐 %lld명 (%lld%%)   익사 %lld명 (%lld%%)\n",
           bubble / rounds, dead ? bubble * 100 / dead : 0,
           water / rounds,  dead ? water * 100 / dead : 0);
    printf("  (물줄기는 사람을 못 죽인다. 가두기만 하고, 마무리는 몸으로 한다)\n");
    printf("  자기 물풍선에 갇힌 횟수: %lld,  그러다 죽은 수: %lld\n",
           self_kill / rounds, selfd / rounds);

    // **갇힌 순간의 물줄기 나이.**
    //
    // 1틱째면 터지는 순간 거기 있었던 것이고, 그건 못 피한 것이다 — 게임이다.
    // 2틱째 이후면 이미 물이 깔려 있는 칸으로 **걸어 들어간** 것이다.
    // 물줄기가 0.5초 남아 있다는 걸 판단에 못 넣고 있다는 뜻이고, 그건 버그다
    printf("  갇힌 횟수 %lld  (터질 때 휘말림 %lld,  깔린 데로 걸어 들어감 %lld = %lld%%)\n",
           tt / rounds, (tt - tw) / rounds, tw / rounds, tt ? tw * 100 / tt : 0);

    // 갇힐 때 무슨 생각을 하고 있었나. 이게 있어야 어느 규칙을 고칠지 알 수 있다
    printf("  갇힐 때 하던 일:");
    for (int k = 0; k < 16; ++k) {
        if (treason[k] > 0) printf(" %s %lld", BOT_REASON_NAME[k], treason[k]);
    }
    printf("\n");

    // 칸을 바꾸다 갇혔나, 서 있던 자리에서 갇혔나.
    // 후자면 **걸치기로 버티다 중심이 미끄러진 것**이다. 봇은 칸 단위로만 생각하는데
    // 몸은 칸의 0.8 이고 자리는 연속이라, 물 옆 칸에 바짝 붙어 서면 한 점만 밀려도 들어간다
    printf("  그중 서 있던 칸에서 그대로 %lld,  직전에 걸치는 중이었던 %lld\n",
           tsame / rounds, tgraze / rounds);
    printf("  갇힐 때 물줄기 평균 나이 %lld틱 / %d틱  (자기 것에 갇힌 %lld)\n",
           tt ? tage / tt : 0, BLAST_DURATION_TICKS, town / rounds);
    // 관전하면 제일 먼저 눈에 걸리는 것. 봇이 제자리에서 덜덜 떠는 횟수다.
    // '이상해 보인다' 를 고칠 수 있으려면 숫자여야 한다
    printf("  방향을 한 틱 만에 뒤집은 횟수: %lld (그중 물가에서 %lld)\n",
           flips / rounds, wet / rounds);

    // 어느 규칙 쌍이 번갈아 나오나. 위에서부터 다섯 개만
    {
        struct Pair { long long n; int a, b; } top[5] = {};
        for (int a = 0; a < R_COUNT; ++a) {
            for (int b = 0; b < R_COUNT; ++b) {
                long long n = g_flip_pair[a][b];
                if (n <= top[4].n) continue;
                top[4] = { n, a, b };
                for (int k = 4; k > 0 && top[k].n > top[k - 1].n; --k) {
                    Pair t = top[k]; top[k] = top[k - 1]; top[k - 1] = t;
                }
            }
        }
        printf("  어느 규칙끼리 번갈아 나오나 (판당)\n");
        for (int k = 0; k < 5; ++k) {
            if (top[k].n == 0) break;
            printf("    %-12s -> %-12s %5lld\n",
                   BOT_REASON_NAME[top[k].a], BOT_REASON_NAME[top[k].b],
                   top[k].n / rounds);
        }
    }

    printf("\n--- 압박 곡선 (30초마다) ---\n");
    printf("  시각    생존   한 명당 칸\n");
    for (int k = 0; k < 8; ++k) {
        if (alive_at[k] == 0 && k > 0) break;
        printf("  %d:%02d   %4lld   %6lld\n",
               (k + 1) * 30 / 60, ((k + 1) * 30) % 60,
               alive_at[k] / rounds, tiles_at[k] / rounds);
    }

    printf("\n--- 침수가 실제로 오나 ---\n");
    for (int k = 0; k <= FLOOD_STAGES; ++k) {
        if (k == 0) {
            printf("  한 단계도 안 옴   %3d 판  (%d%%)\n",
                   flood_hit[0], flood_hit[0] * 100 / rounds);
        }
        else {
            printf("  %d단계까지        %3d 판  (%d%%)   %d:%02d 에 잠긴다\n",
                   k, flood_hit[k], flood_hit[k] * 100 / rounds,
                   FLOOD_FILL_TICKS[k - 1] / TICK_RATE / 60,
                   (FLOOD_FILL_TICKS[k - 1] / TICK_RATE) % 60);
        }
    }
    printf("  (0%% 인 단계는 만들어놓고 한 번도 안 쓰는 것이다)\n");

    printf("\n--- 성장이 언제 멈추나 ---\n");
    printf("  시각    살아 있는 사람의 평균 아이템\n");
    for (int k = 0; k < 8; ++k) {
        if (alive_at[k] == 0 && k > 0) break;
        printf("  %d:%02d      %2lld.%lld / %d\n",
               (k + 1) * 30 / 60, ((k + 1) * 30) % 60,
               items_at[k] / rounds / 10, (items_at[k] / rounds) % 10,
               STAT_CAP_FROM_WALL * 2 + STAT_CAP_SPEED);
    }
    if (cap_rounds > 0) {
        printf("  %d / %d 판에서 누군가 상한을 다 채웠다. 평균 %lld:%02lld\n",
               cap_rounds, rounds,
               capped / cap_rounds / TICK_RATE / 60, (capped / cap_rounds / TICK_RATE) % 60);
        printf("  (그 뒤로 그 사람은 아이템을 먹어도 아무 일이 없다)\n");
    }
    else {
        printf("  상한을 다 채운 사람이 한 판도 없었다\n");
    }

    printf("\n--- 판 서른 개가 서로 다르게 플레이되나 ---\n");

    long long tick_sum = 0, death_sum = 0;
    for (int k = 0; k < SECTOR_TEMPLATE_COUNT; ++k) {
        tick_sum  += g_piece_ticks[k];
        death_sum += g_piece_deaths[k];
    }

    // 사망을 그냥 세면 조각당 판별력이 없다. 한 판에 스물세 명이 죽는데
    // 사람이 머문 틱은 13만이라 나누면 전부 0 으로 눌린다.
    // **몫으로 본다.** 체류 몫보다 사망 몫이 크면 거기서 더 죽는 조각이다.
    // 위험지수 100 이 평균, 130 이면 머문 시간에 비해 3할 더 죽는다
    printf("  이름         등장  체류%%  사망%%  위험지수  부순블록/등장\n");

    for (int k = 0; k < SECTOR_TEMPLATE_COUNT; ++k) {
        long long seen = g_piece_seen[k];
        if (seen == 0) continue;

        long long t_share = tick_sum  ? g_piece_ticks[k]  * 1000 / tick_sum  : 0;
        long long d_share = death_sum ? g_piece_deaths[k] * 1000 / death_sum : 0;

        printf("  %-11s %4lld  %3lld.%lld  %3lld.%lld  %6lld    %6lld\n",
               SECTOR_TEMPLATES[k].name, seen,
               t_share / 10, t_share % 10,
               d_share / 10, d_share % 10,
               t_share ? d_share * 100 / t_share : 0,
               g_piece_broken[k] / seen);
    }
    printf("  (아홉 자리에 골고루 흩어지면 체류도 사망도 11.1%% 다)\n");
    printf("\n--- 아이템 ---\n");
    printf("  부순 블록 %lld 개, 상자 민 횟수 %lld 번, 살아남은 사람의 아이템 %lld.%lld 개\n",
           broken / rounds, pushed / rounds,
           win_items / rounds, (win_items * 10 / rounds) % 10);
    // 상한을 손으로 적어두면 상수를 바꾼 날 이 줄만 거짓말이 된다. 상수에서 뽑는다
    printf("  (상한은 물풍선 %d + 물줄기 %d + 롤러 %d = %d. 울트라를 먹으면 물줄기만 %d)\n",
           STAT_CAP_FROM_WALL, STAT_CAP_FROM_WALL, STAT_CAP_SPEED,
           STAT_CAP_FROM_WALL * 2 + STAT_CAP_SPEED,
           STAT_CAP_ULTRA);

    return 0;
}
