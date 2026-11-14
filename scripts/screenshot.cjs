// 선택 도구: 개발 서버(npm run dev)가 떠 있을 때, 원하는 유형의 사건이 '현장 대응'이 되면 그 현장을 세 장 캡처한다.
//   node scripts/screenshot.cjs <시드> <유형 이름 일부: 화재 | 교통사고 | 실종 | 무장> [저장 폴더]
// Playwright 가 설치된 환경에서만 동작한다(프로젝트 의존성에는 넣지 않았다).
const { chromium } = require('playwright');
(async () => {
  const seed = process.argv[2] || 'S2';
  const want = process.argv[3] || '화재';
  const out = process.argv[4] || 'shots';
  require('node:fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto('http://localhost:5173/?seed=' + seed);
  await page.waitForTimeout(500);
  await page.keyboard.press('4');
  // 원하는 유형의 사건이 '현장 대응'이 될 때까지 기다렸다가 고정
  let n = 0;
  for (let i = 0; i < 400; i++) {
    await page.waitForTimeout(150);
    const card = page.locator('.card.incident', { hasText: want }).filter({ hasText: '현장 대응' }).first();
    if (await card.count()) {
      await card.click();
      await page.keyboard.press('2');     // 3x
      for (const wait of [3000, 5000, 6000]) { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${want}-${++n}.png` }); }
      break;
    }
  }
  console.log('shots', n, 'errors', errors.length, errors.slice(0, 3));
  await browser.close();
})();
