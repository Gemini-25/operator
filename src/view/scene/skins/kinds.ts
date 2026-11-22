// N8 사건 종류 다양화의 소품 그림 (docs/specs/N8-incident-kinds.md §5.12). 열쇠는 Prop.skin 의 값이다. 읽기만 한다 — 결과를 바꾸지 않는다.
// 단계 3: 오인 신고의 답 셋 — 물에 뜬 물건(floater) · 터진 폭죽 잔해(fireworks) · 음식물 쓰레기(trash). 나머지 스킨(pole·wire·pipe …)은 그 시나리오의 단계가 더한다.
import { disc, hash2, oval, seg } from '../common';
import type { SkinPainter } from '../skins';

/** 물에 뜬 물건: 반쯤 잠긴 마네킹 같은 연한 덩어리와 비닐 봉투 — 물결에 조금 흔들린다 (timeMs 로만) */
const floater: SkinPainter = (g, p, timeMs) => {
  const bob = Math.sin(timeMs / 700 + p.id) * 0.03;
  oval(g, 0, 0.06 + bob, 0.46, 0.2, 'rgba(10,30,50,0.35)');
  oval(g, -0.06, bob, 0.36, 0.13, '#d9c7b0');
  disc(g, 0.3, -0.02 + bob, 0.1, '#e2d2bd');
  oval(g, -0.28, 0.12 + bob, 0.16, 0.1, '#3a3f45', 0.4);
  seg(g, -0.4, 0.2 + bob, 0.42, 0.22 + bob, 0.02, 'rgba(255,255,255,0.35)');
};

/** 터진 폭죽 잔해: 그을린 종이 통과 흩어진 붉은 종이 조각 */
const fireworks: SkinPainter = (g, p) => {
  const h = (k: number): number => hash2(p.id * 31 + k, p.x * 5 + p.y * 11);
  oval(g, 0, 0.04, 0.42, 0.3, 'rgba(30,30,30,0.32)');
  for (let k = 0; k < 3; k++) { const a = h(k) * 6.28; seg(g, Math.cos(a) * 0.05, Math.sin(a) * 0.05, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.07, k === 1 ? '#7a2a22' : '#9c3a2c'); disc(g, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.035, '#222'); }
  for (let k = 0; k < 7; k++) { const a = h(10 + k) * 6.28, r = 0.18 + 0.24 * h(20 + k); disc(g, Math.cos(a) * r, Math.sin(a) * r, 0.025, k % 2 ? '#d94a3a' : '#e8c34a'); }
};

/** 음식물 쓰레기: 묶인 봉투 두엇과 새어 나온 얼룩 */
const trash: SkinPainter = (g) => {
  oval(g, 0.05, 0.08, 0.4, 0.26, 'rgba(70,55,30,0.35)');
  oval(g, -0.1, 0, 0.22, 0.2, '#4b5a3c');
  oval(g, 0.14, 0.04, 0.18, 0.16, '#5c6b48');
  seg(g, -0.1, -0.2, -0.05, -0.27, 0.04, '#2f3826');
};

export const KINDS_SKINS: Record<string, SkinPainter> = { floater, fireworks, trash };
