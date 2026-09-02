// web/predict.js — 내 캐릭터만 미리 움직인다
//
// 왜 필요한가. 재봤기 때문이다.
//
//   지연 0     키를 누르고 화면이 움직이기까지 32ms
//   왕복 160ms                              217ms
//
// 217ms 면 조작이 아니라 원격 조종이다. 이 게임은 반 칸 차이로 사는 게임이라
// 그만큼 늦으면 걸치기가 실력이 아니라 운이 된다.
//
// 서버 권위는 그대로다. 맞고 죽는 것은 전부 서버가 정한다.
// 여기서 하는 일은 **서버가 어차피 내릴 답을 미리 그려주는 것**뿐이다.
// 서버 답이 오면 비교해서 어긋난 만큼만 조용히 당긴다.
//
// 그래서 같은 계산이어야 한다. 서버가 정수만 쓰는 이유가 이것이다 —
// 소수를 쓰면 브라우저와 MSVC 의 반올림이 달라서 조금씩 어긋나고,
// 그 조금이 쌓이면 매 틱 튄다. 아래는 Server/src/Movement.h 를 그대로 옮긴 것이다.
//
// **여기를 고치면 저기도 고쳐야 한다.** 한쪽만 고치면 화면과 판이 갈린다.
const Predict = (() => {
  let C = null;          // 서버가 준 상수
  let HALF = 0;          // 몸 반지름 (units)

  // 내가 지금 어디 있다고 믿는가
  let px = 0, py = 0;
  let live = false;

  // 서버가 마지막으로 말해준 자리와, 그때 내가 믿던 자리
  let errX = 0, errY = 0;

  // 맞춰볼 때마다 **녹이기 전의** 어긋난 거리를 그대로 적어둔다.
  //
  // 화면에 보이는 오차만 재면 늘 0 에 가깝게 나온다. 녹이는 장치가 지워버리기 때문이다.
  // 그건 '부드럽게 감췄다' 를 재는 것이지 '같은 답을 냈다' 를 재는 게 아니다.
  // 예측이 서버와 다르면 감춰도 결국 지나간 자리로 되돌아간다
  let rawMax = 0, rawSum = 0, rawN = 0, snapped = 0;

  function setup(c) {
    C = c;
    HALF = Math.floor(c.tileUnits * c.bodyNum / (c.bodyDen * 2));
    live = false;
    errX = 0; errY = 0;
  }

  // ── 판 읽기 ────────────────────────────────────────────────
  //
  // 서버의 GameMap::IsSolid 와 같아야 한다.
  // 벽 · 블록 · 상자 · 물풍선이 막는다. 빈 칸만 지나갈 수 있다
  function solid(tiles, x, y) {
    if (!tiles) return true;
    if (x < 0 || y < 0 || x >= C.mapW || y >= C.mapH) return true;
    return tiles[y][x] !== 0;
  }

  function span(pos) {
    let lo = pos - HALF;
    const hi = pos + HALF;
    if (lo < 0) lo = 0;
    return [Math.floor(lo / C.tileUnits), Math.floor(hi / C.tileUnits)];
  }

  // 한 축으로 움직여본다. 가는 쪽 몸 끝이 벽에 닿으면 거기서 선다
  function stepAxis(tiles, pos, other, step, isX) {
    if (step === 0) return pos;

    const want = pos + step;
    const edge = (step > 0) ? want + HALF : want - HALF;

    const tNow  = Math.floor(pos / C.tileUnits);
    const tEdge = Math.floor(edge / C.tileUnits);
    if (tEdge === tNow) return want;

    // 반대 축으로 몸이 걸친 칸을 전부 본다. 하나만 보면 대각선이 빈다
    const [o0, o1] = span(other);
    let blocked = false;
    for (let o = o0; o <= o1 && !blocked; ++o) {
      blocked = isX ? solid(tiles, tEdge, o) : solid(tiles, o, tEdge);
    }
    if (!blocked) return want;

    return (step > 0) ? tEdge * C.tileUnits - HALF - 1
                      : (tEdge + 1) * C.tileUnits + HALF;
  }

  // 몸이 벽에 파묻혀 있으면 한 틱에 speed 만큼 빼낸다
  function clampAxis(tiles, pos, other, isX, speed) {
    const t = Math.floor(pos / C.tileUnits);

    let lo = 0;
    let hi = (isX ? C.mapW : C.mapH) * C.tileUnits - 1;

    const [o0, o1] = span(other);
    let prevSolid = false, nextSolid = false;
    for (let o = o0; o <= o1; ++o) {
      if (isX) {
        if (solid(tiles, t - 1, o)) prevSolid = true;
        if (solid(tiles, t + 1, o)) nextSolid = true;
      } else {
        if (solid(tiles, o, t - 1)) prevSolid = true;
        if (solid(tiles, o, t + 1)) nextSolid = true;
      }
    }

    if (prevSolid) lo = t * C.tileUnits + HALF;
    if (nextSolid) hi = (t + 1) * C.tileUnits - HALF - 1;
    if (lo > hi) return pos;

    let want = pos;
    if (want < lo) want = lo;
    if (want > hi) want = hi;

    let move = want - pos;
    if (move >  speed) move =  speed;
    if (move < -speed) move = -speed;
    return pos + move;
  }

  // 좁은 데로 들어갈 때만 내 칸 한가운데로 당긴다
  function centerAxis(tiles, movePos, sidePos, step, movingIsX, speed) {
    if (C.laneSnap <= 0 || step === 0) return sidePos;

    const edge  = (step > 0) ? movePos + speed + HALF : movePos - speed - HALF;
    const ahead = Math.floor(edge / C.tileUnits);
    const st    = Math.floor(sidePos / C.tileUnits);

    const aheadOpen = movingIsX ? !solid(tiles, ahead, st) : !solid(tiles, st, ahead);
    if (!aheadOpen) return sidePos;

    const narrow = movingIsX
      ? (solid(tiles, ahead, st - 1) || solid(tiles, ahead, st + 1))
      : (solid(tiles, st - 1, ahead) || solid(tiles, st + 1, ahead));
    if (!narrow) return sidePos;

    // 몸이 실제로 안 들어갈 때만 당긴다. Movement.h 와 같은 규칙이다 —
    // 여기가 다르면 예측이 서버와 갈려서 매 틱 되돌아간다.
    //
    // 9/3 에 조건을 통째로 없앴다. 좁은 데인지 · 몸이 들어가는지를 따지면
    // 기둥을 지날 때마다 켜졌다 꺼져서 손에 '밀린다' 로 느껴진다.
    // 한 축으로 걷는 동안에는 늘 줄 가운데로, 걷는 속도만큼 당긴다
    const center = st * C.tileUnits + (C.tileUnits >> 1);
    let d = center - sidePos;

    if (d >  speed) d =  speed;
    if (d < -speed) d = -speed;
    return sidePos + d;
  }

  // ── 한 틱 ──────────────────────────────────────────────────
  //
  // Server/src/Game.h 의 MovePlayer 와 같은 순서다.
  // 순서가 바뀌면 답이 달라진다. 줄여 쓰지 않고 그대로 옮겼다
  function tick(tiles, dirX, dirY, speedLv, trapped) {
    if (!live) return;

    const speed = trapped ? C.trapSpeed
                          : (C.moveBase + speedLv * C.moveStep);

    if (dirX !== 0 && dirY === 0) {
      py = centerAxis(tiles, px, py, dirX * speed, true, speed);
    } else if (dirY !== 0 && dirX === 0) {
      px = centerAxis(tiles, py, px, dirY * speed, false, speed);
    }

    px = stepAxis(tiles, px, py, dirX * speed, true);
    py = stepAxis(tiles, py, px, dirY * speed, false);

    py = clampAxis(tiles, py, px, false, speed);
    px = clampAxis(tiles, px, py, true,  speed);
  }

  // ── 서버 답이 왔다 ─────────────────────────────────────────
  //
  // 어긋난 만큼을 **오차로 들고 있다가 몇 프레임에 걸쳐 녹인다.**
  // 서버 자리로 바로 옮기면 벽에 부딪힐 때마다 한 칸씩 튄다.
  //
  // 많이 어긋났으면 예측이 틀린 것이니 그냥 서버를 따른다.
  // 반 칸 넘게 어긋나는 건 내가 모르는 일(밀림, 부활)이 일어난 것이다
  function reconcile(sx, sy) {
    if (!live) {
      px = sx; py = sy; live = true;
      errX = 0; errY = 0;
      return;
    }

    const dx = px - sx, dy = py - sy;
    const far = C.tileUnits >> 1;

    const raw = Math.hypot(dx, dy);
    rawSum += raw; ++rawN;
    if (raw > rawMax) rawMax = raw;

    if (Math.abs(dx) > far || Math.abs(dy) > far) {
      ++snapped;              // 예측이 아예 틀렸다. 서버로 순간이동한다
      px = sx; py = sy;
      errX = 0; errY = 0;
      return;
    }

    // 서버 자리를 진짜로 삼고, 어긋난 만큼은 그림에서만 천천히 지운다
    px = sx; py = sy;
    errX = dx; errY = dy;
  }

  function stop() { live = false; errX = 0; errY = 0; }

  // 예측을 쉬고 서버 자리를 그대로 쓴다. 대쉬처럼 짧고 특수한 동작에 쓴다.
  //
  // stop() 과 다르다. stop 은 예측을 끄는 것이라 다시 켤 때 한 번 튄다.
  // 이건 켜둔 채로 자리만 맞추는 것이라, 대쉬가 끝나면 이어서 예측이 돈다.
  // 어긋난 양(err)도 지운다 — 안 지우면 대쉬가 끝나고 그만큼 미끄러진다
  function follow(sx, sy) {
    px = sx; py = sy; live = true;
    errX = 0; errY = 0;
  }

  // 화면에 그릴 자리. 오차를 조금씩 녹여서 튐을 감춘다
  function view() {
    errX -= errX * 0.25;
    errY -= errY * 0.25;
    if (Math.abs(errX) < 2) errX = 0;
    if (Math.abs(errY) < 2) errY = 0;
    return { x: px + errX, y: py + errY, live: live };
  }

  function stats() {
    return {
      max: Math.round(rawMax),
      avg: rawN ? Math.round(rawSum / rawN) : 0,
      n: rawN,
      snapped: snapped,
      tile: C ? C.tileUnits : 256,
    };
  }
  function resetStats() { rawMax = 0; rawSum = 0; rawN = 0; snapped = 0; }

  return { setup, tick, reconcile, view, stop, follow, stats, resetStats,
           isLive: () => live,
           error: () => Math.hypot(errX, errY) };
})();
