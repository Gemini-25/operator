# N4b — 강력 범죄

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/crime`, 개발 서버 포트 **5201**.

**자기 파일**: `src/sim/scenarios/crime.ts`, `src/sim/field/scenes/crime.ts`, `src/sim/field/rules/crime.ts`, `src/sim/field/orders/crime.ts`, `src/view/scene/skins/crime.ts`, `tests/crime.test.ts`.

만드는 순서(위에서부터, 하나 끝날 때마다 커밋): ① 폭발물 → ② 대형 인질극 → ③ 도주 차량 → ④ 은신처 → ⑤ 폭동 → ⑥ 연쇄 방화.

몫(`share`): 무장 — `bomb` 0.04, `bombthreat` 0.04, `package` 0.04, `siege` 0.04, `riot` 0.04 (지금 0.38 + 0.20 = 0.58). 화재 — `arson` 0.10. `getaway` 는 0(예약으로만).

---

## ① 폭발물 — `armed/bomb` · `armed/bombthreat` · `armed/package`

| | 장치 | 신고 내용 키(`nature`) | 위험도 |
|---|---|---|---|
| `bomb` | 진짜, 숨겨져 있다 | `bombthreat` ("폭탄을 설치했다는 전화를 받았어요", "건물을 폭파하겠다는 협박 전화가 왔어요") | [3, 3] |
| `bombthreat` | 없다 | `bombthreat` (같은 문구 — 관제는 구별하지 못한다) | [2, 3] |
| `package` | 눈에 띄는 곳에 있고 35% 만 진짜 | `package` ("주인 없는 가방이 한참째 놓여 있어요", "수상한 상자에서 소리가 나요") | [2, 3] |

두 시나리오가 같은 `nature` 를 쓰면 `texts`·`lik` 는 한쪽에만 적는다(다른 쪽은 생략 — `callSystem` 이 키로 합친다). `vague` 는 `'scream'` 이 아니라 `'bang'`.

- `lik`(화재·교통·실종·무장·응급·붕괴·가스·수난): `bombthreat` = `[0.03, 0.005, 0.005, 0.9, 0.01, 0.02, 0.025, 0.005]`, `package` = `[0.02, 0.01, 0.01, 0.88, 0.02, 0.02, 0.035, 0.005]`. `label: '폭발물 의심'`.
- `needs`: `n.law = 2; n.eod = 1; n.ems = 1; n.suppression = 1; n.tactical = 0;`
- `places`: `{ station: 3, terminal: 3, deptStore: 3, busTerminal: 2, ferry: 1, mart: 2, bank: 2, office: 3, hotel: 1.5, stadium: 1.5, broadcast: 1, university: 2, market: 1.5, powerPlant: 0.6 }`
- `limit: 120`.

**현장** (`scenes/crime.ts` — `registerScene('armed', 'bomb' | 'bombthreat' | 'package', buildBombScene)`):

- 건물은 `builders.ts` 의 화재 현장과 같은 방식으로 만든다: `baseScene` → `planBuilding(s, rng, pickArch(rng, dist, kind), planOpts(dist, kind))` → 방마다 `furnish`. (`buildFire` 를 읽고 구조를 따른다. 불은 놓지 않는다.) `s.leadDept = 'police'`, `s.exits`·`s.spots` 는 `buildArmed` 가 채우는 방식 그대로(봉쇄 지점).
- 시민 4~9명: `addCas(s, x, y, 'mobile', 100, 0, 0.1)` — 다치지 않았고 걸을 수 있다. 방과 복도에 흩어 놓는다. **확인할 것**: `hazards.tickCasualties` 에서 다치지 않은 `mobile` 이 발견된 뒤 스스로 걸어 나가는지(`walking`). 화재가 아닌 현장에서 안 걷는다면 `rules/crime.ts` 에서 "발견된(`tDiscovered >= 0`) 시민은 걷기 시작한다"를 넣는다(경로는 기존 규칙이 만든다).
- 장치: `addProp(s, 'bomb', x, y, { blocking: true, real, fuse, skin: 'bombBag' | 'bombBox', hp: 0 })`.
  - 자리: `bomb` 은 방 안의 **가구 옆 빈 바닥**(가구에 둘러싸인 구석은 안 된다 — 직교 이웃 한 칸 이상이 빈 바닥). `package` 는 홀·복도의 벽 옆. 소품은 길을 막으므로 **놓은 뒤 모든 바닥에 걸어서 닿는지 확인**하고, 끊기면 다른 자리를 고른다(`CLAUDE.md` 의 "소품은 길을 막는다").
  - `fuse`: `bomb` = `sim.t + rng.range(230, 340)`, `package`(진짜일 때) = `sim.t + rng.range(260, 380)`. 위험도 3 이면 −30.
  - 만들면서 `emit({ truth: true, role: 'SYSTEM', actor: '현장', kind: 'hazard', text: '장치는 …초 뒤에 터지도록 맞춰져 있습니다.' })` (관찰자만 본다).

**발견** (`agents.ts` `perceive` — 공용 파일 수정 ①): 다른 소품(`gas`·`valve`) 옆에 한 덩어리.

```ts
if (p.kind === 'bomb') {
  const active = !p.mitigated && !p.exploded;
  const cur = a.beliefs.get('haz', p.id);
  if (d <= 3.0 && los(s, a.x, a.y, p.x, p.y) && (!cur || cur.value.active !== active))
    learn(sim, a, mkFact('haz', p.id, { kind: 'bomb', active, x: p.x, y: p.y }, me, sim.t, 1, true, active ? `${regionNameAt(s, p.x, p.y)}에서 폭발물로 보이는 물건 발견 — 접근 금지` : '폭발물 위험 해소'));
}
```

지휘관이 기다리는 정보이므로 `flushOutbox` 의 즉시 보고(`prompt`) 조건에 `haz`·`bomb` 을 넣는다(같은 파일).

**지휘** (`orders/crime.ts`):

```ts
registerOrders((sim, s, I, a, k) => {
  const bombs = a.beliefs.list('haz').filter((f) => f.value.kind === 'bomb');
  for (const f of bombs) {
    if (!f.value.active) { k.cancel((w) => w.kind === 'defuse' && w.prop === f.id); continue; }
    k.want('defuse', { prop: f.id }, 0.97);
    if (k.countUnits('eod', 0.9) === 0) k.request('eod', '폭발물로 보이는 물건 확인 — 처리반 필요', true);
    // 장치가 있는 방의 수색은 거둔다 (처리반 말고는 가까이 가지 않는다)
    const rg = s.region[f.value.y * s.w + f.value.x];
    k.cancel((w) => w.kind === 'search' && w.region === rg);
  }
});
registerBlocker((sim, s, a) => a.beliefs.list('haz').some((f) => f.value.kind === 'bomb' && f.value.active));
```

`s.region`(방 번호 격자)은 건물의 생김새이므로 읽어도 된다. `s.props` 는 읽지 않는다.

**공용 파일 수정 ② `commander.ts` `syncBoard`** — 두 줄만:

- `const cordon = …` 에 `|| B.list('haz').some((f) => f.value.kind === 'bomb' && f.value.active)` 를 더한다(장치가 살아 있는 동안 경찰이 출입구를 지킨다. 이렇게 해야 `perimeter` 가 매 주기 취소되지 않는다).
- "현장 안전 확보" 선언 조건(`s.kind === 'armed' && !activeThreat && pendingSearch === 0 && s.secureAt < 0 && s.sizeupDone`)에 `&& !살아 있는 장치` 를 더한다. 해체·폭발 뒤에 선언된다.

**해체** (`executor.ts` — 공용 파일 수정 ③, `case 'mitigate'` 바로 아래에 `case 'defuse'` 를 새로):

- `mitigate` 를 본떠 쓴다. 이미 `p.mitigated || p.exploded` 면 `learn(…, true, true)` 로 강제 보고하고 끝낸다(낡은 믿음으로 인한 무한 반복 방지).
- `moveTo(sim, s, a, p.x, p.y, 1.6)`, `t.need = 26 / (0.5 + r.skill)`, 진행 중 `a.ring`.
- 실수: 매 틱 `a.rng.chance(0.004 * (1 - r.skill) * dt)` 이면 `detonate(sim, s, I, p)` (아래).
- 끝나면 `p.mitigated = true; s.staticVersion++`, `learnQuiet(haz … active: false)`, `emit(kind: 'recovery', imp: 3, '폭발물 해체 완료. 위험이 사라졌습니다.')`.
- 가짜 장치(`!p.real`)도 처리반이 가서 확인해야 끝난다: 필요 시간은 `10 / (0.5 + r.skill)`, 문구는 '확인 결과 폭발물이 아닙니다.'

**세계 규칙** (`rules/crime.ts`):

```ts
export function detonate(sim: Sim, s: Scene, I: Incident, p: Prop): void   // p.exploded = true; 기록(ESCALATION '폭발물 폭발'); hazards.blast(sim, s, I, p.x, p.y, 3.4, 55, ev);
                                                                            // 반경 2 의 바닥·가구 칸에 불(s.fuel 이 0 이면 0.6 을 주고 s.fire = 0.55); hazards.pushFx(…'boom'…); s.staticVersion++
