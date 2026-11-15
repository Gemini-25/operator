// BeliefSystem — 각 AI 는 자신이 획득한 정보만 안다.
// 엔진은 사건의 진실을 모두 알지만, 대원/지휘관/관제는 이 저장소에 들어온 Fact 로만 판단한다.

import type { Fact, FactType } from '../types';

// 'type:id' 열쇠 글자를 한 번만 만들어 다시 쓴다. 이동 비용 계산이 칸마다 믿음을 찾아보므로(agentCost)
// 찾을 때마다 글자를 새로 붙이고 해시하던 비용이 컸다. 만들어지는 글자는 예전과 똑같다.
const KEY_CACHE = new Map<string, string[]>();
export function factKey(type: FactType, id: number): string {
  if (id >= 0 && id < 8192 && (id | 0) === id) {
    let arr = KEY_CACHE.get(type);
    if (!arr) { arr = []; KEY_CACHE.set(type, arr); }
    const k = arr[id];
    return k !== undefined ? k : (arr[id] = type + ':' + id);
  }
  return type + ':' + id;
}

export function mkFact(type: FactType, id: number, value: any, src: string, t: number, conf: number, verified: boolean, text: string): Fact {
  return { key: factKey(type, id), type, id, value, src, t, conf, verified, text };
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
  /** 종류별로 나눈 같은 내용 (facts 와 함께만 고친다). 열쇠에 종류가 들어 있으므로 종류 안의 순서는 facts 의 순서와 같다 */
  private readonly byType = new Map<string, Map<string, Fact>>();
  private put(f: Fact): void {
    this.facts.set(f.key, f);
    let m = this.byType.get(f.type);
    if (!m) { m = new Map(); this.byType.set(f.type, m); }
    m.set(f.key, f);
  }

  /**
   * 새 정보를 병합한다. 반환값이 true 면 "새로운 소식"이다(판단을 바꿔야 할 수 있음).
   * 규칙: 현장에서 확인된 정보 > 미확인 전달 정보. 같은 등급이면 최신 정보 우선.
   */
  merge(f: Fact): boolean {
    const cur = this.facts.get(f.key);
    if (!cur) { this.put(f); return true; }
    if (cur.verified && !f.verified) return false;
    if (cur.verified === f.verified && f.t < cur.t) return false;
    if (!cur.verified && !f.verified && f.conf < cur.conf - 0.05 && f.t <= cur.t + 20) return false;
    const changed = !sameValue(cur.value, f.value) || cur.verified !== f.verified;
    this.put(f);
    return changed;
  }
  get(type: FactType, id: number): Fact | undefined { return this.facts.get(factKey(type, id)); }
  val<V>(type: FactType, id: number): V | undefined { const f = this.facts.get(factKey(type, id)); return f ? (f.value as V) : undefined; }
  list(type: FactType): Fact[] {
    const m = this.byType.get(type);
    return m ? Array.from(m.values()) : [];
  }
  all(): Fact[] { return Array.from(this.facts.values()); }
  /** 전달받은 정보는 신뢰도가 조금 낮아진다. */
  static relay(f: Fact): Fact { return { ...f, conf: Math.max(0.2, f.conf * 0.95) }; }
}

// (I1-b 0단계) 무전으로 받아 저장한 사실 → 그 사실을 실어 온 무전 기록 id. 지휘관의 작업 원인(WorkItem.cause → 지시 무전의 causes)에만 쓴다 — 판단은 읽지 않는다.
// 사실 객체의 모양을 바꾸지 않으려고 WeakMap 에 둔다 (되감기는 Sim 을 새로 만들어 다시 돌리므로 안전하다)
const HEARD = new WeakMap<Fact, number>();
/** 무전으로 받은 사실을 합친다 (merge 와 똑같다). 저장됐으면 실어 온 무전 기록(ev ≥ 0)을 기억한다 */
export function mergeHeard(store: BeliefStore, f: Fact, ev: number): boolean {
  const changed = store.merge(f);
  if (ev >= 0 && store.facts.get(f.key) === f) HEARD.set(f, ev);
  return changed;
}
/** 이 사실을 실어 온 무전 기록 (-1 = 직접 보았거나, 소리 없는 보고로 받았거나, 사실이 없다) */
export function heardEv(f: Fact | undefined): number {
  if (!f) return -1;
  const e = HEARD.get(f);
  return e === undefined ? -1 : e;
}
