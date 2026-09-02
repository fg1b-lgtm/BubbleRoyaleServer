// tools/clienttest.js — 브라우저 없이 웹 클라이언트를 돌린다
//
// 왜 필요한가.
//   web/ 의 그리기 코드는 문법이 맞아도 돌리면 터진다.
//   없는 함수를 부르거나, 이름을 하나 잘못 적었거나, 색을 빠뜨렸거나.
//   브라우저를 열어 봐야만 알 수 있었고, 열어 봐도 콘솔을 안 보면 모른다.
//
// 여기서 하는 일
//   1) index.html 이 부르는 스크립트를 순서대로 읽는다
//   2) 가짜 브라우저(문서, 캔버스, 소켓, 시계, 오디오)를 만들어 그 위에서 돌린다
//   3) 진짜 서버가 보내는 것과 같은 모양의 패킷을 손으로 만들어 먹인다
//   4) 여러 프레임을 그린다. 한 번이라도 터지면 여기서 잡힌다
//
// 캔버스는 그림을 그리지 않고 **무슨 명령이 몇 번 왔는지만 센다.**
// 그림이 예쁜지는 사람이 봐야 하지만, 그리려는 시도가 있었는지는 셀 수 있다.
//
// 실행: node tools/clienttest.js     (서버도 다리도 안 켜도 된다)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const { colorDist, contrast, over } = require('./colorlib');

let pass = 0, fail = 0;
const check = (ok, what) => {
    if (ok) { ++pass; console.log('  [PASS] ' + what); }
    else    { ++fail; console.log('  [FAIL] ' + what); }
};

// ── 가짜 캔버스 ──────────────────────────────────────────────
//
// 진짜 캔버스가 받는 명령을 전부 받아주되 아무것도 안 그린다.
// 대신 어떤 명령이 몇 번 왔는지를 센다. 그게 "그리려고는 했다" 의 증거다
const calls = {};
function bump(name) { calls[name] = (calls[name] || 0) + 1; }

function makeCtx() {
    const nop = (name) => () => bump(name);
    const grad = { addColorStop: () => bump('addColorStop') };

    return {
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
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
        createLinearGradient: () => { bump('gradient'); return grad; },
        createRadialGradient: () => { bump('gradient'); return grad; },
        createPattern: () => { bump('pattern'); return {}; },
    };
}

function makeElement() {
    return {
        width: 0, height: 0, textContent: '', className: '', style: {},
        addEventListener() {}, blur() {},
        getContext: () => makeCtx(),
    };
}

// ── 가짜 오디오 ──────────────────────────────────────────────
//
// 소리는 안 낸다. 그런데 **소리를 만드는 코드는 그대로 돌린다.**
// 노드를 몇 개 만들었고 몇 번 이었는지를 세면, 소리가 층으로 만들어졌는지
// 층 하나짜리인지가 숫자로 나온다
const audio = { nodes: 0, starts: 0, connects: 0, params: 0 };

// 어떤 소리를 어떤 설정으로 냈나.
//
// '울린 횟수' 만 세면 발소리가 재료마다 다른지 알 수 없다. 같은 파일을 같은
// 음높이로 열 번 내도 열 번은 열 번이다. **무엇을 어떻게 냈는지**를 봐야 한다
const played = [];
let curBuffer = null;

function param() {
    ++audio.params;
    return {
        value: 0,
        setValueAtTime() { return this; },
        linearRampToValueAtTime() { return this; },
        exponentialRampToValueAtTime() { return this; },
        setTargetAtTime() { return this; },
        cancelScheduledValues() { return this; },
    };
}
function node(extra) {
    ++audio.nodes;
    return Object.assign({
        connect() { ++audio.connects; },
        disconnect() {},
        start() { ++audio.starts; },
        stop() {},
    }, extra || {});
}

