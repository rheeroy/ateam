// 관리자 — 고객 (팀장별 요금제 상태 · 팀 · 최근 활동 · 이번 달 AI 원가) + 체험 연장 · 내부 계정
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, errorText } from '../lib/supabase';
import { cx, fmtDate } from '../lib/format';
import { Card, Spinner, useToast } from '../components/ui';
import { useIsAdmin } from './AdminDemo';

interface Row {
  owner_id: string; email: string; name: string; signed_up_at: string; last_sign_in_at: string | null;
  plan_id: string; plan_name: string; status: string; trial_ends_at: string | null; current_period_end: string; billing_cycle: string;
  cancel_at_period_end: boolean; has_card: boolean; internal: boolean; trial_expired: boolean;
  teams: { id: string; name: string; is_demo: boolean; members: number }[]; members: number; max_members: number; is_demo: boolean;
  last_activity: string | null; cost_usd: number; cap_usd: number;
}
interface Summary { customers: number; trialing: number; paying: number; expired: number; cost_usd: number; demo_cost_usd: number; by_plan: Record<string, { n: number; avg_cost: number }> }
type Filter = 'all' | 'trial' | 'paying' | 'expired' | 'internal';

const usd = (n: number) => `$${Number(n || 0).toFixed(2)}`;
const daysTo = (s: string | null) => (s ? Math.ceil((Date.parse(s) - Date.now()) / 86400000) : null);
const ago = (s: string | null) => { if (!s) return '—'; const d = Math.floor((Date.now() - Date.parse(s)) / 86400000); return d <= 0 ? '오늘' : `${d}일 전`; };

