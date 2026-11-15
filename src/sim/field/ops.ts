// 지휘 상태(Scene.ops)와 현장 생김새의 도움 함수 (설계서 X6 §2.4·§5).
// 이 파일은 **진실을 읽지 않는다**: s.cat·s.fire·s.props·s.casualties 를 보지 않고, 타일·구역·계단(생김새)과 지휘 상태만 읽는다.
// 그래서 세계 규칙(field/catastrophe.ts)과 지휘 쪽(지휘 규칙·대원의 판단부)이 같은 함수를 함께 쓸 수 있다.
//
// 단계 1 에는 생김새 도움 함수 둘만 있었다. 단계 2 가 조짐·지휘 상태 사실의 id 공간(SIGN_BASE·OPS_ID·OPS_PAR)과 지휘 상태 사실의 값(OpsFact)을 더했다.
// 지휘 상태 쪽(opsOf·inZone·gateBlocks·cutOff·opsExterior·opsCordon·inRubble·isRubbleMode·evacPoint·exteriorSpot)은 그것을 쓰기 시작하는 단계(5·6)가 여기에 더한다.

import { T } from '../types';
import type { NoGoZone, OpsState, Scene } from '../types';
import { isIndoor } from './grid';

/**
 * 조짐 사실('sign')의 id 공간 (설계서 §3.2). 구획 번호·소품 id 를 더해 쓴다:
 *   struct = 구획 번호(0~998) · gas = 1000 + 구획 번호 (신고로 만든 위치 모르는 가스 조짐은 gasUnknown 1999 — 1000 + (−1) 이 struct 공간과 겹치지 않게)
 *   vessel = 2000 + 소품 id · fire = 3000 + 구획 번호 · dust = 4000 + 구획 번호 · bldg = 5000 · 도시가스 차단 완료(event, what 'utility') = 5001 · event = 6000 + 사건 번호
 */
export const SIGN_BASE = { struct: 0, gas: 1000, gasUnknown: 1999, vessel: 2000, fire: 3000, dust: 4000, bldg: 5000, utility: 5001, event: 6000 } as const;
/** 지휘 상태 사실('ops')의 id: 0 = 전술 모드와 진입 금지 구역(지휘관이 보낸다), 100 + rid = 그 대원의 인원 점검 응답(철수를 마친 대원이 조용히 보낸다) */
export const OPS_ID = 0, OPS_PAR = 100;
/** 'ops' 사실 id 0 의 값 — 지휘관이 보내는 전술 모드와 진입 금지 구역 (구역의 기록·까닭·시각은 싣지 않는다). R3 의 doctrine.opsLevel 이 zones[].regions·level 을 읽는다 */
export interface OpsFact { mode: OpsState['mode']; zones: Pick<NoGoZone, 'key' | 'kind' | 'level' | 'regions' | 'x' | 'y' | 'r'>[]; t: number }
/** 'ops' 사실 id 100 + rid 의 값 — 인원 점검 응답 */
export interface ParFact { par: true; t: number }

/** footprint 의 값 */
export const FOOT_OUT = 0, FOOT_IN = 1, FOOT_SHELL = 2, FOOT_FLOOR_EDGE = 3;

const isWall = (t: number): boolean => t === T.WALL || t === T.WINDOW;
const isOutside = (t: number): boolean => t === T.GROUND || t === T.ROAD || t === T.TREE || t === T.TRAIL;

const FOOT = new WeakMap<Scene, Uint8Array>();
/**
 * 건물 칸 (칸별 0~3). **처음 부를 때의 생김새**로 한 번 계산해 둔다 — 무너져도 다시 계산하지 않는다(원래 모습).
 * 세계 규칙이 현장의 첫 틱에 부르므로(catOf) 원래 생김새가 들어간다.
 *   0 바깥
 *   1 건물 안: 실내 칸(바닥·문·가구·계단)과 그 8 이웃의 벽·창 (안쪽 벽)
 *   2 바깥벽: 그 벽·창 가운데 4 이웃에 바깥 칸(땅·도로·나무·산길)이 있는 것. 격자 밖과 맞닿은 벽도 바깥벽으로 본다
 *   3 층 경계: 4 이웃에 빈 공간(T.VOID)이 있는 벽·창 — 2 보다 먼저 판정한다. 2층 건물의 위층은 둘레가 빈 공간뿐이라
 *     이것이 없으면 위층 외벽이 모두 안쪽 벽이 된다. 어떤 붕괴도 이 칸을 바꾸지 않는다 (두 층 사이 4칸 이상을 지킨다)
 */
