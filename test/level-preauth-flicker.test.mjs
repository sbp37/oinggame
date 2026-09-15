// ══════════════════════════════════════════════════════════════
//  level-preauth-flicker.test.mjs — 홈 레벨 표시가 인증 전 값으로 굳지 않는다
//
//  사고(2026-09-15, 오짱3): "오잉코어 Lv.11이 됐는데 11 ↔ 10을 왔다갔다한다."
//   · 서버(rankings·public_rank_cache·play_xp)는 전부 Lv.11로 정상이었다.
//   · 시간 XP 미러는 localStorage 'oeing_playxp_<UID>' 에 있는데, 키를 만들 때
//     MY_UID || 닉네임 을 써서 인증이 끝나기 전엔 닉네임 키(비어 있음)를 봤다.
//   · 홈 전광판(200ms)·프로필 칩(350ms/1200ms)은 인증보다 먼저 그려지고, 인증이 끝나도
//     다시 그리지 않아 시간 XP 없는 낮은 레벨(2,190 XP → Lv.9)이 한 판 끝낼 때까지 남았다.
//   · 예전 인증 타임아웃 세션이 닉네임 키에 옛 시간 XP를 남겼으면 정확히 Lv.10이 나온다.
//
//  이 테스트가 지키는 약속:
//   ① 연결 UID가 기기에 저장돼 있으면 인증이 늦어도 첫 렌더부터 UID 키의 시간 XP를 쓴다
//      (닉네임 키에 옛 값이 남아 있어도 무시).
//   ② 기기 이사 직후처럼 로컬에 시간 XP 미러가 없어도, 서버 동기화가 끝나면 칩·전광판이 다시 그려진다.
//   ③ 레벨 관련 로컬 키 4종이 같은 식별자 함수를 쓰고, 동기화 뒤 재렌더 호출이 코드에 있다.
//
//  수치는 실제 오짱3 문서(2026-09-15) 그대로: 활동 XP 2,190 + 시간 XP 455 = 2,645 → Lv.11.
//  실행: node --test test/level-preauth-flicker.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const UID = 'aB1NP3YZOZSKw0aShvEg57xcHji1';
const NICK = '오짱3';
const STATS = {
  playCount: 1417, goalTotalCount: 58, daysPlayed: 61, maxGoalStreak: 25, goalStreak: 2,
  bestScore: 22808, bestCombo: 200, firstPlayed: 1782054000000, lastPlayed: 1789450655987,
  dailyDate: '2026-09-15', dailyGoalDate: '2026-09-15', dailyGoalScore: 7350, dailyGoalType: '도전냥',
  dailyGoalAchievedToday: true, goalStreakLastDate: '2026-09-15', lastPlayDate: '2026-09-15',
  uid: UID, nickname: NICK, jelly: 10, streak: 2, totalCats: 18493, totalPlayTime: 326654,
};
const PLAY_XP = {
  total: 455, today: 6, date: '2026-09-15', activeMsToday: 820867, timeUnitsToday: 6,
  levelVersion: 2, levelContract: 'oing-level-v2-score800-combo200-time120-cap15-gates0', policyVersion: 2, uid: UID,
};

