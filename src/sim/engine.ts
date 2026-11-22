// SimulationEngine + SimulationClock
// 고정 시간 간격(0.2초 = 5Hz)으로만 진행한다. 배속은 "실제 1초에 몇 틱을 돌리는가"만 바꾸므로
// 어떤 배속으로 보든 같은 시드에서는 같은 결과가 나온다. 이 파일을 포함한 src/sim 은 DOM 에 의존하지 않는다.

import { generateCity } from './city';
import { endTraffic, initTraffic, tickTraffic } from './traffic';
import type { TrafficState } from './traffic';
import { buildReport } from './debrief';
import { tickPursuits } from './pursuit';
import { initDisaster, tickDisaster } from './disaster';
import type { DisasterState } from './disaster';
import { tickCalls } from './dispatch/callSystem';
import { tickDispatch } from './dispatch/dispatcher';
import { NORMAL, difficultyLabel, tuningOf } from './difficulty';
import type { Difficulty, Tuning } from './difficulty';
import { emit } from './events';
import { tickScene } from './field/sceneManager';
import { closeIncident, initGenerator, tickIncidents } from './incidents';
import type { GenState } from './incidents';
import { createRoster, tickUnits } from './resources';
import { announceCarry, applyCrewCarry, initCarry, readCarryover, shiftStartCounts, tickCarry } from './persist';      // (I2)
import type { CarryState } from './persist';
import type { Carryover, PlaceMark } from './types';      // (X6) · (I2)
import { tickWorld } from './world/consequence';      // (I1-b) 인과 규칙의 틀
import { initWorld } from './world/state';
import './world/rules';      // (I1-b) 인과 규칙을 등록한다 — 그 파일의 import 순서가 규칙의 순서다(= 결과)
import './world/laws';       // (I1-b b3-4) 일반 법칙(초과 위험 과정)을 등록한다 — 규칙 다음 줄. 그 파일의 import 순서가 법칙의 순서다(= 결과)
import { Rng, hashStr } from './rng';
import type { AirStats, Call, City, Incident, Responder, Scene, ShiftReport, SimEvent, Unit, Weather, WorldState } from './types';
import { WEATHER_NAME } from './util';

export const CITY_SEED = 0xc17e5eed;

/** 생성자의 셋째 인자 — 시험·확인용 조건 (교대가 시작되기 전에 정한다) */
export interface SimOpts {
  force?: string | null;         // 이 시나리오('유형/변형')를 교대 초반에 한 번 일으킨다
  carry?: Carryover | null;      // (I2) 이어받은 상태
  daily?: number;                // (N8 §5.4) 짧은 사건의 차례 수를 덮는다 (0 = 짧은 사건·비응급의 가려내기가 모두 꺼진다 — 시험 7a). 없으면 난이도의 값(tune.dailyCount)
}

