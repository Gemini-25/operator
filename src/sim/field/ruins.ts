// 그림용 기록 (docs/specs/G4-scene-legibility.md). 시뮬레이션의 어떤 판단도 이 기록을 읽지 않는다.
// 난수를 부르지 않고 emit 하지 않는다. 기록을 켜든 끄든 같은 시드의 결과는 같다 — tests/legibility.test.ts 가 RUIN_LOG.on 을 바꿔 가며 확인한다.
import type { Sim } from '../engine';
import type { FallRecord, Scene } from '../types';

export const RUIN_WALL = 1, RUIN_SECONDARY = 8, RUIN_CEILING = 9, RUIN_FURN = 16;
/** (X6) 전체 붕괴의 잔해 바닥 — markRuin 이 아직 0 인 칸에만 적는다 (벽·가구였던 칸은 그 모습을 지킨다) */
export const RUIN_TOTAL = 10;
/** 테스트 전용 스위치: 끄면 아무것도 기록하지 않는다 */
export const RUIN_LOG = { on: true };

/** 칸 i 가 무엇이었다가 무너졌는지 적는다. 처음 모습(벽·가구)은 나중의 2차 붕괴·천장 붕괴가 덮어쓰지 않는다 */
export function markRuin(s: Scene, i: number, code: number): void {
  if (!RUIN_LOG.on) return;
  if (!s.ruin) s.ruin = new Uint8Array(s.w * s.h);
  if (s.ruin[i] === 0 || code === RUIN_WALL || code >= RUIN_FURN) s.ruin[i] = code;
}

/** 무너진 순간을 적는다. fx 면 'collapse' 효과도 남긴다(카메라·자동 감속·소리가 이것을 본다. 그림은 falls 로 그린다) */
export function recordFall(sim: Sim, s: Scene, x: number, y: number, r: number, cause: FallRecord['cause'], fx = true): void {
  if (!RUIN_LOG.on) return;
  const list = s.falls ?? (s.falls = []);
  if (list.length < 32) list.push({ t: sim.t, x, y, r, cause, region: s.region[Math.round(y) * s.w + Math.round(x)] ?? -1 });
  // G5 가 맞춘 효과 기록의 모양(kind,t,x,y,x2,y2,text,color,ttl,c — hazards.pushFx 와 같다). 60개 상한도 pushFx 와 같다
  if (fx) { s.fx.push({ kind: 'collapse', t: sim.t, x, y, x2: undefined, y2: undefined, text: undefined, color: undefined, ttl: 2.6, c: undefined }); if (s.fx.length > 60) s.fx.splice(0, s.fx.length - 60); }
}
