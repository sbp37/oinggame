import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../admin/js/stats.js', import.meta.url), 'utf8');

test('existing local daily stats are promoted once without rereading raw sessions', () => {
  assert.match(source, /const LS_SYNC_PREFIX = 'oeing_admin_dailystats_synced_v';/);
  assert.match(source, /if \(!lsWasSynced\(dateStr\)\) \{[\s\S]*?await setDoc\(ref, local, \{ merge: true \}\);[\s\S]*?lsMarkSynced\(dateStr\);/);
});

test('new and server-loaded daily stats are marked as synced', () => {
  assert.match(source, /if \(isValid\(existing\)\) \{[\s\S]*?lsMarkSynced\(dateStr\);/);
  assert.match(source, /await setDoc\(ref, computed\);\s*lsMarkSynced\(dateStr\);/);
});
