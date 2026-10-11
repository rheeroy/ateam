import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import type { Plan } from '../lib/types';
import { cx, fmtDate, won } from '../lib/format';
import { Bar, Button, Card, CardHead, ErrorBox, Field, PageHeader, Pill, Spinner, Tabs, inputCls, useToast } from '../components/ui';

const FEATURE_LABEL: Record<string, string> = {
  checkin: '주간 체크인', one_on_one: '1:1 노트·액션아이템', review_room: '리뷰룸', weekly_report: '주간보고 초안', briefing: '월요일 팀 브리핑',
  prep: '1:1 준비 노트', ai_review: 'AI 1차 검토', perf_map: '팀 성과 지도', forecast: '실적 전망', strategy: '팀 전략·포트폴리오',
  simulation: 'What-if 시뮬레이션', evaluation: '근거 기반 평가 초안', insight: 'AI 인사이트 레벨', care_radar: '케어 레이더',
  knowhow: '내 노하우 (AI가 내 기준으로 일함)', integrations: '캘린더·메신저 연동 (예정)', multi_team: '겸직 팀장 (최대 3팀)', priority_model: '상위 모델 우선 배정',
};
const KIND_LABEL: Record<string, string> = {
  briefing: '팀 브리핑', one_on_one_prep: '1:1 준비 노트', review: '1차 검토', weekly_report: '주간보고', evaluation_draft: '평가 초안',
  forecast_note: '전망 해석', strategy_check: '전략 점검', scenario_note: '시나리오 해석', knowhow_ingest: '노하우 정리',
};

// 토스페이먼츠 v2 SDK (자동결제 카드 등록)
declare global { interface Window { TossPayments?: (clientKey: string) => { payment: (o: { customerKey: string }) => { requestBillingAuth: (o: Record<string, unknown>) => Promise<void> } } } }
async function loadToss() {
  if (window.TossPayments) return window.TossPayments;
  await new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://js.tosspayments.com/v2/standard';
    s.onload = () => res(); s.onerror = () => rej(new Error('결제 모듈을 불러오지 못했습니다'));
    document.head.appendChild(s);
  });
  return window.TossPayments!;
}

