import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Minus, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import type { Plan } from '../lib/types';
import { cx, fmtDate, won } from '../lib/format';
import { PasswordForm } from '../components/PasswordForm';
import { InstallButton } from '../components/InstallPrompt';
import TeamPage from './Team';
import { Bar, Button, Card, CardHead, ErrorBox, Field, PageHeader, Pill, Spinner, Tabs, inputCls, useToast } from '../components/ui';

const KIND_LABEL: Record<string, string> = {
  evaluation_draft: '평가 시뮬레이션', plan_draft: '목표 초안', forecast_note: '성과 해석', strategy_check: '전략 점검', scenario_note: '시나리오 해석', knowhow_ingest: '노하우 정리',
};

/** 모든 요금제에 들어 있는 것 — 요금제마다 다른 건 팀원 수 · 평가 시뮬레이션 · 플레이북 · 히스토리 관리 · 크레딧 */
const INCLUDED: { title: string; sub: string; items: string[] }[] = [
  { title: '기록·협업', sub: '팀원은 무료로 초대', items: ['팀목표 · 과제 (팀원 계획 · 승인)', '업무플랫폼 (개인 · 그룹 스페이스)', '컨디션 공유 · 1on1 · 약속', '팀원 요청 · 칭찬', '의사결정 보드', '노하우 라이브러리 · 내 메모'] },
  { title: 'AI 참모', sub: '구독에 포함 · 횟수 신경 쓰지 않고', items: ['AI 인사이트 (매일 · 매주 · 매월)', 'ATEAM의 제안 (매주 월요일)', '팀원관리 액션', '결과물 AI 1차 검토', '1on1 준비 · ATEAM의 코칭', '임원 브리핑', 'ATEAM Method™ — 검증된 업무 방법론 78개 (Pro부터)'] },
  { title: '프리미엄', sub: '월 크레딧으로', items: ['평가 시뮬레이션 5 (Pro부터)', '목표 초안 2', '노하우 정리 2', '성과 해석 1'] },
];

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
  const { team } = useTeam();
  const seats = useQuery({ queryKey: ['seats', team.id], queryFn: () => q<{ members: number; pending: number; max_members: number }>(supabase.rpc('team_seat_usage', { p_team: team.id })) });
  const payments = useQuery({ queryKey: ['payments'], queryFn: () => q<{ id: string; order_name: string; amount_krw: number; status: string; paid_at: string | null; created_at: string; receipt_url: string | null }[]>(supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(12)) });
  const ledger = useQuery({ queryKey: ['ledger'], queryFn: () => q<{ id: number; delta: number; reason: string; ai_kind: string | null; created_at: string }[]>(supabase.from('credit_ledger').select('id, delta, reason, ai_kind, created_at').neq('reason', 'core_usage').order('created_at', { ascending: false }).limit(15)) });

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
  const expired = credits.plan_id === 'free';
  const trialing = !expired && credits.status === 'trialing';
  const active = !expired && !trialing;
  const members = seats.data?.members ?? 0;
  const list = plans.data ?? [];
  const fit = list.find((p) => p.max_members >= members)?.id;
  const trialLeft = credits.trial_ends_at ? Math.max(0, Math.ceil((Date.parse(credits.trial_ends_at) - Date.now()) / 86400000)) : null;

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-3 gap-5">
        <Card className={cx('p-5 lg:col-span-2', expired && 'ring-1 ring-amber-300 bg-amber-50/40')}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs text-slate-500">현재 요금제</div>
              {expired ? <>
                <div className="mt-1 text-2xl font-bold">{credits.was_trial ? '체험이 끝났습니다' : '구독이 끝났습니다'}</div>
                <p className="mt-1 text-sm text-slate-600">그동안의 기록은 그대로 보관돼 있습니다. 아래에서 팀 크기에 맞는 요금제를 고르면 바로 이어서 씁니다.</p>
              </> : trialing ? <>
                <div className="mt-1 text-2xl font-bold flex items-center gap-2 flex-wrap">무료 체험 <Pill tone="amber">{trialLeft != null ? `D-${trialLeft}` : ''} · {fmtDate(credits.trial_ends_at)}까지</Pill></div>
                <p className="mt-1 text-sm text-slate-600">체험 중에는 Pro+ 전체를 씁니다. 끝나기 전에 요금제를 고르면 끊김 없이 이어집니다.</p>
              </> : <>
                <div className="mt-1 text-2xl font-bold">{credits.plan_name} <span className="text-base font-medium text-slate-400">팀원 {credits.max_members}명까지</span></div>
                {s && <div className="text-sm text-slate-500 mt-1">{s.billing_cycle === 'year' ? '연간' : '월간'} · 다음 결제 {fmtDate(s.current_period_end)}{s.card_last4 && ` · ${s.card_company ?? '카드'} ****${s.card_last4}`}
                  {s.cancel_at_period_end && <Pill tone="rose" className="ml-2">기간 끝나면 해지</Pill>}</div>}
              </>}
            </div>
            {active && s && (
              <Button variant="ghost" size="sm" loading={subscribe.isPending} onClick={() => subscribe.mutate({ action: s.cancel_at_period_end ? 'resume' : 'cancel' })}>
                {s.cancel_at_period_end ? '해지 취소' : '해지 예약'}
              </Button>
            )}
          </div>
          {!expired && (
            <div className="mt-5 grid sm:grid-cols-2 gap-5">
              <div>
                <div className="flex justify-between text-sm"><span>기본 AI</span><span className="font-semibold text-emerald-700">구독에 포함</span></div>
                {(() => {
                  const pct = credits.ai_usage_pct ?? 0;
                  const [cls, text] = pct >= 100 ? ['bg-rose-50 text-rose-800', '이번 달 기본 AI를 모두 썼습니다. 다음 결제일에 다시 열립니다.']
                    : pct >= 75 ? ['bg-amber-50 text-amber-800', '사용이 많은 달이라 자동 1차 검토는 다음 결제일까지 쉽니다. 결과물에서 직접 \'검토\'를 누르면 됩니다.']
                    : pct >= 60 ? ['bg-amber-50 text-amber-800', '이번 달은 평소보다 AI를 많이 쓰고 있습니다. 이대로면 월말에 자동 1차 검토가 쉴 수 있습니다.']
                    : ['bg-slate-50 text-slate-600', '인사이트 · ATEAM의 제안 · 1차 검토 · 1on1 준비 · 임원 브리핑은 횟수를 신경 쓰지 않고 씁니다.'];
                  return <p className={cx('mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed', cls)}>{text}</p>;
                })()}
              </div>
              <div>
                <div className="flex justify-between text-sm"><span>프리미엄 크레딧</span><span className="font-mono num"><b>{total}</b> 남음 · 월 {credits.monthly_credits}</span></div>
                <div className="mt-2"><Bar value={(credits.monthly_remaining / Math.max(1, credits.monthly_credits)) * 100} tone="violet" h="h-2" /></div>
                <div className="mt-1 text-xs text-slate-500">{fmtDate(credits.period_end)}에 다시 채워집니다{credits.topup_remaining > 0 && ` · 추가분 ${credits.topup_remaining}`}</div>
              </div>
            </div>
          )}
        </Card>
        <Card className="p-5">
          <div className="font-semibold">프리미엄 크레딧 추가</div>
          <p className="text-xs text-slate-500 mt-1">평가 시즌처럼 프리미엄 AI를 많이 쓰는 달에만 필요합니다. 등록된 카드로 바로 결제되고 소멸하지 않습니다.</p>
          <div className="mt-4 space-y-2">
            {[['100', 6900], ['300', 19900]].map(([n, p]) => (
              <Button key={n} variant="secondary" className="w-full justify-between" disabled={!active} loading={subscribe.isPending && subscribe.variables?.pack === n}
                onClick={() => subscribe.mutate({ action: 'topup', pack: n })}>
                <span>{n} 크레딧</span><span className="font-mono">{won(Number(p))} <span className="text-xs text-slate-400">+VAT</span></span>
              </Button>
            ))}
          </div>
          {!active && <p className="mt-2 text-[11px] text-slate-400">요금제를 시작한 뒤 쓸 수 있습니다.</p>}
        </Card>
      </div>

      <section id="plans">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">팀 크기에 맞게 고르세요</h2>
            <p className="text-sm text-slate-500">기능은 같고 팀원 수가 다릅니다 (Starter는 평가 시뮬레이션 · ATEAM Method™ · 히스토리 관리 제외) · 팀장 1명 구독, 팀원은 무료 초대 · 지금 팀원 <b className="text-slate-700">{members}명</b></p>
          </div>
          <div className="flex bg-slate-100 rounded-lg p-0.5 text-[13px]">
            <button onClick={() => setCycle('month')} className={cx('px-3 py-1 rounded-md', cycle === 'month' ? 'bg-white shadow-sm font-semibold' : 'text-slate-500')}>월간</button>
            <button onClick={() => setCycle('year')} className={cx('px-3 py-1 rounded-md', cycle === 'year' ? 'bg-white shadow-sm font-semibold' : 'text-slate-500')}>연간 <span className="text-emerald-600">2개월 무료</span></button>
          </div>
        </div>
        <div className="mt-4 grid md:grid-cols-3 gap-4">
          {list.map((p) => {
            const current = active && credits.plan_id === p.id;
            const small = p.max_members < members;
            const best = p.id === fit && !current;
            const price = cycle === 'year' ? p.price_year_krw : p.price_month_krw;
            const monthly = cycle === 'year' ? Math.round(p.price_year_krw / 12) : p.price_month_krw;
            const evalOn = p.features.includes('evaluation');
            const conOn = p.features.includes('consulting_knowhow');
            const histOn = p.features.includes('history');
            return (
              <Card key={p.id} className={cx('p-5 flex flex-col relative', best && 'ring-2 ring-indigo-500', current && 'ring-2 ring-slate-900', small && 'opacity-60')}>
                {(best || current) && <span className={cx('absolute -top-2.5 left-5 text-[11px] font-bold rounded-full px-2 py-0.5 text-white', current ? 'bg-slate-900' : 'bg-indigo-600')}>{current ? '현재 요금제' : '우리 팀에 맞음'}</span>}
                <div className="font-bold text-lg">{p.name}</div>
                <div className="mt-0.5 text-sm font-semibold text-indigo-700 flex items-center gap-1.5"><Users size={14} />팀원 {p.max_members}명까지</div>
                <div className="mt-3"><span className="text-[28px] font-bold tracking-tight num">{won(price)}</span><span className="text-sm text-slate-500"> / {cycle === 'year' ? '년' : '월'}</span></div>
                <div className="text-xs text-slate-500">VAT 별도{cycle === 'year' ? ` · 월 ${won(monthly)} 꼴` : ''} · 팀원 1인당 월 {won(Math.round(monthly / p.max_members / 100) * 100)}</div>
                <ul className="mt-4 space-y-2 text-sm flex-1">
                  <li className="flex gap-2"><Check size={15} className="text-emerald-600 mt-0.5 shrink-0" />기록·협업 · AI 참모 전체</li>
                  <li className="flex gap-2"><Check size={15} className="text-emerald-600 mt-0.5 shrink-0" />프리미엄 크레딧 월 {p.monthly_credits}</li>
                  <li className={cx('flex gap-2', !evalOn && 'text-slate-400')}>{evalOn ? <Check size={15} className="text-emerald-600 mt-0.5 shrink-0" /> : <Minus size={15} className="mt-0.5 shrink-0" />}평가 시뮬레이션{!evalOn && ' 없음'}</li>
                  <li className={cx('flex gap-2', !conOn && 'text-slate-400')}>{conOn ? <Check size={15} className="text-emerald-600 mt-0.5 shrink-0" /> : <Minus size={15} className="mt-0.5 shrink-0" />}ATEAM Method™{conOn ? ' (방법론 78개)' : ' 없음'}</li>
                  <li className={cx('flex gap-2', !histOn && 'text-slate-400')}>{histOn ? <Check size={15} className="text-emerald-600 mt-0.5 shrink-0" /> : <Minus size={15} className="mt-0.5 shrink-0" />}히스토리 관리{histOn ? ' (과제별 맥락 전달)' : ' 없음'}</li>
                </ul>
                <div className="mt-5">
                  {current ? <Button variant="secondary" disabled className="w-full">현재 요금제</Button>
                    : small ? <Button variant="ghost" disabled className="w-full">팀원 {members}명이라 고를 수 없음</Button>
                    : <Button className="w-full" variant={best ? 'primary' : 'secondary'} onClick={() => start(p)}><CreditCard size={15} />{active ? `${p.name}로 바꾸기` : `${p.name} 시작하기`}</Button>}
                </div>
              </Card>
            );
          })}
        </div>
        <Card className="mt-4 p-5">
          <div className="text-sm font-semibold">모든 요금제에 들어 있는 것</div>
          <div className="mt-3 grid md:grid-cols-3 gap-5">
            {INCLUDED.map((g) => (
              <div key={g.title}>
                <div className="text-[13px] font-bold text-slate-800">{g.title} <span className="font-normal text-xs text-slate-400">· {g.sub}</span></div>
                <ul className="mt-2 space-y-1.5 text-sm text-slate-600">{g.items.map((x) => <li key={x} className="flex gap-2"><Check size={14} className="text-emerald-600 mt-0.5 shrink-0" />{x}</li>)}</ul>
              </div>
            ))}
          </div>
          <p className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">요금제 하나에 팀 하나입니다. 여러 팀을 맡았다면 팀마다 계정을 만들어 구독합니다 · 팀원이 늘면 언제든 큰 요금제로 바꿀 수 있고, 바꾸는 날부터 새 주기가 시작됩니다 · 근거가 모자라 '판단 보류'된 요청은 크레딧을 쓰지 않습니다</p>
        </Card>
      </section>

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

