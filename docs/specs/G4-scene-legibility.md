# G4 — 한눈에 보이는 현장 상태 (붕괴를 중심으로)

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/legibility`, 개발 서버 포트 **5212**(다른 묶음과 겹치면 바꾼다).

사용자의 말: "건물 붕괴 이런 것도 진짜 붕괴했는지 안 보이니까 한눈에 보이게."

**하는 일**: 화면 계층의 일이다. 건물이 정말 무너졌다는 것을 지도·현장·사건 카드에서 한눈에 알아보게 하고, 같은 꼴로 "상태는 바뀌었는데 화면에서 잘 안 보이는 것"(가스가 찬 범위, 되살아난 불, 균열과 보강, 폭발 자리, 붙잡힌 인질)을 함께 고친다. **시뮬레이션 결과는 한 건도 달라지지 않는다**(기록 해시가 같다).

**자기 파일(새로 만든다)**: `src/sim/field/ruins.ts`, `src/view/hazardState.ts`, `src/view/scene/ruins.ts`, `src/view/scene/hazardFx.ts`, `src/view/city/ruinLayer.ts`, `src/ui/HazardStrip.tsx`, `tests/legibility.test.ts`.
**자기 파일(이 묶음이 맡는 기존 화면 파일)**: `src/view/scene/staticLayer.ts`, `src/view/scene/fx.ts`, `src/view/icons.ts`, `src/view/marks.ts`, `src/view/audio.ts`, `src/ui/MapLegend.tsx`.
**공용 파일 수정(§8 에 적힌 자리만, 가장 작게)**: `src/sim/types.ts`, `src/sim/field/builders.ts`(`buildCollapse` 세 줄), `src/sim/field/hazards.ts`(`tickFire` 의 천장 붕괴, `tickCollapse`), `src/view/renderScene.ts`, `src/view/renderCity.ts`, `src/view/camera.ts`(효과 종류 한 곳), `src/view/scene/skins/crime.ts`(터진 장치), `src/ui/panels.tsx`(`IncidentCard` 두 곳), `src/ui/Viewport.tsx`(자동 감속 조건 한 곳), `src/ui/styles.css` 끝 블록. 선택 항목을 하면 `src/view/city/trafficLayer.ts` 한 덩어리.
**건드리지 않는다**: 그 밖의 `src/sim/*` 전부(판단·규칙·난수·현장 생성), `src/view/city/staticCity.ts`·`places.ts`, `src/sim/city.ts`·`cityPlan.ts`, `tests/sim.test.ts`, `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`·`docs/specs/README.md`(합친 뒤에 한꺼번에 고친다).

---

## 1. 지금 상태 — 무엇이 왜 안 보이는가

조사한 코드: 커밋 1ca465d. 줄 번호는 그때 기준이다(옮겨졌으면 함수 이름으로 찾는다).

### 1.1 붕괴

| 자리 | 지금 그림 | 왜 안 보이는가 | 근거 |
|---|---|---|---|
| 현장: 무너진 구역 | `s.damage` 칸마다 같은 회색 타원(투명도 0.42) 하나, 금 한 줄, 조각 7개 | 바닥보다 조금 밝은 얼룩이 칸마다 반복될 뿐이다. 높낮이·경계·"내려앉음"이 없다 | `staticLayer.ts:789-804` |
| 현장: 넘어간 벽 | 없다. 구역 안의 벽 칸 75%가 기록 없이 `T.FLOOR` 가 된다 | 무너진 벽 자리가 처음부터 빈 바닥처럼 보인다. 남은 25%의 벽은 멀쩡한 벽과 똑같이 그려진다(벽은 지금의 `tiles` 로만 그린다) | `builders.ts:657`, `staticLayer.ts:806-838` |
| 현장: 깔린 가구 | 없다(`decor = 0`) | 총격으로 부서진 가구(`rubble()`)와 달리 흔적이 남지 않는다 | `builders.ts:658`, `staticLayer.ts:812-833` |
| 현장: 바깥 벽 | 늘 멀쩡하다 | 무너진 구역은 층의 벽 안쪽(`F.x0+1..F.x1-1`, `Plan.floors` 는 벽 포함 범위)에만 잡힌다. 건물 외곽선은 그대로라 "멀쩡한 건물"로 읽힌다 | `builders.ts:650-652`, `plans.ts:21` |
| 현장: 2차 붕괴 | 폭발과 같은 `'boom'`(주황·흰 빛, 고리, 검은 조각, 1.1초) | 무너짐이 아니라 폭발로 읽힌다. 흔들림·먼지·내려앉는 움직임이 없다 | `hazards.ts:613`, `renderScene.ts:626-633` |
| 현장: 불탄 방의 천장 붕괴 | 잔해 소품이 갑자기 생긴다 | 효과도 바닥 흔적도 없다(`s.damage` 도 쓰지 않는다) | `hazards.ts:102-116` |
| 현장: 2차 붕괴 위험 | 보강 전 균열: 빨라지고 붉어지는 고리 + '균열 — 붕괴 위험' | 언제 무너질지(진행), 무너지면 어디까지 다치는지(`blast` 반경 2.6칸)가 보이지 않는다 | `renderScene.ts:243-254`, `hazards.ts:612` |
| 현장: 치운 잔해 | 사라진다 | 대원이 치워 낸 통로와 원래 바닥을 구별할 수 없다 | `executor.ts:215`, `renderScene.ts:200` |
| 지도: 무너진 건물 | 지붕이 멀쩡하다 | 지붕은 교대마다 한 번 그리는 고정 지도 층이다. 덧그림이 없다 | `staticCity.ts:274-275`, `renderCity.ts:115` |
| 지도: 진행 중 | 건물 외곽의 깜박이는 2px 테 | 무엇 때문인지는 유형색뿐, 규모는 모른다. 사건이 끝나면 사라진다 | `renderCity.ts:223-231` |
| 지도: 핀 | 승강기 갇힘·크레인·산사태·가스 폭발 모두 같은 "금 간 건물" 아이콘 | 붕괴 여부·규모를 모른다. 승강기 갇힘이 건물 붕괴처럼 보인다 | `icons.ts:10`, `renderCity.ts:297` |
| 지도: 끝난 사건 | 결과색 점(반지름 5, 투명도 0.55) | 무너진 건물이 교대 끝까지 그 자리에 있다는 사실이 사라진다 | `renderCity.ts:265-269` |
| 지도: 지진 | 진앙에서 퍼지는 고리 6초, 화면 가장자리 떨림 3초, 현장 먼지 5초 | 어느 건물이 무너졌는지는 핀이 뜨기 전까지 없다(관찰자 시점에서도) | `disasterLayer.ts:88-108, 158-169, 184-195` |
| 지도: 마우스 정보 | 종류·주소·층수, '사건 진행 중' | 무너졌는지 없다 | `renderCity.ts:367-383` |
| 사건 카드 | 코드·제목·위험도·부대·구조 대상 | 현장 위험의 상태(무너짐, 2차 붕괴, 균열·보강)가 없다 | `panels.tsx:54-96` |

**크기 계산**(측정 아님): 지도 배율은 `min(w/3200, h/2200)·0.98·zoom`. 1440×900 화면에서 지도 폭을 900화소로 잡으면 배율 1 에서 0.28화소/단위 — 빌라(28~36×22~27)는 8~10화소, 창고(56~88×28~36)는 폭 16~25화소. 배율 1 에서는 지붕을 고쳐 그려도 보이지 않는다(→ §5.2 의 기호).

**무너진 정도**(측정: `createIncident` 로 변형마다 24번, 건물 칸(벽 포함) 대비 `s.damage` 칸의 비율): 일반 붕괴 10·50·90 백분위 0.14 · 0.19 · 0.26(24~72칸), 가스 폭발 0.11 · 0.20 · 0.28, 크레인 8~11칸(공사장 바닥), 산사태 73~106칸(길 위 — 건물 없음).

### 1.2 같은 꼴의 다른 상태

| 상태 | 지금 | 문제 | 근거 | 이 묶음에서 |
|---|---|---|---|---|
| 가스가 찬 범위 | 가스 누출(`hazmat`) 현장만 연기 층 전체를 연두색으로 물들인다. 가스 폭발 현장(`collapse/gasblast`, `rules = ['gas']`)의 가스는 회색 연기 | 불 연기와 가스가 같은 `s.smoke` 배열이다. 물들이기가 `source-atop` 으로 층 전체를 칠해 둘을 나눌 수 없다. 폭발 판정(실내 `smoke > 0.6` 칸 10개 이상)의 범위가 보이지 않는다 | `renderScene.ts:297`, `fx.ts:139-150`, `hazards.ts:618-650` | 고친다 (§7.1) |
| 되살아난 불 | 같은 불꽃 | 지휘관이 "꺼졌다"고 아는 방에 다시 붙은 불을 구별할 수 없다 | `fx.ts:83-114`, `executor.ts:614-653` | 고친다 (§7.2) |
| 균열·보강 | 고리와 글자 / 나무 지지대 | 진행과 다치는 범위가 없다 | `renderScene.ts:243-254` | §4.2 |
| 폭발 뒤 현장 | 터진 폭발물 자리에 아무것도 그리지 않는다. 그을음은 연료가 다 탄 칸(`s.burned`)에만 | 불을 빨리 끄면 폭발 흔적이 거의 남지 않는다. 불붙은 밸브 둘레도 같다 | `skins/crime.ts:45,69`, `fx.ts:74-81`, `rules/crime.ts:20-48` | 고친다 (§7.3) |
| 해체된 폭발물 | 열린 가방·상자 + 초록 점 + '해체 완료' | 충분하다 | `skins/crime.ts` | 그대로 둔다 |
| 붙잡힌 인질 | 손을 뒤로 + 용의자→인질 빨간 점선 | `c.hostage` 는 풀려나도 지워지지 않아 풀려나 걸어 나오는 인질도 같은 모습이다. 섬광탄으로 용의자가 무력화된 동안(구출 기회)에도 점선이 그대로다 | `renderScene.ts:324, 344-348`, `hazards.ts:280-284` | 고친다 (§7.4) |
| 통제된 도로 | 사건 통제와 재난 통제가 같은 붉은 점선 + 진입 금지 원 | 무엇이 막았는지 모른다 | `trafficLayer.ts:69-82, 171-186` | 선택 (§7.5) |
| 끝난 화재 건물 | 결과색 점만 | 탄 건물이 지도에서 사라진다(`docs/ROADMAP.md` M2 (1)과 겹친다) | `renderCity.ts:265-269` | 선택 (§7.6) |
| 침수(홍수) | 지도는 강이 수위만큼 굵어진다. 현장(`floodCar`)은 보통 교통사고 현장 | 현장 상태에 물이 없다(대원은 보통 걸음으로 다닌다) | `disaster.ts:412-414`, `disasterLayer.ts:59-67` | **그리지 않는다** — 상태에 없는 물을 그리면 가짜 연출이다 |

---

## 2. 원칙

1. **결과 불변.** `src/sim` 에서 바꾸는 것은 §3 의 기록용 쓰기뿐이다. 난수를 부르지 않고, `emit`·`raiseProblem`·`markRecovered` 를 더하지 않고, 기존 호출의 순서를 바꾸지 않고, 시뮬레이션의 어떤 판단도 그 기록을 읽지 않는다. 증명은 §3.4.
2. **상태를 그린다.** 그림은 상태(관찰자 시점은 진실, AI 시점은 관제·지휘관의 믿음)에서만 나온다. 상태에 없는 것은 그리지 않는다. 멀리서 보이게 과장하는 것은 허용하되, 무엇을 얼마나 과장했는지 이 문서에 적는다(지도의 지붕 구멍 — §5.3).
3. **시점 규칙.** AI 시점: 부대가 도착한 뒤의 건물 겉모습은 모두가 본다고 친다. 수치(균열의 진행, 가스 폭발 판정 칸 수, 지휘관이 모르는 것)는 관찰자 시점에서만 보인다. 표: §4.7, §5.1, §6.
4. **모양으로 구별한다.** 지도와 목록에는 글자 표식 대신 그림 기호(24×24 경로, `marks.ts`·`icons.ts` 방식). 새 기호는 범례에 넣는다. 현장 화면의 글자 표지(`pill`)는 지금처럼 쓴다.
5. **무너짐은 폭발과 달라 보여야 한다.** 무너짐 = 흙빛 먼지·내려앉는 그림자·흔들림·둔탁한 소리, **빛 없음**. 폭발 = 지금의 주황·흰 빛.
6. **고정 층 규칙**(`CLAUDE.md` 함정 "현장 그림의 고정 층"). 고정 층에 그리는 상태는 `staticSig` 에 넣는다. 매 프레임 바뀌는 것(먼지, 깜박임, 흔들림, 진행 고리)은 고정 층에 넣지 않는다.
7. **프레임 예산**은 §9.

---

## 3. 자료형 — 시뮬레이션에 더하는 기록용 필드

### 3.1 `types.ts` (추가만)

```ts
// Fx.kind: N7 이 'glass' | 'debris' 를 붙인 자리(같은 줄)의 끝에
... | 'glass' | 'debris' | 'collapse';

// Scene 의 마지막 칸(idleSince) 뒤에
  ruin?: Uint8Array;        // 그림용 기록 — 무너진 자리의 원래 모습(field/ruins.ts). 시뮬레이션은 읽지 않는다.
                            // 0 없음 · 1 넘어간 벽 · 8 2차 붕괴로 잔해가 쏟아진 칸 · 9 천장이 내려앉은 칸 · 16+DECOR 깔린 가구(키 큰 진열대 포함)
  falls?: FallRecord[];     // 그림용 기록 — 무너진 순간들(시각 순, 많아야 32). 시뮬레이션은 읽지 않는다

// 파일 끝에
/** 그림용 기록: 무너진 순간 하나. field/ruins.ts 의 recordFall 만 만든다 */
export interface FallRecord { t: number; x: number; y: number; r: number; cause: 'zone' | 'secondary' | 'ceiling'; region: number }
```

선택 칸(`?`)이므로 `kit.baseScene` 은 고치지 않는다. 붕괴가 없는 현장에는 생기지 않고, 그림 쪽은 `undefined` 를 견딘다.

### 3.2 `src/sim/field/ruins.ts` (새 파일, 그대로 옮겨 써도 된다)

```ts
// 그림용 기록 (docs/specs/G4-scene-legibility.md). 시뮬레이션의 어떤 판단도 이 기록을 읽지 않는다.
// 난수를 부르지 않고 emit 하지 않는다. 기록을 켜든 끄든 같은 시드의 결과는 같다 — tests/legibility.test.ts 가 RUIN_LOG.on 을 바꿔 가며 확인한다.
import type { Sim } from '../engine';
import type { FallRecord, Scene } from '../types';

