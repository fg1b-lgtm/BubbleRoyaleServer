// Common/GameConstants.h — 게임 규칙 상수를 한곳에
//
// 봇 시뮬레이션으로 밸런스를 맞출 때 이 파일만 고치며 돌린다.
// 서버와 클라이언트가 같은 값을 봐야 같은 판정이 나오므로 Common 에 둔다.
//
// 아직 게임 로직이 없어서 쓰이는 값은 없다. 9/1 에 채운다.
#pragma once

// ── 시뮬레이션 ─────────────────────────────────────────────
constexpr int TICK_RATE  = 30;    // 초당 몇 번 도나
constexpr int TILE_UNITS = 256;   // 타일 하나를 몇 칸으로 쪼개나 (고정소수점)

// 걸치기 난이도를 혼자 결정하는 값.
// 새 타일에 이 비율 이상 들어가야 판정 타일이 바뀐다.
// 0.5 면 걸치기가 아예 안 되고, 0.9 면 너무 쉽다. 봇으로 튜닝한다.
// float 를 안 쓰려고 분자/분모로 나눠 둔다. 서버와 클라가 같은 답을 내야 한다.
constexpr int TILE_SWITCH_NUM = 68;    // 0.68
constexpr int TILE_SWITCH_DEN = 100;

// ── 맵 ─────────────────────────────────────────────────────
constexpr int SECTOR_W = 15;   // 맵 조각 하나의 가로. 크레이지아케이드 원본 크기
constexpr int SECTOR_H = 13;
constexpr int SECTOR_COLS = 3; // 조각을 3x3 으로 붙인다
constexpr int SECTOR_ROWS = 3;
constexpr int MAP_W = SECTOR_W * SECTOR_COLS;   // 45
constexpr int MAP_H = SECTOR_H * SECTOR_ROWS;   // 39

constexpr int PLAYER_MAX = 24;

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
