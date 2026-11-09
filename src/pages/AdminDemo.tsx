// 관리자 — 데모 신청 승인 (app_admins 에 등록된 계정만)
//   승인하면 7일짜리 개인 링크가 생기고, demo-mail 함수(Resend)가 신청자에게 바로 메일로 보낸다. 실패하면 메일 문구를 복사해 둔다
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Mail, RotateCcw, Send } from 'lucide-react';
import { supabase, q, errorText, invoke } from '../lib/supabase';
import { cx, fmtDate } from '../lib/format';
import { Card, Spinner, useToast } from '../components/ui';
import { DEPTS } from '../lib/demo';

interface Req {
  id: string; name: string; company: string; job_title: string; team_size: string; dept?: string; email: string; phone: string; note: string;
  status: 'pending' | 'approved' | 'rejected'; token: string | null; approved_at: string | null; expires_at: string | null;
  first_used_at: string | null; last_used_at: string | null; ai_used: Record<string, string>; created_at: string; mailed_at?: string | null; mail_count?: number;
}
const ST: Record<Req['status'], [string, string]> = { pending: ['대기', 'bg-amber-100 text-amber-800'], approved: ['승인', 'bg-emerald-100 text-emerald-800'], rejected: ['거절', 'bg-slate-100 text-slate-500'] };

export function useIsAdmin() {
  return useQuery({ queryKey: ['is-admin'], queryFn: () => q<boolean>(supabase.rpc('is_app_admin')), retry: false, staleTime: 600_000 });
}

