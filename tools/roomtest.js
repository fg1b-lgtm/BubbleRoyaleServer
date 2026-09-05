// tools/roomtest.js — 방 생성·코드 입장·봇 없음 대기 흐름
// 실행: Server.exe + bridge.js 를 켠 뒤 node tools/roomtest.js

const BASE = 'http://127.0.0.1:8080';
const PKT_WELCOME = 5;
const PKT_SNAPSHOT = 7;
const ROUND_WAITING = 0;

let pass = 0, fail = 0;
function check(ok, text) {
  if (ok) { ++pass; console.log('  [PASS] ' + text); }
  else    { ++fail; console.log('  [FAIL] ' + text); }
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function watch(code) {
  const state = { welcome: -1, seed: -1, phases: new Set(), maxPlayers: 0, maxAlive: 0, closed: false };
  const ws = new WebSocket('ws://127.0.0.1:8080/ws?room=' + code);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (event) => {
    const view = new DataView(event.data);
    const id = view.getUint16(2, true);
    if (id === PKT_WELCOME) {
      state.welcome = view.getUint8(4);
      state.seed = view.getUint32(23, true);
    }
    if (id === PKT_SNAPSHOT) {
      state.phases.add(view.getUint8(4 + 13));
      state.maxAlive = Math.max(state.maxAlive, view.getUint8(4 + 22));
      state.maxPlayers = Math.max(state.maxPlayers, view.getUint8(4 + 26));
    }
  };
  ws.onclose = () => { state.closed = true; };
  return { ws, state };
}

async function main() {
  console.log('\n=== 방 만들기와 코드 입장 ===\n');
  const response = await fetch(BASE + '/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capacity: 2, bots: 0 }),
  });
  const room = await response.json();
  check(response.status === 201, '봇 없는 방을 만든다');
  check(/^[A-Z2-9]{6}$/.test(room.code || ''), '읽기 쉬운 6자리 방 코드가 나온다');

  const foundResponse = await fetch(BASE + '/api/rooms/' + room.code);
  const found = await foundResponse.json();
  check(foundResponse.ok && found.code === room.code, '같은 코드로 방을 찾는다');
  check(found.capacity === 2, '선택한 방 인원이 실제 방 설정에 남는다');
  check(found.bots === 0, '선택한 봇 수가 바뀌지 않는다');

  const first = watch(room.code);
  await wait(700);
  check(first.state.welcome >= 0, '방을 만든 사람이 게임 서버에 붙는다');
  check(first.state.phases.has(ROUND_WAITING), '봇 없음이면 혼자서 시작하지 않고 기다린다');
  check(first.state.maxPlayers === 1, '기다리는 동안 사람 한 명만 있다');

  const second = watch(room.code);
  await wait(900);
  check(second.state.welcome >= 0, '친구도 같은 코드로 들어온다');
  check(first.state.welcome !== second.state.welcome && first.state.seed === second.state.seed,
        '두 사람이 같은 판에 서로 다른 자리로 앉는다');
  check(Array.from(first.state.phases).some((phase) => phase !== ROUND_WAITING),
        '두 번째 사람이 오면 카운트다운을 시작한다');

  const third = watch(room.code);
  await wait(500);
  check(third.state.welcome === 0xFF, '정원을 넘긴 세 번째 사람은 참가하지 않고 관전한다');

  first.ws.close();
  second.ws.close();
  third.ws.close();

  const botResponse = await fetch(BASE + '/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capacity: 4, bots: 2 }),
  });
  const botRoom = await botResponse.json();
  check(botResponse.status === 201 && botRoom.bots === 2, '봇 추가를 켜면 선택한 두 명을 저장한다');
  const botHost = watch(botRoom.code);
  await wait(900);
  check(botHost.state.maxAlive === 3, '사람 한 명과 봇 두 명으로 시작한다 (관측 '
        + botHost.state.maxAlive + '명)');
  botHost.ws.close();

  console.log('\n===== 결과: ' + pass + ' PASS / ' + fail + ' FAIL =====');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('  [FAIL] ' + error.message);
  process.exit(1);
});
