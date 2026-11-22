// N8 사건 종류 다양화 — docs/specs/N8-incident-kinds.md §9.1 (번호는 설계서 §8 의 단계 표와 같다).
// 시간 예산 90초: 평소 교대 몇 번에 나온다에 기대지 않고, 교대를 끝까지 돌리는 시험은 몇 개만 둔다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NORMAL, PRESETS } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { evaluate } from '../src/sim/debrief';
import { createIncident } from '../src/sim/incidents';
import { CAS_HOLDS, PENDING_RULES, PROP_HOLDS, VERDICT_RULES, registerVerdict } from '../src/sim/field/sceneRegistry';
import { isIndoor, los, staticPass } from '../src/sim/field/grid';
import { T } from '../src/sim/types';
import type { Scene } from '../src/sim/types';
import { withFakeDom } from './fakeCanvas';
import { LIK_FLOOR, TYPE_DEFS, TYPE_ORDER, likRow, typeIdx } from '../src/sim/incidentTypes';
import type { LikMap } from '../src/sim/incidentTypes';
import { NATURE_LIK } from '../src/sim/dispatch/callSystem';
import { SCENARIOS } from '../src/sim/scenarios';
import type { IncidentType } from '../src/sim/types';
import { TYPE_NAME } from '../src/sim/util';
import { TYPE_COLOR, respLimitOf } from '../src/view/typeStyle';

/** 등록 자리의 줄 수 [남은 일 · 사람 보류 · 소품 보류 · 판정] — 단계 4a: 시설 사고 · 단계 5: 동물 · 단계 6b: 견인(소품 보류) (orders/kinds.ts · rules/kinds.ts) */
const REG_NOW = [4, 4, 1, 4];      // (단계 7 뒤 절반) 남은 일 하나(위기자 → 경찰 · 들어가지 못한 문 잠긴 집 → 구조) · 사람 보류 하나(높은 자리의 위기자) · 판정 하나(들어가지 못한 문 잠긴 집)      // (단계 7) 판정 하나 — 미아를 시민이 데려왔으면 대응 지연 · (단계 8) 남은 일 하나 — 높은 자리·구덩이의 사람 · (단계 9) 사람 보류 하나 — 현장 분만을 기다리는 산모

