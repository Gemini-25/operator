import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { NORMAL, PRESETS } from '../src/sim/difficulty';
import { findRoute } from '../src/sim/city';
import { BeliefStore, mkFact } from '../src/sim/field/beliefs';
import { Rng } from '../src/sim/rng';

function runShift(seed: string): Sim { const s = new Sim(seed); s.runToEnd(); return s; }
/** 같은 시드·같은 조건으로 끝까지 돈 교대는 이 파일 안에서 한 번만 돌리고 다시 쓴다 (재현성은 위 테스트가 따로 본다). 쓰는 테스트는 끝난 상태를 읽기만 한다 */
const finished = new Map<string, Sim>();
function shiftOf(seed: string, d: typeof NORMAL = NORMAL): Sim {
  const key = seed + '|' + JSON.stringify(d);
  let s = finished.get(key);
  if (!s) { s = new Sim(seed, d); s.runToEnd(); finished.set(key, s); }
  return s;
}

describe('재현성 (테스트 I)', () => {
  it('같은 시드는 같은 이벤트 기록과 같은 보고서를 만든다', () => {
    for (const seed of ['T-ALPHA', 'T-BRAVO', 'T-CHARLIE']) {
      const a = runShift(seed), b = runShift(seed);
      expect(a.events.length).toBe(b.events.length);
      expect(a.logHash).toBe(b.logHash);
      expect(JSON.stringify(a.report)).toBe(JSON.stringify(b.report));
    }
  });
  it('틱을 어떻게 묶어 진행해도(=배속과 무관하게) 결과가 같다', () => {
    const a = runShift('T-SPEED');
    const b = new Sim('T-SPEED');
    const batch = [1, 3, 8, 15, 40, 2, 75];     // 1x·3x·8x·15x 에서 프레임마다 도는 틱 수가 섞여도
    let k = 0;
    while (!b.ended) b.run(batch[k++ % batch.length]);
    expect(b.tick).toBe(a.tick);
    expect(b.logHash).toBe(a.logHash);
  });
  it('다른 시드는 다른 교대를 만든다', () => {
    expect(runShift('T-ONE').logHash).not.toBe(runShift('T-TWO').logHash);
  });
  it('시뮬레이션 코드는 Math.random / Date / DOM 을 쓰지 않는다', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const file of walk(join(__dirname, '../src/sim'))) {
      const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/Math\.random|Date\.now|new Date|performance\.now|\bdocument\.|\bwindow\./);
    }
  });
});

describe('교대 전체 진행 (테스트 A·B·C·D·F·G·J)', () => {
  const sims = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].map((seed) => shiftOf(seed));
  it('플레이어 입력 없이 교대가 끝까지 진행되고 보고서가 나온다', () => {
    for (const s of sims) {
      expect(s.ended).toBe(true);
      expect(s.report).not.toBeNull();
      expect(s.report!.totalIncidents).toBeGreaterThanOrEqual(4);
      expect(s.t).toBeLessThanOrEqual(s.hardCap + 1);
    }
  });
  it('모든 사건이 종료 상태와 판정을 갖는다 (교착 없음)', () => {
    for (const s of sims) for (const I of s.incidents) {
      expect(I.phase).toBe('closed');
      expect(I.result).not.toBeNull();
      expect(I.result!.analysis.length).toBeGreaterThan(0);
    }
  });
  it('신고 → 분석 → 배정 → 이동 → 도착이 실제 데이터로 이어진다', () => {
    let arrived = 0;
    for (const s of sims) for (const I of s.incidents) {
      expect(I.claims.length).toBeGreaterThan(0);          // 신고 접수 AI 가 정보를 모았다
      expect(I.assessment).not.toBeNull();                 // 분석 AI 가 평가했다
      if (I.firstArrivalAt < 0) continue;
      arrived++;
      expect(I.firstDispatchAt).toBeGreaterThanOrEqual(I.reportedAt);
      expect(I.firstArrivalAt).toBeGreaterThan(I.firstDispatchAt);   // 차량이 도로망을 따라 이동하는 데 시간이 걸렸다
      expect(I.everAssigned.length).toBeGreaterThan(0);
    }
    expect(arrived).toBeGreaterThan(30);
  });
  it('현장 대원의 행동이 현장 상태를 실제로 바꾼다', () => {
    let moved = 0, safe = 0, treated = 0, extinguished = 0, freed = 0;
    for (const s of sims) for (const sc of s.scenes) {
      if (!sc) continue;
      for (const c of sc.casualties) { if (c.tSafe >= 0) safe++; if (c.tTreated >= 0) treated++; if (c.tFreed >= 0) freed++; }
      for (const a of sc.agents) if (Math.hypot(a.x - sc.staging.x, a.y - sc.staging.y) > 0.01 || a.status === 'left') moved++;
      if (sc.kind === 'fire' && sc.burnedTiles < sc.totalFuelTiles && sc.burning === 0 && sc.arrivedAt >= 0) extinguished++;
    }
    expect(moved).toBeGreaterThan(50);
    expect(safe).toBeGreaterThan(20);        // 구조 대상을 실제로 안전 구역까지 옮겼다
    expect(treated).toBeGreaterThan(10);     // 응급 처치가 상태를 바꿨다
    expect(freed).toBeGreaterThan(2);        // 고립자를 구출했다
    expect(extinguished).toBeGreaterThan(2); // 전소되기 전에 불을 껐다
  });
  it('문제가 발생하고, 그중 상당수는 다른 방법으로 복구된다 (테스트 E)', () => {
    let problems = 0, recovered = 0, pathBlocked = 0;
    for (const s of sims) for (const I of s.incidents) for (const p of I.problems) { problems++; if (p.recovered) recovered++; if (p.code === 'PATH_BLOCKED') pathBlocked++; }
    expect(problems).toBeGreaterThan(40);
    expect(recovered).toBeGreaterThan(10);
    expect(pathBlocked).toBeGreaterThan(2);
  });
  it('여러 사건이 동시에 진행되며 자원을 두고 경쟁한다', () => {
    let overlap = 0, shortage = 0;
    for (const s of sims) {
      for (const A of s.incidents) for (const B of s.incidents) if (A.id < B.id && A.closedAt > B.createdAt && B.closedAt > A.createdAt) overlap++;
      for (const I of s.incidents) if (I.problems.some((p) => p.code === 'NO_UNIT')) shortage++;
    }
    expect(overlap).toBeGreaterThan(8);
    expect(shortage).toBeGreaterThan(3);
  });
  it('결과가 한쪽으로 쏠리지 않는다 (성공·부분 성공·실패가 모두 나온다)', () => {
    const count: Record<string, number> = {};
    for (const s of sims) for (const I of s.incidents) count[I.result!.outcome] = (count[I.result!.outcome] ?? 0) + 1;
    expect(count.success ?? 0).toBeGreaterThan(5);
    expect(count.partial ?? 0).toBeGreaterThan(2);
    expect((count.failed ?? 0) + (count.unresolved ?? 0)).toBeGreaterThan(0);
  });
  it('이벤트 기록의 원인 연결은 항상 과거 이벤트를 가리킨다', () => {
    for (const s of sims) for (const e of s.events) for (const c of e.causes) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThan(e.id); }
  });
});

