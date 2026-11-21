// 교대를 이어 돌리는 측정 (I2 — docs/specs/I2-persistence.md §6.2·§6.3). 계보 L 의 k번째 교대는 시드 C<L>.<k> 이고,
// 첫 교대는 이어받은 상태 없이, 그 뒤는 앞 교대가 만든 상태(makeCarryover — JSON 왕복을 거친 것)를 입력으로 받는다.
//   npx tsx scripts/chain.ts 12 8                       계보 12개 × 교대 8번 (보통)
//   npx tsx scripts/chain.ts 12 8 --diff hard           난이도 (sweep 과 같은 글: 프리셋 또는 "4,4,4,2,3,3")
//   npx tsx scripts/chain.ts 12 6 --disaster quake@1    첫 교대에만 지진, 그 뒤는 없음 — 회복을 본다 (kind@k = k번째 교대만, kind = 모든 교대)
//   npx tsx scripts/chain.ts 12 8 --json                한 줄 JSON
//   npx tsx scripts/chain.ts 24 8 --check               §6.3 의 기준(1~7)을 어기면 종료 코드 1 (--check 의 기본 계보 수는 24).
//                                                       보통·재난 없음이면 기준 6(지진 뒤 회복)을 위해 --disaster quake@1 의 12 × 6 을 이어서 돈다.
//                                                       단계 8 에서 정한 꼴: 6 의 결장은 교대 5(지진의 가장 긴 결장 3교대가 끝난 첫 교대) · 7 의 교착 후보는
//                                                       같은 시드·조건을 이어받은 상태 없이 돈 대조군과 견준다(STALL_SLACK) — 대조군 때문에 --check 는 교대를 두 배 돈다
//   npx tsx scripts/chain.ts 1 4 --dump <폴더>          계보 C0 의 교대마다 이어받은 상태를 JSON 파일로 (화면 확인용 — 저장소 밖에):
//                                                       C0.<k>.carry.json (Carryover) · C0.<k>.org.json (ar.org.v1 의 모양 { id, carry, savedAt })
//   npx tsx scripts/chain.ts 12 --soot                  (§6.3 의 8 — 측정만) 같은 건물·같은 사건 시드의 화재를 그을음 0 과 0.6 으로 —
//                                                       소실률·BURNOUT·X6 탄 비율·이번 교대에 탄 칸 (--sev 2,3 · --place <건물 id>)
//   --paired                                            (진단) 교대 2 부터 같은 시드·같은 조건을 이어받은 상태 없이 한 번 더 돌려 (성공+지연)의 짝 차이를 낸다 —
//                                                       시드의 차이를 빼고 이어받은 상태의 몫만 본다 (시간 두 배)
//   --strip absent,vacant,growth,units,places,roads,stock  (진단) 다음 교대로 넘기기 전에 그 몫을 지운다 — 어느 몫이 결과를 바꾸는지 가린다(--paired 와 함께)
//                                                       absent = 결장(out > 0 → 0) · vacant = 공석(→ 처음 상태) · growth = 경험·숙련 · units = 펌프·정비 · places · roads · stock = 섬광탄 창고
//   -v                                                  교대마다 한 줄 · 모은 지표 줄(scripts/metrics.ts)
// I1-a 의 측정 도구를 쓴다: 교대마다 runWithProbe(runToEnd 와 결과가 같다) → shiftMetrics, 교대 번호마다 summarize → checkMetrics.
// 측정은 상태를 읽기만 한다 — 이 대본은 src/sim 의 함수를 Sim 을 만들고 돌리고 이어받을 상태를 만드는 데만 부른다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NORMAL, difficultyKey, difficultyLabel, parseDifficulty, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty, DisasterChoice } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { createIncident } from '../src/sim/incidents';
import { INCIDENT_PLACES } from '../src/sim/cityPlan';
import { CLOSED_CAP, ROAD_CAP, absentCap, carryKey, carrySummary, makeCarryover, readCarryover } from '../src/sim/persist';
import type { Carryover, PlaceCarry } from '../src/sim/types';
import { PHRASE, checkMetrics, formatLines, runWithProbe, shiftMetrics, stallLine, summarize } from './metrics';
import type { ShiftMetrics } from './metrics';