describe('1 유형 자료 (incidentTypes — 단계 1)', () => {
  it('TYPE_DEFS·TYPE_ORDER·typeIdx 가 모든 유형을 덮고, 첫 여덟의 순서가 예전과 같다', () => {
    const order = [...TYPE_ORDER];
    expect(new Set(order).size, '겹치는 유형').toBe(order.length);
    expect(Object.keys(TYPE_DEFS).sort()).toEqual([...order].sort());
    expect(Object.keys(typeIdx).sort()).toEqual([...order].sort());
    order.forEach((t, k) => expect(typeIdx[t], t).toBe(k));
    // 옛 분석 AI 의 TYPES · 평소 추첨의 types · 숫자 색인 lp[3](무장)·lp[1](교통) 과 같은 순서 — 새 유형은 끝에만 붙는다
    expect(order.slice(0, 8)).toEqual(['fire', 'traffic', 'search', 'armed', 'medical', 'collapse', 'hazmat', 'water']);
    expect(typeIdx.armed).toBe(3); expect(typeIdx.traffic).toBe(1);
    for (const t of order) {
      const d = TYPE_DEFS[t];
      expect(d.name, t).toBeTruthy();
      expect(TYPE_NAME[t], t).toBe(d.name);
      expect(d.limit > 0 && d.respLimit > 0, t).toBe(true);      // 한계 시간이 없으면 사건이 끝나지 않는다 (불변 조건 6)
      expect(d.delay[0] > 0 && d.delay[0] <= d.delay[1], t).toBe(true);
      expect(d.follow >= 0 && d.follow <= 1, t).toBe(true);
      expect(d.weight === 'armed' || d.weight >= 0, t).toBe(true);
      expect(d.atNode > 0, t).toBe(true);
      expect(d.floorHp >= 0 && d.floorHp < 100, t).toBe(true);
      expect(Object.keys(d.topicValue).length, `${t}: 접수 AI 가 물을 주제`).toBeGreaterThan(0);
      expect(TYPE_COLOR[t], t).toMatch(/^#[0-9a-f]{6}$/);
      expect(respLimitOf(t)).toBe(d.respLimit);
    }
    expect(TYPE_COLOR.unknown).toBeTruthy(); expect(respLimitOf('unknown')).toBe(100);
  });

  it('옮긴 값이 예전 코드의 값 그대로다 (한계 시간·대응 기준·첫 신고 지연·추가 신고·가중·교차로 사전 확률·규칙 플래그)', () => {
    const pick = <K extends keyof (typeof TYPE_DEFS)['fire']>(k: K): Record<string, unknown> => { const o: Record<string, unknown> = {}; for (const t of TYPE_ORDER.slice(0, 8)) o[t] = TYPE_DEFS[t][k]; return o; };
    expect(pick('limit')).toEqual({ fire: 430, traffic: 400, search: 470, armed: 400, medical: 300, collapse: 470, hazmat: 430, water: 380 });
    expect(pick('respLimit')).toEqual({ fire: 95, armed: 95, traffic: 105, search: 125, medical: 80, collapse: 100, hazmat: 100, water: 90 });
    expect(pick('delay')).toEqual({ fire: [6, 16], traffic: [3, 8], search: [1, 3], armed: [4, 11], medical: [2, 6], collapse: [3, 8], hazmat: [8, 20], water: [2, 6] });
    expect(pick('follow')).toEqual({ fire: 0.6, traffic: 0.5, search: 0.12, armed: 0.42, medical: 0.12, collapse: 0.55, hazmat: 0.4, water: 0.3 });
    expect(pick('weight')).toEqual({ fire: 0.27, traffic: 0.24, search: 0.17, armed: 'armed', medical: 0.2, collapse: 0.075, hazmat: 0.085, water: 0.07 });
    expect(pick('atNode')).toEqual({ fire: 0.75, traffic: 1.5, search: 0.75, armed: 0.75, medical: 0.75, collapse: 0.75, hazmat: 0.75, water: 0.75 });
    const on = (k: 'alwaysShow' | 'indoorRisk' | 'roomSearch' | 'zoneSearch' | 'wander' | 'outdoor'): IncidentType[] => TYPE_ORDER.slice(0, 8).filter((t) => TYPE_DEFS[t][k]);
    expect(on('alwaysShow')).toEqual(['fire', 'traffic', 'search', 'armed', 'medical']);
    expect(on('indoorRisk')).toEqual(['fire', 'collapse', 'hazmat']);
    expect(on('roomSearch')).toEqual(['fire', 'armed', 'medical', 'collapse', 'hazmat', 'water']);
    expect(on('zoneSearch')).toEqual(['search']);
    expect(on('wander')).toEqual(['search']);
    expect(on('outdoor')).toEqual(['traffic', 'search', 'water']);
    // 질문 가치는 열쇠의 순서가 같은 값끼리의 순서다 (Object.keys 로 돈다) — 예전 표의 순서 그대로
    expect(Object.keys(TYPE_DEFS.fire.topicValue)).toEqual(['trapped', 'count', 'detail', 'hazard', 'injured']);
    expect(Object.keys(TYPE_DEFS.armed.topicValue)).toEqual(['weapon', 'injured', 'detail', 'trapped', 'count']);
  });

  it('모든 가능도(NATURE_LIK·시나리오 lik)의 열쇠는 TYPE_ORDER 의 유형뿐이고 값은 0~1 · likRow 는 TYPE_ORDER 길이이고 빠진 칸은 LIK_FLOOR', () => {
    const maps: [string, LikMap][] = Object.keys(NATURE_LIK).map((k) => [k, NATURE_LIK[k]]);
    for (const q of SCENARIOS) if (q.lik) maps.push([`${q.type}/${q.variant}`, q.lik]);
    expect(maps.length).toBeGreaterThanOrEqual(42);      // 신고 키 20 + 시나리오 22 (단계 1 의 수)
    for (const [k, m] of maps) {
      for (const [t, v] of Object.entries(m)) {
        expect(TYPE_ORDER.indexOf(t as IncidentType), `${k}: ${t}`).toBeGreaterThanOrEqual(0);
        expect(v! > 0 && v! <= 1, `${k}.${t} = ${v}`).toBe(true);
      }
      const row = likRow(m);
      expect(row.length, k).toBe(TYPE_ORDER.length);
      TYPE_ORDER.forEach((t, i) => expect(row[i], `${k}.${t}`).toBe(m[t] ?? LIK_FLOOR));
      expect(likRow(m), `${k}: 열쇠마다 한 번만 만든다`).toBe(row);
    }
    expect(likRow({ fire: 0.5 })).toEqual(TYPE_ORDER.map((t) => (t === 'fire' ? 0.5 : LIK_FLOOR)));
  });
});

// 시험 2(HASH0 — 단계 1·2a·2b 의 결과 불변을 기록 해시 숫자로 지키던 시험)는 주 브랜치에서는 뺀다(2026-11-15 밤, 주 세션).
// 결과를 바꾸는 묶음(X6 …)이 같은 주 브랜치에 나란히 합쳐지므로 숫자를 박아 두면 그 묶음의 관문이 깨진다.
// 준비 단계의 결과 불변은 덩어리마다 해시 목록(scratchpad, 150교대 남짓 — 자기 시작점 대비 diff 0)으로 확인하고 구현 메모에 적는다.

// ───────────────────────── 단계 2a (틀 B-1 — 자료형과 등록 자리) ─────────────────────────
// 시험 4 — 정보 격리 (소스 글자 검사, 주석 줄은 뺀다). tests/ext.test.ts 의 orders/ 검사와 같은 방식.
// 판단 파일은 N8 의 새 진실(Scene.kinds·Scene.animals·Incident.dupOf·Hostile.hideUntil·Casualty.quietLoss·소품의 live·sub)과 .truth·s.variant 를 읽지 않는다.
// 믿음의 칸 이름(haz 의 pipe·crack·narrow)은 걸리지 않는다. 지휘관이 소품의 생김새(kind·skin)를 읽는 것은 허락된다.
const SRC = '../src/sim/';
const code = (rel: string): string => readFileSync(new URL(SRC + rel, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const JUDGE = ['field/commander.ts', 'field/brain.ts', 'dispatch/analyst.ts', 'dispatch/dispatcher.ts', 'dispatch/screening.ts', 'field/methods.ts', 'field/airDecide.ts', 'field/doctrine/kinds.ts'];
const JUDGE_LATER = ['field/orders/kinds.ts'];      // 단계 4a 에 생긴다 — 생기면 같은 검사를 받는다
const TRUTH = ['s.kinds', '.animals', '.dupOf', 'hideUntil', 'quietLoss', '.truth', 's.variant', 'p.live', 'p.sub', '].live', '].sub'];
describe('4 정보 격리 — 판단 파일은 N8 의 새 진실을 읽지 않는다 (글자)', () => {
  it('판단 파일의 주석이 아닌 줄에 s.kinds·.animals·.dupOf·hideUntil·quietLoss·.truth·s.variant·소품의 진실 칸이 없다', () => {
    const files = [...JUDGE, ...JUDGE_LATER.filter((f) => existsSync(new URL(SRC + f, import.meta.url)))];
    for (const f of JUDGE) expect(existsSync(new URL(SRC + f, import.meta.url)), `${f} 가 있다`).toBe(true);
    for (const f of files) { const src = code(f); for (const bad of TRUTH) expect(src.includes(bad), `${f}: ${bad}`).toBe(false); }
  });
  it('신고자 모델 callSystem.ts 는 새 진실(.dupOf·s.kinds)을 읽지 않는다 — 새 진실 읽기는 kindsCaller.ts 로만', () => {
    const src = code('dispatch/callSystem.ts');
    for (const bad of ['.dupOf', 's.kinds', '.animals', 'quietLoss']) expect(src.includes(bad), bad).toBe(false);
  });
});

describe('2a 틀의 자리 — 높은 자리 칸 · 등록 자리 (결과 불변)', () => {
  it('T.LEDGE 는 걸어서 지나지 못하고(staticPass 거짓) 실내가 아니며 시야를 막지 않는다 (시험 17 의 칸 부분)', () => {
    expect(T.LEDGE).toBe(13);
    expect(staticPass(T.LEDGE)).toBe(false);
    expect(isIndoor(T.LEDGE)).toBe(false);
    const tiles = new Uint8Array(7).fill(T.GROUND); tiles[2] = T.LEDGE; tiles[3] = T.LEDGE; tiles[4] = T.LEDGE;
    const s = { w: 7, h: 1, tiles, props: [] } as unknown as Scene;
    expect(los(s, 0, 0, 6, 0)).toBe(true);      // 높은 자리 너머가 보인다
    tiles[3] = T.WALL;
    expect(los(s, 0, 0, 6, 0)).toBe(false);     // (견줌) 벽은 막는다
  });
  it('현장의 고정 층이 T.LEDGE 칸을 예외 없이 그린다 (staticLayer 의 빈 그림 — 아직 어느 현장도 쓰지 않으므로 칸을 직접 바꿔 본다)', async () => {
    const sim = new Sim('N8-2A-LEDGE');
    sim.run(5);
    const I = createIncident(sim, { type: 'fire', rng: sim.rng.fork('n8-2a-ledge') });
    const s = sim.scenes[I.id]!;
    for (let x = 2; x < 10; x++) s.tiles[4 * s.w + x] = T.LEDGE;
    await withFakeDom(async () => {
      const { buildStatic } = await import('../src/view/scene/staticLayer');
      expect(() => buildStatic(s, 16, 'commercial')).not.toThrow();
    });
  });
  it('등록 자리: 단계 4a·5·6b 가 넣은 줄 — 남은 일·사람 보류·판정(시설 사고·동물), 소품 보류는 견인 하나(단계 6b)', () => {
    new Sim('N8-2A-REG');      // 현장 등록(field/scenes/index.ts)을 불러 둔다
    expect([PENDING_RULES.length, CAS_HOLDS.length, PROP_HOLDS.length, VERDICT_RULES.length]).toEqual(REG_NOW);
  });
  it('판정 등록이 판정에 들어간다: open → 위험이 남음(벌점 1.5·목표 미완) · bad → 벌점 · delayed → 대응 지연. 줄이 없으면 그대로', () => {
    const sim = new Sim('N8-2A-VERDICT');
    const n0 = VERDICT_RULES.length;      // 등록된 줄(시설 사고 — 자기 현장이 아니면 null)
    sim.run(20);
    const I = createIncident(sim, { type: 'medical', rng: sim.rng.fork('n8-2a') });
    const s = sim.scenes[I.id]!;
    // 다 끝난 사건처럼 둔다: 모든 구조 대상이 발견돼 안전 구역에, 신고와 도착이 같은 시각 (대응 지연 아님)
    for (const c of s.casualties) { c.tDiscovered = sim.t; c.where = 'safe'; c.health = 90; }
    I.reportedAt = sim.t; I.firstDispatchAt = sim.t; I.firstArrivalAt = sim.t;
    const base = evaluate(sim, I, 'resolved');
    expect(base.grade).toBe('success'); expect(base.outcome).toBe('success');
    let add: { open?: boolean; bad?: number; delayed?: boolean } | null = null;
    const rule = (_sim: Sim, sc: Scene): typeof add => (sc.id === s.id ? add : null);
    registerVerdict(rule);
    try {
      add = null; expect(evaluate(sim, I, 'resolved').outcome).toBe('success');
      add = { delayed: true }; expect(evaluate(sim, I, 'resolved').outcome).toBe('delayed');
      add = { bad: 0.5 }; expect(evaluate(sim, I, 'resolved').grade).toBe('partial');
      add = { bad: 5 }; expect(evaluate(sim, I, 'resolved').grade).toBe('failed');
      add = { open: true }; expect(evaluate(sim, I, 'resolved').grade).toBe('partial');
      expect(evaluate(sim, I, 'timeout').grade).toBe('unresolved');      // 목표 미완 — 한계 시간으로 닫혔다
    } finally {
      VERDICT_RULES.splice(VERDICT_RULES.indexOf(rule), 1);
    }
    expect(VERDICT_RULES.length).toBe(n0);
    expect(evaluate(sim, I, 'resolved').grade).toBe('success');
  });
});

// ───────────────────────── 단계 2b (틀 B-2 — 새 부대의 자리) ─────────────────────────
// 새 부대 여덟은 편성되지 않는다(minLevel 6). 시험은 인근 도시 지원(createAidUnit — 그 종류의 최소 인원)으로 부대를 만들어 틀만 본다.
// 시험 3(유관 기관)·20(새 부대)의 틀 부분 — 새 임무의 실행·편성 단계의 짝(tests/crews.test.ts ③)·교통 경찰의 혼잡 계수는 그 부대를 쓰는 단계(4a~6b)에.
import { EXTRA_NAMES, ROLES, STAFF, capableOf, hasKit, kitIdsOf } from '../src/sim/crews';
import { KIND_AUX, LABEL_BONUS, kindFit, kitBonus, notSpare } from '../src/sim/dispatch/dispatcher';
import { fitFor } from '../src/sim/field/agents';
import { mkFact } from '../src/sim/field/beliefs';
import { anyCapable } from '../src/sim/field/commander';
import { docDeptOf } from '../src/sim/field/doctrine';
import { makeTask } from '../src/sim/field/executor';
import { protection } from '../src/sim/field/injury';
import { addCas, addProp } from '../src/sim/field/kit';
import { registerPending } from '../src/sim/field/sceneRegistry';
import { tickScene, unitArrived } from '../src/sim/field/sceneManager';
import { createAidUnit, dispatchUnit, rosterKeys } from '../src/sim/resources';
import type { Assessment, FieldAgent, Incident, Needs, RoleId, Unit, UnitKind, WorkItem, WorkKind } from '../src/sim/types';
import { FIELD_COLOR } from '../src/view/city/tokens';
import { ROLE_MARK, UNIT_MARK } from '../src/view/marks';
import { responderLook } from '../src/view/scene/sprites';

const NEW_KINDS: UnitKind[] = ['powerCrew', 'gasCrew', 'waterCrew', 'tow', 'animalCtl', 'detective', 'trafficPol', 'k9'];
/** 편성한 새 부대 (단계마다 늘어난다: 4a 전력 · 4b 가스·수도 · 5 포획 · 6a 형사·교통·경찰견 · 6b 견인) */
const FORMED: UnitKind[] = ['powerCrew', 'gasCrew', 'waterCrew', 'animalCtl'];      // animalCtl: (N8 단계 5) 동물 포획팀 (minLevel 1)
/** (N8 단계 6a) 편성 단계가 1 보다 큰 새 부대 — 그 규모부터 한 팀 (형사 2 · 교통 경찰 3 · 경찰견 3) */
const FORMED_FROM: Partial<Record<UnitKind, number>> = { detective: 2, trafficPol: 3, k9: 3, tow: 2 };      // tow: (단계 6b) 견인차 (minLevel 2)
const workOf = (sim: Sim, kind: WorkKind, tg: Partial<WorkItem> = {}): WorkItem => ({
  id: 0, kind, region: -1, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.8, status: 'open', assignees: [], max: 1,
  createdAt: sim.t - 60, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, animal: -1, ...tg,
});
/** 모든 부대를 쉬게 하고(관제가 다른 부대를 보내지 않게) 그 사건의 위치를 알려 둔 교대 */
function quietSim(seed: string, type: IncidentType): { sim: Sim; I: Incident } {
  const sim = new Sim(seed);
  sim.run(3);
  for (const u of sim.units) u.state = 'oos';
  sim.tune.aidUnits = 0;      // 관제가 인근 도시 지원을 따로 부르지 않게 (시험이 만든 지원 부대만)
  const I = createIncident(sim, { type, rng: sim.rng.fork('n8-2b:' + seed) });
  I.reportedNode = I.truth.nodeId; I.locationKnown = true;
  return { sim, I };
}
/** 지원 부대 하나를 만든다 (실제 지원 요청과 같은 길: createAidUnit → sim.aidUsed++) */
function aid(sim: Sim, key: keyof Needs, I: Incident): Unit {
  const u = createAidUnit(sim, key, I);
  expect(u, `지원 부대(${key})`).not.toBeNull();
  sim.aidUsed++;
  for (const rid of u!.crew) for (const it of sim.responders[rid].kit!) it.fault = false;      // 장비 효과·자격만 본다 (고장 추첨에 기대지 않는다)
  return u!;
}
/** 부대를 사건 교차로에 옮겨 둔다 (다음 출동은 출동 준비만 하고 곧장 닿는다) */
function placeAt(sim: Sim, u: Unit, I: Incident): void { const n = sim.city.nodes[I.truth.nodeId]; u.nodeId = n.id; u.x = u.px = n.x; u.y = u.py = n.y; u.state = 'available'; }
/** 부대를 현장에 내린다 (arrive 가 하는 일: onscene → unitArrived) */
function land(sim: Sim, I: Incident, u: Unit): void { u.state = 'onscene'; u.incidentId = I.id; if (I.assigned.indexOf(u.id) < 0) I.assigned.push(u.id); unitArrived(sim, I, u); }

describe('3 유관 기관 — 지휘하지 않는다 · 첫 도착이 아니다 · 혼자 먼저 닿으면 길가에서 기다린다 (단계 2b 의 틀)', () => {
  it('복구반이 먼저 닿으면 현장에 들어가지 않고 기다린다("통제 부대를 기다립니다" 한 번, I.firstArrivalAt 그대로). 소방이 닿으면 들어가되 지휘관이 되지 않는다', () => {
    const { sim, I } = quietSim('N8-2B-WAIT', 'medical');
    const s = sim.scenes[I.id]!;
    const pc = aid(sim, 'utilPower', I);
    expect(pc.dept).toBe('civil');
    placeAt(sim, pc, I); dispatchUnit(sim, pc, I, 8);
    const waits = (): number => sim.events.filter((e) => e.incidentId === I.id && e.text === `${pc.callsign}: 현장 도착 — 통제 부대를 기다립니다.`).length;
    for (let k = 0; k < 300 && waits() === 0; k++) sim.step();
    expect(waits(), '기다림 기록').toBe(1);
    sim.run(8);
    expect(waits(), '기록은 한 번만').toBe(1);
    expect(pc.state).toBe('enroute');
    expect(I.firstArrivalAt).toBeLessThan(0); expect(s.arrivedAt).toBeLessThan(0);
    expect(s.agents.some((a) => a.unitId === pc.id), '현장에 내리지 않았다').toBe(false);
    if (pc.curb) expect(pc.curbT, '길가에 선 채로').toBe(1);
    // 통제 부대(펌프차)가 닿는다 → 그다음 틱에 복구반이 들어간다
    const eng = sim.units.find((u) => u.kind === 'engine')!;
    placeAt(sim, eng, I); dispatchUnit(sim, eng, I, 8);
    for (let k = 0; k < 400 && pc.state !== 'onscene'; k++) sim.step();
    expect(pc.state).toBe('onscene');
    expect(I.firstArrivalAt, '첫 도착은 펌프차').toBeGreaterThanOrEqual(0);
    expect(sim.responders[s.commanderRid].unitId).toBe(eng.id);
    const civ = s.agents.filter((a) => a.unitId === pc.id);
    expect(civ.length).toBe(2);
    for (const a of civ) expect(a.isCommander).toBe(false);
    expect(sim.events.some((e) => e.problem === 'TRAFFIC_DELAY' && e.actor === pc.callsign), '기다린 시간은 교통 지연이 아니다').toBe(false);
    expect(waits()).toBe(1);
  });
  it('fitFor: 유관 기관은 자기 일만 — 복구(대상의 생김새에 맞는 장비)·견인. 수색·이송·처치·통제는 0. 오는 쪽 capableOf 와 같은 대원을 고른다', () => {
    const { sim, I } = quietSim('N8-2B-FIT', 'medical');
    const s = sim.scenes[I.id]!;
    land(sim, I, sim.units.find((u) => u.kind === 'engine')!);
    for (const key of ['utilPower', 'utilGas', 'utilWater', 'tow'] as (keyof Needs)[]) land(sim, I, aid(sim, key, I));
    const wire = addProp(s, 'debris', 0, 0, { skin: 'wire' }), pipe = addProp(s, 'debris', 1, 0, { skin: 'pipe' }), valve = addProp(s, 'valve', 2, 0, {}), other = addProp(s, 'debris', 3, 0, { skin: 'sign' });
    const civ = s.agents.filter((a) => sim.responders[a.rid].dept === 'civil');
    expect(civ.length).toBe(7);      // 전력 2 · 가스 2 · 수도 2 · 견인 1
    const what = (p: { skin?: string; kind: string }): string => p.skin ?? p.kind;
    for (const a of [...civ, ...s.agents.filter((b) => sim.responders[b.rid].dept === 'fire')]) {
      const r = sim.responders[a.rid], tag = `${r.role}`;
      for (const p of [wire, pipe, valve, other]) {
        const w = workOf(sim, 'repair', { prop: p.id });
        const f = fitFor(sim, s, a, w);
        if (r.dept === 'civil') expect(f > 0, `${tag} repair ${what(p)}`).toBe(capableOf(sim, a.rid, 'repair', what(p)));
        else expect(f, `${tag} repair — 아직 civil 밖의 복구는 0 (단계 4a)`).toBe(0);
      }
      const tw = fitFor(sim, s, a, workOf(sim, 'towAway', { prop: wire.id }));
      if (r.dept === 'civil') expect(tw > 0, `${tag} towAway`).toBe(capableOf(sim, a.rid, 'towAway', 'debris'));
      if (r.dept !== 'civil') continue;
      for (const k of ['search', 'carry', 'treat', 'escort', 'cordon', 'perimeter', 'traffic', 'clearRoad', 'interview'] as WorkKind[]) expect(fitFor(sim, s, a, workOf(sim, k, { region: 0, cas: 0, tile: 0, prop: other.id })), `${tag} ${k}`).toBe(0);
    }
    const roleFit = (role: RoleId, p: { id: number }): number => fitFor(sim, s, civ.find((a) => sim.responders[a.rid].role === role)!, workOf(sim, 'repair', { prop: p.id }));
    expect(roleFit('lineman', wire)).toBeGreaterThan(0); expect(roleFit('lineman', pipe)).toBe(0);
    expect(roleFit('gasTech', pipe)).toBeGreaterThan(0); expect(roleFit('gasTech', valve)).toBeGreaterThan(0); expect(roleFit('gasTech', wire)).toBe(0);
    expect(roleFit('plumber', pipe)).toBeGreaterThan(0); expect(roleFit('towDriver', pipe)).toBe(0);
  });
  it('7번 블록: 손을 놓은 유관 기관은 활동으로 세지 않고, 남은 유관 기관의 haz 를 넘겨받은 뒤 판단하며, 와 있는 부대가 채우는 남은 일은 통제 부대로 부른다. 승계 후보에서 빠진다', () => {
    const n0 = PENDING_RULES.length;      // 등록된 줄(시설 사고 — 자기 현장이 아니면 null)
    const run = (civilKnows: boolean, civilBusy: boolean): { idle: number; unmet: Partial<Needs>; relayed: boolean; cmdDept: string } => {
      const { sim, I } = quietSim('N8-2B-BLOCK7', 'medical');
      const s = sim.scenes[I.id]!;
      const eng = sim.units.find((u) => u.kind === 'engine')!;
      land(sim, I, eng);
      const pc = aid(sim, 'utilPower', I);
      land(sim, I, pc);
      const cmd = s.agents.find((a) => a.rid === s.commanderRid)!;
      cmd.beliefs.merge(mkFact('haz', 777, { kind: 'wire', active: true, x: 1, y: 1 }, '시험', sim.t - 5, 1, true, '전선'));
      const civ = s.agents.filter((a) => a.unitId === pc.id);
      if (civilKnows) civ[0].beliefs.merge(mkFact('haz', 777, { kind: 'wire', active: false, x: 1, y: 1 }, '시험', sim.t, 1, true, '전선 차단 확인'));
      for (const a of s.agents) if (a.unitId === eng.id) a.status = 'left';
      eng.state = 'returning';
      if (civilBusy) { civ[1].task = makeTask('rehab', '휴식'); sim.responders[civ[1].rid].stamina = 15; civ[1].nextThink = sim.t + 99; }
      for (const a of civ) a.nextThink = Math.max(a.nextThink, sim.t + 99);
      const rule = (_sim: Sim, _s: typeof s, a: FieldAgent): keyof Needs | null => (a.beliefs.val<{ active: boolean }>('haz', 777)?.active ? 'utilPower' : null);
      registerPending(rule);
      try {
        tickScene(sim, s);
      } finally { PENDING_RULES.splice(PENDING_RULES.indexOf(rule), 1); }
      return { idle: s.idleSince, unmet: { ...I.unmet }, relayed: cmd.beliefs.val<{ active: boolean }>('haz', 777)?.active === false, cmdDept: sim.responders[s.commanderRid].dept };
    };
    // 복구반이 전선을 고친 것을 안다 → 넘겨받아 남은 일이 없다 (다시 부르지 않는다)
    const a = run(true, false);
    expect(a.idle, '손을 놓은 복구반은 활동으로 세지 않는다').toBeGreaterThanOrEqual(0);
    expect(a.relayed, '남은 유관 기관의 haz 를 넘겨받았다').toBe(true);
    expect(a.unmet.utilPower ?? 0).toBe(0); expect(a.unmet.law ?? 0).toBe(0); expect(a.unmet.suppression ?? 0).toBe(0);
    expect(a.cmdDept, '지휘관이 떠나도 유관 기관이 승계하지 않는다').toBe('fire');
    // 넘겨받을 것이 없다 → 남은 일(전력 복구)의 부대는 이미 와 있다 → 통제 부대(주관 분야가 소방이면 진압, 그 밖 경찰)
    const b = run(false, false);
    expect(b.unmet.utilPower ?? 0, '와 있는 복구반을 다시 부르지 않는다').toBe(0);
    expect((b.unmet.law ?? 0) + (b.unmet.suppression ?? 0)).toBe(1);
    // 일하는(작업을 쥔) 유관 기관이 남아 있으면 기다린다
    const c = run(false, true);
    expect(c.idle).toBe(-1);
    expect(PENDING_RULES.length).toBe(n0);
  });
});

describe('20 새 부대 — 편성되지 않는 여덟 줄 · 표 · 관제의 틀 (단계 2b)', () => {
  it('편성 단계(§5.3.7): 편성한 종류(4a 전력)는 모든 규모에 한 팀, 나머지는 어느 부대 규모에서도 편성되지 않는다(minLevel 6). 명부의 열쇠·이름은 끝에 붙어 앞 사람이 그대로다. 이름은 모두 다르다(지원 12회 뒤에도)', () => {
    for (const lv of [1, 3, 5]) {
      const sim = new Sim('N8-2B-ROSTER', { ...NORMAL, resources: lv });
      for (const u of sim.units) if (FORMED.indexOf(u.kind) < 0 && !(FORMED_FROM[u.kind] !== undefined && lv >= FORMED_FROM[u.kind]!)) expect(NEW_KINDS.indexOf(u.kind), `규모 ${lv} ${u.callsign}`).toBe(-1);
      for (const k of FORMED) expect(sim.units.filter((u) => u.kind === k).length, `규모 ${lv} ${k}`).toBe(1);
      for (const [k, from] of Object.entries(FORMED_FROM)) expect(sim.units.filter((u) => u.kind === k).length, `규모 ${lv} ${k}`).toBe(lv >= from! ? 1 : 0);
    }
    const keys = rosterKeys();
    // (N9 단계 2) 열쇠 끝에는 N9 의 새 부대 넷(편성되지 않는 줄)이 더 붙는다 — N8 의 열넷은 그 앞에 이어져 있다 (N9 의 줄은 tests/kinds2.test.ts 시험 3)
    const at = keys.findIndex((k) => k.callsign === '전력1');
    const tail = keys.slice(at, at + 14);
    expect(tail.map((k) => k.callsign)).toEqual(['전력1', '전력1', '가스1', '가스1', '수도1', '수도1', '견인1', '포획1', '포획1', '형사1', '형사1', '교통1', '경찰견1', '경찰견1']);
    for (const k of keys) expect(typeof k.name === 'string' && k.name.length > 1, `${k.callsign} ${k.slot}`).toBe(true);
    expect(new Set(keys.map((k) => k.name)).size).toBe(keys.length);
    expect(EXTRA_NAMES.length).toBeGreaterThanOrEqual(keys.length - 40);
    // 지원 12회 (옛 여덟 + 새 넷 — 견인은 지원을 부르지 않는다): 지원 대원의 이름이 편성표 대원·다른 지원 대원과 겹치지 않는다
    const sim = new Sim('N8-2B-AID', { ...NORMAL, resources: 5 });
    const I = createIncident(sim, { type: 'fire', rng: sim.rng.fork('n8-2b-aid') });
    for (const key of ['suppression', 'rescue', 'ems', 'law', 'tactical', 'search', 'traffic', 'eod', 'utilPower', 'utilGas', 'utilWater', 'capture'] as (keyof Needs)[]) aid(sim, key, I);
    const names = sim.responders.map((r) => r.name);
    expect(new Set(names).size, names.join(',')).toBe(names.length);
  });
  it('능력과 장비의 짝(지원 부대 — 최소 인원): 전력 → 절연 장비 · 가스·수도 → 밸브 키 · 견인 → 견인 장비 · 포획 → 마취총 또는 올가미. 복구반장의 장비는 부대마다 (kitIdsOf)', () => {
    const { sim, I } = quietSim('N8-2B-PAIR', 'fire');
    const has = (u: Unit, ids: string[]): boolean => u.crew.some((rid) => ids.some((id) => hasKit(sim, rid, id as never)));
    const want: [keyof Needs, UnitKind, string[]][] = [['utilPower', 'powerCrew', ['insulKit']], ['utilGas', 'gasCrew', ['valveKey']], ['utilWater', 'waterCrew', ['valveKey']], ['tow', 'tow', ['towKit']], ['capture', 'animalCtl', ['dart', 'catchpole']]];
    for (const [key, kind, ids] of want) {
      const u = aid(sim, key, I);
      expect(u.kind).toBe(kind);
      expect(u.caps[key]).toBeGreaterThanOrEqual(0.7);
      expect(has(u, ids), `${kind}: ${ids.join('/')}`).toBe(true);
      expect(u.crew.length, `${kind} 최소 인원`).toBe(STAFF[kind].std.length - STAFF[kind].minDrop.length);
      u.crew.forEach((rid, k) => expect(sim.responders[rid].kit!.map((it) => it.id), `${kind} ${k}번 자리`).toEqual(kitIdsOf(kind, k)));
    }
    expect(kitIdsOf('powerCrew', 0)).toEqual(['insulKit', 'voltDetector']); expect(kitIdsOf('gasCrew', 0)).toEqual(['gasMeter', 'valveKey']); expect(kitIdsOf('waterCrew', 0)).toEqual(['valveKey']);
    for (const kind of ['engine', 'patrol', 'rescue', 'medHeli'] as UnitKind[]) STAFF[kind].std.forEach((role, k) => expect(kitIdsOf(kind, k), `${kind} ${k}`).toBe(ROLES[role].kit));      // 기존 부대는 역할의 기본 장비 그대로
    // 분야 표 (R3): 유관 기관은 공통, 포획은 특수, 경찰의 새 자리는 경찰
    const pc = sim.units.find((u) => u.kind === 'powerCrew')!, ac = sim.units.find((u) => u.kind === 'animalCtl')!;
    expect(docDeptOf(sim, pc.crew[0])).toBe('common'); expect(docDeptOf(sim, ac.crew[0])).toBe('special');
    // 방호: 절연 장비 0.9(감전) · 벌 보호복 0.95(쏘임)
    const lineman = sim.responders.find((r) => r.role === 'lineman')!, catcher = sim.responders.find((r) => r.role === 'catcher')!;
    expect(protection(sim, lineman, pc, 'electric')).toBe(0.9);
    expect(protection(sim, catcher, ac, 'animal')).toBe(0.95);
  });
  it('capableOf 의 대상별 갈래 (§5.3.3 표): 복구·견인·포획·간판·구멍·매트 터. 그 밖의 mitigate 는 그대로 참', () => {
    const { sim, I } = quietSim('N8-2B-CAP', 'fire');
    const sim5 = new Sim('N8-2B-CAP5', { ...NORMAL, resources: 5 });
    for (const key of ['utilPower', 'utilGas', 'capture'] as (keyof Needs)[]) aid(sim, key, I);
    const of = (sm: Sim, role: RoleId): number => sm.responders.find((r) => r.role === role)!.id;
    expect(capableOf(sim, of(sim, 'lineman'), 'repair', 'wire')).toBe(true); expect(capableOf(sim, of(sim, 'lineman'), 'repair', 'pipe')).toBe(false);
    expect(capableOf(sim, of(sim, 'gasTech'), 'repair', 'pipe')).toBe(true); expect(capableOf(sim, of(sim, 'gasTech'), 'repair', 'valve')).toBe(true);
    expect(capableOf(sim, of(sim, 'officer'), 'repair', 'wire')).toBe(false); expect(capableOf(sim, of(sim, 'officer'), 'towAway')).toBe(false);
    expect(capableOf(sim, of(sim, 'catcher'), 'capture')).toBe(true); expect(capableOf(sim, of(sim, 'catcherLead'), 'capture')).toBe(true);
    expect(capableOf(sim, of(sim, 'catcher'), 'capture', 'hive')).toBe(true); expect(capableOf(sim, of(sim, 'catcherLead'), 'capture', 'hive')).toBe(false);
    expect(capableOf(sim, of(sim, 'nozzle'), 'capture')).toBe(false);
    expect(capableOf(sim5, of(sim5, 'ladderOp'), 'mitigate', 'sign')).toBe(true); expect(capableOf(sim5, of(sim5, 'ropeTech'), 'mitigate', 'sign')).toBe(true); expect(capableOf(sim5, of(sim5, 'officer'), 'mitigate', 'sign')).toBe(false);
    expect(capableOf(sim5, of(sim5, 'extricator'), 'mitigate', 'hole')).toBe(true); expect(capableOf(sim5, of(sim5, 'nozzle'), 'mitigate', 'hole')).toBe(false);
    expect(capableOf(sim5, of(sim5, 'extricator'), 'mitigate', 'matSite')).toBe(true);      // (단계 7) 안전 매트는 구조 부대의 유압 대원이 든다
    for (const role of ['ladderOp', 'officer', 'ropeTech'] as RoleId[]) expect(capableOf(sim5, of(sim5, role), 'mitigate', 'matSite'), role).toBe(false);
    for (const role of ['officer', 'nozzle', 'hazTech'] as RoleId[]) { expect(capableOf(sim5, of(sim5, role), 'mitigate', 'valve'), role).toBe(true); expect(capableOf(sim5, of(sim5, role), 'mitigate'), role).toBe(true); expect(capableOf(sim5, of(sim5, role), 'persuade')).toBe(true); expect(capableOf(sim5, of(sim5, role), 'cordon')).toBe(true); }
  });
  it('anyCapable 은 대상의 생김새를 넘긴다: 전선 복구에 오는 전력 복구반은 맡을 사람, 관 복구에는 아니다', () => {
    const { sim, I } = quietSim('N8-2B-ANY', 'medical');
    const s = sim.scenes[I.id]!;
    land(sim, I, sim.units.find((u) => u.kind === 'engine')!);
    const pc = aid(sim, 'utilPower', I);
    dispatchUnit(sim, pc, I, 60);
    expect(pc.state).toBe('turnout');
    const wire = addProp(s, 'debris', 0, 0, { skin: 'wire' }), pipe = addProp(s, 'debris', 1, 0, { skin: 'pipe' });
    expect(anyCapable(sim, s, I, workOf(sim, 'repair', { prop: wire.id }), 'utilPower')).toBe(true);
    expect(anyCapable(sim, s, I, workOf(sim, 'repair', { prop: pipe.id }), 'utilPower')).toBe(false);
  });
  it('관제: kindFit 이 새 부대의 일을 좁히고(경찰견은 응급 선착 대응·무장의 경찰 수요에 0, 포획팀은 포획 밖 0, 형사는 치안 밖 0), 예비 셈에서 뺀다. 이름표 가점 표는 비어 있다', () => {
    const { sim, I } = quietSim('N8-2B-KIND', 'medical');
    const set = (type: string, label?: string): void => {
      I.assessment = { type: type as IncidentType, typeConf: 0.9, probs: {} as Assessment['probs'], severity: 1.5, confidence: 0.9, needs: { suppression: 0, rescue: 0, ems: 0, law: 0, tactical: 0, search: 0, traffic: 0, eod: 0, utilPower: 0, utilGas: 0, utilWater: 0, tow: 0, capture: 0, decon: 0 }, risks: [], summary: '', t: sim.t, revision: 0, label } as Assessment;
    };
    const base = sim.units.find((u) => u.kind === 'patrol')!;
    const fake = (kind: UnitKind): Unit => ({ ...base, kind });
    expect([...KIND_AUX].sort()).toEqual(['animalCtl', 'deconUnit', 'detective', 'dive', 'k9', 'mtnRescue', 'riotPol', 'trafficPol']);      // (N9 단계 2) 산악·수중·제독·기동대를 더했다
    set('medical'); expect(kindFit(sim, fake('k9'), I, 'search'), '응급의 선착 대응 수색').toBe(0);
    set('armed'); expect(kindFit(sim, fake('k9'), I, 'law')).toBe(0); expect(kindFit(sim, fake('k9'), I, 'search')).toBe(0); expect(kindFit(sim, fake('detective'), I, 'law'), '무장의 경찰 수요').toBe(0);
    set('search'); expect(kindFit(sim, fake('k9'), I, 'search')).toBe(1);
    set('disturb'); expect(kindFit(sim, fake('detective'), I, 'law')).toBe(1); expect(kindFit(sim, fake('k9'), I, 'search')).toBe(1); expect(kindFit(sim, fake('detective'), I, 'search')).toBe(0);
    for (const t of ['traffic', 'fire', 'medical']) { set(t); expect(kindFit(sim, fake('trafficPol'), I, 'traffic'), t).toBe(1); expect(kindFit(sim, fake('trafficPol'), I, 'law'), t).toBe(0); }
    expect(kindFit(sim, fake('animalCtl'), I, 'capture')).toBe(1);
    for (const k of ['rescue', 'search', 'suppression'] as (keyof Needs)[]) expect(kindFit(sim, fake('animalCtl'), I, k), k).toBe(0);
    // 예비 셈: 포획팀(소방 부서)·유관 기관은 남은 부대로 세지 않는다
    const ac = aid(sim, 'capture', I), pc = aid(sim, 'utilPower', I);
    expect(ac.dept).toBe('fire');
    expect([notSpare(ac), notSpare(pc), notSpare(sim.units.find((u) => u.kind === 'engine')!), notSpare(base)]).toEqual([true, true, false, false]);
    // 이름표 가점: N8 의 줄은 아직 없고(단계 2b — 그 이름표를 내는 시나리오의 단계에 붙인다), 줄이 생기면 그 종류·장비의 부대에 더한다. 기존 두 줄(수난·붕괴의 구조 수요)은 그대로
    // (N9 단계 2) 표에는 N9 의 줄이 먼저 들어와 있다 — 걸리지 않는 줄이다(tests/kinds2.test.ts 시험 3)
    const N8_LABELS = ['떨어질 듯한 간판', '외벽 작업자 고립', '멈춘 놀이기구', '가축 탈출', '날치기', '수거책 잠복', '치매 노인 실종', '출산 임박', '위기자', '싱크홀'];
    // (단계 4b) 시설 사고의 이름표 셋 — 간판의 진압 수요에 사다리차·구조 수요에 로프, 싱크홀의 구조 수요에 구조대
    // (단계 5) 가축 탈출의 교통 수요에 교통 경찰 +8 (교통 경찰은 단계 6a 에 편성된다 — 그 전에는 걸리지 않는 줄)
    // (단계 6a) 날치기의 수색 수요에 경찰견 +10 · 경찰 수요에 형사 +10
    // (단계 7) 치매 노인 실종의 수색 수요에 경찰견 +10
    // (단계 6b) 수거책 잠복의 경찰 수요에 형사 +60 (설계서의 +15 로는 기동대(경찰 능력 1.0)를 넘지 못했다 — 구현 메모 단계 6b)
    expect(LABEL_BONUS.filter((r) => N8_LABELS.indexOf(r.label) >= 0).map((r) => `${r.label}|${r.key}|${r.kind ?? r.kit}|${r.bonus}`).sort()).toEqual(['가축 탈출|traffic|trafficPol|8', '날치기|law|detective|10', '날치기|search|k9|10', '떨어질 듯한 간판|rescue|rope|10', '떨어질 듯한 간판|suppression|ladder|12', '멈춘 놀이기구|suppression|ladder|12', '수거책 잠복|law|detective|60', '싱크홀|rescue|rescue|15', '외벽 작업자 고립|suppression|ladder|12', '위기자|rescue|jumpMat|20', '출산 임박|ems|alsBag|8', '치매 노인 실종|search|k9|10']);      // (단계 8·9) 외벽·놀이기구의 사다리차 · 출산의 전문 응급 가방
    const rope = sim.units.find((u) => u.kind === 'rescue')!;
    for (const r of rope.crew) for (const it of sim.responders[r].kit!) it.faultKnown = false;
    set('water'); expect(kitBonus(sim, rope, I, 'rescue')).toBe(12); expect(kitBonus(sim, rope, I, 'law')).toBe(0);
    set('collapse'); expect(kitBonus(sim, rope, I, 'rescue')).toBe(8);
    set('fire', '시험 이름표');
    const row = { label: '시험 이름표', key: 'rescue' as keyof Needs, kind: 'rescue' as UnitKind, bonus: 15 };
    LABEL_BONUS.push(row);
    try {
      expect(kitBonus(sim, rope, I, 'rescue')).toBe(15); expect(kitBonus(sim, base, I, 'rescue')).toBe(0); expect(kitBonus(sim, rope, I, 'law')).toBe(0);
    } finally { LABEL_BONUS.splice(LABEL_BONUS.indexOf(row), 1); }
    expect(kitBonus(sim, rope, I, 'rescue')).toBe(0);
  });
  it('화면의 자리: 새 부대 여덟의 기호가 다른 모든 부대 기호와 다르고, 역할 묶음 civil 의 기호·유관 기관의 바탕색(흰 기호와 명암비 3.5 이상)·겉모습이 있다', () => {
    const marks = Object.values(UNIT_MARK);
    for (const k of NEW_KINDS) { expect(UNIT_MARK[k].length, k).toBeGreaterThan(20); expect(marks.filter((d) => d === UNIT_MARK[k]).length, k).toBe(1); }
    expect(ROLE_MARK.civil.length).toBeGreaterThan(20);
    expect(Object.values(ROLE_MARK).filter((d) => d === ROLE_MARK.civil).length).toBe(1);
    const lum = (hex: string): number => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
    expect(1.05 / (lum(FIELD_COLOR.civil) + 0.05)).toBeGreaterThanOrEqual(3.5);
    const look = responderLook('civil', 'powerCrew', 7, 'utilLead');
    expect([look.head, look.trim, look.pack]).toEqual(['helmet', 'vest', 'none']);
    expect(responderLook('civil', 'powerCrew', 7).head, '모르는 부서가 경찰 겉모습(모자)으로 떨어지지 않는다').not.toBe('cap');
  });
});

// ───────────────────────── 단계 3 (짧은 사건 흐름 daily · 비응급 N1·N2) ─────────────────────────
// 교대를 끝까지 도는 시험은 몇 개만 둔다 — 보통 S0~S3 의 끝난 교대는 시험 6·8 이 나눠 쓴다 (그 Sim 을 고치지 않는다)
const doneShift = new Map<string, Sim>();
function shiftOf(seed: string, d = NORMAL, daily?: number): Sim {
  const key = `${seed}|${JSON.stringify(d)}|${daily ?? '-'}`;
  let s = doneShift.get(key);
  if (!s) { s = new Sim(seed, d, 1200, daily === undefined ? {} : { daily }); s.runToEnd(); doneShift.set(key, s); }
  return s;
}
type Inc = Sim['incidents'][number];
/** 강제한 사건이 닫히면 멈춘다 (§9.1 의 runUntilClosed) — 그 사건을 돌려준다 */
function runUntilClosed(sim: Sim, pick: (I: Inc) => boolean, cap = 6000): Inc | undefined {
  for (let k = 0; k < cap && !sim.ended; k++) {
    sim.step();
    const I = sim.incidents.find(pick);
    if (I && I.phase === 'closed') return I;
  }
  return sim.incidents.find(pick);
}
const BENIGN_V = new Set(['false', 'prank', 'referral', 'dup']);
const N12 = ['fire/prank', 'medical/prank', 'water/prank', 'medical/false', 'water/false', 'armed/false', 'hazmat/false'];
/** 시설 사고 줄 (단계 4a 전선 · 4b 수도관·싱크홀·간판) */
const UTIL_LINES = ['utility/wire', 'utility/main', 'utility/sinkhole', 'utility/sign'];
const ANIMAL_LINES = ['animal/boar', 'animal/hive', 'animal/dogbite', 'animal/escape'];      // (단계 5)
const DISTURB_LINES = ['disturb/rowdy', 'disturb/brawl', 'disturb/snatch', 'disturb/scam', 'disturb/cartheft'];      // (단계 6a · 6b)
const WELFARE_LINES = ['welfare/dementia', 'welfare/lostchild'];      // (단계 7 — 앞 절반의 둘)
const WELFARE_7B = ['welfare/ledge', 'welfare/lockin'];      // (단계 7 뒤 절반) 위기자 · 문 잠긴 집 — 위기자는 숨지는 길이 하나 있다(quietLoss), 그래서 앞 둘의 "숨지지 않는다" 시험과 따로 본다
const N3_LINES = ['disturb/referral'];      // (단계 10) 비응급 N3 단순 민원 — 치안 유형의 daily 줄이지만 비응급이다
const DUP_LINES = ['fire/dup', 'traffic/dup', 'armed/dup', 'collapse/dup', 'hazmat/dup', 'utility/dup', 'animal/dup', 'disturb/dup'];      // (단계 10) 비응급 N4 중복 신고 — 몫 0 의 daily 줄 (incidents.dupCall 만 일으킨다)
const dupLines = (t: string): string[] => DUP_LINES.filter((l) => l.startsWith(t + '/'));
/** 강제 발생(sim.force)으로 만든 그 사건 — 그 변형의 첫 사건 (강제 발생도 시나리오의 tag 'daily' 를 받는다) */
const forced = (sim: Sim) => (J: Inc): boolean => sim.force !== null && `${J.truth.type}/${J.truth.variant}` === sim.force && J.parent === undefined;
/** 단계 3 에는 daily 줄이 비응급 일곱(가중 1.4 / DAILY_TOTAL 14)뿐이라 보통 교대의 짧은 사건은 0.5건쯤이다 — 시험은 차례를 늘려(SimOpts.daily) 짧은 사건이 끼게 한다 */
const MANY = 30;

describe('6 짧은 사건의 재현성과 표 (단계 3)', () => {
  it('짧은 사건을 켠 같은 시드·난이도 두 번 = 같은 해시 (보통 S1·S2, 어려움 S1 — 차례를 늘린 교대) · 짧은 사건이 실제로 나온다', () => {
    let daily = 0;
    for (const [seed, d] of [['S1', NORMAL], ['S2', NORMAL], ['S1', PRESETS.hard.d]] as const) {
      const a = shiftOf(seed, d, MANY), b = new Sim(seed, d, 1200, { daily: MANY }); b.runToEnd();
      expect(b.report!.hash, `${seed}`).toBe(a.report!.hash);
      expect(b.incidents.length).toBe(a.incidents.length);
      daily += a.incidents.filter((I) => I.tag === 'daily').length;
    }
    expect(daily, '세 교대에 짧은 사건이 하나도 없다').toBeGreaterThan(0);
  });
  it('daily 줄: tag 가 daily 이고 가중 합 ≤ DAILY_TOTAL · 비응급 줄의 nature 는 신고자가 말하지 않는 열쇠(가능도·문구 없음 — 이름표가 붙지 않는다)', async () => {
    const { DAILY_TOTAL, KINDS } = await import('../src/sim/scenarios/kinds');
    const daily = SCENARIOS.filter((q) => q.tag === 'daily');
    let sum = 0; for (const q of daily) sum += q.share;
    expect(sum).toBeLessThanOrEqual(DAILY_TOTAL + 1e-9);
    expect(DAILY_TOTAL).toBe(14);
    for (const q of KINDS) if (q.variant === 'prank' || q.variant === 'false') {
      expect(q.tag, `${q.type}/${q.variant}`).toBe('daily');
      expect(q.texts, `${q.type}/${q.variant}`).toBeUndefined(); expect(q.lik).toBeUndefined();
      expect(NATURE_LIK[q.nature], `${q.nature} 는 신고자가 말하는 키가 아니다`).toBeUndefined();
      expect(q.card).toBe(false);
    }
    expect(daily.map((q) => `${q.type}/${q.variant}`).sort()).toEqual([...N12, ...UTIL_LINES, ...ANIMAL_LINES, ...DISTURB_LINES, ...WELFARE_LINES, ...WELFARE_7B, ...N3_LINES, ...DUP_LINES].sort());
    expect(sum, '단계 7 뒤 절반으로 daily 줄이 다 들어왔다 — 가중 합 = DAILY_TOTAL (단계 11 의 완료 조건)').toBeCloseTo(DAILY_TOTAL, 9);
  });
  it('N8 의 새 난수 흐름 이름이 기존 흐름 이름과 겹치지 않는다 (소스의 fork 글자 — 한 이름은 한 자리에서만 만든다, 아직 쓰지 않은 이름은 아무도 쓰지 않는다)', () => {
    // 단계 5: 동물마다(animal:) · 차에 받힌 동물의 운전자(animal-hit:) · 벌집(hive:) · 동물 포획 장비의 고장 추첨(kit-n8 · 지원 부대 aid-n8:)
    const MADE = ['daily', 'verify', 'wire:', 'hole:', 'sign:', 'hive:', 'animal:', 'animal-hit:', 'kit-n8', 'aid-n8:', 'rowdy:', 'brawl:', 'snatch:',
      'perch:', 'pit:', 'overdose:', 'birth:', 'dup:', 'same', 'ledge:'];      // (단계 7 뒤 절반) 위기 정도의 출렁임 (문 잠긴 집은 난수를 쓰지 않는다 — 소리·열쇠 시각은 현장 생성기가 정한다)      // 단계 10: 중복 신고(dup:<원 사건> — 추가 신고가 옆 교차로의 새 사건이 되는가) · 같은 사건 확인 질문의 답(same — 통화 흐름의 하위)      // 단계 8: 줄이 끊겨 떨어진 피해 · 구덩이의 유독 가스 (놀이기구는 난수를 쓰지 않는다 — ride: 는 만들지 않았다) · 단계 9: 흥분 · 출산 (폭염은 난수를 쓰지 않는다 — heat: 없음)      // 단계 6a: 치안 셋      // 단계 3 이 만든 흐름 (짧은 사건 · 확인 질문의 답 — 통화 흐름의 하위) · 4a 전선 · 4b 싱크홀·간판 (수도관은 난수를 쓰지 않는다 — main: 은 만들지 않았다)
    const LATER = ['main:', 'scam:', 'ride:', 'heat:', 'kinds-next:', 'lockin:'];      // kinds-next: — 조건부 연쇄는 I1-b 의 틀(csq:·hz: 흐름)로 갔다 (단계 10)
    const labels: string[] = [];
    const walk = (dir: URL): void => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) walk(new URL(f.name + '/', dir));
        else if (f.name.endsWith('.ts')) for (const m of readFileSync(new URL(f.name, dir), 'utf8').matchAll(/fork\(\s*['`]([^'`$]*)/g)) labels.push(m[1]);
      }
    };
    walk(new URL(SRC, import.meta.url));
    expect(labels.length).toBeGreaterThan(30);
    for (const n of MADE) expect(labels.filter((L) => L === n).length, n).toBe(1);
    for (const n of LATER) expect(labels.filter((L) => L === n).length, n).toBe(0);
  });
});

describe('7 짧은 사건과 평소 추첨 (단계 3 — 7a 는 단계 4a 가 지웠다)', () => {
  it('7b 켜도 S0~S5 에서 평소 추첨 사건(태그 daily 가 아니고 부모가 없는) 처음 여섯 건의 (생성 시각·유형·변형·규모)가 끈 교대와 같다 — 생성 시각은 같거나 가용 배율 ×1.2 한 번만큼 갈린다(단계 6b)', () => {
    const first6 = (sim: Sim): Inc[] => {
      for (let k = 0; k < 12000 && !sim.ended; k++) {
        sim.step();
        const reg = sim.incidents.filter((I) => I.tag !== 'daily' && I.parent === undefined);
        if (reg.length >= 6) return reg.slice(0, 6);
      }
      return [];
    };
    const what = (I: Inc): string => `${I.truth.type}/${I.truth.variant}/${I.truth.severity}`;
    let withDaily = 0, exact = 0;
    for (let k = 0; k < 6; k++) {
      // 난이도의 차례 수 그대로(보통 5 — 단계 3 에는 그 가운데 10% 쯤이 비응급 줄에 걸린다). 짧은 사건이 여럿 끼면(차례를 늘린 교대) 그 사건에 묶인 부대 때문에
      // 평소 사건이 다른 부대를 받아 닫히는 시각이 달라지고 생성 간격의 가용 배율(×1.2)이 갈릴 수 있다 — 구현 메모 단계 3 "알려진 것" 1.
      // (단계 6b) 교통사고가 견인차를 기다리며(§5.3.8) 닫히는 시각이 짧은 사건의 몫과 더 얽혀, 기본 손잡이에서도 S5 의 여섯째 사건이 그 배율 한 번만큼 늦게 났다(30교대에 2 — 단계 6a 끝은 1).
      // 그래서 생성 시각은 "같다"를 "처음 갈린 간격이 정확히 그 배율 한 번이다"까지 받는다 — 추첨(유형·변형·규모의 차례)은 늘 같아야 하고, 넷 이상의 교대는 글자대로 같아야 한다
      const on = new Sim('S' + k), off = new Sim('S' + k, NORMAL, 1200, { daily: 0 });
      const a = first6(on), b = first6(off);
      expect(a.length, `S${k}`).toBe(6);
      expect(a.map(what), `S${k}`).toEqual(b.map(what));
      let i = 0;
      while (i < 6 && a[i].createdAt === b[i].createdAt) i++;
      if (i === 6) exact++;
      else {
        expect(i, `S${k}: 첫 사건의 생성 시각이 다르다`).toBeGreaterThan(0);
        const r = (a[i].createdAt - a[i - 1].createdAt) / (b[i].createdAt - b[i - 1].createdAt);
        expect(Math.abs(r - 1.2) < 0.01 || Math.abs(r - 1 / 1.2) < 0.01, `S${k}: ${i}번째 간격의 비 ${r.toFixed(3)} — 가용 배율이 아니다`).toBe(true);
      }
      if (on.incidents.some((I) => I.tag === 'daily')) withDaily++;
    }
    expect(exact, '글자대로 같은 교대').toBeGreaterThanOrEqual(4);
    expect(withDaily, '짧은 사건이 끼어든 교대가 하나도 없다 — 시험이 아무것도 보지 않는다').toBeGreaterThanOrEqual(1);
  });
  it('isDailyLoad: 짧은 사건과 그 연쇄 자식은 평소 생성기의 몫이 아니다', async () => {
    const { isDailyLoad } = await import('../src/sim/incidents');
    const sim = new Sim('N8-3-LOAD');
    sim.run(5);
    const D = createIncident(sim, { type: 'medical', variant: 'prank', tag: 'daily', rng: sim.rng.fork('n8-3-load') });
    const C = createIncident(sim, { type: 'fire', parent: D.id, rng: sim.rng.fork('n8-3-load2') });
    const R = createIncident(sim, { type: 'fire', rng: sim.rng.fork('n8-3-load3') });
    expect([isDailyLoad(sim, D), isDailyLoad(sim, C), isDailyLoad(sim, R)]).toEqual([true, true, false]);
  });
});

describe('8 비응급 N1 장난 전화 · N2 오인 신고 (단계 3)', () => {
  it('장난 전화를 가려내면 접수 단계 종료(screened) — 부대는 현장에 닿지 않고, FALSE_ALARM(복구됨)·성공·대응 지연 아님. 못 가려내면 출동해 확인하고 FALSE_ALARM', () => {
    let screened = 0, checked = 0;
    for (let k = 0; k < 30 && (screened < 2 || checked < 1); k++) {
      const sim = new Sim('PR' + k, NORMAL, 1200, { force: ['fire/prank', 'medical/prank', 'water/prank'][k % 3] });
      const I = runUntilClosed(sim, forced(sim));
      if (!I || I.phase !== 'closed') continue;
      expect(I.result!.outcome, `${sim.seed} ${I.closeReason}`).toBe('success');
      expect(I.problems.some((p) => p.code === 'FALSE_ALARM' && p.recovered)).toBe(true);
      if (I.closeReason === 'screened') {
        screened++;
        expect(I.firstArrivalAt).toBeLessThan(0);
        expect(I.result!.delayed).toBe(false);
        expect(I.claims.some((c) => c.topic === 'hazard' && c.value === 'prank')).toBe(true);
        expect(I.claims.some((c) => c.topic === 'verify' && (c.value === 'evasive' || c.value === 'hangup'))).toBe(true);
        for (const uid of I.everAssigned) expect(sim.units[uid].incidentId === I.id && sim.units[uid].state === 'onscene', sim.units[uid].callsign).toBe(false);
        expect(I.result!.headline).toContain('장난 전화 — 접수 단계에서 가려냄');
      } else if (I.closeReason === 'resolved') checked++;
    }
    expect(screened, '가려낸 장난 전화').toBeGreaterThanOrEqual(2);
    expect(checked, '가려내지 못해 현장에서 확인한 장난 전화').toBeGreaterThanOrEqual(1);
  });
  it('진짜 사건은 접수 단계에서 닫히지 않는다 (보통 S0~S3 — 차례를 늘린 교대, screened 는 비응급 변형뿐) · 비응급 변형은 추가 신고가 없다', () => {
    let benign = 0;
    for (const seed of ['S0', 'S1', 'S2', 'S3']) {
      const sim = shiftOf(seed, NORMAL, MANY);
      benign += sim.incidents.filter((I) => BENIGN_V.has(I.truth.variant)).length;
      for (const I of sim.incidents) {
        if (I.closeReason === 'screened') expect(BENIGN_V.has(I.truth.variant), `${seed} #${I.code} ${I.truth.type}/${I.truth.variant}`).toBe(true);
        if (BENIGN_V.has(I.truth.variant)) expect(sim.calls.filter((c) => c.incidentId === I.id && c.isFollowup).length, `${seed} #${I.code}`).toBe(0);
      }
    }
    expect(benign, '비응급 사건이 끼지 않았다').toBeGreaterThan(3);
    const sim = new Sim('N8-3-FOLLOW');
    sim.run(5);
    for (const key of N12) { const [t, v] = key.split('/'); const I = createIncident(sim, { type: t as IncidentType, variant: v, tag: 'daily', rng: sim.rng.fork('n8-3-f:' + key) }); expect(I.followupAt, key).toBe(Infinity); }
  });
  it('발생 기록의 문구가 유형별이다 (응급 오인에 "화재"가 없다 · 화재 오인은 예전 글자 그대로) · 비응급 줄의 현장 생성기가 등록돼 있다', async () => {
    const { SCENE_BUILDERS } = await import('../src/sim/field/sceneRegistry');
    const sim = new Sim('N8-3-WHAT');
    sim.run(5);
    const txt = (t: IncidentType, v: string): string => sim.events[createIncident(sim, { type: t, variant: v, rng: sim.rng.fork(`n8-3-w:${t}:${v}`) }).rootEvent].text;
    expect(txt('fire', 'false')).toContain('(실제 화재는 없음 — 오인 신고가 들어올 예정)');
    expect(txt('medical', 'false')).toContain('실제 환자는 없음 — 잠든 사람을 쓰러진 사람으로 볼 신고가 들어올 예정');
    expect(txt('medical', 'false')).not.toContain('화재');
    expect(txt('water', 'false')).toContain('물에 뜬 물건');
    expect(txt('armed', 'false')).toContain('폭죽 소리를 총소리로');
    expect(txt('hazmat', 'false')).toContain('음식 냄새를 가스로');
    expect(txt('water', 'prank')).toContain('장난 전화가 걸려 올 예정');
    for (const key of N12) expect(SCENE_BUILDERS[key], key).toBeTruthy();
    // 응급 오인은 길 위(건물 없음)에서, 가스 오인은 시나리오의 장소(주택·식당)에서 — 밸브가 없다
    const m = createIncident(sim, { type: 'medical', variant: 'false', tag: 'daily', rng: sim.rng.fork('n8-3-w-place') });
    expect(m.truth.placeId).toBe(-1);
    expect(sim.scenes[m.id]!.outdoor).toBe(true);
    const h = createIncident(sim, { type: 'hazmat', variant: 'false', tag: 'daily', rng: sim.rng.fork('n8-3-w-place2') });
    expect(['villa', 'apartment', 'restaurant', 'houseS']).toContain(h.truth.placeKind);
    expect(sim.scenes[h.id]!.props.some((p) => p.kind === 'valve')).toBe(false);
  });
  it('오인 신고는 현장 확인으로 끝난다: 잠든 사람이 깨어나 걷는다 · 물에 뜬 물건·폭죽 잔해를 확인하면 남은 수색을 거둔다', () => {
    const seen = { wake: 0, floater: 0, fireworks: 0 };
    for (let k = 0; k < 6; k++) for (const key of ['medical/false', 'water/false', 'armed/false', 'hazmat/false']) {
      const sim = new Sim('OF' + k, NORMAL, 1200, { force: key });
      const I = runUntilClosed(sim, forced(sim));
      expect(I, `${key} OF${k}`).toBeTruthy();
      if (!I || I.phase !== 'closed') continue;
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(I.closeReason), `${key} OF${k}: ${I.closeReason}`).toBe(-1);
      expect(I.problems.some((p) => p.code === 'FALSE_ALARM'), key).toBe(true);
      const evs = sim.events.filter((e) => e.incidentId === I.id).map((e) => e.text);
      if (evs.some((x) => x.includes('술에 취해 잠들어'))) seen.wake++;
      if (evs.some((x) => x.includes('물에 뜬 것은 사람이 아니었습니다'))) seen.floater++;
      if (evs.some((x) => x.includes('폭죽 잔해 확인'))) seen.fireworks++;
      if (key === 'medical/false' && I.closeReason === 'resolved') expect(sim.scenes[I.id]!.casualties[0].where, 'OF' + k).toBe('safe');
    }
    expect(seen.wake, '잠든 사람을 깨운 교대').toBeGreaterThanOrEqual(3);
    expect(seen.floater + seen.fireworks, '오인의 답(물에 뜬 물건·폭죽 잔해)을 확인한 교대').toBeGreaterThanOrEqual(3);
  });
  it('잊힌 사건 0 — 장난 전화를 가려내 통화 끝에 닫으므로 측정 도구의 "잊힌 사건"(통화가 끝났는데 아무도 맡지 않음)에 걸리지 않는다', async () => {
    const { runWithProbe, shiftMetrics } = await import('../scripts/metrics');
    let screened = 0;
    for (let k = 0; k < 6; k++) {
      const sim = new Sim('PR' + k, NORMAL, 1200, { force: 'fire/prank' });
      const probe = runWithProbe(sim);
      const m = shiftMetrics(sim, probe);
      expect(m.forgotten?.length ?? 0, sim.seed).toBe(0);
      screened += sim.incidents.filter((I) => I.closeReason === 'screened').length;
    }
    expect(screened).toBeGreaterThan(0);
  }, 120000);
});

// ───────────────────────── 단계 4a (시설 사고 — 끊어진 전선 · 전력 복구반) ─────────────────────────
import { applyCallerAid } from '../src/sim/field/hazards';
import { SCENE_BUILDERS } from '../src/sim/field/sceneRegistry';
import { INCIDENT_PLACES } from '../src/sim/cityPlan';
import { markRecovered, raiseProblem } from '../src/sim/events';

/** 단계마다 강제로 돌릴 시설 사고 줄 (4a 전선 · 4b 수도관·싱크홀·간판) */
const UTIL_FORCE = ['utility/wire', 'utility/main', 'utility/sinkhole', 'utility/sign'];
/** 모든 부대를 쉬게 한 교대의 시설 사고 (quietSim 과 같은 꼴 — 시험이 부대를 손으로 보낸다) */
function utilSim(seed: string, variant = 'wire'): { sim: Sim; I: Incident; s: Scene } {
  const sim = new Sim(seed);
  sim.run(3);
  for (const u of sim.units) u.state = 'oos';
  sim.tune.aidUnits = 0;
  const I = createIncident(sim, { type: 'utility', variant, rng: sim.rng.fork('n8-4a:' + seed) });
  I.reportedNode = I.truth.nodeId; I.locationKnown = true;
  return { sim, I, s: sim.scenes[I.id]! };
}
const wireOf = (s: Scene) => s.props.find((p) => p.kind === 'fixture' && p.skin === 'wire')!;
/** 편성된 그 종류의 첫 부대 (장비의 숨은 고장을 지운다 — 장비 효과·자격만 본다) */
const formed = (sim: Sim, kind: UnitKind): Unit => { const u = sim.units.find((q) => q.kind === kind)!; for (const rid of u.crew) for (const it of sim.responders[rid].kit!) it.fault = false; return u; };

describe('3·5·9·10 시설 사고 — 끊어진 전선 (단계 4a)', () => {
  it('3 전력 복구반이 먼저 닿으면 길가에서 기다리고(한 번), 펌프차가 닿으면 들어가 전선을 고친다 — 지휘하지 않고, 고친 것은 지휘관에게 강제 보고된다', () => {
    const { sim, I, s } = utilSim('N8-4A-WAIT');
    const p = wireOf(s);
    expect(p.live).toBe(true); expect(s.outdoor).toBe(true); expect(s.laneRows).toEqual([8, 9, 10, 11]);
    const pc = formed(sim, 'powerCrew');
    placeAt(sim, pc, I); dispatchUnit(sim, pc, I, 8);
    const waits = (): number => sim.events.filter((e) => e.incidentId === I.id && e.text === `${pc.callsign}: 현장 도착 — 통제 부대를 기다립니다.`).length;
    for (let k = 0; k < 300 && waits() === 0; k++) sim.step();
    sim.run(6);
    expect(waits(), '기다림 기록은 한 번').toBe(1);
    expect(I.firstArrivalAt).toBeLessThan(0);
    expect(s.agents.some((a) => a.unitId === pc.id)).toBe(false);
    const eng = formed(sim, 'engine');
    placeAt(sim, eng, I); dispatchUnit(sim, eng, I, 8);
    for (let k = 0; k < 400 && pc.state !== 'onscene'; k++) sim.step();
    expect(pc.state).toBe('onscene');
    expect(sim.responders[s.commanderRid].unitId, '지휘관은 펌프차').toBe(eng.id);
    for (let k = 0; k < 3000 && p.live; k++) sim.step();
    expect(p.live, '전력 복구반이 전선을 고쳤다').toBe(false);
    const fixer = sim.events.find((e) => e.incidentId === I.id && e.text.startsWith('끊어진 전선의 전원을 차단하고'));
    expect(fixer && sim.responders[fixer.rid].dept).toBe('civil');
    const cmd = (): FieldAgent => s.agents.find((a) => a.rid === s.commanderRid)!;
    for (let k = 0; k < 60 && cmd().beliefs.val<{ active: boolean }>('haz', p.id)?.active !== false; k++) sim.step();
    expect(cmd().beliefs.val<{ active: boolean }>('haz', p.id)?.active, '지휘관이 차단을 안다 (강제 보고)').toBe(false);
    for (const a of s.agents) expect(a.isCommander && sim.responders[a.rid].dept === 'civil').toBe(false);
  });
  it('5 시설 사고는 강제 교대(S0·S1)에서 모두 닫히고 한계 시간·방치·무대응이 아니다 · (b)(d) 전력 복구반이 없으면 원격 차단 요청(UTIL_LATE) → 차단 → 닫힘(성공이 아니다)', () => {
    for (const key of UTIL_FORCE) for (const seed of ['S0', 'S1']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: key });
      const I = runUntilClosed(sim, forced(sim));
      expect(I && I.phase, `${key} ${seed}`).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(I!.closeReason), `${key} ${seed}: ${I!.closeReason}`).toBe(-1);
    }
    const sim = new Sim('N8-4A-LATE', NORMAL, 1200, { force: 'utility/wire' });
    sim.tune.aidUnits = 0;
    formed(sim, 'powerCrew').state = 'oos';
    let I: Inc | undefined;
    for (let k = 0; k < 6000 && !(I && I.problems.some((q) => q.code === 'UTIL_LATE')); k++) { sim.step(); I = sim.incidents.find(forced(sim)); }
    expect(I && I.problems.some((q) => q.code === 'UTIL_LATE'), '원격 차단 요청').toBe(true);
    const s = sim.scenes[I!.id]!;
    expect(wireOf(s).live).toBe(true);
    s.kinds!.remoteAt = sim.t;      // (d) 원격 차단 시각을 지금으로
    const J = runUntilClosed(sim, forced(sim), 2500)!;
    expect(wireOf(s).live).toBe(false);
    expect(J.phase).toBe('closed'); expect(J.closeReason).toBe('resolved');
    expect(J.problems.find((q) => q.code === 'UTIL_LATE')!.recovered).toBe(true);
    expect(sim.events.some((e) => e.incidentId === J.id && e.text.includes('원격으로 그 구간의 전기를 끊었습니다'))).toBe(true);
    expect(J.result!.grade === 'success', '대신한 조치(+0.5)는 성공이 아니다').toBe(false);
  });
  it('5(c) 마지막 부대가 떠났는데 살아 있는 전선이 남았다: 전력 복구 수요를 다시 낸다 · 와 있는 전력 복구반이 손을 놓고 있으면 통제 부대를 부른다', () => {
    for (const withCrew of [false, true]) {
      const { sim, I, s } = utilSim('N8-4A-LEFT');
      const amb = formed(sim, 'bls');
      land(sim, I, amb);
      const p = wireOf(s);
      const cmd = s.agents.find((a) => a.rid === s.commanderRid)!;
      cmd.beliefs.merge(mkFact('haz', p.id, { kind: 'wire', active: true, x: p.x, y: p.y, r: 2.2 }, '시험', sim.t, 1, true, '전선'));
      if (withCrew) { const pc = formed(sim, 'powerCrew'); land(sim, I, pc); for (const a of s.agents) if (a.unitId === pc.id) { a.task = null; a.nextThink = sim.t + 99; } }
      for (const a of s.agents) if (a.unitId === amb.id) a.status = 'left';
      amb.state = 'returning';
      tickScene(sim, s);
      if (!withCrew) expect(I.unmet.utilPower ?? 0, '전력 복구 수요').toBe(1);
      else { expect(I.unmet.utilPower ?? 0).toBe(0); expect((I.unmet.law ?? 0) + (I.unmet.suppression ?? 0), '통제 부대').toBe(1); }
    }
  });
  it('9 새 임무(복구·통제)의 되풀이 없음: 같은 대원에게 같은 지시가 25초 안에 다시 가지 않고, 같은 대상의 작업이 60초 안에 두 번 넘게 새로 생기지 않는다 · 전력 복구반을 부른다', () => {
    let fixed = 0;
    for (const seed of ['S2', 'S4', 'S5']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: 'utility/wire' });
      const made = new Map<string, number[]>(), seenW = new Set<number>(), said = new Map<string, number>();
      let bad = '', seen = 0, J: Inc | undefined;
      for (let k = 0; k < 6000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        if (!J) continue;
        const s = sim.scenes[J.id];
        if (s) for (const w of s.board) {
          if (seenW.has(w.id) || (w.kind !== 'repair' && w.kind !== 'cordon')) continue;
          seenW.add(w.id);
          const key = `${w.kind}:${w.prop}:${w.tile}`, ts = made.get(key) ?? [];
          ts.push(sim.t); made.set(key, ts);
          if (ts.filter((t) => t > sim.t - 60).length > 2) bad ||= `${seed} ${key} 60초에 셋`;
        }
        for (; seen < sim.events.length; seen++) {
          const e = sim.events[seen];
          if (e.incidentId !== J.id || !/(시설물 복구|위험 반경 통제) 맡아라/.test(e.text)) continue;
          const last = said.get(e.text);
          if (last !== undefined && e.t - last < 25) bad ||= `${seed} "${e.text}" ${(e.t - last).toFixed(1)}초 만에 다시`;
          said.set(e.text, e.t);
        }
        if (J.phase === 'closed') break;
      }
      expect(bad, bad).toBe('');
      expect(J && J.phase).toBe('closed');
      const s = sim.scenes[J!.id]!;
      if (!wireOf(s).live && J!.everAssigned.some((uid) => sim.units[uid].kind === 'powerCrew')) fixed++;
      expect(J!.everAssigned.some((uid) => sim.units[uid].caps.utilPower >= 0.7) || J!.problems.some((q) => q.code === 'UTIL_LATE'), `${seed}: 전력 복구반을 불렀다`).toBe(true);
    }
    expect(fixed).toBeGreaterThanOrEqual(2);
  });
  it('10 전선 규칙: 반경에 들어간 대원은 감전(electric) · 접수 AI 의 안내를 따르면 told · 판정(살아 있는 채 한계 시간 = 미해결, 원격 차단 = 부분 성공)', () => {
    const { sim, I, s } = utilSim('N8-4A-RULE');
    // 접수 AI 의 '차 안에 그대로 계세요' 안내 (부대가 닿기 전에만 — applyCallerAid)
    const k = s.kinds!;
    k.told = false;
    applyCallerAid(sim, I, 'wire', -1);
    expect(k.told).toBe(true);
    const eng = formed(sim, 'engine');
    land(sim, I, eng);
    sim.run(2);
    const p = wireOf(s);
    const a = s.agents.find((b) => b.unitId === eng.id && !b.isCommander && b.status === 'active')!;
    a.x = a.px = p.x + 0.4; a.y = a.py = p.y; a.path = null;
    const before = sim.responders[a.rid].injuries?.length ?? 0;
    sim.step();
    const inj = sim.responders[a.rid].injuries ?? [];
    expect(inj.length).toBeGreaterThan(before);
    expect(inj[inj.length - 1].cause).toBe('electric');
    expect(sim.events.some((e) => e.incidentId === I.id && e.rid === a.rid && e.text.startsWith('감전!'))).toBe(true);
    // 판정 — 다 끝난 사건처럼 둔다 (구조 대상 안전, 대원 피해 기록을 지운다)
    for (const c of s.casualties) { c.tDiscovered = sim.t; c.where = 'safe'; c.health = 90; c.inVehicle = null; c.dead = false; }
    for (let i = 0; i < s.fire.length; i++) s.fire[i] = 0;
    I.reportedAt = sim.t; I.firstDispatchAt = sim.t; I.firstArrivalAt = sim.t;
    for (const e of sim.events) if (e.incidentId === I.id && e.problem === 'RESPONDER_HURT') e.problem = null;
    expect(evaluate(sim, I, 'timeout').grade, '살아 있는 채 한계 시간').toBe('unresolved');
    p.live = false;
    expect(evaluate(sim, I, 'resolved').grade).toBe('success');
    raiseProblem(sim, I, 'UTIL_LATE', '시험', { role: 'DISPATCH', actor: '시험', text: '시험' });
    markRecovered(I, 'UTIL_LATE', '원격 차단으로 위험을 없앴습니다');
    expect(evaluate(sim, I, 'resolved').grade, '원격 차단').toBe('partial');
  });
});

