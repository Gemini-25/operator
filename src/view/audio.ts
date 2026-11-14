// 소리 (표현 계층). 음원 파일 없이 WebAudio 로 합성한다.
// 시뮬레이션에서 "새로 생긴 이벤트·효과"를 읽어 소리로 바꿀 뿐이고, 시뮬레이션에는 아무 영향도 주지 않는다.
// 소리 길 (G5): 교전 소리 voice → [정위] → [먼 소리 lowpass] → combatBus(0.9) → busLP ─┐
//                                              └→ roomSend(실내 잔향) ────────────────┤
//               기존 소리(벨·무전·경보·사이렌) ─────────────────────────────────────────┴→ duck → master(음량) → 압축기 → 출력
//               (섬광탄 이명만 duck 를 거치지 않고 master 로 간다)

import type { Sim } from '../sim/engine';
import { isIndoor } from '../sim/field/grid';
import type { Fx } from '../sim/types';
import { CombatVoice, isGunClass, newPlanState, planCues } from './audioCombat';
import type { Cue, Place } from './audioCombat';
import type { FxEntry } from './scene/fxBook';

/** G5 가 음색을 정한 종류. 나머지(물줄기, G4 'collapse', X6 'horn', R1 'drop', 앞으로 생길 종류)는 아래의 기존 분기로 넘긴다 */
const COMBAT_KINDS = new Set<string>(['shot', 'hit', 'flash', 'boom', 'breach', 'melee', 'cuff', 'taser', 'glass', 'debris', 'tick', 'strike', 'hail', 'reply']);
/** 지도 화면에서 들리는 먼 소리 */
const FAR_KINDS = new Set<string>(['gun', 'boom', 'flashBang', 'breach']);

export interface SoundUpdate {
  paused: boolean; speed: number;     // speed = 실제 배속 effSpeed (자동 감속 중이면 1)
  focus: number; inScene: boolean;
  fresh?: readonly FxEntry[];         // 연출 기억이 이번 프레임에 받아들인 항목
  place?: (sid: number, x: number, y: number) => Place | null;
  clock?: number; rate?: number;      // 연출 시계와 그 속도
  tension?: boolean;                  // 긴장음 조건 (관찰 중인 무장 현장에 총을 든 용의자가 대치·교전 중)
}

export class SoundDirector {
  enabled = true;
  volume = 0.5;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private combatBus: GainNode | null = null;
  private busLP: BiquadFilterNode | null = null;
  private roomIn: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private voice: CombatVoice | null = null;
  private plan = newPlanState();
  private simRef: Sim | null = null;
  private processed = 0;
  private callsSeen = 0;
  private last: Record<string, number> = {};
  private siren: { o: OscillatorNode; lfo: OscillatorNode; g: GainNode } | null = null;
  private drone: { nodes: AudioScheduledSourceNode[]; g: GainNode } | null = null;
  private gunStarts: number[] = [];
  private sounding: [number, number][] = [];
  private tinAt = -99;
  private farTok = 4; private farAt = 0;
  /** (G5) 교전 소리 통계 (확인용): perSec·maxPerSec = 사격류 cue, voices = 지금 울리는 교전 cue, made = 만든 교전 cue 누적 */
  stats = { perSec: 0, maxPerSec: 0, voices: 0, dropped: 0, made: 0 };

