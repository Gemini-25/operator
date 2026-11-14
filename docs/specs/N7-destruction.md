# N7 — 현장 파손 (창문과 가구가 부서진다)

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/destruction`, 개발 서버 포트 **5204**.

**자기 파일**: `src/sim/field/damage.ts`(새로 만든다), `src/view/scene/staticLayer.ts`, `src/view/scene/fx.ts`, `src/view/audio.ts`, `tests/destruction.test.ts`.
**공용 파일 수정**(아래에 적힌 곳만): `src/sim/field/executor.ts` `shootAt`, `src/sim/field/hazards.ts` 의 용의자 사격 두 곳·`flashbang`·`blast`·(선택) `tickFire`, `src/view/renderScene.ts` 의 효과 그리기, `src/ui/Viewport.tsx` 의 소리 조건(필요하면).

## 무엇을 만드는가

총격전과 폭발이 현장에 흔적을 남기고, **엄폐물이 닳아 없어지면 전술이 달라진다.**

1. 탄이 지나간 창문이 깨진다.
2. 엄폐물로 쓰인 가구가 맞을 때마다 닳고, 다 닳으면 부서져 바닥이 된다(더 이상 엄폐가 아니고, 지나갈 수 있다).
3. 섬광탄은 가까운 창을, 폭발(가스통·누출 가스·폭발물)은 반경 안의 창과 가구를 부순다.
4. 깨진 창·부서진 가구·닳은 가구가 그림에 보이고, 깨지는 순간의 효과와 소리가 있다.

## 자료 (이미 `types.ts`·`kit.baseScene` 에 있다)

- `Scene.glass: Uint8Array` — 창 칸(`T.WINDOW`)에서 1 = 깨짐.
- `Scene.decorHp: Uint8Array` — 가구 칸의 상태. **0 = 멀쩡, 1…200 = 지금까지 받은 피해량, 255 = 부서짐**(칸은 `T.FLOOR` 가 되고 `decor[i]` 는 그대로 남아 무엇의 잔해인지 알려 준다).
- `Fx.kind`: `'glass'`(유리 파편), `'debris'`(가구 파편).
- 내구(부서지기까지의 피해량): `PLANT` 1, `TABLE`·`DESK`·`SHELF` 2, `BED`·`SOFA`·`CABINET` 3, `COUNTER`·`KITCHEN`·`CRATE` 4, `MACHINE` 6.

## `src/sim/field/damage.ts` (세계 규칙 — 진실을 읽고 바꾼다)

```ts
import type { Sim } from '../engine';
import type { Scene } from '../types';

