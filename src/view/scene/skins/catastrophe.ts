// 위험의 현실화 (X6) 의 소품 그림. 열쇠는 Prop.skin 의 값이다 (설계서 X6 §7.3).
import { disc, hash2, seg } from '../common';
import type { SkinPainter } from '../skins';

/**
 * 화학 드럼: 위에서 본 남색 원통 — 테두리 고리 두 겹, 마개, 노란 위험 마름모. 터졌으면 찢긴 고리와 그을음만 남는다.
 * 달궈지는 정도(열)는 그리지 않는다 — 관찰자 시점의 열 고리는 catLayer 가 그린다
 */
const drum: SkinPainter = (g, p) => {
  if (p.exploded) {
    disc(g, 0.04, 0.05, 0.42, 'rgba(10,8,6,0.5)');
    g.strokeStyle = '#2b3550'; g.lineWidth = 0.07;
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * 6.2832 + hash2(p.id, k) * 0.6, a1 = a0 + 0.7 + 0.3 * hash2(p.id * 3, k);
      g.beginPath(); g.arc(0, 0, 0.3 + 0.05 * hash2(p.id * 7, k), a0, a1); g.stroke();
    }
    for (let k = 0; k < 4; k++) { const a = hash2(p.id * 11, k) * 6.2832; seg(g, Math.cos(a) * 0.18, Math.sin(a) * 0.18, Math.cos(a) * 0.44, Math.sin(a) * 0.44, 0.035, '#3a4258'); }
    return;
  }
  disc(g, 0.05, 0.07, 0.38, 'rgba(0,0,0,0.35)');
  disc(g, 0, 0, 0.36, '#23345e');
  g.strokeStyle = '#4c5f8f'; g.lineWidth = 0.05; g.beginPath(); g.arc(0, 0, 0.33, 0, 6.2832); g.stroke();
  g.strokeStyle = '#1a2646'; g.lineWidth = 0.035; g.beginPath(); g.arc(0, 0, 0.24, 0, 6.2832); g.stroke();
  disc(g, 0.17, -0.15, 0.05, '#9aa3b5');
  // 위험 마름모 (노랑 바탕 · 검은 테)
  g.beginPath(); g.moveTo(-0.06, -0.16); g.lineTo(0.08, -0.02); g.lineTo(-0.06, 0.12); g.lineTo(-0.2, -0.02); g.closePath();
  g.fillStyle = '#f2c230'; g.fill(); g.strokeStyle = '#151515'; g.lineWidth = 0.025; g.stroke();
  seg(g, -0.06, -0.08, -0.06, 0.0, 0.025, '#151515');
  disc(g, -0.06, 0.04, 0.016, '#151515');
};

export const CAT_SKINS: Record<string, SkinPainter> = { drum };
