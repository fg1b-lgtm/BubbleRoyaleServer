// Common/GameConstants.h — 게임 규칙 상수를 한곳에
//
// 봇 시뮬레이션으로 밸런스를 맞출 때 이 파일만 고치며 돌린다.
// 서버와 클라이언트가 같은 값을 봐야 같은 판정이 나오므로 Common 에 둔다.
#pragma once

#include <cstdint>

// ── 시뮬레이션 ─────────────────────────────────────────────
constexpr int TICK_RATE  = 30;    // 초당 몇 번 도나
constexpr int TILE_UNITS = 256;   // 타일 하나를 몇 칸으로 쪼개나 (고정소수점)

// 캐릭터 몸 크기. 타일 하나의 몇 배인가.
//
// 판정은 간단하다. **몸의 과반수가 있는 칸이 내가 있는 칸**이다.
// 몸이 중심을 기준으로 대칭이면 그건 곧 중심이 있는 칸이라, 계산이 필요 없다.
//
// 그럼 걸치기는 어디서 나오나.
//   몸은 타일보다 작아서 두 칸에 걸쳐 설 수 있다.
//   물줄기는 칸 단위로 덮는다.
//   그래서 몸은 물에 닿았는데 중심은 안전한 칸에 있는 순간이 생긴다. 그게 걸치기다.
//
// 이 값은 판정을 바꾸지 않는다. 몸이 얼마나 걸쳐 보이는지만 정한다.
//   작으면 걸쳐 있다는 게 눈에 잘 안 보인다
//   1.0 이면 늘 두 칸에 걸쳐 보여서 걸치기가 특별해 보이지 않는다
// float 를 안 쓰려고 분자/분모로 나눠 둔다. 서버와 클라가 같은 답을 내야 한다.
//
// 0.68 로 두고 돌려보니 캐릭터가 통로 안에서 너무 작아 보였다.
// 화면이 인형이 아니라 점 같았고, 맞았는지 스쳤는지가 눈에 잘 안 들어왔다.
// 0.80 이면 통로(1.0)를 거의 채운다. 양옆으로 0.1 씩만 남는다.
//   - 몸이 크니 걸치기가 더 자주 난다. 이 게임에서 제일 큰 리턴이 더 자주 온다
//   - 대신 코너에 더 잘 걸린다. 그래서 코너 보정(CORNER_ASSIST)이 더 중요해졌다
//   - 몸으로 부딪쳐 터뜨리는 거리(POP_TOUCH_DIST)도 같이 커진다. 마무리가 쉬워진다
constexpr int PLAYER_BODY_NUM = 80;    // 0.80 타일
constexpr int PLAYER_BODY_DEN = 100;

// 몸의 절반 길이. 중심에서 이만큼씩 뻗는다
constexpr int PLAYER_HALF = TILE_UNITS * PLAYER_BODY_NUM / (PLAYER_BODY_DEN * 2);

// ── 맵 ─────────────────────────────────────────────────────
constexpr int SECTOR_W = 15;   // 맵 조각 하나의 가로. 크레이지아케이드 원본 크기
constexpr int SECTOR_H = 13;
constexpr int SECTOR_COLS = 3; // 조각을 3x3 으로 붙인다
constexpr int SECTOR_ROWS = 3;
constexpr int MAP_W = SECTOR_W * SECTOR_COLS;   // 45
constexpr int MAP_H = SECTOR_H * SECTOR_ROWS;   // 39

constexpr int PLAYER_MAX = 24;

// 타일 한 칸에 무엇이 있나. 맵은 이 값들로만 채워진다
enum TileType : uint8_t
{
    TILE_EMPTY = 0,   // 통로
    TILE_WALL  = 1,   // 고정 벽. 드릴 말고는 못 부순다
    TILE_BLOCK = 2,   // 파괴 가능 블록. 부수면 확률로 아이템이 나온다

    // 놓인 물풍선도 칸을 막는다. 물줄기도 여기서 멈춘다.
    //
    // 놓은 사람은 그 칸에서 나갈 수 있고 나가면 다시 못 들어온다.
    // 따로 예외를 두지 않았는데도 그렇게 된다.
    // 이동 판정이 "지금 있는 칸" 이 아니라 "가려는 칸" 만 보기 때문이다.
    TILE_BUBBLE = 3,
};

