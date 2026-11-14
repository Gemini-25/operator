import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/engine';
import { NORMAL } from '../src/sim/difficulty';
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
    expect(extinguished).toBeGreaterThan(3); // 전소되기 전에 불을 껐다
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
    expect(best.units[0].waterMax).toBeGreaterThan(bad.units[0].waterMax);
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
    expect(small.units.length).toBe(4); expect(base.units.length).toBe(6); expect(big.units.length).toBe(10);
    expect(big.responders.length).toBe(20);
    expect(new Set(big.responders.map((r) => r.name)).size).toBe(20);
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
  }, 120000);
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
    for (const k of Object.keys(NATURE_LIK)) expect(NATURE_LIK[k].length).toBe(7);
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
