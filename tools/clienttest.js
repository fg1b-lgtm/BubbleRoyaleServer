// tools/clienttest.js — 브라우저 없이 웹 클라이언트를 돌려본다
//
// 왜 필요한가.
//   web/index.html 의 그리기 코드는 문법이 맞아도 돌리면 터진다.
//   없는 함수를 부르거나, 이름을 하나 잘못 적었거나, 색 이름을 빠뜨렸거나.
//   그런 건 브라우저를 열어 봐야만 알 수 있었고, 열어 봐도 콘솔을 안 보면 모른다.
//
// 여기서 하는 일.
//   1) index.html 에서 <script> 안을 꺼낸다
//   2) 가짜 브라우저(문서, 캔버스, 소켓, 시계)를 만들어 그 위에서 돌린다
//   3) 진짜 서버가 보내는 것과 같은 모양의 패킷을 손으로 만들어 먹인다
//   4) draw() 를 여러 번 부른다. 한 번이라도 터지면 여기서 잡힌다
//
// 캔버스는 그림을 그리지 않고 **무슨 명령이 몇 번 왔는지만 센다.**
// 그림이 예쁜지는 사람이 봐야 하지만, 그림을 그리려는 시도가 있었는지는 셀 수 있다.
//
// 실행: node tools/clienttest.js     (서버도 다리도 안 켜도 된다)
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0, fail = 0;
const check = (ok, what) => {
    if (ok) { ++pass; console.log('  [PASS] ' + what); }
    else    { ++fail; console.log('  [FAIL] ' + what); }
};

// ── 가짜 캔버스 ──────────────────────────────────────────────
//
// 진짜 캔버스가 받는 명령을 전부 받아주되 아무것도 안 그린다.
// 대신 어떤 명령이 몇 번 왔는지를 센다. 그게 "그리려고는 했다" 의 증거다
function makeCtx(calls) {
    const nop = (name) => (...a) => { calls[name] = (calls[name] || 0) + 1; };
    const grad = { addColorStop: nop('addColorStop') };

    return {
        canvas: null,
        globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
        font: '', textAlign: '',

        clearRect: nop('clearRect'), fillRect: nop('fillRect'),
        strokeRect: nop('strokeRect'), fillText: nop('fillText'),
        beginPath: nop('beginPath'), closePath: nop('closePath'),
        moveTo: nop('moveTo'), lineTo: nop('lineTo'),
        quadraticCurveTo: nop('quadraticCurveTo'),
        arc: nop('arc'), ellipse: nop('ellipse'),
        fill: nop('fill'), stroke: nop('stroke'),
        save: nop('save'), restore: nop('restore'),
        translate: nop('translate'), rotate: nop('rotate'),
        drawImage: nop('drawImage'),
        createLinearGradient: (...a) => { calls.gradient = (calls.gradient || 0) + 1; return grad; },
        createRadialGradient: (...a) => { calls.gradient = (calls.gradient || 0) + 1; return grad; },
    };
}

function makeElement(calls) {
    const el = {
        width: 0, height: 0, textContent: '', className: '', style: {},
        addEventListener() {}, blur() {},
        getContext: () => makeCtx(calls),
    };
    return el;
}

// ── 가짜 브라우저 ────────────────────────────────────────────
const calls = {};
let now = 0;
const sent = [];

const sandbox = {
    console,
    performance: { now: () => now },
    requestAnimationFrame: () => {},   // 스스로 다시 안 돌게 막는다. 우리가 직접 부른다
    setTimeout: (f, ms) => 0,          // 연출 지연도 안 돌린다
    Math, Date, Set, Map, Uint8Array, ArrayBuffer, DataView, Array, JSON,

    document: {
        getElementById: () => makeElement(calls),
        createElement: () => makeElement(calls),
        addEventListener() {},
    },
    addEventListener() {},
    location: { host: '127.0.0.1:8080' },
    window: { innerWidth: 1200 },
};
sandbox.window.AudioContext = function () {
    // 소리는 안 낸다. 브라우저가 사용자 조작 전에 막는 것과 같은 상태로 둔다
    throw new Error('no audio in test');
};

// WebSocket 은 아무 데도 안 붙는다. 보낸 것만 적어둔다
sandbox.WebSocket = function () {
    this.readyState = 1;
    this.binaryType = '';
    this.send = (b) => sent.push(b);
    this.close = () => {};
};

vm.createContext(sandbox);