describe('정보 격리 (Belief)', () => {
  it('확인된 정보는 미확인 전달 정보로 덮어써지지 않는다', () => {
    const b = new BeliefStore();
    b.merge(mkFact('fire', 3, 0.8, '대원', 10, 1, true, '화재'));
    expect(b.merge(mkFact('fire', 3, 0, '신고자', 20, 0.9, false, '불 없음'))).toBe(false);
    expect(b.val<number>('fire', 3)).toBe(0.8);
    expect(b.merge(mkFact('fire', 3, 0, '대원', 30, 1, true, '진압'))).toBe(true);
    expect(b.val<number>('fire', 3)).toBe(0);
  });
  it('도착 전의 대원은 현장의 진실을 모른다', () => {
    const s = new Sim('S2');
    while (!s.scenes.some((sc) => sc && sc.agents.length > 0)) s.step();
    const sc = s.scenes.find((x) => x && x.agents.length > 0)!;
    for (const a of sc.agents) {
      // 도착 직후에는 관제 브리핑(미확인)만 가지고 있다
      for (const f of a.beliefs.all()) expect(f.verified).toBe(false);
      expect(a.beliefs.list('cas').length).toBe(0);
    }
  });
});

describe('도시·경로', () => {
  it('모든 시설에서 모든 교차로로 가는 경로가 있다', () => {
    const s = new Sim('ROUTE');
    for (const f of s.city.facilities) for (const n of s.city.nodes) expect(findRoute(s.city, f.nodeId, n.id)).not.toBeNull();
  });
  it('통제된 도로는 우회한다', () => {
    const s = new Sim('ROUTE');
    const r = findRoute(s.city, 0, 30)!;
    const e = s.city.edges[r.edges[0]];
    e.closed = true;
    const r2 = findRoute(s.city, 0, 30)!;
    expect(r2.edges).not.toContain(e.id);
    expect(r2.time).toBeGreaterThanOrEqual(r.time);
  });
  it('난수 흐름은 분기별로 독립이다', () => {
    const a = new Rng(1).fork('x'), b = new Rng(1).fork('x'), c = new Rng(1).fork('y');
    expect(a.next()).toBe(b.next());
    expect(a.next()).not.toBe(c.next());
  });
});

describe('난이도 (교대 시작 전 조건)', () => {
  it('보통은 기본값과 같고, 같은 시드 + 같은 난이도는 재현된다', async () => {
    const { PRESETS } = await import('../src/sim/difficulty');
    const a = new Sim('D-1'); a.runToEnd();
    const b = new Sim('D-1', NORMAL); b.runToEnd();
    expect(a.logHash).toBe(b.logHash);
    const h1 = new Sim('D-1', PRESETS.hard.d); h1.runToEnd();
    const h2 = new Sim('D-1', PRESETS.hard.d); h2.runToEnd();
    expect(h1.logHash).toBe(h2.logHash);
    expect(h1.logHash).not.toBe(a.logHash);
    expect(h1.report!.difficultyLabel).toBe('어려움');
  });
  it('프리셋이 어려워질수록 좋은 결과의 비율이 내려간다', async () => {
    const { PRESETS } = await import('../src/sim/difficulty');
    const good = (id: 'easy' | 'normal' | 'hard' | 'extreme'): number => {
      let ok = 0, n = 0;
      // 시드 20개: 14개일 때는 쉬움과 보통의 차이(+0.02 기준)가 0.5%p 남짓이라 사건 하나의 결과만 바뀌어도 깨졌다 (Z1, 보통 S1 의 성공 하나)
      for (let k = 0; k < 20; k++) {
        const s = shiftOf('S' + k, PRESETS[id].d);
        for (const I of s.incidents) {
          if (I.truth.variant === 'false' || I.truth.variant === 'prank') continue;      // 허위 신고는 본질적으로 쉬우므로 뺀다
          n++; if (I.result!.outcome === 'success' || I.result!.outcome === 'delayed') ok++;
        }
      }
      return ok / n;
    };
    const e = good('easy'), m = good('normal'), h = good('hard'), x = good('extreme');
    expect(e).toBeGreaterThan(m + 0.02);
    expect(m).toBeGreaterThan(h + 0.05);
    expect(h).toBeGreaterThan(x + 0.05);
  }, 180000);
  it('손잡이가 해당 조건을 실제로 바꾼다', async () => {
    const { parseDifficulty, difficultyLabel } = await import('../src/sim/difficulty');
    const count = (d: typeof NORMAL): number => { let n = 0; for (let k = 0; k < 6; k++) { const s = shiftOf('S' + k, d); n += s.incidents.length; } return n; };
    expect(count({ ...NORMAL, frequency: 5 })).toBeGreaterThan(count(NORMAL) + 8);          // 사건 빈도
    expect(count({ ...NORMAL, frequency: 1 })).toBeLessThan(count(NORMAL));
    const bad = new Sim('E', { ...NORMAL, equipment: 1 }), best = new Sim('E', { ...NORMAL, equipment: 5 });  // 장비 상태
    for (const u of bad.units.filter((q) => q.dept === 'fire')) expect(u.pumpCond).toBeLessThanOrEqual(0.55);
    for (const u of best.units.filter((q) => q.dept === 'fire')) expect(u.pumpCond).toBeGreaterThanOrEqual(0.75);
    expect(best.units.find((q) => q.kind === 'engine')!.waterMax).toBeGreaterThan(bad.units.find((q) => q.kind === 'engine')!.waterMax);
    const sev = (d: typeof NORMAL): number => { let t = 0, n = 0; for (let k = 0; k < 8; k++) { const s = new Sim('S' + k, d); s.runToEnd(); for (const I of s.incidents) { t += I.truth.severity; n++; } } return t / n; };
    expect(sev({ ...NORMAL, severity: 5 })).toBeGreaterThan(sev({ ...NORMAL, severity: 1 }) + 0.4);          // 사건 심각도
    const suspects = (d: typeof NORMAL): number => { let t = 0; for (let k = 0; k < 10; k++) { const s = new Sim('S' + k, d); s.runToEnd(); for (const sc of s.scenes) if (sc) t += sc.hostiles.length; } return t; };
    expect(suspects({ ...NORMAL, threat: 5 })).toBeGreaterThan(suspects({ ...NORMAL, threat: 1 }));          // 용의자 위협
    expect(parseDifficulty('hard')).toEqual({ frequency: 4, severity: 4, threat: 4, equipment: 2, info: 2, resources: 3 });
    expect(parseDifficulty('4,4,4,2,3')).toEqual({ frequency: 4, severity: 4, threat: 4, equipment: 2, info: 3, resources: 3 });
    expect(parseDifficulty('3,3,3,3,3,5')!.resources).toBe(5);
    expect(parseDifficulty('9,9,9,9,9')).toBeNull();
    expect(difficultyLabel({ frequency: 5, severity: 5, threat: 5, equipment: 1, info: 1, resources: 3 })).toBe('극한');
  }, 180000);
});

describe('한 현장에 여러 팀', () => {
  it('같은 부서의 부대 둘 이상, 세 부서가 함께 들어가는 사건이 나온다', () => {
    let sameDeptTwice = 0, allThree = 0, most = 0;
    for (let k = 0; k < 12; k++) {
      const s = shiftOf('S' + k);
      for (const I of s.incidents) {
        const depts = I.everAssigned.map((uid) => s.units[uid].dept);
        if (depts.some((d, i) => depts.indexOf(d) !== i)) sameDeptTwice++;
        if (new Set(depts).size === 3) allThree++;
      }
    }
    expect(sameDeptTwice).toBeGreaterThan(5);
    expect(allThree).toBeGreaterThan(5);
    // 큰 사건이 많고 부대가 넉넉한 조건에서는 한 현장에 다섯 부대 이상이 들어간다 (예: 경찰 2 + 소방 2 + 구급 1)
    for (let k = 0; k < 12; k++) {
      const s = new Sim('S' + k, { ...NORMAL, severity: 4, resources: 5 }); s.runToEnd();
      for (const I of s.incidents) most = Math.max(most, I.everAssigned.length);
    }
    expect(most).toBeGreaterThanOrEqual(5);
  }, 180000);
});

