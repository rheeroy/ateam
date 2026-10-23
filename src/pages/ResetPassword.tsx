import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../state/session';
import { Button, Spinner, useToast } from '../components/ui';
import { PasswordForm } from '../components/PasswordForm';

/** 비밀번호 재설정 메일의 링크가 도착하는 곳. 링크가 세션을 만들어 주므로 여기서 새 비밀번호를 저장한다. */
export default function ResetPassword() {
  const { session, loading } = useSession();
  const nav = useNavigate();
  const toast = useToast();
  // 초대 링크에서 비밀번호를 찾으러 왔으면 저장 뒤 초대로 돌아간다 (다른 곳은 대시보드)
  const [params] = useSearchParams();
  const nextRaw = params.get('next') ?? '';
  const next = /^\/invite\/[\w-]+$/.test(nextRaw) ? nextRaw : '/';
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h2 className="text-2xl font-bold">새 비밀번호 정하기</h2>
        {loading ? <div className="mt-8"><Spinner /></div> : session ? (
          <>
            <p className="text-sm text-slate-500 mt-1">{session.user.email}</p>
            <div className="mt-8">
              <PasswordForm submitLabel="저장하고 시작하기" onDone={() => { toast('비밀번호를 저장했습니다'); nav(next, { replace: true }); }} />
            </div>
          </>
        ) : (
          <div className="mt-8 space-y-4">
            <div className="rounded-xl bg-amber-50 text-amber-900 p-4 text-sm leading-relaxed">링크가 만료됐거나 이미 사용됐습니다. 재설정 메일을 다시 받아 주세요.</div>
            <Link to="/login"><Button variant="secondary" className="w-full">로그인 화면으로</Button></Link>
          </div>
        )}
      </div>
    </div>
  );
}
