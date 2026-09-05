// ══════════════════════════════════════════════════════════════
//  podium-score-fit.test.mjs — 시상대 점수가 잘리지 않는다
//
//  사고(2026-09-05): 1위 점수가 198409pt 가 되자 화면에 "19840…" 으로 잘려 나왔다.
//   · .podium-score 는 칸을 넘치면 text-overflow:ellipsis 로 잘라 버린다.
//   · 순위별 글자 크기(1위 21px, 2·3위 16px)는 운영에서 "건드리지 말라"고 못 박은 값이다.
//   · 그래서 크기를 낮추는 대신, '넘칠 때 그 칸만' 14px 까지 줄이는 fitPodiumScores 를 뒀다.
//
//  이 테스트가 지키는 약속:
//   ① 6자리 점수(198409pt)도 잘리지 않는다.
//   ② 안 넘치는 점수는 순위별 기본 크기(1위 21px)를 그대로 쓴다 — 멀쩡한 걸 줄이지 않는다.
//   ③ 아무리 길어도 14px 밑으로는 안 내려간다(읽을 수 없어지므로).
//
//  실행: node --test test/podium-score-fit.test.mjs
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
export const query=(c)=>c; export const orderBy=()=>({}); export const limit=()=>({}); export const where=()=>({});
export const getDocs=async()=>({docs:[],size:0,empty:true,forEach(){}});
export const getDoc=async(ref)=>({id:ref.id,exists:()=>false,data:()=>({})});
export const setDoc=async()=>{};export const updateDoc=async()=>{};export const deleteDoc=async()=>{};
export const addDoc=async()=>({id:'x'});
export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});
export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});
export const serverTimestamp=()=>Date.now();
export const increment=(n)=>n;export const arrayUnion=(...a)=>a;export const arrayRemove=(...a)=>a;
export const onSnapshot=()=>()=>{};export const documentId=()=>'__name__';export const startAfter=()=>({});
export const Timestamp={now:()=>({toMillis:()=>Date.now()}),fromMillis:(m)=>({toMillis:()=>m})};`,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

// 시상대 세 칸을 실제 마크업 그대로 그린 뒤 fitPodiumScores 를 태우고 결과를 잰다.
async function measure(scores) {
  const server = createServer(async (req, res) => {
    const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html';
    try {
      const body = await readFile(new URL(name, ROOT));
      res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('nope'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
      const f = r.request().url().split('/').pop();
      r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
    });
    await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    await p.evaluate(() => { document.getElementById('tabRank').click(); });
    await p.waitForTimeout(1200);
    return await p.evaluate((scores) => {
      const podium = document.getElementById('podiumWrap');
      const defs = [['rank2', '2', scores[1]], ['rank1', '1', scores[0]], ['rank3', '3', scores[2]]];
      podium.innerHTML = defs.map(([cls, num, s]) => `
        <div class="podium-item ${cls}">
          <div class="podium-nick"><span class="podium-nick-text">제이1</span></div>
          <div class="podium-score">${s}pt</div>
          <div class="podium-base">${num}</div>
        </div>`).join('');
      // 실제 렌더 경로와 같은 함수를 태운다.
      window.fitPodiumScores(podium);
      return [...podium.querySelectorAll('.podium-score')].map((el) => ({
        text: el.textContent,
        px: Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10,
        clipped: el.scrollWidth > el.clientWidth + 1,
      }));
    }, scores);
  } finally {
    await b.close();
    await new Promise((r) => server.close(r));
  }
}

test('① 6자리 점수(198409pt)도 시상대에서 잘리지 않는다', async () => {
  const out = await measure([198409, 119448, 90794]);
  for (const r of out) {
    assert.equal(r.clipped, false, `${r.text} 가 ${r.px}px 에서 잘렸다 — 화면엔 "19840…" 처럼 나온다`);
  }
});

test('② 안 넘치는 점수는 순위별 기본 크기를 그대로 쓴다 (1위 21px)', async () => {
  const out = await measure([9428, 5252, 3616]);
  const first = out[1]; // 가운데가 1위
  assert.equal(first.px, 21, `짧은 점수인데 ${first.px}px 로 줄었다 — 멀쩡한 걸 건드리면 안 된다`);
});

test('③ 아무리 길어도 14px 밑으로는 내려가지 않는다', async () => {
  const out = await measure([1234567890, 1234567890, 1234567890]);
  for (const r of out) {
    assert.ok(r.px >= 14, `${r.px}px — 너무 작아 읽을 수 없다`);
  }
});
