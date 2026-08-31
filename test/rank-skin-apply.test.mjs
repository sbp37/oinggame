// 랭킹 화면에서 ① 시상대(1~3위) 닉네임에 스킨이 적용되는지 ② 일반 줄은 되는지
// ③ 상점에서 돌아온 뒤(BFCache) 새 스킨이 반영되는지를 실제로 렌더해 확인한다.
import { chromium } from 'playwright';

const RANKS = [
  { id: '제이1', score: 291561, uid: 'u-jay', oingLevel: 11 },
  { id: '쿠앙', score: 138795, uid: 'u-kuang', oingLevel: 7 },
  { id: '레레', score: 90847, uid: 'u-lele', oingLevel: 5 },
  { id: '오잉이', score: 6865, uid: 'u1', oingLevel: 5 },
];
// 1위·4위에 스킨을 입혀둔다(시상대 vs 일반 줄 비교용)
// ★ 젤리샵·서버 구매가 실제로 만드는 모양: 문서 키가 uid 이고 nickname 필드가 없다.
//   (index.html 이 직접 쓰던 문서에만 nickname 이 붙는다 — withOwnerFields)
let SKINS = {
  'u-jay': { skin: 'pink', frame: 'neon', uid: 'u-jay' },   // 1위, 젤리샵에서 구매
  'u1':    { skin: 'mint', frame: null,   uid: 'u1' },      // 4위(나), 젤리샵에서 구매
};

const FS = `
  export const getFirestore = () => ({});
  export const collection = (db, ...p) => ({ __path: p.join('/') });
  export const doc = (db, ...p) => ({ id: p[p.length-1] || 'x', __path: p.join('/') });
  export const getDoc = async (r) => {
    const p = String((r && r.__path) || '');
    if (p === 'jelly_wallet/u1') return { exists: () => true, data: () => ({ balance: 33 }) };
    if (p.startsWith('nickname_skins/')) {
      const k = p.split('/')[1];
      const all = window.__SKINS || {};
      const hit = all[k] || Object.values(all).find(v => v.uid === k);
      return hit ? { exists: () => true, data: () => hit } : { exists: () => false, data: () => ({}) };
    }
    return { exists: () => false, data: () => ({}) };
  };
  export const getDocs = async (q) => {
    const p = String((q && q.__path) || '');
    let docs = [];
    if (/^rankings$/.test(p) || /^weekly_rankings\\//.test(p)) {
      docs = ${JSON.stringify(RANKS)}.map(r => ({ id: r.id, data: () => r }));
    } else if (/^nickname_skins$/.test(p)) {
      docs = Object.entries(window.__SKINS || {}).map(([k, v]) => ({ id: k, data: () => v }));
    }
    return { docs, forEach: (f) => docs.forEach(f), empty: docs.length === 0, size: docs.length };
  };
  export const setDoc = async () => {}; export const deleteDoc = async () => {}; export const updateDoc = async () => {};
  export const addDoc = async () => ({ id: 's' });
  export const query = (c) => c; export const where = () => ({}); export const orderBy = () => ({}); export const limit = () => ({});
  export const startAfter = () => ({}); export const increment = () => 0; export const deleteField = () => ({});
  export const serverTimestamp = () => 0; export const arrayUnion = () => ({}); export const arrayRemove = () => ({});
  export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
  export const onSnapshot = () => (() => {});
  export const writeBatch = () => ({ set(){}, update(){}, delete(){}, commit: async () => {} });
  export const runTransaction = async (d, fn) => fn({ get: async () => ({ exists: () => false, data: () => ({}) }), set(){}, update(){}, delete(){} });
`;
const STUBS = {
  'firebase-app.js': `export const initializeApp = () => ({ name: '[DEFAULT]' }); export const getApp = () => ({}); export const getApps = () => [];`,
  'firebase-firestore.js': FS,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=(f,n)=>async(p)=>{(window.__CALLS=window.__CALLS||[]).push({n,p});return{data:{}}};`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
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
p.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
await p.addInitScript((s) => {
  window.__SKINS = s;
  localStorage.setItem('oeing_nickname_v1', '오잉이');
  localStorage.setItem('oeing_uid_linked_v1', 'u1');
}, SKINS);
await p.goto('http://127.0.0.1:8807/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
await p.evaluate(() => { try { switchTab('rank'); } catch { document.getElementById('tabRank')?.click(); } });
await p.waitForTimeout(3500);

const probe = await p.evaluate(() => {
  const pick = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const inner = el.querySelector('[class*="nick-"]');
    const ics = inner ? getComputedStyle(inner) : null;
    return { text: el.textContent.trim().slice(0, 12), cls: el.className,
      innerCls: inner ? inner.className : '(스킨 span 없음)',
      color: (ics || cs).color, html: el.innerHTML.slice(0, 90) };
  };
  const podium = [...document.querySelectorAll('#podiumWrap .podium-nick-text')].map(pick);
  const rows = [...document.querySelectorAll('#rankList .rank-row')].slice(0, 3).map(r => ({
    nick: pick(r.querySelector('.rank-nick')),
    rowCls: r.className,
  }));
  return { podium, rows, podiumCount: podium.length };
});
console.log('── 시상대(1~3위) 닉네임 ──');
probe.podium.forEach((x, i) => console.log(` ${i + 1}위`, JSON.stringify(x)));
console.log('── 일반 줄(4위~) ──');
probe.rows.forEach((x) => console.log('  ', JSON.stringify(x)));
console.log('JS 에러:', errs.length ? errs : '없음');
await b.close();

// 판정 — 젤리샵이 쓰는 uid 키 문서(nickname 필드 없음)가 랭킹에 반영돼야 한다.
const podiumSkinned = probe.podium.find(x => x && x.text === '제이1');
const rowSkinned = probe.rows[0] && probe.rows[0].nick;
const checks = [
  ['시상대 1위에 스킨 span 적용', podiumSkinned && podiumSkinned.innerCls === 'nick-pink'],
  ['시상대 색이 순위 기본색에 안 덮임', podiumSkinned && podiumSkinned.color === 'rgb(244, 114, 182)'],
  ['일반 줄에도 스킨 적용', rowSkinned && rowSkinned.innerCls === 'nick-mint'],
  ['JS 에러 없음', errs.length === 0],
];
let ok = true;
for (const [n, v] of checks) { if (!v) ok = false; console.log(`${v ? '✅' : '❌'} ${n}`); }
process.exit(ok ? 0 : 1);
