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

if __name__ == '__main__':
    src = sys.argv[1]
    dst = sys.argv[2]
    expect = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    m = cut(src, dst, expect=expect)
    print('%d 조각' % len(m))
    for b in m[:8]:
        print('  %s  %dx%d  (%d,%d)' % (b['file'], b['w'], b['h'], b['x'], b['y']))
