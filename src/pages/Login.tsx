import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { supabase, errorText } from '../lib/supabase';
import { useSession } from '../state/session';
import { Button, ErrorBox, inputCls } from '../components/ui';

export default function Login() {
  const { session } = useSession();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (session) return <Navigate to={next} replace />;
  const redirectTo = `${window.location.origin}${next}`;

  async function magic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    setBusy(false);
    if (error) setErr(errorText(error)); else setSent(true);
  }
  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) setErr(errorText(error));
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-slate-900 text-white p-12">
        <div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-black">A</div><span className="font-black tracking-tight">ATEAM</span></div>
        <div>
          <p className="font-mono text-xs tracking-[.2em] text-indigo-300">팀장을 위한 AI 파트너</p>
          <h1 className="mt-4 text-4xl font-bold leading-tight">A팀은 팀장이 만듭니다.<br />잡무는 ATEAM이 합니다.</h1>
          <p className="mt-4 text-slate-300 leading-relaxed">주간보고·1:1 준비·결과물 1차 검토를 AI가 먼저 해 둡니다.<br />팀장님은 판단하고, 사람을 키우는 데 시간을 쓰세요.</p>
          <ul className="mt-8 space-y-3 text-slate-200 text-[15px]">
            <li><b className="text-white">내 방식대로 일하는 AI</b> <span className="text-slate-400">— 내 원칙·기준·자료를 넣어 두면 그 기준으로 리뷰하고 씁니다</span></li>
            <li><b className="text-white">놓치지 않는 팀장</b> <span className="text-slate-400">— 컨디션이 떨어진 팀원, 지난 약속을 먼저 알려 줍니다</span></li>
            <li><b className="text-white">윗선을 설득하는 숫자</b> <span className="text-slate-400">— 실적 전망과 What-if로 충원·목표 조정 근거를 만듭니다</span></li>
            <li><b className="text-white">덜 괴로운 평가 시즌</b> <span className="text-slate-400">— 1년 내내 쌓인 근거로 평가 초안을 씁니다</span></li>
          </ul>
        </div>
        <p className="text-xs text-slate-500">팀장 1명 구독 · 팀원은 무료 초대 · 첫 14일은 Pro 무료</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold">로그인</h2>
          <p className="text-sm text-slate-500 mt-1">처음이면 자동으로 가입됩니다.</p>
          {sent ? (
            <div className="mt-8 rounded-xl bg-indigo-50 text-indigo-900 p-4 text-sm leading-relaxed">
              <b>{email}</b>로 로그인 링크를 보냈습니다. 메일함에서 링크를 누르면 바로 들어옵니다.
            </div>
          ) : (
            <form onSubmit={magic} className="mt-8 space-y-3">
              <label className="block">
                <span className="text-sm font-semibold">업무 이메일</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1.5`} placeholder="name@company.com" />
              </label>
              <Button type="submit" loading={busy} className="w-full"><Mail size={15} />이메일로 로그인 링크 받기</Button>
              <div className="flex items-center gap-3 text-xs text-slate-400 py-1"><span className="flex-1 h-px bg-slate-200" />또는<span className="flex-1 h-px bg-slate-200" /></div>
              <Button type="button" variant="secondary" className="w-full" onClick={google}>Google 계정으로 계속</Button>
              <ErrorBox error={err} />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
