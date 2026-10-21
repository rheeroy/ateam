// 팀원: 매니징 보드 — 팀장과 '사람으로서' 주고받는 곳. (업무 결과물은 업무플랫폼, 목표는 팀목표)
//   ① 이번 주 컨디션 (한 줄)
//   ② 팀장님에게서 — 요청 · 성장 제안 · 격려 · 칭찬 · ATEAM 코칭을 한 줄기로, 답할 것이 위로
//   ③ 1on1 — 다음 1on1(미리 꺼낼 이야기) · 1on1에서 정한 할 일 · 지난 1on1
//   1on1 요청은 우측 상단 버튼 하나로만.
import { useState } from 'react';
import { noteHead } from '../lib/format';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, MessageSquare, MessageSquarePlus } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { OneOnOne } from '../lib/types';
import { cx, fmtDate, fmtTime, relDay } from '../lib/format';
import { Button, Card, PageHeader, Pill } from '../components/ui';
import { PromiseList, RequestOOModal, useMyOORequest, usePromises } from '../components/member/Member';
import { ConditionShare } from '../components/member/ConditionShare';
import { FromLeader } from '../components/member/FromLeader';
import { OneOnOneThread } from '../components/oneonone/Thread';

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
    <Card>
      <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-center gap-2">
        <MessageSquare size={16} className="text-slate-500" /><span className="font-semibold">1on1</span>
      </div>
      <div className="p-4 space-y-5">
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
    </Card>
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
      <PageHeader title="매니징 보드" sub="팀장님이 보낸 요청 · 칭찬 · 코칭, 컨디션 공유와 1on1을 한곳에서"
        right={req ? <span className="text-xs text-slate-600 bg-slate-100 rounded-lg px-3 py-2">1on1 요청함 · {fmtDate(req.created_at)} · 일정 대기</span>
          : <Button variant="secondary" onClick={() => setReqOpen(true)}><MessageSquarePlus size={15} />1on1 요청하기</Button>} />
      <div className="space-y-5">
        <ConditionShare />
        <div className="grid lg:grid-cols-3 gap-5 items-start">
          <div className="lg:col-span-2"><FromLeader focus={focus} /></div>
          <OneOnOnePanel />
        </div>
      </div>
      {reqOpen && <RequestOOModal onClose={() => setReqOpen(false)} />}
    </section>
  );
}
