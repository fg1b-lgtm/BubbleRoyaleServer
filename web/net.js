// web/net.js — 서버와 이야기하고 판의 상태를 들고 있는다
//
// 게임 규칙 상수를 여기 하나도 안 적는다. 서버가 WELCOME 으로 보내준다.
// 같은 숫자를 두 군데 적으면 한쪽만 고쳤을 때 서버와 화면이 갈린다.
// SPEC 1절의 "이 파일이 갈리면 그게 곧 버그다" 가 그 얘기다.
//
// 여기는 화면을 모른다. 받은 것을 G 에 넣고 Hooks 를 부르기만 한다.
// 그래서 tools/clienttest.js 가 화면 없이도 이 파일을 그대로 돌릴 수 있다.

const PKT  = { ECHO:1, MOVE:2, PLACE:3, EVENT:4, WELCOME:5, MAPROW:6, SNAPSHOT:7, RESTART:8 };
const EVT  = { GRAZE:1, CHAIN:2, TRAP:3, BREAK:4, DEATH:5, ITEM:6, BLOCK:7, BUBBLE:8, BLAST:9,
               FLOOD_WARN:10, FLOOD:11, DROWN:12, DROP:13, RING:14, POP:15 };
const TILE = { EMPTY:0, WALL:1, BLOCK:2, BUBBLE:3 };
const ITEM = { NONE:0, BUBBLE:1, POWER:2, ROLLER:3, ULTRA:4 };
const SECT = { OPEN:0, WARNING:1, FLOODED:2 };
const PHASE= { WAITING:0, COUNTDOWN:1, PLAYING:2, OVER:3 };

// PlayerState.flags. Common/Protocol.h 와 자리가 같아야 한다
const PF = { ALIVE:1, TRAPPED:2, INVULN:4, DROWNING:8, MOVING:16,
             FACE_SHIFT:5, FACE_MASK:3 << 5 };
const FACE = { DOWN:0, LEFT:1, RIGHT:2, UP:3 };

const HEADER_SIZE = 4;

// ── 판의 상태 한 덩어리 ──────────────────────────────────────
const G = {
  C: null,                    // 서버가 준 상수
  myId: -1,
  tiles: null, items: null,
  sectors: new Array(9).fill(SECT.OPEN),
  players: new Map(),
  bubbles: [],
  blasts: [],                 // {x,y,born,until}
  ring: { on:false, x0:0, y0:0, x1:0, y1:0 },

  phase: PHASE.WAITING, phaseTicks: 0, winner: 0xFF, roundNo: 0, tick: 0,

  // 살아 있는 사람 수와 누가 살아 있나. 둘 다 서버가 전역으로 보내준다.
  // AOI 로 걸러진 players 를 세면 내 구역 사람만 세게 된다
  aliveCount: 0,
  aliveMask: [0, 0, 0],

  lastSnapAt: 0, snapInterval: 33,
  connected: false,
};

// 화면 쪽이 갈아 끼운다. 여기서는 비어 있어도 돌아간다
const Hooks = {
  welcome() {}, mapRow() {}, snapshot() {}, event() {}, conn() {},
};

// ── 받은 패킷 풀기 ───────────────────────────────────────────
function onPacket(v) {
  const id = v.getUint16(2, true);
  if (id === PKT.WELCOME)  return onWelcome(v);
  if (id === PKT.MAPROW)   return onMapRow(v);
  if (id === PKT.SNAPSHOT) return onSnapshot(v);
  if (id === PKT.EVENT)    return onEvent(v);
}

function onWelcome(v) {
  // WelcomeBody 를 적힌 순서대로 읽는다. 서버가 pack(1) 로 보내므로 빈칸이 없다
  let o = HEADER_SIZE;
  const u8  = () => v.getUint8(o++);
  const u16 = () => { const n = v.getUint16(o, true); o += 2; return n; };
  const u32 = () => { const n = v.getUint32(o, true); o += 4; return n; };

  G.C = {
    myId: u8(), mapW: u8(), mapH: u8(), sectorW: u8(), sectorH: u8(),
    tickRate: u8(), tileUnits: u16(), fuse: u16(), trap: u16(),
    floodEsc: u16(), blast: u8(), bodyNum: u8(), bodyDen: u8(), peek: u8(), camHyst: u8(), seed: u32(),
    sectorKind: [],
  };
  // 아홉 자리에 어떤 조각이 깔렸나. 규칙이 아니라 **화면용**이다.
  // 구역마다 다른 장소처럼 그리는 데 쓴다
  for (let i = 0; i < 9; ++i) G.C.sectorKind.push(u8());
  G.myId = G.C.myId;
  G.snapInterval = 1000 / G.C.tickRate;

  // 다시 시작하면 WELCOME 이 또 온다. 지난 판의 흔적을 지운다
  G.bubbles = [];
  G.blasts  = [];
  G.players.clear();
  G.sectors.fill(SECT.OPEN);
  G.ring.on = false;

  G.tiles = Array.from({ length: G.C.mapH }, () => new Uint8Array(G.C.mapW));
  G.items = Array.from({ length: G.C.mapH }, () => new Uint8Array(G.C.mapW));

  Hooks.welcome();
}

function onMapRow(v) {
  if (!G.C) return;
  const y = v.getUint8(HEADER_SIZE);
  let o = HEADER_SIZE + 1;
  for (let x = 0; x < G.C.mapW; ++x) G.tiles[y][x] = v.getUint8(o + x);
  o += G.C.mapW;
  for (let x = 0; x < G.C.mapW; ++x) G.items[y][x] = v.getUint8(o + x);
  Hooks.mapRow(y);
}

