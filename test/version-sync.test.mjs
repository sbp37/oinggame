// version.json 은 배포된 최신 빌드를 알려주는 유일한 근거다 — index.html 의 BUILD 와
// 어긋나면 "새 버전 나왔어요" 안내가 영영 안 뜨거나, 최신인데도 계속 뜬다.
// (2026-08-31: 옛 방식은 '새 빌드를 연 사람'이 값을 올리는 구조라, 모두가 캐시된 옛
//  화면을 보고 있으면 아무도 안내를 못 받는 닭-달걀 상태였다.)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'index.html'), 'utf8');
const build = Number((src.match(/const BUILD = (\d+);/) || [])[1]);
const ver = JSON.parse(readFileSync(join(root, 'version.json'), 'utf8'));

const checks = [
  ['index.html 에서 BUILD 를 읽음', Number.isFinite(build) && build > 0],
  ['version.json 의 build 가 BUILD 와 같음', Number(ver.build) === build],
  ['버전 확인이 캐시를 무시함', /fetch\('version\.json\?t=' \+ Date\.now\(\), \{ cache: 'no-store' \}\)/.test(src)],
  ['새로고침이 캐시를 우회함', /location\.replace\(base \+ '\?v=' \+ Date\.now\(\)\)/.test(src)],
];
let ok = true;
for (const [n, v] of checks) { if (!v) ok = false; console.log(`${v ? '✅' : '❌'} ${n}`); }
if (!ok) console.log(`\nindex.html BUILD=${build} / version.json build=${ver.build}`);
process.exit(ok ? 0 : 1);