export class Sim {
  readonly seed: string;
  readonly dt = 0.2;
  tick = 0;
  t = 0;
  readonly rng: Rng;
  readonly rngTraffic: Rng;
  readonly rngGen: Rng;
  readonly rngNuisance: Rng;
  readonly rngMajor: Rng;      // 대형 사고: 일어나는가, 언제, 무엇이
  readonly rngDaily: Rng;      // (N8 §5.4) 짧은 사건: 언제, 무엇이 (평소 추첨과 따로 — 평소 사건의 (시각·유형·변형·규모) 열을 흔들지 않는다)
  readonly weather: Weather;
  readonly startTod: number;
  readonly city: City;
  traffic: TrafficState;
  units: Unit[] = [];
  aidUsed = 0;                 // 이번 교대에 받은 인근 도시 지원 횟수
  /** 헬기 통계 (R1). 통계는 상태를 바꾸는 바로 그 코드에서 센다: 출동(resources.dispatchUnit), 공중 이송(startTransport), 연료 복귀(airRtb), 추적 시작(pursuit.ts) */
  airStats: AirStats = { sorties: 0, byKind: {}, hoists: 0, drops: 0, airLifts: 0, rtb: 0, tracked: 0, grounded: null };
  responders: Responder[] = [];
  incidents: Incident[] = [];
  scenes: (Scene | null)[] = [];
  calls: Call[] = [];
  activeCall = -1;
  events: SimEvent[] = [];
  logHash = 0;
  readonly shiftLen: number;
  readonly hardCap: number;
  ended = false;
  report: ShiftReport | null = null;
  gen: GenState;
  /** 재난 (없으면 null). disaster.ts 가 만들고 굴린다 */
  disaster: DisasterState | null = null;
  /** 지도에 남는 건물 상태 (X6): 건물 id → 그을림·폭발 흔적·구획 붕괴·전소·전체 붕괴. 교대마다 새 Sim 이므로 이어지지 않는다 — 도시 지도(city.places)는 고치지 않는다.
   *  채우는 것은 field/catastrophe.ts 의 상태를 바꾸는 자리(단계 3 부터) */
  placeMarks = new Map<number, PlaceMark>();
  /** (I1-b) 세계 상태: 구역(동네)의 전력·통신·수도·연기·위험, 병원의 수용, 인과 규칙의 신호·기록·쿨다운 (world/state.ts · world/consequence.ts).
   *  진실이다 — 관제·지휘관은 world/state.ts 의 known* 함수로만 안다. 교대마다 새로 만든다 */
  world: WorldState;
  /** (I2) 이어받은 상태 — 생성자의 입력(extra.carry)을 persist.readCarryover 가 검사해 새로 만든 것 (없으면 null). 시뮬레이션은 이것을 고치지 않는다 */
  readonly carry: Carryover | null;
  /** (I2) 이어받은 상태의 실행 중 상태 (persist.ts — 건물 겹침 표·복구 공사·적용 목록). 이어받은 상태가 없으면 on 이 거짓이고 아무것도 하지 않는다 */
  carryState: CarryState;
  /** 시험·확인용: 이 시나리오('유형/변형')를 교대 초반에 한 번 일으킨다 */
  readonly force: string | null;
  /** 교대 조건: 난이도 손잡이와 거기서 나온 수치 */
  readonly difficulty: Difficulty;
  readonly tune: Tuning;