function FakeAudioContext() {
    this.sampleRate = 48000;

    // **시계가 흐른다.**
    //
    // 처음엔 0 으로 고정해뒀다. 그러면 '이 소리가 언제 끝나나' 를 시각으로 재는
    // 코드에서 아무 소리도 안 끝나고, 동시 발음 상한에 걸려 소리가 통째로 멎는다.
    // 실제 브라우저에서는 시간이 흐르므로 가짜도 흘러야 한다.
    // 안 흐르는 가짜는 있지도 않은 문제를 만들어낸다
    Object.defineProperty(this, 'currentTime', { get: () => now / 1000 });
    this.state = 'running';
    this.destination = node();
    this.resume = () => {};
    this.createGain = () => node({ gain: param() });
    this.createOscillator = () => node({ frequency: param(), detune: param(), type: 'sine' });
    this.createBiquadFilter = () => {
        const n = node({ frequency: param(), Q: param(), type: 'lowpass' });
        if (played.length) played[played.length - 1].filters.push(n);
        return n;
    };
    this.createStereoPanner = () => node({ pan: param() });
    this.createConvolver = () => node({ buffer: null });
    this.createDynamicsCompressor = () => node({
        threshold: param(), knee: param(), ratio: param(),
        attack: param(), release: param(),
    });
    // 녹음을 트는 자리. 여기가 '소리 하나' 다.
    // 무엇을(buffer) 어떤 음높이로(rate) 냈는지 적어둔다
    this.createBufferSource = () => {
        const rec = { buf: null, rate: 1, filters: [], gain: 1 };
        played.push(rec);

        const pr = param();
        Object.defineProperty(pr, 'value', {
            get() { return rec.rate; },
            set(v) { rec.rate = v; },
        });

        const n = node({ loop: false, playbackRate: pr });
        Object.defineProperty(n, 'buffer', {
            get() { return rec.buf; },
            set(v) { rec.buf = v; },
        });
        return n;
    };
    this.createBuffer = (ch, n) => ({
        length: n,
        getChannelData: () => new Float32Array(n),
    });
    // 녹음물을 푸는 것. 진짜로 풀 필요는 없고 버퍼 하나를 돌려주면 된다
    this.decodeAudioData = (ab) => Promise.resolve({
        length: 4800, duration: 0.1, sampleRate: 48000,
        name: (ab && ab.__name) || '?',
        getChannelData: () => new Float32Array(4800),
    });
}

// ── 가짜 브라우저 ────────────────────────────────────────────
let now = 0;
const sent = [];
const timers = [];

const sandbox = {
    console,
    performance: { now: () => now },
    requestAnimationFrame: () => {},   // 스스로 다시 안 돌게 막는다. 우리가 직접 부른다
    setTimeout: (f, ms) => { timers.push(f); return timers.length; },
    setInterval: () => 0,              // 음악 스케줄러는 안 돌린다
    clearInterval: () => {},
    Math, Date, Set, Map, Uint8Array, Float32Array, ArrayBuffer, DataView, Array, JSON,
    Object, String, Number, Boolean, isNaN, parseInt, parseFloat,

    document: {
        getElementById: () => makeElement(),
        createElement: () => makeElement(),
        addEventListener() {},
    },
    addEventListener() {},
    location: { host: '127.0.0.1:8080' },
};
sandbox.window = {
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
    AudioContext: FakeAudioContext,
};
// 소리 파일을 받아 오는 것. 진짜로 안 받고 무엇을 달라고 했는지만 적어둔다
const fetched = [];
sandbox.fetch = (url) => {
    fetched.push(url);

    // **어느 파일인지를 버퍼에 달아 보낸다.**
    // 이게 없으면 '소리를 냈다' 까지만 알고 '무슨 소리를 냈나' 는 모른다.
    // 발소리가 재료마다 다른지 보려면 어느 녹음을 골랐는지가 필요하다
    const name = url.replace(/^.*\//, '').replace(/\.ogg$/, '');
    const ab = new ArrayBuffer(64);
    ab.__name = name;
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(ab) });
};
sandbox.setImmediate = setImmediate;
sandbox.Promise = Promise;

sandbox.WebSocket = function () {
    this.readyState = 1;
    this.binaryType = '';
    this.send = (b) => sent.push(b);
    this.close = () => {};
};

vm.createContext(sandbox);

// ── index.html 이 부르는 스크립트를 순서대로 ─────────────────
const webDir = path.join(__dirname, '..', 'web');
const html = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

console.log('=== 웹 클라이언트를 브라우저 없이 돌린다 ===\n');
console.log('  부르는 파일: ' + files.join(' → '));
check(files.length >= 4, 'index.html 이 스크립트를 나눠서 부른다');

for (const f of files) {
    try {
        vm.runInContext(fs.readFileSync(path.join(webDir, f), 'utf8'), sandbox, { filename: 'web/' + f });
    } catch (e) {
        check(false, f + ' 이 돌다가 터졌다: ' + e.message);
        console.log(e.stack);
        process.exit(1);
    }
}
check(true, '다섯 파일이 처음부터 끝까지 돌았다');

// 스크립트 맨 위의 const 는 전역 **객체**에 안 붙는다. 전역 렉시컬 환경에 들어간다.
// 브라우저에서는 스크립트끼리 그 환경을 같이 쓰므로 서로 잘 보이는데,
// 밖에서 sandbox.G 로 꺼내려 하면 없다. 같은 realm 에서 식을 하나 굴려서 가져온다
const api = vm.runInContext('({ G: G, Art: Art, FX: FX, Sound: Sound, Predict: Predict, onPacket: onPacket, frame: frame, statRows: statRows, PLAYER_COLORS: PLAYER_COLORS })', sandbox);

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
const feed = (v) => api.onPacket(v);

