// 지도 범례: 지도 왼쪽 아래의 접히는 상자 (기본은 접힘 — `범례` 단추).
// 표시 방식의 하나일 뿐이다. 시뮬레이션에는 아무 영향이 없고, AI 에게 무엇도 시키지 않는다.

import { useState } from 'react';
import { FIELD_NAME, UNIT_KIND_NAME } from '../sim/resources';
import type { IncidentType, RoleGroup, UnitField, UnitKind } from '../sim/types';
import { TYPE_DEFS, TYPE_ORDER } from '../sim/incidentTypes';
import { FACILITY_COLOR, FIELD_COLOR, FIELD_TEXT } from '../view/city/tokens';
import { DISASTER_RING, OBSTACLE_ICON, REPAIR_RING } from '../view/city/trafficLayer';
import { FENCE } from '../view/city/carryLayer';
import { SUBWAY_GLYPH, SUBWAY_LINE } from '../view/city/kinds2Layer';
import { ICON_PATH } from '../view/icons';
import { HAZARD_MARK, REPAIR_MARK, RUIN_MARK, STATE_MARK } from '../view/marks';
import { EXPO_CRACK, EXPO_PIPE } from '../view/city/ruinLayer';
import { ZONE_LOOK } from '../view/city/zoneLayer';
import { TYPE_COLOR } from '../view/typeStyle';
import { FacilityBadge, RoleDot, Token } from './Mark';

const LS_LEGEND = 'ar.legend.v1';
const FIELDS: [UnitField, UnitKind[]][] = [
  ['police', ['patrol', 'tactical', 'policeHeli', 'detective', 'trafficPol', 'k9', 'riotPol']],      // (N9) 기동대
  ['fire', ['engine', 'ladder']],
  ['rescue', ['rescue', 'als', 'bls', 'medHeli', 'mtnRescue', 'dive']],      // (N9) 산악·수중 구조대
  ['special', ['swat', 'eod', 'hazmat', 'heli', 'boat', 'animalCtl', 'deconUnit']],      // (N9) 화생방 제독차
  ['civil', ['powerCrew', 'gasCrew', 'waterCrew', 'tow']],      // (N8) 유관 기관
];
/** (R1) 대원의 역할 묶음: 부대 목록의 역할 점. 분야색은 그 대원의 부대를 따른다 (여기서는 대표 분야로 보인다) */
const ROLES: [RoleGroup, string, UnitField][] = [
  ['lead', '부대장·팀장', 'police'], ['officer', '경관·기동대원', 'police'], ['shield', '방패수', 'special'], ['marksman', '저격·관측수', 'special'],
  ['bomb', '폭발물 처리', 'special'], ['observer', '전술 관측관', 'police'], ['pilot', '조종사·정장', 'special'],
  ['nozzle', '관창수', 'fire'], ['entry', '진입대원', 'fire'], ['engineer', '기관원·조작원', 'fire'],
  ['rescue', '구조대원', 'rescue'], ['search', '탐지 대원', 'rescue'], ['water', '수난·로프 구조', 'rescue'], ['hazmat', '화학 대원', 'special'],
  ['medic', '응급구조사·간호사', 'rescue'], ['doctor', '의사', 'rescue'], ['civil', '유관 기관 기사', 'civil'],
];
const STATES: [string, string, string][] = [
  ['available', '대기', '테 없음'],
  ['enroute', '출동', '도는 점선'],
  ['onscene', '현장', '노란 실선'],
  ['transport', '이송', '초록 실선 + 십자'],
  ['returning', '복귀', '옅게'],
];
const FACILITIES: [string, string][] = [['fireStation', '소방서'], ['police', '경찰서'], ['hospital', '병원'], ['public', '공공 기관'], ['heliport', '항공대'], ['harbor', '해양구조대']];
/** 도로 상태의 색 (교통 묶음이 지도에 그리는 색과 같다) */
const ROADS: [string, string, boolean][] = [['서행', '#f2c94c', false], ['정체', '#ff9f43', false], ['극심', '#ff5d5d', false], ['통제', '#ff5d5d', true]];

