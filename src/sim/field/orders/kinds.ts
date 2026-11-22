// 사건 종류 다양화 ① 일상 사건의 지휘 규칙 (docs/specs/N8-incident-kinds.md §4) — 지휘관의 믿음(a.beliefs)과 현장의 생김새만 읽는다.
// 진실(소품·구조 대상·용의자의 진실 칸·사건의 진실·시나리오의 정체)을 읽지 않는다 (tests/ext.test.ts · tests/kinds.test.ts 시험 4 가 글자로 본다).
// registerOrders((sim, s, I, a, k) => void) — 지휘관이 계획을 세울 때마다(syncBoard 끝, 핵심 규칙 뒤) 불린다. 자기 현장이 아니면 첫 줄에서 돌아간다.
//
// 단계 3: 오인 신고의 답 — 물에 뜬 물건·폭죽 잔해를 확인했으면 남은 수색을 거둔다.
import { emit } from '../../events';
import { josa } from '../../util';
import { resp } from '../agents';
import { mkFact } from '../beliefs';
import { staticPass } from '../grid';
import { registerBlocker, registerCasHold, registerHosHold, registerOrders, registerPending, registerPropHold } from '../sceneRegistry';
import { ATTACH_GAS, ATTACH_TOW } from '../../scenarios/kinds';
import { VALVE_LATE, meetOf } from '../agents';
import type { AniBelief, CasBelief, FieldAgent, Scene } from '../../types';
import type { Sim } from '../../engine';

/** 오인 신고의 판단을 알린 현장 (기록은 한 번 — 늦게 닿은 수색 보고가 확인율을 낮추면 믿음만 조용히 다시 고친다). 객체 모양을 바꾸지 않으려고 WeakSet */
const TOLD = new WeakSet<Scene>();

/**
 * (N2 오인 신고) 지휘관이 "물에 떠 있는 것은 사람이 아님"(evid floater) 또는 "폭죽 잔해 — 총소리가 아니었음"(evid fireworks)을 알고,
 * 믿음에 구조 대상도 용의자도 없으면 신고된 일이 없었다고 판단한다: 아직 덜 본 수색 구역을 지휘관의 판단으로 확인됨(0.9)으로 적고 열린 수색을 거둔다.
 * 핵심 규칙(syncBoard)은 확인율이 문턱(0.72 · 재수색 0.9)을 넘은 구역에 수색을 내지 않으므로 다음 주기에 다시 생기지 않는다(원칙 10 — 거둔 일이 되살아나지 않게 믿음을 고친다).
 * 남은 수색이 없으면 지금의 길로 닫는다(무장은 안전 확보 선언 → 종료). 믿음은 한 번만 고치므로 되풀이되지 않는다
 */
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'armed' && s.kind !== 'water') return;
  const B = a.beliefs;
  let why = '';
  for (const f of B.list('evid')) { const kd = f.value && f.value.kind; if (kd === 'fireworks') { why = '폭죽 잔해 확인 — 총소리가 아니었습니다'; break; } if (kd === 'floater') { why = '물에 뜬 것은 사람이 아니었습니다'; break; } }
  if (!why || B.list('cas').length > 0 || B.list('hos').length > 0) return;
  let n = 0;
  for (const r of s.regions) {
    if (!r.searchable || r.kind === 'wreck') continue;
    if ((B.val<number>('srch', r.id) ?? -1) >= 0.9) continue;
    B.merge(mkFact('srch', r.id, 0.9, '지휘관 판단', sim.t, 0.7, true, `${r.name} 수색 생략 — ${why}`));
    n++;
  }
  if (!n) return;
  k.cancel((w) => w.kind === 'search');
  if (TOLD.has(s)) return;
  TOLD.add(s);
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, text: `${why}. 신고된 일은 없던 것으로 보고 남은 수색을 거둡니다.` });
});

// ───────────────────────── 시설 사고 (§4.2 — 단계 4a·4b) ─────────────────────────
// 믿음의 haz 사실(시설물 — 사실의 id 는 그 소품의 id)만 읽는다. 살아 있는 시설물마다: ① 반경 밖 통제(cordon) ② 복구(repair — 복구반, 수도관은 120초 뒤 소방의 제수밸브)
// ·고정/보강(mitigate — 간판·구멍) ③ 반경 안 구조 대상의 보류(registerCasHold — 전선만) ④ 차로 통제는 핵심 규칙이 이미 낸다 ⑤ 종료 막기(registerBlocker) ⑥ 남은 일(registerPending).

