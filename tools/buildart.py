# -*- coding: utf-8 -*-
# tools/buildart.py — 그림 시트를 게임이 쓰는 아틀라스로 굽는다
#
#   python tools/buildart.py
#
# 시트 -> 조각(cutsheet) -> 아틀라스 한 장 + 색인 한 장.
# 시트가 바뀌면 이것만 다시 돌리면 된다. 손으로 자르지 않는다.
#
# 캐릭터 시트는 한 줄이 한 사람이고, 한 줄에 열두 칸이다.
#   0 1 2  앞     3 4 5  뒤     6 7 8  왼쪽     9 10 11  오른쪽
# 세 칸이 걷기 세 프레임이다.
import os, sys, json
from collections import deque
from PIL import Image, ImageEnhance

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cutsheet import cut, cut_even
from atlas import build

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'web', 'art', 'src')
OUT  = os.path.join(ROOT, 'web', 'art')
TMP  = os.path.join(OUT, '_cut')

# 시트마다 여덟 명. 순서는 그림 시트의 줄 순서 그대로다
NAMES = [
    ['red', 'blue', 'pink', 'frog', 'miner', 'cat', 'panda', 'penguin'],
    ['tech', 'cowboy', 'bunny', 'dino', 'space', 'witch', 'shark', 'ninja'],
    ['chef', 'fox', 'vampire', 'unicorn', 'pilot', 'devil', 'angel', 'robot'],
]

DIRS = ['d', 'u', 'l', 'r']          # 앞 · 뒤 · 왼 · 오

# 아틀라스 칸 크기. 화면에서는 이보다 작게 그리지만,
# 크게 담아두고 줄이는 편이 낫다 — 타일 크기가 32 일 때도 48 일 때도 쓴다
CELL_W, CELL_H = 72, 88


def load_grid(sheet, cols, rows):
    """시트를 잘라 cols x rows 격자에 **자리로** 앉힌다.

    전에는 잘라낸 순서대로 담았다. 개수가 96개로 맞아서 다 된 줄 알았는데,
    조각 경계가 한 군데 어긋나 있었다. 왼쪽 걷기 셋째 프레임 자리에 오른쪽
    걷기 첫 프레임이 들어갔고, 왼쪽으로 걸으면 세 걸음에 한 번 오른쪽을 봤다.
    "캐릭터가 자꾸 뒤돌아본다" 가 그것이었다.

    **개수가 맞는 것과 자리가 맞는 것은 다르다.** 순서로 담으면 한 군데만
    어긋나도 그 뒤가 전부 한 칸씩 밀린다. 조각이 시트에서 있던 자리로 앉히면
    한 군데가 틀려도 거기만 틀린다.

    그리고 자리로 앉히면 **빈 칸과 겹친 칸이 보인다.** 순서로 담으면
    안 보인다 - 개수만 세고 있었기 때문에 못 봤던 것이 이거다"""
    d = os.path.join(TMP, sheet)
    meta = cut(os.path.join(SRC, sheet + '.png'), d, expect=cols)

    cx = [m['x'] + m['w'] / 2.0 for m in meta]
    cy = [m['y'] + m['h'] / 2.0 for m in meta]
    x0, x1 = min(cx), max(cx)
    y0, y1 = min(cy), max(cy)

    grid = [[None] * cols for _ in range(rows)]
    clash = 0
    for m, mx, my in zip(meta, cx, cy):
        c = int(round((mx - x0) / (x1 - x0) * (cols - 1))) if x1 > x0 else 0
        r = int(round((my - y0) / (y1 - y0) * (rows - 1))) if y1 > y0 else 0
        c = max(0, min(cols - 1, c))
        r = max(0, min(rows - 1, r))
        if grid[r][c] is not None:
            clash += 1
        grid[r][c] = Image.open(os.path.join(d, m['file'])).convert('RGBA')

    empty = sum(1 for row in grid for v in row if v is None)
    if clash or empty:
        print('!! %s : 한 자리에 두 조각 %d개, 빈 자리 %d개 (조각 %d개)'
              % (sheet, clash, empty, len(meta)))
    return grid


def _diff(a, b):
    """두 조각이 얼마나 다른가. 0 이면 같은 그림이다"""
    n = 48
    a = a.resize((n, n), Image.BOX).convert('L')
    b = b.resize((n, n), Image.BOX).convert('L')
    pa, pb = a.load(), b.load()
    s = 0
    for y in range(n):
        for x in range(n):
            d = pa[x, y] - pb[x, y]
            s += d if d > 0 else -d
    return s / float(n * n)


