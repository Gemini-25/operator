// 그림 기호의 React 쪽: 기호 하나(<Mark>), 지도와 같은 모양의 둥근 부대 표식(<Token>), 시설 배지(<FacilityBadge>).
// 경로 문자열은 `view/marks.ts` 것을 그대로 쓴다(캔버스와 같은 그림).

import type { RoleGroup, UnitField, UnitKind } from '../sim/types';
import { FIELD_COLOR, FIELD_TEXT, MARK_RATIO, STATE_RING } from '../view/city/tokens';
import { FACILITY_MARK, ROLE_MARK, STATE_MARK, UNIT_MARK } from '../view/marks';
import { mix, shade } from '../view/scene/common';

export function Mark({ d, size = 14, color = 'currentColor', title }: { d: string; size?: number; color?: string; title?: string }) {
  return <svg className="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>{title && <title>{title}</title>}<path d={d} fill={color} fillRule="evenodd" /></svg>;
}

/**
 * 부대 한 팀의 둥근 표식 — 지도의 돌과 같은 규칙: 바탕색 = 분야, 흰 기호 = 종류, 테 = 상태, 아래의 점 = 같은 종류 안의 번호.
 * size 는 돌의 지름. 테가 그려질 자리를 포함한 전체 크기는 size + 6 이다.
 */
export function Token({ field, kind, size = 22, state = 'available', no = 0, title }: { field: UnitField; kind: UnitKind; size?: number; state?: string; no?: number; title?: string }) {
  const pad = 3, box = size + pad * 2, c = box / 2, r = size / 2;
  const col = FIELD_COLOR[field];
  // 테: 출동(준비) = 분야색을 밝힌 점선, 현장 = 노란 실선, 이송 = 초록 실선 + 십자 (지도의 drawToken 과 같다)
  const ring = state === 'onscene' ? STATE_RING.onscene : state === 'transport' || state === 'hospital' ? STATE_RING.transport : state === 'enroute' || state === 'turnout' ? mix(col, '#ffffff', 0.5) : null;
  const dim = state === 'oos' ? 0.4 : state === 'returning' ? 0.6 : 1;
  const ms = size * MARK_RATIO, n = Math.max(0, Math.min(5, no));
  return (
    <svg className={`token st-${state}`} width={box} height={box} viewBox={`0 0 ${box} ${box}`} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <g opacity={dim}>
        <circle cx={c} cy={c} r={r} fill={col} />
        <circle cx={c - r * 0.28} cy={c - r * 0.34} r={r * 0.62} fill="#ffffff" opacity={0.16} />
        <circle cx={c} cy={c} r={r - 0.6} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={1.2} />
        <svg x={c - ms / 2} y={c - ms / 2 - (n ? r * 0.07 : 0)} width={ms} height={ms} viewBox="0 0 24 24"><path d={UNIT_MARK[kind]} fill="#ffffff" fillRule="evenodd" /></svg>
        {Array.from({ length: n }, (_, k) => { const a = Math.PI / 2 + (k - (n - 1) / 2) * 0.4; return <circle key={k} cx={c + Math.cos(a) * r * 0.76} cy={c + Math.sin(a) * r * 0.76} r={Math.max(0.9, r * 0.1)} fill="#ffffff" />; })}
      </g>
      {ring && <circle className="token-ring" cx={c} cy={c} r={r + 1.9} fill="none" stroke={ring} strokeWidth={1.6} strokeDasharray={state === 'enroute' || state === 'turnout' ? '3.2 2.6' : undefined} />}
      {(state === 'transport' || state === 'hospital') && (<>
        <circle cx={pad + 2.2} cy={pad + 2.2} r={4.6} fill="#0b1219" />
        <svg x={pad + 2.2 - 3.1} y={pad + 2.2 - 3.1} width={6.2} height={6.2} viewBox="0 0 24 24"><path d={STATE_MARK.transport} fill={STATE_RING.transport} /></svg>
      </>)}
    </svg>
  );
}

/**
 * (R1) 대원 한 사람의 역할 점 — 부대 목록과 범례가 함께 쓴다. 글자는 쓰지 않는다:
 * 분야색을 어둡게 한 바탕 위의 흰 역할 기호(ROLE_MARK), 아래쪽 반 테 = 건강(초록·노랑·빨강), 쓰러졌으면 빨간 온 테.
 * 현장에 내리지 않는 자리(조종사·정장·관측관)는 속이 빈 점선 테. 크기는 CSS 가 정한다(.rdot — 좁으면 10 화소로 준다).
 */
export function RoleDot({ group, field, health, down = false, stays = false, selected = false, title, onClick }: { group: RoleGroup; field: UnitField; health?: number; down?: boolean; stays?: boolean; selected?: boolean; title?: string; onClick?: () => void }) {
  const base = shade(FIELD_COLOR[field], -0.42), line = FIELD_TEXT[field];
  const hp = health === undefined ? null : health < 40 ? '#ff5d5d' : health < 70 ? '#ffd166' : '#5ad17a';
  return (
    <svg className={`rdot ${selected ? 'sel' : ''} ${stays ? 'stays' : ''} ${down ? 'down' : ''}`} viewBox="0 0 13 13" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} onClick={onClick}>
      {title && <title>{title}</title>}
      {stays
        ? <circle cx={6.5} cy={6.5} r={5.6} fill="rgba(10,16,22,0.6)" stroke={line} strokeWidth={1} strokeDasharray="1.7 1.5" />
        : <circle cx={6.5} cy={6.5} r={6.1} fill={base} />}
      <svg x={2.4} y={2.4} width={8.2} height={8.2} viewBox="0 0 24 24"><path d={ROLE_MARK[group]} fill={stays ? line : '#ffffff'} fillRule="evenodd" /></svg>
      {!stays && hp && !down && <path d="M0.9 6.9A5.6 5.6 0 0 0 12.1 6.9" fill="none" stroke={hp} strokeWidth={1.5} strokeLinecap="round" />}
      {down && <circle cx={6.5} cy={6.5} r={5.7} fill="none" stroke="#ff5d5d" strokeWidth={1.6} />}
      {selected && <circle cx={6.5} cy={6.5} r={6.1} fill="none" stroke="#ffffff" strokeWidth={1.1} />}
    </svg>
  );
}

/** 시설 배지: 둥근 모서리의 네모 안에 시설 기호 */
export function FacilityBadge({ mark, color, size = 20 }: { mark: string; color: string; size?: number }) {
  const ms = size * 0.64;
  return (
    <svg className="fbadge" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <rect x={0.75} y={0.75} width={size - 1.5} height={size - 1.5} rx={size * 0.26} fill="#0d151d" stroke={color} strokeWidth={1.5} />
      <svg x={(size - ms) / 2} y={(size - ms) / 2} width={ms} height={ms} viewBox="0 0 24 24"><path d={FACILITY_MARK[mark] ?? FACILITY_MARK.public} fill={color} fillRule="evenodd" /></svg>
    </svg>
  );
}
