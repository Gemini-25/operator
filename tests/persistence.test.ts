// I2 교대 간 지속 (docs/specs/I2-persistence.md §9). 단계 1 (틀 — 이어받은 상태가 없을 때 결과 불변):
//   시험 1(같은 이어받은 상태 = 같은 해시, makeCarryover 는 순수) · 5(저장·복원 왕복 — readCarryover 의 검사) · 7 의 읽기 부분(조직 명부에 없는 이름) ·
//   9(금지와 격리 — 글자) · 이어받은 상태가 없는 교대(아무것도 하지 않는다) · 명부의 열쇠(rosterKeys — createRoster 의 이름과 같다).
// 단계 2 (대원 — 이어받은 상태가 없을 때 결과 불변): 시험 2(다친 대원의 결장 · 교대 안의 부상과 결장의 구별) · 6(짧은 연속 — 대원 몫: 결장 ≤ 상한·요약 줄 하나) ·
//   7(성장 · 부대 규모 5 → 1 → 5 · 공석 → 신임) · 8 의 결원 부분(헬기·구조정 · 예비 인력 · short · empty) · 10 의 대원 부분(적용 목록과 기록의 일대일 · 결장자는 모두 기록에) ·
//   이어받은 교대의 재현성(결장·예비 인력이 있는 상태도 같은 입력이면 같은 결과) · off 가 지나가는 곳(결원 도착 기록의 causes · respondersHurt · 출동 준비 시간 · 운용 중단 문구).
// 뒤 단계가 §9 의 3·4·8(펌프·정비·섬광탄)·11 과 6·10 의 나머지를 이 파일에 더한다(장비·도로·건물을 적용하는 단계).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { BACK_HEALTH, CLOSED_CAP, EARLY_BACK_HEALTH, GAIN_CAP, PLACE_CAP, RECRUIT_NAMES, RELIEF_MAX, RELIEF_NAMES, REPLACE_AFTER, ROAD_CAP, absentCap, carryKey, cityKey, makeCarryover, readCarryover } from '../src/sim/persist';
import { crewReady, dispatchUnit, rosterKeys, tickUnits } from '../src/sim/resources';
import { STAFF, fieldCrew, minField } from '../src/sim/crews';
import { outShifts } from '../src/sim/field/injury';
import type { Carryover, CrewCarry, Incident, PlaceCarry, RoadCarry, Unit } from '../src/sim/types';

// ───────────────────────── 도구 ─────────────────────────
const run = (seed: string, carry?: Carryover | null, d: Difficulty = NORMAL, len = 1200): Sim => {
  const s = new Sim(seed, d, len, carry === undefined ? {} : { carry });
  s.runToEnd();
  return s;
};
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** 교대를 여러 번 돌리는 beforeAll 의 예산 (vitest 의 기본 hookTimeout 은 10초 — 다른 묶음과 함께 도는 기계에서는 교대 열둘이 그보다 오래 걸린다) */
const HOOK_MS = 240_000;
const SUMMARY = /^지난 교대에서 이어받은 상태 — 조직의 (\d+)번째 교대 \(지문 ([0-9a-f]{8})\)\. /;
/** 값 안에 유한하지 않은 수나 undefined 인 칸이 있으면 그 자리 (없으면 null) */
function unsafeAt(x: unknown, path = '$'): string | null {
  if (typeof x === 'number') return Number.isFinite(x) ? null : path;
  if (x === undefined) return path;
  if (x === null || typeof x !== 'object') return null;
  if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) { const b = unsafeAt(x[i], `${path}[${i}]`); if (b) return b; } return null; }
  for (const [k, v] of Object.entries(x)) { const b = unsafeAt(v, `${path}.${k}`); if (b) return b; }
  return null;
}
/** src 아래의 .ts 파일 (재귀) */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const SRC = new URL('../src/sim/', import.meta.url).pathname;

// ───────────────────────── 1. 같은 이어받은 상태 = 같은 해시 ─────────────────────────
describe('1. 같은 이어받은 상태 = 같은 해시', () => {
  let A: Sim, co: Carryover, B: Sim;
  beforeAll(() => {
    A = run('P1');
    co = makeCarryover(A);
    B = run('P2', co);
  }, HOOK_MS);

  it('같은 상태(그대로·JSON 왕복)는 같은 해시, 없는 것(인자 없음·null)끼리 같고 그것과는 다르다', () => {
    const h = B.report!.hash;
    expect(run('P2', co).report!.hash).toBe(h);
    expect(run('P2', json(co)).report!.hash).toBe(h);
    const none = run('P2').report!.hash;
    expect(run('P2', null).report!.hash).toBe(none);
    expect(none).not.toBe(h);
  });

  it('조금 다른 상태(어느 대원의 dExp + 0.001)는 지문과 해시가 다르다', () => {
    const co2 = json(co);
    co2.crew[5].dExp = Math.round((co2.crew[5].dExp + 0.001) * 1e4) / 1e4;
    expect(carryKey(co2)).not.toBe(carryKey(co));
    expect(run('P2', co2).report!.hash).not.toBe(B.report!.hash);
  });

  it('요약 줄은 정확히 하나, 첫 기록은 언제나 교대 시작이고 지문이 들어 있다', () => {
    expect(B.events[0].text.startsWith('교대 시작.')).toBe(true);
    const lines = B.events.filter((e) => SUMMARY.test(e.text));
    expect(lines.length).toBe(1);
    const m = SUMMARY.exec(lines[0].text)!;
    expect(+m[1]).toBe(co.shift);
    expect(m[2]).toBe(carryKey(co));
    expect(B.carryState.event).toBe(lines[0].id);
    expect(A.events.some((e) => SUMMARY.test(e.text))).toBe(false);      // 이어받은 상태가 없으면 남기지 않는다
  });

  it('readCarryover 는 입력 객체를 고치지 않는다 (Sim 생성자를 거쳐도)', () => {
    const input = json(co), before = JSON.stringify(input);
    readCarryover(input, A.city);
    new Sim('P5', NORMAL, 60, { carry: input }).runToEnd();
    expect(JSON.stringify(input)).toBe(before);
  });

  it('배속 묶음으로 돌려도 같은 해시', () => {
    const s = new Sim('P2', NORMAL, 1200, { carry: co });
    const chunks = [1, 3, 8, 15, 40, 2, 75];
    for (let i = 0; !s.ended && i < 100000; i++) s.run(chunks[i % chunks.length]);
    expect(s.report!.hash).toBe(B.report!.hash);
  });

  it('makeCarryover 는 순수하다: 두 번 불러 같고, 부른 뒤에도 해시·기록 수·앞 상태·겹침 표가 그대로다', () => {
    const h = A.report!.hash, n = A.events.length;
    expect(makeCarryover(A)).toEqual(co);
    expect(A.report!.hash).toBe(h);
    expect(A.events.length).toBe(n);
    const prev = JSON.stringify(B.carry), places = JSON.stringify([...B.carryState.places.entries()]), hb = B.report!.hash, nb = B.events.length;
    const next = makeCarryover(B);
    expect(JSON.stringify(B.carry)).toBe(prev);
    expect(JSON.stringify([...B.carryState.places.entries()])).toBe(places);
    expect(B.report!.hash).toBe(hb);
    expect(B.events.length).toBe(nb);
    expect(next.shift).toBe(co.shift + 1);
    next.crew[0].dExp = 0.2;      // 돌려준 객체는 새것이다 — 고쳐도 앞 상태가 바뀌지 않는다
    expect(JSON.stringify(B.carry)).toBe(prev);
  });

  it('끝나지 않은 교대에서는 만들지 않는다', () => {
    expect(() => makeCarryover(new Sim('P1', NORMAL, 1200))).toThrow();
  });

  it('이어받은 상태로 시작한 교대의 교대 시작 문구: 가용 부대 수 = oos 가 아닌 부대 수, 대원 수 = 결장(off)이 아닌 대원 수', () => {
    const s = new Sim('P2', NORMAL, 1200, { carry: co });
    const oos = s.units.filter((u) => u.state === 'oos').length, avail = s.units.length - oos;
    const off = s.responders.filter((r) => r.status === 'off').length, crew = s.responders.length - off;
    expect(s.events[0].text).toContain(`가용 부대 ${avail}대${oos ? `(정비·결원 ${oos}대 제외)` : ''}, 대원 ${crew}명${off ? `(결장 ${off}명 제외)` : ''}.`);
    // 결장도 정비도 없는 이어받은 상태면 지금 문구와 같다 (단계 1 의 뜻 — 괄호가 붙지 않는다)
    const calm: Carryover = json(co);
    for (const c of calm.crew) { c.out = 0; c.cause = null; delete c.replaceIn; delete c.recruit; }
    expect(new Sim('P2', NORMAL, 1200, { carry: calm }).events[0].text).toBe(new Sim('P2', NORMAL, 1200).events[0].text);
  });
});

