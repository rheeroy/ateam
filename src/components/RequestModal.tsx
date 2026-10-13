// 팀장 → 팀원 요청 (팀원 화면에 할 일로 뜬다)
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import type { TeamRequest } from '../lib/types';
import { cx } from '../lib/format';
import { Button, Field, Modal, inputCls, useToast } from './ui';

export const REQUEST_KIND: Record<TeamRequest['kind'], { label: string; example: string }> = {
  plan: { label: '계획 세우기', example: '이 목표 아래 과제와 일정을 세워 주세요' },
  progress: { label: '진척 공유', example: '진행 상황과 막힌 점을 업데이트해 주세요' },
  share: { label: '자료 올리기', example: '회의 자료를 ATEAM에 올려 주세요' },
  meeting: { label: '1:1·미팅', example: '이번 주에 30분 이야기 나눠요' },
  other: { label: '기타', example: '' },
};

export function RequestModal({ open, onClose, toId, itemId, defaultKind = 'other', defaultTitle = '', onSent }: {
  open: boolean; onClose: () => void; toId?: string | null; itemId?: string | null; defaultKind?: TeamRequest['kind']; defaultTitle?: string; onSent?: () => void;
}) {
  const { team, members, uid } = useTeam();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ to: toId ?? '', kind: defaultKind, title: defaultTitle, body: '', due: '' });
  useEffect(() => { if (open) setF({ to: toId ?? '', kind: defaultKind, title: defaultTitle, body: '', due: '' }); }, [open, toId, defaultKind, defaultTitle]);
  const send = useMutation({
    mutationFn: () => q(supabase.from('team_requests').insert({
      team_id: team.id, to_id: f.to, kind: f.kind, item_id: itemId ?? null,
      title: f.title.trim() || REQUEST_KIND[f.kind].example || '요청', body: f.body, due_date: f.due || null,
    })),
    onSuccess: () => { toast('요청을 보냈습니다. 팀원 화면에 할 일로 뜹니다.'); qc.invalidateQueries({ queryKey: ['requests'] }); qc.invalidateQueries({ queryKey: ['items'] }); onSent?.(); onClose(); },
    onError: (e) => toast(errorText(e)),
  });
  const targets = members.filter((m) => m.user_id !== uid);
  return (
    <Modal open={open} onClose={onClose} title="요청 보내기">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (f.to) send.mutate(); }}>
        <Field label="받는 사람">
          <select required className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
            <option value="">선택</option>{targets.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
          </select>
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(REQUEST_KIND) as TeamRequest['kind'][]).map((k) => (
            <button type="button" key={k} onClick={() => setF({ ...f, kind: k, title: f.title || '' })}
              className={cx('text-xs border rounded-full px-2.5 py-1', f.kind === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>{REQUEST_KIND[k].label}</button>
          ))}
        </div>
        <Field label="요청"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={REQUEST_KIND[f.kind].example} /></Field>
        <Field label="덧붙일 말" hint="선택"><textarea rows={2} className={inputCls} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <Field label="기한" hint="선택"><input type="date" className={inputCls} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        <Button type="submit" className="w-full" loading={send.isPending} disabled={!f.to}>보내기</Button>
      </form>
    </Modal>
  );
}