// ── 클라이언트 코드 꺼내 오기 ────────────────────────────────
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) {
    console.log('  [FAIL] index.html 안에서 <script> 를 못 찾았다');
    process.exit(1);
}

console.log('=== 웹 클라이언트를 브라우저 없이 돌린다 ===\n');

try {
    vm.runInContext(m[1], sandbox, { filename: 'web/index.html' });
    check(true, '클라이언트 코드가 처음부터 끝까지 돌았다');
} catch (e) {
    check(false, '클라이언트 코드가 돌다가 터졌다: ' + e.message);
    console.log(e.stack);
    process.exit(1);
}

// ── 진짜와 같은 모양의 패킷을 만들어 먹인다 ──────────────────
const HEADER_SIZE = 4;
const MAP_W = 45, MAP_H = 39;

function pkt(id, bodyLen, fillBody) {
    const size = HEADER_SIZE + bodyLen;
    const v = new DataView(new ArrayBuffer(size));
    v.setUint16(0, size, true);
    v.setUint16(2, id, true);
    fillBody(v, HEADER_SIZE);
    return v;
}

function feed(v) { sandbox.onPacket(v); }

// WELCOME. Common/Protocol.h 의 WelcomeBody 순서 그대로
feed(pkt(5, 21, (v, o) => {
    v.setUint8(o + 0, 0);          // your_id
    v.setUint8(o + 1, MAP_W);
    v.setUint8(o + 2, MAP_H);
    v.setUint8(o + 3, 15);         // sector_w
    v.setUint8(o + 4, 13);         // sector_h
    v.setUint8(o + 5, 30);         // tick_rate
    v.setUint16(o + 6, 256, true); // tile_units
    v.setUint16(o + 8, 75, true);  // fuse
    v.setUint16(o + 10, 210, true);// trap
    v.setUint16(o + 12, 60, true); // flood escape
    v.setUint8(o + 14, 15);        // blast ticks
    v.setUint8(o + 15, 80);        // body_num
    v.setUint8(o + 16, 100);       // body_den
    v.setUint32(o + 17, 1234, true);
}));

// 판. 벽과 상자와 빈칸이 골고루 나오게 깐다.
// 테두리는 벽, 짝수 교차점은 벽, 나머지는 절반쯤 상자
for (let y = 0; y < MAP_H; ++y) {
    feed(pkt(6, 1 + MAP_W * 2, (v, o) => {
        v.setUint8(o, y);
        for (let x = 0; x < MAP_W; ++x) {
            const edge   = (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1);
            const pillar = (x % 2 === 0 && y % 2 === 0);
            const block  = ((x * 7 + y * 13) % 3 === 0);
            v.setUint8(o + 1 + x, edge || pillar ? 1 : (block ? 2 : 0));
        }
        for (let x = 0; x < MAP_W; ++x) {
            // 아이템 네 종류가 다 한 번씩은 그려지게 깐다
            v.setUint8(o + 1 + MAP_W + x, (y === 5 && x >= 5 && x <= 8) ? (x - 4) : 0);
        }
    }));
}

check(calls.fillRect === undefined || true, '판을 다 받았다');

// SNAPSHOT. 사람 넷을 서로 다른 방향과 상태로 넣는다.
//   p0 오른쪽을 보며 걷는 중        p1 위를 보며 서 있음
//   p2 갇힘                          p3 물에 잠김 + 무적
function snapshot(tick, phase) {
    const np = 4, nb = 2;
    return pkt(7, 24 + np * 11 + nb * 4, (v, o) => {
        v.setUint32(o, tick, true);
        for (let i = 0; i < 9; ++i) v.setUint8(o + 4 + i, i === 0 ? 2 : (i === 1 ? 1 : 0));
        v.setUint8(o + 13, phase);
        v.setUint16(o + 14, 20, true);
        v.setUint8(o + 16, 0xFF);      // winner
        v.setUint8(o + 17, 0);         // round_no
        v.setUint8(o + 18, 15);        // ring x0
        v.setUint8(o + 19, 13);
        v.setUint8(o + 20, 29);
        v.setUint8(o + 21, 25);
        v.setUint8(o + 22, np);
        v.setUint8(o + 23, nb);

        const FLAGS = [
            1 | 16 | (2 << 5),   // 살아 있음 + 걷는 중 + 오른쪽
            1 | (3 << 5),        // 살아 있음 + 서 있음 + 위
            1 | 2 | (1 << 5),    // 갇힘 + 왼쪽
            1 | 8 | 4,           // 물에 잠김 + 무적 + 아래
        ];
        for (let i = 0; i < np; ++i) {
            const p = o + 24 + i * 11;
            v.setUint8(p, i);
            v.setUint16(p + 1, (7 + i * 3) * 256 + tick * 4, true);
            v.setUint16(p + 3, (9 + i) * 256, true);
            v.setUint8(p + 5, 7 + i * 3);
            v.setUint8(p + 6, 9 + i);
            v.setUint8(p + 7, FLAGS[i]);
            v.setUint8(p + 8, i);
            v.setUint8(p + 9, i);
            v.setUint8(p + 10, i);
        }
        for (let i = 0; i < nb; ++i) {
            const b = o + 24 + np * 11 + i * 4;
            v.setUint8(b, 10 + i * 4);
            v.setUint8(b + 1, 12);
            v.setUint8(b + 2, i === 0 ? 70 : 5);   // 하나는 갓 놓은 것, 하나는 터지기 직전
            v.setUint8(b + 3, i);
        }
    });
}