describe('18 새 유형의 자리 (단계 4a 부터)', () => {
  it('새 유형마다 TYPE_DEFS·TYPE_COLOR·INCIDENT_PLACES·한계 시간이 있고, 모든 줄에 현장 생성기가 등록돼 있다', () => {
    new Sim('N8-18');
    for (const t of ['utility', 'animal', 'disturb', 'welfare', 'rescue'] as IncidentType[]) {
      expect(TYPE_DEFS[t].limit, t).toBeGreaterThan(0);
      expect(TYPE_COLOR[t], t).toMatch(/^#[0-9a-f]{6}$/);
      expect(Object.keys(INCIDENT_PLACES[t]).length, t).toBeGreaterThan(0);
      const lines = SCENARIOS.filter((q) => q.type === t);
      expect(lines.length, t).toBeGreaterThan(0);
      for (const q of lines) expect(SCENE_BUILDERS[`${q.type}/${q.variant}`], `${q.type}/${q.variant}`).toBeTruthy();
    }
    expect(SCENARIOS.filter((q) => q.type === 'utility').map((q) => `${q.type}/${q.variant}`).sort()).toEqual([...UTIL_LINES, ...dupLines('utility')].sort());
    expect(SCENARIOS.filter((q) => q.type === 'animal').map((q) => `${q.type}/${q.variant}`).sort()).toEqual([...ANIMAL_LINES, ...dupLines('animal')].sort());
    expect(SCENARIOS.filter((q) => q.type === 'disturb').map((q) => `${q.type}/${q.variant}`).sort()).toEqual([...DISTURB_LINES, ...N3_LINES, ...dupLines('disturb')].sort());
  });
});

// ───────────────────────── 단계 4b (수도관 파열 · 싱크홀 · 떨어질 듯한 간판 · 가스 누출의 공급 차단 확인) ─────────────────────────
import { HOLE, MAIN, holeChance } from '../src/sim/field/rules/kinds';
import { GAS_WAIT } from '../src/sim/field/orders/kinds';

const fixOf = (s: Scene, skin: string) => s.props.find((p) => p.kind === 'fixture' && p.skin === skin)!;

describe('5·10 시설 사고 — 수도관 · 싱크홀 · 간판 (단계 4b)', () => {
  it('10 지하 침수의 오르내림 (손 계산): 관이 살아 있으면 1초에 +0.004, 잠긴 뒤 −0.006 · 0.5 를 넘으면 지하의 사람이 다치고 0.7 을 넘으면 고립된다', () => {
    const { sim, I, s } = utilSim('N8-4B-MAIN', 'main');
    const k = s.kinds!, pipe = fixOf(s, 'pipe');
    expect(pipe.live).toBe(true); expect(k.base).toBeGreaterThanOrEqual(0);
    expect(s.regions[k.base!].name).toBe('지하 주차장');
    expect(s.stairTo.some((v) => v >= 0), '로비와 지하는 계단으로 이어진다').toBe(true);
    k.flood = 0;
    sim.run(50);      // 10초 (틱 0.2초)
    expect(k.flood!).toBeCloseTo(10 * MAIN.rise, 3);
    pipe.live = false;
    sim.run(20);      // 4초
    expect(k.flood!).toBeCloseTo(Math.max(0, 10 * MAIN.rise - 4 * MAIN.drain), 3);
    // 깊은 물: 지하에 걸을 수 있는 사람을 두고 0.8 로
    const base = s.regions[k.base!], tile = base.tiles[Math.floor(base.tiles.length / 2)];
    const c = addCas(s, tile % s.w, (tile / s.w) | 0, 'mobile', 100, 0, 0);
    pipe.live = true; k.flood = 0.8;
    sim.run(10);
    expect(c.mob, '침수 0.7 을 넘으면 고립').toBe('trapped');
    expect(c.health).toBeLessThan(100);
    expect(c.injuries?.some((j) => j.cause === 'exposure')).toBe(true);
    expect(sim.events.some((e) => e.incidentId === I.id && e.text.includes('허리 위로 차올랐습니다'))).toBe(true);
  });
  it('10 싱크홀: 넓어질 확률은 띠 위의 사람·차로 오르고 보강으로 내린다(손 계산) · 넓어지면 띠 위의 사람은 새 반경 밖의 걸을 수 있는 칸으로 밀려나며 다친다', () => {
    expect(holeChance(0, 0, false)).toBeCloseTo(0.06, 6);
    expect(holeChance(2, 1, false)).toBeCloseTo(0.06 + 0.16 + 0.1, 6);
    expect(holeChance(1, 0, true)).toBeCloseTo(0.06 + 0.08 - 0.12, 6);
    expect(holeChance(0, 0, true)).toBeLessThan(holeChance(0, 0, false));
    const { sim, I, s } = utilSim('N8-4B-HOLE', 'sinkhole');
    const k = s.kinds!, hole = fixOf(s, 'hole'), r0 = k.hazR!;
    for (let i = 0; i < s.tiles.length; i++) if (Math.hypot((i % s.w) - hole.x, ((i / s.w) | 0) - hole.y) <= r0 && ((i / s.w) | 0) >= 8 && ((i / s.w) | 0) <= 12) expect(s.tiles[i], `구멍 안 칸 ${i}`).toBe(T.VOID);
    for (const c of s.casualties) expect(staticPass(s.tiles[Math.round(c.y) * s.w + Math.round(c.x)]), '빠진 사람은 걸을 수 없는 칸에').toBe(false);
    const eng = formed(sim, 'engine');
    land(sim, I, eng);
    // 띠 위(반경 r ~ r+1)의 걸을 수 있는 칸에 대원 하나를 세운다
    let spot = -1;
    const keep = k.keep ?? [];
    for (let i = 0; i < s.tiles.length && spot < 0; i++) { const d = Math.hypot((i % s.w) - hole.x, ((i / s.w) | 0) - hole.y); if (d > r0 + 0.2 && d <= r0 + 0.9 && staticPass(s.tiles[i]) && s.propAt[i] < 0 && keep.indexOf(i) < 0 && ((i / s.w) | 0) >= 8 && ((i / s.w) | 0) <= 12) spot = i; }
    expect(spot).toBeGreaterThanOrEqual(0);
    const a = s.agents.find((b) => b.unitId === eng.id && !b.isCommander)!;
    const base0 = HOLE.base;
    HOLE.base = 1;      // 이번 10초에 반드시 넓어지게 (흐름은 그대로 한 번 뽑는다)
    try {
      for (let t = 0; t < 60 && (k.hazR ?? 0) <= r0; t++) { a.x = a.px = spot % s.w; a.y = a.py = (spot / s.w) | 0; a.path = null; a.nextThink = sim.t + 99; sim.step(); }
    } finally { HOLE.base = base0; }
    expect(k.hazR!).toBeCloseTo(r0 + 1, 6);
    expect(staticPass(s.tiles[Math.round(a.y) * s.w + Math.round(a.x)]), '밀려난 자리는 걸을 수 있는 칸').toBe(true);
    expect(Math.hypot(a.x - hole.x, a.y - hole.y)).toBeGreaterThan(r0 + 1);
    expect(sim.responders[a.rid].injuries?.some((j) => j.cause === 'fall')).toBe(true);
    expect(s.tiles[7 * s.w + hole.x], '맨 바깥 보도는 꺼지지 않는다').not.toBe(T.VOID);
  });
  it('10 간판이 통제 없이 떨어지면 지나던 행인이 다친 구조 대상으로 붙고(ESCALATION), 잔해가 놓이며, 지휘관에게 강제 보고된다', () => {
    const { sim, I, s } = utilSim('N8-4B-SIGN', 'sign');
    const p = fixOf(s, 'sign');
    land(sim, I, formed(sim, 'patrol'));
    const n0 = s.casualties.length;
    p.leak = 0.999; p.leakRate = 0.01;
    sim.run(6);
    expect(p.live).toBe(false);
    expect(s.casualties.length, '지나던 행인').toBe(n0 + 1);
    expect(s.casualties[n0].injuries?.some((j) => j.cause === 'crush')).toBe(true);
    expect(I.problems.some((q) => q.code === 'ESCALATION')).toBe(true);
    expect(s.props.some((q) => q.kind === 'roadDebris' && q.skin === 'signDebris' && !q.removed)).toBe(true);
    const cmd = s.agents.find((b) => b.rid === s.commanderRid)!;
    sim.run(10);
    expect(cmd.beliefs.val<{ active: boolean }>('haz', p.id)?.active).toBe(false);
  });
  it('5(a)(b) 부대 규모 1 의 간판도 닫힌다 · 수도 복구반이 없으면 120초 뒤 소방이 제수밸브를 잠근다(UTIL_LATE — 성공이 아니다)', () => {
    for (const seed of ['S0', 'S1']) {
      const sim = new Sim(seed, { ...NORMAL, resources: 1 }, 1200, { force: 'utility/sign' });
      const J = runUntilClosed(sim, forced(sim));
      expect(J && J.phase, `규모 1 ${seed}`).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(J!.closeReason), `${seed}: ${J!.closeReason}`).toBe(-1);
    }
    const sim = new Sim('N8-4B-VALVE', NORMAL, 1200, { force: 'utility/main' });
    sim.tune.aidUnits = 0;
    formed(sim, 'waterCrew').state = 'oos';
    const J = runUntilClosed(sim, forced(sim), 7000)!;
    expect(J.phase).toBe('closed');
    expect(['timeout', 'abandoned', 'noresponse'].indexOf(J.closeReason), J.closeReason).toBe(-1);
    const late = J.problems.find((q) => q.code === 'UTIL_LATE');
    expect(late, '소방의 제수밸브').toBeTruthy();
    expect(late!.recovered).toBe(true);
    expect(fixOf(sim.scenes[J.id]!, 'pipe').live).toBe(false);
    expect(J.result!.grade === 'success').toBe(false);
  });
  it('가스 누출의 공급 차단 확인(§5.3.8): 분석이 가스 복구 수요를 더하고, 가스 복구반이 없으면 지운다(NO_UNIT 없음) · 밸브를 막은 뒤 가스 복구반이 오지 않으면 120초 뒤 거둔다', () => {
    const sim = new Sim('N8-4B-GAS', NORMAL, 1200, { force: 'hazmat/std' });
    sim.tune.aidUnits = 0;
    formed(sim, 'gasCrew').state = 'oos';
    const J = runUntilClosed(sim, forced(sim), 7000)!;
    expect(J.phase).toBe('closed');
    expect(['timeout', 'abandoned', 'noresponse'].indexOf(J.closeReason), J.closeReason).toBe(-1);
    expect(J.assessment!.needs.utilGas ?? 0, '분석의 선택 수요').toBe(1);
    expect(sim.events.some((e) => e.incidentId === J.id && e.problem === 'NO_UNIT' && e.text.includes('가스 복구')), '선택 수요는 대기열에 올리지 않는다').toBe(false);
    expect(J.everAssigned.some((uid) => sim.units[uid].kind === 'gasCrew')).toBe(false);
    const s = sim.scenes[J.id]!;
    expect(s.board.some((w) => w.kind === 'repair' && w.status === 'done'), '가스 복구반 없이 확인을 마친 일이 없다').toBe(false);
    expect(GAS_WAIT).toBe(120);
  });
});

