// AgentManager — 대원의 인지(Perception), 믿음 갱신(Belief Update), 무전(Communication).
// 대원은 시야 안에서 직접 본 것과 무전/대면으로 전달받은 것만 안다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { T } from '../types';
import type { CasBelief, Casualty, Fact, FieldAgent, Hostile, Incident, RadioMsg, Responder, Scene, Unit, WorkItem, WorkKind } from '../types';
import { TYPE_NAME, clamp, dist, josa, pct } from '../util';
import type { Rng } from '../rng';
import { airShort, hasFirearm, hasKit, kitLive, kitWorks, medLevelOf, roleOf, seatsOf, toolFor } from '../crews';
import { BeliefStore, mkFact } from './beliefs';
import type { CostFn } from './grid';
import { doorAt, isIndoor, los, staticPass, tileOf } from './grid';
import { BAND_NAME, band, isHeld, pushFx } from './hazards';

export const resp = (sim: Sim, a: FieldAgent): Responder => sim.responders[a.rid];
export const staminaF = (r: Responder): number => 0.55 + 0.45 * clamp(r.stamina / 60, 0, 1);

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
  return out;
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
  if (s.kind === 'collapse' && kitLive(sim, a.rid, 'searchKit')) concealment *= 0.45;
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

export function casFact(sim: Sim, s: Scene, c: Casualty, src: string): Fact {
  const mob = c.mob === 'trapped' ? 'trapped' : c.walking ? 'mobile' : 'immobile';
  const b = band(c.health);
  const v: CasBelief = { x: Math.round(c.x), y: Math.round(c.y), mob, band: b, where: c.where, treated: c.treated, trappedDone: c.mob !== 'trapped', tq: c.treatQ >= 0.6 ? 2 : c.treated ? 1 : 0 };
  const mobT = c.dead ? '' : mob === 'trapped' ? ' · 고립' : mob === 'mobile' ? ' · 자력 대피 중' : c.where === 'scene' ? ' · 거동 불가' : '';
  const whereT = c.where === 'safe' ? '안전 구역' : c.where === 'loaded' ? '구급차 탑승' : c.where === 'carried' ? '이송 중' : regionNameAt(s, c.x, c.y);
  return mkFact('cas', c.id, v, src, sim.t, 1, true, `구조 대상 ${c.label}: ${whereT}${mobT} · ${BAND_NAME[b]}`);
}
export function hosFact(sim: Sim, s: Scene, h: Hostile, src: string): Fact {
  const wt = h.weapon === 'gun' ? '총기 소지' : h.weapon === 'knife' ? '흉기 소지' : '비무장';
  const st = h.state === 'hold' ? '대치 중' : h.state === 'fight' ? '교전 중' : h.state === 'flee' ? '도주 중' : h.state === 'surrendered' ? '투항' : h.state === 'arrested' ? '검거' : h.state === 'down' ? '제압' : '도주';
  const hold = h.hostageId >= 0 && (h.state === 'hold' || h.state === 'fight');
  return mkFact('hos', h.id, { x: Math.round(h.x), y: Math.round(h.y), weapon: h.weapon, state: h.state, hostage: hold, facing: Math.round(h.facing * 4) / 4 }, src, sim.t, 1, true, `${h.label}: ${wt}${hold ? ' · 인질을 붙잡고 있음' : ''} · ${st} (${regionNameAt(s, h.x, h.y)})`);
}

