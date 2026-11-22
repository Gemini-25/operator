// 사건 종류 다양화의 신고자 모델 (docs/specs/N8-incident-kinds.md §5.2-5·§5.5·§6) — 세계 쪽이라 진실을 읽는다.
// 접수 AI·분석·관제(dispatch/screening.ts·analyst.ts·dispatcher.ts)는 이 파일을 부르지 않는다: 신고자가 무엇을 아는가(진술)와 질문에 무엇이라 답하는가를 여기서 정하고,
// 접수 AI 는 그 진술만 듣는다. callSystem.ts 도 신고자 모델이지만 접수 AI 와 한 파일에 섞여 있어, 새 진실 읽기는 이 파일로만 늘린다.
//
// 단계 3: 짧은 사건 손잡이(kindsOn) · 오인 신고의 진술(falseClaims) · 확인 질문 verify 의 답(verifyAnswer).
// 뒤 단계(4a~10)가 새 유형의 진술 KIND_CALLER · 중복 신고의 답 sameAnswer · 민원의 고함 진술을 더한다.
import { nodeName } from './city';
import type { Sim } from './engine';
import type { Rng } from './rng';
import type { Call, Claim, Incident, IncidentType, Scene, Topic } from './types';
import { josa } from './util';

/** 짧은 사건 손잡이(tune.dailyCount)가 켜져 있는가 — 0 이면 짧은 사건과 비응급의 접수 쪽 변화(확인 질문·가려내기)가 모두 꺼진다 (§5.5 · 시험 7a) */
export function kindsOn(sim: Sim): boolean { return sim.tune.dailyCount > 0; }

/** callSystem.makeCaller 의 진술 넣기 (그 함수 안의 put 과 같은 꼴) */
export type PutClaim = (topic: Topic, value: unknown, text: string, truthful: boolean, note?: string, conf?: number) => void;

/**
 * (N2 오인 신고 — 화재 밖) 신고자는 본 것을 오인한 그대로 믿는다: 사람이 물에 떠 있다 · 총소리 같은 것을 들었다 · 가스 냄새가 난다.
 * 진술의 사실 여부(truthful)는 진실과 견준다 — 판정의 CALL_MISINFO 가 그 비고를 쓴다. 응급(잠든 사람)은 makeCaller 의 응급 갈래가 그대로 한다
 */
export function falseClaims(sim: Sim, I: Incident, s: Scene, rng: Rng, kn: number, put: PutClaim): void {
  void sim; void s;
  const t = I.truth.type;
  if (t === 'water') {
    put('count', 1, '한 명이 물에 떠 있어요.', false, '물에 뜬 물건을 사람으로 오인');
    if (rng.chance(kn)) put('trapped', true, '아직 물에 떠 있어요. 움직이지 않아요!', false, '물에 뜬 물건을 사람으로 오인');
    if (rng.chance(kn * 0.5)) put('hazard', 'current', '물살이 세요. 계속 떠내려가고 있어요.', true);
  } else if (t === 'armed') {
    if (rng.chance(Math.max(kn, 0.6))) put('weapon', 'none', '총을 든 사람은 못 봤어요. 소리만 들었어요.', true);
    if (rng.chance(kn)) put('injured', false, '다친 사람은 못 봤어요.', true);
  } else if (t === 'hazmat') {
    if (rng.chance(Math.max(kn, 0.5))) put('hazard', 'gas', '가스 냄새가 계속 나요. 점점 심해지는 것 같아요.', false, '음식물 냄새를 가스로 오인');
    if (rng.chance(kn)) put('injured', false, '쓰러진 사람은 없어요.', true);
  }
}

/**
 * (N1) 확인 질문 verify("지금 계신 곳에서 보이는 간판이나 건물 이름을 말씀해 주시겠어요?")의 답 — 신고자 모델이 진실로 정한다.
 * 장난 신고자: 40% 얼버무림(evasive) · 30% 끊음(hangup) · 30% 그럴듯한 이름(named — 거짓). 진짜 신고자: 본 대로(named — 낌새 진술이 진짜 신고자에게는 생기지 않으므로 묻는 일이 없다)
 */
export function verifyAnswer(sim: Sim, I: Incident, call: Call, rng: Rng): Claim {
  const pl = I.truth.placeId >= 0 ? sim.city.places[I.truth.placeId] : null;
  const where = pl ? pl.name : `${nodeName(sim.city, I.truth.nodeId)} 교차로`;
  const base = { topic: 'verify' as Topic, conf: 0.7, callId: call.id };
  if (call.caller.persona !== 'prank') return { ...base, value: 'named', text: `${josa(where, '이에요/예요')}. 지금 앞에 있어요.`, truthful: true, note: '' };
  const r = rng.next();
  if (r < 0.4) return { ...base, value: 'evasive', text: '어… 간판은 잘 모르겠고요. 아무튼 빨리 와요.', truthful: false, note: '장난 전화' };
  if (r < 0.7) return { ...base, value: 'hangup', text: '(웃음소리) …… (뚝)', truthful: false, note: '장난 전화' };
  return { ...base, value: 'named', text: `${josa(where, '이에요/예요')}. 빨리 오세요.`, truthful: false, note: '장난 전화' };
}

/**
 * (§5.2-5) 새 유형의 신고자 갈래 — makeCaller 의 일반 갈래가 부른다(진실을 읽는 신고자 모델).
 * truth: 갇힘·부상의 진실(공통 셈 — trapped 인 사람·체력 — 대신. 차 안에 머무는 사람은 갇힌 사람이다). more: 위험·상세 진술 (일반 갈래 끝)
 */
export interface CallerHook {
  truth?: (s: Scene) => { trapped: boolean; injured: boolean };
  more?: (sim: Sim, I: Incident, s: Scene, rng: Rng, kn: number, acc: number, put: PutClaim) => void;
}
export const KIND_CALLER: Partial<Record<IncidentType, CallerHook>> = {
  // (4a) 시설 사고: 차 안에 머무는 사람은 "못 나오고 있다" · 다친 사람은 체력으로. 위험 진술은 전선이면 불꽃(반대로 말할 수 있다 — 지휘관은 이 말을 믿지 않는다)
  utility: {
    truth: (s) => {
      let trapped = false, injured = false;
      for (const c of s.casualties) { if (c.dead) continue; if (c.inVehicle !== null || c.mob === 'trapped') trapped = true; if (c.health < 85) injured = true; }
      return { trapped, injured };
    },
    more: (sim, I, s, rng, kn, acc, put) => {
      void sim;
      if (I.truth.variant === 'wire' && rng.chance(kn * 0.8)) {
        const ok = rng.chance(acc);
        put('hazard', ok ? 'live' : 'dead', ok ? '전선에서 불꽃이 계속 튀어요. 가까이 못 가겠어요.' : '전기가 안 통하는 줄 같아요. 불꽃은 안 보여요.', ok, ok ? '' : '살아 있는 전선을 죽은 줄로 신고');
      }
    },
  },
};
