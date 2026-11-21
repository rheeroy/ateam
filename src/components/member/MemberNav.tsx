// 팀원 왼쪽 메뉴 — 노션처럼 가볍게 (이모지 · 회색 묶음 이름)
//   업무 스레드: 💬 내 스페이스(팀장님과 나) · 👥 협업 스페이스들 · ＋ 만들기 · 📌 팀 방향 · 🎯 팀 목표
//   매니징 보드: 🤝 1on1 · 피드백 · 📚 받은 히스토리 / 나만 보기: 📝 메모 · 🔒 Sim.Box
//   숫자 = 안 읽은 대화 · 답할 것. 넓은 화면에서 메뉴를 접으면 이모지만 남는다 (Layout side-collapsed)
import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTeam } from '../../state/session';
import { useGroups } from '../../lib/groups';
import { spaceKey, useSpaceUnread, type SpaceRef } from '../../lib/space';
import { useDirectionBadge } from '../direction/TeamDirection';
import { GroupModal } from '../work/GroupModal';
import { cx } from '../../lib/format';
import { Users } from 'lucide-react';

/** 협업 스페이스 표시 — 파란 사람 아이콘 (이모지 👥 는 기기마다 회색으로 보여서) */
export const GroupIcon = ({ size = 15 }: { size?: number }) => <Users size={size} strokeWidth={2.4} className="inline-block text-blue-500 fill-blue-100" />;

export function MemberNav({ boardN, historyN, demo }: { boardN: number; historyN: number; demo: boolean }) {
  const { uid } = useTeam();
  const loc = useLocation();
  const nav = useNavigate();
  const params = new URLSearchParams(loc.search);
  const groups = useGroups();
  const mine = (groups.data ?? []).filter((g) => g.work_group_members.some((m) => m.user_id === uid) || g.created_by === uid);
  const refs: SpaceRef[] = [{ kind: 'user', id: uid }, ...mine.map((g) => ({ kind: 'group' as const, id: g.id }))];
  const unread = useSpaceUnread(refs);
  const n = (r: SpaceRef) => unread.data?.[spaceKey(r)] ?? 0;
  const dir = useDirectionBadge();
  const [make, setMake] = useState(false);

  const at = (path: string) => loc.pathname === path;
  const g = params.get('g');
  const onSpace = at('/my/submissions');
  const histView = at('/my/one-on-ones') && (params.get('view') === 'history' || params.has('history'));

  return (
    <nav className="flex md:flex-col gap-0.5 text-[14px]">
      <Head>업무 스레드</Head>
      <Row to="/my/submissions" emoji="💬" on={onSpace && !g} n={n({ kind: 'user', id: uid })}>내 스페이스</Row>
      {mine.map((x) => (
        <Row key={x.id} to={`/my/submissions?g=${x.id}`} emoji={<GroupIcon />} on={onSpace && g === x.id} n={n({ kind: 'group', id: x.id })}>{x.name}</Row>
      ))}
      <button onClick={() => setMake(true)} title="협업 스페이스 만들기"
        className="hidden xl:flex items-center gap-2 w-full px-2.5 h-[30px] rounded-md text-[13px] text-slate-400 hover:bg-black/[.04] hover:text-slate-600">
        <span className="w-5 text-center">＋</span>협업 스페이스 만들기
      </button>
      <Row to="/my/direction" emoji="📌" on={at('/my/direction')} dot={dir > 0}>팀 방향</Row>
      <Row to="/my/goals" emoji="🎯" on={at('/my/goals')}>팀 목표</Row>
      <Head>매니징 보드</Head>
      <Row to="/my/one-on-ones" emoji="🤝" on={at('/my/one-on-ones') && !histView} n={boardN}>1on1 · 피드백</Row>
      <Row to="/my/one-on-ones?view=history" emoji="📚" on={histView} n={historyN}>받은 히스토리</Row>
      <Head>나만 보기</Head>
      <Row to="/my/memo" emoji="📝" on={at('/my/memo')}>메모</Row>
      <Row to="/my/sim" emoji="🔒" on={at('/my/sim')}>Sim.Box</Row>
      {!demo && <><div className="hidden md:block h-3" /><Row to="/settings" emoji="⚙️" on={at('/settings')}>설정</Row></>}
      {make && <GroupModal onClose={() => setMake(false)} onSaved={(id) => { setMake(false); nav(`/my/submissions?g=${id}`); }} />}
    </nav>
  );
}

const Head = ({ children }: { children: ReactNode }) => (
  <div className="hidden xl:block px-2.5 pt-4 pb-1 text-[11.5px] font-semibold text-slate-400">{children}</div>
);

function Row({ to, emoji, on, n, dot, tail, children }: { to: string; emoji: ReactNode; on: boolean; n?: number; dot?: boolean; tail?: string; children: ReactNode }) {
  const label = typeof children === 'string' ? children : undefined;
  return (
    <Link to={to} title={label} aria-current={on ? 'page' : undefined}
      className={cx('relative flex items-center gap-2 w-full px-2.5 md:px-0 md:justify-center xl:px-2.5 xl:justify-start h-[31px] rounded-md whitespace-nowrap',
        on ? 'bg-black/[.06] text-slate-900 font-semibold' : 'text-slate-600 hover:bg-black/[.04]')}>
      <span className="w-5 flex justify-center text-[15px] leading-none shrink-0">{emoji}</span>
      <span className="flex-1 min-w-0 truncate md:hidden xl:inline">{children}</span>
      {!!n && <span className="hidden xl:inline text-[11px] font-bold text-white bg-rose-500 rounded-full px-1.5 num">{n}</span>}
      {dot && !n && <span className="hidden xl:inline w-1.5 h-1.5 rounded-full bg-rose-500" />}
      {tail && <span className="hidden xl:inline text-[11px] text-slate-400">{tail}</span>}
      {(!!n || dot) && <span className="hidden md:block xl:hidden absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-rose-500" />}
    </Link>
  );
}
