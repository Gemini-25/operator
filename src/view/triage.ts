// 중증도 색 한 곳 (docs/specs/H1-injuries.md §8.1) 과, 사람의 상태를 "화면에 무엇으로 보일까"로 옮기는 읽기 전용 함수들.
// 현장 그림(renderScene)·패널(panels·PersonCard)·범례(App)가 같은 값을 쓴다. styles.css 의 .band-0~3 도 같은 색이다(파일 끝 injuries 블록).
// DOM 이 없는 순수 함수 — 시험이 직접 부른다. 시뮬레이션 상태를 읽기만 한다(아무것도 바꾸지 않는다).
//
// 원칙(§원칙): 피 웅덩이·붉은 조각·신체 훼손을 그리지 않는다. 다친 정도는 분류 색(초록·노랑·빨강·검정), 들것·덮개, 자세, 글자로만 전한다.
// 시점 규칙(§8.4): 관찰자 시점은 진실을, AI 시점은 지휘관이 아는 것('cas'·'hos'·'mate' 사실)만 보인다.

import type { Sim } from '../sim/engine';
import { regionNameAt } from '../sim/field/agents';
import { CAUSE_NAME, bandOf } from '../sim/field/injury';
import type { CasBelief, Casualty, Fact, FieldAgent, Hostile, Injury, InjuryCause, Responder, Scene, SimEvent } from '../sim/types';
import { fmtClock } from '../sim/util';

/** 초록(경상) · 노랑(중상) · 빨강(위중) · 검정(사망) */
export const TRIAGE = ['#5ad17a', '#ffd166', '#ff5d5d', '#14181d'];
/** 딱지의 테두리: 검정 딱지는 어두운 배경(#070b10) 위에서 보이게 밝은 테두리를 두른다 */
export const TRIAGE_EDGE = ['#0b1219', '#0b1219', '#0b1219', '#cfd6dc'];
/** 딱지 안의 글자색: 검정 딱지는 흰 글씨 */
export const TRIAGE_TEXT = ['#0b1219', '#0b1219', '#0b1219', '#e8f0f7'];
export const TRIAGE_NAME = ['경상', '중상', '위중', '사망'];
/** 순직·사망 기록의 차분한 회청색 (빨강 '경고'로 보이지 않게 — 속보·무전 기록·보고서 타일) */
export const LOSS_COLOR = '#8fa3b8';

/** 순직·사망 기록인가: 속보와 무전 기록에서 빨간 '경고'가 아니라 차분한 회청색(loss)으로 보인다 (§8.4) */
export function isLoss(e: SimEvent): boolean {
  const p = e.problem as string | null;      // RESPONDER_KILLED·SUSPECT_DIED 는 뒤 단계(4a·5)가 ProblemCode 에 더한다
  return p === 'RESPONDER_KILLED' || p === 'SUSPECT_DIED' || (e.kind === 'casualty' && e.importance >= 3);
}

// ───────────────────────── 중증도 ─────────────────────────
/** 구조 대상: 숨졌으면 사망(3) */
export function casBand(c: Casualty): number { return c.dead ? 3 : Math.min(2, bandOf(c.health)); }
/** 대원: 순직(r.dead)만 사망으로 보인다 — 체력이 바닥이어도 숨지지 않았으면 위중 */
export function respBand(r: Responder): number { return r.dead ? 3 : Math.min(2, bandOf(r.health)); }
/** 용의자: 사망(h.dead)만 사망으로 보인다 — 쓰러진(제압된) 용의자는 위중 */
export function hostileBand(h: Hostile): number { return h.dead ? 3 : Math.min(2, bandOf(h.health)); }

/** 다친 자세의 세기 0..1 (0 = 멀쩡). 대원은 중상(체력 70 이하)부터, 용의자는 체력 60 아래부터 — 걸음이 줄고 몸이 기운다 */
export function hurtPose(health: number, from: number): number {
  if (health > from) return 0;
  return Math.max(0.3, Math.min(1, (from - health) / (from - 25)));
}

// ───────────────────────── 부상 기록을 글로 ─────────────────────────
/** 원인별 피해를 큰 것부터: "총상 32 · 연기 흡입 8". 반올림해 0 인 것은 뺀다(처음 원인만 있고 깎인 것이 없으면 이름만) */
export function injuryLine(list: Injury[] | undefined, max = 4): string {
  if (!list || !list.length) return '';
  const rows = list.slice().sort((a, b) => b.dmg - a.dmg || a.t - b.t);
  const out: string[] = [];
  for (const j of rows) { const n = Math.round(j.dmg); if (n >= 1 && out.length < max) out.push(`${CAUSE_NAME[j.cause]} ${n}`); }
  return out.length ? out.join(' · ') : CAUSE_NAME[rows[0].cause];
}
/**
 * 교대 보고서의 대원 목록 한 줄 (H1 §8.4 — 단계 6): '위중 · 총상 · 병원 이송 · 결장 예상 2', 순직은 '순직 · 화상 · 03'(그 사건의 번호).
 * 보고서에 적힌 값(ShiftReport.respondersHurt·respondersKilled)만 읽는다
 */
