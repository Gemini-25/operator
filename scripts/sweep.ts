// 헤드리스 실행기: 화면 없이 여러 시드를 돌려 결과 분포·교착·재현성을 확인한다.
//   npm run sweep -- 100                 시드 S0~S99 요약 (난이도 보통)
//   npm run sweep -- 60 --diff hard      프리셋(easy|normal|hard|extreme) 또는 "4,4,4,2,3"(빈도,심각도,용의자,장비,신고)
//   npm run sweep -- 40 -v               사건별 한 줄 출력
//   npm run sweep -- 40 --json           요약을 JSON 한 줄로 출력 (자동화용)
//   npm run sweep -- 40 --check          불변 조건을 어기면 종료 코드 1 (커밋 전 관문)
//   npm run sweep -- 1 --log S7          시드 S7 의 전체 이벤트 기록과 보고서
//   npm run sweep -- 30 --scen           시나리오(유형/변형)별 결과 표
//   npm run sweep -- 20 --force armed/bomb --scen    교대마다 그 시나리오를 초반에 한 번 일으킨다 (새 시나리오 확인용)
//   npm run sweep -- 20 --disaster typhoon           재난을 정해서 (none|random|typhoon|flood|quake|wildfire|tsunami)
import { NORMAL, difficultyKey, difficultyLabel, parseDifficulty, parseDisaster } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { OUTCOME_NAME, TYPE_NAME, fmtClock } from '../src/sim/util';

const args = process.argv.slice(2);
const n = parseInt(args[0] ?? '20', 10);
const opt = (name: string): string | null => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] ?? null : null; };
const flag = (name: string): boolean => args.indexOf(name) >= 0;
const logSeed = opt('--log');
const verbose = flag('-v');
const diffArg = opt('--diff');
let diff = diffArg ? parseDifficulty(diffArg) : { ...NORMAL };
if (!diff) { console.error(`알 수 없는 난이도: ${diffArg}`); process.exit(2); }
const disArg = opt('--disaster');
if (disArg) { const dz = parseDisaster(disArg); if (!dz) { console.error(`알 수 없는 재난: ${disArg}`); process.exit(2); } diff = { ...diff, disaster: dz }; }
const force = opt('--force');
const mk = (seed: string): Sim => new Sim(seed, diff!, 1200, { force });
const byScen: Record<string, Record<string, number>> = {};

if (logSeed) {
  const sim = mk(logSeed);
  sim.runToEnd();
  for (const e of sim.events) {
    if (e.importance < 1 && !verbose) continue;
    console.log(`${fmtClock(sim.startTod + e.t)} [${e.incidentId >= 0 ? sim.incidents[e.incidentId].code : '--'}] ${e.truth ? '(진실) ' : ''}${e.role}/${e.actor}: ${e.text}`);
  }
  console.log('\n===== 보고서 =====');
  const r = sim.report!;
  for (const line of r.summary) console.log(line);
  for (const inc of r.incidents) {
    console.log(`\n[${inc.code}] ${TYPE_NAME[inc.type]} · ${inc.label} → ${OUTCOME_NAME[inc.result.outcome]} | ${inc.result.headline}`);
    for (const a of inc.result.analysis) console.log('   - ' + a);
  }
  process.exit(0);
}

