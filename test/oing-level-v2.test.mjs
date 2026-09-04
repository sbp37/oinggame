import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('레벨 v2 계약·점수·콤보 표가 서버 계약과 맞는 값으로 고정돼 있다', () => {
  assert.match(src, /const OING_LEVEL_VERSION = 2;/);
  assert.match(src, /oing-level-v2-score800-combo200-time120-cap15-gates0/);
  assert.match(src, /const OING_SCORE_TIER = \[\[200000,800\].*\[1000,30\]\]/s);
  assert.match(src, /const OING_COMBO_TIER = \[\[500,200\].*\[20,10\]\]/s);
});

test('숫자 레벨은 하드 게이트 없이 XP 레벨을 그대로 사용한다', () => {
  assert.match(src, /function oingGatedLevel\(xpLv, _d\) \{ return \{ lv: xpLv, blockedBy: null \}; \}/);
  assert.doesNotMatch(src, /const OING_GATES\s*=/);
});

test('실제 플레이 시간과 v2 계약이 모든 점수 payload에 포함된다', () => {
  assert.match(src, /activePlayMs: _finalActivePlayMs \|\| _shadowActivePlayMs\(\)/);
  assert.match(src, /levelVersion: OING_LEVEL_VERSION/);
  assert.match(src, /data\.levelContract === OING_LEVEL_CONTRACT/);
  assert.match(src, /const PLAY_XP_CAP = 15;/);
});

test('승급 팝업·이유 토글·접속 판정·무저장 미리보기 흐름이 연결돼 있다', () => {
  for (const id of ['oingLevelUpOverlay', 'oingLevelUpToggle', 'oingLevelUpReasons', 'oingLevelUpOk']) {
    assert.match(src, new RegExp(`id="${id}"`));
  }
  assert.match(src, /maybeCelebrateOingLevelUp\(mergedStats, null, 'login'\)/);
  assert.match(src, /previewLevelUp/);
  assert.match(src, /preview: true/);
});

test('내 정보 안내와 최신 업데이트 내역이 새 정책을 정확히 설명한다', () => {
  assert.match(src, />레벨 안내 ⓘ<\/button>/);
  assert.match(src, /점수나 판수만 보지 않고,/);
  assert.match(src, /플레이·기록·꾸준함으로 성장해요/);
  assert.match(src, /실제 플레이 시간<\/span><span class="val">2분마다 \+1 XP/);
  assert.match(src, /최고점수 보너스/);
  assert.match(src, /최고콤보 보너스/);
  assert.match(src, /메인과 내 정보의 <b>버튼·카드 대비<\/b>를 높이고 안내 문구를 간결하게/);
  assert.match(src, /기존 레벨과 XP는 절대 내려가지 않아요/);
  // 업데이트 버전은 릴리스마다 오르므로 값을 고정하지 않고, 표시 버전과 NEW 뱃지 저장키가
  // 서로 같은 버전을 가리키는지만 본다(둘이 어긋나면 NEW 뱃지가 영영 안 사라진다).
  const shown = src.match(/const UPDATE_VERSION = 'v([\d.]+)';/);
  const seen = src.match(/const SEEN_KEY = 'seenUpdate_v([\d.]+)';/);
  assert.ok(shown && seen, 'UPDATE_VERSION / SEEN_KEY 를 찾지 못함');
  assert.equal(shown[1], seen[1], 'UPDATE_VERSION 과 SEEN_KEY 버전이 달라요');
});

