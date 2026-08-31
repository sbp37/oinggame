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
  fetchDoc, fetchDocs, resolveUserDocId, getUserDocByNick,
  fmtNum, fmtDateTime, escapeHtml, humanError,
} from './firebase.js';
import { setLoading, setEmpty, setError, guardBtn, resultMsg } from './admin.js';

const SOURCE_KO = {
  submitScore: '🎮 게임 지급', claimDaily: '📅 출석', earlyMember: '🎁 기존 회원 선물',
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

// 닉네임 → uid (nickname_lookup 우선, rankings/{nick}.uid 폴백 — 섀도우밴과 동일 규칙)
async function resolveJellyUid(nick) {
  const { uid } = await resolveUserDocId(nick);
  if (uid) return uid;
  const rk = await fetchDoc(doc(db, 'rankings', nick)).catch(() => null);
  return (rk && rk.uid) ? rk.uid : null;
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
  </div><div class="economy-balance">${status === 'granted' ? `양쪽 +${fmtNum(row.reward || 3)} ✓` : '조건 대기'}</div></div>`;
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
    const uid = await resolveJellyUid(nick);
    if (!uid) { setError(box, `"${nick}"의 계정(UID)을 못 찾았어요 — 랭킹/계정 연결 기록이 있는 유저만 관리할 수 있어요.`); return; }
    const w = await fetchDoc(doc(db, 'jelly_wallet', uid));
    let balance, note;
    if (w) {
      balance = w.balance || 0;
      note = [
        w.streakDays ? `연속 ${w.streakDays}일` : '',
        w.lastPlayDate ? `마지막 플레이 ${w.lastPlayDate}` : '',
        w.welcomeGranted ? '환영 지급됨' : '환영 미지급',
        w.earlyMemberGrantedAt ? '기존 회원 선물 지급됨' : '',
        typeof w.seededAmount === 'number' ? `레거시 흡수 ${w.seededAmount}` : '',
      ].filter(Boolean).join(' · ');
    } else {
      // 지갑 없음 — 서버가 흡수하게 될 레거시 잔액을 참고로 표시
      const { data: stats } = await getUserDocByNick('user_stats', nick);
      balance = (stats && typeof stats.jelly === 'number') ? stats.jelly : 0;
      note = '지갑 미생성 — 표시 잔액은 첫 지급/구매 때 흡수될 옛 user_stats 값';
    }
    current = { nick, uid };
    box.innerHTML = `<div class="stat-tile" style="text-align:left;">
      <div class="stat-label">${escapeHtml(nick)} <span style="color:var(--muted);font-size:10px;">${escapeHtml(uid)}</span></div>
      <div class="stat-value">🍮 ${fmtNum(balance)}개</div>
      <div class="stat-label" style="margin-top:4px;">${escapeHtml(note)}</div>
    </div>`;
    adjBox.style.display = 'block';
    // 이 유저의 원장 — uid 등호 쿼리(복합 인덱스 불필요), 정렬은 여기서
    setLoading(logEl, '원장 확인 중...');
    const rows = await fetchDocs(query(collection(db, 'jelly_log'), where('uid', '==', uid), limit(50)));
    if (!rows.length) { setEmpty(logEl, '아직 원장 기록이 없어요.'); return; }
    rows.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    logEl.innerHTML = rows.slice(0, 15).map(r => logRowHtml(r)).join('');
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
      tx.set(wRef, { uid, balance: next, updatedAt: Date.now(), ...createFields }, { merge: true });
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
