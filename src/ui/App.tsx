import { DisasterBanner } from './DisasterBanner';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Sim } from '../sim/engine';
import { TYPE_NAME, fmtDur } from '../sim/util';
import { SoundDirector } from '../view/audio';
import { CameraDirector } from '../view/camera';
import { Runner } from '../view/runner';
import { Viewport } from './Viewport';
import { MapLegend } from './MapLegend';
import type { Difficulty } from '../sim/difficulty';
import { AgentPanel, BottomBar, DecisionPanel, DifficultyPanel, Icon, IncidentList, LogPanel, ReportModal, Ticker, TopBar, UnitList } from './panels';
import { CallDock, loadCallOpen, saveCallOpen } from './CallDock';

export interface Moment { t: number; id: number; text: string }
/** 다시 볼 만한 장면: 현장에서 벌어진 중대한 일. 같은 사건의 가까운 장면은 하나로 묶고, 많으면 고르게 여덟 개만 남긴다. */
export function reelMoments(sim: Sim): Moment[] {
  const out: Moment[] = [];
  let lastT = -99, lastId = -1;
  for (const e of sim.events) {
    if (e.importance < 3 || e.truth || e.incidentId < 0 || e.kind === 'shift' || (e.kind === 'resolve' && e.role === 'SYSTEM')) continue;
    const sc = sim.scenes[e.incidentId];
    if (!sc || sc.arrivedAt < 0 || e.t < sc.arrivedAt) continue;
    if (e.incidentId === lastId && e.t - lastT < 25) continue;
    out.push({ t: e.t, id: e.incidentId, text: e.text }); lastT = e.t; lastId = e.incidentId;
  }
  if (out.length <= 8) return out;
  const pick: Moment[] = [];
  for (let k = 0; k < 8; k++) pick.push(out[Math.round((k * (out.length - 1)) / 7)]);
  return pick;
}

/**
 * Observation UI.
 * 이 화면에는 AI 에게 명령을 내리는 조작이 하나도 없다. 할 수 있는 것은
 * 시간(일시정지·배속)과 시점(카메라·관찰 대상·정보 표시 방식) 선택뿐이다.
 */
