// ══════════════════════════════════════════════════════════════
//  font-scope.test.mjs — 글꼴 교체가 지시하지 않은 화면까지 바꾸지 않는다
//
//  사고(2026-09-05): "왜 안 시킨 것까지 바꿔. 메인글자들 넘 커졋잔아. 제이1님 점수
//  잘리잔아. 1~3등은 수정하지 말라 했는데. 랭킹바 4등부터만 바꾸라 한 거지."
//   · 요청은 '게임 안 고딕을 프리텐다드로'였는데, 페이지 기본 글꼴(html, body)에 걸었다.
//   · 예전 static 빌드는 수 MB 라 폰에서 사실상 늦게 걸렸는데, 동적 서브셋으로 바꾸면서
//     곧바로 걸리기 시작했다. 그 결과 font-size 는 한 글자도 안 건드렸는데
//     메인 문구가 줄바꿈되고("게임방법 보 / 기"), 시상대 1위 점수가 잘리고(19840...),
//     순위등락(▲1)이 커 보였다.
//   · 글꼴은 px 하나 안 바꿔도 화면 전체를 바꾼다 — 그래서 '범위'를 코드로 못 박는다.
//
//  이 테스트가 지키는 약속:
//   ① 페이지 기본 글꼴은 프리텐다드가 아니다 (메인·시상대·순위등락은 예전 그대로).
//   ② 프리텐다드는 게임 화면(body.game-active) 안에서만 쓴다.
//   ③ 시상대(1~3위)·순위등락 글자 크기는 '운영자가 지시한 값'에 고정돼 있다.
//
//  ③ 의 숫자를 바꿔야 할 일이 생기면, 사용자가 그렇게 요청했는지 먼저 확인할 것.
//  (요청이 있었다면 여기 값과 옆 주석의 이력을 함께 갱신한다.)
//
//  실행: node --test test/font-scope.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('① 페이지 기본 글꼴에 프리텐다드를 걸지 않는다 — 메인·시상대까지 따라 변한다', () => {
  const m = src.match(/html, body \{[\s\S]*?font-family:([^;]+);/);
  assert.ok(m, 'html, body 의 font-family 선언을 찾지 못했다');
  const stack = m[1];
  assert.doesNotMatch(
    stack,
    /Pretendard/i,
    `페이지 기본 글꼴이 프리텐다드다(${stack.trim()}) — 지시하지 않은 메인·시상대·순위등락 글자까지 커 보인다`,
  );
});

test('② 프리텐다드는 게임 화면 안에서만 쓴다', () => {
  const uses = src.match(/[^\n]*font-family:[^;]*Pretendard[^;]*;/gi) || [];
  assert.ok(uses.length > 0, '프리텐다드를 아예 안 쓰면 게임 화면 요청이 사라진 것이다');
  for (const line of uses) {
    assert.match(
      line,
      /body\.game-active/,
      `게임 화면 밖에서 프리텐다드를 쓴다: ${line.trim()}`,
    );
  }
});

test('③ 시상대(1~3위)·순위등락 글자 크기는 지시받은 값에 고정돼 있다', () => {
  // 이력: build 1788276577 값(16/15/15, 21/16/16)을 오래 유지했다 — "1~3등은 수정하지 말라".
  // 2026-09-05 운영 요청 "1~3등 닉네임이랑 점수도 살짝 줄여줘. 1등 점수가 아직도 .. 로 나와":
  //  닉네임 16/15/15 → 14.5/13.5/13.5, 점수 21/16/16 → 17/14.5/14.5.
  //  1위 칸 안쪽은 98px 인데 21px 로는 9글자(1,984,079pt)에 126px 이 필요해 잘렸다.
  const pinned = [
    [/\.rank1 \.podium-nick-text \{ font-size: 14\.5px;/, '시상대 1위 닉네임 14.5px'],
    [/\.rank2 \.podium-nick-text \{ font-size: 13\.5px;/, '시상대 2위 닉네임 13.5px'],
    [/\.rank3 \.podium-nick-text \{ font-size: 13\.5px;/, '시상대 3위 닉네임 13.5px'],
    [/\.rank1 \.podium-score \{ color: var\(--ivory\); font-size: 17px;/, '시상대 1위 점수 17px'],
    [/\.rank2 \.podium-score \{ color: var\(--ivory\); font-size: 14\.5px;/, '시상대 2위 점수 14.5px'],
    [/\.rank3 \.podium-score \{ color: var\(--ivory\); font-size: 14\.5px;/, '시상대 3위 점수 14.5px'],
    // 순위등락만 12.5→11px 로 내렸다 — 2026-09-05 "등락 초록빨강 숫자랑 삼각형 크기 줄여"라는
    // 명시적 요청이 있었다. 시상대 값들은 여전히 손대면 안 되는 값이다.
    [/\.rank-change \{ font-size: 11px;/, '순위등락 11px'],
    [/\.arrow-up   \{ font-size: 11px;/, '등락 삼각형 11px'],
    [/\.podium-rank-change \{ font-size: 10\.5px;/, '시상대 등락 10.5px'],
    [/\.rank-num \{ font-size: 15\.5px;/, '순위 숫자 15.5px'],
  ];
  for (const [re, what] of pinned) {
    assert.match(src, re, `${what} 이 바뀌었다 — 사용자가 요청한 게 맞는지 먼저 확인할 것`);
  }
});
