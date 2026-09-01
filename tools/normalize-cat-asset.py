#!/usr/bin/env python3
"""고양이 그림 규격 맞추기 + 손실 압축 얼룩 제거.

왜 필요한가 — 원본 그림들은 손실 압축을 거쳐서, 평평해야 할 색이 1,600~2,500가지로
번져 있다. 회색냥처럼 색끼리 비슷하면 티가 안 나지만, 민트냥은 흰색과 민트가 맞닿아
그 사이에 진흙 같은 중간색(예: 186,185,162)이 몇 픽셀씩 껴 보였다 —
"흰색이랑 민트색 사이가 비어서 깨끗하지 않다"는 운영 보고가 그것이다.

  ① 색을 원래 팔레트로 되돌린다(가까운 색으로 스냅) — 진흙 띠가 사라진다.
  ② 실루엣 알파도 반으로 갈라 또렷하게 만든다.
  ③ 4배로 키웠다가 목표 크기로 줄인다 — 이때 생기는 얇고 고른 경계가 제대로 된
     안티에일리어싱이다. 손실 압축의 넓은 진흙 띠와 다르다.
  ④ 크기·위치는 '머리'를 기준으로 맞춘다. 눈에 보이는 크기는 전체 박스가 아니라
     머리가 좌우하고, 세로도 머리 중심이 나란해야 줄이 맞아 보인다.

⚠️ 팔레트는 그림마다 다르므로 --palette 로 직접 준다. 돌린 뒤에는 반드시 눈으로
   확인할 것 — 가장자리 품질을 자동으로 검사할 방법을 찾지 못했다(test/cat-assets 참고).

사용:
  python3 tools/normalize-cat-asset.py assets/cat-mint-v3.png assets/cat-mint-v3-c.png \
    --palette 255,249,234 127,197,177 0,0,0 21,57,48 --head 154 --head-y 100
"""
import argparse
import numpy as np
from PIL import Image


def head_width_and_y(alpha_img):
    """머리 폭과 그 중심 높이 — 위쪽 55% 구간에서 가장 넓은 가로줄."""
    m = alpha_img.point(lambda p: 255 if p > 32 else 0)
    bb = m.getbbox()
    w, h = m.size
    px = m.load()
    best, best_y = 0, bb[1]
    for y in range(bb[1], bb[1] + int((bb[3] - bb[1]) * 0.55)):
        xs = [x for x in range(w) if px[x, y]]
        if xs and xs[-1] - xs[0] + 1 > best:
            best, best_y = xs[-1] - xs[0] + 1, y
    return best, best_y, bb


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--palette', nargs='+', required=True, help='R,G,B 를 여러 개')
    ap.add_argument('--head', type=int, default=154, help='맞출 머리 폭(px)')
    ap.add_argument('--head-y', type=int, default=100, help='머리 중심을 놓을 높이(px)')
    ap.add_argument('--canvas', type=int, default=200)
    args = ap.parse_args()

    pal = np.array([[int(v) for v in c.split(',')] for c in args.palette], dtype=np.float64)
    im = Image.open(args.src).convert('RGBA')
    a = np.asarray(im).astype(np.float64)
    rgb, al = a[..., :3], a[..., 3]

    # ① 색 스냅 + ② 알파 이진화
    d = np.linalg.norm(rgb[:, :, None, :] - pal[None, None, :, :], axis=3)
    snapped = pal[d.argmin(2)]
    hard = np.where(al >= 128, 255.0, 0.0)[..., None]
    crisp = Image.fromarray(np.concatenate([snapped, hard], axis=2).astype(np.uint8), 'RGBA')

    # ③ 4배 확대 → 목표 크기 축소 (프리멀티플라이드 알파에서 축소해야 색이 안 번진다)
    W, H = crisp.size
    big = crisp.resize((W * 4, H * 4), Image.NEAREST)
    b = np.asarray(big).astype(np.float64)
    pim = Image.fromarray(
        np.concatenate([b[..., :3] * (b[..., 3:4] / 255.0), b[..., 3:4]], axis=2).astype(np.uint8), 'RGBA')

    bb = big.split()[3].point(lambda p: 255 if p > 8 else 0).getbbox()
    pim = pim.crop(bb)
    head, _, _ = head_width_and_y(big.crop(bb).split()[3])
    s = args.head / head
    nw, nh = round(pim.width * s), round(pim.height * s)
    pim = pim.resize((nw, nh), Image.LANCZOS)

    c = np.asarray(pim).astype(np.float64)
    A = np.clip(c[..., 3:4], 0, 255)
    safe = np.where(A > 0, A / 255.0, 1.0)
    fixed = Image.fromarray(
        np.concatenate([np.clip(c[..., :3] / safe, 0, 255), A], axis=2).astype(np.uint8), 'RGBA')

    N = args.canvas
    tmp = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    tmp.paste(fixed, ((N - nw) // 2, (N - nh) // 2))

    # ④ 머리 기준으로 자리 잡기
    hw, hy, bb2 = head_width_and_y(tmp.split()[3])
    out = Image.new('RGBA', (N, N), (0, 0, 0, 0))
    out.paste(tmp, ((N - (bb2[0] + bb2[2])) // 2, args.head_y - hy))
    out.save(args.dst)
    print(f'{args.dst}: 머리폭 {hw}px, 머리중심 Y={args.head_y} 로 저장')


if __name__ == '__main__':
    main()
