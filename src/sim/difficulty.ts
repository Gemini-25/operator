// 난이도 — 교대가 시작되기 전에 정하는 "조건"이다(진행 중 개입이 아니다).
// 손잡이 다섯 개(각 1~5)가 아래 표를 통해 실제 수치(Tuning)로 바뀐다.
// 3 이 기준값이며, 모든 표의 가운데 값은 난이도 도입 이전의 상수와 똑같다.
// 같은 시드 + 같은 난이도 = 같은 결과.

export interface Difficulty {
  frequency: number;   // 사건 빈도        1 드묾 … 5 쉴 틈 없음
  severity: number;    // 사건 심각도      1 가벼움 … 5 대형
  threat: number;      // 용의자 위협      1 약함 … 5 중무장·공격적
  equipment: number;   // 대원 장비 상태   1 불량 … 5 최상   (높을수록 쉬움)
  info: number;        // 신고 신뢰도      1 엉망 … 5 정확   (높을수록 쉬움)
  resources: number;   // 부대 규모        1 = 12팀 … 3 = 19팀 … 5 = 22팀  (높을수록 쉬움)
  traffic?: number;    // 교통 상황        1 한산 … 5 극심  (없으면 3. 3 은 없는 것과 같다)
  disaster?: DisasterChoice;      // 재난: 없음(기본) · 무작위(심각도에 따라 드물게) · 종류를 정해서
}

export type DisasterKind = 'typhoon' | 'flood' | 'quake' | 'wildfire' | 'tsunami';
export type DisasterChoice = 'none' | 'random' | DisasterKind;
export const DISASTER_KINDS: DisasterKind[] = ['typhoon', 'flood', 'quake', 'wildfire', 'tsunami'];
export const DISASTER_NAME: Record<DisasterChoice, string> = { none: '없음', random: '무작위', typhoon: '태풍', flood: '홍수', quake: '지진', wildfire: '산불', tsunami: '해일' };
export const DISASTER_DESC: Record<DisasterChoice, string> = {
  none: '재난 없이 평소의 교대.', random: '심각도에 따라 드물게(0~30%) 한 가지가 일어난다.',
  typhoon: '비바람에 나무와 간판이 쓰러지고 강변이 잠긴다.', flood: '강물이 불어 강가의 길이 차례로 막히고 사람들이 고립된다.',
  quake: '예고 없이 여러 곳이 한꺼번에 무너지고 불이 난다. 여진이 온다.', wildfire: '산에서 난 불이 바람을 타고 동네로 내려온다.', tsunami: '경보 뒤 바닷가를 덮친다. 그 전에 사람들을 뭍으로 옮겨야 한다.',
};
/** 주소·명령줄의 글자를 재난 선택으로 (모르는 값은 null) */
export function parseDisaster(text: string | null | undefined): DisasterChoice | null {
  if (!text) return null;
  const k = text.trim().toLowerCase();
  return k === 'none' || k === 'random' || (DISASTER_KINDS as string[]).indexOf(k) >= 0 ? (k as DisasterChoice) : null;
}

