// 팀장 홈과 섹션 상세(/brief/:section)가 같이 쓰는 조각
//   데이터 수집 → 신호 엔진(_shared/signals.ts, 규칙·모델) → AI 인사이트(섹션별 해석) → 홈(엑기스) / 상세(전체)
import { useExecutives } from '../../lib/upward';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Building2, CalendarClock, Check, CheckCircle2, ChevronDown, ChevronRight,
  EyeOff, Gavel, Layers, Lock, Plus, RefreshCw, ShieldAlert, Sparkles, StickyNote, Target, ThumbsUp, Users, X,
} from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText, invoke } from '../../lib/supabase';
import { useGenerate, useLatestAi, useTeamMembersOnly } from '../../lib/hooks';
import type { ActionItem, AiKind, AiOutput, InsightLevel, OneOnOne, OrgImpact, OrgNote, OrgNoteKind, Submission, SubmissionVersion } from '../../lib/types';
import { addDays, cx, daysAgo, fmtDate, mondayOf, ymd } from '../../lib/format';
import { Button, Modal, Spinner, inputCls, useToast } from '../ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../Prov';
import {
  PERIOD_LABEL, TYPE_META, sectionOf, useHomeInsights,
  type Domain, type DomainSummary, type HomeSection, type Period, type Raw, type Signal, type SignalType, type Status,
} from '../../lib/insights';

// =====================================================================
// 데이터 (대기열·조직 메모)
// =====================================================================
export type PromiseRow = ActionItem & { one_on_ones: { member_id: string } | null };
type ReviewRow = { s: Submission; v?: Pick<SubmissionVersion, 'id' | 'version' | 'created_at'>; review?: Pick<AiOutput, 'ref_id'> };

export function useWeekOneOnOnes(teamId: string) {
  const mon = mondayOf();
  return useQuery({
    queryKey: ['oo-week', teamId, mon],
    queryFn: () => q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', teamId).eq('status', 'scheduled')
      .gte('scheduled_at', mon).lt('scheduled_at', addDays(mon, 7)).order('scheduled_at')),
  });
}
export function useReviewQueue(teamId: string) {
  return useQuery({
    queryKey: ['review-queue', teamId],
    queryFn: async (): Promise<ReviewRow[]> => {
      const subs = await q<(Submission & { submission_versions: Pick<SubmissionVersion, 'id' | 'version' | 'created_at'>[] })[]>(
        supabase.from('submissions').select('*, submission_versions(id, version, created_at)').eq('team_id', teamId).eq('status', 'in_review').order('updated_at', { ascending: false }).limit(20));
      const latest = subs.map((s) => [...s.submission_versions].sort((a, b) => b.version - a.version)[0]).filter(Boolean);
      const reviews = latest.length ? await q<Pick<AiOutput, 'ref_id'>[]>(supabase.from('ai_outputs').select('ref_id').eq('kind', 'review').in('ref_id', latest.map((v) => v.id))) : [];
      return subs.map((s) => {
        const v = [...s.submission_versions].sort((a, b) => b.version - a.version)[0];
        return { s, v, review: reviews.find((r) => r.ref_id === v?.id) };
      });
    },
  });
}
export function usePromises(teamId: string) {
  const { uid } = useTeam();
  return useQuery({
    queryKey: ['promises', teamId, uid],
    queryFn: () => q<PromiseRow[]>(supabase.from('action_items')
      .select('*, one_on_ones(member_id)').eq('team_id', teamId).eq('owner_id', uid).is('done_at', null).order('due_date', { nullsFirst: false }).limit(20)),
  });
}
export function useAnsweredRequests(teamId: string) {
  const { uid } = useTeam();
  return useQuery({
    queryKey: ['requests', teamId, 'answered'],
    queryFn: async () => (await supabase.from('team_requests').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('from_id', uid)
      .eq('status', 'done').gte('responded_at', new Date(Date.now() - 3 * 86400000).toISOString())).count ?? 0,
  });
}
export function useOrgNotes(teamId: string) {
  return useQuery({
    queryKey: ['org-notes', teamId],
    queryFn: async () => {
      const notes = await q<OrgNote[]>(supabase.from('org_notes').select('*').eq('team_id', teamId).order('created_at', { ascending: false }).limit(40));
      const ids = notes.map((n) => n.id);
      const imps = ids.length ? await q<AiOutput<OrgImpact>[]>(supabase.from('ai_outputs').select('*').eq('team_id', teamId).eq('kind', 'org_impact').in('ref_id', ids).order('created_at', { ascending: false })) : [];
      const impactOf = new Map<string, AiOutput<OrgImpact>>();
      for (const i of imps) if (i.ref_id && !impactOf.has(i.ref_id)) impactOf.set(i.ref_id, i);
      return { notes, impactOf };
    },
  });
}
export function useRecentDecisions(teamId: string) {
  return useQuery({
    queryKey: ['decisions', teamId, 'recent'],
    queryFn: () => q<{ id: string; title: string; expected_outcome: string; decided_at: string; review_on: string | null; outcome: string | null; outcome_rating: 'hit' | 'partial' | 'miss' | null }[]>(
      supabase.from('decisions').select('id, title, expected_outcome, decided_at, review_on, outcome, outcome_rating').eq('team_id', teamId).order('decided_at', { ascending: false }).limit(6)),
  });
}
export const todayYmd = () => ymd(new Date());
export const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
export const dDay = (d: string) => Math.round((Date.parse(d) - Date.parse(todayYmd())) / 86400000);


// =====================================================================
// 섹션·상태 메타
// =====================================================================
export type MainSection = 'risk' | 'decide' | 'perf' | 'people' | 'org';
export const MAIN_SECTIONS: MainSection[] = ['risk', 'decide', 'perf', 'people', 'org'];
export const STATUS_META: Record<Status, { label: string; cls: string; bar: string }> = {
  risk: { label: '위험', cls: 'bg-rose-50 text-rose-700 border-rose-200', bar: 'bg-rose-500' },
  watch: { label: '주의', cls: 'bg-amber-50 text-amber-800 border-amber-200', bar: 'bg-amber-400' },
  good: { label: '양호', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', bar: 'bg-emerald-500' },
  unknown: { label: '데이터 부족', cls: 'bg-slate-50 text-slate-500 border-slate-200', bar: 'bg-slate-300' },
};
const RANK: Record<Status, number> = { unknown: 0, good: 1, watch: 2, risk: 3 };
export const worst = (xs: Status[]): Status => xs.filter((x) => x !== 'unknown').sort((a, b) => RANK[b] - RANK[a])[0] ?? 'unknown';
export const SECTION_META: Record<MainSection, { name: string; icon: typeof Target; question: string }> = {
  risk: { name: '리스크', icon: ShieldAlert, question: '무엇이 커지고 있고, 원인은 어디서 오나' },
  decide: { name: '의사결정', icon: Gavel, question: '무엇을 결정해야 하고, 지난 결정은 맞았나' },
  perf: { name: '팀 성과', icon: Target, question: '목표가 달성되나, 일이 굴러가나' },
  people: { name: '팀원관리', icon: Users, question: '다들 괜찮고, 크고 있나' },
  org: { name: '조직·전사', icon: Building2, question: '위에서 무엇이 바뀌었고, 위로 무엇을 올려야 하나' },
};
/** 섹션별 색 (박스 구분용) — Tailwind 가 읽도록 클래스 이름을 그대로 적는다 */
export const SECTION_TONE: Record<MainSection, { bar: string; head: string; icon: string; grad: string; ring: string; text: string; dot: string; hex: string; soft: string }> = {
  risk: { bar: 'bg-rose-500', head: 'from-rose-50', icon: 'bg-rose-100 text-rose-700', grad: 'from-rose-500 to-rose-600', ring: 'hover:ring-rose-200', text: 'text-rose-700', dot: 'bg-rose-500', hex: '#e11d48', soft: 'bg-rose-50' },
  decide: { bar: 'bg-slate-800', head: 'from-slate-100', icon: 'bg-slate-800 text-white', grad: 'from-slate-700 to-slate-900', ring: 'hover:ring-slate-300', text: 'text-slate-800', dot: 'bg-slate-700', hex: '#334155', soft: 'bg-slate-100' },
  perf: { bar: 'bg-indigo-600', head: 'from-indigo-50', icon: 'bg-indigo-100 text-indigo-700', grad: 'from-indigo-500 to-indigo-700', ring: 'hover:ring-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-600', hex: '#4f46e5', soft: 'bg-indigo-50' },
  people: { bar: 'bg-teal-600', head: 'from-teal-50', icon: 'bg-teal-100 text-teal-700', grad: 'from-teal-500 to-teal-700', ring: 'hover:ring-teal-200', text: 'text-teal-700', dot: 'bg-teal-600', hex: '#0d9488', soft: 'bg-teal-50' },
  org: { bar: 'bg-fuchsia-600', head: 'from-fuchsia-50', icon: 'bg-fuchsia-100 text-fuchsia-700', grad: 'from-fuchsia-500 to-fuchsia-700', ring: 'hover:ring-fuchsia-200', text: 'text-fuchsia-700', dot: 'bg-fuchsia-600', hex: '#c026d3', soft: 'bg-fuchsia-50' },
};

// =====================================================================
// 작은 시각 요소 (숫자 옆에 붙는 것) — 상태색(빨강·주황·초록)은 상태에만 쓰고, 항상 글자와 함께
// =====================================================================
export type SevTone = 'rose' | 'amber' | 'emerald' | 'slate' | 'indigo' | 'teal' | 'fuchsia';
const RING_HEX: Record<SevTone, { fill: string; track: string }> = {
  rose: { fill: '#e11d48', track: '#ffe4e6' }, amber: { fill: '#f59e0b', track: '#fef3c7' }, emerald: { fill: '#059669', track: '#d1fae5' },
  slate: { fill: '#64748b', track: '#e2e8f0' }, indigo: { fill: '#4f46e5', track: '#e0e7ff' }, teal: { fill: '#0d9488', track: '#ccfbf1' }, fuchsia: { fill: '#c026d3', track: '#fae8ff' },
};
export const sevOfPct = (p: number | null | undefined): SevTone => (p == null ? 'slate' : p < 35 ? 'rose' : p < 50 ? 'amber' : 'emerald');

/** 원형 게이지: 0~100 */
export function Ring({ value, tone, size = 52, label }: { value: number | null; tone: SevTone; size?: number; label?: string }) {
  const r = (size - 7) / 2; const c = 2 * Math.PI * r; const v = Math.max(0, Math.min(100, value ?? 0));
  const h = RING_HEX[tone];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? `${value ?? '—'}%`} className="shrink-0">
      <title>{label ?? `${value ?? '—'}%`}</title>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={h.track} strokeWidth={6} />
      {value != null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={h.fill} strokeWidth={6} strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
    </svg>
  );
}