function onSnapshot(v) {
  if (!G.C) return;
  let o = HEADER_SIZE;

  G.tick = v.getUint32(o, true); o += 4;
  for (let i = 0; i < 9; ++i) G.sectors[i] = v.getUint8(o + i);
  o += 9;

  const prevPhase = G.phase;
  G.phase      = v.getUint8(o++);
  G.phaseTicks = v.getUint16(o, true); o += 2;
  G.winner     = v.getUint8(o++);
  G.roundNo    = v.getUint8(o++);

  G.ring.x0 = v.getUint8(o++);
  G.ring.y0 = v.getUint8(o++);
  G.ring.x1 = v.getUint8(o++);
  G.ring.y1 = v.getUint8(o++);
  G.ring.on = (G.ring.x0 !== 0xFF);

  // 생존자는 전역이다. 뒤에 붙는 사람 목록은 AOI 로 걸러져서 내 구역만 오지만,
  // 몇 명이 남았는지는 전부 세어서 온다
  G.aliveCount = v.getUint8(o++);
  const mask = [v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2)];
  o += 3;
  G.aliveMask = mask;

  const np = v.getUint8(o++);
  const nb = v.getUint8(o++);

  const seen = new Set();
  for (let i = 0; i < np; ++i) {
    const id = v.getUint8(o);
    const x  = v.getUint16(o + 1, true);
    const y  = v.getUint16(o + 3, true);
    const p  = G.players.get(id) || { x0: x, y0: y, walk: 0 };

    // 스냅샷은 초당 30번인데 화면은 60번 그린다.
    // 지난 위치와 이번 위치 사이를 시간으로 나눠 그리면 끊겨 보이지 않는다
    p.x0 = (p.x1 === undefined) ? x : p.x1;
    p.y0 = (p.y1 === undefined) ? y : p.y1;
    p.x1 = x;
    p.y1 = y;
    p.jtx   = v.getUint8(o + 5);
    p.jty   = v.getUint8(o + 6);
    p.flags = v.getUint8(o + 7);
    p.bubble_lv = v.getUint8(o + 8);
    p.power_lv  = v.getUint8(o + 9);
    p.speed_lv  = v.getUint8(o + 10);

    // 보는 쪽과 걷는지는 서버가 flags 에 얹어 보낸다.
    // 위치 두 개를 빼서 알아낼 수도 있지만, 서 있으면 위치가 안 변해서
    // 마지막으로 보던 쪽을 잃어버린다
    p.face   = (p.flags & PF.FACE_MASK) >> PF.FACE_SHIFT;
    p.moving = !!(p.flags & PF.MOVING);

    // 걸음의 위상. 시간이 아니라 **간 거리**로 돈다.
    // 시간으로 돌리면 롤러를 먹어 빨라져도 발은 그대로라 미끄러진다
    const step = Math.abs(p.x1 - p.x0) + Math.abs(p.y1 - p.y0);
    p.walk += step / G.C.tileUnits * 7.5;
    p.stepped = Math.floor(p.walk / Math.PI);

    G.players.set(id, p);
    seen.add(id);
    o += 11;
  }
  // 안 온 사람은 **지우지 않고 안 보이는 것으로 표시만 한다.**
  //
  // AOI 를 켜면 옆 구역으로 간 사람이 목록에서 빠진다. 지워버리면
  // 결과 화면에서 그 사람이 통째로 사라진다. 판이 끝나고 순위를 매길 때
  // "옆 구역에서 죽은 사람" 이 없는 것으로 나오면 그건 틀린 표다.
  //
  // 그리는 건 보이는 사람만 그린다. 기억만 남긴다
  for (const [id, p] of G.players) p.visible = seen.has(id);

  G.bubbles = [];
  for (let i = 0; i < nb; ++i) {
    G.bubbles.push({
      tx: v.getUint8(o), ty: v.getUint8(o + 1),
      fuse: v.getUint8(o + 2), owner: v.getUint8(o + 3),
    });
    o += 4;
  }

  G.lastSnapAt = performance.now();
  Hooks.snapshot(prevPhase);
}

function onEvent(v) {
  if (!G.C) return;
  Hooks.event(v.getUint8(HEADER_SIZE),
              v.getUint8(HEADER_SIZE + 1),
              v.getUint8(HEADER_SIZE + 2),
              v.getUint8(HEADER_SIZE + 3),
              v.getUint8(HEADER_SIZE + 4));
}

// ── 보내기 ───────────────────────────────────────────────────
let ws = null;

function send(bytes) {
  if (ws && ws.readyState === 1) ws.send(bytes);
}

function sendMove(dx, dy) {
  const b = new DataView(new ArrayBuffer(HEADER_SIZE + 2));
  b.setUint16(0, HEADER_SIZE + 2, true);
  b.setUint16(2, PKT.MOVE, true);
  b.setInt8(4, dx);
  b.setInt8(5, dy);
  send(b.buffer);
}

function sendPlace() {
  const b = new DataView(new ArrayBuffer(HEADER_SIZE));
  b.setUint16(0, HEADER_SIZE, true);
  b.setUint16(2, PKT.PLACE, true);
  send(b.buffer);
}

function sendRestart() {
  const b = new DataView(new ArrayBuffer(HEADER_SIZE));
  b.setUint16(0, HEADER_SIZE, true);
  b.setUint16(2, PKT.RESTART, true);
  send(b.buffer);
}

function connect() {
  ws = new WebSocket('ws://' + location.host + '/ws');
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => { G.connected = true; Hooks.conn(); };
  ws.onclose = () => {
    G.connected = false;
    Hooks.conn();
    setTimeout(connect, 2000);
  };
  // 다리가 패킷 하나를 프레임 하나로 잘라서 보낸다. 경계를 여기서 안 따져도 된다
  ws.onmessage = (e) => onPacket(new DataView(e.data));
}
