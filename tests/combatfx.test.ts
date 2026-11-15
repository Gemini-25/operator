// G5 교전 연출 (docs/specs/G5-combat-fx.md): 기록 고리(fxlog)가 결과를 바꾸지 않는다, 꼬리표가 빠짐없이 붙는다, 그림·소리의 받아들이기와 묶음 규칙
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NORMAL, parseDifficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { rayEnd } from '../src/sim/field/damage';
import { FXLOG } from '../src/sim/field/fxlog';
import { addProp, baseScene, set } from '../src/sim/field/kit';
import { detonate } from '../src/sim/field/rules/crime';
import { createIncident } from '../src/sim/incidents';
import { T } from '../src/sim/types';
import type { Fx, Incident, Scene } from '../src/sim/types';
import { TOKEN_CAP, isGunClass, newPlanState, planCues } from '../src/view/audioCombat';
import { drawCombatPin } from '../src/view/city/combatPin';
import * as combat from '../src/view/scene/combat';
import { DECISIVE, FX_DRAWN, FxBook } from '../src/view/scene/fxBook';
import type { FxEntry } from '../src/view/scene/fxBook';
import { fakeCanvas, fakeCtx } from './fakeCanvas';

const HOT = parseDifficulty('3,3,5,4,3,3')!;

// ───────────────────────── 도우미 ─────────────────────────
function fnv(h: number, v: number): number { h ^= v & 0xffffffff; return Math.imul(h, 16777619) >>> 0; }
function fnvStr(h: number, s: string): number { for (let i = 0; i < s.length; i++) h = fnv(h, s.charCodeAt(i)); return h; }
function num(h: number, x: number): number { return fnvStr(h, (Math.round(x * 100) / 100).toFixed(2)); }
/** 상태 요약(효과 기록을 뺀 끝 상태의 지문) — 설계서 2.6절 */
function digest(sim: Sim): string {
  let h = 2166136261;
  for (const I of sim.incidents) { h = fnvStr(h, JSON.stringify(I.result ?? '-')); h = fnvStr(h, I.closeReason ?? ''); h = fnvStr(h, I.phase); }
  for (const s of sim.scenes) {
    if (!s) { h = fnv(h, 7); continue; }
    let ts = 0, gs = 0, ds = 0;
    for (let i = 0; i < s.tiles.length; i++) { ts += s.tiles[i]; h = fnv(h, s.tiles[i]); }
    for (let i = 0; i < s.glass.length; i++) { gs += s.glass[i]; if (s.glass[i]) h = fnv(h, i); }
    for (let i = 0; i < s.decorHp.length; i++) { ds += s.decorHp[i]; if (s.decorHp[i]) h = fnv(h, i * 256 + s.decorHp[i]); }
    h = fnv(h, ts); h = fnv(h, gs); h = fnv(h, ds);
    for (const p of s.props) if (p.kind === 'door') { h = fnv(h, p.id); h = fnv(h, (p.open ? 1 : 0) + (p.locked ? 2 : 0) + (p.entered ? 4 : 0) + (p.blocking ? 8 : 0)); }
    for (const x of s.hostiles) { h = fnvStr(h, x.state); h = num(h, x.health); }
    for (const c of s.casualties) { h = num(h, c.health); h = fnvStr(h, String(c.where)); }
    for (const a of s.agents) { h = num(h, a.x); h = num(h, a.y); }
  }
  return h.toString(16);
}

interface Seen { f: Fx; sid: number; tick: number; t: number }
interface Run { sim: Sim; I: Incident | null; ticks: number; recs: Seen[]; breachTick: Map<number, number> }

/**
 * 강제 사건을 일으켜, 그 사건이 끝난 틱 + 150틱까지(닫히지 않으면 hardCap 또는 교대 끝) 돌린다.
 * ticks 를 주면 그 틱 수만큼만 돌린다(끈 쪽을 켠 쪽과 같은 틱에서 비교하려고).
 * 틱마다 새로 생긴 효과 기록을 모은다(s.fx 는 잘려 나가므로 끝에 한 번 보면 놓친다).
 */
