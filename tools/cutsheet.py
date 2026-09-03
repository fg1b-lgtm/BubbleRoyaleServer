# -*- coding: utf-8 -*-
# tools/cutsheet.py — 그림 시트를 낱개 스프라이트로 자른다
#
# GPT 로 만든 시트는 격자가 정확하지 않다. 몇 픽셀씩 밀리고 크기도 제각각이다.
# 그래서 격자를 믿지 않고 **투명하지 않은 덩어리**를 찾아서 자른다.
# 사이만 떨어져 있으면 몇 픽셀 밀려도 상관없다.
#
# 무지개 잔상(알파 40 이하)은 걸러낸다. 완전 투명이 아니라 옅게 남아 있어서
# 그냥 alpha>0 으로 자르면 시트 전체가 한 덩어리가 된다.
import sys, os, json
from collections import deque
from PIL import Image

ALPHA_MIN = 90      # 이보다 옅으면 배경으로 본다
MIN_CELLS = 200     # 이보다 작은 덩어리는 먼지로 본다


def _split_rows(im, blobs, expect, row_h):
    """줄마다 expect 개가 되게 넓은 덩어리를 쪼갠다"""
    px = im.load()
    rows = {}
    for b in blobs:
        rows.setdefault(b[1] // row_h, []).append(b)

    out = []
    for key in sorted(rows):
        row = sorted(rows[key], key=lambda b: b[0])
        while len(row) < expect:
            # 제일 넓은 것을 고른다
            i = max(range(len(row)), key=lambda k: row[k][2] - row[k][0])
            x0, y0, x1, y1, n = row[i]
            w = x1 - x0 + 1
            if w < 24:
                break            # 더 쪼갤 게 없다

            # 가운데 절반 안에서 알파가 제일 옅은 세로줄을 찾는다.
            # 가장자리에서 자르면 스프라이트 하나가 조각난다
            best, best_v = None, None
            for x in range(x0 + w // 4, x1 - w // 4 + 1):
                v = 0
                for y in range(y0, y1 + 1):
                    if px[x, y][3] >= 90:
                        v += 1
                if best_v is None or v < best_v:
                    best, best_v = x, v

            row.pop(i)
            row.append([x0, y0, best - 1, y1, n // 2])
            row.append([best + 1, y0, x1, y1, n // 2])
            row.sort(key=lambda b: b[0])
        out.extend(row)
    return out

def cut(path, out_dir, alpha_min=ALPHA_MIN, min_cells=MIN_CELLS,
        expect=0, row_h=150):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    px = im.load()

    solid = bytearray(W * H)
    for y in range(H):
        base = y * W
        for x in range(W):
            if px[x, y][3] >= alpha_min:
                solid[base + x] = 1

    seen = bytearray(W * H)
    blobs = []
    for y in range(H):
        for x in range(W):
            i = y * W + x
            if not solid[i] or seen[i]:
                continue
            q = deque([(x, y)])
            seen[i] = 1
            x0 = x1 = x
            y0 = y1 = y
            n = 0
            while q:
                cx, cy = q.popleft()
                n += 1
                if cx < x0: x0 = cx
                if cx > x1: x1 = cx
                if cy < y0: y0 = cy
                if cy > y1: y1 = cy
                # 대각선도 잇는다. 도트 그림은 모서리로만 붙은 자리가 흔하다
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < W and 0 <= ny < H:
                            j = ny * W + nx
                            if solid[j] and not seen[j]:
                                seen[j] = 1
                                q.append((nx, ny))
            if n < min_cells:
                continue
            blobs.append([x0, y0, x1, y1, n])

    # 줄마다 개수가 정해져 있으면, 모자란 줄은 붙은 것을 쪼갠다.
    #
    # GPT 는 스프라이트 사이를 넉넉히 띄우라고 해도 가끔 붙여 놓는다.
    # 붙으면 덩어리 하나로 잡히고, 그러면 그 줄만 칸 수가 어긋난다.
    # 제일 넓은 덩어리를 **알파가 제일 옅은 세로줄**에서 자른다 —
    # 두 스프라이트가 닿은 자리는 대개 거기다
    if expect:
        blobs = _split_rows(im, blobs, expect, row_h)

    # 읽는 순서대로 (위에서 아래, 왼쪽에서 오른쪽).
    # 세로로 40픽셀 안이면 같은 줄로 본다 — 시트가 조금씩 밀려 있기 때문이다
    blobs.sort(key=lambda b: (b[1] // 40, b[0]))

    os.makedirs(out_dir, exist_ok=True)
    meta = []
    for i, (x0, y0, x1, y1, n) in enumerate(blobs):
        sub = im.crop((x0, y0, x1 + 1, y1 + 1))
        # 옅은 잔상을 지운다. 안 지우면 확대했을 때 무지개 테가 보인다
        d = sub.load()
        for yy in range(sub.height):
            for xx in range(sub.width):
                r, g, b, a = d[xx, yy]
                d[xx, yy] = (r, g, b, 0) if a < alpha_min else (r, g, b, 255)
        name = '%03d.png' % i
        sub.save(os.path.join(out_dir, name))
        meta.append({'file': name, 'x': x0, 'y': y0,
                     'w': x1 - x0 + 1, 'h': y1 - y0 + 1, 'cells': n})

    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    return meta

def cut_grid(path, out_dir, alpha_min=ALPHA_MIN, gap=3):
    """빈 띠를 찾아 격자로 자른다.

    덩어리로 자르는 방식이 안 맞는 시트가 있다. 물방울처럼 본체에서 떨어져
    나온 점이 있으면 한 스프라이트가 여러 조각으로 갈린다 — 갇힌 모습 시트가
    48칸인데 121개로 잘렸다.

    그런 시트는 스프라이트 사이가 **완전히 비어 있다.** 그 빈 띠를 경계로 쓴다.
    먼저 세로로 빈 띠를 찾아 칸을 가르고, 각 칸 안에서 다시 가로로 빈 띠를 찾는다.
    가로 띠를 시트 전체에서 찾으면 안 된다 — 옆 칸의 물방울이 걸쳐 있으면
    그 줄은 안 비어서 못 찾는다"""
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    px = im.load()

    solid = [[px[x, y][3] >= alpha_min for x in range(W)] for y in range(H)]

    def bands(mask_len, filled):
        """비어 있는 구간들 사이의 알맹이 구간을 돌려준다"""
        out, s = [], None
        run = 0
        for i in range(mask_len):
            if filled(i):
                if s is None:
                    s = i
                run = 0
            else:
                run += 1
                if s is not None and run >= gap:
                    out.append((s, i - run))
                    s = None
        if s is not None:
            out.append((s, mask_len - 1))
        return out

    colspan = bands(W, lambda x: any(solid[y][x] for y in range(H)))

    os.makedirs(out_dir, exist_ok=True)
    meta = []
    for (x0, x1) in colspan:
        rowspan = bands(H, lambda y: any(solid[y][x] for x in range(x0, x1 + 1)))
        for (y0, y1) in rowspan:
            sub = im.crop((x0, y0, x1 + 1, y1 + 1))
            bb = sub.getbbox()
            if not bb:
                continue
            sub = sub.crop(bb)
            d = sub.load()
            for yy in range(sub.height):
                for xx in range(sub.width):
                    r, g, b, aa = d[xx, yy]
                    d[xx, yy] = (r, g, b, 0) if aa < alpha_min else (r, g, b, 255)
            meta.append({'sub': sub, 'x': x0 + bb[0], 'y': y0 + bb[1],
                         'w': sub.width, 'h': sub.height})

    # 읽는 순서대로. 세로로 가까우면 같은 줄로 본다
    meta.sort(key=lambda m: (m['y'] // 60, m['x']))
    for i, m in enumerate(meta):
        m['file'] = '%03d.png' % i
        m.pop('sub').save(os.path.join(out_dir, m['file']))

    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    return meta

def cut_even(path, out_dir, rows=8, alpha_min=ALPHA_MIN, gap=3):
    """세로는 빈 띠로, 가로는 등분해서 자른다.

    갇힌 모습 시트가 이렇다. 칸 사이가 세로로는 비어 있는데 가로로는 안 비어
    있다 — 물방울에서 떨어져 나온 점이 위아래 칸에 걸쳐 있기 때문이다.
    덩어리로 자르면 48칸이 121개로 갈리고, 빈 띠로만 자르면 36개로 뭉친다.

    줄 간격이 고르므로 세로만 빈 띠로 가르고 가로는 등분한다.
    등분한 뒤 각 칸에서 알맹이만 다시 오려내므로 몇 픽셀 어긋나도 괜찮다"""
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    px = im.load()

    solid = [[px[x, y][3] >= alpha_min for x in range(W)] for y in range(H)]

    spans, s, run = [], None, 0
    for x in range(W):
        if any(solid[y][x] for y in range(H)):
            if s is None:
                s = x
            run = 0
        else:
            run += 1
            if s is not None and run >= gap:
                spans.append((s, x - run))
                s = None
    if s is not None:
        spans.append((s, W - 1))

    ys = [y for y in range(H) if any(solid[y][x] for x in range(W))]
    if not ys:
        return []
    y0, y1 = min(ys), max(ys)
    step = (y1 - y0 + 1) / rows

    os.makedirs(out_dir, exist_ok=True)
    meta = []
    for ci, (x0, x1) in enumerate(spans):
        for r in range(rows):
            a0 = int(y0 + r * step)
            a1 = int(y0 + (r + 1) * step) - 1
            sub = im.crop((x0, a0, x1 + 1, a1 + 1))
            bb = sub.getbbox()
            if not bb:
                continue
            sub = sub.crop(bb)
            if sub.width < 20 or sub.height < 20:
                continue
            d = sub.load()
            for yy in range(sub.height):
                for xx in range(sub.width):
                    rr, gg, bb2, aa = d[xx, yy]
                    d[xx, yy] = (rr, gg, bb2, 0) if aa < alpha_min else (rr, gg, bb2, 255)
            f = '%d_%d.png' % (r, ci)
            sub.save(os.path.join(out_dir, f))
            meta.append({'file': f, 'row': r, 'col': ci,
                         'w': sub.width, 'h': sub.height})

    with open(os.path.join(out_dir, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    return meta

if __name__ == '__main__':
    src = sys.argv[1]
    dst = sys.argv[2]
    expect = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    m = cut(src, dst, expect=expect)
    print('%d 조각' % len(m))
    for b in m[:8]:
        print('  %s  %dx%d  (%d,%d)' % (b['file'], b['w'], b['h'], b['x'], b['y']))


def cut_grid_even(path, out_dir, cols, rows, alpha_min=ALPHA_MIN):
    """알맹이가 든 네모를 cols x rows 로 등분한다.

    덩어리로 자르면 걷기 시트가 **한 칸씩 밀렸다.** 96조각이 나와서 됐다고
    봤는데, 조각 경계가 한 군데 어긋나서 왼쪽 걷기 셋째 프레임 자리에
    오른쪽 걷기 첫 프레임이 들어갔다. 왼쪽으로 걸으면 세 걸음에 한 번
    오른쪽을 보는 게 그것이었다.

    시트가 반듯한 격자면 등분이 제일 안전하다. 덩어리 찾기는 팔이 옆 칸에
    닿거나 그림자가 이어지면 언제든 어긋난다 - 어긋나도 개수는 맞아서
    **틀린 걸 개수로는 못 잡는다.**

    등분한 뒤 각 칸에서 알맹이만 다시 오려내므로 몇 픽셀 어긋나도 괜찮다"""
    im = Image.open(path).convert('RGBA')
    bb = im.getbbox()
    if not bb:
        return []
    x0, y0, x1, y1 = bb
    cw = (x1 - x0) / cols
    ch = (y1 - y0) / rows

    os.makedirs(out_dir, exist_ok=True)
    meta = []
    for r in range(rows):
        for c in range(cols):
            a0 = int(x0 + c * cw); a1 = int(x0 + (c + 1) * cw)
            b0 = int(y0 + r * ch); b1 = int(y0 + (r + 1) * ch)
            sub = im.crop((a0, b0, a1, b1))
            box = _center_blob(sub, alpha_min)
            if not box:
                continue
            sub = sub.crop(box)
            name = 'r%02dc%02d.png' % (r, c)
            sub.save(os.path.join(out_dir, name))
            meta.append({'file': name, 'row': r, 'col': c,
                         'w': sub.width, 'h': sub.height})
    return meta


def _center_blob(im, alpha_min):
    """칸 가운데에 붙어 있는 덩어리만 남긴다.

    등분한 칸에는 옆 칸 그림이 몇 픽셀 딸려 들어온다. 칸 경계가 딱 떨어지지
    않기 때문이다. 그대로 getbbox 를 하면 그 부스러기까지 품어서 조각이
    옆으로 늘어나고, 아틀라스에 담을 때 캐릭터가 한쪽으로 쏠린다.

    빈 줄로 끊어서 **가운데를 품은 토막**만 고른다. 부스러기는 사이에 빈 줄이
    있어서 다른 토막이 된다"""
    W, H = im.size
    px = im.load()

    def runs(n, filled):
        out, s = [], None
        for i in range(n):
            if filled(i):
                if s is None:
                    s = i
            elif s is not None:
                out.append((s, i - 1)); s = None
        if s is not None:
            out.append((s, n - 1))
        return out

    cols = runs(W, lambda x: any(px[x, y][3] >= alpha_min for y in range(H)))
    if not cols:
        return None
    cx = W // 2
    span = next((c for c in cols if c[0] <= cx <= c[1]), None)
    if span is None:                       # 가운데가 비었다. 제일 넓은 토막
        span = max(cols, key=lambda c: c[1] - c[0])
    x0, x1 = span

    rows = runs(H, lambda y: any(px[x, y][3] >= alpha_min for x in range(x0, x1 + 1)))
    if not rows:
        return None
    y0, y1 = rows[0][0], rows[-1][1]
    return (x0, y0, x1 + 1, y1 + 1)
