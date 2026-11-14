import { useEffect, useRef, useState } from 'react';
import { nodeName } from '../sim/city';
import { PROBLEM_LABEL } from '../sim/debrief';
import { DISASTER_DESC, DISASTER_KINDS, DISASTER_NAME, KNOBS, PRESETS, difficultyLabel, overallLevel, presetOf } from '../sim/difficulty';
import type { Difficulty, PresetId } from '../sim/difficulty';
import { needsText, sevName } from '../sim/dispatch/analyst';
import { personaName, topicName } from '../sim/dispatch/callSystem';
import type { Sim } from '../sim/engine';
import { workLabel } from '../sim/field/agents';
import { FIELD_NAME, UNIT_KIND_NAME } from '../sim/resources';
import { scenarioName } from '../sim/scenarios';
import type { Incident, Role, SimEvent, Unit, UnitField } from '../sim/types';
import { DEPT_NAME, OUTCOME_NAME, TYPE_NAME, WEATHER_NAME, fmtClock, fmtDur, fmtSec, pct } from '../sim/util';
import type { CameraDirector } from '../view/camera';
import { ICON_PATH } from '../view/icons';
import { DEPT_COLOR, OUTCOME_COLOR, TYPE_COLOR } from '../view/renderCity';
import type { Runner } from '../view/runner';

const PHASE: Record<string, string> = { unreported: '미신고', call: '신고 접수 중', pending: '배정 대기', dispatched: '출동 중', onscene: '현장 대응', closed: '종료' };
const UNIT_STATE: Record<string, string> = { available: '대기', turnout: '출동 준비', enroute: '출동 중', onscene: '현장', transport: '병원 이송', hospital: '환자 인계', returning: '복귀 중', oos: '운용 중단' };
const ROLE_NAME: Record<Role, string> = { SYSTEM: '시스템', CALLER: '신고자', CALL_TAKER: '접수 AI', ANALYST: '분석 AI', DISPATCH: '배정 AI', COMMANDER: '현장 지휘', RESPONDER: '대원', UNIT: '부대' };
const ROLE_COLOR: Record<Role, string> = { SYSTEM: '#7d8b99', CALLER: '#a9b6c3', CALL_TAKER: '#4fd1c5', ANALYST: '#b98cff', DISPATCH: '#ffb454', COMMANDER: '#ffd166', RESPONDER: '#8fb8de', UNIT: '#7cc4ff' };
const BAND = ['경상', '중상', '위중', '사망'];

export function Icon({ name, size = 14, color = 'currentColor' }: { name: string; size?: number; color?: string }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={ICON_PATH[name] ?? ICON_PATH.unknown} fill={color} fillRule="evenodd" /></svg>;
}

function Bar({ v, color, w = 54 }: { v: number; color: string; w?: number }) {
  return <span className="bar" style={{ width: w }}><span style={{ width: `${Math.max(0, Math.min(100, v * 100))}%`, background: color }} /></span>;
}

// ───────────────────────── 좌측: 사건 ─────────────────────────
export function IncidentList({ sim, director, truth }: { sim: Sim; director: CameraDirector; truth: boolean }) {
  const list = sim.incidents.filter((I) => I.phase !== 'unreported' || truth);
  const open = list.filter((I) => I.phase !== 'closed').sort((a, b) => b.priority - a.priority || a.id - b.id);
  const closed = list.filter((I) => I.phase === 'closed').sort((a, b) => b.closedAt - a.closedAt);
  return (
    <div className="panel-section grow">
      <h3>사건 <span className="dim">진행 {open.filter((I) => I.phase !== 'unreported').length} · 종료 {closed.length}</span></h3>
      <div className="scroll">
        {open.length === 0 && closed.length === 0 && <div className="empty">아직 접수된 신고가 없습니다. 도시는 평온합니다.</div>}
        {open.map((I) => <IncidentCard key={I.id} sim={sim} I={I} director={director} truth={truth} />)}
        {closed.map((I) => <IncidentCard key={I.id} sim={sim} I={I} director={director} truth={truth} />)}
      </div>
    </div>
  );
}