// ───────────────────────── 이어받은 상태가 없을 때 ─────────────────────────
describe('이어받은 상태가 없는 교대 — 이 묶음은 아무것도 하지 않는다', () => {
  it('인자 없음·{}·{ carry: null } 이 같은 해시, carryState 는 꺼져 있고 비어 있다', () => {
    const a = new Sim('S3', NORMAL, 300), b = new Sim('S3', NORMAL, 300, {}), c = new Sim('S3', NORMAL, 300, { carry: null });
    for (const s of [a, b, c]) s.runToEnd();
    expect(b.report!.hash).toBe(a.report!.hash);
    expect(c.report!.hash).toBe(a.report!.hash);
    for (const s of [a, b, c]) {
      expect(s.carry).toBeNull();
      expect(s.carryState.on).toBe(false);
      expect(s.carryState.event).toBe(-1);
      expect(s.carryState.applied.length + s.carryState.dropped.length + s.carryState.places.size + s.carryState.roads.length).toBe(0);
      expect(s.responders.some((r) => r.status === 'off')).toBe(false);
    }
  });
});

// ───────────────────────── 명부의 열쇠 ─────────────────────────
describe('조직 명부의 열쇠 (rosterKeys)', () => {
  it('부대 규모 5 의 명부와 이름·순서가 같고, 규모 1~4 의 명부는 그 부분열이며 소속도 같다', () => {
    const keys = rosterKeys();
    expect(new Set(keys.map((k) => k.name)).size).toBe(keys.length);      // 이름은 모두 다르다
    const full = new Sim('K1', { ...NORMAL, resources: 5 });
    // 규모 5 = 편성될 수 있는 모든 부대의 표준 편성 = 열쇠의 앞부분. (N8 단계 2b) 편성표 끝의 편성되지 않는 줄(minLevel 6 — 그 부대를 쓰는 단계가 내린다)은
    // 이름 칸만 차지하므로 열쇠의 뒤에 남는다 — 그 열쇠는 모두 규모 5 에 없는 부대의 것이다
    const n5 = full.responders.length;
    expect(full.responders.map((r) => r.name)).toEqual(keys.slice(0, n5).map((k) => k.name));
    for (const k of keys.slice(n5)) expect(full.units.some((u) => u.callsign === k.callsign), `${k.callsign}: 편성되지 않는 줄`).toBe(false);
    for (const k of keys.slice(0, n5)) expect(k.slot).toBeLessThan(STAFF[full.units.find((u) => u.callsign === k.callsign)!.kind].std.length);
    for (const k of keys.slice(n5)) expect(k.slot).toBeLessThan(keys.filter((q) => q.callsign === k.callsign).length);
    for (const level of [1, 2, 3, 4]) {
      const s = new Sim('K1', { ...NORMAL, resources: level });
      let j = 0;
      for (const r of s.responders) {
        while (j < keys.length && keys[j].name !== r.name) j++;
        expect(j, r.name).toBeLessThan(keys.length);
        expect(keys[j].callsign).toBe(s.units[r.unitId].callsign);
      }
    }
  });
});

