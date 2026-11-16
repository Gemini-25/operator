// AgentManager — 대원의 인지(Perception), 믿음 갱신(Belief Update), 무전(Communication).
// 대원은 시야 안에서 직접 본 것과 무전/대면으로 전달받은 것만 안다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { T } from '../types';
import type { CasBelief, Casualty, Fact, FieldAgent, Hostile, Incident, MateBelief, RadioMsg, Responder, Scene, Unit, WorkItem, WorkKind } from '../types';
import { TYPE_NAME, clamp, dist, josa, pct } from '../util';
import { TYPE_DEFS } from '../incidentTypes';
import type { Rng } from '../rng';
import { airShort, hasFirearm, hasKit, kitLive, kitWorks, medLevelOf, roleOf, seatsOf, seatsUsed, toolFor } from '../crews';
import { BeliefStore, mkFact } from './beliefs';
import type { CostFn } from './grid';
import { doorAt, isIndoor, los, staticPass, tileOf } from './grid';
import { BAND_NAME, band, isHeld, pushFx } from './hazards';
import { HOSPITAL_BLEED, HURT_AT, LIGHT_WORK, bandOf, hurtF, mustRetreat, treatPlan } from './injury';

export const resp = (sim: Sim, a: FieldAgent): Responder => sim.responders[a.rid];
/** 지친 정도와 다친 정도가 이동·작업 진도·사격에 함께 곱해진다 (다친 대원은 느려진다 — injury.hurtF: 체력 70 이상은 1, 40 에서 0.75) */
export const staminaF = (r: Responder): number => (0.55 + 0.45 * clamp(r.stamina / 60, 0, 1)) * hurtF(r);

/**
 * 현장의 개체 하나를 만든다 — 차에서 내리는 대원(sceneManager.unitArrived)과 상공의 관측자(field/rules/air.ts)가 함께 쓴다.
 * 모든 칸을 같은 순서로 채운다(도중에 속성이 생기면 객체의 모양이 갈라져 매 틱 도는 코드가 느려진다). 믿음은 비어 있다 — 브리핑은 부르는 쪽이 넣는다.
 */
export function makeAgent(sim: Sim, rid: number, unitId: number, x: number, y: number, firstThink: number, rng: Rng): FieldAgent {
  return {
    rid, unitId, isCommander: false,
    x, y, px: x, py: y, fx: 1, fy: 0,
    path: null, pathI: 0, pathGoal: -1, task: null, orderWork: -1,
    beliefs: new BeliefStore(), outbox: [], outboxSince: 0, shadowSince: -1, commFailLogged: false,
    nextThink: firstThink, nextPerceive: 0, carrying: -1, inCover: false, cooldown: 1,
    status: 'active', candidates: [], label: '도착', ring: 0, arrivedAt: sim.t, lastBlockEvent: -1, idleSince: sim.t,
    stuckT: 0, lastX: 0, lastY: 0, rng, planT: 0, equipIssue: 'none', smokeT: 0, climb: 0, rehabLogAt: -99,
    afloat: undefined, mrng: undefined, mfail: undefined, msaid: undefined, wetSince: undefined, wetTired: undefined,      // (R2) 보트·방법 판정 난수·접은 방법의 기억·물에 들어간 시각 — 쓰는 것은 단계 1a 부터
    pendingBlock: -1, underFireT: -99, spot: -1, quiet: new Set(), lastRetreatLog: -99, equipRetryAt: -99,
    trapped: undefined, trapEv: undefined, avoid: undefined, opsSeen: undefined, signObs: undefined, extSeen: undefined,      // (X6) 깔림·피하는 곳·철수 명령·조짐 관찰의 기억 — 쓰는 것은 단계 2 부터
    aloft: false, taserAt: -99,      // (R1) 공중 관측자가 아니다(관측자는 air.ts 가 true 로 바꾼다) · 테이저를 쏜 적이 없다
    hurtEv: undefined, hpTick: undefined, lastTile: undefined, fellOnce: undefined, lightBack: undefined,      // (H1) 부상 — 쓰는 것은 단계 4a 부터
    buddy: -1, doc: null, docMem: undefined, shaken: undefined, shakenOff: undefined, reloadUntil: undefined, crewSig: undefined,      // (R3) 짝(부대가 내린 뒤 pairUp — 3단계)·교본 행동·기억·동요·재장전·자기 신고 — 쓰는 것은 단계 1 부터
  };
}

/** 관제가 출동 부대에 전달하는 브리핑. 신고자 진술에서 나온 미확인 정보다. */
export function briefFacts(sim: Sim, I: Incident): Fact[] {
  const out: Fact[] = [];
  const s = sim.scenes[I.id]!;
  const last = (topic: string) => { for (let k = I.claims.length - 1; k >= 0; k--) if (I.claims[k].topic === topic) return I.claims[k]; return null; };
  const as = I.assessment;
  if (as) out.push(mkFact('type', 0, as.type, '관제', sim.t, as.typeConf, false, `관제 판단: ${TYPE_NAME[as.type]} (신뢰도 ${Math.round(as.typeConf * 100)}%)`));
  const cnt = last('count'), inj = last('injured'), trap = last('trapped'), det = last('detail');
  let count: number | null = null, conf = 0.4;
  if (cnt && typeof cnt.value === 'number') { count = cnt.value; conf = cnt.conf; }
  else if (inj && inj.value === true) { count = 1; conf = inj.conf * 0.8; }
  else if (trap && trap.value === true) { count = 1; conf = trap.conf * 0.8; }
  let region = -1;
  if (det && det.value && typeof det.value.region === 'number' && det.value.region < s.regions.length) region = det.value.region;
  if (count !== null || region >= 0) {
    const where = region >= 0 ? ` · 위치 추정: ${s.regions[region].name}` : '';
    out.push(mkFact('occ', 0, { count, region, trapped: !!(trap && trap.value === true) }, '신고자', sim.t, conf, false, `신고 내용: ${count !== null ? `요구조자 약 ${count}명` : '요구조자 수 불명'}${where}`));
  }
  for (const c of I.claims) if (c.topic === 'hazard') { const f = hazardSign(sim, I, c); if (f && !out.some((g) => g.key === f.key)) out.push(f); }      // (X6 §3.6) 신고에서 안 위험 — 미확인 조짐
  return out;
}
/**
 * (X6 §3.6) 신고의 위험 진술 → 미확인 조짐 사실 (현장 관찰이 오면 덮어쓴다 — BeliefStore.merge). 지휘 쪽 위험 단계는 올리지 않는다(기록·주의만 — §5.2):
 *   '아직도 뭐가 계속 떨어져요'(unstable) → 건물 조짐 1 (id 5000) · 가스 누출로 판단한 사건의 '가스가 새요'(gas) → 위치 모르는 가스 조짐 1 (id 1999).
 * 화재의 '가스통 같은 게 있어요'는 위치를 모르므로 사실로 만들지 않는다 (지휘관은 찾으면 안다). 브리핑(briefFacts)과 추가 신고 전달(dispatcher.briefUpdate)이 함께 쓴다
 */
export function hazardSign(sim: Sim, I: Incident, c: { topic: string; value: unknown; conf: number }): Fact | null {
  if (c.topic !== 'hazard') return null;
  if (c.value === 'unstable') return mkFact('sign', SIGN_BASE.bldg, { kind: 'bldg', level: 1, region: -1, x: -1, y: -1 }, '신고자', sim.t, c.conf, false, '신고 내용: 무언가 계속 무너지는 소리 — 2차 붕괴 위험');
  if (c.value === 'gas' && I.assessment && I.assessment.type === 'hazmat') return mkFact('sign', SIGN_BASE.gasUnknown, { kind: 'gas', level: 1, region: -1, x: -1, y: -1 }, '신고자', sim.t, c.conf, false, '신고 내용: 가스 냄새');
  return null;
}

/** 공중 관측 거리(칸): 낮 9 · 비 7 · 밤 4 (탐조등이 작동하면 8). 안개에는 헬기가 뜨지 않는다 */
const AIR_VISION = { day: 9, rain: 7, night: 4, lit: 8 };
export function visionOf(sim: Sim, s: Scene, a: FieldAgent): number {
  const i = tileOf(s, a.x, a.y);
  if (a.aloft) {
    // 상공의 관측자: 현장의 시야(실내·실외·나무)가 아니라 날씨가 정한다. 공중 열영상은 연기를 무시한다.
    // 이 함수는 순수하다 — 탐조등·열영상의 고장은 kitLive 로 효과만 뺀다 (드러내는 자리는 field/rules/air.ts 가 탐조등을 처음 켤 때)
    const w = sim.weather;
    const base = w === 'night' ? (kitLive(sim, a.rid, 'searchlight') ? AIR_VISION.lit : AIR_VISION.night) : w === 'rain' ? AIR_VISION.rain : AIR_VISION.day;
    return kitLive(sim, a.rid, 'flir') ? base : Math.max(1.3, base * (1 - 0.78 * s.smoke[i]));
  }
  let base = isIndoor(s.tiles[i]) ? s.indoorVision : s.outdoorVision;
  // 경찰 헬기의 탐조등이 비추는 원 안의 바깥 칸: 맑은 날 그 현장의 바깥 시야만큼 보인다 (어두워서 줄어든 만큼을 되돌린다 — 넘지는 않는다)
  const lt = s.light;
  if (lt && !isIndoor(s.tiles[i])) { const dx = a.x - lt.x, dy = a.y - lt.y; if (dx * dx + dy * dy <= lt.r * lt.r) base = Math.max(base, s.clearVision ?? 7.5); }
  const tree = s.tiles[i] === T.TREE ? 0.75 : 1;
  // 열화상 카메라는 연기 너머를 본다. 이 함수는 화면(시야 다각형·어둠 층)도 부르므로 순수해야 한다:
  // kitLive 로 효과만 계산하고 고장을 드러내지 않는다(여기서 드러내면 그림을 그리는 것만으로 기록과 해시가 바뀐다 — 드러내는 자리는 perceive)
  const smokeK = s.smoke[i] > 0 && kitLive(sim, a.rid, 'tic') ? 0.35 : 0.78;
  return Math.max(1.3, base * (1 - smokeK * s.smoke[i]) * tree);
}
/** 숨겨진 대상을 알아볼 수 있는 거리. 연기·은폐·날씨가 줄이고, 판단력·경험이 늘린다. */
export function detectRadius(sim: Sim, s: Scene, a: FieldAgent, concealment: number): number {
  const r = resp(sim, a);
  // 상공의 관측자: 공중 열영상이 가려진 사람의 열을 잡는다 (지상의 탐지 장비·열화상 카메라는 쓰지 않는다)
  if (a.aloft) return visionOf(sim, s, a) * (1 - 0.72 * concealment * (kitLive(sim, a.rid, 'flir') ? 0.35 : 1)) * (0.72 + 0.3 * r.judgment + 0.25 * r.experience);
  // 붕괴 현장에서 탐지 장비(청음·영상)를 든 대원은 잔해에 가려진 사람을 더 멀리서 찾는다
  // (이 함수는 화면도 부른다: 고장을 드러내지 않는 kitLive 로 효과만 계산한다 — 드러내는 자리는 perceive)
  if ((s.kind === 'collapse' || isRubbleMode(s)) && kitLive(sim, a.rid, 'searchKit')) concealment *= 0.45;      // (X6 §6.1) 무너진 건물의 잔해 수색에서도
  // 짙은 연기 속에서는 열화상 카메라가 가려진 사람의 윤곽을 잡아 준다
  if (s.smoke[tileOf(s, a.x, a.y)] > 0.3 && kitLive(sim, a.rid, 'tic')) concealment *= 0.7;
  return visionOf(sim, s, a) * (1 - 0.72 * concealment) * (0.72 + 0.3 * r.judgment + 0.25 * r.experience);
}

