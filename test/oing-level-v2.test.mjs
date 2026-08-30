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
