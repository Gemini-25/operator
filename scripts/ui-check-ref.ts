// 화면 자동 검사(scripts/ui-check.cjs)의 헤드리스 기준값: 화면과 같은 시드·난이도로 Sim 을 따로 돌려 정해진 틱의 기록 해시를 낸다.
//   tsx scripts/ui-check-ref.ts '{"seed":"S3","difficulty":{...},"ticks":[10,500],"end":true}'
// 화면의 실행기(src/view/runner.ts)와 똑같이 교대 길이 1200초, force 는 주소에 없으면 null 로 만든다.
// (I2) carry 를 주면 그 이어받은 상태를 입력으로 (화면의 ?org=continue 와 같은 입력). dumpCarry 를 주면 해시 대신 검사용 이어받은 상태를 만든다:
//   그 시드·난이도의 짧은 교대(60초)가 만든 상태에서 진압 펌프차 하나의 셋째 자리·순찰차 하나의 둘째 자리를 1교대 결장(연기 흡입)으로 — 결장 칩을 보려고
import { Sim } from '../src/sim/engine';
import type { Difficulty } from '../src/sim/difficulty';
import { makeCarryover } from '../src/sim/persist';
import type { Carryover } from '../src/sim/types';

interface Req { seed: string; difficulty: Difficulty; ticks: number[]; end?: boolean; shiftLen?: number; force?: string | null; carry?: Carryover | null; dumpCarry?: boolean }

const req = JSON.parse(process.argv[2] ?? '{}') as Req;
if (req.dumpCarry) {
  const s = new Sim(req.seed, req.difficulty, 60);
  s.runToEnd();
  const co = makeCarryover(s);
  const pick = (kind: string, k: number): string | undefined => { const u = s.units.find((x) => x.kind === kind && !x.aid && x.crew.length > k); return u ? s.responders[u.crew[k]].name : undefined; };
  const names = [pick('engine', 2), pick('patrol', 1)].filter((n): n is string => !!n);
  for (const c of co.crew) {
    if (names.indexOf(c.name) >= 0) { c.out = 1; c.cause = 'smoke'; c.health = 85; }
    else if (c.out !== 0) { c.out = 0; c.cause = null; delete c.replaceIn; delete c.recruit; }      // 짧은 교대에서 우연히 생긴 결장은 지운다 (결장 수를 정해 둔다)
  }
  for (const u of co.units) delete u.service;
  process.stdout.write(JSON.stringify({ carry: co, absent: names }) + '\n');
} else {
  const sim = new Sim(req.seed, req.difficulty, req.shiftLen ?? 1200, { force: req.force ?? null, carry: req.carry ?? null });
  const want = [...new Set(req.ticks.map((t) => Math.round(t)))].sort((a, b) => a - b);
  const hashes: Record<number, string> = {};
  for (const tk of want) {
    while (sim.tick < tk && !sim.ended) sim.step();
    if (sim.tick === tk) hashes[tk] = sim.logHash.toString(16);
  }
  let final: { tick: number; hash: string; reportHash: string | null } | null = null;
  if (req.end) {
    sim.runToEnd(40000);
    final = { tick: sim.tick, hash: sim.logHash.toString(16), reportHash: sim.report ? sim.report.hash : null };
  }
  process.stdout.write(JSON.stringify({ hashes, final }) + '\n');
}
