// 신고 통화창 (docs/specs/U2-call-panel.md): 오른쪽 칸 맨 위의 고정 칸. 접으면 한 줄 띠가 된다.
// 보여 주기만 한다. 접고 펴는 것은 표시 방식일 뿐, 시뮬레이션과 AI 에게는 아무 영향이 없다.
import { useEffect, useRef } from 'react';
import type { Sim } from '../sim/engine';
import type { Call } from '../sim/types';
import { personaName, topicName } from '../sim/dispatch/callSystem';
import { fmtDur, pct } from '../sim/util';
import { Icon } from './panels';

const LS_CALL = 'ar.call.v1';
const LINGER = 6;      // 끝난 통화를 '통화 종료'로 남겨 두는 시간(시뮬레이션 초). 예전 CallPanel(가운데 통화창)과 같다

export function loadCallOpen(): boolean { try { return localStorage.getItem(LS_CALL) !== '0'; } catch { return true; } }
export function saveCallOpen(open: boolean): void { try { localStorage.setItem(LS_CALL, open ? '1' : '0'); } catch { /* 저장 실패는 무시 */ } }

export type CallMode = 'active' | 'ended' | 'ringing' | 'past' | 'none';
interface Shown { call: Call | null; mode: CallMode; ringing: number }
/** 보여 줄 통화 (3.4): 받는 중 → 끝난 지 6초 안 → 벨만 울림 → 가장 최근에 받은 통화 → 없음. sim 을 읽기만 한다. */
export function shownCall(sim: Sim): Shown {
  let ringing = 0; for (const c of sim.calls) if (c.state === 'ringing') ringing++;
  if (sim.activeCall >= 0) return { call: sim.calls[sim.activeCall], mode: 'active', ringing };
  let last: Call | null = null;      // 가장 최근에 받은 통화 (받은 순서 = 번호 순서). 받기 전에 끝난 전화는 건너뛴다
  for (let i = sim.calls.length - 1; i >= 0; i--) { const c = sim.calls[i]; if (c.state === 'done' && c.answeredAt >= 0) { last = c; break; } }
  if (last && last.endedAt >= 0 && sim.t - last.endedAt < LINGER) return { call: last, mode: 'ended', ringing };
  if (ringing > 0) return { call: null, mode: 'ringing', ringing };      // 벨이 울리면 '지난 통화'보다 앞선다
  return last ? { call: last, mode: 'past', ringing } : { call: null, mode: 'none', ringing };
}

/** 지난 통화의 끝: 'N 전 종료', 통화 도중 사건이 닫혀 끝났으면(endedAt = -1) '통화 중단' */
function pastText(sim: Sim, call: Call): string { return call.endedAt >= 0 ? `${fmtDur(sim.t - call.endedAt)} 전 종료` : '통화 중단'; }

export function CallDock({ sim, truth, open, onToggle }: { sim: Sim; truth: boolean; open: boolean; onToggle: () => void }) {
  const s = shownCall(sim);
  const root = useRef<HTMLElement>(null);
  const refocus = useRef(false);
  const click = () => { refocus.current = true; onToggle(); };
  // 단추로 접고 펴면 누른 단추가 사라지므로 반대쪽 단추로 포커스를 옮긴다 (P 키로 바꿀 때는 옮기지 않는다)
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    root.current?.querySelector<HTMLElement>(open ? '.call-toggle' : '.call-strip')?.focus();
  }, [open]);
  return (
    <section ref={root} className={`call-dock ${open ? 'open' : 'closed'}`} aria-label="신고 통화" data-call={s.call ? s.call.id : -1}>
      {open ? (<>
        <CallBody sim={sim} truth={truth} s={s} />
        {/* .call 밖에 둔다: .call.ended(0.8)·.call.past(0.55)의 흐림이 단추에 걸리지 않게 */}
        <button className="call-toggle" onClick={click} aria-expanded title="통화창 접기 (P)"><i className="chev up" /></button>
      </>) : <CallStrip sim={sim} s={s} onClick={click} />}
    </section>
  );
}

