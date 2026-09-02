// tools/playshot.js — 사람처럼 한 판 하면서 화면을 찍는다
//
// 왜 만들었나.
//   화면은 시험으로 다 못 본다. clienttest 는 "명령이 몇 번 갔나" 까지만 안다.
//   그림이 실제로 어떻게 보이는지, 겹치는지, 읽히는지는 눈으로 봐야 한다.
//
//   msedge --screenshot 도 써봤는데 못 쓴다. --virtual-time-budget 은
//   **페이지 시계만 앞당기고 네트워크는 안 기다린다.** 판이 도착하기 전에 찍혀서
//   빈 바닥만 나온다. 그래서 브라우저를 띄워두고 원하는 순간에 직접 찍는다.
//
// 어떻게.
//   헤드리스 브라우저를 원격 디버깅 포트로 열고 CDP 로 붙는다.
//   Input.dispatchKeyEvent 로 키를 누르니 **실제로 플레이가 된다.**
//   Page.captureScreenshot 으로 원하는 순간을 찍는다.
//   바깥 라이브러리를 안 쓴다. Node 의 WebSocket 과 fetch 만 쓴다.
//
// 실행
//   Server.exe fast bots 11  +  node web/bridge.js  를 먼저 띄우고
//   node tools/playshot.js [저장폴더]
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const OUT = process.argv[2] || path.join(__dirname, '..', 'shots');
const PORT = 9333;
const EDGE = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => fs.existsSync(p));

