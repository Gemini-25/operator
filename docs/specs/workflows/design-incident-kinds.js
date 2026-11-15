export const meta = {
  name: 'design-incident-kinds',
  description: '사건 종류 다양화 설계서 둘(N8 일상 사건 · N9 큰 사건과 새 장소)을 쓴다: 조사 → 설계안 둘 → N8 초안·검토·반영 → N9 초안·검토·반영 (사용자 결정 열네 가지 반영)',
  phases: [
    { title: 'Research', detail: '지금의 사건과 화면 · 확장 비용과 빈 자리 · 뒤 묶음의 능력 · 실제 긴급구조의 사건 종류 · 결정이 요구하는 새 틀' },
    { title: 'Propose', detail: '관점이 다른 설계안 둘 (유형 체계 / 전개·규칙·부대·장소)' },
    { title: 'Write N8', detail: 'docs/specs/N8-incident-kinds.md 초안 — 일상 사건과 공통 틀' },
    { title: 'Review N8', detail: '독립 검토 두 갈래' },
    { title: 'Revise N8', detail: '검토 반영' },
    { title: 'Write N9', detail: 'docs/specs/N9-major-kinds.md 초안 — 큰 사건과 새 장소' },
    { title: 'Review N9', detail: '독립 검토 두 갈래' },
    { title: 'Revise N9', detail: '검토 반영, 표에 넣을 줄' },
  ],
}

const P = args
const SP = P.scratch + '/wf-kinds'
const SPEC = 'docs/specs/N8-incident-kinds.md'
const PTR = 'wf/kinds-spec'
const BASE = P.base
const ATTR = P.attr || ''   // 커밋 메시지 끝에 붙일 줄(세션마다 다르다 — args.attr 로 넘긴다)

const CTX = [
  '## 배경',
  '이 저장소는 관찰 전용 자율형 긴급구조 시뮬레이션이다(저장소 안내서 CLAUDE.md 는 이미 받았다). 사용자가 2026-11-15 에 이렇게 요청했다: "다 하고 사건 종류 다양화도 좀 하자. 종류가 적으니까 이것도 설계 적어놔".',
  '뜻: 지금 진행 중인 일곱 묶음(R1 → H1 → X6 → R2 → R3 → I1-b → I2)을 다 끝낸 뒤에 할 **여덟째 묶음 N8 "사건 종류 다양화"** 의 설계서를 지금 써 둔다. 이번 일에서 코드는 고치지 않는다.',
  '- 설계서 파일: ' + SPEC + ' (구현 브랜치 wf/kinds, 시험 파일 tests/kinds.test.ts, 개발 서버 포트 5236)',
  '- 지금의 사건: 유형 8개(화재 fire · 교통사고 traffic · 실종 search · 무장 armed · 응급 medical · 붕괴 collapse · 가스 누출 hazmat · 수난 water). 유형마다 기본 시나리오가 있고 변형이 23개다 — 생활(쓰러진 나무·맨홀 추락·승강기 갇힘·가정 폭력·침입 절도), 추격(난폭 운전·납치), 강력 범죄(폭발물·폭파 협박·수상한 물건·대형 인질극·도주 차량·폭동·방화), 대형 사고(비행기 추락·선박 화재·열차 탈선·가스 폭발·크레인 붕괴·다중 추돌), 재난(산불·산사태·해안 대피). 정확한 목록과 몫은 src/sim/scenarios.ts 와 src/sim/scenarios/*.ts 에 있다(기본 시나리오 안의 변주 — 예: 응급·실종의 하위 갈래 — 도 거기와 builders.ts·hazards.ts 에서 확인한다).',
  '- 구현 상태(2026-11-15): R1(부대 편성·개인 장비·헬기)은 다 합쳐졌다. H1(부상과 사망)은 구현 중(단계 3 까지 주 브랜치), X6(위험의 현실화)는 단계 1(상태만)만 있고, R2(대응 방식)·R3(교본)·I1-b(인과 규칙)·I2(교대 간 지속)는 설계서만 있다. N8 은 일곱이 모두 합쳐진 뒤에 구현되므로 설계서는 "일곱 묶음이 합쳐져 있다"고 보고 쓰되, 아직 코드에 없는 이름은 "구현 전에 실제 이름 확인"으로 표시한다(각 설계서 끝의 구현 메모가 그때의 정본).',
  '- 설계서들의 공통 규칙과 모양: docs/specs/README.md. 본보기: docs/specs/N4b-crime.md · N5-major.md · N6-disaster.md(시나리오 묶음 — 레지스트리로 끼워 넣는 방식), docs/specs/R2-methods.md · X6-catastrophe.md(큰 묶음의 단계 표·균형·테스트·고칠 파일·결정 사항·검토 메모).',
  '- 로드맵의 관련 줄: docs/ROADMAP.md "다음 작업 묶음"의 C4(새 유형의 깊이)·C5·M2·P2("다리 위의 위기자·동물 출몰·끊어진 전선 같은 생활 사건, 금고털이").',
  '',
  '## 지킬 것',
  '- 여섯 불변 조건(개입 없음 · 재현성 · 시뮬레이션과 표현의 분리 · 정보 격리 · 가짜 연출 금지 · 모든 사건은 끝난다)과 "특정 게임의 아트·명칭·배치를 그대로 옮기지 않는다"(장르의 방식은 자유). 사건의 소재는 실제 긴급구조 업무(경찰·소방·구급·특수·해상)에서 가져온다. 민감한 소재(위기에 놓인 사람, 아동 등)는 자극적으로 그리지 않고 구조·설득·보호의 일로 다룬다.',
  '- 이 기계(CPU 4개)에서 다른 묶음의 구현 작업자 둘이 동시에 돌고 있다. 무거운 명령은 꼭 필요한 만큼만(sweep 은 40교대 이하로 한두 번. npm run check 와 npx vitest run 전체는 돌리지 않는다). 다른 작업 폴더(.claude/worktrees/ 아래)·다른 브랜치(wf/ 로 시작)·개발 서버·네가 띄우지 않은 프로세스는 건드리지 않는다.',
  '- 주 작업 폴더(/home/user/operator)의 파일을 고치거나 새로 만들지 않는다. 임시 파일·보고서는 저장소 밖 ' + SP + '/ 에만 쓴다(없으면 mkdir -p).',
].join('\n')

