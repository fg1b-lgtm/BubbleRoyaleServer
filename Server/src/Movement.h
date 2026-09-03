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
    // 0 이면 안 도와준다. 벽에 닿으면 선다 (GameConstants.h 참고)
    if (step == 0 || CORNER_ASSIST <= 0) {
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

// 줄 맞춤. 가는 축과 직각인 축을 지금 칸 한가운데로 당긴다.
//
// 왜 필요한가.
//   코너 보정을 끄고 나니 통로를 못 지나가게 됐다.
//   통로가 한 칸(256)인데 몸이 204 라, 들어가려면 중심이 가운데 52칸(20%) 안에
//   있어야 한다. 키보드로 그건 못 맞춘다.
//
// 코너 보정과 다른 점은 하나뿐이고 그게 전부다.
//   코너 보정 : **옆 칸으로** 민다      -> 벽에 비비면 다른 줄로 미끄러진다
//   줄 맞춤   : **내 칸 한가운데로** 당긴다 -> 줄을 절대 안 벗어난다
//
// **언제 당기나가 전부다.** 여기서 두 번 틀렸다.
//
//   1) 한 방향만 누르면 늘 당겼다.
//      아무것도 없는 데서 걷는데 자꾸 옆으로 밀렸다.
//
//   2) 좁은 데로 들어갈 때만, 그중에서도 몸이 실제로 안 들어갈 때만 당겼다.
//      판 20개를 326,144번 걸었더니 당기다 끊기고 다시 당기기를 40,534번 했다.
//      기둥을 지날 때마다 조건이 바뀌니 그럴 수밖에 없었다.
//
//   그래서 조건을 아예 없애고 한 축으로 걷는 동안 늘 당기게 했다. 끊김은
//   사라졌는데 이번엔 **트인 데서도 계속 당겼다.** 걸치기를 하려고 일부러
//   치우쳐 서면 서버가 도로 끌어왔다. 이 게임의 정체성이 걸치기인데
//   그걸 서버가 방해하고 있었던 것이다.
//
// 지금 규칙은 하나다. **못 가는데, 줄에 맞으면 갈 수 있을 때만 당긴다.**
//
//   못 간다 + 가운데였으면 갔다  -> 당긴다 (통로 앞에서 줄을 맞춰주는 것)
//   갈 수 있다                   -> 아무 일도 안 한다 (트인 데)
//   가운데여도 못 간다           -> 아무 일도 안 한다 (그냥 벽이다)
//
// 이러면 트인 데서는 한 점도 안 밀리고, 통로 앞에서는 붙을 때까지 계속 당긴다.
// 붙으면 지나가고 그걸로 끝이라 끊겼다 다시 당기는 일이 안 생긴다.
// **도움이 필요할 때만 도와주는 것**이 도와주는 것이다
inline int CenterAxis(const GameMap& map, int move_pos, int side_pos,
                      int step, bool moving_is_x, int speed)
{
    if (LANE_SNAP_PERCENT <= 0 || step == 0) {
        return side_pos;
    }

    // 이번 틱에 가려는 쪽 몸 끝이 닿을 칸
    int edge  = (step > 0) ? move_pos + speed + PLAYER_HALF
                           : move_pos - speed - PLAYER_HALF;
    int ahead = edge / TILE_UNITS;

    // 지금 몸이 걸쳐 있는 옆줄들. 하나라도 막혀 있으면 못 간다
    int s0 = (side_pos - PLAYER_HALF) / TILE_UNITS;
    int s1 = (side_pos + PLAYER_HALF) / TILE_UNITS;

    bool blocked = false;
    for (int s = s0; s <= s1; ++s) {
        bool solid = moving_is_x ? map.IsSolid(ahead, s) : map.IsSolid(s, ahead);
        if (solid) { blocked = true; break; }
    }
    if (!blocked) {
        return side_pos;          // 그냥 갈 수 있다. 손댈 이유가 없다
    }

    // 줄 한가운데였으면 갈 수 있었나. 아니면 그냥 벽이라 당겨봐야 소용없다
    int st = side_pos / TILE_UNITS;
    bool center_open = moving_is_x ? !map.IsSolid(ahead, st) : !map.IsSolid(st, ahead);
    if (!center_open) {
        return side_pos;
    }

    // 당긴다. 걷는 속도와 같게 당겨서 서너 틱이면 붙는다.
    // 절반으로 당기면 여덟 틱이 걸리고 그 여덟 틱이 눈에 보인다
    int center = st * TILE_UNITS + TILE_UNITS / 2;
    int d      = center - side_pos;

    if (d > speed)  d =  speed;
    if (d < -speed) d = -speed;

    return side_pos + d;
}

// 한 축으로만 움직여본다. 몸이 벽에 닿으면 거기서 선다.
//
// 9/1 에 기준을 바꿨다. 전에는 **몸 중심**이 들어가려는 칸만 봤다.
// 그러면 몸이 타일보다 작아서(0.8) 벽 칸에 0.4 만큼 파묻힌 채로 설 수 있었다.
// 화면으로 보면 캐릭터가 벽에 반쯤 박혀 있다. 벽에 걸치기가 되는 셈이었다.
//
// 이제 보는 것은 중심이 아니라 **가는 쪽 몸 끝**이다.
// 몸 끝이 벽 칸에 들어가려 하면 경계 바로 앞에서 세운다.
//
// 걸치기는 안 없어진다. 걸치기는 **물줄기**에 대해 일어나는 것이고,
// 물줄기는 빈 칸에만 깔린다. 벽에만 안 걸쳐지는 것이다.
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

    int want = pos + step;

    // 가려는 쪽 몸 끝. 오른쪽으로 가면 오른쪽 끝, 왼쪽으로 가면 왼쪽 끝
    int edge   = (step > 0) ? want + PLAYER_HALF : want - PLAYER_HALF;
    int t_now  = pos  / TILE_UNITS;
    int t_edge = edge / TILE_UNITS;

    // 몸 끝이 아직 내 칸 안이면 볼 것이 없다.
    // 내 칸이 벽일 수는 없고, 내가 놓은 물풍선이면 나가는 건 허용해야 한다
    if (t_edge == t_now) {
        return want;
    }

    // 반대 축으로 몸이 걸친 칸을 **전부** 본다.
    //
    // 중심이 있는 칸 하나만 보면 대각선이 빈다.
    // 오른쪽으로 가는데 몸이 위아래 두 줄에 걸쳐 있으면, 들어가려는 칸 위쪽이
    // 벽일 때 그 벽에 몸 귀퉁이가 박힌다. 그게 6000틱 중 1775틱이었다.
    int o0, o1;
    BodySpanAxis(other_pos, &o0, &o1);

    bool blocked = false;
    for (int o = o0; o <= o1; ++o) {
        int tx = is_x ? t_edge : o;
        int ty = is_x ? o      : t_edge;
        if (map.IsSolid(tx, ty)) { blocked = true; break; }
    }

    if (blocked) {
        // 몸 끝이 그 칸 경계에 닿는 데까지만 간다
        if (step > 0) {
            return t_edge * TILE_UNITS - PLAYER_HALF - 1;
        }
        return (t_edge + 1) * TILE_UNITS + PLAYER_HALF;
    }

    return want;
}

