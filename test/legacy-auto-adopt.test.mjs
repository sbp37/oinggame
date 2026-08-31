// ══════════════════════════════════════════════════════════════
//  legacy-auto-adopt.test.mjs — 미연결 레거시 계정의 자동 연결(브라우저 실행)
//
//  실사례(사이다): 2026-07-05부터 매일 하는데 users/{uid}·user_stats/{uid} 가 없었다.
//  자동입양은 있었지만 '내 정보 → 연결 정보 보기'와 '리뷰 쓰기'에서만 불려서,
//  그 두 곳을 안 들르면 영영 미연결이었다. 미연결이면 젤리샵에서 산 스킨이
//  rankings/{닉} 의 uid 로 매칭되지 않아 랭킹에 안 보인다.
//
//  여기서는 정적 검사가 아니라 실제 페이지를 띄워서
//   ① 접속만 해도 restoreAccount(adoptLegacy) 가 호출되는지
//   ② 이미 연결된 계정에는 호출되지 않는지(불필요한 서버 호출 0)
//  를 확인한다. nickname_lookup 은 '예약+무주인'으로 스텁해 사전 필터를 통과시킨다.
//  실행: node --test test/legacy-auto-adopt.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

const STUBS = {
  'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-firestore.js': `
    export const getFirestore=()=>({});
    export const collection=(db,...p)=>({__path:p.join('/')});
    export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
    // nickname_lookup/{닉} 만 '예약+무주인'으로 존재 — 자동입양 사전 필터가 통과해야 한다.
    export const getDoc=async(ref)=>{
      const p=(ref&&ref.__path)||'';
      if(p.startsWith('nickname_lookup/')) return {exists:()=>true,data:()=>({reserved:true,nickname:'사이다'})};
      return {exists:()=>false,data:()=>({})};
    };
    export const getDocs=async()=>({docs:[],forEach:()=>{},empty:true,size:0});
    export const setDoc=async()=>{};export const deleteDoc=async()=>{};export const updateDoc=async()=>{};
    export const addDoc=async()=>({id:'x'});
    export const query=(c)=>c;export const where=()=>({});export const orderBy=()=>({});export const limit=()=>({});
    export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});
    export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});`,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
  'firebase-functions.js': `
    export const getFunctions=()=>({});
    export const httpsCallable=(f,n)=>async(p)=>{
      (window.__calls=window.__calls||[]).push({fn:n,action:(p&&p.action)||''});
      if(n==='restoreAccount'&&p&&p.action==='adoptLegacy') return {data:{mode:'adopted'}};
      return {data:{}};
    };`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

async function withPage(initScript, fn) {
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
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
      const f = r.request().url().split('/').pop();
      r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
    });
    await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/, r => r.abort());
    const p = await ctx.newPage();
    await p.addInitScript(initScript);
    await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5000); // 자동 연결은 접속 3초 뒤에 시도된다
    return await fn(p);
  } finally {
    await b.close();
    await new Promise(r => server.close(r));
  }
}

test('미연결 레거시 계정은 접속만 해도 자동 연결을 시도한다', async () => {
  const calls = await withPage(() => {
    localStorage.setItem('oeing_nickname_v1', '사이다');
    // uid_linked 를 심지 않는다 = 사이다 님 상태(로그인은 됐지만 계정 미연결)
  }, (p) => p.evaluate(() => window.__calls || []));
  const adopt = calls.filter(c => c.fn === 'restoreAccount' && c.action === 'adoptLegacy');
  assert.equal(adopt.length, 1, `adoptLegacy 가 한 번 호출돼야 합니다 (호출: ${JSON.stringify(calls)})`);
});

test('이미 연결된 계정에는 자동 연결을 호출하지 않는다 (불필요한 서버 호출 0)', async () => {
  const calls = await withPage(() => {
    localStorage.setItem('oeing_nickname_v1', '오잉이');
    localStorage.setItem('oeing_uid_linked_v1', 'u1');
  }, (p) => p.evaluate(() => window.__calls || []));
  const adopt = calls.filter(c => c.action === 'adoptLegacy');
  assert.equal(adopt.length, 0, `연결된 계정엔 호출이 없어야 합니다 (호출: ${JSON.stringify(calls)})`);
});
