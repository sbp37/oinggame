// ══════════════════════════════════════════════════════════════
//  start-card-fit.test.mjs — 시작 카드 문구가 좁은 폰에서 어절 중간에 끊기지 않는다
//
//  사고(2026-09-05): "메인글자들 넘 커졋잔아."
//   · 카드 폭이 고정(.overlay-card max-width 340px)이라 360~390px 폰에서 안쪽 폭이
//     232~262px 밖에 안 되는데, 부제는 14px 로 약 308px 이 필요했다.
//   · 그래서 "…2분 최고점 / 수 도전!", "게임방법 보 / 기", "처음이라면 튜토리 / 얼"
//     처럼 어절 한가운데서 잘려 두 줄이 됐다(한글은 기본값이 아무 데서나 끊는 break).
//   · 이건 글꼴 교체 때문이 아니다 — build 1788276577 로 재보니 똑같이 두 줄이었다.
//
//  이 테스트가 지키는 약속(360·375·390·412px 전부):
//   ① 부제가 한 줄에 들어간다.
//   ② 보조 링크 두 개('게임방법 보기'·'처음이라면 튜토리얼')가 한 줄에 나란히 있다.
//   ③ 라벨 안에서는 절대 줄바꿈되지 않는다(white-space:nowrap).
//
//  320px(아주 옛날 폰)은 대상이 아니다 — 거기선 링크가 줄 단위로 접히되,
//  word-break:keep-all 덕에 어절 중간에서 끊기지는 않는다.
//
//  실행: node --test test/start-card-fit.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const WIDTHS = [360, 375, 390, 412];

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

async function measureAll() {
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
  const out = {};
  try {
    for (const w of WIDTHS) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
      await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
        const f = r.request().url().split('/').pop();
        r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
      });
      await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick/, (r) => r.abort());
      const p = await ctx.newPage();
      await p.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(2200);
      out[w] = await p.evaluate(() => {
        const linesOf = (el) => {
          const cs = getComputedStyle(el);
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
          return Math.round(el.getBoundingClientRect().height / lh);
        };
        const sub = document.querySelector('.start-overlay-panel .overlay-sub');
        const helpers = document.querySelector('.start-helpers');
        const btns = [...helpers.querySelectorAll('button')];
        return {
          subLines: linesOf(sub),
          // 두 버튼의 세로 위치가 같으면 한 줄에 나란히 있는 것
          sameRow: Math.abs(btns[0].getBoundingClientRect().top - btns[1].getBoundingClientRect().top) < 2,
          nowrap: btns.every((el) => getComputedStyle(el).whiteSpace === 'nowrap'),
          keepAll: getComputedStyle(sub).wordBreak === 'keep-all',
        };
      });
      await ctx.close();
    }
    return out;
  } finally {
    await b.close();
    await new Promise((r) => server.close(r));
  }
}

const measured = await measureAll();

test('① 시작 카드 부제가 좁은 폰에서도 한 줄에 들어간다', () => {
  for (const w of WIDTHS) {
    assert.equal(measured[w].subLines, 1, `${w}px 에서 부제가 ${measured[w].subLines}줄 — 어절 중간에서 잘려 보인다`);
  }
});

test('② 게임방법·튜토리얼 링크가 한 줄에 나란히 있다', () => {
  for (const w of WIDTHS) {
    assert.equal(measured[w].sameRow, true, `${w}px 에서 보조 링크 두 개가 위아래로 갈라졌다`);
  }
});

test('③ 링크 라벨 안에서는 줄바꿈되지 않고, 부제는 어절 단위로만 끊긴다', () => {
  for (const w of WIDTHS) {
    assert.equal(measured[w].nowrap, true, `${w}px: 링크 라벨이 "게임방법 보 / 기" 처럼 끊길 수 있다`);
    assert.equal(measured[w].keepAll, true, `${w}px: 부제에 word-break:keep-all 이 없어 어절 중간에서 끊긴다`);
  }
});
