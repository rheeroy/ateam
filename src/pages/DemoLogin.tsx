// 데모 팀원 체험 탭의 입구: 팀장이 받은 1회용 토큰으로 이 탭에서만 팀원으로 로그인한다
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Spinner } from '../components/ui';

let started = false; // StrictMode 이중 실행에서 토큰을 두 번 쓰지 않도록

export default function DemoLogin() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const th = params.get('th');
    if (!th) { setErr('체험 링크가 올바르지 않습니다.'); return; }
    if (started) return;
    started = true;
    supabase.auth.verifyOtp({ token_hash: th, type: 'magiclink' }).then(({ error }) => {
      if (error) { setErr('체험 링크가 만료됐습니다. 팀장 탭에서 다시 눌러 주세요.'); return; }
      nav('/', { replace: true });
    });
  }, [params, nav]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      {err ? (
        <div className="max-w-sm text-center space-y-3">
          <div className="font-semibold">{err}</div>
          <Link to="/" className="text-sm text-indigo-600">처음으로</Link>
        </div>
      ) : <Spinner label="팀원으로 로그인하는 중…" />}
    </div>
  );
}