const args = process.argv.slice(2);
const opt = (name: string): string | null => { const k = args.indexOf(name); return k >= 0 ? args[k + 1] ?? null : null; };
const flag = (name: string): boolean => args.indexOf(name) >= 0;
const pos: number[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('-')) { if (['--diff', '--disaster', '--dump', '--sev', '--place', '--strip'].indexOf(args[i]) >= 0) i++; continue; }
  const v = parseInt(args[i], 10);
  if (Number.isFinite(v)) pos.push(v);
}
const checkOn = flag('--check'), jsonOn = flag('--json'), verbose = flag('-v');
/** 같은 시드·조건을 이어받은 상태 없이 한 번 더 돈다 — --paired(진단), --check(기준 7 의 대조군: 교착 후보를 같은 시드의 새 교대와 견준다) */
const pairedOn = flag('--paired') || checkOn;
const L = pos[0] ?? (checkOn ? 24 : 12);
const K = pos[1] ?? 8;
const diffArg = opt('--diff');
const base0 = diffArg ? parseDifficulty(diffArg) : { ...NORMAL };
if (!base0) { console.error(`알 수 없는 난이도: ${diffArg}`); process.exit(2); }
const base: Difficulty = base0;
/** --disaster kind[@k]: 그 재난을 k번째 교대에만(없으면 모든 교대에) */
function parseDis(text: string | null): { kind: DisasterChoice; at: number | null } | null {
  if (!text) return null;
  const [k, at] = text.split('@');
  const kind = parseDisaster(k);
  if (!kind) { console.error(`알 수 없는 재난: ${text}`); process.exit(2); }
  const n = at === undefined ? null : parseInt(at, 10);
  if (n !== null && !(n >= 1)) { console.error(`재난의 교대 번호가 틀렸다: ${text}`); process.exit(2); }
  return { kind, at: n };
}
const disArg = parseDis(opt('--disaster'));
/** --strip: 다음 교대로 넘기기 전에 지울 몫 (진단 — 손으로 만든 입력이 된다) */
const STRIP = new Set((opt('--strip') ?? '').split(',').filter((x) => x));
function strip(co: Carryover): Carryover {
  if (!STRIP.size) return co;
  const o = JSON.parse(JSON.stringify(co)) as Carryover;
  for (const c of o.crew) {
    if (STRIP.has('absent') && c.out > 0) { c.out = 0; c.cause = null; c.health = 100; }
    if (STRIP.has('vacant') && c.out === -1) { c.out = 0; c.cause = null; c.health = 100; delete c.replaceIn; }
    if (STRIP.has('growth')) { c.dExp = 0; c.dSkill = 0; }
  }
  if (STRIP.has('units')) o.units = [];
  if (STRIP.has('places')) o.places = [];
  if (STRIP.has('roads')) o.roads = [];
  if (STRIP.has('stock')) o.stock = {};
  return o;
}
/** 지금 도는 실행의 재난 (기준 6 의 회복 실행이 잠시 바꾼다) */
let disNow = disArg;

// ───────────────────────── 교대 하나 ─────────────────────────
/** 교대 하나의 기록 (끝난 교대를 읽기만 한다) */
interface ShiftRow {
  lineage: number; k: number; seed: string; error: string | null;
  n: number; out: Record<string, number>; timeouts: number; respSum: number; respN: number; good: number;      // good = 이 교대의 (성공 + 지연) 비율
  open: number;
  // 이 교대가 받아 쓴 이어받은 상태 (교대 1 은 0)
  absent: number; fallen: number; relief: number; service: number; closed: number; ruin: number; marked: number; roads: number;
  expMean: number; expMax: number; early: number;
  pumpStart: number; pumpFails: number;      // 소방 부서 부대의 교대 시작 펌프 상태 평균 · 이번 교대에 펌프가 고장 난 횟수 (진단 — 장비 손잡이의 범위와 이어받은 위치)
  shortRuns: number; markedInc: number; links: number; linksInc: number;
  summaryLines: number; summaryKeyOk: boolean;
  // 이 교대가 만든 상태 (다음 교대로 넘기는 것)
  next: { absent: number; fallen: number; service: number; closed: number; ruin: number; marked: number; roads: number } | null;
  roundtripOk: boolean;
  capFails: string[];
  m: ShiftMetrics | null;
  fresh: number | null;          // --paired: 같은 시드·조건을 이어받은 상태 없이 돌린 교대의 (성공 + 지연) 비율
  freshStall: number; freshForgot: number;      // 그 대조 교대의 교착 후보·잊힌 사건 (표본 — 기준 7)
}
const zeroOut = (): Record<string, number> => ({ success: 0, delayed: 0, partial: 0, unresolved: 0, failed: 0 });

