// Server/src/GameTick.h — 한 틱에 무엇을 어떤 순서로 하는가
//
// 소유 스레드 : tick
//
// 이 파일이 짧은 게 중요하다. 순서가 곧 규칙이라, 순서를 한눈에 못 보면
// 왜 그렇게 판정되는지 설명할 수 없게 된다.
#pragma once

#include "Bubble.h"

// 이벤트 목록은 여기서 비우지 않는다.
//
// 물풍선 설치는 이 함수보다 앞 단계(주문 처리)에서 일어난다.
// 여기서 비우면 그 사이에 생긴 일이 화면에 나가기 전에 지워진다.
// 비우는 것은 내보낸 쪽의 몫이다. main.cpp 의 FlushEvents 가 한다.
inline void GameTick()
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

    // 6) 물줄기를 삭힌다.
    //    맨 마지막이다. 먼저 삭히면 이번 틱에 갓 터진 물줄기가 한 틱 짧아진다
    FadeBlasts();
}
