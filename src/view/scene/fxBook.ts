// 교전 연출 기억 (표현 계층, docs/specs/G5-combat-fx.md 3.1절).
// 그림의 시간을 시뮬레이션 틱에서 떼어 낸다: 연출 시계는 실제 시간으로 흐르고, 일시정지하면 멈추고, 배속이 높아도 FX_RATE_MAX 배까지만 빨라진다.
// 시뮬레이션의 효과 기록(s.fx)을 처음 본 프레임에 객체 참조로 받아 두고 자기 시계로 그린다. 시뮬레이션 상태는 읽기만 한다.
// 이 파일은 DOM 을 건드리지 않는다(시험에서 가짜 Sim·Scene 으로 부른다).

import type { Sim } from '../../sim/engine';
import type { BreachHow, Fx, Scene } from '../../sim/types';

export const FX_RATE_MAX = 2;
/** G5 가 그리는 종류. 이 밖의 종류도 fresh 에는 들어간다(소리·카메라·감속·지도 핀) */
export const FX_DRAWN = new Set<string>(['shot', 'hit', 'flash', 'boom', 'glass', 'debris', 'breach', 'melee', 'cuff', 'taser']);
/** 결정적 순간(자동 감속·카메라 바로 다시 잡기). G4 는 'collapse', X6 는 'horn' 을 한 단어씩 더한다 */
export const DECISIVE = new Set<string>(['shot', 'flash', 'boom', 'breach', 'collapse']);
/** 상태에서 만든 합성 항목(s.fx 에는 넣지 않는다) */
export type SynKind = 'tick' | 'strike' | 'hail' | 'reply';
export interface FxEntry {
  kind: Fx['kind'] | SynKind;
  f: Fx | null;                                      // 합성 항목이면 null
  sid: number; x: number; y: number;                 // 합성 항목의 자리(기록이면 f.x, f.y)
  born: number; delay: number; dur: number; seed: number;
  n?: number;                                        // 'tick' 의 숫자(3·2·1), 'strike'·'hail'·'reply' 의 대원 rid
  fly?: number;                                      // 사격: 예광선 머리가 탄착점에 닿는 데 걸리는 연출 시간
  veil?: boolean;                                    // 섬광탄·폭발: 화면 막을 허락받았다(실제 시간 상한)
}
export interface Decal { kind: 'hole' | 'scorch' | 'can'; x: number; y: number; r: number; born: number }
/** 화면 위치 판단에 쓰는 보이는 범위(칸 좌표): 가운데와 반폭·반높이 */
export interface FxView { cx: number; cy: number; hw: number; hh: number }

/** 연출 길이(연출 시계 초) — 2.5절 */
export function fxDur(f: Fx): number {
  switch (f.kind) {
    case 'shot': return 1.0;
    case 'hit': return 0.35;
    case 'flash': return 2.3;
    case 'boom': return Math.max(2.8, 1.6 + 0.25 * (f.c?.r ?? 3));
    case 'breach': return 1.4;
    case 'melee': return 0.4;
    case 'cuff': return 1.85;
    case 'taser': return 1.5;
    case 'glass': return 0.5;
    case 'debris': return 0.6;
    default: return 0;
  }
}
/** 총구 길이(칸): 쏜 사람 가운데에서 총구까지 */
export function muzzleLen(f: Fx): number { const w = f.c?.wpn; return w === 'rifle' || w === 'sniper' ? 0.8 : 0.58; }
/** 예광선 머리의 속도(칸/연출 초) */
export function tracerSpeed(f: Fx): number { return f.c?.wpn === 'beanbag' ? 25 : 70; }
/** 사격 기록의 탄착점(꼬리표가 없으면 그려지는 끝점) */
export function impactOf(f: Fx): { x: number; y: number } {
  const c = f.c;
  if (c && c.ix !== undefined && c.iy !== undefined) return { x: c.ix, y: c.iy };
  return { x: f.x2 ?? f.x, y: f.y2 ?? f.y };
}
/** 예광선 머리가 탄착점에 닿는 데 걸리는 연출 시간 */
export function flightOf(f: Fx): number {
  const p = impactOf(f);
  const d = Math.max(0, Math.hypot(p.x - f.x, p.y - f.y) - muzzleLen(f));
  return Math.max(0.05, d / tracerSpeed(f));
}
function hashFx(f: Fx): number {
  let h = 2166136261;
  const mix = (v: number): void => { h ^= v | 0; h = Math.imul(h, 16777619) >>> 0; };
  mix(Math.round(f.t * 10)); mix(Math.round(f.x * 97)); mix(Math.round(f.y * 89)); mix(f.kind.length * 31 + f.kind.charCodeAt(0));
  if (f.x2 !== undefined) mix(Math.round(f.x2 * 53));
  return (h % 100000) / 100000;
}

