# U2 — 통화창을 가운데 화면 밖으로 (오른쪽 칸 맨 위의 접히는 칸)

공통 규칙은 `docs/specs/README.md`, 화면 묶음의 본보기는 `docs/specs/U1-ui.md`. 브랜치 `wf/u2`, 개발 서버 포트 **5214**.
이 문서는 다음 구현 세션이 그대로 따라 할 수 있게 쓴 지시서다. 줄 번호는 커밋 `0636387` 기준(`db8cba0` 에서도 `src/`·`scripts/` 는 같다). Q1 이 먼저 합쳐지면 `App.tsx` 의 줄 번호가 밀린다 — 9절 7번.

사용자의 말: "통화 화면이 가운데 메인 화면을 가려서 너무 방해되는데, 여닫을 수 있게 하거나 아예 옆으로 빼버리자."

**결정 (2절)**: 두 가지를 합친 C안. 통화창을 가운데 화면 위의 떠 있는 상자에서 **오른쪽 칸 맨 위의 고정 칸**으로 옮기고, 그 칸을 **한 줄 띠로 접을 수 있게** 한다. 기본은 펼침이다. 가운데 화면을 가리는 넓이는 펼쳐도 접어도 0이다.

**자기 파일**: `src/ui/CallDock.tsx`(새로).
**공용 파일 수정** (`docs/specs/README.md` 2절의 공용 파일 — 아래 적은 곳만, 가장 작은 조각으로):
- `src/ui/App.tsx` — 가져오기 한 줄, 상태 세 줄(`const reelUntil = useRef(0);` 바로 뒤), 단축키 한 줄, 통화창 줄 삭제, 오른쪽 칸 맨 위에 `<CallDock>` 한 줄(4.2).
- `src/ui/panels.tsx` — `CallPanel` 을 지우고(내용은 `CallDock.tsx` 로 옮긴다), `LogPanel` 에 몇 줄(4.3).
- `src/ui/styles.css` — 파일 끝 `/* ── U2 ── */` 블록, 쓸모없어지는 두 줄 삭제(4.4).

그 밖의 컴포넌트·이름·순서는 건드리지 않는다.
**건드리지 않는다**: `src/sim/*` 전부(시뮬레이션 결과가 한 건도 바뀌면 안 된다), `src/view/*` 전부(카메라·소리·`runner.ts` 포함 — 가리지 않게 되므로 카메라를 고칠 일이 없다), `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`(합치는 사람이 고친다. 넣을 문구는 10절).

관찰 전용 원칙(`CLAUDE.md` 절대 규칙 1): 통화창을 접고 펴는 것은 **표시 방식** 조작이다. AI 에게 아무것도 시키지 않고, 통화의 진행·순서·소리도 바꾸지 않는다. 브라우저 저장은 보는 사람의 편의(접힘/펼침 기억)에만 쓴다.

## 1. 지금 상태 — 어디를 얼마나 가리는가

**그리는 곳**: `src/ui/App.tsx:192` `<div className="overlay call-wrap"><CallPanel sim truth /></div>`. 가운데 `.center` 안, 조건 없이 늘 붙어 있다(주요 장면 이어 보기 중에도). 컴포넌트는 `src/ui/panels.tsx:447-479` `CallPanel`, 자리는 `src/ui/styles.css:150` `.overlay.call-wrap { top: 50px; right: 12px; width: 330px; }`. 닫기 단추·최대 높이·스크롤이 없고, 높이는 내용에 따라 102~348px 로 바뀐다.

**가리는 넓이** (요소의 상자 ÷ 가운데 캔버스, `/?seed=S3`):

| 화면 | 가운데 캔버스 | 통화창 | 찍은 순간 | 높이 중앙값 245px | 가장 길 때 348px | 현장 화면 |
|---|---|---|---|---|---|---|
| 1600×900 | 884×770 | 330×233 (x858, y96) | **11.3%** | 11.9% | **16.9%** | 10.4% |
| 1280×800 | 564×670 | 330×233 (x538, y96) | **20.3%** | 21.4% | **30.4%** | 18.8% |

- 폭으로는 가운데 화면의 37%(1600), 58%(1280)를 차지한다.
- 1280 에서는 통화창 왼쪽 끝(x538)이 캔버스 한가운데(x598)보다 왼쪽이다. 대기 줄이 붙어 길어지면 캔버스 중심점을 덮는데, 자동 카메라는 **신고 중인 사건을 바로 그 중심에 둔다**(`src/view/camera.ts:84`·`99`·`108-117`, `renderCity.ts:52-55`).
- 현장 화면에서는 보고 있는 건물을 덮는다. 그런데 그 통화는 **다른 사건**의 것일 수 있다(찍은 장면: 화면은 사건 01 현장, 통화는 사건 02).
- **교대 시간 중 떠 있는 비율 53%**(헤드리스, 보통, 시드 S1~S20, `CallPanel` 의 표시 조건 그대로): 통화 중 44.4% + 끝난 뒤 6초 남김 8.5%. '벨만 울림' 상자는 0%(`tickCalls` 가 같은 틱에 받는다, `callSystem.ts:379-392`). 교대마다 통화 평균 27건, 한 건 평균 20.2초, 비긴급 26%. 시드별 43~61%.
- 통화창 아래의 지도는 클릭·끌기·휠이 닿지 않는다(`.overlay > *` 가 pointer-events: auto, `Viewport.tsx:149-150` 의 입력은 캔버스에만).

**통화창 때문에 생긴 다른 규칙**:
- `styles.css:78` `.overlay.tl { max-width: calc(100% - 366px) }` — 366 = 통화창 330 + 여백. 1280 에서 왼쪽 위 덧글이 198px 로 줄어 두세 줄로 접힌다.
- `styles.css:347` `.app:has(> .disaster-banner) .overlay.call-wrap { top: 78px; }` — 특보 띠가 있으면 통화창을 내린다(`docs/specs/N6-disaster.md:94` 가 "통화창을 옮기면 함께 본다"고 적어 두었다).
- 원래 있던 겹침(통화창과 별개): 1280 에서 오른쪽 위 단추 줄 `.overlay.tr`(실측 379px, x489~868)이 왼쪽 위의 '자동 카메라 · …' 알약(x328~526)을 덮는다.

**같은 정보가 이미 오른쪽에 있다**: '판단 요약' ① 에 신고자와 확보한 정보 표(`panels.tsx:217-229`, 관찰 중인 사건만), 오른쪽 아래 기록에 통화 대사 전부(`panels.tsx:166`, 중요도 0이어도 `kind === 'call'` 은 넣는다).

**스크린샷** (조사 세션의 임시 파일. 저장소 밖 `<scratchpad>/u2/` 에 있었고 다음 구현 세션에는 없다 — 수치는 위에 적었다. 고치기 전 그림이 필요하면 6절의 절차를 고치기 전에 한 번 돌려 `before-*.png` 로 찍는다):
- 통화 중: `call-1600.png`, `call-1280.png`
- 가장 길 때(대기 줄 포함): `call-1600-tall.png`, `call-1280-tall.png`
- 현장 화면을 다른 사건의 통화가 덮는 장면: `call-1600-scene.png`, `call-1280-scene.png`
- 측정 스크립트·원자료: `shoot.cjs`, `shoot2.cjs`, `result.json`, `ts/callshare.ts`. 측정에 쓴 겹친 넓이 함수와 측정 루프는 6절에 옮겨 적었다. Playwright 는 `NODE_PATH=/opt/node-tools/node_modules` 로 부른다.

## 2. 세 안의 비교와 결정

설계 확인용으로 저장소를 고치지 않고 페이지에 CSS 를 덧붙여 통화창 상자를 오른쪽 칸 맨 위로 옮긴 시제품을 찍어 쟀다(B·C 의 수치). 시제품 그림 `proto-{1600,1280}-{open,closed,banner}.png` 과 스크립트 `proto.cjs`·`proto-banner.cjs` 는 조사 세션의 임시 파일(`<scratchpad>/u2/`)이라 다음 구현 세션에는 없다. 콘솔 오류 0건. (접힌 띠의 내용은 시제품에 없다. 높이만 맞췄다.)

| | (A) 제자리에서 여닫기 | (B) 옆으로 빼기 — 오른쪽 칸 안의 고정 칸 | (C) 옆 칸 + 접기 |
|---|---|---|---|
| 가운데를 가리는 넓이 | 접힘: 240×30 띠 ≈ 1.1%(1600) · 1.9%(1280). 펼침: 지금과 같다(11~17% · 20~30%) | **0** | **0** (펼침·접힘 모두) |
| 가운데 화면 크기 | 그대로 | 그대로 (새 열을 내면 884→554, 564→**234** — 쓸 수 없다) | 그대로 |
| 통화 내용 | 펼쳐야 보이고, 펼치면 다시 가린다 | 늘 보인다 | 기본 펼침, 늘 보인다 |
| 오른쪽 칸 (판단 요약 / 기록, 1600 · 1280) | 그대로 354/379 · 308/325 | 235/274 · 200/233 | 펼침 = B, 접힘 322/377 · 276/323 |
| 1280 에서 | 펼치면 캔버스 중심(신고 중인 사건 자리)을 덮을 수 있다 | 문제 없다 | 문제 없다 |
| 새 통화 알림 | 띠 반짝임 + 벨 | 칸의 내용이 바뀐다 + 벨 | 펼침: 내용이 바뀐다. 접힘: 띠가 한 번 반짝 + 벨 |
| 일의 크기 | 작다 | 중간 | 중간 (B + 띠) |