export const RUIN_WALL = 1, RUIN_SECONDARY = 8, RUIN_CEILING = 9, RUIN_FURN = 16;
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
  if (fx) { s.fx.push({ kind: 'collapse', t: sim.t, x, y, ttl: 2.6 }); if (s.fx.length > 60) s.fx.splice(0, s.fx.length - 60); }
}
```

`hazards.ts` 의 `pushFx` 를 가져다 쓰지 않는다(`hazards.ts` 가 이 파일을 import 하므로 서로 부르게 된다). 효과 목록의 60개 상한은 `pushFx` 와 같다.

### 3.3 기록을 채우는 자리

**`builders.ts` `buildCollapse`** (지금 657~658줄). 조건식의 난수 호출은 그대로 두고, `decor` 를 지우기 **전에** 적는다:

```ts
// 전
if (t === T.WALL && rng.chance(0.75)) { s.tiles[i] = T.FLOOR; s.decor[i] = 0; }
else if (t === T.FURN && rng.chance(0.6)) { s.tiles[i] = T.FLOOR; s.decor[i] = 0; }
// 뒤
if (t === T.WALL && rng.chance(0.75)) { markRuin(s, i, s.decor[i] === DECOR.SHELF ? RUIN_FURN + DECOR.SHELF : RUIN_WALL); s.tiles[i] = T.FLOOR; s.decor[i] = 0; }
else if (t === T.FURN && rng.chance(0.6)) { markRuin(s, i, RUIN_FURN + s.decor[i]); s.tiles[i] = T.FLOOR; s.decor[i] = 0; }
```

같은 함수, 구역 반복문이 끝난 바로 뒤("넘어간 벽 자리는 이웃한 방에 속한 것으로 본다" 줄 앞)에 한 줄:
`recordFall(sim, s, (zx0 + zx1) / 2, (zy0 + zy1) / 2, Math.max(zw, zh) / 2, 'zone', false);`
(`buildCollapse` 는 가스 폭발 현장도 만든다 — `scenes/major.ts:198`. 둘 다 같은 기록을 얻는다.)

**`hazards.ts` `tickCollapse`** (지금 606, 613줄):

```ts
s.damage[i] = 1; made++; markRuin(s, i, RUIN_SECONDARY);
…
blast(sim, s, I, p.x, p.y, 2.6, 28, ev);
recordFall(sim, s, p.x, p.y, 2.6, 'secondary');      // 예전의 pushFx(…'boom'…) 자리: 무너짐은 폭발 그림이 아니라 'collapse' 로 그린다
```

**`hazards.ts` `tickFire` 의 천장 붕괴** (지금 112, 115줄). `s.rng.range(9, 14)` 는 지금처럼 `propAt[i] < 0` 일 때만 불려야 한다(괄호를 옮기다 바꾸지 않는다):

```ts
for (let q = 0; q < k; q++) { const i = s.rng.pick(cands); if (s.propAt[i] < 0) { addProp(s, 'debris', i % w, (i / w) | 0, { blocking: true, hp: s.rng.range(9, 14) }); markRuin(s, i, RUIN_CEILING); } }
…
blast(sim, s, I, r.cx, r.cy, 2.2, 22, ev);
recordFall(sim, s, r.cx, r.cy, 2.2, 'ceiling');
```

크레인·산사태(`scenes/major.ts`, `scenes/disaster.ts`)에는 기록을 더하지 않는다. 그 둘은 `s.damage` 와 소품 모습(`craneBoom`, `mud`)으로 그린다.

### 3.4 결과가 바뀌지 않는다는 증명

1. **켜고 끄기 테스트**(§12-1): 같은 시드·같은 조작으로 `RUIN_LOG.on = true` 와 `false` 를 한 번씩 돌려 `logHash`·`report.hash`·`report.counts` 가 같다. 켠 쪽에 기록이 실제로 생겼는지(`ruin` 값 1, `falls` 의 'secondary'·'ceiling')도 함께 확인한다. 앞으로 다른 묶음이 시뮬레이션을 바꿔도 이 테스트가 "기록이 결과에 끼어들지 않는다"를 지킨다.
2. **읽는 곳 검사**(§12-2): `src/sim` 안에서 `.ruin`·`.falls`·`'collapse'`(효과 종류로서)를 쓰는 코드는 `field/ruins.ts` 뿐이다(나머지는 `markRuin`·`recordFall` 호출).
3. **기준값 비교**(§10 의 0단계에서 만들고 끝에 비교): 시드 S1~S4 × {평소, `collapse/std`, `collapse/gasblast`, `fire/std`, `armed/hostage`, `hazmat/std`} + S3 지진 = 25교대의 `logHash`·`report.hash`·`report.counts` 가 한 글자도 같다. `npx tsx scripts/sweep.ts 12` 의 출력이 걸린 시간(`avg …ms/shift`)을 빼고 같다.

---

## 4. 현장 — 붕괴 전·중·후의 시각 언어

### 4.0 색 (지금 팔레트에서 가져온다)

| 쓰임 | 색 | 어디서 온 색 |
|---|---|---|
| 잔해 (낮음 → 높음) | `#57524b` → `#6a645b` → `#8d867a` → `#a59d90` → `#b3aa9a` | 지금의 무너진 자리 조각, `drawDebris` |
| 넘어간 벽 | 몸 `#8f99a3`, 윗면 `#bcc5cd` 에 먼지 `#a59d90` 를 30% 섞은 색(`mix()`) | 벽(`staticLayer` 7단계) |
| 철근 | `#9a5a3a` | 새 색(녹) |
| 내려앉은 바닥 음영 | `rgba(18,14,10, 0.06…0.36)` | 벽 그림자 `#10141a` 계열 |
| 붕괴 구역 경계 | `#d6a878`, 점선, 투명도 0.55 | `TYPE_COLOR.collapse` |
| 먼지 | `rgb(196,178,146)` | 지진 먼지 `rgba(190,172,140)` 와 같은 결 |
| 2차 붕괴 위험 범위 | `#ffd166` 점선 + 바깥 `rgba(8,13,18,0.55)` | 경고 노랑 |
| 진행 고리 | `rgb(255, 200−110·leak, 80)` | 지금의 균열 고리 식 |
| 천장 붕괴(불)의 잔해 | `#2b2118`, `#3a2c20`, 불씨 `#ff9a4a` | 그을음·불티 |
| 흙(산사태) | `#4a3a28`, `#5a4630`, `#7a6246` | `mud` 소품 |

`mix()`·`shade()` 에는 `#rrggbb` 또는 `rgb()` 만 넣는다(`rgba` 금지 — `CLAUDE.md` 함정 "색 계산").

### 4.1 무너진 뒤의 모습 — 고정 층 (`scene/ruins.ts`, `staticLayer` 가 부른다)

`staticLayer.ts` 의 "무너진 자리" 블록(지금 789~804줄)을 `paintRuinFloor(g, s, R, tAt, { rubble, rubbleColors })` 한 줄로 바꾸고, 7단계에서 창·문턱을 그린 반복문 뒤에 `paintRuinWalls(g, s, R, geo.hw)` 한 줄을 더한다. `rubble`·`rubbleColors` 는 인자로 넘긴다(`scene/ruins.ts` 가 `staticLayer.ts` 를 import 하면 서로 부르게 된다). 재질: `s.variant === 'landslide'` 면 흙, `'crane'` 이면 긁힌 땅(밝은 먼지 + 긁힌 자국), 그 밖은 콘크리트.

`paintRuinFloor` — 아래에서 위 순서:

1. **내려앉은 구획의 음영**: `damage` 칸 전체에 `rgba(18,14,10,0.18)`. 그 위에 기울기 — 구역 가장자리에서 서 있는 벽(`T.WALL`)에 더 많이 닿은 쪽을 "받쳐진 높은 쪽", 반대쪽을 "낮은 쪽"으로 보고, 구역 경계 상자에 높은 쪽 0.06 → 낮은 쪽 0.36 의 선형 그러데이션을 `damage` 칸에만 칠한다(칸마다 `fillRect`). 북·서쪽 경계(빛은 왼쪽 위 — 벽 그림자가 +x·+y 로 진다)에는 구역 안쪽으로 0.35칸 폭의 그림자 띠 `rgba(0,0,0,0.35→0)`, 높은 쪽 경계에는 깨진 바닥 끝의 밝은 선 `rgba(220,210,190,0.35)` 한 줄. 위에서 내려다보는 그림에서 "한 단 내려앉아 기울었다"로 읽히게 하는 장치다.
2. **먼지 테두리**: 경계 칸에서 바깥으로 0.6칸까지 `rgba(196,178,146,0.16)` 의 흐린 원 몇 개(자리는 칸 번호 해시 `hash2` — 다시 그려도 같은 그림).
3. **잔해 더미의 높낮이**: 칸마다 높이 `h = min(3, 구역 경계까지의 칸 거리) + (ruin === 1 ? 1 : 0) + (ruin ≥ 16 ? 0.5 : 0) + 해시 0~0.6`. 낮은 칸부터, 위쪽 줄부터 그린다. 칸마다 조각 `3 + 2h` 개(크기 `0.08 + 0.05h` 칸, 색은 높이에 따라 §4.0 잔해 색의 왼쪽→오른쪽), 조각마다 왼쪽 위 밝은 면 `rgba(255,255,255,0.14)` 과 오른쪽 아래 그림자 `rgba(0,0,0,0.28)`(+0.03, +0.04칸). `h ≥ 2.5` 인 칸에는 넓은 판 조각 1~2개(`#9b9488`, 금 한 줄). **높아도 무릎 높이로 보이게** 그림자를 짧게 둔다 — 길을 막는 것은 소품(`drawDebris`, 매 프레임, 짙은 그림자와 나무 막대)이고 바닥 잔해는 지나갈 수 있다.
4. **넘어간 벽**(`ruin === 1`): 원래 벽이 서 있던 줄에 짙은 자국(폭 0.12칸, `rgba(20,16,12,0.5)`, 가장자리 들쭉날쭉). 그 옆, 잔해가 더 많은 쪽으로 0.25~0.45칸 밀린 자리에 쓰러진 벽 판(길이 0.9·두께 0.3칸, 먼지 섞은 벽색의 몸 + 윗면, 해시로 ±10~25° 기울기, 2~3토막으로 끊어 틈을 둔다). 방향은 이웃의 `ruin === 1` 이나 남은 벽이 좌우에 있으면 가로, 위아래에 있으면 세로, 둘 다 없으면 기둥(작은 네모 더미).
5. **깔린 가구**(`ruin ≥ 16`): `rubble(g, 해시, rubbleColors(ruin − 16, x, y))` 를 그리고, 그 위에 회색 조각 4~6개를 흩뿌린다(잔해에 묻힌 가구).
6. **2차 붕괴로 쏟아진 칸**(`ruin === 8`): 3 과 같되 색을 한 단 밝게(`#a59d90` 쪽), 밝은 가루 점 6개 — 새로 쏟아진 잔해.
7. **천장이 내려앉은 칸**(`ruin === 9`, 불난 방): 숯빛 잔해(`#2b2118`·`#3a2c20`)와 탄 서까래 둘(가늘고 긴 막대, 끝에 불씨 점 `#ff9a4a` 하나). 그을음(`drawScorch`)은 그 위에 매 프레임 얹힌다.
8. **치운 자리**: `kind === 'debris' && removed` 인 소품의 칸 — 조각을 칸의 두 변으로 밀어 두고 가운데에 밝은 띠 `rgba(220,210,190,0.12)`(치워서 길을 냈다). 흙이면 흙 얼룩, 크레인 팔이면 긁힌 자국이 남는다.
9. **붕괴 구역 경계**: `damage` 칸과 아닌 칸 사이의 변을 모아 한 경로로, `#d6a878`·투명도 0.55·굵기 `max(1.5, R·0.05)`·점선 `[R·0.28, R·0.18]`. 벽 밑으로 지나는 곳은 그 위에 벽이 그려져 자연히 끊긴다.

`paintRuinWalls` — 벽과 창을 그린 뒤:

1. **부러진 벽 끝**: 남은 벽 칸(`T.WALL`) 가운데 상하좌우 이웃이 `ruin === 1` 인 쪽마다, 벽 가운데에서 그 칸 경계까지 벽 두께(`hw`)의 들쭉날쭉한 끝(지그재그 4~5점)을 벽색으로 잇고, 끝에서 철근 2~3가닥(`#9a5a3a`, 굵기 0.025칸, 길이 0.15~0.25칸, 조금씩 휜다)을 뻗는다. 지금은 남은 벽이 칸 가운데에서 깔끔하게 끝나 "원래 그렇게 생긴 벽"으로 보인다.
2. **금 간 벽**: `damage === 1` 인데 남아 있는 벽 칸 — 윗면에 길이 방향 금(짙은 지그재그 `rgba(20,18,16,0.7)`), 가장자리의 떨어져 나간 홈 두어 개, 윗면에 먼지 `rgba(165,157,144,0.35)`.

`R < 12`(작은 창·축소 보기)이면 조각 수를 1/3 로 줄이고 철근과 금은 그리지 않는다.

### 4.2 무너지기 전 — 2차 붕괴 위험 (매 프레임, `scene/hazardFx.ts` `drawDangerZones`)

보강하지 않은 균열(`unstable`, `!mitigated`)마다:

- **위험 범위**: 반지름 2.6칸 원(= `tickCollapse` 의 `blast` 반경, 무너지면 다치는 범위). 바깥 `rgba(8,13,18,0.55)` 굵기 0.16칸 위에 `#ffd166` 굵기 0.09칸 점선 `[0.32, 0.22]`칸, 점선이 천천히 돈다(`lineDashOffset = −timeMs / 80`) — 통제선 테이프. 투명도는 관찰자 시점 `0.5 + 0.4·leak`, AI 시점 0.7.
- **진행 고리**(관찰자 시점만): 반지름 0.66칸, 위(−90°)에서 시계 방향으로 `leak × 360°`, §4.0 진행 고리 색, 굵기 0.08칸, 밑에 어두운 고리. 지금의 맥박 고리(반지름 0.52)는 AI 시점에서만 남긴다.
- **곧 무너짐**(관찰자 시점, `leak > 0.75`): 균열 둘레 1칸 안에 먼지 알갱이 4개가 떨어진다(0.5칸, 1.2초 주기).
- 보강한 균열: 범위를 그리지 않는다(지지대 그림 `drawUnstable(shored)` 만 — 지금 그대로).
- 보이는 균열은 지금 규칙 그대로: AI 시점은 지휘관이 아는 것(`cmd.beliefs.get('haz', p.id)`)만, 관찰자 시점에서 지휘관이 모르는 것은 투명도 0.55.
- (선택, 관찰자 시점) 불난 방의 천장 붕괴 위험: 탄 칸이 45% 이상이고 아직 판정하지 않은(`!s.collapseDone.has(r.id)`) 방의 경계 상자에 `rgba(214,168,120,0.5)` 점선. 규칙은 55%에서 판정한다(`hazards.ts:106`).

### 4.3 무너지는 순간 (매 프레임, `s.falls` 를 읽는다 — `drawFallMoments`)

`s.falls` 가운데 `age = (sim.t + alpha·sim.dt) − f.t` 가 0~25초인 것마다. 효과 목록(`s.fx`)은 물줄기가 많은 현장에서 60개 상한에 밀려 사라질 수 있으므로 쓰지 않는다. `sim.t` 기준이라 일시정지하면 그 순간에서 멈추고, 스크린샷이 재현된다.

| 시간 | 무엇 | 어떻게 |
|---|---|---|
| 0~0.35초 | 내려앉는 그림자 | 중심 원, 반지름 `r·0.9·(0.5 + 0.5·age/0.35)`, `rgba(10,8,6, 0.45·(1 − age/0.35))` — 떨어지는 천장의 그림자가 커진다 |
| 0~0.5초 | 떨어지는 덩어리 | 7개. 착지점은 반경 `0.8r` 안(해시). 1.2칸 위·1.6배 크기에서 가속하며 내려와 0.45초에 착지(1배), 착지하면 사라진다(고정 층의 새 잔해가 받는다) |
| 0~0.8초 | 먼지 충격 고리 | `rgba(214,200,170, 0.7·(1−k))`, 반지름 0.4칸 → `r`(빠르게 퍼졌다 느려진다), 굵기 `0.12칸·(1−k)`. **멈추는 반지름 = 다치는 범위** |
| 0.1~3초 | 먼지 기둥 | 먼지 덩어리 10개(`fx.ts` 에 `puffSprite(196,178,146)` 을 더한다), 방향은 해시, 거리 `r·(0.2 + 0.9·e)`, 크기 `ts·(1.2 + 2.2·e)`, 투명도 `0.65·(1−k)^1.3`, 위로 0.3칸 떠오른다 |
| 3~25초 | 가라앉는 먼지 | 반지름 `1.1r` 의 흐린 원, `rgba(196,178,146, 0.22·(1 − (age−3)/22))` |
| 0~1.2초 (천장 붕괴만) | 불티 | 8개(`#ff9a4a`·`#ffd27a`)가 튀어 올랐다 떨어진다 |

(`k` = 그 줄의 경과 비율, `e = 1 − (1−k)²`.) 처음 무너진 구역('zone')도 사건이 생긴 순간에 관찰자가 보고 있으면 같은 연출을 받는다.

- 가산 혼합(`'lighter'`)을 쓰지 않는다. 밤의 어둠 층에 구멍도 내지 않는다(`renderScene.ts:488` 은 `flash`·`boom` 만 — 그대로).
- **흔들림**(`fallShake`): 가장 최근의 무너짐이 0.6초 안이면 현장 그림 전체를 `A·(1 − age/0.6)²·(sin(age·97), cos(age·83))` 칸만큼 민다. `A` = 2차 붕괴 0.16칸, 천장 0.1칸, 처음 구역 0.12칸. 지진이 흔들린 직후(`sim.disaster.shakes` 의 마지막에서 0.9초 안)에도 붕괴 현장 0.14칸, 다른 현장 0.08칸. `drawScene` 의 `ctx.translate(L.ox, L.oy)` 바로 뒤에서 한 번 `translate`. 작은 창(`MINI`)은 흔들지 않는다. `matchMedia('(prefers-reduced-motion: reduce)')` 가 참이면 흔들지 않는다(`typeof matchMedia === 'function'` 으로 감싼다 — 테스트 환경에는 없다). 지도는 흔들지 않는다(지금의 지진 규칙 그대로).
- 'collapse' 효과는 그림에 쓰지 않고, 다음 셋이 본다. **카메라** `camera.ts:159` 의 종류 목록에 `'collapse'`(무게는 `boom` 과 같은 2.5). **자동 감속** `Viewport.tsx:65` 의 조건에 `'collapse'`. **소리** `audio.ts`: `else if (f.kind === 'collapse') { if (this.ok('collapse', 0.5)) { this.burst(0.9, 0.3, 220, 0.8, 'lowpass'); this.tone(48, 0.9, 0.25, 'sine', 0, 30); this.burst(0.07, 0.18, 2400, 1.2, 'bandpass', 0.02); } }` — 낮게 우르르 + 짧게 쩍.

### 4.4 무너진 뒤

- 2차 붕괴 칸(`ruin === 8`)은 고정 층이 다시 그려지며 밝은 새 잔해가 된다(`tickCollapse` 가 이미 `staticVersion++` 를 한다). 길을 막는 잔해 소품은 지금처럼 매 프레임.
- 가라앉는 먼지 25초(§4.3).
- 무너진 균열은 `leak` 가 0 으로 돌아가 다시 차오른다(`leakRate × 0.6`). 위험 범위는 계속 그려지고 진행 고리는 처음부터 — "또 무너질 수 있다"가 그대로 보인다.
- 사건 카드·지도 핀에 2차 붕괴가 남는다(§5.4, §6).

### 4.5 천장 붕괴(불)·크레인·산사태

- 천장 붕괴: §4.1-7 + §4.3(반경 2.2, 불티). 불난 방 위에 숯빛 잔해와 먼지가 함께 보인다.
- 크레인(`collapse/crane`): 팔 토막은 소품(`craneBoom`)으로 지금처럼. 팔 밑의 `damage` 칸은 긁힌 땅 — 팔 방향(첫 토막과 끝 토막 `color === 99` 을 잇는 방향)의 긁힌 자국 두 줄과 밝은 먼지. 토막을 치우면 자국이 남는다.
- 산사태(`collapse/landslide`): 흙 재질의 더미. 흙(`mud`)을 치운 자리는 흙 얼룩.

### 4.6 그리는 순서 (`renderScene.ts`, 새 것은 굵게)

**흔들림 `translate`** → 고정 층 → 그을음 → **폭발 자리(§7.3)** → 젖은 바닥 → 무전 음영 → 통제 지점 → 용의자 시야 → 소품 → **2차 붕괴 위험 범위·진행 고리** → 출동 차량 → 통과 차량 → 연기 아래층(**가스는 연두**, §7.1) → **짙은 가스 경계** → 사람(**인질 상태**, §7.4) → 구조 줄 → 불 → **무너지는 순간·가라앉는 먼지** → 나무 수관 → 연기 위층 → 어둠과 빛 → 날씨 → 재난 → 구역 이름·수색% → **되살아난 불(§7.2)** → 진입 지점 → 구조 대상 딱지 → 용의자 표지 → 효과 → **새 글자 표지(가스 고임·되살아난 불)** → 대원 이름표 → 가장자리.

`scene/hazardFx.ts` 의 함수는 글자 표지가 필요하면 `{ x, y, text, color }[]` 를 돌려주고 `renderScene.ts` 가 자기 `pill()` 로 그린다(`renderScene.ts` 를 import 하면 서로 부르게 된다).

