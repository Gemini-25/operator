// G4 한눈에 보이는 현장 상태 (docs/specs/G4-scene-legibility.md): 그림용 기록이 결과를 바꾸지 않는다, 기록의 일관성, 고정 층 서명, 시점 규칙, 가스·인질 판정, 그림 함수
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { RUIN_LOG, RUIN_WALL, markRuin } from '../src/sim/field/ruins';
import { addProp, baseScene, set } from '../src/sim/field/kit';
import { tickCollapse } from '../src/sim/field/hazards';
import { createIncident } from '../src/sim/incidents';
import { T } from '../src/sim/types';
import type { Incident, Scene } from '../src/sim/types';
import { staticSig } from '../src/view/scene/staticLayer';
import { BeliefStore, mkFact } from '../src/sim/field/beliefs';
import { hazardChips, pinIcon, ruinInfo, ruinSeen } from '../src/view/hazardState';

// ───────────────────────── 도우미 ─────────────────────────
/** 강제 사건(15초에 생긴다)을 찾는다 */
function forcedIncident(sim: Sim, force: string): Incident | undefined {
  return sim.incidents.find((q) => Math.abs(q.createdAt - 15) < 0.5 && q.truth.type === force.split('/')[0]);
}
/** at 초까지 돌리고 강제 사건 현장에 같은 조작을 한 뒤 끝까지 */
function forcedRun(seed: string, force: string, at: number, mutate: (s: Scene) => void, len = 600): Sim {
  const sim = new Sim(seed, NORMAL, len, { force });
  while (sim.t < at && !sim.ended) sim.step();
  const I = forcedIncident(sim, force);
  const s = I ? sim.scenes[I.id] : null;
  if (s) mutate(s);
  sim.runToEnd(40000);
  return sim;
}
const fingerprint = (sim: Sim): string => [sim.logHash.toString(16), sim.report?.hash, JSON.stringify(sim.report?.counts)].join(' ');
function withLog<T>(on: boolean, f: () => T): T { const was = RUIN_LOG.on; RUIN_LOG.on = on; try { return f(); } finally { RUIN_LOG.on = was; } }

const shakeCracks = (s: Scene): void => { for (const p of s.props) if (p.kind === 'unstable') p.leak = 0.97; };
const burnRooms = (s: Scene): void => {
  for (const r of s.regions) {
    if (!r.indoor || r.kind !== 'room') continue;
    for (const i of r.tiles) if (!s.burned[i]) { s.burned[i] = 1; s.burnedTiles++; }
  }
};

// ───────────────────────── 1·2. 기록 ─────────────────────────
describe('기록 — 그림용 기록은 결과를 바꾸지 않는다', () => {
  it('켜고 끄기: 붕괴(2차 붕괴)·화재(천장 붕괴)에서 logHash·report.hash·counts 가 같다', () => {
    let wall = 0, secondary = 0, ceiling = 0;
    const cases: [string, string, number, (s: Scene) => void][] = [
      ...['S1', 'S2', 'S3'].map((seed) => [seed, 'collapse/std', 16, shakeCracks] as [string, string, number, (s: Scene) => void]),
      ...['S1', 'S2', 'S3', 'S4'].map((seed) => [seed, 'fire/std', 40, burnRooms] as [string, string, number, (s: Scene) => void]),
    ];
    for (const [seed, force, at, mut] of cases) {
      const on = withLog(true, () => forcedRun(seed, force, at, mut));
      const off = withLog(false, () => forcedRun(seed, force, at, mut));
      expect(fingerprint(on), `${seed} ${force}`).toBe(fingerprint(off));
      for (const s of off.scenes) if (s) { expect(s.ruin).toBeUndefined(); expect(s.falls).toBeUndefined(); }
      for (const s of on.scenes) {
        if (!s) continue;
        if (s.ruin && s.ruin.some((v) => v === 1)) wall++;
        for (const f of s.falls ?? []) { if (f.cause === 'secondary') secondary++; if (f.cause === 'ceiling') ceiling++; }
      }
    }
    expect(wall).toBeGreaterThan(0);
    expect(secondary).toBeGreaterThan(0);
    expect(ceiling).toBeGreaterThan(0);
  }, 120000);

  it('읽는 곳: src/sim 안에서 .ruin·.falls·효과 종류 \'collapse\' 를 다루는 코드는 field/ruins.ts 뿐이다', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    let calls = 0;
    for (const file of walk(join(__dirname, '../src/sim'))) {
      if (!file.endsWith('.ts')) continue;
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      const own = file.replace(/\\/g, '/').endsWith('src/sim/field/ruins.ts');
      if (own) continue;
      calls += (code.match(/\b(markRuin|recordFall)\(/g) ?? []).length;
      expect(code, file).not.toMatch(/\.ruin\b|\.falls\b/);
      // 효과 종류로서의 'collapse': 효과 기록을 만들거나(kind: 'collapse') 효과의 종류와 견주는 줄
      for (const line of code.split('\n')) {
        if (!line.includes("'collapse'")) continue;
        expect(line, file).not.toMatch(/kind:\s*'collapse'/);
        expect(line, file).not.toMatch(/\b(fx|f|e)\.kind\s*[!=]==?\s*'collapse'|pushFx\([^)]*'collapse'/);
      }
    }
    expect(calls).toBeGreaterThanOrEqual(7);      // builders 셋, hazards 넷
  });
});

