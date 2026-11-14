// 도시 설정표 — 구역(블록)마다 무엇이 있는지, 도로 이름, 건물 종류의 이름과
// "어떤 사건이 어떤 건물에서 일어나는가"를 한곳에 모아 둔다.
// 지도를 바꾸고 싶으면 이 파일의 표를 고친다. 건물의 실제 자리는 city.ts 가 이 표를 읽어 만든다.

import type { District, IncidentType, PlaceKind } from './types';

/** 세로 도로 이름 (서 → 동, 9개) */
export const COL_ROADS = ['서부순환로', '느티대로', '학동로', '강변로', '중앙대로', '상공로', '동문로', '공항로', '동부순환로'];
/** 가로 도로 이름 (북 → 남, 6개) */
export const ROW_ROADS = ['북문길', '시청길', '가온대로', '공단길', '남부대로', '외곽길'];
export const RIVER_NAME = '가온천';
/** 하천이 지나는 블록 열 (강변로와 중앙대로 사이) */
export const RIVER_COL = 3;

/** 블록의 쓰임새 */
export type BlockUse =
  | 'houses' | 'bigHouses' | 'villas' | 'apt' | 'park'
  | 'office' | 'shops' | 'market' | 'mart'
  | 'factory' | 'logistics' | 'chemical' | 'redevelop'
  | 'forest' | 'farm' | 'pension' | 'rest' | 'storage' | 'reservoir' | 'airport' | 'none';

export interface BlockDef { use: BlockUse; dong: string; name?: string; span?: number }
const B = (use: BlockUse, dong: string, name?: string, span?: number): BlockDef => ({ use, dong, name, span });

/**
 * 블록 배치표: 5행 × 8열 (도로 사이의 칸). 왼쪽 위가 북서쪽.
 * span 은 오른쪽으로 이어 붙여 한 덩어리로 쓰는 칸 수(사이에 도로가 없을 때만 합쳐진다).
 */
export const BLOCKS: BlockDef[][] = [
  [B('forest', '서촌', '북산 숲'), B('houses', '서림동'), B('apt', '한솔동', '가온아파트'), B('bigHouses', '강변동'), B('office', '시청동'), B('shops', '중앙동'), B('market', '동문동', '가온시장'), B('farm', '동촌')],
  [B('farm', '서촌'), B('villas', '서림동'), B('apt', '한솔동', '가온아파트'), B('park', '강변동', '가온공원'), B('office', '시청동'), B('shops', '중앙동'), B('office', '동문동'), B('rest', '동촌', '동문 휴게소')],
  [B('pension', '서촌', '서쪽 숲'), B('houses', '느티동'), B('houses', '학동'), B('villas', '강변동'), B('shops', '중앙동'), B('mart', '상공동', '가온마트'), B('office', '동문동'), B('farm', '동촌')],
  [B('reservoir', '서촌', '가온저수지'), B('villas', '느티동'), B('houses', '학동'), B('redevelop', '강변동'), B('factory', '공단동'), B('logistics', '공단동'), B('chemical', '공단동', '가온화학'), B('forest', '동촌', '동쪽 숲')],
  [B('forest', '남촌', '남산 숲'), B('forest', '남촌', '남산 둘레길'), B('farm', '남촌'), B('forest', '남촌', '하구 습지'), B('forest', '남촌', '공단 뒤 야산'), B('storage', '남촌', '남부 저장소'), B('airport', '공항동', '가온공항', 2), B('none', '공항동')],
];

/** 쓰임새로 본 구역 (현장의 바닥·가구·위험 수치가 이것을 따른다) */
export const USE_DISTRICT: Record<BlockUse, District> = {
  houses: 'residential', bigHouses: 'residential', villas: 'residential', apt: 'residential', park: 'residential',
  office: 'commercial', shops: 'commercial', market: 'commercial', mart: 'commercial',
  factory: 'industrial', logistics: 'industrial', chemical: 'industrial', redevelop: 'residential',
  forest: 'outskirts', farm: 'outskirts', pension: 'outskirts', rest: 'outskirts', storage: 'outskirts', reservoir: 'outskirts', airport: 'outskirts', none: 'outskirts',
};