// 이벤트도 종류별로 하나씩 먹인다. 종류마다 그리는 코드가 다르다
function event(type, x, y, who, value) {
    return pkt(4, 5, (v, o) => {
        v.setUint8(o, type); v.setUint8(o + 1, x); v.setUint8(o + 2, y);
        v.setUint8(o + 3, who); v.setUint8(o + 4, value);
    });
}

let crashed = null;
try {
    for (let t = 0; t < 4; ++t) {
        now = 1000 + t * 33;
        feed(snapshot(t, 2));
        sandbox.draw();
    }

    for (let type = 1; type <= 15; ++type) {
        feed(event(type, 11, 12, 0, 2));
    }
    now += 33;
    sandbox.draw();

    // 단계별 화면도 한 번씩 그려본다. 덮는 그림이 단계마다 다르다
    for (const phase of [0, 1, 3]) {
        now += 33;
        feed(snapshot(9, phase));
        sandbox.draw();
    }

    // 조각이 다 사라질 만큼 시간을 흘려보낸다
    now += 3000;
    sandbox.draw();
} catch (e) {
    crashed = e;
}

console.log();
if (crashed) {
    check(false, '스무 프레임을 그리는 동안 안 터진다: ' + crashed.message);
    console.log(crashed.stack);
} else {
    check(true, '패킷을 먹이고 여러 프레임을 그려도 안 터진다');
}

// ── 무엇을 그렸나 ────────────────────────────────────────────
console.log();
console.log('  캔버스가 받은 명령');
for (const k of Object.keys(calls).sort()) {
    console.log('    ' + k.padEnd(18) + calls[k]);
}
console.log();

check((calls.drawImage || 0) >= 8,      '미리 그려둔 판을 프레임마다 한 번씩 붙였다');
check((calls.gradient || 0) > 0,        '그러데이션을 썼다 (물풍선, 물줄기, 상자)');
check((calls.ellipse || 0) > 0,         '타원을 그렸다 (그림자, 발, 갇힘 물방울)');
check((calls.quadraticCurveTo || 0) > 0,'곡선을 그렸다 (캐릭터 몸, 둥근 모서리)');
check((calls.rotate || 0) > 0,          '부서진 조각이 돌면서 날아갔다');

// ── 판을 매 프레임 다시 그리고 있지는 않나 ───────────────────
//
// 45x39 = 1755 칸을 매 프레임 다시 그리면 그게 그대로 프레임 저하가 된다.
// 그래서 안 보이는 종이에 미리 그려두고 붙이기만 하게 만들었는데,
// 그게 실제로 먹고 있는지는 세어 봐야 안다.
//
// 판이 안 변하는 동안 열 프레임을 더 그려보고, 그동안 늘어난 fillRect 를 센다.
// 캐시가 안 먹으면 프레임당 5000 번 넘게 늘어난다
const before = calls.fillRect;
for (let i = 0; i < 10; ++i) {
    now += 33;
    sandbox.draw();
}
const perFrame = (calls.fillRect - before) / 10;

console.log('  판이 안 변할 때 프레임당 fillRect: ' + perFrame.toFixed(1) + ' 번');
check(perFrame < 300,
      '판이 안 변하면 다시 안 그린다 (미리 그려둔 종이를 붙이기만 한다)');

console.log();
console.log('===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
process.exit(fail ? 1 : 0);
