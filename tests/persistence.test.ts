// I2 교대 간 지속 (docs/specs/I2-persistence.md §9). 단계 1 (틀 — 이어받은 상태가 없을 때 결과 불변):
//   시험 1(같은 이어받은 상태 = 같은 해시, makeCarryover 는 순수) · 5(저장·복원 왕복 — readCarryover 의 검사) · 7 의 읽기 부분(조직 명부에 없는 이름) ·
//   9(금지와 격리 — 글자) · 이어받은 상태가 없는 교대(아무것도 하지 않는다) · 명부의 열쇠(rosterKeys — createRoster 의 이름과 같다).
// 뒤 단계가 §9 의 2·3·4·6·7·8·10·11 을 이 파일에 더한다(대원·장비·도로·건물을 적용하는 단계). 단계 1 에는 적용하는 것이 없어 요약 줄은 '남은 피해 없음' 이다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { CLOSED_CAP, PLACE_CAP, ROAD_CAP, carryKey, cityKey, makeCarryover, readCarryover } from '../src/sim/persist';
import { rosterKeys } from '../src/sim/resources';
import { STAFF } from '../src/sim/crews';
import type { Carryover, PlaceCarry, RoadCarry } from '../src/sim/types';

// ───────────────────────── 도구 ─────────────────────────
const run = (seed: string, carry?: Carryover | null, d: Difficulty = NORMAL, len = 1200): Sim => {
  const s = new Sim(seed, d, len, carry === undefined ? {} : { carry });
  s.runToEnd();
  return s;
};
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
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
  });

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

  it('이어받은 상태로 시작한 교대의 교대 시작 문구: 가용 부대 수 = oos 가 아닌 부대 수 (단계 1 은 적용하는 것이 없어 지금 문구와 같다)', () => {
    const s = new Sim('P2', NORMAL, 1200, { carry: co });
    const avail = s.units.filter((u) => u.state !== 'oos').length, crew = s.responders.filter((r) => r.status !== 'off').length;
    expect(s.events[0].text).toContain(`가용 부대 ${avail}대, 대원 ${crew}명.`);
    expect(s.events[0].text).toBe(new Sim('P2', NORMAL, 1200).events[0].text);
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
  });
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
