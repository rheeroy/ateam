import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, ClipboardCheck, ChevronDown, FileText, FileUp, Home, LayoutDashboard, Layers, ListTree, LogOut, MessageSquare,
  PenLine, ScatterChart, Settings, StickyNote, Target, UserRound, Users, Gavel, Trophy } from 'lucide-react';
import { useSession } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { InsightLevel } from '../lib/types';
import { cx } from '../lib/format';
import { Avatar, Spinner } from './ui';
import { ProvLegend, useAiMark } from './Prov';
import { Notifications } from './Notifications';
import { dDay, useHomeModel, usePeriod } from './home/shared';
import { usePriorities } from './decide/priorities';
import { isOpenSub, useSubmissionsAi } from '../lib/work';
import { QuickNote } from './notes/Notes';
import { openQuickNote } from '../lib/notes';
import { ATeam, ATeamAdvice, LogoBlock, LogoMark } from './Brand';
import { useMemberBadges } from './member/Member';

type Item = { to: string; label: ReactNode; icon: typeof Home; badge?: string };

function NavItem({ to, label, icon: Icon, badge }: Item) {
  return (
    <NavLink to={to} end={to === '/'}
      className={({ isActive }) => cx(
        'flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm whitespace-nowrap',
        isActive ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-100')}>
      <Icon size={16} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {badge && <span className="hidden md:inline font-mono text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5">{badge}</span>}
    </NavLink>
  );
}

const Group = ({ label }: { label: string }) => (
  <div className="hidden md:block px-3 pt-4 pb-1 text-[10px] font-semibold tracking-wider text-slate-400">{label}</div>
);

/** 메뉴 옆 숫자 = 팀장이 처리해야 할 것 (팀목표: 승인 대기 제안 · 업무플랫폼: 리뷰 대기 · 의사결정: 결정할 것 · 임원 브리핑: D-3 이내 위의 요청) */
function useLeaderTodo() {
  const { team } = useSession();
  const [period] = usePeriod();
  const m = useHomeModel(period);
  const pr = usePriorities(m);
  const subs = useSubmissionsAi(team!.id);
  return {
    work: (subs.data ?? []).filter(isOpenSub).filter((x) => x.status === 'in_review').length,
    decide: m.loading ? 0 : pr.length,
    upward: m.orgSt.upcoming.filter((n) => n.kind === 'request' && dDay(n.event_date!) >= 0 && dDay(n.event_date!) <= 3).length,
  };
}
function LeaderNav({ lvl, proposedN }: { lvl?: string; proposedN: number }) {
  const todo = useLeaderTodo();
  return (
    <>
            <NavItem to="/" label="대시보드" icon={LayoutDashboard} />
            <Group label="팀 워크스페이스" />
            <NavItem to="/goals" label="팀목표" icon={Target} badge={proposedN ? `${proposedN}` : undefined} />
            <NavItem to="/work" label="업무플랫폼" icon={FileText} badge={todo.work ? `${todo.work}` : undefined} />
            <NavItem to="/people" label="팀원관리" icon={Users} />
            <NavItem to="/decide" label="의사결정" icon={Gavel} badge={todo.decide ? `${todo.decide}` : undefined} />
            <Group label="상향 관리" />
            <NavItem to="/upward" label="임원 브리핑" icon={UserRound} badge={todo.upward ? `${todo.upward}` : undefined} />
            <Group label="판단" />
            <NavItem to="/perf" label="팀 성과" icon={ScatterChart} />
            <NavItem to="/advisor" label={<ATeamAdvice />} icon={((p: { size?: number; className?: string }) => <LogoMark {...p} weight={4} />) as unknown as typeof Home} />
            <Group label="인사" />
            <NavItem to="/eval" label="평가 시뮬레이션" icon={ClipboardCheck} />
            <div className="hidden md:block h-px bg-slate-100 my-3" />
            <NavItem to="/notes" label="내 메모 모아보기" icon={StickyNote} />
            <NavItem to="/knowhow" label="내 노하우" icon={BookOpen} />
            <NavItem to="/insight" label="AI 인사이트" icon={Layers} badge={lvl} />
            <NavItem to="/settings" label="설정" icon={Settings} />
    </>
  );
}

export default function Layout() {
  const { team, isLeader, profile, memberships, setTeamId, credits } = useSession();
  const mb = useMemberBadges(!isLeader);
  const { on, toggle } = useAiMark();
  const nav = useNavigate();
  const loc = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const [chipCount, setChipCount] = useState(0);
  const [menu, setMenu] = useState(false);

  const levelQ = useQuery({
    queryKey: ['insight', team?.id],
    enabled: !!team && isLeader,
    queryFn: () => q<InsightLevel>(supabase.rpc('team_insight_level', { p_team: team!.id })),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const count = () => setChipCount(el.querySelectorAll('[data-chip]').length);
    count();
    const mo = new MutationObserver(count);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [loc.pathname]);

  useEffect(() => { window.scrollTo({ top: 0 }); setMenu(false); }, [loc.pathname]);

  const lvl = levelQ.data ? `L${levelQ.data.level}` : undefined;
  const proposedQ = useQuery({
    queryKey: ['items', team?.id, 'proposed-count'], enabled: !!team && isLeader, staleTime: 60_000,
    queryFn: async () => (await supabase.from('work_items').select('id', { count: 'exact', head: true }).eq('team_id', team!.id).eq('status', 'proposed')).count ?? 0,
  });
  const proposedN = proposedQ.data ?? 0;
  const trialDays = credits?.status === 'trialing' && credits.trial_ends_at ? Math.max(0, Math.ceil((Date.parse(credits.trial_ends_at) - Date.now()) / 86400000)) : null;

  return (
    <div className="min-h-screen md:flex bg-[#F6F7F9]">
      <aside className={cx('md:w-60 md:shrink-0 md:h-screen md:sticky md:top-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 px-3 py-3 md:p-4 overflow-x-auto md:overflow-y-auto', !isLeader && 'hidden md:block')}>
        <Link to="/" title="대시보드로" className="hidden md:flex items-center gap-2.5 px-2 pb-4 rounded-lg hover:opacity-80">
          <LogoBlock size={34} />
          <div className="min-w-0">
            <ATeam className="block text-[16px] text-slate-900" />
            <div className="text-[11px] text-slate-400 truncate">{team?.name}</div>
          </div>
        </Link>
        {isLeader ? (
          <nav className="flex md:flex-col gap-1 md:gap-0.5">
            <LeaderNav lvl={lvl} proposedN={proposedN} />
          </nav>
        ) : (
          <nav className="flex md:flex-col gap-1 md:gap-0.5">
            <NavItem to="/" label="홈" icon={Home} />
            <NavItem to="/my/goals" label="내 목표" icon={ListTree} />
            <NavItem to="/checkin" label="체크인" icon={PenLine} />
            <NavItem to="/my/submissions" label="업무플랫폼" icon={FileUp} badge={mb.data?.needsWork ? `보완 ${mb.data.needsWork}` : undefined} />
            <NavItem to="/my/one-on-ones" label="내 1:1" icon={MessageSquare} badge={mb.data?.promises ? `약속 ${mb.data.promises}` : undefined} />
            <NavItem to="/my/record" label="내 기록" icon={Trophy} />
            <div className="hidden md:block h-px bg-slate-100 my-3" />
            <NavItem to="/settings" label="설정" icon={Settings} />
          </nav>
        )}
      </aside>

      <main className="flex-1 min-w-0">
        <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-slate-200 px-4 md:px-8 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-500 min-w-0">
            {memberships.length > 1 ? (
              <select aria-label="팀 선택" value={team?.id} onChange={(e) => { setTeamId(e.target.value); nav('/'); }}
                className="text-sm font-semibold text-slate-800 bg-transparent border-0 focus:ring-0 pr-6 truncate">
                {memberships.map((m) => <option key={m.team_id} value={m.team_id}>{m.teams.name}{m.role === 'leader' ? ' · 팀장' : ''}</option>)}
              </select>
            ) : (
              <span className="font-semibold text-slate-800 truncate md:hidden">{team?.name}</span>
            )}
            {team?.is_demo && (
              <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 shrink-0">데모</span>
            )}
            {trialDays != null && isLeader && (
              <NavLink to="/settings?tab=billing" className="hidden sm:inline text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 shrink-0">Pro 체험 D-{trialDays}</NavLink>
            )}
            {credits?.plan_id === 'free' && isLeader && (
              <NavLink to="/settings?tab=billing" className="hidden sm:inline text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 shrink-0">Free · AI 잠김</NavLink>
            )}
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            {isLeader && (
              <button type="button" onClick={toggle} aria-pressed={on} title="이 화면에서 AI가 만든 부분을 표시합니다"
                className={cx('hidden sm:inline-flex items-center gap-2 text-[13px] border rounded-lg px-2.5 py-1.5',
                  on ? 'border-violet-300 text-violet-800 bg-violet-50' : 'border-slate-200 text-slate-600 bg-white')}>
                <span className={cx('relative w-7 h-4 rounded-full transition-colors', on ? 'bg-violet-600' : 'bg-slate-300')}>
                  <span className={cx('absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all', on ? 'left-3.5' : 'left-0.5')} />
                </span>
                AI 표시
                <span className="font-mono text-[11px] font-semibold text-violet-700 bg-violet-100/60 rounded px-1.5">{chipCount}</span>
              </button>
            )}
            {isLeader && credits && credits.plan_id !== 'free' && (
              <NavLink to="/settings?tab=billing" className="hidden lg:flex items-center gap-1.5 text-xs text-slate-500" title="평가 초안·계획서 초안 등 프리미엄 AI에 쓰는 크레딧 (기본 AI는 구독에 포함)">
                프리미엄 <span className="font-mono font-semibold text-slate-800">{credits.monthly_remaining + credits.topup_remaining}</span>
              </NavLink>
            )}
            {isLeader && (
              <button onClick={() => openQuickNote()} title="내 메모 — 지금 보던 화면에 붙여 둡니다"
                className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 bg-amber-50 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100">
                <StickyNote size={14} /><span className="hidden sm:inline">메모</span></button>
            )}
            <Notifications />
            <div className="relative">
              <button onClick={() => setMenu((x) => !x)} className="flex items-center gap-2 text-sm text-slate-600">
                <Avatar name={profile?.full_name} tone={isLeader ? 'indigo' : 'slate'} size={7} />
                <span className="hidden sm:inline">{profile?.full_name}</span>
                <ChevronDown size={14} />
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-xl shadow-lg py-1 text-sm z-30">
                  <div className="px-3 py-2 text-xs text-slate-500 truncate">{profile?.email}</div>
                  {!isLeader && <NavLink to="/my/record" onClick={() => setMenu(false)} className="block px-3 py-2 hover:bg-slate-50 md:hidden">내 기록</NavLink>}
                  {!isLeader && <NavLink to="/settings" onClick={() => setMenu(false)} className="block px-3 py-2 hover:bg-slate-50 md:hidden">설정</NavLink>}
                  <NavLink to="/onboarding?new=1" className="block px-3 py-2 hover:bg-slate-50">새 팀 만들기</NavLink>
                  <button onClick={() => supabase.auth.signOut()} className="w-full text-left px-3 py-2 hover:bg-slate-50 inline-flex items-center gap-2"><LogOut size={14} />로그아웃</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div ref={mainRef} className={cx('px-4 md:px-8 py-6 md:py-8 max-w-[1240px]', !isLeader && 'pb-24 md:pb-8')}>
          <Suspense fallback={<Spinner />}><Outlet /></Suspense>
        </div>
      </main>
      {!isLeader && <MemberTabBar needsWork={mb.data?.needsWork ?? 0} />}
      {isLeader && <QuickNote />}
      <ProvLegend />
    </div>
  );
}

/** 팀원 모바일 하단 탭 */
function MemberTabBar({ needsWork }: { needsWork: number }) {
  const tabs = [
    { to: '/', label: '홈', I: Home }, { to: '/my/goals', label: '내 목표', I: ListTree }, { to: '/checkin', label: '체크인', I: PenLine },
    { to: '/my/submissions', label: '업무', I: FileUp, dot: needsWork > 0 }, { to: '/my/one-on-ones', label: '1:1', I: MessageSquare },
  ];
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 grid grid-cols-5 pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', isActive ? 'text-indigo-700 font-semibold' : 'text-slate-500')}>
          <t.I size={20} />{t.label}
          {t.dot && <span className="absolute top-1.5 right-[30%] w-2 h-2 rounded-full bg-rose-500" />}
        </NavLink>
      ))}
    </nav>
  );
}
