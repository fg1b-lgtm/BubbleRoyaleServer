// tools/viewertest.js — 자리가 없을 때 들어온 사람은 어떻게 되나
//
// SPEC 2.1 의 규칙: 판이 다 찼으면 끊지 않고 관전시킨다.
// 그 경로에 코드가 있다 (main.cpp 의 AddViewer / SeatViewers,
// Aoi.h 의 관전자 묶음 SendToSector(-1)). **시험이 하나도 없었다.**
//
// 끊어버리는 것과 관전시키는 것은 밖에서 보면 비슷해 보인다.
// 링크를 받은 사람이 "안 되네" 하고 닫는 것과 "기다리면 되는구나" 는 다른 일이다.
//
// 봇으로는 이 경로를 못 만든다. **사람이 봇보다 우선이라 봇을 하나 빼고 앉힌다**
// (main.cpp 의 DropOneBot). 그래서 사람 스물넷을 먼저 붙여놓고
// 스물다섯 번째로 붙어야 관전자가 된다.
//
// 실행 순서
//   1) Server.exe fast bots 0
//   2) node web/bridge.js
//   3) node tools/viewertest.js
const HEADER_SIZE = 4;
const PKT = { WELCOME: 5, MAPROW: 6, SNAPSHOT: 7 };
const VIEWER_ID = 0xFF;   // 자리를 못 받았다는 표시

let pass = 0, fail = 0;
const check = (ok, what) => {
    if (ok) { ++pass; console.log('  [PASS] ' + what); }
    else    { ++fail; console.log('  [FAIL] ' + what); }
};

// 자리를 다 채운다. 이 스물넷은 아무것도 안 하고 앉아만 있는다
const SEATS = 24;
const fillers = [];
for (let i = 0; i < SEATS; ++i) {
    const f = new WebSocket('ws://127.0.0.1:8080/ws');
    f.binaryType = 'arraybuffer';
    f.onerror = () => {};
    fillers.push(f);
}

let ws = null;

// 스물넷이 다 앉은 뒤에 붙는다. 같이 붙이면 누가 스물다섯 번째인지 알 수 없다
setTimeout(() => {
    ws = new WebSocket('ws://127.0.0.1:8080/ws');
    ws.binaryType = 'arraybuffer';
    ws.onerror = () => {};
    ws.onclose = () => { closedEarly = true; };
    ws.onmessage = onMessage;
}, 1200);

let welcome = null;
let rows = new Set();
let snapshots = 0, playersSeen = 0;
let closedEarly = false;

function onMessage(ev) {
    const v = new DataView(ev.data);
    if (v.byteLength < HEADER_SIZE) return;
    const id = v.getUint16(2, true);

    if (id === PKT.WELCOME) {
        welcome = {
            myId: v.getUint8(HEADER_SIZE),
            mapW: v.getUint8(HEADER_SIZE + 1),
            mapH: v.getUint8(HEADER_SIZE + 2),
        };
    }
    else if (id === PKT.MAPROW) {
        rows.add(v.getUint8(HEADER_SIZE));
    }
    else if (id === PKT.SNAPSHOT) {
        ++snapshots;
        const np = v.getUint8(HEADER_SIZE + 26);
        if (np > playersSeen) playersSeen = np;
    }
}

const SECS = 6;

setTimeout(() => {
    console.log('\n=== 자리가 없을 때 (사람 24명이 다 앉아 있다) ===\n');

    check(!closedEarly, '자리가 없어도 연결을 안 끊는다');
    check(welcome !== null, '자리가 없어도 WELCOME 이 온다');

    if (welcome) {
        check(welcome.myId === VIEWER_ID,
              '내 번호가 관전 표시(255)로 온다 — 자리를 못 받았다는 뜻');
        check(rows.size === welcome.mapH,
              '관전자에게도 판을 다 보내준다 (' + rows.size + '줄)');
    }

    check(snapshots > (SECS - 2) * 25,
          '관전자에게도 스냅샷이 초당 25장 이상 온다 (' + snapshots + '장)');

    // 관전자는 어느 구역도 안 보고 있다. 그래서 AOI 가 안 걸리고 전원이 보여야 한다.
    // 여기가 0 이면 관전 화면이 빈 판만 보게 된다
    check(playersSeen >= 2,
          '관전자는 구역에 매이지 않아 여러 명이 한 장에 들어온다 (' + playersSeen + '명)');

    console.log('\n===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
    if (ws) ws.close();
    for (const f of fillers) f.close();
    process.exit(fail === 0 ? 0 : 1);
}, SECS * 1000);

setTimeout(() => {
    if (welcome === null && !closedEarly) {
        console.log('연결 실패. 서버와 다리가 떠 있나?');
        process.exit(1);
    }
}, 3000);
