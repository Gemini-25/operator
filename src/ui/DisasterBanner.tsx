// 재난 특보 띠 (docs/specs/N6-disaster.md). 재난이 없으면 아무것도 그리지 않는다.
import type { Runner } from '../view/runner';

export function DisasterBanner({ runner }: { runner: Runner }) {
  const d = runner.sim.disaster;
  if (!d || d.phase === 'calm' || d.phase === 'over') return null;
  return <div className={`disaster-banner ph-${d.phase}`}><b>{d.name}</b></div>;
}
