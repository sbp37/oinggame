// ══════════════════════════════════════════════════════════════
//  custom-shop-narrow.test.mjs — 커스텀샵 좁은 화면(갤럭시) 렌더
//
//  운영 보고: 갤럭시에서 '내 랭킹 미리보기' 줄이 엉망으로 떴다.
//  원인은 flex 자식이 전부 기본 flex-shrink:1 이라, 폭이 모자라면 Lv·Top30 알약까지
//  같이 눌리고 알약 글자가 두 줄로 말려 동그란 덩어리처럼 보인 것.
//  실제 브라우저로 폭을 바꿔가며 확인한다.
//  실행: node --test test/custom-shop-narrow.test.mjs
// ══════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const server = createServer(async (req, res) => {
  const name = (req.url || '/').split('?')[0].replace(/^\//, '') || 'index.html';
  try {
    const body = await readFile(new URL(name, ROOT));
    res.writeHead(200, { 'Content-Type': name.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function measure(width) {
  const p = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
  await p.goto(`http://127.0.0.1:${port}/custom-shop-preview.html?live=1`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(400);
  // 실제로 문제가 보고된 값(긴 닉·높은 레벨·다섯 자리 점수)으로 채운다.
  await p.evaluate(() => {
    previewRank.textContent = '27'; previewDelta.textContent = '－';
    previewLevel.textContent = '🌿 Lv.9'; previewNick.textContent = '고목맴미';
    previewScore.textContent = '17,543pt';
  });
  await p.waitForTimeout(200);
  const out = await p.evaluate(() => {
    const clipped = (e) => e.scrollWidth > e.clientWidth + 1;
    const h = (e) => e.getBoundingClientRect().height;
    return {
      nickClipped: clipped(previewNick),
      lvClipped: clipped(previewLevel), badgeClipped: clipped(previewBadge),
      lvH: h(previewLevel), badgeH: h(previewBadge),
      rowH: h(document.getElementById('rankPreview')),
    };
  });
  await p.close();
  return out;
}

// 갤럭시·아이폰에서 실제로 쓰이는 폭들
for (const width of [430, 412, 393, 390, 375, 360, 340]) {
  test(`${width}px — 알약이 눌리지 않고 닉네임이 온전히 보인다`, async () => {
    const m = await measure(width);
    assert.equal(m.lvClipped, false, 'Lv 알약이 잘리면 안 됩니다');
    assert.equal(m.badgeClipped, false, 'Top30 알약이 잘리면 안 됩니다');
    // 알약 글자가 두 줄로 말리면 높이가 줄 높이의 절반을 넘어 덩어리처럼 보인다.
    assert.ok(m.lvH < m.rowH * 0.5, `Lv 알약이 두 줄로 말렸습니다 (${m.lvH}px / 줄 ${m.rowH}px)`);
    assert.ok(m.badgeH < m.rowH * 0.5, `Top30 알약이 두 줄로 말렸습니다 (${m.badgeH}px / 줄 ${m.rowH}px)`);
    assert.equal(m.nickClipped, false, '닉네임이 잘리면 미리보기 의미가 없습니다');
  });
}

test.after(async () => { await browser.close(); await new Promise(r => server.close(r)); });