/** 잔해 보고 문구. 구역 이름이 이미 '…통로'면 '통로'를 겹쳐 붙이지 않는다 */
export function debrisText(where: string): string { return `${where}${where.endsWith('통로') ? '가' : ' 통로가'} 잔해로 막혀 있음`; }

export function regionNameAt(s: Scene, x: number, y: number): string {
  const i = tileOf(s, x, y);
  const r = s.region[i];
  if (r >= 0) return s.regions[r].name;
  if (s.tiles[i] === T.WATER) {      // 물 칸은 구역에 들지 않는다: 맞닿은 물가 구역의 이름으로 부른다
    const cx = i % s.w, cy = (i / s.w) | 0;
    for (let d = 1; d <= 2; d++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx * d, ny = cy + dy * d;
      if (nx >= 0 && ny >= 0 && nx < s.w && ny < s.h && s.region[ny * s.w + nx] >= 0) return `${s.regions[s.region[ny * s.w + nx]].name} 앞 물속`;
    }
    return '물속';
  }
  return isIndoor(s.tiles[i]) ? '건물 내부' : '외부';
}

/** (R2 단계 3) 그 사람이 열린 맨홀(소품 roadDebris · skin manhole) 칸에 있는가 — 갇힌 사람에게만 묻는다 */
function inManhole(s: Scene, c: Casualty): boolean {
  const x = Math.round(c.x), y = Math.round(c.y);
  for (let k = 0; k < s.props.length; k++) { const p = s.props[k]; if (p.kind === 'roadDebris' && p.skin === 'manhole' && !p.removed && p.x === x && p.y === y) return true; }
  return false;
}
export function casFact(sim: Sim, s: Scene, c: Casualty, src: string): Fact {
  const mob = c.mob === 'trapped' ? 'trapped' : c.walking ? 'mobile' : 'immobile';
  const b = band(c.health);
  // water: (R2) 물속인가 — 본 그대로. 이 값은 늘 mob·band 와 함께 바뀌므로(물에 빠짐·건져 냄·휩쓸려 숨짐) 믿음의 "새 소식" 판정을 바꾸지 않는다.
  // drift: (R2 1a) 떠내려가는 속도 — 본 그대로(물 밖이면 0). 떠내려가는 동안은 그대로이고 걸려 멈추는 순간 0 이 된다 — 그때 보고가 한 번 더 나간다(방법을 고르는 판단부가 물살을 이것으로 본다)
  // veh·pit: (R2 단계 3) 갇힌 차량의 소품 id · 맨홀 아래 — 본 그대로 (구출 방법의 범주를 대원이 믿음으로 가린다). 늘 mob 과 함께 바뀐다(구출이 끝나면 함께 사라진다)
  // rush: (R2 단계 6) 구급 대원이 즉시 이송을 정했다 — 처치와 함께 바뀐다(treated·tq). 지휘관이 처치를 더 내지 않고 탑승을 먼저 한다
  const v: CasBelief = { x: Math.round(c.x), y: Math.round(c.y), mob, band: b, where: c.where, treated: c.treated, trappedDone: c.mob !== 'trapped', tq: c.treatQ >= 0.6 ? 2 : c.treated ? 1 : 0, water: c.inWater === true, drift: c.inWater ? c.drift ?? 0 : 0,
    veh: c.inVehicle !== null && c.mob === 'trapped' ? c.inVehicle : undefined, pit: c.mob === 'trapped' && inManhole(s, c) ? true : undefined, rush: c.rush ? true : undefined };
  const mobT = c.dead ? '' : mob === 'trapped' ? ' · 고립' : mob === 'mobile' ? ' · 자력 대피 중' : c.where === 'scene' ? ' · 거동 불가' : '';
  const whereT = c.where === 'safe' ? '안전 구역' : c.where === 'loaded' ? '구급차 탑승' : c.where === 'carried' ? '이송 중' : regionNameAt(s, c.x, c.y);
  return mkFact('cas', c.id, v, src, sim.t, 1, true, `구조 대상 ${c.label}: ${whereT}${mobT} · ${BAND_NAME[b]}`);
}
/**
 * 용의자의 상태 ('hos' 사실). d = 관찰자와 그 용의자 사이의 거리 (검거·처치한 대원은 곁에서 본다 — 0 에 가깝다). 필수 인자다 — 빠뜨린 호출을 tsc 가 잡는다.
 * (H1 단계 5) 값에 dead · band · tq · where 를 더한다: 숨졌는지는 2칸 안에서만 알 수 있고(멀리서는 쓰러진 것만 보인다), 중증도는 위중(2)까지만 적는다 —
 * 구조 대상의 casFact 처럼 보이는 그대로다(다친 모습·쓰러진 모습). 받은 처치(tq)와 있는 곳(where — 현장·차에 실림)도 본 그대로.
 */
export function hosFact(sim: Sim, s: Scene, h: Hostile, src: string, d: number): Fact {
  const wt = h.weapon === 'gun' ? '총기 소지' : h.weapon === 'knife' ? '흉기 소지' : '비무장';
  const dead = h.dead === true && d <= 2;
  const st = dead ? '사망' : h.state === 'hold' ? '대치 중' : h.state === 'fight' ? '교전 중' : h.state === 'flee' ? '도주 중' : h.state === 'surrendered' ? '투항' : h.state === 'arrested' ? (h.tDown !== undefined ? '검거 · 쓰러짐' : '검거') : h.state === 'down' ? '쓰러짐' : '도주';
  const hold = h.hostageId >= 0 && (h.state === 'hold' || h.state === 'fight');
  const tq = (h.treatQ ?? 0) >= 0.6 ? 2 : (h.treatQ ?? 0) > 0 ? 1 : 0;
  const v = { x: Math.round(h.x), y: Math.round(h.y), weapon: h.weapon, state: h.state, hostage: hold, facing: Math.round(h.facing * 4) / 4, dead, band: dead ? 3 : Math.min(2, bandOf(h.health)), tq, where: h.where ?? 'scene' };
  return mkFact('hos', h.id, v, src, sim.t, 1, true, `${h.label}: ${wt}${hold ? ' · 인질을 붙잡고 있음' : ''} · ${st} (${regionNameAt(s, h.x, h.y)})`);
}

/**
 * 동료의 상태 ('mate' 사실 — 값은 MateBelief). 본 대원·끌고 가는 대원·다친 본인이 만든다.
 * d = 관찰자와 그 동료 사이의 거리 (본인의 보고, 끌고 가는 대원은 0). 멀리서는 쓰러진 것만 보인다:
 *   숨졌는지는 2칸 안에서만 알 수 있고, 중증도는 3칸 안에서만 실제 값이다 (그보다 멀면 쓰러졌으면 위중, 아니면 중상으로 적는다).
 * 칸 이름이 bleed 가 아니라 bleeding 인 것은 지휘 쪽의 진실 읽기 검사(.bleed)에 걸리지 않게 하려는 것이다.
 */
export function mateFact(sim: Sim, s: Scene, b: FieldAgent, status: MateBelief['status'], src: string, d: number): Fact {
  const r = sim.responders[b.rid];
  const dead = r.dead === true && d <= 2;
  const near = d <= 3;
  const band = dead ? 3 : near ? Math.min(2, bandOf(r.health)) : status === 'down' ? 2 : 1;      // 숨진 줄 모르면 사망(3)으로 적지 않는다
  const v: MateBelief = {
    x: Math.round(b.x), y: Math.round(b.y), status, band, bleeding: near && (r.bleed ?? 0) >= HOSPITAL_BLEED,      // 병원이 필요할 만큼 피를 흘린다 (injury.needsHospital 과 같은 문턱)
    tq: (r.treatQ ?? 0) >= 0.6 ? 2 : (r.treatQ ?? 0) > 0 ? 1 : 0, dead, wasDown: r.tDown !== undefined, since: sim.t,
    trapped: (b.trapped ?? 0) > 0 || undefined,      // (X6 §4.8) 잔해에 깔린 동료 — 먼저 빼내야 끌고 나올 수 있다 (깔리지 않았으면 비워 둔다)
  };
  const text = dead ? `${r.name} 대원 생체 반응 없음`
    : status === 'down' ? ((b.trapped ?? 0) > 0 ? `${r.name} 대원 잔해에 깔림 — 구조 필요` : `${r.name} 대원 쓰러짐 — 구조 필요`)
    : status === 'hurt' ? `${r.name} 대원 부상 — 후퇴 중`
    : status === 'safe' ? `${r.name} 대원 안전 구역 — 후송 대기`
    : status === 'evac' ? `${r.name} 대원 현장 이탈`
    : `${r.name} 대원 가벼운 임무로 복귀`;
  return mkFact('mate', b.rid, v, src, sim.t, 1, true, text);
}
/**
 * 그 동료의 지금 상태를 mate 사실의 status 로: 쓰러져 있으면 down, 안전 구역에 있으면 safe, 차에 탔으면 evac.
 * 걷고 있으면 — 물러나야 하는 몸이면 hurt(후퇴 중), 아니면 light(가벼운 일을 하는 다친 대원). 곁에서 본 대원(실행기)이 부른다
 */
export function mateStatus(sim: Sim, b: FieldAgent): MateBelief['status'] {
  return b.status === 'down' ? 'down' : b.status === 'withdrawn' ? 'safe' : b.status === 'left' ? 'evac' : mustRetreat(sim.responders[b.rid]) ? 'hurt' : 'light';
}

/** 보고할 가치가 있는 변화인가 (위치만 바뀐 것은 조용히 갱신) */
function significant(f: Fact, old: any): boolean {
  const v = f.value;
  if (f.type === 'cas') return v.where !== 'carried' && (old.mob !== v.mob || old.band !== v.band || old.where !== v.where || old.treated !== v.treated || old.tq !== v.tq);
  if (f.type === 'hos') return old.state !== v.state || old.weapon !== v.weapon || old.hostage !== v.hostage || !!old.dead !== !!v.dead || (old.tq ?? 0) !== (v.tq ?? 0) || (old.where ?? 'scene') !== (v.where ?? 'scene');
  if (f.type === 'mate') return old.status !== v.status || old.dead !== v.dead || old.band !== v.band || old.tq !== v.tq || !!old.trapped !== !!v.trapped;
  if (f.type === 'sign') return old.level !== v.level;      // (X6) 조짐은 단계가 바뀔 때만 알린다 — 측정값(lel)만 바뀐 것은 믿음에 합치되 보고하지 않는다
  if (f.type === 'crew') return old.band !== v.band || old.air !== v.air || old.ammo !== v.ammo || old.shaken !== v.shaken;      // (R3 §4.1) 자기 신고는 서명이 바뀔 때만
  return true;
}
function sameSig(a: Fact, b: Fact): boolean { return a.key === b.key && !significant(a, b.value); }

