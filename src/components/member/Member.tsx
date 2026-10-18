// 팀원 앱 공용 조각 — 지금 할 일(보완 요청 · 1:1 약속), 받은 칭찬, 1:1 요청, 메뉴 배지
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Circle, ListTodo, MessageSquarePlus, RotateCcw } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import type { ActionItem, Submission } from '../../lib/types';
import { cx, fmtDate, fmtShort } from '../../lib/format';
import { Button, Card, CardHead, Field, Modal, inputCls, useToast } from '../ui';

type Promise_ = ActionItem & { one_on_ones: { member_id: string; leader_id: string } | null };

/** 내 1:1 약속 (내 것 + 내 1:1에서 팀장이 약속한 것) */
export function usePromises() {
  const { team, uid } = useTeam();
  return useQuery({
    queryKey: ['my-promises', team.id, uid],
    queryFn: () => q<Promise_[]>(supabase.from('action_items').select('*, one_on_ones(member_id, leader_id)').eq('team_id', team.id).is('done_at', null).order('due_date', { nullsFirst: false })),
    select: (rows) => rows.filter((a) => a.owner_id === uid || a.one_on_ones?.member_id === uid),
  });
}

/** 보완 요청 받은 내 결과물 */
export function useNeedsWork() {
  const { team, uid } = useTeam();
  return useQuery({
    queryKey: ['subs', team.id, 'needs-work', uid],
    queryFn: () => q<Submission[]>(supabase.from('submissions').select('*').eq('team_id', team.id).eq('author_id', uid).eq('status', 'needs_work').is('closed_at', null).order('updated_at', { ascending: false })),
  });
}

export function useTogglePromise() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (a: ActionItem) => q(supabase.from('action_items').update({ done_at: a.done_at ? null : new Date().toISOString() }).eq('id', a.id)),
    onSuccess: (_d, a) => { qc.invalidateQueries({ queryKey: ['my-promises'] }); qc.invalidateQueries({ queryKey: ['my-actions'] }); qc.invalidateQueries({ queryKey: ['member-badges'] }); if (!a.done_at) toast('완료로 표시했습니다. 팀장님도 볼 수 있습니다.'); },
    onError: (e) => toast(errorText(e)),
  });
}

