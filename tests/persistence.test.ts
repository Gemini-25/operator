// I2 교대 간 지속 (docs/specs/I2-persistence.md §9). 단계 1 (틀 — 이어받은 상태가 없을 때 결과 불변):
//   시험 1(같은 이어받은 상태 = 같은 해시, makeCarryover 는 순수) · 5(저장·복원 왕복 — readCarryover 의 검사) · 7 의 읽기 부분(조직 명부에 없는 이름) ·
//   9(금지와 격리 — 글자) · 이어받은 상태가 없는 교대(아무것도 하지 않는다) · 명부의 열쇠(rosterKeys — createRoster 의 이름과 같다).
// 단계 2 (대원 — 이어받은 상태가 없을 때 결과 불변): 시험 2(다친 대원의 결장 · 교대 안의 부상과 결장의 구별) · 6(짧은 연속 — 대원 몫: 결장 ≤ 상한·요약 줄 하나) ·
//   7(성장 · 부대 규모 5 → 1 → 5 · 공석 → 신임) · 8 의 결원 부분(헬기·구조정 · 예비 인력 · short · empty) · 10 의 대원 부분(적용 목록과 기록의 일대일 · 결장자는 모두 기록에) ·
//   이어받은 교대의 재현성(결장·예비 인력이 있는 상태도 같은 입력이면 같은 결과) · off 가 지나가는 곳(결원 도착 기록의 causes · respondersHurt · 출동 준비 시간 · 운용 중단 문구).
// 단계 3 (장비 — 이어받은 상태가 없을 때 결과 불변): 시험 8 의 장비 부분(펌프 범위 · 정비 120초 · 짧은 교대의 정비 · SERVICE_CAP 과 급히 정비 완료 ·
//   정비를 마쳐도 결원 · 끝 상태 → 정밀 정비/점검 · 편성되지 않은 부대의 휴식 · 섬광탄 창고 1 · 창고 10 → 7 → 4) · 10 의 장비 부분(정비 완료 기록의 일대일·원인) ·
//   6 에 극한 계보 하나(정비·결장이 자연히 생기는 연속) · 정비·재고 부족이 있는 교대의 재현성.
// 단계 4 (도로 — 이어받은 상태가 없을 때 결과 불변): 시험 4(복구 공사 — 전면 'repair'·경로가 피함·openAt 에 개통·한 차로·교대 내내(left 2)·짧은 교대·
//   끊기는 통제는 놓지 않음·여럿이어도 0틱에 모든 시설 → 모든 교차로) · 11(재난이 닫은 도로가 넘어온다 — 지진의 d.damaged → crack) · 끝 상태의 원천 표
//   (앞에서 이어받은 것·재난·산사태·쓰러진 나무·다중 추돌·무너진 건물의 잔해 (가)(나)·같은 구간·상한) · 10 의 도로 부분(개통 기록의 일대일·원인·tag 'carry'·교통의 장부) ·
//   6 의 도로 몫(복구 도로 ≤ 6 · 0틱 연결) · 이어받은 도로로 시작한 교대의 재현성 · 지도의 고깔(그림은 상태를 읽기만 한다).
// 단계 5 (건물 — 이어받은 상태가 없을 때 결과 불변): 시험 3(쓸 수 없는 건물에서는 사건이 나지 않는다 — placeUsable · 여섯 자리: 장소 추첨·정해 준 건물·은신처·
//   연쇄 방화·재난·현장 + 넷째 자리(법칙 사건)·재범의 자리의 글자 검사 · 셋째 단계 · 흔적의 가중치 · 손상된 건물의 현장(처음부터 탄 칸·X6 의 분모·기록) · 그을음의 방향) ·
//   끝 상태의 표(placeOutcome — X6 줄·화재 소실률·붕괴 잔해·2차 붕괴·승강기·열린 터) · 휴식 · 상한 · 6·10 의 건물 몫(상한·무너진 건물·손상 건물 사건의 기록 일대일) ·
//   checkCarryLog 의 건물 줄('외 n곳' 묶음).
// 단계 7 (보고서): 1 의 보고서 칸(carry·carryNext·요약 끝 줄) · 요약의 몫 · 2 의 명부(H1 roster)의 결장자 out · 결원 출동 분석 문장.
// 단계 8 (측정·균형 — §9 를 다 채웠다): 7 의 성장 식(GAIN_K 1.0) · 6·10 의 요약 줄 '숙련이 오른 대원'(GROWN_MIN — 보고서와 같은 문턱)과 교대마다 GAIN_CAP 안의 성장 ·
//   3 의 끝 상태 표가 RUIN_REPAIR(3) 를 쓴다. 이어 돌린 교대의 기준(§6.3)은 scripts/chain.ts --check 가 본다 (192교대 — 관문 밖).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { BACK_HEALTH, CLOSED_CAP, DIS_FULL, EARLY_BACK_HEALTH, FRONT_SLOW, GAIN_CAP, GAIN_K, LANE_SLOW, PLACE_CAP, PLACE_LINES, PRE_BURN, PUMP_REST, RECRUIT_NAMES, RELIEF_MAX, RELIEF_NAMES, REPLACE_AFTER, RESUPPLY, ROAD_AT, ROAD_CAP, RUIN_REPAIR, RUSHED_PUMP, SERVICE_AT, SERVICE_CAP, SERVICE_PUMP, STOCK_CAP, WHY_NAME, absentCap, carryKey, cityKey, makeCarryover, readCarryover } from '../src/sim/persist';
import { edgeName, findRoute } from '../src/sim/city';
import { applyPlaceWear, placeCond, placeOutcome, placeUsable } from '../src/sim/persist';
import { GROWN_MIN, carryEffectLine, carryLines, carryNextLine, carryParts, carrySummary, shortArrivalLine } from '../src/sim/persist';      // (단계 7) 보고서
import { createIncident, placeGone } from '../src/sim/incidents';
import { scenarioOf } from '../src/sim/scenarios';
import { INCIDENT_PLACES } from '../src/sim/cityPlan';
import { CAT, burnFracOf, catOf } from '../src/sim/field/catastrophe';
import { T } from '../src/sim/types';
import { addObstacle, passable } from '../src/sim/traffic';
import { crewReady, dispatchUnit, rosterKeys, tickUnits } from '../src/sim/resources';
import { STAFF, fieldCrew, minField } from '../src/sim/crews';
import { outShifts } from '../src/sim/field/injury';
import type { Carryover, City, CrewCarry, Incident, PlaceCarry, PlaceMark, RoadCarry, RoadEdge, Unit, UnitCarry } from '../src/sim/types';

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

  it('(단계 7) 보고서: 다음 교대로 넘기는 것(carryNext)은 언제나 — makeCarryover 의 요약과 같고 요약 끝 줄이 그것을 말한다. 조직 칸(carry)은 이어받은 교대만', () => {
    // 이어받은 상태가 없는 교대: carry 없음, carryNext = 그 교대가 만든 상태의 요약, '지난 교대의 영향' 줄 없음
    expect(A.report!.carry).toBeUndefined();
    expect(A.report!.carryNext).toEqual(carrySummary(co));
    expect(A.report!.summary[A.report!.summary.length - 1]).toBe(carryNextLine(carrySummary(co)));
    expect(A.report!.summary.some((l) => l.startsWith('지난 교대의 영향'))).toBe(false);
    expect(carryEffectLine(A)).toBeNull();
    expect(carryLines(A)).toEqual([]);
    // 이어받은 교대: 조직 칸의 첫 줄은 요약 줄 그대로, 지문·교대 번호, 다음 상태의 요약
    const rc = B.report!.carry!;
    expect(rc.shift).toBe(co.shift);
    expect(rc.key).toBe(carryKey(co));
    expect(rc.lines[0]).toBe(B.events[B.carryState.event].text);
    expect(rc.lines).toEqual(carryLines(B));
    expect(B.report!.carryNext).toEqual(carrySummary(makeCarryover(B)));
    const eff = carryEffectLine(B);
    expect(B.report!.summary.indexOf(eff ?? '') >= 0).toBe(eff !== null);
    // 결원 부대가 나간 사건 줄은 결원 도착 기록(원인 = 요약 줄)이 있을 때만, 그 사건 수로
    const short = new Set(B.events.filter((e) => e.kind === 'arrive' && e.incidentId >= 0 && e.causes.indexOf(B.carryState.event) >= 0).map((e) => e.incidentId));
    const line = rc.lines.find((l) => l.startsWith('결원 부대가 나간 사건'));
    if (short.size) expect(line).toMatch(new RegExp(`^결원 부대가 나간 사건 ${short.size}건 \\(`)); else expect(line).toBeUndefined();
    // 보고서 JSON 은 안전하다 (유한하지 않은 수·undefined 인 칸 없음 — carry 가 없는 교대는 칸 자체가 빠진다)
    expect(unsafeAt(json(B.report!.carryNext))).toBeNull();
    expect('carry' in json(A.report!)).toBe(false);
  });

  it('(단계 7) 요약의 몫: 결장(out > 0)·공석(−1)·정비·출입 통제(무너짐)·복구 도로 — 0 인 것은 빼고, 모두 0 이면 피해 없음. 숙련은 누적 dSkill ≥ GROWN_MIN 인 나오는 대원', () => {
    const c = { shift: 3, absent: 2, fallen: 1, service: 1, marked: 4, closed: 2, ruin: 1, roads: 1, grown: 5 };
    expect(carryNextLine(c)).toBe('다음 교대로 넘기는 것: 결장 예상 2명 · 공석 1자리 · 정비 1대 · 출입 통제 건물 3곳(무너짐 1) · 복구 공사 도로 1구간.');
    expect(carryParts(c)).toBe('결장 2명 · 공석 1자리 · 정비 1대 · 출입 통제 건물 3곳(무너짐 1) · 복구 공사 도로 1구간');
    expect(carryParts({ ...c, absent: 0, fallen: 0, ruin: 0 })).toBe('정비 1대 · 출입 통제 건물 2곳 · 복구 공사 도로 1구간');
    const none = { shift: 2, absent: 0, fallen: 0, service: 0, marked: 3, closed: 0, ruin: 0, roads: 0, grown: 9 };
    expect(carryNextLine(none)).toBe('다음 교대로 넘기는 피해는 없습니다.');
    // carrySummary 는 상태에서 센다
    const x: Carryover = json(co);
    x.crew[0].out = 2; x.crew[1].out = -1; x.crew[1].replaceIn = 1; x.crew[2].out = 0; x.crew[2].dSkill = GROWN_MIN; x.crew[3].out = 0; x.crew[3].dSkill = GROWN_MIN / 2;
    const sm = carrySummary(x);
    expect(sm.absent).toBe(x.crew.filter((q) => q.out > 0).length);
    expect(sm.fallen).toBe(x.crew.filter((q) => q.out === -1).length);
    expect(sm.grown).toBe(x.crew.filter((q) => q.out === 0 && q.dSkill >= GROWN_MIN).length);
    expect(sm.service).toBe(x.units.filter((u) => u.service).length);
    expect(sm.roads).toBe(x.roads.length);
    expect(sm.marked + sm.closed + sm.ruin).toBe(x.places.length);
    expect(sm.shift).toBe(x.shift);
  });

  it('이어받은 상태로 시작한 교대의 교대 시작 문구: 가용 부대 수 = oos 가 아닌 부대 수, 대원 수 = 결장(off)이 아닌 대원 수', () => {
    const s = new Sim('P2', NORMAL, 1200, { carry: co });
    const oos = s.units.filter((u) => u.state === 'oos').length, avail = s.units.length - oos;
    const off = s.responders.filter((r) => r.status === 'off').length, crew = s.responders.length - off;
    expect(s.events[0].text).toContain(`가용 부대 ${avail}대${oos ? `(정비·결원 ${oos}대 제외)` : ''}, 대원 ${crew}명${off ? `(결장 ${off}명 제외)` : ''}.`);
    // 결장도 정비도 없는 이어받은 상태면 지금 문구와 같다 (단계 1 의 뜻 — 괄호가 붙지 않는다). (단계 3) P1 에서 펌프가 고장 난 부대의 정비도 지운다
    const calm: Carryover = json(co);
    for (const c of calm.crew) { c.out = 0; c.cause = null; delete c.replaceIn; delete c.recruit; }
    for (const x of calm.units) delete x.service;
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
    case 'service': return [n.unit, '정비 중'];                       // (단계 3)
    case 'rushed': return [n.unit, '급히'];
    case 'stock': return [n.unit, `${n.got}개만`, `정수 ${n.want}개`];
    case 'road': return [n.lane ? '한 차로 복구 공사' : '복구 공사로 통제', WHY_NAME[n.why], n.left === 1 ? `약 ${Math.max(1, Math.round(n.openAt / 60))}분 뒤` : '이번 교대 내내'];      // (단계 4)
    default: return [];
  }
}
/**
 * 시험 10 (장비 부분): 정비마다 그 부대가 정비를 마친 기록(정비 완료, 또는 나올 대원이 없어 결원)이 readyAt 이 지난 뒤 정확히 하나 — 상태를 바꾼 그 자리(tickCarry)의
 * 기록이고 요약 줄이 원인이다. 정비 완료 기록의 수 = stats.serviced, 정비 항목이 없는 부대에는 그런 기록이 없다
 */
