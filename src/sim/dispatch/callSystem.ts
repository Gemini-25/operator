// CallSystem + OperatorAI(Call Taker) — 신고 전화와 신고 접수 AI.
// 신고자는 사건의 일부만, 때로는 틀리게 알고 있다. 접수 AI 는 현재 가설에 따라 다음 질문을 고르고,
// 충분한 정보가 모이면 통화를 끝낸다. 대화는 템플릿·데이터 기반이며 외부 LLM 을 쓰지 않는다.

import { nodeName } from '../city';
import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { josa } from '../util';
import type { Rng } from '../rng';
import type { Call, Caller, Claim, Incident, Persona, Scene, Topic } from '../types';
import { assess } from './analyst';
import { briefUpdate } from './dispatcher';

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신'];
const PERSONA_NAME: Record<Persona, string> = { calm: '침착함', panicked: '공황 상태', confused: '상황 파악 미흡', partial: '일부만 목격', wrong: '부정확한 확신' };
export const personaName = (p: Persona): string => PERSONA_NAME[p];

const ACC: Record<Persona, number> = { calm: 0.93, panicked: 0.75, confused: 0.55, partial: 0.88, wrong: 0.5 };
const KNOW: Record<Persona, number> = { calm: 0.92, panicked: 0.82, confused: 0.6, partial: 0.42, wrong: 0.9 };
const CONF: Record<Persona, number> = { calm: 0.85, panicked: 0.6, confused: 0.4, partial: 0.72, wrong: 0.82 };

const NATURE_TEXT: Record<string, string[]> = {
  flames: ['건물에서 불이 났어요! 불길이 보여요.', '불이야! 창문으로 불이 치솟고 있어요.'],
  smoke: ['건물에서 연기가 나고 있어요.', '어디선가 연기가 계속 올라와요.'],
  smell: ['타는 냄새가 계속 나는데요, 불은 안 보여요.', '뭔가 타는 냄새가 나요. 별일 아닐 수도 있는데…'],
  explosion: ['방금 쾅 하고 터지는 소리가 났어요!', '폭발 같은 게 있었어요!'],
  crash: ['차 사고가 났어요. 차들이 부딪혔어요.', '방금 교차로에서 차량 충돌 사고가 났습니다.'],
  bang: ['쾅 하는 큰 소리가 났어요. 뭔지는 잘 모르겠어요.', '밖에서 엄청 큰 소리가 났는데요…'],
  missing: ['사람이 없어졌어요. 산책로 쪽으로 간 뒤로 돌아오질 않아요.', '일행이 길을 잃은 것 같아요. 연락이 안 돼요.'],
  scream: ['누가 비명을 질렀어요. 무슨 일이 난 것 같아요.', '사람들이 소리 지르면서 뛰쳐나오고 있어요.'],
  gunshots: ['총소리가 났어요! 가게 안에서요!', '누가 총을 쏘고 있어요!'],
  robbery: ['가게에 강도가 들었어요!', '강도예요. 가게 안에서 사람들을 위협하고 있어요.'],
  fight: ['가게에서 사람들이 심하게 싸우고 있어요.', '어떤 사람이 가게에서 난동을 부려요.'],
};
/** 신고 키워드 → 사건 유형 가능도 (분석 AI 가 사용) */
export const NATURE_LIK: Record<string, [number, number, number, number]> = {
  //            fire  traffic search armed
  flames: [0.94, 0.03, 0.01, 0.02], smoke: [0.72, 0.18, 0.02, 0.08], smell: [0.7, 0.15, 0.05, 0.1], explosion: [0.46, 0.27, 0.02, 0.25],
  crash: [0.03, 0.94, 0.01, 0.02], bang: [0.22, 0.46, 0.02, 0.3], missing: [0.01, 0.01, 0.97, 0.01], scream: [0.2, 0.2, 0.12, 0.48],
  gunshots: [0.02, 0.02, 0.01, 0.95], robbery: [0.01, 0.01, 0.01, 0.97], fight: [0.03, 0.05, 0.02, 0.9],
};