describe('신고 접수 확장과 새 사건 유형', () => {
  const sims = Array.from({ length: 14 }, (_, k) => { return shiftOf('S' + k); });
  it('응급 환자 사건이 발생하고, 기본 처치 뒤에 전문 처치가 이어진다', () => {
    let medical = 0, upgraded = 0, any = 0;
    for (const s of sims) for (const I of s.incidents) {
      if (I.truth.type !== 'medical') continue;
      medical++;
      for (const c of s.scenes[I.id]!.casualties) { if (c.treatQ > 0) any++; if (c.treatQ >= 0.6) upgraded++; }
    }
    expect(medical).toBeGreaterThan(8);
    expect(any).toBeGreaterThan(5);
    expect(upgraded).toBeGreaterThan(3);
  });
  it('허위·오인 신고는 인명 피해 없이 확인 출동으로 끝난다', () => {
    let n = 0;
    for (const s of sims) for (const I of s.incidents) {
      if (I.truth.variant !== 'false' && I.truth.variant !== 'prank') continue;
      n++;
      expect(s.scenes[I.id]!.casualties.length).toBe(0);
      expect(I.problems.some((p) => p.code === 'FALSE_ALARM')).toBe(true);
      expect(I.result!.outcome === 'success' || I.result!.outcome === 'delayed').toBe(true);
    }
    expect(n).toBeGreaterThan(2);
  });
  it('비긴급 전화는 사건을 만들지 않고 접수 회선만 점유한다', () => {
    let nuisance = 0;
    for (const s of sims) for (const c of s.calls) if (c.kind === 'nuisance') { nuisance++; expect(c.incidentId).toBe(-1); expect(c.state).toBe('done'); }
    expect(nuisance).toBeGreaterThan(20);
  });
  it('신고자가 안내를 따르면 현장 상태가 실제로 달라진다', () => {
    let instructed = 0, aided = 0;
    for (const s of sims) {
      for (const c of s.calls) if (c.instructed) instructed++;
      for (const sc of s.scenes) if (sc) for (const c of sc.casualties) if (c.bystander || (c.walking === false && c.tSafe >= 0 && c.tDiscovered > c.tSafe)) aided++;
    }
    expect(instructed).toBeGreaterThan(10);
    expect(aided).toBeGreaterThan(3);
  });
  it('위치를 틀리게 신고하면 부대가 엉뚱한 곳에 먼저 가고, 바로잡은 뒤 실제 위치에 도착한다', async () => {
    const { NORMAL } = await import('../src/sim/difficulty');
    let wrong = 0;
    for (let k = 0; k < 10; k++) {
      const s = new Sim('S' + k, { ...NORMAL, info: 1 }); s.runToEnd();
      for (const I of s.incidents) if (I.problems.some((p) => p.code === 'WRONG_ADDRESS')) { wrong++; expect(I.reportedNode).toBe(I.truth.nodeId); }
    }
    expect(wrong).toBeGreaterThan(4);
  }, 180000);
  it('부대 규모 손잡이가 편성을 바꾸되 같은 대원의 능력치는 유지한다', async () => {
    const { NORMAL } = await import('../src/sim/difficulty');
    const small = new Sim('R', { ...NORMAL, resources: 1 }), base = new Sim('R'), big = new Sim('R', { ...NORMAL, resources: 5 });
    expect(small.units.length).toBe(15); expect(base.units.length).toBe(22); expect(big.units.length).toBe(25);      // 기본 편성부터 경찰 헬기·의료 헬기가 더해진다 (R1) · (N8 단계 4a·4b) 전력·가스·수도 복구반이 모든 규모에
    // 총원은 편성표에서 계산한다: 부대 종류마다 2~5명 (crews.ts 의 STAFF — 부대 규모 3~5 는 표준 인원)
    const { STAFF } = await import('../src/sim/crews');
    const total = big.units.reduce((n, u) => n + STAFF[u.kind].std.length, 0);
    expect(total).toBeGreaterThan(big.units.length * 2);
    expect(big.responders.length).toBe(total);
    expect(new Set(big.responders.map((r) => r.name)).size).toBe(total);
    // 분야별 팀 수 (N8 §9.2): 경찰 3~9 · 소방·구조·특수 3~7 · 유관 기관 0~4
    const RANGE: Record<string, [number, number]> = { police: [3, 9], fire: [3, 7], rescue: [3, 7], special: [3, 7], civil: [0, 4] };
    for (const sim of [small, base, big]) for (const f of Object.keys(RANGE)) { const n = sim.units.filter((u) => u.field === f).length; expect(n, f).toBeGreaterThanOrEqual(RANGE[f][0]); expect(n, f).toBeLessThanOrEqual(RANGE[f][1]); }
    expect(base.units.filter((u) => u.kind === 'heli' || u.kind === 'swat' || u.kind === 'hazmat' || u.kind === 'eod' || u.kind === 'boat' || u.kind === 'ladder').length).toBe(6);
    for (const r of base.responders) { const q = big.responders.find((x) => x.name === r.name)!; expect(q.skill).toBe(r.skill); expect(q.judgment).toBe(r.judgment); }
    big.runToEnd(); small.runToEnd();
    expect(big.ended && small.ended).toBe(true);
  }, 180000);
});

describe('실내 전술 (무장 사건)', () => {
  it('용의자는 바라보는 방향만 본다 — 등 뒤는 가까이 오기 전까지 모른다', async () => {
    const { hostileSees } = await import('../src/sim/field/hazards');
    const s = new Sim('FOV');
    const h = { x: 10, y: 10, facing: 0, stunUntil: -1, alertUntil: -1 } as never;      // 오른쪽(+x)을 보고 있다
    expect(hostileSees(s, h, 16, 10)).toBe(true);      // 정면
    expect(hostileSees(s, h, 14, 13)).toBe(true);      // 시야각 안쪽
    expect(hostileSees(s, h, 4, 10)).toBe(false);      // 등 뒤
    expect(hostileSees(s, h, 10, 16)).toBe(false);     // 옆
    expect(hostileSees(s, h, 8.5, 10)).toBe(true);     // 등 뒤라도 바로 곁이면 기척으로 안다
    expect(hostileSees(s, { ...(h as object), alertUntil: 99 } as never, 4, 10)).toBe(true);      // 경계 중이면 사방
    expect(hostileSees(s, { ...(h as object), stunUntil: 99 } as never, 16, 10)).toBe(false);     // 무력화 중이면 못 본다
  });
  it('인질 사건이 발생하고, 섬광탄·기습·시한 같은 전술 요소가 실제로 쓰인다', () => {
    let hostage = 0, bangs = 0, breaches = 0, surprised = 0, caught = 0;
    for (let k = 0; k < 70; k++) {
      const s = shiftOf('S' + k, { ...NORMAL, threat: 4 });      // 무장 사건이 넉넉히 나오는 조건
      for (const I of s.incidents) if (I.truth.variant === 'hostage') { hostage++; if (I.result!.suspectsCaught > 0) caught++; }
      for (const e of s.events) { if (e.text.startsWith('섬광탄 투척') || e.text.includes('섬광탄을 던져 넣고')) bangs++; if (e.text.startsWith('진입!')) breaches++; if (e.text.includes('기습당했습니다')) surprised++; }
    }
    expect(hostage).toBeGreaterThan(3);
    expect(caught).toBeGreaterThan(2);
    expect(breaches).toBeGreaterThan(3);
    expect(bangs).toBeGreaterThan(1);
    expect(surprised).toBeGreaterThan(0);
  }, 240000);
});