/** 별도 이벤트로 이미 알린 정보: 믿음·무전 데이터에는 싣되 무전 문구에서는 생략한다. */
export function learnQuiet(sim: Sim, a: FieldAgent, f: Fact): boolean { a.quiet.add(f.key); return learn(sim, a, f); }

/** 믿음에 병합하고, 새 소식이면 보고 대기열에 넣는다. */
export function learn(sim: Sim, a: FieldAgent, f: Fact, report = true, force = false): boolean {
  const cur = a.beliefs.get(f.type, f.id);
  const news = a.beliefs.merge(f);
  if (!force && news && cur && !significant(f, cur.value) && !a.quiet.has(f.key)) return news;
  if ((news || force) && report) {
    const k = a.outbox.findIndex((q) => q.key === f.key);
    if (k >= 0) a.outbox[k] = f; else { if (!a.outbox.length) a.outboxSince = sim.t; a.outbox.push(f); }
  }
  return news;
}

/** 상공의 관측자가 먼저 발견해 아직 아무도 대피를 안내하지 못한 사람 (구조 대상의 모양을 바꾸지 않으려고 따로 둔다) */
const UNGUIDED = new WeakSet<Casualty>();

function discover(sim: Sim, s: Scene, I: Incident, a: FieldAgent, c: Casualty): void {
  const r = resp(sim, a);
  c.tDiscovered = sim.t; c.discoveredBy = a.rid;
  if (c.dead) {
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'casualty', imp: 2, causes: [c.causeEvent], text: `구조 대상 ${c.label} 발견 — ${regionNameAt(s, c.x, c.y)}. 생체 반응이 없습니다.` });
    return;
  }
  const late = sim.t - s.arrivedAt > 150 && s.arrivedAt >= 0;
  const mobT = c.inWater ? '물에 빠져 있음' : c.mob === 'trapped' ? '고립되어 있음' : c.mob === 'immobile' ? '의식 저하, 거동 불가' : '거동 가능';
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'casualty', imp: 2, text: `구조 대상 ${c.label} 발견! ${regionNameAt(s, c.x, c.y)}, ${mobT}, ${BAND_NAME[band(c.health)]}.` });
  pushFx(sim, s, 'text', c.x, c.y - 0.9, undefined, undefined, `${c.label} 발견`, '#7cf5a0', 2);
  if (late && !I.problems.some((p) => p.code === 'LATE_DISCOVERY')) {
    I.problems.push({ code: 'LATE_DISCOVERY', t: sim.t, eventId: sim.events.length - 1, detail: `구조 대상 ${c.label} 발견까지 도착 후 ${Math.round(sim.t - s.arrivedAt)}초 소요`, recovered: true, recoveryText: '', times: undefined, ref: undefined });      // times·ref: raiseProblem 과 같은 모양 (I1-b)
  }
  // 거동 가능한 대상은 대피를 안내한다 (배회하던 실종자는 동행이 필요). 상공의 관측자는 안내하지 못한다 — 보고만 하고,
  // 지상 대원이 그 사람을 처음 만났을 때 안내한다 (perceive 의 UNGUIDED)
  if (c.mob === 'mobile' && !c.wander && !c.isTarget) { if (a.aloft) UNGUIDED.add(c); else if (!isHeld(sim, s, c.id)) { c.walking = true; c.path = null; } }
  r.xpGained += 0.004;
}

