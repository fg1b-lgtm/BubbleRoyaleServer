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
const PKT = { MOVE: 2, PLACE: 3, EVENT: 4, WELCOME: 5, MAPROW: 6, SNAPSHOT: 7 };

let pass = 0, fail = 0;
const check = (ok, what) => {
    if (ok) { ++pass; console.log('  [PASS] ' + what); }
    else    { ++fail; console.log('  [FAIL] ' + what); }
};

const ws = new WebSocket('ws://127.0.0.1:8080/ws');
ws.binaryType = 'arraybuffer';

let welcome = null;
const rows = new Set();
let snapshots = 0, events = 0, maxPlayers = 0, maxBubbles = 0;
const eventKinds = new Map();

ws.onopen = () => {
    console.log('붙었다. 5초 동안 받아 본다.\n');

    // 오른쪽으로 걷다가 물풍선을 놓는다
    setTimeout(() => send(move(1, 0)), 300);
    setTimeout(() => send(move(0, 0)), 1500);
    setTimeout(() => send(place()),    1700);
    setTimeout(() => send(move(0, 1)), 2000);
    setTimeout(() => send(move(0, 0)), 3200);

    setTimeout(report, 5000);
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
            floodEsc: u16(), blast: u8(), switchNum: u8(), switchDen: u8(), seed: u32(),
        };
    }
    else if (id === PKT.MAPROW) {
        rows.add(v.getUint8(HEADER_SIZE));
    }
    else if (id === PKT.SNAPSHOT) {
        ++snapshots;
        const np = v.getUint8(HEADER_SIZE + 13);
        const nb = v.getUint8(HEADER_SIZE + 14);
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
        check(welcome.switchNum === 68 && welcome.switchDen === 100, '걸치기 임계값이 왔다');
        check(welcome.myId >= 0 && welcome.myId < 24, '내 번호를 받았다');

        console.log('  판 줄 ' + rows.size + ' / ' + welcome.mapH);
        check(rows.size === welcome.mapH, '판이 빠짐없이 왔다');
    }

    const secs = 5;
    console.log('  스냅샷 ' + snapshots + ' 개 (' + (snapshots / secs).toFixed(1) + '/초)');
    check(snapshots > secs * 25, '스냅샷이 초당 25개 이상 온다');
    check(maxPlayers >= 1, '스냅샷에 사람이 들어 있다');
    check(maxBubbles >= 1, '놓은 물풍선이 스냅샷에 보인다');

    const names = {
        1: 'GRAZE', 2: 'CHAIN', 3: 'TRAP', 4: 'BREAK', 5: 'DEATH', 6: 'ITEM',
        7: 'BLOCK', 8: 'BUBBLE', 9: 'BLAST', 10: 'FLOOD_WARN', 11: 'FLOOD',
        12: 'DROWN', 13: 'DROP',
    };
    console.log('  이벤트 ' + events + ' 개');
    for (const [t, n] of [...eventKinds].sort((a, b) => a[0] - b[0])) {
        console.log('    ' + (names[t] || t) + ' ' + n);
    }
    check(eventKinds.has(8), 'BUBBLE 이벤트가 왔다 (놓은 게 화면에 나간다)');
    check(eventKinds.has(9), 'BLAST 이벤트가 왔다');

    console.log('\n===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
    process.exit(fail === 0 ? 0 : 1);
}
