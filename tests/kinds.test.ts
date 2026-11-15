// N8 사건 종류 다양화 — docs/specs/N8-incident-kinds.md §9.1 (번호는 설계서 §8 의 단계 표와 같다).
// 시간 예산 90초: 평소 교대 몇 번에 나온다에 기대지 않고, 교대를 끝까지 돌리는 시험은 몇 개만 둔다.
import { describe, expect, it } from 'vitest';
import { NORMAL, PRESETS } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
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
