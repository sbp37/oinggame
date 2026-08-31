// 젤리샵 오픈 기념 팝업 — 실제 트리거 경로(서버 claimEarlyMember 응답)로 띄워
// 문구·고양이·버튼 두 개·바로가기 이동까지 검사한다. 다크/라이트 양쪽에서 확인.
import { chromium } from 'playwright';

const STUBS = {
  'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-firestore.js': `
    export const getFirestore=()=>({});
    export const collection=(db,...p)=>({__path:p.join('/')});
    export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
    export const getDoc=async()=>({exists:()=>false,data:()=>({})});
    export const getDocs=async()=>({docs:[],forEach:()=>{},empty:true,size:0});
    export const setDoc=async()=>{};export const deleteDoc=async()=>{};export const updateDoc=async()=>{};
    export const addDoc=async()=>({id:'x'});
    export const query=(c)=>c;export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});
    export const startAfter=()=>({});export const increment=()=>0;export const deleteField=()=>({});
    export const serverTimestamp=()=>0;export const arrayUnion=()=>({});export const arrayRemove=()=>({});
    export const getCountFromServer=async()=>({data:()=>({count:0})});
    export const onSnapshot=()=>(()=>{});
    export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});
    export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});`,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};`,
  'firebase-functions.js': `
    export const getFunctions=()=>({});
    export const httpsCallable=(f,n)=>async(p)=>{
      // 실제 트리거 경로를 그대로 태운다: 초기 멤버 대상이면 서버가 granted 를 준다.
      if(n==='shopAction'&&p&&p.action==='claimEarlyMember') return {data:{jelly:33,granted:20}};
      return {data:{}};
    };`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const results = [];
let goUrl = '';
for (const theme of ['dark', 'light']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
    const f = r.request().url().split('/').pop();
    r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
  });
  await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/, r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).slice(0, 140)));
  await p.addInitScript((t) => {
    localStorage.setItem('oeing_nickname_v1', '오잉이');
    localStorage.setItem('oeing_uid_linked_v1', 'u1');
    if (t === 'light') localStorage.setItem('oeing_theme', 'light');
  }, theme);
  await p.goto('http://127.0.0.1:8807/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  // 팝업은 접속 4초 뒤 maybeClaimEarlyMemberGift() 가 서버 응답을 받고 띄운다 — 실제 경로 그대로 기다린다.
  await p.waitForSelector('.jopen-card', { timeout: 15000 });
  const info = await p.evaluate(() => {
    const card = document.querySelector('.jopen-card');
    const hat = document.querySelector('.jopen-jelly');
    const img = document.querySelector('.jopen-cat img');
    const go = document.getElementById('jopenGoBtn');
    const close = document.getElementById('jopenCloseBtn');
    const cr = card.getBoundingClientRect();
    return {
      text: card.innerText.replace(/\n+/g, ' | '),
      cardW: Math.round(cr.width), cardH: Math.round(cr.height),
      jelly: hat ? { size: getComputedStyle(hat).fontSize, top: Math.round(hat.getBoundingClientRect().top) } : '(모자 없음)',
      catTop: img ? Math.round(img.getBoundingClientRect().top) : null,
      imgSrc: img ? img.getAttribute('src') : null,
      buttons: [close && close.innerText, go && go.innerText],
      overflowsViewport: cr.height > window.innerHeight,
      themeApplied: document.body.classList.contains('light') ? 'light' : 'dark',
      cardBg: getComputedStyle(card).backgroundColor,
      closeBg: getComputedStyle(document.getElementById('jopenCloseBtn')).backgroundColor,
    };
  });
  await p.waitForTimeout(400);
  console.log(`\n── ${theme} ──`);
  console.log(JSON.stringify(info, null, 1));
  console.log('JS 에러:', errs.length ? errs : '없음');

  if (theme === 'dark') {
    // '젤리샵 바로가기'가 실제로 상점으로 보내는지
    await p.evaluate(() => document.getElementById('jopenGoBtn').click());
    await p.waitForTimeout(1200);
    goUrl = p.url();
    console.log('바로가기 클릭 후 URL:', goUrl);
  }
  results.push({ theme, info, errs });
  await ctx.close();
}
await b.close();

console.log('\n════ 판정 ════');
const dark = results.find(r => r.theme === 'dark');
const light = results.find(r => r.theme === 'light');
const checks = [
  ['오픈 기념 문구', /젤리샵 오픈 기념/.test(dark.info.text)],
  ['보관함에 숑 넣어뒀다냥 문구', /보관함에 숑 넣어뒀다냥/.test(dark.info.text)],
  ['꾸며보라냥 ♥︎ 문구', /꾸며보라냥/.test(dark.info.text) && /♥/.test(dark.info.text)],
  ['젤리샵 점원과 같은 파란 목도리냥', dark.info.imgSrc === 'assets/img-03.png'],
  ['젤리 모자 표시', dark.info.text.startsWith('🍮')],
  ['닫기 버튼', dark.info.buttons[0] === '닫기'],
  ['젤리샵 바로가기 버튼', /젤리샵 바로가기/.test(dark.info.buttons[1] || '')],
  ['바로가기가 젤리샵으로 이동', /shop-v2-preview\.html\?live=1/.test(goUrl || '')],
  ['카드가 화면을 넘지 않음', dark.info.overflowsViewport === false && light.info.overflowsViewport === false],
  ['라이트에서도 버튼이 카드와 같은 계열', dark.info.closeBg === light.info.closeBg],
  ['JS 에러 없음', dark.errs.length === 0 && light.errs.length === 0],
];
let ok = true;
for (const [n, v] of checks) { if (!v) ok = false; console.log(`${v ? '✅' : '❌'} ${n}`); }
process.exit(ok ? 0 : 1);