/** 들어가면 다치는 반경(사람 보류 — 전선) */
const HOLD_HAZ: ReadonlySet<string> = new Set(['wire']);
/** 살아 있으면 끝내지 않는 시설물 (전선 · 관 · 매달린 간판 — 구멍은 끝을 막지 않는다: 구출·관·통제로 끝난다) */
const BLOCK_HAZ: ReadonlySet<string> = new Set(['wire', 'pipe', 'sign']);
interface HazV { kind?: string; active?: boolean; x: number; y: number; r?: number; pipe?: string; sub?: string; checked?: boolean }
/** 이 지휘관이 아는 살아 있는 시설물의 위험 반경 안인가 (믿음만 — 사람 보류의 반경) */
function inLiveHaz(a: FieldAgent, x: number, y: number): boolean {
  for (const f of a.beliefs.list('haz')) {
    const v = f.value as HazV;
    if (!v.active || !v.kind || !HOLD_HAZ.has(v.kind) || !(v.r !== undefined && v.r > 0)) continue;
    const dx = x - v.x, dy = y - v.y;
    if (dx * dx + dy * dy <= v.r * v.r) return true;
  }
  return false;
}
/**
 * 시설물 둘레의 통제 자리 둘 (격자 칸 번호): 시설물이 가까운 보도(위 y 7 · 아래 y 12 — 길 현장의 생김새)의 반경 밖 양쪽(가운데에서 r + gap 칸).
 * 걸을 수 없는 칸이면 한 칸씩 바깥으로 민다. 믿음 속 자리·반경과 현장의 칸(s.tiles — 생김새)만 쓴다
 */
function cordonTiles(s: Scene, v: HazV, gap: number): number[] {
  const y = v.y <= 9.5 ? 7 : 12, r = v.r ?? 2.2, out: number[] = [];
  for (const dir of [-1, 1]) {
    let x = Math.round(v.x + dir * (r + gap));
    for (let k = 0; k < 4 && x > 0 && x < s.w - 1 && !staticPass(s.tiles[y * s.w + x]); k++) x += dir;
    if (x > 0 && x < s.w - 1 && staticPass(s.tiles[y * s.w + x])) out.push(y * s.w + x);
  }
  return out;
}
const HOLD_KINDS: ReadonlySet<string> = new Set(['treat', 'carry', 'extricate', 'escort', 'load']);
/** (§4.2 utility/sinkhole) 구멍 둘레에 남은 일이 있는가 (믿음만): 구멍 안의 사람(cas.pit) · 살아 있는 관(pipe) · 막지 않은 누출(leak) */
function holeWork(a: FieldAgent): boolean {
  for (const f of a.beliefs.list('cas')) { const c = f.value as CasBelief; if (c.where === 'scene' && c.pit === true) return true; }
  for (const f of a.beliefs.list('haz')) { const v = f.value as HazV; if (v.active && (v.kind === 'pipe' || v.kind === 'leak')) return true; }
  return false;
}
/** (§4.2 utility/sinkhole) 구멍에 빠진 사람의 줄 구출 우선순위: 가장자리를 보강하기 전에는 낮춰 지지대가 먼저 서게 한다 */
const HAUL_P = { before: 0.6, after: 0.88 };

registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'utility') return;
  void I;
  let holeShored: boolean | null = null, hole = false;
  for (const f of a.beliefs.list('haz')) if ((f.value as HazV).kind === 'hole') hole = true;
  const keep: number[] = [];
  for (const f of a.beliefs.list('haz')) {
    const v = f.value as HazV;
    if (!v.kind) continue;
    if (v.kind === 'wire' || v.kind === 'pipe') {
      if (v.active) {
        if (!hole) for (const t of cordonTiles(s, v, 1.3)) { keep.push(t); k.want('cordon', { tile: t }, 0.8); }      // 구멍 곁의 관은 구멍의 통제가 덮는다
        const w = k.want('repair', { prop: f.id }, 0.9);
        // (§5.3.6 ③) 시간 막이: 물 관의 복구가 VALVE_LATE 초 넘게 열렸는데 오는 수도 복구반도 소방도 없다 — 제수밸브를 잠글 소방(손 공구)을 부른다 (request 가 70초 안의 되풀이를 막는다)
        if (v.kind === 'pipe' && v.pipe !== 'gas' && w.id >= 0 && sim.t - w.createdAt > VALVE_LATE && k.countUnits('utilWater', 0.7) === 0 && k.countUnits('suppression', 0.7) === 0) k.request('suppression', '수도 복구반이 오지 않아 제수밸브를 잠글 소방 부대가 필요함', false);
      } else k.cancel((w) => w.kind === 'repair' && w.prop === f.id);
    } else if (v.kind === 'sign') {
      // (4b) 떨어질 듯한 간판: 낙하 구역 통제(0.85) · 고정(0.86 — 사다리차의 사다리 조작원·팀장 또는 구조 로프). 떨어졌으면 잔해는 핵심 규칙의 차로 정리가 맡는다
      if (v.active) {
        for (const t of cordonTiles(s, v, 1.3)) { keep.push(t); k.want('cordon', { tile: t }, 0.85); }
        k.want('mitigate', { prop: f.id }, 0.86);
      } else k.cancel((w) => w.kind === 'mitigate' && w.prop === f.id);
    } else if (v.kind === 'hole') {
      // (4b) 싱크홀: 반경 + 3 의 통제(구멍은 넓어진다 — 반경이 바뀌면 자리도 바뀐다) · 가장자리 보강(0.86). 보강 뒤에도 통제는 남긴다 — 빠진 사람·살아 있는 관이 끝날 때까지
      // (그 뒤의 길 통제는 닫힐 때 넘기는 복구 공사가 맡는다 — 시나리오 onClose. 통제를 끝없이 세워 두면 상황 종료가 나지 않는다)
      // 보강도 빠진 사람·관이 남았을 때만 — 다 끝났으면 넓어지는 구멍은 도로 복구 공사가 맡는다 (보강할 사람이 없는 채 끝까지 열어 두면 종료가 막혔다)
      const work = holeWork(a);
      if (work) for (const t of cordonTiles(s, v, 3)) { keep.push(t); k.want('cordon', { tile: t }, 0.8); }
      if (v.active && work) k.want('mitigate', { prop: f.id }, 0.86);
      else k.cancel((w) => w.kind === 'mitigate' && w.prop === f.id);
      holeShored = v.active !== true;
    }
  }
  // 지금의 믿음이 내지 않는 통제 자리는 거둔다 (시설물이 죽었거나 구멍이 넓어져 자리가 바뀌었다)
  k.cancel((w) => w.kind === 'cordon' && keep.indexOf(w.tile) < 0);
  // (4b) 구멍에 빠진 사람(믿음 cas.pit): 보강 전에는 구출을 낮춘다 (핵심 규칙이 낸 작업의 우선순위만 바꾼다 — 있는 작업이면 want 가 고친다)
  if (holeShored !== null) for (const f of a.beliefs.list('cas')) {
    const c = f.value as CasBelief;
    if (c.where === 'scene' && c.mob === 'trapped' && c.pit === true) k.want('extricate', { cas: f.id }, holeShored ? HAUL_P.after : HAUL_P.before);
  }
  // 보류된 사람에게 이미 열려 있던 핵심 규칙의 일을 거둔다 (보류가 시작된 뒤에는 핵심 규칙이 다시 내지 않으므로 되풀이가 없다)
  for (const f of a.beliefs.list('cas')) {
    const c = f.value as CasBelief;
    if (c.where !== 'scene' || !inLiveHaz(a, c.x, c.y)) continue;
    k.cancel((w) => w.cas === f.id && w.status === 'open' && HOLD_KINDS.has(w.kind));
  }
});
/** (§5.7 · §5.10) 믿음 속 살아 있는 전선의 반경 안에 있는 사람: 핵심 규칙이 구출·처치·이송·동행·탑승을 내지 않는다 (fitBase 의 반경 줄과 함께) */
registerCasHold((sim, s, a, id, c) => { void sim; void id; return s.kind === 'utility' && c.where === 'scene' && inLiveHaz(a, c.x, c.y); });
/** 살아 있는 시설물(전선·관·간판)이 있다고 믿으면 상황 종료를 선언하지 않는다 */
registerBlocker((sim, s, a) => {
  void sim;
  if (s.kind !== 'utility') return false;
  for (const f of a.beliefs.list('haz')) { const v = f.value as HazV; if (v.active && v.kind && BLOCK_HAZ.has(v.kind)) return true; }
  return false;
});
/**
 * (§5.7) 마지막 부대가 떠났는데 살아 있는 시설물이 남았다: 그 시설물의 수요 — 전선 → 전력 복구, 관 → 수도(가스 관이면 가스) 복구, 매달린 간판 → 구조(로프 대원 — 펌프차는
 * 최소 인원에서 줄이 없다). 와 있는 복구반이 채우는 수요면 7번 블록이 통제 부대로 바꾼다
 */
registerPending((sim, s, a) => {
  void sim;
  if (s.kind !== 'utility') return null;
  for (const f of a.beliefs.list('haz')) {
    const v = f.value as HazV;
    if (!v.active) continue;
    if (v.kind === 'wire') return 'utilPower';
    if (v.kind === 'pipe') return v.pipe === 'gas' ? 'utilGas' : 'utilWater';
    if (v.kind === 'sign') return 'rescue';
  }
  return null;
});

// ───────────────────────── 가스 누출의 공급 차단 확인 (§5.3.8 — 단계 4b, 선택 수요) ─────────────────────────
/** 공급 차단 확인을 접은 현장 (가스 복구반이 120초 넘게 오지 않았다 — 다시 내지 않는다). 객체 모양을 바꾸지 않으려고 WeakSet */
const GAS_GIVEUP = new WeakSet<Scene>();
/** 공급 차단 확인 작업을 기다리는 상한 (초 — 이 시간이 넘도록 가스 복구반이 현장에 없으면 거둔다) */
export const GAS_WAIT = 120;
/**
 * 가스 누출(평가 유형과 상관없이 현장이 가스 누출)의 밸브를 막았다고 믿은 뒤(haz leak · sub 'valve' · active false), 가스 복구반이 배정돼 있으면 "공급 차단 확인"(repair — 0.5)을 낸다.
 * 가스 복구반이 배정되지 않았거나 그 작업이 만들어진 지 120초가 넘도록 현장에 없으면 거둔다(문제 코드 없음 — 밸브는 이미 막혔다). 확인을 마치면 믿음에 checked 가 붙어 다시 내지 않는다
 */
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'hazmat' || !ATTACH_GAS) return;
  void I;
  const coming = k.countUnits('utilGas', 0.7) > 0;
  let onScene = false;
  for (const uid of k.unitsOnScene()) if (sim.units[uid].caps.utilGas >= 0.7) { onScene = true; break; }
  for (const f of a.beliefs.list('haz')) {
    const v = f.value as HazV;
    if (v.kind !== 'leak' || v.sub !== 'valve' || v.active) continue;
    if (v.checked || GAS_GIVEUP.has(s) || !coming) { k.cancel((w) => w.kind === 'repair' && w.prop === f.id); continue; }
    const w = k.want('repair', { prop: f.id }, 0.5);
    if (w.id >= 0 && !onScene && sim.t - w.createdAt > GAS_WAIT) { GAS_GIVEUP.add(s); k.cancel((q) => q.kind === 'repair' && q.prop === f.id); }
  }
});

