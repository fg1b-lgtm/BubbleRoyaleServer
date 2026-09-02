// web/game.js — 화면을 만들고 한 프레임을 그린다
//
// 그리는 순서가 이 파일의 전부다.
//
//   1) 하늘   판 밖 여백
//   2) 바닥   미리 그려둔 한 장. 벽 그림자까지 구워져 있다
//   3) 물     구역 침수, 차오르는 물, 물결, 물가 포말
//   4) 물줄기 바닥에 깔리는 것이라 벽보다 아래다
//   5) 줄     위에서 아래로 한 줄씩. [그 줄의 벽·상자·아이템] 다음 [그 줄에 발이 닿은 사람]
//   6) 파티클
//   7) 마감   비네트와 색보정
//   8) HUD    판 밖. 흔들림을 안 받는다
//
// 5번이 이 화면의 핵심이다. 아래 줄의 벽이 위 줄의 사람을 가린다.
// 그게 "앞에 있다" 는 뜻이고, 평면 타일 게임과 갈리는 지점이다.

const cv  = document.getElementById('cv');
const ctx = cv.getContext('2d');

let W = 0, H = 0;          // CSS 픽셀 기준 화면 크기
let dpr = 1;

// 미리 그려두는 종이들
let floorCv = null, floorCtx = null;
let rowCv = [];            // 줄마다 한 장. 벽과 상자와 그림자가 들어 있다
let floorDirty = true;
const dirtyRows = new Set();

let foamSegs = [];         // 물가 선분 [ax,ay,bx,by, ...]
let foamKey = '';          // 구역 상태가 바뀔 때만 다시 계산한다

// ── 카메라 ───────────────────────────────────────────────────
//
// 판 전체(45x39)를 보여주다가 9/1 에 **내 구역만** 보여주게 바꿨다.
//
// AOI 가 내 구역 사람만 보내주는데 화면이 판 전체를 보여주면
// 옆 구역 사람이 그냥 사라져서 버그로 보인다.
// **보내는 것과 보이는 것을 같게** 만드는 게 SPEC 3절의 요지다.
//
// 화면은 내 구역(15x13) + 가장자리 밖 세 칸 = 21x19 칸이다.
// 판이 좁아진 만큼 타일이 커져서 캐릭터 얼굴이 보인다. 덤으로 얻은 것이다.
//
// 바깥 세 칸은 안개를 씌운다. 지형은 보이고 사람은 안 보인다.
// "저기가 있다는 건 알지만 누가 있는지는 모른다" 가 그림으로 설명된다
let camSector = 0;
// x0,y0 는 지금 화면이 보고 있는 자리(픽셀). tx,ty 는 가야 할 자리.
// 둘을 나눠두고 매 프레임 조금씩 따라가게 하면 화면이 미끄러지듯 넘어간다
let view = { x0: 0, y0: 0, tx: 0, ty: 0, w: 21, h: 19 };
let noiseCv = null;

// 시간. 멈춤(hit stop) 동안 gameTime 이 안 흐른다
let gameTime = 0, lastFrame = 0, snapAtGame = 0;
let killFeed = [];
let banner = null;
let lastBeep = -1;
let lastPhase = -1;
let danger = false;
let bubbleTiles = new Set();
let killPop = -9999;    // 내가 잡은 순간. HUD 킬 수가 튀어오른다
const pickFlash = {};   // 아이템 종류별로 마지막에 먹은 시각

// ── 한 판의 기록 ─────────────────────────────────────────────
//
// 판이 끝나면 "이겼다" 세 글자로 끝났다. 한 판의 이야기가 통째로 사라진다.
// 내가 몇 등을 했는지, 몇을 잡았는지, 얼마나 버텼는지가 남아야
// 다음 판에 그걸 올리려고 한다.
//
// 서버에 뭘 더 안 물어도 된다. 이벤트가 어차피 전원에게 오므로
// 누가 누구를 잡았고 언제 죽었는지를 화면이 이미 다 보고 있다
let roundStats = new Map();   // id -> {kills, diedTick, place}
let placeNext = 0;            // 죽은 순서. 늦게 죽을수록 좋은 등수다

function statOf(id) {
  let st = roundStats.get(id);
  if (!st) { st = { kills: 0, diedTick: -1, place: 0 }; roundStats.set(id, st); }
  return st;
}

function resetStats() {
  roundStats = new Map();
  placeNext = 0;
}

// 죽은 순서대로 뒤에서부터 등수를 준다.
// 스물넷이 붙었으면 제일 먼저 죽은 사람이 24등이다
function markDead(id) {
  const st = statOf(id);
  if (st.diedTick >= 0) return;      // 이미 죽었다. 두 번 안 센다
  st.diedTick = G.tick;
  st.place = -(++placeNext);         // 나중에 살아 있는 수를 더해 실제 등수로 바꾼다
}

// 판이 끝났다. 살아남은 사람을 앞에 놓고 등수를 매긴다
function finishStats() {
  const total = G.players.size;
  for (const [id, p] of G.players) {
    const st = statOf(id);
    if (st.diedTick < 0) st.place = 1;            // 끝까지 살아 있었다
    else                 st.place = total + 1 + st.place;   // place 가 음수다
  }
}

// 결과표에 올릴 줄. 등수 순으로 정렬해서 돌려준다
function statRows() {
  const rows = [];
  for (const [id, p] of G.players) {
    const st = statOf(id);
    rows.push({
      id,
      place: st.place || 99,
      kills: st.kills,
      alive: !!(G.aliveMask[id >> 3] & (1 << (id & 7))),
      items: (p.bubble_lv || 0) + (p.power_lv || 0) + (p.speed_lv || 0),
      secs: st.diedTick < 0 ? G.tick / G.C.tickRate : st.diedTick / G.C.tickRate,
    });
  }
  rows.sort((a, b) => a.place - b.place);
  return rows;
}

const PLAYER_COLORS = [
  '#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b', '#cc5de8', '#ff922b',
  '#20c997', '#f06595', '#748ffc', '#94d82d', '#ffa8a8', '#66d9e8',
  '#e599f7', '#ffc078', '#63e6be', '#faa2c1', '#a5d8ff', '#d8f5a2',
  '#ffe066', '#b197fc', '#38d9a9', '#ff8787', '#4dd4ac', '#f783ac',
];
const colorOf = (id) => PLAYER_COLORS[id % PLAYER_COLORS.length];

// 어떤 동물인가. 색과 **다른 주기로** 돌린다.
//
// 색 24개 중에는 반드시 비슷한 게 생긴다. 빨강 계열만 넷이다.
// 동물이 8종이고 색이 24가지인데 주기가 다르므로,
// 색이 같은 사람끼리는 동물이 다르고 동물이 같으면 색이 다르다.
//
// 그리고 동물은 **실루엣**이라 안개 너머와 작은 표에서도 읽힌다
const animalOf = (id) => id % 8;

