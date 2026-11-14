export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const dist = (ax: number, ay: number, bx: number, by: number): number => Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by));

const pad = (n: number): string => (n < 10 ? '0' + n : '' + n);
/** 초 → HH:MM:SS (하루 기준 시각) */
export function fmtClock(sec: number): string {
  const s = Math.floor(sec) % 86400;
  return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
}
/** 초 → M:SS */
export function fmtDur(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '-';
  const s = Math.round(sec);
  return Math.floor(s / 60) + ':' + pad(s % 60);
}
export function fmtSec(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '-';
  const s = Math.round(sec);
  return s >= 60 ? Math.floor(s / 60) + '분 ' + (s % 60) + '초' : s + '초';
}
export const pct = (v: number): string => Math.round(v * 100) + '%';

export const TYPE_NAME: Record<string, string> = { fire: '건물 화재', traffic: '교통사고', search: '실종·조난', armed: '무장 사건', medical: '응급 환자', collapse: '건물 붕괴', hazmat: '가스 누출', water: '수난 사고' };
export const DEPT_NAME: Record<string, string> = { fire: '소방', ems: '구급', police: '경찰' };
export const DISTRICT_NAME: Record<string, string> = { residential: '주거 구역', commercial: '상업 구역', industrial: '산업 구역', outskirts: '외곽 구역' };
export const OUTCOME_NAME: Record<string, string> = { success: '성공', partial: '부분 성공', delayed: '대응 지연', unresolved: '미해결', failed: '실패' };
export const WEATHER_NAME: Record<string, string> = { clear: '맑음', rain: '비', fog: '안개', night: '야간' };

const LATIN_BATCHIM = 'LMNR';
const DIGIT_BATCHIM = '013678';
/** 한국어 조사 선택. josa('구조1', '이/가') → '구조1이' */
export function josa(word: string, pair: '은/는' | '이/가' | '을/를' | '으로/로' | '과/와' | '이에요/예요'): string {
  const [withB, without] = pair.split('/');
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  let jong = 0;
  if (code >= 0xac00 && code <= 0xd7a3) jong = (code - 0xac00) % 28;
  else if (DIGIT_BATCHIM.indexOf(ch) >= 0) jong = ch === '1' || ch === '7' || ch === '8' ? 8 : 1;
  else if (LATIN_BATCHIM.indexOf(ch.toUpperCase()) >= 0) jong = ch.toUpperCase() === 'L' ? 8 : 1;
  if (pair === '으로/로') return word + (jong === 0 || jong === 8 ? without : withB);
  return word + (jong === 0 ? without : withB);
}