// ───────────────────────── 5. 저장·복원 왕복 ─────────────────────────
describe('5. 저장·복원 왕복 (readCarryover)', () => {
  let A: Sim, co: Carryover, roomy: number[], openId: number, facId: number;
  beforeAll(() => {
    A = run('P1', undefined, NORMAL, 300);
    co = makeCarryover(A);
    roomy = A.city.places.filter((q) => q.facility < 0 && !q.open).map((q) => q.id);
    openId = A.city.places.find((q) => q.facility < 0 && q.open)!.id;
    facId = A.city.places.find((q) => q.facility >= 0)!.id;
  }, HOOK_MS);
  const place = (id: number, state: PlaceCarry['state'], repair: number): PlaceCarry => ({ id, state, dmg: 0.3, soot: 0.2, repair, cause: 'fire', inc: '조직 1번째 교대 · 01 화재', since: 1 });
  const road = (edge: number, left: number): RoadCarry => ({ edge, why: 'crack', lane: false, left, openAt: 300, inc: '조직 1번째 교대 · 지진', since: 1 });

  it('JSON 왕복은 같은 상태·같은 지문 (건물·도로·선택 칸이 있는 것도)', () => {
    const rich: Carryover = json(co);
    rich.places = [place(roomy[0], 'closed', 2), { ...place(roomy[1], 'ruin', 4), spot: [0.4, 0.6], mark: 'collapsed' }, { ...place(roomy[2], 'marked', 0), opened: true }];
    rich.roads = [road(3, 1), { ...road(7, 2), lane: true, why: 'flood' }];
    rich.units = [{ callsign: '진압1', pump: 0.7, service: { readyAt: 420, why: 'pump' } }, { callsign: '진압2', pump: 0.4 }];
    rich.stock = { flashbang: 7 };
    rich.crew[0] = { ...rich.crew[0], out: -1, replaceIn: 1, cause: 'gunshot' };
    rich.crew[1] = { ...rich.crew[1], out: 2, cause: 'burn', kitFault: ['scba'] };
    rich.crew[2] = { ...rich.crew[2], name: '신임대원', seat: rich.crew[2].name, recruit: { skill: 0.5, judgment: 0.4, composure: 0.5, fitness: 0.6, teamwork: 0.5, experience: 0.2 } };
    for (const x of [co, rich]) {
      const r = readCarryover(json(x), A.city)!;
      expect(r.carry).toEqual(x);
      expect(r.dropped).toEqual([]);
      expect(carryKey(r.carry)).toBe(carryKey(x));
    }
  });

  it('판이 다르거나 모양이 틀리면 null', () => {
    const bad: unknown[] = [null, 3, 'x', {}, [], { ...co, v: 2 }, { ...co, crew: {} }, { ...co, units: null }, { ...co, places: 1 }, { ...co, roads: undefined },
      { ...co, stock: [] }, { ...co, shift: 0 }, { ...co, shift: 1.5 }, { ...co, shift: NaN }];
    for (const b of bad) expect(readCarryover(json(b), A.city), JSON.stringify(b)?.slice(0, 40)).toBeNull();
  });

  it('도시 지문이 다르면 건물·도로를 버리고 한 줄 남긴다 (대원·부대·재고는 남는다)', () => {
    const x: Carryover = { ...json(co), city: 'deadbeef', places: [place(roomy[0], 'closed', 2)], roads: [road(3, 1)], stock: { flashbang: 4 } };
    const r = readCarryover(x, A.city)!;
    expect(r.carry.places).toEqual([]);
    expect(r.carry.roads).toEqual([]);
    expect(r.carry.city).toBe(cityKey(A.city));
    expect(r.carry.crew.length).toBe(co.crew.length);
    expect(r.carry.stock).toEqual({ flashbang: 4 });
    expect(r.dropped).toContain('도시 지도가 바뀌어 건물·도로 상태는 이어받지 않습니다.');
  });

  it('범위 밖 숫자는 잘리고, 유한하지 않은 수·모르는 열거값의 항목은 버려진다', () => {
    const x: Carryover = json(co);
    x.crew[0].out = 9; x.crew[1].health = -5; x.crew[2].dExp = 3; x.crew[3].dSkill = -1;
    (x.crew[4] as unknown as { health: unknown }).health = 'NaN';      // JSON 에는 NaN 이 없다 — 숫자가 아닌 값으로 같은 경우를 만든다
    x.places = [place(roomy[0], 'closed', 9), { ...place(roomy[1], 'closed', 1), state: 'burning' as never }, place(facId, 'closed', 2), place(A.city.places.length + 5, 'closed', 2)];
    x.roads = [{ ...road(3, 1), openAt: 1e9 }, { ...road(4, 1), why: 'meteor' as never }, road(-1, 1)];
    x.units = [{ callsign: '진압1', pump: 7 }, { callsign: '진압2', service: { readyAt: 100, why: 'storm' as never } }];
    x.stock = { flashbang: 99, rope: 3 } as never;
    const nan: Carryover = json(co);
    const r = readCarryover(x, A.city)!;
    expect(r.carry.crew.find((c) => c.name === co.crew[0].name)!.out).toBe(3);
    expect(r.carry.crew.find((c) => c.name === co.crew[1].name)!.health).toBe(1);
    expect(r.carry.crew.find((c) => c.name === co.crew[2].name)!.dExp).toBe(0.25);
    expect(r.carry.crew.find((c) => c.name === co.crew[3].name)!.dSkill).toBe(0);
    expect(r.carry.crew.some((c) => c.name === co.crew[4].name)).toBe(false);
    expect(r.carry.places.map((p) => [p.id, p.repair])).toEqual([[roomy[0], 6]]);      // 모르는 상태·출동 시설·범위 밖 id 는 버린다
    expect(r.carry.roads.map((q) => [q.edge, q.openAt])).toEqual([[3, 900]]);
    expect(r.carry.units).toEqual([{ callsign: '진압1', pump: 1 }]);
    expect(r.carry.stock).toEqual({ flashbang: 10 });
    expect(r.dropped.some((d) => /형식이 맞지 않는 기록 \d+개/.test(d))).toBe(true);
    // 직접 넘긴 NaN·Infinity (저장소를 거치지 않은 입력)
    nan.crew[0].health = NaN; nan.crew[1].dExp = Infinity;
    const rn = readCarryover(nan, A.city)!;
    expect(rn.carry.crew.length).toBe(co.crew.length - 2);
  });

  it('출입 통제·무너짐인데 남은 교대가 0 이거나 열린 터면 흔적(marked)으로 읽는다', () => {
    const x: Carryover = { ...json(co), places: [place(roomy[0], 'closed', 0), place(openId, 'ruin', 3), place(roomy[1], 'marked', 2)] };
    const r = readCarryover(x, A.city)!;
    expect(r.carry.places.map((p) => [p.state, p.repair])).toEqual([['marked', 0], ['marked', 0], ['marked', 0]]);
  });

  it('상한: 출입 통제·무너짐 12, 건물 24, 도로 6 — 남은 교대가 큰 것(같으면 id 가 작은 것)을 남기고 한 줄', () => {
    const x: Carryover = json(co);
    x.places = roomy.slice(0, 20).map((id, i) => place(id, i % 2 ? 'ruin' : 'closed', 1 + (i % 4))).concat(roomy.slice(20, 40).map((id) => place(id, 'marked', 0)));
    x.roads = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((e, i) => road(e, i % 3 ? 1 : 2));
    const r = readCarryover(x, A.city)!;
    const closed = r.carry.places.filter((p) => p.state !== 'marked');
    expect(closed.length).toBe(CLOSED_CAP);
    expect(r.carry.places.length).toBe(PLACE_CAP);
    expect(Math.min(...closed.map((p) => p.repair))).toBeGreaterThanOrEqual(Math.max(...x.places.filter((p) => p.state !== 'marked' && !closed.some((c) => c.id === p.id)).map((p) => p.repair)));
    expect(r.carry.roads.length).toBe(ROAD_CAP);
    expect(r.carry.roads.filter((q) => q.left === 2).length).toBe(3);      // 남은 교대 2 인 셋은 모두 남는다
    expect(r.dropped.filter((d) => /많아/.test(d)).length).toBe(2);
    // 남는 것의 순서는 입력 그대로
    const ids = r.carry.places.map((p) => p.id);
    expect(ids).toEqual(x.places.map((p) => p.id).filter((id) => ids.indexOf(id) >= 0));
  });

  it('만든 상태는 JSON 으로 안전하다: 유한하지 않은 수도, undefined 인 칸도 없다 (이어받은 상태로 돈 교대가 만든 것도)', () => {
    expect(unsafeAt(co)).toBeNull();
    const B = run('P2', co, NORMAL, 300);
    expect(unsafeAt(makeCarryover(B))).toBeNull();
    expect(JSON.stringify(co)).not.toMatch(/undefined|Infinity|NaN/);
  });
});

