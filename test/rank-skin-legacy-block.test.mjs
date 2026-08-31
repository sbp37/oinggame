// ══════════════════════════════════════════════════════════════
//  rank-skin-legacy-block.test.mjs — 옛 닉네임 문서가 UID 문서를 막던 문제
//
//  실사례(고목맴미, 2026-08-31): 커스텀샵 주문(무지개+네온)을 발송했고 서버에는
//  nickname_skins/{uid} 에 정상 저장됐는데, 랭킹에는 아무것도 안 보였다.
//
//  원인 — 이 유저에겐 옛 nickname_skins/고목맴미 문서가 있었다(cat·쪽지만 있고
//  skin/frame 은 없음). loadSkinsCache 가 그걸 {skin:null,frame:null,bubble:null} 로
//  캐시에 넣어 '자리'를 차지하고, linkSkinsByUid 가 "캐시에 그 닉이 없을 때만"
//  이어붙이는 조건이라 진짜 값이 영영 못 들어갔다.
//
//  여기서는 index.html 의 loadSkinsCache 본문과 linkSkinsByUid 를 그대로 떼어내
//  라이브 문서 모양으로 돌린다. 실행: node --test test/rank-skin-legacy-block.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function cutFn(name, kind = 'function') {
  const start = src.indexOf(`${kind} ${name}(`);
  assert.ok(start >= 0, `${name} 를 찾지 못했습니다`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} 본문이 닫히지 않았습니다`);
}

// loadSkinsCache 는 Firestore 를 부르므로, 문서를 훑는 본문만 떼어내 같은 규칙으로 돌린다.
const loadBody = cutFn('loadSkinsCache', 'async function');
const inner = loadBody.slice(loadBody.indexOf('snap.forEach(d => {'), loadBody.indexOf('_skinsCacheTs = Date.now();'));

function run(docs, rows) {
  const skinsCache = {}, skinsByUid = {}, skinsFromUidDoc = {};
  const snap = { forEach: (fn) => docs.forEach(d => fn({ id: d.id, data: () => d.data })) };
  Function('snap', 'skinsCache', 'skinsByUid', 'skinsFromUidDoc', inner)(snap, skinsCache, skinsByUid, skinsFromUidDoc);
  Function('skinsCache', 'skinsByUid', 'skinsFromUidDoc', 'rows',
    `${cutFn('linkSkinsByUid')}; linkSkinsByUid(rows);`)(skinsCache, skinsByUid, skinsFromUidDoc, rows);
  return skinsCache;
}

// 라이브 데이터 그대로
const 고목맴미_옛문서 = { id: '고목맴미', data: { cat: true, thanksText: '안뇽', notifyPending: false, thanksPending: false } };
const 고목맴미_주문발송 = { id: 'OvtCJ2bzMXWXlDEt3Fw9kZLFeC62', data: { skin: 'rainbow', frame: 'neon', uid: 'OvtCJ2bzMXWXlDEt3Fw9kZLFeC62' } };
const 고목맴미_랭킹행 = { nickname: '고목맴미', uid: 'OvtCJ2bzMXWXlDEt3Fw9kZLFeC62' };

test('실사고 재현 — 옛 닉네임 문서가 있어도 주문으로 받은 스킨이 랭킹에 붙는다', () => {
  const cache = run([고목맴미_옛문서, 고목맴미_주문발송], [고목맴미_랭킹행]);
  assert.equal(cache['고목맴미'].skin, 'rainbow', '무지개가 보여야 합니다');
  assert.equal(cache['고목맴미'].frame, 'neon', '네온이 보여야 합니다');
});

test('문서 순서가 반대로 와도 결과가 같다 (Firestore 순서에 기대지 않는다)', () => {
  const cache = run([고목맴미_주문발송, 고목맴미_옛문서], [고목맴미_랭킹행]);
  assert.equal(cache['고목맴미'].skin, 'rainbow');
  assert.equal(cache['고목맴미'].frame, 'neon');
});

test('옛 문서에만 있는 값(말풍선)은 잃지 않고 합친다', () => {
  const cache = run([
    { id: '누구', data: { bubble: '안녕하세요' } },
    { id: 'UID1', data: { skin: 'rainbow', uid: 'UID1' } },
  ], [{ nickname: '누구', uid: 'UID1' }]);
  assert.equal(cache['누구'].skin, 'rainbow', 'UID 문서 값이 들어와야 합니다');
  assert.equal(cache['누구'].bubble, '안녕하세요', '옛 문서의 말풍선이 남아야 합니다');
});

test('닉네임이 박힌 UID 문서가 이미 이겼으면 그 값을 유지한다', () => {
  // 서버 구매(ownerNickFields)가 nickname 을 함께 쓴 문서가 최우선이다.
  const cache = run([
    { id: 'UID1', data: { skin: 'cherry', frame: 'royal', uid: 'UID1', nickname: '누구' } },
    { id: 'UID2', data: { skin: 'rainbow', uid: 'UID2' } }, // 같은 사람의 다른(옛) uid 문서
  ], [{ nickname: '누구', uid: 'UID2' }]);
  assert.equal(cache['누구'].skin, 'cherry', '닉네임이 박힌 문서가 우선이어야 합니다');
  assert.equal(cache['누구'].frame, 'royal');
});

test('랭킹 행에 uid 가 없으면 아무것도 안 붙인다 (엉뚱한 사람에게 적용 금지)', () => {
  const cache = run([{ id: 'UID1', data: { skin: 'rainbow', uid: 'UID1' } }], [{ nickname: '남', uid: null }]);
  assert.equal(cache['남'], undefined);
});
