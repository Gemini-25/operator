// 도시 설계도 — 교차로의 자리, 도로가 지나는 길, 지형(바다·강·산·철길), 동네의 성격,
// 도시에 하나뿐인 건물, 그리고 "어떤 사건이 어떤 건물에서 일어나는가"를 한곳에 모아 둔다.
// 지도를 바꾸고 싶으면 이 파일만 고친다. 일반 건물의 자리는 city.ts 가 이 설계도를 읽어 길가에 채운다.

import type { District, IncidentType, PlaceKind } from './types';

export const CITY_W = 3200, CITY_H = 2200;
export const RIVER_NAME = '가온천';

/** 교차로(와 굽은 길의 꺾이는 점)의 자리. 이름표는 도로를 적을 때 쓴다. */
export const NODES: Record<string, [number, number]> = {
  // 구도심: 중앙광장 로터리에서 여섯 갈래로 퍼지고, 안쪽·바깥쪽 순환로가 감싼다
  C0: [1600, 1050],
  I1: [1590, 820], I2: [1810, 930], I3: [1830, 1170], I4: [1630, 1290], I5: [1400, 1200], I6: [1380, 950],
  O1: [1540, 560], O2: [1880, 610], O3: [2110, 830], O4: [2170, 1120], O5: [2050, 1400], O6: [1770, 1540], O7: [1480, 1520],
  O8: [1215, 1380], O9: [1125, 1100], O10: [1040, 800], O11: [1300, 630], R0: [930, 600],
  // 강 서쪽: 강변길과 비뚤어진 주택가, 막다른 길
  W1: [760, 700], W2: [850, 900], W3: [940, 1140], W4: [1030, 1400], W5: [1120, 1660],
  W6: [540, 830], W7: [610, 1070], W8: [670, 1310], W9: [760, 1540], W10: [830, 1770],
  W11: [300, 950], W12: [350, 1210], W13: [420, 1480], W14: [480, 1740], W15: [40, 1330], W16: [200, 1780],
  D1: [470, 1100], D2: [560, 1430], D3: [190, 1090], P1: [650, 1880],
  // 산: 산복도로, 사찰, 댐, 터널, 전망대
  M1: [590, 570], M2: [420, 400], M3: [330, 250], M4: [230, 560], M5: [690, 470],
  N1: [1230, 400], N2: [1160, 150], N3: [1130, 0], N4: [1020, 330], N5: [1620, 330], N6: [1900, 260],
  // 신도시: 비스듬히 놓인 바둑판
  G00: [2180, 250], G10: [2410, 310], G20: [2640, 370], G01: [2120, 470], G11: [2350, 530], G21: [2580, 590],
  G02: [2060, 690], G12: [2290, 750], G22: [2520, 810], NX: [2460, 0],
  // 동쪽: 도시고속도로, 공항
  X0: [3000, 0], X1: [2940, 300], X2: [2830, 620], X3: [2720, 940], X4: [2650, 1260], E1: [3200, 700],
  A1: [2900, 1000], A2: [2900, 1190], Q1: [2420, 1160],
  // 남쪽: 역, 항구, 공단, 곶
  S1: [1400, 1740], S2: [1700, 1780], S3: [2000, 1720], S4: [2300, 1740], S5: [2600, 1580], S6: [2380, 1420],
  S7: [2580, 1770], S8: [2850, 1760], S9: [3030, 1960],
};
/** 도시 밖으로 이어지는 길의 끝 (인근 도시 지원 부대가 들어오는 곳) */
export const EXITS = ['W15', 'N3', 'NX', 'X0', 'E1'];