// ───────────────────────── 단계 5 (동물 — 멧돼지 · 벌집 · 개 물림 · 가축 탈출) ─────────────────────────
import { dartHitP } from '../src/sim/field/executor';
import { HERD_WAIT, herdAllowed } from '../src/sim/field/methods';

describe('5·9·13 동물 (단계 5)', () => {
  it('5 동물 네 시나리오는 강제 교대(S0·S1)에서 모두 닫히고 한계 시간·방치·무대응이 아니다 · 9 같은 대원에게 같은 포획 지시가 25초 안에 다시 가지 않는다', () => {
    for (const key of ANIMAL_LINES) for (const seed of ['S0', 'S1']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: key });
      const I = runUntilClosed(sim, forced(sim), 7000);
      expect(I && I.phase, `${key} ${seed}`).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(I!.closeReason), `${key} ${seed}: ${I!.closeReason}`).toBe(-1);
      // 9 되풀이 없음: "<이름>, 동물 포획 맡아라" 가 같은 대원에게 25초 안에 다시 가지 않는다
      const last = new Map<string, number>();
      for (const e of sim.events) {
        if (e.incidentId !== I!.id) continue;
        const m = /^(\S+), 동물 포획 맡아라/.exec(e.text);
        if (!m) continue;
        const prev = last.get(m[1]);
        if (prev !== undefined) expect(e.t - prev, `${key} ${seed} ${m[1]}`).toBeGreaterThanOrEqual(25);
        last.set(m[1], e.t);
      }
      // 13 동물은 용의자가 아니다: 용의자 목록이 비어 있고, 작업판에 협상·검거·교전이 없다
      const s = sim.scenes[I!.id]!;
      expect(s.hostiles.length, key).toBe(0);
      expect(s.board.some((w) => w.kind === 'negotiate' || w.kind === 'arrest' || w.kind === 'engage'), key).toBe(false);
      if (key !== 'animal/hive') expect((s.animals ?? []).length, key).toBeGreaterThan(0);
    }
  });
  it('13 마취 화살의 명중(손 계산): 0.55 + 0.3 × 숙련 − 0.04 × 거리, 0.1~0.95', () => {
    expect(dartHitP(0.5, 4)).toBeCloseTo(0.55 + 0.15 - 0.16, 9);
    expect(dartHitP(1, 0)).toBeCloseTo(0.85, 9);
    expect(dartHitP(0, 20)).toBe(0.1);
    expect(dartHitP(2, 0)).toBe(0.95);
  });
  it('13 판정: 찻길로 놓친 동물(ANIMAL_LOST)마다 +1.0(많아야 2) · 산 쪽으로 쫓아내면 +0.3 · 풀린 동물·살아 있는 벌집이 남으면 위험이 남음', () => {
    const sim = new Sim('N8-5-VERDICT', NORMAL, 1200, { force: 'animal/escape' });
    const I = runUntilClosed(sim, (J) => forced(sim)(J) && !!sim.scenes[J.id], 400) ?? sim.incidents.find(forced(sim))!;
    const s = sim.scenes[I.id]!;
    const verdict = (): { open: boolean; bad: number } | null => { for (const f of VERDICT_RULES) { const r = f(sim, s, I); if (r) return r as { open: boolean; bad: number }; } return null; };
    for (const a of s.animals!) a.state = 'caught';
    I.problems = I.problems.filter((q) => q.code !== 'ANIMAL_LOST');
    expect(verdict(), '모두 잡힘').toBeNull();
    const mk = (): void => { I.problems.push({ code: 'ANIMAL_LOST', t: sim.t, eventId: -1, detail: '', recovered: false, recoveryText: '', times: undefined, ref: undefined }); };
    mk(); expect(verdict()).toEqual({ open: false, bad: 1 });
    mk(); mk(); expect(verdict()!.bad, '많아야 2').toBe(2);
    I.problems = I.problems.filter((q) => q.code !== 'ANIMAL_LOST');
    s.animals![0].state = 'gone'; s.animals![0].via = 'wild';
    expect(verdict()!.bad).toBeCloseTo(0.3, 9);
    s.animals![0].state = 'roam';
    expect(verdict()!.open, '풀린 동물이 남음').toBe(true);
  });
  it('13 벌집은 벌 보호복을 든 대원만 맡는다(0.8) · 맨손 몰이는 가축이면 곧바로, 그 밖은 포획 장비가 현장에 없고 60초가 지난 뒤에만', () => {
    const sim = new Sim('N8-5-HIVE', NORMAL, 1200, { force: 'animal/hive' });
    const I = runUntilClosed(sim, (J) => forced(sim)(J) && !!sim.scenes[J.id] && sim.scenes[J.id]!.agents.length > 0, 4000)!;
    const s = sim.scenes[I.id]!;
    const hive = s.props.find((p) => p.skin === 'hive')!;
    const w = workOf(sim, 'capture', { prop: hive.id });
    for (const a of s.agents) expect(fitFor(sim, s, a, w), sim.responders[a.rid].name).toBe(hasKit(sim, a.rid, 'beeSuit') ? 0.8 : 0);
    const a = s.agents[0];
    const boar = { kind: 'boar' as const, x: 5, y: 5, state: 'loose' as const };
    const savedAgents = s.agents.slice();
    s.agents.length = 0;      // 포획 장비를 든 대원이 현장에 없다
    expect(herdAllowed(sim, s, a, boar, HERD_WAIT - 1), '60초 전').toBe(false);
    expect(herdAllowed(sim, s, a, boar, HERD_WAIT + 1), '60초 뒤').toBe(true);
    expect(herdAllowed(sim, s, a, { ...boar, kind: 'cow' }, 0), '가축은 곧바로').toBe(true);
    s.agents.push(...savedAgents);
    expect(HERD_WAIT).toBe(60);
  });
});