const USER = [
  '## 사용자 결정 (2026-11-15 저녁 — 사용자가 질문에 직접 답한 것이다. 설계의 입력이고 바꾸지 않는다. 어긋나는 설계는 틀린 것이다)',
  '사용자의 말: "다 하고 사건 종류 다양화도 좀 하자. 종류가 적으니까 이것도 설계 적어놔" · "이것도 설계부터 써넣어놔 opus 5.5 울트라 코드 한테 인계 가능하게".',
  '1. 늘리는 방향: 새 유형과 새 시나리오 **둘 다**.',
  '2. 분량: **크게** — 시나리오 +35쯤, 새 유형 +5~6. 묶음 둘(N8 · N9)로 나눠 진행.',
  '3. 사건의 무게: 가벼운 생활 사건(한 팀이 3~5분)과 무거운 사건(여러 분야 15~20분)을 **고르게**.',
  '4. 부족한 분야: **전부** — 경찰(일상 치안) · 소방·구조 · 구급(의료) · 여러 분야 합동, 그리고 "특수 분야도 모자람".',
  '5. 넣을 사건 묶음 — **열두 가지 모두**: 높은 곳·깊은 곳 구조(외벽 작업자 고립 · 구덩이/우물 추락 · 산악 조난 · 멈춘 놀이기구) / 동물(멧돼지 출몰 · 벌집 · 개 물림 · 탈출한 동물) / 시설 사고(끊어진 전선 · 수도관 파열과 지하 침수 · 싱크홀 · 떨어질 듯한 간판) / 위기에 놓인 사람(다리·옥상의 위기자 설득 · 치매 노인 · 미아 · 문 잠긴 집의 쓰러진 사람) / 일상 치안(주취 소란 · 폭행 시비와 집단 난투 · 날치기 도보 추격 · 무전취식) / 재산 범죄(편의점·은행 강도 · 야간 금고털이 · 차량 절도 · 현금 수송차 습격) / 군중·행사(경기장·공연장 압사 위험 · 시위 충돌) / 테러·중대 위협(의심 물질 우편물 · 옥상 총격범 · 차량 돌진 · 드론 위협 · 연쇄 폭발물) / 교통 시설(터널 화재 · 지하철 사고 · 공항 비상착륙 대기 · 항구와 여객선) / 산업 현장(공장 폭발 · 화학 탱크로리 전복 · 밀폐 공간 질식 · 기계 끼임) / 의료의 여러 갈래(집단 식중독 · 약물 과다 · 출산 임박 · 행사장 환자 다발 · 폭염과 한파) / 날씨·환경 피해(침수된 지하차도 · 폭설 고립 · 강풍 낙하물 · 바다 기름 유출). 괄호 안은 사용자가 본 예시다 — 묶음마다 대표 사건이 들어가야 하고, 예시 하나하나를 모두 넣을 필요는 없다.',
  '6. 일이 늘어야 할 특수 부대 — **넷 모두**: 특공대·폭발물 처리 / 화생방 대응(누출 · 의심 물질 · 제독) / 헬기·해상(산악·해상 조난, 어선, 해상 수색, 옥상 구조) / 구조대 전문 장비(탐지 · 로봇 · 유압 · 잠수 · 밧줄이 있어야 풀리는 사건).',
  '7. 새 부대를 넣는다 — **세 갈래 모두**: 유관 기관 차량(전력·가스·수도 긴급 복구반, 견인차 — 이 차가 와야 끝나는 사건이 있고 그때까지 소방·경찰이 통제한다) / 새 전문 구조대(산악 구조대 · 수중 구조대 · 화생방 제독차 · 동물 포획팀) / 경찰의 새 부대(형사 · 교통 경찰 · 기동대 · 경찰견).',
  '8. 새 장소를 지도에 **더한다**: 터널 · 지하철역 · 경기장/공연장 · 놀이공원 · 은행 등과 전용 현장(지도를 바꾸면 모든 교대 결과가 달라지므로 균형을 다시 잰다).',
  '9. 민감한 소재(위기자 등)는 **절제해서 넣는다**: 설득 · 안전 매트 · 구조가 중심이고, 실패한 결과는 그림 없이 기록 한 줄로만 남긴다.',
  '10. 비응급 신고를 **여러 갈래로 늘린다**: 장난 전화 · 오인 신고 · 단순 민원(다른 기관에 넘김) · 같은 사건의 중복 신고, 합쳐 6~8%쯤.',
  '11. 만드는 순서: **일상 사건 먼저** — N8 = 생활 안전 · 동물 · 시설 사고 · 일상 치안 · 의료 갈래 · 비응급 신고처럼 짧고 자주 나오는 것, N9 = 터널 · 지하철 · 산업 · 군중 · 테러 같은 큰 사건과 새 장소.',
  '12. 사건 연쇄는 **조건이 맞을 때만**: 대응이 늦거나 실패했을 때만 다음 사건으로 번진다(예: 끊어진 전선 → 화재). 연쇄 상한(한 사슬 3건 · 한 교대 6건)은 그대로.',
  '13. 화면 표시는 **유형 기호만**: 지금 방식 그대로 — 새 유형의 기호만 더하고, 시나리오는 기록과 현장 그림으로 구별한다(핀·카드에 시나리오 이름이나 시나리오별 기호를 넣지 않는다).',
  '14. 사건 수: 무거운 사건의 수는 그대로 두고 **짧은 사건만큼 늘린다**(짧은 생활·치안 사건을 교대당 4~6건 더 — 지금 보통 난이도 교대당 14건쯤).',
  '',
  '이 결정 때문에 위 배경의 "설계서 하나"는 **둘**로 바뀌었다:',
  '- N8 일상 사건: docs/specs/N8-incident-kinds.md (구현 브랜치 wf/kinds · 시험 tests/kinds.test.ts · 포트 5236). 공통 틀(새 유형을 더하는 틀 · 새 부대의 틀 · 비응급 신고 · 사건 수 늘리기 · 조건부 연쇄의 규칙)과 N8·N9 에 나누는 표도 여기에 둔다.',
  '- N9 큰 사건 · 새 장소: docs/specs/N9-major-kinds.md (구현 브랜치 wf/kinds2 · 시험 tests/kinds2.test.ts · 포트 5237). N8 이 합쳐진 뒤에 구현한다.',
  '구현 순서: R1 → H1 → X6 → R2 → R3 → I1-b → I2 → N8 → N9.',
  '인계: 설계서는 이 대화를 모르는 다른 모델(Opus 5.5 · 울트라코드 — 작업자 여럿을 워크플로로 세워 단계 덩어리로 구현한다)이 **설계서와 docs/ROADMAP.md · docs/specs/README.md 만 읽고** 이어받을 수 있어야 한다. 사용자 결정 열네 가지는 설계서 안에 전문을 옮겨 적는다.',
].join('\n')

const R_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string', description: '전체 보고서를 쓴 파일의 절대 경로' },
    summary: { type: 'string', description: '핵심 요약 (5000자 안쪽 — 뒤 작업자가 이것만 읽어도 방향을 잡게)' },
    keyFacts: { type: 'array', items: { type: 'string' }, description: '설계가 반드시 알아야 할 사실 (파일·함수 이름·수치와 함께)' },
    cautions: { type: 'array', items: { type: 'string' }, description: '함정·제약·모르는 것' },
  },
  required: ['file', 'summary', 'keyFacts', 'cautions'],
}