/** 길 위의 장애물 (교통 묶음이 지도에 그리는 표식과 같다: 어두운 바탕 + 노란 테 + 그림 기호) */
const OBSTACLES: [keyof typeof OBSTACLE_ICON, string][] = [['roadwork', '공사'], ['breakdown', '고장 차량'], ['debris', '낙하물'], ['parked', '불법 주차'], ['rubble', '건물 잔해']];      // 건물 잔해: (I1-b C2) 무너지거나 터진 건물의 잔해가 길에 남은 것
function ObstacleSample({ kind, unknown = false, size = 20 }: { kind: keyof typeof OBSTACLE_ICON; unknown?: boolean; size?: number }) {
  const c = size / 2, r = size / 2 - 1.5, g = r * 1.36;
  return (
    <svg className="token" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" opacity={unknown ? 0.8 : 1}>
      <circle cx={c} cy={c} r={r} fill="#161d24" stroke="#f2c94c" strokeWidth={1.4} strokeDasharray={unknown ? '2.4 2.2' : undefined} />
      <svg x={c - g / 2} y={c - g / 2} width={g} height={g} viewBox="0 0 24 24"><path d={OBSTACLE_ICON[kind]} fill={kind === 'parked' ? '#d9e1e8' : '#f2c94c'} fillRule="evenodd" /></svg>
      {kind === 'parked' && <line x1={c - g * 0.4} y1={c + g * 0.4} x2={c + g * 0.4} y2={c - g * 0.4} stroke="#ff5d5d" strokeWidth={g * 0.14} strokeLinecap="round" />}
    </svg>
  );
}

/** (G4 §7.5) 통제 구간의 진입 금지 표시: 빨간 원 + 원인 색 테 */
function ClosureSample({ ring, size = 22 }: { ring: string; size?: number }) {
  const c = size / 2;
  return (
    <svg className="token" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={size * 0.33} fill="#ff5d5d" />
      <rect x={c - size * 0.21} y={c - size * 0.065} width={size * 0.42} height={size * 0.13} fill="#0b1219" />
      <circle cx={c} cy={c} r={size * 0.44} fill="none" stroke={ring} strokeWidth={1.8} />
    </svg>
  );
}

/** 사건 핀의 견본: 어두운 바탕 + 유형색 테 + 유형 아이콘 + 경과 고리 */
function PinSample({ size = 22 }: { size?: number }) {
  const c = size / 2, r = size * 0.34, col = '#ff6b3d';
  return (
    <svg className="pin-sample" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="#0d151d" stroke={col} strokeWidth={1.6} />
      <svg x={c - r * 0.62} y={c - r * 0.62} width={r * 1.24} height={r * 1.24} viewBox="0 0 24 24"><path d={ICON_PATH.fire} fill={col} fillRule="evenodd" /></svg>
      <path d={`M${c} ${c - r - 2.4}A${r + 2.4} ${r + 2.4} 0 0 1 ${c + r + 2.4} ${c}`} fill="none" stroke="#e8f0f7" strokeWidth={1.5} />
    </svg>
  );
}

/** (N8 §5.12 — 단계 11) 사건 유형 열셋의 핀 견본: 어두운 바탕 + 유형색 테 + 유형 기호 (시나리오별 기호는 없다 — 결정 13) */
function TypePinSample({ type, size = 20 }: { type: IncidentType; size?: number }) {
  const c = size / 2, r = size * 0.4, col = TYPE_COLOR[type];
  return (
    <svg className="pin-sample" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="#0d151d" stroke={col} strokeWidth={1.6} />
      <svg x={c - r * 0.62} y={c - r * 0.62} width={r * 1.24} height={r * 1.24} viewBox="0 0 24 24"><path d={ICON_PATH[type]} fill={col} fillRule="evenodd" /></svg>
    </svg>
  );
}