// ───────────────────────── 단계 6a (치안 — 주취 소란 · 폭행 시비 · 날치기 · 경찰 새 부대 셋) ─────────────────────────
import { tickHostiles } from '../src/sim/field/hazards';
import { hosFact } from '../src/sim/field/agents';

describe('5·9·14 치안 (단계 6a)', () => {
  it('5 치안 세 시나리오는 강제 교대(S0·S1)에서 모두 닫히고 한계 시간·방치·무대응이 아니다 · 9 같은 대원에게 같은 검거·수색 지시가 25초 안에 다시 가지 않는다 · 14 용의자는 모두 맨손이고 주취 소란은 추격전을 시작하지 않는다', () => {
    for (const key of DISTURB_LINES.slice(0, 3)) for (const seed of ['S0', 'S1']) {      // 단계 6a 의 셋 (6b 의 둘은 아래 묶음 — 차량 절도는 추격전이다)
      const sim = new Sim(seed, NORMAL, 1200, { force: key });
      const I = runUntilClosed(sim, forced(sim), 7000);
      expect(I && I.phase, `${key} ${seed}`).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(I!.closeReason), `${key} ${seed}: ${I!.closeReason}`).toBe(-1);
      const s = sim.scenes[I!.id]!;
      for (const h of s.hostiles) expect(h.weapon, `${key} ${h.label}`).toBe('none');
      expect(I!.pursuit, `${key}: 추격전이 아니다`).toBeUndefined();
      const last = new Map<string, number>();
      for (const e of sim.events) {
        if (e.incidentId !== I!.id) continue;
        const m = /^(\S+), (.+) (검거|수색) (맡아라|실시)/.exec(e.text);
        if (!m) continue;
        const k = m[1] + '|' + m[2] + m[3], prev = last.get(k);
        if (prev !== undefined) expect(e.t - prev, `${key} ${seed} ${k}`).toBeGreaterThanOrEqual(25);
        last.set(k, e.t);
      }
    }
  });
  it('14 잠든 취객: 믿음에 asleep · 용의자 규칙이 움직이지 않는다 · 판정의 검거 수에 들지 않는다 · 경찰이 1.5칸 안에 4초 머물면 깨어 보통 주취자가 된다', () => {
    let sim: Sim | undefined, I: Inc | undefined;
    for (const seed of ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']) {
      const q = new Sim(seed, NORMAL, 1200, { force: 'disturb/rowdy' });
      let J: Inc | undefined;
      for (let k = 0; k < 600 && !J; k++) { q.step(); J = q.incidents.find((x) => forced(q)(x) && !!q.scenes[x.id]); }
      if (J && q.scenes[J.id]!.hostiles[0].asleep) { sim = q; I = J; break; }
    }
    expect(I, '잠든 취객이 있는 시드').toBeTruthy();
    const s = sim!.scenes[I!.id]!, h = s.hostiles[0];
    expect(hosFact(sim!, s, h, '시험', 1).value.state).toBe('asleep');
    const x0 = h.x, y0 = h.y;
    for (let k = 0; k < 20; k++) tickHostiles(sim!, s, I!);
    expect([h.x, h.y, h.state]).toEqual([x0, y0, 'hold']);
    // 깨우기: 경찰 대원이 곁에 4초 머문다 (현장에 경찰이 닿을 때까지 돌린 뒤)
    for (let k = 0; k < 4000 && h.asleep && I!.phase !== 'closed'; k++) sim!.step();
    expect(h.asleep, '깨었다').toBe(false);
    expect(sim!.events.some((e) => e.incidentId === I!.id && e.text.includes('눈을 떴습니다'))).toBe(true);
  });
  it('14 날치기: 숨었다가 나갈 시각(첫 도착 + 60~140초)이 정해지고, 찾았을 때 SCENE_MISMATCH 가 남지 않는다(보통 기록) · 경찰 한 팀이면 지휘관이 한 팀 더 부른다', () => {
    let found = 0;
    for (const seed of ['S0', 'S1', 'S2', 'S3']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: 'disturb/snatch' });
      const I = runUntilClosed(sim, forced(sim), 7000)!;
      const s = sim.scenes[I.id]!, h = s.hostiles[0];
      expect(s.kinds!.expectHidden).toBe(true);
      if (s.arrivedAt >= 0) { expect(h.hideUntil! - s.arrivedAt).toBeGreaterThanOrEqual(60); expect(h.hideUntil! - s.arrivedAt).toBeLessThanOrEqual(140); }
      expect(I.problems.some((p) => p.code === 'SCENE_MISMATCH' && p.detail === '숨어 있던 추가 용의자 발견'), seed).toBe(false);
      if (sim.events.some((e) => e.incidentId === I.id && e.text.startsWith('숨어 있던 용의자 발견'))) found++;
    }
    expect(found, '찾은 교대가 있다').toBeGreaterThan(0);
    // 한 팀뿐인 경찰: 폭행 시비에 경찰이 한 팀만 닿으면 22초 규칙으로 한 팀 더 부른다
    let asked = 0;
    for (const seed of ['S0', 'S1', 'S2', 'S3']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: 'disturb/brawl' });
      const I = runUntilClosed(sim, forced(sim), 7000)!;
      if (sim.events.some((e) => e.incidentId === I.id && e.text.includes('한 팀으로는 말을 걸면서 붙잡을 수 없음'))) asked++;
    }
    expect(asked, '경찰 한 팀만 닿은 폭행 시비에서 추가 요청').toBeGreaterThan(0);
  });
});

// ───────────────────────── 단계 6b (치안 — 수거책 잠복 · 차량 절도 · 견인차 · 교통사고의 견인) ─────────────────────────
import { SCAM } from '../src/sim/field/rules/kinds';
import { TOW_WAIT } from '../src/sim/field/orders/kinds';
import { makeAgent } from '../src/sim/field/agents';
const DISTURB_6B = ['disturb/scam', 'disturb/cartheft'];
/** 작업판을 틱마다 훑어 되풀이를 센다 (시험 9): 같은 대상의 작업이 60초 안에 셋 생기거나, 같은 대상의 작업에 같은 대원이 25초 안에 다시 붙으면(지시·스스로 맡음 — 담당자 목록에 새로 든 때) 그 사연 */
function watchBoard(kinds: WorkKind[]): { look: (sim: Sim, s: Scene) => void; bad: () => string } {
  const made = new Map<string, number[]>(), seenW = new Set<number>(), had = new Map<number, number[]>(), joined = new Map<string, number>();
  let bad = '';
  return {
    look(sim, s) {
      for (const w of s.board) {
        if (kinds.indexOf(w.kind) < 0) continue;
        if (!seenW.has(w.id)) {
          seenW.add(w.id);
          const key = `${w.kind}:${w.prop}:${w.tile}:${w.hostile}:${w.cas}`, ts = made.get(key) ?? [];      // cas: (단계 8·9) 매달린 사람·지친 사람이 여럿 — 다른 사람에게 가는 일은 되풀이가 아니다
          ts.push(sim.t); made.set(key, ts);
          if (ts.filter((t) => t > sim.t - 60).length > 2) bad ||= `${key} 60초에 셋 (${sim.t.toFixed(1)})`;
        }
        const before = had.get(w.id) ?? [];
        for (const rid of w.assignees) {
          if (before.indexOf(rid) >= 0) continue;
          const k = `${w.kind}:${w.prop}:${w.tile}:${w.hostile}:${w.cas}:${rid}`, prev = joined.get(k);
          if (prev !== undefined && sim.t - prev < 25) bad ||= `${w.kind} #${w.id} → ${s.agents.find((q) => q.rid === rid) ? rid : '?'} ${(sim.t - prev).toFixed(1)}초 만에 다시`;
          joined.set(k, sim.t);
        }
        had.set(w.id, w.assignees.slice());
      }
    },
    bad: () => bad,
  };
}

describe('5·9·14 치안 — 수거책 잠복 · 차량 절도 · 교통사고의 견인 (단계 6b)', () => {
  it('5 두 시나리오는 강제 교대(S0·S1)에서 모두 닫히고 한계 시간·무대응이 아니다(방치는 차량 절도의 놓친 추격전만) · 9 잠복·검거·견인의 되풀이 없음 · 14 용의자는 모두 맨손, 차량 절도는 추격전으로 시작한다', () => {
    for (const key of DISTURB_6B) for (const seed of ['S0', 'S1']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: key });
      const wb = watchBoard(['cordon', 'arrest', 'towAway']);
      let J: Inc | undefined, chase = false;
      for (let k = 0; k < 7000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        if (!J) continue;
        if (J.pursuit) chase = true;
        const s = sim.scenes[J.id];
        if (s) wb.look(sim, s);
        if (J.phase === 'closed') break;
      }
      expect(J && J.phase, `${key} ${seed}`).toBe('closed');
      expect(wb.bad(), `${key} ${seed}: ${wb.bad()}`).toBe('');
      expect(['timeout', 'noresponse'].indexOf(J!.closeReason), `${key} ${seed}: ${J!.closeReason}`).toBe(-1);
      if (J!.closeReason === 'abandoned') expect(key === 'disturb/cartheft' && J!.pursuit?.state === 'escaped', `${key} ${seed}: 방치는 놓친 추격전만`).toBe(true);
      expect(chase, `${key}: 추격전`).toBe(key === 'disturb/cartheft');
      if (key === 'disturb/cartheft') expect(J!.pursuit!.kind).toBe('cartheft');
      const s = sim.scenes[J!.id];
      if (s) for (const h of s.hostiles) expect(h.weapon, `${key} ${h.label}`).toBe('none');
    }
  });
  it('14 수거책: 약속 시각(arriveAt) 전에는 s.hostiles 에 없고, 수거책을 보지 못한 사건은 약속 시각 + 40초 전에 닫히지 않는다 · 면담하면 믿음에 약속(evid meet)', () => {
    let met = 0;
    for (const seed of ['S0', 'S1', 'S2', 'S3']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: 'disturb/scam' });
      let J: Inc | undefined, early = '', seenHos = false;
      for (let k = 0; k < 7000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (!J || !s || !s.kinds) continue;
        if (sim.t < s.kinds.arriveAt! && s.hostiles.length > 0) early ||= `${seed} ${sim.t.toFixed(1)} < ${s.kinds.arriveAt!.toFixed(1)}`;
        if (s.agents.some((a) => a.beliefs.list('hos').length > 0)) seenHos = true;
        if (s.agents.some((a) => a.beliefs.list('evid').some((f) => (f.value as { kind?: string }).kind === 'meet'))) met++;
        if (J.phase === 'closed') break;
      }
      expect(early, early).toBe('');
      const k = sim.scenes[J!.id]!.kinds!;
      expect(J!.phase, seed).toBe('closed');
      // 믿음의 약속 시각은 피해자의 말(meetAt — 실제 도착 ± 20초)이다. 종료를 막는 것은 그 시각 + 40초
      if (!seenHos) expect(J!.closedAt, `${seed}: 수거책을 보지 못한 채 약속 시각 + 40초 전에 닫혔다`).toBeGreaterThanOrEqual(k.meetAt! + 40);
    }
    expect(met, '면담으로 약속을 안 교대').toBeGreaterThan(0);
  });
  it('14 사복 알아보기: 걸어오는 수거책은 제복 경찰을 8칸 안(시야선)에서, 사복 형사는 2칸 안에서만 알아보고 달아난다', () => {
    const sim = new Sim('S0', NORMAL, 1200, { force: 'disturb/scam' });
    let J: Inc | undefined;
    for (let k = 0; k < 3000 && !J; k++) { sim.step(); J = sim.incidents.find((x) => forced(sim)(x) && !!sim.scenes[x.id] && !!sim.scenes[x.id]!.kinds); }
    const s = sim.scenes[J!.id]!;
    expect(s.hostiles.length, '약속 시각 전').toBe(0);
    const saved = s.agents.splice(0, s.agents.length);
    s.kinds!.arriveAt = sim.t;
    tickScene(sim, s);
    expect(s.hostiles.length, '수거책이 나타났다').toBe(1);
    const h = s.hostiles[0];
    const det = sim.responders.find((r) => r.role === 'detective')!, cop = sim.responders.find((r) => r.dept === 'police' && r.role === 'officer')!;
    // 시야선이 열린 칸: 수거책이 선 줄에서 좌우로 d 칸
    const spot = (d: number): { x: number; y: number } => {
      for (const sx of [-1, 1]) { const x = h.x + sx * d, y = h.y; if (x > 0 && x < s.w - 1 && staticPass(s.tiles[Math.round(y) * s.w + Math.round(x)]) && los(s, h.x, h.y, x, y)) return { x, y }; }
      throw new Error('시야선이 열린 칸이 없다');
    };
    const p3 = spot(3);
    s.agents.push(makeAgent(sim, det.id, det.unitId, p3.x, p3.y, sim.t + 999, sim.rng.fork('t6b-a')));
    tickScene(sim, s);
    expect(h.state, '사복 3칸 — 알아보지 못한다').toBe('hold');
    s.agents.length = 0;
    const p6 = spot(SCAM.seeUniform - 2);
    s.agents.push(makeAgent(sim, cop.id, cop.unitId, p6.x, p6.y, sim.t + 999, sim.rng.fork('t6b-b')));
    tickScene(sim, s);
    expect(h.state, '제복 6칸 — 알아보고 달아난다').not.toBe('hold');
    expect(s.kinds!.scamFled).toBe(true);
    expect([SCAM.seeUniform, SCAM.seeDetective]).toEqual([8, 2]);
    s.agents.length = 0; s.agents.push(...saved);
  });
  it('14 차량 절도: 추격전으로 시작하고(도난 차량), 세운 뒤 운전자가 내려 달아나는 교대가 있다', () => {
    let fled = 0, stopped = 0;
    for (const seed of ['S0', 'S1', 'S2', 'S3', 'S4', 'S5']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: 'disturb/cartheft' });
      const I = runUntilClosed(sim, forced(sim), 7000)!;
      expect(I.pursuit, seed).toBeTruthy();
      expect(I.pursuit!.kind).toBe('cartheft');
      if (I.pursuit!.state !== 'stopped') continue;
      stopped++;
      const s = sim.scenes[I.id]!;
      if (s.kinds!.stopFled) fled++;
    }
    expect(stopped, '세운 교대').toBeGreaterThan(0);
    expect(fled, '도보 도주가 생긴 교대').toBeGreaterThan(0);
  });
  it('14 견인: 교통사고에 견인차가 배정되면 차로를 막은 차에 towAway 가 나고 그 차의 clearRoad 는 나지 않는다(견인 장비를 든 견인 기사만 맡는다) · 9 견인의 되풀이 없음', () => {
    let towed = 0;
    for (const seed of ['S0', 'S1', 'S2']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: 'traffic/std' });
      const wb = watchBoard(['towAway', 'clearRoad']);
      let J: Inc | undefined;
      const towAt = new Map<number, number>(), roadAfter: string[] = [];
      for (let k = 0; k < 7000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (!J || !s) continue;
        wb.look(sim, s);
        for (const w of s.board) {
          if (w.kind === 'towAway' && !towAt.has(w.prop)) towAt.set(w.prop, w.createdAt);
          if (w.kind === 'clearRoad' && towAt.has(w.prop) && w.createdAt > towAt.get(w.prop)! && w.status !== 'cancelled' && roadAfter.indexOf(`${w.prop}@${w.createdAt.toFixed(1)}`) < 0) roadAfter.push(`${w.prop}@${w.createdAt.toFixed(1)}`);
        }
        if (J.phase === 'closed') break;
      }
      expect(J!.phase, seed).toBe('closed');
      expect(wb.bad(), `${seed}: ${wb.bad()}`).toBe('');
      const gaveUp = sim.events.some((e) => e.incidentId === J!.id && e.text.startsWith('견인차가 오지 않습니다'));
      if (!gaveUp) expect(roadAfter, `${seed}: 견인을 낸 차에 도로 정리`).toEqual([]);
      if (J!.everAssigned.some((uid) => sim.units[uid].kind === 'tow')) expect(towAt.size, `${seed}: 견인차가 왔는데 견인 작업이 없다`).toBeGreaterThan(0);
      const s = sim.scenes[J!.id]!;
      for (const w of s.board) if (w.kind === 'towAway' && w.status === 'done') {
        towed++;
        expect(s.props[w.prop].removed && s.props[w.prop].cleared).toBe(true);
        for (const rid of Object.keys(w.orderSentAt).map(Number)) expect(hasKit(sim, rid, 'towKit'), sim.responders[rid].name).toBe(true);
      }
    }
    expect(towed, '견인을 마친 교대').toBeGreaterThan(0);
  });
  it('14 견인의 시간 막이: 견인차가 오는 중인데 towAway 를 낸 지 TOW_WAIT 가 지나도록 현장에 없으면 towAway 를 거두고 clearRoad(밀어 둠)로 돌아간다 · 견인차가 배정되지 않았으면 처음부터 clearRoad · (단계 11) 견인차가 와 있어도 견인 기사가 다쳤으면 같은 시간 막이', () => {
    const wait0 = TOW_WAIT.s;
    try {
      for (const towState of ['far', 'none', 'hurt'] as const) {
        const { sim, I } = quietSim('N8-6B-TOW', 'traffic');
        const s = sim.scenes[I.id]!;
        const eng = sim.units.find((u) => u.kind === 'engine')!;
        placeAt(sim, eng, I); land(sim, I, eng);
        const tow = sim.units.find((u) => u.kind === 'tow')!;
        if (towState === 'far') { tow.state = 'enroute'; tow.incidentId = I.id; I.assigned.push(tow.id); }      // 오는 중 (시험은 tickScene 만 돌리므로 움직이지 않는다)
        if (towState === 'hurt') { placeAt(sim, tow, I); land(sim, I, tow); for (const rid of tow.crew) sim.responders[rid].status = 'injured'; }      // 와 있는데 견인 기사가 다쳤다 (가벼운 일만 — 견인은 맡지 않는다)
        for (const c of s.casualties) { c.where = 'safe'; c.inVehicle = null; c.tDiscovered = sim.t; c.health = 90; }
        TOW_WAIT.s = 20;
        let towMade = -1, giveUp = -1, road = -1;
        for (let k = 0; k < 150 * 5 && road < 0; k++) {
          sim.tick++; sim.t = sim.tick * sim.dt; tickScene(sim, s);
          if (towMade < 0 && s.board.some((w) => w.kind === 'towAway')) towMade = sim.t;
          if (giveUp < 0 && sim.events.some((e) => e.incidentId === I.id && e.text.startsWith(towState === 'hurt' ? '견인 기사가 다쳐 견인을 맡을 사람이 없습니다' : '견인차가 오지 않습니다'))) giveUp = sim.t;
          if ((towState === 'none' || giveUp >= 0) && s.board.some((w) => w.kind === 'clearRoad' && w.status !== 'cancelled')) road = sim.t;
        }
        if (towState === 'far' || towState === 'hurt') {
          expect(towMade, `${towState}: 견인 작업`).toBeGreaterThan(0);
          expect(giveUp - towMade, '시간 막이').toBeGreaterThanOrEqual(20);
          expect(s.board.some((w) => w.kind === 'towAway' && (w.status === 'open' || w.status === 'active')), '견인 작업을 거뒀다').toBe(false);
        } else expect(towMade, '견인차가 없으면 견인 작업이 없다').toBe(-1);
        expect(road, `${towState}: 도로 정리로 돌아간다`).toBeGreaterThan(0);
      }
    } finally { TOW_WAIT.s = wait0; }
    expect(TOW_WAIT.s).toBe(150);
  });
});

// ───────────────────────── 단계 7 (보호 — 치매 노인 · 미아) ─────────────────────────
import { CHILD } from '../src/sim/field/rules/kinds';
import { WELFARE_ROUNDS } from '../src/sim/field/commander';

