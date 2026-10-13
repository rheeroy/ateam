import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { EVIDENCE_LABEL } from '../lib/people';
import { BadgeCheck, CircleDashed, FileText, MessageSquare, PenLine, PenSquare, Sparkles, StickyNote } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { useGenerate, useLatestAi, useUpdateAi } from '../lib/hooks';
import type { DepthRow, SourceRef } from '../lib/types';
import { cx, fmtShort } from '../lib/format';
import { Button, Card, Empty, PageHeader, Pill, Spinner, inputCls } from '../components/ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../components/Prov';
import { Upsell } from './Perf';

interface Item { title: string; detail: string; evidence: string[] }
interface Draft {
  overall?: string; strengths?: Item[]; growth?: Item[];
  competencies?: { name: string; signal: string; evidence: string[] }[]; coaching?: string;
  reason?: string; needed?: { current: number; required: number; suggestion: string };
  judgment_evidence?: number; evidence_counts?: Record<string, number>;
}
const ICON: Record<string, typeof FileText> = { submission: FileText, observation: StickyNote, one_on_one: MessageSquare, review_comment: FileText, leader_note: PenLine, checkin: PenLine, task: BadgeCheck };
const SIG: Record<string, string> = { '강함': 'text-emerald-700 bg-emerald-50', '보통': 'text-slate-700 bg-slate-100', '약함': 'text-amber-800 bg-amber-50', '근거 부족': 'text-slate-500 bg-white border border-dashed border-slate-300' };

function halves() {
  const y = new Date().getFullYear();
  const h2 = new Date().getMonth() >= 6;
  return [
    { id: 'cur', label: `${y}년 ${h2 ? '하반기' : '상반기'}`, start: `${y}-${h2 ? '07' : '01'}-01`, end: `${y}-${h2 ? '12-31' : '06-30'}` },
    { id: 'prev', label: h2 ? `${y}년 상반기` : `${y - 1}년 하반기`, start: h2 ? `${y}-01-01` : `${y - 1}-07-01`, end: h2 ? `${y}-06-30` : `${y - 1}-12-31` },
  ];
}