// ── 화면 크기 ────────────────────────────────────────────────
//
// 타일 크기를 화면에 맞춰 고른다. 24 픽셀쯤이 캐릭터 얼굴이 보이는 최소 크기다.
//
// devicePixelRatio 를 곱해서 실제 픽셀로 그린다.
// 이걸 안 하면 고해상도 화면에서 선과 글자가 흐릿해진다.
// 흐릿한 화면은 그 자체로 "덜 만든 것" 처럼 보인다
function resize() {
  if (!G.C) return;

  view.w = G.C.sectorW + G.C.peek * 2;
  view.h = G.C.sectorH + G.C.peek * 2;

  // 화면을 최대한 쓴다. 위에 얇은 띠 하나만 빼고 나머지는 전부 판이다.
  // 캐릭터가 작게 느껴지던 것의 절반이 여기서 풀린다
  const availW = Math.max(360, window.innerWidth  - 16);
  const availH = Math.max(320, window.innerHeight - 34);
  const ts = Math.max(16, Math.min(72,
    Math.floor(Math.min(availW / view.w, availH / view.h))));

  Art.setScale(ts);
  W = view.w * ts;
  H = view.h * ts;

  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width  = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width  = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 미리 그려두는 종이는 **판 전체** 크기다. 화면만 그 일부를 잘라 쓴다
  const mapPxW = G.C.mapW * ts, mapPxH = G.C.mapH * ts;

  floorCv = document.createElement('canvas');
  floorCv.width = Math.round(mapPxW * dpr); floorCv.height = Math.round(mapPxH * dpr);
  floorCtx = floorCv.getContext('2d');
  floorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rowH = Art.V.TOP + ts + Art.V.BOT;
  rowCv = [];
  for (let y = 0; y < G.C.mapH; ++y) {
    const c = document.createElement('canvas');
    c.width = Math.round(mapPxW * dpr); c.height = Math.round(rowH * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    rowCv.push({ cv: c, g });
  }

  // 안개용 잡티. 64x64 한 장을 만들어 두고 타일처럼 깐다.
  // 매 프레임 점을 찍으면 화면이 지글거리고 느리다
  noiseCv = document.createElement('canvas');
  noiseCv.width = 64; noiseCv.height = 64;
  {
    const g = noiseCv.getContext('2d');
    for (let i = 0; i < 900; ++i) {
      const a = Math.random() * 0.10;
      g.fillStyle = 'rgba(200,220,240,' + a.toFixed(3) + ')';
      g.fillRect((Math.random() * 64) | 0, (Math.random() * 64) | 0, 1, 1);
    }
  }

  floorDirty = true;
  for (let y = 0; y < G.C.mapH; ++y) dirtyRows.add(y);
  foamKey = '';
}

function rebuild() {
  if (!G.C || !floorCtx) return;

  // 지울 때는 **판 전체 크기**로 지운다.
  //
  // 카메라를 구역만 보이게 좁히면서 W 가 화면 크기(21칸)가 됐는데,
  // 미리 그려두는 종이는 판 전체(45칸)다. W 로 지우면 왼쪽 21칸만 지워지고
  // 오른쪽은 옛 그림이 그대로 남는다.
  // 그게 "부순 벽이 그대로 보인다" 의 정체였다
  const mw = G.C.mapW * Art.V.TS;
  const mh = G.C.mapH * Art.V.TS;

  if (floorDirty) {
    floorCtx.clearRect(0, 0, mw, mh);
    Art.buildFloor(floorCtx, G.tiles, G.C.mapW, G.C.mapH);
    floorDirty = false;
  }

  if (dirtyRows.size) {
    const rowH = Art.V.TOP + Art.V.TS + Art.V.BOT;
    for (const y of dirtyRows) {
      const r = rowCv[y];
      if (!r) continue;
      r.g.clearRect(0, 0, mw, rowH);
      Art.buildRow(r.g, G.tiles, G.C.mapW, y);
    }
    dirtyRows.clear();
  }
}

// ── 물가 ─────────────────────────────────────────────────────
//
// 물과 마른 땅이 만나는 선을 미리 찾아둔다.
// 경계가 딱 떨어지면 색을 칠한 것이고, 일렁이면 물이 들어온 것이다.
//
// 매 프레임 1755칸을 훑을 이유가 없다. 구역 상태가 바뀔 때만 다시 센다
function rebuildFoam() {
  const key = G.sectors.join('') + (G.ring.on ? G.ring.x0 + ',' + G.ring.y0 + ',' + G.ring.x1 + ',' + G.ring.y1 : '-');
  if (key === foamKey) return;
  foamKey = key;

  const T = Art.V.TS;
  const wet = (x, y) => {
    if (x < 0 || y < 0 || x >= G.C.mapW || y >= G.C.mapH) return true;
    const s = Math.min(2, Math.floor(y / G.C.sectorH)) * 3 + Math.min(2, Math.floor(x / G.C.sectorW));
    if (G.sectors[s] === SECT.FLOODED) return true;
    if (G.ring.on && (x < G.ring.x0 || x > G.ring.x1 || y < G.ring.y0 || y > G.ring.y1)) return true;
    return false;
  };

  foamSegs = [];
  for (let y = 0; y < G.C.mapH; ++y) {
    for (let x = 0; x < G.C.mapW; ++x) {
      if (!wet(x, y)) continue;
      if (!wet(x, y + 1)) foamSegs.push(x * T, (y + 1) * T, (x + 1) * T, (y + 1) * T);
      if (!wet(x, y - 1)) foamSegs.push(x * T, y * T, (x + 1) * T, y * T);
      if (!wet(x - 1, y)) foamSegs.push(x * T, y * T, x * T, (y + 1) * T);
      if (!wet(x + 1, y)) foamSegs.push((x + 1) * T, y * T, (x + 1) * T, (y + 1) * T);
    }
  }
}

// 카메라를 어느 구역에 둘 것인가.
//
// 살아 있으면 내 구역. 죽었으면 아직 살아 있는 사람을 따라간다.
// 죽고 나서 빈 구역을 보고 있으면 관전이 아니라 정지 화면이다.
//
// 경계에서 화면이 덜덜 떨리지 않게 히스테리시스를 둔다.
// 판정 칸은 경계를 넘는 순간 바뀌는데, 카메라까지 그러면
// 경계에 서서 조금만 움직여도 화면이 왔다 갔다 한다
// 관전할 때 누구를 보고 있나. 살아 있는 사람 목록에서의 자리다.
//
// 죽으면 '살아 있는 첫 사람' 을 그냥 따라갔다. 그 사람이 재미없는 데 있으면
// 판이 끝날 때까지 그것만 본다. 방송을 보는 게 아니라 남의 화면을 뺏어 보는 것이다.
// 좌우 키로 넘긴다
let specAt = 0;

function aliveList() {
  const out = [];
  for (const [id, p] of G.players) {
    if ((p.flags & PF.ALIVE) && p.visible !== false) out.push(id);
  }
  out.sort((a, b) => a - b);   // 순서가 매 프레임 바뀌면 화면이 튄다
  return out;
}

function specShift(step) {
  const list = aliveList();
  if (!list.length) return;
  specAt = ((specAt + step) % list.length + list.length) % list.length;
  specId = list[specAt];
}

let specId = -1;

function updateCamera(dt) {
  const me = G.players.get(G.myId);
  let target = (me && (me.flags & PF.ALIVE)) ? me : null;

  if (!target) {
    // 관전. 고른 사람이 죽었으면 목록에서 다음 사람으로 넘어간다
    const list = aliveList();
    if (!list.length) return;

    let i = list.indexOf(specId);
    if (i < 0) { i = Math.min(specAt, list.length - 1); specId = list[i]; }
    specAt = i;

    target = G.players.get(specId);
  }
  if (!target) return;

  const T  = Art.V.TS;
  const sw = G.C.sectorW, sh = G.C.sectorH;

  // **발을 들인 순간 바로 바꾼다.**
  //
  // 처음에는 경계를 두 칸 넘어야 바뀌게 했다(히스테리시스). 화면이 안 떨리라고.
  // 그런데 그러면 구역을 넘었는데도 화면이 안 따라와서, 이미 새 구역에 서 있는데
  // 옛 구역을 보고 있게 된다. 그 사이에 안 보이는 사람에게 맞는다.
  //
  // 떨림은 다른 방법으로 막는다. 목표만 즉시 바꾸고 **화면은 미끄러지듯 따라간다.**
  // 경계에서 왔다 갔다 해도 화면이 부드럽게 흔들릴 뿐 깜빡이지 않는다
  const sx = Math.min(2, Math.floor(target.jtx / sw));
  const sy = Math.min(2, Math.floor(target.jty / sh));
  camSector = sy * 3 + sx;

  view.tx = Math.max(0, Math.min(G.C.mapW - view.w, sx * sw - G.C.peek)) * T;
  view.ty = Math.max(0, Math.min(G.C.mapH - view.h, sy * sh - G.C.peek)) * T;

  // 목표까지 남은 거리의 일정 비율씩 좁힌다.
  // 한 프레임에 정해진 픽셀만큼 가게 하면 프레임이 흔들릴 때 속도가 달라진다.
  // 비율로 좁히면 처음엔 빠르고 도착할수록 느려져서 저절로 감속이 붙는다
  const k = 1 - Math.pow(0.001, dt / 1000);   // 1초면 99.9% 따라간다
  view.x0 += (view.tx - view.x0) * k;
  view.y0 += (view.ty - view.y0) * k;

  // 반 픽셀 남았으면 붙여버린다. 안 그러면 영원히 조금씩 남아서 흐릿하게 그려진다
  if (Math.abs(view.tx - view.x0) < 0.5) view.x0 = view.tx;
  if (Math.abs(view.ty - view.y0) < 0.5) view.y0 = view.ty;
}

// ── 한 프레임 ────────────────────────────────────────────────
function frame(ts) {
  requestAnimationFrame(frame);
  if (!G.C || !floorCtx) return;

  const dt = Math.min(64, ts - lastFrame);
  lastFrame = ts;

  // 멈춤. 사람을 잡은 순간 아주 잠깐 시간이 안 흐른다.
  // 맞은 게 아니라 맞혔다는 걸 몸으로 알리는 장치다
  if (!FX.frozen(ts)) gameTime += dt;

  rebuild();
  rebuildFoam();
  updateCamera(dt);
  drawWorld(gameTime, dt);
  drawHUD(gameTime);
}

function drawWorld(now, dt) {
  const T = Art.V.TS;
  const th = Art.V.world;

  ctx.fillStyle = th.sky;
  ctx.fillRect(0, 0, W, H);

  FX.apply(ctx, now, W, H, dt);

  // 여기서부터는 **판 좌표**로 그린다. 카메라만큼 옮겨두면
  // 아래 코드는 화면이 어디를 보고 있는지 몰라도 된다
  ctx.save();
  ctx.translate(-Math.round(view.x0), -Math.round(view.y0));

  ctx.drawImage(floorCv, 0, 0, G.C.mapW * T, G.C.mapH * T);

  // ── 물 ─────────────────────────────────────────────────────
  for (let s = 0; s < 9; ++s) {
    const sx = (s % 3) * G.C.sectorW * T;
    const sy = Math.floor(s / 3) * G.C.sectorH * T;
    const w  = G.C.sectorW * T, h = G.C.sectorH * T;

    if (G.sectors[s] === SECT.FLOODED) {
      Art.water(ctx, sx, sy, w, h, now);
    }
    else if (G.sectors[s] === SECT.WARNING) {
      // 예고를 붉은 테두리로만 하면 그건 UI 다.
      // 비가 내리기 시작하면 그건 세계에서 일어나는 일이 된다
      if (Math.random() < 0.55) FX.rain(sx, sy, w, h, T, now, 2);

      const beat = 0.5 + 0.5 * Math.sin(now / 150);
      ctx.fillStyle = 'rgba(20,60,110,' + (0.05 + 0.05 * beat) + ')';
      ctx.fillRect(sx, sy, w, h);

      // 위험 표시. 빗금이 흐른다
      ctx.save();
      ctx.beginPath(); ctx.rect(sx, sy, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(255,90,70,' + (0.18 + 0.20 * beat) + ')';
      ctx.lineWidth = 3;
      ctx.strokeRect(sx + 2, sy + 2, w - 4, h - 4);
      ctx.restore();
    }
  }

  // 최종 구역 안에서 차오르는 물. 안전한 사각형 바깥이 전부 물이다
  if (G.ring.on) {
    const x0 = G.ring.x0 * T, y0 = G.ring.y0 * T;
    const x1 = (G.ring.x1 + 1) * T, y1 = (G.ring.y1 + 1) * T;
    Art.water(ctx, 0, 0, W, y0, now);
    Art.water(ctx, 0, y1, W, H - y1, now);
    Art.water(ctx, 0, y0, x0, y1 - y0, now);
    Art.water(ctx, x1, y0, W - x1, y1 - y0, now);
  }

  Art.foamEdge(ctx, foamSegs, now);

  // ── 물줄기 ─────────────────────────────────────────────────
  //
  // **어디까지 닿는지가 한눈에 보여야 한다.** 그게 이 그림의 유일한 임무다.
  //
  // 처음에는 칸마다 둥근 빛을 퍼뜨렸다. 예뻤는데 빛이 칸 밖으로 새서
  // 실제 사거리보다 넓어 보였다. 어디까지 위험한지를 못 읽으면 그건 연출이 아니라 방해다.
  //
  // 그래서 **칸에 딱 맞게** 칠하고, 물줄기끼리 안 닿는 쪽에만 테두리를 긋는다.
  // 그러면 십자 전체가 윤곽선 하나로 둘러싸여서 모양이 그대로 읽힌다.
  G.blasts = G.blasts.filter(b => b.until > now);
  if (G.blasts.length) {
    const total = (G.C.blast / G.C.tickRate) * 1000;
    const hit = new Set();
    for (const b of G.blasts) hit.add(b.x + ',' + b.y);

    for (const b of G.blasts) {
      const age = Math.max(0, Math.min(1, 1 - (b.until - now) / total));
      const heat = Math.max(0, 1 - age * 3);      // 앞의 1/3 만 하얗게 탄다

      // **맞는 동안은 계속 진해야 한다.**
      //
      // 처음에는 시간에 비례해 옅어지게 했다. 그랬더니 아직 맞는데 안전해 보였다.
      // 물이 옅어지는 걸 보고 들어갔다가 맞으면 그건 난이도가 아니라 거짓말이다.
      // 그래서 70% 까지는 그대로 두고 마지막 30% 에서만 빠르게 사라진다
      const fade = age < 0.7 ? 0 : (age - 0.7) / 0.3;
      const px = b.x * T, py = b.y * T;

      const g = ctx.createLinearGradient(px, py, px, py + T);
      g.addColorStop(0,   'rgba(' + (150 + heat * 105) + ',' + (215 + heat * 40) + ',255,' + (0.82 - fade * 0.75) + ')');
      g.addColorStop(1,   'rgba(' + (60 + heat * 90)  + ',' + (150 + heat * 80) + ',235,' + (0.72 - fade * 0.68) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(px, py, T, T);

      // 물줄기가 안 이어지는 쪽에만 밝은 선. 십자 바깥 윤곽만 남는다
      ctx.fillStyle = 'rgba(235,250,255,' + (0.90 - fade * 0.85) + ')';
      const e = Math.max(1.5, T * 0.09);
      if (!hit.has(b.x + ',' + (b.y - 1))) ctx.fillRect(px, py, T, e);
      if (!hit.has(b.x + ',' + (b.y + 1))) ctx.fillRect(px, py + T - e, T, e);
      if (!hit.has((b.x - 1) + ',' + b.y)) ctx.fillRect(px, py, e, T);
      if (!hit.has((b.x + 1) + ',' + b.y)) ctx.fillRect(px + T - e, py, e, T);
    }
  }

  // ── 줄 정렬 ────────────────────────────────────────────────
  //
  // 사람과 물풍선을 발이 닿은 줄로 나눠 담고, 줄 그림 사이에 끼워 그린다
  const rows = G.C.mapH;
  const bucketP = new Array(rows), bucketB = new Array(rows);
  for (let i = 0; i < rows; ++i) { bucketP[i] = null; bucketB[i] = null; }

  const alpha = Math.min(1, (now - snapAtGame) / G.snapInterval);

  for (const [id, p] of G.players) {
    if (p.visible === false) continue;   // AOI 로 안 온 사람. 기억만 있고 지금은 안 보인다
    const py = p.y0 + (p.y1 - p.y0) * alpha;
    const r = Math.max(0, Math.min(rows - 1, Math.floor(py / G.C.tileUnits)));
    (bucketP[r] || (bucketP[r] = [])).push([id, p]);
  }
  for (const b of G.bubbles) {
    const r = Math.max(0, Math.min(rows - 1, b.ty));
    (bucketB[r] || (bucketB[r] = [])).push(b);
  }

  const rowH = Art.V.TOP + T + Art.V.BOT;
  const me = G.players.get(G.myId);

  // 화면에 안 걸치는 줄은 건너뛴다. 39줄이 아니라 20줄만 그린다
  const yStart = Math.max(0, Math.floor(view.y0 / T) - 1);
  const yEnd   = Math.min(rows, Math.ceil(view.y0 / T) + view.h + 1);

  for (let y = yStart; y < yEnd; ++y) {
    ctx.drawImage(rowCv[y].cv, 0, y * T - Art.V.TOP, G.C.mapW * T, rowH);

    // 아이템은 벽보다 앞, 사람보다 뒤
    for (let x = 0; x < G.C.mapW; ++x) {
      const it = G.items[y][x];
      if (it !== ITEM.NONE) Art.drawItem(ctx, x * T + T / 2, y * T + T / 2, T, it, now);
    }

    const bs = bucketB[y];
    if (bs) for (const b of bs) {
      const near = b.fuse < G.C.tickRate * 0.5;
      Art.drawBubble(ctx, b.tx * T + T / 2, b.ty * T + T / 2, T * 0.40, near, now,
                     b.owner === 0xFF ? null : colorOf(b.owner));
    }

    const ps = bucketP[y];
    if (ps) for (const [id, p] of ps) {
      // 죽은 사람은 안 그린다.
      //
      // 전에는 흐리게 남겨뒀는데 판 위에 유령이 늘어서 거슬렸다.
      // 죽었으면 없는 것이다. 어디서 죽었는지는 킬 피드가 말해준다
      if (!(p.flags & PF.ALIVE)) continue;
      drawPlayer(id, p, alpha, now, T);
    }
  }

  FX.draw(ctx, now);

  // ── 안개 ───────────────────────────────────────────────────
  //
  // 내 구역 바깥 세 칸. 지형은 보이고 사람은 안 보인다.
  // 서버가 거기 사람을 안 보내주므로 **안 보이는 게 맞다.**
  // 안개를 씌우면 그게 규칙이 아니라 날씨처럼 보인다
  {
    const sw = G.C.sectorW * T, sh = G.C.sectorH * T;
    const sx = (camSector % 3) * sw;
    const sy = ((camSector / 3) | 0) * sh;

    ctx.save();
    ctx.beginPath();
    ctx.rect(view.x0, view.y0, view.w * T, view.h * T);
    ctx.rect(sx, sy, sw, sh);
    ctx.clip('evenodd');

    ctx.fillStyle = 'rgba(150,175,200,0.30)';
    ctx.fillRect(view.x0, view.y0, view.w * T, view.h * T);

    // 천천히 흐르는 안개 덩어리 둘
    for (let i = 0; i < 2; ++i) {
      const t2 = now / (i ? 9000 : 6000) + i * 2;
      const gx = sx + sw * (0.5 + Math.cos(t2) * 0.9);
      const gy = sy + sh * (0.5 + Math.sin(t2 * 0.8) * 0.9);
      const g2 = ctx.createRadialGradient(gx, gy, 0, gx, gy, sw * 0.5);
      g2.addColorStop(0, 'rgba(200,215,235,0.18)');
      g2.addColorStop(1, 'rgba(200,215,235,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(view.x0, view.y0, view.w * T, view.h * T);
    }

    // 잡티. 미리 만들어둔 64x64 를 타일처럼 깐다
    if (noiseCv) {
      const pat = ctx.createPattern(noiseCv, 'repeat');
      if (pat) {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = pat;
        ctx.fillRect(view.x0, view.y0, view.w * T, view.h * T);
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();

    // 내가 아는 데의 경계
    ctx.strokeStyle = 'rgba(190,225,255,0.30)';
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, sw - 2, sh - 2);
  }

  ctx.restore();   // 카메라 되돌리기. 여기부터는 다시 화면 좌표다

  // ── 마감 ───────────────────────────────────────────────────
  //
  // 비네트와 색보정. 아주 약하게.
  // 이 두 겹이 "따로 그린 것들" 을 한 장의 그림처럼 묶어준다
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.30,
                                      W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = th.gradeAmt;
  ctx.fillStyle = th.grade;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // 내가 위험하다. 화면 가장자리가 붉어진다.
  // 숫자나 글자로 알리면 싸우는 중에 못 본다
  if (me && (me.flags & PF.DROWNING)) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 120);
    const eg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28,
                                        W / 2, H / 2, Math.max(W, H) * 0.62);
    eg.addColorStop(0, 'rgba(200,40,40,0)');
    eg.addColorStop(1, 'rgba(200,40,40,' + (0.25 + 0.25 * pulse) + ')');
    ctx.fillStyle = eg;
    ctx.fillRect(0, 0, W, H);
  }

  FX.drawFlash(ctx, now, W, H);
  FX.done(ctx);
}

function drawPlayer(id, p, alpha, now, T) {
  const px = (p.x0 + (p.x1 - p.x0) * alpha) / G.C.tileUnits * T;
  const py = (p.y0 + (p.y1 - p.y0) * alpha) / G.C.tileUnits * T;
  const dead = !(p.flags & PF.ALIVE);
  const r = T * G.C.bodyNum / G.C.bodyDen / 2;

  // 판정 칸을 그리던 자리.
  //
  // 걸치기를 눈에 보이게 하려고 사람마다 흰 네모를 하나씩 그렸는데,
  // 스물넷이 돌아다니면 화면에 흰 네모가 스물넷 깜빡인다. 판이 지저분해진다.
  // 걸치기는 몸이 두 칸에 걸친 것으로 이미 보인다. 네모는 뺀다

  // 내 캐릭터 발밑에만 고리. 스물넷이 엉키면 색만으로는 내가 어디 있는지 못 찾는다
  if (id === G.myId && !dead) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 400);
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.3 * pulse) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px, py + r * 0.95, r * (1.0 + 0.06 * pulse), r * 0.38, 0, 0, 7);
    ctx.stroke();
  }

  // 걸을 때 발밑에서 먼지가 인다. 물 위면 파문이 퍼진다
  if (p.moving && !dead && p.stepped !== p.lastStep) {
    p.lastStep = p.stepped;
    const wet = inWater(p.jtx, p.jty);
    if (wet) FX.ripple(px, py + r * 0.9, T, now);
    else     FX.step(px, py + r * 0.9, T, now);

    // 밟는 것에 따라 소리가 다르다. 물에 잠긴 칸이면 재료보다 물이 먼저다.
    // 화면이 이미 아는 것(어느 장소의 어느 칸인가)을 소리에 넘기기만 하면 된다
    if (id === G.myId) {
      Sound.step(panOf(px), wet ? 'water' : Art.placeAt(p.jtx, p.jty).step);
    }
  }

  ctx.globalAlpha = dead ? 0.20
                  : ((p.flags & PF.INVULN) && (now / 80 | 0) % 2 ? 0.4 : 1);

  Art.drawChar(ctx, px, py, r, colorOf(id), {
    face: p.face | 0,
    animal: animalOf(id),
    moving: !!p.moving && !dead,
    walk: p.walk || 0,
    t: now,
    danger: id === G.myId ? danger : false,
  });

  // 갇힘. 물방울이 통째로 씌워진다.
  // 글자를 안 쓴다. 갇혔다는 건 이 그림 하나로 다 보인다
  if (p.flags & PF.TRAPPED) {
    const wob = Math.sin(now / 140) * 0.07;
    const g = ctx.createRadialGradient(px - r * 0.4, py - r * 0.55, r * 0.2, px, py, r * 1.45);
    g.addColorStop(0, 'rgba(255,255,255,0.40)');
    g.addColorStop(0.7, 'rgba(140,210,255,0.28)');
    g.addColorStop(1, 'rgba(80,170,240,0.42)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, py - r * 0.1, r * (1.30 + wob), r * (1.30 - wob), 0, 0, 7);
    ctx.fill();

    ctx.strokeStyle = 'rgba(215,245,255,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(px - r * 0.52, py - r * 0.68, r * 0.24, r * 0.15, -0.6, 0, 7);
    ctx.fill();
  }

  ctx.globalAlpha = 1;

  // 물에 잠긴 데 서 있다. 숨방울이 올라가고 **머리 위에 남은 시간이 뜬다.**
  //
  // 숨방울만으로는 "위험하다" 까지만 전해지고 "몇 초 남았나" 를 모른다.
  // 2초 안에 못 나가면 죽는데 그 2초가 안 보이면 도망칠지 버틸지를 못 정한다.
  // 판 위에 글자를 안 쓴다는 규칙의 유일한 예외다. 여기는 숫자가 정보 그 자체다
  if (p.flags & PF.DROWNING) {
    for (let i = 0; i < 3; ++i) {
      const t = ((now / 650) + i / 3) % 1;
      ctx.globalAlpha = (1 - t) * 0.9;
      ctx.fillStyle = '#a8dcff';
      ctx.beginPath();
      ctx.arc(px + Math.sin(t * 6 + i * 2) * T * 0.2,
              py - r * 1.3 - t * T * 1.0,
              T * 0.10 * (1 - t * 0.5), 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const left = drownLeft(p);
    if (left !== null) {
      const bar = Math.max(0, Math.min(1, left / (G.C.floodEsc / G.C.tickRate)));
      const bw = T * 1.5, bh = Math.max(3, T * 0.16);
      const bx = px - bw / 2, by = py - r * 2.1;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      Art.rr(ctx, bx - 1, by - 1, bw + 2, bh + 2, 2); ctx.fill();
      ctx.fillStyle = bar > 0.4 ? '#ff9f43' : '#ff4d4d';
      ctx.fillRect(bx, by, bw * bar, bh);

      ctx.font = '800 ' + Math.round(T * 0.62) + 'px system-ui';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(left.toFixed(1), px, by - T * 0.20);
      ctx.fillStyle = '#fff';
      ctx.fillText(left.toFixed(1), px, by - T * 0.20);
      ctx.textAlign = 'left';
    }
  }
}

// 물에 빠진 지 얼마나 됐나. 남은 초를 돌려준다. 안 빠졌으면 null.
//
// 서버가 남은 틱을 따로 안 보낸다. 보낼 수도 있지만 사람마다 매 틱 한 바이트씩
// 늘어나는데, 클라이언트가 스스로 셀 수 있는 값이다.
// 잠긴 순간의 틱만 적어두면 그 뒤는 뺄셈이다. 서버도 같은 틱으로 세므로 값이 같다
function drownLeft(p) {
  if (p.drownFrom === undefined) return null;
  const gone = (G.tick - p.drownFrom) / G.C.tickRate;
  const left = G.C.floodEsc / G.C.tickRate - gone;
  return Math.max(0, left);
}

function inWater(tx, ty) {
  const s = Math.min(2, Math.floor(ty / G.C.sectorH)) * 3 + Math.min(2, Math.floor(tx / G.C.sectorW));
  if (G.sectors[s] === SECT.FLOODED) return true;
  if (G.ring.on && (tx < G.ring.x0 || tx > G.ring.x1 || ty < G.ring.y0 || ty > G.ring.y1)) return true;
  return false;
}

// 화면에서 난 자리를 좌우 어디로 들리게 할지
function panOf(px) { return Math.max(-1, Math.min(1, (px / W) * 2 - 1)) * 0.8; }

// 소리가 얼마나 멀리서 나나. 0 이면 화면 밖, 1 이면 바로 옆.
//
// 9/2 까지 좌우만 있고 멀고 가까움이 없었다. 옆 구역에서 터진 폭발이
// **내 옆에서 터진 것과 똑같은 크기로** 들렸다. 그러면 소리가 상황을 못 알려준다.
// AOI 가 가장자리 밖 세 칸까지 보내주므로 화면 밖 소리도 실제로 온다.
//
// 화면 한가운데를 나로 친다. 내가 죽어 관전 중이면 보고 있는 사람이 가운데다.
// 멀수록 작아지고, 벽 너머라 높은 음이 먼저 죽는다. 그래서 잘라내는 대역도 같이 준다
function farOf(cx, cy) {
  const T = Art.V.TS;
  const mx = view.x0 + (view.w * T) / 2;
  const my = view.y0 + (view.h * T) / 2;

  const d = Math.hypot(cx - mx, cy - my) / (view.w * T * 0.5);
  const near = Math.max(0, 1 - d * 0.85);

  return {
    gain: 0.25 + near * 0.75,          // 아주 멀어도 완전히 안 사라진다
    cut: 1200 + near * 12000,          // 멀면 둔탁하게. 벽을 넘어온 소리다
  };
}

// ── HUD ──────────────────────────────────────────────────────
//
// 판 위에는 글자를 안 쓴다. 그래서 읽을 것은 전부 여기 모인다.
//
// 브라우저 기본 글꼴로 왼쪽 위에 늘어놓으면 그건 개발자 도구지 게임이 아니다.
// 판때기를 깔고, 크기로 위아래를 나누고, 숫자는 크게, 이름표는 작고 넓게 쓴다
function panel(x, y, w, h, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  Art.rr(ctx, x + 1, y + 2, w, h, r); ctx.fill();

  ctx.fillStyle = 'rgba(10,15,22,0.72)';
  Art.rr(ctx, x, y, w, h, r); ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1;
  Art.rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke();
}

function label(text, x, y, size, color, align, spacing) {
  ctx.save();
  ctx.font = '600 ' + size + 'px "Pretendard", "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  try { ctx.letterSpacing = (spacing || 0) + 'px'; } catch (e) {}
  ctx.fillText(text, x, y);
  ctx.restore();
}

function bigNum(text, x, y, size, color, align) {
  ctx.save();
  ctx.font = '800 ' + size + 'px "Pretendard", "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawHUD(now) {
  const T = Art.V.TS;

  // ── 위쪽 띠 ────────────────────────────────────────────────
  //
  // 9/2 까지 라벨이 ROUND / KILL / SLOT / TIME 이었다. 판 밖이라 글자를 써도 되지만,
  // **영어를 쓸 이유는 없었다.** 그냥 안 고쳤던 것이다.
  //
  // 고치면서 세 갈래로 나눴다.
  //   자명한 것은 라벨을 뺀다   0:07 은 시간 말고 읽을 게 없다
  //   숫자에 붙는 것은 단위로   '2 판', '3 처치' 처럼 숫자 뒤에 붙인다
  //   뜻이 없는 것은 지운다     칸 스물넷 위의 SLOT 은 아무 말도 안 하고 있었다
  panel(10, 10, 132, 44, 8);
  // 숫자 폭을 measureText 로 재면 그 순간 걸린 글꼴에 따라 달라진다.
  // bigNum 이 save/restore 안에서 글꼴을 바꾸므로 밖에서 잰 값은 못 믿는다.
  // 자릿수로 자리를 잡는다. 판 번호는 한두 자리다
  // 라벨은 숫자 **위**에 작게 둔다.
  // 한 줄에 나란히 놓아봤더니 숫자가 커질 때 라벨을 덮었다. 자릿수를 못 재기 때문이다
  label('판', 22, 28, 10, 'rgba(255,255,255,0.45)', 'left', 2);
  bigNum(String(G.roundNo + 1), 22, 48, 20, '#fff');

  const phaseName = ['대기', '시작', '진행', '결과'][G.phase] || '';
  label(phaseName, 128, 48, 12, 'rgba(255,255,255,0.55)', 'right');

  // 남은 사람. 숫자 하나가 제일 크다. 이 게임에서 제일 중요한 숫자다
  // 패널을 넓혔다. 칸 스물넷이 오른쪽 절반을 통째로 쓰므로
  // 좁게 두면 숫자와 칸이 겹친다
  panel(W / 2 - 110, 10, 220, 44, 8);
  bigNum(String(G.aliveCount), W / 2 - 62, 44, 26, '#fff', 'right');
  label('생존', W / 2 - 54, 44, 13, 'rgba(255,255,255,0.55)');

  // 누가 살아 있나. 칸 스물넷. 내 칸만 하얗다.
  // 숫자만 있으면 몇인지는 알아도 누가 남았는지는 모른다
  {
    const n = 24, pw = 3, gap = 1.2;
    const total = n * pw + (n - 1) * gap;
    let x = W / 2 + 100 - total;
    for (let i = 0; i < n; ++i) {
      // 서버가 보내준 전역 마스크를 쓴다. 내 구역 사람만 보고 그리면
      // 옆 구역 사람이 전부 죽은 것처럼 보인다
      const alive = !!(G.aliveMask[i >> 3] & (1 << (i & 7)));
      const known = alive || roundStats.has(i) || G.players.has(i);
      ctx.fillStyle = !known ? 'rgba(255,255,255,0.08)'
                    : alive ? (i === G.myId ? '#ffffff' : colorOf(i))
                    : 'rgba(255,255,255,0.14)';
      ctx.fillRect(x, 22, pw, alive ? 11 : 5);
      x += pw + gap;
    }
  }

  // 내가 몇을 잡았나. 잡는 순간 튀어오른다.
  //
  // 킬이 밋밋했던 이유 중 하나가 **숫자가 안 오르는 것**이었다.
  // 뭘 했는지가 어디에도 안 남으면 한 게 아닌 것 같다
  {
    const kills = statOf(G.myId).kills;
    const pop = Math.max(0, 1 - (now - killPop) / 450);

    panel(W / 2 - 110 - 72, 10, 66, 44, 8);
    label('처치', W / 2 - 110 - 60, 28, 10, 'rgba(255,255,255,0.45)', 'left', 2);

    ctx.save();
    ctx.translate(W / 2 - 110 - 18, 48);
    const k = 1 + Art.overshoot(Math.min(1, pop * 2)) * 0.5 * pop;
    ctx.scale(k, k);
    bigNum(String(kills), 0, 0, 20, pop > 0 ? '#ffd166' : '#fff', 'right');
    ctx.restore();
  }

  // 시각. 침수 일정이 몇 분에 오는지가 이 숫자로만 읽힌다
  {
    const sec = Math.floor(G.tick / G.C.tickRate);
    const mm = String(Math.floor(sec / 60));
    const ss = String(sec % 60).padStart(2, '0');
    // 시간은 라벨이 없다. mm:ss 를 시간 말고 다르게 읽을 방법이 없다.
    // 라벨이 빠진 만큼 숫자를 패널 가운데에 놓는다
    panel(W - 106, 10, 96, 44, 8);
    bigNum(mm + ':' + ss, W - 20, 42, 22, '#fff', 'right');
  }

  // ── 내 능력치 ──────────────────────────────────────────────
  //
  // 숫자만 적으면 몇 개인지는 알아도 상한까지 얼마 남았는지를 모른다.
  // 칸으로 그리면 둘 다 한눈에 보인다
  // 내가 뭘 들고 있는지가 **제일 크게** 보여야 한다.
  //
  // 전에는 아래 구석에 작은 칸으로 그렸다. 싸우는 중에 그걸 볼 여유가 없어서
  // 자기가 뭘 먹었는지도 모르고 끝났다.
  //
  // 그래서 아이템 그림을 판에서 쓰는 것과 **똑같이** 그리고, 숫자를 크게 붙인다.
  // 먹은 직후에는 그 칸이 튀어오르고 밝아진다. 뭘 먹었는지가 그 순간 보인다
  const me = G.players.get(G.myId);
  if (me) {
    const cell = 62, gap = 8;
    const bw = cell * 3 + gap * 4, bh = 68;
    const bx = (W - bw) / 2, by = H - bh - 10;
    panel(bx, by, bw, bh, 10);

    // 시작값도 상한도 서버가 준 것을 쓴다. 여기 숫자를 적어두면
    // 상수를 바꾼 날 화면만 거짓말을 하게 된다
    const stats = [
      { kind: ITEM.BUBBLE, c: '#4dabf7',
        v: G.C.baseBubble + me.bubble_lv, max: G.C.capBubble, t: '물풍선' },
      { kind: ITEM.POWER,  c: '#ff922b',
        v: G.C.baseRange  + me.power_lv,  max: G.C.capRange,  t: '물줄기' },
      { kind: ITEM.ROLLER, c: '#51cf66',
        v: me.speed_lv,                   max: G.C.capSpeed,  t: '속도'   },
    ];

    stats.forEach((st, i) => {
      const x = bx + gap + i * (cell + gap);
      const flash = Math.max(0, 1 - (now - (pickFlash[st.kind] || -9999)) / 500);

      if (flash > 0) {
        ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.16) + ')';
        Art.rr(ctx, x - 2, by + 4, cell + 4, bh - 8, 7); ctx.fill();
      }

      // 판에서 쓰는 것과 같은 그림. 같은 걸 봐야 연결이 된다
      ctx.save();
      ctx.translate(x + cell / 2, by + 22);
      const k = 1 + flash * 0.35;
      ctx.scale(k, k);
      Art.drawItem(ctx, 0, 0, 30, st.kind, now);
      ctx.restore();

      bigNum(String(st.v), x + cell / 2, by + 50, 19,
             flash > 0 ? '#ffffff' : st.c, 'center');
      // 판때기를 6px 키우고 글자를 그 안으로 넣는다.
      // 처음엔 글자만 위로 올렸다가 숫자와 겹쳤다. 자리가 없으면 자리를 만들어야 한다
      label(st.t, x + cell / 2, by + bh - 7, 9, 'rgba(255,255,255,0.45)', 'center', 1);

      // 상한까지 얼마 남았나. 가는 선으로만
      for (let m = 0; m < st.max; ++m) {
        ctx.fillStyle = m < st.v ? st.c : 'rgba(255,255,255,0.14)';
        ctx.fillRect(x + 6 + m * ((cell - 12) / st.max), by + 6,
                     (cell - 12) / st.max - 2, 3);
      }
    });
  }

  // ── 미니맵 ─────────────────────────────────────────────────
  //
  // 지금은 판이 다 보이니 없어도 된다. 9/3 에 AOI 를 붙이면 화면이 한 구역으로
  // 좁아진다. 그때 어디가 잠겼는지 못 보면 도망칠 방향을 못 정한다
  {
    const cell = 17, gap = 3, pad = 10;
    const mw = 3 * cell + 2 * gap;
    const mx = W - mw - pad - 10, my = H - mw - pad - 10;

    panel(mx - pad, my - pad, mw + pad * 2, mw + pad * 2, 8);

    for (let s = 0; s < 9; ++s) {
      const gx = mx + (s % 3) * (cell + gap);
      const gy = my + Math.floor(s / 3) * (cell + gap);
      const st = G.sectors[s];

      ctx.fillStyle = st === SECT.FLOODED ? '#16496f'
                    : st === SECT.WARNING
                      ? ((now / 180 | 0) % 2 ? '#8a2f26' : '#3a201c')
                      : 'rgba(255,255,255,0.14)';
      Art.rr(ctx, gx, gy, cell, cell, 3); ctx.fill();
    }

    for (const [id, p] of G.players) {
      if (!(p.flags & PF.ALIVE) || p.visible === false) continue;
      const s = Math.min(2, Math.floor(p.jty / G.C.sectorH)) * 3
              + Math.min(2, Math.floor(p.jtx / G.C.sectorW));
      const gx = mx + (s % 3) * (cell + gap) + cell / 2;
      const gy = my + Math.floor(s / 3) * (cell + gap) + cell / 2;

      ctx.fillStyle = (id === G.myId) ? '#fff' : colorOf(id);
      ctx.beginPath();
      ctx.arc(gx + (id % 3 - 1) * 4, gy + ((id / 3 | 0) % 3 - 1) * 4,
              id === G.myId ? 3 : 1.8, 0, 7);
      ctx.fill();
    }
  }

  // ── 킬 피드 ────────────────────────────────────────────────
  killFeed = killFeed.filter(k => now - k.born < 5200);
  for (let i = 0; i < killFeed.length; ++i) {
    const k = killFeed[i];
    const t = (now - k.born) / 5200;
    const slide = Art.easeOut(Math.min(1, (now - k.born) / 220));

    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - t) * 3);
    const y = 66 + i * 30;
    const x = W - 10 - 150 + (1 - slide) * 40;

    panel(x, y, 150, 26, 5);
    Art.drawFace(ctx, x + 18, y + 14, 7, colorOf(k.killer), animalOf(k.killer));
    label('P' + k.killer, x + 30, y + 18, 11, '#fff');
    label('▸', x + 66, y + 18, 12, 'rgba(255,255,255,0.4)');
    Art.drawFace(ctx, x + 92, y + 14, 7, colorOf(k.victim), animalOf(k.victim));
    ctx.globalAlpha *= 0.7;
    label('P' + k.victim, x + 104, y + 18, 11, 'rgba(255,255,255,0.9)');
    ctx.restore();
  }

  // ── 침수 예고 띠 ───────────────────────────────────────────
  if (banner && banner.until > now) {
    const t = 1 - (banner.until - now) / banner.life;
    const inn = Art.easeOut(Math.min(1, (now - (banner.until - banner.life)) / 200));
    const h = 34;
    const y = 66;

    ctx.save();
    ctx.globalAlpha = Math.min(1, (1 - t) * 4) * inn;

    const g = ctx.createLinearGradient(0, y, W, y);
    g.addColorStop(0, 'rgba(150,30,20,0)');
    g.addColorStop(0.5, 'rgba(170,40,25,0.88)');
    g.addColorStop(1, 'rgba(150,30,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, h);

    // 흐르는 빗금. 위험 표시는 움직여야 위험해 보인다
    ctx.save();
    ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 10;
    for (let x = -h; x < W + h; x += 26) {
      const off = (now / 22) % 26;
      ctx.beginPath();
      ctx.moveTo(x + off, y + h); ctx.lineTo(x + off + h, y);
      ctx.stroke();
    }
    ctx.restore();

    label(banner.text, W / 2, y + 22, 15, '#fff', 'center', 1);
    ctx.restore();
  }

  // ── 판의 단계 ──────────────────────────────────────────────
  if (G.phase === PHASE.COUNTDOWN) {
    const left = Math.max(1, Math.ceil((G.C.tickRate * 3 - G.phaseTicks) / G.C.tickRate));
    const inSec = (G.phaseTicks % G.C.tickRate) / G.C.tickRate;

    scrim(0.40);

    // 숫자가 튀어나왔다가 커지며 사라진다. 등속으로 하면 시계고, 이러면 카운트다운이다
    ctx.save();
    ctx.globalAlpha = 1 - inSec * 0.75;
    const k = 0.8 + Art.overshoot(Math.min(1, inSec * 4)) * 0.35 + inSec * 0.5;
    ctx.translate(W / 2, H / 2);
    ctx.scale(k, k);
    bigNum(String(left), 0, 26, 80, '#fff', 'center');
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * (1 - inSec)) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2 - 6, 70 + inSec * 60, 0, 7);
    ctx.stroke();
  }
  else if (G.phase === PHASE.WAITING) {
    scrim(0.42);
    label('한 명 더 들어오면 시작한다', W / 2, H / 2, 20, '#e8f2ff', 'center', 1);
    label('다른 탭에서 같은 주소를 한 번 더 열면 된다',
          W / 2, H / 2 + 26, 12, 'rgba(255,255,255,0.45)', 'center');
  }
  else if (G.phase === PHASE.OVER) {
    drawResults(now);
  }
  else if (!me || !(me.flags & PF.ALIVE)) {
    // 죽어도 판은 계속 보인다. 스냅샷이 어차피 전원에게 오니 관전은 공짜다.
    // 띠를 화면 가운데가 아니라 아래에 둔다. 가운데는 판을 보는 자리다
    const by = H - 96;
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.fillRect(0, by, W, 30);

    const list = aliveList();
    const who  = list.indexOf(specId);

    label('관전 중', 16, by + 20, 13, '#ff8f8f', 'left', 2);

    if (who >= 0) {
      // 누구를 보고 있는지와, 바꾸는 방법을 같이 적는다.
      // 바꿀 수 있다는 걸 모르면 없는 기능이다
      label('P' + specId, W / 2 - 44, by + 20, 14, colorOf(specId), 'center');
      label('(' + (who + 1) + '/' + list.length + ')', W / 2 + 6, by + 20, 12,
            'rgba(255,255,255,0.5)', 'center');
      label('← →', W / 2 + 62, by + 20, 13, 'rgba(255,255,255,0.75)', 'center', 1);
    }
  }

  if (!G.connected) {
    scrim(0.6);
    label('서버와 끊겼다', W / 2, H / 2, 20, '#ff8f8f', 'center', 1);
    label('2초마다 다시 붙어 본다', W / 2, H / 2 + 24, 12, 'rgba(255,255,255,0.5)', 'center');
  }
}

