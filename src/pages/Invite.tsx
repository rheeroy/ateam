import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase, errorText, q } from '../lib/supabase';
import { useSession } from '../state/session';
import { Button, ErrorBox, Spinner } from '../components/ui';

interface Preview { team_name: string; inviter: string; email: string; expired: boolean; accepted: boolean }

export default function Invite() {
  const { token } = useParams();
  const { session, loading, refresh, setTeamId } = useSession();
  const nav = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session || !token) return;
    q<Preview | null>(supabase.rpc('invitation_preview', { p_token: token }))
      .then((p) => (p ? setPreview(p) : setErr('초대 링크를 찾을 수 없습니다.')))
      .catch((e) => setErr(errorText(e)));
  }, [session, token]);

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

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6">
        <div className="font-mono text-xs tracking-widest text-indigo-600">FORESIGHT 초대</div>
        {loading ? <Spinner /> : !session ? (
          <>
            <h1 className="mt-2 text-xl font-bold">팀에 초대받았습니다</h1>
            <p className="mt-2 text-sm text-slate-600">로그인하면 초대를 확인하고 바로 합류할 수 있습니다.</p>
            <Link to={`/login?mode=signup&next=${encodeURIComponent(`/invite/${token}`)}`}><Button className="mt-5 w-full">가입하고 합류하기</Button></Link>
          </>
        ) : preview ? (
          <>
            <h1 className="mt-2 text-xl font-bold">{preview.team_name}</h1>
            <p className="mt-2 text-sm text-slate-600">{preview.inviter} 팀장님이 초대했습니다.</p>
            {preview.email && session.user.email && preview.email !== session.user.email.toLowerCase() && (
              <p className="mt-3 text-xs text-amber-800 bg-amber-50 rounded-lg p-2.5">초대받은 메일({preview.email})과 지금 로그인한 계정({session.user.email})이 다릅니다. 그래도 이 계정으로 합류할 수 있습니다.</p>
            )}
            <div className="mt-4 text-xs text-slate-500 leading-relaxed bg-slate-50 rounded-lg p-3">
              합류하면 업무플랫폼에서 결과물을 올리고, 매니징 보드에서 팀장님과의 1on1 노트와 주간 컨디션을 함께 나눕니다. 컨디션 공유는 팀장님과 나만 볼 수 있습니다.
            </div>
            <Button className="mt-5 w-full" onClick={accept} loading={busy} disabled={preview.expired}>
              {preview.expired ? '만료된 초대입니다' : '팀에 합류하기'}
            </Button>
          </>
        ) : !err ? <Spinner /> : null}
        <div className="mt-3"><ErrorBox error={err} /></div>
      </div>
    </div>
  );
}