function runForced(seed: string, force: string, d = HOT, ticks?: number): Run {
  const sim = new Sim(seed, d, 1200, { force });
  const seen = new WeakSet<Fx>();
  const recs: Seen[] = [];
  const breachTick = new Map<number, number>();
  const [ft, fv] = force.split('/');
  let I: Incident | null = null, closedAt = -1, n = 0;
  while (!sim.ended && n < 20000) {
    sim.step(); n++;
    for (const s of sim.scenes) {
      if (!s) continue;
      for (const f of s.fx) if (!seen.has(f)) { seen.add(f); recs.push({ f, sid: s.id, tick: sim.tick, t: sim.t }); }
      if (s.breachDone && !breachTick.has(s.id)) breachTick.set(s.id, sim.tick);
    }
    if (!I) I = sim.incidents.find((q) => q.truth.type === ft && (!fv || q.truth.variant === fv) && q.createdAt >= 15 && q.createdAt < 15.5) ?? null;
    if (ticks !== undefined) { if (n >= ticks) break; continue; }
    if (I && I.phase === 'closed' && closedAt < 0) closedAt = n;
    if (closedAt >= 0 && n >= closedAt + 150) break;
  }
  return { sim, I, ticks: n, recs, breachTick };
}

// ───────────────────────── 1. 해시 불변 (스위치) ─────────────────────────
describe('교전 연출 기록 — 결과를 바꾸지 않는다', () => {
  it('FXLOG 를 켜고 끈 두 실행의 기록 해시와 상태 요약이 같다', () => {
    try {
      for (const force of ['armed/shooter', 'armed/hostage', 'armed/siege', 'armed/bomb'])
        for (let k = 0; k < 3; k++) {
          FXLOG.on = true;
          const a = runForced('G5-' + k, force);
          FXLOG.on = false;
          const b = runForced('G5-' + k, force, HOT, a.ticks);
          expect(b.ticks, `${force} ${k}`).toBe(a.ticks);
          expect(b.sim.logHash, `${force} ${k}: logHash`).toBe(a.sim.logHash);
          expect(digest(b.sim), `${force} ${k}: 상태 요약`).toBe(digest(a.sim));
          // 끈 쪽에는 꼬리표도 새 기록도 없다
          expect(b.recs.some((r) => r.f.c || r.f.kind === 'breach' || r.f.kind === 'cuff' || r.f.kind === 'melee')).toBe(false);
        }
    } finally { FXLOG.on = true; }
  }, 120000);

  it('같은 시드 두 번의 정한 틱 기록 해시가 같다 (새 기록이 있어도)', () => {
    const a = runForced('G5-REP', 'armed/siege'), b = runForced('G5-REP', 'armed/siege', HOT, a.ticks);
    expect(b.sim.logHash).toBe(a.sim.logHash);
    expect(digest(b.sim)).toBe(digest(a.sim));
  }, 60000);
});