// ───────────────────────── 동물 (§4.3 — 단계 5) ─────────────────────────
// 믿음의 'ani' 사실(동물 — id 는 동물의 id)과 haz 의 벌집(id 는 소품 id)만 읽는다. 생김새: s.exits·s.exitKind(출구의 종류)·구역(s.regions)·칸(s.tiles).

/** 동물의 위험 반경 (칸 — 이 안의 사람에게 가는 일은 보류한다) */
export const ANI_R = 3;
/**
 * 동물 현장의 통제 우선순위 (설계서 §4.3 의 0.8 에서 낮췄다): 포획(0.88)이 통제보다 0.22 넘게 높아야 통제에 선 포획팀을 빼 온다.
 * 0.8 이면 먼저 내린 포획팀이 찻길 출구를 지키다 올가미가 실패한 뒤 마취총을 든 팀장이 영영 포획을 맡지 못했다(강제 멧돼지 20교대의 한계 시간 14건)
 */
export const ANI_CORDON = 0.62;
/** 이 지휘관이 아는 풀린 동물(자리를 아는) 또는 살아 있는 벌집의 반경 안인가 (믿음만 — 사람 보류의 반경) */
function inAnimalHaz(a: FieldAgent, x: number, y: number): boolean {
  for (const f of a.beliefs.list('ani')) {
    const v = f.value as AniBelief;
    if (v.state !== 'loose' || v.lost) continue;
    if ((x - v.x) * (x - v.x) + (y - v.y) * (y - v.y) <= ANI_R * ANI_R) return true;
  }
  for (const f of a.beliefs.list('haz')) {
    const v = f.value as HazV;
    if (v.kind !== 'hive' || !v.active) continue;
    const r = v.r ?? 3;
    if ((x - v.x) * (x - v.x) + (y - v.y) * (y - v.y) <= r * r) return true;
  }
  return false;
}
/** 출구 k 앞의 통제 칸: 출구 칸에서 안쪽으로 한 칸 (걸을 수 없으면 출구 칸) — 생김새만 */
function exitPost(s: Scene, k: number): number {
  const e = s.exits[k];
  const x = Math.max(1, Math.min(s.w - 2, e.x)), y = Math.max(1, Math.min(s.h - 2, e.y));
  const i = y * s.w + x;
  return staticPass(s.tiles[i]) ? i : e.y * s.w + e.x;
}
/** 벌집을 떼어 내는 동안의 반경 (보이는 대로 — 세계 규칙의 4.5 와 같다. 통제는 그 밖에 선다) */
const HIVE_WIDE = 4.5;
/** 벌집 둘레의 통제 자리 둘 (떼어 낼 때 커지는 반경 + 1 의 좌우 — 걸을 수 있는 칸으로 민다) */
function hivePosts(s: Scene, v: HazV): number[] {
  const out: number[] = [], r = Math.max(v.r ?? 3, HIVE_WIDE) + 1;
  for (const dir of [-1, 1]) {
    let x = Math.round(v.x + dir * r);
    const y = Math.min(s.h - 2, Math.round(v.y) + 1);
    for (let k = 0; k < 4 && x > 0 && x < s.w - 1 && !staticPass(s.tiles[y * s.w + x]); k++) x += dir;
    if (x > 0 && x < s.w - 1 && staticPass(s.tiles[y * s.w + x])) out.push(y * s.w + x);
  }
  return out;
}