const RESEARCH = [
  { id: 'inventory', title: '지금의 사건과 관찰자에게 보이는 것', body: [
    '1. 유형 8개 × 시나리오 전부의 표를 만든다: 이름·몫·태그·장소·필요 자원·한계 시간, 그리고 **각 시나리오가 어느 층에서 실제로 다른가**(신고 문구 / 분석·위험도 / 필요 자원 / 현장 생성기 / 세계 규칙 / 지휘 규칙 / 임무 종류 / 끝나는 방식 / 그림). 기본 시나리오 안의 변주(응급 환자의 갈래, 실종의 배회·추락 등, 무장 사건의 장소 네 가지, 교통사고의 버스 등)도 넣는다.',
    '2. 실제로 잰다: npx tsx scripts/sweep.ts 30 --scen (시나리오별 결과 표)와 npx tsx scripts/sweep.ts 30 --metrics 의 variety·actions 줄. 평소 교대 하나에 사건이 몇 건이고 **서로 다른 시나리오가 몇 가지** 나오는가, 유형별 몫, 한 교대에서 같은 시나리오가 되풀이되는 정도, 측정 도구가 "납작하다"(flat)·행동 다양성이 낮다고 꼽는 시나리오. 교대 기록 하나(npx tsx scripts/sweep.ts 1 --log S7)를 읽어 관찰자가 보는 사건의 흐름을 유형별로 한 줄씩 요약한다.',
    '3. 관찰자에게 **무엇이 보이는가**: 지도 핀(src/view/icons.ts · renderCity.ts 의 TYPE_COLOR), 사건 카드와 패널(src/ui/panels.tsx — 카드 제목이 유형 이름인가 시나리오 이름인가, 시나리오 이름은 어디에 나오는가), 통화창(src/ui/CallDock.tsx · callSystem.ts 의 신고 문구), 현장 그림(skins·sprites), 보고서(debrief.ts). 시나리오가 달라도 화면에서 같은 이름·같은 기호로 보이는 자리를 꼽는다.',
    '4. 진단: 사용자가 왜 "종류가 적다"고 느끼는가를 근거와 함께 — 유형 수준(핀·카드에 보이는 이름의 가짓수), 시나리오 수준(드문 시나리오의 몫), 같은 시나리오 안의 변주(장소·규모·전개)의 폭. 어느 수준을 늘리는 것이 체감에 가장 크게 듣는지 의견을 낸다.',
  ] },
  { id: 'extension', title: '확장 비용과 빈 자리', body: [
    '1. **새 유형(IncidentType) 하나를 더할 때 고쳐야 하는 모든 자리**를 실제 코드에서 열거한다(파일·함수·표·테스트). 저장소 안내서의 "새 사건 유형" 줄에서 출발해 빠진 자리를 찾는다. 그 가운데 **유형 수에 묶인 것**(callSystem.NATURE_LIK 의 열, 모든 시나리오의 lik 배열, analyst.TYPES 순서, 화면의 확률 목록, 열 수를 보는 테스트, scripts/metrics.ts 의 표 등)을 따로 꼽는다. 가장 최근의 유형 추가(수난 — git log --grep F1 으로 찾은 커밋들)의 바뀐 파일 수·줄 수를 잰다.',
    '2. **새 시나리오(변형)를 더할 때의 자리**: scenarios/<묶음>.ts · field/scenes · rules · orders · skins 레지스트리의 실제 서명, docs/specs/README.md 의 파일 소유 규칙, "시나리오의 순서가 추첨 결과를 바꾼다"·"대형 사고·재난의 시나리오는 평소 추첨에 없다" 같은 추첨 규칙(incidents.ts 의 고르는 코드), 태그(major·disaster)와 교대당 상한, 새 묶음 파일(예: scenarios/kinds.ts)을 더할 때 순서가 어디에 서는가.',
    '3. **쓰이지 않거나 덜 쓰이는 재료**: 건물 종류(PlaceKind · cityPlan.ts 의 LANDMARKS·INCIDENT_PLACES·KIND_SCENE) 가운데 사건이 나지 않거나 드문 곳, 지형(강·바다·산·철길·다리·공항·항구), 부대 종류·역할·장비(crews.ts 의 ROLES·KITS — 쓰임이 드문 것: 사다리 조작원, 탐지 장비, 로봇, 구조정, 헬기 등), 임무 종류(WorkKind) 가운데 한두 시나리오만 쓰는 것, 타일·소품(PropKind)·스킨. 새 사건이 **새 그림 없이도** 쓸 수 있는 것과 꼭 새로 그려야 하는 것을 가른다.',
    '4. 화면 쪽 비용: 새 유형 하나에 필요한 그림·색·범례·패널·보고서 자리(view/icons.ts, renderCity.ts, MapLegend.tsx, panels.tsx, marks.ts, hazardState.ts, audio), 새 시나리오 하나에 필요한 것(스킨·소품). scripts/ui-check.cjs 가 유형 이름에 기대는 자리.',
    '5. 재현성·측정에 걸리는 것: 새 난수 흐름의 이름 규칙, scripts/metrics.ts 의 문구 규칙(PHRASE·PROBLEM_SYS)과 tests/causality.test.ts, sweep --check 의 범위가 유형별 수치에 기대는 자리, tests/sim.test.ts 가운데 유형 수·시나리오 수에 기대는 검사.',
  ] },
  { id: 'future', title: '뒤 묶음의 능력과 나누는 선', body: [
    '1. 설계서 docs/specs/H1-injuries.md · X6-catastrophe.md · R2-methods.md · R3-doctrine.md · I1-causality.md(I1-b 부분) · I2-persistence.md 와 docs/specs/R1-crews.md 끝 "구현 메모"를 읽고, **N8 이 시작될 때 있을 것**을 정리한다: 역할·장비·헬기(R1), 부상 원인과 문턱·후송(H1), 조짐·철수·붕괴·폭발·전소(X6), 방법 목록(R2 의 METHOD·WORK_MODE — 방법 이름 전부), 교본 줄(R3), 신호·인과 규칙·세계 상태(I1-b), 교대 간 지속(I2).',
    '2. 각 설계서가 **새 사건 유형·시나리오에 요구하는 것**을 꼽는다(예: R2 의 방법 표에 새 임무·새 유형을 넣는 법, R3 의 교본 줄이 유형별로 필요한가, X6 의 catOf 대상 판별에 새 유형을 넣는가, H1 의 부상 원인 목록, I1-b 의 규칙 표·문구 표·시스템 분류, I2 가 이어받는 것). N8 의 설계서가 "새 사건마다 채워야 하는 칸"의 점검표가 되게.',
    '3. **이미 다른 묶음이 가져간 것**(겹치지 않게): R2 가 넣는 방법들(헤엄·보트·소화기·비살상탄·저격·폭파 진입 등), X6 의 분진 폭발·플래시오버, I1-b 의 조건부 연쇄, 로드맵의 C4(붕괴 탐지·가스 환기·수난 급류·현장 분류소·3층 이상과 사다리)·C5(건물 전체 수색)·M2(큰 시설의 전용 현장)·P2. N8 이 가져갈 것과 넘길 것의 선을 제안한다.',
    '4. 새 사건이 그 시스템들을 **보여 줄 기회**: 지금 설계된 능력 가운데 그것을 쓰는 사건이 적거나 없는 것(예: 어떤 방법·장비·역할·교본 줄이 한 시나리오에서만 쓰이는가)을 꼽고, 어떤 사건을 더하면 그 능력이 드러나는지 적는다.',
    '5. docs/DESIGN.md 와 README.md 의 방향(무엇을 하는 게임인가, 알려진 문제)에서 사건 종류와 관련된 약속·제약.',
  ] },
  { id: 'domain', title: '실제 긴급구조의 사건 종류 — 후보 목록', body: [
    '1. 경찰·소방·구조·구급·특수(대테러·폭발물·화학)·해상(해경·수난) 기관이 실제로 출동하는 사건의 분류에서, **지금 이 시뮬레이션에 없는 것**의 후보를 넓게(40개 이상) 모은다. 일반 지식으로 충분하고, 웹 검색을 쓸 수 있으면 공개된 출동 분류·통계를 참고해도 된다(검색어에 사용자·프로젝트 정보를 넣지 않는다). 특정 게임의 임무 목록·고유 명칭을 옮기지 않는다.',
    '2. 후보마다: 무엇이 일어나는가(한두 문장) · 어느 분야가 가는가 · 도시의 어디에서 나는가(이 지도에는 바다·강·산·철길·공항·항구·공단·주택가·상가·학교·병원이 있다 — src/sim/cityPlan.ts 참고) · 지금의 유형 8개로는 왜 표현이 안 되거나 어색한가 · **관찰자에게 새로 보이는 것**(새 위험의 움직임, 새 판단, 새 작업, 새 결말) · 사건의 길이와 규모(한 팀 5분짜리인가, 여러 분야 20분짜리인가) · 민감한 소재인가와 절제해서 다루는 법.',
    '3. 후보를 가족으로 묶는다(예: 높은 곳·깊은 곳의 구조, 동물, 전기·수도·가스 같은 시설, 위기에 놓인 사람, 군중·행사, 산업 현장, 교통 시설(터널·지하철·공항·항구), 절도·사기·소란 같은 일상 치안, 환경·오염, 의료의 여러 갈래, 날씨로 인한 생활 피해 …). 가족마다 "하나의 새 유형으로 세울 만한가, 기존 유형의 시나리오로 충분한가"에 대한 의견.',
    '4. 관찰 전용 게임이라는 점에서의 선별 기준을 제안한다: 보고 있을 때 재미있는가(전개가 눈에 보이는가, AI 의 판단이 드러나는가, 실패가 납득되는가), 지금 있는 사건과 겹치지 않는가. 상위 25개쯤을 추천 순으로.',
    '5. 지금 코드의 소재(현장 격자 30×20, 건물 평면 생성기, 물·불·가스·붕괴·용의자·차량 규칙)를 src/sim/field/ 에서 훑어보고, 후보 가운데 **지금 틀로 바로 만들 수 있는 것**과 새 틀이 필요한 것을 대략 가른다(자세한 비용은 다른 조사자가 한다).',
  ] },
  { id: 'impact', title: '사용자 결정이 요구하는 새 틀 — 새 부대 · 새 장소 · 비응급 신고 · 사건 수 · 연쇄', user: true, body: [
    '1. **새 부대 종류를 더하는 비용과 틀**(사용자 결정 7): resources.ts 의 UNIT_DEFS·KIND·UNIT_KIND_NAME·HEAVY, crews.ts 의 STAFF·ROLES·KITS, 분야(dept)가 넷(경찰·소방·구급·특수)으로 고정된 자리를 코드에서 모두 찾는다 — 전력·가스·수도 복구반과 견인차처럼 **분야 넷 밖의 부대**를 넣으려면 무엇을 고쳐야 하는가(타입 Dept, 관제의 수요 종류와 pickUnit, 지휘권, 무전, 지도 기호와 색, 부대 목록, 보고서). 소속 시설(cityPlan.ts 의 LANDMARKS facility)이 필요한가. 산악·수중 구조대, 화생방 제독차, 동물 포획팀, 형사·교통 경찰·기동대·경찰견을 지금 틀(역할·장비·능력 caps)로 표현하는 가장 싼 방법과, 저장소 안내서가 경고한 것(UNIT_DEFS 의 새 줄은 끝에 · 옛 대원 40명의 난수 순서 · 능력과 장비의 불변 조건 시험)을 확인한다. 부대가 늘면 관제·균형에 미치는 영향(가동률)을 어림한다.',
    '2. **지도에 새 장소를 더하는 비용**(결정 8): cityPlan.ts 의 NODES·ROADS·LANDMARKS·DISTRICTS·INCIDENT_PLACES·KIND_SCENE, city.ts 의 DIM, view/city/places.ts 의 지붕 그림, 지도 시험(건물마다 정해진 도시). 터널(도로 구간의 성격)·지하철역(철길과의 관계)·경기장/공연장·놀이공원·은행을 놓을 만한 빈 자리가 지도의 어디에 있는가(실제 좌표로), 현장 격자(30×20)와 평면 생성기(field/plans.ts)로 그런 큰 시설의 전용 현장을 만들 수 있는가, 로드맵 M2 의 "큰 시설의 전용 현장"과의 관계.',
    '3. **비응급 신고**(결정 10): 지금 허위 신고가 어떻게 만들어지고 접수·분석·배정·종료되는가(incidents.ts · callSystem.ts · analyst.ts · dispatcher.ts · debrief.ts 의 FALSE_ALARM 경로를 끝까지 따라간다). 출동 없이 접수 단계에서 끝나는 신고(장난 전화 · 단순 민원을 다른 기관에 넘김)와 같은 사건의 중복 신고를 넣으려면 어디를 고쳐야 하는가, 사건(Incident)을 만들지 않고 통화만 있는 경우를 지금 구조가 받아들이는가, 판정·보고서·측정 도구(scripts/metrics.ts 의 잊힌 사건·기록 일치 관문)가 그것을 어떻게 세는가.',
    '4. **사건 수 늘리기**(결정 14): 사건이 생기는 시각과 수를 정하는 코드(incidents.ts 의 일정 · difficulty.ts 의 빈도 손잡이 · sim.tune)를 읽고, 무거운 사건의 수는 그대로 두고 짧은 사건만 교대당 4~6건 더 얹는 방법(별도 흐름의 난수로 따로 추첨 — 기존 사건의 시각과 종류가 바뀌지 않게 할 수 있는가)을 확인한다. 실제로 잰다: npx tsx scripts/sweep.ts 30 --metrics 의 contention 줄(동시에 열린 사건 수 · 부대 가동률 · NO_UNIT · 통화 대기)과 교대당 사건 수 — 지금 여유가 얼마나 있는가, 경찰·구급의 여유는 각각 어떤가.',
    '5. **조건부 연쇄**(결정 12): chain.ts 의 canChain 과 그것을 쓰는 자리(재범 · 은신처 · 연쇄 방화의 예약 방식), 시나리오의 onClose/onCreate, 설계서 docs/specs/I1-causality.md 의 I1-b 조건부 연쇄(신호 · 규칙 · world/consequence.ts) — 새 사건이 "대응이 늦거나 실패했을 때만" 다른 유형의 사건을 낳게 하려면 어느 틀을 쓰는 것이 맞는가.',
    '6. **새 규칙의 재료**: 움직이는 동물(용의자 hostile 규칙을 다시 쓸 수 있는가 — hazards.ts 의 tickHostiles), 군중(폭동 riot 과 주변 시민 bystander 의 코드), 도보 추격(현장 안에서 달아나는 용의자 — SUSPECT_FLED 경로), 높은 곳(2층 · 계단 · 호이스트 · 사다리 조작원), 감전·침수 같은 구역 위험(가스 구름 tickGas 의 구역 모델을 다시 쓸 수 있는가), 설득(협상 negotiate 임무)의 지금 모델. 각각 지금 코드로 어디까지 되고 무엇이 모자란지.',
  ] },
]