// ───────────────────────── 2. 기록 고리 ─────────────────────────
describe('교전 연출 기록 — 꼬리표', () => {
  it('사격·섬광탄·진입·검거의 기록에 빠짐없이 꼬리표가 붙는다', () => {
    const got = { ally: 0, foe: 0, flash: 0, sync: 0, room: 0, cuff: 0 };
    let k = 0;
    for (const force of ['armed/hostage', 'armed/siege', 'armed/shooter']) {
      for (let j = 0; j < 4; j++, k++) {
        const r = runForced('G5T-' + j, force);
        const { sim } = r;
        const byTick = new Map<string, Seen[]>();
        for (const x of r.recs) { const key = x.sid + ':' + x.tick; const a = byTick.get(key) ?? []; a.push(x); byTick.set(key, a); }
        const syncPerTick = new Map<string, number>();
        let cuffs = 0;
        for (const x of r.recs) {
          const s = sim.scenes[x.sid]!, f = x.f, c = f.c;
          if (f.kind === 'shot') {
            expect(c, `${sim.seed}: 꼬리표 없는 사격`).toBeTruthy();
            expect(c!.side === 0 || c!.side === 1).toBe(true);
            expect(c!.wpn && c!.res && c!.stop).toBeTruthy();
            expect(Number.isFinite(c!.ix) && Number.isFinite(c!.iy)).toBe(true);
            if (c!.side === 0) { expect(s.agents.some((a) => a.rid === c!.by), 'side 0 의 by 는 대원').toBe(true); got.ally++; }
            else { expect(s.hostiles.some((h) => h.id === c!.by), 'side 1 의 by 는 용의자').toBe(true); got.foe++; }
            if (c!.res === 'hit') {
              expect(c!.stop).toBe('body');
              expect(byTick.get(x.sid + ':' + x.tick)!.some((y) => y.f.kind === 'hit' && y.f.c && y.f.c.target === c!.target), `${sim.seed}: 맞은 사격에 딸린 피격 기록`).toBe(true);
            } else if (c!.res === 'miss') {
              if (c!.stop === 'body') expect(c!.side === 0 && c!.tk === 2, '인질이 맞은 빗나간 탄').toBe(true);
              else expect(['wall', 'door', 'far']).toContain(c!.stop);
            } else expect(c!.stop).toBe('furn');
          } else if (f.kind === 'flash') {
            expect(c && c.r === 5.2 && c.n! >= 0 && c.ox !== undefined && c.oy !== undefined, `${sim.seed}: 섬광탄 꼬리표`).toBeTruthy();
            got.flash++;
          } else if (f.kind === 'breach') {
            expect(c).toBeTruthy();
            if (c!.sync) {
              expect(r.breachTick.get(x.sid), `${sim.seed}: 동시 진입 기록은 breachDone 이 참이 된 틱에만`).toBe(x.tick);
              const key = x.sid + ':' + x.tick; syncPerTick.set(key, (syncPerTick.get(key) ?? 0) + 1);
              expect(syncPerTick.get(key)!).toBeLessThanOrEqual(s.exits.length);
              expect(c!.n!).toBeGreaterThanOrEqual(1);
              expect(s.agents.some((a) => a.rid === c!.by)).toBe(true);
              got.sync++;
            }
          } else if (f.kind === 'cuff') { cuffs++; expect(c && c.arrest && c.by !== undefined).toBeTruthy(); got.cuff++; }
        }
        // 방 진입 기록마다 같은 틱에 sync === false 인 진입 기록
        for (const e of sim.events) {
          if (e.kind !== 'action' || !e.text.includes('진입!') || e.text.startsWith('진입!')) continue;
          const sid = sim.incidents[e.incidentId]?.id;
          if (sid === undefined || !sim.scenes[sid]) continue;
          if (e.t > sim.t) continue;
          const ok = r.recs.some((x) => x.sid === sid && x.t === e.t && x.f.kind === 'breach' && x.f.c && x.f.c.sync === false);
          expect(ok, `${sim.seed}: "${e.text}" 에 방 진입 기록이 없다`).toBe(true);
          got.room++;
        }
        // 검거된 용의자 수 = 수갑 기록 수
        let arrested = 0;
        for (const s of sim.scenes) if (s) for (const h of s.hostiles) if (h.state === 'arrested') arrested++;
        expect(cuffs, `${sim.seed} ${force}: 수갑 기록 수`).toBe(arrested);
        if (k >= 5 && got.ally && got.foe && got.flash && got.sync && got.room && got.cuff) break;
      }
    }
    expect(got.ally, '대원 사격').toBeGreaterThan(0);
    expect(got.foe, '용의자 사격').toBeGreaterThan(0);
    expect(got.flash, '섬광탄').toBeGreaterThan(0);
    expect(got.sync, '동시 진입').toBeGreaterThan(0);
    expect(got.room, '방 진입').toBeGreaterThan(0);
    expect(got.cuff, '검거').toBeGreaterThan(0);
  }, 180000);

  it('폭발물이 터지면 반경 3.4 · src bomb', () => {
    const sim = new Sim('G5-BOOM', NORMAL);
    const I = createIncident(sim, { type: 'armed', variant: 'bomb', rng: sim.rng.fork('t') });
    const s = sim.scenes[I.id]!;
    const p = s.props.find((q) => q.kind === 'bomb' && q.real)!;
    expect(p).toBeTruthy();
    detonate(sim, s, I, p);
    const f = s.fx.filter((x) => x.kind === 'boom').pop()!;
    expect(f.c).toEqual({ r: 3.4, src: 'bomb' });
  });

  it('잠긴 문을 강제로 열면 forced 진입 기록이 남는다', () => {
    let found = 0;
    for (let k = 0; k < 12 && !found; k++) {
      const r = runForced('G5F-' + k, 'fire', parseDifficulty('3,5,3,3,3,3')!);
      for (const x of r.recs) if (x.f.kind === 'breach' && x.f.c?.forced && !x.f.c.sync) {
        found++;
        const s = r.sim.scenes[x.sid]!;
        const door = s.props[x.f.c.door!];
        expect(door.kind).toBe('door');
        expect(door.open).toBe(true);
        expect(['ram', 'irons', 'kick']).toContain(x.f.c.how);
      }
    }
    expect(found, '강제 개방 기록').toBeGreaterThan(0);
  }, 120000);
});