function natureFor(I: Incident, s: Scene, persona: Persona, rng: Rng): { v: string; truthful: boolean; note: string } {
  const t = I.truth.type, variant = I.truth.variant;
  const exact = t === 'fire' ? 'flames' : t === 'traffic' ? 'crash' : t === 'search' ? 'missing' : variant === 'shooter' ? 'gunshots' : variant === 'robbery' ? 'robbery' : 'fight';
  if (t === 'search') return { v: 'missing', truthful: true, note: '' };
  const vague = t === 'fire' ? 'smoke' : t === 'traffic' ? 'bang' : 'scream';
  if (persona === 'calm') return { v: exact, truthful: true, note: '' };
  if (persona === 'panicked') return rng.chance(0.7) ? { v: exact, truthful: true, note: '' } : { v: vague, truthful: true, note: '' };
  if (persona === 'confused' || persona === 'partial') return rng.chance(0.3) ? { v: exact, truthful: true, note: '' } : { v: vague, truthful: true, note: '' };
  // wrong: 실제보다 축소하거나 다른 종류로 오인
  if (t === 'fire') return rng.chance(0.55) ? { v: 'smell', truthful: false, note: '화재를 "타는 냄새" 정도로 축소 신고' } : { v: 'explosion', truthful: false, note: '화재를 폭발음으로 신고' };
  if (t === 'traffic') return rng.chance(0.5) ? { v: 'bang', truthful: false, note: '충돌 사고를 "큰 소리"로만 신고' } : { v: 'explosion', truthful: false, note: '충돌 사고를 폭발로 오인' };
  if (variant === 'dispute') return { v: 'gunshots', truthful: false, note: '단순 난동을 총격으로 과장 신고' };
  return { v: 'fight', truthful: false, note: '무장 사건을 단순 다툼으로 축소 신고' };
}

