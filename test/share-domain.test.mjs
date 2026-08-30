import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('점수·랭킹 공유 링크와 랭킹 카드 푸터가 새 도메인을 사용한다', () => {
  assert.match(src, /let gameUrl = 'https:\/\/oinggame\.com\/\?share=v2'/);
  assert.match(src, /const SHARE_LINK = 'https:\/\/oinggame\.com\/'/);
  assert.match(src, /ctx\.fillText\('oinggame\.com', W \/ 2, H - 26\)/);
  assert.doesNotMatch(src, /ctx\.fillText\('sbp37\.github\.io\/oing'/);
});
