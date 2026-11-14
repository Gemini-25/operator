// Automatic Camera Director (표현 계층)
// 플레이어 대신 "지금 가장 볼 만한 사건"을 골라 보여준다. 체류 시간은 실제 시간 기준이라
// 15배속에서도 화면이 정신없이 바뀌지 않는다. 시뮬레이션 상태를 읽기만 하고 절대 바꾸지 않는다.

import type { Sim } from '../sim/engine';
import type { Incident, SimEvent } from '../sim/types';

export interface CityCam { x: number; y: number; zoom: number }

export class CameraDirector {
  mode: 'city' | 'scene' = 'city';
  focus = -1;                 // 관찰 중인 사건 id
  manual = false;             // 사용자가 관찰 대상을 고정했는가
  freeLook = false;           // 사용자가 도시 지도를 직접 움직이는 중
  cam: CityCam = { x: 1200, y: 820, zoom: 1 };
  target: CityCam = { x: 1200, y: 820, zoom: 1 };
  reason = '도시 전체 관찰';
  private interest = new Map<number, number>();
  private processed = 0;
  private lastSwitch = -99;
  private clock = 0;
  private simRef: Sim | null = null;
  private closedLinger = new Map<number, number>();

  reset(): void {
    this.mode = 'city'; this.focus = -1; this.manual = false; this.freeLook = false;
    this.interest.clear(); this.processed = 0; this.lastSwitch = -99; this.closedLinger.clear();
    this.cam = { x: 1200, y: 820, zoom: 1 }; this.target = { ...this.cam }; this.reason = '도시 전체 관찰';
  }

  /** 되감기 뒤: 지나간 이벤트는 건너뛰고, 관찰 대상은 (그 시점에 존재하면) 유지한다. */
  resync(sim: Sim): void {
    this.simRef = sim; this.processed = sim.events.length; this.interest.clear(); this.closedLinger.clear();
    if (this.focus >= sim.incidents.length || (this.focus >= 0 && sim.incidents[this.focus].phase === 'unreported')) { this.focus = -1; this.mode = 'city'; }
    this.lastSwitch = this.clock;
  }

  /** 사용자가 관찰 대상을 고른다(명령이 아니라 시점 선택일 뿐이다). */
  pin(incidentId: number, mode?: 'city' | 'scene'): void {
    this.manual = true; this.freeLook = false; this.focus = incidentId;
    if (mode) this.mode = mode;
    this.lastSwitch = this.clock;
  }
  auto(): void { this.manual = false; this.freeLook = false; }
  overview(): void { this.manual = true; this.freeLook = false; this.focus = -1; this.mode = 'city'; this.target = { x: 1200, y: 820, zoom: 1 }; this.reason = '도시 전체 보기'; }

  private weight(e: SimEvent): number {
    let w = e.importance === 3 ? 42 : e.importance === 2 ? 18 : e.importance === 1 ? 5 : 1;
    if (e.problem) w += 16;
    if (e.kind === 'recovery') w += 10;
    if (e.kind === 'arrive') w += 20;
    if (e.kind === 'casualty') w += 10;
    return w;
  }