// 맵 조각 하나에 스폰 자리 3개. 3x3 조각이니 전체 27 자리에 24명이 들어간다
constexpr int SPAWN_PER_SECTOR = 3;
constexpr int SPAWN_TOTAL      = SPAWN_PER_SECTOR * SECTOR_COLS * SECTOR_ROWS;

// 파괴 가능 블록을 조각이 '?' 로 남겨둔 자리 중 몇 퍼센트에 깔 것인가.
//
// 블록은 아이템 상자이자 시계다. 부술수록 맵이 열리면서 게임이 가속한다.
// 그래서 이 값 하나가 아이템 총량과 시작의 답답함을 동시에 정한다.
// tools/maptest.exe 가 밀도별 표를 찍어준다. 50 은 그 표를 보고 고른 값이다.
//
//   블록 270개 -> 아이템 108개 -> 24명이 나눠서 한 사람당 네다섯 개
//   스폰에서 밖으로 나가는 데 최대 1겹 (2.5초)
//
// 조각을 손으로 그리고 나서 이 값의 뜻이 바뀌었다.
// 예전에는 빈 칸 전부가 대상이라 길까지 막혔다. 지금은 '?' 로 표시한 자리만 대상이다.
// 길('.')에는 절대 안 깔린다. 그래서 밀도를 올려도 시작하자마자 갇히지 않는다.
constexpr int BLOCK_FILL_PERCENT = 50;

// 스폰 바로 옆 몇 칸에는 블록을 새로 얹지 않는가.
//
// 조각이 스폰 자리를 이미 길 위에 잡아뒀으므로 여기서 비울 일은 없다.
// 스폰끼리 공정성을 맞추느라 블록을 채워 넣을 때 코앞은 건드리지 말라는 뜻으로만 남는다
constexpr int SPAWN_CLEAR_RADIUS = 1;

// 스폰 주변 반경 3 안의 블록 수를 이 폭 안으로 맞춘다.
// 누구는 여덟 개고 누구는 둘이면 1분 뒤 아이템 차이가 그대로 실력 차이로 보인다.
// 대칭은 예쁘라고 하는 게 아니라 억울함을 없애는 장치다 (SPEC 2.2)
constexpr int SPAWN_BLOCK_TOLERANCE = 3;

// ── 이동 ───────────────────────────────────────────────────
//
// 속도는 "한 틱에 몇 units 가나" 로 적는다.
// "초당 몇 타일" 로 적으면 TICK_RATE 를 바꿀 때 전부 틀어진다.
//
//   24 units/tick * 30 tick/s / 256 units/tile = 2.8 타일/초
//   롤러를 상한(4)까지 먹으면 40 -> 4.7 타일/초
//
// 한 틱 이동량이 TILE_UNITS 보다 훨씬 작아야 한다.
// 크면 벽을 한 틱에 뛰어넘는다. 40 은 256 의 1/6 이라 안전하다.
constexpr int MOVE_SPEED_BASE = 24;
constexpr int MOVE_SPEED_STEP = 4;    // 롤러 하나당 붙는 양

// 갇혔을 때의 속도.
//
// 아예 못 움직이게 하면 5초가 그냥 죽은 시간이 된다.
// 느리게라도 갈 수 있어야 "물줄기 밖으로 기어나갈까" 가 판단거리가 된다.
// SPEC 2.4 가 갇힘을 기다리는 시간이 아니라 판단하는 시간이라고 한 이유다.
constexpr int TRAP_MOVE_SPEED = 6;    // 0.7 타일/초. 기본의 1/4

// 갇힌 사람을 터뜨리는 데 필요한 접촉 거리.
//
// 물줄기로는 갇힌 사람을 더 어쩌지 못한다. **몸으로 부딪쳐야 터진다.** 크아가 그렇다.
// 그래서 마무리하려면 거리를 좁혀야 하고, 좁히는 동안 내가 위험해진다.
// 갇힌 사람이 기어서 도망가는 것도 그래서 의미가 생긴다.
constexpr int POP_TOUCH_DIST = PLAYER_HALF * 2;

// 코너 보정.
//
// 가려는 쪽이 막혔는데 옆 칸 경계에서 이 거리 안에 있고 그쪽으로 돌면 길이 열린다면,
// 서버가 옆으로 살짝 밀어준다. 봄버맨류에서 손맛의 대부분이 여기서 나온다.
//
// 이게 없으면 모서리에 딱 붙어서 안 나가고, 플레이어는 게임이 아니라
// 자기 손가락이 틀렸다고 느낀다. 도망치다 벽에 걸려 죽는 게 제일 억울하다.
//
//   0    보정 없음. 격자에 정확히 맞춰야만 지나간다
//   90   256 의 35%. 반 칸쯤 어긋나 있어도 돌아진다
//   128  항상 붙는다. 너무 미끄러워서 원하는 칸에 못 선다
constexpr int CORNER_ASSIST = 90;