### 4.7 현장 그림의 시점 규칙

| 그림 | 관찰자 시점 | AI 시점 |
|---|---|---|
| 무너진 구역·넘어간 벽·잔해(고정 층) | 보인다 | 보인다(겉모습) |
| 2차 붕괴 위험 범위 | 모든 균열(지휘관이 모르는 것은 0.55) | 지휘관이 아는 균열만 |
| 진행 고리, 곧 무너짐 알갱이 | 보인다 | 없다 |
| 무너지는 순간, 흔들림, 먼지 | 보인다 | 보인다 |
| 짙은 가스 경계 + '가스 고임 — 폭발 위험' | 보인다 | 없다 |
| 되살아난 불 | 진실과 믿음이 어긋난 방 | 지휘관이 보고받은 뒤 15초 동안 |
| 인질 상태 | 보인다 | 용의자가 보이는 동안(지금 규칙) |
| 천장 붕괴 위험(선택) | 보인다 | 없다 |

---

## 5. 지도

### 5.1 언제 보이나 — `ruinSeen(sim, I, truth)` (`view/hazardState.ts`)

대상: 유형이 붕괴이고 `I.truth.placeId ≥ 0` 이며 현장(`sim.scenes[I.id]`, 사건이 생길 때 만들어지고 지워지지 않는다)의 `damage` 칸이 하나 이상인 사건. 승강기 갇힘은 `damage` 가 없어 저절로 빠지고, 산사태는 건물이 없어(`placeId = −1`) 빠진다(핀 아이콘만 바뀐다).

| 값 | 관찰자 시점 | AI 시점 |
|---|---|---|
| `'confirmed'` | 사건이 생긴 순간부터(미신고면 흐리게, 투명도 0.55) | 첫 부대가 도착한 뒤(`I.firstArrivalAt ≥ 0`) |
| `'reported'` | — | 분석 유형이 붕괴이고, 신고 위치가 맞고(`I.locationKnown && I.reportedNode === I.truth.nodeId` — 건물 테두리 규칙과 같다), 알아본 변형이 승강기 갇힘이 아닐 때 |
| `'none'` | 그 밖 | 그 밖 |

끝난 사건: 관찰자 시점은 교대 끝까지 `'confirmed'`. AI 시점은 도착했던 사건만 남는다.

### 5.2 건물 크기에 따라 두 가지

`min(q.w, q.h) · xf.scale ≥ 12` 화소면 **건물 덧그림**(§5.3), 아니면 **기호**(§5.4). 배율 1 에서는 거의 모든 건물이 기호다.

### 5.3 건물 덧그림 — `drawRuinsWorld` (`view/city/ruinLayer.ts`)

`renderCity.ts` 월드 층의 `drawDisasterWorld(…)` 바로 뒤(같은 변환 안)에서 `drawRuinsWorld(ctx, sim, { truth: o.truth, timeMs: o.timeMs, scale: xf.scale, mini })` 한 번. 축소 창(`mini`)에서는 그리지 않는다. 건물 회전은 테두리 깜박임 코드(`renderCity.ts:223-231`)처럼 `translate(가운데) → rotate(q.rot)` 뒤 `(−w/2, −h/2)` 좌표로 그린다. `staticCity.ts` 의 `local()` 은 export 되어 있지 않으므로 같은 세 줄을 이 파일에 둔다(`staticCity.ts` 는 고치지 않는다). 색표가 필요하면 이 파일 안에 복사한다(`renderCity.ts` 를 import 하면 서로 부르게 된다).

`ruinInfo(sim, I)` (`hazardState.ts`, 진실. `s.staticVersion` 이 바뀔 때만 다시 계산 — `WeakMap<Scene, …>`):

- `frac` = `damage` 칸 수 / 건물 칸 수(`FLOOR·FURN·DOOR·STAIR·WALL·WINDOW` 칸).
- `u, v` = 무너진 구역 무게중심의 건물 안 상대 위치 0~1. 기준 상자는 무게중심에서 가장 가까운 건물 칸에서 시작해 건물 칸을 따라 넓혀 간 덩어리의 경계 상자(2층 건물은 두 층이 격자에 나란히 놓이므로 한 층만 잡힌다).
- `level` = `frac ≥ 0.22` 이거나 2차 붕괴가 한 번이라도 있으면 `'major'`, 아니면 `'partial'`. 0.22 는 §1.1 분포의 위 1/3 쯤이다. 스크린샷을 보고 조정해도 된다(조정하면 구현 메모에).
- `secondary` = `falls` 의 'secondary' 수, `lastFall` = 마지막 무너짐 시각, `material` = 콘크리트·흙·크레인.

그림(`'confirmed'` 일 때만):

1. **내려앉은 지붕**: 구멍의 넓이 = 지붕의 `clamp(frac × 2.2, 0.3, 0.85)` — **과장**: 실제 몫의 약 두 배(멀리서도 보이게). 가운데는 `((u − 0.5)·w, (v − 0.5)·h)` 를 지붕 밖으로 나가지 않게 당긴 자리. 모양은 14각형(가장자리를 `hash2(q.id, k)` 로 들쭉날쭉하게), 채움 `rgba(16,12,9,0.62)`.
2. **구멍 속 잔해**: 조각 10~18개(§4.0 잔해 색), 구멍 가장자리에 기울어진 지붕 판 3~4개(`rgba(120,116,108,0.9)`, 밝은 윗변).
3. **쏟아진 잔해**: 건물 가운데에서 구멍 쪽 방향으로, 외벽 밖 `0.25·max(w, h)` 안에 조각 5~8개 — 무너진 것이 건물 윤곽 밖까지 넘친다.
4. **지붕의 금**: 구멍에서 지붕을 가로지르는 꺾은선 둘, `rgba(10,8,6,0.55)`, 굵기 `max(0.8, 1.2 / scale)`.
5. **먼지**: 마지막 무너짐 뒤 90초 동안 반지름 `0.9·max(w, h)` 의 흐린 원 `rgba(196,178,146, 0.3 → 0.08)`, 그 뒤 0.08 로 남는다.
6. `'major'` 는 구멍이 커지고(위 식) 구멍에 가장 가까운 외곽선 한 변을 따라 어두운 틈(외곽이 무너졌다).
7. 밤(`sim.weather === 'night'`)에는 색을 `shade(…, −0.35)`. 정전(`d.dark`) 중에도 그대로 보인다.
8. 크레인: 구멍 대신 공사장을 가로지르는 쓰러진 팔(노랑 `#e0b83a` 굵은 선에 격자 눈금, 끝에 갈고리 점)과 먼지.

**무너지는 순간(지도)**: 무너짐(`falls`)마다 6초 동안 건물 위에 먼지가 피어오른다(반지름 `max(w, h)·(0.6 + 0.4k)`, 투명도 `0.45·(1 − k)`). 관찰자 시점은 모든 무너짐(지진이 일으킨 처음 구역 포함 — 진앙 고리와 함께 도시 곳곳에서 먼지가 핀다), AI 시점은 첫 도착 뒤의 무너짐만. 이 먼지는 건물 크기와 무관하게(배율 1 에서도) 그린다.

진행 중인 사건은 핀이 건물 가운데를 가린다. 구멍은 `u, v` 로 한쪽에 치우치므로 핀 옆으로 보이고, 끝난 사건(핀 없음)에서는 온전히 보인다.

### 5.4 기호와 핀 — `drawRuinBadge`, `ruinGlyphAt` (`ruinLayer.ts`)

- **새 기호**(`marks.ts` `RUIN_MARK`): `partial` = 한쪽이 부서진 건물 + 옆의 잔해, `major` = 납작한 잔해 더미 + 기울어진 판. 바탕 없는 실루엣에 어두운 테(경로를 `#0b1219` 굵기 3 으로 먼저 긋고 채운다) — 네모(시설)·원(부대)·핀(사건)과 다른 네 번째 모양. 초안 경로(evenodd, 견본표로 다듬는다 — §11):
  ```ts
  export const RUIN_MARK = {
    partial: 'M2.5 21.5V7.2L9 3L15.5 7.2V10.2L13.6 11.6L15.2 13.4L12.9 15.2L14.3 17.6L12.2 21.5ZM5.2 9.6H7.8V12.2H5.2ZM5.2 14.6H7.8V17.2H5.2ZM9.6 9.6H11.8V12.2H9.6ZM14.6 21.5L16.2 18.1L18.6 19L19.6 17.2L21.6 21.5ZM17.4 14.6L19.6 13.8L20.5 15.8L18.2 16.6Z',
    major: 'M1.5 21.5L3.6 17L6.6 17.9L8.8 14.2L12.2 15.6L14.6 12.4L17.6 15L20 14.2L22.5 21.5ZM9.4 13.4L12.6 5.6L14.6 6.4L11.6 14.2ZM11.2 21L12.2 18.9L11.3 17.5L12.6 16.4L13.3 17.6L12.6 19L13.5 21Z',
  };
  ```
- **진행 중인 사건의 핀 배지**: 핀 몸통을 그린 뒤(`renderCity.ts:297` 의 `drawIcon` 바로 뒤) `drawRuinBadge(ctx, sim, I, x, y, r, o.truth, o.timeMs)` 한 줄. 핀의 왼쪽 아래 `(x − 0.78r, y + 0.78r)` 에 반지름 `0.46r` 의 어두운 원(`#0b1219`), 테 `#d6a878`(굵기 `max(1.5, 0.1r)`), 안에 `RUIN_MARK[level]`(크기 `0.72r`, `#d6a878`). `'reported'` 는 테를 점선으로 하고 기호는 `partial` 을 투명도 0.6 으로(규모를 아직 모른다). 왼쪽 아래는 지금 비어 있다(코드 이름표는 오른쪽 위, 상태 글자는 아래).
- **2차 붕괴 알림**: 마지막 2차 붕괴 뒤 2초 동안 핀에서 흙빛 고리가 퍼지고(`r → r + 28·zs`, `#d6a878`, 투명도 `1 − age/2`, 굵기 3), 배지가 0.6초 동안 1.25배에서 1배로 줄어든다. AI 시점은 첫 도착 뒤의 것만.
- **끝난 사건**: `renderCity.ts:265` 의 분기에서 결과색 점보다 먼저 `const rg = ruinGlyphAt(ctx, sim, I, x, y, zs, xf.scale, o.truth)` 를 부른다. 작은 배율이면 건물 가운데에 `RUIN_MARK[level]`(크기 `11·zs`, 투명도 0.85)을 그리고 `'glyph'` — 그때 결과색 점은 `(x + 6·zs, y − 6·zs)`, 반지름 3.5 로 비켜 그린다. 큰 배율이면 덧그림이 이미 있으므로 `'overlay'`(점은 제자리), 대상이 아니면 `null`.
- **핀 아이콘의 변형**: `pinIcon(I, truth)` — 관찰자 시점은 진실의 변형, AI 시점은 `I.assessment.label` 에 맞는 시나리오(`SCENARIOS` 에서 유형이 같고 `(label ?? name) === as.label` 인 것)의 변형. `elevator`·`crane`·`landslide`·`gasblast` 는 새 아이콘, 그 밖은 지금처럼 유형 아이콘. 신고 통화 중의 전화 아이콘은 그대로. 핀(`renderCity.ts:297`)과 사건 카드의 코드 칩(`panels.tsx:66`)이 같은 함수를 쓴다. `icons.ts` `ICON_PATH` 에 더할 초안:
  ```ts
  elevator: 'M4.5 2H19.5V22H4.5ZM6.5 4V20H17.5V4ZM12 5.8L15.4 10.2H8.6ZM12 18.2L8.6 13.8H15.4Z',
  crane: 'M5 22V7.6H7.6V22ZM2.6 5H21.6V7.6H2.6ZM5.4 2.2H7.2V5H5.4ZM18 7.6H19V13.4H18ZM16.8 13.4H20.2V15.4H16.8ZM2.6 22V20.4H10V22ZM2.6 7.6H5V9.6H2.6Z',
  landslide: 'M2 21.5V6.5L15.5 21.5ZM16.6 15.6A2.4 2.4 0 1 0 16.6 20.4A2.4 2.4 0 0 0 16.6 15.6ZM19.8 10.2A1.9 1.9 0 1 0 19.8 14A1.9 1.9 0 0 0 19.8 10.2ZM10.4 4.6A1.6 1.6 0 1 0 10.4 7.8A1.6 1.6 0 0 0 10.4 4.6Z',
  gasblast: 'M2.5 21.5V10H11.5V21.5ZM4.6 12.4H6.8V14.6H4.6ZM7.6 12.4H9.6V14.6H7.6ZM16.6 1.8L17.8 5.4L21.4 4.4L19.4 7.4L22.4 9.8L18.6 10.2L18.9 14L16.4 11.2L13.8 13.6L14.4 9.8L12.6 9.4L12.6 8.2L14.1 7.1L12.6 3.7L16 5.5Z',
  ```

