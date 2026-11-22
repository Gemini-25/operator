// 아이콘과 차량 스프라이트 (모두 이 프로젝트를 위해 직접 그린 벡터 도형).
// 같은 경로 데이터를 캔버스(Path2D)와 React(SVG) 양쪽에서 쓴다.

export const ICON_PATH: Record<string, string> = {
  fire: 'M12 2C13 6 18 8.2 18 14.2A6 6 0 0 1 6 14.2C6 11.2 8 10 9 7.2C10 9 10.6 10 11 11.2C11.6 8.2 11 5 12 2Z',
  traffic: 'M3 14.5L5 9.2Q5.4 8 6.6 8H17.4Q18.6 8 19 9.2L21 14.5V18.5H18.4V17H5.6V18.5H3ZM6.4 13.2H17.6L16.5 10H7.5Z',
  search: 'M10.5 3A7.5 7.5 0 1 0 15.2 16.6L20 21.4L21.4 20L16.6 15.2A7.5 7.5 0 0 0 10.5 3ZM10.5 5.5A5 5 0 1 1 10.5 15.5A5 5 0 0 1 10.5 5.5Z',
  armed: 'M12 3A9 9 0 1 0 12 21A9 9 0 0 0 12 3ZM12 6A6 6 0 1 1 12 18A6 6 0 0 1 12 6ZM11 1H13V8H11ZM11 16H13V23H11ZM1 11H8V13H1ZM16 11H23V13H16Z',
  medical: 'M12 21C5.5 16.2 3 12.6 3 9.2A4.7 4.7 0 0 1 7.7 4.5C9.4 4.5 11 5.4 12 6.8C13 5.4 14.6 4.5 16.3 4.5A4.7 4.7 0 0 1 21 9.2C21 12.6 18.5 16.2 12 21ZM11 8.5V11H8.5V13H11V15.5H13V13H15.5V11H13V8.5Z',
  collapse: 'M4 21V7L10 3L16 7V11L20 13V21ZM9 8L11 11L9 13L11.5 16L10 21H12.5L13.5 16L11.5 13L13.5 11L11.5 8Z',
  hazmat: 'M12 2L22 12L12 22L2 12ZM12 6.5C10 9.5 8.6 11.3 8.6 13.4A3.4 3.4 0 0 0 15.4 13.4C15.4 11.3 14 9.5 12 6.5Z',
  utility: 'M13.6 1.5L4.5 13.4H10.6L9.2 22.5L19.5 9.6H13.2L15.6 1.5ZM2 21V22.6H7.4V21Z',      // (N8 §5.12) 시설 사고 — 번개(끊어진 전선·터진 관·꺼진 땅을 한 기호로)
  water: 'M12 2.5C14.4 5.4 15.8 7.2 15.8 9.1A3.8 3.8 0 0 1 8.2 9.1C8.2 7.2 9.6 5.4 12 2.5ZM2 16.2C4 14.4 6 14.4 8 16.2C10 18 12 18 14 16.2C16 14.4 18 14.4 20 16.2L22 17.8V20.6C20 18.800 18 18.800 16 20.600C14 22.400 12 22.400 10 20.600C8 18.800 6 18.800 4 20.600L2 22Z',
  // (G4) 붕괴 사건의 변형 (핀·사건 카드 — hazardState.pinIcon)
  elevator: 'M4.5 2H19.5V22H4.5ZM6.5 4V20H17.5V4ZM12 5.8L15.4 10.2H8.6ZM12 18.2L8.6 13.8H15.4Z',
  crane: 'M5 22V7.6H7.6V22ZM2.6 5H21.6V7.6H2.6ZM5.4 2.2H7.2V5H5.4ZM18 7.6H19V13.4H18ZM16.8 13.4H20.2V15.4H16.8ZM2.6 22V20.4H10V22ZM2.6 7.6H5V9.6H2.6Z',
  landslide: 'M2 21.5V6.5L15.5 21.5ZM16.6 15.6A2.4 2.4 0 1 0 16.6 20.4A2.4 2.4 0 0 0 16.6 15.6ZM19.8 10.2A1.9 1.9 0 1 0 19.8 14A1.9 1.9 0 0 0 19.8 10.2ZM10.4 4.6A1.6 1.6 0 1 0 10.4 7.8A1.6 1.6 0 0 0 10.4 4.6Z',
  gasblast: 'M2.5 21.5V10H11.5V21.5ZM4.6 12.4H6.8V14.6H4.6ZM7.6 12.4H9.6V14.6H7.6ZM16.6 1.8L17.8 5.4L21.4 4.4L19.4 7.4L22.4 9.8L18.6 10.2L18.9 14L16.4 11.2L13.8 13.6L14.4 9.8L12.6 9.4L12.6 8.2L14.1 7.1L12.6 3.7L16 5.5Z',
  phone: 'M6.6 3H9.6L11 7L9 8.6C9.9 10.9 12.1 13.6 15 15L16.8 13L21 14.6V17.8C21 19.5 19.6 21 17.8 21C10 20.4 3.6 14 3 6.2C3 4.4 4.6 3 6.6 3Z',
  unknown: 'M12 3A9 9 0 1 0 12 21A9 9 0 0 0 12 3ZM11 16.2H13V18.2H11ZM12 5.8C9.9 5.8 8.4 7.1 8.3 9H10.3C10.4 8.2 11 7.6 12 7.6C13 7.6 13.7 8.2 13.7 9.1C13.7 10.9 11 10.9 11 14.2V14.8H13V14.4C13 12.4 15.7 12 15.7 9.1C15.7 7.2 14.2 5.8 12 5.8Z',
  // 시간 조작 단추 (아래 띠)
  play: 'M7 4.2L19.4 12L7 19.8Z',
  pause: 'M6.4 4.6H10.2V19.4H6.4ZM13.8 4.6H17.6V19.4H13.8Z',
  rewind: 'M11.6 5L2.6 12L11.6 19ZM21.4 5L12.4 12L21.4 19Z',
  forward: 'M12.4 5L21.4 12L12.4 19ZM2.6 5L11.6 12L2.6 19Z',
};