/**
 * (5 §4.3) 동물 현장의 지휘 규칙: 풀린 동물(자리를 아는)마다 ① 찻길 출구의 통제 cordon(0.8 — 경찰의 적합도가 높아 경찰이 먼저 선다) ③ 포획 capture(0.88 · 잠든 동물은 0.9)
 * ④ 반경 3칸 안의 구조 대상 보류(registerCasHold) — 보류가 시작되는 주기에 이미 열린 그 사람의 일을 한 번 거둔다. 잡혔거나 나간 동물의 포획은 거둔다.
 * 벌집(haz hive)이 살아 있으면 좌우 통제 둘(0.8)과 떼어 내기 capture(0.88 — 보호복을 든 대원만 맞는다). 동물도 벌집도 하나도 모르거나(현장 평가 뒤), 자리를 잃은 동물이 있으면
 * 수색할 수 있는 바깥 구역을 수색한다(목격자가 가리킨 구역 0.8, 나머지 0.5 — 확인율 0.72 넘으면 내지 않는다)
 */
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'animal') return;
  void I;
  const B = a.beliefs;
  const keep: number[] = [];
  let known = 0, lost = false, loose = 0;
  for (const f of B.list('haz')) {
    const v = f.value as HazV;
    if (v.kind !== 'hive') continue;
    known++;
    if (v.active) { for (const t of hivePosts(s, v)) { keep.push(t); k.want('cordon', { tile: t }, ANI_CORDON); } k.want('capture', { prop: f.id }, 0.88); }
    else k.cancel((w) => w.kind === 'capture' && w.prop === f.id);
  }
  for (const f of B.list('ani')) {
    const v = f.value as AniBelief;
    known++;
    if (v.state === 'caught' || v.state === 'gone') { k.cancel((w) => w.kind === 'capture' && (w.animal ?? -1) === f.id); continue; }
    if (v.lost) { lost = true; k.cancel((w) => w.kind === 'capture' && (w.animal ?? -1) === f.id && w.status === 'open'); continue; }
    if (v.state === 'loose') loose++;
    k.want('capture', { animal: f.id }, v.state === 'sedated' ? 0.9 : 0.88);
  }
  if (loose > 0 && s.exitKind) for (let e = 0; e < s.exits.length; e++) if (s.exitKind[e] === 'road') { const t = exitPost(s, e); keep.push(t); k.want('cordon', { tile: t }, ANI_CORDON); }
  k.cancel((w) => w.kind === 'cordon' && keep.indexOf(w.tile) < 0);
  // 찾기: 아무것도 모르거나(현장 평가 뒤) 자리를 잃은 동물이 있다
  if ((known === 0 && s.sizeupDone) || lost) {
    const seen = B.val<{ region: number }>('seen', 0);
    for (const r of s.regions) {
      if (!r.searchable || r.indoor) continue;
      if ((B.val<number>('srch', r.id) ?? -1) >= 0.72) continue;
      k.want('search', { region: r.id }, seen && seen.region === r.id ? 0.8 : 0.5);
    }
  } else k.cancel((w) => w.kind === 'search' && w.status === 'open');
  // 보류된 사람에게 이미 열려 있던 핵심 규칙의 일을 거둔다 (보류가 시작된 뒤에는 핵심 규칙이 다시 내지 않는다)
  for (const f of B.list('cas')) {
    const c = f.value as CasBelief;
    if (c.where !== 'scene' || !inAnimalHaz(a, c.x, c.y)) continue;
    k.cancel((w) => w.cas === f.id && w.status === 'open' && HOLD_KINDS.has(w.kind));
  }
});
/** (§5.7 · §5.10) 믿음 속 풀린 동물 3칸 · 살아 있는 벌집 반경 안의 사람: 핵심 규칙이 구출·처치·이송·동행·탑승을 내지 않는다 (fitBase 의 반경 줄과 함께) */
registerCasHold((sim, s, a, id, c) => { void sim; void id; return s.kind === 'animal' && c.where === 'scene' && inAnimalHaz(a, c.x, c.y); });
/**
 * 풀린 동물(자리를 아는)·잠든 동물·살아 있는 벌집이 있다고 믿으면 끝내지 않는다. 아무것도 모르면 수색할 바깥 구역이 남아 있는 동안 끝내지 않는다
 * (자리를 잃은 동물은 찾을 곳을 다 보면 막지 않는다 — 판정이 남은 동물을 위험으로 센다)
 */
registerBlocker((sim, s, a) => {
  void sim;
  if (s.kind !== 'animal') return false;
  const B = a.beliefs;
  let known = 0, lost = false;
  for (const f of B.list('haz')) { const v = f.value as HazV; if (v.kind !== 'hive') continue; known++; if (v.active) return true; }
  for (const f of B.list('ani')) { const v = f.value as AniBelief; known++; if (v.lost) { lost = true; continue; } if (v.state === 'loose' || v.state === 'sedated') return true; }
  if (known > 0 && !lost) return false;
  for (const r of s.regions) if (r.searchable && !r.indoor && (B.val<number>('srch', r.id) ?? -1) < 0.72) return true;
  return false;
});
/** (§5.7) 마지막 부대가 떠났는데 풀린 동물(자리를 아는)이 남았다 → 포획, 살아 있는 벌집 → 진압(관창수의 보호복) */
registerPending((sim, s, a) => {
  void sim;
  if (s.kind !== 'animal') return null;
  for (const f of a.beliefs.list('ani')) { const v = f.value as AniBelief; if ((v.state === 'loose' || v.state === 'sedated') && !v.lost) return 'capture'; }
  for (const f of a.beliefs.list('haz')) { const v = f.value as HazV; if (v.kind === 'hive' && v.active) return 'suppression'; }
  return null;
});

// ───────────────────────── 치안 (§4.4 — 단계 6a) ─────────────────────────
// 믿음의 'hos' 사실만 읽는다. 보이는 용의자는 핵심 규칙(봉쇄·협상·검거·추격)이 맡고, 여기서는 그 밖의 셋만: 잠든 취객 · 아직 아무 용의자도 모를 때의 수색과 길목 지키기
/** 길목(출구) 통제의 우선순위 — 수색·검거가 빼 올 수 있게 낮게 */
export const DISTURB_CORDON = 0.45;
/** 수색 우선순위 — 목격자가 가리킨 구역 · 나머지 (길목 통제보다 0.22 넘게 높아 통제에 선 경찰을 빼 온다 — 경찰 한 팀이 둘 다 통제에 서서 가게 안을 아무도 보지 않았다) */
export const DISTURB_SEARCH = { pointed: 0.85, other: 0.7 };
/**
 * 한 구역을 몇 번 수색해 마치면 확인율이 모자라도 그만두는가 · 그때 적는 확인율 (X6 잔해 수색의 RUBBLE_SEARCHES 와 같은 까닭 — 밤의 시장 뒷골목에서
 * "수색 실시 → 시야가 나빠 확인율 9% → 다시 수색"이 한 사건에 39번 되풀이됐다). 둘째 수색부터는 정밀 수색. 지휘관이 아는 것(작업판의 마친 수색·자기 믿음)만 읽는다
 */