function IncidentCard({ sim, I, director, truth }: { sim: Sim; I: Incident; director: CameraDirector; truth: boolean }) {
  const s = sim.scenes[I.id];
  const as = I.assessment;
  const type = as ? as.type : truth ? I.truth.type : 'unknown';
  const cmd = s ? s.agents.find((a) => a.isCommander) : undefined;
  const cas = cmd ? cmd.beliefs.list('cas') : [];
  const bands = [0, 0, 0, 0]; for (const c of cas) bands[c.value.band]++;
  const focused = director.focus === I.id;
  const openProblems = I.problems.filter((p) => !p.recovered).length;
  return (
    <div className={`card incident ${focused ? 'focused' : ''} ${I.phase === 'closed' ? 'closed' : ''}`} style={{ ['--tc' as string]: TYPE_COLOR[type] }} onClick={() => director.pin(I.id, I.phase === 'onscene' || I.phase === 'closed' ? 'scene' : 'city')} title="클릭하면 이 사건을 관찰합니다">
      <div className="row">
        <span className="code" style={{ background: TYPE_COLOR[type] }}><Icon name={I.phase === 'call' && !as ? 'phone' : type} size={12} color="#0b1219" />{I.code}</span>
        <span className="title">{as ? as.label ?? TYPE_NAME[as.type] : I.phase === 'unreported' ? '미신고 사건' : '유형 확인 중'}{as && as.typeConf < 0.6 && !I.fieldType ? ' ?' : ''}</span>
        {I.tag === 'major' && <span className="badge major" title="대형 사고">대형</span>}
        {I.phase === 'closed' && I.result
          ? <span className="badge" style={{ color: OUTCOME_COLOR[I.result.outcome], borderColor: OUTCOME_COLOR[I.result.outcome] }}>{OUTCOME_NAME[I.result.outcome]}</span>
          : <span className={`badge phase-${I.phase}`}>{PHASE[I.phase]}</span>}
      </div>
      <div className="sub">{!I.locationKnown && !truth ? '위치 확인 중…' : I.reportedNode !== I.truth.nodeId && !truth ? `${nodeName(sim.city, I.reportedNode)} 부근 (신고 기준)` : I.truth.label}</div>
      {truth && I.locationKnown && I.reportedNode !== I.truth.nodeId && I.phase !== 'closed' && <div className="sub warn">관찰자 정보: 신고된 위치({nodeName(sim.city, I.reportedNode)})가 틀렸습니다</div>}
      {truth && as && as.type !== I.truth.type && <div className="sub warn">관찰자 정보: 실제는 {scenarioName(I.truth.type, I.truth.variant)}</div>}
      {I.phase !== 'closed' && as && (
        <div className="row small">
          <span className={`sev sev-${sevName(as.severity) === '보통' ? 1 : sevName(as.severity) === '높음' ? 2 : 3}`}>위험도 {sevName(as.severity)}</span>
          <span className="dim">신뢰도 {pct(as.confidence)}</span>
          {openProblems > 0 && <span className="warn">문제 {openProblems}</span>}
          <span className="elapsed">{fmtDur(sim.t - Math.max(0, I.reportedAt))}</span>
        </div>
      )}
      {I.phase !== 'closed' && (I.assigned.length > 0 || Object.values(I.unmet).some((v) => (v ?? 0) > 0)) && (
        <div className="row small wrap">
          {I.assigned.map((uid) => { const u = sim.units[uid]; return <span key={uid} className="chip" style={{ borderColor: DEPT_COLOR[u.dept], color: DEPT_COLOR[u.dept] }}>{u.callsign}{u.state === 'enroute' || u.state === 'turnout' ? ` ${Math.max(0, Math.round(u.estArrive - sim.t))}s` : ''}</span>; })}
          {Object.values(I.unmet).some((v) => (v ?? 0) > 0) && <span className="chip unmet">부족: {needsText(I.unmet)}</span>}
        </div>
      )}
      {I.phase === 'onscene' && cas.length > 0 && (
        <div className="row small"><span className="dim">구조 대상</span>{bands.map((n, k) => n > 0 && <span key={k} className={`band band-${k}`}>{BAND[k]} {n}</span>)}</div>
      )}
      {I.phase === 'closed' && I.result && <div className="sub">{I.result.headline}</div>}
    </div>
  );
}

