// web/bridge.js — 브라우저와 C++ 서버 사이의 다리
//
// 브라우저는 TCP 소켓을 못 연다. WebSocket 만 쓸 수 있다.
// 그래서 이 다리가 WebSocket 을 받아서 TCP 로 바꿔 서버에 붙여준다.
//
//   브라우저 --WebSocket--> bridge.js --TCP--> Server.exe
//
// 실행: node web/bridge.js
//       그다음 브라우저에서 http://127.0.0.1:8080
//
// 바깥 라이브러리를 안 쓴다. npm install 이 필요 없다.
// 제출물이라 node_modules 를 넣고 싶지 않고, 받는 사람도 그냥 node 만 있으면 된다.
// WebSocket 악수와 프레임은 아래에 직접 구현했다. 200줄이 안 된다.
//
// 이 다리가 하는 일이 하나 더 있다.
//   TCP 는 보낸 단위와 받는 단위가 다르다. 서버가 패킷 세 개를 보내도
//   한 덩어리로 오거나 반씩 잘려 온다.
//   여기서 [uint16 size] 를 읽어 패킷 단위로 잘라서 WebSocket 프레임 하나에 하나씩 보낸다.
//   그래서 브라우저 쪽 코드는 경계를 신경 쓸 필요가 없다.

const http   = require('http');
const net    = require('net');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// 일부러 늦게 보낸다. 지연이 있는 네트워크를 흉내 내는 스위치.
//
//   node web/bridge.js delay 80        한쪽으로 80ms. 왕복 160ms
//   node web/bridge.js delay 80 jitter 30   흔들림까지
//
// 왜 필요한가. 이 게임은 같은 컴퓨터에서만 돌려봤다. 그래서 **손맛을 지연 0 을
// 전제로 맞추고 있다.** 인터넷 너머로 붙는 순간 조작이 늘어지는데,
// 그걸 재보지 않으면 늘어지는지도 모른다.
// 여기서 늦추면 서버도 클라이언트도 안 고치고 그 상황을 만들 수 있다
let DELAY_MS = 0, JITTER_MS = 0;
for (let i = 2; i < process.argv.length; ++i) {
    if (process.argv[i] === 'delay')  DELAY_MS  = parseInt(process.argv[++i], 10) || 0;
    if (process.argv[i] === 'jitter') JITTER_MS = parseInt(process.argv[++i], 10) || 0;
}

// 늦춰 보낸다. 지연이 0 이면 그냥 바로 보낸다 —
// setTimeout 을 거치면 그것만으로 한 프레임이 밀린다
function later(fn) {
    if (DELAY_MS <= 0 && JITTER_MS <= 0) { fn(); return; }
    const ms = DELAY_MS + (JITTER_MS ? Math.random() * JITTER_MS : 0);
    setTimeout(fn, ms);
}

const WEB_PORT    = 8080;
const GAME_HOST   = '127.0.0.1';
const GAME_PORT   = 9000;
const HEADER_SIZE = 4;              // Common/Protocol.h 와 같아야 한다
const WS_GUID     = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ── 정적 파일 ────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    let file = req.url === '/' ? 'index.html' : req.url.replace(/^\//, '');
    file = file.split('?')[0];

    // 위로 못 올라가게 막는다. 이 폴더 안의 파일만 준다
    const full = path.join(__dirname, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('no');
        return;
    }

    fs.readFile(full, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('not found');
            return;
        }

        const type = full.endsWith('.html') ? 'text/html; charset=utf-8'
                   : full.endsWith('.js')   ? 'text/javascript; charset=utf-8'
                   : full.endsWith('.css')  ? 'text/css; charset=utf-8'
                   : full.endsWith('.ogg')  ? 'audio/ogg'
                   : full.endsWith('.png')  ? 'image/png'
                   : full.endsWith('.json') ? 'application/json; charset=utf-8'
                   :                          'application/octet-stream';

        res.writeHead(200, { 'Content-Type': type });
        res.end(data);
    });
});

// ── WebSocket 악수 ───────────────────────────────────────────
//
// 브라우저가 Sec-WebSocket-Key 를 보내면,
// 거기에 정해진 문자열을 붙여 SHA-1 을 돌리고 base64 로 답한다.
// 규격에 그렇게 하라고 적혀 있다. 뜻이 있는 값은 아니고 약속이다.

server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
        socket.destroy();
        return;
    }

    const accept = crypto.createHash('sha1')
                         .update(key + WS_GUID)
                         .digest('base64');

    socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n' +
        '\r\n'
    );

    socket.setNoDelay(true);
    attach(socket);
});

// ── 브라우저 하나 = 게임 서버 연결 하나 ──────────────────────

