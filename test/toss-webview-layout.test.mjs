// ══════════════════════════════════════════════════════════════
//  toss-webview-layout.test.mjs — 토스(앱인토스) 웹뷰에서 상단이 가려지지 않는다
//
//  사고(2026-09-16, 실기 화면): "상단이 메뉴바에 가려져서 게임·랭킹·꾸미기 클릭이 안 됨.
//  다시하기 버튼이랑 ⋯ 설정 위치가 겹친다."
//   · 토스 웹뷰는 페이지 위쪽에 자기 상단 바(⋯ · ✕)를 겹쳐 그리는데,
//     env(safe-area-inset-top) 은 0 으로 와서 우리 탭바(높이 47px)가 통째로 그 아래 깔렸다.
//   · 게다가 시작 화면은 화면 전체를 덮는 불투명 오버레이라, 탭바는 원래도 "안 보이고
//     클릭만 통과되는" 상태였다. 웹에선 버텼지만 토스에선 그 통과 구역마저 가려져
//     아예 누를 수가 없었다.
//   · 게임 화면의 🔄 다시하기는 오른쪽 맨 끝이라 ⋯ 버튼과 정확히 겹쳤다.
//
//  이 테스트가 지키는 약속:
//   ① ?platform=toss 로 열면 html.is-toss 가 붙고, 탭바가 상단 위험구역(≥50px) 아래로 내려온다.
//   ② 탭 버튼과 🍮 꾸미기가 "보이고"(시작 오버레이에 안 가리고) "눌린다"(elementFromPoint).
//   ③ 🔄 다시하기가 오른쪽 위 구석(위 50px × 오른쪽 130px)에 들어가지 않는다.
//   ④ 아이폰·갤럭시 여러 크기에서 가로 넘침이 없고, 게임판이 하단 바를 밟지 않는다.
//   ⑤ 웹(토스 아님)은 한 군데도 안 바뀐다 — 탭바 패딩도 다시하기 위치도 예전 그대로.
//
//  위험구역 수치(50px·130px)는 실기 스크린샷에서 잰 토스 상단 바 크기다.
//  상단 여백은 주소의 ?topinset=NN 으로 조절할 수 있게 돼 있다(기본 56px).
//
//  실행: node --test test/toss-webview-layout.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
// 토스 상단 바가 덮는 구역 — 실기 스크린샷 기준(세로 50px, 오른쪽 130px)
const DANGER_H = 50;
const DANGER_W = 130;

const STUBS = {
  'firebase-app.js': `export const initializeApp=()=>({name:'[DEFAULT]'});export const getApp=()=>({});export const getApps=()=>[];`,
  'firebase-auth.js': `const u={uid:'u1'};export const getAuth=()=>({currentUser:u});export const signInAnonymously=async()=>({user:u});export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(u),5);return()=>{}};export const signOut=async()=>{};export const signInWithCustomToken=async()=>({user:u});`,
  'firebase-functions.js': `export const getFunctions=()=>({});export const httpsCallable=()=>async()=>({data:{}});`,
  'firebase-analytics.js': `export const getAnalytics=()=>({});export const logEvent=()=>{};export const isSupported=async()=>false;`,
  'firebase-firestore.js': `export const getFirestore=()=>({});export const collection=(d,...p)=>({__path:p.join('/')});export const doc=(d,...p)=>({id:p[p.length-1]||'x',__path:p.join('/')});export const query=(c)=>({...c});export const orderBy=()=>({});export const limit=()=>({});export const where=()=>({});export const getDocs=async()=>({docs:[],size:0,empty:true,forEach(){}});export const getDoc=async(r)=>({id:r.id,exists:()=>false,data:()=>({})});export const setDoc=async()=>{};export const updateDoc=async()=>{};export const deleteDoc=async()=>{};export const addDoc=async()=>({id:'x'});export const writeBatch=()=>({set(){},update(){},delete(){},commit:async()=>{}});export const runTransaction=async(d,fn)=>fn({get:async()=>({exists:()=>false,data:()=>({})}),set(){},update(){},delete(){}});export const serverTimestamp=()=>Date.now();export const increment=(n)=>n;export const arrayUnion=(...a)=>a;export const arrayRemove=(...a)=>a;export const onSnapshot=()=>()=>{};export const documentId=()=>'__name__';export const startAfter=()=>({});export const Timestamp={now:()=>({toMillis:()=>Date.now()}),fromMillis:(m)=>({toMillis:()=>m})};`,
};

