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

// 코너 보정. 가려는 쪽이 막혔을 때 옆으로 살짝 밀어 모서리를 돌게 해준다.
//
// 왜 서버가 이걸 하나.
//   플레이어는 통로 한가운데를 정확히 맞춰 달리지 않는다. 반 칸쯤 어긋난 채로 달린다.
//   그 상태로 모서리에 닿으면 벽에 붙어서 안 나간다.
//   그때 사람은 "게임이 안 도와준다" 가 아니라 "내가 못 눌렀다" 고 느낀다. 그게 제일 나쁘다.
//   도망치다 벽에 걸려 죽는 게 이 장르에서 가장 억울한 죽음이다.
//
//   move_pos      가려는 축의 위치
//   side_pos      안 가는 축의 위치. 이쪽을 밀어준다
//   step          이번 틱에 가려던 양. 부호가 방향
//   moving_is_x   가려는 축이 가로면 true
//   speed         한 틱에 밀어줄 수 있는 최대량. 이동 속도와 같게 둔다
//
// 반환값은 side_pos 의 새 위치다.
inline int CornerAssistAxis(const GameMap& map,
                            int move_pos, int side_pos,
                            int step, bool moving_is_x, int speed)
{
    if (step == 0) {
        return side_pos;
    }

    int mt    = move_pos / TILE_UNITS;
    int st    = side_pos / TILE_UNITS;
    int ahead = (step > 0) ? mt + 1 : mt - 1;

    // 앞이 안 막혔으면 도와줄 일이 없다
    bool blocked = moving_is_x ? map.IsSolid(ahead, st) : map.IsSolid(st, ahead);
    if (!blocked) {
        return side_pos;
    }

    int so = side_pos % TILE_UNITS;   // 옆축으로 지금 칸에 얼마나 들어와 있나

    // 다음 칸 쪽에 가까이 붙어 있는 경우. 그쪽으로 밀면 돌아진다
    if (so >= TILE_UNITS - CORNER_ASSIST) {
        bool opens = moving_is_x
            ? (!map.IsSolid(ahead, st + 1) && !map.IsSolid(mt, st + 1))
            : (!map.IsSolid(st + 1, ahead) && !map.IsSolid(st + 1, mt));

        if (opens) {
            int push = TILE_UNITS - so;    // 경계까지 남은 만큼만
            if (push > speed) push = speed;
            return side_pos + push;
        }
    }
    // 이전 칸 쪽에 가까이 붙어 있는 경우
    else if (so <= CORNER_ASSIST) {
        bool opens = moving_is_x
            ? (!map.IsSolid(ahead, st - 1) && !map.IsSolid(mt, st - 1))
            : (!map.IsSolid(st - 1, ahead) && !map.IsSolid(st - 1, mt));

        if (opens) {
            int push = so + 1;
            if (push > speed) push = speed;
            return side_pos - push;
        }
    }

    return side_pos;   // 밀어봐야 거기도 벽이다. 그냥 선다
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
