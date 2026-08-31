// 운영자가 젤리를 보내면 다음 접속 때 '젤리 배달 왔다냥' 팝업이 개수와 함께 뜨고,
// 서버가 표시를 지워 두 번 뜨지 않아야 한다. 전광판이 내 이야기만 나오지 않는지도 함께 본다.
import { chromium } from 'playwright';

const RANKS = [
  { id: '하비', score: 60999, uid: 'u-h', oingLevel: 5, ts: Date.now() - 30 * 60000 },
  { id: '제이', score: 44830, uid: 'u-j', oingLevel: 7, ts: Date.now() - 3 * 3600000 },
  { id: '표소학', score: 33554, uid: 'u-p', oingLevel: 8, ts: Date.now() - 5 * 3600000 },
  { id: '제제', score: 29751, uid: 'u-z', oingLevel: 5, ts: Date.now() - 20 * 3600000 },
  { id: '야채파이', score: 13278, uid: 'u-y', oingLevel: 5, ts: Date.now() - 26 * 3600000 },
  { id: '오짱3', score: 13225, uid: 'u-o', oingLevel: 10, ts: Date.now() - 40 * 3600000 },
  { id: '오잉이', score: 6865, uid: 'u1', oingLevel: 6, ts: Date.now() - 50 * 3600000 },
];
const FS = `
  export const getFirestore=()=>({});
  export const collection=(db,...p)=>({__path:p.join('/')});
  export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
  export const getDoc=async(r)=>{const p=String(r&&r.__path||'');
    if(p==='jelly_wallet/u1')return{exists:()=>true,data:()=>({balance:120,giftPending:window.__PENDING||0})};
    if(p.startsWith('user_stats/'))return{exists:()=>true,data:()=>({nickname:'오잉이',uid:'u1'})};
    return{exists:()=>false,data:()=>({})};};
  export const getDocs=async(q)=>{const p=String(q&&q.__path||'');let d=[];
    if(/^rankings$/.test(p)||/^weekly_rankings\\//.test(p))d=${JSON.stringify(RANKS)}.map(r=>({id:r.id,data:()=>r}));
    return{docs:d,forEach:(f)=>d.forEach(f),empty:!d.length,size:d.length};};
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
      (window.__CALLS=window.__CALLS||[]).push((p&&p.action)||n);
      if(n==='shopAction'&&p&&p.action==='ackJellyGift'){
        const had=window.__PENDING||0; window.__PENDING=0;   // 서버처럼 한 번만 돌려준다
        return {data:{acked:had}};
      }
      return {data:{}};
    };`,
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
await p.addInitScript(() => {
  window.__PENDING = 25;                       // 운영자가 25개를 보낸 상태
  localStorage.setItem('oeing_nickname_v1', '오잉이');
  localStorage.setItem('oeing_uid_linked_v1', 'u1');
});
await p.goto('http://127.0.0.1:8807/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#jellyGiftPopup', { timeout: 15000 });
const popup = await p.evaluate(() => {
  const card = document.querySelector('#jellyGiftPopup .jopen-card');
  return {
    text: card.innerText.replace(/\n+/g, ' | '),
    cat: (card.querySelector('.jopen-cat img') || {}).getAttribute?.('src') || '',
    jelly: !!card.querySelector('.jopen-jelly'),
    buttons: [...card.querySelectorAll('.jopen-btn')].map(b2 => b2.textContent.trim()),
    calls: window.__CALLS || [],
  };
});
console.log('팝업 문구 :', popup.text);
console.log('고양이    :', popup.cat, '/ 젤리모자:', popup.jelly);
console.log('버튼      :', popup.buttons.join(' , '));
console.log('서버 호출 :', popup.calls.filter(c => c === 'ackJellyGift').length, '회');

// 바로가기가 젤리샵으로 가는지
await p.evaluate(() => document.getElementById('jgiftGoBtn').click());
await p.waitForTimeout(1200);
const wentTo = p.url();

// 전광판 — 내 이야기만 나오는지
await p.goBack();
await p.waitForTimeout(4500);
const ticker = await p.evaluate(() => {
  const t = document.getElementById('oingTickerText');
  return t ? t.innerText.replace(/\s+/g, ' ').trim() : '';
});
console.log('\n전광판    :', ticker.slice(0, 220));

const mine = /나는 현재/.test(ticker);
const others = ['하비', '제이', '표소학', '제제', '야채파이', '오짱3'].filter(n => ticker.includes(n));
const checks = [
  ['"젤리 배달 왔다냥" 문구', /젤리 배달 왔다냥/.test(popup.text)],
  ['받은 개수 표시(25)', /\+25개/.test(popup.text)],
  ['젤리모자 쓴 파란냥 그림', /img-03-c\.png/.test(popup.cat) && popup.jelly],
  ['닫기 버튼', popup.buttons.includes('닫기')],
  ['젤리샵 바로가기 버튼', popup.buttons.some(t => /젤리샵 바로가기/.test(t))],
  ['서버 확인 처리 1회', popup.calls.filter(c => c === 'ackJellyGift').length === 1],
  ['바로가기가 젤리샵으로 이동', /shop-v2-preview\.html\?live=1/.test(wentTo)],
  ['전광판에 남의 소식도 나옴', others.length >= 1],
  ['JS 에러 없음', errs.length === 0],
];
console.log('');
let ok = true;
for (const [n, v] of checks) { if (!v) ok = false; console.log(`${v ? '✅' : '❌'} ${n}`); }
console.log(`   (전광판 등장 인물: ${others.join(',') || '없음'} / 내 이야기 포함: ${mine})`);
if (errs.length) console.log('에러:', errs.slice(0, 3));
await b.close();
process.exit(ok ? 0 : 1);