// ───────────────────────── 7 (읽기 부분). 조직 명부에 없는 이름 ─────────────────────────
describe('7. 조직 명부 (읽기 부분 — 성장·부대 규모는 단계 2)', () => {
  it('조직 명부에 없는 이름 하나는 그 항목만 버리고 한 줄, 이번에 편성되지 않을 사람의 항목은 남는다', () => {
    const A = new Sim('P1', NORMAL, 60); A.runToEnd();
    const co = makeCarryover(A);
    const x: Carryover = json(co);
    x.crew.push({ ...x.crew[0], name: '조직에없는사람' });
    x.crew.push({ ...x.crew[1] });      // 같은 열쇠가 둘 — 뒤의 것을 버린다
    const r = readCarryover(x, A.city)!;
    expect(r.carry.crew.length).toBe(co.crew.length);
    expect(r.carry.crew.some((c) => c.name === '조직에없는사람')).toBe(false);
    expect(r.dropped).toContain('조직 명부에 없는 대원 1명의 기록은 버립니다.');
    // 부대 규모 1 에서 편성되지 않는 사람(예: 진압4 의 자리)도 조직의 사람이다
    const small = new Sim('P1', { ...NORMAL, resources: 1 }, 60);
    const unfielded = rosterKeys().find((k) => !small.responders.some((q) => q.name === k.name))!;
    expect(unfielded).toBeTruthy();
    expect(readCarryover(json(co), small.city)!.carry.crew.some((c) => c.name === unfielded.name)).toBe(true);
    // 편성표에 없는 호출부호
    const y: Carryover = { ...json(co), units: [{ callsign: '없는부대9', pump: 0.5 }, { callsign: '진압1', pump: 0.5 }] };
    const ry = readCarryover(y, A.city)!;
    expect(ry.carry.units.map((u) => u.callsign)).toEqual(['진압1']);
    expect(ry.dropped.some((d) => /편성표에 없는 부대 1대/.test(d))).toBe(true);
  });

  it('버린 것은 요약 줄 뒤에 기록된다 (요약 줄을 원인으로)', () => {
    const A = new Sim('P1', NORMAL, 60); A.runToEnd();
    const x: Carryover = { ...json(makeCarryover(A)), city: 'deadbeef' };
    const s = new Sim('P2', NORMAL, 60, { carry: x });
    const ev = s.carryState.event;
    expect(ev).toBeGreaterThan(0);
    const d = s.events.find((e) => e.text === '도시 지도가 바뀌어 건물·도로 상태는 이어받지 않습니다.')!;
    expect(d.id).toBeGreaterThan(ev);
    expect(d.causes).toEqual([ev]);
  });
});

// ───────────────────────── 단계 2 의 도구 ─────────────────────────
/** 그 자리(명부의 원래 이름)의 항목 */
const entryOf = (co: Carryover, seat: string): CrewCarry => co.crew.find((c) => (c.seat ?? c.name) === seat)!;
const unitOf = (s: Sim, cs: string): Unit => s.units.find((u) => u.callsign === cs)!;
const namesOf = (s: Sim, cs: string): string[] => unitOf(s, cs).crew.map((rid) => s.responders[rid].name);
const personOf = (s: Sim, name: string) => s.responders.find((r) => r.name === name)!;
/** 그 자리들을 결장(out 교대)으로 둔다 */
function setOut(co: Carryover, names: string[], out = 1, cause: string | null = 'burn'): void {
  for (const n of names) Object.assign(entryOf(co, n), { out, cause, health: BACK_HEALTH });
}
/** 결장·공석이 하나도 없는 상태로 (자연히 다친 대원 때문에 시험이 흔들리지 않게) */
function calmCrew(co: Carryover): Carryover {
  for (const c of co.crew) if (c.out !== 0) { c.out = 0; c.cause = null; delete c.replaceIn; }
  return co;
}
/** 적용 항목 하나가 기록에 반드시 담아야 하는 글자 (주인공의 이름·호출부호) */
function mustSay(n: Sim['carryState']['applied'][number]): string[] {
  switch (n.what) {
    case 'recruit': return [n.name, n.seat];
    case 'absent': return n.names;
    case 'vacant': return [n.name];
    case 'early': return [n.name];
    case 'relief': return [n.unit, n.name];
    case 'short': return [n.unit, `${n.n}명`];
    case 'empty': return [n.unit];
    default: return [];
  }
}
/**
 * 시험 10 (대원 부분): 적용 목록과 기록의 일대일 — 요약 줄 바로 뒤에 항목마다 한 줄(요약 줄이 원인, 항목의 주인공이 문장에), 그 뒤에 버린 것의 줄.
 * 교대 시작(0초)에 요약 줄을 원인으로 한 기록은 그것뿐이다. 결장(off)인 대원은 모두 어느 결장·공석 항목에 이름이 있다. 교대 시작 문구의 가용 부대 수 = oos 가 아닌 부대 수
 */
function checkCarryLog(s: Sim): void {
  const cs = s.carryState, ev = cs.event;
  expect(ev).toBeGreaterThan(0);
  const atStart = s.events.filter((e) => e.t === 0 && e.causes.indexOf(ev) >= 0);
  expect(atStart.length).toBe(cs.applied.length + cs.dropped.length);
  cs.applied.forEach((n, i) => {
    const e = s.events[ev + 1 + i];
    expect(e.causes, n.what).toEqual([ev]);
    for (const w of mustSay(n)) expect(e.text, `${n.what}: ${w}`).toContain(w);
    if ('unit' in n) expect(e.actor).toBe(n.unit);
  });
  cs.dropped.forEach((d, i) => expect(s.events[ev + 1 + cs.applied.length + i].text).toBe(d));
  const named = new Set<string>();
  for (const n of cs.applied) { if (n.what === 'absent') for (const x of n.names) named.add(x); else if (n.what === 'vacant') named.add(n.name); }
  const off = s.responders.filter((r) => r.status === 'off');
  for (const r of off) expect(named.has(r.name), r.name).toBe(true);
  expect(named.size).toBe(off.length);
  // 교대 시작 문구의 가용 부대 수 = 그때 oos 가 아닌 부대 수. 돌린 교대는 지원 부대가 붙고 상태가 바뀌었으므로 적용 목록으로 센다 (교대 시작의 oos = 운용 중단 + 정비)
  const avail = s.tick === 0 ? s.units.filter((u) => u.state !== 'oos').length
    : s.units.filter((u) => !u.aid).length - cs.applied.filter((n) => n.what === 'empty' || n.what === 'service').length;
  expect(s.events[0].text).toContain(`가용 부대 ${avail}대`);
}
/** 결원 도착 기록: 도착 기록의 원인에 요약 줄이 있는 것 = 결장(off) 대원이 있는 부대의 도착 (상공 도착 포함) */
function checkShortArrivals(s: Sim): number {
  const ev = s.carryState.event;
  let n = 0;
  for (const e of s.events) {
    if (e.kind !== 'arrive') continue;
    const u = unitOf(s, e.actor);
    const short = !!u && u.crew.some((rid) => s.responders[rid].status === 'off');
    expect(e.causes.indexOf(ev) >= 0, `${e.actor} ${e.text}`).toBe(short);
    if (short) n++;
  }
  return n;
}

