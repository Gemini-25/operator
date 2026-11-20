// 대응 교본의 현장 그림 (docs/specs/R3-doctrine.md §7.2 — 7단계). 그림만: 시뮬레이션 상태를 읽기만 하고 아무것도 바꾸지 않는다(결과 불변).
//   짝 끈      둘 다 위험 건물(화재·가스 누출·붕괴)의 실내에 있는 짝 사이의 가는 흰 점선 — 대원 층 바로 아래. 2인 진입을 눈으로 보게 한다
//   엄폐 자세  교본의 엄폐 임무(cover)로 멈춰 선 대원은 G5 의 엄폐 자세(몸을 낮춘다 — sprites.drawPerson 의 crouch). 엄폐 사격이 아니어도 같은 자세다
//   협상 중단  협상자가 교전을 피해 엄폐로 옮긴 동안(교본 P16 — 임무가 negotiate 에서 cover 로 바뀐다)에도 용의자 쪽의 '협상이 끊겼다' 풍선이 남는다(G5 drawNegotiation 의 술어 한 조각)
// 판단·실행 함수(doctrine.ts · doctrineRun.ts)는 부르지 않는다 — 대원·임무에 적힌 칸(a.buddy · task.kind · task.docRule)과 현장의 생김새만 읽는다.

import { ruleName } from '../../sim/field/doctrine/registry';
import { LANE_SHIELD_BY } from '../../sim/field/methods';
import { TYPE_DEFS } from '../../sim/incidentTypes';
import type { FieldAgent, Scene } from '../../sim/types';

/**
 * 머리 위 라벨 (§7.2): 판단 지점에서 기다리는 중이면(task.gateAt ≥ 0) 막고 있는 교본 줄의 짧은 이름('단독 진입 보류'·'대기조 확인 전 진입 보류'·'거리 유지'·'처치 대기' …),
 * 아니면 실행기가 적은 라벨 그대로(새 임무의 라벨 '엄폐'·'탄약 보급'·'공기 탈출'·'짝 따라 나감'·'짝 동행'·'분류'도 그대로 뜬다). 이름표(registry)만 읽는다
 */
export function headLabel(a: FieldAgent): string {
  const t = a.task;
  if (a.status === 'active' && t !== null && t.gateAt !== undefined && t.gateAt >= 0 && t.docRule !== undefined) { const r = ruleName(t.docRule); if (r !== null) return r.short; }
  return a.label;
}
/** 머리 위 라벨의 길이 상한: 평소 13자(넘으면 12자 + …), 판단 지점의 줄 이름은 잘리지 않게 16자 */
export function headLabelMax(a: FieldAgent): number { return a.task !== null && a.task.gateAt !== undefined && a.task.gateAt >= 0 && a.task.docRule !== undefined && a.status === 'active' ? 16 : 13; }

type G = CanvasRenderingContext2D;
const px = (v: number, ts: number): number => (v + 0.5) * ts;
const ip = (a: { x: number; y: number; px: number; py: number }, alpha: number): { x: number; y: number } => ({ x: a.px + (a.x - a.px) * alpha, y: a.py + (a.y - a.py) * alpha });