/** 시야 안의 진실을 관찰해 믿음을 갱신한다. boost 는 관측 범위 배율(현장 평가 등). */
export function perceive(sim: Sim, s: Scene, a: FieldAgent, boost = 1, throughWalls = false): void {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  // 고장이 드러나는 자리 (열화상 카메라·탐지 장비는 여기뿐이다 — perceive 는 시뮬레이션만 부른다):
  // 연기 속에서 열화상 카메라를, 붕괴 현장에서 탐지 장비를 쓰려 할 때. 고장이 없거나 이미 드러났으면 아무 일도 없다
  if (!a.aloft) {
    if (s.smoke[tileOf(s, a.x, a.y)] > 0.3) kitWorks(sim, a.rid, 'tic', I);
    if (s.kind === 'collapse' || isRubbleMode(s)) kitWorks(sim, a.rid, 'searchKit', I);      // (X6 §6.1) 효과가 걸리는 현장(잔해 수색)에서 고장도 드러난다
  }
  const v = visionOf(sim, s, a) * boost;
  const me = r.name;
  // 상공의 관측자(a.aloft): 지붕 밑(실내 칸)은 보지 못하고, 바깥 칸은 벽·나무에 가리지 않는다(시야선을 보지 않는다).
  // 사람을 움직이지 않고(대피 안내·인질 유도 없음), 소품(문·밸브·단서 …)은 살피지 않는다
  const aloft = a.aloft === true;
  const sees = (x: number, y: number): boolean => (aloft ? !isIndoor(s.tiles[tileOf(s, x, y)]) : los(s, a.x, a.y, x, y));
  const meter = hasKit(sim, a.rid, 'gasMeter');      // 가스 측정기: 새는 밸브를 벽 너머 7칸에서 알아챈다
  const sm = searchMul(a);      // (R2 §4.4) 수색 방법의 탐지 배율 — 경유점에 멈춘 동안(청음·확성기는 소리를 낼 수 있는 대상만)
  for (let ci = 0; ci < s.casualties.length; ci++) { const c = s.casualties[ci];      // 색인 순회: 최적화 전 단계에서 반복자 객체를 만들지 않는다 (순서는 같다)
    if (c.where === 'hospital' || c.where === 'loaded') continue;
    const d = dist(a.x, a.y, c.x, c.y);
    if (d > v) continue;
    const known = c.tDiscovered >= 0;
    const dr = known ? v : detectRadius(sim, s, a, sm.k < 1 && (!sm.voice || c.health > 30) ? c.concealment * sm.k : c.concealment) * boost;
    if (d > dr || !sees(c.x, c.y)) continue;
    let fresh = sim.t - c.tDiscovered < 2.5;      // 방금 누군가 발견을 알렸다면 같은 내용을 되풀이하지 않는다
    if (!known) { discover(sim, s, I, a, c); fresh = true; }
    // 하늘에서 먼저 본 사람을 지상 대원이 처음 만났다: 걸을 수 있으면 대피를 안내한다 (발견한 대원이 하는 것과 같다)
    if (!aloft && known && !c.walking && c.mob === 'mobile' && c.where === 'scene' && !c.dead && UNGUIDED.has(c) && !isHeld(sim, s, c.id)) { UNGUIDED.delete(c); c.walking = true; c.path = null; }
    if (!aloft && known && c.hostage && c.mob === 'mobile' && !c.walking && !c.dead && c.where === 'scene' && !isHeld(sim, s, c.id) && !s.hostiles.some((h) => h.state === 'hold' || h.state === 'fight')) { c.walking = true; c.path = null; }
    if (c.tDiscovered >= 0) { if (fresh) learnQuiet(sim, a, casFact(sim, s, c, me)); else learn(sim, a, casFact(sim, s, c, me)); }
  }
  for (let hi = 0; hi < s.hostiles.length; hi++) { const h = s.hostiles[hi];
    if (h.where !== undefined && h.where !== 'scene') continue;      // 차에 실려 간 용의자는 현장에 없다 (H1)
    const d = dist(a.x, a.y, h.x, h.y);
    const range = aloft ? (h.hidden ? v * 0.4 : v) : h.hidden ? 4.2 : 13;      // 지상은 시야와 상관없이 13칸(숨은 용의자 4.2칸). 상공은 관측 거리만큼 — 밤의 4칸이 용의자에게도 걸린다
    const cur = a.beliefs.get('hos', h.id);
    if (cur && cur.value.dead) continue;      // 숨진 줄 안 뒤에는 더 바뀌지 않는다 — 먼 관찰로 되돌리지 않는다 (H1)
    if (d <= range && sees(h.x, h.y)) {
      const wasHidden = h.hidden;
      if (h.hidden) {
        h.hidden = false;
        raiseProblem(sim, I, 'SCENE_MISMATCH', '숨어 있던 추가 용의자 발견', { role: 'RESPONDER', actor: me, rid: r.id, imp: 3, text: `숨어 있던 추가 용의자 발견! ${regionNameAt(s, h.x, h.y)}.` }, false);
      }
      const hf = hosFact(sim, s, h, me, d);
      // 쓰러졌거나 붙잡혀 움직이지 않는 용의자를 멀리서(2칸 밖) 다시 본 것은 새 소식이 아니다 — 숨졌는지는 곁에서만 안다.
      // 달라진 것이 없으면 믿음을 새 시각으로 덮지 않는다: 덮으면 곁에서 숨진 것을 본 대원의 보고(무전으로 1.2초 늦게 닿는다)가 "더 오래된 사실"이 되어 버려지고,
      // 지휘관은 숨진 용의자에게 처치 지시를 되풀이한다 (H1 검토 — 동료의 'mate' 사실은 이미 같은 규칙이다)
      if (!wasHidden && cur && d > 2 && (h.state === 'down' || h.state === 'arrested') && !significant(hf, cur.value)) continue;
      if (wasHidden) learnQuiet(sim, a, hf); else learn(sim, a, hf);
    } else if (cur && cur.value.state !== h.state && (h.state === 'escaped' || h.state === 'down' || h.state === 'arrested') && d <= 16) {
      learn(sim, a, hosFact(sim, s, h, me, d));
    }
  }
  // 타일 스캔: 화재 / 잔해
  let scanned: Map<number, { n: number; m: number }> | null = null;      // (X6) 외부 관찰의 기억(extSeen)이 스캔 결과를 읽는다
  if (s.burning > 0 || a.beliefs.list('fire').some((f) => f.value > 0)) {
    const R = Math.ceil(v);
    const ax = Math.round(a.x), ay = Math.round(a.y);
    const seen = new Map<number, { n: number; m: number }>();
    scanned = seen;
    for (let y = Math.max(0, ay - R); y <= Math.min(s.h - 1, ay + R); y++) for (let x = Math.max(0, ax - R); x <= Math.min(s.w - 1, ax + R); x++) {
      const i = y * s.w + x;
      const rg = s.region[i];
      if (rg < 0) continue;
      if (dist(ax, ay, x, y) > v) continue;
      if (aloft) { if (isIndoor(s.tiles[i])) continue; }      // 상공에서는 바깥 칸의 불만 본다
      else if (!throughWalls && !los(s, ax, ay, x, y)) continue;
      else if (throughWalls && s.fire[i] < 0.25 && !los(s, ax, ay, x, y)) continue;
      let e = seen.get(rg); if (!e) { e = { n: 0, m: 0 }; seen.set(rg, e); }
      e.n++; if (s.fire[i] > e.m) e.m = s.fire[i];
    }
    for (const [rg, e] of seen) {
      const reg = s.regions[rg];
      const cur = a.beliefs.val<number>('fire', rg) ?? 0;
      if (e.m > 0.05) {
        const lv = Math.round(e.m * 5) / 5;
        if (Math.abs(lv - cur) >= 0.2 || cur === 0) learn(sim, a, mkFact('fire', rg, Math.max(0.1, lv), me, sim.t, 1, true, `${reg.name} 화재 (강도 ${pct(Math.max(0.1, lv))})`));
      } else if (cur > 0 && e.n >= reg.tiles.length * 0.85) {      // 방의 대부분을 봐야 진압을 확인한다 (일부만 보고 확인하면 보지 못한 구석의 불씨가 되살아난다)
        learn(sim, a, mkFact('fire', rg, 0, me, sim.t, 1, true, `${reg.name} 화재 진압 확인`));
      }
    }
  }
  // (X6 §3.3) 외부 관찰(벽 너머 불 ≥ 0.25 를 모두 보는 지휘관의 관찰)의 기억: 관찰 반경 안에 가운데가 든 실내 구획을 "덮었다"고 적고,
  // 센 불(≥ 0.25)을 본 구획은 그 시각을 적는다. 덮인 구획에 새 시각이 없으면 "센 불을 보지 못했다"는 뜻이다 (외부 확인 종료 §6.2 가 쓴다 — 관찰자 자신의 기억)
  if (throughWalls && !aloft) {
    let e = a.extSeen;
    if (!e) { const n = s.regions.length; e = a.extSeen = { hot: new Float32Array(n).fill(-1), cov: new Float32Array(n).fill(-1), cov0: new Float32Array(n).fill(-1) }; }
    for (let rg = 0; rg < s.regions.length; rg++) {
      const reg = s.regions[rg];
      if (!reg.indoor || dist(a.x, a.y, reg.cx, reg.cy) > v) continue;
      e.cov[rg] = sim.t;
      if (e.cov0[rg] < 0) e.cov0[rg] = sim.t;
    }
    if (scanned) for (const [rg, en] of scanned) if (en.m >= 0.25 && s.regions[rg].indoor) e.hot[rg] = sim.t;
  }
  for (let pi = aloft ? s.props.length : 0; pi < s.props.length; pi++) { const p = s.props[pi];      // 상공의 관측자는 소품을 살피지 않는다
    if (p.removed) continue;
    const d = dist(a.x, a.y, p.x, p.y);
    const sniff = meter && p.kind === 'valve' && !p.mitigated && !p.ignited && d <= 7;      // 측정기가 잡는 누출 (시야·벽과 상관없다)
    if (d > v + 1 && !sniff) continue;
    if (p.kind === 'debris') {
      const i = p.y * s.w + p.x;
      if (!a.beliefs.get('blk', i) && d <= v && los(s, a.x, a.y, p.x, p.y)) {
        const f = mkFact('blk', i, 'debris', me, sim.t, 1, true, debrisText(regionNameAt(s, p.x, p.y)));
        // 같은 곳(같은 문구)의 잔해를 이미 알고 있다(스스로 알렸거나 무전으로 들었다): 믿음과 무전 자료로만 보내고 같은 말을 되풀이하지 않는다
        const told = a.beliefs.list('blk').some((g) => g.text === f.text);
        if (a.path && a.path.indexOf(i, a.pathI) >= 0) {
          // 가려던 길이 막힌 것을 눈으로 확인 → 우회할지 치울지 다시 계획한다
          learnQuiet(sim, a, f);
          a.pendingBlock = i; a.path = null; a.pathGoal = -1;
          a.lastBlockEvent = raiseProblem(sim, I, 'PATH_BLOCKED', f.text, { role: 'RESPONDER', actor: me, rid: r.id, imp: 2, text: `기존 접근 경로가 차단되어 있습니다 — ${f.text}.` }, false);
          pushFx(sim, s, 'text', a.x, a.y - 1, undefined, undefined, '경로 차단!', '#ff6b6b', 1.8);
        } else if (told) learnQuiet(sim, a, f);
        else learn(sim, a, f);
      }
    } else if (p.kind === 'gas') {
      if (!p.exploded && d <= 3.5 && !a.beliefs.get('haz', p.id) && los(s, a.x, a.y, p.x, p.y)) learn(sim, a, mkFact('haz', p.id, { kind: 'gas', active: true, x: p.x, y: p.y }, me, sim.t, 1, true, `${regionNameAt(s, p.x, p.y)}에 ${vesselName(p)} 확인 — 폭발 위험`));
      // (X6 §3.3) 터진 용기를 아직 살아 있다고 믿으면 바로잡는다 (예전에는 영영 active 로 남았다)
      else if (p.exploded && d <= v && a.beliefs.get('haz', p.id)?.value.active && los(s, a.x, a.y, p.x, p.y)) learn(sim, a, mkFact('haz', p.id, { kind: 'gas', active: false, x: p.x, y: p.y }, me, sim.t, 1, true, `${vesselName(p)} 폭발 확인`));
    } else if (p.kind === 'unstable' || p.kind === 'valve') {
      if (sniff || (d <= (p.kind === 'valve' ? 4.5 : r.judgment >= 0.45 ? 4 : 2.6) && los(s, a.x, a.y, p.x, p.y))) {
        const active = !p.mitigated && !p.ignited;
        const cur = a.beliefs.get('haz', p.id);
        const where = regionNameAt(s, p.x, p.y);
        const text = p.kind === 'valve' ? (active ? `${where} 배관에서 가스 누출 확인 — 밸브 차단 필요` : p.ignited ? '누출 가스 발화' : '가스 밸브 차단 확인') : active ? `${where} 구조물 균열 확인 — 추가 붕괴 위험, 보강 필요` : '균열부 보강 확인';
        if (!cur || cur.value.active !== active) learn(sim, a, mkFact('haz', p.id, { kind: 'leak', active, x: p.x, y: p.y, sub: p.kind === 'valve' ? 'valve' : 'crack' }, me, sim.t, 1, true, text));      // sub: (R2 §4.3) 밸브·균열을 판단부가 가린다
      }
    } else if (p.kind === 'bomb') {
      // 폭발물로 보이는 물건: 가까이에서 직접 봐야 알아본다
      const active = !p.mitigated && !p.exploded;
      const cur = a.beliefs.get('haz', p.id);
      if (d <= 3.0 && los(s, a.x, a.y, p.x, p.y) && (!cur || cur.value.active !== active)) { p.found = true; learn(sim, a, mkFact('haz', p.id, { kind: 'bomb', active, x: p.x, y: p.y }, me, sim.t, 1, true, active ? `${regionNameAt(s, p.x, p.y)}에서 폭발물로 보이는 물건 발견 — 접근 금지` : '폭발물 위험 해소')); }
    } else if (p.kind === 'vehicle') {
      if (p.leakRate && d <= (r.judgment >= 0.45 ? 2.8 : 1.7)) {
        const active = !p.mitigated && !p.ignited;
        const cur = a.beliefs.get('haz', p.id);
        if (!cur || cur.value.active !== active) learn(sim, a, mkFact('haz', p.id, { kind: 'leak', active, x: p.x, y: p.y, sub: 'fuel' }, me, sim.t, 1, true, active ? '차량 연료 누출 확인 — 발화 위험' : p.ignited ? '누출 연료 발화' : '연료 누출 조치 완료'));
      }
      if (p.emptySeat && d <= 2 && r.judgment >= 0.33 && !a.beliefs.get('evid', p.id)) learn(sim, a, mkFact('evid', p.id, { kind: 'emptySeat' }, me, sim.t, 0.8, true, '운전석이 비어 있음 — 탑승자가 튕겨 나갔을 가능성'));
    } else if (p.kind === 'clue') {
      if (!p.found && d <= detectRadius(sim, s, a, 0.3) && los(s, a.x, a.y, p.x, p.y)) {
        p.found = true;
        learnQuiet(sim, a, mkFact('clue', p.id, { x: p.x, y: p.y, region: p.dirRegion }, me, sim.t, 0.75, true, `${regionNameAt(s, p.x, p.y)}에서 이동 흔적 발견 — ${s.regions[p.dirRegion!].name} 방향`));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: me, rid: r.id, kind: 'action', imp: 1, text: `이동 흔적 발견. ${s.regions[p.dirRegion!].name} 방향으로 이어집니다.` });
        pushFx(sim, s, 'text', p.x, p.y - 0.8, undefined, undefined, '단서', '#ffd166', 1.8);
      }
    } else if (p.kind === 'witness') {
      if (!a.beliefs.get('evid', p.id) && d <= v) learn(sim, a, mkFact('evid', p.id, { kind: 'witness', done: !!p.interviewed }, me, sim.t, 1, true, '현장에 목격자 대기 중'), false);
    }
  }
  // (X6 §3.3) 조짐: 구조 약화·가스 농도·용기 가열·건물 기울어짐 — 감각 범위 안의 것만 (field/catastrophe.ts)
  perceiveSigns(sim, s, a, v);
  // 동료: 쓰러진 동료는 시야 안이면 본다. 안전 구역으로 물러난 동료는 바로 곁(2칸)에서만 살핀다 — 거기서 숨진 동료를 곁의 대원이 알아본다
  for (let bi = 0; bi < s.agents.length; bi++) { const b = s.agents[bi];
    if (b === a || (b.status !== 'down' && b.status !== 'withdrawn')) continue;
    const d = dist(a.x, a.y, b.x, b.y);
    if (d > v || (b.status === 'withdrawn' && d > 2) || !sees(b.x, b.y)) continue;
    const cur = a.beliefs.get('mate', b.rid);
    if (cur && cur.value.dead) continue;      // 숨진 줄 안다 — 멀리서 다시 본 것으로 되돌리지 않는다
    if (b.status === 'down' && d <= SHAKE.mateR && (!cur || cur.value.status !== 'down')) shake(sim, a);      // (R3 §4.3) 6칸 안에서 동료가 쓰러진 것을 처음 본다 — 동요
    const f = mateFact(sim, s, b, b.status === 'down' ? 'down' : 'safe', me, d);
    // 3칸 밖에서는 중증도·사망을 알 수 없다: 상태(쓰러짐·안전 구역)가 달라졌을 때만 새 소식이다 (가까이서 본 동료의 보고를 먼 관찰이 덮어쓰지 않는다)
    if (cur && !(d <= 3 ? significant(f, cur.value) : cur.value.status !== f.value.status)) continue;
    // 쓰러진 것·숨진 것은 말로 알린다. 안전 구역에 있는 동료의 상태는 믿음과 무전 자료로만 보낸다 (물러날 때 본인이 이미 알렸다)
    if (b.status === 'down' || f.value.dead) learn(sim, a, f); else learnQuiet(sim, a, f);
  }
}