// 실제 index.html 을 띄워 화면을 재고, 필요한 수치만 돌려준다.
async function measure(browser, port, { width, height, toss, rnWebView }) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  try {
    await ctx.route('https://www.gstatic.com/firebasejs/**', (r) => {
      const f = r.request().url().split('/').pop();
      r.fulfill({ status: 200, contentType: 'text/javascript', body: STUBS[f] || 'export default {};' });
    });
    await ctx.route(/googletagmanager|google-analytics|adsbygoogle|pagead|kakao|doubleclick|fonts\.g/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.addInitScript(() => { try { localStorage.setItem('oeing_nickname_v1', '오잉이'); } catch (e) {} });
    // 앱인토스 미니앱은 React Native 웹뷰 안에서 돈다 — 주소에 아무것도 안 붙여도 잡히는지 본다
    if (rnWebView) await p.addInitScript(() => { window.ReactNativeWebView = { postMessage() {} }; });
    await p.goto(`http://127.0.0.1:${port}/index.html${toss ? '?platform=toss' : ''}`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1600);
    const start = await p.evaluate(({ DANGER_H, DANGER_W }) => {
      const inDanger = (el) => {
        const r = el.getBoundingClientRect();
        return r.top < DANGER_H && r.right > innerWidth - DANGER_W;
      };
      // 화면에 진짜 보이는지 — 그 자리의 최상단 요소가 자기 자신(또는 자기 자식)인지로 본다.
      const isOnTop = (el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
      };
      const tabs = [...document.querySelectorAll('.tab-bar .tab-btn')];
      const jelly = document.getElementById('supportTopBtn');
      jelly.style.display = 'inline-flex'; // 젤리샵이 열린 상태를 흉내 — 자리만 확인한다
      const all = [...tabs, jelly];
      const contact = document.getElementById('contactBtnGame');
      // 후원 화면은 옛 꾸미기 주문 경로가 display:flex 로 직접 연다 —
      // 그 상황을 흉내 내서, 그래도 안 열리는지 본다(확인 뒤 되돌린다).
      const donate = document.getElementById('donateOverlay');
      const donateBefore = donate.style.display;
      donate.style.display = 'flex';
      const donateShown = getComputedStyle(donate).display !== 'none';
      donate.style.display = donateBefore;
      return {
        isToss: document.documentElement.classList.contains('is-toss'),
        donateShown,
        contactShown: getComputedStyle(contact).display !== 'none',
        contactDotShown: getComputedStyle(document.getElementById('updContactDot')).display !== 'none',
        tabBarPadTop: Math.round(parseFloat(getComputedStyle(document.querySelector('.tab-bar')).paddingTop)),
        tabTop: Math.round(Math.min(...all.map((e) => e.getBoundingClientRect().top))),
        tabsInDanger: all.filter(inDanger).map((e) => e.textContent.trim().slice(0, 8)),
        tabsHidden: all.filter((e) => !isOnTop(e)).map((e) => e.textContent.trim().slice(0, 8)),
        hOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    }, { DANGER_H, DANGER_W });

    await p.evaluate(() => { const b = document.getElementById('startBtn'); if (b) b.click(); });
    await p.waitForTimeout(2600);
    const game = await p.evaluate(({ DANGER_H, DANGER_W }) => {
      const rb = document.getElementById('bottomRestartBtn');
      const r = rb.getBoundingClientRect();
      const grid = document.getElementById('grid');
      const bar = document.querySelector('.bottom-bar');
      const gr = grid.getBoundingClientRect();
      const br = bar.getBoundingClientRect();
      const cell = grid.querySelector('.cell');
      return {
        restartInDanger: r.top < DANGER_H && r.right > innerWidth - DANGER_W,
        restartFromRight: Math.round(innerWidth - r.right),
        gridOverBar: Math.round(gr.bottom - br.top), // 음수여야 안 겹친다
        gridBelowScreen: Math.round(gr.bottom - innerHeight),
        cellPx: cell ? Math.round(cell.getBoundingClientRect().width * 10) / 10 : 0,
        hOverflow: document.documentElement.scrollWidth - innerWidth,
      };
    }, { DANGER_H, DANGER_W });
    return { ...start, game };
  } finally {
    await ctx.close();
  }
}

test('토스 웹뷰 — 상단 탭바·다시하기가 토스 상단 바에 가리지 않는다', async (t) => {
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
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    // 가장 작은 폰 · 가장 큰 폰 · 갤럭시 좁은 화면 — 셋이면 잘림은 다 드러난다
    const DEVICES = [
      ['아이폰 SE', 375, 667],
      ['아이폰 15 Pro Max', 430, 932],
      ['갤럭시 좁은 화면', 344, 882],
    ];
    const web = {};
    for (const [name, width, height] of DEVICES) {
      await t.test(`${name} (${width}×${height})`, async () => {
        const m = await measure(browser, port, { width, height, toss: true });
        assert.equal(m.isToss, true, '?platform=toss 인데 토스로 인식하지 못했다');
        // ① 탭바가 토스 상단 바 아래로 내려왔다
        assert.ok(m.tabTop >= DANGER_H, `탭 버튼 맨 위가 ${m.tabTop}px — 토스 상단 바(${DANGER_H}px)에 깔린다`);
        assert.ok(m.tabBarPadTop >= DANGER_H, `탭바 위 여백이 ${m.tabBarPadTop}px 뿐이다`);
        // ② 위험구역에 걸친 탭이 없고, 시작 화면에서도 가려지지 않는다
        assert.deepEqual(m.tabsInDanger, [], `토스 상단 바에 걸치는 탭: ${m.tabsInDanger.join(', ')}`);
        assert.deepEqual(m.tabsHidden, [], `시작 화면 오버레이에 가려 안 보이는 탭: ${m.tabsHidden.join(', ')}`);
        // ③ 다시하기가 오른쪽 위 구석을 비웠다
        assert.equal(m.game.restartInDanger, false, '🔄 다시하기가 ⋯ 버튼 자리에 겹친다');
        assert.ok(m.game.restartFromRight > 30, `다시하기가 오른쪽 끝에서 ${m.game.restartFromRight}px — 너무 붙었다`);
        // ④ 잘림·넘침 없음
        assert.equal(m.hOverflow, 0, '시작 화면이 가로로 넘친다');
        assert.equal(m.game.hOverflow, 0, '게임 화면이 가로로 넘친다');
        assert.ok(m.game.gridOverBar <= 0, `게임판이 하단 바를 ${m.game.gridOverBar}px 밟는다`);
        assert.ok(m.game.gridBelowScreen <= 0, `게임판이 화면 아래로 ${m.game.gridBelowScreen}px 잘린다`);
        // ⑥ 토스는 미니앱 밖 링크를 막는다 — 카카오로 나가는 문의하기는 안 보인다
        assert.equal(m.contactShown, false, '토스인데 문의하기가 그대로 보인다');
        assert.equal(m.contactDotShown, false, '문의하기를 지웠는데 앞의 가운뎃점이 혼자 남았다');
        assert.equal(m.donateShown, false, '토스인데 후원 화면(카카오페이 QR)이 열린다');
        web[name] = m;
      });
    }

    await t.test('⑤ 웹(토스 아님)은 예전 그대로다 — 탭바도 다시하기도 안 움직인다', async () => {
      for (const [name, width, height] of DEVICES) {
        const m = await measure(browser, port, { width, height, toss: false });
        assert.equal(m.isToss, false, `${name}: 웹인데 토스로 인식했다`);
        assert.equal(m.tabBarPadTop, 0, `${name}: 웹 탭바에 토스용 여백(${m.tabBarPadTop}px)이 붙었다`);
        assert.equal(m.contactShown, true, `${name}: 웹에서 문의하기가 사라졌다`);
        assert.equal(m.donateShown, true, `${name}: 웹에서 후원 화면까지 막혔다 — 토스 규칙이 새어 나왔다`);
        assert.ok(m.game.restartFromRight < 30, `${name}: 웹 다시하기가 ${m.game.restartFromRight}px 로 밀렸다 — 토스 규칙이 새어 나왔다`);
        // 칸 크기는 토스에서도 같아야 한다 — 위를 56px 뺏겨도 판이 쪼그라들지 않는다
        assert.equal(m.game.cellPx, web[name].game.cellPx, `${name}: 토스에서 게임판 칸이 ${web[name].game.cellPx}px 로 달라졌다(웹 ${m.game.cellPx}px)`);
      }
    });

    await t.test('⑦ 주소에 아무것도 안 붙여도 — React Native 웹뷰면 토스로 본다', async () => {
      const m = await measure(browser, port, { width: 393, height: 852, toss: false, rnWebView: true });
      assert.equal(m.isToss, true, '앱인토스(RN 웹뷰)인데 못 알아봤다 — 주소에 ?platform=toss 를 붙여야만 동작한다');
      assert.ok(m.tabTop >= DANGER_H, `탭 버튼 맨 위가 ${m.tabTop}px — 자동 인식됐는데 여백이 안 붙었다`);
      assert.equal(m.contactShown, false, '자동 인식인데 문의하기가 남아 있다');
    });
  } finally {
    await browser.close();
    server.close();
  }
});