describe('5·9·11 보호 — 치매 노인 · 미아 (단계 7)', () => {
  it('5 두 시나리오는 강제 교대(S0·S1)에서 모두 닫히고 한계 시간·방치·무대응이 아니다 · 9 수색·통제·데려가기의 되풀이 없음 · 11 보호 유형의 구조 대상은 숨지지 않고 체력이 20 아래로 내려가지 않는다', () => {
    for (const key of WELFARE_LINES) for (const seed of ['S0', 'S1']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: key });
      const wb = watchBoard(['cordon', 'escort']);
      let J: Inc | undefined, minHp = 100;
      for (let k = 0; k < 7000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (!J || !s) continue;
        wb.look(sim, s);
        for (const c of s.casualties) { expect(c.dead, `${key} ${seed}`).toBe(false); minHp = Math.min(minHp, c.health); }
        if (J.phase === 'closed') break;
      }
      expect(J && J.phase, `${key} ${seed}`).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(J!.closeReason), `${key} ${seed}: ${J!.closeReason}`).toBe(-1);
      expect(wb.bad(), `${key} ${seed}: ${wb.bad()}`).toBe('');
      expect(minHp, `${key} ${seed}`).toBeGreaterThanOrEqual(20);
    }
  });
  it('11 미아는 강제 S0~S9 모두 찾고(못 찾으면 한계 40초 전에 시민이 데려온다 — 그때 지휘관이 그 사실을 강제로 안다) 결과가 성공 또는 대응 지연 · 출구의 은폐는 0.84 를 넘지 않는다', () => {
    let backed = 0;
    for (let k = 0; k < 10; k++) {
      const sim = new Sim('S' + k, NORMAL, 1200, { force: 'welfare/lostchild' });
      let J: Inc | undefined, maxConc = 0;
      for (let n = 0; n < 7000 && !sim.ended; n++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (s) for (const c of s.casualties) if (c.isTarget) maxConc = Math.max(maxConc, c.concealment);
        if (J && J.phase === 'closed') break;
      }
      const s = sim.scenes[J!.id]!, c = s.casualties.find((q) => q.isTarget)!;
      expect(J!.phase, `S${k}`).toBe('closed');
      expect(c.tDiscovered, `S${k}: 찾았다`).toBeGreaterThanOrEqual(0);
      expect(['success', 'delayed'].indexOf(J!.result!.outcome), `S${k}: ${J!.result!.outcome}`).toBeGreaterThanOrEqual(0);
      expect(maxConc, `S${k}`).toBeLessThanOrEqual(CHILD.hideMax + 1e-9);
      if (s.kinds!.backed) {
        backed++;
        expect(J!.result!.outcome, `S${k}: 시민이 데려왔으면 대응 지연`).toBe('delayed');
        expect(sim.events.some((e) => e.incidentId === J!.id && e.text.startsWith('아이를 보호하던 시민이 안내 데스크로 데려왔습니다'))).toBe(true);
      }
    }
    expect(CHILD.hideMax).toBe(0.84);
    expect(backed).toBeGreaterThanOrEqual(0);
  });
  it('11 치매 노인: 생성기 400번 — 체력은 70~90(하한 20 위), 걷는 대상 하나와 보호자 · 도심 틀의 찻길은 수색 구역이 아니다 · 재수색 상한은 실종(3)보다 길다', () => {
    const sim = new Sim('N8-7-GEN', NORMAL, 1200, { force: null });
    for (let k = 0; k < 400; k++) {
      const I = createIncident(sim, { type: 'welfare', variant: 'dementia', rng: sim.rng.fork('n8-7-gen' + k) });
      const s = sim.scenes[I.id]!;
      const t = s.casualties.filter((c) => c.isTarget);
      expect(t.length).toBe(1);
      expect(t[0].health).toBeGreaterThanOrEqual(70); expect(t[0].health).toBeLessThanOrEqual(90);
      expect(t[0].wander).toBe(true);
      expect(s.props.some((p) => p.kind === 'witness')).toBe(true);
      expect(s.regions.filter((r) => r.kind === 'zone' && r.searchable).length).toBe(4);
      I.phase = 'closed';
    }
    expect(WELFARE_ROUNDS).toBeGreaterThan(3);
  });
});

// ───────────────────────── 단계 8 (구조 — 외벽 작업자 고립 · 구덩이 추락 · 멈춘 놀이기구 · 높은 자리 틀 §5.11) ─────────────────────────
import { isHovering } from '../src/sim/crews';
import { LABOR, casFact } from '../src/sim/field/agents';
import { METHOD } from '../src/sim/field/methods';
import { MED } from '../src/sim/field/rules/kinds';

const RESCUE_LINES = ['rescue/facade', 'rescue/pit', 'rescue/ride'];      // (단계 8)
const MED_LINES = ['medical/poison', 'medical/overdose', 'medical/birth', 'medical/heat'];      // (단계 9)

describe('5·17 구조 — 외벽 · 구덩이 · 놀이기구 (단계 8)', () => {
  it('5 구조 세 시나리오는 강제 교대(S0·S1)에서 모두 닫히고 한계 시간·방치·무대응이 아니다 · 9 구출·통제의 되풀이 없음 · 끝날 때 높은 자리에 남은 사람이 없거나 결과가 성공이 아니다', () => {
    for (const key of RESCUE_LINES) for (const seed of ['S0', 'S1']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: key });
      const wb = watchBoard(['extricate', 'cordon']);
      let J: Inc | undefined;
      for (let k = 0; k < 7000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (!J || !s) continue;
        wb.look(sim, s);
        if (J.phase === 'closed') break;
      }
      expect(J && J.phase, `${key} ${seed}`).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(J!.closeReason), `${key} ${seed}: ${J!.closeReason}`).toBe(-1);
      expect(wb.bad(), `${key} ${seed}: ${wb.bad()}`).toBe('');
      const s = sim.scenes[J!.id]!;
      const left = (s.kinds?.perch ?? []).filter((pe) => !s.casualties[pe.cas].dead).length;
      if (left > 0) expect(J!.result!.outcome, `${key} ${seed}: 높은 자리에 ${left}명이 남았는데 성공`).not.toBe('success');
    }
  });
  it('17 높은 자리 틀: 외벽·놀이기구의 매달린 사람은 T.LEDGE 칸에 있고(걸어서 닿지 못함) 사다리를 펴는 땅 칸은 걸을 수 있다 · casFact 가 높이를 싣는다 · 소방 헬기는 상공에 머문다(구덩이는 아니다)', () => {
    const sim = new Sim('N8-8-GEN', NORMAL, 1200, { force: null });
    const heli = { kind: 'heli' } as unknown as Unit, pump = { kind: 'engine' } as unknown as Unit;
    let perched = 0;
    for (let k = 0; k < 60; k++) {
      const variant = k % 3 === 0 ? 'facade' : k % 3 === 1 ? 'ride' : 'pit';
      const I = createIncident(sim, { type: 'rescue', variant, rng: sim.rng.fork('n8-8-gen' + k) });
      const s = sim.scenes[I.id]!;
      expect(s.outdoor, variant).toBe(true);
      if (variant === 'pit') {
        expect(isHovering(heli, s), 'pit').toBe(false);
        const c = s.casualties[0];
        expect(c.mob).toBe('trapped');
        expect(s.tiles[Math.round(c.y) * s.w + Math.round(c.x)]).toBe(T.VOID);
        const v = casFact(sim, s, c, '시험').value as { pit?: boolean; perch?: number };
        expect(v.pit, '구덩이의 사람은 pit').toBe(true);
        expect(v.perch).toBeUndefined();
      } else {
        expect(isHovering(heli, s), variant).toBe(true);
        expect(isHovering(pump, s), variant).toBe(false);
        for (const pe of s.kinds!.perch!) {
          const c = s.casualties[pe.cas];
          expect(s.tiles[pe.y * s.w + pe.x], variant).toBe(T.LEDGE);
          expect(staticPass(s.tiles[pe.y * s.w + pe.x])).toBe(false);
          expect(staticPass(s.tiles[pe.ground]), `${variant} 땅 칸`).toBe(true);
          expect(pe.h).toBeGreaterThanOrEqual(1); expect(pe.h).toBeLessThanOrEqual(3);
          const v = casFact(sim, s, c, '시험').value as { pit?: boolean; perch?: number };
          expect(v.perch, '높이 단계').toBe(pe.h);
          expect(v.pit, '높은 자리는 구덩이가 아니다').toBeFalsy();
          perched++;
        }
      }
      I.phase = 'closed';
    }
    expect(perched).toBeGreaterThan(40);
  });
  it('17 방법: 사다리(사다리차 · 높이 2 이하) · 하강(밧줄 — 높이 무관) · 호이스트 — 외벽 강제 S0~S3 의 매달린 사람은 이 셋으로만 내려온다 · 사다리로 내린 사람은 높이 3 이 아니었다', () => {
    expect(METHOD.ladder.work).toContain('extricate');
    expect(METHOD.descend.work).toContain('extricate');
    let freed = 0;
    for (let k = 0; k < 4; k++) {
      const sim = new Sim('S' + k, NORMAL, 1200, { force: 'rescue/facade' });
      const h0 = new Map<number, number>();
      let J: Inc | undefined;
      for (let n = 0; n < 7000 && !sim.ended; n++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (s && s.kinds?.perch) for (const pe of s.kinds.perch) h0.set(pe.cas, pe.h);      // 마지막으로 본 높이 (줄이 끊기면 내려앉는다)
        if (J && J.phase === 'closed') break;
      }
      const s = sim.scenes[J!.id]!;
      for (const c of s.casualties) {
        if (c.tFreed < 0 || c.dead) continue;
        freed++;
        expect(['ladder', 'descend', 'hoist'].indexOf(c.freedHow ?? ''), `S${k} ${c.label}: ${c.freedHow}`).toBeGreaterThanOrEqual(0);
        if (c.freedHow === 'ladder') expect(h0.get(c.id) ?? 0, `S${k} ${c.label}`).toBeLessThanOrEqual(2);
      }
    }
    expect(freed).toBeGreaterThan(0);
  });
  it('17 몫: 구조 줄의 몫 합 0.75 · 나머지는 기본 변형 구덩이(fallback) · 평소 추첨(tag kinds, daily 아님) · 구조의 가중은 0.06', () => {
    const lines = SCENARIOS.filter((q) => q.type === 'rescue');
    expect(lines.map((q) => `${q.type}/${q.variant}`).sort()).toEqual([...RESCUE_LINES].sort());
    expect(Math.round(lines.reduce((a, q) => a + q.share, 0) * 100) / 100).toBe(0.75);
    for (const q of lines) expect(q.tag, q.variant).toBe('kinds');
    expect(TYPE_DEFS.rescue.fallback).toBe('pit');
    expect(TYPE_DEFS.rescue.weight).toBe(0.06);
    const sim = new Sim('N8-8-FB', NORMAL, 1200, { force: null });
    const seen = new Map<string, number>();
    for (let k = 0; k < 200; k++) {
      const I = createIncident(sim, { type: 'rescue', rng: sim.rng.fork('n8-8-fb' + k) });
      seen.set(I.truth.variant, (seen.get(I.truth.variant) ?? 0) + 1);
      I.phase = 'closed';
    }
    for (const v of seen.keys()) expect(['facade', 'pit', 'ride'].indexOf(v), v).toBeGreaterThanOrEqual(0);
    expect(seen.get('pit') ?? 0, '구덩이 = 몫 0.2 + 나머지 0.25').toBeGreaterThan(seen.get('ride') ?? 0);
  });
});

describe('5·19 응급의 갈래 — 식중독 · 약물 과다 · 출산 · 폭염 (단계 9)', () => {
  it('5 응급 네 갈래는 강제 교대(S0·S1)에서 모두 닫히고 한계 시간·방치·무대응이 아니다 · 9 처치·데려가기·설득의 되풀이 없음 · 19 식중독은 곁방 환자까지 모두 찾는다', () => {
    for (const key of MED_LINES) for (const seed of ['S0', 'S1']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: key });
      const wb = watchBoard(key === 'medical/birth' ? ['escort', 'persuade', 'treat', 'load'] : ['escort', 'persuade']);      // 출산: 현장 분만의 처치·미룬 탑승도 (식중독의 처치 넘겨받기는 R3 CE2 의 몫)
      let J: Inc | undefined;
      for (let k = 0; k < 7000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (!J || !s) continue;
        wb.look(sim, s);
        if (J.phase === 'closed') break;
      }
      expect(J && J.phase, `${key} ${seed}`).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(J!.closeReason), `${key} ${seed}: ${J!.closeReason}`).toBe(-1);
      expect(wb.bad(), `${key} ${seed}: ${wb.bad()}`).toBe('');
      if (key === 'medical/poison') {
        const s = sim.scenes[J!.id]!;
        for (const c of s.casualties) expect(c.tDiscovered >= 0 || c.where !== 'scene', `${seed} ${c.label}: 찾지 못함`).toBe(true);
      }
    }
  });
  it('19 신고 인원: 식중독의 인원 진술은 둘 이상 · 지금의 응급(실신)은 "한 명"', () => {
    for (const [key, many] of [['medical/poison', true], ['medical/faint', false]] as [string, boolean][]) {
      for (let k = 0; k < 3; k++) {
        const sim = new Sim('S' + k, NORMAL, 1200, { force: key });
        let J: Inc | undefined;
        for (let n = 0; n < 3000 && !sim.ended; n++) {
          sim.step();
          J = sim.incidents.find(forced(sim));
          if (J && J.claims.some((c) => c.topic === 'count')) break;
        }
        const cl = J!.claims.find((c) => c.topic === 'count');
        if (!cl) continue;      // 인원을 묻기 전에 통화가 끝났다
        if (many) expect(cl.value as number, `${key} S${k}`).toBeGreaterThan(1);
        else expect(cl.value, `${key} S${k}`).toBe(1);
      }
    }
  });
  it('19 출산: 신고자 안내를 따르면 coached · 낳으면 신생아가 구조 대상 끝에 붙고 지휘관이 강제로 안다(done) · 믿는 시각이 창(90초) 안이면 산모를 싣지 않고 곁에서 기다린다', () => {
    expect(LABOR.WIN).toBe(90);
    const sim0 = new Sim('N8-9-B', NORMAL, 1200, { force: null });
    const I0 = createIncident(sim0, { type: 'medical', variant: 'birth', rng: sim0.rng.fork('n8-9-b') });
    const s0 = sim0.scenes[I0.id]!;
    expect(s0.kinds!.coached).toBe(false);
    applyCallerAid(sim0, I0, 'birth', -1);
    expect(s0.kinds!.coached).toBe(true);
    expect(s0.kinds!.birthAt! - I0.createdAt).toBeGreaterThanOrEqual(60);
    expect(s0.kinds!.birthAt! - I0.createdAt).toBeLessThanOrEqual(240);
    let born = 0, waited = 0;
    for (let k = 0; k < 4; k++) {
      const sim = new Sim('S' + k, NORMAL, 1200, { force: 'medical/birth' });
      let J: Inc | undefined, loadedBefore = false;
      for (let n = 0; n < 7000 && !sim.ended; n++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (!J || !s) continue;
        if (s.agents.some((a) => a.label === '분만 대기')) waited++;
        if (s.kinds!.birthAt !== undefined && sim.t < s.kinds!.birthAt && s.casualties[0].where === 'loaded') loadedBefore = true;
        if (J.phase === 'closed') break;
      }
      const s = sim.scenes[J!.id]!;
      expect(J!.phase, `S${k}`).toBe('closed');
      if (s.casualties.length > 1) {
        born++;
        const nb = s.casualties[s.casualties.length - 1];
        expect(nb.label, `S${k}`).toBe('신생아');
        expect(nb.mob).toBe('immobile');
        const cmd = s.agents.find((a) => a.isCommander) ?? s.agents[0];
        const v = cmd.beliefs.val<{ kind: string; done?: boolean }>('evid', 1000 + s.casualties[0].id);
        expect(v && v.done, `S${k}: 지휘관이 출산을 안다`).toBe(true);
      } else expect(loadedBefore || sim.events.some((e) => e.incidentId === J!.id && e.text.startsWith('이송 중인 구급차 안에서')), `S${k}: 신생아가 없으면 그 전에 실려 갔다`).toBe(true);
    }
    expect(born).toBeGreaterThan(0);
    expect(waited, '현장 분만 대기(진행 막대)가 한 번은 나온다').toBeGreaterThan(0);
  });
  it('19 폭염: gate 는 낮·맑음만(밤·비에 거짓) · 그늘 구역이 있고 안전한 곳은 그늘 안 · 지친 사람은 안내받아 그늘(s.safe)로 가고 그늘에서는 깎이지 않는다', () => {
    const heat = SCENARIOS.find((q) => q.type === 'medical' && q.variant === 'heat')!;
    const at = (h: number, w: string) => heat.gate!({ clock: h * 3600, weather: w } as unknown as Sim);      // gate 는 시각(sim.clock)과 날씨만 읽는다
    expect(at(13, 'clear')).toBe(true);
    expect(at(23, 'clear')).toBe(false);
    expect(at(13, 'rain')).toBe(false);
    expect(at(8, 'clear')).toBe(false);
    const sim = new Sim('N8-9-H', NORMAL, 1200, { force: null });
    for (let k = 0; k < 20; k++) {
      const I = createIncident(sim, { type: 'medical', variant: 'heat', rng: sim.rng.fork('n8-9-h' + k) });
      const s = sim.scenes[I.id]!;
      const rg = s.region[s.safe.y * s.w + s.safe.x];
      expect(rg >= 0 && s.regions[rg].kind === 'shade', '안전한 곳은 그늘').toBe(true);
      expect(s.casualties.filter((c) => c.mob === 'mobile').length).toBeGreaterThanOrEqual(2);
      I.phase = 'closed';
    }
    // 지친 사람은 대원이 처음 만날 때 안내받아 스스로 그늘(s.safe)로 걷는다 — 그늘 안의 사람은 heatRule 이 더 깎지 않는다
    let shaded = 0, hurtInShade = 0;
    for (let k = 0; k < 2; k++) {
      const sim2 = new Sim('S' + k, NORMAL, 1200, { force: 'medical/heat' });
      let J: Inc | undefined;
      const hp = new Map<number, number>();
      for (let n = 0; n < 7000 && !sim2.ended; n++) {
        sim2.step();
        J = sim2.incidents.find(forced(sim2));
        const s = J ? sim2.scenes[J.id] : undefined;
        if (!J || !s) continue;
        for (const c of s.casualties) {
          const rg = s.region[Math.round(c.y) * s.w + Math.round(c.x)];
          const inShade = rg >= 0 && s.regions[rg].kind === 'shade' && c.mob === 'mobile' && !c.treated;
          if (inShade && hp.has(c.id) && c.health < hp.get(c.id)! - 1e-9) hurtInShade++;
          hp.set(c.id, c.health);
        }
        if (J.phase === 'closed') break;
      }
      const s = sim2.scenes[J!.id]!;
      for (const c of s.casualties) if (c.where === 'safe' || c.where === 'loaded' || c.where === 'hospital') shaded++;
    }
    expect(shaded, '그늘(안전한 곳)에 닿거나 실려 간 사람').toBeGreaterThan(0);
    expect(hurtInShade, '그늘 안의 걷는 사람은 더위에 깎이지 않는다').toBe(0);
  });
  it('19 약물 과다: 흥분(evid agitated)을 믿으면 경찰에게 persuade 가 나온다 · 흥분이 끝나면 강제 보고로 거둔다 · 흥분 확률 0.35', () => {
    expect(MED.agiP).toBe(0.35);
    let agitated = 0, persuaded = 0;
    for (let k = 0; k < 12 && agitated < 2; k++) {
      const sim = new Sim('S' + k, NORMAL, 1200, { force: 'medical/overdose' });
      let J: Inc | undefined, saw = false, ask = false, after = false;
      for (let n = 0; n < 7000 && !sim.ended; n++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (!J || !s) continue;
        if ((s.kinds!.agitated ?? -1) > sim.t) saw = true;
        if (s.board.some((w) => w.kind === 'persuade')) ask = true;
        if (saw && (s.kinds!.agitated ?? -1) < sim.t - 6 && s.board.some((w) => w.kind === 'persuade' && (w.status === 'open' || w.status === 'active'))) after = true;
        if (J.phase === 'closed') break;
      }
      expect(J!.phase, `S${k}`).toBe('closed');
      if (saw) { agitated++; if (ask) persuaded++; expect(after, `S${k}: 흥분이 끝난 뒤에도 설득이 남았다`).toBe(false); }
    }
    expect(agitated, '흥분한 환자가 한 번은 나온다').toBeGreaterThan(0);
    expect(persuaded, '흥분한 환자에게 설득').toBeGreaterThan(0);
  });
});

// ───────────────────────── 단계 10 — 비응급 N3 단순 민원 이관 · N4 중복 신고 오인 ─────────────────────────
import { REFER, SAME_SLIP, SAME_YES, sameAnswer } from '../src/sim/kindsCaller';
import { referable, sameCandidate } from '../src/sim/dispatch/screening';
import { DUP } from '../src/sim/scenarios/kinds';
import { Rng } from '../src/sim/rng';
import type { Call, Claim, Persona } from '../src/sim/types';

