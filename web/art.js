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
      crate: '#c08b52', crateTop: '#dda76a', crateSide: '#7e5628' },

    { name: '사원',   // 1 CLOISTER — 흰 대리석과 금빛
      floor: '#e0dcd2', floorAlt: '#d7d2c7', joint: '#b8b2a4', fleck: '#c8c2b4',
      wallTop: '#f2eee4', wallSide: '#9a9280', wallEdge: '#6b6455',
      crate: '#cbab5e', crateTop: '#e6c87c', crateSide: '#846a2f' },

    { name: '공장',   // 2 COMB — 강철과 주황 화물
      floor: '#9fa5ac', floorAlt: '#959ba2', joint: '#767c84', fleck: '#868c94',
      wallTop: '#8b939d', wallSide: '#3f464f', wallEdge: '#252a31',
      crate: '#cf7a35', crateTop: '#ea9450', crateSide: '#82471a' },

    { name: '마을',   // 3 LATTICE — 잔디와 나무집
      floor: '#8fc267', floorAlt: '#84b85d', joint: '#6a9c48', fleck: '#79ad52',
      wallTop: '#d9c9a4', wallSide: '#8a6a45', wallEdge: '#57402a',
      crate: '#b5793f', crateTop: '#d09252', crateSide: '#734a26' },

    { name: '캠프',   // 4 FOUR_ROOMS — 흙바닥과 천막
      floor: '#b8a184', floorAlt: '#ae977b', joint: '#907a5f', fleck: '#a08a6e',
      wallTop: '#e8ddc4', wallSide: '#8e7f63', wallEdge: '#5b5040',
      crate: '#9c7b52', crateTop: '#b8946a', crateSide: '#634d31' },

    { name: '사막',   // 5 DIAGONAL — 모래와 사암
      floor: '#e3cf9c', floorAlt: '#dac591', joint: '#bda772', fleck: '#cdb782',
      wallTop: '#e0b878', wallSide: '#a1743c', wallEdge: '#6b4a22',
      crate: '#c9a05e', crateTop: '#e2bb78', crateSide: '#82632f' },

    // 9/2 에 색을 다시 잡았다. 광장과 색거리가 8.4 밖에 안 나왔다 —
    // 둘 다 따뜻한 베이지 바닥에 붉은 지붕이라 나란히 놓아야 겨우 구분됐다.
    // 열 곳을 그려놓고 실질 아홉 곳이었던 셈이다.
    // 바닥을 식은 회색 벽돌로 내리고 차양을 사프란으로 올려서 떼어놨다.
    // 상자의 청록은 그대로 둔다. 그게 이 장소의 표식이다
    { name: '시장',   // 6 ALLEYS — 벽돌 골목과 천 차양
      floor: '#9a918a', floorAlt: '#918880', joint: '#756d67', fleck: '#847b75',
      wallTop: '#d8a340', wallSide: '#8f6320', wallEdge: '#583c12',
      crate: '#5c9c93', crateTop: '#7dbcb2', crateSide: '#356862' },

    { name: '해변',   // 7 WELL — 흰 모래와 산호
      floor: '#efdfbc', floorAlt: '#e7d6b0', joint: '#c9b78f', fleck: '#d8c69f',
      wallTop: '#8fd4e0', wallSide: '#3d7f96', wallEdge: '#245667',
      crate: '#e08b7a', crateTop: '#f2a795', crateSide: '#94503f' },

    { name: '얼음골', // 8 ZIGZAG — 눈과 얼음
      floor: '#dfeaf3', floorAlt: '#d4e2ee', joint: '#adc4d8', fleck: '#c0d4e4',
      wallTop: '#b8e5fa', wallSide: '#5589a8', wallEdge: '#33607a',
      crate: '#9fd2ea', crateTop: '#c8ecfc', crateSide: '#5c93b2' },

    { name: '부두',   // 9 DOCKS — 나무 판자와 화물
      floor: '#b08e63', floorAlt: '#a6845a', joint: '#8a6a45', fleck: '#997a52',
      wallTop: '#8d9aa4', wallSide: '#414c56', wallEdge: '#262e36',
      crate: '#7f8f5e', crateTop: '#9aab76', crateSide: '#4e5a36' },
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
    TS: 24, WH: 11, CH: 7, TOP: 14, BOT: 10,
    world: WORLDS[0],
    place: new Array(9).fill(PLACES[0]),
    sw: 15, sh: 13,
  };

  // 이 칸이 어느 장소인가
  function placeAt(x, y) {
    const s = Math.min(2, (y / V.sh) | 0) * 3 + Math.min(2, (x / V.sw) | 0);
    return V.place[s];
  }

  function setScale(ts) {
    V.TS  = ts;
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

        g.fillStyle = css(joint, 0.5);
        g.fillRect(x * T, y * T, T, 1);
        g.fillRect(x * T, y * T, 1, T);

        if (h > 0.80) {
          g.fillStyle = css(fleck, 0.7);
          const s = h > 0.95 ? 2 : 1;
          g.fillRect(x * T + 3 + ((h * 97) | 0) % (T - 7),
                     y * T + 3 + ((h * 131) | 0) % (T - 7), s, s);
        }
      }
    }

    // 벽 그림자. 빛이 왼쪽 위에서 오므로 오른쪽 아래로 진다
    for (let y = 0; y < H; ++y) {
      for (let x = 0; x < W; ++x) {
        if (tiles[y][x] !== 1) continue;

        const px = x * T + T * 0.18, py = y * T + T * 0.30;
        const grad = g.createLinearGradient(px, py, px, py + T * 1.1);
        grad.addColorStop(0, 'rgba(0,0,0,0.30)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(px, py, T, T * 1.1);
      }
    }
  }

  // ── 한 줄의 벽과 상자 ────────────────────────────────────────
  //
  // 줄마다 따로 그려둔다. 사람을 그릴 때 줄 사이에 끼워 넣어야 하기 때문이다.
  // 통째로 한 장에 그려두면 사람이 늘 벽 앞이나 늘 벽 뒤에 있게 된다.
  //
  // g 는 이 줄만 담는 종이다. 위로 V.TOP, 아래로 V.BOT 만큼 여유가 있다
  function buildRow(g, tiles, W, y) {
    const T = V.TS;

    const isWall = (x, yy) => (yy < 0 || yy >= tiles.length || x < 0 || x >= W)
                              ? true : tiles[yy][x] === 1;

    // 이 종이 안에서의 y 좌표. 줄의 윗변이 V.TOP 자리에 온다
    const Y = V.TOP;

    for (let x = 0; x < W; ++x) {
      const t = tiles[y][x];
      const px = x * T;
      if (t !== 1 && t !== 2) continue;

      const th = placeAt(x, y);
      const top = rgb(th.wallTop), side = rgb(th.wallSide), edge = rgb(th.wallEdge);

      // 밀 수 있는 상자는 **색이 아니라 모양으로** 다르다.
      // 색만 바꾸면 장소 팔레트에 묻혀서 못 알아본다.
      // 쇠테를 두르고 네 귀퉁이에 못을 박아서, 무겁고 미는 것처럼 보이게 한다
      const box = (t === 4);
      const ct = rgb(box ? lighter(rgb(th.crate), 0.10) : rgb(th.crateTop));
      const cs = rgb(th.crateSide), cc = rgb(th.crate);

      if (t === 1) {
        // 앞면. 아래로 V.WH 만큼 두께가 보인다
        g.fillStyle = css(side);
        g.fillRect(px, Y + T - V.WH, T, V.WH);

        // 앞면 아래쪽을 더 어둡게. 바닥과 만나는 데가 제일 어둡다
        const grad = g.createLinearGradient(0, Y + T - V.WH, 0, Y + T);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(1, 'rgba(0,0,0,0.35)');
        g.fillStyle = grad;
        g.fillRect(px, Y + T - V.WH, T, V.WH);

        // 윗면. V.WH 만큼 위로 올라가 있다. 이 어긋남이 곧 높이다
        g.fillStyle = css(top);
        g.fillRect(px, Y - V.WH, T, T);

        // 왼쪽 위 모서리에 빛. 오른쪽 아래에 그늘
        g.fillStyle = 'rgba(255,255,255,0.20)';
        g.fillRect(px, Y - V.WH, T, 2);
        g.fillRect(px, Y - V.WH, 2, T);
        g.fillStyle = 'rgba(0,0,0,0.14)';
        g.fillRect(px, Y - V.WH + T - 2, T, 2);
        g.fillRect(px + T - 2, Y - V.WH, 2, T);

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

        g.fillStyle = 'rgba(0,0,0,0.26)';
        g.beginPath();
        g.ellipse(px + T / 2 + T * 0.06, Y + T - T * 0.10, w * 0.52, w * 0.20, 0, 0, 7);
        g.fill();

        g.fillStyle = css(cs);
        rr(g, px + m, Y + m - V.CH + w * 0.5, w, w * 0.5 + V.CH, w * 0.18);
        g.fill();

        const grad = g.createLinearGradient(0, Y + m - V.CH, 0, Y + m - V.CH + w);
        grad.addColorStop(0, css(ct));
        grad.addColorStop(1, css(cc));
        g.fillStyle = grad;
        rr(g, px + m, Y + m - V.CH, w, w, w * 0.18);
        g.fill();

        g.strokeStyle = css(darker(cs, 0.35), 0.9);
        g.lineWidth = 1;
        g.stroke();

        // 널빤지 결 두 줄
        g.strokeStyle = css(darker(cc, 0.22), 0.55);
        g.beginPath();
        g.moveTo(px + m + 1, Y + m - V.CH + w * 0.36);
        g.lineTo(px + m + w - 1, Y + m - V.CH + w * 0.36);
        g.moveTo(px + m + 1, Y + m - V.CH + w * 0.68);
        g.lineTo(px + m + w - 1, Y + m - V.CH + w * 0.68);
        g.stroke();

        g.fillStyle = 'rgba(255,255,255,0.42)';
        g.fillRect(px + m + 2, Y + m - V.CH + 2, w * 0.34, 1.5);

        // 밀 수 있는 상자만 쇠테와 못.
        // "이건 밀 수 있다" 를 글자 없이 알리는 유일한 방법이다
        if (box) {
          const bx = px + m, by = Y + m - V.CH;

          g.strokeStyle = 'rgba(90,100,115,0.85)';
          g.lineWidth = Math.max(1.5, w * 0.09);
          g.beginPath();
          g.moveTo(bx, by + w * 0.30); g.lineTo(bx + w, by + w * 0.30);
          g.moveTo(bx, by + w * 0.74); g.lineTo(bx + w, by + w * 0.74);
          g.stroke();

          g.fillStyle = 'rgba(215,225,240,0.85)';
          const r2 = Math.max(1, w * 0.055);
          for (let i = 0; i < 4; ++i) {
            g.beginPath();
            g.arc(bx + (i & 1 ? w - w * 0.16 : w * 0.16),
                  by + (i < 2 ? w * 0.30 : w * 0.74), r2, 0, 7);
            g.fill();
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

  function drawChar(g, cx, cy, r, hex, o) {
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
    const beat = Math.sin(t / (near ? 52 : 200));
    const grow = near ? 1 + Math.abs(beat) * 0.16 : 1;

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
  function drawItem(g, cx, cy, T, kind, t) {
    const float = Math.sin(t / 420 + cx * 0.1) * T * 0.07;
    const y = cy + float;

    g.fillStyle = 'rgba(0,0,0,0.26)';
    g.beginPath();
    g.ellipse(cx, cy + T * 0.30, T * 0.24 - float * 0.2, T * 0.09, 0, 0, 7);
    g.fill();

    if (kind === 4) {
      // 울트라. 뒤에서 빛이 난다. 대비가 있어야 특수가 특별해진다
      const pulse = 0.5 + 0.5 * Math.sin(t / 150);
      const r = T * (0.34 + 0.05 * pulse);

      g.save();
      g.globalCompositeOperation = 'lighter';
      const glow = g.createRadialGradient(cx, y, 0, cx, y, T * 1.1);
      glow.addColorStop(0, 'rgba(255,205,90,' + (0.45 + 0.25 * pulse) + ')');
      glow.addColorStop(1, 'rgba(255,180,60,0)');
      g.fillStyle = glow;
      g.fillRect(cx - T * 1.1, y - T * 1.1, T * 2.2, T * 2.2);
      g.restore();

      g.fillStyle = '#ffd166';
      g.strokeStyle = '#fff6d8';
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i < 10; ++i) {
        const a = -Math.PI / 2 + i * Math.PI / 5 + t / 2200;
        const rad = (i & 1) ? r * 0.44 : r;
        g.lineTo(cx + Math.cos(a) * rad, y + Math.sin(a) * rad);
      }
      g.closePath();
      g.fill(); g.stroke();
      return;
    }

    const r = T * 0.27;
    g.lineWidth = Math.max(1, T * 0.06);
    g.strokeStyle = 'rgba(20,25,32,0.55)';

    if (kind === 1) {          // 물풍선 하나 더. 물방울
      const grad = g.createRadialGradient(cx - r * 0.3, y - r * 0.35, r * 0.1, cx, y, r * 1.2);
      grad.addColorStop(0, '#dff2ff'); grad.addColorStop(1, '#3b9ae8');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx, y - r * 1.15);
      g.quadraticCurveTo(cx + r * 1.05, y + r * 0.15, cx, y + r);
      g.quadraticCurveTo(cx - r * 1.05, y + r * 0.15, cx, y - r * 1.15);
      g.fill(); g.stroke();
    }
    else if (kind === 2) {     // 물줄기가 길어진다. 위로 뻗는 화살
      const grad = g.createLinearGradient(cx, y - r, cx, y + r);
      grad.addColorStop(0, '#ffd8a8'); grad.addColorStop(1, '#f76707');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(cx, y - r * 1.1);
      g.lineTo(cx + r * 0.85, y + r * 0.15);
      g.lineTo(cx + r * 0.34, y + r * 0.15);
      g.lineTo(cx + r * 0.34, y + r);
      g.lineTo(cx - r * 0.34, y + r);
      g.lineTo(cx - r * 0.34, y + r * 0.15);
      g.lineTo(cx - r * 0.85, y + r * 0.15);
      g.closePath();
      g.fill(); g.stroke();
    }
    else {                     // 롤러. 바퀴가 돈다
      const grad = g.createRadialGradient(cx - r * 0.3, y - r * 0.3, r * 0.1, cx, y, r * 1.2);
      grad.addColorStop(0, '#c6f6c9'); grad.addColorStop(1, '#2f9e44');
      g.fillStyle = grad;
      g.beginPath(); g.arc(cx, y, r, 0, 7); g.fill(); g.stroke();

      g.save();
      g.translate(cx, y);
      g.rotate(t / 400);
      g.strokeStyle = 'rgba(20,45,25,0.55)';
      g.beginPath();
      for (let i = 0; i < 3; ++i) {
        const a = i * Math.PI / 3;
        g.moveTo(-Math.cos(a) * r * 0.8, -Math.sin(a) * r * 0.8);
        g.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
      }
      g.stroke();
      g.restore();
    }
  }

  return {
    PLACES, WORLDS, ANIMALS, V, setScale, setPlaces, placeAt, placeNames, hash2, rr,
    buildFloor, buildRow, water, foamEdge,
    drawChar, drawFace, drawBubble, drawItem,
    rgb, css, mix, lighter, darker,
    easeOut, easeIn, overshoot,
  };
})();
