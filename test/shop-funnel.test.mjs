// ══════════════════════════════════════════════════════════════
//  shop-funnel.test.mjs — 상점 깔때기가 '사람 수'를 정직하게 세고, 단계가 실제로 기록된다
//
//  배경(2026-09-05): "친구 말고는 젤리에 관심이 없는데 뭐가 문제인지" — 입구 클릭 수만으론
//  안 본 건지 · 보고 싫었던 건지 · 사려다 포기한 건지 구분이 안 됐다.
//
//  이 테스트가 지키는 약속:
//   ① 같은 세션이 같은 단계를 여러 번 남겨도 1로 센다 (숫자 = 그 단계까지 온 사람 수).
//   ② 직전 대비·기준 대비 비율이 맞고, 0명이면 % 가 아니라 — 다.
//   ③ 웹/앱 나눔·탭별 집계가 맞고, 이탈 구간은 표본 5명 이상일 때만 짚는다.
//   ④ 젤리샵·커스텀샵·게임 화면이 정해진 단계 이름으로 기록한다 — 이름이 어긋나면 깔때기가 끊긴다.
//   ⑤ 한 세션 1회 기록(sessionStorage 키)과 sid 공유 규칙이 코드에 있다.
//
//  실행: node --test test/shop-funnel.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeFunnel, lastDates, JELLY_STEPS, CASH_STEPS } from '../admin/js/funnel.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const row = (sid, step, extra = {}) => ({ sid, step, platform: 'web', date: '2026-09-05', ts: 1, ...extra });

test('① 같은 세션의 반복 기록은 1로 센다', () => {
  const f = computeFunnel([row('a', 'enter'), row('a', 'enter'), row('a', 'preview'), row('a', 'preview'), row('b', 'enter')]);
  const enter = f.jelly.find((s) => s.step === 'enter');
  const preview = f.jelly.find((s) => s.step === 'preview');
  assert.equal(enter.n, 2);
  assert.equal(preview.n, 1);
  assert.equal(f.sessions, 2);
});

test('② 비율 — 기준(상점 진입) 대비와 직전 대비, 0명은 —(null)', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push(row('s' + i, 'enter'));
  for (let i = 0; i < 6; i++) rows.push(row('s' + i, 'tab', { tab: 'cat' }));
  for (let i = 0; i < 3; i++) rows.push(row('s' + i, 'preview'));
  rows.push(row('s0', 'buy_click'));
  const f = computeFunnel(rows);
  const by = Object.fromEntries(f.jelly.map((s) => [s.step, s]));
  assert.equal(by.enter.ofBase, 100);
  assert.equal(by.tab.ofBase, 60);
  assert.equal(by.tab.ofPrev, 60);
  assert.equal(by.preview.ofPrev, 50);
  assert.equal(by.buy_click.ofPrev, 33);
  assert.equal(by.buy_done.n, 0);
  assert.equal(by.buy_done.ofBase, 0);
  assert.equal(by.buy_done.ofPrev, 0);
  assert.equal(by.entry.ofPrev, null, '첫 단계는 직전이 없다');
  const empty = computeFunnel([]);
  assert.equal(empty.jelly[1].ofBase, null, '0명이면 0% 가 아니라 — 로 보여야 한다');
});

test('③ 웹/앱 나눔·탭별 집계·이탈 구간(표본 5명 이상)', () => {
  const rows = [];
  for (let i = 0; i < 8; i++) rows.push(row('w' + i, 'enter'));
  for (let i = 0; i < 4; i++) rows.push(row('a' + i, 'enter', { platform: 'app' }));
  for (let i = 0; i < 8; i++) rows.push(row('w' + i, 'tab', { tab: i < 5 ? 'cat' : 'frame' }));
  for (let i = 0; i < 4; i++) rows.push(row('a' + i, 'tab', { tab: 'cat', platform: 'app' }));
  rows.push(row('w0', 'preview'));
  const f = computeFunnel(rows);
  const enter = f.jelly.find((s) => s.step === 'enter');
  assert.equal(enter.web, 8); assert.equal(enter.app, 4); assert.equal(enter.n, 12);
  assert.deepEqual(f.tabs, [{ tab: 'cat', n: 9 }, { tab: 'frame', n: 3 }]);
  assert.ok(f.worst, '표본이 충분한데 이탈 구간을 못 짚었다');
  assert.equal(f.worst.from, '상품 탭 열기');
  assert.equal(f.worst.to, '미리보기');
  assert.equal(f.worst.lost, 11);
  // 표본 5명 미만이면 짚지 않는다
  const small = computeFunnel([row('x', 'enter'), row('y', 'enter'), row('x', 'tab', { tab: 'cat' })]);
  assert.equal(small.worst, null);
});

