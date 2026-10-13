import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Award, BookOpen, ChevronDown, ClipboardList, Compass, FileText, FileUp, Home, Layers, ListTree, LogOut, MessageSquare,
  PenLine, ScatterChart, Settings, SlidersHorizontal, Users, Gavel } from 'lucide-react';
import { useSession } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { InsightLevel } from '../lib/types';
import { cx } from '../lib/format';
import { Avatar, Spinner } from './ui';
import { ProvLegend, useAiMark } from './Prov';
import { Notifications } from './Notifications';

type Item = { to: string; label: string; icon: typeof Home; badge?: string };

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

export default function Layout() {
  const { team, isLeader, profile, memberships, setTeamId, credits } = useSession();
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
      <aside className="md:w-60 md:shrink-0 md:h-screen md:sticky md:top-0 bg-white border-b md:border-b-0 md:border-r border-slate-200 px-3 py-3 md:p-4 overflow-x-auto md:overflow-y-auto">
        <div className="hidden md:flex items-center gap-2.5 px-2 pb-4">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-[15px] tracking-tight">A</div>
          <div className="min-w-0">
            <div className="font-black text-[15px] leading-tight tracking-tight">ATEAM</div>
            <div className="text-[11px] text-slate-400 truncate">{team?.name}</div>
          </div>
        </div>
        {isLeader ? (
          <nav className="flex md:flex-col gap-1 md:gap-0.5">
            <div className="hidden md:block px-3 pb-1 text-[10px] font-semibold tracking-wider text-slate-400">매일·매주</div>
            <NavItem to="/" label="홈" icon={Home} />
            <NavItem to="/goals" label="팀목표" icon={ListTree} badge={proposedN ? `${proposedN}` : undefined} />
            <NavItem to="/work" label="업무플랫폼" icon={FileText} />
            <NavItem to="/people" label="팀원관리" icon={Users} />
            <NavItem to="/decide" label="의사결정" icon={Gavel} />
            <NavItem to="/report" label="주간보고" icon={ClipboardList} />
            <Group label="판단" />
            <NavItem to="/perf" label="팀 성과" icon={ScatterChart} />
            <NavItem to="/strategy" label="팀 전략" icon={Compass} />
            <NavItem to="/sim" label="시뮬레이션" icon={SlidersHorizontal} />
            <NavItem to="/eval" label="평가 초안" icon={Award} />
            <div className="hidden md:block h-px bg-slate-100 my-3" />
            <NavItem to="/knowhow" label="내 노하우" icon={BookOpen} />
            <NavItem to="/insight" label="AI 인사이트" icon={Layers} badge={lvl} />
            <NavItem to="/settings" label="설정" icon={Settings} />
          </nav>
        ) : (
          <nav className="flex md:flex-col gap-1 md:gap-0.5">
            <NavItem to="/" label="홈" icon={Home} />
            <NavItem to="/my/goals" label="내 목표" icon={ListTree} />
            <NavItem to="/checkin" label="체크인" icon={PenLine} />
            <NavItem to="/my/submissions" label="업무플랫폼" icon={FileUp} />
            <NavItem to="/my/one-on-ones" label="내 1:1" icon={MessageSquare} />
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
                  <NavLink to="/onboarding?new=1" className="block px-3 py-2 hover:bg-slate-50">새 팀 만들기</NavLink>
                  <button onClick={() => supabase.auth.signOut()} className="w-full text-left px-3 py-2 hover:bg-slate-50 inline-flex items-center gap-2"><LogOut size={14} />로그아웃</button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div ref={mainRef} className="px-4 md:px-8 py-6 md:py-8 max-w-[1240px]">
          <Suspense fallback={<Spinner />}><Outlet /></Suspense>
        </div>
      </main>
      <ProvLegend />
    </div>
  );
}
