// 유료(현금) 결제 경로 차단 상태 검증 (node --test, 정적 검사)
//
// 사업자등록 정리 전까지 현금 결제 경로를 노출하지 않기로 함.
// 결제는 카카오페이 송금 링크(donateOverlay 안)로만 이뤄지므로, 그 오버레이로 가는
// 진입점이 전부 막혀 있어야 한다. 진입점이 하나라도 다시 열리면 이 테스트가 깨진다.
//
// ※ 코드는 지우지 않고 display:none 으로만 닫아둔 상태 — 다시 열 때는 해당 한 줄만 제거.
//   (구매 이력·보유 스킨은 서버 데이터라 이 변경과 무관하게 그대로 유지된다)
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

// 해당 id 를 가진 요소의 여는 태그 안에 display:none 이 있는지
function isHiddenById(id) {
  const i = src.indexOf(`id="${id}"`);
  assert.notEqual(i, -1, `#${id} 요소를 찾지 못함`);
  const start = src.lastIndexOf('<', i);
  const end = src.indexOf('>', i);
  return /display\s*:\s*none/.test(src.slice(start, end));
}

test('예전 스킨샵 자리의 젤리 입구는 초기 깜빡임 없이 JS 게이트로만 열린다', () => {
  assert.ok(isHiddenById('supportTopBtn'), '초기 마크업은 숨겨 앱·로딩 중 노출을 막아야 함');
  assert.match(src, /const ENABLE_JELLY_SHOP = true;/, '웹 젤리샵 오픈 플래그가 켜져야 함');
  assert.match(src, /if \(ENABLE_JELLY_SHOP && !IS_APP\)[\s\S]{0,220}supportTopBtn[\s\S]{0,120}inline-flex/,
    '웹에서만 예전 스킨샵 자리의 버튼을 표시해야 함');
  assert.match(src, /supportTopBtn'\)\.addEventListener\('click', openJellyShop\)/,
    '상단 젤리 잔액을 누르면 젤리샵으로 가야 함');
  assert.match(src, /if \(isUidLinked\(\)\)[\s\S]{0,4200}await loadJellyBalance\(\)[\s\S]{0,220}return;/,
    '이미 연결된 기존 유저도 인증 뒤 서버 지갑 잔액으로 다시 확정해야 함');
});

test('젤리샵 안 서포터팩(990원) 박스가 숨겨져 있다', () => {
  // 상점 안 유료 박스 자체도 숨겨야 간접 진입 회귀가 생겨도 결제 경로가 열리지 않는다
  const i = src.indexOf('class="jshop-support-box"');
  assert.notEqual(i, -1, '서포터팩 박스를 찾지 못함');
  const end = src.indexOf('>', i);
  assert.ok(/display\s*:\s*none/.test(src.slice(i, end)), '서포터팩 박스가 열려 있으면 안 됨');
});

test('중복 젤리샵 진입 버튼들은 숨기고 상단 잔액 입구 하나만 쓴다', () => {
  for (const id of ['jellyShopBtn', 'jellyBalanceBtn', 'skinOpenBtn']) {
    assert.ok(isHiddenById(id), `#${id} 이 열려 있으면 안 됨`);
  }
});

test('상점 진입·구매 함수의 이중 게이트는 오픈 후에도 유지한다', () => {
  assert.match(src, /if \(!text && !ENABLE_JELLY_SHOP\) return '';/,
    '상점 비활성 시 +말풍선을 렌더하지 않아야 함');
  assert.match(src, /if \(!ENABLE_JELLY_SHOP && !JSHOP_PREVIEW\) return;/,
    'openJellyShop 자체에도 이중 게이트가 있어야 함');
  assert.match(src, /if \(!ENABLE_JELLY_SHOP \|\| jshopPreviewBlocked\(\)\) return;/,
    '구매 함수도 상점 오픈 전 호출을 거부해야 함');
});

test('수동 오늘의 젤리 버튼은 숨김·비활성 상태다', () => {
  assert.ok(isHiddenById('jshopClaimBtn'), '수동 출석 버튼은 보여서는 안 됨');
  const i = src.indexOf('id="jshopClaimBtn"');
  const start = src.lastIndexOf('<', i);
  const end = src.indexOf('>', i);
  assert.match(src.slice(start, end), /disabled/, '수동 출석 버튼은 비활성이어야 함');
  assert.doesNotMatch(src, /callShopAction\('claimDaily'\)/, '클라이언트에서 수동 출석 지급을 호출하면 안 됨');
});

