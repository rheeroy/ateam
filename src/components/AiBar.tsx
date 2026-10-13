// 모든 메뉴 상단에 같은 모양으로 붙는 'AI 인사이트 바' + 항목 옆 'AI 칩'
// — AI가 먼저 보고 정리했다는 것이 어디서든 눈에 띄도록 (제품의 핵심 가치)
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Lock, RefreshCw, Sparkles } from 'lucide-react';
import { useTeam } from '../state/session';
import { useGenerate, useLatestAi } from '../lib/hooks';
import { cx, fmtDate } from '../lib/format';
import { TYPE_META } from '../lib/insights';
import { AI_LINKS, INSIGHT_KIND, fresh, sectionsOf, type InsightItem, type InsightOut, type MainSection } from './home/shared';

type Period = 'daily' | 'weekly' | 'monthly';
const P_LABEL: Record<Period, string> = { daily: '오늘', weekly: '이번 주', monthly: '이번 달' };
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');

/** 작은 보라색 칩: 'AI 1차 검토', 'AI 준비 노트' 등 */
export function AiChip({ label = 'AI', tone = 'soft', className, title }: { label?: ReactNode; tone?: 'soft' | 'solid' | 'dark'; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-full text-[10px] font-semibold px-1.5 py-0.5 whitespace-nowrap',
      tone === 'solid' ? 'bg-violet-600 text-white' : tone === 'dark' ? 'bg-white/15 text-violet-100' : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200', className)}>
      <Sparkles size={10} />{label}
    </span>
  );
}

/** AI 띠 껍데기 — 내용은 자유롭게 (업무플랫폼처럼 AI 검토 결과를 모아 보여줄 때) */
export function AiBand({ title, right, children, className }: { title: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('relative overflow-hidden rounded-2xl bg-gradient-to-b from-violet-50 via-white to-white text-slate-900 ring-1 ring-violet-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]', className)}>
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-7 h-7 rounded-lg bg-violet-600 text-white flex items-center justify-center shadow-sm"><Sparkles size={14} /></span>
          <span className="text-xs font-bold tracking-tight text-violet-800">{title}</span>
          <div className="ml-auto flex items-center gap-1.5">{right}</div>
        </div>
        <div className="mt-2.5">{children}</div>
      </div>
    </section>
  );
}

/** 섹션별 AI 인사이트 (일·주·월 중 가장 최근의 유효한 해석) */
export function useSectionInsight(section: MainSection) {
  const { team } = useTeam();
  const d = useLatestAi<InsightOut>(team.id, INSIGHT_KIND.daily);
  const w = useLatestAi<InsightOut>(team.id, INSIGHT_KIND.weekly);
  const m = useLatestAi<InsightOut>(team.id, INSIGHT_KIND.monthly);
  const by = { daily: d.data, weekly: w.data, monthly: m.data };
  const ok = (p: Period) => !!by[p] && (team.is_demo || fresh(by[p], p));
  return { by, ok, loading: d.isLoading || w.isLoading || m.isLoading, section };
}

