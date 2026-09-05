// ══════════════════════════════════════════════════════════════
//  retention-cohorts.test.mjs — 어드민 '신규 유저 재방문' 계산이 정직하다
//
//  배경(2026-09-05): "왜 다시 안 오는지"를 감으로 논쟁하고 있었다. 광고·가격·플랫폼을
//  정하기 전에 재방문을 숫자로 봐야 해서 admin/js/retention.js(순수 함수)를 뒀다.
//
//  이 테스트가 지키는 약속:
//   ① 코호트는 KST 월요일 시작 주 — 게임 주간 랭킹(getWeekId)과 같은 경계.
//   ② '다른 날 재방문'은 daysPlayed 로, 없던 시절 유저는 마지막 플레이 날짜로 판정한다.
//   ③ D1/D7 은 playDates 가 있는 유저만 세고, 7일이 안 지난 신규는 D7 에서 뺀다(부풀리기 금지).
//   ④ '최근 7일 활동'은 가입 7일 넘은 사람만 분모로 — 오늘 가입한 사람이 100% 를 만들면 안 된다.
//   ⑤ 초대 유입과 그 외를 나눠 센다.
//   ⑥ 클라이언트(index.html)가 두 저장 경로 모두에 playDates 를 쓰고, 그 규칙이 어드민과 같다.
//
//  실행: node --test test/retention-cohorts.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRetention, weekIdOf, kstDateStr, addDays, mergePlayDates, normalizeUserRow } from '../admin/js/retention.js';

const DAY = 86400000;
// 2026-09-05(토) 15:00 KST = 06:00Z
const NOW = Date.parse('2026-09-05T06:00:00Z');
const kst = (s) => Date.parse(s + '+09:00');

test('① 주 경계는 KST 월요일 — 일요일 밤 11시는 그 주, 월요일 0시는 다음 주', () => {
  assert.equal(weekIdOf(kst('2026-09-06T23:00:00')), '2026-08-31'); // 일요일 밤 → 8/31 주
  assert.equal(weekIdOf(kst('2026-09-07T00:00:00')), '2026-09-07'); // 월요일 0시 → 새 주
  assert.equal(kstDateStr(kst('2026-09-06T23:59:00')), '2026-09-06');
  assert.equal(kstDateStr(kst('2026-09-07T00:01:00')), '2026-09-07');
  assert.equal(addDays('2026-08-31', 7), '2026-09-07');
});

test('② 다른 날 재방문 — daysPlayed 우선, 없으면 마지막 플레이 날짜로', () => {
  const fp = kst('2026-09-01T10:00:00');
  assert.equal(normalizeUserRow({ firstPlayed: fp, lastPlayed: fp + 3 * 3600e3, playCount: 5, daysPlayed: 1 }).returned, false, '같은 날 5판은 재방문이 아니다');
  assert.equal(normalizeUserRow({ firstPlayed: fp, lastPlayed: fp + 3 * 3600e3, playCount: 5, daysPlayed: 2 }).returned, true);
  // daysPlayed 없던 시절 유저 — 마지막 플레이가 다른 날이면 재방문
  assert.equal(normalizeUserRow({ firstPlayed: fp, lastPlayed: fp + DAY, playCount: 2 }).returned, true);
  assert.equal(normalizeUserRow({ firstPlayed: fp, lastPlayed: fp + 1000, playCount: 2 }).returned, false);
  assert.equal(normalizeUserRow({ playCount: 3 }), null, 'firstPlayed 없으면 집계에서 뺀다');
});

test('③ D1/D7 — playDates 있는 유저만, 7일 안 지난 신규는 D7 분모에서 뺀다', () => {
  const first = '2026-08-20'; // 2주 전(8/17 주)
  const fp = kst(first + 'T12:00:00');
  const rows = [
    { id: 'a', firstPlayed: fp, lastPlayed: fp, playCount: 1, daysPlayed: 1, playDates: [first] },                       // 안 옴
    { id: 'b', firstPlayed: fp, lastPlayed: fp + DAY, playCount: 3, daysPlayed: 2, playDates: [first, addDays(first, 1)] }, // D1 ✓ D7 ✓
    { id: 'c', firstPlayed: fp, lastPlayed: fp + 5 * DAY, playCount: 2, daysPlayed: 2, playDates: [first, addDays(first, 5)] }, // D1 ✗ D7 ✓
    { id: 'd', firstPlayed: fp, lastPlayed: fp + 9 * DAY, playCount: 2, daysPlayed: 2, playDates: [first, addDays(first, 9)] }, // D1 ✗ D7 ✗ (돌아왔지만 7일 밖)
    { id: 'legacy', firstPlayed: fp, lastPlayed: fp + DAY, playCount: 2, daysPlayed: 2 },                                  // playDates 없음 → D1/D7 미추적
    // 어제 가입 — D1 은 확정 가능, D7 은 아직 아니다
    { id: 'fresh', firstPlayed: NOW - DAY - 3600e3, lastPlayed: NOW - 3600e3, playCount: 2, daysPlayed: 2,
      playDates: [kstDateStr(NOW - DAY - 3600e3), kstDateStr(NOW - 3600e3)] },
  ];
  const r = computeRetention(rows, NOW, { weeks: 6 });
  const c = r.cohorts.find((x) => x.weekId === '2026-08-17');
  assert.equal(c.n, 5);
  assert.equal(c.d1Tracked, 4, 'legacy 는 playDates 가 없어 추적에서 빠진다');
  assert.equal(c.d1, 1);
  assert.equal(c.d1Pct, 25);
  assert.equal(c.d7Tracked, 4);
  assert.equal(c.d7, 2, 'b·c 만 7일 안에 왔다 — d 는 9일째라 D7 아님');
  assert.equal(c.d7Pct, 50);
  assert.equal(c.returned, 4, 'd 도 legacy 도 "다른 날 재방문"에는 든다');

  const f = r.cohorts.find((x) => x.weekId === '2026-08-31');
  assert.equal(f.n, 1);
  assert.equal(f.d1Tracked, 1, '어제 가입은 D1 확정 가능');
  assert.equal(f.d1, 1);
  assert.equal(f.d7Tracked, 0, '7일이 안 지났으니 D7 분모에 넣으면 부풀려진다');
  assert.equal(f.d7Pct, null);
});