test('lastDates — 오늘부터 n일, 로컬 날짜 문자열', () => {
  const d = lastDates(3, new Date(2026, 8, 5, 15));
  assert.deepEqual(d, ['2026-09-05', '2026-09-04', '2026-09-03']);
});

test('④ 세 화면이 정해진 단계 이름으로 기록한다', () => {
  const shop = read('shop-v2-preview.html');
  const cash = read('custom-shop-preview.html');
  const game = read('index.html');
  const jellyNames = JELLY_STEPS.map(([s]) => s);
  const cashNames = CASH_STEPS.map(([s]) => s);
  // 젤리샵: enter · tab · preview · buy_click · buy_done · custom_link
  for (const s of ['enter', 'preview', 'buy_click', 'buy_done', 'custom_link']) {
    assert.ok(shop.includes(`logFunnel('${s}')`), `젤리샵에 '${s}' 기록이 없다`);
  }
  assert.match(shop, /logFunnel\('tab', \{ tab: t\.dataset\.tab \}\)/);
  // 커스텀샵: cash_enter · cash_pay_click · cash_done
  for (const s of ['cash_enter', 'cash_pay_click', 'cash_done']) {
    assert.ok(cash.includes(`logFunnel('${s}')`), `커스텀샵에 '${s}' 기록이 없다`);
  }
  // 게임 화면: entry — 상점 페이지와 같은 컬렉션·같은 sid 키
  assert.match(game, /addDoc\(collection\(db, 'shop_funnel'\), \{\s*step: 'entry'/);
  assert.match(game, /const SID_KEY = 'oeing_shop_funnel_sid'/);
  // 어드민이 아는 단계 이름 밖의 것을 쓰면 깔때기에서 사라진다
  const used = [...shop.matchAll(/logFunnel\('([a-z_]+)'/g), ...cash.matchAll(/logFunnel\('([a-z_]+)'/g)].map((m) => m[1]);
  for (const u of used) assert.ok([...jellyNames, ...cashNames].includes(u), `어드민이 모르는 단계 '${u}'`);
});

test('⑤ 한 세션 1회 기록·sid 공유·실패해도 상점을 막지 않는다', () => {
  for (const [name, src] of [['젤리샵', read('shop-v2-preview.html')], ['커스텀샵', read('custom-shop-preview.html')]]) {
    assert.match(src, /const FUNNEL_SID_KEY = 'oeing_shop_funnel_sid'/, `${name}: 게임 화면과 다른 sid 키`);
    assert.match(src, /if \(sessionStorage\.getItem\(onceKey\)\) return; sessionStorage\.setItem\(onceKey, '1'\);/, `${name}: 단계당 1회 기록이 없다`);
    assert.match(src, /catch \(e\) \{ \/\* 통계는 실패해도 상점을 막지 않는다 \*\/ \}/, `${name}: 로그 실패가 상점을 막을 수 있다`);
  }
  // 미리보기 모드에선 기록하지 않는다
  assert.match(read('shop-v2-preview.html'), /if \(!LIVE_MODE\) return;\n  const onceKey/);
  assert.match(read('custom-shop-preview.html'), /if \(!checkoutMode\) return;\n  const onceKey/);
});

test('🍮 입구가 버튼이라는 걸 알린다 — 라벨 + 첫 젤리 1회 안내', () => {
  const game = read('index.html');
  assert.match(game, /<span class="jelly-entry-label"> · 꾸미기<\/span>/);
  assert.match(game, /const HINT_KEY = 'oeing_jelly_entry_hint_v1'/);
  assert.match(game, /function showJellyEntryHint\(anchor\)/);
});
