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

let W = 0, H = 0;          // 캔버스 크기 (CSS 픽셀)

// 판이 그려지는 자리. 캔버스 안에서 가운데다.
//
// 판은 21x19 라 거의 정사각형인데 화면은 16:9 다. 그래서 **가로가 절반쯤 남는다.**
// 남는 데를 검게 두면 화면이 작아 보이고, 거기다 HUD 를 두면 판을 안 가린다.
// 타일 크기는 세로가 정하므로 이걸로 판이 커지지는 않는다. 판을 **덜 가리게** 된다
let BX = 0, BY = 0, BW = 0, BH = 0;
let dpr = 1;

// 미리 그려두는 종이. 바닥 한 장뿐이다.
//
// 바닥은 벽이 부서질 때 말고 안 변하고, 아무것도 가리지 않는다. 그래서 미리
// 굽는 게 이득이다. 그 위에 올라가는 것들은 전부 매 프레임 그린다 —
// 미리 구우면 앞뒤 순서가 종이 안에 갇히기 때문이다
let floorCv = null, floorCtx = null;
let floorDirty = true;

// 죽은 자세.
//
// 죽으면 그냥 사라지고 있었다. 24명 중 23명이 죽는 게임인데 죽는 그림이
// 없으면 사람이 판에서 빠지는 게 그냥 '없어짐' 으로 보인다.
//
// 갇힘 시트에 뻗은 모습과 터지는 모습이 같이 왔다. 몸으로 부딪쳐 터진
// 것과 그냥 죽은 것을 나눠 그린다 — 터진 쪽이 통쾌해야 하는 순간이다.
//
// 잠깐 남았다 사라진다. 오래 두면 판 위에 시체가 쌓여서 지저분하다
const DEATH_POSE_MS = 1400;
const POP_POSE_MS   = 320;
const deathPose = new Map();   // 자리 번호 -> { x, y, animal, t0, popped }

// 지금 밀려가고 있는 상자들.
//
// 서버는 밀리는 동안 두 칸을 다 막고, 다 밀리면 떠난 칸을 비운다.
// 화면도 같은 시계로 똑같이 한다 — 서버가 준 push_slide 틱을 쓰므로
// 상수를 바꿔도 둘이 안 어긋난다.
//
// 미끄러지는 그림은 줄 단위 종이에 못 굽는다. 두 줄에 걸치기 때문이다.
// 그래서 종이에는 아예 안 그리고, 매 프레임 사람과 같은 층에 그린다
let slides = [];

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
let alivePop = -9999;   // 누가 죽은 순간. 남은 사람 수가 튀어오른다
let grazeCell = null;   // 방금 걸치기로 산 자리. 그 칸을 잠깐 보여준다

// 이 세션에서 지금까지의 기록.
//
// 판이 끝나면 5초 뒤에 다음 판이 저절로 시작된다. 그 5초가 **이탈 지점**이다 —
// 결과표를 보고 '아 끝났네' 하고 창을 닫는다.
//
// 지난 판이 아무 데도 안 남으면 매 판이 첫 판이다. 그러면 나아지는 게 없고,
// 나아지는 게 없으면 다음 판을 할 이유도 없다.
// 서버에 뭘 저장하지 않는다 — 이 탭이 열려 있는 동안만 기억하면 충분하다
const session = { rounds: 0, best: 99, wins: 0, kills: 0, grazes: 0 };

function noteSession(myRow) {
  ++session.rounds;
  if (!myRow) return;
  if (myRow.place < session.best) session.best = myRow.place;
  if (myRow.place === 1) ++session.wins;
  session.kills += myRow.kills;
}

// 아직 한 번도 안 움직였다. 조작 안내를 띄우는 조건이다.
//
// 위 띠에 'WASD 이동 / Space 물풍선' 이 작게 있는데 **아무도 안 읽는다.**
// 링크를 받은 사람이 판에 던져져서 뭘 눌러야 하는지 모르면 그걸로 끝이다.
// 판 위에 크게 띄우고, **한 발짝이라도 움직이면 바로 지운다** —
// 아는 사람에게 설명이 남아 있으면 그것도 방해다
let hasMoved = false;
let hasPlaced = false;
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

// 이번 판에 누가 있었나. **AOI 때문에 G.players 로는 알 수 없다** —
// 거기엔 내 구역 사람만 들어 있다. 서버가 스냅샷에 실어주는 생존 표(전역)로 잡는다.
//
// 이걸 안 잡아서 결과표의 등수가 음수로 찍혔다. 스물넷 중 내가 본 사람만 세고
// 그 수로 등수를 계산했기 때문이다
let roster = new Set();

function resetStats() {
  roundStats = new Map();
  placeNext = 0;
  roster = new Set();
}

