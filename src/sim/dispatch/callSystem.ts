// CallSystem + OperatorAI(Call Taker) — 신고 전화와 신고 접수 AI.
// 신고자는 사건의 일부만, 때로는 틀리게 알고 있다. 접수 AI 는 현재 가설에 따라 다음 질문을 고르고,
// 충분한 정보가 모이면 통화를 끝낸다. 대화는 템플릿·데이터 기반이며 외부 LLM 을 쓰지 않는다.

import { nodeName } from '../city';
import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { josa } from '../util';
import type { Rng } from '../rng';
import type { Call, Caller, Claim, Incident, Persona, Scene, Topic } from '../types';
import { applyCallerAid } from '../field/hazards';
import { assess } from './analyst';
import { briefUpdate, redirectUnits } from './dispatcher';

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신'];
const PERSONA_NAME: Record<Persona, string> = { calm: '침착함', panicked: '공황 상태', confused: '상황 파악 미흡', partial: '일부만 목격', wrong: '부정확한 확신', prank: '장난 전화' };
export const personaName = (p: Persona): string => PERSONA_NAME[p];

const ACC: Record<Persona, number> = { calm: 0.93, panicked: 0.75, confused: 0.55, partial: 0.88, wrong: 0.5, prank: 0 };
const KNOW: Record<Persona, number> = { calm: 0.92, panicked: 0.82, confused: 0.6, partial: 0.42, wrong: 0.9, prank: 1 };
const CONF: Record<Persona, number> = { calm: 0.85, panicked: 0.6, confused: 0.4, partial: 0.72, wrong: 0.82, prank: 0.8 };
/** 접수 AI 의 안내를 신고자가 실제로 따를 확률 */
const COMPLY: Record<Persona, number> = { calm: 0.9, panicked: 0.45, confused: 0.4, partial: 0.6, wrong: 0.55, prank: 0 };
/** 위치를 틀리게 말할 가능성(난이도의 기본 확률에 곱한다) */
const ADDR_ERR: Record<Persona, number> = { calm: 0.3, panicked: 1.2, confused: 1.7, partial: 1.0, wrong: 1.5, prank: 0 };

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
  hostage: ['어떤 남자가 사람을 붙잡고 총으로 위협하고 있어요!', '가게 안에서 인질을 잡고 있어요!'],
  notbreathing: ['사람이 쓰러졌는데 숨을 안 쉬어요!', '아버지가 갑자기 쓰러지셨어요. 숨을 안 쉬세요!'],
  collapsed: ['사람이 갑자기 쓰러졌어요.', '가족이 쓰러져서 일어나질 못해요.'],
  fall: ['사람이 계단에서 굴러서 크게 다쳤어요.', '높은 데서 떨어졌어요. 피가 많이 나요.'],
  collapse: ['건물이 무너졌어요! 한쪽이 그대로 주저앉았어요.', '건물 일부가 무너져 내렸어요. 먼지가 엄청나요!'],
  rumble: ['쿵 하고 뭔가 무너지는 소리가 났어요.', '땅이 울리더니 큰 소리가 났어요. 먼지가 올라와요.'],
  drowning: ['사람이 물에 빠졌어요! 떠내려가고 있어요!', '물에 빠진 사람이 허우적거리고 있어요. 빨리요!'],
  gasleak: ['가스 냄새가 심하게 나요! 어디서 새는 것 같아요.', '배관에서 쉬익 소리가 나고 가스 냄새가 지독해요.'],
  fumes: ['이상한 냄새가 나고 머리가 아파요.', '사람들이 기침하면서 건물에서 나오고 있어요.'],
};
/** 신고 키워드 → 사건 유형 가능도 (분석 AI 가 사용) */
export const NATURE_LIK: Record<string, number[]> = {
  //            fire  traffic search armed medical collapse hazmat water
  flames: [0.94, 0.03, 0.01, 0.02, 0.01, 0.01, 0.02, 0.01], smoke: [0.72, 0.18, 0.02, 0.07, 0.01, 0.04, 0.06, 0.01], smell: [0.7, 0.15, 0.05, 0.08, 0.02, 0.01, 0.2, 0.01], explosion: [0.46, 0.27, 0.02, 0.24, 0.01, 0.12, 0.18, 0.01],
  crash: [0.03, 0.93, 0.01, 0.02, 0.01, 0.02, 0.01, 0.01], bang: [0.22, 0.46, 0.02, 0.28, 0.02, 0.2, 0.04, 0.02], missing: [0.01, 0.01, 0.96, 0.01, 0.01, 0.01, 0.01, 0.03], scream: [0.18, 0.18, 0.1, 0.42, 0.12, 0.06, 0.04, 0.07],
  gunshots: [0.02, 0.02, 0.01, 0.94, 0.01, 0.01, 0.01, 0.01], robbery: [0.01, 0.01, 0.01, 0.96, 0.01, 0.01, 0.01, 0.01], fight: [0.03, 0.05, 0.02, 0.86, 0.04, 0.01, 0.01, 0.01], hostage: [0.01, 0.01, 0.01, 0.96, 0.01, 0.01, 0.01, 0.01],
  notbreathing: [0.02, 0.02, 0.01, 0.03, 0.92, 0.01, 0.03, 0.01], collapsed: [0.03, 0.06, 0.04, 0.06, 0.81, 0.02, 0.07, 0.02], fall: [0.02, 0.1, 0.03, 0.05, 0.8, 0.03, 0.01, 0.01],
  collapse: [0.03, 0.03, 0.01, 0.01, 0.01, 0.92, 0.01, 0.01], rumble: [0.1, 0.2, 0.02, 0.1, 0.02, 0.5, 0.06, 0.01],
  drowning: [0.01, 0.02, 0.03, 0.01, 0.03, 0.01, 0.01, 0.93],
  gasleak: [0.06, 0.01, 0.01, 0.01, 0.02, 0.01, 0.9, 0.01], fumes: [0.2, 0.02, 0.02, 0.03, 0.18, 0.02, 0.5, 0.01],
};