const researchPrompt = (r) => [
  '너는 조사자다. 설계서를 쓰기 전에 필요한 사실을 모은다. 맡은 주제: **' + r.title + '**.',
  '',
  CTX,
  '',
  ...(r.user ? [USER, ''] : []),
  '## 조사할 것',
  r.body.join('\n'),
  '',
  '## 결과',
  '전체 보고서를 ' + SP + '/research/' + r.id + '.md 에 쓴다(표·파일 경로·함수 이름·잰 수치를 그대로, 길이 제한 없음, 한국어). 추측은 추측이라고 적는다. 직접 확인하지 못한 것은 "확인 못 함"으로 적는다.',
  '마지막 응답은 구조화된 요약이다(file · summary · keyFacts · cautions).',
].join('\n')

phase('Research')
const research = (await parallel(RESEARCH.map((r) => () =>
  agent(researchPrompt(r), { label: 'research:' + r.id, phase: 'Research', schema: R_SCHEMA })
    .then((x) => x ? Object.assign({ id: r.id, title: r.title }, x) : null)))).filter(Boolean)
log('조사 ' + research.length + '/' + RESEARCH.length + ' 끝')

const researchText = research.map((r) => [
  '### ' + r.title + ' — 전체 보고서: ' + r.file,
  r.summary,
  '알아야 할 사실: ' + (r.keyFacts || []).join(' / '),
  '함정·제약: ' + (r.cautions || []).join(' / '),
].join('\n')).join('\n\n')

const SPEC8 = 'docs/specs/N8-incident-kinds.md'
const SPEC9 = 'docs/specs/N9-major-kinds.md'

const PROP_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string', description: '설계안 전체를 쓴 파일의 절대 경로' },
    pitch: { type: 'string', description: '이 안의 요지 (왜 이 방향인가, 3000자 안쪽)' },
    newTypes: { type: 'array', items: { type: 'string' }, description: '새 유형(IncidentType)마다 한 줄: id · 이름 · 무엇을 담는가 · 왜 유형으로 세우는가 · N8 인가 N9 인가' },
    scenarios: { type: 'array', items: { type: 'string' }, description: '새 시나리오마다 한 줄: 유형/변형 · 이름 · 새로 볼 것 · 크기(S/M/L) · N8/N9' },
    units: { type: 'array', items: { type: 'string' }, description: '새 부대마다 한 줄: 종류 · 인원과 역할 · 맡는 수요 · 소속 시설 · N8/N9' },
    places: { type: 'array', items: { type: 'string' }, description: '새 장소마다 한 줄: 건물 종류 · 지도의 어디 · 전용 현장 · 거기서 나는 사건' },
    split: { type: 'string', description: 'N8 과 N9 를 어떻게 나누는가와 단계 묶음, 크기 어림' },
    tradeoffs: { type: 'array', items: { type: 'string' }, description: '이 안의 약점, 버린 후보와 이유' },
  },
  required: ['file', 'pitch', 'newTypes', 'scenarios', 'units', 'places', 'split', 'tradeoffs'],
}

const LENSES = [
  { id: 'taxonomy', title: '유형 체계와 관찰자의 눈', body: '사용자가 화면 표시는 "유형 기호만"으로 정했으므로(결정 13) 지도 핀과 카드에서 종류가 늘었다고 느끼게 하는 것은 **새 유형의 수와 그 갈라짐**이다. 열두 사건 묶음을 새 유형 5~6개와 기존 유형 8개에 어떻게 나눠 담을지(유형을 가르는 기준 — 분야 구성, 현장의 위험 규칙, 지휘 판단, 끝나는 방식 — 을 먼저 정한다), 유형마다의 이름·핀 기호·색, 유형마다 시나리오 목록, 평소 추첨의 몫과 사건 수(짧은 사건을 교대당 4~6건 더 — 결정 14), 비응급 신고의 갈래(결정 10)를 설계한다. 유형 수에 묶인 표들의 비용을 정직하게 계산하고, 그 비용을 줄이는 틀 변경(예: 신고 가능도 표를 유형 수에 덜 묶이게)을 함께 낸다. 기존 유형의 결과가 흔들리는 범위와 균형을 다시 맞추는 방법도 적는다.' },
  { id: 'mechanics', title: '전개 · 규칙 · 부대 · 장소', body: '열두 사건 묶음마다 사건이 **어떻게 전개되고 무엇이 새로 보이는가**(새 위험의 움직임 · 새 판단 · 새 작업이나 방법 · 새 결말)에서 출발한다. 문구만 다른 사건은 넣지 않는다. 다시 쓰는 틀(현장 생성기 · 세계 규칙 · 임무 · 그림)과 새로 만들 것을 가르고, 새 부대 세 갈래(유관 기관 차량 · 새 전문 구조대 · 경찰의 새 부대 — 결정 7)의 편성 · 역할 · 장비 · 관제 수요와 "그 차가 와야 끝나는 사건"이 끝내 끝나는 길, 새 장소(터널 · 지하철역 · 경기장/공연장 · 놀이공원 · 은행 — 결정 8)의 지도 배치와 전용 현장, 조건부 연쇄(결정 12 — 연쇄 상한과 I1-b 의 인과 규칙 위에서), 움직이는 동물 · 군중 · 높은 곳 · 감전 구역 · 침수 같은 새 규칙의 최소 모델을 설계한다. R1~I2 가 만든 시스템(역할·장비·헬기, 부상, 조짐과 철수, 방법, 교본, 인과 규칙, 교대 간 지속)을 드러내는 사건을 우선한다. 구현 의존 관계로 본 N8/N9 나눔과 단계 묶음을 낸다.' },
]

const proposePrompt = (l) => [
  '너는 설계자다. 사건 종류 다양화(묶음 N8 · N9)의 **설계안**을 하나 낸다(뒤에 다른 관점의 안과 견주어 설계서 둘로 합쳐진다). 네 관점: **' + l.title + '**.',
  l.body,
  '',
  CTX,
  '',
  USER,
  '',
  '## 조사 결과 (전체 보고서 파일을 반드시 읽는다)',
  researchText,
  '',
  '## 설계안에 담을 것',
  '1. 방향과 선별 기준. 분량은 사용자 결정대로: 새 유형 5~6개, 새 시나리오 35개쯤, 열두 묶음 모두, 가벼운 사건과 무거운 사건을 고르게. N8(일상 사건 — 짧고 자주 나오는 것)과 N9(큰 사건 · 새 장소)로 나눈다.',
  '2. 새 유형 · 새 시나리오의 목록표: id(유형/변형) · 이름 · 분야 · 장소 · 무엇이 일어나는가 · **새로 볼 것** · 다시 쓰는 것(현장 틀 · 규칙 · 임무 · 그림) · 새로 만들 것 · 크기(S/M/L) · N8/N9.',
  '3. 항목마다 한 문단씩: 전개(신고 → 도착 → 무엇을 알게 되고 무엇을 하는가 → 어떻게 끝나는가), 실패해도 끝나는 길(한계 시간, 맡을 부대가 없을 때, 마지막 부대가 떠났을 때 — 저장소 안내서 "겪은 함정"의 해당 항목), 정보 격리(누가 무엇으로 아는가), 뒤 묶음의 시스템과 맞물리는 자리.',
  '4. 새 부대 · 새 장소 · 비응급 신고 · 사건 수 · 조건부 연쇄의 설계(사용자 결정 7 · 8 · 10 · 12 · 14).',
  '5. 공통 틀의 변경(유형 수에 묶인 자리, 추첨, 새 부대가 분야 넷 밖에 설 때의 틀).',
  '6. N8/N9 의 단계 묶음과 크기 어림, 결과를 바꾸지 않는 앞 단계(틀)가 있는가.',
  '7. 약점과 버린 후보(이유와 함께).',
  '코드는 실제로 읽고 쓴다 — 있는 함수·표의 이름을 정확히 적고, 없는 것을 있는 것처럼 쓰지 않는다.',
  '',
  '## 결과',
  '설계안 전체를 ' + SP + '/proposals/' + l.id + '.md 에 쓴다(한국어, 길이 제한 없음). 마지막 응답은 구조화된 요약이다.',
].join('\n')

phase('Propose')
const proposals = (await parallel(LENSES.map((l) => () =>
  agent(proposePrompt(l), { label: 'propose:' + l.id, phase: 'Propose', schema: PROP_SCHEMA })
    .then((x) => x ? Object.assign({ id: l.id, title: l.title }, x) : null)))).filter(Boolean)