export function reportHurtText(x: { status: string; band?: number; cause?: InjuryCause | null; dead?: boolean; hospital?: boolean; out?: number; name: string }, killed: { name: string; incident: string }[] = []): string {
  const parts: string[] = [];
  if (x.dead) {
    parts.push('순직');
    if (x.cause) parts.push(CAUSE_NAME[x.cause]);
    const k = killed.find((q) => q.name === x.name);
    if (k && k.incident) parts.push(`사건 ${k.incident}`);      // (단계 7) 번호만 쓰면 '· 17' 이 무엇인지 읽히지 않았다
    return parts.join(' · ');
  }
  parts.push(x.band !== undefined ? TRIAGE_NAME[Math.min(2, x.band)] : x.status);
  if (x.status === '쓰러짐') parts.push('쓰러짐');
  if (x.cause) parts.push(CAUSE_NAME[x.cause]);
  if (x.hospital) parts.push('병원 이송');
  if (x.out !== undefined && x.out > 0) parts.push(`결장 예상 ${x.out}`);
  return parts.join(' · ');
}
/** 받은 처치를 글로 (0 없음 … 1 전문) */
export function careName(q: number | undefined): string { return !q || q <= 0 ? '없음' : q >= 0.6 ? '전문 처치' : '기본 처치'; }

// ───────────────────────── 덮개·누움 (§8.2) ─────────────────────────
/** 덮개는 "확인된 사망"부터 그린다: 구조 대상은 발견된 뒤 (관찰자 시점의 미발견 사망은 덮개 없이 누운 채 흐린 검정 딱지) */
export function casSheet(c: Casualty): boolean { return c.dead && c.tDiscovered >= 0; }
/** 대원의 덮개: 관찰자 시점은 숨진 3초 뒤, AI 시점은 지휘관이 숨진 줄 알 때('mate' 사실의 dead) */
export function respSheet(sim: Sim, r: Responder, truth: boolean, cmd: FieldAgent | undefined): boolean {
  if (!r.dead) return false;
  if (truth) return sim.t >= (r.tDead ?? sim.t) + 3;
  const f = cmd ? cmd.beliefs.get('mate', r.id) : undefined;
  return !!f && !!f.value && f.value.dead === true;
}
/** 용의자의 덮개: 같은 규칙 ('hos' 사실의 dead) */
export function hostileSheet(sim: Sim, h: Hostile, truth: boolean, cmd: FieldAgent | undefined): boolean {
  if (!h.dead) return false;
  if (truth) return sim.t >= (h.tDead ?? sim.t) + 3;
  const f = cmd ? cmd.beliefs.get('hos', h.id) : undefined;
  return !!f && !!f.value && f.value.dead === true;
}
/**
 * 대원을 눕혀 그리는가: 쓰러져 있거나, 쓰러졌다가 안전 구역으로 옮겨진 대원(명부의 상태가 '쓰러짐' 그대로다).
 * 예전에는 옮겨진 대원이 다시 서 있게 그려졌다.
 */
export function respLying(a: FieldAgent, r: Responder): boolean {
  return a.status === 'down' || (a.status === 'withdrawn' && (r.status === 'down' || r.tDown !== undefined || r.dead === true));
}
/** 그 구조 대상을 화면에 그리는가: 차에 실렸거나 병원에 갔거나, 물살에 현장 밖으로 떠내려간 사람은 그리지 않는다 */
export function casDrawn(c: Casualty): boolean { return c.where !== 'loaded' && c.where !== 'hospital' && !c.lost; }
/** 그 용의자를 화면에 그리는가: 달아났거나 차에 실려 간 용의자는 그리지 않는다 */
export function hostileDrawn(h: Hostile): boolean { return h.state !== 'escaped' && (h.where === undefined || h.where === 'scene'); }