function attach(ws) {
    const game = net.createConnection({ host: GAME_HOST, port: GAME_PORT });
    game.setNoDelay(true);

    let alive = true;
    const close = () => {
        if (!alive) return;
        alive = false;
        try { ws.destroy(); }   catch (e) {}
        try { game.destroy(); } catch (e) {}
    };

    game.on('connect', () => console.log('[bridge] 붙었다 ->', GAME_HOST + ':' + GAME_PORT));
    game.on('error', (e) => { console.log('[bridge] 서버 연결 실패:', e.message); close(); });
    game.on('close', close);
    ws.on('error', close);
    ws.on('close', close);

    // ── 서버 -> 브라우저 ──
    // 패킷 단위로 잘라서 프레임 하나에 하나씩 보낸다.
    // 서버의 RecvBuffer 가 하는 일과 같은 일을 여기서 한다
    let acc = Buffer.alloc(0);

    game.on('data', (chunk) => {
        acc = Buffer.concat([acc, chunk]);

        while (acc.length >= HEADER_SIZE) {
            const size = acc.readUInt16LE(0);

            if (size < HEADER_SIZE || size > 65535) {
                console.log('[bridge] 말이 안 되는 크기', size);
                close();
                return;
            }
            if (acc.length < size) {
                break;   // 아직 덜 왔다
            }

            // 지연 스위치가 켜져 있으면 늦게 보낸다.
            // subarray 는 원본을 가리키므로 복사해서 넘긴다 — 늦게 보내는 사이에
            // acc 가 잘려나가면 엉뚱한 바이트가 나간다
            const packet = Buffer.from(acc.subarray(0, size));
            later(() => wsSend(ws, packet));
            acc = acc.subarray(size);
        }
    });

    // ── 브라우저 -> 서버 ──
    let inbox = Buffer.alloc(0);

    ws.on('data', (chunk) => {
        inbox = Buffer.concat([inbox, chunk]);

        for (;;) {
            const frame = wsRead(inbox);
            if (!frame) break;

            inbox = inbox.subarray(frame.used);

            if (frame.opcode === 0x8) { close(); return; }   // 닫자고 한다
            if (frame.opcode === 0x9) { continue; }          // ping. 무시한다
            if (frame.payload.length > 0 && alive) {
                // 올라가는 쪽도 똑같이 늦춘다. 지연은 한 방향이 아니다
                const up = Buffer.from(frame.payload);
                later(() => { try { game.write(up); } catch (e) {} });
            }
        }
    });
}

// ── WebSocket 프레임 ─────────────────────────────────────────
//
// 브라우저가 보내는 프레임은 항상 마스킹되어 있다. 4바이트 키로 XOR 해서 푼다.
// 서버가 보내는 프레임은 마스킹하지 않는다. 규격이 그렇다.

function wsRead(buf) {
    if (buf.length < 2) return null;

    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let   len    = buf[1] & 0x7f;
    let   pos    = 2;

    if (len === 126) {
        if (buf.length < pos + 2) return null;
        len = buf.readUInt16BE(pos);
        pos += 2;
    }
    else if (len === 127) {
        if (buf.length < pos + 8) return null;
        len = Number(buf.readBigUInt64BE(pos));
        pos += 8;
    }

    let mask = null;
    if (masked) {
        if (buf.length < pos + 4) return null;
        mask = buf.subarray(pos, pos + 4);
        pos += 4;
    }

    if (buf.length < pos + len) return null;

    const payload = Buffer.from(buf.subarray(pos, pos + len));
    if (mask) {
        for (let i = 0; i < payload.length; ++i) {
            payload[i] ^= mask[i & 3];
        }
    }

    return { opcode, payload, used: pos + len };
}

function wsSend(sock, data) {
    const len = data.length;
    let head;

    if (len < 126) {
        head = Buffer.from([0x82, len]);              // 0x82 = 마지막 프레임 + 바이너리
    }
    else if (len < 65536) {
        head = Buffer.alloc(4);
        head[0] = 0x82;
        head[1] = 126;
        head.writeUInt16BE(len, 2);
    }
    else {
        head = Buffer.alloc(10);
        head[0] = 0x82;
        head[1] = 127;
        head.writeBigUInt64BE(BigInt(len), 2);
    }

    try {
        sock.write(head);
        sock.write(data);
    }
    catch (e) { /* 이미 닫혔다 */ }
}

server.listen(WEB_PORT, () => {
    console.log('[bridge] http://127.0.0.1:' + WEB_PORT + ' 를 열어라');
    console.log('[bridge] 게임 서버는 ' + GAME_HOST + ':' + GAME_PORT + ' 에 있어야 한다');
    if (DELAY_MS || JITTER_MS) {
        console.log('[bridge] 일부러 늦춘다: 한쪽 ' + DELAY_MS + 'ms'
                    + (JITTER_MS ? ' + 흔들림 ' + JITTER_MS + 'ms' : '')
                    + '  (왕복 ' + (DELAY_MS * 2) + 'ms)');
    }
});