// ── 물풍선 ─────────────────────────────────────────────────
constexpr int MAX_BUBBLE        = PLAYER_MAX * 6;   // 사람당 최대 5개 + 여유
constexpr int BUBBLE_BASE_COUNT = 1;   // 아이템 없이 동시에 놓을 수 있는 수
constexpr int BLAST_BASE_RANGE  = 2;   // 아이템 없이 물줄기가 뻗는 칸 수

// 물줄기가 바닥에 남아 있는 시간.
// 0 이면 터진 그 한 틱에 그 자리에 있던 사람만 맞는다. 그러면 피할 방법이 운뿐이다.
// 남겨두면 "저기는 아직 위험하다" 가 판단 대상이 된다
constexpr int BLAST_DURATION_TICKS = 15;   // 0.5초

// 연쇄가 한 단계 번지는 데 걸리는 시간.
// 0 으로 두면 연쇄가 한 틱에 다 터져서 큰 폭발 하나로 보인다.
// 연쇄인 줄 모르면 이 게임에서 두 번째로 큰 리턴이 통째로 사라진다 (SPEC 2.7)
constexpr int CHAIN_STEP_TICKS = 3;   // 0.1초

// 갇힘에서 스스로 빠져나온 직후 잠깐 무적.
// 없으면 아직 남아 있는 물줄기에 그 자리에서 다시 맞는다
constexpr int INVULN_TICKS = TICK_RATE;   // 1초

// 걸치기를 연속으로 성공한 걸 몇 초까지 이어서 세나.
//
// 보상을 안 줘도 된다. 숫자가 올라가는 것 자체가 보상이다.
// 탄막 슈팅의 graze 가 정확히 그렇게 동작한다.
// 이 게임의 정체성인 기술에 눈에 보이는 숙련도 표시를 붙이는 것이다
constexpr int GRAZE_CHAIN_TICKS = TICK_RATE * 3;

// ── 침수 ───────────────────────────────────────────────────
//
// SPEC 2.6 의 표를 그대로 옮긴 것이다. 전부 틱으로 적는다.
//
//   0:00~1:00  자유 파밍. 첫 1분은 아무 일도 없다
//   1:00 예고(3구역) -> 1:30 침수
//   2:30 예고(3구역) -> 3:00 침수
//   4:00 예고(2구역) -> 4:30 침수
//
// 예고는 항상 침수 30초 전이다. 그 30초가 도망칠지 버틸지 정하는 시간이다.
//
// 바깥 여덟 구역이 3+3+2 로 잠기고 가운데 하나가 남는다.
// 가운데가 남는 건 우연이 아니다. SPEC 2.5 의 "중앙 위험 구역" 과 같은 자리다.
// 어차피 다 거기로 몰린다는 걸 알기 때문에 자리 잡기가 판단거리가 된다.
constexpr int FLOOD_STAGES = 3;

constexpr int FLOOD_WARN_TICKS[FLOOD_STAGES] = {
    TICK_RATE * 60, TICK_RATE * 150, TICK_RATE * 240,
};
constexpr int FLOOD_FILL_TICKS[FLOOD_STAGES] = {
    TICK_RATE * 90, TICK_RATE * 180, TICK_RATE * 270,
};
constexpr int FLOOD_COUNT[FLOOD_STAGES] = { 3, 3, 2 };

// 최종 구역 안에서 계속 차오르는 물.
//
// 구역 단위 침수만으로는 판이 안 끝난다.
// 최종 1구역이 143칸인데, 넷이 남으면 한 명당 36칸이다. 크아의 두 배라 서로 못 만난다.
// 봇 시뮬레이션에서 10판 중 1판이 10분 무승부로 끝난 게 그것 때문이다.
//
// 사람은 칸보다 빨리 준다. 그래서 구역을 다 잠근 뒤에도 계속 좁혀야 한다.
//   15x13 -> 13x11 -> 11x9 -> 9x7 -> 7x5
//   둘이 남았을 때 7x5 면 한 명당 12칸이라 반드시 만난다
constexpr int RING_STEP_TICKS = TICK_RATE * 20;   // 20초마다 한 겹
constexpr int RING_MIN_W      = 7;
constexpr int RING_MIN_H      = 5;

