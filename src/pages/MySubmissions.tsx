// 팀원 업무플랫폼 — [📌 팀 방향](고정) · [Sim.Box](나만 보는 시뮬레이션) · 내 스페이스(나↔팀장) · 그룹방 탭. 스페이스 탭은 채팅형 업무 스페이스(components/space/Space)
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pin, Plus, Settings2, Target, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { useGroups, type WorkGroup } from '../lib/groups';
import { useItems } from '../lib/items';
import { spaceKey, useSpaceUnread, type SpaceRef } from '../lib/space';
import { cx } from '../lib/format';
import { Avatar } from '../components/ui';
import { GuideButton } from '../components/LeaderGuide';
import { GroupModal } from '../components/work/GroupModal';
import { Space } from '../components/space/Space';
import { TeamDirection, useDirectionBadge } from '../components/direction/TeamDirection';
import { SimBox } from '../components/simbox/SimBox';

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
  const top = params.get('t');   // 'direction' | 'sim' | null(스페이스)
  const setTab = (g: string) => { const p = new URLSearchParams(params); p.delete('t'); if (g === 'me') p.delete('g'); else p.set('g', g); p.delete('open'); setParams(p, { replace: true }); };
  const setTop = (t: 'direction' | 'sim') => { const p = new URLSearchParams(params); p.set('t', t); p.delete('g'); p.delete('open'); setParams(p, { replace: true }); };
  const dirBadge = useDirectionBadge();
  const groups = useGroups();
  const [groupModal, setGroupModal] = useState<{ group?: WorkGroup | null } | null>(null);
  const myGroups = (groups.data ?? []).filter((g) => g.work_group_members.some((m) => m.user_id === uid) || g.created_by === uid);
  const group = !top && tab !== 'me' ? myGroups.find((g) => g.id === tab) ?? null : null;
  const refs: SpaceRef[] = [{ kind: 'user', id: uid }, ...myGroups.map((g) => ({ kind: 'group' as const, id: g.id }))];
  const unread = useSpaceUnread(refs);
  const n = (r: SpaceRef) => unread.data?.[spaceKey(r)] ?? 0;

  return (
    <section>
      <div className="flex items-baseline gap-3 flex-wrap mb-2">
        <h1 className="text-xl font-bold tracking-tight">업무플랫폼</h1>
        <p className="text-sm text-slate-500">결과물·자료·진행 상황을 올리고 팀장님과 대화하는 공간입니다</p>
      </div>
      <div className="flex items-end gap-2 border-b border-slate-200 mb-3">
        <div className="flex items-center gap-1 overflow-x-auto overflow-y-hidden min-w-0 flex-1 -mb-px pb-px">
        <div className="flex items-center gap-0.5 self-center rounded-lg bg-slate-100 p-0.5 mr-1 shrink-0">
          <PinTab on={top === 'direction'} onClick={() => setTop('direction')} n={top === 'direction' ? 0 : dirBadge}><Pin size={11} className={top === 'direction' ? 'text-indigo-500' : 'text-slate-400'} />팀 방향</PinTab>
          <span className={cx('w-px h-3.5 bg-slate-300 shrink-0', top && 'opacity-0')} aria-hidden />
          <PinTab on={top === 'sim'} onClick={() => setTop('sim')} n={0}><span className="ap-font text-[10px]">Sim.Box</span></PinTab>
        </div>
        <span className="w-px h-5 bg-slate-200 mr-1 self-center shrink-0" />
        <TabBtn on={!top && !group} onClick={() => setTab('me')} n={top || group ? n({ kind: 'user', id: uid }) : 0}>내 스페이스</TabBtn>
        {myGroups.map((g) => <TabBtn key={g.id} on={!top && group?.id === g.id} onClick={() => setTab(g.id)} n={group?.id === g.id ? 0 : n({ kind: 'group', id: g.id })} icon>{g.name}</TabBtn>)}
        <button onClick={() => setGroupModal({})} className="px-3 py-2.5 text-sm text-slate-400 hover:text-indigo-700 inline-flex items-center gap-1 whitespace-nowrap"><Plus size={14} />그룹 만들기</button>
        </div>
        <span className="shrink-0 pb-1.5"><GuideButton teamId={team.id} kinds={['principle', 'rubric', 'framework', 'glossary']} /></span>
      </div>
      {top === 'direction' ? <TeamDirection /> : top === 'sim' ? <SimBox /> : <>
      {group && <GroupBar g={group} onEdit={() => setGroupModal({ group })} />}
      <Space space={group ? { kind: 'group', id: group.id } : { kind: 'user', id: uid }} group={group} offset={group ? '16.5rem' : '12.5rem'} />
      </>}
      {groupModal && <GroupModal group={groupModal.group} onClose={() => setGroupModal(null)} onSaved={(id) => setTab(id)} />}
    </section>
  );
}

/** 팀 방향 · Sim.Box — 스페이스 탭(메인)보다 한 단계 낮은 회색 토글형 탭 */
function PinTab({ on, onClick, n, children }: { on: boolean; onClick: () => void; n: number; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('px-2.5 py-1 rounded-md text-[12.5px] inline-flex items-center gap-1 whitespace-nowrap transition-colors', on ? 'bg-white text-slate-800 font-semibold shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
      {children}
      {n > 0 && <span className="text-[10px] font-bold rounded-full px-1.5 num text-amber-800 bg-amber-100">{n}</span>}
    </button>
  );
}

function TabBtn({ on, onClick, n, icon, badge, children }: { on: boolean; onClick: () => void; n: number; icon?: boolean; badge?: 'amber'; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('px-3.5 py-2.5 text-sm -mb-px border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap', on ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800')}>
      {icon && <Users size={14} />}{children}
      {n > 0 && <span className={cx('text-[10px] font-bold rounded-full px-1.5 num', badge === 'amber' ? 'text-amber-800 bg-amber-100' : 'text-white bg-rose-500')}>{n}</span>}
    </button>
  );
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