def check_facing(pieces):
    """왼쪽 걷기 세 프레임이 정말 다 왼쪽을 보나.

    개수만 세고 있었더니 한 프레임이 반대쪽에서 온 걸 못 잡았다.
    왼쪽으로 걸으면 세 걸음에 한 번 오른쪽을 봤고, 손으로는 "캐릭터가 자꾸
    뒤돌아본다" 로 느껴졌다. 화면 코드를 아무리 봐도 안 나오는 종류의 버그다.

    같은 방향 세 프레임은 서로 닮았고, 반대 방향과는 덜 닮는다.
    셋 중 하나가 제 식구보다 반대쪽과 더 닮으면 그 자리가 틀린 것이다"""
    d = dict(pieces)
    bad = []
    for name in sorted(set(k.rsplit('_', 1)[0] for k in d)):
        for face, other in (('l', 'r'), ('r', 'l')):
            f = [d.get('%s_%s%d' % (name, face, i)) for i in range(3)]
            o = [d.get('%s_%s%d' % (name, other, i)) for i in range(3)]
            if any(v is None for v in f + o):
                continue
            for i in range(3):
                mine  = min(_diff(f[i], f[j]) for j in range(3) if j != i)
                theirs = min(_diff(f[i], o[j]) for j in range(3))
                if theirs < mine:
                    bad.append('%s_%s%d' % (name, face, i))

    if bad:
        print('!! 방향이 뒤바뀐 프레임 %d개: %s' % (len(bad), ', '.join(bad[:8])))
    else:
        print('걷기 프레임 방향 확인: 스물넷 다 제자리다')


