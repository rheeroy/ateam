// 업무플랫폼 — 팀원이 올린 결과물을 목표(없으면 루틴)와 연결해 보고, AI 1차 검토를 미리 보며 피드백
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Briefcase, Check, ChevronDown, ChevronRight, RefreshCw, Sparkles, Users, FileText, Hash, Image as ImageIcon, LayoutList, Link2, MessageSquareText, Repeat, Target, Layers } from 'lucide-react';
import { useTeam } from '../state/session';
import { useLatestAi, useTeamMembersOnly } from '../lib/hooks';
import { invoke } from '../lib/supabase';
import { buildTree, useItems, type Node } from '../lib/items';
import { KIND_TAG, REQ_TAG, chainOf, isOpenSub, latestAt, useCloseSubmission, useSubmissionsAi, type QualityKey, type SubRow } from '../lib/work';
import { cx, daysAgo, fmtDate, relDay } from '../lib/format';
import { Avatar, Card, Empty, Pill, Spinner } from '../components/ui';
import { AiBand, AiChip } from '../components/AiBar';
import { PlanBar } from '../components/goals/PlanBar';
import { STATUS } from './MySubmissions';

type F = 'in_review' | 'needs_work' | 'approved' | 'shared' | 'all';
type V = 'people' | 'list' | 'goal';
const KIND_ICON = { link: Link2, image: ImageIcon, number: Hash, note: MessageSquareText, document: FileText } as const;

