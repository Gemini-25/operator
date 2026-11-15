// 지도 범례: 지도 왼쪽 아래의 접히는 상자 (기본은 접힘 — `범례` 단추).
// 표시 방식의 하나일 뿐이다. 시뮬레이션에는 아무 영향이 없고, AI 에게 무엇도 시키지 않는다.

import { useState } from 'react';
import { FIELD_NAME, UNIT_KIND_NAME } from '../sim/resources';
import type { RoleGroup, UnitField, UnitKind } from '../sim/types';
import { FACILITY_COLOR, FIELD_COLOR, FIELD_TEXT } from '../view/city/tokens';
import { DISASTER_RING, OBSTACLE_ICON } from '../view/city/trafficLayer';
import { ICON_PATH } from '../view/icons';
import { RUIN_MARK, STATE_MARK } from '../view/marks';
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
const OBSTACLES: [keyof typeof OBSTACLE_ICON, string][] = [['roadwork', '공사'], ['breakdown', '고장 차량'], ['debris', '낙하물'], ['parked', '불법 주차']];
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
function RuinBadgeSample({ level, reported = false, size = 20 }: { level: 'partial' | 'major'; reported?: boolean; size?: number }) {
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
          <h5>시설 <span className="dim">이름 옆의 숫자 = 대기 중인 부대 수</span></h5>
          <div className="lg-row">
            {FACILITIES.map(([k, name]) => <span key={k} className="lg-item"><FacilityBadge mark={k} color={FACILITY_COLOR[k]} size={18} />{name}</span>)}
          </div>
          <h5>사건과 도로</h5>
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
          <p className="lg-help">사건 표식을 누르면 현장을 확대합니다. 건물이나 도로에 마우스를 올리면 이름과 종류가 보입니다. 휠로 확대·축소하고 끌어서 옮깁니다.</p>
        </div>
      )}
    </div>
  );
}