function natureFor(I: Incident, s: Scene, persona: Persona, rng: Rng): { v: string; truthful: boolean; note: string } {
  const t = I.truth.type, variant = I.truth.variant;
  if (variant === 'prank') return { v: rng.pick(['gunshots', 'robbery']), truthful: false, note: '장난 전화 — 실제 사건 없음' };
  if (variant === 'false') return { v: rng.chance(0.6) ? 'smell' : 'smoke', truthful: true, note: '' };      // 냄새·연기는 사실이지만 화재는 아니다
  if (t === 'medical') {
    const exactM = variant === 'arrest' ? 'notbreathing' : variant === 'trauma' ? 'fall' : 'collapsed';
    if (persona === 'wrong' && variant === 'arrest') return { v: 'collapsed', truthful: false, note: '심정지를 단순 실신처럼 신고' };
    if ((persona === 'confused' || persona === 'partial') && rng.chance(0.5)) return { v: 'collapsed', truthful: variant !== 'arrest', note: variant === 'arrest' ? '호흡이 없다는 사실을 말하지 못함' : '' };
    return { v: exactM, truthful: true, note: '' };
  }
  const exact = t === 'water' ? 'drowning' : t === 'collapse' ? 'collapse' : t === 'hazmat' ? 'gasleak' : t === 'fire' ? 'flames' : t === 'traffic' ? 'crash' : t === 'search' ? 'missing' : variant === 'shooter' ? 'gunshots' : variant === 'hostage' ? 'hostage' : variant === 'robbery' ? 'robbery' : 'fight';
  if (t === 'search') return { v: 'missing', truthful: true, note: '' };
  const vague = t === 'collapse' ? 'rumble' : t === 'hazmat' ? 'fumes' : t === 'fire' ? 'smoke' : t === 'traffic' ? 'bang' : 'scream';
  if (persona === 'calm') return { v: exact, truthful: true, note: '' };
  if (persona === 'panicked') return rng.chance(0.7) ? { v: exact, truthful: true, note: '' } : { v: vague, truthful: true, note: '' };
  if (persona === 'confused' || persona === 'partial') return rng.chance(0.3) ? { v: exact, truthful: true, note: '' } : { v: vague, truthful: true, note: '' };
  // wrong: 실제보다 축소하거나 다른 종류로 오인
  if (t === 'collapse') return { v: 'explosion', truthful: false, note: '붕괴를 폭발로 오인' };
  if (t === 'water') return { v: 'missing', truthful: false, note: '물에 빠진 것을 "사람이 없어졌다"고만 신고' };
  if (t === 'hazmat') return rng.chance(0.5) ? { v: 'collapsed', truthful: false, note: '가스 누출인 줄 모르고 "사람이 쓰러졌다"고만 신고' } : { v: 'smell', truthful: false, note: '가스 냄새를 타는 냄새로 신고' };
  if (t === 'fire') return rng.chance(0.55) ? { v: 'smell', truthful: false, note: '화재를 "타는 냄새" 정도로 축소 신고' } : { v: 'explosion', truthful: false, note: '화재를 폭발음으로 신고' };
  if (t === 'traffic') return rng.chance(0.5) ? { v: 'bang', truthful: false, note: '충돌 사고를 "큰 소리"로만 신고' } : { v: 'explosion', truthful: false, note: '충돌 사고를 폭발로 오인' };
  if (variant === 'dispute') return { v: 'gunshots', truthful: false, note: '단순 난동을 총격으로 과장 신고' };
  return { v: 'fight', truthful: false, note: '무장 사건을 단순 다툼으로 축소 신고' };
}

