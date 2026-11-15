// 현장의 움직이는 대상: 사람(대원·시민·용의자), 쓰러진 사람, 차량, 소품.
// 모두 이 프로젝트를 위해 직접 그린 벡터 도형이다. 위에서 내려다본 모습으로, 타일 한 칸 = 1 단위.

import { AIR_KIND } from '../../sim/crews';
import type { Dept, RoleId, UnitKind } from '../../sim/types';
import { disc, hash2, oval, rr, seg, shade } from './common';
import type { G } from './common';

// ───────────────────────── 사람 ─────────────────────────
export type HeadKind = 'helmet' | 'cap' | 'hair' | 'hood' | 'tac'
  | 'visor';                              // (R1) 폭발물 방호복의 얼굴 가리개
export interface PersonLook {
  top: string; trim?: 'stripes' | 'vest' | 'cross' | 'none'
    | 'plus' | 'lifevest';                // (R1) 등판의 십자(의사·간호사) · 구명조끼(수난 구조대원)
  trimCol?: string;
  arm: string; hand: string; leg: string; shoe: string;
  head: HeadKind; headCol: string; headCol2?: string; skin: string;
  pack?: 'scba' | 'bag' | 'none'; packCol?: string;
  band?: string;                          // (R1) 헬멧을 가로지르는 띠 (팀장)
  bulk?: number;                          // (R1) 몸통 배율 (폭발물 방호복 1.25)
}
export type ArmPose = 'side' | 'aim' | 'hose' | 'work' | 'kneel' | 'up' | 'back' | 'drag' | 'carry' | 'baton' | 'megaphone'
  | 'throw';                              // (G5) 섬광탄 던지기: act 0→1 동안 한 팔을 뒤로 젖혔다 앞으로
export type Item = 'rifle' | 'pistol' | 'knife' | 'axe' | 'spreader' | 'none'
  | 'ram'                                 // (G5) 공성추
  | 'sniper' | 'taser' | 'shield' | 'tic' | 'halligan' | 'bigbag' | 'aed';      // (R1) 든 장비에서 고른다: 저격 소총 · 테이저 · 방탄 방패(+권총) · 열화상 카메라 · 할리건 · 전문 응급 가방 · 제세동기
export interface PersonPose {
  step: number; moving: boolean; arms: ArmPose; t: number; item?: Item; scale?: number; ghost?: number;
  recoil?: number;                        // (G5) 반동 0..1: 겨눈 반대쪽으로 0.06칸, 총을 0.04칸 더
  flinch?: { x: number; y: number };      // (G5) 움찔: 몸 전체를 이만큼(칸, 화면 방향) 민다
  crouch?: boolean;                       // (G5) 엄폐 자세: 몸 0.9배, 다리를 접는다
  cuffed?: boolean;                       // (G5) 'back' 자세에서 막대 대신 수갑 고리 둘 (검거된 용의자만 — 인질의 묶인 손은 막대 그대로)
  act?: number;                           // (G5) 'throw' 의 진행 0..1
}

const SKIN = ['#e8c4a0', '#d9ad86', '#f0d0b0', '#c99872'];
const HAIR = ['#211a14', '#3b2a1c', '#5a4028', '#2c2c30', '#8a8d92'];
const CLOTH = ['#b7654a', '#5f8fb0', '#8a6fae', '#c2a14a', '#6fa37a', '#b3b7bd', '#d98ca1', '#4f6fa8'];
const PANTS = ['#2f3a4f', '#3a3f47', '#4a4238', '#28303c'];

/**
 * 대원의 겉모습. 부서·부대 종류가 바탕이고, 역할이 그 위에 덧입힌다 (R1 10절):
 * 팀장은 흰 헬멧에 붉은 띠, 기관원·사다리 조작원은 주황 조끼, 의사는 흰 상의에 붉은 십자, 간호사는 남색 비행복,
 * 구급 운전원은 가방이 없고, 폭발물 처리 요원은 부피 큰 방호복과 얼굴 가리개, 수난 구조대원은 구명조끼.
 * 방패수·저격수 같은 그 밖의 역할은 손에 든 것으로 가린다(renderScene.agentPose).
 */
export function responderLook(dept: Dept, kind: UnitKind, seed: number, role?: RoleId): PersonLook {
  const k = baseLook(dept, kind, seed);
  switch (role) {
    case 'fireLead': case 'ladderLead': case 'rescueLead': case 'hazLead': return { ...k, headCol: '#f2f2ee', headCol2: '#d63a2c', band: '#d63a2c' };
    case 'engineer': case 'ladderOp': return { ...k, trim: 'vest', trimCol: '#f08a2a' };
    case 'doctor': return { ...k, top: '#f4f6f7', arm: '#f4f6f7', trim: 'plus', trimCol: '#d8423a', pack: 'none' };
    case 'flightNurse': return { ...k, top: '#27375e', arm: '#27375e', leg: '#1f2c4c', trim: 'plus', trimCol: '#ffffff' };
    case 'emsDriver': return { ...k, pack: 'none' };
    case 'bombTech': return { ...k, top: '#5b664d', arm: '#5b664d', leg: '#4a553f', trim: 'none', head: 'visor', headCol: '#4a553f', headCol2: '#a9d4ea', bulk: 1.25 };
    case 'boatRescuer': return { ...k, trim: 'lifevest', trimCol: '#f07a2a', pack: 'none' };
    default: return k;
  }
}
function baseLook(dept: Dept, kind: UnitKind, seed: number): PersonLook {
  const skin = SKIN[(hash2(seed, 1) * SKIN.length) | 0];
  if (dept === 'fire') {
    const rescue = kind === 'rescue' || kind === 'heli' || kind === 'boat';      // 'heli' = 소방 헬기의 항공 구조대원 (경찰·의료 헬기의 대원은 부서가 다르다)
    if (kind === 'hazmat') return { ...baseLook('fire', 'engine', seed), top: '#cfc23a', arm: '#c2b534', leg: '#b3a72e', trimCol: '#3a3f45' };
    return { top: rescue ? '#d9742a' : '#b08f3e', trim: 'stripes', trimCol: '#e6f04a', arm: rescue ? '#c96824' : '#a2833a', hand: '#2a2d31', leg: rescue ? '#b85e20' : '#8f7434', shoe: '#1c1e21', head: 'helmet', headCol: rescue ? '#f2f2ee' : '#d63a2c', headCol2: '#f4d24a', skin, pack: 'scba', packCol: '#e9c53c' };
  }
  if (dept === 'ems') {
    return { top: '#27a583', trim: 'cross', trimCol: '#ffffff', arm: '#e9eef2', hand: '#7fc0ee', leg: '#28353f', shoe: '#1c1e21', head: 'hair', headCol: HAIR[(hash2(seed, 2) * HAIR.length) | 0], skin, pack: 'bag', packCol: '#d8423a' };
  }
  if (kind === 'eod') return { ...baseLook('police', 'tactical', seed), top: '#4a5540', arm: '#4a5540', leg: '#3f4936', headCol: '#3a4433', headCol2: '#e0b83a' };
  if (kind === 'tactical' || kind === 'swat') {
    return { top: '#2c323b', trim: 'vest', trimCol: '#191d23', arm: '#2c323b', hand: '#15181c', leg: '#262b33', shoe: '#121416', head: 'tac', headCol: '#1f242b', headCol2: '#5aa9ff', skin, pack: 'none' };
  }
  return { top: '#7ea4d6', trim: 'vest', trimCol: '#22355c', arm: '#7ea4d6', hand: skin, leg: '#1f2d4c', shoe: '#14161a', head: 'cap', headCol: '#1f2f55', headCol2: '#e8edf2', skin, pack: 'none' };
}
export function civilianLook(seed: number): PersonLook {
  const skin = SKIN[(hash2(seed, 3) * SKIN.length) | 0], top = CLOTH[(hash2(seed, 4) * CLOTH.length) | 0];
  return { top, trim: 'none', arm: hash2(seed, 5) > 0.5 ? top : skin, hand: skin, leg: PANTS[(hash2(seed, 6) * PANTS.length) | 0], shoe: '#22252a', head: 'hair', headCol: HAIR[(hash2(seed, 7) * HAIR.length) | 0], skin, pack: 'none' };
}
export function hostileLook(seed: number): PersonLook {
  const top = ['#33333a', '#3a2f2f', '#2c3530'][(hash2(seed, 8) * 3) | 0];
  return { top, trim: 'none', arm: top, hand: '#1a1a1c', leg: '#25272c', shoe: '#101113', head: 'hood', headCol: shade(top, -0.2), headCol2: '#c2303f', skin: SKIN[0], pack: 'none' };
}