왼쪽 칸(316px) 안에 넣는 안도 보았으나 버린다: 1280×800 에서 사건 목록이 225px 남짓인데(부대 목록이 52vh 를 차지한다) 통화 칸 200px 을 넣으면 사건 목록이 사라진다.

**C안으로 정한다.** 근거:
1. **가리는 넓이가 어느 상태에서도 0이다.** 사용자의 불만(가운데를 가린다)이 상태와 관계없이 없어진다. A 는 가림을 "끌 수 있게" 할 뿐이고, 켜면 그대로다.
2. **통화는 교대 시간의 53% 동안 떠 있다**(교대마다 27건). A 라면 보는 사람이 27번 여닫거나 늘 닫아 두게 되는데, 늘 닫으면 접수 AI 의 통화라는 볼거리를 잃는다. C 는 늘 펼쳐 두어도 방해가 없다.
3. **자리가 내용과 맞는다.** 오른쪽 칸은 "AI 의 머릿속"이다: 통화(접수 AI) → 판단 요약 ①②③(분석·배정·지휘) → 무전 기록. 위에서 아래로 일의 순서와 같고, 판단 요약 ① '신고 접수 AI — 확보한 정보' 가 통화 칸 바로 아래에 온다.
4. **1280 에서 가운데는 내줄 폭이 없다**(564px). 폭 330 이상을 낼 수 있는 곳은 400px 고정인 오른쪽 칸뿐이다.
5. **접기가 오른쪽 칸의 손해를 되돌린다.** 기록을 넓게 보고 싶은 사람은 접으면 지금과 거의 같은 높이(기록 ±0, 판단 요약 −9%)를 얻는다.
6. 자동 카메라·현장 확대·작은 현장 창·속보를 고칠 필요가 없다(가운데에서 아무것도 비켜 줄 것이 없다).

## 3. 정한 안의 배치와 내용

### 3.1 자리와 크기

- 화면의 틀(`.app` 의 열 `316px | 1fr | 400px`, 행 `46px | 1fr | 84px`)은 그대로. **가운데 화면의 크기는 한 화소도 바뀌지 않는다.**
- 오른쪽 칸 `.right` 의 자식 순서: **`<CallDock>`(새로, 맨 위)** → `.tabs` → `.right-top` → `.right-bottom`. 통화 칸은 흐름 안에 있는 칸이라 `position`·`z-index` 가 없다(떠 있지 않다). 보고서·난이도 창(`.modal-back`, z-index 20)은 지금처럼 위를 덮는다.
- **펼침 높이는 고정**: `clamp(176px, 25vh, 224px)` — 900 높이 224, 800 높이 200, 720 높이 180. 내용(대사 수·칩 수)에 따라 바뀌지 않는다. 통화가 없을 때도 같다(3.4). 높이가 통화마다 바뀌면 교대마다 50번 넘게 오른쪽 칸의 판단 요약과 기록이 위아래로 튄다.
- **접힘 높이 34px** — 패널 제목 줄(`.panel-section h3` 의 min-height 34)과 같다.
- 전환: `height 0.18s ease`(U1 의 150~200ms 규칙). `prefers-reduced-motion: reduce` 이면 전환 없음 — `styles.css:254` 의 전역 규칙(`* { animation: none !important; transition: none !important; }`)이 이미 끄므로 따로 쓰지 않는다.
- 남은 높이는 판단 요약 : 기록 = **46 : 54** 로 나눈다(지금은 판단 요약이 칸 전체의 46% 고정). 기록은 최소 120px.
- 통화 칸의 폭은 400(오른쪽 칸 전체) — 지금의 330보다 넓어 한 줄에 들어가는 대사가 늘어난다.

시제품으로 잰 높이(px):

| | 지금 1600×900 | C 펼침 | C 접힘 | 지금 1280×800 | C 펼침 | C 접힘 |
|---|---|---|---|---|---|---|
| 가운데 캔버스 | 884×770 | 884×770 | 884×770 | 564×670 | 564×670 | 564×670 |
| 통화가 가운데를 가리는 넓이 | 11.3% (최대 16.9%) | 0 | 0 | 20.3% (최대 30.4%) | 0 | 0 |
| 통화 칸 | (가운데 위에 떠 있음) | 224 | 34 | (떠 있음) | 200 | 34 |
| 탭 | 37 | 37 | 37 | 37 | 37 | 37 |
| 판단 요약 `.right-top` | 354 | 235 | 322 | 308 | 200 | 276 |
| 기록 `.right-bottom` | 379 | 274 | 377 | 325 | 233 | 323 |

1440×900 은 높이가 1600×900 과 같아 오른쪽 칸의 수치도 같다(통화 칸 224/34, 판단 요약 235/322, 기록 274/377). 가운데 캔버스는 724×770 이고, 가운데 폭이 760 미만이라 왼쪽 위 덧글은 좁은 화면 규칙(3.6)을 탄다.

### 3.2 펼친 칸의 내용 — 지금 보이는 것 그대로, 고정 높이에 맞춰 조금만

위에서 아래로:
1. **머리줄** (24px): 전화 고리(통화 중이면 파동), `신고 통화` / `추가 신고` / `비긴급 전화`, 사건 번호, 통화 시간, `● 통화 중`(깜박임) 또는 `통화 종료` — 지금과 같다. 여기에 두 가지를 더한다: 대기 중인 다른 전화가 있으면 **`대기 N` 알약**(지금 맨 아래의 '다른 신고 N건이 대기 중입니다' 줄을 머리줄로 올린다 — 고정 높이에서 대사 자리를 지키려고), 맨 오른쪽 자리에 **접기 단추**(위를 향한 꺾쇠, `title="통화창 접기 (P)"`, `aria-expanded="true"`). 접기 단추는 DOM 에서 `.call` 밖, **`.call-dock` 의 직접 자식**으로 두고 머리줄 오른쪽 끝에 겹쳐 놓는다(`position: absolute`, 머리줄은 그만큼 오른쪽을 비운다). `.call` 안에 두면 '통화 종료'의 흐림(`styles.css:153` 의 `opacity: 0.8`)과 '지난 통화'의 흐림(0.55)이 단추에도 걸린다.
2. **둘째 줄**: `신고 접수 AI ↔ 신고자 ○○ · 화법: …`(AI 시점에서 장난 전화면 '확인 중') — 지금과 같다. 한 줄, 넘치면 말줄임.
3. **대사**: 마지막 5줄(`slice(-5)`)과 입력 중 점 셋 — 지금과 같다. 칸이 모자라면 **오래된 줄이 위에서 잘린다**(아래 정렬 + 위쪽 18px 페이드). 잘린 대사는 오른쪽 아래 기록에 그대로 있다.
4. **AI가 정리한 정보** 칩 — 지금과 같다. 한 줄, 넘치는 칩은 오른쪽에서 잘린다(각 칩의 `title` 은 그대로). 라벨과 칩은 줄어들지 않는다(4.4 의 `.call-dock .extracted > * { flex: none }` — 빠뜨리면 라벨만 최소 폭까지 줄어 'AI가 / 정리한 / 정보' 세 줄로 접히고, 칩 줄이 17px 에서 45px 로 늘어 대사 한 줄이 가려진다. 검토 때 정적 렌더로 확인했다).

카드의 바탕·테·그림자·둥근 모서리는 없앤다(패널의 한 칸이다). 아래에 1px 선(`--line`)으로 탭과 나눈다.

### 3.3 접힌 띠의 내용

한 줄 34px, **띠 전체가 하나의 단추**(`<button className="call-strip">`, `aria-expanded="false"`). 왼쪽부터:

`[전화 고리] [사건 칩] [한 줄] ……… [통화 시간] [●] [대기 N] [아래 꺾쇠]`

사건 칩은 보여 주는 통화의 **사건 번호**(`I.code`, 예: `01`. 추가 신고도 같은 사건의 번호)이고, 사건이 없는 비긴급 전화는 `비긴급` 이라고 쓴다. 사건 번호는 칩에 있으므로 한 줄에 다시 쓰지 않는다.

| 상태 (`shownCall` 의 `mode`, 3.4) | 고리 | 사건 칩 | 한 줄 | 오른쪽 |
|---|---|---|---|---|
| 통화 중 `active` | 파동 | 있음 | 신고자의 마지막 대사(아직 없으면 마지막 대사). 비긴급 전화도 같다 | 통화 시간, 빨간 점 깜박임, `대기 N`(있을 때) |
| 끝난 지 6초 안 `ended` | 멈춤 | 있음 | `통화 종료 · ` + 신고자의 마지막 대사 | 통화 시간, `대기 N`(있을 때) |
| 받는 통화 없이 벨만 울림 `ringing` | 파동 | 없음 | `신고 전화 대기 N건` | `대기 N` |
| 지난 통화 `past` | 흐림 | 흐림 | `대기 중인 신고 전화 없음` + 흐린 글자 ` · 지난 통화 1:20 전 종료` (`endedAt < 0` 이면 ` · 지난 통화 중단`, 시각은 쓰지 않는다) | — |
| 아직 한 통도 없음 `none` | 흐림 | 없음 | `아직 걸려 온 신고 전화가 없습니다` | — |

