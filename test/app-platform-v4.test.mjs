// ══════════════════════════════════════════════════════════════
//  app-platform-v4.test.mjs — 앱(Capacitor)과 웹이 같은 랭킹·계정·상점을 쓴다 (OING_PLATFORM v4)
//
//  운영 결정(2026-09-05): "랭킹 합침, 기록 보존. 앱 젤리샵 켬, 인앱결제로."
//   v3 까지 앱은 Play 게임즈 랭킹·앱 로컬 기록·상점 없음으로 갈라져 있었다(IS_APP 분기 44곳).
//   웹에서 고친 UI 가 앱에선 안 보이고, 스토어를 하나 더 열면 유지보수가 두 배가 되는 구조.
//
//  이 테스트가 지키는 약속:
//   ① 계약 버전은 index.html · app-bridge.js · PLATFORM_HOOKS.md 세 곳이 4 로 같다.
//   ② index.html 은 leaderboard.* / records.* 훅을 한 번도 부르지 않는다.
//   ③ endGame 의 앱 분기는 광고 판수만 기록하고 return 하지 않는다 — return 하면 앱 점수가 랭킹에 안 올라간다.
//   ④ 젤리샵 진입(openJellyShop)·잔액 입구·친구 랭킹·닉네임 찾기에 IS_APP 가드가 없다.
//   ⑤ 앱에서 여전히 막아야 하는 것은 그대로다 — 후원(카카오페이)·옛 유료 스킨 오버레이·내부 후기.
//   ⑥ 두 상점 페이지가 app-bridge.js 를 로드하고, 커스텀샵은 앱에서 카카오페이 대신 iap.purchase 로 간다.
//   ⑦ 웹 stub 브리지에는 iap.purchase 가 없다 — 웹에서 실수로 Play 결제 경로가 열리면 안 된다.
//
//  실행: node --test test/app-platform-v4.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = read('index.html');
const bridge = read('app-bridge.js');
const hooks = read('PLATFORM_HOOKS.md');
const jellyShop = read('shop-v2-preview.html');
const customShop = read('custom-shop-preview.html');

// 함수 본문 잘라내기 — 다음 최상위 function/const 선언 전까지
function body(name) {
  const i = src.indexOf(name);
  assert.ok(i >= 0, `${name} 을 찾지 못했다`);
  const rest = src.slice(i);
  const end = rest.search(/\n(?:async )?function |\nconst |\ndocument\.getElementById\(/);
  return rest.slice(0, end > 0 ? end : 4000);
}

test('① 계약 버전 4 — index.html · app-bridge.js · PLATFORM_HOOKS.md 일치', () => {
  assert.match(src, /PLATFORM\.apiVersion !== 4\)/);
  assert.match(src, /OING_PLATFORM v4가 필요합니다/);
  assert.match(bridge, /apiVersion: 4,/);
  assert.match(hooks, /^# OING_PLATFORM 훅 계약 \(apiVersion: 4\)/m);
  assert.doesNotMatch(src, /apiVersion !== 3\)/);
});

test('② Play 게임즈 리더보드·앱 로컬 기록 훅은 호출되지 않는다', () => {
  assert.equal((src.match(/PLATFORM\.leaderboard\./g) || []).length, 0, 'leaderboard 훅 호출이 남아 있다');
  assert.equal((src.match(/PLATFORM\.records\./g) || []).length, 0, 'records 훅 호출이 남아 있다');
  assert.doesNotMatch(src, /function renderAppLeaderboard/);
  assert.doesNotMatch(bridge, /leaderboard:|records:/);
});

test('③ endGame 앱 분기 — 광고 판수만 기록하고 웹 저장 경로로 흘러간다(return 없음)', () => {
  const i = src.indexOf('  // ── 앱: 전면광고 주기용 완료 판수만 기록하고, 아래 웹 저장 경로를 그대로 탄다 ──');
  assert.ok(i >= 0, 'endGame 앱 분기 주석을 찾지 못했다');
  const block = src.slice(i, src.indexOf('  const savedNick = loadNickname();', i));
  // 이력 주석은 빼고 코드 줄만 본다 — 주석엔 'return'·'Play 게임즈' 가 설명으로 적혀 있다.
  const code = block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /PLATFORM\.ads\.recordClassicGameComplete\(\)/);
  assert.doesNotMatch(code, /\breturn\b/, '앱 분기가 return 하면 앱 점수가 Firebase 랭킹에 안 올라간다');
  assert.doesNotMatch(code, /Play 게임즈|submitClassicScore|recordClassicResult/);
});

test('④ 앱도 젤리샵·잔액 입구·친구 랭킹·닉네임 찾기를 그대로 쓴다', () => {
  assert.doesNotMatch(body('async function openJellyShop()'), /IS_APP/);
  assert.match(src, /jellyEntry\.style\.display = ENABLE_JELLY_SHOP \? 'inline-flex' : 'none'/);
  assert.doesNotMatch(body("document.getElementById('rankModeFriends').addEventListener"), /IS_APP/);
  assert.doesNotMatch(body('(function wireRankFind()'), /IS_APP/);
  assert.doesNotMatch(body('async function renderRankingInner('), /IS_APP/);
  assert.doesNotMatch(body('async function initHomeTicker()'), /IS_APP/);
  assert.doesNotMatch(body('function getMyOingProfileSnapshot()'), /IS_APP/);
  assert.doesNotMatch(body('async function syncPlayXpFromServer('), /IS_APP/);
  assert.doesNotMatch(body('async function autoAdoptLegacy()'), /IS_APP/);
});

test('⑤ 앱에서 여전히 막는 것 — 카카오페이 후원·옛 유료 스킨 오버레이·내부 후기', () => {
  assert.match(body('function openDonateOverlay()'), /if \(IS_APP\) return;/);
  assert.match(body('async function openSkinOverlay()'), /if \(IS_APP\) return;/);
  assert.match(body('function openReviewBoard('), /if \(IS_APP\) return;/);
  // 앱 번들엔 새로고침 배너가 의미 없다
  assert.match(src, /async function checkForNewVersion\(\) \{[\s\S]{0,260}if \(IS_APP\) return;/);
});

test('⑥ 상점 페이지 — 브리지 로드, 커스텀샵은 앱에서 Play 결제', () => {
  assert.match(jellyShop, /<script src="\.\/app-bridge\.js"><\/script>/);
  assert.match(customShop, /<script src="\.\/app-bridge\.js"><\/script>/);
  assert.match(jellyShop, /if \(IN_APP && !IAP_READY\) customLink\.style\.display = 'none'/, '옛 브리지 앱이 카카오페이 상점으로 새면 안 된다');
  assert.match(customShop, /if\(IN_APP\)\{event\.preventDefault\(\);startPlayPurchase\(\);return\}/, '앱에서 결제 버튼이 카카오페이 링크를 열면 정책 위반');
  assert.match(customShop, /action:'redeemPlayPurchase'/);
  assert.match(customShop, /IAP\.purchase\(\{sku:PLAY_SKU\[orderType\],orderId\}\)/);
  assert.match(customShop, /source:'play-billing'/);
});

test('⑦ 웹 stub 브리지에는 iap.purchase 가 없다', () => {
  assert.match(bridge, /iap: \{/);
  assert.doesNotMatch(bridge, /purchase: /, '웹 stub 에 purchase 가 있으면 웹에서 Play 결제 경로가 열린다');
});