/** 보고할 가치가 있는 변화인가 (위치만 바뀐 것은 조용히 갱신) */
function significant(f: Fact, old: any): boolean {
  const v = f.value;
  if (f.type === 'cas') return v.where !== 'carried' && (old.mob !== v.mob || old.band !== v.band || old.where !== v.where || old.treated !== v.treated || old.tq !== v.tq);
  if (f.type === 'hos') return old.state !== v.state || old.weapon !== v.weapon || old.hostage !== v.hostage;
  if (f.type === 'mate') return old.status !== v.status;
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
    I.problems.push({ code: 'LATE_DISCOVERY', t: sim.t, eventId: sim.events.length - 1, detail: `구조 대상 ${c.label} 발견까지 도착 후 ${Math.round(sim.t - s.arrivedAt)}초 소요`, recovered: true, recoveryText: '' });
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
    if (s.kind === 'collapse') kitWorks(sim, a.rid, 'searchKit', I);
  }
  const v = visionOf(sim, s, a) * boost;
  const me = r.name;
  // 상공의 관측자(a.aloft): 지붕 밑(실내 칸)은 보지 못하고, 바깥 칸은 벽·나무에 가리지 않는다(시야선을 보지 않는다).
  // 사람을 움직이지 않고(대피 안내·인질 유도 없음), 소품(문·밸브·단서 …)은 살피지 않는다
  const aloft = a.aloft === true;
  const sees = (x: number, y: number): boolean => (aloft ? !isIndoor(s.tiles[tileOf(s, x, y)]) : los(s, a.x, a.y, x, y));
  const meter = hasKit(sim, a.rid, 'gasMeter');      // 가스 측정기: 새는 밸브를 벽 너머 7칸에서 알아챈다
  for (let ci = 0; ci < s.casualties.length; ci++) { const c = s.casualties[ci];      // 색인 순회: 최적화 전 단계에서 반복자 객체를 만들지 않는다 (순서는 같다)
    if (c.where === 'hospital' || c.where === 'loaded') continue;
    const d = dist(a.x, a.y, c.x, c.y);
    if (d > v) continue;
    const known = c.tDiscovered >= 0;
    const dr = known ? v : detectRadius(sim, s, a, c.concealment) * boost;
    if (d > dr || !sees(c.x, c.y)) continue;
    let fresh = sim.t - c.tDiscovered < 2.5;      // 방금 누군가 발견을 알렸다면 같은 내용을 되풀이하지 않는다
    if (!known) { discover(sim, s, I, a, c); fresh = true; }
    // 하늘에서 먼저 본 사람을 지상 대원이 처음 만났다: 걸을 수 있으면 대피를 안내한다 (발견한 대원이 하는 것과 같다)
    if (!aloft && known && !c.walking && c.mob === 'mobile' && c.where === 'scene' && !c.dead && UNGUIDED.has(c) && !isHeld(sim, s, c.id)) { UNGUIDED.delete(c); c.walking = true; c.path = null; }
    if (!aloft && known && c.hostage && c.mob === 'mobile' && !c.walking && !c.dead && c.where === 'scene' && !isHeld(sim, s, c.id) && !s.hostiles.some((h) => h.state === 'hold' || h.state === 'fight')) { c.walking = true; c.path = null; }
    if (c.tDiscovered >= 0) { if (fresh) learnQuiet(sim, a, casFact(sim, s, c, me)); else learn(sim, a, casFact(sim, s, c, me)); }
  }
  for (let hi = 0; hi < s.hostiles.length; hi++) { const h = s.hostiles[hi];
    const d = dist(a.x, a.y, h.x, h.y);
    const range = aloft ? (h.hidden ? v * 0.4 : v) : h.hidden ? 4.2 : 13;      // 지상은 시야와 상관없이 13칸(숨은 용의자 4.2칸). 상공은 관측 거리만큼 — 밤의 4칸이 용의자에게도 걸린다
    const cur = a.beliefs.get('hos', h.id);
    if (d <= range && sees(h.x, h.y)) {
      const wasHidden = h.hidden;
      if (h.hidden) {
        h.hidden = false;
        raiseProblem(sim, I, 'SCENE_MISMATCH', '숨어 있던 추가 용의자 발견', { role: 'RESPONDER', actor: me, rid: r.id, imp: 3, text: `숨어 있던 추가 용의자 발견! ${regionNameAt(s, h.x, h.y)}.` }, false);
      }
      if (wasHidden) learnQuiet(sim, a, hosFact(sim, s, h, me)); else learn(sim, a, hosFact(sim, s, h, me));
    } else if (cur && cur.value.state !== h.state && (h.state === 'escaped' || h.state === 'down' || h.state === 'arrested') && d <= 16) {
      learn(sim, a, hosFact(sim, s, h, me));
    }
  }
  // 타일 스캔: 화재 / 잔해
  if (s.burning > 0 || a.beliefs.list('fire').some((f) => f.value > 0)) {
    const R = Math.ceil(v);
    const ax = Math.round(a.x), ay = Math.round(a.y);
    const seen = new Map<number, { n: number; m: number }>();
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
      if (!p.exploded && d <= 3.5 && !a.beliefs.get('haz', p.id) && los(s, a.x, a.y, p.x, p.y)) learn(sim, a, mkFact('haz', p.id, { kind: 'gas', active: true, x: p.x, y: p.y }, me, sim.t, 1, true, `${regionNameAt(s, p.x, p.y)}에 가스 용기 확인 — 폭발 위험`));
    } else if (p.kind === 'unstable' || p.kind === 'valve') {
      if (sniff || (d <= (p.kind === 'valve' ? 4.5 : r.judgment >= 0.45 ? 4 : 2.6) && los(s, a.x, a.y, p.x, p.y))) {
        const active = !p.mitigated && !p.ignited;
        const cur = a.beliefs.get('haz', p.id);
        const where = regionNameAt(s, p.x, p.y);
        const text = p.kind === 'valve' ? (active ? `${where} 배관에서 가스 누출 확인 — 밸브 차단 필요` : p.ignited ? '누출 가스 발화' : '가스 밸브 차단 확인') : active ? `${where} 구조물 균열 확인 — 추가 붕괴 위험, 보강 필요` : '균열부 보강 확인';
        if (!cur || cur.value.active !== active) learn(sim, a, mkFact('haz', p.id, { kind: 'leak', active, x: p.x, y: p.y }, me, sim.t, 1, true, text));
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
        if (!cur || cur.value.active !== active) learn(sim, a, mkFact('haz', p.id, { kind: 'leak', active, x: p.x, y: p.y }, me, sim.t, 1, true, active ? '차량 연료 누출 확인 — 발화 위험' : p.ignited ? '누출 연료 발화' : '연료 누출 조치 완료'));
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
  for (const b of s.agents) {
    if (b === a || b.status !== 'down') continue;
    if (dist(a.x, a.y, b.x, b.y) <= v && sees(b.x, b.y)) {
      const cur = a.beliefs.get('mate', b.rid);
      if (!cur || cur.value.status !== 'down') learn(sim, a, mkFact('mate', b.rid, { x: Math.round(b.x), y: Math.round(b.y), status: 'down' }, me, sim.t, 1, true, `${sim.responders[b.rid].name} 대원 쓰러짐 — 구조 필요`));
    }
  }
}

const IMPORTANT: Record<string, boolean> = { cas: true, blk: true, hos: true, haz: true, mate: true, evid: true, clue: true, seen: true, secure: true };

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
  const important = a.outbox.some((f) => IMPORTANT[f.type]);
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
  const shown = speak.filter((f) => IMPORTANT[f.type]);
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
export function agentCost(sim: Sim, s: Scene, a: FieldAgent, allowBlockers = true): CostFn {
  const r = resp(sim, a);
  const u = sim.units[a.unitId];
  // 연기·불을 지나는 값은 부서가 아니라 든 장비가 정한다: 공기호흡기(연기), 방화복(약한 불), 관창(센 불을 끄며 지나간다)
  const scba = hasKit(sim, a.rid, 'scba'), turnout = hasKit(sim, a.rid, 'turnout');
  const canSuppress = hasKit(sim, a.rid, 'hose') && !u.pumpFailed && (u.water > 0 || u.hydrant);
  // 공기호흡기가 없는 대원은 화재·가스·붕괴 현장의 건물 안을 가로질러 가지 않는다 (돌아갈 길이 있으면 돌아간다 — 안에 볼일이 있는 일은 fitFor 가 먼저 막는다)
  const shun = !scba && (s.kind === 'fire' || s.kind === 'hazmat' || s.kind === 'collapse');
  const ax = a.x, ay = a.y;
  const v = Math.min(5, visionOf(sim, s, a));
  // 판단력이 낮으면 장애물 제거 시간을 잘못 추정한다
  const est = 1 + (a.rng.next() - 0.5) * (1 - r.judgment) * 0.9;
  const clearCost = (22 / (0.5 + r.skills.rescue * 0.8 + toolFor(sim, a.rid, 'clear') * 0.5)) * est;
  const forceCost = (15 / (0.6 + r.skills.rescue * 0.6 + toolFor(sim, a.rid, 'force') * 0.6 + r.skills.law * 0.3)) * est;
  return (i: number): number => {
    const t = s.tiles[i];
    if (!staticPass(t)) return -1;
    let c = t === T.TREE ? 0.7 : 0;
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
      if (f > 0.5) { if (!canSuppress) return -1; c += 16; } else if (f > 0.12) c += turnout ? 2 : 6;
      c += s.smoke[i] * (scba ? 0.8 : 3);
    }
    return c;
  };
}

