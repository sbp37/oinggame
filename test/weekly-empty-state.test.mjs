// 주간 랭킹 빈 화면 + 지난주 톱3 를 실제 index.html 을 실행해서 확인한다.
// gstatic Firebase 를 스텁으로 가로채, "이번 주 0건 / 지난주 3건" 상태를 만든다.
import { chromium } from 'playwright';

const LASTWEEK = [
  { id: '제이1', score: 291561 },
  { id: '쿠앙', score: 138795 },
  { id: '레레', score: 90847 },
];

const FS = `
  export const getFirestore = () => ({});
  export const collection = (db, ...p) => ({ __path: p.join('/') });
  export const doc = (db, ...p) => ({ id: p[p.length-1] || 'x', __path: p.join('/') });
  export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
  export const query = (c, ...r) => ({ __path: c.__path, __r: r });
  export const where = () => ({}); export const orderBy = () => ({}); export const limit = () => ({});
  export const startAfter = () => ({});
  export const getDocs = async (q) => {
    const p = String((q && q.__path) || '');
    const LW = ${JSON.stringify(LASTWEEK)};
    // 지난주 주차 컬렉션이면 톱3 반환, 이번 주는 0건
    if (/^weekly_rankings\\//.test(p) && window.__LASTWEEK_ID && p.includes(window.__LASTWEEK_ID)) {
      const docs = LW.map(x => ({ id: x.id, data: () => ({ score: x.score }) }));
      return { docs, forEach: (f) => docs.forEach(f), empty: false, size: docs.length };
    }
    return { docs: [], forEach: () => {}, empty: true, size: 0 };
  };
  export const setDoc = async () => {}; export const deleteDoc = async () => {};
  export const addDoc = async () => ({ id: 's' }); export const updateDoc = async () => {};
  export const increment = () => 0; export const deleteField = () => ({});
  export const serverTimestamp = () => 0; export const arrayUnion = () => ({}); export const arrayRemove = () => ({});
  export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
  export const onSnapshot = () => (() => {});
  export const writeBatch = () => ({ set(){}, update(){}, delete(){}, commit: async () => {} });
  export const runTransaction = async (d, fn) => fn({ get: async () => ({ exists: () => false, data: () => ({}) }), set(){}, update(){}, delete(){} });
  export const enableIndexedDbPersistence = async () => {};
  export const initializeFirestore = () => ({}); export const persistentLocalCache = () => ({});
  export const persistentMultipleTabManager = () => ({});
`;
const STUBS = {
  'firebase-app.js': `export const initializeApp = () => ({ name: 'stub' }); export const getApp = () => ({ name: 'stub' }); export const getApps = () => [];`,
  'firebase-firestore.js': FS,
  'firebase-auth.js': `
    export const getAuth = () => ({ currentUser: { uid: 'u1' } });
    export const signInAnonymously = async () => ({ user: { uid: 'u1' } });
    export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb({ uid: 'u1' }), 5); return () => {}; };
    export const signOut = async () => {}; export const signInWithCustomToken = async () => ({ user: { uid: 'u1' } });`,
  'firebase-functions.js': `export const getFunctions = () => ({}); export const httpsCallable = () => async () => ({ data: {} });`,
  'firebase-analytics.js': `export const getAnalytics = () => ({}); export const logEvent = () => {}; export const isSupported = async () => false;`,
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
  const f = r.request().url().split('/').pop();
  r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
});
await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/, r => r.abort());

const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e.message).slice(0, 180)));
// 지난주 주차 id 를 페이지에 알려준다(스텁이 그 컬렉션만 채우도록)
await p.addInitScript(() => {
  const k = new Date(Date.now() - 7 * 86400000 + 9 * 3600000);
  const day = k.getUTCDay();
  k.setUTCDate(k.getUTCDate() - (day === 0 ? 6 : day - 1));
  const pad = n => String(n).padStart(2, '0');
  window.__LASTWEEK_ID = `${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`;
});
await p.goto('http://127.0.0.1:8807/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

// 랭킹 탭으로 이동 (기본 모드가 '이번주')
await p.evaluate(() => { try { switchTab('rank'); } catch (e) { document.getElementById('tabRank')?.click(); } });
await p.waitForTimeout(3500);

const out = await p.evaluate(() => {
  const el = document.getElementById('rankEmpty');
  return {
    lastWeekId: window.__LASTWEEK_ID,
    visible: el ? getComputedStyle(el).display : 'no-el',
    text: el ? el.innerText.replace(/\n+/g, ' | ') : '',
  };
});
console.log('지난주 주차 id :', out.lastWeekId);
console.log('빈 화면 표시   :', out.visible);
console.log('빈 화면 문구   :', out.text);

const checks = [
  ['냥 말투로 바뀜', /되어보라냥~/.test(out.text)],
  ['옛 문구 사라짐', !/되어보세요/.test(out.text)],
  ['지난주 순위 제목', /지난주 최종 순위/.test(out.text)],
  ['1위 닉+점수', /제이1/.test(out.text) && /291,561/.test(out.text)],
  ['2·3위도 표시', /쿠앙/.test(out.text) && /138,795/.test(out.text) && /레레/.test(out.text)],
  ['빈 화면이 실제로 보임', out.visible !== 'none'],
  ['JS 에러 없음', errs.length === 0],
];

// 전체 랭킹으로 전환했을 때 주간 문구가 남지 않는지
await p.evaluate(() => document.getElementById('rankModeAll')?.click());
await p.waitForTimeout(2500);
const allText = await p.evaluate(() => (document.getElementById('rankEmpty') || {}).innerText || '');
console.log('전체 랭킹 문구 :', allText.replace(/\n+/g, ' | '));
checks.push(['전체 랭킹에 주간 문구 안 남음', !/이번 주엔|지난주 최종 순위/.test(allText)]);
checks.push(['전체 랭킹도 냥 말투', /되어보라냥~/.test(allText)]);

console.log('');
let ok = true;
for (const [n, v] of checks) { if (!v) ok = false; console.log(`${v ? '✅' : '❌'} ${n}`); }
if (errs.length) console.log('\nJS 에러:', errs.slice(0, 5));
await b.close();
process.exit(ok ? 0 : 1);
