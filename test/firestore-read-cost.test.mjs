import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function cut(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0 && end > start, `cannot cut ${startNeedle}`);
  return source.slice(start, end);
}

test('all-time and weekly ranking loaders try one public cache document before collection fallback', () => {
  const all = cut('async function loadRankings()', '\n// ══════════════════════════════\n//  주간 랭킹');
  const week = cut('async function loadWeeklyRankings()', '\n// ══════════════════════════════\n//  메인 냥전광판');
  assert.match(all, /getDoc\(doc\(db, PUBLIC_RANK_CACHE_COLLECTION, 'all'\)\)/);
  assert.ok(all.indexOf('PUBLIC_RANK_CACHE_COLLECTION') < all.indexOf("collection(db, 'rankings')"));
  assert.match(week, /getDoc\(doc\(db, PUBLIC_RANK_CACHE_COLLECTION, `week_\$\{weekId\}`\)\)/);
  assert.ok(week.indexOf('PUBLIC_RANK_CACHE_COLLECTION') < week.indexOf("collection(db, 'weekly_rankings'"));
});

test('full skins/champions scans are fallback-only when embedded cache data is present', () => {
  assert.match(source, /if \(!_rankingsFromPublicCache\) await loadSkinsCache\(\)/);
  assert.match(source, /if \(!_weeklyRankingsFromPublicCache\) await loadSkinsCache\(\)/);
  const champions = cut('async function getChampCounts()', '\n// ══════════════════════════════\n//  순위 변동');
  assert.match(champions, /if \(_embeddedChampCounts\) return _embeddedChampCounts/);
});

test('zero-review metadata and ranking comparison metadata are cached in-session', () => {
  assert.match(source, /if \(c && c\.meta && Date\.now\(\) - c\.ts < REVIEW_META_TTL\) meta = c\.meta/);
  assert.match(source, /const RANK_META_CACHE_TTL = 5 \* 60 \* 1000/);
  assert.match(source, /const TODAY_NEW_CACHE_TTL = 5 \* 60 \* 1000/);
});

test('visit analytics avoids duplicate exit writes and caps heartbeats at two', () => {
  assert.match(source, /const VISIT_MAX_HEARTBEAT = 2/);
  assert.match(source, /if \(isExit && now - visitLastWriteAt < VISIT_EXIT_WRITE_GAP\) return/);
  assert.match(source, /const FIRST_DELAY = 90000, INTERVAL = 180000/);
});

test('linked account lastSeen write is rate-limited instead of every page load', () => {
  assert.match(source, /const LAST_SEEN_TOUCH_TTL = 6 \* 60 \* 60 \* 1000/);
  assert.match(source, /async function touchLastSeenIfDue\(\)/);
  assert.match(source, /Date\.now\(\) - last < LAST_SEEN_TOUCH_TTL/);
  const init = cut('async function initAccountSystem()', '// 연결된 계정은 서버 동기화 뒤');
  assert.match(init, /await touchLastSeenIfDue\(\)/);
});