export const DECOR_HP: Record<number, number>;                       // DECOR 값 → 내구
/** 창 한 칸을 깬다. 이미 깨졌거나 창이 아니면 false. 효과 'glass', s.staticVersion++ */
export function breakGlass(sim: Sim, s: Scene, i: number): boolean;
/** 가구 한 칸에 피해를 준다. 부서지면 true (칸 → T.FLOOR, decorHp = 255, s.fuel 은 절반, 효과 'debris', s.staticVersion++) */
export function damageDecor(sim: Sim, s: Scene, i: number, amount: number): boolean;
/** 탄도: (x0,y0) → (x1,y1) 선이 지나는 창을 깬다 (벽에 막히면 거기서 멈춘다). over 칸만큼 목표를 지나쳐 더 나아간다 (빗나간 탄) */
export function bulletPath(sim: Sim, s: Scene, x0: number, y0: number, x1: number, y1: number, over: number): void;
/** 사격을 받은 사람(tx,ty)과 쏜 사람(sx,sy) 사이의, 받은 사람 바로 옆 엄폐 가구 칸 (없으면 -1) */
export function coverTile(s: Scene, tx: number, ty: number, sx: number, sy: number): number;
/** 폭발·섬광: 반경 안의 창을 깨고(시야선 무관), decorDmg > 0 이면 반경 안 가구에 피해 */
export function shatter(sim: Sim, s: Scene, x: number, y: number, glassR: number, decorR: number, decorDmg: number): void;
```

- 선 긋기는 `grid.ts` `los` 의 정수 격자 걷기를 본뜬다. `T.WALL`·`T.ROCK`·`T.VOID`·닫힌 문에서 멈춘다.
- **난수**: 파손은 새 흐름을 쓴다 — `sim.rng.fork('dmg:' + s.id)` 를 `WeakMap<Scene, Rng>` 에 넣어 두고 쓴다. `s.rng` 를 한 번이라도 더 부르면 교전의 다른 결과까지 바뀐다(금지).
- 부서진 가구 칸은 `T.FLOOR` 이므로 경로·엄폐 판단(`executor.isCoverTile`, `shootAt` 의 `covered`)이 **따로 고치지 않아도** 달라진다. 방이 끊길 일은 없다(바닥이 늘어날 뿐).
- 깨진 창은 여전히 지나갈 수 없다(`staticPass` 를 고치지 않는다). 시야는 원래 통과한다.

## 부르는 곳 (공용 파일 수정)

| 곳 | 무엇을 |
|---|---|
| `executor.ts` `shootAt` — `pushFx(… 'shot' …)` 바로 뒤 | `bulletPath(sim, s, a.x, a.y, h.x, h.y, hit ? 0 : 3)`. 빗나갔고 `covered` 였다면 `const c = coverTile(s, h.x, h.y, a.x, a.y); if (c >= 0 && dmgRng.chance(0.7)) damageDecor(sim, s, c, 1)` |
| `hazards.ts` `tickHostiles` — 대원을 향한 사격(`pushFx(… 'shot' … ta.x …)`, 지금 474줄 근처) | `bulletPath(sim, s, h.x, h.y, ta.x, ta.y, hit ? 0 : 3)`. 빗나갔고 `ta.inCover` 면 대원 옆 엄폐 가구에 같은 방식으로 피해 |
| `hazards.ts` — 인질·시민을 향한 사격(420줄 근처), `panicShot` | `bulletPath(…, 0)` 만 |
| `hazards.ts` `flashbang` | `shatter(sim, s, x, y, 2.2, 0, 0)` |
| `hazards.ts` `blast` — 함수 끝 | `shatter(sim, s, x, y, radius + 1.5, Math.min(2.5, radius), 3)` |
| (선택) `hazards.ts` `tickFire` | 불길이 0.7 이상인 칸의 이웃 창은 화재 틱마다 6% 로 깨진다(열에 의한 파손 — 화재 현장에도 흔적이 남는다). 파손용 난수 흐름으로 |

`damage.ts` 가 `hazards.ts` 의 `pushFx` 를 가져다 쓰면 서로를 import 하게 된다. 함수 안에서만 서로 부르므로 문제는 없지만, 꺼림칙하면 `pushFx` 와 같은 내용을 `damage.ts` 에 짧게 둔다(`s.fx.push({ kind, t: sim.t, x, y, ttl })`).

`emit` 은 **가구가 부서져 엄폐가 사라졌을 때만** 한 줄 남긴다: `emit({ inc, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, text: '총격에 ○○의 가구가 부서져 엄폐물이 사라졌습니다.' })` — 같은 현장에서 10초에 한 번까지만. 창이 깨진 것은 기록하지 않는다(효과와 소리로 충분하다. 기록이 넘친다).

## 그림

- `staticLayer.ts`: 고정 층은 `s.staticVersion` 이 바뀌고 `staticSig(s)` 가 달라질 때 다시 그려진다. `staticSig` 에 **깨진 창 수와 가구 피해의 합**을 넣는다(지금 식을 읽고 같은 방식으로 더한다).
  - 깨진 창: 창틀은 남기고 유리 대신 들쭉날쭉한 조각 두세 개 + 안팎 바닥에 반짝이는 파편(칸 번호 해시로 자리를 정한다 — `common.ts` 의 해시 함수. 매번 같은 그림이어야 한다).
  - 닳은 가구(1…): 탄흔(작은 어두운 점 2~4개)과 깨진 모서리.
  - 부서진 가구(255): 바닥 위에 그 가구 색의 조각 더미(낮고 납작하게 — 지나갈 수 있어 보여야 한다).
- `renderScene.ts` 의 효과 분기(`f.kind === 'shot' | 'flash' | 'boom'` 이 있는 곳)에 `glass`(0.5초: 흰·하늘색 조각 6~8개가 창에서 튀어 떨어진다)와 `debris`(0.6초: 갈색 조각과 먼지)를 더한다. 조각 그리는 함수는 `fx.ts` 에 두고 `renderScene.ts` 에는 호출 한 줄씩만.
- `audio.ts`: `glass`(짧고 높은 잡음 + 맑은 고음 두 개), `debris`(낮은 둔탁한 잡음). 지금의 `shot`·`boom` 과 같은 방식(`this.ok(…)` 로 빈도 제한).

## 완료 조건

- `npx tsx scripts/sweep.ts 40 --diff 3,3,5,3,3,3 --scen` 전후 비교: 무장 사건의 성공률이 ±6%p 안, 한계 시간 건수가 늘지 않는다(엄폐가 사라지는 것이 균형을 크게 흔들지 않는다). 크게 흔들리면 가구에 주는 피해 확률(0.7)을 낮춘다.
- 평소 교대(`npm run check`)가 통과한다. 사격이 없는 사건의 결과는 달라지지 않아야 한다(파손용 난수 흐름을 따로 쓰므로) — 화재 사건의 선택 항목을 넣었다면 화재 결과도 그대로인지 `--scen` 으로 본다.
- 화면: 총격이 난 현장(`?seed=…&diff=3,3,5,3,3,3` 에서 무장 사건을 찾거나 `?force=armed/shooter`)을 찍어 깨진 창과 부서진 가구가 보이는지 확인한다. 콘솔 오류 0건.

## 테스트 (`tests/destruction.test.ts`)

1. `breakGlass`: 창 칸에서 한 번만 참, `glass[i] === 1`, `staticVersion` 증가. 창이 아닌 칸은 거짓.
2. `damageDecor`: 내구만큼 맞으면 `T.FLOOR` + `decorHp === 255`, 그 전에는 `T.FURN` 그대로.
3. `bulletPath`: 벽 뒤의 창은 깨지지 않는다. 선 위의 창은 깨진다.
4. `threat: 5` 로 12교대: 총격(`fx` 가 아니라 문제 기록의 '교전 발생')이 있었던 현장 가운데 깨진 창이 있는 현장이 하나 이상. 깨진 창 칸은 모두 `T.WINDOW` 다.
5. 파손이 일어난 뒤에도 그 현장의 모든 바닥에 닿는다(부서진 가구 칸 포함).
6. 재현성: 같은 시드 두 번의 `report.hash` 가 같다.
