// ══════════════════════════════════════════════════════════════
//  rank-find.test.mjs — 랭킹 '닉네임으로 찾기' (브라우저 실행)
//
//  운영 보고(2026-09-03): "랭킹에 로로님이 안 보여."
//   · 확인해보니 데이터는 멀쩡했다. 로로님은 그 시점에 이번 주 기록이 아직 없었고,
//     기본 탭이 '이번주'라서 목록에 안 올라왔던 것뿐이다(전체 랭킹엔 22위로 있었다).
//   · 즉 버그가 아니라 "왜 없는지 알 방법이 없다"가 문제였다. 같은 이유로 안 보이는 사람이
//     상시 200명 가까이 된다(전체 233명 중 이번 주에 논 사람은 35명 수준).
//   · '전체' 탭도 100등까지만 펼쳐 두므로 아래쪽 사람은 '더보기' 뒤에 접혀 있다.
//
//  그래서 찾기를 넣었다. 이 테스트가 지키는 약속:
//   ① 이번 주 기록이 없는 사람을 찾으면 그 사실 + 전체 순위를 알려준다(그냥 '없음'이 아니라).
//   ② 거기서 '전체 랭킹에서 보기'를 누르면 전체 탭으로 넘어가 그 줄을 강조한다.
//   ③ 100등 밖으로 접힌 사람도 '더보기'를 대신 펼쳐서 데려간다.
//   ④ 진짜 기록이 없는 닉네임은 없다고 분명히 말한다.
//   ⑤ 시상대(1~3위)에 있는 사람도 찾힌다.
//
//  실행: node --test test/rank-find.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

// ── 고정 데이터 ──────────────────────────────────────────────
//  전체 120명(→ 100등 컷이 생겨 '더보기'가 뜬다), 이번 주는 그중 4명만.
//  · '로로'      : 전체엔 있고 이번 주엔 없다 (실제 보고 상황 재현)
//  · '접힌사람'  : 전체 110위 — 더보기 안에 접혀 있다
//  · '제이1'     : 전체·이번주 모두 1위 — 시상대에 올라간다
const ALL_ROWS = [
  { id: '제이1', score: 300000 },
  { id: '두번째', score: 200000 },
  { id: '세번째', score: 150000 },
  { id: '로로', score: 21918 },
];
for (let i = 0; i < 116; i++) {
  // 5위부터 120위까지 채운다. 110위 자리에 '접힌사람'을 심는다.
  const rank = i + 5;
  ALL_ROWS.push({ id: rank === 110 ? '접힌사람' : `유저${rank}`, score: 20000 - i * 10 });
}
const WEEK_ROWS = [
  { id: '제이1', score: 90000 },
  { id: '두번째', score: 80000 },
  { id: '세번째', score: 70000 },
  { id: '주간만있음', score: 1000 },
];

