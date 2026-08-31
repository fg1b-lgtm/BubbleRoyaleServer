// tools/wstest.js — 브라우저 없이 다리와 패킷을 확인한다
//
// 웹 클라이언트가 하는 일을 그대로 하되 화면만 안 그린다.
// 붙어서 WELCOME / MAPROW / SNAPSHOT / EVENT 가 제대로 오는지 세어 본다.
//
// 실행 순서
//   1) Server.exe fast
//   2) node web/bridge.js
//   3) node tools/wstest.js
const HEADER_SIZE = 4;
const PKT = { MOVE: 2, PLACE: 3, EVENT: 4, WELCOME: 5, MAPROW: 6, SNAPSHOT: 7, RESTART: 8 };

let pass = 0, fail = 0;
const check = (ok, what) => {
    if (ok) { ++pass; console.log('  [PASS] ' + what); }
    else    { ++fail; console.log('  [FAIL] ' + what); }
};

// 판은 두 명부터 시작한다. 혼자 붙으면 영원히 기다림 단계다.
// 그래서 아무것도 안 하는 두 번째 연결을 하나 붙여둔다
const filler = new WebSocket('ws://127.0.0.1:8080/ws');
filler.binaryType = 'arraybuffer';
filler.onerror = () => {};

const ws = new WebSocket('ws://127.0.0.1:8080/ws');
ws.binaryType = 'arraybuffer';

let welcome = null;
let welcomeCount = 0;
const seeds = new Set();
let rowsAfterRestart = 0;
let restarted = false;
const rows = new Set();
let snapshots = 0, events = 0, maxPlayers = 0, maxBubbles = 0;
const phases = new Set();
const eventKinds = new Map();

ws.onopen = () => {
    console.log('붙었다. 9.5초 동안 받아 본다.\n');

    // 3초 카운트다운이 끝나야 물풍선을 놓을 수 있다.
    // 그전에 놓으면 서버가 거절한다. 그게 맞는 동작이다
    setTimeout(() => send(move(1, 0)), 3300);
    setTimeout(() => send(move(0, 0)), 4400);
    setTimeout(() => send(place()),    4600);
    setTimeout(() => send(move(0, 1)), 4900);
    setTimeout(() => send(move(0, 0)), 6000);

    // 물풍선 퓨즈가 2.5초다. 터지는 걸 보고 나서 다시 시작을 누른다
    setTimeout(() => { restarted = true; send(restart()); }, 7600);

    setTimeout(report, 9500);
};

ws.onerror = (e) => { console.log('연결 실패. 서버와 다리가 떠 있나?'); process.exit(1); };
ws.onclose = () => {};

ws.onmessage = (e) => {
    const v = new DataView(e.data);
    const size = v.getUint16(0, true);
    const id   = v.getUint16(2, true);

    if (size !== e.data.byteLength) {
        ++fail;
        console.log('  [FAIL] 프레임 길이와 헤더 크기가 다르다 ' + size + ' vs ' + e.data.byteLength);
        return;
    }

    if (id === PKT.WELCOME) {
        let o = HEADER_SIZE;
        const u8 = () => v.getUint8(o++);
        const u16 = () => { const n = v.getUint16(o, true); o += 2; return n; };
        const u32 = () => { const n = v.getUint32(o, true); o += 4; return n; };
        welcome = {
            myId: u8(), mapW: u8(), mapH: u8(), sectorW: u8(), sectorH: u8(),
            tickRate: u8(), tileUnits: u16(), fuse: u16(), trap: u16(),
            floodEsc: u16(), blast: u8(), bodyNum: u8(), bodyDen: u8(), seed: u32(),
        };
        ++welcomeCount;
        seeds.add(welcome.seed);
    }
    else if (id === PKT.MAPROW) {
        rows.add(v.getUint8(HEADER_SIZE));
        if (restarted) ++rowsAfterRestart;
    }
    else if (id === PKT.SNAPSHOT) {
        ++snapshots;
        // SnapshotHead: tick(4) sectors(9) phase(1) phase_ticks(2) winner(1) round_no(1)
        const np = v.getUint8(HEADER_SIZE + 18);
        const nb = v.getUint8(HEADER_SIZE + 19);
        phases.add(v.getUint8(HEADER_SIZE + 13));
        if (np > maxPlayers) maxPlayers = np;
        if (nb > maxBubbles) maxBubbles = nb;
    }
    else if (id === PKT.EVENT) {
        ++events;
        const t = v.getUint8(HEADER_SIZE);
        eventKinds.set(t, (eventKinds.get(t) || 0) + 1);
    }
};

