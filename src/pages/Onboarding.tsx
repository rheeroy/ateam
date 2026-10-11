import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, errorText, q } from '../lib/supabase';
import { useSession } from '../state/session';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';

export default function Onboarding() {
  const { team, refresh, setTeamId, profile } = useSession();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [title, setTitle] = useState('팀장');
  const [myName, setMyName] = useState(profile?.full_name ?? '');
  const [sample, setSample] = useState(true);
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
      if (sample) await q(supabase.rpc('seed_sample_strategy', { p_team: id }));
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
          <div className="font-mono text-xs tracking-widest text-indigo-600">시작하기</div>
          <h1 className="mt-2 text-2xl font-bold">팀을 만들어 주세요</h1>
          <p className="mt-1 text-sm text-slate-500">Pro 기능을 14일 동안 무료로 쓸 수 있습니다. 카드 등록은 필요 없습니다.</p>
        </div>
        <Field label="내 이름"><input required className={inputCls} value={myName} onChange={(e) => setMyName(e.target.value)} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="팀 이름"><input required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="전략기획팀" /></Field></div>
          <Field label="내 직책"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>
        <Field label="팀 미션" hint="나중에 바꿀 수 있습니다">
          <textarea rows={2} className={inputCls} value={mission} onChange={(e) => setMission(e.target.value)} placeholder="예) 신사업 기회를 빠르게 검증해, 회사의 다음 성장 동력을 만든다" />
        </Field>
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} className="mt-1 accent-indigo-600" />
          <span>샘플 전략 목표·과제·실적 지표를 넣어 둡니다<span className="block text-xs text-slate-500">전략·성과·시뮬레이션 화면이 어떻게 보이는지 바로 확인할 수 있습니다. 언제든 지울 수 있습니다.</span></span>
        </label>
        <ErrorBox error={err} />
        <Button type="submit" loading={busy} className="w-full">팀 만들기</Button>
      </form>
    </div>
  );
}
