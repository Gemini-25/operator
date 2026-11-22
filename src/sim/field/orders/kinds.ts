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
import { VALVE_LATE, laborAtOf, meetOf } from '../agents';
import type { AniBelief, CasBelief, FieldAgent, Incident, Scene } from '../../types';
import { T } from '../../types';      // (N8 단계 7) 문 잠긴 집의 현관 칸 (생김새)
import { hasKit, seatsOf, seatsUsed } from '../../crews';      // (N8 단계 8) 조직이 아는 장비 — 가스 측정기를 든 대원이 현장·오는 부대에 있는가
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
  // (단계 11) 수거책을 이미 검거했으면(작업판의 끝난 검거 — 지휘관이 낸 일의 끝은 조직이 아는 것) 잠복을 다시 두지 않는다: 약속 자리에서 검거한 2초 뒤
  // 약속 시각 + 40초 창 안이라 잠복 자리가 다시 생겨, 검거한 형사가 "잠복, 제가 맡겠습니다" → 낡은 협상 → 다시 잠복을 오갔다(강제 S0 — 수거책이 돈을 받는 시간을 12초로 늘린 뒤 약속 자리 검거가 잦아졌다)
  const caught = s.board.some((w) => w.kind === 'arrest' && w.status === 'done');
  if (!caught && (sim.t < m.at + 40 || approaching || atMeet)) {
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
/**
 * (단계 11) 그 견인차의 대원 가운데 견인을 맡을 수 있는 사람(활동 중 · 다치지 않음 — 명부의 상태, 조직이 아는 것)이 현장에 있는가.
 * 견인 기사가 차로에서 다치면(가벼운 일만 — 견인은 맡지 않는다) 견인차가 와 있는데 아무도 견인하지 못해, towAway 가 열린 채 차로를 막은 차의 밀어 둠(clearRoad)이 보류된 채 한계 시간까지 갔다(강제 20교대 보통 S4 #14 · S10 #24 — STALL 234·292초)
 */
function towHand(sim: Sim, s: Scene, uid: number): boolean {
  for (const b of s.agents) if (b.unitId === uid && b.status === 'active' && sim.responders[b.rid].status !== 'injured') return true;
  return false;
}
registerOrders((sim, s, I, a, k) => {
  if (!ATTACH_TOW || !s.laneRows.length) return;
  void I;
  let held = TOW_HELD.get(s);
  const coming = k.countUnits('tow', 0.7) > 0 && !TOW_GIVEUP.has(s);
  let onScene = false, here = false;
  for (const uid of k.unitsOnScene()) if (sim.units[uid].caps.tow >= 0.7) { here = true; if (towHand(sim, s, uid)) { onScene = true; break; } }      // (단계 11) 견인차가 와 있어도 견인을 맡을 사람이 없으면(견인 기사가 다쳤다) 오지 않은 것과 같다 — 시간 막이가 밀어 둠으로 돌린다
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
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, text: here ? '견인 기사가 다쳐 견인을 맡을 사람이 없습니다 — 부서진 차량은 길가로 밀어 두겠습니다.' : '견인차가 오지 않습니다 — 부서진 차량은 길가로 밀어 두겠습니다.' });
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

// ───────────────────────── 보호 (§4.5 — 단계 7 뒤 절반) — 위기자 · 문 잠긴 집 ─────────────────────────
// 믿음(cas 의 perch, evid talk·sound·witness, haz matSite, blk)·작업판·현장의 생김새(출구·칸)만 읽는다. 위기자에게 가는 일은 모두 여기서 낸다 — 핵심 규칙은 보류(registerCasHold)로 내지 않는다(원칙 10).
/** 위기자: 설득(한 사람) · 매트 펴기(구조 부대의 유압 대원 — 안전 매트) · 단계 2 부터의 붙잡기(줄을 든 구조 대원 — 매트가 펴지기 전에는 다가가지 않는다, N12) */
export const LEDGE_ORD = { persuade: 0.9, mat: 0.86, grab: 0.7 };
/** 설득하는 대원이 본 단계 (믿음 evid talk — 사실 id 1000 + 구조 대상 id, §5.8). 모르면 0 */
function talkStage(a: FieldAgent, cid: number): number {
  const v = a.beliefs.val<{ kind?: string; stage?: number }>('evid', 1000 + cid);
  return v !== undefined && v.kind === 'talk' ? v.stage ?? 0 : 0;
}
/** 믿음 속 높은 자리의 사람 (보호 유형 — 위기자): 현장에 있고 숨지지 않았다 */
const upOnLedge = (c: CasBelief): boolean => (c.perch ?? 0) > 0 && c.where === 'scene' && c.band < 3;
/** 문 잠긴 집: 현관 앞 듣기(통제 자리) · 강제 개방 · 열쇠를 기다리는 시간(첫 도착 뒤 초 — 교착 감지 60초 아래) */
export const LOCK_ORD = { listen: 0.85, force: 0.88, keyWait: 45 };
/** 문 잠긴 집의 현관 (생김새): 첫 출구 칸과 그 곁의 문 칸 — 집이 아니면 null (방 수색을 하는 실내 방이 있는 보호 현장만) */
function lockinDoor(s: Scene): { exit: number; door: number } | null {
  if (!s.exits.length || !s.regions.some((r) => r.kind === 'room' && r.indoor && r.searchable)) return null;
  const ex = s.exits[0], w = s.w;
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { const x = ex.x + dx, y = ex.y + dy; if (x >= 0 && y >= 0 && x < w && y < s.h && s.tiles[y * w + x] === T.DOOR) return { exit: ex.y * w + ex.x, door: y * w + x }; }
  return null;
}
/** 문 잠긴 집에 들어갔다고 믿는가: 현관이 열렸다(blk none) · 구조 대상을 안다 · 집 안 구역을 하나라도 살폈다 */
function enteredHouse(s: Scene, a: FieldAgent, door: number): boolean {
  const B = a.beliefs;
  if (B.val<string>('blk', door) === 'none' || B.list('cas').length > 0) return true;
  for (const r of s.regions) if (r.indoor && r.searchable && (B.val<number>('srch', r.id) ?? -1) >= 0) return true;
  return false;
}
const WELFARE_TOLD = new WeakMap<Scene, Set<string>>();
/** 문 잠긴 집: 이 지휘 규칙이 미뤄 둔 방 수색 (들어가면 그것만 푼다 — 실패 뒤의 미룸은 건드리지 않는다) */
const LOCK_HELD = new WeakSet<object>();
function tellWelfare(sim: Sim, s: Scene, I: Incident, a: FieldAgent, key: string, text: string): void {
  let st = WELFARE_TOLD.get(s); if (!st) { st = new Set(); WELFARE_TOLD.set(s, st); }
  if (st.has(key)) return;
  st.add(key);
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, text });
}
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'welfare') return;
  const B = a.beliefs;
  // ── 위기자 ──
  let mat: { id: number; active: boolean } | null = null;
  for (const f of B.list('haz')) { const v = f.value as HazV; if (v.kind === 'matSite') { mat = { id: f.id, active: v.active === true }; break; } }
  for (const f of B.list('cas')) {
    const c = f.value as CasBelief;
    if (!upOnLedge(c)) { k.cancel((w) => (w.kind === 'persuade' || w.kind === 'extricate') && w.cas === f.id); continue; }      // 내려왔거나 숨졌다(또는 높은 자리의 사람이 아니다) — 설득·붙잡기를 거둔다(믿음상 끝난 일)
    k.want('persuade', { cas: f.id }, LEDGE_ORD.persuade, 1);
    if (mat !== null && mat.active) { k.want('mitigate', { prop: mat.id }, LEDGE_ORD.mat); tellWelfare(sim, s, I, a, 'mat', '아래에 안전 매트부터 펴라. 매트가 펴지기 전에는 누구도 다가가지 않는다.'); }
    if (talkStage(a, f.id) >= 2 && !(mat !== null && mat.active)) { k.want('extricate', { cas: f.id }, LEDGE_ORD.grab, 1); tellWelfare(sim, s, I, a, 'grab', '마음을 조금 열었다. 구조대는 줄을 매고 천천히 곁으로 가라.'); }
    else k.cancel((w) => w.kind === 'extricate' && w.cas === f.id && w.status === 'open');
  }
  if (mat !== null && (!mat.active || !B.list('cas').some((f) => upOnLedge(f.value as CasBelief)))) k.cancel((w) => w.kind === 'mitigate' && w.prop === mat!.id);      // 펴졌거나 위기자가 내려왔다
  // ── 문 잠긴 집 ──
  const hd = lockinDoor(s);
  if (hd === null) return;
  if (enteredHouse(s, a, hd.door)) {
    k.cancel((w) => w.kind === 'cordon' || (w.kind === 'force' && w.tile === hd.door));
    for (const w of s.board) if (LOCK_HELD.has(w)) { LOCK_HELD.delete(w); if (w.status === 'open' && w.holdUntil > sim.t) w.holdUntil = sim.t; }      // 들어갔다 — 미뤄 둔 방 수색을 바로 푼다
    return;
  }
  for (const w of s.board) if (w.kind === 'search' && w.status === 'open') { w.holdUntil = Math.max(w.holdUntil, sim.t + 6); LOCK_HELD.add(w); }      // 문을 열기 전에는 방 수색을 맡기지 않는다 (맡은 대원이 길에서 잠긴 문을 스스로 부수지 않게 — 계획 주기 사이에 풀리지 않게 6초)
  let sound: { v?: string } | null = null;
  for (const f of B.list('evid')) { const v = f.value as { kind?: string; v?: string }; if (v.kind === 'sound') { sound = v; break; } }
  if (sound === null) { k.want('cordon', { tile: hd.exit }, LOCK_ORD.listen); return; }      // 현관 앞에 서서 듣는다 (그 자리에 5초 — 세계 규칙 lockinRule)
  const wait = sound.v !== 'moan' && s.arrivedAt >= 0 && sim.t < s.arrivedAt + LOCK_ORD.keyWait;
  if (wait) { k.want('cordon', { tile: hd.exit }, LOCK_ORD.listen); tellWelfare(sim, s, I, a, 'wait', '인기척이 없습니다. 관리인의 열쇠를 잠시 기다립니다.'); }
  else k.cancel((w) => w.kind === 'cordon');
  if (sound.v === 'moan') tellWelfare(sim, s, I, a, 'moan', '안에서 신음 소리가 납니다. 열쇠를 기다리지 않고 바로 문을 엽니다.');
  const w = k.want('force', { tile: hd.door }, LOCK_ORD.force);
  if (w.id >= 0 && wait && w.status === 'open') w.holdUntil = Math.max(w.holdUntil, s.arrivedAt + LOCK_ORD.keyWait);
});
/** 위기자(높은 자리의 사람)에게 핵심 규칙이 일(구출·처치·이송·동행·호이스트)을 내지 않는다 — 단계에 맞춰 위의 지휘 규칙이 낸다 */
registerCasHold((sim, s, a, id, c) => { void sim; void a; void id; return s.kind === 'welfare' && (c.perch ?? 0) > 0 && c.where === 'scene'; });
/** 남은 일: 높은 자리의 위기자가 남았으면 경찰(설득) · 문을 아직 열지 못한 문 잠긴 집이면 구조(개방할 사람) */
registerPending((sim, s, a) => {
  void sim;
  if (s.kind !== 'welfare') return null;
  for (const f of a.beliefs.list('cas')) if (upOnLedge(f.value as CasBelief)) return 'law';
  const hd = lockinDoor(s);
  return hd !== null && !enteredHouse(s, a, hd.door) ? 'rescue' : null;
});

