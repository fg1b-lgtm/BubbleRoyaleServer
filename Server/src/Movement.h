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

// 판정 칸. 몸의 과반수가 있는 칸이다.
//
// 몸은 중심을 기준으로 양쪽으로 똑같이 뻗으므로, 과반수가 있는 칸은 언제나
// 중심이 있는 칸이다. 그래서 나눗셈 한 번이면 끝난다.
//
// 판정을 일부러 늦추지 않는다. 늦추면 발밑이 아닌 칸에 물풍선이 깔린다.
inline int JudgeAxis(int pos)
{
    return pos / TILE_UNITS;
}

// 몸이 걸쳐 있는 칸의 범위. 걸치기는 여기서 나온다.
//
// 몸은 타일보다 작아서(PLAYER_BODY_NUM/DEN) 두 칸에 걸쳐 설 수 있다.
// 물줄기는 칸 단위로 덮으므로, 몸은 물에 닿았는데 중심은 안전한 칸에 있는
// 순간이 생긴다. 그 순간이 이 게임에서 유일하게 손이 좋아서 사는 순간이다.
inline void BodySpanAxis(int pos, int* from, int* to)
{
    int lo = pos - PLAYER_HALF;
    int hi = pos + PLAYER_HALF;

    if (lo < 0) lo = 0;   // 테두리가 벽이라 실제로는 안 생기지만 나눗셈을 지킨다

    *from = lo / TILE_UNITS;
    *to   = hi / TILE_UNITS;
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
