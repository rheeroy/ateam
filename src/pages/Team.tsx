import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Trash2, UserPlus } from 'lucide-react';
import { useTeam } from '../state/session';
import { inviteNote, saveInviteNote } from '../lib/onboarding';
import { supabase, q, errorText } from '../lib/supabase';
import type { Invitation, TeamMember } from '../lib/types';
import { fmtDate } from '../lib/format';
import { Avatar, Button, Card, CardHead, ErrorBox, Field, PageHeader, Pill, inputCls, useToast } from '../components/ui';

function MemberRow({ m, isMe }: { m: TeamMember; isMe: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState(m.job_title);
  const [hours, setHours] = useState(String(m.weekly_hours));
  const upd = useMutation({
    mutationFn: (patch: Partial<TeamMember>) => q(supabase.from('team_members').update(patch).eq('team_id', m.team_id).eq('user_id', m.user_id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['members'] }); qc.invalidateQueries({ queryKey: ['seats'] }); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <tr className="border-t border-slate-100">
      <td className="px-5 py-3"><div className="flex items-center gap-3"><Avatar name={m.profiles?.full_name} tone={m.role === 'leader' ? 'indigo' : 'slate'} /><div><div className="font-semibold">{m.profiles?.full_name}{isMe && ' (나)'}</div><div className="text-xs text-slate-500">{m.profiles?.email}</div></div></div></td>
      <td className="px-3 py-3"><input aria-label="직무" className={`${inputCls} w-36`} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== m.job_title && upd.mutate({ job_title: title })} /></td>
      <td className="px-3 py-3"><input aria-label="주당 가용 시간" type="number" min={0} max={60} className={`${inputCls} w-20`} value={hours} onChange={(e) => setHours(e.target.value)} onBlur={() => Number(hours) !== m.weekly_hours && upd.mutate({ weekly_hours: Number(hours) })} /></td>
      <td className="px-3 py-3"><Pill tone={m.role === 'leader' ? 'indigo' : 'slate'}>{m.role === 'leader' ? '팀장' : '팀원'}</Pill></td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        {!isMe && m.role === 'member' && (
          <button className="text-slate-400 hover:text-rose-600" title="팀에서 내보내기" onClick={() => { if (confirm(`${m.profiles?.full_name} 님을 팀에서 내보낼까요? 기록은 남습니다.`)) upd.mutate({ status: 'left' }); }}><Trash2 size={15} /></button>
        )}
      </td>
    </tr>
  );
}

// 보낸 요청 목록 · 요청 보내기는 두지 않는다 — 요청은 업무플랫폼·팀원관리에서 주고받고 완료 알림으로 확인
export default function TeamPage({ embedded }: { embedded?: boolean } = {}) {
  const { team, members, uid, credits } = useTeam();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [strength, setStrength] = useState('');
  const [weak, setWeak] = useState('');
  const [lastLink, setLastLink] = useState<string | null>(null);

  const invites = useQuery({
    queryKey: ['invites', team.id],
    queryFn: () => q<Invitation[]>(supabase.from('invitations').select('*').eq('team_id', team.id).is('accepted_at', null).order('created_at', { ascending: false })),
  });
  const usage = useQuery({
    queryKey: ['seats', team.id],
    queryFn: () => q<{ members: number; pending: number; max_members: number }>(supabase.rpc('team_seat_usage', { p_team: team.id })),
  });
  const link = (t: string) => `${window.location.origin}/invite/${t}`;
  const invite = useMutation({
    mutationFn: async () => {
      const token = await q<string>(supabase.rpc('create_invitation', { p_team: team.id, p_email: email, p_job_title: title }));
      // 강점·보완할 점 → 합류하면 팀장 개인 메모로 (실패해도 초대는 그대로)
      await saveInviteNote(team.id, token, inviteNote(strength, weak)).catch(() => toast('메모는 저장하지 못했습니다. 합류 후 팀원관리에서 남겨 주세요'));
      return token;
    },
    onSuccess: (token) => {
      setLastLink(link(token)); setEmail(''); setTitle(''); setStrength(''); setWeak('');
      navigator.clipboard?.writeText(link(token)).catch(() => {});
      toast('초대 링크를 만들어 복사했습니다. 메신저나 메일로 보내 주세요.');
      qc.invalidateQueries({ queryKey: ['invites'] }); qc.invalidateQueries({ queryKey: ['seats'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => q(supabase.from('invitations').delete().eq('id', id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invites'] }); qc.invalidateQueries({ queryKey: ['seats'] }); },
  });
  const u = usage.data;

  return (
    <section>
      {!embedded && <PageHeader title="팀원" sub={`${team.name} · 팀원은 무료로 초대됩니다`} />}
      {params.get('welcome') && (
        <div className="mb-5 rounded-2xl bg-indigo-600 text-white p-5">
          <div className="font-semibold">팀을 만들었습니다. 이제 팀원을 초대하세요.</div>
          <p className="text-sm text-indigo-100 mt-1">초대 링크를 만들어 메신저로 보내면, 팀원이 로그인해서 바로 합류합니다. 합류한 팀원은 '매니징 보드'에서 이번 주 컨디션 공유부터 시작합니다.</p>
        </div>
      )}
      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <Card className="lg:col-span-2 overflow-x-auto">
          <CardHead title="구성원" right={u && <span>팀원 <b className="font-mono">{u.members}</b> / {u.max_members}명 ({credits?.plan_name})</span>} />
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-xs text-slate-500"><tr><th className="text-left font-normal px-5 py-2">이름</th><th className="text-left font-normal px-3">직무</th><th className="text-left font-normal px-3">주당 가용 시간</th><th className="text-left font-normal px-3">역할</th><th /></tr></thead>
            <tbody>{members.map((m) => <MemberRow key={m.user_id} m={m} isMe={m.user_id === uid} />)}</tbody>
          </table>
          <p className="px-5 py-3 text-xs text-slate-500 border-t border-slate-100">주당 가용 시간은 팀원관리의 '업무 부하'(진행 중 과제의 주당 예상 시간 ÷ 가용 시간) 계산에 쓰입니다. 겸직·단축근무라면 줄여 주세요.</p>
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <div className="font-semibold flex items-center gap-2"><UserPlus size={16} className="text-indigo-600" />초대하기</div>
            <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
              <Field label="이메일"><input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="member@company.com" /></Field>
              <Field label="직무" hint="선택"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="기획" /></Field>
              <Field label="강점" hint="선택 · 팀원에게는 보이지 않습니다"><input className={inputCls} value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="예) 기획 속도가 빠르고 꼼꼼함" /></Field>
              <Field label="보완할 점" hint="선택 · 팀원에게는 보이지 않습니다"><input className={inputCls} value={weak} onChange={(e) => setWeak(e.target.value)} placeholder="예) 숫자 근거가 약함" /></Field>
              <ErrorBox error={invite.error ? errorText(invite.error) : null} />
              {invite.error && String(invite.error).includes('PLAN_LIMIT') && <Link to="/settings" className="text-xs text-indigo-600">요금제 보기 →</Link>}
              <Button type="submit" className="w-full" loading={invite.isPending}><Link2 size={15} />초대 링크 만들기</Button>
            </form>
            {lastLink && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs break-all">
                {lastLink}
                <button className="ml-2 text-indigo-600 inline-flex items-center gap-1" onClick={() => { navigator.clipboard.writeText(lastLink); toast('복사했습니다'); }}><Copy size={12} />복사</button>
              </div>
            )}
            <p className="mt-3 text-xs text-slate-500">링크는 14일 동안 유효합니다. 메일은 자동으로 보내지 않습니다.</p>
          </Card>
          <Card>
            <CardHead title="대기 중인 초대" />
            {!invites.data?.length ? <p className="px-5 py-4 text-sm text-slate-500">없습니다.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {invites.data.map((i) => (
                  <li key={i.id} className="px-5 py-3 flex items-center gap-2">
                    <span className="flex-1 truncate">{i.email}<span className="block text-xs text-slate-400">{new Date(i.expires_at) < new Date() ? '만료됨' : `${fmtDate(i.expires_at)}까지`}</span></span>
                    <button className="text-slate-400 hover:text-indigo-600" title="링크 복사" onClick={() => { navigator.clipboard.writeText(link(i.token)); toast('복사했습니다'); }}><Copy size={14} /></button>
                    <button className="text-slate-400 hover:text-rose-600" title="취소" onClick={() => revoke.mutate(i.id)}><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </section>
  );
}
