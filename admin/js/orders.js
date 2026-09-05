// ══════════════════════════════════════════════════════════════
//  orders.js — 카카오페이 수동 확인 커스텀 주문함
//  QR 결제는 webhook이 없으므로 주문 접수와 입금 확인을 분리한다.
//  운영자가 실제 입금내역을 확인한 뒤 서버 함수로 발송하면 소유권·장착·도착 팝업이
//  한 트랜잭션에서 함께 적용된다.
// ══════════════════════════════════════════════════════════════
import {
  db, fns, collection, getDocs, query, orderBy, limit, httpsCallable,
  escapeHtml, humanError,
} from './firebase.js';
import { guardBtn, resultMsg } from './admin.js';

const STATUS_LABEL = {
  pending: '입금 확인 대기',
  fulfilled: '발송 완료',
  cancelled: '취소',
};
let wired = false;

function formatTime(ms) {
  const n = Number(ms || 0);
  if (!n) return '-';
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
    }).format(new Date(n));
  } catch { return new Date(n).toLocaleString(); }
}

function renderOrders(docs) {
  const box = document.getElementById('customOrdersResult');
  if (!box) return;
  if (!docs.length) {
    box.innerHTML = '<div class="empty">접수된 주문이 없어요.</div>';
    return;
  }
  box.innerHTML = docs.map(snap => {
    const d = snap.data() || {};
    const status = ['pending','fulfilled','cancelled'].includes(d.status) ? d.status : 'pending';
    const detail = d.orderType === 'cat'
      ? `고양이 · ${d.catSkinName || d.label || '-'}`
      : d.orderType === 'bundle'
        ? `모두 담기 · ${d.effectName || '-'} + ${d.frameName || '-'} + ${d.catSkinName || '-'}`
        : `꾸미기 세트 · ${d.effectName || '-'} + ${d.frameName || '-'}`;
    return `<article class="custom-order-item" data-order-id="${escapeHtml(snap.id)}">
      <div class="custom-order-top">
        <span class="custom-order-user">${escapeHtml(d.nickname || '(닉네임 연결 전)')}</span>
        <span class="custom-order-status ${status}">${STATUS_LABEL[status] || status}</span>
        ${String(d.source || '').startsWith('play-billing') ? '<span class="custom-order-source">▶ Play 결제' + (d.source === 'play-billing' ? ' · 자동발송' : ' · 결제대기') + '</span>' : ''}
      </div>
      <div class="custom-order-choice">${escapeHtml(detail)}</div>
      <div class="custom-order-meta">${Number(d.price || 0).toLocaleString()}원 · ${escapeHtml(formatTime(d.createdAt))}<br>UID ${escapeHtml(d.uid || '-')}<br>주문번호 ${escapeHtml(snap.id)}</div>
      ${status === 'pending' ? `<div class="custom-order-actions">
        <button class="btn btn-primary btn-sm" data-order-action="fulfill">입금 확인·발송</button>
        <button class="btn btn-ghost btn-sm" data-order-action="cancel">취소</button>
      </div>` : ''}
    </article>`;
  }).join('');
}

export async function loadCustomOrders() {
  const box = document.getElementById('customOrdersResult');
  if (box) box.innerHTML = '<div class="loading">주문을 불러오는 중…</div>';
  try {
    const snap = await getDocs(query(collection(db, 'custom_orders'), orderBy('createdAt', 'desc'), limit(50)));
    renderOrders(snap.docs);
  } catch (e) {
    if (box) box.innerHTML = `<div class="empty">${escapeHtml(humanError(e))}</div>`;
  }
}

async function actOnOrder(button, action) {
  const item = button.closest('[data-order-id]');
  const orderId = item && item.dataset.orderId;
  if (!orderId) return;
  if (action === 'fulfill') {
    if (!confirm('카카오페이 입금내역을 실제로 확인했나요?\n확인했다면 선택한 꾸미기를 바로 발송합니다.')) return;
  } else if (!confirm('이 주문을 취소할까요?')) return;
  const callable = httpsCallable(fns, 'shopAction');
  const serverAction = action === 'fulfill' ? 'adminFulfillCustomOrder' : 'adminCancelCustomOrder';
  try {
    await callable({ action: serverAction, orderId });
    resultMsg('customOrdersResultMsg', action === 'fulfill' ? '발송했어요. 유저의 다음 접속 때 도착 팝업이 떠요.' : '주문을 취소했어요.');
    await loadCustomOrders();
  } catch (e) {
    resultMsg('customOrdersResultMsg', humanError(e), false);
  }
}

export function initCustomOrdersUI() {
  if (wired) return;
  wired = true;
  const loadBtn = document.getElementById('customOrdersLoadBtn');
  if (loadBtn) loadBtn.addEventListener('click', guardBtn(loadBtn, loadCustomOrders));
  const box = document.getElementById('customOrdersResult');
  if (box) box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-order-action]');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    actOnOrder(btn, btn.dataset.orderAction).finally(() => { btn.disabled = false; });
  });
}