/** 사건의 진실에서 신고자가 "알고 있다고 믿는" 내용을 만든다. */
export function makeCaller(sim: Sim, I: Incident, s: Scene, rng: Rng, followup: boolean): Caller {
  const persona: Persona = followup ? rng.weighted<Persona>(['calm', 'panicked', 'partial', 'confused'], [0.45, 0.2, 0.25, 0.1])
    : rng.weighted<Persona>(['calm', 'panicked', 'confused', 'partial', 'wrong'], [0.3, 0.24, 0.15, 0.17, 0.14]);
  const acc = ACC[persona], kn = KNOW[persona], cf = CONF[persona];
  const knows: Partial<Record<Topic, Claim>> = {};
  const put = (topic: Topic, value: any, text: string, truthful: boolean, note = '', conf = cf) => { knows[topic] = { topic, value, conf, text, truthful, callId: -1, note }; };
  const t = I.truth.type;
  put('location', I.truth.nodeId, `${nodeName(sim.city, I.truth.nodeId)} 근처예요.`, true, '', 0.95);
  const nat = natureFor(I, s, persona, rng);
  put('nature', nat.v, rng.pick(NATURE_TEXT[nat.v]), nat.truthful, nat.note);
  const cas = s.casualties;
  const nTrue = cas.length;
  const trappedTrue = t === 'fire' ? nTrue > 0 : t === 'armed' ? cas.some((c) => c.hostage) : cas.some((c) => c.mob === 'trapped');
  const injuredTrue = t === 'fire' ? nTrue > 0 : cas.some((c) => c.mob !== 'mobile' || c.health < 80);
  // 부상자 여부
  if (rng.chance(kn)) {
    const ok = rng.chance(acc);
    const v = ok ? injuredTrue : !injuredTrue;
    put('injured', v, v ? rng.pick(['다친 사람이 있어요.', '네, 쓰러진 사람이 보여요.']) : rng.pick(['다친 사람은 못 봤어요.', '아니요, 다친 사람은 없는 것 같아요.']), ok, ok ? '' : v ? '부상자가 없는데 있다고 신고' : '부상자가 있는데 없다고 신고');
  }
  // 인원
  if (rng.chance(kn * 0.85) && t !== 'search') {
    const ok = rng.chance(acc);
    let v = nTrue;
    if (!ok) v = Math.max(0, nTrue + (persona === 'panicked' ? rng.int(1, 2) : rng.pick([-2, -1, 1, 2])));
    put('count', v, v === 0 ? '사람은 없는 것 같아요.' : `${v}명 정도 있는 것 같아요.`, v === nTrue, v === nTrue ? '' : `실제 ${nTrue}명인데 ${v}명으로 신고`);
  } else if (t === 'search') {
    put('count', nTrue, nTrue > 1 ? `${nTrue}명이에요.` : '한 명이에요.', true, '', 0.9);
  }
  // 고립/갇힘
  if (rng.chance(kn) && t !== 'search') {
    const ok = rng.chance(acc);
    const v = ok ? trappedTrue : !trappedTrue;
    const yes = t === 'fire' ? '안에 아직 사람이 있어요!' : t === 'armed' ? '가게 안에 사람들이 못 나오고 있어요.' : '차 안에 사람이 끼어서 못 나와요.';
    const no = t === 'fire' ? '사람들은 다 나온 것 같아요.' : t === 'armed' ? '안에 다른 사람은 없는 것 같아요.' : '다들 차 밖으로 나왔어요.';
    put('trapped', v, v ? yes : no, ok, ok ? '' : v ? '고립자가 없는데 있다고 신고' : '고립자가 있는데 "다 나왔다"고 신고');
  }
  // 위험 요소
  if (t === 'fire') {
    const gas = s.props.some((p) => p.kind === 'gas');
    if (gas && rng.chance(kn * 0.4)) put('hazard', 'gas', '안에 가스통 같은 게 있어요.', true);
    else if (rng.chance(kn * 0.7)) { const v = I.truth.severity >= 2 ? 'spreading' : 'small'; put('hazard', v, v === 'spreading' ? '불이 옆으로 번지고 있어요.' : '불이 크지는 않아요.', true); }
  } else if (t === 'traffic') {
    const leak = s.props.some((p) => p.kind === 'vehicle' && p.leakRate);
    if (leak && rng.chance(kn * 0.45)) put('hazard', 'leak', '차에서 뭐가 새고 있어요. 기름 냄새가 나요.', true);
    else if (rng.chance(kn * 0.5)) put('hazard', 'lanes', '차들이 옆으로 계속 지나가서 위험해요.', true);
  }
  // 무기
  if (t === 'armed' && rng.chance(Math.max(kn, 0.6))) {
    const tw = s.hostiles[0]?.weapon ?? 'none';
    const ok = rng.chance(acc);
    let v: string = tw;
    if (!ok) v = tw === 'gun' ? rng.pick(['none', 'knife']) : 'gun';
    if (persona === 'panicked' && tw !== 'gun' && rng.chance(0.35)) v = 'gun';
    put('weapon', v, v === 'gun' ? '총을 들고 있어요!' : v === 'knife' ? '칼 같은 걸 들고 있어요.' : '무기는 못 봤어요.', v === tw, v === tw ? '' : `실제 ${tw === 'gun' ? '총기' : tw === 'knife' ? '흉기' : '비무장'}인데 ${v === 'gun' ? '총기' : v === 'knife' ? '흉기' : '무기 없음'}으로 신고`);
  }
  // 상세 (위치 단서)
  if (t === 'fire' && nTrue > 0 && rng.chance(kn * 0.7)) {
    const ok = rng.chance(acc);
    const trueReg = s.region[Math.round(cas[0].y) * s.w + Math.round(cas[0].x)];
    const rooms = s.regions.filter((r) => r.kind === 'room');
    const reg = ok && trueReg >= 0 ? s.regions[trueReg] : rng.pick(rooms);
    put('detail', { region: reg.id }, `${reg.name} 쪽에 사람이 있는 걸 봤어요.`, reg.id === trueReg, reg.id === trueReg ? '' : `요구조자 위치를 ${josa(reg.name, '으로/로')} 잘못 신고`);
  } else if (t === 'search') {
    const tgt = cas.find((c) => c.isTarget)!;
    const trueReg = s.region[Math.round(tgt.y) * s.w + Math.round(tgt.x)];
    const zones = s.regions.filter((r) => r.kind === 'zone');
    const ok = rng.chance(acc * 0.7);
    const reg = ok ? s.regions[trueReg] : rng.pick(zones.filter((z) => z.id !== trueReg));
    put('detail', { region: reg.id }, `마지막으로 ${reg.name} 방향으로 가는 걸 봤어요.`, ok, ok ? '' : `마지막 목격 위치를 ${josa(reg.name, '으로/로')} 잘못 신고`);
  } else if (t === 'traffic') {
    const ejected = s.props.some((p) => p.emptySeat);
    if (ejected && rng.chance(kn * 0.45)) put('detail', { ejected: true }, '한 사람이 차 밖으로 튕겨 나간 것 같아요.', true);
  } else if (t === 'armed' && rng.chance(kn * 0.6)) {
    const visible = s.hostiles.filter((h) => !h.hidden).length;
    put('detail', { suspects: visible }, `${visible}명이에요.`, visible === s.hostiles.length, visible === s.hostiles.length ? '' : '숨어 있는 공범은 보지 못함');
  }
  return {
    name: rng.pick(SURNAMES) + '○○', persona, knows,
    patience: persona === 'partial' ? 3 : persona === 'panicked' ? 5 : 6,
    answerTime: persona === 'calm' ? 2.6 : persona === 'panicked' ? 3.6 : persona === 'confused' ? 4.6 : 3.2,
  };
}

