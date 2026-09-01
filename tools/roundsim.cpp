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
};

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
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            if (g_game.map.tile[y][x] == TILE_BLOCK) ++start_blocks;

    // 전부 봇으로 앉힌다. 세션을 흉내 낼 필요가 없어졌다
    for (int i = 0; i < PLAYER_MAX; ++i) {
        AddPlayer(nullptr, true);
    }

    const int MAX_TICKS = TICK_RATE * 60 * 10;   // 10분이면 무승부

    int drowning_before[PLAYER_MAX];
    bool alive_before[PLAYER_MAX];
    int sample = 0;

    for (int t = 1; t <= MAX_TICKS; ++t) {
        BotThinkAll();

        for (int i = 0; i < PLAYER_MAX; ++i) {
            drowning_before[i] = g_game.players[i].flood_ticks;
            alive_before[i]    = g_game.players[i].alive;

        }

        g_game.event_count = 0;
        GameTick();

        // 자기 물풍선에 갇히는 건 봇이 서툴다는 뜻이다. 게임 문제와 구분해서 센다
        for (int e = 0; e < g_game.event_count; ++e) {
            const GameEvent& ev = g_game.events[e];
            if (ev.type == EVT_TRAP && g_game.blast_owner[ev.y][ev.x] == (int8_t)ev.who) {
                ++r.by_self;
            }
        }

        for (int i = 0; i < PLAYER_MAX; ++i) {
            if (alive_before[i] && !g_game.players[i].alive) {
                // 죽는 길은 둘뿐이다. 물에 잠기거나, 갇힌 채로 터뜨려지거나.
                // 물줄기 자체는 사람을 못 죽인다. 가두기만 한다
                if (drowning_before[i] == 1) ++r.by_water;
                else                         ++r.by_bubble;
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
            ++sample;
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
    for (int y = 0; y < MAP_H; ++y)
        for (int x = 0; x < MAP_W; ++x)
            if (g_game.map.tile[y][x] == TILE_BLOCK) ++left;
    r.blocks_broken = start_blocks - left;
}

int main(int argc, char** argv)
{
    setvbuf(stdout, nullptr, _IONBF, 0);

    int rounds = (argc > 1) ? atoi(argv[1]) : 20;
    if (rounds < 1) rounds = 1;

    printf("=== 봇 %d명, %d판 ===\n\n", PLAYER_MAX, rounds);

    long long ticks = 0, bubble = 0, water = 0, first = 0, items = 0, broken = 0;
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
    printf("  자기 물풍선에 갇힌 횟수: %lld  <- 봇이 서툴다는 뜻이지 게임 문제가 아니다\n",
           self_kill / rounds);

    printf("\n--- 압박 곡선 (30초마다) ---\n");
    printf("  시각    생존   한 명당 칸\n");
    for (int k = 0; k < 8; ++k) {
        if (alive_at[k] == 0 && k > 0) break;
        printf("  %d:%02d   %4lld   %6lld\n",
               (k + 1) * 30 / 60, ((k + 1) * 30) % 60,
               alive_at[k] / rounds, tiles_at[k] / rounds);
    }

    printf("\n--- 아이템 ---\n");
    printf("  부순 블록 %lld 개, 살아남은 사람의 아이템 %lld.%lld 개\n",
           broken / rounds,
           win_items / rounds, (win_items * 10 / rounds) % 10);
    printf("  (상한은 물풍선 4 + 물줄기 4 + 롤러 4 = 12. 울트라를 먹으면 물줄기만 6)\n");

    return 0;
}
