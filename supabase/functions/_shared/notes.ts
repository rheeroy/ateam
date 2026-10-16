// 팀장 개인 메모(leader_notes) 중 'AI 참고 허용'을 켠 것만 근거로 넣는다.
//   쓰는 곳: 1:1 준비 노트 · 팀원 액션 · ATEAM의 제안 · 임원 브리핑. 평가 초안에는 넣지 않는다(평가 근거는 관찰 메모만).
import { admin } from './supabase.ts';
import type { SourceBook } from './gateway.ts';

export interface LeaderNoteRow { id: string; body: string; kind: string; anchor_type: string; anchor_id: string | null; anchor_label: string; updated_at: string }
/** 메모를 읽는 기능의 system 프롬프트 끝에 붙인다 */
export const NOTE_RULE = `\n\n[팀장 개인 메모] 근거 중 '팀장 개인 메모'는 팀장이 자기만 보려고 적은 생각·관찰입니다. 사실로 단정하지 말고 판단의 맥락으로만 쓰며, 메모 문장을 그대로 옮겨 적지 않습니다. 팀원에 대한 메모를 평가나 등급의 근거로 쓰지 않습니다.`;

const KIND: Record<string, string> = { member: '팀원', item: '목표·과제', exec: '상위 관리자', decision: '결정', one_on_one: '1:1', none: '' };

/** 허용된 메모 불러오기 (테이블이 아직 없으면 빈 목록) */
export async function loadLeaderNotes(teamId: string, ownerId: string, opt: { types?: string[]; ids?: string[]; limit?: number } = {}): Promise<LeaderNoteRow[]> {
  let qb = admin.from('leader_notes').select('id, body, kind, anchor_type, anchor_id, anchor_label, updated_at')
    .eq('team_id', teamId).eq('owner_id', ownerId).eq('ai_allowed', true).eq('done', false);
  if (opt.types?.length) qb = qb.in('anchor_type', opt.types);
  if (opt.ids?.length) qb = qb.in('anchor_id', opt.ids);
  const { data, error } = await qb.order('updated_at', { ascending: false }).limit(opt.limit ?? 10);
  return error || !data ? [] : (data as LeaderNoteRow[]);
}

/** 근거 장부에 '팀장 개인 메모'로 넣고 태그를 돌려준다 */
export function addNote(book: SourceBook, n: LeaderNoteRow, name?: string): string {
  const target = n.anchor_type !== 'none' ? ` · ${KIND[n.anchor_type] ?? ''} ${name || n.anchor_label}`.trimEnd() : '';
  return book.add('my_note', n.id, `팀장 개인 메모${target} · ${n.updated_at.slice(0, 10)}`, `${n.kind === 'todo' ? '(팀장 할 일) ' : ''}${n.body}`);
}

export async function addLeaderNotes(book: SourceBook, teamId: string, ownerId: string, opt: { types?: string[]; ids?: string[]; limit?: number; nameOf?: (n: LeaderNoteRow) => string | undefined } = {}): Promise<string[]> {
  const rows = await loadLeaderNotes(teamId, ownerId, opt);
  return rows.map((n) => addNote(book, n, opt.nameOf?.(n)));
}
