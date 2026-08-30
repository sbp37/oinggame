// ══════════════════════════════════════════════════════════════
//  admin-undef-check.mjs — 어드민 모듈의 "미정의 상수 참조" 정적 검사
//
//  왜 필요한가: 어드민 화면은 로그인 게이트 뒤에 있어서, 코드 일부를 지울 때
//  같이 딸려 나간 상수를 배포 전에 알아채기 어렵다. 실제로 2026-08-30 고득점
//  세션 목록을 제거하면서 바로 아래 있던 VERDICT_DECISIONS 정의까지 함께
//  지워져 '점수 검토' 화면이 통째로 깨진 적이 있다(문법은 멀쩡해서
//  node --check 로는 안 잡혔다).
//
//  검사 대상은 UPPER_SNAKE 상수만 — 함수 매개변수·지역변수까지 추적하지 않아도
//  "삭제하다 딸려 나간 모듈 상수"라는 실제 사고 유형을 정확히 잡아낸다.
//  실행: node test/admin-undef-check.mjs   (종료코드 1이면 미정의 참조 있음)
// ══════════════════════════════════════════════════════════════
import fs from 'fs';

const JS_DIR = new URL('../admin/js/', import.meta.url);

// 문자열·템플릿·주석을 제거한다. 정규식 한 방으로는 템플릿 안의 ${} 중첩을 못 다뤄
// 한글 문구 속 단어(예: "계정(UID)을")를 코드로 오인했다 — 문자 단위로 훑는다.
// ${...} 안은 진짜 코드이므로 재귀적으로 남긴다.
function stripLiterals(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === "'" || c === '"') {
      const q = c; i++;
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++; }
      i++; out += '""'; continue;
    }
    if (c === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`') { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let depth = 1; let expr = '';
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
            expr += src[i]; i++;
          }
          out += ' ' + stripLiterals(expr) + ' ';
          continue;
        }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

const GLOBALS = new Set([
  'window', 'document', 'localStorage', 'sessionStorage', 'console', 'Math', 'JSON', 'Date', 'Object',
  'Array', 'Number', 'String', 'Boolean', 'Map', 'Set', 'Promise', 'Error', 'isNaN', 'parseInt',
  'parseFloat', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'navigator', 'location',
  'URL', 'URLSearchParams', 'requestAnimationFrame', 'fetch', 'Intl', 'RegExp', 'Infinity', 'NaN',
  'undefined', 'crypto', 'Blob', 'TextEncoder', 'performance', 'structuredClone', 'globalThis',
  'alert', 'confirm', 'prompt', 'history', 'CustomEvent', 'Event', 'AbortController', 'Symbol',
  'BigInt', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'encodeURIComponent', 'decodeURIComponent',
  'queueMicrotask', 'btoa', 'atob', 'Uint8Array',
]);

const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(new URL(f, JS_DIR), 'utf8');
  const defined = new Set(GLOBALS);
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    m[1].split(',').forEach((p) => { const nm = p.split(/\s+as\s+/).pop().trim(); if (nm) defined.add(nm); });
  }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
    m[1].split(',').forEach((p) => { const nm = p.split(':').pop().split('=')[0].trim(); if (nm) defined.add(nm); });
  }
  for (const m of src.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/class\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);

  const code = stripLiterals(src);
  const seen = new Set();
  for (const m of code.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    const name = m[1];
    if (seen.has(name) || defined.has(name)) continue;
    // 객체 키(NAME:)와 속성 접근(.NAME)은 "참조"가 아니라 정의·경로다 — 제외한다.
    // (REASON_LABELS 의 ELAPSED_TOO_SHORT: 같은 키를 미정의로 오인하던 문제)
    const before = code.slice(Math.max(0, m.index - 1), m.index);
    const after = code.slice(m.index + name.length).match(/^\s*(.?)/)[1];
    if (before === '.' || after === ':') continue;
    seen.add(name);
    console.log(`❌ ${f}: ${name} — 정의도 import 도 없는데 참조됨`);
    bad++;
  }
}
console.log(bad === 0
  ? `✅ 어드민 모듈 ${files.length}개 — 미정의 상수 참조 없음`
  : `⚠️ 미정의 참조 ${bad}건 — 코드 삭제 중 상수가 함께 지워졌는지 확인하세요`);
process.exit(bad === 0 ? 0 : 1);
