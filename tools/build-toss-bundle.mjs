#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  build-toss-bundle.mjs — 앱인토스 아티팩트에 담을 파일만 toss-dist/ 로 모은다.
//
//  토스 번들은 압축 해제 기준 100MB 이하여야 하고, 무엇보다 게임과 무관한 파일
//  (어드민 대시보드·테스트·검색엔진용 부속 파일)이 들어가면 심사에서 문제가 된다.
//  그래서 "게임이 돌아가는 데 실제로 필요한 것"만 화이트리스트로 옮긴다.
//
//  실행: npm run toss:build  (이 스크립트 → ait build 순서로 돈다)
// ══════════════════════════════════════════════════════════════
import { cp, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'toss-dist');

// 게임이 실행 중에 실제로 불러오는 것들
const FILES = [
  'index.html',        // 게임 본체
  'version.json',      // 빌드 번호 확인
  'manifest.json',
  'sw.js',             // 캐싱 안 하는 최소 서비스워커
  'app-bridge.js',     // 상점 페이지가 읽는 플랫폼 브리지
  'bgm.mp3',
  'icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  // 게임 안에서 이동하는 페이지들
  'shop-v2-preview.html', 'custom-shop-preview.html', 'tip-1.html', 'reset-device.html',
  // 약관·개인정보(심사에서 요구) + 그 페이지들의 메뉴가 가리키는 안내 페이지
  'terms.html', 'privacy.html',
  'guide.html', 'about.html', 'faq.html', 'updates.html', 'ranking.html',
  'levels.html', 'goals.html', 'jelly.html',
  'tips-combo.html', 'tips-wow.html', 'tips-allclear.html', '404.html',
];
const DIRS = ['assets'];

// 절대 들어가면 안 되는 것 — 확인용으로 이름을 박아 둔다
const MUST_NOT_SHIP = ['admin', 'test', 'node_modules', '.git', 'ads.txt', 'robots.txt', 'sitemap.xml', 'CNAME'];

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const missing = [];
for (const f of FILES) {
  const src = path.join(ROOT, f);
  if (!existsSync(src)) { missing.push(f); continue; }
  await cp(src, path.join(OUT, f));
}
for (const d of DIRS) {
  const src = path.join(ROOT, d);
  if (!existsSync(src)) { missing.push(d + '/'); continue; }
  await cp(src, path.join(OUT, d), { recursive: true });
}

if (missing.length) {
  console.error('❌ 번들에 넣을 파일이 없다:', missing.join(', '));
  process.exit(1);
}
for (const bad of MUST_NOT_SHIP) {
  if (existsSync(path.join(OUT, bad))) {
    console.error(`❌ 번들에 들어가면 안 되는 게 들어갔다: ${bad}`);
    process.exit(1);
  }
}
if (!existsSync(path.join(OUT, 'index.html'))) {
  console.error('❌ index.html 이 없으면 ait build 가 실패한다');
  process.exit(1);
}

const bytes = await dirSize(OUT);
const mb = bytes / 1024 / 1024;
console.log(`toss-dist/ 준비 완료 — ${(await readdir(OUT)).length}개 항목 · ${mb.toFixed(1)}MB`);
if (mb > 100) {
  console.error('❌ 100MB 를 넘으면 토스 콘솔이 업로드를 거부한다');
  process.exit(1);
}