def main():
    pieces = []

    # ── 캐릭터 ───────────────────────────────────────────────
    for si, sheet in enumerate(['walk_a', 'walk_b', 'walk_c']):
        grid = load_grid(sheet, 12, 8)
        for row in range(8):
            name = NAMES[si][row]
            for col in range(12):
                im = grid[row][col]
                if im is None:
                    continue
                d = DIRS[col // 3]
                f = col % 3
                pieces.append(('%s_%s%d' % (name, d, f), im))

    check_facing(pieces)

    size, n = build(pieces,
                    os.path.join(OUT, 'chars.png'),
                    os.path.join(OUT, 'chars.json'),
                    CELL_W, CELL_H, cols=24)
    print('캐릭터 아틀라스 %s, %d칸' % (size, n))

    # ── 물풍선 ───────────────────────────────────────────────
    #
    # 시트에는 물줄기 조각(가운데 · 팔 · 끝)과 차오른 물, 웅덩이도 들어 있는데
    # 안 쓴다. 물줄기는 이어 붙여 봤더니 마디가 보였다 — 조각마다 둥근 외곽선과
    # 물방울이 있어서, 딱 붙여도 경계가 남고 겹치면 사거리보다 넓어 보였다.
    # 지금은 화면에서 직접 그린다 (art.js 의 drawBlastTile).
    #
    # 시트에서 몇 번째 조각이 무엇인지는 눈으로 보고 정했다. 자동으로 알아낼
    # 방법이 없진 않지만, 넷을 위해 판별기를 만드는 건 배보다 배꼽이다
    WATER = {
        'balloon0':   5,    # 갓 놓았다
        'balloon1':   0,    # 부풀었다
        'balloon2':   1,    # 더 부풀었다
        'balloon_hot': 2,   # 곧 터진다 (빨강)
    }
    d = os.path.join(TMP, 'water')
    meta = cut(os.path.join(SRC, 'water.png'), d)
    imgs = [Image.open(os.path.join(d, m['file'])).convert('RGBA') for m in meta]

    # 비율을 지킨다. 늘리면 찌그러진 풍선이 된다
    fx = [(k, imgs[v]) for k, v in WATER.items() if v < len(imgs)]

    size, n = build(fx,
                    os.path.join(OUT, 'fx.png'),
                    os.path.join(OUT, 'fx.json'),
                    96, 96, cols=4, fit='center')
    print('물풍선 아틀라스 %s, %d칸' % (size, n))

    # ── 갇힌 모습 ────────────────────────────────────────────
    #
    # 물줄기에 맞으면 바로 안 죽고 물방울에 갇힌다. 7초 동안 갇혀 있다가
    # 누가 몸으로 부딪치면 터지고 아니면 풀린다. 그 7초가 이 게임에서
    # 제일 긴장되는 시간인데 그림이 없었다.
    #
    # 한 줄이 한 사람, 여섯 칸이 상태다.
    #   0 1 2  갇혀 있다 (세 프레임)   3 빠져나온다   4 터진다   5 뻗었다
    #
    # 시트 순서가 걷기 시트와 다르다. 그림을 보고 맞췄다
    TRAP_ORDER = {'trap_b': 0, 'trap_c': 1, 'trap_a': 2}
    TRAP_COL = ['trap0', 'trap1', 'trap2', 'free', 'pop', 'ko']

    tp = []
    for sheet, si in sorted(TRAP_ORDER.items(), key=lambda kv: kv[1]):
        d = os.path.join(TMP, sheet)
        meta = cut_even(os.path.join(SRC, sheet + '.png'), d, rows=8)
        if len(meta) != 48:
            print('!! %s 가 48칸이 아니다 (%d)' % (sheet, len(meta)))
        for m in meta:
            if m['col'] >= len(TRAP_COL):
                continue
            name = NAMES[si][m['row']] + '_' + TRAP_COL[m['col']]
            tp.append((name, Image.open(os.path.join(d, m['file'])).convert('RGBA')))

    size, n = build(tp,
                    os.path.join(OUT, 'trap.png'),
                    os.path.join(OUT, 'trap.json'),
                    88, 88, cols=24, fit='center')
    print('갇힘 아틀라스 %s, %d칸' % (size, n))

    build_tiles()



# ── 판 타일 ──────────────────────────────────────────────────
#
# 사람이 만들어 온 마을 타일 108장이다. 캐릭터 아틀라스와 담는 방식이 다르다.
#
# 캐릭터는 칸 크기를 정해놓고 그 안에 앉히면 된다. 판 타일은 그러면 안 된다 -
# 나무는 한 칸 폭에 한 칸 반 높이고, 가로등은 두 칸 높이고, 집은 두 칸 폭이다.
# 억지로 같은 칸에 넣으면 나무가 눌리고 집이 찌그러진다.
#
# **PNG 의 가로가 곧 한 칸**이다 (집과 우물만 두 칸). 그 비율로 담고, 몇 칸
# 폭인지와 원래 비율을 색인에 적어둔다. 화면은 아랫변을 칸 바닥에 붙이고
# 위로 솟게 그린다 - 앞뒤 순서를 발밑 y 로 정하는 규칙과 그대로 맞는다.
TILE_W = 96          # 한 칸을 아틀라스에서 몇 픽셀로 담나

# 두 칸을 차지하는 것들. 나머지는 다 한 칸이다
TILE_WIDE = {'house': 2, 'well': 2, 'desert_house_red': 2, 'desert_house_blue': 2,
             'desert_market': 2, 'desert_palm_big': 2, 'desert_rock_big': 2,
             'desert17_tent': 2, 'desert17_bazaar': 2,
             'snow_castle': 2, 'snow_igloo': 2, 'snow_spring': 2}

# 바닥으로 까는 타일. 테두리를 잘라낸다.
#
# 그림 시트의 타일은 한 장씩 알아보기 쉬우라고 가장자리를 어둡게 그려놨다.
# 그대로 깔면 판 전체에 검은 격자가 생긴다. 잔디밭이 아니라 타일 바닥이 된다.
#
# 가운데만 남기면 이어 깔았을 때 이음매가 안 보인다. 안쪽 무늬는 잔풀과
# 모래알이라 잘라내도 티가 안 난다
FLOOR_TRIM = 0.09


def is_floor(name):
    for head in ('grass', 'dirt_', 'water_', 'desert_sand_0', 'desert_sand_1',
                 'desert_water_', 'desert_carpet',
                 'desert17_sand_', 'desert17_pave_', 'snow_floor_'):
        if name.startswith(head):
            return True
    return False


# 눈 맵 시트는 한 장에 바닥·소품·건물·상자가 함께 있다. 좌표를 이곳 한 군데에
# 적어두면 원본을 바꿔도 어떤 조각을 어디서 잘랐는지 다시 확인할 수 있다.
# 큰 건물 셋은 판정에서도 2x2 칸을 차지한다(SectorTemplates.h).
SNOW_CROPS = {
    'snow_floor_a': (66, 33, 232, 197),
    'snow_floor_b': (290, 32, 461, 197),
    'snow_floor_c': (522, 32, 695, 197),
    'snow_floor_d': (752, 32, 928, 197),
    'snow_wall_rock': (987, 33, 1157, 197),
    'snow_wall_ice': (1216, 33, 1388, 197),
    'snow_boulder_tall': (32, 253, 198, 431),
    'snow_pillar_tall': (231, 226, 366, 429),
    'snow_pillar_short': (406, 260, 540, 429),
    'snow_sign': (584, 237, 709, 432),
    'snow_snowman': (744, 241, 904, 435),
    'snow_pine': (927, 230, 1081, 436),
    'snow_rocks': (1114, 297, 1267, 437),
    'snow_lamp': (1288, 226, 1421, 442),
    'snow_crystal': (39, 440, 188, 621),
    'snow_grave': (249, 451, 420, 619),
    'snow_boulder': (512, 458, 693, 616),
    'snow_igloo': (43, 618, 462, 935),
    'snow_spring': (521, 575, 948, 944),
    'snow_castle': (994, 484, 1408, 946),
    'snow_crate': (53, 949, 179, 1069),
    'snow_xcrate': (222, 949, 342, 1069),
}


def _add_snow_crate_depth(im):
    """정면뿐인 설원 상자 밑에 어두운 앞면을 붙여 한 칸짜리 입체 상자로 만든다."""
    w, h = im.size
    depth = max(12, round(h * 0.27))
    overlap = max(2, round(h * 0.035))

    # 원본의 나무판·기둥 무늬를 그대로 재료로 써야 새 면도 같은 그림체다.
    # 아래 절반을 낮게 눌러 앞면으로 만들고, 빛을 덜 받는 면이라 어둡게 한다.
    front = im.crop((0, round(h * 0.43), w, h))
    front = front.resize((w, depth + overlap), Image.Resampling.LANCZOS)
    front = ImageEnhance.Color(front).enhance(0.82)
    front = ImageEnhance.Brightness(front).enhance(0.54)

    out = Image.new('RGBA', (w, h + depth), (0, 0, 0, 0))
    out.alpha_composite(front, (0, h - overlap))
    out.alpha_composite(im, (0, 0))
    return out


def extract_snow_tiles():
    """사용자가 준 눈 맵 시트를 이름 붙은 타일 파일로 다시 자른다."""
    sheet_path = os.path.join(SRC, 'snow.png')
    if not os.path.isfile(sheet_path):
        print('!! web/art/src/snow.png 가 없다')
        return

    dst = os.path.join(OUT, 'tiles')
    os.makedirs(dst, exist_ok=True)
    sheet = Image.open(sheet_path).convert('RGBA')
    for name, box in SNOW_CROPS.items():
        im = sheet.crop(box)
        # 큰 건물의 사각 범위가 위 줄 소품과 조금 겹친다. 사각형만 자르면
        # 이글루 머리 위에 이전 줄 바위의 밑동이 따라온다. 가운데 본체와
        # 이어진 가장 큰 알파 덩어리만 남겨서 서로 다른 소품을 확실히 가른다.
        px = im.load()
        seen = bytearray(im.width * im.height)
        blobs = []
        for y in range(im.height):
            for x in range(im.width):
                i = y * im.width + x
                if seen[i] or px[x, y][3] < 90:
                    continue
                q = deque([(x, y)]); seen[i] = 1; cells = []
                while q:
                    cx, cy = q.popleft(); cells.append((cx, cy))
                    for dx in (-1, 0, 1):
                        for dy in (-1, 0, 1):
                            nx, ny = cx + dx, cy + dy
                            if 0 <= nx < im.width and 0 <= ny < im.height:
                                j = ny * im.width + nx
                                if not seen[j] and px[nx, ny][3] >= 90:
                                    seen[j] = 1; q.append((nx, ny))
                blobs.append(cells)
        if blobs:
            keep = set(max(blobs, key=len))
            for y in range(im.height):
                for x in range(im.width):
                    if (x, y) not in keep:
                        r, g, b, _ = px[x, y]
                        px[x, y] = (r, g, b, 0)
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)
        if name in ('snow_crate', 'snow_xcrate'):
            im = _add_snow_crate_depth(im)
        im.save(os.path.join(dst, name + '.png'))
    print('눈 맵 시트 %d조각' % len(SNOW_CROPS))


