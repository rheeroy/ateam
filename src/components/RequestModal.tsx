// 팀장 → 팀원 요청 (팀원 화면에 할 일로 뜬다)
import { useEffect, useState } from 'react';
import { HeartHandshake, Send, Sprout, type LucideIcon } from 'lucide-react';
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
  meeting: { label: '1on1·미팅', example: '이번 주에 30분 이야기 나눠요' },
  other: { label: '기타', example: '' },
  grow: { label: '성장 제안', example: '다음에 맡아 볼 성장 과제를 같이 정해 봐요' },
  cheer: { label: '팀장님 격려', example: '요즘 어떤지 편하게 이야기 나눠요 — 도울 일이 있으면 말해 주세요' },
  change: { label: '목표 변경 요청', example: '' },
};
/** 일반 '요청 보내기' 창의 탭 — 성장 제안·격려는 팀원 상세의 육성·지원·격려 버튼 전용 */
const GENERAL_KINDS: TeamRequest['kind'][] = ['plan', 'progress', 'share', 'meeting', 'other'];

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
          {GENERAL_KINDS.map((k) => (
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

// ---------------------------------------------------------------------
// 팀원 상세 · Core Insight 의 액션 버튼 전용 — 탭 없이 버튼 목적 그대로
//   업무 독려 → 진척 공유(progress) · 육성 → 성장 제안(grow) · 지원·격려 → 팀장님 격려(cheer, 평가 근거로 안 남음)
// ---------------------------------------------------------------------
export type ActionReqType = 'push' | 'develop' | 'support';
const ACTION_REQ: Record<ActionReqType, { kind: TeamRequest['kind']; title: string; icon: LucideIcon; tone: string; purpose: (n: string) => string; phrases: string[]; dueDays?: number; sent: (n: string) => string }> = {
  push: {
    kind: 'progress', title: '업무 독려', icon: Send, tone: 'bg-violet-600',
    purpose: (n) => `맡은 일 전반의 진척과 막힌 점을 공유해 달라고 부탁합니다. ${n} 님 홈에 '진척 공유' 할 일로 뜨고, 남기면 팀장님께 알림이 갑니다.`,
    phrases: ['진행 상황과 막힌 점 공유 부탁해요', '지금까지 한 것과 남은 것을 짧게 정리해 줘요', '막힌 게 있으면 같이 풀어요 — 편하게 올려 줘요'],
    dueDays: 3, sent: (n) => `${n} 님에게 진척 공유를 부탁했습니다.`,
  },
  develop: {
    kind: 'grow', title: '육성', icon: Sprout, tone: 'bg-emerald-600',
    purpose: (n) => `다음에 맡아 볼 역할이나 성장 과제를 같이 정하자고 제안합니다. ${n} 님 홈에 '성장 제안'으로 뜨고, ${n} 님이 답을 남길 수 있습니다.`,
    phrases: ['다음에 맡아 볼 성장 과제를 같이 정해 봐요', '요즘 해 보고 싶은 일이 있으면 알려 줘요', '이번 분기에 한 단계 더 큰 역할을 맡아 보면 어때요?'],
    sent: (n) => `${n} 님에게 성장 제안을 보냈습니다.`,
  },
  support: {
    kind: 'cheer', title: '지원·격려', icon: HeartHandshake, tone: 'bg-rose-500',
    purpose: (n) => `평가와 상관없는 격려의 말입니다. ${n} 님 홈에 '팀장님 격려'로 뜨고, 평가 근거로는 남지 않습니다.`,
    phrases: ['요즘 어떤지 편하게 이야기 나눠요 — 도울 일이 있으면 말해 주세요', '혼자 풀기 어려운 게 있으면 편하게 말해 줘요. 같이 볼게요.', '요즘 애쓰는 거 보고 있어요. 무리하지 말아요.'],
    sent: (n) => `${n} 님에게 격려를 보냈습니다.`,
  },
};
const plusDays = (d: number) => { const x = new Date(Date.now() + d * 86400000); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

export function ActionRequestModal({ type, toId, name, defaultText, onClose, onSent, onScheduleOo }: {
  type: ActionReqType; toId: string; name: string; defaultText?: string; onClose: () => void; onSent?: () => void; onScheduleOo?: () => void;
}) {
  const { team } = useTeam();
  const toast = useToast();
  const qc = useQueryClient();
  const C = ACTION_REQ[type];
  const [text, setText] = useState(defaultText?.trim() || C.phrases[0]);
  const [due, setDue] = useState(C.dueDays ? plusDays(C.dueDays) : '');
  const [oo, setOo] = useState(false);
  const send = useMutation({
    mutationFn: () => q(supabase.from('team_requests').insert({ team_id: team.id, to_id: toId, kind: C.kind, title: text.trim(), body: '', due_date: C.dueDays && due ? due : null })),
    onSuccess: () => { toast(C.sent(name)); qc.invalidateQueries({ queryKey: ['requests'] }); onSent?.(); onClose(); if (oo) onScheduleOo?.(); },
    onError: (e) => toast(/team_requests_kind_check|violates check/.test(errorText(e)) ? '요청 종류가 아직 추가되지 않았습니다. 14_request_kinds.sql 을 실행해 주세요.' : errorText(e)),
  });
  return (
    <Modal open onClose={onClose} title={<span className="inline-flex items-center gap-2"><span className={cx('w-6 h-6 rounded-md text-white flex items-center justify-center', C.tone)}><C.icon size={13} /></span>{C.title} · {name}</span>}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send.mutate(); }}>
        <p className="text-sm text-slate-600 leading-relaxed rounded-lg bg-slate-50 px-3 py-2">{C.purpose(name)}</p>
        <textarea rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {C.phrases.map((p) => <button type="button" key={p} onClick={() => setText(p)} className={cx('text-[11px] rounded-full border px-2.5 py-1 text-left', text === p ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>{p}</button>)}
        </div>
        {!!C.dueDays && <Field label="언제까지" hint="선택"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>}
        {type === 'support' && onScheduleOo && (
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer"><input type="checkbox" className="accent-rose-500" checked={oo} onChange={(e) => setOo(e.target.checked)} />보낸 뒤 바로 1on1 일정도 잡기</label>
        )}
        <Button type="submit" className="w-full" loading={send.isPending} disabled={!text.trim()}>보내기</Button>
      </form>
    </Modal>
  );
}