/** 현장마다 동시에 살아 있는 연출의 상한 (3.11절. 넘으면 오래된 것부터 버린다) */
const CAP: Record<string, number> = { shot: 40, hit: 16, flash: 3, boom: 3, breach: 6, melee: 8, cuff: 6, taser: 6, glass: 24, debris: 24, tick: 4, strike: 6, hail: 6, reply: 6 };
const DECAL_CAP: Record<Decal['kind'], number> = { hole: 80, scorch: 6, can: 6 };
const DECAL_LIFE: Record<Decal['kind'], number> = { hole: 60, scorch: 120, can: 90 };
/** 화면 막(섬광탄 흰 막·폭발 주황 막)의 실제 시간 상한(초) */
export const VEIL_GAP = 2.5;
/** 강제 개방 타격의 박자(연출 초) */
const STRIKE_GAP = 0.6;
/** 협상: 말함 2.2초 · 쉼 1.3초, 확성기 파동 1.1초 */
export const TALK = 2.2, REST = 1.3, HAIL = 1.1;
export const talkPhase = (clock: number, rid: number): number => { const p = (clock + rid * 0.37) % (TALK + REST); return p < 0 ? p + TALK + REST : p; };

export class FxBook {
  clock = 0;
  rate = 0;                                          // 이번 프레임의 연출 시계 속도(소리 예약이 쓴다)
  real = 0;                                          // 실제 시간 누적(화면 막 상한)
  fresh: FxEntry[] = [];
  drawMs = 0;                                        // 마지막 프레임의 교전 그림 시간(확인용)
  lastDt = 1 / 60;                                   // 마지막 프레임의 실제 시간 간격(총구 섬광을 두 프레임 이상 보이게)
  private seen = new WeakSet<Fx>();
  private lives = new Map<number, FxEntry[]>();
  private decs = new Map<number, Decal[]>();
  private kicks = new Map<string, { at: number; how: BreachHow }>();
  private simRef: Sim | null = null;
  private seeks = -1;
  private skip = true;                                // 비운 직후 첫 받아들이기는 fresh 에 넣지 않는다
  private tickN = new Map<number, number>();          // 현장 → 마지막으로 본 3-2-1 숫자
  private strikeAt = new Map<number, number>();       // 대원 rid → 다음 타격 시각(연출 시계)
  private talkAt = new Map<number, number>();         // 대원 rid → 지난 프레임의 협상 주기 위치
  private veilReal = -99;                             // 마지막 화면 막의 실제 시각
  private shotAt = new Map<number, { at: number; t: number }>();      // 현장 → 마지막 사격(연출 시계·시뮬레이션 시각): 지도의 '교전 중' 테

  /** 모두 비운다(새 교대·되감기). 다음 받아들이기는 fresh 에 넣지 않는다 */
  reset(): void {
    this.seen = new WeakSet(); this.lives.clear(); this.decs.clear(); this.kicks.clear();
    this.tickN.clear(); this.strikeAt.clear(); this.talkAt.clear(); this.shotAt.clear(); this.fresh = []; this.skip = true;
  }