// ── 결과 화면 ────────────────────────────────────────────────
//
// 한 판이 끝났을 때 "이겼다" 세 글자만 띄우면 그 판의 이야기가 통째로 사라진다.
// 몇 등을 했고, 몇을 잡았고, 얼마나 버텼는지가 남아야 다음 판에 그걸 올리려고 한다.
//
// 등수를 제일 크게 쓴다. 배틀로얄에서 사람이 제일 먼저 보는 숫자다.
// 내 줄은 색을 따로 준다. 스물넷이 늘어서면 내 줄을 못 찾는다
function drawResults(now) {
  scrim(0.62);

  const t = Math.min(1, G.phaseTicks / (G.C.tickRate * 0.45));
  const k = Art.overshoot(t);

  // 위쪽: 이겼는지 졌는지
  ctx.save();
  ctx.translate(W / 2, H * 0.20);
  ctx.scale(0.7 + k * 0.3, 0.7 + k * 0.3);
  if (G.winner === 0xFF)        bigNum('무승부', 0, 0, 40, '#ffd166', 'center');
  else if (G.winner === G.myId) bigNum('이겼다', 0, 0, 48, '#7ee787', 'center');
  else                          bigNum('P' + G.winner + ' 승리', 0, 0, 36, '#8ab4ff', 'center');
  ctx.restore();

  const rows = statRows();
  const show = Math.min(rows.length, 8);
  const rowH = 28;
  const pw = Math.min(420, W - 40);
  const px = (W - pw) / 2;
  const py = H * 0.28;

  panel(px, py, pw, 26 + show * rowH + 10, 10);

  label('순위', px + 16,  py + 18, 10, 'rgba(255,255,255,0.40)', 'left', 1);
  label('킬',   px + 210, py + 18, 10, 'rgba(255,255,255,0.40)', 'right', 1);
  label('생존', px + 290, py + 18, 10, 'rgba(255,255,255,0.40)', 'right', 1);
  label('아이템', px + pw - 16, py + 18, 10, 'rgba(255,255,255,0.40)', 'right', 1);

  for (let i = 0; i < show; ++i) {
    const r = rows[i];
    const y = py + 26 + i * rowH;
    const mine = (r.id === G.myId);

    // 한 줄씩 차례로 나타난다. 한꺼번에 뜨면 어디를 볼지 모른다
    const appear = Math.min(1, Math.max(0, (G.phaseTicks - i * 3) / (G.C.tickRate * 0.3)));
    if (appear <= 0) continue;

    ctx.save();
    ctx.globalAlpha = appear;
    ctx.translate((1 - Art.easeOut(appear)) * 24, 0);

    if (mine) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      Art.rr(ctx, px + 8, y, pw - 16, rowH - 3, 4); ctx.fill();
    }

    const medal = r.place === 1 ? '#ffd166' : r.place === 2 ? '#d0d7e2' : r.place === 3 ? '#d08c5a' : 'rgba(255,255,255,0.45)';
    label(String(r.place), px + 20, y + 17, r.place <= 3 ? 15 : 13, medal, 'left');

    Art.drawFace(ctx, px + 58, y + 12, 8, colorOf(r.id), animalOf(r.id));
    label('P' + r.id + (r.id === G.myId ? ' (나)' : ''), px + 72, y + 16, 12,
          mine ? '#fff' : 'rgba(255,255,255,0.78)');

    label(String(r.kills), px + 210, y + 16, 13, r.kills ? '#ff9f6b' : 'rgba(255,255,255,0.30)', 'right');

    const mm = Math.floor(r.secs / 60), ss = Math.floor(r.secs % 60);
    label(mm + ':' + String(ss).padStart(2, '0'), px + 290, y + 16, 12,
          'rgba(255,255,255,0.65)', 'right');

    label(String(r.items), px + pw - 16, y + 16, 12, 'rgba(255,255,255,0.65)', 'right');
    ctx.restore();
  }

  const left = Math.max(0, Math.ceil((G.C.tickRate * 5 - G.phaseTicks) / G.C.tickRate));
  label('다음 판까지 ' + left, W / 2, py + 26 + show * rowH + 34, 13,
        'rgba(255,255,255,0.55)', 'center');
}