const SERVICE_DONE = /^\S+ (정비 완료 — 운용 재개|정비를 마쳤지만 결원으로 운용하지 못합니다)\.$/;
function checkServiceLog(s: Sim): void {
  const cs = s.carryState, ev = cs.event;
  const done = s.events.filter((e) => e.kind === 'unit' && SERVICE_DONE.test(e.text));
  for (const e of done) expect(e.causes, e.text).toEqual([ev]);
  expect(done.filter((e) => e.text.endsWith('정비 완료 — 운용 재개.')).length).toBe(cs.stats.serviced);
  const svc = cs.applied.filter((n): n is Extract<typeof n, { what: 'service' }> => n.what === 'service');
  for (const n of svc) {
    const mine = done.filter((e) => e.actor === n.unit);
    expect(mine.length, n.unit).toBe(s.t >= n.readyAt ? 1 : 0);
    if (mine.length) { expect(mine[0].t).toBeGreaterThanOrEqual(n.readyAt - 1e-9); expect(mine[0].t).toBeLessThan(n.readyAt + s.dt); }      // readyAt 이 지난 첫 틱
  }
  expect(done.length).toBe(svc.filter((n) => s.t >= n.readyAt).length);
  expect(cs.svc).toBe(svc.filter((n) => s.t < n.readyAt).length);
}
/**
 * 시험 10 (대원 부분): 적용 목록과 기록의 일대일 — 요약 줄 바로 뒤에 항목마다 한 줄(요약 줄이 원인, 항목의 주인공이 문장에), 그 뒤에 버린 것의 줄.
 * 교대 시작(0초)에 요약 줄을 원인으로 한 기록은 그것뿐이다. 결장(off)인 대원은 모두 어느 결장·공석 항목에 이름이 있다. 교대 시작 문구의 가용 부대 수 = oos 가 아닌 부대 수
 */
/**
 * (단계 5) 적용 항목 → 교대 시작의 기록 id: 건물(place)은 출입 통제·무너짐과 통제가 풀린 건물(opened)을 따로, 앞의 PLACE_LINES 곳만 한 곳에 한 줄 — 그 뒤는 '외 n곳' 한 줄을 함께 쓴다
 * (시험 10 의 "건물의 '외 n곳' 줄은 n 으로 센다"). 그 밖의 항목은 한 항목에 한 줄. lines = 적용 목록이 남긴 기록 수
 */
function noteEvents(s: Sim): { ids: number[]; lines: number; group: number[]; size: Record<'shut' | 'open', number> } {
  const cs = s.carryState, ids: number[] = [], group: number[] = [];
  const cnt = { shut: 0, open: 0 }, outer = { shut: -1, open: -1 }, size = { shut: 0, open: 0 };
  for (const n of cs.applied) if (n.what === 'place') size[cs.places.get(n.id)!.state !== 'marked' ? 'shut' : 'open']++;
  let k = 0;
  for (const n of cs.applied) {
    if (n.what !== 'place') { ids.push(cs.event + 1 + k++); group.push(-1); continue; }
    const g = cs.places.get(n.id)!.state !== 'marked' ? 'shut' : 'open', i = cnt[g]++;
    group.push(i);
    if (i < PLACE_LINES) ids.push(cs.event + 1 + k++);
    else { if (i === PLACE_LINES) outer[g] = cs.event + 1 + k++; ids.push(outer[g]); }
  }
  return { ids, lines: k, group, size };
}
function checkCarryLog(s: Sim): void {
  const cs = s.carryState, ev = cs.event;
  expect(ev).toBeGreaterThan(0);
  const atStart = s.events.filter((e) => e.t === 0 && e.causes.indexOf(ev) >= 0);
  const { ids, lines, group, size } = noteEvents(s);
  expect(atStart.length).toBe(lines + cs.dropped.length);
  cs.applied.forEach((n, i) => {
    const e = s.events[ids[i]];
    expect(e.causes, n.what).toEqual([ev]);
    for (const w of mustSay(n)) expect(e.text, `${n.what}: ${w}`).toContain(w);
    if ('unit' in n) expect(e.actor).toBe(n.unit);
    if (n.what === 'place') {      // (단계 5) 건물 줄: 앞의 PLACE_LINES 곳은 그 건물의 이름·남은 교대, 그 뒤는 '외 n곳'
      const p = cs.places.get(n.id)!, q = s.city.places[n.id], shut = p.state !== 'marked';
      expect(e.tag).toBe('carry');
      if (group[i] < PLACE_LINES) {
        expect(e.text.startsWith(`${q.addr} ${q.name}`), e.text).toBe(true);
        expect(e.text).toContain(shut ? `${p.repair}교대 남음` : '복구 완료');
        if (p.state === 'ruin') expect(e.text).toContain('무너져');
      } else expect(e.text).toContain(`외 ${size[shut ? 'shut' : 'open'] - PLACE_LINES}곳`);
    }
  });
  cs.dropped.forEach((d, i) => expect(s.events[ev + 1 + lines + i].text).toBe(d));
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

/** (단계 4) 알려진 상태로(관제·경로가 보는 대로) 모든 시설에서 모든 교차로에 닿지 못하는 (시설, 교차로) 쌍의 수 — 작은 차·큰 차 모두 */
function unreachable(s: Sim): number {
  const c = s.city, N = c.nodes.length;
  let bad = 0;
  for (const heavy of [false, true]) for (const f of c.facilities) {
    const seen = new Uint8Array(N), st = [f.nodeId];
    seen[f.nodeId] = 1;
    while (st.length) {
      const n = st.pop()!;
      for (const id of c.nodes[n].edges) { const e = c.edges[id]; if (!passable(e, heavy)) continue; const v = e.a === n ? e.b : e.a; if (!seen[v]) { seen[v] = 1; st.push(v); } }
    }
    for (let i = 0; i < N; i++) if (!seen[i]) bad++;
  }
  return bad;
}
/**
 * 시험 10 (도로 부분): 복구 공사 항목마다 — 교대 시작의 줄(그 구간 이름 · 요약 줄이 원인 · tag 'carry'), 끝나는 공사(left 1)는 openAt 이 지난 첫 틱에 개통 기록이 정확히 하나
 * (전면 '복구 공사 완료 — 통행 재개' · 한 차로 '한 차로 복구 공사 완료' — 요약 줄이 원인, tag 'carry'), 교대 내내 막는 것(left 2)은 끝까지 'repair'.
 * 개통 기록의 수 = 지난 openAt 의 항목 수, stats.reopened = 그 가운데 전면, 남은 cs.roads = 아직 지나지 않은 항목
 */
const REOPEN = /^(.+) 복구 공사 완료 — 통행 재개\.$/, LANE_DONE = /^(.+) 한 차로 복구 공사 완료\.$/;
type RoadNote = Extract<Sim['carryState']['applied'][number], { what: 'road' }>;
function checkRoadLog(s: Sim): void {
  const cs = s.carryState, ev = cs.event;
  const notes = cs.applied.filter((n): n is RoadNote => n.what === 'road');
  const done = s.events.filter((e) => e.kind === 'traffic' && (REOPEN.test(e.text) || LANE_DONE.test(e.text)));
  for (const e of done) { expect(e.causes, e.text).toEqual([ev]); expect(e.tag, e.text).toBe('carry'); }
  for (const n of notes) {
    const name = edgeName(s.city, s.city.edges[n.edge]);
    const start = s.events[noteEvents(s).ids[cs.applied.indexOf(n)]];
    expect(start.text.startsWith(name + ' '), start.text).toBe(true);
    expect([start.actor, start.kind, start.tag]).toEqual(['교통정보', 'traffic', 'carry']);
    const mine = done.filter((e) => e.text.startsWith(name + ' ') && (n.lane ? LANE_DONE : REOPEN).test(e.text));
    const want = n.left === 1 && s.t >= n.openAt ? 1 : 0;
    expect(mine.length, name).toBe(want);
    if (want) { expect(mine[0].t).toBeGreaterThanOrEqual(n.openAt - 1e-9); expect(mine[0].t).toBeLessThan(n.openAt + s.dt + 1e-9); }
    if (n.left === 2 && !n.lane) expect(s.city.edges[n.edge].closedReason, name).toBe('repair');
  }
  expect(done.length).toBe(notes.filter((n) => n.left === 1 && s.t >= n.openAt).length);
  expect(cs.stats.reopened).toBe(notes.filter((n) => n.left === 1 && !n.lane && s.t >= n.openAt).length);
  expect(cs.roads.length).toBe(notes.filter((n) => n.left === 1 && s.t < n.openAt).length);
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

  it('(단계 7) 보고서: 명부(H1 roster)의 결장자 out 은 이어받을 상태의 값, 다음 교대 결장 예상 = 그 상태의 결장 수, 결원 도착이 있으면 조직 칸에 그 사건 수', () => {
    const rep = B.report!;
    for (const n of [X, Y, Z, W]) {
      const row = rep.roster!.find((q) => q.name === n)!;
      expect(row.out, n).toBe(entryOf(co2, n).out);
    }
    expect(rep.roster!.find((q) => q.name === Y)!.out).toBe(2);
    expect(rep.carryNext).toEqual(carrySummary(co2));
    expect(rep.carryNext!.absent).toBe(co2.crew.filter((c) => c.out > 0).length);
    const nShort = checkShortArrivals(B);
    const line = rep.carry!.lines.find((l) => l.startsWith('결원 부대가 나간 사건'));
    if (nShort > 0) expect(line).toBeDefined(); else expect(line).toBeUndefined();
    // (선택) 사건 분석 문장: 첫 도착이 결원 도착인 사건에만 — n = 그 부대에서 나온 내리는 대원
    for (const I of B.incidents) {
      const first = B.events.find((e) => e.incidentId === I.id && e.kind === 'arrive');
      const got = shortArrivalLine(B, I);
      if (!first || first.causes.indexOf(B.carryState.event) < 0) { expect(got).toBeNull(); continue; }
      const u = unitOf(B, first.actor), n = fieldCrew(B, u).filter((rid) => B.responders[rid].status !== 'off').length;
      const seats = fieldCrew(B, u).filter((rid) => !B.responders[rid].relief).length;      // (검토) 예비 인력이 결장 자리를 다 채운 부대는 정원으로 나갔다 — 문장이 없다
      if (n >= seats) { expect(got).toBeNull(); continue; }
      expect(got).toBe(`첫 출동 부대(${u.callsign})는 지난 교대의 결장으로 ${n}명만 출동했습니다.`);
      if (I.result!.delayed && I.result!.responseTime >= 0) expect(I.result!.analysis).toContain(got);
      else expect(I.result!.analysis.indexOf(got!)).toBe(-1);
    }
  });
});