const IMPORTANT: Record<string, boolean> = { cas: true, blk: true, hos: true, haz: true, mate: true, evid: true, clue: true, seen: true, secure: true };
/** 바로 알리고 무전 문구에 싣는 사실: IMPORTANT 의 종류, 그리고 (X6 §3.2) 단계 2 이상의 조짐 — 단계 1(삐걱임·냄새)은 묶음 보고(5초)로 보낸다 */
const hot = (f: Fact): boolean => IMPORTANT[f.type] === true || (f.type === 'sign' && f.value.level >= 2)
  || (f.type === 'crew' && crewAlert(f.text) && (f.value.air === 2 || f.value.ammo === 2 || f.value.band >= 1));      // (R3 §4.1) 자기 신고의 공기 위급·탄 위급·중상 — 나빠졌을 때의 글만(나아짐·동요는 글 없이)

/** 무전 송신. 음영 구역에서는 실패한다. */
export function transmit(sim: Sim, s: Scene, a: FieldAgent | null, to: number, kind: RadioMsg['kind'], facts: Fact[], text: string, workId = -1, imp = 1, causes: number[] = [], silent = false): number {
  if (a && !a.aloft && s.shadow[tileOf(s, a.x, a.y)]) return -1;      // 상공의 관측자는 음영 구역의 영향을 받지 않는다
  const I = sim.incidents[s.incidentId];
  let ev = -1;
  if (!silent) {
    const r = a ? resp(sim, a) : null;
    ev = emit(sim, { inc: I.id, role: a ? (a.isCommander ? 'COMMANDER' : 'RESPONDER') : 'DISPATCH', actor: r ? r.name : '관제', rid: r ? r.id : -1, kind: kind === 'order' ? 'command' : 'radio', text, imp, causes });
    if (a) pushFx(sim, s, 'radio', a.x, a.y, undefined, undefined, undefined, undefined, 0.9);
  }
  s.radio.push({ id: s.nextMsgId++, t: sim.t, deliverAt: sim.t + 1.2, from: a ? a.rid : -1, to, kind, facts, workId, text, eventId: ev });
  return ev;
}

export function flushOutbox(sim: Sim, s: Scene, a: FieldAgent): void {
  if (!a.outbox.length) { a.shadowSince = -1; return; }
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  const important = a.outbox.some(hot);
  const prompt = important || a.outbox.some((f) => f.type === 'srch' || f.type === 'ovh');      // 수색·잔불 정리 결과는 바로 알린다
  if (!prompt && sim.t - a.outboxSince < 5) return;
  if (!a.aloft && s.shadow[tileOf(s, a.x, a.y)]) {
    if (a.shadowSince < 0) a.shadowSince = sim.t;
    if (!a.commFailLogged && important && sim.t - a.shadowSince > 1.5 + 7 * (1 - r.experience)) {
      a.commFailLogged = true;
      raiseProblem(sim, I, 'COMM_FAIL', `${r.name}: 무전 음영 구역에서 보고 전달 실패`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, text: `무전 응답 없음. ${regionNameAt(s, a.x, a.y)}은(는) 무전 음영 구역입니다 — 보고가 전달되지 않았습니다.` }, false);
    }
    return;
  }
  // 방금 다른 대원이 같은 내용을 무전으로 알렸으면 반복하지 않는다
  const facts = a.outbox.filter((f) => !s.radio.some((m) => m.kind === 'report' && m.facts.some((g) => sameSig(f, g))));
  a.outbox = [];
  if (!facts.length) { a.quiet.clear(); return; }
  const speak = facts.filter((f) => !a.quiet.has(f.key));
  a.quiet.clear();
  const shown = speak.filter(hot);
  const list = (shown.length ? shown : speak).map((f) => f.text).filter((t, k, arr) => arr.indexOf(t) === k).slice(0, 3).join(' / ');
  const causes: number[] = [];
  if (a.commFailLogged) {
    a.commFailLogged = false;
    const pe = markRecovered(I, 'COMM_FAIL', `${josa(r.name, '이/가')} 음영 구역을 벗어나 ${Math.round(sim.t - a.shadowSince)}초 늦게 보고`);
    causes.push(pe);
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, causes, text: `음영 구역을 벗어나 무전 재개. 지연된 보고를 전달합니다 (${Math.round(sim.t - a.shadowSince)}초 지연).` });
  }
  a.shadowSince = -1;
  transmit(sim, s, a, -1, 'report', facts, list, -1, shown.length ? 1 : 0, causes, speak.length === 0);
}

/** 가까이 있는 동료와는 무전 없이 정보를 주고받는다. */
export function shareNearby(sim: Sim, s: Scene, a: FieldAgent): void {
  if (!a.outbox.length) return;
  for (const b of s.agents) {
    if (b === a || (b.status !== 'active' && b.status !== 'withdrawn')) continue;
    if (dist(a.x, a.y, b.x, b.y) > 2.6 || !los(s, a.x, a.y, b.x, b.y)) continue;
    for (const f of a.outbox) b.beliefs.merge(BeliefStore.relay(f));
  }
}

/** 대원의 믿음에 근거한 이동 비용. 모르는 장애물은 비용에 반영되지 않는다(가다가 발견한다). */
/** escape = 물러나는 길(executor.moveTo): 끌 수 없는 불도 막힌 칸으로 치지 않고 비싼 칸으로 친다 — 불길을 뚫고 나가는 길 */
export function agentCost(sim: Sim, s: Scene, a: FieldAgent, allowBlockers = true, escape = false): CostFn {
  const r = resp(sim, a);
  const u = sim.units[a.unitId];
  // 연기·불을 지나는 값은 부서가 아니라 든 장비가 정한다: 공기호흡기(연기), 방화복(약한 불), 관창(센 불을 끄며 지나간다)
  const scba = hasKit(sim, a.rid, 'scba'), turnout = hasKit(sim, a.rid, 'turnout');
  const canSuppress = hasKit(sim, a.rid, 'hose') && !u.pumpFailed && (u.water > 0 || u.hydrant);
  // 공기호흡기가 없는 대원은 화재·가스·붕괴 현장의 건물 안을 가로질러 가지 않는다 (돌아갈 길이 있으면 돌아간다 — 안에 볼일이 있는 일은 fitFor 가 먼저 막는다)
  const shun = !scba && TYPE_DEFS[s.kind].indoorRisk;
  const ax = a.x, ay = a.y;
  const v = Math.min(5, visionOf(sim, s, a));
  // 판단력이 낮으면 장애물 제거 시간을 잘못 추정한다
  const est = 1 + (a.rng.next() - 0.5) * (1 - r.judgment) * 0.9;
  const clearCost = (22 / (0.5 + r.skills.rescue * 0.8 + toolFor(sim, a.rid, 'clear') * 0.5)) * est;
  const forceCost = (15 / (0.6 + r.skills.rescue * 0.6 + toolFor(sim, a.rid, 'force') * 0.6 + r.skills.law * 0.3)) * est;
  // (X6 §5.1) 믿음 속 지휘 상태의 단계 3 구역(철수) 칸은 지나갈 수 없다 — 지나가다 철수 의무에 걸려 "들어감 → 철수 → 다시 배정"을 되풀이하지 않게.
  // 철수 중·제한적 구조 진입(risky)을 맡음·업고 있음·지금 그 구역 안에 서 있는 대원은 예외(나가는 길을 막지 않는다). 피하는 곳(a.avoid — 조짐을 보고 물러난 곳)은 +20
  let zm: Uint8Array | null = null;
  const opsV = a.beliefs.val<OpsFact>('ops', OPS_ID);
  if (opsV && opsV.zones && opsV.zones.length) {
    const tk = a.task;
    const exempt = a.carrying !== -1 || (tk !== null && (tk.kind === 'evacuate' || (tk.workId >= 0 && s.board[tk.workId] !== undefined && s.board[tk.workId].risky === true)));
    if (!exempt) { const m = zoneMask(s, opsV.zones); if (m[tileOf(s, a.x, a.y)] < 3) zm = m; }
  }
  const av = a.avoid !== undefined && a.avoid.until > sim.t ? a.avoid : null;
  const bz = bombZone(s, a);      // (R3 5단계 S08) 해체가 진행 중인 장치의 반경 (해체·출입 통제·반경 밖으로 옮기는 일이 아니면 +20)
  return (i: number): number => {
    const t = s.tiles[i];
    if (!staticPass(t)) return -1;
    if (zm !== null && zm[i] >= 3) return -1;
    let c = t === T.TREE ? 0.7 : 0;
    if (av !== null && inAvoid(s, av, i)) c += 20;
    if (bz !== null) { const dx = (i % s.w) - bz.x, dy = ((i / s.w) | 0) - bz.y; if (dx * dx + dy * dy <= bz.r * bz.r) c += 20; }
    if (shun) { const rg = s.region[i]; if (rg >= 0 && s.regions[rg].indoor) c += 6; }
    const b = a.beliefs.get('blk', i);
    if (b && b.value !== 'none') {
      if (!allowBlockers) return -1;
      if (b.value === 'debris') c += clearCost; else if (b.value === 'locked') c += forceCost; else return -1;
    } else if (s.propAt[i] >= 0) {
      const p = s.props[s.propAt[i]];
      if (p.kind !== 'door' && p.kind !== 'debris') return -1;      // 눈에 보이는 고정 장애물 (차량, 배관 등). 문과 잔해만 "가 봐야 아는" 장애물이다
    }
    const x = i % s.w, y = (i / s.w) | 0;
    const dx = x - ax, dy = y - ay;
    if (dx * dx + dy * dy <= v * v) {
      const f = s.fire[i];
      if (f > 0.5) { if (!canSuppress && !escape) return -1; c += 16; } else if (f > 0.12) c += turnout ? 2 : 6;
      c += s.smoke[i] * (scba ? 0.8 : 3);
    }
    return c;
  };
}

/**
 * (R3 §3.4 S08 — 5단계) 해체가 진행 중인 장치의 반경: 믿음 속 살아 있는 장치 곁(2칸)에서 동료의 해체 임무가 진행 중이면(동료의 겉) 그 장치 둘레 6칸.
 * 해체·출입 통제를 맡았거나 사람을 반경 밖으로 옮기는 중(이송·대피 안내·동료 구조)이면 없다(null). 걸어서 지나가는 비용에 +20 (교본 doctrine.ts 의 sit.defusing 과 같은 판정)
 */