log('설계안 ' + proposals.length + '/' + LENSES.length + ' 끝')

const proposalText = proposals.map((p) => [
  '### 설계안 「' + p.title + '」 — 전체: ' + p.file,
  p.pitch,
  '새 유형: ' + (p.newTypes || []).join(' / '),
  '새 시나리오: ' + (p.scenarios || []).join(' / '),
  '새 부대: ' + (p.units || []).join(' / '),
  '새 장소: ' + (p.places || []).join(' / '),
  '나눔과 단계: ' + p.split,
  '약점·버린 것: ' + (p.tradeoffs || []).join(' / '),
].join('\n')).join('\n\n')

const PTR9 = 'wf/kinds-spec-n9'
const wt = (branch, from, file, ptr = PTR) => [
  '## 작업 폴더와 브랜치',
  '지금 있는 곳은 너만의 git worktree 다. /home/user/operator(주 작업 폴더)의 파일은 고치지 않는다. 먼저:',
  '    git checkout -q -b ' + branch + ' ' + from,
  '    git log --oneline -3',
  '- 고치는 파일은 ' + file + ' 뿐이다(README.md · CLAUDE.md · docs/ROADMAP.md · docs/specs/README.md · 다른 설계서 · 코드는 고치지 않는다 — 표에 넣을 줄은 보고로 돌려준다).',
  '- 커밋 메시지는 한국어로, 끝에 다음 두 줄:',
  ATTR,
  '- 커밋할 때마다 git branch -f ' + ptr + ' HEAD 로 가리킴 브랜치를 옮긴다(' + ptr + ' 자체를 체크아웃하지 않는다). 푸시하지 않는다. PR 을 만들지 않는다. 끝낼 때 git status 가 깨끗해야 한다.',
].join('\n')

const W_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, commit: { type: 'string' },
    lines: { type: 'number', description: '설계서 줄 수' },
    outline: { type: 'string', description: '설계서의 차례와 절마다 한 줄 요약' },
    newTypes: { type: 'array', items: { type: 'string' } },
    scenarios: { type: 'array', items: { type: 'string' } },
    units: { type: 'array', items: { type: 'string' } },
    places: { type: 'array', items: { type: 'string' } },
    stages: { type: 'string', description: '구현 순서 표의 요약 (단계 · 내용 · 결과가 바뀌는가)' },
    forOther: { type: 'array', items: { type: 'string' }, description: '다른 설계서(N8 ↔ N9)가 알아야 할 것: 넘긴 항목, 기대하는 이름, 공통 틀' },
    decisions: { type: 'array', items: { type: 'string' }, description: '정한 것과 그 이유' },
    unsure: { type: 'array', items: { type: 'string' }, description: '확신이 없는 곳 — 검토자가 먼저 볼 곳' },
  },
  required: ['branch', 'commit', 'lines', 'outline', 'newTypes', 'scenarios', 'units', 'places', 'stages', 'forOther', 'decisions', 'unsure'],
}

const must = (w) => [
  '## 설계서가 꼭 담을 것 (본보기 설계서들의 모양을 따른다)',
  '0. 앞머리: 묶음 이름 · 구현 브랜치 ' + w.branch + ' · 시험 파일 ' + w.test + ' · 포트 ' + w.port + ' · 사용자 요청 원문과 날짜 · 상태("설계만 — 구현은 ' + w.after + ' 다음") · 한 문단 요약. 바로 아래에 **"이어받는 사람에게"** 절: 이 대화를 모르는 다른 모델(Opus 5.5 · 울트라코드)이 읽는 순서(CLAUDE.md → docs/ROADMAP.md "진행 중" → docs/specs/README.md "실행 방법" → 이 문서 → 앞 묶음들의 구현 메모), 시작하기 전에 확인할 것(앞 묶음의 실제 이름), 워크플로로 돌릴 때의 덩어리, 사용자 결정 열네 가지 전문(바꾸지 않는다는 말과 함께).',
  '1. 원칙 — 이 묶음만의 것: 새 사건마다 "새로 볼 것"이 하나 이상(문구만 다른 사건은 넣지 않는다), 유형과 시나리오를 가르는 기준, 모든 새 사건의 끝나는 길, 기존 사건의 결과가 흔들리는 범위, 민감한 소재를 다루는 법.',
  '2. 연관 설계서와 나누는 선 — R1·H1·X6·R2·R3·I1-b·I2 와 로드맵의 C4·C5·M2·P2, 앞선 시나리오 묶음(N4b·N5·N6), 그리고 ' + w.other + ' 와의 표. 이 묶음이 가져가는 것과 넘기는 것.',
  '3. 지금 상태 — 조사에서 잰 수치(교대당 사건 수 · 서로 다른 시나리오 수 · 유형별 몫 · 납작한 시나리오 · 부대 가동률)와 화면에 보이는 것. "종류가 적다"의 진단.',
  '4. 무엇을 더하는가 — 한눈에 보는 표(새 유형 / 새 시나리오 / 새 부대 / 새 장소: id · 이름 · 유형 · 분야 · 장소 · 새로 볼 것 · 크기 · 단계). 그리고 **항목마다 상세 절**: 신고 문구 예(셋 이상)와 가능도(lik), 신고자가 틀리게 말할 수 있는 것, 장소(INCIDENT_PLACES · 건물 종류), 몫과 태그, 필요 자원(needs), 현장(틀 · 소품 · 구조 대상 · 위험), 세계 규칙(상태 · 틱마다 하는 일 · 난수 흐름 이름), 지휘관과 대원이 아는 것과 하는 것(사실 종류 · 작업 want · 임무 종류 · fitFor · 맡을 사람이 없을 때 needFor), 끝나는 조건과 **실패해도 끝나는 길**(한계 시간 값, 마지막 부대가 떠났을 때, 맡을 부대가 없을 때, 헬기만 왔을 때, 유관 기관 차량이 오지 못할 때), 판정과 보고서 문장(문제 코드), 그림(유형의 핀 기호 · 현장 소품 · 스킨)과 소리, 뒤 묶음의 시스템과 맞물리는 자리(R2 방법 · R3 교본 · H1 원인 · X6 대상 판별 · I1-b 규칙과 문구 표 · I2).',
  '5. 공통 틀의 변경 — 유형이 늘 때 유형 수에 묶인 모든 자리, 새 부대(편성 · 역할 · 장비 · 관제 수요 · 지도 기호 · 소속 시설 — 분야 넷 밖의 부대가 서는 틀), 추첨(몫 · 태그 · 교대당 상한 · 순서가 결과를 바꾼다는 점)과 사건 수, 비응급 신고, 조건부 연쇄, 그 밖.',
  '6. 정보 격리 — 새 진실마다 "누가 무엇으로 아는가" 표.',
  '7. 균형 — 목표(보통 60시드의 전후 범위, 프리셋 넷, 새 시나리오마다 강제 실행 20교대의 성공률 범위 · 한계 시간 0 · 방치 0, 부대 가동률과 대기열이 견디는가), 재는 명령, 벗어나면 돌리는 손잡이의 차례. sweep --check 의 범위 자체는 고치지 않는다.',
  '8. 구현 순서 — 단계 표(내용 / 결과가 바뀌는가 / 완료 조건). 0단계는 기준 재기, **결과를 바꾸지 않는 틀 단계**를 앞에 따로 둔다(다른 묶음과 겹쳐 먼저 돌릴 수 있게 — docs/specs/README.md "겹쳐 돌리기"), 그 뒤 가족(주제)별로 한 단계씩, 마지막에 균형 · 화면 확인 · 문서. 단계마다 npm run check 가 통과하게 나눈다. 단계 하나는 작업자 하나가 한두 시간에 끝낼 크기. docs/specs/README.md 의 덩어리 표에 넣을 한 줄(먼저 해 두는 앞 단계 / 구현 덩어리 / 문서 단계)도 적는다.',
  '9. 테스트 — ' + w.test + ' 의 번호 붙은 목록(재현성 · 정보 격리 · 모든 새 사건이 끝난다 · 새 규칙마다 · 신고 표의 열 수 · 새 부대의 능력과 장비 등)과 기존 테스트 가운데 고쳐야 하는 것. 평소 교대 몇 번에 나온다에 기대지 말고 직접 일으켜 시험한다.',
  '10. 고칠 파일 — 자기 파일(새 파일) / 공용 파일 수정(파일 · 함수 · 무엇을) 표.',
  '11. CLAUDE.md 에 들어갈 줄(합친 뒤에 고친다).',
  '12. 알려진 위험과 결정 사항 — 사용자 결정 열네 가지가 설계의 어디에 반영됐는지 표, 설계자가 정한 것과 이유, 알려진 위험, 확인 필요 목록. 사용자에게 더 물을 것이 남았으면 추천 기본값과 함께 적는다(답이 없으면 기본값으로 진행).',
  '13. 구현 메모(빈 절 — 구현한 뒤 적는다), 검토 메모(검토 반영 때 채운다).',
  '',
  '쓰는 법: 한국어. 있는 함수·표·파일은 실제 코드에서 확인한 이름으로 적는다(줄 번호는 밀리므로 함수 이름으로). 아직 없는 앞 묶음의 이름은 그 설계서의 이름으로 적고 "구현 전에 실제 이름 확인"을 붙인다. 숫자(몫 · 한계 시간 · 확률)는 시작값이라고 밝히고 근거(비슷한 기존 시나리오의 값)를 적는다. 작업자가 이 문서만 읽고 시작할 수 있게 구체적으로 — "적절히"·"필요하면" 같은 말로 넘기지 않는다. 길이는 필요한 만큼(본보기 설계서는 900~1,200줄).',
].join('\n')

