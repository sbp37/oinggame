// 고양이를 사면 게임 화면뿐 아니라 '내 정보 프로필'의 고양이도 바뀌어야 한다.
// 상점에서 돌아오는 흐름(pageshow)을 실제로 태워, 프로필 칩과 내 정보 아바타가
// 새 얼굴로 갱신되는지 확인한다.
import { chromium } from 'playwright';

const FS = `
  export const getFirestore=()=>({});
  export const collection=(db,...p)=>({__path:p.join('/')});
  export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
  export const getDoc=async(r)=>{const p=String(r&&r.__path||'');
    if(p==='jelly_wallet/u1')return{exists:()=>true,data:()=>({balance:60})};
    if(p.startsWith('nickname_skins/'))return{exists:()=>true,data:()=>(window.__SKINS||{})};
    if(p.startsWith('user_stats/'))return{exists:()=>true,data:()=>({nickname:'오잉이',bestScore:6865,uid:'u1'})};
    return{exists:()=>false,data:()=>({})};};
  export const getDocs=async()=>({docs:[],forEach:()=>{},empty:true,size:0});
  export const setDoc=async()=>{};export const deleteDoc=async()=>{};export const updateDoc=async()=>{};
  export const addDoc=async()=>({id:'x'});
  export const query=(c)=>c;export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});
  export const startAfter=()=>({});export const increment=()=>0;export const deleteField=()=>({});
  export const serverTimestamp=()=>0;export const arrayUnion=()=>({});export const arrayRemove=()=>({});
  export const getCountFromServer=async()=>({data:()=>({count:0})});export const onSnapshot=()=>(()=>{});
  export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});
  export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});`;
const STUBS = {
  'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-firestore.js': FS,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
  const f = r.request().url().split('/').pop();
  r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
});
await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|doubleclick/, r => r.abort());
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
// 처음엔 고양이 스킨 없음
await p.addInitScript(() => {
  window.__SKINS = { cat: false };
  localStorage.setItem('oeing_nickname_v1', '오잉이');
  localStorage.setItem('oeing_uid_linked_v1', 'u1');
});
await p.goto('http://127.0.0.1:8807/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);

const read = () => p.evaluate(() => {
  const chip = document.querySelector('#myInfoChip .mic-avatar');
  return { chip: chip ? chip.innerHTML.slice(0, 70) : '(칩 없음)' };
});
const before = await read();

// 상점에서 회색냥을 사고 돌아온 상황을 그대로 재현한다(서버 문서가 바뀐 뒤 pageshow)
await p.evaluate(() => { window.__SKINS = { cat: true, catSkin: 'gray', ownedCatSkins: ['gray'], uid: 'u1' }; });
await p.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
await p.waitForTimeout(2500);
const after = await read();

// 내 정보 오버레이의 아바타도 확인
await p.evaluate(() => { try { openMyInfoOverlay(); } catch (e) { document.getElementById('myInfoChip')?.click(); } });
await p.waitForTimeout(1200);
const overlay = await p.evaluate(() => {
  const el = document.querySelector('#myInfoOverlay .myi-avatar, #myiAvatar, #myInfoOverlay img[alt=""]');
  return el ? (el.outerHTML || '').slice(0, 90) : '(못 찾음)';
});

console.log('구매 전 프로필 칩 :', before.chip);
console.log('구매 후 프로필 칩 :', after.chip);
console.log('내 정보 아바타    :', overlay);
const checks = [
  ['구매 전에는 기본 이모지', /🐱/.test(before.chip)],
  ['구매 후 프로필 칩이 회색냥 그림으로 바뀜', /img-04-c\.png/.test(after.chip)],
  ['내 정보 아바타도 회색냥', /img-04-c\.png/.test(overlay)],
  ['JS 에러 없음', errs.length === 0],
];
console.log('');
let ok = true;
for (const [n, v] of checks) { if (!v) ok = false; console.log(`${v ? '✅' : '❌'} ${n}`); }
if (errs.length) console.log('에러:', errs.slice(0, 3));
await b.close();
process.exit(ok ? 0 : 1);