  frame(sim: Sim, dtReal: number, o: { paused: boolean; speed: number; seeks: number }): void {
    if (sim !== this.simRef || o.seeks !== this.seeks) { this.simRef = sim; this.seeks = o.seeks; this.reset(); }
    const eff = o.paused ? 0 : Math.max(0, o.speed);
    this.rate = Math.min(eff, FX_RATE_MAX);
    this.clock += dtReal * this.rate;
    this.real += dtReal;
    if (dtReal > 0) this.lastDt = dtReal;
    const fresh: FxEntry[] = [];
    // 시뮬레이션 시간 → 연출 시계: 한 프레임에 여러 틱이 돌았으면 틱 사이의 간격을 옮겨 순서를 지킨다. 멈춘 상태(되감기 직후)면 1배속으로 본다
    const k = this.rate > 0 ? this.rate / Math.max(1, eff) : 1;
    const bornAt = (t: number): number => this.clock - Math.max(0, sim.t - t) * k;
    for (const s of sim.scenes) {
      if (!s || s.archived) continue;
      // 새 기록은 언제나 끝에 붙는다: 뒤에서부터 처음 보는 것만
      let i = s.fx.length - 1;
      while (i >= 0 && !this.seen.has(s.fx[i])) i--;
      const news: Fx[] = [];
      for (let j = i + 1; j < s.fx.length; j++) { const f = s.fx[j]; this.seen.add(f); news.push(f); }
      if (news.length) this.absorb(s, news, bornAt, fresh);
      this.synth(sim, s, bornAt, fresh);
      this.prune(s.id);
    }
    // 끝난 현장의 기억은 버린다
    if (this.lives.size > 0) for (const sid of [...this.lives.keys()]) { const s = sim.scenes[sid]; if (!s || s.archived) { this.lives.delete(sid); this.decs.delete(sid); } }
    this.fresh = this.skip ? [] : fresh;
    this.skip = false;
  }

  private absorb(s: Scene, news: Fx[], bornAt: (t: number) => number, fresh: FxEntry[]): void {
    const list = this.listOf(s.id);
    // 같은 틱의 순서: 진입 → (0.12) 섬광탄 → (0.2) 사격, 사격에 딸린 피격은 예광선 머리가 닿는 시각에
    const breachT = new Set<number>();
    for (const f of news) if (f.kind === 'breach') breachT.add(f.t);
    const shots: FxEntry[] = [];
    for (const f of news) {
      const e: FxEntry = { kind: f.kind, f, sid: s.id, x: f.x, y: f.y, born: bornAt(f.t), delay: 0, dur: fxDur(f), seed: hashFx(f) };
      if (breachT.has(f.t)) { if (f.kind === 'flash') e.delay = 0.12; else if (f.kind === 'shot') e.delay = 0.2; }
      if (f.kind === 'shot') { e.fly = flightOf(f); shots.push(e); this.shotAt.set(s.id, { at: e.born + e.delay, t: f.t }); }
      else if (f.kind === 'hit' && f.c && f.c.target !== undefined) {
        const sh = shots.find((q) => q.f!.t === f.t && q.f!.c && q.f!.c.target === f.c!.target && q.f!.c.tk === f.c!.tk);
        if (sh) e.delay = sh.delay + (sh.fly ?? 0);
      }
      fresh.push(e);
      if (!FX_DRAWN.has(f.kind)) continue;
      list.push(e);
      // 남는 그림과 문짝 연출
      const c = f.c;
      if (f.kind === 'shot' && c && (c.stop === 'wall' || c.stop === 'door') && c.ix !== undefined && c.iy !== undefined) this.decal(s.id, { kind: 'hole', x: c.ix, y: c.iy, r: 0.05, born: e.born + e.delay + (e.fly ?? 0) });
      else if (f.kind === 'boom' && c?.src !== 'bomb') this.decal(s.id, { kind: 'scorch', x: f.x, y: f.y, r: 0.7 * (c?.r ?? 3), born: e.born });      // 터진 폭발물 자리는 G4 의 바닥 자국(hazardFx.drawBlastScars)이 맡는다
      else if (f.kind === 'flash' && c && c.ox !== undefined) this.decal(s.id, { kind: 'can', x: f.x, y: f.y, r: 0.09, born: e.born + e.delay + 0.34 });
      else if (f.kind === 'breach' && c && c.door !== undefined && c.door >= 0 && c.how) this.kicks.set(s.id + ':' + c.door, { at: e.born + e.delay, how: c.how });
    }
  }