/** 약속 목록 — 내 것은 체크, 팀장님 것은 보기만 */
export function PromiseList({ compact }: { compact?: boolean }) {
  const { uid, nameOf } = useTeam();
  const p = usePromises();
  const toggle = useTogglePromise();
  const today = new Date().toISOString().slice(0, 10);
  const mine = (p.data ?? []).filter((a) => a.owner_id === uid);
  const theirs = (p.data ?? []).filter((a) => a.owner_id !== uid);
  if (!p.data?.length) return <p className="text-sm text-slate-500">1:1에서 정한 약속이 없습니다.</p>;
  return (
    <div className="space-y-3">
      {!!mine.length && (
        <ul className="space-y-1.5">
          {mine.map((a) => (
            <li key={a.id} className="flex items-start gap-2 text-sm">
              <button onClick={() => toggle.mutate(a)} title="완료 표시" className="mt-0.5 text-slate-300 hover:text-indigo-600"><Circle size={16} /></button>
              <span className="flex-1">{a.title}</span>
              {a.due_date && <span className={cx('text-xs num shrink-0', a.due_date < today ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{fmtShort(a.due_date)}</span>}
            </li>
          ))}
        </ul>
      )}
      {!!theirs.length && (
        <div>
          <div className="text-[11px] font-semibold text-slate-400 mb-1">팀장님이 챙기기로 한 것</div>
          <ul className="space-y-1">
            {theirs.slice(0, compact ? 3 : 10).map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-indigo-300 shrink-0" />
                <span className="flex-1">{a.title}</span>
                <span className="text-[11px] text-slate-400 shrink-0">{nameOf(a.owner_id)}{a.due_date ? ` · ${fmtShort(a.due_date)}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 홈: 지금 할 일 — 보완 요청 결과물 + 내 1:1 약속 */
export function MyTodo() {
  const nw = useNeedsWork();
  const p = usePromises();
  const { uid } = useTeam();
  const mine = (p.data ?? []).filter((a) => a.owner_id === uid);
  const theirs = (p.data ?? []).filter((a) => a.owner_id !== uid);
  if (!nw.data?.length && !mine.length && !theirs.length) return null;
  return (
    <Card>
      <CardHead icon={<ListTodo size={16} className="text-indigo-600" />} title={`지금 할 일 ${(nw.data?.length ?? 0) + mine.length}건`} />
      <div className="px-5 pb-4 space-y-4">
        {!!nw.data?.length && (
          <div>
            <div className="text-[11px] font-semibold text-amber-700 mb-1.5">보완 요청 받은 결과물</div>
            <ul className="space-y-1.5">
              {nw.data.map((s) => (
                <li key={s.id}>
                  <Link to={`/work/${s.id}`} className="flex items-center gap-2 rounded-lg bg-amber-50 ring-1 ring-amber-200 px-3 py-2 text-sm hover:bg-amber-100">
                    <RotateCcw size={14} className="text-amber-700 shrink-0" /><span className="flex-1 truncate font-medium">{s.title}</span>
                    <span className="text-xs text-amber-800 font-semibold shrink-0">고쳐서 다시 올리기 →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(!!mine.length || !!theirs.length) && (
          <div>
            <div className="text-[11px] font-semibold text-slate-500 mb-1.5">1:1에서 정한 약속</div>
            <PromiseList compact />
          </div>
        )}
      </div>
    </Card>
  );
}

/** 받은 칭찬 배지 */
export function MyPraise({ limit = 3 }: { limit?: number }) {
  const { team, uid, nameOf } = useTeam();
  const qy = useQuery({
    queryKey: ['my-praise', team.id, uid],
    queryFn: () => q<{ id: string; author_id: string; body: string; occurred_at: string }[]>(supabase.from('observations').select('id, author_id, body, occurred_at').eq('team_id', team.id).eq('subject_id', uid).eq('kind', 'praise').order('occurred_at', { ascending: false }).limit(20)),
  });
  const list = qy.data ?? [];
  if (!list.length) return null;
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100 flex items-center gap-2">
        <Award size={16} className="text-amber-600" /><span className="font-semibold text-sm">받은 칭찬</span>
        <span className="text-xs text-amber-700 num">{list.length}개</span>
        <Link to="/my/record" className="ml-auto text-xs text-amber-800 font-semibold">내 기록 →</Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {list.slice(0, limit).map((o) => (
          <li key={o.id} className="px-5 py-3 text-sm">
            <p className="text-slate-800">"{o.body.replace(/^\[칭찬 배지\]\s*/, '')}"</p>
            <p className="mt-0.5 text-[11px] text-slate-400">{nameOf(o.author_id)} · {fmtDate(o.occurred_at)}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** 팀원 → 팀장 1:1 요청 */
export function RequestOOModal({ onClose }: { onClose: () => void }) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const leader = useLeaderId();
  const [topic, setTopic] = useState('');
  const send = useMutation({
    mutationFn: () => q(supabase.from('team_requests').insert({ team_id: team.id, from_id: uid, to_id: leader, kind: 'meeting', title: topic.trim() || '이야기 나누고 싶은 게 있어요', body: '' })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requests'] }); toast('팀장님께 1:1을 요청했습니다. 일정이 잡히면 알림이 갑니다.'); onClose(); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Modal open onClose={onClose} title={<span className="inline-flex items-center gap-2"><MessageSquarePlus size={18} className="text-teal-600" />1:1 요청하기</span>}>
      <p className="text-sm text-slate-600 rounded-lg bg-slate-50 px-3 py-2">팀장님께 알림이 가고, 팀장님이 일정을 잡습니다. 이야기하고 싶은 걸 적어 두면 팀장님이 미리 준비할 수 있어요.</p>
      <div className="mt-3">
        <Field label="이야기하고 싶은 것" hint="선택"><textarea rows={3} className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="예) 다음 분기에 맡고 싶은 일 / 요즘 막힌 부분 상의" /></Field>
      </div>
      <Button className="mt-3 w-full" loading={send.isPending} disabled={!leader} onClick={() => send.mutate()}>요청 보내기</Button>
    </Modal>
  );
}

export function useLeaderId() {
  const { team, members } = useTeam();
  return members.find((m) => m.role === 'leader')?.user_id ?? team.owner_id;
}

/** 열려 있는 내 1:1 요청 */
export function useMyOORequest() {
  const { team, uid } = useTeam();
  const leader = useLeaderId();
  return useQuery({
    queryKey: ['requests', team.id, 'my-oo', uid],
    queryFn: () => q<{ id: string; title: string; created_at: string }[]>(supabase.from('team_requests').select('id, title, created_at').eq('team_id', team.id).eq('from_id', uid).eq('to_id', leader).eq('kind', 'meeting').eq('status', 'open').order('created_at', { ascending: false }).limit(1)),
    enabled: !!leader,
  });
}

/** 팀원 메뉴 배지 */
export function useMemberBadges(enabled: boolean) {
  const { team, uid } = useTeam();
  return useQuery({
    queryKey: ['member-badges', team?.id, uid], enabled: enabled && !!team, staleTime: 60_000,
    queryFn: async () => {
      const [nw, ai] = await Promise.all([
        supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq('author_id', uid).eq('status', 'needs_work').is('closed_at', null),
        supabase.from('action_items').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq('owner_id', uid).is('done_at', null),
      ]);
      return { needsWork: nw.count ?? 0, promises: ai.count ?? 0 };
    },
  });
}

