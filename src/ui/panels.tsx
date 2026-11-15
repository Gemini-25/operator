import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { nodeName } from '../sim/city';
import { PROBLEM_LABEL } from '../sim/debrief';
import { DISASTER_DESC, DISASTER_KINDS, DISASTER_NAME, KNOBS, PRESETS, difficultyLabel, overallLevel, presetOf } from '../sim/difficulty';
import type { Difficulty, PresetId } from '../sim/difficulty';
import { needsText, sevName } from '../sim/dispatch/analyst';
import { personaName, topicName } from '../sim/dispatch/callSystem';
import type { Sim } from '../sim/engine';
import { workLabel } from '../sim/field/agents';
import { outShifts } from '../sim/field/injury';      // (H1) 다음 교대 결장 예상 — 읽기만 한다
import { KITS, roleOf, stays } from '../sim/crews';      // 읽기만 한다 (장비의 상태를 바꾸는 함수는 쓰지 않는다)
import { FIELD_NAME, UNIT_KIND_NAME } from '../sim/resources';
import { scenarioName } from '../sim/scenarios';
import type { AirOp, FieldAgent, Incident, Role, Scene, SimEvent, Unit, UnitField } from '../sim/types';
import { TrafficChip } from './TrafficChip';
import { DEPT_NAME, OUTCOME_NAME, TYPE_NAME, WEATHER_NAME, fmtClock, fmtDur, fmtSec, pct } from '../sim/util';
import type { CameraDirector } from '../view/camera';
import { MethodRows } from './MethodRows';      // (R2) 대원 정보창의 대응 방법 두 줄
import { DoctrineRows } from './DoctrineRows';      // (R3) 대원 정보창의 대응 교본 칸 (단계 0 에는 비어 있다)
import { FIELD_TEXT } from '../view/city/tokens';
import { ICON_PATH } from '../view/icons';
import { KIT_GROUP_MARK, UNIT_MARK } from '../view/marks';
import { DEPT_COLOR, OUTCOME_COLOR, TYPE_COLOR } from '../view/renderCity';
import type { Runner } from '../view/runner';
import { Mark, RoleDot, Token } from './Mark';
import { airOpLabel } from '../view/renderScene';
import { HazardStrip } from './HazardStrip';
import { pinIcon } from '../view/hazardState';
import { LOSS_COLOR, TRIAGE, TRIAGE_NAME, agentStateText, careName, injuryLine, isLoss, reportHurtText, respBand, respStateText } from '../view/triage';