function head(g: G, k: PersonLook): void {
  const hx = 0.035;
  switch (k.head) {
    case 'helmet':
      oval(g, hx - 0.07, 0, 0.17, 0.155, shade(k.headCol, -0.28));
      disc(g, hx, 0, 0.138, k.headCol);
      seg(g, hx - 0.11, 0, hx + 0.12, 0, 0.04, shade(k.headCol, 0.35));
      rr(g, hx + 0.085, -0.045, 0.05, 0.09, 0.015, k.headCol2 ?? '#f4d24a');
      if (k.band) seg(g, hx - 0.015, -0.125, hx - 0.015, 0.125, 0.04, k.band);      // 팀장: 헬멧을 가로지르는 띠
      break;
    case 'visor':
      // 폭발물 방호복: 깃이 높은 큰 헬멧과 넓은 얼굴 가리개
      oval(g, hx - 0.06, 0, 0.2, 0.19, shade(k.headCol, -0.3));
      disc(g, hx, 0, 0.15, k.headCol);
      rr(g, hx + 0.04, -0.105, 0.105, 0.21, 0.04, k.headCol2 ?? '#a9d4ea');
      rr(g, hx + 0.06, -0.085, 0.03, 0.17, 0.015, 'rgba(255,255,255,0.45)');
      break;
    case 'tac':
      disc(g, hx, 0, 0.138, k.headCol);
      g.strokeStyle = shade(k.headCol, 0.25); g.lineWidth = 0.025; g.beginPath(); g.arc(hx, 0, 0.1, 0, 6.2832); g.stroke();
      rr(g, hx + 0.07, -0.07, 0.05, 0.14, 0.02, '#3d4853');
      rr(g, hx - 0.14, -0.035, 0.05, 0.07, 0.01, k.headCol2 ?? '#5aa9ff');
      break;
    case 'cap':
      oval(g, hx + 0.1, 0, 0.085, 0.105, shade(k.headCol, -0.3));
      disc(g, hx, 0, 0.125, k.headCol);
      g.strokeStyle = k.headCol2 ?? '#ffffff'; g.lineWidth = 0.02; g.beginPath(); g.arc(hx, 0, 0.1, -1.2, 1.2); g.stroke();
      disc(g, hx - 0.01, 0, 0.022, shade(k.headCol, 0.3));
      break;
    case 'hood':
      g.fillStyle = k.headCol; g.beginPath(); g.moveTo(hx - 0.22, 0); g.quadraticCurveTo(hx - 0.1, -0.16, hx + 0.03, -0.14); g.lineTo(hx + 0.03, 0.14); g.quadraticCurveTo(hx - 0.1, 0.16, hx - 0.22, 0); g.fill();
      disc(g, hx, 0, 0.138, k.headCol);
      oval(g, hx + 0.075, 0, 0.055, 0.085, k.headCol2 ?? '#c2303f');
      oval(g, hx + 0.1, 0, 0.03, 0.06, '#1a1012');
      break;
    default:
      disc(g, hx, 0, 0.125, k.headCol);
      oval(g, hx + 0.085, 0, 0.045, 0.085, k.skin);
      oval(g, hx - 0.02, -0.02, 0.07, 0.06, shade(k.headCol, 0.18));
  }
}