function Tags({ ids, sources }: { ids: string[]; sources: SourceRef[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
      {ids.map((t) => <span key={t} className="bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{sources.find((s) => s.tag === t)?.label ?? t}</span>)}
    </div>
  );
}

export default function Evaluation() {
  const { team, hasFeature } = useTeam();
  const periods = halves();
  const [period, setPeriod] = useState(periods[0]);
  const [params] = useSearchParams();
  const [sel, setSel] = useState<string | null>(params.get('member'));
  const depth = useQuery({ queryKey: ['depth', team.id], queryFn: () => q<DepthRow[]>(supabase.rpc('member_data_depth', { p_team: team.id })) });
  useEffect(() => { if (!sel && depth.data?.[0]) setSel(depth.data[0].user_id); }, [depth.data, sel]);
  const member = depth.data?.find((d) => d.user_id === sel);
  const draft = useLatestAi<Draft>(team.id, 'evaluation_draft', { subject: sel, period_start: period.start }, !!sel);
  const gen = useGenerate('ai-evaluation-draft');
  const upd = useUpdateAi();
  const ev = useQuery({
    queryKey: ['evidence', team.id, sel, period.start], enabled: !!sel,
    queryFn: () => q<{ id: string; source: string; summary: string; occurred_at: string; polarity: string }[]>(supabase.from('evidence').select('id, source, summary, occurred_at, polarity')
      .eq('team_id', team.id).eq('subject_user_id', sel!).gte('occurred_at', period.start).lte('occurred_at', period.end + 'T23:59:59').neq('source', 'checkin').neq('source', 'ai')
      .order('occurred_at', { ascending: false }).limit(40)),
  });
  const d = draft.data;
  const view: Draft | null = d ? { ...d.content, ...(d.edited_content ?? {}) } : null;
  const [edit, setEdit] = useState(false);
  const [overall, setOverall] = useState('');
  const [coaching, setCoaching] = useState('');
  useEffect(() => { setOverall(view?.overall ?? ''); setCoaching(view?.coaching ?? ''); setEdit(false); }, [d?.id, d?.edited_at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hasFeature('evaluation')) return <section><PageHeader title="평가 초안" /><Upsell feature="근거 기반 평가 초안" /></section>;
  const run = () => sel && gen.mutate({ team_id: team.id, member_id: sel, period_start: period.start, period_end: period.end });

  return (
    <section>
      <PageHeader title="평가 초안" sub={`근거 원장에 쌓인 기록으로 평가 의견 초안을 씁니다 · 등급과 보상은 팀장이 정합니다`}
        right={<div className="flex bg-slate-100 rounded-lg p-0.5 text-[13px]">{periods.map((p) => (
          <button key={p.id} onClick={() => setPeriod(p)} className={cx('px-3 py-1 rounded-md', period.id === p.id ? 'bg-white shadow-sm font-semibold' : 'text-slate-500')}>{p.label}</button>
        ))}</div>} />
      <div className="grid lg:grid-cols-4 gap-5 items-start">
        <Card className="p-2 text-sm">
          {depth.isLoading ? <Spinner /> : !depth.data?.length ? <p className="p-3 text-slate-500">팀원이 없습니다.</p> : depth.data.map((m) => (
            <button key={m.user_id} onClick={() => setSel(m.user_id)}
              className={cx('w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left', sel === m.user_id ? 'bg-indigo-50 text-indigo-800 font-semibold' : 'hover:bg-slate-50')}>
              <span className="truncate">{m.full_name}</span>
              {m.eligible ? <span className="text-[11px] text-slate-500 bg-white border border-slate-200 rounded-full px-2 py-0.5 font-normal">근거 {m.judgment_evidence}</span>
                : <span className="text-[11px] text-amber-800 bg-amber-50 border border-dashed border-amber-300 rounded-full px-2 py-0.5 font-normal inline-flex items-center gap-1"><CircleDashed size={10} />판단 보류</span>}
            </button>
          ))}
        </Card>

        <div className="lg:col-span-3 space-y-5">
          {!member ? null : (
            <ProvBlock rail className="bg-white rounded-2xl border border-slate-200 p-6">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div><div className="text-lg font-bold">{member.full_name} · {member.job_title}</div>
                  <div className="text-sm text-slate-500">체크인 {member.checkin_weeks}주 · 1:1 {member.one_on_ones}회 · 결과물 {member.submissions}건 · 관찰 메모 {member.observations}건</div></div>
                <div className="flex items-center gap-2">
                  {d && <ProvChip kind={kindFromStatus(d.status)} label={d.status === 'withheld' ? '판단 보류' : d.status === 'final' ? '팀장 확정' : d.status === 'edited' ? 'AI 초안 · 팀장 수정' : 'AI 초안'}
                    sources={d.sources} level={d.level} depth={d.depth} note="문장마다 근거 태그를 달았습니다. 근거 없는 문장은 쓰지 않습니다. 등급은 팀장이 정합니다." />}
                  {d && d.status !== 'withheld' && d.status !== 'final' && (!edit ? <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><PenSquare size={13} />고치기</Button>
                    : <Button size="sm" onClick={() => { upd.mutate({ id: d.id, edited_content: { ...(d.edited_content ?? {}), overall, coaching } }); setEdit(false); }}>수정본 저장</Button>)}
                  {d && d.status !== 'withheld' && d.status !== 'final' && <Button size="sm" variant="secondary" onClick={() => upd.mutate({ id: d.id, status: 'final' })}><BadgeCheck size={13} />확정</Button>}
                </div>
              </div>

              {draft.isLoading ? <Spinner /> : !d ? (
                <Empty icon={<Sparkles size={18} />} title={`${period.label} 초안이 없습니다`}
                  action={<Button loading={gen.isPending} onClick={run}>{member.eligible ? '초안 만들기 · 5 크레딧' : '근거 확인하기 (크레딧 차감 없음)'}</Button>}>
                  {member.eligible ? '이 기간의 결과물·관찰 메모·리뷰 코멘트·1:1 기록을 근거로 초안을 씁니다.' : `판단 근거가 ${member.judgment_evidence}건이라 기준에 못 미칩니다. 요청해도 AI는 판단을 보류합니다.`}
                </Empty>
              ) : d.status === 'withheld' ? (
                <div className="mt-5 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-5 text-sm">
                  <div className="font-semibold text-amber-900 inline-flex items-center gap-1.5"><CircleDashed size={15} />AI가 판단을 보류했습니다</div>
                  <p className="mt-2 text-amber-900/90">{view?.reason}</p>
                  {view?.needed && <p className="mt-1 text-amber-900/80">{view.needed.suggestion} (현재 {view.needed.current}건 / 기준 {view.needed.required}건)</p>}
                  <Button className="mt-4" size="sm" variant="secondary" loading={gen.isPending} onClick={run}>다시 확인</Button>
                </div>
              ) : view && (
                <>
                  <div className="mt-5">
                    <div className="text-xs font-semibold text-slate-400 mb-1.5">종합 의견</div>
                    {edit ? <textarea rows={5} className={inputCls} value={overall} onChange={(e) => setOverall(e.target.value)} />
                      : <p className="text-[15px] leading-7 text-slate-800"><TaggedText text={view.overall ?? ''} sources={d.sources} /></p>}
                  </div>
                  <div className="mt-6 grid md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs font-semibold text-emerald-700 mb-2">강점</div>
                      {(view.strengths ?? []).map((s, i) => (<div key={i} className={i ? 'mt-4' : ''}><p className="text-sm font-semibold">{s.title}</p><p className="text-sm text-slate-600 mt-1"><TaggedText text={s.detail} sources={d.sources} /></p><Tags ids={s.evidence ?? []} sources={d.sources} /></div>))}
                    </div>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="text-xs font-semibold text-amber-800 mb-2">성장 포인트</div>
                      {(view.growth ?? []).map((s, i) => (<div key={i} className={i ? 'mt-4' : ''}><p className="text-sm font-semibold">{s.title}</p><p className="text-sm text-slate-600 mt-1"><TaggedText text={s.detail} sources={d.sources} /></p><Tags ids={s.evidence ?? []} sources={d.sources} /></div>))}
                    </div>
                  </div>
                  {!!view.competencies?.length && (
                    <div className="mt-5">
                      <div className="text-xs font-semibold text-slate-400 mb-2">역량별 신호</div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {view.competencies.map((c) => <span key={c.name} className={cx('rounded-full px-2.5 py-1', SIG[c.signal] ?? 'bg-slate-100')}>{c.name} · {c.signal}{c.evidence?.length ? ` (${c.evidence.length})` : ''}</span>)}
                      </div>
                    </div>
                  )}
                  <div className="mt-5">
                    <div className="text-xs font-semibold text-slate-400 mb-1.5">다음 기간 코칭 제안</div>
                    {edit ? <textarea rows={2} className={inputCls} value={coaching} onChange={(e) => setCoaching(e.target.value)} /> : <p className="text-sm text-slate-700">{view.coaching}</p>}
                  </div>
                  <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs text-slate-500">AI 초안은 기록을 정리한 것입니다. 등급과 보상은 팀장이 직접 판단합니다.</p>
                    {d.status !== 'final' && <Button size="sm" variant="ghost" loading={gen.isPending} onClick={run}>최신 근거로 다시 만들기</Button>}
                  </div>
                </>
              )}
            </ProvBlock>
          )}
          {sel && (
            <Card className="p-6">
              <div className="font-semibold flex items-center gap-2 flex-wrap">근거 타임라인 <span className="text-sm font-normal text-slate-400">{period.label}</span>
                <Link to={`/people/${sel}`} className="ml-auto text-xs text-teal-700 font-semibold">팀원 페이지 →</Link></div>
              <p className="mt-1 text-xs text-slate-500">일하면서 자동으로 쌓인 근거입니다 — 따로 정리하지 않아도 1:1·리뷰 피드백·결과물·관찰 메모·업무 완료가 여기에 모입니다.</p>
              {!!ev.data?.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {Object.entries(ev.data.reduce<Record<string, number>>((a, e) => ({ ...a, [e.source]: (a[e.source] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                    <span key={k} className="text-[11px] rounded-full bg-teal-50 text-teal-800 ring-1 ring-teal-100 px-2 py-0.5">{EVIDENCE_LABEL[k] ?? k} <b className="num">{n}</b></span>
                  ))}
                </div>
              )}
              {!ev.data?.length ? <p className="mt-3 text-sm text-slate-500">이 기간에 쌓인 판단 근거가 없습니다.</p> : (
                <ul className="mt-4 space-y-3 text-sm">
                  {ev.data.map((e) => {
                    const I = ICON[e.source] ?? FileText;
                    return (
                      <li key={e.id} className="flex gap-3">
                        <span className="font-mono text-xs text-slate-400 w-12 shrink-0 mt-0.5">{fmtShort(e.occurred_at)}</span>
                        <I size={15} className="text-indigo-600 mt-0.5 shrink-0" />
                        <span className="text-slate-700 flex-1">{e.summary}</span>
                        {e.polarity !== 'neutral' && <Pill tone={e.polarity === 'positive' ? 'emerald' : 'amber'}>{e.polarity === 'positive' ? '긍정' : '우려'}</Pill>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