// ───────────────────────── 4. rayEnd ─────────────────────────
describe('그림용 탄착점 rayEnd', () => {
  function room(): Scene {
    const sim = new Sim('RAY');
    const s = baseScene(sim, { id: 0, truth: { type: 'armed', variant: 'test' } } as never, sim.rng.fork('room'));
    for (let y = 5; y <= 11; y++) for (let x = 5; x <= 15; x++) set(s, x, y, x === 5 || x === 15 || y === 5 || y === 11 ? T.WALL : T.FLOOR);
    return s;
  }
  it('벽에서 멈추고 자리는 벽면, 닫힌 문은 막고 열린 문은 지나간다, 아무것도 바꾸지 않는다', () => {
    const s = room();
    const tiles = s.tiles.slice(), glass = s.glass.slice(), ver = s.staticVersion;
    const a = rayEnd(s, 7, 8, 12, 8, 3);
    expect(a.stop).toBe('wall');
    expect(a.x).toBeCloseTo(14.5); expect(a.y).toBeCloseTo(8);
    // 문
    set(s, 10, 8, T.DOOR);
    const d = addProp(s, 'door', 10, 8, { open: false });
    const b = rayEnd(s, 7, 8, 12, 8, 3);
    expect(b.stop).toBe('door');
    expect(b.x).toBeCloseTo(9.5);
    d.open = true;
    const c = rayEnd(s, 7, 8, 12, 8, 3);
    expect(c.stop).toBe('wall');
    // 끝까지 가면 far
    const e = rayEnd(s, 7, 8, 8, 9, 1);
    expect(e.stop).toBe('far');
    expect(Array.from(s.glass)).toEqual(Array.from(glass));
    expect(s.staticVersion).toBe(ver);
    for (let i = 0; i < tiles.length; i++) if (i !== 8 * s.w + 10) expect(s.tiles[i]).toBe(tiles[i]);
  });
});

// ───────────────────────── 5. 연출 기억 FxBook ─────────────────────────
/** 필요한 칸만 가진 가짜 현장·시뮬레이션 */
function fakeScene(id = 0): Scene {
  return { id, archived: false, fx: [], entryOrdered: false, breachDone: false, breachAt: -1, exits: [{ x: 3, y: 3 }], entryExit: 0, entryExit2: -1, staging: { x: 0, y: 0 }, agents: [], hostiles: [], casualties: [], w: 30, h: 20 } as unknown as Scene;
}
function fakeSim(scenes: Scene[]): Sim { return { t: 0, scenes } as unknown as Sim; }
function rec(kind: Fx['kind'], t: number, extra: Partial<Fx> = {}): Fx { return { kind, t, x: 5, y: 5, x2: undefined, y2: undefined, text: undefined, color: undefined, ttl: 1, c: undefined, ...extra }; }
const setT = (sim: Sim, t: number): void => { (sim as unknown as { t: number }).t = t; };

