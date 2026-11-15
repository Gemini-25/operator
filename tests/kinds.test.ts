// N8 사건 종류 다양화 — docs/specs/N8-incident-kinds.md §9.1 (번호는 설계서 §8 의 단계 표와 같다).
// 시간 예산 90초: 평소 교대 몇 번에 나온다에 기대지 않고, 교대를 끝까지 돌리는 시험은 몇 개만 둔다.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NORMAL, PRESETS } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { evaluate } from '../src/sim/debrief';
import { createIncident } from '../src/sim/incidents';
import { CAS_HOLDS, PENDING_RULES, PROP_HOLDS, VERDICT_RULES, registerVerdict } from '../src/sim/field/sceneRegistry';
import { isIndoor, los, staticPass } from '../src/sim/field/grid';
import { T } from '../src/sim/types';
import type { Scene } from '../src/sim/types';
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

// 시험 2 — 틀은 결과를 바꾸지 않는다. 단계 1·2a·2b 동안만 둔다 (단계 3 의 작업자가 지운다 — 짧은 사건을 켜면 해시가 바뀐다).
// HASH0 = 단계 1 을 시작할 때(313ec41) 잰 기록 해시 (report.hash). 더 넓은 확인은 scratchpad 의 해시 목록(153교대)으로 했다 — 설계서 끝 구현 메모
const HASH0: [string, 'normal' | 'hard', string][] = [
  ['S0', 'normal', '68e8a214'], ['S1', 'normal', '298fd990'], ['S2', 'normal', 'dc862ed7'], ['S3', 'normal', 'e8024017'], ['S0', 'hard', '9f8d61cb'],
];
describe('2 틀은 결과를 바꾸지 않는다 (단계 1·2a·2b)', () => {
  it('보통 S0~S3·어려움 S0 의 기록 해시가 단계 1 을 시작할 때와 같다', () => {
    for (const [seed, d, hash] of HASH0) {
      const sim = new Sim(seed, d === 'hard' ? PRESETS.hard.d : NORMAL);
      sim.runToEnd();
      expect(sim.report!.hash, `${d} ${seed}`).toBe(hash);
    }
  }, 90000);
});

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
