// 데모 — 신청서(/demo) · 승인 링크로 입장(/demo?t=…)
//   신청은 로그인 없이. 관리자가 승인하면 7일짜리 개인 링크를 메일로 받는다
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { invoke, errorText } from '../lib/supabase';
import { DEPTS, enterDemo } from '../lib/demo';
import { LogoBlock } from '../components/Brand';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';

const SIZES = ['1~3명', '4~10명', '11~20명', '21명 이상'];

export default function Demo() {
  const [params] = useSearchParams();
  const token = params.get('t');
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="px-5 py-4 max-w-5xl w-full mx-auto">
        <a href="/" className="inline-flex items-center gap-2"><LogoBlock size={28} /><span className="font-black tracking-tight">ATEAM</span></a>
      </header>
      <main className="flex-1 flex items-start md:items-center justify-center px-5 pb-16">
        {token ? <Enter token={token} /> : <RequestForm expired={params.get('expired') === '1'} />}
      </main>
    </div>
  );
}

function Enter({ token }: { token: string }) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { enterDemo(token).catch((e) => setErr(errorText(e))); }, [token]);
  return (
    <div className="w-full max-w-md rounded-2xl bg-white ring-1 ring-slate-200 p-8 text-center">
      {err ? <>
        <h1 className="text-xl font-bold">데모에 들어가지 못했습니다</h1>
        <p className="mt-2 text-sm text-slate-600">{err}</p>
        <div className="mt-6 flex flex-col gap-2">
          <a href="/demo" className="rounded-lg bg-indigo-600 text-white font-semibold py-2.5">데모 다시 신청하기</a>
          <a href="/login?mode=signup" className="rounded-lg ring-1 ring-slate-200 font-semibold py-2.5">내 팀으로 바로 시작하기</a>
        </div>
      </> : <>
        <div className="w-10 h-10 mx-auto rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin" />
        <p className="mt-4 text-sm text-slate-600">데모 팀으로 들어가는 중입니다…</p>
      </>}
    </div>
  );
}

function RequestForm({ expired }: { expired: boolean }) {
  const [f, setF] = useState({ name: '', company: '', job_title: '', team_size: '', dept: '', email: '', phone: '', note: '', website: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const S = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!consent) return setErr('개인정보 수집 · 이용에 동의해 주세요.');
    setBusy(true);
    try { await invoke('demo-access', { action: 'request', ...f, consent }); setDone(true); }
    catch (e2) { setErr(errorText(e2)); }
    finally { setBusy(false); }
  };

  if (done) return (
    <div className="w-full max-w-md rounded-2xl bg-white ring-1 ring-slate-200 p-8 text-center">
      <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
      <h1 className="mt-4 text-xl font-bold">신청이 접수됐습니다</h1>
      <p className="mt-2 text-sm text-slate-600 leading-relaxed">확인 후 <b>{f.email}</b>로 데모 링크를 보내 드립니다.<br />링크를 받으면 7일 동안 6개월치 기록이 쌓인 데모 팀을<br />팀장 화면과 팀원 화면으로 둘러볼 수 있어요.</p>
      <a href="/login?mode=signup" className="mt-6 block rounded-lg ring-1 ring-slate-200 font-semibold py-2.5 text-sm hover:bg-slate-50">기다리지 않고 내 팀으로 바로 시작하기 (14일 무료)</a>
    </div>
  );

  return (
    <form onSubmit={submit} className="w-full max-w-lg rounded-2xl bg-white ring-1 ring-slate-200 p-6 md:p-8 space-y-4">
      <div>
        <p className="text-sm font-bold text-indigo-600">데모 신청</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">6개월치 기록이 쌓인 팀으로 먼저 체험해 보세요</h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">신청을 확인한 뒤 메일로 7일짜리 데모 링크를 보내 드립니다. 팀장 화면과 팀원 화면을 모두 볼 수 있습니다.</p>
        {expired && <p className="mt-3 rounded-lg bg-amber-50 text-amber-800 text-sm px-3 py-2">데모 기간이 끝났습니다. 다시 신청하거나 내 팀으로 바로 시작해 보세요.</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="이름 *"><input required className={inputCls} value={f.name} onChange={S('name')} autoComplete="name" /></Field>
        <Field label="회사 *"><input required className={inputCls} value={f.company} onChange={S('company')} autoComplete="organization" /></Field>
        <Field label="직책 · 팀"><input className={inputCls} value={f.job_title} onChange={S('job_title')} placeholder="예: 마케팅팀 팀장" /></Field>
        <Field label="팀원 수">
          <select className={inputCls} value={f.team_size} onChange={S('team_size')}>
            <option value="">선택</option>{SIZES.map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="팀 직무 *">
          <select required className={inputCls} value={f.dept} onChange={S('dept')}>
            <option value="">선택 — 비슷한 팀으로 데모를 보여 드려요</option>{DEPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="업무 이메일 *"><input required type="email" className={inputCls} value={f.email} onChange={S('email')} autoComplete="email" placeholder="name@company.com" /></Field>
        <Field label="연락처"><input className={inputCls} value={f.phone} onChange={S('phone')} autoComplete="tel" placeholder="선택" /></Field>
      </div>
      <Field label="궁금한 점"><textarea rows={3} className={inputCls} value={f.note} onChange={S('note')} placeholder="선택 — 팀 상황이나 기대하는 점을 적어 주시면 데모 안내에 참고합니다" /></Field>
      {/* 봇이 채우는 숨은 칸 */}
      <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={f.website} onChange={S('website')} />
      <label className="flex items-start gap-2 text-[13px] text-slate-600 leading-relaxed">
        <input type="checkbox" className="mt-1 accent-indigo-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>데모 안내를 위해 이름 · 회사 · 직책 · 이메일 · 연락처를 수집하고, 신청일로부터 1년간 보관하는 데 동의합니다. (필수)</span>
      </label>
      <ErrorBox error={err} />
      <Button type="submit" loading={busy} className="w-full">데모 신청하기</Button>
      <p className="text-center text-sm text-slate-500">바로 써 보고 싶다면 <a href="/login?mode=signup" className="text-indigo-600 font-semibold hover:underline">내 팀으로 시작하기 (14일 무료)</a></p>
    </form>
  );
}