  /** 상태에서 나오는 순간: 3-2-1, 강제 개방 타격, 협상의 확성기와 대답 */
  private synth(sim: Sim, s: Scene, bornAt: (t: number) => number, fresh: FxEntry[]): void {
    // 3-2-1
    if (s.entryOrdered && !s.breachDone && s.breachAt >= 0) {
      const n = Math.ceil(s.breachAt - sim.t - 1e-9);
      const was = this.tickN.get(s.id);
      if (n >= 1 && n <= 3 && was !== n) {
        const ex = s.exits[s.entryExit] ?? s.exits[0] ?? s.staging;
        this.add(s.id, { kind: 'tick', f: null, sid: s.id, x: ex.x, y: ex.y, born: bornAt(Math.min(sim.t, s.breachAt - n)), delay: 0, dur: 1, seed: n / 7, n }, fresh);
      }
      this.tickN.set(s.id, n);
    } else this.tickN.delete(s.id);
    for (const a of s.agents) {
      if (a.status !== 'active' || !a.task) { this.strikeAt.delete(a.rid); this.talkAt.delete(a.rid); continue; }
      // 강제 개방: 하위 작업 'force' 이거나 임무 'force' 이고 일하는 중
      const t = a.task, sub = t.sub && t.sub.kind === 'force' ? t.sub : null;
      const forcing = sub || (t.kind === 'force' && a.ring > 0.01);
      const moving = Math.abs(a.x - a.px) + Math.abs(a.y - a.py) > 0.01;
      if (forcing && !moving) {
        const tile = sub ? sub.tile : t.tile;
        const tx = tile >= 0 ? tile % s.w : a.x + a.fx, ty = tile >= 0 ? (tile / s.w) | 0 : a.y + a.fy;
        let at = this.strikeAt.get(a.rid);
        if (at === undefined) at = this.clock;
        while (at <= this.clock) {
          this.add(s.id, { kind: 'strike', f: null, sid: s.id, x: tx, y: ty, born: at, delay: 0, dur: 0.5, seed: (at * 13.7) % 1, n: a.rid }, fresh);
          at += STRIKE_GAP;
        }
        this.strikeAt.set(a.rid, at);
      } else this.strikeAt.delete(a.rid);
      // 협상: 임무 negotiate · phase ≥ 1 · 상대가 교전 중이 아님
      const h = t.kind === 'negotiate' ? s.hostiles[t.hostile] : undefined;
      if (h && t.phase >= 1 && h.state !== 'fight' && (h.state === 'hold' || h.state === 'flee')) {
        const ph = talkPhase(this.clock, a.rid), was = this.talkAt.get(a.rid);
        if (was !== undefined && this.rate > 0) {
          const crossed = (edge: number): boolean => (was < edge && ph >= edge) || (ph < was && (was < edge || ph >= edge));
          if (crossed(0.0001) || crossed(HAIL)) this.add(s.id, { kind: 'hail', f: null, sid: s.id, x: a.x, y: a.y, born: this.clock, delay: 0, dur: 1.1, seed: ph, n: a.rid }, fresh);
          if (crossed(TALK)) this.add(s.id, { kind: 'reply', f: null, sid: s.id, x: h.x, y: h.y, born: this.clock, delay: 0, dur: REST, seed: ph, n: a.rid }, fresh);
        }
        this.talkAt.set(a.rid, ph);
      } else this.talkAt.delete(a.rid);
    }
  }

