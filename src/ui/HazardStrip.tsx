// 사건 카드의 현장 위험 칩 (docs/specs/G4-scene-legibility.md §6): 붕괴·2차 붕괴·균열·가스·불·폭발물·인질.
// 계산은 view/hazardState.ts 의 hazardChips(시점 규칙 포함). 여기서는 그림 기호와 짧은 말로 그리기만 한다.
// (I1-b b4) 맨 앞에 내력 칩 하나: 관찰자 시점에서 그 사건이 세계 상태에서 났으면(I.hz) 주된 몫의 갈래를 짧게 — '몰린 길'·'옮겨붙음'·'금 간 건물'·'끊긴 배관'·'정전'·'연기' (설계서 I1 §7).
//   관제도 지휘관도 모르는 기록 전용 칸이라 AI 시점에는 없다. 읽기만 한다.

import { memo } from 'react';
import type { Sim } from '../sim/engine';
import type { Incident } from '../sim/types';
import { HZ_SHORT } from '../sim/world/report';
import { hazardChips } from '../view/hazardState';
import type { HazardChip } from '../view/hazardState';
import { Mark } from './Mark';

/** 내력 칩의 기호: 휘어 이어지는 화살표 (다른 사건·상태에서 이어졌다) */
export const CAUSE_MARK = 'M4 3.5H7.5V12.5A2.5 2.5 0 0 0 10 15H15.5V11L21.5 16.75L15.5 22.5V18.5H10A6 6 0 0 1 4 12.5Z';
export const CAUSE_COLOR = '#9cc3e6';
/** 관찰자 시점의 내력 칩 (없으면 null) */
export function causeChip(I: Incident, truth: boolean): HazardChip | null {
  if (!truth || !I.hz || !I.hz.src.length) return null;
  return { key: 'cause', mark: CAUSE_MARK, text: HZ_SHORT[I.hz.src[0].what], color: CAUSE_COLOR, tone: 'info' };
}

export function HazardStrip({ sim, I, truth }: { sim: Sim; I: Incident; truth: boolean }) {
  const cause = causeChip(I, truth), rest = hazardChips(sim, I, truth);
  const chips = cause ? [cause, ...rest] : rest;
  if (!chips.length) return null;
  return <Chips sig={chips.map((c) => c.key + c.text + c.tone).join('|')} chips={chips} />;
}
/** 칩의 내용(sig)이 같으면 다시 그리지 않는다 (카드는 0.16초마다 다시 그려진다) */
const Chips = memo(function Chips({ chips }: { sig: string; chips: HazardChip[] }) {
  return (
    <div className="hz-strip">
      {chips.map((c) => <span key={c.key} className={`hz tone-${c.tone}`} style={{ color: c.color, borderColor: c.color }} title={c.key === 'cause' ? `세계 상태에서 난 사건 — ${c.text} (관찰자 시점)` : c.text}><Mark d={c.mark} size={11} color={c.color} />{c.text}</span>)}
    </div>
  );
}, (a, b) => a.sig === b.sig);
