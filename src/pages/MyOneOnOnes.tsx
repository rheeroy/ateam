// 팀원: 매니징 보드 — 팀장과 '사람으로서' 주고받는 곳. (업무 결과물은 업무플랫폼, 목표는 팀목표)
//   ② 왼쪽: 받은 히스토리 — 팀장이 넘겨준 과제 히스토리 (카드 → 오른쪽 넓은 창)
//   ③ 오른쪽(세로선으로 구분): 소통 및 피드백 — 한 묶음 안에 이번 주 컨디션(한 줄) · Feedback(칭찬 · 육성 · 업무 독려 · 지원·격려 · 코칭) | 1on1(요청 · 다음 1on1 · 정한 할 일 · 지난 1on1)
//   1on1 요청은 우측 상단 버튼 하나로만.
import { useState } from 'react';
import { noteHead } from '../lib/format';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, ChevronRight, MessageSquare, MessageSquarePlus, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { OneOnOne, TeamRequest } from '../lib/types';
import { cx, fmtDate, fmtTime, relDay } from '../lib/format';
import { Button, PageHeader, Pill, useToast } from '../components/ui';
import { BoardSection } from '../components/member/BoardSection';
import { errorText } from '../lib/supabase';
import { ReceivedHistories } from '../components/history/ReceivedHistories';
import { PromiseList, RequestOOModal, useMyOORequest, usePromises } from '../components/member/Member';
import { ConditionShare } from '../components/member/ConditionShare';
import { FromLeader } from '../components/member/FromLeader';
import { OneOnOneThread } from '../components/oneonone/Thread';
import { ViaAutopilot } from '../components/autopilot/Dial';

/** 다음 1on1 — 미리 꺼낼 이야기 (함께 보는 노트에 한 줄씩 쌓인다) */
function NextOneOnOne({ o }: { o: OneOnOne }) {
  const { nameOf } = useTeam();
  return (
    <div className="rounded-xl bg-slate-50 p-3.5">
      <div className="flex items-center gap-2">
        <CalendarClock size={15} className="text-slate-500" />
        <span className="text-sm font-semibold">{relDay(o.scheduled_at)} {fmtTime(o.scheduled_at)}</span>
        <span className="text-xs text-slate-400">{nameOf(o.leader_id)} 팀장님</span>
        <Link to={`/one-on-ones/${o.id}`} className="ml-auto text-xs font-semibold text-slate-600 hover:text-slate-900">열기 →</Link>
      </div>
      <div className="mt-2.5">
        <div className="text-[11px] text-slate-500 mb-1.5">미리 꺼낼 이야기 <span className="text-slate-400">· 팀장님도 1on1 전에 봅니다</span></div>
        <OneOnOneThread oo={o} compact placeholder="예) 다음 분기에 맡고 싶은 일, 일하는 방식 제안" />
      </div>
    </div>
  );
}

/** 팀장님이 보낸 1on1·미팅 요청 */
function LeaderMeetings() {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [reply, setReply] = useState<Record<string, string>>({});
  const list = useQuery({
    queryKey: ['requests', team.id, 'to', uid, 'meeting'],
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('to_id', uid).eq('kind', 'meeting').eq('status', 'open').order('created_at', { ascending: false }).limit(5)),
  });
  const done = useMutation({
    mutationFn: (r: TeamRequest) => q(supabase.from('team_requests').update({ status: 'done', response: reply[r.id] ?? '' }).eq('id', r.id)),
    onSuccess: () => { ['requests', 'member-badges'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast('확인했다고 팀장님께 알렸습니다.'); },
    onError: (e) => toast(errorText(e)),
  });
  if (!list.data?.length) return null;
  return (
    <section className="space-y-2">
      {list.data.map((r) => (
        <div key={r.id} className="rounded-xl bg-indigo-50 ring-1 ring-indigo-100 px-3.5 py-3">
          <div className="text-[11px] font-semibold text-indigo-700">팀장님이 1on1을 요청했어요{r.due_date && <span className="font-normal text-indigo-500"> · {fmtDate(r.due_date)}까지</span>}</div>
          <div className="text-sm font-semibold text-slate-900 mt-0.5">{r.title}</div>
          {r.body && <p className="text-xs text-slate-600 mt-0.5">{r.body}</p>}
          {r.via_autopilot && <ViaAutopilot className="mt-1" />}
          <div className="mt-2 flex gap-1.5">
            <input className="flex-1 min-w-0 text-xs border border-indigo-200 bg-white rounded-lg px-2.5 py-1.5" value={reply[r.id] ?? ''} onChange={(e) => setReply({ ...reply, [r.id]: e.target.value })} placeholder="가능한 시간 · 한 줄 답 (선택)" />
            <Button size="sm" variant="secondary" loading={done.isPending && done.variables?.id === r.id} onClick={() => done.mutate(r)}><CheckCircle2 size={13} />확인</Button>
          </div>
        </div>
      ))}
    </section>
  );
}