const QUESTION: Record<Topic, Record<string, string>> = {
  location: { any: '정확한 위치가 어디입니까?' },
  nature: { any: '정확히 무엇을 보셨습니까? 불, 사고, 사람 중 무엇입니까?' },
  injured: { any: '다친 사람이 있습니까?' },
  count: { fire: '건물 안에 몇 명이나 있습니까?', traffic: '다친 사람은 모두 몇 명입니까?', armed: '안에 있는 사람은 몇 명입니까?', search: '찾는 분은 몇 명입니까?', any: '사람은 몇 명입니까?' },
  trapped: { fire: '건물 안에 아직 사람이 남아 있습니까?', traffic: '차 안에 갇힌 사람이 있습니까?', armed: '가게 안에 못 나온 사람이 있습니까?', any: '갇힌 사람이 있습니까?' },
  hazard: { fire: '불이 번지고 있습니까? 위험물이 있습니까?', traffic: '연료가 새거나 연기가 나는 차량이 있습니까?', any: '주변에 다른 위험한 것이 있습니까?' },
  weapon: { any: '무기를 가지고 있습니까? 어떤 무기입니까?' },
  detail: { fire: '사람이 있는 위치를 아십니까?', search: '마지막으로 본 곳이 어디입니까?', traffic: '차 밖으로 튕겨 나간 사람이 있습니까?', armed: '용의자는 몇 명입니까?', any: '더 알려 주실 내용이 있습니까?' },
};
const DONT_KNOW = ['잘 모르겠어요.', '그건 못 봤어요.', '거기까지는 모르겠어요.'];
const PANIC_NOISE = ['빨리 좀 와 주세요! 제발요!', '모르겠어요, 빨리요!', '아… 어떡해, 어떡해요!'];

const TOPIC_VALUE: Record<string, Partial<Record<Topic, number>>> = {
  fire: { trapped: 0.92, count: 0.7, detail: 0.66, hazard: 0.62, injured: 0.5 },
  traffic: { injured: 0.9, trapped: 0.84, count: 0.62, hazard: 0.6, detail: 0.5 },
  search: { detail: 0.92, injured: 0.6, count: 0.55 },
  armed: { weapon: 0.95, injured: 0.82, detail: 0.7, trapped: 0.64, count: 0.5 },
};

export function startCall(sim: Sim, I: Incident, followup: boolean): void {
  const s = sim.scenes[I.id]!;
  const rng = sim.rng.fork(`call:${I.id}:${I.callsCount}`);
  const call: Call = {
    id: sim.calls.length, incidentId: I.id, caller: makeCaller(sim, I, s, rng, followup), state: 'ringing',
    ringAt: sim.t, answeredAt: -1, endedAt: -1, transcript: [], asked: [], pending: null, nextAt: 0, phase: 'ask', retries: 0,
    linkedTo: -1, rng, isFollowup: followup, eventId: -1,
  };
  I.callsCount++;
  sim.calls.push(call);
  if (!followup) { I.reportedAt = sim.t; I.phase = 'call'; }
}

