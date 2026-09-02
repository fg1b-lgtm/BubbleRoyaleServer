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
const { colorDist } = require('./colorlib');

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
for (const f of ['art.js', 'fx.js']) {
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

console.log('\n===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
process.exit(fail ? 1 : 0);
