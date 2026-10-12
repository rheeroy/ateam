import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from './state/session';
import { isConfigured } from './lib/supabase';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import Login from './pages/Login';
import Invite from './pages/Invite';
import Onboarding from './pages/Onboarding';

const Home = lazy(() => import('./pages/Home'));
const OneOnOnes = lazy(() => import('./pages/OneOnOnes'));
const OneOnOneDetail = lazy(() => import('./pages/OneOnOneDetail'));
const Reviews = lazy(() => import('./pages/Reviews'));
const ReviewDetail = lazy(() => import('./pages/ReviewDetail'));
const Report = lazy(() => import('./pages/Report'));
const Perf = lazy(() => import('./pages/Perf'));
const Strategy = lazy(() => import('./pages/Strategy'));
const Sim = lazy(() => import('./pages/Sim'));
const Evaluation = lazy(() => import('./pages/Evaluation'));
const Insight = lazy(() => import('./pages/Insight'));
const TeamPage = lazy(() => import('./pages/Team'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Checkin = lazy(() => import('./pages/Checkin'));
const MySubmissions = lazy(() => import('./pages/MySubmissions'));
const MyOneOnOnes = lazy(() => import('./pages/MyOneOnOnes'));
const Knowhow = lazy(() => import('./pages/Knowhow'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const DemoLogin = lazy(() => import('./pages/DemoLogin'));
const Goals = lazy(() => import('./pages/Goals'));
const MemberHome = lazy(() => import('./pages/MemberHome'));

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
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

function RequireTeam({ children }: { children: ReactNode }) {
  const { team } = useSession();
  if (!team) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
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
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Spinner /></div>}>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<Invite />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/demo-login" element={<DemoLogin />} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route element={<RequireAuth><RequireTeam><Layout /></RequireTeam></RequireAuth>}>
        <Route index element={isLeader ? <Home /> : <MemberHome />} />
        <Route path="goals" element={L(<Goals mode="leader" />)} />
        <Route path="my/goals" element={<Goals mode="member" />} />
        <Route path="one-on-ones" element={L(<OneOnOnes />)} />
        <Route path="one-on-ones/:id" element={<OneOnOneDetail />} />
        <Route path="reviews" element={L(<Reviews />)} />
        <Route path="reviews/:id" element={<ReviewDetail />} />
        <Route path="report" element={L(<Report />)} />
        <Route path="perf" element={L(<Perf />)} />
        <Route path="strategy" element={L(<Strategy />)} />
        <Route path="sim" element={L(<Sim />)} />
        <Route path="eval" element={L(<Evaluation />)} />
        <Route path="insight" element={L(<Insight />)} />
        <Route path="knowhow" element={L(<Knowhow />)} />
        <Route path="team" element={L(<TeamPage />)} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="checkin" element={<Checkin />} />
        <Route path="my/submissions" element={<MySubmissions />} />
        <Route path="my/one-on-ones" element={<MyOneOnOnes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}