export const DISTURB_SEARCHES = 3, DISTURB_SRCH_DONE = 0.9;
/** 수색을 DISTURB_SEARCHES 번 마쳐 더 내지 않는 구역 (현장마다 — 늦게 끝난 수색의 낮은 보고를 기록 없이 다시 덮는다) */
const DISTURB_CAPPED = new WeakMap<Scene, Set<number>>();
/**
 * (§4.4) 치안 지휘 규칙: 잠든 취객(믿음 'asleep')에게 검거 0.7(실행부가 곁에서 깨운 뒤 데려간다) · 용의자를 하나도 모르면(현장 평가 뒤 — 날치기의 숨은 용의자 · 가게 안의 주취자) 수색할 수 있는 구역 수색
 * (목격자가 가리킨 구역 0.85 · 나머지 0.7 — 확인율 0.72 넘으면 내지 않는다)과 출구마다 길목 통제 cordon(용의자를 아직 못 봤으므로 perimeter 가 아니다 — 원칙 10). 용의자를 보면 거둔다
 */
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'disturb') return;
  if (meetOf(a)) return;      // (단계 6b) 약속을 아는 현장(수거책 잠복)은 아래 잠복 규칙이 맡는다 — 여기서 통제를 거두면 잠복 자리가 매 주기 새로 생긴다
  const B = a.beliefs;
  let known = 0;
  for (const f of B.list('hos')) {
    known++;
    if ((f.value as { state: string }).state === 'asleep') k.want('arrest', { hostile: f.id }, 0.7);
  }
  const keep: number[] = [];
  if (known === 0 && s.sizeupDone) {
    const seen = B.val<{ region: number }>('seen', 0);
    let pending = 0;      // 아직 수색할 구역 — 다 보았는데 못 찾았으면 길목 통제도 거둔다 (통제가 남으면 용의자는 나가지 못하고 지휘관은 끝내지 못해 한계 시간까지 섰다)
    for (const r of s.regions) {
      if (!r.searchable) continue;      // 실내도 (주취 소란의 가게 — 치안은 방 수색 규칙(roomSearch)을 쓰지 않는다)
      if ((B.val<number>('srch', r.id) ?? -1) >= 0.72) continue;
      let n = 0;
      for (const w of s.board) if (w.kind === 'search' && w.region === r.id && w.status === 'done') n++;
      if (n >= DISTURB_SEARCHES) {
        let capped = DISTURB_CAPPED.get(s);
        if (!capped) { capped = new Set(); DISTURB_CAPPED.set(s, capped); }
        if (!capped.has(r.id)) {
          capped.add(r.id);
          emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, causes: [I.lastEvent], text: `${josa(r.name, '을/를')} ${n}번 수색했습니다 — 더 볼 수 없어 그 구역의 수색을 마칩니다.` });
        }
        B.merge(mkFact('srch', r.id, DISTURB_SRCH_DONE, resp(sim, a).name, sim.t, 0.6, true, `${r.name} 수색 — 더 볼 수 없음`));
        k.cancel((w) => w.kind === 'search' && w.region === r.id);
        continue;
      }
      k.want('search', { region: r.id }, seen && seen.region === r.id ? DISTURB_SEARCH.pointed : DISTURB_SEARCH.other, 1, n > 0);
      pending++;
    }
    if (pending > 0) for (let e = 0; e < s.exits.length; e++) { const t = exitPost(s, e); keep.push(t); k.want('cordon', { tile: t }, DISTURB_CORDON); }
  }
  k.cancel((w) => w.kind === 'cordon' && keep.indexOf(w.tile) < 0);
});
/** 용의자를 하나도 모르는데 수색할 구역이 남았으면 끝내지 않는다 (치안 — 날치기의 숨은 용의자 · 가게 안의 주취자) */
registerBlocker((sim, s, a) => {
  void sim;
  if (s.kind !== 'disturb' || a.beliefs.list('hos').length > 0) return false;
  for (const r of s.regions) if (r.searchable && (a.beliefs.val<number>('srch', r.id) ?? -1) < 0.72) return true;
  return false;
});