/** 교대 하나를 돌리고 읽는다. 다음 교대가 받을 상태(JSON 왕복을 거친 것)를 함께 돌려준다 — 예외면 null */
function runShift(lineage: number, k: number, carry: Carryover | null): { row: ShiftRow; next: Carryover | null } {
  const seed = `C${lineage}.${k}`;
  const d: Difficulty = disNow && (disNow.at === null || disNow.at === k) ? { ...base, disaster: disNow.kind } : base;
  const row: ShiftRow = {
    lineage, k, seed, error: null, n: 0, out: zeroOut(), timeouts: 0, respSum: 0, respN: 0, good: 0, open: 0,
    absent: 0, fallen: 0, relief: 0, service: 0, closed: 0, ruin: 0, marked: 0, roads: 0, expMean: 0, expMax: 0, early: 0, pumpStart: 0, pumpFails: 0,
    shortRuns: 0, markedInc: 0, links: 0, linksInc: 0, summaryLines: 0, summaryKeyOk: true, next: null, roundtripOk: true, capFails: [], m: null, fresh: null, freshStall: 0, freshForgot: 0,
  };
  let sim: Sim;
  try {
    sim = new Sim(seed, d, 1200, carry ? { carry } : {});
    { let ps = 0, pn = 0; for (const u of sim.units) if (u.dept === 'fire' && !u.aid) { ps += u.pumpCond; pn++; } row.pumpStart = pn ? ps / pn : 0; }
    const probe = runWithProbe(sim);
    for (const u of sim.units) if (!u.aid) row.pumpFails += u.pumpFails ?? 0;
    try { row.m = shiftMetrics(sim, probe); } catch (e) { row.m = null; console.error(`${seed} 지표 계산 오류:`, (e as Error).stack); }
  } catch (e) { row.error = (e as Error).stack ?? String(e); return { row, next: null }; }
  const r = sim.report;
  if (!r) { row.error = `보고서 없음 (t=${sim.t})`; return { row, next: null }; }
  // 결과 (sweep.ts 와 같은 식)
  for (const inc of r.incidents) {
    row.n++; row.out[inc.result.outcome]++;
    if (inc.result.responseTime >= 0) { row.respSum += inc.result.responseTime; row.respN++; }
    const I = sim.incidents[inc.id];
    if (I.closeReason === 'timeout' || I.closeReason === 'noresponse' || I.closeReason === 'abandoned') row.timeouts++;
  }
  for (const I of sim.incidents) if (I.phase !== 'closed' || !I.result) row.open++;
  row.good = row.n ? (row.out.success + row.out.delayed) / row.n : 0;
  // 받아 쓴 이어받은 상태
  const cs = sim.carryState;
  let fielded = 0;
  for (const p of sim.responders) {
    if (p.relief || sim.units[p.unitId].aid) continue;
    fielded++;
    if (p.status === 'off') { if (p.carryOut === -1) row.fallen++; else row.absent++; }
  }
  row.relief = cs.stats.relief; row.early = cs.stats.early;
  for (const n of cs.applied) { if (n.what === 'service') row.service++; else if (n.what === 'road') row.roads++; }
  for (const p of cs.places.values()) { if (p.state === 'ruin') row.ruin++; else if (p.state === 'closed') row.closed++; else row.marked++; }
  if (carry && carry.crew.length) {
    let s = 0;
    for (const c of carry.crew) { s += c.dExp; if (c.dExp > row.expMax) row.expMax = c.dExp; }
    row.expMean = s / carry.crew.length;
  }
  row.markedInc = cs.stats.markedInc.length;
  // 요약 줄(문구 규칙 T5)과 그것을 원인으로 한 기록
  const key = carry ? carryKey(carry) : '';
  for (const e of sim.events) if (PHRASE.T5.test(e.text)) { row.summaryLines++; if (!carry || e.text.indexOf(`(지문 ${key})`) < 0 || e.id !== cs.event) row.summaryKeyOk = false; }
  if (cs.on && cs.event >= 0) {
    const short = new Set<number>();
    for (let i = cs.event + 1; i < sim.events.length; i++) {
      const e = sim.events[i];
      if (e.causes.indexOf(cs.event) < 0) continue;
      row.links++;
      if (e.incidentId >= 0) { row.linksInc++; if (e.kind === 'arrive') short.add(e.incidentId); }
    }
    row.shortRuns = short.size;
  }
  // 상한 (§6.3 의 2): 받아 쓴 상태
  if (row.absent > absentCap(fielded)) row.capFails.push(`결장 ${row.absent} > 상한 ${absentCap(fielded)}`);
  if (row.closed + row.ruin > CLOSED_CAP) row.capFails.push(`출입 통제·무너짐 ${row.closed + row.ruin} > ${CLOSED_CAP}`);
  if (row.roads > ROAD_CAP) row.capFails.push(`복구 도로 ${row.roads} > ${ROAD_CAP}`);
  // 만든 상태 (다음 교대로 넘기는 것) + 왕복 검사: JSON 왕복 뒤 readCarryover 의 지문이 같고 버린 것이 없다
  let next: Carryover | null = null;
  try {
    const co = makeCarryover(sim);
    const sm = carrySummary(co);
    row.next = { absent: sm.absent, fallen: sm.fallen, service: sm.service, closed: sm.closed, ruin: sm.ruin, marked: sm.marked, roads: sm.roads };
    if (sm.closed + sm.ruin > CLOSED_CAP) row.capFails.push(`다음 상태의 출입 통제·무너짐 ${sm.closed + sm.ruin} > ${CLOSED_CAP}`);
    if (sm.roads > ROAD_CAP) row.capFails.push(`다음 상태의 복구 도로 ${sm.roads} > ${ROAD_CAP}`);
    const wire = JSON.parse(JSON.stringify(co)) as Carryover;
    const rc = readCarryover(wire, sim.city);
    if (!rc || carryKey(rc.carry) !== carryKey(co) || rc.dropped.length) row.roundtripOk = false;
    next = strip(wire);
  } catch (e) { row.error = `makeCarryover: ${(e as Error).stack ?? String(e)}`; }
  if (pairedOn && carry) {
    const f = new Sim(seed, d, 1200, {});
    const fp = runWithProbe(f);
    try { const fm = shiftMetrics(f, fp); row.freshStall = fm.stall?.length ?? 0; row.freshForgot = fm.forgotten?.length ?? 0; } catch { row.freshStall = 0; }
    let n = 0, g = 0;
    for (const inc of f.report!.incidents) { n++; if (inc.result.outcome === 'success' || inc.result.outcome === 'delayed') g++; }
    row.fresh = n ? g / n : 0;
  }
  return { row, next };
}