describe('8 비응급 N3 단순 민원 이관 · N4 중복 신고 오인 (단계 10)', () => {
  it('N3: 고함 진술이 없으면 접수 단계에서 창구로 넘긴다(배정 0 · 성공 · 문제 없음) · 있으면 순찰 한 팀이 가서 이웃을 면담하고 현장 중재(FALSE_ALARM 복구됨)', () => {
    let referred = 0, mediated = 0;
    for (let k = 0; k < 40 && (referred < 2 || mediated < 1); k++) {
      const sim = new Sim('RG' + k, NORMAL, 1200, { force: 'disturb/referral' });
      const I = runUntilClosed(sim, forced(sim));
      expect(I && I.phase === 'closed', `RG${k}`).toBe(true);
      if (!I) continue;
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(I.closeReason), `RG${k} ${I.closeReason}`).toBe(-1);
      const noise = I.claims.some((c) => c.topic === 'hazard' && c.value === 'noise');
      if (!noise) {
        referred++;
        expect(I.closeReason, `RG${k}`).toBe('screened');
        expect(I.everAssigned.length, `RG${k} 배정`).toBe(0);
        expect(I.result!.outcome).toBe('success');
        expect(I.problems.some((p) => p.code === 'FALSE_ALARM'), '넘겼으면 문제 코드 없음').toBe(false);
        expect(I.result!.headline).toContain('단순 민원 — 관할 기관 이관');
        expect(sim.events.some((e) => e.incidentId === I.id && /창구로 안내해 드리겠습니다/.test(e.text))).toBe(true);
      } else {
        mediated++;
        expect(I.closeReason, `RG${k}`).toBe('resolved');
        expect(I.everAssigned.length, `RG${k} 순찰 한 팀`).toBe(1);
        expect(sim.units[I.everAssigned[0]].dept).toBe('police');
        expect(I.problems.some((p) => p.code === 'FALSE_ALARM' && p.recovered && p.recoveryText === '현장 중재로 마무리')).toBe(true);
        expect(I.result!.headline).toContain('단순 민원 — 현장 중재');
        expect(sim.events.some((e) => e.incidentId === I.id && /현장에서 중재해 마무리/.test(e.text)), `RG${k} 이웃 면담`).toBe(true);
      }
    }
    expect(referred, '넘긴 민원').toBeGreaterThanOrEqual(2);
    expect(mediated, '현장 중재').toBeGreaterThanOrEqual(1);
    expect(REFER.noise).toBe(0.2);
  }, 120000);
  it('N3 의 가려내기는 진술만 본다: 민원뿐이면 넘기고, 다쳤다·갇혔다·무기·지금 다툰다 진술이 하나라도 있거나 다른 상황 진술이 있으면 넘기지 않는다', () => {
    const c = (topic: Claim['topic'], value: unknown): Claim => ({ topic, value, conf: 0.8, text: '', truthful: true, callId: 0, note: '' });
    expect(referable([c('nature', 'complaint'), c('location', 3), c('hazard', 'none')])).toBe(true);
    expect(referable([c('nature', 'complaint'), c('hazard', 'noise')])).toBe(false);
    expect(referable([c('nature', 'complaint'), c('injured', true)])).toBe(false);
    expect(referable([c('nature', 'complaint'), c('trapped', true)])).toBe(false);
    expect(referable([c('nature', 'complaint'), c('weapon', 'knife')])).toBe(false);
    expect(referable([c('nature', 'complaint'), c('weapon', 'none'), c('injured', false)])).toBe(true);
    expect(referable([c('nature', 'complaint'), c('nature', 'fight')])).toBe(false);
    expect(referable([c('location', 3)])).toBe(false);
  });
  it('N4: 추가 신고가 옆 교차로의 새 사건(dup)이 되면 첫 신고는 그 틱 · 원 사건의 추가 신고는 다시 울리지 않는다 · 알아보면 원 사건에 진술을 넘기고 합친 쪽만 닫힌다 · 못 알아보면 출동해 확인(FALSE_ALARM)', () => {
    const P0 = DUP.P;
    DUP.P = 1;      // 시험: 추가 신고마다 중복 신고가 된다 (보통 0.03)
    let linked = 0, missed = 0;
    try {
      for (let k = 0; k < 20 && (linked < 1 || missed < 1); k++) {
        const sim = new Sim('D' + k);
        let J: Inc | undefined, born = -1;
        for (let t = 0; t < 9000 && !sim.ended; t++) {
          const n0 = sim.incidents.length;
          sim.step();
          if (!J) { for (let i = n0; i < sim.incidents.length; i++) if (sim.incidents[i].truth.variant === 'dup') { J = sim.incidents[i]; born = sim.t; } }
          if (J && J.phase === 'closed') break;
        }
        if (!J || J.phase !== 'closed') continue;
        const K = sim.incidents[J.dupOf!];
        expect(K, `D${k}`).toBeTruthy();
        expect(J.firstCallAt, `D${k} 첫 신고는 만든 그 틱`).toBe(born);
        expect(J.parent, '연쇄가 아니다').toBeUndefined();
        expect(J.tag).toBe('daily');
        expect(J.truth.type).toBe(K.truth.type);
        expect(K.followupAt, `D${k} 원 사건의 추가 신고는 다시 울리지 않는다`).toBe(Infinity);
        expect(sim.calls.filter((c) => c.incidentId === K.id && c.isFollowup).length, `D${k}`).toBe(0);
        expect(sim.city.nodes[K.truth.nodeId].edges.some((e) => sim.city.edges[e].a === J!.truth.nodeId || sim.city.edges[e].b === J!.truth.nodeId), '옆 교차로').toBe(true);
        expect(['timeout', 'abandoned', 'noresponse'].indexOf(J.closeReason), `D${k} ${J.closeReason}`).toBe(-1);
        const same = J.claims.find((c) => c.topic === 'same');
        if (J.closeReason === 'screened') {
          linked++;
          expect(same && same.value, `D${k}`).toBe(K.id);
          expect(J.result!.outcome).toBe('success');
          expect(J.problems.some((p) => p.code === 'FALSE_ALARM')).toBe(false);
          expect(J.result!.headline).toContain('중복 신고 — 같은 사건에 합침');
          const moved = J.claims.filter((c) => c.topic !== 'location' && c.topic !== 'same' && c.topic !== 'verify');
          expect(moved.length).toBeGreaterThan(0);
          for (const c of moved) expect(K.claims.some((q) => q.callId === c.callId && q.topic === c.topic && q.text === c.text), `D${k} 원 사건에 넘긴 진술 ${c.topic}`).toBe(true);
          expect(sim.events.some((e) => e.incidentId === J!.id && /같은 사건으로 확인 — 사건 \d+의 신고를 사건 \d+에 합칩니다/.test(e.text))).toBe(true);
          expect(K.phase === 'closed' ? K.closeReason !== 'screened' : true, '원 사건은 닫히지 않는다(합친 쪽만)').toBe(true);
        } else {
          missed++;
          expect(J.problems.some((p) => p.code === 'FALSE_ALARM' && p.recovered && p.recoveryText === '같은 사건의 중복 신고로 한 번 더 출동')).toBe(true);
          expect(J.result!.headline).toContain('중복 신고 — 같은 사건을 옆 교차로로 신고');
        }
        expect(sim.events[J.rootEvent].text).toContain(`같은 사건의 중복 신고 — 사건 ${K.code}의 신고가 옆 교차로로 들어올 예정`);
      }
    } finally { DUP.P = P0; }
    expect(linked, '알아보고 합친 중복 신고').toBeGreaterThanOrEqual(1);
    expect(missed, '못 알아보고 한 번 더 출동한 중복 신고').toBeGreaterThanOrEqual(1);
  }, 120000);
  it('N4: 같은 사건 확인의 답은 신고자 모델이 진실로 정한다 — 같은 사건이면 화법별 확률, 다른 사건이면 "네"가 0.03 · 후보는 같은 평가 유형·이웃 교차로·300초 안의 열린 사건', () => {
    const sim = new Sim('N8-10-SAME');
    sim.run(5);
    const K = createIncident(sim, { type: 'fire', variant: 'std', rng: sim.rng.fork('n8-10-k') });
    const nb = sim.city.edges[sim.city.nodes[K.truth.nodeId].edges[0]];
    const J = createIncident(sim, { type: 'fire', variant: 'dup', nodeId: nb.a === K.truth.nodeId ? nb.b : nb.a, tag: 'daily', dupOf: K.id, rng: sim.rng.fork('n8-10-j') });
    const call = (persona: Persona): Call => ({ id: 0, caller: { persona } } as unknown as Call);
    const ratio = (dupOf: number, persona: Persona): number => {
      const keep = J.dupOf; J.dupOf = dupOf;
      const r = new Rng(1234 + dupOf * 7 + persona.length);
      let yes = 0; const n = 4000;
      for (let i = 0; i < n; i++) if (sameAnswer(sim, J, K, call(persona), r).value === K.id) yes++;
      J.dupOf = keep;
      return yes / n;
    };
    expect(Math.abs(ratio(K.id, 'calm') - SAME_YES.calm)).toBeLessThan(0.03);
    expect(Math.abs(ratio(K.id, 'confused') - SAME_YES.confused)).toBeLessThan(0.03);
    expect(Math.abs(ratio(-1, 'calm') - SAME_SLIP)).toBeLessThan(0.012);
    expect(SAME_SLIP).toBe(0.03);
    // 후보: 관제가 아는 것만 — 평가 유형·알려진 위치·신고 시각
    const as = (type: IncidentType): Assessment => ({ type, typeConf: 0.9, probs: {} as Assessment['probs'], severity: 1.5, confidence: 0.8, needs: {} as Needs, risks: [], summary: '', t: sim.t, revision: 0 });
    K.assessment = as('fire'); K.locationKnown = true; K.reportedNode = K.truth.nodeId; K.reportedAt = sim.t; K.phase = 'dispatched';
    J.assessment = as('fire'); J.locationKnown = true; J.reportedNode = J.truth.nodeId;
    expect(sameCandidate(sim, J)?.id).toBe(K.id);
    K.assessment = as('traffic');
    expect(sameCandidate(sim, J), '평가 유형이 다르면 묻지 않는다').toBeNull();
    K.assessment = as('fire'); K.reportedAt = sim.t - 301;
    expect(sameCandidate(sim, J), '300초가 지났으면 묻지 않는다').toBeNull();
  });
});

// ───────────────────────── 단계 10 — 조건부 연쇄 (§5.6) — 세계 상태 → 일반 법칙 → 초과 위험 · 이야기 연쇄 둘 ─────────────────────────
import { SOAK, SPARK, STRAY, liveWire, sparkTargets } from '../src/sim/world/kindsExpo';
import { WASH } from '../src/sim/world/laws/kinds';
import { AGAIN } from '../src/sim/world/rules/kinds';
import { hazardLaws, hazardRoom } from '../src/sim/world/hazard';
import { canChain, chainLen } from '../src/sim/chain';
import { closeIncident, isDailyLoad } from '../src/sim/incidents';
import { signal, consequences } from '../src/sim/world/consequence';

/** 시험 동안만 상수를 바꾼다 (등록할 때 읽히지 않는 세기만 — 법칙의 식이 매번 읽는다) */
function withK<T extends object>(o: T, patch: Partial<T>, fn: () => void): void {
  const keep = { ...o };
  Object.assign(o, patch);
  try { fn(); } finally { Object.assign(o, keep); }
}
/** 강제한 사건이 생길 때까지 (그 사건을 돌려준다) */
function until(sim: Sim, pick: (I: Inc) => boolean, cap = 600): Inc | undefined {
  for (let k = 0; k < cap && !sim.ended; k++) { sim.step(); const I = sim.incidents.find(pick); if (I) return I; }
  return undefined;
}
const lawKid = (sim: Sim, law: string, parent: number): Inc | undefined => sim.incidents.find((J) => J.hz !== undefined && J.hz.law === law && J.parent === parent);

describe('16 조건부 연쇄 — 상태가 원인을 모르는 법칙을 지나 사건이 된다 (단계 10)', () => {
  it('K1 끊어진 전선: 살아 있는 동안 곁 건물의 heatSpread 칸에 불티(spark)가 쌓이고, 넘으면 그 건물의 불(부모 = 전선 사건) — 같은 시드에서 전선만 죽여 두면 쌓이지도 나지도 않는다(개입 시험)', () => {
    let seen = 0;
    for (let k = 0; k < 24 && seen < 1; k++) {
      const probe = new Sim('W' + k, NORMAL, 1200, { force: 'utility/wire' });
      const W0 = until(probe, forced(probe));
      if (!W0 || !sparkTargets(probe, W0.truth.x, W0.truth.y).length) continue;
      seen++;
      const run = (kill: boolean): { kid: Inc | undefined; H: number; sim: Sim } => {
        let out: { kid: Inc | undefined; H: number; sim: Sim } = { kid: undefined, H: 0, sim: probe };
        withK(SPARK, { K: SPARK.K * 200 }, () => {
          const sim = new Sim('W' + k, NORMAL, 1200, { force: 'utility/wire' });
          const W = until(sim, forced(sim))!;
          if (kill) liveWire(sim.scenes[W.id]!)!.live = false;
          for (let t = 0; t < 400 && !sim.ended; t++) sim.step();
          let H = 0;
          for (const x of sparkTargets(sim, W.truth.x, W.truth.y)) H = Math.max(H, sim.world.hz.cells.heatSpread?.[x.id]?.H ?? 0);
          out = { kid: lawKid(sim, 'heatSpread', W.id), H, sim };
        });
        return out;
      };
      const on = run(false), off = run(true);
      expect(on.kid, `W${k}: 살아 있는 전선 곁의 불`).toBeTruthy();
      expect(on.kid!.truth.type).toBe('fire');
      expect(on.kid!.hz!.src[0].what).toBe('spark');
      expect(on.sim.events[on.kid!.rootEvent].text).toContain('끊어진 전선의 불꽃이 옮겨붙었습니다');
      expect(off.kid, `W${k}: 전선만 죽인 같은 시드`).toBeUndefined();
      expect(off.H).toBe(0);
    }
    expect(seen, '곁에 건물이 있는 전선 현장').toBe(1);
  }, 120000);
  it('K1: 닫힐 때 전선이 살아 있으면 LEFT 초의 불티를 한 번에(닫힌 꼴) 더하고, 고친 전선은 아무것도 더하지 않는다 (손 계산)', () => {
    for (let k = 0; k < 24; k++) {
      const sim = new Sim('W' + k, NORMAL, 1200, { force: 'utility/wire' });
      const W = until(sim, forced(sim));
      if (!W) continue;
      const ts = sparkTargets(sim, W.truth.x, W.truth.y);
      if (!ts.length) continue;
      const cell = (): number => sim.world.hz.cells.heatSpread?.[ts[0].id]?.H ?? 0;
      sim.step(); sim.step(); sim.step(); sim.step(); sim.step();
      const before = cell();
      closeIncident(sim, W, 'timeout');
      sim.step();
      const c = sim.world.hz.cells.heatSpread?.[ts[0].id];
      if (c && !c.done) expect(cell() - before, '닫힌 꼴의 충격 = 1초의 불티 × LEFT').toBeCloseTo(ts[0].dH * SPARK.LEFT, 6);
      // 고친 전선: 같은 시드, 닫기 전에 전선을 죽이면 충격이 없다
      const sim2 = new Sim('W' + k, NORMAL, 1200, { force: 'utility/wire' });
      const W2 = until(sim2, forced(sim2))!;
      for (let i = 0; i < 5; i++) sim2.step();
      liveWire(sim2.scenes[W2.id]!)!.live = false;
      const b2 = sim2.world.hz.cells.heatSpread?.[ts[0].id]?.H ?? 0;
      closeIncident(sim2, W2, 'resolved');
      for (let i = 0; i < 10; i++) sim2.step();
      expect(sim2.world.hz.cells.heatSpread?.[ts[0].id]?.H ?? 0, '고친 전선').toBe(b2);
      return;
    }
    throw new Error('곁에 건물이 있는 전선 현장을 찾지 못했다');
  }, 60000);
  it('K2 수도관 → 싱크홀: 물이 흐르는 동안 이웃 교차로의 스민 물이 1초에 1 씩 쌓이고(멎으면 DRAIN 씩 빠진다) T0 를 넘은 만큼 위험이 쌓여 싱크홀(washout) — 관만 막아 두면 없다', () => {
    let seen = 0;
    for (let k = 0; k < 12 && seen < 1; k++) {
      const run = (kill: boolean): { sim: Sim; M: Inc; v30: number } => {
        let out = null as unknown as { sim: Sim; M: Inc; v30: number };
        withK(WASH, { A: WASH.A * 300, T0: 10 }, () => {      // 흙이 버티는 시간을 줄여 본다 — 그 시드의 관이 그보다 일찍 잠기지 않게
          const sim = new Sim('M' + k, NORMAL, 1200, { force: 'utility/main' });
          const M = until(sim, forced(sim))!;
          const pipe = sim.scenes[M.id]!.props.find((p) => p.kind === 'fixture' && p.skin === 'pipe')!;
          if (kill) pipe.live = false;
          for (let t = 0; t < 150; t++) sim.step();      // 30초
          const nb0 = sim.city.edges[sim.city.nodes[M.truth.nodeId].edges[0]];
          const nb = nb0.a === M.truth.nodeId ? nb0.b : nb0.a;
          const v30 = sim.world.soak[nb]?.v ?? 0;
          for (let t = 0; t < 1500 && !sim.ended; t++) sim.step();
          out = { sim, M, v30 };
        });
        return out;
      };
      const on = run(false);
      if (on.v30 < 25) continue;      // 출동이 빨라 30초 안에 잠갔다 — 다른 시드
      seen++;
      expect(on.v30, '30초에 스민 물 (1초에 1)').toBeGreaterThanOrEqual(28);
      expect(on.v30).toBeLessThanOrEqual(31);
      const kid = lawKid(on.sim, 'washout', on.M.id);
      expect(kid, `M${k}: 물이 오래 흐른 수도관 곁의 싱크홀`).toBeTruthy();
      expect(`${kid!.truth.type}/${kid!.truth.variant}`).toBe('utility/sinkhole');
      expect(on.sim.city.nodes[on.M.truth.nodeId].edges.some((e) => { const ed = on.sim.city.edges[e]; return ed.a === kid!.truth.nodeId || ed.b === kid!.truth.nodeId; }), '이웃 교차로').toBe(true);
      expect(kid!.hz!.src[0].what).toBe('soak');
      const off = run(true);
      expect(lawKid(off.sim, 'washout', off.M.id), `M${k}: 관만 막아 둔 같은 시드`).toBeUndefined();
      expect(Object.keys(off.sim.world.soak).length).toBe(0);
    }
    expect(seen).toBe(1);
    expect(SOAK.DRAIN).toBeGreaterThan(0);
  }, 120000);
  it('K3 · 연쇄 상한: 수도관 → 싱크홀 → 교통사고에서 멈춘다(한 사슬 3) · 한 뿌리의 법칙 사건 2 · 한 교대 6 — 틀(hazardRoom·canChain)이 그대로 막는다', () => {
    const sim = new Sim('N8-10-CAP');
    sim.run(5);
    const M = createIncident(sim, { type: 'utility', variant: 'main', tag: 'daily', rng: sim.rng.fork('n8-10-cap:m') });
    const S = createIncident(sim, { type: 'utility', variant: 'sinkhole', parent: M.id, rng: sim.rng.fork('n8-10-cap:s') });
    const T = createIncident(sim, { type: 'traffic', variant: 'std', parent: S.id, rng: sim.rng.fork('n8-10-cap:t') });
    expect(chainLen(sim, T)).toBe(3);
    expect(canChain(sim, T)).toBe(false);
    const road = hazardLaws().find((l) => l.id === 'roadCrash')!, wash = hazardLaws().find((l) => l.id === 'washout')!;
    expect(hazardRoom(sim, road, T.id), '셋째 사건에서는 잇지 않는다').toBe('depth');
    expect(hazardRoom(sim, wash, S.id)).toBeNull();
    expect(isDailyLoad(sim, S), '짧은 사건이 부모인 자식은 평소 생성기의 몫이 아니다').toBe(true);
    expect(hazardLaws().map((l) => l.id).slice(-3)).toEqual(['washout', 'strayHarm', 'strayRoad']);
    const ids = consequences().map((c) => c.id);
    expect(ids.slice(ids.indexOf('floodLow') + 1), '상태 규칙은 world/rules/kinds.ts 가 infra 의 끝(floodLow) 다음에').toEqual(['wireSpark', 'wireLeft', 'mainSoak', 'hiveLeft', 'looseOut', 'rowdyKnife', 'snatchAgain']);
  });
  it('K5 남은 벌집: 닫힐 때 벌집이 살아 있으면 그 건물의 풀린 위험(hive) → 같은 건물에서 또 쏘인다(strayHarm → 벌집 사건, 부모 = 그 사건) · 떼어 낸 벌집은 아무것도 남기지 않는다', () => {
    const run = (alive: boolean): { sim: Sim; H: Inc } => {
      let out = null as unknown as { sim: Sim; H: Inc };
      withK(STRAY.RR, { hive: 1e6 }, () => {
        const sim = new Sim('N8-10-HIVE');
        sim.run(5);
        const H = createIncident(sim, { type: 'animal', variant: 'hive', tag: 'daily', rng: sim.rng.fork('n8-10-hive') });
        const p = sim.scenes[H.id]!.props.find((q) => q.kind === 'fixture' && q.skin === 'hive')!;
        p.live = alive;
        closeIncident(sim, H, 'timeout');
        for (let t = 0; t < 300; t++) sim.step();
        out = { sim, H };
      });
      return out;
    };
    const on = run(true);
    const L = on.sim.world.loose.find((q) => q.inc === on.H.id);
    expect(L && L.what).toBe('hive');
    expect(L!.place).toBe(on.H.truth.placeId);
    const kid = lawKid(on.sim, 'strayHarm', on.H.id);
    expect(kid, '남은 벌집에서 또 쏘인 사람').toBeTruthy();
    expect(`${kid!.truth.type}/${kid!.truth.variant}`).toBe('animal/hive');
    expect(kid!.truth.placeId).toBe(on.H.truth.placeId);
    expect(kid!.hz!.src[0].what).toBe('hive');
    const off = run(false);
    expect(off.sim.world.loose.length).toBe(0);
    expect(lawKid(off.sim, 'strayHarm', off.H.id)).toBeUndefined();
  }, 60000);
  it('K6 · K7 찻길로 달아난 동물: 신호 loose 로 풀린 동물(stray) → 곁 구간의 사고(strayRoad, 가축) · 곁 주민의 물림(strayHarm, 개) — 시간이 지나면 남은 정도가 줄고, 신호가 없으면 아무것도 없다', () => {
    const run = (variant: 'escape' | 'dogbite', send: boolean): { sim: Sim; A: Inc } => {
      let out = null as unknown as { sim: Sim; A: Inc };
      withK(STRAY.ROAD, { cow: 1, pig: 1 }, () => withK(STRAY.RR, { dog: 1e6 }, () => {
        const sim = new Sim('N8-10-' + variant);
        sim.run(5);
        const A = createIncident(sim, { type: 'animal', variant, tag: 'daily', rng: sim.rng.fork('n8-10-' + variant) });
        const a = sim.scenes[A.id]!.animals![0];
        if (send) { const ev = raiseProblem(sim, A, 'ANIMAL_LOST', `${a.label} 찻길로 달아남`, { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, text: '시험' }, false); signal(sim, 'loose', { inc: A.id, ev, data: a.id }); }
        closeIncident(sim, A, 'resolved');
        for (let t = 0; t < 400; t++) sim.step();
        out = { sim, A };
      }));
      return out;
    };
    const cows = run('escape', true);
    const L = cows.sim.world.loose.find((q) => q.inc === cows.A.id)!;
    expect(L.what).toBe('stray');
    expect(STRAY.TAU[L.kind]).toBeGreaterThan(0);
    const crash = cows.sim.incidents.find((J) => J.hz?.law === 'strayRoad' && J.parent === cows.A.id);
    expect(crash, '찻길로 나간 가축 곁의 사고').toBeTruthy();
    expect(crash!.truth.type).toBe('traffic');
    expect(cows.sim.city.nodes[L.node].edges).toContain(crash!.hz!.target);
    expect(lawKid(run('escape', false).sim, 'strayRoad', cows.A.id), '신호가 없으면 없다').toBeUndefined();
    const dogs = run('dogbite', true);
    const bite = lawKid(dogs.sim, 'strayHarm', dogs.A.id);
    expect(bite, '놓친 개에 물린 사람').toBeTruthy();
    expect(`${bite!.truth.type}/${bite!.truth.variant}`).toBe('animal/dogbite');
    expect(bite!.tag).toBe('daily');
  }, 60000);
  it('K4 · K8 붙잡히지 않은 용의자 (이야기 연쇄): 달아났으면 예약(부모·흐름·tag)하고 근처에 경찰이 있으면 미룬다, 붙잡았으면 예약 0 · 평소 생성기의 흐름과 lastType 을 건드리지 않는다', () => {
    const run = (variant: 'snatch' | 'rowdy', escaped: boolean): { sim: Sim; D: Inc; gen: number; last: unknown } => {
      let out = null as unknown as { sim: Sim; D: Inc; gen: number; last: unknown };
      withK(AGAIN.snatch, { P: 1 }, () => withK(AGAIN.rowdy, { P: 1 }, () => {
        const sim = new Sim('N8-10-' + variant);
        sim.run(5);
        const D = createIncident(sim, { type: 'disturb', variant, tag: 'daily', rng: sim.rng.fork('n8-10-d:' + variant) });
        for (const h of sim.scenes[D.id]!.hostiles) h.state = escaped ? 'escaped' : 'arrested';
        if (escaped) raiseProblem(sim, D, 'SUSPECT_FLED', '시험 도주', { role: 'SYSTEM', actor: '현장', imp: 3, truth: true, text: '시험' }, false);
        const last = sim.gen.lastType;
        closeIncident(sim, D, 'resolved');
        sim.step();
        out = { sim, D, gen: sim.rngGen.next(), last };
      }));
      return out;
    };
    for (const v of ['snatch', 'rowdy'] as const) {
      const yes = run(v, true), no = run(v, false);
      const item = yes.sim.gen.chain.find((c) => c.opts.parent === yes.D.id);
      expect(item, `${v}: 달아난 용의자의 다음 범행 예약`).toBeTruthy();
      expect(item!.opts.csq).toBe(v === 'snatch' ? 'snatchAgain' : 'rowdyKnife');
      expect(item!.opts.rng).toBeTruthy();
      expect(`${item!.opts.type}/${item!.opts.variant}`).toBe(v === 'snatch' ? 'disturb/snatch' : 'armed/dispute');
      if (v === 'snatch') expect(item!.opts.tag).toBe('daily');
      expect(typeof item!.when).toBe('function');
      expect(no.sim.gen.chain.some((c) => c.opts.parent === no.D.id), `${v}: 붙잡았으면 예약 0`).toBe(false);
      expect(yes.gen, `${v}: 평소 생성기의 흐름은 조건과 상관없이 같다`).toBe(no.gen);
      expect(yes.sim.gen.lastType).toBe(yes.last);
    }
  });
});

