// ══════════════════════════════════════════════════════════════
//  rank-cache-freshness.test.mjs — 공개 랭킹 캐시가 뒤처지면 원본으로 폴백한다
//
//  사고(2026-09-03): "로로님이랑 또우또우님 오늘 게임했는데 이번주 랭킹에 안 나와."
//   · 읽기 비용 절감으로 랭킹을 public_rank_cache/{all,week_*} 파생 문서 1건만 읽게 바꿨는데,
//     그 문서를 갱신하는 서버 트리거가 멈춰 캐시가 12:27에 그대로 얼어 있었다.
//   · 그 뒤에 기록을 낸 6명이 랭킹에서 통째로 사라지고, 5명은 옛 점수로 떠서 순위까지 뒤집혔다
//     (레레님: 실제 90,794점인데 캐시엔 54,138점).
//   · 원본(weekly_rankings)은 처음부터 멀쩡했다 — 화면만 얼어붙은 캐시를 보고 있었다.
//
//  캐시는 '싸게 보여주기'용이지 랭킹을 틀리게 만들 권한이 없다. 그래서 캐시를 쓰기 전에
//  원본에서 '가장 최근 갱신 1건'만 읽어(1 read) 캐시가 그걸 담고 있는지 확인한다.
//
//  이 테스트가 지키는 약속:
//   ① 캐시가 최신이면 그대로 쓴다 — 원본 전량 쿼리(limit 500)를 하지 않는다(비용 절감 유지).
//   ② 가장 최근에 논 사람이 캐시에 없으면 원본으로 폴백해 그 사람이 랭킹에 보인다.
//   ③ 캐시 점수가 원본보다 낮아도(순위가 뒤집히는 경우) 폴백해 원본 점수로 보여준다.
//
//  실행: node --test test/rank-cache-freshness.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const DAY = 86400000;
const NOW = Date.now();

// 이번 주 원본 — '방금논사람'이 가장 최근(ts 최대) 기록의 주인이다.
const WEEK_SOURCE = [
  { id: '일등', score: 90000, ts: NOW - 2 * DAY },
  { id: '이등', score: 80000, ts: NOW - 2 * DAY },
  { id: '삼등', score: 70000, ts: NOW - 2 * DAY },
  { id: '넷째', score: 60000, ts: NOW - 2 * DAY },
  { id: '다섯째', score: 50000, ts: NOW - 3 * DAY },
  { id: '어제논사람', score: 9428, ts: NOW - DAY },
  { id: '방금논사람', score: 5252, ts: NOW - 60000 },
];
const ALL_SOURCE = WEEK_SOURCE.map((r) => ({ ...r, score: r.score + 100000 }));

// 캐시 시나리오 3종. rows 는 캐시 문서에 들어 있는 내용.
const SCENARIOS = {
  fresh: WEEK_SOURCE,
  // 캐시가 얼어붙어 '방금논사람'이 통째로 빠진 상태 (실제 사고 재현)
  missingNewest: WEEK_SOURCE.filter((r) => r.id !== '방금논사람'),
  // 최근 기록자는 있는데 점수가 옛 값 — 순위가 뒤집히는 경우 (레레님 사례)
  staleScore: WEEK_SOURCE.map((r) => (r.id === '방금논사람' ? { ...r, score: 1 } : r)),
};

function stub(scenarioRows) {
  return `
const WEEK=${JSON.stringify(WEEK_SOURCE)};
const ALL=${JSON.stringify(ALL_SOURCE)};
const CACHE_WEEK=${JSON.stringify(scenarioRows)};
window.__q=[];
const toRow=(r)=>({nickname:r.id,score:r.score,ts:r.ts,uid:'u_'+r.id});
function rowsFor(path){
  if(path==='rankings') return ALL.map(r=>({id:r.id,data:{score:r.score,ts:r.ts,uid:'u_'+r.id}}));
  if(/^weekly_rankings\\/[^/]+\\/scores$/.test(path)) return WEEK.map(r=>({id:r.id,data:{score:r.score,ts:r.ts,uid:'u_'+r.id}}));
  return [];
}
function cacheDoc(path){
  if(path==='public_rank_cache/all') return {version:1,complete:true,kind:'all',weekId:null,updatedAt:Date.now(),rows:ALL.map(toRow)};
  if(/^public_rank_cache\\/week_/.test(path)) return {version:1,complete:true,kind:'week',weekId:path.split('week_')[1],updatedAt:Date.now(),rows:CACHE_WEEK.map(toRow)};
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
  window.__q.push(q.__path+'|'+(q.__ord?q.__ord.join(' '):'')+'|'+(q.__lim||0));
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

const BASE_STUBS = {
  'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

// 이번주 랭킹 탭을 그린 뒤, 화면에 뜬 사람들과 실제로 나간 쿼리를 돌려준다.
async function renderWeekTab(scenario) {
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
    const stubs = { ...BASE_STUBS, 'firebase-firestore.js': stub(SCENARIOS[scenario]) };
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
    return await p.evaluate(() => {
      const rows = [...document.querySelectorAll('#rankList .rank-row')].map((r) => ({
        nick: r.dataset.nick,
        pts: (r.querySelector('.rank-pts') || {}).textContent || '',
      }));
      const podium = [...document.querySelectorAll('#podiumWrap .podium-item[data-nick]')].map((e) => e.dataset.nick);
      return { rows, podium, queries: window.__q || [] };
    });
  } finally {
    await b.close();
    await new Promise((r) => server.close(r));
  }
}

const weeklyFullScan = (queries) => queries.some((q) => /^weekly_rankings\/.+\/scores\|score desc\|500$/.test(q));
const freshnessProbe = (queries) => queries.some((q) => /^weekly_rankings\/.+\/scores\|ts desc\|1$/.test(q));

test('캐시가 최신이면 그대로 쓴다 — 원본 전량 조회를 하지 않는다(비용 절감 유지)', async () => {
  const out = await renderWeekTab('fresh');
  assert.ok(out.rows.some((r) => r.nick === '방금논사람'), '최신 캐시에는 모두 들어 있으니 그대로 보여야 한다');
  assert.equal(freshnessProbe(out.queries), true, '신선도 확인용 1건 조회는 있어야 한다');
  assert.equal(weeklyFullScan(out.queries), false, '캐시가 멀쩡한데 원본 500건을 다시 읽으면 절감 효과가 사라진다');
});

test('가장 최근에 논 사람이 캐시에 없으면 원본으로 폴백해 랭킹에 보여준다', async () => {
  const out = await renderWeekTab('missingNewest');
  const shown = [...out.podium, ...out.rows.map((r) => r.nick)];
  assert.ok(shown.includes('방금논사람'), '캐시가 멈춰 있어도 방금 논 사람은 랭킹에 나와야 한다');
  assert.equal(weeklyFullScan(out.queries), true, '뒤처진 캐시는 버리고 원본을 읽어야 한다');
});

test('캐시 점수가 원본보다 낮으면(순위가 뒤집히면) 폴백해 원본 점수로 보여준다', async () => {
  const out = await renderWeekTab('staleScore');
  const row = out.rows.find((r) => r.nick === '방금논사람');
  assert.ok(row, '방금논사람이 목록에 있어야 한다');
  assert.match(row.pts, /5252/, `캐시의 옛 점수(1점)가 아니라 원본 점수여야 한다 — 실제로 표시된 값: ${row.pts}`);
  assert.equal(weeklyFullScan(out.queries), true);
});
