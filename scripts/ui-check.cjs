// 화면 자동 검사 (선택 도구: Playwright 가 전역에 설치된 환경에서만 돈다. `npm run check` 에는 넣지 않았다).
//   npm run ui-check                         기본: 시드 S3, 스크린샷은 shots/ui-check/
//   npm run ui-check -- --out <폴더> --seed S3 --end-limit 420
// 스스로 개발 서버(npx vite --port 5191 --strictPort)를 띄우고 끝나면 끈다. 1600×900 브라우저로 /?seed=S3 을 열어
// 아래 일곱 가지를 본다. 항목마다 [통과]/[실패]/[정보] 를 한 줄씩 찍고, 하나라도 실패하면 종료 코드 1.
//   1. 콘솔 오류·페이지 오류 0건 (전 과정 내내)
//   2. 일시정지 중에는 틱이 늘지 않는다 · 1배와 최고 배속에서 같은 실제 시간에 진행한 틱의 비율
//   3. 되감기(되감기 버튼·타임라인 클릭) 뒤 다시 진행해도 같은 틱의 기록 해시가 헤드리스 Sim 과 같다
//   4. 새로고침 뒤 복원 (시드·난이도·틱·배속 설정)
//   5. 최고 배속으로 교대를 끝까지 돌리면 종료 보고서가 뜬다 (보고서의 기록 해시 = 헤드리스)
//   6. 난이도 설정·재난 선택이 열리고 닫힌다, 사건 카드를 누르면 현장 화면이 열린다 (스크린샷)
//   7. 화면의 조작 목록 (판정은 사람이: CLAUDE.md 절대 규칙 1 "AI 에게 명령하는 입력을 만들지 않는다")
// 화면 상태는 개발 서버에서만 생기는 읽기 전용 고리 window.__ar.snap() (src/ui/App.tsx) 으로 읽는다.
// 조작은 모두 사람이 쓰는 버튼·키·타임라인으로 한다. 헤드리스 기준값은 scripts/ui-check-ref.ts 를 tsx 로 따로 돌려 얻는다.
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5191;
const BASE = `http://localhost:${PORT}`;
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const SEED = arg('seed', 'S3');
const OUT = path.resolve(ROOT, arg('out', 'shots/ui-check'));
const END_LIMIT = Number(arg('end-limit', '420'));      // 교대를 끝까지 돌릴 때 기다리는 실제 시간 상한(초)

let chromium;
try { ({ chromium } = require('playwright')); } catch { console.error('playwright 를 찾지 못했습니다 (전역 설치가 필요합니다).'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => console.log('  · ' + s);
/** 키 순서와 무관한 JSON 비교 */
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const same = (a, b) => canon(a) === canon(b);

// ───────────── 개발 서버 ─────────────
function portBusy() {
  return new Promise((resolve) => { http.get(BASE + '/', (res) => { res.resume(); resolve(true); }).on('error', () => resolve(false)); });
}
async function startServer() {
  if (await portBusy()) throw new Error(`포트 ${PORT} 를 이미 다른 프로그램이 쓰고 있습니다.`);
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } });
  let out = '', exited = null;
  child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  child.on('exit', (code) => { exited = code ?? -1; });
  const t0 = Date.now();
  for (;;) {
    if (exited !== null) throw new Error(`개발 서버가 시작하지 못했습니다 (종료 코드 ${exited}):\n${out}`);
    const ok = await new Promise((resolve) => { http.get(BASE + '/', (res) => { res.resume(); resolve(res.statusCode === 200); }).on('error', () => resolve(false)); });
    if (ok) return child;
    if (Date.now() - t0 > 60000) { await stopServer(child); throw new Error('개발 서버가 60초 안에 응답하지 않았습니다:\n' + out); }
    await sleep(300);
  }
}
async function stopServer(child) {
  if (!child) return;
  const alive = () => { try { process.kill(-child.pid, 0); return true; } catch { return false; } };
  try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
  for (let i = 0; i < 30 && alive(); i++) await sleep(100);
  if (alive()) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 이미 끝났다 */ } }
}

