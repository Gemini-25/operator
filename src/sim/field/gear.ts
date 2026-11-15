// 장비 판정의 얇은 층 (docs/specs/R2-methods.md §3.3). R1 의 개인 장비(crews.ts)를 감싸 같은 이름으로 내보낸다.
// 방법의 판단부(methods.ts)와 실행부(methodRun.ts)는 장비를 이 파일로만 본다 — R3 가 판단용 함수(kitHas·kitQty·gunOf·roleIdOf·groupOf·crewHas)를 파일 끝에 더했다.
//
// 두 묶음이다. 섞어 쓰지 않는다:
//   판단용 (methods.ts·orders·화면이 불러도 된다)   kitCount · kitName · swimBonus · seatsLeft · SHARED · isQty
//       알려진 고장만 반영한다 — 숨은 고장은 모른다(있는 것으로 센다). 상태를 바꾸지 않는다.
//   효과용 (실행부만 부른다)                         kitTool · bestTool · kitWorks · useKit
//       bestTool·kitWorks 는 숨은 고장을 드러내고(EQUIP_FAIL 기록) useKit 은 수량을 줄인다.
//       methods.ts 의 주석이 아닌 줄에는 이 이름들이 나오면 안 된다 (tests/methods.test.ts 시험 1).
//
// 이 파일은 crews.ts 와 타입만 import 한다. agents.ts·executor.ts·hazards.ts 를 import 하지 않는다 (agents → methods → gear → crews 에 순환을 만들지 않는다).

import { KITS, hasKit, kitUses, kitWorks as crewKitWorks, seatsOf, toolUse, useKit as crewUseKit } from '../crews';
import type { ToolUse } from '../crews';
import type { Sim } from '../engine';
import type { Incident, KitId, RoleId, Unit } from '../types';

// ───────────────────────── 판단용 ─────────────────────────
/** 장비는 사람마다 따로다 (R1). 부대 몫으로 나눠 쓰던 대체(R1 이 없을 때)에서만 true 였다 — methods.canUse 의 matesUsing 이 본다 */
export const SHARED = false;
/** R1 이 명부에서 수량을 채우는 장비 (KitDef.uses 가 없어도 수량 장비다) */
const QTY_R1: ReadonlySet<KitId> = new Set<KitId>(['flashbang', 'taser', 'charge']);
/** 수량을 세는 장비인가: 표에 처음 수량(KitDef.uses)이 있거나, R1 이 따로 채우는 섬광탄·테이저·장약 */
export function isQty(id: KitId): boolean { return KITS[id].uses !== undefined || QTY_R1.has(id); }
/** 공기호흡기를 "쓸 수 있다"고 세는 남은 공기(초) — 이 아래면 0 으로 센다 */
export const SCBA_MIN = 60;
/**
 * 그 대원이 지금 쓸 수 있는 그 장비의 수 (판단용).
 *   들고 있지 않거나 알려진 고장이면 0 · 수량 장비면 남은 수 · 공기호흡기는 공기를 세지 않거나 60초 이상이면 1, 아니면 0 · 그 밖은 1.
 * 숨은 고장은 모른다(1 로 센다). 수량을 채우지 않은 수량 장비(손으로 만든 명부)는 Infinity 다 — "0 보다 큰가"로만 쓴다.
 */
export function kitCount(sim: Sim, rid: number, id: KitId): number {
  if (!hasKit(sim, rid, id)) return 0;
  if (id === 'scba') return kitUses(sim, rid, id) >= SCBA_MIN ? 1 : 0;
  return isQty(id) ? kitUses(sim, rid, id) : 1;      // 수량이 없는 장비에는 남은 수를 묻지 않는다 (R1 이 그 값을 정하지 않았다)
}
/** 장비의 화면 이름 ('구조 로프') */
export function kitName(id: KitId): string { return KITS[id].name; }
/** 역할별 수영 보정 (R2 §3.3 표). 표에 없는 역할(경찰·구급·의사·간호사, 내리지 않는 자리)은 0 */
const SWIM_BONUS: Partial<Record<RoleId, number>> = {
  ropeTech: 0.3, boatRescuer: 0.3, airRescuer: 0.3,
  rescueLead: 0.15, extricator: 0.15, searcher: 0.15,
  fireLead: 0.05, nozzle: 0.05, firefighter: 0.05, engineer: 0.05, ladderLead: 0.05, ladderOp: 0.05, hazLead: 0.05, hazTech: 0.05, decon: 0.05,
};
/** 그 대원의 역할이 주는 수영 보정. 역할이 없는 대원(손으로 만든 명부)은 소방이면 +0.05, 그 밖은 0 */
export function swimBonus(sim: Sim, rid: number): number {
  const r = sim.responders[rid];
  return r.role !== undefined ? SWIM_BONUS[r.role] ?? 0 : r.dept === 'fire' ? 0.05 : 0;
}
/** 그 부대에 남은 환자 자리 (구급차 2 · 소방·의료 헬기 1 · 그 밖 0 에서 실은 사람을 뺀다) */
export function seatsLeft(_sim: Sim, u: Unit): number { return Math.max(0, seatsOf(u) - u.patients.length); }