  /** 브라우저 정책상 첫 사용자 입력 뒤에만 소리를 낼 수 있다. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        const c = new AC();
        this.ctx = c;
        // 압축기: 여러 소리가 겹쳐도 깨지지 않게
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;
        comp.connect(c.destination);
        this.master = c.createGain();
        this.master.gain.value = this.enabled ? this.volume : 0;
        this.master.connect(comp);
        this.duck = c.createGain(); this.duck.gain.value = 1; this.duck.connect(this.master);
        this.busLP = c.createBiquadFilter(); this.busLP.type = 'lowpass'; this.busLP.frequency.value = 8000; this.busLP.connect(this.duck);
        this.combatBus = c.createGain(); this.combatBus.gain.value = 0.9; this.combatBus.connect(this.busLP);
        // 실내 잔향: 짧은 지연 + 되먹임 + lowpass
        const dl = c.createDelay(0.5), fb = c.createGain(), lp = c.createBiquadFilter();
        dl.delayTime.value = 0.06; fb.gain.value = 0.28; lp.type = 'lowpass'; lp.frequency.value = 1800;
        dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.duck);
        this.roomIn = dl;
        const len = c.sampleRate;
        this.noise = c.createBuffer(1, len, len);
        const d = this.noise.getChannelData(0);
        let x = 1234567;
        for (let i = 0; i < len; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = (x / 0x7fffffff) * 2 - 1; }
        this.voice = new CombatVoice(c, this.noise, this.combatBus, this.roomIn);
      } else if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { this.ctx = null; }
  }

  setEnabled(on: boolean): void { this.enabled = on; this.applyGain(); }
  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1, v)); this.applyGain(); }
  private applyGain(): void { if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.03); }

  /** 되감기·새 교대 뒤: 지나간 이벤트를 다시 재생하지 않는다. */
  resync(sim: Sim): void { this.simRef = sim; this.processed = sim.events.length; this.callsSeen = sim.calls.length; this.plan.lastShot.clear(); }

