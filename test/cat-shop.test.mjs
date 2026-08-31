// 젤리샵 고양이 탭 — 카드 렌더·중앙정렬·구매 호출·구매완료 팝업·게임 복귀를 실제로 확인한다.
import { chromium } from 'playwright';

const SKINS = { ownedCatSkins: [], cat: false };
const FS = `
  export const getFirestore=()=>({});
  export const collection=(db,...p)=>({__path:p.join('/')});
  export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
  export const getDoc=async(r)=>{const p=String(r&&r.__path||'');
    if(p==='jelly_wallet/u1')return{exists:()=>true,data:()=>({balance:120})};
    if(p.startsWith('nickname_skins/'))return{exists:()=>true,data:()=>(window.__SKINS||{})};
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
  'firebase-functions.js': `
    export const getFunctions=()=>({});
    export const httpsCallable=(f,n)=>async(p)=>{
      (window.__CALLS=window.__CALLS||[]).push(p);
      if(n==='shopAction'&&p&&p.action==='buyCat') return {data:{jelly:60,ownedCatSkins:[p.catSkin],catSkin:p.catSkin}};
      return {data:{}};
    };`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
  const f = r.request().url().split('/').pop();
  r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
});
await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|doubleclick/, r => r.abort());
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
await p.addInitScript((s) => { window.__SKINS = s; localStorage.setItem('oeing_nickname_v1', '오잉이'); }, SKINS);
await p.goto('http://127.0.0.1:8807/shop-v2-preview.html?live=1', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2500);

// 고양이 탭
await p.click('[data-tab="cat"]');
await p.waitForTimeout(600);
const cards = await p.evaluate(() => {
  const items = [...document.querySelectorAll('.item-cat')];
  return items.map(el => {
    const box = el.querySelector('.pvbox').getBoundingClientRect();
    const img = el.querySelector('.pv-cat img');
    const ib = img.getBoundingClientRect();
    return {
      key: el.dataset.key,
      nm: el.querySelector('.nm').textContent,
      price: el.querySelector('.pr').textContent.trim(),
      // 칸 중앙과 그림 중앙이 얼마나 어긋나는지
      dx: +((ib.left + ib.right) / 2 - (box.left + box.right) / 2).toFixed(1),
      dy: +((ib.top + ib.bottom) / 2 - (box.top + box.bottom) / 2).toFixed(1),
      loaded: img.complete && img.naturalWidth > 0,
    };
  });
});
console.log('── 고양이 카드 ──');
cards.forEach(c => console.log(` ${c.key.padEnd(11)} ${c.nm.padEnd(8)} ${c.price.padEnd(8)} 중앙어긋남(${c.dx},${c.dy}) 이미지로드=${c.loaded}`));

// 구매
await p.click('.item-cat[data-key="cheese"]');
await p.waitForTimeout(400);
p.once('dialog', d => d.accept());
await p.click('#abBuy');
await p.waitForTimeout(1200);
const after = await p.evaluate(() => ({
  calls: window.__CALLS || [],
  popup: !!document.getElementById('boughtPopup'),
  popupText: (document.querySelector('.bought-card') || {}).innerText || '',
  bal: document.getElementById('bal').textContent,
}));
console.log('\n── 구매 후 ──');
console.log(' 서버 호출:', JSON.stringify(after.calls));
console.log(' 잔액:', after.bal);
console.log(' 팝업 문구:', after.popupText.replace(/\n+/g, ' | '));

const checks = [
  ['고양이 6종 카드', cards.length === 6],
  ['모두 60젤리', cards.every(c => c.price.includes('60'))],
  ['이미지 전부 로드됨', cards.every(c => c.loaded)],
  ['모든 고양이가 칸 정중앙(±1px)', cards.every(c => Math.abs(c.dx) <= 1 && Math.abs(c.dy) <= 1)],
  ['buyCat 으로 서버 호출', after.calls.some(c => c && c.action === 'buyCat' && c.catSkin === 'cheese')],
  ['구매완료 팝업 표시', after.popup],
  ['"구매완료다냥" 문구', /구매완료다냥/.test(after.popupText)],
  ['새로고침 안내 포함', /새로고침/.test(after.popupText)],
  ['게임으로 가기 버튼', /게임으로 가기/.test(after.popupText)],
  ['잔액 갱신', after.bal === '60'],
  ['JS 에러 없음', errs.length === 0],
];
console.log('');
let ok = true;
for (const [n, v] of checks) { if (!v) ok = false; console.log(`${v ? '✅' : '❌'} ${n}`); }
if (errs.length) console.log('에러:', errs);
await b.close();
process.exit(ok ? 0 : 1);