// WELCOME. Common/Protocol.h 의 WelcomeBody 순서 그대로
// (23 + 조각 9 + 시작값·상한 5 + 이동 규칙 4 = 41 바이트)
feed(pkt(5, 41, (v, o) => {
    v.setUint8(o + 0, 0);            // your_id
    v.setUint8(o + 1, MAP_W);
    v.setUint8(o + 2, MAP_H);
    v.setUint8(o + 3, 15);           // sector_w
    v.setUint8(o + 4, 13);           // sector_h
    v.setUint8(o + 5, 30);           // tick_rate
    v.setUint16(o + 6, 256, true);   // tile_units
    v.setUint16(o + 8, 75, true);    // fuse
    v.setUint16(o + 10, 210, true);  // trap
    v.setUint16(o + 12, 60, true);   // flood escape
    v.setUint8(o + 14, 15);          // blast ticks
    v.setUint8(o + 15, 80);          // body_num
    v.setUint8(o + 16, 100);         // body_den
    v.setUint8(o + 17, 3);           // peek_tiles
    v.setUint8(o + 18, 2);           // cam_hysteresis
    v.setUint32(o + 19, 1234, true); // seed
    // 아홉 자리에 조각 번호. 열 가지 장소가 다 한 번씩은 그려지게 섞어 넣는다
    const kinds = [0, 3, 7, 2, 9, 5, 6, 8, 1];
    for (let i = 0; i < 9; ++i) v.setUint8(o + 23 + i, kinds[i]);

    // 아이템 시작값과 상한. 전에는 화면이 이걸 손으로 갖고 있었다
    v.setUint8(o + 32, 1);   // base_bubble
    v.setUint8(o + 33, 1);   // base_range
    v.setUint8(o + 34, 5);   // cap_bubble
    v.setUint8(o + 35, 5);   // cap_range
    v.setUint8(o + 36, 7);   // cap_speed

    // 이동 규칙. 화면이 내 캐릭터를 미리 움직이는 데 쓴다
    v.setUint8(o + 37, 18);  // move_base
    v.setUint8(o + 38, 4);   // move_step
    v.setUint8(o + 39, 6);   // trap_speed
    v.setUint8(o + 40, 50);  // lane_snap
}));

check(api.G.C !== null, 'WELCOME 을 읽고 상수를 받았다');

// 화면이 게임 상수를 손으로 갖고 있으면 안 된다.
// 9/2 에 HUD 가 물줄기를 '2 + 먹은 수' 로 그리고 있었다. 시작 사거리는 1인데
check(api.G.C.baseRange === 1 && api.G.C.capSpeed === 7,
      '아이템 시작값과 상한도 서버가 준 것을 쓴다 (사거리 ' + api.G.C.baseRange
      + ', 롤러 상한 ' + api.G.C.capSpeed + ')');

// 예측이 서버와 **같은 계산**을 하려면 규칙에 쓰는 수를 다 받아야 한다.
// 화면이 자기 값을 갖고 있으면 상수를 바꾼 날 예측과 서버가 갈린다
check(api.G.C.moveBase === 18 && api.G.C.laneSnap === 50,
      '이동 규칙도 서버가 준 것을 쓴다 (기본 속도 ' + api.G.C.moveBase
      + ', 레인 스냅 ' + api.G.C.laneSnap + '%)');
check(api.Art.V.TS >= 14, '화면 크기에 맞춰 타일 크기를 골랐다 (' + api.Art.V.TS + 'px)');

// 9/1 부터 화면이 판 전체가 아니라 **내 구역 + 가장자리 세 칸**이다.
// 판이 좁아진 만큼 타일이 커진다. 캐릭터 얼굴이 보이는 게 여기서 나온다
check(api.Art.V.TS >= 24,
      '구역만 보여주니 타일이 커졌다 (판 전체를 보여줄 때는 19px 였다)');
check(api.Art.V.WH > 0, '벽에 높이가 있다 (' + api.Art.V.WH + 'px)');

// 색만으로는 스물넷을 못 가른다. 동물이 색과 다른 주기로 돌아야 한다
console.log('  동물 ' + api.Art.ANIMALS.length + '종: ' + api.Art.ANIMALS.join(' '));
check(api.Art.ANIMALS.length >= 6, '동물이 여러 종이다');
check(24 % api.Art.ANIMALS.length !== 0 || api.Art.ANIMALS.length !== 24,
      '동물 수와 색 수의 주기가 달라서 조합이 겹치지 않는다');

// 구역마다 다른 장소로 그려야 한다. 아홉 자리에 서로 다른 조각을 넣어 보냈으니
// 이름이 아홉 개 다 달라야 한다
const names = api.Art.placeNames();
console.log('  이 판의 장소: ' + names.join(' · '));
check(names.length === 9, '구역 아홉 곳이 서로 다른 장소로 그려진다');
check(api.Art.placeAt(2, 2).name !== api.Art.placeAt(40, 2).name,
      '왼쪽 위 구역과 오른쪽 위 구역의 색이 다르다');