// ───────────────────────── 치안 (§4.4 — 단계 6b) — 수거책 잠복 ─────────────────────────
// 믿음의 evid meet(피해자 면담 — 약속 시각·자리)과 hos 만 읽는다. 지휘관은 약속을 알면 잠복 자리(약속 자리 3칸 안 — 대기 지점 쪽)와 먼 자리(약속 자리에서 9칸 넘게 떨어진 출구)에
// 통제(cordon)를 둔다 — 누가 어느 자리에 서는지는 fitBase('cordon')가 가른다(잠복 자리는 형사 1.0 · 제복 0.15). 수거책이 약속 자리로 걸어오는 동안은 핵심 규칙이 그 용의자에게
// 봉쇄·협상·검거를 내지 않는다(registerHosHold — 출구로 달려가는 제복을 보면 수거책이 달아난다). 약속 자리 2.5칸 안에 오면 검거 0.93. 달아나면 핵심 규칙의 추격(engage)
/** 잠복 자리(약속 자리에서 대기 지점 쪽으로 떨어진 칸)·먼 자리(약속 자리에서 이만큼 넘게 떨어진 출구)·검거를 내는 거리·우선순위 */
export const SCAM_POST = { ambush: 3, far: 9, near: 2.5, pAmbush: 0.8, pFar: 0.6, pArrest: 0.93 };
/** 잠복 자리: 약속 자리 줄(같은 y)에서 대기 지점 쪽으로 2~3칸 — 걸을 수 있는 칸 (생김새만) */
function ambushTile(s: Scene, m: { x: number; y: number }): number {
  const dir = s.staging.x < m.x ? -1 : 1;
  for (const dx of [SCAM_POST.ambush, SCAM_POST.ambush - 1, SCAM_POST.ambush + 1]) {
    const x = Math.round(m.x + dir * dx), y = Math.round(m.y);
    if (x > 0 && x < s.w - 1 && staticPass(s.tiles[y * s.w + x])) return y * s.w + x;
  }
  return -1;
}
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'disturb') return;
  void I;
  const m = meetOf(a);
  if (!m) return;
  const keep: number[] = [];
  let approaching = false, atMeet = false;
  for (const f of a.beliefs.list('hos')) {
    const v = f.value as { state: string; x: number; y: number };
    if (v.state !== 'hold') continue;
    if (justArrested(sim, s, f.id)) continue;
    if (Math.hypot(v.x - m.x, v.y - m.y) <= SCAM_POST.near) { atMeet = true; k.want('arrest', { hostile: f.id }, SCAM_POST.pArrest, 2); }
    else approaching = true;
  }
  // 잠복은 수거책이 오기 전·걸어오는 동안만 (약속 시각 + 40초까지 — 그 뒤에는 오지 않는다고 본다). 약속 자리에 오면 잠복 자리를 거둔다 — 잠복한 대원이 곧바로 검거에 나선다
  // (통제 0.8 에 묶인 대원은 검거 0.93 이 0.22 넘게 높지 않아 빼 오지 못한다)
  if (sim.t < m.at + 40 || approaching || atMeet) {
    const t1 = atMeet ? -1 : ambushTile(s, m);
    if (t1 >= 0) { keep.push(t1); k.want('cordon', { tile: t1 }, SCAM_POST.pAmbush); }
    let far = -1, fd = SCAM_POST.far;
    for (let e = 0; e < s.exits.length; e++) { const d = Math.hypot(s.exits[e].x - m.x, s.exits[e].y - m.y); if (d > fd) { fd = d; far = e; } }
    if (far >= 0) { const t2 = exitPost(s, far); keep.push(t2); k.want('cordon', { tile: t2 }, SCAM_POST.pFar); }
  }
  k.cancel((w) => w.kind === 'cordon' && keep.indexOf(w.tile) < 0);
});
/**
 * 방금 검거를 마친 용의자 (작업판 — 지휘관이 낸 일의 끝은 조직이 아는 것): 검거 보고(learnQuiet — 묶음 무전)가 닿기 전의 낡은 믿음('대치 중')으로
 * 같은 검거를 다시 내지 않는다 (CLAUDE.md "보고 지연 사이의 중복 지시" — 수거책을 체포한 0.8초 뒤 같은 대원에게 "수거책 검거 맡아라"가 다시 갔다)
 */
export const JUST_ARRESTED = 10;
function justArrested(sim: Sim, s: Scene, id: number): boolean {
  for (const w of s.board) if (w.kind === 'arrest' && w.hostile === id && w.status === 'done' && sim.t - w.doneAt < JUST_ARRESTED) return true;
  return false;
}
/** 약속을 아는 지휘관은 약속 자리로 걸어오는(약속 자리 2.5칸 밖에서 서 있거나 걷는) 용의자 · 방금 검거를 마친 용의자에게 핵심 규칙의 봉쇄·협상·검거를 내지 않는다 — 잠복이 들킨다 */
registerHosHold((sim, s, a, id, h) => {
  if (s.kind !== 'disturb' || h.state !== 'hold') return false;
  const m = meetOf(a);
  return m !== null && (Math.hypot(h.x - m.x, h.y - m.y) > SCAM_POST.near || justArrested(sim, s, id));
});
/** 약속을 알고 용의자를 아직 보지 못했으면 약속 시각 + 40초 전에는 끝내지 않는다 (잠복의 기다림을 지킨다 — 면담 전에는 면담 작업이 열려 있어 저절로 닫히지 않는다) */
registerBlocker((sim, s, a) => {
  if (s.kind !== 'disturb' || a.beliefs.list('hos').length > 0) return false;
  const m = meetOf(a);
  return m !== null && sim.t < m.at + 40;
});

