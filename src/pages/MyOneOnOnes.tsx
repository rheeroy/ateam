import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, MessageSquare } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { ActionItem, OneOnOne } from '../lib/types';
import { fmtDate, fmtTime, relDay } from '../lib/format';
import { Card, CardHead, Empty, PageHeader, Pill, Spinner } from '../components/ui';

export default function MyOneOnOnes() {
  const { team, uid, nameOf } = useTeam();
  const list = useQuery({
    queryKey: ['my-oo', team.id, uid],
    queryFn: () => q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', team.id).eq('member_id', uid).order('scheduled_at', { ascending: false })),
  });
  const items = useQuery({
    queryKey: ['my-actions', team.id, uid],
    queryFn: () => q<ActionItem[]>(supabase.from('action_items').select('*').eq('team_id', team.id).eq('owner_id', uid).is('done_at', null).order('due_date')),
  });
  return (
    <section>
      <PageHeader title="내 1:1" sub="팀장님과 함께 보는 노트와 약속이 여기에 모입니다" />
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <Card className="lg:col-span-2">
          <CardHead title="면담" />
          {list.isLoading ? <Spinner /> : !list.data?.length ? <Empty icon={<MessageSquare size={18} />} title="아직 1:1이 없습니다">팀장님이 일정을 잡으면 여기에 보입니다.</Empty> :
            list.data.map((o) => (
              <Link key={o.id} to={`/one-on-ones/${o.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
                <div className="text-center w-16 shrink-0"><div className="text-xs text-slate-400">{relDay(o.scheduled_at)}</div><div className="font-mono font-semibold num">{fmtTime(o.scheduled_at)}</div></div>
                <div className="flex-1 min-w-0"><div className="font-semibold">{fmtDate(o.scheduled_at, true)}</div><div className="text-sm text-slate-500 truncate">{o.shared_notes.split('\n')[0] || `${nameOf(o.leader_id)} 팀장님`}</div></div>
                {o.status === 'done' ? <Pill tone="emerald">완료</Pill> : o.status === 'canceled' ? <Pill>취소</Pill> : <Pill tone="indigo">예정</Pill>}
                <ChevronRight size={16} className="text-slate-300" />
              </Link>
            ))}
        </Card>
        <Card className="p-5">
          <div className="font-semibold">내 할 일</div>
          {!items.data?.length ? <p className="mt-3 text-sm text-slate-500">남은 할 일이 없습니다.</p> : (
            <ul className="mt-3 space-y-2 text-sm">{items.data.map((a) => <li key={a.id} className="flex justify-between gap-2"><span>{a.title}</span><span className="text-xs text-slate-500">{a.due_date ? fmtDate(a.due_date) : ''}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </section>
  );
}
