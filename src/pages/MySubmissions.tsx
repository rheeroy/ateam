// 팀원 업무플랫폼 — 내 스페이스 · 그룹 스페이스 탭, 맨 위 빠른 올리기, 아래 목록 (누르면 상세에서 대화)
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileUp, MessageSquare, Plus, Settings2, Target, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { ReviewComment, Submission } from '../lib/types';
import { KIND_TAG, REQ_TAG } from '../lib/work';
import { useGroups, type WorkGroup } from '../lib/groups';
import { useItems } from '../lib/items';
import { cx, fmtDate, relDay } from '../lib/format';
import { Avatar, Card, Empty, PageHeader, Pill, Spinner } from '../components/ui';
import { GuideButton } from '../components/LeaderGuide';
import { QuickPost } from '../components/work/QuickPost';
import { GroupModal } from '../components/work/GroupModal';

export const STATUS = {
  in_review: { label: '리뷰 중', tone: 'indigo' as const },
  needs_work: { label: '보완 요청', tone: 'amber' as const },
  approved: { label: '승인', tone: 'emerald' as const },
  shared: { label: '공유됨', tone: 'slate' as const },
};

type Row = Submission & {
  submission_versions: { version: number; created_at: string; created_by: string }[];
  review_comments: Pick<ReviewComment, 'author_id' | 'body' | 'created_at'>[];
};
interface View { s: Row; v: number; last: Row['review_comments'][number] | null; n: number; fresh: boolean; makers: string[]; at: string }