/** 사건의 진실에서 신고자가 "알고 있다고 믿는" 내용을 만든다. */
export function makeCaller(sim: Sim, I: Incident, s: Scene, rng: Rng, followup: boolean): Caller {
  let persona: Persona = followup ? rng.weighted<Persona>(['calm', 'panicked', 'partial', 'confused'], [0.45, 0.2, 0.25, 0.1])
    : rng.weighted<Persona>(['calm', 'panicked', 'confused', 'partial', 'wrong'], sim.tune.personaWeights);
  if (I.truth.variant === 'prank') persona = 'prank';
  const acc = ACC[persona], kn = KNOW[persona], cf = CONF[persona];
  const knows: Partial<Record<Topic, Claim>> = {};
  const put = (topic: Topic, value: any, text: string, truthful: boolean, note = '', conf = cf) => { knows[topic] = { topic, value, conf, text, truthful, callId: -1, note }; };
  const t = I.truth.type;
  // 위치: 당황하거나 상황 파악이 안 된 신고자는 옆 교차로를 대는 수가 있다
  const here = sim.city.nodes[I.truth.nodeId];
  if (!followup && rng.chance(sim.tune.wrongAddressProb * ADDR_ERR[persona])) {
    const e = sim.city.edges[rng.pick(here.edges)];
    const nb = e.a === here.id ? e.b : e.a;
    put('location', nb, `${nodeName(sim.city, nb)} 근처예요.`, false, `실제 위치는 ${nodeName(sim.city, here.id)}인데 ${josa(nodeName(sim.city, nb), '으로/로')} 신고`, 0.5 + cf * 0.3);
  } else put('location', I.truth.nodeId, `${nodeName(sim.city, I.truth.nodeId)} 근처예요.`, true, '', 0.95);
  if (persona === 'prank') {
    const nat0 = natureFor(I, s, persona, rng);
    put('nature', nat0.v, rng.pick(NATURE_TEXT[nat0.v]), false, nat0.note);
    put('weapon', 'gun', '총이요, 총! 엄청 큰 총이에요.', false, '장난 전화');
    put('injured', true, '어… 네, 다친 사람 엄청 많아요.', false, '장난 전화');
    put('detail', { suspects: 3 }, '세 명? 아니 다섯 명쯤 돼요.', false, '장난 전화');
    return { name: rng.pick(SURNAMES) + '○○', persona, knows, patience: 3, answerTime: 2.2 };
  }
  if (t === 'medical') {
    const pt = s.casualties[0];
    const arrest = I.truth.variant === 'arrest';
    const nat0 = natureFor(I, s, persona, rng);
    put('nature', nat0.v, rng.pick(NATURE_TEXT[nat0.v]), nat0.truthful, nat0.note);
    put('count', 1, '한 명이에요.', true, '', 0.9);
    if (rng.chance(Math.max(kn, 0.7))) {
      const ok = rng.chance(acc);
      const uncon = pt.health < 75 || arrest;
      const v = ok ? uncon : !uncon;
      put('injured', v, v ? '아니요, 의식이 없어요. 불러도 대답을 안 해요.' : '네, 의식은 있어요.', ok, ok ? '' : '의식 상태를 반대로 신고');
    }
    if (rng.chance(Math.max(kn, 0.65))) {
      const ok = rng.chance(acc) && nat0.truthful;
      const breathing = ok ? !arrest : arrest;
      put('detail', { breathing }, breathing ? '숨은 쉬는 것 같아요.' : '아니요, 숨을 안 쉬어요!', breathing === !arrest, breathing === !arrest ? '' : '호흡이 없는데 있다고 신고');
    }
    return { name: rng.pick(SURNAMES) + '○○', persona, knows, patience: persona === 'partial' ? 3 : 5, answerTime: persona === 'calm' ? 2.4 : persona === 'panicked' ? 3.4 : 3.2 };
  }
  const nat = natureFor(I, s, persona, rng);
  put('nature', nat.v, rng.pick(NATURE_TEXT[nat.v]), nat.truthful, nat.note);
  const cas = s.casualties;
  const nTrue = cas.length;
  const trappedTrue = t === 'fire' || t === 'hazmat' ? nTrue > 0 : t === 'armed' ? cas.some((c) => c.hostage) : cas.some((c) => c.mob === 'trapped');
  const injuredTrue = t === 'fire' || t === 'hazmat' ? nTrue > 0 : cas.some((c) => c.mob !== 'mobile' || c.health < 80);
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
    const yes = t === 'water' ? '물에 빠져서 못 나오고 있어요!' : t === 'collapse' ? '잔해 밑에 사람이 깔려 있어요!' : t === 'fire' || t === 'hazmat' ? '안에 아직 사람이 있어요!' : t === 'armed' ? '가게 안에 사람들이 못 나오고 있어요.' : '차 안에 사람이 끼어서 못 나와요.';
    const no = t === 'water' ? '다들 물 밖으로 나온 것 같아요.' : t === 'fire' || t === 'hazmat' || t === 'collapse' ? '사람들은 다 나온 것 같아요.' : t === 'armed' ? '안에 다른 사람은 없는 것 같아요.' : '다들 차 밖으로 나왔어요.';
    put('trapped', v, v ? yes : no, ok, ok ? '' : v ? '고립자가 없는데 있다고 신고' : '고립자가 있는데 "다 나왔다"고 신고');
  }
  // 위험 요소
  if (t === 'fire') {
    const gas = s.props.some((p) => p.kind === 'gas');
    if (gas && rng.chance(kn * 0.4)) put('hazard', 'gas', '안에 가스통 같은 게 있어요.', true);
    else if (rng.chance(kn * 0.7)) { const v = I.truth.severity >= 2 ? 'spreading' : 'small'; put('hazard', v, v === 'spreading' ? '불이 옆으로 번지고 있어요.' : '불이 크지는 않아요.', true); }
  } else if (t === 'water') {
    if (rng.chance(kn * 0.7)) put('hazard', 'current', '물살이 세요. 계속 떠내려가고 있어요.', true);
  } else if (t === 'collapse') {
    if (s.props.some((p) => p.kind === 'unstable') && rng.chance(kn * 0.6)) put('hazard', 'unstable', '아직도 뭐가 계속 떨어져요. 더 무너질 것 같아요.', true);
  } else if (t === 'hazmat') {
    if (rng.chance(Math.max(kn, 0.5))) put('hazard', 'gas', '가스가 계속 새고 있어요. 냄새가 점점 심해져요.', true);
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
  injured: { medical: '환자가 의식이 있습니까? 불러 보세요.', any: '다친 사람이 있습니까?' },
  count: { fire: '건물 안에 몇 명이나 있습니까?', traffic: '다친 사람은 모두 몇 명입니까?', armed: '안에 있는 사람은 몇 명입니까?', water: '물에 빠진 사람은 몇 명입니까?', collapse: '건물 안에 몇 명이나 있었습니까?', hazmat: '건물 안에 몇 명이나 있습니까?', search: '찾는 분은 몇 명입니까?', medical: '환자는 몇 명입니까?', any: '사람은 몇 명입니까?' },
  trapped: { water: '아직 물속에 있습니까, 물 밖으로 나왔습니까?', collapse: '잔해에 깔리거나 갇힌 사람이 있습니까?', hazmat: '건물 안에 아직 사람이 남아 있습니까?', fire: '건물 안에 아직 사람이 남아 있습니까?', traffic: '차 안에 갇힌 사람이 있습니까?', armed: '가게 안에 못 나온 사람이 있습니까?', any: '갇힌 사람이 있습니까?' },
  hazard: { water: '물살이 셉니까? 떠내려가고 있습니까?', collapse: '건물이 더 무너질 것 같습니까?', hazmat: '가스가 계속 새고 있습니까? 근처에 불씨가 있습니까?', fire: '불이 번지고 있습니까? 위험물이 있습니까?', traffic: '연료가 새거나 연기가 나는 차량이 있습니까?', any: '주변에 다른 위험한 것이 있습니까?' },
  weapon: { any: '무기를 가지고 있습니까? 어떤 무기입니까?' },
  detail: { fire: '사람이 있는 위치를 아십니까?', search: '마지막으로 본 곳이 어디입니까?', traffic: '차 밖으로 튕겨 나간 사람이 있습니까?', armed: '용의자는 몇 명입니까?', medical: '환자가 숨을 쉬고 있습니까? 가슴이 오르내리는지 보세요.', any: '더 알려 주실 내용이 있습니까?' },
};
const DONT_KNOW = ['잘 모르겠어요.', '그건 못 봤어요.', '거기까지는 모르겠어요.'];
const PANIC_NOISE = ['빨리 좀 와 주세요! 제발요!', '모르겠어요, 빨리요!', '아… 어떡해, 어떡해요!'];

