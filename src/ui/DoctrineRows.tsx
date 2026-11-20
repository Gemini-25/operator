// 대원 정보창의 대응 교본 칸 (docs/specs/R3-doctrine.md §7.1): 상태 칩 한 줄(공기·탄·짝·몸·동요), 지금 따르는 교본 줄(또는 판단 지점에서 기다리는 줄), 그 대원이 교본으로 바꾼 최근 셋.
// 읽기만 한다 — 줄의 이름표(doctrine/registry.ts)와 대원·임무에 적힌 칸(a.doc · a.buddy · a.shaken · task.docRule · task.gateAt), 사건의 교본 기록(I.docs),
// 장비의 수량(gear 의 판단용 함수 — 숨은 고장은 모른다), 그리고 몸 상태.
// 시점 규칙(§7.1 끝): 관찰자 시점(truth)은 진실을 — 몸은 체력, 동요는 그 대원의 상태. AI 시점은 지휘관이 아는 만큼 — 몸·동요는 그 대원의 'crew' 자기 신고를 지휘관의 믿음에서
// (지휘관이 없거나 그 대원이 지휘관이면 그 대원 자신의 신고). 공기·탄은 조직이 아는 장비 수량이라 두 시점이 같다.
import { ruleName } from '../sim/field/doctrine/registry';
import { gunOf, kitHas, kitQty } from '../sim/field/gear';
import type { Sim } from '../sim/engine';
import type { CrewBelief, FieldAgent, Scene } from '../sim/types';
import { fmtClock } from '../sim/util';
import { TRIAGE, TRIAGE_NAME, respBand } from '../view/triage';

/** 상태 칩 한 줄. 공기는 공기호흡기를 들었을 때(30·50% 눈금), 탄은 탄을 세는 총이 있을 때, 짝은 늘, 몸은 늘(중증도 색), 동요는 동요 중일 때만 */
function StatusChips({ sim, scene, agent, truth }: { sim: Sim; scene: Scene; agent: FieldAgent; truth: boolean }) {
  const rid = agent.rid, r = sim.responders[rid];
  const air = kitHas(sim, rid, 'scba') ? Math.max(0, Math.min(1, kitQty(sim, rid, 'scba') / sim.tune.airFull)) : -1;
  const g = gunOf(sim, rid);
  const reloading = agent.reloadUntil !== undefined && agent.reloadUntil > sim.t;
  const mate = agent.buddy !== undefined && agent.buddy >= 0 ? scene.agents.find((b) => b.rid === agent.buddy && b !== agent && b.status !== 'left') ?? null : null;
  // 몸·동요: 관찰자는 진실, AI 는 지휘관의 믿음 속 자기 신고
  let band: number, shaken: boolean;
  if (truth) { band = respBand(r); shaken = agent.shaken !== undefined && agent.shaken > sim.t; }
  else {
    const cmd = scene.agents.find((b) => b.isCommander && b.status === 'active');
    const who = cmd && cmd !== agent ? cmd : agent;
    const v = who.beliefs.val<CrewBelief>('crew', rid);
    band = v ? Math.min(2, v.band) : 0; shaken = v ? v.shaken : false;
  }
  return (
    <div className="doc-chips">
      {air >= 0 && (
        <span className={`dchip air ${air < 0.3 ? 'crit' : air < 0.5 ? 'low' : ''}`} title="공기 (30% 탈출 · 50% 다시 맡음)">
          공기 <span className="airbar"><i style={{ width: `${Math.round(air * 100)}%` }} /><em style={{ left: '30%' }} /><em style={{ left: '50%' }} /></span> {Math.round(air * 100)}%
        </span>
      )}
      {g !== null && g.ammo !== Infinity && <span className={`dchip ammo ${g.ammo <= 2 * g.perShot ? 'crit' : g.ammo <= g.magSize ? 'low' : ''}`}>탄 {reloading ? '재장전' : `${g.ammo} / 탄창 ${g.mag}`}</span>}
      <span className="dchip buddy">{mate ? `짝 ${sim.responders[mate.rid].name} ${Math.hypot(mate.x - agent.x, mate.y - agent.y).toFixed(1)}칸` : '짝 없음'}</span>
      <span className="dchip body" style={{ color: TRIAGE[Math.min(2, band)] }} title={truth ? '몸 (진실)' : '몸 (지휘관이 아는 자기 신고)'}>몸 {TRIAGE_NAME[Math.min(2, band)]}</span>
      {shaken && <span className="dchip shaken">동요</span>}
    </div>
  );
}

export function DoctrineRows({ sim, scene, agent, truth = false }: { sim: Sim; scene: Scene; agent: FieldAgent; truth?: boolean }) {
  const t = agent.task;
  const now = agent.doc ? agent.doc.rule : t && t.docRule ? t.docRule : null;
  const waiting = t && t.gateAt !== undefined && t.gateAt >= 0 ? sim.t - t.gateAt : -1;
  const docs = sim.incidents[scene.incidentId].docs ?? [];
  const mine = docs.filter((d) => d.rid === agent.rid).slice(-3).reverse();
  const nm = (id: string): string => { const r = ruleName(id); return r ? `${id} ${r.name}` : id; };
  return (
    <>
      <h4>대응 교본</h4>
      <StatusChips sim={sim} scene={scene} agent={agent} truth={truth} />
      {now !== null && <div className="kv doc-now"><span className="dim">따르는 줄</span><span>{nm(now)}{waiting >= 0 ? ` — ${Math.round(waiting)}초째` : ''}</span></div>}
      {mine.map((d, k) => {
        const r = ruleName(d.rule);
        const len = d.t1 - d.t;
        return <div key={k} className="kv doc-past"><span className="dim">{fmtClock(sim.startTod + d.t)}</span><span>{d.rule} {r ? r.short : ''}{len >= 1 ? ` (${Math.round(len)}초)` : ''}</span></div>;
      })}
    </>
  );
}