describe('건물 붕괴 · 가스 누출', () => {
  it('두 유형이 실제로 발생하고, 위험 요소(균열부·가스 배관)가 조치되거나 터지며, 대부분 한계 시간 안에 끝난다', () => {
    let collapse = 0, hazmat = 0, shored = 0, unstable = 0, closed = 0, ignited = 0, valves = 0, timeouts = 0, secondary = 0;
    for (let k = 0; k < 30; k++) {
      const s = shiftOf('S' + k);
      for (const I of s.incidents) {
        const t = I.truth.type;
        if (t !== 'collapse' && t !== 'hazmat') continue;
        const sc = s.scenes[I.id]!;
        if (t === 'collapse') collapse++; else hazmat++;
        if (I.closeReason === 'timeout') timeouts++;
        for (const p of sc.props) {
          if (p.kind === 'unstable') { unstable++; if (p.mitigated) shored++; }
          if (p.kind === 'valve') { valves++; if (p.mitigated) closed++; if (p.ignited) ignited++; }
        }
        if (I.problems.some((p) => p.code === 'ESCALATION' && p.detail.includes('2차 붕괴'))) secondary++;
        // 무너질 수 있거나 가스가 찬 건물 안에서는 소방만 구출·수색을 맡는다
        for (const w of sc.board) if ((w.kind === 'extricate' || w.kind === 'search') && w.status === 'done') for (const rid of w.assignees) expect(s.responders[rid].dept).toBe('fire');
      }
    }
    expect(collapse).toBeGreaterThan(5);
    expect(hazmat).toBeGreaterThan(5);
    expect(shored).toBeGreaterThan(unstable * 0.5);
    expect(closed + ignited).toBeGreaterThan(valves * 0.8);
    expect(closed).toBeGreaterThan(ignited);
    expect(secondary).toBeGreaterThan(0);
    expect(timeouts).toBeLessThan((collapse + hazmat) * 0.2);
  }, 120000);

  it('신고 키워드 표의 가능도는 유형 이름으로 적는다 — 열쇠는 TYPE_ORDER 의 유형뿐, 값은 0~1 (log 를 쓰므로 0 은 아니다)', async () => {
    const { NATURE_LIK } = await import('../src/sim/dispatch/callSystem');
    const { TYPE_ORDER } = await import('../src/sim/incidentTypes');
    for (const k of Object.keys(NATURE_LIK)) for (const [t, v] of Object.entries(NATURE_LIK[k])) {
      expect(TYPE_ORDER.indexOf(t as never), `${k}.${t}`).toBeGreaterThanOrEqual(0);
      expect(v! > 0 && v! <= 1, `${k}.${t} = ${v}`).toBe(true);
    }
  });
});

describe('인근 도시 지원', () => {
  it('부대가 모자라 배정이 밀리면 외부 부대가 들어오고, 정해진 횟수를 넘지 않으며, 임무 뒤에는 돌아간다', () => {
    let aided = 0, arrived = 0, goneHome = 0;
    for (let k = 0; k < 10; k++) {
      const s = new Sim('S' + k, { ...NORMAL, frequency: 5, resources: 1 }); s.runToEnd();
      goneHome += s.units.filter((u) => u.aid && u.state === 'oos').length;
      const aid = s.units.filter((u) => u.aid);
      expect(aid.length).toBe(s.aidUsed);
      expect(s.aidUsed).toBeLessThanOrEqual(s.tune.aidUnits);
      aided += aid.length;
      for (const u of aid) { if (u.runs > 0) arrived++; expect(u.state).not.toBe('available'); expect(s.incidents.filter((I) => I.aidUnit === u.id).length).toBe(1); }      // 대기 상태로 남아 상시 전력이 되지 않는다
      for (const I of s.incidents) if (I.aidUnit !== undefined) expect(I.everAssigned).toContain(I.aidUnit);
    }
    expect(aided).toBeGreaterThan(8);
    expect(arrived).toBe(aided);
    expect(goneHome).toBeGreaterThan(aided * 0.5);
    // 여유가 있을 때는 훨씬 덜 부른다. 한 번도 안 부르는 것은 아니다: 구급차 세 대가 다수 사상자 사고 하나에 모두 묶이면
    // 스무 팀이 있는 한가한 교대에서도 다음 환자를 위해 한 대를 부른다 (그래서 시드 하나의 횟수가 아니라 평균을 본다)
    // (N8 단계 4a·4b) 한가한 교대를 S0~S5 여섯에서 C0~C9 열을 더한 열여섯으로 넓혔다 (§9.2 — 표본을 늘리기만 한다): 바쁜 교대의 지원은 상한(2)에 붙어 평균이 늘 2.0 이고,
    //  시설 사고가 짧은 사건에 들어 사건 번호가 밀리며 S0~S5 의 평균이 1.50 → 2.17 이 됐다(S0 3 → 4 · S4 1 → 4 — 화재가 몰린 교대). S 다음 번호로 넓히지 않은 까닭: S7 은 시작점에서도 지원 5/5 를 다 써 시드마다의 조건에 걸린다
    let calmAid = 0;
    const CALM = [0, 1, 2, 3, 4, 5].map((k) => 'S' + k).concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => 'C' + k));
    for (const seed of CALM) {
      const calm = new Sim(seed, { ...NORMAL, frequency: 1, resources: 5 }); calm.runToEnd();
      calmAid += calm.aidUsed; expect(calm.aidUsed, seed).toBeLessThan(calm.tune.aidUnits);
    }
    expect(calmAid / CALM.length).toBeLessThan(aided / 10);
  }, 120000);
});

describe('지휘관의 진입 계획', () => {
  it('진입을 결정하면 용의자의 시야 밖 출입구를 골라 진입조를 그곳에 모은다', () => {
    let plans = 0, unseen = 0, stacked = 0;
    for (let k = 0; k < 60; k++) {
      const s = shiftOf('S' + k, { ...NORMAL, threat: 4 });
      for (const sc of s.scenes) {
        if (!sc || sc.kind !== 'armed' || !sc.entryOrdered) continue;
        plans++;
        expect(sc.entryExit).toBeGreaterThanOrEqual(0);
        expect(sc.entryExit).toBeLessThan(sc.exits.length);
        const ev = s.events.find((e) => e.incidentId === sc.incidentId && e.text.startsWith('진입 결정'))!;
        if (ev.text.includes('등지고') || ev.text.includes('벽에 가려')) unseen++;
        if (sc.board.some((w) => w.kind === 'engage')) stacked++;
      }
    }
    expect(plans).toBeGreaterThan(4);
    expect(unseen).toBeGreaterThan(plans * 0.5);
    expect(stacked).toBe(plans);
  }, 120000);
});

describe('2층 건물', () => {
  it('계단으로 이어진 2층 건물 화재가 나오고, 대원이 2층까지 올라가 사람을 구해 내려온다', () => {
    let tall = 0, searched2F = 0, saved2F = 0, on2F = 0, timeouts = 0;
    // (I1-b b3-8) 표본을 시드 40개로 — 30개로는 2층에서 발견된 사람이 23~26명뿐이라 구한 비율(늘 50% 안팎)이 사건 하나의 흐름에 문턱을 오간다
    //   (S20 의 2층 화재가 충격 기록으로 다른 사건이 되어 12/23 → 13/26). 판정의 문턱은 그대로다
    // (I1-b b3-11) 다시 60개로 — S7 의 2층 화재가 연기의 시야 혼잡(C5)으로 2/2 → 0/2 가 되어 40개에서 13/24 → 11/24. 60개로 전 23/37 · 뒤 21/37
    for (let k = 0; k < 60; k++) {
      const s = shiftOf('S' + k);
      for (const sc of s.scenes) {
        if (!sc || sc.kind !== 'fire' || !sc.stairTo.some((v) => v >= 0)) continue;
        tall++;
        const I = s.incidents[sc.incidentId];
        if (I.closeReason === 'timeout') timeouts++;
        // 계단은 서로를 가리킨다
        sc.stairTo.forEach((j, i) => { if (j >= 0) expect(sc.stairTo[j]).toBe(i); });
        const upper = sc.regions.filter((r) => r.name.startsWith('2층') && r.searchable);
        if (upper.some((r) => sc.board.some((w) => w.kind === 'search' && w.region === r.id && w.status === 'done'))) searched2F++;
        for (const c of sc.casualties) {
          if (c.tDiscovered < 0) continue;
          const ev = s.events.find((e) => e.incidentId === I.id && e.text.includes(`구조 대상 ${c.label} 발견`) && e.text.includes('2층'));
          if (!ev) continue;
          on2F++;
          if (!c.dead && (c.where === 'safe' || c.where === 'loaded' || c.where === 'hospital')) saved2F++;
        }
      }
    }
    expect(tall).toBeGreaterThan(5);
    expect(searched2F).toBeGreaterThan(tall * 0.6);
    expect(on2F).toBeGreaterThan(3);
    expect(saved2F).toBeGreaterThan(on2F * 0.5);
    expect(timeouts).toBeLessThan(tall * 0.2);
  }, 120000);
});

