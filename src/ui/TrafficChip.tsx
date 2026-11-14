// 상단 띠의 교통 요약 (docs/specs/T1-traffic.md). 숫자는 관제에 **알려진** 구간 수다 — 아직 아무도 모르는 통제는 세지 않는다.
import type { Sim } from '../sim/engine';

export function TrafficChip({ sim }: { sim: Sim }) {
  const tr = sim.traffic;
  let slow = 0, jam = 0, closed = 0;
  for (const e of sim.city.edges) {
    if (e.closed && e.known !== false) { closed++; continue; }
    const load = e.cong + e.slow;
    if (load >= 2.3) jam++; else if (load >= 1.8) slow++;
  }
  const known = tr.obstacles.filter((o) => o.known).length, gates = tr.crossings.filter((c) => c.down).length;
  const level = jam + closed > 0 ? 'bad' : slow > 0 ? 'slow' : 'ok';
  const text = level === 'bad' ? [jam ? `정체 ${jam}` : '', closed ? `통제 ${closed}` : ''].filter(Boolean).join(' · ') : level === 'slow' ? `서행 ${slow}` : '교통 원활';
  const tip = `${tr.todName} · 서행 ${slow}구간 · 정체 ${jam}구간 · 통제 ${closed}구간 · 알려진 장애물 ${known}곳${gates ? ` · 건널목 차단기 ${gates}곳 내려감` : ''}`;
  return <span className={`traffic-chip tf-${level}`} title={tip}><i />{text}</span>;
}