const FIRESTORE_STUB = `
const ALL=${JSON.stringify(ALL_ROWS)};
const WEEK=${JSON.stringify(WEEK_ROWS)};
function rowsFor(path){
  if(path==='rankings') return ALL.map(r=>({id:r.id,data:{score:r.score,ts:0,uid:'u_'+r.id}}));
  if(/^weekly_rankings\\/[^/]+\\/scores$/.test(path)) return WEEK.map(r=>({id:r.id,data:{score:r.score,ts:0,uid:'u_'+r.id}}));
  return [];
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
  if(q.__ord){const[f,d]=q.__ord;rows=[...rows].sort((a,b)=>((a.data[f]<b.data[f])?-1:(a.data[f]>b.data[f])?1:0)*(d==='desc'?-1:1));}
  if(q.__lim)rows=rows.slice(0,q.__lim);
  const docs=rows.map(r=>({id:r.id,exists:()=>true,data:()=>r.data}));
  return {docs,size:docs.length,empty:docs.length===0,forEach:(fn)=>docs.forEach(fn)};
};
export const getDoc=async(ref)=>{
  const parts=String(ref.__path).split('/');
  const coll=parts.slice(0,-1).join('/'), id=parts[parts.length-1];
  const hit=rowsFor(coll).find(r=>r.id===id);
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

const STUBS = {
  'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-firestore.js': FIRESTORE_STUB,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
};

// 랭킹 탭을 연 페이지 하나로 여러 검사를 돌린다(브라우저 기동이 비싸서 한 번만 띄운다).
async function withRankTab(fn) {
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
    await p.addInitScript(() => { localStorage.setItem('oeing_nickname_v1', '오잉이'); });
    await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    await p.evaluate(() => { document.getElementById('tabRank').click(); });
    await p.waitForTimeout(2500);
    return await fn(p);
  } finally {
    await b.close();
    await new Promise((r) => server.close(r));
  }
}

// 찾기 실행 후 화면 상태를 요약해 돌려준다.
const FIND = `(nick) => { const i=document.getElementById('rankFindInput'); i.value=nick; document.getElementById('rankFindBtn').click(); }`;
const SNAP = `() => {
  const box=document.getElementById('rankFindResult');
  const hit=document.querySelector('.rank-found');
  return {
    msg: (box && getComputedStyle(box).display!=='none') ? box.textContent.replace(/\\s+/g,' ').trim() : '',
    hitNick: hit ? (hit.dataset.nick||'') : '',
    hitIsPodium: hit ? hit.classList.contains('podium-item') : false,
    hitFolded: hit ? hit.classList.contains('rank-extra-hidden') : null,
    hasGoBtn: !!document.getElementById('rankFindGoAll'),
    mode: (document.querySelector('.rank-mode-btn.active')||{}).id || '',
  };
}`;

test('랭킹 찾기 — 안 보이는 사람이 왜 안 보이는지 알려주고, 접힌 줄까지 펼쳐서 데려간다', async () => {
  const out = await withRankTab(async (p) => {
    // 안내 문구가 뜰 때까지 짧게 폴링한 뒤 바로 읽는다. 오래 기다리면 주기적인 재렌더가
    // 목록을 새로 그리면서 강조 클래스를 지워버려, 되레 불안정해진다.
    const snap = () => p.evaluate(new Function(`return (${SNAP})()`));
    const find = async (nick) => {
      await p.evaluate(new Function('nick', `(${FIND})(nick)`), nick);
      for (let i = 0; i < 25; i++) {
        const s = await snap();
        if (s.msg) { await p.waitForTimeout(120); return snap(); }
        await p.waitForTimeout(100);
      }
      return snap();
    };
    const r = {};

    // ① 이번주 탭 — 이번 주 기록이 없는 사람
    r.weekMissing = await find('로로');
    // ② 거기서 '전체 랭킹에서 보기'
    await p.evaluate(() => { const b = document.getElementById('rankFindGoAll'); if (b) b.click(); });
    await p.waitForTimeout(3500);
    r.afterGo = await snap();
    // ③ 전체 탭 — 100등 밖(접힌) 사람
    r.folded = await find('접힌사람');
    // ④ 아예 없는 닉네임
    r.absent = await find('이런닉네임은없다');
    // ⑤ 시상대에 있는 사람
    r.podium = await find('제이1');
    return r;
  });

  // ① 그냥 '없음'이 아니라 이유 + 전체 순위를 말해준다
  assert.equal(out.weekMissing.mode, 'rankModeWeek');
  assert.match(out.weekMissing.msg, /로로/);
  assert.match(out.weekMissing.msg, /이번 주엔 아직 기록이 없어요/);
  assert.match(out.weekMissing.msg, /전체 랭킹 4위/, '전체 순위를 함께 알려줘야 "사라진 것"과 구분된다');
  assert.equal(out.weekMissing.hasGoBtn, true);

  // ② 전체 탭으로 넘어가 그 줄을 강조
  assert.equal(out.afterGo.mode, 'rankModeAll');
  assert.equal(out.afterGo.hitNick, '로로');

  // ③ 100등 밖으로 접힌 줄도 펼쳐서 데려간다
  assert.equal(out.folded.hitNick, '접힌사람');
  assert.equal(out.folded.hitFolded, false, "'더보기'에 접힌 채로 두면 찾아도 안 보인다");
  assert.match(out.folded.msg, /110위/);

  // ④ 진짜 없으면 없다고 분명히
  assert.equal(out.absent.hitNick, '');
  assert.match(out.absent.msg, /기록이 없어요/);

  // ⑤ 시상대(1~3위)도 목록과 똑같이 찾힌다
  assert.equal(out.podium.hitNick, '제이1');
  assert.equal(out.podium.hitIsPodium, true, '1~3위는 목록이 아니라 시상대에 있어 따로 처리해야 한다');
});