  private add(sid: number, e: FxEntry, fresh: FxEntry[]): void { this.listOf(sid).push(e); fresh.push(e); }
  private listOf(sid: number): FxEntry[] { let l = this.lives.get(sid); if (!l) { l = []; this.lives.set(sid, l); } return l; }
  private decal(sid: number, d: Decal): void {
    let l = this.decs.get(sid); if (!l) { l = []; this.decs.set(sid, l); }
    l.push(d);
    let n = 0; for (const q of l) if (q.kind === d.kind) n++;
    if (n > DECAL_CAP[d.kind]) { const i = l.findIndex((q) => q.kind === d.kind); if (i >= 0) l.splice(i, 1); }
  }
  private prune(sid: number): void {
    const l = this.lives.get(sid);
    if (l && l.length) {
      let w = 0;
      for (let i = 0; i < l.length; i++) { const e = l[i]; if (this.clock - e.born - e.delay <= e.dur + 0.05) l[w++] = e; }
      l.length = w;
      // 종류별 상한: 오래된 것부터 버린다
      const cnt: Record<string, number> = {};
      for (let i = l.length - 1; i >= 0; i--) { const k = l[i].kind; cnt[k] = (cnt[k] ?? 0) + 1; if (cnt[k] > (CAP[k] ?? 24)) l.splice(i, 1); }
    }
    const d = this.decs.get(sid);
    if (d && d.length) { let w = 0; for (let i = 0; i < d.length; i++) if (this.clock - d[i].born < DECAL_LIFE[d[i].kind]) d[w++] = d[i]; d.length = w; }
  }

  /** (개발용) 연출 시계만 dt 초 넘긴다. 시뮬레이션은 그대로 */
  debugStep(dt: number): void { this.clock += Math.max(0, dt); }
  live(sid: number): readonly FxEntry[] { return this.lives.get(sid) ?? []; }
  age(e: FxEntry): number { return this.clock - e.born - e.delay; }
  decals(sid: number): readonly Decal[] { return this.decs.get(sid) ?? []; }
  /** 반동·던지기 자세: 그 사람이 within 초 안에 낸 가장 최근 사격·섬광탄 */
  recentBy(sid: number, side: 0 | 1, by: number, within: number): FxEntry | null {
    const l = this.lives.get(sid); if (!l) return null;
    for (let i = l.length - 1; i >= 0; i--) {
      const e = l[i], c = e.f?.c;
      if (!c || c.side !== side || c.by !== by || (e.kind !== 'shot' && e.kind !== 'flash' && e.kind !== 'taser')) continue;
      const a = this.age(e); if (a >= 0 && a < within) return e;
    }
    return null;
  }
  /** 움찔: 그 사람이 within 초 안에 맞은 가장 최근 피격 */
  recentOn(sid: number, tk: 0 | 1 | 2, target: number, within: number): FxEntry | null {
    const l = this.lives.get(sid); if (!l) return null;
    for (let i = l.length - 1; i >= 0; i--) {
      const e = l[i], c = e.f?.c;
      if (e.kind !== 'hit' || !c || c.tk !== tk || c.target !== target) continue;
      const a = this.age(e); if (a >= 0 && a < within) return e;
    }
    return null;
  }
  /** 문짝 연출: 그 문이 진입·강제 개방으로 열린 지 얼마나 됐나(2초 안) */
  doorKick(sid: number, propId: number): { age: number; how: BreachHow } | null {
    const k = this.kicks.get(sid + ':' + propId); if (!k) return null;
    const age = this.clock - k.at;
    if (age > 2) { if (age > 10) this.kicks.delete(sid + ':' + propId); return null; }
    return { age, how: k.how };
  }
  /** 그 현장의 마지막 사격 (연출 시계 at, 시뮬레이션 시각 t) */
  lastShot(sid: number): { at: number; t: number } | null { return this.shotAt.get(sid) ?? null; }
  /** 가장 최근 3-2-1 합성 항목 (숫자 튕김) */
  lastTick(sid: number): FxEntry | null { const l = this.lives.get(sid); if (!l) return null; for (let i = l.length - 1; i >= 0; i--) if (l[i].kind === 'tick') return l[i]; return null; }