export type RoadClass = 'highway' | 'arterial' | 'street' | 'local';
export interface RoadDef { name: string; cls: RoadClass; path: string[] }
const R = (name: string, cls: RoadClass, ...path: string[]): RoadDef => ({ name, cls, path });
/** 도로: 이름, 등급, 지나는 교차로 순서. 이웃한 두 교차로 사이가 도로 한 구간이 된다. */
export const ROADS: RoadDef[] = [
  R('도시고속도로', 'highway', 'X0', 'X1', 'X2', 'X3', 'X4', 'S5'),
  R('가온대로', 'arterial', 'O3', 'I2', 'C0', 'I5', 'O8', 'W4'),
  R('중앙대로', 'arterial', 'N5', 'O1', 'I1', 'C0', 'I4', 'O6', 'S2'),
  R('시청로', 'arterial', 'O4', 'I3', 'C0', 'I6', 'O10', 'W2'),
  R('서부대로', 'arterial', 'W2', 'W7', 'W12', 'W15'),
  R('외곽순환로', 'arterial', 'O11', 'O1', 'O2', 'O3', 'O4', 'O5', 'O6', 'O7', 'O8'),
  R('해안로', 'arterial', 'W14', 'W10', 'W5', 'S1', 'S2', 'S3', 'S4', 'S7', 'S8'),
  R('신도시로', 'arterial', 'O2', 'G01', 'G11', 'G21', 'X2', 'E1'),
  R('공항로', 'arterial', 'O4', 'Q1', 'X4'),
  R('공항진입로', 'arterial', 'G22', 'X3', 'A1', 'A2'),
  R('공단로', 'arterial', 'O5', 'S6', 'S5'),
  R('산성터널로', 'arterial', 'O11', 'N1', 'N2', 'N3'),
  R('내부순환로', 'street', 'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I1'),
  R('강변동로', 'street', 'O8', 'O9', 'O10', 'R0'),
  R('강변서로', 'street', 'W1', 'W2', 'W3', 'W4', 'W5'),
  R('북천길', 'street', 'O10', 'O11'),
  R('북천교길', 'street', 'O11', 'R0', 'W1'),
  R('시청길', 'street', 'I2', 'O2'),
  R('동문로', 'street', 'I3', 'O5'),
  R('남문길', 'street', 'I4', 'O7'),
  R('남문로', 'street', 'O7', 'S1'),
  R('강변길', 'street', 'I5', 'O9'),
  R('북문길', 'street', 'I6', 'O11'),
  R('박물관길', 'street', 'O9', 'W3'),
  R('항구로', 'street', 'O5', 'S3'),
  R('공단중앙로', 'street', 'Q1', 'S6', 'S4'),
  R('부두길', 'local', 'S5', 'S7'),
  R('등대길', 'local', 'S8', 'S9'),
  R('북문로', 'street', 'N5', 'N6', 'G00'),
  R('시청북로', 'street', 'N6', 'O2'),
  R('북부로', 'street', 'NX', 'G10'),
  R('한솔1로', 'street', 'G00', 'G10', 'G20'),
  R('한솔3로', 'street', 'O3', 'G02', 'G12', 'G22'),
  R('한솔서로', 'street', 'G00', 'G01', 'G02'),
  R('한솔중앙로', 'street', 'G10', 'G11', 'G12'),
  R('한솔동로', 'street', 'G20', 'G21', 'G22'),
  R('대학로', 'street', 'W1', 'W6', 'W11'),
  R('서림로', 'street', 'W6', 'W7', 'W8', 'W9', 'W10'),
  R('서촌로', 'street', 'W11', 'W12', 'W13', 'W14'),
  R('서림2길', 'local', 'W3', 'W8'),
  R('서림남로', 'street', 'W4', 'W9', 'W13'),
  R('해변길', 'local', 'W16', 'W14', 'P1', 'W10'),
  R('산복도로', 'street', 'W1', 'M1', 'M2', 'M4', 'W11'),
  R('사찰길', 'local', 'M2', 'M3'),
  R('댐길', 'local', 'W1', 'M5'),
  R('휴양림길', 'local', 'M1', 'W6'),
  R('전망대길', 'local', 'N1', 'N4'),
  R('서림1길', 'local', 'W7', 'D1'),
  R('서림3길', 'local', 'W8', 'D2'),
  R('서촌안길', 'local', 'W11', 'D3'),
];

