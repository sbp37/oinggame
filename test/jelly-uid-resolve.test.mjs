// ══════════════════════════════════════════════════════════════
//  jelly-uid-resolve.test.mjs — 어드민 젤리 조회의 닉네임 → uid 해석
//
//  실제 사고: 옛날부터 하던 유저('사이다')를 조회하면 "계정(UID)을 못 찾았어요"가
//  떠서 젤리를 못 줬다. 원인은 예전 resolveJellyUid 가 nickname_lookup 과
//  rankings/{닉} 두 곳만 봤기 때문 —
//   · nickname_lookup/사이다 는 phase-a 이관 때 만든 '예약' 문서라 uid 가 없고,
//   · rankings/사이다 도 uid 를 자동으로 붙이지 않는다(닉네임 탈취 방지 정책).
//  정작 uid 는 weekly_rankings 와 game_sessions 에 멀쩡히 남아 있었다.
//
//  jelly.js 를 그대로 import 하려면 firebase SDK 가 필요해서, 여기서는 소스에서
//  resolveJellyUid/weekIdBack 함수 본문만 떼어내 가짜 db 로 실행한다.
//  실행: node --test test/jelly-uid-resolve.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../admin/js/jelly.js', import.meta.url), 'utf8');

function cut(name, kind = 'async function') {
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

const LOOKBACK = Number(src.match(/const WEEKLY_UID_LOOKBACK = (\d+);/)[1]);

// 가짜 Firestore — 경로 문자열을 키로 쓰는 단순 맵.
function makeEnv(store) {
  const reads = [];
  const doc = (_db, ...parts) => ({ path: parts.join('/') });
  const fetchDoc = async (ref) => { reads.push(ref.path); return store[ref.path] || null; };
  const collection = (_db, name) => ({ name });
  const where = (field, _op, value) => ({ field, value });
  const limit = (n) => ({ n });
  const query = (col, w, l) => ({ col: col.name, where: w, limit: l });
  const fetchDocs = async (q) => {
    reads.push(`query:${q.col}`);
    const rows = store[`query:${q.col}`] || [];
    return rows.filter(r => r[q.where.field] === q.where.value).slice(0, q.limit.n);
  };
  const resolveUserDocId = async (nick) => store[`lookup:${nick}`] || { uid: null };
  const build = new Function(
    'db', 'doc', 'fetchDoc', 'fetchDocs', 'collection', 'query', 'where', 'limit', 'resolveUserDocId',
    `${cut('weekIdBack', 'function')}\nconst WEEKLY_UID_LOOKBACK = ${LOOKBACK};\n${cut('resolveJellyUid')}\nreturn { resolveJellyUid, weekIdBack };`,
  );
  return { ...build(null, doc, fetchDoc, fetchDocs, collection, query, where, limit, resolveUserDocId), reads };
}

const thisWeek = (() => {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  const day = k.getUTCDay();
  k.setUTCDate(k.getUTCDate() - (day === 0 ? 6 : day - 1));
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
})();

test('① 계정 연결(nickname_lookup)이 있으면 그것만 쓰고 더 안 뒤진다', async () => {
  const env = makeEnv({ 'lookup:링크됨': { uid: 'U1' } });
  assert.deepEqual(await env.resolveJellyUid('링크됨'), { uid: 'U1', source: '계정 연결 기록' });
  assert.equal(env.reads.length, 0, '연결 기록이 있으면 추가 조회가 없어야 한다');
});

test('② 전체 랭킹 문서에 uid 가 박혀 있으면 주간·세션까지 안 간다', async () => {
  const env = makeEnv({ 'rankings/랭커': { uid: 'U2' } });
  const got = await env.resolveJellyUid('랭커');
  assert.deepEqual(got, { uid: 'U2', source: '전체 랭킹 문서' });
  assert.deepEqual(env.reads, ['rankings/랭커']);
});

test('③ 실제 사고 재현 — 예약 lookup + uid 없는 rankings 인데 주간 문서에 uid 가 있다', async () => {
  // 라이브 데이터 그대로: nickname_lookup/사이다 는 reserved(=uid 없음),
  // rankings/사이다 는 score 만, 주간 문서에만 uid 가 있다.
  const env = makeEnv({
    'rankings/사이다': { score: 6464 },
    [`weekly_rankings/${thisWeek}/scores/사이다`]: { score: 3118, uid: '3KeD522kk5QUy6QK2p3rAXn4R2K2' },
  });
  const got = await env.resolveJellyUid('사이다');
  assert.equal(got.uid, '3KeD522kk5QUy6QK2p3rAXn4R2K2');
  assert.equal(got.source, `주간 랭킹(${thisWeek})`);
});

test('③-2 이번 주에 안 놀았어도 지난 주간 문서까지 거슬러 찾는다', async () => {
  const threeWeeksAgo = (() => {
    const k = new Date(Date.now() + 9 * 3600 * 1000 - 3 * 7 * 86400000);
    const day = k.getUTCDay();
    k.setUTCDate(k.getUTCDate() - (day === 0 ? 6 : day - 1));
    return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
  })();
  const env = makeEnv({ [`weekly_rankings/${threeWeeksAgo}/scores/쉬는중`]: { uid: 'U3' } });
  assert.equal((await env.resolveJellyUid('쉬는중')).uid, 'U3');
});

test('④ 랭킹이 전혀 없어도 최근 게임 기록의 uid 로 찾는다 (가장 최근 판 기준)', async () => {
  const env = makeEnv({
    'query:game_sessions': [
      { nickname: '세션만', uid: 'OLD', submittedAt: 100 },
      { nickname: '세션만', uid: 'NEW', submittedAt: 900 },
      { nickname: '남의닉', uid: 'X', submittedAt: 999 },
    ],
  });
  const got = await env.resolveJellyUid('세션만');
  assert.equal(got.uid, 'NEW', '가장 최근 제출의 uid 여야 한다');
  assert.equal(got.source, '최근 게임 기록');
  assert.equal(got.ambiguous, true, '같은 닉을 쓴 uid 가 둘이면 경고해야 한다');
});

test('④-2 한 계정만 쓴 닉네임은 경고를 띄우지 않는다', async () => {
  const env = makeEnv({
    'query:game_sessions': [
      { nickname: '한명', uid: 'ONLY', submittedAt: 1 },
      { nickname: '한명', uid: 'ONLY', submittedAt: 2 },
    ],
  });
  const got = await env.resolveJellyUid('한명');
  assert.equal(got.uid, 'ONLY');
  assert.equal(got.ambiguous, false);
});

test('⑤ 정말 아무 데도 없으면 null — 없는 유저에게 지급되면 안 된다', async () => {
  const env = makeEnv({});
  assert.deepEqual(await env.resolveJellyUid('없는사람'), { uid: null });
  // 주간 문서는 LOOKBACK 주까지만 훑는다(무한 조회 방지)
  const weekReads = env.reads.filter(p => p.startsWith('weekly_rankings/'));
  assert.equal(weekReads.length, LOOKBACK);
});

test('⑥ weekIdBack 은 KST 월요일 문서 id 를 만든다 (getWeekId 와 같은 계산)', async () => {
  const env = makeEnv({});
  assert.equal(env.weekIdBack(0), thisWeek);
  assert.match(env.weekIdBack(0), /^\d{4}-\d{2}-\d{2}$/);
  // 한 주 전은 정확히 7일 전
  const diff = new Date(env.weekIdBack(0)) - new Date(env.weekIdBack(1));
  assert.equal(diff, 7 * 86400000);
});

// ══════════════════════════════════════════════════════════════
//  같은 뿌리의 두 번째 사고 — 초기 멤버 선물이 '계정 연결'을 요구했다
// ══════════════════════════════════════════════════════════════
// 사이다 님은 2026-07-05부터 매일 하는 초기 멤버인데 +20 을 못 받았다.
// nickname_lookup/사이다 가 phase-a 예약 문서인 채로 남아 isUidLinked() 가 false 였고,
// 클라가 그 조건에서 먼저 return 해버려 서버에 요청조차 가지 않았다 —
// 정작 대상인 옛 유저를 게이트가 걸러낸 셈이다.
// 자격 판정은 어차피 서버가 서버 진실(그 uid 의 기준시각 이전 game_sessions 또는
// Auth 계정 생성 시각)로만 하고, 중복 지급도 지갑 플래그가 막는다.
test('⑦ 초기 멤버 선물 요청은 계정 연결이 아니라 uid 만 요구한다', () => {
  const game = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = game.indexOf('async function maybeClaimEarlyMemberGift(');
  assert.ok(start > 0, 'maybeClaimEarlyMemberGift 를 찾지 못했습니다');
  // 주석 줄은 뺀다 — 왜 이 조건을 없앴는지 설명하느라 함수 안 주석에 isUidLinked 가 적혀 있다.
  const body = game.slice(start, game.indexOf('\n}', start))
    .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.match(body, /if \(!MY_UID\) return;/, '로그인(uid) 여부만 확인해야 합니다');
  assert.doesNotMatch(body, /isUidLinked\(\)/,
    '계정 연결(isUidLinked) 조건이 다시 들어오면 레거시 초기 멤버가 또 못 받습니다');
  assert.match(body, /callShopAction\('claimEarlyMember'\)/);
});
