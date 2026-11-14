// 교전 소리 (표현 계층, docs/specs/G5-combat-fx.md 4절). 음원 파일 없이 WebAudio 로 합성한다.
// planCues: 연출 기억(FxBook)의 새 항목(fresh)에서 "무엇을 언제 낼지"를 고른다 — AudioContext 없이 시험할 수 있는 순수 함수.
// CombatVoice: 고른 소리(cue)를 발진기·잡음 마디로 만든다. 시뮬레이션에는 아무 영향도 주지 않는다.

import type { BreachHow, FxWeapon } from '../sim/types';
import type { FxEntry } from './scene/fxBook';
import { flightOf } from './scene/fxBook';

export type CueKind =
  | 'gun' | 'impactWall' | 'impactFurn' | 'impactDoor' | 'hit' | 'armor' | 'melee' | 'taser'      // 사격류 (토큰 통을 지난다)
  | 'flashRoll' | 'flashBang' | 'boom' | 'breach' | 'cuff' | 'glass' | 'debris'
  | 'tick' | 'strike' | 'hail' | 'reply';
export interface Cue {
  kind: CueKind;
  when: number;                       // 지금부터 몇 초 뒤 (실제 시간)
  sid: number; x: number; y: number;
  pri: number;                        // 동시 발음 상한에서 남길 순서 (클수록 남는다)
  gain: number;                       // 세기 배율 (연사 0.8, 첫 발 +3dB)
  dur: number;                        // 울리는 길이(초)
  seed: number;                       // 음높이의 작은 흔들림 (기록 해시)
  wpn?: FxWeapon; first?: boolean; how?: BreachHow; r?: number; sync?: boolean; side?: 0 | 1; res?: string;
}
export interface PlanState {
  tokens: number; tokAt: number;      // 사격류 토큰 통 (용량 4, 초당 10개 채움)
  lastShot: Map<number, number>;      // 현장 → 마지막 사격의 시뮬레이션 시각 (첫 발 판단)
  lastAt: Record<string, number>;     // 종류별 최소 간격 (실제 시간)
  sounding: { end: number; start: number; pri: number }[];      // 예약한 교전 소리의 시작·끝 (동시 발음 상한)
  dropped: number;
}
export const TOKEN_CAP = 4, TOKEN_RATE = 10, VOICE_CAP = 18;
export function newPlanState(): PlanState { return { tokens: TOKEN_CAP, tokAt: 0, lastShot: new Map(), lastAt: {}, sounding: [], dropped: 0 }; }

const PRI: Record<CueKind, number> = {
  boom: 10, flashBang: 9, flashRoll: 9, breach: 8, gun: 6, taser: 5, cuff: 4, impactWall: 3, impactFurn: 3, impactDoor: 3, melee: 3, hit: 2, armor: 2, glass: 1, debris: 1, tick: 0, strike: 0, hail: 0, reply: 0,
};
const DUR: Record<CueKind, number> = {
  gun: 0.36, impactWall: 0.1, impactFurn: 0.06, impactDoor: 0.06, hit: 0.11, armor: 0.06, melee: 0.12, taser: 1.0,
  flashRoll: 0.03, flashBang: 0.55, boom: 2.0, breach: 0.3, cuff: 0.12, glass: 0.15, debris: 0.25, tick: 0.08, strike: 0.07, hail: 0.5, reply: 0.4,
};
const GUNNY = new Set<CueKind>(['gun', 'impactWall', 'impactFurn', 'impactDoor', 'hit', 'armor', 'melee', 'taser']);
/** 사격류 cue 인가 (토큰 통·perSec 를 세는 단위) */
export const isGunClass = (k: CueKind): boolean => GUNNY.has(k);

/**
 * 새 항목에서 낼 소리를 고른다 (4.4절).
 *  speed: 실제 배속 effSpeed (자동 감속 중이면 1). now: 실제 시간(초, 토큰 통·최소 간격·동시 발음). clock·rate: 연출 시계와 그 속도.
 *  시각: when = max(0, born + delay + stage − clock + L) / rate. L = min(0.25, max(0, clock − 가장 이른 born + delay)).
 *  배속 1: 사격 한 발씩, 탄착·피격은 묶음마다 1 / 3: 사격 묶음마다 처음과 끝(70ms) / 8·15: 사격 묶음마다 연사 min(n,3) 발(55ms, ×0.8), 탄착·피격·수갑 없음, 유리·가구 0.3초에 하나.
 *  묶음 = (현장, 소리 종류, 쏜 쪽). 사격류는 토큰 통(용량 4, 초당 10)을 지나고, 비면 버린다. 섬광·폭발·진입·수갑·합성 항목은 토큰을 쓰지 않는다.
 *  지금 울리는 cue 가 18개 이상이면 우선순위 낮은 것부터 버린다.
 */
