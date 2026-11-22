// 시뮬레이션 실행기 (표현 계층).
// 실제 시간 → 시뮬레이션 틱 변환만 담당한다. 배속은 "1초에 몇 틱"만 바꾸고, 시뮬레이션 결과에는 영향을 주지 않는다.
// (I2 단계 6 §5.3) 조직의 저장도 여기서만 한다 — src/sim 은 저장소를 모른다. 이어받은 상태는 교대의 **입력**이고(시드·난이도와 함께),
// 되감기·새로고침 복원·같은 입력 재실행은 늘 그 입력으로 처음부터 다시 돌린다. 저장 실패는 조용히 넘기고 이 창 안의 사본(orgMem)으로 이어 간다.

import { NORMAL, difficultyLabel, parseDifficulty, parseDisaster, validDifficulty } from '../sim/difficulty';
import type { Difficulty } from '../sim/difficulty';
import { CITY_SEED, Sim } from '../sim/engine';
import { generateCity } from '../sim/city';
import { makeCarryover, readCarryover } from '../sim/persist';
import { Rng } from '../sim/rng';
import type { Carryover, City, ShiftReport } from '../sim/types';

const LS_SETTINGS = 'ar.settings.v1';
const LS_CURRENT = 'ar.current.v1';
const LS_HISTORY = 'ar.history.v1';
/** (I2) 저장된 조직: { id, carry, savedAt } — 끝난 교대가 만든 "다음 교대가 이어받을 상태" */
const LS_ORG = 'ar.org.v1';
/** (I2) 지금 교대의 입력: { seed, diff, carry, org, write, mode, baseShift } — 교대를 시작할 때 한 번만 쓴다 (이어받은 상태가 10~20KB 라 2.5초마다 다시 쓰지 않는다) */
const LS_INPUT = 'ar.input.v1';

/** 교대를 시작하는 방법: 저장된 조직을 이어서 · 새 조직으로 · 지금 교대와 같은 입력으로 다시 보기(저장하지 않는다) */
export type StartMode = 'continue' | 'fresh' | 'replay';
export interface Settings { speed: number; autoCam: boolean; truthView: boolean; difficulty: Difficulty; sound: boolean; volume: number; autoSlow: boolean; sceneAuto: boolean; org: 'continue' | 'fresh' }
export interface HistoryItem { seed: string; when: number; summary: string; counts: Record<string, number>; incidents: number; hash: string; difficulty?: string; shift?: number }
export interface SavedOrg { id: string; carry: Carryover; savedAt?: number }
interface InputRec { seed: string; diff: Difficulty; carry: Carryover | null; org: string | null; write: boolean; mode: StartMode; baseShift: number }
/** 저장된 조직의 상태 (난이도 창·상단 칩): 없음 · 읽음 · 읽지 못함(판이 다르거나 깨짐) */
export interface OrgStatus { kind: 'none' | 'ok' | 'bad'; org: SavedOrg | null; memOnly: boolean }

function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
/** 저장 — 실패해도(사생활 보호 창·용량·막힌 저장소) 조용히 넘기고 거짓을 돌려준다 */
function lsSet(key: string, v: unknown): boolean { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }
function lsDel(key: string): void { try { localStorage.removeItem(key); } catch { /* 저장소를 못 쓰면 지울 것도 없다 */ } }
/** 키 순서와 무관한 비교 (복원할 때 저장된 입력이 지금 교대의 것인지) */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
/** 도시 지도 (이어받은 상태를 검사할 때의 지문 — 모든 Sim 이 함께 쓰는 지도와 같다) */
let cityCache: City | null = null;
const cityOf = (): City => (cityCache ??= generateCity(new Rng(CITY_SEED)));

