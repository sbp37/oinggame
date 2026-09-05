// ══════════════════════════════════════════════════════════════
//  analytics.js — 분석 탭
//
//  · 이 탭은 관리자가 "분석" 탭을 직접 클릭했을 때만 조회된다.
//  · 14일 그래프: dailyStats 캐시(stats.js) — 지난 날짜는 날짜당 문서 1개,
//    최초 1회만 원본에서 백필. 오늘만 라이브 계산.
//  · 유입경로/추천인: user_stats 최대 500명 1회 fetch → 세 가지 분석에 재사용.
//    비용이 커서 버튼을 눌렀을 때만 조회.
//  · 차트는 외부 라이브러리 없이 CSS 막대로 렌더링.
// ══════════════════════════════════════════════════════════════
import {
  db, collection, query, orderBy, limit, where,
  fetchDocs, fmtNum, fmtDuration, escapeHtml, cache, humanError,
} from './firebase.js';
import { computeFunnel, lastDates } from './funnel.js';
import {
  getDailyStatsRange, computeWeeklyMetrics, dailyStatsWriteState,
  countTodayCached, todayNewUsersCount, forceRecomputeRange, SESSION_FETCH_CAP,
} from './stats.js';
import { setLoading, setError, guardBtn } from './admin.js';
import { computeRetention } from './retention.js';

const DAYS = 14;
const REFERRER_FETCH_CAP = 500;
// 재방문 코호트 — 최신 신규순 user_stats. 활동순(유입 분석)과 달리 '떠난 사람'도 들어와야
// 재방문율이 정직해진다. 6주 코호트 × 주당 신규가 100명을 넘지 않는 규모라 1000 이면 충분.
const RETENTION_FETCH_CAP = 1000;
const RETENTION_WEEKS = 6;

// 14일 막대 — 데이터 14개는 그대로, 모바일 가독성을 위해
// 날짜 라벨은 오늘 기준 3일 간격만 표시하고, 모바일에서는 값 숫자를
// "최고값·오늘"만 남긴다 (나머지는 터치/hover 툴팁으로 확인 — CSS 처리)
function barChart(el, data, { valueKey, todayIdx = data.length - 1, unit = '' }) {
  const vals = data.map(d => d[valueKey] ?? 0);
  const max = Math.max(1, ...vals);
  const peakIdx = vals.indexOf(Math.max(...vals));
  el.classList.add('day');
  el.innerHTML = data.map((d, i) => {
    const v = vals[i];
    const h = Math.round(v / max * 100);
    const showLabel = (data.length - 1 - i) % 3 === 0; // 오늘부터 3일 간격
    const label = showLabel ? (d.date || '').slice(5).replace('-', '/') : '';
    const cls = `bar-wrap${i === todayIdx ? ' is-today' : ''}${i === peakIdx ? ' is-peak' : ''}`;
    return `
      <div class="${cls}" title="${d.date}: ${fmtNum(v)}${unit}">
        <div class="bar-val">${v > 0 ? fmtNum(v) : ''}</div>
        <div class="bar ${i === todayIdx ? 'today' : ''}" style="height:${h}%"></div>
        <div class="bar-label">${label}</div>
      </div>`;
  }).join('');
}

// 시간대별 — 0이 아닌 시간대는 막대 위에 값을 전부 표시(요청). 24칸이라 글씨는
// CSS(.chart.hour .bar-val)에서 최소 크기로. 캡션의 "가장 활발한 시간대" 요약은 유지.
function hourChart(el, hours) {
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  el.classList.add('hour');
  el.innerHTML = hours.map((v, h) => `
    <div class="bar-wrap" title="${h}시: ${fmtNum(v)}회">
      <div class="bar-val">${v > 0 ? fmtNum(v) : ''}</div>
      <div class="bar ${h === peak ? 'today' : ''}" style="height:${Math.round(v / max * 100)}%"></div>
      <div class="bar-label">${h % 3 === 0 ? h + '시' : ''}</div>
    </div>`).join('');
  const prevNote = el.parentElement && el.parentElement.querySelector('.hour-note');
  if (prevNote) prevNote.remove(); // 새로고침 시 캡션 중복 방지
  el.insertAdjacentHTML('afterend',
    `<div class="chart-note hour-note">가장 활발한 시간대: <b>${peak}시</b> (${fmtNum(hours[peak])}회) · 막대를 누르면 값이 표시돼요</div>`);
}