// ───────────────────────── 효과용 (실행부만) ─────────────────────────
/** 장비 없이 맨손으로 하는 일의 성능 (crews.ts 의 값과 같다) */
export const BARE_HANDS = 0.12;
/** 고른 방법의 장비 값: KITS[id].tool[use] × 장비 손잡이(toolMul), 상한 1.15. 그 일에 쓰는 장비가 아니면 0 */
export function kitTool(sim: Sim, id: KitId, use: ToolUse): number {
  const v = KITS[id].tool?.[use];
  return v === undefined ? 0 : Math.min(1.15, v * sim.tune.toolMul);
}
/**
 * 그 일에 쓸 수 있는 장비 가운데 실제로 작동하는 가장 좋은 것의 값 (R1 의 toolUse).
 * 숨은 고장이 **이때 드러난다**(EQUIP_FAIL 기록) — 드러나면 다음으로 좋은 장비, 다 없으면 맨손 0.12. 실행부만 부른다.
 */
export function bestTool(sim: Sim, rid: number, use: ToolUse, I: Incident): number { return toolUse(sim, rid, use, I); }
/** 효과를 줄 때만: 들고 있고 작동하면 true. 숨은 고장이면 이때 드러나 EQUIP_FAIL 을 남기고 false (R1 그대로). 실행부만 부른다 */
export function kitWorks(sim: Sim, rid: number, id: KitId, I?: Incident): boolean { return crewKitWorks(sim, rid, id, I); }
/** 수량을 줄인다 (R1 그대로 — 섬광탄이면 부대의 합도 함께). 실행부만 부른다 */
export function useKit(sim: Sim, rid: number, id: KitId, n = 1): void { crewUseKit(sim, rid, id, n); }

// ───────────────────────── 판단용 (R3 — 교본, docs/specs/R3-doctrine.md §2.4) ─────────────────────────
// 교본의 판단부(field/doctrine.ts)가 crews.ts 를 직접 부르지 않게 감싼다. 모두 알려진 고장만 반영하고(숨은 고장은 모른다) 상태를 바꾸지 않는다.
// R2 의 kitCount('scba') 는 60초를 넘는지만 0/1 로 돌려주므로, 공기 비율·짝의 공기·총의 탄은 아래 함수로 구한다.
// (import 를 이 절에 둔 것은 위의 import 줄을 다른 묶음이 함께 고치고 있어서다 — 같은 모듈의 값만 더 가져온다)
import { ROLES, crewHasKit, roleOf } from '../crews';
import type { KitDef } from '../crews';
import type { RoleGroup } from '../types';
/** 들었는가 (R1 hasKit — 알려진 고장이면 false, 수량 무관) */
export function kitHas(sim: Sim, rid: number, id: KitId): boolean { return hasKit(sim, rid, id); }
/** 쓸 수 있는 수량: 들었으면 남은 수(공기호흡기는 남은 초, 총기는 가진 탄 — 수량을 세지 않으면 Infinity), 아니면 0 */
export function kitQty(sim: Sim, rid: number, id: KitId): number { return hasKit(sim, rid, id) ? kitUses(sim, rid, id) : 0; }
/** 총기의 탄창·재장전 칸 (R3 2단계가 crews.ts 의 KitDef 에 mag·reload·perShot 을 더한다 — 그 전에는 없다) */
type GunDef = KitDef & { mag?: number; reload?: number; perShot?: number };
/** 총기를 고르는 순서: 저격 소총 > 소총 > 권총 (G5 fxlog.weaponOf 와 같은 순서) */
const GUNS: KitId[] = ['sniper', 'rifle', 'pistol'];
/**
 * 가진 총 (알려진 고장이 아닌 것 가운데 GUNS 순서의 첫째)과 그 탄. 없으면 null.
 * ammo = 가진 탄 전부(탄창 포함), mag = 지금 탄창, magSize = 탄창 크기, perShot = 한 번 쏠 때 쓰는 탄, reload = 재장전 초.
 * 탄을 세지 않는 동안(2단계 전 — 총기의 uses 가 없다)은 ammo = mag = magSize = Infinity 다.
 */
export function gunOf(sim: Sim, rid: number): { id: KitId; ammo: number; mag: number; magSize: number; perShot: number; reload: number } | null {
  const kit = sim.responders[rid].kit;
  if (!kit) return null;
  for (let g = 0; g < GUNS.length; g++) {
    const id = GUNS[g];
    for (let k = 0; k < kit.length; k++) {
      const it = kit[k];
      if (it.id !== id || it.faultKnown) continue;
      const d = KITS[id] as GunDef;
      const ammo = it.uses === undefined ? Infinity : it.uses;
      const magSize = d.mag ?? Infinity;
      return { id, ammo, mag: it.mag ?? Math.min(magSize, ammo), magSize, perShot: d.perShot ?? 1, reload: d.reload ?? 0 };
    }
  }
  return null;
}
/** 역할 (R1 의 자리. 역할이 없는 손으로 만든 명부는 R1 roleOf 가 쓰는 부서별 기본 역할) */
export function roleIdOf(sim: Sim, rid: number): RoleId | null {
  const r = sim.responders[rid];
  if (r.role !== undefined) return r.role;
  const def = roleOf(sim, rid);
  for (const id of Object.keys(ROLES) as RoleId[]) if (ROLES[id] === def) return id;
  return null;
}
/** 역할의 그림 묶음 (R1 roleOf(…).group) */
export function groupOf(sim: Sim, rid: number): RoleGroup | null { const d = roleOf(sim, rid); return d ? d.group : null; }
/** 부대에 그 장비를 든(알려진 고장 제외) 일할 수 있는 내리는 대원이 있는가 — 조직 정보 (R1 crewHasKit) */
export function crewHas(sim: Sim, u: Unit, id: KitId): boolean { return crewHasKit(sim, u, id, true); }
