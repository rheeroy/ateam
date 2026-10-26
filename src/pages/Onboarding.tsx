import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, errorText, q } from '../lib/supabase';
import { useSession } from '../state/session';
import { saveOnboarding } from '../lib/onboarding';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';

export default function Onboarding() {
  const { team, refresh, setTeamId, profile, session } = useSession();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [title, setTitle] = useState('팀장');
  const [myName, setMyName] = useState(profile?.full_name ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (team && !params.get('new')) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (profile && myName && myName !== profile.full_name) {
        await q(supabase.from('profiles').update({ full_name: myName }).eq('id', profile.id));
      }
      const id = await q<string>(supabase.rpc('create_team', { p_name: name, p_mission: mission, p_job_title: title }));
      // 새 팀은 '시작하기'(자료 → 팀목표 초안 · 업무 기준 · 팀원 초대)부터 — 건너뛸 수 있다
      await saveOnboarding(id, { status: 'pending', step: 1 });
      setTeamId(id);
      refresh();
      nav('/', { replace: true });
    } catch (e2) {
      setErr(errorText(e2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-lg bg-white border border-slate-200 rounded-2xl p-6 md:p-8 space-y-5">
        <div>
          <div className="flex items-center justify-between gap-3">
            <div className="font-mono text-xs tracking-widest text-indigo-600">시작하기</div>
            <button type="button" onClick={() => { void supabase.auth.signOut().then(() => nav('/login', { replace: true })); }}
              className="text-xs text-slate-500 hover:text-indigo-600 truncate" title="다른 계정으로 로그인">
              {session?.user.email} · 다른 계정으로 로그인
            </button>
          </div>
          <p className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">이 계정에는 아직 팀이 없습니다. 팀원으로 초대받았다면 팀장이 보낸 초대 링크로 들어오세요.</p>
          <h1 className="mt-2 text-2xl font-bold">팀을 만들어 주세요</h1>
          <p className="mt-1 text-sm text-slate-500">14일 동안 모든 기능을 무료로 씁니다. 카드 등록은 필요 없고, 체험이 끝난 뒤 팀 크기에 맞는 요금제를 고르면 기록 그대로 이어서 씁니다.</p>
        </div>
        <Field label="내 이름"><input required className={inputCls} value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="팀 이름"><input required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="전략기획팀" /></Field></div>
          <Field label="내 직책"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>
        <Field label="팀 미션" hint="나중에 바꿀 수 있습니다">
          <textarea rows={2} className={inputCls} value={mission} onChange={(e) => setMission(e.target.value)} placeholder="예) 신사업 기회를 빠르게 검증해, 회사의 다음 성장 동력을 만든다" />
        </Field>
        <ErrorBox error={err} />
        <Button type="submit" loading={busy} className="w-full">팀 만들기</Button>
      </form>
    </div>
  );
}
