// web/audio.js — 소리를 만든다
//
// 파일을 하나도 안 쓴다. 브라우저가 그때그때 만들어 낸다.
// 에셋이 없으니 출처와 라이선스를 적을 것이 없고 (SPEC 13절), 받는 사람이
// 따로 내려받을 것도 없다.
//
// 게임 소리가 싸구려로 들리는 이유는 대개 셋이다.
//   ① 소리 하나가 층이 하나다. "삐" 하고 만다
//   ② 같은 소리가 똑같이 반복된다. 열 번째부터 기계로 들린다
//   ③ 공간이 없다. 코앞에서 나든 화면 끝에서 나든 똑같이 들린다
//
// 그래서 여기서는
//   ① 소리 하나를 **층으로** 만든다. 때리는 소리 + 몸통 + 꼬리
//   ② 낼 때마다 **음을 조금씩 흔든다**. 같은 소리가 두 번 안 난다
//   ③ **화면에서 난 자리대로 좌우로 벌린다.** 멀면 작아진다
//   ④ 울림(리버브)을 지나가게 한다. 울림도 파일이 아니라 만들어 쓴다
//   ⑤ 큰 소리가 나면 음악이 잠깐 물러난다 (덕킹)
//
// 음악은 미리 녹음한 것이 아니라 **판 상황에 따라 층이 붙었다 빠진다.**
// 스물넷이 살아 있을 때와 둘 남았을 때가 다르게 들려야 한다.
const Sound = (() => {

  let ac = null;
  let ready = false, muted = false;

  // 믹서. 게임 소리와 음악이 각자 볼륨을 갖고, 마지막에 하나로 모인다
  let master, comp, sfxBus, musicBus, verb, verbSend;

  let noiseBuf = null;
  const lastAt = {};        // 소리 종류별 마지막 시각. 같은 게 몰아치는 걸 막는다

  const rnd = (a, b) => a + Math.random() * (b - a);
  const now = () => ac.currentTime;

  // ── 울림을 만든다 ────────────────────────────────────────────
  //
  // 리버브는 보통 실제 공간에서 녹음한 파일(임펄스 응답)을 쓴다.
  // 그런데 우리는 파일을 안 쓰기로 했다.
  //
  // 잡음을 한 덩어리 만들고 뒤로 갈수록 작아지게 깎으면 그게 곧 방이 된다.
  // 좁은 방은 짧고 빨리 죽고, 넓은 홀은 길고 천천히 죽는다. 그 차이가 전부다.
  function makeRoom(seconds, decay) {
    const n = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, n, ac.sampleRate);

    for (let ch = 0; ch < 2; ++ch) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; ++i) {
        // 앞쪽은 촘촘하고 뒤로 갈수록 성기게. 실제 방의 반사가 그렇다
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }

  function makeNoise() {
    const n = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; ++i) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (ac) {
      if (ac.state === 'suspended') ac.resume();
      return ready;
    }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return false;
    }

    // 마지막에 압축기를 하나 둔다.
    // 폭발이 여러 개 겹치면 소리가 찢어지는데, 이게 큰 것만 눌러준다.
    // 이게 없으면 조용할 땐 안 들리고 시끄러울 땐 찢어진다
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value      = 22;
    comp.ratio.value     = 9;
    comp.attack.value    = 0.004;
    comp.release.value   = 0.18;

    master = ac.createGain();
    master.gain.value = 0.9;

    sfxBus = ac.createGain();
    sfxBus.gain.value = 1.0;

    musicBus = ac.createGain();
    musicBus.gain.value = 0.0;   // 음악은 판이 시작할 때 들어온다

    verb = ac.createConvolver();
    verb.buffer = makeRoom(1.6, 2.6);

    verbSend = ac.createGain();
    verbSend.gain.value = 0.30;

    sfxBus.connect(master);
    musicBus.connect(master);
    verbSend.connect(verb);
    verb.connect(master);
    master.connect(comp);
    comp.connect(ac.destination);

    noiseBuf = makeNoise();
    ready = true;
    startClock();
    return true;
  }

  // 화면에서 난 자리를 좌우로 옮긴다.
  //   pan  -1 왼쪽 .. 0 가운데 .. 1 오른쪽
  function panner(pan) {
    if (ac.createStereoPanner) {
      const p = ac.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan || 0));
      return p;
    }
    return ac.createGain();   // 오래된 브라우저는 그냥 가운데
  }

  // ── 소리 한 층 ───────────────────────────────────────────────
  //
  // 음 하나가 나고 사라지기까지를 네 토막으로 나눈다.
  //   붙는 시간(attack)  커지는 데 걸리는 시간. 짧으면 때리는 소리
  //   꺼지는 시간(decay) 그 뒤로 사그라드는 시간
  // 이 둘의 비율이 "딱" 인지 "웅" 인지를 정한다. 음정보다 이쪽이 성격을 만든다
  function tone(o) {
    if (!ready || muted) return;
    const t = now();

    const osc = ac.createOscillator();
    osc.type = o.wave || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1 && o.f1 !== o.f0) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur);
    }
    if (o.detune) osc.detune.value = o.detune;

    let node = osc;

    if (o.cut) {
      const f = ac.createBiquadFilter();
      f.type = o.filter || 'lowpass';
      f.Q.value = o.q || 1;
      f.frequency.setValueAtTime(o.cut, t);
      if (o.cut1) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.cut1), t + o.dur);
      node.connect(f);
      node = f;
    }

    const g = ac.createGain();
    const peak = Math.max(0.0001, o.gain);
    const atk  = o.atk === undefined ? 0.004 : o.atk;

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    const p = panner(o.pan);
    node.connect(g); g.connect(p);
    p.connect(sfxBus);
    if (o.send) {
      const s = ac.createGain();
      s.gain.value = o.send;
      p.connect(s); s.connect(verbSend);
    }

    osc.start(t + (o.delay || 0));
    osc.stop(t + (o.delay || 0) + o.dur + 0.02);
  }

  // 잡음 한 층. 물소리와 부서지는 소리는 음정이 아니라 잡음이다
  function noise(o) {
    if (!ready || muted) return;
    const t = now() + (o.delay || 0);

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate || 1;

    const f = ac.createBiquadFilter();
    f.type = o.filter || 'lowpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.cut, t);
    if (o.cut1) f.frequency.exponentialRampToValueAtTime(Math.max(40, o.cut1), t + o.dur);

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, o.gain), t + (o.atk || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

    const p = panner(o.pan);
    src.connect(f); f.connect(g); g.connect(p);
    p.connect(sfxBus);
    if (o.send) {
      const s = ac.createGain();
      s.gain.value = o.send;
      p.connect(s); s.connect(verbSend);
    }

    src.start(t);
    src.stop(t + o.dur + 0.02);
  }

  // 큰 소리가 났을 때 음악이 잠깐 물러난다.
  //
  // 방송에서 말이 나오면 배경음악이 자동으로 작아지는 것과 같은 장치다.
  // 이게 없으면 폭발과 음악이 같은 자리에서 싸워서 둘 다 안 들린다
  function duck(amount, hold) {
    if (!ready) return;
    const t = now();
    const g = musicBus.gain;
    const cur = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(cur, t);
    g.linearRampToValueAtTime(cur * (1 - amount), t + 0.03);
    g.linearRampToValueAtTime(musicTarget, t + 0.03 + (hold || 0.35));
  }

  // 같은 소리가 몰아칠 때 앞의 것만 낸다.
  // 폭발 한 번에 칸이 스무 개씩 오는데 그때마다 소리를 내면 찢어진다
  function gate(key, ms) {
    const t = performance.now();
    if (lastAt[key] && t - lastAt[key] < ms) return false;
    lastAt[key] = t;
    return true;
  }

  // ── 음악 ─────────────────────────────────────────────────────
  //
  // 미리 만든 곡을 트는 게 아니라 그 자리에서 친다.
  //
  // 층이 넷이고, 판이 급해질수록 위 층이 하나씩 붙는다.
  //   0층 낮은 맥박   판이 도는 내내
  //   1층 리듬        사람이 줄기 시작하면
  //   2층 아르페지오  절반 아래로 줄면
  //   3층 높은 음     마지막 구역, 물이 차오를 때
  //
  // 스물넷이 살아 있을 때와 둘 남았을 때가 같게 들리면 안 된다.
  // 남은 사람 수를 화면에서 읽지 않아도 **귀로 알게** 하는 것이 목적이다.
  const BPM = 104;
  const BEAT = 60 / BPM;

  // 다섯 음만 쓴다 (마이너 펜타토닉). 아무 순서로 쳐도 안 어긋난다.
  // 화성을 신경 쓰지 않고 리듬만 짤 수 있어서, 여기서는 이게 맞다
  const SCALE = [0, 3, 5, 7, 10];
  const ROOT  = 55;   // A1
  const hz = (semi) => ROOT * Math.pow(2, semi / 12);

  let musicOn = false, musicTarget = 0;
  let intensity = 0;          // 0..3
  let step = 0;               // 열여섯 번째 음표 하나가 한 걸음
  let nextTime = 0;
  let clock = null;

  function schedule() {
    if (!ready) return;

    // 앞으로 0.2초 안에 칠 것을 미리 예약한다.
    // 지금 쳐서는 절대 정확할 수 없다. setInterval 은 몇십 ms 씩 흔들린다.
    // 오디오 시계에 미리 걸어두면 흔들려도 소리는 제자리에 떨어진다
    while (nextTime < ac.currentTime + 0.25) {
      playStep(step, nextTime);
      nextTime += BEAT / 4;
      step = (step + 1) % 64;
    }
  }

  function bar(t, gain, dur, wave, f, send) {
    if (muted) return;
    const osc = ac.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(f, t);

    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g);
    g.connect(musicBus);
    if (send) {
      const s = ac.createGain();
      s.gain.value = send;
      g.connect(s); s.connect(verbSend);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function playStep(i, t) {
    if (!musicOn) return;

    const q = i % 16;   // 한 마디 안에서 몇 번째인가

    // 0층 — 낮은 맥박. 심장 소리 자리다
    if (q % 4 === 0) {
      bar(t, 0.30, 0.30, 'sine', hz(SCALE[0]) / 2, 0);
    }

    // 1층 — 리듬. 짧은 잡음을 스틱처럼 쓴다
    if (intensity >= 1 && q % 2 === 1) {
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      src.connect(f); f.connect(g); g.connect(musicBus);
      src.start(t); src.stop(t + 0.06);
    }

    // 2층 — 아르페지오. 여기서부터 급해진 게 들린다
    if (intensity >= 2) {
      const n = SCALE[(i * 3) % SCALE.length] + 12 * (1 + ((i >> 2) & 1));
      bar(t, 0.075, 0.16, 'triangle', hz(n), 0.25);
    }

    // 3층 — 마지막. 높고 길게 깔린다
    if (intensity >= 3 && q % 8 === 0) {
      const n = SCALE[(i >> 3) % SCALE.length] + 24;
      bar(t, 0.055, 1.2, 'sawtooth', hz(n), 0.5);
    }
  }

  function startClock() {
    if (clock) return;
    nextTime = ac.currentTime + 0.1;
    clock = setInterval(schedule, 40);
  }

  // ── 밖에서 쓰는 것 ───────────────────────────────────────────
  return {
    wake() { return init(); },
    toggle() {
      muted = !muted;
      if (ready) master.gain.value = muted ? 0 : 0.9;
      return muted;
    },
    isMuted() { return muted; },
    isReady()  { return ready; },

    // 판이 어떤 상황인가. 음악의 층수가 여기서 정해진다
    setMood(phase, aliveRatio, danger) {
      if (!ready) return;

      musicOn = (phase === 2);
      let lv = 0;
      if (aliveRatio < 0.75) lv = 1;
      if (aliveRatio < 0.40) lv = 2;
      if (danger)            lv = 3;
      intensity = lv;

      musicTarget = musicOn ? 0.55 : (phase === 3 ? 0.25 : 0.18);
      const g = musicBus.gain;
      g.cancelScheduledValues(ac.currentTime);
      g.setTargetAtTime(musicTarget, ac.currentTime, 0.4);
    },

    // ── 소리 하나하나 ──────────────────────────────────────────
    //
    // 전부 층이 둘 이상이다. 층 하나짜리가 웹게임 소리로 들리는 것의 정체다

    // 물풍선이 터진다. 이 게임에서 제일 중요한 소리.
    //   ① 툭 하고 터지는 순간      ② 물이 쏟아지는 몸통     ③ 젖은 꼬리
    boom(pan) {
      if (!gate('boom', 70)) return;
      const k = rnd(0.94, 1.07);
      tone({ f0: 220 * k, f1: 48, dur: 0.30, wave: 'sine', gain: 0.34, atk: 0.002, pan, send: 0.2 });
      noise({ cut: 2200 * k, cut1: 220, dur: 0.34, gain: 0.30, filter: 'lowpass', q: 1.2, pan, send: 0.35 });
      noise({ cut: 5200, cut1: 1400, dur: 0.10, gain: 0.13, filter: 'bandpass', q: 2.5, pan, delay: 0.01 });
      duck(0.45, 0.30);
    },

    // 걸치기. 이 게임의 정체성이라 제일 예쁜 소리를 준다.
    // 연속으로 성공하면 음이 올라간다. 숫자를 안 봐도 귀로 늘어난 걸 안다
    graze(n, pan) {
      const up = Math.min(n || 1, 5);
      const base = 1180 * Math.pow(1.09, up - 1);
      tone({ f0: base, f1: base * 1.5, dur: 0.16, wave: 'sine', gain: 0.20, atk: 0.001, pan, send: 0.5 });
      tone({ f0: base * 2, f1: base * 3, dur: 0.13, wave: 'sine', gain: 0.09, atk: 0.001, pan, send: 0.6, delay: 0.012 });
      noise({ cut: 9000, dur: 0.06, gain: 0.05, filter: 'highpass', pan });
    },

    // 연쇄. 한 번 터질 때마다 반음씩 올라간다. 몇 단인지가 귀로 들린다
    chain(n, pan) {
      const f = 520 * Math.pow(1.06, Math.min(n || 1, 8));
      tone({ f0: f, f1: f * 1.9, dur: 0.14, wave: 'square', cut: 2600, gain: 0.08, pan, send: 0.3 });
    },

    // 갇혔다. 물이 차오르며 감싸는 소리
    trap(pan) {
      tone({ f0: 640, f1: 240, dur: 0.34, wave: 'triangle', gain: 0.16, pan, send: 0.3 });
      noise({ cut: 700, cut1: 3000, dur: 0.30, gain: 0.13, filter: 'bandpass', q: 3, pan });
    },

    // 스스로 빠져나왔다. 갇힘의 정확히 반대로 올라간다
    breaks(pan) {
      tone({ f0: 300, f1: 900, dur: 0.24, wave: 'triangle', gain: 0.17, pan, send: 0.3 });
      noise({ cut: 1200, cut1: 6000, dur: 0.22, gain: 0.10, filter: 'bandpass', q: 2, pan });
    },

    // 마무리. 몸으로 부딪쳐 터뜨렸다. 이 게임에서 제일 통쾌해야 하는 순간
    pop(pan) {
      tone({ f0: 1500, f1: 220, dur: 0.16, wave: 'sine', gain: 0.30, atk: 0.001, pan });
      noise({ cut: 3800, cut1: 600, dur: 0.20, gain: 0.22, filter: 'lowpass', pan, send: 0.4 });
      tone({ f0: 90, f1: 55, dur: 0.26, wave: 'sine', gain: 0.22, pan });
      duck(0.55, 0.4);
    },

    death(pan) {
      tone({ f0: 300, f1: 60, dur: 0.55, wave: 'sawtooth', cut: 1400, cut1: 200, gain: 0.16, pan, send: 0.4 });
      noise({ cut: 900, cut1: 120, dur: 0.5, gain: 0.16, pan });
    },

    item(pan) {
      tone({ f0: 880, dur: 0.07, wave: 'square', gain: 0.07, pan });
      tone({ f0: 1320, dur: 0.09, wave: 'square', gain: 0.06, pan, delay: 0.055 });
    },

    // 울트라. 네 음짜리 팡파르. 흔한 게 아니라 확실히 달라야 한다
    ultra(pan) {
      [0, 4, 7, 12].forEach((s, i) => {
        tone({ f0: hz(24 + s), dur: 0.34, wave: 'square', cut: 4200, gain: 0.13,
               pan, send: 0.5, delay: i * 0.075 });
      });
    },

    drop(pan) { tone({ f0: 700, f1: 1000, dur: 0.07, wave: 'sine', gain: 0.05, pan }); },

    // 상자가 부서진다. 제일 자주 나는 소리라 제일 작고 짧아야 한다.
    // 대신 칠 때마다 음이 흔들려서 백 번을 들어도 기계로 안 들린다
    crack(pan) {
      const k = rnd(0.85, 1.25);
      noise({ cut: 3000 * k, cut1: 900, dur: 0.09, gain: 0.10, filter: 'bandpass', q: 1.6, pan });
      tone({ f0: 190 * k, f1: 90, dur: 0.07, wave: 'triangle', gain: 0.07, pan });
    },

    // 내 발소리. 아주 작게. 없으면 걷는 게 안 느껴지고, 크면 지겹다
    step(pan) {
      if (!gate('step', 130)) return;
      noise({ cut: 1100, cut1: 400, dur: 0.05, gain: 0.030, filter: 'lowpass', pan });
    },

    // 물이 곧 찬다. 사이렌은 두 음이 엇갈릴 때 불안해진다
    warn() {
      tone({ f0: 300, f1: 220, dur: 0.5, wave: 'sawtooth', cut: 1200, gain: 0.10, send: 0.4 });
      tone({ f0: 226, f1: 300, dur: 0.5, wave: 'sawtooth', cut: 1200, gain: 0.08, send: 0.4, delay: 0.05 });
      duck(0.3, 0.6);
    },

    flood() {
      noise({ cut: 1400, cut1: 300, dur: 1.1, gain: 0.26, pan: 0, send: 0.6 });
      tone({ f0: 120, f1: 45, dur: 0.9, wave: 'sine', gain: 0.16 });
      duck(0.4, 0.8);
    },

    // 물에 잠긴 데 서 있다. 숨이 막히는 소리
    drown() {
      if (!gate('drown', 900)) return;
      noise({ cut: 500, cut1: 180, dur: 0.7, gain: 0.18, filter: 'lowpass' });
      tone({ f0: 200, f1: 90, dur: 0.6, wave: 'sine', gain: 0.12 });
    },

    tick(n) { tone({ f0: 640 + n * 60, dur: 0.09, wave: 'square', cut: 3000, gain: 0.13, send: 0.2 }); },

    // 시작. 바람 소리로 끌어올렸다가 한 방 때린다
    start() {
      noise({ cut: 300, cut1: 6000, dur: 0.45, gain: 0.14, filter: 'bandpass', q: 1 });
      tone({ f0: 300, f1: 900, dur: 0.5, wave: 'square', cut: 3000, gain: 0.10 });
      tone({ f0: 110, dur: 0.5, wave: 'sine', gain: 0.30, atk: 0.002, delay: 0.42, send: 0.4 });
    },

    win() {
      [0, 4, 7, 12, 16].forEach((s, i) => {
        tone({ f0: hz(24 + s), dur: 0.5, wave: 'square', cut: 4000, gain: 0.14,
               send: 0.55, delay: i * 0.10 });
      });
    },

    lose() {
      [0, -2, -5].forEach((s, i) => {
        tone({ f0: hz(24 + s), dur: 0.6, wave: 'triangle', gain: 0.13, send: 0.5, delay: i * 0.16 });
      });
    },
  };
})();
