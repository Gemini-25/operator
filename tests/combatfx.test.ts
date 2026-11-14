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