function say(sim: Sim, call: Call, I: Incident, who: 'CALLER' | 'CALL_TAKER', text: string, imp = 0): number {
  call.transcript.push({ t: sim.t, who, text });
  const ev = emit(sim, { inc: I.id, role: who, actor: who === 'CALLER' ? `신고자 ${call.caller.name}` : '신고 접수 AI', kind: 'call', text, imp, causes: call.eventId >= 0 ? [call.eventId] : [] });
  I.callEvents.push(ev);
  return ev;
}

function recordClaim(sim: Sim, call: Call, I: Incident, c: Claim): void {
  const claim: Claim = { ...c, callId: call.id };
  // 서로 다른 신고자의 진술이 충돌하면 표시해 둔다(분석 AI 가 신뢰도를 낮춘다)
  I.claims.push(claim);
  if (claim.topic === 'location') I.locationKnown = true;
}

function nextTopic(sim: Sim, call: Call, I: Incident): Topic | null {
  if (!I.locationKnown && call.asked.indexOf('location') < 0) return 'location';
  const as = I.assessment;
  if (as && as.typeConf < 0.6 && call.asked.indexOf('nature') < 0) return 'nature';
  const hyp = as ? as.type : 'fire';
  const table = TOPIC_VALUE[hyp];
  let best: Topic | null = null, bs = 0;
  const elapsed = sim.t - call.answeredAt;
  for (const k of Object.keys(table) as Topic[]) {
    if (call.asked.indexOf(k) >= 0) continue;
    // 이미 다른 신고자에게서 확실한 답을 들었으면 가치가 낮다
    const prior = I.claims.filter((c) => c.topic === k);
    let v = table[k]!;
    if (prior.length) v *= call.isFollowup ? 0.75 : 0.4;
    if (k === 'detail' && hyp === 'fire' && !I.claims.some((c) => c.topic === 'trapped' && c.value === true)) v *= 0.4;
    if (v > bs) { bs = v; best = k; }
  }
  // 질문을 더 하는 것의 가치 < 시간 비용이면 통화를 마친다
  const threshold = 0.46 + 0.035 * call.asked.length + (elapsed > 40 ? 0.25 : 0) + (call.isFollowup ? 0.12 : 0);
  if (!best || bs < threshold) return null;
  if (call.asked.length >= call.caller.patience) return null;
  return best;
}

function endCall(sim: Sim, call: Call, I: Incident, text: string): void {
  say(sim, call, I, 'CALL_TAKER', text);
  call.state = 'done'; call.endedAt = sim.t;
  sim.activeCall = -1;
}