describe('연출 기억 FxBook', () => {
  it('연출 시계: 일시정지에 멈추고 15배속에서도 2배까지만 빨라진다', () => {
    const s = fakeScene(), sim = fakeSim([s]), b = new FxBook();
    b.frame(sim, 0.1, { paused: false, speed: 1, seeks: 0 });
    expect(b.clock).toBeCloseTo(0.1);
    b.frame(sim, 0.1, { paused: true, speed: 0, seeks: 0 });
    expect(b.clock).toBeCloseTo(0.1);
    b.frame(sim, 0.1, { paused: false, speed: 15, seeks: 0 });
    expect(b.clock).toBeCloseTo(0.3);
    expect(b.rate).toBe(2);
    b.frame(sim, 0.1, { paused: true, speed: 0, seeks: 0 });
    b.debugStep(0.25);                         // 일시정지 중의 개발용 한 걸음
    expect(b.clock).toBeCloseTo(0.55);
  });
  it('한 프레임에 여러 틱의 기록이 들어오면 태어난 순서가 시뮬레이션 순서와 같다 · 같은 틱의 진입 뒤 섬광탄은 0.12 늦다', () => {
    const s = fakeScene(), sim = fakeSim([s]), b = new FxBook();
    b.frame(sim, 0.016, { paused: false, speed: 15, seeks: 0 });
    for (const t of [0.2, 0.4, 0.6, 0.8]) s.fx.push(rec('shot', t, { x2: 9, y2: 5 }));
    s.fx.push(rec('breach', 1.0)); s.fx.push(rec('flash', 1.0)); s.fx.push(rec('shot', 1.0, { x2: 9, y2: 5 }));
    setT(sim, 1.0);
    b.frame(sim, 0.1, { paused: false, speed: 15, seeks: 0 });
    const shots = b.fresh.filter((e) => e.kind === 'shot');
    for (let i = 1; i < 4; i++) expect(shots[i].born).toBeGreaterThan(shots[i - 1].born);
    const fl = b.fresh.find((e) => e.kind === 'flash')!, br = b.fresh.find((e) => e.kind === 'breach')!;
    expect(fl.born + fl.delay - (br.born + br.delay)).toBeCloseTo(0.12);
    expect(shots[4].delay).toBeCloseTo(0.2);
  });
  it('상한을 넘으면 오래된 것부터 버린다 · 되감기 뒤 첫 받아들이기는 fresh 가 비어 있다 · 모르는 종류는 fresh 에만', () => {
    const s = fakeScene(), sim = fakeSim([s]), b = new FxBook();
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 0 });
    for (let i = 0; i < 5; i++) s.fx.push(rec('boom', 0, { x: i }));
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 0 });
    const booms = b.live(0).filter((e) => e.kind === 'boom');
    expect(booms.length).toBe(3);
    expect(booms.map((e) => e.x)).toEqual([2, 3, 4]);
    for (const k of ['collapse', 'horn', 'drop'] as unknown as Fx['kind'][]) s.fx.push(rec(k, 0));
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 0 });
    expect(b.fresh.map((e) => e.kind).sort()).toEqual(['collapse', 'drop', 'horn']);
    expect(b.live(0).some((e) => !!e.f && !FX_DRAWN.has(e.kind))).toBe(false);
    s.fx.push(rec('shot', 0, { x2: 8, y2: 5 }));
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 1 });      // 되감기
    expect(b.fresh.length).toBe(0);
    s.fx.push(rec('shot', 0, { x2: 8, y2: 5 }));
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 1 });
    expect(b.fresh.length).toBe(1);
  });
  it('진입 예고 3·2·1 마다 합성 항목이 하나씩 생기고 s.fx 는 그대로다', () => {
    const s = fakeScene(), sim = fakeSim([s]), b = new FxBook();
    s.entryOrdered = true; s.breachAt = 5;
    const ticks: number[] = [];
    for (let k = 0; k <= 26; k++) {
      setT(sim, k * 0.2);
      if (k * 0.2 >= 5) s.breachDone = true;
      b.frame(sim, 0.2, { paused: false, speed: 1, seeks: 0 });
      for (const e of b.fresh) if (e.kind === 'tick') ticks.push(e.n!);
    }
    expect(ticks).toEqual([3, 2, 1]);
    expect(s.fx.length).toBe(0);
  });
  it('화면 막은 실제 시간 2.5초 안의 둘째 것이 0 이다', () => {
    const s = fakeScene(), sim = fakeSim([s]), b = new FxBook();
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 0 });
    s.fx.push(rec('boom', 0, { c: { r: 3 } }));
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 0 });
    expect(b.orange(0)).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++) b.frame(sim, 0.1, { paused: false, speed: 1, seeks: 0 });
    s.fx.push(rec('flash', 0.7));
    setT(sim, 0.7);
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 0 });
    expect(b.whiteout(0)).toBe(0);                // 첫 막에서 실제 시간 2.5초가 지나지 않았다
    for (let i = 0; i < 30; i++) b.frame(sim, 0.1, { paused: false, speed: 1, seeks: 0 });
    s.fx.push(rec('flash', 0.8));
    setT(sim, 0.8);
    b.frame(sim, 0.016, { paused: false, speed: 1, seeks: 0 });
    expect(b.whiteout(0)).toBeGreaterThan(0);     // 3초 뒤의 섬광탄은 다시 막을 낸다
    expect(DECISIVE.has('shot') && DECISIVE.has('breach')).toBe(true);
  });
});

