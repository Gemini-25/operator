// 소리 (표현 계층). 음원 파일 없이 WebAudio 로 합성한다.
// 시뮬레이션에서 "새로 생긴 이벤트·효과"를 읽어 소리로 바꿀 뿐이고, 시뮬레이션에는 아무 영향도 주지 않는다.

import type { Sim } from '../sim/engine';

export class SoundDirector {
  enabled = true;
  volume = 0.5;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private simRef: Sim | null = null;
  private processed = 0;
  private callsSeen = 0;
  private fxT = new Map<number, number>();
  private last: Record<string, number> = {};
  private siren: { o: OscillatorNode; lfo: OscillatorNode; g: GainNode } | null = null;

  /** 브라우저 정책상 첫 사용자 입력 뒤에만 소리를 낼 수 있다. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? this.volume : 0;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, len);
        const d = this.noise.getChannelData(0);
        let x = 1234567;
        for (let i = 0; i < len; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = (x / 0x7fffffff) * 2 - 1; }
      } else if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { this.ctx = null; }
  }

  setEnabled(on: boolean): void { this.enabled = on; this.applyGain(); }
  setVolume(v: number): void { this.volume = Math.max(0, Math.min(1, v)); this.applyGain(); }
  private applyGain(): void { if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime, 0.03); }

  /** 되감기·새 교대 뒤: 지나간 이벤트를 다시 재생하지 않는다. */
  resync(sim: Sim): void { this.simRef = sim; this.processed = sim.events.length; this.callsSeen = sim.calls.length; this.fxT.clear(); }

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
    o.connect(g); g.connect(this.master!); o.start(t); o.stop(t + dur + 0.03);
  }
  private burst(dur: number, gain: number, freq: number, q = 1, kind: BiquadFilterType = 'bandpass', delay = 0): void {
    const c = this.ctx!, t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = kind; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master!); src.start(t, (t * 0.37) % 0.8); src.stop(t + dur + 0.03);
  }

  update(sim: Sim, o: { paused: boolean; speed: number; focus: number; inScene: boolean }): void {
    if (this.simRef !== sim) this.resync(sim);
    if (!this.ctx || !this.enabled) { this.processed = sim.events.length; this.callsSeen = sim.calls.length; this.setSiren(false); return; }
    const fast = o.speed >= 8;
    // 새 신고 전화 → 벨
    for (; this.callsSeen < sim.calls.length; this.callsSeen++) {
      if (this.ok('ring', 1.2)) for (let k = 0; k < 2; k++) { this.tone(880, 0.16, 0.16, 'triangle', k * 0.26); this.tone(1100, 0.16, 0.12, 'triangle', k * 0.26 + 0.08); }
    }
    // 새 이벤트 → 효과음
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
    // 관찰 중인 현장의 효과: 총성, 폭발, 방수
    if (o.inScene && o.focus >= 0 && !o.paused) {
      const s = sim.scenes[o.focus];
      if (s) {
        const since = this.fxT.get(s.id) ?? sim.t;
        let newest = since;
        for (const f of s.fx) {
          if (f.t <= since) continue;
          if (f.t > newest) newest = f.t;
          if (f.kind === 'shot') { if (this.ok('shot', 0.07)) { this.burst(0.09, 0.26, 1400, 0.7, 'lowpass'); this.tone(150, 0.06, 0.12, 'square', 0, 60); } }
          else if (f.kind === 'flash') { if (this.ok('flash', 0.3)) { this.burst(0.35, 0.3, 2600, 0.4, 'highpass'); this.tone(1900, 0.5, 0.06, 'sine', 0.05, 1500); } }
          else if (f.kind === 'boom') { if (this.ok('boom', 0.4)) { this.tone(70, 0.6, 0.3, 'sine', 0, 32); this.burst(0.5, 0.25, 500, 0.5, 'lowpass'); } }
          else if (f.kind === 'hit') { if (this.ok('hit', 0.2)) this.tone(110, 0.1, 0.12, 'triangle', 0, 70); }
          else if (f.kind === 'spray') { if (!fast && this.ok('spray', 0.28)) this.burst(0.22, 0.03, 5200, 0.6, 'highpass'); }
        }
        this.fxT.set(s.id, newest);
      }
    }
    // 출동 중인 차량이 있으면 멀리서 들리는 사이렌 (지도 화면에서만)
    this.setSiren(!o.paused && !o.inScene && sim.units.some((u) => u.state === 'enroute'));
  }

  private setSiren(on: boolean): void {
    if (!this.ctx || !this.master) return;
    const c = this.ctx;
    if (on && !this.siren) {
      const o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
      o.type = 'sine'; o.frequency.value = 760; lfo.type = 'sine'; lfo.frequency.value = 0.42; lg.gain.value = 190;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.value = 0.0001; g.gain.setTargetAtTime(0.022, c.currentTime, 0.4);
      o.connect(g); g.connect(this.master); o.start(); lfo.start();
      this.siren = { o, lfo, g };
    } else if (!on && this.siren) {
      const s = this.siren; this.siren = null;
      s.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.25);
      s.o.stop(c.currentTime + 1.2); s.lfo.stop(c.currentTime + 1.2);
    }
  }
}