- "가장 급한 신고 한 줄" = 지금 받고 있는 통화의 한 줄이다. 접수 AI 는 한 번에 한 통화만 받으므로(`callSystem.ts:378`) 내용이 있는 통화는 늘 하나뿐이고, 기다리는 전화는 **아직 아무도 받지 않아 내용이 없다** — 그래서 수(`대기 N`)로만 보인다. 기다리는 전화를 진실(실제 유형·규모)로 줄 세우지 않는다(관찰자 시점에서도. 받기 전의 전화에 대해 화면이 AI 보다 많이 아는 척하지 않는다).
- 벨이 울리는 전화가 있으면 '지난 통화'보다 앞선다(`ringing` 이 `past` 보다 먼저, 펼친 칸과 띠 모두). 그래서 '지난 통화' 줄의 "대기 중인 신고 전화 없음"이 `대기 N` 과 함께 나오는 일은 없다. 지금의 `CallPanel` 도 이때 '벨 울림' 상자를 보여 준다(`panels.tsx:452`). 실제로는 거의 한 틱 동안의 일이다.
- 한 줄은 넘치면 말줄임. 전체 문장은 **띠 단추의 `title`** 에 `문장 — 눌러서 펼치기 (P)` 로 합쳐 넣는다(예: `통화 종료 · 3층에서 연기가 나요 — 눌러서 펼치기 (P)`). 한 줄 `<span>` 에 따로 `title` 을 달면 띠 대부분을 덮어 단추의 설명이 거의 보이지 않는다.
- 1280 에서도 오른쪽 칸 폭은 400 이라 한 줄에 15자 안팎이 들어간다.

### 3.4 어떤 통화를 보여 주는가 (여러 통화가 겹칠 때)

`shownCall(sim)` 하나로 정하고 펼침·접힘이 함께 쓴다. **sim 을 읽기만 한다**(배열을 정렬하거나 고치지 않는다).

먼저 `last` = 뒤에서부터 `state === 'done' && answeredAt >= 0` 인 첫 통화(받은 순서 = 번호 순서이므로 가장 최근에 받은 통화). 받지 못하고 끝난 전화(`answeredAt < 0`, 받기 전에 사건이 닫힘)는 건너뛴다. `ringing` = `state === 'ringing'` 의 수. 그다음 위에서부터 처음 맞는 것:

1. `sim.activeCall >= 0` → 그 통화, **통화 중** (`active`).
2. `last` 가 있고 `last.endedAt >= 0 && sim.t - last.endedAt < 6` → `last`, **끝난 지 6초 안** (`ended`, 지금의 6초 남김과 같다, 흐림 0.8).
3. `ringing > 0` → 통화 없음, **벨만 울림** (`ringing`). 머리줄은 지금의 벨 상자와 같은 `신고 전화 대기 N건 · ● 벨 울림`, 그 아래는 비운다. **'지난 통화'보다 앞선다**(3.3).
4. `last` 가 있으면 → `last`, **지난 통화** (`past`, 흐림 0.55, 머리줄 `지난 통화 · 1:20 전 종료`, 빨간 점·입력 중 표시 없음). 통화 도중 사건이 닫혀 끝난 통화는 `endedAt` 이 -1 이다(`callSystem.ts:405`) — 펼친 칸의 머리줄과 띠의 한 줄 모두 `통화 중단` 으로 쓰고 시각은 쓰지 않는다.
5. 그 밖 → **없음** (`none`), 빈 칸 문구 `아직 걸려 온 신고 전화가 없습니다`.

`대기 N` 은 `active`·`ended` 의 머리줄(띠)에 붙는다. `past`·`none` 에서는 `ringing` 이 늘 0 이다(3번이 앞선다).

겹침의 실제 모습: 비긴급 전화나 긴 통화를 받는 동안 다른 신고가 '벨 울림'으로 기다린다. 앞 통화가 끝나면 바로 다음 틱(0.2초 뒤)에 다음 통화를 받으므로(그 한 틱 동안은 `ended`) 6초 남김은 사실상 사라지고 새 통화가 보인다(지금과 같다). 10초 넘게 기다린 신고는 시뮬레이션이 `CALL_QUEUE` 문제로 기록에 남긴다 — 통화 칸이 따로 알릴 필요는 없다.

**지난 통화를 계속 보여 주는 까닭**: 칸의 높이가 고정이라 통화가 없는 47%의 시간 동안 빈 상자가 된다. 마지막 통화의 결론(정리한 정보 칩)이 빈 칸보다 쓸모 있다. 오해를 막으려고 흐리게 하고 머리말을 `지난 통화` 로 바꾼다.

### 3.5 접기·펼치기, 새 통화 알림, 기억

- **조작**: 펼친 칸의 접기 단추, 접힌 띠 아무 곳, 단축키 **`P`**(전화, 지금 비어 있다 — `App.tsx:113-134` 의 키는 Space·1~4·A·C·T·M·S·Z·←·→). 입력칸에서는 무시(`App.tsx:115` 의 기존 조건).
  - `P` 는 `e.key` 가 `p`·`P` 이거나 **`e.code === 'KeyP'`** 일 때 받는다 — 한글 입력 상태에서도 된다(새 키라 비용이 없다).
  - **Ctrl·Meta·Alt 와 함께 누르면 무시한다**(Ctrl+P 가 인쇄 창을 띄우면서 통화창까지 접지 않게). 같은 문제가 S·C·A 에도 있으나 이 묶음의 범위 밖이다.
  - **포커스**: 단추(접기 단추·띠)로 접고 펴면 누른 단추가 사라져 포커스를 잃는다. 그때는 새로 생긴 반대쪽 단추(`.call-strip` / `.call-toggle`)로 포커스를 옮긴다. `P` 키로 바꿀 때는 옮기지 않는다(키보드로 보던 자리를 빼앗지 않는다). 포커스를 받은 단추 위에서 Space 를 눌러도 `App.tsx:116` 이 `preventDefault` 하므로 단추가 눌리지 않고 일시정지만 된다(다른 단추와 같다).
- **새 통화가 오면 — 저절로 펼치지 않는다.** 교대마다 27번 보는 사람의 선택을 뒤집게 되고, 펼칠 때마다 오른쪽 칸이 튄다. 위험도가 높은 신고라고 펼치지도 않는다(받는 순간에는 위험도를 모른다). 대신:
  1. 접힌 띠가 **한 번 반짝인다**(옅은 빨강 바탕이 1.2초 동안 사라진다, 실제 시간). 새 통화를 받아 보여 줄 통화의 번호가 바뀔 때 띠를 `key` 로 다시 그려 CSS 애니메이션 한 번. **펼친 칸도 같다**: 머리줄 `.call-head` 에 통화 id 를 `key` 로 주고, 받는 중(`.call.active`)일 때만 같은 `call-flash` 를 한 번 띄운다 — 지금은 펼친 칸의 내용만 바뀌고, 소리는 사용자 입력 뒤에만 켜지며 `M` 으로 끌 수도 있어 새 통화를 눈으로 알 길이 없다.
  - 화면 확인용으로 `.call-dock` 에 `data-call={보여 주는 통화의 id, 없으면 -1}` 을 단다. `.call-strip.flash` 클래스는 통화가 이어지는 동안 계속 붙어 있으므로 "새 통화가 온 순간"의 기준이 되지 못한다(6절 3번).
  2. 통화 중에는 전화 고리의 파동과 빨간 점 깜박임(지금 있는 `pulse`·`blink`). U1 규칙의 "계속 깜박이는 것은 지금 급한 것에만"에 맞다(신고 접수 중).
  3. 벨 소리는 지금 그대로(`src/view/audio.ts:74-75`, 통화 칸과 무관, `M` 으로 끈다). 소리를 더하거나 바꾸지 않는다.
  4. 왼쪽 사건 카드의 전화 아이콘과 '신고 접수 중' 알약의 깜박이는 점도 그대로.
- **기억**: `localStorage` 의 `ar.call.v1` = `'1'`(펼침) / `'0'`(접힘). 읽기·쓰기 모두 `try/catch`. 값이 없거나 읽지 못하면 **펼침**. 쓰기는 `useEffect([callOpen])` 에서 한다(4.2, setState 갱신 함수 안에서 하지 않는다). 새 교대·시드 바꾸기·되감기·새로고침으로 바뀌지 않는다. `ar.settings.v1`(`runner.ts` 의 `Settings`)에 넣지 않는다 — 이 컴포넌트만 쓰는 값이라 `MapLegend` 의 `ar.legend.v1` 과 같은 방식으로 `src/ui` 안에서 끝낸다.