// ───────────────────────── 3. 고정 층 서명 ─────────────────────────
/** 손으로 만든 방 하나 (tests/destruction.test.ts 의 room() 과 같은 모양): x 5~15, y 5~11 이 벽, 그 안이 바닥 */
function room(seed = 'G4'): { sim: Sim; s: Scene; at: (x: number, y: number) => number } {
  const sim = new Sim(seed);
  const s = baseScene(sim, { id: 0, truth: { type: 'collapse', variant: 'test' } } as never, sim.rng.fork('room'));
  for (let y = 5; y <= 11; y++) for (let x = 5; x <= 15; x++) set(s, x, y, x === 5 || x === 15 || y === 5 || y === 11 ? T.WALL : T.FLOOR);
  return { sim, s, at: (x, y) => y * s.w + x };
}
/** 붕괴 사건 현장을 바로 만든다 (평소 추첨과 무관한 난수 흐름) */
function collapseScene(seed: string, variant = 'std', k = 0): { sim: Sim; s: Scene; I: Incident } {
  const sim = new Sim(seed);
  const I = createIncident(sim, { type: 'collapse', variant, rng: sim.rng.fork('g4:' + k) });
  return { sim, s: sim.scenes[I.id]!, I };
}

describe('고정 층 서명', () => {
  it('무너진 자리의 기록·치운 잔해에는 바뀌고, 균열 보강에는 그대로다', () => {
    const { s, at } = room();
    const s0 = staticSig(s);
    markRuin(s, at(8, 8), RUIN_WALL);
    const s1 = staticSig(s);
    expect(s1).not.toBe(s0);
    const crack = addProp(s, 'unstable', 10, 8, { leak: 0.2, leakRate: 0.005 });
    const s2 = staticSig(s);
    crack.mitigated = true;
    expect(staticSig(s)).toBe(s2);      // 지지대는 매 프레임 그린다
    const deb = addProp(s, 'debris', 12, 8, { blocking: true, hp: 10 });
    const s3 = staticSig(s);
    deb.removed = true;
    expect(staticSig(s)).not.toBe(s3);
  });
  it('2차 붕괴: tickCollapse 한 번에 서명이 바뀌고, 새 잔해 칸은 ruin 8, falls 끝은 secondary, fx 끝은 collapse', () => {
    let checked = 0;
    for (let k = 0; k < 12 && checked < 2; k++) {
      const { sim, s, I } = collapseScene('G4-SEC', 'std', k);
      const crack = s.props.find((p) => p.kind === 'unstable');
      if (!crack) continue;
      const before = staticSig(s), props0 = s.props.length, ruin0 = s.ruin!.slice();
      crack.leak = 1;
      tickCollapse(sim, s, I);
      const fresh = s.props.slice(props0).filter((p) => p.kind === 'debris');
      if (!fresh.length) continue;
      expect(staticSig(s)).not.toBe(before);
      // 처음 모습(넘어간 벽 1·깔린 가구 16+)은 덮어쓰지 않는다 — 처음엔 0 이었던 칸만 8 이 된다
      for (const p of fresh) { const i = p.y * s.w + p.x; expect(s.ruin![i]).toBe(ruin0[i] === 0 ? 8 : ruin0[i]); }
      expect(fresh.some((p) => s.ruin![p.y * s.w + p.x] === 8)).toBe(true);
      expect(s.falls![s.falls!.length - 1].cause).toBe('secondary');
      expect(s.fx[s.fx.length - 1].kind).toBe('collapse');
      expect(s.fx.some((f) => f.kind === 'boom')).toBe(false);      // 2차 붕괴는 더는 폭발 효과를 남기지 않는다
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// ───────────────────────── 6. 기록의 일관성 ─────────────────────────
describe('기록의 일관성', () => {
  it('넘어간 벽·깔린 가구 칸은 무너진 자리이고, 바닥이거나 sealPockets 가 메운 벽이다', () => {
    const walk = (s: Scene, i: number): boolean => { const t = s.tiles[i]; return t === T.FLOOR || t === T.DOOR || t === T.GROUND || t === T.ROAD || t === T.STAIR; };
    let floor = 0, sealed = 0, withWall = 0;
    const check = (s: Scene): void => {
      expect(s.ruin).toBeDefined();
      expect(s.falls?.[0]?.cause).toBe('zone');
      for (let i = 0; i < s.ruin!.length; i++) {
        const v = s.ruin![i];
        if (v !== 1 && v < 16) continue;
        expect(s.damage[i]).toBe(1);
        if (s.tiles[i] === T.FLOOR) { floor++; continue; }
        expect(s.tiles[i]).toBe(T.WALL);
        for (const d of [1, -1, s.w, -s.w]) expect(walk(s, i + d)).toBe(false);
        sealed++;
      }
      if (s.ruin!.some((v) => v === 1)) withWall++;
    };
    for (let k = 0; k < 10; k++) check(collapseScene('G4-REC', 'std', k).s);
    expect(withWall).toBeGreaterThan(0);
    expect(floor / (floor + sealed)).toBeGreaterThanOrEqual(0.9);
    for (let k = 0; k < 3; k++) check(collapseScene('G4-REC', 'gasblast', k).s);      // 가스 폭발 현장도 buildCollapse 로 만든다
  });
});

// ───────────────────────── 5. 시점 규칙 ─────────────────────────
/** 관제의 평가를 손으로 붙인다 (그림 쪽만 읽는 값이다) */
function assess(I: Incident, type: string, label?: string): void { I.assessment = { type, label, typeConf: 0.9, probs: {}, severity: 2, confidence: 0.8, needs: {}, risks: [], summary: '', t: 0, revision: 0 } as never; }
/** 지휘관 한 명을 현장에 두고 믿음 저장소를 돌려준다 */
function commander(s: Scene): BeliefStore { const b = new BeliefStore(); s.agents.push({ isCommander: true, beliefs: b, status: 'active' } as never); return b; }

describe('시점 규칙', () => {
  it('붕괴: 도착 전 AI 시점은 신고 위치가 맞아야 붕괴 신고, 도착 뒤 확인 · 관찰자 시점은 처음부터 확인', () => {
    const { sim, s, I } = collapseScene('G4-VIEW', 'std', 1);
    expect(ruinInfo(sim, I)).not.toBeNull();
    expect(ruinSeen(sim, I, true)).toBe('confirmed');
    expect(ruinSeen(sim, I, false)).toBe('none');
    assess(I, 'collapse');
    I.locationKnown = true; I.reportedNode = I.truth.nodeId === 0 ? 1 : 0;      // 신고 위치가 틀렸다
    expect(ruinSeen(sim, I, false)).toBe('none');
    I.reportedNode = I.truth.nodeId;
    expect(ruinSeen(sim, I, false)).toBe('reported');
    // 도착 전: 붕괴 칩은 '붕괴 신고'뿐, 균열 칩은 없다 (지휘관이 없다)
    const pre = hazardChips(sim, I, false);
    expect(pre.map((c) => c.text)).toEqual(['붕괴 신고']);
    expect(hazardChips(sim, I, true).some((c) => c.key === 'ruin' && c.text !== '붕괴 신고')).toBe(true);
    // 도착 뒤: 확인. 지휘관이 아는 균열만 센다
    I.firstArrivalAt = sim.t;
    expect(ruinSeen(sim, I, false)).toBe('confirmed');
    const cracks = s.props.filter((p) => p.kind === 'unstable');
    const b = commander(s);
    const crackChip = (truth: boolean): string | undefined => hazardChips(sim, I, truth).find((c) => c.key === 'crack')?.text;
    if (cracks.length) {
      expect(crackChip(false)).toBeUndefined();      // 지휘관은 아직 아무 균열도 모른다
      b.merge(mkFact('haz', cracks[0].id, { kind: 'leak', active: true, x: cracks[0].x, y: cracks[0].y }, 't', sim.t, 1, true, ''));
      expect(crackChip(false)).toBe('균열 1 · 보강 0');
      expect(crackChip(true)).toBe(`균열 ${cracks.length} · 보강 0`);
    }
  });
  it('승강기 갇힘은 두 시점 모두 none, 산사태는 ruinInfo 가 null 이고 붕괴 칩이 없다', () => {
    const el = collapseScene('G4-VIEW', 'elevator', 2);
    expect(ruinSeen(el.sim, el.I, true)).toBe('none');
    el.I.firstArrivalAt = el.sim.t; assess(el.I, 'collapse', '승강기 갇힘');
    expect(ruinSeen(el.sim, el.I, false)).toBe('none');
    const ls = collapseScene('G4-VIEW', 'landslide', 3);
    expect(ls.I.truth.placeId).toBe(-1);
    expect(ruinInfo(ls.sim, ls.I)).toBeNull();
    ls.I.firstArrivalAt = ls.sim.t;
    for (const truth of [true, false]) expect(hazardChips(ls.sim, ls.I, truth).some((c) => c.key === 'ruin' || c.key === 'secondary')).toBe(false);
  });
  it('pinIcon: 진실의 변형, 관제가 붙인 이름, 보이는 유형의 아이콘', () => {
    const el = collapseScene('G4-ICON', 'elevator', 1);
    expect(pinIcon(el.I, true)).toBe('elevator');
    expect(pinIcon(el.I, false)).toBe('unknown');
    assess(el.I, 'collapse', '승강기 갇힘');
    expect(pinIcon(el.I, false)).toBe('elevator');
    assess(el.I, 'collapse');
    expect(pinIcon(el.I, false)).toBe('collapse');
    const gb = collapseScene('G4-ICON', 'gasblast', 2);
    assess(gb.I, 'hazmat');
    expect(pinIcon(gb.I, true)).toBe('hazmat');      // 핀 색(보이는 유형)과 어긋나지 않는다
    assess(gb.I, 'collapse');
    expect(pinIcon(gb.I, true)).toBe('gasblast');
  });
  it('AI 시점의 인질 칩은 수 없는 인질 붙잡힘, 폭발물 칩은 해체와 폭발을 가른다', () => {
    const sim = new Sim('G4-HOS');
    const I = createIncident(sim, { type: 'armed', variant: 'hostage', rng: sim.rng.fork('g4') });
    const s = sim.scenes[I.id]!;
    const b = commander(s);
    const h = s.hostiles.find((x) => x.hostageId >= 0)!;
    b.merge(mkFact('hos', h.id, { x: h.x, y: h.y, weapon: h.weapon, state: 'hold', hostage: true, facing: 0 }, 't', sim.t, 1, true, ''));
    const hc = hazardChips(sim, I, false).find((c) => c.key === 'hostage');
    expect(hc?.text).toBe('인질 붙잡힘');
    const truthChip = hazardChips(sim, I, true).find((c) => c.key === 'hostage');
    expect(truthChip?.text).toMatch(/^인질 붙잡힘 \d+/);
    // 폭발물: 하나는 해체, 하나는 폭발 — AI 시점의 믿음은 둘 다 active: false 다
    const bomb = (x: number): ReturnType<typeof addProp> => addProp(s, 'bomb', x, 3, { blocking: false });
    const p1 = bomb(2), p2 = bomb(4);
    p1.mitigated = true; p2.exploded = true;
    for (const p of [p1, p2]) b.merge(mkFact('haz', p.id, { kind: 'bomb', active: false, x: p.x, y: p.y }, 't', sim.t, 1, true, ''));
    expect(hazardChips(sim, I, false).find((c) => c.key === 'bomb')?.text).toBe('폭발물 0 · 처리 1 · 터짐 1');
  });
});