export async function loadAnalytics({ force = false } = {}) {
  const chartEls = ['chartVisitors', 'chartNewUsers', 'chartPlays', 'chartHourly']
    .map(id => document.getElementById(id));
  chartEls.forEach(el => setLoading(el, '집계 중... (처음엔 지난 날짜 백필로 시간이 걸릴 수 있어요)'));
  const weeklyEl = document.getElementById('analyticsWeekly');
  weeklyEl.innerHTML = '';

  try {
    if (force) cache.bust('shared:dailyStats'); // 강제 새로고침이어도 확정(final) 날짜는 로컬/서버 캐시로 재구성됨
    const daily = await getDailyStatsRange(DAYS, { force });

    // 오늘 항목에 신규 유저/클릭 수 주입 — 홈 타일과 "완전히 같은" 캐시된 count 값을 사용.
    // (오늘 세션 집계에는 이 필드들이 없어서, 주입하지 않으면 그래프 오늘 막대와
    //  주간 합계가 0으로 어긋난다 — 홈 11명 vs 그래프 0명 불일치의 원인이었음)
    const todayEntry = daily[daily.length - 1];
    const [tNew, tShare] = await Promise.all([
      todayNewUsersCount().catch(() => null),
      countTodayCached('share_clicks').catch(() => null),
    ]);
    todayEntry.newUsers = tNew;
    todayEntry.shareClicks = tShare;

    barChart(chartEls[0], daily, { valueKey: 'uniqueVisitors', unit: '명' });
    barChart(chartEls[1], daily, { valueKey: 'newUsers', unit: '명' });
    barChart(chartEls[2], daily, { valueKey: 'gamePlays', unit: '판' });

    // 카드 제목 옆 한 줄 요약: 14일 합계 · 일평균 (계산 로직 변경 없음 — 이미 있는 값 합산)
    const summarize = (elId, key, unit) => {
      const total = daily.reduce((s, d) => s + ((d && d[key]) || 0), 0);
      const avg = (total / daily.length).toFixed(1).replace(/\.0$/, '');
      const el = document.getElementById(elId);
      if (el) el.textContent = `14일 합계 ${fmtNum(total)}${unit} · 일평균 ${avg}${unit}`;
    };
    summarize('sumVisitors', 'uniqueVisitors', '명');
    summarize('sumNewUsers', 'newUsers', '명');
    summarize('sumPlays', 'gamePlays', '판');

    // 시간대별 세션 — 14일치 dailyStats의 sessionsByHour 합산 (추가 조회 0)
    const hours = new Array(24).fill(0);
    for (const d of daily) (d.sessionsByHour || []).forEach((v, h) => { hours[h] += v; });
    hourChart(chartEls[3], hours);

    // 주간 지표 + 성장 추이
    const wk = computeWeeklyMetrics(daily);
    const last7 = daily.slice(-7), prev7 = daily.slice(0, 7);
    const sum = (arr, k) => arr.reduce((s, d) => s + (d[k] ?? 0), 0);
    const growth = (cur, prev) => prev > 0 ? `${cur >= prev ? '+' : ''}${Math.round((cur - prev) / prev * 100)}%` : '-';
    const tiles = [
      ['WAU (7일 고유 방문자)', `${fmtNum(wk.wau)}명`],
      ['오늘 재방문율', `${wk.returnRate}%`],
      ['주간 방문 (전주 대비)', `${fmtNum(sum(last7, 'uniqueVisitors'))} (${growth(sum(last7, 'uniqueVisitors'), sum(prev7, 'uniqueVisitors'))})`],
      ['주간 플레이 (전주 대비)', `${fmtNum(sum(last7, 'gamePlays'))} (${growth(sum(last7, 'gamePlays'), sum(prev7, 'gamePlays'))})`],
      ['주간 신규 유저', `${fmtNum(sum(last7, 'newUsers'))}명`],
      ['주간 평균 체류', fmtDuration(Math.round(sum(last7, 'avgDurationSec') / Math.max(1, last7.length)))],
      ['주간 공유 클릭', `${fmtNum(sum(last7, 'shareClicks'))}회`],
    ];
    weeklyEl.innerHTML = tiles.map(([label, val]) => `
      <div class="stat-tile">
        <div class="stat-label">${label}</div>
        <div class="stat-value" style="font-size:16px;">${val}</div>
      </div>`).join('');

    // 운영자에게 알려야 할 상태 안내 (조용한 잘림/캐시 미공유 방지)
    const notices = [];
    if (daily.some(d => d && d.truncated)) {
      notices.push(`⚠️ 세션이 하루 ${SESSION_FETCH_CAP}건을 넘은 날이 있어 해당 날짜는 근사치입니다.`);
    }
    if (dailyStatsWriteState.blocked) {
      notices.push('⚠️ dailyStats 저장이 보안 규칙에 막혀 이 기기(localStorage)에만 캐시됩니다. '
        + '다른 기기/브라우저에서는 백필이 반복되니, 규칙에 dailyStats 쓰기 허용을 추가하는 것을 권장합니다 (README 참고).');
    }
    document.getElementById('analyticsNotice').innerHTML = notices.join('<br>');
  } catch (e) {
    chartEls.forEach(el => setError(el, humanError(e)));
  }
}

