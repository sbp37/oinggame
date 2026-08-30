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

test('내 정보 안내와 v4.9 업데이트 내역이 새 정책을 정확히 설명한다', () => {
  assert.match(src, />레벨 안내 ⓘ<\/button>/);
  assert.match(src, /실제 플레이 시간<\/span><span class="val">2분마다 \+1 XP/);
  assert.match(src, /최고점수 보너스/);
  assert.match(src, /최고콤보 보너스/);
  assert.match(src, /기존 레벨과 XP는 절대 내려가지 않아요/);
  assert.match(src, /const UPDATE_VERSION = 'v4\.9';/);
  assert.match(src, /const SEEN_KEY = 'seenUpdate_v4\.9';/);
});

test('공개 랭킹 레벨은 v2 버전이 맞는 데이터만 표시한다', () => {
  assert.match(src, /oingLevelVersion: data\.oingLevelVersion/);
  assert.match(src, /publicVersion === OING_LEVEL_VERSION/);
});

test('모든 랭킹은 레벨과 닉네임을 같은 줄에 표시하고 부가정보를 다음 줄로 분리한다', () => {
  assert.doesNotMatch(src, /#panelRank:not\(\.all-mode\) \.oing-level-badge \{ display:none !important; \}/);
  assert.doesNotMatch(src, /\.ranking-panel \.oing-level-badge \{ display:none !important; \}/);
  assert.match(src, /<div class="podium-meta">\$\{oingLevelBadgeHtml\(entry, isMe\)\}\$\{titleBadgeP\}/);
  assert.match(src, /<div class="podium-meta">\$\{oingLevelBadgeHtml\(entry, isMe\)\}\$\{rankHotHtml\(entry\.ts\)\}/);
  assert.match(src, /<span class="rank-nick-line">\$\{oingLevelBadgeHtml\(entry, isMe\)\}<span class="rank-nick">\$\{skinnedNickHtml\(entry\.nickname, entry\.nickname\)\}<\/span><\/span>[\s\S]{0,160}<span class="rank-meta">\$\{titleHtml\}/);
  assert.match(src, /<span class="rank-nick-line">\$\{oingLevelBadgeHtml\(entry, isMe\)\}<span class="rank-nick">\$\{skinnedNickHtml\(entry\.nickname, entry\.nickname\)\}<\/span><\/span>[\s\S]{0,160}<span class="rank-meta">\$\{rankHotHtml\(entry\.ts\)\}/);
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