/** 서 있는(걷는) 사람. (x, y) 화면 좌표, ang 바라보는 방향, ts 타일 한 칸의 크기. */
export function drawPerson(g: G, x: number, y: number, ang: number, ts: number, k: PersonLook, p: PersonPose): void {
  g.save(); g.translate(x, y); g.scale(ts, ts);
  if (p.flinch) g.translate(p.flinch.x, p.flinch.y);
  if (p.ghost !== undefined) g.globalAlpha *= p.ghost;
  oval(g, 0.06, 0.09, 0.32, 0.3, 'rgba(0,0,0,0.3)');
  g.rotate(ang);
  if (p.recoil) g.translate(-0.06 * p.recoil, 0);
  const sc = (p.scale ?? 1) * BODY * (p.crouch ? 0.9 : 1); g.scale(sc, sc);
  const sw = p.moving ? Math.sin(p.step) : 0;
  const AW = 0.1;
  // 다리·발
  if (p.arms === 'kneel' || p.crouch) { oval(g, -0.15, -0.1, 0.14, 0.07, k.leg); oval(g, -0.15, 0.1, 0.14, 0.07, k.leg); oval(g, -0.27, -0.1, 0.06, 0.055, k.shoe); oval(g, -0.27, 0.1, 0.06, 0.055, k.shoe); }
  else { oval(g, 0.02 + sw * 0.13, -0.105, 0.105, 0.062, k.shoe); oval(g, 0.02 - sw * 0.13, 0.105, 0.105, 0.062, k.shoe); }
  // 등짐
  if (k.pack === 'scba') { rr(g, -0.27, -0.08, 0.19, 0.16, 0.07, k.packCol ?? '#e9c53c'); rr(g, -0.25, -0.05, 0.15, 0.05, 0.02, 'rgba(255,255,255,0.35)'); disc(g, -0.27, 0, 0.035, '#555d66'); }
  else if (k.pack === 'bag') { rr(g, -0.27, -0.13, 0.16, 0.26, 0.04, k.packCol ?? '#d8423a'); g.fillStyle = '#ffffff'; g.fillRect(-0.215, -0.07, 0.05, 0.14); g.fillRect(-0.245, -0.025, 0.11, 0.05); }
  // 팔
  const arm = (x0: number, y0: number, x1: number, y1: number): void => { seg(g, x0, y0, x1, y1, AW, k.arm); disc(g, x1, y1, 0.052, k.hand); };
  const o = Math.sin(p.t * 9) * 0.05;
  let hx = 0.3, hy = 0;                                   // 손에 든 물건의 기준점
  switch (p.arms) {
    case 'aim':
      if (p.item === 'rifle' || p.item === 'sniper') { arm(0.02, 0.24, 0.2, 0.07); arm(0.02, -0.24, 0.36, -0.03); }
      else if (p.item === 'shield') { arm(0.02, -0.24, 0.3, -0.12); arm(0.02, 0.24, 0.3, 0.2); }      // 한 팔로 방패를 받치고 다른 손에 권총
      else { arm(0.02, 0.24, 0.31, 0.03); arm(0.02, -0.24, 0.31, -0.03); }
      break;
    case 'hose': arm(0.02, 0.24, 0.17, 0.1); arm(0.02, -0.24, 0.31, -0.03); break;
    case 'work': arm(0.02, -0.24, 0.27 + o, -0.07); arm(0.02, 0.24, 0.27 - o, 0.07); break;
    case 'kneel': arm(0.02, -0.24, 0.3 + o, -0.09); arm(0.02, 0.24, 0.3 - o, 0.09); break;
    case 'up': arm(0, -0.25, 0.08, -0.4); arm(0, 0.25, 0.08, 0.4); break;
    case 'back':
      arm(0, -0.25, -0.15, -0.05); arm(0, 0.25, -0.15, 0.05);
      if (p.cuffed) { g.strokeStyle = '#dfe6ec'; g.lineWidth = 0.022; g.beginPath(); g.arc(-0.16, -0.05, 0.035, 0, 6.2832); g.stroke(); g.beginPath(); g.arc(-0.16, 0.05, 0.035, 0, 6.2832); g.stroke(); seg(g, -0.16, -0.015, -0.16, 0.015, 0.012, '#dfe6ec'); }
      else seg(g, -0.16, -0.045, -0.16, 0.045, 0.03, '#c9d0d6');
      break;
    case 'throw': {
      const a = p.act ?? 0, back = a < 0.45, q = back ? a / 0.45 : (a - 0.45) / 0.55;
      arm(0.02, -0.24, 0.26, -0.1);
      if (back) arm(0, 0.25, 0.02 - 0.24 * q, 0.3 + 0.06 * q); else arm(0, 0.25, -0.22 + 0.58 * q, 0.36 - 0.26 * q);
      hx = back ? 0.02 - 0.24 * q : -0.22 + 0.58 * q; hy = back ? 0.3 + 0.06 * q : 0.36 - 0.26 * q;
      if (back) { rr(g, hx - 0.05, hy - 0.03, 0.1, 0.06, 0.02, '#2a2f35'); g.fillStyle = '#c9cfd4'; g.fillRect(hx - 0.01, hy - 0.03, 0.02, 0.06); }
      break;
    }
    case 'drag': arm(0, -0.25, -0.2, -0.17); arm(0, 0.25, -0.2, 0.17); break;
    case 'carry': arm(0.02, -0.24, 0.25, -0.2); arm(0.02, 0.24, 0.25, 0.2); break;
    case 'baton': {
      const a = 0.9 + Math.sin(p.t * 4) * 0.5; hx = 0.02 + Math.cos(a) * 0.24; hy = 0.25 + Math.sin(a) * 0.2;
      arm(-sw * 0.09, -0.27, -sw * 0.16 + 0.04, -0.29); arm(0, 0.25, hx, hy);
      seg(g, hx, hy, hx + Math.cos(a) * 0.3, hy + Math.sin(a) * 0.3, 0.05, '#ff5a3c'); seg(g, hx, hy, hx + Math.cos(a) * 0.3, hy + Math.sin(a) * 0.3, 0.02, '#ffd0b8');
      break;
    }
    case 'megaphone': arm(-sw * 0.09, -0.27, 0.04, -0.29); arm(0.02, 0.24, 0.2, 0.09); break;
    default: {
      oval(g, -sw * 0.09, -0.275, 0.09, 0.066, k.arm); disc(g, -sw * 0.17 + 0.05, -0.285, 0.048, k.hand);
      oval(g, sw * 0.09, 0.275, 0.09, 0.066, k.arm); disc(g, sw * 0.17 + 0.05, 0.285, 0.048, k.hand);
    }
  }
  // 몸통 (폭발물 방호복은 부피가 크다)
  const bulk = k.bulk ?? 1;
  if (bulk !== 1) { g.save(); g.scale(bulk, bulk); }
  rr(g, -0.135, -0.275, 0.27, 0.55, 0.115, shade(k.top, -0.25));
  rr(g, -0.12, -0.265, 0.245, 0.53, 0.11, k.top);
  if (bulk !== 1) { rr(g, -0.1, -0.21, 0.2, 0.42, 0.08, shade(k.top, 0.14)); seg(g, -0.1, -0.07, 0.1, -0.07, 0.02, shade(k.top, -0.3)); seg(g, -0.1, 0.07, 0.1, 0.07, 0.02, shade(k.top, -0.3)); }      // 덧댄 방호판
  if (k.trim === 'plus') {
    g.fillStyle = k.trimCol ?? '#d8423a'; g.fillRect(-0.04, -0.105, 0.07, 0.21); g.fillRect(-0.085, -0.035, 0.16, 0.07);
  } else if (k.trim === 'lifevest') {
    rr(g, -0.125, -0.24, 0.245, 0.48, 0.09, k.trimCol ?? '#f07a2a');
    g.fillStyle = '#f4d24a'; g.fillRect(-0.125, -0.15, 0.245, 0.045); g.fillRect(-0.125, 0.105, 0.245, 0.045);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-0.01, -0.24, 0.02, 0.48);
  } else if (k.trim === 'stripes') {
    g.fillStyle = k.trimCol ?? '#e6f04a'; g.fillRect(-0.035, -0.262, 0.05, 0.524);
    g.fillStyle = '#d7dde2'; g.fillRect(-0.02, -0.262, 0.02, 0.524);
  } else if (k.trim === 'vest') {
    rr(g, -0.115, -0.2, 0.225, 0.4, 0.08, k.trimCol ?? '#22355c');
    g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillRect(-0.105, -0.085, 0.035, 0.17);
  } else if (k.trim === 'cross') {
    g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(-0.03, -0.262, 0.04, 0.524);
  }
  if (bulk !== 1) g.restore();
  if (k.pack === 'scba') { seg(g, -0.1, -0.11, 0.09, -0.15, 0.03, '#23272c'); seg(g, -0.1, 0.11, 0.09, 0.15, 0.03, '#23272c'); }
  // 손에 든 것
  if (p.recoil && p.arms === 'aim') g.translate(-0.04 * p.recoil, 0);
  if (p.arms === 'work' && p.item === 'ram') {
    rr(g, 0.14, -0.08, 0.5, 0.16, 0.04, '#1d2329'); rr(g, 0.6, -0.095, 0.08, 0.19, 0.03, '#3a434c'); rr(g, 0.16, -0.06, 0.46, 0.04, 0.02, 'rgba(255,255,255,0.12)');
    seg(g, 0.24, -0.1, 0.24, 0.1, 0.03, '#c84a2c'); seg(g, 0.46, -0.1, 0.46, 0.1, 0.03, '#c84a2c');
  } else if (p.arms === 'aim' && p.item === 'rifle') { rr(g, 0.04, 0.035, 0.16, 0.06, 0.015, '#1c2026'); rr(g, 0.18, 0.02, 0.26, 0.075, 0.015, '#14171b'); rr(g, 0.42, 0.04, 0.24, 0.032, 0.01, '#0f1114'); rr(g, 0.26, 0.085, 0.05, 0.07, 0.01, '#1c2026'); }
  else if (p.arms === 'aim' && p.item === 'sniper') {
    // 저격 소총: 긴 총열, 조준경, 양각대
    rr(g, 0.0, 0.035, 0.2, 0.06, 0.015, '#2a2f26'); rr(g, 0.18, 0.02, 0.3, 0.075, 0.015, '#1a1e18'); rr(g, 0.46, 0.042, 0.46, 0.028, 0.01, '#0f1114');
    rr(g, 0.24, -0.015, 0.2, 0.045, 0.02, '#0f1114'); disc(g, 0.44, 0.008, 0.026, '#7fc4ee');
    seg(g, 0.74, 0.056, 0.8, 0.0, 0.016, '#3a4046'); seg(g, 0.74, 0.056, 0.8, 0.112, 0.016, '#3a4046');
  }
  else if (p.arms === 'aim' && p.item === 'pistol') { rr(g, 0.3, -0.024, 0.17, 0.048, 0.01, '#14171b'); }
  else if (p.arms === 'aim' && p.item === 'taser') { rr(g, 0.3, -0.03, 0.15, 0.06, 0.012, '#e8c53c'); rr(g, 0.43, -0.03, 0.03, 0.06, 0.008, '#14171b'); rr(g, 0.3, 0.02, 0.05, 0.05, 0.01, '#14171b'); }
  else if (p.arms === 'aim' && p.item === 'shield') {
    // 방탄 방패: 몸 앞을 가리는 넓은 판, 가로 시야 창. 옆으로 권총이 나온다
    rr(g, 0.3, 0.17, 0.17, 0.048, 0.01, '#14171b');
    rr(g, 0.36, -0.34, 0.1, 0.56, 0.035, '#0e1114'); rr(g, 0.375, -0.325, 0.07, 0.53, 0.028, '#2c333c');
    rr(g, 0.385, -0.22, 0.05, 0.13, 0.015, '#7fb4d8'); rr(g, 0.375, -0.02, 0.07, 0.025, 0.006, 'rgba(255,255,255,0.14)');
  }
  else if (p.arms === 'aim' && p.item === 'knife') { g.fillStyle = '#d7dde2'; g.beginPath(); g.moveTo(0.33, -0.02); g.lineTo(0.52, 0); g.lineTo(0.33, 0.025); g.closePath(); g.fill(); }
  else if (p.arms === 'hose') {
    g.strokeStyle = '#c7a03a'; g.lineWidth = 0.065; g.lineCap = 'round'; g.beginPath(); g.moveTo(0.14, 0.07); g.quadraticCurveTo(-0.1, 0.36, -0.42, 0.34 + Math.sin(p.t * 1.3) * 0.02); g.quadraticCurveTo(-0.7, 0.32, -0.86, 0.42); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.015; g.stroke();
    rr(g, 0.12, 0.0, 0.3, 0.07, 0.02, '#c9cfd4'); rr(g, 0.4, -0.005, 0.1, 0.08, 0.02, '#d63a2c'); rr(g, 0.2, -0.03, 0.04, 0.05, 0.01, '#4d555d');
  } else if (p.arms === 'work' && p.item === 'axe') {
    seg(g, 0.2, 0, 0.56 + o, 0, 0.035, '#8a6238'); rr(g, 0.5 + o, -0.085, 0.09, 0.17, 0.015, '#b9c0c6'); rr(g, 0.5 + o, -0.085, 0.09, 0.05, 0.01, '#d63a2c');
  } else if (p.arms === 'work' && p.item === 'spreader') {
    rr(g, 0.22, -0.055, 0.22, 0.11, 0.025, '#e07b2a'); rr(g, 0.26, -0.03, 0.1, 0.06, 0.01, '#22262b');
    seg(g, 0.44, -0.02, 0.64, -0.05 - o * 1.2, 0.04, '#aab2b9'); seg(g, 0.44, 0.02, 0.64, 0.05 + o * 1.2, 0.04, '#aab2b9');
  } else if (p.arms === 'work' && p.item === 'halligan') {
    // 할리건: 긴 쇠막대 끝의 갈퀴와 쐐기
    seg(g, 0.18, 0, 0.6 + o, 0, 0.032, '#b9c0c6'); seg(g, 0.6 + o, -0.075, 0.6 + o, 0.05, 0.036, '#8f979e'); seg(g, 0.6 + o, -0.075, 0.67 + o, -0.095, 0.03, '#8f979e'); rr(g, 0.16, -0.03, 0.05, 0.06, 0.01, '#d63a2c');
  } else if (p.arms === 'megaphone' && p.item === 'tic') {
    // 열화상 카메라: 손에 든 노란 몸체와 화면
    rr(g, 0.17, 0.04, 0.17, 0.12, 0.03, '#e8c53c'); rr(g, 0.19, 0.06, 0.1, 0.08, 0.015, '#1a2a22'); rr(g, 0.2, 0.07, 0.05, 0.035, 0.008, '#ff8a3c'); rr(g, 0.33, 0.07, 0.04, 0.06, 0.012, '#23272c');
  } else if (p.arms === 'megaphone') {
    g.fillStyle = '#eceff1'; g.beginPath(); g.moveTo(0.2, 0.06); g.lineTo(0.42, -0.02); g.lineTo(0.42, 0.2); g.closePath(); g.fill(); rr(g, 0.4, -0.03, 0.035, 0.24, 0.01, '#d63a2c');
  } else if (p.arms === 'kneel' && p.item === 'bigbag') {
    // 전문 응급 가방·의사 장비: 큰 빨간 가방
    rr(g, 0.28, -0.13, 0.2, 0.26, 0.035, '#a8281f'); rr(g, 0.29, -0.12, 0.18, 0.24, 0.03, '#d8423a'); g.fillStyle = '#ffffff'; g.fillRect(0.365, -0.05, 0.03, 0.1); g.fillRect(0.33, -0.015, 0.1, 0.03); seg(g, 0.3, -0.07, 0.3, 0.07, 0.016, '#23272c');
  } else if (p.arms === 'kneel' && p.item === 'aed') {
    // 제세동기: 주황 상자와 전극 줄
    rr(g, 0.3, -0.075, 0.14, 0.15, 0.025, '#f08a2a'); rr(g, 0.325, -0.045, 0.06, 0.05, 0.01, '#1a2a22'); disc(g, 0.405, 0.035, 0.018, '#7dffb0');
    g.strokeStyle = '#23272c'; g.lineWidth = 0.014; g.beginPath(); g.moveTo(0.44, -0.03); g.quadraticCurveTo(0.52, -0.1, 0.56, -0.02); g.stroke();
  } else if (p.arms === 'kneel') { rr(g, 0.3, -0.05, 0.1, 0.1, 0.02, '#f4f6f7'); g.fillStyle = '#d8423a'; g.fillRect(0.34, -0.03, 0.02, 0.06); g.fillRect(0.32, -0.01, 0.06, 0.02); }
  void hx; void hy;
  head(g, k);
  g.restore();
}