export function tickCalls(sim: Sim): void {
  // 벨이 울리는 전화 받기 (접수 AI 는 한 번에 한 통화만 처리한다)
  if (sim.activeCall < 0) {
    const ringing = sim.calls.find((c) => c.state === 'ringing');
    if (ringing) {
      const I = sim.incidents[ringing.incidentId];
      if (I.phase === 'closed') { ringing.state = 'done'; }
      else {
        ringing.state = 'active'; ringing.answeredAt = sim.t; sim.activeCall = ringing.id;
        const wait = sim.t - ringing.ringAt;
        if (!ringing.isFollowup) I.answeredAt = sim.t;
        ringing.eventId = emit(sim, { inc: I.id, role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: ringing.isFollowup ? 1 : 2, text: ringing.isFollowup ? '추가 신고 전화 수신.' : `신고 전화 수신 (사건 ${I.code}).` });
        if (wait > 10 && !ringing.isFollowup) raiseProblem(sim, I, 'CALL_QUEUE', `${Math.round(wait)}초`, { role: 'CALL_TAKER', actor: '신고 접수 AI', imp: 1, text: `다른 통화 처리로 이 신고는 ${Math.round(wait)}초 대기했습니다.` });
        say(sim, ringing, I, 'CALL_TAKER', '긴급 신고 센터입니다. 어떤 상황입니까?');
        ringing.pending = 'nature'; ringing.asked.push('nature'); ringing.phase = 'wait';
        ringing.nextAt = sim.t + ringing.caller.answerTime * 0.8;
      }
    }
  }
  if (sim.activeCall < 0) return;
  const call = sim.calls[sim.activeCall];
  const I = sim.incidents[call.incidentId];
  if (I.phase === 'closed') { call.state = 'done'; sim.activeCall = -1; return; }
  if (sim.t < call.nextAt) return;
  const cl = call.caller;
  if (call.phase === 'wait') {
    const topic = call.pending!;
    // 공황 상태의 신고자는 첫 질문에 제대로 답하지 못할 수 있다
    if (cl.persona === 'panicked' && call.retries === 0 && call.rng.chance(0.38)) {
      say(sim, call, I, 'CALLER', call.rng.pick(PANIC_NOISE));
      say(sim, call, I, 'CALL_TAKER', '진정하세요. 도와드리겠습니다. ' + (QUESTION[topic][I.assessment?.type ?? 'any'] ?? QUESTION[topic].any));
      call.retries = 1; call.nextAt = sim.t + cl.answerTime;
      return;
    }
    call.retries = 0;
    const claim = cl.knows[topic];
    if (claim) {
      const pre = cl.persona === 'confused' ? '어… ' : cl.persona === 'panicked' ? '' : '';
      say(sim, call, I, 'CALLER', pre + claim.text);
      recordClaim(sim, call, I, claim);
      // 추가 신고: 위치가 기존 사건과 같으면 같은 사건으로 묶는다
      if (topic === 'location' && call.isFollowup) {
        call.linkedTo = I.id;
        emit(sim, { inc: I.id, role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 1, causes: [call.eventId], text: `위치가 사건 ${I.code}과 일치합니다. 동일 사건의 추가 신고로 연결합니다.` });
      }
      assess(sim, I, `신고자 진술(${topicName(topic)})`);
      if (I.phase === 'onscene' || I.phase === 'dispatched') briefUpdate(sim, I, claim);
    } else {
      say(sim, call, I, 'CALLER', (cl.persona === 'confused' ? '음… ' : '') + call.rng.pick(DONT_KNOW));
      if (topic === 'nature') { raiseProblem(sim, I, 'CALL_VAGUE', '신고자가 상황을 설명하지 못함', { role: 'CALL_TAKER', actor: '신고 접수 AI', imp: 1, text: '신고자가 상황을 제대로 설명하지 못합니다. 불확실 정보로 표시합니다.' }); }
    }
    call.phase = 'ask'; call.nextAt = sim.t + 1.0;
    return;
  }
  // 다음 질문 선택
  const topic = nextTopic(sim, call, I);
  if (!topic) {
    const early = call.asked.length >= cl.patience && cl.persona === 'partial';
    if (early) say(sim, call, I, 'CALLER', '저는 지나가다 본 거라 더는 몰라요. 끊을게요.');
    endCall(sim, call, I, call.isFollowup ? '추가 정보 감사합니다. 출동 부대에 전달하겠습니다.' : I.firstDispatchAt >= 0 ? '부대가 출동했습니다. 안전한 곳에서 기다려 주세요.' : '접수했습니다. 곧 부대를 보내겠습니다. 안전한 곳에서 기다려 주세요.');
    return;
  }
  const hyp = I.assessment?.type ?? 'any';
  say(sim, call, I, 'CALL_TAKER', QUESTION[topic][hyp] ?? QUESTION[topic].any);
  call.asked.push(topic); call.pending = topic; call.phase = 'wait';
  call.nextAt = sim.t + 1.6 + cl.answerTime * call.rng.range(0.8, 1.25);
}

export function topicName(t: Topic): string {
  return ({ location: '위치', nature: '상황', injured: '부상자', count: '인원', trapped: '고립 여부', hazard: '위험 요소', weapon: '무기', detail: '상세' } as Record<Topic, string>)[t];
}