export function footprint(s: Scene): Uint8Array {
  let f = FOOT.get(s);
  if (f) return f;
  const w = s.w, h = s.h, t = s.tiles;
  f = new Uint8Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const ti = t[i];
    if (isIndoor(ti)) { f[i] = FOOT_IN; continue; }
    if (!isWall(ti)) continue;
    let near = false;
    for (let yy = y - 1; yy <= y + 1 && !near; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || (xx === x && yy === y)) continue;
      if (isIndoor(t[yy * w + xx])) { near = true; break; }
    }
    if (!near) continue;
    let edge = false, shell = false;
    for (let d = 0; d < 4; d++) {
      const xx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), yy = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) { shell = true; continue; }
      const tj = t[yy * w + xx];
      if (tj === T.VOID) edge = true; else if (isOutside(tj)) shell = true;
    }
    f[i] = edge ? FOOT_FLOOR_EDGE : shell ? FOOT_SHELL : FOOT_IN;
  }
  FOOT.set(s, f);
  return f;
}

const NBRS = new WeakMap<Scene, number[][]>();
/**
 * 이웃 구획 (구역 번호 → 이웃한 실내 구역 번호들, 오름차순). **처음 부를 때의 생김새**로 한 번 계산해 둔다 —
 * 붕괴 뒤의 타일로 다시 계산하면 지휘 쪽이 보지 못한 붕괴를 이웃 관계로 알게 된다.
 * 두 실내 구역이 이웃인 경우:
 *   · 두 구역의 칸이 벽(또는 창) 한 칸을 사이에 두고 마주 본다 (4방향, 벽 너머 두 칸째)
 *   · 문 칸 하나로 이어진다 (문 칸과 그 4 이웃 칸의 구역들)
 *   · 벽 없이 맞닿아 있다 (꺾인 복도처럼 한 공간을 둘로 나눈 구역)
 * 빈 공간(T.VOID) 너머와 계단(stairTo)으로는 이웃이 아니다. 실내가 아닌 구역(마당·길가)은 넣지 않는다.
 * 처음 값(붕괴 현장의 곁 구획)·하중 이동·진입 금지 구역의 범위·소리가 모두 이것을 쓴다.
 */
export function regionNbrs(s: Scene): number[][] {
  let out = NBRS.get(s);
  if (out) return out;
  const w = s.w, h = s.h, t = s.tiles, reg = s.region, regs = s.regions;
  const sets: Set<number>[] = regs.map(() => new Set<number>());
  const link = (a: number, b: number): void => {
    if (a < 0 || b < 0 || a === b || !regs[a].indoor || !regs[b].indoor) return;
    sets[a].add(b); sets[b].add(a);
  };
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const ti = t[i];
    if (!isIndoor(ti)) continue;
    const a = reg[i];
    for (let d = 0; d < 4; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx, tj = t[j];
      if (isIndoor(tj)) {
        // 맞닿은 두 실내 칸: 구역이 다르면 이웃 (문 칸이든 열린 경계든)
        link(a, reg[j]);
        // 문 칸은 어느 구역에도 들지 않았을 수 있다: 문 건너편 칸과 잇는다
        if (tj === T.DOOR && a >= 0) for (let e = 0; e < 4; e++) {
          const x2 = xx + DX[e], y2 = yy + DY[e];
          if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
          const k = y2 * w + x2;
          if (isIndoor(t[k])) link(a, reg[k]);
        }
      } else if (isWall(tj)) {
        const x2 = xx + DX[d], y2 = yy + DY[d];
        if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
        const k = y2 * w + x2;
        if (isIndoor(t[k])) link(a, reg[k]);
      }
    }
  }
  out = sets.map((q) => Array.from(q).sort((p, r) => p - r));
  NBRS.set(s, out);
  return out;
}
