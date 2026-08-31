import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../shop-v2-preview.html', import.meta.url), 'utf8');

test('추천코드는 클라이언트 Firestore 쓰기가 아니라 서버 callable로 자동 발급한다', () => {
  assert.match(source, /callReferralAction\('getCode'\)/);
  assert.doesNotMatch(source, /setDoc\(\s*doc\(db,\s*['"]ref_codes['"]/);
  assert.doesNotMatch(source, /setDoc\(\s*ref,\s*\{\s*nickname\s*\}/);
});

test('초대코드는 서버 귀속 전까지 보관하고 네트워크 실패 시 재시도한다', () => {
  assert.match(source, /REFERRAL_PENDING_KEY/);
  assert.match(source, /callReferralAction\('capture',\s*\{\s*code\s*\}\)/);
  assert.match(source, /다음 접속에 다시 시도/);
});

test('accepted 판 뒤 서버가 보상을 확인하고 양쪽 +5 팝업을 표시한다', () => {
  assert.match(source, /data\.decision === 'accepted'/);
  assert.match(source, /callReferralAction\('claim'\)/);
  assert.match(source, /callReferralAction\('poll'\)/);
  assert.match(source, /callReferralAction\('ack',\s*\{\s*version\s*\}\)/);
  // 문구는 REFERRAL_REWARD 상수를 박아 쓴다 — 서버 보상(5)과 어긋나면 여기서 걸린다.
  assert.match(source, /const REFERRAL_REWARD = 5;/);
  assert.match(source, /나와 친구 모두 🍮 \+\$\{REFERRAL_REWARD\}/);
  assert.match(source, /친구도 각각 \+\$\{REFERRAL_REWARD\}/);
});

test('젤리샵은 친구 초대 조건과 양쪽 +5, 자동 링크 버튼을 명확히 보여준다', () => {
  for (const html of [source, preview]) {
    assert.match(html, /친구 초대/);
    assert.match(html, /둘 다 \+5|나와 친구 모두/);
  }
  // 초대 입구: 게임은 공유/초대 플로우(shareFriendInvite + 공유 링크의 ?r=), 상점 페이지는 inviteBtn.
  // 옛 오버레이의 jshopInviteBtn 은 오버레이 제거(2026-08-31 검수)와 함께 사라졌다.
  assert.match(source, /shareFriendInvite/);
  assert.match(source, /\?r=\$\{encodeURIComponent\(code\)\}/);
  assert.match(preview, /id="inviteBtn"/);
});