/** 목록 한 줄의 신호: 마지막 대화, 답글 수, 새 소식(내 마지막 활동 이후 다른 사람이 쓴 것) */
function viewOf(s: Row, uid: string): View {
  const vs = s.submission_versions ?? [];
  const cs = [...(s.review_comments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const acts = [...vs.map((v) => ({ who: v.created_by, at: v.created_at })), ...cs.map((c) => ({ who: c.author_id, at: c.created_at }))];
  const mine = acts.filter((a) => a.who === uid).reduce((m, a) => (a.at > m ? a.at : m), '');
  const others = acts.filter((a) => a.who !== uid).reduce((m, a) => (a.at > m ? a.at : m), '');
  const at = acts.reduce((m, a) => (a.at > m ? a.at : m), s.updated_at);
  return {
    s, v: Math.max(0, ...vs.map((x) => x.version)), last: cs[0] ?? null, n: cs.length, fresh: !!others && others > mine, at,
    makers: [...new Set([...vs].sort((a, b) => a.version - b.version).map((v) => v.created_by))],
  };
}

export default function MySubmissions() {
  const { team, uid } = useTeam();
  const [params, setParams] = useSearchParams();
  const tab = params.get('g') ?? 'me';
  const setTab = (g: string) => { const p = new URLSearchParams(params); if (g === 'me') p.delete('g'); else p.set('g', g); setParams(p, { replace: true }); };
  const groups = useGroups();
  const [groupModal, setGroupModal] = useState<{ group?: WorkGroup | null } | null>(null);
  const list = useQuery({
    queryKey: ['subs', team.id, 'mine', uid],
    queryFn: () => q<Row[]>(supabase.from('submissions').select('*, submission_versions(version, created_at, created_by), review_comments(author_id, body, created_at)').eq('team_id', team.id).order('updated_at', { ascending: false }).limit(300)),
    refetchInterval: 30_000,
  });
  const views = useMemo(() => (list.data ?? []).map((s) => viewOf(s, uid)), [list.data, uid]);
  const mine = views.filter((x) => x.s.author_id === uid && !x.s.group_id);
  const inGroup = (g: string) => views.filter((x) => x.s.group_id === g);
  const myGroups = (groups.data ?? []).filter((g) => g.work_group_members.some((m) => m.user_id === uid) || g.created_by === uid);
  const group = tab !== 'me' ? myGroups.find((g) => g.id === tab) ?? null : null;
  const rows = (group ? inGroup(group.id) : mine).sort((a, b) =>
    Number(b.s.status === 'needs_work' && b.s.author_id === uid) - Number(a.s.status === 'needs_work' && a.s.author_id === uid) || Number(b.fresh) - Number(a.fresh) || b.at.localeCompare(a.at));
  const badge = (vs: View[]) => vs.filter((x) => x.fresh || (x.s.status === 'needs_work' && x.s.author_id === uid)).length;

  return (
    <section>
      <PageHeader title="업무플랫폼" sub="결과물·자료·진행 상황을 올리고 팀장님과 대화하는 공간입니다. 피드백과 보완이 모두 여기서 오갑니다" />
      {/* 탭: 내 스페이스 · 그룹들 */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4 overflow-x-auto">
        <TabBtn on={tab === 'me' || !group} onClick={() => setTab('me')} n={badge(mine)}>내 스페이스</TabBtn>
        {myGroups.map((g) => <TabBtn key={g.id} on={group?.id === g.id} onClick={() => setTab(g.id)} n={badge(inGroup(g.id))} icon>{g.name}</TabBtn>)}
        <button onClick={() => setGroupModal({})} className="px-3 py-2.5 text-sm text-slate-400 hover:text-indigo-700 inline-flex items-center gap-1 whitespace-nowrap"><Plus size={14} />그룹 만들기</button>
        <span className="ml-auto pl-2 pb-1 shrink-0"><GuideButton teamId={team.id} kinds={['principle', 'rubric', 'framework', 'glossary']} /></span>
      </div>

      {group && <GroupBar g={group} onEdit={() => setGroupModal({ group })} />}
      <QuickPost key={group?.id ?? 'me'} groupId={group?.id ?? null} groupName={group?.name} />

      <Card className="mt-4">
        {list.isLoading ? <Spinner /> : !rows.length ? (
          group ? <Empty icon={<Users size={18} />} title="아직 그룹에 올린 것이 없습니다">위에 파일을 끌어다 놓거나 글을 써서 시작하세요. 그룹 멤버와 팀장님이 함께 보고 대화합니다.</Empty>
            : <Empty icon={<FileUp size={18} />} title="아직 공유한 것이 없습니다">위에 파일을 끌어다 놓거나, 캡처를 붙여 넣거나, 한 줄만 써도 됩니다. 공유할 게 없는 주는 체크인만 해도 됩니다.</Empty>
        ) : rows.map((x) => <SubLine key={x.s.id} x={x} showAuthor={!!group} />)}
      </Card>
      {groupModal && <GroupModal group={groupModal.group} onClose={() => setGroupModal(null)} onSaved={(id) => setTab(id)} />}
    </section>
  );
}

function TabBtn({ on, onClick, n, icon, children }: { on: boolean; onClick: () => void; n: number; icon?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('px-3.5 py-2.5 text-sm -mb-px border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap', on ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800')}>
      {icon && <Users size={14} />}{children}
      {n > 0 && <span className="text-[10px] font-bold text-white bg-rose-500 rounded-full px-1.5 num">{n}</span>}
    </button>
  );
}

function GroupBar({ g, onEdit }: { g: WorkGroup; onEdit: () => void }) {
  const { team, uid, nameOf, isLeader } = useTeam();
  const items = useItems(team.id);
  const goal = g.item_id ? (items.data ?? []).find((i) => i.id === g.item_id) : null;
  const ids = g.work_group_members.map((m) => m.user_id);
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2.5 flex-wrap">
      <Users size={16} className="text-indigo-600" />
      <div className="text-sm min-w-0"><b>{g.name}</b>{goal && <span className="text-slate-500"> · <Target size={12} className="inline -mt-0.5" /> {goal.title}</span>}</div>
      <div className="flex -space-x-2 ml-1">{ids.slice(0, 6).map((u) => <span key={u} className="ring-2 ring-white rounded-full" title={nameOf(u)}><Avatar name={nameOf(u)} size={7} tone={u === uid ? 'indigo' : 'slate'} /></span>)}</div>
      <span className="text-xs text-slate-500">{ids.length}명 · 팀장님도 함께 봅니다</span>
      {(isLeader || g.created_by === uid) && <button onClick={onEdit} className="ml-auto text-xs text-slate-500 hover:text-indigo-700 inline-flex items-center gap-1"><Settings2 size={13} />멤버 관리</button>}
    </div>
  );
}

function SubLine({ x, showAuthor }: { x: View; showAuthor: boolean }) {
  const { uid, nameOf } = useTeam();
  const { s } = x;
  const rq = REQ_TAG[s.request_type] ?? REQ_TAG.approval;
  const mineNeeds = s.status === 'needs_work' && s.author_id === uid;
  return (
    <Link to={`/work/${s.id}`} className={cx('px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0', mineNeeds && 'bg-amber-50/40')}>
      {showAuthor && <Avatar name={nameOf(s.author_id)} size={9} tone={s.author_id === uid ? 'indigo' : 'slate'} />}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cx('text-[10px] font-bold rounded px-1.5 py-0.5', rq.cls)}>{rq.label}</span>
          <span className="text-[10px] rounded px-1.5 py-0.5 ring-1 ring-slate-200 text-slate-500">{KIND_TAG[s.kind] ?? '문서'}</span>
          <span className="font-semibold truncate">{s.title}</span>
          <span className="font-mono text-xs text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">v{x.v}</span>
          {x.fresh && <span className="w-2 h-2 rounded-full bg-rose-500" title="새 소식" />}
        </div>
        {showAuthor && <p className="mt-0.5 text-xs text-slate-500">{x.makers.length > 1 ? `${x.makers.map(nameOf).join(' · ')} 공동` : `${nameOf(s.author_id)} 올림`}</p>}
        {x.last ? (
          <p className={cx('mt-1 text-sm truncate flex items-center gap-1.5', x.fresh ? 'text-slate-800' : 'text-slate-500')}>
            <MessageSquare size={13} className="shrink-0 text-slate-400" /><b className="font-medium shrink-0">{x.last.author_id === uid ? '나' : nameOf(x.last.author_id)}</b><span className="truncate">{x.last.body || '파일을 보냈습니다'}</span></p>
        ) : <p className="mt-1 text-sm text-slate-400">{fmtDate(s.updated_at)} 올림 · 아직 대화 없음</p>}
      </div>
      {x.n > 0 && <span className="text-xs text-slate-500 inline-flex items-center gap-1 shrink-0"><MessageSquare size={13} />{x.n}</span>}
      <span className="text-[11px] text-slate-400 shrink-0 hidden sm:inline">{relDay(x.at)}</span>
      <Pill tone={STATUS[s.status].tone}>{mineNeeds ? '보완 요청 · 고쳐서 올리기' : STATUS[s.status].label}</Pill>
      <ChevronRight size={16} className="text-slate-300 shrink-0" />
    </Link>
  );
}