### 3.6 다른 화면 요소와의 관계

| 요소 | 지금 | U2 뒤 |
|---|---|---|
| 재난 특보 띠 `.disaster-banner` (가운데 맨 위, z 2, 28px) | 띠가 있으면 통화창을 top 78 로 내린다(`styles.css:347`) | 통화 칸은 오른쪽 칸에 있어 띠와 만나지 않는다(시제품: 겹친 넓이 0). `:347` 은 쓸모없어 지운다. tl·tr 을 38 로 내리는 `:346` 은 그대로 |
| 왼쪽 위 덧글 `.overlay.tl` (시점 알약·자동 감속·**이어 보기 상자**·사건 제목) | `max-width: calc(100% - 366px)` — 통화창 자리를 비워 1280 에서 198px | 통화창 자리를 비울 까닭이 없어진다: `max-width: min(560px, calc(100% - 24px))`. 단 **첫 줄(시점 알약)만** tr 단추 줄과 같은 높이이므로 `calc(100cqw - 440px)` 로 비킨다(tr 실측 379~403px). 가운데 폭이 760 미만이면(1280·1440) tl 전체를 tr 아래(top 46, 특보 띠가 있으면 74)로 내린다 — 원래 있던 1280 의 tl·tr 겹침도 함께 없어진다 |
| 오른쪽 위 단추 줄 `.overlay.tr` | top 10 (띠 있으면 38) | 그대로 |
| 지도 범례 `.maplegend` (왼쪽 아래, z 5) | — | 그대로. 통화 칸과 만나지 않는다 |
| 교통 요약 `.traffic-chip` (위 띠) | — | 그대로 |
| 작은 현장 창 (캔버스 오른쪽 아래, 232×158) | 통화창과 겹치지 않았다. 창 수 계산의 `- 330`(`Viewport.tsx:89`)은 왼쪽 아래 덧글 자리이고 통화창과 무관 | 그대로. 손대지 않는다 |
| 주요 장면 이어 보기 `.reel` (tl 안) | 1280 에서 198px 로 좁혀져 접힌다 | tl 이 넓어져 한두 줄로 펴진다. 이어 보기 동안 통화 칸은 되감긴 시각의 통화를 보여 준다(같은 시드를 다시 돌린 결과이므로 맞는 내용이다) |
| 속보 `.ticker` (가운데 아래 184) · 일시정지 `.paused` · 보고서 다시 보기 `.reopen` (fixed, right 416 — 가운데 화면의 오른쪽 아래) | — | 그대로 |
| 오른쪽 칸의 탭·판단 요약·대원 정보·기록 | 탭이 칸 맨 위 | 통화 칸 아래로 내려간다. 높이는 3.1 의 표 |
| 자동 카메라 | 통화창을 모른 채 사건을 가운데에 둔다 | 고칠 것 없음(가리는 것이 없다) |

## 4. 고칠 파일과 함수

### 4.1 `src/ui/CallDock.tsx` (새로)

```tsx
// 신고 통화창 (docs/specs/U2-call-panel.md): 오른쪽 칸 맨 위의 고정 칸. 접으면 한 줄 띠가 된다.
// 보여 주기만 한다. 접고 펴는 것은 표시 방식일 뿐, 시뮬레이션과 AI 에게는 아무 영향이 없다.
import { useEffect, useRef } from 'react';
import type { Sim } from '../sim/engine';
import type { Call } from '../sim/types';
import { personaName, topicName } from '../sim/dispatch/callSystem';
import { fmtDur, pct } from '../sim/util';
import { Icon } from './panels';

const LS_CALL = 'ar.call.v1';
const LINGER = 6;      // 끝난 통화를 '통화 종료'로 남겨 두는 시간(시뮬레이션 초). 지금의 CallPanel 과 같다

export function loadCallOpen(): boolean { try { return localStorage.getItem(LS_CALL) !== '0'; } catch { return true; } }
export function saveCallOpen(open: boolean): void { try { localStorage.setItem(LS_CALL, open ? '1' : '0'); } catch { /* 저장 실패는 무시 */ } }

export type CallMode = 'active' | 'ended' | 'ringing' | 'past' | 'none';
/** 보여 줄 통화 (3.4): 받는 중 → 끝난 지 6초 안 → 벨만 울림 → 가장 최근에 받은 통화 → 없음. sim 을 읽기만 한다. */
export function shownCall(sim: Sim): { call: Call | null; mode: CallMode; ringing: number } {
  let ringing = 0; for (const c of sim.calls) if (c.state === 'ringing') ringing++;
  if (sim.activeCall >= 0) return { call: sim.calls[sim.activeCall], mode: 'active', ringing };
  let last: Call | null = null;      // 가장 최근에 받은 통화 (받은 순서 = 번호 순서). 받기 전에 끝난 전화는 건너뛴다
  for (let i = sim.calls.length - 1; i >= 0; i--) { const c = sim.calls[i]; if (c.state === 'done' && c.answeredAt >= 0) { last = c; break; } }
  if (last && last.endedAt >= 0 && sim.t - last.endedAt < LINGER) return { call: last, mode: 'ended', ringing };
  if (ringing > 0) return { call: null, mode: 'ringing', ringing };      // 벨이 울리면 '지난 통화'보다 앞선다
  return last ? { call: last, mode: 'past', ringing } : { call: null, mode: 'none', ringing };
}

export function CallDock({ sim, truth, open, onToggle }: { sim: Sim; truth: boolean; open: boolean; onToggle: () => void }) {
  const s = shownCall(sim);
  const root = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  const click = () => { refocus.current = true; onToggle(); };
  // 단추로 접고 펴면 누른 단추가 사라지므로 반대쪽 단추로 포커스를 옮긴다 (P 키로 바꿀 때는 옮기지 않는다)
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    root.current?.querySelector<HTMLElement>(open ? '.call-toggle' : '.call-strip')?.focus();
  }, [open]);
  return (
    <section ref={root} className={`call-dock ${open ? 'open' : 'closed'}`} aria-label="신고 통화" data-call={s.call ? s.call.id : -1}>
      {open ? (<>
        <CallBody sim={sim} truth={truth} s={s} />
        {/* .call 밖에 둔다: .call.ended(0.8)·.call.past(0.55)의 흐림이 단추에 걸리지 않게 */}
        <button className="call-toggle" onClick={click} aria-expanded title="통화창 접기 (P)"><i className="chev up" /></button>
      </>) : <CallStrip sim={sim} s={s} onClick={click} />}
    </section>
  );
}
```

- `CallBody`: 지금의 `CallPanel` JSX(`panels.tsx:457-477`)를 **그대로 옮기고** 다음만 바꾼다.
  - 클래스 `call active|ended|ringing|past|none`.
  - 보여 줄 통화가 있을 때(`active`·`ended`·`past`) 머리줄은 `<div className="call-head" key={call.id}>` — 새 통화마다 다시 그려져 `.call.active` 일 때 `call-flash` 가 한 번 돈다(3.5).
  - 머리줄의 `past` 문구: `지난 통화`, `N 전 종료` / `통화 중단`(`endedAt < 0`).
  - `.queue` 줄을 머리줄의 `대기 N` 알약으로 올린다(`active`·`ended` 에서만).
  - `ringing` 은 지금의 벨 상자와 같은 머리줄 `신고 전화 대기 N건 · ● 벨 울림`, `none` 은 머리줄 없이 빈 칸 문구.
  - 접기 단추는 `CallBody` 안에 넣지 않는다(위의 `CallDock` 이 `.call` 옆에 둔다).
- `CallStrip`: 3.3 의 표대로. 띠 전체가 단추 하나이고, 새 통화마다 다시 그려지도록 보여 주는 통화의 번호를 `key` 로 준다(반짝임 한 번). 전체 문장은 단추의 `title` 에 합친다(3.3):

  ```tsx
  <button key={s.call ? s.call.id : -1} className={'call-strip st-' + s.mode + (s.mode === 'active' ? ' flash' : '')}
    onClick={onClick} aria-expanded={false} title={`${sentence} — 눌러서 펼치기 (P)`}>…</button>
  ```

  사건 칩은 `<span className="inc">{I ? I.code : '비긴급'}</span>`(`ringing`·`none` 에서는 없다). 꺾쇠는 CSS 로 그린다(`<i className="chev" />`) — `view/icons.ts` 에 그림을 더하지 않는다.
- 진실 표시 규칙은 지금의 `CallPanel` 과 같다: `truth` 일 때만 칩의 '✕'·`note`, AI 시점에서 장난 전화의 화법은 '확인 중'. 띠의 한 줄은 신고자가 실제로 한 말이라 시점과 무관하다. (머리말 '비긴급 전화'·'발신자'가 AI 시점에서도 처음부터 보이는 지금의 동작도 그대로 옮긴다 — 9절 11번.)

### 4.2 `src/ui/App.tsx`

(괄호 안은 Q1 이 먼저 합쳐졌을 때의 줄 번호 — 9절 7번.)