def _foot_width(im):
    """맨 아랫부분의 폭. 이 물건이 칸을 얼마나 차지하나.

    아래 12% 줄에서 제일 넓은 폭을 쓴다. 한 줄만 보면 그림자나 풀 한 포기에
    휘둘리고, 너무 많이 보면 나무 잎까지 들어온다"""
    w, h = im.size
    px = im.load()
    band = max(1, int(h * 0.12))
    best = 0
    for y in range(h - band, h):
        x0, x1 = None, None
        for x in range(w):
            if px[x, y][3] >= 128:
                if x0 is None:
                    x0 = x
                x1 = x
        if x0 is not None and x1 - x0 + 1 > best:
            best = x1 - x0 + 1
    return best if best > 0 else w


def build_tiles():
    extract_snow_tiles()
    src = os.path.join(OUT, 'tiles')
    if not os.path.isdir(src):
        print('!! web/art/tiles 가 없다')
        return

    # 먼저 다 줄여놓고, 키 순으로 줄에 늘어놓는다 (선반 쌓기).
    #
    # 칸을 제일 높은 것(가로등 두 칸)에 맞춰 격자로 잡았더니 그림 한 장이
    # 1.9MB 가 됐다. 대부분이 빈 자리였다. 키가 비슷한 것끼리 한 줄에 두면
    # 빈 자리가 거의 안 생긴다
    shrunk = []
    for name in sorted(f[:-4] for f in os.listdir(src) if f.endswith('.png')):
        im = Image.open(os.path.join(src, name + '.png')).convert('RGBA')
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)

        if is_floor(name):
            mx = int(im.width * FLOOR_TRIM), int(im.height * FLOOR_TRIM)
            im = im.crop((mx[0], mx[1], im.width - mx[0], im.height - mx[1]))

        # **발자국 폭**으로 크기를 잡는다. 그림 전체 폭이 아니다.
        #
        # 나무는 잎이 바닥보다 넓다. 그림 폭을 한 칸으로 잡으면 잎이 한 칸이
        # 되고 바닥 잔디는 0.77칸이 된다. 그러면 구조물마다 둘레에 바닥이
        # 비어 보이고, 구조물이 자기 잔디를 깔고 그 위에 앉은 것처럼 보인다.
        #
        # 칸을 차지하는 건 바닥이지 잎이 아니다. 맨 아랫부분의 폭을 재서
        # 그게 한 칸이 되게 맞춘다. 잎은 그만큼 옆 칸으로 넘어가는데,
        # 살짝 위에서 보는 그림에서는 그게 맞다
        tw = TILE_WIDE.get(name, 1)
        foot = _foot_width(im)
        w = max(1, round(im.width * TILE_W * tw / foot))
        h = max(1, round(im.height * w / im.width))

        small = im.resize((w, h), Image.BOX)
        # 반투명 가장자리를 자른다. 안 자르면 확대했을 때 뿌옇다
        small.putalpha(small.split()[3].point(lambda v: 255 if v > 120 else 0))
        shrunk.append((name, small, tw))

    shrunk.sort(key=lambda t: -t[1].height)

    SHEET_W = 1024
    place, x, y, rowh = [], 0, 0, 0
    for name, im, tw in shrunk:
        if x + im.width > SHEET_W:
            x, y, rowh = 0, y + rowh, 0
        place.append((name, im, tw, x, y))
        x += im.width
        rowh = max(rowh, im.height)

    sheet = Image.new('RGBA', (SHEET_W, y + rowh), (0, 0, 0, 0))
    index = {}
    for name, im, tw, px, py in place:
        sheet.paste(im, (px, py), im)
        # x, y, w, h, 몇 칸 폭인가. 화면은 w 를 T*tw 로 늘리고 아랫변을 칸 바닥에 맞춘다
        index[name] = [px, py, im.width, im.height, tw]

    sheet.save(os.path.join(OUT, 'tiles.png'))
    with open(os.path.join(OUT, 'tiles.json'), 'w', encoding='utf-8') as f:
        json.dump({'tileW': TILE_W, 'sprites': index}, f, ensure_ascii=False, indent=1)
    print('판 타일 아틀라스 %s, %d칸' % (sheet.size, len(index)))


if __name__ == '__main__':
    main()