export function planCues(fresh: readonly FxEntry[], speed: number, now: number, st: PlanState, o: { clock: number; rate: number }): Cue[] {
  if (o.rate <= 0 || !fresh.length) return [];
  // 토큰 채우기
  st.tokens = Math.min(TOKEN_CAP, st.tokens + Math.max(0, now - st.tokAt) * TOKEN_RATE); st.tokAt = now;
  let earliest = Infinity;
  for (const e of fresh) earliest = Math.min(earliest, e.born + e.delay);
  const L = Math.min(0.25, Math.max(0, o.clock - earliest));
  const whenOf = (e: FxEntry, stage: number): number => Math.max(0, e.born + e.delay + stage - o.clock + L) / o.rate;
  const fast = speed >= 8, mid = speed >= 3 && !fast;
  const raw: Cue[] = [];
  const mk = (kind: CueKind, e: FxEntry, stage: number, extra: Partial<Cue> = {}): Cue => ({ kind, when: whenOf(e, stage), sid: e.sid, x: e.x, y: e.y, pri: PRI[kind], gain: 1, dur: DUR[kind], seed: e.seed, ...extra });
  // 묶음: (현장, 종류, 쏜 쪽)
  const groups = new Map<string, Cue[]>();
  const push = (c: Cue, key: string): void => { let g = groups.get(key); if (!g) { g = []; groups.set(key, g); } g.push(c); };
  for (const e of fresh) {
    const f = e.f, c = f?.c;
    switch (e.kind) {
      case 'shot': {
        const side = (c?.side ?? (f?.color === '#ff8a5c' ? 1 : 0)) as 0 | 1;
        const last = st.lastShot.get(e.sid);
        const first = last === undefined || (f !== null && f.t - last >= 10);
        if (f) st.lastShot.set(e.sid, f.t);
        push(mk('gun', e, 0, { wpn: c?.wpn ?? (side ? 'hgun' : 'pistol'), first, side, pri: first ? 7 : PRI.gun, gain: first ? 1.41 : 1, dur: first ? 0.5 : DUR.gun }), `${e.sid}:gun:${side}`);
        const stop = c?.stop;
        if (f && (stop === 'wall' || stop === 'door' || stop === 'furn')) {
          const kind: CueKind = stop === 'wall' ? 'impactWall' : stop === 'door' ? 'impactDoor' : 'impactFurn';
          const imp = mk(kind, e, e.fly ?? flightOf(f), { side });
          if (c?.ix !== undefined) { imp.x = c.ix; imp.y = c.iy ?? e.y; }
          push(imp, `${e.sid}:impact:${side}`);
        }
        break;
      }
      case 'hit': {
        const armor = c?.tk === 0 && (c.arm ?? 0) > 0;
        push(mk(armor ? 'armor' : 'hit', e, 0, { side: c?.side }), `${e.sid}:hit:${c?.side ?? 0}`);
        break;
      }
      case 'flash': {
        const t0 = c?.ox !== undefined ? 0.34 : 0;
        if (t0 > 0) { raw.push(mk('flashRoll', e, 0.28)); raw.push(mk('flashRoll', e, 0.31)); }
        raw.push(mk('flashBang', e, t0));
        break;
      }
      case 'boom': raw.push(mk('boom', e, 0, { r: c?.r ?? 3 })); break;
      case 'breach': raw.push(mk('breach', e, 0, { how: c?.how ?? 'open', sync: !!c?.sync })); break;
      case 'melee': push(mk('melee', e, 0), `${e.sid}:melee`); break;
      case 'taser': push(mk('taser', e, 0, { res: c?.res }), `${e.sid}:taser`); break;
      case 'cuff': if (!fast) raw.push(mk('cuff', e, 0)); break;
      case 'glass': push(mk('glass', e, 0), `${e.sid}:glass`); break;
      case 'debris': push(mk('debris', e, 0), `${e.sid}:debris`); break;
      case 'tick': raw.push(mk('tick', e, 0)); break;
      case 'strike': raw.push(mk('strike', e, 0)); break;
      case 'hail': if (speed <= 3) raw.push(mk('hail', e, 0)); break;
      case 'reply': if (speed <= 3) raw.push(mk('reply', e, 0)); break;
      default: break;
    }
  }
  for (const [key, g] of groups) {
    const kind = key.split(':')[1];
    if (kind === 'gun') {
      g.sort((p, q) => p.when - q.when);
      if (fast) {
        // 연사 하나: min(n,3) 번을 55ms 간격, 세기 ×0.8
        const n = Math.min(g.length, 3), t0 = g[0].when;
        for (let i = 0; i < n; i++) raw.push({ ...g[i], when: t0 + i * 0.055, gain: g[i].gain * 0.8 });
      } else if (mid) {
        if (g.length <= 2) raw.push(...g);
        else { raw.push(g[0]); raw.push({ ...g[g.length - 1], when: Math.max(g[g.length - 1].when, g[0].when + 0.07) }); }
      } else raw.push(...g);
    } else if (kind === 'impact' || kind === 'hit') {
      if (!fast) raw.push(g[0]);
    } else if (kind === 'glass' || kind === 'debris') {
      if (fast) { if (now - (st.lastAt[kind] ?? -99) >= 0.3) { st.lastAt[kind] = now; raw.push(g[0]); } }
      else if (now - (st.lastAt[kind] ?? -99) >= (kind === 'glass' ? 0.12 : 0.25)) { st.lastAt[kind] = now; raw.push(g[0]); }
    } else raw.push(g[0]);
  }
  raw.sort((p, q) => p.when - q.when);
  // 종류별 최소 간격 (섬광 0.3, 폭발 0.25, 진입 0.2) — 실제 시간, 예약 시각 기준
  const gap: Partial<Record<CueKind, number>> = { flashBang: 0.3, boom: 0.25, breach: 0.2 };
  const out: Cue[] = [];
  // 지금 울리는 소리 (시작했고 끝나지 않은 것 + 앞으로 시작할 것)
  st.sounding = st.sounding.filter((v) => v.end > now);
  for (const c of raw) {
    const g = gap[c.kind];
    const at = now + c.when;
    if (g !== undefined) { if (at - (st.lastAt[c.kind] ?? -99) < g) continue; st.lastAt[c.kind] = at; }
    if (isGunClass(c.kind)) { if (st.tokens < 1) { st.dropped++; continue; } st.tokens -= 1; }
    // 동시 발음 상한: 그 시각에 울리는 소리가 18개 이상이면 우선순위 낮은 것을 버린다
    let busy = 0, lowest = -1, lowPri = Infinity;
    for (let i = 0; i < st.sounding.length; i++) { const v = st.sounding[i]; if (v.start <= at && v.end > at) { busy++; if (v.pri < lowPri) { lowPri = v.pri; lowest = i; } } }
    if (busy >= VOICE_CAP) {
      if (lowPri >= c.pri) { st.dropped++; if (isGunClass(c.kind)) st.tokens += 1; continue; }
      st.sounding.splice(lowest, 1);      // 이미 예약한 낮은 소리는 끝까지 울리지만 셈에서 뺀다
    }
    st.sounding.push({ start: at, end: at + c.dur, pri: c.pri });
    out.push(c);
  }
  return out;
}