// ───────────────────────── 대원의 상태 글 (패널) ─────────────────────────
/** 명부의 상태를 글로: 순직 · 병원 인계 · 후송 중 · 쓰러짐 · 부상 · (없음) */
export function respStateText(r: Responder): string {
  if (r.dead) return '순직';
  if (r.care === 'hospital') return '병원 인계';
  if (r.care === 'aboard') return '후송 중';
  if (r.status === 'down') return '쓰러짐';
  if (r.status === 'injured') return '부상';
  return '';
}
/** 현장 대원의 지금 상태 (대원 정보창의 '상태' 줄) */
export function agentStateText(a: FieldAgent, r: Responder): string {
  if (r.dead) return '순직';
  if (a.status === 'active') return a.label || '판단 중';
  if (a.status === 'down') return '쓰러짐';
  if (a.status === 'withdrawn') return (r.treatQ ?? 0) > 0 ? '처치 받음 — 후송 대기' : r.status === 'down' ? '쓰러짐 — 후송 대기' : '부상 — 후송 대기';
  return '이동';
}

// ───────────────────────── 사람 정보창의 내용 (PersonCard) ─────────────────────────
export interface PersonRow { k: string; v: string }
export interface PersonInfo {
  title: string; sub: string;
  band: number | null;        // 중증도 (모르면 null)
  health: number | null;      // 체력 0..100 (관찰자 시점만)
  rows: PersonRow[];
  times: PersonRow[];         // 타임라인 (관찰자 시점만)
  note: string;               // AI 시점에서 무엇을 근거로 보였는가
  known: boolean;             // 지휘관이 이 사람을 아는가
}
const MOB_NAME: Record<string, string> = { mobile: '걸을 수 있음', immobile: '거동 불가', trapped: '고립' };
const WHERE_NAME: Record<string, string> = { scene: '현장', carried: '옮겨지는 중', safe: '안전 구역', loaded: '구급차 탑승', hospital: '병원' };
const HOS_STATE: Record<string, string> = { hold: '대치', fight: '교전', flee: '도주', surrendered: '투항', arrested: '검거', down: '쓰러짐', escaped: '도주함' };
const WEAPON_NAME: Record<string, string> = { gun: '총', knife: '칼', none: '없음' };

function factNote(sim: Sim, f: Fact): string { return `${f.src} 보고 · ${fmtClock(sim.startTod + f.t)}${f.verified ? '' : ' · 미확인'}`; }

/**
 * 구조 대상의 정보. 관찰자 시점은 진실(체력·원인별 부상·타임라인), AI 시점은 지휘관의 'cas' 사실만.
 * cmd 가 없으면(현장에 지휘관이 없다) AI 시점에서는 아는 것이 없다.
 */
export function casInfo(sim: Sim, s: Scene, c: Casualty, truth: boolean, cmd: FieldAgent | undefined): PersonInfo {
  const title = `구조 대상 ${c.label}`;
  if (!truth) {
    const f = cmd ? cmd.beliefs.get('cas', c.id) : undefined;
    if (!f) return { title, sub: '', band: null, health: null, rows: [], times: [], note: '지휘관에게 아직 보고되지 않았습니다.', known: false };
    const v = f.value as CasBelief;
    return {
      title, sub: c.hostage ? '인질' : c.isTarget ? '수색 대상' : '', band: v.band, health: null,
      rows: [
        { k: '중증도', v: TRIAGE_NAME[v.band] }, { k: '거동', v: MOB_NAME[v.mob] ?? v.mob }, { k: '위치', v: WHERE_NAME[v.where] ?? v.where },
        { k: '처치', v: v.tq >= 2 ? '전문 처치' : v.tq >= 1 ? '기본 처치' : '없음' },
      ],
      times: [], note: `지휘관이 아는 내용 — ${factNote(sim, f)}`, known: true,
    };
  }
  const band = casBand(c);
  const rows: PersonRow[] = [
    { k: '중증도', v: TRIAGE_NAME[band] },
    { k: '거동', v: c.dead ? '—' : c.inWater ? (c.drift ? '물속 — 떠내려가는 중' : '물속 — 걸려 있음') : c.mob === 'trapped' ? (c.inVehicle !== null ? '차 안에 갇힘' : '매몰') : c.walking ? '스스로 대피 중' : MOB_NAME[c.mob] },
    { k: '위치', v: c.lost ? '현장 밖 (떠내려감)' : c.where === 'scene' ? regionNameAt(s, c.x, c.y) : WHERE_NAME[c.where] },
    { k: '부상', v: injuryLine(c.injuries) || '없음' },
  ];
  if (!c.dead && c.bleed > 0 && c.bleedCause) rows.push({ k: '악화', v: `${CAUSE_NAME[c.bleedCause]}${c.treated ? ' (처치로 늦춤)' : ''}` });
  if (c.dead && c.deathCause) rows.push({ k: '숨진 원인', v: CAUSE_NAME[c.deathCause] });
  rows.push({ k: '처치', v: careName(c.treated ? Math.max(c.treatQ, 0.01) : 0) });
  const times: PersonRow[] = [];
  const at = (k: string, t: number): void => { if (t >= 0) times.push({ k, v: fmtClock(sim.startTod + t) }); };
  at('발견', c.tDiscovered); at('구출', c.tFreed); at('처치', c.tTreated); at('안전 구역', c.tSafe); at('탑승', c.tLoaded); at('병원', c.tHospital); at('사망', c.tDead);
  return {
    title, sub: [c.hostage ? '인질' : '', c.isTarget ? '수색 대상' : '', c.bystander2 ? '주변 시민' : '', c.tDiscovered < 0 ? 'AI 미확인' : ''].filter(Boolean).join(' · '),
    band, health: c.dead ? 0 : c.health, rows, times, note: '', known: c.tDiscovered >= 0,
  };
}

