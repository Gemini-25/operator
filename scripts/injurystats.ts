// 부상과 사망의 집계 (H1 §9.2 — scripts/sweep.ts 가 부른다). 끝난 교대의 상태와 기록을 읽기만 한다 — 결과는 바뀌지 않는다.
//   대원: 교대 보고서의 다친 대원(순직 포함 — respondersHurt), 쓰러진 적이 있는(숨지지 않은) 대원, 순직
//   용의자: 다친 용의자(사건 판정의 suspectsHurt — 숨진 용의자 포함), 숨진 용의자, 총에 맞아 쓰러진 용의자 가운데 숨진 비율과 그 가운데 쓰러지는 순간 숨진 비율(즉사 — 0 이어야 한다: 용의자 문턱)
//   붕괴 현장 사건당 잔해 바닥 추락, 숨진 구조 대상의 원인 분포, 사람이 없어 기지에서 운용을 멈춘 부대(PHRASE.T6), 교대 끝에 순직 대원이 있는 부대, 가벼운 일로 돌아온 대원
import type { Sim } from '../src/sim/engine';
import { CAUSE_NAME } from '../src/sim/field/injury';
import type { InjuryCause } from '../src/sim/types';
import { PHRASE } from './metrics';

export interface InjuryCount {
  shifts: number;
  respHurt: number; respDown: number; respKilled: number;
  susHurt: number; susDead: number; shotDown: number; shotDownDied: number; instant: number;
  falls: number; collapseInc: number;
  causes: Partial<Record<InjuryCause, number>>;
  crewOut: number; unitsWithKilled: number; lightReturns: number;
}

export function injuryStats(sim: Sim): InjuryCount {
  const r = sim.report!;
  const c: InjuryCount = { shifts: 1, respHurt: r.respondersHurt.length, respDown: 0, respKilled: 0, susHurt: 0, susDead: 0, shotDown: 0, shotDownDied: 0, instant: 0, falls: 0, collapseInc: 0, causes: {}, crewOut: 0, unitsWithKilled: 0, lightReturns: 0 };
  for (const p of sim.responders) { if (p.dead) c.respKilled++; else if (p.tDown !== undefined) c.respDown++; }
  for (const inc of r.incidents) {
    c.susHurt += inc.result.suspectsHurt ?? 0; c.susDead += inc.result.suspectsDead ?? 0;
    const dc = inc.result.deathCauses;
    if (dc) for (const k of Object.keys(dc) as InjuryCause[]) c.causes[k] = (c.causes[k] ?? 0) + (dc[k] ?? 0);
    if (inc.type === 'collapse') c.collapseInc++;
  }
  for (const s of sim.scenes) {
    if (!s) continue;
    for (const h of s.hostiles) {
      if (h.tDown === undefined || !(h.injuries ?? []).some((j) => j.cause === 'gunshot' && j.byKind === 'responder')) continue;
      c.shotDown++;
      if (h.dead) { c.shotDownDied++; if (h.tDead === h.tDown) c.instant++; }
    }
  }
  for (const e of sim.events) {
    if (e.kind === 'hazard' && /잔해 위에서 미끄러져 다침/.test(e.text)) c.falls++;
    else if (e.kind === 'unit' && PHRASE.T6.test(e.text)) c.crewOut++;
    else if (e.role === 'RESPONDER' && e.text === '처치 받음. 가벼운 임무로 복귀합니다.') c.lightReturns++;
  }
  for (const u of sim.units) if (u.crew.some((rid) => sim.responders[rid].dead)) c.unitsWithKilled++;
  return c;
}

export function sumInjury(list: InjuryCount[]): InjuryCount {
  const t: InjuryCount = { shifts: 0, respHurt: 0, respDown: 0, respKilled: 0, susHurt: 0, susDead: 0, shotDown: 0, shotDownDied: 0, instant: 0, falls: 0, collapseInc: 0, causes: {}, crewOut: 0, unitsWithKilled: 0, lightReturns: 0 };
  for (const c of list) {
    t.shifts += c.shifts; t.respHurt += c.respHurt; t.respDown += c.respDown; t.respKilled += c.respKilled;
    t.susHurt += c.susHurt; t.susDead += c.susDead; t.shotDown += c.shotDown; t.shotDownDied += c.shotDownDied; t.instant += c.instant;
    t.falls += c.falls; t.collapseInc += c.collapseInc; t.crewOut += c.crewOut; t.unitsWithKilled += c.unitsWithKilled; t.lightReturns += c.lightReturns;
    for (const k of Object.keys(c.causes) as InjuryCause[]) t.causes[k] = (t.causes[k] ?? 0) + (c.causes[k] ?? 0);
  }
  return t;
}

const per = (v: number, n: number): number => +(v / Math.max(1, n)).toFixed(3);
const share = (a: number, b: number): number | null => (b > 0 ? +(a / b).toFixed(3) : null);

/** JSON (sweep --json 의 injuries 칸) — 설계서 §9.2 의 이름 */
export function injuryJson(t: InjuryCount): Record<string, unknown> {
  return {
    respondersHurtPerShift: per(t.respHurt, t.shifts), respondersDownPerShift: per(t.respDown, t.shifts), respondersKilledPerShift: per(t.respKilled, t.shifts),
    suspectsHurt: t.susHurt, suspectsDead: t.susDead, suspectsShotDown: t.shotDown,
    suspectsDownByGunDiedShare: share(t.shotDownDied, t.shotDown), suspectsInstantDeathShare: share(t.instant, t.shotDownDied),
    debrisFallsPerCollapse: share(t.falls, t.collapseInc), deathCauses: t.causes,
    crewOutPerShift: per(t.crewOut, t.shifts), unitsWithKilledPerShift: per(t.unitsWithKilled, t.shifts), lightReturnsPerShift: per(t.lightReturns, t.shifts),
  };
}

/** 출력 줄 하나: injuries: responders hurt/shift … down/shift … killed/shift … · suspects hurt … dead … (shot-down died …%, instant …%) · falls/collapse … · causes … */
export function injuryLine(t: InjuryCount): string {
  const pctOr = (v: number | null): string => (v === null ? '-' : `${Math.round(v * 100)}%`);
  const causes = (Object.keys(t.causes) as InjuryCause[]).sort((a, b) => (t.causes[b] ?? 0) - (t.causes[a] ?? 0) || (a < b ? -1 : 1)).map((k) => `${CAUSE_NAME[k]} ${t.causes[k]}`).join(', ') || '-';
  return `injuries: responders hurt/shift ${per(t.respHurt, t.shifts)} down/shift ${per(t.respDown, t.shifts)} killed/shift ${per(t.respKilled, t.shifts)}`
    + ` · suspects hurt ${t.susHurt} dead ${t.susDead} (shot-down ${t.shotDown} died ${pctOr(share(t.shotDownDied, t.shotDown))}, instant ${pctOr(share(t.instant, t.shotDownDied))})`
    + ` · falls/collapse ${share(t.falls, t.collapseInc) ?? '-'} · crew out/shift ${per(t.crewOut, t.shifts)} · units with killed/shift ${per(t.unitsWithKilled, t.shifts)} · light returns/shift ${per(t.lightReturns, t.shifts)}`
    + ` · causes ${causes}`;
}
