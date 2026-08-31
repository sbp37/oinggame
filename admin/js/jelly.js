// ══════════════════════════════════════════════════════════════
//  jelly.js — 🍮 젤리 관리 (2026-08-30 신설)
//
//  잔액의 단일 원본은 jelly_wallet/{uid}(서버 전용 쓰기 — 단, 규칙상 어드민은 예외).
//  · 조회: 지갑 + 그 유저의 원장(jelly_log where uid==) — uid 등호 쿼리만 쓰므로
//    복합 인덱스 불필요(정렬은 클라이언트에서).
//  · 수동 지급/차감: runTransaction 으로 잔액 변경 + 원장 기록을 원자 처리.
//    지갑이 아직 없으면 서버(submitScore)와 같은 seed 규칙으로 user_stats.jelly
//    레거시 잔액을 먼저 흡수해 만든다 — 여기서 그냥 새 지갑을 만들어버리면
//    서버가 나중에 레거시 잔액을 흡수하지 않아 유저 젤리가 증발한다.
// ══════════════════════════════════════════════════════════════
import {
  db, fns, collection, doc, query, where, orderBy, limit, runTransaction, httpsCallable,
  fetchDoc, fetchDocs, resolveUserDocId,
  fmtNum, fmtDateTime, escapeHtml, humanError,
} from './firebase.js';
import { setLoading, setEmpty, setError, guardBtn, resultMsg } from './admin.js';

const SOURCE_KO = {
  submitScore: '🎮 게임 지급', claimDaily: '📅 출석', earlyMember: '🎁 초기 멤버 선물',
  buySkin: '🎨 스킨 구매', buyFrame: '🖼 프레임 구매', buyBubble: '💬 말풍선 구매',
  renameEarly: '✏️ 조기 닉변', restore: '🔗 계정 합산', admin: '🛠 운영자 조정',
  friendReferral: '💌 친구초대',
};
const GRANT_KO = { welcome: '환영', firstGame: '첫판', goal: '목표', streak: '연속' };