- `:11` 가져오기에서 `CallPanel` 을 빼고, `import { CallDock, loadCallOpen, saveCallOpen } from './CallDock';` 를 더한다.
- 상태는 **`const reelUntil = useRef(0);`(`:47`) 바로 뒤**에 세 줄 넣는다(Q1 이 `:50` 뒤에 넣는 19줄과 붙지 않게). 저장은 setState 갱신 함수 안이 아니라 `useEffect` 에서 한다(갱신 함수는 부수 효과 없이 둔다):

  ```tsx
  const [callOpen, setCallOpen] = useState<boolean>(loadCallOpen);
  const toggleCall = useCallback(() => setCallOpen((v) => !v), []);
  useEffect(() => { saveCallOpen(callOpen); }, [callOpen]);
  ```
- 단축키(`:113-134`, Q1 뒤 `:132-153`): `ArrowLeft` 앞에 한 줄, 의존성 배열에 `toggleCall`.

  ```tsx
  else if ((e.key === 'p' || e.key === 'P' || e.code === 'KeyP') && !e.ctrlKey && !e.metaKey && !e.altKey) toggleCall();
  ```

  Ctrl·Meta·Alt 가 눌려 있으면 이 줄이 맞지 않아 마지막 `else return;` 으로 빠진다(브라우저 기본 동작은 그대로).
- `:192`(Q1 뒤 `:211`) 줄(`<div className="overlay call-wrap">…`)을 지운다.
- `:196`(Q1 뒤 `:215`) `<div className="right">` 바로 안, `.tabs` 앞에 `<CallDock sim={sim} truth={truth} open={callOpen} onToggle={toggleCall} />`.

### 4.3 `src/ui/panels.tsx` (공용 파일 — 이 두 곳만)

- `:447-479` 의 `// ── 중앙: 신고 통화창 ──` 머리 주석과 `CallPanel` 을 지운다(내용은 4.1 로 옮겼다). `personaName`·`topicName`·`fmtDur`·`pct` 는 다른 패널이 계속 쓰므로 가져오기는 그대로 둔다.
- `LogPanel`(`:155` 부터): 기록 칸의 높이가 바뀌어도(통화 칸을 접고 펼 때, 3.1 의 비율) 맨 아래에 붙어 있던 기록이 맨 아래를 계속 보이게 한다. 지금은 새 기록이 들어올 때만 맨 아래로 내린다.

```tsx
  // 칸의 높이가 바뀌어도(통화 칸을 접고 펼 때) 맨 아래에 붙어 있던 기록은 맨 아래를 계속 보여 준다
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el); return () => ro.disconnect();
  }, []);
```

### 4.4 `src/ui/styles.css`

**지우는 두 줄** (통화창 상자가 없어져 아무것도 가리키지 않는다):
- `:150` `.overlay.call-wrap { top: 50px; right: 12px; width: 330px; flex-direction: column; }`
- `:347` `.app:has(> .disaster-banner) .overlay.call-wrap { top: 78px; }` (disaster 블록. 바로 위 `:346` 은 그대로)

`:151-170` 의 `.call`·`.call-head`·`.bubbles`·`.bub`·`.extracted`·`.chip2`·`.queue` 와 `:171-173` 의 `@keyframes blink/pulse/rise` 는 **그대로 두고 다시 쓴다.**

**파일 끝에 붙이는 블록** (시제품에서 잰 값. 색과 반지름은 U1 의 변수):

```css
/* ── U2 ── 통화창: 가운데 화면 위에 떠 있던 상자를 오른쪽 칸 맨 위의 고정 칸으로 옮기고, 한 줄 띠로 접을 수 있게 한다 */
.call-dock { position: relative; flex: none; height: clamp(176px, 25vh, 224px); display: flex; flex-direction: column; overflow: hidden; background: var(--panel); border-bottom: 1px solid var(--line); transition: height 0.18s ease; }
.call-dock.closed { height: 34px; }
.call-dock .call { flex: 1; min-height: 0; display: flex; flex-direction: column; background: transparent; border: none; border-radius: 0; box-shadow: none; padding: 5px 14px 10px; }
.call-dock .call.past { opacity: 0.55; }
.call-dock .call-head { min-height: 24px; padding-right: 28px; }     /* 오른쪽 28px 은 겹쳐 놓는 접기 단추 자리 */
.call-dock .call.active .call-head { border-radius: var(--r1); animation: call-flash 1.2s ease-out 1; }     /* 새 통화: 머리줄을 통화 id 로 다시 그려 한 번 */
.call-dock .call-sub { margin: 3px 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.call-dock .bubbles { flex: 1; min-height: 0; overflow: hidden; justify-content: flex-end; -webkit-mask-image: linear-gradient(to bottom, transparent, #000 18px); mask-image: linear-gradient(to bottom, transparent, #000 18px); }
.call-dock .bub { flex: none; }
.call-dock .extracted { flex-wrap: nowrap; overflow: hidden; margin-top: 6px; }
.call-dock .extracted > * { flex: none; }      /* 라벨·칩이 줄어들지 않는다. 빠뜨리면 'AI가 정리한 정보' 가 세 줄로 접힌다 */
.call-dock .chip2 { white-space: nowrap; }
.call-dock .queue { margin: 0; padding: 0 7px; border: 1px solid rgba(255, 180, 84, 0.6); border-radius: 999px; font-size: 11px; white-space: nowrap; }
.call-dock .empty { padding: 8px 0; }
/* 접기 단추: .call 밖(.call-dock 의 직접 자식)에 두고 머리줄 오른쪽 끝에 겹친다 — .call 의 흐림이 걸리지 않는다 */
.call-toggle { position: absolute; top: 5px; right: 10px; width: 24px; height: 24px; padding: 0; display: grid; place-items: center; background: transparent; border-color: transparent; color: var(--text2); }
.call-toggle:hover { border-color: var(--line); }
.call-dock .chev { width: 7px; height: 7px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translateY(-2px) rotate(45deg); flex: none; }     /* 아래 꺾쇠 = 펼치기 */
.call-dock .chev.up { transform: translateY(2px) rotate(-135deg); }                                                                                                 /* 위 꺾쇠 = 접기 */
.call-strip { width: 100%; height: 34px; display: flex; align-items: center; gap: 7px; padding: 0 12px 0 14px; background: transparent; border: none; border-radius: 0; text-align: left; font-size: 12px; color: var(--text); }
.call-strip:hover { background: var(--surface); } .call-strip:active { transform: none; }
.call-strip .ring { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #1d2b38; }
.call-strip .ring.on { animation: pulse 1.1s ease-out infinite; }
.call-strip.st-past .ring, .call-strip.st-none .ring, .call-strip.st-past .inc { opacity: 0.55; }     /* 지난 통화의 사건 번호도 흐리게 — 지금 사건으로 읽히지 않게 */
.call-strip .inc { flex: none; background: #6b7f92; color: #0b1219; border-radius: var(--r1); padding: 0 5px; font-weight: 800; font-size: 11px; font-variant-numeric: tabular-nums; }
.call-strip .line { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text2); }
.call-strip .dur { flex: none; font-family: var(--mono); font-variant-numeric: tabular-nums; color: var(--text2); }
.call-strip .live { flex: none; color: #ff6b6b; font-size: 11px; animation: blink 1s steps(2) infinite; }
.call-strip.flash { animation: call-flash 1.2s ease-out 1; }
@keyframes call-flash { from { background: rgba(255, 107, 107, 0.22); } }
/* 남은 높이는 판단 요약 : 기록 = 46 : 54 (지금은 판단 요약이 칸 전체의 46% 고정) */
.right-top { flex: 46 1 0; }
.right-bottom { flex: 54 1 0; min-height: 120px; }
/* 왼쪽 위 덧글: 통화창 자리(366px)를 비울 까닭이 없어졌다. 첫 줄만 오른쪽 위 단추 줄을 비키고, 가운데가 좁으면 단추 줄 아래로 내린다 */
.overlay.tl { max-width: min(560px, calc(100% - 24px)); }
.overlay.tl > .cam-reason:first-child { max-width: calc(100cqw - 440px); }
@container (max-width: 759px) {
  .overlay.tl { top: 46px; }
  .app:has(> .disaster-banner) .overlay.tl { top: 74px; }
  .overlay.tl > .cam-reason:first-child { max-width: 100%; }
}
```

메모: 움직임 줄이기(`prefers-reduced-motion`)는 `styles.css:254` 의 전역 규칙이 전환·애니메이션을 모두 끄므로 이 블록에 따로 쓰지 않는다. `.right-top`·`.right-bottom`·`.overlay.tl` 은 앞쪽의 같은 선택자를 뒤에서 덮어쓴다(앞의 줄은 고치지 않는다). 특보 띠가 있을 때의 `top: 38px`(`:346`, 선택자가 더 구체적이다)은 넓은 화면에서 그대로 이기고, 좁은 화면에서는 위의 `74px` 줄이 이긴다. `100cqw` 의 기준은 `.center`(`:75` 의 `container-type: inline-size`).

## 5. 구현 순서