registerRule((sim, s, I) => { /* bomb 소품이 없으면 return; real && !mitigated && !exploded && sim.t >= p.fuse → detonate */ });
```

터진 뒤는 지금의 규칙이 처리한다(불 → 지휘관이 진압 요청, 다친 사람 → 구조·구급). 창문·가구 파손은 N7 과 합칠 때 잇는다(여기서는 하지 않는다).

**판정** (`debrief.ts` — 공용 파일 수정 ④): `hazardActive` 에 `|| s.props.some((p) => p.kind === 'bomb' && p.real && !p.mitigated && !p.exploded)`. `benign` 판단에 "장치가 진짜가 아닌 `bombthreat`·`package`"를 더해 `FALSE_ALARM`(복구됨) 과 한 줄 요약('허위 협박 — 폭발물 없음' / '확인 결과 폭발물 아님')을 낸다. `benign` 은 지금 `variant === 'false' || 'prank'` 로 여러 곳에서 쓰이니, 헤드라인과 문제 기록 두 군데만 고친다.

**그림** (`skins/crime.ts`): `bombBag`(바닥의 가방, 지퍼 사이로 전선), `bombBox`(테이프 감긴 상자). 깜박이는 붉은 점(`timeMs`). `truth && p.real && !p.mitigated && !p.exploded` 이면 위에 남은 시간(`p.fuse - simT`, 초). 해체되면 열린 가방에 초록 점, 터졌으면 그리지 않는다(그을음은 불이 그린다). 좌표계: 소품 가운데가 원점, 1 = 한 칸.

**완료 조건**: `--force armed/bomb` 20교대에서 한계 시간 ≤ 2, 해체 성공이 절반 이상(보통 난이도, 폭발물 처리반은 편성 3단계부터 있다), 처리반이 없는 조건(`--diff 3,3,3,3,3,1`)에서도 끝난다(인근 도시 지원이 오거나, 터진 뒤 수습). `bombthreat` 는 전부 '이상 없음'으로 끝난다.

---

## ② 대형 인질극 — `armed/siege`

- `nature: 'siege'`(texts: "무장한 사람들이 사람들을 붙잡고 있어요! 여러 명이에요!", "총 든 사람들이 건물을 점거했어요. 안에 사람들이 갇혀 있어요."), `lik` 는 기존 `hostage` 줄(`callSystem.NATURE_LIK.hostage`)과 같게. `label: '인질극(다수)'`, `severity: [3, 3]`, `limit: 120`.
- `needs`: `n.law = 2; n.tactical = 2; n.ems = 2;`
- `places`: `{ terminal: 2, deptStore: 2, bank: 3, broadcast: 1.5, university: 1.5, busTerminal: 1.5, office: 2 }`.
- 현장: `builders.armedVenue`(export 되어 있다)로 장소를 만들고, `buildArmed` 의 `hostage` 분기를 본떠 **총을 든 용의자 2~3명, 인질 4~6명을 방 둘에 나눠** 놓는다(용의자마다 `hostageId` 하나, 나머지 인질은 같은 방에 `hostage: true`). 시한(`deadline`)은 기존보다 40초 길게.
- 지휘 규칙은 새로 쓰지 않는다(기존의 협상·섬광탄·동시 진입). `--force armed/siege` 로 돌려 보고, 용의자가 둘 이상일 때 진입 뒤에 남은 용의자를 계속 상대하는지 기록으로 확인한다. 안 되면 `commander.ts` 를 고치지 말고 인원·배치를 조정한다(예: 용의자를 한 방에).

완료 조건: 20교대에서 한계 시간 ≤ 2, 인질 4명 이상·용의자 2명 이상이 실제로 놓인다.

## ③ 도주 차량 — `armed/getaway`

- 총을 든 용의자가 현장을 빠져나가는 곳: `hazards.ts` `tickHostiles` 의 `h.state = 'escaped'` 바로 아래(공용 파일 수정 ⑤). 지금의 한 줄
  `if (h.weapon === 'gun' && s.rng.chance(0.45)) sim.gen.chain.push({ … robbery … })` 를 **난수 호출 횟수를 그대로 둔 채** 바꾼다:

```ts
if (h.weapon === 'gun') {
  const r = s.rng.next();
  if (r < 0.35 && !I.pursuit) sim.gen.chain.push({ at: sim.t + 2, opts: { type: 'armed', variant: 'getaway', nodeId: I.truth.nodeId, parent: I.id, note: '달아난 용의자가 차를 몰고 도주합니다' } });
  else if (r < 0.65) sim.gen.chain.push({ /* 지금의 재범 예약 그대로 */ });
}
```

- 시나리오 `armed/getaway`: `share: 0`, `nature: 'getaway'`(texts: "총을 든 사람이 차를 타고 달아나고 있어요!", "방금 강도가 차로 도망쳤어요. 엄청 빨리 달려요!"), `lik` 는 `kidnap` 줄과 비슷하게(무장 0.86), `label: '도주 차량'`, `severity: [2, 3]`, `delay: [1, 3]`, `needs: (n) => { n.law = 2; n.tactical = 1; n.search = 1; n.ems = 0; }`, `onCreate: (sim, I) => startPursuit(sim, I, 'getaway')`.
- `pursuit.ts`(공용 파일 수정 ⑥): `startPursuit` 의 `kind` 에 `'getaway'`. 목표는 납치와 같이 먼 쪽의 도시 출구, `giveUpAt = firstCallAt + 240`, `WHO.getaway = '도주 차량'`. 압박 기준은 납치와 같게(8).
- 선 뒤의 현장: `builders.ts` 의 `buildStop` 을 export 하고(공용 파일 수정 ⑦) `I.pursuit.kind === 'getaway'` 분기를 넣는다 — 총을 든 용의자 1~2명, 인질 없음, 사고로 섰으면 다친 채로. `registerScene('armed', 'getaway', buildStop)`.
- 판정(`debrief.ts`): 놓치면 `unresolved`.

## ④ 납치범의 은신처

- `pursuit.ts` `startPursuit('kidnap')`: 40% 는 `p.hideout = 건물 id`, 목표 교차로 = 그 건물의 `nodeId`. 은신처 후보: `kind` 가 `warehouse`·`workshop`·`farmhouse`·`pension`·`storage`·`greenhouse` 이고 출발점에서 500 이상 떨어진 건물. (난수는 그 함수의 `rng`.)
- `tickPursuits`: 은신처 교차로에 닿았을 때
  - 부대의 시야 안(`p.tracked`)이면 지금처럼 그 자리에 세운다(`stop(…, 'caught', …)`).
  - 시야 밖이면: `p.state = 'escaped'; p.how = 'hideout'`, `raiseProblem(SUSPECT_FLED, '납치 차량을 놓침')`, `closeIncident(sim, I, 'abandoned')`, 그리고
    `sim.gen.chain.push({ at: sim.t + rng.range(40, 90), opts: { type: 'armed', variant: 'hostage', placeId: p.hideout, parent: I.id, note: '납치범이 숨어든 곳에서 제보가 들어옵니다' } })`.
- 판정(`debrief.ts`): `p.how === 'hideout'` 이면 납치 사건은 `failed` 가 아니라 `unresolved`(이어지는 인질 사건이 결말을 낸다).
- 인질 사건의 현장이 창고·농가에서도 만들어지는지 확인한다(`KIND_SCENE[kind].venue`).

## ⑤ 폭동 — `armed/riot`

- `nature: 'riot'`(texts: "사람들이 떼로 몰려 부수고 싸우고 있어요!", "난동이 커졌어요. 불도 붙였어요!"), `lik`: `[0.06, 0.01, 0.005, 0.86, 0.04, 0.01, 0.01, 0.005]`, `label: '집단 난동'`, `severity: [2, 3]`, `limit: 120`.
- `needs`: `n.law = 3; n.tactical = 1; n.ems = 1; n.suppression = 1;`
- `places`: `{ stadium: 4, market: 3, busTerminal: 1.5, university: 1.5, station: 1.5, mart: 1 }`.
- 현장: `armedVenue(s, rng, 'warehouse' 또는 'shop', dist)` 의 넓은 홀. 용의자 5~8명 — 주동자 2명(흉기 `knife`, 공격성 0.6~0.8)과 나머지(무기 `none`, 공격성 0.15~0.35, 사기 낮게 → 말을 걸면 곧 손을 든다). 다친 시민 2~4명(`immobile`, 출혈 있음), 가구 한두 칸에 작은 불.
- 지휘 규칙은 새로 쓰지 않는다(협상 → 검거). 20교대에서 한계 시간이 나오면 ⓐ 나머지 용의자의 사기·수를 낮추거나 ⓑ `rules/crime.ts` 에 "현장에 경찰이 6명 이상이면 무기 없는 용의자는 5초마다 30% 로 손을 든다(`state = 'surrendered'`)"를 넣는다.

## ⑥ 연쇄 방화 — `fire/arson`

- `nature: 'arson'`(texts: "누가 불을 지르고 달아났어요!", "가게 뒤에서 누가 뭘 뿌리고 불을 붙였어요!"), `lik`: `[0.82, 0.01, 0.005, 0.12, 0.01, 0.01, 0.02, 0.005]`, `label: '방화'`, `severity: [1, 3]`, `needs: (n) => { n.law = Math.max(n.law, 1); }`(나머지는 화재의 기본값 그대로 — `needs` 는 유형의 기본 계산 뒤에 불린다).
- `places`: `{ shop: 4, warehouse: 3, market: 3, storage: 2, workshop: 2, convenience: 2, restaurant: 2, villa: 1.5, parking: 1 }`.
- 현장: 일반 화재 현장을 그대로 쓰고 목격자 소품 하나를 더한다. `builders.ts` 의 `buildFire` 를 export 해(공용 파일 수정 ⑧) `registerScene('fire', 'arson', (sim, I, rng) => { const s = buildFire(sim, I, rng); /* 건물 밖 바닥에 addProp(s, 'witness', …) — buildArmed·buildSearch 가 목격자를 놓는 방식을 따른다 */ return s; })`.
- 이어짐(`onClose`): `const rng = sim.rng.fork('arson:' + I.id)`. 연쇄의 깊이는 `parent` 를 따라 센다(최대 3).
  - 목격자 면담이 끝났으면(`s.props.some((p) => p.kind === 'witness' && p.interviewed)`) `0.55 + 0.15 × (깊이 − 1)` 로 검거: `emit({ role: 'UNIT', actor: '경찰', kind: 'recovery', imp: 2, text: '방화 용의자 검거 — 목격자 진술로 인근에서 붙잡혔습니다.' })`. 연쇄 끝.
  - 못 잡았고 깊이 < 3 이면: 600 안의 같은 종류 건물(없으면 가장 가까운 것) 하나를 골라 `gen.chain.push({ at: sim.t + rng.range(60, 120), opts: { type: 'fire', variant: 'arson', placeId, parent: I.id, note: '연쇄 방화로 보이는 불이 또 났습니다' } })`.
  - 깊이 3 까지 못 잡으면 마지막 사건에 `I.problems.push(SUSPECT_FLED, '방화범을 잡지 못함')` 은 **하지 않는다**(판정이 끝난 뒤다). 대신 `emit` 한 줄만 남긴다.

---

## 테스트 (`tests/crime.test.ts`)

`createIncident(sim, { type, variant, rng: sim.rng.fork('t') })` 로 직접 일으키거나 `new Sim(seed, NORMAL, 1200, { force: 'armed/bomb' })`.

1. 폭발물: 8개 시드 모두 끝까지 가고, 진짜 장치가 하나씩 있고, **해체와 폭발이 둘 다 일어난 장치는 없다**. 해체된 교대가 하나 이상. `defuse` 를 맡은 대원은 모두 폭발물 처리반 소속(작업 기록 `s.board` 의 `assignees`).
2. 협박 전화: 장치가 없거나 가짜, 종료 사유 `resolved`, 문제 기록에 `FALSE_ALARM`.
3. 대형 인질극: 인질 ≥ 4, 용의자 ≥ 2, 끝난다.
4. 도주 차량·은신처: `threat: 4` 로 40교대 — `variant === 'getaway'` 이고 `parent` 가 있는 사건이 하나 이상. 은신처에서 이어진 인질 사건은 `truth.placeId === 부모.pursuit.hideout`.
5. 폭동·방화: 강제로 일으켜 끝나고, 방화 연쇄의 깊이는 3 이하, 이어진 사건마다 `parent` 가 있다.
6. 재현성: 같은 시드 두 번의 `report.hash` 가 같다(강제 발생 포함).