const out: Record<string, number> = { success: 0, partial: 0, delayed: 0, unresolved: 0, failed: 0 };
const byType: Record<string, Record<string, number>> = {};
const prob: Record<string, number> = {};
const closeReasons: Record<string, number> = {};
let benignN = 0, realGood = 0, realRespSum = 0, realRespN = 0;
let incN = 0, respSum = 0, respN = 0, durSum = 0, ms = 0, errors = 0, casT = 0, casS = 0, casL = 0, casU = 0, hurt = 0, replan = 0, unitSum = 0, maxUnits = 0, open = 0;
for (let k = 0; k < n; k++) {
  const seed = 'S' + k;
  const t0 = performance.now();
  let sim: Sim;
  try { sim = mk(seed); sim.runToEnd(); }
  catch (e) { errors++; console.log(`seed ${seed} ERROR:`, (e as Error).stack); continue; }
  ms += performance.now() - t0;
  const r = sim.report;
  if (!r) { console.log(`seed ${seed}: 보고서 없음 (t=${sim.t})`); errors++; continue; }
  for (const I of sim.incidents) if (I.phase !== 'closed' || !I.result) open++;
  for (const inc of r.incidents) {
    incN++;
    out[inc.result.outcome]++;
    byType[inc.type] = byType[inc.type] ?? {};
    byType[inc.type][inc.result.outcome] = (byType[inc.type][inc.result.outcome] ?? 0) + 1;
    if (inc.result.responseTime >= 0) { respSum += inc.result.responseTime; respN++; }
    durSum += inc.result.duration;
    casT += inc.result.casTotal; casS += inc.result.casSaved; casL += inc.result.casLost; casU += inc.result.casUndiscovered;
    const I = sim.incidents[inc.id];
    // 허위·오인 신고는 본질적으로 쉬운 사건이라 따로 센다
    if (I.truth.variant === 'false' || I.truth.variant === 'prank') benignN++;
    else { if (inc.result.outcome === 'success' || inc.result.outcome === 'delayed') realGood++; if (inc.result.responseTime >= 0) { realRespSum += inc.result.responseTime; realRespN++; } }
    unitSum += I.everAssigned.length; maxUnits = Math.max(maxUnits, I.everAssigned.length);
    closeReasons[I.closeReason] = (closeReasons[I.closeReason] ?? 0) + 1;
    { const key = `${I.truth.type}/${I.truth.variant}`, b = (byScen[key] = byScen[key] ?? {}); b.n = (b.n ?? 0) + 1; b[inc.result.outcome] = (b[inc.result.outcome] ?? 0) + 1; if (I.closeReason !== 'resolved') b[I.closeReason] = (b[I.closeReason] ?? 0) + 1; b.dur = (b.dur ?? 0) + inc.result.duration; b.units = (b.units ?? 0) + I.everAssigned.length; }
    const seen = new Set<string>();
    for (const p of I.problems) { if (!seen.has(p.code)) { seen.add(p.code); prob[p.code] = (prob[p.code] ?? 0) + 1; } }
    if (I.problems.some((p) => p.recovered && p.recoveryText)) replan++;
    if (verbose) console.log(`${seed} [${inc.code}] ${inc.type}/${I.truth.variant} sev${I.truth.severity} → ${inc.result.outcome} (${I.closeReason}) rt=${Math.round(inc.result.responseTime)} dur=${Math.round(inc.result.duration)} units=${I.everAssigned.length} | ${inc.result.headline}`);
  }
  hurt += r.respondersHurt.length;
}
const share = (k: string): number => (incN ? out[k] / incN : 0);
const timeoutShare = incN ? ((closeReasons.timeout ?? 0) + (closeReasons.noresponse ?? 0) + (closeReasons.abandoned ?? 0)) / incN : 0;
const summary = {
  difficulty: difficultyKey(diff), label: difficultyLabel(diff), seeds: n, errors, incidents: incN, perShift: +(incN / n).toFixed(2), msPerShift: Math.round(ms / n),
  outcomes: out, good: +(share('success') + share('delayed')).toFixed(3), bad: +(share('failed') + share('unresolved')).toFixed(3),
  closeReasons, timeoutShare: +timeoutShare.toFixed(3), avgResponse: Math.round(respSum / Math.max(1, respN)), avgDuration: Math.round(durSum / Math.max(1, incN)),
  casualties: { total: casT, saved: casS, lost: casL, undiscovered: casU, savedRate: +(casS / Math.max(1, casT)).toFixed(3) },
  falseAlarms: benignN, realGood: +(realGood / Math.max(1, incN - benignN)).toFixed(3), realAvgResponse: Math.round(realRespSum / Math.max(1, realRespN)),
  unitsPerIncident: +(unitSum / Math.max(1, incN)).toFixed(2), maxUnitsOnOneIncident: maxUnits, respondersHurtPerShift: +(hurt / n).toFixed(2), recoveredShare: +(replan / Math.max(1, incN)).toFixed(3),
};
if (flag('--json')) console.log(JSON.stringify(summary));
else {
  console.log(`\n난이도 ${summary.label} (${summary.difficulty}) · seeds=${n} errors=${errors} incidents=${incN} (${summary.perShift}/shift) avg ${summary.msPerShift}ms/shift`);
  console.log('outcomes:', Object.entries(out).map(([k, v]) => `${k} ${v} (${Math.round((v / Math.max(1, incN)) * 100)}%)`).join(', '));
  for (const t of Object.keys(byType)) console.log(`  ${t}:`, JSON.stringify(byType[t]));
  console.log('close reasons:', JSON.stringify(closeReasons));
  console.log(`avg response ${summary.avgResponse}s, avg duration ${summary.avgDuration}s, units/incident ${summary.unitsPerIncident} (max ${maxUnits})`);
  console.log(`false alarms ${benignN} (${Math.round((benignN / Math.max(1, incN)) * 100)}%); real incidents only: good ${Math.round(summary.realGood * 100)}%, avg response ${summary.realAvgResponse}s`);
  console.log(`casualties total ${casT}, saved ${casS} (${Math.round(summary.casualties.savedRate * 100)}%), lost ${casL}, undiscovered ${casU}; responders hurt/shift ${summary.respondersHurtPerShift}`);
  console.log(`incidents with a recovered problem: ${Math.round(summary.recoveredShare * 100)}%`);
  if (flag('--scen')) {
    console.log('scenarios (n · 성공 · 부분 · 지연 · 미해결 · 실패 | 한계시간·무대응·방치 | 평균 시간 · 평균 부대):');
    for (const k of Object.keys(byScen).sort()) { const b = byScen[k]; console.log(`  ${k.padEnd(20)} ${String(b.n).padStart(4)} · ${b.success ?? 0} · ${b.partial ?? 0} · ${b.delayed ?? 0} · ${b.unresolved ?? 0} · ${b.failed ?? 0} | ${b.timeout ?? 0}·${b.noresponse ?? 0}·${b.abandoned ?? 0} | ${Math.round(b.dur / b.n)}s · ${(b.units / b.n).toFixed(1)}`); }
  }
  console.log('problems (incidents affected):', Object.entries(prob).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
}
if (flag('--check')) {
  const fail: string[] = [];
  if (errors > 0) fail.push(`예외 ${errors}건`);
  if (open > 0) fail.push(`끝나지 않은 사건 ${open}건`);
  if (!diffArg && !disArg && !force) {
    if (timeoutShare > 0.04) fail.push(`한계 시간·무대응 종료 비율 ${(timeoutShare * 100).toFixed(1)}% > 4%`);
    // 난이도 보통의 기준 범위. 균형을 의도적으로 바꿨다면 이 범위와 docs/ROADMAP.md 의 기준 수치를 함께 고친다.
    if (summary.good < 0.65 || summary.good > 0.9) fail.push(`성공+대응 지연 ${(summary.good * 100).toFixed(0)}% 가 65~90% 를 벗어남`);
    if (summary.bad < 0.03 || summary.bad > 0.25) fail.push(`실패+미해결 ${(summary.bad * 100).toFixed(0)}% 가 3~25% 를 벗어남`);
    if (summary.avgResponse > 90) fail.push(`평균 대응 시간 ${summary.avgResponse}초 > 90초`);
  }
  if (fail.length) { console.error('\n검증 실패:\n - ' + fail.join('\n - ')); process.exit(1); }
  console.log('\n검증 통과');
}