function OneOnOnePanel() {
  const { team, uid, nameOf } = useTeam();
  const [all, setAll] = useState(false);
  const list = useQuery({
    queryKey: ['my-oo', team.id, uid],
    queryFn: () => q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', team.id).eq('member_id', uid).order('scheduled_at', { ascending: false })),
  });
  const promises = usePromises();
  const now = new Date().toISOString();
  const next = [...(list.data ?? [])].filter((o) => o.status === 'scheduled' && o.scheduled_at >= now).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];
  const past = (list.data ?? []).filter((o) => o.id !== next?.id && o.status !== 'canceled');
  return (
    <BoardSection sub icon={<MessageSquare size={15} className="text-slate-400" />} title="1on1">
      <div className="p-4 space-y-5">
        <LeaderMeetings />
        <section>
          <div className="text-xs font-semibold text-slate-500 mb-2">다음 1on1</div>
          {next ? <NextOneOnOne o={next} /> : <p className="text-sm text-slate-400">예정된 1on1이 없습니다.</p>}
        </section>

        <section>
          <div className="text-xs font-semibold text-slate-500">1on1에서 정한 할 일</div>
          <p className="text-[11px] text-slate-400 mb-2">1on1에서 함께 정한 후속 조치</p>
          {promises.data?.length ? <PromiseList /> : <p className="text-sm text-slate-400">남은 할 일이 없습니다.</p>}
        </section>

        <section>
          <div className="text-xs font-semibold text-slate-500 mb-1">지난 1on1</div>
          {!past.length ? <p className="text-sm text-slate-400">아직 기록이 없습니다.</p> : (
            <ul className="-mx-2">
              {(all ? past : past.slice(0, 4)).map((o) => (
                <li key={o.id}>
                  <Link to={`/one-on-ones/${o.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                    <span className="text-xs text-slate-500 num w-20 shrink-0">{fmtDate(o.scheduled_at)}</span>
                    <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{noteHead(o.shared_notes) || `${nameOf(o.leader_id)} 팀장님`}</span>
                    {o.status === 'done' ? <Pill tone="emerald">완료</Pill> : <Pill>예정</Pill>}
                    <ChevronRight size={14} className="text-slate-300" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {past.length > 4 && <button onClick={() => setAll((x) => !x)} className={cx('mt-1 text-xs text-slate-500 hover:text-slate-800')}>{all ? '접기' : `전체 ${past.length}회 보기`}</button>}
        </section>
      </div>
    </BoardSection>
  );
}

/** 팀원: 매니징 보드 */
export default function MyOneOnOnes() {
  const [params] = useSearchParams();
  const [reqOpen, setReqOpen] = useState(false);
  const pending = useMyOORequest();
  const req = pending.data?.[0];
  const focus = params.get('coach') ?? params.get('req') ?? params.get('praise');
  return (
    <section>
      <PageHeader title="매니징 보드" sub="받은 히스토리와 팀장님과의 소통 · 피드백 · 1on1을 한곳에서"
        right={req ? <span className="text-xs text-slate-600 bg-slate-100 rounded-lg px-3 py-2">1on1 요청함 · {fmtDate(req.created_at)} · 일정 대기</span>
          : <Button variant="secondary" onClick={() => setReqOpen(true)}><MessageSquarePlus size={15} />1on1 요청하기</Button>} />
      <div className="space-y-5">
        <div className="grid lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-6 items-start">
          <ReceivedHistories />
          {/* 소통 및 피드백 — Feedback(팀장님 액션) · 1on1 을 한 묶음으로 */}
          <section className="min-w-0 lg:border-l lg:border-slate-200 lg:pl-6 pt-5 lg:pt-0 border-t border-slate-200 lg:border-t-0">
            <div className="flex items-end gap-3 mb-2.5 px-1 min-h-[44px]">
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-1.5"><Users size={16} className="text-slate-400" />소통 및 피드백</h2>
                <p className="text-xs text-slate-500 mt-0.5">이번 주 컨디션을 나누고, 팀장님 피드백에 답하고, 1on1을 함께 준비합니다</p>
              </div>
            </div>
            <div className="rounded-2xl bg-slate-100/70 ring-1 ring-slate-200/70 p-4 space-y-4">
              <ConditionShare stack />
              <div className="grid 2xl:grid-cols-2 gap-4 items-start">
                <FromLeader focus={focus} />
                <OneOnOnePanel />
              </div>
            </div>
          </section>
        </div>
      </div>
      {reqOpen && <RequestOOModal onClose={() => setReqOpen(false)} />}
    </section>
  );
}
