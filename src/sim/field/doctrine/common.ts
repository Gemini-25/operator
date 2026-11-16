// 대응 교본 — 공통 표 (docs/specs/R3-doctrine.md §3.5 · 등록 칸은 §3.6 표 그대로, 이 파일 안의 등록 순서도 그 표의 순서). 모든 분야 — G01~G04·G08 (1·3단계)
// 줄은 DocCtx 만 읽는다 (믿음·자기 몸·자기 장비 — tests/doctrine.test.ts 시험 1). 이 파일은 ./registry 와 타입·util 만 import 한다.
// 새 줄은 이 파일의 끝에 registerDoctrine({ id, dept, who, hook, works/gate/methods, kits/noKits, when, effect, rank, why, note, report }) 로 붙인다 (등록 순서가 결과를 바꾼다).
//
// 단계 1 (공통): G01(특수 표 대원의 중상) · G02(동요 — 진입·위험 실내) · G02b(동요 — 위험한 방법의 조심성) · G03(지친 대원의 위험 실내 새 일) · G04(쓰러진 짝 먼저).
// G05(지원이 오면 기다림을 늘린다)·G07(업고 있으면 교본을 걸지 않는다)은 줄이 아니라 각 줄의 maxWait·엔진의 조건이다. G08(짝 동행)은 3단계가 이 파일 끝에 더한다.
// 남의 몸은 'crew' 자기 신고로만 본다(fit 자리는 늘 보고 모드 — c.st.band·shaken 은 신고, stamina 는 조직 정보).

import { registerDoctrine } from './registry';
import type { WorkKind } from '../../types';

/** 위험 실내 일의 종류 (§3 읽는 법의 HZ — 대상 구역이 위험 건물 실내인지는 c.hz 가 본다) */
const HZ: WorkKind[] = ['search', 'carry', 'escort', 'extricate', 'mitigate', 'overhaul'];
/** 무거운 일 (G01): 교전·위험 실내 일·위험 구역의 동료 구조·수난 구조 */
const HEAVY: WorkKind[] = ['engage', ...HZ, 'rescueMate', 'waterRescue'];
/** 가벼운 일 (H1 LIGHT_WORK 의 종류 — 처치·동료 처치가 안전 구역일 때만인 것은 c.light 가 본다. 정본은 injury.LIGHT_WORK) */
const LIGHT: WorkKind[] = ['traffic', 'perimeter', 'negotiate', 'interview', 'hookup', 'treat', 'treatMate'];

registerDoctrine(
  {
    id: 'G01', dept: 'common', name: '중상 — 무거운 일 줄이고 가벼운 일로', short: '가벼운 임무',
    who: { doc: ['special'] },      // 경찰·소방·의료 표 대원은 P12·F14·E11 (한 대원에게 부상 줄이 둘 걸리지 않는다)
    hook: 'fit', works: [...HEAVY, ...LIGHT],
    when: (c) => c.st.band >= 1,
    effect: [
      { kind: 'fitMul', mul: 0.35, works: HEAVY, when: (c) => c.w !== null && (c.w.kind === 'engage' || c.w.kind === 'waterRescue' || c.hz || (c.w.kind === 'rescueMate' && c.wRisky)) },
      { kind: 'fitAdd', add: 0.15, works: LIGHT, when: (c) => c.light },
    ],
    th: { band: 1, mul: 0.35, add: 0.15 }, rank: 1, why: 'hurt',
  },
  {
    id: 'G02', dept: 'common', name: '동요 — 진입·위험 실내 일 줄이기', short: '동요 — 진입 자제',
    hook: 'fit', works: ['engage', ...HZ],
    when: (c) => c.st.shaken && c.w !== null && (c.w.kind === 'engage' ? c.sit.entryOrdered : c.hz),
    effect: { kind: 'fitMul', mul: 0.6 },
    th: { mul: 0.6 }, rank: 1, why: 'shaken',
  },
  {
    // 기록 전용(배율 1): 동요한 대원의 조심성 +0.2(상한 1.1)는 methods.ts 의 makeCtx 가 dc.st.shaken 으로 올린다 — 그 때문에 1등이 바뀌었을 때 이 줄로 센다
    id: 'G02b', dept: 'common', name: '동요 — 위험한 방법 꺼리기', short: '동요 — 조심',
    hook: 'method', methods: ['swim', 'boat', 'charge', 'rapid', 'tunnel', 'dive'],      // 위험(risk > 0)이 있는 방법 — 조심성이 점수를 바꾸는 것
    when: (c) => c.st.shaken,
    effect: { kind: 'methodMul', mul: 1 },
    th: { caution: 0.2 }, rank: 1, why: 'shaken',
  },
  {
    id: 'G03', dept: 'common', name: '지친 대원 — 위험 실내 새 일 맡지 않기', short: '지침 — 진입 제외',
    hook: 'fit', works: HZ,
    when: (c) => c.hz && c.st.stamina < 30 && c.w !== null && (c.a.task === null || c.a.task.workId !== c.w.id),      // 하던 일은 지금처럼 지구력 22 까지
    effect: { kind: 'fitMul', mul: 0 },
    th: { stamina: 30 }, rank: 1, why: 'tired',
  },
  {
    id: 'G04', dept: 'common', name: '쓰러진 짝을 먼저 끌어낸다', short: '짝 먼저 구조',
    hook: 'fit', works: ['rescueMate'],
    when: (c) => c.w !== null && c.w.mate >= 0 && c.w.mate === c.a.buddy,      // 자격(hot 이면 경찰·위험 구역이면 공기호흡기)은 H1 그대로 — 교본은 0 을 열지 못한다
    effect: { kind: 'fitAdd', add: 0.2 },
    th: { add: 0.2 }, rank: 2, why: 'buddy',
  },
);