/** 건물·장소 종류의 이름 */
export const KIND_NAME: Record<PlaceKind, string> = {
  houseS: '작은 단독주택', houseL: '큰 단독주택', villa: '다세대 주택', apartment: '아파트', officetel: '오피스텔', dorm: '기숙사',
  shop: '상점', convenience: '편의점', restaurant: '식당', market: '시장', mart: '대형 마트', bank: '은행', office: '사무용 건물', hotel: '호텔', church: '교회', gasStation: '주유소',
  factory: '공장', warehouse: '창고', chemical: '화학 공장', utility: '가스 정압실', construction: '공사장', storage: '저장 시설',
  farmhouse: '농가 주택', pension: '펜션', restStop: '휴게소', greenhouse: '비닐하우스',
  terminal: '여객 터미널', hangar: '격납고', tower: '관제탑',
  fireStation: '소방서', police: '경찰서', hospital: '병원', cityHall: '시청', school: '학교', logistics: '물류 터미널',
  park: '공원', forest: '숲', riverside: '하천', reservoir: '저수지', parking: '주차장', playground: '놀이터', runway: '활주로', farmland: '농경지',
};

/** 건물 종류마다 쓰임새로 본 구역 (블록의 쓰임새와 다를 때만) */
export const KIND_DISTRICT: Partial<Record<PlaceKind, District>> = {
  houseS: 'residential', houseL: 'residential', villa: 'residential', apartment: 'residential', officetel: 'residential', dorm: 'residential',
  shop: 'commercial', convenience: 'commercial', restaurant: 'commercial', market: 'commercial', mart: 'commercial', bank: 'commercial', office: 'commercial', hotel: 'commercial', gasStation: 'commercial', terminal: 'commercial',
  factory: 'industrial', warehouse: 'industrial', chemical: 'industrial', utility: 'industrial', storage: 'industrial', hangar: 'industrial',
  farmhouse: 'outskirts', pension: 'outskirts', restStop: 'outskirts',
};

type W = Partial<Record<PlaceKind, number>>;
/**
 * 사건 유형별로 일어날 수 있는 장소와 그 비중(건물 한 채당).
 * 교통사고는 교차로에서 일어나므로 여기에 없다.
 */
export const INCIDENT_PLACES: Record<IncidentType, W> = {
  fire: { houseS: 1, houseL: 0.9, villa: 1.5, apartment: 1.5, officetel: 1.2, dorm: 1.2, shop: 1.1, restaurant: 1.6, convenience: 0.6, market: 3, mart: 2, office: 1, hotel: 1.5, bank: 0.3, church: 0.8, factory: 3, warehouse: 1.4, chemical: 1.5, farmhouse: 0.6, pension: 0.8, restStop: 0.8, hangar: 0.6, terminal: 0.4, gasStation: 0.5 },
  traffic: {},
  search: { forest: 1, park: 0.6 },
  armed: { bank: 5, convenience: 2.4, shop: 0.8, restaurant: 0.8, market: 1.2, mart: 1.5, office: 2.2, hotel: 1.6, warehouse: 1.2, factory: 0.5, gasStation: 2, restStop: 1.5, terminal: 0.8 },
  medical: { houseS: 1, houseL: 1, villa: 1.3, apartment: 1.6, officetel: 1.2, dorm: 1, farmhouse: 1.4, pension: 1 },
  collapse: { villa: 1.2, construction: 9, warehouse: 1.4, shop: 0.5, market: 1.5, factory: 0.8, houseS: 0.25, apartment: 0.3, farmhouse: 0.4, storage: 0.4 },
  hazmat: { chemical: 5, factory: 1.6, storage: 3, utility: 3, gasStation: 2.5, shop: 0.25, restaurant: 0.5, office: 0.4, mart: 1.5, apartment: 0.4, officetel: 0.4, hangar: 0.8, warehouse: 0.8 },
  water: { riverside: 1, reservoir: 2 },
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
};

// ── 이름 ──
export const NAME_PREFIX = ['가온', '새봄', '늘봄', '미래', '제일', '우리', '행복', '푸른', '동방', '대성', '한솔', '누리'];
export const BANKS = ['가람은행', '누리은행', '다온은행'];
export const CONVENIENCE = ['모아편의점', '하루편의점', '별빛편의점'];
export const RESTAURANTS = ['할매국밥', '동네분식', '청기와갈비', '바다횟집', '화덕피자', '진미반점', '골목치킨', '솔밭칼국수', '달빛포차', '아침김밥', '옛날순대', '장터국수'];
export const SHOPS = ['금은방', '약국', '철물점', '문구점', '꽃집', '안경원', '빵집', '세탁소', '미용실', '서점', '전자상가', '옷가게', '카페', '휴대폰 매장'];
export const FACTORIES = ['정밀', '금속', '식품', '전자', '제지', '섬유', '기계', '플라스틱'];
export const PENSIONS = ['솔바람', '별헤는', '물안개', '산들', '달맞이', '숲속'];
