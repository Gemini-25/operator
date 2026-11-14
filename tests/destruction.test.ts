// N7 현장 파손: 총격·폭발·열에 창이 깨지고 엄폐 가구가 닳아 부서진다 (src/sim/field/damage.ts)
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { DECOR_HP, bulletPath, breakGlass, coverTile, damageDecor, dmgRng, heatGlass, hitCover, shatter } from '../src/sim/field/damage';
import { addProp, baseScene, set } from '../src/sim/field/kit';
import { blast, flashbang } from '../src/sim/field/hazards';
import { DECOR, T } from '../src/sim/types';
import type { Scene } from '../src/sim/types';

/**
 * 손으로 만든 방 하나: x 5~15, y 5~11 이 벽, 그 안이 바닥.
 * 남쪽 벽(y 11)의 x 8·12 와 북쪽 벽(y 5)의 x 10 이 창이다. 건물 밖은 땅.
 */
function room(seed = 'DMG'): { sim: Sim; s: Scene; at: (x: number, y: number) => number } {
  const sim = new Sim(seed);
  const s = baseScene(sim, { id: 0, truth: { type: 'armed', variant: 'test' } } as never, sim.rng.fork('room'));
  for (let y = 5; y <= 11; y++) for (let x = 5; x <= 15; x++) set(s, x, y, x === 5 || x === 15 || y === 5 || y === 11 ? T.WALL : T.FLOOR);
  for (const [x, y] of [[8, 11], [12, 11], [10, 5]]) set(s, x, y, T.WINDOW);
  return { sim, s, at: (x, y) => y * s.w + x };
}
function furn(s: Scene, x: number, y: number, d: number): number { const i = y * s.w + x; s.tiles[i] = T.FURN; s.decor[i] = d; s.fuel[i] = 1; return i; }

/** 대기 지점에서 걸어서 닿지 못하는 바닥 칸의 수 (tests/sim.test.ts '현장 배치의 다양성' 과 같은 방식: 문·계단을 지나고, 잔해와 잠긴 문은 치우거나 열 수 있다고 본다) */
function cutFloors(sc: Scene): number {
  const w = sc.w, seen = new Uint8Array(sc.w * sc.h);
  const pass = (i: number): boolean => { const t = sc.tiles[i]; return t === T.FLOOR || t === T.DOOR || t === T.GROUND || t === T.ROAD || t === T.STAIR; };
  const st = [sc.staging.y * w + sc.staging.x]; seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!, x = c % w, y = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= sc.h) continue; const j = ny * w + nx; if (!seen[j] && pass(j)) { seen[j] = 1; st.push(j); } }
    const sl = sc.stairTo[c]; if (sl >= 0 && !seen[sl]) { seen[sl] = 1; st.push(sl); }
  }
  let cut = 0; for (let i = 0; i < seen.length; i++) if (sc.tiles[i] === T.FLOOR && !seen[i]) cut++;
  return cut;
}
/** 파손 자료의 불변 조건: 깨진 창은 창 칸에만, 닳은 가구는 가구 칸에만, 부서진 가구는 (무엇의 잔해인지 남은) 바닥 칸에만 */
function tally(sc: Scene): { glass: number; worn: number; wrecked: number } {
  let glass = 0, worn = 0, wrecked = 0;
  for (let i = 0; i < sc.tiles.length; i++) {
    if (sc.glass[i]) { glass++; expect(sc.tiles[i], '깨진 창 칸').toBe(T.WINDOW); }
    const d = sc.decorHp[i];
    if (d === 255) { wrecked++; expect(sc.tiles[i], '부서진 가구 칸').toBe(T.FLOOR); expect(sc.decor[i]).toBeGreaterThan(0); }
    else if (d > 0) { worn++; expect(sc.tiles[i], '닳은 가구 칸').toBe(T.FURN); expect(d).toBeLessThanOrEqual(200); }
  }
  return { glass, worn, wrecked };
}