const W8 = { branch: 'wf/kinds', test: 'tests/kinds.test.ts', port: 5236, after: 'I2', other: 'N9(큰 사건 · 새 장소)' }
const W9 = { branch: 'wf/kinds2', test: 'tests/kinds2.test.ts', port: 5237, after: 'N8', other: 'N8(일상 사건 · 공통 틀)' }

const pitfalls = '- 새 사건마다 저장소 안내서 "겪은 함정"에서 걸릴 만한 항목(낡은 믿음의 반복, 맡을 사람이 없는 작업, 현장에 아무도 남지 않는 경우, 소품이 길을 막는다, 공기호흡기 규칙, 물속의 사람, 헬기만 온 현장, 한 팀뿐인 경찰, 우선순위 차이 0.22 …)을 미리 짚고 피하는 법을 적는다.'

const write8Prompt = [
  '너는 사건 종류 다양화의 **첫째 설계서 N8 "일상 사건"**(' + SPEC8 + ')을 쓰는 사람이다. 조사와 관점이 다른 설계안 둘이 준비돼 있다. 둘을 견주어 가장 좋은 하나의 설계로 합친다. 사용자 결정 열네 가지는 그대로 따른다.',
  '',
  CTX,
  '',
  USER,
  '',
  '## 조사 결과 (전체 보고서 파일을 반드시 읽는다)',
  researchText,
  '',
  '## 설계안 둘 (전체 파일을 반드시 읽는다)',
  proposalText,
  '',
  wt(PTR + '-w8', BASE, SPEC8),
  '',
  '## N8 이 맡는 것',
  '- **전체 그림**: 새 유형 5~6개와 새 시나리오 35개쯤, 새 부대, 새 장소를 **N8 과 N9 에 나누는 표**(항목 · 어느 묶음 · 이유)를 이 문서에 둔다. N9 의 설계서는 이 표를 받아 쓴다.',
  '- **공통 틀**: 새 유형을 더하는 틀(유형 수에 묶인 자리를 한 번에 정리), 새 부대의 틀(분야 넷 밖의 유관 기관 차량 포함), 비응급 신고의 갈래, 사건 수 늘리기(짧은 사건 교대당 4~6건), 조건부 연쇄의 규칙. N9 가 그대로 쓴다.',
  '- **일상 사건**: 짧고 자주 나오는 것 — 생활 안전 · 동물 · 시설 사고 · 일상 치안 · 의료의 여러 갈래 · 위기에 놓인 사람 · 비응급 신고, 그리고 그 사건들에 필요한 새 유형 · 새 부대(유관 기관 차량, 동물 포획팀, 형사 · 교통 경찰 · 경찰견 등 — 어느 것을 N8 에 둘지는 네가 정한다).',
  '- N9 로 넘기는 것(터널 · 지하철 · 산업 현장 · 군중 · 테러 · 새 장소 · 그에 딸린 전문 부대)은 표에 이름과 한 줄 요약만 두고 상세는 쓰지 않는다. 열두 묶음 가운데 어느 쪽에도 넣기 애매한 것(높은 곳·깊은 곳 구조, 재산 범죄, 날씨·환경 피해)은 사건의 길이와 필요한 새 틀로 갈라 정하고 이유를 적는다.',
  '',
  must(W8),
  '',
  '## 고르는 기준',
  '- 다 만든 뒤 사용자가 교대 몇 번을 보고 "종류가 늘었다"고 느껴야 한다. 화면에는 유형 기호만 보이므로(결정 13) N8 만 합쳐져도 새 유형이 지도에 눈에 띄게 나와야 한다.',
  '- N8 한 묶음의 크기: 구현 단계 7~9개(틀 단계 포함), 단계 하나는 작업자 하나가 한두 시간.',
  pitfalls,
  '',
  '초안을 다 쓰면 처음부터 다시 읽으며 절 사이의 어긋남(목록표와 상세 절, 단계 표와 고칠 파일, 테스트 목록)을 고친 뒤 커밋한다(메시지: "N8 설계서: 사건 종류 다양화 — 일상 사건 (초안)"). 마지막 응답은 구조화된 보고다.',
].join('\n')

const F_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', description: '한 문단: 이 설계서로 구현을 시작해도 되는가' },
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      where: { type: 'string', description: '설계서의 절·항목' },
      problem: { type: 'string' },
      evidence: { type: 'string', description: '코드·다른 설계서의 근거 (파일·함수 이름, 직접 확인한 명령과 결과)' },
      fix: { type: 'string', description: '어떻게 고치면 되는가' },
    }, required: ['severity', 'where', 'problem', 'evidence', 'fix'] } },
    good: { type: 'array', items: { type: 'string' }, description: '직접 확인해 문제없던 것' },
  },
  required: ['verdict', 'findings', 'good'],
}

const REVIEWS = [
  { id: 'rules', title: '실현성과 규칙', body: [
    '- 설계서가 가리키는 함수·표·파일·레지스트리 서명이 **실제 코드에 그 이름으로 있는가**(grep 으로 하나씩). 아직 없는 앞 묶음의 이름에는 "구현 전에 확인" 표시가 있는가, 그 설계서(H1·X6·R2·R3·I1·I2)의 이름과 같은가.',
    '- 여섯 불변 조건: 새 난수 흐름의 이름과 쓰는 자리(기존 흐름에 끼워 넣지 않는가), 시나리오 순서·몫·사건 수가 추첨을 바꾸는 범위를 바르게 적었는가, 판단부가 진실을 읽게 되는 설계는 없는가(정보 격리 표와 본문이 같은가), 기록은 상태를 바꾸는 자리에서만 남는가, **새 사건마다 끝나는 길**(한계 시간 · 맡을 부대가 없을 때 · 마지막 부대가 떠났을 때 · 헬기만 왔을 때 · 유관 기관 차량이 오지 못할 때)이 실제 코드의 종료 경로(sceneManager 의 5·7·8번 블록, commander.outstanding·canClose·needFor, dispatcher 의 수요)로 성립하는가.',
    '- 저장소 안내서 "겪은 함정"의 항목마다 새 사건이 걸리는지 하나씩 대조한다(낡은 믿음의 반복 · 보고 지연 사이의 중복 지시 · 소품이 길을 막는다 · 위험한 건물과 공기호흡기 · 계단 · 물속의 사람 · 사건 도중 늘어나는 구조 대상 · 변형별 한계 시간 · 한 팀뿐인 경찰 · 우선순위 차이 0.22 · 맡을 사람이 없는 작업 · 숨는 정도의 상한 · 상공의 헬기 · 환자 자리 · 옛 대원 40명의 난수 순서 · UNIT_DEFS 의 새 줄은 끝에 …).',
    '- 새 유형: 유형 수에 묶인 자리를 빠짐없이 적었는가(직접 코드에서 찾아 대조). 신고 가능도 표(NATURE_LIK · 시나리오의 lik)의 열 변경이 기존 사건의 분석 결과를 어떻게 바꾸는지 바르게 적었는가. 새 부대: 편성표·능력과 장비의 불변 조건(tests/crews.test.ts), 관제의 수요·배정(dispatcher.pickUnit·airFit 같은 규칙)과 맞는가. 새 장소: 지도 테스트(건물마다 정해진 도시 — 교차·단절·건물 겹침), 모든 시설에서 모든 교차로로 가는가.',
    '- 숫자(몫 · 한계 시간 · 필요 자원 · 사건 수)가 비슷한 기존 시나리오와 견주어 말이 되는가. 사건이 교대당 4~6건 늘어도 부대가 감당하는가(조사의 가동률 수치와 견주어).',
    '- 균형 계획과 단계 표: 단계마다 관문(npm run check — sweep --check 의 범위)이 통과할 수 있게 나뉘었는가, "결과 불변"이라고 한 단계가 정말 그런가.',
  ] },
  { id: 'gaps', title: '빠진 것 · 사용자 결정 · 인계받는 사람의 눈', body: [
    '- **사용자 결정 열네 가지와 하나씩 대조**: 반영되지 않았거나 어긋나는 곳은 blocker 다(예: 핀·카드에 시나리오 이름을 넣는 설계는 결정 13 에 어긋난다. 열두 묶음 가운데 N8·N9 어느 쪽에도 없는 것, 새 부대 세 갈래 · 특수 부대 넷 가운데 일이 늘지 않는 것).',
    '- **사용자의 말에 답하는가**: "종류가 적다" → 다 만든 뒤 교대 몇 번을 보면 종류가 늘었다고 느낄 만한가. 문구만 다른 사건이 섞여 있지 않은가, "새로 볼 것"이 항목마다 실제로 새로운가(지금 있는 사건과 견주어).',
    '- **빠진 자리**: 저장소 안내서의 "자주 하는 확장" 표(새 사건 유형 · 새 시나리오 · 새 임무 · 새 문제 코드 · 새 타일·소품 · 새 부대 종류 · 새 역할 · 새 개인 장비 · 지도 바꾸기 · 새 난이도 손잡이)와 대조해 설계서의 "고칠 파일"에서 빠진 파일·함수. 화면(핀 · 색 · 범례 · 패널의 확률 목록 · 보고서 · 소리 · 통화창), 측정 도구의 문구 규칙(scripts/metrics.ts 의 PHRASE·PROBLEM_SYS, tests/causality.test.ts), scripts/ui-check.cjs, scripts/screenshot.cjs 의 유형 이름.',
    '- **뒤 묶음과의 맞물림**: 새 사건마다 R2 의 방법 · R3 의 교본 줄 · H1 의 부상 원인 · X6 의 대상 판별 · I1-b 의 규칙·문구 표 · I2 의 이어받기 칸이 채워졌는가. 로드맵의 C4·C5·M2·P2 와 겹치거나 빠뜨린 것. docs/specs/README.md "설계서 사이의 정본" 표에 더할 것. N8 과 N9 사이의 나눔이 양쪽 문서에서 같은가.',
    '- **테스트와 균형**: 테스트 목록이 새 규칙을 실제로 지키는가(재현성 · 정보 격리 · 끝남 · 규칙마다), 강제 실행으로 재는 계획이 시나리오마다 있는가, 범위를 벗어났을 때의 손잡이가 구체적인가.',
    '- **인계받는 사람의 눈**: 네가 이 대화를 모르는 다른 모델이고 0단계·틀 단계, 그리고 가운데 단계 하나의 작업자라고 하고 설계서만 읽고 시작해 본다(코드를 실제로 열어 어디를 어떻게 고칠지 따라가 본다 — 고치지는 않는다). 막히는 곳(모호한 지시, 정해지지 않은 값, 서로 다른 절의 어긋남, 순서 때문에 중간 단계에서 관문이 깨지는 곳), 단계의 크기가 한 작업자에게 너무 큰 곳, 완료 조건을 잴 수 없는 곳, "이어받는 사람에게" 절에서 빠진 것을 꼽는다.',
    '- 민감한 소재를 다루는 방식이 절제돼 있는가(결정 9), 특정 게임의 고유한 것을 옮긴 곳은 없는가.',
  ] },
]