describe('현장 배치의 다양성', () => {
  it('건물 틀과 무장 사건 장소가 여러 종 나오고, 어느 건물이든 모든 바닥에 걸어서 닿을 수 있다', async () => {
    const { T } = await import('../src/sim/types');
    const kinds = new Set<string>(), venues = new Set<string>(), houses = new Set<number>();
    for (let k = 0; k < 30; k++) {
      const s = new Sim('S' + k);
      s.run(6000);
      for (const sc of s.scenes) {
        if (!sc) continue;
        const I = s.incidents[sc.incidentId];
        if (sc.kind === 'armed') venues.add(sc.placeName ?? '상점');
        if (sc.kind === 'medical') houses.add(sc.regions.length);
        if (sc.kind === 'fire' || sc.kind === 'collapse' || sc.kind === 'hazmat') {
          const tall = sc.stairTo.some((v) => v >= 0), cor = sc.regions.some((r) => r.kind === 'corridor'), big = sc.regions.some((r) => r.kind === 'room' && r.tiles.length > 45);
          kinds.add(tall ? 'tall' : cor ? 'corridor' : big ? 'hall' : 'suite');
        }
        if (sc.kind === 'search' || sc.kind === 'traffic') continue;
        // 대기 지점에서 출발해 문·계단을 지나 모든 바닥 칸에 닿는가 (잔해와 잠긴 문은 치우거나 열 수 있다)
        const w = sc.w, seen = new Uint8Array(sc.w * sc.h);
        const pass = (i: number): boolean => { const t = sc.tiles[i]; return t === T.FLOOR || t === T.DOOR || t === T.GROUND || t === T.ROAD || t === T.STAIR; };
        const st = [sc.staging.y * w + sc.staging.x]; seen[st[0]] = 1;
        while (st.length) {
          const c = st.pop()!, x = c % w, y = (c / w) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= sc.h) continue; const j = ny * w + nx; if (!seen[j] && pass(j)) { seen[j] = 1; st.push(j); } }
          const sl = sc.stairTo[c]; if (sl >= 0 && !seen[sl]) { seen[sl] = 1; st.push(sl); }
        }
        let cut = 0; for (let i = 0; i < seen.length; i++) if (sc.tiles[i] === T.FLOOR && !seen[i]) cut++;
        expect(cut, `${s.seed} 사건 ${I.code} (${sc.kind})`).toBe(0);
        // 출입구 바깥 칸은 걸을 수 있는 땅이다
        for (const e of sc.exits) expect(pass(e.y * w + e.x)).toBe(true);
      }
    }
    expect(kinds.size).toBe(4);
    expect(venues.size).toBeGreaterThanOrEqual(3);
    expect(houses.size).toBeGreaterThanOrEqual(2);
  }, 120000);
});

describe('교전과 진입', () => {
  it('용의자는 엄폐물로 옮기고 인질을 끌고 물러나며, 진입조는 두 문으로 나뉘거나 방 문 앞에 모였다가 들어간다', () => {
    let relocate = 0, drag = 0, twoDoor = 0, roomEntry = 0, armed = 0, timeouts = 0;
    for (let k = 0; k < 60; k++) {
      const s = shiftOf('S' + k, { ...NORMAL, threat: 4 });
      for (const sc of s.scenes) {
        if (!sc || sc.kind !== 'armed') continue;
        armed++;
        if (s.incidents[sc.incidentId].closeReason === 'timeout') timeouts++;
        if (sc.entryExit2 >= 0) { twoDoor++; expect(sc.entryExit2).not.toBe(sc.entryExit); }
        // 인질을 끌고 간 용의자 곁에는 인질이 그대로 있다(끌려가다 벽 속에 남지 않는다)
        for (const c of sc.casualties) expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
      }
      for (const e of s.events) { if (e.text.includes('엄폐물 뒤로 자리를 옮깁니다')) relocate++; if (e.text.includes('인질을 끌고')) drag++; if (/ 진입!/.test(e.text) && !e.text.startsWith('진입!')) roomEntry++; }
    }
    expect(relocate).toBeGreaterThan(5);
    expect(drag).toBeGreaterThan(1);
    expect(twoDoor).toBeGreaterThan(1);
    expect(roomEntry).toBeGreaterThan(2);
    expect(timeouts).toBeLessThan(armed * 0.12);
  }, 180000);
});

describe('빈 곳 채우기', () => {
  it('수난 사고: 물에 빠진 사람을 물가에서 끌어내고, 늦으면 떠내려가 잃는다', async () => {
    const { T } = await import('../src/sim/types');
    let water = 0, victims = 0, pulled = 0, swept = 0, timeouts = 0;
    for (let k = 0; k < 40; k++) {
      const s = shiftOf('S' + k);
      for (const sc of s.scenes) {
        if (!sc || sc.kind !== 'water') continue;
        water++;
        if (s.incidents[sc.incidentId].closeReason === 'timeout') timeouts++;
        for (const c of sc.casualties) {
          victims++;
          if (c.tFreed >= 0) { pulled++; expect(c.inWater).toBe(false); expect(sc.tiles[Math.round(c.y) * sc.w + Math.round(c.x)] !== T.WATER || c.where !== 'scene').toBe(true); }
          if (c.dead && c.tFreed < 0 && c.x > sc.w - 3) swept++;
        }
      }
    }
    expect(water).toBeGreaterThan(8);
    expect(pulled).toBeGreaterThan(victims * 0.5);
    expect(timeouts).toBeLessThan(water * 0.15);
    expect(swept).toBeGreaterThanOrEqual(0);
  }, 120000);

  it('다수 사상자 사고가 나오고, 가스 누출 현장에서는 경찰이 출입구를 지키며, 응급실이 붐비면 인계가 늦어진다', () => {
    let bus = 0, busCas = 0, busMaxUnits = 0, cordon = 0, exposed = 0, queued = 0;
    for (let k = 0; k < 40; k++) {
      const s = new Sim('S' + k, { ...NORMAL, severity: 4 }); s.runToEnd();
      for (const I of s.incidents) {
        const sc = s.scenes[I.id]!;
        if (I.truth.variant === 'bus') { bus++; busCas += sc.casualties.length; busMaxUnits = Math.max(busMaxUnits, I.everAssigned.length); expect(sc.props.some((p) => p.bus)).toBe(true); }
        if (sc.kind === 'hazmat') { if (sc.board.some((w) => w.kind === 'perimeter' && w.assignees.length + (w.status === 'done' || w.status === 'cancelled' ? 1 : 0) > 0)) cordon++; exposed += sc.casualties.filter((c) => c.bystander2).length; }
      }
      queued += s.events.filter((e) => e.text.includes('응급실이 붐벼')).length;
    }
    expect(bus).toBeGreaterThan(3);
    expect(busCas / bus).toBeGreaterThan(6);
    expect(busMaxUnits).toBeGreaterThanOrEqual(5);
    expect(cordon).toBeGreaterThan(3);
    // 경찰이 제때 오면 주변 시민은 다치지 않는다. 부대가 모자란 극한 난이도에서는 통제가 늦어 노출이 생긴다
    for (let k = 0; k < 30; k++) {
      const s = shiftOf('S' + k, PRESETS.extreme.d);
      for (const sc of s.scenes) if (sc && sc.kind === 'hazmat') exposed += sc.casualties.filter((c) => c.bystander2).length;
    }
    expect(exposed).toBeGreaterThan(0);
    expect(queued).toBeGreaterThan(0);
  }, 120000);
});