export type PresetId = 'easy' | 'normal' | 'hard' | 'extreme';
export const PRESETS: Record<PresetId, { name: string; desc: string; d: Difficulty }> = {
  easy: { name: '쉬움', desc: '사건이 드물고 가볍다. 장비는 좋고 신고는 정확하다.', d: { frequency: 2, severity: 2, threat: 2, equipment: 4, info: 4, resources: 3 } },
  normal: { name: '보통', desc: '기준 조건.', d: { frequency: 3, severity: 3, threat: 3, equipment: 3, info: 3, resources: 3 } },
  hard: { name: '어려움', desc: '사건이 잦고 크다. 장비는 낡았고 신고는 믿기 어렵다.', d: { frequency: 4, severity: 4, threat: 4, equipment: 2, info: 2, resources: 3 } },
  extreme: { name: '극한', desc: '동시다발 대형 사건, 중무장 용의자, 불량 장비, 엉망인 신고.', d: { frequency: 5, severity: 5, threat: 5, equipment: 1, info: 1, resources: 3 } },
};
export const NORMAL: Difficulty = PRESETS.normal.d;
export const KNOBS: { key: keyof Difficulty; name: string; low: string; high: string; harderWhen: 'high' | 'low'; desc: string }[] = [
  { key: 'frequency', name: '사건 빈도', low: '드묾', high: '쉴 틈 없음', harderWhen: 'high', desc: '사건 사이 간격, 교대당 사건 수, 동시에 진행되는 사건 수' },
  { key: 'severity', name: '사건 심각도', low: '가벼움', high: '대형', harderWhen: 'high', desc: '규모 분포, 숨은 위험(잔해·잠긴 문·가스·누출), 부상 악화 속도, 화재 확산 속도' },
  { key: 'threat', name: '용의자 위협', low: '약함', high: '중무장', harderWhen: 'high', desc: '무장 사건 비중, 총격범 비중, 용의자 수·공격성·사격 실력, 숨은 공범, 도주 시점' },
  { key: 'equipment', name: '대원 장비 상태', low: '불량', high: '최상', harderWhen: 'low', desc: '차량 주행 속도, 펌프 상태와 마모, 용수 탱크, 구조 장비, 의료 장비, 방호 장비, 출근 시 체력, 개인 장비의 고장, 공기통 용량, 탄약 상자, 예비 펌프' },
  { key: 'info', name: '신고 신뢰도', low: '엉망', high: '정확', harderWhen: 'low', desc: '침착한 신고자 비율, 위치를 틀리게 말할 확률, 허위·오인 신고와 비긴급 전화의 빈도, 목격자 정확도' },
  { key: 'resources', name: '부대 규모', low: '12팀', high: '22팀', harderWhen: 'low', desc: '출동 부대 수 (12 · 15 · 19 · 21 · 22팀)와 인원. 경찰·소방·구조·특수 네 분야에 3~6팀씩이고, 3 이 기본 편성이다. 1·2 는 최소 인원(펌프차 3명, 구조대 4명, 특공대 4명 …)으로 나간다. 인근 도시 지원 횟수도 함께 늘어난다 (2 · 2 · 3 · 4 · 5회).' },
  { key: 'traffic', name: '교통 상황', low: '한산', high: '극심', harderWhen: 'high', desc: '도로의 교통량, 정체·공사·고장 차량·낙하물의 빈도, 골목의 불법 주차' },
];

export interface Tuning {
  // 빈도
  gapMul: number; maxIncidents: number; maxConcurrent: number;
  // 심각도
  sevWeights: [number, number, number]; hazardMul: number; bleedMul: number; fireSpreadMul: number;
  injuryMul: number;           // 대원·용의자가 새 상처로 얻는 출혈에 곱하는 값 (H1 — 화면의 조절 막대는 없다. 심각도 손잡이를 따른다)
  // 용의자
  armedWeight: number; shooterWeight: number; aggroShift: number; skillShift: number; accompliceProb: number; extraSuspectProb: number; fleeShift: number; knifeProb: number;
  // 장비
  pumpMin: number; pumpMax: number; waterMul: number; toolMul: number; medMul: number; armorMul: number; pumpWearMul: number; startStamina: number; vehicleSpeedMul: number;
  airFull: number;             // 공기호흡기 한 통의 공기(초) — 연기 속에서만 준다
  kitFault: number;            // 개인 장비 하나(고장 추첨을 받는 종류)가 이번 교대에 고장 나 있을 확률
  ammoBox: number;             // (R3 §2.9) 순찰차·폭발물 처리반에 실은 탄약 상자 (기동대 +1, 특공 +2) — 한 상자 = 한 사람의 총기를 가득
  sparePump: number;           // (R3 §3.2 F10) 펌프를 단 부대(물탱크가 있는 부대)에 실은 예비 펌프 — 펌프 고장 때 하나를 쓴다 (지금까지는 무제한)
  // 신고
  personaWeights: [number, number, number, number, number]; witnessAcc: number; wrongAddressProb: number; falseAlarmProb: number; nuisanceGap: number;
  // 부대
  unitLevel: number; flashbangs: number;
  aidUnits: number;            // 한 교대에 받을 수 있는 인근 도시 지원 횟수
  // 큰일
  majorProb: number;           // 이번 교대에 대형 사고가 한 번 일어날 확률
  disasterProb: number;        // 재난을 '무작위'로 두었을 때 일어날 확률
  // 교통
  trafficMul: number;          // 도로의 교통량에 곱하는 값
  trafficGap: number;          // 교통 사건(정체·공사·고장 차량·낙하물) 사이 간격에 곱하는 값
  parkedCount: number;         // 교대가 시작될 때 불법 주차로 좁아진 골목의 수
  // 짧은 사건 (N8 §5.4 — 평소 추첨과 따로 도는 흐름 daily). 빈도 손잡이에 비례하고 화면의 손잡이·저장 키는 그대로다
  dailyCount: number;          // 한 교대에 일으킬 짧은 사건의 차례 수 (0 = 짧은 사건과 비응급의 접수 쪽 변화(가려내기)가 모두 꺼진다 — 시험용 SimOpts.daily 가 덮는다)
  dailyConcurrent: number;     // 동시에 열려 있을 수 있는 짧은 사건 수 (넘으면 20초 미룬다)
}

