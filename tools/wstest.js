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
const PKT = { MOVE: 2, PLACE: 3, EVENT: 4, WELCOME: 5, MAPROW: 6, SNAPSHOT: 7,
              RESTART: 8, DASH: 9 };

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
let snapsAfterRestart = 0;
let restarted = false;
const rows = new Set();
let snapshots = 0, events = 0, maxPlayers = 0, maxBubbles = 0;
const phases = new Set();
const eventKinds = new Map();
let sizeMismatch = 0;
const facesSeen = new Set();
let sawMoving = false, sawStanding = false;

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
    // 대쉬를 스무 번 도배한다. 안 먹었으니 하나도 안 나가야 하고,
    // 그러고도 스냅샷이 계속 와야 한다
    setTimeout(() => {
        for (let i = 0; i < 20; ++i) send(dash(i % 2 ? 1 : 0, i % 2 ? 0 : 1));
        dashSentAt = snapshots;
    }, 6400);
    setTimeout(() => { dashSnaps = snapshots - dashSentAt; }, 7200);

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
            floodEsc: u16(), blast: u8(), bodyNum: u8(), bodyDen: u8(),
            peek: u8(), camHyst: u8(), seed: u32(),
        };
        ++welcomeCount;
        seeds.add(welcome.seed);
    }
    else if (id === PKT.MAPROW) {
        rows.add(v.getUint8(HEADER_SIZE));
        if (restarted) ++rowsAfterRestart;
    }
    else if (id === PKT.SNAPSHOT) {
        if (restarted) ++snapsAfterRestart;
        ++snapshots;

        // SnapshotHead 는 28 바이트다. 하나라도 틀리면 그 뒤가 전부 밀린다.
        //   tick 4 | sectors 9 | phase 1 | phase_ticks 2 | winner 1 | round_no 1
        //   ring 4 | alive_count 1 | alive_mask 3 | player_count 1 | bubble_count 1
        //
        // 예전에 여기를 18, 19 로 적어놨었다. ring 이 생기면서 밀린 건데,
        // 안 쓸 때 ring 이 0xFF 라 "사람 255명" 으로 읽혔고
        // "사람이 하나 이상 있다" 는 검사가 늘 통과해서 5일 동안 안 들켰다.
        // 시험이 통과한다고 시험이 맞는 건 아니다
        const HEAD = HEADER_SIZE + 28;

        phases.add(v.getUint8(HEADER_SIZE + 13));
        const np = v.getUint8(HEADER_SIZE + 26);
        const nb = v.getUint8(HEADER_SIZE + 27);
        if (np > maxPlayers) maxPlayers = np;
        if (nb > maxBubbles) maxBubbles = nb;

        if (v.byteLength !== HEAD + np * PS + nb * 4) {
            ++sizeMismatch;
        }

        // 내 캐릭터의 flags 에서 보는 쪽과 걷는지를 꺼낸다.
        // 화면이 앞뒤옆을 나눠 그리려면 이 두 개가 실제로 와야 한다
        for (let i = 0; i < np; ++i) {
            const o = HEAD + i * PS;
            if (v.getUint8(o) !== welcome.myId) continue;

            const f = v.getUint8(o + 7);
            facesSeen.add((f & 0x60) >> 5);
            if (f & 0x10) sawMoving = true;
            else          sawStanding = true;
        }
    }
    else if (id === PKT.EVENT) {
        ++events;
        const t = v.getUint8(HEADER_SIZE);
        eventKinds.set(t, (eventKinds.get(t) || 0) + 1);
    }
};

// PlayerState 한 사람이 몇 바이트인가. Protocol.h 의 struct 와 같아야 한다.
// 9/2 에 대쉬 한 바이트가 붙어 11 -> 12 가 됐다.
// 두 군데에 적어놨더니 서버를 고친 날 시험이 조용히 틀렸다 — 한 곳에만 적는다
const PS = 12;