describe('현장 파손 — 규칙', () => {
  it('창은 한 번만 깨지고, 창이 아닌 칸은 깨지지 않는다', () => {
    const { sim, s, at } = room();
    const v0 = s.staticVersion, w = at(8, 11);
    expect(breakGlass(sim, s, w)).toBe(true);
    expect(s.glass[w]).toBe(1);
    expect(s.staticVersion).toBeGreaterThan(v0);
    expect(s.fx.filter((f) => f.kind === 'glass').length).toBe(1);
    const v1 = s.staticVersion;
    expect(breakGlass(sim, s, w)).toBe(false);                 // 이미 깨졌다
    expect(breakGlass(sim, s, at(9, 11))).toBe(false);         // 벽
    expect(breakGlass(sim, s, at(9, 8))).toBe(false);          // 바닥
    expect(breakGlass(sim, s, -1)).toBe(false);
    expect(s.staticVersion).toBe(v1);
    expect(s.glass.reduce((a, b) => a + b, 0)).toBe(1);
    expect(s.tiles[w]).toBe(T.WINDOW);                         // 깨져도 창은 창이다 (지나갈 수 없다)
  });

  it('가구는 내구만큼 맞아야 부서지고, 부서지면 바닥이 된다', () => {
    for (const key of Object.keys(DECOR_HP)) {
      const kind = Number(key), hp = DECOR_HP[kind];
      const { sim, s, at } = room();
      const i = furn(s, 10, 6, kind);
      for (let k = 1; k < hp; k++) {
        expect(damageDecor(sim, s, i, 1), `DECOR ${kind} ${k}번째`).toBe(false);
        expect(s.tiles[i]).toBe(T.FURN);
        expect(s.decorHp[i]).toBe(k);
      }
      const v = s.staticVersion;
      expect(damageDecor(sim, s, i, 1), `DECOR ${kind} 마지막`).toBe(true);
      expect(s.tiles[i]).toBe(T.FLOOR);
      expect(s.decorHp[i]).toBe(255);
      expect(s.decor[i]).toBe(kind);                           // 무엇의 잔해인지 남는다
      expect(s.fuel[i]).toBeCloseTo(0.5);
      expect(s.staticVersion).toBeGreaterThan(v);
      expect(s.fx.filter((f) => f.kind === 'debris').length).toBe(1);
      expect(damageDecor(sim, s, i, 1)).toBe(false);           // 이미 바닥이다
      expect(damageDecor(sim, s, at(9, 8), 5)).toBe(false);    // 가구가 아닌 칸
    }
    // 모든 가구 종류에 내구가 있다
    for (const d of Object.values(DECOR)) if (d !== DECOR.NONE) expect(DECOR_HP[d], `DECOR ${d}`).toBeGreaterThan(0);
  });

  it('가구와 벽에 둘러싸인 가구는 부서져도 닿지 못하는 바닥을 만들지 않는다', () => {
    const { sim, s } = room();
    s.staging = { x: 10, y: 8 };                               // 문이 없는 방이라 닿는지는 방 안에서 잰다
    // 북서쪽 구석(6,6): 위와 왼쪽은 벽, 오른쪽과 아래는 다른 가구
    const corner = furn(s, 6, 6, DECOR.PLANT), right = furn(s, 7, 6, DECOR.MACHINE);
    furn(s, 6, 7, DECOR.MACHINE);
    expect(cutFloors(s)).toBe(0);
    expect(damageDecor(sim, s, corner, 3)).toBe(false);
    expect(s.tiles[corner]).toBe(T.FURN);
    expect(s.decorHp[corner]).toBe(200);                       // 부서지기 직전에서 멈춘다
    expect(cutFloors(s)).toBe(0);
    // 둘러싼 가구가 먼저 부서지면 그다음 피해에 부서진다
    expect(damageDecor(sim, s, right, 6)).toBe(true);
    expect(damageDecor(sim, s, corner, 1)).toBe(true);
    expect(s.tiles[corner]).toBe(T.FLOOR);
    expect(cutFloors(s)).toBe(0);
  });

  it('탄도: 선 위의 창은 깨지고, 벽 뒤의 창은 깨지지 않는다', () => {
    {
      // 건물 밖(8,14)에서 안(8,7)으로: 남쪽 창(8,11)을 지난다
      const { sim, s, at } = room();
      bulletPath(sim, s, 8, 14, 8, 7, 0);
      expect(s.glass[at(8, 11)]).toBe(1);
      expect(s.glass[at(12, 11)]).toBe(0);
      expect(s.glass[at(10, 5)]).toBe(0);
    }
    {
      // 안쪽 벽(10,8) 뒤의 북쪽 창(10,5): 벽에 막혀 닿지 않는다
      const { sim, s, at } = room();
      set(s, 10, 8, T.WALL);
      bulletPath(sim, s, 10, 10, 10, 3, 0);
      expect(s.glass[at(10, 5)]).toBe(0);
      // 벽을 치우면 같은 탄도에 깨진다
      set(s, 10, 8, T.FLOOR);
      bulletPath(sim, s, 10, 10, 10, 3, 0);
      expect(s.glass[at(10, 5)]).toBe(1);
    }
    {
      // 맞은 탄은 목표에서 멈추고, 빗나간 탄은 목표를 지나쳐 창까지 간다
      const { sim, s, at } = room();
      bulletPath(sim, s, 12, 6, 12, 9, 0);
      expect(s.glass[at(12, 11)]).toBe(0);
      bulletPath(sim, s, 12, 6, 12, 9, 3);
      expect(s.glass[at(12, 11)]).toBe(1);
    }
    {
      // 닫힌 문은 막고, 열린 문은 지나간다
      const { sim, s, at } = room();
      for (let x = 6; x <= 14; x++) set(s, x, 8, T.WALL);
      set(s, 12, 8, T.DOOR);
      const door = addProp(s, 'door', 12, 8, { open: false });
      bulletPath(sim, s, 12, 6, 12, 13, 0);
      expect(s.glass[at(12, 11)]).toBe(0);
      door.open = true;
      bulletPath(sim, s, 12, 6, 12, 13, 0);
      expect(s.glass[at(12, 11)]).toBe(1);
    }
  });

  it('엄폐 가구: 받은 사람과 쏜 사람 사이의 바로 옆 가구를 찾고, 빗나간 탄에 닳다가 부서지면 한 번 기록한다', () => {
    const { sim, s, at } = room();
    const sofa = furn(s, 10, 8, DECOR.SOFA);
    expect(coverTile(s, 9, 8, 13, 8)).toBe(sofa);              // 오른쪽에서 쏜다: 오른쪽 옆 가구
    expect(coverTile(s, 9, 8, 6, 8)).toBe(-1);                 // 반대쪽에서 쏘면 엄폐가 아니다
    expect(coverTile(s, 10, 9, 10, 6)).toBe(sofa);             // 위에서 쏜다: 위쪽 옆 가구
    expect(coverTile(s, 9, 9, 13, 6)).toBe(sofa);              // 대각선: 모서리 칸
    expect(coverTile(s, 13, 9, 13, 6)).toBe(-1);
    // 빗나간 탄이 쌓이면 부서지고, 기록은 가구가 부서졌을 때만 남는다
    const n0 = sim.events.length;
    let shots = 0;
    while (s.tiles[sofa] === T.FURN && shots < 60) { hitCover(sim, s, 9, 8, 13, 8); shots++; }
    expect(s.tiles[sofa]).toBe(T.FLOOR);
    expect(shots).toBeGreaterThanOrEqual(DECOR_HP[DECOR.SOFA]);
    const logs = sim.events.slice(n0);
    expect(logs.length).toBe(1);
    expect(logs[0].text).toContain('소파가 부서져 엄폐물이 사라졌습니다');
    expect(coverTile(s, 9, 8, 13, 8)).toBe(-1);                // 이제 엄폐가 아니다
    // 같은 현장에서 10초 안에는 다시 기록하지 않는다
    const desk = furn(s, 10, 9, DECOR.PLANT);
    for (let k = 0; k < 40 && s.tiles[desk] === T.FURN; k++) hitCover(sim, s, 9, 9, 13, 9);
    expect(s.tiles[desk]).toBe(T.FLOOR);
    expect(sim.events.length).toBe(n0 + 1);
    void at;
  });

  it('섬광탄은 가까운 창만, 폭발은 반경 안의 창과 가구를 부순다. 빈 공간 너머(다른 층)에는 미치지 않는다', () => {
    {
      const { sim, s, at } = room();
      const plant = furn(s, 9, 10, DECOR.PLANT);
      flashbang(sim, s, 8, 9.5);
      expect(s.glass[at(8, 11)]).toBe(1);                      // 1.5칸
      expect(s.glass[at(12, 11)]).toBe(0);                     // 4칸 넘게 떨어져 있다
      expect(s.tiles[plant]).toBe(T.FURN);                     // 섬광탄은 가구를 부수지 않는다
      expect(s.decorHp[plant]).toBe(0);
    }
    {
      const { sim, s, at } = room();
      const plant = furn(s, 9, 10, DECOR.PLANT), sofa = furn(s, 11, 10, DECOR.SOFA), machine = furn(s, 10, 6, DECOR.MACHINE), far = furn(s, 14, 6, DECOR.PLANT);
      blast(sim, s, { id: 0 } as never, 10, 9, 3.6, 0, -1);
      expect(s.glass[at(8, 11)]).toBe(1); expect(s.glass[at(12, 11)]).toBe(1); expect(s.glass[at(10, 5)]).toBe(1);
      expect(s.tiles[plant]).toBe(T.FLOOR); expect(s.tiles[sofa]).toBe(T.FLOOR);      // 내구 1·3: 피해 3 에 부서진다
      expect(s.tiles[machine]).toBe(T.FURN); expect(s.decorHp[machine]).toBe(0);       // 3칸 떨어진 가구는 반경(2.5) 밖
      expect(s.tiles[far]).toBe(T.FURN);
      const near = furn(s, 10, 8, DECOR.MACHINE);
      shatter(sim, s, 10, 9, 0, 2.5, 3);
      expect(s.tiles[near]).toBe(T.FURN); expect(s.decorHp[near]).toBe(3);             // 내구 6: 닳기만 한다
      expect(cutFloors({ ...s, staging: { x: 10, y: 9 } } as Scene)).toBe(0);
    }
    {
      // 빈 공간(VOID)을 사이에 둔 창과 가구는 같은 폭발에 휘말리지 않는다 (나란히 놓인 2층)
      const { sim, s, at } = room();
      for (let y = 4; y <= 12; y++) set(s, 16, y, T.VOID);
      set(s, 17, 8, T.WINDOW);
      const other = furn(s, 17, 9, DECOR.PLANT);
      shatter(sim, s, 14, 8, 5, 5, 3);
      expect(s.glass[at(17, 8)]).toBe(0);
      expect(s.tiles[other]).toBe(T.FURN);
      expect(s.glass[at(12, 11)]).toBe(1);                     // 같은 층의 창은 깨진다
    }
  });

  it('열에 의한 파손과 파손용 난수는 현장의 다른 난수 흐름을 건드리지 않는다', () => {
    const a = room('RNG'), b = room('RNG');
    // 한쪽에서만 파손용 난수를 잔뜩 쓴다
    for (let k = 0; k < 500; k++) heatGlass(a.sim, a.s, a.at(8, 11), 8, 10);
    for (let k = 0; k < 50; k++) dmgRng(a.sim, a.s).next();
    expect(a.s.glass[a.at(8, 11)]).toBe(1);                    // 6% 를 500번이면 깨진다
    for (let k = 0; k < 20; k++) expect(a.s.rng.next()).toBe(b.s.rng.next());
    for (let k = 0; k < 20; k++) expect(a.sim.rng.next()).toBe(b.sim.rng.next());
    // 같은 현장의 파손용 흐름은 같은 시드에서 같은 값을 낸다
    const c = room('RNG2'), d = room('RNG2');
    for (let k = 0; k < 20; k++) expect(dmgRng(c.sim, c.s).next()).toBe(dmgRng(d.sim, d.s).next());
  });

  it('지휘관·대원의 판단부와 관제는 파손 규칙과 파손 자료를 읽지 않는다', () => {
    const files = ['field/commander.ts', 'field/brain.ts', ...readdirSync(new URL('../src/sim/dispatch/', import.meta.url)).map((f) => 'dispatch/' + f), ...readdirSync(new URL('../src/sim/field/orders/', import.meta.url)).map((f) => 'field/orders/' + f)];
    for (const f of files) {
      const src = readFileSync(new URL('../src/sim/' + f, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      for (const bad of ['./damage', '../damage', '.glass[', '.decorHp[']) expect(src.includes(bad), `${f}: ${bad}`).toBe(false);
    }
  });
});

describe('현장 파손 — 교대 안에서', () => {
  it('총격이 있었던 현장에 깨진 창이 남고, 파손 자료는 창·가구 칸에만 쌓인다 (위협 5, 12교대)', () => {
    let fought = 0, foughtWithGlass = 0, glass = 0;
    for (let k = 0; k < 12; k++) {
      const sim = new Sim('S' + k, { ...NORMAL, threat: 5 }); sim.runToEnd();
      for (const sc of sim.scenes) {
        if (!sc) continue;
        const t = tally(sc);
        glass += t.glass;
        // 총격 = 문제 기록의 '교전 발생' (효과 목록이 아니라 기록으로 판단한다)
        if (sim.incidents[sc.incidentId].problems.some((p) => p.detail === '교전 발생')) { fought++; if (t.glass > 0) foughtWithGlass++; }
        // 파손이 일어난 뒤에도 모든 바닥에 닿는다
        if ((t.glass || t.worn || t.wrecked) && sc.kind !== 'search' && sc.kind !== 'traffic') expect(cutFloors(sc), `${sim.seed} 사건 ${sim.incidents[sc.incidentId].code} (${sc.kind})`).toBe(0);
      }
    }
    expect(fought).toBeGreaterThan(0);
    expect(foughtWithGlass).toBeGreaterThanOrEqual(1);
    expect(glass).toBeGreaterThan(0);
  }, 240000);

  it('총격전이 벌어지는 현장(총격범)을 정해서 일으키면 가구가 닳거나 부서지고, 부서진 자리를 포함한 모든 바닥에 닿는다', () => {
    let worn = 0, wrecked = 0, glass = 0, logs = 0;
    for (let k = 0; k < 10; k++) {
      const sim = new Sim('D' + k, { ...NORMAL, threat: 5 }, 1200, { force: 'armed/shooter' }); sim.runToEnd();
      for (const sc of sim.scenes) {
        if (!sc) continue;
        const t = tally(sc);
        worn += t.worn; wrecked += t.wrecked; glass += t.glass;
        if (sc.kind !== 'search' && sc.kind !== 'traffic') expect(cutFloors(sc), `${sim.seed} 사건 ${sim.incidents[sc.incidentId].code} (${sc.kind})`).toBe(0);
      }
      for (const e of sim.events) if (e.text.includes('부서져 엄폐물이 사라졌습니다')) logs++;
      for (const I of sim.incidents) expect(I.phase).toBe('closed');
    }
    expect(glass).toBeGreaterThan(0);
    expect(worn + wrecked).toBeGreaterThan(0);
    expect(wrecked).toBeGreaterThan(0);
    expect(logs).toBeLessThanOrEqual(wrecked);                 // 기록은 가구가 부서졌을 때만 남는다
  }, 240000);

  it('재현성: 같은 시드는 파손까지 똑같이 되풀이된다', () => {
    const run = (): Sim => { const s = new Sim('D-REPLAY', { ...NORMAL, threat: 5 }, 1200, { force: 'armed/shooter' }); s.runToEnd(); return s; };
    const a = run(), b = run();
    expect(a.report!.hash).toBe(b.report!.hash);
    expect(a.scenes.length).toBe(b.scenes.length);
    let marks = 0;
    for (let k = 0; k < a.scenes.length; k++) {
      const x = a.scenes[k], y = b.scenes[k];
      if (!x || !y) { expect(x).toBe(y); continue; }
      expect(Array.from(x.glass)).toEqual(Array.from(y.glass));
      expect(Array.from(x.decorHp)).toEqual(Array.from(y.decorHp));
      expect(Array.from(x.tiles)).toEqual(Array.from(y.tiles));
      for (let i = 0; i < x.glass.length; i++) marks += x.glass[i] + (x.decorHp[i] ? 1 : 0);
    }
    expect(marks).toBeGreaterThan(0);                          // 실제로 파손이 있었던 교대다
    // 평소 교대(강제 발생 없음)도 마찬가지
    const c = new Sim('D-PLAIN'), d = new Sim('D-PLAIN'); c.runToEnd(); d.runToEnd();
    expect(c.report!.hash).toBe(d.report!.hash);
  }, 120000);
});