// ───────────────────────── 모으기 ─────────────────────────
interface ByShift {
  k: number; n: number; shifts: number;
  success: number; delayed: number; partial: number; bad: number; good: number; timeoutShare: number; resp: number;
  absent: number; fallen: number; relief: number; service: number; closed: number; ruin: number; marked: number; roads: number;
  expMean: number; expMax: number; shortRuns: number; markedInc: number; links: number; linksInc: number; pumpStart: number; pumpFails: number;
  m: { spreadGe3: number; worldLinks: number; contention: number; stall: number | null; forgotten: number | null; replan: number; carryShare: number; metricFails: number };
  fails: string[];
}
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function byShift(rows: ShiftRow[], k: number, baseline: boolean): ByShift {
  const rs = rows.filter((r) => r.k === k && r.error === null);
  const out = zeroOut();
  let n = 0, to = 0, rsum = 0, rn = 0;
  for (const r of rs) { n += r.n; to += r.timeouts; rsum += r.respSum; rn += r.respN; for (const x of Object.keys(out)) out[x] += r.out[x]; }
  const sh = (x: number): number => (n ? x / n : 0);
  const avg = (f: (r: ShiftRow) => number): number => r3(mean(rs.map(f)));
  const ms = summarize(rs.map((r) => r.m));
  // 기준 7 (§6.3): 구조의 관문(지표 계산 오류·연쇄 깊이·교대당 연쇄·기록 일치 C1~C5·장부의 구멍·법칙 사건 상한)은 교대 번호마다 그대로 건다.
  // 교착 후보·잊힌 사건은 sweep 처럼 정해진 시드(S0~S39)의 래칫이 아니라 대조군과 견준다 — 아래 stallCheck (baseline 은 표의 '관문' 칸에만 쓰지 않는다)
  void baseline;
  const fails = checkMetrics(ms, { baseline: false });
  return {
    k, n, shifts: rs.length,
    success: r3(sh(out.success)), delayed: r3(sh(out.delayed)), partial: r3(sh(out.partial)), bad: r3(sh(out.failed + out.unresolved)), good: r3(sh(out.success + out.delayed)),
    timeoutShare: r3(sh(to)), resp: Math.round(rn ? rsum / rn : 0),
    absent: avg((r) => r.absent), fallen: avg((r) => r.fallen), relief: avg((r) => r.relief), service: avg((r) => r.service),
    closed: avg((r) => r.closed), ruin: avg((r) => r.ruin), marked: avg((r) => r.marked), roads: avg((r) => r.roads),
    expMean: avg((r) => r.expMean), expMax: r3(Math.max(0, ...rs.map((r) => r.expMax))),
    shortRuns: avg((r) => r.shortRuns), markedInc: avg((r) => r.markedInc), links: avg((r) => r.links), linksInc: avg((r) => r.linksInc),
    pumpStart: avg((r) => r.pumpStart), pumpFails: avg((r) => r.pumpFails),
    m: {
      spreadGe3: ms.systems.spread.ge3, worldLinks: ms.chain.worldLinks, contention: ms.contention.share, stall: ms.stall.candidates, forgotten: ms.stall.forgotten,
      replan: ms.replan.share, carryShare: ms.systems.share.carry ?? 0, metricFails: fails.length,
    },
    fails,
  };
}
/** 교대 번호 묶음의 (성공 + 지연) — 교대별 비율의 평균과 표준오차 */
function goodStat(rows: ShiftRow[], ks: number[]): { mean: number; se: number; n: number } {
  const xs = rows.filter((r) => r.error === null && r.n > 0 && ks.indexOf(r.k) >= 0).map((r) => r.good);
  const m = mean(xs);
  if (xs.length < 2) return { mean: m, se: 0, n: xs.length };
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1));
  return { mean: m, se: sd / Math.sqrt(xs.length), n: xs.length };
}

/** --paired: 교대 번호마다 (이어받은 교대 − 같은 시드의 새 교대)의 (성공 + 지연) 차이와 표준오차 */
function pairedStat(rows: ShiftRow[], ks: number[]): { d: number; se: number; n: number } {
  const xs = rows.filter((r) => r.error === null && r.fresh !== null && ks.indexOf(r.k) >= 0).map((r) => r.good - r.fresh!);
  const m = mean(xs), sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1)) : 0;
  return { d: r3(m), se: r3(xs.length ? sd / Math.sqrt(xs.length) : 0), n: xs.length };
}
function pairedLines(rows: ShiftRow[], shifts: number): string[] {
  const out: string[] = [];
  const stat = (ks: number[]): string => { const p = pairedStat(rows, ks); return p.n ? `${(p.d * 100).toFixed(1)}%p (SE ${(p.se * 100).toFixed(1)}, n ${p.n})` : '-'; };
  const per: string[] = [];
  for (let k = 2; k <= shifts; k++) per.push(`${k}: ${stat([k])}`);
  out.push(`짝 차이 (이어받은 교대 − 같은 시드의 새 교대, 성공+지연): ${per.join(' · ')}`);
  const all: number[] = [], late: number[] = [];
  for (let k = 2; k <= shifts; k++) { all.push(k); if (k >= shifts - 2) late.push(k); }
  out.push(`  교대 2~${shifts}: ${stat(all)} · 교대 ${late.join('·')}: ${stat(late)}`);
  return out;
}

