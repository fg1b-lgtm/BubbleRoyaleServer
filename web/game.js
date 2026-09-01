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

// 시간. 멈춤(hit stop) 동안 gameTime 이 안 흐른다
let gameTime = 0, lastFrame = 0, snapAtGame = 0;
let killFeed = [];
let banner = null;
let lastBeep = -1;
let lastPhase = -1;
let danger = false;

const PLAYER_COLORS = [
  '#ff6b6b', '#4dabf7', '#51cf66', '#ffd43b', '#cc5de8', '#ff922b',
  '#20c997', '#f06595', '#748ffc', '#94d82d', '#ffa8a8', '#66d9e8',
  '#e599f7', '#ffc078', '#63e6be', '#faa2c1', '#a5d8ff', '#d8f5a2',
  '#ffe066', '#b197fc', '#38d9a9', '#ff8787', '#4dd4ac', '#f783ac',
];
const colorOf = (id) => PLAYER_COLORS[id % PLAYER_COLORS.length];

// ── 화면 크기 ────────────────────────────────────────────────
//
// 타일 크기를 화면에 맞춰 고른다. 24 픽셀쯤이 캐릭터 얼굴이 보이는 최소 크기다.
//
// devicePixelRatio 를 곱해서 실제 픽셀로 그린다.
// 이걸 안 하면 고해상도 화면에서 선과 글자가 흐릿해진다.
// 흐릿한 화면은 그 자체로 "덜 만든 것" 처럼 보인다
function resize() {
  if (!G.C) return;

  const availW = Math.max(360, window.innerWidth  - 48);
  const availH = Math.max(320, window.innerHeight - 150);
  const ts = Math.max(14, Math.min(30,
    Math.floor(Math.min(availW / G.C.mapW, availH / G.C.mapH))));

  Art.setScale(ts);
  W = G.C.mapW * ts;
  H = G.C.mapH * ts;

  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width  = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width  = W + 'px';
  cv.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  floorCv = document.createElement('canvas');
  floorCv.width = Math.round(W * dpr); floorCv.height = Math.round(H * dpr);
  floorCtx = floorCv.getContext('2d');
  floorCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const rowH = Art.V.TOP + ts + Art.V.BOT;
  rowCv = [];
  for (let y = 0; y < G.C.mapH; ++y) {
    const c = document.createElement('canvas');
    c.width = Math.round(W * dpr); c.height = Math.round(rowH * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    rowCv.push({ cv: c, g });
  }

  floorDirty = true;
  for (let y = 0; y < G.C.mapH; ++y) dirtyRows.add(y);
  foamKey = '';
}

function rebuild() {
  if (!G.C || !floorCtx) return;

  if (floorDirty) {
    floorCtx.clearRect(0, 0, W, H);
    Art.buildFloor(floorCtx, G.tiles, G.C.mapW, G.C.mapH);
    floorDirty = false;
  }

  if (dirtyRows.size) {
    const rowH = Art.V.TOP + Art.V.TS + Art.V.BOT;
    for (const y of dirtyRows) {
      const r = rowCv[y];
      if (!r) continue;
      r.g.clearRect(0, 0, W, rowH);
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
  drawWorld(gameTime, dt);
  drawHUD(gameTime);
}

function drawWorld(now, dt) {
  const T = Art.V.TS;
  const th = Art.V.th;

  ctx.fillStyle = th.sky;
  ctx.fillRect(0, 0, W, H);

  FX.apply(ctx, now, W, H, dt);

  ctx.drawImage(floorCv, 0, 0, W, H);

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
  // 바닥에 깔린 물이라 벽보다 아래에 그린다.
  // 터진 직후에는 하얗게 타오르고, 사그라들면서 파란 물웅덩이가 된다
  G.blasts = G.blasts.filter(b => b.until > now);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of G.blasts) {
    const total = (G.C.blast / G.C.tickRate) * 1000;
    const age = 1 - (b.until - now) / total;
    const cx = b.x * T + T / 2, cy = b.y * T + T / 2;

    const heat = Math.max(0, 1 - age * 3.2);          // 앞의 1/3 만 하얗게 탄다
    const r = T * (0.5 + Art.easeOut(Math.min(1, age * 2)) * 0.35);

    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.5);
    g.addColorStop(0, 'rgba(' + (170 + heat * 85) + ',' + (225 + heat * 30) + ',255,' + (0.55 * (1 - age) + heat * 0.4) + ')');
    g.addColorStop(0.6, 'rgba(90,180,240,' + (0.35 * (1 - age)) + ')');
    g.addColorStop(1, 'rgba(60,140,220,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r * 1.5, cy - r * 1.5, r * 3, r * 3);
  }
  ctx.restore();

  // ── 줄 정렬 ────────────────────────────────────────────────
  //
  // 사람과 물풍선을 발이 닿은 줄로 나눠 담고, 줄 그림 사이에 끼워 그린다
  const rows = G.C.mapH;
  const bucketP = new Array(rows), bucketB = new Array(rows);
  for (let i = 0; i < rows; ++i) { bucketP[i] = null; bucketB[i] = null; }

  const alpha = Math.min(1, (now - snapAtGame) / G.snapInterval);

  for (const [id, p] of G.players) {
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

  for (let y = 0; y < rows; ++y) {
    ctx.drawImage(rowCv[y].cv, 0, y * T - Art.V.TOP, W, rowH);

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
      drawPlayer(id, p, alpha, now, T);
    }
  }

  FX.draw(ctx, now);

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

  // 판정 칸. 아주 희미하게. 눈에 걸리면 안 된다 (SPEC 2.3)
  if (!dead) {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(p.jtx * T + 0.5, p.jty * T + 0.5, T - 1, T - 1);
  }

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
    if (inWater(p.jtx, p.jty)) FX.ripple(px, py + r * 0.9, T, now);
    else                       FX.step(px, py + r * 0.9, T, now);
    if (id === G.myId) Sound.step(panOf(px));
  }

  ctx.globalAlpha = dead ? 0.20
                  : ((p.flags & PF.INVULN) && (now / 80 | 0) % 2 ? 0.4 : 1);

  Art.drawChar(ctx, px, py, r, colorOf(id), {
    face: p.face | 0,
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

  // 물에 잠긴 데 서 있다. 머리 위로 숨이 올라간다.
  // 느낌표를 띄우면 글자고, 이건 그림이다
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
  }
}

function inWater(tx, ty) {
  const s = Math.min(2, Math.floor(ty / G.C.sectorH)) * 3 + Math.min(2, Math.floor(tx / G.C.sectorW));
  if (G.sectors[s] === SECT.FLOODED) return true;
  if (G.ring.on && (tx < G.ring.x0 || tx > G.ring.x1 || ty < G.ring.y0 || ty > G.ring.y1)) return true;
  return false;
}

// 화면에서 난 자리를 좌우 어디로 들리게 할지
function panOf(px) { return Math.max(-1, Math.min(1, (px / W) * 2 - 1)) * 0.8; }

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
  panel(10, 10, 132, 44, 8);
  label('ROUND', 22, 28, 10, 'rgba(255,255,255,0.45)', 'left', 2);
  bigNum(String(G.roundNo + 1), 22, 48, 20, '#fff');

  const phaseName = ['대기', '시작', '진행', '결과'][G.phase] || '';
  label(phaseName, 128, 48, 12, 'rgba(255,255,255,0.55)', 'right');

  // 남은 사람. 숫자 하나가 제일 크다. 이 게임에서 제일 중요한 숫자다
  panel(W / 2 - 90, 10, 180, 44, 8);
  bigNum(String(G.aliveCount), W / 2 - 44, 48, 26, '#fff', 'right');
  label('생존', W / 2 - 36, 46, 12, 'rgba(255,255,255,0.55)');

  // 누가 살아 있나. 칸 스물넷. 내 칸만 하얗다.
  // 숫자만 있으면 몇인지는 알아도 누가 남았는지는 모른다
  {
    const n = 24, pw = 4, gap = 1.6;
    const total = n * pw + (n - 1) * gap;
    let x = W / 2 + 78 - total;
    for (let i = 0; i < n; ++i) {
      const p = G.players.get(i);
      const alive = p && (p.flags & PF.ALIVE);
      ctx.fillStyle = !p ? 'rgba(255,255,255,0.08)'
                    : alive ? (i === G.myId ? '#ffffff' : colorOf(i))
                    : 'rgba(255,255,255,0.14)';
      ctx.fillRect(x, 20, pw, alive ? 10 : 5);
      x += pw + gap;
    }
    label('SLOT', W / 2 + 78, 46, 9, 'rgba(255,255,255,0.30)', 'right', 2);
  }

  // 시각. 침수 일정이 몇 분에 오는지가 이 숫자로만 읽힌다
  {
    const sec = Math.floor(G.tick / G.C.tickRate);
    const mm = String(Math.floor(sec / 60));
    const ss = String(sec % 60).padStart(2, '0');
    panel(W - 106, 10, 96, 44, 8);
    label('TIME', W - 94, 28, 10, 'rgba(255,255,255,0.45)', 'left', 2);
    bigNum(mm + ':' + ss, W - 20, 48, 20, '#fff', 'right');
  }

  // ── 내 능력치 ──────────────────────────────────────────────
  //
  // 숫자만 적으면 몇 개인지는 알아도 상한까지 얼마 남았는지를 모른다.
  // 칸으로 그리면 둘 다 한눈에 보인다
  const me = G.players.get(G.myId);
  if (me) {
    const bx = 10, by = H - 62, bw = 186, bh = 52;
    panel(bx, by, bw, bh, 8);

    const stats = [
      { c: '#4dabf7', v: 1 + me.bubble_lv, max: 5, t: '물풍선' },
      { c: '#ff922b', v: 2 + me.power_lv,  max: 6, t: '물줄기' },
      { c: '#51cf66', v: me.speed_lv,      max: 4, t: '속도'   },
    ];
    stats.forEach((s, i) => {
      const y = by + 15 + i * 13;
      ctx.fillStyle = s.c;
      ctx.beginPath(); ctx.arc(bx + 15, y - 3, 4, 0, 7); ctx.fill();
      label(s.t, bx + 25, y, 10, 'rgba(255,255,255,0.55)');

      for (let k = 0; k < s.max; ++k) {
        ctx.fillStyle = k < s.v ? s.c : 'rgba(255,255,255,0.12)';
        ctx.fillRect(bx + 74 + k * 13, y - 8, 10, 7);
      }
      label(String(s.v), bx + bw - 12, y, 11, '#fff', 'right');
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
      if (!(p.flags & PF.ALIVE)) continue;
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
    const y = 66 + i * 26;
    const x = W - 10 - 150 + (1 - slide) * 40;

    panel(x, y, 150, 22, 5);
    ctx.fillStyle = colorOf(k.killer);
    ctx.beginPath(); ctx.arc(x + 14, y + 11, 4, 0, 7); ctx.fill();
    label('P' + k.killer, x + 24, y + 15, 11, '#fff');
    label('▸', x + 66, y + 15, 11, 'rgba(255,255,255,0.4)');
    ctx.fillStyle = colorOf(k.victim);
    ctx.beginPath(); ctx.arc(x + 88, y + 11, 4, 0, 7); ctx.fill();
    label('P' + k.victim, x + 98, y + 15, 11, 'rgba(255,255,255,0.7)');
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
    scrim(0.55);
    const t = Math.min(1, G.phaseTicks / (G.C.tickRate * 0.4));
    const k = Art.overshoot(t);

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(0.6 + k * 0.4, 0.6 + k * 0.4);
    if (G.winner === 0xFF)          bigNum('무승부', 0, 8, 44, '#ffd166', 'center');
    else if (G.winner === G.myId)   bigNum('이겼다', 0, 8, 52, '#7ee787', 'center');
    else                            bigNum('P' + G.winner + ' 승리', 0, 8, 40, '#8ab4ff', 'center');
    ctx.restore();

    const left = Math.max(0, Math.ceil((G.C.tickRate * 5 - G.phaseTicks) / G.C.tickRate));
    label('다음 판까지 ' + left, W / 2, H / 2 + 44, 13, 'rgba(255,255,255,0.6)', 'center');
  }
  else if (me && !(me.flags & PF.ALIVE)) {
    // 죽어도 판은 계속 보인다. 스냅샷이 어차피 전원에게 오니 관전은 공짜다
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.fillRect(0, H / 2 - 22, W, 44);
    label('관전 중', W / 2, H / 2 + 6, 18, '#ff8f8f', 'center', 2);
  }

  if (!G.connected) {
    scrim(0.6);
    label('서버와 끊겼다', W / 2, H / 2, 20, '#ff8f8f', 'center', 1);
    label('2초마다 다시 붙어 본다', W / 2, H / 2 + 24, 12, 'rgba(255,255,255,0.5)', 'center');
  }
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
  Art.setTheme(G.C.seed);
  resize();
  FX.reset();
  killFeed = [];
  banner = null;
  lastBeep = -1;
  const el = document.getElementById('theme');
  if (el) el.textContent = Art.V.th.name;
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
    if (G.phase === PHASE.PLAYING) { Sound.start(); FX.flashOut('#ffffff', 220, gameTime); }
    if (G.phase === PHASE.OVER)    (G.winner === G.myId ? Sound.win() : Sound.lose());
    lastBeep = -1;
  }
};

Hooks.event = function (type, x, y, who, val) {
  const T = Art.V.TS;
  const now = gameTime;
  const cx = x * T + T / 2, cy = y * T + T / 2;
  const pan = panOf(cx);
  const mine = (who === G.myId);

  switch (type) {
    case EVT.BLAST:
      G.blasts.push({ x, y, until: now + (G.C.blast / G.C.tickRate) * 1000 });
      FX.burstWater(cx, cy, T, now, false);
      FX.shake(0.16);
      Sound.boom(pan);
      break;

    case EVT.BUBBLE:
      FX.pickup(cx, cy, T, now, '#8fd8ff');
      break;

    case EVT.BLOCK:
      G.tiles[y][x] = TILE.EMPTY;
      dirtyRows.add(y);
      FX.breakCrate(cx, cy, T, now, Art.V.th.crate, Art.V.th.crateSide);
      Sound.crack(pan);
      break;

    case EVT.DROP:
      G.items[y][x] = val;
      if (val === ITEM.ULTRA) {
        FX.kill(cx, cy, T, now, '#ffd166');
        FX.shake(0.12);
      }
      Sound.drop(pan);
      break;

    case EVT.ITEM:
      G.items[y][x] = ITEM.NONE;
      FX.pickup(cx, cy, T, now,
                val === ITEM.ULTRA ? '#ffd166' :
                val === ITEM.BUBBLE ? '#4dabf7' :
                val === ITEM.POWER ? '#ff922b' : '#51cf66');
      if (mine) (val === ITEM.ULTRA ? Sound.ultra(pan) : Sound.item(pan));
      break;

    // 이 게임에서 제일 큰 리턴. 여기만 연출을 아끼지 않는다
    case EVT.GRAZE:
      FX.graze(cx, cy, T, now, val);
      Sound.graze(val, pan);
      if (mine) {
        FX.punch(0.4 + Math.min(val, 4) * 0.2);
        FX.flashOut('rgba(140,225,255,0.5)', 140, now);
      }
      break;

    case EVT.CHAIN:
      FX.burstWater(cx, cy, T, now, true);
      FX.shake(0.10);
      Sound.chain(val, pan);
      break;

    case EVT.TRAP:
      FX.graze(cx, cy, T, now, 1);
      Sound.trap(pan);
      if (mine) FX.shake(0.3);
      break;

    case EVT.BREAK:
      FX.burstWater(cx, cy, T, now, false);
      Sound.breaks(pan);
      break;

    // 마무리. 몸으로 부딪쳐 터뜨렸다. 이 게임에서 마무리는 이것뿐이다
    case EVT.POP:
      FX.kill(cx, cy, T, now, colorOf(val));
      FX.shake(0.5);
      FX.stop(70, performance.now());     // 아주 잠깐 화면이 멈춘다
      FX.flashOut('rgba(255,255,255,0.55)', 120, now);
      killFeed.unshift({ killer: val, victim: who, born: now });
      killFeed = killFeed.slice(0, 5);
      Sound.pop(pan);
      break;

    case EVT.DEATH:
      FX.kill(cx, cy, T, now, '#ff6b6b');
      Sound.death(pan);
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
