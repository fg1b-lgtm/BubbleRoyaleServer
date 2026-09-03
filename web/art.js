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

  // ── 색 램프 ──────────────────────────────────────────────────
  //
  // 그림이 유치해 보이던 가장 큰 이유가 여기 있었다.
  //
  // 9/2 까지는 그늘을 만들 때 검정을 섞고 빛을 만들 때 흰색을 섞었다. 밝기만
  // 바꾼 셈이다. 그러면 한 색의 그늘과 빛이 전부 같은 색상끼리라 화면이 납작해진다.
  // 픽셀 아트 자료마다 첫 줄에 나오는 이야기고, 밝기만 바꾸는 것이 그림을
  // 납작하게 만드는 가장 빠른 방법이라고 한다.
  //
  // 실제 빛은 그렇지 않다. 해는 노랗고 그늘을 채우는 것은 파란 하늘빛이다.
  // 그래서 그늘은 파랑 쪽으로, 빛은 노랑 쪽으로 색상을 돌린다. 같은 밝기 차이라도
  // 색상이 같이 돌면 면이 서 있는 것처럼 보인다.
  //
  // 채도도 같이 만진다. 그늘은 조금 죽이고 빛은 살린다. 밝기만 올린 하이라이트는
  // 색이 바래서 물감이 아니라 조명처럼 보이기 때문이다.

  function toHsl(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn;
    const sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h;
    if (mx === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else               h = ((r - g) / d + 4) / 6;
    return [h, sat, l];
  }

  function fromHsl(h, sat, l) {
    h = ((h % 1) + 1) % 1;
    sat = Math.max(0, Math.min(1, sat));
    l = Math.max(0, Math.min(1, l));
    if (sat === 0) { const v = l * 255; return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    const p = 2 * l - q;
    const hue = (t) => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
  }

  // 색상이 도는 목표 지점. 그늘은 남색(0.60), 빛은 주황(0.10) 쪽으로 간다.
  // 끝까지 돌리지 않는다 — 다 돌리면 나무가 파래지고 돌이 주황이 된다.
  // 원래 색이 뭐였는지는 남아 있어야 한다
  const HUE_SHADE = 0.60;
  const HUE_LIGHT = 0.10;

  // 두 색상 중 가까운 쪽으로 도는 양. 색상환은 둥글어서 0.95 와 0.05 는 이웃이다
  function towardHue(h, target, amount) {
    let d = target - h;
    while (d >  0.5) d -= 1;
    while (d < -0.5) d += 1;
    return h + d * amount;
  }

  // t 가 0 이면 원래 색, 1 이면 가장 깊은 그늘
  function shade(c, t) {
    const [h, sat, l] = toHsl(c);
    return fromHsl(towardHue(h, HUE_SHADE, t * 0.22),
                   sat * (1 - t * 0.18),
                   l * (1 - t * 0.62));
  }

  // t 가 0 이면 원래 색, 1 이면 가장 밝은 빛
  function light(c, t) {
    const [h, sat, l] = toHsl(c);
    return fromHsl(towardHue(h, HUE_LIGHT, t * 0.20),
                   Math.min(1, sat * (1 + t * 0.20)),
                   l + (1 - l) * t * 0.55);
  }

  // 한 재료의 다섯 단. 어두운 쪽부터 밝은 쪽으로.
  //
  // 다섯인 이유는, 셋이면 면이 세 개뿐이라 둥근 것을 못 만들고
  // 일곱이면 32픽셀짜리 칸에서는 옆 단끼리 구분이 안 되기 때문이다.
  // 옛날 16비트 게임들이 재료 하나에 네다섯 단을 쓴 것도 같은 이유다
  function ramp(base) {
    const c = (typeof base === 'string') ? rgb(base) : base;
    return [shade(c, 0.85), shade(c, 0.45), c, light(c, 0.42), light(c, 0.82)];
  }

  // 배경(바닥과 벽)에 쓰는 좁은 램프.
  //
  // 9/3 에 CC0 던전 타일셋을 받아서 우리 것과 나란히 재봤다. 한 칸 안의 명암 폭이
  // 저쪽은 0.05~0.22 인데 우리는 0.40 이었다. 두 배다. 배경이 그만큼 시끄러우면
  // 그 위에 놓인 물건이 전부 배경에 묻힌다.
  //
  // 배경은 무늬가 있다는 걸 알아볼 정도만 있으면 된다. 눈이 먼저 가야 하는 것은
  // 만질 수 있는 것이지 바닥이 아니다
  function bgRamp(base) {
    const c = (typeof base === 'string') ? rgb(base) : base;
    return [shade(c, 0.34), shade(c, 0.17), c, light(c, 0.15), light(c, 0.30)];
  }

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
      floor: '#6d5b5b', floorAlt: '#685757', joint: '#554747', fleck: '#7b6767',
      wallTop: '#504343', wallSide: '#312929', wallEdge: '#262020',
      crate: '#c27962', crateTop: '#d5a292', crateSide: '#a3573f',
      markH: 'log2', markV: 'lamp2', mark: 'well', crateKinds: ['crate', 'stone'], wallKinds: ['brick', 'brick', 'rock'],
      step: 'stone' },

    { name: '사원',   // 1 CLOISTER — 흰 대리석과 금빛
      floor: '#686a7f', floorAlt: '#636579', joint: '#505262', fleck: '#75778e',
      wallTop: '#4c4e5d', wallSide: '#2f313a', wallEdge: '#25262d',
      crate: '#9e8a44', crateTop: '#bfad6b', crateSide: '#7b6b35',
      markH: 'log2', markV: 'lamp2', mark: 'well', crateKinds: ['barrel', 'stone'], wallKinds: ['ashlar', 'ashlar', 'brick'],
      step: 'marble' },

    { name: '공장',   // 2 COMB — 강철과 주황 화물
      floor: '#475459', floorAlt: '#445055', joint: '#374145', fleck: '#515f65',
      wallTop: '#343d40', wallSide: '#1f2527', wallEdge: '#181c1e',
      crate: '#c07c3d', crateTop: '#d4a478', crateSide: '#95602f',
      markH: 'car2', markV: 'lamp2', mark: 'car', crateKinds: ['barrel', 'crate'], wallKinds: ['metal', 'metal', 'brick'],
      step: 'metal' },

    { name: '마을',   // 3 LATTICE — 잔디와 나무집
      floor: '#3c6539', floorAlt: '#396036', joint: '#2f4e2c', fleck: '#447140',
      wallTop: '#2c4929', wallSide: '#1b2d19', wallEdge: '#152314',
      crate: '#b68143', crateTop: '#cea779', crateSide: '#8d6434',
      markH: 'log2', markV: 'cact2', mark: 'tree', crateKinds: ['crate', 'sack'], wallKinds: ['wood', 'wood', 'brick'],
      // 사람이 그려온 타일. 이게 있으면 도트로 찍는 길을 안 탄다.
      // 위 색들은 그림이 안 왔을 때(파일이 없거나 시험 중일 때) 쓴다
      tiles: { floor: 'grass',
               wall:  ['tree', 'stone', 'bush'],
               big:   ['house', 'well'],
               crate: ['crate_plain', 'crate_x'] },
      step: 'grass' },

    { name: '캠프',   // 4 FOUR_ROOMS — 흙바닥과 천막
      floor: '#674d35', floorAlt: '#624932', joint: '#4f3b29', fleck: '#74573c',
      wallTop: '#4a3826', wallSide: '#2d2217', wallEdge: '#221a12',
      crate: '#4a9d43', crateTop: '#71bf6b', crateSide: '#3a7a34',
      markH: 'log2', markV: 'cact2', mark: 'tree', crateKinds: ['sack', 'crate'], wallKinds: ['wood', 'wood', 'rock'],
      step: 'sand' },

    { name: '사막',   // 5 DIAGONAL — 모래와 사암
      floor: '#6b6024', floorAlt: '#665b22', joint: '#534a1c', fleck: '#796c28',
      wallTop: '#4e461a', wallSide: '#302b10', wallEdge: '#25210c',
      crate: '#c3776d', crateTop: '#d6a19a', crateSide: '#aa5246',
      markH: 'log2', markV: 'cact2', mark: 'palm', crateKinds: ['stone', 'sack'], wallKinds: ['rock', 'rock', 'brick'],
      // 모래는 02 번만 테두리가 없다. 나머지 열다섯은 풀이 물린 이음새 타일이라
               // 바닥에 깔면 온 판에 풀 자국이 격자로 생긴다
      tiles: { floor: 'desert_sand_02',
               wall:  ['desert_stone_round', 'desert_sand_block', 'desert_cactus_pot3'],
               big:   ['desert_house_red', 'desert_house_blue', 'desert_market'],
               crate: ['desert_crate', 'desert_barrel1', 'desert_star_crate'] },
      step: 'sand' },

    // 9/2 에 색을 다시 잡았다. 광장과 색거리가 8.4 밖에 안 나왔다 —
    // 둘 다 따뜻한 베이지 바닥에 붉은 지붕이라 나란히 놓아야 겨우 구분됐다.
    // 열 곳을 그려놓고 실질 아홉 곳이었던 셈이다.
    // 바닥을 식은 회색 벽돌로 내리고 차양을 사프란으로 올려서 떼어놨다.
    // 상자의 청록은 그대로 둔다. 그게 이 장소의 표식이다
    { name: '시장',   // 6 ALLEYS — 벽돌 골목과 천 차양
      floor: '#7a3f58', floorAlt: '#743c54', joint: '#5e3144', fleck: '#8a4763',
      wallTop: '#592e40', wallSide: '#361c27', wallEdge: '#29151e',
      crate: '#9d8c31', crateTop: '#c3ae3f', crateSide: '#796c26',
      markH: 'car2', markV: 'lamp2', mark: 'well', crateKinds: ['sack', 'crate'], wallKinds: ['brick', 'brick', 'wood'],
      step: 'stone' },

    { name: '해변',   // 7 WELL — 흰 모래와 산호
      floor: '#78775c', floorAlt: '#727158', joint: '#5d5c48', fleck: '#878568',
      wallTop: '#585744', wallSide: '#38372b', wallEdge: '#2c2b22',
      crate: '#c8718b', crateTop: '#d99daf', crateSide: '#b44667',
      markH: 'log2', markV: 'cact2', mark: 'palm', crateKinds: ['barrel', 'stone'], wallKinds: ['rock', 'rock', 'wood'],
      step: 'sand' },

    { name: '얼음골', // 8 ZIGZAG — 눈과 얼음
      floor: '#58787a', floorAlt: '#547274', joint: '#455d5f', fleck: '#638689',
      wallTop: '#415859', wallSide: '#293738', wallEdge: '#202b2c',
      crate: '#bb7c61', crateTop: '#d0a491', crateSide: '#9a5c42',
      markH: 'log2', markV: 'lamp2', mark: 'rock', crateKinds: ['ice', 'stone'], wallKinds: ['rock', 'rock', 'ashlar'],
      step: 'ice' },

    { name: '부두',   // 9 DOCKS — 나무 판자와 화물
      floor: '#375e52', floorAlt: '#355a4f', joint: '#2b4940', fleck: '#3e6a5d',
      wallTop: '#28443c', wallSide: '#192a25', wallEdge: '#13201c',
      crate: '#409c75', crateTop: '#62bf98', crateSide: '#31795b',
      markH: 'car2', markV: 'lamp2', mark: 'car', crateKinds: ['crate', 'barrel'], wallKinds: ['metal', 'metal', 'wood'],
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
  // 조각을 그릴 때 '반드시 통로' 로 그은 칸인가.
  //
  // 서버가 맵 줄에 실어 보낸다. 규칙에는 안 쓰고 바닥을 그리는 데만 쓴다 —
  // 판정은 언제나 타일로만 한다
  let laneGrid = null;
  function setLanes(g) { laneGrid = g; }
  function isLane(x, y) {
    if (!laneGrid || y < 0 || x < 0) return false;
    const r = laneGrid[y];
    return !!(r && r[x]);
  }

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
    // 벽 높이. 이 값이 판의 입체감을 통째로 정한다.
    //
    // 0.46 에서 0.22 까지 낮췄다가 0.38 로 되돌렸다. 낮추면 아래 줄 벽에
    // 사람이 안 가려지는데, 가려지는 게 맞다 — 블록에 높이가 있고 카메라가
    // 살짝 아래에서 보는 각도이기 때문이다. 발과 정강이가 가려지는 정도가
    // 적당하고, 가슴까지 묻히면 너무 높은 것이다
    V.WH  = Math.round(ts * 0.42);
    // 상자가 솟은 높이. 벽보다 조금 낮다.
    //
    // 벽과 상자는 이 값 하나로만 다르다. 나머지 구조는 똑같다 —
    // 윗면을 이만큼 올리고, 그 아래를 옆면으로 채워 칸 바닥에 닿게 한다.
    // 만질 값이 여기 둘뿐이라 판의 입체감을 이 두 줄로 조절한다
    V.CH  = Math.round(ts * 0.34);
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

        // 그림 타일이 있는 장소는 그림을 깐다. 색으로 찍은 바닥은 그다음이다
        if (th.tiles && atlases.tiles) {
          const cv = bakeTileSprite(th.tiles.floor, T);
          if (cv) {
            g.imageSmoothingEnabled = false;
            g.drawImage(cv, 0, 0, cv.width, cv.height, x * T, y * T, T, T);
            continue;
          }
        }

        const base = rgb(th.floor), alt = rgb(th.floorAlt);
        const joint = rgb(th.joint), fleck = rgb(th.fleck);
        const h = hash2(x, y);

        // **바닥이 길을 말한다.**
        //
        // 크아 맵을 보면 잔디밭 위에 흙길이 격자로 나 있다. 그래서 판을 처음 봐도
        // 어디로 다니는 데인지가 바닥만으로 읽힌다. 우리는 바닥이 어디나 똑같아서
        // 상자를 다 부수기 전에는 길이 안 보였다.
        //
        // 판을 만들 때 '반드시 통로' 로 그은 칸을 그대로 길로 쓴다. 그 자리는
        // 블록이 안 깔리는 자리라, 판이 끝날 때까지 길로 남는 자리이기도 하다.
        // 없는 정보를 지어내는 게 아니라 이미 있는 정보를 눈에 보이게 하는 것이다
        const lane = isLane(x, y);

        // 같은 색 두 개를 번갈아 깔되, 칸마다 아주 조금씩 밝기를 흔든다.
        // 완전히 같은 색이 이어지면 인쇄물처럼 보이고, 많이 흔들면 지저분해진다
        let c = mix(((x + y) & 1) ? base : alt, WHITE, (h - 0.5) * 0.05);

        // 길은 한 단 밝고 조금 누렇다. 밟아서 풀이 벗겨진 흙이다
        if (lane) c = mix(light(c, 0.30), rgb('#c9a86a'), 0.22);

        g.fillStyle = css(c);
        g.fillRect(x * T, y * T, T, T);

        // 길과 길 아닌 데의 경계에 한 줄. 길이 길로 보이는 건 이 선 때문이다
        if (lane) {
          g.fillStyle = css(shade(rgb(th.floor), 0.30), 0.45);
          if (!isLane(x, y - 1)) g.fillRect(x * T, y * T, T, V.P);
          if (!isLane(x - 1, y)) g.fillRect(x * T, y * T, V.P, T);
          if (!isLane(x, y + 1)) g.fillRect(x * T, (y + 1) * T - V.P, T, V.P);
          if (!isLane(x + 1, y)) g.fillRect((x + 1) * T - V.P, y * T, V.P, T);
        }

        // 이음선도 격자 한 칸 두께로. 1px 로 그리면 배율에 따라 사라진다
        g.fillStyle = css(joint, 0.5);
        g.fillRect(x * T, y * T, T, V.P);
        g.fillRect(x * T, y * T, V.P, T);

        // 바닥 무늬 한 장. 열에 여섯은 빈 장이 뽑혀서 아무것도 안 그린다
        const mix4 = FLOOR_MIX[th.step] || FLOOR_MIX.stone;
        const fk = mix4[tileHash(x, y) % mix4.length];
        if (fk !== 'plain') {
          const dp = Math.max(1, Math.round(T / 16));
          // **바닥 무늬는 파인 것이지 얹힌 것이 아니다.**
          //
          // 처음엔 무늬를 바닥보다 밝게 칠했다. 그랬더니 배수구도 자갈도
          // 바닥에 붙인 스티커처럼 떠 보였다. 확대해서 보고 알았다.
          //
          // 실제로 바닥에 있는 것들은 대개 파여 있거나 그늘이 진다.
          // 어둡게 내리고, 티끌만 아주 조금 밝게 둔다
          const fc = bakeTile('f:' + fk + ':' + th.name + ':' + dp,
                              FLOOR_DOTS[fk],
                              { '.': null,
                                'j': css(shade(base, 0.45), 0.55),
                                'f': css(light(base, 0.28), 0.45),
                                'd': css(shade(base, 0.30), 0.55) }, dp);
          blitTile(g, fc, x * T, y * T, dp);
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

  // ── 도트 지도 굽기 ───────────────────────────────────────────
  //
  // 도트 지도 하나를 그 장소 색으로 칠해 종이에 굽는다.
  //
  // 지도의 글자는 역할이고 색은 장소가 준다. 그래서 같은 널빤지 무늬가
  // 마을에서는 초록 담이 되고 부두에서는 남색 판이 된다.
  //
  // 매 칸 도트를 찍으면 한 칸에 256번이라 판 하나에 45만 번이다. 한 번만 굽는다.
  // 종류 x 장소 x 배율이라 캐시가 백 개를 안 넘는다
  const tileCache = new Map();

  // 칸 하나짜리 그림을 구워 둔다.
  //
  // 벽 한 칸을 그리는 데 fillRect 가 열다섯 번 들어간다. 화면에 벽이 백서른
  // 칸이니 매 프레임 이천 번이 된다. 실제로 재보니 2099 번이었다.
  //
  // 전에는 줄 한 줄을 통째로 구우는 식으로 이걸 피했는데, 그러면 앞뒤 순서가
  // 종이 안에 갇힌다. 굽는 걸 버릴 게 아니라 **굽는 단위를 줄에서 칸으로** 낮추면
  // 둘 다 된다. 칸 하나가 붙이기 한 번이다.
  //
  // 열쇠에 이웃 모양까지 넣는다. 벽은 옆에 벽이 붙었느냐에 따라 테두리를
  // 그을지 말지가 달라지기 때문이다. 열쇠가 같으면 그림도 같다
  const propCache = new Map();

  function bakeProp(key, w, h, paint) {
    let cv = propCache.get(key);
    if (cv) return cv;

    cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    paint(cv.getContext('2d'));

    propCache.set(key, cv);
    // 장소 열 × 무달 다섯 × 이웃 열여섯 이면 사백이 넘지만, 한 판에는
    // 장소가 아홉 개뿐이라 실제로 차는 건 백 장 안팝이다
    if (propCache.size > 600) propCache.clear();
    return cv;
  }

  function bakeTile(key, rows, pal, P) {
    let cv = tileCache.get(key);
    if (cv) return cv;

    cv = document.createElement('canvas');
    cv.width = 16 * P; cv.height = 16 * P;
    const c = cv.getContext('2d');

    for (let r = 0; r < 16; ++r) {
      const row = rows[r];
      for (let x = 0; x < 16; ++x) {
        const col = pal[row[x]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x * P, r * P, P, P);
      }
    }

    tileCache.set(key, cv);
    if (tileCache.size > 240) tileCache.clear();
    return cv;
  }

  // 도트 지도의 글자를 그 재료의 실제 색으로 바꾼다.
  //
  // 지도에는 색이 아니라 **밝기 단**만 적혀 있다. 그래서 같은 널빤지 무늬가
  // 마을에서는 초록 담이 되고 부두에서는 남색 판이 된다.
  //
  // 외곽선은 그 색의 아주 어두운 쪽이되 채도를 거의 죽인다.
  // 채도가 남아 있으면 테두리가 물건보다 먼저 보인다 — 처음에 붉은 테두리가
  // 궤짝보다 눈에 띄어서 알았다
  function outlineOf(base) {
    const c = (typeof base === 'string') ? rgb(base) : base;
    const [h, sat, l] = toHsl(c);
    return fromHsl(towardHue(h, HUE_SHADE, 0.45), sat * 0.30, 0.10);
  }

  // bg 를 켜면 배경용 좁은 램프를 쓴다. 벽과 바닥이 그쪽이다
  function tonePal(base, bg) {
    const r = bg ? bgRamp(base) : ramp(base);
    return {
      '.': null,
      '0': css(r[0]), '1': css(r[1]), '2': css(r[2]),
      '3': css(r[3]), '4': css(r[4]),
      'o': css(outlineOf(base)),
    };
  }
  // 구운 물건에서 이 칸 몫(16x16)만 오려 붙인다.
  // 넷짜리·가로 둘·세로 둘이 다 같은 일을 해서 한 곳으로 모았다
  function stampMark(g, cv, cx, cy, px, Y, T, P) {
    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, cx * 16 * P, cy * 16 * P, 16 * P, 16 * P,
                Math.round(px / P) * P,
                Math.round((Y - V.WH) / P) * P, T, T);
    g.imageSmoothingEnabled = smooth;
  }

  // 둘짜리. 가로면 32x16, 세로면 16x32 다
  function bakeMark2(th, P, dir, flip) {
    const name = dir === 'H' ? th.markH : th.markV;
    const key = 'M' + dir + ':' + name + ':' + th.name + ':' + P + ':' + (flip ? 1 : 0);
    let cv = tileCache.get(key);
    if (cv) return cv;

    const rows = (dir === 'H' ? LANDMARK_H : LANDMARK_V)[name];
    const W = rows[0].length, H = rows.length;

    cv = document.createElement('canvas');
    cv.width = W * P; cv.height = H * P;
    const c = cv.getContext('2d');
    const pal = markPal(th);

    for (let y = 0; y < H; ++y) {
      const row = rows[y];
      for (let x = 0; x < W; ++x) {
        const col = pal[row[flip ? (W - 1 - x) : x]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x * P, y * P, P, P);
      }
    }
    tileCache.set(key, cv);
    return cv;
  }

  // 랜드마크 색. 몸통(a·b·c)은 그 장소 색을 따르고,
  // 잎·줄기·유리는 안 따른다. 야자수가 장소마다 다른 색이면
  // 그건 야자수가 아니라 색칠한 벽이다
  function markPal(th) {
    const r  = ramp(th.wallTop);
    const gr = ramp('#4f9c4a');   // 잎
    const nb = ramp('#8a5f38');   // 나무줄기
    return {
      '.': null,
      'o': css(outlineOf(th.wallTop)),
      'a': css(r[4]), 'b': css(r[2]), 'c': css(r[1]),
      'r': css(ramp(th.wallSide)[2]),
      'g': css(gr[2]), 'G': css(gr[4]),
      'n': css(nb[1]), 'N': css(nb[3]),
      'w': '#8fd0f0', 'y': '#ffd85e', 't': '#2b2f38',
    };
  }

  // 물건 하나를 통째로 한 번만 굽는다. 32x32 라 칸마다 찍으면 한 물건에
  // 1024 번이고 판에 수십 개가 뜬다. 구워두고 네 번 오려 붙인다
  function bakeLandmark(th, P) {
    const key = 'L:' + th.mark + ':' + th.name + ':' + P;
    let cv = tileCache.get(key);
    if (cv) return cv;

    const rows = LANDMARK[th.mark];
    cv = document.createElement('canvas');
    cv.width = 32 * P; cv.height = 32 * P;
    const c = cv.getContext('2d');

    const pal = markPal(th);

    for (let y = 0; y < 32; ++y) {
      const row = rows[y];
      for (let x = 0; x < 32; ++x) {
        const col = pal[row[x]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x * P, y * P, P, P);
      }
    }

    tileCache.set(key, cv);
    return cv;
  }

  function blitTile(g, cv, px, py, P) {
    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, Math.round(px / P) * P, Math.round(py / P) * P);
    g.imageSmoothingEnabled = smooth;
  }
  // ── 바닥 무늬 ───────────────────────────────────────────────
  //
  // 바닥은 화면에서 제일 넓은데 제일 비어 있었다. 색 두 개를 번갈아 깔고
  // 티끌을 한 점 찍는 게 전부라, 확대해 보면 **인쇄물 같았다.**
  //
  // 픽셀 게임에서 바닥이 살아 있는 건 무늬가 화려해서가 아니라
  // **가끔 다른 게 나오기 때문**이다. 열에 여섯은 그냥 비우고 나머지에만 넣는다.
  // 다 넣으면 그건 무늬가 아니라 또 다른 벽지다.
  //
  // 자리로 정한다. 판이 도는 동안 바뀌면 바닥이 끓어 보인다
  //
  //   j 이음선색   f 티끌   d 어두운 점   . 비워둠
  const FLOOR_DOTS = {
    'plain': [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    'crack': [
      '................',
      '................',
      '.....d..........',
      '......d.........',
      '.......dd.......',
      '.........d......',
      '..........d.....',
      '................',
      '................',
      '................',
      '..d.............',
      '...dd...........',
      '.....d..........',
      '................',
      '................',
      '................',
    ],
    'pebble': [
      '................',
      '................',
      '...ff...........',
      '...ff...........',
      '................',
      '..........ff....',
      '..........ff....',
      '................',
      '................',
      '.....ff.........',
      '.....ff.........',
      '................',
      '................',
      '.............f..',
      '................',
      '................',
    ],
    'grate': [
      '................',
      '..dddddddddd....',
      '..d........d....',
      '..d.jjjjjj.d....',
      '..d........d....',
      '..d.jjjjjj.d....',
      '..d........d....',
      '..d.jjjjjj.d....',
      '..d........d....',
      '..dddddddddd....',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
    'tuft': [
      '................',
      '................',
      '................',
      '................',
      '................',
      '.......f........',
      '......fdf.......',
      '.....f.d.f......',
      '......fdf.......',
      '.......d........',
      '................',
      '...f............',
      '..fdf...........',
      '...d............',
      '................',
      '................',
    ],
    'tile4': [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '.......j........',
      '.jjjjjjjjjjjjjj.',
      '.......j........',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  };

  // 장소마다 바닥에 뭐가 떨어져 있나. 돌바닥엔 금이, 잔디엔 풀이, 모래엔 자갈이 있다
  const FLOOR_MIX = {
    stone:  ['plain', 'plain', 'crack', 'tile4'],
    marble: ['plain', 'plain', 'tile4', 'tile4'],
    grass:  ['plain', 'plain', 'tuft',  'tuft'],
    sand:   ['plain', 'plain', 'pebble', 'plain'],
    wood:   ['plain', 'plain', 'tile4', 'crack'],
    metal:  ['plain', 'plain', 'grate', 'plain'],
    ice:    ['plain', 'plain', 'crack', 'crack'],
    water:  ['plain', 'plain', 'pebble', 'plain'],
  };
  // 칸 자리로 정해지는 값. 씨앗도 시간도 안 쓴다 —
  // 같은 칸은 언제 다시 봐도 같은 그림이어야 한다.
  // FNV 를 줄인 것이고, 여기서 필요한 건 흩어짐뿐이라 이걸로 충분하다
  function tileHash(x, y) {
    let h = (x * 73856093) ^ (y * 19349663);
    h = (h ^ (h >>> 13)) >>> 0;
    return h;
  }

  // ── 안 부서지는 벽 넷이 붙으면 물건이 된다 ─────────────────
  //
  // 안 부서지는 벽은 판에서 제일 많은 물건인데 제일 심심했다. 어디를 봐도
  // 같은 네모라서 **판을 봐도 어디인지 기억이 안 났다.**
  //
  // 넷이 짝수 자리에 딱 붙어 있으면 그 2x2 를 한 물건으로 그린다.
  // 사막이면 야자수, 부두면 자동차, 마을이면 큰 나무. 크기가 두 배라
  // 눈이 먼저 거기로 가고, 그게 그 조각의 이름표가 된다.
  //
  // 32x32 다. 타일이 16 점이니 정확히 넷을 덮는다.
  // 벽을 먼저 그리고 그 위에 덮으므로 '.' 은 벽이 비쳐 보이는 자리다 —
  // 그래서 물건이 무엇이든 **막힌 것으로는 계속 읽힌다.**
  //
  //   o 테두리   a 밝은 면   b 바탕   c 그늘   r 장소 강조색
  //   g 잎   G 밝은 잎   n 나무줄기   N 밝은 줄기   w 물·유리   y 빛나는 것   t 타이어
  const LANDMARK = {
    'palm': [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '..............ooo...............',
      '.............ogggo....ooo.......',
      '......ooo....oGggo...ogggo......',
      '.....ogggo...oGggo..ogGggo......',
      '.....oGgggo..oGgggo.oGgggo......',
      '.....ogGgggo.ogGggoogGggo..ooo..',
      '......ogGGggoooGggooGgggooogggo.',
      '..oooo.oggGgggoGggoGgggoogGGggo.',
      '.oggggoooggGgggGGGgGggggGGggggo.',
      '.oGGGgggggggGgGGGGGgggGGgggggo..',
      '.ogggGGGGggggGGGGGGGGGgggggooooo',
      '..oogggggGGGGGGGGGGGgggggggggggg',
      '....oooogggggGGGGGGGGGGGGGGGGGgg',
      '........oooggyGGGGGygggggggggggg',
      '...........ooooGGGgggggggooooooo',
      '...............oynnoooooo.......',
      '..............oNnnno............',
      '...............onnno............',
      '...............oNnno............',
      '..............onnnno............',
      '..............oNnnno............',
      '..............onnno.............',
      '..............onNno.............',
      '..............onnno.............',
      '..............oNnno.............',
    ],
    'car': [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '........oooooooooooooooo........',
      '.......orrrrrrrrrrrrrrrro.......',
      '.......orrrrrrrrrrrrrrrro.......',
      '.......orrwwwwwwrwwwwwwro.......',
      '.......orrwwwwwwrwwwwwwro.......',
      '.......orrwwwwwwrwwwwwwro.......',
      '.......orrwwwwwwrwwwwwwro.......',
      '.......orrwwwwwwrwwwwwwro.......',
      '...ooooorrwwwwwwrwwwwwwrooooo...',
      '..oaaaaaaaaaaaaaaaaaaaaaaaaaao..',
      '..orrrrrrrrrrrrrrrrrrrrrrrrrro..',
      '.oyyrrrrrrrrrrrrrrrrrrrrrrrryyo.',
      '.oyyrrrrrrrrrrrrrrrrrrrrrrrryyo.',
      '.oyyrrrrrrrrrrrrrrrrrrrrrrrryyo.',
      '..orrrrrtttrrrrrrrrrrrtttrrrro..',
      '..occcctttttccccccccctttttccco..',
      '..occctttatttccccccctttatttcco..',
      '...ooottaaattooooooottaaattoo...',
      '.....otttattto.....otttattto....',
      '......ottttto.......ottttto.....',
      '.......ottto.........ottto......',
      '........ooo...........ooo.......',
    ],
    'tree': [
      '................................',
      '................................',
      '................................',
      '...............ooo..............',
      '............ooogggooo...........',
      '..........ooGGGggggggo..........',
      '.........oGGGGGGGgggggo.........',
      '........oGGGGGGGGGgggggo........',
      '........oGGGGGGGGGggGGGgo.......',
      '.......oGGGGGGGGGGGGGGGGgo......',
      '.......oGGGGGGGGGGGGGGGGGo......',
      '......ooGGGGGGGGGGGGGGGGGGo.....',
      '.....ogggGGGGGGGGGGGGGGGGGgo....',
      '....oggggGGGGGGGGGGGGGGGGGggo...',
      '...oggggggGGGGGGGgGGGGGGGggggo..',
      '...oggggggggGGGggggGGGGGgggggo..',
      '..ogggggggggggggggggGGGgggggggo.',
      '..ogggggggggggggggggggggggggggo.',
      '..ogggggggggggggggggggggggggggo.',
      '...ogggggggggggggggggggggggggo..',
      '...ogggggggggggggggggggggggggo..',
      '....ogggggggggggggggggggggggo...',
      '.....ogggggggoNgggnogggggggo....',
      '......oogggoooNNnnnooogggoo.....',
      '........ooo..oNNnnno..ooo.......',
      '.............oNNnnno............',
      '.............oNNnnno............',
      '.............oNNnnno............',
      '.............oNNnnno............',
      '.............oNNnnno............',
      '.............oNNnnno............',
      '.............oNNnnno............',
    ],
    'well': [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................oo..............',
      '...............orro.............',
      '..............onnnro............',
      '..............onnnro............',
      '.............ornnnrro...........',
      '............orannnrrro..........',
      '............orannnorro..........',
      '...........orarnnnorrro.........',
      '..........oraronnnoorrro........',
      '..........oraoonnnooorro........',
      '.........orarnnnnnnnnrrro.......',
      '.......ooorrnnnnnnnnnnrroo......',
      '......oaaannnnnnnnnnnnnaaao.....',
      '......oaaaaaawwwwwwwaaaaaao.....',
      '......obccbbcwwwwwwwccbbcco.....',
      '......obccbbcwwwwwwwccbbcco.....',
      '......obccbbcwwwwwwwccbbcco.....',
      '......obccbbccbbccbbccbbcco.....',
      '......obccbbccbbccbbccbbcco.....',
      '......obccbbccbbccbbccbbcco.....',
      '......occccccccccccccccccco.....',
      '......occccccccccccccccccco.....',
      '.......ooooooooooooooooooo......',
      '................................',
    ],
    'rock': [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '...............oooo.............',
      '..............oaaaboo...........',
      '.............oaaaaabbo..........',
      '............oaaaaaaabbo.........',
      '...........obaaaaaaabbbo........',
      '..........oobaaaaaaabbbo........',
      '.......ooobbbbaaaaabbbbbo.......',
      '......obaaabbbbaaabbbbbbo.......',
      '.....obaaaaabbbbbbbbbbbbo.......',
      '....obaaaaaaabbbbbbbbbbboo......',
      '...obaaaaaaaaabbbbbaaabbbboo....',
      '...obaaaaaaaaabbbbaaaaabbbbbo...',
      '...obaaaaaaaaabbbaaaaaaabbbbo...',
      '..obbbaaaaaaabbbbaaaaaaabbbbbo..',
      '..obbbbaaaaabbbbbaaaaaaabbbbbo..',
      '..obbbbbaaabbcccbbaaaaabbbbbbbo.',
      '...obbbbbbbcccccccbaaabbbbbbbbo.',
      '...obbbbbbcccccccccbbbbbcccbbbo.',
      '...obbbbbbcccccccccbbbbcccccbo..',
      '....obbbbcccccccccccbbccccccco..',
      '.....obbbcccccccccccbbccccccco..',
      '......obbcccccccccccbbccccccco..',
      '.......ooocccccccccbbbbccccco...',
      '.........occcccccccoobbbccco....',
    ],
  };
  // ── 둘이 붙어도 물건이 된다 ─────────────────────────────────
  //
  // 넷이 붙는 자리는 판에 그리 많지 않다. 둘씩 붙은 자리가 훨씬 흔한데,
  // 거기가 계속 맨 벽이면 판 대부분은 여전히 심심하다.
  //
  // 가로 둘은 32x16, 세로 둘은 16x32 다. 넷짜리와 같은 규칙으로 짝수 자리에서만
  // 묶고, 칸마다 자기 몫만 오려 붙인다.
  //
  // 자동차가 가로 둘인 건 자동차가 그렇게 생겼기 때문이다. 세로로 세운 자동차는
  // 위에서 본 자동차가 아니라 그냥 세로로 긴 네모다
  const LANDMARK_H = {
    'car2': [
      '................................',
      '.........ooooooooooooooo........',
      '........orrrrrrrrrrrrrrro.......',
      '........orrrrrrrrrrrrrrro.......',
      '........orrwwwwwrwwwwwrro.......',
      '........orrwwwwwrwwwwwrro.......',
      '...oooooorrwwwwwrwwwwwrroooooo..',
      '..oaaaaaaaaaaaaaaaaaaaaaaaaaaao.',
      '.oyyrrrrrrrrrrrrrrrrrrrrrrrrryyo',
      '.oyyrrrrrrrrrrrrrrrrrrrrrrrrryyo',
      '.oyyrrrrrrrrrrrrrrrrrrrrrrrrryyo',
      '..occcccctccccccccccccctcccccco.',
      '..occccctttccccccccccctttccccco.',
      '...ooootttttoooooooootttttoooo..',
      '.......ottto.........ottto......',
      '........oto...........oto.......',
    ],
    'log2': [
      '................................',
      '................................',
      '................................',
      '................................',
      '................................',
      '..oooooooooooooooooooooooooooo..',
      '.oNNNNNNNNNNNNNNNNNNNNNNNNNNNNo.',
      'oNNNNNNNNNNNNNNNNNNNNNNNNNNNNNo.',
      'NNNcNNNnnncnnnncnnnncnnnncnnnno.',
      'NNcccNNnnncnnnncnnnncnnnncnnnno.',
      'NNNcNNNnnncnnnncnnnncnnnncnnnno.',
      'oNNNNNnnnncnnnncnnnncnnnncnnnno.',
      '.oNNNcnnnncnnnncnnnncnnnncnnnno.',
      '.onnnncccccccccccccccccccccnnno.',
      '..oooocccccccccccccccccccccooo..',
      '......ooooooooooooooooooooo.....',
    ],
  };

  const LANDMARK_V = {
    'lamp2': [
      '......oooo......',
      '.....obbbbo.....',
      '....oobbbboo....',
      '...orrbbbbrro...',
      '...oryyyyyyro...',
      '...oryyyyyyro...',
      '...oryyyyyyro...',
      '...oryyyyyyro...',
      '...oryyyyyyro...',
      '...orrrrrrrro...',
      '....ooabbboo....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '.....oabbbo.....',
      '...oooabbbooo...',
      '..occcccccccco..',
      '..occcccccccco..',
      '..occcccccccco..',
    ],
    'cact2': [
      '................',
      '................',
      '................',
      '................',
      '................',
      '......oooo......',
      '.....oGgggo.....',
      '.....oGgggo.....',
      '.....oGgGgo.....',
      '..o..oGgggo.....',
      '.ogo.oGgggo.....',
      '.ogo.oGgggo.....',
      '.ogoooGgGgo..o..',
      '.oggggGgggo.ogo.',
      '.oggggGgggo.ogo.',
      '.oggggGgggo.ogo.',
      '.oggggGgGgooogo.',
      '..ooooGgggggggo.',
      '.....oGgggggggo.',
      '.....oGgggggggo.',
      '.....oGgGgggggo.',
      '.....oGgggoooo..',
      '.....oGgggo.....',
      '.....oGgggo.....',
      '.....oGgGgo.....',
      '.....oGgggo.....',
      '.....oGgggo.....',
      '.....oGgggo.....',
      '.....oGgGgo.....',
      '.....oGgggo.....',
      '.....oGgggo.....',
      '.....oGgggo.....',
    ],
  };
  // ── 벽과 상자를 도트로 찍는다 ───────────────────────────────
  //
  // 값이 다섯 단이다. 0 이 가장 깊은 그늘이고 4 가 가장 밝은 빛이다.
  // o 는 외곽선인데 검정이 아니라 그 재료의 아주 어두운 색을 쓴다.
  // 순검정으로 두르면 물건이 배경에서 오려 붙인 것처럼 떠 보인다.
  //
  // 9/2 까지는 세 단이었다. 세 단으로는 면이 세 개뿐이라 둥근 것도 각진 것도
  // 못 만든다. 옛날 16비트 게임들이 재료 하나에 네다섯 단을 쓴 이유가 그것이다.
  //
  // 빛은 늘 왼쪽 위에서 온다. 판 전체에 광원이 하나여야 물건들이 같은 세상에
  // 있는 것으로 보인다.
  //
  // 벽은 서로 이어 붙는다. 그래서 외곽선을 안 두르고, 가로로 쭉 이어지는 밝은
  // 줄도 안 넣는다. 그 줄이 곧 16픽셀마다 생기는 이음매가 되기 때문이다.
  // 바위를 그리다 한 번 겪었다.
  const WALL_DOTS = {
    'brick': [
      '0000000000000000',
      '0433333304333333',
      '0322222203222222',
      '0322222203222222',
      '0111111101111111',
      '0000000000000000',
      '0433333304333333',
      '0322222203222222',
      '0322222203222222',
      '0111111101111111',
      '0000000000000000',
      '0433333304333333',
      '0322222203222222',
      '0322222203222222',
      '0111111101111111',
      '0000000000000000',
    ],
    'ashlar': [
      '0000000000000000',
      '4440444444444444',
      '2220322222222222',
      '2220322222221222',
      '2220311222222222',
      '2220322222222222',
      '2220322222222222',
      '1110111111111111',
      '0000000000000000',
      '4444444444404444',
      '2222222222203222',
      '2222222222203212',
      '2212222222203222',
      '2222222221103222',
      '2222222222203222',
      '1111111111101111',
    ],
    'metal': [
      '0300000003000000',
      '0333333303333333',
      '0322222203222222',
      '0333333203222222',
      '0322432203224322',
      '0322102203221022',
      '0322222203222222',
      '0322222203222222',
      '0300000003000000',
      '0333333303333333',
      '0322222203222222',
      '0322222203333332',
      '0322432203224322',
      '0322102203221022',
      '0322222203222222',
      '0322222203222222',
    ],
    'wood': [
      '0322222103222221',
      '0322422103224221',
      '0322022103100111',
      '0310111103222221',
      '0310111103222221',
      '0322222103222221',
      '0322222103222221',
      '0322222103222221',
      '0322222103101111',
      '0322222103222221',
      '0322222103222221',
      '0310111103222221',
      '0322222103222221',
      '0322222103101111',
      '0322422103224221',
      '0322022103220221',
    ],
    'rock': [
      '3333322222222222',
      '3333322223333222',
      '3300002223333022',
      '2211111113333022',
      '2211111112222022',
      '2233331112222022',
      '2222222222222222',
      '2222220222000222',
      '2333222022111222',
      '2333222202111222',
      '2333222222333222',
      '2222200022222222',
      '2222211122221112',
      '2222233322221112',
      '2222222222221112',
      '2222222222222222',
    ],
  };

  const CRATE_DOTS = {
    'crate': [
      '................',
      '..oooooooooooo..',
      '.o444444444444o.',
      '.o433333333331o.',
      '.o430000000021o.',
      '.o430344430021o.',
      '.o430034300021o.',
      '.o430003430021o.',
      '.o430034300021o.',
      '.o430344430021o.',
      '.o430000000021o.',
      '.o432222222221o.',
      '.o411111111111o.',
      '.o400000000000o.',
      '..oooooooooooo..',
      '................',
    ],
    'stone': [
      '................',
      '.....oooooo.....',
      '...oo444444oo...',
      '..o444444333o...',
      '.o44443333322o..',
      '.o44333333222o..',
      'o4333333322221o.',
      'o3333322222211o.',
      'o3332222222111o.',
      'o3222222211111o.',
      'o2222221111111o.',
      'o1222111111110o.',
      '.o1111111110oo..',
      '.o000000000o....',
      '..ooooooooo.....',
      '................',
    ],
    'barrel': [
      '................',
      '...oooooooooo...',
      '..o3444333221o..',
      '.o13444333221o..',
      '.o13444333221o..',
      '.o11111111111o..',
      'o113444333221o..',
      'o113444333221o..',
      'o113444333221o..',
      'o113444333221o..',
      '.o11111111111o..',
      '.o13444333221o..',
      '.o13444333221o..',
      '..o134433322o...',
      '...oooooooooo...',
      '................',
    ],
    'sack': [
      '................',
      '......oooo......',
      '.....o2222o.....',
      '.....o1111o.....',
      '....o344321o....',
      '...o34443221o...',
      '..o3444432221o..',
      '..o3444332221o..',
      '.o344433222211o.',
      '.o344332222111o.',
      '.o343322222111o.',
      '.o333222221110o.',
      '.o322222111100o.',
      '..o2211111000o..',
      '..oooooooooooo..',
      '................',
    ],
    'ice': [
      '................',
      '......oooo......',
      '.....o4444o.....',
      '....o444433o....',
      '...o44443332o...',
      '..o4444o3322o...',
      '..o444o13322o...',
      '.o4443o113322o..',
      '.o443o1113322o..',
      '.o43o11144332o..',
      '.o3o111144332o..',
      '.o3o111133322o..',
      '.o22111112211o..',
      '..o211000110o...',
      '..oooooooooo....',
      '................',
    ],
  };

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

  // 칸 하나에 놓인 물건을 그린다. px, py 는 그 칸의 왼쪽 위 모서리다.
  //
  // 전에는 줄 한 줄을 통째로 종이에 구워두고 그 종이를 깔았다. 그러면 앞뒤
  // 순서가 종이 안에 갇힌다 — 사람은 종이 사이에만 낄 수 있고, 같은 줄에 있는
  // 상자와는 앞뒤를 못 가린다. 그래서 사람을 판 위에 한 번 더 그렸고,
  // 상자 뒤에 선 사람이 상자 앞으로 나왔다.
  //
  // 칸 하나씩 그리면 벽도 상자도 사람도 같은 목록에 들어가서 발밑 y 하나로
  // 줄을 선다. 부순 벽이 남아 있는 문제도 같이 없어진다 — 다시 구울 종이가 없다
  function drawProp(g, tiles, W, x, y, px, py) {
    const T = V.TS;
    const t = tiles[y][x];

    const place = placeAt(x, y);

    // 그림 타일이 있는 장소. 도트로 찍는 길을 아예 안 탄다
    if (place.tiles && atlases.tiles) {
      const wall4 = (xx, yy) => (yy < 0 || yy >= tiles.length || xx < 0 || xx >= W)
                                ? false : tiles[yy][xx] === 1;

      // **벽이 넷 붙은 자리에는 집이나 우물을 세운다.**
      //
      // 조각마다 따로 놓인 나무와 돌만으로는 판이 '물건을 늘어놓은 데' 로 보인다.
      // 크아 맵이 하나의 그림으로 보이는 건 거기에 집이 있고 우물이 있어서다.
      //
      // 없는 정보를 지어내는 게 아니다. 벽 넷이 붙은 자리는 이미 판에 있는
      // 정보고, 거기가 마침 두 칸짜리가 들어갈 유일한 자리다.
      //
      // 짝수 자리에서만 묶는다. 아무 데서나 묶으면 벽 하나가 여러 묶음에
      // 동시에 속해서 어느 쪽으로 그릴지가 안 정해진다.
      //
      // 그리는 것은 **왼쪽 아래 칸 하나**가 맡는다. 그 칸의 발밑 y 가 곧
      // 집의 아랫변이라, 두 칸짜리도 한 칸짜리와 같은 자로 줄을 선다.
      // 나머지 세 칸은 아무것도 안 그린다
      if (t === 1 && place.tiles.big) {
        const qx = x & ~1, qy = y & ~1;
        if (wall4(qx, qy) && wall4(qx + 1, qy)
            && wall4(qx, qy + 1) && wall4(qx + 1, qy + 1)) {
          if (x !== qx || y !== qy + 1) return;      // 나머지 세 칸

          const big = place.tiles.big;
          const cv = bakeTileSprite(big[tileHash(qx, qy) % big.length], T);
          if (cv) {
            g.imageSmoothingEnabled = false;
            g.drawImage(cv, qx * T, (qy + 2) * T - cv.height);
            return;
          }
        }
      }

      const set = t === 1 ? place.tiles.wall : place.tiles.crate;
      const cv = bakeTileSprite(set[tileHash(x, y) % set.length], T);
      if (cv) {
        g.imageSmoothingEnabled = false;
        // 아랫변을 칸 바닥에. 가로가 두 칸이면 가운데를 칸 가운데에 맞춘다
        g.drawImage(cv, px - (cv.width - T) / 2, py + T - cv.height);
        // 밀 수 있는 상자는 쇠테로 표시한다. 실루엣을 바꾸면 어느 게 밀리는지
        // 외워야 하는데, 그건 규칙이 아니라 암기다
        // 그림이 실제로 차지하는 네모에 두른다. 칸 크기로 잡으면
        // 통이나 항아리처럼 좁은 그림에서 테가 밖으로 삐져나온다
        if (t === 4) {
          const o = cv.op;
          paintBands(g, px - (cv.width - T) / 2 + o.x, py + T - cv.height + o.y,
                     o.w, o.h);
        }
        return;
      }
    }

    if (t === 2 || t === 4) { paintCrate(g, px, py, T, x, y, t === 4); return; }
    if (t !== 1) return;

    const isWall = (xx, yy) => (yy < 0 || yy >= tiles.length || xx < 0 || xx >= W)
                               ? true : tiles[yy][xx] === 1;

    const th = place;
    const dp = Math.max(1, Math.round(T / 16));

    // **한 조각 안에서도 무늬를 섞는다.**
    //
    // 종류를 장소마다 하나로 뒀더니, 확대해 보면 같은 그림이 줄줄이 붙어서
    // 물건이 아니라 벽지로 보였다. 판이 지루하지 않은 건 색이 화려해서가
    // 아니라 같은 게 두 번 연속 안 나오기 때문이다.
    //
    // 자리로 정한다. 무작위면 매 프레임 바뀌고 시간이면 깜빡인다.
    // 같은 칸은 언제 봐도 같은 무늬여야 판이 기억되는 장소가 된다
    const kinds = th.wallKinds || [th.wallKind || 'rock'];
    const wk = kinds[tileHash(x, y) % kinds.length];

    // 이웃에 벽이 붙었는지를 네 비트로 묶는다. 이게 같으면 그림이 같다
    const m = (isWall(x, y - 1) ? 1 : 0) | (isWall(x - 1, y) ? 2 : 0)
            | (isWall(x + 1, y) ? 4 : 0) | (isWall(x, y + 1) ? 8 : 0);

    g.drawImage(bakeWall(th, wk, m, dp), px, py - V.WH);

    // 조형물은 굽지 않는다. 어느 칸에 걸리느냐가 자리마다 달라서
    // 열쇠에 넣으면 캐시가 칸 수만큼 늘어난다. 이것도 붙이기 한 번이다.
    //
    // 넷이 붙었으면 그 위에 물건을 덮는다. 짝수 자리에서만 묶는다 —
    // 아무 데서나 묶으면 벽 하나가 여러 묶음에 동시에 속해서 어느 쪽으로
    // 그릴지가 안 정해진다. 짝수 격자면 하나뿐이다.
    // 넷 -> 가로 둘 -> 세로 둘 순으로 본다. 넷이 붙은 자리는 가로 둘이기도 해서,
    // 가로를 먼저 보면 큰 물건이 영영 안 나온다. **큰 것부터 집어야** 한다
    const qx = x & ~1, qy = y & ~1;
    const quad = isWall(qx, qy) && isWall(qx + 1, qy)
              && isWall(qx, qy + 1) && isWall(qx + 1, qy + 1);

    // **다 놓지 않는다.** 짝이 되는 자리마다 자동차를 놓았더니 부두가
    // 주차장이 됐다. 물건이 흔해지면 그건 더는 눈에 띄는 물건이 아니다.
    //
    // 넷짜리는 원래 드물어서 다 놓고, 둘짜리는 셋 중 하나만 놓는다.
    // 묶음의 왼쪽 위 자리로 정하므로 한 묶음의 네 칸이 같은 답을 낸다 —
    // 칸마다 따로 던지면 물건이 반만 그려진다
    const hq = tileHash(qx, qy);

    if (th.mark && LANDMARK[th.mark] && quad) {
      stampMark(g, bakeLandmark(th, dp), (x - qx), (y - qy), px, py, T, dp);
    }
    else if (th.markH && LANDMARK_H[th.markH] && hq % 3 === 0
             && isWall(qx, y) && isWall(qx + 1, y)) {
      // 좌우를 뒤집어 섞는다. 자동차가 전부 같은 쪽을 보고 서 있으면
      // 그건 세워둔 차가 아니라 무늬다
      stampMark(g, bakeMark2(th, dp, 'H', (hq & 4) !== 0),
                (x - qx), 0, px, py, T, dp);
    }
    else if (th.markV && LANDMARK_V[th.markV] && tileHash(x, qy) % 3 === 0
             && isWall(x, qy) && isWall(x, qy + 1)) {
      stampMark(g, bakeMark2(th, dp, 'V', (tileHash(x, qy) & 4) !== 0),
                0, (y - qy), px, py, T, dp);
    }
  }

  // 벽 한 칸을 구워 둔다. 종이 안에서 윗변이 0, 칸의 윗변이 V.WH 자리다
  function bakeWall(th, wk, m, dp) {
    const T = V.TS;
    return bakeProp('W:' + th.name + ':' + wk + ':' + m + ':' + dp + ':' + T,
                    T, T + V.WH, (g) => {
      const side = rgb(th.wallSide), edge = rgb(th.wallEdge);
      const up = (m & 1), left = (m & 2), right = (m & 4), down = (m & 8);
      const Y = V.WH;                       // 칸의 윗변

      // 앞면. 아래로 V.WH 만큼 두께가 보인다
      g.fillStyle = css(side);
      g.fillRect(0, Y + T - V.WH, T, V.WH);

      // 앞면 아래쪽을 더 어둡게. 바닥과 만나는 데가 제일 어둡다.
      // 그라데이션이 아니라 두 단이다. 픽셀 아트는 색이 번지지 않는다
      g.fillStyle = 'rgba(0,0,0,0.18)';
      pr(g, 0, Y + T - V.WH * 0.55, T, V.WH * 0.55);
      g.fillStyle = 'rgba(0,0,0,0.34)';
      pr(g, 0, Y + T - V.WH * 0.25, T, V.WH * 0.25);

      // 윗면. V.WH 만큼 위로 올라가 있다. 이 어긋남이 곧 높이다.
      //
      // **도트 지도를 그대로 붙인다.** 전에는 바탕을 칠하고 그 위에 비율로 계산한
      // 선을 얹었다. 그러면 줄눈이 배율에 따라 반 픽셀에 걸려 흐려지고,
      // 확대하면 반듯한 사각형만 나와서 도형처럼 보인다.
      // 16x16 을 한 번 구워서 붙이면 어느 배율에서든 도트가 도트로 남는다
      //
      // 무늬 대비를 세게 준다. 낮은 해상도에서는 한 점이 곧 정보라,
      // 옆 점과 명도가 비슷하면 그 점은 없는 것과 같다
      const rows = WALL_DOTS[wk] || WALL_DOTS.rock;
      blitTile(g, bakeTile('w:' + wk + ':' + th.name + ':' + dp, rows,
                           tonePal(th.wallTop, true), dp), 0, 0, dp);

      // 윗변 림. 물건이 바닥에서 떠 보이게 하는 한 줄이다.
      // 위쪽에 벽이 이어져 있으면 안 긋는다 — 덩어리 한가운데에 줄이 생기면
      // 하나짜리 벽이 여럿 붙어 있는 것처럼 보인다
      if (!up) {
        g.fillStyle = 'rgba(255,255,255,0.26)';
        g.fillRect(0, 0, T, dp);
      }

      // 왼쪽 위 모서리에 빛. 오른쪽 아래에 그늘.
      //
      // 빛을 0.20 으로 얹었더니 **벽 윗줄이 바닥보다 밝아졌다.**
      // 벽은 판에서 제일 어두워야 하는데 한 줄이 제일 밝으면 그 줄이 눈을 끈다.
      // 법칙 1(바닥 > 상자 > 벽)을 한 줄이 깨는 셈이다. 절반으로 낮추고
      // 대신 그늘을 키운다 — 어두워지는 쪽으로는 위계가 안 깨진다
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(0, 0, T, V.P);
      g.fillRect(0, 0, V.P, T);
      g.fillStyle = 'rgba(0,0,0,0.26)';
      g.fillRect(0, T - V.P, T, V.P);
      g.fillRect(T - V.P, 0, V.P, T);

      // 벽끼리 붙은 쪽에는 테두리를 안 긋는다. 그래야 벽이 덩어리로 보인다.
      // 칸마다 테두리를 그으면 바둑판이 된다
      g.fillStyle = css(edge);
      if (!up)    g.fillRect(0, 0, T, 1);
      if (!left)  g.fillRect(0, 0, 1, T + V.WH);
      if (!right) g.fillRect(T - 1, 0, 1, T + V.WH);
      if (!down)  g.fillRect(0, Y + T - 1, T, 1);
    });
  }


  // 상자 하나를 그린다.
  //
  // 판에 놓인 상자와 **밀려가는 상자**가 같은 그림을 써야 한다.
  // 두 군데에 따로 그리면 밀리기 시작하는 순간 상자가 다른 물건으로 바뀐다.
  //
  // 밀 수 있는 상자는 모양이 아니라 덧그린 쇠테로 구분한다. 실루엣까지 바꾸면
  // 어느 것이 밀리는지 외워야 하는데, 그건 규칙이 아니라 암기다.
  //
  // gx, gy 는 무늬를 고르는 데 쓰는 원래 칸이다. 밀려가는 동안에도 무늬가 안 바뀌게
  // 화면 자리와 따로 받는다 — 지나가면서 상자가 나무통에서 자루로 변하면 안 된다
  function paintCrate(g, px, py, T, gx, gy, box) {
    const th = placeAt(gx, gy);
    const dp = Math.max(1, Math.round(T / 16));
    const kinds = th.crateKinds || [th.crateKind || 'crate'];
    const ck = kinds[tileHash(gx, gy) % kinds.length];

    g.drawImage(bakeCrate(th, ck, box, dp), px, py - V.CH);
  }

  // 종이 안에서 윗변이 0, 칸의 윗변이 V.CH 자리다
  function bakeCrate(th, ck, box, dp) {
    const T = V.TS;
    // 종이는 위로 V.CH 올라가고 아래는 칸 바닥에서 끝난다
    return bakeProp('C:' + th.name + ':' + ck + ':' + (box ? 1 : 0) + ':' + dp + ':' + T,
                    T, V.CH + T, (g) => {
      const Y = V.CH;                       // 칸의 윗변

      // 바닥에 떨어뜨리는 그림자는 없앴다. 옆면이 생기기 전에는 그게 물건을
      // 땅에 붙여 보이게 하는 유일한 수단이었는데, 정작 물건과 그림자 사이가
      // 떠 있어서 반대 효과가 났다. 벽도 그림자 없이 옆면만으로 서 있다
      const rows = CRATE_DOTS[ck] || CRATE_DOTS.crate;
      const top = bakeTile('c:' + ck + ':' + th.name + ':' + dp, rows,
                           tonePal(th.crate), dp);
      blitTile(g, top, 0, 0, dp);

      // 옆면. **이게 없어서 상자가 공중에 떠 있었다.**
      //
      // 벽은 윗면을 V.WH 만큼 올리고 그 아래를 옆면으로 채워서 칸 바닥에 닿는다.
      // 상자는 윗면만 올리고 아래를 안 채웠다. 그래서 상자 아랫변이 칸 바닥보다
      // V.CH 만큼 위에 있었고, 그림자만 저 밑에 따로 깔려 있었다.
      // 물건과 그림자 사이가 비면 눈은 그걸 '떠 있다' 로 읽는다.
      //
      // 옆면 색을 팔레트에서 따로 가져와 네모로 칠했더니 두 가지가 어긋났다.
      // 색이 상자와 안 맞아 형광 띠가 됐고, 상자는 모서리가 깎여 있는데 네모는
      // 안 깎여서 좌우로 삐져나왔다.
      //
      // **그림의 맨 아랫줄을 아래로 늘린다.** 실루엣도 색도 저절로 맞는다.
      // 상자 무늬가 몇 가지든, 나중에 그림을 바꾸든 따로 손볼 게 없다
      g.imageSmoothingEnabled = false;
      g.drawImage(top, 0, 16 * dp - dp, 16 * dp, dp, 0, Y + T - V.CH, T, V.CH);

      // 늘린 자리를 어둡게. 옆면은 빛을 덜 받고, 바닥과 만나는 데가 제일 어둡다.
      // source-atop 이라 그림이 있는 데만 칠해진다 — 깎인 모서리 밖으로 안 샌다
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(0, Y + T - V.CH, T, V.CH);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      pr(g, 0, Y + T - V.CH * 0.45, T, V.CH * 0.45);
      g.globalCompositeOperation = 'source-over';

      if (!box) return;

      paintBands(g, 0, 0, T, T);
    });
  }

  // 밀 수 있는 상자에 두르는 쇠테 두 줄과 못 넷.
  //
  // 도트로 찍은 상자와 그림 타일이 **같은 표시**를 써야 한다. 두 군데에 따로
  // 그리면 장소에 따라 밀리는 것을 알아보는 방법이 달라진다.
  //
  // 자리를 칸 크기(T)로 잡고 있었다. 그림 타일은 칸보다 크고 종류마다 높이가
  // 달라서, 쇠테가 상자 위쪽 허공에 떠 있는 회색 막대로 보였다.
  // **받은 네모 안에서 비율로** 잡는다. 어떤 그림이 와도 상자 몸통에 걸린다
  function paintBands(g, bx, by, bw, bh) {
    const t = Math.max(1, Math.round(bh * 0.055));   // 테 두께
    const x0 = bx + bw * 0.06, w = bw * 0.88;
    const y0 = by + bh * 0.34, y1 = by + bh * 0.62;  // 위 테, 아래 테

    // 그늘 · 몸 · 빛 세 단. 한 단이면 스티커로 보인다
    g.fillStyle = 'rgba(60,68,82,0.95)';
    g.fillRect(x0, y0 - t, w, t);
    g.fillRect(x0, y1 - t, w, t);
    g.fillStyle = 'rgba(148,160,180,0.95)';
    g.fillRect(x0, y0, w, t);
    g.fillRect(x0, y1, w, t);
    g.fillStyle = 'rgba(90,100,118,0.95)';
    g.fillRect(x0, y0 + t, w, t);
    g.fillRect(x0, y1 + t, w, t);

    // 못 넷. 테 끝에 박는다
    g.fillStyle = 'rgba(228,236,248,0.95)';
    for (let i = 0; i < 4; ++i) {
      g.fillRect((i & 1) ? x0 + w - t * 2 : x0 + t, (i < 2) ? y0 : y1, t, t);
    }
  }


  // 밀려가는 상자. 화면 자리는 칸 사이 어디든 될 수 있다
  function drawCrate(g, sx, sy, T, gx, gy, box) {
    paintCrate(g, sx, sy, T, gx, gy, box);
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

  // ── 그림 아틀라스 ────────────────────────────────────────────
  //
  // 캐릭터는 도트를 찍는 대신 **그림 시트에서 오려 쓴다.**
  //
  // 9/3 까지 16x20 도트로 직접 찍었다. 픽셀 게임 자료를 찾아보며 세 번 고쳤는데,
  // 유명한 픽셀 게임과 나란히 놓고 재보니 차이가 숫자로 나왔다 —
  // 우리 채도가 두 배였고, 물건 하나에 쓰는 색이 6개인데 저쪽은 16개였다.
  // 16x20 안에서 그 격차를 좁히는 건 도트를 더 잘 찍어서 될 일이 아니었다.
  //
  // 그림은 따로 만들어서 파일로 받고, 코드는 그걸 오려 붙이는 일만 한다.
  // 시트가 바뀌면 tools/buildart.py 를 다시 돌리면 된다.
  //
  // **아직 안 왔으면 도트로 그린다.** 그림이 없다고 게임이 안 돌면 안 되고,
  // 도트 쪽은 시험이 다 걸려 있어서 그대로 두는 편이 안전하다
  // 아틀라스는 여러 장이다. chars 는 사람, fx 는 물풍선과 물줄기.
  // 한 장에 다 넣으면 사람이 늘 때마다 물줄기까지 다시 굽게 된다
  const atlases = {};

  function loadAtlas(key, pngUrl, jsonUrl, done) {
    // 브라우저가 아니면 아무것도 안 한다. 시험은 가짜 캔버스로 도는데
    // 거기엔 Image 도 fetch 도 없다. 그때는 도트로 그린다
    if (typeof Image === 'undefined' || typeof fetch === 'undefined') return;

    // 둘 다 와야 쓴다. 하나만 오면 아무것도 안 그려진다
    let img = null, map = null;
    const ready = () => {
      if (!img || !map) return;
      atlases[key] = { img: img, map: map };
      spriteCache.clear();
      if (done) done();
    };

    const im = new Image();
    im.onload = () => { img = im; ready(); };
    im.onerror = () => { /* 없으면 도트로 간다 */ };
    im.src = pngUrl;

    fetch(jsonUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.sprites) { map = j; ready(); } })
      .catch(() => { /* 없으면 도트로 간다 */ });
  }

  const hasAtlas = (key) => !!atlases[key];

  // 그림 하나를 원하는 높이로 줄여서 굽는다.
  //
  // 매 프레임 줄이면 24명 x 60프레임이라 너무 비싸고, 브라우저가 줄일 때마다
  // 조금씩 다르게 뭉갠다. 한 번 구워두면 붙이기만 하면 된다.
  //
  // 줄인 뒤 알파를 잘라내는 게 중요하다. 안 자르면 가장자리가 반투명해져서
  // 확대했을 때 뿌옇다 — 픽셀 그림이 픽셀로 안 보이는 제일 흔한 이유다.
  //
  // flip 을 주면 좌우나 상하로 뒤집어 굽는다. 물줄기 끝처럼 방향만 다른
  // 그림을 네 장씩 받을 이유가 없다
  // 판 타일 하나를 굽는다.
  //
  // 캐릭터와 담는 방식이 다르다. 캐릭터는 높이를 맞추면 되는데, 판 타일은
  // **가로가 한 칸**이고 높이는 그림이 정한다 - 나무는 한 칸 반, 가로등은 두 칸,
  // 집은 두 칸 폭이다. 색인의 다섯 번째 값이 몇 칸 폭인지다.
  //
  // 아랫변을 칸 바닥에 붙여 그리면 위로 솟는다. 앞뒤를 발밑 y 로 정하는
  // 규칙과 그대로 맞아서, 큰 나무 뒤에 선 사람은 저절로 가려진다
  function bakeTileSprite(name, T) {
    const A = atlases.tiles;
    if (!A) return null;
    const box = A.map.sprites[name];
    if (!box) return null;

    const w = Math.max(1, Math.round(T * box[4]));
    const key = 'T:' + name + ':' + w;
    let cv = spriteCache.get(key);
    if (cv) return cv;

    const h = Math.max(1, Math.round(box[3] * w / box[2]));
    cv = document.createElement('canvas');
    cv.width = w; cv.height = h;

    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true;   // 줄일 때는 켜야 계단이 안 생긴다
    c.drawImage(A.img, box[0], box[1], box[2], box[3], 0, 0, w, h);

    // 그림이 실제로 차지하는 네모를 같이 재둔다.
    //
    // 밀 수 있는 상자에 쇠테를 두를 때 칸 크기로 잡았더니, 그림이 칸보다 좁은
    // 종류(통, 항아리)에서 테가 상자 밖으로 삐져나왔다. 알파를 훑는 김에
    // 한 번 재두면 그릴 때마다 다시 안 재도 된다
    cv.op = { x: 0, y: 0, w: w, h: h };
    try {
      const d = c.getImageData(0, 0, w, h);
      const px = d.data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let i = 3, k = 0; i < px.length; i += 4, ++k) {
        const on = px[i] >= 110;
        px[i] = on ? 255 : 0;
        if (!on) continue;
        const cx = k % w, cy = (k / w) | 0;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
      }
      c.putImageData(d, 0, 0);
      if (x1 >= x0) cv.op = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    } catch (e) { /* 시험용 가짜 캔버스에는 픽셀이 없다 */ }

    spriteCache.set(key, cv);
    if (spriteCache.size > 900) spriteCache.clear();
    return cv;
  }

  function bakeFromAtlas(key, atlasKey, name, h, flipH, flipV) {
    let cv = spriteCache.get(key);
    if (cv) return cv;

    const A = atlases[atlasKey];
    if (!A) return null;
    const box = A.map.sprites[name];
    if (!box) return null;

    const w = Math.max(1, Math.round(box[2] * h / box[3]));
    cv = document.createElement('canvas');
    cv.width = w; cv.height = h;

    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = true;   // 줄일 때는 켜야 계단이 안 생긴다
    if (flipH || flipV) {
      c.translate(flipH ? w : 0, flipV ? h : 0);
      c.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    }
    c.drawImage(A.img, box[0], box[1], box[2], box[3], 0, 0, w, h);
    c.setTransform(1, 0, 0, 1, 0, 0);

    try {
      const d = c.getImageData(0, 0, w, h);
      const p = d.data;
      for (let i = 3; i < p.length; i += 4) p[i] = p[i] < 110 ? 0 : 255;
      c.putImageData(d, 0, 0);
    } catch (e) { /* 시험용 가짜 캔버스에는 픽셀이 없다 */ }

    spriteCache.set(key, cv);
    if (spriteCache.size > 900) spriteCache.clear();
    return cv;
  }
  // 물방울에 갇힌 사람.
  //
  // 물줄기에 맞으면 바로 안 죽고 갇힌다. 7초 동안 갇혀 있다가 누가 몸으로
  // 부딪치면 터지고 아니면 풀린다. 그 7초가 이 게임에서 제일 긴장되는 시간이라
  // 캔버스로 그린 물방울 대신 제대로 그린 그림을 쓴다.
  //
  // 세 프레임을 천천히 돌린다. 물방울이 살아 있는 것처럼 흔들려야
  // '아직 갇혀 있다' 가 계속 읽힌다
  function drawTrapped(g, cx, cy, r, animal, t) {
    if (!hasAtlas('trap')) return false;

    const idx = ((animal | 0) % CHAR_NAMES.length + CHAR_NAMES.length)
                % CHAR_NAMES.length;
    const name = CHAR_NAMES[idx] + '_trap' + (((t / 220) | 0) % 3);

    // 물방울은 사람보다 크다. 칸을 넘겨야 갇힌 것으로 보인다
    const h  = Math.max(10, Math.round(r * 2 * 1.55 / 2) * 2);
    const cv = bakeFromAtlas('T:' + name + ':' + h, 'trap', name, h);
    if (!cv) return false;

    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, Math.round(cx - cv.width / 2),
                    Math.round(cy + r * 0.5 - cv.height * 0.62));
    g.imageSmoothingEnabled = smooth;
    return true;
  }

  // 죽은 자세 · 터진 자세 · 빠져나온 자세.
  //
  // 갇힘 시트의 나머지 세 칸이다. 갇힌 그림과 같은 아틀라스에 들어 있다.
  //   free  물방울에서 스스로 빠져나왔다
  //   pop   몸으로 부딪쳐 터졌다
  //   ko    뻗었다. 이게 죽은 모습이다
  function drawPose(g, cx, cy, r, animal, kind, alpha) {
    if (!hasAtlas('trap')) return false;

    const idx = ((animal | 0) % CHAR_NAMES.length + CHAR_NAMES.length)
                % CHAR_NAMES.length;
    const name = CHAR_NAMES[idx] + '_' + kind;

    const h  = Math.max(10, Math.round(r * 2 * 1.4 / 2) * 2);
    const cv = bakeFromAtlas('P:' + name + ':' + h, 'trap', name, h);
    if (!cv) return false;

    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    if (alpha !== undefined) g.globalAlpha = alpha;
    g.drawImage(cv, Math.round(cx - cv.width / 2),
                    Math.round(cy + r * 0.5 - cv.height * 0.6));
    g.globalAlpha = 1;
    g.imageSmoothingEnabled = smooth;
    return true;
  }

  // 물줄기 한 칸을 그린다.
  //
  // 통짜 십자 그림 하나로는 못 그린다. 사거리가 아이템으로 1칸에서 6칸까지
  // 늘어나서 십자 크기가 매판 다르기 때문이다. 가운데 · 팔 · 끝 세 조각을
  // 이웃을 보고 골라서 이어 붙인다.
  //
  // 끝 조각은 한 방향짜리만 받아서 뒤집어 쓴다. 방향마다 그림을 따로 받으면
  // 네 장이 미묘하게 달라져서 십자가 안 맞물린다.
  //
  // hit(x,y) 는 그 칸에 물줄기가 있나. 아직 안 뻗은 칸은 없는 것으로 친다 —
  // 그래야 물이 자라는 동안에도 끝이 끝으로 보인다
  // 물줄기 한 칸.
  //
  // **어디까지 닿는지가 한눈에 보여야 한다.** 그게 이 그림의 유일한 임무다.
  // 예쁜 것은 그다음이고, 예쁘게 만들다 사거리가 안 읽히면 진 것이다.
  //
  // 그림 시트에서 가운데·팔·끝 조각을 잘라 이어 붙여 봤다. 안 됐다.
  // 조각마다 둥근 외곽선과 물방울이 있어서 이어 붙이면 마디가 보였고,
  // 마디를 지우려고 3할 키워 겹쳤더니 이번엔 사거리보다 넓어 보였다.
  // 조각이 오밀조밀해서 십자 모양 자체가 안 읽히기도 했다.
  //
  // 그려서 만든다. 규칙이 하나뿐이라 어느 배율에서도 안 어긋난다 —
  // **물줄기가 이어지는 쪽으로는 칸 끝까지, 안 이어지는 쪽으로는 여백을 둔다.**
  // 그러면 이음매가 아예 생길 수 없고, 십자 바깥이 하나의 실루엣이 된다.
  //
  // 세 겹이다. 테두리 · 몸 · 심. 겹마다 여백을 한 픽셀씩 더 줘서 안으로 들어간다.
  // 끝 쪽은 그 여백이 그대로 뾰족해지는 효과를 내서 따로 끝 조각을 안 그려도 된다
  function drawBlastTile(g, px, py, T, hit, x, y, alpha, heat) {
    const P = V.P;
    const q = (v) => Math.round(v / P) * P;

    const L = hit(x - 1, y), R = hit(x + 1, y);
    const U = hit(x, y - 1), D = hit(x, y + 1);
    const lone = !L && !R && !U && !D;

    // 몸통 두께. 칸의 8할쯤이 남는다.
    // 더 두꺼우면 십자의 안쪽 모서리가 메워져서 네모로 보이고,
    // 더 얇으면 물줄기가 아니라 선으로 보인다
    const t0 = Math.max(P, q(T * 0.10));

    const h = heat || 0;
    const LAYER = [
      // 테두리. 판에서 제일 어두운 파랑이라 어느 바닥 위에서도 물줄기가 뜬다
      { d: 0,     c: [20 + h * 30, 78 + h * 40, 150 + h * 40] },
      { d: P,     c: [70 + h * 90, 168 + h * 70, 236 + h * 19] },
      { d: P * 3, c: [200 + h * 55, 240 + h * 15, 255] },
    ];

    for (const ly of LAYER) {
      const t = t0 + ly.d;
      if (t * 2 >= T) break;                  // 심이 들어갈 자리가 없다. 여기서 끝

      g.fillStyle = 'rgba(' + Math.round(ly.c[0]) + ',' + Math.round(ly.c[1])
                  + ',' + Math.round(ly.c[2]) + ',' + alpha + ')';

      // 가로 팔. 이어지는 쪽은 칸 끝까지 간다 — 그래서 옆 칸과 딱 붙는다
      if (L || R || lone) {
        const x0 = L ? 0 : t, x1 = R ? T : T - t;
        g.fillRect(px + x0, py + t, x1 - x0, T - t * 2);
      }
      // 세로 팔
      if (U || D || lone) {
        const y0 = U ? 0 : t, y1 = D ? T : T - t;
        g.fillRect(px + t, py + y0, T - t * 2, y1 - y0);
      }
    }

    return true;
  }

  // 사람 스물넷에 캐릭터 스물넷. 자리 번호가 곧 캐릭터다
  const CHAR_NAMES = [
    'red', 'blue', 'pink', 'frog', 'miner', 'cat', 'panda', 'penguin',
    'tech', 'cowboy', 'bunny', 'dino', 'space', 'witch', 'shark', 'ninja',
    'chef', 'fox', 'vampire', 'unicorn', 'pilot', 'devil', 'angel', 'robot',
  ];

  // 방향 번호를 시트의 글자로. FaceDir 은 0 아래 1 왼 2 오른 3 위다
  const FACE_KEY = ['d', 'l', 'r', 'u'];

  // 걷기 세 프레임을 0-1-2-1 로 돈다.
  // 0-1-2 로만 돌리면 2 에서 0 으로 튈 때 다리가 순간이동한다.
  // 갔다 오는 순서면 발이 이어져 보인다
  const WALK_ORDER = [0, 1, 2, 1];
  const SPRITE_FRAMES = 8;

  // ── 사람을 도트로 찍는다 ────────────────────────────────────
  //
  // 16x18 에 다리 두 줄, 머리 위 장식 세 줄이 더 붙는다.
  //
  // 머리와 몸과 다리가 한 덩어리여야 한다. 처음에는 셋을 따로 그리고 사이에
  // 외곽선 줄을 넣었는데, 그러니 머리가 몸 위에 얹힌 세 개의 물건으로 보였다.
  // 목과 어깨가 이어져 있어야 사람으로 읽힌다.
  //
  // 눈은 검은 점 하나가 아니라 어두운 칸과 흰 반짝 두 칸으로 찍는다.
  // 반짝이 없으면 인형이고 있으면 사람이 된다. 16픽셀 안에서 값이 제일 큰 두 점이다.
  //
  // 빛은 왼쪽 위에서 온다. 그래서 왼쪽이 밝고 오른쪽에 그늘이 진다.
  //
  //   o 외곽선  H 모자 밝은 면  h 모자  m 모자 그늘
  //   S 살결 밝은 면  s 살결  d 살결 그늘  e 눈  W 눈 반짝  q 입
  //   B 몸 밝은 면  b 몸(팀색)  0 몸 깊은 그늘  F 신발  k 장식 강조
  const CHAR_BODY = {
    'down': [
      '.....oooooo.....',
      '...ooHHHHHHoo...',
      '..oHHHHHHHHhho..',
      '.oHHHHHHHHhhhho.',
      '.oHHHHHHHhhhhmo.',
      '.ohhSSSSssssdmo.',
      '.oSSSSSssssssdo.',
      '.oSSWeSssSWeSdo.',
      '.oSSSSSssssssdo.',
      '.oSSSSsqqsssSdo.',
      '..oSSssssssddo..',
      '...ooosssooooo..',
      '..oBBoossoo0Bo..',
      '.oBBBbbbbbbb0Bo.',
      'soBBbbbbbbbbb0os',
      'soBB00000000b0os',
      '.oBbbbbbbbbbb0o.',
      '..oBbbbbbbbb00..',
    ],
    'side': [
      '.....oooooo.....',
      '...ooHHHHHHoo...',
      '..oHHHHHHHHhho..',
      '.oHHHHHHHHhhhho.',
      '.oHHHHHHHhhhhmo.',
      '.ohhSSSSsssssmo.',
      '.oSSSSSSssssddo.',
      '.oSSSSSSsWeSddo.',
      '.oSSSSSSsssdddo.',
      '.oSSSSSSqqsdddo.',
      '..oSSSsssssddo..',
      '...ooosssooooo..',
      '..oBBoossoo0Bo..',
      '.oBBBbbbbbbb0Bo.',
      '.oBBbbbbbbbbb0os',
      '.oBB00000000b0os',
      '.oBbbbbbbbbbb0o.',
      '..oBbbbbbbbb00..',
    ],
    'up': [
      '.....oooooo.....',
      '...ooHHHHHHoo...',
      '..oHHHHHHHHhho..',
      '.oHHHHHHHHhhhho.',
      '.oHHHHHHHhhhhmo.',
      '.oHHHHHHHhhhhmo.',
      '.oooooooooooooo.',
      '.ohhhhhhhhhhmmo.',
      '.ohhhohhhhohhmo.',
      '..ohhhhhhhhmmo..',
      '...oohhhhhmmo...',
      '...ooosssooooo..',
      '..oBBoossoo0Bo..',
      '.oBBBbbbbbbb0Bo.',
      'soBBbbbbbbbbb0os',
      'soBB00000000b0os',
      '.oBbbbbbbbbbb0o.',
      '..oBbbbbbbbb00..',
    ],
  };

  // 다리 두 줄만 갈아 끼운다. 몸통까지 다시 그릴 이유가 없고,
  // 발이 번갈아 뜨는 것만으로 걷는 것으로 읽힌다
  const CHAR_LEGS = {
    'idle': [
      '..ooFFFooFFFoo..',
      '...oFFo...oFFo..',
    ],
    'a': [
      '..ooFFFooFFFoo..',
      '...oFFo....ooo..',
    ],
    'b': [
      '..ooFFFooFFFoo..',
      '...ooo....oFFo..',
    ],
  };
  // 머리 위 장식 여덟 가지.
  //
  // 색만으로는 24명을 못 가른다. 여덟 색을 세 번 돌려 쓰는 데다,
  // 화면이 작아지면 옆 사람과 색이 섞여 보인다.
  // **실루엣이 다르면 색이 안 보여도 구분된다** — 픽셀 게임이 캐릭터마다
  // 머리 모양을 바꾸는 이유가 그것이다. 몸을 바꾸면 실루엣이 무너지니 머리만 바꾼다.
  //
  // 위 세 줄에만 덮어 그린다. 얼굴은 건드리지 않는다
  const CHAR_HATS = [
    [
      '................',
      '................',
      '................',
    ],
    [
      '..oo........oo..',
      '..oHo......oHo..',
      '..oHHo....oHHo..',
    ],
    [
      '.......oo.......',
      '.......ok.......',
      '......okko......',
    ],
    [
      '................',
      '................',
      '.oooooooooooooo.',
    ],
    [
      '.....o....o.....',
      '.....k....k.....',
      '................',
    ],
    [
      '.......oo.......',
      '......oHHo......',
      '......oHHo......',
    ],
    [
      '....o..oo..o....',
      '....ok.oo.ko....',
      '...okk.oo.kko...',
    ],
    [
      '...o......o.....',
      '...ok.....ok....',
      '...okk....okk...',
    ],
  ];
  // 자세 하나를 종이에 굽는다. 도트를 그대로 찍으므로 확대해도 도트로 남는다
  function bakeChar(key, hex, o) {
    let sp = spriteCache.get(key);
    if (sp) return sp;

    // 옆을 볼 때는 오른쪽 것을 뒤집어 쓴다. 왼쪽 지도를 따로 그리면
    // 두 장이 미묘하게 달라져서 방향을 바꿀 때 흔들린다
    const face = o.face | 0;                       // 0 아래 1 오른 2 위 3 왼
    const key3 = (face === 2) ? 'up' : (face === 0 ? 'down' : 'side');
    const flip = (face === 3);

    const legs = o.moving ? ((o.frame & 2) ? 'b' : 'a') : 'idle';
    const rows = CHAR_BODY[key3].concat(CHAR_LEGS[legs]);

    const W = 16, TOP = 3, H = rows.length + TOP;   // 장식이 올라갈 자리 세 줄
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const c = cv.getContext('2d');

    // 팀색과 살결을 각각 다섯 단으로 편다.
    //
    // 팀색은 모자와 몸 두 군데에 들어간다. 한 군데면 24명 중에 누가 누군지
    // 안 보이고, 온몸이면 실루엣이 뭉개진다
    const bs = ramp(hex);
    const sk = ramp(o.dead ? '#9aa2b0' : '#f0c9a0');

    const pal = {
      '.': null,
      'o': css(outlineOf(hex)),
      'H': css(bs[4]), 'h': css(bs[3]), 'm': css(bs[1]),
      'S': css(sk[3]), 's': css(sk[2]), 'd': css(sk[1]),
      'e': 'rgba(26,24,34,0.96)', 'W': '#ffffff', 'q': css(sk[0]),
      'B': css(bs[3]), 'b': css(bs[2]), 'c': css(bs[1]), '0': css(bs[0]),
      'F': '#4a3e36', 'f': '#2e2622',
      'k': css(bs[4]),
    };

    // 물에 갇히면 온몸이 파랗게 뜬다. 색을 바꾸는 게 아니라 **눈금을 옮긴다** —
    // 팀색은 그대로 두고 밝기만 올려야 누구인지 계속 읽힌다
    if (o.danger) {
      pal['H'] = css(light(bs[4], 0.45));
      pal['h'] = css(light(bs[3], 0.45));
      pal['B'] = css(light(bs[3], 0.45));
      pal['b'] = css(light(bs[2], 0.45));
      pal['c'] = css(bs[2]);
      pal['0'] = css(bs[1]);
    }
    for (let y = 0; y < rows.length; ++y) {
      const row = rows[y];
      for (let x = 0; x < W; ++x) {
        const col = pal[row[flip ? (W - 1 - x) : x]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x, y + TOP, 1, 1);
      }
    }

    // 머리 위 장식. 사람마다 다른 실루엣이 여기서 나온다.
    // 3줄까지 위로 넘칠 수 있어 지도를 위로 세 줄 밀어 그렸다
    const hat = CHAR_HATS[((o.animal | 0) % CHAR_HATS.length + CHAR_HATS.length)
                          % CHAR_HATS.length];
    for (let y = 0; y < 3; ++y) {
      const row = hat[y];
      for (let x = 0; x < W; ++x) {
        const col = pal[row[flip ? (W - 1 - x) : x]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x, y, 1, 1);
      }
    }

    // 머리 꼭대기 한 줄에 빛. 위에서 빛이 온다는 걸 말하는 한 줄이고,
    // 24명이 겹쳐 있을 때 앞뒤를 가르는 것도 이 줄이다
    c.fillStyle = 'rgba(255,255,255,0.30)';
    c.fillRect(5, TOP + 1, 6, 1);

    // 사람의 발이 닿는 자리. 밑 몇 줄인지 알아야 바닥에 세울 수 있다
    sp = { cv: cv, sw: W, sh: H, foot: H - 1, mid: 11 + TOP };
    spriteCache.set(key, sp);
    if (spriteCache.size > 900) spriteCache.clear();
    return sp;
  }
  // 그림 아틀라스에서 오려 그린다. 그릴 수 있었으면 true.
  //
  // 사람 키는 타일의 1.25 배로 잡는다. 크아가 그 비율이고, 머리가 타일 위로
  // 조금 올라와야 상자 뒤에 있어도 누가 있는지 보인다.
  //
  // 발이 cy 보다 조금 아래에 오게 세운다. cy 는 몸의 중심이고 사람은 중심보다
  // 발이 아래에 있다. 이 값이 어긋나면 바닥에 떠 보인다
  function drawCharSprite(g, cx, cy, r, o, frame) {
    const idx  = ((o.animal | 0) % CHAR_NAMES.length + CHAR_NAMES.length)
                 % CHAR_NAMES.length;
    const face = FACE_KEY[(o.face | 0) & 3] || 'd';
    const f    = o.moving ? WALK_ORDER[frame & 3] : 0;
    const name = CHAR_NAMES[idx] + '_' + face + f;

    // 타일 한 칸이 2r 이다. 키는 그 1.25 배이되 짝수로 맞춘다 —
    // 홀수면 가운데 정렬에서 반 픽셀이 남아 흐려진다
    const h  = Math.max(8, Math.round(r * 2 * 1.25 / 2) * 2);
    const cv = bakeFromAtlas(name + ':' + h, 'chars', name, h);
    if (!cv) return false;

    const dx = Math.round(cx - cv.width / 2);
    // 발을 칸 바닥보다 조금 아래에 둔다.
    //
    // 카메라가 살짝 아래에서 보는 각도다. 그래서 아래 칸에 놓인 것이 위 칸
    // 사람의 발과 정강이를 가려야 한다. 발이 칸 경계에 딱 맞으면 아무것도
    // 안 가려서 사람이 판 위에 붕 떠 보인다
    const dy = Math.round(cy + r * 1.5 - cv.height);

    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;

    // 갇히면 하얗게 뜬다. 아직 갇힌 그림이 없어서 밝기로만 알린다
    if (o.danger) {
      g.globalAlpha = 0.85;
    }
    g.drawImage(cv, dx, dy);
    g.globalAlpha = 1;

    g.imageSmoothingEnabled = smooth;
    return true;
  }

  function drawChar(g, cx, cy, r, hex, o) {
    const moving = !!o.moving;

    // 걸음을 네 토막으로 끊는다. 이어지는 값이면 자세가 무한히 많아져 구울 수가 없다
    const frame = moving
      ? ((Math.floor((o.walk || 0) / (Math.PI * 2) * 4) % 4) + 4) % 4
      : 0;

    // 그림이 있으면 그림으로 그린다. 없으면 아래 도트로 내려간다
    if (hasAtlas('chars') && drawCharSprite(g, cx, cy, r, o, frame)) return;

    // 도트 크기는 타일에 맞춘다. 사람이 16 점 폭이고 타일이 16 점이라,
    // 같은 눈금을 쓰면 사람과 바닥의 도트가 어긋나지 않는다.
    // 이게 어긋나면 사람만 다른 해상도로 보여서 붙여넣은 것처럼 뜬다
    const P = Math.max(1, Math.round(r * 2 / 16));

    const key = [hex, o.face | 0, o.animal | 0, moving ? 1 : 0, frame,
                 o.danger ? 1 : 0, o.dead ? 1 : 0].join(',');
    const sp = bakeChar(key, hex, { face: o.face, animal: o.animal, moving: moving, frame: frame,
                                    danger: o.danger, dead: o.dead });

    // 발이 cy 보다 조금 아래에 오게 세운다. cy 는 몸의 중심이고
    // 사람은 중심보다 발이 아래에 있다. 이 값이 어긋나면 바닥에 떠 보인다
    const dx = Math.round((cx - sp.sw * P / 2) / P) * P;
    const dy = Math.round((cy - sp.mid * P) / P) * P;

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
  // ── 물풍선을 도트로 찍는다 ─────────────────────────────────
  //
  // 원 위에 방사형 그라데이션을 얹어 그렸다. 유리구슬처럼 매끈했고,
  // 판의 다른 것들을 도트로 바꾸고 나니 **물풍선만 다른 게임 것** 같았다.
  //
  // 14x14 다. 타일이 16 점이니 한 칸 안에 여유 있게 들어간다.
  // 반짝을 두 점 찍고 오른쪽 아래로 갈수록 색을 내려서 둥글게 읽히게 한다 —
  // 픽셀에서 둥근 것은 곡선이 아니라 **명암 계단**으로 만든다.
  //
  //   o 테두리  h 밝은 물  b 물  d 깊은 물  w 반짝  n 놓은 사람 색
  const BUBBLE_DOTS = [
      '....oooooo....',
      '..oohhhhhhoo..',
      '.ohhwwhhhhbbo.',
      'ohhwwwhhhhbbbo',
      'ohhwwhhhhhbbbo',
      'ohhhhhhhhbbbbo',
      'ohhhhhhhbbbbdo',
      'obhhhhhbbbbddo',
      'obbhhhbbbbdddo',
      'obbbbbbbbdddwo',
      '.obbbbbdddddo.',
      '..oodddddddo..',
      '....oonnnoo...',
      '.....oooo.....',
  ];
  const bubCache = new Map();

  function bakeBubble(key, P, near, hex) {
    let cv = bubCache.get(key);
    if (cv) return cv;

    const W = 14;
    cv = document.createElement('canvas');
    cv.width = W * P; cv.height = W * P;
    const c = cv.getContext('2d');

    // 곧 터지면 빨강으로 간다. **색이 바뀌는 게 아니라 색상만 돈다** —
    // 명암 계단은 그대로 둬야 같은 물건이 익은 것으로 읽힌다
    const pal = near ? {
      '.': null,
      'o': 'rgba(64,12,16,0.95)',
      'h': '#ffd8d2', 'b': '#f0645c', 'd': '#a81f28', 'w': '#fffaf8',
    } : {
      '.': null,
      'o': 'rgba(10,26,52,0.95)',
      'h': '#d6f2ff', 'b': '#4aa8e8', 'd': '#1d5aa0', 'w': '#ffffff',
    };
    // 놓은 사람 색을 밑동 세 점에 넣는다. 누가 놓은 것인지 알아야
    // 피할지 밟을지가 정해진다. 아래에 두는 건 위쪽 반짝을 안 가리려는 것이다
    pal['n'] = hex || pal['d'];

    for (let y = 0; y < W; ++y) {
      const row = BUBBLE_DOTS[y];
      for (let x = 0; x < W; ++x) {
        const col = pal[row[x]];
        if (!col) continue;
        c.fillStyle = col;
        c.fillRect(x * P, y * P, P, P);
      }
    }

    bubCache.set(key, cv);
    if (bubCache.size > 160) bubCache.clear();
    return cv;
  }

  // 물풍선. 그림이 있으면 그림으로.
  //
  // 숨쉬기는 그림 세 장을 갈아 끼워서 만든다. 크기를 실수배로 늘리면
  // 도트가 뭉개져서 매끈한 그림으로 되돌아간다.
  // 곧 터질 때는 빨간 것으로 바꾼다 — 색이 바뀌는 게 제일 빨리 읽힌다
  function drawBubbleSprite(g, cx, cy, r, near, t, hex) {
    const T = Math.max(8, Math.round(r * 2.2));

    let name;
    if (near) {
      // 곧 터진다. 빨간 것과 제일 부푼 것을 빠르게 번갈아 보여준다
      name = ((t / 90) | 0) % 2 ? 'balloon_hot' : 'balloon2';
    } else {
      name = ['balloon0', 'balloon1', 'balloon2'][((t / 260) | 0) % 3];
    }

    const cv = bakeFromAtlas(name + ':' + T, 'fx', name, T);
    if (!cv) return false;

    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;

    // 그림자. 물풍선이 바닥에 놓인 것으로 읽히게 하는 한 줄이다
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fillRect(Math.round(cx - T * 0.30), Math.round(cy + T * 0.30),
               Math.round(T * 0.60), Math.max(2, Math.round(T * 0.10)));

    g.drawImage(cv, Math.round(cx - cv.width / 2), Math.round(cy - cv.height / 2));

    // 놓은 사람 색을 밑동에 얇게. 누가 놓은 것인지 알아야 피할지 밟을지 정해진다
    if (hex) {
      g.fillStyle = hex;
      g.fillRect(Math.round(cx - T * 0.22), Math.round(cy + T * 0.24),
                 Math.round(T * 0.44), Math.max(2, Math.round(T * 0.08)));
    }

    g.imageSmoothingEnabled = smooth;
    return true;
  }

  function drawBubble(g, cx, cy, r, near, t, hex) {
    if (hasAtlas('fx') && drawBubbleSprite(g, cx, cy, r, near, t, hex)) return;

    // 숨쉬기는 **크기가 아니라 도트 수**로 준다.
    //
    // 전에는 1.26 배까지 부드럽게 늘렸다. 도트 그림을 실수배로 늘리면
    // 점이 뭉개져서 매끈한 그림으로 되돌아간다.
    // 배율을 정수로만 바꾸면 부푸는 게 계단으로 보이는데, 그게 오히려 픽셀답고
    // 곧 터진다는 신호로도 더 세게 읽힌다
    const beat = Math.sin(t / (near ? 38 : 200));
    const P0 = Math.max(1, Math.round(r * 2 / 14));
    const P = (near && beat > 0.35) ? P0 + 1 : P0;

    const cv = bakeBubble([near ? 1 : 0, P, hex || ''].join(','), P, near, hex);
    const w = 14 * P;

    // 그림자. 도트 배율에 맞춘 납작한 네모다. 타원을 쓰면 여기만 매끈해진다
    g.fillStyle = 'rgba(0,0,0,0.30)';
    g.fillRect(Math.round((cx - w * 0.36) / P) * P,
               Math.round((cy + w * 0.36) / P) * P,
               Math.round(w * 0.72 / P) * P, P * 2);

    const dx = Math.round((cx - w / 2) / P) * P;
    const dy = Math.round((cy - w / 2) / P) * P;

    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(cv, dx, dy);
    g.imageSmoothingEnabled = smooth;
  }
  // ── 도트 숫자 ────────────────────────────────────────────────
  //
  // HUD 숫자를 브라우저 글꼴로 찍고 있었다. 판은 픽셀 아트인데 숫자만
  // 현대 산세리프라 **두 개가 다른 게임처럼 보였다.**
  // 글꼴 파일을 받아오지 않는다 — 숫자 열 개와 기호 둘이면 직접 찍는 게 빠르고,
  // 받아온 글꼴은 늦게 오면 그 사이에 다른 글꼴로 한 번 그려진다.
  //
  // 5x7 이다. 이보다 작으면 6 과 8 이 헷갈리고, 크면 격자가 거칠어 보인다
  const GLYPH = {
    '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['#..#.', '#..#.', '#..#.', '#####', '...#.', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
    ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
    '/': ['....#', '...#.', '...#.', '..#..', '.#...', '.#...', '#....'],
  };

  // 글자 하나를 종이에 구워둔다.
  //
  // 점을 매 프레임 찍으면 숫자 하나에 fillRect 가 서른다섯 번이고,
  // HUD 에 숫자가 여럿이라 프레임당 수백이 된다. clienttest 가 바로 잡았다.
  // 아이템 도트와 같은 처리다 — 한 번 굽고 그다음엔 붙이기만 한다
  const glyphCache = new Map();

  function bakeGlyph(ch, P, color) {
    const key = ch + ':' + P + ':' + color;
    let cv = glyphCache.get(key);
    if (cv) return cv;

    const rows = GLYPH[ch];
    cv = document.createElement('canvas');
    cv.width = 5 * P; cv.height = 7 * P;

    if (rows) {
      const c = cv.getContext('2d');
      c.fillStyle = color;
      for (let r = 0; r < 7; ++r) {
        for (let x = 0; x < 5; ++x) {
          if (rows[r][x] === '#') c.fillRect(x * P, r * P, P, P);
        }
      }
    }

    glyphCache.set(key, cv);
    if (glyphCache.size > 400) glyphCache.clear();
    return cv;
  }

  // 숫자를 찍는다. height 는 한 점의 크기가 아니라 글자 높이다
  function dotText(g, text, x, y, height, color, align) {
    const P = Math.max(1, Math.round(height / 7));
    const cw = P * 6;                       // 글자 하나 폭 + 사이 한 칸
    const total = text.length * cw - P;

    let sx = x;
    if (align === 'center') sx = x - total / 2;
    else if (align === 'right') sx = x - total;
    sx = Math.round(sx / P) * P;
    const sy = Math.round(y / P) * P;

    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    for (let i = 0; i < text.length; ++i) {
      if (!GLYPH[text[i]]) continue;
      g.drawImage(bakeGlyph(text[i], P, color), sx + i * cw, sy);
    }
    g.imageSmoothingEnabled = smooth;

    return total;
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
    // 물풍선을 하나 더 들 수 있다. **두 개**를 그린다.
    // 하나만 그리면 그건 물풍선 그 자체지 '하나 더' 가 아니다
    1: {
      '.': null, 'w': '#ffffff', 'O': '#a8ddff', 'o': '#4aa8e8', 'b': '#1d5aa0', 'k': '#0a1a34',
      rows: [
        '....kkkk.....',
        '..kkOOOOkk...',
        '.kOOwwOOObk..',
        '.kOwwOOOObk..',
        '.kOOOOOObbk..',
        '.kOOOOObbbk..',
        '..kOOObbbk...',
        '...kkkkkk.kk.',
        '.......kkOOkk',
        '......kOwwOOk',
        '......kOOOObk',
        '.......kOObk.',
        '........kkk..',
      ],
    },
    // 물줄기가 길어진다. **판에서 터지는 모양 그대로** 십자를 그린다.
    //
    // 전에는 위로 뻗는 화살표였다. 화살표는 '올라간다' 는 뜻이지
    // '물줄기가 길어진다' 는 뜻이 아니다. 판 어디에도 화살표처럼 생긴 게 없으니
    // 이 아이콘이 무엇을 가리키는지 배울 데가 없었다.
    // 물줄기는 십자로 터진다. 그 십자를 그대로 그리면 배울 필요가 없다
    2: {
      '.': null, 'w': '#ffffff', 'O': '#9ad7ff', 'o': '#4aa8e8', 'b': '#2f8fd8', 'k': '#0a2a4a',
      rows: [
        '.....kkk.....',
        '....kOOOk....',
        '....kObOk....',
        '.kkkkObOkkkk.',
        'kOOOOObOOOOOk',
        'kOObbbbbbbOOk',
        'kbbbbbbbbbbbk',
        'kOObbbbbbbOOk',
        'kOOOOObOOOOOk',
        '.kkkkObOkkkk.',
        '....kObOk....',
        '....kOOOk....',
        '.....kkk.....',
      ],
    },
    // 빨라진다. **번개**다.
    //
    // 바퀴를 그렸는데 아무도 못 알아봤다. 11 점짜리 바퀴는 그냥 동그라미고,
    // 이 게임에는 탈것이 없어서 바퀴가 뭘 뜻하는지 짐작할 근거가 없다.
    // 번개는 배울 게 없는 기호다. 실루엣도 십자·물방울과 안 겹친다
    3: {
      '.': null, 'w': '#ffffff', 'O': '#ffe066', 'o': '#fcc419', 'b': '#e8940c', 'k': '#5a3400',
      rows: [
        '........kkk..',
        '.......kOOk..',
        '......kOOk...',
        '.....kOOk....',
        '....kOOk.....',
        '...kOOkkkk...',
        '...kOOOOOk...',
        '...kkkkOOk...',
        '.....kOOk....',
        '....kOOk.....',
        '...kOOk......',
        '..kOk........',
        '..kk.........',
      ],
    },
    // 대쉬. **오른쪽으로 밀려 나가는 쐐기 둘** 이다.
    //
    // 다른 셋과 뜻이 다르다 — 물풍선·물줄기·속도는 수치가 오르는 것이고,
    // 이것은 새 동작이 열리는 것이다. 그래서 물건이 아니라 움직임을 그린다.
    //
    // 처음엔 잔상이 뒤에 남는 화살을 그렸다. 13 점 안에 선이 다섯 줄이라
    // 확대하기 전에는 그냥 얼룩이었다. **점이 적으면 선도 적어야 한다.**
    // 선 넷으로 줄이고 나니 작게 그려도 방향이 보인다
    5: {
      '.': null, 'O': '#c7f5ff', 'o': '#5ad2f0', 'b': '#1a9fc7', 'k': '#0c3a52',
      rows: [
        '.............',
        'kk.....kk....',
        'kOk....kOk...',
        '.kOk....kOk..',
        '..kOk....kOk.',
        '...kOk....kOk',
        '....kOk....kO',
        '...kOk....kOk',
        '..kOk....kOk.',
        '.kOk....kOk..',
        'kOk....kOk...',
        'kk.....kk....',
        '.............',
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
    PLACES, WORLDS, ANIMALS, V, setScale, setPlaces, setLanes, isLane, placeAt, placeNames, hash2, rr,
    loadAtlas, hasAtlas, CHAR_NAMES, drawBlastTile, drawTrapped, drawPose,
    buildFloor, drawProp, water, foamEdge,
    drawChar, drawFace, drawBubble, drawItem, drawCrate, ITEM_ART, dotText,
    rgb, css, mix, lighter, darker,
    easeOut, easeIn, overshoot,
  };
})();
