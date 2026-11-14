// 시뮬레이션 실행기 (표현 계층).
// 실제 시간 → 시뮬레이션 틱 변환만 담당한다. 배속은 "1초에 몇 틱"만 바꾸고, 시뮬레이션 결과에는 영향을 주지 않는다.

import { Sim } from '../sim/engine';
import type { ShiftReport } from '../sim/types';

const LS_SETTINGS = 'ar.settings.v1';
const LS_CURRENT = 'ar.current.v1';
const LS_HISTORY = 'ar.history.v1';

export interface Settings { speed: number; autoCam: boolean; truthView: boolean }
export interface HistoryItem { seed: string; when: number; summary: string; counts: Record<string, number>; incidents: number; hash: string }

function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function lsSet(key: string, v: unknown): void { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 저장 실패는 무시 */ } }

export function randomSeed(): string {
  // 시드 "선택"은 시뮬레이션 밖의 일이다. 일단 정해진 시드 안에서는 모든 것이 결정적이다.
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export class Runner {
  sim: Sim;
  settings: Settings;
  paused = false;
  alpha = 0;                  // 렌더 보간 계수 (0..1)
  private acc = 0;
  private last = 0;
  private lastSave = 0;
  version = 0;                // 새 교대가 시작될 때마다 증가 (UI 상태 초기화용)
  restoredTicks = 0;
  fps = 60;
  simMs = 0;

  constructor() {
    this.settings = { speed: 3, autoCam: true, truthView: true, ...lsGet<Partial<Settings>>(LS_SETTINGS, {}) };
    const url = new URL(window.location.href);
    const urlSeed = url.searchParams.get('seed');
    const cur = lsGet<{ seed: string; tick: number } | null>(LS_CURRENT, null);
    if (urlSeed) { this.sim = new Sim(urlSeed); }
    else if (cur && cur.seed && cur.tick > 0) {
      // 새로고침 복원: 같은 시드로 같은 틱까지 다시 돌리면 정확히 같은 상태가 된다
      this.sim = new Sim(cur.seed);
      this.sim.run(cur.tick);
      this.restoredTicks = cur.tick;
    } else this.sim = new Sim(randomSeed());
  }

  newShift(seed?: string): void {
    this.sim = new Sim(seed && seed.trim() ? seed.trim() : randomSeed());
    this.acc = 0; this.alpha = 0; this.paused = false; this.version++; this.restoredTicks = 0;
    lsSet(LS_CURRENT, { seed: this.sim.seed, tick: 0 });
  }

  setSpeed(v: number): void { this.settings.speed = v; this.paused = false; this.saveSettings(); }
  togglePause(): void { this.paused = !this.paused; }
  saveSettings(): void { lsSet(LS_SETTINGS, this.settings); }

  history(): HistoryItem[] { return lsGet<HistoryItem[]>(LS_HISTORY, []); }
  private pushHistory(r: ShiftReport): void {
    const h = this.history();
    if (h.length && h[0].seed === r.seed && h[0].hash === r.hash) return;
    h.unshift({ seed: r.seed, when: Date.now(), summary: r.summary[0] ?? '', counts: r.counts, incidents: r.totalIncidents, hash: r.hash });
    lsSet(LS_HISTORY, h.slice(0, 12));
  }

  /** requestAnimationFrame 마다 호출 */
  frame(nowMs: number): void {
    if (!this.last) this.last = nowMs;
    const dtReal = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    if (dtReal > 0) this.fps = this.fps * 0.95 + (1 / dtReal) * 0.05;
    const sim = this.sim;
    if (!this.paused && !sim.ended) {
      this.acc += dtReal * this.settings.speed;
      const t0 = performance.now();
      let steps = 0;
      while (this.acc >= sim.dt && steps < 40 && !sim.ended) { sim.step(); this.acc -= sim.dt; steps++; }
      if (steps >= 40) this.acc = 0;
      if (steps) this.simMs = this.simMs * 0.9 + (performance.now() - t0) * 0.1;
      this.alpha = Math.min(1, this.acc / sim.dt);
      if (sim.ended && sim.report) { this.pushHistory(sim.report); lsSet(LS_CURRENT, { seed: sim.seed, tick: 0 }); }
    }
    if (nowMs - this.lastSave > 2500 && !sim.ended) { this.lastSave = nowMs; lsSet(LS_CURRENT, { seed: sim.seed, tick: sim.tick }); }
  }
}
