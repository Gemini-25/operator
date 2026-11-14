// BeliefSystem — 각 AI 는 자신이 획득한 정보만 안다.
// 엔진은 사건의 진실을 모두 알지만, 대원/지휘관/관제는 이 저장소에 들어온 Fact 로만 판단한다.

import type { Fact, FactType } from '../types';

export function mkFact(type: FactType, id: number, value: any, src: string, t: number, conf: number, verified: boolean, text: string): Fact {
  return { key: type + ':' + id, type, id, value, src, t, conf, verified, text };
}

function sameValue(a: any, b: any): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  for (const k in a) if (a[k] !== b[k]) return false;
  for (const k in b) if (!(k in a)) return false;
  return true;
}

export class BeliefStore {
  readonly facts = new Map<string, Fact>();

  /**
   * 새 정보를 병합한다. 반환값이 true 면 "새로운 소식"이다(판단을 바꿔야 할 수 있음).
   * 규칙: 현장에서 확인된 정보 > 미확인 전달 정보. 같은 등급이면 최신 정보 우선.
   */
  merge(f: Fact): boolean {
    const cur = this.facts.get(f.key);
    if (!cur) { this.facts.set(f.key, f); return true; }
    if (cur.verified && !f.verified) return false;
    if (cur.verified === f.verified && f.t < cur.t) return false;
    if (!cur.verified && !f.verified && f.conf < cur.conf - 0.05 && f.t <= cur.t + 20) return false;
    const changed = !sameValue(cur.value, f.value) || cur.verified !== f.verified;
    this.facts.set(f.key, f);
    return changed;
  }
  get(type: FactType, id: number): Fact | undefined { return this.facts.get(type + ':' + id); }
  val<V>(type: FactType, id: number): V | undefined { const f = this.facts.get(type + ':' + id); return f ? (f.value as V) : undefined; }
  list(type: FactType): Fact[] {
    const out: Fact[] = [];
    for (const f of this.facts.values()) if (f.type === type) out.push(f);
    return out;
  }
  all(): Fact[] { return Array.from(this.facts.values()); }
  /** 전달받은 정보는 신뢰도가 조금 낮아진다. */
  static relay(f: Fact): Fact { return { ...f, conf: Math.max(0.2, f.conf * 0.95) }; }
}