const TOPIC_VALUE: Record<string, Partial<Record<Topic, number>>> = {
  fire: { trapped: 0.92, count: 0.7, detail: 0.66, hazard: 0.62, injured: 0.5 },
  traffic: { injured: 0.9, trapped: 0.84, count: 0.62, hazard: 0.6, detail: 0.5 },
  search: { detail: 0.92, injured: 0.6, count: 0.55 },
  armed: { weapon: 0.95, injured: 0.82, detail: 0.7, trapped: 0.64, count: 0.5 },
  medical: { detail: 0.95, injured: 0.85, count: 0.3 },
  collapse: { trapped: 0.94, count: 0.8, injured: 0.62, hazard: 0.6 },
  hazmat: { hazard: 0.88, trapped: 0.86, count: 0.7, injured: 0.6 },
  water: { trapped: 0.95, count: 0.82, hazard: 0.6, injured: 0.35 },
};

/** 사건과 무관한 비긴급 전화. [신고자, 접수 AI, 신고자, 접수 AI …] */
const NUISANCE: string[][] = [
  ['옆집에서 밤새 음악을 틀어서 잠을 못 자겠어요.', '위급한 상황은 아닙니까?', '그건 아닌데 너무 시끄러워요.', '긴급 신고 전화입니다. 소음 민원은 민원 창구로 문의해 주세요. 종료하겠습니다.'],
  ['고양이가 나무에 올라가서 못 내려와요.', '사람이 다치거나 위험한 상황입니까?', '아니요, 고양이만요.', '지금은 긴급 출동이 어렵습니다. 관할 동물 구조 창구를 안내해 드리겠습니다.'],
  ['지갑을 잃어버렸는데 어떻게 해야 하죠?', '분실 신고는 긴급 신고가 아닙니다. 가까운 지구대나 온라인으로 접수해 주세요.'],
  ['……', '여보세요? 긴급 신고 센터입니다. 말씀하세요.', '(주머니 속에서 잘못 걸린 전화)', '응답이 없어 오발신으로 판단하고 종료합니다.'],
  ['거기 치킨집 아니에요?', '긴급 신고 센터입니다. 잘못 거셨습니다. 종료하겠습니다.'],
  ['차를 누가 제 집 앞에 대 놨어요. 빼라고 해 주세요.', '통행이 완전히 막혀 위급한 상황입니까?', '그건 아니고 기분이 나빠서요.', '불법 주차 신고는 민원 창구에서 받습니다. 종료하겠습니다.'],
  ['버스 막차가 몇 시인지 아세요?', '긴급 신고 전화입니다. 교통 정보는 안내 전화로 문의해 주세요.'],
];

