// tools/arttest.js — 아트를 눈이 아니라 숫자로 본다
//
// 9/1 에 화면을 통째로 다시 만들었는데, 그 뒤로 아무도 검사하지 않았다.
// "느낌이 좋아졌다" 는 다시 돌려볼 수 없는 문장이라, 다음에 뭘 고쳤을 때
// 나빠졌는지 알 방법이 없다.
//
// 무엇을 재나 (게임 회사 직군 이름을 그대로 붙였다)
//   원화/컨셉   장소 열 곳의 색이 서로 구별되나. 두 곳이 같은 색이면 한 곳이다
//   애니메이터  서기 네 방향과 걷기가 진짜 다른 그림인가.
//               상태만 다르고 같은 그림이면 "방향별로 나눴다" 가 거짓이 된다
//   이펙터      폭발 한 번에 그리는 양이 얼마나 튀나. 그리고 조각이 사라지나
//
// 그리지는 않는다. 캔버스가 받은 명령을 순서까지 다 적어두고 비교한다.
// 같은 그림이면 명령 순서가 같고, 다른 그림이면 다르다.
//
// 실행: node tools/arttest.js   (서버가 필요 없다)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { colorDist, luminance } = require('./colorlib');

let pass = 0, fail = 0;
const check = (ok, what) => {
    if (ok) { ++pass; console.log('  [PASS] ' + what); }
    else    { ++fail; console.log('  [FAIL] ' + what); }
};

// ── 명령을 순서까지 적는 가짜 캔버스 ─────────────────────────
let log = [];
let counting = false;

function rec(name, args) {
    if (counting) log.push(name + (args === undefined ? '' : ':' + args));
}

function makeCtx() {
    const nop = (n) => (...a) => rec(n, a.map(v =>
        typeof v === 'number' ? Math.round(v * 10) / 10 : v).join(','));
    const grad = { addColorStop: (p, c) => rec('stop', p + ',' + c) };

    const ctx = {
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        lineWidth: 1, lineCap: '', lineJoin: '',
        font: '', textAlign: '', textBaseline: '', letterSpacing: '',
        shadowColor: '', shadowBlur: 0, shadowOffsetY: 0,

        setTransform: nop('setTransform'),
        clearRect: nop('clearRect'), fillRect: nop('fillRect'),
        strokeRect: nop('strokeRect'), fillText: nop('fillText'),
        strokeText: nop('strokeText'), measureText: () => ({ width: 10 }),
        beginPath: nop('beginPath'), closePath: nop('closePath'),
        moveTo: nop('moveTo'), lineTo: nop('lineTo'),
        quadraticCurveTo: nop('quadraticCurveTo'),
        arc: nop('arc'), ellipse: nop('ellipse'), rect: nop('rect'), clip: nop('clip'),
        fill: nop('fill'), stroke: nop('stroke'),
        save: nop('save'), restore: nop('restore'),
        translate: nop('translate'), rotate: nop('rotate'), scale: nop('scale'),
        drawImage: nop('drawImage'),
        createLinearGradient: () => { rec('grad'); return grad; },
        createRadialGradient: () => { rec('rgrad'); return grad; },
        createPattern: () => { rec('pattern'); return {}; },
    };

    // 색을 넣는 것도 그림의 일부다. 색만 바꾼 그림은 다른 그림이다
    let fillNow = '', strokeNow = '';
    Object.defineProperty(ctx, 'fillStyle', {
        get: () => fillNow,
        set: (v) => { fillNow = v; rec('fill=', String(v)); },
    });
    Object.defineProperty(ctx, 'strokeStyle', {
        get: () => strokeNow,
        set: (v) => { strokeNow = v; rec('stroke=', String(v)); },
    });
    return ctx;
}

const el = () => ({
    width: 0, height: 0, textContent: '', className: '', style: {},
    addEventListener() {}, blur() {}, getContext: () => makeCtx(),
});