export function App() {
  const runner = useMemo(() => new Runner(), []);
  const director = useMemo(() => new CameraDirector(), []);
  const sound = useMemo(() => { const s = new SoundDirector(); s.enabled = runner.settings.sound; s.volume = runner.settings.volume; return s; }, [runner]);
  const [, setTick] = useState(0);
  const force = useCallback(() => setTick((t) => (t + 1) % 1e9), []);
  const [selectedRid, setSelectedRid] = useState(-1);
  const [tab, setTab] = useState<'decision' | 'agent'>('decision');
  const [reportClosed, setReportClosed] = useState(-1);
  const [diffOpen, setDiffOpen] = useState(false);
  const [reel, setReel] = useState<{ list: Moment[]; idx: number; speed: number } | null>(null);
  const reelUntil = useRef(0);
  const [callOpen, setCallOpen] = useState<boolean>(loadCallOpen);
  const toggleCall = useCallback(() => setCallOpen((v) => !v), []);
  useEffect(() => { saveCallOpen(callOpen); }, [callOpen]);

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

  // 소리는 첫 사용자 입력 뒤에만 켤 수 있다(브라우저 정책)
  useEffect(() => {
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [sound]);

  /** 시각 이동(되감기 포함). 같은 시드를 다시 돌릴 뿐이므로 결과는 달라지지 않는다. */
  const seekTo = useCallback((t: number) => {
    const sim = runner.sim;
    const max = sim.ended ? sim.t : Math.max(sim.t, sim.hardCap);
    runner.seek(Math.max(0, Math.min(max, t)) / sim.dt);
    director.resync(runner.sim); sound.resync(runner.sim);
    if (!runner.sim.ended) setReportClosed(-1);
    force();
  }, [runner, director, sound, force]);
  const jumpTo = useCallback((t: number, incidentId: number) => {
    seekTo(t - 4);
    if (incidentId >= 0 && incidentId < runner.sim.incidents.length) {
      const I = runner.sim.incidents[incidentId];
      director.pin(incidentId, I.phase === 'onscene' || I.phase === 'closed' ? 'scene' : 'city');
    }
    runner.setSpeed(1); runner.paused = false;
    force();
  }, [runner, director, seekTo, force]);
  // 주요 장면 이어 보기: 장면마다 4초 전으로 돌아가 1배속으로 9초쯤 보고 다음 장면으로 넘어간다
  const playMoment = useCallback((m: Moment) => { setReportClosed(runner.version); jumpTo(m.t, m.id); reelUntil.current = performance.now() + 9500; }, [runner, jumpTo]);
  const stopReel = useCallback((speed: number) => { setReel(null); seekTo(1e9); runner.setSpeed(speed); setReportClosed(-1); force(); }, [runner, seekTo, force]);
  const startReel = useCallback(() => {
    const list = reelMoments(runner.sim);
    if (!list.length) return;
    setReel({ list, idx: 0, speed: runner.settings.speed });
    playMoment(list[0]);
  }, [runner, playMoment]);
  useEffect(() => {
    if (!reel) return;
    const id = window.setInterval(() => {
      if (performance.now() < reelUntil.current) return;
      const next = reel.idx + 1;
      if (next >= reel.list.length) stopReel(reel.speed);
      else { setReel({ ...reel, idx: next }); playMoment(reel.list[next]); }
    }, 250);
    return () => window.clearInterval(id);
  }, [reel, playMoment, stopReel]);
  const soundCtl = useMemo(() => ({
    get enabled() { return sound.enabled; }, get volume() { return sound.volume; },
    setEnabled: (on: boolean) => { sound.unlock(); sound.setEnabled(on); runner.settings.sound = on; runner.saveSettings(); },
    setVolume: (v: number) => { sound.setVolume(v); runner.settings.volume = v; runner.saveSettings(); },
  }), [sound, runner]);

  const onNew = useCallback((seed?: string, d?: Difficulty) => { setReel(null); runner.newShift(seed, d); director.reset(); setSelectedRid(-1); setReportClosed(-1); setTab('decision'); setDiffOpen(false); force(); }, [runner, director, force]);

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
      else if (e.key === 'm' || e.key === 'M') soundCtl.setEnabled(!sound.enabled);
      else if (e.key === 's' || e.key === 'S') { runner.settings.autoSlow = !runner.settings.autoSlow; runner.saveSettings(); }
      else if (e.key === 'z' || e.key === 'Z') { runner.settings.sceneAuto = !runner.settings.sceneAuto; runner.saveSettings(); }
      else if ((e.key === 'p' || e.key === 'P' || e.code === 'KeyP') && !e.ctrlKey && !e.metaKey && !e.altKey) toggleCall();
      else if (e.key === 'ArrowLeft') seekTo(runner.sim.t - 10);
      else if (e.key === 'ArrowRight') seekTo(runner.sim.t + 10);
      else return;
      force();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [runner, director, force, seekTo, soundCtl, sound, toggleCall]);

  const sim = runner.sim;
  const truth = runner.settings.truthView;
  const I = director.focus >= 0 ? sim.incidents[director.focus] : null;
  const scene = I ? sim.scenes[I.id] : null;
  const inScene = director.mode === 'scene' && !!scene;
  const showReport = sim.ended && sim.report && reportClosed !== runner.version;

  return (
    <div className="app">
      <TopBar runner={runner} onNew={onNew} onDifficulty={() => setDiffOpen(true)} />
      <DisasterBanner runner={runner} />
      <div className="left">
        <IncidentList sim={sim} director={director} truth={truth} />
        <UnitList sim={sim} selectedRid={selectedRid} onSelectRid={selectRid} />
      </div>
      <div className="center">
        <Viewport runner={runner} director={director} sound={sound} selectedRid={selectedRid} onSelectRid={selectRid} onSelectUnit={selectUnit} />
        <div className="overlay tl">
          <div className="cam-reason"><span className={`dot ${director.manual ? 'manual' : 'auto'}`} />{director.manual ? '수동 시점' : '자동 카메라'} · {director.reason}</div>
          {runner.slowed && <div className="cam-reason slow"><span className="dot slow" />결정적 순간 · 1배속으로 낮춤</div>}
          {reel && (
            <div className="reel">
              <b>주요 장면 {reel.idx + 1}/{reel.list.length}</b>
              <span className="tx">사건 {sim.incidents[reel.list[reel.idx].id]?.code} · {reel.list[reel.idx].text}</span>
              <button onClick={() => { reelUntil.current = 0; }}>다음 장면</button>
              <button className="ghost" onClick={() => stopReel(reel.speed)}>그만 보기</button>
            </div>
          )}
          {I && !reel && (
            <div className="scene-title">
              <Icon name={I.assessment ? I.assessment.type : 'unknown'} size={15} /> <b>사건 {I.code}</b> {I.assessment ? I.assessment.label ?? TYPE_NAME[I.assessment.type] : '유형 확인 중'} · {I.locationKnown || truth ? I.truth.label : '위치 확인 중'}
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
        <div className="overlay bl">
          {!inScene && <MapLegend />}
          <div className="legend">
          {inScene ? (<>
            <span><i className="ring" style={{ borderColor: '#ff7a45' }} />소방</span><span><i className="ring" style={{ borderColor: '#2fd39a' }} />구급</span><span><i className="ring" style={{ borderColor: '#5aa9ff' }} />경찰</span>
            <span><i className="ring gold" />지휘관</span>
            <span className="sep" />
            <span><i className="sq" style={{ background: '#5ad17a' }} />경상</span><span><i className="sq" style={{ background: '#ffd166' }} />중상</span><span><i className="sq" style={{ background: '#ff5d5d' }} />위중</span>
            <span><i className="ring" style={{ borderColor: '#e0486b', background: 'rgba(224,72,107,0.25)' }} />용의자</span>
            <span className="sep" />
            <span className="dim">휠 확대 · 끌어서 이동 · 두 번 눌러 전체 보기{truth ? ' · 흐린 표시 = AI 미확인' : ''}</span>
          </>) : (<span className="dim">사건 표식을 누르면 현장 확대 · 휠 확대 · 끌어서 이동</span>)}
          </div>
        </div>
        <Ticker sim={sim} truth={truth} />
        {runner.paused && !sim.ended && <div className="paused">일시정지</div>}
      </div>
      <div className="right">
        <CallDock sim={sim} truth={truth} open={callOpen} onToggle={toggleCall} />
        <div className="tabs">
          <button className={tab === 'decision' ? 'on' : ''} onClick={() => setTab('decision')}>판단 요약</button>
          <button className={tab === 'agent' ? 'on' : ''} onClick={() => setTab('agent')}>대원 정보</button>
        </div>
        <div className="right-top">{tab === 'decision' ? <DecisionPanel sim={sim} director={director} truth={truth} /> : <AgentPanel sim={sim} rid={selectedRid} />}</div>
        <div className="right-bottom"><LogPanel sim={sim} director={director} truth={truth} onJump={jumpTo} /></div>
      </div>
      <BottomBar runner={runner} director={director} onTick={force} onSeek={seekTo} sound={soundCtl} />
      {showReport && !diffOpen && !reel && <ReportModal runner={runner} onNew={onNew} onClose={() => setReportClosed(runner.version)} onJump={(t, id) => { setReportClosed(runner.version); jumpTo(t, id); }} reelCount={reelMoments(sim).length} onReel={startReel} />}
      {diffOpen && <DifficultyPanel runner={runner} onStart={onNew} onClose={() => setDiffOpen(false)} />}
      {sim.ended && !showReport && !reel && <button className="reopen" onClick={() => setReportClosed(-1)}>보고서 다시 보기</button>}
    </div>
  );
}
