// Server/src/Movement.h — 한 축을 움직이고, 판정 타일을 따라오게 한다
//
// 이 게임의 조작감이 전부 이 파일에 있다.
//
// 소유 스레드 : tick
//   여기 있는 함수는 상태를 안 가진다. 넣은 값으로만 답을 낸다.
//   그래서 서버를 안 켜고도 tools/movetest.cpp 로 두들길 수 있다.
//
// float 를 안 쓴다. 서버와 클라이언트가 같은 답을 내야 하는데
// 소수점은 기계마다 마지막 자리가 다를 수 있다. 전부 정수로 한다.
#pragma once

#include "GameMap.h"

// 판정 타일을 갱신한다. 걸치기의 전부가 이 함수 하나다.
//
// 몸이 있는 타일과 판정 타일을 일부러 따로 둔다.
// 새 칸에 발을 걸쳐도 판정은 아직 옛 칸에 남아 있고,
// 그 사이에 물줄기가 새 칸을 때리면 안 맞는다. 그게 걸치기다.
inline int UpdateJudgeAxis(int pos, int judge)
{
    int t  = pos / TILE_UNITS;   // 몸이 실제로 들어가 있는 타일
    int in = pos % TILE_UNITS;   // 그 타일의 왼쪽 끝에서 얼마나 들어왔나

    if (t == judge) {
        return judge;            // 아직 안 넘어갔다. 볼 것도 없다
    }

    // 한 틱에 두 칸 넘게 갔다면 걸치기를 따질 상황이 아니다.
    // 지금 속도로는 안 생기지만, 나중에 순간이동이 붙으면 여기로 온다
    if (t > judge + 1 || t < judge - 1) {
        return t;
    }

    // 새 타일 안으로 얼마나 파고들었나.
    // 오른쪽으로 갔으면 왼쪽 끝에서 잰 in 이 그대로 깊이고,
    // 왼쪽으로 갔으면 오른쪽 끝에서 재야 하므로 뒤집는다
    int depth = (t > judge) ? in : (TILE_UNITS - in);

    // depth / TILE_UNITS >= NUM / DEN  을 나누기 없이 쓴 것이다.
    // 나누면 소수점이 잘려서 경계에서 한 칸씩 어긋난다
    if (depth * TILE_SWITCH_DEN >= TILE_UNITS * TILE_SWITCH_NUM) {
        return t;
    }

    return judge;   // 아직 덜 들어갔다. 판정은 옛 칸에 남는다
}

// 한 축으로만 움직여본다. 가려는 칸이 막혀 있으면 경계 앞에 세운다.
//
//   pos       움직일 축의 지금 위치
//   other_pos 안 움직이는 축의 위치. 어느 칸을 볼지 정하는 데 필요하다
//   step      이번 틱에 갈 양. 부호가 방향이다
//   is_x      pos 가 가로축이면 true
inline int StepAxis(const GameMap& map, int pos, int other_pos, int step, bool is_x)
{
    if (step == 0) {
        return pos;
    }

    int want   = pos + step;
    int t_now  = pos  / TILE_UNITS;
    int t_want = want / TILE_UNITS;

    // 같은 칸 안에서 움직이는 거라면 벽을 볼 이유가 없다.
    // 한 틱 이동량이 TILE_UNITS 보다 훨씬 작아서 칸은 한 번에 하나씩만 바뀐다
    if (t_want == t_now) {
        return want;
    }

    int other_t = other_pos / TILE_UNITS;
    int tx = is_x ? t_want  : other_t;
    int ty = is_x ? other_t : t_want;

    if (map.IsSolid(tx, ty)) {
        // 막혔다. 지금 칸 안에서 갈 수 있는 끝까지만 간다.
        // 칸 밖으로 한 칸도 나가면 안 되므로 오른쪽은 TILE_UNITS - 1 이다
        if (step > 0) {
            return t_now * TILE_UNITS + (TILE_UNITS - 1);
        }
        return t_now * TILE_UNITS;
    }

    return want;
}
