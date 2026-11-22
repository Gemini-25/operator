// 선택 도구: 개발 서버(npm run dev)가 떠 있을 때, 원하는 유형의 사건이 '현장 대응'이 되면 그 현장을 세 장 캡처한다.
//   node scripts/screenshot.cjs <시드> <유형 이름 일부> [저장 폴더] [--force <유형/변형>] [--diff <난이도>] [--port <포트>]
//   유형 이름 일부: 화재 | 교통사고 | 실종 | 무장 | 응급 | 붕괴 | 가스 | 수난 | 시설 사고 | 동물 | 치안 | 보호 | 구조
//   --force 는 주소의 force 로 넘긴다(그 사건을 교대 초반에 한 번 일으킨다 — sweep --force 와 같다).
//   N8 의 새 시나리오는 카드 제목이 유형 이름이다(Scenario.card = false) — 유형 이름 일부로 찾는다.
// Playwright 가 설치된 환경에서만 동작한다(프로젝트 의존성에는 넣지 않았다).
const { chromium } = require('playwright');
(async () => {
  const pos = [];
  const opt = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  const seed = pos[0] || 'S2';
  const want = pos[1] || '화재';
  const out = pos[2] || 'shots';
  const port = opt.port || '5173';
  const q = ['seed=' + encodeURIComponent(seed)];
  if (opt.force) q.push('force=' + encodeURIComponent(opt.force));
  if (opt.diff) q.push('diff=' + encodeURIComponent(opt.diff));
  const tag = (opt.force ? opt.force.replace('/', '-') + '-' + seed : want);
  require('node:fs').mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  const warnings = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); else if (m.type() === 'warning') warnings.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  await page.goto(`http://localhost:${port}/?${q.join('&')}`);
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
      for (const wait of [3000, 5000, 6000]) { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${tag}-${++n}.png` }); }
      break;
    }
  }
  console.log('shots', n, 'errors', errors.length, errors.slice(0, 3), 'warnings', warnings.length, warnings.slice(0, 3));
  await browser.close();
})();
