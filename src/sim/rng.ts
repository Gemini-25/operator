// RandomSeedManager — 시드 기반 난수.
// 시뮬레이션 코드는 Math.random / Date.now 를 절대 사용하지 않는다.
// fork(label) 로 하위 시스템마다 독립된 난수 흐름을 만들어, 한 시스템의 호출 횟수 변화가
// 다른 시스템의 결과를 흔들지 않도록 한다.

export function hashStr(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export class Rng {
  private s: number;
  readonly seed: number;
  constructor(seed: number) { this.seed = seed >>> 0; this.s = this.seed || 0x9e3779b9; }
  /** [0, 1) */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** 정수 [a, b] */
  int(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  chance(p: number): boolean { return this.next() < p; }
  pick<V>(arr: readonly V[]): V { return arr[Math.floor(this.next() * arr.length)]; }
  weighted<V>(items: readonly V[], weights: readonly number[]): V {
    let sum = 0; for (const w of weights) sum += w;
    let r = this.next() * sum;
    for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  shuffle<V>(arr: V[]): V[] {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  /** 독립된 하위 난수 흐름 */
  fork(label: string): Rng { return new Rng(hashStr(this.seed + ':' + label)); }
}
