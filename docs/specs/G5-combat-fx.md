# G5 — 교전 연출 (총격·섬광탄·폭발·진입이 "정말 일어나는" 것처럼)

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/combat-fx`, 개발 서버 포트 **5225**. 본보기: `N7-destruction.md`(기록용 효과, 파손용 난수 흐름), `U1-ui.md`(화면만 고치는 묶음의 완료 조건).

사용자의 말: "총격전이나 대치 이런거는 정말 하는건지 확실히 알 수 있게 그래픽적으로랑 사운드 적으로 신경 써줘. 총을 쏴서 실제로 총알이 나간다던가 섬광탄이나 폭탄을 쓴다던가 브리칭을 한다던가 그런거"

**한 줄 원칙.** 시뮬레이션의 결과는 한 건도 바뀌지 않는다(기록 해시 동일). 시뮬레이션은 이미 일어나는 일(사격·섬광탄·폭발·문 열기·검거)에 **기록용 꼬리표**만 붙이고, 그림과 소리는 그 꼬리표를 읽기만 한다. 잔혹한 묘사(피·신체 훼손)는 쓰지 않는다. 맞는 순간은 섬광·궤적·충격으로 보여 준다.

**자기 파일**(새로 만든다): `src/sim/field/fxlog.ts`, `src/view/scene/fxBook.ts`, `src/view/scene/combat.ts`, `src/view/city/combatPin.ts`, `src/view/audioCombat.ts`, `tests/combatfx.test.ts`, `scripts/combatshots.cjs`.
**공용 파일 수정**(6절의 표에 적힌 곳만, 가장 작은 조각으로): `src/sim/types.ts`(추가만), `src/sim/field/damage.ts`, `src/sim/field/hazards.ts`, `src/sim/field/executor.ts`, `src/sim/field/rules/crime.ts`, `src/view/renderScene.ts`, `src/view/scene/sprites.ts`, `src/view/scene/fx.ts`, `src/view/audio.ts`, `src/view/runner.ts`, `src/view/camera.ts`, `src/view/renderCity.ts`, `src/ui/Viewport.tsx`, `src/ui/App.tsx`, `src/ui/MapLegend.tsx`.
**건드리지 않는다**: README 공통 규칙의 목록, `src/sim` 의 다른 파일 전부(특히 판단부 `commander.ts`·`brain.ts`·`dispatch/*`), `scripts/screenshot.cjs`(Q1 화면 자동 테스트가 고칠 수 있다), `ui/panels.tsx`·`styles.css`(새 설정 화면을 만들지 않는다).

시작 조건: B3·P1·Q1 은 이미 합쳐졌다(`23059fa`·`7626032`·`035a83f`, 이 문서의 줄 번호는 그 뒤인 `d876c96` 기준). 그 뒤의 커밋(B1 이 먼저 합쳐지면 그 뒤)에서 브랜치를 딴다. 앞 묶음들이 `executor.ts`·`hazards.ts`·`kit.ts`·`types.ts` 를 고치므로, 기준 해시(2.6절)는 **이 묶음을 시작하는 커밋에서** 잰다.

순서: `docs/ROADMAP.md` 의 나눔대로라면 G5 는 R1·H1·X6·R2 보다 **먼저** 구현된다. 그래서 G5 가 만드는 기록 함수(`fxlog.ts`)와 그림 이름을 뒤의 묶음이 쓴다. 이름은 이미 쓰인 R1·R2·H1·G4·X6 설계서의 이름에 맞췄다(11절). G4 와는 순서가 정해지지 않았다 — 먼저 합친 쪽이 그대로이고 나중 쪽이 맞춘다(11절의 G4 줄).

**사용자에게 확인할 것**(구현을 막지 않는다 — 아래 기본값으로 만들고, 보고에 다시 적어 묻는다):
- (a) 요청의 "폭탄을 쓴다"가 **대원의 폭파 진입**(문을 폭약으로 여는 것)이라면, 그것은 지금 시뮬레이션에 없는 행동이다. 이 묶음은 결과를 바꿀 수 없으므로 `BreachHow 'charge'` 를 이름만 예약하고 그리지 않는다(3.5절). 원하면 R2(대응 방식)에 결과가 바뀌는 실제 방법으로 넣어야 한다. 지금 그리는 "폭탄"은 용의자의 폭발물·가스 폭발 같은 **이미 일어나는 폭발**과 대원의 섬광탄이다.
- (b) 잠기지 않은 닫힌 문에도 진입조 구성에 따라 공성추·발차기 그림을 쓴다(`breachHowFor`, 10.5절). 시뮬레이션은 문을 여는 방법을 다루지 않으므로 이것은 그림의 해석이다. 싫으면 잠기지 않은 문은 `push`(밀어 엶)로만 그린다.
- (c) 빗나간 탄의 그림 선과 실제로 창이 깨지는 선이 1칸 남짓 어긋날 수 있다(2.3절 끝). 맞추려면 "어느 창이 깨지는가"라는 상태를 바꿔야 해서 이번에는 하지 않는다.

---

## 1. 지금 상태 — 무엇이 보이고 들리며, 무엇이 드러나지 않는가

조사한 커밋은 `0636387` 이고, 줄 번호는 `d876c96`(B3·P1·Q1 합친 뒤)에 맞춰 다시 적었다. B1·G4 등이 먼저 합쳐지면 또 밀리므로 **줄 번호가 아니라 함수 이름과 2.4절의 "찾을 글귀"(코드 조각)로 찾는다.**

| 장면 | 지금 보이는 것 | 지금 들리는 것 | 드러나지 않는 것 | 근거 |
|---|---|---|---|---|
| 대원 사격 | 옅은 직선 + 탄두 구간 + 총구 화염. 총구 화염이 총구가 아니라 몸 가운데에 겹친다 | lowpass 잡음 0.09초 + square 150→60Hz | 누가 무엇으로 쐈는지(효과 기록에 쏜 사람·무기가 없고 색만 `#ffe08a`/`#ff8a5c`), 반동 | `executor.ts:281-313`, `renderScene.ts:603-622`, `sprites.ts:141-142` |
| 용의자 사격 | 위와 같은 그림(주황) | **대원과 같은 소리** + 첫 발에 문제 경보음(톱니파 220/196Hz) | 조준, 발사 직전 예고(hold→fight 첫 쿨다운 `0.6+(1-aggression)`, `h.targetRid`) | `hazards.ts:472-500`, `audio.ts:86` |
| 사격선의 시간 | 효과 나이를 `sim.t - f.t` 로 재고 보간하지 않는다. ttl 0.25 라 두 틱(k=0, 0.8)만 그려진다 | — | 1배속 0.4초, 8배속 약 0.05초, 15배속 약 0.027초(60fps 한두 프레임) | `renderScene.ts:600`, `engine.ts:93-94` |
| 빗나감 | 사격선 끝이 목표 ±0.8칸(현장 주 난수 `s.rng` 로 흔든다) | — | 벽·문에 맞은 자리(먼지·불똥·탄흔). `bulletPath` 는 멈춘 칸을 돌려주지 않는다. 그림 선은 벽을 무시하고, 창을 깨는 실제 탄도는 흔들지 않은 목표 쪽으로 3칸 더 간다 | `damage.ts:107-139`, `executor.ts:294-295`, `hazards.ts:489-490` |
| 엄폐물 피격 | 가구가 부서질 때만 `debris` 효과. 닳을 때는 고정 층의 흔적만 | 부서질 때만 | 맞는 순간 | `damage.ts:90-105,145-169` |
| 피격 | 붉은 사각 조각 6개 + 붉은 고리(1.2초). 쓰러진 사람 밑 검붉은 타원(구조 대상 다친 정도×0.8, 용의자 0.5, 대원 0.3) | triangle 110→70Hz | 방탄(`Unit.armor`)으로 줄어든 피해와 실제 부상의 구분. **붉은 표현은 "피 없이" 요청과 부딪친다** | `renderScene.ts:634-637,328,353,398`, `sprites.ts:169` |
| 섬광탄 | 터진 자리 흰 원(4.6배까지) + 흰 고리 0.7초 | highpass 잡음 + sine 1900→1500Hz | 던진 사람·궤적·떨어진 자리(`flashbang()` 이 받지 않는다), 시야가 하얘지는 느낌, 남은 수(`u.flashbangs`) | `hazards.ts:295-306`, `executor.ts:347-351,768-772,785-789` |
| 폭발 | 크기가 고정된 주황 빛·고리·조각 10개 | sine 70→32Hz + lowpass 잡음 | 반경(연료 1.5, 2차 붕괴 2.6, 폭발물 3.4, 가스 용기 3.6, 가스 3.8)이 기록에 없다. 흔들림 없음 | `renderScene.ts:626-633`, `hazards.ts:82,131-146,595,622,669`, `rules/crime.ts:43` |
| 동시 진입 | 진입 전 파란 점선 고리 + `진입 지점 · N초` 알약, 진입하면 사라진다. 문짝은 평소처럼 0.22초에 돌아 열린다 | 없음(`진입!` 은 kind `action` 이라 소리가 없다) | 문을 부수는 순간, 파편·먼지, 3-2-1 신호 | `executor.ts:331-357`, `renderScene.ts:553-560`, `audio.ts:83-96` |
| 방 진입 | `방 진입 대기` 이름표, 문짝 열림 | 없음 | 위와 같다 | `executor.ts:756-781` |
| 잠긴 문 강제 개방 | 이름표 + 진행 고리. 길 위의 하위 작업(`a.task.sub`)이라 도구 자세가 나오지 않는다 | 완료 기록의 상승음뿐 | 타격, 문이 부서지는 순간. **무장 현장에는 잠긴 문이 없어 일어나지 않는다**(화재·승강기·가스만 `lockDoor`) | `executor.ts:112-124,215-238`, `renderScene.ts:103-121`, `builders.ts:68,84,311,726` |
| 대치·협상 | 용의자 시야 부채꼴, 발밑 맥동 원, 확성기 자세, 사기 막대, 대원의 `엄` 글자 배지 | 없음 | 서로 겨누는 선, 협상이 진행되는 모습 | `renderScene.ts:171-184,335-363,403`, `executor.ts:703-713` |
| 칼·맨손 공격 | `hit` 효과만 | `hit` 소리 | 휘두르는 동작 | `hazards.ts:501-504` |
| 검거 | 팔을 뒤로 한 자세 + 회색 막대 | 없음(`resolve` 는 SYSTEM 일 때만 소리) | 수갑을 채우는 순간 | `executor.ts:728,799,826,854`, `audio.ts:90` |
| 시한이 지나 인질이 다침 | 없음 | 문제 경보음 | 무슨 일이 있었는지(효과·탄도 없음) | `hazards.ts:383-387` |
| 기습 무력화 | 섬광탄 무력화와 같은 노란 점 넷 | — | 둘의 구별 | `hazards.ts:367-370`, `renderScene.ts:361` |
| 지도 화면 | 교전 중인 무장 사건이 조용한 무장 사건과 똑같다 | 사이렌만 | 교전 중이라는 것 | `renderCity.ts:254-312`, `audio.ts:119` |
| 높은 배속 | 첫 효과가 감속 전에 지나간다(틱을 다 돌린 뒤 감속을 검사한다) | 종류별 실제 시간 최소 간격뿐, 거리·좌우·압축기·동시 발음 상한 없음 | — | `runner.ts:115`, `Viewport.tsx:59-68`, `audio.ts:45-51` |

**원인은 셋이다.**
1. 기록이 빈약하다: `Fx` 는 `{ kind, t, x, y, x2?, y2?, text?, color?, ttl }` 뿐이다(`types.ts:219`). 쏜 사람·무기·결과·반경·던진 자리·문·방법이 없다.
2. 그림의 시간이 시뮬레이션 틱에 묶여 있다: 0.2초 단위로 끊기고 배속이 오르면 사라진다.
3. 소리에 원근·무기 구분·상한이 없고, 관찰 중인 현장에서만 난다.

**바꿔도 결과가 그대로인 근거.** `src/sim` 안에서 `s.fx` 를 읽는 곳은 정리 한 줄(`sceneManager.ts:249`, 맨 앞 기록이 4초 넘었으면 `shift`)뿐이다. 나머지는 모두 쓰기(`hazards.pushFx`, `damage.ts` 의 지역 `fx`)다. 재현성 해시(`sim.logHash`)는 `emit` 때의 틱과 문구로만 쌓인다(`events.ts:22-26`). `s.glass` 도 시뮬레이션 판단에서 읽지 않는다(grep: `damage.ts` 와 `scenes/major.ts:249` 의 쓰기뿐).

---

## 2. 시뮬레이션 쪽 기록 고리

### 2.1 허용 범위

- 허용: `s.fx` 에 기록을 넣는 것, 방금 넣은 기록 객체에 꼬리표 `c` 를 붙이는 것, 그것을 위해 **이미 있는 값을 읽는 것**(지역 변수에 담는 것 포함).
- 금지: 난수 호출(어떤 흐름이든 — 파손용 `dmg:` 흐름도), `emit`·`raiseProblem`·`markRecovered`, `s.fx` 밖의 상태 쓰기(문·사람·창·가구·부대·무전), `bulletPath`·`shatter`·`breakGlass` 의 추가 호출, **기존 줄의 식과 인자 순서 변경**. 특히 `executor.ts:294`(대원 사격)·`hazards.ts:489`(용의자 사격)·`executor.ts:251`(물줄기) 은 효과 인자 안에서 `s.rng` 를 부른다. 이 줄들은 한 글자도 바꾸지 않는다.
- 기존 `pushFx(…)` 줄은 그대로 두고 **그 다음 줄에** 꼬리표를 붙인다. `bulletPath` 가 `glass` 기록을 넣을 수 있으므로, 꼬리표를 붙일 기록은 `lastFx(sim, s, kind)`(같은 틱에 넣은 그 종류의 가장 최근 기록)로 찾는다.
- 기록 수는 거의 늘지 않는다: 사격 한 발에 새 기록을 더하지 않고 있던 `shot` 에 꼬리표만 붙인다. 새 기록은 진입·근접·검거·시한 초과·인질 피격처럼 드문 순간에만 생긴다. 그래서 60개 상한(`hazards.ts:16`, `damage.ts:51`)은 그대로 둔다.

### 2.2 자료형 (`src/sim/types.ts` — 추가만)

`Fx` 는 한 줄짜리 인터페이스다(`types.ts:219`). 그 줄은 **한 군데만** 고친다: kind 합집합의 끝에 `| 'melee' | 'breach' | 'cuff' | 'taser'`. 그 밖의 글자는 바꾸지 않는다(한 줄 인터페이스라 새 줄로 붙일 수 없다 — 보고에 적는다). 같은 줄을 G4(`'collapse'`)·R1(`'drop'`)·X6(`'horn'`)도 끝에 덧붙이므로, 합칠 때는 모두 살린다. 꼬리표 칸 `c` 는 그 줄에 넣지 않고 **인터페이스 합치기**로 더한다 — `Fx` 바로 위에 아래 블록(마지막 줄의 `export interface Fx { c?: FxInfo }` 포함)을 더하면 TypeScript 가 두 선언을 하나로 합친다.

```ts
// ── 교전 연출 기록 (G5) ── 시뮬레이션은 이 칸들을 읽지 않는다. 그림(view/scene/fxBook.ts)과 소리(view/audioCombat.ts)만 읽는다.
export type FxWeapon = 'pistol' | 'rifle' | 'hgun' | 'knife' | 'blunt'     // hgun = 용의자의 총
  | 'sniper' | 'taser'                   // R1 의 개인 장비 이름(KitId)과 같다
  | 'beanbag';                           // R2 의 비살상탄
export type FxResult = 'hit' | 'miss' | 'cover';
export type FxStop = 'body' | 'wall' | 'door' | 'furn' | 'far'
  | 'shield';                            // R1 의 방패에 맞음
export type BreachHow = 'open' | 'push' | 'kick' | 'ram' | 'irons' | 'hydraulic'   // 문 방법 이름은 R2 의 MethodId 와 같다(irons = 할리건·도끼)
  | 'charge';                            // 폭파 진입: 시뮬레이션이 실제 폭발 효과를 적용할 때만. 지금은 부르는 곳이 없다
export type ArrestHow = 'chase' | 'stunned' | 'tackle' | 'surrender';
export interface FxInfo {
  side?: 0 | 1;                          // 0 = 대원 쪽, 1 = 용의자 쪽
  by?: number;                           // 쏜·던진·진입한·검거한 사람: side 0 이면 대원 rid, 1 이면 용의자 id
  wpn?: FxWeapon;
  res?: FxResult;                        // 사격·근접·테이저의 결과
  ix?: number; iy?: number;              // 사격: 그려지는 탄이 멈춘 자리(칸 좌표, 소수)
  stop?: FxStop;                         // 사격: 무엇에 멈췄나
  tk?: 0 | 1 | 2; target?: number;       // 맞은 사람: 0 대원(rid) · 1 용의자(id) · 2 구조 대상(id)
  arm?: number;                          // 맞은 대원 부대의 방호(Unit.armor, 0..1)
  ox?: number; oy?: number;              // 힘이 온 곳: 피격은 쏜 자리, 섬광탄은 던진 사람, 진입은 진입조 쪽, 검거는 대원
  r?: number;                            // 반경(칸): 섬광탄 효과 반경, 폭발 피해 반경
  n?: number;                            // 섬광탄: 무력화한 용의자 수 · 진입: 함께 들어간 인원
  src?: 'bomb' | 'gas' | 'tank' | 'collapse' | 'fuel';
  door?: number;                         // 진입·강제 개방한 문(소품 id, 문 없는 출입구는 -1)
  how?: BreachHow;
  sync?: boolean;                        // 진입: 지휘관의 동시 진입 신호에 맞춘 진입(breach)
  forced?: boolean;                      // 진입: 잠긴 문을 부숴 열었다
  arrest?: ArrestHow;
}
/** (G5) 인터페이스 합치기: 아래 한 줄짜리 Fx 에 꼬리표 칸을 더한다 */
export interface Fx { c?: FxInfo }
```

`FxInfo['src']` 합집합은 X6 가 끝에 새 줄로 `| 'drum' | 'cng' | 'jet' | 'dust'` 를 더한다(X6 §7.4). 그림은 `src` 를 폭발물 그을음(3.4절) 하나에만 쓰고 크기는 `r` 로 정하므로, 모르는 `src` 가 와도 그대로 그린다.

종류별로 쓰는 칸:

| kind | x, y | x2, y2 | c |
|---|---|---|---|
| `shot`(있음) | 쏜 사람 | 그려지는 끝점(맞으면 목표, 빗나가면 ±0.8 흔든 자리 — 지금 그대로) | side, by, wpn, res, ix, iy, stop, tk, target, arm. 빗나간 탄이 인질을 맞히면(`noteCollateral`) res 'miss', stop 'body', tk 2 |
| `hit`(있음) | 맞은 사람 | — | side, ox, oy, tk, target, arm |
| `flash`(있음) | 터진 자리 | — | side 0, by, ox, oy(던진 사람), r 5.2, n |
| `boom`(있음) | 폭발 중심 | — | r, src |
| `breach`(새) | 문 칸(문 없으면 출입구) | — | by, ox, oy, door, how, n, sync, forced |
| `melee`(새) | 공격자 | 맞은 사람 | side 1, by, wpn, res, tk, target |
| `cuff`(새) | 용의자 | — | by(대원 rid), ox, oy, arrest, target |
| `taser`(새, R1 이 넣는다) | 쏜 사람 | 맞을 자리 | side 0, by, wpn 'taser', res, tk, target |

### 2.3 기록 함수 (`src/sim/field/fxlog.ts` — 새 파일)

`damage.ts` 처럼 자기 안에 짧은 push 를 두고 `hazards.ts` 를 import 하지 않는다(`hazards.ts`·`executor.ts` 가 이 파일을 부르고, 이 파일은 `damage.ts` 만 부른다 — 순환 없음).

```ts
// 교전 연출 기록 (docs/specs/G5-combat-fx.md). 이 파일은 s.fx 에 기록을 넣거나 방금 넣은 기록에 꼬리표(c)를 붙이기만 한다.
// 난수 금지, emit 금지, s.fx 밖의 상태를 쓰지 않는다. 시뮬레이션은 s.fx 를 읽지 않는다(sceneManager 의 정리 한 줄뿐).
import type { Sim } from '../engine';
import type { ArrestHow, BreachHow, Casualty, FieldAgent, Fx, FxInfo, FxWeapon, Hostile, Scene } from '../types';
import { coverTile, rayEnd } from './damage';

