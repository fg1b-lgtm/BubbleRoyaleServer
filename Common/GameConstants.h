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
constexpr int PLAYER_BODY_NUM = 68;    // 0.68 타일
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

// 파괴 가능 블록을 빈 칸 중 몇 퍼센트에 깔 것인가
constexpr int BLOCK_FILL_PERCENT = 55;

// 스폰 자리 주변 몇 칸을 비워둘 것인가. 시작하자마자 갇히면 안 된다
constexpr int SPAWN_CLEAR_RADIUS = 2;

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

// 구역 상태
enum SectorState : uint8_t
{
    SECTOR_OPEN    = 0,
    SECTOR_WARNING = 1,   // 예고 중. 바닥에 물이 얕게 깔린다
    SECTOR_FLOODED = 2,   // 잠겼다. 여기 있으면 카운트다운이 돈다
};

// ── 아이템 ─────────────────────────────────────────────────
enum ItemType : uint8_t
{
    ITEM_NONE   = 0,
    ITEM_BUBBLE = 1,   // 동시 설치 +1
    ITEM_POWER  = 2,   // 물줄기 +1
    ITEM_ROLLER = 3,   // 이동 속도 +1
};

// ── 화면 ───────────────────────────────────────────────────
constexpr int PEEK_TILES        = 3;   // 인접 구역을 몇 칸까지 흐리게 보여주나
constexpr int CAMERA_HYSTERESIS = 2;   // 경계를 몇 칸 넘어야 카메라가 전환되나

// ── 시간 (전부 틱 단위. 초로 두면 틱레이트 바꿀 때 다 틀어진다) ──
constexpr int BUBBLE_FUSE_TICKS   = TICK_RATE * 5 / 2;   // 2.5초
constexpr int TRAP_DURATION_TICKS = TICK_RATE * 5;       // 5초
constexpr int FLOOD_ESCAPE_TICKS  = TICK_RATE * 2;       // 2초

// ── 아이템 ─────────────────────────────────────────────────
constexpr int STAT_CAP_FROM_WALL  = 4;    // 벽에서 나오는 수치형의 상한
constexpr int ITEM_DROP_PERCENT   = 40;   // 블록을 부술 때 아이템이 나올 확률
constexpr int KILL_DROP_PERCENT   = 50;   // 죽을 때 흘리는 비율
