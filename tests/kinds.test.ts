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
  it('등록 자리 넷은 아직 비어 있다 (단계 2a — 첫 줄은 4a~9 가 넣는다)', () => {
    new Sim('N8-2A-REG');      // 현장 등록(field/scenes/index.ts)을 불러 둔다
    expect([PENDING_RULES.length, CAS_HOLDS.length, PROP_HOLDS.length, VERDICT_RULES.length]).toEqual([0, 0, 0, 0]);
  });
  it('판정 등록이 판정에 들어간다: open → 위험이 남음(벌점 1.5·목표 미완) · bad → 벌점 · delayed → 대응 지연. 줄이 없으면 그대로', () => {
    const sim = new Sim('N8-2A-VERDICT');
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
    expect(VERDICT_RULES.length).toBe(0);
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
import { addProp } from '../src/sim/field/kit';
import { registerPending } from '../src/sim/field/sceneRegistry';
import { tickScene, unitArrived } from '../src/sim/field/sceneManager';
import { createAidUnit, dispatchUnit, rosterKeys } from '../src/sim/resources';
import type { Assessment, FieldAgent, Incident, Needs, RoleId, Unit, UnitKind, WorkItem, WorkKind } from '../src/sim/types';
import { FIELD_COLOR } from '../src/view/city/tokens';
import { ROLE_MARK, UNIT_MARK } from '../src/view/marks';
import { responderLook } from '../src/view/scene/sprites';

const NEW_KINDS: UnitKind[] = ['powerCrew', 'gasCrew', 'waterCrew', 'tow', 'animalCtl', 'detective', 'trafficPol', 'k9'];
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
    expect(PENDING_RULES.length).toBe(0);
  });
});

describe('20 새 부대 — 편성되지 않는 여덟 줄 · 표 · 관제의 틀 (단계 2b)', () => {
  it('어느 부대 규모에서도 편성되지 않는다(minLevel 6). 명부의 열쇠·이름은 끝에 붙어 앞 사람이 그대로다. 이름은 모두 다르다(지원 12회 뒤에도)', () => {
    for (const lv of [1, 3, 5]) {
      const sim = new Sim('N8-2B-ROSTER', { ...NORMAL, resources: lv });
      for (const u of sim.units) expect(NEW_KINDS.indexOf(u.kind), `규모 ${lv} ${u.callsign}`).toBe(-1);
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
    for (const role of ['extricator', 'ladderOp', 'officer'] as RoleId[]) expect(capableOf(sim5, of(sim5, role), 'mitigate', 'matSite'), role).toBe(false);      // 안전 매트는 단계 7 이 구조대원에게 붙인다
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
    expect(LABEL_BONUS.filter((r) => N8_LABELS.indexOf(r.label) >= 0).length).toBe(0);
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
    expect(daily.map((q) => `${q.type}/${q.variant}`).sort()).toEqual([...N12].sort());
  });
  it('N8 의 새 난수 흐름 이름이 기존 흐름 이름과 겹치지 않는다 (소스의 fork 글자 — 한 이름은 한 자리에서만 만든다, 아직 쓰지 않은 이름은 아무도 쓰지 않는다)', () => {
    const MADE = ['daily', 'verify'];      // 단계 3 이 만든 흐름 (짧은 사건 · 확인 질문의 답 — 통화 흐름의 하위)
    const LATER = ['wire:', 'main:', 'hole:', 'sign:', 'hive:', 'animal:', 'rowdy:', 'brawl:', 'snatch:', 'scam:', 'ledge:', 'perch:', 'pit:', 'ride:', 'overdose:', 'birth:', 'heat:', 'dup:', 'kit-n8', 'kinds-next:'];
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

describe('7 짧은 사건과 평소 추첨 (단계 3)', () => {
  // 시작점(단계 3 앞 — I2 를 합친 주 브랜치 2733937)에서 잰 보통 S0~S3 · 어려움 S0 의 report.hash. 단계 4a 의 작업자가 이 시험(7a)을 지운다
  const HASH0: [string, typeof NORMAL, string][] = [['S0', NORMAL, '8b4a8647'], ['S1', NORMAL, '1d2f0f30'], ['S2', NORMAL, '1b8feeb5'], ['S3', NORMAL, '71d31558'], ['S0', PRESETS.hard.d, 'c27bc849']];
  it('7a 짧은 사건 손잡이 0 (SimOpts.daily = 0) 이면 시작점의 기록 해시와 같다 — 확인 질문·가려내기·짧은 사건이 모두 꺼진다', () => {
    for (const [seed, d, h] of HASH0) {
      const s = shiftOf(seed, d, 0);
      expect(s.report!.hash, `${seed} ${d === NORMAL ? '보통' : '어려움'}`).toBe(h);
      expect(s.incidents.some((I) => I.tag === 'daily' || I.closeReason === 'screened')).toBe(false);
      expect(s.calls.some((c) => c.asked.indexOf('verify') >= 0)).toBe(false);
    }
  });
  it('7b 켜도 S0~S5 에서 평소 추첨 사건(태그 daily 가 아니고 부모가 없는) 처음 여섯 건의 (생성 시각·유형·변형·규모)가 끈 교대와 같다', () => {
    const first6 = (sim: Sim): string[] => {
      for (let k = 0; k < 12000 && !sim.ended; k++) {
        sim.step();
        const reg = sim.incidents.filter((I) => I.tag !== 'daily' && I.parent === undefined);
        if (reg.length >= 6) return reg.slice(0, 6).map((I) => `${I.createdAt.toFixed(1)} ${I.truth.type}/${I.truth.variant}/${I.truth.severity}`);
      }
      return [];
    };
    let withDaily = 0;
    for (let k = 0; k < 6; k++) {
      // 난이도의 차례 수 그대로(보통 5 — 단계 3 에는 그 가운데 10% 쯤이 비응급 줄에 걸린다). 짧은 사건이 여럿 끼면(차례를 늘린 교대) 그 사건에 묶인 부대 때문에
      // 평소 사건이 다른 부대를 받아 닫히는 시각이 달라지고 생성 간격의 가용 배율(×1.2)이 갈릴 수 있다 — 구현 메모 단계 3 "알려진 것"
      const on = new Sim('S' + k), off = new Sim('S' + k, NORMAL, 1200, { daily: 0 });
      const a = first6(on), b = first6(off);
      expect(a.length, `S${k}`).toBe(6);
      expect(a, `S${k}`).toEqual(b);
      if (on.incidents.some((I) => I.tag === 'daily')) withDaily++;
    }
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