export function startCall(sim: Sim, I: Incident, followup: boolean): void {
  const s = sim.scenes[I.id]!;
  const rng = sim.rng.fork(`call:${I.id}:${I.callsCount}`);
  const call: Call = {
    id: sim.calls.length, incidentId: I.id, caller: makeCaller(sim, I, s, rng, followup), state: 'ringing',
    ringAt: sim.t, answeredAt: -1, endedAt: -1, transcript: [], asked: [], pending: null, nextAt: 0, phase: 'ask', retries: 0,
    linkedTo: -1, rng, isFollowup: followup, eventId: -1, kind: 'incident', instructed: false, script: [], scriptI: 0,
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
  if (claim.topic !== 'location') return;
  if (!I.locationKnown) { I.locationKnown = true; I.reportedNode = claim.value; return; }
  if (claim.value === I.reportedNode) return;
  // 두 신고자가 말한 위치가 다르다 → 더 확실하게 말한 쪽을 채택하고 출동 부대에 정정한다
  const first = I.claims.find((q) => q.topic === 'location')!;
  const adopt = claim.conf >= first.conf ? claim : first;
  emit(sim, { inc: I.id, role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 2, causes: [call.eventId], text: `위치 불일치: 첫 신고는 ${nodeName(sim.city, first.value)}, 추가 신고는 ${nodeName(sim.city, claim.value)}. 더 확실한 진술(${nodeName(sim.city, adopt.value)})을 채택합니다.` });
  if (adopt.value !== I.reportedNode) { I.reportedNode = adopt.value; redirectUnits(sim, I); }
}

const INSTRUCT: Record<string, { say: string; yes: string; no: string }> = {
  fire: { say: '안에 있는 분들에게 문을 닫고 낮은 자세로 나오라고 크게 외쳐 주세요. 직접 들어가지는 마세요.', yes: '네, 소리쳐 볼게요!', no: '무서워서 가까이 못 가겠어요…' },
  traffic: { say: '깨끗한 천으로 피 나는 곳을 세게 눌러 주세요. 환자를 옮기지는 마세요.', yes: '네, 누르고 있을게요.', no: '피를 못 보겠어요, 못 하겠어요…' },
  medical: { say: '제가 알려 드릴게요. 환자를 바로 눕히고 가슴 한가운데를 강하고 빠르게 계속 눌러 주세요.', yes: '네, 하고 있어요. 하나, 둘, 셋…', no: '못 하겠어요, 손이 떨려요…' },
  care: { say: '환자를 편하게 눕히고, 피가 나면 깨끗한 천으로 세게 눌러 주세요. 곁을 지키며 상태를 계속 봐 주세요.', yes: '네, 옆에서 보고 있을게요.', no: '어떻게 해야 할지 모르겠어요…' },
  search: { say: '지금 계신 곳에서 움직이지 말고 대원들을 기다려 주세요. 도착하면 본 것을 그대로 알려 주세요.', yes: '네, 여기서 기다릴게요.', no: '저도 찾으러 가 봐야겠어요.' },
};

/** 도착 전 안내: 접수 AI 가 신고자에게 할 일을 알려 준다. 따를지는 신고자에게 달렸고, 따르면 현장 상태가 실제로 바뀐다. */
function maybeInstruct(sim: Sim, call: Call, I: Incident): boolean {
  const as = I.assessment;
  if (call.instructed || call.isFollowup || !as || as.typeConf < 0.6 || call.caller.persona === 'prank') return false;
  const has = (topic: Topic, v: unknown): boolean => I.claims.some((c) => c.callId === call.id && c.topic === topic && c.value === v);
  const noBreath = I.claims.some((c) => (c.topic === 'nature' && c.value === 'notbreathing') || (c.topic === 'detail' && c.value && c.value.breathing === false));
  const kind = as.type === 'fire' && has('trapped', true) ? 'fire' : as.type === 'traffic' && has('injured', true) ? 'traffic' : as.type === 'medical' && call.asked.length >= 2 ? (noBreath ? 'medical' : 'care') : as.type === 'search' && call.asked.length >= 2 ? 'search' : '';
  if (!kind) return false;
  call.instructed = true;
  const complied = call.rng.chance(COMPLY[call.caller.persona]);
  const ev = say(sim, call, I, 'CALL_TAKER', INSTRUCT[kind].say, 1);
  say(sim, call, I, 'CALLER', complied ? INSTRUCT[kind].yes : INSTRUCT[kind].no);
  if (complied) applyCallerAid(sim, I, kind, ev);
  return true;
}

function nextTopic(sim: Sim, call: Call, I: Incident): Topic | null {
  if (!I.locationKnown && call.asked.indexOf('location') < 0) return 'location';
  const as = I.assessment;
  if (as && as.typeConf < 0.6 && call.asked.indexOf('nature') < 0) return 'nature';
  const hyp = as ? as.type : 'fire';
  const table = TOPIC_VALUE[hyp];
  let best: Topic | null = null, bs = 0;
  const elapsed = sim.t - call.answeredAt;
  if (!table) return null;
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

export function startNuisanceCall(sim: Sim): void {
  const rng = sim.rngNuisance;
  const script = rng.pick(NUISANCE);
  sim.calls.push({
    id: sim.calls.length, incidentId: -1, caller: { name: rng.pick(SURNAMES) + '○○', persona: 'calm', knows: {}, patience: 0, answerTime: 2.6 }, state: 'ringing',
    ringAt: sim.t, answeredAt: -1, endedAt: -1, transcript: [], asked: [], pending: null, nextAt: 0, phase: 'ask', retries: 0,
    linkedTo: -1, rng: rng.fork('n' + sim.calls.length), isFollowup: false, eventId: -1, kind: 'nuisance', instructed: false, script, scriptI: 0,
  });
}

/** 비긴급 전화: 사건은 아니지만 응대하는 동안 다른 신고가 기다린다. */
function tickNuisance(sim: Sim, call: Call): void {
  if (sim.t < call.nextAt) return;
  if (call.scriptI >= call.script.length) {
    call.state = 'done'; call.endedAt = sim.t; sim.activeCall = -1;
    const waiting = sim.calls.filter((c) => c.state === 'ringing').length;
    emit(sim, { role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 1, causes: [call.eventId], text: `비긴급 전화로 분류, 출동 없이 종결 (${Math.round(sim.t - call.answeredAt)}초 소요${waiting ? `, 그동안 신고 ${waiting}건 대기` : ''}).` });
    return;
  }
  const who = call.scriptI % 2 === 0 ? 'CALLER' : 'CALL_TAKER';
  const text = call.script[call.scriptI++];
  call.transcript.push({ t: sim.t, who, text });
  emit(sim, { role: who, actor: who === 'CALLER' ? `신고자 ${call.caller.name}` : '신고 접수 AI', kind: 'call', imp: 0, causes: [call.eventId], text });
  call.nextAt = sim.t + (who === 'CALLER' ? 2.4 : 3.2);
}

export function tickCalls(sim: Sim): void {
  // 벨이 울리는 전화 받기 (접수 AI 는 한 번에 한 통화만 처리한다)
  if (sim.activeCall < 0) {
    const ringing = sim.calls.find((c) => c.state === 'ringing');
    if (ringing && ringing.kind === 'nuisance') {
      ringing.state = 'active'; ringing.answeredAt = sim.t; sim.activeCall = ringing.id;
      ringing.eventId = emit(sim, { role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 1, text: '전화 수신. 긴급 신고 센터입니다. 어떤 상황입니까?' });
      ringing.transcript.push({ t: sim.t, who: 'CALL_TAKER', text: '긴급 신고 센터입니다. 어떤 상황입니까?' });
      ringing.nextAt = sim.t + 2;
    } else if (ringing) {
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
  if (call.kind === 'nuisance') { tickNuisance(sim, call); return; }
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
        emit(sim, { inc: I.id, role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 1, causes: [call.eventId], text: `사건 ${I.code}과 같은 건으로 판단합니다. 동일 사건의 추가 신고로 연결합니다.` });
      }
      // 장난 전화의 낌새: 진술이 오락가락하고 웃음소리가 섞인다. 알아챌 수도, 놓칠 수도 있다
      if (cl.persona === 'prank' && call.asked.length === 2 && call.rng.chance(0.65)) {
        recordClaim(sim, call, I, { topic: 'hazard', value: 'prank', conf: 0.7, text: '(수화기 너머로 웃음소리가 들리고 진술이 오락가락함)', truthful: true, callId: call.id, note: '' });
        emit(sim, { inc: I.id, role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 2, causes: [call.eventId], text: '진술이 오락가락하고 웃음소리가 들립니다. 허위 신고 가능성을 표시합니다. 다만 확인 출동은 필요합니다.' });
      }
      assess(sim, I, `신고자 진술(${topicName(topic)})`);
      if (maybeInstruct(sim, call, I)) { call.phase = 'ask'; call.nextAt = sim.t + 4.5; return; }
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
    const early = call.asked.length >= cl.patience && (cl.persona === 'partial' || cl.persona === 'prank');
    if (early) say(sim, call, I, 'CALLER', cl.persona === 'prank' ? '아 몰라요, 빨리 오기나 해요. (뚝)' : '저는 지나가다 본 거라 더는 몰라요. 끊을게요.');
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