function bombZone(s: Scene, a: FieldAgent): { x: number; y: number; r: number } | null {
  const tk = a.task;
  if (tk !== null && (tk.kind === 'defuse' || tk.kind === 'perimeter' || tk.kind === 'carry' || tk.kind === 'escort' || tk.kind === 'rescueMate')) return null;
  const hz = a.beliefs.list('haz');
  for (let k = 0; k < hz.length; k++) {
    const v = hz[k].value as { kind: string; active: boolean; x: number; y: number };
    if (v.kind !== 'bomb' || !v.active) continue;
    for (let j = 0; j < s.agents.length; j++) { const b = s.agents[j]; if (b !== a && b.status === 'active' && b.task !== null && b.task.kind === 'defuse' && (dist(b.x, b.y, v.x, v.y) <= 2 || (b.task.method === 'robotDefuse' && b.task.phase >= 1))) return { x: v.x, y: v.y, r: 6 }; }
  }
  return null;
}
/** (X6 §5.1) 칸 i 가 피하는 곳(구획 목록 또는 원) 안인가 */
export function inAvoid(s: Scene, av: NonNullable<FieldAgent['avoid']>, i: number): boolean {
  if (i < 0) return false;
  if (av.r > 0) { const dx = (i % s.w) - av.x, dy = ((i / s.w) | 0) - av.y; if (dx * dx + dy * dy <= av.r * av.r) return true; }
  const rg = regionAt(s, i);
  return rg >= 0 && av.regions.indexOf(rg) >= 0;
}

export function hasWork(a: FieldAgent): boolean { return a.task !== null && a.task.kind !== 'standby'; }

/**
 * 실패를 기억하는 시간(초). 닿지 못했거나(경로 없음·화염) 위험해서 내려놓은 작업은 이 시간 동안 같은 대원에게 다시 맡기지 않고,
 * 그 대원도 스스로 다시 고르지 않는다. 기억이 없으면 "시도 → 실패 → 재지시"를 1초 간격으로 되풀이한다.
 */
export const RETRY_AFTER = 25;
export function failedRecently(sim: Sim, w: WorkItem, rid: number): boolean { const t = w.failedAt[rid]; return t !== undefined && sim.t - t < RETRY_AFTER; }
/** 부상으로 더는 임무를 맡을 수 없는 체력 (injury.HURT_AT — 후퇴 기준은 injury.mustRetreat: 이 체력 아래이거나 출혈이 클 때) */
export const HURT_HEALTH = HURT_AT;

/** sim 을 주면 다친 동료의 이름을 넣는다 ('○○ 대원 응급 처치') — 지시·기록을 남기는 시뮬레이션 쪽이 준다. 화면은 주지 않아도 된다 */
export function workLabel(s: Scene, w: WorkItem, sim?: Sim): string {
  const reg = w.region >= 0 ? s.regions[w.region].name : '';
  const cas = w.cas >= 0 ? `구조 대상 ${s.casualties[w.cas].label}` : '';
  const hos = w.hostile >= 0 && s.hostiles[w.hostile] ? s.hostiles[w.hostile].label : '용의자';      // 용의자가 여럿인 현장에서 지시가 누구를 가리키는지 (구조 대상의 이름표와 같이)
  const names: Record<WorkKind, string> = {
    sizeup: '현장 평가', search: `${reg} ${w.thorough ? '정밀 ' : ''}수색`, suppress: `${reg} 화재 진압`, hookup: '소화전 연결', clear: '잔해 제거', force: '문 강제 개방',
    extricate: `${cas} 구출`, treat: `${cas} 응급 처치`, carry: `${cas} 이송`, load: `${cas} 구급차 탑승`, traffic: '교통 통제',
    mitigate: w.prop < 0 ? `${reg ? reg + ' ' : ''}가스 재측정`      // (X6 §5.7) 칸만 있는 작업
      : s.props[w.prop] && s.props[w.prop].kind === 'gas' ? (s.props[w.prop].skin === 'drum' ? '드럼통 냉각' : '가스 용기 냉각')      // (X6 §5.8)
      : s.props[w.prop] && s.props[w.prop].kind === 'unstable' ? '균열부 보강' : s.props[w.prop] && s.props[w.prop].kind === 'valve' ? '가스 밸브 차단' : '연료 누출 조치',
    perimeter: s.kind === 'hazmat' ? `${w.tile === 0 ? '앞쪽' : '뒤쪽'} 출입구 통제` : `${exitName(s, w.tile)} 봉쇄`, negotiate: `${hos} 협상`, engage: `${hos} 대응`, arrest: `${hos} 검거`, interview: '목격자 면담', clearRoad: '도로 정리', rescueMate: '동료 구조', waterRescue: `${cas} 수난 구조`, escort: `${cas} 동행`,
    defuse: '폭발물 해체', overhaul: `${reg} 잔불 정리`,
    hoist: `${cas} 호이스트 인양`, airDrop: `${reg} 공중 물 투하`,
    treatMate: sim && w.mate >= 0 && sim.responders[w.mate] ? `${sim.responders[w.mate].name} 대원 응급 처치` : '부상 대원 응급 처치',
    treatSuspect: `${hos} 응급 처치`,
    repair: '시설물 복구', towAway: '차량 견인', capture: '동물 포획', persuade: `${cas} 설득`, cordon: '통제',      // (N8) 이름만 — 대상의 글자는 그 임무를 쓰는 단계가 다듬는다
    decontam: '제독',      // (N9 §5.5) 이름만 — 대상의 글자는 그 임무를 쓰는 단계 6 이 다듬는다
    triage: '다수 사상자 분류',      // (R3 4단계 E01·CE1)
  };
  return names[w.kind];
}

/** 이 대원이 이 작업을 맡을 수 있는가, 맡는다면 얼마나 적합한가 (0 = 불가). */
/** 출입구의 이름. 길 위의 현장에서는 길의 양 끝이다. */
export function exitName(s: Scene, k: number): string { return s.outdoor ? (k === 0 ? '서쪽 길목' : '동쪽 길목') : k === 0 ? '정문' : '후문'; }

/** 환자를 싣고 병원으로 갈 수 있는가: 환자 자리(crews.seatsOf — 구급차 2, 헬기 1)가 남았다. 자리의 수를 따로 적지 않는다. 쓰인 자리는 crews.seatsUsed (구조 대상 + 다른 부대의 다친 대원·용의자) */
export function canCarryPatients(sim: Sim, u: Unit): boolean { return seatsUsed(sim, u) < seatsOf(u); }

/** 그 부대에서 펌프를 맡은 대원(펌프 조작 장비를 든 기관원·사다리 조작원)이 지금 현장에서 활동 중인가 — 자기 조직의 상태라 지휘관·대원이 알아도 된다 */
export function pumpOperatorOn(sim: Sim, s: Scene, unitId: number): boolean {
  for (const b of s.agents) if (b.unitId === unitId && b.status === 'active' && hasKit(sim, b.rid, 'pumpPanel')) return true;
  return false;
}

/**
 * 맡을 수 있는 일은 든 장비가 정한다 (R1 6.2): 위험한 건물 안은 공기호흡기, 진압·잔불 정리는 관창, 봉쇄·교전은 총기, 해체는 해체 공구.
 * 장비 판정은 모두 hasKit·toolFor(알려진 고장만 뺀다)다 — 숨은 고장이 있는 대원의 적합도는 고장이 없는 대원과 같아야 한다(숨은 고장이 배정에 새지 않게).
 * 공기(R1 9절): 남은 공기가 문턱(45초) 아래인 대원은 위험한 건물 안의 일(수색·구출·이송)과 진압·잔불 정리를 새로 맡지 않는다(crews.airShort —
 * 자기 장비의 알려진 상태다). 그 일을 맡을 사람이 현장에 없어지면 지휘관의 "맡을 사람이 없는 작업" 요청(commander.anyCapable)이 부대를 부른다.
 * 역할이 먼저 맡는 일(+)·피하는 일(−)은 맡을 수 있을 때만 더한다. 0 이던 것은 0 으로 남는다(선호가 자격을 만들지 않는다).
 */
export function fitFor(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem, afterSwap = false): number {
  // (R2 1b §3.4) 물 위의 대원(헤엄 중·보트 위)은 지금 맡은 수난 구조 말고는 맡지 않는다 — 지시를 받아도 따르지 않으므로(brain 의 물 위 가드) 지시 수신함에 묶여 남이 그 일을 못 맡는 일을 막는다
  if ((a.afloat !== undefined || onWater(s, a)) && !(w.kind === 'waterRescue' && a.task !== null && a.task.workId === w.id)) return 0;
  const fit = fitBase(sim, s, a, w, afterSwap);
  const f = fit > 0 ? Math.max(0.02, fit + (roleOf(sim, a.rid).prefer[w.kind] ?? 0)) : fit;
  // (R3) 교본은 맨 끝에서 좁히기만 한다 (늘 보고 모드 — 줄이 없으면 그대로). (3단계) afterSwap(지휘관의 "예비 공기통으로 바꾸면 맡을 사람이 있는가" — anyCapable)은
  // 교본을 보지 않는다: 공기 50% 문턱(F03)과 짝의 공기(F04)가 통을 바꾼 뒤의 어림까지 막아 관창수가 통을 바꾸러 나간 사이에 진압 부대를 더 불렀다
  return afterSwap ? f : docFit(sim, s, a, w, f);
}
/**
 * (R3 §2.7) fitFor 와 같은 값(fit)에 더해 교본 전의 값(base)과 걸린 교본 줄(hits) — 지휘관의 배정(commander.assign)이 "교본이 배정을 바꿨는가"를 1등 둘로 견줄 때 쓴다.
 * 상태를 바꾸지 않는다. fit 은 늘 fitFor(sim, s, a, w) 와 같다
 */
export function fitParts(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem): DocFitAns {
  if ((a.afloat !== undefined || onWater(s, a)) && !(w.kind === 'waterRescue' && a.task !== null && a.task.workId === w.id)) return { fit: 0, base: 0, hits: [] };
  const fit = fitBase(sim, s, a, w, false);
  return docFitRules(sim, s, a, w, fit > 0 ? Math.max(0.02, fit + (roleOf(sim, a.rid).prefer[w.kind] ?? 0)) : fit);
}
/**
 * (N8 §5.3.3) 유관 기관 대원이 맡는 일: 시설물 복구(repair — 대상의 생김새에 맞는 장비: 전선 = 절연 장비, 관·밸브 = 밸브 키 또는 누출 차단 장비)와 견인(towAway — 견인 장비).
 * 그 밖은 0 (그대로 두면 수색·이송·처치를 맡는다). 오는 쪽의 판정 crews.capableOf(…, what) 와 같은 조건이다. 생김새(skin, 없으면 kind)는 판단부가 읽어도 되는 것이다
 */
