// ══════════════════════════════════════════════════════════════
//  podium-score-fit.test.mjs — 시상대 점수가 잘리지 않는다
//
//  사고(2026-09-05): 1위 점수가 7자리가 되자 화면에 "198407…" 으로 잘려 나왔다.
//   · .podium-score 는 칸(.podium-item.rank1 = 98px)을 넘치면 ellipsis 로 잘라 버린다.
//   · 순위별 글자 크기(1위 21px, 2·3위 16px)는 운영에서 "건드리지 말라"고 못 박은 값이다.
//   · 그래서 크기를 낮추는 대신, '넘칠 때 그 칸만' 12px 까지 줄이는 fitPodiumScores 를 뒀다.
//
//  1차 수정이 실제로는 안 먹었다. 원인이 될 수 있는 두 가지를 여기서 같이 막는다:
//   ① 마크업만 만들어 놓고 재면 화면에 없을 때 clientWidth 가 0 이라 못 잰다.
//   ② 웹폰트가 늦게 도착하면 먼저 잰 결과가 무의미해진다.
//  그래서 아래 ①번 테스트는 '실제 랭킹 렌더 경로'(탭 클릭 → 주간 랭킹 렌더)를 그대로 타고,
//  폰트 로드까지 기다린 뒤에 잰다. 마크업을 직접 꽂는 방식으로는 이 사고가 안 잡혔다.
//
//  이 테스트가 지키는 약속:
//   ① 실제 렌더 경로에서 7자리 점수(1984079pt)가 잘리지 않는다.
//   ② 안 넘치는 점수는 순위별 기본 크기(1위 21px)를 그대로 쓴다 — 멀쩡한 걸 줄이지 않는다.
//   ③ 아무리 길어도 12px 밑으로는 안 내려간다(읽을 수 없어지므로).
//
//  실행: node --test test/podium-score-fit.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const DAY = 86400000;
const NOW = Date.now();