// ───────────────────────── 2. 다친 대원이 다음 교대에 결장 ─────────────────────────
describe('2. 다친 대원이 다음 교대에 결장 (교대 안의 부상과 결장의 구별)', () => {
  let A: Sim, co: Carryover, B: Sim, co2: Carryover, X: string, Y: string, Z: string, W: string, readyBase: Map<string, number>;
  const agentsSeen: string[] = [];
  beforeAll(() => {
    A = run('P1');
    // 서로 다른 부대에서 한 명씩 — 결장 뒤에도 crewReady ≥ minField 인 부대 (진압 펌프차 4 → 최소 3, 구조 공작차 5 → 최소 4): 예비 인력이 붙지 않는다
    const pick = (cs: string, k: number) => A.responders[unitOf(A, cs).crew[k]];
    const x = pick('진압1', 2), y = pick('구조1', 3), z = pick('진압2', 2), w = pick('진압3', 2);
    for (const r of [x, y, z, w]) { r.status = 'ok'; r.dead = undefined; r.care = undefined; r.tDown = undefined; r.health = 90; }
    x.status = 'injured'; x.health = 30;                                  // 걸을 수 있는 다친 대원 (H1 "가벼운 일은 계속" — 그 교대에는 일했을 사람)
    y.status = 'down'; y.health = 10; y.tDown = A.t;                      // 쓰러진 채 병원·후송 아님
    z.status = 'injured'; z.health = 35; z.care = 'hospital';             // 병원 인계
    w.status = 'injured'; w.health = 38; w.care = 'aboard';               // 교대 끝에 후송 중
    [X, Y, Z, W] = [x.name, y.name, z.name, w.name];
    co = makeCarryover(A);
    for (const c of co.crew) if ([X, Y, Z, W].indexOf(c.name) < 0 && c.out !== 0) { c.out = 0; c.cause = null; delete c.replaceIn; }      // 자연히 다친 다른 대원은 지운다
    const base = new Sim('P3', NORMAL, 1200);
    readyBase = new Map(base.units.map((u) => [u.callsign, crewReady(base, u)]));
    // 병원·후송의 결장자 둘(Z·W)은 또 다른 부대(진압2·진압3)에서 — 그 부대도 결장 뒤에 최소 편성을 채운다
    B = new Sim('P3', NORMAL, 1200, { carry: co });
    const xr = personOf(B, X).id, yr = personOf(B, Y).id;
    while (!B.ended) {
      B.run(100);
      for (const s of B.scenes) if (s) for (const a of s.agents) if (a.rid === xr || a.rid === yr) agentsSeen.push(`${B.t}:${a.rid}`);
    }
    co2 = makeCarryover(B);
  }, HOOK_MS);

  it('결장 교대 수는 H1 의 outShifts 표 그대로 (다침 1 · 쓰러짐 3 · 병원 인계 2 · 후송 중 2), 돌아올 때의 체력 85', () => {
    expect(entryOf(co, X).out).toBe(1);
    expect(entryOf(co, Y).out).toBe(outShifts(A.responders.find((r) => r.name === Y)!));
    expect(entryOf(co, Y).out).toBe(3);
    expect(entryOf(co, Z).out).toBe(2);
    expect(entryOf(co, W).out).toBe(2);
    for (const n of [X, Y, Z, W]) expect(entryOf(co, n).health).toBe(BACK_HEALTH);
  });

  it('다음 교대에는 off(지구력 100)로 명부에 남고 현장에 내리지 않으며, 그 부대의 crewReady 가 1 작다 (예비 인력 없음)', () => {
    const fresh = new Sim('P3', NORMAL, 60, { carry: co });
    for (const n of [X, Y, Z, W]) { const r = personOf(fresh, n); expect(r.status).toBe('off'); expect(r.stamina).toBe(100); }
    expect(agentsSeen).toEqual([]);
    for (const cs of ['진압1', '구조1', '진압2', '진압3']) {
      expect(crewReady(fresh, unitOf(fresh, cs)), cs).toBe(readyBase.get(cs)! - 1);
      expect(crewReady(fresh, unitOf(fresh, cs)), cs).toBeGreaterThanOrEqual(minField(unitOf(fresh, cs).kind));
    }
    expect(fresh.carryState.stats.relief).toBe(0);
    expect(fresh.responders.some((r) => r.relief)).toBe(false);
    // 교대 안의 부상(injured)으로 출근하는 사람은 없다 — 이어받는 상태는 off 아니면 ok
    expect(fresh.responders.filter((r) => r.status === 'injured').length).toBe(0);
    expect(fresh.responders.every((r) => r.status === 'ok' || r.status === 'off')).toBe(true);
  });

  it('그다음 상태: X 는 돌아오고(out 0, 체력 85) Y 는 한 교대 줄어든다. 그다음 교대에 X 는 ok·체력 85, Y 는 off', () => {
    expect(entryOf(co2, X)).toMatchObject({ out: 0, health: BACK_HEALTH, cause: null });
    expect(entryOf(co2, Y).out).toBe(2);
    expect(entryOf(co2, Z).out).toBe(1);
    expect(entryOf(co2, X).shifts).toBe(entryOf(co, X).shifts);      // 결장한 교대는 경력에 세지 않는다
    const C = new Sim('P4', NORMAL, 60, { carry: co2 });
    expect(personOf(C, X).status).toBe('ok');
    expect(personOf(C, X).health).toBe(BACK_HEALTH);
    expect(personOf(C, Y).status).toBe('off');
  });

  it('B 의 기록: 적용 목록과 일대일, 결원 도착에는 요약 줄이 원인, 대원 피해 목록에 결장자는 없다', () => {
    checkCarryLog(B);
    checkShortArrivals(B);
    for (const n of [X, Y, Z, W]) expect(B.report!.respondersHurt.some((h) => h.name === n)).toBe(false);
    expect(B.events.some((e) => e.actor === '진압1' && e.text.includes(`${X} 대원이 결장합니다`) && e.text.includes('1교대 남음'))).toBe(true);
  });
});