test('결제 링크는 donateOverlay 안에만 있고, 그 오버레이는 기본 숨김', () => {
  const links = [...src.matchAll(/qr\.kakaopay\.com/g)];
  assert.ok(links.length > 0, '결제 링크가 아예 없으면 이 테스트는 의미 없음(구조 변경 확인 필요)');
  const ovStart = src.indexOf('<div id="donateOverlay"');
  assert.notEqual(ovStart, -1, 'donateOverlay 를 찾지 못함');
  const ovTagEnd = src.indexOf('>', ovStart);
  assert.ok(/display\s*:\s*none/.test(src.slice(ovStart, ovTagEnd)), 'donateOverlay 는 기본 숨김이어야 함');
  // 모든 결제 링크가 donateOverlay 시작 이후에 위치(= 그 안에 들어있음)
  const nextOverlay = src.indexOf('class="overlay"', ovTagEnd);
  for (const m of links) {
    assert.ok(m.index > ovStart && m.index < nextOverlay,
      '결제 링크가 donateOverlay 밖에 노출되어 있으면 안 됨');
  }
});

test('openDonateOverlay 호출부는 숨겨진 두 버튼뿐', () => {
  const calls = [...src.matchAll(/openDonateOverlay\(\)/g)];
  // 함수 정의 1 + 호출 2 (supportTopBtn, jshopSupportBtn) = 3 이하로 유지
  assert.ok(calls.length <= 3,
    `openDonateOverlay 호출 지점이 늘어남(${calls.length}) — 새 진입점이 생겼는지 확인 필요`);
});

test('독립 커스텀 미리보기는 기본 URL에서 실제 결제를 차단한다', () => {
  const custom = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'custom-shop-preview.html'), 'utf8');
  assert.match(custom, /const checkoutMode=params\.get\('checkout'\)==='1'/,
    '운영 모드 여부를 명시적으로 계산해야 함');
  assert.match(custom, /if\(!checkoutMode\)/,
    '명시적 운영 모드가 아니면 결제를 막아야 함');
  assert.doesNotMatch(custom, /data-frame-key="crown"/,
    '황금왕관은 젤리 전용이므로 유료 신규 선택지에 있으면 안 됨');
  assert.doesNotMatch(custom, /data-cat-key="mint"[^}]*scaleX\(/,
    '민트냥만 가로로 늘려 비율을 찌그러뜨리면 안 됨');
  assert.match(custom, /data-cat-key="mint"[^}]*scale\(1\.08\)/,
    '민트냥은 다른 고양이와 같은 비율로만 크기를 보정해야 함');
  assert.match(src, /주문해줘서 고맙다냥!/,
    '결제 복귀 후 주문 접수 성공 화면에 감사 문구가 보여야 함');
});

test('젤리샵의 커스텀샵 링크는 미리보기 안전 모드를 유지한다', () => {
  const preview = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'shop-v2-preview.html'), 'utf8');
  assert.match(preview, /const ENABLE_LIVE_SHOP = true;/,
    '독립 젤리샵 운영 플래그가 켜져야 함');
  assert.match(preview, /custom-shop-preview\.html\?preview=1/,
    '정적 링크가 커스텀 미리보기 안전 모드를 유지해야 함');
  assert.match(preview, /preview:'1'/,
    '실제 프로필 query를 붙일 때도 미리보기 안전 모드를 유지해야 함');
});

test('젤리샵은 글자색·효과를 닉네임 한 카테고리로 보여준다', () => {
  const preview = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'shop-v2-preview.html'), 'utf8');
  assert.match(preview, /data-tab="nick">닉네임<\/button>/);
  assert.doesNotMatch(preview, /data-tab="(?:color|fx)"/);
  assert.match(preview, /nicknameSectionHtml\(nicknameEntries\(\)\)/,
    '전체 화면에서도 단색과 효과를 한 닉네임 섹션으로 묶어야 함');
});

test('구매 프레임은 등급 바를 덮지 않고 내 랭킹에 두 겹 선을 만들지 않는다', () => {
  assert.doesNotMatch(src, /\.rank-row\[class\*="frame-"\]::before/,
    '프레임이 ::before를 쓰면 Top10·Top30 등급 바와 충돌함');
  assert.match(src, /\.rank-row\.me\[class\*="frame-"\]::after\s*\{\s*content\s*:\s*none/,
    '내 랭킹은 기존 하늘색 링을 끄고 구매 프레임 외곽 효과만 보여야 함');
  assert.match(src, /0 0 13px color-mix\(/,
    '구매 프레임 효과는 기본 테두리 바깥 글로우로 표현해야 함');
});