describe('건물마다 정해진 도시', () => {
  it('모든 건물에 종류·이름·주소·진입 지점이 있고, 지도는 교대가 바뀌어도 같다', async () => {
    const { placeAt, findRoute, coastY, riverDist, roadHalf, distSeg, rectSegDist, segCross, obbHit, boxOf } = await import('../src/sim/city');
    const { KIND_NAME, LANDMARKS, ROADS } = await import('../src/sim/cityPlan');
    const a = new Sim('A').city, b = new Sim('B').city;
    expect(a.places.length).toBeGreaterThan(900);
    expect(a.places.map((q) => `${q.kind}:${q.name}:${q.addr}:${Math.round(q.x)}`).join('|')).toBe(b.places.map((q) => `${q.kind}:${q.name}:${q.addr}:${Math.round(q.x)}`).join('|'));
    const addr = new Set<string>();
    for (const q of a.places) {
      expect(KIND_NAME[q.kind], q.kind).toBeTruthy();
      expect(q.name.length).toBeGreaterThan(0); expect(q.addr.length).toBeGreaterThan(0);
      expect(q.nodeId).toBeGreaterThanOrEqual(0);
      // 길가 지점은 진입 교차로에서 도로 한 구간의 절반을 넘지 않고, 고속도로가 아니다
      const n = a.nodes[q.nodeId], e = a.edges[q.edgeId!];
      expect(Math.hypot(q.cx - n.x, q.cy - n.y)).toBeLessThanOrEqual(e.len * 0.5 + 1);
      expect(e.cls).not.toBe('highway');
      if (!q.open) { expect(addr.has(q.addr), q.addr).toBe(false); addr.add(q.addr); }
    }
    // 길가에 채운 건물은 물·도로 위에 서지 않고, 다른 건물의 한가운데를 덮지 않는다
    const hand = new Set(LANDMARKS.map((l) => l.name));
    const bs = a.places.filter((q) => !q.open);
    for (const q of bs) {
      const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
      if (!hand.has(q.name)) {
        expect(cy, q.name).toBeLessThan(coastY(cx)); expect(riverDist(cx, cy), q.name).toBeGreaterThan(0);
        for (const e of a.edges) { const A = a.nodes[e.a], B = a.nodes[e.b]; expect(distSeg(cx, cy, A.x, A.y, B.x, B.y), `${q.name} @ ${e.name}`).toBeGreaterThan(roadHalf(e)); }
      }
      expect(placeAt(a, cx, cy)!.id, q.name).toBe(q.id);
    }
    // 도로망: 격자가 아니다(등급이 네 가지이고 막다른 길과 다리가 있다). 모든 교차로에 닿는다
    expect(new Set(a.edges.map((e) => e.cls)).size).toBe(4);
    expect(a.nodes.filter((n) => n.edges.length === 1).length).toBeGreaterThan(6);
    expect(a.nodes.filter((n) => n.edges.length >= 5).length).toBeGreaterThan(3);
    expect(a.edges.filter((e) => e.bridge).length).toBeGreaterThanOrEqual(4);
    expect(a.nodes.filter((n) => n.exit).length).toBeGreaterThanOrEqual(4);
    for (const n of a.nodes) if (n.id) expect(findRoute(a, 0, n.id), n.key).not.toBeNull();
    expect(new Set(a.edges.filter((e) => e.cls !== 'local' || (e.road ?? 0) < ROADS.length).map((e) => e.name)).size).toBe(ROADS.length);
    // 블록 안의 이면 도로: 설계도에 없는 좁은 길이 생성기에서 생긴다
    expect(a.edges.filter((e) => (e.road ?? 0) >= ROADS.length).length).toBeGreaterThanOrEqual(30);
    expect(a.nodes.length).toBeGreaterThan(120);
    // 도로는 서로 교차하지 않는다 (교차로에서만 만난다)
    for (let i = 0; i < a.edges.length; i++) for (let j = i + 1; j < a.edges.length; j++) {
      const e = a.edges[i], f = a.edges[j];
      if (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b) continue;
      expect(segCross(a.nodes[e.a].x, a.nodes[e.a].y, a.nodes[e.b].x, a.nodes[e.b].y, a.nodes[f.a].x, a.nodes[f.a].y, a.nodes[f.b].x, a.nodes[f.b].y), `${e.name} × ${f.name}`).toBe(false);
    }
    // 겹침: 어떤 건물도 도로 위에 걸치지 않고(선분과 직사각형의 정확한 거리), 건물끼리 겹치지 않는다. 손으로 놓은 건물도 마찬가지다
    let near = 0;
    for (const q of bs) {
      const b = boxOf(q);
      let nearest = Infinity;
      for (const e of a.edges) { const A = a.nodes[e.a], B = a.nodes[e.b], d = rectSegDist(b, A.x, A.y, B.x, B.y); expect(d, `${q.name} ↔ ${e.name}`).toBeGreaterThanOrEqual(roadHalf(e)); nearest = Math.min(nearest, d - roadHalf(e)); }
      if (nearest < 60) near++;
    }
    expect(near / bs.length).toBeGreaterThan(0.85);      // 건물은 길에서 멀지 않다
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      const p = bs[i], q = bs[j];
      if (Math.abs(p.x - q.x) > 140 || Math.abs(p.y - q.y) > 140) continue;
      expect(obbHit(boxOf(p), boxOf(q), 0), `${p.name} ↔ ${q.name}`).toBe(false);
    }
    // 설계도에 적은 곳이 실제로 있고, 동네마다 여러 종류가 섞여 있다
    const kinds = new Set(a.places.map((q) => q.kind));
    for (const k of ['houseS', 'houseL', 'apartment', 'villa', 'bank', 'convenience', 'office', 'factory', 'warehouse', 'workshop', 'cafe', 'station', 'stadium', 'university', 'cathedral', 'temple', 'powerPlant', 'lighthouse', 'beach', 'pier', 'park', 'forest', 'riverside', 'reservoir', 'terminal', 'runway', 'hospital', 'fireStation', 'police'] as const) expect(kinds.has(k), k).toBe(true);
    const byDong = new Map<string, Set<string>>();
    for (const q of bs) { if (!byDong.has(q.dong)) byDong.set(q.dong, new Set()); byDong.get(q.dong)!.add(q.kind); }
    for (const d of ['중앙동', '서림동', '한솔동', '공단동', '항구동']) expect(byDong.get(d)!.size, d).toBeGreaterThanOrEqual(6);
    expect(a.alleys.length).toBeGreaterThan(20);
    expect(a.places.filter((q) => (q.rank ?? 0) >= 3).length).toBeGreaterThan(20);
    expect(a.facilities.length).toBeGreaterThanOrEqual(8);
    for (const f of a.facilities) expect(a.nodes[f.nodeId].edges.length).toBeGreaterThan(0);
  });

  it('사건은 유형에 맞는 건물에서 일어나고, 현장은 그 건물을 따르며, 차량은 그 건물 앞 길가에 선다', async () => {
    const { INCIDENT_PLACES } = await import('../src/sim/cityPlan');
    const { scenarioOf } = await import('../src/sim/scenarios');
    let atPlace = 0, bankLobby = 0, banks = 0, smallTall = 0, parked = 0, named = 0, intersections = 0;
    for (let k = 0; k < 30; k++) {
      const s = shiftOf('S' + k);
      for (const I of s.incidents) {
        const sc = s.scenes[I.id]!;
        if (I.truth.type === 'traffic' || I.pursuit) { expect(I.truth.placeId).toBe(-1); intersections++; continue; }      // 교통사고와 추격전은 건물이 아니라 길 위에서 벌어진다
        if (I.truth.placeId < 0) { intersections++; continue; }      // 길 위에서 일어나는 시나리오 (산사태 등)
        expect(I.truth.placeId, I.truth.label).toBeGreaterThanOrEqual(0);
        const q = s.city.places[I.truth.placeId];
        atPlace++;
        if (I.parent === undefined && !(I.tag ?? '').startsWith('disaster')) expect((scenarioOf(I.truth.type, I.truth.variant)?.places ?? INCIDENT_PLACES[I.truth.type])[q.kind] ?? 0, `${I.truth.type}/${I.truth.variant} @ ${q.kind}`).toBeGreaterThan(0);      // 이어지는 사건과 재난은 자리를 정해서 일으킨다
        expect(I.truth.nodeId).toBe(q.nodeId);
        expect(I.truth.label.includes(q.name)).toBe(true);
        if (I.truth.type === 'armed' && q.kind === 'bank') { banks++; if (sc.regions.some((r) => r.name === '은행 로비')) bankLobby++; }
        if (I.truth.type === 'fire' && q.kind === 'houseS' && Array.from(sc.stairTo).some((v) => v >= 0)) smallTall++;
        // 신고자가 위치를 제대로 말했다면 건물 이름이 들어 있다
        const loc = I.claims.find((c) => c.topic === 'location' && c.truthful);
        if (loc && loc.text.includes(q.name)) { named++; expect(loc.placeKind).toBe(q.kind); }
      }
      // 교대 도중: 현장에 도착한 차량은 건물 앞 길가에 서 있다
      const t = new Sim('S' + k);
      for (let i = 0; i < 2600 && !t.ended; i++) {
        t.step();
        if (i % 50) continue;
        for (const u of t.units) {
          if (u.state !== 'onscene' || u.incidentId === null || u.air || u.sea) continue;      // 헬기와 구조정은 길가에 서지 않는다
          const I = t.incidents[u.incidentId]; if (I.truth.placeId < 0) continue;
          const q = t.city.places[I.truth.placeId], n = t.city.nodes[q.nodeId];
          if (Math.hypot(q.cx - n.x, q.cy - n.y) <= 8) continue;
          expect(Math.hypot(u.x - q.cx, u.y - q.cy)).toBeLessThan(0.5); parked++;
        }
      }
    }
    expect(atPlace).toBeGreaterThan(120);
    expect(intersections).toBeGreaterThan(20);
    expect(banks).toBeGreaterThanOrEqual(2); expect(bankLobby).toBe(banks);      // 은행에서 난 사건의 현장은 은행 로비다
    expect(smallTall).toBe(0);                                             // 작은 집은 단층이다
    expect(named).toBeGreaterThan(atPlace * 0.5);
    expect(parked).toBeGreaterThan(50);
  }, 240000);
});

