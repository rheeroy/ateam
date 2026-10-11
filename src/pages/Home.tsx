import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, Circle, ClipboardList, Clock, EyeOff, Layers, Lock, RefreshCw, StickyNote, ThumbsUp, TrendingDown,
} from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi, useTeamMembersOnly } from '../lib/hooks';
import type { ActionItem, AiOutput, CareRow, InsightLevel, OneOnOne, Submission, SubmissionVersion } from '../lib/types';
import { addDays, cx, daysAgo, fmtDate, fmtTime, mondayOf, relDay, ymd } from '../lib/format';
import { Avatar, Button, Card, CardHead, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../components/Prov';

interface Briefing {
  items: { headline: string; detail: string; link: string }[];
  one_line?: string;
  stats?: { submitted: number; members: number; avg_condition: number | null };
  counts?: Record<string, number>;
}
const LINK: Record<string, string> = { review: '/reviews', one_on_one: '/one-on-ones', report: '/report', checkin: '/team', strategy: '/strategy' };
const COUNT_LABEL: Record<string, string> = { checkin: '체크인', one_on_one: '1:1 기록', submission: '제출', task: '과제', signal: '케어 신호' };

function BriefingCard({ teamId }: { teamId: string }) {
  const brief = useLatestAi<Briefing>(teamId, 'briefing');
  const gen = useGenerate('ai-weekly-briefing');
  const b = brief.data;
  const stale = b ? daysAgo(b.created_at) >= 7 : true;
  return (
    <ProvBlock rail className="mt-6 bg-white rounded-2xl border border-slate-200 p-5 md:p-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 font-semibold text-sm">
          이번 주 팀 브리핑
          {b && <ProvChip kind={kindFromStatus(b.status)} label="AI 생성" sources={b.sources} level={b.level} depth={b.depth}
            note="지난 7일 기록에서 바뀐 것과 반복되는 것만 골랐습니다." />}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          {b && <span>{fmtDate(b.created_at, true)} 생성 · 매주 월요일 07:00 자동</span>}
          <Button size="sm" variant={stale ? 'soft' : 'ghost'} loading={gen.isPending} onClick={() => gen.mutate({ team_id: teamId })}>
            <RefreshCw size={12} />{b ? '다시 만들기' : '지금 만들기'}
          </Button>
        </div>
      </div>
      {brief.isLoading ? <Spinner /> : !b ? (
        <p className="mt-4 text-sm text-slate-500">아직 브리핑이 없습니다. 팀원 체크인이나 1:1 기록이 쌓이면 월요일 아침마다 자동으로 만들어집니다.</p>
      ) : (
        <>
          <ol className="mt-4 space-y-3 text-[15px] leading-relaxed">
            {(b.content.items ?? []).map((it, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-indigo-600 text-sm mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <span className="flex-1">
                  <b>{it.headline}</b> <TaggedText text={it.detail} sources={b.sources} />
                  {LINK[it.link] && <Link to={LINK[it.link]} className="ml-1.5 text-xs text-indigo-600 whitespace-nowrap">보기 →</Link>}
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
            <span>
              근거 · {Object.entries(b.content.counts ?? {}).map(([k, v]) => `${COUNT_LABEL[k] ?? k} ${v}건`).join(' · ')}
              {b.content.stats && ` · 체크인 ${b.content.stats.submitted}/${b.content.stats.members}명`}
            </span>
            <Link to="/report" className="text-indigo-700 font-semibold inline-flex items-center gap-1">주간보고 초안 만들기 <ArrowRight size={13} /></Link>
          </div>
        </>
      )}
    </ProvBlock>
  );
}

function CareRadar({ teamId }: { teamId: string }) {
  const nav = useNavigate();
  const radar = useQuery({ queryKey: ['care', teamId], queryFn: () => q<CareRow[]>(supabase.rpc('care_radar', { p_team: teamId })) });
  const icon = (t: string) => t === 'condition_down' ? <TrendingDown size={12} /> : t === 'no_one_on_one' ? <Clock size={12} /> : t === 'blocked_repeat' ? <AlertTriangle size={12} /> : null;
  const tone = (t: string) => t === 'condition_down' ? 'bg-rose-50 text-rose-700' : t === 'checkin_missing' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800';
  return (
    <ProvBlock className="bg-white rounded-2xl border border-slate-200">
      <CardHead title={<>이번 주 챙길 사람 <ProvChip kind="ai" label="자동 감지" sources={['체크인 컨디션 추세', '1:1 간격', '막힘 반복', '체크인 제출 여부']} level="L2"
        note="정해진 신호 4가지 중 하나라도 걸리면 올립니다. 왜 올렸는지는 아래에 그대로 보여 드립니다." /></>} />
      {radar.isLoading ? <Spinner /> : !radar.data?.length ? (
        <p className="px-5 py-5 text-sm text-slate-500">이번 주에는 특별히 챙길 신호가 없습니다.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {radar.data.map((r) => (
            <div key={r.user_id} className="px-5 py-4 flex items-start gap-4">
              <Avatar name={r.full_name} tone={r.signals.some((s) => s.type === 'condition_down') ? 'rose' : 'amber'} size={9} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold">{r.full_name} <span className="text-slate-400 font-normal text-sm">· {r.job_title}</span></div>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                  {r.signals.map((s) => (
                    <span key={s.type} className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5', tone(s.type))}>{icon(s.type)}{s.label}</span>
                  ))}
                  {r.signals.find((s) => s.detail) && <span className="text-slate-500 px-1 py-0.5">"{r.signals.find((s) => s.detail)!.detail}"</span>}
                </div>
              </div>
              <Button size="sm" onClick={() => nav(`/one-on-ones?new=${r.user_id}`)}>1:1 잡기</Button>
            </div>
          ))}
        </div>
      )}
    </ProvBlock>
  );
}

function WeekOneOnOnes({ teamId }: { teamId: string }) {
  const { nameOf } = useTeam();
  const mon = mondayOf();
  const list = useQuery({
    queryKey: ['oo-week', teamId, mon],
    queryFn: () => q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', teamId).eq('status', 'scheduled')
      .gte('scheduled_at', mon).lt('scheduled_at', addDays(mon, 7)).order('scheduled_at')),
  });
  const preps = useQuery({
    queryKey: ['ai', teamId, 'one_on_one_prep', 'week', (list.data ?? []).map((o) => o.id)],
    enabled: !!list.data?.length,
    queryFn: () => q<Pick<AiOutput, 'ref_id' | 'sources' | 'depth' | 'level' | 'status'>[]>(supabase.from('ai_outputs')
      .select('ref_id, sources, depth, level, status').eq('kind', 'one_on_one_prep').in('ref_id', list.data!.map((o) => o.id))),
  });
  return (
    <Card>
      <CardHead title="이번 주 1:1" right={<><span className="num">{list.data?.length ?? 0}건</span><Link to="/one-on-ones" className="text-indigo-600">전체</Link></>} />
      {list.isLoading ? <Spinner /> : !list.data?.length ? (
        <p className="px-5 py-5 text-sm text-slate-500">이번 주에 잡힌 1:1이 없습니다. <Link to="/one-on-ones" className="text-indigo-600">일정 잡기</Link></p>
      ) : list.data.map((o) => {
        const prep = preps.data?.find((p) => p.ref_id === o.id);
        return (
          <Link key={o.id} to={`/one-on-ones/${o.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
            <div className="text-center w-14 shrink-0"><div className="text-xs text-slate-400">{relDay(o.scheduled_at)}</div><div className="font-mono font-semibold num">{fmtTime(o.scheduled_at)}</div></div>
            <div className="flex-1 min-w-0"><div className="font-semibold">{nameOf(o.member_id)}</div><div className="text-sm text-slate-500">{o.duration_min}분</div></div>
            {prep ? <ProvChip kind="ai" label="준비 노트 완료" sources={prep.sources} depth={prep.depth} level={prep.level} />
              : <span className="text-xs text-slate-400">준비 노트 만들기</span>}
            <ChevronRight size={16} className="text-slate-300" />
          </Link>
        );
      })}
    </Card>
  );
}

function ReviewQueue({ teamId }: { teamId: string }) {
  const { nameOf } = useTeam();
  const list = useQuery({
    queryKey: ['review-queue', teamId],
    queryFn: async () => {
      const subs = await q<(Submission & { submission_versions: Pick<SubmissionVersion, 'id' | 'version' | 'created_at'>[] })[]>(
        supabase.from('submissions').select('*, submission_versions(id, version, created_at)').eq('team_id', teamId).eq('status', 'in_review').order('updated_at', { ascending: false }).limit(6));
      const latest = subs.map((s) => [...s.submission_versions].sort((a, b) => b.version - a.version)[0]).filter(Boolean);
      const reviews = latest.length ? await q<Pick<AiOutput, 'ref_id' | 'sources' | 'depth' | 'level'>[]>(supabase.from('ai_outputs')
        .select('ref_id, sources, depth, level').eq('kind', 'review').in('ref_id', latest.map((v) => v.id))) : [];
      return subs.map((s) => {
        const v = [...s.submission_versions].sort((a, b) => b.version - a.version)[0];
        return { s, v, review: reviews.find((r) => r.ref_id === v?.id) };
      });
    },
  });
  return (
    <Card>
      <CardHead title="리뷰 대기" right={<><span className="num">{list.data?.length ?? 0}건</span><Link to="/reviews" className="text-indigo-600">전체</Link></>} />
      {list.isLoading ? <Spinner /> : !list.data?.length ? (
        <p className="px-5 py-5 text-sm text-slate-500">리뷰를 기다리는 결과물이 없습니다.</p>
      ) : list.data.map(({ s, v, review }) => (
        <Link key={s.id} to={`/reviews/${s.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
          <div className="w-9 h-11 rounded-md border border-slate-200 bg-white shrink-0 overflow-hidden"><div className="h-1.5 bg-indigo-500" /></div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate">{s.title} {v && <span className="font-mono text-xs text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 ml-1">v{v.version}</span>}</div>
            <div className="text-sm text-slate-500">{nameOf(s.author_id)} · {fmtDate(v?.created_at ?? s.created_at)} 제출</div>
          </div>
          {review ? <ProvChip kind="ai" label="AI 1차 검토 완료" sources={review.sources} depth={review.depth} level={review.level} />
            : <span className="inline-flex items-center gap-1.5 text-xs text-violet-600"><span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />AI 검토 대기</span>}
          <ChevronRight size={16} className="text-slate-300" />
        </Link>
      ))}
    </Card>
  );
}

function QuickMemo({ teamId }: { teamId: string }) {
  const { uid } = useTeam();
  const members = useTeamMembersOnly();
  const toast = useToast();
  const qc = useQueryClient();
  const [who, setWho] = useState<string | null>(null);
  const [kind, setKind] = useState<'praise' | 'concern' | 'note'>('praise');
  const [body, setBody] = useState('');
  const save = useMutation({
    mutationFn: () => q(supabase.from('observations').insert({ team_id: teamId, author_id: uid, subject_id: who ?? members[0]?.user_id, kind, body })),
    onSuccess: () => { setBody(''); toast('관찰 메모를 저장했습니다. 평가 근거로 쌓입니다.'); qc.invalidateQueries({ queryKey: ['insight'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const sel = who ?? members[0]?.user_id;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 font-semibold"><StickyNote size={16} className="text-indigo-600" />관찰 메모</div>
      <p className="text-xs text-slate-500 mt-1">10초면 됩니다. 평가 때 근거로 쓰입니다.</p>
      {members.length === 0 ? <p className="mt-3 text-sm text-slate-500">팀원을 초대하면 쓸 수 있습니다.</p> : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {members.map((m) => (
              <button key={m.user_id} onClick={() => setWho(m.user_id)}
                className={cx('border rounded-full px-2.5 py-1', sel === m.user_id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                {m.profiles?.full_name}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs">
            {([['praise', '잘한 점', ThumbsUp], ['concern', '우려', AlertTriangle], ['note', '관찰', EyeOff]] as const).map(([k, l, I]) => (
              <button key={k} onClick={() => setKind(k)}
                className={cx('border rounded-lg py-1.5 inline-flex items-center justify-center gap-1', kind === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                <I size={12} />{l}
              </button>
            ))}
          </div>
          <textarea aria-label="메모" rows={3} value={body} onChange={(e) => setBody(e.target.value)} className={cx(inputCls, 'mt-2')}
            placeholder="예) 임원 보고에서 가격 전략 질문에 근거를 들어 침착하게 답변함" />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Lock size={11} />팀장만 볼 수 있음</span>
            <Button size="sm" disabled={!body.trim()} loading={save.isPending} onClick={() => save.mutate()}>저장</Button>
          </div>
        </>
      )}
    </Card>
  );
}

function InsightWidget({ teamId }: { teamId: string }) {
  const lv = useQuery({ queryKey: ['insight', teamId], queryFn: () => q<InsightLevel>(supabase.rpc('team_insight_level', { p_team: teamId })) });
  const d = lv.data;
  if (!d) return null;
  const next = d.levels[d.level];
  const gap = next?.conditions.find((c) => c.current < c.target);
  return (
    <Link to="/insight" className="block bg-white rounded-2xl border border-slate-200 p-5 hover:border-violet-300">
      <div className="flex items-center justify-between"><div className="font-semibold inline-flex items-center gap-2"><Layers size={16} className="text-violet-600" />AI 인사이트 레벨</div>
        <span className="font-mono text-sm font-bold text-violet-700">L{d.level} {d.levels[d.level - 1].name}</span></div>
      {next ? (
        <>
          <div className="mt-3 flex justify-between text-xs text-slate-500"><span>L{next.level} {next.name}까지</span><span className="font-mono num">{d.next_progress ?? 0}%</span></div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${d.next_progress ?? 0}%` }} /></div>
          {gap && <p className="mt-3 text-xs text-slate-600 leading-relaxed">{gap.label} {gap.target - gap.current}{gap.unit ?? ''} 더 쌓이면 다음 단계가 열립니다.</p>}
        </>
      ) : <p className="mt-3 text-xs text-slate-600">모든 레벨이 열렸습니다.</p>}
    </Link>
  );
}

function MyPromises({ teamId }: { teamId: string }) {
  const { uid, nameOf } = useTeam();
  const qc = useQueryClient();
  const items = useQuery({
    queryKey: ['promises', teamId, uid],
    queryFn: () => q<(ActionItem & { one_on_ones: { member_id: string } | null })[]>(supabase.from('action_items')
      .select('*, one_on_ones(member_id)').eq('team_id', teamId).eq('owner_id', uid).is('done_at', null).order('due_date', { nullsFirst: false }).limit(8)),
  });
  const done = useMutation({
    mutationFn: (id: string) => q(supabase.from('action_items').update({ done_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['promises'] }),
  });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between"><div className="font-semibold">내가 한 약속</div><span className="text-xs text-slate-400">1:1에서 나온 할 일</span></div>
      {!items.data?.length ? <p className="mt-3 text-sm text-slate-500">남은 약속이 없습니다.</p> : (
        <ul className="mt-3 space-y-2.5 text-sm">
          {items.data.map((a) => {
            const late = a.due_date && a.due_date < today;
            return (
              <li key={a.id} className="flex items-start gap-2.5">
                <button onClick={() => done.mutate(a.id)} title="완료" className={cx('mt-0.5 shrink-0', late ? 'text-rose-400' : 'text-slate-300', 'hover:text-indigo-600')}><Circle size={16} /></button>
                <span className="flex-1">{a.title}
                  <span className={cx('block text-xs', late ? 'text-rose-600' : 'text-slate-500')}>
                    {a.one_on_ones?.member_id ? `${nameOf(a.one_on_ones.member_id)} · ` : ''}{a.due_date ? fmtDate(a.due_date) : '기한 없음'}{late ? ' · 기한 지남' : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}


// ---------- 첫 주 빠른 시작 ----------
const QS_KEY = 'ateam.quickstart.hidden';
function QuickStart({ teamId }: { teamId: string }) {
  const { members } = useTeam();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(QS_KEY) === '1'; } catch { return false; } });
  const st = useQuery({
    queryKey: ['quickstart', teamId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = async (t: string, f?: (x: any) => any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let qb: any = supabase.from(t).select('id', { count: 'exact', head: true }).eq('team_id', teamId);
        if (f) qb = f(qb);
        return (await qb).count ?? 0;
      };
      const [kh, rep, oo] = await Promise.all([
        count('knowhow_cards'), count('ai_outputs', (x) => x.eq('kind', 'weekly_report')), count('one_on_ones'),
      ]);
      return { kh, rep, oo };
    },
  });
  if (hidden || !st.data) return null;
  const steps = [
    { done: st.data.kh > 0, title: '내 노하우 넣기', desc: '평소 원칙이나 자료를 던져 넣으면 AI가 팀장님 기준으로 일합니다', to: '/knowhow', cta: '넣으러 가기' },
    { done: members.some((m) => m.role === 'member'), title: '팀원 초대', desc: '링크 하나로 초대합니다. 팀원은 무료입니다', to: '/team', cta: '초대하기' },
    { done: st.data.rep > 0, title: '주간보고 초안 받아 보기', desc: '팀원이 없어도 팀장 메모 몇 줄이면 초안이 나옵니다', to: '/report', cta: '만들어 보기' },
    { done: st.data.oo > 0, title: '첫 1:1 잡기', desc: '면담 전에 AI가 준비 노트를 만들어 둡니다', to: '/one-on-ones?new=1', cta: '잡기' },
  ];
  const doneN = steps.filter((x) => x.done).length;
  if (doneN === steps.length) return null;
  return (
    <Card className="mt-6 p-5">
      <div className="flex items-center justify-between gap-3">
        <div><div className="font-semibold">ATEAM 시작하기 <span className="font-mono text-sm text-indigo-600">{doneN}/{steps.length}</span></div>
          <p className="text-xs text-slate-500 mt-0.5">10분이면 끝납니다. 하나씩 해 보면 이 도구가 무엇을 덜어 주는지 바로 보입니다.</p></div>
        <button className="text-xs text-slate-400 hover:text-slate-600" onClick={() => { setHidden(true); try { localStorage.setItem(QS_KEY, '1'); } catch { /* 저장 불가 */ } }}>숨기기</button>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {steps.map((x, i) => (
          <Link key={x.title} to={x.to} className={cx('rounded-xl border p-3.5 text-sm block', x.done ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 hover:border-indigo-300')}>
            <div className="flex items-center gap-2 font-semibold">
              {x.done ? <CheckCircle2 size={16} className="text-emerald-600" /> : <span className="w-4 h-4 rounded-full border-2 border-slate-300 text-[9px] flex items-center justify-center text-slate-400">{i + 1}</span>}
              {x.title}
            </div>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">{x.desc}</p>
            {!x.done && <div className="mt-2 text-xs font-semibold text-indigo-700">{x.cta} →</div>}
          </Link>
        ))}
      </div>
    </Card>
  );
}

// ---------- 오늘 할 일 + 이번 달 아낀 시간 ----------
const MINUTES: Record<string, number> = { briefing: 20, one_on_one_prep: 15, review: 20, weekly_report: 40, evaluation_draft: 60, forecast_note: 10, strategy_check: 30, scenario_note: 20 };
function TodayStrip({ teamId }: { teamId: string }) {
  const { uid } = useTeam();
  const nav = useNavigate();
  const today = new Date(); const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start.getTime() + 86400000);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const t = useQuery({
    queryKey: ['today', teamId, uid, start.toDateString()],
    queryFn: async () => {
      const head = { count: 'exact' as const, head: true };
      const [oo, rv, late, ai] = await Promise.all([
        supabase.from('one_on_ones').select('id', head).eq('team_id', teamId).eq('status', 'scheduled').gte('scheduled_at', start.toISOString()).lt('scheduled_at', end.toISOString()),
        supabase.from('submissions').select('id', head).eq('team_id', teamId).eq('status', 'in_review'),
        supabase.from('action_items').select('id', head).eq('team_id', teamId).eq('owner_id', uid).is('done_at', null).lt('due_date', ymd(start)),
        supabase.from('ai_outputs').select('kind').eq('team_id', teamId).neq('status', 'withheld').gte('created_at', monthStart),
      ]);
      const kinds = (ai.data ?? []) as { kind: string }[];
      const minutes = kinds.reduce((a, k) => a + (MINUTES[k.kind] ?? 10), 0);
      return { oo: oo.count ?? 0, rv: rv.count ?? 0, late: late.count ?? 0, aiN: kinds.length, minutes };
    },
  });
  const care = useQuery({ queryKey: ['care', teamId], queryFn: () => q<CareRow[]>(supabase.rpc('care_radar', { p_team: teamId })) });
  const d = t.data;
  const tiles = [
    { n: d?.oo ?? 0, label: '오늘 1:1', sub: '준비 노트 확인', to: '/one-on-ones', tone: 'text-indigo-700' },
    { n: d?.rv ?? 0, label: '리뷰 대기', sub: 'AI가 먼저 읽어 둠', to: '/reviews', tone: 'text-indigo-700' },
    { n: care.data?.length ?? 0, label: '챙길 사람', sub: '신호가 겹친 팀원', to: '#care', tone: (care.data?.length ?? 0) > 0 ? 'text-rose-600' : 'text-slate-700' },
    { n: d?.late ?? 0, label: '지난 약속', sub: '내가 팀원에게 한 것', to: '#promises', tone: (d?.late ?? 0) > 0 ? 'text-amber-700' : 'text-slate-700' },
  ];
  const hours = d ? Math.round((d.minutes / 60) * 10) / 10 : 0;
  return (
    <div className="mt-6 grid grid-cols-2 lg:grid-cols-5 gap-3">
      {tiles.map((x) => (
        <button key={x.label} onClick={() => (x.to.startsWith('/') ? nav(x.to) : document.getElementById(x.to.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }))}
          className="text-left bg-white rounded-2xl border border-slate-200 px-4 py-3 hover:border-indigo-300">
          <div className="text-xs text-slate-500">{x.label}</div>
          <div className={cx('text-2xl font-bold font-mono num mt-0.5', x.tone)}>{x.n}</div>
          <div className="text-[11px] text-slate-400">{x.sub}</div>
        </button>
      ))}
      <div className="col-span-2 lg:col-span-1 rounded-2xl px-4 py-3 bg-gradient-to-br from-violet-600 to-indigo-600 text-white">
        <div className="text-xs text-violet-100 flex items-center gap-1.5">이번 달 아낀 시간
          <span className="[&_button]:bg-white/15 [&_button]:border-white/30 [&_button]:text-white [&_svg]:text-white">
            <ProvChip kind="calc" label="추정" sources={['브리핑 20분 · 1:1 준비 15분 · 1차 검토 20분', '주간보고 40분 · 평가 초안 60분 · 전략 점검 30분', '해석·시나리오 10~20분']}
              note="AI가 만든 초안 1건마다 팀장이 직접 했을 때 걸렸을 시간을 더한 추정치입니다. 확인·수정 시간은 빼지 않았습니다." />
          </span></div>
        <div className="text-2xl font-bold font-mono num mt-0.5">{hours}<span className="text-base font-semibold">시간</span></div>
        <div className="text-[11px] text-violet-100">AI가 먼저 해 둔 일 {d?.aiN ?? 0}건</div>
      </div>
    </div>
  );
}

export default function Home() {
  const { team, profile } = useTeam();
  const today = new Date();
  const hello = today.getHours() < 11 ? '좋은 아침입니다' : today.getHours() < 18 ? '안녕하세요' : '오늘도 수고 많으셨습니다';
  return (
    <section>
      <p className="text-sm text-slate-500">{fmtDate(today.toISOString(), true)}</p>
      <h1 className="text-2xl font-bold tracking-tight mt-1">{hello}, {profile?.full_name} 팀장님</h1>
      <QuickStart teamId={team.id} />
      <TodayStrip teamId={team.id} />
      <BriefingCard teamId={team.id} />
      <div className="mt-6 grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 space-y-5">
          <div id="care"><CareRadar teamId={team.id} /></div>
          <WeekOneOnOnes teamId={team.id} />
          <ReviewQueue teamId={team.id} />
        </div>
        <div className="space-y-5">
          <QuickMemo teamId={team.id} />
          <InsightWidget teamId={team.id} />
          <div id="promises"><MyPromises teamId={team.id} /></div>
          <Link to="/report" className="block w-full text-left bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl p-5">
            <div className="flex items-center gap-2 text-indigo-100 text-xs font-semibold"><ClipboardList size={14} />주간보고</div>
            <div className="mt-2 font-semibold leading-snug">체크인과 내 메모로 주간보고 초안을 5분 안에</div>
            <div className="mt-3 text-sm text-indigo-100 inline-flex items-center gap-1">초안 보기 <ArrowRight size={14} /></div>
          </Link>
        </div>
      </div>
    </section>
  );
}