1. **준비**: `git checkout -b wf/u2`. 고치기 전 기준을 저장소 밖에 남긴다 — `npx tsx scripts/sweep.ts 12 > <scratchpad>/u2-before.txt`, 그리고 6절의 스크립트를 고치기 전에 한 번 돌려 `before-*.png`(1절의 조사 그림은 조사 세션의 임시 파일이라 없다).
2. `src/ui/CallDock.tsx` 를 만든다: `CallPanel` 의 JSX 를 옮긴 `CallBody`, `shownCall`, 저장 함수. 아직 `CallStrip` 은 빈 껍데기.
3. `App.tsx`: `:192` 를 지우고 오른쪽 칸 맨 위에 `<CallDock … open />`. `panels.tsx` 의 `CallPanel` 을 지운다. `styles.css` 끝에 U2 블록의 앞부분(`.call-dock`~`.chip2`, `.right-top`·`.right-bottom`). `npx tsc --noEmit`. 개발 서버(`npx vite --port 5214 --strictPort`)로 **펼친 칸이 지금 통화창과 같은 내용**인지 본다.
4. `CallStrip`, 접기 단추, `callOpen` 상태·`P` 키·저장, 띠의 CSS. 접고 펴고 새로고침해 본다.
5. 지난 통화·통화 중단·벨만 울림(받는 통화 없음)·없음 상태(3.4)를 맞춘다. 펼친 칸 머리줄의 새 통화 반짝임, 띠 `title`, 단추 포커스(3.5).
6. `LogPanel` 의 `ResizeObserver`. `styles.css` 의 두 줄(`:150`, `:347`) 삭제와 tl 규칙.
7. 6절의 화면 확인 전체. 콘솔 오류 0건.
8. 7절의 시뮬레이션 불변 확인, 마지막에 `npm run check` 한 번.
9. 커밋(한국어, `wf/u2` 에만, 푸시하지 않는다). 작은 단위로: "U2 통화창: 오른쪽 칸 맨 위로 옮김" → "U2 통화창: 접는 띠와 P 키, 접힘 기억" → "U2 왼쪽 위 덧글의 폭과 자리".

## 6. 화면 확인 절차

`scripts/screenshot.cjs` 의 방식으로 저장소 밖(scratchpad)에 `u2check.cjs` 를 만들어 Playwright 로 돈다(`NODE_PATH=/opt/node-tools/node_modules`). 개발 서버는 `npx vite --port 5214 --strictPort`(아래 도우미의 `BASE` 도 5214. 조사 때의 시제품은 5197 을 썼다 — 그 값을 옮겨 오지 않는다). 크기 **1600×900, 1440×900, 1280×800** 셋 다(1440 은 가운데가 724px 라 넓은 캔버스에서 좁은 화면 분기(3.6)를 확인하고, U1 이 검사한 크기이기도 하다). 주소는 **`/?seed=S3&disaster=none`** — `/?seed=S3` 만 쓰면 브라우저 기본값인 재난 '무작위'(`runner.ts:50`)가 걸린다. 지금 S3 에는 재난이 없지만 다른 묶음이 난수 흐름을 바꾸면 달라질 수 있다(`parseDisaster` 가 `none` 을 받는다). 특보 띠 장면만 `disaster=typhoon`. 3배속(키 `2`). 시작 전에 `localStorage.removeItem('ar.call.v1')`.

측정 도우미 (겹친 넓이 함수 `inter` 는 조사 때의 시제품 스크립트에서 옮겼고, 나머지는 이 절의 측정에 맞춰 적었다 — 이대로 붙여 쓴다):

```js
// <scratchpad>/u2check.cjs 의 뼈대. 실행: NODE_PATH=/opt/node-tools/node_modules node <scratchpad>/u2check.cjs
const { chromium } = require('playwright');
const BASE = 'http://localhost:5214';
/** 두 상자({x, y, width, height})가 겹친 넓이 */
const inter = (a, b) => { if (!a || !b) return 0; const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.height, b.y + b.height); return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0; };
/** 한 번 재기: 상자들, 가운데 안의 통화창 수, 보여 주는 통화의 id(.call-dock 의 data-call) */
const measure = (page) => page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
  const dock = document.querySelector('.call-dock');
  return { center: r('.center'), canvas: r('.center canvas'), dock: r('.call-dock'), top: r('.right-top'), bottom: r('.right-bottom'),
    pill: r('.overlay.tl > .cam-reason'), tl: r('.overlay.tl'), tr: r('.overlay.tr'), banner: r('.disaster-banner'),
    inCenter: document.querySelectorAll('.center .call, .center .call-strip').length, call: dock ? Number(dock.dataset.call) : -1 };
});
/** ms 동안 0.15초마다 재어 가장 나쁜 값을 모은다 */
async function watch(page, ms = 60000) {
  const st = { overlap: 0, inCenter: 0, hMin: 1e9, hMax: 0, canvasW: new Set(), pillTr: 0 };
  for (const t0 = Date.now(); Date.now() - t0 < ms; ) {
    await page.waitForTimeout(150);
    const m = await measure(page);
    st.overlap = Math.max(st.overlap, inter(m.dock, m.center)); st.inCenter = Math.max(st.inCenter, m.inCenter);
    st.hMin = Math.min(st.hMin, m.dock.height); st.hMax = Math.max(st.hMax, m.dock.height);
    st.canvasW.add(Math.round(m.canvas.width)); st.pillTr = Math.max(st.pillTr, inter(m.pill, m.tr));
  }
  return { ...st, canvasW: [...st.canvasW] };
}
/** 기록 칸이 맨 아래에 붙어 있는가 (접고 펴고 300ms 뒤에 부른다) */
const stuck = (page) => page.evaluate(() => { const el = document.querySelector('.scroll.log'); return el.scrollHeight - el.scrollTop - el.clientHeight < 2; });
// 크기마다: const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
//   page.on('console', …error…) · page.on('pageerror', …) 로 오류를 모으고, 아래 장면을 차례로 찍는다
```

찍을 장면(각 크기마다):
1. `open` — 통화 중, 대사 4줄 이상 + 정리한 정보 칩이 있을 때(`.call-dock .call.active .extracted`).
2. `closed` — `P` 로 접은 뒤 통화 중.
3. `closed-new` — 접힌 채 새 통화를 받은 직후. 기준은 `.call-dock` 의 `data-call` 이다. `.call-strip.flash` 는 통화가 이어지는 동안 계속 붙어 있어 통화 중에 접는 순간 바로 걸리고, "띠의 사건 번호가 바뀐 순간"은 추가 신고(같은 사건 번호)와 비긴급 전화(번호 없음)를 놓친다.

   ```js
   const c0 = (await measure(page)).call;                  // 접은 순간의 통화
   for (const t0 = Date.now(); Date.now() - t0 < 90000; ) {
     await page.waitForTimeout(100);
     const m = await measure(page);
     if (m.call >= 0 && m.call !== c0) { await page.screenshot({ path: `${OUT}/closed-new-${W}.png` }); break; }   // 0.3초 안에 찍는다
   }
   ```
4. `idle` — 통화가 끝나고 6초 넘게 지나 '지난 통화'일 때(펼침).
5. `scene` — 현장 화면에서 다른 사건의 통화가 진행 중일 때. 조사 때 통화창이 현장을 덮던 장면이다. '현장 대응' 사건 카드(`.card.incident` 중 `.badge.phase-onscene` 이 있는 것)가 생기면 눌러 고정하고, 통화 칸의 사건 번호(`.call-dock .call.active .inc`)가 고정한 사건과 다를 때 찍는다. S3 에서 이 장면이 처음 생기는 때는 t=186초(헤드리스)라 3배속으로 약 62초 걸린다 — **기다리는 상한은 90초 이상**(시제품 스크립트의 40초로는 모자란다).
6. `banner` — `/?seed=S3&disaster=typhoon` 를 15배속(`4`)으로 돌려 특보 띠가 뜬 뒤 일시정지. 특보는 t=198초부터(헤드리스)라 15배속으로 약 13초, 상한 40초.
7. `reel` (1280 만) — 타임라인 `.timeline .track` 의 **오른쪽 끝을 한 번** 누른다. 그러면 `((x−left)/width) × max(shiftLen, t)` ≈ 1199초로 가지만(`panels.tsx:320`·`:334`) 교대가 끝나지는 않는다(S3 는 1218초에 끝난다, 헤드리스). 그 뒤 15배속(`4`)으로 보고서 창(`.modal-back .modal h2` '교대 종료 보고서')이 뜰 때까지 기다리고(상한 60초), '주요 장면 이어 보기'를 누른 뒤 찍는다. 끝을 다시 누르지 않는다 — 이동 뒤에는 진행 중인 사건 막대가 오른쪽 끝까지 닿아 클릭을 받고(`stopPropagation`, `:341`) 관찰 고정만 된다.

