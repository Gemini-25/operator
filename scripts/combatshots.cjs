// 교전 연출 장면 찍기 (docs/specs/G5-combat-fx.md 8.3절. 선택 도구: Playwright 가 전역에 설치된 환경에서만 돈다).
//   npx vite --port 5225 --strictPort &
//   NODE_PATH=$(npm root -g) node scripts/combatshots.cjs <포트> <시드> <force> <diff> <시각(초)> <저장 폴더> [선택]
// 선택:
//   --id N              관찰할 사건 id (강제 사건. 사건 카드의 번호는 N+1). 없으면 카드를 누르지 않는다(자동 카메라)
//   --label 이름         파일 이름 앞머리 (기본 shot)
//   --offsets a,b,…     장면 시각에서 멈춘 뒤 연출 시계만 넘기며 찍을 시각(초). 기본 0,0.1,0.25,0.5,1,2 (none = 찍지 않음)
//   --play              연출 시계 대신 1배속으로 재생하며 실제 시간으로 찍는다(고치기 전 화면용 — fxStep 이 없을 때)
//   --lead S            장면 시각보다 S 초 앞에서 멈춘다(기본 0)
//   --ai                AI 시점(T)으로 바꾼다
//   --city              현장 대신 지도 화면(지도에서 보기)
//   --dpr 1|2           deviceScaleFactor (기본 1)
//   --measure S         장면 뒤 S 초 동안 FPS·교전 그림 시간·소리 통계를 잰다 (--speed 로 배속, --noslow 면 자동 감속을 끈다)
//   --speed 1|3|8|15    재는 동안의 배속 (기본 1)
//   --noslow            자동 감속 끔(S)
//   --mute              재기 전에 음소거(M)
//   --rewind            재는 중간에 되감기(←) 한 번
//   --approach 1|3|8|15 장면 시각까지 다가가는 배속 (기본 1)
//   --zoom N --at x,y   현장 화면을 칸 (x,y) 를 가리킨 채 휠로 N 번 확대한다 (사람이 쓰는 시점 조작)
//   --clean             찍을 때 가운데를 가리는 '일시정지' 글자와 통화창을 숨긴다 (CSS 만, 상태는 그대로)
// 조작은 사람이 쓰는 키(1~4·Space·←·→·S·T·M·Shift)와 사건 카드 누르기로만 한다. 읽기는 개발 서버 전용 고리 window.__ar 로.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('playwright 를 찾지 못했습니다 (NODE_PATH=$(npm root -g) 로 전역 설치를 가리키세요).'); process.exit(2); }