/** 펼친 칸: 예전 CallPanel 의 내용 그대로, 고정 높이에 맞춰 대기 줄을 머리줄의 알약으로 올렸다 */
function CallBody({ sim, truth, s }: { sim: Sim; truth: boolean; s: Shown }) {
  const { call, mode, ringing } = s;
  if (mode === 'ringing') return <div className="call ringing"><div className="call-head"><Icon name="phone" size={15} /><b>신고 전화 대기 {ringing}건</b><span className="live">● 벨 울림</span></div></div>;
  if (!call) return <div className="call none"><div className="empty">아직 걸려 온 신고 전화가 없습니다</div></div>;
  const I = call.incidentId >= 0 ? sim.incidents[call.incidentId] : null;
  const lines = call.transcript.slice(-5);
  const claims = I ? I.claims.filter((c) => c.callId === call.id) : [];
  const active = mode === 'active';
  return (
    <div className={`call ${mode}`}>
      <div className="call-head" key={call.id}>
        <span className={`ring ${active ? 'on' : ''}`}><Icon name="phone" size={15} /></span>
        <b>{mode === 'past' ? '지난 통화' : call.kind === 'nuisance' ? '비긴급 전화' : call.isFollowup ? '추가 신고' : '신고 통화'}</b>{I && <span className="inc">{I.code}</span>}
        <span className="dur">{active || call.endedAt >= 0 ? fmtDur((active ? sim.t : call.endedAt) - call.answeredAt) : ''}</span>{/* 통화 중단(endedAt = -1)은 길이를 쓰지 않는다 */}
        {active ? <span className="live">● 통화 중</span> : <span className="dim">{mode === 'past' ? pastText(sim, call) : '통화 종료'}</span>}
        {(mode === 'active' || mode === 'ended') && ringing > 0 && <span className="queue" title={`다른 신고 ${ringing}건이 대기 중입니다`}>대기 {ringing}</span>}
      </div>
      <div className="call-sub">신고 접수 AI ↔ {call.kind === 'nuisance' ? '발신자' : '신고자'} {call.caller.name} {call.kind !== 'nuisance' && <span className="dim">· 화법: {call.caller.persona === 'prank' && !truth ? '확인 중' : personaName(call.caller.persona)}</span>}</div>
      <div className="bubbles">
        {lines.map((l, k) => <div key={call.transcript.length - lines.length + k} className={`bub ${l.who === 'CALLER' ? 'caller' : 'ai'}`}>{l.text}</div>)}
        {active && call.kind !== 'nuisance' && call.phase === 'wait' && <div className="bub caller typing"><i /><i /><i /></div>}
      </div>
      {claims.length > 0 && (
        <div className="extracted">
          <span className="dim">AI가 정리한 정보</span>
          {claims.map((c, k) => <span key={k} className={`chip2 ${c.conf < 0.5 ? 'unsure' : ''} ${truth && !c.truthful ? 'wrong' : ''}`} title={truth && c.note ? c.note : c.text}>{topicName(c.topic)} {pct(c.conf)}{truth && !c.truthful ? ' ✕' : ''}</span>)}
        </div>
      )}
    </div>
  );
}

/** 접힌 띠 (3.3): 한 줄 34px, 띠 전체가 펼치기 단추. 새 통화마다 다시 그려져 한 번 반짝인다 */
function CallStrip({ sim, s, onClick }: { sim: Sim; s: Shown; onClick: () => void }) {
  const { call, mode, ringing } = s;
  const I = call && call.incidentId >= 0 ? sim.incidents[call.incidentId] : null;
  // 신고자의 마지막 대사 (아직 없으면 마지막 대사). 신고자가 실제로 한 말이라 시점과 무관하다
  let said = '';
  if (call) { for (let i = call.transcript.length - 1; i >= 0; i--) if (call.transcript[i].who === 'CALLER') { said = call.transcript[i].text; break; } if (!said && call.transcript.length) said = call.transcript[call.transcript.length - 1].text; }
  let line = '', tail = '';
  if (mode === 'active') line = said;
  else if (mode === 'ended') line = '통화 종료 · ' + said;
  else if (mode === 'ringing') line = `신고 전화 대기 ${ringing}건`;
  else if (mode === 'past' && call) { line = '대기 중인 신고 전화 없음'; tail = call.endedAt >= 0 ? ` · 지난 통화 ${fmtDur(sim.t - call.endedAt)} 전 종료` : ' · 지난 통화 중단'; }
  else line = '아직 걸려 온 신고 전화가 없습니다';
  const live = mode === 'active' || mode === 'ended';
  return (
    <button key={call ? call.id : -1} className={'call-strip st-' + mode + (mode === 'active' ? ' flash' : '')}
      onClick={onClick} aria-expanded={false} title={`${line}${tail} — 눌러서 펼치기 (P)`}>
      <span className={`ring ${mode === 'active' || mode === 'ringing' ? 'on' : ''}`}><Icon name="phone" size={13} /></span>
      {call && <span className="inc">{I ? I.code : '비긴급'}</span>}
      <span className="line">{line}{tail && <span className="dim">{tail}</span>}</span>
      {live && call && <span className="dur">{fmtDur((mode === 'active' ? sim.t : call.endedAt) - call.answeredAt)}</span>}
      {mode === 'active' && <span className="live">●</span>}
      {ringing > 0 && <span className="queue">대기 {ringing}</span>}
      <i className="chev" />
    </button>
  );
}