test('토스 판별과 여백 조절이 코드에 남아 있다', () => {
  const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  // 첫 페인트 전에 붙어야 화면이 덜컹거리지 않는다 — <head> 의 일반 script 여야 한다
  const headEnd = src.indexOf('</head>');
  const mark = src.indexOf("classList.add('is-toss')");
  assert.ok(mark > 0 && mark < headEnd, '토스 판별이 <head> 안에 없다 — 첫 화면이 한 번 잘못 그려진다');
  assert.match(src, /platform'\) === 'toss'/, '?platform=toss 로 켜는 길이 없다');
  assert.match(src, /oeing_platform_toss_v1/, '한 번 토스로 열린 걸 기억하지 않는다 — 상점 페이지로 가면 풀린다');
  assert.match(src, /q\.get\('topinset'\)/, '상단 여백을 주소로 조절할 수 없다');
  assert.match(src, /window\.ReactNativeWebView && !window\.Capacitor/, '앱인토스(RN 웹뷰) 자동 인식이 빠졌다');
  // 모듈 쪽에서도 토스를 알아야 후원 열기를 막을 수 있다
  assert.match(src, /const IS_TOSS = !!window\.IS_TOSS;/, '모듈 스크립트에 IS_TOSS 가 없다');
  assert.match(src, /if \(IS_APP \|\| IS_TOSS\) return; \/\/ 앱·토스/, 'openDonateOverlay 가 토스에서 안 막힌다');
  assert.match(
    src,
    /html\.is-toss \.tab-bar \{\s*padding-top: max\(env\(safe-area-inset-top, 0px\), var\(--toss-top\)\);/,
    '탭바 상단 여백 규칙이 없다(토스가 safe-area 를 주기 시작해도 두 번 밀리면 안 된다)',
  );
  // 토스 규칙은 전부 html.is-toss 안에 묶여 있어야 웹·앱이 안 바뀐다.
  // --toss- 를 쓰는 CSS 규칙을 통째로 집어 선택자를 확인한다.
  const rules = [...src.matchAll(/([^{}\n;]+)\{([^{}]*--toss-[^{}]*)\}/g)];
  assert.ok(rules.length >= 2, '토스용 CSS 규칙을 찾지 못했다');
  for (const [, sel] of rules) {
    assert.match(sel.trim(), /html\.is-toss/, `토스 전용이 아닌 선택자가 --toss- 를 쓴다: ${sel.trim().slice(0, 70)}`);
  }
});
