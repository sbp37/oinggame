import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adsTxt = fs.readFileSync(new URL('../ads.txt', import.meta.url), 'utf8');

test('AdSense 소유권 메타 태그가 발급된 게시자 ID와 일치한다', () => {
  assert.match(html, /<meta name="google-adsense-account" content="ca-pub-9269666926580954">/);
});

test('ads.txt가 AdSense에서 발급한 한 줄과 정확히 일치한다', () => {
  assert.equal(adsTxt, 'google.com, pub-9269666926580954, DIRECT, f08c47fec0942fa0\n');
});

test('심사 전에는 웹 AdSense 광고 로더를 미리 넣지 않는다', () => {
  assert.doesNotMatch(html, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
});
