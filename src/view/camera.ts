// Automatic Camera Director (표현 계층)
// 플레이어 대신 "지금 가장 볼 만한 사건"을 골라 보여준다. 체류 시간은 실제 시간 기준이라
// 15배속에서도 화면이 정신없이 바뀌지 않는다. 시뮬레이션 상태를 읽기만 하고 절대 바꾸지 않는다.

import { CITY_H, CITY_W } from '../sim/cityPlan';
import type { Sim } from '../sim/engine';
import type { Incident, SimEvent } from '../sim/types';

export interface CityCam { x: number; y: number; zoom: number }
/** 현장 화면의 시점 (타일 좌표, 배율 1 = 현장 전체) */
export interface SceneView { x: number; y: number; zoom: number }
const SCENE_W = 30, SCENE_H = 20;
/** 현장 자동 확대가 따라가는 효과 기록과 무게. G4 는 'collapse'(2.5), X6 는 'horn'(2)을 한 단어씩 더한다 */
const ACTION_W: Record<string, number> = { shot: 2.5, boom: 2.5, flash: 2.5, hit: 2.5, spray: 0.6, breach: 2.5, melee: 1.5, taser: 2.0, cuff: 1.0 };

export class CameraDirector {
  mode: 'city' | 'scene' = 'city';
  focus = -1;                 // 관찰 중인 사건 id
  manual = false;             // 사용자가 관찰 대상을 고정했는가
  freeLook = false;           // 사용자가 도시 지도를 직접 움직이는 중
  cam: CityCam = { x: CITY_W / 2, y: CITY_H / 2, zoom: 1 };
  target: CityCam = { x: CITY_W / 2, y: CITY_H / 2, zoom: 1 };
  reason = '도시 전체 관찰';
  sceneCam: SceneView = { x: SCENE_W / 2, y: SCENE_H / 2, zoom: 1 };
  sceneTarget: SceneView = { x: SCENE_W / 2, y: SCENE_H / 2, zoom: 1 };
  sceneAuto = true;           // 벌어지는 일을 따라 자동으로 확대한다
  sceneManual = false;        // 사용자가 현장 화면을 직접 확대·이동했다 (두 번 누르면 풀린다)
  private sceneFor = -1;
  private sceneRetargetAt = 0;
  private interest = new Map<number, number>();
  private processed = 0;
  private lastSwitch = -99;
  private clock = 0;
  private simRef: Sim | null = null;
  private closedLinger = new Map<number, number>();

  reset(): void {
    this.mode = 'city'; this.focus = -1; this.manual = false; this.freeLook = false;
    this.interest.clear(); this.processed = 0; this.lastSwitch = -99; this.closedLinger.clear();
    this.cam = { x: CITY_W / 2, y: CITY_H / 2, zoom: 1 }; this.target = { ...this.cam }; this.reason = '도시 전체 관찰';
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
  /** (G5) 결정적 순간: 0.9초를 기다리지 않고 현장 확대를 바로 다시 잡는다 (사용자가 직접 확대했으면 하지 않는다) */
  nudge(): void { if (!this.sceneManual) this.sceneRetargetAt = this.clock; }
  overview(): void { this.manual = true; this.freeLook = false; this.focus = -1; this.mode = 'city'; this.target = { x: CITY_W / 2, y: CITY_H / 2, zoom: 1 }; this.reason = '도시 전체 보기'; }

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
      const sc0 = sim.scenes[I.id];
      if (sc0 && I.phase === 'onscene') for (let i = sc0.fx.length - 1; i >= 0 && sim.t - sc0.fx[i].t < 3; i--) if (sc0.fx[i].kind === 'shot') { sc += 30; break; }      // (G5) 최근 3초 안에 총성이 난 사건
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
    // 현장 시점: 관찰 대상이 바뀌면 전체 보기로 되돌린다
    if (this.sceneFor !== this.focus || this.mode !== 'scene') { this.sceneFor = this.focus; this.sceneReset(true); this.sceneRetargetAt = this.clock + 1.2; }
    else if (this.sceneAuto && !this.sceneManual && this.clock >= this.sceneRetargetAt) {
      this.sceneRetargetAt = this.clock + 0.9;
      const t = this.frameAction(sim), c = this.sceneTarget;
      // 조금 달라진 정도로는 움직이지 않는다 (화면이 떨리지 않게)
      if (Math.abs(t.zoom - c.zoom) > 0.14 || Math.hypot(t.x - c.x, t.y - c.y) > 1.6 / Math.max(1, t.zoom) + 0.6) this.sceneTarget = t;
    }
    const es = 1 - Math.exp(-dtReal * (this.sceneManual ? 9 : 1.7));
    this.sceneCam.x += (this.sceneTarget.x - this.sceneCam.x) * es;
    this.sceneCam.y += (this.sceneTarget.y - this.sceneCam.y) * es;
    this.sceneCam.zoom += (this.sceneTarget.zoom - this.sceneCam.zoom) * es;
    const ease = 1 - Math.exp(-dtReal * 3.2);
    this.cam.x += (this.target.x - this.cam.x) * ease;
    this.cam.y += (this.target.y - this.cam.y) * ease;
    this.cam.zoom += (this.target.zoom - this.cam.zoom) * ease;
  }

