// 업무플랫폼 — 팀원이 올린 결과물을 목표(없으면 루틴)와 연결해 보고, AI 1차 검토를 미리 보며 피드백
import { useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Briefcase, ChevronRight, FileText, Hash, Image as ImageIcon, LayoutList, Link2, MessageSquareText, Repeat, Target, Layers } from 'lucide-react';
import { useTeam } from '../state/session';
import { buildTree, useItems, type Node } from '../lib/items';
import { chainOf, useSubmissionsAi, type SubRow } from '../lib/work';
import { cx, daysAgo, fmtDate } from '../lib/format';
import { Card, Empty, Pill, Spinner } from '../components/ui';
import { AiBand, AiChip } from '../components/AiBar';
import { PlanBar } from '../components/goals/PlanBar';
import { STATUS } from './MySubmissions';

type F = 'in_review' | 'needs_work' | 'approved' | 'shared' | 'all';
type V = 'list' | 'goal';
const KIND_ICON = { link: Link2, image: ImageIcon, number: Hash, note: MessageSquareText, document: FileText } as const;

export default function Reviews() {
  const { team } = useTeam();
  const [params, setParams] = useSearchParams();
  const f = (params.get('f') as F) ?? 'in_review';
  const view = (params.get('view') as V) ?? 'list';
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
        <div className="flex gap-1.5 overflow-x-auto">
          {([['in_review', '리뷰 대기'], ['needs_work', '보완 요청'], ['approved', '승인'], ['shared', '공유'], ['all', '전체']] as [F, string][]).map(([id, label]) => (
            <button key={id} onClick={() => set('f', id === 'in_review' ? null : id)}
              className={cx('text-xs rounded-full px-3 py-1.5 border whitespace-nowrap', f === id ? 'bg-slate-900 text-white border-slate-900 font-semibold' : 'border-slate-200 text-slate-600 bg-white hover:border-slate-300')}>
              {label} <span className="num">{count(id)}</span></button>
          ))}
        </div>
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {([['list', '목록', LayoutList], ['goal', '목표별', Layers]] as const).map(([id, label, I]) => (
            <button key={id} onClick={() => set('view', id === 'list' ? null : id)} className={cx('text-xs px-2.5 py-1.5 rounded-md inline-flex items-center gap-1', view === id ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}><I size={13} />{label}</button>
          ))}
        </div>
      </div>

      {list.isLoading ? <Card><Spinner /></Card> : !rows.length ? (
        <Card><Empty icon={<FileText size={18} />} title="아직 없습니다">팀원이 '업무플랫폼'에 올린 결과물·링크·캡처가 여기에 모입니다. 올리면 AI가 먼저 검토합니다.</Empty></Card>
      ) : view === 'list' ? (
        <Card className="overflow-hidden">{rows.map((s) => <Row key={s.id} s={s} byId={byId} />)}</Card>
      ) : <ByGoal rows={rows} byId={byId} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// AI가 먼저 본 것 — 검토 결과를 모아 '어디부터 볼지' 알려준다 (추가 AI 호출 없음)
// ---------------------------------------------------------------------
function AiDigest({ rows, loading }: { rows: SubRow[]; loading: boolean }) {
  const waiting = rows.filter((s) => s.status === 'in_review');
  const reviewed = waiting.filter((s) => s.review);
  const gapsOf = (s: SubRow) => (s.review?.gaps?.length ?? 0) + (s.review?.criteria_check ?? []).filter((c) => !c.met).length;
  const needsMost = [...reviewed].sort((a, b) => gapsOf(b) - gapsOf(a) || (a.review!.depth_score - b.review!.depth_score))[0];
  const best = [...reviewed].sort((a, b) => b.review!.depth_score - a.review!.depth_score)[0];
  const oldest = [...waiting].sort((a, b) => (a.latest?.created_at ?? a.created_at).localeCompare(b.latest?.created_at ?? b.created_at))[0];
  const cards: { k: string; s?: SubRow; label: string; why: (s: SubRow) => ReactNode }[] = [
    { k: 'need', s: needsMost, label: '보완 포인트가 가장 많은 것', why: (s) => `보완 ${s.review?.gaps.length ?? 0} · 기준 미충족 ${(s.review?.criteria_check ?? []).filter((c) => !c.met).length}` },
    { k: 'best', s: best && best !== needsMost ? best : undefined, label: '바로 인정해도 될 것', why: (s) => `판단 깊이 ${s.review!.depth_score}/4${s.review?.change_from_previous ? ' · 지난 버전보다 나아짐' : ''}` },
    { k: 'old', s: oldest, label: '가장 오래 기다린 것', why: (s) => `${daysAgo(s.latest?.created_at ?? s.created_at)}일째 대기` },
  ];
  return (
    <AiBand title="AI 미리 검토 · 업무플랫폼" right={<span className="text-[11px] text-violet-100">리뷰 대기 {waiting.length}건 중 AI 검토 완료 {reviewed.length}건</span>}>
      {loading ? <p className="text-sm text-violet-100">불러오는 중…</p> : !waiting.length ? (
        <p className="text-sm text-violet-50">리뷰를 기다리는 결과물이 없습니다. 팀원이 올리면 AI가 먼저 읽고 강점·보완점·물어볼 질문을 정리해 둡니다.</p>
      ) : (
        <>
          <p className="text-[15px] font-semibold leading-snug">{reviewed.length ? `AI가 ${reviewed.length}건을 먼저 읽었습니다. 아래 순서로 보면 빠릅니다.` : 'AI 검토가 아직 없는 결과물입니다. 열면 1차 검토를 만들 수 있습니다.'}</p>
          <div className="mt-3 grid md:grid-cols-3 gap-2">
            {cards.filter((c, i) => c.s && !cards.slice(0, i).some((x) => x.s?.id === c.s!.id)).map((c) => (
              <Link key={c.k} to={`/work/${c.s!.id}`} className="block rounded-xl bg-white/[0.08] ring-1 ring-white/15 p-3 hover:bg-white/[0.14]">
                <div className="text-[10px] font-semibold text-violet-200">{c.label}</div>
                <div className="mt-1 text-sm font-semibold truncate">{c.s!.title}</div>
                <div className="mt-0.5 text-xs text-violet-100/85">{c.why(c.s!)}</div>
                {c.s!.review?.questions?.[0] && <div className="mt-1.5 text-xs text-white line-clamp-2">Q. {c.s!.review.questions[0]}</div>}
              </Link>
            ))}
          </div>
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

function Row({ s, byId }: { s: SubRow; byId: Map<string, Node> }) {
  const { nameOf } = useTeam();
  const Icon = KIND_ICON[s.kind] ?? FileText;
  const r = s.review;
  const crit = r?.criteria_check ?? [];
  const open = s.status === 'in_review' || s.status === 'needs_work';
  const wait = daysAgo(s.latest?.created_at ?? s.created_at);
  return (
    <Link to={`/work/${s.id}`} className="block px-5 py-4 hover:bg-slate-50/70 border-t border-slate-100 first:border-t-0">
      <div className="flex items-start gap-4">
        <div className="w-9 h-11 rounded-md border border-slate-200 bg-white shrink-0 flex items-center justify-center text-slate-400"><Icon size={16} /></div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{s.title} {s.latest && <span className="font-mono text-xs text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 ml-1">v{s.latest.version}</span>}</div>
          <div className="mt-0.5 text-sm text-slate-500 flex items-center gap-x-2 gap-y-1 flex-wrap">
            <span>{nameOf(s.author_id)} · {fmtDate(s.latest?.created_at ?? s.created_at)}</span>
            {s.status === 'in_review' && <span className={cx('text-xs', wait >= 3 ? 'text-amber-700 font-semibold' : 'text-slate-400')}>{wait === 0 ? '오늘 올라옴' : `${wait}일째 대기`}</span>}
            {s.request_type === 'feedback' && s.status === 'in_review' && <span className="text-xs text-sky-700">피드백 요청</span>}
            <Chain s={s} byId={byId} />
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {r ? (
            <div className="text-right hidden sm:block" title="AI 1차 검토 판단 깊이">
              <AiChip label={`AI ${r.depth_score}/4`} />
              <div className="mt-1 w-20 h-1 rounded-full bg-violet-100"><div className="h-1 rounded-full bg-violet-600" style={{ width: `${(r.depth_score / 4) * 100}%` }} /></div>
              {!!crit.length && <div className="mt-0.5 text-[10px] text-slate-500">내 기준 {crit.filter((c) => c.met).length}/{crit.length}</div>}
            </div>
          ) : open ? <span className="text-[11px] text-slate-400 hidden sm:inline">AI 검토 전</span> : null}
          <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill>
          <ChevronRight size={16} className="text-slate-300" />
        </div>
      </div>
      {r && (open ? (
        <div className="mt-3 sm:ml-[52px] rounded-xl bg-violet-50/70 ring-1 ring-violet-100 p-3">
          <p className="text-sm text-slate-800"><AiChip label="AI 미리보기" tone="solid" className="mr-1.5" />{r.summary}</p>
          <div className="mt-2 grid sm:grid-cols-3 gap-2 text-xs">
            <Peek label="강점" tone="emerald" text={r.strengths?.[0] && `${r.strengths[0].section ? `${r.strengths[0].section} · ` : ''}${r.strengths[0].text}`} more={(r.strengths?.length ?? 0) - 1} />
            <Peek label="보완" tone="amber" text={r.gaps?.[0] && `${r.gaps[0].section ? `${r.gaps[0].section} · ` : ''}${r.gaps[0].text}`} more={(r.gaps?.length ?? 0) - 1} />
            <Peek label="물어볼 질문" tone="violet" text={r.questions?.[0]} more={(r.questions?.length ?? 0) - 1} />
          </div>
        </div>
      ) : <p className="mt-2 text-xs text-slate-500 truncate"><span className="text-violet-700 font-semibold">AI</span> {r.summary}</p>)}
    </Link>
  );
}
function Peek({ label, text, tone, more }: { label: string; text?: string; tone: 'emerald' | 'amber' | 'violet'; more: number }) {
  if (!text) return <div className="rounded-lg bg-white/70 px-2.5 py-2 text-slate-400">{label} 없음</div>;
  return (
    <div className="rounded-lg bg-white px-2.5 py-2 ring-1 ring-slate-100">
      <div className={cx('text-[10px] font-bold', tone === 'emerald' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-violet-700')}>{label}{more > 0 && <span className="font-normal text-slate-400"> 외 {more}</span>}</div>
      <div className="mt-0.5 text-slate-700 line-clamp-2">{text}</div>
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
          {g.rows.map((s) => <Row key={s.id} s={s} byId={byId} />)}
        </Card>
      ))}
    </div>
  );
}