// ───────────────────────── 6. 그림 함수 ─────────────────────────
// 가짜 2D 맥락과 가짜 캔버스는 tests/fakeCanvas.ts (G4 의 시험도 함께 쓴다)

describe('교전 그림 함수가 예외 없이 돈다', () => {
  it('모든 종류의 합성 기록(테이저 포함)을 k = 0·0.3·0.7·1, 작은 창 참·거짓으로 그린다 · drawScene 도 한 번', async () => {
    const { drawScene } = await import('../src/view/renderScene');
    const g = globalThis as unknown as { document?: unknown; Path2D?: unknown };
    const had = g.document, hadPath = g.Path2D;
    g.document = { createElement: () => fakeCanvas() };
    g.Path2D = class { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => undefined) }); } };
    try {
      const r = runForced('G5-DRAW', 'armed/siege', HOT, 700);
      const { sim } = r;
      const s = sim.scenes.find((q) => q && q.agents.length > 0 && q.hostiles.length > 0)!;
      expect(s).toBeTruthy();
      const a = s.agents[0], h = s.hostiles[0], t = sim.t, e0 = s.exits[0];
      const recs: Fx[] = [
        rec('shot', t, { x: a.x, y: a.y, x2: h.x, y2: h.y, color: '#ffe08a', c: { side: 0, by: a.rid, wpn: 'rifle', res: 'miss', ix: h.x + 2, iy: h.y, stop: 'wall', tk: 1, target: h.id } }),
        rec('shot', t, { x: h.x, y: h.y, x2: a.x, y2: a.y, color: '#ff8a5c', c: { side: 1, by: h.id, wpn: 'hgun', res: 'cover', ix: a.x, iy: a.y, stop: 'furn', tk: 0, target: a.rid } }),
        rec('shot', t, { x: a.x, y: a.y, x2: h.x, y2: h.y, c: { side: 0, by: a.rid, wpn: 'beanbag', res: 'hit', ix: h.x, iy: h.y, stop: 'body', tk: 1, target: h.id } }),
        rec('shot', t, { x: a.x, y: a.y, x2: h.x + 1, y2: h.y, color: '#ffe08a' }),      // 꼬리표 없는 옛 기록
        rec('hit', t, { x: h.x, y: h.y, c: { side: 0, ox: a.x, oy: a.y, tk: 1, target: h.id } }),
        rec('hit', t, { x: a.x, y: a.y, c: { side: 1, ox: h.x, oy: h.y, tk: 0, target: a.rid, arm: 0.6 } }),
        rec('hit', t, { x: 3, y: 3 }),                                                     // 꼬리표 없는 피격 (교통사고)
        rec('flash', t, { x: h.x, y: h.y, c: { side: 0, by: a.rid, ox: a.x, oy: a.y, r: 5.2, n: 1 } }),
        rec('flash', t, { x: h.x, y: h.y, c: { side: 0, r: 5.2, n: 0 } }),
        rec('boom', t, { x: h.x, y: h.y, c: { r: 3.4, src: 'bomb' } }),
        rec('breach', t, { x: e0.x, y: e0.y, c: { by: a.rid, ox: e0.x, oy: e0.y + 1, door: 0, how: 'ram', n: 2, sync: true, forced: false } }),
        rec('breach', t, { x: 5, y: 5, c: { by: a.rid, ox: 5, oy: 6, door: 1, how: 'irons', n: 1, sync: false, forced: true } }),
        rec('breach', t, { x: 7, y: 5, c: { by: a.rid, ox: 7, oy: 6, door: 2, how: 'hydraulic', n: 1, sync: false, forced: true } }),
        rec('melee', t, { x: h.x, y: h.y, x2: a.x, y2: a.y, c: { side: 1, by: h.id, wpn: 'knife', res: 'hit', tk: 0, target: a.rid } }),
        rec('cuff', t, { x: h.x, y: h.y, c: { by: a.rid, ox: a.x, oy: a.y, arrest: 'tackle', target: h.id } }),
        rec('taser', t, { x: a.x, y: a.y, x2: h.x, y2: h.y, c: { side: 0, by: a.rid, wpn: 'taser', res: 'hit', tk: 1, target: h.id } }),
        rec('taser', t, { x: a.x, y: a.y, x2: h.x, y2: h.y, c: { side: 0, by: a.rid, wpn: 'taser', res: 'miss', tk: 1, target: h.id } }),
        rec('glass', t, { x: 4, y: 4 }), rec('debris', t, { x: 6, y: 6 }),
      ];
      s.fx.push(...recs);
      const ctx = fakeCtx();
      for (const mini of [false, true]) {
        const b2 = new FxBook();
        b2.frame(sim, 0.016, { paused: false, speed: 1, seeks: 0 });
        expect(b2.live(s.id).length).toBeGreaterThanOrEqual(recs.length);
        for (const k of [0, 0.3, 0.7, 1]) {
          const cv: combat.CombatView = { g: ctx, sim, s, book: b2, ts: 32, alpha: 0.5, mini, truth: k < 0.5, reduced: false, H: 900, time: k };
          combat.drawCombatDecals(cv); combat.drawAimLines(cv); combat.drawCombatHoles(cv, ctx, 0.5); combat.drawCombatLights(cv);
          combat.drawCombatFx(cv); combat.drawCountdown(cv, 3, 3, 2.5 - k * 3); combat.drawNegotiation(cv); combat.drawCuffs(cv);
          for (const ag of s.agents) { combat.agentFx(cv, ag); combat.drawCoverBand(cv, ag, 10, 10); }
          for (const hh of s.hostiles) { combat.hostileFx(cv, hh); combat.stunMark(cv, hh); }
          combat.casualtyFlinch(cv, 0, 1, 1);
          combat.drawCoverBadge(ctx, 10, 10, 32); combat.drawStunStars(ctx, 10, 10, 32, k, 1); combat.drawBreachGlow(ctx, 10, 10, 32, 0.5);
          combat.drawScreenVeil(ctx, b2, s.id, 800, 600, { cx: 15, cy: 10, hw: 15, hh: 10 }, k > 0.5);
          drawCombatPin(ctx, b2, sim, sim.incidents[s.incidentId], 100, 100, 16, 1, { truth: k < 0.5, mini, timeMs: k * 1000 });
          b2.shake(s.id, 32, { cx: 15, cy: 10, hw: 15, hh: 10 });
          drawScene(ctx, sim, s, 800, 600, { truth: k < 0.5, alpha: 0.5, timeMs: k * 1000, selectedRid: -1, mini, book: b2, cam: k > 0.5 ? { x: 15, y: 10, zoom: 2 } : undefined });
          b2.debugStep(k === 0 ? 0.3 : 0.7);
        }
      }
    } finally { g.document = had; g.Path2D = hadPath; }
  }, 60000);
});