// ───────────────────────── 계보를 돈다 ─────────────────────────
function runChain(lineages: number, shifts: number, dump: string | null): ShiftRow[] {
  const rows: ShiftRow[] = [];
  for (let l = 0; l < lineages; l++) {
    let carry: Carryover | null = null;
    for (let k = 1; k <= shifts; k++) {
      const t0 = Date.now();
      const { row, next } = runShift(l, k, carry);
      rows.push(row);
      if (verbose) console.error(`${row.seed} ${row.error ? 'ERROR' : 'ok'} n=${row.n} good=${(row.good * 100).toFixed(0)}% to=${row.timeouts} absent=${row.absent} closed=${row.closed + row.ruin} roads=${row.roads} next=${row.next ? JSON.stringify(row.next) : '-'} ${Date.now() - t0}ms`);
      if (row.error) { console.error(`${row.seed} 예외:\n${row.error}`); break; }
      if (dump && l === 0 && next) {
        writeFileSync(join(dump, `C0.${k}.carry.json`), JSON.stringify(next));
        writeFileSync(join(dump, `C0.${k}.org.json`), JSON.stringify({ id: 'chain-C0', carry: next, savedAt: 0 }));
      }
      carry = next;
      if (!carry) break;
    }
  }
  return rows;
}

const pc = (v: number): string => `${Math.round(v * 100)}%`;
const f2 = (v: number): string => v.toFixed(2);
function table(title: string, rows: ShiftRow[], shifts: number, baseline: boolean): ByShift[] {
  const list: ByShift[] = [];
  for (let k = 1; k <= shifts; k++) list.push(byShift(rows, k, baseline));
  if (jsonOn) return list;
  console.log(`\n${title}`);
  console.log(' k  계보  사건 | 성공 지연 부분 실패+미해결 · 한계 · 대응 | 결장 공석 예비 정비 | 통제 무너짐 흔적 복구도로 | 경험+(평균·최대) 결원출동 손상건물사건 이어진기록(사건) | 확산3+ 세계연결 경쟁 멈춤 재계획 carry 관문 | 펌프(시작 평균) 고장');
  for (const b of list) {
    console.log(`${String(b.k).padStart(2)}  ${String(b.shifts).padStart(4)} ${String(b.n).padStart(5)} | ${pc(b.success).padStart(4)} ${pc(b.delayed).padStart(4)} ${pc(b.partial).padStart(4)} ${pc(b.bad).padStart(4)} · ${(b.timeoutShare * 100).toFixed(1).padStart(4)}% · ${String(b.resp).padStart(3)}s | ${f2(b.absent)} ${f2(b.fallen)} ${f2(b.relief)} ${f2(b.service)} | ${f2(b.closed)} ${f2(b.ruin)} ${f2(b.marked)} ${f2(b.roads)} | ${b.expMean.toFixed(3)}·${b.expMax.toFixed(3)} ${f2(b.shortRuns)} ${f2(b.markedInc)} ${f2(b.links)}(${f2(b.linksInc)}) | ${b.m.spreadGe3} ${b.m.worldLinks} ${pc(b.m.contention)} ${b.m.stall ?? 'n/a'} ${pc(b.m.replan)} ${pc(b.m.carryShare)} ${b.m.metricFails ? '실패 ' + b.m.metricFails : '통과'} | 펌프 ${b.pumpStart.toFixed(2)} 고장 ${f2(b.pumpFails)}`);
    for (const f of b.fails) console.log(`      - ${f}`);
  }
  return list;
}

/** §6.3 의 1·2·5 (모든 계보·교대) */
function structural(rows: ShiftRow[], fail: string[], tag: string): void {
  const errs = rows.filter((r) => r.error !== null), open = rows.reduce((a, r) => a + r.open, 0), rt = rows.filter((r) => !r.roundtripOk);
  if (errs.length) fail.push(`${tag}예외 ${errs.length}건 (${errs.slice(0, 3).map((r) => r.seed).join(', ')})`);
  if (open) fail.push(`${tag}끝나지 않은 사건 ${open}건`);
  if (rt.length) fail.push(`${tag}왕복 검사 실패 ${rt.length}건 (${rt.slice(0, 3).map((r) => r.seed).join(', ')})`);
  for (const r of rows) for (const c of r.capFails) fail.push(`${tag}${r.seed}: ${c}`);
  for (const r of rows) {
    if (r.error) continue;
    if (r.k === 1 && r.summaryLines !== 0) fail.push(`${tag}${r.seed}: 이어받은 상태가 없는 교대에 요약 줄 ${r.summaryLines}개`);
    if (r.k >= 2 && (r.summaryLines !== 1 || !r.summaryKeyOk)) fail.push(`${tag}${r.seed}: 지문이 든 요약 줄 ${r.summaryLines}개${r.summaryKeyOk ? '' : ' (지문·기록 id 가 맞지 않음)'}`);
  }
}

