// ══════════════════════════════════════════════════════════════
//  rank-new-and-popup.test.mjs — 랭킹 NEW 중복 / 주문 도착 팝업 문구
//
//  운영 보고(2026-08-31 스크린샷):
//   · 랭킹 한 줄에 NEW 가 두 번 떴다(순위변동 칸 + 점수 앞). 그만큼 자리를 뺏겨
//     닉네임이 "고..." 로 잘렸다.
//   · 주문 도착 팝업이 제목·부제·메시지로 같은 말을 세 번 했다.
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('랭킹 한 줄에 NEW 는 순위변동 칸에만 한 번 나온다', () => {
  assert.doesNotMatch(src, /rank-new-badge/,
    '점수 앞 NEW(rank-new-badge)는 순위변동 칸과 중복이라 남아 있으면 안 됩니다');
  // 남는 NEW 는 순위변동 칸의 것 하나뿐 — 전체·주간 두 렌더러가 같은 클래스를 쓴다.
  assert.equal((src.match(/rank-change-new/g) || []).length, 3,
    'CSS 1 + 렌더 2(전체·주간) = 3곳이어야 합니다');
});

test('순위변동 칸의 NEW 는 칸(25px) 안에 들어가는 크기다', () => {
  const m = src.match(/\.rank-change-new\s*\{([^}]*)\}/);
  assert.ok(m, '.rank-change-new 스타일을 찾지 못했습니다');
  const size = Number((m[1].match(/font-size:\s*([\d.]+)px/) || [])[1]);
  assert.ok(size > 0 && size <= 9,
    `칸이 25px 뿐이라 9px 이하여야 닉네임 자리를 안 뺏습니다 (지금 ${size}px)`);
  assert.match(m[1], /white-space|nowrap|padding:\s*1px 3px/);
});

test('주문 도착 팝업은 제목을 상품으로 부르고 부제를 비운다', () => {
  assert.match(src, /주문한 상품이 도착했어요!/);
  assert.doesNotMatch(src, /기다리던 꾸미기를 배달 왔다냥/,
    '제목과 같은 말을 반복하던 부제는 지웠습니다');
  // 고양이 스킨 도착(다른 종류)의 부제는 그대로 남아야 한다.
  assert.match(src, /새로운 친구가 찾아왔다냥/);
});

test('도착 메시지는 첫 문장 뒤에서 줄을 바꾼다', () => {
  assert.match(src, /skinNote\.replace\(\/!\\s\+\/, '!\\n'\)/,
    "'… 도착했다냥!' 뒤를 줄바꿈해야 두 문장이 한 줄에 뭉치지 않습니다");
  // 줄바꿈이 실제로 보이려면 그 요소가 pre-wrap 이어야 한다.
  const box = src.match(/id="skinNotifyNote"[^>]*>/)[0];
  assert.match(box, /white-space:\s*pre-wrap/);
});