// ───────────────────────── 7. 소리 묶음 규칙 ─────────────────────────
function entry(kind: FxEntry['kind'], born: number, extra: Partial<FxEntry> = {}, f: Partial<Fx> = {}): FxEntry {
  return { kind, f: rec(kind as Fx['kind'], 1, f), sid: 0, x: 5, y: 5, born, delay: 0, dur: 1, seed: 0.3, ...extra };
}
describe('교전 소리 고르기 planCues', () => {
  it('15배속에 사격 40발이 한 프레임에 오면 현장·쪽마다 연사 하나, 토큰 통이 비면 버린다, 섬광·폭발은 버리지 않는다', () => {
    const st = newPlanState();
    const fresh: FxEntry[] = [];
    for (let i = 0; i < 40; i++) fresh.push(entry('shot', 1, {}, { c: { side: (i % 2) as 0 | 1, wpn: 'rifle', res: 'miss', stop: 'far' } }));
    fresh.push(entry('flash', 1), entry('boom', 1, {}, { c: { r: 3 } }));
    const cues = planCues(fresh, 15, 10, st, { clock: 1, rate: 2 });
    const guns = cues.filter((c) => c.kind === 'gun');
    expect(guns.length).toBe(TOKEN_CAP);         // 연사 둘(3발씩) 가운데 토큰 4개만큼
    expect(st.dropped).toBe(2);
    expect(cues.some((c) => c.kind === 'flashBang')).toBe(true);
    expect(cues.some((c) => c.kind === 'boom')).toBe(true);
    const side0 = guns.filter((c) => c.side === 0).sort((p, q) => p.when - q.when);
    expect(side0[1].when - side0[0].when).toBeCloseTo(0.055);      // 연사 안의 간격 55ms
  });
  it('1초 동안 프레임마다 사격을 넣어도 사격류 cue 가 14개를 넘지 않는다', () => {
    const st = newPlanState();
    let n = 0;
    for (let k = 0; k < 60; k++) {
      const now = 5 + k / 60;
      const fresh = [entry('shot', now, {}, { c: { side: 0, wpn: 'pistol', res: 'miss', stop: 'wall', ix: 9, iy: 5 } }), entry('hit', now, {}, { c: { tk: 1, target: 0 } })];
      n += planCues(fresh, 1, now, st, { clock: now, rate: 1 }).filter((c) => isGunClass(c.kind)).length;
    }
    expect(n).toBeLessThanOrEqual(14);
  });
  it('같은 틱의 진입과 섬광탄: 터짐 소리가 진입 소리보다 (0.12 + 0.34) / rate 늦다', () => {
    const br = entry('breach', 2, {}, { c: { how: 'kick', sync: true } });
    const fl = entry('flash', 2, { delay: 0.12 }, { c: { ox: 1, oy: 1, r: 5.2 } });
    for (const rate of [1, 2]) {
      const cues = planCues([br, fl], rate === 1 ? 1 : 15, 20 + rate, newPlanState(), { clock: 2, rate });
      const a = cues.find((c) => c.kind === 'breach')!, b = cues.find((c) => c.kind === 'flashBang')!;
      expect(b.when - a.when).toBeCloseTo((0.12 + 0.34) / rate);
    }
  });
  it('배속 8 이상에서는 탄착·피격·수갑 소리가 없다 (자동 감속 중인 1배속에서는 낸다)', () => {
    const fresh = [entry('shot', 1, {}, { c: { side: 0, wpn: 'pistol', res: 'miss', stop: 'wall', ix: 9, iy: 5 } }), entry('hit', 1, {}, { c: { tk: 1, target: 0 } }), entry('cuff', 1)];
    const fast = planCues(fresh, 15, 1, newPlanState(), { clock: 1, rate: 2 }).map((c) => c.kind);
    expect(fast).toContain('gun'); expect(fast).not.toContain('impactWall'); expect(fast).not.toContain('hit'); expect(fast).not.toContain('cuff');
    const slow = planCues(fresh, 1, 1, newPlanState(), { clock: 1, rate: 1 }).map((c) => c.kind);
    expect(slow).toContain('impactWall'); expect(slow).toContain('hit'); expect(slow).toContain('cuff');
  });
});

// ───────────────────────── 9. 잔혹한 묘사 없음 ─────────────────────────
describe('피 없이', () => {
  it('renderScene 에 blood: 가 없고, sprites 에 짙은 붉은 웅덩이 색이 없고, src/view 어디에도 붉은 피격 조각 색이 없다', () => {
    expect(readFileSync('src/view/renderScene.ts', 'utf8')).not.toContain('blood:');
    expect(readFileSync('src/view/scene/sprites.ts', 'utf8')).not.toContain('rgba(110,18,22');
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk('src/view')) expect(readFileSync(f, 'utf8'), f).not.toContain('rgba(230,50,50');
  });
});