잴 것(보고에 숫자로 적는다):
- **가운데 화면을 가리는 넓이: 0** — `watch()` 로 60초 동안 0.15초마다 `.call-dock` 과 `.center` 의 상자가 겹친 넓이가 0, `.center` 안의 `.call`·`.call-strip` 이 0개(펼침·접힘 모두, 세 크기 모두). U2 의 목표는 "접힘 3% 이하"보다 강한 **어느 상태에서나 0%** 다.
- **가운데 캔버스 폭이 변하지 않는다**: 펼침·접힘·고치기 전 모두 884(1600), 724(1440), 564(1280).
- **통화 칸 높이가 튀지 않는다**: 60초 동안의 최솟값 = 최댓값 = 224(1600·1440) / 200(1280), 접힘 34(±1).
- 오른쪽 칸: 1280×800 펼침에서 판단 요약 ≥ 190, 기록 ≥ 220. 접힘에서 판단 요약 ≥ 260, 기록 ≥ 300.
- **겹침 없음**:
  - 첫 줄 알약 `.overlay.tl > .cam-reason` 과 `.overlay.tr` 의 겹친 넓이 0 — 세 크기, 특보 띠 있을 때와 없을 때. **tr 이 가장 넓은 때(현장 화면, '지도에서 보기' 단추가 있을 때 — 5번 장면)에서 잰다.** 1280 은 고치기 전에 겹쳐 있었다. (`.overlay.tl` 전체 상자로 재면 1600 에서 둘째 줄 이하의 폭 때문에 tr 과 겹친 것처럼 나온다 — 첫 줄 알약으로 잰다.)
  - `.disaster-banner` 와 `.overlay.tl` 겹침 0, `.disaster-banner` 와 `.call-dock` 겹침 0.
- **기억**: 접고 새로고침하면 접혀 있고(`ar.call.v1 === '0'`), 펴고 새로고침하면 펼쳐져 있다.
- **기록 맨 아래 붙음**: 기록 칸이 맨 아래에 붙어 있을 때 접고 300ms 뒤, 펴고 300ms 뒤 각각 `stuck()` 이 참(`scrollHeight − scrollTop − clientHeight < 2`).
- 콘솔 오류·페이지 오류 0건(모든 장면).
- 15배속에서 위 띠의 FPS 가 고치기 전과 같은 수준(조사 때 52~57). FPS 글자(`panels.tsx:371` 의 `.top .meta .dim`)는 1400px 이하에서 숨는다(`styles.css:362`) — **1600 에서 재거나** `document.querySelector('.top .meta .dim').textContent` 로 읽는다.

모든 그림을 직접 열어 본다: 글자 잘림·겹침·넘침이 없는지, 접힌 띠의 한 줄이 말줄임으로 끝나는지, 펼친 칸의 맨 위 대사가 페이드로 잘리는지.

## 7. 시뮬레이션 결과 불변 확인

- `git diff --stat <시작 커밋> -- src/sim src/view` 가 **비어 있다**.
- `npx tsx scripts/sweep.ts 12` 의 `outcomes` 줄과 `close reasons` 줄이 1단계의 `u2-before.txt` 와 **한 글자도 다르지 않다**(화면만 고쳤다).
- `npx tsc --noEmit`, `npx vitest run tests/ext.test.ts`, 마지막에 `npm run check` 한 번.
- 코드 읽기로 확인: `CallDock` 은 `sim.calls`·`sim.incidents` 를 읽기만 한다(정렬·`splice`·대입 없음. `data-call` 도 읽은 id 를 적을 뿐이다). 시간 판단(6초 남김, 'N 전')은 `sim.t` 로, 띠의 반짝임만 실제 시간(CSS 애니메이션)이다. 소리(`SoundDirector`)는 통화 칸의 상태를 모른다.

## 8. Q1 화면 자동 테스트에 넣을 검사

Q1 은 `wf/q1` 브랜치에 있다(커밋 `07a1fb8`·`d2f5439`·`1e9538b`, 검토 때 아직 합쳐지지 않음). Q1 이 먼저 합쳐져 있으면 그 검사 목록에 아래 8번 항목을 더하고, 아직이면 6절의 스크립트로 같은 검사를 하고 보고에 "Q1 에 넣을 검사"로 적어 둔다.

Q1 의 `scripts/ui-check.cjs` 에서 알아 둘 것:
- 판정은 `result(n, ok, line, details)` 로 남긴다(`check` 가 아니다). 항목은 1~7번이고 머리 주석에 "일곱 가지"라고 적혀 있다. 끝에서 `for (let n = 1; n <= 7; n++)` 와 `names` 표로 찍는다.
- 창은 `browser.newContext({ viewport: { width: 1600, height: 900 } })` 로 고정되어 있고, 개발 서버는 스스로 포트 5191 에 띄운다.
- 도우미 `reload()`(새로고침 + 관찰 고리 기다리기), `blur()`(포커스 풀기), `sleep(ms)`, `speedBtn(v)` 가 있다.
- 순서는 준비 → 2 → 3 → 4 → 6 → 5(교대 끝까지) → 7 → 1(오류)이다. 통화가 있어야 하므로 **6번과 5번 사이**(`// ── 5. 최고 배속으로 교대 끝까지 ──` 바로 앞)에 넣는다.

더할 것: 아래 블록, 머리 주석의 "일곱 가지" → "여덟 가지"와 `//   8. 통화창이 가운데 화면을 가리지 않고, P 로 접히며 접힘을 기억한다 (1280×800)` 한 줄, 끝의 `n <= 7` → `n <= 8`, `names` 에 `8: '통화창 자리'`.

```js
  // ── 8. 통화창(U2): 가운데 화면을 가리지 않는다 · P 로 접히고 새로고침해도 기억한다 · 가운데 캔버스 폭은 그대로 (1280×800) ──
  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await speedBtn(3).click(); await blur();
    await page.waitForSelector('.call-dock .call.active', { timeout: 90000 });
    const r = await page.evaluate(() => {
      const b = (s) => document.querySelector(s).getBoundingClientRect();
      const c = b('.center'), d = b('.call-dock');
      const ix = Math.max(0, Math.min(c.right, d.right) - Math.max(c.left, d.left)), iy = Math.max(0, Math.min(c.bottom, d.bottom) - Math.max(c.top, d.top));
      return { overlap: ix * iy, inCenter: document.querySelectorAll('.center .call, .center .call-strip').length };
    });
    const cw = () => page.evaluate(() => document.querySelector('.center canvas').getBoundingClientRect().width);
    const dockH = () => page.evaluate(() => document.querySelector('.call-dock').getBoundingClientRect().height);
    const w0 = await cw();
    await blur(); await page.keyboard.press('p'); await sleep(300);      // 시드 입력칸에 포커스가 남아 있으면 App.tsx 의 키 처리기가 P 를 무시한다
    const h = await dockH(), w1 = await cw();
    const closed = !!(await page.$('.call-dock.closed')) && h <= 36 && w1 === w0;
    await reload(); await sleep(600);
    const remembered = !!(await page.$('.call-dock.closed'));
    await blur(); await page.keyboard.press('p'); await sleep(300);
    const reopened = !!(await page.$('.call-dock.open'));
    await page.evaluate(() => localStorage.removeItem('ar.call.v1'));      // 다른 검사는 기본값(펼침)에서 시작
    result(8, r.overlap === 0 && r.inCenter === 0 && closed && remembered && reopened,
      `가운데와 겹친 넓이 ${r.overlap} · 가운데 안의 통화창 ${r.inCenter}개 · P 로 접힘 ${closed ? `맞음(${Math.round(h)}px, 캔버스 ${w0}→${w1})` : '틀림'} · 새로고침 뒤 접힘 ${remembered ? '맞음' : '틀림'} · 다시 펼침 ${reopened ? '맞음' : '틀림'}`);
  } catch (e) { result(8, false, `예외: ${e.message.split('\n')[0]}`); }
  await page.setViewportSize({ width: 1600, height: 900 });      // 뒤의 검사는 1600×900 그대로
```

Q1 의 7번(조작 목록)에는 오른쪽 칸의 '통화창 접기 (P)' 단추(또는 접힌 띠)가 새로 나타난다 — 표시 방식 조작이다(3.5). 새로고침으로 `loads` 가 하나 늘어나는 것은 1번 판정에 영향이 없다.

## 9. 알려진 위험

