// 사건 카드의 현장 위험 칩 (docs/specs/G4-scene-legibility.md §6): 붕괴·2차 붕괴·균열·가스·불·폭발물·인질.
// 계산은 view/hazardState.ts 의 hazardChips(시점 규칙 포함). 여기서는 그림 기호와 짧은 말로 그리기만 한다.

import { memo } from 'react';
import type { Sim } from '../sim/engine';
import type { Incident } from '../sim/types';
import { hazardChips } from '../view/hazardState';
import type { HazardChip } from '../view/hazardState';
import { Mark } from './Mark';

export function HazardStrip({ sim, I, truth }: { sim: Sim; I: Incident; truth: boolean }) {
  const chips = hazardChips(sim, I, truth);
  if (!chips.length) return null;
  return <Chips sig={chips.map((c) => c.key + c.text + c.tone).join('|')} chips={chips} />;
}
/** 칩의 내용(sig)이 같으면 다시 그리지 않는다 (카드는 0.16초마다 다시 그려진다) */
const Chips = memo(function Chips({ chips }: { sig: string; chips: HazardChip[] }) {
  return (
    <div className="hz-strip">
      {chips.map((c) => <span key={c.key} className={`hz tone-${c.tone}`} style={{ color: c.color, borderColor: c.color }} title={c.text}><Mark d={c.mark} size={11} color={c.color} />{c.text}</span>)}
    </div>
  );
}, (a, b) => a.sig === b.sig);