function stateOf(r: Row): { label: string; cls: string; key: Filter } {
  if (r.is_demo) return { label: '데모', cls: 'bg-violet-100 text-violet-700', key: 'all' };
  if (r.internal) return { label: '내부', cls: 'bg-slate-200 text-slate-700', key: 'internal' };
  if (r.status === 'trialing' && !r.trial_expired) { const d = daysTo(r.trial_ends_at); return { label: `체험 D-${Math.max(0, d ?? 0)}`, cls: (d ?? 9) <= 3 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800', key: 'trial' }; }
  if (r.status === 'active') return { label: r.cancel_at_period_end ? `${r.plan_name} · 해지 예약` : r.plan_name, cls: 'bg-emerald-100 text-emerald-800', key: 'paying' };
  if (r.status === 'past_due') return { label: `${r.plan_name} · 결제 실패`, cls: 'bg-rose-100 text-rose-700', key: 'paying' };
  return { label: r.trial_expired ? '체험 종료' : '구독 종료', cls: 'bg-slate-100 text-slate-500', key: 'expired' };
}

export default function AdminCustomers() {
  const admin = useIsAdmin();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [showDemo, setShowDemo] = useState(false);
  const data = useQuery({ queryKey: ['admin-customers'], enabled: !!admin.data, queryFn: () => q<{ rows: Row[]; summary: Summary }>(supabase.rpc('admin_customers')) });
  const act = useMutation({
    mutationFn: ({ owner, action }: { owner: string; action: 'extend_trial' | 'internal' | 'uninternal' }) => q(supabase.rpc('admin_customer_action', { p_owner: owner, p_action: action })),
    onSuccess: (_d, v) => { qc.invalidateQueries({ queryKey: ['admin-customers'] }); toast(v.action === 'extend_trial' ? '체험을 7일 연장했습니다' : v.action === 'internal' ? '내부 계정으로 지정했습니다' : '내부 계정을 해제했습니다'); },
    onError: (e) => toast(errorText(e)),
  });
  const rows = useMemo(() => (data.data?.rows ?? []).filter((r) => (showDemo || !r.is_demo) && (filter === 'all' || stateOf(r).key === filter)), [data.data, filter, showDemo]);

  if (admin.isLoading) return <Spinner />;
  if (!admin.data) return <p className="text-sm text-slate-500">관리자만 볼 수 있습니다.</p>;
  const s = data.data?.summary;
  const plans = Object.entries(s?.by_plan ?? {});
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">고객</h1>
        <p className="text-sm text-slate-500">팀장(구독 주인)별 요금제 상태 · 팀 · 최근 활동 · 이번 결제 주기 AI 원가. 원가는 상한(요금제별)에 닿으면 그 팀의 AI가 멈춥니다.</p>
      </div>

      {s && (
        <Card className="p-4 grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat label="고객" value={s.customers} />
          <Stat label="체험 중" value={s.trialing} />
          <Stat label="유료" value={s.paying} tone="emerald" />
          <Stat label="종료" value={s.expired} />
          <div>
            <div className="text-[11px] text-slate-500">이번 달 AI 원가 (고객 합계)</div>
            <div className="text-2xl font-bold num">{usd(s.cost_usd)}</div>
            <div className="mt-1 text-[11px] text-slate-500 leading-relaxed">
              {plans.length ? plans.map(([k, v]) => `${k === 'pro_plus' ? 'Pro+' : k[0].toUpperCase() + k.slice(1)} 평균 ${usd(v.avg_cost)} (${v.n})`).join(' · ') : '—'}
              {s.demo_cost_usd > 0 && ` · 데모 ${usd(s.demo_cost_usd)}`}
            </div>
          </div>
        </Card>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-[13px]">
          {([['all', '전체'], ['trial', '체험 중'], ['paying', '유료'], ['expired', '종료'], ['internal', '내부']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} className={cx('px-3 py-1 rounded-md', filter === k ? 'bg-white shadow-sm font-semibold' : 'text-slate-500')}>{l}</button>
          ))}
        </div>
        <label className="text-[13px] text-slate-500 inline-flex items-center gap-1.5"><input type="checkbox" className="accent-indigo-600" checked={showDemo} onChange={(e) => setShowDemo(e.target.checked)} />데모 팀 보기</label>
        <span className="ml-auto text-xs text-slate-400">{rows.length}명</span>
      </div>

      {data.isLoading ? <Spinner /> : data.isError ? <Card className="p-5 text-sm text-rose-600">{errorText(data.error)} — DB 업데이트(38_admin_customers.sql)를 확인하세요.</Card> : !rows.length ? <Card className="p-6 text-sm text-slate-500">해당하는 고객이 없습니다.</Card> : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead><tr className="text-[11px] text-slate-400 border-b border-slate-100 text-left">
              <th className="font-semibold px-4 py-2.5">팀장</th><th className="font-semibold px-2">상태</th><th className="font-semibold px-2">팀 · 팀원</th>
              <th className="font-semibold px-2">가입 · 최근 활동</th><th className="font-semibold px-2 w-[190px]">이번 달 AI 원가</th><th className="font-semibold px-4 text-right">조치</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const st = stateOf(r);
                const ratio = r.cap_usd > 0 ? r.cost_usd / r.cap_usd : 0;
                return (
                  <tr key={r.owner_id} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="px-4 py-3"><b className="block">{r.name || '(이름 없음)'}</b><span className="text-xs text-slate-500">{r.email}</span></td>
                    <td className="px-2 py-3">
                      <span className={cx('text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap', st.cls)}>{st.label}</span>
                      <div className="mt-1 text-[11px] text-slate-400">{r.internal ? '결제 없음' : r.status === 'trialing' ? `${fmtDate(r.trial_ends_at)}까지` : `다음 ${fmtDate(r.current_period_end)}`}{r.has_card ? ' · 카드 등록' : ''}</div>
                    </td>
                    <td className="px-2 py-3 text-[13px]">
                      {r.teams.length ? r.teams.map((t) => <div key={t.id}>{t.name} <span className="text-slate-400">· {t.members}명</span></div>) : <span className="text-slate-400">팀 없음</span>}
                      <div className="text-[11px] text-slate-400">요금제 한도 {r.max_members}명</div>
                    </td>
                    <td className="px-2 py-3 text-[13px]"><div>{fmtDate(r.signed_up_at)}</div><div className="text-[11px] text-slate-400">활동 {ago(r.last_activity)} · 로그인 {ago(r.last_sign_in_at)}</div></td>
                    <td className="px-2 py-3">
                      <div className="flex justify-between text-[13px]"><b className="num">{usd(r.cost_usd)}</b><span className="text-slate-400 num">/ {usd(r.cap_usd)}</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className={cx('h-full rounded-full', ratio >= 1 ? 'bg-rose-500' : ratio >= 0.8 ? 'bg-amber-400' : 'bg-indigo-400')} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} /></div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{Math.round(ratio * 100)}%{ratio >= 1 ? ' · 상한 도달' : ''}</div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {!r.is_demo && r.status === 'trialing' && !r.internal && (
                        <button disabled={act.isPending} onClick={() => act.mutate({ owner: r.owner_id, action: 'extend_trial' })} className="text-xs font-semibold rounded-lg ring-1 ring-slate-200 px-2.5 py-1.5 hover:bg-slate-50">체험 7일 연장</button>
                      )}
                      {!r.is_demo && !r.internal && (
                        <button disabled={act.isPending} onClick={() => { if (window.confirm(`${r.email} 을(를) 결제 없이 Pro+를 쓰는 내부 계정으로 지정할까요?`)) act.mutate({ owner: r.owner_id, action: 'internal' }); }} className="ml-1.5 text-xs rounded-lg px-2 py-1.5 text-slate-500 hover:text-indigo-700">내부 계정</button>
                      )}
                      {r.internal && (
                        <button disabled={act.isPending} onClick={() => { if (window.confirm(`${r.email} 의 내부 계정을 해제할까요? 해제하면 체험 종료 상태가 되어 요금제를 골라야 다시 씁니다.`)) act.mutate({ owner: r.owner_id, action: 'uninternal' }); }} className="text-xs rounded-lg px-2 py-1.5 text-slate-500 hover:text-rose-600">내부 해제</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'emerald' }) {
  return <div><div className="text-[11px] text-slate-500">{label}</div><div className={cx('text-2xl font-bold num', tone === 'emerald' && 'text-emerald-600')}>{value}</div></div>;
}
