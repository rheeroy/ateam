// 컨디션 공유 — AI 입력용 글 (src/lib/condition.ts 와 키를 맞춘다)
//   업무 내용이 아니라 사람의 상태. 평가·주간보고(위로 올라가는 글)에는 넣지 않는다.
export const COND_LABEL: Record<number, string> = { 1: '많이 지침', 2: '다소 지침', 3: '보통', 4: '양호', 5: '매우 좋음' };
import { MOOD_LABEL } from './signals.ts';
export { MOOD_LABEL, HEAVY_MOODS } from './signals.ts';

export type CondRow = { condition?: number | null; moods?: string[] | null; note?: string | null };
export function conditionText(c: CondRow): string {
  const parts: string[] = [];
  if (c.condition != null) parts.push(`컨디션 ${c.condition}/5 (${COND_LABEL[c.condition] ?? ''})`);
  const ms = (c.moods ?? []).map((k) => MOOD_LABEL[k] ?? k);
  if (ms.length) parts.push(`영향 요인: ${ms.join(', ')}`);
  if (c.note?.trim()) parts.push(`메모: ${c.note.trim()}`);
  return parts.join(' / ') || '입력 없음';
}
