// (R3b N7 — docs/specs/R3b-followup.md §3.2) 자주 도는 객체의 숫자 칸을 만들 때부터 소수 표현으로 — 값은 한 글자도 바뀌지 않는다.
//
// 까닭: V8 은 객체의 숫자 칸을 처음 들어온 값의 표현으로 시작한다(정수면 Smi). 교대 도중 그 칸에 처음 소수(sim.t + 7 같은)가 들어오면
// 그 모양(map)을 버리고 새 모양을 만들며, 버린 모양에 기대어 최적화된 함수는 모두 버려지고(탈최적화 'wrong map') 다시 컴파일된다.
// 한 번도 바뀌지 않은 칸은 상수로 보고 최적화 코드에 박아 두므로, 처음 바뀔 때 그 칸에 기댄 코드도 버려진다('code dependencies').
// 헤드리스 실행의 사용자 CPU 의 절반 남짓이 이 다시 컴파일이었다 (R3 속도 절 "찾은 것 3" · 참고 패치 docs/handover/patches/P2-speed-partial.patch).
// 그래서 만든 바로 다음에 그 칸들에 소수를(·같은 표현의 다른 값을) 한 번 썼다가 원래 값을 되돌린다 — 그 뒤의 소수는 모양을 바꾸지 않는다.
//
// 지킬 것: 값을 바꾸지 않는다(같은 값을 되돌린다) · 칸을 더하지 않는다(없는 칸은 건너뛴다 — 칸의 순서·수가 그대로) · 난수·Sim 을 건드리지 않는다.
// 이 파일은 아무것도 import 하지 않는 잎이다. 목록에서 칸을 빠뜨려도 결과는 같다 — 느려질 뿐이다. 새 숫자 칸이 나중에 소수를 받으면 목록에 넣는다.
// 효과를 재는 명령: node --trace-deopt <번들> 3 --no-metrics 2>&1 | grep -o 'reason: [^)]*' | sort | uniq -c  ('wrong map' 의 수) · 사용자 CPU (time)

const hasOwn = Object.prototype.hasOwnProperty;
/** 같은 표현의 다른 값 (상수 칸을 바뀌는 칸으로): 정수는 정수, 참거짓은 반대, 글자는 다른 글자, 배열은 빈 배열(얼린 하나), 그 밖은 null ↔ undefined */
const NO_ARR: readonly unknown[] = Object.freeze([]);
function other(v: unknown): unknown {
  if (typeof v === 'number') return v === 0 ? 1 : 0;
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'string') return v === '' ? ' ' : '';
  if (Array.isArray(v)) return v === NO_ARR ? [] : NO_ARR;
  return v === null ? undefined : null;
}

/** 한 생성 자리의 목록. every = 몇 개마다 한 번 넓히는가(1 = 모두 — 자주 만드는 자리는 크게: 처음 하나가 모양을 넓히고, 모양을 잃었을 때 다시 넓힌다) */
export interface ShapeSite { readonly nums: readonly string[]; readonly muts: readonly string[]; readonly every: number; n: number }
export function shapeSite(nums: readonly string[], muts: readonly string[] = [], every = 1): ShapeSite { return { nums, muts, every, n: 0 }; }

/**
 * 만든 바로 다음에 부른다: nums 의 칸마다 소수를 한 번 넣고 원래 값을 되돌리고, muts 의 칸마다 같은 표현의 다른 값을 넣고 되돌린다.
 * 객체에 없는 칸은 건너뛴다(칸을 더하지 않는다). 돌려주는 것은 받은 객체 그대로
 */
export function primeNums<T extends object>(o: T, site: ShapeSite): T {
  if (site.n++ % site.every !== 0) return o;
  const r = o as Record<string, unknown>;
  const nums = site.nums, muts = site.muts;
  for (let k = 0; k < nums.length; k++) { const key = nums[k]; if (!hasOwn.call(r, key)) continue; const v = r[key]; r[key] = 0.5; r[key] = v; }
  for (let k = 0; k < muts.length; k++) { const key = muts[k]; if (!hasOwn.call(r, key)) continue; const v = r[key]; r[key] = other(v); r[key] = v; }
  return o;
}