// ───────────────────────── 그을음의 방향 (§6.3 의 8 — 측정만) ─────────────────────────
function sootCompare(nSeeds: number): void {
  const sevs = (opt('--sev') ?? '2,3').split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 5);
  const A = new Sim('SOOT0', NORMAL, 60); A.runToEnd();
  const baseCarry = makeCarryover(A);
  const placeArg = opt('--place');
  const pid = placeArg !== null ? parseInt(placeArg, 10) : A.city.places.find((q) => q.facility < 0 && !q.open && q.kind === 'apartment' && (INCIDENT_PLACES.fire[q.kind] ?? 0) > 0)!.id;
  const q = A.city.places[pid];
  console.log(`그을음의 방향 (§6.3 의 8): 건물 ${pid} ${q.kind} ${q.name} · 화재 std · 사건 시드 SOOT0~${nSeeds - 1} · 그을음 0 과 0.6 (손상 0)`);
  console.log('  심각도 그을음 | 소실률 평균 · 전소(BURNOUT) · X6 탄 비율 · 이번 교대에 탄 칸 · 처음부터 탄 칸 · 연료 칸(처음)');
  const out: Record<string, unknown>[] = [];
  for (const sev of sevs) {
    const perSeed: Record<string, number[]> = { '0': [], '0.6': [] }, perBurn: Record<string, number[]> = { '0': [], '0.6': [] };
    for (const soot of [0, 0.6]) {
      let loss = 0, burnout = 0, x6 = 0, burned = 0, pre = 0, fuel = 0;
      for (let k = 0; k < nSeeds; k++) {
        const co = JSON.parse(JSON.stringify(baseCarry)) as Carryover;
        const pc0: PlaceCarry = { id: pid, state: 'marked', dmg: 0, soot, repair: 0, cause: 'fire', inc: '조직 1번째 교대 · 01 건물 화재', since: 1 };
        co.places = [pc0];
        const sim = new Sim('SOOT' + k, NORMAL, 1200, { carry: co });
        const I = createIncident(sim, { type: 'fire', variant: 'std', severity: sev, placeId: pid, rng: sim.rng.fork('soot-test') });
        const s = sim.scenes[I.id]!;
        pre += s.wear?.pre ?? 0; fuel += s.totalFuelTiles;
        sim.runToEnd();
        loss += s.burnedTiles / Math.max(1, s.totalFuelTiles);
        burned += s.burnedTiles;
        perSeed[String(soot)].push(s.burnedTiles / Math.max(1, s.totalFuelTiles)); perBurn[String(soot)].push(s.burnedTiles);
        if (I.problems.some((p) => p.code === 'BURNOUT')) burnout++;
        const pm = sim.placeMarks.get(pid);
        x6 += pm && pm.incidentId === I.id ? pm.burnFrac : 0;
      }
      const row = { sev, soot, loss: r3(loss / nSeeds), burnout: r3(burnout / nSeeds), x6burn: r3(x6 / nSeeds), burned: r3(burned / nSeeds), pre: r3(pre / nSeeds), fuel: r3(fuel / nSeeds) };
      out.push(row);
      if (!jsonOn) console.log(`  ${String(sev).padStart(6)} ${soot.toFixed(1).padStart(6)} | ${row.loss.toFixed(3)} · ${pc(row.burnout)} · ${row.x6burn.toFixed(3)} · ${row.burned.toFixed(1)} · ${row.pre.toFixed(1)} · ${row.fuel.toFixed(1)}`);
    }
    // 같은 사건 시드의 짝 차이 (그을음 0.6 − 0): 소실률과 이번 교대에 탄 칸
    const pd = (a: number[], b: number[]): { d: number; se: number } => {
      const xs = a.map((x, i) => x - b[i]), m = mean(xs);
      const sd = xs.length > 1 ? Math.sqrt(xs.reduce((q, x) => q + (x - m) * (x - m), 0) / (xs.length - 1)) : 0;
      return { d: m, se: xs.length ? sd / Math.sqrt(xs.length) : 0 };
    };
    const dl = pd(perSeed['0.6'], perSeed['0']), db = pd(perBurn['0.6'], perBurn['0']);
    out.push({ sev, paired: { loss: r3(dl.d), lossSe: r3(dl.se), burned: r3(db.d), burnedSe: r3(db.se) } });
    if (!jsonOn) console.log(`  ${String(sev).padStart(6)}  짝 차이(0.6 − 0) | 소실률 ${dl.d >= 0 ? '+' : ''}${dl.d.toFixed(3)} (SE ${dl.se.toFixed(3)}) · 이번 교대에 탄 칸 ${db.d >= 0 ? '+' : ''}${db.d.toFixed(1)} (SE ${db.se.toFixed(1)})`);
  }
  if (jsonOn) console.log(JSON.stringify({ soot: { place: pid, seeds: nSeeds, rows: out } }));
}