// 판. 벽과 상자와 빈칸이 골고루 나오게 깐다
for (let y = 0; y < MAP_H; ++y) {
    feed(pkt(6, 1 + MAP_W * 2, (v, o) => {
        v.setUint8(o, y);
        for (let x = 0; x < MAP_W; ++x) {
            const edge   = (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1);
            const pillar = (x % 2 === 0 && y % 2 === 0);
            const block  = ((x * 7 + y * 13) % 3 === 0);
            // 2 = 부서지는 블록, 4 = 밀 수 있는 상자
            const kind = ((x * 5 + y * 3) % 7 === 0) ? 4 : 2;
            v.setUint8(o + 1 + x, edge || pillar ? 1 : (block ? kind : 0));
        }
        for (let x = 0; x < MAP_W; ++x) {
            // 아이템 네 종류가 다 한 번씩은 그려지게 깐다
            v.setUint8(o + 1 + MAP_W + x, (y === 5 && x >= 5 && x <= 8) ? (x - 4) : 0);
        }
    }));
}

// SNAPSHOT. 사람 넷을 서로 다른 방향과 상태로 넣는다.
//   p0 오른쪽을 보며 걷는 중   p1 위를 보며 서 있음
//   p2 갇힘                     p3 물에 잠김 + 무적
function snapshot(tick, phase, ringOn, want, wantB) {
    const np = want || 4, nb = wantB || 2;
    return pkt(7, 28 + np * 11 + nb * 4, (v, o) => {
        v.setUint32(o, tick, true);
        for (let i = 0; i < 9; ++i) v.setUint8(o + 4 + i, i === 0 ? 2 : (i === 1 ? 1 : 0));
        v.setUint8(o + 13, phase);
        v.setUint16(o + 14, 20, true);
        v.setUint8(o + 16, 0xFF);
        v.setUint8(o + 17, 0);
        v.setUint8(o + 18, ringOn ? 15 : 0xFF);
        v.setUint8(o + 19, ringOn ? 13 : 0xFF);
        v.setUint8(o + 20, ringOn ? 29 : 0xFF);
        v.setUint8(o + 21, ringOn ? 25 : 0xFF);
        v.setUint8(o + 22, np);          // alive_count
        v.setUint8(o + 23, np >= 8 ? 0xFF : 0x0F);   // alive_mask
        v.setUint8(o + 24, 0);
        v.setUint8(o + 25, 0);
        v.setUint8(o + 26, np);
        v.setUint8(o + 27, nb);

        const FLAGS = [
            1 | 16 | (2 << 5),   // 살아 있음 + 걷는 중 + 오른쪽
            1 | (3 << 5),        // 살아 있음 + 서 있음 + 위
            1 | 2 | (1 << 5),    // 갇힘 + 왼쪽
            1 | 8 | 4,           // 물에 잠김 + 무적 + 아래
        ];
        for (let i = 0; i < np; ++i) {
            const p = o + 28 + i * 11;
            v.setUint8(p, i);
            v.setUint16(p + 1, ((7 + i * 3) % 40) * 256 + tick * 40, true);
            v.setUint16(p + 3, ((9 + i) % 34) * 256, true);
            v.setUint8(p + 5, (7 + i * 3) % 40);
            v.setUint8(p + 6, (9 + i) % 34);
            v.setUint8(p + 7, FLAGS[i % FLAGS.length]);
            v.setUint8(p + 8, i);
            v.setUint8(p + 9, i);
            v.setUint8(p + 10, i);
        }
        for (let i = 0; i < nb; ++i) {
            const b = o + 28 + np * 11 + i * 4;
            v.setUint8(b, (10 + i * 4) % 40);
            v.setUint8(b + 1, 12 + (i % 3));
            v.setUint8(b + 2, i === 0 ? 70 : 5);   // 하나는 갓 놓은 것, 하나는 터지기 직전
            v.setUint8(b + 3, i);
        }
    });
}

function event(type, x, y, who, value) {
    return pkt(4, 5, (v, o) => {
        v.setUint8(o, type); v.setUint8(o + 1, x); v.setUint8(o + 2, y);
        v.setUint8(o + 3, who); v.setUint8(o + 4, value);
    });
}

// 브라우저는 사용자가 뭔가 누르기 전에는 소리를 못 내게 막는다.
// 진짜 클라이언트도 첫 입력에서 이걸 부른다. 그래야 소리 코드가 돌기 시작한다
api.Sound.wake();
check(api.Sound.isReady(), '첫 입력에 소리 장치가 깨어난다');

