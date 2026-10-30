import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { useSession } from './state/session';
import { isConfigured, supabase } from './lib/supabase';
import { onboardingPending } from './lib/onboarding';
import Layout from './components/Layout';
import { LogoMark } from './components/Brand';

/** 첫 로딩 — index.html 의 흰 바탕 로고와 같은 모양 (스피너 깜빡임 없이 이어지게) */
const Splash = () => <div className="fixed inset-0 bg-white flex items-center justify-center"><LogoMark size={52} weight={3.4} className="text-indigo-600 animate-pulse" /></div>;
import Login from './pages/Login';
import Invite from './pages/Invite';
import Onboarding from './pages/Onboarding';

const Home = lazy(() => import('./pages/Home'));
const Setup = lazy(() => import('./pages/Setup'));
const OneOnOneDetail = lazy(() => import('./pages/OneOnOneDetail'));
const Reviews = lazy(() => import('./pages/Reviews'));
const ReviewDetail = lazy(() => import('./pages/ReviewDetail'));
const Upward = lazy(() => import('./pages/Upward'));
const Perf = lazy(() => import('./pages/Perf'));
const Autopilot = lazy(() => import('./pages/Autopilot'));   // ATEAM AI의 제안 = AUTOPILOT 결과 (예전 주간 제안 화면 pages/Advisor 는 쓰지 않음)
const Evaluation = lazy(() => import('./pages/Evaluation'));
const Insight = lazy(() => import('./pages/Insight'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const MySubmissions = lazy(() => import('./pages/MySubmissions'));
const MyOneOnOnes = lazy(() => import('./pages/MyOneOnOnes'));
const Knowhow = lazy(() => import('./pages/Knowhow'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Goals = lazy(() => import('./pages/Goals'));
const Brief = lazy(() => import('./pages/Brief'));
const People = lazy(() => import('./pages/People'));
const PersonDetail = lazy(() => import('./pages/PersonDetail'));
const TeamGoals = lazy(() => import('./pages/TeamGoals'));
const Decide = lazy(() => import('./pages/Decide'));
const WorkSpace = lazy(() => import('./pages/WorkSpace'));
const GroupSpace = lazy(() => import('./pages/GroupSpace'));
const Notes = lazy(() => import('./pages/Notes'));
const HistoryPage = lazy(() => import('./pages/History'));

function NotConfigured() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg bg-white border border-slate-200 rounded-2xl p-6 text-sm leading-relaxed">
        <div className="font-bold text-lg">환경 변수가 필요합니다</div>
        <p className="mt-2 text-slate-600"><code>.env</code> 파일에 <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code>를 넣고 다시 실행하세요. 예시는 <code>.env.example</code>에 있습니다.</p>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const loc = useLocation();
  if (loading) return <Splash />;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function RequireTeam({ children }: { children: ReactNode }) {
  const { team, membershipError, refresh, session, isLeader } = useSession();
  if (!team && membershipError) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-3 text-sm">
        <div className="font-semibold text-base">팀 정보를 불러오지 못했습니다</div>
        <p className="text-slate-500">네트워크를 확인하고 다시 시도하세요. 계속되면 다시 로그인해 주세요.</p>
        <div className="flex gap-2 justify-center">
          <button className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold" onClick={() => refresh()}>다시 시도</button>
          <button className="px-3 py-2 rounded-lg border border-slate-200" onClick={() => supabase.auth.signOut()}>다시 로그인 ({session?.user.email})</button>
        </div>
      </div>
    </div>
  );
  if (!team) return <Navigate to="/onboarding" replace />;
  // 새 팀의 팀장: 마치거나 건너뛰기 전까지 앱 위에 '시작하기' 팝업
  const pending = isLeader && onboardingPending(team.settings);
  return <>{children}{pending && <Suspense fallback={null}><Setup /></Suspense>}</>;
}

/** 옛 주소 → 새 메뉴 (쿼리는 이어 붙임) */
function Moved({ to, extra }: { to: string; extra?: Record<string, string> }) {
  const [params] = useSearchParams();
  const p = new URLSearchParams(params);
  for (const [k, v] of Object.entries(extra ?? {})) if (!p.has(k)) p.set(k, v);
  const qs = p.toString();
  return <Navigate to={`${to}${qs ? `?${qs}` : ''}`} replace />;
}

/** 팀원의 '/' — 예전 알림 링크(/?coach=…)는 매니징 보드로 */
function MemberIndex() {
  const [params] = useSearchParams();
  const coach = params.get('coach');
  return <Navigate to={coach ? `/my/one-on-ones?coach=${coach}` : '/my/submissions'} replace />;
}

/** 예전 '받은 히스토리' 링크(알림) → 매니징 보드 안의 받은 히스토리 */
function HistoryLink() {
  const [params] = useSearchParams();
  const id = params.get('id');
  return <Navigate to={`/my/one-on-ones${id ? `?history=${id}` : ''}`} replace />;
}

function LeaderOnly({ children }: { children: ReactNode }) {
  const { isLeader } = useSession();
  return isLeader ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const { isLeader } = useSession();
  if (!isConfigured) return <NotConfigured />;
  const L = (el: ReactNode) => <LeaderOnly>{el}</LeaderOnly>;
  return (
    <Suspense fallback={<Splash />}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route path="/setup" element={<Navigate to="/" replace />} />
      <Route element={<RequireAuth><RequireTeam><Layout /></RequireTeam></RequireAuth>}>
        <Route index element={isLeader ? <Home /> : <MemberIndex />} />
        <Route path="brief/org" element={<Moved to="/upward" />} />
        <Route path="brief/:section" element={L(<Brief />)} />
        <Route path="goals" element={L(<TeamGoals />)} />
        <Route path="goals/edit" element={L(<Goals mode="leader" />)} />
        <Route path="my/goals" element={<Goals mode="member" />} />
        <Route path="people" element={L(<People />)} />
        <Route path="decide" element={L(<Decide />)} />
        <Route path="people/:id" element={L(<PersonDetail />)} />
        <Route path="one-on-ones" element={<Moved to="/people" />} />
        <Route path="one-on-ones/:id" element={<OneOnOneDetail />} />
        <Route path="work" element={L(<Reviews />)} />
        <Route path="work/u/:id" element={L(<WorkSpace />)} />
        <Route path="work/g/:id" element={L(<GroupSpace />)} />
        <Route path="work/:id" element={<ReviewDetail />} />
        <Route path="reviews" element={<Moved to="/work" />} />
        <Route path="reviews/:id" element={<ReviewDetail />} />
        <Route path="upward" element={L(<Upward />)} />
        <Route path="report" element={<Moved to="/upward" />} />
        <Route path="perf" element={L(<Perf />)} />
        <Route path="advisor" element={L(<Autopilot />)} />
        <Route path="strategy" element={<Moved to="/perf" />} />
        <Route path="sim" element={<Moved to="/advisor" />} />
        <Route path="eval" element={L(<Evaluation />)} />
        <Route path="insight" element={L(<Insight />)} />
        <Route path="knowhow" element={L(<Knowhow />)} />
        <Route path="notes" element={L(<Notes />)} />
        <Route path="history" element={L(<HistoryPage />)} />
        <Route path="team" element={<Moved to="/settings" extra={{ tab: 'members' }} />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="checkin" element={<Navigate to="/my/goals" replace />} />
        <Route path="my/submissions" element={<MySubmissions />} />
        <Route path="my/one-on-ones" element={<MyOneOnOnes />} />
        <Route path="my/history" element={<HistoryLink />} />
        <Route path="my/record" element={<Navigate to="/my/one-on-ones" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
