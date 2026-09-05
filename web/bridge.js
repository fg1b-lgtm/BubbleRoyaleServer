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
// WebSocket 악수와 프레임, 코드 방 서버 관리는 아래에서 직접 구현한다.
// 외부 패키지가 없어서 설치 단계가 늘어나지 않는다.
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
const child  = require('child_process');

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
const ROOM_EXE    = path.join(__dirname, '..', 'bin', 'x64', 'Debug', 'Server.exe');
const ROOM_IDLE_MS = 10 * 60 * 1000;
const ROOM_MAX     = 8;
const ROOM_CHARS   = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();
let nextRoomPort = 9100;

function json(res, status, body) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': data.length,
        'Cache-Control': 'no-store',
    });
    res.end(data);
}

function readJson(req, done) {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 4096) req.destroy();
    });
    req.on('end', () => {
        try { done(null, data ? JSON.parse(data) : {}); }
        catch (_) { done(new Error('bad json')); }
    });
}

function makeRoomCode() {
    do {
        let code = '';
        const bytes = crypto.randomBytes(6);
        for (const n of bytes) code += ROOM_CHARS[n % ROOM_CHARS.length];
        if (!rooms.has(code)) return code;
    } while (true);
}

function takeRoomPort() {
    for (let i = 0; i < 100; ++i) {
        const port = nextRoomPort++;
        if (nextRoomPort > 9199) nextRoomPort = 9100;
        if (![...rooms.values()].some((room) => room.port === port)) return port;
    }
    return -1;
}

function stopRoom(room) {
    if (!room || room.stopped) return;
    room.stopped = true;
    rooms.delete(room.code);
    try { room.process.kill(); } catch (_) {}
}

function createRoom(req, res) {
    if (rooms.size >= ROOM_MAX) {
        json(res, 503, { error: '만들 수 있는 방이 가득 찼습니다. 잠시 뒤 다시 해보세요.' });
        return;
    }
    if (!fs.existsSync(ROOM_EXE)) {
        json(res, 503, { error: '게임 서버 실행 파일이 없습니다. run.bat으로 다시 시작하세요.' });
        return;
    }

    readJson(req, (error, body) => {
        if (error) { json(res, 400, { error: '방 설정을 읽지 못했습니다.' }); return; }

        const capacity = Number.isInteger(body.capacity) ? body.capacity : 8;
        const bots = Number.isInteger(body.bots) ? body.bots : 0;
        if (capacity < 2 || capacity > 24) {
            json(res, 400, { error: '방 인원은 2명부터 24명까지 고를 수 있습니다.' });
            return;
        }
        if (bots < 0 || bots >= capacity) {
            json(res, 400, { error: '봇 수는 방 인원보다 적어야 합니다.' });
            return;
        }
        const code = makeRoomCode();
        const port = takeRoomPort();
        if (port < 0) {
            json(res, 503, { error: '사용할 수 있는 방 포트가 없습니다.' });
            return;
        }
        const seed = crypto.randomBytes(4).readUInt32LE(0);
        const proc = child.spawn(ROOM_EXE,
            ['port', String(port), 'players', String(capacity),
             'bots', String(bots), 'seed', String(seed)], {
                cwd: path.join(__dirname, '..'),
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        const room = { code, port, capacity, bots, process: proc, clients: 0, lastUsed: Date.now(),
                       stopped: false, readyText: '' };
        rooms.set(code, room);

        let answered = false;
        const answer = (status, payload) => {
            if (answered) return;
            answered = true;
            clearTimeout(timeout);
            json(res, status, payload);
        };
        const timeout = setTimeout(() => {
            stopRoom(room);
            answer(503, { error: '방 서버가 제시간에 시작되지 않았습니다.' });
        }, 10000);

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (line) => {
            const raw = String(line);
            const text = raw.trim();
            if (text) console.log('[room ' + code + '] ' + text);
            // Windows 파이프는 한 줄도 임의의 위치에서 자를 수 있다.
            // "listeni" / "ng on port" 두 조각으로 와도 준비 완료를 놓치지 않는다.
            room.readyText = (room.readyText + raw).slice(-512);
            if (room.readyText.includes('listening on port ' + port)) {
                answer(201, { code, capacity, bots });
            }
        });
        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (line) => console.log('[room ' + code + '] ' + String(line).trim()));
        proc.on('error', () => {
            stopRoom(room);
            answer(503, { error: '방 서버를 실행하지 못했습니다.' });
        });
        proc.on('exit', (codeValue) => {
            rooms.delete(code);
            if (!answered) answer(503, { error: '방 서버가 시작 중 종료됐습니다. (' + codeValue + ')' });
        });
    });
}

setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
        if (room.clients === 0 && now - room.lastUsed > ROOM_IDLE_MS) stopRoom(room);
    }
}, 30000).unref();

// ── 정적 파일 ────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/api/shutdown'
        && req.headers['x-bubble-shutdown'] === 'run-bat') {
        json(res, 202, { ok: true });
        setImmediate(() => {
            stopAllRooms();
            server.close(() => process.exit(0));
        });
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/rooms') {
        createRoom(req, res);
        return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/rooms/')) {
        const code = url.pathname.slice('/api/rooms/'.length).toUpperCase();
        const room = rooms.get(code);
        if (!room) json(res, 404, { error: '방을 찾지 못했습니다. 코드를 다시 확인하세요.' });
        else json(res, 200, { code: room.code, capacity: room.capacity, bots: room.bots });
        return;
    }

    let file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    file = file.split('?')[0];

    // 위로 못 올라가게 막는다. 이 폴더 안의 파일만 준다.
    //
    // startsWith(__dirname) 만 보면 안 된다. __dirname 이 ".../web" 이면
    // ".../web-secret/x" 도 문자열로는 그 접두어를 만족한다 - 형제 폴더인데
    // 안쪽인 것처럼 통과한다. 구분자까지 같이 봐야 "그 폴더 안"이 된다
    const full = path.join(__dirname, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (full !== __dirname && !full.startsWith(__dirname + path.sep)) {
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
                   : full.endsWith('.mp3')  ? 'audio/mpeg'
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
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/ws') {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return;
    }

    const code = (url.searchParams.get('room') || '').toUpperCase();
    const room = code ? rooms.get(code) : null;
    if (code && !room) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return;
    }

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
    attach(socket, room ? room.port : GAME_PORT, room);
});

// ── 브라우저 하나 = 게임 서버 연결 하나 ──────────────────────

function attach(ws, gamePort, room) {
    const game = net.createConnection({ host: GAME_HOST, port: gamePort });
    game.setNoDelay(true);

    if (room) {
        room.clients += 1;
        room.lastUsed = Date.now();
    }

    let alive = true;
    const close = () => {
        if (!alive) return;
        alive = false;
        if (room) {
            room.clients = Math.max(0, room.clients - 1);
            room.lastUsed = Date.now();
        }
        try { ws.destroy(); }   catch (e) {}
        try { game.destroy(); } catch (e) {}
    };

    game.on('connect', () => console.log('[bridge] 붙었다 ->', GAME_HOST + ':' + gamePort));
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

function stopAllRooms() {
    for (const room of Array.from(rooms.values())) stopRoom(room);
}

process.on('exit', stopAllRooms);
process.once('SIGINT', () => {
    stopAllRooms();
    server.close(() => process.exit(0));
});
process.once('SIGTERM', () => {
    stopAllRooms();
    server.close(() => process.exit(0));
});

// 로컬 데모이므로 루프백에만 연다. 같은 LAN에서 재시작 요청까지 받지 않는다.
server.listen(WEB_PORT, '127.0.0.1', () => {
    console.log('[bridge] http://127.0.0.1:' + WEB_PORT + ' 를 열어라');
    console.log('[bridge] 게임 서버는 ' + GAME_HOST + ':' + GAME_PORT + ' 에 있어야 한다');
    if (DELAY_MS || JITTER_MS) {
        console.log('[bridge] 일부러 늦춘다: 한쪽 ' + DELAY_MS + 'ms'
                    + (JITTER_MS ? ' + 흔들림 ' + JITTER_MS + 'ms' : '')
                    + '  (왕복 ' + (DELAY_MS * 2) + 'ms)');
    }
});