/** 사람 크기 배율 (타일 한 칸 대비) */
const BODY = 1.22;
export interface LyingOpts { sheet?: boolean; stretcher?: boolean; bandage?: boolean; variant: number; ghost?: number }      // (G5) 피 웅덩이를 그리지 않는다 — 다친 정도는 딱지·체력 막대·붕대로
/** 쓰러져 누운 사람. 머리가 +x 쪽. */
export function drawLying(g: G, x: number, y: number, ang: number, ts: number, k: PersonLook, o: LyingOpts): void {
  g.save(); g.translate(x, y); g.scale(ts, ts);
  if (o.ghost !== undefined) g.globalAlpha *= o.ghost;
  g.rotate(ang); g.scale(BODY * 0.94, BODY * 0.94);
  if (o.stretcher) {
    seg(g, -0.68, -0.2, 0.6, -0.2, 0.04, '#353c44'); seg(g, -0.68, 0.2, 0.6, 0.2, 0.04, '#353c44');
    rr(g, -0.56, -0.215, 1.04, 0.43, 0.05, '#d9742a'); rr(g, -0.53, -0.185, 0.98, 0.37, 0.04, '#ef9548');
  } else oval(g, 0.02, 0.05, 0.5, 0.24, 'rgba(0,0,0,0.26)');
  const v = o.variant;
  // 다리
  seg(g, -0.1, -0.07, -0.46, -0.1 - v * 0.07, 0.11, k.leg); seg(g, -0.1, 0.07, -0.44, 0.1 + (1 - v) * 0.1, 0.11, k.leg);
  disc(g, -0.48, -0.1 - v * 0.07, 0.06, k.shoe); disc(g, -0.46, 0.1 + (1 - v) * 0.1, 0.06, k.shoe);
  // 팔
  if (v > 0.5) { seg(g, 0.14, -0.15, 0.36, -0.27, 0.085, k.arm); disc(g, 0.38, -0.28, 0.048, k.hand); seg(g, 0.12, 0.15, -0.04, 0.27, 0.085, k.arm); disc(g, -0.06, 0.28, 0.048, k.hand); }
  else { seg(g, 0.14, -0.15, 0, -0.29, 0.085, k.arm); disc(g, -0.02, -0.3, 0.048, k.hand); seg(g, 0.14, 0.15, 0.06, 0.3, 0.085, k.arm); disc(g, 0.05, 0.32, 0.048, k.hand); }
  // 몸통
  rr(g, -0.15, -0.165, 0.38, 0.33, 0.1, shade(k.top, -0.22)); rr(g, -0.14, -0.155, 0.36, 0.31, 0.095, k.top);
  if (o.bandage) { g.fillStyle = '#f4f6f7'; g.fillRect(0, -0.155, 0.08, 0.31); disc(g, 0.04, 0.02, 0.022, '#d8423a'); }
  // 머리
  disc(g, 0.345, 0, 0.122, k.headCol); disc(g, 0.32, 0, 0.098, k.skin);
  if (o.sheet) {
    rr(g, -0.54, -0.21, 0.98, 0.42, 0.1, '#cfd6dc');
    seg(g, -0.4, -0.12, 0.2, -0.08, 0.012, 'rgba(60,70,80,0.3)'); seg(g, -0.3, 0.1, 0.3, 0.06, 0.012, 'rgba(60,70,80,0.3)'); seg(g, -0.1, -0.02, 0.36, 0.0, 0.012, 'rgba(60,70,80,0.22)');
  }
  g.restore();
}

// ───────────────────────── 차량 ─────────────────────────
export const VEH_SIZE: Record<UnitKind, [number, number]> = { engine: [3.1, 1.14], rescue: [2.9, 1.14], als: [2.5, 1.06], bls: [2.4, 1.04], patrol: [2.05, 0.96], tactical: [2.6, 1.08], ladder: [3.7, 1.16], hazmat: [3.0, 1.14], swat: [2.85, 1.16], eod: [2.7, 1.12], heli: [3.0, 1.0], boat: [2.7, 0.96], policeHeli: [2.8, 0.95], medHeli: [3.0, 1.0] };

function wheels(g: G, L: number, W: number): void {
  for (const wx of [-L * 0.3, L * 0.3]) { rr(g, wx - 0.17, -W / 2 - 0.035, 0.34, 0.1, 0.03, '#0e1114'); rr(g, wx - 0.17, W / 2 - 0.065, 0.34, 0.1, 0.03, '#0e1114'); }
}
function lightbar(g: G, x: number, W: number, a: string, b: string, on: boolean, timeMs: number): void {
  rr(g, x - 0.075, -W / 2 + 0.13, 0.15, W - 0.26, 0.04, '#20252b');
  const ph = on ? Math.floor(timeMs / 160) % 2 : -1;
  rr(g, x - 0.05, -W / 2 + 0.16, 0.1, W / 2 - 0.2, 0.03, ph === 0 ? shade(a, 0.35) : shade(a, on ? -0.55 : -0.25));
  rr(g, x - 0.05, 0.04, 0.1, W / 2 - 0.2, 0.03, ph === 1 ? shade(b, 0.35) : shade(b, on ? -0.55 : -0.25));
}
const BEACON: Record<Dept, [string, string]> = { fire: ['#ff3b2f', '#ffd24a'], ems: ['#ff3b2f', '#4aa3ff'], police: ['#4aa3ff', '#ff3b2f'] };
export function beaconColors(dept: Dept): [string, string] { return BEACON[dept]; }

