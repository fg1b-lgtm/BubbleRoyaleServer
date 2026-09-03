# -*- coding: utf-8 -*-
# tools/atlas.py — 잘라낸 조각을 게임이 쓰는 아틀라스 한 장으로 묶는다
#
# 왜 한 장으로 묶나.
#   브라우저가 그림을 한 장씩 받으면 요청이 백 번 넘게 나간다. 판이 시작되고
#   나서 그림이 하나씩 뜨는 것도 보기 싫다. 한 장이면 한 번에 온다.
#
# 왜 크기를 맞추나.
#   GPT 가 만든 조각은 크기가 제각각이다 (78x101, 86x103, ...). 그대로 쓰면
#   캐릭터마다 키가 다르다. 발밑을 기준으로 같은 높이에 맞춘다 —
#   머리 꼭대기를 맞추면 키 큰 캐릭터가 땅에 파묻힌다.
#
# 왜 BOX 로 줄이나.
#   픽셀 그림을 LANCZOS 로 줄이면 선이 번져서 다시 흐려진다. BOX(면적 평균)로
#   줄이고 알파를 자르면 도트가 도트로 남는다.
import os, json, math
from PIL import Image

def normalize(im, cell_w, cell_h, foot_pad=1, fit='foot'):
    """조각 하나를 cell_w x cell_h 칸에 앉힌다.

    fit='foot'   발밑을 기준으로 아래에 붙인다 (사람)
    fit='center' 칸 한가운데에 놓는다

    둘 다 비율은 지킨다. 늘리면 캐릭터가 찌그러진다"""
    bb = im.getbbox()
    if bb:
        im = im.crop(bb)

    pad = foot_pad if fit == 'foot' else 0
    h = cell_h - pad
    w = max(1, round(im.width * h / im.height))
    if w > cell_w:
        w = cell_w
        h = max(1, round(im.height * w / im.width))

    small = im.resize((w, h), Image.BOX)

    # 반투명 가장자리를 자른다. 안 자르면 확대했을 때 뿌옇다
    a = small.split()[3].point(lambda v: 255 if v > 120 else 0)
    small.putalpha(a)

    out = Image.new('RGBA', (cell_w, cell_h), (0, 0, 0, 0))
    y = (cell_h - h) // 2 if fit == 'center' else cell_h - pad - h
    out.paste(small, ((cell_w - w) // 2, y), small)
    return out


def build(pieces, out_png, out_json, cell_w, cell_h, cols=16, fit='foot'):
    """pieces: [(이름, PIL 이미지)] — 이름으로 게임에서 찾는다"""
    rows = (len(pieces) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * cell_w, rows * cell_h), (0, 0, 0, 0))
    index = {}
    for i, (name, im) in enumerate(pieces):
        cx, cy = (i % cols) * cell_w, (i // cols) * cell_h
        sheet.paste(normalize(im, cell_w, cell_h, fit=fit), (cx, cy))
        index[name] = [cx, cy, cell_w, cell_h]

    sheet.save(out_png)
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump({'cellW': cell_w, 'cellH': cell_h, 'sprites': index},
                  f, ensure_ascii=False, indent=1)
    return sheet.size, len(index)