export function hasWork(a: FieldAgent): boolean { return a.task !== null && a.task.kind !== 'standby'; }

/**
 * 실패를 기억하는 시간(초). 닿지 못했거나(경로 없음·화염) 위험해서 내려놓은 작업은 이 시간 동안 같은 대원에게 다시 맡기지 않고,
 * 그 대원도 스스로 다시 고르지 않는다. 기억이 없으면 "시도 → 실패 → 재지시"를 1초 간격으로 되풀이한다.
 */
export const RETRY_AFTER = 25;
export function failedRecently(sim: Sim, w: WorkItem, rid: number): boolean { const t = w.failedAt[rid]; return t !== undefined && sim.t - t < RETRY_AFTER; }
/** 부상으로 더는 임무를 맡을 수 없는 대원 (brain.dangerScore 의 후퇴 기준과 같다) */
export const HURT_HEALTH = 40;

export function workLabel(s: Scene, w: WorkItem): string {
  const reg = w.region >= 0 ? s.regions[w.region].name : '';
  const cas = w.cas >= 0 ? `구조 대상 ${s.casualties[w.cas].label}` : '';
  const hos = w.hostile >= 0 && s.hostiles[w.hostile] ? s.hostiles[w.hostile].label : '용의자';      // 용의자가 여럿인 현장에서 지시가 누구를 가리키는지 (구조 대상의 이름표와 같이)
  const names: Record<WorkKind, string> = {
    sizeup: '현장 평가', search: `${reg} ${w.thorough ? '정밀 ' : ''}수색`, suppress: `${reg} 화재 진압`, hookup: '소화전 연결', clear: '잔해 제거', force: '문 강제 개방',
    extricate: `${cas} 구출`, treat: `${cas} 응급 처치`, carry: `${cas} 이송`, load: `${cas} 구급차 탑승`, traffic: '교통 통제',
    mitigate: w.prop >= 0 && s.props[w.prop] && s.props[w.prop].kind === 'unstable' ? '균열부 보강' : w.prop >= 0 && s.props[w.prop] && s.props[w.prop].kind === 'valve' ? '가스 밸브 차단' : '연료 누출 조치',
    perimeter: s.kind === 'hazmat' ? `${w.tile === 0 ? '앞쪽' : '뒤쪽'} 출입구 통제` : `${exitName(s, w.tile)} 봉쇄`, negotiate: `${hos} 협상`, engage: `${hos} 대응`, arrest: `${hos} 검거`, interview: '목격자 면담', clearRoad: '도로 정리', rescueMate: '동료 구조', waterRescue: `${cas} 수난 구조`, escort: `${cas} 동행`,
    defuse: '폭발물 해체', overhaul: `${reg} 잔불 정리`,
    hoist: `${cas} 호이스트 인양`, airDrop: `${reg} 공중 물 투하`,
  };
  return names[w.kind];
}

