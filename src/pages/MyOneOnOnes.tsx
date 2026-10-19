import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, MessageSquare, MessageSquarePlus } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import type { OneOnOne } from '../lib/types';
import { fmtDate, fmtTime, relDay } from '../lib/format';
import { Button, Card, CardHead, Empty, PageHeader, Pill, Spinner, inputCls, useToast } from '../components/ui';
import { MyPraise, MyRequests, PromiseList, RequestOOModal, useMyOORequest } from '../components/member/Member';
import { MyCoaching } from '../components/people/Coaching';

/** 다가오는 1:1 — 이야기하고 싶은 것을 미리 (함께 보는 노트에 저장) */
function NextAgenda({ o }: { o: OneOnOne }) {
  const { nameOf } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(o.shared_notes);
  useEffect(() => setV(o.shared_notes), [o.id, o.shared_notes]);
  const save = useMutation({
    mutationFn: () => q(supabase.from('one_on_ones').update({ shared_notes: v }).eq('id', o.id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-oo'] }); toast('저장했습니다. 팀장님도 1:1 전에 볼 수 있습니다.'); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Card className="p-5 border-teal-200">
      <div className="flex items-center gap-2 flex-wrap">
        <CalendarClock size={16} className="text-teal-600" />
        <span className="font-semibold">다음 1:1 · {relDay(o.scheduled_at)} {fmtTime(o.scheduled_at)}</span>
        <span className="text-xs text-slate-400">{nameOf(o.leader_id)} 팀장님</span>
        <Link to={`/one-on-ones/${o.id}`} className="ml-auto text-xs font-semibold text-teal-700">열기 →</Link>
      </div>
      <p className="mt-2 text-xs text-slate-500">이야기하고 싶은 것을 미리 적어 두면 팀장님이 1:1 전에 보고 준비합니다. 함께 보는 노트에 저장됩니다.</p>
      <textarea rows={3} className={`${inputCls} mt-2`} value={v} onChange={(e) => setV(e.target.value)} placeholder="예) 다음 분기에 해 보고 싶은 일 / 요즘 막히는 부분 / 일하는 방식에 대한 제안" />
      <div className="mt-2 flex justify-end"><Button size="sm" variant="secondary" disabled={v === o.shared_notes} loading={save.isPending} onClick={() => save.mutate()}>저장</Button></div>
    </Card>
  );
}

/** 팀원: 팀장님과 — 지금 답할 것(요청 · 내 약속) · 다음 1:1 · 팀장님이 해 준 것(코칭 · 칭찬 · 1:1 기록) */
export default function MyOneOnOnes() {
  const { team, uid, nameOf } = useTeam();
  const [params] = useSearchParams();
  const [reqOpen, setReqOpen] = useState(false);
  const pending = useMyOORequest();
  const list = useQuery({
    queryKey: ['my-oo', team.id, uid],
    queryFn: () => q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', team.id).eq('member_id', uid).order('scheduled_at', { ascending: false })),
  });
  const now = new Date().toISOString();
  const next = [...(list.data ?? [])].filter((o) => o.status === 'scheduled' && o.scheduled_at >= now).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
  const past = (list.data ?? []).filter((o) => o.id !== next?.id);
  const req = pending.data?.[0];
  return (
    <section>
      <PageHeader title="팀장님과" sub="팀장님 요청 · 1:1과 약속 · 받은 코칭과 칭찬이 여기에 모입니다"
        right={req ? <span className="text-xs text-teal-700 bg-teal-50 ring-1 ring-teal-200 rounded-lg px-3 py-2">1:1 요청함 · {fmtDate(req.created_at)} · 일정 기다리는 중</span>
          : <Button variant="secondary" onClick={() => setReqOpen(true)}><MessageSquarePlus size={15} />1:1 요청하기</Button>} />
      <div className="grid lg:grid-cols-5 gap-5 items-start">
        <div className="lg:col-span-3 space-y-5">
          <MyRequests />
          {next && <NextAgenda o={next} />}
          <Card className="p-5">
            <div className="font-semibold mb-3">1:1에서 정한 약속</div>
            <PromiseList />
            <p className="mt-3 text-[11px] text-slate-400">내 약속은 동그라미를 눌러 완료로 표시합니다. 팀장님도 볼 수 있습니다.</p>
          </Card>
          <Card>
            <CardHead title="1:1 기록" />
            {list.isLoading ? <Spinner /> : !past.length && !next ? <Empty icon={<MessageSquare size={18} />} title="아직 1:1이 없습니다">팀장님이 일정을 잡으면 여기에 보입니다. 이야기하고 싶은 게 있으면 먼저 요청해도 됩니다.</Empty> : (
              past.map((o) => (
                <Link key={o.id} to={`/one-on-ones/${o.id}`} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
                  <div className="text-center w-14 shrink-0"><div className="text-[11px] text-slate-400">{relDay(o.scheduled_at)}</div><div className="font-mono text-sm font-semibold num">{fmtTime(o.scheduled_at)}</div></div>
                  <div className="flex-1 min-w-0"><div className="text-sm font-semibold">{fmtDate(o.scheduled_at, true)} · {nameOf(o.leader_id)} 팀장님</div><div className="text-xs text-slate-500 truncate">{o.shared_notes.split('\n')[0] || '노트 없음'}</div></div>
                  {o.status === 'done' ? <Pill tone="emerald">완료</Pill> : o.status === 'canceled' ? <Pill>취소</Pill> : <Pill tone="indigo">예정</Pill>}
                  <ChevronRight size={16} className="text-slate-300" />
                </Link>
              ))
            )}
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-5">
          <MyCoaching focusId={params.get('coach')} />
          <MyPraise limit={6} />
          <Link to="/my/record" className="block rounded-xl bg-white ring-1 ring-slate-200 px-4 py-3 text-sm hover:ring-indigo-300">
            <span className="font-semibold">이번 분기 내 기록</span><span className="block text-xs text-slate-500 mt-0.5">승인된 체크인 · 결과물 · 받은 칭찬 · 지킨 약속을 한 번에 →</span>
          </Link>
        </div>
      </div>
      {reqOpen && <RequestOOModal onClose={() => setReqOpen(false)} />}
    </section>
  );
}
