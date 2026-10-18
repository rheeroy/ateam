import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, ChevronRight, MessageSquare } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useTeamMembersOnly } from '../lib/hooks';
import type { OneOnOne } from '../lib/types';
import { daysAgo, fmtDate, fmtTime, relDay } from '../lib/format';
import { AiChip } from '../components/AiBar';
import { Button, Card, CardHead, Empty, ErrorBox, Field, Modal, PageHeader, Pill, Spinner, inputCls } from '../components/ui';

export function ScheduleModal({ open, onClose, memberId }: { open: boolean; onClose: () => void; memberId?: string | null }) {
  const { team, uid } = useTeam();
  const members = useTeamMembersOnly();
  const nav = useNavigate();
  const qc = useQueryClient();
  const tomorrow = new Date(Date.now() + 86400000);
  const [who, setWho] = useState(memberId ?? '');
  const [date, setDate] = useState(tomorrow.toISOString().slice(0, 10));
  const [time, setTime] = useState('14:00');
  const [dur, setDur] = useState(30);
  useEffect(() => { if (memberId) setWho(memberId); }, [memberId]);
  const create = useMutation({
    mutationFn: () => q<OneOnOne>(supabase.from('one_on_ones').insert({
      team_id: team.id, leader_id: uid, member_id: who || members[0]?.user_id,
      scheduled_at: new Date(`${date}T${time}:00`).toISOString(), duration_min: dur,
    }).select().single()),
    onSuccess: async (o) => {
      // 그 팀원이 보낸 1:1 요청이 열려 있으면 '일정 잡음'으로 닫는다 (팀원에게 알림)
      await supabase.from('team_requests').update({ status: 'done', response: `1:1 일정을 잡았어요 — ${new Date(o.scheduled_at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` })
        .eq('team_id', team.id).eq('from_id', o.member_id).eq('to_id', uid).eq('kind', 'meeting').eq('status', 'open');
      qc.invalidateQueries({ queryKey: ['oo'] }); qc.invalidateQueries({ queryKey: ['oo-week'] }); qc.invalidateQueries({ queryKey: ['requests'] }); onClose(); nav(`/one-on-ones/${o.id}`);
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="1:1 일정 잡기">
      {members.length === 0 ? <p className="text-sm text-slate-500">먼저 팀원을 초대해 주세요.</p> : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="팀원">
            <select className={inputCls} value={who || members[0]?.user_id} onChange={(e) => setWho(e.target.value)}>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name} · {m.job_title}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="날짜"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="시간"><input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} /></Field>
            <Field label="길이">
              <select className={inputCls} value={dur} onChange={(e) => setDur(Number(e.target.value))}>
                {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m}분</option>)}
              </select>
            </Field>
          </div>
          <ErrorBox error={create.error ? errorText(create.error) : null} />
          <Button type="submit" className="w-full" loading={create.isPending}>일정 만들기</Button>
          <p className="text-xs text-slate-500">캘린더 초대는 아직 자동으로 보내지 않습니다. (캘린더 연동 예정)</p>
        </form>
      )}
    </Modal>
  );
}

export default function OneOnOnes({ embedded }: { embedded?: boolean } = {}) {
  const { team, nameOf } = useTeam();
  const members = useTeamMembersOnly();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(!!params.get('new'));
  const list = useQuery({
    queryKey: ['oo', team.id],
    queryFn: () => q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', team.id).order('scheduled_at', { ascending: false }).limit(200)),
  });
  const upcoming = (list.data ?? []).filter((o) => o.status === 'scheduled').sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  const past = (list.data ?? []).filter((o) => o.status !== 'scheduled');
  const lastDone = new Map<string, string>();
  for (const o of past) if (o.status === 'done' && !lastDone.has(o.member_id)) lastDone.set(o.member_id, o.scheduled_at);

  return (
    <section>
      {embedded ? (
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <p className="text-sm text-slate-500 flex-1">면담 전 <b className="text-violet-700 font-semibold">AI 준비 노트</b>, 함께 보는 노트, 액션아이템이 한곳에 쌓이고 평가 근거가 됩니다.</p>
          <Button onClick={() => setOpen(true)}><CalendarPlus size={15} />1:1 잡기</Button>
        </div>
      ) : <PageHeader title="1:1 면담" sub="면담 전 준비 노트, 함께 보는 노트, 액션아이템이 한곳에 쌓입니다"
        right={<Button onClick={() => setOpen(true)}><CalendarPlus size={15} />1:1 잡기</Button>} />}
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardHead title="다가오는 1:1" right={<span className="num">{upcoming.length}건</span>} />
            {list.isLoading ? <Spinner /> : !upcoming.length ? <Empty icon={<MessageSquare size={18} />} title="잡힌 1:1이 없습니다">오른쪽 위 '1:1 잡기'로 일정을 만드세요.</Empty> :
              upcoming.map((o) => (
                <Link key={o.id} to={`/one-on-ones/${o.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
                  <div className="text-center w-16 shrink-0"><div className="text-xs text-slate-400">{relDay(o.scheduled_at)}</div><div className="font-mono font-semibold num">{fmtTime(o.scheduled_at)}</div></div>
                  <div className="flex-1"><div className="font-semibold flex items-center gap-2">{nameOf(o.member_id)}<AiChip label="AI 준비 노트" title="면담 화면에서 지난 대화·체크인·결과물을 엮은 준비 노트를 만듭니다" /></div><div className="text-sm text-slate-500">{fmtDate(o.scheduled_at, true)} · {o.duration_min}분</div></div>
                  <ChevronRight size={16} className="text-slate-300" />
                </Link>
              ))}
          </Card>
          <Card>
            <CardHead title="지난 1:1" />
            {!past.length ? <p className="px-5 py-5 text-sm text-slate-500">기록이 없습니다.</p> : past.slice(0, 30).map((o) => (
              <Link key={o.id} to={`/one-on-ones/${o.id}`} className="px-5 py-3 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0 text-sm">
                <span className="font-mono text-xs text-slate-400 w-14">{fmtDate(o.scheduled_at)}</span>
                <span className="font-semibold w-20">{nameOf(o.member_id)}</span>
                <span className="flex-1 text-slate-500 truncate">{o.shared_notes.split('\n')[0] || '(노트 없음)'}</span>
                {o.status === 'canceled' && <Pill>취소</Pill>}
              </Link>
            ))}
          </Card>
        </div>
        <Card>
          <CardHead title="팀원별 마지막 1:1" />
          <ul className="divide-y divide-slate-100 text-sm">
            {members.map((m) => {
              const last = lastDone.get(m.user_id);
              const d = last ? daysAgo(last) : null;
              return (
                <li key={m.user_id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <span>{m.profiles?.full_name}</span>
                  <span className={d === null || d > 14 ? 'text-amber-700 text-xs' : 'text-slate-500 text-xs'}>{d === null ? '기록 없음' : `${d}일 전`}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <ScheduleModal open={open} onClose={() => { setOpen(false); if (params.get('new')) setParams({}); }} memberId={params.get('new')} />
    </section>
  );
}
