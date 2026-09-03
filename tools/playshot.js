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
  + ' var V = Art.V;'
  + ' var mx = me ? me.x1 : 0, my = me ? me.y1 : 0;'
  + ' return JSON.stringify({ phase:G.phase, alive:G.aliveCount, round:G.roundNo,'
  + '   me:G.myId, walls:w, blocks:b, boxes:x2, drawn:np, mx:mx, my:my,'
  + '   TS:V.TS, WH:V.WH, CH:V.CH, P:V.P,'
  + '   alive:(me ? ((me.flags & 1) ? 1 : 0) : -1),'
  + '   bubbles:(G.bubbles||[]).length });'
  + ' } catch(e) { return JSON.stringify({err:String(e)}); } })()';

const seenErr = new Set();

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
            // 같은 예외가 프레임마다 나면 로그가 수천 줄이 된다. 한 번만 찍고
            // 그다음부터는 센다. 대신 어디서 났는지 알아야 하니 줄 번호까지 남긴다
            const one = String(msg).split(String.fromCharCode(10))[0];
            if (!seenErr.has(one)) {
                seenErr.add(one);
                const f = (d.stackTrace && d.stackTrace.callFrames || [])[0] || {};
                console.log('  [페이지 예외] ' + one
                            + '   @ ' + (f.url || '?').split('/').pop()
                            + ':' + ((f.lineNumber | 0) + 1));
            }
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

    // ── 한 쪽으로 쭉 걸어본다 ───────────────────────────────
    //
    // 세 가지를 한 번에 잰다. 셋 다 "키를 누르고 있는 동안 화면이 어떻게
    // 그려지나" 라서, 따로 재면 같은 일을 두 번 하고 시간도 두 배로 든다.
    //
    //   ① 걸음이 고른가   서버는 30Hz, 화면은 60fps 다. 틱마다만 옮기면
    //                     한 프레임 뛰고 한 프레임 서서 덜덜 떤다
    //   ② 보는 쪽이 안 흔들리나  한 쪽만 누르는데 캐릭터가 뒤돌아본다는 신고
    //   ③ 옆으로 안 밀리나      눌린 축 말고 다른 축으로 움직이면 조작이 안 먹는 것이다
    //
    // **화면이 실제로 그린 값**을 읽는다. 예측기 안쪽 값을 읽으면 그림이
    // 어떻든 늘 같은 수가 나온다 - 그걸로 두 번 속았다
    {
      const PROBE = [
        'new Promise(function(done){',
        '  var f = [], xs = [], ys = [], n = 0;',
        '  function step(){',
        '    f.push(typeof drawnFace !== "undefined" ? drawnFace : -1);',
        '    xs.push(typeof drawnX !== "undefined" ? drawnX : 0);',
        '    ys.push(typeof drawnY !== "undefined" ? drawnY : 0);',
        '    if (++n < 100) requestAnimationFrame(step);',
        '    else done(JSON.stringify({f:f, x:xs, y:ys}));',
        '  }',
        '  requestAnimationFrame(step);',
        '})',
      ].join('');

      // 걷다가 벽에 붙으면 거기부터 안 움직이는 게 맞다. 그 구간을 같이 세면
      // 화면이 버벅이는 것으로 잡힌다 - 실제로 84/99 라는 숫자가 그렇게 나왔다.
      // 쭉 걸은 구간만 잘라서 본다
      const longest = (d) => {
        let run = [], cur = [], gap = 0;
        for (const v of d) {
          if (v > 0.01) { gap = 0; cur.push(v); }
          else if (++gap >= 3) { if (cur.length > run.length) run = cur; cur = []; }
          else cur.push(v);
        }
        return cur.length > run.length ? cur : run;
      };

      let best = null;
      for (const [k, c, axis] of [['d','KeyD',0], ['s','KeyS',1],
                                  ['a','KeyA',0], ['w','KeyW',1]]) {
        await keyDown(k, c);
        await sleep(250);
        const r = await cdp('Runtime.evaluate', {
          expression: PROBE, awaitPromise: true, returnByValue: true,
        });
        await keyUp(k, c);

        let v = null;
        try { v = JSON.parse(r.result.value || 'null'); } catch (e) { /* 없다 */ }
        if (!v) continue;

        const main = axis === 0 ? v.x : v.y;
        const side = axis === 0 ? v.y : v.x;

        const step = [], drift = [];
        for (let i = 1; i < main.length; ++i) {
          step.push(Math.abs(main[i] - main[i - 1]));
          drift.push(Math.abs(side[i] - side[i - 1]));
        }
        const run = longest(step);
        if (!best || run.length > best.run.length) {
          best = { k, run, face: v.f, drift };
        }
        if (best.run.length > 60) break;        // 넉넉히 걸었다. 더 안 봐도 된다
      }

      if (best && best.run.length > 8) {
        const move = best.run.filter((v) => v > 0.01);
        const avg = move.reduce((a, b) => a + b, 0) / move.length;
        const dev = Math.sqrt(move.reduce((a, b) => a + (b - avg) * (b - avg), 0)
                              / move.length);
        let flips = 0;
        for (let i = 1; i < best.face.length; ++i)
          if (best.face[i] !== best.face[i - 1]) ++flips;
        const drift = best.drift.reduce((a, b) => a + b, 0);

        console.log('  한 쪽으로 쭉(' + best.k + '): 걸은 ' + best.run.length
                    + '프레임 중 안 움직인 프레임 ' + (best.run.length - move.length)
                    + ',  한 프레임에 ' + avg.toFixed(2) + 'px'
                    + ',  들쭉날쭉 ' + dev.toFixed(2));
        console.log('    보는 쪽이 바뀐 횟수 ' + flips + ' (0 이어야 한다),'
                    + '  옆으로 밀린 거리 ' + drift.toFixed(1) + 'px');
      } else {
        console.log('  한 쪽으로 쭉: 사방이 막혔거나 죽었다');
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
    // 막힌 방향은 버린다.
    //
    // 벽에 붙어 있으면 눌러도 자리가 안 바뀌고, 그게 수백 ms 로 잡힌다.
    // 실제로 392ms 와 2531ms 가 섞여 나와서 가운데값이 거짓말을 했다.
    // 같은 컴퓨터에서 입력 지연이 200ms 일 수는 없으니, 넘으면 막힌 것이다
    const BLOCKED_MS = 200;
    const lags = [], blocked = [];
    for (const [k, c] of [['d','KeyD'], ['a','KeyA'], ['s','KeyS'], ['d','KeyD'], ['w','KeyW']]) {
        const ms = await measureInputLag(k, c);
        if (ms < 0) continue;
        (ms <= BLOCKED_MS ? lags : blocked).push(k);
        if (ms <= BLOCKED_MS) lags[lags.length - 1] = ms;
    }
    if (lags.length) {
        lags.sort((x, y) => x - y);
        console.log('    ' + lags.join(' · ') + ' ms   가운데값 '
                    + lags[lags.length >> 1] + 'ms'
                    + (blocked.length ? '   (막혀서 버린 방향 ' + blocked.join(',') + ')' : ''));
    } else {
        console.log('    못 쟀다 (죽었거나 사방이 막혔다)');
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