export default function AdminDemo() {
  const admin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | Req['status']>('all');
  const list = useQuery({ queryKey: ['admin-demo'], enabled: !!admin.data, queryFn: () => q<Req[]>(supabase.rpc('admin_demo_list')) });
  const decide = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' | 'extend' }) => q<Req>(supabase.rpc('admin_demo_decide', { p_id: id, p_action: action })),
    onSuccess: async (r, v) => {
      if (v.action === 'approve' && r.token) {
        try { await invoke('demo-mail', { id: r.id }); toast(`승인하고 ${r.email}로 데모 링크 메일을 보냈습니다`); }
        catch (e) { copy(mail(r), `승인했지만 메일은 보내지 못했습니다(${errorText(e)}) — 메일 문구를 복사했어요`); }
      }
      qc.invalidateQueries({ queryKey: ['admin-demo'] });
    },
    onError: (e) => toast(errorText(e)),
  });
  const resend = useMutation({
    mutationFn: (r: Req) => invoke('demo-mail', { id: r.id }).then(() => r.email),
    onSuccess: (to) => { toast(`${to}로 데모 링크 메일을 다시 보냈습니다`); qc.invalidateQueries({ queryKey: ['admin-demo'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const link = (r: Req) => `${window.location.origin}/demo?t=${r.token}`;
  const mail = (r: Req) => `${r.name}님, 안녕하세요. ATEAM입니다.\n\n데모 신청해 주셔서 감사합니다. 아래 링크를 누르면 6개월치 기록이 쌓인 데모 팀으로 바로 들어갑니다.\n위쪽 띠에서 팀장 화면과 팀원 화면을 오가며 둘러보실 수 있어요.\n\n${link(r)}\n\n· 링크는 ${r.expires_at ? fmtDate(r.expires_at) : '7일 뒤'}까지 쓸 수 있습니다.\n· AI 기능은 기능마다 한 번씩 직접 실행해 볼 수 있습니다.\n· 내 팀으로 바로 시작하시면 14일 동안 모든 기능을 무료로 쓰실 수 있습니다.\n\n궁금한 점은 이 메일에 답장 주세요.\n감사합니다.`;
  const copy = (t: string, msg: string) => navigator.clipboard.writeText(t).then(() => toast(msg), () => toast('복사하지 못했습니다'));
  const rows = useMemo(() => (list.data ?? []).filter((r) => filter === 'all' || r.status === filter), [list.data, filter]);

  if (admin.isLoading) return <Spinner />;
  if (!admin.data) return <p className="text-sm text-slate-500">관리자만 볼 수 있습니다.</p>;
  const pending = (list.data ?? []).filter((r) => r.status === 'pending').length;
  return (
    <div className="space-y-5">
      <div className="flex items-end gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold tracking-tight">데모 신청</h1>
          <p className="text-sm text-slate-500">승인하면 7일짜리 개인 링크가 생기고, 신청자에게 메일이 자동으로 갑니다(demo@leada.team · 답장은 steve@starthalf.com). 링크는 데모 데이터를 초기화해도 그대로 유지됩니다.</p></div>
        <div className="ml-auto flex rounded-lg bg-slate-100 p-0.5 text-[13px]">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('px-3 py-1 rounded-md', filter === k ? 'bg-white shadow-sm font-semibold' : 'text-slate-500')}>
              {k === 'all' ? '전체' : ST[k][0]}{k === 'pending' && pending ? ` ${pending}` : ''}</button>
          ))}
        </div>
      </div>
      <ResetCard />
      {list.isLoading ? <Spinner /> : !rows.length ? <Card className="p-6 text-sm text-slate-500">신청이 없습니다.</Card> : (
        <div className="space-y-3">
          {rows.map((r) => {
            const live = r.status === 'approved' && r.expires_at && Date.parse(r.expires_at) > Date.now();
            return (
              <Card key={r.id} className="p-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cx('text-[11px] font-bold rounded-full px-2 py-0.5', ST[r.status][1])}>{live || r.status !== 'approved' ? ST[r.status][0] : '만료'}</span>
                      <b>{r.name}</b><span className="text-sm text-slate-600">{r.company}{r.job_title ? ` · ${r.job_title}` : ''}{r.team_size ? ` · 팀원 ${r.team_size}` : ''}{r.dept ? ` · ${DEPTS.find(([k]) => k === r.dept)?.[1] ?? r.dept} 데모` : ''}</span>
                    </div>
                    <div className="mt-1 text-sm text-slate-600">{r.email}{r.phone ? ` · ${r.phone}` : ''} <span className="text-slate-400">· 신청 {fmtDate(r.created_at)}</span></div>
                    {r.note && <p className="mt-1.5 text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{r.note}</p>}
                    {r.status === 'approved' && (
                      <div className="mt-1.5 text-xs text-slate-500">
                        {r.expires_at && `${fmtDate(r.expires_at)}까지`}{r.mailed_at ? ` · 메일 보냄 ${fmtDate(r.mailed_at)}` : ' · 메일 안 보냄'}{r.first_used_at ? ` · 첫 입장 ${fmtDate(r.first_used_at)} · 최근 ${fmtDate(r.last_used_at)}` : ' · 아직 입장 안 함'} · AI 체험 {Object.keys(r.ai_used ?? {}).length}개
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap shrink-0">
                    {r.status === 'pending' && <>
                      <button onClick={() => decide.mutate({ id: r.id, action: 'approve' })} className="text-sm font-bold rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700">승인</button>
                      <button onClick={() => decide.mutate({ id: r.id, action: 'reject' })} className="text-sm rounded-lg ring-1 ring-slate-200 px-3 py-1.5 hover:bg-slate-50">거절</button>
                    </>}
                    {r.status === 'approved' && r.token && <>
                      {live && <button disabled={resend.isPending} onClick={() => resend.mutate(r)} className="text-sm font-semibold rounded-lg ring-1 ring-slate-200 px-3 py-1.5 hover:bg-slate-50 inline-flex items-center gap-1 disabled:opacity-50"><Send size={14} />{r.mailed_at ? '메일 다시 보내기' : '메일 보내기'}</button>}
                      <button onClick={() => copy(mail(r), '메일 문구를 복사했습니다')} title="직접 보낼 때 쓰는 문구" className="text-sm rounded-lg ring-1 ring-slate-200 px-3 py-1.5 hover:bg-slate-50 inline-flex items-center gap-1"><Mail size={14} />문구</button>
                      <button onClick={() => copy(link(r), '링크를 복사했습니다')} className="text-sm rounded-lg ring-1 ring-slate-200 px-3 py-1.5 hover:bg-slate-50 inline-flex items-center gap-1"><Copy size={14} />링크</button>
                      <button onClick={() => decide.mutate({ id: r.id, action: 'extend' })} className="text-sm rounded-lg ring-1 ring-slate-200 px-3 py-1.5 hover:bg-slate-50">7일 연장</button>
                      {live && <button onClick={() => decide.mutate({ id: r.id, action: 'reject' })} className="text-sm text-slate-500 rounded-lg px-2 py-1.5 hover:text-rose-600">중지</button>}
                    </>}
                    {r.status === 'rejected' && <button onClick={() => decide.mutate({ id: r.id, action: 'approve' })} className="text-sm rounded-lg ring-1 ring-slate-200 px-3 py-1.5 hover:bg-slate-50">승인</button>}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 데모 데이터 초기화 — SQL Editor에서 06_demo_accounts.sql 을 Run 하는 것과 같다 */
function ResetCard() {
  const toast = useToast();
  const [done, setDone] = useState<string | null>(null);
  const [prog, setProg] = useState<string | null>(null);
  // 팀마다 차례로 (마케팅기획팀이 먼저 — 공통 함수가 거기 있다)
  const reset = useMutation({
    mutationFn: async () => {
      const { teams } = await invoke<{ teams: string[] }>('admin-demo-reset', { list: true });
      const order = ['marketing', ...(teams ?? []).filter((k) => k !== 'marketing')];
      const t0 = Date.now();
      for (let i = 0; i < order.length; i++) {
        setProg(`${i + 1}/${order.length} · ${DEPTS.find(([k]) => k === order[i])?.[1] ?? order[i]}`);
        await invoke('admin-demo-reset', { team: order[i] });
      }
      return { ms: Date.now() - t0, n: order.length };
    },
    onSuccess: (r) => { setProg(null); const t = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); setDone(t); toast(`데모 팀 ${r.n}개를 처음 상태로 되돌렸습니다 (${Math.max(1, Math.round(r.ms / 1000))}초)`); },
    onError: (e) => { setProg(null); toast(errorText(e)); },
  });
  const go = () => {
    if (!window.confirm('데모 데이터를 처음 상태로 되돌릴까요?\n\n· 데모 팀의 모든 기록(체험하는 분들이 쓴 것 포함)이 지워지고 6개월치 기록이 다시 들어갑니다.\n· 지금 데모를 보고 있는 분은 로그아웃되지 않고, 화면이 처음 기록으로 바뀝니다.\n· 데모 신청 · 승인 링크 · 링크별 AI 체험 기록은 그대로 남습니다.')) return;
    reset.mutate();
  };
  return (
    <Card className="p-4 flex items-center gap-3 flex-wrap">
      <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"><RotateCcw size={16} /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">데모 데이터 초기화</div>
        <p className="text-xs text-slate-500">데모 팀 전부를 6개월치 기록이 있는 처음 상태로 되돌립니다 (팀마다 차례로). 신청 · 링크는 그대로입니다.{done ? ` · 마지막 초기화 ${done}` : ''}</p>
      </div>
      <button onClick={go} disabled={reset.isPending}
        className="text-sm font-semibold rounded-lg px-3.5 py-2 bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-1.5">
        <RotateCcw size={14} className={reset.isPending ? 'animate-spin' : ''} />{reset.isPending ? `초기화하는 중… ${prog ?? ''}` : '초기화'}</button>
    </Card>
  );
}
