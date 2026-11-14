import { useEffect, useRef } from 'react';
import { TYPE_NAME } from '../sim/util';
import type { SoundDirector } from '../view/audio';
import type { CameraDirector } from '../view/camera';
import { FONT, TYPE_COLOR, drawCity, hitCity, cityXf } from '../view/renderCity';
import { drawScene, hitScene } from '../view/renderScene';
import type { Runner } from '../view/runner';

export interface ViewportProps {
  runner: Runner; director: CameraDirector; sound: SoundDirector;
  selectedRid: number;
  onSelectRid: (rid: number) => void;
  onSelectUnit: (uid: number) => void;
}

const PIP_W = 232, PIP_H = 158, PAD = 12, GAP = 8;
interface Pip { x: number; y: number; target: number }     // target: 사건 id, -1 = 도시 지도

/** 중앙 화면: 도시 관제 지도 또는 현장 확대 화면. 렌더링은 requestAnimationFrame, 시뮬레이션은 고정 틱. */
export function Viewport({ runner, director, sound, selectedRid, onSelectRid, onSelectUnit }: ViewportProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sel = useRef(selectedRid);
  sel.current = selectedRid;

  useEffect(() => {
    const canvas = ref.current!, box = wrap.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0, h = 0, raf = 0, last = 0;
    let pips: Pip[] = [];
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
      director.update(sim, dtReal, (I) => !!sim.scenes[I.id] && (sim.scenes[I.id]!.arrivedAt >= 0 || director.manual));
      const truth = runner.settings.truthView;
      const scene = director.mode === 'scene' && director.focus >= 0 ? sim.scenes[director.focus] : null;
      sound.update(sim, { paused: runner.paused, speed: runner.settings.speed, focus: director.focus, inScene: !!scene });
      if (scene) drawScene(ctx, sim, scene, w, h, { truth, alpha: runner.alpha, timeMs: now, selectedRid: sel.current });
      else {
        const selUnit = sel.current >= 0 ? sim.responders[sel.current].unitId : -1;
        drawCity(ctx, sim, director.cam, w, h, { focus: director.focus, truth, timeMs: now, alpha: runner.alpha, selectedUnit: selUnit });
      }
      // 작은 창: (현장 화면일 때) 도시 지도 + 진행 중인 다른 현장들
      pips = [];
      let slot = 0;
      const place = (target: number) => { const p = { x: w - PAD - PIP_W - slot * (PIP_W + GAP), y: h - PAD - PIP_H, target }; slot++; pips.push(p); return p; };
      if (scene) {
        const p = place(-1);
        ctx.save(); ctx.translate(p.x, p.y); ctx.beginPath(); ctx.rect(0, 0, PIP_W, PIP_H); ctx.clip();
        drawCity(ctx, sim, { x: sim.city.w / 2, y: sim.city.h / 2, zoom: 1 }, PIP_W, PIP_H, { focus: director.focus, truth, timeMs: now, alpha: runner.alpha, selectedUnit: -1, mini: true });
        ctx.restore();
        frameBox(p.x, p.y, '도시', 'rgba(124,196,255,0.7)');
      }
      const maxScenes = Math.max(1, Math.min(3, Math.floor((w - 2 * PAD - 420) / (PIP_W + GAP)))) - (scene ? 1 : 0);
      let shown = 0;
      for (const I of sim.incidents) {
        if (shown >= maxScenes) break;
        const sc = sim.scenes[I.id];
        if (!sc || I.phase !== 'onscene' || (scene && I.id === director.focus)) continue;
        const p = place(I.id); shown++;
        ctx.save(); ctx.translate(p.x, p.y); ctx.beginPath(); ctx.rect(0, 0, PIP_W, PIP_H); ctx.clip();
        drawScene(ctx, sim, sc, PIP_W, PIP_H, { truth, alpha: runner.alpha, timeMs: now, selectedRid: -1, mini: true });
        ctx.restore();
        const type = I.assessment ? I.assessment.type : 'unknown';
        frameBox(p.x, p.y, `사건 ${I.code} · ${I.assessment ? TYPE_NAME[type] : '확인 중'}`, TYPE_COLOR[type]);
      }
    };
    raf = requestAnimationFrame(loop);

    // ── 입력: 시점 조작과 관찰 대상 선택만 가능하다 (AI 에게 명령을 내리는 입력은 없다) ──
    let dragging = false, moved = 0, lx = 0, ly = 0;
    const pos = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const down = (e: MouseEvent) => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; };
    const move = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (director.mode === 'city' && moved > 6) { const xf = cityXf(runner.sim, director.cam, w, h); director.userPan(dx / xf.scale, dy / xf.scale); }
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
        const hit = hitScene(sim, sim.scenes[director.focus]!, w, h, p.x, p.y);
        onSelectRid(hit.rid);
      } else {
        const hit = hitCity(sim, director.cam, w, h, p.x, p.y);
        if (hit.incident >= 0) director.pin(hit.incident, 'scene');
        else if (hit.unit >= 0) onSelectUnit(hit.unit);
      }
    };
    const wheel = (e: WheelEvent) => {
      if (director.mode !== 'city') return;
      e.preventDefault();
      const p = pos(e); const xf = cityXf(runner.sim, director.cam, w, h);
      director.userZoom(e.deltaY < 0 ? 1.18 : 1 / 1.18, (p.x - xf.ox) / xf.scale, (p.y - xf.oy) / xf.scale);
    };
    canvas.addEventListener('mousedown', down); window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      canvas.removeEventListener('mousedown', down); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [runner, director, sound, onSelectRid, onSelectUnit]);

  return <div className="viewport" ref={wrap}><canvas ref={ref} /></div>;
}