/** 그 대원이 위험 건물(화재·가스 누출·붕괴 현장)의 실내 구역에 서 있는가 (현장의 생김새 — 구역의 indoor) */
export function inHazardInterior(s: Scene, a: FieldAgent): boolean {
  if (!TYPE_DEFS[s.kind].indoorRisk) return false;
  const x = Math.round(a.x), y = Math.round(a.y);
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
  const rg = s.region[y * s.w + x];
  return rg >= 0 && s.regions[rg] !== undefined && s.regions[rg].indoor;
}
/** 짝 끈으로 이을 짝들: 서로가 서로의 짝이고(a.buddy), 둘 다 활동 중이며, 둘 다 위험 건물 실내에 있다. 한 쌍은 한 번만 (rid 가 작은 쪽이 앞) */
export function buddyLinks(s: Scene): [FieldAgent, FieldAgent][] {
  const out: [FieldAgent, FieldAgent][] = [];
  const ag = s.agents;
  for (let k = 0; k < ag.length; k++) {
    const a = ag[k];
    if (a.status !== 'active' || a.buddy === undefined || a.buddy < 0 || a.buddy <= a.rid) continue;
    let b: FieldAgent | null = null;
    for (let q = 0; q < ag.length; q++) if (ag[q].rid === a.buddy) { b = ag[q]; break; }
    if (b === null || b.status !== 'active' || b.buddy !== a.rid) continue;
    if (inHazardInterior(s, a) && inHazardInterior(s, b)) out.push([a, b]);
  }
  return out;
}
/** 짝 끈 — 대원 층 바로 아래. 가는 흰 점선(어두운 밑선 위), 두 사람의 몸 밑에서 시작해 몸에 가려지게 조금 짧게 긋는다. 붙어 선 짝(0.9칸 안)은 긋지 않는다 */
export function drawBuddyLines(g: G, s: Scene, ts: number, alpha: number): void {
  const links = buddyLinks(s);
  if (!links.length) return;
  g.save();
  g.lineCap = 'round';
  for (const [a, b] of links) {
    const p = ip(a, alpha), q = ip(b, alpha);
    const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
    if (d < 0.9) continue;
    const ux = dx / d, uy = dy / d, pad = 0.32;
    const x0 = px(p.x + ux * pad, ts), y0 = px(p.y + uy * pad, ts), x1 = px(q.x - ux * pad, ts), y1 = px(q.y - uy * pad, ts);
    g.setLineDash([]);
    g.strokeStyle = 'rgba(8,13,18,0.35)'; g.lineWidth = Math.max(2, ts * 0.07);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.setLineDash([Math.max(2, ts * 0.12), Math.max(2, ts * 0.12)]);
    g.strokeStyle = 'rgba(240,246,252,0.78)'; g.lineWidth = Math.max(1, ts * 0.035);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.setLineDash([]);
  g.restore();
}
/** 교본의 엄폐 임무(cover)인가 — 자세: 총을 겨눈 채, 멈추면 몸을 낮춘다 */
export function coverTask(a: FieldAgent): boolean { return a.task !== null && a.task.kind === 'cover'; }
/** 엄폐 임무로 멈춰 선 대원은 몸을 낮춘다 (G5 의 엄폐 자세) */
export function coverCrouch(a: FieldAgent, moving: boolean): boolean { return !moving && a.status === 'active' && coverTask(a); }
/** 협상자가 교전을 피해 엄폐 중인가 (교본 P16 — 그 엄폐 임무는 협상 상대를 task.hostile 로 들고 있다) */
export function talkBrokenCover(a: FieldAgent): boolean { return a.task !== null && a.task.kind === 'cover' && a.task.docRule === 'P16' && a.task.hostile >= 0; }
/**
 * 차량 차단(교본 P20·F18 — 방법 blockLane): 그 부대의 차가 차로 입구를 막고 서 있으면 그 자리(칸 좌표), 아니면 null — 현장 그림이 그 차를 대기 줄 대신 입구에 그린다.
 * 읽는 것: s.laneShield(막은 통제 지점)·methods.LANE_SHIELD_BY(그 지점을 막은 부대)·차로 줄(생김새). 통제 지점 0 은 서쪽 입구(차는 둘째 차로 줄로 들어온다), 1 은 동쪽 입구(첫째 차로 줄)
 * — hazards.tickLane 과 같은 짝. 차는 차로 가운데가 아니라 길가 쪽으로 반 칸 물려 세운다(통제가 끝나기 전에는 차가 그 곁을 지나 들어온다)
 */
export function laneShieldSpot(s: Scene, unitId: number): { x: number; y: number } | null {
  const sh = s.laneShield, by = LANE_SHIELD_BY.get(s);
  if (sh === null || sh === undefined || by === undefined || !s.laneRows.length) return null;
  for (let q = 0; q < sh.length; q++) {
    const k = sh[q];
    if (by[k] !== unitId) continue;
    const rows = s.laneRows, row = rows.length === 2 ? rows[k === 0 ? 1 : 0] : rows[0];
    const edge = rows.length === 2 ? (row === Math.min(rows[0], rows[1]) ? -0.5 : 0.5) : 0.5;      // 길가 쪽으로
    return { x: k === 0 ? 1.1 : s.w - 2.1, y: row + edge };
  }
  return null;
}