/** 시험용 스위치: 끄면 꼬리표와 새 기록을 남기지 않는다. 켜고 끈 두 실행의 결과가 같아야 한다(tests/combatfx.test.ts) */
export const FXLOG = { on: true };

/** 이 틱(sim.t)에 넣은 kind 기록 가운데 가장 최근 것. 뒤에서 6개까지만 본다. 없으면 null */
export function lastFx(sim: Sim, s: Scene, kind: Fx['kind']): Fx | null;
/** 새 기록. hazards.pushFx 와 같은 모양(모든 칸을 같은 순서로 채운다: kind,t,x,y,x2,y2,text,color,ttl,c)과 같은 상한(60) */
export function recFx(sim: Sim, s: Scene, kind: Fx['kind'], x: number, y: number, x2: number | undefined, y2: number | undefined, ttl: number, c: FxInfo, color?: string): Fx | null;
/** 대원의 무기: 지금은 부대 종류로 정한다 — tactical·swat 'rifle', 그 밖 'pistol'. R1(개인 장비)이 들어오면 R1 의 agentPose 규칙과 같이 sniper > rifle > pistol 을 hasKit 으로 고른다 */
export function weaponOf(sim: Sim, a: FieldAgent): FxWeapon;
/**
 * 기존 사격 줄이 없는 새 사격 코드(R2 의 비살상탄·저격, R1 의 저격 소총이 따로 쏘는 경우)를 위한 한 줄짜리 기록:
 * 'shot'(색은 side 로) + noteShot + 맞았으면 'hit' + noteHit. 판정(hit)은 부른 쪽이 이미 정한 값을 넘긴다 — 여기서 난수를 쓰지 않고, bulletPath 도 부르지 않는다.
 * hostage: 빗나간 탄이 인질을 다치게 했으면(R2 의 저격이 빗나가 인질이 다치는 경우 — 부른 쪽이 이미 판정했다) 그 인질. 주면 noteCollateral 까지 한다.
 */
export function recShot(sim: Sim, s: Scene, a: FieldAgent, wpn: FxWeapon, tx: number, ty: number, hit: boolean, tk: 0 | 1 | 2, target: number, hostage?: Casualty | null): void;
/**
 * 사격 기록에 꼬리표. tx,ty = 사격을 받은 사람의 자리(흔들기 전).
 *  맞음        → res 'hit',   ix,iy = f.x2,f.y2,  stop 'body'
 *  빗나감+엄폐 → coverTile(s, tx, ty, f.x, f.y) 가 있으면 res 'cover', ix,iy = 그 칸 가운데에서 쏜 쪽으로 0.45칸, stop 'furn'
 *  빗나감      → res 'miss',  rayEnd(s, f.x, f.y, f.x2, f.y2, 3) 의 자리와 stop ('wall' | 'door' | 'far')
 */
export function noteShot(sim: Sim, s: Scene, f: Fx | null, o: { side: 0 | 1; by: number; wpn: FxWeapon; hit: boolean; cover: boolean; tx: number; ty: number; tk: 0 | 1 | 2; target: number; arm?: number }): void;
/**
 * 빗나간 탄이 인질을 맞혔다(executor 의 인질 피격 분기): shot.c 를 res 'miss'(탄은 용의자를 빗나갔다 — 엄폐로 'cover' 였어도 'miss' 로 바꾼다),
 * stop 'body', tk 2, target = 인질 id, ix,iy = 인질 자리로 고치고, 인질 자리에 'hit' 기록(c: side, ox,oy = 쏜 자리, tk 2, target)을 더한다
 */
export function noteCollateral(sim: Sim, s: Scene, shot: Fx | null, hc: Casualty, sx: number, sy: number): void;
export function noteHit(f: Fx | null, o: { side: 0 | 1; ox: number; oy: number; tk: 0 | 1 | 2; target: number; arm?: number }): void;
/** 섬광탄: c = { side 0, by: 던진 사람 rid, ox, oy: 던진 사람 자리, r: 5.2, n }. by 가 없으면(옛 호출) ox,oy 를 비운다 */
export function noteFlash(f: Fx | null, by: FieldAgent | undefined, n: number): void;
export function noteBoom(f: Fx | null, r: number, src: NonNullable<FxInfo['src']>): void;
export function recBreach(sim: Sim, s: Scene, x: number, y: number, fromX: number, fromY: number, o: { door: number; how: BreachHow; n: number; sync: boolean; by: number; forced: boolean }): void;
/**
 * 진입 방법(그림·소리만 쓴다). 시뮬레이션은 방법을 다루지 않으므로 상태에서만 정한다 — 난수를 쓰지 않는다.
 *  이미 열린 문 → 'open'
 *  잠긴 문      → 진입조에 경찰이 있으면 'ram', 소방이면 'irons', 그 밖 'kick'
 *  닫힌 문      → 진입조에 swat 가 있으면 'ram', tactical 이면 'kick', 그 밖 'push'
 * R1 이 들어오면 진입조에 breachKit 을 든 사람(진입대원(파괴))이 있으면 'ram', irons 를 든 사람이면 'irons' 로 본다. 'charge' 는 여기서 고르지 않는다.
 */
export function breachHowFor(sim: Sim, team: FieldAgent[], wasLocked: boolean, wasOpen: boolean): BreachHow;
/** 흉기·맨손 공격: 'melee'(x,y = 용의자, x2,y2 = 대원, c = { side 1, by, wpn: knife 'knife' · 맨손 'blunt', res 'hit', tk 0, target }) */
export function recMelee(sim: Sim, s: Scene, h: Hostile, ta: FieldAgent): void;
/** 시한이 지나 인질을 다치게 함: 총이면 'shot'(용의자 → 인질, 색 '#ff8a5c', ttl 0.25, res 'hit', stop 'body') + 'hit', 아니면 'melee' + 'hit' */
export function recHarm(sim: Sim, s: Scene, h: Hostile, c: Casualty): void;
export function recCuff(sim: Sim, s: Scene, h: Hostile, a: FieldAgent, how: ArrestHow): void;
/** 테이저(지금은 부르는 곳이 없다): R1 이 테이저의 효과(h.stunUntil)를 적용하는 줄 바로 다음에 한 줄로 부른다 — R1 설계서 6.3절의 `pushFx(… 'shot' …, 노란색)` 대신 */
export function recTaser(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, hit: boolean, tk: 0 | 1 | 2, target: number): void;
```

모든 함수는 맨 앞에서 `if (!FXLOG.on) return` 한다(`lastFx` 제외).

`damage.ts` 에 더하는 것(난수 없음, 상태를 바꾸지 않음):

```ts
/**
 * (G5) 그림용 탄착점: bulletPath 와 같은 걷기(walk)로 (x0,y0) → (x1,y1) → over 칸 너머까지 간다. 아무것도 바꾸지 않는다.
 * 벽·바위·빈 공간이면 'wall', 닫힌 문이면 'door' — 자리는 마지막으로 지나간 칸과 막은 칸의 가운데(벽면).
 * 끝까지 가거나 현장 밖으로 나가면 'far' — 자리는 마지막 칸.
 */