// ───────────── 검사 ─────────────
const results = {};        // 번호 → { ok: true | false | null(정보), line, details }
const result = (n, ok, line, details = []) => { results[n] = { ok, line, details }; };
const marks = [];          // 헤드리스와 비교할 (틱, 해시) 표본
const errors = [];
let loads = 0;
const inventory = [];      // 7번: 상태별 조작 목록

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await run(page);
  } finally { await browser.close(); }
}

async function run(page) {
  const snap = () => page.evaluate(() => window.__ar.snap());
  const waitAr = () => page.waitForFunction(() => !!(window.__ar && window.__ar.snap), null, { timeout: 30000 });
  const load = async (url) => { await page.goto(BASE + url, { waitUntil: 'load' }); await waitAr(); loads++; };
  const reload = async () => { await page.reload({ waitUntil: 'load' }); await waitAr(); loads++; };
  const mark = (group, label, s) => marks.push({ group, label, tick: s.tick, hash: s.hash, seed: s.seed, diff: s.difficulty });
  const blur = () => page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const bottom = page.locator('.bottom .controls');
  const speedBtn = (v) => bottom.getByRole('button', { name: `${v}×`, exact: true });
  const pauseBtn = bottom.locator('button').filter({ hasText: /^(정지|재개)$/ });
  const setPaused = async (want) => { if ((await snap()).paused !== want) await pauseBtn.click(); await blur(); return snap(); };
  const collect = async (label) => {
    // React 가 단 이벤트 처리기(on*)가 있는 요소와 button·input·select·textarea·a 를 모은다. 보이지 않는 요소는 뺀다
    const items = await page.evaluate(() => {
      const REGIONS = [['.modal.diff', '난이도 창'], ['.modal', '보고서 창'], ['.top', '상단'], ['.left', '왼쪽'], ['.right', '오른쪽'], ['.bottom', '하단'], ['.center', '가운데']];
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const pk = Object.keys(el).find((k) => k.startsWith('__reactProps$'));
        const props = pk ? el[pk] : null;
        const handlers = props ? Object.keys(props).filter((k) => /^on[A-Z]/.test(k) && typeof props[k] === 'function') : [];
        const tag = el.tagName.toLowerCase();
        const control = ['button', 'input', 'select', 'textarea', 'a'].includes(tag);
        if (!control && !handlers.length) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const region = (REGIONS.find(([sel]) => el.closest(sel)) || [null, '기타'])[1];
        const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] || '' : '';
        const label = tag === 'input' ? `${el.type}${el.placeholder ? ' "' + el.placeholder + '"' : ''}${el.title ? ' (' + el.title + ')' : ''}` : (el.innerText || '').replace(/\s+/g, ' ').trim() || el.getAttribute('aria-label') || el.title || '(글자 없음)';
        out.push({ region, control, key: control ? tag : `${tag}${cls ? '.' + cls : ''}`, handlers: handlers.join(','), text: label.slice(0, control ? 34 : 22) });
      }
      return out;
    });
    // 창·문서·캔버스에 직접 단 처리기(키보드·휠·끌기)는 개발자 도구 규약으로 읽는다. Playwright 가 스스로 단 처리기는 빼고, 앱 파일 이름을 붙인다
    const cdp = await page.context().newCDPSession(page);
    const urls = new Map();
    cdp.on('Debugger.scriptParsed', (e) => urls.set(e.scriptId, e.url));
    await cdp.send('Debugger.enable');
    const native = {};
    for (const [name, expr] of [['window', 'window'], ['document', 'document'], ['canvas', 'document.querySelector(".viewport canvas")']]) {
      const { result: obj } = await cdp.send('Runtime.evaluate', { expression: expr });
      if (!obj.objectId) continue;
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: obj.objectId });
      const mine = listeners.map((l) => ({ type: l.type, url: urls.get(l.scriptId) || '' })).filter((l) => l.url.startsWith(BASE));
      native[name] = [...new Set(mine.map((l) => `${l.type}(${l.url.slice(BASE.length + 1).split('?')[0]})`))].sort();
    }
    await cdp.send('Debugger.disable');
    await cdp.detach();
    inventory.push({ label, items, native });
  };

  // ── 준비: 처음 열 때 개발 서버가 모듈을 준비한다. 한 번 열어 두고, 주소에 시드가 있을 때의 새로고침도 여기서 본다 ──
  await load(`/?seed=${SEED}`);
  await sleep(3000);         // 실행기는 2.5초마다 진행을 저장한다
  const warm = await snap();
  const warmSaved = JSON.parse((await page.evaluate(() => localStorage.getItem('ar.current.v1'))) || 'null');
  await reload();
  const warmAfter = await snap();
  const urlFixed = { savedTick: warmSaved ? warmSaved.tick : -1, before: warm.tick, restoredTicks: warmAfter.restoredTicks, after: warmAfter.tick };
  await page.evaluate(() => localStorage.clear());

  // ── 2. 일시정지와 배속 ──
  let base, maxSpeed = 15;
  try {
    await load(`/?seed=${SEED}`);
    base = await snap();
    await collect('도시 지도');
    if (base.autoSlow) await bottom.getByRole('button', { name: '자동 감속', exact: true }).click();     // 결정적 순간의 1배속 감속은 속도 측정을 흐린다
    await blur();
    await page.keyboard.press('Space');
    const p1 = await snap();
    const overlay = await page.locator('.center .paused').isVisible();
    await sleep(2000);
    const p2 = await snap();
    const pauseOk = p1.paused && p2.paused && p1.tick === p2.tick && overlay;
    const list = (await bottom.locator('button').allInnerTexts()).map((t) => /^(\d+)×$/.exec(t.trim())).filter(Boolean).map((m) => Number(m[1]));
    maxSpeed = Math.max(...list); const minSpeed = Math.min(...list);
    const measure = async (v) => {
      await speedBtn(v).click(); await blur(); await sleep(400);
      const a = await snap(); await sleep(4000); const b = await snap();
      const sec = (b.now - a.now) / 1000;
      return { ticks: b.tick - a.tick, sec, rate: (b.tick - a.tick) / sec, fps: b.fps, paused: b.paused, speed: b.speed, autoSlow: b.autoSlow };
    };
    const r1 = await measure(minSpeed);
    const rM = await measure(maxSpeed);
    const ratio = rM.rate / r1.rate, nominal = maxSpeed / minSpeed;
    const ok = pauseOk && !r1.paused && !rM.paused && r1.speed === minSpeed && rM.speed === maxSpeed && !rM.autoSlow && r1.rate > 0 && ratio >= nominal * 0.5;
    result(2, ok, `일시정지 ${((p2.now - p1.now) / 1000).toFixed(1)}초 동안 틱 ${p1.tick}→${p2.tick}${overlay ? '' : ' (일시정지 표시 없음)'} · ${minSpeed}× ${r1.rate.toFixed(2)}틱/초, ${maxSpeed}× ${rM.rate.toFixed(2)}틱/초 → 비율 ${ratio.toFixed(2)} (명목 ${nominal}, 기준 ≥ ${(nominal * 0.5).toFixed(1)})`, [
      `${minSpeed}×: ${r1.ticks}틱 / ${r1.sec.toFixed(2)}초 (명목 ${(minSpeed / 0.2).toFixed(1)}틱/초) · ${maxSpeed}×: ${rM.ticks}틱 / ${rM.sec.toFixed(2)}초 (명목 ${(maxSpeed / 0.2).toFixed(1)}틱/초) · 화면 ${rM.fps.toFixed(0)} FPS`,
    ]);
    log(`2 끝: ${results[2].line}`);
  } catch (e) { result(2, false, `예외: ${e.message.split('\n')[0]}`); }

  // ── 3. 되감기 뒤의 재현성 ──
  let s3 = null;
  try {
    let s = await snap();
    const goal = Math.max(900, s.tick + 300);
    for (const t0 = Date.now(); s.tick < goal && Date.now() - t0 < 60000; s = await snap()) { mark(3, '진행', s); await sleep(250); }
    const A = await setPaused(true); mark(3, '되감기 전 정지', A);
    // (가) 되감기 버튼 세 번(각각 처음부터 다시 돌린다) → 앞으로 버튼 세 번: 같은 틱으로 돌아오면 해시도 같아야 한다
    for (let i = 0; i < 3; i++) await page.locator('button[aria-label="10초 되감기"]').click();
    const Rb = await snap(); mark(3, '되감기 버튼 3번', Rb);
    for (let i = 0; i < 3; i++) await page.locator('button[aria-label="10초 앞으로"]').click();
    const Fb = await snap(); mark(3, '앞으로 버튼 3번', Fb);
    // (나) 타임라인을 눌러 앞쪽 시각으로 되감는다 (사건 막대는 눌러도 시각 이동이 아니라 관찰 고정이므로 막대가 없는 높이를 고른다)
    const want = A.t * 0.4;
    const pt = await page.evaluate((wantT) => {
      const tr = document.querySelector('.bottom .track'), r = tr.getBoundingClientRect(), s = window.__ar.snap();
      const total = Math.max(s.shiftLen, s.t), x = r.left + (wantT / total) * r.width;
      for (let y = r.bottom - 2; y > r.top; y -= 1) { const el = document.elementFromPoint(x, y); if (el && tr.contains(el) && !el.closest('.span')) return { x, y, secPerPx: total / r.width }; }
      return null;
    }, want);
    if (!pt) throw new Error('타임라인에서 사건 막대가 없는 자리를 찾지 못했습니다');
    await page.mouse.click(pt.x, pt.y); await blur();
    const R = await snap(); mark(3, '타임라인 되감기', R);
    // (다) 재개 버튼으로 다시 진행: 되감기 전 시각을 150틱 넘길 때까지 표본을 모은다
    await setPaused(false);
    let n = 0;
    for (const t0 = Date.now(); (s = await snap()).tick < A.tick + 150 && Date.now() - t0 < 90000;) { mark(3, '다시 진행', s); n++; await sleep(250); }
    const B = await setPaused(true); mark(3, '다시 진행 뒤 정지', B);
    s3 = {
      A, Rb, Fb, R, B, n, want, pt,
      btnOk: Rb.tick === A.tick - 150 && Rb.seeks === A.seeks + 3 && Fb.tick === A.tick && Fb.seeks === A.seeks + 6 && Fb.hash === A.hash,
      tlOk: R.seeks === Fb.seeks + 1 && R.tick < A.tick && Math.abs(R.t - want) <= pt.secPerPx * 1.5 + 0.2 && R.paused,
      covered: B.tick >= A.tick && n >= 3,
    };
    log(`3 표본: 되감기 전 틱 ${A.tick} → 버튼 ${Rb.tick} → ${Fb.tick} → 타임라인 ${R.tick} (목표 ${(want / 0.2).toFixed(0)}) → 다시 진행 ${n}개 → 틱 ${B.tick}`);
  } catch (e) { result(3, false, `예외: ${e.message.split('\n')[0]}`); }

  // ── 4. 새로고침 복원 ──
  let s4 = null;
  try {
    // 정지한 채로 3초: 실행기는 2.5초마다 진행을 저장하므로 저장된 틱 = 지금 틱이 된다
    const P = await setPaused(true);
    await sleep(3000);
    const cur = JSON.parse((await page.evaluate(() => localStorage.getItem('ar.current.v1'))) || 'null');
    // 주소에 시드가 있으면 그 조건으로 처음부터 시작한다(준비 단계에서 확인). 복원은 조건 없는 주소에서 일어난다
    await load('/');
    const Q = await snap(); mark(4, '조건 없는 주소로 열어 복원', Q);
    const C = await setPaused(true); mark(4, '새로고침 전 정지', C);
    await sleep(3000);
    await reload();
    const D = await snap(); mark(4, '새로고침 직후', D);
    s4 = {
      P, cur, Q, C, D,
      savedOk: !!cur && cur.seed === P.seed && cur.tick === P.tick && same(cur.diff, P.difficulty),
      restOk: Q.restoredTicks === P.tick && Q.seed === P.seed && same(Q.difficulty, P.difficulty) && Q.speed === P.speed && Q.autoSlow === P.autoSlow && Q.tick >= P.tick,
      reloadOk: D.restoredTicks === C.tick && D.seed === C.seed && same(D.difficulty, C.difficulty) && D.tick >= C.tick && D.speed === C.speed,
      urlOk: urlFixed.savedTick > 0 && urlFixed.restoredTicks === 0 && urlFixed.after < urlFixed.savedTick,
    };
    log(`4 표본: 저장 ${cur ? `${cur.seed}@${cur.tick}` : '없음'} → 복원 ${Q.seed}@${Q.restoredTicks} (읽은 틱 ${Q.tick}) → 새로고침 전 ${C.tick} → 새로고침 복원 ${D.restoredTicks} (읽은 틱 ${D.tick})`);
  } catch (e) { result(4, false, `예외: ${e.message.split('\n')[0]}`); }

  // ── 6. 난이도 설정·재난 선택, 현장 화면 ──
  try {
    await setPaused(false);
    const s0 = await snap();
    const modal = page.locator('.modal.diff');
    const onChip = modal.locator('.disaster-row .chip.on');
    const desc = modal.locator('.disaster-row .knob-head .dim');
    await page.locator('.top .diff-chip').click();
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    await collect('난이도 설정');
    const title = (await modal.locator('h2').innerText()).trim();
    const nPreset = await modal.locator('.preset').count();
    const nKnob = await modal.locator('input[type=range]').count();
    const names = (await modal.locator('.disaster-row .chip').allInnerTexts()).map((t) => t.trim());
    const onBefore = (await onChip.innerText()).trim(), descBefore = (await desc.innerText()).trim();
    const pick = names.find((x) => x !== onBefore && x !== '없음' && x !== '무작위') || names.find((x) => x !== onBefore);
    await modal.locator('.disaster-row .chip').filter({ hasText: new RegExp(`^${pick}$`) }).click();
    const onAfter = (await onChip.innerText()).trim(), descAfter = (await desc.innerText()).trim();
    await modal.getByRole('button', { name: '닫기', exact: true }).click();
    await modal.waitFor({ state: 'hidden', timeout: 5000 });
    const s1 = await snap();
    // 다시 열면 시작하지 않은 선택은 남아 있지 않다. 이번에는 바깥(어두운 바탕)을 눌러 닫는다
    await page.locator('.top .diff-chip').click();
    await modal.waitFor({ state: 'visible', timeout: 5000 });
    const onReopen = (await onChip.innerText()).trim();
    const backHit = await page.evaluate(() => { const el = document.elementFromPoint(20, 450); return el ? el.className : ''; });
    await page.mouse.click(20, 450);
    await modal.waitFor({ state: 'hidden', timeout: 5000 });
    const s2 = await snap();
    const diffOk = title === '난이도 설정' && nPreset >= 2 && nKnob >= 1 && names.length >= 3 && onAfter === pick && onAfter !== onBefore && descAfter !== descBefore
      && onReopen === onBefore && backHit === 'modal-back' && s1.version === s0.version && s2.version === s0.version && s2.seed === s0.seed && same(s2.difficulty, s0.difficulty) && s2.tick > s0.tick;
    const diffLine = `난이도 설정 열림(프리셋 ${nPreset}, 손잡이 ${nKnob}, 재난 ${names.length}종: ${names.join('·')}) · 재난 '${onBefore}'→'${pick}' 눌러 켜짐=${onAfter === pick} · 닫기 버튼으로 닫힘 · 다시 열면 '${onReopen}' · 바깥 눌러 닫힘 · 교대 그대로(버전 ${s0.version}→${s2.version}, 틱 ${s0.tick}→${s2.tick})`;

    // 현장 확대: '현장 대응' 중인 사건 카드를 찾으면 잠깐 정지하고(목록이 바뀌지 않게) 그 카드를 누른다
    const onsceneCards = page.locator('.left .card.incident').filter({ has: page.locator('.badge.phase-onscene') });
    let found = false;
    for (const t0 = Date.now(); Date.now() - t0 < 150000; await sleep(500)) if (await onsceneCards.count()) { found = true; break; }
    let sceneOk = false, sceneLine = '현장 대응 중인 사건을 150초 안에 찾지 못함';
    if (found) {
      await setPaused(true);
      const card = onsceneCards.first();
      const code = (await card.locator('.code').innerText()).trim();
      await card.click(); await blur();
      await setPaused(false);
      await sleep(1800);         // 카메라가 현장으로 옮겨 가는 동안
      const sc = await snap();
      const sceneTitle = (await page.locator('.scene-title').innerText()).trim();
      const mapBtn = page.getByRole('button', { name: '지도에서 보기', exact: true });
      const mapBtnVisible = await mapBtn.isVisible();
      const legend = await page.locator('.overlay.bl .legend').innerText();
      const shot = path.join(OUT, 'scene.png');
      await page.screenshot({ path: shot });
      await collect('현장 화면');
      sceneOk = sc.camMode === 'scene' && sc.camFocus >= 0 && sceneTitle.includes(`사건 ${code} `) && mapBtnVisible && legend.includes('지휘관');
      await mapBtn.click(); await blur();
      const back = await snap();
      sceneLine = `사건 카드 ${code} 누름 → 카메라 ${sc.camMode}, 관찰 사건 ${sc.camFocus}, 제목 "${sceneTitle.slice(0, 40)}", '지도에서 보기' 버튼 ${mapBtnVisible ? '있음' : '없음'}, 현장 범례 ${legend.includes('지휘관') ? '있음' : '없음'} · 스크린샷 ${shot} · 지도에서 보기 → ${back.camMode}`;
    }
    result(6, diffOk && sceneOk, `${diffOk ? '난이도·재난 열고 닫힘' : '난이도·재난 확인 실패'} · ${sceneOk ? '현장 화면 열림' : '현장 화면 확인 실패'}`, [diffLine, sceneLine]);
    log(`6 끝: ${results[6].line}`);
  } catch (e) { result(6, false, `예외: ${e.message.split('\n')[0]}`); }

  // ── 5. 최고 배속으로 교대 끝까지 ──
  let s5 = null;
  try {
    await speedBtn(maxSpeed).click(); await blur();
    const s0 = await snap();
    const head = page.locator('.modal-back .modal h2', { hasText: '교대 종료 보고서' });
    const t0 = Date.now();
    let lastLog = t0;
    while (!(await head.isVisible()) && (Date.now() - t0) / 1000 < END_LIMIT) {
      await sleep(1000);
      if (Date.now() - lastLog > 20000) { const s = await snap(); lastLog = Date.now(); log(`5 진행: ${((Date.now() - t0) / 1000).toFixed(0)}초, 시각 ${s.t.toFixed(0)}초 / ${s.shiftLen}초, ${s.fps.toFixed(0)} FPS`); }
    }
    const elapsed = (Date.now() - t0) / 1000;
    const visible = await head.isVisible();
    const E = await snap();
    let shown = null;
    if (visible) {
      const sub = await page.locator('.modal-head .dim').first().innerText();
      const m = /기록 해시 ([0-9a-f]+)/.exec(sub); shown = m ? m[1] : null;
      await page.screenshot({ path: path.join(OUT, 'report.png') });
      await collect('종료 보고서');
    }
    s5 = { s0, E, elapsed, visible, shown };
    log(`5 끝: ${visible ? '보고서 뜸' : '보고서 안 뜸'} · ${elapsed.toFixed(1)}초 · 틱 ${s0.tick}→${E.tick}`);
  } catch (e) { result(5, false, `예외: ${e.message.split('\n')[0]}`); }

  // ── 헤드리스 기준값: 같은 시드·난이도로 Sim 을 따로 돌린다 ──
  let ref = null;
  if (base) {
    const t0 = Date.now();
    const req = { seed: base.seed, difficulty: base.difficulty, ticks: marks.map((m) => m.tick), end: true, shiftLen: 1200, force: null };
    try {
      const out = execFileSync('npx', ['tsx', 'scripts/ui-check-ref.ts', JSON.stringify(req)], { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
      ref = JSON.parse(out.trim().split('\n').pop());
      log(`헤드리스 기준값: 표본 ${marks.length}개, 끝 틱 ${ref.final.tick}, 해시 ${ref.final.reportHash} (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
    } catch (e) { log(`헤드리스 기준값을 얻지 못함 (3·4·5번은 실패로 판정): ${e.message.split('\n')[0]}`); }
  }
  const cmp = (group) => {
    const ms = marks.filter((m) => m.group === group);
    const bad = ms.filter((m) => !ref || ref.hashes[m.tick] !== m.hash || m.seed !== base.seed || !same(m.diff, base.difficulty));
    return { n: ms.length, bad, ticks: [...new Set(ms.map((m) => m.tick))].length };
  };

  if (s3 && !results[3]) {
    const c = cmp(3);
    const ok = s3.btnOk && s3.tlOk && s3.covered && c.bad.length === 0;
    result(3, ok, `되감기 버튼·타임라인 뒤 다시 진행 · 표본 ${c.n}개(틱 ${c.ticks}종) 중 헤드리스와 해시가 다른 것 ${c.bad.length}개`, [
      `되감기 전 틱 ${s3.A.tick} 해시 ${s3.A.hash} → 되감기 버튼 3번 틱 ${s3.Rb.tick} → 앞으로 버튼 3번 틱 ${s3.Fb.tick} 해시 ${s3.Fb.hash} (같은 틱 같은 해시: ${s3.Fb.tick === s3.A.tick && s3.Fb.hash === s3.A.hash})`,
      `타임라인 클릭: 목표 ${s3.want.toFixed(1)}초 → 이동한 시각 ${s3.R.t.toFixed(1)}초(틱 ${s3.R.tick}, 화소당 ${s3.pt.secPerPx.toFixed(2)}초) · 되감기 횟수 ${s3.A.seeks}→${s3.R.seeks}`,
      `다시 진행 표본 ${s3.n}개, 정지한 틱 ${s3.B.tick} 해시 ${s3.B.hash} (헤드리스 ${ref ? ref.hashes[s3.B.tick] : '-'})`,
      ...c.bad.slice(0, 5).map((m) => `다름: ${m.label} 틱 ${m.tick} 화면 ${m.hash} / 헤드리스 ${ref ? ref.hashes[m.tick] : '-'}`),
    ]);
  }
  if (s4 && !results[4]) {
    const c = cmp(4);
    const ok = s4.savedOk && s4.restOk && s4.reloadOk && s4.urlOk && c.bad.length === 0;
    result(4, ok, `저장 ${s4.savedOk ? '맞음' : '틀림'} · 조건 없는 주소로 복원 ${s4.restOk ? '맞음' : '틀림'} · 새로고침 복원 ${s4.reloadOk ? '맞음' : '틀림'} · 주소 조건 고정 ${s4.urlOk ? '맞음' : '틀림'} · 복원 뒤 해시 ${c.n - c.bad.length}/${c.n} 헤드리스와 같음`, [
      `정지 틱 ${s4.P.tick} → 저장된 진행 ${s4.cur ? `시드 ${s4.cur.seed} 틱 ${s4.cur.tick}` : '없음'} → '/' 로 열기: 시드 ${s4.Q.seed}, 복원 틱 ${s4.Q.restoredTicks}, 난이도 같음 ${same(s4.Q.difficulty, s4.P.difficulty)}, 배속 ${s4.Q.speed}(전 ${s4.P.speed}), 자동 감속 ${s4.Q.autoSlow}(전 ${s4.P.autoSlow})`,
      `새로고침: 정지 틱 ${s4.C.tick} 해시 ${s4.C.hash} → 복원 틱 ${s4.D.restoredTicks}, 읽은 틱 ${s4.D.tick} 해시 ${s4.D.hash} (헤드리스 ${ref ? ref.hashes[s4.D.tick] : '-'})`,
      `주소에 시드가 있을 때(?seed=${SEED}) 새로고침: 저장된 틱 ${urlFixed.savedTick}, 복원 틱 ${urlFixed.restoredTicks}, 새로고침 뒤 틱 ${urlFixed.after} (처음부터 다시 시작)`,
      ...c.bad.slice(0, 5).map((m) => `다름: ${m.label} 틱 ${m.tick} 화면 ${m.hash} / 헤드리스 ${ref ? ref.hashes[m.tick] : '-'}`),
    ]);
  }
  if (s5 && !results[5]) {
    const f = ref ? ref.final : null;
    const ok = s5.visible && !!f && s5.shown === f.reportHash && s5.E.reportHash === s5.shown && s5.E.tick === f.tick;
    result(5, ok, s5.visible ? `${maxSpeed}× 로 틱 ${s5.s0.tick}→${s5.E.tick} 진행, ${s5.elapsed.toFixed(1)}초 만에 종료 보고서 뜸 · 보고서 해시 ${s5.shown} / 헤드리스 ${f ? f.reportHash : '-'} (끝 틱 ${s5.E.tick} / ${f ? f.tick : '-'})`
      : `상한 ${END_LIMIT}초 안에 종료 보고서가 뜨지 않음 (틱 ${s5.s0.tick}→${s5.E.tick}, 시각 ${s5.E.t.toFixed(0)}초)`, [`보고서 스크린샷 ${path.join(OUT, 'report.png')}`]);
  }

  // ── 7. 조작 목록 ──
  // 첫 상태는 전부, 다음 상태부터는 새로 나타난 것만 적는다. 버튼·입력은 글자마다, 그 밖의 누를 수 있는 요소(카드·기록 줄 등)는 종류마다 한 번
  const lines = [];
  const seen = new Set();
  let lastNative = '';
  for (const [si, st] of inventory.entries()) {
    const nat = Object.entries(st.native).map(([k, v]) => `${k}: ${v.join(', ') || '-'}`).join(' · ');
    lines.push(`[${st.label}]${nat !== lastNative ? ` 직접 단 처리기 — ${nat}` : ''}`);
    lastNative = nat;
    const groups = new Map();
    for (const it of st.items) {
      const gk = `${it.region} ${it.key}${it.handlers ? ' [' + it.handlers + ']' : ''}`;
      const id = it.control ? `${gk}|${it.text}` : gk;
      if (!groups.has(gk)) groups.set(gk, { control: it.control, texts: [], fresh: [] });
      const g = groups.get(gk);
      g.texts.push(it.text);
      if (!seen.has(id)) { g.fresh.push(it.text); if (it.control) seen.add(id); }
    }
    for (const [gk, g] of groups) {
      if (!g.fresh.length) continue;
      if (!g.control) seen.add(gk);
      const uniq = [...new Set(g.control ? g.fresh : g.texts)];
      const cap = g.control ? 20 : 3;
      lines.push(`  ${gk} ×${g.texts.length}${si && g.control ? ', 새로' : ''}: ${uniq.slice(0, cap).map((t) => `"${t}"`).join(', ')}${uniq.length > cap ? ` 외 ${uniq.length - cap}종` : ''}`);
    }
  }
  result(7, null, `조작 목록 (상태 ${inventory.length}개: ${inventory.map((s) => s.label).join('·')}, 다음 상태부터는 새로 나타난 것만) — AI 에게 명령하는 조작이 없는지는 사람이 판정`, lines);

  // ── 1. 오류 ──
  result(1, errors.length === 0, `콘솔 오류·페이지 오류 ${errors.length}건 (페이지 열기·새로고침 ${loads}회 동안)`, errors.slice(0, 8));
}

(async () => {
  const t0 = Date.now();
  let server = null, fatal = null;
  const stop = async () => { await stopServer(server); };
  process.on('SIGINT', async () => { await stop(); process.exit(130); });
  try {
    server = await startServer();
    console.log(`개발 서버 ${BASE} (pid ${server.pid}) · 시드 ${SEED} · 1600×900 · 스크린샷 ${OUT}`);
    await main();
  } catch (e) { fatal = e; }
  await stop();
  console.log('');
  const names = { 1: '콘솔·페이지 오류', 2: '일시정지·배속', 3: '되감기 재현성', 4: '새로고침 복원', 5: '교대 끝까지', 6: '난이도·재난·현장 화면', 7: '조작 목록' };
  let fail = 0;
  for (let n = 1; n <= 7; n++) {
    const r = results[n] || { ok: false, line: fatal ? '중단되어 판정하지 못함' : '실행되지 않음', details: [] };
    if (r.ok === false) fail++;
    console.log(`[${r.ok === null ? '정보' : r.ok ? '통과' : '실패'}] ${n}. ${names[n]}: ${r.line}`);
    for (const d of r.details) console.log(`      ${d}`);
  }
  if (fatal) { fail++; console.log(`[실패] 중단: ${fatal.stack || fatal.message}`); }
  console.log(`\n${fail ? `실패 ${fail}건` : '모두 통과'} · 걸린 시간 ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  process.exit(fail ? 1 : 0);
})();