function scrim(a) {
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7);
  g.addColorStop(0, 'rgba(4,8,14,' + (a * 0.7) + ')');
  g.addColorStop(1, 'rgba(4,8,14,' + a + ')');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ── 서버가 알려주는 것들 ─────────────────────────────────────
Hooks.welcome = function () {
  // 아홉 자리에 각각 다른 장소를 깐다. 공기(하늘·물·색보정)는 판 하나에 하나
  Art.setPlaces(G.C.sectorKind, G.C.seed, G.C.sectorW, G.C.sectorH);
  resize();
  FX.reset();
  killFeed = [];
  banner = null;
  lastBeep = -1;
  const el = document.getElementById('theme');
  if (el) el.textContent = Art.placeNames().join(' · ');
};

Hooks.mapRow = function (y) {
  dirtyRows.add(y);
};

Hooks.conn = function () {
  const el = document.getElementById('conn');
  if (!el) return;
  el.textContent = G.connected ? '연결됨' : '끊김';
  el.className = G.connected ? 'on' : 'off';
};

Hooks.snapshot = function (prevPhase) {
  snapAtGame = gameTime;

  // 물에 잠기기 시작한 틱을 적어둔다. 남은 시간을 여기서 뺀다
  for (const p of G.players.values()) {
    if (p.flags & PF.DROWNING) {
      if (p.drownFrom === undefined) p.drownFrom = G.tick;
    } else {
      p.drownFrom = undefined;
    }
  }

  // 물풍선이 어디 있었는지 기억해둔다.
  // 다음 틱에 그 자리에서 EVT_BLAST 가 오면 그게 **폭발의 중심**이다.
  // 중심에만 큰 연출을 주고 뻗어나간 칸에는 물방울만 튀긴다.
  // 칸마다 큰 원을 터뜨리면 사거리보다 훨씬 넓어 보인다
  bubbleTiles = new Set();
  for (const b of G.bubbles) bubbleTiles.add(b.tx + ',' + b.ty);

  // 내가 위험한가. 음악의 층수와 캐릭터 표정이 여기서 갈린다
  const me = G.players.get(G.myId);
  danger = false;
  if (me && (me.flags & PF.ALIVE)) {
    if (me.flags & PF.DROWNING) danger = true;
    for (const b of G.bubbles) {
      if (Math.abs(b.tx - me.jtx) + Math.abs(b.ty - me.jty) <= 2) { danger = true; break; }
    }
  }

  Sound.setMood(G.phase, G.aliveCount / 24, danger || (G.ring.on && G.aliveCount <= 3));

  if (G.phase === PHASE.COUNTDOWN) {
    const sec = Math.floor(G.phaseTicks / G.C.tickRate);
    if (sec !== lastBeep) { lastBeep = sec; Sound.tick(sec); }
  }
  if (prevPhase !== G.phase) {
    if (G.phase === PHASE.COUNTDOWN) resetStats();
    if (G.phase === PHASE.PLAYING) { Sound.start(); FX.flashOut('#ffffff', 220, gameTime); }
    if (G.phase === PHASE.OVER) {
      finishStats();
      (G.winner === G.myId ? Sound.win() : Sound.lose());
    }
    lastBeep = -1;
  }
};