if (!EDGE) {
    console.log('브라우저를 못 찾았다.');
    process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── CDP ──────────────────────────────────────────────────────
let ws = null;
let msgId = 0;
const waiting = new Map();

function cdp(method, params) {
    const id = ++msgId;
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    return new Promise((resolve) => waiting.set(id, resolve));
}

// 키를 누르고 뗀다. 게임은 keydown/keyup 으로 방향을 잡는다
async function keyDown(key, code) {
    await cdp('Input.dispatchKeyEvent', {
        type: 'keyDown', key, code, windowsVirtualKeyCode: vk(key), nativeVirtualKeyCode: vk(key),
    });
}
async function keyUp(key, code) {
    await cdp('Input.dispatchKeyEvent', {
        type: 'keyUp', key, code, windowsVirtualKeyCode: vk(key), nativeVirtualKeyCode: vk(key),
    });
}
// 눌렀다 뗀다. 연타를 흉내 내려면 뗐다 다시 눌러야 한다 —
// 누른 채로 두면 브라우저가 keydown 을 자동 반복으로 계속 보내는데,
// 게임은 그걸 연타로 안 센다 (안 그러면 걷기만 해도 대쉬가 나간다)
async function key(k, holdMs) {
    await keyDown(k, k);
    await sleep(holdMs || 40);
    await keyUp(k, k);
}

function vk(key) {
    const map = { w: 87, a: 65, s: 83, d: 68, ' ': 32, r: 82, m: 77 };
    return map[key.toLowerCase()] || 0;
}

async function shot(name, clip) {
    const r = await cdp('Page.captureScreenshot',
                        clip ? { format: 'png', clip } : { format: 'png' });
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    console.log('  찍음 ' + name + '.png');
}

// 확대해서 잘라 찍는다.
//
// 전체 화면만 보면 캐릭터가 40픽셀짜리라 눈코입이 안 보인다.
// 그림을 검사하려면 사람이 얼굴을 들이대고 보는 것과 같은 걸 해야 한다.
// scale 3 이면 세 배로 키워서 찍는다
async function zoom(name, x, y, w, h, scale) {
    await shot(name, { x, y, width: w, height: h, scale: scale || 3 });
}

// 내 캐릭터가 화면 어디에 그려지고 있나. 확대할 자리를 알아야 한다
const WHERE = '(function(){ try {'
  + ' var cv = document.querySelector("canvas");'
  + ' var b = cv.getBoundingClientRect();'
  + ' return JSON.stringify({ cx:b.left, cy:b.top, cw:b.width, ch:b.height,'
  + '   ts: Art.V.TS, vw: Art.V.TS * 21, viewX: 0 });'
  + ' } catch(e) { return JSON.stringify({err:String(e)}); } })()';

async function where() {
    const r = await cdp('Runtime.evaluate', { expression: WHERE, returnByValue: true });
    try { return JSON.parse(r.result.value || '{}'); } catch (e) { return {}; }
}

// 화면 안의 값을 그대로 꺼내 온다. 찍은 그림이 어느 순간인지 알아야 한다.
//
// 처음엔 G.tiles.flat() 으로 셌는데 늘 0 이 나왔다. 코드가 아니라 이 줄이 틀렸다.
// G.tiles 는 Uint8Array 의 배열이고, flat 은 typed array 를 안 편다.
// 판이 다 와 있는데도 '아무것도 안 왔다' 로 읽혀서 클라이언트를 의심할 뻔했다
const PEEK = '(function(){ try {'
  + ' var w=0,b=0,x2=0;'
  + ' if (G.tiles) { for (var y=0;y<G.tiles.length;++y) { var row=G.tiles[y];'
  + '   for (var x=0;x<row.length;++x) { var t=row[x];'
  + '     if (t===1) ++w; else if (t===2) ++b; else if (t===4) ++x2; } } }'
  + ' var np = G.players ? G.players.size : 0;'
  + ' var me = G.players ? G.players.get(G.myId) : null;'
  + ' var dash = me ? (me.has_dash ? me.dash_cd : -1) : -2;'
  + ' var mx = me ? me.x1 : 0, my = me ? me.y1 : 0;'
  + ' return JSON.stringify({ phase:G.phase, alive:G.aliveCount, round:G.roundNo,'
  + '   me:G.myId, walls:w, blocks:b, boxes:x2, drawn:np, dash:dash, mx:mx, my:my,'
  + '   alive:(me ? ((me.flags & 1) ? 1 : 0) : -1),'
  + '   bubbles:(G.bubbles||[]).length });'
  + ' } catch(e) { return JSON.stringify({err:String(e)}); } })()';

async function peek() {
    const r = await cdp('Runtime.evaluate', { expression: PEEK, returnByValue: true });
    try { return JSON.parse(r.result.value || '{}'); } catch (e) { return {}; }
}

(async () => {
    const browser = spawn(EDGE, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--window-size=1600,900',
        '--remote-debugging-port=' + PORT,
        '--user-data-dir=' + path.join(OUT, '_profile'),
        '--no-first-run', '--no-default-browser-check',
        'http://127.0.0.1:8080',
    ], { stdio: 'ignore' });

    // 디버깅 포트가 열릴 때까지
    let target = null;
    for (let i = 0; i < 40 && !target; ++i) {
        await sleep(250);
        try {
            const list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json();
            target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        } catch (e) { /* 아직 안 떴다 */ }
    }
    if (!target) { console.log('브라우저에 못 붙었다.'); browser.kill(); process.exit(1); }

    ws = new WebSocket(target.webSocketDebuggerUrl);
    // 페이지에서 터진 예외를 그대로 받는다.
    //
    // 이게 없으면 화면이 안 움직일 때 서버를 의심하게 된다.
    // 실제로 한 번 그랬다 — 서버는 멀쩡히 판을 돌리고 있는데 화면만 멈춰 있었고,
    // 원인은 클라이언트 코드에서 난 예외였다. 브라우저 콘솔을 못 보니 안 보였다
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m.result || {}); waiting.delete(m.id); }

        if (m.method === 'Runtime.exceptionThrown') {
            const d = m.params.exceptionDetails || {};
            const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text;
            console.log('  [페이지 예외] ' + String(msg).split(String.fromCharCode(10))[0]);
        }
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
            console.log('  [페이지 오류] '
                        + m.params.args.map((a) => a.value || a.description).join(' '));
        }
    };
    await new Promise((r) => { ws.onopen = r; });

    await cdp('Page.enable');
    await cdp('Runtime.enable');

    console.log('\n=== 한 판 하면서 찍는다 ===\n');

    // 판이 실제로 도착할 때까지 **진짜로 기다린다.** 여기가 --screenshot 이 못 하던 것
    let st = {};
    for (let i = 0; i < 60; ++i) {
        await sleep(500);
        st = await peek();
        if (st.walls > 0 && st.phase === 2) break;
    }
    console.log('  판 도착: 벽 ' + st.walls + ' 칸, 상자 ' + st.blocks + ' 칸, 단계 ' + st.phase
                + ', 생존 ' + st.alive + ', 내 번호 ' + st.me);

    // 소리를 깨우고 시작한다. 브라우저는 아무 키나 누르기 전엔 소리를 안 낸다
    await keyDown('m', 'KeyM'); await keyUp('m', 'KeyM');
    await keyDown('m', 'KeyM'); await keyUp('m', 'KeyM');

    await shot('01-시작');

    // 오른쪽으로 걸어본다
    await keyDown('d', 'KeyD');
    await sleep(700);
    await shot('02-걷는중');

    // ── 대쉬가 실제로 나가나 ────────────────────────────────
    //
    // **판이 막 시작했을 때 한다.** 처음엔 마지막에 뒀다가 헛수고를 했다 —
    // 그때는 이미 죽어 있어서 눌러도 아무 일이 안 나는 게 맞는데,
    // 계측이 '안 나갔다' 고만 알려줘서 멀쩡한 코드를 뒤졌다.
    // **재는 자리가 틀리면 숫자가 거짓말을 한다**
    //
    // 서버 시험은 StartDash 를 직접 불러서 잰다. 그런데 사람이 겪는 길은
    // **연타 -> 패킷 -> 서버 -> 스냅샷 -> 화면**이라 중간에 한 군데만 끊겨도
    // '눌러도 아무 일이 없다' 가 된다. 그 길을 통째로 한 번 밟아본다.
    //
    // 대쉬를 안 먹었을 수도 있다. 그러면 안 나가는 게 맞고, 그것도 결과다 —
    // 여기서 재는 건 '나갔나' 가 아니라 **눌렀을 때 뭐가 일어났나** 다
    {
      // **누르고 있던 키를 먼저 뗀다.**
      //
      // 위에서 오른쪽으로 걸으려고 d 를 누른 채로 뒀다. 그 상태로 또 누르면
      // 게임은 '이미 누르고 있다' 로 보고 무시한다 — 그게 맞다. 브라우저가
      // 누른 키의 keydown 을 자동 반복으로 계속 보내기 때문에, 그걸 세면
      // 걷기만 해도 대쉬가 나간다.
      //
      // 시험이 사람 손을 흉내 내려면 뗐다가 두 번 두드려야 한다
      await keyUp('d', 'KeyD');
      await sleep(300);

      const before = await peek();
      console.log('  대쉬 상태: ' +
        (before.dash === -1 ? '아직 안 먹음'
         : before.dash === 0 ? '먹었고 준비됨'
         : '먹었고 쿨타임 ' + before.dash));

        // **아래로** 두 번. 사이를 120ms 로 둔다 (인정 시간이 260ms).
      //
      // 오른쪽으로 걸어온 참이라 오른쪽은 벽에 붙어 있을 수 있다.
      // 그러면 대쉬가 나가고도 한 점도 안 움직이는데, 그건 맞는 동작이지만
      // '나갔나' 를 재는 데는 못 쓴다. 아직 안 가본 쪽으로 잰다
      await key('s', 60);
      await sleep(120);
      await key('s', 60);
      await sleep(400);

      const after = await peek();
      const moved = Math.abs((after.mx | 0) - (before.mx | 0))
                  + Math.abs((after.my | 0) - (before.my | 0));
      console.log('  살아 있나 ' + before.alive + ',  두 번 두드린 뒤 '
                  + moved + ' units 갔다 (걸어서 0.5초면 20 안팎, 대쉬는 768),'
                  + '  쿨타임 ' + before.dash + ' -> ' + after.dash);
      await shot('d1-대쉬-직후');

      // 쿨타임이 돌았나가 갈림길이다.
      //   돌았다   -> 패킷은 갔다. 안 움직인 건 벽에 막혔거나 재는 법이 틀렸다
      //   안 돌았다 -> 서버까지 못 갔다. 연타 판정이나 보내는 쪽을 봐야 한다
      if (before.alive === 1 && before.dash === 0) {
        if (after.dash > 0) {
          console.log('  대쉬는 나갔다 (쿨타임이 돌았다). 움직임이 작으면 벽이다');
        }
        else {
          console.log('  [경고] 서버까지 안 갔다. 연타 판정이나 보내는 쪽 문제다');
        }
      }
    }

    await keyUp('d', 'KeyD');

    // 물풍선을 놓고 도망친다. 터지는 걸 봐야 한다
    await keyDown(' ', 'Space'); await sleep(60); await keyUp(' ', 'Space');
    await sleep(120);
    await shot('03-물풍선-놓음');

    await keyDown('a', 'KeyA'); await sleep(900); await keyUp('a', 'KeyA');
    await sleep(1500);
    await shot('04-터지는-순간');
    await sleep(400);
    await shot('05-터진-직후');

    // 조금 돌아다니다가 아래로. 구역을 넘으면 카메라가 바뀐다
    await keyDown('s', 'KeyS'); await sleep(2500); await keyUp('s', 'KeyS');
    await shot('06-아래로-이동');

    // ── 확대해서 그림을 본다 ──────────────────────────────────
    const w0 = await where();
    console.log('  캔버스 ' + Math.round(w0.cw) + 'x' + Math.round(w0.ch)
                + ', 타일 ' + w0.ts + 'px');

    // HUD 왼쪽 위와 가운데. 글자가 겹치는지는 키워야 보인다
    await zoom('z1-HUD왼쪽', w0.cx, w0.cy, 520, 100, 3);
    await zoom('z2-HUD가운데', w0.cx + w0.cw / 2 - 200, w0.cy, 400, 100, 3);

    // 판 한가운데. 캐릭터와 상자와 바닥이 같이 들어온다
    await zoom('z3-판가운데', w0.cx + w0.cw / 2 - 130, w0.cy + w0.ch / 2 - 100, 260, 200, 4);

    // 아이템 패널
    await zoom('z4-아이템패널', w0.cx + w0.cw / 2 - 130, w0.cy + w0.ch - 90, 260, 90, 4);

    st = await peek();
    console.log('  ' + JSON.stringify(st));

    // 침수까지 기다린다 (fast 면 첫 예고가 6초, 첫 침수가 9초쯤)
    await sleep(12000);
    await shot('07-침수');
    st = await peek();
    console.log('  ' + JSON.stringify(st));

    await sleep(15000);
    await shot('08-후반');
    st = await peek();
    console.log('  ' + JSON.stringify(st));

    // ── 한 판의 흐름을 따라간다 ─────────────────────────────
    //
    // 연출 하나하나가 좋아도 **판 전체가 지루하면 안 한다.**
    // 사람이 실제로 겪는 순서대로 찍어둔다 —
    // 접속 · 시작 · 중반 · 압박 · 끝 · 그다음.
    // 특히 '그다음' 이 중요하다. 한 판 더 하게 만드는 자리가 거기다
    {
      const beats = [
        ['b1-중반',   6000],
        ['b2-압박',  10000],
        ['b3-후반',  12000],
        ['b4-끝',    12000],
        ['b5-그다음', 8000],
      ];
      for (const [name, wait] of beats) {
        await sleep(wait);
        await shot(name);
        const st = await peek();
        console.log('    ' + name + '  ' + JSON.stringify(st));
      }
    }

    // ── 키를 누르고 화면이 움직이기까지 ─────────────────────
    //
    // 이 게임에서 제일 중요한 숫자인데 한 번도 안 재봤다.
    // 같은 컴퓨터에서만 돌려봤으니 늘 빨랐고, 그래서 잰 적이 없다.
    //
    // 재는 법은 단순하다. 내 캐릭터 자리를 계속 읽다가, 키를 누른 순간부터
    // 자리가 실제로 바뀔 때까지 걸린 시간을 센다.
    // 다리에 지연을 걸고(node web/bridge.js delay 80) 다시 재면 차이가 나온다
    // **화면이 실제로 그리는 자리**를 읽는다.
    //
    // 처음엔 서버가 준 자리(p.x1)를 읽었다. 그러면 예측을 붙이든 말든 늘 같은 수가
    // 나온다. 서버 자리는 어차피 왕복 시간만큼 늦게 오기 때문이다.
    // 재려던 것은 '키를 누르고 **화면이** 움직이기까지' 였다
    const MYPOS = '(function(){ try {'
      + ' if (Predict.isLive()) { var v = Predict.view();'
      + '   return Math.round(v.x) + "," + Math.round(v.y); }'
      + ' var p = G.players.get(G.myId);'
      + ' return p ? (p.x1 + "," + p.y1) : "?"; } catch(e){ return "?"; } })()';

    async function myPos() {
        const r = await cdp('Runtime.evaluate', { expression: MYPOS, returnByValue: true });
        return r.result.value;
    }

    async function measureInputLag(key, code) {
        // 멈춰 있는 상태에서 시작한다
        await sleep(500);
        const before = await myPos();
        if (before === '?') return -1;

        const t0 = Date.now();
        await keyDown(key, code);

        let moved = -1;
        for (let i = 0; i < 200; ++i) {
            if (await myPos() !== before) { moved = Date.now() - t0; break; }
            await sleep(5);
        }
        await keyUp(key, code);
        return moved;
    }

    console.log('');
    console.log('  --- 키를 누르고 화면이 움직이기까지 ---');
    const lags = [];
    for (const [k, c] of [['d','KeyD'], ['a','KeyA'], ['s','KeyS'], ['d','KeyD'], ['w','KeyW']]) {
        const ms = await measureInputLag(k, c);
        if (ms >= 0) lags.push(ms);
    }
    if (lags.length) {
        lags.sort((x, y) => x - y);
        console.log('    ' + lags.join(' · ') + ' ms   가운데값 '
                    + lags[lags.length >> 1] + 'ms');
    } else {
        console.log('    못 쟀다 (죽었거나 자리가 안 왔다)');
    }

    // ── 예측이 서버와 같은 답을 내나 ────────────────────────
    //
    // 미리 움직이는 것보다 이게 더 중요하다. 예측이 서버와 다르면
    // **화면에서 지나간 자리로 되돌아가는 일이 계속 생긴다.** 그게 제일 나쁘다.
    //
    // 서버 답이 올 때마다 어긋난 거리를 재서 쌓아둔다.
    // 타일 하나가 256 이므로 20 이면 한 칸의 8% 다
    // **녹이기 전의** 어긋난 거리를 본다. 화면에 보이는 오차를 재면
    // 늘 0 에 가깝게 나온다. 녹이는 장치가 지워버리기 때문이다.
    // 그건 '부드럽게 감췄다' 를 재는 것이지 '같은 답을 냈다' 를 재는 게 아니다
    const ERRSAMP = '(function(){ try { return JSON.stringify(Predict.stats()); }'
      + ' catch(e) { return "{}"; } })()';

    console.log('');
    console.log('  --- 예측이 서버와 얼마나 어긋나나 ---');

    await cdp('Runtime.evaluate', { expression: 'Predict.resetStats()' });

    // 벽에 부딪히고 모서리를 돌게 한다. 트인 데서만 재면 안 어긋나는 게 당연하다
    for (const [k, c] of [['d','KeyD'], ['s','KeyS'], ['a','KeyA'], ['w','KeyW'],
                          ['d','KeyD'], ['s','KeyS']]) {
        await keyDown(k, c);
        await sleep(700);
        await keyUp(k, c);
    }

    const r = await cdp('Runtime.evaluate', { expression: ERRSAMP, returnByValue: true });
    let st2 = {};
    try { st2 = JSON.parse(r.result.value || '{}'); } catch (e) {}

    if (st2.n) {
        console.log('    맞춰본 횟수 ' + st2.n + ' 번,  평균 ' + st2.avg
                    + ' units,  최대 ' + st2.max + ' units  (타일 하나 = ' + st2.tile + ')');
        console.log('    최대가 한 칸의 ' + Math.round(st2.max / st2.tile * 100) + '% 다,'
                    + '  예측이 아예 틀려서 순간이동한 횟수 ' + st2.snapped);
    } else {
        console.log('    못 쟀다');
    }
    ws.close();
    browser.kill();
    console.log('\n' + OUT + ' 에 저장했다.');
    process.exit(0);
})();
