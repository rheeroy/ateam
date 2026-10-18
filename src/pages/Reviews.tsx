// 업무플랫폼 — 팀원이 올린 결과물을 목표(없으면 루틴)와 연결해 보고, AI 1차 검토를 미리 보며 피드백
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Briefcase, Check, ChevronDown, ChevronRight, Sparkles, Users, FileText, Hash, Image as ImageIcon, LayoutList, Link2, MessageSquare, MessageSquareText, Plus, Repeat, Settings2, Target, Layers, UsersRound } from 'lucide-react';
import { useTeam } from '../state/session';
import { useTeamMembersOnly } from '../lib/hooks';
import { buildTree, useItems, type Node } from '../lib/items';
import { REQ_TAG, aiTone, chainOf, freshReply, isOpenSub, latestAt, useCloseSubmission, useSubmissionsAi, type SubRow } from '../lib/work';
import { useGroups, type WorkGroup } from '../lib/groups';
import { GroupModal } from '../components/work/GroupModal';
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
  const view = (params.get('view') === 'groups' ? 'people' : params.get('view') as V) ?? 'people';
  const set = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };
  const list = useSubmissionsAi(team.id);
  const items = useItems(team.id);
  const { byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  const all = list.data ?? [];
  const rows = all.filter((s) => f === 'all' || s.status === f);
  const count = (k: F) => all.filter((s) => k === 'all' || s.status === k).length;
  const [groupModal, setGroupModal] = useState<{ group?: WorkGroup | null } | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white flex items-center justify-center shadow-sm"><Briefcase size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">업무플랫폼</h1>
            <p className="text-sm text-slate-500">팀원의 업무에 대해 검토하고 소통하는 공간입니다. 최대한 많은 업무가 이 공간에서 이루어질 수 있도록 독려하세요.</p>
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
        </div> : <div className="flex items-center gap-2 min-w-0"><Users size={15} className="text-sky-600 shrink-0" /><span className="font-semibold whitespace-nowrap">업무스페이스</span><span className="text-xs text-slate-400 truncate">왼쪽은 팀원별, 오른쪽은 그룹별 — 최신이 위. 상세에서 '완료'하면 카드에서 빠지고 스페이스에는 남습니다</span></div>}
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5">
          {([['people', '업무스페이스', Users], ['list', '전체 목록', LayoutList], ['goal', '목표별', Layers]] as const).map(([id, label, I]) => (
            <button key={id} onClick={() => set('view', id === 'people' ? null : id)} className={cx('text-xs px-2.5 py-1.5 rounded-md inline-flex items-center gap-1', view === id ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}><I size={13} />{label}</button>
          ))}
        </div>
        <button onClick={() => setGroupModal({})} className="text-xs rounded-lg px-2.5 py-1.5 bg-white ring-1 ring-slate-200 hover:ring-indigo-300 inline-flex items-center gap-1"><Plus size={13} />그룹 만들기</button>
      </div>

      {view === 'people' ? (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-500 inline-flex items-center gap-1.5"><Users size={13} />팀원별</div>
            <PeopleBoxes rows={all} loading={list.isLoading} byId={byId} />
          </div>
          <div className="space-y-3">
            <div className="text-xs font-semibold text-slate-500 inline-flex items-center gap-1.5"><UsersRound size={13} />그룹별</div>
            <GroupBoxes rows={all} loading={list.isLoading} byId={byId} onEdit={(g) => setGroupModal({ group: g })} onNew={() => setGroupModal({})} />
          </div>
        </div>
      ) : list.isLoading ? <Card><Spinner /></Card> : !rows.length ? (
        <Card><Empty icon={<FileText size={18} />} title="아직 없습니다">팀원이 '업무플랫폼'에 올린 결과물·링크·캡처가 여기에 모입니다. 올리면 AI가 먼저 검토합니다.</Empty></Card>
      ) : view === 'list' ? (
        <Card className="overflow-hidden"><ListHead />{rows.map((s, i) => <Row key={s.id} s={s} byId={byId} no={i + 1} />)}</Card>
      ) : <ByGoal rows={rows} byId={byId} />}
      {groupModal && <GroupModal group={groupModal.group} onClose={() => setGroupModal(null)} onSaved={() => set('view', null)} />}
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
    <div className="grid gap-4 items-start">
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
                {list.map((s) => <OpenLine key={s.id} s={s} />)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** 사람별·그룹별 카드의 한 줄 — AI 신호 · 요청 · 제목 · 답글 수 · 새 답글 */
const TONE_DOT_LINE: Record<string, string> = { risk: 'bg-rose-500', watch: 'bg-amber-400', good: 'bg-emerald-500' };
function OpenLine({ s, showAuthor }: { s: SubRow; showAuthor?: boolean }) {
  const { uid, nameOf } = useTeam();
  const groups = useGroups();
  const rq = REQ_TAG[s.request_type] ?? REQ_TAG.approval;
  const tone = aiTone(s);
  const n = s.review_comments?.length ?? 0;
  const g = !showAuthor && s.group_id ? (groups.data ?? []).find((x) => x.id === s.group_id) : null;
  return (
    <li className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50/70">
      <span className={cx('shrink-0 w-2 h-2 rounded-full', tone ? TONE_DOT_LINE[tone] : 'bg-slate-200')} title={tone ? 'AI 1차 검토' : 'AI 검토 전'} />
      {showAuthor && <Avatar name={nameOf(s.author_id)} size={7} />}
      <Link to={`/work/${s.id}`} className="min-w-0 flex-1 flex items-center gap-2">
        <span className={cx('shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5', rq.cls)}>{rq.label}</span>
        {s.status === 'needs_work' && <span className="shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-amber-50 text-amber-800">보완 중</span>}
        <span className="truncate text-sm">{s.title}</span>
        {s.latest && s.latest.version > 1 && <span className="shrink-0 font-mono text-[10px] text-indigo-600">v{s.latest.version}</span>}
        {g && <span className="shrink-0 text-[10px] rounded px-1.5 py-0.5 bg-sky-50 text-sky-700 inline-flex items-center gap-0.5"><UsersRound size={10} />{g.name}</span>}
        {freshReply(s, uid) && <span className="shrink-0 text-[10px] font-bold text-white bg-rose-500 rounded-full px-1.5">새 답글</span>}
      </Link>
      {n > 0 && <span className="shrink-0 text-[11px] text-slate-400 inline-flex items-center gap-0.5"><MessageSquare size={11} />{n}</span>}
      <span className="shrink-0 text-[11px] text-slate-400 num w-12 text-right">{relDay(latestAt(s))}</span>
    </li>
  );
}

// ---------------------------------------------------------------------
// 그룹별 박스 — 그룹 이름 · 연결 목표 · 멤버, 그룹에 올라온 열린 업무
// ---------------------------------------------------------------------
function GroupBoxes({ rows, loading, byId, onEdit, onNew }: { rows: SubRow[]; loading: boolean; byId: Map<string, Node>; onEdit: (g: WorkGroup) => void; onNew: () => void }) {
  const { nameOf } = useTeam();
  const groups = useGroups();
  if (loading || groups.isLoading) return <Card><Spinner /></Card>;
  const list = groups.data ?? [];
  return (
    <div className="grid gap-4 items-start">
      {list.map((g) => {
        const open = rows.filter((s) => s.group_id === g.id && isOpenSub(s)).sort((a, b) => latestAt(b).localeCompare(latestAt(a)));
        const goal = g.item_id ? byId.get(g.item_id) : null;
        return (
          <section key={g.id} className="rounded-2xl bg-white ring-1 ring-slate-900/[0.07] shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="px-5 py-3.5 flex items-center gap-3 border-b border-sky-100/70 bg-gradient-to-r from-sky-50/80 via-indigo-50/40 to-white">
              <span className="w-9 h-9 rounded-full bg-white ring-1 ring-sky-200 text-sky-600 inline-flex items-center justify-center shrink-0"><UsersRound size={17} /></span>
              <span className="min-w-0"><span className="block font-semibold truncate">{g.name}</span><span className="block text-xs text-slate-500 truncate">{goal ? `목표 · ${goal.title}` : '연결 목표 없음'}</span></span>
              <span className="ml-auto flex -space-x-2 shrink-0">{g.work_group_members.slice(0, 5).map((m) => <span key={m.user_id} className="ring-2 ring-white rounded-full" title={nameOf(m.user_id)}><Avatar name={nameOf(m.user_id)} size={7} /></span>)}</span>
              <button onClick={() => onEdit(g)} className="text-slate-400 hover:text-indigo-700 shrink-0" aria-label="그룹 고치기"><Settings2 size={15} /></button>
            </div>
            {!open.length ? <p className="px-5 py-5 text-sm text-slate-400">처리할 업무가 없습니다.</p> : (
              <ul className="divide-y divide-slate-100">{open.map((s) => <OpenLine key={s.id} s={s} showAuthor />)}</ul>
            )}
          </section>
        );
      })}
      <button onClick={onNew} className="rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 hover:text-indigo-700 hover:border-indigo-200 text-sm py-6 inline-flex flex-col items-center gap-1">
        <Plus size={18} />그룹 만들기<span className="text-xs">프로젝트·TF 단위로 멤버를 묶습니다. 팀원도 직접 만들 수 있어요</span></button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Core Insight — 결과물마다 AI 1차 검토(ai-review-submission)가 남긴 한 줄 판단을 모아 보여 준다 (추가 AI 호출 없음)
//   예전 검토처럼 한 줄이 없으면 검토 점수로 같은 톤의 문장을 만든다
// ---------------------------------------------------------------------
type Tone = 'risk' | 'watch' | 'good';
interface Line { id: string; tone: Tone; text: string; why?: string; rank: number }
const TONE_DOT: Record<Tone, string> = { risk: 'bg-rose-500', watch: 'bg-amber-400', good: 'bg-emerald-500' };
/** 받침 있으면 앞 조사, 없으면 뒤 조사 */
function josa(word: string, withB: string, without: string) {
  const w = word.trim(); const c = w.charCodeAt(w.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return withB;
  return (c - 0xac00) % 28 ? withB : without;
}
function lineOf(s: SubRow, name: string): Line | null {
  const waited = daysAgo(s.latest?.created_at ?? s.created_at);
  const r = s.review;
  const b = r?.brief;
  if (b?.text) return { id: s.id, tone: b.tone, text: b.text, why: b.why, rank: b.tone === 'risk' ? 0 : b.tone === 'watch' ? 1 : 3 };
  const who = `${name} 님이 올린 '${s.title}'${josa(s.title, '은', '는')}`;
  if (r && r.depth_score <= 2) return { id: s.id, tone: 'risk', text: `${who} 고민의 깊이가 낮아 보입니다`, why: r.gaps?.[0]?.text, rank: 0 };
  if (r && (r.criteria_check ?? []).filter((c) => !c.met).length >= 2) return { id: s.id, tone: 'watch', text: `${who} 완결성이 낮아 보입니다`, why: r.gaps?.[0]?.text, rank: 1 };
  if (waited >= 3) return { id: s.id, tone: 'watch', text: `${name} 님의 '${s.title}'${josa(s.title, '이', '가')} ${waited}일째 기다리고 있습니다`, rank: 2 };
  if (r && r.depth_score >= 3.5) return { id: s.id, tone: 'good', text: `${who} 바로 인정해도 좋아 보입니다`, why: r.summary, rank: 3 };
  return null;
}

function AiDigest({ rows, loading }: { rows: SubRow[]; loading: boolean }) {
  const { nameOf } = useTeam();
  const waiting = rows.filter((s) => s.status === 'in_review');
  const reviewed = waiting.filter((s) => s.review);
  const lines = waiting.map((s) => lineOf(s, nameOf(s.author_id))).filter((x): x is Line => !!x).sort((a, b) => a.rank - b.rank);
  const [more, setMore] = useState(false);
  const shown = more ? lines : lines.slice(0, 3);
  return (
    <AiBand cadence="live"
      title={<span className="text-[15px] font-semibold">{!waiting.length ? '리뷰를 기다리는 결과물이 없습니다' : reviewed.length ? `AI가 ${reviewed.length}건을 먼저 읽었습니다. 위에서부터 보면 빠릅니다.` : 'AI 검토가 아직 없는 결과물입니다'}</span>}
      right={!!waiting.length && <span className="text-[11px] text-slate-500">리뷰 대기 {waiting.length}건 · AI 검토 {reviewed.length}건</span>}>
      {loading ? <p className="text-sm text-slate-500">불러오는 중…</p> : !waiting.length ? (
        <p className="text-sm text-slate-600">팀원이 올리면 AI가 먼저 읽고 완성도·고민의 깊이·논리·전달력을 짚어 둡니다.</p>
      ) : !lines.length ? (
        <p className="text-sm text-slate-600">결과물을 열면 1차 검토를 만들 수 있습니다.</p>
      ) : (
        <ul className="rounded-xl bg-white ring-1 ring-slate-200 divide-y divide-slate-100">
          {shown.map((x) => (
            <li key={x.id}>
              <Link to={`/work/${x.id}`} className="flex items-start gap-2.5 px-3.5 py-2.5 hover:bg-violet-50/50">
                <span className={cx('mt-[7px] w-2 h-2 rounded-full shrink-0', TONE_DOT[x.tone] ?? 'bg-slate-400')} />
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-slate-800">{x.text}</span>
                  {x.why && <span className="block text-xs text-slate-500 mt-0.5">{x.why}</span>}
                </span>
                <ChevronRight size={14} className="mt-1 text-slate-300 shrink-0" />
              </Link>
            </li>
          ))}
          {lines.length > 3 && (
            <li><button onClick={() => setMore((v) => !v)} className="w-full px-3.5 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 inline-flex items-center justify-center gap-1">
              {more ? '접기' : `나머지 ${lines.length - 3}개 더 보기`}<ChevronDown size={13} className={more ? 'rotate-180' : ''} /></button></li>
          )}
        </ul>
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
