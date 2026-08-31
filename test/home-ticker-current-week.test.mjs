import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const initStart = source.indexOf('async function initHomeTicker()');
const initEnd = source.indexOf('\nsetTimeout(initHomeTicker', initStart);
const initSource = source.slice(initStart, initEnd);

test('웹 전광판은 이번 주 랭킹만 읽고 전체·지난주 기록을 섞지 않는다', () => {
  assert.ok(initStart >= 0 && initEnd > initStart, 'initHomeTicker source must exist');
  assert.match(initSource, /loadWeeklyRankings\(\)/);
  assert.doesNotMatch(initSource, /loadRankings\(\)/);
  assert.doesNotMatch(initSource, /updateHomeTickerFromRankingRows\([^\n]*['"]all['"]/);
  assert.match(initSource, /_homeTickerAllTime\s*=\s*\[\]/);
});

test('전광판의 주간 문구는 현재 주차 데이터라는 계약을 명시한다', () => {
  assert.match(source, /weekly_rankings\/\{현재 weekId\}/);
  assert.match(source, /이번 주 1위/);
});

test('전광판은 긴 주간 문구도 답답하지 않은 속도로 흐른다', () => {
  assert.match(source, /first\.scrollWidth\s*\/\s*46/);
  assert.match(source, /Math\.max\(13,/);
});
