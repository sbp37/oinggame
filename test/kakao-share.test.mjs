import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('카카오 점수 공유는 공식 SDK를 웹에서만 지연 로드한다', () => {
  assert.match(src, /const KAKAO_SHARE_JS_KEY = '[a-f0-9]{32}';/);
  assert.match(src, /https:\/\/t1\.kakaocdn\.net\/kakao_js_sdk\/2\.8\.2\/kakao\.min\.js/);
  assert.match(src, /const KAKAO_SHARE_SDK_INTEGRITY = 'sha384-[^']+';/);
  assert.match(src, /function loadKakaoShareSdk\(\) \{[\s\S]*?if \(IS_APP\) return Promise\.resolve\(null\);/);
  assert.match(src, /function tryKakaoScoreShare\(finalScore, gameUrl\) \{[\s\S]*?if \(IS_APP\) return false;/);
});

test('카카오 공유 카드는 점수·썸네일·추천 링크·도전 버튼을 담는다', () => {
  assert.match(src, /kakao\.Share\.sendDefault\(\{/);
  assert.match(src, /title: `오잉게임 — \$\{formattedScore\}점! 이길 수 있냥\?`/);
  assert.match(src, /imageUrl: 'https:\/\/oinggame\.com\/share-thumbnail\.jpg'/);
  assert.match(src, /title: '도전하기'/);
  assert.match(src, /mobileWebUrl: gameUrl/);
  assert.match(src, /https:\/\/oinggame\.com\/\?r=\$\{code\}/);
});

test('카카오 SDK를 못 쓰면 기존 공유 경로를 유지한다', () => {
  assert.match(src, /const sharedWithKakao = await tryKakaoScoreShare\(score, gameUrl\);/);
  assert.match(src, /if \(!sharedWithKakao && navigator\.share\)/);
  assert.match(src, /else if \(!sharedWithKakao && navigator\.clipboard\)/);
});

test('추천코드 생성 실패 시에도 기본 주소로 공유를 계속한다', () => {
  assert.match(src, /let gameUrl = 'https:\/\/oinggame\.com\/';/);
  assert.match(src, /try \{[\s\S]*?await getOrCreateRefCode\(myNickForShare\)[\s\S]*?\} catch \(e\) \{[\s\S]*?기본 링크로 공유/);
});