// ── 지형 ──
/** 해안선(서 → 동). 이 선보다 남쪽이 바다다. */
export const COAST: number[][] = [[-50, 1865], [250, 1900], [520, 1960], [800, 2010], [1050, 1990], [1250, 1940], [1340, 1905], [1450, 1930], [1700, 1960], [1950, 1930], [2150, 1905], [2400, 1920], [2650, 1885], [2850, 1905], [3000, 1995], [3080, 2060], [3140, 1960], [3250, 1880]];
/** 강의 중심선과 폭 (상류 → 하구) */
export const RIVER: number[][] = [[720, 335, 22], [800, 520, 24], [900, 700, 26], [990, 880, 28], [1040, 1060, 30], [1080, 1240, 32], [1160, 1420, 34], [1230, 1600, 38], [1300, 1780, 42], [1340, 1905, 48], [1365, 2010, 60]];
/** 호수(댐 위의 저수지) */
export const LAKE = { x: 680, y: 225, rx: 150, ry: 92, name: '가온호' };
/** 철길(서 → 동, 항구의 화물역에서 끝난다) */
export const RAIL: number[][] = [[-40, 1600], [420, 1612], [800, 1592], [1050, 1560], [1210, 1574], [1440, 1638], [1620, 1672], [1900, 1640], [2150, 1600], [2330, 1580], [2470, 1592]];
/** 산과 숲 (수색 사건이 일어나는 곳) */
export const MOUNTAINS: { name: string; x: number; y: number; rx: number; ry: number }[] = [
  { name: '북산 자연휴양림', x: 400, y: 300, rx: 430, ry: 300 },
  { name: '산성 숲길', x: 1060, y: 170, rx: 330, ry: 190 },
  { name: '서산 임도', x: 120, y: 800, rx: 170, ry: 250 },
  { name: '동북 구릉', x: 2760, y: 110, rx: 250, ry: 120 },
  { name: '곶 솔숲', x: 2960, y: 1850, rx: 130, ry: 80 },
];

/** 동네: 중심에서 멀어질수록 옆 동네와 섞인다. mix 는 길가에 들어서는 건물 종류의 비중이다. */
export interface DistrictDef { dong: string; x: number; y: number; r: number; district: District; density: number; mix: Partial<Record<PlaceKind, number>> }
export const DISTRICTS: DistrictDef[] = [
  { dong: '중앙동', x: 1600, y: 1050, r: 290, district: 'commercial', density: 0.96, mix: { shop: 3, restaurant: 3, cafe: 1.5, office: 1.4, bank: 0.5, hotel: 0.35, villa: 1, houseS: 0.6, convenience: 0.7, clinic: 0.5, officetel: 0.6, church: 0.1 } },
  { dong: '시청동', x: 1880, y: 800, r: 270, district: 'commercial', density: 0.95, mix: { office: 4, officetel: 1.5, bank: 0.8, hotel: 0.5, shop: 1.2, restaurant: 1.3, cafe: 0.9, parking: 0.3, convenience: 0.4, clinic: 0.3 } },
  { dong: '남문동', x: 1640, y: 1450, r: 270, district: 'commercial', density: 0.9, mix: { shop: 2, restaurant: 2.2, villa: 2, officetel: 0.9, hotel: 0.4, office: 0.8, convenience: 0.6, houseS: 1, workshop: 0.4, cafe: 0.6 } },
  { dong: '강변동', x: 1250, y: 1080, r: 250, district: 'residential', density: 0.82, mix: { houseL: 3, villa: 2, cafe: 1.1, restaurant: 0.8, houseS: 1, shop: 0.5, church: 0.2, clinic: 0.2 } },
  { dong: '동문동', x: 2090, y: 1230, r: 280, district: 'residential', density: 0.86, mix: { villa: 2.5, houseS: 2, shop: 1.2, workshop: 0.9, restaurant: 1, convenience: 0.5, church: 0.2, office: 0.5, gasStation: 0.15, cafe: 0.3 } },
  { dong: '북문동', x: 1520, y: 560, r: 300, district: 'residential', density: 0.74, mix: { houseS: 3, houseL: 1.2, villa: 1.5, shop: 0.5, convenience: 0.3, church: 0.2, cafe: 0.3, farmhouse: 0.3, workshop: 0.15 } },
  { dong: '한솔동', x: 2350, y: 540, r: 390, district: 'residential', density: 0.86, mix: { apartment: 5, officetel: 1, shop: 1, restaurant: 0.8, convenience: 0.5, clinic: 0.4, cafe: 0.5, office: 0.4, church: 0.1 } },
  { dong: '서림동', x: 620, y: 1150, r: 380, district: 'residential', density: 0.78, mix: { houseS: 4, houseL: 1.2, villa: 1.2, shop: 0.45, convenience: 0.3, church: 0.2, workshop: 0.25, cafe: 0.2, clinic: 0.1, restaurant: 0.3 } },
  { dong: '대학동', x: 800, y: 780, r: 230, district: 'residential', density: 0.86, mix: { villa: 3, restaurant: 1.6, cafe: 1.3, shop: 1, officetel: 0.8, houseS: 1, convenience: 0.5 } },
  { dong: '해변동', x: 660, y: 1770, r: 350, district: 'outskirts', density: 0.72, mix: { pension: 3, restaurant: 2, cafe: 1, houseS: 2, hotel: 0.5, shop: 0.8, convenience: 0.4 } },
  { dong: '서촌', x: 280, y: 1250, r: 300, district: 'outskirts', density: 0.42, mix: { farmhouse: 2, houseS: 1.5, greenhouse: 1.5, warehouse: 0.2, pension: 0.3 } },
  { dong: '공단동', x: 2400, y: 1370, r: 310, district: 'industrial', density: 0.86, mix: { factory: 3, warehouse: 2.5, workshop: 1.5, dorm: 0.3, utility: 0.2, storage: 0.5, restaurant: 0.35, gasStation: 0.2, office: 0.3 } },
  { dong: '항구동', x: 2120, y: 1780, r: 390, district: 'industrial', density: 0.82, mix: { warehouse: 3, restaurant: 1.3, factory: 1, shop: 0.6, office: 0.6, storage: 0.4, hotel: 0.2, workshop: 0.7 } },
  { dong: '남항동', x: 1540, y: 1770, r: 240, district: 'residential', density: 0.8, mix: { villa: 1.6, restaurant: 1.6, houseS: 1.6, shop: 1, warehouse: 0.5, hotel: 0.3, cafe: 0.5 } },
  { dong: '공항동', x: 2830, y: 960, r: 250, district: 'outskirts', density: 0.5, mix: { hotel: 1, warehouse: 1.5, parking: 1, gasStation: 0.4, office: 0.5, restaurant: 0.5 } },
  { dong: '산촌', x: 430, y: 520, r: 340, district: 'outskirts', density: 0.3, mix: { pension: 2, farmhouse: 1.5, houseS: 0.5, cafe: 0.3 } },
  { dong: '북촌', x: 1800, y: 270, r: 330, district: 'outskirts', density: 0.36, mix: { farmhouse: 2, greenhouse: 2, houseS: 1, warehouse: 0.2 } },
  { dong: '곶마을', x: 2850, y: 1740, r: 240, district: 'outskirts', density: 0.46, mix: { pension: 1.5, restaurant: 1, houseS: 1.5, farmhouse: 1 } },
];