const lv = (v: number): number => Math.max(0, Math.min(4, Math.round(v) - 1));

export function tuningOf(d: Difficulty): Tuning {
  const f = lv(d.frequency), s = lv(d.severity), t = lv(d.threat), e = lv(d.equipment), i = lv(d.info), r = lv(d.resources ?? 3), tr = lv(d.traffic ?? 3);
  return {
    gapMul: [1.55, 1.25, 1, 0.76, 0.58][f],
    maxIncidents: [9, 11, 15, 18, 22][f],
    maxConcurrent: [3, 4, 5, 6, 8][f],

    sevWeights: ([[0.5, 0.4, 0.1], [0.38, 0.44, 0.18], [0.28, 0.45, 0.27], [0.17, 0.43, 0.4], [0.08, 0.37, 0.55]] as [number, number, number][])[s],
    hazardMul: [0.55, 0.78, 1, 1.25, 1.5][s],
    bleedMul: [0.78, 0.9, 1, 1.12, 1.26][s],
    // (H1 단계 7 — 균형 손잡이 2, 설계서 §9.3) 처음 표는 [0.75, 0.9, 1, 1.12, 1.25]. 극한 60교대의 한계 시간·방치·무대응이 기준보다 +9(허용 +6),
    // 다친 대원이 2.00/교대(상한)였다 — 위쪽 두 칸을 1 로 내리니 +6 · 1.4/교대. 가운데 값(보통)과 아래쪽은 그대로다
    injuryMul: [0.75, 0.9, 1, 1, 1][s],
    fireSpreadMul: [0.82, 0.92, 1, 1.09, 1.18][s],

    armedWeight: [0.15, 0.19, 0.23, 0.28, 0.33][t],
    shooterWeight: [0.08, 0.15, 0.22, 0.32, 0.42][t],
    aggroShift: [-0.16, -0.08, 0, 0.08, 0.16][t],
    skillShift: [-0.14, -0.07, 0, 0.08, 0.16][t],
    accompliceProb: [0.12, 0.24, 0.35, 0.5, 0.68][t],
    extraSuspectProb: [0, 0, 0, 0.3, 0.6][t],
    fleeShift: [30, 14, 0, -10, -20][t],
    knifeProb: [0.35, 0.48, 0.6, 0.72, 0.85][t],

    pumpMin: [0.21, 0.25, 0.3, 0.5, 0.75][e],
    pumpMax: [0.55, 0.8, 1.0, 1.0, 1.0][e],
    waterMul: [0.65, 0.82, 1, 1.2, 1.4][e],
    toolMul: [0.6, 0.82, 1, 1.08, 1.15][e],
    medMul: [0.68, 0.86, 1, 1.06, 1.12][e],
    armorMul: [0.5, 0.75, 1, 1.2, 1.4][e],
    pumpWearMul: [1.5, 1.22, 1, 0.82, 0.65][e],
    startStamina: [65, 82, 100, 100, 100][e],
    vehicleSpeedMul: [0.82, 0.91, 1, 1.05, 1.1][e],
    airFull: [220, 250, 280, 300, 320][e],
    kitFault: [0.12, 0.07, 0.03, 0.015, 0.005][e],
    ammoBox: [1, 1, 2, 2, 3][e],
    sparePump: [1, 1, 1, 1, 2][e],      // 장비 1 도 한 대(사용자 결정 2026-11-20 — 0 이면 펌프 고장에 진압이 멎어 극한의 건물 화재가 거의 다 전소했다)

    //                 침착   공황   혼란   일부   오인
    personaWeights: ([[0.14, 0.26, 0.2, 0.18, 0.22], [0.22, 0.25, 0.17, 0.18, 0.18], [0.3, 0.24, 0.15, 0.17, 0.14], [0.42, 0.22, 0.12, 0.15, 0.09], [0.56, 0.18, 0.09, 0.12, 0.05]] as [number, number, number, number, number][])[i],
    witnessAcc: [0.4, 0.5, 0.58, 0.68, 0.8][i],
    wrongAddressProb: [0.3, 0.19, 0.1, 0.04, 0][i],
    falseAlarmProb: [0.24, 0.17, 0.11, 0.06, 0.03][i],
    nuisanceGap: [70, 110, 170, 260, 420][i],

    unitLevel: r + 1,
    aidUnits: [2, 2, 3, 4, 5][r],
    flashbangs: [0, 1, 2, 3, 4][e],

    majorProb: [0.15, 0.3, 0.45, 0.6, 0.8][s],
    disasterProb: [0, 0.05, 0.1, 0.18, 0.3][s],

    trafficMul: [0.82, 0.92, 1, 1.15, 1.35][tr],
    trafficGap: [1.6, 1.25, 1, 0.8, 0.62][tr],
    parkedCount: [0, 1, 3, 5, 7][tr],

    dailyCount: [2, 3, 5, 6, 8][f],
    dailyConcurrent: [1, 2, 2, 3, 3][f],
  };
}

