// ══════════════════════════════════════════════════════════════
//  funnel.js — 상점 깔때기 계산. 순수 함수만 — Firebase 의존 없음.
//
//  왜 (2026-09-05): 젤리샵은 '입구 클릭 수'만 남아 "안 본 건지 · 보고 싫었던 건지 · 사려다
//  포기한 건지"를 구분할 수 없었다. 상점 페이지가 단계별로 shop_funnel 문서를 남기고
//  (한 세션에 단계당 1건), 여기서 단계별 '도달한 사람 수'와 이탈 지점을 만든다.
//
//  문서: { step, tab?, ts, date, platform: 'web'|'app', sid }
//   젤리 흐름: entry(🍮 입구 클릭) → enter(상점 페이지) → tab → preview → buy_click → buy_done
//   현금 흐름: custom_link → cash_enter → cash_pay_click → cash_done(앱 Play 결제만 — 웹 카카오페이는 완료 신호가 없다)
// ══════════════════════════════════════════════════════════════

export const JELLY_STEPS = [
  ['entry', '🍮 입구 클릭'],
  ['enter', '상점 진입'],
  ['tab', '상품 탭 열기'],
  ['preview', '미리보기'],
  ['buy_click', '구매 버튼'],
  ['buy_done', '구매 완료'],
];
export const CASH_STEPS = [
  ['custom_link', '현금 상점 링크'],
  ['cash_enter', '현금 상점 진입'],
  ['cash_pay_click', '결제 버튼'],
  ['cash_done', '결제 완료(앱)'],
];

function pct(n, d) { return d > 0 ? Math.round(n / d * 100) : null; }

// rows: shop_funnel 문서 배열. 반환: 단계별 unique 세션 수 + 비율, 플랫폼별, 탭별.
export function computeFunnel(rows) {
  const reached = new Map();        // step -> Set(sid)
  const byPlatform = { web: new Map(), app: new Map() };
  const tabs = new Map();           // tab -> Set(sid)
  const sessions = new Set();
  for (const r of rows || []) {
    if (!r || typeof r.step !== 'string') continue;
    const sid = typeof r.sid === 'string' && r.sid ? r.sid : ('doc:' + (r.id || Math.random()));
    sessions.add(sid);
    if (!reached.has(r.step)) reached.set(r.step, new Set());
    reached.get(r.step).add(sid);
    const plat = r.platform === 'app' ? 'app' : 'web';
    if (!byPlatform[plat].has(r.step)) byPlatform[plat].set(r.step, new Set());
    byPlatform[plat].get(r.step).add(sid);
    if (r.step === 'tab' && typeof r.tab === 'string' && r.tab) {
      if (!tabs.has(r.tab)) tabs.set(r.tab, new Set());
      tabs.get(r.tab).add(sid);
    }
  }
  const count = (map, step) => (map.get(step) ? map.get(step).size : 0);
  const build = (steps, baseStep) => {
    const base = count(reached, baseStep);
    let prev = null;
    return steps.map(([step, label]) => {
      const n = count(reached, step);
      const row = {
        step, label, n,
        web: count(byPlatform.web, step), app: count(byPlatform.app, step),
        ofBase: pct(n, base),                       // 기준 단계 대비
        ofPrev: prev == null ? null : pct(n, prev), // 직전 단계 대비 (여기서 얼마나 빠졌나)
      };
      prev = n;
      return row;
    });
  };
  const jelly = build(JELLY_STEPS, 'enter');
  const cash = build(CASH_STEPS, 'custom_link');
  // 가장 많이 빠진 구간 — 직전 대비 비율이 가장 낮은 단계(기준 단계 제외, 표본 5명 이상일 때만)
  let worst = null;
  for (const row of jelly.slice(1)) {
    if (row.ofPrev == null) continue;
    const prevRow = jelly[jelly.indexOf(row) - 1];
    if (prevRow.n < 5) continue;
    if (!worst || row.ofPrev < worst.ofPrev) worst = { from: prevRow.label, to: row.label, ofPrev: row.ofPrev, lost: prevRow.n - row.n };
  }
  return {
    sessions: sessions.size,
    jelly, cash,
    tabs: [...tabs.entries()].map(([tab, set]) => ({ tab, n: set.size })).sort((a, b) => b.n - a.n),
    worst,
  };
}

// 최근 n일 날짜 문자열(YYYY-MM-DD, 로컬) — 클라이언트 로그의 date 와 같은 기준.
export function lastDates(n, now = new Date()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const pad = (x) => String(x).padStart(2, '0');
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }
  return out;
}
