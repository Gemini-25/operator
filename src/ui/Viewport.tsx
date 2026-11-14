import { useEffect, useRef } from 'react';
import type { CameraDirector } from '../view/camera';
import { drawCity, hitCity, cityXf } from '../view/renderCity';
import { drawScene, hitScene } from '../view/renderScene';
import type { Runner } from '../view/runner';

export interface ViewportProps {
  runner: Runner; director: CameraDirector;
  selectedRid: number;
  onSelectRid: (rid: number) => void;
  onSelectUnit: (uid: number) => void;
}

const MINI_W = 232, MINI_H = 158, MINI_PAD = 12;

/** 중앙 화면: 도시 관제 지도 또는 현장 확대 화면. 렌더링은 requestAnimationFrame, 시뮬레이션은 고정 틱. */
export function Viewport({ runner, director, selectedRid, onSelectRid, onSelectUnit }: ViewportProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const sel = useRef(selectedRid);
  sel.current = selectedRid;

  useEffect(() => {
    const canvas = ref.current!, box = wrap.current!;
    const ctx = canvas.getContext('2d')!;
    let w = 0, h = 0, raf = 0, last = 0;
    const resize = () => {
      const r = box.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = Math.max(100, Math.floor(r.width)); h = Math.max(100, Math.floor(r.height));
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize); ro.observe(box); resize();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dtReal = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
      runner.frame(now);
      const sim = runner.sim;
      director.update(sim, dtReal, (I) => !!sim.scenes[I.id] && (sim.scenes[I.id]!.arrivedAt >= 0 || director.manual));
      const truth = runner.settings.truthView;
      const scene = director.mode === 'scene' && director.focus >= 0 ? sim.scenes[director.focus] : null;
      if (scene) {
        drawScene(ctx, sim, scene, w, h, { truth, alpha: runner.alpha, timeMs: now, selectedRid: sel.current });
        // 도시 미니맵
        ctx.save();
        ctx.translate(w - MINI_W - MINI_PAD, h - MINI_H - MINI_PAD);
        ctx.beginPath(); ctx.rect(0, 0, MINI_W, MINI_H); ctx.clip();
        drawCity(ctx, sim, { x: sim.city.w / 2, y: sim.city.h / 2, zoom: 1 }, MINI_W, MINI_H, { focus: director.focus, truth, timeMs: now, alpha: runner.alpha, selectedUnit: -1, mini: true });
        ctx.restore();
        ctx.strokeStyle = 'rgba(124,196,255,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(w - MINI_W - MINI_PAD + 0.5, h - MINI_H - MINI_PAD + 0.5, MINI_W, MINI_H);
      } else {
        const selUnit = sel.current >= 0 ? sim.responders[sel.current].unitId : -1;
        drawCity(ctx, sim, director.cam, w, h, { focus: director.focus, truth, timeMs: now, alpha: runner.alpha, selectedUnit: selUnit });
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
      if (director.mode === 'scene' && director.focus >= 0 && sim.scenes[director.focus]) {
        if (p.x > w - MINI_W - MINI_PAD && p.y > h - MINI_H - MINI_PAD) { director.overview(); return; }
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
  }, [runner, director, onSelectRid, onSelectUnit]);

  return <div className="viewport" ref={wrap}><canvas ref={ref} /></div>;
}
