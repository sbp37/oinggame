import { chromium } from 'playwright';
// gstatic Firebase 모듈 스텁 — 어드민 모듈들이 최상위에서 import 하므로 전부 가로채 가짜 ESM 제공
const STUBS = {
  'firebase-app.js': `export const initializeApp = () => ({ name: 'stub' });`,
  'firebase-firestore.js': `
    export const getFirestore = () => ({});
    export const collection = () => ({}); export const doc = () => ({ id: 'x', path: 'x/y' });
    export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
    export const getDocs = async () => ({ docs: [], forEach: () => {}, empty: true, size: 0 });
    export const setDoc = async () => {}; export const deleteDoc = async () => {};
    export const addDoc = async () => ({ id: 's' });
    export const query = () => ({}); export const where = () => ({}); export const orderBy = () => ({});
    export const limit = () => ({}); export const startAfter = () => ({});
    export const increment = () => 0; export const deleteField = () => ({});
    export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
    export const runTransaction = async (d, fn) => fn({
      get: async () => ({ exists: () => false, data: () => ({}) }), set: () => {}, update: () => {}, delete: () => {},
    });`,
  'firebase-auth.js': `
    export const getAuth = () => ({ currentUser: null });
    export const signInAnonymously = async () => ({ user: { uid: 'admin-stub' } });
    export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb({ uid: 'admin-stub' }), 10); return () => {}; };
    export const signInWithEmailAndPassword = async () => ({ user: { uid: 'admin-stub' } });
    export const signOut = async () => {};`,
  'firebase-functions.js': `export const getFunctions = () => ({}); export const httpsCallable = () => async () => ({ data: {} });`,
};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 420, height: 900 } });
await ctx.route('https://www.gstatic.com/firebasejs/**', (route) => {
  const f = route.request().url().split('/').pop();
  route.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
});
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
p.on('console', m => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 120)); });
await p.goto('http://127.0.0.1:8807/admin/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);
// 로그인 게이트 우회는 못 하지만(스텁), 모듈 로드·바인딩 단계 문법/참조 에러는 여기서 다 드러난다.
// 게이트 요소 존재 = HTML 파싱 정상
// 로그인 게이트는 스텁 환경에서 통과할 수 없으므로 화면만 열어 렌더 경로를 검사한다
await p.evaluate(() => {
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('adminApp').style.display = 'block';
});
await p.waitForTimeout(300);
// 모든 탭과 서브탭을 실제로 클릭해 렌더 단계 오류까지 드러낸다
const clicked = [];
for (const t of ['today','inbox','users','stats','tools']) {
  const b = p.locator(`.tab-btn[data-tab="${t}"]`);
  if (await b.count()) { await b.click(); await p.waitForTimeout(700); clicked.push(t); }
}
await p.locator('.tab-btn[data-tab="inbox"]').click(); await p.waitForTimeout(400);
for (const sb of ['verdicts','feedback','reviews','done']) {
  const b = p.locator(`#inboxSeg .seg-btn[data-sub="${sb}"]`);
  if (await b.count()) { await b.click(); await p.waitForTimeout(600); clicked.push('inbox:'+sb); }
}
await p.locator('.tab-btn[data-tab="stats"]').click(); await p.waitForTimeout(400);
for (const sb of ['activity','referrer','behavior','datause']) {
  const b = p.locator(`[data-sub="${sb}"]`).first();
  if (await b.count()) { await b.click(); await p.waitForTimeout(500); clicked.push('stats:'+sb); }
}
if (!(await p.content()).includes('support_topbtn_clicks')) {
  errs.push('젤리 잔액 버튼 사용자 행동 카드가 없음');
}
await p.locator('.tab-btn[data-tab="tools"]').click(); await p.waitForTimeout(400);
for (const acc of ['acc-send','acc-jelly','acc-sec']) {
  const a = p.locator('#'+acc);
  if (await a.count()) { await a.locator('summary').click(); await p.waitForTimeout(400); clicked.push(acc); }
}
const gate = await p.evaluate(() => ({
  errorTexts: Array.from(document.querySelectorAll('.list-error, .list-empty'))
    .map(e => e.textContent.trim()).filter(t => /not defined|undefined|Cannot|is not a function|⚠️/.test(t)),
}));
console.log('클릭한 화면:', clicked.join(', '));
console.log('요소 검증:', JSON.stringify(gate));
console.log('JS 에러:', errs.length ? errs : '없음 ✅');
await b.close();