export default function Reviews() {
  const { team } = useTeam();
  const [params, setParams] = useSearchParams();
  const f = (params.get('f') as F) ?? 'in_review';
  const view = (params.get('view') as V) ?? 'people';
  const set = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const list = useSubmissionsAi(team.id);
  const items = useItems(team.id);
  const { byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  const all = list.data ?? [];
  const rows = all.filter((s) => f === 'all' || s.status === f);
  const count = (k: F) => all.filter((s) => k === 'all' || s.status === k).length;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-sm"><Briefcase size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">업무플랫폼</h1>
            <p className="text-sm text-slate-500">팀원이 올린 문서·링크·캡처·숫자를 목표와 이어서 보고, AI가 먼저 본 검토로 빠르게 피드백합니다</p>
          </div>
        </div>
      </div>

      <AiDigest rows={all} loading={list.isLoading} />

      <div className="flex items-center gap-2 flex-wrap">
        {view !== 'people' ? <div className="flex gap-1.5 overflow-x-auto">
          {([['in_review', '리뷰 대기'], ['needs_work', '보완 요청'], ['approved', '승인'], ['shared', '공유'], ['all', '전체']] as [F, string][]).map(([id, label]) => (
            <button key={id} onClick={() => set('f', id === 'in_review' ? null : id)}
              className={cx('text-xs rounded-full px-3 py-1.5 border whitespace-nowrap', f === id ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'border-slate-200 text-slate-600 bg-white hover:border-slate-300')}>
              {label} <span className="num">{count(id)}</span></button>
          ))}
        </div> : <div className="flex items-center gap-2 min-w-0"><Users size={15} className="text-sky-600 shrink-0" /><span className="font-semibold whitespace-nowrap">팀원별 업무스페이스</span><span className="text-xs text-slate-400 truncate">팀원별로 올라온 업무 — 최신이 위. 상세에서 '완료'하면 카드에서 빠지고 개인 업무 스페이스에는 남습니다</span></div>}
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {([['people', '사람별', Users], ['list', '전체 목록', LayoutList], ['goal', '목표별', Layers]] as const).map(([id, label, I]) => (
            <button key={id} onClick={() => set('view', id === 'people' ? null : id)} className={cx('text-xs px-2.5 py-1.5 rounded-md inline-flex items-center gap-1', view === id ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}><I size={13} />{label}</button>
          ))}
        </div>
      </div>

      {view === 'people' ? <PeopleBoxes rows={all} loading={list.isLoading} byId={byId} /> : list.isLoading ? <Card><Spinner /></Card> : !rows.length ? (
        <Card><Empty icon={<FileText size={18} />} title="아직 없습니다">팀원이 '업무플랫폼'에 올린 결과물·링크·캡처가 여기에 모입니다. 올리면 AI가 먼저 검토합니다.</Empty></Card>
      ) : view === 'list' ? (
        <Card className="overflow-hidden"><ListHead />{rows.map((s, i) => <Row key={s.id} s={s} byId={byId} no={i + 1} />)}</Card>
      ) : <ByGoal rows={rows} byId={byId} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// 사람별 박스 — 2단 카드, 누르면 그 사람의 업무 스페이스
// ---------------------------------------------------------------------
function PeopleBoxes({ rows, loading }: { rows: SubRow[]; loading: boolean; byId: Map<string, Node> }) {
  const members = useTeamMembersOnly();
  const openOf = (u: string) => rows.filter((s) => s.author_id === u && isOpenSub(s)).sort((a, b) => latestAt(b).localeCompare(latestAt(a)));
  const lastAt = (u: string) => openOf(u)[0] ? latestAt(openOf(u)[0]) : '';
  const sorted = [...members].sort((a, b) => lastAt(b.user_id).localeCompare(lastAt(a.user_id)));
  if (loading) return <Card><Spinner /></Card>;
  if (!members.length) return <Card><Empty title="팀원이 없습니다">팀원을 초대하면 사람별 업무 스페이스가 생깁니다.</Empty></Card>;
  return (
    <div className="grid md:grid-cols-2 gap-4 items-start">
      {sorted.map((mb) => {
        const list = openOf(mb.user_id);
        const name = mb.profiles?.full_name ?? '팀원';
        return (
          <section key={mb.user_id} className="rounded-2xl bg-white ring-1 ring-slate-900/[0.07] shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
            <Link to={`/work/u/${mb.user_id}`} className="px-5 py-3.5 flex items-center gap-3 border-b border-indigo-100/70 group bg-gradient-to-r from-indigo-50/80 via-sky-50/50 to-white hover:from-indigo-100/70">
              <Avatar name={name} size={9} />
              <span className="min-w-0"><span className="block font-semibold truncate group-hover:text-indigo-700">{name}</span><span className="block text-xs text-slate-500 truncate">{mb.job_title || '직무 미입력'}</span></span>
              <span className={cx('ml-auto text-[11px] font-semibold rounded-full px-2 py-0.5', list.length ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400')}>열린 업무 {list.length}</span>
              <ChevronRight size={15} className="text-slate-300 group-hover:text-indigo-500" />
            </Link>
            {!list.length ? <p className="px-5 py-5 text-sm text-slate-400">처리할 업무가 없습니다.</p> : (
              <ul className="divide-y divide-slate-100">
                {list.map((s, i) => {
                  const rq = REQ_TAG[s.request_type] ?? REQ_TAG.approval;
                  return (
                    <li key={s.id} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50/70">
                      <span className="shrink-0 w-6 h-6 rounded-md bg-slate-100 text-slate-500 text-[11px] font-bold num flex items-center justify-center">{i + 1}</span>
                      <Link to={`/work/${s.id}`} className="min-w-0 flex-1 flex items-center gap-2">
                        <span className={cx('shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5', rq.cls)}>{rq.label}</span>
                        <span className="shrink-0 text-[10px] rounded px-1.5 py-0.5 ring-1 ring-slate-200 text-slate-500">{KIND_TAG[s.kind] ?? '문서'}</span>
                        {s.status === 'needs_work' && <span className="shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-amber-50 text-amber-800">보완 중</span>}
                        <span className="truncate text-sm">{s.title}</span>
                        {s.latest && s.latest.version > 1 && <span className="shrink-0 font-mono text-[10px] text-indigo-600">v{s.latest.version}</span>}
                      </Link>
                      <span className="shrink-0 text-[11px] text-slate-400 num w-12 text-right">{relDay(latestAt(s))}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// Core Insight — AI가 리뷰 대기 결과물을 먼저 읽고 '누구의 무엇이 어때 보이는지' 한 줄씩 (ai-work-brief)
//   새 결과물·새 검토가 생기면 자동으로 다시 읽는다. AI 결과가 없으면 1차 검토 점수로 같은 톤의 문장을 만든다 (AI 표시 없음)
// ---------------------------------------------------------------------
type Tone = 'risk' | 'watch' | 'good' | 'info';
interface BriefItem { submission_id: string; tone: Tone; text: string; why?: string }
interface BriefOut { headline?: string; items: BriefItem[] }
const TONE_DOT: Record<Tone, string> = { risk: 'bg-rose-500', watch: 'bg-amber-400', good: 'bg-emerald-500', info: 'bg-slate-400' };
const ORDER: Record<Tone, number> = { risk: 0, watch: 1, info: 2, good: 3 };
const stripTag = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
/** 제목 뒤 조사 — 받침 있으면 '은/이', 없으면 '는/가' */
function josa(word: string, withB: string, without: string) {
  const c = word.trim().charCodeAt(word.trim().length - 1);
  if (c < 0xac00 || c > 0xd7a3) return withB;
  return (c - 0xac00) % 28 ? withB : without;
}
function ruleLines(waiting: SubRow[], nameOf: (id: string) => string): BriefItem[] {
  const out: BriefItem[] = [];
  for (const s of waiting) {
    const q = s.review?.quality ?? {};
    const sc = (k: QualityKey) => q[k]?.score ?? (k === 'depth' ? s.review?.depth_score ?? null : null);
    const who = `${nameOf(s.author_id)} 님이 올린 '${s.title}'${josa(s.title, '은', '는')}`;
    const waited = daysAgo(s.latest?.created_at ?? s.created_at);
    const d = sc('depth'), c = sc('completeness'), l = sc('logic'), cl = sc('clarity'), o = sc('originality');
    const note = (k: QualityKey) => q[k]?.note ?? s.review?.gaps?.[0]?.text;
    if (d != null && d <= 2) out.push({ submission_id: s.id, tone: 'risk', text: `${who} 고민의 깊이가 낮아 보입니다`, why: note('depth') });
    else if (c != null && c <= 2) out.push({ submission_id: s.id, tone: 'risk', text: `${who} 완결성이 낮아 보입니다`, why: note('completeness') });
    else if (l != null && l <= 2) out.push({ submission_id: s.id, tone: 'watch', text: `${who} 논리가 비어 보입니다`, why: note('logic') });
    else if (cl != null && cl <= 2) out.push({ submission_id: s.id, tone: 'watch', text: `${who} 전달이 어려워 보입니다`, why: note('clarity') });
    else if (waited >= 3) out.push({ submission_id: s.id, tone: 'watch', text: `${nameOf(s.author_id)} 님의 '${s.title}'${josa(s.title, '이', '가')} ${waited}일째 기다리고 있습니다` });
    else if (o != null && o >= 3.5) out.push({ submission_id: s.id, tone: 'good', text: `${who} 새로운 관점이 돋보입니다`, why: q.originality?.note });
    else if (d != null && d >= 3.5) out.push({ submission_id: s.id, tone: 'good', text: `${who} 바로 인정해도 좋아 보입니다`, why: s.review?.summary });
  }
  return out.sort((a, b) => ORDER[a.tone] - ORDER[b.tone]).slice(0, 6);
}

function AiDigest({ rows, loading }: { rows: SubRow[]; loading: boolean }) {
  const { team, nameOf } = useTeam();
  const qc = useQueryClient();
  const brief = useLatestAi<BriefOut>(team.id, 'work_brief');
  const waiting = rows.filter((s) => s.status === 'in_review');
  const reviewed = waiting.filter((s) => s.review);
  const changedAt = waiting.reduce((m, s) => [s.latest?.created_at, s.reviewedAt, s.updated_at].reduce<string>((a, b) => (b && b > a ? b : a), m), '');
  const fresh = !!brief.data && brief.data.created_at > changedAt;
  const gen = useMutation({
    mutationFn: (force: boolean) => invoke('ai-work-brief', { team_id: team.id, force }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['ai', team.id, 'work_brief'] }),
  });
  const tried = useRef(false);
  useEffect(() => {
    if (loading || brief.isLoading || tried.current || !waiting.length || fresh) return;
    tried.current = true; gen.mutate(false);
  }, [loading, brief.isLoading, waiting.length, fresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = new Set(waiting.map((s) => s.id));
  const ai = fresh ? (brief.data!.content.items ?? []).filter((x) => ids.has(x.submission_id)) : [];
  const items = ai.length ? ai : ruleLines(waiting, nameOf);
  const headline = ai.length && brief.data?.content.headline ? stripTag(brief.data.content.headline)
    : reviewed.length ? `AI가 ${reviewed.length}건을 먼저 읽었습니다. 아래 순서로 보면 빠릅니다.` : 'AI 검토가 아직 없는 결과물입니다. 열면 1차 검토를 만들 수 있습니다.';
  return (
    <AiBand title="업무플랫폼 · AI 미리 검토" cadence="live" right={
      <span className="inline-flex items-center gap-2 text-[11px] text-slate-500">리뷰 대기 {waiting.length}건 · AI 검토 {reviewed.length}건
        {!!waiting.length && <button onClick={() => gen.mutate(true)} disabled={gen.isPending} className="inline-flex items-center gap-1 rounded-md bg-white ring-1 ring-slate-200 px-2 py-0.5 font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50"><RefreshCw size={11} className={gen.isPending ? 'animate-spin' : ''} />다시 읽기</button>}
      </span>}>
      {loading ? <p className="text-sm text-slate-500">불러오는 중…</p> : !waiting.length ? (
        <p className="text-sm text-slate-600">리뷰를 기다리는 결과물이 없습니다. 팀원이 올리면 AI가 먼저 읽고 완성도·고민의 깊이·논리성·창의성·전달력을 짚어 둡니다.</p>
      ) : (
        <>
          <p className="text-[15px] font-semibold leading-snug">{headline}{gen.isPending && <span className="ml-2 text-xs font-normal text-slate-400">AI가 다시 읽는 중…</span>}</p>
          {!!items.length && (
            <ul className="mt-3 rounded-xl bg-white ring-1 ring-slate-200 divide-y divide-slate-100">
              {items.map((x, i) => (
                <li key={x.submission_id + i}>
                  <Link to={`/work/${x.submission_id}`} className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-violet-50/50">
                    <span className={cx('mt-[7px] w-2 h-2 rounded-full shrink-0', TONE_DOT[x.tone] ?? TONE_DOT.info)} />
                    <span className="min-w-0 flex-1">
                      <span className="text-sm text-slate-800">{stripTag(x.text)}</span>
                      {x.why && <span className="block text-xs text-slate-500 mt-0.5">{stripTag(x.why)}</span>}
                    </span>
                    <ChevronRight size={14} className="mt-1 text-slate-300 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {ai.length ? <p className="mt-1.5 text-[10px] text-slate-400 inline-flex items-center gap-1"><AiChip label="AI" />결과물마다의 1차 검토(완성도·고민의 깊이·논리성·창의성·전달력)를 모아 읽은 판단입니다</p> : null}
        </>
      )}
    </AiBand>
  );
}

// ---------------------------------------------------------------------
// 한 줄 — 연결된 목표, AI 미리보기
// ---------------------------------------------------------------------
function Chain({ s, byId }: { s: SubRow; byId: Map<string, Node> }) {
  const c = chainOf(s.item_id, byId);
  if (c.kind === 'none') return <span className="text-[11px] text-slate-400 rounded-full border border-dashed border-slate-300 px-2 py-0.5">목표 미연결</span>;
  const last = c.path[c.path.length - 1];
  const mid = c.path.length > 2 ? ' › … › ' : c.path.length === 2 ? ' › ' : '';
  return (
    <span className={cx('text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 max-w-full min-w-0', c.kind === 'routine' ? 'bg-slate-100 text-slate-600' : 'bg-indigo-50 text-indigo-700')}>
      {c.kind === 'routine' ? <Repeat size={11} className="shrink-0" /> : <Target size={11} className="shrink-0" />}
      <span className="truncate">{c.kind === 'routine' ? `루틴 · ${last.title}` : `${c.root!.title}${c.path.length > 1 ? `${mid}${last.title}` : ''}`}</span>
    </span>
  );
}

const GRID = 'md:grid md:grid-cols-[44px_minmax(0,2.6fr)_84px_minmax(0,1.8fr)_78px_150px_76px] md:items-center';
export function ListHead() {
  return (
    <div className={cx('hidden px-4 py-2 bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500', GRID)}>
      <span className="text-center">No.</span><span>결과물</span><span>작성자</span><span>연결 목표</span><span>대기</span><span>AI 1차 검토</span><span className="text-right pr-1">상태</span>
    </div>
  );
}

export function Row({ s, byId, no, closable }: { s: SubRow; byId: Map<string, Node>; no: number; closable?: boolean }) {
  const { nameOf, team, uid } = useTeam();
  const close = useCloseSubmission(team.id);
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[s.kind] ?? FileText;
  const r = s.review;
  const crit = r?.criteria_check ?? [];
  const pending = s.status === 'in_review' || s.status === 'needs_work';
  const wait = daysAgo(s.latest?.created_at ?? s.created_at);
  return (
    <div className={cx('border-t border-slate-200 first:border-t-0', open && 'bg-violet-50/30')}>
      <div className={cx('px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 hover:bg-slate-50/80', GRID)}>
        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 font-bold num text-sm flex items-center justify-center md:mx-auto">{String(no).padStart(2, '0')}</span>
        <Link to={`/work/${s.id}`} className="min-w-0 flex-1 md:flex-none flex items-center gap-2 group">
          <span className={cx('shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5', (REQ_TAG[s.request_type] ?? REQ_TAG.approval).cls)}>{(REQ_TAG[s.request_type] ?? REQ_TAG.approval).label}</span>
          <Icon size={15} className="text-slate-400 shrink-0" />
          <span className="font-semibold truncate group-hover:text-indigo-700">{s.title}</span>
          {s.latest && <span className="font-mono text-[11px] text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 shrink-0">v{s.latest.version}</span>}
          {s.request_type === 'feedback' && s.status === 'in_review' && <span className="text-[10px] text-sky-700 bg-sky-50 rounded px-1 shrink-0">피드백 요청</span>}
        </Link>
        <span className="text-sm text-slate-600 truncate">{nameOf(s.author_id)}</span>
        <span className="min-w-0"><Chain s={s} byId={byId} /></span>
        <span className={cx('text-xs num', s.status === 'in_review' && wait >= 3 ? 'text-amber-700 font-semibold' : 'text-slate-400')}>
          {s.status === 'in_review' ? (wait === 0 ? '오늘' : `${wait}일째`) : fmtDate(s.latest?.created_at ?? s.created_at)}</span>
        <span>
          {r ? (
            <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className={cx('w-full text-left rounded-lg px-2 py-1 ring-1 transition-colors', open ? 'bg-violet-600 ring-violet-600 text-white' : 'bg-white ring-violet-200 hover:bg-violet-50')}>
              <span className="flex items-center gap-1 text-[11px] font-semibold"><Sparkles size={11} />AI {r.depth_score}/4
                {!!crit.length && <span className={cx('font-normal', open ? 'text-violet-100' : 'text-slate-500')}>· 기준 {crit.filter((c) => c.met).length}/{crit.length}</span>}
                <ChevronDown size={12} className={cx('ml-auto transition-transform', open && 'rotate-180')} /></span>
              <span className={cx('mt-0.5 block h-1 rounded-full', open ? 'bg-white/30' : 'bg-violet-100')}><span className={cx('block h-1 rounded-full', open ? 'bg-white' : 'bg-violet-600')} style={{ width: `${(r.depth_score / 4) * 100}%` }} /></span>
            </button>
          ) : <span className="text-[11px] text-slate-400">{pending ? 'AI 검토 전' : '—'}</span>}
        </span>
        <span className="md:text-right flex md:flex-col md:items-end gap-1">
          {s.closed_at ? <span className="text-[10px] font-semibold rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">완료함</span> : <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill>}
          {closable && (s.closed_at
            ? <button onClick={() => close.mutate({ id: s.id, close: false, uid })} className="text-[10px] text-slate-400 hover:text-slate-700">다시 열기</button>
            : s.status !== 'approved' && <button onClick={() => close.mutate({ id: s.id, close: true, uid })} className="text-[10px] font-semibold rounded-md ring-1 ring-slate-200 px-1.5 py-0.5 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-200 inline-flex items-center gap-0.5"><Check size={10} />완료 처리</button>)}
        </span>
      </div>
      {r && open && (
        <div className="px-4 pb-4 md:pl-[60px]">
          <div className="rounded-xl bg-white ring-1 ring-violet-200 p-3.5 shadow-sm">
            <p className="text-sm text-slate-800"><AiChip label="AI 미리보기" tone="solid" className="mr-1.5" />{r.summary}</p>
            {r.change_from_previous && <p className="mt-1 text-xs text-slate-500">지난 버전 대비: {r.change_from_previous}</p>}
            <div className="mt-2.5 grid sm:grid-cols-3 gap-2 text-xs">
              <Peek label="강점" tone="emerald" list={(r.strengths ?? []).map((x) => `${x.section ? `${x.section} · ` : ''}${x.text}`)} />
              <Peek label="보완" tone="amber" list={(r.gaps ?? []).map((x) => `${x.section ? `${x.section} · ` : ''}${x.text}`)} />
              <Peek label="물어볼 질문" tone="violet" list={r.questions ?? []} />
            </div>
            {!!crit.length && (
              <div className="mt-2 flex flex-wrap gap-1.5">{crit.map((c, i) => <span key={i} title={c.note} className={cx('text-[11px] rounded-full px-2 py-0.5', c.met ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>{c.met ? '✓' : '✗'} {c.criterion}</span>)}</div>
            )}
            <Link to={`/work/${s.id}`} className="mt-2.5 inline-flex items-center gap-0.5 text-xs font-semibold text-indigo-700">열어서 피드백하기<ChevronRight size={13} /></Link>
          </div>
        </div>
      )}
    </div>
  );
}
function Peek({ label, list, tone }: { label: string; list: string[]; tone: 'emerald' | 'amber' | 'violet' }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2.5 py-2">
      <div className={cx('text-[10px] font-bold', tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-violet-700')}>{label} {list.length}</div>
      {list.length ? <ul className="mt-1 space-y-1">{list.slice(0, 3).map((t, i) => <li key={i} className="text-slate-700 leading-snug">• {t}</li>)}</ul> : <div className="mt-0.5 text-slate-400">없음</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// 목표별로 묶어 보기 — 목표 › 결과물, 루틴, 미연결
// ---------------------------------------------------------------------
function ByGoal({ rows, byId }: { rows: SubRow[]; byId: Map<string, Node> }) {
  const groups = new Map<string, { title: string; node: Node | null; kind: 'goal' | 'routine' | 'none'; rows: SubRow[] }>();
  for (const s of rows) {
    const c = chainOf(s.item_id, byId);
    const key = c.kind === 'goal' ? c.root!.id : c.kind;
    const g = groups.get(key) ?? { title: c.kind === 'goal' ? c.root!.title : c.kind === 'routine' ? '루틴 (정기 업무)' : '목표 미연결', node: c.kind === 'goal' ? c.root : null, kind: c.kind, rows: [] };
    g.rows.push(s); groups.set(key, g);
  }
  const order = [...groups.values()].sort((a, b) => (a.kind === 'goal' ? 0 : a.kind === 'routine' ? 1 : 2) - (b.kind === 'goal' ? 0 : b.kind === 'routine' ? 1 : 2));
  return (
    <div className="space-y-4">
      {order.map((g) => (
        <Card key={g.title} className="overflow-hidden">
          <div className={cx('px-5 py-3 border-b border-slate-100 flex items-center gap-3', g.kind === 'goal' ? 'bg-indigo-50/50' : 'bg-slate-50')}>
            {g.kind === 'goal' ? <Target size={15} className="text-indigo-600" /> : g.kind === 'routine' ? <Repeat size={15} className="text-slate-500" /> : <FileText size={15} className="text-slate-400" />}
            {g.node ? <Link to={`/goals?item=${g.node.id}`} className="font-semibold text-sm hover:text-indigo-700">{g.title}</Link> : <span className="font-semibold text-sm">{g.title}</span>}
            <span className="text-xs text-slate-400">결과물 {g.rows.length}</span>
            {g.node && <div className="ml-auto w-48 hidden sm:block"><PlanBar item={g.node} compact /></div>}
          </div>
          <ListHead />{g.rows.map((s, i) => <Row key={s.id} s={s} byId={byId} no={i + 1} />)}
        </Card>
      ))}
    </div>
  );
}