/** 가로 미터: 채움은 상태, 빈 곳은 같은 색의 옅은 단계 */
export function Meter({ pct, tone }: { pct: number; tone: SevTone }) {
  const h = RING_HEX[tone];
  return (
    <div className="h-1.5 rounded-full w-full" style={{ background: h.track }}>
      <div className="h-1.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: h.fill }} />
    </div>
  );
}

/** 추세선 (한 계열): 2px 선 + 옅은 면 + 마지막 점 강조, 점마다 툴팁 */
export function Sparkline({ points, labels, tone = 'teal', w = 120, h = 34, min = 1, max = 5 }: { points: (number | null)[]; labels: string[]; tone?: SevTone; w?: number; h?: number; min?: number; max?: number }) {
  const pts = points.map((v, i) => ({ v, i })).filter((p) => p.v != null) as { v: number; i: number }[];
  if (pts.length < 2) return <div className="text-[11px] text-slate-400" style={{ width: w }}>추세는 2주 이상 쌓이면</div>;
  const n = points.length; const pad = 5;
  const x = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${d} L${x(pts[pts.length - 1].i).toFixed(1)},${h - pad} L${x(pts[0].i).toFixed(1)},${h - pad} Z`;
  const c = RING_HEX[tone].fill; const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`추세: ${pts.map((p) => `${labels[p.i]} ${p.v.toFixed(1)}`).join(', ')}`}>
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="#e2e8f0" strokeWidth={1} />
      <path d={area} fill={c} opacity={0.1} />
      <path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={p === last ? 4 : 7} fill={p === last ? c : 'transparent'} stroke={p === last ? '#fff' : 'none'} strokeWidth={2}>
          <title>{`${labels[p.i]} · ${p.v.toFixed(1)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** 누적 가로 막대 (영역별 건수): 조각 사이 2px 흰 틈, 범례는 글자 + 색 점 */
export function StackBar({ parts }: { parts: { label: string; n: number; hex: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return <div className="h-2 rounded-full bg-slate-100" />;
  return (
    <div>
      <div className="flex h-2 gap-[2px]">
        {parts.filter((p) => p.n).map((p) => <div key={p.label} title={`${p.label} ${p.n}건`} className="h-2 first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.n / total) * 100}%`, background: p.hex }} />)}
      </div>
      <div className="mt-1.5 flex gap-3 text-[11px] text-slate-600">
        {parts.filter((p) => p.n).map((p) => <span key={p.label} className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: p.hex }} />{p.label} {p.n}</span>)}
      </div>
    </div>
  );
}

/** 실적 전망 막대: 80% 범위(옅은 띠) + 기말 전망(점) + 목표(세로선) — 값은 글자로도 */
export function RangeBar({ low, base, high, target, unit, compact }: { low: number; base: number; high: number; target: number | null; unit: string; compact?: boolean }) {
  const max = Math.max(high, target ?? 0) * 1.08 || 1;
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const short = target != null && base < target;
  const fmt = (v: number) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('ko-KR') : String(Math.round(v * 10) / 10));
  return (
    <div className="w-full">
      <div className="relative h-7">
        <div className="absolute top-3 inset-x-0 h-1 rounded-full bg-slate-100" />
        <div className="absolute top-2 h-3 rounded-full bg-indigo-100" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} title={`80% 범위 ${fmt(low)}~${fmt(high)}${unit}`} />
        {target != null && <div className="absolute top-0.5 h-6 w-[2px] rounded bg-slate-700" style={{ left: pct(target) }} title={`목표 ${fmt(target)}${unit}`} />}
        <div className={cx('absolute top-1.5 w-4 h-4 -ml-2 rounded-full ring-2 ring-white', short ? 'bg-rose-500' : 'bg-emerald-500')} style={{ left: pct(base) }} title={`기말 전망 ${fmt(base)}${unit}`} />
      </div>
      {!compact && <div className="flex justify-between text-[11px] text-slate-500 num">
        <span>전망 <b className={short ? 'text-rose-600' : 'text-emerald-700'}>{fmt(base)}{unit}</b> <span className="text-slate-400">({fmt(low)}~{fmt(high)})</span></span>
        {target != null && <span>목표 <b className="text-slate-800">{fmt(target)}{unit}</b></span>}
      </div>}
    </div>
  );
}

/** 작은 세로 막대 (한 계열): 막대 ≤ 24px, 위쪽만 둥글게, 바닥선 하나, 마지막 값만 글자, 막대마다 툴팁 */
export function MiniColumns({ values, labels, h = 64, hex = '#4f46e5', unit = '', bare }: { values: number[]; labels: string[]; h?: number; hex?: string; unit?: string; bare?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="flex items-end gap-[6px] border-b border-slate-200" style={{ height: h }}>
        {values.map((v, i) => {
          const last = i === values.length - 1;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${labels[i]} · ${v}${unit}`}>
              {last && !bare && <span className="text-[11px] font-semibold text-slate-700 num mb-0.5">{v}</span>}
              <div className="w-full max-w-[24px] rounded-t-[4px] transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(v ? 4 : 0, (v / max) * (h - (bare ? 4 : 18)))}px`, background: last ? hex : `${hex}55` }} />
            </div>
          );
        })}
      </div>
      {!bare && <div className="flex gap-[6px] mt-1">{labels.map((l, i) => <span key={i} className="flex-1 text-center text-[10px] text-slate-400 truncate">{l}</span>)}</div>}
    </div>
  );
}