function stubs(authDelayMs) {
  return {
    'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
    // 인증 복원이 authDelayMs 뒤에 끝나는 느린 폰을 흉내 낸다.
    'firebase-auth.js': `const u={uid:${JSON.stringify(UID)}};let cur=null;export const getAuth=()=>({get currentUser(){return cur}});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>{cur=u;cb(u)},${authDelayMs});return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
    'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
    'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
    'firebase-firestore.js': `
const DOCS={${JSON.stringify('user_stats/' + UID)}:${JSON.stringify(STATS)},${JSON.stringify('play_xp/' + UID)}:${JSON.stringify(PLAY_XP)},${JSON.stringify('users/' + UID)}:{nickname:${JSON.stringify(NICK)}}};
export const getFirestore=()=>({});
export const collection=(db,...p)=>({__path:p.join('/')});
export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
export const query=(c)=>({...c});export const orderBy=()=>({});export const limit=()=>({});export const where=()=>({});
export const getDocs=async()=>({docs:[],size:0,empty:true,forEach(){}});
export const getDoc=async(ref)=>{const d=DOCS[ref.__path];return {id:ref.id,exists:()=>!!d,data:()=>d||{}}};
export const setDoc=async()=>{};export const updateDoc=async()=>{};export const deleteDoc=async()=>{};export const addDoc=async()=>({id:'x'});
export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});
export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});
export const serverTimestamp=()=>Date.now();export const increment=(n)=>n;export const arrayUnion=(...a)=>a;export const arrayRemove=(...a)=>a;
export const onSnapshot=()=>()=>{};export const documentId=()=>'__name__';export const startAfter=()=>({});
export const Timestamp={now:()=>({toMillis:()=>Date.now()}),fromMillis:(m)=>({toMillis:()=>m})};`,
  };
}

// 홈을 띄우고 0.7초(인증 전)·4초(인증 후) 시점의 칩·전광판 레벨 표기를 돌려준다.
async function renderHome(browser, { authDelayMs, storeLinkedUid, staleNickMirror, localMirror = true }) {
  const server = createServer(async (req, res) => {
    const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html';
    try {
      const body = await readFile(new URL(name, ROOT));
      res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('nope'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const s = stubs(authDelayMs);
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
      const f = r.request().url().split('/').pop();
      r.fulfill({ status: 200, contentType: 'text/javascript', body: s[f] || 'export default {};' });
    });
    await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick|fonts\.g/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.addInitScript(({ UID, NICK, STATS, PLAY_XP, storeLinkedUid, staleNickMirror, localMirror }) => {
      localStorage.setItem('oeing_nickname_v1', NICK);
      localStorage.setItem('oeing_local_stats_' + NICK, JSON.stringify(STATS));
      if (localMirror) localStorage.setItem('oeing_playxp_' + UID, JSON.stringify(PLAY_XP));
      if (storeLinkedUid) localStorage.setItem('oeing_uid_linked_v1', UID);
      // 예전 인증 타임아웃 세션이 닉네임 키에 남긴 옛 시간 XP — 이걸 읽으면 딱 Lv.10이 된다.
      if (staleNickMirror) localStorage.setItem('oeing_playxp_' + NICK, JSON.stringify({ ...PLAY_XP, total: 200, today: 0, date: '2026-08-20' }));
    }, { UID, NICK, STATS, PLAY_XP, storeLinkedUid, staleNickMirror, localMirror });
    await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    const sample = () => p.evaluate(() => ({
      chip: document.querySelector('#myInfoChip .mic-level')?.textContent?.trim() || '',
      ticker: [...document.querySelectorAll('.ticker-label')].map((e) => e.textContent).find((t) => t.startsWith('나는 Lv.')) || '',
    }));
    await p.waitForTimeout(700);
    const early = await sample();
    await p.waitForTimeout(3300);
    const late = await sample();
    return { early, late };
  } finally {
    await ctx.close();
    server.close();
  }
}

test('홈 칩·전광판 — 인증이 늦어도 Lv.11이 Lv.9~10으로 찍히지 않는다', async (t) => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    await t.test('① 연결 UID가 저장된 기기: 첫 렌더부터 UID 키의 시간 XP를 쓴다(닉네임 키 옛 값 무시)', async () => {
      const r = await renderHome(browser, { authDelayMs: 1500, storeLinkedUid: true, staleNickMirror: true });
      assert.match(r.early.chip, /Lv\.11$/, `인증 전 칩이 ${r.early.chip} — 시간 XP를 못 찾았다`);
      assert.equal(r.early.ticker, '나는 Lv.11', `인증 전 전광판이 "${r.early.ticker}"`);
      assert.match(r.late.chip, /Lv\.11$/, `인증 후 칩이 ${r.late.chip}`);
      assert.equal(r.late.ticker, '나는 Lv.11', `인증 후 전광판이 "${r.late.ticker}"`);
    });
    await t.test('② 기기 이사 직후(시간 XP 미러가 아직 없음): 서버 동기화가 끝나면 칩·전광판이 다시 그려진다', async () => {
      const r = await renderHome(browser, { authDelayMs: 1500, storeLinkedUid: true, staleNickMirror: false, localMirror: false });
      // 동기화 전엔 이 기기에 시간 XP가 없으니 낮게 보이는 게 맞다 — 중요한 건 동기화 뒤 올라오느냐다.
      assert.match(r.early.chip, /Lv\.9$/, `동기화 전 칩 기대 Lv.9(시간 XP 없음), 실제 ${r.early.chip}`);
      assert.match(r.late.chip, /Lv\.11$/, `인증 후에도 칩이 ${r.late.chip} — 재렌더가 안 됐다`);
      assert.equal(r.late.ticker, '나는 Lv.11', `인증 후에도 전광판이 "${r.late.ticker}" — 재렌더가 안 됐다`);
    });
  } finally {
    await browser.close();
  }
});

test('③ 레벨 로컬 키 4종은 같은 식별자를 쓰고, 동기화 뒤 칩·전광판을 다시 그린다', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(src, /function oingLevelIdentity\(\) \{[\s\S]{0,200}localStorage\.getItem\(UID_LINKED_KEY\)/, '식별자가 저장된 연결 UID를 보지 않는다');
  for (const [what, re] of [
    ['시간 XP 미러 키', /function playXpKey\(\) \{ return 'oeing_playxp_' \+ oingLevelIdentity\(\); \}/],
    ['표시 hold 키', /const key = 'oeing_xp_hold_' \+ oingLevelIdentity\(\);/],
    ['▲+N 기준 키', /const key = 'oeing_xp_seen_' \+ oingLevelIdentity\(\);/],
    ['승급 ack 키', /oeing_lv_ack_v\$\{OING_LEVEL_VERSION\}_\$\{oingLevelIdentity\(\)\}/],
  ]) assert.match(src, re, `${what}가 oingLevelIdentity()를 쓰지 않는다 — 인증 전후 키가 달라진다`);
  // MY_UID || loadNickname() 를 직접 조합하는 레벨 키가 다시 생기면 같은 사고가 재발한다.
  assert.doesNotMatch(src, /'oeing_(playxp|xp_hold|xp_seen)_'[^\n]*MY_UID \|\| loadNickname/, '레벨 키가 식별자 함수를 우회한다');
  assert.match(
    src,
    /await syncPlayXpFromServer\(true\);[\s\S]{0,400}try \{ refreshMyInfoChip\(\); refreshHomeTickerPersonal\(\); \} catch \{\}/,
    '서버 동기화 뒤 칩·전광판 재렌더 호출이 없다',
  );
});
