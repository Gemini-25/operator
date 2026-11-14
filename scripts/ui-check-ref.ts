// 화면 자동 검사(scripts/ui-check.cjs)의 헤드리스 기준값: 화면과 같은 시드·난이도로 Sim 을 따로 돌려 정해진 틱의 기록 해시를 낸다.
//   tsx scripts/ui-check-ref.ts '{"seed":"S3","difficulty":{...},"ticks":[10,500],"end":true}'
// 화면의 실행기(src/view/runner.ts)와 똑같이 교대 길이 1200초, force 는 주소에 없으면 null 로 만든다.
import { Sim } from '../src/sim/engine';
import type { Difficulty } from '../src/sim/difficulty';

interface Req { seed: string; difficulty: Difficulty; ticks: number[]; end?: boolean; shiftLen?: number; force?: string | null }

const req = JSON.parse(process.argv[2] ?? '{}') as Req;
const sim = new Sim(req.seed, req.difficulty, req.shiftLen ?? 1200, { force: req.force ?? null });
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