function AppInstall() {
  return (
    <Card className="p-5 max-w-lg space-y-3">
      <div>
        <div className="font-semibold">앱으로 설치</div>
        <p className="text-sm text-slate-500 mt-0.5">바탕화면·작업표시줄에서 브라우저 없이 바로 엽니다.</p>
      </div>
      <InstallButton />
    </Card>
  );
}

function PasswordSettings() {
  const toast = useToast();
  return (
    <Card className="p-5 max-w-lg space-y-4">
      <div>
        <div className="font-semibold">비밀번호</div>
        <p className="text-sm text-slate-500 mt-0.5">메일 링크나 Google로 가입했다면 여기서 비밀번호를 정해 두세요. 다음부터 메일 없이 바로 로그인할 수 있습니다.</p>
      </div>
      <PasswordForm onDone={() => toast('비밀번호를 저장했습니다')} />
    </Card>
  );
}

type Tab = 'profile' | 'team' | 'members' | 'billing';
export default function SettingsPage() {
  const { isLeader } = useTeam();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? (isLeader ? 'billing' : 'profile');
  const items: { id: Tab; label: string }[] = isLeader
    ? [{ id: 'billing', label: '요금제·크레딧' }, { id: 'members', label: '구성원·초대' }, { id: 'team', label: '팀 설정' }, { id: 'profile', label: '내 정보' }]
    : [{ id: 'profile', label: '내 정보' }];
  return (
    <section>
      <PageHeader title="설정" />
      <div className="mb-5"><Tabs value={tab} onChange={(t) => setParams({ tab: t })} items={items} /></div>
      {tab === 'billing' && isLeader ? <Billing /> : tab === 'members' && isLeader ? <TeamPage embedded /> : tab === 'team' && isLeader ? <TeamSettings /> : <div className="space-y-5"><ProfileSettings />{!isLeader && <MyDataGuide />}<PasswordSettings /><AppInstall /></div>}
    </section>
  );
}