export function rayEnd(s: Scene, x0: number, y0: number, x1: number, y1: number, over: number): { x: number; y: number; stop: 'wall' | 'door' | 'far' };
```

그리고 모든 기록이 **같은 모양**(같은 칸을 같은 순서로)이 되게 한다 — `CLAUDE.md` 함정 "자주 도는 객체의 모양"과 같은 이유다.
- `hazards.pushFx`: 마지막 인자 `c?: FxInfo` 를 더하고 객체를 `{ kind, t, x, y, x2, y2, text, color, ttl, c }` 로.
- `damage.ts` 의 지역 `fx()`: 지금은 `{ kind, t, x, y, x2, y2, ttl }` 이라 `pushFx` 와 이미 모양이 다르다. `{ kind, t, x, y, x2, y2, text: undefined, color: undefined, ttl, c: undefined }` 로.
- `fxlog.recFx`: 같은 순서로 모든 칸을 채운다.

**탄도와 그림의 차이에 대한 결정.** 빗나간 탄이 창을 깨는 선(`bulletPath`, 흔들지 않은 목표 쪽)은 그대로 두고, **그리는 선과 탄착점은 흔든 끝점 쪽**(`rayEnd`)으로 잡는다. 둘 사이는 목표 근처에서 0.8칸, 그 너머에서 1칸 남짓 벌어질 수 있다. `bulletPath` 의 목표를 흔든 끝점으로 바꾸면 그림과 탄도가 일치하지만, 그것은 "어느 창이 깨지는가"라는 상태를 바꾸는 일이다. 결과(해시·분포)에는 영향이 없다(`s.glass` 는 판단에서 읽히지 않는다). 그래도 이번 묶음의 허용 범위(기록만)를 넘으므로 하지 않는다. 바꾸고 싶으면 보고에 제안으로 적는다. [확인 필요: 사용자·합치는 사람의 판단]

### 2.4 채우는 자리

줄 번호는 `d876c96` 기준이고 밀릴 수 있다. **찾을 글귀**(그 줄에 있는 코드 조각)로 자리를 찾는다.

| # | 파일 · 함수 | 찾을 글귀 (`d876c96` 의 줄) | 넣는 자리 | 넣는 것 |
|---|---|---|---|---|
| 1 | `executor.ts` `shootAt` | `pushFx(sim, s, 'shot', a.x, a.y,` (294) | 그 줄 바로 다음, `bulletPath` 앞 | `const shot = lastFx(sim, s, 'shot'); noteShot(sim, s, shot, { side: 0, by: a.rid, wpn: weaponOf(sim, a), hit, cover: covered, tx: h.x, ty: h.y, tk: 1, target: h.id });` |
| 2 | 〃 인질 피격 분기 | `'교전 중 인질 피격'` (303) | 그 `raiseProblem` 줄 다음 | `noteCollateral(sim, s, shot, hc, a.x, a.y);` |
| 3 | 〃 `if (hit)` | `h.health -= s.rng.range(30, 48)` 다음 줄의 `pushFx(sim, s, 'hit', h.x, h.y)` (310) | 그 줄 다음 | `noteHit(lastFx(sim, s, 'hit'), { side: 0, ox: a.x, oy: a.y, tk: 1, target: h.id });` |
| 4 | `hazards.ts` `tickHostiles` 대원을 향한 사격 | `pushFx(sim, s, 'shot', h.x, h.y, ta.x +` (489) | 그 줄 다음, `bulletPath` 앞 | `noteShot(sim, s, lastFx(sim, s, 'shot'), { side: 1, by: h.id, wpn: 'hgun', hit, cover: ta.inCover, tx: ta.x, ty: ta.y, tk: 0, target: ta.rid, arm: u.armor });` |
| 5 | 〃 `if (hit)` | `pushFx(sim, s, 'hit', ta.x, ta.y);` 가 홀로 있는 줄 (498) | 그 줄 다음 | `noteHit(lastFx(sim, s, 'hit'), { side: 1, ox: h.x, oy: h.y, tk: 0, target: ta.rid, arm: u.armor });` |
| 6 | 〃 흉기·맨손 | `h.weapon === 'knife' ? 1.4 : 0.6` (503) | 같은 중괄호 안, `pushFx(… 'hit' …)` 다음 | `noteHit(lastFx(sim, s, 'hit'), { side: 1, ox: h.x, oy: h.y, tk: 0, target: ta.rid }); recMelee(sim, s, h, ta);` |
| 7 | 〃 총격범의 시민 사격 | `pushFx(sim, s, 'shot', h.x, h.y, target.x, target.y` (434) | `pushFx` 두 개가 있는 그 줄 다음 | `noteShot(sim, s, lastFx(sim, s, 'shot'), { side: 1, by: h.id, wpn: 'hgun', hit: true, cover: false, tx: target.x, ty: target.y, tk: 2, target: target.id }); noteHit(lastFx(sim, s, 'hit'), { side: 1, ox: h.x, oy: h.y, tk: 2, target: target.id });` |
| 8 | 〃 `panicShot` | `pushFx(sim, s, 'shot', h.x, h.y, c.x, c.y` (321) | 같은 방식 | 7과 같다(`c` 가 인질) |
| 9 | 〃 시한 초과 | `'시한이 지나 인질이 다침'` (386) | 그 `raiseProblem` 줄 다음 | `recHarm(sim, s, h, c);` (탄도·창은 건드리지 않는다) |
| 10 | 〃 `flashbang` | `export function flashbang(` (296), `pushFx(sim, s, 'flash'` (303) | 인자 끝에 `by?: FieldAgent`, `pushFx(… 'flash' …)` 다음 | `noteFlash(lastFx(sim, s, 'flash'), by, n);` |
| 11 | `executor.ts` 섬광탄 세 곳 | `bangs += flashbang(` (350) · `n = flashbang(sim, s, rd.x` (772) · `const n = flashbang(sim, s, a.x` (787) | `flashbang(…)` 호출 | 마지막 인자로 `thrower` · `thrower` · `a` |
| 12 | 〃 `breach` 의 문 반복문 | `// 출입구 바로 안쪽의 문` 아래 `for (const p of s.props)` (339-344) | 문을 바꾸기 **전에** `const wasLocked = p.blocking, wasOpen = !!p.open;` | 반복문 안, `inX` 계산 다음: `recBreach(sim, s, p.x, p.y, e.x, e.y, { door: p.id, how: breachHowFor(sim, team, wasLocked, wasOpen), n: team.length, sync: true, by: team[0].rid, forced: wasLocked }); doorSeen = true;` (`let doorSeen = false` 는 반복문 앞). 반복문 뒤 `if (!doorSeen) recBreach(sim, s, e.x, e.y, e.x, e.y, { door: -1, how: 'open', n: team.length, sync: true, by: team[0].rid, forced: false })`. 모두 섬광탄 호출보다 **앞**. 진입조가 없는 출입구(`if (!team.length) return;`)에는 기록이 없다 — 대체 기록을 만들지 않는다 |
| 13 | 〃 방 진입 | `rd.entered = true; rd.open = true;` (764) | 그 줄 앞에 `const wasLocked = rd.blocking;`, 다음 줄(`if (rd.blocking)` 765) 다음에 | `recBreach(sim, s, rd.x, rd.y, a.x, a.y, { door: rd.id, how: breachHowFor(sim, [a, ...mates], wasLocked, false), n: mates.length + 1, sync: false, by: a.rid, forced: wasLocked });` (섬광탄 앞) |
| 14 | 〃 `unblock` | `if (p.kind === 'door') { p.locked = false; p.open = true; }` (220) | 그 줄 다음 | `if (p.kind === 'door') recBreach(sim, s, p.x, p.y, a.x, a.y, { door: p.id, how: r.dept === 'police' ? 'ram' : r.dept === 'fire' ? 'irons' : 'kick', n: 1, sync: false, by: a.rid, forced: true });` — R2 가 `unblock(…, method)` 로 방법을 넘기게 되면 `how` 는 그 방법(`kick`·`irons`·`ram`·`hydraulic`)을 그대로 쓴다 |
| 15 | 폭발 자리 | `pushFx(sim, s, 'boom'` | 그 줄 다음 | `noteBoom(lastFx(sim, s, 'boom'), R, src)` — `tickFire` 의 가스 용기 `hazards.ts:82` (3.6, 'tank'), `tickLane` 의 연료 `:595` (1.5, 'fuel'), `tickGas` 의 가스 `:669` (3.8, 'gas'), `rules/crime.ts:43` `detonate` (3.4, 'bomb'), 그리고 `tickCollapse` 의 `:622` (2.6, 'collapse') 는 **G4 가 아직 합쳐지지 않았을 때만**(G4 는 그 줄을 'collapse' 기록으로 바꾼다 — 무너짐은 폭발 그림이 아니다. G4 가 나중에 오면 그 줄과 함께 이 꼬리표를 지운다). 반경은 그 자리의 `blast` 인자와 같은 수(연료는 `blast` 가 없어 1.5). X6 가 이 덩어리들을 함수로 옮기면 옮긴 자리에 같은 꼬리표를 다시 단다(X6 §7.5) |
| 16 | `executor.ts` 검거 네 곳 | `h.state = 'arrested'` (728 · 799 · 826 · 854) | 그 줄 앞에서 `const was = h.state;`, 그 뒤 `emit` 줄 다음 | `recCuff(sim, s, h, a, how)` — 728(추격·접근): `was === 'flee' ? 'chase' : 'tackle'` · 799(무력화된 용의자 제압): `'stunned'` · 826(곁에서 덮침): `'tackle'` · 854(`case 'arrest'`): `was === 'surrendered' ? 'surrender' : 'tackle'` |

`hazards.ts` 에서 `officersSeeing`(지금 내보내지 않는 순수 함수)을 `export` 로 바꾼다 — 그림이 "용의자가 지금 누구를 겨누는가"를 시뮬레이션과 같은 판정으로 그리기 위해서다(3.6절). 동작은 그대로다.

X6(위험의 현실화)이 새 폭발·붕괴를 만들면 그 `pushFx('boom')` 다음에도 `noteBoom` 한 줄을 넣는다.

### 2.5 수명

| kind | `s.fx` 안의 수명(ttl, 시뮬레이션 초 — 지금 값 그대로) | 연출 길이(3.1절의 연출 시계 초) |
|---|---|---|
| `shot` | 0.25 | 1.0(탄착 먼지까지), 탄흔은 남는 그림 |
| `hit` | 1.2 | 0.35 |
| `flash` | 0.7 | 2.3, 빈 깡통은 남는 그림 |
| `boom` | 1.1~1.6 | 1.6 + 0.25·r, 연기 2.8, 그을음은 남는 그림 |
| `breach` | 1.5(새) | 1.4 |
| `melee` | 0.4(새) | 0.4 |
| `cuff` | 2.0(새) | 1.85 |
| `taser` | 1.2(새) | 1.5 |
| `glass`·`debris` | 0.5·0.6 | 0.5·0.6 |

`s.fx` 의 기록은 60개를 넘거나 4초가 지나면 잘려 나간다(틱마다 하나). 그림·소리는 기록을 처음 본 프레임에 **객체 참조를 받아 두고**(3.1절 FxBook) 자기 시계로 그리므로, 그 뒤에 `s.fx` 에서 잘려도 상관없다. `runner.frame` 은 실제 시간 간격을 0.1초로 자르므로(`runner.ts:106`) 15배속에서도 한 프레임은 많아야 1.5초(약 8틱)다. 그 사이에 한 현장에 60개가 넘게 쌓일 일은 거의 없다(10절). 되감기·새로고침 복원처럼 한꺼번에 많은 틱을 도는 경우는 FxBook 이 비우고 다시 시작한다(3.1절).

### 2.6 해시 불변 증명

네 겹으로 증명하고 보고에 결과를 적는다.

1. **코드 근거(정적).** 시작 커밋 대비 `src/sim` 의 추가 줄에 난수·기록 호출과 상태 쓰기가 없다.
   ```bash
   git diff <시작 커밋> -- src/sim | grep '^+' | grep -v '^+++' \
     | grep -nP 'rng|Math\.random|emit\(|raiseProblem|markRecovered|\.(state|open|locked|blocking|entered|removed|health|stunUntil|morale|cooldown|facing|alertUntil|hp)\s*[-+*/]?=(?!=)|propAt\[|staticVersion|glass\[|decorHp\['
   ```
   결과가 0줄이어야 한다(그래서 주석에도 `rng` 라는 글자를 쓰지 않는다). `-P`(펄 정규식)라야 `(?!=)` 로 `===` 비교를 빼고 대입만 잡는다. 문 쓰기(`locked`·`blocking`·`entered`·`propAt`·`staticVersion`)와 용의자 상태(`stunUntil`·`morale`), 창(`glass`)까지 잡는다. `const wasLocked = p.blocking` 처럼 읽기만 하는 줄은 잡히지 않는다. 손으로 검토: 새 함수가 쓰는 곳은 `s.fx` 와 그 기록 객체(`f.c`)뿐이다.
2. **스위치 시험(동적).** `tests/combatfx.test.ts` 가 같은 시드를 `FXLOG.on = true`·`false` 로 돌려, 정한 틱(9절 1번)에서 `sim.logHash`(교대 끝의 `report.hash` 와 같은 누적값)와 상태 요약(아래)이 같은지 본다.
3. **시작 커밋 대비 해시 목록(동적).** 저장소 밖 임시 스크립트(8.1절)로, 시작 커밋과 끝 커밋에서 같은 실행 목록의 `report.hash`·상태 요약을 뽑아 `diff` 한다. 0줄이어야 한다. `flashbang` 인자 추가처럼 기존 줄을 건드린 변화는 2번 스위치로는 잡히지 않으므로 이것이 필요하다.
4. **분포.** `npx tsx scripts/sweep.ts 60` 의 `outcomes`·`close reasons` 가 전후 한 글자도 같다(CLAUDE.md: "화면만 고쳤다면 분포가 한 건도 달라지면 안 된다"). `npm run check` 통과.

상태 요약(효과 기록을 뺀 끝 상태의 지문): 사건마다 결과·종료 사유, 현장마다 `tiles`·`glass`·`decorHp` 의 합과 해시, 문 소품의 `open`·`locked`·`entered`, 용의자의 `state`·`health`, 구조 대상의 `health`·`where`, 대원의 끝 위치(소수 둘째 자리). FNV 같은 짧은 해시 하나로 줄인다.

---

## 3. 그림

### 3.1 연출 시계와 FxBook (`src/view/scene/fxBook.ts`)

그림의 시간을 시뮬레이션 틱에서 떼어 낸다.

- **실제 배속 `effSpeed`**: Viewport 가 프레임마다 `const effSpeed = runner.paused ? 0 : (runner.slowed ? 1 : runner.settings.speed)` 를 한 번 구해 **`book.frame` 과 `sound.update` 양쪽에** 넘긴다. 지금 `Viewport.tsx:72` 는 `runner.settings.speed` 를 넘기므로 자동 감속 중에도 15가 간다 — 그러면 1배속으로 보이는 교전에 8·15배속 소리 규칙(탄착·피격 소리 없음, 연사 압축, 이명 없음)이 걸린다. `audio.ts` 의 기존 `fast` 판정(`speed >= 8`)도 이 값으로 한다.
- **연출 시계** `book.clock`(초): 실제 시간으로 흐르고, 일시정지하면 멈추고, 배속이 높아도 `FX_RATE_MAX`(= 2) 배까지만 빨라진다. 흐르는 속도 `rate = min(effSpeed, FX_RATE_MAX)`(일시정지면 0). 1배속에서는 시뮬레이션 시간과 같다. 일시정지하면 그 순간의 예광선이 멈춰 보인다(스크린샷에 좋다). [확인 필요: 2 는 눈으로 보고 1.5~2.5 사이에서 고른다]
- **받아들이기**: Viewport 가 `runner.frame` 직후 프레임마다 `book.frame(sim, dtReal, { paused, speed: effSpeed, seeks })` 를 한 번 부른다(부르는 순서는 6절 끝). 진행 중인 모든 현장(`sim.scenes` 중 `archived` 가 아닌 것)의 `s.fx` 를 **뒤에서부터** 훑어 처음 보는 기록(`WeakSet<Fx>`)을 받는다(새 기록은 언제나 끝에 붙는다).
- **어떤 종류를 받는가**: **모든 종류**를 `fresh` 에 넣는다(소리·자동 감속·카메라·지도 핀이 쓴다 — G4 의 `'collapse'`, X6 의 `'horn'` 도). 그림 목록(`live`)에는 G5 가 그리는 종류(`FX_DRAWN`: `shot`·`hit`·`flash`·`boom`·`glass`·`debris`·`breach`·`melee`·`cuff`·`taser`)만 넣는다. 나머지는 그림에서 이렇게 다룬다:
  - `spray`·`radio`·`text`, R1 의 `'drop'`(물 투하), 그리고 앞으로 생길 모르는 종류: 지금처럼 `renderScene` 의 기존 반복문이 `s.fx` 를 시뮬레이션 나이로 그린다(물줄기처럼 계속 다시 넣는 효과는 연출 시계가 필요 없다). 기존 반복문은 `book` 이 있으면 `FX_DRAWN` 종류만 건너뛴다.
  - `'collapse'`(G4 — 그림은 G4 가 `falls` 로 그린다), `'horn'`(X6 — 소리·카메라·감속만): 그리지 않는다.
- **태어난 시각**: `born = clock - (sim.t - f.t) · rate / max(1, effSpeed)` — 한 프레임에 여러 틱이 돌았으면 틱 사이의 간격을 연출 시계로 옮겨 순서를 지킨다.
- **같은 틱의 순서**(연출 지연 `delay`): 같은 틱에 `breach` 가 있으면 그 틱의 `flash` 는 0.12초, `shot` 은 0.2초 늦게 시작한다(문이 열리고 → 깡통이 날아가고 → 터진다). 사격에 딸린 `hit`(같은 틱, `c.target` 이 같은 것)은 예광선 머리가 닿는 시각을 `delay` 에 더한다(3.2절).
- **합성 항목**(`s.fx` 에는 넣지 않는다): 기록이 없는 "상태에서 나오는 순간"도 그림과 소리가 같은 시각을 쓰도록 FxBook 이 `fresh`·`live` 에 직접 만든다. 진행 중인 모든 현장에서 만들고(검사는 가볍다), 소리는 `place()`(4.2절)가 거른다.
  - `'tick'`: `s.entryOrdered && !s.breachDone` 이고 `ceil(s.breachAt - sim.t)` 가 3·2·1 로 바뀌는 순간(`n` = 그 숫자). `born` 은 바뀐 시뮬레이션 시각으로 위 식과 같이 구한다. 3-2-1 숫자의 튕김(3.5절)과 삐 소리(4.3절)가 이것을 쓴다.
  - `'strike'`: 강제 개방 중인 대원(3.5절의 조건)마다 연출 시계 0.6초 박자. 타격 먼지·불똥과 타격음.
  - `'hail'`·`'reply'`: 협상 중인 대원(3.6절의 조건)마다 — 확성기 파동 1.1초 박자(`'hail'`), 말풍선 주기에서 용의자 풍선이 뜨는 순간(`'reply'`). 선택 소리(4.6절)가 쓴다.
- **수명과 상한**: 종류별 연출 길이(2.5절)가 지나면 버린다. 현장마다 상한(3.11절)을 넘으면 오래된 것부터 버린다.
- **남는 그림**(`decals`): 탄흔(벽·문), 폭발 그을음, 빈 섬광탄 깡통. 현장마다 상한이 있고 연출 시계로 천천히 사라진다. 화면 쪽 기억이므로 되감기하면 없어진다(10절).
- **초기화**: `sim` 객체가 바뀌거나 `runner.seeks` 가 바뀌면 모두 비운다. 비운 직후의 첫 받아들이기는 `fresh` 에 넣지 않는다(되감기·새로고침 복원 뒤에 소리·감속이 한꺼번에 터지지 않게 — 지금 `audio.resync` 와 같은 뜻).
- **`fresh`**: 이번 프레임에 처음 들어온 항목(기록 + 합성). 소리(4절), 카메라 다시 잡기(5.2절), 지도 핀(5.4절)이 이것을 쓴다. 지금 `audio.ts` 와 `Viewport.tsx` 가 따로 하던 "새 효과 찾기"(`fxT`)를 이것으로 바꾼다. 자동 감속만은 틱 단위로 봐야 해서 `stepGuard`(5.1절)가 `s.fx` 를 직접 본다.
- **화면 막의 실제 시간 상한**: 섬광탄 흰 막(3.3절)과 폭발 주황 막(3.4절)은 **둘을 합쳐 실제 시간 2.5초에 한 번**까지(FxBook 이 `dtReal` 을 누적한 `real` 로 잰다). 걸러진 막만 빠지고 현장 안의 빛·고리는 그대로 그린다.
- **개발용 한 걸음** `debugStep(dt)`: 일시정지 중에도 연출 시계만 `dt` 초 넘긴다(시뮬레이션은 그대로). 0.1·0.25·0.5초 장면을 흔들림 없이 찍는 데 쓴다(8.3절).

```ts
export const FX_RATE_MAX = 2;
/** G5 가 그리는 종류. 이 밖의 종류도 fresh 에는 들어간다(소리·카메라·감속·지도 핀) */
export const FX_DRAWN = new Set<string>(['shot', 'hit', 'flash', 'boom', 'glass', 'debris', 'breach', 'melee', 'cuff', 'taser']);
/** 결정적 순간(자동 감속·카메라 바로 다시 잡기). G4 는 'collapse', X6 는 'horn' 을 한 단어씩 더한다 */
export const DECISIVE = new Set<string>(['shot', 'flash', 'boom', 'breach']);
/** 상태에서 만든 합성 항목(s.fx 에는 넣지 않는다) */
export type SynKind = 'tick' | 'strike' | 'hail' | 'reply';
export interface FxEntry {
  kind: Fx['kind'] | SynKind;
  f: Fx | null;                                      // 합성 항목이면 null
  sid: number; x: number; y: number;                 // 합성 항목의 자리(기록이면 f.x, f.y)
  born: number; delay: number; dur: number; seed: number;
  n?: number;                                        // 'tick' 의 숫자(3·2·1), 'strike'·'hail' 의 대원 rid
}
export interface Decal { kind: 'hole' | 'scorch' | 'can'; x: number; y: number; r: number; born: number }
export class FxBook {
  clock: number;
  rate: number;                                      // 이번 프레임의 연출 시계 속도(소리 예약이 쓴다)
  real: number;                                      // 실제 시간 누적(화면 막 상한)
  fresh: FxEntry[];
  drawMs: number;                                    // 마지막 프레임의 교전 그림 시간(확인용)
  frame(sim: Sim, dtReal: number, o: { paused: boolean; speed: number; seeks: number }): void;   // speed = effSpeed
  debugStep(dt: number): void;                       // (개발용) 연출 시계만 dt 초 넘긴다
  live(sid: number): readonly FxEntry[];             // 그 현장에서 살아 있는 연출
  age(e: FxEntry): number;                           // clock - born - delay (음수면 아직 시작 전)
  decals(sid: number): readonly Decal[];
  recentBy(sid: number, side: 0 | 1, by: number, within: number): FxEntry | null;     // 반동·던지기 자세
  recentOn(sid: number, tk: 0 | 1 | 2, target: number, within: number): FxEntry | null; // 움찔
  doorKick(sid: number, propId: number): { age: number; how: BreachHow } | null;      // 문짝 연출
  shake(sid: number, ts: number): { x: number; y: number };   // 흔들림, **칸 단위**(안에서 화소 진폭을 ts 로 나눈다 — 3.4절)
  whiteout(sid: number): number;                     // 관찰자 흰 막(0..1, 실제 시간 상한 적용 뒤)
  orange(sid: number): number;                       // 폭발 주황 막(0..0.12, 같은 상한)
}
```

`drawScene` 의 옵션에 `book?: FxBook` 을 더한다(본 화면과 작은 창 모두 넘긴다). 넘기지 않으면(시험·옛 호출) 지금처럼 `s.fx` 를 시뮬레이션 나이로 그린다.

좌표: 그리는 함수는 칸 좌표를 받고 `(v + 0.5) · ts` 로 바꾼다(`renderScene` 의 `cx`·`cy` 와 같다). 쏜 사람·던진 사람이 아직 현장에 있으면(`c.by` 로 찾는다) **그려진 자리**(`ipos(…, alpha)`)를 출발점으로 쓴다. 없으면 기록의 자리.

모든 그리는 함수는 `src/view/scene/combat.ts` 에 두고 `renderScene.ts` 에는 호출 한 줄씩만 둔다(N7 규칙). `combat.ts` 는 import 할 때 DOM 을 건드리지 않는다(시험에서 가짜 맥락으로 부른다).

색 상수(`combat.ts`):

```ts
export const ALLY = { core: '#f2fbff', glow: '#6cc4ff', flash: '#fffbe6', flashOut: '#ffd27a', aim: '150,205,255' };
export const FOE  = { core: '#fff0d8', glow: '#ff6a3d', flash: '#fff2c8', flashOut: '#ff8a3c', aim: '255,90,70' };
```

### 3.2 사격

| 요소 | 모양 | 색 | 시간(연출 초) |
|---|---|---|---|
| 총구 섬광 | 출발점에서 겨눈 방향으로 총구 길이(소총 0.80칸 · 권총 0.58 · 용의자 총 0.58)만큼 나간 점에 앞으로 뾰족한 별. 소총: 길이 0.55칸·폭 0.22칸 세 갈래. 권총: 0.38·0.16 두 갈래. 용의자 총: 0.42·0.20 다섯 갈래(들쭉날쭉, 기록 해시로 모양을 정한다) | 속 `flash`, 겉 `flashOut` | `max(0.06, 2/fps)` — 60fps 에서 최소 두 프레임 |
| 총구 빛 | `drawLight` 반경 소총 2.4칸·권총 1.9칸(색 빛 단계). 밤·AI 시점 어둠에 2.6칸 구멍 | `#ffe2a0` | 0.08 / 구멍 0.25 |
| 반동 | 쏜 사람을 겨눈 반대쪽으로 0.06칸, 총을 0.04칸 들어 올림(`drawPerson` 의 `recoil`) | — | 0.10 |
| 예광선 | 총구 → 탄착점(`c.ix, c.iy`) 직선. 머리가 70칸/초로 나아간다(최소 0.05초). 꼬리 길이 소총 1.6칸·권총 1.1칸. 두 겹: 빛(굵기 `ts·0.14`, 가산 혼합, 알파 0.35)과 속(굵기 `max(1.5px, ts·0.045)`). **용의자 탄은 꼬리가 두 토막(사이 0.25칸)** — 색을 가리기 어려운 사람도 모양으로 가린다 | 대원 `ALLY.core/glow`, 용의자 `FOE.core/glow` | 날아가는 시간 |
| 남은 줄 | 머리가 닿은 뒤 총구~탄착점에 옅은 선(굵기 `ts·0.02`) | 대원 `#cfe9ff`, 용의자 `#ffd0b0`, 알파 0.25→0 | 0.25 |
| 탄착 — 벽 | 벽면에 먼지 한 줌(`fx.ts` 의 puff, 지름 0.6→1.1칸, 알파 0.5→0) + 불똥 3줄(0.15칸, 들어온 방향의 반사 쪽) + 탄흔 남는 그림(지름 0.1칸) | 먼지 `#b8b0a3`, 불똥 `#ffe2a0`, 탄흔 `rgba(20,18,16,0.7)` | 불똥 0.12, 먼지 0.8, 탄흔 60(현장당 80개) |
| 탄착 — 문 | 나무 조각 4개 + 작은 먼지 + 탄흔 | `#b98d56`, `#7a5a36` | 0.5 |
| 탄착 — 엄폐 가구 | 그 가구 색 조각 5개가 쏜 쪽으로 튀고 먼지 한 줌. N7 의 고정 층 흔적(닳은 가구의 탄흔)은 그대로 | `staticLayer.ts` 의 `rubbleColors(decor, x, y)`(이미 export, `drawDebrisFx` 가 쓰는 것과 같다) | 0.5 |
| 빗나가 멀리 | 머리가 마지막 0.6칸 동안 흐려지며 사라진다 | | |
| 피격 | 3.9절 — 흰·노란 불꽃 네 줄기(탄이 온 방향의 반대쪽으로 퍼짐) + 옅은 고리. 맞은 사람이 탄 방향으로 0.07칸 움찔(`drawPerson` 의 `flinch`, 쓰러진 사람은 움찔하지 않는다). 방호(`c.arm > 0`)가 있으면 불꽃이 푸른빛 + 판 반짝임 하나 | 불꽃 `#fffbe8`, 고리 `#ffd9a0` / 방호 `#cfe6ff`, `#8fb6d8` | 0.35 / 움찔 0.12 |

탄착과 피격은 **예광선 머리가 닿은 순간**에 시작한다(머리의 도착 시각을 `delay` 로 더한다). 탄도가 지나며 깨는 창(`glass` 기록)은 지금처럼 그 순간에 그린다.

탄피(선택): 쏜 사람 오른쪽으로 작은 놋쇠 점이 0.4초 동안 튀어 떨어진다. 남기지 않는다.

### 3.3 섬광탄

| 단계 | 시각(연출 초, 기록 기준) | 그림 |
|---|---|---|
| 던짐 | 0 ~ 0.28 | 던진 사람(`c.by` 의 그려진 자리, 없으면 `c.ox, c.oy`)의 팔 자세 `throw`(한 팔을 뒤로 젖혔다 앞으로). 깡통(0.18×0.09칸 짙은 원통 + 밝은 띠)이 포물선으로 난다: 바닥 그림자는 직선, 깡통은 화면 위쪽으로 `min(1.4, 거리·0.25)·sin(πk)` 칸 떠서 초당 3바퀴 돈다. `c.ox` 가 없으면(옛 호출) 이 단계를 건너뛴다 |
| 구름 | 0.28 ~ 0.34 | 터질 자리에서 작게 한 번 튀고 구른다 |
| 터짐 | 0.34 ~ 0.46 | 가산 혼합의 흰 원(반경 0.6→2.0칸) + 빛살 8줄(1.8칸) |
| 방을 채움 | 0.34 ~ 1.05 | 터진 자리에서 반경 `c.r`(5.2)칸 안, **시야선이 닿는 곳만**(`common.visPoly`) 흰 방사형(가운데 0.75 → 끝 0)으로 채운다. 시뮬레이션이 무력화를 판정한 범위(5.2칸 · 시야선)와 같은 모양이다 |
| 잔광 | 1.05 ~ 2.3 | 옅은 고리, 작은 불씨, 옅은 회색 연기 한 덩어리(1.2칸, 위로 0.3칸 떠오름) |
| 빈 깡통 | 남는 그림 | 바닥의 작은 짙은 원통(현장당 6개) |
| 관찰자 흰 막 | 0.34 ~ 1.0 | 관찰 중인 현장에서 터진 자리가 화면 안이면, 화면 전체에 흰 막: 최대 알파 `0.5 · (1 - 0.5·d/hw)`(d = 화면 가운데와의 거리, hw = 보이는 반폭), 0.06초 머문 뒤 0.6초에 빠진다. **실제 시간 2.5초에 한 번까지**(폭발 주황 막과 합쳐서 — 3.1절). `prefers-reduced-motion: reduce` 면 최대 0.15 |
| 무력화 표지 | 터짐 이후 | 그 섬광탄의 반경 안에서 `stunUntil` 이 걸린 용의자: 지금의 노란 점 넷 대신 흰 별 고리(돌며 옅어짐). 근처 4초 안에 섬광 기록이 없는 무력화(기습)는 노란 점 그대로 — 둘이 구별된다. 깡통이 아직 날아가는 동안은 표지를 늦춘다 |

남은 섬광탄 수(선택, R1 과 겹치면 R1 을 따른다): 기동대·특공대 대원 발밑 테 바깥에 작은 원통 점을 `u.flashbangs` 만큼(최대 4).

### 3.4 폭발

`r = c.r ?? 3`. 크기는 연료 1.5 < (2차 붕괴 2.6) < 폭발물 3.4 < 가스 용기 3.6 < 가스 폭발 3.8 로 달라진다. G4 가 합쳐지면 2차 붕괴는 'collapse' 기록(빛 없는 먼지·내려앉음, G4 가 그린다)이 되어 이 표에서 빠진다 — G5 는 'collapse' 를 그리지 않는다.

| 요소 | 시간 | 그림 |
|---|---|---|
| 섬광 | 0 ~ 0.1 | 가산 흰 원(반경 0.5r). 화면 안이면 화면 전체에 주황 막(알파 0.12 — 섬광탄 흰 막과 합쳐 실제 시간 2.5초에 한 번까지, 3.1절. `prefers-reduced-motion` 이면 0.04) |
| 충격파 | 0 ~ 0.35 | 고리 반경 0.3 → 1.15r칸, 굵기 `ts·0.18 → 0.02`, `rgba(255,240,215, 0.9→0)`. 0.05초 늦게 옅은 둘째 고리(알파 0.3) |
| 화염구 | 0 ~ 0.6 | 가산 puff 7개(`#fff3d0` → `#ffb347` → `#ff6a2a`), 0.8r 까지 커지며 어두워져 연기가 된다 |
| 연기 | 0.3 ~ 2.8 | 어두운 연기 조각(`fx.ts` 의 `puffDark`) 8개(알파 0.6→0), 1.3r 까지 퍼지며 화면 위쪽으로 0.6칸 |
| 파편 | 0 ~ 0.7 | 조각 12개(`fx.ts` 의 `chip`, 그림자 포함), 1.1r 까지 들렸다 떨어진다 |
| 그을음 | 남는 그림 | 바닥에 반경 0.7r 어두운 방사형(현장당 6개, 연출 120초). G4 가 터진 폭발물 자리에 상태로 그리는 자국(`drawBlastScar`)이 있으면 `src === 'bomb'` 은 그을음을 빼고 그것을 쓴다 |
| 흔들림 | 0 ~ 0.6 | 관찰 중인 현장의 그림 전체를 화소 진폭 `A = min(6, 2 + r)px · 가까움`(가까움 = `max(0, 1 - d/(2hw))`)으로 28Hz 진동, `exp(-t/0.18)` 감쇠. 겹친 폭발은 진폭을 더하되 G5 몫의 합을 6px 로 자른다. `book.shake(sid, ts)` 는 이것을 `ts` 로 나눈 **칸 단위**로 돌려준다 — G4 의 무너짐 흔들림(`fallShake`, 칸 단위, 자기 상한 0.16칸)과 단위를 맞추기 위해서다. 두 값은 칸 단위로 **더하기만** 하고(각자 상한, 합은 자르지 않는다) `ctx.translate((g5.x + g4.x)·ts, (g5.y + g4.y)·ts)` 한 번으로 민다(3.10절). `prefers-reduced-motion` 이면 없음(`typeof matchMedia === 'function'` 으로 감싼다 — 시험 환경에는 없다). 작은 창은 흔들지 않는다 |
| 빛 | 0 ~ 0.8 | 어둠 구멍 2r칸, 색 빛 `#ff9a3c` |

### 3.5 진입(브리칭)

**3-2-1 신호.** `s.entryOrdered && !s.breachDone` 이고 `0 < s.breachAt - t ≤ 3` 이면(`t = sim.t + alpha·dt`) 진입 지점마다 지금의 알약 대신:
- 반지름 0.9칸 고리(세 토막, 1초마다 한 토막씩 꺼진다)와 가운데 숫자 3·2·1(흰 글자, 짙은 테두리, 숫자가 바뀔 때 1.25배로 튕겼다 1 로). 색 `#9fd0ff`. 보이는 숫자는 상태(`ceil(breachAt - t)`)로 정하고, 튕김은 그 숫자의 `'tick'` 합성 항목(3.1절)의 나이로 그린다 — 삐 소리와 같은 시각이다.
- 3초보다 많이 남았으면 지금의 알약(`진입 지점 · N초`)을 그대로 둔다.
- `t ≥ breachAt` 인데 아직 진입 전이면(진입조가 덜 모였다 — 최대 8초, `executor.ts:754` 의 `sim.t >= s.breachAt + 8`) 주황(`#ffb454`) 고리가 빠르게 맥동한다(신호 대기).
- 숫자는 현장 화면 안의 큰 글자다. 글자 표식 금지 규칙(지도·목록의 종류 표식)과 부딪치지 않는다.

**진입 순간**(`breach` 기록, `c.sync === true`): 그 출입구에서 안쪽으로 파란 갈매기표 셋(`#9fd0ff`)이 0.6초 동안 밀려 들어가고 고리가 0.5초 퍼진다. 출입구 2.6칸 안의 진입조 대원 발밑 테가 0.4초 파랗게 빛난다.

**문짝**(`renderScene.doorOpenness` 에 `book.doorKick(sid, p.id)` 를 넘긴다. 지금은 실제 시간 기준 초당 4.5로 따라간다). 튕김 때문에 열림 값이 1 을 넘는다(1.12·1.18). `sprites.drawDoorLeaf` 는 회전(`side · open · 1.62`)은 그대로 두고, 바닥의 흔적 호(지금 `(π/2)·open`)만 `min(open, 1)` 로 자른다:

| how | 문짝 | 파편·먼지 | 시간 |
|---|---|---|---|
| `open` | 그림 없음(신호만) | — | — |
| `push` | 초당 9로 연다 | — | 0.15 |
| `kick` | 초당 22로 1.12까지 튕겨 열렸다가 1.0 으로 | 걸쇠 쪽 나무 조각 5개가 안쪽으로, 먼지 0.8칸 | 0.3 / 먼지 0.8 |
| `ram` | `kick` 과 같고 1.18까지 | 걸쇠 자리 흰 불똥 한 번, 조각 8개, 먼지 1.1칸. 첫 진입조 대원(`c.by`)이 0.4초 동안 공성추를 든 자세(`Item 'ram'` — R1·R2 도 같은 이름을 쓴다) | 0.35 / 1.0 |
| `irons` | `ram` 과 같다 | 금속색 불똥(`#ffe2a0`) 둘, 조각 6개 | 0.35 / 1.0 |
| `hydraulic` | 초당 6으로 천천히 1.0까지(벌려 연다) | 금속 불똥 하나, 먼지 없음 | 0.4 |
| `charge` | 예약: 반경 1.2의 작은 폭발(3.4절) + 문짝이 사라지고 경첩 토막만 남는다(FxBook 이 그 문을 기억). 시뮬레이션이 폭파의 효과를 적용하는 묶음이 생길 때까지 쓰지 않는다 | | |

방 진입(`sync === false`)은 갈매기표 없이 문짝과 먼지만.

**강제 개방 중**(잠긴 문 — 하위 작업 `a.task.sub && a.task.sub.kind === 'force'`, 또는 임무 `force` 이고 `a.ring > 0`): `agentPose` 가 하위 작업을 먼저 보게 고쳐 `work` 자세 + 도구(경찰 `ram`, 그 밖 지금의 `axe`)를 그린다. R2 가 합쳐져 `agentPose` 가 `a.task.method` 를 먼저 보게 되면 그 분기가 자세를 정하고, G5 의 하위 작업 분기는 방법이 없을 때만 돈다. 그동안 **연출 시계 0.6초마다** 한 번 "타격"(문 칸에 작은 먼지 + 불똥 하나 + 타격음, 4.3절) — FxBook 의 `'strike'` 합성 항목(3.1절)이다. `a.ring` 의 등분으로 박자를 세지 않는다: `a.ring = clamp(1 - p.hp / 12, 0.05, 1)`(`executor.ts:235`)이라 hp 17 인 승강기 문은 처음 몇 초 동안 0.05 에 머물러 타격이 하나도 나오지 않는다. 기록은 더하지 않는다. 끝나는 순간은 `unblock` 의 `breach` 기록(`forced: true`)이 문짝을 튕긴다.

해체 중(`defuse`, 선택 — G4 와 겹치면 G4 를 따른다): `agentPose` 에 `defuse` 가 없어 지금은 `side` 자세다. `kneel` 자세로.

### 3.6 대치

- **용의자가 겨누는 선.** 총을 든 용의자가 `hold`·`fight` 이고 무력화되지 않았으며 그려지는 중(AI 시점에서 `hidden` 이면 그리지 않는다)일 때. 겨누는 대원 = `fight` 이고 `h.targetRid` 의 대원이 지금 보이면 그 대원, 아니면 `officersSeeing`(2.4절에서 export, 11칸·시야선·시야각)의 가장 가까운 대원. 보이는 대원이 없으면 선이 없다(시야 부채꼴은 지금처럼).
  - 총구 → 대원 가슴, 점선(`ts·0.18` / `ts·0.14`), `rgba(FOE.aim, hold 0.25 · fight 0.45)`, 끝에 작은 붉은 점.
  - **발사 직전**(`fight` 이고 `h.cooldown ≤ 0.4`): 실선, 알파 0.8, 굵기 1.6배, 총구에 작은 고리 — "곧 쏜다".
- **대원이 겨누는 선.** `engage`·`perimeter` 임무로 서 있고(움직이지 않음) 13칸 안에 시야선으로 보이는 활동 중인 용의자가 있으며 `a.fx, a.fy` 가 그쪽 ±25° 안일 때 점선 `rgba(ALLY.aim, 0.25)`. 이름표가 `사격 보류…` 면 점점선 + 끝에 작은 막대(쏘지 않음). `a.cooldown ≤ 0.25` 이고 `교전` 이면 알파 0.5.
- 한 현장에 선은 12개까지(가까운 짝부터). R2 의 저격(`a.task.method === 'sniper'`)은 R2 가 조준선을 따로 그리므로(관찰자 시점만) 그 대원의 선은 그리지 않는다.
- **엄폐 자세.** `a.inCover` 면 `drawPerson` 의 `crouch`(몸 0.9배, 다리 접음, 총은 겨눈 채) + 위협 쪽에 반원형 회색 띠. `엄` 글자 배지(`renderScene.ts:403`)는 작은 **반쪽 벽(벽돌 두 줄) 기호**로 바꾼다. 방패 기호는 쓰지 않는다 — R1 의 방패수(`Item 'shield'`)와 `marks.ts` 의 경찰 방패 기호와 헷갈린다. G4 는 이 배지를 정하지 않았다(G4 가 나중에 정하면 G4 를 따른다).
- **협상.** 대원의 임무가 `negotiate` 이고 `a.task.phase >= 1`(자리에 도착해 협상을 시작한 첫 틱에 1 이 된다, `executor.ts:710`)이며 대상 용의자(`a.task.hostile`)가 `fight` 가 아니면. `a.ring > 0` 으로 보지 않는다: `a.ring = clamp(1 - (morale - 0.2)/0.6, 0, 1)` 이라 처음 사기가 0.8 이상인 용의자(공격성 0.56 이상 — `kit.ts:82` 의 `0.55 + aggression·0.45`)와는 협상하는 동안에도 한참 0 이다:
  - 확성기에서 용의자 쪽으로 호 세 개가 1.1초마다 밀려 나간다(`#e8f0f7`, 알파 0.5→0).
  - 말풍선(글자 없음): 대원 쪽 둥근 흰 풍선에 점 셋이 차례로 깜박인다(2.2초 말함, 1.3초 쉼). 쉬는 사이 용의자 쪽 풍선: 사기가 떨어지는 중(`h.morale < 0.42`)이면 물결 테, 그 밖에는 짧은 점 둘. 주기는 연출 시계와 대원 rid 로 정한다(상태를 바꾸지 않고, 임무가 진행 중이라는 사실만 그린다). 파동과 용의자 풍선이 뜨는 순간은 FxBook 의 `'hail'`·`'reply'` 합성 항목(3.1절)이라 선택 소리(4.6절)와 시각이 같다.
  - 용의자가 `fight` 로 협상이 멈추면(`엄폐 (협상 중단)`) 파동과 대원 풍선이 없고, 그동안 용의자 쪽에 뾰족한 붉은 테와 번개 기호의 풍선 하나만 띄운다(협상이 끊겼다는 표시 — 임무 `negotiate`·`phase >= 1`·용의자 `fight` 라는 상태로 그린다).
- **인질 끌기**(`h.dragging`): 끌려가는 방향으로 작은 화살 셋을 용의자와 인질 사이에 더한다. 선 자체의 모양(붙잡힘·구출 기회·풀려남)은 G4 §7.4 가 정한다 — G5 는 선을 바꾸지 않는다.

### 3.7 테이저 (R1 이 기록을 넣는다)

- 기록: `recTaser`(2.3절).
- 그림: 0~0.06초 전선 두 가닥이 뻗어 나가고, 1.2초 동안 두 가닥(`#dfe7ee`, 1px, 가운데가 0.15칸 처진 곡선)이 남는다. 맞았으면 맞은 사람 둘레에 푸른 흰 불꽃 4개가 30Hz 로 깜박이고(`#b8e4ff`/`#ffffff`) 그 사람 그림이 ±0.02칸 떨린다. 빗나가면 전선이 목표 앞 바닥에 늘어진다(불꽃 없음).
- 이번 묶음은 자료형·그림·소리까지만 만들고 합성 기록으로 시험한다. 테이저는 R1(개인 장비) 몫이다: R1 이 효과를 적용하는 줄 바로 다음에 `recTaser(…)` 한 줄을 넣는다(R1 설계서 6.3절은 지금 `pushFx(… 'shot' …, 노란색)` 이라고 적고 있다 — 11절).
- 혹시 꼬리표 없는 노란 `shot` 이 들어와도(옛 방식) 예외 없이 보통 예광선으로 그린다(`c` 가 없는 `shot` 은 `f.color` 로 그린다).
- 비살상탄(`wpn === 'beanbag'`, R2 가 `recShot` 으로 남긴다): 총구 섬광 대신 작은 연기 한 점, 탄은 주황 주머니(지름 0.12칸)가 25칸/초로 날아간다(눈으로 따라갈 수 있게), 맞으면 둔탁한 먼지 + 피격 불꽃. 저격(`'sniper'`): 소총보다 긴 예광선(꼬리 2.4칸)과 큰 총구 섬광, 소리는 4.3절.

### 3.8 근접 공격 · 검거

- **근접**(`melee`): 공격자가 0.12초 동안 목표 쪽으로 0.25칸 내딛었다가 돌아오고, 앞쪽에 흰 초승달 휘두름(0.15초 — 칼은 가늘고 길게, 맨손은 짧고 굵게) + 맞은 쪽 피격 불꽃.
- **검거**(`cuff`): 용의자 머리 위에 수갑 기호(두 고리를 잇는 그림 — `view/marks.ts` 와 같은 24×24 경로 문자열 하나)가 0.15초에 커져 1.2초 머물고 0.5초에 사라진다 + 흰 딸깍 고리 하나. `arrest === 'tackle'` 이면 대원에서 용의자까지 짧은 돌진 선과 먼지. 검거된 용의자(`state === 'arrested'`)는 손 자리에 작은 고리 두 개(지금의 회색 막대 대신, 상태로 그린다). **`'back'` 자세를 바꾸지 않는다**: 같은 자세를 인질도 쓴다(`renderScene.ts:324`, `c.hostage → 'back'`). 막대를 고리로 바꾸면 인질에게 수갑이 채워진다. 그래서 `PersonPose` 에 `cuffed?: boolean` 을 더하고, `arms === 'back' && cuffed` 일 때만 막대 대신 고리 둘을 그린다. 용의자 그리기(`renderScene.ts:358`)만 `cuffed: hst.state === 'arrested'` 를 넘긴다. 인질의 `'back'`(묶인 손 — 회색 막대)은 그대로다.
- **제압·사망**(`down`)의 모습은 H1(부상과 사망)이 정한다. G5 는 피만 뺀다(3.9).

### 3.9 피 없이

H1(부상과 사망) §8.2 의 원칙과 같다: 피 웅덩이·튀는 붉은 조각·신체 훼손을 그리지 않는다. G5 가 H1 보다 먼저 들어가므로 H1 이 적은 두 가지를 지금 한다(H1 시험 10번 "`renderScene.ts` 에 `blood:` 가 없고 `sprites.ts` 에 `rgba(110,18,22` 가 없다"가 G5 뒤에 이미 참이 된다).

- `drawLying` 의 `blood` 옵션(`LyingOpts.blood`)과 붉은 타원 두 개를 **지운다**. `renderScene.ts` 의 세 호출(구조 대상·용의자·대원)에서 `blood:` 인자를 뺀다. 다친 정도는 이미 있는 중증도 딱지·체력 막대·붕대로 읽힌다(H1 이 들어오면 H1 의 자세·딱지로 더 분명해진다).
- `hit` 의 붉은 사각 조각·붉은 고리 → 짧게 퍼지는 흰 고리 + 회색 먼지 몇 점 + 3.2절의 흰·노란 불꽃(맞았다는 것만 전한다). 교통사고 등 다른 `hit` 도 같은 그림이 된다.
- 맞는 순간은 섬광·궤적·충격(움찔)으로만 보여 준다.

### 3.10 층 순서

`renderScene.ts` 의 그리는 순서(파일 머리 주석)에 끼워 넣는 자리:

1. `ctx.translate(L.ox, L.oy)` 바로 뒤에 흔들림 `translate` 한 번: `book.shake(s.id, ts)`(칸 단위)와 G4 의 `fallShake`(칸 단위, 있으면)를 더해 `ts` 를 곱한다 — G4 §4.6 의 순서에서 첫 자리. 각자 자기 상한만 지키고 합은 자르지 않는다(3.4절).
2. 바닥 흔적(`drawScorch`·젖은 바닥) 다음: **남는 그림**(탄흔·그을음·빈 깡통).
3. 시야 부채꼴 다음, 소품 앞: **겨누는 선, 확성기 파동, 인질 끌기 화살**.
4. 소품의 문짝: `doorOpenness` 에 진입 연출.
5. 사람: 반동·움찔·던지기·웅크림·공성추 자세(그리는 함수의 인자만 더한다).
6. 어둠 층의 구멍: 지금 `s.fx` 를 훑는 곳(485-489)을 FxBook 으로 — 총구 2.6칸, 섬광 6.5칸, 폭발 2r.
7. 색 빛(514-517): 총구 빛, 폭발 빛.
8. 효과 단계(지금 `// ── 효과 ──`, 598): 섬광탄 방 채움 → 폭발 연기·화염구·충격파·파편 → 예광선·남은 줄 → 탄착 → 피격 불꽃 → 섬광탄 깡통·터짐 → 근접 휘두름 → 테이저 → 진입 갈매기표·문 조각·먼지 → 유리·가구 파편(있는 것) → `spray`·`radio`·`text`(있는 것).
9. 이름표 단계: 3-2-1 신호(553-560 을 대신), 말풍선, 수갑 기호.
10. 비네트 다음(화면 좌표): 관찰자 흰 막, 폭발 주황 막.

### 3.11 프레임 예산

- 교전 그림 전체(위 2·3·6~10 의 G5 몫)가 한 프레임 **2ms 이하**(1440×900, deviceScaleFactor 1, 8.2절에서 고른 대형 인질극 교전 장면, 1배속). `book.drawMs` 로 잰다.
- 상단 FPS 가 같은 장면에서 G5 전보다 10% 넘게 떨어지지 않는다(1배속과 15배속). 15배속은 **자동 감속을 끄고**(`S` 키, `settings.autoSlow = false`) 잰다 — 켜 두면 첫 발부터 교전 내내 1배속이라 15배속을 잰 것이 아니게 된다.
- 현장마다 동시에 살아 있는 연출의 상한(넘으면 오래된 것부터 버린다): 예광선 24, 탄착 40, 피격 16, 섬광탄 3, 폭발 3, 진입 6, 근접 8, 수갑 6, 겨누는 선 12, 남는 그림(탄흔 80, 그을음 6, 깡통 6).
- 그리는 법: `shadowBlur` 금지. 그라데이션은 섬광탄 방 채움과 폭발에만. 그 밖의 빛·연기는 `fx.ts` 의 미리 그린 조각(`lightSprite`, puff)을 `drawImage`. 큰 반경은 화소로 상한(폭발 화염구 지름 ≤ 화면 높이의 60%) — 가장 크게 확대했을 때(칸당 96화소) 화면을 덮는 그라데이션을 만들지 않는다.

### 3.12 작은 창 · AI 시점

- 작은 창(`mini`): 예광선(속 한 겹, 1px), 섬광(흰 원), 폭발(주황 원 + 고리), 진입(파란 고리)만. 탄착·남는 그림·겨누는 선·말풍선·흔들림·흰 막은 없다.
- AI 시점(`truth = false`): 사격선은 그린다(총성은 숨길 수 없다). 지금 코드도 AI 시점에서 모든 사격선을 그린다(`renderScene.ts` 의 효과 반복문에 시점 거르기가 없다) — **지금 동작을 유지**한다. 숨은 용의자의 몸은 지금처럼 그리지 않고, 그 용의자의 총구 섬광은 기록의 출발점에 그린다. 정보 격리 규칙(`CLAUDE.md` 4)은 AI 의 판단에 대한 것이고, 화면의 시점 표시는 표현 계층의 일이라 부딪치지 않는다.
- 지도 핀과 먼 소리는 AI 시점에서 `s.arrivedAt >= 0 && f.t >= s.arrivedAt` 인 기록만 쓴다(부대 도착 전 총격범의 범행은 관찰자 시점에서만).

---

## 4. 소리

### 4.1 소리 길

지금은 모든 소리가 `master` 하나를 거쳐 바로 나간다(압축기 없음). 바꾼다:

```
voice(GainNode) → [StereoPannerNode] → [lowpass: 먼 소리] → combatBus(0.9) ─┐
                                        → roomSend(실내 잔향) ─────────────┤
기존 소리(벨·무전·경보·사이렌) ────────────────────────────────────────────┴→ master(음량) → DynamicsCompressor → destination
```

- 압축기: threshold -14dB, knee 12, ratio 6, attack 0.003, release 0.25(여러 소리가 겹쳐도 깨지지 않게).
- 실내 잔향: `DelayNode` 0.06초 + 되먹임 0.28 + lowpass 1800Hz, 보내기 0.25. 쏜 칸이 실내(`grid.isIndoor`)일 때만 보낸다.
- `createStereoPanner` 가 없으면(오래된 브라우저) 정위 없이 잇는다.
- 합성 조리법은 `src/view/audioCombat.ts` 의 `CombatVoice`(만들 때 `ctx`·잡음 버퍼·`combatBus`·`roomSend` 를 받는다)에 둔다. `audio.ts` 는 `unlock()` 에서 길을 만들고 `update()` 에서 넘겨줄 뿐이다.

### 4.2 원근

`audio.update(sim, { paused, speed, focus, inScene, fresh, place, clock, rate })` — `speed` 는 실제 배속 `effSpeed`(3.1절, `settings.speed` 가 아니다), `fresh`·`clock`·`rate` 는 `book` 의 값, `place(sid, x, y) => { gain, pan, far } | null` 은 Viewport 가 만든다(화면 크기·카메라를 아는 곳).

| 상황 | gain | pan | far(먼 소리 lowpass) |
|---|---|---|---|
| 현장 화면, 관찰 중인 현장 | 보이는 범위(반폭 hw = 현장 폭/2/zoom) 안이면 1, 밖이면 `max(0.35, 1/(1+((d-hw)/hw)²))` | `clamp((x - camX)/hw, -1, 1) · 0.7` | 없음 |
| 현장 화면, 작은 창에 떠 있는 다른 현장 | 0.14 | +0.6(작은 창은 오른쪽 아래) | 1200Hz |
| 현장 화면, 화면에 없는 다른 현장 | 0.05 | 0 | 900Hz |
| 지도 화면 | 사건 자리가 화면 안이면 `0.22 · √(zoom/6.5)`, 밖이면 화면 폭의 1.5배까지 줄어들다 0 | 화면 x 로 `· 0.7` | 900Hz |

지도 화면의 먼 소리는 사격·폭발·섬광탄·진입만(탄착·피격·유리는 내지 않는다), 초당 4개까지. AI 시점의 거르기는 3.12절과 같다.

**섬광탄 이명**: 관찰 중인 현장이고 터진 자리가 보이는 범위 안이면, 터짐 소리 뒤에 sine 4100Hz(0.025 → 0, 2.2초) + 주 버스 덕킹(-8dB 로 0.2초 만에 내려가 1.2초에 회복) + `combatBus` lowpass 1200Hz → 1.5초 동안 8000Hz 로 회복. 4초에 한 번까지. 8배속 이상이면 이명·덕킹 없음.

### 4.3 음색 표

모두 지금의 `tone`(발진기)·`burst`(잡음 + 필터)와 같은 방식이다. 세기는 voice 의 gain 에 곱하기 전의 값. 음높이의 작은 흔들림은 기록 해시로 정한다(같은 장면을 다시 보면 같은 소리 — `Math.random` 은 화면 쪽이라 허용되지만 확인하기 쉽게).

| 소리 | 합성 | 세기 |
|---|---|---|
| 권총(대원) | ① 잡음 bandpass 2400Hz Q0.9, 0.05초 ② triangle 210→80Hz 0.06초 ③ 꼬리: 잡음 lowpass 900Hz 0.16초 | 0.20 / 0.10 / 0.05 |
| 소총(대원) | ① 파열: 잡음 highpass 3200Hz 0.035초 ② 잡음 lowpass 1300Hz 0.12초 ③ sine 95→42Hz 0.12초 ④ 꼬리: 잡음 lowpass 650Hz 0.32초 | 0.22 / 0.26 / 0.16 / 0.06 |
| 용의자 총 | ① 잡음 lowpass 1100Hz 0.10초 ② square 140→55Hz 0.08초 ③ 잡음 bandpass 600Hz Q1.5 0.20초(먹먹한 울림). 음높이 ×0.94~1.06 | 0.24 / 0.11 / 0.05 |
| 첫 발(그 현장에서 10초 만의 사격) | 위의 무기 소리 +3dB, 꼬리 1.5배 | |
| 벽 탄착 | 잡음 bandpass 4200Hz Q2 0.03초 + (세 발에 한 번, 해시) sine 2600→1900Hz 0.09초(도탄음) | 0.05 / 0.025 |
| 가구 탄착 | triangle 260→130Hz 0.05초 + 잡음 bandpass 900Hz 0.05초 | 0.08 / 0.06 |
| 피격 | triangle 110→70Hz 0.10초(지금 것) + 잡음 lowpass 280Hz 0.05초 | 0.10 / 0.06 |
| 방호에 맞음 | sine 1700Hz 0.05초 + sine 2550Hz 0.04초(금속 틱) | 0.04 |
| 섬광탄 — 굴림 | triangle 1800Hz 0.02초 두 번(깡통이 닿는 0.28초와 0.31초) | 0.04 |
| 섬광탄 — 터짐 | 잡음(lowpass 7000Hz) 0.22초 + sine 130→38Hz 0.32초 + 잡음 highpass 2500Hz 0.5초 | 0.42 / 0.30 / 0.12 |
| 폭발(s = 0.6 + 0.4·min(1, r/3.8)) | sine 55→26Hz 0.9초 + 잡음 lowpass 420Hz 1.3초 + 잡음 highpass 3000Hz 0.04초 ×4(0~0.5초 사이) + 잡음 lowpass 160Hz 2.0초(잔해) + sine 120→60Hz 0.4초(작은 스피커용 배음) | 0.45s / 0.36s / 0.07 / 0.08 / 0.12s |
| 진입 — 발차기 | triangle 95→48Hz 0.11초 + 잡음 bandpass 1300Hz Q3 0.07초(나무 쪼개짐) + 0.12초 뒤 잡음 lowpass 220Hz 0.16초(문이 벽에 부딪힘) | 0.26 / 0.15 / 0.12 |
| 진입 — 공성추 | sine 72→38Hz 0.16초 + square 420Hz·660Hz 0.12초(쇠) + 나무 쪼개짐 + 문 부딪힘 | 0.32 / 0.04 / 0.15 / 0.12 |
| 진입 — 할리건(`irons`) | 공성추에서 쇠 소리를 triangle 900→620Hz 0.05초로 | |
| 진입 — 유압(`hydraulic`) | sawtooth 90Hz 0.35초(lowpass 400Hz, 펌프 소리) + 끝에 쇠 삐걱 triangle 700→500Hz 0.12초 | 0.05 / 0.05 |
| 저격(`sniper`) | 소총 소리 +2dB, 꼬리 lowpass 500Hz 0.6초(멀리 울림) | |
| 비살상탄(`beanbag`) | 잡음 lowpass 600Hz 0.08초 + sine 140→70Hz 0.08초(퉁) | 0.16 / 0.10 |
| 강제 개방 타격(`a.ring` 0.2마다) | triangle 900→620Hz 0.05초 + 잡음 bandpass 2200Hz 0.04초 + triangle 120→70Hz 0.06초 | 0.06 / 0.05 / 0.08 |
| 진입 신호 | 3·2·1: sine 880Hz 0.07초. 진입: sine 1320Hz 0.12초 + 지금의 무전 딸깍 | 0.05 / 0.06 |
| 테이저 | 발사: 잡음 bandpass 3000Hz 0.03초. 지직: 잡음 highpass 4500Hz 0.04초 조각 12번(1.0초) + square 52Hz 를 잡음으로 진폭 변조 | 0.08 / 0.07 |
| 수갑 | sine 2600Hz 0.025초, 0.09초 뒤 sine 3200Hz 0.025초 | 0.05 |
| 근접 | 휘두름: 잡음 bandpass 1800→600Hz 0.12초 + 맞으면 피격 | 0.06 |
| 유리·가구 | 지금 것 그대로 | |

### 4.4 배속 · 상한 · 중복 억제

`fresh` 를 (현장, 소리 종류, 쏜 쪽)으로 묶어 처리한다. 귀로 확인할 수 없으므로 **헤드리스에서 셀 수 있는 기준**으로 정한다. 아래 표의 "배속"은 실제 배속 `effSpeed` 다 — 자동 감속 중이면 15배속 설정이어도 1배속 규칙을 따른다.

**소리를 그림과 같은 시각에.** 그림은 늦게 시작하는 단계가 있다(진입 뒤 섬광탄 +0.12초·사격 +0.2초, 깡통이 날아가 터지기까지 0.34초, 탄착은 예광선 머리가 닿는 순간). `fresh` 를 받은 순간에 소리를 내면 진입 때 "쾅"이 그림보다 최대 0.46초 먼저 난다. 그래서 소리마다 시작 시각을 예약한다:

```
when = max(0, e.born + e.delay + stage − clock) / rate + lag        // 초 뒤 → ctx.currentTime + when
```

- `stage`(그 소리가 맞춰야 할 그림 단계의 연출 시각): 사격의 총성 0, 탄착(벽·문·가구) = 예광선 머리 도착 시각(3.2절의 날아가는 시간), 피격 0(딸린 `hit` 은 이미 `delay` 에 도착 시각이 들어 있다), 섬광탄 굴림 0.28·0.31 · 터짐 0.34(던짐 단계를 건너뛰는 옛 호출이면 터짐 0), 폭발·진입·근접·수갑·테이저 0, 합성 `'tick'`·`'strike'`·`'hail'`·`'reply'` 0.
- `lag`: 한 프레임에 여러 틱이 돌아 그 프레임의 `fresh` 가운데 가장 이른 `born + delay` 가 `clock` 보다 앞서면, 그 차이(최대 0.25 연출 초)를 `rate` 로 나눈 만큼 그 프레임의 소리를 **모두** 늦춘다 — 순서와 간격을 지키고, 그림보다 최대 0.25초 늦을 뿐이다(지금 1배속 행의 "늦춰 낸다"를 이것으로 바꾼다).
- `rate` 가 0(일시정지)이면 새 소리가 없다. 이미 예약했지만 아직 시작하지 않은 소리(많아야 0.5초 앞)는 그대로 둔다(10절).

| 배속(`effSpeed`) | 사격 | 탄착·피격 | 유리·가구 | 섬광·폭발·진입 | 수갑·테이저 |
|---|---|---|---|---|---|
| 1 | 한 발씩(위의 시각 식) | 묶음마다 1 | 지금의 간격 | 늘 낸다 | 낸다 |
| 3 | 묶음마다 최대 2(처음과 끝, 70ms 간격) | 묶음마다 1 | 지금의 간격 | 늘 낸다 | 낸다 |
| 8·15 | 묶음마다 "연사" 하나: `min(n, 3)` 번을 55ms 간격으로, 세기 ×0.8 | 없음 | 0.3초에 하나 | 늘 낸다 | 수갑 없음 |

- 대원 쪽과 용의자 쪽은 따로 묶는다(두 음색이 함께 들려야 "주고받는" 것이 들린다).
- **세는 단위.** 소리 하나(cue) = 들리는 소리 한 번이다: 총성 한 발(연사 안의 한 발도 하나), 탄착 하나, 피격 하나. 발진기·잡음 노드 수로 세지 않는다(소총 한 발은 노드 넷이지만 cue 하나).
- **초당 상한**: 사격류(사격·탄착·피격·근접·테이저) cue 는 토큰 통(**용량 4**, 초당 10개 채움)을 지나야 한다. 어떤 1초 창에도 많아야 4 + 10 = 14개다. 비면 버리고 `stats.dropped` 를 센다. 섬광·폭발·진입·수갑·합성 항목은 토큰을 쓰지 않는다.
- **동시 발음 상한**: 예약한 cue 들의 끝 시각을 기억해 지금 울리는(시작했고 끝나지 않은) cue 가 18개 이상이면 우선순위 낮은 것부터 버린다. 우선순위: 폭발 > 섬광 > 진입 > 첫 발 > 사격 > 테이저 > 수갑 > 탄착 > 피격 > 유리·가구 > 합성 항목.
- 종류별 최소 간격(지금의 `ok()`): 섬광 0.3, 폭발 0.25, 진입 0.2 는 유지. 사격은 위의 묶음과 토큰 통이 대신한다.
- `stats`(확인용): `{ perSec: number; maxPerSec: number; voices: number; dropped: number; made: number }`.
  - `perSec`: 지난 1초(실제 시간) 동안 시작한 **사격류** cue 수. `maxPerSec`: 그 최댓값. `voices`: 지금 울리는 **교전 cue 전부**(사격류·섬광·폭발·진입·수갑·합성). `made`: 지금까지 만든 교전 cue 의 누적 수(줄지 않는다).
  - **음소거로 일찍 돌아가기 전에** 고친다(그래야 `perSec` 가 직전 값으로 남지 않고 1초 뒤 0 이 된다).
  - 기준: 15배속(**자동 감속 끔**) 교전에서 `maxPerSec ≤ 14`, `voices ≤ 18`.
- 이벤트(기록) 소리: 교전 소리는 **효과 기록에서만** 낸다. `action`(교전 발생·진입·섬광탄 투척)과 대원의 `resolve`(검거)에는 이벤트 소리를 더하지 않는다(같은 틱의 효과 기록이 소리를 낸다 — 두 번 울리지 않게). 문제 경보음(`problem`, imp ≥ 2)은 지금처럼 둔다.
- `audio.ts` 는 G4 가 "맡는 파일"로 적었고, G4 는 효과 반복문에 `'collapse'`(무너짐) 소리 한 분기를 더한다(G4 §4.3). X6 도 `'horn'`(철수 신호) 한 분기를 더한다(X6 §7.4). G5 가 그 반복문을 `fresh` 처리로 바꾸므로, `'collapse'`·`'horn'` 을 비롯해 G5 가 음색을 정하지 않은 종류(`spray`, R1 `'drop'`, 앞으로 생길 종류)는 `fresh` 를 훑는 자리에서 **지금(또는 G4·X6)의 소리 분기로 그대로 넘긴다**(관찰 중인 현장만, 지금처럼 `ok()` 간격). 먼저 합친 쪽이 이 자리를 만들고 나중 쪽이 분기 하나를 더한다.

### 4.5 음소거 · 음량 · 일시정지 · 되감기

- 새 설정을 만들지 않는다. 모든 교전 소리가 `master` 를 지나므로 지금의 음량(`settings.volume`)과 음소거(`M`, `settings.sound`)가 그대로 듣는다.
- 음소거면 지금처럼 `update` 가 일찍 돌아가 **소리 마디를 만들지 않는다**(긴장음도 멈춘다). 일찍 돌아가기 전에 `stats` 는 고친다(4.4절 — `made` 는 늘지 않고 `perSec` 는 1초 안에 0 이 된다).
- 일시정지면 새 교전 소리가 없다(연출 시계가 멈추고 새 기록도 없다).
- 되감기·새 교대: FxBook 이 비워지고 첫 받아들이기는 `fresh` 에 넣지 않는다 → 지나간 총성이 한꺼번에 울리지 않는다.
- 주요 장면 이어 보기는 1배속이라 1배속 규칙을 따른다.
- 소리를 여는 첫 입력: 지금 `App.tsx` 는 아무 키·포인터 입력에서 `unlock()` 한다. 확인 스크립트는 상태를 바꾸지 않는 `Shift` 키로 연다(`1`~`4`·`Space`·`M`·`S`·`Z`·`T`·`A`·`C`·화살표는 상태를 바꾼다).

### 4.6 긴장음 · 확성기 (선택)

- 긴장음: 관찰 중인 현장이 `armed` 이고 총을 든 용의자가 `hold`·`fight`(무력화 아님)이며 배속 ≤ 3, 일시정지 아님. sine 55Hz + 55.4Hz(맥놀이) + 잡음 lowpass 200Hz, 합쳐 0.012, 1.5초에 들어오고 나간다. 조건이 풀리면(검거·투항·제압) 2초에 빠진다.
- 확성기: 협상 파동(3.6절)이 나갈 때마다 sawtooth 160Hz → bandpass 1100Hz Q4, 7Hz 진폭 변조 0.5초(0.03). 용의자 풍선이 뜰 때 sawtooth 120Hz → bandpass 900Hz 0.4초(0.025). 배속 ≤ 3 만.
- 둘 다 거슬리면 끄고 보고에 적는다.

---

## 5. 연출 — 결정적 순간

### 5.1 자동 감속

지금은 `runner.frame` 이 그 프레임의 틱을 다 돌린 뒤 Viewport 가 감속을 검사한다. 그래서 첫 효과는 빠른 배속으로 지나간다(`runner.ts:115`, `Viewport.tsx:59-68`).

- `Runner` 에 `stepGuard: ((sim: Sim) => boolean) | null` 을 더한다. `frame` 의 while 안 `sim.step()` 다음에 `if (this.stepGuard && this.stepGuard(sim)) { this.acc = 0; break; }`. 한 프레임에 도는 틱 수만 바뀌므로 결과는 같다.
- Viewport 가 단다. 틱마다 불리므로 가볍게 쓴다:
  ```ts
  runner.stepGuard = (sim) => {
    if (!runner.settings.autoSlow || runner.settings.speed <= 1) return false;
    const s = director.mode === 'scene' && director.focus >= 0 ? sim.scenes[director.focus] : null;
    if (!s) return false;
    let ms = 0;
    for (let i = s.fx.length - 1; i >= 0 && s.fx[i].t === sim.t; i--) if (DECISIVE.has(s.fx[i].kind)) ms = Math.max(ms, dramaMs(s, s.fx[i]));   // 이 틱에 생긴 기록만
    if (s.entryOrdered && !s.breachDone && s.breachAt - sim.t > 0 && s.breachAt - sim.t <= 3.4 && preSlowFor.get(s) !== s.breachAt) { preSlowFor.set(s, s.breachAt); ms = Math.max(ms, 5000); }   // 진입 예고
    if (!ms) return false;
    const was = runner.slowed;
    runner.drama(ms); director.nudge();
    return !was;          // 감속이 "새로" 걸린 틱에만 남은 틱을 버린다
  };
  ```
  - **이미 1배속이면 `true` 를 돌려주지 않는다.** 그러지 않으면 1배속 교전 내내 결정적 기록마다 `acc = 0` 이 되어 시뮬레이션이 실제 시간보다 느려진다(사격마다 틱 하나 남짓을 잃는다). 감속 시간은 `drama` 가 늘려 준다.
  - **진입 예고도 여기서 틱마다** 본다. 프레임마다 보면 15배속에서 한 프레임이 1.5초까지 나아가므로 3-2-1 의 "3"을 지나쳐 버릴 수 있다. 같은 `breachAt` 에 한 번(`preSlowFor: WeakMap<Scene, number>`).
  - `dramaMs`: 첫 발(그 현장에서 10초 만의 `shot`) 4000, `flash`·`breach` 3200, `boom` 3600, 그 밖의 `shot` 3200(지금처럼 사격마다 걸어 교전 내내 1배속을 유지한다 — 사용자가 "확실히 알 수 있게"를 원하므로). G4 의 `'collapse'`, X6 의 `'horn'` 은 `DECISIVE` 에 한 단어씩 더하고 길이는 3200.
  - 결정적 종류는 `fxBook.ts` 의 상수 하나 `DECISIVE`(3.1절)로 둔다 — G4 의 `'collapse'`(G4 §4.3 이 `Viewport.tsx:65` 와 `camera.ts:159` 에 넣으라고 적은 것)는 이 집합과 5.2절의 목록에 한 단어씩 더하는 것으로 바뀐다.
- 지금 Viewport 의 `fxScene`·`fxT` 훑기(효과로 감속하는 부분, `Viewport.tsx:61-67`)는 지운다. 중대한 기록(imp ≥ 3)으로 감속하는 부분(68줄)은 그대로 둔다.
- 감속은 `autoSlow` 가 켜져 있을 때만이다(기본 켜짐, `S` 키로 끄고 `localStorage` 에 남는다). 15배속 그대로의 그림·소리를 확인할 때는 끄고 잰다(8.3·8.4절).
- 지도 화면에서는 감속하지 않는다(지금과 같다).

### 5.2 현장 자동 확대 (`camera.frameAction`)

- 대상 kind 에 `breach`(2.5)·`melee`(1.5)·`taser`(2.0)·`cuff`(1.0)를 더한다. `c.ox, c.oy` 가 있으면 무게 1.5 로 더한다(섬광탄의 던진 사람, 진입조 쪽). `c.ix, c.iy` 가 있으면 끝점(`x2, y2`) 대신 그것.
- 진입 예고: `s.entryOrdered && !s.breachDone && s.breachAt - sim.t ≤ 4` 면 진입 출입구(`entryExit`, `entryExit2`)에 무게 2.5.
- `nudge()`: `sceneRetargetAt = clock` — 결정적 기록을 찾았을 때 0.9초를 기다리지 않고 바로 다시 잡는다(`sceneManual` 이면 하지 않는다). `stepGuard`(5.1절)가 부르고, 자동 감속이 꺼져 있을 때는 Viewport 가 `book.fresh` 에서 관찰 현장의 `DECISIVE` 종류를 보면 부른다.
- G4 의 `'collapse'`(2.5), X6 의 `'horn'`(2)은 이 목록에 한 단어씩 더한다.

### 5.3 주요 장면 이어 보기 (`App.reelMoments`)

같은 사건 25초 안의 장면을 하나로 묶을 때 지금은 **첫 기록**을 남긴다. 그런데 `진입 결정`(command, 진입 9~15초 전)이 먼저 잡히면 9.5초 재생 안에 진입이 나오지 않는다. 묶음 안에서 순위가 높은 것을 남긴다: kind `action`·`problem`·`hazard` > `resolve` > `command`(같으면 이른 것). 나머지 규칙(최대 8개, 4초 전부터 1배속 9.5초)은 그대로.

묶음의 25초 창은 **묶음의 첫 기록에 고정**한다. 대표를 순위 높은 기록으로 바꿔도 `lastT` 는 옮기지 않는다(옮기면 창이 계속 밀려 묶음 크기가 달라진다):

```ts
const rank = (k: string): number => (k === 'action' || k === 'problem' || k === 'hazard' ? 2 : k === 'resolve' ? 1 : 0);
// … 반복문 안, 지금의 묶음 검사 자리:
if (e.incidentId === lastId && e.t - lastT < 25) {
  if (rank(e.kind) > curRank) { out[out.length - 1] = { t: e.t, id: e.incidentId, text: e.text }; curRank = rank(e.kind); }   // lastT 는 그대로
  continue;
}
out.push({ t: e.t, id: e.incidentId, text: e.text }); lastT = e.t; lastId = e.incidentId; curRank = rank(e.kind);
```

`Moment` 의 모양은 바꾸지 않는다(대표의 순위는 지역 변수 `curRank` 로 기억한다).

### 5.4 지도 사건 핀 (`renderCity` → `view/city/combatPin.ts`)

`drawCity` 의 옵션에 `book?: FxBook` 을 더하고, 핀 반복문(254-312)에 `drawCombatPin(ctx, book, sim, I, x, y, r, zs, o)` 한 줄을 넣는다(현장 대응 중인 사건만, AI 시점 거르기는 3.12절).

- 사격마다 핀 테두리 위(각도 = 기록 해시)에 네 꼭지 별(지름 `6·zs`, 0.18초) — 대원 흰·노란, 용의자 주황.
- 폭발: 주황 충격 고리가 핀 반경에서 `r + 40·zs` 까지 0.8초 + 핀 ±2px 흔들림.
- 섬광탄: 흰 고리 0.4초. 진입: 파란 고리 0.5초.
- **교전 중**(최근 8 연출 초 안에 사격): 핀 바깥에 붉은·흰 두 색이 0.5초 주기로 번갈아 도는 점선 테.
- 축소 창(`mini`): 사격 순간 핀 위에 흰 점 한 번.
- **글자 없음**(지도의 글자 표식 금지). 범례 `ui/MapLegend.tsx` 에 "교전 중"(점선 테를 두른 핀 그림) 한 항목을 더한다.

### 5.5 자동 카메라 (선택)

자동 카메라의 사건 점수(`camera.ts` 57-64, 기록 무게)에 "최근 3초 안 사격이 있는 사건 +30"을 더한다. 교전 현장으로 너무 자주 끌려가면 빼고 보고에 적는다. [확인 필요]

---

## 6. 고칠 파일과 함수

| 파일 | 함수·자리 | 무엇을 | 왜 |
|---|---|---|---|
| `sim/types.ts` | `Fx` 줄, 그 위 | `Fx` 줄은 kind 합집합 끝에 4개만 덧붙임. 그 위에 `FxWeapon`·`FxResult`·`FxStop`·`BreachHow`·`ArrestHow`·`FxInfo` 와 인터페이스 합치기 `export interface Fx { c?: FxInfo }` 추가 | 기록 자료형 |
| `sim/field/fxlog.ts`(새) | 2.3절 전부 | 기록 함수, `FXLOG` | 기록 고리 |
| `sim/field/damage.ts` | 새 `rayEnd`, 지역 `fx()` | 그림용 탄착점, 객체 모양을 `pushFx` 와 같게(`text`·`color`·`c` 를 `undefined` 로) | 탄착, 객체 모양 |
| `sim/field/hazards.ts` | `pushFx`(인자 `c`), `flashbang`(인자 `by`), `panicShot`, `tickHostiles`(시한·총격범·대원 사격·흉기), 폭발 네 곳, `officersSeeing`(export) | 2.4절 4~10·15 | 기록 고리 |
| `sim/field/executor.ts` | `shootAt`, `breach`, 방 진입, `unblock`, 섬광탄 세 호출, 검거 네 곳 | 2.4절 1~3·11~14·16 | 기록 고리 |
| `sim/field/rules/crime.ts` | `detonate` | `noteBoom(…, 3.4, 'bomb')` | 폭발 반경 |
| `view/scene/fxBook.ts`(새) | `FxBook` | 연출 시계, 받아들이기, 남는 그림, 흔들림·흰 막 | 3.1절 |
| `view/scene/combat.ts`(새) | 그리는 함수 전부 | 3.2~3.9절 | 그림 |
| `view/city/combatPin.ts`(새) | `drawCombatPin` | 5.4절 | 지도 |
| `view/audioCombat.ts`(새) | `CombatVoice` | 4.1·4.3·4.4절 | 소리 |
| `view/renderScene.ts` | `drawScene`(옵션 `book`, 흔들림, 남는 그림, 겨누는 선, 어둠·빛 구멍, 효과 단계, 3-2-1, 흰 막), `agentPose`(하위 작업 `force`, swat 소총, `defuse` 선택), `doorOpenness`(진입 연출), 사람 그리기의 자세 인자, `엄` 배지 | 호출 한 줄씩 | 그림 |
| `view/scene/sprites.ts` | `ArmPose` 에 `'throw'`(R2 도 같은 이름을 쓴다), `Item` 에 `'ram'`(R1·R2 도 같은 이름), `PersonPose` 에 `recoil?`·`flinch?`·`crouch?`·`cuffed?`, `'back'` 자세에서 `cuffed` 면 막대 대신 고리 둘, `drawDoorLeaf` 의 흔적 호를 `min(open, 1)` 로, `drawLying` 의 `blood` 옵션과 붉은 타원 삭제 | 자세·수갑(인질과 구별)·문짝 튕김·피 빼기(H1 §8.2 와 같다) | 그림 |
| `view/scene/fx.ts` | `chip` 을 export, 미리 그린 조각(`sprites()` 의 `puff`·`puffDark`·`glow`)을 돌려주는 `export function fxSprites()` 하나 | 엄폐 가구·문 조각, 먼지, 폭발 연기 | N7·연기와 같은 그림 |
| `view/audio.ts` | `unlock`(소리 길·압축기), `update`(인자 `fresh`·`place`, 교전 소리를 `CombatVoice` 로, 지금의 `s.fx` 훑기를 `fresh` 훑기로 — 다루지 않는 종류는 기존·G4 분기로), `stats` | 4절 | 소리 |
| `view/runner.ts` | `stepGuard`, `frame` 의 while | 5.1절 | 첫 순간 감속 |
| `view/camera.ts` | `frameAction`, `nudge()`, (선택) 사건 점수 | 5.2·5.5절 | 자동 확대 |
| `view/renderCity.ts` | `drawCity` 옵션 `book`, 핀 반복문에 한 줄 | 5.4절 | 지도 |
| `ui/Viewport.tsx` | `ViewportProps` 에 `book: FxBook`, `effSpeed`, `book.frame`, `stepGuard`(진입 예고 감속 포함), `place`, `drawScene`(본 화면·작은 창)·`drawCity`(본 화면·작은 창)·`sound.update` 인자, 지금의 감속용 `fxScene`·`fxT` 훑기 제거 | 3.1·4.2·5.1절 | 이어 붙이기 |
| `ui/App.tsx` | `book = useMemo(() => new FxBook(), [])` 를 `runner`·`director`·`sound` 옆에 두고 `<Viewport … book={book} />` 로 넘김, `reelMoments` 순위, Q1 의 개발 서버 전용 고리 `window.__ar` 에 읽기 함수 `combat()` 과 개발용 `fxStep(dt)` 추가 | 3.1·5.3·8.3절 | 연출 기억의 주인, 이어 보기, 화면 확인 |
| `ui/MapLegend.tsx` | 항목 하나 | "교전 중" | 표식 규칙 |
| `tests/combatfx.test.ts`(새) | 9절 | | |
| `scripts/combatshots.cjs`(새) | 8.3절 | | |

**연출 기억의 주인과 부르는 순서.** `FxBook` 은 `App` 이 `runner`·`director`·`sound` 와 같은 방식(`useMemo`)으로 하나 만들고 `Viewport` 에 넘긴다(Q1 의 `window.__ar` 도 `App` 에 있다). Viewport 의 한 프레임은 이 순서다:

1. `runner.frame(now)` — 그 안에서 틱마다 `stepGuard`(5.1절).
2. `director.update(…)` (지금 자리).
3. `effSpeed` 를 구하고 `book.frame(sim, dtReal, { paused, speed: effSpeed, seeks: runner.seeks })`. 자동 감속이 꺼져 있으면 여기서 `book.fresh` 의 관찰 현장 `DECISIVE` 로 `director.nudge()`.
4. 중대한 기록(imp ≥ 3)으로 하는 감속(지금 그대로).
5. `sound.update(sim, { paused, speed: effSpeed, focus, inScene, fresh: book.fresh, place, clock: book.clock, rate: book.rate })`.
6. `drawScene`(본 화면, `book`) 또는 `drawCity`(본 화면, `book`).
7. 작은 창: `drawCity`(`mini`, `book`)와 다른 현장의 `drawScene`(`mini`, `book`).

**확인용 고리.** Q1 이 이미 `App.tsx` 에 개발 서버 전용 읽기 고리 `window.__ar = { snap }` 을 만들었다(값을 복사해 돌려줄 뿐 아무것도 바꾸지 않는다 — `CLAUDE.md` "구조"의 `ui-check` 줄). 같은 `useEffect` 안에서 그 객체에 둘을 더한다. `snap()` 의 필드 이름은 바꾸지 않는다(`scripts/ui-check.cjs` 가 읽는다).
- `combat()`: 읽기만 — `{ clock, rate, live: 현장별 살아 있는 연출 수, drawMs, stats: { ...sound.stats } }` 를 복사해 돌려준다.
- `fxStep(dt)`: `book.debugStep(dt)` — 연출 시계만 넘긴다. 시뮬레이션·실행기·카메라 상태는 건드리지 않는다(정확한 장면 찍기용, 8.3절).
시간·관찰 대상은 고리로 바꾸지 않는다. Q1·G4 처럼 사람이 쓰는 키(`1`~`4`·`Space`·`←`·`→`·`S`)와 사건 카드 누르기로 한다.

---

## 7. 구현 순서

단계마다 `npx tsc --noEmit` 과 `npx vitest run tests/combatfx.test.ts tests/destruction.test.ts`. 시뮬레이션 파일을 고친 단계는 8.1절 해시 목록을 시작 커밋과 비교(0줄 차이).

1. **기준 재기**: 시작 커밋에서 8.1절 스크립트로 해시 목록을 저장소 밖에 저장. `npx tsx scripts/sweep.ts 60` 출력도 저장. 지금 화면을 8.3절 장면으로 찍어 둔다("고치기 전").
2. **기록 고리**: `types.ts` → `damage.rayEnd` → `fxlog.ts` → `hazards.ts`·`executor.ts`·`rules/crime.ts` 의 2.4절 자리. 확인: 해시 목록 0줄 차이, 2.6절 grep 0줄, 9절 시험 1·2.
3. **FxBook 과 연출 시계**: 지금 그림을 그대로 FxBook 으로 옮긴다(새 그림 없이). 확인: 화면이 그대로이고 15배속에서도 사격선이 보인다. 되감기·새 교대 뒤 오류 없음.
4. **사격**: 총구 섬광·예광선·탄착·피격(피 빼기 포함)·반동·움찔. 확인: 8.3절 ①.
5. **섬광탄**: 던짐·터짐·방 채움·잔광·흰 막·무력화 표지. 확인: ②.
6. **폭발**: 반경별 크기·충격파·연기·흔들림. 확인: ④.
7. **진입**: 3-2-1·갈매기표·문짝·강제 개방 타격·`agentPose`. 확인: ③·⑥.
8. **대치·근접·검거·테이저**: 겨누는 선·엄폐 자세·협상·끌기·휘두름·수갑·테이저(합성 기록). 확인: ②·⑤.
9. **소리**: 소리 길·압축기·정위·원근·음색·묶음·상한·이명·지도 먼 소리. 확인: 8.4절 헤드리스 기준.
10. **연출**: `stepGuard`·진입 예고 감속·`frameAction`·`reelMoments`·지도 핀·범례. 확인: ⑦·⑧·⑨.
11. **마무리**: 9절 시험 전부, `scripts/combatshots.cjs` 로 "고친 뒤" 장면, 프레임 예산, `npm run check`, `sweep 60` 전후 비교, 사람이 들어 볼 체크리스트(8.4절)를 보고에 붙인다.

작은 것부터 끝내 커밋한다(`wf/combat-fx` 브랜치, 한국어 메시지, 푸시하지 않는다).

---

## 8. 확인 절차

### 8.1 기준 해시 스크립트 (저장소 밖, 각자의 scratchpad)

```ts
// <scratchpad>/g5hash.ts — 시작 커밋과 끝 커밋에서 똑같이 돌린 뒤 결과 파일을 diff 한다 (npx tsx <scratchpad>/g5hash.ts > before.txt)
import { Sim } from '/home/user/operator/src/sim/engine';
import { NORMAL, parseDifficulty } from '/home/user/operator/src/sim/difficulty';
const hot = parseDifficulty('3,3,5,4,3,3')!;              // 용의자 5, 장비 4 (섬광탄이 많다)
const runs: [string, any, string | null][] = [];
for (let k = 0; k < 40; k++) runs.push(['S' + k, NORMAL, null]);
for (let k = 0; k < 20; k++) runs.push(['S' + k, hot, null]);
for (const f of ['armed/shooter', 'armed/hostage', 'armed/siege', 'armed/bomb', 'armed/riot', 'armed/robbery', 'fire'])
  for (let k = 0; k < 8; k++) runs.push(['S' + k, hot, f]);
for (const [seed, d, force] of runs) {
  const s = new Sim(seed, d, 1200, { force }); s.runToEnd();
  console.log(seed, force ?? '-', s.report!.hash, digest(s));   // digest: 2.6절의 상태 요약
}
```

시작 커밋은 `git worktree add <scratchpad>/g5base <시작 커밋>` 으로 따로 꺼내 그 안의 경로로 import 를 바꿔 돌린다(작업 폴더를 되돌리지 않는다). 110교대쯤이라 1~2분 걸린다.

### 8.2 장면 찾기

또 하나의 임시 스크립트로, 위 실행 목록의 강제 사건마다 틱을 하나씩 돌리며 처음 생긴 시각을 적는다: 대원 사격, 용의자 사격, 섬광탄(던진 사람 있음), 동시 진입(`sync`), 방 진입, 강제 개방(`forced`), 폭발, 근접, 검거, 협상 시작. 이 표에서 화면 확인에 쓸 (시드, force, diff, 시각)을 고른다. 시드를 설계서에 미리 박지 않는다(B3·P1 이 합쳐지면 장면이 달라진다).

### 8.3 화면 (Playwright)

```bash
npx vite --port 5225 --strictPort &
NODE_PATH=$(npm root -g) node scripts/combatshots.cjs 5225 <시드> <force> <diff> <시각> <저장 폴더(scratchpad)>
```

`scripts/combatshots.cjs` 의 짜임새는 Q1 의 `scripts/ui-check.cjs`·G4 §11 의 찍는 스크립트를 본뜬다(두 파일은 고치지 않는다).
- 브라우저: 전역 Playwright 의 기본 `chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })` — 이 환경에서 된다(브라우저는 `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, Q1·G4 가 확인함). 안 되면 대안으로 `executablePath: '/usr/bin/google-chrome'`.
- 창 1440×900, `deviceScaleFactor` 1과 2. 설정(배속·자동 감속·시점)이 `localStorage` 에 남으므로 **장면마다 새 `browser.newContext(…)`** 를 열고 찍은 뒤 닫는다(G4 §11 과 같은 이유).
- 주소 `?seed=…&force=…&diff=…`. `diff` 를 주면 재난은 주소에 없을 때 '없음'이 된다(`runner.ts` 생성자) — 헤드리스(8.2절)와 같은 교대다. 같은 교대인지는 `__ar.snap()` 의 `hash` 를 `scripts/ui-check-ref.ts` 의 값과 견주어 본다.
- `Shift` 를 한 번 눌러 소리를 연다(상태를 바꾸지 않는 키, 4.5절).
- 시각 맞추기: G4 §11 의 `runTo(T)`(`4` 로 달리다 `T − 40` 틱부터 `1`, `T` 에서 `Space`, 지나치면 `←` 로 되감아 다시)와 "경과 시간 맞추기"(`←` → `→` 로 보간값 0)를 그대로 쓴다. `T` = 장면 시각 − 3초.
- 관찰 대상: 강제 사건의 카드(`.card.incident`)를 눌러 현장 화면을 연다.
- 찍기: 1배속(`1`)으로 재개해 그 순간 앞뒤로 0.0·0.1·0.25·0.5·1.0·2.0초. **정확한 장면**이 필요하면 장면 틱에서 `Space` 로 멈추고 `__ar.fxStep(0.1)` 등으로 연출 시계만 넘기며 찍는다(일시정지 중에는 시뮬레이션이 그대로라 같은 그림이 다시 나온다).
- 콘솔 `error`·`pageerror` 를 모아 출력한다.

| # | 장면 | 볼 것 |
|---|---|---|
| ① | 총격범(`armed/shooter`) 교전 | 대원 소총·권총, 용의자 탄의 색과 꼬리 모양이 다르다. 총구 섬광이 총구에 있다. 벽 먼지·불똥·탄흔, 가구 조각. 붉은 표현이 없다 |
| ② | 인질극(`armed/hostage`) | 겨누는 선(발사 직전 굵어짐), 협상 파동·말풍선, 방 진입의 문짝 → 깡통 포물선 → 터짐 → 방 채움 → 흰 막 → 흰 별 고리 |
| ③ | 대형 인질극(`armed/siege`) | 3-2-1 → 갈매기표 → 문짝 튕김·먼지(두 문 동시면 두 곳). 신호 대기(주황)도 한 장 |
| ④ | 폭발물(`armed/bomb`)이 터지는 시드, 그리고 화재의 가스 용기·2차 붕괴 | 반경에 따라 크기가 다르다. 충격파·연기·흔들림 |
| ⑤ | 폭동(`armed/riot`) | 휘두름, 수갑 기호, 검거 자세 |
| ⑥ | 잠긴 문 강제 개방(화재 시드) | 도구 자세, 타격 먼지, 마지막에 문짝 튕김 |
| ⑦ | AI 시점(`T`), 밤 | 총구·섬광·폭발이 어둠에 구멍을 낸다 |
| ⑧ | 지도 화면, 교전 중 | 핀의 별·고리·점선 테, 범례 항목 |
| ⑨a | 15배속 교전, **자동 감속 켬**(기본) | 첫 발(또는 3-2-1 의 "3")에서 1배속으로 바뀐다(`snap().slowed === true`). 그 동안 1배속 소리 규칙이다 |
| ⑨b | 15배속 교전, **자동 감속 끔**(`S`, `snap().autoSlow === false`) | 예광선·폭발이 보인다(연출 시계는 2배까지만 빠르다) |

- 콘솔 오류 0건: `?seed=…&force=armed/siege&diff=3,3,5,4,3,3` 로 교대 하나를 15배속으로 끝까지(되감기 두 번, 주요 장면 이어 보기 한 번 포함).
- 프레임: ①·③ 장면에서 `__ar.snap().fps`(1배속, 그리고 **자동 감속을 끈** 15배속)와 `__ar.combat().drawMs` 를 3초 동안 평균해 적는다(3.11절 기준). 고치기 전 값과 짝지어 적는다(고치기 전에는 `combat()` 이 없으므로 FPS 만).
- 찍은 그림·임시 스크립트는 저장소 밖에. 보고에 "고치기 전 → 고친 뒤" 경로를 짝지어 적는다.

### 8.4 소리

**헤드리스(오류 없음과 셈만)**: 8.3절 스크립트에서 `__ar.combat().stats` 를 읽는다(세는 단위는 4.4절).
- 15배속 대형 인질극 교전 10초, **자동 감속 끔**: `maxPerSec ≤ 14`, `voices ≤ 18`, 오류 0. (켜 두면 1배속이라 이 기준을 잰 것이 아니다.)
- 같은 장면, 자동 감속 켬: 오류 0, `snap().slowed === true` 인 동안 연사 압축이 없다(1배속 규칙).
- 음소거(`M`) 중 교전 5초: 새 소리 마디 0 — 앞뒤의 `stats.made` 가 같다(`perSec` 는 직전 값이 남을 수 있으므로 쓰지 않는다).
- 되감기 직후 1초: 새 소리 0(`made` 의 차이 0).
- 음량 0 → 0.5 → 1 바꾸기, 일시정지·재개, 지도 ↔ 현장 전환에서 오류 0.

**사람이 들어 볼 체크리스트**(헤드리스로는 확인할 수 없다. 합친 뒤 사용자에게 드린다 — 로드맵 A1):
1. 권총·소총·용의자 총이 귀로 구별되는가. 주고받는 교전이 "양쪽"으로 들리는가.
2. 첫 발이 확실히 크고 놀라운가.
3. 15배속에서 한 덩어리 "드르륵"이 되거나 귀가 아프지 않은가.
4. 섬광탄 쾅 + 이명이 지나치지 않고 2초 안에 걷히는가.
5. 폭발이 노트북 스피커에서도 들리는가(55Hz 아래는 안 들린다 — 120Hz 배음이 받쳐 주는가).
6. 진입의 쿵·쇠소리, 3-2-1 삐 소리가 분명한가.
7. 지도 화면의 먼 총성이 작고 먹먹하게, 좌우가 맞게 들리는가.
8. 현장을 확대해 움직이면 좌우 정위가 따라오는가.
9. 음소거·음량 0·일시정지·되감기 직후에 소리가 새지 않는가.
10. (선택) 긴장음·확성기가 거슬리지 않는가.

---

## 9. 테스트 (`tests/combatfx.test.ts`)

시뮬레이션 시험은 교대 전체를 돌리지 않는다(P1 이 `npm run check` 를 3분으로 줄였다 — 늘리지 않는다). 강제 사건이 **끝난 틱 + 150틱(30초)** 까지만 돌린다(강제 사건이 닫히지 않으면 `hardCap` 까지). 비교는 교대 끝의 `report.hash` 대신 같은 누적값인 `sim.logHash` 를 그 정한 틱에서 본다(`events.ts:22-26` — `report.hash` 는 교대 끝의 `logHash` 다). 효과 기록은 틱마다 새로 생긴 것을 모은다(`s.fx` 는 잘려 나가므로 끝에 한 번 보면 놓친다).

1. **해시 불변(스위치)**: `armed/shooter`·`armed/hostage`·`armed/siege`·`armed/bomb` × 시드 3개(`3,3,5,4,3,3`)를 `FXLOG.on = true`·`false` 로 돌려, 같은 정한 틱(켠 쪽에서 강제 사건이 끝난 틱 + 150 — 끈 쪽도 같은 틱까지)에서 `sim.logHash` 와 상태 요약(2.6절)이 같다. 끝나면(`finally`) `FXLOG.on = true` 로 되돌린다. 교대 끝까지의 비교는 저장소 밖 해시 목록(8.1절)이 맡는다.
2. **기록 고리**: 같은 조건에서 모은 기록이
   - `shot` 은 모두 `c.side`·`c.wpn`·`c.res`·유한한 `c.ix, c.iy`·`c.stop` 이 있다. `side 0` 의 `by` 는 그 현장 대원의 rid, `side 1` 의 `by` 는 용의자 id. `res 'hit'` 이면 `stop 'body'` 이고 같은 틱에 `c.target` 이 같은 `hit` 기록이 있다. `res 'miss'` 의 `stop` 은 'wall'·'door'·'far' 이거나, 인질이 맞은 탄(`noteCollateral` — `side 0`·`tk 2`)이면 'body'. `res 'cover'` 면 `stop 'furn'`(엄폐 중 빗나간 탄이 인질을 맞히면 `noteCollateral` 이 `res` 를 'miss' 로 바꾸므로 이 규칙과 부딪치지 않는다).
   - `flash` 는 모두 `c.r === 5.2`, `c.n >= 0`, `c.ox, c.oy` 가 있다(세 호출 모두 던진 사람을 넘긴다).
   - 진입: `c.sync === true` 인 `breach` 는 `s.breachDone` 이 참이 된 그 틱에만 나오고, 그 틱의 수는 출입구 수 이하이며, 기록마다 `c.n >= 1`·`c.by` 가 그 현장 대원이다(진입조가 있던 출입구마다 하나). `breach()` 는 `breachAt + 8` 초가 지나거나 `'nopath'` 로도 불려 어느 출입구에도 2.6칸 안에 진입조가 없을 수 있다(`executor.ts:754`) — 그때는 기록이 0개이고, 대체 기록을 만들지 않는다. 그래서 "진입마다 하나 이상"은 요구하지 않고, 실행 전체에서 `sync` 기록이 있는 진입이 한 번 이상 나오기만 본다(아래 마지막 줄). 방 진입 기록(`진입!` action 이면서 방 이름이 든 것)마다 같은 틱에 `sync === false` 인 `breach`.
   - 검거: `state` 가 `arrested` 가 된 용의자 수 = `cuff` 기록 수.
   - 폭발: `detonate` 를 직접 부른 현장(`createIncident(sim, { type: 'armed', variant: 'bomb' })` 의 폭발물)에서 `boom` 의 `c.r === 3.4`, `c.src === 'bomb'`.
   - 강제 개방: 잠긴 문을 둔 현장(`plans.lockDoor` 를 쓰는 화재 — `builders.ts:68,84`)에서 `unblock` 뒤 `forced === true` 인 `breach`.
   - 위의 종류가 실행 전체에서 한 번 이상씩 나온다(시드를 고정해 기대지 말고, 나오지 않으면 시드를 늘려 찾는 반복을 둔다 — 최대 12).
3. **N7 시험 그대로**: `breakGlass` 한 번에 `glass` 1개, 부서질 때 `debris` 1개(`tests/destruction.test.ts` 가 통과).
4. **`rayEnd`**: 벽 앞에서 'wall' 이고 자리가 벽면(마지막 칸과 벽 칸 사이), 닫힌 문에서 'door', 열린 문은 지나간다, 아무것도 바꾸지 않는다(`tiles`·`glass`·`staticVersion` 이 그대로).
5. **FxBook**: 가짜 `Sim`·`Scene`(필요한 칸만)으로 — 연출 시계가 일시정지에 멈추고 15배속에서 2배까지만 빨라진다. 한 프레임에 여러 틱의 기록이 들어오면 `born` 순서가 시뮬레이션 순서와 같다. 같은 틱의 `breach` 뒤 `flash` 지연 0.12. 상한을 넘으면 오래된 것부터 버린다. `seeks` 가 바뀌면 비우고 첫 받아들이기는 `fresh` 가 비어 있다. 모르는 종류(`'collapse'`·`'horn'`·`'drop'`)는 `fresh` 에는 들어가고 `live` 에는 없다. `entryOrdered` 인 가짜 현장에서 `breachAt − t` 가 3·2·1 을 지날 때 `'tick'` 합성 항목이 하나씩(`n` = 3·2·1) 생기고 `s.fx` 는 그대로다. `debugStep(0.25)` 는 일시정지 중에도 `clock` 을 0.25 넘긴다. 화면 막(`whiteout`·`orange`)은 실제 시간 2.5초 안의 둘째 것이 0 이다.
6. **그림 함수가 예외 없이 돈다**: 모든 메서드·속성을 받아 주는 가짜 2D 맥락(`Proxy` — `measureText` 는 `{ width: 10 }`, `createRadialGradient` 는 `{ addColorStop() {} }`, `getTransform` 은 `{ a: 1 }`)과 가짜 `document.createElement('canvas')` 를 `globalThis` 에 두고, `combat.ts` 의 모든 그리는 함수를 종류별 합성 기록(테이저 포함)으로 k = 0·0.3·0.7·1 과 `mini` 참·거짓에 부른다. 가능하면 `drawScene` 도 한 번 부른다. [확인 필요: `renderScene.ts` 를 import 할 때 DOM 이 없는 환경에서 문제가 없는지 — 문제가 있으면 `combat.ts`·`combatPin.ts` 만 시험한다]
7. **소리 묶음 규칙**: `audioCombat.ts` 의 "무엇을 낼지 고르는" 부분을 AudioContext 없이 시험할 수 있게 순수 함수(`planCues(fresh, speed, now, state) → Cue[]`)로 떼어 둔다. 15배속에 사격 40발이 한 프레임에 오면 현장·쪽마다 연사 하나, 토큰 통(용량 4, 초당 10)이 비면 버린다, 섬광·폭발은 버리지 않는다. 1초 동안 프레임마다 사격을 넣어도 사격류 cue 가 14개를 넘지 않는다. 시작 시각: 같은 틱의 `breach` 와 `flash` 가 오면 섬광탄 터짐 cue 의 `when` 이 진입 cue 보다 `(0.12 + 0.34) / rate` 늦다. `speed` 는 `effSpeed` 를 받는다(자동 감속 중 1).
8. **재현성**: 같은 시드 두 번의 정한 틱 `sim.logHash` 가 같다(새 기록이 있어도).
9. **잔혹한 묘사 없음**(H1 시험 10번과 같은 검사): `src/view/renderScene.ts` 에 `blood:` 가 없고, `src/view/scene/sprites.ts` 에 `rgba(110,18,22` 가 없고, `src/view` 어디에도 `rgba(230,50,50` 이 없다(파일을 글자로 읽어 본다).
10. **시뮬레이션 금지어**: `fxlog.ts` 가 `tests/sim.test.ts` 의 `Math.random`·`Date`·`performance`·`document`·`window` 검사를 통과한다(그 시험이 `src/sim` 전체를 보므로 따로 쓰지 않아도 된다 — 통과하는지만 본다).

---

## 10. 알려진 위험

1. **60개 상한**: `runner.frame` 은 실제 시간 간격을 0.1초로 자르므로(`runner.ts:106`) 15배속에서도 한 프레임은 많아야 1.5초(약 8틱)다(`steps < 40` 은 닿지 않는다). 그 사이 한 현장에 기록이 60개 넘게 쌓이면 FxBook 이 보기 전에 잘리지만, 물줄기(호스 하나에 2틱마다 하나)가 많은 화재 현장에서 사격이 겹칠 때 정도라 거의 없다. 되감기·복원처럼 한꺼번에 도는 틱은 FxBook 을 비우므로 해당하지 않는다. 상한을 늘리는 것도 결과에는 영향이 없지만(2.6절로 확인), 이번에는 늘리지 않는다.
2. **그림 선과 창이 깨지는 선의 차이**(2.3절): 빗나간 탄의 예광선은 흔든 끝점 쪽, 창은 흔들지 않은 목표 쪽에서 깨진다. 1칸 남짓 어긋날 수 있다.
3. **연출 지연과 상태 표지**: 진입 뒤 섬광탄을 0.12~0.46초 늦게 그리지만(소리도 같은 시각에 맞춘다 — 4.4절) 무력화 상태는 그 틱에 이미 걸려 있다. 무력화 표지는 늦추지만 자세(`stunned → side`)는 바로 바뀐다.
4. **빛 깜박임**: 섬광탄 흰 막·폭발 주황 막은 광과민성에 위험할 수 있다. 둘을 합쳐 실제 시간 2.5초에 한 번 상한(3.1절), 흰 막 최대 알파 0.5·주황 막 0.12, `prefers-reduced-motion` 에서 0.15·0.04, 흔들림 끔. 그래도 지적이 있으면 설정이 필요하다(이번에는 화면을 만들지 않는다).
5. **해석이 들어간 그림**: 진입 방법(`breachHowFor`)과 시한 초과의 사격(`recHarm`)은 시뮬레이션이 다루지 않는 세부를 상태에서 골라 그린다. 기록(로그)에는 아무것도 더하지 않고, 실제로 일어난 상태 변화(문이 열림, 인질이 다침)만 그린다. `charge`(폭파)는 시뮬레이션이 폭발 효과를 적용하기 전에는 쓰지 않는다 — "가짜 연출 금지"의 경계.
6. **소리는 귀로 확인하지 못한다**: 헤드리스는 오류와 셈만. 음색·세기는 사람이 들어 봐야 한다(8.4절 체크리스트, 로드맵 A1). 헤드리스 Chrome 의 자동 재생 정책 때문에 `--autoplay-policy` 인자나 키 입력이 필요할 수 있다.
7. **공용 파일 충돌**: `executor.ts`(B1, R1, R2, H1), `hazards.ts`(G4, H1, X6), `types.ts`(모두 — `Fx` 한 줄의 kind 합집합 끝에 G4 `'collapse'`·R1 `'drop'`·X6 `'horn'` 도 붙는다: 모두 살린다. G5 의 `c` 칸은 인터페이스 합치기로 따로 두어 그 줄과 겹치지 않는다), `renderScene.ts`(G4, H1, R2, X6), `sprites.ts`(R1, R2, H1), `audio.ts`·`MapLegend.tsx`·`fx.ts`(G4 가 맡는 파일, X6 의 `'horn'` 분기), `camera.ts`·`Viewport.tsx`(G4 의 `'collapse'`, X6 의 `'horn'` 한 단어), `App.tsx`(Q1 의 `__ar` — 이미 합쳐짐, U2). 합치는 순서와 조각의 크기를 지킨다.
8. **되감기 뒤의 기억**: 남는 그림(탄흔·그을음·깡통)과 진입 문짝 연출은 화면 쪽 기억이라 되감기하면 사라진다. 그 순간을 다시 지나면 다시 생긴다.
9. **AI 시점의 숨은 용의자 사격**(3.12절): 지금 코드도 AI 시점에서 모든 사격선을 그린다 — 그 동작을 유지한다. 정보 격리는 AI 의 판단에 대한 규칙이라 화면 표시와 부딪치지 않는다.
10. **'hit' 그림 변경**은 교통사고(지나가는 차에 치임)의 `hit` 도 바꾼다.
11. **주요 장면 순위 변경**으로 이어 보기에 고르는 장면이 달라진다(화면만).
12. **큰 확대에서의 비용**: 칸당 96화소에서 폭발·방 채움이 커진다. 화소 상한(3.11절)과 미리 그린 조각을 쓴다.
13. **`agentPose` 의 swat 소총**은 R1(개인 장비)이 대원별 무기를 정하면 바뀔 수 있다.
14. **뒤 묶음이 기록 고리를 모르고 구현하면**(R1 의 테이저가 노란 `shot` 을 넣는 식으로): 꼬리표 없는 기록은 예외 없이 보통 그림으로 떨어지지만(3.7절) 테이저 전선·무기 구분이 사라진다. 11절의 "뒤 묶음이 할 일"을 그 설계서와 `CLAUDE.md` 에 옮겨 적어 막는다.
15. **엄폐 가구 탄착의 차이**: 그림은 엄폐 중 빗나간 탄(`res 'cover'`)마다 가구 조각을 튀게 하지만, 실제 가구 피해는 파손 난수(`COVER_HIT`, 70%)로 일부 탄에만 난다(`damage.hitCover`). 결과에는 영향이 없다 — 그림이 조금 더 자주 "맞는다".
16. **예약된 소리와 일시정지**: 소리는 그림 단계에 맞춰 많아야 0.5초 앞에 예약한다(4.4절). 그 사이에 일시정지하면 이미 예약한 소리는 난다. 되돌리지 않는다.
17. **자동 감속과 확인**: 자동 감속은 기본으로 켜져 있어 15배속 교전도 대부분 1배속으로 보인다. 15배속 그대로의 그림·소리·FPS 기준은 감속을 끄고 잰다(8.3·8.4절). 사용자가 감속을 끄고 보면 8·15배속 규칙(연사 압축, 탄착 소리 없음)이 그대로 들린다.

---

## 11. 다른 설계서와 맞출 것

조사를 시작할 때는 없었고 이 문서를 쓰는 동안 `R1-crews.md`·`R2-methods.md`·`H1-injuries.md`·`G4-scene-legibility.md`·`U2-call-panel.md` 초안이 들어왔다(커밋 `404e4c6`). 검토 때(`d876c96`) `X6-catastrophe.md` 도 들어와 있어 함께 읽고 맞췄다. H1·X6 는 이미 G5 의 이름(`noteHit`·`recMelee`·`noteBoom`·`DECISIVE`·`FxInfo['src']`)을 따라 적었다. 로드맵의 나눔대로 G5 가 R1·H1·X6·R2 보다 먼저 구현되면, 뒤 묶음은 아래 "뒤 묶음이 할 일"을 따른다 — 그 묶음의 설계서에는 아직 적혀 있지 않으므로, **합치는 사람이 그 설계서에 한 줄씩 옮겨 적는다.** [확인 필요: 합치는 사람]

| 문서 | 겹치는 것 | G5 가 맞춘 것 | 뒤 묶음이 할 일 |
|---|---|---|---|
| R1 부대 편성·개인 장비(§4·§6.3·§10) | 대원별 무기(`pistol`·`rifle`·`sniper`), 테이저, 방패, 섬광탄을 사람 몫으로, 방호(`armorOf`), 공성추·할리건(`breachKit`·`irons`), 손에 든 것(`Item`) | `FxWeapon` 의 이름을 R1 의 `KitId` 와 같게(`pistol`·`rifle`·`sniper`·`taser`), `FxStop 'shield'`, `Item 'ram'` 은 R1 과 같은 이름. 섬광탄 세 호출의 던진 사람 인자는 R1 이 `useKit` 으로 바꿔도 그대로 맞는다 | ① 테이저(R1 §6.3)는 `pushFx(… 'shot' …, 노란색)` 대신 `recTaser(…)` 한 줄(R1 의 대기 시간 `a.taserAt` 은 그대로 — 그림은 기록으로 그린다). ⑥ 물 투하 `Fx 'drop'` 은 G5 가 그리지 않는다 — `FX_DRAWN` 밖이라 기존 반복문이 시뮬레이션 나이로 그리고, 소리는 `fresh` 훑기의 기존 분기 자리에 R1 이 분기 하나를 더한다(3.1·4.4절). ② `weaponOf` 를 장비로(`sniper` > `rifle` > `pistol`). ③ `noteShot`·`noteHit` 의 `arm` 을 `u.armor` 대신 `armorOf(sim, rid, true)`. ④ `breachHowFor` 가 `breachKit`·`irons` 를 본다. ⑤ R1 이 `Item` 에 `'halligan'` 을 더하면 `irons` 진입·강제 개방 자세에 그것을 쓴다(R2 는 같은 것을 `'irons'` 라 부른다 — 둘 가운데 먼저 합친 이름) |
| R2 대응 방식(§3.1·§3.7·§4.2·§4.6) | 문 방법(`kick`·`irons`·`ram`·`hydraulic`), 비살상탄·저격, `agentPose` 의 방법 분기, 저격 조준선, `ArmPose 'throw'`, `Item 'ram'` | `BreachHow` 의 문 방법 이름을 R2 의 `MethodId` 와 같게, `FxWeapon 'beanbag'`, 새 사격 코드용 `recShot`, 저격 대원의 겨누는 선은 그리지 않음, `ArmPose 'throw'`·`Item 'ram'` 은 같은 이름 | ① `unblock(…, method)` 가 되면 2.4절 14번의 `how` 에 그 방법을 넘긴다. ② 비살상탄·저격의 판정 직후 `recShot(sim, s, a, 'beanbag' / 'sniper', h.x, h.y, hit, 1, h.id, hc)` 한 줄 — 저격이 빗나가 인질이 다쳤으면(R2 §4.6 `mrng.chance(0.2)`) 마지막 인자로 그 인질을 넘겨 `noteCollateral` 까지 남긴다. 소화기 분말(흰 `spray`)은 G5 와 무관하다(기존 반복문). ③ `agentPose` 의 방법 분기를 G5 의 하위 작업 분기 앞에 둔다. ④ R2 의 `sprites.ts` 추가에서 `'throw'`·`'ram'` 은 이미 있으므로 빼고 나머지만 |
| H1 부상과 사망(§8.2, 시험 10번) | 피 표현, `hit` 효과, 쓰러짐·사망 모습, 원인(`gunshot`·`stab`·`blunt`) | `blood` 옵션과 붉은 타원을 지우고 `hit` 을 흰 고리 + 회색 먼지 + 불꽃으로 — H1 이 적은 그대로라 H1 시험 10번이 G5 뒤에 이미 참이다 | ① H1 의 `hurt*` 가 부르는 자리에 G5 의 꼬리표 줄이 함께 있으면 둘 다 살린다(꼬리표는 피해 식과 무관하다 — H1:35 가 이미 그렇게 적었다). ② 부상 정도를 기록에 더하고 싶으면 `FxInfo` 끝에 칸을 더하고 피격 불꽃 크기를 맞춘다. ③ 쓰러짐·사망·들것·덮개는 H1 이 그린다. ④ H1 의 `PersonPose.hurt?`·`ArmPose 'clutch'` 는 G5 의 `recoil?`·`flinch?`·`crouch?`·`cuffed?` 옆에 더한다(H1 §8.3) |
| G4 현장 상태 가독성(§3.1·§4.3·§4.6·§7.3·§7.4) | `Fx` 줄의 kind(`'collapse'`), 2차 붕괴 자리(`tickCollapse` 의 `pushFx(… 'boom' …)` — `d876c96` 에서 `hazards.ts:622`. G4 가 적은 613 은 P1 합침 전 줄이다), 흔들림(`fallShake`, 칸 단위), 자동 감속·카메라·소리의 효과 종류 목록, 터진 폭발물 자국, 인질 선, `audio.ts`·`fx.ts`·`MapLegend.tsx` | 2차 붕괴의 꼬리표는 G4 가 없을 때만, `'collapse'` 는 그리지 않음, 흔들림은 둘 다 칸 단위로 더함(각자 상한, 합은 자르지 않음 — 3.4절), `DECISIVE` 집합 하나, 폭발물 그을음은 G4 의 자국이 있으면 뺌, 인질 선은 건드리지 않음 | G5 가 먼저면: G4 는 `'collapse'` 를 `DECISIVE` 와 `frameAction` 목록에 한 단어씩, 소리는 `fresh` 훑기의 분기 하나로 더하고, `tickCollapse` 의 G5 꼬리표 줄을 그 `pushFx` 줄과 함께 지운다. `fallShake` 는 `book.shake` 와 같은 `translate` 에서 칸 단위로 더한다. G4 가 먼저면 G5 가 그렇게 맞춘다. G4 는 엄폐 배지를 정하지 않았다(G5 는 반쪽 벽 기호). 무력화 표지(흰 별 고리)·`defuse` 자세가 G4 의 표지 체계와 다르면 G4 쪽을 따른다 |
| U2 통화창 배치 | `App.tsx` | 겹치지 않는다(G5 는 `book` 의 `useMemo` 한 줄·`<Viewport>` 의 `book` 인자, `reelMoments`, Q1 의 `__ar` 에 더하는 두 함수뿐) | — |
| X6 위험의 현실화(§7.4·§7.5) | 큰 폭발·붕괴, 철수 신호 | X6 가 이미 G5 의 이름으로 적었다: 폭발마다 `noteBoom(lastFx(sim, s, 'boom'), r, src)`, `FxInfo['src']` 끝에 `'drum' \| 'cng' \| 'jet' \| 'dust'`, `Fx` 의 kind 끝에 `'horn'`. G5 는 모르는 `src` 도 `r` 로 그리고, `'horn'` 은 그리지 않는다(`FX_DRAWN` 밖) | ① `tickFire`·`tickGas` 의 폭발 덩어리를 `ruptureVessel`·`explodeGas` 로 옮길 때 G5 꼬리표(3.6 'tank'·3.8 'gas')를 옮긴 자리에 다시 단다. ② `'horn'` 을 `DECISIVE`(길이 3200)와 `frameAction` 목록(무게 2)에 한 단어씩, 소리는 `fresh` 훑기의 분기 하나. ③ 무너짐은 G4 의 `'collapse'` |

---

## 12. 완료 조건과 보고

- 2.6절 네 겹 증명이 모두 통과: grep 0줄, 스위치 시험 통과, 시작 커밋 대비 해시 목록 0줄 차이, `sweep 60` 의 `outcomes`·`close reasons` 가 같다. `npm run check` 통과.
- `npx tsc --noEmit`, `npx vitest run tests/combatfx.test.ts tests/destruction.test.ts tests/ext.test.ts` 통과.
- 8.3절 ①~⑨ 장면을 직접 보고 "고치기 전 → 고친 뒤" 짝으로 경로를 적는다. 콘솔 오류 0건. 프레임 예산(3.11절) 수치.
- 8.4절 헤드리스 기준 수치와 사람이 들어 볼 체크리스트.
- 보고(마지막 응답): 브랜치와 마지막 커밋, 구현한 것 / 못 한 것(선택 항목을 했는지), 고친 공용 파일(파일·함수·이유 — 특히 `types.ts` 의 `Fx` 한 줄을 고친 것), 해시 비교 결과, 알려진 문제, 그리고 합친 뒤 옮겨 적을 문장:
  - `README.md` "알려진 문제": 교전 소리는 사람이 들어 봐야 한다(8.4절 체크리스트), 빗나간 탄의 그림 선과 깨지는 창의 어긋남, 진입 뒤 섬광탄의 연출 지연, 되감기 뒤 탄흔이 사라짐.
  - `CLAUDE.md` "겪은 함정"에 한 줄(제안): "**교전 연출 기록.** 사격·섬광탄·진입·폭발·검거·테이저를 새로 만들거나 옮기면 `field/fxlog.ts` 의 `note*`/`rec*` 한 줄을 그 자리에 둔다(기존 `pushFx` 줄 바로 다음, `bulletPath` 앞). 이 함수들은 `s.fx` 에만 쓰고 난수를 부르지 않는다 — 결과는 바뀌지 않는다." 그리고 "자주 하는 확장" 표의 새 효과 줄에 `view/scene/combat.ts`·`fxBook.ts`.
  - 11절의 "뒤 묶음이 할 일"을 R1·R2·G4(G5 보다 늦게 합친다면) 설계서에 한 줄씩.