const sandbox = {
    console, Math, Date, JSON, Object, Array, String, Number, Boolean, Set, Map,
    isNaN, parseInt, parseFloat, Infinity, NaN, undefined,
    requestAnimationFrame: () => 0,
    setTimeout: () => 0, setInterval: () => 0,
    performance: { now: () => 0 },
    devicePixelRatio: 1,
    innerWidth: 1600, innerHeight: 900,
    document: {
        getElementById: () => el(), querySelector: () => el(),
        createElement: () => el(), addEventListener() {},
        body: { appendChild() {}, style: {} },
    },
    window: null,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const webDir = path.join(__dirname, '..', 'web');
for (const f of ['artdata.js', 'art.js', 'fx.js']) {
    vm.runInContext(fs.readFileSync(path.join(webDir, f), 'utf8'), sandbox, { filename: f });
}
const Art = vm.runInContext('Art', sandbox);
const FX  = vm.runInContext('FX',  sandbox);

const ctx = makeCtx();
const draw = (fn) => { log = []; counting = true; fn(); counting = false; return log.slice(); };

console.log('\n=== 원화 · 컨셉: 장소 열 곳이 서로 구별되나 ===\n');

// 바닥과 벽 위쪽이 그 장소의 첫인상이다. 둘의 평균 거리로 본다
let worst = { d: 1e9, a: '', b: '' };
const table = [];

for (let i = 0; i < Art.PLACES.length; ++i) {
    let near = { d: 1e9, name: '' };
    for (let j = 0; j < Art.PLACES.length; ++j) {
        if (i === j) continue;
        const d = (colorDist(Art.PLACES[i].floor,   Art.PLACES[j].floor)
                 + colorDist(Art.PLACES[i].wallTop, Art.PLACES[j].wallTop)) / 2;
        if (d < near.d) near = { d: d, name: Art.PLACES[j].name };
        if (d < worst.d) worst = { d: d, a: Art.PLACES[i].name, b: Art.PLACES[j].name };
    }
    table.push([Art.PLACES[i].name, near.name, near.d]);
}

table.sort((a, b) => a[2] - b[2]);
console.log('  장소        제일 닮은 곳   색거리');
for (const row of table) {
    console.log('  ' + row[0].padEnd(10) + row[1].padEnd(14) + row[2].toFixed(1));
}
console.log('  (10 아래면 나란히 놓아야 겨우 구분된다. 20 넘으면 확실히 다르다)\n');

check(worst.d >= 12,
      '제일 닮은 두 곳도 구별된다 (' + worst.a + ' / ' + worst.b
      + ', 색거리 ' + worst.d.toFixed(1) + ')');

// ── 애니메이터 ───────────────────────────────────────────────
// 장소마다 물건이 다르게 생겼나.
//
// 색만 다르고 모양이 같으면 같은 판에 페인트를 열 번 칠한 것이다.
// 벽 무늬와 상자 무늬를 종류별로 세어, 열 곳이 몇 가지 모양을 쓰는지 본다
// ── 읽힘의 법칙 ─────────────────────────────────────────────
//
// 세계관을 말로 짓는 대신 **읽는 법칙**을 세운다. 이 게임은 0.3초 안에
// '어디가 막혔나 · 어디가 위험한가' 를 읽어야 사는 게임이고, 그게 안 되면
// 아무리 예뻐도 못 만든 게임이다.
//
//   법칙 1  색은 장소가 갖고, **명도는 게임이 갖는다**
//           장소는 색조로만 다르다. 바닥이 밝고 상자가 중간이고 벽이 어둡다 —
//           이 순서와 간격이 열 곳에서 같아야 어디서나 같은 방식으로 읽힌다
//
//   법칙 2  **위험색은 독점한다**
//           물줄기의 밝은 청록은 판의 어떤 것도 쓰지 않는다.
//           얼음골이 그 색을 쓰면 위험이 배경에 묻힌다
//
//   법칙 3  UI 는 판과 같은 재료로 만든다 (아래 별도)
console.log('');
console.log('=== 법칙 1: 명도 순서가 어디서나 같은가 ===');
console.log('');

// 상대휘도. 0 이 검정, 1 이 흰색
const lum = (hex) => luminance(hex);

console.log('  장소        바닥   상자   벽위   벽옆   상자-바닥');

let orderBad = [], gapBad = [];
const gaps = [];

for (const pl of Art.PLACES) {
    const f = lum(pl.floor), c = lum(pl.crate);
    const wt = lum(pl.wallTop), ws = lum(pl.wallSide);
    const g1 = c - f;
    gaps.push([pl.name, g1, f - wt]);

    console.log('  ' + pl.name.padEnd(10)
                + f.toFixed(2).padStart(5) + c.toFixed(2).padStart(7)
                + wt.toFixed(2).padStart(7) + ws.toFixed(2).padStart(7)
                + g1.toFixed(2).padStart(11));

    // **상자 > 바닥 > 못 부수는 벽.**
    //
    // 9/3 에 순서를 뒤집었다. 전에는 바닥이 제일 밝았는데, 바닥은 화면에서
    // 제일 넓은 면이다. 제일 넓은 면이 제일 밝으면 그 위에 놓인 물건이
    // 전부 바닥에 눌린다. 확대해서 보고 알았다 — 상자도 벽도 다 뿌옜다.
    //
    // 배경은 조용하고 어두워야 하고, 만질 수 있는 것이 떠 있어야 한다.
    // 부술 수 있는 상자가 제일 밝은 것도 그래서다. 눈이 먼저 가야 하는 것이
    // 판을 바꿀 수 있는 것이어야 한다.
    //
    // 못 부수는 벽이 제일 어두운 건 그대로 둔다. 벽이 상자보다 밝으면
    // '못 부수는 것' 이 더 가벼워 보인다
    if (!(c > f && f > wt && wt > ws)) orderBad.push(pl.name);
}

check(orderBad.length === 0,
      '어디서나 상자 > 바닥 > 벽 순으로 어두워진다 (부술 수 있는 것이 제일 밝다)'
      + (orderBad.length ? ' — 뒤집힌 곳: ' + orderBad.join(', ') : ''));

// 간격이 들쭉날쭉하면 어떤 장소는 막힌 데가 잘 보이고 어떤 장소는 안 보인다.
// 제일 큰 곳과 제일 작은 곳의 차이를 본다
{
    const g1s = gaps.map(g => g[1]);
    const spread = Math.max(...g1s) - Math.min(...g1s);
    console.log('');
    console.log('  상자-바닥 간격이 ' + Math.min(...g1s).toFixed(2)
                + ' ~ ' + Math.max(...g1s).toFixed(2) + ' 로 벌어져 있다 (차이 '
                + spread.toFixed(2) + ')');
    check(spread <= 0.22,
          '막힌 데가 어느 장소에서나 비슷하게 눈에 띈다 (간격 차이 '
          + spread.toFixed(2) + ')');
}

console.log('');
console.log('=== 법칙 2: 위험색을 아무도 안 쓰는가 ===');
console.log('');

// 물줄기가 쓰는 색. game.js 의 폭발 그라데이션에서 뽑았다.
// 이 대역은 위험만 쓴다 — 이걸 배경이 쓰면 위험이 배경에 묻힌다.
//
// 물줄기 테두리의 흰색(#ebfaff)은 기준에서 뺐다.
// **흰색은 어떤 밝은 색과도 가깝다.** 그걸 기준에 넣으면 밝은 바닥을 아예 못 쓴다.
// 테두리는 색이 아니라 밝기 대비로 읽히므로 색 충돌의 문제가 아니다
const DANGER = ['#96d7ff', '#3c96eb'];

let clash = [];
for (const pl of Art.PLACES) {
    for (const key of ['floor', 'crate', 'crateTop', 'wallTop', 'wallSide']) {
        for (const d of DANGER) {
            const dist = colorDist(pl[key], d);
            if (dist < 22) clash.push(pl.name + '.' + key + ' ' + pl[key]
                                      + ' <-> ' + d + ' (' + dist.toFixed(1) + ')');
        }
    }
}

if (clash.length) { for (const c of clash.slice(0, 8)) console.log('  ' + c); }
else console.log('  겹치는 색이 없다');

check(clash.length === 0,
      '판의 어떤 것도 위험색 대역을 안 쓴다'
      + (clash.length ? ' — ' + clash.length + ' 군데' : ''));

console.log('');
console.log('=== 아트 디렉션: 장소마다 물건이 다른가 ===');
console.log('');

// 9/2 부터 장소마다 무늬가 여럿이다. 한 조각 안에서 같은 그림이 줄줄이 붙으면
// 물건이 아니라 벽지로 보여서, 칸 자리로 두세 종류를 섞는다.
// 그래서 여기서 보는 것도 '장소의 무늬' 가 아니라 **장소의 무늬 조합**이다
const wkOf = (p) => (p.wallKinds  || [p.wallKind]);
const ckOf = (p) => (p.crateKinds || [p.crateKind]);
const sig  = (p) => wkOf(p).join('+') + '/' + ckOf(p).join('+');

const wallKinds  = new Set([].concat(...Art.PLACES.map(wkOf)));
const crateKinds = new Set([].concat(...Art.PLACES.map(ckOf)));

console.log('  벽 무늬 ' + [...wallKinds].join(' · '));
console.log('  상자 무늬 ' + [...crateKinds].join(' · '));
console.log('');

check(Art.PLACES.every((p) => wkOf(p).length && ckOf(p).length),
      '열 곳 전부 벽·상자 무늬가 붙어 있다');
check(wallKinds.size >= 4 && crateKinds.size >= 4,
      '무늬가 네 가지 이상씩이다 (벽 ' + wallKinds.size + ', 상자 ' + crateKinds.size + ')');

// 색도 가깝고 무늬도 같으면 두 곳이 진짜 같은 곳이다
let twin = null;
for (let i = 0; i < Art.PLACES.length && !twin; ++i) {
    for (let j = i + 1; j < Art.PLACES.length; ++j) {
        const a = Art.PLACES[i], b = Art.PLACES[j];
        const d = (colorDist(a.floor, b.floor) + colorDist(a.wallTop, b.wallTop)) / 2;
        if (d < 20 && sig(a) === sig(b)) {
            twin = a.name + ' / ' + b.name + ' (색거리 ' + d.toFixed(1) + ')';
            break;
        }
    }
}
check(twin === null,
      '색도 가깝고 무늬도 같은 두 곳이 없다' + (twin ? ' — ' + twin : ''));

console.log('\n=== 애니메이터: 방향과 걷기가 진짜 다른 그림인가 ===\n');

Art.setScale(45);
const base = { animal: 0, walk: 0, t: 0, danger: false };
const shot = (o) => draw(() => Art.drawChar(ctx, 100, 100, 18, '#e05555',
                                            Object.assign({}, base, o)));

const faceNames = ['아래', '위', '오른쪽', '왼쪽'];
const faces = [0, 1, 2, 3].map((f) => shot({ face: f, moving: false }));

const same = [];
for (let i = 0; i < 4; ++i) {
    for (let j = i + 1; j < 4; ++j) {
        if (faces[i].join('|') === faces[j].join('|')) {
            same.push(faceNames[i] + '=' + faceNames[j]);
        }
    }
}
console.log('  서기 네 방향의 명령 수: ' + faces.map((f) => f.length).join(' / '));
check(same.length === 0,
      '서기 네 방향이 서로 다른 그림이다'
      + (same.length ? ' — 같은 것: ' + same.join(', ') : ''));

// 걷기는 발이 번갈아 나가야 한다. 주기가 다르면 그림도 달라야 한다
const walkA = shot({ face: 2, moving: true, walk: 0 });
const walkB = shot({ face: 2, moving: true, walk: 4 });
const stand = shot({ face: 2, moving: false });

console.log('  걷기0 / 걷기4 / 서기 명령 수: '
            + walkA.length + ' / ' + walkB.length + ' / ' + stand.length);
check(walkA.join('|') !== stand.join('|'), '걷는 모습과 서 있는 모습이 다르다');
check(walkA.join('|') !== walkB.join('|'), '걷기 주기가 돌면서 그림이 바뀐다');

// 동물 여덟이 정말 여덟 종류인가. 색만 다르면 한 마리다
const beasts = [];
for (let a = 0; a < Art.ANIMALS.length; ++a) {
    beasts.push(shot({ face: 0, moving: false, animal: a }).join('|'));
}
const uniq = new Set(beasts).size;
console.log('  동물 ' + Art.ANIMALS.length + '종 중 서로 다른 그림: ' + uniq + '종');
check(uniq === Art.ANIMALS.length, '동물이 전부 다른 그림이다');

// ── 이펙터 ───────────────────────────────────────────────────
// 아이템 도트 지도가 네모난가.
//
// 손으로 찍은 그림이라 한 줄만 한 칸 짧아도 그림이 어긋난다.
// 실제로 처음 찍었을 때 화살 한 줄에 공백이 하나 섞여서 구멍이 났고,
// 바퀴 살에도 구멍이 났다. 눈으로 봐야 알았다. 그걸 여기서 센다
console.log('');
console.log('=== 아이템 도트 지도 ===');
console.log('');

let dotBad = [];
for (const key of Object.keys(Art.ITEM_ART)) {
    const art = Art.ITEM_ART[key];
    const w = art.rows[0].length;
    for (let r = 0; r < art.rows.length; ++r) {
        const row = art.rows[r];
        if (row.length !== w) dotBad.push(key + ' ' + r + '번 줄 폭 ' + row.length);
        for (const ch of row) {
            if (!(ch in art)) dotBad.push(key + ' ' + r + '번 줄에 모르는 글자 [' + ch + ']');
        }
    }
    console.log('  ' + key + '번: ' + art.rows.length + '줄 x ' + w + '칸');
}
check(dotBad.length === 0,
      '도트 지도가 전부 네모나고 모르는 글자가 없다'
      + (dotBad.length ? ' — ' + dotBad.slice(0, 3).join(', ') : ''));

// 같은 자세를 두 번 그리면 두 번째는 붙이기만 해야 한다.
// 스물넷이 돌아다니면 매 프레임 스물넷을 새로 그리게 되므로 여기가 프레임을 정한다
const pose1 = { face: 0, moving: false, animal: 3, walk: 0, t: 0 };
const first  = draw(() => Art.drawChar(ctx, 100, 100, 18, '#2f9e44', pose1));
const second = draw(() => Art.drawChar(ctx, 100, 100, 18, '#2f9e44', pose1));
console.log('  같은 자세 첫 번째 ' + first.length + ' 명령, 두 번째 ' + second.length + ' 명령');
check(second.length < first.length,
      '같은 자세는 한 번만 굽고 그다음엔 붙이기만 한다');

console.log('\n=== 이펙터: 한 번에 얼마나 튀나 ===\n');

// 파티클을 그리는 건 FX.draw 다. FX.done 은 카메라 변형을 되돌리기만 한다.
// 처음엔 done 을 세다가 명령이 1 개만 나와서 시험이 틀린 걸 알았다
FX.reset();
const idle  = draw(() => { FX.draw(ctx, 0); }).length;
const idleN = FX.count();

// 폭발 한 번. 사거리가 긴 십자면 조각이 사방에서 튄다
FX.shake(0.4);
for (let i = 0; i < 9; ++i) {
    FX.breakCrate(100 + i * 40, 100, 45, 0, '#c08b52', '#7e5628');
}
FX.kill(200, 200, 45, 0, '#ffd166');

const burstN = FX.count();
const burst  = draw(() => { FX.draw(ctx, 0); }).length;

console.log('  아무 일 없을 때  조각 ' + idleN + ' 개, ' + idle + ' 명령');
console.log('  폭발 직후        조각 ' + burstN + ' 개, ' + burst + ' 명령');
check(burst > idle, '폭발하면 이펙트가 실제로 나간다');

// 한 프레임에 그리는 양이 여기서 폭주하면 그 순간만 뚝 끊긴다.
// 판 전체를 다시 그리는 것이 프레임당 fillRect 400 미만이니 그것과 비교한다
check(burst < 3000, '한 번에 터져도 그리는 양이 폭주하지 않는다 (' + burst + ' 명령)');

// 조각은 사라져야 한다. 안 사라지면 판이 갈수록 무거워진다
let tail = burst;
for (let t = 200; t <= 4000; t += 200) {
    tail = draw(() => { FX.draw(ctx, t); }).length;
}
console.log('  4초 뒤          조각 ' + FX.count() + ' 개, ' + tail + ' 명령');
check(FX.count() === 0, '시간이 지나면 조각이 사라진다 (안 쌓인다)');

// ── 그림 타일 이름이 실제로 있나 ─────────────────────────────
//
// 장소마다 어느 그림을 쓸지 이름으로 적어둔다. 이름을 틀리면 아무 일도
// 안 일어나고 조용히 도트 그림으로 되돌아간다. **틀린 걸 알 방법이 없다** —
// 화면은 멀쩡히 나오고, 그림을 새로 넣은 사람만 왜 안 바뀌나 하고 있게 된다.
//
// 아틀라스 색인과 대조하는 건 여기서 한 번이면 끝난다
console.log();
console.log('=== 그림 타일 이름 ===');
{
  const idx = path.join(webDir, 'art', 'tiles.json');
  if (!fs.existsSync(idx)) {
    console.log('  web/art/tiles.json 이 없다. python tools/buildart.py 를 돌려라');
    check(false, '판 타일 아틀라스가 있다');
  } else {
    const have = new Set(Object.keys(JSON.parse(fs.readFileSync(idx, 'utf8')).sprites));
    const missing = [];
    let used = 0;

    for (const th of Art.PLACES) {
      if (!th.tiles) continue;
      for (const n of [th.tiles.floor].concat(th.tiles.wall, th.tiles.crate,
                                               th.tiles.big || [])) {
        ++used;
        if (!have.has(n)) missing.push(th.name + ' : ' + n);
      }
    }

    console.log('  아틀라스 ' + have.size + '칸,  장소가 쓰는 이름 ' + used + '개');
    if (missing.length) console.log('  없는 이름: ' + missing.join(', '));
    check(used > 0, '그림 타일을 쓰는 장소가 있다');
    check(missing.length === 0, '장소가 부르는 이름이 아틀라스에 다 있다');
  }
}

console.log('\n===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
process.exit(fail ? 1 : 0);