/** 도시에 하나뿐이거나 손으로 자리를 정한 건물과 터. (x, y) 는 가운데, rot 은 도(°). rank 3 은 지도를 멀리서 봐도 이름이 보인다. */
export interface LandmarkDef { kind: PlaceKind; name: string; x: number; y: number; w: number; h: number; rot?: number; floors?: number; open?: boolean; rank?: number; facility?: 'fireStation' | 'police' | 'hospital' | 'public' }
const L = (kind: PlaceKind, name: string, x: number, y: number, w: number, h: number, o: Partial<LandmarkDef> = {}): LandmarkDef => ({ kind, name, x, y, w, h, ...o });
export const LANDMARKS: LandmarkDef[] = [
  // 출동 시설 (순서는 부대 편성표의 시설 번호와 같다)
  L('fireStation', '중앙소방서', 1350, 1380, 78, 62, { facility: 'fireStation', rank: 3 }),
  L('fireStation', '공단119안전센터', 2235, 1525, 78, 62, { facility: 'fireStation', rank: 3 }),
  L('hospital', '시립병원', 1985, 1015, 78, 62, { facility: 'hospital', rank: 3 }),
  L('police', '중부경찰서', 1455, 735, 78, 62, { facility: 'police', rank: 3 }),
  L('police', '동부지구대', 2290, 935, 78, 62, { facility: 'police', rank: 3 }),
  L('cityHall', '시청', 1710, 725, 78, 62, { facility: 'public', rank: 3 }),
  L('school', '서림초등학교', 500, 1275, 78, 62, { facility: 'public', rank: 2 }),
  L('logistics', '물류터미널', 2455, 1650, 78, 62, { facility: 'public', rank: 2 }),
  L('fireStation', '서부119안전센터', 700, 1150, 78, 62, { facility: 'fireStation', rank: 3 }),
  L('fireStation', '한솔119안전센터', 2270, 395, 78, 62, { facility: 'fireStation', rank: 3 }),
  L('police', '서부지구대', 650, 1670, 78, 62, { facility: 'police', rank: 3 }),
  L('hospital', '가온대학교병원', 830, 1045, 78, 62, { facility: 'hospital', rank: 3 }),
  L('fireStation', '소방항공대', 2845, 1262, 78, 62, { facility: 'fireStation', rank: 3 }),
  L('fireStation', '해양구조대', 1705, 1890, 78, 62, { facility: 'fireStation', rank: 3 }),
  // 하나뿐인 건물
  L('station', '가온역', 1622, 1676, 150, 30, { rot: 9, floors: 2, rank: 3 }),
  L('stadium', '종합운동장', 1740, 440, 150, 112, { rot: -8, floors: 3, rank: 3 }),
  L('university', '가온대학교', 690, 880, 150, 110, { rot: 22, floors: 4, rank: 3 }),
  L('deptStore', '가온백화점', 1945, 775, 84, 62, { rot: 40, floors: 7, rank: 3 }),
  L('cathedral', '중앙성당', 1470, 1068, 44, 66, { rot: -12, floors: 4, rank: 3 }),
  L('temple', '산성사', 300, 205, 74, 56, { floors: 1, rank: 3 }),
  L('powerPlant', '가온화력발전소', 2680, 1700, 120, 84, { rot: -3, floors: 3, rank: 3 }),
  L('broadcast', '가온방송국', 2010, 415, 66, 54, { rot: -14, floors: 6, rank: 3 }),
  L('prison', '가온교도소', 3030, 470, 124, 100, { rot: 12, floors: 2, rank: 3 }),
  L('museum', '시립박물관', 1233, 950, 72, 52, { rot: 62, floors: 2, rank: 3 }),
  L('library', '시립도서관', 1245, 765, 56, 44, { rot: -32, floors: 3, rank: 2 }),
  L('busTerminal', '시외버스터미널', 1850, 1375, 104, 56, { rot: 28, floors: 2, rank: 3 }),
  L('ferry', '여객선 터미널', 1850, 1880, 100, 40, { rot: -4, floors: 2, rank: 3 }),
  L('fishMarket', '수산시장', 2090, 1850, 124, 42, { rot: -6, floors: 1, rank: 3 }),
  L('market', '가온시장', 1530, 1345, 108, 46, { rot: -57, floors: 1, rank: 3 }),
  L('mart', '가온마트', 2205, 600, 104, 76, { rot: 15, floors: 2, rank: 3 }),
  L('amusement', '해변 놀이공원', 985, 1855, 132, 96, { rot: -6, open: true, rank: 3 }),
  L('lighthouse', '곶 등대', 3050, 2020, 22, 22, { floors: 6, rank: 3 }),
  L('dam', '가온댐', 722, 322, 96, 20, { rot: 14, floors: 2, rank: 3 }),
  L('lookout', '산성 전망대', 986, 322, 40, 34, { floors: 2, rank: 2 }),
  L('substation', '동부 변전소', 2575, 1055, 62, 50, { rot: 15, rank: 2 }),
  L('chemical', '가온화학', 2521, 1461, 96, 60, { rot: 36, floors: 2, rank: 3 }),
  L('storage', '공단 저장소', 2580, 1385, 56, 48, { rot: 15, rank: 2 }),
  L('construction', '동문 재개발 공사장', 2235, 1275, 110, 84, { rot: 10, floors: 3, rank: 3 }),
  L('school', '한솔중학교', 2440, 690, 72, 54, { rot: 15, floors: 3, rank: 2 }),
  L('school', '동문고등학교', 1945, 1215, 70, 52, { rot: -24, floors: 3, rank: 2 }),
  L('campsite', '해솔 캠핑장', 170, 1700, 110, 84, { open: true, rank: 2 }),
  L('containerYard', '컨테이너 부두', 2390, 1865, 250, 84, { rot: 2, open: true, rank: 3 }),
  // 공항
  L('runway', '가온공항 활주로', 3095, 1345, 560, 30, { rot: -90, open: true, rank: 3 }),
  L('terminal', '가온공항 여객 터미널', 2972, 1235, 120, 40, { rot: -90, floors: 2, rank: 3 }),
  L('tower', '가온공항 관제탑', 2948, 1345, 15, 15, { floors: 6, rank: 2 }),
  L('hangar', '가온공항 격납고 1', 2975, 1425, 50, 40, { rot: -90, rank: 2 }),
  L('hangar', '가온공항 격납고 2', 2975, 1485, 50, 40, { rot: -90, rank: 2 }),
  L('storage', '가온공항 항공유 저장소', 2970, 1560, 42, 34, { rank: 2 }),
  L('parking', '가온공항 주차장', 2845, 1120, 60, 90, { open: true, rank: 1 }),
  // 공원과 터
  L('park', '가온공원', 1085, 955, 74, 150, { rot: 14, open: true, rank: 3 }),
  L('park', '시민의 숲', 2300, 1045, 150, 100, { rot: 8, open: true, rank: 3 }),
  L('park', '남문공원', 1700, 1425, 70, 60, { rot: 25, open: true, rank: 2 }),
  L('park', '서림공원', 795, 1215, 80, 90, { rot: -14, open: true, rank: 2 }),
  L('park', '한솔중앙공원', 2440, 485, 100, 70, { rot: 15, open: true, rank: 2 }),
  L('beach', '가온해수욕장', 730, 1958, 640, 80, { open: true, rank: 3 }),
  L('pier', '여객 부두', 1830, 1975, 30, 110, { rot: -4, open: true, rank: 2 }),
  L('pier', '어항 부두', 2110, 1950, 26, 100, { rot: -6, open: true, rank: 2 }),
  L('forest', '하구 갈대밭', 1190, 1800, 110, 130, { open: true, rank: 2 }),
];