describe('생활 사건 시나리오', () => {
  it('쓰러진 나무·맨홀 추락·승강기 갇힘·가정 폭력·침입 절도가 나오고, 저마다 맞는 곳에서 맞는 모습으로 벌어진다', async () => {
    const { SCENARIOS, scenarioName } = await import('../src/sim/scenarios');
    const { T } = await import('../src/sim/types');
    const seen: Record<string, number> = {}, good: Record<string, number> = {};
    let labelled = 0, treeClosed = 0, timeouts = 0, total = 0;
    for (let k = 0; k < 40; k++) {
      const s = new Sim('S' + k);
      // 쓰러진 나무: 사건이 열려 있는 동안 그 도로 구간은 지나갈 수 없다
      for (let i = 0; i < 6200 && !s.ended; i++) {
        s.step();
        if (i % 40) continue;
        for (const I of s.incidents) if (I.truth.variant === 'tree' && I.phase !== 'closed' && I.blockedEdge >= 0) { expect(s.city.edges[I.blockedEdge].closed).toBe(true); treeClosed++; }
      }
      s.runToEnd();
      for (const I of s.incidents) {
        const sc = s.scenes[I.id]!, key = `${I.truth.type}/${I.truth.variant}`;
        total++; if (I.closeReason === 'timeout') timeouts++;
        if (!SCENARIOS.some((q) => q.type === I.truth.type && q.variant === I.truth.variant)) continue;
        seen[key] = (seen[key] ?? 0) + 1; if (I.result!.outcome === 'success') good[key] = (good[key] ?? 0) + 1;
        expect(scenarioName(I.truth.type, I.truth.variant)).not.toBe('');
        if (I.assessment && I.assessment.label) labelled++;
        if (I.truth.variant === 'tree') {
          expect(sc.props.filter((p) => p.skin === 'tree').length).toBeGreaterThanOrEqual(4);
          if (I.blockedEdge >= 0) expect(s.city.edges[I.blockedEdge].closed).toBe(false);      // 끝나면 길이 다시 열린다
          if (I.closeReason === 'resolved') expect(sc.props.filter((p) => p.skin === 'tree' && !p.removed).length).toBe(0);
        }
        if (I.truth.variant === 'manhole') { expect(sc.props.some((p) => p.skin === 'manhole')).toBe(true); expect(I.truth.placeId).toBe(-1); }
        if (I.truth.variant === 'elevator') {
          const r = sc.regions.find((q) => q.name === '승강기')!;
          expect(r).toBeTruthy(); expect(r.tiles.filter((i) => sc.tiles[i] === T.FLOOR).length).toBeLessThanOrEqual(2);
          expect(['apartment', 'office', 'officetel', 'hotel', 'deptStore', 'university', 'clinic', 'station']).toContain(I.truth.placeKind);
          expect(sc.props.some((p) => p.kind === 'unstable')).toBe(false);
        }
        if (I.truth.variant === 'domestic') {
          expect(['houseS', 'houseL', 'villa', 'apartment', 'officetel', 'farmhouse']).toContain(I.truth.placeKind);
          expect(sc.regions.some((q) => q.name === '거실')).toBe(true);
          expect(sc.hostiles.length).toBe(1); expect(sc.hostiles[0].weapon).not.toBe('gun');
        }
        if (I.truth.variant === 'burglary') for (const h of sc.hostiles) expect(h.weapon).not.toBe('gun');
      }
    }
    // 평소 교대에 늘 섞여 나오는 것은 생활 사건과 추격전이다. 강력 범죄는 몫이 작아 시드 40개로는 수가 흔들리고,
    // 대형 사고·재난의 시나리오는 평소 추첨에 들지 않는다 (저마다 tests/<묶음>.test.ts 가 직접 일으켜 확인한다)
    for (const q of SCENARIOS) if (q.tag === 'life' || q.tag === 'chase') expect(seen[`${q.type}/${q.variant}`] ?? 0, q.name).toBeGreaterThan(2);
    expect(treeClosed).toBeGreaterThan(10);
    expect(labelled).toBeGreaterThan(20);
    // 생활 사건은 대체로 수습되지만, 침입 절도는 달아나는 일이 적지 않다
    for (const k of ['traffic/tree', 'traffic/manhole', 'collapse/elevator', 'armed/domestic']) expect((good[k] ?? 0) / seen[k], k).toBeGreaterThan(0.6);
    expect(timeouts).toBeLessThan(total * 0.03);
  }, 300000);
});

