import type { Sim } from '../sim/engine';
import type { Casualty, Hostile } from '../sim/types';
import { TRIAGE, TRIAGE_EDGE, TRIAGE_NAME, TRIAGE_TEXT, casDrawn, casInfo, hostileDrawn, hostileInfo } from '../view/triage';

/** 현장 화면에서 고른 구조 대상·용의자 (관찰 대상 선택일 뿐이다 — AI 에게는 아무 영향이 없다) */
export interface PersonSel { kind: 'cas' | 'hostile'; inc: number; id: number }

/**
 * 구조 대상·용의자 정보창 (H1 §8.4). 오른쪽 칸의 '대원 정보' 자리에 뜬다.
 * 관찰자 시점에서는 진실(체력, 원인별 부상, 처치, 경과)을, AI 시점에서는 지휘관이 아는 것('cas'·'hos' 사실)만 보인다.
 * 무엇을 보일지는 view/triage.ts 의 casInfo·hostileInfo 가 정한다(시험이 그 함수를 직접 부른다) — 여기는 그대로 늘어놓기만 한다.
 */
export function PersonCard({ sim, sel, truth, onClose }: { sim: Sim; sel: PersonSel; truth: boolean; onClose: () => void }) {
  const s = sim.scenes[sel.inc] ?? null, I = sim.incidents[sel.inc];
  const who: Casualty | Hostile | undefined = s ? (sel.kind === 'cas' ? s.casualties[sel.id] : s.hostiles[sel.id]) : undefined;
  const head = <h3>{sel.kind === 'cas' ? '구조 대상 정보' : '용의자 정보'}<span className="toggles"><button onClick={onClose}>닫기</button></span></h3>;
  if (!s || !I || !who) return <div className="panel-section grow">{head}<div className="empty">이 시각의 현장에는 그 사람이 없습니다.</div></div>;
  // AI 시점에서 아직 보이지 않는 사람(미발견·숨은 용의자)은 내용을 보이지 않는다
  const unseen = !truth && (sel.kind === 'cas' ? (who as Casualty).tDiscovered < 0 : (who as Hostile).hidden);
  if (unseen) return <div className="panel-section grow">{head}<div className="empty">AI 가 아직 모르는 사람입니다. 관찰자 시점(T)에서만 보입니다.</div></div>;
  const cmd = s.agents.find((a) => a.isCommander);
  const info = sel.kind === 'cas' ? casInfo(sim, s, who as Casualty, truth, cmd) : hostileInfo(sim, s, who as Hostile, truth, cmd);
  const gone = sel.kind === 'cas' ? !casDrawn(who as Casualty) : !hostileDrawn(who as Hostile);
  return (
    <div className="panel-section grow">
      {head}
      <div className="scroll decision">
        <div className="agent-head person-head">
          {info.band !== null
            ? <span className="tri-badge" style={{ background: TRIAGE[info.band], color: TRIAGE_TEXT[info.band], borderColor: TRIAGE_EDGE[info.band] }}>{TRIAGE_NAME[info.band]}</span>
            : <span className="tri-badge none">—</span>}
          <div><div className="nm">{info.title}</div><div className="dim small">사건 {I.code}{info.sub ? ` · ${info.sub}` : ''} · {truth ? '관찰자 시점' : 'AI 시점'}{gone ? ' · 현장에 없음' : ''}</div></div>
        </div>
        {info.health !== null && info.band !== null && (
          <div className="prob"><span>체력</span><span className="bar" style={{ width: 110 }}><span style={{ width: `${Math.max(0, Math.min(100, info.health))}%`, background: TRIAGE[Math.min(2, info.band)] }} /></span><span className="num">{Math.round(info.health)}</span></div>
        )}
        {info.rows.map((r) => <div key={r.k} className="kv"><span className="dim">{r.k}</span><span>{r.v}</span></div>)}
        {info.times.length > 0 && (<>
          <h4>경과</h4>
          {info.times.map((r) => <div key={r.k} className="kv"><span className="dim">{r.k}</span><span className="num" style={{ textAlign: 'left' }}>{r.v}</span></div>)}
        </>)}
        {info.note && <div className="empty">{info.note}</div>}
      </div>
    </div>
  );
}