/** 교통 손잡이는 3 이 아닐 때만 뒤에 붙는다 (예전의 키와 프리셋 판정이 바뀌지 않게) */
const knobKey = (d: Difficulty): string => [d.frequency, d.severity, d.threat, d.equipment, d.info, d.resources ?? 3].join('-') + ((d.traffic ?? 3) !== 3 ? '-t' + d.traffic : '');
export const difficultyKey = (d: Difficulty): string => knobKey(d) + (d.disaster && d.disaster !== 'none' ? '-' + d.disaster : '');
/** 손잡이 값이 모두 1~5 인가 (저장된 설정을 믿기 전에 본다) */
export function validDifficulty(d: Difficulty): boolean {
  return ([d.frequency, d.severity, d.threat, d.equipment, d.info, d.resources ?? 3, d.traffic ?? 3] as number[]).every((x) => x >= 1 && x <= 5) && (d.disaster === undefined || parseDisaster(d.disaster) !== null);
}

export function presetOf(d: Difficulty): PresetId | null {
  for (const id of Object.keys(PRESETS) as PresetId[]) if (knobKey(PRESETS[id].d) === knobKey(d)) return id;      // 재난 선택은 프리셋과 따로다. 교통은 3(또는 없음)일 때만 프리셋이다
  return null;
}
export function difficultyLabel(d: Difficulty): string {
  const p = presetOf(d);
  const base = p ? PRESETS[p].name : `사용자 설정 ${knobKey(d)}`;
  return d.disaster && d.disaster !== 'none' ? `${base} · 재난 ${DISASTER_NAME[d.disaster]}` : base;
}

/** 'hard' 또는 '4,4,4,2,3,3' (빈도, 심각도, 용의자, 장비, 신고, 부대 규모 — 마지막은 생략하면 3). 일곱째 숫자를 주면 교통 상황이다 */
export function parseDifficulty(text: string | null | undefined): Difficulty | null {
  if (!text) return null;
  const k = text.trim().toLowerCase();
  if (k in PRESETS) return { ...PRESETS[k as PresetId].d };
  const n = k.split(/[,\-\s]+/).map((x) => parseInt(x, 10));
  if ((n.length < 5 || n.length > 7) || n.some((x) => !(x >= 1 && x <= 5))) return null;
  const d: Difficulty = { frequency: n[0], severity: n[1], threat: n[2], equipment: n[3], info: n[4], resources: n[5] ?? 3 };
  if (n.length === 7) d.traffic = n[6];
  return d;
}

/** 대략적인 종합 난도 (1 쉬움 … 5 극한). 화면 표시용. */
export function overallLevel(d: Difficulty): number {
  const base = d.frequency + d.severity + d.threat + (6 - d.equipment) + (6 - d.info) + (6 - (d.resources ?? 3));
  const tr = d.traffic ?? 3;
  return tr === 3 ? base / 6 : (base + tr) / 7;      // 교통은 기준(3)에서 벗어났을 때만 평균에 든다 (3 은 손잡이가 없는 것과 같다)
}