/** (G5) 교전 중인 사건 핀: 붉은·흰 두 색이 번갈아 도는 점선 테 */
function CombatPinSample({ size = 26 }: { size?: number }) {
  const c = size / 2, r = size * 0.27, R = r + 4.2, col = '#e0486b';
  return (
    <svg className="pin-sample" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="#0d151d" stroke={col} strokeWidth={1.6} />
      <svg x={c - r * 0.62} y={c - r * 0.62} width={r * 1.24} height={r * 1.24} viewBox="0 0 24 24"><path d={ICON_PATH.armed} fill={col} fillRule="evenodd" /></svg>
      <circle cx={c} cy={c} r={R} fill="none" stroke="#ff4d4d" strokeWidth={1.6} strokeDasharray="3 3" />
      <circle cx={c} cy={c} r={R} fill="none" stroke="#ffffff" strokeWidth={1.6} strokeDasharray="3 3" strokeDashoffset={3} />
    </svg>
  );
}

/** (G4) 무너진 건물: 핀의 왼쪽 아래 배지 (확인 = 실선 테, 신고만 = 점선 테와 흐린 기호) · 끝난 사건의 테 두른 실루엣 · 2차 붕괴의 퍼지는 흙빛 고리 */
const RUIN_EDGE = '#d6a878';
function RuinBadgeSample({ level, reported = false, size = 20 }: { level: 'partial' | 'major' | 'total' | 'burnt'; reported?: boolean; size?: number }) {      // (X6) 전체 붕괴 · 전소
  const c = size / 2, r = size / 2 - 1.5, g = r * 1.5;
  return (
    <svg className="token" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="#0b1219" stroke={RUIN_EDGE} strokeWidth={1.5} strokeDasharray={reported ? '2.4 1.8' : undefined} />
      <svg x={c - g / 2} y={c - g / 2} width={g} height={g} viewBox="0 0 24 24" opacity={reported ? 0.6 : 1}><path d={RUIN_MARK[reported ? 'partial' : level]} fill={RUIN_EDGE} fillRule="evenodd" /></svg>
    </svg>
  );
}
function RuinGlyphSample({ size = 18 }: { size?: number }) {
  return <svg className="token" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={RUIN_MARK.major} fill={RUIN_EDGE} fillRule="evenodd" stroke="#0b1219" strokeWidth={3} strokeLinejoin="round" paintOrder="stroke" /></svg>;
}
function SecondaryRingSample({ size = 22 }: { size?: number }) {
  const c = size / 2;
  return (
    <svg className="pin-sample" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={size * 0.22} fill="#0d151d" stroke={RUIN_EDGE} strokeWidth={1.5} />
      <circle cx={c} cy={c} r={size * 0.36} fill="none" stroke={RUIN_EDGE} strokeWidth={1.6} opacity={0.75} />
      <circle cx={c} cy={c} r={size * 0.47} fill="none" stroke={RUIN_EDGE} strokeWidth={1.2} opacity={0.35} />
    </svg>
  );
}
/** (G4) 붕괴 사건의 변형 아이콘 (핀과 사건 카드) */
const COLLAPSE_ICONS: [string, string][] = [['collapse', '건물 붕괴'], ['gasblast', '가스 폭발'], ['crane', '크레인 붕괴'], ['elevator', '승강기 갇힘'], ['landslide', '산사태']];
/** (N9) 지하철역 출입구: 지도의 기호(view/city/kinds2Layer.ts 의 SUBWAY_GLYPH)와 같은 모양 */
function SubwaySample({ size = 18 }: { size?: number }) {
  const g = SUBWAY_GLYPH, pts = (p: [number, number][]): string => p.map(([x, y]) => `${x},${y}`).join(' ');
  return (
    <svg className="token" width={size} height={size} viewBox="-8 -8 16 16" aria-hidden="true">
      <circle r={g.r + 1.1} fill="#f4f6f8" /><circle r={g.r} fill={SUBWAY_LINE} />
      <polygon points={pts(g.stairs)} fill="#fff" />
      {g.arrow.map((pl, k) => <polyline key={k} points={pts(pl)} fill="none" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
}
/** (I1-b b4) 이웃의 충격으로 금 간 건물(지붕을 가로지르는 꺾인 선) · 끊긴 가스 배관(모서리의 작은 구름) */
function CrackSample({ size = 18 }: { size?: number }) {
  return (
    <svg className="token" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x={3} y={4} width={18} height={16} rx={2} fill="#2a3440" stroke="#4a5866" strokeWidth={1} />
      <polyline points="4,15 9,11 12,13 16,8 20,9" fill="none" stroke={EXPO_CRACK} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function PipeSample({ size = 18 }: { size?: number }) {
  return <svg className="token" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={HAZARD_MARK.gas} fill={EXPO_PIPE} stroke="#0b1219" strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke" /></svg>;
}
/** (I1-b b4) 정전·연기 자리의 옅은 테 (지도는 국지 값이면 그 원, 동네 전체면 그 동네의 원) */
function ZoneSample({ f, size = 20 }: { f: 'power' | 'smoke'; size?: number }) {
  const L = ZONE_LOOK[f], c = size / 2;
  return (
    <svg className="token" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={c - 1.5} fill={L.fill} stroke={L.ring} strokeWidth={1.4} strokeDasharray={`${L.dash[0] * 0.45} ${L.dash[1] * 0.45}`} />
    </svg>
  );
}
/** (I2 §5.4) 지난 교대의 흔적: 그을린 지붕 · 탄 자리(열린 터) · 복구 공사 중인 건물(노란 점선 울타리 + 공사 고깔) · 무너진 건물(울타리 + 무너짐 기호) */
function CarrySample({ kind, size = 20 }: { kind: 'soot' | 'patch' | 'closed' | 'ruin'; size?: number }) {
  const roof = kind === 'patch' ? '#3d5a3a' : '#2a3440';
  return (
    <svg className="token" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x={3.5} y={4.5} width={17} height={15} rx={1.5} fill={roof} stroke="#4a5866" strokeWidth={0.8} />
      {kind === 'soot' && <path d="M7 9.5Q10 6.5 14.5 8.4Q18.4 10.2 16.6 14.2Q14.6 17.6 10 16.4Q6 15.2 7 9.5Z" fill="#0e0a08" opacity={0.75} />}
      {kind === 'patch' && <path d="M6.5 11Q8.5 7.6 12 9.2Q15.6 8 17 11.4Q18 15.4 13.6 15.8Q11 17.6 8.6 15.8Q5.4 14.4 6.5 11Z" fill="#1e1610" opacity={0.8} />}
      {(kind === 'closed' || kind === 'ruin') && <rect x={2} y={3} width={20} height={18} rx={1.5} fill="none" stroke={FENCE} strokeWidth={1.4} strokeDasharray="3 2.2" />}
      {kind === 'closed' && <svg x={6.5} y={6.5} width={11} height={11} viewBox="0 0 24 24"><path d={REPAIR_MARK} fill={FENCE} fillRule="evenodd" stroke="#0b1219" strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke" /></svg>}
      {kind === 'ruin' && <svg x={5.5} y={5.5} width={13} height={13} viewBox="0 0 24 24"><path d={RUIN_MARK.major} fill={RUIN_EDGE} fillRule="evenodd" stroke="#0b1219" strokeWidth={2.5} strokeLinejoin="round" paintOrder="stroke" /></svg>}
    </svg>
  );
}
/** (I2) 복구 공사 도로: 공사 표식에 주황 테 (trafficLayer 의 REPAIR_RING) */
function RepairRoadSample({ size = 20 }: { size?: number }) {
  const c = size / 2, r = size / 2 - 1.5, g = r * 1.36;
  return (
    <svg className="token" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={c} cy={c} r={r} fill="#161d24" stroke={REPAIR_RING} strokeWidth={1.6} />
      <svg x={c - g / 2} y={c - g / 2} width={g} height={g} viewBox="0 0 24 24"><path d={OBSTACLE_ICON.roadwork} fill="#f2c94c" fillRule="evenodd" /></svg>
    </svg>
  );
}
function IconSample({ name, size = 18 }: { name: string; size?: number }) {
  return <svg className="token" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={ICON_PATH[name]} fill={RUIN_EDGE} fillRule="evenodd" /></svg>;
}

export function MapLegend() {
  const [open, setOpen] = useState<boolean>(() => { try { return localStorage.getItem(LS_LEGEND) === '1'; } catch { return false; } });
  const toggle = (): void => { const v = !open; setOpen(v); try { localStorage.setItem(LS_LEGEND, v ? '1' : '0'); } catch { /* 저장 실패는 무시 */ } };
  return (
    <div className="maplegend-wrap">
      <button className={`legend-btn ${open ? 'on' : ''}`} onClick={toggle} aria-expanded={open} title="지도 표식의 뜻 (표시 방식일 뿐, 시뮬레이션에는 영향이 없습니다)">범례</button>
      {open && (
        <div className="maplegend" role="region" aria-label="지도 범례">
          <h5>모양</h5>
          <div className="lg-row">
            <span className="lg-item"><Token field="police" kind="patrol" size={18} />원 = 부대</span>
            <span className="lg-item"><FacilityBadge mark="police" color={FACILITY_COLOR.police} size={18} />네모 = 시설</span>
            <span className="lg-item"><PinSample />핀 = 사건</span>
          </div>
          <h5>부대 <span className="dim">바탕색 = 분야 · 기호 = 종류</span></h5>
          {FIELDS.map(([f, kinds]) => (
            <div key={f} className="lg-field">
              <span className="lg-fname" style={{ color: FIELD_TEXT[f] }}><i className="sw" style={{ background: FIELD_COLOR[f] }} />{FIELD_NAME[f]}</span>
              <div className="lg-kinds">{kinds.map((k) => <span key={k} className="lg-item"><Token field={f} kind={k} size={18} />{UNIT_KIND_NAME[k]}</span>)}</div>
            </div>
          ))}
          <h5>상태 <span className="dim">돌을 두른 테</span></h5>
          <div className="lg-row">
            {STATES.map(([st, name, how]) => <span key={st} className="lg-item" title={how}><Token field="rescue" kind="bls" size={18} state={st} />{name}</span>)}
          </div>
          <div className="lg-row">
            <span className="lg-item"><Token field="police" kind="patrol" size={18} no={2} />아래의 점 = 같은 종류 안의 번호 (순찰2)</span>
          </div>
          <h5>대원 역할 <span className="dim">부대 목록의 점 · 아래 반 테 = 건강</span></h5>
          <div className="lg-row lg-roles">
            {ROLES.map(([g, name, f]) => <span key={g} className="lg-item"><RoleDot group={g} field={f} stays={g === 'pilot' || g === 'observer'} />{name}</span>)}
          </div>
          <div className="lg-row">
            <span className="lg-item"><RoleDot group="nozzle" field="fire" health={100} />온전</span>
            <span className="lg-item"><RoleDot group="nozzle" field="fire" health={55} />다침</span>
            <span className="lg-item"><RoleDot group="nozzle" field="fire" health={20} />중상</span>
            <span className="lg-item"><RoleDot group="nozzle" field="fire" down />쓰러짐</span>
            <span className="lg-item" title="조종사·정장·관측관: 현장에 내리지 않는다"><RoleDot group="pilot" field="special" stays />점선 = 내리지 않는 자리</span>
          </div>
          <div className="lg-row">
            <span className="lg-item" title="지난 교대에 다쳐 이번 교대에 나오지 않는 대원(또는 순직한 대원의 빈 자리) — 지난 교대에서 이어받은 조직 상태"><RoleDot group="nozzle" field="fire" off />흐린 점 + 사선 = 결장</span>
            <span className="lg-item" title="결장으로 빈 자리에 이번 교대만 대신 탄 본부 예비 인력"><RoleDot group="nozzle" field="fire" health={100} relief />흰 점 = 예비 인력</span>
          </div>
          <h5>시설 <span className="dim">이름 옆의 숫자 = 대기 중인 부대 수</span></h5>
          <div className="lg-row">
            {FACILITIES.map(([k, name]) => <span key={k} className="lg-item"><FacilityBadge mark={k} color={FACILITY_COLOR[k]} size={18} />{name}</span>)}
          </div>
          <h5>사건과 도로</h5>
          <div className="lg-row lg-types" title="핀의 기호와 테의 색 = 사건 유형 (같은 유형 안의 시나리오는 기록과 현장 그림으로 구별한다)">
            {TYPE_ORDER.map((t) => <span key={t} className="lg-item"><TypePinSample type={t} />{TYPE_DEFS[t].name}</span>)}
          </div>
          <div className="lg-row">
            <span className="lg-item"><PinSample />고리 = 첫 도착까지 흐른 시간</span>
            <span className="lg-item" title="최근 몇 초 안에 총성이 난 현장"><CombatPinSample />교전 중</span>
            <span className="lg-item"><svg className="token" width={22} height={22} viewBox="0 0 22 22" aria-hidden="true"><circle cx={11} cy={11} r={9} fill="#c9362f" stroke="rgba(255,220,220,0.9)" strokeWidth={1.2} /><svg x={5} y={5} width={12} height={12} viewBox="0 0 24 24"><path d={STATE_MARK.fugitive} fill="#fff" fillRule="evenodd" /></svg></svg>달아나는 차량</span>
          </div>
          <div className="lg-row">
            {COLLAPSE_ICONS.map(([k, name]) => <span key={k} className="lg-item"><IconSample name={k} />{name}</span>)}
          </div>
          <div className="lg-row">
            {ROADS.map(([name, col, dash]) => <span key={name} className="lg-item"><i className={`road ${dash ? 'dash' : ''}`} style={{ ['--rc' as string]: col }} />{name}</span>)}
          </div>
          <div className="lg-row">
            {OBSTACLES.map(([k, name]) => <span key={k} className="lg-item"><ObstacleSample kind={k} />{name}</span>)}
            <span className="lg-item" title="관찰자 시점에서만 보입니다. 부대가 가서 보거나 시민이 제보하면 실선이 됩니다"><ObstacleSample kind="debris" unknown />점선 = 관제가 아직 모름</span>
          </div>
          <div className="lg-row">
            <span className="lg-item" title="사건 현장 때문에 막은 구간: 테의 색 = 그 사건의 유형색"><ClosureSample ring="#d6a878" />통제 — 사건 (유형색 테)</span>
            <span className="lg-item" title="재난이 막은 구간"><ClosureSample ring={DISASTER_RING} />통제 — 재난 (주황 테)</span>
          </div>
          <div className="lg-row">
            <span className="lg-item" title="지하철역 출입구 (시청역·중앙역·남문역)"><SubwaySample />지하철역</span>
            <span className="lg-item" title="세 역을 잇는 땅 밑 노선 — 그림일 뿐 열차 시각표는 없다"><i className="road dash" style={{ ['--rc' as string]: SUBWAY_LINE }} />땅 밑 노선</span>
          </div>
          <h5>건물 상태 <span className="dim">사건 핀의 왼쪽 아래</span></h5>
          <div className="lg-row">
            <span className="lg-item" title="부대가 도착해 확인했다 (관찰자 시점은 처음부터)"><RuinBadgeSample level="partial" />일부 무너짐</span>
            <span className="lg-item" title="무너진 칸이 건물의 22% 이상이거나 2차 붕괴가 있었다"><RuinBadgeSample level="major" />크게 무너짐</span>
            <span className="lg-item" title="붕괴 신고가 들어왔지만 아직 확인하지 않았다 (AI 시점)"><RuinBadgeSample level="partial" reported />붕괴 신고 (확인 전)</span>
          </div>
          <div className="lg-row">
            <span className="lg-item" title="금이 간 구조물이 다시 무너졌다"><SecondaryRingSample />2차 붕괴 (퍼지는 흙빛 고리)</span>
            <span className="lg-item" title="사건이 끝나도 교대 끝까지 남는다. 크게 보면 지붕이 내려앉은 모습"><RuinGlyphSample />끝난 붕괴</span>
            <span className="lg-item" title="끝난 화재 사건의 건물: 크게 보면 탄 만큼 지붕이 그을려 있다"><i style={{ display: 'inline-block', width: 14, height: 10, borderRadius: 2, background: '#2a211b', border: '1px solid #4a3d33' }} />끝난 화재 (그을린 지붕)</span>
          </div>
          <div className="lg-row">
            <span className="lg-item" title="건물이 통째로 무너졌다: 크게 보면 지붕 대신 잔해 더미. 그 교대에는 그 건물에서 새 사건이 나지 않는다"><RuinBadgeSample level="total" />전체 붕괴</span>
            <span className="lg-item" title="건물 칸의 연료가 70% 넘게 탔다: 크게 보면 지붕 전체가 그을리고 구멍이 뚫려 있다. 그 교대에는 그 건물에서 새 사건이 나지 않는다"><RuinBadgeSample level="burnt" />전소</span>
            <span className="lg-item" title="가스·용기 폭발이 있었다: 크게 보면 건물 둘레에 깨진 유리가 반짝이고 지붕에 검은 자국"><i style={{ display: 'inline-block', width: 14, height: 10, borderRadius: 2, background: '#2a211b', boxShadow: '0 0 0 2px #9fd6ea' }} />폭발 흔적</span>
          </div>
          <h5>지난 교대의 흔적 <span className="dim">이어받은 조직 상태 — 두 시점에 같다</span></h5>
          <div className="lg-row">
            <span className="lg-item" title="지난 교대의 화재로 그을린 건물: 크게 보면 지붕에 검은 얼룩 (구조 손상이 크면 금). 사건은 나지만 그을린 만큼 처음부터 탄 칸이 있다"><CarrySample kind="soot" />그을린 건물</span>
            <span className="lg-item" title="숲·공원·주차장 같은 열린 터에 남은 탄 자리 — 출입을 막지는 않는다"><CarrySample kind="patch" />탄 자리 (숲·공원)</span>
            <span className="lg-item" title="지난 교대의 화재·폭발·구획 붕괴로 복구 공사 중 — 출입 통제(그 건물에서는 사건이 나지 않는다, 그 종류의 건물이 모두 막혔을 때만 예외). 건물 앞 길은 공사 차량으로 느리다"><CarrySample kind="closed" />복구 공사 중인 건물</span>
          </div>
          <div className="lg-row">
            <span className="lg-item" title="지난 교대에 무너진 건물 — 복구 전까지 출입할 수 없고 사건도 나지 않는다"><CarrySample kind="ruin" />무너진 건물</span>
            <span className="lg-item" title="지난 교대의 지진 균열·잔해·산사태 등으로 복구 공사 중인 구간 — 관제가 아는 통제라 경로가 처음부터 피한다. 한 차로 공사는 혼잡 띠로 보인다"><RepairRoadSample />복구 공사 도로 (주황 테)</span>
          </div>
          <h5>이웃 건물과 동네 <span className="dim">사건이 남긴 세계 상태</span></h5>
          <div className="lg-row">
            <span className="lg-item" title="옆 건물이 무너지거나 터질 때의 충격으로 금이 갔다 — 관찰자 시점에서만 보인다(관제·현장은 그 건물에서 사건이 나기 전에는 모른다). 금이 클수록 선이 진하고 많다"><CrackSample />금 간 건물 (관찰자 시점)</span>
            <span className="lg-item" title="충격으로 그 건물의 가스 배관이 끊겼다 — 관찰자 시점에서만 보인다"><PipeSample />끊긴 배관</span>
          </div>
          <div className="lg-row">
            <span className="lg-item" title="정전이 걸린 자리: 무너지거나 터진 건물의 끊긴 전선이면 그 원, 변전소·지진이면 그 동네. AI 시점은 관제가 알게 된 정전만"><ZoneSample f="power" />정전 자리 (파란 점선)</span>
            <span className="lg-item" title="크게 이어지는 불의 연기가 덮은 자리 — 그 안의 길은 앞이 덜 보여 느려지고, 오래 마신 주민이 숨쉬기 힘들어한다"><ZoneSample f="smoke" />연기 자리 (흙빛 안개)</span>
          </div>
          <p className="lg-help">사건 표식을 누르면 현장을 확대합니다. 건물이나 도로에 마우스를 올리면 이름과 종류가 보입니다. 휠로 확대·축소하고 끌어서 옮깁니다.</p>
        </div>
      )}
    </div>
  );
}