// ───────────────────────── 합성 ─────────────────────────
export interface Place { gain: number; pan: number; far: number }

/** 교전 소리 마디: voice(GainNode) → [StereoPanner] → [lowpass: 먼 소리] → combatBus, (실내면) → roomSend */
export class CombatVoice {
  constructor(private ctx: AudioContext, private noise: AudioBuffer, private bus: AudioNode, private room: AudioNode | null) {}

  private route(pl: Place, indoor: boolean, t: number, dur: number): GainNode {
    const c = this.ctx, v = c.createGain();
    v.gain.value = pl.gain;
    let node: AudioNode = v;
    if (typeof c.createStereoPanner === 'function') { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pl.pan)); node.connect(p); node = p; }
    if (pl.far > 0) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = pl.far; node.connect(lp); node = lp; }
    node.connect(this.bus);
    if (indoor && this.room) { const s = c.createGain(); s.gain.value = 0.25; node.connect(s); s.connect(this.room); }
    void t; void dur;
    return v;
  }
  private tone(out: AudioNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo = 0): void {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.03);
  }
  private burst(out: AudioNode, t: number, dur: number, gain: number, freq: number, q = 1, kind: BiquadFilterType = 'bandpass', freqTo = 0): void {
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = kind; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, gain), t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out); src.start(t, (t * 0.37) % 0.8); src.stop(t + dur + 0.03);
  }

  /** cue 하나를 낸다 (t = ctx 시각) */
  play(cu: Cue, pl: Place, indoor: boolean): void {
    const c = this.ctx, t = c.currentTime + cu.when, out = this.route(pl, indoor, t, cu.dur + 0.6), k = cu.gain;
    const pitch = 0.94 + 0.12 * (cu.seed % 1);
    const tailK = cu.first ? 1.5 : 1;
    switch (cu.kind) {
      case 'gun': {
        const w = cu.wpn;
        if (w === 'rifle' || w === 'sniper') {
          const s = w === 'sniper' ? 1.26 : 1;
          this.burst(out, t, 0.035, 0.22 * k * s, 3200, 0.7, 'highpass');
          this.burst(out, t, 0.12, 0.26 * k * s, 1300, 0.7, 'lowpass');
          this.tone(out, t, 95, 0.12, 0.16 * k * s, 'sine', 42);
          this.burst(out, t + 0.03, (w === 'sniper' ? 0.6 : 0.32) * tailK, 0.06 * k * s, w === 'sniper' ? 500 : 650, 0.7, 'lowpass');
        } else if (w === 'pistol') {
          this.burst(out, t, 0.05, 0.2 * k, 2400, 0.9, 'bandpass');
          this.tone(out, t, 210, 0.06, 0.1 * k, 'triangle', 80);
          this.burst(out, t + 0.02, 0.16 * tailK, 0.05 * k, 900, 0.7, 'lowpass');
        } else if (w === 'beanbag') {
          this.burst(out, t, 0.08, 0.16 * k, 600, 0.7, 'lowpass');
          this.tone(out, t, 140, 0.08, 0.1 * k, 'sine', 70);
        } else {
          // 용의자의 총: 먹먹하고 낮다
          this.burst(out, t, 0.1, 0.24 * k, 1100 * pitch, 0.7, 'lowpass');
          this.tone(out, t, 140 * pitch, 0.08, 0.11 * k, 'square', 55 * pitch);
          this.burst(out, t + 0.02, 0.2 * tailK, 0.05 * k, 600 * pitch, 1.5, 'bandpass');
        }
        break;
      }
      case 'impactWall':
        this.burst(out, t, 0.03, 0.05 * k, 4200, 2, 'bandpass');
        if (Math.floor(cu.seed * 3) === 0) this.tone(out, t + 0.005, 2600, 0.09, 0.025 * k, 'sine', 1900);      // 세 발에 한 번 도탄음
        break;
      case 'impactFurn': case 'impactDoor':
        this.tone(out, t, 260, 0.05, 0.08 * k, 'triangle', 130);
        this.burst(out, t, 0.05, 0.06 * k, 900, 1, 'bandpass');
        break;
      case 'hit':
        this.tone(out, t, 110, 0.1, 0.1 * k, 'triangle', 70);
        this.burst(out, t, 0.05, 0.06 * k, 280, 0.7, 'lowpass');
        break;
      case 'armor':
        this.tone(out, t, 1700, 0.05, 0.04 * k, 'sine'); this.tone(out, t, 2550, 0.04, 0.04 * k, 'sine');
        this.tone(out, t, 110, 0.08, 0.06 * k, 'triangle', 70);
        break;
      case 'melee':
        this.burst(out, t, 0.12, 0.06 * k, 1800, 1.2, 'bandpass', 600);
        break;
      case 'taser': {
        this.burst(out, t, 0.03, 0.08 * k, 3000, 1.5, 'bandpass');
        if (cu.res === 'hit') {
          for (let i = 0; i < 12; i++) this.burst(out, t + 0.06 + i * 0.08, 0.04, 0.07 * k, 4500, 0.7, 'highpass');
          // square 52Hz 를 잡음으로 진폭 변조
          const o = c.createOscillator(), g = c.createGain(), src = c.createBufferSource(), ng = c.createGain();
          o.type = 'square'; o.frequency.value = 52; src.buffer = this.noise; src.loop = true;
          g.gain.value = 0; ng.gain.value = 0.035 * k; src.connect(ng); ng.connect(g.gain);
          o.connect(g); g.connect(out); o.start(t + 0.06); src.start(t + 0.06); o.stop(t + 1.06); src.stop(t + 1.06);
        }
        break;
      }
      case 'flashRoll': this.tone(out, t, 1800, 0.02, 0.04 * k, 'triangle'); break;
      case 'flashBang':
        this.burst(out, t, 0.22, 0.42 * k, 7000, 0.7, 'lowpass');
        this.tone(out, t, 130, 0.32, 0.3 * k, 'sine', 38);
        this.burst(out, t, 0.5, 0.12 * k, 2500, 0.7, 'highpass');
        break;
      case 'boom': {
        const s = 0.6 + 0.4 * Math.min(1, (cu.r ?? 3) / 3.8);
        this.tone(out, t, 55, 0.9, 0.45 * s * k, 'sine', 26);
        this.burst(out, t, 1.3, 0.36 * s * k, 420, 0.7, 'lowpass');
        for (let i = 0; i < 4; i++) this.burst(out, t + (0.5 * (i + (cu.seed * 7) % 1)) / 4, 0.04, 0.07 * k, 3000, 0.7, 'highpass');
        this.burst(out, t + 0.1, 2.0, 0.08 * k, 160, 0.7, 'lowpass');
        this.tone(out, t, 120, 0.4, 0.12 * s * k, 'sine', 60);      // 작은 스피커용 배음
        break;
      }
      case 'breach': {
        const how = cu.how ?? 'open';
        if (cu.sync) this.tone(out, t, 1320, 0.12, 0.06 * k, 'sine');
        if (how === 'kick' || how === 'push') {
          if (how === 'kick') { this.tone(out, t, 95, 0.11, 0.26 * k, 'triangle', 48); this.burst(out, t, 0.07, 0.15 * k, 1300, 3, 'bandpass'); this.burst(out, t + 0.12, 0.16, 0.12 * k, 220, 0.7, 'lowpass'); }
          else this.burst(out, t + 0.05, 0.12, 0.06 * k, 300, 0.7, 'lowpass');
        } else if (how === 'ram' || how === 'irons') {
          this.tone(out, t, 72, 0.16, 0.32 * k, 'sine', 38);
          if (how === 'ram') { this.tone(out, t, 420, 0.12, 0.04 * k, 'square'); this.tone(out, t, 660, 0.12, 0.04 * k, 'square'); }
          else this.tone(out, t, 900, 0.05, 0.05 * k, 'triangle', 620);
          this.burst(out, t, 0.07, 0.15 * k, 1300, 3, 'bandpass'); this.burst(out, t + 0.12, 0.16, 0.12 * k, 220, 0.7, 'lowpass');
        } else if (how === 'hydraulic') {
          const o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
          o.type = 'sawtooth'; o.frequency.value = 90; lp.type = 'lowpass'; lp.frequency.value = 400;
          g.gain.setValueAtTime(0.05 * k, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
          o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.38);
          this.tone(out, t + 0.33, 700, 0.12, 0.05 * k, 'triangle', 500);
        }
        break;
      }
      case 'strike':
        this.tone(out, t, 900, 0.05, 0.06 * k, 'triangle', 620); this.burst(out, t, 0.04, 0.05 * k, 2200, 1, 'bandpass'); this.tone(out, t, 120, 0.06, 0.08 * k, 'triangle', 70);
        break;
      case 'tick': this.tone(out, t, 880, 0.07, 0.05 * k, 'sine'); break;
      case 'cuff': this.tone(out, t, 2600, 0.025, 0.05 * k, 'sine'); this.tone(out, t + 0.09, 3200, 0.025, 0.05 * k, 'sine'); break;
      case 'glass': this.burst(out, t, 0.13, 0.17 * k, 5600, 0.7, 'highpass'); this.tone(out, t + 0.015, 3300, 0.1, 0.045 * k, 'sine'); this.tone(out, t + 0.06, 4700, 0.14, 0.035 * k, 'sine'); break;
      case 'debris': this.burst(out, t, 0.24, 0.22 * k, 300, 0.6, 'lowpass'); this.tone(out, t, 95, 0.13, 0.1 * k, 'triangle', 55); break;
      case 'hail': case 'reply': {
        // 확성기: sawtooth → bandpass, 7Hz 진폭 변조
        const o = c.createOscillator(), bp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
        const hail = cu.kind === 'hail', d = hail ? 0.5 : 0.4;
        o.type = 'sawtooth'; o.frequency.value = hail ? 160 : 120; bp.type = 'bandpass'; bp.frequency.value = hail ? 1100 : 900; bp.Q.value = 4;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime((hail ? 0.03 : 0.025) * k, t + 0.04); g.gain.linearRampToValueAtTime(0.0001, t + d);
        lfo.frequency.value = 7; lg.gain.value = (hail ? 0.012 : 0.01) * k; lfo.connect(lg); lg.connect(g.gain);
        o.connect(bp); bp.connect(g); g.connect(out); o.start(t); lfo.start(t); o.stop(t + d + 0.02); lfo.stop(t + d + 0.02);
        break;
      }
      default: break;
    }
  }
}
