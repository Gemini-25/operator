// 헤드리스 실행기: 화면 없이 여러 시드를 돌려 결과 분포·교착·재현성을 확인한다.
//   npm run sweep -- 100          → 시드 100개 요약
//   npm run sweep -- 1 --log S7   → 시드 S7 의 전체 이벤트 로그 출력
import { Sim } from '../src/sim/engine';
import { fmtClock, OUTCOME_NAME, TYPE_NAME } from '../src/sim/util';

const args = process.argv.slice(2);
const n = parseInt(args[0] ?? '20', 10);
const logIdx = args.indexOf('--log');
const logSeed = logIdx >= 0 ? args[logIdx + 1] : null;
const verbose = args.indexOf('-v') >= 0;

if (logSeed) {
  const sim = new Sim(logSeed);
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

const out: Record<string, number> = {};
const byType: Record<string, Record<string, number>> = {};
const prob: Record<string, number> = {};
let incN = 0, respSum = 0, respN = 0, durSum = 0, ms = 0, errors = 0, casT = 0, casS = 0, casL = 0, casU = 0, hurt = 0, replan = 0;
const closeReasons: Record<string, number> = {};
for (let k = 0; k < n; k++) {
  const seed = 'S' + k;
  const t0 = performance.now();
  let sim: Sim;
  try {
    sim = new Sim(seed);
    sim.runToEnd();
  } catch (e) {
    errors++;
    console.log(`seed ${seed} ERROR:`, (e as Error).stack);
    continue;
  }
  ms += performance.now() - t0;
  const r = sim.report!;
  if (!r) { console.log(`seed ${seed}: no report (t=${sim.t})`); errors++; continue; }
  for (const inc of r.incidents) {
    incN++;
    out[inc.result.outcome] = (out[inc.result.outcome] ?? 0) + 1;
    byType[inc.type] = byType[inc.type] ?? {};
    byType[inc.type][inc.result.outcome] = (byType[inc.type][inc.result.outcome] ?? 0) + 1;
    if (inc.result.responseTime >= 0) { respSum += inc.result.responseTime; respN++; }
    durSum += inc.result.duration;
    casT += inc.result.casTotal; casS += inc.result.casSaved; casL += inc.result.casLost; casU += inc.result.casUndiscovered;
    const I = sim.incidents[inc.id];
    closeReasons[I.closeReason] = (closeReasons[I.closeReason] ?? 0) + 1;
    const seen = new Set<string>();
    for (const p of I.problems) { if (!seen.has(p.code)) { seen.add(p.code); prob[p.code] = (prob[p.code] ?? 0) + 1; } }
    if (I.problems.some((p) => p.recovered && p.recoveryText)) replan++;
    if (verbose) console.log(`${seed} [${inc.code}] ${inc.type}/${I.truth.variant} sev${I.truth.severity} → ${inc.result.outcome} (${I.closeReason}) rt=${Math.round(inc.result.responseTime)} dur=${Math.round(inc.result.duration)} | ${inc.result.headline}`);
  }
  hurt += r.respondersHurt.length;
}
console.log(`\nseeds=${n} errors=${errors} incidents=${incN} (${(incN / n).toFixed(1)}/shift) avg ${Math.round(ms / n)}ms/shift`);
console.log('outcomes:', Object.entries(out).map(([k, v]) => `${k} ${v} (${Math.round((v / incN) * 100)}%)`).join(', '));
for (const t of Object.keys(byType)) console.log(`  ${t}:`, JSON.stringify(byType[t]));
console.log('close reasons:', JSON.stringify(closeReasons));
console.log(`avg response ${Math.round(respSum / respN)}s, avg duration ${Math.round(durSum / incN)}s`);
console.log(`casualties total ${casT}, saved ${casS} (${Math.round((casS / casT) * 100)}%), lost ${casL}, undiscovered ${casU}; responders hurt/shift ${(hurt / n).toFixed(2)}`);
console.log(`incidents with a recovered problem: ${Math.round((replan / incN) * 100)}%`);
console.log('problems (incidents affected):', Object.entries(prob).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