// 구역 상태
enum SectorState : uint8_t
{
    SECTOR_OPEN    = 0,
    SECTOR_WARNING = 1,   // 예고 중. 바닥에 물이 얕게 깔린다
    SECTOR_FLOODED = 2,   // 잠겼다. 여기 있으면 카운트다운이 돈다
};

// ── 판의 생명주기 ──────────────────────────────────────────
//
// 지금까지는 서버를 켜면 그냥 영원히 돌았다. "판이 시작하고 끝난다" 는 개념이 없었다.
// 그래서 붙는 순간 이미 물이 차 있기도 하고, 죽으면 남은 시간이 통째로 빈다.
//
// 크아가 이 문제를 푸는 방식이 라운드제다. 죽어도 곧 다음 판이 온다.
// SPEC 2.1 에 "24명, 라운드제" 라고 적어둔 그것이다.
enum RoundPhase : uint8_t
{
    ROUND_WAITING   = 0,   // 사람이 모자라다. 기다린다
    ROUND_COUNTDOWN = 1,   // 곧 시작. 아직 못 움직인다
    ROUND_PLAYING   = 2,
    ROUND_OVER      = 3,   // 승자 표시. 곧 다음 판
};

constexpr int ROUND_MIN_PLAYERS     = 2;
constexpr int ROUND_COUNTDOWN_TICKS = TICK_RATE * 3;   // SPEC 2.2 의 3초 카운트다운
constexpr int ROUND_OVER_TICKS      = TICK_RATE * 5;   // 결과를 보는 시간

// ── 아이템 ─────────────────────────────────────────────────
enum ItemType : uint8_t
{
    ITEM_NONE   = 0,
    ITEM_BUBBLE = 1,   // 동시 설치 +1
    ITEM_POWER  = 2,   // 물줄기 +1
    ITEM_ROLLER = 3,   // 이동 속도 +1

    // 물줄기를 한 번에 상한 위까지 올린다.
    // 벽에서는 절대 안 나온다. 킬 드롭과 최종 보급에서만 나온다.
    // 뒤처진 사람이 한 번에 따라잡을 수 있는 유일한 길이다 (SPEC 2.5)
    ITEM_ULTRA  = 4,
};

// ── 화면 ───────────────────────────────────────────────────
constexpr int PEEK_TILES        = 3;   // 인접 구역을 몇 칸까지 흐리게 보여주나
constexpr int CAMERA_HYSTERESIS = 2;   // 경계를 몇 칸 넘어야 카메라가 전환되나

// ── 시간 (전부 틱 단위. 초로 두면 틱레이트 바꿀 때 다 틀어진다) ──
constexpr int BUBBLE_FUSE_TICKS   = TICK_RATE * 5 / 2;   // 2.5초
constexpr int TRAP_DURATION_TICKS = TICK_RATE * 7;       // 7초

// 5초는 너무 빨리 풀렸다. 잡으러 가는 쪽이 거리를 좁히기도 전에 끝났다.
// 마무리가 몸으로만 되는 규칙이라, 쫓아갈 시간이 나와야 갇힘이 판단거리가 된다.
//   갇힌 쪽: 7초 x 6 units = 약 5칸. 기어서 도망칠 만한 거리
//   쫓는 쪽: 7초면 20칸 가까이 간다. 웬만하면 닿는다
constexpr int FLOOD_ESCAPE_TICKS  = TICK_RATE * 2;       // 2초

// ── 아이템 ─────────────────────────────────────────────────
constexpr int STAT_CAP_FROM_WALL  = 4;    // 벽에서 나오는 수치형의 상한
constexpr int ITEM_DROP_PERCENT   = 40;   // 블록을 부술 때 아이템이 나올 확률
constexpr int KILL_DROP_PERCENT   = 50;   // 죽을 때 흘리는 비율

// 울트라로만 갈 수 있는 물줄기 상한. 벽에서 나오는 것으로는 STAT_CAP_FROM_WALL 까지다
constexpr int STAT_CAP_ULTRA = 6;

// 사람을 잡았을 때 울트라가 같이 떨어질 확률.
// 이게 있어야 잡는 것이 파밍보다 확실히 낫고, 뒤처진 사람도 한 번에 따라잡는다
constexpr int ULTRA_DROP_PERCENT = 25;

// 흘린 아이템을 시체 주변 몇 칸까지 뿌리나
constexpr int LOOT_SPREAD = 3;