const BASE_STUBS = {
  'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

// 주간·전체 랭킹을 주어진 점수로 채우는 firestore 스텁.
function firestoreStub(scores) {
  const rows = scores.map((score, i) => ({ id: ['제이1', '제제', '레레', '하비', '이에멍'][i] || ('유저' + i), score, ts: NOW - i * DAY }));
  return `
const ROWS=${JSON.stringify(rows)};
const toRow=(r)=>({nickname:r.id,score:r.score,ts:r.ts,uid:'u_'+r.id});
function rowsFor(path){
  if(path==='rankings'||/^weekly_rankings\\/[^/]+\\/scores$/.test(path))
    return ROWS.map(r=>({id:r.id,data:{score:r.score,ts:r.ts,uid:'u_'+r.id}}));
  return [];
}
function cacheDoc(path){
  if(path==='public_rank_cache/all') return {version:1,complete:true,kind:'all',weekId:null,updatedAt:Date.now(),rows:ROWS.map(toRow)};
  if(/^public_rank_cache\\/week_/.test(path)) return {version:1,complete:true,kind:'week',weekId:path.split('week_')[1],updatedAt:Date.now(),rows:ROWS.map(toRow)};
  return null;
}
export const getFirestore=()=>({});
export const collection=(db,...p)=>({__path:p.join('/'),__ord:null,__lim:0});
export const doc=(db,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});
export const query=(c,...m)=>{const q={...c};m.forEach(x=>{if(x&&x.__ord)q.__ord=x.__ord;if(x&&x.__lim)q.__lim=x.__lim;});return q;};
export const orderBy=(f,d)=>({__ord:[f,d||'asc']});
export const limit=(n)=>({__lim:n});
export const where=()=>({});
export const getDocs=async(q)=>{
  let rows=rowsFor(q.__path);
  if(q.__ord){const[f,d]=q.__ord;rows=rows.filter(r=>r.data[f]!==undefined).slice().sort((a,b)=>{const A=a.data[f],B=b.data[f];return (A<B?-1:A>B?1:0)*(d==='desc'?-1:1);});}
  if(q.__lim)rows=rows.slice(0,q.__lim);
  const docs=rows.map(r=>({id:r.id,exists:()=>true,data:()=>r.data}));
  return {docs,size:docs.length,empty:docs.length===0,forEach:(fn)=>docs.forEach(fn)};
};
export const getDoc=async(ref)=>{
  const c=cacheDoc(ref.__path);
  if(c) return {id:ref.id,exists:()=>true,data:()=>c};
  const parts=String(ref.__path).split('/');
  const hit=rowsFor(parts.slice(0,-1).join('/')).find(r=>r.id===parts[parts.length-1]);
  return {id:ref.id,exists:()=>!!hit,data:()=>hit?hit.data:{}};
};
export const setDoc=async()=>{};export const updateDoc=async()=>{};export const deleteDoc=async()=>{};
export const addDoc=async()=>({id:'x'});
export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});
export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});
export const serverTimestamp=()=>Date.now();
export const increment=(n)=>n;export const arrayUnion=(...a)=>a;export const arrayRemove=(...a)=>a;
export const onSnapshot=()=>()=>{};export const documentId=()=>'__name__';export const startAfter=()=>({});
export const Timestamp={now:()=>({toMillis:()=>Date.now()}),fromMillis:(m)=>({toMillis:()=>m})};
`;
}

// 실제 랭킹 탭을 열어 시상대를 그린 뒤, 각 칸의 점수 글자 크기와 잘림 여부를 돌려준다.
async function renderPodium(scores) {
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
    const stubs = { ...BASE_STUBS, 'firebase-firestore.js': firestoreStub(scores) };
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
      const f = r.request().url().split('/').pop();
      r.fulfill({ status: 200, contentType: 'text/javascript', body: stubs[f] || 'export default {};' });
    });
    await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.addInitScript(() => { localStorage.setItem('oeing_nickname_v1', '오잉이'); });
    await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    await p.evaluate(() => { document.getElementById('tabRank').click(); });
    await p.waitForTimeout(3500);
    await p.evaluate(() => document.fonts && document.fonts.ready);
    await p.waitForTimeout(500);
    return await p.evaluate(() => [...document.querySelectorAll('#podiumWrap .podium-score')].map((el) => ({
      cls: el.parentElement.className.match(/rank[123]/)?.[0] || '?',
      text: el.textContent,
      px: Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10,
      clipped: el.scrollWidth > el.clientWidth + 1,
    })));
  } finally {
    await b.close();
    await new Promise((r) => server.close(r));
  }
}

test('① 실제 랭킹 렌더 경로에서 7자리 점수(1984079pt)가 잘리지 않는다', async () => {
  const out = await renderPodium([1984079, 119448, 90794, 60999, 59372]);
  assert.ok(out.length >= 3, `시상대가 안 그려졌다: ${JSON.stringify(out)}`);
  for (const r of out) {
    assert.equal(r.clipped, false, `${r.cls} "${r.text}" 이 ${r.px}px 에서 잘렸다 — 화면엔 "198407…" 처럼 나온다`);
  }
});

test('② 안 넘치는 점수는 순위별 기본 크기를 그대로 쓴다 (1위 21px)', async () => {
  const out = await renderPodium([9428, 5252, 3616, 2100, 1800]);
  const first = out.find((r) => r.cls === 'rank1');
  assert.ok(first, `1위 칸을 못 찾았다: ${JSON.stringify(out)}`);
  assert.equal(first.px, 21, `짧은 점수(${first.text})인데 ${first.px}px 로 줄었다 — 멀쩡한 걸 건드리면 안 된다`);
});

test('③ 아무리 길어도 12px 밑으로는 내려가지 않는다', async () => {
  const out = await renderPodium([1234567890123, 1234567890123, 1234567890123, 100, 90]);
  for (const r of out) {
    assert.ok(r.px >= 12, `${r.cls} ${r.px}px — 너무 작아 읽을 수 없다`);
  }
});
