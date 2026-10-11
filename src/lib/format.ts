export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

/** 이번 주 월요일 (로컬 기준) YYYY-MM-DD */
export function mondayOf(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay() || 7;
  x.setDate(x.getDate() - day + 1);
  return ymd(x);
}
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function addDays(s: string, n: number) {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function weekLabel(s: string) {
  const d = new Date(s + 'T00:00:00');
  const onejan = new Date(d.getFullYear(), 0, 1);
  const w = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `W${String(w).padStart(2, '0')}`;
}

export function weekRangeLabel(monday: string) {
  const d = new Date(monday + 'T00:00:00');
  const end = new Date(d);
  end.setDate(d.getDate() + 4);
  // 그 달의 첫 목요일이 들어 있는 주를 1주차로 센다 (월요일 시작)
  const thu = new Date(d); thu.setDate(d.getDate() + 3);
  const nth = Math.ceil(thu.getDate() / 7);
  return `${thu.getMonth() + 1}월 ${nth}주차 (${d.getMonth() + 1}/${d.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()})`;
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];
export function fmtDate(s: string | null | undefined, withDay = false) {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일${withDay ? ` (${WD[d.getDay()]})` : ''}`;
}
export function fmtShort(s: string | null | undefined) {
  if (!s) return '';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}
export function fmtTime(s: string) {
  const d = new Date(s);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function daysAgo(s: string) {
  return Math.floor((Date.now() - new Date(s).getTime()) / 86400000);
}
export function relDay(s: string) {
  const d = new Date(s);
  const today = new Date();
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
    new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === -1) return '어제';
  if (diff > 1 && diff < 7) return WD[d.getDay()];
  return fmtShort(s);
}
export const won = (n: number) => `₩${n.toLocaleString('ko-KR')}`;
export const num = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '-' : Number(n).toFixed(digits).replace(/\.0+$/, '');
export const initial = (name: string | undefined | null) => (name ?? '?').trim().slice(0, 1) || '?';
export const sign = (n: number, digits = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(digits).replace(/\.0+$/, '');
