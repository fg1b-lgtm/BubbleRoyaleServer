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

  // 한 틱 전 자리.
  //
  // 서버는 30Hz 로 도는데 화면은 60Hz 로 그린다. 틱마다만 자리를 옮기면
  // 한 프레임은 18칸 뛰고 다음 프레임은 제자리라 **덜덜 떠는 것으로 보인다.**
  // 두 자리 사이를 프레임 시간만큼 메워서 그린다
  let ppx = 0, ppy = 0;

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

  // 줄 맞춤. **못 가는데, 줄에 맞으면 갈 수 있을 때만** 당긴다.
  //
  // Movement.h 의 CenterAxis 와 같은 규칙이어야 한다. 여기가 다르면 예측이
  // 서버와 갈려서 매 틱 되돌아간다 — 트인 데서 캐릭터가 밀리는 것으로 보였던
  // 그 버그가, 서버를 고쳐도 여기가 옛날 규칙 그대로면 **화면에서만** 남는다.
  // 실제로 9/3에 서버만 고치고 여기를 안 고쳐서 이 일이 벌어질 뻔했다.
  function centerAxis(tiles, movePos, sidePos, step, movingIsX, speed) {
    if (C.laneSnap <= 0 || step === 0) return sidePos;

    const edge  = (step > 0) ? movePos + speed + HALF : movePos - speed - HALF;
    const ahead = Math.floor(edge / C.tileUnits);

    // 지금 몸이 걸쳐 있는 옆줄들. 하나라도 막혀 있으면 못 간다
    const s0 = Math.floor((sidePos - HALF) / C.tileUnits);
    const s1 = Math.floor((sidePos + HALF) / C.tileUnits);

    let blocked = false;
    for (let s = s0; s <= s1; ++s) {
      const isSolid = movingIsX ? solid(tiles, ahead, s) : solid(tiles, s, ahead);
      if (isSolid) { blocked = true; break; }
    }
    if (!blocked) return sidePos;          // 그냥 갈 수 있다. 손댈 이유가 없다

    // 줄 한가운데였으면 갈 수 있었나. 아니면 그냥 벽이라 당겨봐야 소용없다
    const st = Math.floor(sidePos / C.tileUnits);
    const centerOpen = movingIsX ? !solid(tiles, ahead, st) : !solid(tiles, st, ahead);
    if (!centerOpen) return sidePos;

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
    ppx = px; ppy = py;

    const speed = trapped ? C.trapSpeed
                          : (C.moveBase + speedLv * C.moveStep);

    if (dirX !== 0 && dirY === 0) {
      py = centerAxis(tiles, px, py, dirX * speed, true, speed);
    } else if (dirY !== 0 && dirX === 0) {
      px = centerAxis(tiles, py, px, dirY * speed, false, speed);
    }

    // 9/4 - 서버 쪽(Game.h)에 대각선 보정(diag_speed, 1/√2 ≈ 181/256)을
    // 넣어놓고 여기는 안 고쳤었다. 파일 맨 위에 "한쪽만 고치면 화면과
    // 판이 갈린다"고 스스로 적어놓고 딱 그 실수를 했다 - 화면(여기)은
    // 대각선으로 계속 옛 속도(41% 빠름)로 미리 그리고, 서버 답은 고친
    // 속도로 오니 대각선으로 움직일 때마다 매 틱 어긋나서 그 오차를
    // 녹이느라 화면이 삐걱거렸다. 맵마다 트인 데가 많고 적음에 따라
    // 대각선을 얼마나 쓰게 되는지가 달라서 "어떤 판은 심하고 어떤 판은
    // 괜찮다"로 보인 것이다
    const diagSpeed = (dirX !== 0 && dirY !== 0) ? (speed * 181 / 256 | 0) : speed;
    px = stepAxis(tiles, px, py, dirX * diagSpeed, true);
    py = stepAxis(tiles, py, px, dirY * diagSpeed, false);

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
      px = sx; py = sy; ppx = sx; ppy = sy; live = true;
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
      px = sx; py = sy; ppx = sx; ppy = sy;
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
    px = sx; py = sy; ppx = sx; ppy = sy; live = true;
    errX = 0; errY = 0;
  }

  // 화면에 그릴 자리. 오차를 조금씩 녹여서 튐을 감춘다.
  //
  // alpha 는 마지막 틱 뒤로 얼마나 지났나 (0~1). 두 자리 사이를 메운다.
  // 이게 없으면 60fps 화면에서 30Hz 로만 움직여서 한 프레임씩 건너뛴 것처럼 보인다
  function view(alpha) {
    errX -= errX * 0.25;
    errY -= errY * 0.25;
    if (Math.abs(errX) < 2) errX = 0;
    if (Math.abs(errY) < 2) errY = 0;

    const a = (alpha === undefined) ? 1
            : (alpha < 0 ? 0 : (alpha > 1 ? 1 : alpha));
    return { x: ppx + (px - ppx) * a + errX,
             y: ppy + (py - ppy) * a + errY,
             live: live };
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
