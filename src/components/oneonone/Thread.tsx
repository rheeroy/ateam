// 1on1 함께 보는 노트 — 한 줄씩 쌓는 대화 기록 (작성자 · 시간)
//   한 칸을 같이 고치던 방식은 마지막 저장이 앞사람 글을 지웠다. 이제는 각자 남기고, 내 글만 고치고 지운다.
//   실시간 동기화는 아니고, 열어 둔 동안 20초마다 새 글을 불러온다.
//   데이터: one_on_one_entries (24_condition.sql). one_on_ones.shared_notes 는 서버가 이어 붙이는 읽기용 사본.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import type { OneOnOne, OneOnOneEntry } from '../../lib/types';
import { cx, fmtDate, fmtTime } from '../../lib/format';
import { Avatar, Button, useToast } from '../ui';

export function useEntries(ooId: string, live = true) {
  return useQuery({
    queryKey: ['oo-entries', ooId],
    queryFn: async () => {
      const { data, error } = await supabase.from('one_on_one_entries').select('*').eq('one_on_one_id', ooId).order('created_at');
      if (error) { if (/one_on_one_entries/.test(error.message)) return [] as OneOnOneEntry[]; throw new Error(error.message); }
      return data as OneOnOneEntry[];
    },
    refetchInterval: live ? 20_000 : false,
  });
}

function useEntryMutations(oo: OneOnOne) {
  const { uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const done = () => ['oo-entries', 'oo-detail', 'my-oo', 'oo'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const fail = (e: unknown) => toast(/one_on_one_entries/.test(errorText(e)) ? '1on1 노트 SQL(24_condition.sql)을 먼저 실행해 주세요.' : errorText(e));
  return {
    add: useMutation({ mutationFn: (body: string) => q(supabase.from('one_on_one_entries').insert({ one_on_one_id: oo.id, team_id: oo.team_id, author_id: uid, body })), onSuccess: done, onError: fail }),
    edit: useMutation({ mutationFn: (p: { id: string; body: string }) => q(supabase.from('one_on_one_entries').update({ body: p.body }).eq('id', p.id)), onSuccess: done, onError: fail }),
    del: useMutation({ mutationFn: (id: string) => q(supabase.from('one_on_one_entries').delete().eq('id', id)), onSuccess: done, onError: fail }),
  };
}

/** 글 목록 + 입력창. compact: 최근 몇 개만 (팀원 '다음 1on1' 상자) */
export function OneOnOneThread({ oo, compact, placeholder, prefill, onPrefillUsed }: {
  oo: OneOnOne; compact?: boolean; placeholder?: string; prefill?: string; onPrefillUsed?: () => void;
}) {
  const { uid, nameOf } = useTeam();
  const entries = useEntries(oo.id);
  const m = useEntryMutations(oo);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!prefill) return;
    setDraft((d) => (d.trim() ? `${d}\n${prefill}` : prefill));
    onPrefillUsed?.(); area.current?.focus();
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => { const b = draft.trim(); if (!b) return; m.add.mutate(b, { onSuccess: () => setDraft('') }); };
  const list = entries.data ?? [];
  const shown = compact ? list.slice(-3) : list;

  return (
    <div>
      {!!list.length && (
        <ul className={cx('space-y-3', compact ? 'mb-2.5' : 'mb-4')}>
          {compact && list.length > shown.length && <li className="text-[11px] text-slate-400">이전 글 {list.length - shown.length}개</li>}
          {shown.map((e) => {
            const mine = e.author_id === uid && !e.legacy;
            const leader = e.author_id === oo.leader_id;
            const isEdit = editing?.id === e.id;
            return (
              <li key={e.id} className="flex items-start gap-2.5">
                {e.legacy ? <span className="w-7 h-7 rounded-full bg-slate-100 shrink-0" /> : <Avatar name={nameOf(e.author_id ?? '')} size={7} tone={leader ? 'indigo' : 'slate'} />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-600">{e.legacy ? '이전 노트' : nameOf(e.author_id ?? '')}</span>
                    {!e.legacy && leader && <span>팀장</span>}
                    <span>· {fmtDate(e.created_at)} {fmtTime(e.created_at)}</span>
                    {e.updated_at > e.created_at && Date.parse(e.updated_at) - Date.parse(e.created_at) > 60_000 && <span>· 수정됨</span>}
                    {mine && !isEdit && (
                      <span className="ml-auto flex gap-2">
                        <button className="hover:text-slate-700" onClick={() => setEditing({ id: e.id, body: e.body })}>고치기</button>
                        <button className="hover:text-rose-600" onClick={() => { if (confirm('이 글을 지울까요?')) m.del.mutate(e.id); }}>지우기</button>
                      </span>
                    )}
                  </div>
                  {isEdit ? (
                    <div className="mt-1">
                      <textarea autoFocus rows={Math.min(6, Math.max(2, editing!.body.split('\n').length))} value={editing!.body} onChange={(ev) => setEditing({ id: e.id, body: ev.target.value })}
                        className="w-full text-sm rounded-lg ring-1 ring-slate-300 border-0 px-3 py-2 focus:ring-slate-500" />
                      <div className="mt-1 flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>취소</Button>
                        <Button size="sm" variant="secondary" disabled={!editing!.body.trim()} loading={m.edit.isPending}
                          onClick={() => m.edit.mutate({ id: e.id, body: editing!.body.trim() }, { onSuccess: () => setEditing(null) })}>저장</Button>
                      </div>
                    </div>
                  ) : (
                    <p className={cx('mt-0.5 text-sm whitespace-pre-line leading-relaxed', e.legacy ? 'text-slate-500' : 'text-slate-800')}>{e.body}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className={cx('flex gap-2', compact ? 'flex-col items-end' : 'items-end')}>
        <textarea ref={area} rows={Math.min(5, Math.max(2, draft.split('\n').length))} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          placeholder={placeholder ?? '남길 내용 (Ctrl+Enter로 남기기)'}
          className={cx('text-sm bg-white rounded-lg ring-1 ring-slate-200 border-0 px-3 py-2 placeholder:text-slate-400 focus:ring-slate-400 resize-none', compact ? 'w-full' : 'flex-1')} />
        <Button size="sm" disabled={!draft.trim()} loading={m.add.isPending} onClick={send}><Send size={13} />남기기</Button>
      </div>
    </div>
  );
}