// ───────────────────────── 7. 경험 성장과 부대 규모 · 공석과 신임 ─────────────────────────
describe('7. 경험 성장과 부대 규모 · 공석과 신임', () => {
  const L5: Difficulty = { ...NORMAL, resources: 5 }, L1: Difficulty = { ...NORMAL, resources: 1 };
  /** 규모 5 에 있고 규모 1 에 없는 사람의 이름 (명부 순서) */
  const unfielded = (): string[] => {
    const big = new Sim('Q0', L5, 1), small = new Sim('Q0', L1, 1);
    return rosterKeys().map((k) => k.name).filter((n) => big.responders.some((r) => r.name === n) && !small.responders.some((r) => r.name === n));
  };

  it('xpGained 0.04 인 대원은 0 < dExp ≤ 0.02, 숙련은 그 0.6 배, 경력 +1', () => {
    const A = new Sim('P1', NORMAL, 60); A.runToEnd();
    const r = A.responders.find((q) => q.status === 'ok' && !q.relief)!;
    r.xpGained = 0.04;
    const c = entryOf(makeCarryover(A), r.name);
    expect(c.dExp).toBeGreaterThan(0);
    expect(c.dExp).toBeLessThanOrEqual(GAIN_CAP);
    expect(c.dSkill).toBeCloseTo(c.dExp * 0.6, 3);
    expect(c.shifts).toBe(1);
  });

  it('부대 규모 5 → 1 → 5: 1 에서 편성되지 않은 대원의 항목이 남고(결장은 휴식만큼 줄고), 같은 이름은 기본 능력 + 누적', () => {
    const [p, q] = unfielded();
    const A5 = new Sim('Q1', L5, 60); A5.runToEnd();
    const co5 = makeCarryover(A5);
    Object.assign(entryOf(co5, p), { dExp: 0.1, dSkill: 0.05 });
    setOut(co5, [q], 2);
    const B1 = new Sim('Q2', L1, 60, { carry: co5 }); B1.runToEnd();
    expect(B1.responders.some((r) => r.name === p || r.name === q)).toBe(false);
    const co1 = makeCarryover(B1);
    expect(entryOf(co1, p)).toMatchObject({ dExp: 0.1, dSkill: 0.05, out: 0 });
    expect(entryOf(co1, q)).toMatchObject({ out: 1, cause: 'burn' });
    const B5 = new Sim('Q3', L5, 60, { carry: co1 }), base = new Sim('Q3', L5, 60);
    const rp = personOf(B5, p), bp = personOf(base, p);
    expect(rp.skill).toBeCloseTo(Math.min(0.98, bp.skill + 0.05), 10);
    expect(rp.experience).toBeCloseTo(Math.min(0.97, bp.experience + 0.1), 10);
    expect(rp.judgment).toBeCloseTo(Math.min(0.98, bp.judgment + 0.035), 10);
    expect(personOf(B5, q).status).toBe('off');
  });

  it('공석: 편성되지 않는 자리의 out −1·replaceIn 2 → replaceIn 1(원래 이름으로 돌아오지 않는다) → 신임 대원 항목 → 신임이 그 자리에', () => {
    const seat = unfielded()[2];
    const A = new Sim('Q1', L1, 60); A.runToEnd();
    const co = makeCarryover(A);
    Object.assign(entryOf(co, seat), { out: -1, replaceIn: REPLACE_AFTER, cause: 'gunshot' });
    const B = new Sim('Q2', L1, 60, { carry: co }); B.runToEnd();
    const coB = makeCarryover(B);
    expect(entryOf(coB, seat)).toMatchObject({ name: seat, out: -1, replaceIn: 1 });
    expect(entryOf(coB, seat).recruit).toBeUndefined();
    const C = new Sim('Q3', L1, 60, { carry: coB }); C.runToEnd();
    const coC = makeCarryover(C);
    const rc = entryOf(coC, seat);
    expect(rc.seat).toBe(seat);
    expect(RECRUIT_NAMES).toContain(rc.name);
    expect(rc).toMatchObject({ out: 0, health: 100, dExp: 0, dSkill: 0, shifts: 0 });
    expect(rc.recruit!.experience).toBeGreaterThanOrEqual(0.1);
    expect(rc.recruit!.experience).toBeLessThanOrEqual(0.3);
    expect(makeCarryover(C)).toEqual(coC);      // 신임의 능력도 같은 입력이면 같다 (recruit:<자리> 흐름)
    expect(readCarryover(json(coC), C.city)!.carry).toEqual(coC);
    // 그 자리가 편성되는 교대: 같은 rid 에 신임이 앉고, 처음 오는 교대라 기록이 한 줄
    const D = new Sim('Q4', L5, 60, { carry: coC }), base = new Sim('Q4', L5, 60);
    const rid = personOf(base, seat).id;
    expect(D.responders[rid].name).toBe(rc.name);
    expect(D.responders[rid].seat).toBe(seat);
    expect(D.responders[rid].role).toBe(base.responders[rid].role);
    expect(D.responders[rid].experience).toBeCloseTo(rc.recruit!.experience, 10);
    expect(D.carryState.applied.filter((n) => n.what === 'recruit')).toEqual([{ what: 'recruit', unit: base.units[base.responders[rid].unitId].callsign, name: rc.name, seat }]);
    checkCarryLog(D);
    // 신임이 나와 일한 다음 상태: 열쇠는 자리, 이름은 신임의 것 (다음 교대에는 '배치' 줄이 다시 나오지 않는다)
    D.runToEnd();
    const coD = makeCarryover(D);
    expect(entryOf(coD, seat)).toMatchObject({ name: rc.name, seat, shifts: 1 });
    expect(new Sim('Q5', L5, 60, { carry: coD }).carryState.applied.some((n) => n.what === 'recruit')).toBe(false);
  });

  it('개인 장비 점검: 드러난 고장은 고치고, 드러나지 않은 고장은 일부만 찾는다 — 남은 고장은 다음 교대에 명부의 추첨 뒤에 다시 고장', () => {
    const A = new Sim('P1', NORMAL, 60); A.runToEnd();
    const people = A.responders.filter((r) => !r.relief && (r.kit?.length ?? 0) >= 3).slice(0, 7);
    for (const r of people) for (const it of r.kit!) { it.fault = true; it.faultKnown = false; }
    const known = people[0];
    for (const it of known.kit!) it.faultKnown = true;
    const co = makeCarryover(A);
    expect(entryOf(co, known.name).kitFault).toBeUndefined();
    let kept = 0, total = 0;
    for (const r of people.slice(1)) {
      const kf = entryOf(co, r.name).kitFault ?? [];
      total += r.kit!.length; kept += kf.length;
      for (const id of kf) expect(r.kit!.some((it) => it.id === id)).toBe(true);
    }
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(total);
    expect(makeCarryover(A)).toEqual(co);      // 난수 흐름을 쓰지 않는다 — 몇 번 불러도 같다
    const B = new Sim('P2', NORMAL, 60, { carry: co });
    for (const r of people.slice(1)) for (const id of entryOf(co, r.name).kitFault ?? []) expect(personOf(B, r.name).kit!.find((it) => it.id === id)!.fault, `${r.name} ${id}`).toBe(true);
  });
});