const cache = new Map<string, Path2D>();
export function drawIcon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, size: number, color: string): void {
  let p = cache.get(name);
  if (!p) { p = new Path2D(ICON_PATH[name] ?? ICON_PATH.unknown); cache.set(name, p); }
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(p, 'evenodd');
  ctx.restore();
}

const BODY: Record<string, { body: string; stripe: string; a: string; b: string }> = {
  fire: { body: '#d2452a', stripe: '#ffe1b8', a: '#ff4433', b: '#ffd24a' },
  ems: { body: '#e7edf2', stripe: '#27c08c', a: '#ff4433', b: '#4aa3ff' },
  police: { body: '#27477c', stripe: '#e7edf2', a: '#4aa3ff', b: '#ff4433' },
  civil: { body: '#e9c23e', stripe: '#2a2d31', a: '#ffb300', b: '#ffd24a' },      // (N8) 유관 기관: 노란 작업차 · 노란 경광등
};

/** 위에서 본 긴급 차량. len/wid 는 화면(또는 현재 변환) 단위. */
export function drawVehicle(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, wid: number, dept: string, angle: number, lights: boolean, timeMs: number, dim = false): void {
  const c = BODY[dept] ?? BODY.fire;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.roundRect(-len / 2 + 2, -wid / 2 + 3, len, wid, wid * 0.28); ctx.fill();
  if (lights) {
    const ph = Math.floor(timeMs / 170) % 2;
    ctx.fillStyle = (ph ? c.a : c.b) + '3a';
    ctx.beginPath(); ctx.arc(len * 0.08, 0, wid * 0.95, 0, 7); ctx.fill();
  }
  ctx.globalAlpha = dim ? 0.6 : 1;
  ctx.fillStyle = c.body; ctx.strokeStyle = '#0b1219'; ctx.lineWidth = Math.max(1, wid * 0.08);
  ctx.beginPath(); ctx.roundRect(-len / 2, -wid / 2, len, wid, wid * 0.28); ctx.fill(); ctx.stroke();
  ctx.fillStyle = c.stripe; ctx.fillRect(-len / 2 + len * 0.08, -wid * 0.1, len * 0.56, wid * 0.2);
  // 운전석 유리
  ctx.fillStyle = '#16222e'; ctx.beginPath(); ctx.roundRect(len * 0.2, -wid * 0.36, len * 0.16, wid * 0.72, wid * 0.1); ctx.fill();
  if (dept === 'fire') { ctx.strokeStyle = 'rgba(20,25,30,0.55)'; ctx.lineWidth = Math.max(1, wid * 0.06); for (let k = 0; k < 3; k++) { const lx = -len * 0.36 + k * len * 0.16; ctx.beginPath(); ctx.moveTo(lx, -wid * 0.3); ctx.lineTo(lx, wid * 0.3); ctx.stroke(); } }
  if (dept === 'ems') { ctx.fillStyle = '#e04646'; ctx.fillRect(-len * 0.26, -wid * 0.08, len * 0.16, wid * 0.16); ctx.fillRect(-len * 0.21, -wid * 0.22, len * 0.06, wid * 0.44); }
  // 경광등
  const ph = lights ? Math.floor(timeMs / 170) % 2 : -1;
  ctx.fillStyle = ph === 0 ? c.a : lights ? '#3a2a2a' : '#6b7682'; ctx.fillRect(len * 0.04, -wid * 0.42, len * 0.09, wid * 0.36);
  ctx.fillStyle = ph === 1 ? c.b : lights ? '#2a2f3a' : '#6b7682'; ctx.fillRect(len * 0.04, wid * 0.06, len * 0.09, wid * 0.36);
  ctx.restore();
}