/** 팀원: 기능 안내 — 각 기능이 무엇을 하는지 (보는 사람은 옆에 작게) */
function MyDataGuide() {
  const rows: [string, string, string][] = [
    ['팀목표', '팀의 목표·과제와 진척을 함께 보는 곳입니다. 내 과제 아래 할 일은 자유롭게 씁니다.', '팀 전체'],
    ['성과입력', '목표 달성에 대한 공식 성과를 입력하고 팀장님 승인을 받는 기능입니다. 승인되면 팀목표 진척에 반영됩니다.', '팀 전체'],
    ['업무플랫폼', '결과물과 진행 상황을 올리고 팀장님과 주고받는 업무 공간입니다.', '나와 팀장님'],
    ['이번 주 컨디션', '한 주의 컨디션과 영향 요인을 팀장님께 짧게 알리는 기능입니다. 팀장님이 도움이 필요한 때를 알아차리고 1on1을 준비하는 데 쓰입니다.', '나와 팀장님'],
    ['받은 히스토리', '업무 파악 및 이해를 위해 지금까지의 흐름·확정 사항·관계자 등 맥락과 히스토리를 팀장님이 정리하여 전달합니다.', '나와 팀장님'],
    ['Feedback', '팀장님이 보낸 칭찬·육성·업무 독려·지원·격려를 모아 보고 답하는 곳입니다. 받은 칭찬은 성과 기록으로 남습니다.', '나와 팀장님'],
    ['ATEAM 업무 피드백', '나의 업무 기록을 바탕으로 ATEAM AI가 정리하는 업무 피드백입니다. ATEAM Method™와 팀장님의 업무 원칙에 근거하며, 평가 근거로 남지 않습니다.', '나'],
    ['1on1', '다음 1on1에서 꺼낼 이야기를 미리 남기고, 1on1에서 정한 할 일을 함께 챙기는 노트입니다.', '나와 팀장님'],
  ];
  return (
    <Card className="p-5">
      <div className="font-semibold">기능 안내</div>
      <p className="text-xs text-slate-500 mt-1">ATEAM의 각 기능이 무엇을 하는지 정리했습니다. 다른 팀원은 내 컨디션·결과물·1on1을 볼 수 없습니다.</p>
      <div className="mt-3 divide-y divide-slate-100 text-sm">
        {rows.map(([k, what, who]) => (
          <div key={k} className="py-2.5 grid sm:grid-cols-[150px_1fr_88px] gap-1 sm:gap-3">
            <span className="font-medium text-slate-800">{k}</span>
            <span className="text-slate-600">{what}</span>
            <span className="text-[11px] text-slate-400 sm:text-right sm:pt-0.5">{who}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