test('메인·내 정보 버튼과 카드 대비를 높이고 레벨 안내 버튼은 얇게 유지한다', () => {
  assert.match(src, /id="startRankBtn"[\s\S]{0,260}width: 92%;[\s\S]{0,260}border: 1\.5px solid rgba\(126,194,240,0\.52\)/);
  assert.match(src, /\.review-entry-chip \{[\s\S]{0,260}border: 1px solid rgba\(246,196,83,0\.32\)/);
  assert.match(src, /\.myinfo-chip \{[\s\S]{0,260}border: 1px solid rgba\(126,194,240,0\.34\)/);
  assert.match(src, /\.myi-lv-info \{[\s\S]{0,500}min-height: 32px/);
  assert.match(src, /#myInfoOverlay > \.overlay-card \{[\s\S]{0,220}border-color: rgba\(126,194,240,0\.48\)/);
  assert.match(src, /body:not\(\.light\) \.oing-lv-pop-card \{[\s\S]{0,180}border-color: rgba\(126,194,240,0\.48\)/);
  assert.match(src, /오늘 시간 XP/);
  assert.doesNotMatch(src, /오늘 플레이 XP <b>.*실제 플레이 2분마다/);
});

test('공개 랭킹 레벨은 v2 버전이 맞는 데이터만 표시한다', () => {
  assert.match(src, /oingLevelVersion: data\.oingLevelVersion/);
  assert.match(src, /publicVersion === OING_LEVEL_VERSION/);
});

test('모든 랭킹은 레벨·닉네임·왕관·불꽃을 같은 줄에 표시한다', () => {
  assert.doesNotMatch(src, /#panelRank:not\(\.all-mode\) \.oing-level-badge \{ display:none !important; \}/);
  assert.doesNotMatch(src, /\.ranking-panel \.oing-level-badge \{ display:none !important; \}/);
  assert.match(src, /<div class="podium-meta">\$\{oingLevelBadgeHtml\(entry, isMe\)\}\$\{titleBadgeP\}/);
  assert.match(src, /<div class="podium-meta">\$\{oingLevelBadgeHtml\(entry, isMe\)\}\$\{rankHotHtml\(entry\.ts\)\}/);
  assert.match(src, /<span class="rank-nick-line">\$\{oingLevelBadgeHtml\(entry, isMe\)\}<span class="rank-nick">\$\{skinnedNickHtml\(entry\.nickname, entry\.nickname\)\}<\/span>\$\{titleHtml\}\$\{rankHotHtml\(entry\.ts\)\}<\/span>/);
  assert.match(src, /<span class="rank-nick-line">\$\{oingLevelBadgeHtml\(entry, isMe\)\}<span class="rank-nick">\$\{skinnedNickHtml\(entry\.nickname, entry\.nickname\)\}<\/span>\$\{rankHotHtml\(entry\.ts\)\}<\/span>/);
  // 닉네임 크기는 운영 피드백에 따라 계속 조정되므로 값을 박지 않고 '범위'만 고정한다.
  //  · 원래 14.5px → "작아 보인다"(2026-09-04) → 16~17.5px → "너무 커졌다"(같은 날) → 15.2~16.4px.
  // 위아래를 다 막아 둔다: 원래만큼 작아져도, 지나치게 커져도 여기서 걸린다.
  {
    const m = src.match(/\.rank-identity \.rank-nick \{[^}]*font-size:clamp\(([\d.]+)px, ([\d.]+)vw, ([\d.]+)px\)/);
    assert.ok(m, '랭킹 닉네임은 화면 폭에 따라 늘어나는 clamp 크기여야 한다');
    const [min, , max] = [Number(m[1]), Number(m[2]), Number(m[3])];
    assert.ok(min > 14.5, `닉네임 최소 크기가 ${min}px — 키우기 전(14.5px)으로 되돌아갔다`);
    assert.ok(max >= 16 && max <= 17, `닉네임 최대 크기가 ${max}px — 16~17px 사이여야 한다`);
  }
  // 30위 밖(Top10/Top30 배지가 없는) 행 테두리 — "넘 안 보인다"(2026-09-04).
  // 색 값을 박으면 톤을 못 바꾸므로, 어두운 배경 위에서 실제로 구분되는 밝기인지만 잰다.
  // 옛 값 rgba(47,126,201,0.22) 는 유효 밝기 25 로 여기서 떨어진다.
  {
    const m = src.match(/\.rank-row \{[\s\S]*?border: 1px solid rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
    assert.ok(m, '.rank-row 기본 테두리 선언을 찾지 못했다');
    const [r, g, b, a] = m.slice(1).map(Number);
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
    assert.ok(lum >= 45, `등급 없는 행 테두리 유효 밝기가 ${lum.toFixed(1)} — 30위 아래 행이 배경에 묻힌다`);
  }
  assert.match(src, /\.rank-nick-line \.oing-level-badge \{[^}]*font-size:9\.5px/);
  assert.match(src, /<span class="rank-tail">\$\{badgeHtml\}[\s\S]{0,180}<span class="rank-pts">/);
  assert.match(src, /#panelRank \.podium-nick-text \{ overflow:visible; text-overflow:clip; \}/);
});

test('레거시 계정도 접속 승급을 확인하고 미리보기·앱은 운영 빌드 번호를 쓰지 않는다', () => {
  assert.match(src, /await initAccountSystem\(\)[\s\S]{0,220}maybeCelebrateOingLevelUp\(getMyOingProfileSnapshot\(\)\.stats, null, 'login'\)/);
  assert.match(src, /async function checkForNewVersion\(\) \{[\s\S]{0,260}if \(IS_APP\) return;/);
  assert.match(src, /hostname === 'oinggame\.com'[\s\S]{0,180}hostname === 'www\.oinggame\.com'/);
  assert.match(src, /BUILD > serverBuild && canPublishBuild/);
});

test('승급 팝업은 밝은 테마에서도 읽히고 폭죽이 카드 아래에 있으며 Lv.1~20 조건을 모두 보여준다', () => {
  assert.match(src, /body\.light \.oing-levelup-reason \{ color: #3b3328; \}/);
  assert.match(src, /burstConfetti\(1, overlay\)/);
  const tierRows = src.match(/class="lv-pop-row" data-min="\d+" data-max="\d+"/g) || [];
  assert.equal(tierRows.length, 20);
  assert.match(src, /Lv\.19 전설의 오잉러<\/span><span class="val">6,450 XP/);
});
