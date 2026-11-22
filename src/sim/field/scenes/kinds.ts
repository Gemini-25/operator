// 사건 종류 다양화 ① 일상 사건의 현장 (docs/specs/N8-incident-kinds.md §4) — 진실을 만든다.
// registerScene('유형', '변형', (sim, I, rng) => Scene). 만드는 도구는 ../kindsKit(buildQuiet·streetFrame), ../builders, ../kit.
//
// 단계 3: 비응급 N1 장난 전화 셋(빈 현장) · N2 오인 신고 넷(§4.8 — 가서 확인하면 "이상 없음"의 답이 현장에 있다).
import { T } from '../../types';
import { addCas, addProp } from '../kit';
import { buildQuiet, streetFrame } from '../kindsKit';
import { registerScene } from '../sceneRegistry';

// ── N1 장난 전화: 그 유형의 장소에 아무 일도 없다 (기존 armed/prank 는 builders.buildArmed 의 같은 갈래) ──
registerScene('fire', 'prank', buildQuiet);
registerScene('medical', 'prank', buildQuiet);
registerScene('water', 'prank', buildQuiet);

// ── N2 오인 신고 ──
// 응급: 길의 보도에 잠든 사람(띠 0 · 체력 95 · 처음에는 누워 있다). 대원이 1.5칸 안에 오면 깨어나 걸어서 귀가한다(rules/kinds.ts 의 wakeRule — 안전한 곳으로 걸어가 where 'safe')
registerScene('medical', 'false', (sim, I, rng) => {
  const s = streetFrame(sim, I, rng, { lanes: false });
  const y = rng.chance(0.5) ? 7 : 12;
  addCas(s, rng.int(11, 21), y, 'immobile', 95, 0, 0);
  s.placeName = '길가';
  s.leadDept = 'ems';
  return s;
});
// 수난: 하천에 사람은 없고 물 위에 떠 있는 물건(마네킹·쓰레기 봉투) — 4칸 안·시야선이면 사실 evid floater ("사람이 아님")
registerScene('water', 'false', (sim, I, rng) => {
  const s = buildQuiet(sim, I, rng);
  const x = rng.int(6, 18);
  let y0 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++) if (s.tiles[y * s.w + x] === T.WATER) { if (y0 < 0) y0 = y; y1 = y; }
  if (y0 >= 0) addProp(s, 'fixture', x, Math.min(y1, y0 + rng.int(1, 3)), { skin: 'floater', blocking: false, angle: rng.range(-0.6, 0.6) });
  return s;
});
// 무장: 가게에 용의자는 없고 정문 앞 길가에 터진 폭죽 잔해 — 3칸 안·시야선이면 사실 evid fireworks ("총소리가 아니었음"), 지휘 규칙이 남은 방 수색을 거둔다
registerScene('armed', 'false', (sim, I, rng) => {
  const s = buildQuiet(sim, I, rng);
  const e = s.exits[0];
  if (e) {
    let fx = e.x, fy = e.y;
    for (const [dx, dy] of [[0, 2], [1, 2], [-1, 2], [0, 1], [2, 1], [-2, 1]]) {
      const x = e.x + dx, y = e.y + dy;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const t = s.tiles[y * s.w + x];
      if ((t === T.GROUND || t === T.ROAD) && s.propAt[y * s.w + x] < 0) { fx = x; fy = y; break; }
    }
    addProp(s, 'fixture', fx, fy, { skin: 'fireworks', blocking: false, angle: rng.range(-1, 1) });
  }
  return s;
});
// 가스: 밸브 없는 건물(buildQuiet — 오인 신고의 빈 건물) 한 방의 음식물 쓰레기 — 측정기를 든 대원이 2칸 안·시야선이면 사실 haz leak(active false) "가스 아님"
registerScene('hazmat', 'false', (sim, I, rng) => {
  const s = buildQuiet(sim, I, rng);
  const rooms = s.regions.filter((r) => r.kind === 'room' && r.indoor);
  if (rooms.length) {
    const r = rng.pick(rooms);
    const cands = r.tiles.filter((i) => s.tiles[i] === T.FLOOR && s.propAt[i] < 0);
    if (cands.length) { const i = rng.pick(cands); addProp(s, 'fixture', i % s.w, (i / s.w) | 0, { skin: 'trash', blocking: false }); }
  }
  return s;
});