// ───────────────────────── 구조 (§4.6 — 단계 8) — 높은 자리 아래 통제 · 구덩이의 공기 측정 · 놀이기구의 전원 기다림 ─────────────────────────
// 믿음(cas 의 perch·pit, haz pit·air, evid power)·작업판·조직 정보(현장·오는 부대 대원의 장비 — hasKit)만 읽는다. 구출(extricate)·호이스트는 핵심 규칙이 낸다 —
// 여기서는 낙하 구역 통제·측정 자리를 더하고, 기다려야 할 구출을 holdUntil 로 미룰 뿐이다(원칙 10 — 핵심 규칙이 내는 일을 취소하지 않는다).
/** 우선순위·시간: 높은 자리 아래 통제(구출 0.82 보다 0.22 넘게 낮게 — 구출을 맡을 대원을 빼 가지 않는다) · 구덩이 측정 · 측정기를 기다리는 상한(초 — 측정기 든 대원이 없을 때) ·
 *  측정을 기다리는 긴 상한(측정기 든 대원이 있어도) · 놀이기구 전원을 기다릴 만한 남은 시간(초 — 교착 감지 60초 아래) */
export const RESCUE_ORD = { cordon: 0.55, measure: 0.88, meterWait: 60, measureCap: 150, powerWait: 45 };
/** 높은 자리의 사람에게서 2칸 떨어진 걸을 수 있는 칸 가운데 대기 지점에 가장 가까운 칸 — 낙하 구역 통제 자리 (생김새만). 없으면 -1 */
function belowTile(s: Scene, x: number, y: number): number {
  let best = -1, bd = Infinity;
  for (let k = 0; k < BELOW.length; k += 2) {
    const tx = x + BELOW[k], ty = y + BELOW[k + 1];
    if (tx < 1 || ty < 1 || tx >= s.w - 1 || ty >= s.h - 1) continue;
    const i = ty * s.w + tx;
    if (!staticPass(s.tiles[i])) continue;
    const d = Math.hypot(tx - s.staging.x, ty - s.staging.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
const BELOW = [0, -2, 0, 2, -2, 0, 2, 0, -2, -2, 2, -2, -2, 2, 2, 2];
/** 구덩이의 바로 곁(상하좌우 — 측정기가 2칸 안에 닿는다) 걸을 수 있는 칸 가운데 대기 지점에 가장 가까운 칸 */
function pitSide(s: Scene, x: number, y: number): number {
  let best = -1, bd = Infinity;
  for (let k = 0; k < SIDE.length; k += 2) {
    const tx = x + SIDE[k], ty = y + SIDE[k + 1], i = ty * s.w + tx;
    if (tx < 0 || ty < 0 || tx >= s.w || ty >= s.h || !staticPass(s.tiles[i])) continue;
    const d = Math.hypot(tx - s.staging.x, ty - s.staging.y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
const SIDE = [0, -1, 0, 1, -1, 0, 1, 0];
/** 가스 측정기를 든 대원이 현장에 있거나 오고 있는가 (조직이 아는 편성·장비 — 알려진 고장은 hasKit 이 거른다) */
function meterNear(sim: Sim, s: Scene, I: Incident): boolean {
  for (const b of s.agents) if (b.status === 'active' && !b.aloft && hasKit(sim, b.rid, 'gasMeter')) return true;
  for (const uid of I.assigned) { const u = sim.units[uid]; if ((u.state === 'enroute' || u.state === 'turnout') && u.crew.some((r) => hasKit(sim, r, 'gasMeter'))) return true; }
  return false;
}
/** 한 번만 남기는 지휘 기록 (현장마다 열쇠 — 측정 없이 내려감 · 전원을 기다림) */
const RESCUE_TOLD = new WeakMap<Scene, Set<string>>();
function tellOnce(sim: Sim, s: Scene, I: Incident, a: FieldAgent, key: string, text: string): void {
  let st = RESCUE_TOLD.get(s); if (!st) { st = new Set(); RESCUE_TOLD.set(s, st); }
  if (st.has(key)) return;
  st.add(key);
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, text });
}
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'rescue') return;
  const B = a.beliefs, cas = B.list('cas');
  // ① 높은 자리 아래 낙하 구역 통제 — 하나 (높은 자리에 아직 사람이 있다고 믿는 동안)
  let post = -1;
  for (const f of cas) { const c = f.value as CasBelief; if ((c.perch ?? 0) > 0 && c.mob === 'trapped' && c.where === 'scene' && c.band < 3) { post = belowTile(s, c.x, c.y); if (post >= 0) break; } }
  if (post >= 0) k.want('cordon', { tile: post }, RESCUE_ORD.cordon);
  // ② 좁은 우물에 의식 없는 사람(내려가야 한다): 공기를 모르면 측정기를 든 대원이 먼저 잰다 — 그동안 내려가는 구출은 미룬다
  let measure = -1;
  for (const f of B.list('haz')) {
    const v = f.value as { kind: string; active: boolean; x: number; y: number; narrow?: boolean };
    if (v.kind !== 'pit' || !v.narrow || B.get('haz', f.id + 1000) !== undefined) continue;
    let vic = -1;
    for (const q of cas) { const c = q.value as CasBelief; if (c.x === v.x && c.y === v.y && c.mob === 'trapped' && c.where === 'scene' && c.band === 2) { vic = q.id; break; } }
    if (vic < 0) continue;
    const w = s.board.find((q) => q.kind === 'extricate' && q.cas === vic && (q.status === 'open' || q.status === 'active'));
    const age = w ? sim.t - w.createdAt : 0;
    const meter = meterNear(sim, s, I);
    if ((meter && age < RESCUE_ORD.measureCap) || (!meter && age < RESCUE_ORD.meterWait)) {
      if (meter) { measure = pitSide(s, v.x, v.y); if (measure >= 0) k.want('cordon', { tile: measure }, RESCUE_ORD.measure); }
      if (w && w.status === 'open') w.holdUntil = Math.max(w.holdUntil, sim.t + 3);
      tellOnce(sim, s, I, a, 'measure', meter ? '좁은 우물입니다. 내려가기 전에 공기부터 재겠습니다.' : '좁은 우물입니다. 측정기를 기다립니다.');
    } else if (w) tellOnce(sim, s, I, a, 'nometer', '공기를 재지 못했습니다 — 줄을 맨 채 내려갑니다.');
  }
  // ③ 놀이기구: 운영자가 말한 전원 복구 시각이 45초 안이면 멀쩡한 사람(믿음 띠 0)의 구출을 그 시각까지 미룬다 — 나빠지는 사람은 그대로 (그 시각이 지나도 내려오지 않으면 미룸이 저절로 풀린다)
  for (const f of B.list('evid')) {
    const v = f.value as { kind: string; at?: number };
    if (v.kind !== 'power' || v.at === undefined || v.at <= sim.t || v.at - sim.t > RESCUE_ORD.powerWait) continue;
    let held = 0;
    for (const w of s.board) {
      if (w.kind !== 'extricate' || w.status !== 'open') continue;
      const c = B.val<CasBelief>('cas', w.cas);
      if (c !== undefined && (c.perch ?? 0) > 0 && c.band === 0) { w.holdUntil = Math.max(w.holdUntil, v.at + 1); held++; }
    }
    if (held) tellOnce(sim, s, I, a, 'power', '운영자 말대로 곧 전원이 돌아옵니다. 상태가 나쁜 사람부터 내리고 나머지는 기다립니다.');
  }
  k.cancel((w) => w.kind === 'cordon' && w.tile !== post && w.tile !== measure);
});
/** 남은 일: 높은 자리·구덩이에 사람이 있다고 믿으면 구조 부대 */
registerPending((sim, s, a) => {
  void sim;
  if (s.kind !== 'rescue') return null;
  for (const f of a.beliefs.list('cas')) { const c = f.value as CasBelief; if (c.mob === 'trapped' && c.where === 'scene' && c.band < 3 && ((c.perch ?? 0) > 0 || c.pit === true)) return 'rescue'; }
  return null;
});

// ───────────────────────── 응급의 갈래 (§4.7 — 단계 9) — 흥분한 환자의 설득 · 출산: 현장 분만이냐 이송이냐 ─────────────────────────
// 믿음(evid agitated·labor, cas)·작업판·조직 정보(현장 부대의 환자 자리)만 읽는다
/** 우선순위: 흥분한 환자에게 경찰의 설득 · 현장 분만(산모 곁의 처치를 출산 시각까지) · 먼 출산은 싣고 간다. 창의 길이는 agents.LABOR */
export const MED_ORD = { persuade: 0.85, deliver: 0.86, laborLoad: 0.72 };
/** (단계 9) 이 지휘관이 현장 분만을 기다리는 산모인가 — 믿는 출산 시각이 창 안이고 산모가 현장·안전 구역에 있다 (핵심 규칙의 처치·이송·탑승을 막는다) */
function deliverHere(sim: Sim, a: FieldAgent, id: number, c: CasBelief): boolean { return (c.where === 'scene' || c.where === 'safe') && c.band < 3 && laborAtOf(sim, a, id) >= 0; }
/** 그 부대에 걸린 탑승 작업 수 (commander.loadsQueued 와 같은 셈 — 작업판만) */
function seatsQueued(s: Scene, uid: number): number { let n = 0; for (const w of s.board) if ((w.kind === 'load' || w.kind === 'treatMate' || w.kind === 'treatSuspect') && w.prop === uid && (w.status === 'open' || w.status === 'active')) n++; return n; }
/** (단계 8) 구조 현장에서 방금(FRESH 초 안) 끝난 구출의 대상 — 끝낸 대원의 보고가 무전으로 오는 사이(1.2초)에 낡은 '갇힘' 믿음으로 같은 구출을 다시 내지 않는다 (작업판만) */
const FRESH = 4;
function freshFreed(sim: Sim, s: Scene, id: number): boolean { for (const w of s.board) if (w.kind === 'extricate' && w.cas === id && w.status === 'done' && sim.t - w.doneAt < FRESH) return true; return false; }
registerCasHold((sim, s, a, id, c) => (s.kind === 'medical' && deliverHere(sim, a, id, c)) || (s.kind === 'rescue' && c.mob === 'trapped' && freshFreed(sim, s, id)));
registerBlocker((sim, s, a) => {
  if (s.kind !== 'medical') return false;
  // 아직 낳지 않은 산모가 현장·안전 구역에 있다고 믿는다: 현장 분만을 기다리거나(창 안) 싣고 갈 때까지(창 밖) 끝내지 않는다
  for (const f of a.beliefs.list('cas')) { const c = f.value as CasBelief; if ((c.where === 'scene' || c.where === 'safe') && c.band < 3 && laborAtOf(sim, a, f.id, true) >= 0) return true; }
  return false;
});
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'medical') return;
  void I;
  const B = a.beliefs;
  // ① 흥분한 환자(evid agitated — 끝 시각이 아직 오지 않았다): 경찰이 말로 가라앉힌다. 끝났다고 알면 거둔다
  for (const f of B.list('evid')) {
    const v = f.value as { kind: string; at?: number };
    if (v.kind === 'agitated' && f.id >= 1000) {
      const cid = f.id - 1000, live = v.at !== undefined && v.at > sim.t;
      const cb = B.val<CasBelief>('cas', cid);
      if (live && cb !== undefined && cb.band < 3 && cb.where === 'scene') k.want('persuade', { cas: cid }, MED_ORD.persuade);
      else k.cancel((w) => w.kind === 'persuade' && w.cas === cid);
    }
    // ② 출산(evid labor): 믿는 시각이 창(LABOR.WIN) 안이면 싣지 않고 현장에서 받는다 — 탑승을 그 시각까지 미루고, 산모 곁 구급대원의 처치가 그 시각까지 이어진다(실행부 laborStay).
    //    창 밖이면 지금처럼 싣고 간다(현장 부대의 남은 환자 자리 — 없으면 구급을 부른다). 가는 길에 낳으면 구급차 안(기록만)
    if (v.kind === 'labor' && f.id >= 1000) {
      const cid = f.id - 1000, cb = B.val<CasBelief>('cas', cid);
      if (cb === undefined || (cb.where !== 'scene' && cb.where !== 'safe') || cb.band >= 3) continue;
      const at = laborAtOf(sim, a, cid, true);
      if (at < 0) continue;
      if (deliverHere(sim, a, cid, cb)) {
        for (const w of s.board) if (w.kind === 'load' && w.cas === cid && w.status === 'open') w.holdUntil = Math.max(w.holdUntil, at + 2);
        k.cancel((w) => (w.kind === 'carry' || w.kind === 'escort') && w.cas === cid && w.status === 'open');
        k.want('treat', { cas: cid }, MED_ORD.deliver, 1);
      } else if (cb.where === 'safe' && !s.board.some((w) => w.kind === 'load' && w.cas === cid && (w.status === 'open' || w.status === 'active'))) {
        let best = -1;
        for (const uid of k.unitsOnScene()) { const u = sim.units[uid]; if (seatsOf(u) > seatsUsed(sim, u) + seatsQueued(s, uid)) { best = uid; break; } }
        if (best >= 0) k.want('load', { cas: cid, prop: best }, MED_ORD.laborLoad, 1);
        else if (k.countUnits('ems', 0.5) === 0) k.request('ems', '산모 이송', false);
      }
    }
  }
  // ③ 폭염의 지친 사람은 따로 지시하지 않는다: 지상 대원이 처음 만날 때 안내해(agents.perceive) 스스로 안전한 곳 = 그늘(s.safe)로 걷는다.
  //    걷는 사람(믿음 mobile)에게 escort 를 내면 실행부가 '이미 걷는 중'으로 곧바로 끝내 같은 지시만 되풀이된다 — 늦어지면 핵심 규칙의 escort(32초)가 확인한다
});