const [port, seed, force, diff, timeArg, outArg] = process.argv.slice(2);
if (!outArg) { console.error('사용: node scripts/combatshots.cjs <포트> <시드> <force> <diff> <시각> <저장 폴더> [선택]'); process.exit(2); }
const opt = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes('--' + name);
const T = Number(timeArg);
const OUT = path.resolve(outArg);
const LABEL = opt('label', 'shot');
const OFFSETS = opt('offsets', '0,0.1,0.25,0.5,1,2') === 'none' ? [] : opt('offsets', '0,0.1,0.25,0.5,1,2').split(',').map(Number);
const DPR = Number(opt('dpr', '1'));
const ID = opt('id', null);
const LEAD = Number(opt('lead', '0'));
const MEASURE = Number(opt('measure', '0'));
const SPEED = Number(opt('speed', '1'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let browser;
  try { browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); }
  catch { browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required'] }); }
  const errors = [];
  const report = { seed, force, diff, time: T, shots: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const q = new URLSearchParams({ seed, force, diff }).toString();
    await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!(window.__ar && window.__ar.snap), null, { timeout: 60000 });
    const snap = () => page.evaluate(() => window.__ar.snap());
    const key = (k, code) => page.evaluate(([k2, c2]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k2, code: c2, bubbles: true })), [k, code || k]);
    const hasFx = await page.evaluate(() => typeof window.__ar.fxStep === 'function');
    // 멈추고, 소리를 연다 (Shift 는 상태를 바꾸지 않는다)
    if (!(await snap()).paused) await key(' ', 'Space');
    await page.keyboard.press('Shift');
    // → 로 10초씩 건너뛴다 (같은 시드를 그 틱까지 돌릴 뿐이다)
    const stopAt = T - LEAD;
    for (let guard = 0; guard < 400; guard++) { const s = await snap(); if (s.t + 10 > stopAt - 2.5) break; await key('ArrowRight'); }
    if (ID !== null) {
      const code = String(Number(ID) + 1).padStart(2, '0');
      const card = page.locator('.card.incident').filter({ has: page.locator('.code', { hasText: new RegExp('^' + code + '$') }) }).first();
      // 목록은 0.16초마다 다시 그려지며 순서가 바뀔 수 있다: 누른 뒤 관찰 대상이 맞는지 보고, 아니면 다시 누른다
      for (let k = 0; k < 5; k++) { await sleep(350); await card.click(); await sleep(150); if ((await snap()).camFocus === Number(ID)) break; }
      report.focus = (await snap()).camFocus;
    }
    if (flag('ai')) await key('t');
    if (flag('city')) { const b = page.getByRole('button', { name: '지도에서 보기' }); if (await b.count()) await b.click(); }
    if (flag('clean')) await page.addStyleTag({ content: '.paused, .overlay.call-wrap { display: none !important; }' });
    const ZOOM = Number(opt('zoom', '0')), AT = opt('at', null);
    if (ZOOM > 0 && AT) {
      await sleep(400);
      const [ax, ay] = AT.split(',').map(Number);
      const pt = await page.evaluate(([x, y]) => {
        const c = document.querySelector('.viewport canvas'); const r = c.getBoundingClientRect();
        const fit = Math.max(6, Math.floor(Math.min(r.width / 30.6, r.height / 20.6)));
        const ox = Math.floor((r.width - fit * 30) / 2), oy = Math.floor((r.height - fit * 20) / 2);
        return { x: r.left + ox + x * fit + fit / 2, y: r.top + oy + y * fit + fit / 2 };
      }, [ax, ay]);
      await page.mouse.move(pt.x, pt.y);
      for (let k = 0; k < ZOOM; k++) { await page.mouse.wheel(0, -100); await sleep(60); }
      await page.mouse.move(5, 5);
      await sleep(900);
    }
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    // 1배속으로 재생하다 장면 시각에 정확히 멈춘다 (같은 화면 갱신 안에서 Space). --approach 15 면 15배속으로 다가간다(⑨b: --noslow 와 함께)
    const APPROACH = Number(opt('approach', '1'));
    if (APPROACH > 1 && flag('noslow') && (await snap()).autoSlow) await key('s');
    await key(String({ 1: 1, 3: 2, 8: 3, 15: 4 }[APPROACH] || 1));
    const tPause = await page.evaluate((target) => new Promise((res) => {
      const f = () => { const s = window.__ar.snap(); if (s.t >= target - 1e-6 || s.ended) { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true })); res(s.t); } else requestAnimationFrame(f); };
      f();
    }), stopAt);
    await sleep(250);
    report.paused = tPause;
    const shoot = async (tag) => {
      const file = path.join(OUT, `${LABEL}-${tag}.png`);
      await page.screenshot({ path: file });
      report.shots.push(file);
    };
    if (!flag('play') && hasFx) {
      let at = 0;
      for (const o of OFFSETS) { if (o > at) { await page.evaluate((d) => window.__ar.fxStep(d), o - at); at = o; } await sleep(60); await shoot(String(o).replace('.', 'p')); }
    } else if (OFFSETS.length) {
      // 고치기 전 화면: 1배속으로 재생하며 찍는다 (시각은 대략)
      await key('1');
      const t0 = Date.now();
      for (const o of OFFSETS) { const wait = o * 1000 - (Date.now() - t0); if (wait > 0) await sleep(wait); await shoot('r' + String(o).replace('.', 'p')); }
      await key(' ', 'Space');
    }
    if (MEASURE > 0) {
      if (flag('noslow') && (await snap()).autoSlow) await key('s');
      if (flag('mute')) await key('m');
      // 1배속으로 바뀌는 첫 화면 갱신의 시뮬레이션 시각 (자동 감속 확인 ⑨a)
      await page.evaluate(() => { window.__firstSlow = null; const f = () => { const s = window.__ar.snap(); if (s.slowed && !window.__firstSlow) window.__firstSlow = { t: s.t, tick: s.tick }; if (!window.__firstSlow) requestAnimationFrame(f); }; requestAnimationFrame(f); });
      await key(String({ 1: 1, 3: 2, 8: 3, 15: 4 }[SPEED] || 1));
      const comb0 = await page.evaluate(() => (window.__ar.combat ? window.__ar.combat() : null));
      const samples = [];
      const t0 = Date.now();
      let rewound = false;
      while (Date.now() - t0 < MEASURE * 1000) {
        await sleep(100);
        if (flag('rewind') && !rewound && Date.now() - t0 > MEASURE * 500) {
          rewound = true;
          const before = await page.evaluate(() => (window.__ar.combat ? window.__ar.combat().stats.made : 0));
          await key('ArrowLeft');
          await sleep(1000);
          const after = await page.evaluate(() => (window.__ar.combat ? window.__ar.combat().stats.made : 0));
          report.rewindMade = after - before;
        }
        const s = await page.evaluate(() => ({ snap: window.__ar.snap(), comb: window.__ar.combat ? window.__ar.combat() : null }));
        samples.push(s);
      }
      const avg = (f) => samples.reduce((a, s) => a + f(s), 0) / Math.max(1, samples.length);
      const last = samples[samples.length - 1];
      report.measure = {
        speed: SPEED, autoSlow: last.snap.autoSlow, slowedShare: avg((s) => (s.snap.slowed ? 1 : 0)),
        fps: avg((s) => s.snap.fps), drawMs: last.comb ? avg((s) => s.comb.drawMs) : null, drawMsMax: last.comb ? Math.max(...samples.map((s) => s.comb.drawMs)) : null,
        madeDelta: last.comb && comb0 ? last.comb.stats.made - comb0.stats.made : null,
        stats: last.comb ? last.comb.stats : null, live: last.comb ? last.comb.live : null, tFrom: samples[0].snap.t, tTo: last.snap.t,
        firstSlow: await page.evaluate(() => window.__firstSlow),
        maxVoices: last.comb ? Math.max(...samples.map((s) => s.comb.stats.voices)) : null,
        maxPerSecSampled: last.comb ? Math.max(...samples.map((s) => s.comb.stats.perSec)) : null,
      };
      await shoot('measure-end');
    }
  } finally { await browser.close(); }
  report.errors = errors;
  console.log(JSON.stringify(report));
  if (errors.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