const reviewPrompt = (v, tag, file, d, extra, ptr = PTR) => [
  '너는 독립 검토자다. 다른 사람이 쓴 설계서 초안 ' + file + ' (브랜치 ' + ptr + ')을 **틀린 곳·빠진 곳을 찾으려는 자세로** 검토한다. 네 갈래: **' + v.title + '**. 고치지는 않는다 — 찾은 것을 근거와 함께 보고한다. 쓴 사람의 요약을 믿지 말고 코드로 직접 확인한다. 문제가 없으면 없다고 한다(지어내지 않는다).',
  '',
  CTX,
  '',
  USER,
  '',
  '## 설계서 읽는 법',
  '주 작업 폴더에는 이 파일이 없다. 다음으로 꺼내 읽는다:',
  '    mkdir -p ' + SP + '/review && git -C /home/user/operator show ' + ptr + ':' + file + ' > ' + SP + '/review/' + tag + '-' + v.id + '.md',
  '처음부터 끝까지 읽는다. 조사 보고서(' + SP + '/research/*.md)와 설계안(' + SP + '/proposals/*.md)도 참고한다.' + (extra || ''),
  '',
  '## 쓴 사람의 요약 (참고 — 확인할 대상)',
  '차례: ' + d.outline,
  '새 유형: ' + (d.newTypes || []).join(' / '),
  '새 시나리오: ' + (d.scenarios || []).join(' / '),
  '새 부대: ' + (d.units || []).join(' / '),
  '새 장소: ' + (d.places || []).join(' / '),
  '단계: ' + d.stages,
  '정한 것: ' + (d.decisions || []).join(' / '),
  '쓴 사람이 확신이 없다고 한 곳: ' + (d.unsure || []).join(' / '),
  '',
  '## 확인할 것',
  v.body.join('\n'),
  '',
  '## 결과',
  '찾은 것마다 심각도(blocker = 이대로 구현하면 불변 조건이 깨지거나 사건이 끝나지 않거나 단계가 성립하지 않거나 사용자 결정에 어긋난다 / major = 구현자가 막히거나 결과가 설계 의도와 달라진다 / minor = 다듬을 것), 설계서의 어디, 무엇이 문제, 근거(파일·함수·직접 돌린 명령), 고치는 법. 전체 목록을 ' + SP + '/review/findings-' + tag + '-' + v.id + '.md 에도 쓴다. 마지막 응답은 구조화된 보고다.',
].join('\n')

const findingsOf = (reviews) => reviews.map((r) => [
  '### 검토 「' + r.title + '」 — ' + r.verdict,
  (r.findings || []).map((f, i) => (i + 1) + '. [' + f.severity + '] ' + f.where + ' — ' + f.problem + '\n   근거: ' + f.evidence + '\n   고치는 법: ' + f.fix).join('\n'),
].join('\n')).join('\n\n')

const V_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, commit: { type: 'string' }, lines: { type: 'number' },
    applied: { type: 'array', items: { type: 'string' }, description: '반영한 지적과 어떻게 고쳤는가' },
    notApplied: { type: 'array', items: { type: 'string' }, description: '반영하지 않았거나 다르게 반영한 지적과 이유' },
    summary: { type: 'string', description: '완성된 설계의 요약: 새 유형 · 새 시나리오 · 새 부대 · 새 장소 · 단계 (사용자에게 보여 줄 수 있게 쉬운 말로)' },
    newTypes: { type: 'array', items: { type: 'string' } },
    scenarios: { type: 'array', items: { type: 'string' } },
    units: { type: 'array', items: { type: 'string' } },
    places: { type: 'array', items: { type: 'string' } },
    forOther: { type: 'array', items: { type: 'string' }, description: '다른 설계서(N8 ↔ N9)가 알아야 할 것' },
    tableRow: { type: 'string', description: 'docs/specs/README.md 맨 위 문서 표에 넣을 한 줄 (| 문서 | 묶음 | 브랜치 | 한 줄 요약 | 상태 |)' },
    orderRow: { type: 'string', description: 'docs/specs/README.md "구현 순서" 표에 넣을 줄 (| 단계 | 묶음 | 앞 단계에 기대는 것 | 앞 단계 없이 먼저 하면 |)' },
    chunkRow: { type: 'string', description: 'docs/specs/README.md 덩어리 표에 넣을 한 줄 (| 묶음 | 포트 | 먼저 해 두는 앞 단계 | 그 뒤의 구현 덩어리 | 문서 단계 |)' },
    canonRows: { type: 'array', items: { type: 'string' }, description: '"설계서 사이의 정본" 표에 더할 줄 (없으면 빈 배열)' },
    roadmapEntry: { type: 'string', description: 'docs/ROADMAP.md 에 넣을 이 묶음의 항목 (현재 · 할 일 · 완료 조건, 몇 줄)' },
    openQuestions: { type: 'array', items: { type: 'string' }, description: '사용자에게 더 물을 만한 것: 질문 · 추천 기본값 · 이유 (없으면 빈 배열)' },
  },
  required: ['branch', 'commit', 'lines', 'applied', 'notApplied', 'summary', 'newTypes', 'scenarios', 'units', 'places', 'forOther', 'tableRow', 'orderRow', 'chunkRow', 'canonRows', 'roadmapEntry', 'openQuestions'],
}

const revisePrompt = (file, tag, w, ftext, extra, first) => [
  '너는 설계서 ' + file + ' (브랜치 ' + PTR + ')의 검토 반영자다. 독립 검토 두 갈래의 지적을 **하나씩 코드로 확인한 뒤** 설계서에 반영한다. 지적이 맞으면 본문을 고치고(검토 메모에 "반영함"을 늘어놓지 않는다 — 본문에 녹인다), 틀렸거나 다르게 반영하면 설계서 끝 "검토 메모"에 그 지적과 이유를 적는다(본보기: docs/specs/X6-catastrophe.md 끝의 "검토 메모").',
  '',
  CTX,
  '',
  USER,
  '',
  wt(PTR + '-r' + tag, PTR, file + (extra ? ' (그리고 ' + extra + ')' : '')),
  ...(first ? ['', '## 시작하기 전에 (브랜치를 만든 바로 다음)', first] : []),
  '',
  '## 검토 지적 (전체 목록은 ' + SP + '/review/findings-' + tag + '-*.md)',
  ftext,
  '',
  must(w),
  '',
  '## 할 일',
  '1. 설계서를 처음부터 끝까지 읽고, 조사 보고서(' + SP + '/research/*.md)를 참고해 지적마다 사실인지 확인한다(코드를 직접 연다).',
  '2. blocker · major 는 모두 다룬다(반영하거나, 반영하지 않는 이유를 검토 메모에). minor 는 맞는 것만 반영한다. 사용자 결정 열네 가지에 어긋나는 쪽으로는 고치지 않는다.',
  '3. 고친 뒤 처음부터 다시 읽어 절 사이의 어긋남(목록표 ↔ 상세 절 ↔ 단계 표 ↔ 고칠 파일 ↔ 테스트 목록 ↔ 균형 표)을 맞춘다. 이름이 문서 안에서 한 가지로 쓰이는지 본다.',
  '4. 커밋한다(메시지: "' + tag.toUpperCase() + ' 설계서: 독립 검토 반영 (실현성·규칙 / 빠진 것·인계)").',
  '5. 표에 넣을 줄들을 보고로 돌려준다(주 세션이 넣는다 — 네가 README·ROADMAP 을 고치지 않는다): docs/specs/README.md 의 문서 표·구현 순서 표·덩어리 표·정본 표의 줄 모양은 그 파일에서 다른 묶음의 줄을 보고 맞춘다. 상태 칸은 "설계됨 — 구현은 ' + w.after + ' 다음".',
  '마지막 응답은 구조화된 보고다.',
].join('\n')

