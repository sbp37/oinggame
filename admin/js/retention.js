// ══════════════════════════════════════════════════════════════
//  retention.js — 신규 유저 재방문(코호트) 계산. 순수 함수만 — Firebase 의존 없음.
//
//  왜 이 파일이 있나 (2026-09-05):
//   "사람들이 왜 다시 안 오는지"를 감으로 논쟁하고 있었다. 광고 위치·가격·플랫폼을 정하기
//   전에 재방문이 실제로 어떤지 숫자로 봐야 한다. 이 계산은 어드민 통계 탭에서
//   user_stats 를 최신 신규순으로 읽어(버튼 눌렀을 때만) 주 단위 코호트로 묶는다.
//
//  user_stats 에 있는 재료와 그걸로 '정직하게' 말할 수 있는 것:
//   · firstPlayed / lastPlayed / playCount / daysPlayed / lastPlayDate / refBy
//       → 신규 수, 2판 이상 비율, '다른 날 다시 온' 비율, 최근 7일 활동, 초대 유입 비교
//   · playDates (2026-09-05 빌드부터 클라이언트가 기록 — 논 날짜 최근 30일치)
//       → 정확한 D1(다음날 재방문)·D7(7일 안 재방문). 그 전 유저는 이 값이 없어 '—' 로 둔다.
//   없는 것: 첫 판 완주율(user_stats 는 첫 판을 '끝낸' 뒤에야 생긴다), 판 단위 시각.
//
//  날짜는 전부 KST(UTC+9). 주 시작은 월요일 — 게임의 주간 랭킹(getWeekId)과 같은 경계.
// ══════════════════════════════════════════════════════════════

const DAY_MS = 86400000;
const KST_MS = 9 * 60 * 60 * 1000;

export function kstDateStr(ms) {
  return new Date(ms + KST_MS).toISOString().slice(0, 10);
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// 그 시각이 속한 주의 월요일(KST) — 게임 본체 getWeekId()·서버 getWeekIdKST() 와 동일 규칙.
export function weekIdOf(ms) {
  const k = new Date(ms + KST_MS);
  const day = k.getUTCDay();
  k.setUTCDate(k.getUTCDate() - (day === 0 ? 6 : day - 1));
  return k.toISOString().slice(0, 10);
}

function num(v) { return (typeof v === 'number' && Number.isFinite(v)) ? v : 0; }
function pct(n, d) { return d > 0 ? Math.round(n / d * 100) : null; }

// user_stats 문서 1건 → 판정에 쓰는 정규화 레코드. firstPlayed 없으면 null(집계 제외).
export function normalizeUserRow(row) {
  const fp = num(row && row.firstPlayed);
  if (fp <= 0) return null;
  const lp = num(row.lastPlayed);
  const firstDay = kstDateStr(fp);
  const lastDay = lp > 0 ? kstDateStr(lp) : (row.lastPlayDate || firstDay);
  const daysPlayed = num(row.daysPlayed);
  const playDates = Array.isArray(row.playDates) ? row.playDates.filter((s) => typeof s === 'string') : null;
  return {
    id: row.id || '',
    firstPlayed: fp,
    lastPlayed: lp,
    firstDay,
    playCount: num(row.playCount),
    // '다른 날 다시 왔다': daysPlayed 가 2 이상이거나(정확), 없던 시절 유저는 마지막 플레이 날짜가 첫날과 다른가로.
    returned: daysPlayed >= 2 || lastDay !== firstDay,
    invited: !!(row.refBy && String(row.refBy).trim()),
    playDates,
  };
}

// D1·D7 — playDates 가 있는 유저만. D7 은 첫날 이후 7일이 다 지나야 확정(final).
function dayRetention(u, nowMs) {
  if (!u.playDates || !u.playDates.length) return null;
  const set = new Set(u.playDates);
  const d1 = set.has(addDays(u.firstDay, 1));
  let d7 = false;
  for (let i = 1; i <= 7; i++) if (set.has(addDays(u.firstDay, i))) { d7 = true; break; }
  const ageDays = Math.floor((nowMs - u.firstPlayed) / DAY_MS);
  return { d1, d7, d1Final: ageDays >= 1, d7Final: ageDays >= 7 };
}

function emptyBucket(weekId) {
  return {
    weekId, n: 0, multi: 0, returned: 0,
    active7: 0, active7Denom: 0,          // 최근 7일 활동 — 코호트가 7일 이상 됐을 때만 의미
    invited: 0, invitedReturned: 0, otherReturned: 0,
    d1: 0, d1Tracked: 0, d7: 0, d7Tracked: 0, // playDates 있는 유저만
  };
}

// rows: user_stats 문서 배열(id 포함). weeks: 이번 주 포함 최근 몇 주.
export function computeRetention(rows, nowMs = Date.now(), { weeks = 6 } = {}) {
  const users = (rows || []).map(normalizeUserRow).filter(Boolean);
  const thisWeek = weekIdOf(nowMs);
  const weekIds = [];
  for (let w = 0; w < weeks; w++) weekIds.push(addDays(thisWeek, -7 * w));
  const buckets = new Map(weekIds.map((id) => [id, emptyBucket(id)]));
  const sevenAgo = nowMs - 7 * DAY_MS;
  const funnel = { n: 0, multi: 0, returned: 0, active7: 0, active7Denom: 0, invited: 0, invitedReturned: 0, otherReturned: 0,
    d1: 0, d1Tracked: 0, d7: 0, d7Tracked: 0 };
  const since28 = nowMs - 28 * DAY_MS;

  for (const u of users) {
    const b = buckets.get(weekIdOf(u.firstPlayed));
    const targets = [];
    if (b) targets.push(b);
    if (u.firstPlayed >= since28) targets.push(funnel);
    if (!targets.length) continue;
    const ret = dayRetention(u, nowMs);
    for (const t of targets) {
      t.n++;
      if (u.playCount >= 2) t.multi++;
      if (u.returned) t.returned++;
      if (u.firstPlayed <= sevenAgo) { t.active7Denom++; if (u.lastPlayed >= sevenAgo) t.active7++; }
      if (u.invited) { t.invited++; if (u.returned) t.invitedReturned++; }
      else if (u.returned) t.otherReturned++;
      if (ret) {
        if (ret.d1Final) { t.d1Tracked++; if (ret.d1) t.d1++; }
        if (ret.d7Final) { t.d7Tracked++; if (ret.d7) t.d7++; }
      }
    }
  }

  const finish = (b) => ({
    ...b,
    multiPct: pct(b.multi, b.n),
    returnedPct: pct(b.returned, b.n),
    active7Pct: pct(b.active7, b.active7Denom),
    invitedReturnedPct: pct(b.invitedReturned, b.invited),
    otherReturnedPct: pct(b.otherReturned, b.n - b.invited),
    d1Pct: pct(b.d1, b.d1Tracked),
    d7Pct: pct(b.d7, b.d7Tracked),
  });
  return {
    nowMs,
    totalUsers: users.length,
    cohorts: weekIds.map((id) => finish(buckets.get(id))), // 이번 주부터 과거 순
    last28: finish(funnel),
  };
}

// 클라이언트(index.html)와 같은 규칙 — 논 날짜를 중복 없이, 최근 30일치만.
export function mergePlayDates(prev, todayStr, max = 30) {
  const list = Array.isArray(prev) ? prev.filter((s) => typeof s === 'string') : [];
  if (todayStr && !list.includes(todayStr)) list.push(todayStr);
  list.sort();
  return list.slice(-max);
}
