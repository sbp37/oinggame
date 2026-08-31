// 게임 종료 화면의 '카톡 공유' 버튼이 실제로 초대코드가 붙은 링크를 만드는지,
// 그리고 그 클릭이 기록되는지 확인한다.
import { chromium } from 'playwright';

const FS = `
  // 쓴 것을 기억하는 작은 인메모리 저장소 — 계정 연결(users/users_private/nickname_lookup)
  // 이 실제로 커밋됐는지 재읽기로 검증하는 코드 경로를 그대로 태우기 위해 필요하다.
  const STORE = (window.__STORE = window.__STORE || {});
  export const getFirestore = () => ({});
  export const collection = (db, ...p) => ({ __path: p.join('/') });
  export const doc = (db, ...p) => ({ id: p[p.length-1] || 'x', __path: p.join('/') });
  export const getDoc = async (r) => {
    const p = String((r && r.__path) || '');
    const v = STORE[p];
    return { exists: () => !!v, data: () => v || {} };
  };
  export const getDocs = async () => ({ docs: [], forEach: () => {}, empty: true, size: 0 });
  export const setDoc = async (r, d) => {
    const p = String((r && r.__path) || '');
    STORE[p] = { ...(STORE[p] || {}), ...d };
    if (/^users\\/u1$/.test(p) && d && d.nicknameNormalized) window.__LINKED = true;
  };
  export const deleteDoc = async () => {}; export const updateDoc = async () => {};
  export const addDoc = async (c, d) => { (window.__WRITES = window.__WRITES || []).push({ path: c.__path, d }); return { id: 'x' }; };
  export const query = (c) => c; export const where = () => ({}); export const orderBy = () => ({}); export const limit = () => ({});
  export const startAfter = () => ({}); export const increment = () => 0; export const deleteField = () => ({});
  export const serverTimestamp = () => 0; export const arrayUnion = () => ({}); export const arrayRemove = () => ({});
  export const getCountFromServer = async () => ({ data: () => ({ count: 0 }) });
  export const onSnapshot = () => (() => {});
  export const writeBatch = () => ({ set(){}, update(){}, delete(){}, commit: async () => {} });
  export const runTransaction = async (d, fn) => fn({ get: async (r) => { const v = STORE[String(r && r.__path)]; return { exists: () => !!v, data: () => v || {} }; }, set(r, d2){ STORE[String(r && r.__path)] = { ...(STORE[String(r && r.__path)] || {}), ...d2 }; }, update(){}, delete(){} });
`;
const mkStubs = (getCodeWorks) => ({
  'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-firestore.js': FS,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};`,
  'firebase-functions.js': `
    export const getFunctions=()=>({});
    export const httpsCallable=(f,n)=>async(p)=>{
      (window.__CALLS=window.__CALLS||[]).push({n,action:(p&&p.action)||null});
      if(n==='referralAction'&&p&&p.action==='getCode'){
        // 서버 계약 그대로: 닉네임 소유가 확인된(연결된) 계정에만 발급한다.
        if(${getCodeWorks} || window.__LINKED) return {data:{code:'ABCDEFGHJK',v:2}};
        const e=new Error('계정 닉네임 연결을 먼저 완료해주세요.');
        e.code='functions/failed-precondition';e.details={reason:'not-linked'};throw e;
      }
      if(n==='restoreAccount') return {data:{}};
      return {data:{}};
    };`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
});

async function run(label, getCodeWorks) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const STUBS = mkStubs(getCodeWorks);
  await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
    const f = r.request().url().split('/').pop();
    r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
  });
  await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/, r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  await p.addInitScript((linked) => {
    localStorage.setItem('oeing_nickname_v1', '오잉이');
    if (linked) localStorage.setItem('oeing_uid_linked_v1', 'u1');
    // navigator.share 를 가로채 실제로 어떤 URL 이 공유되는지 잡는다
    Object.defineProperty(navigator, 'share', {
      value: async (data) => { window.__SHARED = data; },
      configurable: true,
    });
  }, getCodeWorks);
  await p.goto('http://127.0.0.1:8807/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(4000);
  const out = await p.evaluate(async () => {
    document.getElementById('shareResultBtn').click();
    await new Promise(r => setTimeout(r, 1500));
    return {
      shared: window.__SHARED || null,
      calls: (window.__CALLS || []).filter(c => c.n === 'referralAction').map(c => c.action),
      writes: (window.__WRITES || []).map(w => w.path),
    };
  });
  console.log(`\n── ${label}`);
  console.log('  공유된 URL :', out.shared ? out.shared.url : '(공유 안 됨)');
  console.log('  초대코드 포함:', out.shared && /[?&]r=/.test(out.shared.url) ? '✅ 예' : '❌ 아니오');
  console.log('  referralAction:', out.calls.length ? out.calls.join(',') : '(호출 없음)');
  console.log('  기록된 컬렉션:', out.writes.length ? [...new Set(out.writes)].join(', ') : '(없음)');
  if (errs.length) console.log('  JS 에러:', errs);
  await b.close();
  return out;
}

const ok = await run('① 계정 이미 연결됨', true);
const auto = await run('② 계정 미연결 — 공유 순간 자동 연결돼야 함', false);
console.log('\n════ 판정 ════');
const a = /[?&]r=ABCDEFGHJK/.test((ok.shared || {}).url || '');
const b2 = /[?&]r=ABCDEFGHJK/.test((auto.shared || {}).url || '');
console.log(a ? '✅ ① 초대코드가 링크에 붙는다' : '❌ ① 코드가 안 붙는다');
console.log(b2 ? '✅ ② 미연결 기기도 자동 연결 후 초대코드가 붙는다' : '❌ ② 미연결이면 여전히 코드 없이 공유됨');
process.exit(a && b2 ? 0 : 1);
