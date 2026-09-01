// ══════════════════════════════════════════════════════════════
//  jelly-spend-log.test.mjs — 어드민 '최근 젤리 사용 내역'
//
//  운영 요청: "사람들이 젤리를 썼으면 어디에 썼는지 알 수 있게 해줘. 내가 검색하는 게
//  아니라, 누가 최근에 소비했으면 어떤 거에 썼는지 확인 가능하게."
//
//  전체 원장은 게임 지급이 대부분이라 어쩌다 있는 구매가 묻히고, 유저 조회는 닉네임을
//  미리 알아야 쓸 수 있었다. 그래서 소비만 모아 보여주는 목록을 새로 만들었다.
//  jelly.js 는 firebase SDK 를 import 하므로, 여기서는 필요한 함수만 떼어내 가짜 db 로 돌린다.
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../admin/js/jelly.js', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');

function cut(name, kind = 'function') {
  const start = src.indexOf(`${kind} ${name}(`);
  assert.ok(start >= 0, `${name} 를 찾지 못했습니다`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} 본문이 닫히지 않았습니다`);
}
const build = new Function(`${cut('isUserSpend')}${cut('itemKo')}
  ${src.match(/const ITEM_KO = \{[\s\S]*?\n\};/)[0]}
  return { isUserSpend, itemKo };`);
const { isUserSpend, itemKo } = build();

test('소비만 골라낸다 — 게임 지급·초대 보상 같은 획득은 빼고', () => {
  assert.equal(isUserSpend({ type: 'spend', source: 'buySkin', amount: -30 }), true);
  assert.equal(isUserSpend({ type: 'earn', source: 'submitScore', amount: 3 }), false);
  assert.equal(isUserSpend({ type: 'earn', source: 'friendReferral', amount: 5 }), false);
});

test('type 이 없는 옛 기록도 금액이 음수면 소비로 본다', () => {
  assert.equal(isUserSpend({ source: 'buyFrame', amount: -80 }), true);
  assert.equal(isUserSpend({ source: 'submitScore', amount: 1 }), false);
});

test('운영자 회수는 소비 목록에 넣지 않는다', () => {
  // 유저가 쓴 게 아니라 운영자가 거둬간 것이라 "어디에 썼나" 목록에 섞이면 안 된다.
  assert.equal(isUserSpend({ type: 'adjust', source: 'admin', amount: -20 }), false);
  assert.equal(isUserSpend({ type: 'adjust', source: 'admin', amount: 20 }), false);
});

test('아이템 키를 한글 이름으로 바꾼다', () => {
  assert.equal(itemKo('cherry'), '벚꽃비');
  assert.equal(itemKo('blue-scarf'), '파란 목도리냥');
  assert.equal(itemKo('neon'), '네온');
  // 모르는 키는 지우지 않고 원문을 남긴다 — 새 아이템이 나와도 빈칸이 되면 안 된다.
  assert.equal(itemKo('brand-new-item'), 'brand-new-item');
  assert.equal(itemKo(''), '');
  assert.equal(itemKo(undefined), '');
});

test('판매 중인 아이템 키가 모두 한글 이름을 갖고 있다', () => {
  // 서버 가격표에 있는 키인데 이름이 없으면 운영자 화면에 영문 키가 그대로 뜬다.
  const shop = readFileSync(new URL('../shop-v2-preview.html', import.meta.url), 'utf8');
  const keys = [...shop.matchAll(/key:'([a-z-]+)',\s*nm:'([^']+)'/g)];
  assert.ok(keys.length >= 15, `상점 카탈로그를 찾지 못했습니다 (${keys.length}건)`);
  for (const [, key, name] of keys) {
    assert.notEqual(itemKo(key), key, `${key}(${name}) 의 한글 이름이 없습니다`);
  }
});

test('어드민 화면에 사용 내역 카드와 버튼이 있고 코드에 연결돼 있다', () => {
  assert.match(adminHtml, /id="jellySpendLoadBtn"/);
  assert.match(adminHtml, /id="jellySpendList"/);
  assert.match(adminHtml, /id="jellySpendSummary"/);
  assert.match(src, /spendBtn\.addEventListener\('click', guardBtn\(spendBtn, loadSpendLog\)\)/);
  // 버튼을 눌러야 조회한다 — 탭을 여는 것만으로 읽기가 발생하면 안 된다.
  assert.doesNotMatch(src, /loadSpendLog\(\);\s*\n\s*\}\s*\n*$/);
});

test('복합 인덱스 없이 도는 조회다 (ts 한 축 정렬)', () => {
  const body = cut('loadSpendLog', 'async function');
  assert.match(body, /orderBy\('ts', 'desc'\)/);
  assert.doesNotMatch(body, /where\(/, "where + orderBy 를 함께 쓰면 복합 인덱스가 필요해 조회가 실패합니다");
});

test('서버가 원장에 쓰는 source 가 모두 한글 이름을 갖고 있다', () => {
  // 라벨이 없으면 운영자 화면에 'buyCat' 같은 영문 키가 그대로 뜬다.
  // 실제로 고양이 구매(buyCat)가 빠져 있었다.
  const SOURCE_KO = new Function(`${src.match(/const SOURCE_KO = \{[\s\S]*?\n\};/)[0]}; return SOURCE_KO;`)();
  const written = [
    'submitScore', 'claimDaily', 'earlyMember', 'friendReferral', 'restore', 'admin',
    'buySkin', 'buyFrame', 'buyCat', 'buyBubble', 'renameEarly',
  ];
  for (const key of written) {
    assert.ok(SOURCE_KO[key], `${key} 의 한글 이름이 없습니다`);
  }
});
