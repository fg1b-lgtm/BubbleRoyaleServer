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

    # ── 물풍선 · 물줄기 · 물 ─────────────────────────────────
    #
    # 물줄기는 통짜 십자로 받으면 못 쓴다. 사거리가 아이템으로 1칸에서 6칸까지
    # 늘어나서 십자 크기가 매판 달라지기 때문이다.
    # 가운데 · 팔 · 끝 조각으로 받아서 길이만큼 이어 붙인다.
    #
    # 시트에서 몇 번째 조각이 무엇인지는 눈으로 보고 정했다. 자동으로 알아낼
    # 방법이 없진 않지만, 열두 개짜리를 위해 판별기를 만드는 건 배보다 배꼽이다
    WATER = {
        'balloon0':   5,    # 갓 놓았다
        'balloon1':   0,    # 부풀었다
        'balloon2':   1,    # 더 부풀었다
        'balloon_hot': 2,   # 곧 터진다 (빨강)
        'blast_mid':  8,    # 십자 가운데
        'blast_v':    9,    # 세로 팔
        'blast_h':   14,    # 가로 팔
        'blast_tip_h': 11,  # 가로 끝 (왼쪽을 본다. 오른쪽은 뒤집어 쓴다)
        'blast_tip_v': 13,  # 세로 끝 (아래를 본다. 위쪽은 뒤집어 쓴다)
        'water_top':  24,   # 차오른 물의 표면
        'splash':     27,   # 파문
        'puddle':     30,   # 웅덩이
    }
    imgs = load_pieces('water', 0)

    # 물줄기 조각과 물풍선은 담는 방식이 다르다.
    #
    # 물줄기는 **칸을 꽉 채워야** 한다. 비율을 지키면 가로로 긴 팔 조각이 칸보다
    # 좁아져서 옆 칸과 사이에 틈이 생긴다. 그러면 하나로 뻗은 물줄기가 아니라
    # 조각을 늘어놓은 것으로 보인다 — 실제로 그렇게 보였다.
    #
    # 물풍선은 비율을 지켜야 한다. 늘리면 찌그러진 풍선이 된다
    BLAST = ('blast_mid', 'blast_v', 'blast_h', 'blast_tip_h', 'blast_tip_v')

    fx_fill = [(k, imgs[v]) for k, v in WATER.items()
               if k in BLAST and v < len(imgs)]
    fx_keep = [(k, imgs[v]) for k, v in WATER.items()
               if k not in BLAST and v < len(imgs)]

    size, n = build(fx_fill + fx_keep,
                    os.path.join(OUT, 'fx.png'),
                    os.path.join(OUT, 'fx.json'),
                    96, 96, cols=6, fit='center',
                    fill_names=set(k for k, _ in fx_fill))
    print('물 아틀라스 %s, %d칸' % (size, n))

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


if __name__ == '__main__':
    main()
