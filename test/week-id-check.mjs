// ══════════════════════════════════════════════════════════════
//  week-id-check.mjs — 주차(weekId) 계산이 클라·어드민·서버에서 항상 같은지 검사
//
//  왜 필요한가: 주간 랭킹 문서 경로가 weekly_rankings/{weekId}/scores/{닉} 라서,
//  쓰는 쪽(서버)과 읽는 쪽(게임·어드민)이 다른 weekId 를 계산하면 점수가 멀쩡히
//  저장돼 있어도 화면에는 "주간 랭킹에 없음"으로 보인다.
//
//  실제로 그런 상태였다(2026-08-31 발견). 서버는 KST 고정인데 게임·어드민은
//  기기 로컬시간(new Date().getDay())으로 계산해서, 한국이 아닌 기기는 월요일
//  경계 전후로 서버와 다른 주차를 조회했다. 미국 서부 기기는 매주 월요일 새벽
//  0시부터 16시간 동안 지난주 랭킹을 보고 있었다.
//
//  이 검사는 index.html·admin/js/firebase.js 에서 함수 본문을 그대로 잘라내
//  실행하고, 서버 getWeekIdKST() 와 같은 값이 나오는지 여러 시간대·경계에서 비교한다.
//  실행: node test/week-id-check.mjs   (종료코드 1이면 불일치)
// ══════════════════════════════════════════════════════════════
import fs from 'fs';

const GAME = new URL('../index.html', import.meta.url);
const ADMIN = new URL('../admin/js/firebase.js', import.meta.url);

// ── 기준: 서버 functions/index.js 의 getWeekIdKST() 와 동일한 구현 ──
function serverWeekId(nowMs) {
  const kst = new Date(nowMs + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - (day === 0 ? 6 : day - 1));
  const p = (n) => String(n).padStart(2, '0');
  return `${monday.getUTCFullYear()}-${p(monday.getUTCMonth() + 1)}-${p(monday.getUTCDate())}`;
}

// 배포 파일에서 함수 본문을 그대로 잘라온다(복사본이 아니라 실제 코드 실행).
function cut(src, startMark, endMark, label) {
  const s = src.indexOf(startMark);
  if (s < 0) throw new Error(`${label}: '${startMark}' 를 찾지 못했습니다 — 함수 이름이 바뀌었는지 확인하세요.`);
  const e = src.indexOf(endMark, s);
  if (e < 0) throw new Error(`${label}: 끝 표시를 찾지 못했습니다.`);
  return src.slice(s, e + endMark.length);
}

const gameSrc = fs.readFileSync(GAME, 'utf8');
const adminSrc = fs.readFileSync(ADMIN, 'utf8');

const gameCode = cut(gameSrc, 'function kstWeekIdFrom(ms) {', '\nfunction getLastWeekId() {\n  return kstWeekIdFrom(Date.now() - 7 * 24 * 60 * 60 * 1000);\n}', 'index.html');
const adminCode = cut(adminSrc, 'export function getWeekId() {', '\n}', 'admin/js/firebase.js').replace('export function', 'function');

// Date.now() 를 갈아끼워 임의 시각으로 실행할 수 있게 감싼다.
function makeRunner(code, exposed) {
  return (nowMs) => {
    const fn = new Function('__NOW__', `
      const Date = new Proxy(globalThis.Date, { get: (t, k) => (k === 'now' ? () => __NOW__ : t[k]) });
      ${code}
      return { ${exposed} };
    `);
    return fn(nowMs);
  };
}
const runGame = makeRunner(gameCode, 'getWeekId, getLastWeekId');
const runAdmin = makeRunner(adminCode, 'getWeekId');

