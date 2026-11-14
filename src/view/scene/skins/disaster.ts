// 이 묶음의 소품 그림. 열쇠는 Prop.skin 의 값이다.
import { disc, hash2, oval, seg } from '../common';
import type { SkinPainter } from '../skins';

/** 산사태의 흙더미: 젖은 흙 무더기에 돌과 부러진 가지가 섞여 있다 (치울 수 있는 잔해와 같은 규칙) */
const mud: SkinPainter = (g, p) => {
  const h = (k: number): number => hash2(p.id * 29 + k, p.x * 7 + p.y * 13);
  oval(g, 0.05, 0.08, 0.56, 0.48, 'rgba(0,0,0,0.34)');
  oval(g, 0, 0.02, 0.52, 0.45, '#4a3625', h(1) * 3);
  oval(g, -0.08 + 0.1 * h(2), -0.06, 0.4, 0.33, '#5d452e', h(3) * 3);
  oval(g, 0.06 * h(4), -0.12, 0.26, 0.2, '#6f5437', h(5) * 3);
  oval(g, -0.14, -0.18, 0.1, 0.06, 'rgba(160,128,92,0.5)', 0.5);
  for (let k = 0; k < 5; k++) {
    const a = h(10 + k) * 6.2832, r = 0.14 + 0.28 * h(20 + k), rad = 0.045 + 0.05 * h(30 + k);
    disc(g, Math.cos(a) * r, Math.sin(a) * r * 0.85, rad, k % 2 ? '#7d8388' : '#62686e');
    disc(g, Math.cos(a) * r - rad * 0.25, Math.sin(a) * r * 0.85 - rad * 0.3, rad * 0.4, 'rgba(255,255,255,0.16)');
  }
  if (h(40) > 0.4) { const a = h(41) * 3.1; seg(g, Math.cos(a) * -0.34, Math.sin(a) * -0.3, Math.cos(a) * 0.36, Math.sin(a) * 0.3, 0.05, '#3b2a1a'); seg(g, Math.cos(a) * 0.1, Math.sin(a) * 0.08, Math.cos(a + 0.9) * 0.32, Math.sin(a + 0.9) * 0.3, 0.03, '#3b2a1a'); }
  if (h(42) > 0.6) disc(g, 0.2 - 0.4 * h(43), 0.16, 0.07, '#2f6a3a');
};

export const DISASTER_SKINS: Record<string, SkinPainter> = { mud };