// 몸이 이미 벽에 파묻혀 있으면 빼낸다.
//
// StepAxis 만으로는 부족하다. 옆으로 달리는 동안 **세상이 바뀌기** 때문이다.
//   위가 뚫린 데서 위쪽으로 치우쳐 서 있다가 그대로 오른쪽으로 달리면,
//   위가 벽인 칸에 들어가면서 몸이 그 벽에 파묻힌다.
//   가는 축은 StepAxis 가 보지만 옆 축은 아무도 안 본다.
//
// 그래서 매 틱 양쪽 축을 다 훑어서, 몸이 들어갈 수 있는 범위 안으로 되돌린다.
// 한 번에 speed 만큼만 옮긴다. 확 튀면 순간이동처럼 보인다.
//
//   반대로 밀어낼 데가 없는 경우는 안 생긴다.
//   통로가 한 칸(256)이고 몸이 204 라 가운데 52 만큼의 자리가 언제나 남는다.
inline int ClampAxis(const GameMap& map, int pos, int other_pos, bool is_x, int speed)
{
    int t = pos / TILE_UNITS;

    int lo_limit = 0;
    int hi_limit = (is_x ? MAP_W : MAP_H) * TILE_UNITS - 1;

    // 여기도 반대 축으로 몸이 걸친 칸을 전부 본다. 대각선 때문이다.
    //
    // 격자에서 홀수 줄을 달릴 때, 몸이 짝수 줄까지 걸치면 그 줄에는 기둥이 있다.
    // 그래서 짝수 칸을 지날 때마다 통로 한가운데로 끌려온다.
    // 끌려오는 양이 한 틱에 speed 만큼이라 미끄러지듯 정렬된다.
    // 봄버맨류에서 칸에 맞춰 서지는 느낌이 이런 식으로 나온다
    int o0, o1;
    BodySpanAxis(other_pos, &o0, &o1);

    bool prev_solid = false, next_solid = false;
    for (int o = o0; o <= o1; ++o) {
        if (is_x) {
            if (map.IsSolid(t - 1, o)) prev_solid = true;
            if (map.IsSolid(t + 1, o)) next_solid = true;
        } else {
            if (map.IsSolid(o, t - 1)) prev_solid = true;
            if (map.IsSolid(o, t + 1)) next_solid = true;
        }
    }

    if (prev_solid) lo_limit = t * TILE_UNITS + PLAYER_HALF;
    if (next_solid) hi_limit = (t + 1) * TILE_UNITS - PLAYER_HALF - 1;

    if (lo_limit > hi_limit) {
        return pos;   // 있을 수 없다. 그래도 억지로 밀지는 않는다
    }

    int want = pos;
    if (want < lo_limit) want = lo_limit;
    if (want > hi_limit) want = hi_limit;

    int move = want - pos;
    if (move >  speed) move =  speed;
    if (move < -speed) move = -speed;

    return pos + move;
}