/** 이 대원이 이 작업을 맡을 수 있는가, 맡는다면 얼마나 적합한가 (0 = 불가). */
/** 출입구의 이름. 길 위의 현장에서는 길의 양 끝이다. */
export function exitName(s: Scene, k: number): string { return s.outdoor ? (k === 0 ? '서쪽 길목' : '동쪽 길목') : k === 0 ? '정문' : '후문'; }

/** 환자를 싣고 병원으로 갈 수 있는가: 환자 자리(crews.seatsOf — 구급차 2, 헬기 1)가 남았다. 자리의 수를 따로 적지 않는다 */
export function canCarryPatients(u: Unit): boolean { return u.patients.length < seatsOf(u); }

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
  const fit = fitBase(sim, s, a, w, afterSwap);
  return fit > 0 ? Math.max(0.02, fit + (roleOf(sim, a.rid).prefer[w.kind] ?? 0)) : fit;
}
/** 공기가 되는가: 문턱 아래가 아니다 (공기호흡기가 없는 대원은 해당 없음). afterSwap 이면 통을 바꾼 뒤로 보고 따지지 않는다 */
const airOk = (sim: Sim, rid: number, afterSwap: boolean): boolean => afterSwap || !airShort(sim, rid);
/** 연기 속에 들어갈 수 있는가: 공기호흡기를 멨고 공기가 된다 */
const scbaOk = (sim: Sim, rid: number, afterSwap: boolean): boolean => hasKit(sim, rid, 'scba') && airOk(sim, rid, afterSwap);
/** afterSwap = 공기통을 바꾼 뒤라면 (공기 문턱을 보지 않는다 — 지휘관이 "예비 공기통으로 바꾸면 맡을 수 있는 사람이 있는가"를 볼 때만 쓴다) */
function fitBase(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem, afterSwap: boolean): number {
  const r = resp(sim, a), u = sim.units[a.unitId], rid = a.rid;
  const hot = s.kind === 'armed' && s.secureAt < 0;
  const fireRisk = (regionId: number): boolean => regionId >= 0 && ((a.beliefs.val<number>('fire', regionId) ?? 0) > 0.25 || s.kind === 'fire' || s.kind === 'hazmat' || s.kind === 'collapse');      // 불이 났거나, 가스가 찼거나, 무너질 수 있는 건물 안은 공기호흡기를 멘 대원만 들어간다
  switch (w.kind) {
    case 'sizeup': return a.isCommander ? 1 : 0;
    case 'search':
      if (hot && !(r.dept === 'police' && hasFirearm(sim, rid))) return 0;
      if (s.regions[w.region].indoor && fireRisk(w.region) && !scbaOk(sim, rid, afterSwap)) return 0;
      return 0.45 + 0.3 * r.experience + 0.25 * r.judgment + (r.dept === 'police' && s.kind !== 'fire' && s.kind !== 'medical' ? 0.1 : 0) + (r.dept === 'ems' && s.kind === 'medical' ? 0.15 : 0);
    case 'suppress': return hasKit(sim, rid, 'hose') && airOk(sim, rid, afterSwap) && !u.pumpFailed && (u.water > 0 || u.hydrant) ? r.skills.fire : 0;      // 관창을 든 사람만 물을 쏜다 (공기가 문턱 아래면 통을 바꾼 뒤에)
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
        if (!cb && s.kind === 'fire') return 0;      // 어디에 있는지 아직 전달받지 못했다 — 불이 난 건물 안일 수 있다
        if (cb) { const rg = s.region[cb.y * s.w + cb.x]; if (rg >= 0 && s.regions[rg].indoor && fireRisk(rg)) return 0; }
      }
      const f = r.skills.rescue * (0.35 + 0.65 * toolFor(sim, rid, 'extricate'));
      return f >= 0.2 || sim.t - w.createdAt > 25 ? Math.max(0.05, f) : 0;
    }
    case 'treat': {
      if (hot && r.dept !== 'police') return 0;
      const cb = a.beliefs.val<CasBelief>('cas', w.cas);
      if (cb && cb.tq >= 1 && r.dept !== 'ems') return 0;      // 기본 처치가 끝난 환자는 구급대원만 더 손볼 수 있다
      return Math.max(0.08, r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, rid)));
    }
    case 'carry': case 'escort': {
      if (hot && r.dept !== 'police') return 0;
      const cb = a.beliefs.val<CasBelief>('cas', w.cas);
      if (!cb && (s.kind === 'fire' || s.kind === 'collapse' || s.kind === 'hazmat') && !scbaOk(sim, rid, afterSwap)) return 0;      // 어디에 있는지 아직 전달받지 못했다 — 위험한 건물 안일 수 있다
      // 누가 옮기는 중('carried')이어도 믿음 속 자리로 같은 검사를 한다: 공기호흡기 없는 대원이 이송 보조로 위험한 건물 안에 따라 들어가지 않게
      if (cb && (cb.where === 'scene' || cb.where === 'carried')) { const rg = s.region[cb.y * s.w + cb.x]; if (rg >= 0 && s.regions[rg].indoor && fireRisk(rg) && !scbaOk(sim, rid, afterSwap)) return 0; }
      return 0.4 + 0.4 * r.fitness + (hasKit(sim, rid, 'stretcher') ? 0.1 : 0);
    }
    case 'load': return canCarryPatients(u) && a.unitId === w.prop ? 1 : 0;
    case 'traffic': return r.dept === 'police' ? 1 : 0.45;
    case 'mitigate': {
      const shore = w.prop >= 0 && s.props[w.prop] && s.props[w.prop].kind === 'unstable';
      const k = shore ? r.skills.rescue : r.skills.fire;
      return k >= 0.3 ? k + (!shore && hasKit(sim, rid, 'plugKit') ? 0.2 : 0) : 0;      // 누출 차단 장비는 밸브·연료 누출에 쓴다 (균열부 보강은 아니다)
    }
    case 'perimeter': case 'engage': return r.dept === 'police' && hasFirearm(sim, rid) ? 0.5 + r.skills.law * 0.5 : 0;
    case 'arrest': return r.dept === 'police' && (hasFirearm(sim, rid) || hasKit(sim, rid, 'taser')) ? 0.5 + r.skills.law * 0.5 : 0;
    case 'negotiate': return r.dept === 'police' ? 0.3 + r.composure * 0.35 + r.experience * 0.35 : 0;
    case 'interview': return r.dept === 'police' ? 1 : 0.6;
    case 'clearRoad': return r.dept === 'ems' ? 0 : 0.4 + r.skills.rescue * 0.4;
    case 'rescueMate': return 0.5 + r.fitness * 0.3 + r.teamwork * 0.2;
    case 'waterRescue': return 0.22 + r.skills.rescue * 0.5 + toolFor(sim, rid, 'water') * 0.28;
    case 'defuse': return hasKit(sim, rid, 'eodKit') ? 0.6 + 0.4 * r.skill : 0;      // 해체 공구를 든 처리 요원만 손댄다
    case 'overhaul': return hasKit(sim, rid, 'hose') && airOk(sim, rid, afterSwap) ? 0.4 + 0.6 * r.skills.fire : 0;      // 불씨를 만나면 분사한다: 관창을 든 사람만 (공기가 문턱 아래면 통을 바꾼 뒤에)
    case 'hoist': case 'airDrop': return 0;      // 공중 임무: 지상 대원은 맡지 않는다 (상공의 헬기가 field/rules/air.ts 에서 가져간다)
  }
}

export function inShadow(s: Scene, a: FieldAgent): boolean { return s.shadow[tileOf(s, a.x, a.y)] === 1; }
export function nearDoor(s: Scene, i: number): boolean { return doorAt(s, i) !== null; }
