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
  db, collection, doc, query, where, orderBy, limit, runTransaction,
  fetchDoc, fetchDocs, resolveUserDocId, getUserDocByNick,
  fmtNum, fmtDateTime, escapeHtml, humanError,
} from './firebase.js';
import { setLoading, setEmpty, setError, guardBtn, resultMsg } from './admin.js';

const SOURCE_KO = {
  submitScore: '🎮 게임 지급', claimDaily: '📅 출석', earlyMember: '🎁 초기 멤버',
  buySkin: '🎨 스킨 구매', buyFrame: '🖼 프레임 구매', buyBubble: '💬 말풍선 구매',
  renameEarly: '✏️ 조기 닉변', restore: '🔗 계정 합산', admin: '🛠 운영자 조정',
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
        w.earlyMemberGrantedAt ? '초기멤버 지급됨' : '',
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
    el.innerHTML = rows.map(r => logRowHtml(r, { withNick: true })).join('');
  } catch (e) { setError(el, humanError(e)); }
}

export function initJellyTab() {
  const lookupBtn = document.getElementById('jellyLookupBtn');
  lookupBtn.addEventListener('click', guardBtn(lookupBtn, lookupJelly));
  document.getElementById('jellyNick').addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupBtn.click(); });
  const adjBtn = document.getElementById('jellyAdjustBtn');
  adjBtn.addEventListener('click', guardBtn(adjBtn, adjustJelly));
  const logBtn = document.getElementById('jellyLogLoadBtn');
  logBtn.addEventListener('click', guardBtn(logBtn, loadGlobalLog));
}