let dashSentAt = 0, dashSnaps = 0;

function send(buf) { if (ws.readyState === 1) ws.send(buf); }

function move(dx, dy) {
    const b = new DataView(new ArrayBuffer(HEADER_SIZE + 2));
    b.setUint16(0, HEADER_SIZE + 2, true);
    b.setUint16(2, PKT.MOVE, true);
    b.setInt8(4, dx);
    b.setInt8(5, dy);
    return b.buffer;
}

// 대쉬. **아직 안 먹었을 때 보내는 것**을 일부러 시험한다.
//
// 아무 일도 안 일어나는 게 맞는데, 여기서 확인하려는 건 '아무 일도 안 일어나는 것'
// 자체가 아니라 **연결이 안 끊기는 것**이다. 몸통 크기를 잘못 세면 서버가
// 이상한 패킷으로 보고 끊어버린다. 그러면 대쉬를 누른 사람이 튕긴다.
// 클라를 고친 사람이 이걸 도배해도 서버가 버텨야 한다
function dash(dx, dy) {
    const b = new DataView(new ArrayBuffer(HEADER_SIZE + 2));
    b.setUint16(0, HEADER_SIZE + 2, true);
    b.setUint16(2, PKT.DASH, true);
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
        // 숫자를 박아두지 않는다. 상수를 고칠 때마다 시험이 깨지면 시험을 안 믿게 된다.
        // 여기서 지킬 것은 값이 얼마냐가 아니라 **규칙**이다.
        //   1.0 보다 작아야 한다. 같거나 크면 통로에 못 들어가고 걸치기 자체가 사라진다
        //   0.5 보다 커야 한다. 너무 작으면 화면에서 사람이 점으로 보인다
        const body = welcome.bodyNum / welcome.bodyDen;
        check(body > 0.5 && body < 1.0,
              '몸 크기가 한 칸보다 작다 (' + body.toFixed(2) + ')');
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

    // **다시 시작한 뒤에도 스냅샷이 계속 와야 한다.**
    //
    // 9/2 에 여기가 통째로 멎었다. 판이 다시 깔릴 때 사람이 새 자리에 앉는데
    // Session 이 옛 자리 번호를 들고 있어서, AOI 가 엉뚱한 구역을 답하고
    // 어느 묶음에도 안 걸렸다. 서버는 멀쩡히 돌고 브라우저만 멈춘다.
    //
    // 이 시험이 없어서 못 잡았다. 다시 시작이 오간 것만 보고 그 뒤를 안 봤다
    check(snapsAfterRestart > 30,
          '다시 시작한 뒤에도 스냅샷이 계속 온다 (' + snapsAfterRestart + '장)');

    check(sizeMismatch === 0,
          '스냅샷 길이가 머리에 적힌 사람/물풍선 수와 맞는다 (' + sizeMismatch + ' 번 어긋남)');

    // 화면이 앞뒤옆을 나눠 그리려면 이게 실제로 와야 한다.
    // 오른쪽으로 갔다가 멈췄다가 아래로 가는 순서로 눌러놨다
    const faceNames = ['아래', '왼', '오른', '위'];
    console.log('  본 방향: ' + [...facesSeen].map(f => faceNames[f]).join(', '));
    check(facesSeen.has(2), '오른쪽으로 갈 때 오른쪽을 본다');
    check(facesSeen.has(0), '아래로 갈 때 아래를 본다');
    check(sawMoving && sawStanding, '걷는 상태와 서 있는 상태가 둘 다 온다');

    check(dashSnaps > 15,
          '대쉬를 스무 번 보내도 안 끊긴다 (' + dashSnaps + '장 더 왔다)');

    check(eventKinds.has(8), 'BUBBLE 이벤트가 왔다 (놓은 게 화면에 나간다)');
    check(eventKinds.has(9), 'BLAST 이벤트가 왔다');

    console.log('\n===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
    process.exit(fail === 0 ? 0 : 1);
}
