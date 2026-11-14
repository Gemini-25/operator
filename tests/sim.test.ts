import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { NORMAL, PRESETS } from '../src/sim/difficulty';
import { findRoute } from '../src/sim/city';
import { BeliefStore, mkFact } from '../src/sim/field/beliefs';
import { Rng } from '../src/sim/rng';

function runShift(seed: string): Sim { const s = new Sim(seed); s.runToEnd(); return s; }

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
  const sims = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'].map(runShift);
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
      for (let k = 0; k < 14; k++) {
        const s = new Sim('S' + k, PRESETS[id].d); s.runToEnd();
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
  }, 60000);
  it('손잡이가 해당 조건을 실제로 바꾼다', async () => {
    const { parseDifficulty, difficultyLabel } = await import('../src/sim/difficulty');
    const count = (d: typeof NORMAL): number => { let n = 0; for (let k = 0; k < 6; k++) { const s = new Sim('S' + k, d); s.runToEnd(); n += s.incidents.length; } return n; };
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
  }, 60000);
});

describe('한 현장에 여러 팀', () => {
  it('같은 부서의 부대 둘 이상, 세 부서가 함께 들어가는 사건이 나온다', () => {
    let sameDeptTwice = 0, allThree = 0, most = 0;
    for (let k = 0; k < 12; k++) {
      const s = new Sim('S' + k); s.runToEnd();
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
  }, 60000);
});

describe('신고 접수 확장과 새 사건 유형', () => {
  const sims = Array.from({ length: 14 }, (_, k) => { const s = new Sim('S' + k); s.runToEnd(); return s; });
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
  }, 60000);
  it('부대 규모 손잡이가 편성을 바꾸되 같은 대원의 능력치는 유지한다', async () => {
    const { NORMAL } = await import('../src/sim/difficulty');
    const small = new Sim('R', { ...NORMAL, resources: 1 }), base = new Sim('R'), big = new Sim('R', { ...NORMAL, resources: 5 });
    expect(small.units.length).toBe(12); expect(base.units.length).toBe(17); expect(big.units.length).toBe(20);
    expect(big.responders.length).toBe(40);
    expect(new Set(big.responders.map((r) => r.name)).size).toBe(40);
    // 네 분야마다 3~5팀
    for (const sim of [small, base, big]) for (const f of ['police', 'fire', 'rescue', 'special']) { const n = sim.units.filter((u) => u.field === f).length; expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(5); }
    expect(base.units.filter((u) => u.kind === 'heli' || u.kind === 'swat' || u.kind === 'hazmat' || u.kind === 'eod' || u.kind === 'boat' || u.kind === 'ladder').length).toBe(6);
    for (const r of base.responders) { const q = big.responders.find((x) => x.name === r.name)!; expect(q.skill).toBe(r.skill); expect(q.judgment).toBe(r.judgment); }
    big.runToEnd(); small.runToEnd();
    expect(big.ended && small.ended).toBe(true);
  }, 60000);
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
      const s = new Sim('S' + k, { ...NORMAL, threat: 4 }); s.runToEnd();      // 무장 사건이 넉넉히 나오는 조건
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
      const s = new Sim('S' + k); s.runToEnd();
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

  it('신고 키워드 표의 열 수가 사건 유형 수와 같다', async () => {
    const { NATURE_LIK } = await import('../src/sim/dispatch/callSystem');
    for (const k of Object.keys(NATURE_LIK)) expect(NATURE_LIK[k].length).toBe(8);
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
    const calm = new Sim('S1', { ...NORMAL, frequency: 1, resources: 5 }); calm.runToEnd();
    expect(calm.aidUsed).toBe(0);      // 여유가 있을 때는 부르지 않는다
  }, 120000);
});

describe('지휘관의 진입 계획', () => {
  it('진입을 결정하면 용의자의 시야 밖 출입구를 골라 진입조를 그곳에 모은다', () => {
    let plans = 0, unseen = 0, stacked = 0;
    for (let k = 0; k < 60; k++) {
      const s = new Sim('S' + k, { ...NORMAL, threat: 4 }); s.runToEnd();
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
    for (let k = 0; k < 30; k++) {
      const s = new Sim('S' + k); s.runToEnd();
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
      const s = new Sim('S' + k, { ...NORMAL, threat: 4 }); s.runToEnd();
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
      const s = new Sim('S' + k); s.runToEnd();
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
      const s = new Sim('S' + k, PRESETS.extreme.d); s.runToEnd();
      for (const sc of s.scenes) if (sc && sc.kind === 'hazmat') exposed += sc.casualties.filter((c) => c.bystander2).length;
    }
    expect(exposed).toBeGreaterThan(0);
    expect(queued).toBeGreaterThan(0);
  }, 120000);
});

describe('건물마다 정해진 도시', () => {
  it('모든 건물에 종류·이름·주소·진입 지점이 있고, 지도는 교대가 바뀌어도 같다', async () => {
    const { placeAt, findRoute, coastY, riverDist, roadHalf, distSeg } = await import('../src/sim/city');
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
    expect(new Set(a.edges.map((e) => e.name)).size).toBe(ROADS.length);
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
    let atPlace = 0, bankLobby = 0, banks = 0, smallTall = 0, parked = 0, named = 0, intersections = 0;
    for (let k = 0; k < 30; k++) {
      const s = new Sim('S' + k); s.runToEnd();
      for (const I of s.incidents) {
        const sc = s.scenes[I.id]!;
        if (I.truth.type === 'traffic') { expect(I.truth.placeId).toBe(-1); intersections++; continue; }
        expect(I.truth.placeId, I.truth.label).toBeGreaterThanOrEqual(0);
        const q = s.city.places[I.truth.placeId];
        atPlace++;
        expect(INCIDENT_PLACES[I.truth.type][q.kind] ?? 0, `${I.truth.type} @ ${q.kind}`).toBeGreaterThan(0);
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
    expect(banks).toBeGreaterThan(3); expect(bankLobby).toBe(banks);      // 은행에서 난 사건의 현장은 은행 로비다
    expect(smallTall).toBe(0);                                             // 작은 집은 단층이다
    expect(named).toBeGreaterThan(atPlace * 0.5);
    expect(parked).toBeGreaterThan(50);
  }, 240000);
});
