// ══════════════════════════════════════════════════════════════
//  cat-assets.test.mjs — 고양이 그림 6종이 서로 같은 규격인지
//
//  운영 보고: "민트냥 깨졌잖아. 흰색 부분 이상하고 사이즈도 크고."
//  실제로 정규화본(cat-mint-v3-c.png)이 원본보다 망가져 있었다 — 흰 주둥이 둘레가
//  점점이 깨지고, 머리가 다른 고양이보다 컸다. 알파를 곱하지 않은 채 크기를 줄여서
//  가장자리 색이 뭉갠 것이 원인이었다.
//
//  여기서 잡는 것은 '규격'이다 — 캔버스·머리 크기·머리 높이·좌우 정렬.
//  ⚠️ 가장자리가 깨졌는지(색 번짐)는 여기서 못 잡는다. 흰색-검정 인접 횟수,
//  외톨이 픽셀 비율, 반투명 픽셀 비율 세 가지를 재봤지만 망가진 파일과 정상 파일이
//  구분되지 않았다(예: 깨진 민트 0.156 / 정상 0.185 — 오히려 겹친다).
//  그래서 통과한다고 그림이 예쁘다는 뜻은 아니다. 자산을 새로 만들면 눈으로 봐야 한다.
//  실행: node --test test/cat-assets.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATS = ['img-03-c', 'img-04-c', 'img-05-c', 'cat-cheese-c', 'cat-pink-c', 'cat-mint-v3-c'];

// 파이썬(PIL)으로 픽셀을 재서 JSON 으로 받는다.
const PY = `
import json, sys
from PIL import Image
out = {}
for name in ${JSON.stringify(CATS)}:
    im = Image.open("${ROOT}/assets/%s.png" % name).convert('RGBA')
    W, H = im.size
    a = im.split()[3].point(lambda p: 255 if p > 32 else 0)
    bb = a.getbbox(); px = a.load()
    best, head_y = 0, bb[1]
    for y in range(bb[1], bb[1] + int((bb[3]-bb[1]) * 0.55)):
        xs = [x for x in range(W) if px[x, y]]
        if xs and xs[-1]-xs[0]+1 > best:
            best = xs[-1]-xs[0]+1; head_y = y
    out[name] = dict(size=[W, H], head=best, head_y=head_y,
                     left=bb[0], right=W-bb[2])
print(json.dumps(out))
`;
const M = JSON.parse(execFileSync('python3', ['-c', PY], { encoding: 'utf8' }));

test('여섯 종 모두 같은 캔버스(200x200)를 쓴다', () => {
  for (const k of CATS) assert.deepEqual(M[k].size, [200, 200], k);
});

test('머리 크기가 서로 비슷하다 — 한 마리만 크면 눈에 띈다', () => {
  const heads = CATS.map(k => M[k].head);
  const min = Math.min(...heads), max = Math.max(...heads);
  assert.ok(max - min <= 20,
    `머리 폭 차이가 ${max - min}px 입니다 (${CATS.map((k, i) => `${k}:${heads[i]}`).join(', ')})`);
});

test('머리 높이가 나란하다 — 한 마리만 처지면 줄이 안 맞아 보인다', () => {
  const ys = CATS.map(k => M[k].head_y);
  const min = Math.min(...ys), max = Math.max(...ys);
  assert.ok(max - min <= 20,
    `머리 중심 높이 차이가 ${max - min}px 입니다 (${CATS.map((k, i) => `${k}:${ys[i]}`).join(', ')})`);
});

test('좌우가 정중앙이다', () => {
  for (const k of CATS) {
    assert.ok(Math.abs(M[k].left - M[k].right) <= 2,
      `${k} 좌우 여백 ${M[k].left}/${M[k].right}`);
  }
});

// 민트냥은 손실 압축 얼룩 때문에 따로 정리해서 만든다(tools/normalize-cat-asset.py).
// 배포본이 그 스크립트의 결과와 같아야 한다 — 손으로 고치거나 다른 방법으로 다시 만들면
// 8/31 처럼 흰색·민트 경계가 진흙처럼 번진 파일이 그대로 올라간다.
test('민트냥 배포본은 정리 스크립트가 만든 것과 일치한다', () => {
  const tmp = join(ROOT, 'assets', '.mint-verify.png');
  try {
    execFileSync('python3', [
      join(ROOT, 'tools/normalize-cat-asset.py'),
      join(ROOT, 'assets/cat-mint-v3.png'), tmp,
      '--palette', '255,249,234', '127,197,177', '0,0,0', '21,57,48',
      '--head', '154', '--head-y', '100',
    ], { stdio: 'pipe' });
    const diff = execFileSync('python3', ['-c', `
import numpy as np
from PIL import Image
a = np.asarray(Image.open("${join(ROOT, 'assets/cat-mint-v3-c.png')}").convert('RGBA')).astype(int)
b = np.asarray(Image.open("${tmp}").convert('RGBA')).astype(int)
print(0 if a.shape != b.shape else int(np.abs(a-b).max()) if a.shape == b.shape else 999)
print(1 if a.shape != b.shape else 0)
`], { encoding: 'utf8' }).trim().split('\n');
    assert.equal(diff[1], '0', '크기가 달라졌습니다 — 스크립트 인자가 배포본과 안 맞습니다');
    assert.equal(diff[0], '0',
      `배포본이 스크립트 결과와 다릅니다(최대 차이 ${diff[0]}). ` +
      '자산을 바꿨다면 tools/normalize-cat-asset.py 로 다시 만들어 주세요.');
  } finally {
    try { execFileSync('rm', ['-f', tmp]); } catch {}
  }
});
