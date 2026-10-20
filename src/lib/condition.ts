// 컨디션 공유 — 업무가 아닌 '사람'의 상태. 팀장만 열람하고, 평가·업무 보고에는 쓰지 않는다.
//   컨디션 5단계 + 영향 요인(복수) + 선택 메모. (1on1 요청은 '팀장님과' 우측 상단 버튼)
//   키는 DB(checkins.moods)와 AI 함수(supabase/functions/_shared/signals.ts MOOD_LABEL)가 같이 쓴다 — 바꾸면 양쪽 다.

export const CONDITIONS = [
  { n: 1, label: '많이 지침' },
  { n: 2, label: '다소 지침' },
  { n: 3, label: '보통' },
  { n: 4, label: '양호' },
  { n: 5, label: '매우 좋음' },
] as const;

export type MoodKey = 'rested' | 'energized' | 'good_news' | 'tired' | 'unwell' | 'heavy' | 'personal' | 'need_rest';
/** 화면에 보이는 영향 요인 (good_news 는 예전 값 — 표시만) */
export const MOODS: { key: Exclude<MoodKey, 'good_news'>; label: string; good: boolean }[] = [
  { key: 'rested', label: '충분한 휴식', good: true },
  { key: 'energized', label: '의욕 높음', good: true },
  { key: 'tired', label: '수면 부족·피로', good: false },
  { key: 'unwell', label: '건강 문제', good: false },
  { key: 'heavy', label: '심리적 부담', good: false },
  { key: 'personal', label: '개인·가족 사정', good: false },
  { key: 'need_rest', label: '휴식 필요', good: false },
];
const EXTRA: Record<string, string> = { good_news: '좋은 소식' };
export const moodLabel = (k: string) => EXTRA[k] ?? MOODS.find((m) => m.key === k)?.label ?? k;
export const isGoodMood = (k: string) => k === 'good_news' || !!MOODS.find((m) => m.key === k)?.good;
export const conditionLabel = (n: number | null | undefined) => CONDITIONS.find((c) => c.n === n)?.label ?? null;

/** 컨디션 숫자 → 색 (점·막대) */
export const condDot = (n: number | null | undefined) =>
  n == null ? 'bg-slate-200' : n <= 1 ? 'bg-rose-500' : n === 2 ? 'bg-orange-400' : n === 3 ? 'bg-amber-400' : n === 4 ? 'bg-emerald-400' : 'bg-teal-500';