function grantsLabel(g) {
  if (!g) return '';
  return Object.keys(g).map(k => `${GRANT_KO[k] || k}+${g[k]}`).join('·');
}
function logRowHtml(r, { withNick = false } = {}) {
  const amt = typeof r.amount === 'number' ? r.amount : 0;
  const sign = amt >= 0 ? `+${fmtNum(amt)}` : fmtNum(amt);
  const cls = amt >= 0 ? 'badge green' : 'badge warn';
  const src = SOURCE_KO[r.source] || r.source || r.type || '?';
  const extra = [
    r.grants ? grantsLabel(r.grants) : '',
    r.item ? escapeHtml(r.item) : '',
    r.reason ? escapeHtml(r.reason) : '',
    (r.from && r.to) ? `${escapeHtml(r.from)}→${escapeHtml(r.to)}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="list-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
    <span class="main">${withNick && r.nickname ? `<span class="nick">${escapeHtml(r.nickname)}</span> ` : ''}${src}
      ${extra ? `<span class="sub" style="color:var(--muted);font-size:11px;"> ${extra}</span>` : ''}<br>
      <span class="sub" style="color:var(--muted);font-size:11px;">${r.ts ? fmtDateTime(r.ts) : ''} · 잔액 ${fmtNum(r.balanceAfter ?? '?')}</span></span>
    <span class="${cls}">🍮 ${sign}</span>
  </div>`;
}

// 이번 주에서 weeksAgo 주 전의 주간 문서 id — getWeekId() 와 같은 KST 월요일 계산.
function weekIdBack(weeksAgo) {
  const k = new Date(Date.now() + 9 * 3600 * 1000 - weeksAgo * 7 * 86400000);
  const day = k.getUTCDay();
  k.setUTCDate(k.getUTCDate() - (day === 0 ? 6 : day - 1));
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, '0')}-${String(k.getUTCDate()).padStart(2, '0')}`;
}
const WEEKLY_UID_LOOKBACK = 12; // 주간 문서를 거슬러 볼 주 수 (약 3개월)

// 닉네임 → uid.
//
// 예전엔 nickname_lookup 과 rankings/{nick} 두 곳만 봤는데, 옛날부터 하던 유저는
// 둘 다 uid 가 없어서 "계정(UID)을 못 찾았어요"로 막혔다(실제 사례: 사이다).
//  · nickname_lookup/{닉} 이 phase-a 이관 때 만들어진 '예약(reserved)' 문서면 uid 가 없다.
//  · rankings/{닉} 은 이미 uid 가 박힌 문서만 그 값을 보존하고, 새로 붙이지는 않는다
//    (닉네임 탈취 방지 정책 — gameSession.js 의 rkUid 는 자동 claim 하지 않는다).
// 그래서 uid 가 실제로 남는 곳까지 순서대로 내려가며 찾는다:
//  ① nickname_lookup  — 계정 연결을 마친 유저(가장 확실)
//  ② rankings/{닉}    — 소유 uid 가 기록된 전체 랭킹 문서
//  ③ weekly_rankings  — 주간 문서는 weeklyUidFor 규칙에 따라 본인이 최고점을 쓸 때만
//                       uid 를 남긴다. 이번 주부터 거슬러 올라가며 확인.
//  ④ game_sessions    — 점수 제출마다 uid 가 함께 저장된다(30일 보관). 닉네임 등호
//                       쿼리라 복합 인덱스가 필요 없고, 최근순 정렬은 여기서 한다.
// ③④ 는 같은 닉네임을 여러 계정이 거쳐갔을 수 있으므로 '가장 최근' 기록을 쓰고,
// 서로 다른 uid 가 섞여 있으면 ambiguous 로 알려 운영자가 눈으로 확인하게 한다.
async function resolveJellyUid(nick) {
  const { uid } = await resolveUserDocId(nick);
  if (uid) return { uid, source: '계정 연결 기록' };

  const rk = await fetchDoc(doc(db, 'rankings', nick)).catch(() => null);
  if (rk && rk.uid) return { uid: rk.uid, source: '전체 랭킹 문서' };

  for (let w = 0; w < WEEKLY_UID_LOOKBACK; w++) {
    const weekId = weekIdBack(w);
    const wk = await fetchDoc(doc(db, 'weekly_rankings', weekId, 'scores', nick)).catch(() => null);
    if (wk && wk.uid) return { uid: wk.uid, source: `주간 랭킹(${weekId})` };
  }

  const sessions = await fetchDocs(
    query(collection(db, 'game_sessions'), where('nickname', '==', nick), limit(50)),
  ).catch(() => []);
  const withUid = sessions
    .filter(s => s && typeof s.uid === 'string' && s.uid)
    .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
  if (withUid.length) {
    return {
      uid: withUid[0].uid,
      source: '최근 게임 기록',
      ambiguous: new Set(withUid.map(s => s.uid)).size > 1,
    };
  }
  return { uid: null };
}

let current = null; // { nick, uid }
let walletOverviewRows = [];

function walletOverviewHtml(rows) {
  if (!rows.length) return '<div class="empty">조건에 맞는 지갑이 없어요.</div>';
  return rows.map(row => `<div class="economy-row">
    <div class="economy-main"><div class="economy-name">${escapeHtml(row.nickname || '(닉네임 확인 불가)')}</div>
      <div class="economy-meta">${escapeHtml(row.uid)} · 마지막 변경 ${row.updatedAt ? escapeHtml(fmtDateTime(row.updatedAt)) : '-'}</div></div>
    <div style="text-align:right;"><div class="economy-balance">🍮 ${fmtNum(row.balance)}개</div>
      ${row.nickname ? `<button type="button" class="economy-open-user" data-jelly-nick="${escapeHtml(row.nickname)}">조회·지급</button>` : ''}</div>
  </div>`).join('');
}

function renderWalletOverview() {
  const filter = (document.getElementById('jellyWalletFilter').value || '').trim().toLowerCase();
  const rows = filter ? walletOverviewRows.filter(row => `${row.nickname} ${row.uid}`.toLowerCase().includes(filter)) : walletOverviewRows;
  document.getElementById('jellyWalletsList').innerHTML = walletOverviewHtml(rows);
}

async function loadWalletOverview() {
  const list = document.getElementById('jellyWalletsList');
  setLoading(list, '전체 지갑을 불러오는 중…');
  try {
    const wallets = await fetchDocs(query(collection(db, 'jelly_wallet'), orderBy('balance', 'desc'), limit(100)));
    const users = await Promise.all(wallets.map(row => fetchDoc(doc(db, 'users', row.id)).catch(() => null)));
    walletOverviewRows = wallets.map((row, index) => ({
      uid: row.id,
      nickname: users[index] && users[index].nickname ? users[index].nickname : '',
      balance: Number(row.balance || 0),
      updatedAt: Number(row.updatedAt || 0),
    }));
    const total = walletOverviewRows.reduce((sum, row) => sum + row.balance, 0);
    const holders = walletOverviewRows.filter(row => row.balance > 0).length;
    document.getElementById('jellyWalletsSummary').innerHTML = `<div class="economy-summary">
      <div><b>${fmtNum(walletOverviewRows.length)}</b><span>상위 지갑(최대 100)</span></div>
      <div><b>${fmtNum(holders)}</b><span>표시 중 1개 이상</span></div>
      <div><b>🍮 ${fmtNum(total)}</b><span>표시 잔액 합계</span></div>
    </div>`;
    const filterEl = document.getElementById('jellyWalletFilter');
    filterEl.style.display = '';
    renderWalletOverview();
  } catch (e) { setError(list, humanError(e)); }
}

function referralRow(row, status) {
  const when = status === 'granted' ? row.grantedAt : row.capturedAt;
  const inviter = row.inviterNickname || row.inviterUid || '-';
  const invitee = row.inviteeNickname || row.inviteeUid || '-';
  return `<div class="economy-row"><div class="economy-main">
    <div class="economy-name">${escapeHtml(inviter)} → ${escapeHtml(invitee)}</div>
    <div class="economy-meta">${escapeHtml(row.code || '-')} · ${escapeHtml(fmtDateTime(when))}</div>
  </div><div class="economy-balance">${status === 'granted' ? `양쪽 +${fmtNum(row.reward || 5)} ✓` : '조건 대기'}</div></div>`;
}

async function loadReferralOverview() {
  const list = document.getElementById('referralOverviewList');
  setLoading(list, '친구초대 내역을 불러오는 중…');
  try {
    const response = await httpsCallable(fns, 'referralAction')({ action:'adminOverview' });
    const data = (response && response.data) || {};
    const grants = Array.isArray(data.grants) ? data.grants : [];
    const pending = Array.isArray(data.pending) ? data.pending : [];
    const totals = data.totals || {};
    document.getElementById('referralOverviewSummary').innerHTML = `<div class="economy-summary">
      <div><b>${fmtNum(totals.granted || 0)}</b><span>지급 완료</span></div>
      <div><b>${fmtNum(totals.pending || 0)}</b><span>조건 대기</span></div>
      <div><b>🍮 ${fmtNum((totals.inviterJelly || 0) + (totals.inviteeJelly || 0))}</b><span>총 지급</span></div>
    </div>`;
    const parts = [];
    if (totals.truncated) {
      parts.push('<div class="economy-note">최근 200건까지만 표시해요. 위 숫자도 현재 불러온 범위 기준이에요.</div>');
    }
    parts.push(`<div class="economy-section-title">지급 완료 ${grants.length}건</div>`);
    parts.push(grants.length ? grants.map(row => referralRow(row, 'granted')).join('') : '<div class="empty">아직 지급 완료된 초대가 없어요.</div>');
    parts.push(`<div class="economy-section-title">한 판 완료 대기 ${pending.length}건</div>`);
    parts.push(pending.length ? pending.map(row => referralRow(row, 'pending')).join('') : '<div class="empty">기다리는 초대가 없어요.</div>');
    list.innerHTML = parts.join('');
  } catch (e) { setError(list, humanError(e)); }
}

async function lookupJelly() {
  const nick = document.getElementById('jellyNick').value.trim();
  const box = document.getElementById('jellyWalletBox');
  const logEl = document.getElementById('jellyUserLog');
  const adjBox = document.getElementById('jellyAdjustBox');
  current = null; adjBox.style.display = 'none'; logEl.innerHTML = '';
  if (!nick) { resultMsg('jellyResult', '닉네임을 입력하세요.', false); return; }
  setLoading(box, '지갑 확인 중...');
  try {
    const { uid, source, ambiguous } = await resolveJellyUid(nick);
    if (!uid) {
      setError(box, `"${nick}"의 계정(UID)을 못 찾았어요 — 계정 연결·랭킹·최근 30일 게임 기록 어디에도 uid가 없어요. 닉네임 철자를 확인하거나, 이 유저가 한 판 더 하고 나서 다시 조회해 주세요.`);
      return;
    }
    const w = await fetchDoc(doc(db, 'jelly_wallet', uid));
    let balance, note;
    if (w) {
      balance = w.balance || 0;
      note = [
        w.streakDays ? `연속 ${w.streakDays}일` : '',
        w.lastPlayDate ? `마지막 플레이 ${w.lastPlayDate}` : '',
        w.welcomeGranted ? '환영 지급됨' : '환영 미지급',
        w.earlyMemberGrantedAt ? '초기 멤버 선물 지급됨' : '',
        typeof w.seededAmount === 'number' ? `레거시 흡수 ${w.seededAmount}` : '',
      ].filter(Boolean).join(' · ');
    } else {
      // 지갑 없음 — 서버가 흡수하게 될 레거시 잔액을 참고로 표시한다.
      // 흡수 조건은 서버(submitScore)·아래 지급 트랜잭션과 똑같이 따진다:
      // user_stats/{uid} 이거나, 닉네임 문서라도 uid 필드가 이 uid 와 일치할 때만.
      // (예전엔 닉네임 문서를 조건 없이 보여줘서, 실제로는 흡수되지 않을 옛 잔액이
      //  마치 남아 있는 것처럼 보였다 — 레거시 닉네임 계정에서 표시가 어긋났다.)
      const uidStats = await fetchDoc(doc(db, 'user_stats', uid)).catch(() => null);
      const legacy = uidStats ? null : await fetchDoc(doc(db, 'user_stats', nick)).catch(() => null);
      const seedStats = uidStats || ((legacy && legacy.uid === uid) ? legacy : null);
      balance = (seedStats && typeof seedStats.jelly === 'number') ? seedStats.jelly : 0;
      note = seedStats
        ? '지갑 미생성 — 표시 잔액은 첫 지급/구매 때 흡수될 옛 user_stats 값'
        : (legacy && typeof legacy.jelly === 'number' && legacy.jelly > 0
          ? `지갑 미생성 — 옛 닉네임 문서에 ${fmtNum(legacy.jelly)}개가 있지만 uid가 달라 흡수되지 않아요(잔액 0으로 시작)`
          : '지갑 미생성 — 첫 지급 때 만들어져요');
    }
    current = { nick, uid };
    const originLine = [
      source ? `계정 확인: ${source}` : '',
      ambiguous ? '⚠️ 이 닉네임을 쓴 계정이 둘 이상이라 가장 최근 계정을 골랐어요 — UID를 확인하고 지급하세요.' : '',
    ].filter(Boolean).join(' · ');
    box.innerHTML = `<div class="stat-tile" style="text-align:left;">
      <div class="stat-label">${escapeHtml(nick)} <span style="color:var(--muted);font-size:10px;">${escapeHtml(uid)}</span></div>
      <div class="stat-value">🍮 ${fmtNum(balance)}개</div>
      <div class="stat-label" style="margin-top:4px;">${escapeHtml(note)}</div>
      ${originLine ? `<div class="stat-label" style="margin-top:4px;color:${ambiguous ? 'var(--warn,#f6c453)' : 'var(--muted)'};">${escapeHtml(originLine)}</div>` : ''}
    </div>`;
    adjBox.style.display = 'block';
    // 이 유저의 원장 — uid 등호 쿼리(복합 인덱스 불필요), 정렬은 여기서
    setLoading(logEl, '원장 확인 중...');
    // (uid ASC, ts DESC) 복합 인덱스로 서버가 최근순을 보장한다 — orderBy 없이 limit만
    // 걸면 문서 id 순 '임의 N건'이라 로그 많은 유저부터 최근 내역이 빠졌다(검수 지적).
    const rows = await fetchDocs(query(collection(db, 'jelly_log'), where('uid', '==', uid), orderBy('ts', 'desc'), limit(15)));
    if (!rows.length) { setEmpty(logEl, '아직 원장 기록이 없어요.'); return; }
    logEl.innerHTML = rows.map(r => logRowHtml(r)).join('');
  } catch (e) { setError(box, humanError(e)); }
}

async function adjustJelly() {
  if (!current) { resultMsg('jellyResult', '먼저 유저를 조회하세요.', false); return; }
  const amtEl = document.getElementById('jellyAmount');
  const reasonEl = document.getElementById('jellyReason');
  const delta = parseInt(amtEl.value, 10);
  const reason = reasonEl.value.trim();
  if (!Number.isFinite(delta) || delta === 0) { resultMsg('jellyResult', '0이 아닌 정수를 입력하세요. (음수 = 회수)', false); return; }
  if (!reason) { resultMsg('jellyResult', '사유를 입력하세요 — 원장에 남아 나중에 CS 근거가 돼요.', false); return; }
  const { nick, uid } = current;
  if (!confirm(`${nick}님에게 젤리 ${delta > 0 ? '+' + delta + ' 지급' : delta + ' 회수'}\n사유: ${reason}\n진행할까요?`)) return;
  try {
    const wRef = doc(db, 'jelly_wallet', uid);
    // seed 후보 문서를 미리 결정 — 서버(submitScore)와 동일 규칙:
    // user_stats/{uid} 우선, 없으면 uid 필드가 일치하는 닉네임 레거시 문서만
    let seedDocId = uid;
    {
      const uidStats = await fetchDoc(doc(db, 'user_stats', uid)).catch(() => null);
      if (!uidStats) {
        const legacy = await fetchDoc(doc(db, 'user_stats', nick)).catch(() => null);
        if (legacy && legacy.uid === uid) seedDocId = nick;
      }
    }
    const balanceAfter = await runTransaction(db, async (tx) => {
      const wSnap = await tx.get(wRef);
      const w = wSnap.exists() ? wSnap.data() : null;
      let balance, createFields = {};
      if (w) {
        balance = (typeof w.balance === 'number' && w.balance >= 0) ? Math.floor(w.balance) : 0;
      } else {
        // 서버와 같은 seed 규칙 — 레거시 잔액을 흡수하며 지갑 생성 (증발 방지)
        const sSnap = await tx.get(doc(db, 'user_stats', seedDocId));
        const stats = sSnap.exists() ? sSnap.data() : null;
        balance = (stats && typeof stats.jelly === 'number' && stats.jelly >= 0) ? Math.floor(stats.jelly) : 0;
        createFields = { createdAt: Date.now(), seededAmount: balance, welcomeGranted: balance > 0 };
      }
      const next = balance + delta;
      if (next < 0) throw new Error(`잔액 부족 — 현재 ${balance}개라 ${delta}는 적용할 수 없어요.`);
      // 지급(+)이면 '배달 왔다냥' 팝업이 뜨도록 표시를 남긴다. 유저가 다음 접속 때 보고
      // 서버(shopAction ackJellyGift)가 지운다 — 기기를 바꿔도 딱 한 번만 뜬다.
      // 차감(-)에는 표시하지 않는다(알릴 일이 아니다).
      const giftFields = delta > 0
        ? { giftPending: (typeof w?.giftPending === 'number' ? Math.max(0, w.giftPending) : 0) + delta,
            giftPendingAt: Date.now() }
        : {};
      tx.set(wRef, { uid, balance: next, updatedAt: Date.now(), ...createFields, ...giftFields }, { merge: true });
      tx.set(doc(collection(db, 'jelly_log')), {
        uid, nickname: nick, ts: Date.now(), type: 'adjust', source: 'admin',
        amount: delta, reason, balanceAfter: next,
      });
      return next;
    });
    amtEl.value = ''; reasonEl.value = '';
    resultMsg('jellyResult', `✅ ${nick}님 젤리 ${delta > 0 ? '+' + delta : delta} 완료 — 현재 잔액 🍮 ${fmtNum(balanceAfter)}개`, true);
    await lookupJelly(); // 지갑·원장 갱신 (jellyNick 입력값 유지)
  } catch (e) { resultMsg('jellyResult', humanError(e), false); }
}

async function loadGlobalLog() {
  const el = document.getElementById('jellyGlobalLog');
  setLoading(el, '원장 불러오는 중...');
  try {
    const rows = await fetchDocs(query(collection(db, 'jelly_log'), orderBy('ts', 'desc'), limit(30)));
    if (!rows.length) { setEmpty(el, '아직 기록이 없어요 — 유저가 게임을 완료하면 지급 기록이 쌓여요.'); return; }
    // 서버 원장은 UID가 진실이라 대부분 닉네임 문자열을 중복 저장하지 않는다.
    // 전체 목록에서는 각 UID의 users 문서를 한 번씩만 읽어 이름을 붙여, 서로 다른
    // 유저의 지급이 한 사람에게 반복 지급된 것처럼 보이지 않게 한다.
    const uids = [...new Set(rows.map(row => row.uid).filter(Boolean))];
    const users = await Promise.all(uids.map(uid => fetchDoc(doc(db, 'users', uid)).catch(() => null)));
    const nickByUid = new Map(uids.map((uid, index) => [uid, users[index] && users[index].nickname ? users[index].nickname : '']));
    rows.forEach(row => { if (!row.nickname && row.uid) row.nickname = nickByUid.get(row.uid) || `UID ${String(row.uid).slice(0, 6)}…`; });
    el.innerHTML = rows.map(r => logRowHtml(r, { withNick: true })).join('');
  } catch (e) { setError(el, humanError(e)); }
}

export function initJellyTab() {
  const walletsBtn = document.getElementById('jellyWalletsLoadBtn');
  walletsBtn.addEventListener('click', guardBtn(walletsBtn, loadWalletOverview));
  const walletFilter = document.getElementById('jellyWalletFilter');
  walletFilter.addEventListener('input', renderWalletOverview);
  document.getElementById('jellyWalletsList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-jelly-nick]');
    if (!button) return;
    document.getElementById('jellyNick').value = button.dataset.jellyNick;
    document.getElementById('jellyLookupBtn').click();
  });
  const lookupBtn = document.getElementById('jellyLookupBtn');
  lookupBtn.addEventListener('click', guardBtn(lookupBtn, lookupJelly));
  document.getElementById('jellyNick').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupBtn.click(); });
  const adjBtn = document.getElementById('jellyAdjustBtn');
  adjBtn.addEventListener('click', guardBtn(adjBtn, adjustJelly));
  const logBtn = document.getElementById('jellyLogLoadBtn');
  logBtn.addEventListener('click', guardBtn(logBtn, loadGlobalLog));
  const referralBtn = document.getElementById('referralOverviewLoadBtn');
  referralBtn.addEventListener('click', guardBtn(referralBtn, loadReferralOverview));
}
