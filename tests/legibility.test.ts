// G4 한눈에 보이는 현장 상태 (docs/specs/G4-scene-legibility.md): 그림용 기록이 결과를 바꾸지 않는다, 기록의 일관성, 고정 층 서명, 시점 규칙, 가스·인질 판정, 그림 함수
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { RUIN_LOG } from '../src/sim/field/ruins';
import type { Incident, Scene } from '../src/sim/types';

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
