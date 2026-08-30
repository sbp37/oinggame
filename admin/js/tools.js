// ══════════════════════════════════════════════════════════════
//  tools.js — 🛠 관리 (2026-08-30 정리)
//  가끔 쓰는 "도구"를 접이식(아코디언)으로 모은다. 전부 기본 접힘.
//   · 🎁 유저에게 보내기 — rewards.js (조회 0)
//   · 🍮 젤리 관리 — jelly.js (버튼 클릭 시에만 조회)
//   · 🛡 보안 도구 — security.js (버튼 클릭 시에만 조회)
//  마지막으로 연 아코디언은 localStorage로 기억(선택 편의).
//  ※ 게임 운영·백업/위험 아코디언은 제거됐고, 리뷰 관리는 처리함으로 이관됐다.
// ══════════════════════════════════════════════════════════════
import { initRewardsTab } from './rewards.js';
import { initJellyTab } from './jelly.js';
import { initSecurityTab } from './security.js';

const LAST_ACC_KEY = 'admin_last_acc';

export function initToolsTab() {
  // 바인딩은 1회 — Firestore 조회 없음 (init들은 전부 버튼 바인딩만 한다)
  initRewardsTab();
  initJellyTab();
  initSecurityTab();

  // 마지막으로 연 아코디언 기억
  document.querySelectorAll('#tab-tools .tool-acc').forEach(acc => {
    acc.addEventListener('toggle', () => {
      if (acc.open) { try { localStorage.setItem(LAST_ACC_KEY, acc.id); } catch {} }
    });
  });
  try {
    const last = localStorage.getItem(LAST_ACC_KEY);
    if (last) { const acc = document.getElementById(last); if (acc) acc.open = true; }
  } catch {}
}

// 관리 탭 진입 자체는 조회 0 — 데이터는 버튼을 눌러야만 불러온다.
export async function loadTools() {}

// 배지/할 일에서 바로 진입 — 해당 아코디언을 펼치고 화면에 보이게 스크롤
export function openToolAcc(accId) {
  const acc = document.getElementById(accId);
  if (!acc) return;
  acc.open = true;
  acc.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