// ───────────────────────── 8 (결원 부분). 헬기·구조정 · 예비 인력 · short · empty ─────────────────────────
describe('8. 결원 — 예비 인력·모자라면 그 인원으로·나올 사람이 없으면 운용 중단 (펌프·정비·섬광탄은 단계 3)', () => {
  let co0: Carryover, s0: Sim;
  beforeAll(() => {
    const A = new Sim('P1', NORMAL, 60); A.runToEnd();
    co0 = calmCrew(makeCarryover(A));
    s0 = new Sim('P2', NORMAL, 1);
  }, HOOK_MS);
  /** 순찰1·2·3 의 0번 자리, 진압1 의 1·2번(예비 인력 넷을 다 쓴다) → 구급2 의 한 명(모자람) · 구급3 전원(나올 사람 없음) · 헬기1 기장·부기장(조종사 없음) */
  const heavy = (): Carryover => {
    const co = json(co0);
    setOut(co, [namesOf(s0, '순찰1')[0], namesOf(s0, '순찰2')[0], namesOf(s0, '순찰3')[0]], 2, 'gunshot');
    setOut(co, namesOf(s0, '진압1').slice(1, 3), 1, 'burn');
    setOut(co, [namesOf(s0, '구급2')[0]], 1, 'vehicle');
    setOut(co, namesOf(s0, '구급3'), 3, 'blast');
    setOut(co, namesOf(s0, '헬기1').slice(2, 4), 1, 'burn');
    return co;
  };

  it('결장이 없는 이어받은 상태: 헬기·구조정에 예비 인력이 붙지 않고 모두 운용한다', () => {
    const s = new Sim('P2', NORMAL, 60, { carry: co0 });
    expect(s.carryState.stats.relief).toBe(0);
    expect(s.responders.some((r) => r.relief)).toBe(false);
    for (const cs of ['헬기1', '구조정1', '의료헬기1', '경찰헬기1']) expect(unitOf(s, cs).state).toBe('available');
    expect(s.carryState.applied.filter((n) => n.what !== 'recruit')).toEqual([]);
  });

  it('소방 헬기의 기장·부기장이 모두 결장하면 기장 자리에 예비 인력이 붙어 운용한다', () => {
    const co = json(co0);
    setOut(co, namesOf(s0, '헬기1').slice(2, 4));
    const s = new Sim('P2', NORMAL, 60, { carry: co });
    const u = unitOf(s, '헬기1');
    const rel = u.crew.map((rid) => s.responders[rid]).filter((r) => r.relief);
    expect(rel.map((r) => r.role)).toEqual(['pilot']);
    expect(rel[0].name).toBe(RELIEF_NAMES[0]);
    expect(u.state).toBe('available');
    expect(crewReady(s, u)).toBe(2);
    expect(fieldCrew(s, u).indexOf(rel[0].id)).toBe(-1);      // 조종사는 내리는 자리가 아니다
    checkCarryLog(s);
  });

  it('예비 인력이 바닥나면: 나온 대원이 있는 부대는 그 인원으로(short — 배정에서 빠지지 않는다), 없으면 그 부대만 oos 결원(empty — crew · pilot)', () => {
    const s = new Sim('P2', NORMAL, 60, { carry: heavy() });
    const cs = s.carryState;
    expect(cs.stats.relief).toBe(RELIEF_MAX);
    expect(cs.applied.filter((n) => n.what === 'relief').map((n) => (n as { unit: string }).unit)).toEqual(['순찰1', '순찰2', '순찰3', '진압1']);
    const amb2 = unitOf(s, '구급2'), amb3 = unitOf(s, '구급3'), heli = unitOf(s, '헬기1');
    expect(amb2.state).toBe('available');
    expect(crewReady(s, amb2)).toBe(1);
    expect(cs.applied).toContainEqual({ what: 'short', unit: '구급2', n: 1 });
    expect(s.events.some((e) => e.text === '구급2 결원 — 예비 인력이 없어 1명으로 운용합니다.')).toBe(true);
    expect([amb3.state, amb3.oosWhy]).toEqual(['oos', '결원']);
    expect(cs.applied).toContainEqual({ what: 'empty', unit: '구급3', why: 'crew' });
    expect([heli.state, heli.oosWhy]).toEqual(['oos', '결원']);
    expect(cs.applied).toContainEqual({ what: 'empty', unit: '헬기1', why: 'pilot' });
    expect(s.events.some((e) => e.text === '헬기1 결원으로 이번 교대 운용 중단 (조종·조타할 사람·예비 인력 없음).')).toBe(true);
    // 그 밖의 부대는 모두 운용한다 · 나온 대원 수 = 결장이 아닌 수
    for (const u of s.units) if (u !== amb3 && u !== heli) expect(u.state, u.callsign).toBe('available');
    expect(s.events[0].text).toContain(`가용 부대 ${s.units.length - 2}대(정비·결원 2대 제외)`);
    checkCarryLog(s);
  });

  it('결장이 있는 교대도 같은 입력이면 같은 결과 (그대로·JSON 왕복), 예비 인력의 이름·rid·능력도 같다', () => {
    const co = heavy();
    const a = new Sim('P2', NORMAL, 1200, { carry: co }), b = new Sim('P2', NORMAL, 1200, { carry: json(co) });
    const relief = (s: Sim) => s.responders.filter((r) => r.relief).map((r) => [r.id, r.name, r.role, r.skill, r.experience]);
    expect(relief(b)).toEqual(relief(a));
    a.runToEnd(); b.runToEnd();
    expect(b.report!.hash).toBe(a.report!.hash);
    expect(a.report!.hash).not.toBe(run('P2', co0).report!.hash);
    // 결원 부대가 나갔다면 그 도착 기록에는 요약 줄이 원인이다 · 운용 중단한 부대는 한 번도 나가지 않는다 · 결장자는 대원 피해 목록에 없다
    checkShortArrivals(a);
    expect(unitOf(a, '구급3').runs).toBe(0);
    expect(unitOf(a, '헬기1').runs).toBe(0);
    for (const r of a.responders) if (r.status === 'off') expect(a.report!.respondersHurt.some((h) => h.name === r.name)).toBe(false);
    expect(makeCarryover(a)).toEqual(makeCarryover(b));
  });

  it('출동 준비 시간은 나온 첫 대원(부대장이 결장이면 다음 사람)의 경험으로', () => {
    const s = new Sim('P2', NORMAL, 60, { carry: heavy() });
    const u = unitOf(s, '순찰1');
    expect(s.responders[u.crew[0]].status).toBe('off');
    const lead = s.responders[u.crew[1]];
    const I = { id: 0, reportedNode: u.nodeId, assigned: [], everAssigned: [] } as unknown as Incident;
    dispatchUnit(s, u, I, 10);
    expect(u.state).toBe('turnout');
    expect(u.timer).toBeCloseTo(5 + (1 - lead.experience) * 3, 10);
  });

  it('운용 중단 문구는 결장자를 빼고 고른다: 나온 대원이 모두 숨지면 결장자가 있어도 "대원 전원 순직"', () => {
    const s = new Sim('P2', NORMAL, 60, { carry: heavy() });
    const u = unitOf(s, '구급2');
    const here = u.crew.map((rid) => s.responders[rid]).filter((r) => r.status !== 'off');
    expect(here.length).toBe(1);
    here[0].dead = true; here[0].status = 'down'; here[0].health = 0;
    u.state = 'returning'; u.route = null; u.destNode = u.nodeId;
    tickUnits(s);
    expect(u.state).toBe('oos');
    expect(s.events[s.events.length - 1].text).toBe('구급2 대원 전원 순직 — 운용 중단.');
  });

  it('결장 상한: 결장이 상한을 넘으면 남은 결장이 짧은 사람부터 체력 70 으로 일찍 돌아오고 기록이 한 줄씩', () => {
    const co = json(co0);
    const names = s0.responders.map((r) => r.name);
    const cap = absentCap(s0.responders.length);
    // 상한보다 셋 많은 사람을 결장으로: 앞의 셋은 1교대, 나머지는 2교대 남음
    const pick = names.slice(0, cap + 3);
    pick.forEach((n, i) => setOut(co, [n], i < 3 ? 1 : 2, 'smoke'));
    const s = new Sim('P2', NORMAL, 60, { carry: co });
    const away = s.responders.filter((r) => r.status === 'off' && r.carryOut !== -1);
    expect(away.length).toBe(cap);
    const early = s.carryState.applied.filter((n) => n.what === 'early').map((n) => (n as { name: string }).name);
    expect(early.slice().sort()).toEqual(pick.slice(0, 3).sort());
    for (const n of early) { expect(personOf(s, n).status).toBe('ok'); expect(personOf(s, n).health).toBe(EARLY_BACK_HEALTH); }
    expect(s.carryState.stats.early).toBe(3);
    checkCarryLog(s);
  });

  it('결장한 기동대원의 섬광탄은 나온 대원에게 다시 나눈다 (부대의 합은 그대로, 결장자의 몫은 0)', () => {
    const co = json(co0);
    const names = namesOf(s0, '기동1');      // 조장 · 기동대원 · 기동대원 (섬광탄은 기동대원 몫)
    setOut(co, [names[1]]);
    const s = new Sim('P2', NORMAL, 60, { carry: co });
    const u = unitOf(s, '기동1');
    const bangs = (n: string): number => personOf(s, n).kit!.find((it) => it.id === 'flashbang')?.uses ?? 0;
    expect(u.flashbangs).toBe(unitOf(s0, '기동1').flashbangs);
    expect(u.flashbangs).toBeGreaterThan(0);
    expect(bangs(names[1])).toBe(0);
    expect(bangs(names[2])).toBe(u.flashbangs);
    expect(s.responders.some((r) => r.relief)).toBe(false);      // 기동 순찰차 3 → 최소 2: 한 명 결장은 예비 인력 없이
  });
});