const twice = async (prompt, label, ph, schema) => {
  let r = await agent(prompt, { label, phase: ph, schema, isolation: 'worktree' })
  if (!r) {
    log(label + ' 가 보고 없이 끝났다 — 다시 세운다')
    r = await agent(prompt + '\n\n(앞 시도가 중간에 멈췄다. ' + PTR + ' 에 앞 시도의 커밋이 있을 수 있다 — git log ' + PTR + ' 로 어디까지 됐는지 보고, 네 브랜치 이름 끝에 -b 를 붙여 ' + PTR + ' 에서 갈라 이어서 한다.)', { label: label + ':retry', phase: ph, schema, isolation: 'worktree', model: 'opus' })
  }
  return r
}

// ───── N8 ─────
phase('Write N8')
const draft8 = await twice(write8Prompt, 'write:n8', 'Write N8', W_SCHEMA)
if (!draft8) return { error: 'N8 초안을 쓰지 못했다', research, proposals }

phase('Review N8')
const reviews8 = (await parallel(REVIEWS.map((v) => () =>
  agent(reviewPrompt(v, 'n8', SPEC8, draft8, ''), { label: 'review:n8:' + v.id, phase: 'Review N8', schema: F_SCHEMA })
    .then((x) => x ? Object.assign({ id: v.id, title: v.title }, x) : null)))).filter(Boolean)
log('N8 검토 ' + reviews8.length + '/' + REVIEWS.length + ' 끝 — 지적 ' + reviews8.reduce((n, r) => n + (r.findings || []).length, 0) + '건')

const findings8 = findingsOf(reviews8)

// ───── N8 반영과 N9 초안을 나란히 ─────
const write9Prompt = [
  '너는 사건 종류 다양화의 **둘째 설계서 N9 "큰 사건 · 새 장소"**(' + SPEC9 + ')를 쓰는 사람이다. 첫째 설계서 N8(일상 사건 · 공통 틀)의 초안은 ' + PTR + ' 브랜치에 있고, 지금 다른 사람이 독립 검토의 지적을 반영하고 있다(너와 나란히 — 끝나면 N8 이 조금 바뀐다). N9 는 N8 이 합쳐진 뒤에 구현되므로 N8 의 공통 틀과 이름을 그대로 쓰고, N8 이 N9 로 넘긴 것을 빠짐없이 받는다. 사용자 결정 열네 가지는 그대로 따른다.',
  '',
  CTX,
  '',
  USER,
  '',
  '## 조사 결과 (전체 보고서 파일을 반드시 읽는다)',
  researchText,
  '',
  '## 설계안 둘 (전체 파일을 반드시 읽는다)',
  proposalText,
  '',
  wt(PTR + '-w9', PTR, SPEC9, PTR9),
  '',
  '## N8 (먼저 처음부터 끝까지 읽는다 — 네 작업 폴더의 ' + SPEC8 + ')',
  '차례: ' + draft8.outline,
  '새 유형: ' + (draft8.newTypes || []).join(' / '),
  '새 시나리오: ' + (draft8.scenarios || []).join(' / '),
  '새 부대: ' + (draft8.units || []).join(' / '),
  '새 장소: ' + (draft8.places || []).join(' / '),
  'N9 가 알아야 할 것: ' + (draft8.forOther || []).join(' / '),
  '',
  '## N8 초안이 독립 검토에서 받은 지적 (N8 은 이 지적대로 고쳐지는 중이다 — 지적받은 부분에 기대어 쓰지 말고, 같은 잘못을 N9 에서 되풀이하지 않는다)',
  findings8,
  '',
  '## N9 가 맡는 것',
  '- N8 의 "N8 과 N9 에 나누는 표"에서 N9 몫인 것 전부: 큰 사건(터널 · 지하철 · 공항 · 항구, 산업 현장, 군중 · 행사, 테러 · 중대 위협 등), 새 장소(지도에 더하는 건물과 전용 현장 — 결정 8), 그에 딸린 새 유형 · 새 전문 부대(산악 · 수중 · 화생방 제독, 기동대 등 — N8 이 넘긴 것), 특수 부대 넷의 일을 늘리는 사건(결정 6).',
  '- N8 의 공통 틀(새 유형을 더하는 틀 · 새 부대의 틀 · 추첨과 사건 수 · 조건부 연쇄)을 다시 설계하지 않는다 — 가리켜 쓰고, 모자란 것만 "N8 의 틀에 더하는 것"으로 적는다. N8 과 어긋나는 것을 발견하면 N9 에서 조용히 바꾸지 말고 보고의 forOther 에 적는다.',
  '- 지도를 바꾸는 단계(새 장소)는 모든 교대의 결과를 바꾼다 — 그 단계를 따로 두고 기준을 다시 재는 절차를 적는다(저장소 안내서 "지도 바꾸기").',
  '',
  must(W9),
  '',
  '## 고르는 기준',
  '- 큰 사건은 드물게 나오므로(tag major 는 교대마다 많아야 한 번) 어떤 태그·몫으로 얼마나 자주 보일지를 분명히 정한다. 새 유형이 N9 에도 있으면 지도에서 얼마나 자주 보이는지 잰 추정과 함께 적는다.',
  '- N9 한 묶음의 크기: 구현 단계 7~9개(틀 단계 포함), 단계 하나는 작업자 하나가 한두 시간.',
  pitfalls,
  '',
  '초안을 다 쓰면 처음부터 다시 읽으며 절 사이의 어긋남과 N8 과의 어긋남을 고친 뒤 커밋한다(메시지: "N9 설계서: 사건 종류 다양화 — 큰 사건 · 새 장소 (초안)"). 마지막 응답은 구조화된 보고다.',
].join('\n')

phase('Revise N8')
const both = await parallel([
  () => twice(revisePrompt(SPEC8, 'n8', W8, findings8, '', ''), 'revise:n8', 'Revise N8', V_SCHEMA),
  () => twice(write9Prompt, 'write:n9', 'Write N9', W_SCHEMA),
])
const final8 = both[0]
const draft9 = both[1]
const n8 = final8 || draft8
if (!draft9) return { pointer: PTR, n8: { spec: SPEC8, draft: draft8, final: final8 }, error: 'N9 초안을 쓰지 못했다' }

phase('Review N9')
const also8 = ' N8 설계서(검토 반영이 끝난 것)는 브랜치 ' + PTR + ' 에 있다 — git -C /home/user/operator show ' + PTR + ':' + SPEC8 + ' 로 꺼내 처음부터 끝까지 읽고, N9 가 N8 의 공통 틀·이름·나눔 표와 어긋나는 곳을 함께 찾는다(N9 초안은 N8 이 고쳐지기 전에 쓰였다).'
const reviews9 = (await parallel(REVIEWS.map((v) => () =>
  agent(reviewPrompt(v, 'n9', SPEC9, draft9, also8, PTR9), { label: 'review:n9:' + v.id, phase: 'Review N9', schema: F_SCHEMA })
    .then((x) => x ? Object.assign({ id: v.id, title: v.title }, x) : null)))).filter(Boolean)
log('N9 검토 ' + reviews9.length + '/' + REVIEWS.length + ' 끝 — 지적 ' + reviews9.reduce((n, r) => n + (r.findings || []).length, 0) + '건')

phase('Revise N9')
const final9 = await twice(revisePrompt(SPEC9, 'n9', W9, findingsOf(reviews9), SPEC8 + ' 의 "N8 과 N9 에 나누는 표"와 N9 를 가리키는 줄 — N9 와 어긋난 곳만 맞춘다', 'N9 초안은 다른 브랜치에 있다. 먼저 받아 온다:  git merge --no-edit ' + PTR9 + '   (N8 과 N9 는 다른 파일이라 충돌하지 않는다). 그 뒤 ' + SPEC8 + '(검토 반영이 끝난 최종본)을 처음부터 끝까지 읽고, N9 초안이 N8 이 고쳐지기 전에 쓰였다는 점을 염두에 두고 N9 를 N8 최종본에 맞춘다.'), 'revise:n9', 'Revise N9', V_SCHEMA)

const counts = (reviews) => reviews.map((r) => ({ id: r.id, verdict: r.verdict, counts: (r.findings || []).reduce((m, f) => { m[f.severity] = (m[f.severity] || 0) + 1; return m }, {}) }))
return {
  pointer: PTR,
  n8: { spec: SPEC8, draft: { commit: draft8.commit, lines: draft8.lines }, reviews: counts(reviews8), final: final8 },
  n9: { spec: SPEC9, draft: { commit: draft9.commit, lines: draft9.lines }, reviews: counts(reviews9), final: final9 },
}