// ───────────────────────── 본문 ─────────────────────────
if (flag('--soot')) { sootCompare(pos[0] ?? 12); process.exit(0); }
const dumpDir = opt('--dump');
if (dumpDir) mkdirSync(dumpDir, { recursive: true });
const t0 = Date.now();
const dis = disArg;
const baseline = !diffArg && !dis;
const label = `${difficultyLabel(base)} (${difficultyKey(base)})${dis ? ` · 재난 ${dis.kind}${dis.at !== null ? `@${dis.at}` : ''}` : ''}${STRIP.size ? ` · 지운 몫 ${[...STRIP].join(',')}` : ''}`;
const rows = runChain(L, K, dumpDir);
const list = table(`계보 ${L} × 교대 ${K} — ${label}`, rows, K, baseline);
const fail: string[] = [];
structural(rows, fail, '');
const errors = rows.filter((r) => r.error !== null).length, open = rows.reduce((a, r) => a + r.open, 0);
let nAll = 0, toAll = 0;
for (const r of rows) { nAll += r.n; toAll += r.timeouts; }
const timeoutAll = nAll ? toAll / nAll : 0;
// 3. 나선 없음: 교대 6~8 (K 가 8 이 아니면 마지막 셋) 의 평균 − 교대 1~2 의 평균
const early = goodStat(rows, [1, 2]);
const lateKs: number[] = [];
for (let k = Math.max(3, K - 2); k <= K; k++) lateKs.push(k);
const late = goodStat(rows, lateKs);
const delta = late.mean - early.mean, se = Math.sqrt(early.se * early.se + late.se * late.se), spiralLim = Math.max(0.08, 2.5 * se);
// 6. 회복 (지진 뒤): 이 실행이 첫 교대 지진이면 이 표로, 아니면 --check 의 보통 실행에서 12 × 6 을 따로
//    (단계 8 에서 정한 수 — 설계서 §6.3-6 의 '확인 필요') 결장은 교대 5 를 본다: H1 의 결장 표에서 가장 긴 결장(쓰러짐 3교대)이 지진 교대(1)의 다음 셋(2·3·4)을
//    채우므로 교대 4 에는 지진의 쓰러진 대원이 아직 빠져 있고, 그 위에 교대 2·3 의 새 결장이 얹힌다 — 지진의 결장이 모두 끝난 첫 교대가 5 다
function recovery(bs: ByShift[], tag: string): { lines: string[]; fails: string[] } {
  const at = (k: number): ByShift | undefined => bs.find((b) => b.k === k);
  const k2 = at(2), k4 = at(4), k5 = at(5), k6 = at(6), lines: string[] = [], fails: string[] = [];
  if (!k2 || !k4 || !k5 || !k6) return { lines: [`${tag}회복: 교대 6 까지 돌지 않아 보지 않는다`], fails };
  const c2 = k2.closed + k2.ruin, c6 = k6.closed + k6.ruin;
  lines.push(`${tag}회복: 복구 도로 교대 2 ${f2(k2.roads)} (≥ 1) · 교대 4 ${f2(k4.roads)} (≤ ${f2(k2.roads / 2)}) · 결장 교대 2 ${f2(k2.absent)} → 교대 4 ${f2(k4.absent)} · 교대 5 ${f2(k5.absent)} (≤ ${f2(k2.absent)}) · 출입 통제·무너짐 교대 2 ${f2(c2)} → 교대 6 ${f2(c6)} (≤ ${f2(c2 / 2)})`);
  if (k2.roads < 1) fails.push(`${tag}교대 2 의 복구 도로 평균 ${f2(k2.roads)} < 1`);
  if (k5.absent > k2.absent) fails.push(`${tag}교대 5 의 결장 평균 ${f2(k5.absent)} > 교대 2 의 ${f2(k2.absent)}`);
  if (k4.roads > k2.roads / 2) fails.push(`${tag}교대 4 의 복구 도로 평균 ${f2(k4.roads)} > 교대 2 의 절반 ${f2(k2.roads / 2)}`);
  if (c6 > c2 / 2) fails.push(`${tag}교대 6 의 출입 통제·무너짐 평균 ${f2(c6)} > 교대 2 의 절반 ${f2(c2 / 2)}`);
  return { lines, fails };
}
/**
 * 7 의 교착 후보·잊힌 사건 (단계 8 에서 정한 꼴): sweep 의 관문은 정해진 시드(S0~S39)에 교착 후보 0 을 거는 래칫이고, 보통 200교대(S0~S199, 이어받은 상태 없음)에도
 * 교착 후보가 1건 있다(앞 묶음의 현장 판단 — X6 의 종료 차단 대기 등). 그래서 이어 돈 교대(2~K)의 교착 후보를 **같은 시드·조건을 이어받은 상태 없이 돌린 대조군**과 견주어
 * STALL_SLACK 넘게 많을 때만 실패로 친다. 잊힌 사건(부대가 모두 빠진 열린 사건)은 대조군과 상관없이 0 이어야 한다
 */
