// web/audio.js — 소리
//
// ── 8/31 에는 전부 만들어 냈고, 9/1 에 소리만 녹음물로 바꿨다 ─────
//
// 만들어 낸 소리는 파일이 없다는 장점이 있었는데, 돌려보니 그게 다였다.
// 사인파를 아무리 층으로 쌓아도 **물이 터지는 소리로는 안 들린다.**
// 사람이 실제로 뭔가를 때려서 녹음한 것과는 애초에 다른 물건이다.
//
// 그래서 소리는 녹음물로 간다. 다만 아무거나 가져오면 안 된다.
//   - 이 레포는 Public 이다. 라이선스가 확실해야 한다
//   - 받는 사람이 따로 뭘 안 받아도 돌아가야 한다
//
// Kenney (kenney.nl) 의 **CC0** 팩을 쓴다. 한 사람이 만든 것이라 음색이 안 튄다.
// CC0 는 저작권을 통째로 포기한 것이라 상업 이용까지 자유고 표기 의무도 없다.
// 그래도 README 13절에 출처를 적어뒀다 (CLAUDE.md 규칙).
//
// 배경음악도 9/5부터 녹음된 곡을 쓴다. 사용자가 고른 Pixabay 곡은
// `web/music/rock-trailer.mp3`에 두고, 정확한 출처와 라이선스는 README에 남긴다.
//
// ── 녹음물을 쓴다고 저절로 좋아지지 않는다 ───────────────────
//
// 파일 하나를 그대로 트는 것이 제일 흔한 실수다. 그러면
//   ① 열 번째부터 기계로 들린다      → 낼 때마다 **음높이를 흔든다**
//   ② 코앞이나 화면 끝이나 똑같다    → 난 자리대로 **좌우로 벌리고** 멀면 줄인다
//   ③ 얄팍하다                       → 한 사건에 **파일 두세 개를 겹친다**
//   ④ 겹치면 찢어진다                → 압축기를 마지막에 하나 둔다
//   ⑤ 음악과 싸운다                  → 큰 소리가 나면 음악이 물러난다 (덕킹)
const Sound = (() => {

  // ── 어떤 파일을 언제 쓰나 ────────────────────────────────────
  //
  // 녹음 파일 선택은 이 표 한곳에 모아뒀다. 크기·필터·겹 수는 아래 사건별
  // 함수에 있다. 소리를 바꿀 때 두 군데만 보면 되게 한 것이다.
  // 배열이면 낼 때마다 그중 하나를 고른다. 그것만으로도 반복이 확 줄어든다.
  const CLIPS = {
    // 물풍선이 터진다. 젖은 몸통 + 터지는 순간, 두 장을 겹친다
    boomBody:  ['impactSoft_heavy_000', 'impactSoft_heavy_001', 'impactSoft_heavy_002',
                'impactSoft_heavy_003', 'impactSoft_heavy_004'],
    boomCrack: ['impactGlass_light_000', 'impactGlass_light_001',
                'impactGlass_light_002', 'impactGlass_light_003'],

    crate:     ['impactWood_medium_000', 'impactWood_medium_001', 'impactWood_medium_002',
                'impactWood_medium_003', 'impactWood_medium_004'],
    step:      ['footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002',
                'footstep_concrete_003', 'footstep_concrete_004'],

    // 발소리 바탕이 되는 녹음들. 같은 파일을 재료별로 다르게 깎아 쓴다.
    // 새 파일을 받지 않고 있는 것으로 일곱 재료를 만든다
    stepSoft:  ['impactSoft_medium_000', 'impactSoft_medium_001'],
    stepWood:  ['impactWood_medium_000', 'impactWood_medium_001', 'impactWood_medium_002'],
    stepMetal: ['impactGlass_light_002', 'impactGlass_light_003'],
    stepIce:   ['impactGlass_light_000', 'impactGlass_light_001'],
    stepWater: ['impactSoft_heavy_000', 'impactSoft_heavy_002'],

    graze:     ['pluck_001', 'pluck_002'],
    chain:     ['pepSound1', 'pepSound3'],

    trap:      ['impactSoft_medium_000', 'impactSoft_medium_001'],
    trapDown:  ['phaserDown1'],
    escape:    ['phaserUp3'],

    // 마무리. 유리 깨지는 소리 + 주먹. 만화가 물풍선 터뜨릴 때 쓰는 조합이다
    popCrack:  ['glass_001', 'glass_004'],
    popPunch:  ['impactPunch_heavy_000', 'impactPunch_heavy_001'],

    death:     ['lowDown'],
    // 획득 때마다 길고 날카로운 powerUp 음이 울려서 작은 보상치고 너무 튀었다.
    // 짧고 둥근 플럭으로 바꾸고, 아래 item()에서 종류별 음높이만 붙인다.
    item:      ['pluck_001', 'pluck_002'],
    ultra:     ['powerUp7'],
    place:     ['drop_001'],
    drop:      ['drop_003'],
    tick:      ['tick_001'],
    floodLow:  ['lowThreeTone'],
    drown:     ['lowRandom'],
    start:     ['zapThreeToneUp'],
    // 결과음은 긴 8비트 징글을 빼고 짧은 현악 플럭과 낮은 세 음을 쓴다.
    // 화면이 결과표로 넘어간 뒤에도 멜로디가 계속 남지 않게 한다.
    win:       ['jingles_PIZZI00'],
    lose:      ['lowThreeTone'],
  };

  // 재료별 발소리.
  //
  //   clip    어느 녹음을 바탕으로 쓰나
  //   rate    음높이. 높으면 단단하고 가볍게, 낮으면 무겁게 들린다
  //   cut     어느 대역을 자르나. 높은 데를 자르면 둔해지고 낮은 데를 자르면 바삭해진다
  //   send    울림을 얼마나 보내나. 넓은 데는 울리고 흙은 안 울린다
  //
  // 재료 이름은 장소 팔레트(art.js 의 PLACES)에 붙어 있다. 한 곳에서 정한다
  const STEP_MAT = {
    stone:  { clip: 'step',      gain: 0.13, rate: [0.92, 1.10],
              cut: 9000, filter: 'lowpass',  send: 0.16 },
    // 돌과 같은 녹음을 쓰지만 음높이를 확실히 올린다.
    // 필터만 다르게 해두면 시험은 통과해도 귀에는 같은 발소리로 들린다
    marble: { clip: 'step',      gain: 0.12, rate: [1.34, 1.52],
              cut: 1200, filter: 'highpass', q: 0.7, send: 0.34 },
    // 아래 넷은 상자·폭발과 **같은 녹음을 나눠 쓴다.** 파일이 마흔여섯 개뿐이다.
    // 그래서 음높이를 원래 소리와 확실히 떼어놓는다. 같은 파일이라도
    // 한 옥타브 가까이 올리거나 내리면 귀에는 다른 물건이 된다.
    // 안 떼어놓으면 발을 디딜 때마다 상자가 부서지는 것처럼 들린다
    grass:  { clip: 'stepSoft',  gain: 0.11, rate: [1.62, 1.86],
              cut: 2600, filter: 'lowpass',  send: 0.04 },
    sand:   { clip: 'stepSoft',  gain: 0.10, rate: [1.18, 1.34],
              cut: 1700, filter: 'lowpass',  send: 0.03 },
    wood:   { clip: 'stepWood',  gain: 0.12, rate: [1.55, 1.78],
              cut: 5200, filter: 'lowpass',  send: 0.12 },
    metal:  { clip: 'stepMetal', gain: 0.10, rate: [1.62, 1.88],
              cut: 2000, filter: 'highpass', q: 1.4, send: 0.26 },
    // 물. 잠긴 칸을 밟는 소리다. 재료보다 물이 먼저다 —
    // **소리만 듣고도 물에 들어간 걸 알아야 한다.** 눈은 앞을 보고 있다
    water:  { clip: 'stepWater', gain: 0.20, rate: [1.72, 1.96],
              cut: 3400, filter: 'lowpass',  send: 0.22 },

    ice:    { clip: 'stepIce',   gain: 0.09, rate: [2.05, 2.30],
              cut: 2800, filter: 'highpass', q: 1.1, send: 0.30 },
  };

  const DIR = 'sfx/';
  const BGM_URL = 'music/rock-trailer.mp3';

  let ac = null;
  let ready = false, muted = false, loaded = 0, total = 0;
  let musicVolume = 0.42, sfxVolume = 0.85, musicTarget = 0;
  let bgmBuffer = null, bgmSource = null, bgmLoading = false;

  // musicBus는 상황별 크기·덕킹, musicLevel은 설정 화면의 사용자 볼륨이다.
  // 둘을 나눠야 폭발 때 음악만 물러나도 사용자가 정한 값은 사라지지 않는다.
  let master, comp, sfxBus, musicBus, musicLevel, musicTone, verb, verbSend;

  const buffers = {};       // 이름 -> AudioBuffer
  const lastAt = {};        // 종류별 마지막 시각. 같은 게 몰아치는 걸 막는다

  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  // ── 울림을 만든다 ────────────────────────────────────────────
  //
  // 리버브는 보통 실제 공간에서 녹음한 파일(임펄스 응답)을 쓴다.
  // 그건 굳이 안 받아도 된다. 잡음 한 덩어리를 뒤로 갈수록 깎으면 그게 곧 방이다.
  // 좁은 방은 짧고 빨리 죽고 넓은 홀은 길고 천천히 죽는다. 그 차이가 전부다.
  function makeRoom(seconds, decay) {
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);
    for (let ch = 0; ch < 2; ++ch) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; ++i) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }

  function build() {
    if (ac) return true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return false;
    }

    // 마지막에 압축기를 하나. 폭발이 여러 개 겹치면 소리가 찢어지는데 큰 것만 눌러준다.
    // 이게 없으면 조용할 땐 안 들리고 시끄러울 땐 찢어진다
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value      = 20;
    comp.ratio.value     = 8;
    comp.attack.value    = 0.004;
    comp.release.value   = 0.16;

    // 0.95는 한계 바로 밑이라 여유가 없다. 압축기가 있어도 "꽉 찬 소리"가
    // 남는다 - 스튜디오 쪽 상식이 "제일 크게 만들고 낮추지 말고, 처음부터
    // 여유 있게 잡아라"다. 0.85로 낮춰서 숨 쉴 자리를 남긴다
    master   = ac.createGain(); master.gain.value = 0.85;
    sfxBus   = ac.createGain(); sfxBus.gain.value = sfxVolume;
    musicBus = ac.createGain(); musicBus.gain.value = 0.0;
    musicLevel = ac.createGain(); musicLevel.gain.value = musicVolume;

    // 음악과 효과음이 부딪히는 높은 대역을 살짝 정리한다. 위험해질 때는
    // 이 값을 조금 열어서 같은 곡이어도 답답하지 않게 들리도록 한다.
    musicTone = ac.createBiquadFilter();
    musicTone.type = 'lowpass';
    musicTone.frequency.value = 5200;

    verb = ac.createConvolver();
    verb.buffer = makeRoom(1.5, 2.8);
    verbSend = ac.createGain(); verbSend.gain.value = 0.32;

    sfxBus.connect(master);
    musicTone.connect(musicBus);
    musicBus.connect(musicLevel);
    musicLevel.connect(master);
    verbSend.connect(verb);
    // 잔향도 효과음이다. master에 바로 꽂으면 효과음 볼륨을 0으로 내려도
    // 잔향만 남으므로 반드시 sfxBus를 지나게 한다.
    verb.connect(sfxBus);
    master.connect(comp);
    comp.connect(ac.destination);

    ready = true;
    preload();
    preloadBgm();
    return true;
  }

  // 파일을 미리 받아 풀어둔다.
  //
  // 소리가 필요한 순간에 받으면 그때 끊긴다. 처음에 한 번에 받아서 풀어둔다.
  // 아직 안 온 소리는 그냥 안 난다. 소리 하나 때문에 게임이 멈추면 안 된다
  function preload() {
    if (typeof fetch !== 'function') return;

    const names = new Set();
    for (const k in CLIPS) CLIPS[k].forEach(n => names.add(n));
    total = names.size + 1; // 효과음에 BGM 한 곡까지 포함한다.

    for (const n of names) {
      fetch(DIR + n + '.ogg')
        .then(r => r.arrayBuffer())
        .then(b => ac.decodeAudioData(b))
        .then(buf => { buffers[n] = buf; ++loaded; })
        .catch(() => { ++loaded; });   // 하나 없다고 나머지를 막지 않는다
    }
  }

  // BGM은 한 번만 받아 풀고 AudioBufferSource를 반복 재생한다.
  // HTMLAudioElement와 Web Audio를 섞지 않아야 덕킹·필터·전체 음소거가 한 믹서에서 먹는다.
  function preloadBgm() {
    if (bgmLoading || bgmBuffer || typeof fetch !== 'function') return;
    bgmLoading = true;
    fetch(BGM_URL)
      .then(r => r.arrayBuffer())
      .then(b => ac.decodeAudioData(b))
      .then(buf => {
        bgmBuffer = buf;
        ++loaded;
        startBgm();
      })
      .catch(() => { ++loaded; }); // 음악이 없어도 게임과 효과음은 계속 돈다.
  }

  function startBgm() {
    if (!ready || !bgmBuffer || bgmSource) return;
    const src = ac.createBufferSource();
    src.buffer = bgmBuffer;
    src.loop = true;
    src.connect(musicTone);
    src.onended = () => {
      if (bgmSource === src) bgmSource = null;
    };
    src.start();
    bgmSource = src;
  }

  function clampVolume(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  }

  function applyVolumes(music, sfx) {
    musicVolume = clampVolume(music, musicVolume);
    sfxVolume = clampVolume(sfx, sfxVolume);
    if (!ready) return;
    musicLevel.gain.setTargetAtTime(musicVolume, ac.currentTime, 0.04);
    sfxBus.gain.setTargetAtTime(sfxVolume, ac.currentTime, 0.04);
  }

  function panner(pan) {
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      return p;
    }
    return ac.createGain();
  }

  // ── 녹음물 한 장을 낸다 ──────────────────────────────────────
  //
  //   rate  음높이. 1 이 원래 소리. 낼 때마다 조금씩 흔들어야 기계로 안 들린다
  //   send  울림을 얼마나 태울 것인가
  //   cut   저역/고역을 깎을 것인가. 같은 파일도 이걸로 성격이 달라진다
  // 지금 울리고 있는 소리 수. 종류별로 센다.
  //
  // 스물넷이 한 구역에서 싸우면 같은 순간에 소리가 스무 겹씩 겹친다.
  // 그러면 하나하나가 안 들리고 지직거리는 덩어리가 된다. **소리가 많을수록
  // 안 들린다.** 방송 믹스에서 제일 먼저 하는 일이 이걸 막는 것이다.
  //
  // 종류마다 상한을 두고, 넘으면 그 소리는 그냥 버린다.
  // 중요한 소리(마무리, 폭발)는 상한이 높고 잦은 소리(상자, 발)는 낮다
  const VOICE_CAP = {
    crate: 3, step: 2, place: 3, drop: 2, item: 3,
    boomBody: 4, boomCrack: 4, blast: 4,
    popPunch: 3, popCrack: 3, death: 3,
    graze: 3, chain: 3, trap: 3,
  };
  const DEFAULT_CAP = 6;

  // 울리고 있는 소리를 **끝나는 시각으로** 센다.
  //
  // 처음엔 src.onended 로 내렸다. 그런데 그건 브라우저가 불러줘야 오는 것이고,
  // 소리를 중간에 끊거나 탭이 뒤로 가면 안 온다. 안 오면 수가 영영 안 내려가서
  // 상한에 걸려 **소리가 아예 안 나게** 된다. 시험에서 발소리 둘이 안 나서 알았다.
  //
  // 언제 끝나는지는 버퍼 길이와 음높이로 미리 알 수 있다. 그러면 아무도 안 불러줘도 된다
  const live = [];          // { key, until }
  let voicePeak = 0;        // 한 순간에 제일 많이 겹친 수. 계측용
  let voiceDropped = 0;     // 상한에 걸려 버린 수

  // 전체 상한. 종류별로만 막으면 종류가 늘어난 만큼 합이 커진다.
  // 사람 귀는 한 번에 대여섯 개까지만 따로 듣는다
  const TOTAL_CAP = 12;

  function reap(t) {
    for (let i = live.length - 1; i >= 0; --i) {
      if (live[i].until <= t) live.splice(i, 1);
    }
  }

  function countOf(key) {
    let n = 0;
    for (const v of live) if (v.key === key) ++n;
    return n;
  }

  function play(key, o) {
    if (!ready || muted) return;
    o = o || {};

    // 상한을 넘으면 버린다. 억지로 다 내면 다 같이 안 들린다
    const nowT = ac.currentTime;
    reap(nowT);

    const cap = VOICE_CAP[key] === undefined ? DEFAULT_CAP : VOICE_CAP[key];
    if (countOf(key) >= cap || live.length >= TOTAL_CAP) { ++voiceDropped; return; }

    const name = pick(CLIPS[key] || []);
    const buf = buffers[name];
    if (!buf) return;

    const t = ac.currentTime + (o.delay || 0);

    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate || 1;

    let node = src;
    if (o.cut) {
      const f = ac.createBiquadFilter();
      f.type = o.filter || 'lowpass';
      f.frequency.value = o.cut;
      f.Q.value = o.q || 1;
      node.connect(f);
      node = f;
    }

    // 거리. 멀수록 작고 둔하다.
    //
    // 9/2 까지 좌우만 있었다. 옆 구역에서 터진 폭발이 내 옆에서 터진 것과
    // 똑같은 크기로 들렸다. 그러면 소리가 '어디서 났나' 를 못 알려준다.
    //
    // 높은 음이 먼저 죽는 건 실제 그렇다. 벽과 공기가 높은 데를 먼저 먹는다.
    // 재료 필터를 이미 걸었어도 이건 따로 하나 더 건다. 둘은 다른 일이다
    if (o.far) {
      const ff = ac.createBiquadFilter();
      ff.type = 'lowpass';
      ff.frequency.value = o.far.cut;
      node.connect(ff);
      node = ff;
    }

    const g = ac.createGain();
    g.gain.value = (o.gain === undefined ? 1 : o.gain)
                 * (o.far ? o.far.gain : 1);

    const p = panner(o.pan);
    node.connect(g); g.connect(p);
    p.connect(sfxBus);

    if (o.send) {
      const s = ac.createGain();
      s.gain.value = o.send;
      p.connect(s); s.connect(verbSend);
    }

    // 언제 끝나는지 미리 적어둔다. 아무도 안 불러줘도 수가 내려간다
    const dur = (buf.duration || 0.2) / (src.playbackRate.value || 1);
    live.push({ key: key, until: t + dur });
    if (live.length > voicePeak) voicePeak = live.length;

    src.start(t);
  }

  // 큰 소리가 났을 때 음악이 잠깐 물러난다.
  // 방송에서 말이 나오면 배경음악이 작아지는 것과 같은 장치다.
  // 없으면 폭발과 음악이 같은 자리에서 싸워서 둘 다 안 들린다
  function duck(amount, hold) {
    if (!ready) return;
    const t = ac.currentTime;
    const g = musicBus.gain;
    const cur = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(cur * (1 - amount), t + 0.03);
    g.linearRampToValueAtTime(musicTarget, t + 0.03 + (hold || 0.35));
  }

  // 같은 소리가 몰아칠 때 앞의 것만 낸다.
  // 폭발 한 번에 칸이 스무 개씩 오는데 그때마다 내면 찢어진다
  function gate(key, ms) {
    const t = performance.now();
    if (lastAt[key] && t - lastAt[key] < ms) return false;
    lastAt[key] = t;
    return true;
  }

  // 음높이가 뚝 떨어지는 짧은 소리.
  //
  // 녹음물만으로는 크아 소리가 안 난다. 옛날 아케이드 게임 소리는 대부분 이
  // 모양이다. 한 음을 내면서 음높이를 빠르게 떨어뜨리거나 올린다.
  // 물이 터지는 실체감은 녹음물이 주고, 이 게임 소리라는 인상은 이쪽이 준다.
  // 둘을 겹치는 것이 요점이지 하나를 고르는 것이 아니다
  // 이 게임에서 나는 소리 중 제일 자주, 제일 많이 겹쳐 들리는 것이 이거다 —
  // 물풍선 하나 터질 때마다, 걸칠 때마다, 연쇄마다 전부 이 함수를 거친다.
  // "듣기 거북하다"는 말을 들으면 제일 먼저 의심할 자리도 여기다.
  //
  // 네모파(square)는 배음이 세다. 그 배음이 하필 사람 귀가 제일 예민한
  // 2~4kHz·6~8kHz 대역에 몰린다 - 음정이나 박자가 아니라 이 대역 자체가
  // "거슬린다"의 정체였다(마스터링 쪽에서 harshness라고 부르는 그 대역).
  // 녹음물(둔탁하고 실감 나는 소리)과 이 네모파(또렷하고 게임 같은 소리)를
  // 겹치는 게 원래 설계 의도인데, 네모파 쪽 배음을 다듬지 않고 그대로
  // 얹으니 겹칠 때마다 그 대역만 계속 쌓였다.
  //
  // 기본파는 그대로 두고 그 위 배음만 저역통과로 깎는다. 세게 깎으면
  // 네모파 특유의 딱딱한 성격이 사라져 그냥 삼각파가 되므로, 정체성은
  // 남기고 제일 거친 위쪽만 죽이는 선에서 멈춘다
  function sweep(o) {
    if (muted || !ready) return;
    const t = ac.currentTime + (o.delay || 0);

    const osc = ac.createOscillator();
    osc.type = o.wave || 'square';
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + o.dur);

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain * (o.far ? o.far.gain : 1), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    const tone = ac.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = osc.type === 'square' ? 3400 : 5200;
    tone.Q.value = 0.6;
    g.connect(tone);

    // 멀면 높은 데가 먼저 죽는다. 녹음물 쪽과 같은 규칙을 쓴다
    let node = tone;
    if (o.far) {
      const ff = ac.createBiquadFilter();
      ff.type = 'lowpass';
      ff.frequency.value = o.far.cut;
      node.connect(ff);
      node = ff;
    }

    const pn = panner(o.pan);

    osc.connect(g); node.connect(pn); pn.connect(sfxBus);
    if (o.send) {
      const sg = ac.createGain(); sg.gain.value = o.send;
      pn.connect(sg); sg.connect(verbSend);
    }
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  // ── 밖에서 쓰는 것 ───────────────────────────────────────────
  return {
    // 믹스가 어떻게 돌고 있나. 시험이 읽는다.
    //
    // 소리는 '났다/안 났다' 만으로는 못 고친다. **몇 겹이 겹쳤고 몇 개를 버렸는지**
    // 를 봐야 뭉갠 데를 안다. 눈으로 보는 것과 달리 귀로는 겹친 걸 못 센다
    // 재료별 발소리 표. 시험이 읽는다.
    //
    // 실제로 낸 소리 하나를 보고 판단하면 클립을 무작위로 고르기 때문에
    // 같은 시험이 돌릴 때마다 다른 답을 낸다. 그런 시험은 시험이 아니다.
    // 정해둔 값을 보면 결과가 늘 같다
    stepTable() { return STEP_MAT; },

    mixStats() {
      if (ready) reap(ac.currentTime);
      return { live: live.length, peak: voicePeak, dropped: voiceDropped,
               cap: TOTAL_CAP, materials: Object.keys(STEP_MAT).length };
    },
    resetMix() { voicePeak = 0; voiceDropped = 0; },

    // 브라우저는 사용자가 뭔가 누르기 전에는 소리를 못 내게 막는다
    wake() {
      const ok = build();
      if (ac && ac.state === 'suspended') ac.resume().then(startBgm).catch(() => {});
      else startBgm();
      return ok;
    },
    toggle() {
      muted = !muted;
      if (ready) master.gain.value = muted ? 0 : 0.85;
      return muted;
    },
    isMuted()  { return muted; },
    isReady()  { return ready; },
    progress() { return total ? loaded / total : 0; },

    // 설정 화면은 소리 장치를 깨우기 전에도 이 값을 넣을 수 있다.
    // 실제 노드가 생기기 전에는 값만 기억하고, build()가 그 값으로 시작한다.
    setVolumes(music, sfx) { applyVolumes(music, sfx); },
    musicState() {
      return { loaded: !!bgmBuffer, playing: !!bgmSource,
               musicVolume, sfxVolume, source: BGM_URL };
    },

    // 같은 곡을 바꾸지는 않는다. 판이 급해지면 볼륨과 필터만 조금 열어서
    // 화면의 위험도와 음악의 힘이 서로 어긋나지 않게 한다.
    setMood(phase, aliveRatio, danger) {
      if (!ready) return;
      const playing = phase === 2;
      musicTarget = playing
        ? (danger ? 0.72 : (aliveRatio < 0.40 ? 0.64 : 0.56))
        : (phase === 3 ? 0.24 : 0.10);
      const g = musicBus.gain;
      g.cancelScheduledValues(ac.currentTime);
      g.setTargetAtTime(musicTarget, ac.currentTime, 0.4);
      musicTone.frequency.setTargetAtTime(danger ? 7600 : 5200, ac.currentTime, 0.5);
    },

    // ── 사건 하나에 소리 하나 ──────────────────────────────────
    //
    // 전부 파일 두 장 이상을 겹치고, 낼 때마다 음높이를 흔든다

    // 물풍선이 터진다. 이 게임에서 제일 중요한 소리
    boom(pan, far) {
      if (!gate('boom', 60)) return;
      const k = rnd(0.86, 1.06);
      play('boomBody',  { pan, far, gain: 0.72, rate: k * 0.9, send: 0.26 });
      play('boomCrack', { pan, far, gain: 0.24, rate: k * 1.15, send: 0.18, delay: 0.008,
                          cut: 4400, filter: 'lowpass' });

      // 위에서 아래로 뚝 떨어지는 한 음을 얹는다. 물풍선이 '펑' 하고
      // 주저앉는 소리를 이 한 줄이 만든다. 녹음물은 실체감을 주고 이건 성격을 준다
      sweep({ pan, far, from: 460 * k, to: 90, dur: 0.16, gain: 0.18, wave: 'triangle' });
      sweep({ pan, far, from: 900 * k, to: 240, dur: 0.09, gain: 0.08,
              wave: 'triangle', delay: 0.01, send: 0.2 });
      duck(0.34, 0.28);
    },

    // 걸치기. 이 게임의 정체성이라 제일 예쁜 소리를 준다.
    // 연속으로 성공하면 음이 올라간다. 숫자를 안 봐도 귀로 늘어난 걸 안다
    graze(n, pan, far) {
      const up = Math.min(n || 1, 5);
      play('graze', { pan, far, gain: 0.48, rate: 1 + (up - 1) * 0.14, send: 0.38 });
      play('graze', { pan, far, gain: 0.14, rate: 2 + (up - 1) * 0.28, send: 0.45, delay: 0.02 });

      // 위로 올라가는 짧은 음. 연속으로 걸치면 한 음씩 더 올라간다.
      // 올라가는 소리는 옛날부터 '잘했다' 는 뜻으로 쓰였다 — 배울 게 없는 신호다
      const base = 620 * Math.pow(2, (up - 1) / 12);
      sweep({ pan, far, from: base, to: base * 1.6, dur: 0.10, gain: 0.10,
              wave: 'triangle', send: 0.28 });
    },

    // 연쇄. 한 번 터질 때마다 음이 올라간다. 몇 단인지가 귀로 들린다
    chain(n, pan, far) {
      const k = Math.min(n || 1, 8);
      play('chain', { pan, far, gain: 0.34, rate: 1 + k * 0.08, send: 0.26 });
      // 연쇄가 이어질수록 한 음씩 올라간다. 몇 단인지가 귀로 들린다
      sweep({ pan, far, from: 300 * Math.pow(2, k / 12), to: 700 * Math.pow(2, k / 12),
              dur: 0.07, gain: 0.09, wave: 'triangle' });
    },

    trap(pan, far) {
      play('trap',     { pan, far, gain: 0.55, rate: rnd(0.85, 0.95), send: 0.30 });
      play('trapDown', { pan, far, gain: 0.22, rate: 0.9, delay: 0.02 });
    },

    // 스스로 빠져나왔다. 갇힘의 정확히 반대로 올라간다
    breaks(pan, far) {
      play('escape', { pan, far, gain: 0.55, rate: rnd(1.0, 1.1), send: 0.35 });
    },

    // 마무리. 몸으로 부딪쳐 터뜨렸다. 제일 통쾌해야 하는 순간이라 세 장을 겹친다
    pop(pan, far) {
      play('popPunch', { pan, far, gain: 0.65, rate: rnd(0.92, 1.05) });
      play('popCrack', { pan, far, gain: 0.45, rate: rnd(1.05, 1.2), delay: 0.012,
                          send: 0.32, cut: 5200, filter: 'lowpass' });
      play('boomBody', { pan, far, gain: 0.32, rate: 0.75, delay: 0.02, send: 0.3 });
      duck(0.42, 0.4);
    },

    death(pan, far) {
      play('death',    { pan, far, gain: 0.55, rate: rnd(0.9, 1.0), send: 0.40 });
      play('boomBody', { pan, far, gain: 0.30, rate: 0.7, send: 0.30 });
    },

    item(kind, pan, far) {
      const step = kind === 1 ? 0 : kind === 2 ? 4 : 7;
      const rate = Math.pow(2, step / 12);
      play('item', { pan, far, gain: 0.22, rate: rate * rnd(0.98, 1.02),
                     cut: 4600, filter: 'lowpass', send: 0.22 });
      sweep({ pan, far, from: 390 * rate, to: 520 * rate, dur: 0.09,
              gain: 0.07, wave: 'triangle', delay: 0.015, send: 0.16 });
    },
    drop(pan, far)  { play('drop',  { pan, far, gain: 0.30, rate: rnd(0.95, 1.1) }); },
    place(pan, far) { play('place', { pan, far, gain: 0.35, rate: rnd(0.95, 1.1) }); },

    // 울트라. 흔한 게 아니라 확실히 달라야 한다
    ultra(pan, far) { play('ultra', { pan, far, gain: 0.46, send: 0.30,
                                      cut: 5200, filter: 'lowpass' }); },

    // 상자가 부서진다. 제일 자주 나는 소리라 제일 작아야 하고,
    // 낼 때마다 음이 흔들려서 백 번을 들어도 기계로 안 들린다
    crack(pan, far) { play('crate', { pan, far, gain: 0.32, rate: rnd(0.82, 1.25) }); },

    // 상자를 밀었다. 나무가 바닥에 끌리는 소리. 낮게 깎아서 둔탁하게
    push(pan, far) {
      play('crate', { pan, far, gain: 0.30, rate: rnd(0.45, 0.6), cut: 1400, filter: 'lowpass' });
      play('step',  { pan, far, gain: 0.18, rate: rnd(0.5, 0.7) });
    },

    // 내 발소리. 아주 작게. 없으면 걷는 게 안 느껴지고 크면 지겹다
    // 발소리는 **밟는 것에 따라 다르다.**
    //
    // 9/2 까지 어디를 밟아도 콘크리트 소리가 났다. 장소를 열 곳 그려놓고
    // 잔디에서도 얼음에서도 같은 소리가 나면 그 열 곳은 그림일 뿐이다.
    // 눈으로 다르게 만든 것을 귀로도 다르게 만드는 게 이번 일이다.
    //
    // 재료마다 파일을 따로 받지 않았다. 있는 것으로 만든다 —
    // 같은 녹음도 **음높이와 잘라내는 대역**을 바꾸면 다른 재료가 된다.
    // 자료가 모자랄 때 실제로 쓰는 방법이다
    step(pan, material) {
      if (!gate('step', 130)) return;
      const m = STEP_MAT[material] || STEP_MAT.stone;
      play(m.clip, {
        pan: pan,
        gain: m.gain,
        rate: rnd(m.rate[0], m.rate[1]),
        cut: m.cut,
        filter: m.filter,
        q: m.q,
        send: m.send,
      });
    },

    warn() {
      // 오류음처럼 들리던 높은 경고음을 빼고, 물이 밀려오는 낮은 두 음으로 알린다.
      play('floodLow', { gain: 0.30, rate: 0.78, send: 0.36 });
      sweep({ from: 220, to: 310, dur: 0.24, gain: 0.08,
              wave: 'triangle', delay: 0.06, send: 0.3 });
      duck(0.24, 0.7);
    },

    // 남은 시간을 알리는 짧은 삑. 마지막 10초에 화면이 뛰는 박자로 같이 울린다.
    //
    // 녹음물을 안 쓴다. 눈으로 뛰는 것과 **정확히 같은 순간**에 나야 하는데,
    // 녹음은 시작 부분이 조금 느슨해서 여러 번 반복하면 어긋난 게 보인다.
    // 파형을 만들면 시작이 딱 떨어진다.
    //
    // k 는 1(10초 남음)에서 0(코앞)으로 간다. 낮은 음에서 시작해 올라간다 —
    // 올라가는 소리는 사람을 일으켜 세우고, 내려가는 소리는 주저앉힌다
    warnBeep(k) {
      const f = 520 + (1 - k) * 460;
      sweep({ wave: 'triangle', from: f, to: f * 1.06,
              dur: 0.07, gain: 0.10 + (1 - k) * 0.10 });
      sweep({ wave: 'triangle', from: f * 2, to: f * 2,
              dur: 0.045, gain: 0.05, delay: 0.005 });
    },

    flood() {
      play('boomBody', { gain: 0.68, rate: 0.55, send: 0.52 });
      play('floodLow', { gain: 0.38, rate: 0.7, delay: 0.05, send: 0.45 });
      duck(0.32, 0.8);
    },

    drown() {
      if (!gate('drown', 900)) return;
      play('drown', { gain: 0.40, rate: 0.8, cut: 900, filter: 'lowpass' });
    },

    tick(n)  { play('tick',  { gain: 0.40, rate: 1 + n * 0.12 }); },
    start()  { play('start', { gain: 0.55, send: 0.30 }); },
    win() {
      play('win', { gain: 0.38, rate: 1.02, cut: 4800, filter: 'lowpass', send: 0.28 });
      sweep({ from: 520, to: 780, dur: 0.18, gain: 0.07,
              wave: 'triangle', delay: 0.04, send: 0.20 });
    },
    lose() {
      play('lose', { gain: 0.26, rate: 0.78, cut: 2400, filter: 'lowpass', send: 0.22 });
      sweep({ from: 260, to: 190, dur: 0.24, gain: 0.05,
              wave: 'triangle', delay: 0.03, send: 0.14 });
    },
  };
})();
