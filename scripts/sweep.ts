// 헤드리스 실행기: 화면 없이 여러 시드를 돌려 결과 분포·교착·재현성을 확인한다.
//   npm run sweep -- 100                 시드 S0~S99 요약 (난이도 보통)
//   npm run sweep -- 60 --diff hard      프리셋(easy|normal|hard|extreme) 또는 "4,4,4,2,3"(빈도,심각도,용의자,장비,신고)
//   npm run sweep -- 40 -v               사건별 한 줄 출력
//   npm run sweep -- 40 --json           요약을 JSON 한 줄로 출력 (자동화용)
//   npm run sweep -- 40 --check          불변 조건을 어기면 종료 코드 1 (커밋 전 관문)
//   npm run sweep -- 1 --log S7          시드 S7 의 전체 이벤트 기록과 보고서
//   npm run sweep -- 30 --scen           시나리오(유형/변형)별 결과 표
//   npm run sweep -- 30 --cat            위험의 현실화(scripts/catstats.ts): 사건이 닫힐 때의 위험 상태(건전도·가스·용기의 열·전소 비율) 줄을 더 낸다
//   npm run sweep -- 20 --force armed/bomb --scen    교대마다 그 시나리오를 초반에 한 번 일으킨다 (새 시나리오 확인용)
//   npm run sweep -- 20 --disaster typhoon           재난을 정해서 (none|random|typhoon|flood|quake|wildfire|tsunami)
//   npm run sweep -- 20 --force water/std --methods  대응 방법(scripts/methodstats.ts): 성공한 방법의 가짓수와 비중, 접은 방법, 방법별 평균 시간, 시나리오별 대원 부상
//   npm run sweep -- 20 --force armed/hostage --doctrine  대응 교본(scripts/doctrinestats.ts): 분야별 등록·쓰인 줄, 줄별 횟수, 판단 지점·교본 행동의 평균 길이, split
//   npm run sweep -- 40 --metrics        측정 지표(scripts/metrics.ts)의 시나리오별 표와 모든 후보 줄
//   npm run sweep -- 12 --hazard         초과 위험 과정의 노출량(scripts/hazstats.ts): 법칙별 칸·넘은 횟수, 도로의 초과 혼잡을 네 몫으로 — 법칙의 세기 상수를 맞추는 데 쓴다 (--json 이면 hazard 칸)
//   (H1) 기본 출력의 injuries: 줄 — 대원 부상·쓰러짐·순직, 용의자 부상·사망(총에 맞아 쓰러진 용의자의 사망 비율·즉사), 잔해 추락, 사람이 없어 멈춘 부대 (scripts/injurystats.ts)
//   npm run sweep -- 10 --no-metrics     표본을 뜨지 않고 지표 줄을 내지 않는다 (속도 비교용)
//   npm run sweep -- 1 --log S7 --metrics            한 교대의 사건마다 가장 긴 원인 사슬과 확산 길
//   (I2) npm run sweep -- 40 --carry <파일>         모든 시드에 같은 이어받은 상태(Carryover JSON, 또는 ar.org.v1 의 { carry } — scripts/chain.ts --dump)를 넣어 돈다.
//        이어받은 상태의 효과를 A/B 로 잴 때 쓴다. 보통의 기준 범위(--check)는 이어받은 상태가 없는 교대만 잰다 — --carry 면 --diff 처럼 구조의 관문만
import { readFileSync } from 'node:fs';
import { NORMAL, difficultyKey, difficultyLabel, parseDifficulty, parseDisaster } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { carryKey, readCarryover } from '../src/sim/persist';      // (I2) --carry
import type { Carryover } from '../src/sim/types';
import { catJson, catLine, catShadowLine, catStats, sumCat } from './catstats';
import type { CatCount } from './catstats';
import { OUTCOME_NAME, TYPE_NAME, fmtClock } from '../src/sim/util';
import { methodJson, methodStats, methodTables, sumMethods } from './methodstats';      // (R2) 대응 방법 집계
import { doctrineJson, doctrineStats, doctrineTables, sumDoctrine } from './doctrinestats';      // (R3) 대응 교본 집계
import { injuryJson, injuryLine, injuryStats, sumInjury } from './injurystats';      // (H1) 부상과 사망 집계
import type { InjuryCount } from './injurystats';
import { chainReport, checkMetrics, formatLines, metricsJson, runWithProbe, shiftMetrics, summarize } from './metrics';
import { HazProbe, hazJson, hazLines, sumHaz } from './hazstats';      // (I1-b) 초과 위험의 노출량
import type { HazCount } from './hazstats';
import type { Probe, ShiftMetrics } from './metrics';

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
// (I2) --carry <파일>: 모든 시드에 같은 이어받은 상태 — 시뮬레이션은 입력을 고치지 않는다(readCarryover 가 검사하며 새 객체로 만든다)
const carryArg = opt('--carry');
let carryIn: Carryover | null = null;
if (carryArg) {
  const raw = JSON.parse(readFileSync(carryArg, 'utf8')) as { v?: unknown; carry?: unknown };
  carryIn = (raw && raw.v === undefined && raw.carry ? raw.carry : raw) as Carryover;
}
const mk = (seed: string): Sim => new Sim(seed, diff!, 1200, carryIn ? { force, carry: carryIn } : { force });
let carryInfo: { shift: number; key: string; dropped: number } | null = null;
if (carryIn) {
  const probeSim = mk('S0');
  if (!probeSim.carryState.on || !probeSim.carry) { console.error(`이어받은 상태를 읽지 못했다: ${carryArg}`); process.exit(2); }
  carryInfo = { shift: probeSim.carry.shift, key: carryKey(probeSim.carry), dropped: readCarryover(carryIn, probeSim.city)!.dropped.length };
  console.error(`이어받은 상태: 조직의 ${carryInfo.shift}번째 교대 · 지문 ${carryInfo.key}${carryInfo.dropped ? ` · 버린 것 ${carryInfo.dropped}줄` : ''} (${carryArg})`);
}
// 측정 지표: 기본으로 켠다(표본 포함). 표본은 상태를 읽기만 하므로 결과가 바뀌지 않는다
const metricsOn = !flag('--no-metrics');
const metricsAll = flag('--metrics');
const hazardOn = flag('--hazard');      // (I1-b) 틱 표본 하나를 더 뜬다 — 읽기만 한다
const byScen: Record<string, Record<string, number>> = {};