/** 위에서 본 긴급 차량. 앞이 +x. */
export function drawEmergency(g: G, x: number, y: number, ang: number, ts: number, kind: UnitKind, dept: Dept, lights: boolean, timeMs: number): void {
  const [L, W] = VEH_SIZE[kind];
  if (AIR_KIND.has(kind)) { drawHeli(g, x, y, ang, ts, lights, timeMs, kind); return; }      // 헬기 세 종류: 종류마다 도색이 다르다
  if (kind === 'boat') { drawBoat(g, x, y, ang, ts, lights, timeMs); return; }
  g.save(); g.translate(x, y); g.scale(ts, ts);
  g.save(); g.translate(0.08, 0.12); g.rotate(ang); rr(g, -L / 2, -W / 2, L, W, 0.14, 'rgba(0,0,0,0.38)'); g.restore();
  g.rotate(ang);
  wheels(g, L, W);
  const [ca, cb] = BEACON[dept];
  const glass = '#182734', glassHi = 'rgba(160,210,240,0.35)';
  if (kind === 'engine' || kind === 'rescue' || kind === 'ladder' || kind === 'hazmat') {
    const red = '#c0392b', redHi = '#d64b3a';
    rr(g, -L / 2, -W / 2, L, W, 0.1, shade(red, -0.35)); rr(g, -L / 2 + 0.03, -W / 2 + 0.03, L - 0.06, W - 0.06, 0.08, red);
    // 측면 흰 띠
    g.fillStyle = '#f1ede2'; g.fillRect(-L / 2 + 0.08, -W / 2 + 0.07, L - 1.15, 0.06); g.fillRect(-L / 2 + 0.08, W / 2 - 0.13, L - 1.15, 0.06);
    // 운전실
    const cx0 = L / 2 - 1.0;
    rr(g, cx0, -W / 2 + 0.05, 0.96, W - 0.1, 0.1, redHi);
    rr(g, L / 2 - 0.33, -W / 2 + 0.12, 0.2, W - 0.24, 0.05, glass); rr(g, L / 2 - 0.31, -W / 2 + 0.14, 0.06, W - 0.28, 0.03, glassHi);
    rr(g, cx0 + 0.12, -W / 2 + 0.07, 0.42, 0.05, 0.02, glass); rr(g, cx0 + 0.12, W / 2 - 0.12, 0.42, 0.05, 0.02, glass);
    rr(g, cx0 + 0.16, -0.16, 0.32, 0.32, 0.04, shade(redHi, 0.12));
    lightbar(g, L / 2 - 0.5, W, ca, cb, lights, timeMs);
    if (kind === 'engine') {
      // 호스 적재함과 사다리
      rr(g, -L / 2 + 0.14, -W / 2 + 0.2, L - 1.42, W - 0.4, 0.04, '#59626b');
      for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#d9d3c0' : '#c7a03a'; g.fillRect(-L / 2 + 0.2, -W / 2 + 0.25 + k * 0.085, L - 1.75, 0.065); }
      rr(g, cx0 - 0.24, -W / 2 + 0.2, 0.2, W - 0.4, 0.02, '#2c333a');
      for (const gy of [-0.22, 0, 0.22]) { disc(g, cx0 - 0.14, gy, 0.05, '#cdd3d8'); disc(g, cx0 - 0.14, gy, 0.03, '#39424a'); }
      g.fillStyle = '#c9cfd4'; g.fillRect(-L / 2 + 0.2, W / 2 - 0.32, L - 1.75, 0.025); g.fillRect(-L / 2 + 0.2, W / 2 - 0.21, L - 1.75, 0.025);
      for (let k = 0; k < 9; k++) g.fillRect(-L / 2 + 0.24 + k * ((L - 1.85) / 8), W / 2 - 0.32, 0.022, 0.13);
    } else if (kind === 'ladder') {
      // 사다리차: 지붕에 접어 둔 긴 사다리와 회전대
      rr(g, -L / 2 + 0.14, -W / 2 + 0.2, L - 1.42, W - 0.4, 0.04, '#4c555e');
      rr(g, -L / 2 + 0.05, -0.17, L - 0.75, 0.34, 0.03, '#aab2b9'); g.fillStyle = '#6b747d'; for (let k = 0; k < 16; k++) g.fillRect(-L / 2 + 0.12 + k * ((L - 0.95) / 15), -0.17, 0.03, 0.34);
      g.fillStyle = '#d8dde1'; g.fillRect(-L / 2 + 0.05, -0.17, L - 0.75, 0.035); g.fillRect(-L / 2 + 0.05, 0.135, L - 0.75, 0.035);
      disc(g, -L / 2 + 0.62, 0, 0.26, '#39424a'); disc(g, -L / 2 + 0.62, 0, 0.16, '#cdd3d8'); rr(g, L / 2 - 1.5, -0.22, 0.34, 0.44, 0.04, '#e9e4d8');
    } else if (kind === 'hazmat') {
      // 화학 구조차: 노란 띠와 밀폐 장비함, 제독 장비
      rr(g, -L / 2 + 0.12, -W / 2 + 0.16, L - 1.3, W - 0.32, 0.04, '#e3d74a'); g.fillStyle = '#2a2d31';
      for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(-L / 2 + 0.16 + k * 0.28, -W / 2 + 0.16); g.lineTo(-L / 2 + 0.3 + k * 0.28, -W / 2 + 0.16); g.lineTo(-L / 2 + 0.2 + k * 0.28, -W / 2 + 0.3); g.lineTo(-L / 2 + 0.06 + k * 0.28 + 0.1, -W / 2 + 0.3); g.closePath(); g.fill(); }
      rr(g, -L / 2 + 0.3, -0.1, 0.9, 0.34, 0.04, '#b7ae3a'); disc(g, -L / 2 + 0.5, 0.07, 0.11, '#39424a'); disc(g, -L / 2 + 0.85, 0.07, 0.11, '#39424a'); disc(g, -L / 2 + 0.5, 0.07, 0.06, '#8fd04a'); disc(g, -L / 2 + 0.85, 0.07, 0.06, '#8fd04a');
    } else {
      // 구조 공작차: 장비함 지붕과 조명탑
      rr(g, -L / 2 + 0.12, -W / 2 + 0.16, L - 1.3, W - 0.32, 0.04, '#e6e1d6');
      g.fillStyle = 'rgba(40,46,52,0.35)';
      for (let k = 1; k < 4; k++) g.fillRect(-L / 2 + 0.12 + ((L - 1.3) * k) / 4, -W / 2 + 0.16, 0.018, W - 0.32);
      g.fillRect(-L / 2 + 0.12, -0.009, L - 1.3, 0.018);
      rr(g, -L / 2 + 0.3, -0.12, 0.5, 0.24, 0.03, '#aab2b9'); disc(g, -L / 2 + 0.42, 0, 0.07, '#eef2f4'); disc(g, -L / 2 + 0.66, 0, 0.07, '#eef2f4');
      rr(g, -L / 2 + 0.95, -W / 2 + 0.22, 0.5, 0.09, 0.02, '#e07b2a');
    }
    // 뒤쪽 사선 띠
    g.save(); g.beginPath(); g.rect(-L / 2 + 0.03, -W / 2 + 0.06, 0.09, W - 0.12); g.clip();
    for (let k = -2; k < 10; k++) { g.fillStyle = k % 2 ? '#f4d24a' : '#c0392b'; g.beginPath(); g.moveTo(-L / 2, -W / 2 + k * 0.16); g.lineTo(-L / 2 + 0.14, -W / 2 + k * 0.16 + 0.14); g.lineTo(-L / 2 + 0.14, -W / 2 + k * 0.16 + 0.3); g.lineTo(-L / 2, -W / 2 + k * 0.16 + 0.16); g.closePath(); g.fill(); }
    g.restore();
    rr(g, L / 2 - 0.05, -W / 2 + 0.1, 0.05, 0.16, 0.015, '#fff3c4'); rr(g, L / 2 - 0.05, W / 2 - 0.26, 0.05, 0.16, 0.015, '#fff3c4');
  } else if (kind === 'als' || kind === 'bls') {
    rr(g, -L / 2, -W / 2, L, W, 0.1, '#9aa5ae'); rr(g, -L / 2 + 0.03, -W / 2 + 0.03, L - 0.06, W - 0.06, 0.08, '#eef2f5');
    const cx0 = L / 2 - 0.78;
    // 측면 녹색·적색 띠
    g.fillStyle = '#23b386'; g.fillRect(-L / 2 + 0.06, -W / 2 + 0.06, L - 0.3, 0.08); g.fillRect(-L / 2 + 0.06, W / 2 - 0.14, L - 0.3, 0.08);
    g.fillStyle = '#d8423a'; g.fillRect(-L / 2 + 0.06, -W / 2 + 0.145, L - 0.3, 0.02); g.fillRect(-L / 2 + 0.06, W / 2 - 0.165, L - 0.3, 0.02);
    // 환자실 지붕
    rr(g, -L / 2 + 0.1, -W / 2 + 0.2, L - 0.98, W - 0.4, 0.05, '#f8fafb');
    const ex = -L / 2 + 0.1 + (L - 0.98) / 2;
    disc(g, ex, 0, 0.24, '#23b386'); g.fillStyle = '#ffffff'; g.fillRect(ex - 0.045, -0.16, 0.09, 0.32); g.fillRect(ex - 0.16, -0.045, 0.32, 0.09);
    rr(g, -L / 2 + 0.16, -0.1, 0.2, 0.2, 0.03, '#c6ced5');
    // 운전실
    rr(g, cx0, -W / 2 + 0.06, 0.74, W - 0.12, 0.12, '#e3e8ec');
    rr(g, L / 2 - 0.4, -W / 2 + 0.13, 0.18, W - 0.26, 0.05, glass); rr(g, L / 2 - 0.38, -W / 2 + 0.15, 0.05, W - 0.3, 0.03, glassHi);
    rr(g, cx0 + 0.08, -W / 2 + 0.075, 0.26, 0.05, 0.02, glass); rr(g, cx0 + 0.08, W / 2 - 0.125, 0.26, 0.05, 0.02, glass);
    lightbar(g, cx0 + 0.06, W, ca, cb, lights, timeMs);
    rr(g, -L / 2 + 0.01, -W / 2 + 0.1, 0.05, 0.14, 0.015, '#d8423a'); rr(g, -L / 2 + 0.01, W / 2 - 0.24, 0.05, 0.14, 0.015, '#d8423a');
    rr(g, L / 2 - 0.05, -W / 2 + 0.1, 0.05, 0.14, 0.015, '#fff3c4'); rr(g, L / 2 - 0.05, W / 2 - 0.24, 0.05, 0.14, 0.015, '#fff3c4');
  } else if (kind === 'patrol') {
    rr(g, -L / 2, -W / 2, L, W, 0.2, '#8d98a3'); rr(g, -L / 2 + 0.03, -W / 2 + 0.03, L - 0.06, W - 0.06, 0.18, '#eef1f4');
    rr(g, L / 2 - 0.62, -W / 2 + 0.05, 0.58, W - 0.1, 0.16, '#27477c'); rr(g, -L / 2 + 0.04, -W / 2 + 0.05, 0.42, W - 0.1, 0.16, '#27477c');
    g.fillStyle = '#f2c63c'; g.fillRect(-L / 2 + 0.46, -W / 2 + 0.035, L - 1.08, 0.045); g.fillRect(-L / 2 + 0.46, W / 2 - 0.08, L - 1.08, 0.045);
    // 객실: 앞유리, 지붕, 뒷유리
    rr(g, -0.52, -W / 2 + 0.1, 1.02, W - 0.2, 0.14, glass);
    rr(g, -0.3, -W / 2 + 0.13, 0.56, W - 0.26, 0.08, '#f4f6f8');
    rr(g, 0.3, -W / 2 + 0.16, 0.05, W - 0.32, 0.02, glassHi);
    lightbar(g, -0.02, W, ca, cb, lights, timeMs);
    rr(g, L / 2 - 0.05, -W / 2 + 0.1, 0.05, 0.16, 0.015, '#fff3c4'); rr(g, L / 2 - 0.05, W / 2 - 0.26, 0.05, 0.16, 0.015, '#fff3c4');
    rr(g, -L / 2, -W / 2 + 0.1, 0.045, 0.16, 0.015, '#d8423a'); rr(g, -L / 2, W / 2 - 0.26, 0.045, 0.16, 0.015, '#d8423a');
    rr(g, 0.26, -W / 2 - 0.04, 0.09, 0.06, 0.02, '#27477c'); rr(g, 0.26, W / 2 - 0.02, 0.09, 0.06, 0.02, '#27477c');
  } else {
    const navy = kind === 'swat' ? '#1b1e24' : kind === 'eod' ? '#2c3a2a' : '#1f2c44';
    rr(g, -L / 2, -W / 2, L, W, 0.12, '#0d1320'); rr(g, -L / 2 + 0.03, -W / 2 + 0.03, L - 0.06, W - 0.06, 0.1, navy);
    rr(g, -L / 2 + 0.1, -W / 2 + 0.12, L - 0.95, W - 0.24, 0.06, shade(navy, 0.12));
    g.fillStyle = kind === 'swat' ? '#5aa9ff' : kind === 'eod' ? '#e0872a' : '#e8edf2'; g.fillRect(-L / 2 + 0.2, -0.05, L - 1.2, 0.1);
    if (kind === 'swat') { rr(g, -0.2, -W / 2 + 0.16, 0.5, W - 0.32, 0.05, '#2a2f38'); disc(g, 0.05, 0, 0.13, '#12151a'); }
    if (kind === 'eod') { rr(g, -L / 2 + 0.12, -0.26, 0.5, 0.52, 0.06, '#1e271c'); disc(g, -L / 2 + 0.37, 0, 0.17, '#e0872a'); disc(g, -L / 2 + 0.37, 0, 0.1, '#1e271c'); }
    disc(g, -L / 2 + 0.6, 0, 0.2, '#141c2c'); disc(g, -L / 2 + 0.6, 0, 0.14, shade(navy, 0.2));
    rr(g, L / 2 - 0.5, -W / 2 + 0.12, 0.2, W - 0.24, 0.05, glass); rr(g, L / 2 - 0.48, -W / 2 + 0.14, 0.05, W - 0.28, 0.03, glassHi);
    rr(g, L / 2 - 0.26, -W / 2 + 0.08, 0.22, W - 0.16, 0.08, shade(navy, 0.06));
    lightbar(g, L / 2 - 0.68, W, ca, cb, lights, timeMs);
    rr(g, L / 2 - 0.02, -W / 2 + 0.08, 0.07, W - 0.16, 0.02, '#59636e');
    rr(g, L / 2 - 0.06, -W / 2 + 0.12, 0.05, 0.14, 0.015, '#fff3c4'); rr(g, L / 2 - 0.06, W / 2 - 0.26, 0.05, 0.14, 0.015, '#fff3c4');
  }
  g.restore();
}