/** 건물·장소 종류의 이름 */
export const KIND_NAME: Record<PlaceKind, string> = {
  houseS: '작은 단독주택', houseL: '큰 단독주택', villa: '다세대 주택', apartment: '아파트', officetel: '오피스텔', dorm: '기숙사',
  shop: '상점', convenience: '편의점', restaurant: '식당', market: '시장', mart: '대형 마트', bank: '은행', office: '사무용 건물', hotel: '호텔', church: '교회', gasStation: '주유소',
  factory: '공장', warehouse: '창고', chemical: '화학 공장', utility: '가스 정압실', construction: '공사장', storage: '저장 시설',
  farmhouse: '농가 주택', pension: '펜션', restStop: '휴게소', greenhouse: '비닐하우스',
  terminal: '여객 터미널', hangar: '격납고', tower: '관제탑',
  fireStation: '소방서', police: '경찰서', hospital: '병원', cityHall: '시청', school: '학교', logistics: '물류 터미널',
  park: '공원', forest: '숲', riverside: '하천', reservoir: '저수지', parking: '주차장', playground: '놀이터', runway: '활주로', farmland: '농경지',
  station: '기차역', stadium: '경기장', university: '대학교', deptStore: '백화점', cathedral: '성당', temple: '사찰', powerPlant: '발전소', broadcast: '방송국', prison: '교도소',
  museum: '박물관', library: '도서관', busTerminal: '버스 터미널', ferry: '여객선 터미널', fishMarket: '수산시장', lighthouse: '등대', amusement: '놀이공원', dam: '댐', substation: '변전소',
  beach: '해수욕장', pier: '부두', containerYard: '컨테이너 부두', campsite: '캠핑장', lookout: '전망대', workshop: '공업사', clinic: '의원', cafe: '카페',
};

