import { useEffect, useRef } from 'react';
import { TYPE_NAME } from '../sim/util';
import type { SoundDirector } from '../view/audio';
import type { CameraDirector } from '../view/camera';
import { FONT, TYPE_COLOR, drawCity, hitCity, cityXf } from '../view/renderCity';
import { drawScene, hitScene, sceneLayout } from '../view/renderScene';
import { DECISIVE } from '../view/scene/fxBook';
import type { FxBook } from '../view/scene/fxBook';
import type { Fx, Scene } from '../sim/types';
import type { Runner } from '../view/runner';

export interface ViewportProps {
  runner: Runner; director: CameraDirector; sound: SoundDirector; book: FxBook;
  selectedRid: number;
  onSelectRid: (rid: number) => void;
  onSelectUnit: (uid: number) => void;
}

const PIP_W = 232, PIP_H = 158, PAD = 12, GAP = 8;
interface Pip { x: number; y: number; target: number }     // target: 사건 id, -1 = 도시 지도

/** 중앙 화면: 도시 관제 지도 또는 현장 확대 화면. 렌더링은 requestAnimationFrame, 시뮬레이션은 고정 틱. */
export function Viewport({ runner, director, sound, book, selectedRid, onSelectRid, onSelectUnit }: ViewportProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sel = useRef(selectedRid);
  sel.current = selectedRid;

  useEffect(() => {
    const canvas = ref.current!, box = wrap.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0, h = 0, raf = 0, last = 0;
    let evSeen = 0, evSim: unknown = null;      // 자동 감속: 관찰 중인 사건의 중대한 기록
    // (G5) 결정적 순간의 자동 감속: 틱마다 본다(runner.stepGuard). 감속이 새로 걸린 틱에서 그 프레임의 남은 틱을 버려 첫 발부터 1배속이 된다
    const preSlowFor = new WeakMap<Scene, number>();
    const lastShotT = new WeakMap<Scene, number>();
    const dramaMs = (s: Scene, f: Fx): number => {
      if (f.kind === 'shot') { const prev = lastShotT.get(s); lastShotT.set(s, f.t); return prev === undefined || f.t - prev >= 10 ? 4000 : 3200; }
      return f.kind === 'boom' ? 3600 : 3200;
    };
    runner.stepGuard = (sim) => {
      if (!runner.settings.autoSlow || runner.settings.speed <= 1) return false;
      const s = director.mode === 'scene' && director.focus >= 0 ? sim.scenes[director.focus] : null;
      if (!s) return false;
      let ms = 0;
      for (let i = s.fx.length - 1; i >= 0 && s.fx[i].t === sim.t; i--) if (DECISIVE.has(s.fx[i].kind)) ms = Math.max(ms, dramaMs(s, s.fx[i]));      // 이 틱에 생긴 기록만
      if (s.entryOrdered && !s.breachDone && s.breachAt - sim.t > 0 && s.breachAt - sim.t <= 3.4 && preSlowFor.get(s) !== s.breachAt) { preSlowFor.set(s, s.breachAt); ms = Math.max(ms, 5000); }      // 진입 예고
      if (!ms) return false;
      const was = runner.slowed;
      runner.drama(ms); director.nudge();
      return !was;          // 감속이 "새로" 걸린 틱에만 남은 틱을 버린다
    };
    let pips: Pip[] = [];
    let hoverAt: { x: number; y: number } | null = null;      // 지도 위의 마우스 위치
    const resize = () => {
      const r = box.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(100, Math.floor(r.width)); h = Math.max(100, Math.floor(r.height));
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize); ro.observe(box); resize();

    const frameBox = (x: number, y: number, title: string, col: string) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, PIP_W, PIP_H);
      ctx.font = `700 11px ${FONT}`;
      const tw = ctx.measureText(title).width + 12;
      ctx.fillStyle = 'rgba(8,13,18,0.9)'; ctx.fillRect(x + 1, y + 1, tw, 17);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(title, x + 7, y + 10);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dtReal = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      runner.frame(now);
      const sim = runner.sim;
      director.sceneAuto = runner.settings.sceneAuto;
      director.update(sim, dtReal, (I) => !!sim.scenes[I.id] && (sim.scenes[I.id]!.arrivedAt >= 0 || director.manual));
      // 실제 배속: 자동 감속 중이면 설정이 15여도 1배속이다. 연출 시계와 소리 규칙은 이 값을 쓴다
      const effSpeed = runner.paused ? 0 : runner.slowed ? 1 : runner.settings.speed;
      book.frame(sim, dtReal, { paused: runner.paused || sim.ended, speed: effSpeed, seeks: runner.seeks });
      // 자동 감속이 꺼져 있거나 설정 배속이 1 이면 stepGuard 가 일찍 돌아가므로, 결정적 순간의 현장 확대는 여기서 바로 다시 잡는다
      if ((!runner.settings.autoSlow || runner.settings.speed <= 1) && director.mode === 'scene' && director.focus >= 0 && book.fresh.some((e) => e.sid === director.focus && DECISIVE.has(e.kind))) director.nudge();
      {
        // 결정적 순간: 효과 기록은 runner.stepGuard 가 틱마다 본다. 여기서는 그 사건의 중대한 기록(imp ≥ 3)으로 잠깐 1배속으로 낮춘다
        const sc = director.mode === 'scene' && director.focus >= 0 ? sim.scenes[director.focus] : null;
        if (evSim !== sim) { evSim = sim; evSeen = sim.events.length; }
        for (; evSeen < sim.events.length; evSeen++) { const e = sim.events[evSeen]; if (sc && e.incidentId === director.focus && e.importance >= 3 && !e.truth && e.kind !== 'resolve') runner.drama(2600); }
      }
      const truth = runner.settings.truthView;
      const scene = director.mode === 'scene' && director.focus >= 0 ? sim.scenes[director.focus] : null;
      // 소리: 연출 기억이 받아들인 새 항목을 원근(화면 위치)에 맞춰 낸다. AI 시점에서는 부대 도착 전의 기록을 빼고 듣는다
      const fresh = truth ? book.fresh : book.fresh.filter((e) => { const s2 = sim.scenes[e.sid]; return !e.f || (!!s2 && s2.arrivedAt >= 0 && e.f.t >= s2.arrivedAt); });
      const shownPip = new Set(pips.map((p) => p.target));
      const placeSound = (sid: number, x: number, y: number): { gain: number; pan: number; far: number } | null => {
        if (scene) {
          if (sid === scene.id) {
            const L = sceneLayout(scene, w, h, director.sceneCam), hw = w / 2 / L.ts, camX = (w / 2 - L.ox) / L.ts - 0.5, camY = (h / 2 - L.oy) / L.ts - 0.5;
            const d = Math.hypot(x - camX, y - camY);
            return { gain: d <= hw ? 1 : Math.max(0.35, 1 / (1 + ((d - hw) / hw) ** 2)), pan: Math.max(-1, Math.min(1, (x - camX) / hw)) * 0.7, far: 0 };
          }
          return shownPip.has(sid) ? { gain: 0.14, pan: 0.6, far: 1200 } : { gain: 0.05, pan: 0, far: 900 };
        }
        const I = sim.incidents[sid]; if (!I) return null;
        const xf = cityXf(sim, director.cam, w, h), sx = xf.ox + I.truth.x * xf.scale, sy = xf.oy + I.truth.y * xf.scale;
        const out = Math.max(0, -sx, sx - w, -sy, sy - h);
        const g0 = 0.22 * Math.sqrt(director.cam.zoom / 6.5);
        const gain = out <= 0 ? g0 : Math.max(0, g0 * (1 - out / (1.5 * w)));
        return gain > 0 ? { gain, pan: Math.max(-1, Math.min(1, (sx - w / 2) / (w / 2))) * 0.7, far: 900 } : null;
      };
      const tension = !!scene && scene.kind === 'armed' && scene.hostiles.some((x) => x.weapon === 'gun' && (x.state === 'hold' || x.state === 'fight') && sim.t >= x.stunUntil);
      sound.update(sim, { paused: runner.paused, speed: effSpeed, focus: director.focus, inScene: !!scene, fresh, place: placeSound, clock: book.clock, rate: book.rate, tension });
      if (scene) drawScene(ctx, sim, scene, w, h, { truth, alpha: runner.alpha, timeMs: now, selectedRid: sel.current, cam: director.sceneCam, book });
      else {
        const selUnit = sel.current >= 0 ? sim.responders[sel.current].unitId : -1;
        drawCity(ctx, sim, director.cam, w, h, { focus: director.focus, truth, timeMs: now, alpha: runner.alpha, selectedUnit: selUnit, hover: hoverAt, book });
      }
      // 작은 창: (현장 화면일 때) 도시 지도 + 진행 중인 다른 현장들
      pips = [];
      let slot = 0;
      const place = (target: number) => { const p = { x: w - PAD - PIP_W - slot * (PIP_W + GAP), y: h - PAD - PIP_H, target }; slot++; pips.push(p); return p; };
      if (scene) {
        const p = place(-1);
        ctx.save(); ctx.translate(p.x, p.y); ctx.beginPath(); ctx.rect(0, 0, PIP_W, PIP_H); ctx.clip();
        drawCity(ctx, sim, { x: sim.city.w / 2, y: sim.city.h / 2, zoom: 1 }, PIP_W, PIP_H, { focus: director.focus, truth, timeMs: now, alpha: runner.alpha, selectedUnit: -1, mini: true, book });
        ctx.restore();
        frameBox(p.x, p.y, '도시', 'rgba(124,196,255,0.7)');
      }
      const maxScenes = Math.max(1, Math.min(3, Math.floor((w - 2 * PAD - 330) / (PIP_W + GAP)))) - (scene ? 1 : 0);
      let shown = 0;
      for (const I of sim.incidents) {
        if (shown >= maxScenes) break;
        const sc = sim.scenes[I.id];
        if (!sc || I.phase !== 'onscene' || (scene && I.id === director.focus)) continue;
        const p = place(I.id); shown++;
        ctx.save(); ctx.translate(p.x, p.y); ctx.beginPath(); ctx.rect(0, 0, PIP_W, PIP_H); ctx.clip();
        drawScene(ctx, sim, sc, PIP_W, PIP_H, { truth, alpha: runner.alpha, timeMs: now, selectedRid: -1, mini: true, book });
        ctx.restore();
        const type = I.assessment ? I.assessment.type : 'unknown';
        frameBox(p.x, p.y, `사건 ${I.code} · ${I.assessment ? TYPE_NAME[type] : '확인 중'}`, TYPE_COLOR[type]);
      }
    };
    raf = requestAnimationFrame(loop);

    // ── 입력: 시점 조작과 관찰 대상 선택만 가능하다 (AI 에게 명령을 내리는 입력은 없다) ──
    let dragging = false, moved = 0, lx = 0, ly = 0;
    const leave = () => { hoverAt = null; };
    const pos = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: MouseEvent) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; };
    const move = (e: MouseEvent) => {
      // 지도 위에 마우스를 올리면 그 건물·도로의 정보를 보여 준다 (보기만 한다)
      if (e.target === canvas && !dragging) { const q = pos(e); hoverAt = q.x >= 0 && q.y >= 0 && q.x <= w && q.y <= h ? q : null; } else hoverAt = null;
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (moved <= 6) return;
      if (director.mode === 'city') { const xf = cityXf(runner.sim, director.cam, w, h); director.userPan(dx / xf.scale, dy / xf.scale); }
      else { const sc = runner.sim.scenes[director.focus]; if (sc) { const L = sceneLayout(sc, w, h, director.sceneCam); director.scenePan(dx / L.ts, dy / L.ts); } }
    };
    const up = (e: MouseEvent) => {
      if (!dragging) return; dragging = false;
      if (moved > 6) return;
      const p = pos(e), sim = runner.sim;
      for (const q of pips) {
        if (p.x < q.x || p.x > q.x + PIP_W || p.y < q.y || p.y > q.y + PIP_H) continue;
        if (q.target < 0) director.overview(); else director.pin(q.target, 'scene');
        return;
      }
      if (director.mode === 'scene' && director.focus >= 0 && sim.scenes[director.focus]) {
        const hit = hitScene(sim, sim.scenes[director.focus]!, w, h, p.x, p.y, director.sceneCam);
        onSelectRid(hit.rid);
      } else {
        const hit = hitCity(sim, director.cam, w, h, p.x, p.y, runner.settings.truthView);
        if (hit.incident >= 0) director.pin(hit.incident, 'scene');
        else if (hit.unit >= 0) onSelectUnit(hit.unit);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = pos(e);
      if (director.mode !== 'city') {
        // 현장 화면: 마우스가 가리키는 곳을 중심으로 확대·축소 (시점 조작일 뿐, 현장에는 영향이 없다)
        const sc = runner.sim.scenes[director.focus];
        if (sc) { const L = sceneLayout(sc, w, h, director.sceneCam); director.sceneZoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, (p.x - L.ox) / L.ts, (p.y - L.oy) / L.ts); }
        return;
      }
      const xf = cityXf(runner.sim, director.cam, w, h);
      director.userZoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, (p.x - xf.ox) / xf.scale, (p.y - xf.oy) / xf.scale);
    };
    canvas.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mouseleave', leave);
    const dbl = () => { if (director.mode === 'scene') director.sceneReset(); };
    canvas.addEventListener('dblclick', dbl);
    return () => {
      runner.stepGuard = null;
      canvas.removeEventListener('dblclick', dbl);
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('mousedown', down); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('mouseleave', leave);
    };
  }, [runner, director, sound, book, onSelectRid, onSelectUnit]);

  return <div className="viewport" ref={wrap}><canvas ref={ref} /></div>;
}