export const CAR_COLORS = ['#8fa3b8', '#c9b458', '#b5564a', '#5f9a82', '#8f7cc0', '#d9dde1', '#3e4650', '#3f69a8'];
export interface CarOpts { wreck?: boolean; dim?: boolean; lights?: boolean; seed: number; damage?: number }
/** 위에서 본 일반 차량. len 은 타일 단위 길이, 앞이 +x. */
export function drawCar(g: G, x: number, y: number, ang: number, ts: number, len: number, color: string, o: CarOpts): void {
  const L = len, W = 0.84;
  g.save(); g.translate(x, y); g.scale(ts, ts);
  g.save(); g.translate(0.07, 0.1); g.rotate(ang); rr(g, -L / 2, -W / 2, L, W, 0.2, 'rgba(0,0,0,0.36)'); g.restore();
  g.rotate(ang);
  wheels(g, L * 0.92, W);
  const body = o.dim ? shade(color, -0.35) : color;
  rr(g, -L / 2, -W / 2, L, W, 0.2, shade(body, -0.4)); rr(g, -L / 2 + 0.03, -W / 2 + 0.03, L - 0.06, W - 0.06, 0.18, body);
  rr(g, L / 2 - 0.5, -W / 2 + 0.08, 0.42, W - 0.16, 0.12, shade(body, 0.1));              // 보닛
  rr(g, -L * 0.3, -W / 2 + 0.07, L * 0.56, W - 0.14, 0.13, '#17232e');                    // 유리
  rr(g, -L * 0.2, -W / 2 + 0.1, L * 0.32, W - 0.2, 0.08, shade(body, 0.18));              // 지붕
  rr(g, L * 0.16, -W / 2 + 0.12, 0.05, W - 0.24, 0.02, 'rgba(170,215,240,0.35)');
  rr(g, L / 2 - 0.05, -W / 2 + 0.08, 0.05, 0.15, 0.015, o.lights ? '#fff6d0' : '#d8d2bc'); rr(g, L / 2 - 0.05, W / 2 - 0.23, 0.05, 0.15, 0.015, o.lights ? '#fff6d0' : '#d8d2bc');
  rr(g, -L / 2, -W / 2 + 0.08, 0.045, 0.15, 0.015, '#c9362f'); rr(g, -L / 2, W / 2 - 0.23, 0.045, 0.15, 0.015, '#c9362f');
  rr(g, L * 0.14, -W / 2 - 0.045, 0.08, 0.06, 0.02, shade(body, -0.2)); rr(g, L * 0.14, W / 2 - 0.015, 0.08, 0.06, 0.02, shade(body, -0.2));
  if (o.wreck) {
    // 찌그러진 앞부분, 금 간 유리
    const h = (k: number): number => hash2(o.seed * 13 + k, 7);
    g.fillStyle = 'rgba(14,16,19,0.82)'; g.beginPath(); g.moveTo(L / 2 + 0.02, -W / 2 - 0.02);
    for (let k = 0; k <= 6; k++) g.lineTo(L / 2 - 0.16 - h(k) * 0.3, -W / 2 + (W * k) / 6);
    g.lineTo(L / 2 + 0.02, W / 2 + 0.02); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(235,245,250,0.7)'; g.lineWidth = 0.014; g.lineCap = 'round'; g.beginPath();
    for (let k = 0; k < 5; k++) { g.moveTo(L * 0.2, (h(10) - 0.5) * 0.3); g.lineTo(L * 0.2 - 0.1 - h(11 + k) * 0.16, (h(20 + k) - 0.5) * (W - 0.2)); }
    g.stroke();
    seg(g, L / 2 - 0.5, -0.2, L / 2 - 0.22, 0.12, 0.02, 'rgba(10,12,14,0.5)');
    for (let k = 0; k < 9; k++) { g.fillStyle = k % 3 ? 'rgba(200,235,245,0.8)' : 'rgba(30,34,38,0.8)'; g.fillRect(L / 2 - 0.1 + h(30 + k) * 0.5, (h(40 + k) - 0.5) * (W + 0.5), 0.035, 0.03); }
  }
  g.restore();
}

// ───────────────────────── 소품 ─────────────────────────
/** 잔해 더미 (칸 중심 기준, 단위 = 타일) */
export function drawDebris(g: G, seed: number): void {
  const h = (k: number): number => hash2(seed * 17 + k, 3);
  oval(g, 0.04, 0.07, 0.5, 0.44, 'rgba(0,0,0,0.38)');
  seg(g, -0.42, 0.3, 0.38, -0.32, 0.11, '#4a3a2a'); seg(g, -0.42, 0.3, 0.38, -0.32, 0.05, '#6b543a');
  const cols = ['#7d7468', '#958b7d', '#6a6258', '#a39a8c', '#5c564e'];
  for (let k = 0; k < 8; k++) {
    const cx = (h(k) - 0.5) * 0.66, cy = (h(k + 10) - 0.5) * 0.66, r = 0.1 + 0.11 * h(k + 20);
    g.fillStyle = cols[k % cols.length]; g.beginPath();
    for (let q = 0; q < 6; q++) { const a = (q / 6) * 6.2832 + h(k + 30) * 3, rad = r * (0.7 + 0.5 * h(k * 7 + q)); if (q) g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); else g.moveTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad); }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(cx - r * 0.2, cy - r * 0.25, r * 0.35, 0, 6.2832); g.fill();
  }
  seg(g, -0.1, -0.36, 0.3, 0.34, 0.02, '#8a5a3a'); seg(g, 0.06, -0.3, -0.34, 0.1, 0.018, '#50565c');
}
export function drawHydrant(g: G): void {
  oval(g, 0.05, 0.07, 0.26, 0.24, 'rgba(0,0,0,0.35)');
  rr(g, -0.3, -0.07, 0.6, 0.14, 0.04, '#a82c22'); rr(g, -0.07, -0.3, 0.14, 0.2, 0.04, '#a82c22');
  disc(g, 0, 0, 0.2, '#b93226'); disc(g, 0, 0, 0.16, '#d8443a'); disc(g, -0.03, -0.03, 0.09, '#ea6a5c');
  disc(g, 0, 0, 0.045, '#f1d9a0');
  disc(g, -0.29, 0, 0.05, '#e8c15a'); disc(g, 0.29, 0, 0.05, '#e8c15a');
}
export function drawGasTank(g: G, exploded: boolean): void {
  if (exploded) {
    g.fillStyle = 'rgba(6,6,7,0.7)'; g.beginPath();
    for (let q = 0; q < 14; q++) { const a = (q / 14) * 6.2832, r = q % 2 ? 0.6 : 0.3; if (q) g.lineTo(Math.cos(a) * r, Math.sin(a) * r); else g.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
    return;
  }
  oval(g, 0.05, 0.07, 0.25, 0.24, 'rgba(0,0,0,0.35)');
  disc(g, 0, 0, 0.23, '#8d99a3'); disc(g, 0, 0, 0.19, '#b7c1c9'); disc(g, -0.04, -0.04, 0.1, '#d6dde2');
  disc(g, 0, 0, 0.07, '#c0392b'); disc(g, 0, 0, 0.035, '#5c1a14');
  g.strokeStyle = '#59626b'; g.lineWidth = 0.03; g.beginPath(); g.arc(0, 0, 0.14, 0.5, 2.6); g.stroke();
}
export function drawCone(g: G): void {
  oval(g, 0.03, 0.04, 0.17, 0.16, 'rgba(0,0,0,0.3)');
  rr(g, -0.15, -0.15, 0.3, 0.3, 0.03, '#b5521c'); disc(g, 0, 0, 0.125, '#f07a2a'); disc(g, 0, 0, 0.085, '#f6f2ea'); disc(g, 0, 0, 0.05, '#f07a2a'); disc(g, 0, 0, 0.02, '#7a3410');
}
export function drawRoadDebris(g: G, seed: number): void {
  const h = (k: number): number => hash2(seed * 23 + k, 5);
  for (let k = 0; k < 9; k++) {
    const cx = (h(k) - 0.5) * 0.8, cy = (h(k + 9) - 0.5) * 0.8, r = 0.03 + 0.04 * h(k + 18), a = h(k + 27) * 6.28;
    g.fillStyle = k % 3 === 0 ? '#22262b' : k % 3 === 1 ? 'rgba(190,230,245,0.85)' : '#8b97a3';
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a + 2.2) * r, cy + Math.sin(a + 2.2) * r); g.lineTo(cx + Math.cos(a + 4.1) * r * 1.3, cy + Math.sin(a + 4.1) * r * 1.3); g.closePath(); g.fill();
  }
  if (h(40) > 0.5) { disc(g, 0.1, -0.08, 0.1, '#30363c'); disc(g, 0.1, -0.08, 0.07, '#8d97a1'); disc(g, 0.1, -0.08, 0.025, '#30363c'); }
}
export function drawClue(g: G, seed: number): void {
  // 발자국 한 쌍
  const a = hash2(seed, 91) * 6.28;
  g.save(); g.rotate(a);
  for (const [fx, fy] of [[-0.12, -0.08], [0.1, 0.09]]) { oval(g, fx, fy, 0.11, 0.05, 'rgba(40,30,18,0.75)'); oval(g, fx - 0.13, fy, 0.045, 0.04, 'rgba(40,30,18,0.75)'); }
  g.restore();
}

