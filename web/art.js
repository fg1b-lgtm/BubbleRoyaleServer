// web/art.js — 이 게임이 어떻게 생겼는가
//
// 그림 파일을 하나도 안 쓴다. 전부 캔버스에 그린다.
//
// ── 아트 디렉션. 이 다섯 줄이 나머지를 전부 정한다 ──────────
//
// ① 빛은 한 군데서만 온다. 왼쪽 위, 조금 앞.
//    모든 밝은 면이 왼쪽 위를 보고, 모든 그림자가 오른쪽 아래로 진다.
//    이거 하나만 지켜도 따로 그린 것들이 한 판 안에 있는 것처럼 보인다.
//
// ② 평평한 것을 두지 않는다. 벽에 **높이**가 있다.
//    윗면과 앞면이 따로 있고, 바닥에 그림자를 드리우고, 뒤에 선 사람을 가린다.
//    타일에 색만 칠하면 그건 지도지 판이 아니다.
//
// ③ 명도 순서를 못 박는다. 어두운 순으로
//      벽 앞면 < 바닥 < 벽 윗면 < 상자 < 캐릭터
//    캐릭터가 언제나 제일 밝고 제일 진하다. 스물넷이 엉켜도 사람이 먼저 보인다.
//
// ④ 등속으로 움직이는 것을 두지 않는다. 전부 가감속.
//    튀어나올 때는 살짝 지나쳤다가 돌아온다.
//
// ⑤ 판 위에 글자를 쓰지 않는다. 글자는 읽어야 알지만 그림은 안 읽어도 안다.
//
// ── 그리는 순서 ────────────────────────────────────────────
//
//   1) 바닥      미리 그려둔 한 장. 벽 그림자까지 구워져 있다
//   2) 물        구역 침수, 차오르는 물, 물결과 포말
//   3) 줄 정렬   위에서 아래로 한 줄씩. [그 줄의 벽·상자] 다음 [그 줄에 발이 닿은 사람]
//                아래 줄 벽이 위 줄 사람을 가린다. 그게 앞에 있다는 뜻이다
//   4) 이펙트    물줄기, 조각, 파티클. 밝은 것은 가산 합성
//   5) 마감      비네트와 색보정
//   6) HUD       판 밖
const Art = (() => {

  // ── 색 다루기 ────────────────────────────────────────────────
  //
  // 팔레트를 손으로 스물네 개 적지 않는다. 기준색 하나에서 밝기만 옮긴다.
  // 그래야 색이 열두 개여도 명암 관계가 전부 똑같이 유지된다
  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function css(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + (a === undefined ? 1 : a) + ')';
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const lighter = (c, t) => mix(c, WHITE, t);
  const darker  = (c, t) => mix(c, BLACK, t);

  // ── 가감속 ───────────────────────────────────────────────────
  const easeOut  = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn   = (t) => t * t * t;
  // 살짝 지나쳤다가 돌아온다. 튀어나오는 것에는 전부 이걸 쓴다
  const overshoot = (t) => { const s = 1.70158; const u = t - 1; return u * u * ((s + 1) * u + s) + 1; };

  // ── 장소 열 곳 ───────────────────────────────────────────────
  //
  // 크아 맵이 기억에 남는 건 빌리지, 캠프, 해변처럼 **거기가 어디인지 알아서**다.
  // 우리 판은 조각 아홉 개를 붙인 것이니, 조각마다 다른 장소로 그리면
  // 한 판 안에서 아홉 군데를 지나가게 된다.
  //
  // 서버가 어떤 조각을 어디에 깔았는지 WELCOME 으로 알려준다 (sector_kind).
  // 번호는 SectorTemplates.h 의 순서와 같다.
  //
  // 색은 셋으로 끝난다. 바닥 / 벽 윗면 / 벽 앞면.
  // 상자는 그 장소에 있을 법한 것으로 (나무 궤짝, 얼음덩이, 화물, 항아리).
  const PLACES = [
    { name: '광장',   // 0 CROSSROADS — 돌바닥과 붉은 기와
      floor: '#c9bda8', floorAlt: '#c0b39e', joint: '#a2957f', fleck: '#b3a58e',
      wallTop: '#c96f5a', wallSide: '#7d3a2e', wallEdge: '#4f231b',
      crate: '#c08b52', crateTop: '#dda76a', crateSide: '#7e5628',
      crateKind: 'stone', wallKind: 'brick',
      step: 'stone' },

    { name: '사원',   // 1 CLOISTER — 흰 대리석과 금빛
      floor: '#e0dcd2', floorAlt: '#d7d2c7', joint: '#b8b2a4', fleck: '#c8c2b4',
      wallTop: '#f2eee4', wallSide: '#9a9280', wallEdge: '#6b6455',
      crate: '#cbab5e', crateTop: '#e6c87c', crateSide: '#846a2f',
      crateKind: 'stone', wallKind: 'column',
      step: 'marble' },

    { name: '공장',   // 2 COMB — 강철과 주황 화물
      floor: '#9fa5ac', floorAlt: '#959ba2', joint: '#767c84', fleck: '#868c94',
      wallTop: '#8b939d', wallSide: '#3f464f', wallEdge: '#252a31',
      crate: '#cf7a35', crateTop: '#ea9450', crateSide: '#82471a',
      crateKind: 'barrel', wallKind: 'metal',
      step: 'metal' },

    { name: '마을',   // 3 LATTICE — 잔디와 나무집
      floor: '#8fc267', floorAlt: '#84b85d', joint: '#6a9c48', fleck: '#79ad52',
      wallTop: '#d9c9a4', wallSide: '#8a6a45', wallEdge: '#57402a',
      crate: '#b5793f', crateTop: '#d09252', crateSide: '#734a26',
      crateKind: 'crate', wallKind: 'wood',
      step: 'grass' },

    { name: '캠프',   // 4 FOUR_ROOMS — 흙바닥과 천막
      floor: '#b8a184', floorAlt: '#ae977b', joint: '#907a5f', fleck: '#a08a6e',
      wallTop: '#e8ddc4', wallSide: '#8e7f63', wallEdge: '#5b5040',
      crate: '#9c7b52', crateTop: '#b8946a', crateSide: '#634d31',
      crateKind: 'crate', wallKind: 'wood',
      step: 'sand' },

    { name: '사막',   // 5 DIAGONAL — 모래와 사암
      floor: '#e3cf9c', floorAlt: '#dac591', joint: '#bda772', fleck: '#cdb782',
      wallTop: '#e0b878', wallSide: '#a1743c', wallEdge: '#6b4a22',
      crate: '#c9a05e', crateTop: '#e2bb78', crateSide: '#82632f',
      crateKind: 'sack', wallKind: 'rock',
      step: 'sand' },

    // 9/2 에 색을 다시 잡았다. 광장과 색거리가 8.4 밖에 안 나왔다 —
    // 둘 다 따뜻한 베이지 바닥에 붉은 지붕이라 나란히 놓아야 겨우 구분됐다.
    // 열 곳을 그려놓고 실질 아홉 곳이었던 셈이다.
    // 바닥을 식은 회색 벽돌로 내리고 차양을 사프란으로 올려서 떼어놨다.
    // 상자의 청록은 그대로 둔다. 그게 이 장소의 표식이다
    { name: '시장',   // 6 ALLEYS — 벽돌 골목과 천 차양
      floor: '#9a918a', floorAlt: '#918880', joint: '#756d67', fleck: '#847b75',
      wallTop: '#d8a340', wallSide: '#8f6320', wallEdge: '#583c12',
      crate: '#5c9c93', crateTop: '#7dbcb2', crateSide: '#356862',
      crateKind: 'sack', wallKind: 'brick',
      step: 'stone' },

    { name: '해변',   // 7 WELL — 흰 모래와 산호
      floor: '#efdfbc', floorAlt: '#e7d6b0', joint: '#c9b78f', fleck: '#d8c69f',
      wallTop: '#8fd4e0', wallSide: '#3d7f96', wallEdge: '#245667',
      crate: '#e08b7a', crateTop: '#f2a795', crateSide: '#94503f',
      crateKind: 'barrel', wallKind: 'rock',
      step: 'sand' },

    { name: '얼음골', // 8 ZIGZAG — 눈과 얼음
      floor: '#dfeaf3', floorAlt: '#d4e2ee', joint: '#adc4d8', fleck: '#c0d4e4',
      wallTop: '#b8e5fa', wallSide: '#5589a8', wallEdge: '#33607a',
      crate: '#9fd2ea', crateTop: '#c8ecfc', crateSide: '#5c93b2',
      crateKind: 'ice', wallKind: 'rock',
      step: 'ice' },

    { name: '부두',   // 9 DOCKS — 나무 판자와 화물
      floor: '#b08e63', floorAlt: '#a6845a', joint: '#8a6a45', fleck: '#997a52',
      wallTop: '#8d9aa4', wallSide: '#414c56', wallEdge: '#262e36',
      crate: '#7f8f5e', crateTop: '#9aab76', crateSide: '#4e5a36',
      crateKind: 'crate', wallKind: 'metal',
      step: 'wood' },
  ];

  // ── 판 전체의 공기 ───────────────────────────────────────────
  //
  // 장소는 구역마다 다르지만 **물과 하늘과 색보정은 판 하나에 하나**다.
  // 그래야 아홉 군데가 서로 다른 데면서도 같은 판 안에 있는 것으로 보인다.
  // 이건 씨앗으로 고른다
  const WORLDS = [
    { name: '한낮', sky: '#0d1622', water: '#1c74b8', foam: '#cdeeff',
      grade: '#ffd9a0', gradeAmt: 0.05 },
    { name: '저녁', sky: '#1a1220', water: '#2a5fa8', foam: '#e3d8ff',
      grade: '#ff9e6b', gradeAmt: 0.10 },
    { name: '흐림', sky: '#101418', water: '#2b6f9c', foam: '#dfeef7',
      grade: '#9fc7e8', gradeAmt: 0.07 },
    { name: '새벽', sky: '#0b1020', water: '#1d5ba8', foam: '#d6ecff',
      grade: '#8fb4ff', gradeAmt: 0.09 },
  ];

  // ── 보는 눈 ──────────────────────────────────────────────────
  //
  // TS   타일 한 칸이 몇 픽셀인가
  // WH   벽이 얼마나 솟아 있는가. 이 값이 판의 입체감을 통째로 정한다
  // world 는 판 하나에 하나, place[] 는 아홉 자리마다 하나.
  // sectorW/H 는 어느 칸이 어느 자리에 속하는지 계산하는 데 쓴다
  const V = {
    TS: 24, P: 2, WH: 11, CH: 7, TOP: 14, BOT: 10,
    world: WORLDS[0],
    place: new Array(9).fill(PLACES[0]),
    sw: 15, sh: 13,
  };

  // 이 칸이 어느 장소인가
  function placeAt(x, y) {
    const s = Math.min(2, (y / V.sh) | 0) * 3 + Math.min(2, (x / V.sw) | 0);
    return V.place[s];
  }

  // 픽셀 한 칸이 화면에서 몇 픽셀인가.
  //
  // 9/2 까지 전부 그라데이션과 둥근 모서리로 그렸다. 매끈해서 '요즘 웹' 처럼 보이지
  // 크아처럼 보이지 않는다. 크아의 맛은 **한 점 한 점이 자리를 갖는 것**에서 온다.
  //
  // 진짜 픽셀 아트로 가려면 좌표가 격자에 딱 떨어져야 한다.
  // 타일 하나를 16 등분해서 그 격자에 전부 맞춘다. 반 픽셀이 없어지고 선이 또렷해진다.
  // 격자가 3px 아래로 내려가면 무늬가 뭉개지므로 최소 2 는 지킨다
  function q(v) { return Math.round(v / V.P) * V.P; }

  // 격자에 맞춘 네모. 앞으로 칠하는 것은 거의 다 이걸 지나간다
  function pr(g, x, y, w, h) {
    const x0 = q(x), y0 = q(y);
    g.fillRect(x0, y0, Math.max(V.P, q(x + w) - x0), Math.max(V.P, q(y + h) - y0));
  }

  // 모서리를 한 픽셀씩 깎은 네모. 둥근 모서리 대신 쓴다.
  // 곡선을 쓰면 아무리 작아도 안티에일리어싱이 붙어 흐려진다
  function pbox(g, x, y, w, h) {
    const P = V.P;
    const x0 = q(x), y0 = q(y);
    const w0 = Math.max(P * 3, q(x + w) - x0), h0 = Math.max(P * 3, q(y + h) - y0);
    g.fillRect(x0 + P, y0,     w0 - P * 2, h0);
    g.fillRect(x0,     y0 + P, w0,         h0 - P * 2);
  }

  function setScale(ts) {
    V.TS  = ts;
    V.P   = Math.max(2, Math.round(ts / 16));
    V.WH  = Math.round(ts * 0.46);   // 벽 높이
    V.CH  = Math.round(ts * 0.30);   // 상자 높이
    V.TOP = V.WH + 2;                // 줄 그림이 위로 삐져나오는 여유
    V.BOT = Math.round(ts * 0.45);   // 아래로 삐져나오는 여유 (그림자)
  }

  // 서버가 준 조각 번호 아홉 개로 장소를 정하고, 씨앗으로 공기를 정한다
  function setPlaces(kinds, seed, sectorW, sectorH) {
    V.sw = sectorW;
    V.sh = sectorH;
    for (let i = 0; i < 9; ++i) {
      V.place[i] = PLACES[(kinds[i] || 0) % PLACES.length];
    }
    V.world = WORLDS[seed % WORLDS.length];
  }

  // 지금 판에 어떤 장소들이 깔렸나. HUD 에 이름을 띄우는 데 쓴다
  function placeNames() {
    const seen = [];
    for (let i = 0; i < 9; ++i) {
      if (seen.indexOf(V.place[i].name) < 0) seen.push(V.place[i].name);
    }
    return seen;
  }

  // 칸마다 늘 같은 무늬가 나오게 하는 난수.
  // Math.random 을 쓰면 매 프레임 무늬가 바뀌어서 바닥이 지글거린다
  function hash2(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177 | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967296;
  }

  // 모서리가 둥근 네모. 브라우저마다 roundRect 가 있기도 없기도 해서 직접 그린다
  function rr(g, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);     g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);     g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);         g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  // ── 바닥 한 장 ───────────────────────────────────────────────
  //
  // 판이 깔릴 때 한 번만 그린다. 매 프레임 1755칸을 다시 그리면 그게 프레임 저하다.
  //
  // 벽이 바닥에 드리우는 그림자를 여기 같이 구워 넣는다.
  // 그림자가 있어야 벽이 바닥 위에 서 있는 것처럼 보인다. 이게 없으면 무늬다
  function buildFloor(g, tiles, W, H) {
    const T = V.TS;

    for (let y = 0; y < H; ++y) {
      for (let x = 0; x < W; ++x) {
        // 칸마다 자기 구역의 장소 색을 쓴다. 경계에서 색이 바뀌는 게 곧 "다른 데" 다
        const th = placeAt(x, y);
        const base = rgb(th.floor), alt = rgb(th.floorAlt);
        const joint = rgb(th.joint), fleck = rgb(th.fleck);
        const h = hash2(x, y);

        // 같은 색 두 개를 번갈아 깔되, 칸마다 아주 조금씩 밝기를 흔든다.
        // 완전히 같은 색이 이어지면 인쇄물처럼 보이고, 많이 흔들면 지저분해진다
        const c = mix(((x + y) & 1) ? base : alt, WHITE, (h - 0.5) * 0.05);
        g.fillStyle = css(c);
        g.fillRect(x * T, y * T, T, T);

        // 이음선도 격자 한 칸 두께로. 1px 로 그리면 배율에 따라 사라진다
        g.fillStyle = css(joint, 0.5);
        g.fillRect(x * T, y * T, T, V.P);
        g.fillRect(x * T, y * T, V.P, T);

        if (h > 0.80) {
          // 티끌 한 점. 격자에 맞춰서 찍는다
          g.fillStyle = css(fleck, 0.7);
          const s = (h > 0.95 ? 2 : 1) * V.P;
          pr(g, x * T + V.P * 2 + ((h * 97) | 0) % (T - V.P * 4),
                y * T + V.P * 2 + ((h * 131) | 0) % (T - V.P * 4), s, s);
        }
      }
    }

    // 벽 그림자. 빛이 왼쪽 위에서 오므로 오른쪽 아래로 진다
    for (let y = 0; y < H; ++y) {
      for (let x = 0; x < W; ++x) {
        if (tiles[y][x] !== 1) continue;

        // 그라데이션 대신 두 단. 픽셀 아트의 그림자는 번지지 않고 단으로 진다
        const px = x * T + T * 0.18, py = y * T + T * 0.30;
        g.fillStyle = 'rgba(0,0,0,0.26)';
        pr(g, px, py, T, T * 0.55);
        g.fillStyle = 'rgba(0,0,0,0.13)';
        pr(g, px, py + T * 0.55, T, T * 0.5);
      }
    }
  }

  // ── 한 줄의 벽과 상자 ────────────────────────────────────────
  //
  // 줄마다 따로 그려둔다. 사람을 그릴 때 줄 사이에 끼워 넣어야 하기 때문이다.
  // 통째로 한 장에 그려두면 사람이 늘 벽 앞이나 늘 벽 뒤에 있게 된다.
  //
  // g 는 이 줄만 담는 종이다. 위로 V.TOP, 아래로 V.BOT 만큼 여유가 있다
  // ── 장소마다 다른 무늬 ───────────────────────────────────────
  //
  // 9/2 까지 열 장소가 **색만 달랐다.** 모양이 전부 같으니 멀리서 보면
  // 같은 판에 페인트를 열 번 칠한 것으로 보인다.
  // 크아가 빌리지와 해변이 다른 데처럼 느껴지는 건 색이 아니라 물건이 달라서다.
  //
  // 실루엣까지 바꾸면 판정이 헷갈린다. **칸을 채우는 면적은 그대로 두고
  // 그 위의 무늬만 바꾼다.** 어디가 막혔는지는 여전히 한눈에 보여야 한다.
  //
  // 벽 다섯 : 벽돌 · 기둥 · 철판 · 널판 · 바위
  // 상자 다섯 : 궤짝 · 드럼통 · 자루 · 돌덩이 · 얼음

  // 벽 윗면에 무늬를 새긴다. wx,wy 는 윗면의 왼쪽 위 모서리
  function wallPattern(g, kind, wx, wy, T, x, y) {
    g.save();
    g.beginPath();
    g.rect(wx, wy, T, T);
    g.clip();

    if (kind === 'brick') {
      // 어긋쌓기. 줄마다 반 칸씩 밀린다
      const rows = 3, bh = T / rows;
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.lineWidth = 1;
      g.beginPath();
      for (let r = 1; r < rows; ++r) {
        g.moveTo(wx, wy + r * bh); g.lineTo(wx + T, wy + r * bh);
      }
      for (let r = 0; r < rows; ++r) {
        const off = (r % 2) ? 0 : T / 2;
        g.moveTo(wx + off, wy + r * bh); g.lineTo(wx + off, wy + (r + 1) * bh);
      }
      g.stroke();
    }
    else if (kind === 'column') {
      // 세로 홈. 대리석 기둥을 위에서 본 것
      g.strokeStyle = 'rgba(0,0,0,0.16)';
      g.lineWidth = Math.max(1, T * 0.05);
      g.beginPath();
      for (let i = 1; i < 4; ++i) {
        g.moveTo(wx + T * i / 4, wy); g.lineTo(wx + T * i / 4, wy + T);
      }
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.22)';
      g.beginPath();
      for (let i = 1; i < 4; ++i) {
        g.moveTo(wx + T * i / 4 - 1, wy); g.lineTo(wx + T * i / 4 - 1, wy + T);
      }
      g.stroke();
    }
    else if (kind === 'metal') {
      // 철판. 가장자리에 리벳 네 개와 가운데 이음선
      g.strokeStyle = 'rgba(0,0,0,0.20)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(wx, wy + T / 2); g.lineTo(wx + T, wy + T / 2);
      g.stroke();

      const r = Math.max(1, T * 0.045), m = T * 0.18;
      for (let i = 0; i < 4; ++i) {
        const rx = wx + (i & 1 ? T - m : m);
        const ry = wy + (i < 2 ? m : T - m);
        g.fillStyle = 'rgba(255,255,255,0.30)';
        g.beginPath(); g.arc(rx, ry - 0.5, r, 0, 7); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.beginPath(); g.arc(rx, ry + 0.5, r * 0.7, 0, 7); g.fill();
      }
    }
    else if (kind === 'wood') {
      // 널판 세 장. 나뭇결이 세로로 간다
      g.strokeStyle = 'rgba(0,0,0,0.24)';
      g.lineWidth = Math.max(1, T * 0.04);
      g.beginPath();
      g.moveTo(wx + T / 3, wy); g.lineTo(wx + T / 3, wy + T);
      g.moveTo(wx + T * 2 / 3, wy); g.lineTo(wx + T * 2 / 3, wy + T);
      g.stroke();

      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 3; ++i) {
        const bx = wx + T * (i + 0.5) / 3 + (hash2(x, y * 7 + i) % 5 - 2) * 0.6;
        g.moveTo(bx, wy + 2); g.lineTo(bx, wy + T - 2);
      }
      g.stroke();
    }
    else {
      // 바위. 칸마다 다른 금이 간다. 씨앗은 좌표라 다시 그려도 같은 모양이 나온다
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.lineWidth = Math.max(1, T * 0.035);
      g.beginPath();
      const h = (n) => (hash2(x * 3 + n, y * 5 + n) % 100) / 100;
      g.moveTo(wx + T * h(1), wy);
      g.lineTo(wx + T * (0.3 + h(2) * 0.4), wy + T * 0.5);
      g.lineTo(wx + T * h(3), wy + T);
      g.moveTo(wx + T * (0.3 + h(4) * 0.4), wy + T * 0.5);
      g.lineTo(wx + T, wy + T * (0.2 + h(5) * 0.6));
      g.stroke();
    }

    g.restore();
  }

  // 상자 무늬. bx,by 는 상자 윗면의 왼쪽 위. w 는 한 변
  function cratePattern(g, kind, bx, by, w, cc, cs, x, y) {
    g.save();
    g.beginPath();
    g.rect(bx, by, w, w);
    g.clip();

    const dark = css(darker(cc, 0.26), 0.6);

    if (kind === 'barrel') {
      // 드럼통. 가로 테 두 줄과 세로 이음선 하나
      g.strokeStyle = css(darker(cs, 0.2), 0.75);
      g.lineWidth = Math.max(1.5, w * 0.10);
      g.beginPath();
      g.moveTo(bx, by + w * 0.28); g.lineTo(bx + w, by + w * 0.28);
      g.moveTo(bx, by + w * 0.72); g.lineTo(bx + w, by + w * 0.72);
      g.stroke();

      g.strokeStyle = dark;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(bx + w * 0.5, by); g.lineTo(bx + w * 0.5, by + w);
      g.stroke();
    }
    else if (kind === 'sack') {
      // 자루. 목을 묶은 주름이 위에서 퍼진다
      g.strokeStyle = dark;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < 4; ++i) {
        g.moveTo(bx + w * 0.5, by + w * 0.16);
        g.lineTo(bx + w * (0.12 + i * 0.25), by + w * 0.95);
      }
      g.stroke();

      g.fillStyle = css(darker(cs, 0.15), 0.8);
      g.beginPath();
      g.ellipse(bx + w * 0.5, by + w * 0.13, w * 0.20, w * 0.09, 0, 0, 7);
      g.fill();
    }
    else if (kind === 'stone') {
      // 돌덩이. 다듬은 면과 금 하나.
      // 처음엔 선이 굵어서 금이 아니라 번개처럼 보였다. 확대해 보고 낮췄다
      g.strokeStyle = css(darker(cc, 0.26), 0.3);
      g.lineWidth = Math.max(1, w * 0.03);
      const h = (n) => (hash2(x * 7 + n, y * 11 + n) % 100) / 100;
      g.beginPath();
      g.moveTo(bx + w * (0.15 + h(1) * 0.2), by);
      g.lineTo(bx + w * (0.35 + h(2) * 0.3), by + w * 0.55);
      g.lineTo(bx + w * (0.2 + h(3) * 0.3), by + w);
      g.stroke();

      g.fillStyle = 'rgba(255,255,255,0.14)';
      g.beginPath();
      g.moveTo(bx, by); g.lineTo(bx + w * 0.55, by); g.lineTo(bx, by + w * 0.55);
      g.closePath(); g.fill();
    }
    else if (kind === 'ice') {
      // 얼음. 안이 비쳐서 밝은 조각이 어른거린다
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.beginPath();
      g.moveTo(bx + w * 0.15, by + w);
      g.lineTo(bx + w * 0.55, by + w * 0.10);
      g.lineTo(bx + w * 0.75, by + w * 0.10);
      g.lineTo(bx + w * 0.35, by + w);
      g.closePath(); g.fill();

      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(bx + w * 0.62, by + w * 0.12); g.lineTo(bx + w * 0.88, by + w * 0.42);
      g.stroke();
    }
    else {
      // 나무 궤짝. 널빤지 두 줄
      g.strokeStyle = dark;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(bx + 1, by + w * 0.36); g.lineTo(bx + w - 1, by + w * 0.36);
      g.moveTo(bx + 1, by + w * 0.68); g.lineTo(bx + w - 1, by + w * 0.68);
      g.stroke();
    }

    g.restore();

    // 어느 무늬든 왼쪽 위에 빛이 걸린다. 광원은 판 전체에 하나다
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(q(bx + V.P * 2), q(by + V.P), q(w * 0.34), V.P);
  }

  function buildRow(g, tiles, W, y) {
    const T = V.TS;

    const isWall = (x, yy) => (yy < 0 || yy >= tiles.length || x < 0 || x >= W)
                              ? true : tiles[yy][x] === 1;

    // 이 종이 안에서의 y 좌표. 줄의 윗변이 V.TOP 자리에 온다
    const Y = V.TOP;

    for (let x = 0; x < W; ++x) {
      const t = tiles[y][x];
      const px = x * T;
      // 4 = 밀 수 있는 상자. 이 줄에 4 가 빠져 있어서 **한 판에 200개쯤이 통째로
      // 안 그려지고 있었다.** 보이지도 않는데 길은 막는다.
      // 아래에 쇠테와 못을 그리는 코드가 멀쩡히 있는데 여기서 걸러지고 있었다
      if (t !== 1 && t !== 2 && t !== 4) continue;

      const th = placeAt(x, y);
      const top = rgb(th.wallTop), side = rgb(th.wallSide), edge = rgb(th.wallEdge);

      // 밀 수 있는 상자는 **색이 아니라 모양으로** 다르다.
      // 색만 바꾸면 장소 팔레트에 묻혀서 못 알아본다.
      // 쇠테를 두르고 네 귀퉁이에 못을 박아서, 무겁고 미는 것처럼 보이게 한다
      const box = (t === 4);
      // rgb() 를 두 번 걸고 있었다. 안쪽이 이미 [r,g,b] 배열인데 바깥에서 또 불러서
      // parseInt('106', 16) 로 읽혔고, **모든 상자의 윗면이 짙은 남색**이 됐다.
      // 상자가 나무 궤짝이 아니라 젤리처럼 보이던 게 이 한 줄이다.
      // 위가 어둡고 아래가 밝아서 빛이 아래에서 오는 것처럼도 보였다
      const ct = box ? lighter(rgb(th.crate), 0.10) : rgb(th.crateTop);
      const cs = rgb(th.crateSide), cc = rgb(th.crate);

      if (t === 1) {
        // 앞면. 아래로 V.WH 만큼 두께가 보인다
        g.fillStyle = css(side);
        g.fillRect(px, Y + T - V.WH, T, V.WH);

        // 앞면 아래쪽을 더 어둡게. 바닥과 만나는 데가 제일 어둡다.
        // 그라데이션이 아니라 두 단이다. 픽셀 아트는 색이 번지지 않는다
        g.fillStyle = 'rgba(0,0,0,0.18)';
        pr(g, px, Y + T - V.WH * 0.55, T, V.WH * 0.55);
        g.fillStyle = 'rgba(0,0,0,0.34)';
        pr(g, px, Y + T - V.WH * 0.25, T, V.WH * 0.25);

        // 윗면. V.WH 만큼 위로 올라가 있다. 이 어긋남이 곧 높이다
        g.fillStyle = css(top);
        g.fillRect(px, Y - V.WH, T, T);

        // 장소마다 다른 무늬. 벽돌인지 철판인지 바위인지가 여기서 갈린다
        wallPattern(g, th.wallKind, px, Y - V.WH, T, x, y);

        // 왼쪽 위 모서리에 빛. 오른쪽 아래에 그늘
        g.fillStyle = 'rgba(255,255,255,0.20)';
        g.fillRect(px, Y - V.WH, T, V.P);
        g.fillRect(px, Y - V.WH, V.P, T);
        g.fillStyle = 'rgba(0,0,0,0.14)';
        g.fillRect(px, Y - V.WH + T - V.P, T, V.P);
        g.fillRect(px + T - V.P, Y - V.WH, V.P, T);

        // 벽끼리 붙은 쪽에는 테두리를 안 긋는다. 그래야 벽이 덩어리로 보인다.
        // 칸마다 테두리를 그으면 바둑판이 된다
        g.fillStyle = css(edge);
        if (!isWall(x, y - 1)) g.fillRect(px, Y - V.WH, T, 1);
        if (!isWall(x - 1, y)) g.fillRect(px, Y - V.WH, 1, T + V.WH);
        if (!isWall(x + 1, y)) g.fillRect(px + T - 1, Y - V.WH, 1, T + V.WH);
        if (!isWall(x, y + 1)) g.fillRect(px, Y + T - 1, T, 1);
      }
      else if (t === 2 || t === 4) {
        // 상자. 벽보다 낮고 모서리가 둥글다.
        // 부술 수 있는 것과 없는 것이 **모양으로** 갈려야 한다. 색만으로는 부족하다
        const m = Math.max(1, T * 0.09);
        const w = T - m * 2;

        // 그림자. 타원 대신 모서리 깎은 납작한 네모다
        g.fillStyle = 'rgba(0,0,0,0.24)';
        pbox(g, px + m + V.P, Y + T - V.CH * 0.5, w, V.P * 2);

        // 옆면
        g.fillStyle = css(cs);
        pbox(g, px + m, Y + m - V.CH + w * 0.5, w, w * 0.5 + V.CH);

        // 윗면. 그라데이션이 아니라 세 단으로 나눈다.
        // 위 3분의 1이 밝고, 가운데가 바탕, 아래가 그늘이다
        const bx0 = px + m, by0 = Y + m - V.CH;
        g.fillStyle = css(ct);
        pbox(g, bx0, by0, w, w);
        g.fillStyle = css(cc);
        pr(g, bx0, by0 + w * 0.38, w, w * 0.62 - V.P);
        g.fillStyle = css(mix(cc, rgb('#000000'), 0.12));
        pr(g, bx0 + V.P, by0 + w - V.P * 2, w - V.P * 2, V.P * 2);

        // 1픽셀 테두리. 픽셀 아트에서 물건을 물건으로 만드는 건 이 선이다
        g.fillStyle = css(darker(cs, 0.42), 0.95);
        g.fillRect(q(bx0 + V.P), q(by0), q(w - V.P * 2), V.P);
        g.fillRect(q(bx0 + V.P), q(by0 + w * 0.5 + V.CH + w * 0.5 - V.P), q(w - V.P * 2), V.P);
        g.fillRect(q(bx0), q(by0 + V.P), V.P, q(w * 0.5 + V.CH + w * 0.5 - V.P * 2));
        g.fillRect(q(bx0 + w - V.P), q(by0 + V.P), V.P, q(w * 0.5 + V.CH + w * 0.5 - V.P * 2));

        // 장소마다 다른 물건이 쌓여 있다. 궤짝 · 드럼통 · 자루 · 돌덩이 · 얼음.
        // 실루엣은 같은 네모로 두고 무늬만 바꾼다. 어디가 막혔는지가 먼저다
        cratePattern(g, th.crateKind, px + m, Y + m - V.CH, w, cc, cs, x, y);

        // 밀 수 있는 상자만 쇠테와 못.
        // "이건 밀 수 있다" 를 글자 없이 알리는 유일한 방법이다
        if (box) {
          const bx = px + m, by = Y + m - V.CH;

          // 쇠테 두 줄. 선이 아니라 칠한 띠다
          const bandH = Math.max(V.P, q(w * 0.10));
          g.fillStyle = 'rgba(84,94,110,0.92)';
          pr(g, bx, by + w * 0.26, w, bandH);
          pr(g, bx, by + w * 0.70, w, bandH);

          g.fillStyle = 'rgba(140,152,172,0.85)';
          pr(g, bx, by + w * 0.26, w, V.P);
          pr(g, bx, by + w * 0.70, w, V.P);

          // 못 네 개. 한 점씩
          g.fillStyle = 'rgba(226,234,246,0.95)';
          for (let i = 0; i < 4; ++i) {
            pr(g, bx + (i & 1 ? w - w * 0.22 : w * 0.14),
                  by + (i < 2 ? w * 0.28 : w * 0.72), V.P, V.P);
          }
        }
      }
    }
  }

  // ── 물 ───────────────────────────────────────────────────────
  //
  // 이 게임의 이름이 물이다. 그래서 물이 제일 잘 만들어져 있어야 한다.
  //
  // 파란 네모를 덮으면 그건 색깔 칸이지 물이 아니다. 물로 보이려면 셋이 필요하다.
  //   ① 깊이   가장자리가 얕고 안쪽이 깊다
  //   ② 흐름   빛무늬가 천천히 흐른다
  //   ③ 경계   물가에 하얀 포말이 일렁인다
  function water(g, x0, y0, w, h, t, clipRect) {
    const c = rgb(V.world.water), f = rgb(V.world.foam);

    g.save();
    if (clipRect) {
      g.beginPath();
      g.rect(clipRect[0], clipRect[1], clipRect[2], clipRect[3]);
      g.clip();
    }

    // 깊이. 가운데로 갈수록 진해진다
    const grad = g.createLinearGradient(x0, y0, x0, y0 + h);
    grad.addColorStop(0,    css(c, 0.34));
    grad.addColorStop(0.45, css(c, 0.52));
    grad.addColorStop(1,    css(c, 0.40));
    g.fillStyle = grad;
    g.fillRect(x0, y0, w, h);

    // 흐르는 빛무늬. 두 겹이 서로 다른 빠르기로 흘러야 물처럼 보인다.
    // 한 겹만 흐르면 줄무늬 벽지가 된다
    g.globalCompositeOperation = 'lighter';
    for (let layer = 0; layer < 2; ++layer) {
      const speed = layer ? 0.021 : -0.013;
      const gapY  = V.TS * (layer ? 2.6 : 4.1);
      g.fillStyle = css(f, layer ? 0.045 : 0.06);

      for (let yy = -gapY; yy < h + gapY; yy += gapY) {
        const off = ((t * speed) % gapY + gapY) % gapY;
        const wob = Math.sin((yy + t * 0.05) * 0.02) * V.TS * 0.5;
        g.fillRect(x0 + wob, y0 + yy + off, w, Math.max(1.5, V.TS * 0.10));
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.restore();
  }

  // 물가. 물과 마른 땅이 만나는 선에 포말이 인다.
  // 경계가 딱 떨어지면 색을 칠한 것이고, 일렁이면 물이 들어온 것이다
  function foamEdge(g, segs, t) {
    if (!segs.length) return;
    const f = rgb(V.world.foam);

    g.lineCap = 'round';
    for (let pass = 0; pass < 2; ++pass) {
      g.strokeStyle = css(f, pass ? 0.85 : 0.35);
      g.lineWidth = pass ? 2 : Math.max(3, V.TS * 0.22);

      g.beginPath();
      for (let i = 0; i < segs.length; i += 4) {
        const ax = segs[i], ay = segs[i + 1], bx = segs[i + 2], by = segs[i + 3];
        const n = Math.sin((ax + ay) * 0.7 + t * 0.006) * V.TS * 0.10;
        const horiz = (ay === by);
        g.moveTo(ax + (horiz ? 0 : n), ay + (horiz ? n : 0));
        g.lineTo(bx + (horiz ? 0 : n), by + (horiz ? n : 0));
      }
      g.stroke();
    }
  }

  // ── 캐릭터 ───────────────────────────────────────────────────
  //
  // 크아 쪽 비례를 따라간다. 머리가 크고 몸이 작다.
  // 작게 그려도 어느 쪽을 보는지 알아야 하는데, 방향은 얼굴로만 알 수 있어서다.
  //
  // 여기서 신경 쓴 것
  //   윤곽선   스물넷이 엉키고 물까지 덮이면 색만으로는 안 보인다
  //   기울기   가는 쪽으로 몸이 기운다. 이게 없으면 미끄러지는 것처럼 보인다
  //   눌림     걸을 때 위아래로 눌렸다 펴진다. 발만 움직이면 인형이 된다
  //   눈       가끔 깜빡이고, 물풍선이 가까우면 커진다
  // 얼굴만. 킬 피드와 결과표에 쓴다.
  //
  // "P3" 이라고 쓰면 그건 번호고, 얼굴을 그리면 그건 **그 사람**이다.
  // 판에서 본 동물이 표에도 그대로 나오면 누가 누구인지가 바로 이어진다.
  // 판에서 쓰는 것과 **같은 함수**로 그린다. 따로 그리면 언젠가 갈린다
  function drawFace(g, cx, cy, hr, hex, animal) {
    const base  = rgb(hex);
    const lit   = lighter(base, 0.30);
    const shade = darker(base, 0.30);
    const line  = darker(base, 0.62);

    g.save();
    g.lineJoin = 'round';
    g.lineWidth = Math.max(1, hr * 0.16);

    drawEars(g, animal | 0, cx, cy, hr, base, shade, lit, line, 0);

    g.fillStyle = css(base);
    g.strokeStyle = css(line);
    g.beginPath();
    g.arc(cx, cy, hr, 0, 7);
    g.fill(); g.stroke();

    g.fillStyle = 'rgba(255,255,255,0.30)';
    g.beginPath();
    g.ellipse(cx - hr * 0.34, cy - hr * 0.40, hr * 0.32, hr * 0.22, -0.6, 0, 7);
    g.fill();

    drawFaceParts(g, animal | 0, cx, cy, hr, base, shade, lit, line,
                  0, false, 0, 0, cx, false);
    g.restore();
  }

  // ── 동물 여덟 종 ────────────────────────────────────────────
  //
  // 왜 동물인가.
  //   둥근 머리에 색만 다르면 스물넷이 다 같은 인형으로 보인다.
  //   크아가 캐릭터로 기억되는 건 다오와 우니가 **다르게 생겨서**다.
  //
  // 왜 여덟인가.
  //   색이 24개, 동물이 8종이고 주기가 다르다.
  //   그래서 색이 같은 사람끼리는 동물이 다르고, 동물이 같으면 색이 다르다.
  //
  // 무엇으로 가르나. **실루엣이 먼저다.**
  //   귀 모양이 제일 크게 다르다. 안개 너머와 작은 표에서도 그것만 보인다.
  //   주둥이와 눈은 가까이서만 보이는 것이라 두 번째다.
  const ANIMALS = ['고양이', '강아지', '토끼', '곰', '여우', '판다', '개구리', '병아리'];

  // 귀. 머리보다 먼저 그린다
  function drawEars(g, kind, lean, hy, hr, base, shade, lit, line, face) {
    g.lineJoin = 'round';
    g.strokeStyle = css(line);
    g.lineWidth = Math.max(1, hr * 0.15);

    const back = (face === 3);   // 뒤를 보면 귀가 조금 눕는다

    if (kind === 0) {
      // 고양이. 뾰족한 삼각 귀. 안쪽이 밝다
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        g.fillStyle = css(base);
        g.beginPath();
        g.moveTo(lean + s * hr * 0.30, hy - hr * 0.74);
        g.lineTo(lean + s * hr * 0.86, hy - hr * 1.42);
        g.lineTo(lean + s * hr * 0.94, hy - hr * 0.52);
        g.closePath();
        g.fill(); g.stroke();

        g.fillStyle = css(lighter(base, 0.55), 0.9);
        g.beginPath();
        g.moveTo(lean + s * hr * 0.44, hy - hr * 0.74);
        g.lineTo(lean + s * hr * 0.80, hy - hr * 1.18);
        g.lineTo(lean + s * hr * 0.84, hy - hr * 0.62);
        g.closePath();
        g.fill();
      }
    }
    else if (kind === 1) {
      // 강아지. 축 처진 귀. 머리 옆으로 늘어진다
      g.fillStyle = css(shade);
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        g.beginPath();
        g.ellipse(lean + s * hr * 0.92, hy + hr * (back ? 0.10 : 0.22),
                  hr * 0.34, hr * 0.62, s * 0.32, 0, 7);
        g.fill(); g.stroke();
      }
    }
    else if (kind === 2) {
      // 토끼. 길고 큰 귀. 제일 알아보기 쉽다
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        g.fillStyle = css(base);
        g.beginPath();
        g.ellipse(lean + s * hr * 0.44, hy - hr * 1.30,
                  hr * 0.26, hr * 0.78, s * 0.16, 0, 7);
        g.fill(); g.stroke();

        g.fillStyle = css(lighter(base, 0.6), 0.9);
        g.beginPath();
        g.ellipse(lean + s * hr * 0.44, hy - hr * 1.28,
                  hr * 0.13, hr * 0.56, s * 0.16, 0, 7);
        g.fill();
      }
    }
    else if (kind === 3) {
      // 곰. 작고 동그란 귀가 머리 위에
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        g.fillStyle = css(shade);
        g.beginPath();
        g.arc(lean + s * hr * 0.68, hy - hr * 0.76, hr * 0.34, 0, 7);
        g.fill(); g.stroke();
        g.fillStyle = css(lighter(base, 0.45));
        g.beginPath();
        g.arc(lean + s * hr * 0.68, hy - hr * 0.76, hr * 0.17, 0, 7);
        g.fill();
      }
    }
    else if (kind === 4) {
      // 여우. 크고 뾰족한 귀. 끝이 어둡다
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        g.fillStyle = css(base);
        g.beginPath();
        g.moveTo(lean + s * hr * 0.24, hy - hr * 0.78);
        g.lineTo(lean + s * hr * 1.02, hy - hr * 1.62);
        g.lineTo(lean + s * hr * 1.00, hy - hr * 0.44);
        g.closePath();
        g.fill(); g.stroke();

        g.fillStyle = css(darker(base, 0.55));
        g.beginPath();
        g.moveTo(lean + s * hr * 0.70, hy - hr * 1.16);
        g.lineTo(lean + s * hr * 1.02, hy - hr * 1.62);
        g.lineTo(lean + s * hr * 1.00, hy - hr * 1.06);
        g.closePath();
        g.fill();
      }
    }
    else if (kind === 5) {
      // 판다. 검고 동그란 귀
      g.fillStyle = '#2b2f36';
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        g.beginPath();
        g.arc(lean + s * hr * 0.74, hy - hr * 0.72, hr * 0.36, 0, 7);
        g.fill(); g.stroke();
      }
    }
    else if (kind === 6) {
      // 개구리. 귀가 없고 눈이 머리 위로 솟는다.
      // 그 혹을 여기서 그려두고 눈알은 얼굴 쪽에서 얹는다
      g.fillStyle = css(lighter(base, 0.15));
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        g.beginPath();
        g.arc(lean + s * hr * 0.52, hy - hr * 0.86, hr * 0.40, 0, 7);
        g.fill(); g.stroke();
      }
    }
    else {
      // 병아리. 귀 대신 머리 깃 세 가닥
      g.strokeStyle = css(darker(base, 0.35));
      g.lineWidth = Math.max(1.5, hr * 0.20);
      g.lineCap = 'round';
      for (let i = -1; i <= 1; ++i) {
        g.beginPath();
        g.moveTo(lean + i * hr * 0.22, hy - hr * 0.86);
        g.quadraticCurveTo(lean + i * hr * 0.44, hy - hr * 1.34,
                           lean + i * hr * 0.14, hy - hr * 1.46);
        g.stroke();
      }
      g.strokeStyle = css(line);
      g.lineWidth = Math.max(1, hr * 0.15);
    }
  }

  // 얼굴. 주둥이와 눈과 무늬
  function drawFaceParts(g, kind, lean, hy, hr, base, shade, lit, line,
                         face, side, dir, t, seed, danger) {
    // 뒤를 보면 아무것도 안 그린다. 그게 뒤통수다
    if (face === 3) {
      g.fillStyle = 'rgba(0,0,0,0.16)';
      g.beginPath();
      g.arc(lean, hy + hr * 0.28, hr * 0.64, 0, 7);
      g.fill();
      return;
    }

    // 판다 눈 둘레. 눈보다 먼저 깔아야 눈이 그 위에 온다
    if (kind === 5) {
      g.fillStyle = '#2b2f36';
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        if (side && s !== dir) continue;
        g.beginPath();
        g.ellipse(lean + (side ? dir * hr * 0.34 : s * hr * 0.36), hy + hr * 0.10,
                  hr * 0.30, hr * 0.36, s * 0.35, 0, 7);
        g.fill();
      }
    }

    // 3초에 한 번쯤 깜빡인다. 물풍선이 가까우면 눈이 커진다.
    // 위험한 걸 캐릭터가 먼저 알아채는 것처럼 보인다
    const blink = (Math.sin(t / 1000 + seed) > 0.985) ? 0.15 : 1;
    const scare = danger ? 1.35 : 1;
    const er = hr * (kind === 3 ? 0.20 : 0.26) * scare;   // 곰은 눈이 작다

    function eye(ex, ey2, rr2) {
      const e = (rr2 === undefined) ? er : rr2;
      g.fillStyle = '#fff';
      g.beginPath();
      g.ellipse(ex, ey2, e, e * blink, 0, 0, 7);
      g.fill();
      if (blink > 0.5) {
        g.fillStyle = '#161a1f';
        g.beginPath();
        g.arc(ex + (side ? dir * e * 0.20 : 0), ey2 + e * 0.18, e * 0.52, 0, 7);
        g.fill();
        // 눈동자 반짝임. 이 점 하나가 살아 있는 것처럼 보이게 한다
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.beginPath();
        g.arc(ex - e * 0.22, ey2 - e * 0.12, e * 0.16, 0, 7);
        g.fill();
      }
    }

    const ey = hy + hr * 0.12;

    if (kind === 6) {
      // 개구리. 눈이 머리 위 혹 안에 있다
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        if (side && s !== dir) continue;
        eye(lean + (side ? dir * hr * 0.52 : s * hr * 0.52), hy - hr * 0.86,
            hr * 0.24 * scare);
      }
      g.strokeStyle = css(line);
      g.lineWidth = Math.max(1.2, hr * 0.14);
      g.beginPath();
      g.arc(lean, hy + hr * 0.02, hr * 0.62, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      return;
    }

    if (side) {
      eye(lean + dir * hr * 0.34, ey);
    } else {
      eye(lean - hr * 0.34, ey);
      eye(lean + hr * 0.34, ey);
    }

    // 주둥이. 종마다 다르다
    const mx = lean + (side ? dir * hr * 0.62 : 0);
    const my = hy + hr * 0.50;

    if (kind === 7) {
      // 병아리. 부리
      g.fillStyle = '#f7b73d';
      g.strokeStyle = 'rgba(120,85,20,0.9)';
      g.lineWidth = Math.max(1, hr * 0.12);
      g.beginPath();
      g.moveTo(mx - hr * 0.26, my - hr * 0.10);
      g.lineTo(mx + hr * 0.26, my - hr * 0.10);
      g.lineTo(mx + (side ? dir * hr * 0.30 : 0), my + hr * 0.34);
      g.closePath();
      g.fill(); g.stroke();
      return;
    }

    // 주둥이 바탕. 밝은 타원
    g.fillStyle = css(lighter(base, 0.62), 0.95);
    g.strokeStyle = css(line, 0.5);
    g.lineWidth = Math.max(1, hr * 0.10);
    g.beginPath();
    g.ellipse(mx, my, hr * ((kind === 3 || kind === 4) ? 0.46 : 0.38),
              hr * (kind === 3 ? 0.34 : 0.28), 0, 0, 7);
    g.fill(); g.stroke();

    // 코
    g.fillStyle = (kind === 5) ? '#2b2f36' : css(darker(base, 0.55));
    g.beginPath();
    if (kind === 1 || kind === 3) {
      g.ellipse(mx, my - hr * 0.10, hr * 0.17, hr * 0.13, 0, 0, 7);   // 강아지·곰은 코가 크다
    } else {
      g.moveTo(mx - hr * 0.13, my - hr * 0.16);
      g.lineTo(mx + hr * 0.13, my - hr * 0.16);
      g.lineTo(mx, my + hr * 0.02);
      g.closePath();
    }
    g.fill();

    // 입
    g.strokeStyle = css(line, 0.75);
    g.lineWidth = Math.max(1, hr * 0.10);
    g.beginPath();
    g.moveTo(mx, my - hr * 0.02);
    g.lineTo(mx, my + hr * 0.12);
    g.stroke();
    g.beginPath();
    g.arc(mx - hr * 0.13, my + hr * 0.10, hr * 0.14, 0, Math.PI * 0.9);
    g.stroke();
    g.beginPath();
    g.arc(mx + hr * 0.13, my + hr * 0.10, hr * 0.14, Math.PI * 0.1, Math.PI);
    g.stroke();

    // 고양이·여우 수염
    if (kind === 0 || kind === 4) {
      g.strokeStyle = css(line, 0.45);
      g.lineWidth = Math.max(0.8, hr * 0.06);
      for (let i = 0; i < 2; ++i) {
        const s = i ? 1 : -1;
        if (side && s !== dir) continue;
        for (let k = -1; k <= 1; ++k) {
          g.beginPath();
          g.moveTo(mx + s * hr * 0.30, my + k * hr * 0.10);
          g.lineTo(mx + s * hr * 0.88, my + k * hr * 0.22 - hr * 0.06);
          g.stroke();
        }
      }
    }

    // 강아지 혀
    if (kind === 1 && !danger) {
      g.fillStyle = '#ef6b8a';
      g.beginPath();
      g.ellipse(mx, my + hr * 0.26, hr * 0.14, hr * 0.18, 0, 0, 7);
      g.fill();
    }
  }

  // ── 캐릭터를 스프라이트로 굽는다 ────────────────────────────
  //
  // 캔버스에 그대로 그리면 아무리 색을 줄여도 곡선 가장자리가 흐려진다.
  // 그게 '매끈한 웹게임' 느낌의 정체다. 크아는 한 점 한 점이 자리를 갖는다.
  //
  // 그래서 **작은 종이에 먼저 그린다.** 타일이 38px 이면 한 점이 2px 이니
  // 캐릭터는 가로 17점쯤이다. 거기서 그리면 애초에 그릴 자리가 그것뿐이다.
  // 그리고 반투명한 가장자리를 잘라낸다. 있거나 없거나 둘 중 하나로 만든다.
  // 마지막에 확대해서 붙인다. 확대할 때 브라우저가 뭉개지 않게 꺼둔다.
  //
  // 굽는 값이 비싸므로 자세마다 한 번만 굽고 들고 있는다.
  // 자세는 동물 · 색 · 보는 쪽 · 걷는지 · 걸음 토막 · 죽었는지 · 위급한지로 정해진다.
  // 매 프레임 스물넷을 그리던 것이 붙이기만 하는 것으로 바뀐다
  const spriteCache = new Map();
  const SPRITE_FRAMES = 8;

  function bakeChar(key, r, hex, o) {
    let sp = spriteCache.get(key);
    if (sp) return sp;

    const P = V.P;
    const halfW = r * 1.15, up = r * 1.55, down = r * 1.20;

    const sw = Math.max(4, Math.round(halfW * 2 / P));
    const sh = Math.max(4, Math.round((up + down) / P));

    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    const c = cv.getContext('2d');

    c.save();
    c.translate(sw / 2, up / P);
    c.scale(1 / P, 1 / P);
    paintChar(c, 0, 0, r, hex, o);
    c.restore();

    // 반투명한 가장자리를 잘라낸다. 이게 없으면 확대했을 때
    // 테두리가 뿌옇게 번져서 다시 매끈해진다
    try {
      const img = c.getImageData(0, 0, sw, sh);
      const d = img.data;
      for (let i = 3; i < d.length; i += 4) {
        d[i] = d[i] < 110 ? 0 : 255;
      }
      c.putImageData(img, 0, 0);
    } catch (e) { /* 시험용 가짜 캔버스에는 픽셀이 없다 */ }

    sp = { cv: cv, sw: sw, sh: sh, up: up };
    spriteCache.set(key, sp);

    // 판이 오래 돌면 자세 조합이 쌓인다. 너무 많아지면 통째로 버린다
    if (spriteCache.size > 900) spriteCache.clear();
    return sp;
  }

  function drawChar(g, cx, cy, r, hex, o) {
    const moving = !!o.moving;
    const t = o.t || 0;

    // 걸음과 숨쉬기를 토막으로 끊는다. 이어지는 값이면 자세가 무한히 많아져
    // 스프라이트를 구울 수가 없다. 여덟 토막이면 눈에는 이어져 보인다
    const frame = moving
      ? (Math.floor((o.walk || 0) / (Math.PI * 2) * SPRITE_FRAMES) % SPRITE_FRAMES
         + SPRITE_FRAMES) % SPRITE_FRAMES
      : Math.floor(t / 175) % SPRITE_FRAMES;

    const pose = {
      face: o.face | 0,
      animal: o.animal | 0,
      moving: moving,
      walk: frame / SPRITE_FRAMES * Math.PI * 2,
      t: frame * 175,
      danger: !!o.danger,
      dead: !!o.dead,
    };

    const key = [hex, r | 0, V.P, pose.animal, pose.face, moving ? 1 : 0,
                 frame, pose.danger ? 1 : 0, pose.dead ? 1 : 0].join(',');

    const sp = bakeChar(key, r, hex, pose);
    const P = V.P;

    // 붙일 자리도 격자에 맞춘다. 반 픽셀에 붙이면 다시 흐려진다
    const dx = Math.round((cx - sp.sw * P / 2) / P) * P;
    const dy = Math.round((cy - sp.up) / P) * P;

    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(sp.cv, 0, 0, sp.sw, sp.sh, dx, dy, sp.sw * P, sp.sh * P);
    g.imageSmoothingEnabled = smooth;
  }

  function paintChar(g, cx, cy, r, hex, o) {
    const face = o.face | 0;
    const walk = o.walk || 0;
    const moving = !!o.moving;
    const t = o.t || 0;

    const base = rgb(hex);
    const lit  = lighter(base, 0.30);
    const shade = darker(base, 0.30);
    const line = darker(base, 0.62);

    const swing = moving ? Math.sin(walk) : 0;
    const bob   = moving ? Math.abs(Math.sin(walk)) * r * 0.13
                         : Math.sin(t / 700) * r * 0.05;

    // 눌림. 위로 뜰 때 홀쭉해지고 바닥에 닿을 때 납작해진다
    const sq = moving ? 1 + Math.cos(walk * 2) * 0.06 : 1;
    const y  = cy - bob;

    const side = (face === 1 || face === 2);
    const dir  = (face === 2) ? 1 : (face === 1 ? -1 : 0);
    const lean = moving ? dir * r * 0.10 : 0;   // 가는 쪽으로 기운다

    // 그림자. 떠 있을수록 작고 옅어진다
    const lift = bob / (r * 0.13 + 0.001);
    g.fillStyle = 'rgba(0,0,0,' + (0.30 - lift * 0.10) + ')';
    g.beginPath();
    g.ellipse(cx, cy + r * 0.92, r * (0.82 - lift * 0.10), r * (0.30 - lift * 0.04), 0, 0, 7);
    g.fill();

    g.save();
    g.translate(cx, y);
    g.scale(1 / sq, sq);
    g.lineJoin = 'round';
    g.strokeStyle = css(line);
    g.lineWidth = Math.max(1, r * 0.13);

    // 발 둘
    g.fillStyle = css(shade);
    for (let i = 0; i < 2; ++i) {
      const s = i ? 1 : -1;
      const fx = side ? swing * s * r * 0.38 : s * r * 0.34;
      const fy = side ? r * 0.76 : r * 0.76 + swing * s * r * 0.16;
      g.beginPath();
      g.ellipse(fx, fy, r * 0.27, r * 0.19, 0, 0, 7);
      g.fill(); g.stroke();
    }

    // 팔 둘. 발과 반대로 흔들린다. 사람이 걸을 때 그렇게 걷는다
    g.strokeStyle = css(line);
    g.lineWidth = Math.max(1.4, r * 0.20);
    g.lineCap = 'round';
    for (let i = 0; i < 2; ++i) {
      const s = i ? 1 : -1;
      const ax = s * r * 0.46 + lean * 0.4;
      const ay = r * 0.18;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(ax + (side ? -swing * s * r * 0.26 : s * r * 0.10),
               ay + r * 0.30 - Math.abs(swing) * r * 0.06);
      g.stroke();
    }

    // 몸. 어깨가 좁고 아래가 퍼지는 종 모양
    g.lineWidth = Math.max(1, r * 0.13);
    g.strokeStyle = css(line);
    const bodyGrad = g.createLinearGradient(-r, 0, r, r);
    bodyGrad.addColorStop(0, css(lit));
    bodyGrad.addColorStop(1, css(shade));
    g.fillStyle = bodyGrad;

    g.beginPath();
    g.moveTo(-r * 0.48 + lean, r * 0.78);
    g.quadraticCurveTo(-r * 0.54 + lean, r * 0.06, lean, r * 0.02);
    g.quadraticCurveTo(r * 0.54 + lean, r * 0.06, r * 0.48 + lean, r * 0.78);
    g.closePath();
    g.fill(); g.stroke();

    // 배. 밝은 면 하나가 있어야 몸이 둥글어 보인다
    g.fillStyle = css(lighter(base, 0.55), 0.85);
    g.beginPath();
    g.ellipse(lean, r * 0.44, r * 0.26, r * 0.20, 0, 0, 7);
    g.fill();

    // 머리
    const hr = r * 0.76;
    const hy = -r * 0.34 + lean * 0.2;

    // 머리 장식. **스물넷을 색만으로는 못 가른다.**
    //
    // 색을 스물네 개 쓰면 비슷한 게 반드시 생긴다. 빨강 계열만 넷이다.
    // 그래서 여섯 가지 장식을 색과 따로 돌린다. 색이 같아도 머리가 다르고,
    // 머리가 같아도 색이 다르다. 둘 다 같으려면 24명을 넘겨야 한다.
    //
    // 그리고 이건 실루엣이다. **멀리서 사람을 알아보는 건 색이 아니라 윤곽이다**
    // 귀. 머리보다 **먼저** 그린다. 뒤에 있어야 붙어 있는 것처럼 보인다
    drawEars(g, o.animal | 0, lean, hy, hr, base, shade, lit, line, face);

    const headGrad = g.createRadialGradient(lean - hr * 0.35, hy - hr * 0.40, hr * 0.15,
                                            lean, hy, hr * 1.1);
    headGrad.addColorStop(0, css(lighter(base, 0.45)));
    headGrad.addColorStop(1, css(base));
    g.fillStyle = headGrad;
    g.beginPath();
    g.arc(lean, hy, hr, 0, 7);
    g.fill(); g.stroke();

    // 왼쪽 위에서 오는 빛. 상자와 벽과 같은 데서 온다
    g.fillStyle = 'rgba(255,255,255,0.34)';
    g.beginPath();
    g.ellipse(lean - hr * 0.34, hy - hr * 0.42, hr * 0.32, hr * 0.22, -0.6, 0, 7);
    g.fill();

    drawFaceParts(g, o.animal | 0, lean, hy, hr, base, shade, lit, line,
                  face, side, dir, t, cx, !!o.danger);

    g.restore();
  }

  // ── 물풍선 ───────────────────────────────────────────────────
  //
  // 설치하고 터지기까지 2.5초가 이 게임에서 제일 긴 시간이다.
  // 그 시간이 그냥 흐르면 안 되고 남은 시간이 몸으로 느껴져야 한다.
  //
  // 마지막 0.5초에 세 가지가 한꺼번에 바뀐다. 빨라지고, 커지고, 붉어진다.
  // 하나만 바꾸면 못 알아채고 셋을 같이 바꾸면 안 볼 수가 없다
  function drawBubble(g, cx, cy, r, near, t, hex) {
    // 숨이 가빠지는 속도와 부푸는 양을 둘 다 올렸다.
    //
    // 전에는 52ms 주기에 16% 였다. 판에 물풍선이 열 개쯤 굴러다니면
    // 그 정도로는 어느 게 곧 터질 건지 안 보인다.
    // 물풍선은 **위험 표시**지 장식이 아니다
    const beat = Math.sin(t / (near ? 38 : 200));
    const grow = near ? 1 + Math.abs(beat) * 0.26 : 1;

    // 물이 들었으니 가로와 세로가 반대로 움직인다
    const rx = r * grow * (1 + beat * 0.10);
    const ry = r * grow * (1 - beat * 0.10);

    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.beginPath();
    g.ellipse(cx, cy + r * 0.80, rx * 0.86, ry * 0.28, 0, 0, 7);
    g.fill();

    const grad = g.createRadialGradient(cx - rx * 0.38, cy - ry * 0.42, r * 0.10,
                                        cx, cy, r * 1.1);
    if (near) {
      grad.addColorStop(0,   'rgba(255,240,240,0.97)');
      grad.addColorStop(0.5, 'rgba(255,150,140,0.92)');
      grad.addColorStop(1,   'rgba(215,60,60,0.90)');
    } else {
      grad.addColorStop(0,   'rgba(240,252,255,0.97)');
      grad.addColorStop(0.5, 'rgba(120,200,245,0.92)');
      grad.addColorStop(1,   'rgba(30,120,200,0.92)');
    }
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, 0, 0, 7);
    g.fill();

    g.strokeStyle = near ? 'rgba(255,210,205,0.95)' : 'rgba(205,240,255,0.95)';
    g.lineWidth = Math.max(1, r * 0.10);
    g.stroke();

    // 놓은 사람 색을 아래쪽에 얇게 두른다.
    // 누가 놓은 물풍선인지 알아야 피할지 밟을지가 정해진다
    if (hex) {
      g.strokeStyle = hex;
      g.lineWidth = Math.max(1.5, r * 0.16);
      g.beginPath();
      g.ellipse(cx, cy + ry * 0.42, rx * 0.72, ry * 0.30, 0, 0.15, Math.PI - 0.15);
      g.stroke();
    }

    // 반짝임 둘. 이거 하나로 평평한 원이 물방울이 된다
    g.fillStyle = 'rgba(255,255,255,0.88)';
    g.beginPath();
    g.ellipse(cx - rx * 0.36, cy - ry * 0.42, rx * 0.22, ry * 0.15, -0.6, 0, 7);
    g.fill();
    g.beginPath();
    g.arc(cx + rx * 0.34, cy + ry * 0.30, rx * 0.08, 0, 7);
    g.fill();
  }

  // ── 아이템 ───────────────────────────────────────────────────
  //
  // 다 똑같은 동그라미면 뭘 먹으러 갈지 고를 수가 없다.
  // 멀리서 **모양으로** 갈려야 한다. 색은 그다음이다
  // ── 아이템 ───────────────────────────────────────────────────
  //
  // 도트로 직접 찍는다. 캐릭터처럼 굽지 않고 그 자리에서 그린다 —
  // 모양이 몇 개 안 되고 격자에 맞춰 네모만 칠하므로 애초에 흐려질 데가 없다.
  //
  // 각 그림은 **11x11 도트 지도**다. 문자 하나가 점 하나고, 색은 아래 표에 있다.
  // 이렇게 두면 모양을 고칠 때 좌표를 계산할 필요가 없다. 글자만 바꾸면 된다.
  // 좌표로 그리던 때는 화살표 하나 고치는 데 꼭짓점 일곱 개를 만져야 했다
  const ITEM_ART = {
    // 물풍선 하나 더. 물방울
    1: {
      '.': null, 'o': '#8fd8ff', 'O': '#dff2ff', 'b': '#3b9ae8', 'k': '#12456f',
      rows: [
        '.....k.....',
        '....kOk....',
        '....kOk....',
        '...kOOk....',
        '...kOOok...',
        '..kOOoobk..',
        '.kOOooobbk.',
        '.kOoooobbk.',
        '.kOooobbbk.',
        '..kkoobbk..',
        '...kkkkk...',
      ],
    },
    // 물줄기가 길어진다. 위로 뻗는 화살
    2: {
      '.': null, 'o': '#ffb066', 'O': '#ffc078', 'b': '#e8590c', 'k': '#7a3200',
      rows: [
        '.....k.....',
        '....kOk....',
        '...kOObk...',
        '..kOOOObk..',
        '.kOOOOOObk.',
        'kkkOOOObkkk',
        '...kOOOb...',
        '...kOOOb...',
        '...kOOOb...',
        '...kOOOb...',
        '...kkkkk...',
      ],
    },
    // 롤러. 바퀴
    3: {
      '.': null, 'o': '#69db7c', 'O': '#a9e9b4', 'b': '#2f9e44', 'k': '#10401f',
      rows: [
        '...kkkkk...',
        '.kkbOOObkk.',
        '.kbOOOOObk.',
        'kbOOOkOOObk',
        'kbOOOkOOObk',
        'kbkkkOkkkbk',
        'kbOOOkOOObk',
        'kbOOOkOOObk',
        '.kbOOOOObk.',
        '.kkbOOObkk.',
        '...kkkkk...',
      ],
    },
  };
  // 도트 지도를 한 번만 찍어 종이에 굽고, 그다음부터는 붙이기만 한다.
  //
  // 처음엔 매 프레임 점을 찍었다. 11x11 이면 아이템 하나에 fillRect 가 80번쯤이고,
  // 화면에 아이템이 여럿이면 프레임당 700번이 됐다. clienttest 가 바로 잡았다
  // (판이 안 변할 때 프레임당 fillRect 400 미만이어야 한다).
  //
  // 아이템은 종류가 넷뿐이라 캐시가 아주 작다. 캐릭터를 굽는 것과 같은 수다
  const dotCache = new Map();

  function bakeDots(key, art, px) {
    let cv = dotCache.get(key);
    if (cv) return cv;

    const w = art.rows[0].length, h = art.rows.length;
    cv = document.createElement('canvas');
    cv.width = w * px; cv.height = h * px;

    const c = cv.getContext('2d');
    for (let r = 0; r < h; ++r) {
      const row = art.rows[r];
      for (let x = 0; x < row.length; ++x) {
        const col = art[row[x]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x * px, r * px, px, px);
      }
    }

    dotCache.set(key, cv);
    if (dotCache.size > 64) dotCache.clear();
    return cv;
  }

  function drawDots(g, art, x0, y0, px, key) {
    const cv = bakeDots(key + ':' + px, art, px);
    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, x0, y0);
    g.imageSmoothingEnabled = smooth;
  }

  function drawItem(g, cx, cy, T, kind, t) {
    // 위아래로 뜬다. 뜨는 것도 격자 단위로 끊는다. 안 끊으면 도트가 미끄러진다
    const P  = Math.max(1, Math.round(T / 16));
    const up = Math.round(Math.sin(t / 420 + cx * 0.1) * 1.2) * P;

    // 그림자. 뜰수록 작아진다
    g.fillStyle = 'rgba(0,0,0,0.26)';
    g.fillRect(Math.round((cx - T * 0.22) / P) * P,
               Math.round((cy + T * 0.30) / P) * P,
               Math.round(T * 0.44 / P) * P - (up > 0 ? P * 2 : 0), P);

    if (kind === 4) {
      // 울트라. 뒤에서 빛이 난다. 대비가 있어야 특수가 특별해진다.
      // 빛은 도트로 안 찍는다. 번지는 게 목적이라 격자에 맞추면 오히려 어색하다
      const pulse = 0.5 + 0.5 * Math.sin(t / 150);
      const y = cy + up;

      g.save();
      g.globalCompositeOperation = 'lighter';
      const glow = g.createRadialGradient(cx, y, 0, cx, y, T * 1.1);
      glow.addColorStop(0, 'rgba(255,205,90,' + (0.40 + 0.25 * pulse) + ')');
      glow.addColorStop(1, 'rgba(255,180,60,0)');
      g.fillStyle = glow;
      g.fillRect(cx - T * 1.1, y - T * 1.1, T * 2.2, T * 2.2);
      g.restore();

      // 별. 도트로 찍는다. 다른 아이템과 같은 세계에 살아야 한다
      const star = [
        '.....k.....',
        '....kOk....',
        '....kOk....',
        'kkkkkOkkkkk',
        '.kOOOOOOOk.',
        '..kOOOOOk..',
        '..kOOOOOk..',
        '.kOOk.kOOk.',
        '.kOk...kOk.',
        'kkk.....kkk',
        '...........',
      ];
      drawDots(g, { '.': null, 'O': '#ffd166', 'k': '#8a5a00', rows: star },
               Math.round((cx - 5.5 * P) / P) * P,
               Math.round((y - 5.5 * P) / P) * P, P, 'star');
      return;
    }

    const art = ITEM_ART[kind] || ITEM_ART[1];
    drawDots(g, art,
             Math.round((cx - 5.5 * P) / P) * P,
             Math.round((cy + up - 5.5 * P) / P) * P, P, 'item' + kind);
  }
  return {
    PLACES, WORLDS, ANIMALS, V, setScale, setPlaces, placeAt, placeNames, hash2, rr,
    buildFloor, buildRow, water, foamEdge,
    drawChar, paintChar, drawFace, drawBubble, drawItem, ITEM_ART,
    rgb, css, mix, lighter, darker,
    easeOut, easeIn, overshoot,
  };
})();