1. **오른쪽 칸이 좁아진다.** 1280×800 에서 펼치면 판단 요약 308→200, 기록 325→233. 두 칸 모두 스크롤되고, 접으면 거의 되돌아온다(276 / 323). 그래도 좁다는 말이 나오면 `.call-dock` 높이의 최댓값(224)만 낮춘다 — 46:54 비율이나 가운데 화면을 건드리지 않는다.
2. **고정 높이라 긴 대사·많은 칩이 잘린다.** 위쪽 페이드와 칩 한 줄로 처리하고, 전체 대사는 오른쪽 아래 기록에 그대로 남는다. 줄 수를 늘리려고 높이를 내용에 맞추면 오른쪽 칸이 통화마다 튄다(3.1) — 그렇게 하지 않는다.
3. **기록의 맨 아래 붙음.** 칸 높이가 바뀌면 붙음이 풀린 것처럼 보일 수 있다 → 4.3 의 `ResizeObserver`. 빠뜨리면 접고 펼 때 마지막 몇 줄이 다음 기록이 올 때까지 가려진다.
4. **지난 통화를 '지금 통화'로 오해**할 수 있다 → 흐림 0.55, 머리말 `지난 통화 · N 전 종료`, 빨간 점·입력 중 표시 없음. 통화 도중 사건이 닫힌 통화(`endedAt === -1`)는 '통화 중단'으로 쓴다(시각 계산에 -1 을 넣지 않는다).
5. **tl 을 넓히면서 tr 과 겹칠 수 있다.** 첫 줄만 440px 비키는 값은 tr 실측 379~403px 에 기댄다. 다른 묶음이 tr 에 단추를 더하면 이 값을 다시 잰다(6절의 겹침 검사가 잡는다).
6. **한글 입력 상태**: `P` 는 `e.code === 'KeyP'` 도 받으므로 한글 입력 상태에서도 된다(3.5). 다른 글자 키(A·C·T·M·S·Z)가 한글 입력 상태에서 먹지 않는 것과 Ctrl·Meta·Alt 를 가리지 않는 것은 기존 문제로, 이 묶음에서 고치지 않는다.
7. **다른 작업과의 충돌**:
   - B3·P1 은 `src/ui` 를 건드리지 않는다(검토 때 확인).
   - **Q1: `App.tsx`** — `:50` 뒤에 `window.__ar` 관찰 고리 19줄을 넣는다(`wf/q1`, 아직 합쳐지지 않음). Q1 이 먼저 합쳐지면 이 문서의 `App.tsx` 줄 번호가 밀린다: `:113-134` → `:132-153`, `:115` → `:134`, `:116` → `:135`, `:192` → `:211`, `:196` → `:215`(`:11`·`:46`·`:47` 은 그대로). U2 의 상태 세 줄을 `const reelUntil = useRef(0);`(`:47`) 바로 뒤에 넣는 것은 Q1 의 삽입과 붙지 않게 하려는 것이다.
   - 이 묶음이 고치는 곳은 `CallPanel` 한 덩어리 삭제, `LogPanel` 몇 줄, `styles.css` 의 두 줄 삭제와 끝 블록, `App.tsx` 의 4.2 다섯 곳뿐이다. 합칠 때 충돌이 나면 양쪽을 살린다.
   - 다른 브랜치가 `.overlay.call-wrap`·`CallPanel` 을 새로 붙잡았는지 합치기 전에 `git grep -n "call-wrap\|CallPanel"` 으로 본다(검토 때는 없었다. `wf/q1` 의 `App.tsx:211` 은 같은 줄이 밀린 것이다).
8. **브라우저 지원**: `:has()` 와 container query 는 이미 쓰고 있다. `mask-image` 는 `-webkit-` 접두사도 함께 쓴다.
9. **창이 아주 낮을 때**(720 이하): 칸 높이는 최솟값 176 으로 멈춘다. 1280×720 에서 판단 요약 ≈ 170, 기록 ≈ 200. 접으면 된다.
10. 반짝임은 처음 그릴 때도 한 번 일어난다: 띠는 새로고침·통화 중에 접을 때, 펼친 칸의 머리줄은 새로고침·통화 중에 펼 때. 해가 없어 막지 않는다.
11. **AI 시점의 기존 표시 문제 (메모만)**: AI 시점에서도 '비긴급 전화' 머리말과 '발신자'가 처음부터 보인다. `call.kind` 는 진실이고, AI 의 분류는 통화가 끝날 때 나온다(`callSystem.ts:363-366` 의 '비긴급 전화로 분류'). 지금 `CallPanel` 의 동작을 그대로 옮기는 것이고, 띠의 `비긴급` 칩도 같은 정보다. 이 묶음은 화면의 자리만 바꾸므로 고치지 않는다. 고치려면 AI 시점(`!truth`)에서 통화가 끝날 때까지 '신고 통화'·'신고자'로 쓰고 띠의 칩을 비운다.

**하지 않는 것**: 새 통화에 저절로 펼치기, 칸 크기를 끌어서 바꾸기, 통화창을 따로 띄우기, 여러 통화를 나란히 보기(접수 AI 가 한 통화만 받는다), 통화 칸의 사건 번호를 눌러 관찰 고정(지금도 사건 카드·기록으로 된다), 소리 바꾸기, 카메라가 통화창을 피하게 하기, 설정(`ar.settings.v1`)에 넣기, 작은 현장 창의 자리 계산 바꾸기.

**나중 과제 (이 묶음 밖)**: 1280 에서 판단 요약이 200px 가 되는데, 그 ① '신고 접수 AI — 확보한 정보'(`panels.tsx:217-229`)가 바로 위 통화 칸의 칩과 같은 내용을 되풀이한다. 관찰 중인 사건과 통화 칸의 사건이 같을 때 ① 을 한 줄로 줄이면 판단 요약의 자리를 돌려받을 수 있다.

## 10. 완료 조건과 보고

- 6절의 수치가 모두 목표 안: 가운데를 가리는 넓이 0(모든 상태), 캔버스 폭 불변, 통화 칸 높이 고정, tl·tr·띠 겹침 0, 콘솔 오류 0건.
- 7절: `src/sim`·`src/view` 무변경, `sweep 12` 의 `outcomes`·`close reasons` 가 전과 같다, `npm run check` 통과.
- 보고(마지막 응답): 브랜치와 마지막 커밋, 고치기 전 → 고친 뒤 스크린샷 경로를 짝지어(1600·1440·1280 × 펼침·접힘·특보 띠·현장 화면, 1280 이어 보기), 6절의 수치, 고친 공용 파일(`App.tsx` 의 4.2 다섯 곳, `panels.tsx` 의 `CallPanel` 삭제·`LogPanel` 몇 줄, `styles.css` 의 두 줄 삭제와 끝 블록 — 파일·함수·이유), Q1 에 넣을 검사를 넣었는지.
- 합치는 사람이 고칠 문서:
  - `README.md` 조작 표(`:46-68`)에 한 줄: `` | `P` | 신고 통화창 접기 / 펼치기 (오른쪽 칸 맨 위). 표시 방식일 뿐이다 | ``
  - `README.md` 화면 구성(`:103-109`): '가운데'의 "통화 중에는 신고 통화창이" 를 빼고, '오른쪽 위' 앞에 "**오른쪽 맨 위**: 신고 통화창(접으면 한 줄 띠, `P`)." 를 넣는다.
  - `docs/specs/N6-disaster.md:94` 의 메모 끝에 "U2 에서 통화창을 오른쪽 칸으로 옮겨 `.call-wrap` 줄은 지웠다" 를 덧붙인다.
  - `docs/specs/README.md` 표에 U2 줄, `docs/ROADMAP.md` 의 완료 목록.

## 검토 메모

독립 검토(설계서만 읽고 코드·브랜치·정적 렌더로 대조)의 지적은 모두 위 본문에 반영했다. 고른 방식이 검토의 제안과 조금 다른 곳과 그 까닭만 적는다.

- **접기 단추의 흐림**(3.2, 4.1, 4.4): 검토는 두 방법(단추를 `.call-dock` 의 직접 자식으로 빼기 / 흐림을 `.call-head` 밖에만 걸기)을 냈다. 앞의 것을 골랐다. 뒤의 것은 `styles.css:153` 의 `.call.ended { opacity: 0.8 }` 를 되돌리는 규칙과 자식별 규칙이 더 필요하고, 흐림을 거는 자리가 상태마다 흩어진다.
- **`data-call`**(3.5, 6절 3번): 검토는 `.call-strip` 과 `.call-dock` 둘 다에 달자고 했다. `.call-dock` 한 곳에만 단다. 펼침·접힘 어느 상태에서나 그 요소가 있어 한 곳이면 충분하다.
- **포커스 옮기기**(3.5): 단추로 접고 펼 때만 옮긴다. `P` 키로 바꿀 때는 옮기지 않는다. 키보드로 보던 자리를 빼앗지 않으려는 것이다.
- **움직임 줄이기 줄**(4.4): 검토는 "지워도 되고 둬도 된다"고 했다. 지웠다. `styles.css:254` 의 전역 규칙과 겹친다.
- **AI 시점의 '비긴급 전화' 머리말**(9절 11번): 검토의 뜻대로 메모만 남기고 동작은 바꾸지 않는다. 지금 동작을 그대로 옮기는 것이 이 묶음의 범위다.
- **판단 요약 ① 의 중복**(9절 끝 '나중 과제'): 메모만 남긴다. 이 묶음 밖이다.
- **Q1 커밋 범위**(8절): 검토는 `07a1fb8…d2f5439` 라고 적었다. 검토 시점의 `wf/q1` 에는 `1e9538b` 가 하나 더 있다. 이것도 `ui-check.cjs` 를 고치지만 `result`·1~7번 구조와 `App.tsx` 의 19줄은 같다.
- 헤드리스 시각(S3: 통화 28건, 통화 중 47.4%, 현장 진행 중 + 다른 사건의 통화는 t=186초, 태풍 특보는 t=198초, 교대 끝 1218초)은 검토의 측정 스크립트를 다시 돌려 같은 값을 얻었다.