  /** 화면 막의 상한: 아직 정하지 않은 막이면 지금 정한다(실제 시간 VEIL_GAP 에 하나) */
  private allowVeil(e: FxEntry): boolean {
    if (e.veil !== undefined) return e.veil;
    e.veil = this.real - this.veilReal >= VEIL_GAP;
    if (e.veil) this.veilReal = this.real;
    return e.veil;
  }
  /** 화면 안이면 가운데와의 거리 비(0..1), 밖이면 -1 */
  private nearness(x: number, y: number, v?: FxView): number {
    if (!v) return 0;
    const dx = Math.abs(x - v.cx), dy = Math.abs(y - v.cy);
    if (dx > v.hw || dy > v.hh) return -1;
    return Math.min(1, Math.hypot(dx, dy) / Math.max(1, v.hw));
  }
  /** 관찰자 흰 막(0..1, 실제 시간 상한 적용 뒤). 섬광탄이 화면 안에서 터졌을 때만 */
  whiteout(sid: number, v?: FxView): number {
    const l = this.lives.get(sid); if (!l) return 0;
    let best = 0;
    for (const e of l) {
      if (e.kind !== 'flash' || !e.f) continue;
      const t = this.age(e) - (e.f.c?.ox !== undefined ? 0.34 : 0);
      if (t < 0 || t > 0.66) continue;
      const d = this.nearness(e.x, e.y, v); if (d < 0) continue;
      if (!this.allowVeil(e)) continue;
      const peak = 0.5 * (1 - 0.5 * d);
      const a = t < 0.06 ? peak : peak * Math.max(0, 1 - (t - 0.06) / 0.6);
      best = Math.max(best, a);
    }
    return best;
  }
  /** 폭발 주황 막(0..0.12, 같은 상한) */
  orange(sid: number, v?: FxView): number {
    const l = this.lives.get(sid); if (!l) return 0;
    let best = 0;
    for (const e of l) {
      if (e.kind !== 'boom') continue;
      const t = this.age(e);
      if (t < 0 || t > 0.1) continue;
      if (this.nearness(e.x, e.y, v) < 0) continue;
      if (!this.allowVeil(e)) continue;
      best = Math.max(best, 0.12 * (1 - t / 0.1));
    }
    return best;
  }
  /** 흔들림, 칸 단위(화소 진폭을 ts 로 나눈다). 겹친 폭발은 더하되 G5 몫의 합을 6px 로 자른다 */
  shake(sid: number, ts: number, v?: FxView): { x: number; y: number } {
    const l = this.lives.get(sid); if (!l || ts <= 0) return { x: 0, y: 0 };
    let x = 0, y = 0;
    for (const e of l) {
      if (e.kind !== 'boom') continue;
      const t = this.age(e);
      if (t < 0 || t > 0.6) continue;
      const r = e.f?.c?.r ?? 3;
      const near = v ? Math.max(0, 1 - Math.hypot(e.x - v.cx, e.y - v.cy) / (2 * Math.max(1, v.hw))) : 1;
      const A = Math.min(6, 2 + r) * near * Math.exp(-t / 0.18);
      const ph = t * 28 * 6.2832 + e.seed * 6.2832;
      x += A * Math.sin(ph); y += A * Math.cos(ph * 1.31 + 1.7);
    }
    const m = Math.hypot(x, y);
    if (m > 6) { x *= 6 / m; y *= 6 / m; }
    return { x: x / ts, y: y / ts };
  }
}