function civilFit(sim: Sim, s: Scene, rid: number, w: WorkItem): number {
  if (w.kind === 'towAway') return hasKit(sim, rid, 'towKit') ? 0.8 : 0;
  if (w.kind !== 'repair') return 0;
  const p = w.prop >= 0 ? s.props[w.prop] : undefined, what = p ? p.skin ?? p.kind : undefined;
  const ok = what === 'wire' ? hasKit(sim, rid, 'insulKit') : what === 'pipe' || what === 'valve' ? hasKit(sim, rid, 'valveKey') || hasKit(sim, rid, 'plugKit') : false;
  return ok ? 0.7 + 0.3 * sim.responders[rid].skills.rescue : 0;
}
/** 공기가 되는가: 문턱 아래가 아니다 (공기호흡기가 없는 대원은 해당 없음). afterSwap 이면 통을 바꾼 뒤로 보고 따지지 않는다 */
const airOk = (sim: Sim, rid: number, afterSwap: boolean): boolean => afterSwap || !airShort(sim, rid);
/** 연기 속에 들어갈 수 있는가: 공기호흡기를 멨고 공기가 된다 */
const scbaOk = (sim: Sim, rid: number, afterSwap: boolean): boolean => hasKit(sim, rid, 'scba') && airOk(sim, rid, afterSwap);
/** afterSwap = 공기통을 바꾼 뒤라면 (공기 문턱을 보지 않는다 — 지휘관이 "예비 공기통으로 바꾸면 맡을 수 있는 사람이 있는가"를 볼 때만 쓴다) */
function fitBase(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem, afterSwap: boolean): number {
  const r = resp(sim, a), u = sim.units[a.unitId], rid = a.rid;
  if (r.dept === 'civil') return r.status === 'injured' ? 0 : civilFit(sim, s, rid, w);      // (N8 §5.3.3) 유관 기관은 자기 일만 (다치면 가벼운 일도 없다 — 그 목록에 자기 일이 없다)
  // (X6 §5.3·§5.1·§5.6) 진입 금지 구역의 문을 안전망으로 (이미 맡은 일이 구역 안이 되면 0 — 단계 2 의 허락된 일, 단계 3 의 밖에서 하는 진압·냉각은 예외),
  // 조짐을 보고 물러난 곳(a.avoid — 30초), 제한적 구조 진입(risky — 건강한 소방 대원만: 공기호흡기·명부의 지구력 40 이상)
  if (s.ops !== undefined || a.avoid !== undefined || w.risky) {
    if (s.ops !== undefined && gateBlocks(sim, s, a, w.kind, w)) return 0;
    if (w.risky && (!scbaOk(sim, rid, afterSwap) || r.stamina < 40)) return 0;
    if (a.avoid !== undefined && a.avoid.until > sim.t) { const ti = targetTile(s, a, w.kind, w); if (ti === -2 ? a.avoid.regions.indexOf(w.region) >= 0 : inAvoid(s, a.avoid, ti)) return 0; }
    // 단계 2 구역 안의 구조 대상·동료를 데려오는 일은 위험한 건물 실내와 같은 자격(공기호흡기)으로만 (§5.3 — 몸 상태는 보고된 것만: R3 전에는 H1 의 물러남에 맡긴다)
    if (s.ops !== undefined && s.ops.zones.length && (w.kind === 'carry' || w.kind === 'extricate' || w.kind === 'waterRescue' || w.kind === 'rescueMate') && !scbaOk(sim, rid, afterSwap)) {
      const ti = targetTile(s, a, w.kind, w);
      if (ti >= 0 && (zoneLevelAt(s, s.ops.zones, ti) >= 2 || regionLevel(s.ops.zones, regionAt(s, ti)) >= 2)) return 0;
    }
  }
  const hot = s.kind === 'armed' && s.secureAt < 0;
  const indoorRisk = TYPE_DEFS[s.kind].indoorRisk;      // 위험한 건물의 유형 (incidentTypes — 화재·가스 누출·붕괴)
  const fireRisk = (regionId: number): boolean => regionId >= 0 && ((a.beliefs.val<number>('fire', regionId) ?? 0) > 0.25 || indoorRisk || inRubble(s, regionId));      // 불이 났거나, 가스가 찼거나, 무너질 수 있는 건물 안, (X6 §6.1) 무너진 잔해 구역은 공기호흡기를 멘 대원만 들어간다
  // 걸을 수 있는 다친 대원은 가벼운 일만 맡는다 (H1 §2.5 — 사용자 결정 2026-11-15 "가벼운 일은 계속"). 조직이 아는 상태(status — RESPONDER_HURT 로 알렸다)만 본다:
  // 남에게도 불리는 함수라 체력·출혈은 읽지 않는다. 목록(injury.LIGHT_WORK) 안의 일도 자리가 위험 구역(불·가스·붕괴의 건물 안, 안전 확보 전의 무장 현장 건물 안)이면 맡지 않고,
  // 처치는 대상이 안전 구역에 나와 있을 때만 돕는다. 현장 평가는 지휘의 일이라 다친 지휘관도 한다(위험 구역 밖에서 본다 — 못 하면 그 현장은 끝나지 않는다)
  if (r.status === 'injured' && w.kind !== 'sizeup') {
    if (!LIGHT_WORK.has(w.kind)) return 0;
    const risky = (x: number, y: number): boolean => { const rg = s.region[tileOf(s, x, y)]; return rg >= 0 && s.regions[rg].indoor && (hot || fireRisk(rg)); };
    if (w.kind === 'treat') { const cb = a.beliefs.val<CasBelief>('cas', w.cas); if (!cb || cb.where !== 'safe') return 0; }
    else if (w.kind === 'treatMate') { const mb = a.beliefs.val<MateBelief>('mate', w.mate); if (!mb || mb.status !== 'safe') return 0; }
    else if (w.kind === 'perimeter') { const e = s.exits[w.tile]; if (e && risky(e.x, e.y)) return 0; }
    else if (w.kind === 'interview') { const p = s.props[w.prop]; if (p && risky(p.x, p.y)) return 0; }
  }
  switch (w.kind) {
    case 'sizeup': return a.isCommander ? 1 : 0;
    case 'search':
      if (hot && !(r.dept === 'police' && hasFirearm(sim, rid))) return 0;
      if (s.regions[w.region].indoor && fireRisk(w.region) && !scbaOk(sim, rid, afterSwap)) return 0;
      return 0.45 + 0.3 * r.experience + 0.25 * r.judgment + (r.dept === 'police' && s.kind !== 'fire' && s.kind !== 'medical' ? 0.1 : 0) + (r.dept === 'ems' && s.kind === 'medical' ? 0.15 : 0);
    case 'suppress': {
      // 관창을 든 사람만 물을 쏜다 (공기가 문턱 아래면 통을 바꾼 뒤에) — 이때는 내부 공격(외부 방어면 외부 방수)을 늘 고를 수 있다 (R2 methodFit 과 같은 답 — 계산을 아낀다)
      const hose = hasKit(sim, rid, 'hose') && !u.pumpFailed && (u.water > 0 || u.hydrant);
      if (hose && airOk(sim, rid, afterSwap)) return r.skills.fire;
      // (R2 §4.5) 그 밖은 그 사람이 지금 고를 수 있는 진압 방법으로: 공기가 문턱 아래인 관창수의 외부 방수(사람이 없다고 확인된 큰 불), 관창이 없는 대원(경찰·구급·기관원)의 소화기(작은 불) 0.25
      return methodFit(sim, s, a, w) > 0 ? (hose ? r.skills.fire : 0.25) : 0;
    }
    case 'hookup':
      if (r.dept !== 'fire' || a.unitId !== w.prop) return 0;
      // 그 부대에서 펌프를 맡은 대원(기관원·사다리 조작원)이 활동 중이면 급수 연결은 그 사람의 일이다. 없거나 쓰러졌으면 그 부대의 누구나 한다
      return hasKit(sim, rid, 'pumpPanel') || !pumpOperatorOn(sim, s, a.unitId) ? 0.8 : 0;
    case 'clear': return 0.3 + r.skills.rescue * 0.5 + toolFor(sim, rid, 'clear') * 0.3;
    case 'force': return 0.3 + r.skills.rescue * 0.5 + toolFor(sim, rid, 'force') * 0.3;
    case 'extricate': {
      if (!scbaOk(sim, rid, afterSwap)) {
        if (s.kind === 'collapse' || s.kind === 'hazmat') return 0;
        // 불이 난 건물 안에 갇힌 사람도 같다: 믿음 속 자리가 위험한 건물 안이면 공기호흡기를 멘 대원만 들어가 구출한다 (수색·이송과 같은 검사)
        const cb = a.beliefs.val<CasBelief>('cas', w.cas);
        if (!cb && (s.kind === 'fire' || isRubbleMode(s))) return 0;      // 어디에 있는지 아직 전달받지 못했다 — 불이 난 건물 안(X6 §6.1: 무너진 잔해 속)일 수 있다
        if (cb) { const rg = s.region[cb.y * s.w + cb.x]; if (rg >= 0 && s.regions[rg].indoor && fireRisk(rg)) return 0; }
      }
      const f = r.skills.rescue * (0.35 + 0.65 * toolFor(sim, rid, 'extricate'));
      return f >= 0.2 || sim.t - w.createdAt > 25 ? Math.max(0.05, f) : 0;
    }
    case 'treat': {
      // (R3 E05) 안전 확보 전의 무장 현장: 현장 안의 환자는 경찰만 — 안전 구역(경계 밖 처치소)에 나와 있다고 믿는 환자는 누구나 처치한다 (교본은 0 인 자격을 열 수 없어 기본 규칙을 고친다)
      if (hot && r.dept !== 'police' && a.beliefs.val<CasBelief>('cas', w.cas)?.where !== 'safe') return 0;
      const cb = a.beliefs.val<CasBelief>('cas', w.cas);
      if (cb && cb.tq >= 1 && r.dept !== 'ems') return 0;      // 기본 처치가 끝난 환자는 구급대원만 더 손볼 수 있다
      return Math.max(0.08, r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, rid)));
    }
    case 'carry': case 'escort': {
      if (hot && r.dept !== 'police') return 0;
      const cb = a.beliefs.val<CasBelief>('cas', w.cas);
      if (!cb && indoorRisk && !scbaOk(sim, rid, afterSwap)) return 0;      // 어디에 있는지 아직 전달받지 못했다 — 위험한 건물 안일 수 있다
      // 누가 옮기는 중('carried')이어도 믿음 속 자리로 같은 검사를 한다: 공기호흡기 없는 대원이 이송 보조로 위험한 건물 안에 따라 들어가지 않게
      if (cb && (cb.where === 'scene' || cb.where === 'carried')) { const rg = s.region[cb.y * s.w + cb.x]; if (rg >= 0 && s.regions[rg].indoor && fireRisk(rg) && !scbaOk(sim, rid, afterSwap)) return 0; }
      return 0.4 + 0.4 * r.fitness + (hasKit(sim, rid, 'stretcher') ? 0.1 : 0);
    }
    case 'load': return canCarryPatients(sim, u) && a.unitId === w.prop ? 1 : 0;
    case 'traffic': return r.dept === 'police' ? 1 : 0.45;
    case 'mitigate': {
      // (X6 §5.7) 가스 재측정(소품 없이 문턱 칸만): 가스 측정기를 든 대원만 — 그 칸에 서면 perceiveSigns 가 읽는다
      if (w.prop < 0) return w.tile >= 0 && hasKit(sim, rid, 'gasMeter') ? 0.6 + 0.4 * r.experience : 0;
      // (X6 §5.8) 가스 용기·드럼통의 냉각: 진압과 같은 자격 (관창을 들고 물·펌프가 된다)
      if (s.props[w.prop] && s.props[w.prop].kind === 'gas') return hasKit(sim, rid, 'hose') && airOk(sim, rid, afterSwap) && !u.pumpFailed && (u.water > 0 || u.hydrant) ? r.skills.fire : 0;
      const shore = w.prop >= 0 && s.props[w.prop] && s.props[w.prop].kind === 'unstable';
      const k = shore ? r.skills.rescue : r.skills.fire;
      return k >= 0.3 ? k + (!shore && hasKit(sim, rid, 'plugKit') ? 0.2 : 0) : 0;      // 누출 차단 장비는 밸브·연료 누출에 쓴다 (균열부 보강은 아니다)
    }
    case 'perimeter': case 'engage': return r.dept === 'police' && hasFirearm(sim, rid) ? 0.5 + r.skills.law * 0.5 : 0;
    case 'arrest': return r.dept === 'police' && (hasFirearm(sim, rid) || hasKit(sim, rid, 'taser')) ? 0.5 + r.skills.law * 0.5 : 0;
    case 'negotiate': return r.dept === 'police' ? 0.3 + r.composure * 0.35 + r.experience * 0.35 : 0;
    case 'interview': return r.dept === 'police' ? 1 : 0.6;
    case 'clearRoad': return r.dept === 'ems' ? 0 : 0.4 + r.skills.rescue * 0.4;
    case 'rescueMate': {
      if (rid === w.mate) return 0;      // 자기 자신을 구조하지 못한다
      if (hot && r.dept !== 'police') return 0;      // 안전 확보 전의 무장 현장: 경찰만 들어간다
      // 불·가스·붕괴 위험 구역 안에 쓰러진 동료: 공기호흡기를 멘 대원만 들어간다 (구하러 들어간 대원이 다시 쓰러지는 연쇄를 막는다). 구역은 믿음 속 위치로 본다
      const mb = a.beliefs.val<MateBelief>('mate', w.mate);
      if (mb) { const rg = s.region[mb.y * s.w + mb.x]; if (rg >= 0 && s.regions[rg].indoor && fireRisk(rg) && !scbaOk(sim, rid, afterSwap)) return 0; }
      if (mb && mb.trapped && r.skills.rescue < 0.3) return 0;      // (X6 §4.8) 잔해에 깔린 동료: 잔해를 들어낼 줄 아는 대원만 (구출 능력 0.3 이상)
      return 0.5 + r.fitness * 0.3 + r.teamwork * 0.2;
    }
    case 'waterRescue': {
      // (R2 1a) 장비 항은 그 사람이 지금 쓸 수 있는 가장 좋은 방법의 점수 (methodFit — 알려진 고장만 본다). 쓸 방법이 없으면 맡지 않는다
      const best = methodFit(sim, s, a, w);
      return best > 0 ? 0.22 + r.skills.rescue * 0.5 + Math.min(1, best) * 0.28 : 0;
    }
    // (R3 §3.7 S06 — 5단계) 해체 공구를 든 처리 요원 · 작동하는 로봇을 든 로봇 조작 요원(로봇 원격 해체로만). 쓸 해체 방법이 있을 때만 (WORK_MODE 'refuse' — 다친·동요한 처리 요원, 로봇이 고장 난 조작 요원은 맡지 않는다)
    case 'defuse': return (hasKit(sim, rid, 'eodKit') || hasKit(sim, rid, 'robot')) && methodFit(sim, s, a, w) > 0 ? 0.6 + 0.4 * r.skill : 0;
    case 'overhaul': return hasKit(sim, rid, 'hose') && airOk(sim, rid, afterSwap) ? 0.4 + 0.6 * r.skills.fire : 0;      // 불씨를 만나면 분사한다: 관창을 든 사람만 (공기가 문턱 아래면 통을 바꾼 뒤에)
    case 'hoist': case 'airDrop': return 0;      // 공중 임무: 지상 대원은 맡지 않는다 (상공의 헬기가 field/rules/air.ts 에서 가져간다)
    case 'treatMate': {
      if (rid === w.mate) return 0;      // 다쳐 물러나는 구급대원이 자기 자신을 맡지 않는다
      // 구급 분야이거나 의료 가방을 든 대원 (항공 구조대원 …)
      if (r.dept !== 'ems' && !hasKit(sim, rid, 'bag') && !hasKit(sim, rid, 'alsBag') && !hasKit(sim, rid, 'doctorKit')) return 0;
      const mb = a.beliefs.val<MateBelief>('mate', w.mate);
      if (hot && !(mb && mb.status === 'safe')) return 0;      // 안전 확보 전의 무장 현장: 안전 구역에 나와 있는 동료만 본다 (교전 중인 건물 안으로 구급대원을 보내지 않는다)
      // 불·가스·붕괴 위험 구역 안의 동료: 공기호흡기를 멘 대원만 들어간다 (구역은 믿음 속 위치로 본다 — 동료 구조와 같다)
      if (mb) { const rg = s.region[mb.y * s.w + mb.x]; if (rg >= 0 && s.regions[rg].indoor && fireRisk(rg) && !scbaOk(sim, rid, afterSwap)) return 0; }
      // 태울 차가 정해진 일: 이미 처치를 받은 동료를 그 차로 옮기는 것은 그 차의 대원만 한다 (다른 부대의 대원은 처치까지만)
      const own = w.prop >= 0 && a.unitId === w.prop;
      if (w.prop >= 0 && !own && (!mb || mb.tq >= 1)) return 0;
      // 기본 처치를 이미 받은 동료를 다시 보는 것은 전문 처치를 할 수 있는 대원만 (자기 능력과 든 장비로 어림한다). 자기 차에 태우러 가는 일이면 처치 수준과 상관없다
      if (mb && mb.tq >= 1 && !own && treatPlan(sim, s, rid, 100) < 0.6) return 0;
      return Math.max(0.08, r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, rid))) * (w.prop >= 0 && !own ? 0.7 : 1);
    }
    case 'treatSuspect': {
      // 쓰러진·다친 용의자의 처치 (H1 §4.3): 경찰은 언제든(기본 처치), 구급대원은 안전 확보 뒤에만 (구조 대상의 처치와 같은 hot 술어 — 교전 중인 건물 안으로 구급대원을 보내지 않는다)
      if (r.dept !== 'police' && !(r.dept === 'ems' && !hot)) return 0;
      const hv = a.beliefs.val<{ x: number; y: number; tq?: number }>('hos', w.hostile);
      // 불·가스·붕괴 위험 구역 안의 용의자: 공기호흡기를 멘 대원만 들어간다 (구역은 믿음 속 위치로 본다 — 동료 구조와 같다)
      if (hv) { const rg = s.region[tileOf(s, hv.x, hv.y)]; if (rg >= 0 && s.regions[rg].indoor && fireRisk(rg) && !scbaOk(sim, rid, afterSwap)) return 0; }
      // 태울 차가 정해진 일: 이미 처치를 받은 용의자를 그 차로 옮기는 것은 그 차의 대원만 한다 (다른 부대의 대원은 처치까지만)
      const own = w.prop >= 0 && a.unitId === w.prop;
      const tq = hv ? hv.tq ?? 0 : 0;
      if (w.prop >= 0 && !own && tq >= 1) return 0;
      // 기본 처치를 이미 받은 용의자를 다시 보는 것은 전문 처치를 할 수 있는 대원만 (같은 처치와 같은 보고를 주고받지 않게). 자기 차에 태우러 가는 일이면 처치 수준과 상관없다
      if (tq >= 1 && !own && treatPlan(sim, s, rid, 100) < 0.6) return 0;
      return Math.max(0.08, r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, rid)));
    }
    // (N8 단계 2a) 새 임무 다섯의 자리 — 맡는 사람은 그 임무를 쓰는 단계가 정한다(repair 4a · towAway 6b · capture 5 · persuade 7 · cordon 4a, 설계서 §5.3.3·§5.10).
    // 지금은 아무도 이 작업을 만들지 않고, 누구도 맡지 않는다
    case 'repair': case 'towAway': case 'capture': case 'persuade': case 'cordon': return 0;
    // (N9 단계 1) 제독의 자리 — 맡는 사람(제독 장비 1.0 · 역할 decon 0.7 · 120초 뒤 호스를 든 소방 0.4)은 단계 6 이 정한다(설계서 §5.3.5). 지금은 아무도 이 작업을 만들지 않는다
    case 'decontam': return 0;
    // (R3 4단계 E01·CE1) 다수 사상자 분류: 구급 대원만 (안전 확보 전의 무장 현장에서는 내지 않는다 — 지휘 교본 CE1 과 같은 자격, doctrine.triageMedic). 다친 대원은 가벼운 일 목록 밖이라 위에서 0
    case 'triage': return !hot && triageMedic(sim, rid) ? Math.max(0.08, r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, rid))) : 0;
  }
}