export function AiBar({ section, label, filter, emptyHint, n = 3, extra }: {
  section: MainSection; label: string; filter?: (it: InsightItem) => boolean; emptyHint?: string; n?: number; extra?: ReactNode;
}) {
  const { team, hasFeature } = useTeam();
  const s = useSectionInsight(section);
  const avail = (['daily', 'weekly', 'monthly'] as Period[]).filter((p) => s.ok(p));
  const [pick, setPick] = useState<Period | null>(null);
  const period: Period = pick && avail.includes(pick) ? pick : avail[0] ?? 'daily';
  const out = s.ok(period) ? s.by[period]! : null;
  const sec = useMemo(() => (out ? sectionsOf(out.content)[section] : null), [out, section]);
  const items = (sec?.items ?? []).filter((it) => !filter || filter(it));
  const [all, setAll] = useState(false);
  const gen = useGenerate('ai-insights');
  const ai = hasFeature('ai_core');
  const shown = all ? items : items.slice(0, n);

  const right = (
    <>
      {avail.length > 1 && (
        <span className="hidden sm:inline-flex rounded-lg bg-slate-100 p-0.5">
          {avail.map((p) => <button key={p} onClick={() => setPick(p)} className={cx('text-[11px] px-2 py-0.5 rounded-md', p === period ? 'bg-white text-slate-900 font-semibold shadow-sm' : 'text-slate-500 hover:text-slate-900')}>{P_LABEL[p]}</button>)}
        </span>
      )}
      {out && <span className="text-[10px] text-slate-400 hidden md:inline">{fmtDate(out.created_at)}</span>}
      {ai && <button disabled={gen.isPending} onClick={() => gen.mutate({ team_id: team.id, period })}
        className="text-[11px] font-semibold rounded-lg bg-white ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 px-2 py-1 inline-flex items-center gap-1 disabled:opacity-60">
        <RefreshCw size={11} className={gen.isPending ? 'animate-spin' : ''} />{gen.isPending ? '만드는 중…' : out ? '다시' : '지금 만들기'}</button>}
    </>
  );

  return (
    <AiBand title={`AI 인사이트 · ${label}${out ? ` · ${P_LABEL[period]}` : ''}`} right={right}>
      {!ai ? (
        <div className="text-sm flex items-center gap-2 flex-wrap"><Lock size={14} />AI 해석은 Pro에서 열립니다.
          <Link to="/settings?tab=billing" className="text-xs font-semibold rounded-lg bg-indigo-600 text-white px-2.5 py-1">Pro 시작하기</Link></div>
      ) : s.loading ? <p className="text-sm text-slate-500">불러오는 중…</p> : !out ? (
        <p className="text-sm text-slate-600">{emptyHint ?? '아직 해석이 없습니다.'} '지금 만들기'를 누르면 30초 안에 팀 기록을 엮어 정리합니다.</p>
      ) : (
        <>
          {sec?.summary && !filter && <p className="text-[15px] font-semibold leading-snug">{strip(sec.summary)}</p>}
          {extra}
          {!!shown.length && (
            <div className={cx('grid gap-2', sec?.summary && !filter ? 'mt-3' : '', shown.length >= 3 ? 'md:grid-cols-3' : shown.length === 2 ? 'md:grid-cols-2' : '')}>
              {shown.map((it, i) => <AiItemCard key={i} it={it} />)}
            </div>
          )}
          {!shown.length && filter && <p className="text-sm text-slate-500">{emptyHint ?? '이 대상에 대한 AI 해석은 아직 없습니다.'}</p>}
          {items.length > n && (
            <button onClick={() => setAll((v) => !v)} className="mt-2 text-[11px] text-slate-500 hover:text-slate-900 inline-flex items-center gap-0.5">
              {all ? '접기' : `${items.length - n}건 더 보기`}<ChevronDown size={12} className={all ? 'rotate-180' : ''} /></button>
          )}
        </>
      )}
    </AiBand>
  );
}

function AiItemCard({ it }: { it: InsightItem }) {
  const meta = TYPE_META[it.type] ?? TYPE_META.pattern;
  const to = it.link ? AI_LINKS[it.link] : undefined;
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-[10px]">
        <span className={cx('w-1.5 h-1.5 rounded-full', meta.dot)} /><span className="font-semibold text-slate-500">{meta.label}</span>
        {it.severity >= 3 && <span className="rounded bg-rose-500/90 text-white px-1 font-semibold">지금 확인</span>}
      </div>
      <div className="mt-1 text-sm font-semibold leading-snug">{strip(it.title)}</div>
      {it.body && <div className="mt-0.5 text-xs text-slate-600 leading-relaxed line-clamp-2">{strip(it.body)}</div>}
      {it.action && <div className="mt-1.5 text-xs font-semibold text-violet-700 inline-flex items-center gap-0.5">→ {strip(it.action)}{to && <ChevronRight size={12} />}</div>}
    </>
  );
  const cls = 'block rounded-xl bg-white ring-1 ring-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-3 text-left';
  return to ? <Link to={to} className={cx(cls, 'hover:ring-violet-300 hover:shadow-sm')}>{body}</Link> : <div className={cls}>{body}</div>;
}