if (logSeed) {
  const sim = mk(logSeed);
  const probe = metricsAll ? runWithProbe(sim) : null;
  if (!probe) sim.runToEnd();
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
  if (probe) {
    console.log('\n===== 인과 사슬 (사건마다 가장 긴 원인 사슬과 확산 길) =====');
    for (const line of chainReport(sim)) console.log(line);
    console.log('');
    for (const line of formatLines(summarize([shiftMetrics(sim, probe, { texts: true })]), true)) console.log(line);
  }
  process.exit(0);
}

const out: Record<string, number> = { success: 0, partial: 0, delayed: 0, unresolved: 0, failed: 0 };
const byType: Record<string, Record<string, number>> = {};
const catList: CatCount[] = [];      // (X6) 교대별 위험의 현실화 집계
const prob: Record<string, number> = {};
const closeReasons: Record<string, number> = {};
const methodList: ReturnType<typeof methodStats>[] = [];      // (R2) 교대별 대응 방법 집계
const docList: ReturnType<typeof doctrineStats>[] = [];      // (R3) 교대별 대응 교본 집계
const injuryList: InjuryCount[] = [];      // (H1) 교대별 부상과 사망 집계
const hazList: HazCount[] = [];      // (I1-b) 교대별 초과 위험의 노출량 (--hazard)
let benignN = 0, realGood = 0, realRespSum = 0, realRespN = 0;
let incN = 0, respSum = 0, respN = 0, durSum = 0, ms = 0, errors = 0, casT = 0, casS = 0, casL = 0, casU = 0, hurt = 0, replan = 0, unitSum = 0, maxUnits = 0, open = 0;
const shiftList: (ShiftMetrics | null)[] = [];
const reportHashes: string[] = [];
for (let k = 0; k < n; k++) {
  const seed = 'S' + k;
  const t0 = performance.now();
  let sim: Sim;
  let probe: Probe | null = null;
  let hp: HazProbe | null = null;
  try {
    sim = mk(seed);
    if (hazardOn) hp = new HazProbe(sim);
    const each = hp ? (): void => hp!.tick() : undefined;
    if (metricsOn) probe = runWithProbe(sim, 20000, each);
    else if (each) { let g = 0; while (!sim.ended && g++ < 20000) { sim.step(); each(); } }
    else sim.runToEnd();
  }
  catch (e) { errors++; console.log(`seed ${seed} ERROR:`, (e as Error).stack); continue; }
  ms += performance.now() - t0;
  const r = sim.report;
  if (!r) { console.log(`seed ${seed}: 보고서 없음 (t=${sim.t})`); errors++; continue; }
  for (const I of sim.incidents) if (I.phase !== 'closed' || !I.result) open++;
  catList.push(catStats(sim));
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
  methodList.push(methodStats(sim));
  docList.push(doctrineStats(sim));
  injuryList.push(injuryStats(sim));
  if (hp) hazList.push(hp.done());
  reportHashes.push(r.hash);
  // 측정 도구의 오류는 기존 집계를 바꾸지 않는다: 그 교대의 지표만 null 로 두고 metrics.errors 에 센다
  if (metricsOn) {
    try { shiftList.push(shiftMetrics(sim, probe, { texts: verbose })); }
    catch (e) { shiftList.push(null); console.error(`seed ${seed} 지표 계산 오류:`, (e as Error).stack); }
  }
}
const catSum = sumCat(catList);
const share = (k: string): number => (incN ? out[k] / incN : 0);
const methodSum = sumMethods(methodList);
const docSum = sumDoctrine(docList);
const injurySum = sumInjury(injuryList);
const hazSum = hazardOn ? sumHaz(hazList) : null;
const timeoutShare = incN ? ((closeReasons.timeout ?? 0) + (closeReasons.noresponse ?? 0) + (closeReasons.abandoned ?? 0)) / incN : 0;
const summary = {
  difficulty: difficultyKey(diff), label: difficultyLabel(diff), seeds: n, errors, incidents: incN, perShift: +(incN / n).toFixed(2), msPerShift: Math.round(ms / n),
  catastrophe: catJson(catSum),      // (X6)
  outcomes: out, good: +(share('success') + share('delayed')).toFixed(3), bad: +(share('failed') + share('unresolved')).toFixed(3),
  closeReasons, timeoutShare: +timeoutShare.toFixed(3), avgResponse: Math.round(respSum / Math.max(1, respN)), avgDuration: Math.round(durSum / Math.max(1, incN)),
  casualties: { total: casT, saved: casS, lost: casL, undiscovered: casU, savedRate: +(casS / Math.max(1, casT)).toFixed(3) },
  falseAlarms: benignN, realGood: +(realGood / Math.max(1, incN - benignN)).toFixed(3), realAvgResponse: Math.round(realRespSum / Math.max(1, realRespN)),
  methods: methodJson(methodSum),      // (R2)
  injuries: injuryJson(injurySum),      // (H1)
  unitsPerIncident: +(unitSum / Math.max(1, incN)).toFixed(2), maxUnitsOnOneIncident: maxUnits, respondersHurtPerShift: +(hurt / n).toFixed(2), recoveredShare: +(replan / Math.max(1, incN)).toFixed(3),
};
const metrics = metricsOn ? summarize(shiftList) : null;
/** 시드별 report.hash 를 쉼표로 이어 붙여 FNV-1a (결과 불변 비교용) */
const reportHash = ((): string => { let h = 0x811c9dc5; const s = reportHashes.join(','); for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16); })();
if (flag('--json')) console.log(JSON.stringify({ ...summary, ...(flag('--doctrine') ? { doctrine: doctrineJson(docSum) } : {}), ...(hazSum ? { hazard: hazJson(hazSum) } : {}), ...(carryInfo ? { carry: carryInfo } : {}), problems: prob, reportHash, metrics: metrics ? metricsJson(metrics) : null }));      // (R3) doctrine 칸은 --doctrine 일 때만
else {
  console.log(`\n난이도 ${summary.label} (${summary.difficulty}) · seeds=${n} errors=${errors} incidents=${incN} (${summary.perShift}/shift) avg ${summary.msPerShift}ms/shift`);
  console.log('outcomes:', Object.entries(out).map(([k, v]) => `${k} ${v} (${Math.round((v / Math.max(1, incN)) * 100)}%)`).join(', '));
  for (const t of Object.keys(byType)) console.log(`  ${t}:`, JSON.stringify(byType[t]));
  console.log('close reasons:', JSON.stringify(closeReasons));
  console.log(`avg response ${summary.avgResponse}s, avg duration ${summary.avgDuration}s, units/incident ${summary.unitsPerIncident} (max ${maxUnits})`);
  console.log(`false alarms ${benignN} (${Math.round((benignN / Math.max(1, incN)) * 100)}%); real incidents only: good ${Math.round(summary.realGood * 100)}%, avg response ${summary.realAvgResponse}s`);
  console.log(`casualties total ${casT}, saved ${casS} (${Math.round(summary.casualties.savedRate * 100)}%), lost ${casL}, undiscovered ${casU}; responders hurt/shift ${summary.respondersHurtPerShift}`);
  console.log(`incidents with a recovered problem: ${Math.round(summary.recoveredShare * 100)}%`);
  console.log(injuryLine(injurySum));      // (H1)
  if (flag('--scen')) {
    console.log('scenarios (n · 성공 · 부분 · 지연 · 미해결 · 실패 | 한계시간·무대응·방치 | 평균 시간 · 평균 부대):');
    for (const k of Object.keys(byScen).sort()) { const b = byScen[k]; console.log(`  ${k.padEnd(20)} ${String(b.n).padStart(4)} · ${b.success ?? 0} · ${b.partial ?? 0} · ${b.delayed ?? 0} · ${b.unresolved ?? 0} · ${b.failed ?? 0} | ${b.timeout ?? 0}·${b.noresponse ?? 0}·${b.abandoned ?? 0} | ${Math.round(b.dur / b.n)}s · ${(b.units / b.n).toFixed(1)}`); }
  }
  console.log('problems (incidents affected):', Object.entries(prob).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  if (flag('--methods')) for (const line of methodTables(methodSum)) console.log(line);
  if (flag('--doctrine')) for (const line of doctrineTables(docSum)) console.log(line);
  console.log(catLine(catSum));
  if (flag('--cat')) console.log(catShadowLine(catSum));
  if (metrics) for (const line of formatLines(metrics, metricsAll)) console.log(line);
  if (hazSum) for (const line of hazLines(hazSum)) console.log(line);
}
if (flag('--check')) {
  const fail: string[] = [];
  if (errors > 0) fail.push(`예외 ${errors}건`);
  if (open > 0) fail.push(`끝나지 않은 사건 ${open}건`);
  if (!diffArg && !disArg && !force && !carryArg) {
    if (timeoutShare > 0.04) fail.push(`한계 시간·무대응 종료 비율 ${(timeoutShare * 100).toFixed(1)}% > 4%`);
    // 난이도 보통의 기준 범위. 균형을 의도적으로 바꿨다면 이 범위와 docs/ROADMAP.md 의 기준 수치를 함께 고친다.
    if (summary.good < 0.65 || summary.good > 0.9) fail.push(`성공+대응 지연 ${(summary.good * 100).toFixed(0)}% 가 65~90% 를 벗어남`);
    if (summary.bad < 0.03 || summary.bad > 0.25) fail.push(`실패+미해결 ${(summary.bad * 100).toFixed(0)}% 가 3~25% 를 벗어남`);
    if (summary.avgResponse > 90) fail.push(`평균 대응 시간 ${summary.avgResponse}초 > 90초`);
  }
  // 측정 지표의 관문 (scripts/metrics.ts checkMetrics): 구조의 불변 조건은 언제나, 교착 래칫은 보통 기본 조건에서만
  if (metrics) fail.push(...checkMetrics(metrics, { baseline: !diffArg && !disArg && !force && !carryArg }));
  else console.error('지표 관문 건너뜀 (--no-metrics)');
  if (fail.length) { console.error('\n검증 실패:\n - ' + fail.join('\n - ')); process.exit(1); }
  // --json 과 함께면 JSON 한 줄이 깨지지 않게 stderr 로
  if (flag('--json')) console.error('\n검증 통과'); else console.log('\n검증 통과');
}