function send(buf) { if (ws.readyState === 1) ws.send(buf); }

function move(dx, dy) {
    const b = new DataView(new ArrayBuffer(HEADER_SIZE + 2));
    b.setUint16(0, HEADER_SIZE + 2, true);
    b.setUint16(2, PKT.MOVE, true);
    b.setInt8(4, dx);
    b.setInt8(5, dy);
    return b.buffer;
}

function restart() {
    const b = new DataView(new ArrayBuffer(HEADER_SIZE));
    b.setUint16(0, HEADER_SIZE, true);
    b.setUint16(2, PKT.RESTART, true);
    return b.buffer;
}

function place() {
    const b = new DataView(new ArrayBuffer(HEADER_SIZE));
    b.setUint16(0, HEADER_SIZE, true);
    b.setUint16(2, PKT.PLACE, true);
    return b.buffer;
}

function report() {
    console.log('=== WELCOME ===');
    console.log(welcome);
    console.log();

    check(welcome !== null, 'WELCOME 을 받았다');
    if (welcome) {
        check(welcome.mapW === 45 && welcome.mapH === 39, '맵 크기가 45x39 다');
        check(welcome.tickRate === 30, '틱레이트가 30 이다');
        check(welcome.tileUnits === 256, '타일이 256 units 다');
        check(welcome.bodyNum === 68 && welcome.bodyDen === 100, '몸 크기가 왔다');
        check(welcome.myId >= 0 && welcome.myId < 24, '내 번호를 받았다');

        console.log('  판 줄 ' + rows.size + ' / ' + welcome.mapH);
        check(rows.size === welcome.mapH, '판이 빠짐없이 왔다');
    }

    const secs = 9.5;
    console.log('  스냅샷 ' + snapshots + ' 개 (' + (snapshots / secs).toFixed(1) + '/초)');
    check(snapshots > secs * 25, '스냅샷이 초당 25개 이상 온다');
    check(maxPlayers >= 1, '스냅샷에 사람이 들어 있다');
    check(maxBubbles >= 1, '놓은 물풍선이 스냅샷에 보인다');

    const phaseNames = { 0: 'WAITING', 1: 'COUNTDOWN', 2: 'PLAYING', 3: 'OVER' };
    console.log('  본 단계: ' + [...phases].map(p => phaseNames[p] || p).join(', '));
    check(phases.has(2), '판이 실제로 진행 단계까지 갔다');

    const names = {
        1: 'GRAZE', 2: 'CHAIN', 3: 'TRAP', 4: 'BREAK', 5: 'DEATH', 6: 'ITEM',
        7: 'BLOCK', 8: 'BUBBLE', 9: 'BLAST', 10: 'FLOOD_WARN', 11: 'FLOOD',
        12: 'DROWN', 13: 'DROP',
    };
    console.log('  이벤트 ' + events + ' 개');
    for (const [t, n] of [...eventKinds].sort((a, b) => a[0] - b[0])) {
        console.log('    ' + (names[t] || t) + ' ' + n);
    }
    console.log('  WELCOME ' + welcomeCount + ' 번, 씨앗 ' + [...seeds].join(', '));
    check(welcomeCount === 2, '다시 시작하면 WELCOME 이 한 번 더 온다');
    check(seeds.size === 2, '다시 시작하면 맵 씨앗이 바뀐다');
    check(rowsAfterRestart === 39, '다시 시작하면 판을 다시 보내준다');

    check(eventKinds.has(8), 'BUBBLE 이벤트가 왔다 (놓은 게 화면에 나간다)');
    check(eventKinds.has(9), 'BLAST 이벤트가 왔다');

    console.log('\n===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
    process.exit(fail === 0 ? 0 : 1);
}