/** 건물 종류마다 쓰임새로 본 구역 (블록의 쓰임새와 다를 때만) */
export const KIND_DISTRICT: Partial<Record<PlaceKind, District>> = {
  houseS: 'residential', houseL: 'residential', villa: 'residential', apartment: 'residential', officetel: 'residential', dorm: 'residential',
  shop: 'commercial', convenience: 'commercial', restaurant: 'commercial', market: 'commercial', mart: 'commercial', bank: 'commercial', office: 'commercial', hotel: 'commercial', gasStation: 'commercial', terminal: 'commercial',
  factory: 'industrial', warehouse: 'industrial', chemical: 'industrial', utility: 'industrial', storage: 'industrial', hangar: 'industrial',
  farmhouse: 'outskirts', pension: 'outskirts', restStop: 'outskirts',
  workshop: 'industrial', powerPlant: 'industrial', substation: 'industrial', fishMarket: 'commercial', clinic: 'commercial', cafe: 'commercial',
  station: 'commercial', deptStore: 'commercial', busTerminal: 'commercial', ferry: 'commercial', museum: 'commercial', library: 'commercial', broadcast: 'commercial',
  university: 'commercial', cathedral: 'commercial', stadium: 'commercial', temple: 'outskirts', prison: 'commercial',
};

