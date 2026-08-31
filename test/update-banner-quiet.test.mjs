// ══════════════════════════════════════════════════════════════
//  update-banner-quiet.test.mjs — 상단 새로고침 배너가 뜨는 조건(브라우저 실행)
//
//  운영 보고(2026-08-31): "배너가 너무 자주 뜬다. 새로고침해도 또 뜬다."
//   · 예전엔 build 만 오르면 떴는데 build 는 배포마다 오른다. 하루에 자잘한 수정을
//     여러 번 내보내면 그때마다 떴다.
//   · 눌러서 새로고침해도, 브라우저가 옛 index.html 을 캐시로 주면 BUILD 가 그대로라
//     같은 안내가 또 떴다.
//
//  이제 version.json 의 notifyBuild(알릴 만한 변경일 때만 올리는 값)로만 뜨고,
//  한 번 눌러서 새로고침했으면 같은 안내는 다시 뜨지 않는다.
//  실행: node --test test/update-banner-quiet.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const src = await readFile(new URL('index.html', ROOT), 'utf8');
const BUILD = Number(src.match(/const BUILD = (\d+);/)[1]);

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
    export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});
    export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});`,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

// version.json 만 시나리오대로 바꿔 응답하고 나머지는 실제 파일을 그대로 준다.
async function bannerShown(versionJson, initScript) {
  const server = createServer(async (req, res) => {
    const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html';
    if (name === 'version.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(versionJson));
      return;
    }
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
    await p.addInitScript(initScript || (() => { localStorage.setItem('oeing_nickname_v1', '오잉이'); }));
    await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(3500);
    await p.evaluate(() => { try { document.getElementById('tabRank').click(); } catch {} });
    await p.waitForTimeout(1500);
    return await p.evaluate(() => {
      const el = document.getElementById('newVersionBanner');
      if (!el) return false;
      return getComputedStyle(el).display !== 'none';
    });
  } finally {
    await b.close();
    await new Promise(r => server.close(r));
  }
}

test('자잘한 배포(build 만 오름)에는 배너가 뜨지 않는다', async () => {
  const shown = await bannerShown({ build: BUILD + 5000, notifyBuild: BUILD });
  assert.equal(shown, false, 'build 만 올랐는데 배너가 뜨면 배포마다 성가시다');
});

test('큰 변경(notifyBuild 가 오름)에는 배너가 뜬다', async () => {
  const shown = await bannerShown({ build: BUILD + 5000, notifyBuild: BUILD + 5000 });
  assert.equal(shown, true, '알릴 만한 변경에는 떠야 한다');
});

test('그 안내로 이미 새로고침했으면 다시 뜨지 않는다 (캐시로 옛 화면이 떠도)', async () => {
  const shown = await bannerShown(
    { build: BUILD + 5000, notifyBuild: BUILD + 5000 },
    () => {
      localStorage.setItem('oeing_nickname_v1', '오잉이');
      // 눌렀을 때 저장되는 값과 같은 상태를 미리 만들어 둔다.
      localStorage.setItem('oeing_update_nag_v1', String(9999999999));
    },
  );
  assert.equal(shown, false, '한 번 눌렀으면 같은 안내로 다시 조르면 안 된다');
});

test('notifyBuild 가 없는 옛 version.json 이면 조용히 넘어간다', async () => {
  const shown = await bannerShown({ build: BUILD + 5000 });
  assert.equal(shown, false, '알릴 만한 변경인지 모를 땐 안 띄우는 쪽이 안전하다');
});