// ── 유입경로 / 추천인 / 친구초대 — 버튼 클릭 시에만 조회 ──
async function loadReferrerData({ force = false } = {}) {
  const el = document.getElementById('referrerResult');
  setLoading(el, `user_stats 최대 ${REFERRER_FETCH_CAP}명 조회 중...`);
  try {
    if (force) cache.bust('analytics:referrer');
    // 한 번의 fetch 결과를 유입경로/추천인랭킹/친구초대 세 분석에 모두 재사용
    const rows = await cache.get('analytics:referrer', () =>
      fetchDocs(query(collection(db, 'user_stats'), orderBy('lastPlayed', 'desc'), limit(REFERRER_FETCH_CAP))));

    const bySrc = new Map();
    const byRef = new Map();
    const invited = [];
    for (const r of rows) {
      const src = r.referrerSrc || '알수없음';
      bySrc.set(src, (bySrc.get(src) || 0) + 1);
      if (r.refBy) {
        byRef.set(r.refBy, (byRef.get(r.refBy) || 0) + 1);
        invited.push(r);
      }
    }
    const srcRows = [...bySrc.entries()].sort((a, b) => b[1] - a[1]);
    const refRows = [...byRef.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    const capNote = rows.length >= REFERRER_FETCH_CAP
      ? `<div class="card-note">⚠️ 최근 활동 ${REFERRER_FETCH_CAP}명까지만 집계했어요 (전체 아님)</div>` : '';

    el.innerHTML = `
      ${capNote}
      <h4 style="margin:10px 0 6px; font-size:13.5px;">🧭 유입경로 (${fmtNum(rows.length)}명 기준)</h4>
      <div class="list">${srcRows.map(([src, n]) => `
        <div class="list-row"><span class="main">${escapeHtml(src)}</span>
          <span class="sub">${fmtNum(n)}명 (${Math.round(n / rows.length * 100)}%)</span></div>`).join('')}
      </div>
      <h4 style="margin:14px 0 6px; font-size:13.5px;">🏅 추천인 랭킹 (초대 많은 순)</h4>
      <div class="list">${refRows.length ? refRows.map(([nick, n], i) => `
        <div class="list-row"><span class="main">${i < 3 ? ['🥇', '🥈', '🥉'][i] : (i + 1) + '.'} <span class="nick">${escapeHtml(nick)}</span></span>
          <span class="sub">${fmtNum(n)}명 초대</span></div>`).join('')
        : '<div class="list-empty">추천인 기록이 없어요</div>'}
      </div>
      <h4 style="margin:14px 0 6px; font-size:13.5px;">🤝 친구초대로 들어온 유저 (${fmtNum(invited.length)}명)</h4>
      <div class="list">${invited.slice(0, 30).map(r => `
        <div class="list-row"><span class="main"><span class="nick">${escapeHtml(r.nickname || r.id)}</span></span>
          <span class="sub">추천인: ${escapeHtml(r.refBy)}</span></div>`).join('') || '<div class="list-empty">없음</div>'}
      </div>`;
  } catch (e) {
    setError(el, humanError(e));
  }
}

// ── 🔁 신규 유저 재방문 (주간 코호트) — 버튼 클릭 시에만 조회 ──
//  "왜 다시 안 오는지"를 숫자로. 계산은 retention.js(순수 함수, 테스트 있음).
//  · 신규순(firstPlayed desc)으로 읽는다 — 활동순으로 읽으면 떠난 사람이 빠져 재방문율이 부풀려진다.
//  · D1/D7 은 playDates 를 기록하기 시작한(2026-09-05 빌드) 이후 신규만 잴 수 있다. 그 전은 '—'.
async function loadRetentionData({ force = false } = {}) {
  const el = document.getElementById('retentionResult');
  setLoading(el, `user_stats 최신 신규 ${RETENTION_FETCH_CAP}명 조회 중...`);
  try {
    if (force) cache.bust('analytics:retention');
    const rows = await cache.get('analytics:retention', () =>
      fetchDocs(query(collection(db, 'user_stats'), orderBy('firstPlayed', 'desc'), limit(RETENTION_FETCH_CAP))));
    const r = computeRetention(rows, Date.now(), { weeks: RETENTION_WEEKS });

    const p = (v) => (v == null ? '—' : `${v}%`);
    const frac = (n, d) => (d > 0 ? `${fmtNum(n)}/${fmtNum(d)}` : '—');
    const f = r.last28;
    const tiles = [
      ['최근 28일 신규', `${fmtNum(f.n)}명`, `초대로 ${fmtNum(f.invited)}명`],
      ['2판 이상 함', p(f.multiPct), frac(f.multi, f.n)],
      ['다른 날 다시 옴', p(f.returnedPct), frac(f.returned, f.n)],
      ['최근 7일 활동', p(f.active7Pct), `${frac(f.active7, f.active7Denom)} · 가입 7일↑만`],
      ['다음날 재방문 D1', p(f.d1Pct), f.d1Tracked ? `${frac(f.d1, f.d1Tracked)} · 추적 가능한 신규만` : '아직 데이터 없음'],
      ['7일 안 재방문 D7', p(f.d7Pct), f.d7Tracked ? `${frac(f.d7, f.d7Tracked)} · 추적 가능한 신규만` : '아직 데이터 없음'],
      ['초대 유입 재방문', p(f.invitedReturnedPct), frac(f.invitedReturned, f.invited)],
      ['그 외 유입 재방문', p(f.otherReturnedPct), frac(f.otherReturned, f.n - f.invited)],
    ];

    const rowsHtml = r.cohorts.map((c, i) => `
      <tr>
        <td>${escapeHtml(c.weekId.slice(5).replace('-', '/'))}${i === 0 ? ' <span class="card-note">(이번주)</span>' : ''}</td>
        <td>${fmtNum(c.n)}</td>
        <td>${p(c.multiPct)}</td>
        <td>${p(c.returnedPct)}</td>
        <td title="가입 7일 넘은 ${fmtNum(c.active7Denom)}명 기준">${c.active7Denom ? p(c.active7Pct) : '—'}</td>
        <td title="추적 ${fmtNum(c.d1Tracked)}명">${p(c.d1Pct)}</td>
        <td title="추적 ${fmtNum(c.d7Tracked)}명">${p(c.d7Pct)}</td>
        <td>${fmtNum(c.invited)}</td>
      </tr>`).join('');

    const capNote = rows.length >= RETENTION_FETCH_CAP
      ? `<div class="card-note">⚠️ 최신 신규 ${RETENTION_FETCH_CAP}명까지만 집계했어요 — 오래된 코호트는 일부만 들어갔을 수 있어요.</div>` : '';

    el.innerHTML = `
      ${capNote}
      <div class="stat-grid small" style="margin-bottom:12px;">${tiles.map(([label, val, sub]) => `
        <div class="stat-tile compact">
          <div class="stat-label">${label}</div>
          <div class="stat-value" style="font-size:17px;">${val}</div>
          <div class="stat-sub">${sub}</div>
        </div>`).join('')}
      </div>
      <h4 style="margin:10px 0 6px; font-size:13.5px;">주간 코호트 (첫 플레이한 주 기준 · 월요일 시작 KST)</h4>
      <div class="cohort-wrap">
        <table class="mini-table cohort-table">
          <thead><tr>
            <th>주</th><th>신규</th><th>2판+</th><th>다른날<br>재방문</th><th>최근7일<br>활동</th><th>D1</th><th>D7</th><th>초대</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      <div class="card-note" style="margin-top:8px; line-height:1.55;">
        <b>다른날 재방문</b>: 첫날 말고 다른 날에도 한 판 이상 (daysPlayed≥2). 기간 제한 없음.<br>
        <b>최근7일 활동</b>: 가입 7일 넘은 사람 중 최근 7일 안에 논 비율 — '아직 남아 있는' 비율.<br>
        <b>D1 / D7</b>: 다음날 / 7일 안에 다시 온 정확한 비율. 2026-09-05 이후 신규만 추적 가능(playDates). 그 전 유저는 —.<br>
        <b>초대</b>: 친구초대 코드로 들어온 사람 수. 타일의 '초대 유입 vs 그 외' 재방문을 비교하세요.<br>
        첫 판 완주율은 여기 없어요 — user_stats 는 첫 판을 끝낸 뒤에야 생겨요. (활동 카드의 '시작률'을 보세요.)
      </div>`;
  } catch (e) {
    setError(el, humanError(e));
  }
}

// ── 🛒 상점 깔때기 (최근 7일) — 버튼 클릭 시에만 조회 ──
//  shop_funnel 문서를 날짜 in(7일) 로 읽는다 — 복합 인덱스 없이 되는 형태. 계산은 funnel.js(순수, 테스트 있음).
const FUNNEL_DAYS = 7;
const FUNNEL_FETCH_CAP = 3000;
async function loadFunnelData({ force = false } = {}) {
  const el = document.getElementById('funnelResult');
  setLoading(el, `상점 단계 로그 최근 ${FUNNEL_DAYS}일 조회 중...`);
  try {
    if (force) cache.bust('analytics:funnel');
    const rows = await cache.get('analytics:funnel', () =>
      fetchDocs(query(collection(db, 'shop_funnel'), where('date', 'in', lastDates(FUNNEL_DAYS)), limit(FUNNEL_FETCH_CAP))));
    const f = computeFunnel(rows);
    const p = (v) => (v == null ? '—' : `${v}%`);
    const bars = (steps, baseLabel) => {
      const max = Math.max(1, ...steps.map((s) => s.n));
      return `<div class="mini-list">${steps.map((s) => `
        <div class="funnel-row" title="웹 ${fmtNum(s.web)} · 앱 ${fmtNum(s.app)}${s.ofPrev == null ? '' : ` · 직전 대비 ${p(s.ofPrev)}`}">
          <span class="funnel-label">${escapeHtml(s.label)}</span>
          <span class="funnel-bar"><i style="width:${Math.round(s.n / max * 100)}%"></i></span>
          <span class="funnel-num">${fmtNum(s.n)}<small>${s.ofBase == null ? '' : p(s.ofBase)}</small></span>
        </div>`).join('')}
      </div>
      <div class="card-note" style="margin-top:4px;">오른쪽 작은 % 는 '${baseLabel}' 대비. 행에 손을 올리면 웹/앱 나눔과 직전 단계 대비가 보여요.</div>`;
    };
    const capNote = rows.length >= FUNNEL_FETCH_CAP
      ? `<div class="card-note">⚠️ 로그 ${FUNNEL_FETCH_CAP}건까지만 읽었어요 — 근사치입니다.</div>` : '';
    const worst = f.worst
      ? `<div class="card-note" style="margin:8px 0 6px; color:#fcd34d;">가장 많이 빠지는 구간: <b>${escapeHtml(f.worst.from)} → ${escapeHtml(f.worst.to)}</b> (${fmtNum(f.worst.lost)}명 이탈, 직전 대비 ${p(f.worst.ofPrev)})</div>`
      : `<div class="card-note" style="margin:8px 0 6px;">표본이 아직 적어(단계당 5명 미만) 이탈 구간을 못 짚어요. 며칠 더 모이면 여기 나와요.</div>`;
    el.innerHTML = `
      ${capNote}
      <div class="card-note" style="margin-bottom:6px;">세션 ${fmtNum(f.sessions)}개 · 최근 ${FUNNEL_DAYS}일</div>
      <h4 style="margin:6px 0 4px; font-size:13.5px;">🍮 젤리 꾸미기</h4>
      ${bars(f.jelly, '상점 진입')}
      ${worst}
      ${f.tabs.length ? `<div class="card-note" style="margin-bottom:8px;">많이 연 탭: ${f.tabs.slice(0, 5).map((t) => `${escapeHtml(t.tab)} ${fmtNum(t.n)}`).join(' · ')}</div>` : ''}
      <h4 style="margin:12px 0 4px; font-size:13.5px;">💳 현금 상품</h4>
      ${bars(f.cash, '현금 상점 링크')}
      <div class="card-note" style="margin-top:8px; line-height:1.55;">
        <b>결제 완료</b>는 앱(Google Play)만 잡혀요 — 웹 카카오페이는 완료 신호가 없어서 <b>결제 버튼</b>까지만 보이고, 실제 입금은 주문함에서 확인돼요.<br>
        <b>입구 클릭</b>은 게임 화면의 🍮 버튼. 상점 진입보다 적으면 상점을 주소로 직접 들어온 사람이 있는 거예요.
      </div>`;
  } catch (e) {
    setError(el, humanError(e));
  }
}

export function initAnalyticsTab() {
  const fnBtn = document.getElementById('funnelLoadBtn');
  if (fnBtn) fnBtn.addEventListener('click', guardBtn(fnBtn, () => loadFunnelData({ force: cache.peek('analytics:funnel') != null })));
  const btn = document.getElementById('referrerLoadBtn');
  btn.addEventListener('click', guardBtn(btn, () => loadReferrerData({ force: cache.peek('analytics:referrer') != null })));
  const rtBtn = document.getElementById('retentionLoadBtn');
  if (rtBtn) rtBtn.addEventListener('click', guardBtn(rtBtn, () => loadRetentionData({ force: cache.peek('analytics:retention') != null })));

  // 🛠 통계 재집계 — 이 기기의 캐시(localStorage 포함)와 저장된 dailyStats를 무시하고
  // 지난 13일을 원본에서 다시 집계. 잘못 저장된 캐시가 의심될 때만 수동 실행.
  const rBtn = document.getElementById('recomputeBtn');
  rBtn.addEventListener('click', guardBtn(rBtn, async () => {
    const ok = confirm('지난 13일 통계를 원본 데이터에서 다시 집계할까요?\n'
      + '이 기기의 통계 캐시(localStorage)와 저장된 집계 문서를 새 값으로 덮어씁니다.\n'
      + '(비용: 최초 백필 1회와 동일한 원본 조회가 발생 — 캐시가 의심될 때만 사용)');
    if (!ok) return;
    const original = rBtn.textContent;
    try {
      await forceRecomputeRange(14, (dateStr) => { rBtn.textContent = `재집계 중... ${dateStr.slice(5)}`; });
      cache.bust('shared:todaySessions');
      cache.bust('shared:todayCount');
      cache.bust('analytics');
      await loadAnalytics({ force: true });
      rBtn.textContent = '✅ 재집계 완료';
      setTimeout(() => { rBtn.textContent = original; }, 4000);
    } catch (e) {
      alert('재집계 실패: ' + humanError(e));
      rBtn.textContent = original;
    }
  }));
}
