// 팀원 업무 스레드 — 💬 내 스페이스(나↔팀장) · 👥 협업 스페이스(?g=) 를 왼쪽 메뉴에서 고른다. 화면은 채팅형 업무 스페이스(components/space/Space)
//   📌 팀 방향(/my/direction) · 🔒 Sim.Box(/my/sim) 는 따로 떨어진 메뉴 (MyDirection · MySim)
import { useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Settings2, Target, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { useGroups, type WorkGroup } from '../lib/groups';
import { useItems } from '../lib/items';
import { spaceKey, useSpaceUnread, type SpaceRef } from '../lib/space';
import { cx } from '../lib/format';
import { Avatar } from '../components/ui';
import { GuideButton } from '../components/LeaderGuide';
import { GroupModal } from '../components/work/GroupModal';
import { Space } from '../components/space/Space';
import { TeamDirection } from '../components/direction/TeamDirection';
import { SimBox } from '../components/simbox/SimBox';
import { NotionHead } from '../components/NotionHead';

export const STATUS = {
  in_review: { label: '리뷰 중', tone: 'indigo' as const },
  needs_work: { label: '보완 요청', tone: 'amber' as const },
  approved: { label: '승인', tone: 'emerald' as const },
  shared: { label: '공유됨', tone: 'slate' as const },
};

export default function MySubmissions() {
  const { team, uid } = useTeam();
  const [params, setParams] = useSearchParams();
  const tab = params.get('g') ?? 'me';
  const top = params.get('t');   // 예전 링크(?t=direction · ?t=sim) → 따로 떨어진 메뉴로
  const setTab = (g: string) => { const p = new URLSearchParams(params); if (g === 'me') p.delete('g'); else p.set('g', g); p.delete('open'); setParams(p, { replace: true }); };
  const groups = useGroups();
  const [groupModal, setGroupModal] = useState<{ group?: WorkGroup | null } | null>(null);
  const myGroups = (groups.data ?? []).filter((g) => g.work_group_members.some((m) => m.user_id === uid) || g.created_by === uid);
  const group = tab !== 'me' ? myGroups.find((g) => g.id === tab) ?? null : null;
  const refs: SpaceRef[] = [{ kind: 'user', id: uid }, ...myGroups.map((g) => ({ kind: 'group' as const, id: g.id }))];
  const unread = useSpaceUnread(refs);
  const n = (r: SpaceRef) => unread.data?.[spaceKey(r)] ?? 0;
  if (top === 'direction') return <Navigate to="/my/direction" replace />;
  if (top === 'sim') return <Navigate to="/my/sim" replace />;

  return (
    <section>
      {/* 좁은 화면: 왼쪽 메뉴 대신 스페이스 고르기 */}
      <div className="md:hidden -mx-1 mb-3 flex items-center gap-1.5 overflow-x-auto pb-1">
        <Chip on={!group} onClick={() => setTab('me')} n={group ? n({ kind: 'user', id: uid }) : 0}>💬 내 스페이스</Chip>
        {myGroups.map((g) => <Chip key={g.id} on={group?.id === g.id} onClick={() => setTab(g.id)} n={group?.id === g.id ? 0 : n({ kind: 'group', id: g.id })}>👥 {g.name}</Chip>)}
        <Link to="/my/direction" className="shrink-0 rounded-full bg-slate-100 text-slate-600 text-xs px-3 py-1.5">📌 팀 방향</Link>
        <Link to="/my/memo" className="shrink-0 rounded-full bg-slate-100 text-slate-600 text-xs px-3 py-1.5">📝 메모</Link>
        <Link to="/my/sim" className="shrink-0 rounded-full bg-slate-100 text-slate-600 text-xs px-3 py-1.5">🔒 Sim.Box</Link>
      </div>
      {group
        ? <NotionHead emoji="👥" title={group.name} sub={<GroupMeta g={group} />}
            right={<GroupEdit g={group} onEdit={() => setGroupModal({ group })} />} />
        : <NotionHead emoji="💬" title="내 스페이스" sub="팀장님과 나 둘만의 공간 · 결과물 · 자료 · 진행 상황을 올리고 대화합니다"
            right={<GuideButton teamId={team.id} kinds={['principle', 'rubric', 'framework', 'glossary']} />} />}
      <Space space={group ? { kind: 'group', id: group.id } : { kind: 'user', id: uid }} group={group} offset="11rem" flat />
      {groupModal && <GroupModal group={groupModal.group} onClose={() => setGroupModal(null)} onSaved={(id) => setTab(id)} />}
    </section>
  );
}

/** 팀원 · 팀 방향 (왼쪽 메뉴 📌) */
export function MyDirection() {
  return (
    <section className="max-w-4xl">
      <NotionHead emoji="📌" title="팀 방향" sub="팀장님이 정리한 우리 팀의 일하는 기준 · 새로 바뀐 것은 NEW로 표시됩니다" />
      <TeamDirection />
    </section>
  );
}

/** 팀원 · Sim.Box (왼쪽 메뉴 🔒) */
export function MySim() {
  return (
    <section>
      <NotionHead emoji="🔒" title="Sim.Box" sub={<span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-slate-600">🔒 나만 봅니다 · 팀장님도 볼 수 없어요 · 30일 뒤 자동 삭제</span>} />
      <SimBox />
    </section>
  );
}

function Chip({ on, onClick, n, children }: { on: boolean; onClick: () => void; n: number; children: ReactNode }) {
  return (
    <button onClick={onClick} className={cx('shrink-0 rounded-full text-xs px-3 py-1.5 inline-flex items-center gap-1', on ? 'bg-slate-800 text-white font-semibold' : 'bg-slate-100 text-slate-600')}>
      {children}{n > 0 && <span className="text-[10px] font-bold rounded-full px-1.5 text-white bg-rose-500">{n}</span>}
    </button>
  );
}

function GroupMeta({ g }: { g: WorkGroup }) {
  const { team, uid, nameOf } = useTeam();
  const items = useItems(team.id);
  const goal = g.item_id ? (items.data ?? []).find((i) => i.id === g.item_id) : null;
  const ids = g.work_group_members.map((m) => m.user_id);
  return (
    <span className="inline-flex items-center gap-2.5 flex-wrap">
      <span>협업 스페이스 · {ids.length}명</span>
      <span className="flex -space-x-2">{ids.slice(0, 6).map((u) => <span key={u} className="ring-2 ring-white rounded-full" title={nameOf(u)}><Avatar name={nameOf(u)} size={7} tone={u === uid ? 'indigo' : 'slate'} /></span>)}</span>
      {goal && <span className="inline-flex items-center gap-1 rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5 text-xs"><Target size={11} />{goal.title}</span>}
      <span className="text-xs text-slate-400">팀장님도 함께 봅니다</span>
    </span>
  );
}

function GroupEdit({ g, onEdit }: { g: WorkGroup; onEdit: () => void }) {
  const { uid, isLeader } = useTeam();
  if (!(isLeader || g.created_by === uid)) return null;
  return <button onClick={onEdit} className="text-xs text-slate-600 rounded-md ring-1 ring-[#EDEDEB] bg-white px-2.5 py-1.5 hover:bg-slate-50 inline-flex items-center gap-1"><Settings2 size={13} />스페이스 설정</button>;
}

export function GroupBar({ g, onEdit }: { g: WorkGroup; onEdit: () => void }) {
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
