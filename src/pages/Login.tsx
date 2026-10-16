import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ListChecks, Mail, Sparkles, TrendingUp } from 'lucide-react';
import { supabase, errorText } from '../lib/supabase';
import { useSession } from '../state/session';
import { Button, ErrorBox, inputCls } from '../components/ui';
import { LogoBlock } from '../components/Brand';

type Mode = 'login' | 'signup' | 'forgot' | 'magic';

const TITLE: Record<Mode, { h: string; sub: string }> = {
  login: { h: '로그인', sub: '이메일과 비밀번호로 들어옵니다.' },
  signup: { h: '가입하기', sub: '팀장은 가입 후 팀을 만들고, 팀원은 받은 초대 링크로 합류합니다.' },
  forgot: { h: '비밀번호 재설정', sub: '가입한 이메일로 재설정 링크를 보냅니다.' },
  magic: { h: '메일 링크로 로그인', sub: '비밀번호 없이, 메일로 받은 링크를 눌러 들어옵니다.' },
};

export default function Login() {
  const { session } = useSession();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (session) return <Navigate to={next} replace />;
  const redirectTo = `${window.location.origin}${next}`;

  function go(m: Mode) { setMode(m); setErr(null); setSent(null); setPassword(''); setPassword2(''); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (mode === 'signup') {
      if (password.length < 8) return setErr('비밀번호는 8자 이상으로 정해 주세요.');
      if (password !== password2) return setErr('비밀번호 확인이 일치하지 않습니다.');
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email, password, options: { emailRedirectTo: redirectTo, data: name ? { full_name: name } : undefined },
        });
        if (error) throw error;
        // 이미 가입된 이메일이면 identities가 비어서 돌아온다 (보안상 오류를 주지 않음)
        if (data.user && !data.user.identities?.length) throw new Error('ALREADY_REGISTERED');
        if (!data.session) setSent(`${email}로 가입 확인 메일을 보냈습니다. 메일의 링크를 누르면 가입이 끝납니다.`);
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setSent(`${email}로 비밀번호 재설정 링크를 보냈습니다.`);
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
        if (error) throw error;
        setSent(`${email}로 로그인 링크를 보냈습니다. 메일함에서 링크를 누르면 바로 들어옵니다.`);
      }
    } catch (e2) {
      setErr(authErrorText(e2));
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) setErr(authErrorText(error));
  }

  const t = TITLE[mode];
  const submitLabel = { login: '로그인', signup: '가입하기', forgot: '재설정 링크 받기', magic: '로그인 링크 받기' }[mode];

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-slate-950 text-white p-12 relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(99,102,241,0.25),transparent_45%)]" />
        <div className="relative flex items-center gap-2.5"><LogoBlock size={32} /><span className="font-black tracking-tight text-lg">ATEAM</span></div>
        <div className="relative">
          <p className="text-xs font-semibold tracking-wide text-indigo-300">팀장 Must-Have AI Solution</p>
          <h1 className="mt-3 text-[36px] font-bold leading-[1.2] tracking-tight">팀 운영의 마에스트로가<br />S급 팀장을 만들어줍니다</h1>
          <p className="mt-3 text-slate-300 leading-relaxed max-w-lg">영혼까지 갈아넣어도 팀 운영은 너무나 벅찹니다.<br /> ATEAM은 성과관리, 팀원관리, 의사결정 모든 것을 한 단계 끌어올려줍니다.</p>
          <div className="mt-6 grid grid-cols-2 gap-2.5 max-w-xl">
            {[
              { t: '조기에 경고해줘요', i: AlertTriangle, c: 'text-rose-300', d: ['예상하지 못했던 업무 리스크', '컨디션이 꺾이는 팀원과 이탈 신호', '윗 분이 조만간 지적할 문제들'] },
              { t: '모르는 패턴을 찾아줘요', i: Sparkles, c: 'text-violet-300', d: ['생각못한 부분이 팀성과를 끌어내리고 있을 때', '나도 모르게 몇몇 팀원에게만 시간을 쓰고 있을 때', '일이 밀리는 진짜 이유가 사람에게 있을 때'] },
              { t: '팀의 미래를 예측해줘요', i: TrendingUp, c: 'text-sky-300', d: ['목표별 달성 가능성과 마감 시점 전망', '분기 실적 전망과 낙관 · 비관 범위', '무엇을 바꾸면 결과가 달라지는지'] },
              { t: '놓친 것들을 알아서 챙겨줘요', i: ListChecks, c: 'text-emerald-300', d: ['이번 주 내릴 결정, 1:1이 필요한 팀원', '위에서 물어볼 질문과 답할 숫자', '평가 근거와 예상 등급까지 자동으로'] },
            ].map((x) => (
              <div key={x.t} className="rounded-xl bg-white/[0.05] ring-1 ring-white/10 p-3.5">
                <div className="flex items-center gap-1.5"><x.i size={15} className={x.c} /><span className="text-[15px] font-bold">{x.t}</span></div>
                <ul className="mt-2 space-y-1">{x.d.map((y) => <li key={y} className="text-xs text-slate-400 leading-snug flex gap-1.5"><span className="text-slate-600">·</span>{y}</li>)}</ul>
              </div>
            ))}
          </div>
          <div className="mt-6 max-w-lg border-t border-white/10 pt-4">
            <div className="text-sm font-semibold text-slate-100">일할수록 쌓이고, 쌓일수록 보입니다</div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] font-mono tracking-wider text-indigo-200">
              <span>WORK</span><span className="text-slate-500">→</span><span>LAYER</span><span className="text-slate-500">→</span><span>INSIGHT</span>
            </div>
            <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">팀이 여기서 목표를 세우고 결과물을 올리고 1:1을 할수록 기록이 맥락으로 쌓이고, 인사이트는 더 깊고 정확해집니다.</p>
          </div>
        </div>
        <p className="relative text-xs text-slate-500">팀장 1명 구독 · 팀원은 무료 초대 · 첫 30일은 Pro 무료</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold">{t.h}</h2>
          <p className="text-sm text-slate-500 mt-1">{t.sub}</p>
          {sent ? (
            <div className="mt-8 space-y-4">
              <div className="rounded-xl bg-indigo-50 text-indigo-900 p-4 text-sm leading-relaxed">{sent}</div>
              <button type="button" onClick={() => go('login')} className="text-sm text-indigo-600 font-semibold hover:underline">로그인 화면으로</button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-8 space-y-3">
              {mode === 'signup' && (
                <label className="block">
                  <span className="text-sm font-semibold">이름</span>
                  <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} mt-1.5`} placeholder="홍길동" />
                </label>
              )}
              <label className="block">
                <span className="text-sm font-semibold">업무 이메일</span>
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputCls} mt-1.5`} placeholder="name@company.com" />
              </label>
              {(mode === 'login' || mode === 'signup') && (
                <label className="block">
                  <span className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold">비밀번호</span>
                    {mode === 'login' && <button type="button" onClick={() => go('forgot')} className="text-xs text-slate-500 hover:text-indigo-600">비밀번호를 잊으셨나요?</button>}
                  </span>
                  <input type="password" required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password}
                    onChange={(e) => setPassword(e.target.value)} className={`${inputCls} mt-1.5`} placeholder={mode === 'signup' ? '8자 이상' : ''} />
                </label>
              )}
              {mode === 'signup' && (
                <label className="block">
                  <span className="text-sm font-semibold">비밀번호 확인</span>
                  <input type="password" required autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} className={`${inputCls} mt-1.5`} />
                </label>
              )}
              <ErrorBox error={err} />
              <Button type="submit" loading={busy} className="w-full">{mode === 'magic' && <Mail size={15} />}{submitLabel}</Button>

              {(mode === 'login' || mode === 'signup') && (
                <>
                  <div className="flex items-center gap-3 text-xs text-slate-400 py-1"><span className="flex-1 h-px bg-slate-200" />또는<span className="flex-1 h-px bg-slate-200" /></div>
                  <Button type="button" variant="secondary" className="w-full" onClick={google}>Google 계정으로 계속</Button>
                </>
              )}

              <div className="pt-3 text-sm text-slate-500 space-y-1.5 text-center">
                {mode === 'login' && <p>처음이신가요? <button type="button" onClick={() => go('signup')} className="text-indigo-600 font-semibold hover:underline">가입하기</button></p>}
                {mode === 'signup' && <p>이미 계정이 있나요? <button type="button" onClick={() => go('login')} className="text-indigo-600 font-semibold hover:underline">로그인</button></p>}
                {(mode === 'forgot' || mode === 'magic') && <p><button type="button" onClick={() => go('login')} className="text-indigo-600 font-semibold hover:underline">비밀번호로 로그인</button></p>}
                {mode === 'login' && <p><button type="button" onClick={() => go('magic')} className="text-xs text-slate-400 hover:text-indigo-600">비밀번호 없이 메일 링크로 로그인</button></p>}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function authErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.toLowerCase();
  if (msg === 'ALREADY_REGISTERED' || m.includes('already registered') || m.includes('already been registered')) return '이미 가입된 이메일입니다. 로그인하거나, 비밀번호를 잊었다면 재설정해 주세요.';
  if (m.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않습니다. 메일 링크로만 가입했다면 비밀번호가 없으니 \'비밀번호를 잊으셨나요?\'로 새로 정해 주세요.';
  if (m.includes('email not confirmed')) return '가입 확인 메일의 링크를 먼저 눌러 주세요.';
  if (m.includes('rate limit')) return '메일 발송 한도를 넘었습니다. 잠시 후 다시 시도하거나 비밀번호·Google로 로그인해 주세요.';
  if (m.includes('password should be') || m.includes('weak password')) return '비밀번호가 너무 약합니다. 8자 이상, 문자와 숫자를 섞어 주세요.';
  if (m.includes('same as the old') || m.includes('different from the old')) return '이전과 다른 비밀번호로 정해 주세요.';
  if (m.includes('signups not allowed')) return '현재 가입이 막혀 있습니다. 관리자에게 문의해 주세요.';
  if (m.includes('provider is not enabled')) return 'Google 로그인이 아직 설정되지 않았습니다.';
  return errorText(e);
}