const PHASE: Record<string, string> = { unreported: '미신고', call: '신고 접수 중', pending: '배정 대기', dispatched: '출동 중', onscene: '현장 대응', closed: '종료' };
const UNIT_STATE: Record<string, string> = { available: '대기', turnout: '출동 준비', enroute: '출동 중', onscene: '현장', transport: '병원 이송', hospital: '환자 인계', returning: '복귀 중', oos: '운용 중단' };
const ROLE_NAME: Record<Role, string> = { SYSTEM: '시스템', CALLER: '신고자', CALL_TAKER: '접수 AI', ANALYST: '분석 AI', DISPATCH: '배정 AI', COMMANDER: '현장 지휘', RESPONDER: '대원', UNIT: '부대' };
const ROLE_COLOR: Record<Role, string> = { SYSTEM: '#6f7f8e', CALLER: '#d6e2ee', CALL_TAKER: '#86cfd6', ANALYST: '#c3b3f0', DISPATCH: '#f0c27a', COMMANDER: '#ffd166', RESPONDER: '#8fb8de', UNIT: '#9fb3c6' };
const BAND = TRIAGE_NAME;      // 중증도 이름·색은 view/triage.ts 한 곳 (H1)

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
        <span className="code" style={{ background: TYPE_COLOR[type] }}><Icon name={I.phase === 'call' && !as ? 'phone' : pinIcon(I, truth)} size={12} color="#0b1219" />{I.code}</span>
        <span className="title">{as ? as.label ?? TYPE_NAME[as.type] : I.phase === 'unreported' ? '미신고 사건' : '유형 확인 중'}{as && as.typeConf < 0.6 && !I.fieldType ? ' ?' : ''}</span>
        {I.tag === 'major' && (truth || I.firstArrivalAt >= 0 || !!as?.label) && <span className="badge major" title="대형 사고">대형</span>}
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
      <HazardStrip sim={sim} I={I} truth={truth} />
      {I.phase !== 'closed' && (I.assigned.length > 0 || Object.values(I.unmet).some((v) => (v ?? 0) > 0)) && (
        <div className="row small wrap">
          {I.assigned.map((uid) => { const u = sim.units[uid]; return <span key={uid} className={`chip uchip st-${u.state}`} style={{ color: FIELD_TEXT[fieldOf(u)] }} title={`${UNIT_KIND_NAME[u.kind]} · ${UNIT_STATE[u.state]}`}><Mark d={UNIT_MARK[u.kind]} size={11} />{u.callsign}{u.state === 'enroute' || u.state === 'turnout' ? <b>{Math.max(0, Math.round(u.estArrive - sim.t))}초</b> : null}</span>; })}
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
const FIELD_COLOR: Record<UnitField, string> = FIELD_TEXT;
/** 분야 묶음의 제목 옆에 두는 기호 (그 분야를 대표하는 종류) */
const FIELD_MARK: Record<UnitField, string> = { police: UNIT_MARK.patrol, fire: UNIT_MARK.engine, rescue: UNIT_MARK.bls, special: UNIT_MARK.swat };
function fieldOf(u: Unit): UnitField { return u.field ?? (u.dept === 'police' ? 'police' : u.dept === 'ems' ? 'rescue' : 'fire'); }
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
              <div className="ugroup-h" style={{ color: FIELD_COLOR[f] }}><Mark d={FIELD_MARK[f]} size={12} />{FIELD_NAME[f]} <span className="dim">{us.filter((u) => u.state === 'available').length}/{us.length}</span></div>
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
  const field = fieldOf(u);
  // 한 줄: 지도와 같은 둥근 표식 · 호출부호(+용수) · 대원 · 상태(색 점 + 글자)
  return (
    <div className={`unit st-${u.state} ${u.aid ? 'aid' : ''}`} style={{ ['--dc' as string]: FIELD_TEXT[field] }} title={`${UNIT_KIND_NAME[u.kind]} · ${u.homeName}${u.aid ? ' (지원 부대)' : ''}${u.waterMax > 0 ? ` · 용수 ${Math.round((u.water / u.waterMax) * 100)}%${u.pumpFailed ? ' · 펌프 고장' : ''} · 예비 공기통 ${u.spareAir ?? 0}개` : ''}${u.air ? ` · 남은 체공 ${Math.max(0, Math.round(u.fuel ?? 0))}초${u.grounded ? ` · ${GROUNDED[u.grounded]}` : ''}` : ''}`}>
      <Token field={field} kind={u.kind} size={22} state={u.state} no={+(u.callsign.match(/\d+$/) ?? ['0'])[0]} />
      <span className="callsign">{u.callsign}{u.waterMax > 0 && <Bar v={u.hydrant ? 1 : u.water / u.waterMax} color={u.pumpFailed ? '#ff5d5d' : u.hydrant ? '#5ad17a' : '#58b6ff'} w={14} />}</span>
      {/* 대원 칸 (R1): 부대장 이름 칩 하나 + 대원마다 역할 점. 자리가 모자라면 이름 칩부터 숨는다(점만 남는다 — 0번 점이 부대장).
          그래서 점을 먼저, 칩을 맨 뒤에 두고 오른쪽에서부터 채운다(styles.css 의 .crewN): 넘치는 것은 맨 뒤의 칩이다 */}
      <div className={`crewN n${u.crew.length}`}>
        {u.crew.slice().reverse().map((rid) => {
          const r = sim.responders[rid], role = roleOf(sim, rid);
          return <RoleDot key={rid} group={role.group} field={field} health={r.health} down={r.status === 'down'} dead={r.dead === true} stays={stays(sim, rid)} selected={selectedRid === rid} onClick={() => onSelectRid(rid)}
            title={`${r.name} · ${role.name}${rid === u.crew[0] ? ' (부대장)' : ''} · ${kitLine(sim, rid) || '장비 없음'} · 체력 ${Math.round(r.health)} · 지구력 ${Math.round(r.stamina)}${hurtNote(sim, rid)} — 클릭하면 이 대원의 판단과 정보를 봅니다`} />;
        })}
        {(() => { const rid = u.crew[0], r = sim.responders[rid]; return (
          <span className={`cchip ${selectedRid === rid ? 'sel' : ''} ${r.status} ${r.dead ? 'dead' : ''}`} onClick={() => onSelectRid(rid)} title={`부대장 ${r.name} · ${roleOf(sim, rid).name}${hurtNote(sim, rid)}`}>
            {r.name}<i style={{ width: `${Math.max(0, r.health)}%`, background: TRIAGE[Math.min(2, respBand(r))] }} />
          </span>
        ); })()}
      </div>
      <span className="state"><i className="sdot" />{u.aid && u.state === 'oos' ? '관할 복귀' : UNIT_STATE[u.state]}{inc ? <b>{inc.code}</b> : null}</span>
    </div>
  );
}

/** 헬기가 뜨지 못하는 까닭 (부대 줄의 설명과 대원 정보창) */
const GROUNDED: Record<string, string> = { fog: '안개로 뜨지 못함', night: '야간 운항 안 함', storm: '강풍으로 뜨지 못함' };
/** (H1) 다친 대원의 한마디: " · 부상 (총상 32 · 연기 흡입 8)". 멀쩡하고 기록도 없으면 빈 글 */
function hurtNote(sim: Sim, rid: number): string {
  const r = sim.responders[rid], st = respStateText(r), line = injuryLine(r.injuries, 3);
  if (!st && respBand(r) === 0) return '';
  return ` · ${st || TRIAGE_NAME[respBand(r)]}${line ? ` (${line})` : ''}${(r.bleed ?? 0) > 0 ? ' · 출혈' : ''}`;
}
/** 대원이 든 장비를 한 줄로 (역할 점의 설명에 쓴다) */
function kitLine(sim: Sim, rid: number): string { return (sim.responders[rid].kit ?? []).map((it) => KITS[it.id].name).join(', '); }
/** 그 대원이 탄 헬기가 지금 어느 현장의 상공에 머물고 있는가 (없으면 null) — 읽기만 한다 */
function airOpOf(sim: Sim, rid: number): { s: Scene; op: AirOp } | null {
  const uid = sim.responders[rid].unitId, u = sim.units[uid];
  if (u.state !== 'onscene' || u.incidentId === null) return null;
  const s = sim.scenes[u.incidentId];
  if (!s || s.archived || !s.air) return null;
  for (const op of s.air) if (op.unitId === uid) return { s, op };
  return null;
}

// ───────────────────────── 우측: AI 활동 기록 ─────────────────────────
export function LogPanel({ sim, director, truth, onJump }: { sim: Sim; director: CameraDirector; truth: boolean; onJump?: (t: number, incidentId: number) => void }) {
  const [onlyFocus, setOnlyFocus] = useState(false);
  const [major, setMajor] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastTop = useRef(0);
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
  const byCall = new Map(sim.units.map((u) => [u.callsign, u]));
  // 그리기 전에 내린다: 새 줄이 가려진 채 한 번 그려지지 않는다
  useLayoutEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [lastId]);
  // 칸의 높이가 바뀌어도(통화 칸을 접고 펼 때) 맨 아래에 붙어 있던 기록은 맨 아래를 계속 보여 준다
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  // 붙음을 푸는 것은 사용자가 위로 올렸을 때(scrollTop 이 줄었을 때)뿐이다. 칸이 줄거나(통화 칸이 펼쳐지는 0.18초)
  // 새 줄이 붙어 맨 아래와 틈이 벌어진 것은 위로 올린 것이 아니다 — 틈만 보고 풀면 펼친 뒤 새 기록이 가려진 채 남는다.
  // 스크롤 앵커링은 위로 올려 읽는 동안만 켠다: 140줄 상한에서 맨 위 줄이 빠질 때 읽던 줄을 제자리에 두고,
  // 붙어 있는 동안에는 그 보정이 scrollTop 을 줄여 위로 올린 것으로 읽히지 않게 한다(styles.css 의 .scroll.log).
  const onScroll = (el: HTMLDivElement) => {
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) stick.current = true;
    else if (el.scrollTop < lastTop.current - 1) stick.current = false;
    lastTop.current = el.scrollTop;
    el.style.overflowAnchor = stick.current ? '' : 'auto';
  };
  return (
    <div className="panel-section grow">
      <h3>AI 관제 · 무전 기록
        <span className="toggles">
          <button className={onlyFocus ? 'on' : ''} onClick={() => setOnlyFocus(!onlyFocus)}>관찰 사건만</button>
          <button className={major ? 'on' : ''} onClick={() => setMajor(!major)}>주요만</button>
        </span>
      </h3>
      <div className="scroll log" ref={box} onScroll={(e) => onScroll(e.currentTarget)}>
        {filtered.map((e) => {
          const inc = e.incidentId >= 0 ? sim.incidents[e.incidentId] : null;
          // 대원과 부대의 무전은 그 부대의 분야색 점 (지도·부대 목록의 표식과 같은 색)
          const unit = e.role === 'RESPONDER' && e.rid >= 0 ? sim.units[sim.responders[e.rid].unitId] : e.role === 'UNIT' ? byCall.get(e.actor) : undefined;
          const col = unit ? FIELD_TEXT[fieldOf(unit)] : ROLE_COLOR[e.role];
          return (
            <div key={e.id} className={`ev k-${e.kind} ${e.problem ? 'problem' : ''} ${e.truth ? 'truth' : ''} imp-${e.importance} ${isLoss(e) ? 'loss' : ''}`} onClick={() => { if (inc) director.pin(inc.id, inc.phase === 'onscene' || inc.phase === 'closed' ? 'scene' : 'city'); }}
              onDoubleClick={() => onJump && onJump(e.t, e.incidentId)} title="클릭: 이 사건 관찰 · 더블클릭: 이 순간으로 이동">
              <span className="t">{fmtClock(sim.startTod + e.t)}</span>
              {inc && <span className="inc">{inc.code}</span>}
              <span className="role"><i className={`rdot r-${e.role}`} style={{ ['--rc' as string]: e.truth ? '#b79fe0' : col }} />{e.truth ? '관찰자' : ROLE_NAME[e.role]}{e.role !== 'SYSTEM' && e.role !== 'ANALYST' && e.role !== 'DISPATCH' && e.role !== 'CALL_TAKER' ? ` ${e.actor.replace('신고자 ', '')}` : ''}</span>
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
              {s.regions.filter((r) => r.kind === 'zone').map((r) => <div key={r.id} className="prob"><span>{r.name}</span><Bar v={s.zoneProb[r.id]} color="#8fb8de" w={120} /><span className="num">{pct(s.zoneProb[r.id])}</span></div>)}
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
export function AgentPanel({ sim, rid, truth = false }: { sim: Sim; rid: number; truth?: boolean }) {
  if (rid < 0) return <div className="panel-section grow"><h3>대원 정보</h3><div className="empty">현장 화면에서 대원을 클릭하거나, 왼쪽 부대 목록에서 이름을 선택하세요.<br />대원이 무엇을 알고 있고 왜 그 행동을 골랐는지 볼 수 있습니다.</div></div>;
  const r = sim.responders[rid];
  const u = sim.units[r.unitId];
  let agent: FieldAgent | null = null, scene: Scene | null = null;
  for (const s of sim.scenes) { if (!s || s.archived) continue; const a = s.agents.find((q) => q.rid === rid && q.status !== 'left'); if (a) { agent = a; scene = s; } }
  // (R1) 상공에 머무는 헬기에 탄 대원: 현장에 내리지 않았다. 관측자면 그 믿음을, 그 밖(조종사)은 헬기가 하는 일만 보여 준다
  const aloft = agent ? null : airOpOf(sim, rid);
  const eye = aloft && aloft.op.eye.rid === rid ? aloft.op.eye : null;
  const role = roleOf(sim, rid), kit = r.kit ?? [];
  const stats: [string, number][] = [['전문 기술', r.skill], ['상황 판단', r.judgment], ['침착성', r.composure], ['체력', r.fitness], ['팀워크', r.teamwork], ['경험', r.experience]];
  const knower = agent ?? eye;
  const facts = knower ? knower.beliefs.all().sort((a, b) => b.t - a.t).slice(0, 24) : [];
  return (
    <div className="panel-section grow">
      <h3>대원 정보</h3>
      <div className="scroll decision">
        <div className="agent-head">
          <Token field={fieldOf(u)} kind={u.kind} size={32} state={u.state} title={UNIT_KIND_NAME[u.kind]} />
          <div><div className="nm">{r.name} <span className="dim">{role.name}{rid === u.crew[0] ? ' · 부대장' : ''}</span></div><div className="dim small">{DEPT_NAME[r.dept]} · {u.callsign} · {r.trait}</div></div>
        </div>
        <div className="stats">
          {stats.map(([k, v]) => <div key={k} className="prob"><span>{k}</span><Bar v={v} color="#7cc4ff" w={110} /><span className="num">{Math.round(v * 100)}</span></div>)}
          <div className="prob"><span>건강</span><Bar v={r.health / 100} color={TRIAGE[Math.min(2, respBand(r))]} w={110} /><span className="num">{Math.round(r.health)}</span></div>
          <div className="prob"><span>체력 잔량</span><Bar v={r.stamina / 100} color="#58b6ff" w={110} /><span className="num">{Math.round(r.stamina)}</span></div>
        </div>
        {/* (H1) 부상: 원인별 피해, 출혈, 처치, 후송 — 다친 적이 있는 대원만 */}
        {((r.injuries && r.injuries.length > 0) || r.status !== 'ok' || r.dead) && (<>
          <h4>부상</h4>
          <div className="kv"><span className="dim">중증도</span><span><span className={`band band-${respBand(r)}`}>{TRIAGE_NAME[respBand(r)]}</span>{respStateText(r) ? ` · ${respStateText(r)}` : ''}{outShifts(r) > 0 ? ` · 다음 교대 결장 예상 ${outShifts(r)}` : ''}</span></div>
          <div className="kv"><span className="dim">원인</span><span>{injuryLine(r.injuries) || '기록 없음'}</span></div>
          {(r.bleed ?? 0) > 0 && <div className="kv"><span className="dim">출혈</span><span>있음{(r.treatQ ?? 0) > 0 ? ' (처치로 늦춤)' : ''}</span></div>}
          {(r.treatQ ?? 0) > 0 && <div className="kv"><span className="dim">처치</span><span>{careName(r.treatQ)}</span></div>}
          {r.care && <div className="kv"><span className="dim">후송</span><span>{r.care === 'aboard' ? '구급차 탑승 — 병원으로' : '병원 인계'}</span></div>}
        </>)}
        {/* (R1) 든 장비: 묶음 기호 · 이름 · 수량 · 고장. 숨은 고장은 관찰자 시점에서만 흐리게 보인다 (AI 는 아직 모른다) */}
        <h4>장비</h4>
        {kit.length === 0 ? <div className="empty">개인 장비 없음{role.stays ? ' (현장에 내리지 않는 자리)' : ''}</div> : (
          <div className="kitlist">
            {kit.map((it) => {
              const def = KITS[it.id];
              const qty = it.uses === undefined ? '' : it.id === 'scba' ? `공기 ${Math.round(it.uses)}초` : `${it.uses}`;
              const low = it.id === 'scba' && it.uses !== undefined && it.uses < 60;
              return (
                <span key={it.id} className={`kit ${it.faultKnown ? 'broken' : ''}`} title={def.name}>
                  <Mark d={KIT_GROUP_MARK[def.group]} size={11} />{def.name}{qty && <b className={low ? 'warn' : ''}>{qty}</b>}
                  {it.faultKnown ? <em className="bad">고장</em> : truth && it.fault ? <em className="hidden">(숨은 고장)</em> : null}
                </span>
              );
            })}
          </div>
        )}
        {aloft && (<>
          <h4>현재 행동</h4>
          <div className="kv"><span className="dim">상태</span><span>현장 상공 — 탑승 중{eye ? ' · 공중 관측' : ''}</span></div>
          <div className="kv"><span className="dim">{u.callsign}</span><span>{airOpLabel(aloft.s, aloft.op)}{u.fuelMax ? ` · 남은 체공 ${Math.max(0, Math.round(u.fuel ?? 0))}초` : ''}{(u.bucketMax ?? 0) > 0 ? ` · 물 바구니 ${(u.bucket ?? 0) > 0 ? '참' : '빔'}` : ''}</span></div>
          {eye && (<>
            <h4>알고 있는 정보 ({eye.beliefs.facts.size})</h4>
            <table className="claims"><tbody>
              {facts.map((f) => <tr key={f.key}><td>{f.text}</td><td className="dim">{f.src}</td><td className="num">{pct(f.conf)}</td><td className={f.verified ? 'ok' : 'dim'}>{f.verified ? '확인' : '미확인'}</td></tr>)}
            </tbody></table>
          </>)}
        </>)}
        {aloft ? null : !agent || !scene ? <div className="empty">현재 현장에 투입되어 있지 않습니다 ({respStateText(r) ? `${respStateText(r)} · ` : ''}{UNIT_STATE[u.state]}{u.grounded ? ` — ${GROUNDED[u.grounded]}` : ''}).</div> : (<>
          <h4>현재 행동</h4>
          <div className="kv"><span className="dim">상태</span><span>{agentStateText(agent, r)}{agent.isCommander ? ' · 현장 지휘관' : ''}</span></div>
          <h4>행동 후보와 점수 (Utility)</h4>
          {agent.candidates.length === 0 && <div className="empty">아직 판단 기록이 없습니다.</div>}
          {agent.candidates.map((c, k) => <div key={k} className={`cand ${c.chosen ? 'chosen' : ''}`}><Bar v={Math.max(0, Math.min(1, c.score / 1.3))} color={c.chosen ? '#d6e2ee' : '#52606d'} w={60} /><span className="num">{c.score.toFixed(2)}</span><span>{c.label}</span></div>)}
          <MethodRows agent={agent} />
          <DoctrineRows sim={sim} scene={scene} agent={agent} />
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
        <button className="ctl ico" onClick={() => onSeek(sim.t - 10)} title="10초 되감기 (←)" aria-label="10초 되감기"><Icon name="rewind" size={13} /></button>
        <button className={`ctl ${runner.paused ? 'on' : ''}`} onClick={() => { runner.togglePause(); onTick(); }} title="일시정지 / 재개 (Space)"><Icon name={runner.paused ? 'play' : 'pause'} size={12} />{runner.paused ? '재개' : '정지'}</button>
        <button className="ctl ico" onClick={() => onSeek(sim.t + 10)} title="10초 앞으로 (→)" aria-label="10초 앞으로"><Icon name="forward" size={13} /></button>
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
      <div className="meta"><span className={`wx wx-${sim.weather}`}>{WEATHER_NAME[sim.weather]}</span><TrafficChip sim={sim} /><span>시드 <code>{sim.seed}</code></span><span className="dim">{Math.round(runner.fps)} FPS · 틱 {sim.tick}</span></div>
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
          <div className="btns">{reelCount > 0 && <button className="on" onClick={onReel} title="현장의 결정적 순간을 차례로 다시 봅니다"><Icon name="play" size={11} />주요 장면 이어 보기 ({reelCount})</button>}<button onClick={() => onNew()}>새 교대 시작</button><button onClick={() => onNew(r.seed)}>같은 시드 재실행</button><button className="ghost" onClick={onClose}>닫고 마지막 상태 보기</button></div>
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
            <div className="tile"><b style={{ color: r.casLost ? '#ff5d5d' : undefined }}>{r.casLost}{r.casUndiscovered ? <small> +미발견 {r.casUndiscovered}</small> : null}</b><span>시민 피해</span></div>
            <div className="tile"><b>{r.respondersHurt.filter((x) => !x.dead).length}</b><span>대원 부상</span></div>
            {(r.respondersKilled?.length ?? 0) >= 1 && <div className="tile loss"><b style={{ color: LOSS_COLOR }}>{r.respondersKilled!.length}</b><span>대원 순직</span></div>}
            {(r.suspectsHurt ?? 0) >= 1 && <div className="tile"><b>{r.suspectsHurt}<small> 다침 · 사망 {r.suspectsDead ?? 0}</small></b><span>용의자 사상</span></div>}
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
              <h4>대원 부상·순직</h4>
              {r.respondersHurt.length === 0 ? <div className="empty">없음</div> : r.respondersHurt.map((x) => <div key={x.name} className="kv"><span>{x.name} ({x.role ? `${x.role} · ` : ''}{x.callsign})</span><span className={x.dead ? 'loss' : `warn${x.band !== undefined ? ` band-${Math.min(2, x.band)}` : ''}`}>{reportHurtText(x, r.respondersKilled)}</span></div>)}
              {hist.length > 0 && (<><h4>이전 교대 기록</h4>{hist.map((x, k) => <div key={k} className="kv small"><span className="dim">시드 {x.seed}</span><span>{x.difficulty ? `${x.difficulty} · ` : ''}{x.incidents}건 · 성공 {x.counts.success ?? 0} · 실패 {x.counts.failed ?? 0}</span></div>)}</>)}
            </div>
          </div>
        </div>
      </div>
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
  const cls = isLoss(ev) ? 'loss' : ev.problem ? 'bad' : ev.kind === 'resolve' || ev.kind === 'recovery' ? 'good' : ev.kind === 'arrive' ? 'info' : 'note';      // (H1) 순직·사망은 빨간 경고가 아니라 차분한 회청색
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
                <div className="knob-head"><b>{k.name}</b><span className="val">{d[k.key] ?? 3}</span>{k.harderWhen === 'low' && <span className="dim small">높을수록 쉬움</span>}</div>
                <div className="slider">
                  <span className="dim">{k.low}</span>
                  <input type="range" min={1} max={5} step={1} value={d[k.key] ?? 3} onChange={(e) => setD({ ...d, [k.key]: parseInt(e.target.value, 10) })} />
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
