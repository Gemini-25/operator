// 대원 정보창의 대응 교본 칸 (docs/specs/R3-doctrine.md §7.1): 지금 따르는 교본 줄(또는 판단 지점에서 기다리는 줄)과 그 대원이 교본으로 바꾼 최근 셋.
// 읽기만 한다 — 줄의 이름표(doctrine/registry.ts)와 대원·임무에 적힌 칸(a.doc · task.docRule · task.gateAt)과 사건의 교본 기록(I.docs)만 본다.
// 적힌 것이 없으면 아무것도 그리지 않는다(자리를 차지하지 않는다). 단계 0 에는 교본 줄이 없어 늘 비어 있다 — 상태 칩(공기·탄·짝·몸·동요)은 1단계가 더한다.
import { ruleName } from '../sim/field/doctrine/registry';
import type { Sim } from '../sim/engine';
import type { FieldAgent, Scene } from '../sim/types';
import { fmtClock } from '../sim/util';

export function DoctrineRows({ sim, scene, agent }: { sim: Sim; scene: Scene; agent: FieldAgent }) {
  const t = agent.task;
  const now = agent.doc ? agent.doc.rule : t && t.docRule ? t.docRule : null;
  const waiting = t && t.gateAt !== undefined && t.gateAt >= 0 ? sim.t - t.gateAt : -1;
  const docs = sim.incidents[scene.incidentId].docs ?? [];
  const mine = docs.filter((d) => d.rid === agent.rid).slice(-3).reverse();
  if (now === null && !mine.length) return null;
  const nm = (id: string): string => { const r = ruleName(id); return r ? `${id} ${r.name}` : id; };
  return (
    <>
      <h4>대응 교본</h4>
      {now !== null && <div className="kv doc-now"><span className="dim">따르는 줄</span><span>{nm(now)}{waiting >= 0 ? ` — ${Math.round(waiting)}초째` : ''}</span></div>}
      {mine.map((d, k) => {
        const r = ruleName(d.rule);
        const len = d.t1 - d.t;
        return <div key={k} className="kv doc-past"><span className="dim">{fmtClock(sim.startTod + d.t)}</span><span>{d.rule} {r ? r.short : ''}{len >= 1 ? ` (${Math.round(len)}초)` : ''}</span></div>;
      })}
    </>
  );
}