/** 문짝. 원점 = 문 칸 중심, 벽이 x 축을 따라 놓였다고 가정. open: 0 닫힘 … 1 열림. side: 열리는 쪽(+1 = +y). */
export function drawDoorLeaf(g: G, open: number, side: number, burned: boolean, locked: boolean): void {
  const hx = -0.4, len = 0.8;
  if (open > 0.02) {
    g.strokeStyle = 'rgba(230,236,242,0.2)'; g.lineWidth = 0.014; g.setLineDash([0.05, 0.05]);
    const oc = Math.min(open, 1);      // (G5) 진입 연출에서 문짝이 1 을 넘게 튕겨도 바닥의 흔적 호는 열림까지만
    g.beginPath(); if (side > 0) g.arc(hx, 0, len, 0, (Math.PI / 2) * oc); else g.arc(hx, 0, len, -(Math.PI / 2) * oc, 0); g.stroke(); g.setLineDash([]);
  }
  g.save(); g.translate(hx, 0); g.rotate(side * open * 1.62);
  rr(g, 0, -0.06, len, 0.12, 0.02, 'rgba(0,0,0,0.3)');
  const c = burned ? '#3a2e24' : '#b98d56';
  rr(g, 0, -0.05, len, 0.1, 0.02, shade(c, -0.35)); rr(g, 0.015, -0.035, len - 0.03, 0.07, 0.012, c);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(0.015, -0.035, len - 0.03, 0.02);
  disc(g, len - 0.1, 0, 0.03, '#e8d9a8');
  g.restore();
  disc(g, hx, 0, 0.035, '#3b434c');
  if (locked) {
    rr(g, -0.09, -0.04, 0.18, 0.15, 0.03, '#d6433a');
    g.strokeStyle = '#d6433a'; g.lineWidth = 0.035; g.beginPath(); g.arc(0, -0.04, 0.055, Math.PI, 0); g.stroke();
    disc(g, 0, 0.035, 0.022, '#3a0f0c');
  }
}

/** 금이 간 기둥. 보강한 뒤에는 지지대가 세워진다. */
export function drawUnstable(g: G, shored: boolean, seed: number): void {
  const h = (k: number): number => hash2(seed * 29 + k, 11);
  oval(g, 0.05, 0.07, 0.36, 0.34, 'rgba(0,0,0,0.36)');
  rr(g, -0.3, -0.3, 0.6, 0.6, 0.04, '#6f7479'); rr(g, -0.26, -0.26, 0.52, 0.52, 0.03, '#9aa0a5');
  g.strokeStyle = '#2a2d30'; g.lineWidth = 0.035; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-0.24, -0.2 + h(1) * 0.1); g.lineTo(-0.08, -0.04); g.lineTo(-0.02 + h(2) * 0.08, 0.02); g.lineTo(0.1, 0.16); g.lineTo(0.24, 0.2); g.stroke();
  g.lineWidth = 0.02; g.beginPath(); g.moveTo(-0.08, -0.04); g.lineTo(0.06, -0.2); g.moveTo(0.1, 0.16); g.lineTo(-0.04, 0.26); g.stroke();
  for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#8b8f93' : '#5f6468'; g.fillRect(-0.44 + h(10 + k) * 0.88, 0.3 + h(20 + k) * 0.14, 0.06, 0.05); }
  if (shored) {
    for (const [x0, y0, x1, y1] of [[-0.46, -0.46, -0.3, 0.46], [0.3, -0.46, 0.46, 0.46]]) { rr(g, x0, y0, x1 - x0, y1 - y0, 0.02, '#6b4a2a'); rr(g, x0 + 0.03, y0 + 0.03, x1 - x0 - 0.06, y1 - y0 - 0.06, 0.01, '#b98d56'); }
    seg(g, -0.38, -0.4, 0.38, 0.4, 0.07, '#6b4a2a'); seg(g, -0.38, -0.4, 0.38, 0.4, 0.035, '#c79a60');
    seg(g, 0.38, -0.4, -0.38, 0.4, 0.07, '#6b4a2a'); seg(g, 0.38, -0.4, -0.38, 0.4, 0.035, '#c79a60');
    for (const [bx, by] of [[-0.38, -0.4], [0.38, -0.4], [-0.38, 0.4], [0.38, 0.4]]) disc(g, bx, by, 0.035, '#d9dde1');
  }
}
/** 가스 배관과 밸브. state: 0 새는 중, 1 차단됨, 2 불이 붙었음 */
export function drawValve(g: G, state: number): void {
  oval(g, 0.04, 0.08, 0.5, 0.3, 'rgba(0,0,0,0.36)');
  rr(g, -0.5, -0.14, 1.0, 0.28, 0.05, state === 2 ? '#2b2724' : '#7d868e'); rr(g, -0.5, -0.1, 1.0, 0.09, 0.03, state === 2 ? '#3a3531' : '#b4bcc3');
  for (const fx of [-0.34, 0.34]) { rr(g, fx - 0.06, -0.2, 0.12, 0.4, 0.03, state === 2 ? '#1f1c1a' : '#59626b'); for (const by of [-0.15, 0.15]) disc(g, fx, by, 0.022, '#c9d0d6'); }
  rr(g, -0.09, -0.24, 0.18, 0.48, 0.04, state === 2 ? '#241f1c' : '#4d555d');
  const wheel = state === 1 ? '#3fae6a' : state === 2 ? '#3a2a22' : '#d8423a';
  g.strokeStyle = wheel; g.lineWidth = 0.055; g.beginPath(); g.arc(0, 0, 0.2, 0, 6.2832); g.stroke();
  g.lineWidth = 0.04; for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI; g.beginPath(); g.moveTo(Math.cos(a) * 0.2, Math.sin(a) * 0.2); g.lineTo(-Math.cos(a) * 0.2, -Math.sin(a) * 0.2); g.stroke(); }
  disc(g, 0, 0, 0.055, '#e8edf2');
}

/** 버스 (다수 사상자 사고). len 은 타일 단위 길이, 앞이 +x. */
export function drawBus(g: G, x: number, y: number, ang: number, ts: number, len: number, color: string, seed: number): void {
  const L = len, W = 0.98;
  g.save(); g.translate(x, y); g.scale(ts, ts);
  g.save(); g.translate(0.08, 0.12); g.rotate(ang); rr(g, -L / 2, -W / 2, L, W, 0.12, 'rgba(0,0,0,0.38)'); g.restore();
  g.rotate(ang);
  for (const wx of [-L * 0.32, L * 0.3]) { rr(g, wx - 0.2, -W / 2 - 0.04, 0.4, 0.1, 0.03, '#0e1114'); rr(g, wx - 0.2, W / 2 - 0.06, 0.4, 0.1, 0.03, '#0e1114'); }
  rr(g, -L / 2, -W / 2, L, W, 0.12, shade(color, -0.4)); rr(g, -L / 2 + 0.03, -W / 2 + 0.03, L - 0.06, W - 0.06, 0.1, color);
  rr(g, -L / 2 + 0.1, -W / 2 + 0.07, L - 0.5, 0.11, 0.03, '#17232e'); rr(g, -L / 2 + 0.1, W / 2 - 0.18, L - 0.5, 0.11, 0.03, '#17232e');      // 옆 유리
  for (let k = 1; k < 6; k++) { g.fillStyle = color; g.fillRect(-L / 2 + 0.1 + ((L - 0.5) * k) / 6 - 0.012, -W / 2 + 0.07, 0.024, 0.11); g.fillRect(-L / 2 + 0.1 + ((L - 0.5) * k) / 6 - 0.012, W / 2 - 0.18, 0.024, 0.11); }
  rr(g, -L / 2 + 0.16, -W / 2 + 0.22, L - 0.62, W - 0.44, 0.06, shade(color, 0.22));      // 지붕
  rr(g, -L * 0.22, -0.16, 0.34, 0.32, 0.04, shade(color, 0.05)); rr(g, L * 0.08, -0.16, 0.34, 0.32, 0.04, shade(color, 0.05));
  rr(g, -L / 2 + 0.26, -0.2, 0.3, 0.4, 0.04, '#aab2b9');
  rr(g, L / 2 - 0.34, -W / 2 + 0.1, 0.2, W - 0.2, 0.05, '#17232e'); rr(g, L / 2 - 0.32, -W / 2 + 0.12, 0.05, W - 0.24, 0.03, 'rgba(170,215,240,0.35)');
  rr(g, -L / 2, -W / 2 + 0.1, 0.045, 0.16, 0.015, '#c9362f'); rr(g, -L / 2, W / 2 - 0.26, 0.045, 0.16, 0.015, '#c9362f');
  // 찌그러진 앞부분
  const h = (k: number): number => hash2(seed * 13 + k, 7);
  g.fillStyle = 'rgba(14,16,19,0.82)'; g.beginPath(); g.moveTo(L / 2 + 0.02, -W / 2 - 0.02);
  for (let k = 0; k <= 6; k++) g.lineTo(L / 2 - 0.14 - h(k) * 0.26, -W / 2 + (W * k) / 6);
  g.lineTo(L / 2 + 0.02, W / 2 + 0.02); g.closePath(); g.fill();
  for (let k = 0; k < 10; k++) { g.fillStyle = k % 3 ? 'rgba(200,235,245,0.8)' : 'rgba(30,34,38,0.8)'; g.fillRect(L / 2 - 0.1 + h(30 + k) * 0.6, (h(40 + k) - 0.5) * (W + 0.6), 0.04, 0.03); }
  g.restore();
}
/** 물에 빠져 허우적거리는 사람: 머리와 팔, 번지는 물결 */
export function drawSwimmer(g: G, x: number, y: number, ts: number, k: PersonLook, t: number, ghost: number): void {
  g.save(); g.translate(x, y); g.scale(ts, ts); g.globalAlpha *= ghost;
  for (let q = 0; q < 2; q++) { const ph = (t * 0.7 + q * 0.5) % 1; g.strokeStyle = `rgba(210,240,250,${0.55 * (1 - ph)})`; g.lineWidth = 0.03; g.beginPath(); g.ellipse(0, 0.03, 0.2 + ph * 0.34, 0.14 + ph * 0.22, 0, 0, 6.2832); g.stroke(); }
  oval(g, 0, 0.06, 0.2, 0.13, 'rgba(12,40,56,0.5)');
  const w = Math.sin(t * 7);
  seg(g, -0.1, 0.02, -0.26, -0.12 - w * 0.08, 0.075, k.arm); disc(g, -0.27, -0.13 - w * 0.08, 0.045, k.hand);
  seg(g, 0.1, 0.02, 0.26, -0.12 + w * 0.08, 0.075, k.arm); disc(g, 0.27, -0.13 + w * 0.08, 0.045, k.hand);
  disc(g, 0, 0, 0.12, k.headCol); oval(g, 0, 0.045, 0.07, 0.05, k.skin);
  g.restore();
}