// ───────────────────────── 교통사고의 견인 (§5.3.8 — 단계 6b, 선택 수요) ─────────────────────────
// 믿음의 haz wreck(차로를 막은 부서진 차 — perceive 가 남긴다, 값의 prop 이 소품 id)과 조직이 아는 배정(countUnits)만 읽는다.
/** 견인차를 기다리는 상한(초 — towAway 가 만들어진 뒤 이만큼 견인차가 현장에 없으면 밀어 둠으로 돌아간다) · 견인 우선순위(지금의 clearRoad 0.42 바로 위) */
export const TOW_WAIT = { s: 150 }, TOW_P = 0.44;      // TOW_WAIT 는 객체 — 시험이 줄여 시간 막이를 본다
/** 견인차가 맡은 차(소품 id) — 핵심 규칙이 그 차에 clearRoad 를 내지 않는다(registerPropHold). 현장마다 — 객체 모양을 바꾸지 않으려고 WeakMap */
const TOW_HELD = new WeakMap<Scene, Set<number>>();
/** 견인을 접은 현장 (견인차가 150초 넘게 오지 않았다 — 다시 내지 않는다) */
const TOW_GIVEUP = new WeakSet<Scene>();
interface WreckV { kind?: string; active?: boolean; prop?: number }
registerOrders((sim, s, I, a, k) => {
  if (!ATTACH_TOW || !s.laneRows.length) return;
  void I;
  let held = TOW_HELD.get(s);
  const coming = k.countUnits('tow', 0.7) > 0 && !TOW_GIVEUP.has(s);
  let onScene = false;
  for (const uid of k.unitsOnScene()) if (sim.units[uid].caps.tow >= 0.7) { onScene = true; break; }
  let unresolved = false;
  for (const f of a.beliefs.list('cas')) { const c = f.value as CasBelief; if (c.band < 3 && (c.where === 'scene' || c.where === 'carried')) { unresolved = true; break; } }
  for (const f of a.beliefs.list('haz')) {
    const v = f.value as WreckV;
    if (v.kind !== 'wreck' || v.prop === undefined) continue;
    const pid = v.prop;
    if (!v.active || !coming) { if (held) held.delete(pid); k.cancel((w) => w.kind === 'towAway' && w.prop === pid); continue; }
    if (!held) { held = new Set(); TOW_HELD.set(s, held); }
    if (!held.has(pid)) { held.add(pid); k.cancel((w) => w.kind === 'clearRoad' && w.prop === pid && w.status === 'open'); }      // 보류가 시작되는 주기에 한 번 (그 뒤에는 핵심 규칙이 내지 않는다)
    if (unresolved) continue;      // 사람이 남은 동안은 견인하지 않는다 (지금의 도로 정리와 같은 조건)
    // 이미 끝낸 견인(작업판): 끝낸 보고가 닿기 전의 낡은 믿음(차로를 막은 차)으로 같은 차의 견인을 다시 내지 않는다 (견인한 0.4초 뒤 다시 갔다)
    if (s.board.some((q) => q.kind === 'towAway' && q.prop === pid && q.status === 'done')) continue;
    const w = k.want('towAway', { prop: pid }, TOW_P);
    if (w.id >= 0 && !onScene && sim.t - w.createdAt > TOW_WAIT.s) {
      TOW_GIVEUP.add(s); held.clear();
      k.cancel((q) => q.kind === 'towAway');
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, text: '견인차가 오지 않습니다 — 부서진 차량은 길가로 밀어 두겠습니다.' });
    }
  }
});
/** 견인차가 맡은 차: 핵심 규칙의 도로 정리(밀어 둠)를 내지 않는다 */
registerPropHold((sim, s, a, propId) => { void sim; void a; const h = TOW_HELD.get(s); return h !== undefined && h.has(propId); });

// ───────────────────────── 보호 (§4.5 — 단계 7) — 미아의 출구 ─────────────────────────
// 믿음과 관제의 이름표만 읽는다(대상을 찾았는가 = 믿음에 구조 대상이 있는가). 아이를 모르는 동안 출구 둘(대기 지점에서 가까운 차례)에 통제(cordon — perimeter 가 아니다: 위협이 없는 현장이라
// 핵심 규칙이 거둔다). 현장의 손이 셋 넘을 때 둘째를 둔다 — 남은 손은 수색한다(통제 0.8 에 다 묶이면 0.22 규칙 때문에 수색으로 빼 오지 못한다). 찾으면 거둔다
/** 출구 통제의 우선순위 (첫째 · 둘째) */
export const CHILD_POST = { p1: 0.8, p2: 0.62 };
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'welfare' || !I.assessment || I.assessment.label !== '미아') return;      // 관제가 붙인 이름표(조직이 아는 것)로만 — 현장의 변형(진실)은 읽지 않는다
  void sim;
  const found = a.beliefs.list('cas').length > 0;
  if (found) { k.cancel((w) => w.kind === 'cordon'); return; }
  const order = s.exits.map((e, i) => ({ i, d: Math.hypot(e.x - s.staging.x, e.y - s.staging.y) })).sort((p, q) => p.d - q.d || p.i - q.i);
  const hands = s.agents.filter((b) => b.status === 'active' && !b.aloft).length;
  const keep: number[] = [];
  for (let n = 0; n < Math.min(order.length, hands > 3 ? 2 : 1); n++) { const t = exitPost(s, order[n].i); keep.push(t); k.want('cordon', { tile: t }, n === 0 ? CHILD_POST.p1 : CHILD_POST.p2); }
  k.cancel((w) => w.kind === 'cordon' && keep.indexOf(w.tile) < 0);
});
