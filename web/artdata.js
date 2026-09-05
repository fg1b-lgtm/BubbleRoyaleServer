// web/artdata.js — 이 게임이 무엇으로 그려지는가
//
// 그리는 **규칙**은 art.js 에 있고, 그리는 **그림**은 여기 있다.
//
// 나누기 전에는 art.js 가 3368줄이었다. 그중 천 줄이 도트 지도와 장소 표라,
// 규칙을 고치려고 파일을 열면 판다 그림 한가운데에 떨어졌다.
// 둘은 고치는 이유가 다르다 - 규칙은 앞뒤 순서가 틀렸을 때 고치고,
// 그림은 눈으로 보고 마음에 안 들 때 고친다.
//
// 여기 있는 것은 전부 **자료**다. 함수가 하나도 없다.
// 도트 지도의 글자 하나가 화면의 점 하나이고, 글자가 무슨 색인지는
// art.js 의 팔레트가 정한다. 그래서 같은 널빤지 무늬가 마을에서는 초록 담이
// 되고 부두에서는 남색 판이 된다.
const ART_DATA = (() => {

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
               big:   [{ name: 'house', w: 2, h: 2 }, { name: 'well', w: 2, h: 2 }],
               crate: ['crate_plain'],      // 부서지는 것
               push:  ['crate_x'],          // 밀리는 것. X 가 그려져 있다
               // 강이 두 칸 폭이라 왼쪽 바깥·오른쪽 바깥에 각각 돌둑이 있는
               // 그림을 따로 쓴다(art.js 의 drawProp 이 옆 칸을 보고 고른다).
               // water 는 폭이 셋 이상일 때 가운데 칸에 쓰는 기본값이다
               water: 'water_04', waterLeft: 'water_14', waterRight: 'water_16',
               bridge: 'bridge_h' },
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
      // desert17 세트로 갈아끼웠다.
      //
      // 바닥이 넷이다(모래 A~D). 하나만 계속 깔면 판이 아니라 벽지로 보인다 —
      // 벽 · 상자와 같은 규칙으로 칸 자리에서 하나를 고정으로 고른다.
      //
      // 조형물이 여섯 가지다. 유적 기둥 · 오벨리스크 · 부서진 원기둥 ·
      // 꽃 선인장 · 바위더미 · 돌블록. 종류가 많을수록 판이 지루하지 않다 -
      // 같은 게 두 번 연속 안 나온다.
      //
      // 9/4 - 깃발(banner) · 뼈 유적(skeleton) · 아치(arch)는 빼달라는
      // 요청으로 뺐다. 뼈 유적은 큰 그림(big) 쪽에도 있었는데 그것도 같이
      // 뺐다 - SectorTemplates.h 의 DESERT_BAZAAR landmark 목록에서도 지웠다
      tiles: { floor: ['desert17_sand_a', 'desert17_sand_b',
                       'desert17_sand_c', 'desert17_sand_d'],
               wall:  ['desert17_ruin_pillar', 'desert17_obelisk', 'desert17_short_column',
                       'desert17_cactus', 'desert17_rock_pile', 'desert17_stone_block'],
               big:   [{ name: 'desert17_tent', w: 2, h: 2 },
                       { name: 'desert17_bazaar', w: 2, h: 2 }],
               crate: ['desert17_crate'],
               push:  ['desert17_xcrate'],
               water: 'desert_water_06', bridge: 'desert_bridge_h' },
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
      tiles: { floor: ['snow_floor_a', 'snow_floor_b', 'snow_floor_c', 'snow_floor_d'],
               wall: ['snow_wall_rock', 'snow_wall_ice', 'snow_boulder_tall',
                      'snow_pillar_tall', 'snow_pillar_short', 'snow_sign',
                      'snow_snowman', 'snow_pine', 'snow_rocks', 'snow_lamp',
                      'snow_crystal', 'snow_grave', 'snow_boulder'],
               big: [{ name: 'snow_castle', w: 2, h: 2 },
                     { name: 'snow_igloo', w: 2, h: 2 },
                     { name: 'snow_spring', w: 2, h: 2 }],
               crate: ['snow_crate'],
               push: ['snow_xcrate'] },
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


  return {
    PLACES,
    WORLDS,
    FLOOR_DOTS,
    LANDMARK,
    LANDMARK_H,
    LANDMARK_V,
    WALL_DOTS,
    CRATE_DOTS,
    ANIMALS,
    CHAR_BODY,
    CHAR_LEGS,
    CHAR_HATS,
    BUBBLE_DOTS,
    GLYPH,
    ITEM_ART,
  };
})();