// ───────────────────────── 좌측: 부대 ─────────────────────────
const FIELD_COLOR: Record<UnitField, string> = { police: '#5aa9ff', fire: '#ff7a45', rescue: '#2fd39a', special: '#c9a2ff' };
export function UnitList({ sim, selectedRid, onSelectRid }: { sim: Sim; selectedRid: number; onSelectRid: (rid: number) => void }) {
  const fields: UnitField[] = ['police', 'fire', 'rescue', 'special'];
  const aid = sim.units.filter((u) => u.aid);
  const own = sim.units.filter((u) => !u.aid);
  return (
    <div className="panel-section">
      <h3>출동 부대 <span className="dim">가용 {own.filter((u) => u.state === 'available').length}/{own.length}{sim.aidUsed ? ` · 인근 도시 지원 ${sim.aidUsed}/${sim.tune.aidUnits}` : ''}</span></h3>
      <div className="units-wrap">
        {fields.map((f) => {
          const us = own.filter((u) => u.field === f);
          if (!us.length) return null;
          return (
            <div key={f} className="ugroup">
              <div className="ugroup-h" style={{ color: FIELD_COLOR[f] }}>{FIELD_NAME[f]} <span className="dim">{us.filter((u) => u.state === 'available').length}/{us.length}</span></div>
              <div className="units">{us.map((u) => <UnitRow key={u.id} sim={sim} u={u} selectedRid={selectedRid} onSelectRid={onSelectRid} />)}</div>
            </div>
          );
        })}
        {aid.length > 0 && (
          <div className="ugroup">
            <div className="ugroup-h">인근 도시 지원</div>
            <div className="units">{aid.map((u) => <UnitRow key={u.id} sim={sim} u={u} selectedRid={selectedRid} onSelectRid={onSelectRid} />)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
function UnitRow({ sim, u, selectedRid, onSelectRid }: { sim: Sim; u: Unit; selectedRid: number; onSelectRid: (rid: number) => void }) {
  const inc = u.incidentId !== null ? sim.incidents[u.incidentId] : null;
  return (
    <div className={`unit st-${u.state} ${u.aid ? 'aid' : ''}`} style={{ ['--dc' as string]: DEPT_COLOR[u.dept] }} title={`${UNIT_KIND_NAME[u.kind]} · ${u.homeName}${u.aid ? ' (지원 부대)' : ''}${u.waterMax > 0 ? ` · 용수 ${Math.round((u.water / u.waterMax) * 100)}%${u.pumpFailed ? ' · 펌프 고장' : ''}` : ''}`}>
      <div className="row">
        <span className="callsign" style={{ color: DEPT_COLOR[u.dept] }}>{u.callsign}</span>
        {u.waterMax > 0 && <Bar v={u.hydrant ? 1 : u.water / u.waterMax} color={u.pumpFailed ? '#ff5d5d' : u.hydrant ? '#5ad17a' : '#58b6ff'} w={16} />}
        <span className="state">{u.aid && u.state === 'oos' ? '관할 복귀' : UNIT_STATE[u.state]}{inc ? ` ${inc.code}` : ''}</span>
      </div>
      <div className="crew2">
        {u.crew.map((rid) => {
          const r = sim.responders[rid];
          return (
            <span key={rid} className={`cchip ${selectedRid === rid ? 'sel' : ''} ${r.status}`} onClick={() => onSelectRid(rid)} title={`${r.name} · 체력 ${Math.round(r.health)} · 지구력 ${Math.round(r.stamina)} — 클릭하면 이 대원의 판단과 정보를 봅니다`}>
              {r.name}<i style={{ width: `${r.health}%`, background: r.health < 40 ? '#ff5d5d' : r.health < 70 ? '#ffd166' : '#5ad17a' }} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── 우측: AI 활동 기록 ─────────────────────────
export function LogPanel({ sim, director, truth, onJump }: { sim: Sim; director: CameraDirector; truth: boolean; onJump?: (t: number, incidentId: number) => void }) {
  const [onlyFocus, setOnlyFocus] = useState(false);
  const [major, setMajor] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const filtered: SimEvent[] = [];
  for (let i = sim.events.length - 1; i >= 0 && filtered.length < 140; i--) {
    const e = sim.events[i];
    if (e.truth && !truth) continue;
    if (onlyFocus && director.focus >= 0 && e.incidentId !== director.focus) continue;
    if (major && e.importance < 2) continue;
    if (!major && e.importance < 1 && e.kind !== 'call') continue;
    filtered.push(e);
  }
  filtered.reverse();
  const lastId = filtered.length ? filtered[filtered.length - 1].id : -1;
  useEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lastId]);
  return (
    <div className="panel-section grow">
      <h3>AI 관제 · 무전 기록
        <span className="toggles">
          <button className={onlyFocus ? 'on' : ''} onClick={() => setOnlyFocus(!onlyFocus)}>관찰 사건만</button>
          <button className={major ? 'on' : ''} onClick={() => setMajor(!major)}>주요만</button>
        </span>
      </h3>
      <div className="scroll log" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {filtered.map((e) => {
          const inc = e.incidentId >= 0 ? sim.incidents[e.incidentId] : null;
          const col = e.role === 'RESPONDER' && e.rid >= 0 ? DEPT_COLOR[sim.responders[e.rid].dept] : ROLE_COLOR[e.role];
          return (
            <div key={e.id} className={`ev k-${e.kind} ${e.problem ? 'problem' : ''} ${e.truth ? 'truth' : ''} imp-${e.importance}`} onClick={() => { if (inc) director.pin(inc.id, inc.phase === 'onscene' || inc.phase === 'closed' ? 'scene' : 'city'); }}
              onDoubleClick={() => onJump && onJump(e.t, e.incidentId)} title="클릭: 이 사건 관찰 · 더블클릭: 이 순간으로 이동">
              <span className="t">{fmtClock(sim.startTod + e.t)}</span>
              {inc && <span className="inc">{inc.code}</span>}
              <span className="role" style={{ color: col }}>{e.truth ? '관찰자' : ROLE_NAME[e.role]}{e.role !== 'SYSTEM' && e.role !== 'ANALYST' && e.role !== 'DISPATCH' && e.role !== 'CALL_TAKER' ? ` ${e.actor.replace('신고자 ', '')}` : ''}</span>
              <span className="tx">{e.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ───────────────────────── 우측: 판단 요약 ─────────────────────────
export function DecisionPanel({ sim, director, truth }: { sim: Sim; director: CameraDirector; truth: boolean }) {
  let I: Incident | null = director.focus >= 0 ? sim.incidents[director.focus] : null;
  if (!I) { const open = sim.incidents.filter((x) => x.phase !== 'closed' && x.phase !== 'unreported'); I = open.length ? open[open.length - 1] : null; }
  if (!I) return <div className="panel-section grow"><h3>판단 요약</h3><div className="empty">관찰 중인 사건이 없습니다.</div></div>;
  const as = I.assessment;
  const s = sim.scenes[I.id];
  const cmd = s ? s.agents.find((a) => a.isCommander) : undefined;
  const calls = sim.calls.filter((c) => c.incidentId === I!.id);
  const board = s ? s.board.filter((w) => w.status === 'open' || w.status === 'active').sort((a, b) => b.priority - a.priority) : [];
  const doneN = s ? s.board.filter((w) => w.status === 'done').length : 0;
  return (
    <div className="panel-section grow">
      <h3>판단 요약 <span className="dim">사건 {I.code}</span></h3>
      <div className="scroll decision">
        <h4>① 신고 접수 AI — 확보한 정보</h4>
        {calls.length === 0 && <div className="empty">신고 대기 중</div>}
        {calls.map((c) => <div key={c.id} className="kv"><span className="dim">신고자 {c.caller.name}</span><span>{personaName(c.caller.persona)}{c.isFollowup ? ' · 추가 신고' : ''}{c.state === 'active' ? ' · 통화 중' : c.state === 'ringing' ? ' · 대기 중' : ''}</span></div>)}
        <table className="claims"><tbody>
          {I.claims.map((c, k) => (
            <tr key={k}>
              <td className="dim">{topicName(c.topic)}</td>
              <td>{c.text}</td>
              <td className="num">{pct(c.conf)}</td>
              {truth && <td className={c.truthful ? 'ok' : 'bad'} title={c.note}>{c.truthful ? '사실' : '오류'}</td>}
            </tr>
          ))}
        </tbody></table>
        <h4>② 상황 분석 AI</h4>
        {as ? (<>
          <div className="probs">
            {(['fire', 'traffic', 'search', 'armed', 'medical', 'collapse', 'hazmat', 'water'] as const).filter((t) => t === 'fire' || t === 'traffic' || t === 'search' || t === 'armed' || t === 'medical' || as.probs[t] >= 0.03).map((t) => (
              <div key={t} className="prob"><span>{TYPE_NAME[t]}</span><Bar v={I!.fieldType ? (I!.fieldType === t ? 1 : 0) : as.probs[t]} color={TYPE_COLOR[t]} w={120} /><span className="num">{pct(I!.fieldType ? (I!.fieldType === t ? 1 : 0) : as.probs[t])}</span></div>
            ))}
          </div>
          <div className="kv"><span className="dim">위험도</span><span>{sevName(as.severity)} ({as.severity.toFixed(1)}) · 정보 신뢰도 {pct(as.confidence)} · 수정 {as.revision}회{I.fieldVerified ? ' · 현장 확인됨' : ''}</span></div>
          <div className="kv"><span className="dim">필요 자원</span><span>{needsText(as.needs)}</span></div>
          {as.risks.length > 0 && <div className="kv"><span className="dim">예측 위험</span><span>{as.risks.join(', ')}</span></div>}
          {truth && <div className="kv"><span className="dim">관찰자 정보</span><span className={as.type === I.truth.type ? 'ok' : 'bad'}>실제 유형 {TYPE_NAME[I.truth.type]}{scenarioName(I.truth.type, I.truth.variant) !== TYPE_NAME[I.truth.type] ? ` (${scenarioName(I.truth.type, I.truth.variant)})` : ''} · 실제 규모 {['', '소', '중', '대'][I.truth.severity]}</span></div>}
        </>) : <div className="empty">평가 전</div>}
        <h4>③ 배정 AI</h4>
        <div className="kv"><span className="dim">배정 부대</span><span>{I.everAssigned.length ? I.everAssigned.map((uid) => { const u = sim.units[uid]; const here = I!.assigned.indexOf(uid) >= 0; return `${u.callsign}(${here ? UNIT_STATE[u.state] : '이탈'})`; }).join(', ') : '없음'}</span></div>
        {Object.values(I.unmet).some((v) => (v ?? 0) > 0) && <div className="kv"><span className="dim">미충족</span><span className="warn">{needsText(I.unmet)}</span></div>}
        {I.firstArrivalAt >= 0 && <div className="kv"><span className="dim">대응 시간</span><span>신고 → 첫 도착 {fmtSec(I.firstArrivalAt - I.reportedAt)}</span></div>}
        <h4>④ 현장 지휘관{cmd ? ` — ${sim.responders[cmd.rid].name}` : ''}</h4>
        {!s || s.arrivedAt < 0 ? <div className="empty">현장 도착 전</div> : (<>
          <div className="kv"><span className="dim">현장 평가</span><span>{s.sizeupDone ? '완료' : '진행 중'}{s.kind === 'armed' ? (s.secureAt >= 0 ? ' · 안전 확보' : ' · 위협 진행 중') : ''}{s.researchRound > 0 ? ` · 재수색 ${s.researchRound}차` : ''}</span></div>
          <div className="board">
            {board.length === 0 && <div className="empty">대기 중인 작업 없음 (완료 {doneN})</div>}
            {board.slice(0, 12).map((w) => (
              <div key={w.id} className={`work ${w.status}`}>
                <span className="pr"><Bar v={w.priority} color="#ffb454" w={26} /></span>
                <span className="wl">{workLabel(s, w)}</span>
                <span className="who">{w.assignees.length ? w.assignees.map((rid) => sim.responders[rid].name).join(', ') : w.note ? `보류: ${w.note}` : '미배정'}</span>
              </div>
            ))}
            {board.length > 0 && <div className="dim small">완료된 작업 {doneN}건</div>}
          </div>
          {s.kind === 'search' && s.zoneProb.length > 0 && (
            <div className="probs">
              {s.regions.filter((r) => r.kind === 'zone').map((r) => <div key={r.id} className="prob"><span>{r.name}</span><Bar v={s.zoneProb[r.id]} color="#4fd1c5" w={120} /><span className="num">{pct(s.zoneProb[r.id])}</span></div>)}
            </div>
          )}
        </>)}
        {I.problems.length > 0 && (<>
          <h4>⑤ 발생한 문제와 복구</h4>
          {I.problems.slice(-8).map((p, k) => <div key={k} className={`prob-row ${p.recovered ? 'rec' : ''}`}><span className="tag">{PROBLEM_LABEL[p.code]}</span><span>{p.detail}{p.recovered && p.recoveryText ? ` → ${p.recoveryText}` : ''}</span></div>)}
        </>)}
        {I.result && (<>
          <h4>결과 — <span style={{ color: OUTCOME_COLOR[I.result.outcome] }}>{OUTCOME_NAME[I.result.outcome]}</span></h4>
          <ul className="analysis">{I.result.analysis.map((a, k) => <li key={k}>{a}</li>)}</ul>
        </>)}
      </div>
    </div>
  );
}

// ───────────────────────── 우측: 대원 ─────────────────────────
export function AgentPanel({ sim, rid }: { sim: Sim; rid: number }) {
  if (rid < 0) return <div className="panel-section grow"><h3>대원 정보</h3><div className="empty">현장 화면에서 대원을 클릭하거나, 왼쪽 부대 목록에서 이름을 선택하세요.<br />대원이 무엇을 알고 있고 왜 그 행동을 골랐는지 볼 수 있습니다.</div></div>;
  const r = sim.responders[rid];
  const u = sim.units[r.unitId];
  let agent = null, scene = null;
  for (const s of sim.scenes) { if (!s || s.archived) continue; const a = s.agents.find((q) => q.rid === rid && q.status !== 'left'); if (a) { agent = a; scene = s; } }
  const stats: [string, number][] = [['전문 기술', r.skill], ['상황 판단', r.judgment], ['침착성', r.composure], ['체력', r.fitness], ['팀워크', r.teamwork], ['경험', r.experience]];
  const facts = agent ? agent.beliefs.all().sort((a, b) => b.t - a.t).slice(0, 24) : [];
  return (
    <div className="panel-section grow">
      <h3>대원 정보</h3>
      <div className="scroll decision">
        <div className="agent-head">
          <span className="avatar" style={{ background: DEPT_COLOR[r.dept] }}>{r.name[0]}</span>
          <div><div className="nm">{r.name} {r.senior && <span className="dim">선임</span>}</div><div className="dim small">{DEPT_NAME[r.dept]} · {u.callsign} · {r.trait}</div></div>
        </div>
        <div className="stats">
          {stats.map(([k, v]) => <div key={k} className="prob"><span>{k}</span><Bar v={v} color="#7cc4ff" w={110} /><span className="num">{Math.round(v * 100)}</span></div>)}
          <div className="prob"><span>건강</span><Bar v={r.health / 100} color={r.health < 40 ? '#ff5d5d' : '#5ad17a'} w={110} /><span className="num">{Math.round(r.health)}</span></div>
          <div className="prob"><span>체력 잔량</span><Bar v={r.stamina / 100} color="#58b6ff" w={110} /><span className="num">{Math.round(r.stamina)}</span></div>
        </div>
        {!agent || !scene ? <div className="empty">현재 현장에 투입되어 있지 않습니다 ({UNIT_STATE[u.state]}).</div> : (<>
          <h4>현재 행동</h4>
          <div className="kv"><span className="dim">상태</span><span>{agent.status === 'active' ? (agent.label || '판단 중') : agent.status === 'down' ? '쓰러짐' : agent.status === 'withdrawn' ? '부상 — 후송 대기' : '이동'}{agent.isCommander ? ' · 현장 지휘관' : ''}</span></div>
          <h4>행동 후보와 점수 (Utility)</h4>
          {agent.candidates.length === 0 && <div className="empty">아직 판단 기록이 없습니다.</div>}
          {agent.candidates.map((c, k) => <div key={k} className={`cand ${c.chosen ? 'chosen' : ''}`}><Bar v={Math.max(0, Math.min(1, c.score / 1.3))} color={c.chosen ? '#4fd1c5' : '#52606d'} w={60} /><span className="num">{c.score.toFixed(2)}</span><span>{c.label}</span></div>)}
          <h4>알고 있는 정보 ({agent.beliefs.facts.size})</h4>
          <table className="claims"><tbody>
            {facts.map((f) => <tr key={f.key}><td>{f.text}</td><td className="dim">{f.src}</td><td className="num">{pct(f.conf)}</td><td className={f.verified ? 'ok' : 'dim'}>{f.verified ? '확인' : '미확인'}</td></tr>)}
          </tbody></table>
        </>)}
      </div>
    </div>
  );
}

// ───────────────────────── 하단: 타임라인 / 배속 ─────────────────────────
export function BottomBar({ runner, director, onTick, onSeek, sound }: { runner: Runner; director: CameraDirector; onTick: () => void; onSeek: (t: number) => void; sound: { enabled: boolean; volume: number; setEnabled: (on: boolean) => void; setVolume: (v: number) => void } }) {
  const sim = runner.sim;
  const total = Math.max(sim.shiftLen, sim.t);
  const speeds = [1, 3, 8, 15];
  return (
    <div className="bottom">
      <div className="controls">
        <button className="ctl" onClick={() => onSeek(sim.t - 10)} title="10초 되감기 (←)">⏪</button>
        <button className={`ctl ${runner.paused ? 'on' : ''}`} onClick={() => { runner.togglePause(); onTick(); }} title="일시정지 / 재개 (Space)">{runner.paused ? '▶ 재개' : '⏸ 정지'}</button>
        <button className="ctl" onClick={() => onSeek(sim.t + 10)} title="10초 앞으로 (→)">⏩</button>
        {speeds.map((v) => <button key={v} className={`ctl ${!runner.paused && runner.settings.speed === v ? 'on' : ''}`} onClick={() => { runner.setSpeed(v); onTick(); }}>{v}×</button>)}
        <button className={`ctl ${runner.settings.autoSlow ? 'on' : ''}`} onClick={() => { runner.settings.autoSlow = !runner.settings.autoSlow; runner.saveSettings(); onTick(); }} title="관찰 중인 현장에서 총격·폭발·진입 같은 결정적 순간이 오면 잠깐 1배속으로 낮춥니다 (S)">자동 감속</button>
        <button className={`ctl ${runner.settings.sceneAuto ? 'on' : ''}`} onClick={() => { runner.settings.sceneAuto = !runner.settings.sceneAuto; runner.saveSettings(); onTick(); }} title="현장에서 벌어지는 일을 따라 화면을 자동으로 확대합니다. 휠로 직접 확대하면 멈추고, 두 번 누르면 다시 따라갑니다 (Z)">자동 확대</button>
        <span className="shift-time">{fmtDur(sim.t)} <span className="dim">/ {fmtDur(sim.shiftLen)}{sim.t > sim.shiftLen ? ' · 연장' : ''}</span></span>
      </div>
      <div className="timeline">
        <div className="track" title="클릭하면 그 시각으로 이동합니다 (되감기 가능)" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * total); }}>
          <div className="shift-end" style={{ left: `${(sim.shiftLen / total) * 100}%` }} />
          {sim.incidents.filter((I) => I.phase !== 'unreported').map((I) => {
            const a = Math.max(0, I.reportedAt), b = I.phase === 'closed' ? I.closedAt : sim.t;
            const col = I.phase === 'closed' && I.result ? OUTCOME_COLOR[I.result.outcome] : TYPE_COLOR[I.assessment ? I.assessment.type : 'unknown'];
            return (
              <div key={I.id} className={`span ${director.focus === I.id ? 'focus' : ''} ${I.phase === 'closed' ? 'done' : 'live'}`} style={{ left: `${(a / total) * 100}%`, width: `${Math.max(0.6, ((b - a) / total) * 100)}%`, top: 4 + (I.id % 3) * 15, background: col }}
                onClick={(e) => { e.stopPropagation(); director.pin(I.id, I.phase === 'onscene' || I.phase === 'closed' ? 'scene' : 'city'); }} title={`사건 ${I.code} ${I.assessment ? TYPE_NAME[I.assessment.type] : ''}${I.result ? ' — ' + OUTCOME_NAME[I.result.outcome] : ''}`}>
                <span>{I.code}</span>
              </div>
            );
          })}
          <div className="now" style={{ left: `${(sim.t / total) * 100}%` }} />
        </div>
        <div className="ticks">{[0, 0.25, 0.5, 0.75, 1].map((f) => <span key={f} style={{ left: `${((f * sim.shiftLen) / total) * 100}%` }}>{fmtDur(f * sim.shiftLen)}</span>)}</div>
      </div>
      <div className="sound">
        <button className={`ctl ${sound.enabled ? 'on' : ''}`} onClick={() => { sound.setEnabled(!sound.enabled); onTick(); }} title="소리 켜기 / 끄기 (M)">{sound.enabled ? '소리 켜짐' : '소리 꺼짐'}</button>
        <input type="range" min={0} max={1} step={0.05} value={sound.volume} onChange={(e) => { sound.setVolume(parseFloat(e.target.value)); onTick(); }} title="음량" />
      </div>
    </div>
  );
}

// ───────────────────────── 상단 ─────────────────────────
export function TopBar({ runner, onNew, onDifficulty }: { runner: Runner; onNew: (seed?: string) => void; onDifficulty: () => void }) {
  const sim = runner.sim;
  const [seed, setSeed] = useState('');
  const lvl = Math.round(overallLevel(sim.difficulty));
  return (
    <div className="top">
      <svg className="logo" width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 2.5 27.5 7v9.2c0 6.6-4.6 11.2-11.5 13.3C9.1 27.4 4.500 22.800 4.500 16.200V7Z" fill="#0f2a2b" stroke="#4fd1c5" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M8.500 17h4l2-5 3.200 9 2-4h3.800" fill="none" stroke="#c9fff8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="brand"><b>AUTONOMOUS RESPONSE</b><span>자율형 긴급구조 조직 시뮬레이션 · 관찰 전용</span></div>
      <div className="clock">{fmtClock(sim.clock)}</div>
      <div className="meta"><span className={`wx wx-${sim.weather}`}>{WEATHER_NAME[sim.weather]}</span><span>시드 <code>{sim.seed}</code></span><span className="dim">{Math.round(runner.fps)} FPS · 틱 {sim.tick}</span></div>
      <button className={`diff-chip lv${lvl}`} onClick={onDifficulty} title="난이도 설정 — 다음 교대의 조건을 정합니다">난이도 <b>{difficultyLabel(sim.difficulty)}</b> <span className="pips">{[1, 2, 3, 4, 5].map((k) => <i key={k} className={k <= lvl ? 'on' : ''} />)}</span></button>
      <div className="seed">
        <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="시드 입력" maxLength={16} onKeyDown={(e) => { if (e.key === 'Enter') { onNew(seed); setSeed(''); } }} />
        <button onClick={() => { onNew(seed); setSeed(''); }}>{seed.trim() ? '이 시드로 시작' : '새 교대'}</button>
        <button onClick={() => onNew(sim.seed)} title="같은 시드로 처음부터 다시 — 결과가 똑같이 재현됩니다">같은 시드 재실행</button>
      </div>
    </div>
  );
}

// ───────────────────────── 종료 보고서 ─────────────────────────
export function ReportModal({ runner, onNew, onClose, onJump, reelCount, onReel }: { runner: Runner; onNew: (seed?: string) => void; onClose: () => void; onJump: (t: number, incidentId: number) => void; reelCount: number; onReel: () => void }) {
  const sim = runner.sim, r = sim.report!;
  const moments = sim.events.filter((e) => e.importance >= 3 && e.kind !== 'shift' && e.incidentId >= 0 && !(e.kind === 'resolve' && e.role === 'SYSTEM')).slice(0, 60);
  const hist = runner.history().filter((h) => !(h.seed === r.seed && h.hash === r.hash)).slice(0, 5);
  return (
    <div className="modal-back">
      <div className="modal">
        <div className="modal-head">
          <div><h2>교대 종료 보고서</h2><div className="dim">시드 {r.seed} · 난이도 {r.difficultyLabel} · 날씨 {WEATHER_NAME[r.weather]} · 진행 시간 {fmtDur(r.duration)} · 기록 해시 {r.hash}</div></div>
          <div className="btns">{reelCount > 0 && <button className="on" onClick={onReel} title="현장의 결정적 순간을 차례로 다시 봅니다">▶ 주요 장면 이어 보기 ({reelCount})</button>}<button onClick={() => onNew()}>새 교대 시작</button><button onClick={() => onNew(r.seed)}>같은 시드 재실행</button><button className="ghost" onClick={onClose}>닫고 마지막 상태 보기</button></div>
        </div>
        <div className="modal-body">
          <div className="summary">{r.summary.map((t, k) => <p key={k}>{t}</p>)}</div>
          {r.disaster && <div className="disaster-report"><h3>재난 대응 — {r.disaster.name}</h3>{r.disaster.lines.map((t, k) => <p key={k}>{t}</p>)}</div>}
          <div className="tiles">
            <div className="tile"><b>{r.totalCalls}</b><span>전체 신고 전화</span></div>
            <div className="tile"><b>{r.totalIncidents}</b><span>처리 사건</span></div>
            {(r.major ?? 0) >= 1 && <div className="tile major"><b>{r.major}</b><span>대형 사고</span></div>}
            {(['success', 'partial', 'delayed', 'unresolved', 'failed'] as const).map((k) => <div key={k} className="tile"><b style={{ color: OUTCOME_COLOR[k] }}>{r.counts[k]}</b><span>{OUTCOME_NAME[k]}</span></div>)}
            <div className="tile"><b>{r.avgResponse >= 0 ? fmtSec(r.avgResponse) : '-'}</b><span>평균 대응 시간</span></div>
            <div className="tile"><b>{pct(r.utilization)}</b><span>자원 활용률</span></div>
            <div className="tile"><b>{r.casSaved}/{r.casTotal}</b><span>구조 성과</span></div>
            <div className="tile"><b style={{ color: r.casLost ? '#ff5d5d' : undefined }}>{r.casLost}{r.casUndiscovered ? ` (+미발견 ${r.casUndiscovered})` : ''}</b><span>시민 피해</span></div>
            <div className="tile"><b>{r.respondersHurt.length}</b><span>대원 부상</span></div>
            <div className="tile"><b>{r.equipFailures}</b><span>장비 고장</span></div>
          </div>
          <div className="cols">
            <div>
              <h4>사건별 결과와 원인</h4>
              {r.incidents.map((x) => (
                <div key={x.id} className="rep-inc" style={{ borderLeftColor: OUTCOME_COLOR[x.result.outcome] }}>
                  <div className="row"><span className="code" style={{ background: TYPE_COLOR[x.type] }}>{x.code}</span><b>{x.name ?? TYPE_NAME[x.type]}</b><span className="dim">{x.label}</span>
                    <span className="badge" style={{ color: OUTCOME_COLOR[x.result.outcome], borderColor: OUTCOME_COLOR[x.result.outcome] }}>{OUTCOME_NAME[x.result.outcome]}</span></div>
                  <div className="small dim">{x.result.headline} 대응 {x.result.responseTime >= 0 ? fmtSec(x.result.responseTime) : '도착 못함'} · 소요 {fmtSec(x.result.duration)}{x.reportedType && x.reportedType !== x.type ? ` · 관제 사전 판단: ${TYPE_NAME[x.reportedType]}` : ''}</div>
                  <ul className="analysis">{x.result.analysis.map((a, k) => <li key={k}>{a}</li>)}</ul>
                </div>
              ))}
            </div>
            <div className="side">
              <h4>결정적 순간 <span className="dim small">누르면 그 장면으로 돌아갑니다</span></h4>
              <div className="moments">
                {moments.length === 0 && <div className="empty">없음</div>}
                {moments.map((e) => (
                  <button key={e.id} className={`moment ${e.problem ? 'bad' : ''}`} onClick={() => onJump(e.t, e.incidentId)}>
                    <span className="t">{fmtDur(e.t)}</span><span className="inc">{sim.incidents[e.incidentId].code}</span><span className="tx">{e.text}</span>
                  </button>
                ))}
              </div>
              <h4>대응 지연·실패 원인 (사건 수)</h4>
              {r.delayCauses.length === 0 && <div className="empty">기록된 문제 없음</div>}
              {r.delayCauses.slice(0, 12).map((c) => <div key={c.code} className="prob"><span>{c.label}</span><Bar v={c.count / Math.max(1, r.totalIncidents)} color="#ffb454" w={90} /><span className="num">{c.count}</span></div>)}
              <h4>부대별 활용률</h4>
              {r.unitUtil.map((u) => <div key={u.callsign} className="prob"><span>{u.callsign}</span><Bar v={u.util} color="#7cc4ff" w={90} /><span className="num">{pct(u.util)} · {u.runs}회</span></div>)}
              <h4>대원 부상</h4>
              {r.respondersHurt.length === 0 ? <div className="empty">없음</div> : r.respondersHurt.map((x) => <div key={x.name} className="kv"><span>{x.name} ({x.callsign})</span><span className="warn">{x.status}</span></div>)}
              {hist.length > 0 && (<><h4>이전 교대 기록</h4>{hist.map((x, k) => <div key={k} className="kv small"><span className="dim">시드 {x.seed}</span><span>{x.difficulty ? `${x.difficulty} · ` : ''}{x.incidents}건 · 성공 {x.counts.success ?? 0} · 실패 {x.counts.failed ?? 0}</span></div>)}</>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── 중앙: 신고 통화창 ─────────────────────────
export function CallPanel({ sim, truth }: { sim: Sim; truth: boolean }) {
  let call = sim.activeCall >= 0 ? sim.calls[sim.activeCall] : null;
  if (!call) for (let i = sim.calls.length - 1; i >= 0; i--) { const c = sim.calls[i]; if (c.state === 'done' && c.endedAt >= 0 && sim.t - c.endedAt < 6) { call = c; break; } }
  const ringing = sim.calls.filter((c) => c.state === 'ringing').length;
  if (!call) return ringing ? <div className="call"><div className="call-head"><Icon name="phone" size={15} /><b>신고 전화 대기 {ringing}건</b><span className="live">● 벨 울림</span></div></div> : null;
  const I = call.incidentId >= 0 ? sim.incidents[call.incidentId] : null;
  const lines = call.transcript.slice(-5);
  const claims = I ? I.claims.filter((c) => c.callId === call!.id) : [];
  const active = call.state === 'active';
  return (
    <div className={`call ${active ? 'active' : 'ended'}`}>
      <div className="call-head">
        <span className={`ring ${active ? 'on' : ''}`}><Icon name="phone" size={15} /></span>
        <b>{call.kind === 'nuisance' ? '비긴급 전화' : call.isFollowup ? '추가 신고' : '신고 통화'}</b>{I && <span className="inc">{I.code}</span>}
        <span className="dur">{fmtDur((active ? sim.t : call.endedAt) - call.answeredAt)}</span>
        {active ? <span className="live">● 통화 중</span> : <span className="dim">통화 종료</span>}
      </div>
      <div className="call-sub">신고 접수 AI ↔ {call.kind === 'nuisance' ? '발신자' : '신고자'} {call.caller.name} {call.kind !== 'nuisance' && <span className="dim">· 화법: {call.caller.persona === 'prank' && !truth ? '확인 중' : personaName(call.caller.persona)}</span>}</div>
      <div className="bubbles">
        {lines.map((l, k) => <div key={call!.transcript.length - lines.length + k} className={`bub ${l.who === 'CALLER' ? 'caller' : 'ai'}`}>{l.text}</div>)}
        {active && call.kind !== 'nuisance' && call.phase === 'wait' && <div className="bub caller typing"><i /><i /><i /></div>}
      </div>
      {claims.length > 0 && (
        <div className="extracted">
          <span className="dim">AI가 정리한 정보</span>
          {claims.map((c, k) => <span key={k} className={`chip2 ${c.conf < 0.5 ? 'unsure' : ''} ${truth && !c.truthful ? 'wrong' : ''}`} title={truth && c.note ? c.note : c.text}>{topicName(c.topic)} {pct(c.conf)}{truth && !c.truthful ? ' ✕' : ''}</span>)}
        </div>
      )}
      {ringing > 0 && <div className="queue">다른 신고 {ringing}건이 대기 중입니다</div>}
    </div>
  );
}

// ───────────────────────── 중앙: 주요 사건 속보 ─────────────────────────
export function Ticker({ sim, truth }: { sim: Sim; truth: boolean }) {
  let ev: SimEvent | null = null;
  for (let i = sim.events.length - 1; i >= 0 && i > sim.events.length - 80; i--) {
    const e = sim.events[i];
    if (sim.t - e.t > 6.5) break;
    if (e.importance >= 3 && (!e.truth || truth) && e.kind !== 'shift') { ev = e; break; }
  }
  if (!ev) return null;
  const inc = ev.incidentId >= 0 ? sim.incidents[ev.incidentId] : null;
  const cls = ev.problem ? 'bad' : ev.kind === 'resolve' || ev.kind === 'recovery' ? 'good' : ev.kind === 'arrive' ? 'info' : 'note';
  return <div key={ev.id} className={`ticker ${cls}`}>{inc && <b>사건 {inc.code}</b>}<span>{ev.text}</span></div>;
}

// ───────────────────────── 난이도 설정 (교대 시작 전 조건) ─────────────────────────
export function DifficultyPanel({ runner, onStart, onClose }: { runner: Runner; onStart: (seed: string | undefined, d: Difficulty) => void; onClose: () => void }) {
  const [d, setD] = useState<Difficulty>({ ...runner.settings.difficulty });
  const preset = presetOf(d);
  const lvl = overallLevel(d);
  const running = !runner.sim.ended && runner.sim.tick > 0;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal diff" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div><h2>난이도 설정</h2><div className="dim">교대가 시작될 때 정해지는 조건입니다. 진행 중인 교대에는 적용되지 않으며, 사건이 벌어진 뒤에는 무엇도 바꿀 수 없습니다.</div></div>
          <div className="btns"><button className="ghost" onClick={onClose}>닫기</button></div>
        </div>
        <div className="modal-body">
          <div className="presets">
            {(Object.keys(PRESETS) as PresetId[]).map((id) => (
              <button key={id} className={`preset ${preset === id ? 'on' : ''}`} onClick={() => setD({ ...PRESETS[id].d, disaster: d.disaster })}>
                <b>{PRESETS[id].name}</b><span>{PRESETS[id].desc}</span>
              </button>
            ))}
          </div>
          <div className="knobs">
            {KNOBS.map((k) => (
              <div key={k.key} className="knob">
                <div className="knob-head"><b>{k.name}</b><span className="val">{d[k.key]}</span>{k.harderWhen === 'low' && <span className="dim small">높을수록 쉬움</span>}</div>
                <div className="slider">
                  <span className="dim">{k.low}</span>
                  <input type="range" min={1} max={5} step={1} value={d[k.key]} onChange={(e) => setD({ ...d, [k.key]: parseInt(e.target.value, 10) })} />
                  <span className="dim">{k.high}</span>
                </div>
                <div className="dim small">{k.desc}</div>
              </div>
            ))}
          </div>
          <div className="disaster-row">
            <div className="knob-head"><b>재난</b><span className="dim small">{DISASTER_DESC[d.disaster ?? 'none']}</span></div>
            <div className="chips">
              {(['none', 'random', ...DISASTER_KINDS] as const).map((k) => (
                <button key={k} className={`chip ${(d.disaster ?? 'none') === k ? 'on' : ''}`} onClick={() => setD({ ...d, disaster: k })}>{DISASTER_NAME[k]}</button>
              ))}
            </div>
          </div>
          <div className="diff-foot">
            <div>종합 난도 <b>{difficultyLabel(d)}</b> <span className="pips big">{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= Math.round(lvl) ? 'on' : ''} />)}</span></div>
            <div className="btns">
              <button onClick={() => onStart(undefined, d)}>이 조건으로 새 교대 시작</button>
              <button onClick={() => onStart(runner.sim.seed, d)} title="사건 배치의 난수는 그대로 두고 조건만 바꿔 비교합니다">같은 시드({runner.sim.seed})로 시작</button>
            </div>
          </div>
          {running && <div className="warn small">지금 진행 중인 교대는 끝내고 새로 시작합니다.</div>}
        </div>
      </div>
    </div>
  );
}
