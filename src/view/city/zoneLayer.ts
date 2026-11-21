// 지도의 정전·연기 자리 (설계서 I1 §7 b4 — 교대 중에 보이는 표시). renderCity 가 월드 층에서 부른다(재난 그림 다음).
//   국지 값(ZoneState.at — 붕괴·폭발 자리의 끊긴 전선, 큰 불의 연기)은 그 원을, 동네 전체 값(변전소·지진)은 그 동네의 원을 옅은 테로 그린다.
//   정전 = 차가운 파란 점선 테 · 연기 = 흙빛 안개와 점선 테. 진하기는 값의 크기(정전은 1 − power, 연기는 smoke)를 따른다.
// 시점 규칙(§3.8): 관찰자 시점은 진실 그대로, AI 시점은 관제가 아는 것(Z.known)만. 도시 전체의 태풍 정전은 재난 그림(어두운 막)이 이미 보인다 — 동네 테를 겹쳐 그리지 않는다.
// 세계 상태를 **읽기만** 한다(sim.world.zones). 판정·기록·난수를 건드리지 않는다.

import { DISTRICTS } from '../../sim/cityPlan';
import type { Sim } from '../../sim/engine';
import type { ZoneField } from '../../sim/types';

/** 그리는 칸과 색 (범례가 같은 값을 쓴다) */
export const ZONE_LOOK: Record<'power' | 'smoke', { ring: string; fill: string; dash: [number, number] }> = {
  power: { ring: '#8fb0ff', fill: 'rgba(40,60,140,0.16)', dash: [7, 6] },
  smoke: { ring: '#bfae92', fill: 'rgba(150,138,120,0.22)', dash: [3, 4] },
};
const FIELDS: ('power' | 'smoke')[] = ['power', 'smoke'];
/** 그 칸이 평소와 얼마나 다른가 (0 = 평소) */
const offOf = (f: ZoneField, v: number): number => (f === 'smoke' ? v : 1 - v);

interface ZoneOpts { truth: boolean; timeMs: number; scale: number; mini: boolean }
/** 월드 층 (drawDisasterWorld 바로 뒤, 같은 변환 안). 작은 지도 창에서는 그리지 않는다 */
export function drawZonesWorld(ctx: CanvasRenderingContext2D, sim: Sim, o: ZoneOpts): void {
  if (o.mini || !sim.world) return;
  const zones = sim.world.zones, cityDark = !!(sim.disaster && sim.disaster.dark);
  const done = new Set<string>();      // 국지 값은 여러 동네가 같은 원을 나눠 가진다 — 한 번만 그린다
  ctx.save();
  for (const f of FIELDS) {
    const look = ZONE_LOOK[f];
    for (let z = 0; z < zones.length; z++) {
      const Z = zones[z], off = offOf(f, Z[f]);
      if (!(off > 0.02)) continue;
      if (!o.truth && !Z.known[f]) continue;
      const at = Z.at ? Z.at[f] : undefined;
      if (!at && f === 'power' && cityDark) continue;
      const c = at ?? { x: DISTRICTS[z].x, y: DISTRICTS[z].y, r: DISTRICTS[z].r };
      const key = `${f}|${Math.round(c.x)}|${Math.round(c.y)}|${Math.round(c.r)}`;
      if (done.has(key)) continue;
      done.add(key);
      const a = Math.min(1, 0.35 + 0.65 * off);
      if (f === 'smoke') {
        // 연기: 가운데가 짙고 가장자리로 옅어지는 안개 (천천히 숨 쉬듯)
        const breathe = 0.85 + 0.15 * Math.sin(o.timeMs / 1800 + z);
        const gr = ctx.createRadialGradient(c.x, c.y, c.r * 0.1, c.x, c.y, c.r);
        gr.addColorStop(0, look.fill); gr.addColorStop(1, 'rgba(150,138,120,0)');
        ctx.globalAlpha = a * breathe; ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.2832); ctx.fill();
      } else {
        ctx.globalAlpha = a; ctx.fillStyle = look.fill;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = Math.min(0.85, 0.3 + 0.55 * off);
      ctx.strokeStyle = look.ring; ctx.lineWidth = 1.6 / Math.max(0.35, o.scale);
      ctx.setLineDash([look.dash[0] / Math.max(0.35, o.scale), look.dash[1] / Math.max(0.35, o.scale)]);
      ctx.lineDashOffset = f === 'power' ? -(o.timeMs / 220) % 26 : 0;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, 6.2832); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
