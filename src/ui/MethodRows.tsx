// 대원 정보창의 대응 방법 두 줄 (docs/specs/R2-methods.md §3.7): 지금 쓰는 방법과 고를 때의 후보 점수.
// 읽기만 한다 — 판단부의 표(METHOD)와 임무에 적힌 칸(method·mwhy·missing·mcands)만 본다. 방법이 없으면 아무것도 그리지 않는다(자리를 차지하지 않는다).
import { METHOD, whyNote } from '../sim/field/methods';
import type { FieldAgent } from '../sim/types';

/** 지금 하는 일의 방법: 문·잔해 하위 작업 중이면 그 하위 작업의 것을 먼저 본다 */
function methodTask(a: FieldAgent) {
  const t = a.task;
  if (!t) return null;
  if (t.sub && (t.sub.method !== undefined || t.sub.mcands !== undefined)) return t.sub;
  return t.method !== undefined || t.mcands !== undefined ? t : null;
}

export function MethodRows({ agent }: { agent: FieldAgent }) {
  const t = methodTask(agent);
  if (!t) return null;
  const m = t.method, note = whyNote(t.mwhy, t.missing);
  const cands = t.mcands ?? [];
  const top = cands.length ? Math.max(1, cands[0].score) : 1;
  return (
    <>
      <h4>대응 방법</h4>
      <div className="kv method-now"><span className="dim">방법</span><span>{m !== undefined ? `${METHOD[m].name}${note ? ` — ${note}` : ''}` : '정해진 방법 없이 진행'}</span></div>
      {cands.length > 0 && (<>
        <div className="dim small method-cands">방법 후보</div>
        {cands.map((c) => (
          <div key={c.m} className={`cand ${c.m === m ? 'chosen' : ''}`}>
            <span className="bar" style={{ width: 60 }}><span style={{ width: `${Math.max(0, Math.min(100, (c.score / top) * 100))}%`, background: c.m === m ? '#d6e2ee' : '#52606d' }} /></span>
            <span className="num">{c.score.toFixed(2)}</span><span>{METHOD[c.m].name}</span>
          </div>
        ))}
      </>)}
    </>
  );
}
