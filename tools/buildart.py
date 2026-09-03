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
from PIL import Image

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


def load_pieces(sheet, expect):
    d = os.path.join(TMP, sheet)
    meta = cut(os.path.join(SRC, sheet + '.png'), d, expect=expect)
    return [Image.open(os.path.join(d, m['file'])).convert('RGBA') for m in meta]


def main():
    pieces = []

    # ── 캐릭터 ───────────────────────────────────────────────
    for si, sheet in enumerate(['walk_a', 'walk_b', 'walk_c']):
        imgs = load_pieces(sheet, 12)
        if len(imgs) != 96:
            print('!! %s 가 96칸이 아니다 (%d)' % (sheet, len(imgs)))
        for row in range(8):
            name = NAMES[si][row]
            for col in range(12):
                k = row * 12 + col
                if k >= len(imgs):
                    continue
                d = DIRS[col // 3]
                f = col % 3
                pieces.append(('%s_%s%d' % (name, d, f), imgs[k]))

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
    imgs = load_pieces('water', 0)

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
             'desert_market': 2, 'desert_palm_big': 2, 'desert_rock_big': 2}

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
                 'desert_water_', 'desert_carpet'):
        if name.startswith(head):
            return True
    return False


def build_tiles():
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

        tw = TILE_WIDE.get(name, 1)
        w = TILE_W * tw
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