/** 용의자의 정보. 관찰자 시점은 진실(상태·무기·부상·처치·이송), AI 시점은 지휘관의 'hos' 사실만 */
export function hostileInfo(sim: Sim, s: Scene, h: Hostile, truth: boolean, cmd: FieldAgent | undefined): PersonInfo {
  const title = h.label;
  if (!truth) {
    const f = cmd ? cmd.beliefs.get('hos', h.id) : undefined;
    if (!f) return { title, sub: '', band: null, health: null, rows: [], times: [], note: '지휘관에게 아직 보고되지 않았습니다.', known: false };
    const v = f.value as { weapon: string; state: string; hostage: boolean; dead?: boolean; band?: number; tq?: number };
    const rows: PersonRow[] = [{ k: '상태', v: v.dead ? '사망' : HOS_STATE[v.state] ?? v.state }, { k: '무기', v: WEAPON_NAME[v.weapon] ?? v.weapon }];
    if (v.hostage) rows.push({ k: '인질', v: '붙잡고 있음' });
    if (v.band !== undefined) rows.push({ k: '중증도', v: TRIAGE_NAME[v.dead ? 3 : v.band] });
    if (v.tq !== undefined) rows.push({ k: '처치', v: v.tq >= 2 ? '전문 처치' : v.tq >= 1 ? '기본 처치' : '없음' });
    return { title, sub: '', band: v.dead ? 3 : v.band ?? null, health: null, rows, times: [], note: `지휘관이 아는 내용 — ${factNote(sim, f)}`, known: true };
  }
  const band = hostileBand(h);
  const hurt = h.health < 100 || (h.injuries !== undefined && h.injuries.length > 0);
  const rows: PersonRow[] = [
    { k: '상태', v: h.dead ? '사망' : sim.t < h.stunUntil ? '무력화' : HOS_STATE[h.state] ?? h.state },
    { k: '무기', v: WEAPON_NAME[h.weapon] },
    { k: '위치', v: h.where === 'aboard' ? '구급차 탑승' : h.where === 'hospital' ? '병원' : h.state === 'escaped' ? '현장 밖' : regionNameAt(s, h.x, h.y) },
  ];
  if (h.hostageId >= 0 && (h.state === 'hold' || h.state === 'fight')) rows.push({ k: '인질', v: `구조 대상 ${s.casualties[h.hostageId].label}` });
  rows.push({ k: '부상', v: hurt ? `${TRIAGE_NAME[band]} — ${injuryLine(h.injuries) || '원인 기록 없음'}` : '없음' });
  if (!h.dead && (h.bleed ?? 0) > 0 && h.bleedCause) rows.push({ k: '악화', v: CAUSE_NAME[h.bleedCause] });      // 숨진 사람은 악화를 보이지 않는다 (구조 대상과 같다)
  if (h.dead && h.deathCause) rows.push({ k: '숨진 원인', v: CAUSE_NAME[h.deathCause] });
  if (hurt) rows.push({ k: '처치', v: careName(h.treatQ) });
  const times: PersonRow[] = [];
  const at = (k: string, t: number | undefined): void => { if (t !== undefined && t >= 0) times.push({ k, v: fmtClock(sim.startTod + t) }); };
  at('쓰러짐', h.tDown); at('처치', h.tTreated); at('사망', h.tDead);
  return { title, sub: h.hidden ? '숨어 있음 · AI 미확인' : '', band: hurt ? band : null, health: h.dead ? 0 : Math.max(0, h.health), rows, times, note: '', known: !h.hidden };
}