/** 숫자 타일: 옅은 바탕 위에 라벨·값·보조·그림 */
export function Tile({ label, value, sub, tone, viz, below, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'rose' | 'amber'; viz?: ReactNode; below?: ReactNode; className?: string }) {
  if (below) return (
    <div className={cx('rounded-xl bg-white/80 ring-1 ring-slate-900/5 px-3 py-2.5 min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-2"><span className="text-[11px] text-slate-500 truncate">{label}</span>{sub && <span className="text-[11px] text-slate-400 truncate">{sub}</span>}</div>
      <div className="flex items-end gap-2"><span className={cx('text-[22px] font-bold num leading-tight tracking-tight', tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900')}>{value}</span><span className="flex-1 min-w-0 flex justify-end">{below}</span></div>
    </div>
  );
  return (
    <div className={cx('rounded-xl bg-white/80 ring-1 ring-slate-900/5 px-3 py-2.5 min-w-0 flex items-center gap-3', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-slate-500 truncate">{label}</div>
        <div className={cx('text-[22px] font-bold num leading-tight tracking-tight', tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900')}>{value}</div>
        {sub && <div className="text-[11px] text-slate-400 truncate">{sub}</div>}
      </div>
      {viz}
    </div>
  );
}

const DOMAIN_SECTION = (d: Domain | undefined): MainSection => (d === 'goal' || d === 'exec' ? 'perf' : d === 'org' ? 'org' : 'people');

export function Kpi({ label, value, sub, tone, small }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'rose' | 'amber'; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-slate-500 truncate">{label}</div>
      <div className={cx(small ? 'text-sm mt-1.5' : 'text-xl mt-0.5', 'font-bold num leading-tight', tone === 'rose' ? 'text-rose-600' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900')}>{value}</div>
      {sub && <div className="text-[11px] text-slate-400 truncate">{sub}</div>}
    </div>
  );
}

export function PeriodTabs({ period, setPeriod, dark }: { period: Period; setPeriod: (p: Period) => void; dark?: boolean }) {
  return (
    <div className={cx('flex gap-0.5 rounded-lg p-0.5', dark ? 'bg-white/10' : 'bg-slate-100')} role="tablist" aria-label="기간">
      {(['daily', 'weekly', 'monthly'] as Period[]).map((p) => (
        <button key={p} role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
          className={cx('text-sm px-3 py-1 rounded-md', period === p ? (dark ? 'bg-white text-slate-900 font-semibold' : 'bg-white shadow-sm text-slate-900 font-semibold') : dark ? 'text-slate-300 hover:text-white' : 'text-slate-600')}>{PERIOD_LABEL[p]}</button>
      ))}
    </div>
  );
}

/** 기간은 주소(?p=)에 둬서 홈과 상세가 같은 기간을 본다 */
export function usePeriod(): [Period, (p: Period) => void] {
  const [sp, setSp] = useSearchParams();
  const p = sp.get('p');
  const period: Period = p === 'weekly' || p === 'monthly' ? p : 'daily';
  return [period, (np) => { const n = new URLSearchParams(sp); if (np === 'daily') n.delete('p'); else n.set('p', np); setSp(n, { replace: true }); }];
}

// =====================================================================
// AI 인사이트 — 섹션별 해석
// =====================================================================
export interface InsightItem { type: SignalType; severity: number; title: string; body: string; action?: string; link?: string; domain?: Domain; options?: string[]; impact?: string }
export interface SectionAi { summary: string; items: InsightItem[] }
export interface InsightOut {
  headline: string; watch_next?: string; period?: Period;
  sections?: Partial<Record<MainSection, SectionAi>>;
  items?: InsightItem[]; // 예전 형식 (영역별 묶음 전)
}
export const INSIGHT_KIND: Record<Period, AiKind> = { daily: 'insight_daily', weekly: 'insight_weekly', monthly: 'insight_monthly' };
/** 홈 섹션 → 이동할 곳 (팀 성과는 팀목표, 팀원관리는 통합 메뉴, 나머지는 섹션 상세) */
export const sectionHref = (section: MainSection, period = 'daily') =>
  section === 'perf' ? '/goals' : section === 'decide' || section === 'risk' ? `/decide${section === 'risk' ? '?f=risk' : ''}`
    : `${section === 'people' ? '/people' : `/brief/${section}`}${period === 'daily' ? '' : `?p=${period}`}`;
export const AI_LINKS: Record<string, string> = { goals: '/goals', team: '/people', reviews: '/work', one_on_ones: '/people', perf: '/perf', sim: '/perf', knowhow: '/knowhow', report: '/upward', eval: '/eval', strategy: '/perf', org: '/upward' };
export const fresh = (o: { created_at: string } | null | undefined, p: Period) => !!o && daysAgo(o.created_at) < (p === 'daily' ? 1 : p === 'weekly' ? 7 : 31);

/** 새 형식(sections)과 예전 형식(items+domain)을 같은 모양으로 */
export function sectionsOf(c: InsightOut | undefined): Record<MainSection, SectionAi> {
  const out: Record<MainSection, SectionAi> = { risk: { summary: '', items: [] }, decide: { summary: '', items: [] }, perf: { summary: '', items: [] }, people: { summary: '', items: [] }, org: { summary: '', items: [] } };
  if (!c) return out;
  if (c.sections) {
    for (const s of MAIN_SECTIONS) {
      const v = c.sections[s];
      if (v) out[s] = { summary: v.summary ?? '', items: [...(v.items ?? [])].sort((a, b) => b.severity - a.severity) };
    }
    return out;
  }
  for (const it of c.items ?? []) out[it.type === 'risk' && it.severity >= 3 ? 'risk' : DOMAIN_SECTION(it.domain)].items.push(it);
  for (const s of MAIN_SECTIONS) out[s].items.sort((a, b) => b.severity - a.severity);
  return out;
}

/** 상세 화면의 섹션 AI 해석 카드 */
export function SectionAiCard({ teamId, period, section, out, loading }: { teamId: string; period: Period; section: MainSection; out: AiOutput<InsightOut> | null; loading: boolean }) {
  const { hasFeature, credits } = useTeam();
  const nav = useNavigate();
  const gen = useGenerate('ai-insights');
  const ai = hasFeature('ai_core');
  const sec = out ? sectionsOf(out.content)[section] : null;
  return (
    <ProvBlock rail={!!out} className="rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50/40 border border-violet-100 p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles size={15} className="text-violet-600" />
        <span className="font-semibold text-sm">AI 해석 · {SECTION_META[section].name}</span>
        {out && <ProvChip kind={kindFromStatus(out.status)} label="AI 해석" sources={out.sources} level={out.level} depth={out.depth} note="자동 감지 신호와 기간 기록을 AI가 엮어 해석했습니다. 숫자는 모델 계산값 그대로입니다." />}
        <span className="ml-auto text-[11px] text-slate-400">{out ? `${fmtDate(out.created_at)} · ` : ''}{period === 'daily' ? '평일 아침 자동' : period === 'weekly' ? '월요일 아침 자동' : '매월 1일 자동'}</span>
        {ai && <Button size="sm" variant="ghost" loading={gen.isPending} onClick={() => gen.mutate({ team_id: teamId, period })}><RefreshCw size={12} />{out ? '다시' : '지금 만들기'}</Button>}
      </div>
      {!ai ? (
        <div className="mt-3 text-sm">
          <div className="font-semibold flex items-center gap-1.5"><Lock size={14} className="text-violet-600" />AI 해석은 Pro에서 열립니다</div>
          <p className="mt-1 text-slate-600">{credits?.trial_expired ? '30일 체험이 끝났습니다. 기록은 그대로 쌓이고 있고, ' : ''}AI가 신호를 엮어 원인과 순서, 할 일을 정리합니다.</p>
          <Link to="/settings?tab=billing"><Button size="sm" className="mt-2">Pro 시작하기</Button></Link>
        </div>
      ) : loading ? <Spinner /> : !out ? (
        <p className="mt-2 text-sm text-slate-600">아직 {PERIOD_LABEL[period]} 해석이 없습니다. '지금 만들기'를 누르면 30초 안에 네 섹션을 한 번에 정리합니다 (구독 포함, 크레딧 없음).</p>
      ) : !sec?.summary && !sec?.items.length ? (
        <p className="mt-2 text-sm text-slate-600">이번 {PERIOD_LABEL[period]} 해석에서 이 섹션은 특별히 짚을 것이 없었습니다.</p>
      ) : (
        <div className="mt-2.5 space-y-3">
          {sec.summary && <p className="text-[15px] font-semibold text-slate-900"><TaggedText text={sec.summary} sources={out.sources} /></p>}
          <ul className="space-y-3">
            {sec.items.map((it, i) => {
              const meta = TYPE_META[it.type] ?? TYPE_META.pattern;
              return (
                <li key={i} className="flex gap-2.5">
                  <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', meta.dot)} />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex items-center gap-1.5 text-[11px]"><span className={cx('font-semibold rounded px-1.5 py-0.5', meta.cls)}>{meta.label}</span>
                      {it.severity >= 3 && <span className="text-rose-600 font-semibold">지금 확인</span>}</div>
                    <div className="mt-0.5 font-semibold">{it.title}</div>
                    <p className="text-slate-700 leading-relaxed"><TaggedText text={it.body} sources={out.sources} /></p>
                    {it.impact && <p className="mt-1 text-xs text-slate-600"><b className="font-semibold text-slate-800">기대 효과</b> · <TaggedText text={it.impact} sources={out.sources} /></p>}
                    {!!it.options?.length && <ul className="mt-1.5 flex flex-wrap gap-1.5">{it.options.map((o, oi) => <li key={oi} className="text-xs rounded-lg bg-white ring-1 ring-slate-200 px-2 py-1">{String.fromCharCode(65 + oi)}. {o}</li>)}</ul>}
                    {it.action && (
                      <button onClick={() => it.link && AI_LINKS[it.link] && nav(AI_LINKS[it.link])}
                        className={cx('mt-1 text-xs inline-flex items-center gap-1', it.link && AI_LINKS[it.link] ? 'text-indigo-700 font-semibold hover:underline' : 'text-slate-700')}>→ {it.action}</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {section === 'risk' && out.content.watch_next && <p className="text-xs text-slate-500 border-t border-violet-100 pt-2">다음에 지켜볼 것 · {out.content.watch_next}</p>}
        </div>
      )}
    </ProvBlock>
  );
}

// =====================================================================
// 홈 모델 — 신호를 기간·섹션으로 나누고, 상태·숫자·AI 해석을 한곳에서 계산 (홈과 상세가 같은 값을 본다)
// =====================================================================
export function useHomeModel(period: Period) {
  const { team, uid, members, hasFeature } = useTeam();
  const minEv = (team.settings?.min_judgment_evidence as number) ?? 8;
  const ins = useHomeInsights(team.id, uid, members, minEv);
  const insightQ = useLatestAi<InsightOut>(team.id, INSIGHT_KIND[period]);
  const org = useOrgNotes(team.id);
  const snooze = useSnooze(team.id);
  const raw = ins.data?.raw;
  const domains = ins.data?.domains ?? [];
  const dom = (d: Domain): DomainSummary | undefined => domains.find((x) => x.domain === d);

  const visible = useMemo(() => (ins.data?.signals ?? []).filter((s) => s.periods.includes(period) && !snooze.isHidden(s.id)), [ins.data, period, snooze]);
  const by = (sec: HomeSection) => visible.filter((s) => sectionOf(s) === sec);
  // 리스크: 성과·사람·조직 어디서든 위험·위험한 전망을 모아서 급한 순으로
  const AREAS = ['perf', 'people', 'org'];
  const riskList = visible.filter((s) => AREAS.includes(sectionOf(s)) && (s.type === 'risk' || (s.type === 'forecast' && s.severity >= 2)));
  const bigRisks = riskList.filter((s) => s.severity >= 3);
  // 의사결정: 돌아볼 결정 (기간과 무관)
  const decideRule = (ins.data?.signals ?? []).filter((s) => sectionOf(s) === 'decide' && !snooze.isHidden(s.id));
  const recentDecisions = useRecentDecisions(team.id);
  const full = hasFeature('signals');
  const allowed = new Set(visible.filter((s) => s.type !== 'data' && sectionOf(s) !== 'todo').slice(0, 2).map((s) => s.id));
  const locked = (id: string) => !full && !allowed.has(id);

  // 데모 팀은 미리 넣어 둔 해석을 날짜와 상관없이 보여줌
  const insight = insightQ.data && (team.is_demo || fresh(insightQ.data, period)) ? insightQ.data : null;
  const ai = sectionsOf(insight?.content);
  const perfRisks = by('perf').filter((s) => s.domain === 'goal' && (s.type === 'risk' || (s.type === 'forecast' && s.severity >= 2)));
  const orgSt = orgStats(org.data, perfRisks);

  // 숫자
  const nMem = members.filter((m) => m.role === 'member').length;
  const thisMon = mondayOf();
  const careFlagged = (raw?.care ?? []).filter((c) => c.signals.some((s) => ['condition_down', 'blocked_repeat', 'no_one_on_one'].includes(s.type)));
  // 최근 6주 팀 평균 컨디션 (추세선)
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(thisMon, -7 * (5 - i)));
  const condTrend = weeks.map((w) => { const v = (raw?.checkins ?? []).filter((c) => c.week_start === w && c.condition != null).map((c) => c.condition!); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; });
  const rated = (recentDecisions.data ?? []).filter((d) => d.outcome_rating);
  const hitRate = rated.length ? Math.round((rated.filter((d) => d.outcome_rating === 'hit').length + rated.filter((d) => d.outcome_rating === 'partial').length * 0.5) / rated.length * 100) : null;
  const k = {
    goalLow: dom('goal')?.kpi ?? '—',
    goalLowTone: raw?.goals?.some((g) => (g.probability ?? 100) < 35) ? 'rose' as const : undefined,
    goals: raw?.goals?.length ?? 0,
    onPlan: dom('exec')?.kpi ?? '—',
    onPlanSub: dom('exec')?.kpiLabel.replace('계획대로 진행 ', '') ?? '',
    blocked: (raw?.items ?? []).filter((i) => i.status === 'blocked').length,
    delayed: (raw?.schedule ?? []).filter((r) => (r.projected_delay ?? 0) >= 7).length,
    fc: raw?.forecasts.find((f) => !f.insufficient && f.base != null),
    cond: dom('people')?.kpi ?? '—',
    ciThis: new Set((raw?.checkins ?? []).filter((c) => c.week_start >= thisMon).map((c) => c.user_id)).size,
    nMem,
    noOO: (raw?.care ?? []).filter((c) => c.signals.some((s) => s.type === 'no_one_on_one')).length,
    careN: careFlagged.length,
    careNames: careFlagged.map((c) => c.full_name),
    evidence: dom('growth')?.kpi ?? '—',
    reviewWait: dom('output')?.kpi ?? '—',
    reviewSub: dom('output')?.kpiLabel ?? '',
    condTrend, weekStarts: weeks, condWeeks: weeks.map((w) => `${Number(w.slice(5, 7))}/${Number(w.slice(8, 10))}주`), hitRate, rated: rated.length,
    goalLowNum: (raw?.goals ?? []).filter((g) => g.probability != null).reduce<number | null>((a, g) => (a == null || g.probability! < a ? g.probability! : a), null),
    onPlanNum: dom('exec')?.kpi && dom('exec')!.kpi !== '—' ? parseInt(dom('exec')!.kpi) : null,
    evidenceOk: (raw?.depth ?? []).filter((d) => d.eligible).length, evidenceAll: (raw?.depth ?? []).length,
    decisionsDue: (raw?.decisionsDue ?? []).filter((d) => (d.review_on ? d.review_on <= todayYmd() : daysAgo(d.decided_at) >= 30)).length,
  };
  const lowGoals = (raw?.goals ?? []).filter((g) => g.probability != null && g.probability < 35);
  const status: Record<MainSection, Status> = {
    risk: !ins.data ? 'unknown' : bigRisks.length ? 'risk' : riskList.length ? 'watch' : 'good',
    decide: !ins.data ? 'unknown' : decideRule.length || orgSt.high.length || lowGoals.length ? 'watch' : 'good',
    perf: worst([dom('goal')?.status ?? 'unknown', dom('exec')?.status ?? 'unknown']),
    people: worst([dom('people')?.status ?? 'unknown', dom('growth')?.status ?? 'unknown', dom('output')?.status ?? 'unknown']),
    org: orgSt.status,
  };
  // Positive: 좋은 신호(기간 무관) + 순항 목표 + 적중한 결정 + 결과물 통과
  const goods = (ins.data?.signals ?? []).filter((s) => s.type === 'good' && !snooze.isHidden(s.id));
  const onTrack = (raw?.goals ?? []).filter((g) => g.probability != null && g.probability >= 70);
  const hits = (recentDecisions.data ?? []).filter((d) => d.outcome_rating === 'hit');
  const approved60 = (raw?.subs ?? []).filter((x) => x.status === 'approved');
  const firstPass = approved60.filter((x) => Math.max(1, ...x.submission_versions.map((v) => v.version)) === 1).length;
  const positives = [
    ...goods.map((g) => ({ id: g.id, title: g.title, detail: g.detail, area: sectionOf(g) as string, signal: g })),
    ...onTrack.map((g) => ({ id: `ontrack-${g.goal_id}`, title: `'${g.title}' 순항 중 — 달성 가능성 ${g.probability}%`, detail: `진척 ${g.progress}% · 막힘 없음`, area: 'perf', signal: undefined })),
    ...hits.slice(0, 2).map((d) => ({ id: `hit-${d.id}`, title: `'${d.title}' 결정이 적중했습니다`, detail: d.outcome ?? undefined, area: 'decide', signal: undefined })),
    ...(approved60.length ? [{ id: 'subs-approved', title: `최근 60일 결과물 승인 ${approved60.length}건`, detail: `그중 한 번에 통과 ${firstPass}건`, area: 'people', signal: undefined }] : []),
  ];
  return { goods, positives, loading: ins.isLoading, raw, visible, by, decideRule, riskList, bigRisks, lowGoals, recentDecisions: recentDecisions.data ?? [], locked, snooze, insight, insightLoading: insightQ.isLoading, ai, org, orgSt, perfRisks, k, status };
}
export type HomeModel = ReturnType<typeof useHomeModel>;

/** 신호의 행동 버튼 처리 (관찰 메모 / 화면 이동 / 같은 화면 안 이동) */
export function useSignalAct(openMemo: (who: string | null) => void) {
  const nav = useNavigate();
  return (s: Signal) => {
    if (!s.action) return;
    if (s.action.memo !== undefined) return openMemo(s.action.memo ?? null);
    if (s.action.to === '#org') return nav('/upward');
    if (s.action.to?.startsWith('#')) return document.getElementById(s.action.to.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (s.action.to) nav(s.action.to);
  };
}

// =====================================================================
// 자동 감지 신호 목록
// =====================================================================
// 확인한 신호는 7일 동안 숨김 (브라우저별 편의 기능)
export const SNOOZE_DAYS = 7;
export function useSnooze(teamId: string) {
  const key = `ateam.snooze.${teamId}`;
  const [map, setMap] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
  });
  const save = (m: Record<string, number>) => { setMap(m); try { localStorage.setItem(key, JSON.stringify(m)); } catch { /* 저장 불가 */ } };
  const now = Date.now();
  return {
    isHidden: (id: string) => (map[id] ?? 0) > now,
    hide: (id: string) => save({ ...Object.fromEntries(Object.entries(map).filter(([, t]) => t > now)), [id]: now + SNOOZE_DAYS * 86400000 }),
    reset: () => save({}),
  };
}
export type Snooze = ReturnType<typeof useSnooze>;

/** 섹션 안의 자동 감지 신호 목록 */
export function SignalList({ items, snooze, locked, onAct, empty, max = 4 }: {
  items: Signal[]; snooze: Snooze; locked: (id: string) => boolean; onAct: (s: Signal) => void; empty: string; max?: number;
}) {
  const [more, setMore] = useState(false);
  const main = items.filter((s) => s.type !== 'data');
  const data = items.filter((s) => s.type === 'data');
  const shown = more ? main : main.slice(0, max);
  const anyLocked = main.some((s) => locked(s.id));
  return (
    <div>
      {!main.length ? <p className="px-5 py-5 text-sm text-slate-500">{empty}</p> : (
        <ul className="relative">
          {shown.map((s) => {
            const lk = locked(s.id);
            return (
              <li key={s.id} className={cx('px-5 py-3 border-t border-slate-100 first:border-t-0 flex gap-3', lk && 'blur-[3px] select-none pointer-events-none')} aria-hidden={lk}>
                <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', TYPE_META[s.type].dot)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                    <span className={cx('font-semibold rounded px-1.5 py-0.5', TYPE_META[s.type].cls)}>{TYPE_META[s.type].label}</span>
                    {s.severity === 3 && <span className="text-rose-600 font-semibold">지금 확인</span>}
                    <span className="ml-auto"><ProvChip kind="calc" label="자동 감지" sources={[s.rule]} note="AI를 쓰지 않는 규칙·모델 계산입니다. 위 규칙에 걸려서 표시됐습니다." /></span>
                  </div>
                  <div className="mt-1 text-[15px] font-semibold leading-snug">{s.title}</div>
                  {s.detail && <p className="mt-0.5 text-sm text-slate-600 leading-relaxed">{s.detail}</p>}
                  <div className="mt-1.5 flex items-center gap-3 text-xs">
                    {s.action && <button onClick={() => onAct(s)} className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1">{s.action.label}<ArrowRight size={12} /></button>}
                    <button onClick={() => snooze.hide(s.id)} className="text-slate-400 hover:text-slate-700 inline-flex items-center gap-1" title={`${SNOOZE_DAYS}일 동안 숨깁니다`}><Check size={12} />확인함</button>
                  </div>
                </div>
              </li>
            );
          })}
          {anyLocked && (
            <li className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-white/40 to-white flex items-end justify-center pb-3">
              <Link to="/settings?tab=billing" className="text-xs font-semibold text-violet-700 bg-white border border-violet-200 rounded-full px-3 py-1.5 inline-flex items-center gap-1"><Lock size={12} />Pro에서 모두 보기</Link>
            </li>
          )}
        </ul>
      )}
      {main.length > max && (
        <button onClick={() => setMore(!more)} className="w-full px-5 py-2.5 border-t border-slate-100 text-sm text-indigo-700 font-semibold text-left">{more ? '접기' : `${main.length - max}건 더 보기`}</button>
      )}
      {data.length > 0 && (
        <details className="border-t border-slate-100 px-5 py-2.5 text-xs text-slate-500 group">
          <summary className="cursor-pointer list-none inline-flex items-center gap-1"><ChevronRight size={12} className="group-open:rotate-90 transition-transform" />더 정확하게 보려면 {data.length}건</summary>
          <ul className="mt-2 space-y-1.5">
            {data.map((s) => <li key={s.id} className="flex gap-2"><span className="text-sky-500">•</span><span className="flex-1">{s.title}{s.action && <button onClick={() => onAct(s)} className="ml-2 text-indigo-700 font-semibold">{s.action.label} →</button>}</span></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

// =====================================================================
// 팀 성과 · 사람 시각 조각
// =====================================================================
export function GoalBars({ raw, max = 4, flush }: { raw: Raw; max?: number; flush?: boolean }) {
  const goals = [...(raw.goals ?? [])].sort((a, b) => (a.probability ?? 101) - (b.probability ?? 101)).slice(0, max);
  if (!goals.length) return null;
  return (
    <ul className={cx('space-y-2.5', !flush && 'px-5 py-3 border-b border-slate-100')}>
      {goals.map((g) => {
        const p = g.probability;
        const tone = p == null ? 'text-slate-500 bg-slate-100' : p < 35 ? 'text-rose-700 bg-rose-50' : p < 50 ? 'text-amber-800 bg-amber-50' : 'text-emerald-700 bg-emerald-50';
        return (
          <li key={g.goal_id}><Link to={`/goals?item=${g.goal_id}`} className="block group">
            <div className="flex items-center gap-2 text-sm">
              <span className="flex-1 min-w-0 truncate font-medium group-hover:text-indigo-700">{g.title}</span>
              {g.blocked > 0 && <span className="text-[11px] text-rose-600">막힘 {g.blocked}</span>}
              <span className={cx('text-[11px] font-semibold rounded px-1.5 py-0.5 num', tone)} title="달성 가능성">{p != null ? `${p}%` : '—'}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${Math.min(100, g.progress)}%` }} /></div>
            <div className="mt-0.5 text-[11px] text-slate-400 num">진척 {g.progress}% · 하위 {g.task_count}건</div>
          </Link></li>
        );
      })}
    </ul>
  );
}

export function MemberStrip({ raw, onMemo, flush }: { raw: Raw; onMemo: (who: string) => void; flush?: boolean }) {
  const members = useTeamMembersOnly();
  if (!members.length) return null;
  const latest = (uid: string) => {
    const cs = raw.checkins.filter((c) => c.user_id === uid && c.condition != null).sort((a, b) => b.week_start.localeCompare(a.week_start));
    return cs[0]?.condition ?? null;
  };
  const care = new Map((raw.care ?? []).map((c) => [c.user_id, c.signals]));
  const depth = new Map((raw.depth ?? []).map((d) => [d.user_id, d]));
  const FLAG: Record<string, string> = { condition_down: '컨디션 하락', blocked_repeat: '막힘 반복', no_one_on_one: '1:1 공백', checkin_missing: '체크인 없음' };
  return (
    <div className={cx('grid sm:grid-cols-2 gap-x-4 gap-y-0.5', !flush && 'px-5 py-3 border-b border-slate-100')}>
      {members.map((m) => {
        const c = latest(m.user_id);
        const flags = (care.get(m.user_id) ?? []).map((s) => FLAG[s.type]).filter(Boolean);
        const d = depth.get(m.user_id);
        if (d && !d.eligible) flags.push('평가 근거 부족');
        const dot = c == null ? 'bg-slate-300' : c <= 2 ? 'bg-rose-500' : c === 3 ? 'bg-amber-400' : 'bg-emerald-500';
        return (
          <button key={m.user_id} onClick={() => onMemo(m.user_id)} title="관찰 메모 남기기"
            className="flex items-center gap-2 py-1.5 text-left text-sm rounded-lg hover:bg-slate-50 -mx-1.5 px-1.5 min-w-0">
            <span className={cx('w-2 h-2 rounded-full shrink-0', dot)} />
            <span className="font-medium shrink-0">{m.profiles?.full_name}</span>
            <span className="text-[11px] text-slate-400 shrink-0 num">{c != null ? `컨디션 ${c}` : '—'}</span>
            <span className={cx('text-[11px] truncate', flags.length ? 'text-rose-600' : 'text-slate-400')}>{flags.length ? flags.join(' · ') : m.job_title}</span>
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================
// 조직·전사
// =====================================================================
export const ORG_KIND: Record<OrgNoteKind, { label: string; hint: string; cls: string; ph: string }> = {
  strategy: { label: '전략·방향 변경', hint: '전사 방침, 목표·예산 변경', cls: 'bg-indigo-50 text-indigo-700', ph: '예) 4분기 마케팅 비용 15% 절감, CAC 중심 평가' },
  exec: { label: '임원 관심사', hint: '임원이 자주 묻는 것, 분위기', cls: 'bg-violet-50 text-violet-700', ph: '예) 본부장이 제휴 채널 성과를 두 번 연속 물어봄' },
  request: { label: '상위 요청', hint: '보고·자료 요청과 기한', cls: 'bg-amber-50 text-amber-800', ph: '예) 4분기 실행계획 초안 제출' },
  peer: { label: '유관 부서', hint: '다른 팀 변화, 협업·의존', cls: 'bg-sky-50 text-sky-700', ph: '예) 영업팀 리드 공유 회의가 월 1회로 바뀜' },
  calendar: { label: '전사 일정', hint: '평가 시즌, 예산 편성, 조직 개편', cls: 'bg-slate-100 text-slate-700', ph: '예) 하반기 평가 시즌 시작' },
  other: { label: '기타', hint: '그 밖에 알아 둘 것', cls: 'bg-slate-100 text-slate-600', ph: '' },
};
export const IMPACT_LEVEL: Record<OrgImpact['level'], { label: string; cls: string }> = {
  high: { label: '영향 큼', cls: 'bg-rose-50 text-rose-700' }, medium: { label: '영향 있음', cls: 'bg-amber-50 text-amber-800' },
  low: { label: '영향 작음', cls: 'bg-slate-100 text-slate-600' }, none: { label: '영향 없음', cls: 'bg-slate-100 text-slate-500' },
};
const ACTION_KIND: Record<string, string> = { replan: '계획 조정', report: '보고', discuss: '논의', watch: '지켜보기' };

export function OrgNoteRow({ teamId, note, impact, execName }: { teamId: string; note: OrgNote; impact?: AiOutput<OrgImpact>; execName?: string }) {
  const { hasFeature } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const gen = useGenerate('ai-org-impact', [['org-notes'], ['home-insights']]);
  const upd = useMutation({
    mutationFn: (patch: Partial<OrgNote>) => q(supabase.from('org_notes').update(patch).eq('id', note.id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['org-notes'] }); qc.invalidateQueries({ queryKey: ['home-insights'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const del = useMutation({
    mutationFn: () => q(supabase.from('org_notes').delete().eq('id', note.id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['org-notes'] }); qc.invalidateQueries({ queryKey: ['home-insights'] }); },
  });
  const k = ORG_KIND[note.kind];
  const im = impact?.content;
  const dd = note.event_date ? dDay(note.event_date) : null;
  return (
    <li className="px-5 py-3 border-t border-slate-100 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
            <span className={cx('font-semibold rounded px-1.5 py-0.5', k.cls)}>{k.label}</span>
            {execName && <span className="font-semibold rounded px-1.5 py-0.5 bg-slate-900 text-white">{execName}</span>}
            {im && <span className={cx('font-semibold rounded px-1.5 py-0.5', IMPACT_LEVEL[im.level]?.cls)}>{IMPACT_LEVEL[im.level]?.label}</span>}
            {dd != null && <span className={cx('font-semibold', dd < 0 ? 'text-rose-600' : dd <= 7 ? 'text-amber-700' : 'text-slate-500')}>{dd < 0 ? `${-dd}일 지남` : dd === 0 ? '오늘' : `D-${dd}`}</span>}
            <span className="text-slate-400">{note.source ? `${note.source} · ` : ''}{fmtDate(note.created_at)}</span>
          </div>
          <button onClick={() => setOpen(!open)} className="mt-1 text-left font-semibold text-[15px] leading-snug hover:text-indigo-700 inline-flex items-start gap-1">
            {note.title}<ChevronDown size={14} className={cx('mt-1 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
          </button>
          {im ? <p className="mt-0.5 text-sm text-slate-700 leading-relaxed"><TaggedText text={im.summary} sources={impact!.sources} /></p>
            : note.kind !== 'calendar' && hasFeature('ai_core') && (
              <button onClick={() => gen.mutate({ team_id: teamId, note_id: note.id })} disabled={gen.isPending}
                className="mt-1 text-xs font-semibold text-violet-700 inline-flex items-center gap-1 hover:underline disabled:opacity-60">
                <Sparkles size={12} />{gen.isPending ? '우리 팀 목표와 맞춰 보는 중…' : '우리 팀 영향 보기'}</button>
            )}
        </div>
      </div>
      {open && (
        <div className="mt-2 ml-0 space-y-2.5 text-sm">
          {note.body && <p className="text-slate-600 whitespace-pre-wrap bg-slate-50 rounded-lg px-3 py-2 text-[13px]">{note.body}</p>}
          {im && (
            <ProvBlock rail className="rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2"><span className="text-xs font-semibold text-violet-800">우리 팀 영향</span>
                <ProvChip kind={kindFromStatus(impact!.status)} label="AI 분석" sources={impact!.sources} level={impact!.level} depth={impact!.depth} note="이 소식을 팀 목표·과제·최근 결정과 맞춰 본 결과입니다." /></div>
              {!!im.affected?.length && <ul className="space-y-1">{im.affected.map((a, i) => (
                <li key={i} className="text-[13px]"><Link to={`/goals?item=${a.item_id}`} className="font-semibold text-indigo-700 hover:underline">{a.title}</Link> — {a.how}</li>
              ))}</ul>}
              {!!im.actions?.length && <ul className="space-y-1">{im.actions.map((a, i) => (
                <li key={i} className="text-[13px] flex gap-2"><span className="text-[11px] font-semibold text-slate-500 w-14 shrink-0 mt-0.5">{ACTION_KIND[a.kind] ?? a.kind}</span><span>{a.label}</span></li>
              ))}</ul>}
              {im.report_line && <p className="text-[13px] border-t border-violet-100 pt-2"><span className="text-[11px] font-semibold text-slate-500 mr-2">보고 문장</span>{im.report_line}</p>}
            </ProvBlock>
          )}
          <div className="flex items-center gap-3 text-xs">
            {im && hasFeature('ai_core') && <button onClick={() => gen.mutate({ team_id: teamId, note_id: note.id })} disabled={gen.isPending} className="text-slate-500 hover:text-violet-700 inline-flex items-center gap-1"><RefreshCw size={11} />다시 분석</button>}
            {note.status === 'open'
              ? <button onClick={() => upd.mutate({ status: 'done' })} className="text-slate-500 hover:text-indigo-700 inline-flex items-center gap-1"><Check size={12} />처리함</button>
              : <button onClick={() => upd.mutate({ status: 'open' })} className="text-slate-500 hover:text-indigo-700">다시 열기</button>}
            <button onClick={() => { if (window.confirm('이 메모를 지울까요?')) del.mutate(); }} className="text-slate-400 hover:text-rose-600 ml-auto">지우기</button>
          </div>
        </div>
      )}
    </li>
  );
}

/** 조직·전사 요약 숫자 (홈 카드와 상세가 같이 씀) */
export function orgStats(data: { notes: OrgNote[]; impactOf: Map<string, AiOutput<OrgImpact>> } | undefined, perfRisks: Signal[]) {
  const notes = data?.notes ?? [];
  const open = notes.filter((n) => n.status === 'open');
  const feed = open.filter((n) => n.kind !== 'calendar');
  const upcoming = open.filter((n) => n.event_date && dDay(n.event_date) >= -3).sort((a, b) => a.event_date!.localeCompare(b.event_date!)).slice(0, 6);
  const analyzed = feed.filter((n) => data?.impactOf.has(n.id)).length;
  const reportLines = [...new Set(feed.map((n) => data?.impactOf.get(n.id)?.content.report_line).filter(Boolean) as string[])];
  const up = [...reportLines.map((t) => ({ t, src: '위에서 온 것에 대한 답' })), ...perfRisks.slice(0, 3).map((s) => ({ t: s.title, src: '팀 성과 리스크' }))].slice(0, 4);
  const high = feed.filter((n) => data?.impactOf.get(n.id)?.content.level === 'high');
  const status: Status = !notes.length ? 'unknown'
    : high.length || upcoming.some((n) => n.kind === 'request' && dDay(n.event_date!) <= 3) ? 'watch' : 'good';
  const nearest = upcoming.find((n) => dDay(n.event_date!) >= 0);
  return { notes, open, feed, upcoming, analyzed, up, high, status, nearest, doneN: notes.filter((n) => n.status === 'done').length };
}

export function OrgDetail({ teamId, data, loading, perfRisks, onAdd }: {
  teamId: string; data: { notes: OrgNote[]; impactOf: Map<string, AiOutput<OrgImpact>> } | undefined; loading: boolean; perfRisks: Signal[]; onAdd: () => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const st = orgStats(data, perfRisks);
  if (loading) return <Spinner />;
  if (!st.notes.length) return (
    <div className="px-5 py-6 text-sm text-slate-600">
      <p className="font-semibold text-slate-800">위에서 들은 것을 한 줄씩 남겨 두세요.</p>
      <p className="mt-1 leading-relaxed">전사 방침, 임원 회의에서 나온 말, 상위 요청과 기한, 유관 부서 변화, 평가 시즌 같은 전사 일정. 메신저에서 복사해 붙여 넣으면 됩니다.
        AI가 우리 팀 목표·과제와 맞춰 무엇이 영향을 받는지, 위에 무엇을 보고하면 되는지 정리합니다.</p>
      <Button size="sm" className="mt-3" onClick={onAdd}><Plus size={14} />첫 소식 남기기</Button>
    </div>
  );
  return (
    <div className="grid lg:grid-cols-5">
      <div className="lg:col-span-3 lg:border-r border-slate-100">
        <div className="px-5 pt-3 text-xs font-semibold text-slate-500">위에서 온 것</div>
        {st.feed.length ? <ul className="mt-1">{st.feed.map((n) => <OrgNoteRow key={n.id} teamId={teamId} note={n} impact={data?.impactOf.get(n.id)} />)}</ul>
          : <p className="px-5 py-4 text-sm text-slate-500">열린 소식이 없습니다.</p>}
        {st.doneN > 0 && (
          <div className="border-t border-slate-100">
            <button onClick={() => setShowDone(!showDone)} className="px-5 py-2.5 text-xs text-slate-500 hover:text-slate-800">{showDone ? '처리한 소식 접기' : `처리한 소식 ${st.doneN}건`}</button>
            {showDone && <ul>{st.notes.filter((n) => n.status === 'done').map((n) => <OrgNoteRow key={n.id} teamId={teamId} note={n} impact={data?.impactOf.get(n.id)} />)}</ul>}
          </div>
        )}
      </div>
      <div className="lg:col-span-2 border-t lg:border-t-0 border-slate-100">
        <div className="px-5 pt-3 text-xs font-semibold text-slate-500 flex items-center gap-1.5"><ArrowUpRight size={13} />위로 올릴 것</div>
        {st.up.length ? (
          <ul className="px-5 pt-2 pb-3 space-y-2">
            {st.up.map((x, i) => <li key={i} className="text-sm leading-snug"><span className="block text-[11px] text-slate-400">{x.src}</span>{x.t}</li>)}
          </ul>
        ) : <p className="px-5 py-3 text-sm text-slate-500">지금 위에 올릴 급한 것이 없습니다.</p>}
        <div className="px-5 pb-3"><Link to="/upward" className="text-xs font-semibold text-indigo-700 inline-flex items-center gap-1">임원 브리핑에서 챙기기 <ArrowRight size={12} /></Link></div>
        <div className="px-5 pt-3 border-t border-slate-100 text-xs font-semibold text-slate-500 flex items-center gap-1.5"><CalendarClock size={13} />다가오는 일정·기한</div>
        {st.upcoming.length ? (
          <ul className="px-5 pt-2 pb-4 space-y-1.5">
            {st.upcoming.map((n) => {
              const dd = dDay(n.event_date!);
              return (
                <li key={n.id} className="text-sm flex items-center gap-2">
                  <span className={cx('font-mono text-xs w-12 shrink-0 font-semibold', dd < 0 ? 'text-rose-600' : dd <= 7 ? 'text-amber-700' : 'text-slate-500')}>{dd < 0 ? `+${-dd}일` : dd === 0 ? '오늘' : `D-${dd}`}</span>
                  <span className="flex-1 min-w-0 truncate">{n.title}</span>
                  <span className={cx('text-[10px] rounded px-1.5 py-0.5 shrink-0', ORG_KIND[n.kind].cls)}>{ORG_KIND[n.kind].label}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-5 py-3 pb-4 text-sm text-slate-500">등록된 일정이 없습니다.</p>}
      </div>
    </div>
  );
}

export function OrgNoteModal({ teamId, open, onClose, execId: presetExec }: { teamId: string; open: boolean; onClose: () => void; execId?: string | null }) {
  const { uid, hasFeature } = useTeam();
  const ex = useExecutives(teamId);
  const [execId, setExecId] = useState<string>(presetExec ?? '');
  useEffect(() => { if (open) setExecId(presetExec ?? ''); }, [open, presetExec]);
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<OrgNoteKind>('strategy');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState('');
  const [analyze, setAnalyze] = useState(true);
  const ai = hasFeature('ai_core');
  const dated = kind === 'calendar' || kind === 'request';
  const reset = () => { setTitle(''); setBody(''); setSource(''); setDate(''); };
  const save = useMutation({
    mutationFn: async () => {
      const row = await q<OrgNote>(supabase.from('org_notes').insert({ team_id: teamId, author_id: uid, kind, title: title.trim(), body, source, event_date: date || null, ...(execId ? { exec_id: execId } : {}) }).select('*').single());
      if (ai && analyze && kind !== 'calendar') {
        try { await invoke('ai-org-impact', { team_id: teamId, note_id: row.id }); return 'analyzed'; } catch (e) { return `saved:${errorText(e)}`; }
      }
      return 'saved';
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['org-notes'] }); qc.invalidateQueries({ queryKey: ['home-insights'] }); qc.invalidateQueries({ queryKey: ['credits'] });
      toast(r === 'analyzed' ? '저장하고 우리 팀 영향을 정리했습니다' : r.startsWith('saved:') ? `저장했습니다. 영향 분석은 실패: ${r.slice(6)}` : '저장했습니다');
      reset(); onClose();
    },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Building2 size={16} className="text-indigo-600" />위에서 온 것 남기기</span>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">코멘트·자료·요청·방침을 그대로 붙여 넣어도 됩니다. 팀장만 봅니다.</p>
        {!!ex.list.length && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs"><span className="text-slate-500 mr-1">누구에게서</span>
            {[{ id: '', name: '선택 안 함' }, ...ex.list].map((e) => (
              <button key={e.id} type="button" onClick={() => setExecId(e.id)} className={cx('rounded-full px-2.5 py-1 ring-1', execId === e.id ? 'bg-slate-900 text-white ring-slate-900' : 'ring-slate-200 text-slate-600 hover:ring-slate-400')}>{e.name}</button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {(Object.keys(ORG_KIND) as OrgNoteKind[]).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={cx('border rounded-lg px-2.5 py-2 text-left', kind === k ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300')}>
              <span className={cx('block text-sm font-semibold', kind === k && 'text-indigo-700')}>{ORG_KIND[k].label}</span>
              <span className="block text-[11px] text-slate-500 leading-snug">{ORG_KIND[k].hint}</span>
            </button>
          ))}
        </div>
        <input aria-label="제목" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={ORG_KIND[kind].ph || '한 줄 요약'} />
        <textarea aria-label="내용" rows={4} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="자세한 내용 (붙여 넣기, 선택)" />
        <div className="grid grid-cols-2 gap-2">
          <input aria-label="출처" className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} placeholder="어디서 (예: 본부장 주간회의)" />
          <label className="text-xs text-slate-500 flex items-center gap-2">{dated ? (kind === 'request' ? '기한' : '날짜') : '날짜 (선택)'}
            <input type="date" aria-label="날짜" className={cx(inputCls, 'flex-1')} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        </div>
        {kind !== 'calendar' && (
          <label className={cx('flex items-start gap-2 text-sm', !ai && 'opacity-50')}>
            <input type="checkbox" className="mt-1 accent-indigo-600" checked={ai && analyze} disabled={!ai} onChange={(e) => setAnalyze(e.target.checked)} />
            <span>저장하고 우리 팀 영향 보기<span className="block text-xs text-slate-500">AI가 목표·과제·최근 결정과 맞춰 봅니다. 구독에 포함, 크레딧 없음.{!ai && ' (Pro에서)'}</span></span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>취소</Button>
          <Button disabled={!title.trim()} loading={save.isPending} onClick={() => save.mutate()}>{save.isPending && analyze && ai && kind !== 'calendar' ? '영향 보는 중…' : '저장'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// =====================================================================
// 하단 · 시작 가이드 · 관찰 메모
// =====================================================================
const MINUTES: Record<string, number> = { briefing: 20, one_on_one_prep: 15, review: 20, weekly_report: 40, evaluation_draft: 60, forecast_note: 10, strategy_check: 30, scenario_note: 20, insight_daily: 10, insight_weekly: 25, insight_monthly: 45, plan_draft: 40, plan_edit: 5, self_check: 0, org_impact: 15, people_actions: 30, advisor_weekly: 60 };
export function AiStrip({ teamId }: { teamId: string }) {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const saved = useQuery({
    queryKey: ['saved-time', teamId, monthStart],
    queryFn: async () => {
      const kinds = await q<{ kind: string }[]>(supabase.from('ai_outputs').select('kind').eq('team_id', teamId).neq('status', 'withheld').gte('created_at', monthStart));
      return { n: kinds.length, minutes: kinds.reduce((a, k) => a + (MINUTES[k.kind] ?? 10), 0) };
    },
  });
  const lv = useQuery({ queryKey: ['insight', teamId], queryFn: () => q<InsightLevel>(supabase.rpc('team_insight_level', { p_team: teamId })) });
  const d = lv.data;
  const next = d ? d.levels[d.level] : undefined;
  const hours = saved.data ? Math.round((saved.data.minutes / 60) * 10) / 10 : 0;
  return (
    <div className="mt-8 grid sm:grid-cols-2 gap-3 text-sm">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3">
        <Sparkles size={16} className="text-violet-600 shrink-0" />
        <span className="flex-1">이번 달 AI가 먼저 해 둔 일 <b className="num">{saved.data?.n ?? 0}</b>건 · 아낀 시간 약 <b className="num">{hours}</b>시간</span>
        <ProvChip kind="calc" label="추정" sources={['브리핑 20분 · 1:1 준비 15분 · 1차 검토 20분', '주간보고 40분 · 평가 초안 60분 · 영향 분석 15분']} note="AI 초안 1건마다 팀장이 직접 했을 때 걸렸을 시간을 더한 추정치입니다." />
      </div>
      <Link to="/insight" className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3 hover:border-violet-300">
        <Layers size={16} className="text-violet-600 shrink-0" />
        <span className="flex-1 min-w-0">AI가 볼 수 있는 깊이 {d && <b className="font-mono text-violet-700">L{d.level} {d.levels[d.level - 1].name}</b>}
          {next && <span className="block text-xs text-slate-500">다음 L{next.level} {next.name}까지 {d?.next_progress ?? 0}%</span>}</span>
        <ChevronRight size={14} className="text-slate-300" />
      </Link>
    </div>
  );
}

const QS_KEY = 'ateam.quickstart.hidden';
export function QuickStart({ teamId }: { teamId: string }) {
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
      const [kh, rep, org, it] = await Promise.all([count('knowhow_cards'), count('ai_outputs', (x) => x.eq('kind', 'weekly_report')), count('org_notes'), count('work_items')]);
      return { kh, rep, org, it };
    },
  });
  if (hidden || !st.data) return null;
  const steps = [
    { done: st.data.it > 0, title: '목표 세우기', desc: '계획서를 넣으면 AI가 목표·과제 초안을 만듭니다', to: '/goals' },
    { done: members.some((m) => m.role === 'member'), title: '팀원 초대', desc: '링크 하나로 초대, 팀원은 무료', to: '/settings?tab=members' },
    { done: st.data.org > 0, title: '위에서 온 것 남기기', desc: '전사 방침·임원 관심사를 넣으면 팀 목표와 맞춰 봅니다', to: '/upward' },
    { done: st.data.kh > 0, title: '내 노하우 넣기', desc: '원칙·자료를 넣으면 AI가 팀장님 기준으로 일합니다', to: '/knowhow' },
  ];
  const doneN = steps.filter((x) => x.done).length;
  if (doneN === steps.length) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(QS_KEY, '1'); } catch { /* 저장 불가 */ } };
  return (
    <div className="mt-5 rounded-2xl bg-indigo-50/70 border border-indigo-100 p-4">
      <div className="flex items-center gap-3">
        <Sparkles size={16} className="text-indigo-600 shrink-0" />
        <div className="font-semibold text-sm">ATEAM 시작하기</div>
        <div className="flex-1 h-1.5 rounded-full bg-indigo-100 max-w-40"><div className="h-1.5 rounded-full bg-indigo-600" style={{ width: `${(doneN / steps.length) * 100}%` }} /></div>
        <span className="font-mono text-xs text-indigo-700">{doneN}/{steps.length}</span>
        <button aria-label="시작 가이드 숨기기" className="ml-auto text-slate-400 hover:text-slate-600" onClick={hide}><X size={16} /></button>
      </div>
      <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {steps.map((x, i) => (
          <Link key={x.title} to={x.to.startsWith('#') ? '#' : x.to}
            onClick={(e) => { if (x.to.startsWith('#')) { e.preventDefault(); document.getElementById(x.to.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }}
            className={cx('rounded-xl px-3 py-2.5 text-sm flex items-start gap-2.5', x.done ? 'text-slate-400' : 'bg-white border border-indigo-100 hover:border-indigo-300')}>
            {x.done ? <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 shrink-0" />
              : <span className="w-4 h-4 mt-0.5 rounded-full border-2 border-indigo-300 text-[9px] font-bold flex items-center justify-center text-indigo-600 shrink-0">{i + 1}</span>}
            <span className="min-w-0">
              <span className={cx('font-semibold block', x.done && 'line-through')}>{x.title}</span>
              {!x.done && <span className="text-xs text-slate-500 block mt-0.5">{x.desc}</span>}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function MemoModal({ teamId, open, preset, onClose, onSaved, initialBody }: { teamId: string; open: boolean; preset: string | null; onClose: () => void; onSaved?: () => void; initialBody?: string }) {
  const { uid } = useTeam();
  const members = useTeamMembersOnly();
  const toast = useToast();
  const qc = useQueryClient();
  const [who, setWho] = useState<string | null>(null);
  const [kind, setKind] = useState<'praise' | 'concern' | 'note'>('praise');
  const [body, setBody] = useState(initialBody ?? '');
  // 내 메모에서 '관찰 메모로 옮기기'로 열면 그 글을 미리 채운다
  useEffect(() => { if (open && initialBody) { setBody(initialBody); setKind('note'); } }, [open, initialBody]);
  const sel = who ?? preset ?? members[0]?.user_id;
  const close = () => { setWho(null); onClose(); };
  const save = useMutation({
    mutationFn: () => q(supabase.from('observations').insert({ team_id: teamId, author_id: uid, subject_id: sel, kind, body })),
    onSuccess: () => { setBody(''); toast('관찰 메모를 저장했습니다. 평가 근거로 쌓입니다.'); qc.invalidateQueries({ queryKey: ['insight'] }); qc.invalidateQueries({ queryKey: ['home-insights'] }); onSaved?.(); close(); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Modal open={open} onClose={close} title={<span className="inline-flex items-center gap-2"><StickyNote size={16} className="text-indigo-600" />관찰 메모</span>}>
      {members.length === 0 ? <p className="text-sm text-slate-500">팀원을 초대하면 쓸 수 있습니다. <Link to="/settings?tab=members" className="text-indigo-600 font-semibold">초대하기</Link></p> : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">10초면 됩니다. 평가 시즌에 근거로 쓰입니다.</p>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {members.map((m) => (
              <button key={m.user_id} onClick={() => setWho(m.user_id)}
                className={cx('border rounded-full px-3 py-1', sel === m.user_id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                {m.profiles?.full_name}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-sm">
            {([['praise', '잘한 점', ThumbsUp], ['concern', '우려', AlertTriangle], ['note', '관찰', EyeOff]] as const).map(([k, l, I]) => (
              <button key={k} onClick={() => setKind(k)}
                className={cx('border rounded-lg py-2 inline-flex items-center justify-center gap-1.5', kind === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                <I size={13} />{l}
              </button>
            ))}
          </div>
          <textarea aria-label="메모" rows={4} value={body} onChange={(e) => setBody(e.target.value)} className={inputCls}
            placeholder="예) 임원 보고에서 프로모션 전략 질문에 근거를 들어 침착하게 답변함" />
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 inline-flex items-center gap-1"><Lock size={11} />팀장만 볼 수 있음</span>
            <Button disabled={!body.trim()} loading={save.isPending} onClick={() => save.mutate()}>저장</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

