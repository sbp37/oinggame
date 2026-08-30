import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const handlerStart = src.indexOf("document.getElementById('shareResultBtn').addEventListener");
const handlerEnd = src.indexOf('// 닉네임 변경', handlerStart);
const handler = src.slice(handlerStart, handlerEnd);

test('점수 공유는 카카오 SDK 로그인 대신 기기 공유창을 사용한다', () => {
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'share handler not found');
  assert.match(handler, /if \(navigator\.share\)/);
  assert.match(handler, /await navigator\.share\(\{ title: '오잉 도전장', text: shareText, url: gameUrl \}\)/);
  assert.doesNotMatch(src, /KAKAO_SHARE_JS_KEY|Kakao\.Share\.sendDefault|kakao_js_sdk/);
});

test('공유 주소는 추천코드와 새 미리보기 캐시 키를 함께 전달한다', () => {
  assert.match(handler, /let gameUrl = 'https:\/\/oinggame\.com\/\?share=v3';/);
  assert.match(handler, /https:\/\/oinggame\.com\/\?r=\$\{code\}&share=v3/);
  assert.match(handler, /Number\(score \|\| 0\)\.toLocaleString\('ko-KR'\)/);
});

test('공유 문구는 점수·2분·도전 행동을 짧게 강조한다', () => {
  assert.match(handler, /🐱 나 \$\{Number\(score \|\| 0\)\.toLocaleString\('ko-KR'\)\}점! 2분 안에 이길 수 있냥\?/);
  assert.match(handler, /바로 한 판 붙어보자 👇/);
  assert.match(src, /<meta property="og:title" content="오잉 도전장 도착! 🐱">/);
  assert.match(src, /<meta property="og:description" content="딱 2분! 숫자를 묶어 합10을 만들고 친구 점수를 넘어보라냥 🐾">/);
});

test('추천코드 생성 실패 시에도 기본 주소로 공유를 계속한다', () => {
  assert.match(handler, /try \{[\s\S]*?await getOrCreateRefCode\(myNickForShare\)[\s\S]*?\} catch \(e\) \{[\s\S]*?기본 링크로 공유/);
  assert.match(handler, /else if \(navigator\.clipboard\)/);
});

test('카카오 링크 미리보기에 실제 썸네일 비율을 명시한다', () => {
  assert.match(src, /<meta property="og:image" content="https:\/\/oinggame\.com\/share-thumbnail\.jpg">/);
  assert.match(src, /<meta property="og:image:width" content="1200">/);
  assert.match(src, /<meta property="og:image:height" content="630">/);
  assert.match(src, /<meta property="og:image:type" content="image\/jpeg">/);
});