/** 헬기 세 종류의 도색: 소방 = 빨강·흰색, 경찰 = 남색·흰색에 하늘색 띠, 의료 = 흰색에 초록 띠와 빨간 십자 */
const HELI_PAINT: Record<string, { edge: string; body: string; roof: string; band: string; tail: string; fin: string; cross?: string }> = {
  heli: { edge: '#8f2a20', body: '#d64b3a', roof: '#f1ede2', band: '#d64b3a', tail: '#c0392b', fin: '#e9e4d8' },
  policeHeli: { edge: '#0f1728', body: '#1f2f55', roof: '#eef1f4', band: '#5ab4ff', tail: '#1f2f55', fin: '#5ab4ff' },
  medHeli: { edge: '#8d98a3', body: '#f4f6f8', roof: '#ffffff', band: '#23b386', tail: '#e3e8ec', fin: '#23b386', cross: '#d8423a' },
};
/**
 * 위에서 본 헬기. 앞이 +x. 떠 있으므로 그림자가 멀리 떨어진다.
 * kind = 도색(소방 · 경찰 · 의료). lift = 그림자가 떨어지는 거리(칸) — 주지 않으면 날개가 도는 동안 0.55, 서 있으면 0.12.
 * 현장 상공에 머무는 헬기(renderScene)는 더 높이 띄운다.
 */
export function drawHeli(g: G, x: number, y: number, ang: number, ts: number, lights: boolean, timeMs: number, kind: UnitKind = 'heli', liftBy?: number): void {
  const c = HELI_PAINT[kind] ?? HELI_PAINT.heli;
  g.save(); g.translate(x, y); g.scale(ts, ts);
  const lift = liftBy ?? (lights ? 0.55 : 0.12);
  g.save(); g.translate(lift, lift * 1.2); g.rotate(ang); oval(g, -0.1, 0, 0.95, 0.42, 'rgba(0,0,0,0.3)'); rr(g, -1.6, -0.07, 1.1, 0.14, 0.05, 'rgba(0,0,0,0.3)'); if (lights) disc(g, 0.05, 0, 1.5, 'rgba(0,0,0,0.07)'); g.restore();
  g.rotate(ang);
  rr(g, -0.7, -0.52, 1.3, 0.06, 0.02, '#3a4046'); rr(g, -0.7, 0.46, 1.3, 0.06, 0.02, '#3a4046');      // 착륙 스키드
  rr(g, -1.75, -0.06, 1.25, 0.12, 0.05, c.tail); rr(g, -1.8, -0.3, 0.1, 0.6, 0.03, c.tail); rr(g, -1.86, -0.2, 0.05, 0.4, 0.02, c.fin);      // 꼬리
  oval(g, 0, 0, 0.95, 0.44, c.edge); oval(g, 0, 0, 0.9, 0.4, c.body); oval(g, -0.2, 0, 0.5, 0.36, c.roof);
  g.fillStyle = c.band; g.fillRect(-0.24, -0.4, 0.14, 0.8);
  if (kind === 'policeHeli') { g.fillStyle = c.band; g.fillRect(-1.3, -0.06, 0.5, 0.12); }      // 꼬리의 하늘색 띠
  if (c.cross) { g.fillStyle = c.cross; g.fillRect(0.0, -0.18, 0.11, 0.36); g.fillRect(-0.125, -0.055, 0.36, 0.11); }      // 지붕의 빨간 십자
  oval(g, 0.52, 0, 0.36, 0.3, '#182734'); oval(g, 0.6, -0.08, 0.16, 0.1, 'rgba(160,210,240,0.4)');
  disc(g, -0.05, 0, 0.13, '#39424a');
  const a = (timeMs / (lights ? 26 : 600)) % 6.2832;
  if (lights) disc(g, -0.05, 0, 1.5, 'rgba(210,225,235,0.1)');
  g.save(); g.translate(-0.05, 0); g.rotate(a); g.fillStyle = lights ? 'rgba(40,46,52,0.55)' : '#2a2f36';
  for (let k = 0; k < 3; k++) { g.rotate(2.0944); g.fillRect(0, -0.045, 1.5, 0.09); }
  g.restore(); disc(g, -0.05, 0, 0.07, '#cdd3d8');
  if (lights) { const on = Math.floor(timeMs / 300) % 2 === 0; disc(g, -1.75, 0, 0.07, on ? '#ff5d5d' : '#5a1f1c'); disc(g, 0.2, 0.42, 0.05, on ? '#7dffb0' : '#1c4a30'); }
  g.restore();
}
/** 위에서 본 구조정. 앞이 +x. */
export function drawBoat(g: G, x: number, y: number, ang: number, ts: number, lights: boolean, timeMs: number): void {
  g.save(); g.translate(x, y); g.scale(ts, ts); g.rotate(ang);
  if (lights) { g.fillStyle = 'rgba(235,245,248,0.28)'; g.beginPath(); g.moveTo(-1.0, 0); g.lineTo(-2.9, -0.62); g.lineTo(-2.5, 0); g.lineTo(-2.9, 0.62); g.closePath(); g.fill(); }
  const hull = (k: number, col: string): void => { g.fillStyle = col; g.beginPath(); g.moveTo(1.35 * k, 0); g.quadraticCurveTo(0.9 * k, -0.5 * k, -0.2, -0.48 * k); g.lineTo(-1.3 * k, -0.44 * k); g.lineTo(-1.3 * k, 0.44 * k); g.lineTo(-0.2, 0.48 * k); g.quadraticCurveTo(0.9 * k, 0.5 * k, 1.35 * k, 0); g.closePath(); g.fill(); };
  hull(1.04, 'rgba(0,0,0,0.3)'); hull(1, '#e0712a'); hull(0.8, '#3a4650');
  rr(g, -0.5, -0.24, 0.8, 0.48, 0.08, '#eef1f4'); rr(g, 0.08, -0.2, 0.18, 0.4, 0.04, '#182734');
  rr(g, -1.28, -0.2, 0.2, 0.4, 0.04, '#2a2f36');
  const on = lights && Math.floor(timeMs / 220) % 2 === 0;
  disc(g, -0.2, 0, 0.09, on ? '#ff8a5a' : '#7a3a22'); if (on) disc(g, -0.2, 0, 0.34, 'rgba(255,138,90,0.25)');
  g.restore();
}

/** 길을 가로질러 쓰러진 나무의 한 토막 (칸 가운데 기준, 줄기는 위아래로 이어진다) */
export function drawFallenTree(g: G, seed: number, row: number): void {
  rr(g, -0.2, -0.56, 0.5, 1.12, 0.1, 'rgba(0,0,0,0.3)');
  rr(g, -0.26, -0.56, 0.5, 1.12, 0.12, '#5a4028'); rr(g, -0.2, -0.56, 0.2, 1.12, 0.08, '#77583a');
  g.fillStyle = 'rgba(0,0,0,0.2)'; for (let k = 0; k < 4; k++) g.fillRect(-0.26, -0.5 + k * 0.28 + hash2(seed, k) * 0.08, 0.5, 0.03);
  for (let k = 0; k < 5; k++) { const a = hash2(seed, 10 + k) * 6.28, d = 0.3 + hash2(seed, 20 + k) * 0.35; disc(g, Math.cos(a) * d + 0.05, Math.sin(a) * d * 0.9, 0.2 + hash2(seed, 30 + k) * 0.14, ['#2b6a3a', '#3f8a4a', '#1f4f2c'][k % 3]); }
  if (row % 2) { seg(g, 0.2, 0, 0.62, -0.18, 0.07, '#5a4028'); disc(g, 0.66, -0.2, 0.16, '#3f8a4a'); }
}
/** 뚜껑이 열린 맨홀 */
export function drawManhole(g: G): void {
  disc(g, 0, 0, 0.36, '#3a4046'); disc(g, 0, 0, 0.3, '#0c0f12'); disc(g, -0.05, -0.05, 0.3, '#07090b');
  disc(g, 0.5, 0.26, 0.31, 'rgba(0,0,0,0.3)'); disc(g, 0.46, 0.2, 0.3, '#59626b'); disc(g, 0.46, 0.2, 0.22, '#4a525b');
  g.strokeStyle = '#6b747d'; g.lineWidth = 0.03; for (let k = -1; k <= 1; k++) { g.beginPath(); g.moveTo(0.28, 0.2 + k * 0.1); g.lineTo(0.64, 0.2 + k * 0.1); g.stroke(); }
}
