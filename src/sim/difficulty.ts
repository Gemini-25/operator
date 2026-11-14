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
  resources: number;   // 부대 규모        1 = 4대 … 3 = 6대 … 5 = 10대   (높을수록 쉬움)
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
  { key: 'equipment', name: '대원 장비 상태', low: '불량', high: '최상', harderWhen: 'low', desc: '차량 주행 속도, 펌프 상태와 마모, 용수 탱크, 구조 장비, 의료 장비, 방호 장비, 출근 시 체력' },
  { key: 'info', name: '신고 신뢰도', low: '엉망', high: '정확', harderWhen: 'low', desc: '침착한 신고자 비율, 위치를 틀리게 말할 확률, 허위·오인 신고와 비긴급 전화의 빈도, 목격자 정확도' },
  { key: 'resources', name: '부대 규모', low: '4대', high: '10대', harderWhen: 'low', desc: '출동 부대 수 (4 · 5 · 6 · 8 · 10대). 3 이 기본 편성(소방 2, 구급 2, 경찰 2)' },
];

export interface Tuning {
  // 빈도
  gapMul: number; maxIncidents: number; maxConcurrent: number;
  // 심각도
  sevWeights: [number, number, number]; hazardMul: number; bleedMul: number; fireSpreadMul: number;
  // 용의자
  armedWeight: number; shooterWeight: number; aggroShift: number; skillShift: number; accompliceProb: number; extraSuspectProb: number; fleeShift: number; knifeProb: number;
  // 장비
  pumpMin: number; pumpMax: number; waterMul: number; toolMul: number; medMul: number; armorMul: number; pumpWearMul: number; startStamina: number; vehicleSpeedMul: number;
  // 신고
  personaWeights: [number, number, number, number, number]; witnessAcc: number; wrongAddressProb: number; falseAlarmProb: number; nuisanceGap: number;
  // 부대
  unitLevel: number; flashbangs: number;
}

const lv = (v: number): number => Math.max(0, Math.min(4, Math.round(v) - 1));

export function tuningOf(d: Difficulty): Tuning {
  const f = lv(d.frequency), s = lv(d.severity), t = lv(d.threat), e = lv(d.equipment), i = lv(d.info), r = lv(d.resources ?? 3);
  return {
    gapMul: [1.55, 1.25, 1, 0.76, 0.58][f],
    maxIncidents: [5, 6, 7, 9, 11][f],
    maxConcurrent: [2, 3, 3, 4, 5][f],

    sevWeights: ([[0.5, 0.4, 0.1], [0.38, 0.44, 0.18], [0.28, 0.45, 0.27], [0.17, 0.43, 0.4], [0.08, 0.37, 0.55]] as [number, number, number][])[s],
    hazardMul: [0.55, 0.78, 1, 1.25, 1.5][s],
    bleedMul: [0.78, 0.9, 1, 1.12, 1.26][s],
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

    //                 침착   공황   혼란   일부   오인
    personaWeights: ([[0.14, 0.26, 0.2, 0.18, 0.22], [0.22, 0.25, 0.17, 0.18, 0.18], [0.3, 0.24, 0.15, 0.17, 0.14], [0.42, 0.22, 0.12, 0.15, 0.09], [0.56, 0.18, 0.09, 0.12, 0.05]] as [number, number, number, number, number][])[i],
    witnessAcc: [0.4, 0.5, 0.58, 0.68, 0.8][i],
    wrongAddressProb: [0.3, 0.19, 0.1, 0.04, 0][i],
    falseAlarmProb: [0.24, 0.17, 0.11, 0.06, 0.03][i],
    nuisanceGap: [70, 110, 170, 260, 420][i],

    unitLevel: r + 1,
    flashbangs: [0, 1, 2, 3, 4][e],
  };
}

export const difficultyKey = (d: Difficulty): string => [d.frequency, d.severity, d.threat, d.equipment, d.info, d.resources ?? 3].join('-');

export function presetOf(d: Difficulty): PresetId | null {
  for (const id of Object.keys(PRESETS) as PresetId[]) if (difficultyKey(PRESETS[id].d) === difficultyKey(d)) return id;
  return null;
}
export function difficultyLabel(d: Difficulty): string {
  const p = presetOf(d);
  return p ? PRESETS[p].name : `사용자 설정 ${difficultyKey(d)}`;
}

/** 'hard' 또는 '4,4,4,2,3,3' (빈도, 심각도, 용의자, 장비, 신고, 부대 규모 — 마지막은 생략하면 3) */
export function parseDifficulty(text: string | null | undefined): Difficulty | null {
  if (!text) return null;
  const k = text.trim().toLowerCase();
  if (k in PRESETS) return { ...PRESETS[k as PresetId].d };
  const n = k.split(/[,\-\s]+/).map((x) => parseInt(x, 10));
  if ((n.length !== 5 && n.length !== 6) || n.some((x) => !(x >= 1 && x <= 5))) return null;
  return { frequency: n[0], severity: n[1], threat: n[2], equipment: n[3], info: n[4], resources: n[5] ?? 3 };
}

/** 대략적인 종합 난도 (1 쉬움 … 5 극한). 화면 표시용. */
export function overallLevel(d: Difficulty): number {
  return (d.frequency + d.severity + d.threat + (6 - d.equipment) + (6 - d.info) + (6 - (d.resources ?? 3))) / 6;
}
