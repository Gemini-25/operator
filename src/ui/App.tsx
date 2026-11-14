import { useCallback, useEffect, useMemo, useState } from 'react';
import { TYPE_NAME, fmtDur } from '../sim/util';
import { CameraDirector } from '../view/camera';
import { Runner } from '../view/runner';
import { Viewport } from './Viewport';
import { AgentPanel, BottomBar, CallPanel, DecisionPanel, Icon, IncidentList, LogPanel, ReportModal, Ticker, TopBar, UnitList } from './panels';

/**
 * Observation UI.
 * 이 화면에는 AI 에게 명령을 내리는 조작이 하나도 없다. 할 수 있는 것은
 * 시간(일시정지·배속)과 시점(카메라·관찰 대상·정보 표시 방식) 선택뿐이다.
 */
export function App() {
  const runner = useMemo(() => new Runner(), []);
  const director = useMemo(() => new CameraDirector(), []);
  const [, setTick] = useState(0);
  const force = useCallback(() => setTick((t) => (t + 1) % 1e9), []);
  const [selectedRid, setSelectedRid] = useState(-1);
  const [tab, setTab] = useState<'decision' | 'agent'>('decision');
  const [reportClosed, setReportClosed] = useState(-1);

  // 패널은 초당 6회 정도만 다시 그린다(캔버스는 별도로 매 프레임 그린다)
  useEffect(() => { const id = window.setInterval(force, 160); return () => window.clearInterval(id); }, [force]);

  const selectRid = useCallback((rid: number) => {
    setSelectedRid(rid);
    if (rid < 0) return;
    setTab('agent');
    const sim = runner.sim;
    for (const s of sim.scenes) if (s && !s.archived && s.agents.some((a) => a.rid === rid && a.status !== 'left')) director.pin(s.incidentId, 'scene');
  }, [runner, director]);
  const selectUnit = useCallback((uid: number) => { selectRid(runner.sim.units[uid].crew[0]); }, [runner, selectRid]);

  const onNew = useCallback((seed?: string) => { runner.newShift(seed); director.reset(); setSelectedRid(-1); setReportClosed(-1); setTab('decision'); force(); }, [runner, director, force]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') { e.preventDefault(); runner.togglePause(); }
      else if (e.key === '1') runner.setSpeed(1);
      else if (e.key === '2') runner.setSpeed(3);
      else if (e.key === '3') runner.setSpeed(8);
      else if (e.key === '4') runner.setSpeed(15);
      else if (e.key === 'a' || e.key === 'A') director.auto();
      else if (e.key === 'c' || e.key === 'C') director.overview();
      else if (e.key === 't' || e.key === 'T') { runner.settings.truthView = !runner.settings.truthView; runner.saveSettings(); }
      else return;
      force();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [runner, director, force]);

  const sim = runner.sim;
  const truth = runner.settings.truthView;
  const I = director.focus >= 0 ? sim.incidents[director.focus] : null;
  const scene = I ? sim.scenes[I.id] : null;
  const inScene = director.mode === 'scene' && !!scene;
  const showReport = sim.ended && sim.report && reportClosed !== runner.version;

  return (
    <div className="app">
      <TopBar runner={runner} onNew={onNew} />
      <div className="left">
        <IncidentList sim={sim} director={director} truth={truth} />
        <UnitList sim={sim} selectedRid={selectedRid} onSelectRid={selectRid} />
      </div>
      <div className="center">
        <Viewport runner={runner} director={director} selectedRid={selectedRid} onSelectRid={selectRid} onSelectUnit={selectUnit} />
        <div className="overlay tl">
          <div className="cam-reason"><span className={`dot ${director.manual ? 'manual' : 'auto'}`} />{director.manual ? '수동 시점' : '자동 카메라'} · {director.reason}</div>
          {I && (
            <div className="scene-title">
              <Icon name={I.assessment ? I.assessment.type : 'unknown'} size={15} /> <b>사건 {I.code}</b> {I.assessment ? TYPE_NAME[I.assessment.type] : '유형 확인 중'} · {I.locationKnown || truth ? I.truth.label : '위치 확인 중'}
              {scene && scene.arrivedAt >= 0 && <span className="dim"> · 현장 경과 {fmtDur((I.phase === 'closed' ? I.closedAt : sim.t) - scene.arrivedAt)}</span>}
              {inScene && scene && scene.arrivedAt < 0 && <span className="warn"> · 부대 도착 전</span>}
            </div>
          )}
        </div>
        <div className="overlay tr">
          <button className={!director.manual ? 'on' : ''} onClick={() => { if (director.manual) director.auto(); else director.manual = true; force(); }} title="자동 카메라 (A)">자동 카메라 {director.manual ? '꺼짐' : '켜짐'}</button>
          <button onClick={() => { director.overview(); force(); }} title="도시 전체 보기 (C)">도시 전체</button>
          {I && scene && <button onClick={() => { director.pin(I.id, inScene ? 'city' : 'scene'); force(); }}>{inScene ? '지도에서 보기' : '현장 확대'}</button>}
          <button className={truth ? 'on' : ''} onClick={() => { runner.settings.truthView = !truth; runner.saveSettings(); force(); }} title="관찰자 시점: AI 가 아직 모르는 사실도 표시 (T)">{truth ? '관찰자 시점' : 'AI 시점'}</button>
        </div>
        <div className="overlay bl legend">
          {inScene ? (<>
            <span><i className="dot" style={{ background: '#ff7a45' }} />소방</span><span><i className="dot" style={{ background: '#2fd39a' }} />구급</span><span><i className="dot" style={{ background: '#5aa9ff' }} />경찰</span>
            <span><i className="sq" style={{ background: '#5ad17a' }} />경상</span><span><i className="sq" style={{ background: '#ffd166' }} />중상</span><span><i className="sq" style={{ background: '#ff5d5d' }} />위중</span>
            <span><i className="tri" />용의자</span><span className="dim">★ 지휘관 · 점선 = AI 미확인</span>
          </>) : (<span className="dim">사건 표식을 클릭하면 현장을 확대합니다 · 휠 확대/축소 · 드래그 이동</span>)}
        </div>
        <div className="overlay call-wrap"><CallPanel sim={sim} truth={truth} /></div>
        <Ticker sim={sim} truth={truth} />
        {runner.paused && !sim.ended && <div className="paused">일시정지</div>}
      </div>
      <div className="right">
        <div className="tabs">
          <button className={tab === 'decision' ? 'on' : ''} onClick={() => setTab('decision')}>판단 요약</button>
          <button className={tab === 'agent' ? 'on' : ''} onClick={() => setTab('agent')}>대원 정보</button>
        </div>
        <div className="right-top">{tab === 'decision' ? <DecisionPanel sim={sim} director={director} truth={truth} /> : <AgentPanel sim={sim} rid={selectedRid} />}</div>
        <div className="right-bottom"><LogPanel sim={sim} director={director} truth={truth} /></div>
      </div>
      <BottomBar runner={runner} director={director} onTick={force} />
      {showReport && <ReportModal runner={runner} onNew={onNew} onClose={() => setReportClosed(runner.version)} />}
      {sim.ended && !showReport && <button className="reopen" onClick={() => setReportClosed(-1)}>보고서 다시 보기</button>}
    </div>
  );
}