  update(sim: Sim, dtReal: number, sceneAvailable: (I: Incident) => boolean): void {
    if (this.simRef !== sim) { this.simRef = sim; this.reset(); }
    this.clock += dtReal;
    // 새 이벤트 → 흥미도
    for (; this.processed < sim.events.length; this.processed++) {
      const e = sim.events[this.processed];
      if (e.incidentId < 0) continue;
      this.interest.set(e.incidentId, (this.interest.get(e.incidentId) ?? 0) + this.weight(e));
      if (e.kind === 'resolve' && e.role === 'SYSTEM') this.closedLinger.set(e.incidentId, this.clock + 4.5);
    }
    const k = Math.exp(-dtReal / 6);
    for (const [id, v] of this.interest) this.interest.set(id, v * k);

    let best = -1, bestScore = 0, focusScore = -1;
    for (const I of sim.incidents) {
      if (I.phase === 'unreported') continue;
      const linger = (this.closedLinger.get(I.id) ?? 0) > this.clock;
      if (I.phase === 'closed' && !linger) continue;
      const base = I.phase === 'closed' ? 26 : I.phase === 'onscene' ? 46 : I.phase === 'call' ? 34 : 22;
      const sev = I.assessment ? I.assessment.severity * 4 : 0;
      let sc = base + sev + Math.min(120, this.interest.get(I.id) ?? 0);
      if (I.id === this.focus) { sc += 24; focusScore = sc; }
      if (sc > bestScore) { bestScore = sc; best = I.id; }
    }
    if (!this.manual) {
      const dwell = this.clock - this.lastSwitch;
      const focusGone = this.focus >= 0 && focusScore < 0;
      if (best !== this.focus && (focusGone || this.focus < 0 || dwell > 7 || bestScore > focusScore + 70)) {
        if (best >= 0 || focusGone) { this.focus = best; this.lastSwitch = this.clock; }
      }
      if (this.focus >= 0) {
        const I = sim.incidents[this.focus];
        this.mode = (I.phase === 'onscene' || I.phase === 'closed') && sceneAvailable(I) ? 'scene' : 'city';
        this.reason = I.phase === 'call' ? `신고 접수 중 — 사건 ${I.code}` : I.phase === 'onscene' ? `현장 활동 — 사건 ${I.code}` : I.phase === 'closed' ? `결과 확인 — 사건 ${I.code}` : `출동 부대 이동 — 사건 ${I.code}`;
      } else { this.mode = 'city'; this.reason = '도시 전체 관찰'; }
    } else if (this.focus >= 0) {
      const I = sim.incidents[this.focus];
      if (this.mode === 'scene' && !sceneAvailable(I)) this.mode = 'city';
      this.reason = `관찰 고정 — 사건 ${I.code}`;
    }
    // 도시 카메라 목표: 관찰 사건과 그쪽으로 가는 부대가 함께 보이도록
    if (!this.freeLook) {
      if (this.focus >= 0 && !(this.manual && this.mode === 'city' && this.focus < 0)) {
        const I = sim.incidents[this.focus];
        let x0 = I.truth.x, x1 = I.truth.x, y0 = I.truth.y, y1 = I.truth.y;
        for (const uid of I.assigned) {
          const u = sim.units[uid];
          if (u.state !== 'enroute' && u.state !== 'turnout') continue;
          x0 = Math.min(x0, u.x); x1 = Math.max(x1, u.x); y0 = Math.min(y0, u.y); y1 = Math.max(y1, u.y);
        }
        const spanX = Math.max(520, x1 - x0 + 420), spanY = Math.max(360, y1 - y0 + 320);
        const zoom = Math.max(1, Math.min(3, Math.min(sim.city.w / spanX, sim.city.h / spanY)));
        this.target = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom };
      } else this.target = { x: sim.city.w / 2, y: sim.city.h / 2, zoom: 1 };
    }
    const ease = 1 - Math.exp(-dtReal * 3.2);
    this.cam.x += (this.target.x - this.cam.x) * ease;
    this.cam.y += (this.target.y - this.cam.y) * ease;
    this.cam.zoom += (this.target.zoom - this.cam.zoom) * ease;
  }

  /** 사용자의 지도 조작 (확대/축소·이동) */
  userZoom(factor: number, wx: number, wy: number): void {
    this.manual = true; this.freeLook = true; this.mode = 'city';
    const z = Math.max(1, Math.min(4, this.target.zoom * factor));
    const r = this.target.zoom / z;
    this.target = { x: wx + (this.target.x - wx) * r, y: wy + (this.target.y - wy) * r, zoom: z };
    this.reason = '지도 직접 조작';
  }
  userPan(dx: number, dy: number): void {
    this.manual = true; this.freeLook = true; this.mode = 'city';
    this.target = { ...this.target, x: this.target.x - dx, y: this.target.y - dy };
    this.cam.x = this.target.x; this.cam.y = this.target.y;
    this.reason = '지도 직접 조작';
  }
}