// 판이 도는 동안 살아 있는 것으로 보인 사람은 전부 참가자다.
// 중간에 죽어 표에서 빠져도 한 번 넣었으면 남는다
function noteRoster() {
  for (let i = 0; i < 24; ++i) {
    if (G.aliveMask[i >> 3] & (1 << (i & 7))) roster.add(i);
  }
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
// 등수는 **표를 그릴 때마다 다시 센다.**
//
// 전에는 판이 끝나는 순간 한 번만 매겼다. 그랬더니 결과표에 음수가 찍혔다.
// 서버는 스냅샷을 보내고 그다음에 이벤트를 보내는데, 마지막 순간에 죽은 사람의
// 죽음 소식이 **'판이 끝났다' 스냅샷보다 늦게 도착한다.**
// 등수를 이미 매긴 뒤에 새 사망자가 들어오니 그 사람만 음수로 남았다.
//
// 한 번 매기고 끝내는 대신 그릴 때마다 세면 늦게 온 소식도 자리를 찾는다.
// 다섯 초 동안 스물넷을 정렬하는 것은 공짜다
function finishStats() {
  for (const id of roundStats.keys()) roster.add(id);
}

// 결과표에 올릴 줄. 등수 순으로 정렬해서 돌려준다
function statRows() {
  // 늦게 온 죽음까지 넣고 나서 센다
  for (const id of roundStats.keys()) roster.add(id);

  // 죽은 순서대로 뒤에서부터. 끝까지 산 사람이 1등이다
  const dead = [...roster].filter((id) => statOf(id).diedTick >= 0);
  dead.sort((a, b) => statOf(a).diedTick - statOf(b).diedTick);

  const total = roster.size;
  for (const id of roster) statOf(id).place = 1;
  dead.forEach((id, i) => { statOf(id).place = total - i; });

  const rows = [];
  for (const id of roster) {
    const p = G.players.get(id) || {};
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
// 자리 번호가 곧 캐릭터다. 스물넷이 다 다른 얼굴이라 관전할 때 누가 누군지 보인다.
// 전에는 여덟 개를 돌려 써서 셋이 같은 얼굴이었다
const animalOf = (id) => id % 24;

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
  // 타일 크기를 **16의 배수로** 맞춘다.
  //
  // 벽과 상자를 16x16 도트 지도로 찍으므로, 타일이 16의 배수가 아니면
  // 한 점이 정수 픽셀로 안 떨어진다. 38px 타일이면 점 하나가 2.375px 이라
  // 반올림해서 2px 로 찍고 나면 **한 칸에 6픽셀이 남아 벽 사이에 틈이 생긴다.**
  //
  // 픽셀 게임이 배율을 정수로만 쓰는 이유가 이것이다. 조금 작아지더라도
  // 점이 점으로 떨어지는 쪽이 낫다 — 틈이 벌어진 벽은 벽으로 안 보인다
  const raw = Math.floor(Math.min(availW / view.w, availH / view.h));
  const ts = Math.max(16, Math.min(64, Math.floor(raw / 16) * 16));

  Art.setScale(ts);

  // 판 크기와 캔버스 크기를 나눈다. 캔버스는 창을 다 쓰고 판은 그 안에 가운데로 놓는다
  BW = view.w * ts;
  BH = view.h * ts;

  W = Math.max(BW, Math.floor(availW));
  H = BH;

  BX = Math.floor((W - BW) / 2);
  BY = 0;

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
// 그림 아틀라스를 받는다. 다 받으면 그때부터 캐릭터가 그림으로 그려진다.
// 못 받아도 게임은 그대로 돈다 — 그때는 도트로 그린다
Art.loadAtlas('chars', 'art/chars.png', 'art/chars.json');
Art.loadAtlas('fx',    'art/fx.png',    'art/fx.json');
Art.loadAtlas('trap',  'art/trap.png',  'art/trap.json');

function frame(ts) {
  requestAnimationFrame(frame);
  if (!G.C || !floorCtx) return;

  const dt = Math.min(64, ts - lastFrame);
  lastFrame = ts;

  // 다 밀린 상자는 떠난 칸을 비운다. 서버도 같은 틱에 같은 일을 한다.
  // 여기서 안 비우면 상자가 있던 자리가 영영 막힌 채로 남는다
  for (let i = slides.length - 1; i >= 0; --i) {
    const sl = slides[i];
    if (ts - sl.t0 < sl.ms) continue;
    if (G.tiles[sl.fy] && G.tiles[sl.fy][sl.fx] === TILE.BOX) {
      G.tiles[sl.fy][sl.fx] = TILE.EMPTY;
      floorDirty = true;
    }
    slides.splice(i, 1);
  }

  // 판 정리는 **그리는 것과 상관없이** 한다. 전에는 세상을 그리는 함수 안에 뒀는데,
  // 결과 화면처럼 판을 안 그리는 동안에는 상자가 있던 자리가 영영 안 치워졌다

  // 멈춤. 사람을 잡은 순간 아주 잠깐 시간이 안 흐른다.
  // 맞은 게 아니라 맞혔다는 걸 몸으로 알리는 장치다
  if (!FX.frozen(ts)) gameTime += dt;

  // 내 캐릭터를 미리 움직인다.
  //
  // 서버는 30Hz 로 도는데 화면은 60Hz 로 그린다. 그래서 프레임마다가 아니라
  // **서버 틱 간격만큼 쌓였을 때** 한 걸음씩 옮긴다. 안 그러면 두 배로 빨라진다
  predictAcc += dt;
  const tickMs = 1000 / G.C.tickRate;
  let guard = 4;                      // 탭이 뒤로 갔다 오면 dt 가 크다. 몰아서 안 뛴다
  while (predictAcc >= tickMs && guard-- > 0) {
    predictAcc -= tickMs;
    stepPrediction();
  }
  if (predictAcc > tickMs) predictAcc = 0;

  rebuild();
  rebuildFoam();
  updateCamera(dt);
  drawWorld(gameTime, dt);
  drawHUD(gameTime);
  drawFirstHints(gameTime);
}

// 서버가 어차피 내릴 답을 미리 한 걸음 그린다.
//
// 서버 권위는 그대로다. 맞고 죽는 것은 전부 서버가 정한다.
// 여기서는 **자리만** 미리 옮긴다. 서버 답이 오면 predict.reconcile 이 맞춘다
// 마지막 서버 틱 뒤로 쌓인 시간. 틱 사이를 메우는 데 쓴다
let predictAcc = 0;

function stepPrediction() {
  const me = G.players.get(G.myId);
  if (!me || !(me.flags & PF.ALIVE)) { Predict.stop(); return; }
  if (G.phase !== PHASE.PLAYING) { Predict.stop(); return; }

  // 대쉬 중에는 예측을 쉰다.
  //
  // 대쉬는 걷기보다 세 배 빠르고 벽에 닿으면 그 자리에서 끝난다.
  // 이 규칙을 여기서 한 번 더 구현하면 서버와 조금만 달라져도 매 틱 되돌아가고,
  // **되돌아가는 게 늦는 것보다 훨씬 심하게 보인다.**
  //
  // 8틱(0.27초)뿐이라 그동안 서버 자리를 그대로 따라도 사람은 못 느낀다.
  // 예측이 필요한 건 늘 하는 동작이지 0.27초짜리 특수 동작이 아니다

  const [dx, dy] = inputDir();
  Predict.tick(G.tiles, dx, dy, me.speed_lv | 0, !!(me.flags & PF.TRAPPED));
}

// ── 앞뒤 정렬 목록 ─────────────────────────────────
//
// 화면에 서 있는 모든 것을 한 목록에 담아 발밑 y 로 줄을 세운다.
// 종류별로 따로 그리던 것을 합친 이유는 그래야만 서로를 가릴 수 있기 때문이다.
//
// 객체를 매 프레임 새로 만들면 쓰레기가 쌀이면서 가끔 한 프레임이 튀다.
// 한 번 만들어 두고 값만 덮어쓴다
const PK = { TILE: 0, SLIDE: 1, BUBBLE: 2, PLAYER: 3 };

const paintPool = [];
let paintList = [];

function paintReset() { paintList.length = 0; }

function paint(baseY, kind, a, b) {
  const n = paintList.length;
  const s = paintPool[n] || (paintPool[n] = {});
  s.y = baseY; s.k = kind; s.a = a; s.b = b;
  paintList.push(s);
}

function paintSorted(ctx, alpha, now, T) {
  // 발밑 y 가 같으면 넣은 순서를 따른다. 같은 줄의 벽과 상자는 서로 안 겹친다
  paintList.sort((p, q) => p.y - q.y);

  for (const s of paintList) {
    if (s.k === PK.TILE) {
      Art.drawProp(ctx, G.tiles, G.C.mapW, s.a, s.b, s.a * T, s.b * T);
    }
    else if (s.k === PK.SLIDE) {
      const sl = s.a, e = s.b;
      Art.drawCrate(ctx, (sl.fx + (sl.tx - sl.fx) * e) * T,
                         (sl.fy + (sl.ty - sl.fy) * e) * T, T, sl.fx, sl.fy, true);
    }
    else if (s.k === PK.BUBBLE) {
      drawBubble(ctx, s.a, now, T);
    }
    else {
      drawPlayer(s.a, s.b, alpha, now, T);
    }
  }
}

// 물풍선 하나.
//
// 터지기 전 예고는 임팩트만큼 중요하다 —
// **예고 없는 폭발은 억울하고, 예고만 있는 폭발은 시시하다.**
//
// 두 단으로 나눈다.
//   1초 전  숨이 가빤진다. '곳 터지겠구나'
//   0.3초 전 부푸어 오르고 바닥에 그림자 고리가 퍼진다. '지금 나가야 한다'
// 마지막 단은 반응할 시간을 주지 않을 만큼 짧아야 한다. 주면 난이도가 사라진다
function drawBubble(ctx, b, now, T) {
  const fuseSec = b.fuse / G.C.tickRate;
  const bx = b.tx * T + T / 2, by = b.ty * T + T / 2;

  if (fuseSec < 0.34) {
    // 바닥 고리. 물풍선 밑에서 밖으로 퍼진다. 캐릭터에 안 가리게 발밑에 긐다
    const k = 1 - fuseSec / 0.34;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,240,240,' + (0.55 * (1 - k)) + ')';
    ctx.lineWidth = Math.max(1.5, T * 0.06);
    ctx.beginPath();
    ctx.ellipse(bx, by + T * 0.30, T * (0.35 + k * 0.55), T * (0.14 + k * 0.22),
                0, 0, 7);
    ctx.stroke();
    ctx.restore();
  }

  Art.drawBubble(ctx, bx, by, T * 0.40, fuseSec < 1.0, now,
                 b.owner === 0xFF ? null : colorOf(b.owner));
}

function drawWorld(now, dt) {
  const T = Art.V.TS;
  const th = Art.V.world;

  ctx.fillStyle = th.sky;
  ctx.fillRect(0, 0, W, H);

  FX.apply(ctx, now, W, H, dt);

  // 여기서부터는 **판 좌표**로 그린다. 카메라만큼 옮겨두면
  // 아래 코드는 화면이 어디를 보고 있는지 몰라도 된다.
  //
  // 판 영역으로 잘라낸다. 전에는 캔버스 크기가 곧 판 크기라 저절로 잘렸는데,
  // 캔버스를 창 전체로 넓히고 나서 **판이 여백까지 흘러넘쳤다.**
  // 미리 그려둔 종이는 판 전체 크기라 붙이면 넘치는 게 당연하다
  ctx.save();
  ctx.beginPath();
  ctx.rect(BX, BY, BW, BH);
  ctx.clip();
  ctx.translate(BX - Math.round(view.x0), BY - Math.round(view.y0));

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
    // 아직 안 뻗은 칸은 없는 것으로 친다. 윤곽선도 그때그때 다시 잡혀야
    // 물줄기가 자라는 것처럼 보인다
    for (const b of G.blasts) if (b.born <= now) hit.add(b.x + ',' + b.y);

    for (const b of G.blasts) {
      if (b.born > now) continue;

      const age = Math.max(0, Math.min(1, 1 - (b.until - now) / total));
      const heat = Math.max(0, 1 - age * 3);      // 앞의 1/3 만 하얗게 탄다

      // **맞는 동안은 계속 진해야 한다.**
      //
      // 처음에는 시간에 비례해 옅어지게 했다. 그랬더니 아직 맞는데 안전해 보였다.
      // 물이 옅어지는 걸 보고 들어갔다가 맞으면 그건 난이도가 아니라 거짓말이다.
      // 그래서 70% 까지는 그대로 두고 마지막 30% 에서만 빠르게 사라진다
      const fade = age < 0.7 ? 0 : (age - 0.7) / 0.3;
      const px = b.x * T, py = b.y * T;

      // 그림이 있으면 조각을 이어 붙여 그린다.
      // 이웃을 보고 가운데인지 팔인지 끝인지 고른다
      if (Art.drawBlastTile(ctx, px, py, T,
                            (hx, hy) => hit.has(hx + ',' + hy),
                            b.x, b.y, 1 - fade)) continue;

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

  // ── 앞뒤 순서 ──────────────────────────────────
  //
  // 규칙은 하나다. **바닥에 닿는 y 가 큰 것이 앞이다.**
  //
  // 벽이든 상자든 물풍선이든 사람이든 이 자 하나로 재서 줄을 세운다.
  // 새 물건이 생겨도 발밑 y 만 넣으면 자리가 저절로 정해진다.
  //
  // 전에는 줄마다 미리 구운 종이를 깔고 그 사이에 사람을 끼웠다. 그러면 같은 줄
  // 안에서는 앞뒤를 못 가리니, 사람을 판 위에 한 번 더 그렸다. 사람이 두 번
  // 그려졌고 나중 것이 늘 이겨서 **상자 뒤에 선 사람이 상자 앞으로 나왔다.**
  // 목록이 하나면 그런 일이 생길 수가 없다
  const alpha = Math.min(1, (now - snapAtGame) / G.snapInterval);
  const me = G.players.get(G.myId);

  // 화면에 안 걸치는 칸은 건너뛰다. 45x39 가 아니라 눈에 보이는 만큼만 본다
  const xStart = Math.max(0, Math.floor(view.x0 / T) - 1);
  const xEnd   = Math.min(G.C.mapW, Math.ceil(view.x0 / T) + view.w + 2);
  const yStart = Math.max(0, Math.floor(view.y0 / T) - 1);
  const yEnd   = Math.min(G.C.mapH, Math.ceil(view.y0 / T) + view.h + 2);

  // 바닥에 깔리는 것은 정렬에 안 넣는다. 아이템은 땅에 놓인 물건이라 그 칸을
  // 밟고 선 사람보다 늘 뒤다. 정렬에 넣으면 발밑 y 가 엇갈려서 아이템이
  // 사람 머리 위로 올라오는 순간이 생긴다
  for (let y = yStart; y < yEnd; ++y) {
    for (let x = xStart; x < xEnd; ++x) {
      const it = G.items[y][x];
      if (it !== ITEM.NONE) Art.drawItem(ctx, x * T + T / 2, y * T + T / 2, T, it, now);
    }
  }

  paintReset();

  for (let y = yStart; y < yEnd; ++y) {
    for (let x = xStart; x < xEnd; ++x) {
      const t = G.tiles[y][x];
      // 1 벽 · 2 부술 수 있는 블록 · 4 밀 수 있는 상자
      if (t === 1 || t === 2 || t === 4) paint((y + 1) * T, PK.TILE, x, y);
    }
  }

  for (const sl of slides) {
    const k = Math.min(1, (now - sl.t0) / sl.ms);
    // 처음에 살짝 빠르고 끝에서 느려진다. 무거운 것이 밀려서 서는 모양이다.
    // 일정한 속도로 가면 밀리는 게 아니라 실려 가는 것처럼 보인다
    const e = 1 - (1 - k) * (1 - k);
    paint((sl.fy + (sl.ty - sl.fy) * e + 1) * T, PK.SLIDE, sl, e);
  }

  for (const b of G.bubbles) paint((b.ty + 1) * T, PK.BUBBLE, b, 0);

  for (const [id, p] of G.players) {
    if (p.visible === false) continue;   // AOI 로 안 온 사람. 기억만 있고 지금은 안 보인다
    // 죽은 사람은 안 그린다. 죽었으면 없는 것이고,
    // 어디서 죽었는지는 따로 남기는 죽은 자세가 말해준다
    if (!(p.flags & PF.ALIVE)) continue;
    // 몸의 아랫변이다. 몸 가운데가 아니다 — 가운데로 재면 키 큰 것이 늘 앞에 선다
    const py = (p.y0 + (p.y1 - p.y0) * alpha) / G.C.tileUnits;
    paint((py + 0.4) * T, PK.PLAYER, id, p);
  }

  paintSorted(ctx, alpha, now, T);


  // 죽은 자세. 사람을 다 그린 뒤에 그린다 — 죽은 자리가 벽에 묻히면
  // 누가 어디서 죽었는지가 안 보인다. 잠깐만 남았다 사라진다
  for (const [id, d] of deathPose) {
    const age = now - d.t0;
    if (age > DEATH_POSE_MS) { deathPose.delete(id); continue; }

    // 터진 것은 처음 순간만. 그다음은 뻗은 모습이다
    const kind = (d.popped && age < POP_POSE_MS) ? 'pop' : 'ko';

    // 마지막 1/4 에서만 옅어진다. 처음부터 옅으면 죽은 게 안 보인다
    const k = age / DEATH_POSE_MS;
    const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    Art.drawPose(ctx, d.x, d.y, T * 0.40, d.animal, kind, fade);
  }

  // 걸치기로 산 칸. 파티클보다 위에 그려야 고리에 안 묻힌다
  drawGrazeCell(now, T);

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
  // 후처리는 **판 위에만** 건다. 캔버스가 창을 다 쓰게 되면서
  // W,H 로 그리면 여백까지 덮어 화면 전체가 어두워진다
  // 가장자리를 어둡게. **부드러운 비네트가 아니라 두 단이다.**
  //
  // 픽셀 아트는 값이 또렷한 게 전부인데, 부드러운 그라데이션을 덮으면
  // 같은 색이 자리에 따라 다른 색이 된다. 판을 읽는 데 쓰는 명도 법칙이
  // 화면 위치에 따라 흔들리는 것이라 법칙 1을 스스로 깨는 셈이다.
  //
  // 안쪽은 안 건드리고 테두리 두 줄만 눌러 화면 밖과의 경계를 만든다
  const cx0 = BX + BW / 2, cy0 = BY + BH / 2;
  const edge = Math.max(6, Math.round(Art.V.TS * 0.5));

  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(BX, BY, BW, edge);
  ctx.fillRect(BX, BY + BH - edge, BW, edge);
  ctx.fillRect(BX, BY, edge, BH);
  ctx.fillRect(BX + BW - edge, BY, edge, BH);

  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  const e2 = Math.round(edge / 2);
  ctx.fillRect(BX, BY, BW, e2);
  ctx.fillRect(BX, BY + BH - e2, BW, e2);
  ctx.fillRect(BX, BY, e2, BH);
  ctx.fillRect(BX + BW - e2, BY, e2, BH);

  // 내가 위험하다. 화면 가장자리가 붉어진다.
  // 숫자나 글자로 알리면 싸우는 중에 못 본다
  if (me && (me.flags & PF.DROWNING)) {
    const pulse = 0.5 + 0.5 * Math.sin(now / 120);
    const eg = ctx.createRadialGradient(cx0, cy0, Math.min(BW, BH) * 0.28,
                                        cx0, cy0, Math.max(BW, BH) * 0.62);
    eg.addColorStop(0, 'rgba(200,40,40,0)');
    eg.addColorStop(1, 'rgba(200,40,40,' + (0.25 + 0.25 * pulse) + ')');
    ctx.fillStyle = eg;
    ctx.fillRect(BX, BY, BW, BH);
  }

  FX.drawFlash(ctx, now, W, H);
  FX.done(ctx);
}

// 걸치기로 산 칸을 잠깐 보여준다.
//
// 판 좌표계 안에서 그린다. 0.6초 동안 테두리가 조여들며 사라진다 —
// 남아 있으면 다음 판단을 방해하고, 너무 짧으면 못 본다
function drawGrazeCell(now, T) {
  if (!grazeCell) return;

  const t = (now - grazeCell.at) / 600;
  if (t >= 1) { grazeCell = null; return; }

  const k = 1 - t;
  const grow = (1 - k) * T * 0.35;
  const px = grazeCell.x * T - grow, py = grazeCell.y * T - grow;
  const sz = T + grow * 2;

  ctx.save();
  ctx.strokeStyle = 'rgba(160,235,255,' + (0.85 * k) + ')';
  ctx.lineWidth = Math.max(2, T * 0.07 * k);
  ctx.strokeRect(px, py, sz, sz);

  // 연속으로 성공했으면 테두리가 겹으로 늘어난다. 숫자를 안 쓰고 겹으로 센다
  const layers = Math.min(grazeCell.n || 1, 4);
  for (let i = 1; i < layers; ++i) {
    const o = i * T * 0.16 * (1 + (1 - k));
    ctx.strokeStyle = 'rgba(160,235,255,' + (0.4 * k / i) + ')';
    ctx.strokeRect(px - o, py - o, sz + o * 2, sz + o * 2);
  }
  ctx.restore();
}

// 갇힌 지 얼마나 됐나. 1 이면 방금, 0 이면 곧 풀린다.
//
// 서버는 '갇혔다' 만 보내고 남은 틱은 안 보낸다. 익사와 달리 본인만 아는 정보가
// 아니라 **모두가 알아야 하는 정보**라 스냅샷에 실을 수도 있지만,
// 화면이 갇힌 순간의 틱을 적어두면 그것만으로 셀 수 있다. 상수는 이미 받았다
function trapLeft(p) {
  if (p.trapFrom === undefined) return 1;
  const gone = G.tick - p.trapFrom;
  return Math.max(0, Math.min(1, 1 - gone / G.C.trap));
}

function drawPlayer(id, p, alpha, now, T) {
  // 남은 스냅샷 두 장 사이를 보간한다. 그게 부드러움의 전부다.
  //
  // **내 캐릭터만 다르다.** 서버를 기다리지 않고 미리 옮겨둔 자리를 쓴다.
  // 그래야 키를 누른 프레임에 화면이 움직인다
  let px, py;
  const mineLive = (id === G.myId) && Predict.isLive() && (p.flags & PF.ALIVE);

  if (mineLive) {
    // 마지막 틱 뒤로 얼마나 지났나. 두 틱 사이를 메워서 그린다 —
    // 이게 없으면 30Hz 로만 움직여서 60fps 화면에서 덜덜 떨어 보인다
    const v = Predict.view(predictAcc / (1000 / G.C.tickRate));
    px = v.x / G.C.tileUnits * T;
    py = v.y / G.C.tileUnits * T;
  } else {
    px = (p.x0 + (p.x1 - p.x0) * alpha) / G.C.tileUnits * T;
    py = (p.y0 + (p.y1 - p.y0) * alpha) / G.C.tileUnits * T;
  }
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

  // 물방울에서 막 빠져나왔다. 잠깐 그 모습을 보여준다.
  //
  // 7초를 갇혀 있다가 살아 나온 순간이라, 그냥 원래 그림으로 돌아가면
  // 풀린 줄도 모르고 지나간다. 이 0.4초가 살아났다는 신호다
  const freeing = p.freeUntil && now < p.freeUntil
                  && Art.drawPose(ctx, px, py, r, animalOf(id), 'free');

  if (!freeing) Art.drawChar(ctx, px, py, r, colorOf(id), {
    face: p.face | 0,
    animal: animalOf(id),
    moving: !!p.moving && !dead,
    walk: p.walk || 0,
    t: now,
    danger: id === G.myId ? danger : false,
  });

  // 갇힘. 물방울이 통째로 씌워진다.
  // 글자를 안 쓴다. 갇혔다는 건 이 그림 하나로 다 보인다.
  //
  // 여기에 **사냥 신호**를 하나 더 얹는다.
  // 갇힌 사람은 이 게임에서 유일하게 '지금 가면 잡는다' 가 성립하는 상태다.
  // 물줄기는 사람을 못 죽이고 마무리는 몸으로 해야 하므로,
  // 갇힌 사람이 어디 있는지가 **판 건너에서도 보여야** 교전이 일어난다.
  //
  // 남은 시간은 고리가 조여드는 것으로 보여준다. 숫자를 쓰지 않는다 —
  // 남의 상태에 숫자를 띄우면 화면이 시끄러워지고, 여기서 필요한 건
  // '있다/곧 풀린다' 두 가지뿐이다
  if (p.flags & PF.TRAPPED) {
    const left = trapLeft(p);            // 0~1. 1이면 방금 갇혔다
    const pulse = 0.5 + 0.5 * Math.sin(now / 200);

    // 바닥 고리. 시간이 갈수록 조여든다
    ctx.save();
    ctx.strokeStyle = 'rgba(255,220,120,' + (0.25 + 0.35 * pulse * left) + ')';
    ctx.lineWidth = Math.max(1.5, T * 0.05);
    ctx.beginPath();
    ctx.ellipse(px, py + r * 0.95, T * (0.30 + left * 0.45), T * (0.12 + left * 0.18),
                0, 0, 7);
    ctx.stroke();
    ctx.restore();

    // 그림이 있으면 그림으로. 없으면 아래 캔버스 물방울로 내려간다.
    // 여기서 return 하면 안 된다 — 뒤에 익사 표시가 남아 있다
    const drawn = Art.drawTrapped(ctx, px, py, r, animalOf(id), now);

    const wob = Math.sin(now / 140) * 0.07;
    if (!drawn) {
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
    }

    if (!drawn) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(px - r * 0.52, py - r * 0.68, r * 0.24, r * 0.15, -0.6, 0, 7);
      ctx.fill();
    }
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
// 판때기. **판과 같은 재료로 만든다.**
//
// 9/2 까지 둥근 모서리에 반투명 검정에 그림자에 흐린 테두리였다.
// 판은 픽셀 아트인데 그 위에 웹 대시보드가 떠 있는 꼴이었다.
// 두 개가 다른 게임처럼 보이면 어느 쪽이 잘 만들어졌든 싸구려로 보인다.
//
// 규칙은 상자를 그릴 때와 같다 — 모서리는 곡선이 아니라 한 칸씩 깎고,
// 반투명 대신 단색이고, 테두리는 1픽셀이고, 좌표는 격자에 맞는다.
// 그림자도 흐리지 않고 한 단 어긋난 실루엣이다
function panel(x, y, w, h) {
  const P = Art.V.P;
  const q = (v) => Math.round(v / P) * P;

  const x0 = q(x), y0 = q(y), w0 = q(w), h0 = q(h);

  // 그림자. 흐리지 않고 한 칸 어긋난 같은 모양이다
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  pxBox(x0 + P, y0 + P, w0, h0, P);

  // 몸통. 반투명이 아니라 단색이다 — 뒤가 비치면 글자가 배경과 싸운다
  ctx.fillStyle = '#141a24';
  pxBox(x0, y0, w0, h0, P);

  // 위쪽 한 줄만 밝게. 빛은 판 전체와 같은 왼쪽 위에서 온다
  ctx.fillStyle = '#2b3546';
  ctx.fillRect(x0 + P, y0, w0 - P * 2, P);
  ctx.fillRect(x0, y0 + P, P, h0 - P * 2);

  ctx.fillStyle = '#0a0e15';
  ctx.fillRect(x0 + P, y0 + h0 - P, w0 - P * 2, P);
  ctx.fillRect(x0 + w0 - P, y0 + P, P, h0 - P * 2);

}

// 모서리를 한 칸씩 깎은 네모. 곡선을 쓰면 아무리 작아도 흐려진다
function pxBox(x, y, w, h, P) {
  ctx.fillRect(x + P, y,     w - P * 2, h);
  ctx.fillRect(x,     y + P, w,         h - P * 2);
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

// 큰 숫자는 **도트로 찍는다.**
//
// 브라우저 글꼴로 찍으면 판은 픽셀인데 숫자만 매끈해서 두 개가 다른 게임처럼 보인다.
// 흐린 그림자도 뺐다 — 픽셀 아트의 그림자는 번지지 않고 한 칸 어긋난다.
//
// y 는 글자의 **아래쪽**이었다(alphabetic 기준). 도트는 위쪽이 기준이라
// 여기서 맞춰준다. 부르는 쪽을 다 고치면 실수하기 쉽다
function bigNum(text, x, y, size, color, align) {
  const h = Math.round(size * 0.78);
  const P = Math.max(1, Math.round(h / 7));
  const top = y - h;

  ctx.save();
  Art.dotText(ctx, String(text), x + P, top + P, h, 'rgba(0,0,0,0.55)', align);
  Art.dotText(ctx, String(text), x, top, h, color, align);
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
  panel(10, 10, 132, 44);
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
  panel(W / 2 - 110, 10, 220, 44);

  // 누가 죽으면 남은 수가 한 번 튀어오른다.
  // 이 숫자가 이 게임에서 제일 중요한 숫자인데 조용히 바뀌면 바뀐 줄 모른다
  {
    const ap = Math.max(0, 1 - (now - alivePop) / 420);
    ctx.save();
    ctx.translate(W / 2 - 62, 44);
    const k = 1 + Art.overshoot(Math.min(1, ap * 2)) * 0.45 * ap;
    ctx.scale(k, k);
    bigNum(String(G.aliveCount), 0, 0, 26, ap > 0 ? '#ffd166' : '#fff', 'right');
    ctx.restore();
  }
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

    panel(W / 2 - 110 - 72, 10, 66, 44);
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
    panel(W - 106, 10, 96, 44);
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
    const cols = 3;
    const bw = cell * cols + gap * (cols + 1), bh = 68;

    // 여백이 넉넉하면 판 아래가 아니라 **왼쪽 여백**에 놓는다.
    // 판 위에 얹으면 아래 두 줄이 가려지는데, 거기가 도망칠 자리다.
    // 여백이 좁은 화면에서는 원래대로 판 아래에 둔다
    const roomy = BX >= bw + 20;
    const bx = roomy ? (BX - bw) / 2 : (W - bw) / 2;
    const by = roomy ? H / 2 - bh / 2 : H - bh - 10;
    panel(bx, by, bw, bh);

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

      if (st.cd !== undefined) {
        // 남은 초. 다 찼으면 숫자 대신 '준비' 를 뜻하는 밝은 테두리를 두른다.
        // 0 이라고 써두면 0개 가진 것처럼 읽힌다
        if (st.cd > 0) {
          bigNum(((st.cd / 30) + 0.9).toFixed(0), x + cell / 2, by + 50, 19,
                 'rgba(255,255,255,0.40)', 'center');
        }
        else {
          ctx.strokeStyle = st.c;
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 4, by + 4, cell - 8, bh - 8);
        }
      }
      else {
        bigNum(String(st.v), x + cell / 2, by + 50, 19,
               flash > 0 ? '#ffffff' : st.c, 'center');
      }
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

    // 아이템 패널과 같은 이유로 오른쪽 여백에 놓는다.
    // 미니맵은 도망칠 방향을 정하는 데 쓰는데, 그게 판 구석을 가리면 앞뒤가 안 맞는다
    const roomyR = (W - BX - BW) >= mw + pad * 2 + 20;
    const mx = roomyR ? BX + BW + (W - BX - BW - mw) / 2 : W - mw - pad - 10;
    const my = roomyR ? H / 2 - mw / 2 : H - mw - pad - 10;

    panel(mx - pad, my - pad, mw + pad * 2, mw + pad * 2);

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

    panel(x, y, 150, 26);
    Art.drawFace(ctx, x + 18, y + 14, 7, colorOf(k.killer), animalOf(k.killer));
    label('P' + k.killer, x + 30, y + 18, 11, '#fff');
    label('▸', x + 66, y + 18, 12, 'rgba(255,255,255,0.4)');
    Art.drawFace(ctx, x + 92, y + 14, 7, colorOf(k.victim), animalOf(k.victim));
    ctx.globalAlpha *= 0.7;
    label('P' + k.victim, x + 104, y + 18, 11, 'rgba(255,255,255,0.9)');
    ctx.restore();
  }

  // ── 침수 예고 띠 ───────────────────────────────────────────
  if (banner && banner.until > now && G.phase !== PHASE.OVER) {
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

// ── 첫 조작 안내 ─────────────────────────────────────────────
//
// 처음 온 사람에게 딱 두 가지만 알린다. 움직이는 법과 놓는 법.
// 규칙 설명은 안 한다 — 물풍선을 한 번 놓아보면 나머지는 저절로 안다.
//
// 판 한가운데를 피해 아래쪽에 둔다. 가운데는 판을 보는 자리다.
// 그리고 **하고 나면 그 줄만 지운다.** 움직일 줄 아는 사람에게 이동 안내는 방해다
function drawFirstHints(now) {
  if (G.phase !== PHASE.PLAYING) return;

  const me = G.players.get(G.myId);
  if (!me || !(me.flags & PF.ALIVE)) return;

  const y = BY + BH - 74;
  const pulse = 0.72 + 0.28 * Math.sin(now / 420);

  if (hasMoved && hasPlaced) return;

  if (!hasMoved) {
    keyCap('W', W / 2 - 60, y - 26, pulse);
    keyCap('A', W / 2 - 86, y, pulse);
    keyCap('S', W / 2 - 60, y, pulse);
    keyCap('D', W / 2 - 34, y, pulse);
    label('움직인다', W / 2 - 60, y + 40, 12, 'rgba(255,255,255,' + pulse + ')', 'center');
  }

  if (!hasPlaced) {
    const bx = hasMoved ? W / 2 - 40 : W / 2 + 30;
    keyCap('SPACE', bx, y, pulse, 70);
    label('물풍선', bx + 35, y + 40, 12, 'rgba(255,255,255,' + pulse + ')', 'center');
  }
}

// 키 모양. 판때기와 같은 재료다 — 각지고 단색이고 1픽셀 테두리
function keyCap(text, x, y, alpha, w) {
  const P = Art.V.P;
  const bw = w || 22, bh = 22;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.fillStyle = '#0d1219';
  pxBox(Math.round(x / P) * P, Math.round(y / P) * P, bw, bh, P);
  ctx.fillStyle = '#3d4a5e';
  ctx.fillRect(Math.round(x / P) * P + P, Math.round(y / P) * P, bw - P * 2, P);

  label(text, x + bw / 2, y + 15, text.length > 1 ? 10 : 12, '#dfe8f5', 'center', 1);
  ctx.restore();
}

// ── 결과 화면 ────────────────────────────────────────────────
//
// 한 판이 끝났을 때 "이겼다" 세 글자만 띄우면 그 판의 이야기가 통째로 사라진다.
// 몇 등을 했고, 몇을 잡았고, 얼마나 버텼는지가 남아야 다음 판에 그걸 올리려고 한다.
//
// 등수를 제일 크게 쓴다. 배틀로얄에서 사람이 제일 먼저 보는 숫자다.
// 내 줄은 색을 따로 준다. 스물넷이 늘어서면 내 줄을 못 찾는다
function drawResults(now) {
  // 판을 더 누른다. 결과를 읽는 자리인데 뒤에서 판이 돌면 시선이 갈린다
  scrim(0.82);

  const t = Math.min(1, G.phaseTicks / (G.C.tickRate * 0.45));
  const k = Art.overshoot(t);

  const rows = statRows();
  const myRow = rows.find((r) => r.id === G.myId);

  // 위쪽: **내가 몇 등 했나.**
  //
  // 전에는 '이겼다 / P4 승리' 만 띄웠다. 스물넷 중 스물셋에게는
  // 남이 이겼다는 소식일 뿐이고, 내 판이 어땠는지는 아무 데도 없었다.
  // 배틀로얄에서 사람이 제일 먼저 보는 숫자는 승자가 아니라 **자기 등수**다.
  //
  // 그리고 bigNum 은 이제 도트 숫자만 그린다. 한글을 넘기면 아무것도 안 그려진다 —
  // 그래서 9/2 오후에 이 자리가 통째로 비어 있었다. 숫자는 bigNum, 글자는 label 이다
  ctx.save();
  ctx.translate(W / 2, H * 0.20);
  ctx.scale(0.7 + k * 0.3, 0.7 + k * 0.3);

  if (myRow && myRow.place === 1) {
    label('이겼다', 0, -6, 30, '#7ee787', 'center', 3);
  }
  else if (myRow) {
    // 등수를 크게, '등' 을 작게. 숫자가 주인공이다
    const w = Art.dotText(ctx, String(myRow.place), -14, -30, 34,
                          myRow.place <= 3 ? '#ffd166' : '#e8eef7', 'center');
    label('등', -14 + w / 2 + 12, -6, 16, 'rgba(255,255,255,0.7)', 'left');
    label(rows.length + '명 중', 0, 20, 12, 'rgba(255,255,255,0.45)', 'center');
  }
  else if (G.winner === 0xFF) {
    label('무승부', 0, 0, 26, '#ffd166', 'center', 3);
  }
  else {
    label('P' + G.winner + ' 승리', 0, 0, 24, '#8ab4ff', 'center', 2);
  }
  ctx.restore();
  const show = Math.min(rows.length, 8);
  const rowH = 28;
  const pw = Math.min(420, W - 40);
  const px = (W - pw) / 2;
  const py = H * 0.28;

  panel(px, py, pw, 26 + show * rowH + 10);

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
      // 둥근 모서리 대신 각진 띠 + 왼쪽에 세로 표식.
      // 스물넷이 늘어서면 옅은 배경색만으로는 내 줄을 못 찾는다
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(px + 8, y, pw - 16, rowH - 3);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(px + 8, y, 3, rowH - 3);
    }

    const medal = r.place === 1 ? '#ffd166' : r.place === 2 ? '#d0d7e2' : r.place === 3 ? '#d08c5a' : 'rgba(255,255,255,0.45)';
    Art.dotText(ctx, String(r.place), px + 20, y + 5, r.place <= 3 ? 15 : 12, medal, 'left');

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

  // 내가 여덟 줄 안에 없으면 맨 아래에 따로 붙인다.
  // **내 줄이 없는 결과표는 남의 결과표다**
  if (myRow && rows.indexOf(myRow) >= show) {
    const y = py + 26 + show * rowH + 4;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(px + 8, y, pw - 16, rowH - 3);

    Art.dotText(ctx, String(myRow.place), px + 20, y + 5, 12, '#e8eef7', 'left');
    Art.drawFace(ctx, px + 58, y + 12, 8, colorOf(myRow.id), animalOf(myRow.id));
    label('P' + myRow.id + ' (나)', px + 72, y + 16, 12, '#fff');
    label(String(myRow.kills), px + 210, y + 16, 13,
          myRow.kills ? '#ff9f6b' : 'rgba(255,255,255,0.30)', 'right');
  }

  // 이번 세션의 기록. **두 판째부터만** 보여준다 —
  // 첫 판에 '1판 · 최고 3등' 을 띄우면 방금 본 것을 되풀이하는 것뿐이다.
  // 두 판째부터는 '아까보다 나은가' 라는 질문이 생긴다. 그게 다음 판을 하게 만든다
  const sy2 = py + 26 + show * rowH + 40;
  if (session.rounds >= 2) {
    const bits = [session.rounds + '판째'];
    if (session.best <= 24) bits.push('최고 ' + session.best + '등');
    if (session.wins > 0)   bits.push(session.wins + '승');
    if (session.kills > 0)  bits.push(session.kills + '처치');

    label(bits.join('   ·   '), W / 2, sy2, 12, 'rgba(255,214,102,0.75)', 'center', 1);
  }

  const left = Math.max(0, Math.ceil((G.C.tickRate * 5 - G.phaseTicks) / G.C.tickRate));
  label('다음 판까지 ' + left + '초', W / 2,
        sy2 + (session.rounds >= 2 ? 22 : 4), 13,
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
  // 판이 새로 깔린다. 밀려가던 상자는 지난 판의 것이라 버린다 —
  // 안 버리면 새 판의 엉뚱한 칸이 비워진다
  slides = [];

  // 이동 규칙을 서버가 준 값으로 세운다. 화면이 자기 값을 갖고 있으면
  // 상수를 바꾼 날 예측과 서버가 갈린다
  Predict.setup(G.C);
  // 아홉 자리에 각각 다른 장소를 깐다. 공기(하늘·물·색보정)는 판 하나에 하나
  Art.setPlaces(G.C.sectorKind, G.C.seed, G.C.sectorW, G.C.sectorH);
  Art.setLanes(G.lanes);   // 바닥에 흙길을 그리는 데 쓴다
  resize();
  FX.reset();
  killFeed = [];
  banner = null;
  lastBeep = -1;
  const el = document.getElementById('theme');
  if (el) el.textContent = Art.placeNames().join(' · ');
};

Hooks.mapRow = function (y) {
  floorDirty = true;
};

Hooks.conn = function () {
  const el = document.getElementById('conn');
  if (!el) return;
  el.textContent = G.connected ? '연결됨' : '끊김';
  el.className = G.connected ? 'on' : 'off';
};

Hooks.snapshot = function (prevPhase) {
  snapAtGame = gameTime;

  // 서버 답이 왔다. 미리 옮겨둔 자리와 맞춰본다.
  // 어긋난 만큼은 그림에서만 몇 프레임에 걸쳐 녹인다 — 바로 옮기면 튄다
  {
    const me = G.players.get(G.myId);
    if (me && (me.flags & PF.ALIVE) && G.phase === PHASE.PLAYING) {
      Predict.reconcile(me.x1, me.y1);
    } else {
      Predict.stop();
    }
  }

  // 물에 잠기기 시작한 틱을 적어둔다. 남은 시간을 여기서 뺀다
  for (const p of G.players.values()) {
    if (p.flags & PF.DROWNING) {
      if (p.drownFrom === undefined) p.drownFrom = G.tick;
    } else {
      p.drownFrom = undefined;
    }

    // 갇힌 순간도 같은 방식으로 적어둔다. 고리가 조여드는 데 쓴다
    if (p.flags & PF.TRAPPED) {
      if (p.trapFrom === undefined) p.trapFrom = G.tick;
    } else {
      p.trapFrom = undefined;
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

  noteRoster();

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
      noteSession(statRows().find((r) => r.id === G.myId));
      (G.winner === G.myId ? Sound.win() : Sound.lose());
    }
    lastBeep = -1;
  }
};

// 이 칸이 폭발 중심에서 몇 칸 떨어져 있나.
//
// 서버는 '이 칸이 물줄기에 덮였다' 만 보내고 어느 물풍선에서 나왔는지는 안 보낸다.
// 보낼 수도 있지만 그러려고 패킷을 늘리기는 아깝다 —
// 화면은 물풍선이 어디 있었는지를 이미 알고 있다(bubbleTiles).
// 제일 가까운 중심까지의 거리면 충분하다. 겹쳐 터져도 먼저 닿는 쪽을 따른다
function centerDist(x, y) {
  let best = 8;
  for (const key of bubbleTiles) {
    const c = key.split(',');
    const d = Math.abs(x - (+c[0])) + Math.abs(y - (+c[1]));
    if (d < best) best = d;
  }
  return best;
}

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
      const isCenter = bubbleTiles.has(x + ',' + y);

      // **물줄기는 중심에서 바깥으로 뻗어나간다.**
      //
      // 서버는 한 틱에 십자를 통째로 만든다. 규칙으로는 그게 맞다 —
      // 사거리 안이면 동시에 맞는다.
      // 그런데 화면까지 동시에 나타나면 **물이 뻗은 게 아니라 네모가 켜진 것**으로 보인다.
      // 어디서 시작해 어디까지 갔는지가 안 읽히고, 그게 이 게임에서 제일 중요한 정보다.
      //
      // 판정은 안 건드린다. 서버가 정한 그대로 맞는다. 그리는 시각만 칸마다 늦춘다.
      // 한 칸에 22ms 면 사거리 4가 88ms 다. 사람이 '뻗었다' 로 느끼는 최소치쯤이고
      // 반응할 시간을 주지는 않는다
      const away = centerDist(x, y);
      const lead = away * 22;

      G.blasts.push({
        x: x, y: y,
        born:  now + lead,
        until: now + lead + (G.C.blast / G.C.tickRate) * 1000,
      });

      if (isCenter) {
        FX.burstWater(cx, cy, T, now, false);
        FX.shake(0.16);
        Sound.boom(pan, far);
      } else {
        // 뻗어나간 칸도 제 시각에 튄다. 물보라가 물줄기보다 먼저 나면 앞뒤가 안 맞는다
        FX.splash(cx, cy, T, now + lead);
      }
      break;
    }

    case EVT.BUBBLE:
      FX.pickup(cx, cy, T, now, '#8fd8ff');
      Sound.place(pan, far);
      break;

    case EVT.BLOCK:
      G.tiles[y][x] = TILE.EMPTY;
      floorDirty = true;
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

      // 떠난 칸을 아직 비우지 않는다.
      //
      // 전에는 여기서 바로 옆 칸으로 옮겨 그렸고, 그래서 상자가 순간이동했다.
      // 서버도 밀리는 동안에는 두 칸을 다 막으므로 화면도 그렇게 둔다.
      // 한쪽을 먼저 비우면 예측이 서버보다 앞서 그 칸으로 들어가서 되돌아간다.
      //
      // 미끄러지는 그림은 slides 가 그리고, 다 밀린 뒤에 떠난 칸을 비운다
      if (G.tiles[y] && G.tiles[ny]) {
        G.tiles[ny][nx] = TILE.BOX;
        floorDirty = true;
      }

      slides.push({ fx: x, fy: y, tx: nx, ty: ny, t0: now,
                    ms: (G.C.pushSlide || 15) * G.snapInterval });

      // 밀린 방향으로 먼지가 인다. 밀었다는 게 보여야 다음에도 민다
      FX.push(cx, cy, PX[val], PY[val], T, now, Art.placeAt(x, y).crate);
      Sound.push(pan, far);
      break;
    }

    // 바닥의 아이템이 물줄기에 쓸려갔다.
    //
    // 먹은 것과 나눠 그린다. 먹은 건 누가 가져간 것이라 위로 튀어오르고,
    // 이건 아무도 못 갖는 것이라 그 자리에서 흩어져 사라진다
    case EVT.ITEM_GONE: {
      if (G.items[y]) G.items[y][x] = 0;
      FX.gone(cx, cy, T, now);
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

    case EVT.ITEM: {
      G.items[y][x] = ITEM.NONE;

      const icol = val === ITEM.ULTRA ? '#ffd166' :
                   val === ITEM.BUBBLE ? '#4dabf7' :
                   val === ITEM.POWER ? '#ff922b' : '#51cf66';
      FX.pickup(cx, cy, T, now, icol);

      // 먹은 사람에게로 빨려 들어간다.
      // 반짝이만 튀면 '없어졌다' 까지만 보이고 '누구 것이 됐다' 가 안 보인다.
      // 남이 먹은 것도 보여야 한다 — 저쪽이 세졌다는 게 정보다
      {
        const taker = G.players.get(who);
        if (taker) {
          FX.suck(cx, cy,
                  taker.x1 / G.C.tileUnits * T, taker.y1 / G.C.tileUnits * T,
                  T, now, icol);
        }
      }
      if (mine) {
        // 뭘 먹었는지 HUD 의 그 칸이 튀어오른다. 먹은 순간에만 눈이 간다
        pickFlash[val === ITEM.ULTRA ? ITEM.POWER : val] = now;
        (val === ITEM.ULTRA ? Sound.ultra(pan, far) : Sound.item(pan, far));
      }
      break;
    }

    // 이 게임에서 제일 큰 리턴. 여기만 연출을 아끼지 않는다
    // 걸치기. **이 게임의 정체다.**
    //
    // 몸이 타일보다 작아서(0.8) 두 칸에 걸쳐 설 수 있고, 판정은 몸 중심이 있는
    // 칸으로만 한다. 그래서 반 칸 차이로 물줄기를 피한다.
    //
    // 문제는 **처음 하는 사람이 그게 일어난 줄도 모른다**는 것이었다.
    // 뭔가 파랗게 반짝했는데 왜인지 모르면 그건 연출이지 배움이 아니다.
    //
    // 글자로 설명하지 않는다. 그 순간에만 **내가 서 있던 판정 칸**을 보여준다.
    // 평소에는 안 그린다 — 스물넷이 늘 네모를 달고 다니면 판이 지저분해진다.
    // '네 몸은 여기 걸쳐 있었고 판정은 이 칸이었다' 가 그림 하나로 전해진다
    case EVT.GRAZE:
      FX.graze(cx, cy, T, now, val);
      Sound.graze(val, pan, far);
      if (mine) {
        grazeCell = { x: x, y: y, at: now, n: val };
        FX.punch(0.4 + Math.min(val, 4) * 0.2);
        FX.flashOut('rgba(140,225,255,0.5)', 140, now);
        FX.stop(40, performance.now());   // 아주 짧게. 몸으로 알리되 끊기면 안 된다
      }
      break;

    // 연쇄. 물풍선이 물풍선을 터뜨린다.
    //
    // 소리는 단마다 음이 올라가는데 화면은 늘 같았다. 귀로만 세는 셈이었다.
    // **연쇄는 이 게임에서 제일 큰 판을 뒤집는 수**라 몇 단인지가 보여야 한다.
    // 고리를 단수만큼 크게 퍼뜨린다. 숫자를 안 쓰고 크기로 센다
    case EVT.CHAIN: {
      const step = Math.min(val || 1, 6);
      FX.burstWater(cx, cy, T, now, true);
      FX.ring(cx, cy, T * (0.5 + step * 0.28), now, '#bfe9ff');
      FX.shake(0.10 + step * 0.03);
      Sound.chain(val, pan, far);
      break;
    }

    // 갇혔다. 7초 동안 못 움직이고 남이 와서 마무리한다.
    //
    // **내가 갇힌 순간이 이 게임에서 제일 나쁜 순간이다.** 그런데 흔들림 하나뿐이었다.
    // 나쁜 순간일수록 확실히 알려야 다음 판에 안 그런다 —
    // 뭐가 잘못됐는지 모르고 죽으면 배우는 게 없다.
    //
    // 짧은 정지를 준다. 잡았을 때(120ms)보다 짧게(70ms) — 당한 쪽에 긴 정지를 주면
    // 벌 받는 느낌이 든다. 알리기만 하고 곧바로 돌려준다
    case EVT.TRAP:
      FX.graze(cx, cy, T, now, 1);
      Sound.trap(pan, far);
      if (mine) {
        FX.stop(70, performance.now());
        FX.shake(0.45);
        FX.flashOut('rgba(120,190,255,0.45)', 240, now);
      }
      break;

    case EVT.BREAK: {
      // 스스로 빠져나왔다. 물방울이 터지고 나온 모습을 잠깐 보여준다
      const me2 = G.players.get(who);
      if (me2) me2.freeUntil = now + 380;
      FX.burstWater(cx, cy, T, now, false);
      Sound.breaks(pan, far);
      break;
    }

    // 마무리. 몸으로 부딪쳐 터뜨렸다. 이 게임에서 마무리는 이것뿐이다
    // 마무리. 이 게임에서 제일 통쾌해야 하는 순간인데 밋밋했다.
    //
    // 밋밋했던 이유는 **당한 쪽이 그냥 사라져서**다. 터뜨렸다는 증거가 안 남는다.
    // 그래서 셋을 더한다.
    //   당한 쪽 색으로 물풍선이 터지듯 조각이 흩어진다
    //   내가 잡았으면 화면이 더 오래 멈추고 더 크게 흔들린다
    //   HUD 킬 수가 튀어오른다
    case EVT.POP:
      // 터지는 모습을 잠깐 남긴다. 그다음 뻗은 모습으로 넘어간다
      deathPose.set(who, { x: cx, y: cy, animal: animalOf(who),
                           t0: now, popped: true });
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

    case EVT.DEATH: {
      // 이미 터져서 자세가 남아 있으면 그대로 둔다. 덮어쓰면 터지는 그림이
      // 한 프레임도 안 보이고 지나간다 — POP 과 DEATH 가 같은 틱에 오기 때문이다
      if (!deathPose.has(who)) {
        deathPose.set(who, { x: cx, y: cy, animal: animalOf(who),
                             t0: now, popped: false });
      }
      markDead(who);

      // 사람 하나가 판에서 빠지는 건 이 게임에서 제일 큰 사건이다.
      // **여운(follow-through)** 을 준다 — 터지는 순간뿐 아니라 그 뒤 반 초를 쓴다.
      //   1) 그 사람 색으로 터진다. 누가 죽었는지가 색으로 남는다
      //   2) 고리가 한 번 크게 퍼진다. 판 건너에서도 '저기서 하나 죽었다' 가 보인다
      //   3) 남은 사람 수가 HUD 에서 튀어오른다
      const col = colorOf(who);
      FX.kill(cx, cy, T, now, col);
      FX.ring(cx, cy, T, now, col);
      alivePop = now;

      Sound.death(pan, far);
      if (mine) { FX.shake(0.6); FX.flashOut('rgba(180,30,30,0.6)', 300, now); }
      break;
    }

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
    if (dx !== 0 || dy !== 0) hasMoved = true;   // 한 발짝이라도 뗐으면 안내를 지운다
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
  if (e.key === ' ') { hasPlaced = true; sendPlace(); return; }

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
