// 그림 기호의 React 쪽: 기호 하나(<Mark>), 지도와 같은 모양의 둥근 부대 표식(<Token>), 시설 배지(<FacilityBadge>).
// 경로 문자열은 `view/marks.ts` 것을 그대로 쓴다(캔버스와 같은 그림).

import type { UnitField, UnitKind } from '../sim/types';
import { FIELD_COLOR, MARK_RATIO, STATE_RING } from '../view/city/tokens';
import { FACILITY_MARK, STATE_MARK, UNIT_MARK } from '../view/marks';
import { mix } from '../view/scene/common';

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
