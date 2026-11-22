// 사건 종류 다양화 ① 일상 사건의 지휘 규칙 (docs/specs/N8-incident-kinds.md §4) — 지휘관의 믿음(a.beliefs)과 현장의 생김새만 읽는다.
// 진실(소품·구조 대상·용의자의 진실 칸·사건의 진실·시나리오의 정체)을 읽지 않는다 (tests/ext.test.ts · tests/kinds.test.ts 시험 4 가 글자로 본다).
// registerOrders((sim, s, I, a, k) => void) — 지휘관이 계획을 세울 때마다(syncBoard 끝, 핵심 규칙 뒤) 불린다. 자기 현장이 아니면 첫 줄에서 돌아간다.
//
// 단계 3: 오인 신고의 답 — 물에 뜬 물건·폭죽 잔해를 확인했으면 남은 수색을 거둔다.
import { emit } from '../../events';
import { resp } from '../agents';
import { mkFact } from '../beliefs';
import { staticPass } from '../grid';
import { registerBlocker, registerCasHold, registerOrders, registerPending } from '../sceneRegistry';
import { ATTACH_GAS } from '../../scenarios/kinds';
import { VALVE_LATE } from '../agents';
import type { CasBelief, FieldAgent, Scene } from '../../types';

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