### 5.5 지진 때

배율 1 에서: 진행 중인 붕괴는 핀 + 배지(관찰자 시점에서는 미신고 핀도 회색 + 배지), 끝난 붕괴는 기호, 무너진 순간마다 건물 위 먼지. 지진은 25초에 걸쳐 사건을 쏟아내므로(`disaster.ts:276-282`) 그동안 진앙 고리와 함께 도시 곳곳에서 먼지가 피고 배지가 늘어난다. AI 시점에서는 신고가 들어온 곳부터 점선 배지가 뜨고 부대가 닿을 때마다 채운 배지로 바뀐다 — "알려진 피해"와 "확인한 피해"가 한눈에 갈린다. 관찰자 시점에서 지진의 충격 단계(`d.phase === 'impact'`)에 처음 나타나는 배지·기호는 0.4초 동안 1.4배에서 1배로 내려앉으며 나타난다. 여진(`tickQuake`)이 금 간 구조물을 흔들면 곧 2차 붕괴 고리가 여러 핀에서 퍼진다.

### 5.6 마우스 정보 (`describeAt`)

`renderCity.ts:382` 뒤에 한 줄: `const rl = ruinLine(sim, q.id, truth); if (rl) lines.push(rl);`. `'confirmed'` 면 `무너짐 — 건물의 약 19%` / `크게 무너짐 — 약 26% · 2차 붕괴 1회`, `'reported'` 면 `붕괴 신고 — 아직 확인 전`. 정보창은 글자라 숫자를 써도 된다.

### 5.7 범례 (`MapLegend.tsx`)

새 묶음 "건물 상태": 일부 무너짐(확인) · 크게 무너짐(확인) · 붕괴 신고(확인 전, 점선 배지) · 2차 붕괴(퍼지는 흙빛 고리). 선택 항목(§7.5·§7.6)을 하면 그 줄도. SVG 는 `RUIN_MARK`·`ICON_PATH` 의 경로를 그대로 쓴다. 핀 아이콘의 변형 넷(승강기·크레인·산사태·가스 폭발)도 사건 묶음에 넣는다.

---

## 6. 사건 카드 — `HazardStrip`

`panels.tsx` `IncidentCard` 의 위험도 줄(`row small`) 바로 뒤에 `<HazardStrip sim={sim} I={I} truth={truth} />` 한 줄(끝난 사건 카드에도 마지막 상태가 보이도록 위험도 줄의 조건 밖에 둔다). 칩은 많아야 넷, 그림 기호 + 짧은 말:

| 칩 | 관찰자 시점 | AI 시점 | 기호 | 색 |
|---|---|---|---|---|
| 붕괴 | `일부 붕괴` / `크게 붕괴` (`ruinInfo`) | 첫 도착 뒤 같은 말 | `RUIN_MARK` | `#d6a878` |
| 2차 붕괴 | `2차 붕괴 n회` | 첫 도착 뒤에 난 것만 | `RUIN_MARK.major` | `#ff5d5d` |
| 균열 | `균열 n · 보강 m` (진실의 `unstable`) | 지휘관 `haz` 믿음 가운데 `s.props[f.id].kind === 'unstable'` 인 것: `value.active` 수 · 보강 수 | `crack` | 남은 균열이 있으면 `#ffd166`, 다 보강했으면 `#5ad17a` |
| 가스 | `가스 누출`, 짙은 칸이 10개 이상이면 `가스 고임 — 폭발 위험` | 지휘관이 아는 새는 밸브가 있으면 `가스 누출` | `gas` | `#d6f06a` / `#ff5d5d` |
| 불 | `불 n곳`(불이 있는 방 수), 되살아난 방이 있으면 `· 되살아남` | 지휘관 믿음 `fire > 0.05` 인 방 수 | `ICON_PATH.fire` | `#ff6b3d` |
| 폭발물 | `폭발물 n · 해체 m · 터짐 k` | 지휘관 `haz` 믿음의 폭발물 | `bombHazard` | `#ff5d5d` / `#5ad17a` |
| 인질 | `인질 붙잡힘 n` / `인질 구출 m` | 지휘관 `hos` 믿음의 `value.hostage` | `hostage` | `#ff5d5d` / `#5ad17a` |

넷을 넘으면 뒤를 뺀다. 우선순위: 2차 붕괴 > 가스 고임 > 인질 > 폭발물 > 붕괴 > 균열 > 불 > 가스 누출. 계산은 `hazardChips(sim, I, truth): HazardChip[]`(`hazardState.ts`, DOM 없음 — 테스트한다, 캐시된 값만 읽는다). `src/ui/HazardStrip.tsx` 는 그 목록을 `<Mark>` 와 글자로 그리기만 한다. `marks.ts` 에 더할 `HAZARD_MARK` 초안(견본표로 다듬는다. `bombHazard` 는 폭발물 처리반 부대 기호(둥근 폭탄)와 헷갈리지 않게 가방 모양):

```ts
export const HAZARD_MARK = {
  crack: 'M3.5 3.5H20.5V20.5H3.5ZM12.6 3.5L10.4 8.4L13.4 11.6L10.6 15.2L12.6 20.5H14L12.3 15.2L15.2 11.6L12.1 8.4L14 3.5Z',
  gas: 'M6.8 19.5A4.3 4.3 0 0 1 5.9 11A5.8 5.8 0 0 1 17.2 9.4A5 5 0 0 1 17.6 19.5Z',
  hostage: 'M12 2.5A3 3 0 1 0 12 8.5A3 3 0 0 0 12 2.5ZM7 21.5V13.5A5 5 0 0 1 17 13.5V21.5ZM7 15.2V17H17V15.2Z',
  bombHazard: 'M3.5 9H20.5V20.5H3.5ZM9 9V5.5H15V9H13.4V7.1H10.6V9ZM12 11.4A3.4 3.4 0 1 0 12 18.2A3.4 3.4 0 0 0 12 11.4ZM11.4 12.4H12.6V15.1H14.4V16.3H11.4Z',
};
```

`styles.css` 끝에 `/* ── legibility ── */` 블록: `.hz-strip`(한 줄, 넘치면 숨김), `.hz`(높이 18, 글자 11, 모서리 6, 1px 테, 기호 11), `.hz.tone-info / .tone-warn / .tone-bad / .tone-ok`(위 색). 기존 규칙은 고치지 않는다.

---

## 7. 같은 꼴의 다른 상태

### 7.1 가스가 찬 범위 (필수)

`gasView(s, tick)` (`hazardState.ts`, `sim.tick` 이 바뀔 때만 다시 계산 — 가스 확산은 1초에 한 번이라 대개 그대로다):

- 가스 누출 현장(`s.kind === 'hazmat'`)에서 불붙은 밸브가 없으면 연기 칸 전부가 가스 — 지금과 같다.
- 그 밖에 새는 밸브(`valve`, `!mitigated && !ignited`)가 있고 가스 규칙이 도는 현장(`kind === 'hazmat'` 또는 `rules` 에 'gas'): 밸브 칸에서 벽이 아닌 칸으로 넓혀 가며 "밸브가 설명하는 농도" `g = leakRate × 0.86^걸음`(연기 확산의 실내 감쇠 0.86 과 같다)을 매기고, `smoke ≥ 0.12` 이고 `g ≥ 0.6 × smoke` 인 칸을 가스로 본다. **근사다**(불 연기·붕괴 먼지와 섞인 칸은 회색으로 남는다).
- `dense` = 실내 칸 가운데 `smoke > 0.6` 인 칸 수, `denseMask` — 시뮬레이션의 폭발 판정과 **같은 식**(`hazards.ts:648-650`). 판정이 불 연기까지 함께 센다는 것을 그대로 보여 준다(규칙은 고치지 않는다).

그림:

- `fx.ts` 의 `smokeLayer`·`drawSmoke` 가 `tint` 대신 `gas: Uint8Array | null` 을 받아 칸마다 가스면 연두 덩어리, 아니면 지금의 회색 덩어리를 쓴다. 연두 덩어리는 지금의 물들이기(`rgba(198,226,92,0.62)` 를 `source-atop`)를 미리 섞은 색 — 옅은 것 `puffSprite(190, 208, 128)`, 짙은 것 `puffSprite(145, 162, 80)`. `source-atop` 물들이기는 지운다. **가스 누출 현장은 지금과 거의 같게 보여야 한다**(전후 스크린샷 F1).
- 짙은 가스 경계(관찰자 시점, 새는 밸브가 있을 때만): `denseMask` 칸과 아닌 칸 사이의 변(틱마다 한 번 선분 목록으로 만들어 둔다)을 `#d6f06a` 점선(굵기 `max(1.5, ts·0.05)`, `lineDashOffset` 이 천천히 흐른다)으로. `dense ≥ 10` 이면 그 무게중심 위에 `'가스 고임 — 폭발 위험'` 표지(빨강 `#ff5d5d`).

### 7.2 되살아난 불 (필수, 작다)

`rekindledRegions(s, cmd)` (틱마다 한 번):

- 관찰자 시점: 실내 방마다 지휘관의 믿음 `cmd.beliefs.val('fire', r.id)` 가 있고 0.05 이하인데 그 방 진실의 `fire` 최대가 0.1 이상이면, 그 방 경계 상자에 `#ff6b3d` 점선 둥근 사각형 + 방 이름 아래 `'다시 붙은 불 — 지휘관은 모름'` 표지(`#ff9a6a`).
- AI 시점: 지휘관의 `fire` 믿음 가운데 글에 '되살아남' 이 든 것(`executor.ts:645` 의 보고)이 15초 안이면 그 방에 같은 점선과 `'잔불 되살아남'` 표지.

### 7.3 폭발 자리 (필수, 작다)

- 터진 폭발물: `skins/crime.ts` 의 `drawBombBag`·`drawBombBox` 가 `p.exploded` 면 지금처럼 `return` 하는 대신 `drawBlastScar(g, p.id, 1)` 을 그리고 끝낸다 — 반지름 0.9칸의 들쭉날쭉한 검은 자국(`rgba(6,5,5,0.75)`), 1.6칸까지 뻗는 방사형 금 6~8줄(`rgba(20,18,16,0.7)`), 찢어진 가방·상자 조각 3~4개. 소품 층(사람 아래)이고 매 프레임이지만 한두 개뿐이다. `drawBlastScar(g, seed, scale)` 는 `scene/hazardFx.ts` 에 두고 `skins/crime.ts` 가 가져다 쓴다.
- 불붙은 밸브(`valve`, `ignited`): `renderScene.ts` 의 밸브 분기에서 밸브를 그리기 전에 같은 자국을 0.6 크기로.
- 가스 용기는 이미 별 모양 자국이 있다(그대로). 2차 붕괴 자리는 고정 층의 새 잔해로 남는다(§4.4).

### 7.4 붙잡힌 인질 (필수, 작다)

`hostageState(sim, s, c)` (`hazardState.ts`). `c.hostage` 이고 그 인질을 붙잡은 용의자(`h.hostageId === c.id`)가:

| 상태 | 조건 | 그림 |
|---|---|---|
| `'held'` | `hold`·`fight` 이고 `hazards.isHeld(sim, s, c.id)` (총, 3.2칸 안, 무력화 아님 — 데리고 나올 수 없다, `executor.ts:527` 과 같은 규칙) | 손을 뒤로(지금) + 빨간 점선(지금) + 인질 발밑에 붉은 고리 하나 |
| `'window'` | `hold`·`fight` 인데 무력화 중(`sim.t < h.stunUntil`) — 구출 기회 | 손을 뒤로 + 점선을 노랑 `#ffd166` 점점선으로, 깜박임 |
| `'guarded'` | `hold`·`fight` 인데 `isHeld` 가 아님(흉기이거나 3.2칸 밖 — 데리고 나올 수 있다) | 손을 뒤로 + 주황 `#ff9f43` 점선 |
| `'freed'` | 그 밖(용의자가 투항·검거·제압·도주, 또는 인질이 걷고 있음) | 보통 자세(`'side'`, 크기 0.96), 선 없음 |

`renderScene.ts:324` 의 `c.hostage && c.where === 'scene'` 두 곳을 `hs !== 'freed'`(`hs` = 그 인질의 상태)로, 344~348줄의 점선을 상태별 색으로 바꾼다. `hazardState.ts` 가 `hazards.isHeld` 를 가져다 쓴다(상태를 바꾸지 않는 읽기 함수다 — 화면 계층이 불러도 된다).

### 7.5 통제된 도로의 원인 (선택)

`trafficLayer.ts` `drawTrafficScreen` 의 진입 금지 원에 원인을 테두리 색으로: 사건이 막은 구간(`I.blockedEdge === e.id`)은 그 사건의 유형색, 재난이 막은 구간(`closedReason === 'disaster'`)은 `#ffb454`. 색표는 파일 안에 복사한다. 범례에 한 줄. T1 의 파일이라 이 한 덩어리만 고친다.

### 7.6 끝난 화재 건물의 그을린 지붕 (선택)

§5.3 과 같은 틀로, 끝난 화재 사건(`placeId ≥ 0`)의 지붕에 그을음 덩어리(넓이 = 지붕의 `clamp(burnedTiles / totalFuelTiles × 1.6, 0.25, 0.9)`, `rgba(14,10,8,0.55)`). AI 시점은 도착했던 사건만. `docs/ROADMAP.md` M2 (1) "사건이 끝난 건물에 흔적"의 화재 몫이다 — 하면 합칠 때 M2 (1)에서 이 부분을 지운다.

---

## 8. 고칠 곳 (파일별)

| 파일 | 고칠 곳 | 무엇 |
|---|---|---|
| `src/sim/types.ts` | `Fx.kind`, `Scene` 끝, 파일 끝 | §3.1 |
| `src/sim/field/ruins.ts` | 새 파일 | §3.2 |
| `src/sim/field/builders.ts` | import 한 줄, `buildCollapse` 657~658줄과 구역 반복문 뒤 한 줄 | §3.3 |
| `src/sim/field/hazards.ts` | import 한 줄, `tickFire` 112·115줄, `tickCollapse` 606·613줄 | §3.3 |
| `src/view/hazardState.ts` | 새 파일 | `ruinInfo`, `ruinSeen`, `ruinLine`, `shownVariant`, `pinIcon`, `gasView`, `rekindledRegions`, `hostageState`, `hazardChips` — 전부 DOM 없는 순수 함수(캐시는 `WeakMap<Scene, …>`) |
| `src/view/scene/ruins.ts` | 새 파일 | `paintRuinFloor`, `paintRuinWalls` (§4.1) |
| `src/view/scene/hazardFx.ts` | 새 파일 | `fallShake`, `drawDangerZones`, `drawFallMoments`, `drawGasEdge`, `drawRekindle`, `drawBlastScar` (§4.2~4.3, §7) |
| `src/view/scene/staticLayer.ts` | `staticSig`, 789~804줄, 7단계 창 반복문 뒤, `rubble` export | §4.1, §9 |
| `src/view/scene/fx.ts` | `sprites()`(먼지·가스 덩어리 셋), `drawSmoke`·`smokeLayer` 의 인자 | §4.3, §7.1 |
| `src/view/renderScene.ts` | 143줄 뒤(흔들림), 148줄 뒤(폭발 자리), 소품 반복문의 균열·밸브 분기, 소품 반복문 뒤(위험 범위), 297~299줄(가스), 연기 뒤(가스 경계), 324·344~348줄(인질), 430줄 뒤(무너지는 순간), 구역 이름 블록 뒤(되살아난 불), 효과 반복문(`'collapse'` 는 그리지 않는다는 주석 한 줄), 이름표 앞(새 글자 표지) | §4.6 의 순서 |
| `src/view/scene/skins/crime.ts` | `drawBombBag`·`drawBombBox` 의 `exploded` 분기 | §7.3 |
| `src/view/city/ruinLayer.ts` | 새 파일 | `drawRuinsWorld`, `drawRuinBadge`, `ruinGlyphAt` (§5.3~5.5) |
| `src/view/renderCity.ts` | 143줄 뒤, 265~269줄, 297줄(아이콘 + 배지), 382줄 뒤 | §5 |
| `src/view/icons.ts` | `ICON_PATH` 넷 | §5.4 |
| `src/view/marks.ts` | `RUIN_MARK`, `HAZARD_MARK` | §5.4, §6 |
| `src/view/camera.ts` | 159줄 종류 목록 | §4.3 |
| `src/ui/Viewport.tsx` | 65줄 조건 | §4.3 |
| `src/view/audio.ts` | 효과 반복문에 한 분기 | §4.3 |
| `src/ui/HazardStrip.tsx` | 새 파일 | §6 |
| `src/ui/panels.tsx` | `IncidentCard`: 66줄 아이콘을 `pinIcon`, 위험도 줄 뒤 한 줄 | §5.4, §6 |
| `src/ui/MapLegend.tsx` | "건물 상태" 묶음, 사건 아이콘 넷 | §5.7 |
| `src/ui/styles.css` | 끝의 `/* ── legibility ── */` 블록 | §6 |
| `src/view/city/trafficLayer.ts` | (선택) `drawTrafficScreen` 의 진입 금지 원 | §7.5 |
| `tests/legibility.test.ts` | 새 파일 | §12 |

공용 파일에서 적힌 곳 밖을 고쳐야 했으면 보고에 파일·함수·이유를 적는다(`docs/specs/README.md` §2).

---

## 9. 성능 예산과 고정 층 다시 그리기

**기준**(`README.md` "프레임 속도"): 그래픽 가속 없는 헤드리스 브라우저에서 도시 지도 60FPS, 보통 현장 44~58FPS, 불과 안개가 겹친 큰 현장 33FPS.

**예산**: 같은 주소·같은 틱에서 일시정지한 화면을 5초 둔 뒤의 FPS(상단 `N FPS · 틱 N`)가 고치기 전보다 2 이상 떨어지지 않는다. 큰 현장(가스 폭발: 불 + 연기 + 붕괴 — 스크린샷 B3)은 31FPS 이상. (일시정지 화면의 FPS 로 비교하는 방법이 이 환경에서 쓸 만한지는 확인하지 않았다 — 값이 흔들리면 같은 장면을 세 번 재어 가운데 값을 쓴다.)

**매 프레임 더하는 일**(붕괴 현장 한 프레임에 합쳐 1ms 이하를 목표):

- 현장: 균열마다 원 두세 개, 0~25초 안의 무너짐(보통 0~2개)마다 먼지 10~12개, 가스 경계는 틱마다 만들어 둔 선분을 긋기만, 되살아난 불은 틱마다 한 번 계산, 폭발 자리는 소품 수만큼. **칸 600개를 도는 반복을 매 프레임 새로 더하지 않는다**(가스 판정·되살아난 불은 틱 캐시).
- 지도: 붕괴 사건마다(지진이라도 16건 이하) 덧그림 경로 40번 안팎 또는 기호 하나. `ruinInfo` 는 `staticVersion` 이 바뀔 때만 다시 센다.
- 카드: `hazardChips` 는 캐시된 값만 읽는다.

**고정 층 서명** — `staticSig` 를 이렇게 바꾼다:

```ts
const ruin = s.ruin;
for (let i = 0; i < s.tiles.length; i++) h = Math.imul(h ^ (s.tiles[i] + s.decor[i] * 16 + s.damage[i] * 512 + (ruin ? ruin[i] * 1024 : 0)), 16777619);
for (const p of s.props) if (p.kind === 'debris' && p.removed) h = Math.imul(h ^ (p.id + 77), 16777619);      // 치운 자리(§4.1-8)
// 보강된 균열 항은 뺀다: 지지대는 매 프레임 그려 고정 층과 무관하다. 지금은 보강할 때마다(executor.ts:608 의 staticVersion++) 쓸데없이 통째로 다시 그린다
```

**다시 그리는 때**: 처음 볼 때, 2차 붕괴·천장 붕괴(이미 `staticVersion++`), 잔해를 치울 때(`executor.ts:216, 886` — 이미 `staticVersion++`), 창·가구 파손(N7). 문이 열리거나 균열을 보강할 때는 서명이 같아 다시 그리지 않는다.

**다시 그리는 비용**: 가장 크게 확대했을 때(칸당 96화소, 2880×1920) `buildStatic` 이 60ms 이하(N7 이 잰 지금 값 16~40ms). 재는 법: 작업 중에만 `renderScene.ts` `getStatic` 의 `buildStatic` 호출을 `performance.now()` 로 감싸 콘솔에 찍고(경고·정보 수준 — 오류로 찍지 않는다), 확인한 뒤 지운다. 넘으면 `R ≥ 64` 에서 조각 수를 줄인다.

---

## 10. 구현 순서

필수는 0~7 단계(§7.1~7.4 포함). 선택: §7.5, §7.6, §4.2 의 천장 붕괴 위험. 시간이 모자라면 선택을 빼고 보고에 적는다. 단계마다 `npx tsc --noEmit` 을 통과시키고 작은 커밋을 남긴다(`wf/legibility` 에만, 푸시하지 않는다).

**0. 기준값** (아무것도 고치기 전)

```bash
git checkout -b wf/legibility
npx tsx <scratchpad>/hashes.ts > <scratchpad>/hash-before.txt
npx tsx scripts/sweep.ts 12 | sed 's/avg [0-9]*ms\/shift//' > <scratchpad>/sweep-before.txt
```

`hashes.ts`(저장소 밖에 둔다. `<작업 폴더>` 는 절대 경로로):

```ts
import { Sim } from '<작업 폴더>/src/sim/engine';
import { NORMAL } from '<작업 폴더>/src/sim/difficulty';
const forces = [null, 'collapse/std', 'collapse/gasblast', 'fire/std', 'armed/hostage', 'hazmat/std'];
for (const seed of ['S1', 'S2', 'S3', 'S4']) for (const force of forces) {
  const sim = new Sim(seed, NORMAL, 1200, { force }); sim.runToEnd();
  console.log(seed, force ?? '-', sim.logHash.toString(16), sim.report?.hash, JSON.stringify(sim.report?.counts));
}
{ const sim = new Sim('S3', { ...NORMAL, disaster: 'quake' }, 1200); sim.runToEnd(); console.log('S3 quake', sim.logHash.toString(16), sim.report?.hash); }
```

고치기 전 화면도 §11 의 표대로 찍어 둔다(나중에 짝지어 비교).

**1. 기록 필드** (§3) — 확인: `npx vitest run tests/legibility.test.ts -t 기록`(§12-1·2 를 `describe('기록 …')` 아래에 둔다), `hashes.ts` 를 다시 돌려 `diff` 가 비어 있다, `sweep 12` 도 같다.

**2. 현장 고정 층** (§4.1, §9 의 서명) — 확인: §12-3·4·6, 스크린샷 A1~A3. 무너진 자리가 "얼룩"이 아니라 "벽이 넘어가 잔해가 쌓이고 바닥이 내려앉은 구획"으로 읽히는지.

**3. 현장 매 프레임** (§4.2~4.4, 흔들림, 카메라·감속·소리) — 확인: 스크린샷 A4~A7·B2, 콘솔 오류 0. 2차 붕괴가 폭발로 보이지 않는지(주황 빛이 없는지).

**4. 지도** (§5) — 확인: §12-5, 스크린샷 C1~C5. 배율 1 에서 무너진 건물이 몇 채인지 셀 수 있는지, 끝난 붕괴가 남는지.

**5. 카드** (§6) — 확인: §12-5, 스크린샷 D1.

**6. 다른 상태** (§7.1~7.4, 선택 §7.5·7.6) — 확인: §12-7·8, 스크린샷 B1·E1~E3·F1.

