// 초대 링크 — 초대받은 메일로만 합류 (31_invite_email.sql: 서버도 같은 규칙으로 막는다)
//   로그인 전: 팀 · 초대한 팀장 · 초대 메일을 먼저 보여 주고, 가입 화면에 그 메일을 채워 고정
//   다른 메일로 로그인한 상태: 합류 대신 [로그아웃하고 초대받은 메일로 계속]
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, errorText, q } from '../lib/supabase';
import { useSession } from '../state/session';
import { Button, ErrorBox, Spinner } from '../components/ui';
import { LogoBlock } from '../components/Brand';

interface Preview { team_name: string; inviter: string; email: string; expired: boolean; accepted: boolean }

export default function Invite() {
  const { token } = useParams();
  const { session, loading, refresh, setTeamId } = useSession();
  const nav = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading || !token) return;
    q<Preview | null>(supabase.rpc('invitation_preview', { p_token: token }))
      .then((p) => (p ? setPreview(p) : setErr('초대 링크를 찾을 수 없습니다.')))
      .catch((e) => setErr(errorText(e)));
  }, [loading, token]);

  const invited = (preview?.email ?? '').trim();
  const mine = (session?.user.email ?? '').toLowerCase();
  const mismatch = !!session && !!invited && invited.toLowerCase() !== mine;
  const next = `/invite/${token}`;
  const toLogin = (mode: 'signup' | 'login') => `/login?mode=${mode}&next=${encodeURIComponent(next)}${invited ? `&email=${encodeURIComponent(invited)}` : ''}`;

  async function accept() {
    setBusy(true); setErr(null);
    try {
      const teamId = await q<string>(supabase.rpc('accept_invitation', { p_token: token }));
      setTeamId(teamId);
      refresh();
      nav('/', { replace: true });
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function switchAccount() {
    await supabase.auth.signOut().catch(() => {});
    nav(toLogin('login'), { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#F6F7F9]">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6">
        <div className="flex items-center gap-2"><LogoBlock size={22} /><span className="font-mono text-xs tracking-widest text-indigo-600">ATEAM 초대</span></div>
        {loading || (!preview && !err) ? <div className="py-6"><Spinner /></div> : preview ? (
          <>
            <h1 className="mt-3 text-xl font-bold">{preview.team_name}</h1>
            <p className="mt-1 text-sm text-slate-600">{preview.inviter} 팀장님이 초대했습니다.</p>
            {invited && (
              <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="text-xs text-slate-500">초대받은 메일</span>
                <span className="block font-medium text-slate-800 break-all">{invited}</span>
              </div>
            )}
            {preview.expired ? (
              <p className="mt-4 text-sm text-rose-700 bg-rose-50 rounded-lg p-3">만료된 초대입니다. 팀장님께 새 링크를 요청하세요.</p>
            ) : !session ? (
              <>
                <p className="mt-4 text-sm text-slate-600">{invited ? '이 메일로 가입하거나 로그인하면 바로 합류합니다.' : '로그인하면 초대를 확인하고 바로 합류할 수 있습니다.'}</p>
                <Link to={toLogin('signup')}><Button className="mt-4 w-full">가입하고 합류하기</Button></Link>
                <Link to={toLogin('login')} className="mt-2 block text-center text-sm text-slate-500 hover:text-indigo-700">이미 계정이 있어요 · 로그인</Link>
              </>
            ) : mismatch ? (
              <>
                <p className="mt-4 text-sm text-amber-900 bg-amber-50 rounded-lg p-3 leading-relaxed">
                  지금 로그인한 계정(<b className="break-all">{session.user.email}</b>)은 초대받은 메일과 달라서 합류할 수 없습니다. 초대받은 메일로 로그인하거나 가입해 주세요.
                </p>
                <Button className="mt-4 w-full" onClick={switchAccount}>로그아웃하고 초대받은 메일로 계속</Button>
              </>
            ) : (
              <>
                <div className="mt-4 text-xs text-slate-500 leading-relaxed bg-slate-50 rounded-lg p-3">
                  합류하면 업무플랫폼에서 결과물을 올리고, 매니징 보드에서 팀장님과의 1on1 노트와 주간 컨디션을 함께 나눕니다. 컨디션 공유는 팀장님과 나만 볼 수 있습니다.
                </div>
                <Button className="mt-5 w-full" onClick={accept} loading={busy}>팀에 합류하기</Button>
              </>
            )}
          </>
        ) : null}
        <div className="mt-3"><ErrorBox error={err} /></div>
      </div>
    </div>
  );
}