// ───────────────────────── 6·10. 짧은 연속 (계보 3 × 교대 4) — 대원 몫 ─────────────────────────
describe('6·10. 짧은 연속 (계보 3 × 교대 4) — 대원 몫', () => {
  const shifts: Sim[] = [], keys: [string, string][] = [];
  beforeAll(() => {
    for (let L = 0; L < 3; L++) {
      let co: Carryover | null = null;
      for (let k = 1; k <= 4; k++) {
        const s = new Sim(`C${L}.${k}`, NORMAL, 1200, co ? { carry: co } : {});
        s.runToEnd();
        shifts.push(s);
        const next = makeCarryover(s);
        keys.push([carryKey(readCarryover(json(next), s.city)!.carry), carryKey(next)]);      // 왕복 검사
        co = next;
      }
    }
  }, HOOK_MS);

  it('예외 없이 모든 사건이 닫히고, 왕복 지문이 같고, 결장 ≤ 상한, 교대 2 부터 지문이 든 요약 줄이 정확히 하나', () => {
    expect(shifts.length).toBe(12);
    for (const [a, b] of keys) expect(a).toBe(b);
    shifts.forEach((s, i) => {
      const k = (i % 4) + 1;
      expect(s.incidents.every((I) => I.phase === 'closed'), s.seed).toBe(true);
      const roster = s.responders.filter((r) => !r.relief && !s.units[r.unitId].aid).length;
      expect(s.responders.filter((r) => r.status === 'off' && r.carryOut !== -1).length).toBeLessThanOrEqual(absentCap(roster));
      expect(s.events.filter((e) => SUMMARY.test(e.text)).length).toBe(k === 1 ? 0 : 1);
      if (k > 1) expect(+SUMMARY.exec(s.events[s.carryState.event].text)![1]).toBe(k);
    });
  });

  it('적용 목록과 기록의 일대일, 결장자는 모두 기록에 이름이 있다, 결원 도착에는 요약 줄이 원인', () => {
    for (const s of shifts) if (s.carryState.on) { checkCarryLog(s); checkShortArrivals(s); }
  });
});

// ───────────────────────── 9. 금지와 격리 ─────────────────────────
describe('9. 금지와 격리 (글자)', () => {
  it('src/sim 에는 브라우저 저장소가 없다', () => {
    for (const f of tsFiles(SRC)) expect(readFileSync(f, 'utf8'), f).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });
  it('관제·지휘 코드는 이어받은 상태(carryState·.wear)를 직접 읽지 않는다', () => {
    const files = [...tsFiles(join(SRC, 'dispatch')), join(SRC, 'field/commander.ts'), join(SRC, 'field/brain.ts'), ...tsFiles(join(SRC, 'field/orders'))];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/carryState|\.wear\b/);
  });
});