**7. 마무리** — FPS·다시 그리는 시간(§9), 견본표(§11), `hashes.ts`·`sweep 12` 다시 비교, `npx vitest run tests/legibility.test.ts tests/destruction.test.ts tests/ext.test.ts`, 끝에 `npm run check` 한 번(오래 걸린다 — 여러 작업이 함께 돌면 마지막에만), 이 문서 끝의 구현 메모.

---

## 11. 화면 확인 절차

준비: `npx vite --port 5212 --strictPort` 를 띄운다. 찍는 스크립트(`<scratchpad>/g4-shots.cjs`)와 그림은 저장소 밖에 둔다. 이 환경에서는 `require('playwright')` 가 풀리고 `chromium.launch()` 가 된다(브라우저는 `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` — 확인함). `scripts/screenshot.cjs` 는 `?force=`·특정 틱·지도 확대를 못 하므로 쓰지 않고 고치지도 않는다.

스크립트가 할 일:

- 창 1600×900(`deviceScaleFactor` 1, 확대 장면은 2 로 한 번 더). 콘솔 `error` 와 `pageerror` 를 모두 모은다 — **장면마다 0건**.
- 틱 읽기: 상단 `.meta .dim` 글자의 `/틱 (\d+)/`.
- `runTo(T)`: `4`(15배속) → 40ms 마다 틱을 읽다가 `T − 40` 에서 `1`(1배속) → `T` 에서 `Space`(일시정지) → 300ms 기다려 찍는다. 그림은 `sim.t` 기준이라 일시정지하면 그 순간이 그대로 남는다.
- 현장 보기: `page.locator('.card.incident', { hasText: <글자> }).filter({ hasText: '현장 대응' }).first().click()`. 현장의 자동 확대를 끄려면 `z` 를 누르고 캔버스를 두 번 눌러(`dblclick`) 전체 보기로, 확대는 캔버스 위 `page.mouse.wheel(0, −120)`.
- 지도에서 한 사건: 아직 현장 대응이 아닐 때 그 카드를 누르면 지도 모드로 그 사건에 고정된다 → 캔버스(`page.locator('canvas').first()`) 가운데에서 휠. 고정은 사건이 끝난 뒤에도 남으므로 그대로 시간을 보내 끝난 뒤를 찍는다. 지도 전체는 `c`. AI 시점은 `t`.
- 가스 폭발 카드의 제목은 '가스 폭발'(시나리오 이름)이라 '붕괴' 글자가 없을 수 있다 — 글자 대신 사건 코드나 '가스 폭발' 로 찾는다.

장면(시각은 **지금 코드 1ca465d 에서 잰 것**. 다른 묶음이 시뮬레이션을 바꿨으면 아래 `find.ts` 로 다시 찾는다):

| ID | 주소 | 틱 (시각) | 보는 것 |
|---|---|---|---|
| A1 | `?seed=S6&force=collapse/std` | 500 (100초) — 강제 사건(I1, 심각도 3, 단독주택)에 첫 도착 90초 | 현장 전체: 붕괴 구역 경계(흙빛 점선), 내려앉은 음영과 기울기, 넘어간 벽 판과 자국, 부러진 벽 끝·철근, 잔해 높낮이, 깔린 가구, 위험 범위 원 둘, 진행 고리 |
| A2 | 같은 | 500, `t` | AI 시점: 진행 고리 없음, 지휘관이 모르는 균열의 범위 없음 |
| A3 | 같은 | 500, 구역 위에서 휠 4번(×2 배율로도) | 고해상도 층에서 철근·금·조각이 깨끗한가, 칸 이음새가 보이지 않는가 |
| A4~A6 | 같은 | 661 · 663 · 667 (132.2 · 132.6 · 133.4초) — 2차 붕괴 132초 | 그림자 → 덩어리·고리 → 먼지 기둥. 주황 빛 없음 |
| A7 | 같은 | 700 (140초) | 밝은 새 잔해, 가라앉는 먼지, 진행 고리가 처음부터 |
| B1 | `?seed=S3&force=collapse/gasblast` | 550 (110초) — 첫 도착 68초 | 밸브 둘레만 연두, 불 연기는 회색, 짙은 가스 경계 |
| B2 | 같은 | 576 (115.2초) — 천장 붕괴 115초 | 숯빛 잔해·불티·먼지 |
| B3 | 같은 | 642 (128.4초) — 2차 붕괴 128·156초. 일시정지 5초 뒤 | 2차 붕괴 + **FPS 읽기**(§9, 고치기 전과 비교) |
| C1 | `?seed=S3&disaster=quake` | 2700 (540초) — 지진 532초 | 지도 전체: 진앙 고리, 붕괴 핀의 배지, 건물 위 먼지 |
| C2 | 같은 | 2700, `t` | AI 시점: 점선 배지(신고)와 채운 배지(도착)가 갈린다 |
| C3 | 같은 | 지진 직후 붕괴 카드 하나를 눌러 지도에 고정 → 휠 6번 → 3400 (680초) — 여진 672초 | 확대: 지붕 구멍·쏟아진 잔해·금·먼지, 2차 붕괴 고리 |
| C4 | 같은 | 5750 (1150초) | 지도 전체: 끝난 붕괴의 기호가 남고 결과색 점이 비켜 있다 |
| C5 | 같은 | 5750, C3 의 확대 그대로 | 끝난 건물의 덧그림 |
| D1 | A1·C1 때 | — | `.card.incident` 를 하나씩 찍는다(`locator.screenshot()`): 붕괴·균열·2차 붕괴 칩 |
| E1 | `?seed=S3&force=armed/hostage` | 700 (140초) / 900 (180초) — 인질을 끌고 물러남 128초, 투항 173초 | 붙잡힘(빨간 점선, 손 뒤) → 투항 뒤 풀려남(보통 자세, 선 없음) |
| E2 | `?seed=S2&force=fire/std` | 880~945 (176~189초) — '다시 번지고 있습니다' 189초 | 관찰자 시점의 '다시 붙은 불' 점선·표지, 보고 뒤 AI 시점 표지 |
| E3 | `?seed=S1&force=armed/bomb` | 760 (152초) — '해체 완료' 약 146초 | 해체된 장치(지금 그대로인지만 본다). 터진 장치는 시드 넷에서 한 번도 나오지 않아 그림 함수 테스트(§12-4)로 대신한다 |
| F1 | `?seed=S2&force=hazmat/std` | 400 (80초) — 시각은 재지 않았다. 가스가 퍼져 있는 때로 | 가스 누출 현장이 고치기 전과 거의 같다 |

그리고 **교대 하나를 끝까지**: `?seed=S3&disaster=quake` 를 15배속으로 끝날 때까지(보고서 창이 뜰 때까지) 돌리며 중간에 붕괴 현장 두 곳을 열어 본다 — 콘솔 오류 0건.

**견본표**: `RUIN_MARK` 둘, `HAZARD_MARK` 넷, 새 `ICON_PATH` 넷을 지름 10·12·16·24 화소로, 지도 바탕 `#1a222b` 와 카드 바탕 위에 늘어놓은 독립 HTML 한 장(`deviceScaleFactor: 2`). 12 화소에서 헷갈리는 쌍이 없을 때까지 고친다 — 특히 `RUIN_MARK.partial` ↔ 지금의 붕괴 아이콘, `crack` ↔ `hazmat`(마름모), `bombHazard` ↔ 폭발물 처리반 기호, `landslide` ↔ `RUIN_MARK.major`.

**시각 다시 찾기** — `<scratchpad>/find.ts`:

```ts
// npx tsx find.ts collapse/std S1,S2,S3 400 '2차 붕괴|천장 일부|현장 도착'
import { Sim } from '<작업 폴더>/src/sim/engine';
import { NORMAL } from '<작업 폴더>/src/sim/difficulty';
const [force, seeds, until, pat] = process.argv.slice(2);
for (const seed of seeds.split(',')) {
  const sim = new Sim(seed, NORMAL, 1200, { force });
  while (sim.t < +until && !sim.ended) sim.step();
  const I = sim.incidents.find((q) => Math.abs(q.createdAt - 15) < 0.5);      // 강제 사건은 15초에 생긴다
  if (!I) { console.log(seed, '없음'); continue; }
  const ev = sim.events.filter((e) => e.incidentId === I.id && new RegExp(pat).test(e.text));
  console.log(seed, `I${I.id} ${I.truth.variant} 심각도${I.truth.severity} ${I.truth.placeKind}`, ev.map((e) => `틱${Math.round(e.t / 0.2)}:${e.text.slice(0, 20)}`).join(' | '));
}
```

지진·재난의 시각은 `npx tsx scripts/sweep.ts 1 --disaster quake --log S3 | grep -E '지진 발생|여진|무너졌습니다'`(기록의 시계 − 교대 시작 시계 = 초, 틱 = 초 × 5). 브라우저도 교대 길이 1200 이므로 같은 시드·같은 조건이면 기록과 화면의 시각이 같다(재난은 `?disaster=` 만 주면 난이도는 보통).

보고에 "고치기 전 → 고친 뒤" 그림 경로를 짝지어 적는다.

---

## 12. 테스트 (`tests/legibility.test.ts`)

1. **기록은 결과를 바꾸지 않는다**(켜고 끄기). 조건마다 `RUIN_LOG.on` 을 켜고 한 번, 끄고 한 번(끝나면 반드시 켜 둔다 — `try/finally`):
   - `collapse/std`, 시드 셋: `new Sim(seed, NORMAL, 600, { force })` 를 16초까지 돌린 뒤 그 사건 현장의 `unstable` 의 `leak` 를 모두 0.97 로 올리고(두 번 모두 같은 조작) 끝까지.
   - `fire/std`, 시드 넷: 40초에 그 현장에서 가장 큰 실내 방의 칸을 모두 `burned = 1` 로(두 번 모두 같게) — 천장 붕괴 판정이 돈다(55% 확률이라 시드 넷 가운데 하나 이상에서 일어나는지 본다).
   - 기대: 켠 것과 끈 것의 `logHash`, `report.hash`, `JSON.stringify(report.counts)` 가 같다. 켠 쪽에서 `ruin` 에 1 이 있는 현장, `falls` 에 'secondary' 와 'ceiling' 이 각각 하나 이상. 끈 쪽에는 `ruin`·`falls` 가 없다.
2. **읽는 곳**: `src/sim` 의 모든 `.ts` 를 주석을 뺀 채 읽어(`tests/sim.test.ts` 의 `Math.random` 검사와 같은 방식) — (a) `.ruin`·`.falls` 라는 글자가 `field/ruins.ts` 밖에 없다(`builders.ts`·`hazards.ts` 에는 `markRuin(`·`recordFall(` 호출만). (b) 효과 종류 `'collapse'` 를 대입하거나 비교하는 줄(`kind: 'collapse'`, 또는 `fx`·`f.kind` 와 `'collapse'` 가 한 줄에 있는 것)이 `field/ruins.ts` 밖에 없다. 사건 유형 비교(`s.kind === 'collapse'`, `type === 'collapse'`)는 많으므로 잡지 않는다 — 정규식은 구현하며 맞춘다.
3. **고정 층 서명**: (a) `destruction.test.ts` 의 `room()` 처럼 손으로 만든 현장에서 `markRuin` 한 번 → `staticSig` 가 바뀐다. (b) 같은 현장에 `unstable` 을 놓고 `mitigated = true` → 서명이 **그대로**. (c) `debris` 소품을 `removed = true` → 바뀐다. (d) `createIncident(sim, { type: 'collapse', variant: 'std', … })` 의 현장에서 균열 하나의 `leak = 0.999` → `tickCollapse` 한 번 → 서명이 바뀌고, 새 잔해 칸의 `ruin === 8`, `falls` 끝이 'secondary', `fx` 끝이 'collapse'.
4. **그림 함수가 예외 없이 돈다**(가짜 캔버스). Node 에는 캔버스가 없으므로 이 파일 안에서 흉내 낸다:
   ```ts
   function fakeCtx(): CanvasRenderingContext2D {
     const grad = { addColorStop() {} };
     const t: Record<string, unknown> = {
       canvas: { width: 300, height: 150 }, measureText: (s: string) => ({ width: s.length * 6 }),
       getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), getLineDash: () => [],
       createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}),
       createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
       getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
     };
     return new Proxy(t, { get: (o, k) => (k in o ? o[k as string] : () => undefined), set: (o, k, v) => { o[k as string] = v; return true; } }) as never;
   }
   (globalThis as any).Path2D = class { rect() {} moveTo() {} lineTo() {} arc() {} ellipse() {} closePath() {} quadraticCurveTo() {} bezierCurveTo() {} addPath() {} };
   (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }) };
   ```
   (돌려 보지 않은 초안이다 — 처음 돌릴 때 빠진 메서드·속성을 더한다.) 그리고: 붕괴 현장(`collapse/std`·`gasblast`·`crane`·`landslide`)마다 `buildStatic(s, 12, I.truth.district)`·`buildStatic(s, 96, I.truth.district)`, `s.falls` 에 지금 시각의 무너짐을 하나 넣은 뒤 `drawScene(ctx, sim, s, 1200, 800, …)` 을 관찰자·AI·작은 창·확대(`cam: { x: 15, y: 10, zoom: 2 }`)로, `armed/bomb` 현장에서 장치를 `exploded = true` 로 바꿔 `drawScene`, `drawCity` 를 사건 단계(미신고·출동·현장·종료)와 배율(1·4)을 바꿔 가며 — 모두 예외 없이 끝난다.
