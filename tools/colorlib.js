// tools/colorlib.js — 색을 눈이 아니라 숫자로 재는 자
//
// arttest 와 clienttest 가 같이 쓴다. 두 곳에 같은 계산을 적어두면
// 한쪽만 고쳤을 때 두 시험이 서로 다른 말을 하게 된다.
//
// 두 가지를 잰다.
//   색거리   두 색이 서로 다른 색으로 보이나 (CIE Lab)
//   대비     그 색 위의 글자가 읽히나 (WCAG 상대휘도 비)
//
// 둘은 다른 질문이다. 노랑과 하양은 색거리가 멀어도 대비는 낮다.

function rgb(hex) {
    return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
    ];
}

// sRGB 는 감마가 걸려 있다. 빛의 양으로 되돌려야 계산이 맞는다
function linear(c) {
    c /= 255;
    return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

// ── 색거리 ───────────────────────────────────────────────────
//
// RGB 로 빼면 사람 눈이 느끼는 차이와 안 맞는다.
// 초록은 조금만 달라도 크게 보이고 파랑은 많이 달라도 비슷해 보인다.
// Lab 은 그 치우침을 펴놓은 좌표계다.
// 10 아래면 나란히 놓아야 겨우 구분되고, 20 넘으면 확실히 다른 색이다
function lab(hex) {
    const [R, G, B] = rgb(hex).map(linear);

    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    const Y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;

    const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

function colorDist(a, b) {
    const p = lab(a), q = lab(b);
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ── 대비 ─────────────────────────────────────────────────────
//
// WCAG 기준. 큰 글자는 3:1, 본문 크기는 4.5:1 이 최소선이다.
// HUD 숫자는 20px 이상이라 큰 글자 쪽으로 본다
function luminance(hex) {
    const [R, G, B] = rgb(hex).map(linear);
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrast(fg, bg) {
    const a = luminance(fg), b = luminance(bg);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
}

// 반투명한 판때기를 배경 위에 올렸을 때 실제로 보이는 색.
// HUD 판때기가 rgba(10,15,22,0.72) 라 뒤의 바닥색이 28% 비친다.
// 그래서 "검은 판 위의 흰 글자" 로 계산하면 실제보다 좋게 나온다
function over(fgHex, alpha, bgHex) {
    const f = rgb(fgHex), b = rgb(bgHex);
    const mix = f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
    return '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('');
}

module.exports = { rgb, lab, colorDist, luminance, contrast, over };