Hooks.event = function (type, x, y, who, val) {
  const T = Art.V.TS;
  const now = gameTime;
  const cx = x * T + T / 2, cy = y * T + T / 2;
  const pan = panOf(cx);
  const far = farOf(cx, cy);
  const mine = (who === G.myId);

  switch (type) {
    // 물줄기가 이 칸을 덮었다. 폭발 하나에 칸 수만큼 온다.
    // 그래서 **중심에서만** 크게 터뜨린다. 칸마다 터뜨리면 사거리보다 넓어 보이고
    // 소리도 다섯 번 겹쳐서 찢어진다
    case EVT.BLAST: {
      G.blasts.push({ x, y, until: now + (G.C.blast / G.C.tickRate) * 1000 });

      const isCenter = bubbleTiles.has(x + ',' + y);
      if (isCenter) {
        FX.burstWater(cx, cy, T, now, false);
        FX.shake(0.16);
        Sound.boom(pan, far);
      } else {
        FX.splash(cx, cy, T, now);
      }
      break;
    }

    case EVT.BUBBLE:
      FX.pickup(cx, cy, T, now, '#8fd8ff');
      Sound.place(pan, far);
      break;

    case EVT.BLOCK:
      G.tiles[y][x] = TILE.EMPTY;
      dirtyRows.add(y);
      // 부서진 조각은 그 구역 상자 색으로 튄다
      {
        const pl = Art.placeAt(x, y);
        FX.breakCrate(cx, cy, T, now, pl.crate, pl.crateSide);
      }
      Sound.crack(pan, far);
      break;

    // 상자를 밀었다. x,y 가 밀리기 전 자리, val 이 방향
    case EVT.PUSH: {
      const PX = [1, -1, 0, 0], PY = [0, 0, 1, -1];
      const nx = x + PX[val], ny = y + PY[val];

      if (G.tiles[y] && G.tiles[ny]) {
        G.tiles[y][x]   = TILE.EMPTY;
        G.tiles[ny][nx] = TILE.BOX;
        dirtyRows.add(y);
        dirtyRows.add(ny);
      }

      // 밀린 방향으로 먼지가 인다. 밀었다는 게 보여야 다음에도 민다
      FX.push(cx, cy, PX[val], PY[val], T, now, Art.placeAt(x, y).crate);
      Sound.push(pan, far);
      break;
    }

    case EVT.DROP:
      G.items[y][x] = val;
      if (val === ITEM.ULTRA) {
        FX.kill(cx, cy, T, now, '#ffd166');
        FX.shake(0.12);
      }
      Sound.drop(pan, far);
      break;

    case EVT.ITEM:
      G.items[y][x] = ITEM.NONE;
      FX.pickup(cx, cy, T, now,
                val === ITEM.ULTRA ? '#ffd166' :
                val === ITEM.BUBBLE ? '#4dabf7' :
                val === ITEM.POWER ? '#ff922b' : '#51cf66');
      if (mine) {
        // 뭘 먹었는지 HUD 의 그 칸이 튀어오른다. 먹은 순간에만 눈이 간다
        pickFlash[val === ITEM.ULTRA ? ITEM.POWER : val] = now;
        (val === ITEM.ULTRA ? Sound.ultra(pan, far) : Sound.item(pan, far));
      }
      break;

    // 이 게임에서 제일 큰 리턴. 여기만 연출을 아끼지 않는다
    case EVT.GRAZE:
      FX.graze(cx, cy, T, now, val);
      Sound.graze(val, pan, far);
      if (mine) {
        FX.punch(0.4 + Math.min(val, 4) * 0.2);
        FX.flashOut('rgba(140,225,255,0.5)', 140, now);
      }
      break;

    case EVT.CHAIN:
      FX.burstWater(cx, cy, T, now, true);
      FX.shake(0.10);
      Sound.chain(val, pan, far);
      break;

    case EVT.TRAP:
      FX.graze(cx, cy, T, now, 1);
      Sound.trap(pan, far);
      if (mine) FX.shake(0.3);
      break;

    case EVT.BREAK:
      FX.burstWater(cx, cy, T, now, false);
      Sound.breaks(pan, far);
      break;

    // 마무리. 몸으로 부딪쳐 터뜨렸다. 이 게임에서 마무리는 이것뿐이다
    // 마무리. 이 게임에서 제일 통쾌해야 하는 순간인데 밋밋했다.
    //
    // 밋밋했던 이유는 **당한 쪽이 그냥 사라져서**다. 터뜨렸다는 증거가 안 남는다.
    // 그래서 셋을 더한다.
    //   당한 쪽 색으로 물풍선이 터지듯 조각이 흩어진다
    //   내가 잡았으면 화면이 더 오래 멈추고 더 크게 흔들린다
    //   HUD 킬 수가 튀어오른다
    case EVT.POP:
      FX.pop(cx, cy, T, now, colorOf(who), colorOf(val));
      statOf(val).kills += 1;
      markDead(who);
      killFeed.unshift({ killer: val, victim: who, born: now });
      killFeed = killFeed.slice(0, 5);
      Sound.pop(pan, far);

      if (val === G.myId) {
        // 내가 잡았다. 여기만 아끼지 않는다
        FX.shake(0.85);
        FX.stop(120, performance.now());
        FX.punch(1.2);
        FX.flashOut('rgba(255,255,255,0.65)', 160, now);
        killPop = now;
      } else {
        FX.shake(0.35);
        FX.stop(50, performance.now());
      }
      break;

    case EVT.DEATH:
      markDead(who);
      FX.kill(cx, cy, T, now, '#ff6b6b');
      Sound.death(pan, far);
      if (mine) { FX.shake(0.6); FX.flashOut('rgba(180,30,30,0.6)', 300, now); }
      break;

    case EVT.DROWN:
      if (mine) Sound.drown();
      break;

    case EVT.FLOOD_WARN:
      banner = { text: val + '초 뒤 이 구역에 물이 찬다', until: now + 2600, life: 2600 };
      Sound.warn();
      break;

    case EVT.FLOOD:
      banner = { text: '물이 찼다', until: now + 1600, life: 1600 };
      FX.shake(0.35);
      Sound.flood();
      break;

    case EVT.RING:
      banner = { text: '물이 차오른다', until: now + 1800, life: 1800 };
      FX.shake(0.25);
      Sound.flood();
      break;
  }
};

