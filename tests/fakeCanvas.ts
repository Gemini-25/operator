// 시험용 가짜 캔버스 (G5 의 tests/combatfx.test.ts 에서 옮겼다 — G4 tests/legibility.test.ts 도 함께 쓴다).
// 그림이 맞는지는 보지 않는다. 그림 함수가 예외 없이 끝나는지만 본다.

/** 모든 메서드·속성을 받아 주는 가짜 2D 맥락 */
export function fakeCtx(): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {};
  const grad = { addColorStop(): void { /* 없음 */ } };
  const handler: ProxyHandler<object> = {
    get(_t, k) {
      if (k in store) return store[k];
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createRadialGradient' || k === 'createLinearGradient' || k === 'createPattern' || k === 'createConicGradient') return () => grad;
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === 'getImageData' || k === 'createImageData') return (a: unknown, b: unknown) => { const w = typeof a === 'number' ? a : 1, h = typeof b === 'number' ? b : 1; return { width: w, height: h, data: new Uint8ClampedArray(Math.max(4, w * h * 4)) }; };
      if (k === 'canvas') return fakeCanvas();
      return () => undefined;
    },
    set(_t, k, v) { store[k] = v; return true; },
  };
  return new Proxy({}, handler) as CanvasRenderingContext2D;
}
/** 가짜 캔버스 (getContext 가 가짜 맥락을 돌려준다) */
export function fakeCanvas(): HTMLCanvasElement { return { width: 64, height: 64, style: {}, getContext: () => fakeCtx() } as unknown as HTMLCanvasElement; }

/** document.createElement('canvas') 와 Path2D 를 가짜로 바꿔 fn 을 돌리고 되돌린다 */
export async function withFakeDom<T>(fn: () => T | Promise<T>): Promise<T> {
  const g = globalThis as unknown as { document?: unknown; Path2D?: unknown };
  const had = g.document, hadPath = g.Path2D;
  g.document = { createElement: () => fakeCanvas() };
  g.Path2D = class { constructor() { return new Proxy(this, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => undefined) }); } };
  try { return await fn(); } finally { g.document = had; g.Path2D = hadPath; }
}
