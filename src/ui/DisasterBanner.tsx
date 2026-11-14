// 재난 특보 띠 (docs/specs/N6-disaster.md). 재난이 없으면 아무것도 그리지 않는다.
// 예고 = 노란 띠(충격까지 남은 시간), 충격 = 붉은 띠(재난이 일으킨 사건 수), 여파 = 회색 띠. 보여 주기만 한다(누를 수 없다).
import { fmtDur } from '../sim/util';
import type { Runner } from '../view/runner';

const IMPACT: Record<string, string> = { typhoon: '도시를 지나는 중', flood: '강물이 넘치는 중', quake: '도시 전역이 흔들렸습니다', wildfire: '번지는 중', tsunami: '해안을 덮치는 중' };

export function DisasterBanner({ runner }: { runner: Runner }) {
  const sim = runner.sim, d = sim.disaster;
  if (!d || d.phase === 'calm' || d.phase === 'over' || sim.ended) return null;
  const open = d.spawned.filter((id) => sim.incidents[id].phase !== 'closed').length;
  const cut = d.closedEdges.length;
  const head = d.phase === 'warning' ? `${d.kind === 'typhoon' ? '특보' : '경보'} — 충격까지 ${fmtDur(d.tImpact - sim.t)}` : d.phase === 'impact' ? IMPACT[d.kind] : '여파';
  return (
    <div className={`disaster-banner ph-${d.phase}`}>
      <b>{d.name}</b>
      <span>{head}</span>
      {d.spawned.length > 0 && <span className="dz-chip">재난 사건 {d.spawned.length}건{open ? ` · 진행 중 ${open}` : ''}</span>}
      {d.kind === 'flood' && d.phase !== 'warning' && <span className="dz-chip">수위 {Math.round((d.level ?? 0) * 100)}%</span>}
      {d.kind === 'wildfire' && d.to && <span className="dz-chip">{d.stopped === 'contained' ? '주불 진화' : d.stopped === 'reached' ? `${d.to.name} 도달` : d.stopped ? '확산 멈춤' : `${d.to.name} 방면 · ${Math.max(0, Math.round((1 - (d.run ?? 0) / (d.span ?? 1)) * 100))}% 남음`}</span>}
      {d.dark && <span className="dz-chip">정전</span>}
      {cut > 0 && <span className="dz-chip">도로 통제 {cut}구간</span>}
    </div>
  );
}
