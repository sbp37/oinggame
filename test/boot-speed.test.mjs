// ══════════════════════════════════════════════════════════════
//  boot-speed.test.mjs — 메인 화면이 빨리, 한꺼번에 뜨는지
//
//  운영 보고: "메인화면 로딩이 긴 것 같다. 랭킹 버튼이든 리뷰든 전광판이든
//  다 제각각 뒤늦게 뜬다. 게임 속 고양이도 시작하고 3초쯤 뒤에 바뀐다."
//
//  측정해보니 원인이 두 가지였다.
//   ① 웹폰트 CSS(구글·jsdelivr)가 렌더 차단이라, 남의 서버가 늦으면 그만큼 화면이
//      통째로 비어 있었다 — 폰트 4초 → 첫 화면 4.14초로 1:1 따라갔다.
//   ② 내 고양이 스킨이 메모리에만 있어서 새로고침마다 서버 왕복이 끝나야 알 수 있었다.
//
//  실행: node --test test/boot-speed.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const src = await readFile(new URL('index.html', ROOT), 'utf8');

const STUBS = {
  'firebase-app.js': `export const initializeApp=()=>({});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-firestore.js': `const d=ms=>new Promise(r=>setTimeout(r,ms));
    export const getFirestore=()=>({});export const collection=(db,...p)=>({__path:p.join('/')});
    export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
    export const getDoc=async()=>{await d(300);return{exists:()=>false,data:()=>({})}};
    export const getDocs=async()=>{await d(300);return{docs:[],forEach:()=>{},empty:true,size:0}};
    export const setDoc=async()=>{};export const deleteDoc=async()=>{};export const updateDoc=async()=>{};
    export const addDoc=async()=>({id:'x'});export const query=c=>c;export const where=()=>({});
    export const orderBy=()=>({});export const limit=()=>({});
    export const writeBatch=()=>({set(){},commit:async()=>{}});
    export const runTransaction=async(db,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});`,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),50);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

const server = createServer(async (req, res) => {
  const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html';
  try {
    const body = await readFile(new URL(name, ROOT));
    res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// 폰트 CDN 이 fontDelay 만큼 느린 상황에서 첫 화면이 언제 뜨는지
async function firstPaintWithSlowFonts(fontDelay) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('https://www.gstatic.com/firebasejs/**', r => {
    const f = r.request().url().split('/').pop();
    r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
  });
  await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/, r => r.abort());
  await ctx.route(/fonts\.googleapis\.com|cdn\.jsdelivr\.net/, async r => {
    await new Promise(x => setTimeout(x, fontDelay));
    r.fulfill({ status: 200, contentType: 'text/css', body: '/* */' });
  });
  await ctx.route(/fonts\.gstatic\.com/, r => r.abort());
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(600);
  const t = await p.evaluate(() => {
    const e = performance.getEntriesByType('paint').find(x => x.name === 'first-contentful-paint');
    return e ? Math.round(e.startTime) : null;
  });
  await ctx.close();
  return t;
}

test('웹폰트가 느려도 첫 화면은 기다리지 않는다', async () => {
  const slow = await firstPaintWithSlowFonts(3000);
  assert.ok(slow !== null, '첫 화면이 그려져야 합니다');
  assert.ok(slow < 1500,
    `폰트 CDN 이 3초 걸려도 첫 화면은 1.5초 안에 떠야 합니다 (지금 ${slow}ms). ` +
    '폰트 link 가 다시 렌더 차단이 되면 여기서 걸립니다.');
});

test('폰트 link 는 렌더를 막지 않게 걸려 있다', () => {
  // media="print" 로 받아 렌더 차단 목록에서 빠지고, 다 받으면 all 로 바꿔 적용한다.
  for (const host of ['fonts.googleapis.com', 'cdn.jsdelivr.net']) {
    const tag = src.match(new RegExp(`<link rel="stylesheet" href="https://${host.replace('.', '\\.')}[^>]*>`));
    assert.ok(tag, `${host} 스타일시트를 찾지 못했습니다`);
    assert.match(tag[0], /media="print"/, `${host} 가 렌더 차단으로 돌아갔습니다`);
    assert.match(tag[0], /onload="this\.media='all'/, `${host} 가 다 받은 뒤 적용돼야 합니다`);
  }
  // 스크립트가 막힌 환경을 위한 대비책은 남겨둔다.
  assert.match(src, /<noscript>[\s\S]*fonts\.googleapis\.com[\s\S]*<\/noscript>/);
});

test('내 고양이 스킨은 기기에 기억해 두고 그리기 전에 먼저 쓴다', () => {
  assert.match(src, /const CAT_SKIN_CACHE_KEY = 'oeing_cat_skin_v1';/);
  // 저장한 값을 모듈 초기화 때(첫 렌더 전에) 바로 적용해야 의미가 있다.
  const init = src.indexOf('loadCatSkinCache();');
  const firstRefresh = src.indexOf('setTimeout(() => refreshMyCatSkin()');
  assert.ok(init > 0 && init < firstRefresh,
    '서버 조회보다 먼저 캐시를 적용해야 시작하자마자 내 고양이가 보입니다');
  // 서버 확인이 끝나면 값을 갱신해 다음 접속에 쓴다.
  assert.match(src, /saveCatSkinCache\(myNick\);/);
  // 남의 닉네임 값을 쓰면 안 된다.
  assert.match(src, /if \(!v \|\| v\.nick !== loadNickname\(\)\) return;/);
});

test('화면이 가려지면 장식 애니메이션을 멈춘다 (배터리·발열)', () => {
  assert.match(src, /body\.page-hidden \*[\s\S]{0,120}animation-play-state: paused/);
  assert.match(src, /document\.body\.classList\.toggle\('page-hidden', document\.hidden\)/);
});

test('메인 화면 요소가 초 단위로 늦게 뜨지 않는다', () => {
  // 전광판·계정 버튼은 조회가 끝나야 채워지므로, 대기 시간이 그대로 빈 칸 시간이 된다.
  const ticker = Number(src.match(/setTimeout\(initHomeTicker, (\d+)\);/)[1]);
  assert.ok(ticker <= 300, `전광판 시작이 너무 늦습니다 (${ticker}ms)`);
  const acct = Number(src.match(/setTimeout\(\(\) => \{ try \{ updateAccountLinkBtn\(\); \} catch \{\} \}, (\d+)\);/)[1]);
  assert.ok(acct <= 400, `계정 버튼 갱신이 너무 늦습니다 (${acct}ms)`);
});

test.after(async () => { await browser.close(); await new Promise(r => server.close(r)); });