test('④ 최근 7일 활동 — 가입 7일 넘은 사람만 분모', () => {
  const rows = [
    { id: 'old-active', firstPlayed: NOW - 20 * DAY, lastPlayed: NOW - 2 * DAY, playCount: 9, daysPlayed: 5 },
    { id: 'old-gone', firstPlayed: NOW - 20 * DAY, lastPlayed: NOW - 15 * DAY, playCount: 2, daysPlayed: 2 },
    { id: 'today', firstPlayed: NOW - 3600e3, lastPlayed: NOW - 3600e3, playCount: 1, daysPlayed: 1 },
  ];
  const f = computeRetention(rows, NOW).last28;
  assert.equal(f.n, 3);
  assert.equal(f.active7Denom, 2, '오늘 가입자는 분모에서 빠진다');
  assert.equal(f.active7, 1);
  assert.equal(f.active7Pct, 50);
});

test('⑤ 초대 유입 vs 그 외 재방문을 나눠 센다', () => {
  const fp = NOW - 10 * DAY;
  const rows = [
    { id: 'i1', firstPlayed: fp, lastPlayed: fp + DAY, playCount: 2, daysPlayed: 2, refBy: '오잉이' },
    { id: 'i2', firstPlayed: fp, lastPlayed: fp, playCount: 1, daysPlayed: 1, refBy: '오잉이' },
    { id: 'o1', firstPlayed: fp, lastPlayed: fp, playCount: 1, daysPlayed: 1, refBy: '' },
    { id: 'o2', firstPlayed: fp, lastPlayed: fp + 2 * DAY, playCount: 4, daysPlayed: 3 },
    { id: 'o3', firstPlayed: fp, lastPlayed: fp + 2 * DAY, playCount: 4, daysPlayed: 3 },
  ];
  const f = computeRetention(rows, NOW).last28;
  assert.equal(f.invited, 2);
  assert.equal(f.invitedReturnedPct, 50);
  assert.equal(f.otherReturnedPct, 67);
  assert.equal(f.multi, 3);
  assert.equal(f.multiPct, 60);
});

test('코호트는 이번 주부터 과거순으로 weeks 개, 비어도 행이 있다', () => {
  const r = computeRetention([], NOW, { weeks: 3 });
  assert.deepEqual(r.cohorts.map((c) => c.weekId), ['2026-08-31', '2026-08-24', '2026-08-17']);
  assert.equal(r.cohorts[0].n, 0);
  assert.equal(r.cohorts[0].returnedPct, null, '0명이면 0% 가 아니라 — 로 보여야 한다');
});

test('mergePlayDates — 중복 없이, 정렬, 최근 30일치만', () => {
  assert.deepEqual(mergePlayDates(null, '2026-09-05'), ['2026-09-05']);
  assert.deepEqual(mergePlayDates(['2026-09-05'], '2026-09-05'), ['2026-09-05'], '같은 날 두 판은 한 번');
  assert.deepEqual(mergePlayDates(['2026-09-05'], '2026-09-01'), ['2026-09-01', '2026-09-05']);
  const many = Array.from({ length: 40 }, (_, i) => addDays('2026-07-01', i));
  const out = mergePlayDates(many, '2026-09-05');
  assert.equal(out.length, 30);
  assert.equal(out[out.length - 1], '2026-09-05');
  assert.deepEqual(mergePlayDates(['x', 3, null], '2026-09-05'), ['2026-09-05', 'x'].sort(), '문자열 아닌 건 버린다');
});

test('⑥ 클라이언트가 두 저장 경로 모두 playDates 를 쓰고, 규칙이 어드민과 같다', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(src, /playDates: mergePlayDates\(d\.playDates, todayStr\)/, '기존 유저 저장 경로에 playDates 가 없다');
  assert.match(src, /playDates: \[todayStr\]/, '신규 유저 첫 저장에 playDates 가 없다');
  // 함수 본문이 어드민(retention.js)과 글자 단위로 같아야 한다 — 한쪽만 바꾸면 D1/D7 이 어긋난다.
  const body = (text) => {
    const m = text.match(/function mergePlayDates\(prev, todayStr, max = 30\) \{([\s\S]*?)\n\}/);
    assert.ok(m, 'mergePlayDates 정의를 찾지 못했다');
    return m[1].replace(/\s+/g, ' ').trim();
  };
  const admin = readFileSync(new URL('../admin/js/retention.js', import.meta.url), 'utf8');
  assert.equal(body(src), body(admin));
});