// ── 자리마다의 목록 (참고 패치 P2 의 진단 — 교대를 여럿 돌린 뒤 소수 표현이 된 칸·처음 바뀌는 칸. R3·I1-b 가 더한 칸을 보탰다) ──
/** agents.makeAgent */
export const AGENT_SHAPE = shapeSite(
  ['x', 'y', 'px', 'py', 'fx', 'fy', 'nextThink', 'ring', 'arrivedAt', 'idleSince', 'planT', 'outboxSince', 'shadowSince', 'nextPerceive', 'cooldown',
    'smokeT', 'rehabLogAt', 'lastRetreatLog', 'hpTick', 'climb', 'taserAt', 'underFireT', 'pendingBlock', 'equipRetryAt', 'reloadUntil', 'trapped', 'wetSince',
    'stuckT', 'lastX', 'lastY', 'shaken', 'shakenOff'],
  ['status', 'afloat', 'aloft', 'label', 'path', 'task', 'docMem', 'lightBack', 'fellOnce', 'doc', 'crewSig', 'equipIssue']);
/** executor.makeTask (자주 만든다) */
export const TASK_SHAPE = shapeSite(
  ['progress', 'need', 'startedAt', 'repathAt', 'tx', 'ty', 'wait', 'gateAt', 'range', 'mt0', 'cvX', 'cvY', 'cvTx', 'cvTy', 'cvLost', 'entryDoor'],
  ['label', 'pts', 'covered', 'sub', 'method', 'mwhy', 'tried', 'docRule', 'gateId', 'gateSaid', 'selfAssigned', 'thorough', 'marr'], 16);
/** commander.want 의 작업 항목 */
export const WORK_SHAPE = shapeSite(['priority', 'createdAt', 'doneAt', 'holdUntil'], ['status', 'note', 'risky', 'thorough'], 4);
/** sceneManager.createScene 의 현장 (빌더가 다 만든 뒤) */
export const SCENE_SHAPE = shapeSite(
  ['exposure', 'startedAt', 'clearVision', 'nextCarAt', 'trafficFlow', 'outdoorVision', 'arrivedAt', 'fireOutAt', 'lastSitrep', 'negotStart',
    'closedCheckAt', 'idleSince', 'triageAt', 'allIdleSince', 'rollCallAt', 'secureAt', 'breachAt', 'bangAt', 'airAt'],
  ['exits', 'spots', 'rules', 'outdoor', 'placeName', 'staging', 'safe', 'vantage', 'light', 'cat', 'ops', 'flow', 'quay', 'fan', 'ruin', 'falls', 'laneShield',
    'sizeupDone', 'closing', 'entryOrdered', 'breachDone', 'archived', 'mismatchLogged', 'leadDept']);
/** 현장의 {x, y} 자리 (대기 지점) */
export const POINT_SHAPE = shapeSite(['x', 'y'], ['x', 'y']);
/** kit.addRegion */
export const REGION_SHAPE = shapeSite(['cx', 'cy', 'x0', 'y0', 'x1', 'y1'], ['tiles', 'name', 'kind', 'indoor', 'searchable']);
/** kit.addProp */
export const PROP_SHAPE = shapeSite(['x', 'y', 'hp', 'angle', 'leakRate', 'fuse', 'heatLoad', 'heatK'],
  ['blocking', 'locked', 'open', 'leak', 'mitigated', 'ignited', 'occupants', 'emptySeat', 'cleared', 'exploded', 'found', 'removed', 'entered', 'live', 'vessel']);