const STALL_SLACK = 2;
function stallCheck(rows: ShiftRow[], tag: string): { lines: string[]; fails: string[] } {
  let carried = 0, fresh = 0, first = 0, forgot = 0, freshForgot = 0;
  const cand: string[] = [];
  for (const r of rows) {
    if (!r.m) continue;
    const st = r.m.stall?.length ?? 0, fg = r.m.forgotten?.length ?? 0;
    forgot += fg;
    if (r.k === 1) first += st; else { carried += st; fresh += r.freshStall; freshForgot += r.freshForgot; }
    for (const c of [...(r.m.stall ?? []), ...(r.m.forgotten ?? [])]) cand.push(`${tag}  ${stallLine(c).trim()}`);
  }
  const lines = [`${tag}교착 후보: 이어받은 교대(2~) ${carried} · 같은 시드의 새 교대(대조군) ${fresh} · 첫 교대 ${first} · 잊힌 사건 ${forgot}(대조군 ${freshForgot})`, ...cand];
  const fails: string[] = [];
  if (forgot > 0) fails.push(`${tag}잊힌 사건 ${forgot}건`);
  if (carried > fresh + STALL_SLACK) fails.push(`${tag}이어받은 교대의 교착 후보 ${carried}건 > 대조군 ${fresh} + ${STALL_SLACK}`);
  return { lines, fails };
}
let rec: { lines: string[]; fails: string[] } | null = null, recList: ByShift[] | null = null, recRows: ShiftRow[] | null = null;
if (dis && dis.at === 1) rec = recovery(list, '');
const stl = stallCheck(rows, ''), recStl: { lines: string[]; fails: string[] } = { lines: [], fails: [] };
if (checkOn) {
  fail.push(...stl.fails);
  if (baseline && K >= 5) {
    if (Math.abs(delta) > spiralLim) fail.push(`나선: 교대 ${lateKs.join('·')} − 교대 1·2 의 (성공+지연) Δ ${(delta * 100).toFixed(1)}%p · |Δ| > max(8%p, 2.5 × SE ${(se * 100).toFixed(1)}%p)`);
    if (timeoutAll > 0.04) fail.push(`한계 시간·무대응·방치 종료 비율 ${(timeoutAll * 100).toFixed(1)}% > 4%`);
  }
  for (const b of list) if (b.m.metricFails) fail.push(`교대 ${b.k} 의 지표 관문 ${b.m.metricFails}건: ${b.fails.join(' / ')}`);
  if (rec) fail.push(...rec.fails);
  else if (baseline) {
    // 기준 6 의 따로 돈 실행: 첫 교대에만 지진, 12 × 6
    recRows = runRecovery();
    recList = table(`회복 (기준 6): 계보 12 × 교대 6 — ${difficultyLabel(base)} · 재난 quake@1`, recRows, 6, false);
    structural(recRows, fail, '[회복] ');
    for (const b of recList) if (b.m.metricFails) fail.push(`[회복] 교대 ${b.k} 의 지표 관문 ${b.m.metricFails}건: ${b.fails.join(' / ')}`);
    rec = recovery(recList, '[회복] ');
    fail.push(...rec.fails);
    const rs = stallCheck(recRows, '[회복] ');
    recStl.lines.push(...rs.lines); recStl.fails.push(...rs.fails);
    fail.push(...rs.fails);
  }
}
/** 기준 6 의 따로 돈 실행 — 첫 교대에만 지진 (이 대본의 dis 를 잠시 바꿔 runChain 을 부른다) */
function runRecovery(): ShiftRow[] {
  const keep = disNow;
  disNow = { kind: 'quake', at: 1 };
  try { return runChain(12, 6, null); } finally { disNow = keep; }
}
const sec = Math.round((Date.now() - t0) / 1000);
if (jsonOn) {
  const j = (bs: ByShift[]): unknown[] => bs.map(({ fails: _f, ...b }) => b);
  console.log(JSON.stringify({
    lineages: L, shifts: K, diff: difficultyKey(base), disaster: dis ? `${dis.kind}${dis.at !== null ? '@' + dis.at : ''}` : null,
    byShift: j(list), errors, open, timeoutShare: r3(timeoutAll),
    spiral: { early: r3(early.mean), late: r3(late.mean), lateShifts: lateKs, delta: r3(delta), se: r3(se), limit: r3(spiralLim) },
    recovery: rec ? { lines: rec.lines, byShift: recList ? j(recList) : undefined, stall: recStl.lines } : null,
    stall: stl.lines,
    paired: pairedOn ? Array.from({ length: Math.max(0, K - 1) }, (_, i) => ({ k: i + 2, ...pairedStat(rows, [i + 2]) })) : undefined,
    fails: fail, sec,
  }));
} else {
  console.log(`\n전체: 교대 ${rows.length} · 사건 ${nAll} · 예외 ${errors} · 끝나지 않은 사건 ${open} · 왕복 실패 ${rows.filter((r) => !r.roundtripOk).length} · 한계 시간·무대응·방치 ${(timeoutAll * 100).toFixed(1)}%`);
  console.log(`나선: (성공+지연) 교대 1·2 ${pc(early.mean)} (n ${early.n}) → 교대 ${lateKs.join('·')} ${pc(late.mean)} (n ${late.n}) · Δ ${(delta * 100).toFixed(1)}%p · SE ${(se * 100).toFixed(1)}%p · 한계 ±${(spiralLim * 100).toFixed(1)}%p`);
  for (const l of stl.lines) console.log(l);
  if (rec) for (const l of rec.lines) console.log(l);
  for (const l of recStl.lines) console.log(l);
  if (pairedOn) for (const line of pairedLines(rows, K)) console.log(line);
  if (verbose) for (const line of formatLines(summarize(rows.map((r) => r.m)), false)) console.log(line);
  console.log(`(${sec}초)`);
}
if (checkOn) {
  if (fail.length) { console.error('\n검증 실패:\n - ' + fail.join('\n - ')); process.exit(1); }
  if (jsonOn) console.error('\n검증 통과'); else console.log('\n검증 통과');
}