// ───────────────────────── (검토) 결원 출동 분석 문장 — 실제로 모자라게 나간 부대만 ─────────────────────────
describe('(검토) 사건 분석의 결원 출동 문장은 실제로 모자라게 나간 부대에만', () => {
  // 검토 전에는 결장(off) 대원이 있는 부대의 첫 도착이면 언제나 "n명만 출동했습니다" 를 냈다 — 예비 인력이 결장 자리를 다 채워 정원으로 나간 부대에도
  // (어려움 8 × 5 계보에서 분석 문장 9개 가운데 6개가 "순찰2 … 2명만 (계획 2명)" 꼴). 결원 도착 기록의 원인(요약 줄)은 그대로다 — 예비 인력도 이어받은 상태의 영향이다
  let A: Sim, co: Carryover;
  beforeAll(() => {
    A = run('P1', undefined, NORMAL, 60);
    co = json(makeCarryover(A));
    for (const c of co.crew) if (c.out !== 0) { c.out = 0; c.cause = null; delete c.replaceIn; delete c.recruit; }
    for (const u of co.units) delete u.service;
    const p1 = unitOf(A, '순찰1'), e1 = unitOf(A, '진압1');
    const off = [A.responders[p1.crew[1]].name, A.responders[e1.crew[2]].name, A.responders[e1.crew[3]].name];      // 순찰1(2인) 하나 · 진압1(4인 — 최소 3) 둘
    for (const c of co.crew) if (off.indexOf(c.name) >= 0) { c.out = 1; c.cause = 'smoke'; c.health = BACK_HEALTH; }
  }, HOOK_MS);
  const firstBy = (seed: string, cs: string): { s: Sim; I: Incident } => {
    const s = run(seed, co);
    const I = s.incidents.find((J) => s.events.find((e) => e.incidentId === J.id && e.kind === 'arrive')?.actor === cs);
    expect(I, `${seed}: ${cs} 가 먼저 닿은 사건`).toBeDefined();
    return { s, I: I! };
  };
  const planned = (s: Sim, u: Unit): number => fieldCrew(s, u).filter((rid) => !s.responders[rid].relief).length;
  it('예비 인력이 다 채운 순찰1(결장 하나 → 예비 하나 = 정원 2)의 첫 도착: 결원 도착 기록(원인 요약 줄)은 남고, "n명만" 문장은 없다', () => {
    const { s, I } = firstBy('SA', '순찰1');
    const u = unitOf(s, '순찰1');
    expect(u.crew.some((rid) => s.responders[rid].relief)).toBe(true);
    expect(crewReady(s, u)).toBe(planned(s, u));
    expect(s.events.find((e) => e.incidentId === I.id && e.kind === 'arrive')!.causes).toContain(s.carryState.event);
    expect(shortArrivalLine(s, I)).toBeNull();
  }, HOOK_MS);
  it('실제로 모자란 진압1(정원 4 · 결장 둘 → 예비 하나 = 3)의 첫 도착에는 그 문장이 있다 — n = 나온 내리는 대원', () => {
    const { s, I } = firstBy('SB', '진압1');
    const u = unitOf(s, '진압1');
    expect(crewReady(s, u)).toBeLessThan(planned(s, u));
    expect(shortArrivalLine(s, I)).toBe('첫 출동 부대(진압1)는 지난 교대의 결장으로 3명만 출동했습니다.');
  }, HOOK_MS);
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
    // (단계 8) 식 그대로: gain = min(GAIN_CAP, xpGained × GAIN_K) × (1 − 경험) — GAIN_K 1.0 이면 xpGained 0.01 인 대원은 0.01 × (1 − 경험)
    const q = A.responders.find((x) => x.status === 'ok' && !x.relief && x !== r)!;
    q.xpGained = 0.01;
    const cq = entryOf(makeCarryover(A), q.name);
    expect(cq.dExp).toBeCloseTo(Math.min(GAIN_CAP, 0.01 * GAIN_K) * (1 - q.experience), 4);
    expect(GAIN_K).toBe(1);
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

// ───────────────────────── 8 (장비 부분). 펌프 범위 · 정비 · 섬광탄 창고 (단계 3) ─────────────────────────
describe('8. 장비 — 펌프 범위·정비·섬광탄 창고', () => {
  let co0: Carryover, s0: Sim;
  beforeAll(() => {
    const A = new Sim('P1', NORMAL, 60); A.runToEnd();
    co0 = calmCrew(makeCarryover(A));      // 60초 교대 — 펌프 고장·섬광탄 사용 없음: 정비 없음, 창고 10
    s0 = new Sim('P2', NORMAL, 1);
  }, HOOK_MS);
  /** 부대 항목·창고를 바꾼 상태 (대원은 결장 없이) */
  const withUnits = (units: UnitCarry[], stock?: number): Carryover => { const co = json(co0); co.units = json(units); if (stock !== undefined) co.stock = { flashbang: stock }; return co; };
  const svc = (callsign: string, readyAt: number): UnitCarry => ({ callsign, pump: SERVICE_PUMP, service: { readyAt, why: 'pump' } });
  const bangs = (s: Sim, cs: string): number[] => unitOf(s, cs).crew.map((rid) => s.responders[rid].kit?.find((it) => it.id === 'flashbang')?.uses ?? 0);
  const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);

  it('처음 상태: 60초 교대가 만든 상태는 정비 없이 소방 부대마다 펌프 한 항목(편성표 순서), 창고 10 (10 − 처음 지급 6 + 남은 6 + 3 → 상한)', () => {
    expect(co0.units.map((x) => x.callsign)).toEqual(s0.units.filter((u) => !u.aid && u.dept === 'fire').map((u) => u.callsign));
    expect(co0.units.every((x) => x.service === undefined && x.pump !== undefined)).toBe(true);
    expect(co0.stock).toEqual({ flashbang: STOCK_CAP });
  });

  it('펌프: 장비 손잡이는 범위, 이어받은 값은 그 안의 위치 (장비 1 에 0.95 → 0.55 · 0.1 → 0.21), 항목이 없으면 뽑은 값 그대로, 기록은 남기지 않는다', () => {
    const E1: Difficulty = { ...NORMAL, equipment: 1 };
    const base = new Sim('P2', E1, 1);
    const s = new Sim('P2', E1, 1, { carry: withUnits([{ callsign: '진압1', pump: 0.95 }, { callsign: '진압2', pump: 0.1 }, { callsign: '순찰1', pump: 0.5 }]) });
    expect(unitOf(s, '진압1').pumpCond).toBe(0.55);
    expect(unitOf(s, '진압2').pumpCond).toBe(0.21);
    expect(unitOf(s, '진압3').pumpCond).toBe(unitOf(base, '진압3').pumpCond);      // equipment 흐름은 그대로 다 뽑았다
    expect(unitOf(s, '순찰1').pumpCond).toBe(1);                                 // 펌프가 없는 부대는 건드리지 않는다
    expect(s.carryState.applied).toEqual([]);
    expect(unitOf(new Sim('P2', NORMAL, 1, { carry: withUnits([{ callsign: '진압1', pump: 0.95 }]) }), '진압1').pumpCond).toBe(0.95);      // 보통(0.3~1.0) 안이면 그대로
  });

  it('정비 중(readyAt 120)인 부대: 120초 전에는 oos 이고 배정되지 않으며, 120초에 정비 완료 기록(요약 줄이 원인)과 함께 운용에 들어간다', () => {
    const s = new Sim('P2', NORMAL, 1200, { carry: withUnits([svc('진압1', 120)]) });
    const u = unitOf(s, '진압1'), cs = s.carryState;
    expect([u.state, u.oosWhy, u.readyAt, cs.svc]).toEqual(['oos', '정비 중', 120, 1]);
    expect(cs.applied).toEqual([{ what: 'service', unit: '진압1', readyAt: 120, why: 'pump' }]);
    expect(s.events.some((e) => e.t === 0 && e.text === '진압1 펌프 정비 중 — 약 2분 뒤 운용.')).toBe(true);
    expect(s.events[cs.event].text).toContain('정비 중 1대');
    expect(s.events[0].text).toContain('(정비·결원 1대 제외)');
    checkCarryLog(s);
    while (s.t + s.dt < 120 - 1e-9) {
      s.step();
      expect(u.state, `${s.t}`).toBe('oos');
    }
    expect(u.runs).toBe(0);
    expect(u.dispatchedAt).toBe(-1);
    expect(s.events.some((e) => SERVICE_DONE.test(e.text))).toBe(false);
    s.step();
    const done = s.events.filter((e) => e.text === '진압1 정비 완료 — 운용 재개.');
    expect(done.length).toBe(1);
    expect(done[0].causes).toEqual([cs.event]);
    expect(done[0].t).toBeGreaterThanOrEqual(120 - 1e-9);
    expect(u.state).not.toBe('oos');
    expect([u.oosWhy, u.readyAt, cs.svc, cs.stats.serviced]).toEqual([undefined, undefined, 0, 1]);
    s.runToEnd();
    checkServiceLog(s);
  });

  it('짧은 교대에서는 정비 시각을 shiftLen × 0.75 로 자른다 (500초 교대에 900 → 375초)', () => {
    const s = new Sim('P2', NORMAL, 500, { carry: withUnits([svc('진압2', 900)]) });
    expect(unitOf(s, '진압2').readyAt).toBe(375);
    expect(s.carryState.applied).toEqual([{ what: 'service', unit: '진압2', readyAt: 375, why: 'pump' }]);
    s.runToEnd();
    checkServiceLog(s);
    expect(s.carryState.stats.serviced).toBe(1);
  });

  it('정비는 한꺼번에 두 대까지 (이른 순) — 셋째는 급히 정비를 마치고(펌프 0.6) 바로 운용한다', () => {
    const s = new Sim('P2', NORMAL, 1200, { carry: withUnits([svc('진압1', 300), svc('진압2', 200), svc('진압3', 500)]) });
    const cs = s.carryState;
    expect(cs.applied).toEqual([
      { what: 'service', unit: '진압1', readyAt: 300, why: 'pump' },
      { what: 'service', unit: '진압2', readyAt: 200, why: 'pump' },
      { what: 'rushed', unit: '진압3' },
    ]);
    expect(cs.svc).toBe(SERVICE_CAP);
    const u3 = unitOf(s, '진압3');
    expect([u3.state, u3.readyAt, u3.oosWhy, u3.pumpCond]).toEqual(['available', undefined, undefined, RUSHED_PUMP]);
    expect(s.events.some((e) => e.text === '진압3 정비가 밀려 급히 마쳤습니다 — 바로 운용합니다.')).toBe(true);
    expect(s.events[0].text).toContain('(정비·결원 2대 제외)');
    checkCarryLog(s);
  });

  it('정비를 마쳐도 나올 대원이 없으면 결원으로 운용하지 못한다 (정비 중인 부대에는 예비 인력이 붙지 않는다)', () => {
    const co = withUnits([svc('진압2', 30)]);
    setOut(co, namesOf(s0, '진압2'));
    const s = new Sim('P2', NORMAL, 1200, { carry: co });
    const u = unitOf(s, '진압2'), cs = s.carryState;
    expect(cs.stats.relief).toBe(0);
    expect(u.crew.some((rid) => s.responders[rid].relief)).toBe(false);
    expect(cs.applied.filter((n) => n.what !== 'absent')).toEqual([{ what: 'service', unit: '진압2', readyAt: 30, why: 'pump' }]);
    checkCarryLog(s);
    s.run(Math.ceil(30 / s.dt) + 1);
    expect(s.events.filter((e) => e.text === '진압2 정비를 마쳤지만 결원으로 운용하지 못합니다.').length).toBe(1);
    expect([u.state, u.oosWhy, u.readyAt, cs.svc, cs.stats.serviced]).toEqual(['oos', '결원', undefined, 0, 0]);
    checkServiceLog(s);
  });

  it('끝 상태 → 다음 교대: 고장 난 펌프는 정밀 정비(0.7 · 정비 시각 300~720초), 아니면 점검(+0.12) — 펌프가 없는 부대는 넣지 않는다, 몇 번 불러도 같다', () => {
    const B = new Sim('P1', NORMAL, 60); B.runToEnd();
    Object.assign(unitOf(B, '진압1'), { pumpFails: 1, pumpCond: 0.62 });         // 고장 뒤 현장에서 예비 펌프로 바꾼 부대 (pumpFailed 는 풀렸다)
    Object.assign(unitOf(B, '진압2'), { pumpFailed: true, pumpCond: 0.15 });     // 고장 난 채 돌아오지 못하고 끝난 부대
    unitOf(B, '진압3').pumpCond = 0.5;
    unitOf(B, '사다리1').pumpCond = 0.95;
    const co = makeCarryover(B);
    const by = (cs: string): UnitCarry | undefined => co.units.find((x) => x.callsign === cs);
    for (const cs of ['진압1', '진압2']) {
      const x = by(cs)!;
      expect(x.pump, cs).toBe(SERVICE_PUMP);
      expect(x.service!.why).toBe('pump');
      expect(Number.isInteger(x.service!.readyAt)).toBe(true);
      expect(x.service!.readyAt).toBeGreaterThanOrEqual(SERVICE_AT[0]);
      expect(x.service!.readyAt).toBeLessThanOrEqual(SERVICE_AT[1]);
    }
    expect(by('진압3')).toEqual({ callsign: '진압3', pump: 0.5 + PUMP_REST });
    expect(by('사다리1')).toEqual({ callsign: '사다리1', pump: 1 });
    expect(by('순찰1')).toBeUndefined();
    expect(makeCarryover(B)).toEqual(co);      // carry 흐름 — 교대 시드에서 갈라진다
    expect(readCarryover(json(co), B.city)!.carry).toEqual(co);
    expect(unsafeAt(co)).toBeNull();
    // 그다음 교대: 정비는 SERVICE_CAP 안이라 둘 다 정비 중, 그 교대가 끝나면 다음 상태에는 정비가 없다 (교대 안에 마쳤다 — 펌프는 점검만)
    const C = new Sim('P2', NORMAL, 1200, { carry: co });
    expect(C.carryState.applied.flatMap((n) => (n.what === 'service' ? [n.unit] : []))).toEqual(['진압1', '진압2']);
    expect(unitOf(C, '진압1').pumpCond).toBe(SERVICE_PUMP);
  });

  it('편성되지 않은 부대는 휴식만 — 펌프 +0.12, 정비는 휴식에서 마친다', () => {
    const L1: Difficulty = { ...NORMAL, resources: 1 }, L5: Difficulty = { ...NORMAL, resources: 5 };
    const small = new Sim('Q1', L1, 60), big = new Sim('Q1', L5, 1);
    const cs = big.units.find((u) => u.dept === 'fire' && !small.units.some((q) => q.callsign === u.callsign))!.callsign;
    const s = new Sim('Q1', L1, 60, { carry: withUnits([{ callsign: cs, pump: 0.5, service: { readyAt: 400, why: 'pump' } }]) });
    expect(s.carryState.applied).toEqual([]);      // 편성되지 않은 부대의 정비는 적용하지 않는다
    s.runToEnd();
    expect(makeCarryover(s).units.find((x) => x.callsign === cs)).toEqual({ callsign: cs, pump: 0.5 + PUMP_REST });
  });

  it('섬광탄 창고 1 (보통): 편성표 순서로 기동1 이 창고에서 1개, 특공1 은 비상 지급 1개 — 모자란 수 4, 부대마다 기록 한 줄', () => {
    const s = new Sim('P2', NORMAL, 1200, { carry: withUnits(co0.units, 1) });
    const cs = s.carryState;
    expect(cs.applied).toEqual([{ what: 'stock', unit: '기동1', got: 1, want: 2 }, { what: 'stock', unit: '특공1', got: 1, want: 4 }]);
    expect(cs.stats.fbShort).toBe(4);
    expect(cs.fbStore).toBe(0);
    for (const c of ['기동1', '특공1']) { expect(unitOf(s, c).flashbangs, c).toBe(1); expect(sum(bangs(s, c)), c).toBe(1); }
    expect(s.events.some((e) => e.text === '섬광탄 재고 부족 — 기동1 1개만 지급 (정수 2개).')).toBe(true);
    expect(s.events.some((e) => e.text === '섬광탄 재고 부족 — 특공1 1개만 지급 (정수 4개).')).toBe(true);
    checkCarryLog(s);
    // 창고가 넉넉하면 지금과 같은 수·같은 사람 몫, 기록 없음. 창고가 비어도(0) 정수가 1 이상인 부대는 1개씩
    const full = new Sim('P2', NORMAL, 1, { carry: withUnits(co0.units, STOCK_CAP) });
    for (const c of ['기동1', '특공1']) { expect(unitOf(full, c).flashbangs).toBe(unitOf(s0, c).flashbangs); expect(bangs(full, c)).toEqual(bangs(s0, c)); }
    expect(full.carryState.applied).toEqual([]);
    expect(full.carryState.fbStore).toBe(STOCK_CAP - 6);
    const empty = new Sim('P2', NORMAL, 1, { carry: withUnits(co0.units, 0) });
    expect(['기동1', '특공1'].map((c) => unitOf(empty, c).flashbangs)).toEqual([1, 1]);
    expect(empty.carryState.stats.fbShort).toBe(4);
  });

  it('창고 = min(10, 지급 뒤 창고 + 남은 섬광탄 + 3): 여섯 개를 다 쓰는 교대가 두 번이면 10 → 7 → 4, 셋째 교대에 특공1 이 2개 덜 받고, 조용한 교대 한 번이면 모자라지 않는다', () => {
    const useAll = (s: Sim): void => { for (const u of s.units) { u.flashbangs = 0; for (const rid of u.crew) for (const it of s.responders[rid].kit ?? []) if (it.id === 'flashbang') it.uses = 0; } };
    const s1 = new Sim('P1', NORMAL, 60); s1.runToEnd();
    useAll(s1);
    const c2 = makeCarryover(s1);
    expect(c2.stock.flashbang).toBe(STOCK_CAP - 6 + 0 + RESUPPLY);      // 7
    const s2 = new Sim('P2', NORMAL, 60, { carry: calmCrew(c2) });
    expect(s2.carryState.applied.some((n) => n.what === 'stock')).toBe(false);
    expect(s2.carryState.fbStore).toBe(1);
    s2.runToEnd(); useAll(s2);
    const c3 = makeCarryover(s2);
    expect(c3.stock.flashbang).toBe(4);
    const s3 = new Sim('P3', NORMAL, 60, { carry: calmCrew(c3) });
    expect(s3.carryState.applied.filter((n) => n.what === 'stock')).toEqual([{ what: 'stock', unit: '특공1', got: 2, want: 4 }]);
    // 줄일 때는 자리 순서의 뒤에서부터 1개씩: 정수 4 의 나눔 [팀장 2 · 진입(파괴) 1 · 진입 1] 에서 둘을 빼면 [2 · 0 · 0]
    expect(bangs(s0, '특공1')).toEqual([2, 0, 1, 1, 0]);
    expect(bangs(s3, '특공1')).toEqual([2, 0, 0, 0, 0]);
    s3.runToEnd();
    const c4 = makeCarryover(s3);
    expect(c4.stock.flashbang).toBe(0 + 2 + 2 + RESUPPLY);
    expect(new Sim('P4', NORMAL, 1, { carry: calmCrew(c4) }).carryState.applied.some((n) => n.what === 'stock')).toBe(false);
  });

  it('정비·재고 부족이 있는 교대도 같은 입력이면 같은 결과 (그대로·JSON 왕복), 정비마다 정비 완료 기록 하나', () => {
    const co = withUnits([svc('진압1', 200), svc('사다리1', 400)], 2);
    const a = run('P2', co), b = run('P2', json(co));
    expect(b.report!.hash).toBe(a.report!.hash);
    expect(a.report!.hash).not.toBe(run('P2', co0).report!.hash);
    expect(a.carryState.stats.serviced).toBe(2);
    checkServiceLog(a);
    checkShortArrivals(a);
    expect(makeCarryover(a)).toEqual(makeCarryover(b));
  });
});

// ───────────────────────── 4. 수리된 도로가 열린다 (단계 4) ─────────────────────────
describe('4. 수리된 도로가 열린다 — 복구 공사의 적용·개통·우회로', () => {
  let co0: Carryover, city: City, picks: RoadEdge[], dead: RoadEdge, hub: RoadEdge[];
  beforeAll(() => {
    const A = new Sim('P1', NORMAL, 60); A.runToEnd();
    co0 = calmCrew(makeCarryover(A));      // 60초 교대 — 결장·정비·섬광탄 부족 없음: 적용 목록에는 도로만 남는다
    city = A.city;
    const fac = new Set(city.facilities.map((f) => f.nodeId));
    // 간선 아닌 구간 가운데 큰 차도 그 구간 없이 양 끝을 오가는 것 (시설 교차로에 닿지 않고, 양 끝의 길이 셋 이상) — 서로 끝을 나누지 않는 넷
    const cands = city.edges.filter((e) => !e.arterial && e.cls !== 'highway' && !fac.has(e.a) && !fac.has(e.b) && city.nodes[e.a].edges.length >= 3 && city.nodes[e.b].edges.length >= 3 && findRoute(city, e.a, e.b, 1, e.id, true));
    picks = [];
    for (const e of cands) if (picks.length < 4 && picks.every((q) => q.a !== e.a && q.a !== e.b && q.b !== e.a && q.b !== e.b)) picks.push(e);
    dead = city.edges.find((e) => !fac.has(e.a) && !fac.has(e.b) && (city.nodes[e.a].edges.length === 1 || city.nodes[e.b].edges.length === 1))!;
    // 한 교차로의 모든 구간 — 다 막으면 그 교차로가 끊긴다
    const n = city.nodes.find((q) => q.edges.length >= 3 && q.edges.length <= 4 && !fac.has(q.id) && q.edges.every((id) => !city.edges[id].arterial))!;
    hub = n.edges.map((id) => city.edges[id]);
  }, HOOK_MS);
  const road = (e: RoadEdge, o: Partial<RoadCarry> = {}): RoadCarry => ({ edge: e.id, why: 'crack', lane: false, left: 1, openAt: 60, inc: '조직 1번째 교대 · 지진', since: 1, ...o });
  const withRoads = (roads: RoadCarry[]): Carryover => { const co = json(co0); co.roads = json(roads); return co; };

  it('준비: 고른 구간이 넷, 막다른 구간이 하나 있다', () => {
    expect(picks.length).toBe(4);
    expect(dead).toBeTruthy();
    expect(hub.length).toBeGreaterThanOrEqual(3);
  });

  it('전면 공사 E 는 교대 시작부터 repair 로 닫혀(알려진 통제) 경로가 피하고 openAt 60 이 지나면 열린다 — 같은 openAt 의 한 차로 공사 F 도 함께 끝난다 (머리의 항목이 뒤를 막지 않는다)', () => {
    const [E, F] = picks;
    const s = new Sim('P6', NORMAL, 1200, { carry: withRoads([road(F, { lane: true, why: 'flood' }), road(E)]) });
    const e = s.city.edges[E.id], f = s.city.edges[F.id], cs = s.carryState;
    expect([e.closed, e.closedReason, e.known]).toEqual([true, 'repair', undefined]);
    expect(f.closed).toBe(false);
    expect(f.slow).toBeCloseTo(LANE_SLOW, 12);
    // openAt 이 같으면 구간 id 순
    const want = [{ what: 'road', edge: E.id, lane: false, left: 1, openAt: 60, why: 'crack' }, { what: 'road', edge: F.id, lane: true, left: 1, openAt: 60, why: 'flood' }].sort((a, b) => a.edge - b.edge);
    expect(cs.applied).toEqual(want);
    expect(s.events[cs.event].text).toContain('복구 공사 도로 2구간');
    checkCarryLog(s);
    checkRoadLog(s);
    // 교통의 장부: 닫힘·감속의 주인 = 그 구간의 줄 (교통 모델이 생긴 뒤 적었다)
    const lineOf = (x: RoadEdge): number => s.events.findIndex((q) => q.t === 0 && q.text.startsWith(edgeName(s.city, x) + ' '));
    expect(s.traffic.closeEv[E.id]).toBe(lineOf(E));
    expect(s.traffic.slowEv[F.id]).toBe(lineOf(F));
    s.step();
    const r = findRoute(s.city, e.a, e.b), rh = findRoute(s.city, e.a, e.b, 1, -1, true);
    expect(r).not.toBeNull(); expect(r!.edges).not.toContain(E.id);
    expect(rh).not.toBeNull(); expect(rh!.edges).not.toContain(E.id);
    while (s.t < 61) s.step();
    expect([e.closed, e.closedReason]).toEqual([false, null]);
    expect(f.slow).toBe(0);
    expect(cs.slowed).toEqual([]);
    expect(s.events.filter((q) => q.text === `${edgeName(s.city, e)} 복구 공사 완료 — 통행 재개.`).length).toBe(1);
    expect(s.events.filter((q) => q.text === `${edgeName(s.city, f)} 한 차로 복구 공사 완료.`).length).toBe(1);
    expect(cs.stats.reopened).toBe(1);
    checkRoadLog(s);
  });

  it('교대 내내 막는 공사(left 2)는 끝까지 닫혀 있고, 다음 상태에서 left 1 (openAt 120~600 정수) 이 된다 — 짧은 교대에서는 openAt 을 shiftLen × 0.75 로 자른다 (500초 교대에 900 → 375초)', () => {
    const [, , G, H] = picks;
    const s = new Sim('P7', NORMAL, 500, { carry: withRoads([road(G, { left: 2, openAt: 900, why: 'debris', inc: '조직 1번째 교대 · 03 건물 붕괴' }), road(H, { openAt: 900, why: 'washout' })]) });
    const g = s.city.edges[G.id], h = s.city.edges[H.id], cs = s.carryState;
    expect(cs.applied.find((n) => n.what === 'road' && n.edge === H.id)).toMatchObject({ openAt: 375, left: 1 });
    expect(cs.roads.map((r) => [r.edge, r.openAt])).toEqual([[H.id, 375]]);
    expect(cs.held.map((r) => r.edge)).toEqual([G.id]);
    expect(s.events.some((q) => q.text === `${edgeName(s.city, g)} 복구 공사로 통제 — ${WHY_NAME.debris} (이번 교대 내내).`)).toBe(true);
    while (!s.ended) {
      s.step();
      expect(g.closedReason, `${s.t}`).toBe('repair');
      if (s.t < 375 - 1e-6) expect(h.closed, `${s.t}`).toBe(true);
      else if (s.t > 375 + s.dt) expect(h.closed, `${s.t}`).toBe(false);
    }
    checkRoadLog(s);
    const next = makeCarryover(s), rg = next.roads.find((r) => r.edge === G.id)!;
    expect(rg).toMatchObject({ edge: G.id, why: 'debris', lane: false, left: 1, inc: '조직 1번째 교대 · 03 건물 붕괴', since: 1 });
    expect(Number.isInteger(rg.openAt)).toBe(true);
    expect(rg.openAt).toBeGreaterThanOrEqual(ROAD_AT.carried[0]); expect(rg.openAt).toBeLessThanOrEqual(ROAD_AT.carried[1]);
    expect(next.roads.some((r) => r.edge === H.id)).toBe(false);      // 이번 교대에 끝난 공사는 넘기지 않는다
    expect(makeCarryover(s)).toEqual(next);                           // carry 흐름 — 몇 번 불러도 같다
    expect(readCarryover(json(next), s.city)!.carry).toEqual(next);
  });

  it('끊기는 통제는 놓지 않는다: 막다른 구간은 닫히지 않고 버린 것에 한 줄, 다음 상태에도 없다. 한 교차로의 구간을 모두 넣으면 마지막 것들을 놓지 않는다 — 0틱에 모든 시설에서 모든 교차로로 간다', () => {
    const s = new Sim('P8', NORMAL, 1200, { carry: withRoads([road(dead, { left: 2, openAt: 900 })]) });
    const d = s.city.edges[dead.id], cs = s.carryState;
    expect(d.closed).toBe(false);
    expect(cs.applied).toEqual([]);
    expect(cs.held).toEqual([]);
    const drop = `${edgeName(s.city, d)}: 통제하면 길이 끊겨 복구 공사를 미룹니다.`;
    expect(cs.dropped).toContain(drop);
    expect(s.events.filter((q) => q.text === drop).length).toBe(1);
    checkCarryLog(s);
    expect(unreachable(s)).toBe(0);
    s.run(50);
    s.runToEnd();
    expect(makeCarryover(s).roads.some((r) => r.edge === dead.id)).toBe(false);
    // 한 교차로의 모든 구간 (+ 고른 넷 — 많아야 ROAD_CAP 이 읽힌다): 놓은 것만 닫히고 길은 끊기지 않는다
    const list = [...hub, ...picks].slice(0, ROAD_CAP).map((e, i) => road(e, { openAt: 120 + i }));
    const s2 = new Sim('P8', NORMAL, 1200, { carry: withRoads(list) });
    const placed = s2.carryState.applied.filter((n): n is RoadNote => n.what === 'road');
    expect(placed.length).toBeLessThan(list.length);
    expect(placed.length + s2.carryState.dropped.filter((x) => x.endsWith('복구 공사를 미룹니다.')).length).toBe(list.length);
    for (const e of s2.city.edges) expect(e.closedReason === 'repair').toBe(placed.some((n) => n.edge === e.id));
    expect(unreachable(s2)).toBe(0);
    s2.step();
    expect(unreachable(s2)).toBe(0);
    checkCarryLog(s2);
  });

  it('출입 통제·무너짐 건물 앞 구간은 교대 내내 느리다 (같은 구간이면 한 번, 흔적만 남은 건물은 아니다) — 개통에서 되돌리지 않는다', () => {
    const qs = city.places.filter((q) => q.facility < 0 && !q.open && q.edgeId !== undefined);
    const a = qs[0], b = qs.find((q) => q.edgeId === a.edgeId && q.id !== a.id) ?? qs[1], c = qs.find((q) => q.edgeId !== a.edgeId && q.edgeId !== b.edgeId)!;
    const co = json(co0);
    co.places = [
      { id: a.id, state: 'closed', dmg: 0.4, soot: 0.5, repair: 2, cause: 'fire', inc: '조직 1번째 교대 · 02 화재', since: 1 },
      { id: b.id, state: 'ruin', dmg: 1, soot: 0, repair: 3, cause: 'collapse', inc: '조직 1번째 교대 · 05 붕괴', since: 1 },
      { id: c.id, state: 'marked', dmg: 0.1, soot: 0.3, repair: 0, cause: 'fire', inc: '조직 1번째 교대 · 07 화재', since: 1 },
    ].sort((x, y) => x.id - y.id) as PlaceCarry[];
    const s = new Sim('P9', NORMAL, 300, { carry: co });
    const fronts = new Set([a.edgeId!, b.edgeId!]);
    expect(s.carryState.slowed.filter((q) => q.why === 'front').map((q) => q.edge).sort((x, y) => x - y)).toEqual([...fronts].sort((x, y) => x - y));
    for (const id of fronts) expect(s.city.edges[id].slow).toBeCloseTo(FRONT_SLOW, 12);
    if (!fronts.has(c.edgeId!)) expect(s.city.edges[c.edgeId!].slow).toBe(0);
    s.runToEnd();
    for (const id of fronts) expect(s.city.edges[id].slow).toBeGreaterThanOrEqual(FRONT_SLOW - 1e-9);
  });

  it('복구 공사가 있는 교대도 같은 입력이면 같은 결과 (그대로·JSON 왕복), 이어받은 상태가 없는 교대와는 다르다', () => {
    const [E, F, G] = picks;
    const co = withRoads([road(E, { openAt: 200 }), road(F, { lane: true, openAt: 300, why: 'fire' }), road(G, { left: 2, openAt: 900, why: 'debris' })]);
    const a = run('P10', co, NORMAL, 600), b = run('P10', json(co), NORMAL, 600), c = run('P10', undefined, NORMAL, 600);
    expect(a.report!.hash).toBe(b.report!.hash);
    expect(a.report!.hash).not.toBe(c.report!.hash);
    checkRoadLog(a);
    expect(a.incidents.every((I) => I.phase === 'closed')).toBe(true);
  });
});

// ───────────────────────── 4. 끝 상태 → 다음 교대의 복구 공사 (원천 표 — 단계 4) ─────────────────────────
describe('4. 끝 상태 → 다음 교대의 복구 공사 (원천: 사건·잔해·같은 구간·상한)', () => {
  let A: Sim, edges: RoadEdge[];
  beforeAll(() => {
    A = new Sim('P11', NORMAL, 400, { force: 'collapse/std' }); A.runToEnd();
    const fac = new Set(A.city.facilities.map((f) => f.nodeId));
    edges = A.city.edges.filter((e) => !e.closed && !fac.has(e.a) && !fac.has(e.b) && findRoute(A.city, e.a, e.b, 1, e.id, true)).slice(0, 12);
  }, HOOK_MS);
  /** 끝난 교대에 사건 하나를 꾸며 붙인다 (makeCarryover 가 읽는 칸만 — 순수 함수의 원천 표를 시험한다) */
  const fake = (s: Sim, variant: string, edge: number, closeReason: string, placeId = -1): Incident => {
    const I = { id: s.incidents.length, code: String(s.incidents.length + 1).padStart(2, '0'), blockedEdge: edge, closeReason, phase: 'closed', truth: { type: 'traffic', variant, placeId } } as unknown as Incident;
    s.incidents.push(I);
    return I;
  };

  it('산사태·쓰러진 나무는 다 치우지 못하고 닫혔을 때만(전면), 다중 추돌은 끝난 이유와 상관없이(한 차로 노면 보수) — 시각은 표의 범위, 이름은 사건 번호', () => {
    const s = new Sim('P11', NORMAL, 60); s.runToEnd();
    const [e1, e2, e3, e4, e5] = edges;
    const i1 = fake(s, 'landslide', e1.id, 'timeout'), i2 = fake(s, 'tree', e2.id, 'shiftend'), i3 = fake(s, 'pileup', e3.id, 'resolved');
    fake(s, 'tree', e4.id, 'resolved'); fake(s, 'landslide', e5.id, 'resolved');      // 다 치웠다 — 넘기지 않는다
    const roads = makeCarryover(s).roads;
    expect(roads.map((r) => r.edge)).toEqual([e1.id, e2.id, e3.id].sort((a, b) => a - b));
    const by = (id: number): RoadCarry => roads.find((r) => r.edge === id)!;
    expect(by(e1.id)).toMatchObject({ why: 'mud', lane: false, left: 1, inc: `조직 1번째 교대 · ${i1.code} 산사태`, since: 1 });
    expect(by(e2.id)).toMatchObject({ why: 'tree', lane: false, left: 1, inc: `조직 1번째 교대 · ${i2.code} 쓰러진 나무` });
    expect(by(e3.id)).toMatchObject({ why: 'surface', lane: true, left: 1, inc: `조직 1번째 교대 · ${i3.code} 다중 추돌` });
    for (const [id, span] of [[e1.id, ROAD_AT.mud], [e2.id, ROAD_AT.tree], [e3.id, ROAD_AT.surface]] as const) {
      const r = by(id);
      expect(Number.isInteger(r.openAt)).toBe(true);
      expect(r.openAt).toBeGreaterThanOrEqual(span[0]); expect(r.openAt).toBeLessThanOrEqual(span[1]);
    }
    expect(readCarryover(json(makeCarryover(s)), s.city)!.carry.roads).toEqual(roads);
  });

  it('무너진 건물의 잔해: (가) 이 사건이 무너뜨린 건물(X6 collapsed)이 막았던 구간 → 다음 교대 내내(left 2) · (나) 교대 끝까지 남은 잔해 장애물 → left 1 (전면이면 전면) · 같은 구간이면 (가)', () => {
    const s = new Sim('P11', NORMAL, 60); s.runToEnd();
    const [e1, e2, e3, e4] = edges;
    const place = s.city.places.find((q) => q.facility < 0 && !q.open)!;
    const I = fake(s, 'std', e1.id, 'resolved', place.id);
    s.placeMarks.set(place.id, { placeId: place.id, state: 'collapsed', t: 30, incidentId: I.id, burnFrac: 0, ruinFrac: 1 });
    const J = fake(s, 'std', e4.id, 'resolved', place.id);      // 같은 건물이지만 무너뜨린 사건이 아니다 — 넘기지 않는다
    expect(J.blockedEdge).toBe(e4.id);
    const o1 = addObstacle(s, { edge: e2.id, kind: 'rubble', full: true, dur: 1e6, known: true, quiet: true })!;
    const o2 = addObstacle(s, { edge: e3.id, kind: 'rubble', full: false, dur: 1e6, known: true, quiet: true })!;
    const o3 = addObstacle(s, { edge: e1.id, kind: 'rubble', full: false, dur: 1e6, known: true, quiet: true })!;      // (가)와 같은 구간 — 한 차로 잔해
    expect([o1, o2, o3].every((o) => !!o)).toBe(true);
    const roads = makeCarryover(s).roads, by = (id: number): RoadCarry | undefined => roads.find((r) => r.edge === id);
    expect(by(e1.id)).toMatchObject({ why: 'debris', lane: false, left: 2, inc: `조직 1번째 교대 · ${I.code} 건물 붕괴` });
    expect(by(e2.id)).toMatchObject({ why: 'debris', lane: false, left: 1 });
    expect(by(e3.id)).toMatchObject({ why: 'debris', lane: true, left: 1 });
    expect(by(e4.id)).toBeUndefined();
    for (const id of [e2.id, e3.id]) { const r = by(id)!; expect(r.openAt).toBeGreaterThanOrEqual(ROAD_AT.rubble[0]); expect(r.openAt).toBeLessThanOrEqual(ROAD_AT.rubble[1]); }
    expect(readCarryover(json(makeCarryover(s)), s.city)!.carry.roads).toEqual(roads);
  });

  it('같은 구간의 두 공사는 남은 교대 → 전면 → 늦게 끝나는 것으로 하나만, 상한 6 (남은 교대·전면·이른 것 순으로 남긴다), 구간 id 순', () => {
    const s = new Sim('P11', NORMAL, 60); s.runToEnd();
    const many = edges.slice(0, 9);
    many.forEach((e, k) => fake(s, k % 2 ? 'tree' : 'pileup', e.id, 'timeout'));      // 나무 4 (전면) · 추돌 5 (한 차로)
    const roads = makeCarryover(s).roads;
    expect(roads.length).toBe(ROAD_CAP);
    expect(roads.map((r) => r.edge)).toEqual(roads.map((r) => r.edge).slice().sort((a, b) => a - b));
    expect(roads.filter((r) => !r.lane).length).toBe(4);      // 전면이 먼저 남는다
    const lanes = many.filter((_, k) => k % 2 === 0).map((e) => roads.find((r) => r.edge === e.id)).filter((r): r is RoadCarry => !!r);
    expect(lanes.length).toBe(2);
    // 같은 구간: 나무(전면 left 1)와 추돌(한 차로 left 1) → 전면
    const t = new Sim('P11', NORMAL, 60); t.runToEnd();
    fake(t, 'pileup', edges[0].id, 'timeout'); fake(t, 'tree', edges[0].id, 'timeout');
    expect(makeCarryover(t).roads).toEqual([expect.objectContaining({ edge: edges[0].id, why: 'tree', lane: false })]);
  });

  it('이어받은 상태가 없는 끝난 교대의 복구 공사는 사건·재난·잔해에서만 — 평범한 교대(사건이 길을 막지 않음)는 빈 목록이고 makeCarryover 는 순수하다', () => {
    const roads = makeCarryover(A).roads;
    expect(roads.length).toBeLessThanOrEqual(ROAD_CAP);
    for (const r of roads) expect(['debris', 'mud', 'tree', 'surface']).toContain(r.why);
    const h = A.report!.hash, n = A.events.length;
    expect(makeCarryover(A)).toEqual(makeCarryover(A));
    expect([A.report!.hash, A.events.length]).toEqual([h, n]);
    const quiet = new Sim('P1', NORMAL, 60); quiet.runToEnd();
    expect(makeCarryover(quiet).roads).toEqual([]);
  });
});

// ───────────────────────── 11. 재난이 닫은 도로가 넘어온다 (단계 4) ─────────────────────────
describe('11. 재난이 닫은 도로가 넘어온다 (지진 → 균열 복구 공사)', () => {
  let A: Sim, co: Carryover, B: Sim, u0: number;
  beforeAll(() => {
    A = new Sim('Q2', { ...NORMAL, disaster: 'quake' }, 1200); A.runToEnd();
    co = makeCarryover(A);
    B = new Sim('Q2b', NORMAL, 1200, { carry: co });
    u0 = unreachable(B);
    B.step();
  }, HOOK_MS);

  it('지진 교대는 통제한 구간을 기록하고(d.damaged — 한 번씩, 통제한 순서), 다음 상태에 crack 이 1 이상 · 상한 이하 · 전면 crack 은 많아야 DIS_FULL', () => {
    const d = A.disaster!;
    expect(d.kind).toBe('quake');
    expect(d.damaged.length).toBeGreaterThanOrEqual(1);
    expect(new Set(d.damaged).size).toBe(d.damaged.length);
    expect(d.closedEdges.length).toBe(0);      // 1200초 교대에서는 재난이 끝나며 자기 통제를 모두 열었다 — 넘어오는 것은 기록(damaged)이다
    const cracks = co.roads.filter((r) => r.why === 'crack');
    expect(cracks.length).toBeGreaterThanOrEqual(1);
    expect(co.roads.length).toBeLessThanOrEqual(ROAD_CAP);
    expect(cracks.filter((r) => !r.lane).length).toBeLessThanOrEqual(DIS_FULL);
    for (const r of cracks) {
      expect(d.damaged).toContain(r.edge);
      expect(r.inc).toBe('조직 1번째 교대 · 지진');
      const span = r.lane ? ROAD_AT.disLane : ROAD_AT.disFull;
      expect(r.openAt).toBeGreaterThanOrEqual(span[0]); expect(r.openAt).toBeLessThanOrEqual(span[1]);
    }
    // 전면 crack 은 통제한 순서로 앞의 것 (먼저 갈라진 곳)
    for (const r of cracks) if (!r.lane) expect(d.damaged.indexOf(r.edge)).toBeLessThan(DIS_FULL);
  });

  it('다음 교대의 1틱에 그 구간들이 repair(전면)이거나 느려져 있고(한 차로), 0틱·1틱에 모든 시설에서 모든 교차로로 간다', () => {
    for (const r of co.roads) {
      const e = B.city.edges[r.edge];
      if (r.lane) expect(e.slow, `${r.edge}`).toBeGreaterThanOrEqual(LANE_SLOW - 1e-9);
      else if (B.carryState.dropped.every((x) => !x.startsWith(edgeName(B.city, e) + ':'))) expect(e.closedReason, `${r.edge}`).toBe('repair');
    }
    expect(u0).toBe(0);
    expect(unreachable(B)).toBe(0);
    expect(B.events[B.carryState.event].text).toContain(`복구 공사 도로 ${B.carryState.applied.filter((n) => n.what === 'road').length}구간`);
    checkCarryLog(B);
  });

  it('다음 교대를 끝까지: 모든 사건이 닫히고, 개통 기록이 적용 목록과 일대일이며, 교대 내내 막는 공사만 다음 상태로 넘어간다', () => {
    B.runToEnd();
    expect(B.incidents.every((I) => I.phase === 'closed')).toBe(true);
    checkRoadLog(B);
    const next = makeCarryover(B);
    const held = B.carryState.held.map((r) => r.edge);
    for (const id of held) expect(next.roads.find((r) => r.edge === id)).toMatchObject({ left: 1 });
    for (const r of next.roads) if (r.why === 'crack') expect(held).toContain(r.edge);      // 이번 교대의 균열 공사(left 1)는 끝났다 — 다시 넘어오는 crack 은 교대 내내 막았던 것뿐
  });
});

// ───────────────────────── 6·10. 짧은 연속 (계보 3 × 교대 4) — 대원 몫 ─────────────────────────
describe('6·10. 짧은 연속 (계보 3 × 교대 4) — 대원 몫', () => {
  const shifts: Sim[] = [], keys: [string, string][] = [], cos: Carryover[] = [], cut0: number[] = [];
  beforeAll(() => {
    for (let L = 0; L < 3; L++) {
      let co: Carryover | null = null;
      for (let k = 1; k <= 4; k++) {
        const s = new Sim(`C${L}.${k}`, NORMAL, 1200, co ? { carry: co } : {});
        cut0.push(unreachable(s));      // (단계 4) 0틱: 이어받은 복구 공사가 있어도 모든 시설에서 모든 교차로로
        s.runToEnd();
        shifts.push(s);
        const next = makeCarryover(s);
        keys.push([carryKey(readCarryover(json(next), s.city)!.carry), carryKey(next)]);      // 왕복 검사
        cos.push(next);
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

  it('적용 목록과 기록의 일대일, 결장자는 모두 기록에 이름이 있다, 결원 도착에는 요약 줄이 원인, 정비마다 정비를 마친 기록 하나', () => {
    for (const s of shifts) if (s.carryState.on) { checkCarryLog(s); checkShortArrivals(s); checkServiceLog(s); }
  });

  it('(단계 4) 복구 도로 ≤ 6, 0틱에 모든 시설에서 모든 교차로로 간다, 복구 공사마다 개통 기록이 하나 (요약 줄이 원인 · tag carry)', () => {
    for (const co of cos) expect(co.roads.length).toBeLessThanOrEqual(ROAD_CAP);
    for (const n of cut0) expect(n).toBe(0);
    for (const s of shifts) if (s.carryState.on) checkRoadLog(s);
  });

  it('(단계 8) 요약 줄의 "숙련이 오른 대원 n명"은 보고서(carrySummary.grown)와 같은 문턱 — 이번 교대에 나온 조직 대원 가운데 누적 숙련이 GROWN_MIN 이상인 사람 수. 성장은 교대마다 GAIN_CAP 안', () => {
    let seen = 0;
    shifts.forEach((s, i) => {
      if (!s.carryState.on) return;
      const byKey = new Map(s.carry!.crew.map((c) => [c.seat ?? c.name, c]));
      let want = 0;
      for (const r of s.responders) {
        if (r.relief || s.units[r.unitId].aid || r.status === 'off') continue;
        const c = byKey.get(r.seat ?? r.name);
        if (c && c.dSkill >= GROWN_MIN) want++;
      }
      const m = /숙련이 오른 대원 (\d+)명/.exec(s.events[s.carryState.event].text);
      expect(m ? +m[1] : 0, s.seed).toBe(want);
      expect(s.carryState.stats.grown, s.seed).toBe(want);
      seen += want;
      // 한 교대의 성장은 GAIN_CAP 안 (k번째 교대가 받은 누적은 성장 k − 1 번)
      const k = (i % 4) + 1;
      for (const c of s.carry!.crew) expect(c.dExp, `${s.seed} ${c.name}`).toBeLessThanOrEqual((k - 1) * GAIN_CAP + 1e-9);
    });
    expect(seen).toBeGreaterThan(0);
  });

  it('(단계 5) 출입 통제·무너짐 ≤ 12 · 건물 ≤ 24, 이어받은 무너진 건물에서는 사건이 나지 않는다, 손상된 건물의 사건마다 그 사실의 기록이 하나', () => {
    for (const co of cos) { expect(co.places.filter((p) => p.state !== 'marked').length).toBeLessThanOrEqual(CLOSED_CAP); expect(co.places.length).toBeLessThanOrEqual(PLACE_CAP); }
    expect(cos.some((co) => co.places.length > 0)).toBe(true);
    for (const s of shifts) {
      if (!s.carryState.on) continue;
      for (const I of s.incidents) expect(s.carryState.places.get(I.truth.placeId)?.state, `${s.seed} ${I.code}`).not.toBe('ruin');
      checkWearLog(s);
    }
  });
});

// ───────────────────────── 6·10 (장비 몫). 극한 계보 하나 — 펌프 고장·결장이 자연히 이어지는 연속 (단계 3) ─────────────────────────
describe('6·10. 극한 계보 (교대 3) — 정비·창고가 자연히 생기는 연속', () => {
  const EX: Difficulty = { frequency: 5, severity: 5, threat: 5, equipment: 1, info: 1, resources: 3 };
  const shifts: Sim[] = [], cos: Carryover[] = [];
  beforeAll(() => {
    let co: Carryover | null = null;
    for (let k = 1; k <= 3; k++) {
      const s = new Sim(`XC.${k}`, EX, 1200, co ? { carry: co } : {});
      s.runToEnd();
      shifts.push(s);
      co = makeCarryover(s);
      cos.push(co);
    }
  }, HOOK_MS);

  it('예외 없이 모든 사건이 닫히고, 펌프가 고장 난 부대는 다음 교대에 정비(상한 2대 — 넘으면 급히 정비 완료)를 받으며 기록이 적용 목록과 일대일이다', () => {
    let serviced = 0;
    shifts.forEach((s, i) => {
      expect(s.incidents.every((I) => I.phase === 'closed'), s.seed).toBe(true);
      const failed = s.units.filter((u) => !u.aid && u.dept === 'fire' && ((u.pumpFails ?? 0) > 0 || u.pumpFailed)).map((u) => u.callsign);
      expect(cos[i].units.filter((x) => x.service).map((x) => x.callsign), s.seed).toEqual(failed);
      expect(cos[i].stock.flashbang).toBeGreaterThanOrEqual(0);
      expect(cos[i].stock.flashbang).toBeLessThanOrEqual(STOCK_CAP);
      expect(readCarryover(json(cos[i]), s.city)!.carry).toEqual(cos[i]);
      if (i === 0) return;
      const prevSvc = cos[i - 1].units.filter((x) => x.service).length;
      const notes = s.carryState.applied;
      expect(notes.filter((n) => n.what === 'service').length).toBe(Math.min(SERVICE_CAP, prevSvc));
      expect(notes.filter((n) => n.what === 'rushed').length).toBe(Math.max(0, prevSvc - SERVICE_CAP));
      checkCarryLog(s); checkShortArrivals(s); checkServiceLog(s);
      serviced += s.carryState.stats.serviced;
    });
    expect(serviced).toBeGreaterThan(0);      // 극한(장비 1)에서는 펌프가 자주 고장 난다 — 정비 경로를 실제로 지난다
  });
});

// ───────────────────────── 3. 건물 — 쓸 수 없는 건물(여섯 자리)·손상된 건물의 현장 (단계 5) ─────────────────────────
const ruinAt = (id: number, state: PlaceCarry['state'] = 'ruin', repair = 4): PlaceCarry => ({ id, state, dmg: state === 'ruin' ? 1 : 0.4, soot: 0, repair, cause: 'collapse', inc: '조직 1번째 교대 · 01 건물 붕괴', since: 1 });
const markAt = (id: number, soot: number, dmg: number): PlaceCarry => ({ id, state: 'marked', dmg, soot, repair: 0, cause: 'fire', inc: '조직 1번째 교대 · 01 건물 화재', since: 1 });
/** 이어받은 상태(대원은 결장 없이)에 건물만 바꿔 넣은 것 */
function withPlaces(co: Carryover, places: PlaceCarry[]): Carryover { const x = calmCrew(json(co)); x.places = places; x.roads = []; return x; }
/** 그 교대에서 강제 사건이 만들어질 때까지만 돌린다 */
function untilForced(s: Sim): Sim { while (!s.gen.forced && !s.ended) s.step(); return s; }
/** (단계 5) 손상된 건물에서 난 사건마다 그 사실의 기록이 하나 (구조 손상 0.1 이상 또는 그을음 0.2 이상 — 원인은 요약 줄 · tag carry · 진실), 그 수 = stats.markedInc */
const WEAR_NOTE = /^이 (건물은 .+손상된 상태였습니다 \(구조 손상 \d+%\)|터에는 .+탄 자리가 남아 있습니다)\.$/;
function checkWearLog(s: Sim): number {
  const cs = s.carryState;
  const notes = s.events.filter((e) => e.kind === 'incident' && e.tag === 'carry');
  for (const e of notes) { expect(WEAR_NOTE.test(e.text), e.text).toBe(true); expect(e.causes).toEqual([cs.event]); expect(e.truth).toBe(true); }
  let want = 0;
  for (const I of s.incidents) {
    const pc = cs.places.get(I.truth.placeId);
    const yes = !!pc && (pc.dmg >= 0.1 || pc.soot >= 0.2) && (!s.city.places[I.truth.placeId].open || pc.soot >= 0.2);
    expect(notes.filter((e) => e.incidentId === I.id).length, `${I.code}`).toBe(yes ? 1 : 0);
    if (yes) want++;
  }
  expect(cs.stats.markedInc.length).toBe(want);
  return want;
}

describe('3. 쓸 수 없는 건물에서는 사건이 나지 않는다 — 여섯 자리 (장소 추첨·정해 준 건물·은신처·연쇄 방화·재난·현장)', () => {
  let A: Sim, base: Carryover, U: number[], B: Sim;
  beforeAll(() => {
    A = run('P4');
    base = makeCarryover(A);
    U = [...new Set(A.incidents.map((I) => I.truth.placeId).filter((id) => id >= 0 && !A.city.places[id].open))].sort((a, b) => a - b).slice(0, CLOSED_CAP);
    B = run('P4', withPlaces(base, U.map((id) => ruinAt(id))));
  }, HOOK_MS);

  it('placeUsable: 교대 안(X6)의 전소·전체 붕괴는 inShift 일 때만, 이어받은 흔적은 쓰고 출입 통제는 allowClosed 일 때만, 무너짐은 끝까지 안 된다', () => {
    const roomy = A.city.places.filter((q) => q.facility < 0 && !q.open).map((q) => q.id);
    const s = new Sim('PU', NORMAL, 60, { carry: withPlaces(base, [markAt(roomy[0], 0.4, 0.2), ruinAt(roomy[1], 'closed', 2), ruinAt(roomy[2])]) });
    expect([placeUsable(s, roomy[0]), placeUsable(s, roomy[1]), placeUsable(s, roomy[2]), placeUsable(s, roomy[3])]).toEqual([true, false, false, true]);
    expect([placeUsable(s, roomy[1], true), placeUsable(s, roomy[2], true)]).toEqual([true, false]);
    expect(placeCond(s, roomy[0])).toEqual(markAt(roomy[0], 0.4, 0.2));
    expect(placeCond(s, roomy[3])).toBeNull();
    s.placeMarks.set(roomy[3], { placeId: roomy[3], state: 'burnt', t: 0, incidentId: 0, burnFrac: 0.8, ruinFrac: 0 });
    expect([placeUsable(s, roomy[3]), placeUsable(s, roomy[3], false, false)]).toEqual([false, true]);      // 재난·연쇄 방화(inShift false)는 교대 안의 전소를 보지 않는다 — createIncident 의 되고르기가 받는다
    expect(placeGone(s, roomy[3])).toBe(true);
    // 이어받은 상태가 없으면 X6 의 조건만 (placeGone 과 같다)
    const n = new Sim('PU', NORMAL, 60);
    expect([placeUsable(n, roomy[1]), placeCond(n, roomy[1])]).toEqual([true, null]);
  });

  it('① 장소 추첨: 이어받은 상태가 없는 같은 시드에서 사건이 났던 건물들을 무너짐으로 두면 그 건물들에서는 사건이 나지 않는다', () => {
    expect(U.length).toBeGreaterThanOrEqual(6);
    expect(B.incidents.length).toBeGreaterThan(8);
    expect(B.incidents.every((I) => I.phase === 'closed')).toBe(true);
    for (const I of B.incidents) expect(U.indexOf(I.truth.placeId), `${I.code} ${I.truth.label}`).toBe(-1);
    checkCarryLog(B);
  });

  it('② 정해 준 건물: 무너진 건물을 정해 일으켜도(마지막 안전장치) 다른 건물에서 난다', () => {
    const s = new Sim('P4x', NORMAL, 1200, { carry: withPlaces(base, U.map((id) => ruinAt(id))) });
    for (const u of U) {
      const I = createIncident(s, { type: 'fire', placeId: u, rng: s.rng.fork('t' + u) });
      expect(I.truth.placeId).not.toBe(u);
      expect(U.indexOf(I.truth.placeId)).toBe(-1);
    }
  });

  it('③ 은신처: 납치범은 이어받은 무너진 건물에 숨어들지 않는다 (같은 시드에서 이어받은 상태가 없을 때 고른 은신처를 무너짐으로)', () => {
    const seeds = ['K1', 'K3', 'K4', 'K9'];
    const first = seeds.map((sd) => untilForced(new Sim(sd, NORMAL, 1200, { force: 'armed/kidnap' })).incidents.find((I) => I.truth.variant === 'kidnap')!.pursuit!.hideout);
    expect(first.every((h) => h !== undefined)).toBe(true);
    const H = [...new Set(first as number[])];
    const co = withPlaces(base, H.map((id) => ruinAt(id)));
    let chosen = 0;
    for (const sd of seeds) {
      const s = untilForced(new Sim(sd, NORMAL, 1200, { force: 'armed/kidnap', carry: co }));
      const h = s.incidents.find((I) => I.truth.variant === 'kidnap')!.pursuit!.hideout;
      if (h !== undefined) { chosen++; expect(H.indexOf(h), sd).toBe(-1); }
    }
    expect(chosen).toBeGreaterThan(0);      // 은신처를 고르는 갈래를 실제로 지난다 (다른 창고·작업장으로)
  });

  it('④ 연쇄 방화: 다음 불의 대상은 이어받은 무너진 건물에서 고르지 않는다 (이어받은 상태가 없을 때 고른 건물과 같은 종류의 가까운 건물, 12곳이 무너지면 그 밖에서)', () => {
    const arsonFrom = (p0: number, carry: Carryover | null): number | undefined => {
      const s = new Sim('AR1', NORMAL, 1200, carry ? { carry } : {});
      const I = createIncident(s, { type: 'fire', variant: 'arson', placeId: p0, rng: s.rng.fork('ar') });
      expect(I.truth.placeId).toBe(p0);
      scenarioOf('fire', 'arson')!.onClose!(s, I, 'resolved');
      return s.gen.chain.find((c) => c.opts.csq === 'arson')?.opts.placeId;
    };
    const p0 = A.city.places.find((q) => q.kind === 'shop' && q.facility < 0 && !q.open)!.id, q0 = A.city.places[p0];
    const d = (id: number): number => { const q = A.city.places[id]; return Math.hypot(q.x + q.w / 2 - q0.x - q0.w / 2, q.y + q.h / 2 - q0.y - q0.h / 2); };
    const plain = arsonFrom(p0, null);
    expect(plain).toBeDefined();
    expect(A.city.places[plain!].kind).toBe('shop');      // 이어받은 상태가 없으면 600 안의 같은 종류 가운데서 고른다
    expect(d(plain!)).toBeLessThanOrEqual(600);
    const near = [plain!, ...A.city.places.filter((q) => q.kind === 'shop' && q.facility < 0 && !q.open && q.id !== p0 && q.id !== plain).map((q) => q.id).sort((a, b) => d(a) - d(b) || a - b).slice(0, CLOSED_CAP - 1)];
    const next = arsonFrom(p0, withPlaces(base, near.map((id) => ruinAt(id))));
    expect(next).toBeDefined();
    expect(near.indexOf(next!)).toBe(-1);
  });

  it('⑤ 재난: 지진이 고르는 건물에서 이어받은 무너진 건물을 뺀다 (같은 시드에서 이어받은 상태가 없을 때 지진이 고른 건물을 무너짐으로)', () => {
    const quake: Difficulty = { ...NORMAL, disaster: 'quake' };
    const Q = run('Q2', undefined, quake);
    const W = [...new Set(Q.incidents.filter((I) => I.tag === 'disaster:quake' && I.truth.placeId >= 0 && !Q.city.places[I.truth.placeId].open).map((I) => I.truth.placeId))].slice(0, CLOSED_CAP);
    expect(W.length).toBeGreaterThan(0);
    const R = run('Q2', withPlaces(base, W.map((id) => ruinAt(id))), quake);
    expect(R.incidents.filter((I) => I.tag === 'disaster:quake').length).toBeGreaterThan(0);
    for (const I of R.incidents) expect(W.indexOf(I.truth.placeId), I.code).toBe(-1);
    expect(R.incidents.every((I) => I.phase === 'closed')).toBe(true);
  });

  it('셋째 단계: 그 종류(폭동의 장소 여섯 곳)가 모두 출입 통제면 통제 중인 건물에서 나고, 모두 무너지면 끝까지 건물에서 나지 않는다', () => {
    const riot = A.city.places.filter((q) => q.facility < 0 && ['stadium', 'market', 'busTerminal', 'university', 'station', 'mart'].indexOf(q.kind) >= 0).map((q) => q.id);
    expect(riot.length).toBe(6);
    const make = (places: PlaceCarry[]): Incident => { const s = new Sim('RT', NORMAL, 1200, { carry: withPlaces(base, places) }); return createIncident(s, { type: 'armed', variant: 'riot', rng: s.rng.fork('rt') }); };
    expect(riot).toContain(make([]).truth.placeId);
    expect(riot).toContain(make(riot.map((id) => ruinAt(id, 'closed', 2))).truth.placeId);
    expect(make(riot.map((id) => ruinAt(id))).truth.placeId).toBe(-1);      // 장소가 바닥나면 지금처럼 교차로에서 (§11.1-7)
  });

  it('흔적만 남은 손상 건물은 붕괴가 잘 난다 (가중치 × (1 + 3 × 손상)) — 출입 통제·무너짐이 아닌 흔적만', () => {
    const table = scenarioOf('collapse', 'std')?.places ?? INCIDENT_PLACES.collapse;
    const cands = A.city.places.filter((q) => q.facility < 0 && !q.open && (table[q.kind] ?? 0) > 0).map((q) => q.id).slice(0, PLACE_CAP);
    const hits = (places: PlaceCarry[]): number => {
      const s = new Sim('WG', NORMAL, 1200, { carry: withPlaces(base, places) });
      let n = 0;
      for (let k = 0; k < 30; k++) if (cands.indexOf(createIncident(s, { type: 'collapse', variant: 'std', rng: s.rng.fork('wg' + k) }).truth.placeId) >= 0) n++;
      return n;
    };
    expect(hits(cands.map((id) => markAt(id, 0, 1)))).toBeGreaterThan(hits([]));
  });

  it('⑥ 현장: 그을음 0.6 · 손상 0.3 인 건물의 화재 — s.wear, 처음부터 탄 칸(불 곁은 아니다 · 재산 피해의 분모에서 빠진다 · X6 의 전소 분모에서도), 손상 사실의 기록 하나', () => {
    const b = A.city.places.find((q) => q.facility < 0 && !q.open && (INCIDENT_PLACES.fire[q.kind] ?? 0) > 0 && q.kind === 'apartment')!.id;
    const sA = new Sim('W1', NORMAL, 1200, { carry: withPlaces(base, [markAt(b, 0.6, 0.3)]) }), sB = new Sim('W1', NORMAL, 1200);
    const IA = createIncident(sA, { type: 'fire', variant: 'std', placeId: b, rng: sA.rng.fork('w') }), IB = createIncident(sB, { type: 'fire', variant: 'std', placeId: b, rng: sB.rng.fork('w') });
    const a = sA.scenes[IA.id]!, o = sB.scenes[IB.id]!;
    expect(o.wear).toBeUndefined();
    expect(a.wear).toEqual({ dmg: 0.3, soot: 0.6, cause: 'fire', inc: '조직 1번째 교대 · 01 건물 화재', pre: a.wear!.pre });
    expect(a.wear!.pre).toBeGreaterThan(0);
    expect(a.totalFuelTiles).toBe(o.totalFuelTiles - a.wear!.pre);
    expect(a.burnedTiles).toBe(0);
    let burned = 0;
    for (let i = 0; i < a.burned.length; i++) if (a.burned[i]) { burned++; expect(a.fuel[i]).toBe(0); expect(o.fuel[i]).toBeGreaterThan(0); }
    expect(burned).toBe(a.wear!.pre);
    let indoorFuel = 0;
    for (let i = 0; i < o.fuel.length; i++) if (o.fuel[i] > 0 && o.region[i] >= 0 && o.regions[o.region[i]].indoor) indoorFuel++;
    expect(a.wear!.pre).toBeLessThanOrEqual(Math.round(PRE_BURN * 0.6 * indoorFuel));
    for (let i = 0; i < a.fire.length; i++) {
      if (!(a.fire[i] > 0)) continue;
      const x = i % a.w, y = (i / a.w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < a.w && ny < a.h) expect(a.burned[ny * a.w + nx]).toBe(0); }
    }
    // 같은 사건 시드라 나머지는 같다 (평면·불·사람)
    expect([a.w, a.h, a.casualties.length]).toEqual([o.w, o.h, o.casualties.length]);
    // X6: 처음 건전도 ≤ 1 − WEAR_INTEG × 0.3, 전소 비율의 분모에서 처음부터 탄 칸이 빠지고 처음 탄 비율은 0
    const ca = catOf(sA, a)!, cb = catOf(sB, o)!;
    expect(ca.fuel0).toBeLessThan(cb.fuel0);
    expect(burnFracOf(ca, a)).toBe(0);
    for (let r = 0; r < a.regions.length; r++) if (a.regions[r].indoor) expect(ca.integ[r]).toBeLessThanOrEqual(1 - CAT.WEAR_INTEG * 0.3 + 1e-6);
    // 기록: 발생 기록 바로 뒤에 손상 사실 하나 (요약 줄이 원인 · 진실 · tag carry)
    const notes = sA.events.filter((e) => e.incidentId === IA.id && e.tag === 'carry');
    expect(notes.length).toBe(1);
    expect(notes[0].id).toBe(IA.rootEvent + 1);
    expect(notes[0].text).toBe(`이 건물은 조직 1번째 교대 · 01 건물 화재로 그을리고 손상된 상태였습니다 (구조 손상 30%).`);
    expect(notes[0].causes).toEqual([sA.carryState.event]);
    expect(sA.carryState.stats.markedInc).toEqual([IA.code]);
    expect(sB.events.some((e) => e.tag === 'carry')).toBe(false);
    // 이번 교대의 충격(I1-b applyExpo — cause 'shock')과 겹치면 dmg 의 큰 쪽: 충격이 크면 그대로, 작으면 이어받은 쪽으로 (그을음은 이어받은 값)
    a.wear = { dmg: 0.5, soot: 0, cause: 'shock', inc: '03', pre: 0 };
    applyPlaceWear(sA, a, IA);
    expect([a.wear.dmg, a.wear.cause, a.wear.inc, a.wear.soot]).toEqual([0.5, 'shock', '03', 0.6]);
    a.wear = { dmg: 0.1, soot: 0, cause: 'shock', inc: '03', pre: 0 };
    applyPlaceWear(sA, a, IA);
    expect([a.wear.dmg, a.wear.cause, a.wear.soot]).toEqual([0.3, 'fire', 0.6]);
  });

  it('⑥ 방향: 같은 건물·같은 사건 시드의 번지는 화재(심각도 3)를 그을음 0 과 0.6 으로 — 그을린 쪽의 소실률 평균도, 이번 교대에 탄 칸 수도 크지 않다', () => {
    const b = A.city.places.find((q) => q.facility < 0 && !q.open && (INCIDENT_PLACES.fire[q.kind] ?? 0) > 0 && q.kind === 'apartment')!.id;
    const sum = { loss: [0, 0], tiles: [0, 0] };
    for (let k = 0; k < 6; k++) [0, 0.6].forEach((soot, j) => {
      const s = new Sim('SOOT' + k, NORMAL, 1200, { carry: withPlaces(base, [markAt(b, soot, 0)]) });
      const I = createIncident(s, { type: 'fire', variant: 'std', severity: 3, placeId: b, rng: s.rng.fork('soot-test') });
      while (I.phase !== 'closed' && !s.ended) s.step();
      const sc = s.scenes[I.id]!;
      sum.loss[j] += sc.burnedTiles / Math.max(1, sc.totalFuelTiles); sum.tiles[j] += sc.burnedTiles;
    });
    expect(sum.loss[1]).toBeLessThanOrEqual(sum.loss[0]);
    expect(sum.tiles[1]).toBeLessThanOrEqual(sum.tiles[0]);
  }, 120_000);

  it('넷째 자리(법칙 사건을 꺼낼 때)·재범의 자리까지 — src/sim 에서 placeGone 을 부르는 곳이 없고, 고르는 자리마다 placeUsable 을 지난다', () => {
    for (const f of tsFiles(SRC)) { const src = readFileSync(f, 'utf8'); expect(/placeGone\(sim, (?!id\))/.test(src), f).toBe(false); }
    const has = (file: string, re: RegExp): void => expect(re.test(readFileSync(join(SRC, file), 'utf8')), `${file} ${re}`).toBe(true);
    has('incidents.ts', /!placeUsable\(sim, q\.id, allowClosed\)/);                         // 장소 추첨 (엄격·대안·셋째 단계)
    has('incidents.ts', /placeUsable\(sim, opts\.placeId\)/);                                 // 정해 준 건물
    has('incidents.ts', /!placeUsable\(sim, c\.opts\.placeId\)/);                             // 법칙 사건을 꺼낼 때
    has('disaster.ts', /!placeUsable\(sim, q\.id, false, false\)/);                           // 재난
    has('scenarios/crime.ts', /placeUsable\(sim, q\.id, false, false\)/);                     // 연쇄 방화
    has('pursuit.ts', /placeUsable\(sim, q\.id\)/);                                           // 은신처
    has('field/hazards.ts', /!placeUsable\(sim, q\.id\)/);                                    // 재범의 자리 (I1-b C10)
    has('field/sceneManager.ts', /applyPlaceWear\(sim, s, I\)/);                              // 현장
    has('world/state.ts', /usable: placeUsable\(sim, placeId\)/);                             // I1-b placeState
  });
});

// ───────────────────────── 3. 건물의 끝 상태 → 다음 교대 (단계 5 — placeOutcome · 휴식 · 상한) ─────────────────────────
describe('3. 건물의 끝 상태 → 다음 교대 (placeOutcome 의 표 · 휴식 · 상한)', () => {
  let S: Sim, base: Carryover, apt: number, roomy: number[];
  beforeAll(() => {
    const A = run('P1', undefined, NORMAL, 60);
    base = makeCarryover(A);
    S = new Sim('PO', NORMAL, 1200);
    apt = S.city.places.find((q) => q.facility < 0 && !q.open && (INCIDENT_PLACES.fire[q.kind] ?? 0) > 0 && q.kind === 'apartment')!.id;
    roomy = S.city.places.filter((q) => q.facility < 0 && !q.open && q.id !== apt).map((q) => q.id);
  }, HOOK_MS);
  const pick = (p: PlaceCarry | null): unknown[] | null => (p ? [p.state, p.dmg, p.soot, p.repair, p.cause, p.mark ?? null] : null);

  it('X6 의 건물 상태: 전체 붕괴 → 무너짐 RUIN_REPAIR(단계 8 — 3) · 전소 → 통제 5 · 구획 붕괴 → 통제 2 · 폭발 흔적 → 통제 1 · 그을림 → 흔적 (그 사건이 남긴 상태만)', () => {
    const I = createIncident(S, { type: 'fire', variant: 'std', placeId: apt, rng: S.rng.fork('po1') });
    const set = (state: PlaceMark['state'], incidentId = I.id): void => { S.placeMarks.set(apt, { placeId: apt, state, t: 0, incidentId, burnFrac: 0.3, ruinFrac: 0.2 }); };
    set('collapsed'); expect(pick(placeOutcome(S, I))).toEqual(['ruin', 1, 0, RUIN_REPAIR, 'collapse', 'collapsed']);
    set('burnt'); expect(pick(placeOutcome(S, I))).toEqual(['closed', 0.8, 1, 5, 'burnout', 'burnt']);
    set('partial'); expect(pick(placeOutcome(S, I))).toEqual(['closed', 0.4, 0.3, 2, 'collapse', 'partial']);
    set('blasted'); expect(pick(placeOutcome(S, I))).toEqual(['closed', 0.35, 0.3, 1, 'blast', 'blasted']);
    set('scorched'); expect(pick(placeOutcome(S, I))).toEqual(['marked', 0.15, 0.6, 0, 'fire', 'scorched']);
    // 그을림(X6) + 화재 소실률 0.25~0.6 → 통제 1 (여러 행 — 무거운 상태, 큰 값)
    const sc = S.scenes[I.id]!, keep = sc.burnedTiles;
    sc.burnedTiles = Math.ceil(0.4 * sc.totalFuelTiles);
    const loss = sc.burnedTiles / sc.totalFuelTiles;
    const o = placeOutcome(S, I)!;
    expect([o.state, o.repair, o.mark]).toEqual(['closed', 1, 'scorched']);
    expect(o.dmg).toBeCloseTo(Math.max(0.15, 0.5 * loss), 4); expect(o.soot).toBeCloseTo(Math.max(0.6, 1.5 * loss), 4);
    // 다른 사건이 남긴 X6 상태는 이 사건의 줄이 아니다 — 화재의 흔적 줄(0.05~0.25)도 X6 가 표시한 건물에는 쓰지 않는다
    set('burnt', I.id + 99);
    sc.burnedTiles = Math.ceil(0.1 * sc.totalFuelTiles);
    expect(placeOutcome(S, I)).toBeNull();
    S.placeMarks.delete(apt);
    const l2 = sc.burnedTiles / sc.totalFuelTiles;
    expect(pick(placeOutcome(S, I))).toEqual(['marked', Math.round(0.5 * l2 * 1e4) / 1e4, Math.round(2 * l2 * 1e4) / 1e4, 0, 'fire', null]);
    sc.burnedTiles = Math.ceil(0.7 * sc.totalFuelTiles);
    const l3 = sc.burnedTiles / sc.totalFuelTiles;
    expect(pick(placeOutcome(S, I))).toEqual(['closed', Math.round((0.4 + 0.5 * l3) * 1e4) / 1e4, Math.round(Math.min(1, 1.5 * l3) * 1e4) / 1e4, 3, 'fire', null]);
    sc.burnedTiles = Math.floor(0.02 * sc.totalFuelTiles);
    expect(placeOutcome(S, I)).toBeNull();      // 거의 타지 않았다
    sc.burnedTiles = keep;
  });

  it('붕괴: 잔해가 건물 칸의 0.22 이상이거나 2차 붕괴가 있었으면 무너짐(무너진 자리 spot), 아니면 출입 통제 2 — 승강기 갇힘은 남기지 않는다. 열린 터는 흔적만', () => {
    const cl = S.city.places.filter((q) => q.facility < 0 && !q.open && (INCIDENT_PLACES.collapse[q.kind] ?? 0) > 0).map((q) => q.id);
    let seen = 0;
    for (let k = 0; k < 6; k++) {
      const I = createIncident(S, { type: 'collapse', variant: 'std', placeId: cl[k], rng: S.rng.fork('po-c' + k) });
      const sc = S.scenes[I.id]!;
      let bld = 0, dm = 0;
      for (let i = 0; i < sc.tiles.length; i++) { const t = sc.tiles[i]; if (t === T.FLOOR || t === T.FURN || t === T.DOOR || t === T.STAIR || t === T.WALL || t === T.WINDOW) bld++; if (sc.damage[i]) dm++; }
      const o = placeOutcome(S, I);
      if (!dm) { expect(o).toBeNull(); continue; }
      seen++;
      if (dm / bld >= 0.22) { expect(pick(o)).toEqual(['ruin', 1, 0, RUIN_REPAIR, 'collapse', null]); expect(o!.spot).toHaveLength(2); }
      else {
        expect(pick(o)).toEqual(['closed', Math.round(Math.min(1, 2 * dm / bld) * 1e4) / 1e4, 0, 2, 'collapse', null]);
        I.problems.push({ code: 'ESCALATION', t: 1, detail: '북쪽 방 2차 붕괴', eventId: -1, recovered: false, recoveryText: '' });
        expect(placeOutcome(S, I)!.state).toBe('ruin');
      }
    }
    expect(seen).toBeGreaterThan(0);
    const el = createIncident(S, { type: 'collapse', variant: 'elevator', rng: S.rng.fork('po-el') });
    expect(placeOutcome(S, el)).toBeNull();
    // 열린 터(숲)의 큰 불: 흔적만 — 손상 0 · 남은 교대 0, 그을음은 표의 값
    const forest = S.city.places.find((q) => q.facility < 0 && q.open && q.kind === 'forest')!.id;
    const F = createIncident(S, { type: 'fire', variant: 'std', placeId: forest, rng: S.rng.fork('po-f') });
    const fs = S.scenes[F.id]!;
    fs.burnedTiles = Math.ceil(0.7 * Math.max(1, fs.totalFuelTiles));
    const o = placeOutcome(S, F)!;
    expect([o.state, o.dmg, o.repair, o.spot]).toEqual(['marked', 0, 0, undefined]);
    expect(o.soot).toBeGreaterThan(0.9);
  });

  it('휴식 한 번: 통제는 남은 교대 −1, 0 이 되면 흔적(손상 × 0.4 · 그을음 × 0.5 · opened — 다음 교대에 한 번 알린다), 흔적은 줄다가 사라진다. 같은 건물의 새 피해와는 무거운 쪽으로 합친다', () => {
    const [c2, c1, r1, m1, m2, o1] = roomy.slice(0, 6);
    const places: PlaceCarry[] = [ruinAt(c2, 'closed', 2), { ...ruinAt(c1, 'closed', 1), soot: 0.6, mark: 'partial' }, { ...ruinAt(r1, 'ruin', 1), spot: [0.5, 0.5], mark: 'collapsed' }, markAt(m1, 0.3, 0.2), markAt(m2, 0.2, 0.1), { ...markAt(o1, 0.5, 0.4), opened: true }];
    const s = new Sim('PR', NORMAL, 60, { carry: withPlaces(base, places) });
    const shutLines = s.events.filter((e) => e.tag === 'carry' && e.kind === 'shift');
    expect(shutLines.some((e) => e.text.endsWith('복구 공사 중이라 출입을 통제합니다 (2교대 남음).'))).toBe(true);
    expect(shutLines.some((e) => e.text.endsWith('무너져 출입할 수 없습니다 (1교대 남음).'))).toBe(true);
    expect(shutLines.some((e) => e.text.endsWith('복구 완료 — 다시 문을 열었습니다.'))).toBe(true);
    expect(s.events[s.carryState.event].text).toContain('출입 통제 건물 3곳(무너짐 1)');
    s.runToEnd();
    checkCarryLog(s);
    for (const I of s.incidents) expect(places.some((p) => p.id === I.truth.placeId && p.state !== 'marked'), I.code).toBe(false);
    const next = makeCarryover(s), get = (id: number): PlaceCarry | undefined => next.places.find((p) => p.id === id);
    expect(get(c2)).toEqual({ ...ruinAt(c2, 'closed', 1) });
    expect(get(c1)).toEqual({ ...ruinAt(c1, 'marked', 0), state: 'marked', dmg: 0.16, soot: 0.3, repair: 0, opened: true });      // X6 상태(partial)는 지운다 — 복구됐다
    expect(get(r1)).toEqual({ ...ruinAt(r1), state: 'marked', dmg: 0.4, soot: 0, repair: 0, opened: true });
    expect(get(m1)).toEqual(markAt(m1, 0.05, 0.05));
    expect(get(m2)).toBeUndefined();
    expect(get(o1)).toEqual(markAt(o1, 0.25, 0.25));      // opened 는 한 번만
    expect(readCarryover(json(next), s.city)!.carry).toEqual(next);
    expect(makeCarryover(s)).toEqual(next);
    // 같은 건물에 이번 교대의 새 피해가 있으면: 무거운 쪽 상태, 각각 큰 값, since 는 앞의 것 (이번 교대에 생긴 것은 깎지 않는다)
    const t = new Sim('PR2', NORMAL, 60, { carry: withPlaces(base, [{ ...markAt(apt, 0.9, 0.1), since: 1 }]) });
    const I = createIncident(t, { type: 'fire', variant: 'std', placeId: apt, rng: t.rng.fork('pr2') });
    t.placeMarks.set(apt, { placeId: apt, state: 'partial', t: 0, incidentId: I.id, burnFrac: 0.2, ruinFrac: 0.1 });
    t.runToEnd();
    const m = makeCarryover(t).places.find((p) => p.id === apt)!;
    expect([m.state, m.repair, m.soot, m.since, m.mark]).toEqual(['closed', 2, 0.9, 1, 'partial']);
    expect(m.dmg).toBeGreaterThanOrEqual(0.3);
  });

  it('상한: 출입 통제·무너짐이 12 를 넘으면 남은 교대가 작은 것(같으면 id 가 큰 것)부터 복구 완료, 건물이 24 를 넘으면 가장 옅은 흔적부터 버린다', () => {
    const shut = roomy.slice(0, CLOSED_CAP), marks = roomy.slice(CLOSED_CAP, PLACE_CAP);
    const places = [...shut.map((id) => ({ ...ruinAt(id, 'closed', 3), dmg: 0.3, soot: 0.3 })), ...marks.map((id) => markAt(id, 0.9, 0.5))];
    const s = new Sim('PC', NORMAL, 60, { carry: withPlaces(base, places) });
    expect(s.carryState.places.size).toBe(PLACE_CAP);
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId: apt, rng: s.rng.fork('pc') });
    s.placeMarks.set(apt, { placeId: apt, state: 'burnt', t: 0, incidentId: I.id, burnFrac: 0.8, ruinFrac: 0 });
    s.runToEnd();
    const next = makeCarryover(s);
    const nShut = next.places.filter((p) => p.state !== 'marked');
    expect(nShut.length).toBe(CLOSED_CAP);
    expect(next.places.length).toBe(PLACE_CAP);
    const gone = Math.max(...shut);      // 남은 교대가 모두 2 — id 가 가장 큰 것이 복구 완료되고, 그 흔적(0.12 · 0.15)이 가장 옅어 버려진다
    expect(next.places.some((p) => p.id === gone)).toBe(false);
    expect(next.places.find((p) => p.id === apt)!.state).toBe('closed');
    expect(readCarryover(json(next), s.city)!.dropped).toEqual([]);      // 만든 상태는 읽을 때의 상한에 걸리지 않는다
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
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/carryState|\.wear\b|placeCond|preBurnt/);      // (단계 5) 건물 겹침 표를 읽는 함수도
  });
});
