// web/fx.js — 파티클과 카메라
//
// 게임이 "손맛이 있다" 고 느껴지는 것의 절반이 여기 있다.
// 규칙이 아무리 좋아도 때렸을 때 화면이 가만히 있으면 안 때린 것 같다.
//
// ── 카메라가 하는 일 ────────────────────────────────────────
//
// 흔들림(shake)
//   폭발이 나면 화면이 흔들린다. 다만 세기를 바로 넣지 않고 **쌓았다가 제곱해서** 쓴다.
//   그래야 작은 것 여러 개는 조금만 흔들리고 큰 것 하나는 확 흔들린다.
//   선형으로 하면 자잘한 게 겹칠 때 화면이 멀미 나게 떨린다.
//
// 멈춤(hit stop)
//   사람을 잡은 순간 화면이 아주 잠깐 멈춘다. 60ms 남짓.
//   맞은 게 아니라 **맞혔다**는 걸 몸으로 알리는 장치다. 격투게임이 다 쓴다.
//
// 번쩍임(flash)
//   화면 전체가 한 프레임 하얘진다. 아주 아껴서 써야 한다.
const FX = (() => {

  let parts = [];
  let trauma = 0;        // 0..1. 흔들림의 원인. 제곱해서 쓴다
  let stopUntil = 0;     // 이 시각까지 화면이 멈춘다
  let flash = null;
  let zoom = 0;          // 순간적으로 확 당겼다 돌아온다

  const rnd = (a, b) => a + Math.random() * (b - a);

  // 파티클 하나. 종류를 나누지 않고 성질만 다르게 준다.
  //   grav  아래로 끌리는 정도
  //   drag  느려지는 정도
  //   glow  가산 합성으로 그릴 것인가 (밝은 것)
  function emit(o) {
    parts.push({
      x: o.x, y: o.y,
      vx: o.vx || 0, vy: o.vy || 0,
      r: o.r || 2, r1: (o.r1 === undefined ? 0 : o.r1),
      color: o.color || '#fff',
      grav: o.grav || 0, drag: o.drag === undefined ? 0.92 : o.drag,
      born: o.now, life: o.life || 400,
      glow: !!o.glow, shape: o.shape || 'dot',
      rot: o.rot || 0, spin: o.spin || 0,
    });
    if (parts.length > 900) parts.splice(0, 200);   // 폭주 방지
  }

  return {
    // ── 카메라 ─────────────────────────────────────────────────
    shake(amount) { trauma = Math.min(1, trauma + amount); },
    stop(ms, now)  { stopUntil = Math.max(stopUntil, now + ms); },
    punch(z)       { zoom = Math.max(zoom, z); },
    flashOut(color, ms, now) { flash = { color, born: now, life: ms }; },

    frozen(now) { return now < stopUntil; },

    // 흔들림과 확대를 적용한다. 그린 뒤에 반드시 restore 를 부른다
    apply(g, now, w, h, dt) {
      trauma = Math.max(0, trauma - dt * 0.0022);
      zoom   = Math.max(0, zoom - dt * 0.004);

      const s = trauma * trauma;          // 제곱. 작은 건 거의 안 흔들린다
      const ang = now * 0.05;
      const dx = Math.sin(ang * 1.7) * s * 14;
      const dy = Math.cos(ang * 2.3) * s * 14;
      const k  = 1 + zoom * 0.03;

      g.save();
      g.translate(w / 2, h / 2);
      g.scale(k, k);
      g.translate(-w / 2 + dx, -h / 2 + dy);
    },

    done(g) { g.restore(); },

    drawFlash(g, now, w, h) {
      if (!flash) return;
      const t = (now - flash.born) / flash.life;
      if (t >= 1) { flash = null; return; }
      g.save();
      g.globalAlpha = (1 - t) * (1 - t);
      g.fillStyle = flash.color;
      g.fillRect(0, 0, w, h);
      g.restore();
    },

    // ── 만들어 내는 것들 ───────────────────────────────────────

    // 물풍선이 터진다. 물이 사방으로 튀고, 바닥에 파문이 퍼지고, 안개가 남는다
    burstWater(x, y, T, now, big) {
      const n = big ? 16 : 9;
      for (let i = 0; i < n; ++i) {
        const a = rnd(0, 6.283);
        const v = T * rnd(0.03, 0.11) * (big ? 1.3 : 1);
        emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - T * 0.02,
               r: T * rnd(0.05, 0.13), r1: 0, color: '#bfe8ff',
               grav: T * 0.0016, drag: 0.94, life: rnd(320, 620), now, glow: true });
      }
      for (let i = 0; i < 4; ++i) {
        emit({ x: x + rnd(-T * .3, T * .3), y: y + rnd(-T * .3, T * .3),
               vx: rnd(-.2, .2), vy: rnd(-.3, -.05),
               r: T * rnd(0.25, 0.5), r1: T * 0.9, color: 'rgba(190,225,245,0.30)',
               drag: 0.97, life: rnd(500, 900), now, shape: 'soft' });
      }
      emit({ x, y, r: T * 0.2, r1: T * (big ? 2.4 : 1.7), color: '#e8f8ff',
             life: 380, now, shape: 'ring', glow: true });
    },

    // 물줄기가 뻗어나간 칸. 중심이 아니라서 작게만 튄다.
    // 여기에 큰 고리를 그리면 칸마다 원이 생겨서 사거리를 못 읽는다
    splash(x, y, T, now) {
      for (let i = 0; i < 4; ++i) {
        const a = rnd(0, 6.283);
        const v = T * rnd(0.02, 0.05);
        emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - T * 0.015,
               r: T * rnd(0.04, 0.08), color: '#dff3ff',
               grav: T * 0.0014, drag: 0.94, life: rnd(200, 380), now, glow: true });
      }
    },

    // 상자가 부서진다. 그냥 사라지면 부순 게 아니라 지워진 것처럼 보인다
    breakCrate(x, y, T, now, color, edge) {
      for (let i = 0; i < 8; ++i) {
        const a = (i / 8) * 6.283 + rnd(-.4, .4);
        const v = T * rnd(0.04, 0.10);
        emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - T * 0.05,
               r: T * rnd(0.10, 0.20), color: i % 3 ? color : edge,
               grav: T * 0.0028, drag: 0.97, life: rnd(380, 620), now,
               shape: 'chip', rot: rnd(0, 6.28), spin: rnd(-.4, .4) });
      }
      for (let i = 0; i < 5; ++i) {
        emit({ x: x + rnd(-T * .3, T * .3), y: y + rnd(-T * .2, T * .3),
               vx: rnd(-.15, .15), vy: rnd(-.2, -.02),
               r: T * rnd(0.15, 0.3), r1: T * 0.6, color: 'rgba(200,190,170,0.35)',
               drag: 0.96, life: rnd(300, 520), now, shape: 'soft' });
      }
    },

    // 걸치기. 이 게임에서 제일 큰 리턴이라 연출을 제일 아끼지 않는다.
    // 겹 수가 연속 성공 횟수다. 숫자를 안 읽어도 늘어난 게 보인다
    graze(x, y, T, now, n) {
      const k = Math.min(n || 1, 5);
      for (let i = 0; i < k; ++i) {
        emit({ x, y, r: T * 0.2, r1: T * (1.1 + i * 0.5), color: '#7fe3ff',
               life: 420 + i * 60, now, shape: 'ring', glow: true });
      }
      for (let i = 0; i < 5 + k * 2; ++i) {
        const a = rnd(0, 6.283);
        emit({ x, y, vx: Math.cos(a) * T * 0.06, vy: Math.sin(a) * T * 0.06,
               r: T * 0.06, color: '#d7f6ff', drag: 0.9, life: rnd(260, 440), now, glow: true });
      }
    },

    // 사람을 잡았다. 이 게임에서 제일 통쾌해야 하는 순간
    kill(x, y, T, now, color) {
      emit({ x, y, r: T * 0.2, r1: T * 3.0, color: '#fff', life: 300, now, shape: 'ring', glow: true });
      emit({ x, y, r: T * 0.2, r1: T * 2.0, color: color, life: 460, now, shape: 'ring', glow: true });
      for (let i = 0; i < 22; ++i) {
        const a = rnd(0, 6.283);
        const v = T * rnd(0.05, 0.17);
        emit({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
               r: T * rnd(0.05, 0.12), color: i % 2 ? '#ffffff' : color,
               grav: T * 0.0012, drag: 0.93, life: rnd(380, 700), now, glow: true });
      }
    },

    // 걸을 때 발밑에서 이는 먼지. 아주 작게. 없으면 걷는 게 안 느껴진다
    step(x, y, T, now) {
      emit({ x: x + rnd(-T * .12, T * .12), y, vx: rnd(-.05, .05), vy: rnd(-.06, -.01),
             r: T * 0.08, r1: T * 0.22, color: 'rgba(255,255,255,0.22)',
             drag: 0.94, life: 300, now, shape: 'soft' });
    },

    // 물 위를 걸으면 파문이 퍼진다
    ripple(x, y, T, now) {
      emit({ x, y, r: T * 0.15, r1: T * 0.75, color: 'rgba(220,245,255,0.55)',
             life: 620, now, shape: 'ring' });
    },

    // 아이템을 먹었다. 위로 빨려 올라간다
    pickup(x, y, T, now, color) {
      for (let i = 0; i < 8; ++i) {
        const a = rnd(0, 6.283);
        emit({ x: x + Math.cos(a) * T * 0.4, y: y + Math.sin(a) * T * 0.4,
               vx: Math.cos(a) * -T * 0.02, vy: -T * rnd(0.03, 0.07),
               r: T * 0.07, color, drag: 0.9, life: rnd(300, 480), now, glow: true });
      }
    },

    // 비. 곧 물이 차는 구역에 내린다. 예고를 붉은 테두리로만 하면 UI 고,
    // 비가 내리기 시작하면 그건 세계에서 일어나는 일이 된다
    rain(x0, y0, w, h, T, now, count) {
      for (let i = 0; i < count; ++i) {
        emit({ x: x0 + Math.random() * w, y: y0 + Math.random() * h - T,
               vx: T * 0.004, vy: T * 0.09,
               r: T * 0.035, color: 'rgba(180,215,240,0.55)',
               drag: 1, life: 420, now, shape: 'drop' });
      }
    },

    reset() { parts = []; trauma = 0; flash = null; zoom = 0; },
    count() { return parts.length; },

    // ── 그리기 ─────────────────────────────────────────────────
    draw(g, now) {
      let normal = false, glow = false;

      // 두 번 돈다. 밝은 것을 몰아서 가산 합성으로 그리기 위해서다.
      // 섞어 그리면 합성 모드를 파티클마다 바꿔야 해서 훨씬 느리다
      for (let pass = 0; pass < 2; ++pass) {
        if (pass === 1) { g.save(); g.globalCompositeOperation = 'lighter'; }

        for (let i = 0; i < parts.length; ++i) {
          const p = parts[i];
          if (!!p.glow !== !!pass) continue;

          const t = (now - p.born) / p.life;
          if (t >= 1) continue;

          // 자리를 속도로 누적하지 않고 t 로 정한다.
          // 프레임이 밀려도 같은 시각에 같은 데 있게 하려는 것이다
          const k = t * 22;
          const damp = p.drag === 1 ? k : (1 - Math.pow(p.drag, k)) / (1 - p.drag);
          const x = p.x + p.vx * damp;
          const y = p.y + p.vy * damp + p.grav * k * k;

          g.globalAlpha = (1 - t) * (1 - t);

          if (p.shape === 'ring') {
            const r = p.r + (p.r1 - p.r) * (1 - Math.pow(1 - t, 3));
            g.strokeStyle = p.color;
            g.lineWidth = Math.max(1, (p.r1 - p.r) * 0.10 * (1 - t) + 1);
            g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
          }
          else if (p.shape === 'chip') {
            g.save();
            g.translate(x, y);
            g.rotate(p.rot + p.spin * k);
            g.fillStyle = p.color;
            g.fillRect(-p.r / 2, -p.r / 2, p.r, p.r);
            g.restore();
          }
          else if (p.shape === 'soft') {
            const r = p.r + (p.r1 - p.r) * t;
            const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(0.5, r));
            grad.addColorStop(0, p.color);
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grad;
            g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
          }
          else if (p.shape === 'drop') {
            g.strokeStyle = p.color;
            g.lineWidth = Math.max(1, p.r);
            g.beginPath();
            g.moveTo(x, y); g.lineTo(x - p.vx * 3, y - p.vy * 3);
            g.stroke();
          }
          else {
            g.fillStyle = p.color;
            g.beginPath(); g.arc(x, y, p.r * (1 - t * 0.4), 0, 7); g.fill();
          }
        }

        if (pass === 1) g.restore();
      }

      g.globalAlpha = 1;
      parts = parts.filter(p => now - p.born < p.life);
    },
  };
})();