5. **시점 규칙**(순수 함수): 도착 전 `ruinSeen(…, false) === 'none'`(신고 위치가 틀리면 분석 유형이 붕괴여도 `'none'`), `ruinSeen(…, true) === 'confirmed'`. 승강기 갇힘은 둘 다 `'none'`. `hazardChips(…, false)` 는 도착 전 붕괴·균열 칩이 없고, 지휘관이 모르는 균열을 세지 않는다. `pinIcon`: 진실 `elevator` → 'elevator', AI 시점에서 `as.label === '승강기 갇힘'` → 'elevator', `label` 이 없으면 'collapse'.
6. **기록의 일관성**: `collapse/std` 현장 열 개 — `ruin === 1` 이거나 `ruin ≥ 16` 인 칸은 모두 `T.FLOOR` 이고 `damage === 1`. 열 개 가운데 `ruin === 1` 이 있는 현장이 하나 이상. 가스 폭발 현장도 같은 기록을 갖는다.
7. **가스**: 불붙은 밸브가 없는 가스 누출 현장에서 `gasView` 의 가스 칸 = `smoke ≥ 0.06` 인 칸. 가스 폭발 현장의 새는 밸브 칸은 가스. `dense` 가 같은 상태에서 `hazards.ts` 의 판정 식으로 센 값과 같다.
8. **인질**: 손으로 만든 무장 현장에서 용의자 `hold`·총·2칸 → `'held'`, `stunUntil` 를 미래로 → `'window'`, 흉기로 → `'guarded'`, `surrendered` → `'freed'`.

---

## 13. 완료 조건

- 결과 불변: §3.4 의 셋 — 켜고 끄기 테스트, 읽는 곳 검사, 기준값 25교대와 `sweep 12` 가 전후로 같다.
- `npx tsc --noEmit`, `npx vitest run tests/legibility.test.ts tests/destruction.test.ts tests/ext.test.ts` 통과, 마지막에 `npm run check` 통과.
- 화면: §11 의 장면을 모두 찍어 눈으로 보고, "보는 것"이 보인다. 고치기 전 그림과 짝지어 보고에 적는다. 장면마다 그리고 교대 하나를 끝까지 돌리는 동안 콘솔 오류 0건.
- 배율 1 의 지도(C1)에서 무너진 건물의 수를 핀 배지와 기호만으로 셀 수 있다. 끝난 붕괴가 교대 끝까지 남는다(C4).
- 2차 붕괴가 폭발처럼 보이지 않는다(A4~A6 에 주황 빛이 없다).
- FPS·고정 층 시간이 §9 의 예산 안이다(측정값을 보고에).
- 지도·목록·범례에 새 글자 표식이 없다. 새 기호는 범례에 있다. 견본표 그림 경로를 보고에.
- 이 문서 끝에 구현 메모(설계와 달라진 점, 조정한 값).

---

## 14. 고칠 파일 목록

| 파일 | 종류 |
|---|---|
| `src/sim/field/ruins.ts` | 새로 |
| `src/view/hazardState.ts` | 새로 |
| `src/view/scene/ruins.ts` | 새로 |
| `src/view/scene/hazardFx.ts` | 새로 |
| `src/view/city/ruinLayer.ts` | 새로 |
| `src/ui/HazardStrip.tsx` | 새로 |
| `tests/legibility.test.ts` | 새로 |
| `src/view/scene/staticLayer.ts`, `src/view/scene/fx.ts`, `src/view/icons.ts`, `src/view/marks.ts`, `src/view/audio.ts`, `src/ui/MapLegend.tsx` | 이 묶음이 맡는다 |
| `src/sim/types.ts`, `src/sim/field/builders.ts`, `src/sim/field/hazards.ts` | 공용 — §3 의 자리만 (결과 불변) |
| `src/view/renderScene.ts`, `src/view/renderCity.ts`, `src/view/camera.ts`, `src/view/scene/skins/crime.ts`, `src/ui/panels.tsx`, `src/ui/Viewport.tsx`, `src/ui/styles.css` | 공용 — §8 의 자리만 |
| `src/view/city/trafficLayer.ts` | 선택(§7.5) |

---

## 15. 알려진 위험

1. **결과가 바뀐다** — 기록용 쓰기 자리에서 실수로 난수 호출의 순서나 조건을 바꾸는 것(특히 `tickFire` 의 `s.rng.range(9, 14)` 를 괄호 안팎으로 옮기는 것). 켜고 끄기 테스트와 기준값 비교가 잡는다. 바뀌면 그 커밋을 되돌리고 다시 쓴다(값을 맞추려고 다른 곳을 고치지 않는다).
2. **효과 종류를 바꿨다** — 2차 붕괴가 `'boom'` 대신 `'collapse'` 를 남기므로 폭발 그림·밤의 빛 구멍(`renderScene.ts:488`)·`boom` 소리가 더는 나지 않는다(의도). 카메라·자동 감속·소리는 `'collapse'` 를 넣지 않으면 2차 붕괴를 놓친다 — 세 곳을 함께 고친다.
3. **효과 목록의 60개 상한** — 물줄기가 많은 현장에서 'collapse' 효과가 밀려 카메라·소리가 놓칠 수 있다. 그림은 `falls` 로 그리므로 놓치지 않는다.
4. **화면이 어지러워진다** — 붕괴 경계·위험 범위·가스 경계·글자 표지가 겹친다. AI 시점은 수치를 빼서 가볍게, 작은 창은 세부를 빼고, 스크린샷으로 판단해 투명도를 내린다. 흔들림은 0.6초·0.16칸 이하, 동작 줄이기 설정이면 없다.
5. **지도의 구멍 자리는 근사다** — 현장 평면은 지도의 건물 외곽과 무관하게 만든다(`README.md` 알려진 문제). 상대 위치(`u, v`)로 옮길 뿐이고, 넓이는 두 배쯤 과장한다. 나중에 M2 (2)(지도 외곽과 현장 평면 맞추기)를 하면 다시 본다.
6. **가스 판정은 근사다** — 가스와 불 연기가 같은 배열이라 섞인 칸을 나눌 수 없다. 칠하는 범위는 "밸브가 설명하는 몫"으로 어림하고, 폭발 위험 표지만 시뮬레이션의 판정 식 그대로다(그 식이 불 연기도 세는 것은 규칙의 성질이다 — 이 묶음은 고치지 않는다).
7. **장면의 시각이 바뀐다** — §11 의 시드·틱은 1ca465d 에서 잰 것이다. 시뮬레이션을 바꾸는 묶음(B1·B3·H1·R2 등)이 먼저 합쳐지면 달라진다 — `find.ts` 로 다시 찾는다.
8. **가짜 캔버스는 예외만 잡는다** — 그림이 맞는지는 스크린샷으로만 안다.
9. **AI 시점의 새는 정보** — 도착 뒤 무너진 정도(`frac`)는 진실에서 센다(겉모습은 모두가 본다고 친다). 그 밖의 수치가 AI 시점에 새지 않는지 §12-5 가 본다.
10. **기호가 헷갈린다** — 경로는 초안이다. 견본표로 고친다.
11. **화면 자동 테스트(Q1)와 겹침** — Q1 이 먼저 합쳐져 가짜 캔버스나 찍는 도구를 저장소에 두었으면 그것을 쓴다(같은 것을 둘 만들지 않는다).

---

## 16. 다른 설계서와의 경계

- 같은 시기에 쓰인 설계서 R1(`R1-crews.md`)·R2(`R2-methods.md`)·H1(`H1-injuries.md`)과 만나는 곳(모두 합칠 때 양쪽을 살린다):
  - `renderScene.ts` 사람 그리기: 이 묶음은 인질 자세 두 조건(324줄)과 인질 점선(344~348줄)만 고친다. H1 이 바로 아래 구조 대상 그림(328줄 근처)과 효과 반복문의 `'hit'`(634~637줄)을, R2 가 구조 줄 블록과 `sprites.ts` 를 고친다 — 이 묶음은 구조 줄(414~427줄)·`sprites.ts` 를 건드리지 않는다.
  - `hazards.ts` `tickCollapse`·`tickFire` 의 천장 붕괴: H1 이 같은 자리에서 피해의 원인(crush)과 "무너진 자리 곁의 구조 대상이 갇힌다"를 더한다(결과가 바뀌는 변경). 이 묶음의 줄은 기록 한 줄씩이라 둘 다 들어가면 된다. H1 이 먼저 합쳐지면 §11 의 시각을 `find.ts` 로 다시 찾는다.
  - `types.ts` `Scene` 끝: R1·H1 도 칸을 더한다 — 추가만이므로 모두 살린다.
  - R2 의 테이저·비살상탄은 `stunUntil` 로 용의자를 무력화하므로 인질의 `'window'`(§7.4)가 따로 고치지 않아도 잡힌다. R2 가 붕괴 현장에 새 임무를 더하면 그 임무의 그림은 R2 의 몫이다.
- 앞으로 시뮬레이션에 벽·건물을 무너뜨리는 규칙(바깥 벽이 무너짐, 건물 전체 붕괴, 폭발이 벽을 부숨 등)을 더하는 묶음은 상태를 바꾸는 바로 그 자리에서 `markRuin`·`recordFall` 을 부르면 이 묶음의 그림(고정 층의 잔해·넘어간 벽, 무너지는 순간, 지도의 덧그림·배지, 카드 칩)을 그대로 얻는다. 그때 `FallRecord.cause` 와 `ruin` 값은 추가만 한다(기존 값의 뜻을 바꾸지 않는다). §4.1 의 부러진 벽 끝은 바깥 벽 두께(`hw` 0.27)도 받도록 만든다. 그런 묶음이 `tickCollapse`·`tickFire` 의 같은 줄을 고치면 합칠 때 양쪽을 살린다.
- 교전 연출을 고치는 묶음과는 `renderScene.ts` 의 효과 반복문(598~647줄)에서 만난다. 이 묶음은 그 반복문에 `'collapse'` 분기(그리지 않는다는 주석) 한 줄만 더한다.
- `docs/ROADMAP.md` M2 (1) "사건이 끝난 건물에 흔적"의 붕괴 몫은 이 묶음이 한다(§5). 화재 몫은 선택(§7.6). 같은 건물의 재발은 M2 에 남는다.
- 합칠 때 `docs/specs/README.md` 의 표에 한 줄(`G4-scene-legibility.md` · 화면 가독성 · `wf/legibility` · "무너진 건물·가스·되살아난 불·폭발 자리·인질이 한눈에")을 더하고, `README.md` 의 기능 목록·테스트 수와 `CLAUDE.md` 구조 절에 새 파일을 적는다(이 묶음에서는 고치지 않는다).

---

## 구현 메모

(구현한 뒤 이 절에 설계와 달라진 점, 조정한 값, 잰 값을 적는다. 이 절이 실제 코드와 맞는 최신 내용이 된다.)