  constructor(seed: string, difficulty: Difficulty = NORMAL, shiftLen = 1200, extra: SimOpts = {}) {
    this.force = extra.force ?? null;
    this.seed = seed;
    this.difficulty = { ...difficulty };
    const tn = tuningOf(this.difficulty);
    this.tune = extra.daily !== undefined ? { ...tn, dailyCount: Math.max(0, Math.floor(extra.daily)) } : tn;
    this.shiftLen = shiftLen;
    this.hardCap = shiftLen + 420;
    this.rng = new Rng(hashStr('AR:' + seed));
    this.rngTraffic = this.rng.fork('traffic');
    this.rngGen = this.rng.fork('incidents');
    this.rngNuisance = this.rng.fork('nuisance');
    this.rngMajor = this.rng.fork('major');
    this.rngDaily = this.rng.fork('daily');      // fork 는 부모를 소비하지 않는다 — 아래의 environment 흐름은 그대로
    const env = this.rng.fork('environment');
    this.weather = env.weighted<Weather>(['clear', 'rain', 'fog', 'night'], [0.5, 0.18, 0.12, 0.2]);
    this.startTod = this.weather === 'night' ? 22 * 3600 + env.int(0, 3000) : 9 * 3600 + env.int(0, 8 * 3600);
    this.city = generateCity(new Rng(CITY_SEED));
    this.world = initWorld(this);      // (I1-b) 난수를 쓰지 않는다 — 도시만 읽는다 (동네 18곳·병원)
    // (I2) 이어받은 상태: 검사하며 새 객체로 → ① 건물 겹침 표·도로 복구 통제(initTraffic 앞 — 불법 주차가 그 통제를 보고 놓인다) → ② 대원·부대·재고(createRoster 의 난수를 다 뽑은 뒤 값만)
    const rc = extra.carry ? readCarryover(extra.carry, this.city) : null;
    this.carry = rc ? rc.carry : null;
    this.carryState = initCarry(this, rc ? rc.dropped : []);
    this.traffic = initTraffic(this);
    createRoster(this);
    applyCrewCarry(this);
    this.gen = initGenerator(this.rngGen);
    this.gen.majorAt = this.rngMajor.chance(this.tune.majorProb) ? this.rngMajor.range(0.18, 0.7) * shiftLen : Infinity;
    if (this.tune.dailyCount > 0) this.gen.dailyAt = 30 + this.rngDaily.range(0, 60);      // (N8 §5.4) 첫 짧은 사건의 차례 (손잡이가 0 이면 Infinity 그대로 — 흐름을 쓰지 않는다)
    this.disaster = initDisaster(this);
    // 가용 인원: 이어받은 상태가 있으면 정비·결원(oos)인 부대와 결장(off)인 대원을 뺀다 (persist.shiftStartCounts). 없으면 지금 문구 그대로
    const avail = this.carryState.on ? shiftStartCounts(this) : `가용 부대 ${this.units.length}대, 대원 ${this.responders.length}명`;
    emit(this, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 2, text: `교대 시작. 날씨: ${WEATHER_NAME[this.weather]}. 난이도: ${difficultyLabel(this.difficulty)}. ${avail}. 시드 ${seed}.` });
    // 헬기가 뜨지 못하는 날씨 (createRoster 가 u.grounded 를 정했다 — 기록은 교대 시작 기록 뒤에 남긴다)
    if (this.units.some((u) => u.grounded === 'fog')) emit(this, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 1, text: '안개로 오늘 헬기는 뜨지 못합니다.' });
    else if (this.units.some((u) => u.grounded === 'night')) emit(this, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 1, text: '의료 헬기는 야간에 운항하지 않습니다.' });
    // ③ (I2) 이어받은 상태의 기록 — 적용 목록과 버린 것만 (이어받은 상태가 없으면 아무것도 남기지 않는다)
    announceCarry(this);
  }

  /** 화면에 표시하는 시각 (하루 기준 초) */
  get clock(): number { return this.startTod + this.t; }

  /** 시뮬레이션을 정확히 한 틱 진행한다. 하위 시스템 호출 순서는 고정이다. */
  step(): void {
    if (this.ended) return;
    this.tick++;
    this.t = this.tick * this.dt;
    tickTraffic(this);
    tickCarry(this);      // (I2) 정비 완료·복구 공사 개통 — 할 일이 없으면 첫 줄에서 돌아간다
    tickDisaster(this);
    tickWorld(this);      // (I1-b) 쌓인 신호를 인과 규칙에 건넨다 · 1초마다 world tick 규칙과 회복 — 이 자리(재난 다음, 사건 생성 앞)를 바꾸지 않는다
    tickIncidents(this);
    tickCalls(this);
    tickDispatch(this);
    tickUnits(this);
    tickPursuits(this);
    for (let i = 0; i < this.scenes.length; i++) { const s = this.scenes[i]; if (s) tickScene(this, s); }
    this.checkShiftEnd();
  }

  private checkShiftEnd(): void {
    if (this.t < this.shiftLen) return;
    const open = this.incidents.filter((I) => I.phase !== 'closed');
    if (open.length && this.t < this.hardCap) return;
    for (const I of open) closeIncident(this, I, 'shiftend');
    endTraffic(this);      // 남은 행사 인파의 혼잡을 거둔다 (결과 불변 — 교대가 끝난 뒤에는 아무것도 돌지 않는다)
    this.ended = true;
    this.report = buildReport(this);
    emit(this, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 3, text: `교대 종료. 사건 ${this.report.totalIncidents}건 처리.` });
    this.report.hash = this.logHash.toString(16);
  }

  /** 여러 틱을 연속 진행 (헤드리스 실행·빠른 복원용) */
  run(ticks: number): void { for (let i = 0; i < ticks && !this.ended; i++) this.step(); }
  runToEnd(maxTicks = 20000): void { let n = 0; while (!this.ended && n++ < maxTicks) this.step(); }
}