type W = Partial<Record<PlaceKind, number>>;
/**
 * 사건 유형별로 일어날 수 있는 장소와 그 몫. 값은 "그 종류의 건물 전체"가 차지하는 비중이다
 * (은행이 다섯 곳뿐이어도 무장 사건의 14/약 110 은 은행에서 난다). 교통사고는 교차로에서 일어나므로 여기에 없다.
 */
export const INCIDENT_PLACES: Record<IncidentType, W> = {
  fire: { houseS: 10, houseL: 5, villa: 9, apartment: 9, officetel: 3, dorm: 1, shop: 6, restaurant: 8, cafe: 3, convenience: 2, market: 2, mart: 1.5, deptStore: 1.5, office: 5, hotel: 2, bank: 0.5, church: 1, clinic: 1,
    factory: 6, warehouse: 6, workshop: 5, chemical: 1.5, farmhouse: 2, pension: 2, hangar: 0.5, terminal: 0.4, gasStation: 1, university: 1, cathedral: 0.5, temple: 1, museum: 0.5, library: 0.5, busTerminal: 0.5, ferry: 0.5,
    fishMarket: 1.2, station: 0.5, powerPlant: 1, broadcast: 0.5, stadium: 0.3 },
  traffic: {},
  search: { forest: 10, park: 2, campsite: 1 },
  armed: { bank: 14, convenience: 14, shop: 7, restaurant: 7, cafe: 4, market: 3, mart: 3, deptStore: 4, office: 10, hotel: 5, warehouse: 5, factory: 2, gasStation: 5, terminal: 2, station: 3, busTerminal: 2, ferry: 1, museum: 2,
    university: 1.5, clinic: 1, broadcast: 1, fishMarket: 1.5, workshop: 2 },
  medical: { houseS: 10, houseL: 5, villa: 9, apartment: 10, officetel: 4, dorm: 1, farmhouse: 3, pension: 2 },
  collapse: { villa: 8, construction: 6, warehouse: 5, shop: 3, market: 2, factory: 3, houseS: 2, apartment: 2, farmhouse: 1.5, storage: 1, workshop: 3, deptStore: 0.6, stadium: 0.5, temple: 0.8, fishMarket: 1 },
  hazmat: { chemical: 6, factory: 6, storage: 5, utility: 4, gasStation: 4, shop: 1, restaurant: 2, office: 1.5, mart: 1.5, apartment: 2, officetel: 1, hangar: 1, warehouse: 3, powerPlant: 2.5, substation: 2, workshop: 4, fishMarket: 1.2, university: 1.2 },
  water: { riverside: 6, reservoir: 1.5, beach: 4, pier: 2.5 },
};