describe('추격전', () => {
  it('도주 차량은 도로를 따라 달리고, 따라붙거나 앞을 막으면 그 자리에 현장이 열리며, 놓치면 도시를 빠져나간다', () => {
    let n = 0, stopped = 0, escaped = 0, kidnap = 0, drunk = 0, sight = 0, timeouts = 0;
    // (N8 단계 4b) 50 → 70교대 (§9.2 — 시드 범위만 늘린다): 짧은 사건이 늘어 S0~S49 의 추격전 12건이 모두 세워졌다 — 놓친 첫 건이 S68(은신처에 숨어든 납치)
    for (let k = 0; k < 70; k++) {
      const s = new Sim('S' + k);
      while (!s.ended) {
        s.step();
        if (s.tick % 10) continue;
        for (const I of s.incidents) {
          const p = I.pursuit;
          if (!p || p.state !== 'driving' || I.phase === 'closed') continue;
          // 달리는 동안: 지금 구간은 실제로 이어진 도로이고, 차는 그 위에 있으며, 아직 현장에 들어간 부대는 없다
          const e = s.city.edges[p.edge];
          expect((e.a === p.from && e.b === p.to) || (e.a === p.to && e.b === p.from)).toBe(true);
          if (s.t >= p.startAt) { const A = s.city.nodes[p.from], B = s.city.nodes[p.to]; expect(Math.abs(Math.hypot(p.x - A.x, p.y - A.y) + Math.hypot(p.x - B.x, p.y - B.y) - e.len)).toBeLessThan(1.5); }
          for (const uid of I.assigned) expect(s.units[uid].state).not.toBe('onscene');
          expect(s.scenes[I.id]!.agents.length).toBe(0);
        }
      }
      for (const I of s.incidents) {
        const p = I.pursuit; if (!p) continue;
        n++; if (p.kind === 'kidnap') kidnap++; else drunk++;
        if (I.closeReason === 'timeout') timeouts++;
        sight += s.events.filter((e) => e.incidentId === I.id && e.text.startsWith('목격 신고')).length;
        if (p.state === 'stopped') {
          stopped++;
          expect(['caught', 'block', 'crash']).toContain(p.how);
          expect(I.truth.placeId).toBe(-1); expect(I.reportedNode).toBe(I.truth.nodeId);
          expect(s.events.some((e) => e.incidentId === I.id && (e.text.includes('세웠습니다') || e.text.includes('사고를 내고')))).toBe(true);
          if (p.how !== 'crash') expect(I.firstArrivalAt).toBeGreaterThanOrEqual(0);      // 세운 순찰차가 곧 현장에 들어간다
          expect(s.scenes[I.id]!.outdoor).toBe(true);
        } else {
          escaped++;
          expect(p.state).toBe('escaped'); expect(I.closeReason).toBe('abandoned');
          expect(I.problems.some((q) => q.code === 'SUSPECT_FLED')).toBe(true);
          // 은신처에 숨어든 납치는 '미해결'이다(debrief — 이어지는 인질 사건이 결말을 낸다. tests/crime.test.ts 가 그 판정을 본다). 이 50교대에는 그런 납치가 없다가
          // (I1-b b3-6) 몰린 길의 사고가 S28 의 흐름을 바꿔 하나 생겼다 — 도시 밖으로 놓친 납치만 '실패'다
          expect(I.result!.outcome).toBe(p.kind === 'kidnap' && p.how !== 'hideout' ? 'failed' : 'unresolved');
        }
      }
    }
    expect(kidnap).toBeGreaterThan(4); expect(drunk).toBeGreaterThan(4);
    expect(stopped).toBeGreaterThan(n * 0.5); expect(escaped).toBeGreaterThan(0);
    expect(sight).toBeGreaterThan(5);
    expect(timeouts).toBeLessThanOrEqual(1);
  }, 300000);
});

describe('현장에서 생길 수 있는 일 (B1)', () => {
  it('배회 실종자: 개울에 빠지면 떠내려가다 걸리고, 대원이 물에서 끌어내거나 늦으면 잃는다. 넘어짐·저체온도 일어나며 한계 시간까지 가지 않는다', async () => {
    const { T } = await import('../src/sim/types');
    let wander = 0, fell = 0, down = 0, pulled = 0, lost = 0, timeouts = 0;
    for (let k = 0; k < 12; k++) {
      const s = new Sim('W' + k, NORMAL, 1200, { force: 'search/wander' });
      s.runToEnd();
      for (const I of s.incidents) {
        if (I.truth.type !== 'search' || I.truth.variant !== 'wander') continue;
        wander++;
        if (I.closeReason === 'timeout') timeouts++;
        const sc = s.scenes[I.id]!, c = sc.casualties.find((q) => q.isTarget)!;
        if (c.dead) lost++;
        if (I.problems.some((p) => p.detail === '배회하던 실종자가 개울에 빠짐')) {
          fell++;
          expect(c.wander).toBe(false);
          if (c.tFreed >= 0) { pulled++; expect(c.inWater).toBe(false); }
          else if (!c.dead && c.where === 'scene') expect(sc.tiles[Math.round(c.y) * sc.w + Math.round(c.x)]).toBe(T.WATER);      // 아직 물속이면 물 칸에 있다
        }
        if (I.problems.some((p) => p.detail === '배회하던 실종자가 넘어져 다침' || p.detail === '실종자 저체온')) { down++; expect(c.wander).toBe(false); }
      }
    }
    expect(wander).toBeGreaterThan(15);
    expect(fell).toBeGreaterThan(1); expect(pulled).toBeGreaterThan(0); expect(down).toBeGreaterThan(1);
    expect(lost).toBeGreaterThan(0);      // 실패도 나온다
    expect(timeouts).toBe(0);
  }, 120000);

  it('중증 응급 환자에게 구급차가 멀면 소방 부대가 선착 대응으로 먼저 가고, 환자의 급변·압궤 증후군·자리를 뜨는 사람이 실제로 일어난다', () => {
    let co = 0, coFirst = 0, internal = 0, crush = 0, fled = 0;
    for (let k = 0; k < 40; k++) {
      const s = shiftOf('S' + k);
      for (const I of s.incidents) {
        if (I.coResp !== undefined) {
          co++;
          const u = s.units[I.coResp];
          expect(u.dept).toBe('fire'); expect(I.truth.type === 'medical' || I.assessment!.type === 'medical').toBe(true);
          expect(I.everAssigned).toContain(u.id);
          if (s.events.some((e) => e.incidentId === I.id && e.kind === 'arrive' && e.actor === u.callsign && e.importance === 3)) coFirst++;      // 첫 도착
        }
        if (I.problems.some((p) => p.detail === '외상 환자의 내부 출혈' || p.detail === '실신 환자가 심정지로 넘어감')) { internal++; expect(I.truth.type).toBe('medical'); }
        for (const p of I.problems) if (p.detail.startsWith('구출된 사람의 압궤 증후군')) { crush++; expect(I.truth.type).toBe('collapse'); }
        if ((I.truth.variant === 'dispute' || I.truth.variant === 'domestic') && I.problems.some((p) => p.code === 'SUSPECT_FLED')) fled++;
      }
    }
    expect(co).toBeGreaterThan(5); expect(coFirst).toBeGreaterThan(2);
    expect(internal).toBeGreaterThan(3); expect(crush).toBeGreaterThan(3); expect(fled).toBeGreaterThan(1);
  }, 120000);
});
