// Server/src/GameTick.h — 판의 생명주기와 한 틱의 순서
//
// 소유 스레드 : tick
//
// 이 파일이 짧은 게 중요하다. 순서가 곧 규칙이라, 순서를 한눈에 못 보면
// 왜 그렇게 판정되는지 설명할 수 없게 된다.
//
// 판은 네 단계를 돈다.
//
//   기다림 ──(2명 이상)──> 카운트다운 ──(3초)──> 진행 ──(1명 남음)──> 결과
//      ^                                                              │
//      └──────────────────── 5초 뒤 새 판 ─────────────────────────────┘
//
// 라운드제로 도는 이유는 SPEC 2.1 에 적어둔 대로다.
// 죽고 나서 남은 시간이 통째로 비면 24인 배틀로얄은 대부분의 시간이 관전이 된다.
// 크아가 라운드제인 것도 같은 이유다. 죽어도 곧 다음 판이 온다.
#pragma once

#include "Flood.h"

// 게임 판정이 실제로 도는 한 틱
inline void PlayTick()
{
    ++g_game.tick;

    // 1) 퓨즈를 줄이고 다 된 물풍선을 터뜨린다.
    //    움직이기 전에 터뜨린다. 나중에 터뜨리면 이미 지나간 자리에 물이 깔린다
    UpdateBubbles();

    // 2) 사람을 움직인다
    for (int i = 0; i < PLAYER_MAX; ++i) {
        if (g_game.players[i].s != nullptr) {
            MovePlayer(g_game.map, g_game.players[i]);
        }
    }

    // 3) 발밑 아이템을 줍는다
    PickUpItems();

    // 4) 물줄기에 맞았는지 본다.
    //    반드시 움직인 다음이다. 움직이기 전에 보면 방금 피한 사람이 맞는다
    ResolveHits();

    // 5) 갇힘과 무적 시간을 줄인다
    UpdateTimers();

    // 6) 물이 차오른다.
    //    맞은 판정 다음이다. 먼저 보면 물줄기에 맞고 죽은 사람이 익사로도 한 번 더 처리된다
    UpdateFlood();

    // 7) 물줄기를 삭힌다.
    //    맨 마지막이다. 먼저 삭히면 이번 틱에 갓 터진 물줄기가 한 틱 짧아진다
    FadeBlasts();
}

// 이벤트 목록은 여기서 비우지 않는다.
//
// 물풍선 설치는 이 함수보다 앞 단계(주문 처리)에서 일어난다.
// 여기서 비우면 그 사이에 생긴 일이 화면에 나가기 전에 지워진다.
// 비우는 것은 내보낸 쪽의 몫이다. main.cpp 의 FlushEvents 가 한다.
inline void GameTick()
{
    ++g_game.phase_ticks;

    switch (g_game.phase) {

    case ROUND_WAITING:
        // 혼자 있으면 판을 시작할 이유가 없다
        if (g_game.player_count >= ROUND_MIN_PLAYERS) {
            EnterPhase(ROUND_COUNTDOWN);
        }
        break;

    case ROUND_COUNTDOWN:
        if (g_game.player_count < ROUND_MIN_PLAYERS) {
            EnterPhase(ROUND_WAITING);
        }
        else if (g_game.phase_ticks >= ROUND_COUNTDOWN_TICKS) {
            EnterPhase(ROUND_PLAYING);
        }
        break;

    case ROUND_PLAYING: {
        PlayTick();

        // 다 나가버렸으면 판을 접는다
        if (g_game.player_count < ROUND_MIN_PLAYERS) {
            g_game.winner = -1;
            EnterPhase(ROUND_OVER);
            break;
        }

        // 한 명 남으면 끝이다
        if (AliveCount() <= 1) {
            g_game.winner = -1;
            for (int i = 0; i < PLAYER_MAX; ++i) {
                if (g_game.players[i].s != nullptr && g_game.players[i].alive) {
                    g_game.winner = i;
                }
            }
            EnterPhase(ROUND_OVER);
        }
        break;
    }

    case ROUND_OVER:
        if (g_game.phase_ticks >= ROUND_OVER_TICKS) {
            RestartGame();
        }
        break;
    }
}