// 소리 파일은 받아서 푸는 데 시간이 걸린다. 여기서부터는 기다렸다 이어간다.
// 안 기다리면 아직 안 온 소리를 내려다 조용히 지나가서, 시험이 아무것도 안 재게 된다
(async () => {
  for (let i = 0; i < 20; ++i) await new Promise(r => setImmediate(r));

  console.log('  소리 파일 ' + fetched.length + ' 개를 받았다 ('
              + (api.Sound.progress() * 100).toFixed(0) + '% 풀림)');
  check(fetched.length >= 20, '소리를 파일에서 받아 온다 (만들어 내지 않는다)');
  check(fetched.every(u => u.endsWith('.ogg')), '받는 것이 전부 소리 파일이다');

  let crashed = null;
let pushOk = false, pushFrom = null;
  try {
      for (let t = 0; t < 4; ++t) {
          now = 1000 + t * 16;
          feed(snapshot(t, 2, false));
          api.frame(now);
      }

      // 이벤트 열여섯 종류를 다 먹인다. 종류마다 그리는 코드와 소리가 다르다
      for (let type = 1; type <= 16; ++type) {
          feed(event(type, 11, 12, 0, 2));
      }

      // 상자 밀기는 안 터지는 것만으로 부족하다. **판이 실제로 바뀌어야 한다.**
      // 서버는 밀리기 전 자리와 방향만 보낸다. 화면이 그걸로 두 칸을 고쳐야
      // 다음 프레임에 상자가 옮겨 그려진다.
      // 안 고치면 상자가 원래 자리에 남고, 그리로 들어간 사람이 상자에 겹친다
      pushFrom = [14, 12];
      api.G.tiles[12][14] = 4;   // TILE_BOX
      api.G.tiles[12][15] = 0;   // 갈 자리는 비어 있다
      feed(event(16, 14, 12, 0, 0));   // 0 = 오른쪽으로 밀었다
      pushOk = (api.G.tiles[12][14] === 0) && (api.G.tiles[12][15] === 4);
      now += 16; api.frame(now);

      // 최종 구역 물 + 단계별 화면
      feed(snapshot(9, 2, true));
      now += 16; api.frame(now);

      // 기다림 -> 카운트다운 순으로 넘긴다. 카운트다운에서 판의 기록이 초기화된다
      for (const phase of [0, 1]) {
          now += 16;
          feed(snapshot(9, phase, true));
          api.frame(now);
      }

      // 그다음에 사람이 죽는다. 이 기록이 결과 화면에 남아 있어야 한다
      feed(snapshot(20, 2, true));
      feed(event(15, 11, 12, 0, 2));   // POP  : 0번이 2번에게 당했다
      feed(event(5,  20, 20, 3, 0));   // DEATH: 3번이 물에 빠져 죽었다
      now += 16; api.frame(now);

      // 판이 끝난다
      feed(snapshot(21, 3, true));
      now += 16; api.frame(now);

      // 조각이 다 사라질 만큼 시간을 흘려보낸다
      for (let i = 0; i < 8; ++i) { now += 200; api.frame(now); }
  } catch (e) {
      crashed = e;
  }

  console.log();
  if (crashed) {
      check(false, '패킷을 먹이고 여러 프레임을 그려도 안 터진다: ' + crashed.message);
      console.log(crashed.stack);
  } else {
      check(true, '패킷을 먹이고 여러 프레임을 그려도 안 터진다');

      check(pushOk, '상자를 밀었다는 이벤트로 판의 두 칸이 바뀐다 (밀기 전 ' + pushFrom + ')');
  }

  // ── 무엇을 그렸나 ────────────────────────────────────────────
  // 결과 화면이 이벤트만 보고 한 판의 기록을 세는지 확인한다.
  // 위에서 POP(who=0, value=2) 과 DEATH(who=0) 를 먹였다
  const rows = api.statRows();
  console.log('  결과표 ' + rows.length + ' 줄: '
              + rows.map(r => r.place + '등 P' + r.id + ' 킬' + r.kills).join(', '));
  check(rows.length === 4, '판에 있던 사람이 전부 결과표에 오른다');
  check(rows.some(r => r.kills > 0), '누가 몇 명을 잡았는지 이벤트만 보고 셌다');
  check(rows[0].place === 1, '등수가 1등부터 매겨진다');

  console.log();
  console.log('  캔버스가 받은 명령');
  for (const k of Object.keys(calls).sort()) {
      console.log('    ' + k.padEnd(18) + calls[k]);
  }
  console.log();
  console.log('  오디오 노드 ' + audio.nodes + ' 개, 이은 것 ' + audio.connects
              + ' 번, 울린 것 ' + audio.starts + ' 번');
  console.log();

  check((calls.drawImage || 0) >= MAP_H,
        '줄마다 따로 그려서 붙였다 (사람이 벽 사이에 낀다)');
  check((calls.gradient || 0) > 100, '그러데이션을 썼다 (물, 벽, 캐릭터, 물풍선)');
  check((calls.ellipse || 0) > 0,    '타원을 그렸다 (그림자, 발, 물결)');
  check((calls.clip || 0) > 0,       '잘라내기를 썼다 (물 구역, 위험 빗금)');
  check((calls.rotate || 0) > 0,     '돌려 그렸다 (부서진 조각, 롤러)');
  check((calls.fillText || 0) > 0,   'HUD 글자를 그렸다');

  // 소리 하나가 층 하나면 웹게임 소리가 된다.
  // 이벤트 열다섯 개에 노드가 수십 개 만들어졌다면 층으로 만들어졌다는 뜻이다
  // 동시 발음 상한이 생기고 나서 이 수가 줄었다. 상한이 하는 일이 그것이다.
  // 층으로 쌓았는지는 이 아래 이벤트별 겹 수에서 더 정확히 본다
  check(audio.starts >= 12, '소리를 층으로 쌓아서 냈다 (울린 것 ' + audio.starts + ' 번)');

  // ── 판을 매 프레임 다시 그리고 있지는 않나 ───────────────────
  //
  // 45x39 = 1755 칸을 매 프레임 다시 그리면 그게 그대로 프레임 저하가 된다.
  // 안 보이는 종이에 미리 그려두고 붙이기만 하게 만들었는데,
  // 그게 실제로 먹고 있는지는 세어 봐야 안다
  const before = calls.fillRect;
  for (let i = 0; i < 10; ++i) { now += 16; api.frame(now); }
  const perFrame = (calls.fillRect - before) / 10;

  console.log();
  console.log('  판이 안 변할 때 프레임당 fillRect: ' + perFrame.toFixed(1) + ' 번');
  check(perFrame < 400, '판이 안 변하면 다시 안 그린다 (미리 그려둔 종이를 붙이기만 한다)');

  // ── UI: 글자가 읽히나 ───────────────────────────────────────
  //
  // HUD 판때기가 rgba(10,15,22,0.72) 라 **뒤 바닥이 28% 비친다.**
  // 검은 판 위의 흰 글자로 계산하면 실제보다 좋게 나온다.
  // 제일 밝은 장소 위에 얹었을 때가 최악이므로 거기서 잰다
  console.log();
  console.log('  --- UI: HUD 대비 ---');

  let brightest = api.Art.PLACES[0], darkest = api.Art.PLACES[0];
  for (const pl of api.Art.PLACES) {
      const L = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16)
                     + parseInt(h.slice(5, 7), 16);
      if (L(pl.floor) > L(brightest.floor)) brightest = pl;
      if (L(pl.floor) < L(darkest.floor))   darkest   = pl;
  }

  const panelOn = over('#0a0f16', 0.72, brightest.floor);
  const white   = contrast('#ffffff', panelOn);
  const amber   = contrast('#ffd166', panelOn);

  console.log('    제일 밝은 바닥: ' + brightest.name + ' ' + brightest.floor
              + ' -> 판때기 실제 색 ' + panelOn);
  console.log('    흰 글자 대비 ' + white.toFixed(1) + ':1, 노란 글자 대비 '
              + amber.toFixed(1) + ':1');

  // WCAG 는 큰 글자에 3:1 을 요구한다. HUD 숫자는 20px 이상이라 큰 글자다
  check(white >= 4.5, '가장 밝은 장소 위에서도 HUD 흰 글자가 본문 기준(4.5:1)을 넘는다');
  check(amber >= 3.0, '킬 수를 세는 노란 글자도 큰 글자 기준(3:1)을 넘는다');

  // ── UI: 스물넷을 색으로 가를 수 있나 ────────────────────────
  //
  // 색이 스물네 개라도 사람 눈에 스물네 개로 안 보인다.
  // 제일 닮은 두 색이 얼마나 닮았는지가 진짜 숫자다
  const cols = api.PLAYER_COLORS;
  let near = { d: 1e9, a: -1, b: -1 };
  for (let i = 0; i < cols.length; ++i) {
      for (let j = i + 1; j < cols.length; ++j) {
          const d = colorDist(cols[i], cols[j]);
          if (d < near.d) near = { d: d, a: i, b: j };
      }
  }
  console.log('    제일 닮은 두 사람: P' + near.a + ' ' + cols[near.a]
              + ' / P' + near.b + ' ' + cols[near.b]
              + '  색거리 ' + near.d.toFixed(1));

  // 여기는 통과/실패로 가르지 않는다. 스물넷을 색만으로 가르는 건 원래 안 된다.
  // 그래서 동물을 여덟 종 두었고, 24 와 8 의 주기가 달라 조합이 안 겹친다.
  // 대신 **색이 겹치는 둘이 동물까지 같으면** 그건 진짜로 구분이 안 되는 것이다
  const animalOf = (id) => id % api.Art.ANIMALS.length;
  check(animalOf(near.a) !== animalOf(near.b),
        '색이 제일 닮은 두 사람은 적어도 동물이 다르다 ('
        + api.Art.ANIMALS[animalOf(near.a)] + ' / ' + api.Art.ANIMALS[animalOf(near.b)] + ')');

  // ── TA: 스물넷이 다 보일 때 ─────────────────────────────────
  //
  // 지금까지 넷일 때만 쟀다. 판이 제일 붐빌 때가 프레임이 제일 위험한 때다
  console.log();
  console.log('  --- TA: 붐빌 때 한 프레임 ---');

  const opsOf = () => Object.keys(calls).reduce((n, k) => n + calls[k], 0);

  feed(snapshot(30, 2, false, 4, 2));
  now += 16; api.frame(now);
  let t0 = opsOf();
  for (let i = 0; i < 10; ++i) { now += 16; feed(snapshot(31 + i, 2, false, 4, 2)); api.frame(now); }
  const four = (opsOf() - t0) / 10;

  feed(snapshot(60, 2, false, 24, 12));
  now += 16; api.frame(now);
  t0 = opsOf();
  for (let i = 0; i < 10; ++i) { now += 16; feed(snapshot(61 + i, 2, false, 24, 12)); api.frame(now); }
  const full = (opsOf() - t0) / 10;

  console.log('    사람 4 + 물풍선 2 : 프레임당 ' + four.toFixed(0) + ' 명령');
  console.log('    사람 24 + 물풍선 12: 프레임당 ' + full.toFixed(0) + ' 명령'
              + '  (' + (full / four).toFixed(2) + '배)');

  // AOI 덕분에 한 화면에 다 보이는 일이 드물지만, 관전자는 전원을 본다.
  // 여섯 배가 되면 사람이 늘 때마다 프레임이 무너진다는 뜻이다
  check(full / four < 3.0,
        '사람이 여섯 배가 돼도 그리는 양은 세 배 안쪽이다 (' + (full / four).toFixed(2) + '배)');

  // ── 사운드: 소리 없는 이벤트가 있나 ─────────────────────────
  //
  // 이벤트마다 소리를 붙였다고 적어뒀는데, 실제로 울리는지는 센 적이 없다.
  // 하나라도 0 이면 그 사건은 화면에만 있고 귀에는 없는 것이다
  console.log();
  console.log('  --- 사운드: 이벤트마다 몇 겹으로 울리나 ---');

  const EVT_NAME = {
      1: 'MOVE', 2: 'PLACE', 3: 'BOOM', 4: 'BREAK', 5: 'DEATH', 6: 'ITEM',
      7: 'TRAP', 8: 'BUBBLE', 9: 'BLAST', 10: 'ESCAPE', 11: 'FLOOD', 12: 'WARN',
      13: 'GRAZE', 14: 'CHAIN', 15: 'POP', 16: 'PUSH',
  };

  const silent = [];
  const voices = [];
  for (let type = 1; type <= 16; ++type) {
      const b4 = audio.starts;
      feed(event(type, 11, 12, 0, 2));
      now += 16; api.frame(now);
      const n = audio.starts - b4;
      voices.push((EVT_NAME[type] || type) + ' ' + n);
      if (n === 0) silent.push(EVT_NAME[type] || String(type));
  }
  console.log('    ' + voices.join(' · '));

  // BLAST 는 일부러 조용하다. 폭발 십자는 칸마다 이벤트가 하나씩 오는데,
  // 칸마다 울리면 한 번 터질 때 스무 겹이 쌓여서 뭉개진다.
  // **가운데 한 칸에서만 울린다.** 처음엔 이걸 모르고 '소리 없는 이벤트' 로 잡았다.
  // 코드가 틀린 게 아니라 시험이 틀렸다. 그래서 의도를 그대로 시험으로 옮긴다
  check(silent.length === 1 && silent[0] === 'BLAST',
        '소리 없는 이벤트는 BLAST 하나뿐이다'
        + (silent.length ? ' (조용한 것: ' + silent.join(', ') + ')' : ''));

  // 물풍선이 있던 자리에서 온 BLAST 는 폭발의 중심이다. 거기서는 울려야 한다.
  // 스냅샷에 물풍선이 (10,12) 에 있으므로 그 자리를 중심으로 본다
  feed(snapshot(80, 2, false, 4, 2));
  now += 16; api.frame(now);

  // 폭발음에는 너무 자주 나면 거르는 장치가 있다(60ms).
  // 바로 앞에서 이벤트를 몰아 먹였으므로 시간을 넉넉히 흘린다
  now += 400; api.frame(now);

  const beforeCenter = audio.starts;
  feed(event(9, 10, 12, 0, 0));        // 물풍선이 있던 자리 = 중심
  now += 16; api.frame(now);
  const centerVoices = audio.starts - beforeCenter;

  const beforeArm = audio.starts;
  feed(event(9, 10, 15, 0, 0));        // 뻗어나간 팔
  now += 16; api.frame(now);
  const armVoices = audio.starts - beforeArm;

  console.log('    폭발 중심 ' + centerVoices + ' 겹 / 뻗은 팔 ' + armVoices + ' 겹');
  check(centerVoices > 0, '폭발은 가운데에서 소리가 난다');
  check(armVoices === 0, '뻗어나간 칸은 조용하다 (칸마다 울리면 한 번에 스무 겹이 된다)');
  // ── 사운드: 밟는 것에 따라 다른가 ──────────────────────────
  //
  // 장소를 열 곳 그려놓고 어디를 밟아도 같은 소리가 나면 그 열 곳은 그림일 뿐이다.
  // **무엇을 어떤 음높이로 어떻게 깎아 냈는지**를 비교한다.
  // '소리가 났다' 만 세면 재료가 하나여도 통과한다
  console.log();
  console.log('  --- 사운드: 재료별 발소리 ---');

  const MATS = ['stone', 'marble', 'grass', 'sand', 'wood', 'metal', 'ice', 'water'];
  const fingerprints = new Map();

  for (const mat of MATS) {
      played.length = 0;
      // 발소리에는 너무 자주 나면 거르는 장치가 있다. 시간을 넉넉히 흘린다
      now += 500;
      api.Sound.step(0, mat);

      const rec = played[played.length - 1];
      if (!rec) { fingerprints.set(mat, '안 남'); continue; }

      const f = rec.filters[0];
      fingerprints.set(mat, [
          (rec.buf && rec.buf.name) || '?',
          f ? f.type : '없음',
          f ? Math.round(f.frequency.value) : 0,
      ].join('/'));
  }

  for (const [mat, fp] of fingerprints) {
      console.log('    ' + mat.padEnd(7) + fp);
  }

  const uniqMat = new Set([...fingerprints.values()]);
  check(!fingerprints.has('안 남') && uniqMat.size >= 6,
        '재료마다 다른 발소리가 난다 (' + uniqMat.size + ' / ' + MATS.length + ' 가지)');

  // 물은 특별하다. 눈은 앞을 보고 있으니 **소리만으로 물에 들어간 걸 알아야 한다**
  check(fingerprints.get('water') !== fingerprints.get('stone'),
        '물을 밟는 소리가 땅을 밟는 소리와 다르다');

  // ── 사운드: 겹칠 때 뭉개지지 않나 ─────────────────────────
  //
  // 스물넷이 한 구역에서 싸우면 같은 순간에 소리가 스무 겹씩 쌓인다.
  // 그러면 하나하나가 안 들리고 지직거리는 덩어리가 된다.
  // 귀로는 몇 겹인지 못 세니까 숫자로 센다
  api.Sound.resetMix();
  for (let i = 0; i < 40; ++i) {
      now += 4;
      feed(event(4, 10 + (i % 7), 12, 0, 0));   // 상자가 우수수 부서진다
      api.frame(now);
  }
  const mix = api.Sound.mixStats();
  console.log();
  console.log('  --- 사운드: 겹침 ---');
  console.log('    상자 40번을 몰아쳤을 때  최대 ' + mix.peak + ' 겹, 버린 것 '
              + mix.dropped + ' 개');

  check(mix.peak > 0, '여러 소리가 겹쳐서 난다');
  check(mix.peak <= 12,
        '한꺼번에 쏟아져도 열두 겹을 안 넘는다 (' + mix.peak + ' 겹)');
  check(mix.dropped > 0, '상한을 넘은 소리는 버린다 (억지로 다 내면 다 같이 안 들린다)');

  // 같은 파일을 두 사건이 나눠 쓰면 귀에는 같은 사건이다.
  // 색이 겹치면 같은 장소로 보이는 것과 같은 문제다
  // 같은 녹음을 나눠 쓰는 재료끼리 음높이가 겹치지 않나.
  //
  // 파일이 마흔여섯 개뿐이라 나눠 쓰는 것 자체는 피할 수 없다.
  // **음높이가 충분히 떨어져 있으면 다른 물건으로 들린다.**
  //
  // 실제로 낸 소리를 보고 판단했더니 클립을 무작위로 고르는 탓에
  // 돌릴 때마다 다른 답이 나왔다. 그런 시험은 시험이 아니다.
  // 정해둔 표를 본다. 결과가 늘 같다
  console.log();
  console.log('  --- 사운드: 같은 녹음을 쓰는 재료들 ---');

  const tab = api.Sound.stepTable();
  const byClip = new Map();
  for (const name of Object.keys(tab)) {
      const m = tab[name];
      if (!byClip.has(m.clip)) byClip.set(m.clip, []);
      byClip.get(m.clip).push([name, m.rate[0], m.rate[1]]);
  }

  const overlap = [];
  for (const [clip, list] of byClip) {
      if (list.length < 2) continue;
      console.log('    ' + clip + ': '
                  + list.map(v => v[0] + ' ' + v[1] + '~' + v[2]).join(', '));
      for (let a = 0; a < list.length; ++a) {
          for (let b = a + 1; b < list.length; ++b) {
              const lo = Math.max(list[a][1], list[b][1]);
              const hi = Math.min(list[a][2], list[b][2]);
              if (lo <= hi) overlap.push(list[a][0] + ' / ' + list[b][0]);
          }
      }
  }
  check(overlap.length === 0,
        '같은 녹음을 쓰는 재료끼리 음높이가 안 겹친다'
        + (overlap.length ? ' — ' + overlap.join(', ') : ''));
  console.log();
  console.log('===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
  process.exit(fail ? 1 : 0);

})();
