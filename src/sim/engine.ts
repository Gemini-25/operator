// SimulationEngine + SimulationClock
// 고정 시간 간격(0.2초 = 5Hz)으로만 진행한다. 배속은 "실제 1초에 몇 틱을 돌리는가"만 바꾸므로
// 어떤 배속으로 보든 같은 시드에서는 같은 결과가 나온다. 이 파일을 포함한 src/sim 은 DOM 에 의존하지 않는다.

import { generateCity, initTraffic, tickTraffic } from './city';
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
import { Rng, hashStr } from './rng';
import type { Call, City, Incident, Responder, Scene, ShiftReport, SimEvent, Unit, Weather } from './types';
import { WEATHER_NAME } from './util';

export const CITY_SEED = 0xc17e5eed;

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
  readonly weather: Weather;
  readonly startTod: number;
  readonly city: City;
  traffic: ReturnType<typeof initTraffic>;
  units: Unit[] = [];
  aidUsed = 0;                 // 이번 교대에 받은 인근 도시 지원 횟수
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
  /** 시험·확인용: 이 시나리오('유형/변형')를 교대 초반에 한 번 일으킨다 */
  readonly force: string | null;
  /** 교대 조건: 난이도 손잡이와 거기서 나온 수치 */
  readonly difficulty: Difficulty;
  readonly tune: Tuning;

  constructor(seed: string, difficulty: Difficulty = NORMAL, shiftLen = 1200, extra: { force?: string | null } = {}) {
    this.force = extra.force ?? null;
    this.seed = seed;
    this.difficulty = { ...difficulty };
    this.tune = tuningOf(this.difficulty);
    this.shiftLen = shiftLen;
    this.hardCap = shiftLen + 420;
    this.rng = new Rng(hashStr('AR:' + seed));
    this.rngTraffic = this.rng.fork('traffic');
    this.rngGen = this.rng.fork('incidents');
    this.rngNuisance = this.rng.fork('nuisance');
    this.rngMajor = this.rng.fork('major');
    const env = this.rng.fork('environment');
    this.weather = env.weighted<Weather>(['clear', 'rain', 'fog', 'night'], [0.5, 0.18, 0.12, 0.2]);
    this.startTod = this.weather === 'night' ? 22 * 3600 + env.int(0, 3000) : 9 * 3600 + env.int(0, 8 * 3600);
    this.city = generateCity(new Rng(CITY_SEED));
    this.traffic = initTraffic(this.rngTraffic);
    createRoster(this);
    this.gen = initGenerator(this.rngGen);
    this.gen.majorAt = this.rngMajor.chance(this.tune.majorProb) ? this.rngMajor.range(0.18, 0.7) * shiftLen : Infinity;
    this.disaster = initDisaster(this);
    emit(this, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 2, text: `교대 시작. 날씨: ${WEATHER_NAME[this.weather]}. 난이도: ${difficultyLabel(this.difficulty)}. 가용 부대 ${this.units.length}대, 대원 ${this.responders.length}명. 시드 ${seed}.` });
  }

  /** 화면에 표시하는 시각 (하루 기준 초) */
  get clock(): number { return this.startTod + this.t; }

  /** 시뮬레이션을 정확히 한 틱 진행한다. 하위 시스템 호출 순서는 고정이다. */
  step(): void {
    if (this.ended) return;
    this.tick++;
    this.t = this.tick * this.dt;
    tickTraffic(this);
    tickDisaster(this);
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
    this.ended = true;
    this.report = buildReport(this);
    emit(this, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 3, text: `교대 종료. 사건 ${this.report.totalIncidents}건 처리.` });
    this.report.hash = this.logHash.toString(16);
  }

  /** 여러 틱을 연속 진행 (헤드리스 실행·빠른 복원용) */
  run(ticks: number): void { for (let i = 0; i < ticks && !this.ended; i++) this.step(); }
  runToEnd(maxTicks = 20000): void { let n = 0; while (!this.ended && n++ < maxTicks) this.step(); }
}