// ── 입력 ─────────────────────────────────────────────────────
const held = new Set();
let sentX = 0, sentY = 0;

function inputDir() {
  let dx = 0, dy = 0;
  if (held.has('ArrowLeft')  || held.has('a')) dx -= 1;
  if (held.has('ArrowRight') || held.has('d')) dx += 1;
  if (held.has('ArrowUp')    || held.has('w')) dy -= 1;
  if (held.has('ArrowDown')  || held.has('s')) dy += 1;
  return [dx, dy];
}

// 방향이 **바뀔 때만** 보낸다. 누르고 있는 동안 매 프레임 보내면
// 30Hz 서버에 60Hz 로 같은 말을 하는 셈이라 그냥 낭비다
function pushInput() {
  const [dx, dy] = inputDir();
  if (dx !== sentX || dy !== sentY) {
    sentX = dx; sentY = dy;
    sendMove(dx, dy);
  }
}

addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // 죽었으면 좌우로 관전 대상을 넘긴다. 살아 있으면 좌우는 이동이다
  {
    const me = G.players.get(G.myId);
    const watching = !me || !(me.flags & PF.ALIVE);
    if (watching && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      specShift(e.key === 'ArrowRight' ? 1 : -1);
    }
  }

  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)) e.preventDefault();

  Sound.wake();

  if (k === 'm') {
    const muted = Sound.toggle();
    const el = document.getElementById('sound');
    if (el) { el.textContent = muted ? '소리 꺼짐' : '소리 켜짐'; el.className = muted ? 'off' : 'on'; }
    return;
  }
  if (k === 'r') { sendRestart(); return; }
  if (e.key === ' ') { sendPlace(); return; }

  if (!held.has(k)) { held.add(k); pushInput(); }
});

addEventListener('keyup', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  held.delete(k);
  pushInput();
});

addEventListener('blur', () => { held.clear(); pushInput(); });
addEventListener('resize', () => { if (G.C) resize(); });

const restartBtn = document.getElementById('restart');
if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    Sound.wake();
    sendRestart();
    restartBtn.blur();   // 눌린 채로 두면 Space 가 버튼으로 간다
  });
}
cv.addEventListener('mousedown', () => Sound.wake());

connect();
requestAnimationFrame(frame);