export function inShadow(s: Scene, a: FieldAgent): boolean { return s.shadow[tileOf(s, a.x, a.y)] === 1; }
export function nearDoor(s: Scene, i: number): boolean { return doorAt(s, i) !== null; }

// ── (R3) 대응 교본의 판단부 (field/doctrine.ts) — fitFor 의 맨 끝이 부른다. doctrine.ts 는 이 파일을 import 하지 않는다(순환 없음).
//    (import 를 파일 끝에 둔 것은 위의 import 묶음을 다른 묶음이 함께 고치고 있어서다) ──
import { docFit, docFitRules } from './doctrine';
import { triageMedic } from './doctrine';      // (R3 4단계) 분류를 맡을 수 있는 대원 — 지휘 교본 CE1 과 같은 자격
import type { DocFitAns } from './doctrine/registry';
import { SHAKE, crewAlert, shake } from './doctrineRun';      // (R3 1단계) 쓰러진 동료를 본 동요
// (R2 1a) 대응 방법의 판단부 — 수난 구조의 배정(fitFor)이 methodFit 을 쓴다. methods.ts 는 이 파일을 import 하지 않는다 (순환 없음)
import { methodFit, onWater, searchMul } from './methods';
// (X6) 조짐 관찰 (field/catastrophe.ts — 그 파일도 이 파일의 learn·regionNameAt 을 쓴다. 함수 안에서만 서로 부르므로 순환 import 는 문제없다)
import { perceiveSigns, vesselName } from './catastrophe';
// (X6 단계 5) 지휘 상태의 도움 함수 (진입 금지 구역·문·피하는 곳 — 진실을 읽지 않는다)
import { OPS_ID, SIGN_BASE, gateBlocks, inRubble, isRubbleMode, regionAt, regionLevel, targetTile, zoneLevelAt, zoneMask } from './ops';
import type { OpsFact } from './ops';