  private ok(cue: string, minGap: number): boolean {
    if (!this.ctx) return false;
    const now = this.ctx.currentTime;
    if (now - (this.last[cue] ?? -99) < minGap) return false;
    this.last[cue] = now;
    return true;
  }
  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, slideTo = 0): void {
    const c = this.ctx!, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.duck!); o.start(t); o.stop(t + dur + 0.03);
  }
  private burst(dur: number, gain: number, freq: number, q = 1, kind: BiquadFilterType = 'bandpass', delay = 0): void {
    const c = this.ctx!, t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = kind; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.duck!); src.start(t, (t * 0.37) % 0.8); src.stop(t + dur + 0.03);
  }

  /** 통계: 음소거로 일찍 돌아가기 전에 고친다 (perSec 는 1초 안에 0 이 된다) */
  private tickStats(now: number): void {
    while (this.gunStarts.length && this.gunStarts[0] <= now - 1) this.gunStarts.shift();
    let n = 0; for (const t of this.gunStarts) if (t <= now) n++;
    this.stats.perSec = n; if (n > this.stats.maxPerSec) this.stats.maxPerSec = n;
    this.sounding = this.sounding.filter((v) => v[1] > now);
    let v = 0; for (const [a] of this.sounding) if (a <= now) v++;
    this.stats.voices = v; this.stats.dropped = this.plan.dropped;
  }

  update(sim: Sim, o: SoundUpdate): void {
    if (this.simRef !== sim) this.resync(sim);
    this.tickStats(this.ctx ? this.ctx.currentTime : 0);
    if (!this.ctx || !this.enabled) { this.processed = sim.events.length; this.callsSeen = sim.calls.length; this.setSiren(false); this.setDrone(false); return; }
    const fast = o.speed >= 8;
    // 새 신고 전화 → 벨
    for (; this.callsSeen < sim.calls.length; this.callsSeen++) {
      if (this.ok('ring', 1.2)) for (let k = 0; k < 2; k++) { this.tone(880, 0.16, 0.16, 'triangle', k * 0.26); this.tone(1100, 0.16, 0.12, 'triangle', k * 0.26 + 0.08); }
    }
    // 새 이벤트 → 효과음. 교전(교전 발생·진입·섬광탄 투척 action, 대원의 검거 resolve)은 같은 틱의 효과 기록이 소리를 낸다 — 두 번 울리지 않는다
    const backlog = sim.events.length - this.processed;
    for (; this.processed < sim.events.length; this.processed++) {
      if (backlog > 40) continue;                         // 한꺼번에 너무 많이 쌓였으면(빠른 이동) 건너뛴다
      const e = sim.events[this.processed];
      if (e.truth) continue;
      if (e.kind === 'call') { if (!fast && this.ok('blip', 0.22)) this.tone(e.role === 'CALLER' ? 520 : 760, 0.05, 0.035, 'sine'); }
      else if (e.kind === 'radio' || e.kind === 'command') { if (!fast && this.ok('radio', 0.32)) { this.burst(0.07, 0.07, 1700, 2); this.tone(940, 0.045, 0.045, 'square', 0.06); } }
      else if (e.kind === 'dispatch') { if (this.ok('dispatch', 0.5)) { this.tone(660, 0.13, 0.11, 'triangle'); this.tone(880, 0.16, 0.11, 'triangle', 0.14); } }
      else if (e.kind === 'problem') { if (e.importance >= 2 && this.ok('problem', 0.7)) { this.tone(220, 0.16, 0.12, 'sawtooth'); this.tone(196, 0.2, 0.12, 'sawtooth', 0.18); } }
      else if (e.kind === 'recovery') { if (this.ok('recovery', 0.5)) this.tone(520, 0.14, 0.07, 'sine', 0, 780); }
      else if (e.kind === 'arrive') { if (this.ok('arrive', 0.5)) { this.tone(700, 0.06, 0.07, 'square'); this.tone(700, 0.06, 0.07, 'square', 0.1); } }
      else if (e.kind === 'casualty' && e.importance >= 3) { if (this.ok('loss', 0.8)) this.tone(160, 0.6, 0.12, 'sine', 0, 110); }
      else if (e.kind === 'resolve' && e.role === 'SYSTEM' && e.incidentId >= 0) {
        const r = sim.incidents[e.incidentId].result;
        if (r && this.ok('resolve', 0.4)) {
          const notes = r.outcome === 'success' || r.outcome === 'delayed' ? [523, 659, 784] : r.outcome === 'partial' ? [523, 587] : [440, 370, 311];
          notes.forEach((f, k) => this.tone(f, 0.28, 0.09, 'triangle', k * 0.13));
        }
      } else if (e.kind === 'shift' && sim.ended) { [392, 523, 659, 784].forEach((f, k) => this.tone(f, 0.4, 0.09, 'triangle', k * 0.16)); }
    }
    // 효과 기록: 연출 기억이 받아들인 새 항목(fresh)
    if (o.fresh && o.fresh.length && !o.paused) {
      // G5 가 음색을 정하지 않은 종류는 지금처럼 관찰 중인 현장에서만 (물줄기, 그리고 G4·X6·R1 이 더할 분기의 자리)
      if (o.inScene && o.focus >= 0) for (const e of o.fresh) if (e.f && e.sid === o.focus && !COMBAT_KINDS.has(e.kind)) this.legacy(e.f, fast);
      if (o.place && o.clock !== undefined && o.rate !== undefined && this.voice) {
        const now = this.ctx.currentTime;
        let cues: Cue[] = planCues(o.fresh, o.speed, now, this.plan, { clock: o.clock, rate: o.rate });
        if (!o.inScene) {
          // 지도 화면: 사격·폭발·섬광탄·진입만, 초당 4개까지
          this.farTok = Math.min(4, this.farTok + (now - this.farAt) * 4); this.farAt = now;
          cues = cues.filter((c) => { if (!FAR_KINDS.has(c.kind) || this.farTok < 1) return false; this.farTok -= 1; return true; });
        }
        for (const c of cues) {
          const pl = o.place(c.sid, c.x, c.y);
          if (!pl || pl.gain <= 0.002) continue;
          const s = sim.scenes[c.sid];
          const tx = Math.round(c.x), ty = Math.round(c.y);
          const indoor = !!s && tx >= 0 && ty >= 0 && tx < s.w && ty < s.h && isIndoor(s.tiles[ty * s.w + tx]);
          this.voice.play(c, pl, indoor);
          this.stats.made++;
          const at = now + c.when;
          if (isGunClass(c.kind)) this.gunStarts.push(at);
          this.sounding.push([at, at + c.dur]);
          // 섬광탄 이명: 관찰 중인 현장, 보이는 범위 안, 실제 배속 8 미만, 4초에 한 번
          if (c.kind === 'flashBang' && o.inScene && c.sid === o.focus && pl.gain >= 0.999 && o.speed < 8 && now - this.tinAt >= 4) { this.tinAt = now; this.tinnitus(at); }
        }
        this.gunStarts.sort((a, b) => a - b);
        this.tickStats(now);
      }
    }
    // 출동 중인 차량이 있으면 멀리서 들리는 사이렌 (지도 화면에서만)
    this.setSiren(!o.paused && !o.inScene && sim.units.some((u) => u.state === 'enroute'));
    this.setDrone(!o.paused && o.inScene && !!o.tension && o.speed <= 3);
  }

  /** G5 가 음색을 정하지 않은 효과의 소리 (지금의 분기) */
  private legacy(f: Fx, fast: boolean): void {
    if (f.kind === 'spray') { if (!fast && this.ok('spray', 0.28)) this.burst(0.22, 0.03, 5200, 0.6, 'highpass'); }
  }

  /** 섬광탄 이명: sine 4100Hz + 주 버스 덕킹 + 교전 버스 lowpass 회복 */
  private tinnitus(t: number): void {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = 4100;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.025, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + 2.25);
    const dk = this.duck!.gain;
    dk.cancelScheduledValues(t); dk.setValueAtTime(dk.value, t); dk.linearRampToValueAtTime(0.4, t + 0.2); dk.linearRampToValueAtTime(1, t + 1.2);
    const lf = this.busLP!.frequency;
    lf.cancelScheduledValues(t); lf.setValueAtTime(1200, t); lf.exponentialRampToValueAtTime(8000, t + 1.5);
  }

  /** 긴장음: sine 55Hz + 55.4Hz(맥놀이) + 잡음 lowpass 200Hz, 합쳐 0.012. 1.5초에 들어오고 2초에 빠진다 */
  private setDrone(on: boolean): void {
    if (!this.ctx || !this.duck) return;
    const c = this.ctx;
    if (on && !this.drone) {
      const g = c.createGain(); g.gain.value = 0.0001; g.connect(this.duck);
      const a = c.createOscillator(), b = c.createOscillator(), n = c.createBufferSource(), lp = c.createBiquadFilter(), ng = c.createGain();
      a.frequency.value = 55; b.frequency.value = 55.4; n.buffer = this.noise; n.loop = true; lp.type = 'lowpass'; lp.frequency.value = 200; ng.gain.value = 0.5;
      a.connect(g); b.connect(g); n.connect(lp); lp.connect(ng); ng.connect(g);
      a.start(); b.start(); n.start();
      g.gain.setTargetAtTime(0.006, c.currentTime, 0.5);      // 세 소리가 합쳐 약 0.012
      this.drone = { nodes: [a, b, n], g };
    } else if (!on && this.drone) {
      const d = this.drone; this.drone = null;
      d.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.6);
      for (const nd of d.nodes) nd.stop(c.currentTime + 2.2);
    }
  }

  private setSiren(on: boolean): void {
    if (!this.ctx || !this.duck) return;
    const c = this.ctx;
    if (on && !this.siren) {
      const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 760; lfo.type = 'sine'; lfo.frequency.value = 0.42; lg.gain.value = 190;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.value = 0.0001; g.gain.setTargetAtTime(0.022, c.currentTime, 0.4);
      o.connect(g); g.connect(this.duck); o.start(); lfo.start();
      this.siren = { o, lfo, g };
    } else if (!on && this.siren) {
      const s = this.siren; this.siren = null;
      s.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.25);
      s.o.stop(c.currentTime + 1.2); s.lfo.stop(c.currentTime + 1.2);
    }
  }
}