  /** 사용자의 지도 조작 (확대/축소·이동) */
  userZoom(factor: number, wx: number, wy: number): void {
    this.manual = true; this.freeLook = true; this.mode = 'city';
    const z = Math.max(1, Math.min(6.5, this.target.zoom * factor));
    const r = this.target.zoom / z;
    this.target = { x: wx + (this.target.x - wx) * r, y: wy + (this.target.y - wy) * r, zoom: z };
    this.reason = '지도 직접 조작';
  }
  /**
   * 지금 벌어지는 일(총격·폭발·방수, 움직이는 용의자, 임무 중인 대원, 현장에 남은 구조 대상)이 화면에 차도록 잡는다.
   * 가운데와 퍼진 정도로 잡으므로 멀리 떨어진 한두 명 때문에 화면이 넓어지지 않는다. 일이 현장 전체에 퍼져 있으면 전체 보기.
   */
  private frameAction(sim: Sim): SceneView {
    const full: SceneView = { x: SCENE_W / 2, y: SCENE_H / 2, zoom: 1 };
    const s = sim.scenes[this.focus];
    if (!s || s.arrivedAt < 0) return full;
    const pts: number[] = [];
    const add = (x: number, y: number, w: number): void => { pts.push(x, y, w); };
    for (const f of s.fx) {
      const age = sim.t - f.t;
      const w = ACTION_W[f.kind];
      if (age < 0 || age > 4 || w === undefined) continue;
      add(f.x, f.y, w);
      const c = f.c;
      if (c && c.ix !== undefined && c.iy !== undefined) add(c.ix, c.iy, 1.5);      // (G5) 탄착점
      else if (f.x2 !== undefined && f.y2 !== undefined) add(f.x2, f.y2, f.kind === 'spray' ? 0.6 : 1.5);
      if (c && c.ox !== undefined && c.oy !== undefined) add(c.ox, c.oy, 1.5);      // (G5) 던진 사람, 진입조 쪽
    }
    // (G5) 진입 예고: 4초 안에 들어갈 출입구
    if (s.entryOrdered && !s.breachDone && s.breachAt - sim.t <= 4) for (const k of [s.entryExit, s.entryExit2]) if (k >= 0 && k < s.exits.length) add(s.exits[k].x, s.exits[k].y, 2.5);
    for (const h of s.hostiles) if ((h.state === 'hold' || h.state === 'fight' || h.state === 'flee') && !h.hidden) add(h.x, h.y, 2.5);
    for (const a of s.agents) {
      if (a.status === 'left') continue;
      const tk = a.task ? a.task.kind : 'standby';
      if (tk === 'standby' || tk === 'board' || tk === 'rehab' || tk === 'resupply') continue;
      add(a.x, a.y, tk === 'perimeter' || tk === 'traffic' ? 0.5 : 1.2);
    }
    for (const c of s.casualties) if (c.tDiscovered >= 0 && c.where === 'scene' && !c.dead) add(c.x, c.y, 0.8);
    for (let i = 0; i < s.fire.length; i += 3) if (s.fire[i] > 0.3) add(i % s.w, (i / s.w) | 0, 0.25);
    let ws = 0, mx = 0, my = 0;
    for (let i = 0; i < pts.length; i += 3) { ws += pts[i + 2]; mx += pts[i] * pts[i + 2]; my += pts[i + 1] * pts[i + 2]; }
    if (ws < 2.4) return full;
    mx /= ws; my /= ws;
    let vx = 0, vy = 0;
    for (let i = 0; i < pts.length; i += 3) { vx += (pts[i] - mx) ** 2 * pts[i + 2]; vy += (pts[i + 1] - my) ** 2 * pts[i + 2]; }
    const hx = Math.max(6, 2.1 * Math.sqrt(vx / ws) + 3), hy = Math.max(4, 2.1 * Math.sqrt(vy / ws) + 2.4);
    const zoom = Math.max(1, Math.min(2.3, Math.min(SCENE_W / 2 / hx, SCENE_H / 2 / hy)));
    if (zoom < 1.15) return full;
    return this.clampScene({ x: mx + 0.5, y: my + 0.5, zoom });
  }

  /** 현장 화면 확대·축소 (tx, ty: 고정할 지점의 타일 좌표). 관찰 대상은 그대로 고정된다. */
  sceneZoom(factor: number, tx: number, ty: number): void {
    this.manual = true; this.sceneManual = true;
    const z = Math.max(1, Math.min(3.4, this.sceneTarget.zoom * factor));
    const r = this.sceneTarget.zoom / z;
    this.sceneTarget = this.clampScene({ x: tx + (this.sceneTarget.x - tx) * r, y: ty + (this.sceneTarget.y - ty) * r, zoom: z });
  }
  scenePan(dx: number, dy: number): void {
    if (this.sceneTarget.zoom <= 1.001) return;
    this.manual = true; this.sceneManual = true;
    this.sceneTarget = this.clampScene({ ...this.sceneTarget, x: this.sceneTarget.x - dx, y: this.sceneTarget.y - dy });
    this.sceneCam.x = this.sceneTarget.x; this.sceneCam.y = this.sceneTarget.y;
  }
  sceneReset(snap = false): void {
    this.sceneManual = false;
    this.sceneTarget = { x: SCENE_W / 2, y: SCENE_H / 2, zoom: 1 };
    if (snap) this.sceneCam = { ...this.sceneTarget };
  }
  private clampScene(v: SceneView): SceneView {
    const hx = SCENE_W / 2 / v.zoom, hy = SCENE_H / 2 / v.zoom;
    return { zoom: v.zoom, x: Math.max(hx - 1, Math.min(SCENE_W - hx + 1, v.x)), y: Math.max(hy - 1, Math.min(SCENE_H - hy + 1, v.y)) };
  }
  userPan(dx: number, dy: number): void {
    this.manual = true; this.freeLook = true; this.mode = 'city';
    this.target = { ...this.target, x: this.target.x - dx, y: this.target.y - dy };
    this.cam.x = this.target.x; this.cam.y = this.target.y;
    this.reason = '지도 직접 조작';
  }
}