export function randomSeed(): string {
  // 시드 "선택"은 시뮬레이션 밖의 일이다. 일단 정해진 시드 안에서는 모든 것이 결정적이다.
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export class Runner {
  sim: Sim;
  settings: Settings;
  paused = false;
  alpha = 0;                  // 렌더 보간 계수 (0..1)
  private acc = 0;
  private last = 0;
  private lastSave = 0;
  version = 0;                // 새 교대가 시작될 때마다 증가 (UI 상태 초기화용)
  restoredTicks = 0;
  seeks = 0;                  // 되감기 횟수 (표현 계층이 다시 맞추는 데 쓴다)
  fps = 60;
  simMs = 0;
  slowUntil = 0;              // 이 시각(실제 시간, ms)까지는 1배속으로 낮춘다 (결정적 순간 자동 감속)
  nowMs = 0;
  force: string | null = null;
  /** (G5) 틱마다 불리는 감속 검사: 참이면 이 프레임의 남은 틱을 버린다(결정적 순간의 첫 틱부터 1배속). 한 프레임에 도는 틱 수만 바뀌므로 결과는 같다 */
  stepGuard: ((sim: Sim) => boolean) | null = null;
  // ── (I2 §5.3) 조직 ──
  /** 지금 교대의 입력: 이어받은 상태 (없으면 새 조직). make() 가 늘 이것을 넘긴다 — 되감기·복원도 같은 입력 */
  carryIn: Carryover | null = null;
  /** 조직의 계보 (새 조직을 시작할 때 만든다 — 주소로 고정한 실행은 null) */
  orgId: string | null = null;
  /** 이 교대가 끝나면 조직을 저장하는가 (같은 입력 재실행·주소 고정 실행·이미 저장한 교대는 거짓) */
  writeOrg = false;
  startMode: StartMode = 'fresh';
  /** 이 교대가 시작할 때의 조직 교대 번호 (= carryIn?.shift ?? 1) */
  baseShift = 1;
  /** 이 교대의 끝 처리(이전 교대 기록·조직 저장)를 했는가 */
  settled = false;
  /** 저장소가 안 될 때 이 창이 열려 있는 동안만 쓰는 사본 (저장이 되면 저장소와 같다) */
  orgMem: SavedOrg | null = null;
  /** 이 교대의 끝 처리 결과 (보고서가 말한다): saved 저장함 · conflict 다른 창이 먼저 진행 · skipped 저장하지 않는 교대 · null 아직 */
  orgResult: 'saved' | 'conflict' | 'skipped' | null = null;
  /** 저장소에 쓰지 못한 적이 있다 (이 창 안의 사본으로만 이어진다) */
  storageFailed = false;
  private make(seed: string, d: Difficulty): Sim { return new Sim(seed, d, 1200, { force: this.force, carry: this.carryIn }); }

  constructor() {
    this.settings = { speed: 3, autoCam: true, truthView: true, difficulty: { ...NORMAL }, sound: true, volume: 0.5, autoSlow: true, sceneAuto: true, org: 'continue', ...lsGet<Partial<Settings>>(LS_SETTINGS, {}) };
    if (this.settings.org !== 'fresh') this.settings.org = 'continue';
    // 화면에서는 재난의 기본값이 '무작위'(드물게)다. 헤드리스 실행(sweep·테스트)의 기본값은 '없음'
    this.settings.difficulty = { ...NORMAL, disaster: 'random', ...(this.settings.difficulty ?? {}) };
    if (!validDifficulty(this.settings.difficulty)) this.settings.difficulty = { ...NORMAL, disaster: 'random' };
    const url = new URL(window.location.href);
    const urlSeed = url.searchParams.get('seed');
    const urlDiff = parseDifficulty(url.searchParams.get('diff'));
    const urlDisaster = parseDisaster(url.searchParams.get('disaster'));
    const urlOrg = url.searchParams.get('org');
    this.force = url.searchParams.get('force');      // 확인용: ?force=armed/bomb — 그 시나리오를 교대 초반에 한 번 일으킨다
    if (urlDiff) this.settings.difficulty = { ...urlDiff, disaster: urlDisaster ?? 'none' };      // 주소로 조건을 고정하면 재난도 주소대로(없으면 없음)
    else if (urlDisaster) this.settings.difficulty = { ...this.settings.difficulty, disaster: urlDisaster };
    const cur = lsGet<{ seed: string; tick: number; diff?: Difficulty } | null>(LS_CURRENT, null);
    if (urlSeed || urlDiff || urlDisaster || this.force || urlOrg) {
      // 주소로 조건을 고정한 실행 (화면 확인·자동 검사가 재현돼야 한다): 새 조직으로 시작하고 저장하지 않는다. ?org=continue 면 저장된 조직으로 (저장은 하지 않는다)
      const saved = urlOrg === 'continue' ? this.readOrg() : null;
      this.carryIn = saved ? saved.carry : null; this.orgId = saved ? saved.id : null;
      this.writeOrg = false; this.startMode = saved ? 'continue' : 'fresh'; this.baseShift = this.carryIn ? this.carryIn.shift : 1;
      this.sim = this.make(urlSeed || randomSeed(), this.settings.difficulty);
      this.saveInput();
    } else if (cur && cur.seed && cur.tick > 0) {
      // 새로고침 복원: 같은 입력(시드·난이도·이어받은 상태)으로 같은 틱까지 다시 돌리면 정확히 같은 상태가 된다.
      // 저장된 입력이 이 교대의 것이 아니면(시드·난이도가 다르다) 이어받은 상태 없이 — 모르는 입력으로 돌린 교대는 조직에 저장하지 않는다
      const diff = { ...NORMAL, ...(cur.diff ?? {}) };
      const inp = lsGet<InputRec | null>(LS_INPUT, null);
      if (inp && inp.seed === cur.seed && canon(inp.diff) === canon(cur.diff) && (inp.carry === null || readCarryover(inp.carry, cityOf()) !== null)) {
        this.carryIn = inp.carry; this.orgId = inp.org ?? null; this.writeOrg = inp.write === true;
        this.startMode = inp.mode === 'continue' || inp.mode === 'replay' ? inp.mode : 'fresh';
        this.baseShift = this.carryIn ? this.carryIn.shift : 1;
      }
      this.sim = this.make(cur.seed, diff);
      this.sim.run(cur.tick);
      this.restoredTicks = cur.tick;
    } else {
      // 첫 화면 (주소도 복원도 없음): 설정의 시작 방법(기본 '이어서') — 저장된 조직이 없으면 새 조직으로 시작해 끝나면 저장한다
      this.begin(this.settings.org);
      this.sim = this.make(randomSeed(), this.settings.difficulty);
      this.saveInput();
    }
  }

  // ───────────────────────── 조직 (I2 §5.3) ─────────────────────────
  /**
   * 저장된 조직을 읽는다 (판·모양을 readCarryover 로 검사 — 읽지 못하면 null). 저장소가 먼저이고, 저장소가 비었거나 쓰지 못했으면 이 창의 사본.
   * 같은 계보의 둘이면 더 나아간 쪽 (용량 초과로 저장소가 뒤처졌을 때)
   */
  readOrg(): SavedOrg | null {
    const raw = lsGet<{ id?: unknown; carry?: unknown; savedAt?: unknown } | null>(LS_ORG, null);
    const ls = raw && typeof raw.id === 'string' && readCarryover(raw.carry, cityOf()) ? { id: raw.id, carry: raw.carry as Carryover, savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : undefined } : null;
    const mem = this.orgMem;
    if (ls && mem && ls.id === mem.id) return ls.carry.shift >= mem.carry.shift ? ls : mem;
    return ls ?? mem;
  }
  /** 난이도 창·상단 칩이 보는 저장된 조직의 상태 (읽기만) */
  orgStatus(): OrgStatus {
    const org = this.readOrg();
    if (org) return { kind: 'ok', org, memOnly: org === this.orgMem && this.storageFailed };
    const raw = lsGet<unknown>(LS_ORG, null);
    return { kind: raw ? 'bad' : 'none', org: null, memOnly: false };
  }
  /** 저장된 조직 지우기 (난이도 창 — 확인 한 번). 진행 중인 교대의 입력은 그대로다 */
  clearOrg(): void { lsDel(LS_ORG); this.orgMem = null; }
  /**
   * 입력을 정하는 한 곳: continue — 저장된 조직(없으면 새 계보) · fresh — 이어받은 상태 없이 새 계보 · replay — 지금 교대의 입력 그대로(저장하지 않는다).
   * 끝나면 저장하는 것은 continue·fresh 뿐이다
   */
  private begin(mode: StartMode): void {
    if (mode === 'continue') { const saved = this.readOrg(); this.carryIn = saved ? saved.carry : null; this.orgId = saved ? saved.id : randomSeed(); this.writeOrg = true; }
    else if (mode === 'fresh') { this.carryIn = null; this.orgId = randomSeed(); this.writeOrg = true; }
    else this.writeOrg = false;
    this.startMode = mode; this.baseShift = this.carryIn ? this.carryIn.shift : 1; this.settled = false; this.orgResult = null;
  }
  /** 지금 교대의 입력을 한 번 저장한다 (새로고침 복원이 같은 입력으로 다시 돌린다) */
  private saveInput(): void {
    const rec: InputRec = { seed: this.sim.seed, diff: this.sim.difficulty, carry: this.carryIn, org: this.orgId, write: this.writeOrg, mode: this.startMode, baseShift: this.baseShift };
    lsSet(LS_INPUT, rec);
  }

  /**
   * 새 교대. 난이도를 넘기면 그 조건으로 시작하고 다음 교대의 기본값으로도 저장한다.
   * mode: 시작 방법 (없으면 설정의 '이어서'·'새 조직'). 'replay' 는 지금 교대와 같은 조직 상태로 (저장하지 않는다)
   */
  newShift(seed?: string, difficulty?: Difficulty, mode?: StartMode): void {
    if (difficulty) { this.settings.difficulty = { ...difficulty }; this.saveSettings(); }
    this.begin(mode ?? this.settings.org);
    this.sim = this.make(seed && seed.trim() ? seed.trim() : randomSeed(), this.settings.difficulty);
    this.acc = 0; this.alpha = 0; this.paused = false; this.version++; this.restoredTicks = 0;
    lsSet(LS_CURRENT, { seed: this.sim.seed, tick: 0, diff: this.sim.difficulty });
    this.saveInput();
  }

  /**
   * 원하는 틱으로 이동한다. 앞으로는 그만큼 더 돌리고, 뒤로는 같은 입력(시드·난이도·이어받은 상태)으로 처음부터 그 틱까지 다시 돌린다.
   * 결정적 시뮬레이션이라 되돌아간 뒤의 전개도 처음과 똑같다(되감기는 관찰일 뿐 개입이 아니다).
   */
  seek(tick: number): void {
    const target = Math.max(0, Math.round(tick));
    if (target >= this.sim.tick) this.sim.run(target - this.sim.tick);
    else { const s = this.make(this.sim.seed, this.sim.difficulty); s.run(target); this.sim = s; }
    this.acc = 0; this.alpha = 0; this.seeks++;
    this.settle();      // 시각 이동으로 교대가 끝났어도 기록·저장이 빠지지 않게
  }

  /** 결정적 순간: 잠깐 1배속으로 낮춘다. 배속만 바꾸므로 시뮬레이션 결과에는 영향이 없다. */
  drama(ms = 3400): void { if (this.settings.autoSlow && this.settings.speed > 1) this.slowUntil = Math.max(this.slowUntil, this.nowMs + ms); }
  get slowed(): boolean { return this.settings.autoSlow && this.settings.speed > 1 && !this.paused && this.nowMs < this.slowUntil; }
  setSpeed(v: number): void { this.settings.speed = v; this.paused = false; this.saveSettings(); }
  togglePause(): void { this.paused = !this.paused; }
  saveSettings(): void { lsSet(LS_SETTINGS, this.settings); }

  history(): HistoryItem[] { return lsGet<HistoryItem[]>(LS_HISTORY, []); }
  private pushHistory(r: ShiftReport): void {
    const h = this.history();
    if (h.length && h[0].seed === r.seed && h[0].hash === r.hash) return;
    h.unshift({ seed: r.seed, when: Date.now(), summary: r.summary[0] ?? '', counts: r.counts, incidents: r.totalIncidents, hash: r.hash, difficulty: difficultyLabel(r.difficulty), shift: this.orgId ? this.baseShift : undefined });
    lsSet(LS_HISTORY, h.slice(0, 12));
  }
  /**
   * 교대의 끝 처리 — 한 번만 (frame·seek 끝에서): 이전 교대 기록 · 진행 저장 지우기 · 조직 저장.
   * 저장 조건: 저장된 조직이 없거나(읽지 못함 포함) · 새 조직으로 시작했거나 · 저장된 조직이 이 교대가 이어받은 그 상태 그대로다(다른 창이 그 사이에 앞으로 보내지 않았다)
   */
  private settle(): void {
    const sim = this.sim;
    if (!sim.ended || !sim.report || this.settled) return;
    this.settled = true;
    this.pushHistory(sim.report);
    lsSet(LS_CURRENT, { seed: sim.seed, tick: 0, diff: sim.difficulty });
    if (this.writeOrg && this.orgId) {
      const next = makeCarryover(sim);
      const saved = this.readOrg();
      if (!saved || this.startMode === 'fresh' || (saved.id === this.orgId && saved.carry.shift === this.baseShift)) {
        const rec: SavedOrg = { id: this.orgId, carry: next, savedAt: Date.now() };
        if (!lsSet(LS_ORG, rec)) this.storageFailed = true;
        this.orgMem = { id: this.orgId, carry: next };
        this.orgResult = 'saved';
      } else this.orgResult = 'conflict';
    } else this.orgResult = 'skipped';
    this.writeOrg = false;      // 같은 교대가 두 번 저장하지 않게 (되감아 다시 끝까지 가도 같은 입력의 같은 결과다)
  }

  /** requestAnimationFrame 마다 호출 */
  frame(nowMs: number): void {
    if (!this.last) this.last = nowMs;
    const dtReal = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    if (dtReal > 0) this.fps = this.fps * 0.95 + (1 / dtReal) * 0.05;
    this.nowMs = nowMs;
    const sim = this.sim;
    if (!this.paused && !sim.ended) {
      this.acc += dtReal * (this.slowed ? 1 : this.settings.speed);
      const t0 = performance.now();
      let steps = 0;
      while (this.acc >= sim.dt && steps < 40 && !sim.ended) { sim.step(); this.acc -= sim.dt; steps++; if (this.stepGuard && this.stepGuard(sim)) { this.acc = 0; break; } }
      if (steps >= 40) this.acc = 0;
      if (steps) this.simMs = this.simMs * 0.9 + (performance.now() - t0) * 0.1;
      this.alpha = Math.min(1, this.acc / sim.dt);
    }
    this.settle();
    if (nowMs - this.lastSave > 2500 && !sim.ended) { this.lastSave = nowMs; lsSet(LS_CURRENT, { seed: sim.seed, tick: sim.tick, diff: sim.difficulty }); }
  }
}