/** kit.addCas */
export const CAS_SHAPE = shapeSite(
  ['health', 'bleed', 'concealment', 'bleed0', 'x', 'y', 'px', 'py', 'trapWork', 'treatProg', 'treatQ', 'wanderT', 'drift',
    'tDiscovered', 'tFreed', 'tTreated', 'tSafe', 'tLoaded', 'tDead', 'tHospital'],
  ['mob', 'where', 'treated', 'dead', 'walking', 'path', 'panic', 'inWater', 'inVehicle', 'freedHow', 'rush', 'wander', 'hostage', 'injuries', 'bleedCause', 'deathCause', 'lost']);
/** kit.addHostile */
export const HOSTILE_SHAPE = shapeSite(
  ['x', 'y', 'px', 'py', 'health', 'morale', 'aggression', 'skill', 'fleeAt', 'facing', 'lookAt', 'deadline', 'cooldown', 'negot', 'stunUntil',
    'alertUntil', 'shotAt', 'moveAt', 'bleed', 'bleed0', 'treatQ', 'tTreated', 'tDown', 'tDead', 'hideUntil'],
  ['state', 'hidden', 'path', 'retreated', 'dragging', 'stunHow', 'where', 'dead', 'injuries', 'weapon', 'label']);
/** (N8 단계 5) kindsKit.addAnimal 의 동물 */
export const ANIMAL_SHAPE = shapeSite(['x', 'y', 'px', 'py', 'facing', 'agit', 'sedate'], ['state', 'path', 'via']);
/** resources 의 두 부대 리터럴 */
export const UNIT_SHAPE = shapeSite(
  ['x', 'y', 'px', 'py', 'water', 'waterMax', 'pumpCond', 'tool', 'medLevel', 'armor', 'segT', 'timer', 'dispatchedAt', 'estArrive', 'busyTime',
    'fuel', 'nodeId', 'destNode', 'curbT', 'firstLoadAt'],
  ['state', 'route', 'pendingDest', 'incidentId', 'hydrant', 'pumpFailed', 'patients', 'patientsIncident', 'diverted', 'boardOrder', 'aboard', 'grounded',
    'backing', 'curb', 'parking', 'caps']);
/** resources 의 두 대원 리터럴 */
export const RESPONDER_SHAPE = shapeSite(['skill', 'judgment', 'composure', 'fitness', 'teamwork', 'experience', 'health', 'stamina', 'bleed', 'bleed0', 'treatQ', 'tDown', 'tDead'],
  ['status', 'dead', 'care', 'injuries', 'deathCause', 'bleedCause', 'trait']);
/** 대원의 장비 항목 (crews.kitFor 가 만든 것 — resources 가 대원을 만든 뒤) */
export const KIT_SHAPE = shapeSite(['uses', 'mag'], ['fault', 'faultKnown']);
/** incidents.createIncident 의 사건과 그 진실 */
export const INCIDENT_SHAPE = shapeSite(
  ['createdAt', 'followupAt', 'firstCallAt', 'reportedAt', 'answeredAt', 'unmetSince', 'firstDispatchAt', 'firstArrivalAt', 'closedAt', 'priority', 'reportedNode'],
  ['phase', 'locationKnown', 'assessment', 'result', 'fieldVerified', 'fieldType', 'noUnitLogged', 'closeReason', 'firstAssess', 'addressFixed',
    'pursuit', 'coResp', 'aidUnit', 'airDone', 'methods', 'docs', 'fieldRisk', 'blockedBy']);
export const TRUTH_SHAPE = shapeSite(['x', 'y', 'nodeId'], ['label', 'placeId', 'placeKind', 'district']);
/** 사실의 값 (agents.casFact·hosFact·mateFact — 아주 자주 만든다. 만든 뒤 고치지 않으므로 바뀌는 칸 목록은 없다 · x·y 는 늘 정수로 반올림한 값) */
export const CAS_V_SHAPE = shapeSite(['drift'], [], 64);
export const HOS_V_SHAPE = shapeSite(['facing'], [], 64);
export const MATE_V_SHAPE = shapeSite(['since'], [], 64);
/** 지휘 상태 (ops.newOps) */
export const OPS_SHAPE = shapeSite(['since', 'quietSince', 'parAt', 'parDue', 'utilityAsked']);