/** 현장을 만들 때 건물 종류가 정하는 것: 평면의 틀 비중 [복도형, 방 연결형, 홀형], 2층일 확률, 무장 사건의 장소 */
export interface KindScene { arch: [number, number, number]; tall: number; venue?: 'shop' | 'bank' | 'office' | 'warehouse'; home?: 'small' | 'large' }
export const KIND_SCENE: Partial<Record<PlaceKind, KindScene>> = {
  houseS: { arch: [0.45, 0.55, 0], tall: 0, home: 'small' },
  houseL: { arch: [0.4, 0.6, 0], tall: 0.5, home: 'large' },
  villa: { arch: [0.7, 0.3, 0], tall: 0.5, home: 'large' },
  apartment: { arch: [1, 0, 0], tall: 0.6, home: 'large' },
  officetel: { arch: [1, 0, 0], tall: 0.5, home: 'small' },
  dorm: { arch: [1, 0, 0], tall: 0.5, home: 'small' },
  farmhouse: { arch: [0.45, 0.55, 0], tall: 0, home: 'small' },
  pension: { arch: [0.5, 0.5, 0], tall: 0.4, home: 'large' },
  shop: { arch: [0.1, 0.4, 0.5], tall: 0.25, venue: 'shop' },
  convenience: { arch: [0, 0.3, 0.7], tall: 0, venue: 'shop' },
  restaurant: { arch: [0, 0.5, 0.5], tall: 0.2, venue: 'shop' },
  market: { arch: [0, 0, 1], tall: 0, venue: 'shop' },
  mart: { arch: [0, 0, 1], tall: 0.3, venue: 'shop' },
  gasStation: { arch: [0, 0.4, 0.6], tall: 0, venue: 'shop' },
  restStop: { arch: [0, 0.3, 0.7], tall: 0, venue: 'shop' },
  bank: { arch: [0.3, 0.3, 0.4], tall: 0.3, venue: 'bank' },
  office: { arch: [0.65, 0.35, 0], tall: 0.5, venue: 'office' },
  hotel: { arch: [1, 0, 0], tall: 0.6, venue: 'office' },
  church: { arch: [0, 0.2, 0.8], tall: 0 },
  terminal: { arch: [0.2, 0, 0.8], tall: 0.4, venue: 'office' },
  factory: { arch: [0.35, 0, 0.65], tall: 0.3, venue: 'warehouse' },
  chemical: { arch: [0.45, 0, 0.55], tall: 0.3 },
  warehouse: { arch: [0.1, 0, 0.9], tall: 0, venue: 'warehouse' },
  hangar: { arch: [0, 0, 1], tall: 0, venue: 'warehouse' },
  storage: { arch: [0.4, 0, 0.6], tall: 0 },
  utility: { arch: [0.5, 0.5, 0], tall: 0 },
  construction: { arch: [0.5, 0.2, 0.3], tall: 0.5 },
  workshop: { arch: [0.3, 0, 0.7], tall: 0, venue: 'warehouse' },
  cafe: { arch: [0, 0.5, 0.5], tall: 0, venue: 'shop' },
  clinic: { arch: [0.8, 0.2, 0], tall: 0.3, venue: 'office' },
  deptStore: { arch: [0, 0, 1], tall: 0.6, venue: 'shop' },
  station: { arch: [0.2, 0, 0.8], tall: 0.3, venue: 'office' },
  busTerminal: { arch: [0.2, 0, 0.8], tall: 0, venue: 'office' },
  ferry: { arch: [0.2, 0, 0.8], tall: 0, venue: 'office' },
  university: { arch: [0.8, 0.2, 0], tall: 0.6, venue: 'office' },
  museum: { arch: [0.4, 0, 0.6], tall: 0.3, venue: 'office' },
  library: { arch: [0.5, 0, 0.5], tall: 0.4, venue: 'office' },
  broadcast: { arch: [0.8, 0.2, 0], tall: 0.6, venue: 'office' },
  cathedral: { arch: [0, 0.1, 0.9], tall: 0 },
  temple: { arch: [0, 0.8, 0.2], tall: 0 },
  fishMarket: { arch: [0, 0, 1], tall: 0, venue: 'shop' },
  powerPlant: { arch: [0.4, 0, 0.6], tall: 0.3 },
  substation: { arch: [0.5, 0.5, 0], tall: 0 },
  stadium: { arch: [0.3, 0, 0.7], tall: 0 },
};

// ── 이름 ──
export const NAME_PREFIX = ['가온', '새봄', '늘봄', '미래', '제일', '우리', '행복', '푸른', '동방', '대성', '한솔', '누리'];
export const BANKS = ['가람은행', '누리은행', '다온은행'];
export const CONVENIENCE = ['모아편의점', '하루편의점', '별빛편의점'];
export const RESTAURANTS = ['할매국밥', '동네분식', '청기와갈비', '바다횟집', '화덕피자', '진미반점', '골목치킨', '솔밭칼국수', '달빛포차', '아침김밥', '옛날순대', '장터국수'];
export const SHOPS = ['금은방', '약국', '철물점', '문구점', '꽃집', '안경원', '빵집', '세탁소', '미용실', '서점', '전자상가', '옷가게', '카페', '휴대폰 매장'];
export const FACTORIES = ['정밀', '금속', '식품', '전자', '제지', '섬유', '기계', '플라스틱'];
export const PENSIONS = ['솔바람', '별헤는', '물안개', '산들', '달맞이', '숲속'];