// ── 검사 1: 여러 시간대의 기기에서 월요일 경계 앞뒤 30시간 ──
// (Date.now() 는 시간대와 무관한 절대시각이므로, 시간대가 달라도 KST 기준 계산이면
//  결과가 같아야 한다. 로컬시간을 쓰던 옛 코드는 여기서 갈라졌다.)
const BOUNDARIES = [
  Date.UTC(2026, 7, 30, 15, 0, 0),  // 2026-08-31(월) 00:00 KST
  Date.UTC(2026, 11, 28, 15, 0, 0), // 2026-12-29 → 연말 경계
  Date.UTC(2027, 0, 3, 15, 0, 0),   // 2027-01-04(월) 00:00 KST — 해 넘김
];
let bad = 0;
let checked = 0;
for (const boundary of BOUNDARIES) {
  for (let h = -30; h <= 30; h++) {
    const t = boundary + h * 3600000;
    const want = serverWeekId(t);
    checked++;
    const g = runGame(t).getWeekId();
    if (g !== want) { console.log(`❌ index.html getWeekId: ${new Date(t).toISOString()} → ${g} (서버 ${want})`); bad++; }
    const a = runAdmin(t).getWeekId();
    if (a !== want) { console.log(`❌ admin getWeekId: ${new Date(t).toISOString()} → ${a} (서버 ${want})`); bad++; }
  }
}

// ── 검사 2: getLastWeekId 는 정확히 한 주 전이어야 한다 ──
for (const boundary of BOUNDARIES) {
  for (const h of [-25, -1, 0, 1, 25]) {
    const t = boundary + h * 3600000;
    const want = serverWeekId(t - 7 * 86400000);
    const got = runGame(t).getLastWeekId();
    checked++;
    if (got !== want) { console.log(`❌ getLastWeekId: ${new Date(t).toISOString()} → ${got} (기대 ${want})`); bad++; }
  }
}

// ── 검사 3: 검사기 자체 검증 — 옛 로컬시간 방식을 이 검사가 실제로 잡아내는지 ──
//  KST(+9) 기기에서는 옛 방식도 서버와 같아서 원래 차이가 없다. 그래서 이 자기검증은
//  현재 TZ 의 실제 오프셋이 +9 가 아닐 때만 의미가 있고, 그때는 경계 앞뒤 어딘가에서
//  반드시 갈라져야 한다(한 시점만 찍으면 KST 동쪽 시간대를 놓친다 — 실제로 놓쳤다).
const legacy = `function getWeekId(){const d=new Date(Date.now());const day=d.getDay();const m=new Date(d);m.setDate(d.getDate()-(day===0?6:day-1));return \`\${m.getFullYear()}-\${String(m.getMonth()+1).padStart(2,'0')}-\${String(m.getDate()).padStart(2,'0')}\`;}`;
const runLegacy = makeRunner(legacy, 'getWeekId');
const probe = BOUNDARIES[0];
const offsetH = -new Date(probe).getTimezoneOffset() / 60;
if (offsetH !== 9) {
  let caught = 0;
  for (let h = -30; h <= 30; h++) {
    const t = probe + h * 3600000;
    if (runLegacy(t).getWeekId() !== serverWeekId(t)) caught++;
  }
  if (caught === 0) { console.log(`❌ 검사기 자체 검증 실패 — 옛 방식(UTC${offsetH >= 0 ? '+' : ''}${offsetH})을 잡아내지 못했습니다`); bad++; }
  else console.log(`   (자기검증: 옛 로컬시간 방식이었다면 이 시간대에서 ${caught}시간 어긋남 — 검사가 잡아냅니다)`);
} else {
  console.log('   (자기검증: 이 기기는 KST 라 옛 방식도 차이가 없음 — 다른 TZ 로도 돌려보세요)');
}

console.log(bad === 0
  ? `✅ 주차 계산 ${checked}건 검사 — 게임·어드민·서버 전부 일치 (TZ=${process.env.TZ || '시스템 기본'})`
  : `⚠️ 불일치 ${bad}건 — 주간 랭킹이 엉뚱한 주차를 조회하게 됩니다`);
process.exit(bad === 0 ? 0 : 1);