// ───────────────────────── 단계 7 뒤 절반 (보호 — 위기자 · 문 잠긴 집 · §5.13 민감한 소재) ─────────────────────────
import { LEDGE, LOCKIN } from '../src/sim/field/rules/kinds';
import { LEDGE_ORD, LOCK_ORD } from '../src/sim/field/orders/kinds';
import { LOCK_WAIT } from '../src/sim/field/executor';
import { perchIdx } from '../src/sim/field/perch';
import { ROLES as ROLE_TABLE } from '../src/sim/crews';
import { casDrawn, casInfo } from '../src/view/triage';      // (§5.13 의 화면 — 읽기만)
import { eventWeight } from '../src/view/camera';

/** 강제 교대에서 그 사건이 생길 때까지 돌린다 (현장이 생기면 멈춘다 — 부대가 닿기 전) */
function forcedScene(seed: string, key: string): { sim: Sim; J: Inc; s: Scene } {
  const sim = new Sim(seed, NORMAL, 1200, { force: key });
  for (let k = 0; k < 4000; k++) {
    sim.step();
    const J = sim.incidents.find(forced(sim));
    if (J && sim.scenes[J.id]) return { sim, J, s: sim.scenes[J.id]! };
  }
  throw new Error(`${key} ${seed}: 강제 사건이 생기지 않았다`);
}
const withSwing = <T,>(p: number, f: () => T): T => { const p0 = LEDGE.swing.p; LEDGE.swing.p = p; try { return f(); } finally { LEDGE.swing.p = p0; } };

describe('5·9·11·15 보호 — 위기자 · 문 잠긴 집 (단계 7 뒤 절반)', () => {
  it('5 두 시나리오는 강제 교대(S0·S1)에서 모두 닫히고 한계 시간·방치·무대응이 아니다 · 9 설득·매트·붙잡기·통제·개방의 되풀이 없음 · 15 높은 자리의 위기자에게 단계 2 전에는 붙잡기가, 내려오기 전에는 처치·이송·동행이 작업판에 없다', () => {
    for (const key of WELFARE_7B) for (const seed of ['S0', 'S1']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: key });
      const wb = watchBoard(['persuade', 'mitigate', 'extricate', 'cordon', 'force', 'interview']);
      let J: Inc | undefined, maxStage = 0;
      for (let k = 0; k < 7000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (!J || !s) continue;
        wb.look(sim, s);
        if (key === 'welfare/ledge' && s.kinds) {
          maxStage = Math.max(maxStage, s.kinds.stage ?? 0);
          const up = perchIdx(s, 0) >= 0;
          for (const w of s.board) {
            if (w.cas !== 0 || (w.status !== 'open' && w.status !== 'active')) continue;
            if (w.kind === 'extricate') expect(maxStage, `${seed}: 단계 2 전의 붙잡기`).toBeGreaterThanOrEqual(2);
            if (up) expect(['treat', 'carry', 'escort', 'load', 'hoist'].indexOf(w.kind), `${seed}: 높은 자리의 사람에게 ${w.kind}`).toBe(-1);
          }
        }
        if (J.phase === 'closed') break;
      }
      expect(J && J.phase, `${key} ${seed}`).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse'].indexOf(J!.closeReason), `${key} ${seed}: ${J!.closeReason}`).toBe(-1);
      expect(wb.bad(), `${key} ${seed}: ${wb.bad()}`).toBe('');
      const s = sim.scenes[J!.id]!;
      if (key === 'welfare/ledge') expect(s.kinds!.ledgeEnd, `${seed}: 끝난 길`).toBeTruthy();
      if (key === 'welfare/lockin') expect(s.props[s.kinds!.door!].locked, `${seed}: 문을 열고 닫혔다`).toBe(false);
    }
  });
  it('15 설득의 대상은 구조 대상 · 위기 정도의 오르내림(손 계산 — 출렁임 0): 아무도 없으면 1초에 +0.0012, 안쪽 3칸에 다른 사람이 서면 +0.004 더 · 단계 문턱', () => {
    withSwing(0, () => {
      const { sim, s } = forcedScene('N8-7B-HAND', 'welfare/ledge');
      const k = s.kinds!;
      expect(k.perch!.length).toBe(1);
      const c = s.casualties[k.perch![0].cas];
      expect(c.mob).toBe('trapped'); expect(c.trapWork).toBe(999); expect(s.tiles[Math.round(c.y) * s.w + Math.round(c.x)]).toBe(T.LEDGE);
      expect(s.rules ?? []).not.toContain('perch');      // 헬기는 머물지 않는다
      // 다음 1초 차례까지 돌려 맞춘 뒤 한 차례(5틱)의 변화를 잰다 — 대원이 아직 닿지 않았다
      for (let n = 0; n < 5 && (sim.tick + s.id) % 5 !== 0; n++) sim.step();
      const c0 = k.crisis!;
      for (let n = 0; n < 5; n++) sim.step();
      if (!s.agents.length) expect(k.crisis!).toBeCloseTo(Math.min(1, c0 + LEDGE.rise), 9);
      expect(LEDGE.rise).toBe(0.0012); expect(LEDGE.crowd).toBe(0.004); expect(LEDGE.crowdR).toBe(3); expect(LEDGE.talkK).toBe(0.0045);
      expect([LEDGE.stage1, LEDGE.stage2, LEDGE.stage3]).toEqual([20, 0.25, 0.12]);
      expect(LEDGE.stage2off).toBeGreaterThan(LEDGE.stage2);      // 문턱에는 간격 (단계 2 ↔ 1 이 왕복하지 않게)
      expect(LEDGE_ORD.persuade).toBeGreaterThan(LEDGE_ORD.grab);
    });
    // 설득(persuade)은 구조 대상에게만 — 협상(negotiate)은 용의자에게만 (작업판의 대상 칸)
    const sim = new Sim('S0', NORMAL, 1200, { force: 'welfare/ledge' });
    for (let k = 0; k < 7000 && !sim.ended; k++) {
      sim.step();
      const J = sim.incidents.find(forced(sim));
      const s = J ? sim.scenes[J.id] : undefined;
      if (!J || !s) continue;
      for (const w of s.board) { if (w.kind === 'persuade') { expect(w.cas).toBeGreaterThanOrEqual(0); expect(w.hostile).toBe(-1); } if (w.kind === 'negotiate') expect(w.hostile).toBeGreaterThanOrEqual(0); }
      if (J.phase === 'closed') break;
    }
  });
  it('11 위기자의 실패(위기 정도 1 — 대원이 닿기 전): 효과 기록 없이(s.fx 그대로) "구조하지 못했습니다." 한 줄(command · imp 1) · quietLoss · 다리에서 물속 사람이 생기지 않는다 · 사건은 닫힌다(한계 시간 아님) · 보고서 문장도 한 줄', () => {
    let bridge = 0, roof = 0;
    for (const seed of ['N8-7B-F0', 'N8-7B-F1', 'N8-7B-F2', 'N8-7B-F3', 'N8-7B-F4', 'N8-7B-F5']) {
      const { sim, J, s } = forcedScene(seed, 'welfare/ledge');
      const k = s.kinds!, c = s.casualties[k.perch![0].cas];
      if (k.mat! >= 0) roof++; else bridge++;
      k.crisis = 0.9999;
      let fx0 = s.fx.length, ev0 = sim.events.length, failAt = -1;
      for (let n = 0; n < 30 && !c.dead; n++) { fx0 = s.fx.length; ev0 = sim.events.length; sim.step(); if (c.dead) failAt = n; }
      expect(c.dead, seed).toBe(true); expect(failAt).toBeGreaterThanOrEqual(0);
      expect(s.agents.length, `${seed}: 대원이 닿기 전`).toBe(0);
      expect(s.fx.length, `${seed}: 실패 틱에 효과 기록이 없다`).toBe(fx0);
      const mine = sim.events.slice(ev0).filter((e) => e.incidentId === J.id);
      expect(mine.map((e) => e.text), seed).toEqual(['구조하지 못했습니다.']);
      expect(mine[0].kind).toBe('command'); expect(mine[0].importance).toBe(1);
      expect(mine.some((e) => e.kind === 'casualty'), '카메라·소리가 따라가는 종류가 아니다').toBe(false);
      expect(eventWeight(mine[0]), '카메라의 무게: 중요도 1 의 5 뿐 — casualty·문제 가중이 붙지 않는다').toBe(5);
      expect(mine[0].importance < 3, '자동 감속(중요도 3 이상)·손실음(casualty 3 이상)이 걸리지 않는다').toBe(true);
      expect(c.quietLoss).toBe(true); expect(c.lost).toBeUndefined(); expect(c.inWater).toBeFalsy(); expect(c.deathCause).toBe('fall');
      expect(perchIdx(s, c.id)).toBe(-1); expect(k.ledgeEnd).toBe('lost');
      expect(casDrawn(c), '그리지 않는다').toBe(false);
      const info = casInfo(sim, s, c, true, undefined);
      expect(info.rows.find((r) => r.k === '위치')!.v, '정보창의 위치는 —').toBe('—');
      expect(info.rows.some((r) => r.k === '숨진 원인') || info.times.some((r) => r.k === '사망'), '원인·시각을 적지 않는다').toBe(false);
      for (const q of s.casualties) expect(q.inWater, `${seed}: 물로 떨어지는 갈래는 없다`).toBeFalsy();
      for (let n = 0; n < 9000 && J.phase !== 'closed' && !sim.ended; n++) sim.step();
      expect(J.phase, seed).toBe('closed');
      expect(['timeout', 'abandoned'].indexOf(J.closeReason), `${seed}: ${J.closeReason}`).toBe(-1);
      expect(J.result!.analysis.filter((t) => t.includes('숨졌')), `${seed}: 보고서는 원인·시간을 적지 않는다`).toEqual([]);
      expect(J.result!.analysis).toContain('구조하지 못했습니다.');
      expect(J.result!.headline.startsWith('구조하지 못했습니다'), J.result!.headline).toBe(true);
    }
    expect(bridge + roof).toBe(6);
  });
  it('11 매트가 펴진 옥상에서 위기 정도가 1 에 닿으면 매트가 받아 낸다(매트 칸에 띠 1 — 숨지지 않는다, 그림·효과 기록 없음) · 판정은 부분 성공의 벌점', () => {
    let tried = 0;
    for (let n = 0; n < 12 && tried < 2; n++) {
      const { sim, J, s } = forcedScene('N8-7B-M' + n, 'welfare/ledge');
      const k = s.kinds!;
      if (k.mat! < 0) continue;
      tried++;
      s.props[k.mat!].live = false;      // 매트가 펴져 있다
      const c = s.casualties[k.perch![0].cas];
      k.crisis = 0.9999;
      let fx0 = s.fx.length;
      for (let q = 0; q < 30 && k.ledgeEnd === undefined; q++) { fx0 = s.fx.length; sim.step(); }
      expect(k.ledgeEnd).toBe('mat');
      expect(s.fx.length).toBe(fx0);
      expect(c.dead).toBe(false); expect(c.quietLoss).toBeUndefined();
      expect(Math.round(c.y) * s.w + Math.round(c.x)).toBe(k.drop);
      expect(c.health).toBe(LEDGE.matHp); expect(c.mob).toBe('immobile');
      expect(sim.events.some((e) => e.incidentId === J.id && e.text === '안전 매트가 받아 냈습니다. 처치가 필요합니다.')).toBe(true);
    }
    expect(tried).toBe(2);
  });
  it('9·20 안전 매트는 구조 부대의 유압 대원이 든다 · 매트 터의 일은 매트를 든 대원만(fitFor) · 맡을 사람이 없으면 구조를 부른다 · 이름표 \'위기자\'의 구조 수요에 매트 가점', () => {
    expect(ROLE_TABLE.extricator.kit[ROLE_TABLE.extricator.kit.length - 1]).toBe('jumpMat');      // 장비 끝에 (고장 추첨 순서가 그대로)
    expect(LABEL_BONUS.some((r) => r.label === '위기자' && r.key === 'rescue' && r.kit === 'jumpMat')).toBe(true);
    const sim = new Sim('S1', NORMAL, 1200, { force: 'welfare/ledge' });
    let saw = 0;
    for (let k = 0; k < 7000 && !sim.ended; k++) {
      sim.step();
      const J = sim.incidents.find(forced(sim));
      const s = J ? sim.scenes[J.id] : undefined;
      if (!J || !s) continue;
      for (const w of s.board) if (w.kind === 'mitigate' && s.props[w.prop] && s.props[w.prop].skin === 'matSite') for (const a of s.agents) {
        if (a.status !== 'active') continue;
        const f = fitFor(sim, s, a, w);
        if (f > 0) { expect(hasKit(sim, a.rid, 'jumpMat')).toBe(true); saw++; } else if (hasKit(sim, a.rid, 'jumpMat') && sim.responders[a.rid].status === 'ok') expect(f, '매트를 든 다치지 않은 대원은 맡는다').toBeGreaterThan(0);
      }
      if (J.phase === 'closed') break;
    }
    void saw;
  });
  it('15 문 잠긴 집: 생성기 200번 — 현관문은 잠겨 있고(방범문 30% 안팎), 바깥으로 난 창이 늘 있으며, 안의 사람은 거동 불가 · 체력 35~70(숨진 채 발견되는 갈래가 없다) 또는 빈집', () => {
    const sim = new Sim('N8-7B-GEN', NORMAL, 1200, { force: null });
    let empty = 0, armored = 0;
    for (let k = 0; k < 200; k++) {
      const I = createIncident(sim, { type: 'welfare', variant: 'lockin', rng: sim.rng.fork('n8-7b-gen' + k) });
      const s = sim.scenes[I.id]!, kd = s.kinds!;
      const door = s.props[kd.door!];
      expect(door.kind).toBe('door'); expect(door.locked).toBe(true); expect(s.propAt[door.y * s.w + door.x]).toBe(door.id);
      expect(kd.win!, '창').toBeGreaterThanOrEqual(0); expect(s.tiles[kd.win!]).toBe(T.WINDOW);
      expect(kd.key! - I.createdAt).toBeGreaterThanOrEqual(60); expect(kd.key! - I.createdAt).toBeLessThanOrEqual(150);
      if (kd.armored) armored++;
      if (!s.casualties.length) empty++;
      for (const c of s.casualties) { expect(c.dead).toBe(false); expect(c.health).toBeGreaterThanOrEqual(35); expect(c.health).toBeLessThanOrEqual(70); expect(c.mob).toBe('immobile'); }
      if (kd.sound === 'moan') expect(s.casualties.length && s.casualties[0].health > 45).toBeTruthy();
      expect(s.regions.some((r) => r.kind === 'zone' && r.searchable), '구역 확률 수색 현장이 아니다(방 수색)').toBe(false);
      I.phase = 'closed';
    }
    expect(empty).toBeGreaterThan(30); expect(empty).toBeLessThan(90);
    expect(armored).toBeGreaterThan(30); expect(armored).toBeLessThan(90);
    expect(LOCK_WAIT).toBe(LOCK_ORD.keyWait);      // 실행부의 기다림 막대와 지휘 규칙의 기다림이 같은 값
    expect(LOCK_ORD.keyWait).toBeLessThan(60);      // 교착 감지(60초) 아래
    expect(LOCKIN.hearT).toBe(5);
  });
  it('15 문 잠긴 집의 판정: 들어가지 못한 채 닫히면 위험이 남은 것(목표 미완 — 한계 시간이면 미해결) · 문을 열었으면 그 줄은 없다 · 빈집은 방 수색 뒤 성공', () => {
    const sim = new Sim('N8-7B-VERDICT');
    sim.run(20);
    const I = createIncident(sim, { type: 'welfare', variant: 'lockin', rng: sim.rng.fork('n8-7b-v') });
    const s = sim.scenes[I.id]!;
    s.casualties.length = 0;      // 빈집
    I.reportedAt = sim.t; I.firstDispatchAt = sim.t; I.firstArrivalAt = sim.t;
    expect(evaluate(sim, I, 'timeout').grade).toBe('unresolved');
    expect(evaluate(sim, I, 'resolved').grade).not.toBe('success');
    const door = s.props[s.kinds!.door!];
    door.locked = false; door.open = true;
    expect(evaluate(sim, I, 'resolved').grade).toBe('success');
    // 강제 교대: 빈집이면 방 수색 뒤 성공으로 닫힌다 (S0~S7 가운데 빈집인 교대)
    let emptyRuns = 0;
    for (let n = 0; n < 8 && emptyRuns < 1; n++) {
      const sm = new Sim('S' + n, NORMAL, 1200, { force: 'welfare/lockin' });
      let J: Inc | undefined;
      for (let k = 0; k < 7000 && !sm.ended; k++) { sm.step(); J = sm.incidents.find(forced(sm)); if (J && J.phase === 'closed') break; }
      const sc = sm.scenes[J!.id]!;
      if (sc.casualties.length) continue;
      emptyRuns++;
      expect(J!.closeReason).toBe('resolved');
      expect(['success', 'delayed']).toContain(J!.result!.outcome);
      expect(J!.result!.headline.startsWith('집에 아무도 없음')).toBe(true);
      expect(sc.regions.filter((r) => r.indoor && r.searchable).every((r) => sm.events.some((e) => e.incidentId === J!.id && e.text.includes(r.name))), '방을 살폈다').toBe(true);
    }
    expect(emptyRuns).toBe(1);
  });
  it('11 보호 유형의 구조 대상은 quietLoss 말고는 숨지지 않는다 — 문 잠긴 집 강제 S0~S5: 체력 최솟값 ≥ 20, 사망 0', () => {
    for (let n = 0; n < 6; n++) {
      const sim = new Sim('S' + n, NORMAL, 1200, { force: 'welfare/lockin' });
      let J: Inc | undefined, minHp = 100;
      for (let k = 0; k < 7000 && !sim.ended; k++) {
        sim.step();
        J = sim.incidents.find(forced(sim));
        const s = J ? sim.scenes[J.id] : undefined;
        if (s) for (const c of s.casualties) { expect(c.dead, `S${n}`).toBe(false); minHp = Math.min(minHp, c.health); }
        if (J && J.phase === 'closed') break;
      }
      expect(minHp, `S${n}`).toBeGreaterThanOrEqual(20);
    }
  });
});

// ───────────────────────── 시험 12 — 화면 (단계 11 — 결정 13: 유형 기호만) ─────────────────────────
/** sRGB '#rrggbb' → CIE L*a*b* (D65) */
function hexLab(hex: string): [number, number, number] {
  const ch = (k: number): number => { const v = parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [ch(0), ch(1), ch(2)];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** CIEDE2000 색차 (Sharma 2005 의 식 그대로) */
function de2000(p: [number, number, number], q: [number, number, number]): number {
  const [L1, a1, b1] = p, [L2, a2, b2] = q, rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number): number => { if (a === 0 && b === 0) return 0; const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v; };
  const h1p = hue(b1, a1p), h2p = hue(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lm = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) <= 180) hm /= 2; else hm = h1p + h2p < 360 ? (hm + 360) / 2 : (hm - 360) / 2; }
  const Tt = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
  const dTh = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2), Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * Tt;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

describe('12 화면 — 유형 기호만 (결정 13 · §5.12 · 단계 11)', () => {
  const OLD = TYPE_ORDER.slice(0, 8), NEW = TYPE_ORDER.slice(8, 13);
  it('유형 열셋: TYPE_COLOR·ICON_PATH 에 모두 있고(새 기호는 서로·옛 기호와 다르다) 범례가 TYPE_ORDER 를 그대로 돌며 유형마다 핀 견본을 그린다', async () => {
    const { ICON_PATH } = await import('../src/view/icons');
    expect(TYPE_ORDER.length).toBe(13);
    expect(NEW).toEqual(['utility', 'animal', 'disturb', 'welfare', 'rescue']);
    for (const t of TYPE_ORDER) {
      expect(TYPE_COLOR[t], t).toMatch(/^#[0-9a-f]{6}$/);
      expect(typeof ICON_PATH[t], t).toBe('string');
      expect(ICON_PATH[t] === ICON_PATH.unknown, `${t} 의 기호가 확인 중 기호와 같다`).toBe(false);
    }
    for (const t of NEW) for (const u of TYPE_ORDER) if (u !== t) expect(ICON_PATH[t] === ICON_PATH[u], `${t} = ${u}`).toBe(false);
    const legend = readFileSync(new URL('../src/ui/MapLegend.tsx', import.meta.url), 'utf8');
    expect(legend).toMatch(/TYPE_ORDER\.map\(\(t\) => <span key=\{t\} className="lg-item"><TypePinSample type=\{t\} \/>\{TYPE_DEFS\[t\]\.name\}<\/span>\)/);
    expect(legend).toMatch(/<path d=\{ICON_PATH\[type\]\} fill=\{col\}/);
    expect(legend).toMatch(/col = TYPE_COLOR\[type\]/);
  });
  it('새 색과 다른 모든 색(기존 여덟 + 확인 중 + 다른 새 색) 사이 CIEDE2000 ≥ 15 (기존 여덟끼리는 보지 않는다)', () => {
    // 식의 손 계산 — Sharma(2005) 시험표의 두 쌍
    expect(de2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
    expect(de2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 3);
    const others: (IncidentType | 'unknown')[] = [...OLD, 'unknown'];
    for (const t of NEW) {
      for (const u of [...others, ...NEW.filter((v) => v !== t)]) {
        const d = de2000(hexLab(TYPE_COLOR[t]), hexLab(TYPE_COLOR[u]));
        expect(d, `${t}(${TYPE_COLOR[t]}) ↔ ${u}(${TYPE_COLOR[u]}) = ${d.toFixed(1)}`).toBeGreaterThanOrEqual(15);
      }
    }
  });
  it('카드 제목: 기존 시나리오는 관제의 이름표 그대로, card: false 인 N8 시나리오는 유형 이름 · 이름표가 없으면 유형 이름', async () => {
    const { cardTitle } = await import('../src/ui/panels');
    const { NO_CARD } = await import('../src/sim/scenarios');
    const as = (type: IncidentType, label?: string): Parameters<typeof cardTitle>[0] => ({ type, label } as Parameters<typeof cardTitle>[0]);
    let olds = 0, news = 0;
    for (const q of SCENARIOS) {
      const label = q.label ?? q.name;
      if (q.card === false) { news++; expect(NO_CARD.has(label), label).toBe(true); expect(cardTitle(as(q.type, label)), label).toBe(TYPE_NAME[q.type]); }
      else if (!NO_CARD.has(label)) { olds++; expect(cardTitle(as(q.type, label)), label).toBe(label); }
    }
    expect(olds, '기존 시나리오').toBeGreaterThan(20);
    expect(news, 'N8 시나리오 줄(짧은 사건·평소 추첨 — 비응급 줄 포함)').toBeGreaterThanOrEqual(24);
    for (const q of SCENARIOS) if (q.tag === 'daily' || q.tag === 'kinds') expect(q.card, `${q.type}/${q.variant}`).toBe(false);
    expect(cardTitle(as('utility'))).toBe('시설 사고');
    expect(cardTitle(as('fire'))).toBe(TYPE_NAME.fire);
  });
  it('시나리오별 핀 기호는 붕괴 넷 그대로다 (hazardState.VARIANT_ICON — 새 시나리오에 기호를 더하지 않는다)', () => {
    const hs = readFileSync(new URL('../src/view/hazardState.ts', import.meta.url), 'utf8');
    expect(hs).toMatch(/const VARIANT_ICON = new Set\(\['elevator', 'crane', 'landslide', 'gasblast'\]\);/);
    expect(hs).toMatch(/if \(shown === 'collapse'\) \{ const v = shownVariant\(I, truth\); if \(v && VARIANT_ICON\.has\(v\)\) return v; \}/);
  });
});