function Billing() {
  const { credits, profile, refresh } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [cycle, setCycle] = useState<'month' | 'year'>('month');
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => q<Plan[]>(supabase.from('plans').select('*').eq('active', true).order('sort')) });
  const sub = useQuery({
    queryKey: ['subscription', profile?.id],
    queryFn: () => q<{ plan_id: string; status: string; billing_cycle: string; current_period_end: string; cancel_at_period_end: boolean; card_company: string | null; card_last4: string | null } | null>(
      supabase.from('subscriptions').select('*').eq('owner_id', profile!.id).maybeSingle()),
    enabled: !!profile,
  });
  const payments = useQuery({ queryKey: ['payments'], queryFn: () => q<{ id: string; order_name: string; amount_krw: number; status: string; paid_at: string | null; created_at: string; receipt_url: string | null }[]>(supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(12)) });
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: () => q<{ id: number; delta: number; reason: string; ai_kind: string | null; created_at: string }[]>(supabase.from('credit_ledger').select('id, delta, reason, ai_kind, created_at').order('created_at', { ascending: false }).limit(15)) });

  const done = () => { refresh(); qc.invalidateQueries({ queryKey: ['subscription'] }); qc.invalidateQueries({ queryKey: ['payments'] }); qc.invalidateQueries({ queryKey: ['ledger'] }); };
  const subscribe = useMutation({
    mutationFn: (b: Record<string, unknown>) => invoke('billing', b),
    onSuccess: () => { toast('결제가 완료됐습니다'); done(); },
    onError: (e) => toast(errorText(e)),
  });

  // 카드 등록 후 돌아왔을 때
  useEffect(() => {
    const authKey = params.get('authKey');
    if (params.get('billing') === 'success' && authKey) {
      subscribe.mutate({ action: 'subscribe', authKey, plan_id: params.get('plan'), cycle: params.get('cycle') });
      setParams({ tab: 'billing' }, { replace: true });
    } else if (params.get('billing') === 'fail') {
      toast(params.get('message') ?? '카드 등록이 취소됐습니다');
      setParams({ tab: 'billing' }, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function start(plan: Plan) {
    const clientKey = import.meta.env.VITE_TOSS_CLIENT_KEY as string | undefined;
    if (!clientKey) { toast('결제 키(VITE_TOSS_CLIENT_KEY)가 설정되지 않았습니다'); return; }
    try {
      const { customerKey } = await invoke<{ customerKey: string }>('billing', { action: 'customer_key' });
      const Toss = await loadToss();
      const base = `${window.location.origin}/settings?tab=billing`;
      await Toss(clientKey).payment({ customerKey }).requestBillingAuth({
        method: 'CARD',
        successUrl: `${base}&billing=success&plan=${plan.id}&cycle=${cycle}`,
        failUrl: `${base}&billing=fail`,
        customerEmail: profile?.email ?? undefined,
        customerName: profile?.full_name ?? undefined,
      });
    } catch (e) { toast(errorText(e)); }
  }

  if (!credits) return <Spinner />;
  if (!credits.is_owner) return <Card className="p-5 text-sm text-slate-600">요금제는 팀을 만든 팀장 계정에서 관리합니다.</Card>;
  const total = credits.monthly_remaining + credits.topup_remaining;
  const s = sub.data;

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs text-slate-500">현재 요금제</div>
              <div className="mt-1 text-2xl font-bold">{credits.plan_name} {credits.status === 'trialing' && <Pill tone="amber">체험 중 · {fmtDate(credits.trial_ends_at)}까지</Pill>}</div>
              {s && s.plan_id !== 'free' && credits.status !== 'trialing' && (
                <div className="text-sm text-slate-500 mt-1">{s.billing_cycle === 'year' ? '연간' : '월간'} · 다음 결제 {fmtDate(s.current_period_end)}{s.card_last4 && ` · ${s.card_company ?? '카드'} ****${s.card_last4}`}
                  {s.cancel_at_period_end && <Pill tone="rose" className="ml-2">기간 끝나면 해지</Pill>}</div>
              )}
            </div>
            {s && s.plan_id !== 'free' && credits.status === 'active' && (
              <Button variant="ghost" size="sm" loading={subscribe.isPending} onClick={() => subscribe.mutate({ action: s.cancel_at_period_end ? 'resume' : 'cancel' })}>
                {s.cancel_at_period_end ? '해지 취소' : '해지 예약'}
              </Button>
            )}
          </div>
          <div className="mt-5">
            <div className="flex justify-between text-sm"><span>이번 달 AI 크레딧</span><span className="font-mono num"><b>{total}</b> 남음 · 월 {credits.monthly_credits}</span></div>
            <div className="mt-2"><Bar value={(credits.monthly_remaining / Math.max(1, credits.monthly_credits)) * 100} tone="violet" h="h-2" /></div>
            <div className="mt-1 text-xs text-slate-500">{fmtDate(credits.period_end)}에 다시 채워집니다{credits.topup_remaining > 0 && ` · 추가 구매분 ${credits.topup_remaining} (소멸 없음)`}</div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="font-semibold">추가 크레딧</div>
          <p className="text-xs text-slate-500 mt-1">월 제공량을 다 쓰면 추가분에서 차감됩니다. 등록된 카드로 바로 결제됩니다.</p>
          <div className="mt-4 space-y-2">
            {[['100', 6900], ['300', 19900]].map(([n, p]) => (
              <Button key={n} variant="secondary" className="w-full justify-between" loading={subscribe.isPending && subscribe.variables?.pack === n}
                onClick={() => subscribe.mutate({ action: 'topup', pack: n })}>
                <span>{n} 크레딧</span><span className="font-mono">{won(Number(p))} <span className="text-xs text-slate-400">+VAT</span></span>
              </Button>
            ))}
          </div>
        </Card>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="font-semibold">요금제</div>
        <div className="flex bg-slate-100 rounded-lg p-0.5 text-[13px]">
          <button onClick={() => setCycle('month')} className={cx('px-3 py-1 rounded-md', cycle === 'month' ? 'bg-white shadow-sm font-semibold' : 'text-slate-500')}>월간</button>
          <button onClick={() => setCycle('year')} className={cx('px-3 py-1 rounded-md', cycle === 'year' ? 'bg-white shadow-sm font-semibold' : 'text-slate-500')}>연간 <span className="text-emerald-600">2개월 무료</span></button>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {(plans.data ?? []).map((p) => {
          const current = credits.plan_id === p.id && credits.status !== 'trialing';
          const price = cycle === 'year' ? p.price_year_krw : p.price_month_krw;
          return (
            <Card key={p.id} className={cx('p-5 flex flex-col', p.id === 'pro' && 'border-indigo-400 ring-1 ring-indigo-200')}>
              <div className="flex items-center justify-between"><div className="font-bold text-lg">{p.name}</div>{p.id === 'pro' && <Pill tone="indigo">추천</Pill>}</div>
              <div className="mt-2"><span className="text-2xl font-bold">{price === 0 ? '무료' : won(price)}</span>{price > 0 && <span className="text-sm text-slate-500"> / {cycle === 'year' ? '년' : '월'} · VAT 별도</span>}</div>
              {cycle === 'year' && price > 0 && <div className="text-xs text-slate-500">월 {won(Math.round(price / 12))} 꼴</div>}
              <div className="mt-3 text-sm text-slate-600">팀원 {p.max_members}명 · AI {p.monthly_credits} 크레딧/월{p.max_teams > 1 && ` · 팀 ${p.max_teams}개`}</div>
              <ul className="mt-4 space-y-1.5 text-sm flex-1">
                {p.features.map((f) => <li key={f} className="flex gap-2"><Check size={15} className="text-emerald-600 mt-0.5 shrink-0" />{FEATURE_LABEL[f] ?? f}</li>)}
              </ul>
              <div className="mt-5">
                {p.id === 'free' ? <Button variant="ghost" disabled className="w-full">{credits.plan_id === 'free' ? '현재 요금제' : '기본'}</Button>
                  : current ? <Button variant="secondary" disabled className="w-full">현재 요금제</Button>
                  : <Button className="w-full" onClick={() => start(p)}><CreditCard size={15} />{p.name} 시작하기</Button>}
              </div>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">크레딧 차감: 1:1 준비 노트·해석 1 · 브리핑·주간보고·노하우 정리 2 · 결과물 1차 검토 3 · 평가 초안 5. 근거가 모자라 '판단 보류'된 요청은 차감하지 않습니다.</p>

      <div className="grid lg:grid-cols-2 gap-5">
        <Card>
          <CardHead title="크레딧 사용 내역" />
          <ul className="divide-y divide-slate-100 text-sm">
            {(ledger.data ?? []).map((l) => (
              <li key={l.id} className="px-5 py-2.5 flex justify-between gap-3">
                <span>{l.reason === 'usage' ? KIND_LABEL[l.ai_kind ?? ''] ?? l.ai_kind : l.reason === 'monthly_grant' ? '월 제공' : l.reason === 'topup' ? '추가 구매' : l.reason}<span className="text-xs text-slate-400 ml-2">{fmtDate(l.created_at)}</span></span>
                <span className={cx('font-mono num', l.delta < 0 ? 'text-slate-700' : 'text-emerald-700')}>{l.delta > 0 ? '+' : ''}{l.delta}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead title="결제 내역" />
          {!payments.data?.length ? <p className="px-5 py-4 text-sm text-slate-500">없습니다.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {payments.data.map((p) => (
                <li key={p.id} className="px-5 py-2.5 flex justify-between gap-3">
                  <span>{p.order_name}<span className="text-xs text-slate-400 ml-2">{fmtDate(p.paid_at ?? p.created_at)}</span></span>
                  <span className="flex items-center gap-2"><span className="font-mono">{won(p.amount_krw)}</span>
                    {p.receipt_url ? <a href={p.receipt_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600">영수증</a> : <Pill tone={p.status === 'done' ? 'emerald' : p.status === 'failed' ? 'rose' : 'slate'}>{p.status}</Pill>}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function TeamSettings() {
  const { team, refresh } = useTeam();
  const toast = useToast();
  const [name, setName] = useState(team.name);
  const [mission, setMission] = useState(team.mission);
  const [parent, setParent] = useState(team.parent_link);
  const [minEv, setMinEv] = useState(String((team.settings?.min_judgment_evidence as number) ?? 8));
  const save = useMutation({
    mutationFn: () => q(supabase.from('teams').update({ name, mission, parent_link: parent, settings: { ...team.settings, min_judgment_evidence: Number(minEv) || 8 } }).eq('id', team.id)),
    onSuccess: () => { toast('저장했습니다'); refresh(); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Card className="p-5 max-w-2xl space-y-4">
      <Field label="팀 이름"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="팀 미션"><textarea rows={2} className={inputCls} value={mission} onChange={(e) => setMission(e.target.value)} /></Field>
      <Field label="상위 연결" hint="회사·본부 전략 목표"><input className={inputCls} value={parent} onChange={(e) => setParent(e.target.value)} placeholder="2026 회사 전략 목표 「신규 매출원 확보」 · 기여 비중 30%" /></Field>
      <Field label="판단에 필요한 최소 근거" hint="이보다 적으면 평가 초안·성과 지도가 '판단 보류'">
        <input type="number" min={3} max={30} className={`${inputCls} w-24`} value={minEv} onChange={(e) => setMinEv(e.target.value)} />
      </Field>
      <Button onClick={() => save.mutate()} loading={save.isPending}>저장</Button>
    </Card>
  );
}

function ProfileSettings() {
  const { profile, refresh } = useTeam();
  const toast = useToast();
  const [name, setName] = useState(profile?.full_name ?? '');
  const save = useMutation({
    mutationFn: () => q(supabase.from('profiles').update({ full_name: name }).eq('id', profile!.id)),
    onSuccess: () => { toast('저장했습니다'); refresh(); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Card className="p-5 max-w-lg space-y-4">
      <Field label="이름"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="이메일"><input className={inputCls} value={profile?.email ?? ''} disabled /></Field>
      <ErrorBox error={null} />
      <Button onClick={() => save.mutate()} loading={save.isPending}>저장</Button>
    </Card>
  );
}

type Tab = 'profile' | 'team' | 'billing';
export default function SettingsPage() {
  const { isLeader } = useTeam();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? (isLeader ? 'billing' : 'profile');
  const items: { id: Tab; label: string }[] = isLeader
    ? [{ id: 'billing', label: '요금제·크레딧' }, { id: 'team', label: '팀 설정' }, { id: 'profile', label: '내 정보' }]
    : [{ id: 'profile', label: '내 정보' }];
  return (
    <section>
      <PageHeader title="설정" />
      <div className="mb-5"><Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={items} /></div>
      {tab === 'billing' && isLeader ? <Billing /> : tab === 'team' && isLeader ? <TeamSettings /> : <ProfileSettings />}
    </section>
  );
}
