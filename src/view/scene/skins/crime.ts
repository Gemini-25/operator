// 이 묶음의 소품 그림. 열쇠는 Prop.skin 의 값이다.
// 좌표계: 소품의 가운데가 원점, 1 = 한 칸.
import type { Prop } from '../../../sim/types';
import { disc, oval, rr, seg } from '../common';
import type { G } from '../common';
import type { SkinPainter } from '../skins';

const FONT = "'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";

/** 소품 위의 작은 글자표. 그림 좌표계(1 = 한 칸)를 잠시 풀고 화면 화소 크기로 쓴다. 작은 창에서는 생략한다. */
function tag(g: G, text: string, y: number, fg: string): void {
  const m = g.getTransform(), ts = Math.hypot(m.a, m.b);
  if (ts < 15) return;
  g.save();
  g.translate(0, y);
  g.scale(1 / ts, 1 / ts);
  const fs = ts * 0.27;
  g.font = `600 ${fs}px ${FONT}`;
  const w = g.measureText(text).width + fs * 0.8;
  g.fillStyle = 'rgba(8,13,18,0.82)'; g.beginPath(); g.roundRect(-w / 2, -fs * 0.78, w, fs * 1.5, fs * 0.45); g.fill();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, fs * 0.04);
  g.restore();
}

/** 폭발물로 보이는 물건의 상태 표시: 깜박이는 붉은 점(살아 있음) · 초록 점(처리됨) · 남은 시간(관찰자만) */
function bombStatus(g: G, p: Prop, timeMs: number, truth: boolean, simT: number, lx: number, ly: number): void {
  const known = !!p.found;      // 대원이 알아본 뒤에야 "수상한 물건"으로 표시된다
  if (p.mitigated) { disc(g, lx, ly, 0.06, '#1d3a28'); disc(g, lx, ly, 0.042, '#4fd183'); tag(g, p.real ? '해체 완료' : '폭발물 아님', -0.62, '#8be3ad'); return; }
  if (!known && !truth) return;
  const on = Math.sin(timeMs / 170) > 0;
  const alpha = known ? 1 : 0.6;
  g.globalAlpha = alpha;
  if (on) disc(g, lx, ly, 0.11, 'rgba(255,60,50,0.28)');
  disc(g, lx, ly, 0.055, '#3a0f0c'); disc(g, lx, ly, 0.038, on ? '#ff4a3d' : '#7a1c16');
  const pr = 0.5 + 0.5 * Math.sin(timeMs / 260);
  g.strokeStyle = `rgba(255,96,80,${0.3 + 0.4 * pr})`; g.lineWidth = 0.035; g.beginPath(); g.arc(0, 0, 0.46 + 0.05 * pr, 0, 6.2832); g.stroke();
  if (truth && p.real && p.fuse !== undefined) tag(g, `${known ? '' : '(미확인) '}폭발까지 ${Math.max(0, Math.ceil(p.fuse - simT))}초`, -0.66, '#ff8a7a');
  else if (truth && !p.real) tag(g, `${known ? '' : '(미확인) '}수상한 물건 — 가짜`, -0.66, '#ffd166');
  else tag(g, '폭발물 의심', -0.66, '#ff8a7a');
  g.globalAlpha = 1;
}

/** 바닥에 놓인 가방. 지퍼 사이로 전선이 보인다 */
function drawBombBag(g: G, p: Prop, timeMs: number, truth: boolean, simT: number): void {
  if (p.exploded) return;      // 터진 자리는 그을음과 불이 대신한다
  oval(g, 0.04, 0.07, 0.36, 0.26, 'rgba(0,0,0,0.38)');
  rr(g, -0.33, -0.2, 0.66, 0.42, 0.12, '#1e2a3a'); rr(g, -0.3, -0.18, 0.6, 0.36, 0.1, '#2f4460');
  rr(g, -0.3, -0.18, 0.6, 0.1, 0.05, '#3d5878');
  // 손잡이
  g.strokeStyle = '#141c27'; g.lineWidth = 0.045; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-0.14, -0.17); g.quadraticCurveTo(0, -0.34, 0.14, -0.17); g.stroke();
  if (p.mitigated) {
    // 열어젖힌 가방: 속이 보이고 끊은 전선이 늘어져 있다
    rr(g, -0.24, -0.1, 0.48, 0.24, 0.05, '#0f151d');
    rr(g, -0.14, -0.05, 0.2, 0.13, 0.02, '#6c7480');
    seg(g, 0.08, -0.02, 0.2, -0.08, 0.02, '#d8443a'); seg(g, 0.08, 0.05, 0.21, 0.09, 0.02, '#e8c15a');
  } else {
    // 지퍼와 그 사이로 삐져나온 전선
    seg(g, -0.24, 0.0, 0.24, 0.0, 0.022, '#aab4bf');
    g.lineWidth = 0.02;
    g.strokeStyle = '#d8443a'; g.beginPath(); g.moveTo(0.03, 0); g.quadraticCurveTo(0.1, -0.1, 0.17, -0.02); g.stroke();
    g.strokeStyle = '#e8c15a'; g.beginPath(); g.moveTo(0.07, 0); g.quadraticCurveTo(0.13, 0.1, 0.2, 0.04); g.stroke();
  }
  bombStatus(g, p, timeMs, truth, simT, -0.13, 0.0);
}

/** 테이프를 감은 상자 */
function drawBombBox(g: G, p: Prop, timeMs: number, truth: boolean, simT: number): void {
  if (p.exploded) return;
  oval(g, 0.04, 0.07, 0.34, 0.3, 'rgba(0,0,0,0.38)');
  rr(g, -0.29, -0.25, 0.58, 0.5, 0.03, '#6f5433'); rr(g, -0.26, -0.22, 0.52, 0.44, 0.02, '#b08a55');
  g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(-0.26, -0.22, 0.52, 0.1);
  if (p.mitigated) {
    // 덮개를 열어 둔 상자
    rr(g, -0.2, -0.16, 0.4, 0.32, 0.02, '#3a2c1b');
    rr(g, -0.12, -0.08, 0.18, 0.14, 0.02, '#6c7480');
    seg(g, 0.08, -0.04, 0.17, -0.1, 0.02, '#d8443a'); seg(g, 0.08, 0.04, 0.17, 0.1, 0.02, '#e8c15a');
    rr(g, -0.36, -0.25, 0.09, 0.5, 0.02, '#8f6f44'); rr(g, 0.27, -0.25, 0.09, 0.5, 0.02, '#8f6f44');
  } else {
    // 여러 겹 감은 테이프
    rr(g, -0.29, -0.05, 0.58, 0.1, 0.01, '#c9c2ae'); rr(g, -0.05, -0.25, 0.1, 0.5, 0.01, '#d8d1bd');
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(-0.29, 0.03, 0.58, 0.02);
    seg(g, 0.15, -0.2, 0.22, -0.3, 0.02, '#d8443a');      // 틈으로 나온 전선 한 가닥
  }
  bombStatus(g, p, timeMs, truth, simT, 0.16, 0.14);
}

export const CRIME_SKINS: Record<string, SkinPainter> = { bombBag: drawBombBag, bombBox: drawBombBox };
