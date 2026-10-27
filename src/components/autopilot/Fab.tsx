// AUTOPILOT 플로팅 버튼 — 누르면 팝업(설명 · 핵심 질문 · 횟수 · 모드 · 실행), 실행하면 하단 중앙에 떠 있는 로딩 바
//   실제 진행(autopilot_runs.step)과 경과 시간을 함께 써서 진행률을 그리고, 끝나면 결과(/advisor?run=)로 간다
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Settings2, X } from 'lucide-react';
import { useTeam } from '../../state/session';
import { cx } from '../../lib/format';
import { errorText } from '../../lib/supabase';
import { AP_EVENT, KEY_QUESTIONS, MODE_LABEL, autopilotOf, useApQuota, useApRun, useApRuns, useStartAutopilot } from '../../lib/autopilot';
import { useToast } from '../ui';
import { AutopilotDial } from './Dial';
import { AutopilotSettings } from './Settings';

const LS = 'ateam.autopilot.run.';
const storeFor = (team: string) => ({ get: () => { try { return sessionStorage.getItem(LS + team); } catch { return null; } }, set: (v: string | null) => { try { if (v) sessionStorage.setItem(LS + team, v); else sessionStorage.removeItem(LS + team); } catch { /* 저장 불가 */ } } });
const SHOW_ON = ['/', '/goals', '/perf'];
const STALE = 10 * 60000;

/** 진행률 — 서버 단계(0~3 데이터 · 7 정리 · 8 발송)와 경과 시간을 섞는다. 끝나기 전에는 95%를 넘지 않는다 */
function progressOf(step: number, startedAt: number, done: boolean) {
  if (done) return { pct: 100, q: 7 };
  const t = (Date.now() - startedAt) / 1000;
  if (step < 3) return { pct: Math.min(30, 4 + step * 8 + t * 1.2), q: 0 };
  if (step < 7) {
    const ai = Math.max(0, t - 6);                      // AI 진단 구간: 질문을 차례로 짚는다
    return { pct: Math.min(90, 30 + 60 * (1 - Math.exp(-ai / 35))), q: Math.min(7, 1 + Math.floor(ai / 7)) };
  }
  return { pct: step >= 8 ? 97 : 93, q: 7 };
}

export function AutopilotFab() {
  const { team, members } = useTeam();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [setOpen2, setSettings] = useState(false);
  const store = storeFor(team.id);
  const [runId, setRunId] = useState<string | null>(() => store.get());
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [, tick] = useState(0);
  const quota = useApQuota(team.id);
  const runs = useApRuns(team.id);
  const run = useApRun(runId);
  const start = useStartAutopilot(team.id);
  const ap = autopilotOf(team.settings);
  const box = useRef<HTMLDivElement>(null);
  const hasMembers = members.some((m) => m.role === 'member');

  // 새로고침 뒤에도 진행 중인 실행을 이어서 보여 준다
  useEffect(() => {
    if (runId) return;
    const r = runs.data?.find((x) => x.status === 'running' && Date.now() - Date.parse(x.created_at) < STALE);
    if (r) { setRunId(r.id); setStartedAt(Date.parse(r.created_at)); store.set(r.id); }
  }, [runs.data, runId]);
  // 읽지 못하거나(권한·삭제) 10분 넘게 끝나지 않은 실행은 멈춘 것으로 보고 버튼을 풀어 준다
  const stale = !!run.data && run.data.status === 'running' && Date.now() - Date.parse(run.data.created_at) > STALE;
  const busy = start.isPending || (!!runId && !run.isError && !stale && (!run.data || run.data.status === 'running'));
  useEffect(() => { if (runId && (run.isError || stale)) { setRunId(null); store.set(null); quota.refetch(); runs.refetch(); if (stale) toast('AUTOPILOT이 시간 안에 끝나지 않았습니다. 횟수는 차감되지 않습니다.'); } }, [run.isError, stale]); // eslint-disable-line react-hooks/exhaustive-deps

  // 진행률 애니메이션
  useEffect(() => { if (!busy) return; const t = setInterval(() => tick((x) => x + 1), 400); return () => clearInterval(t); }, [busy]);
  // 끝나면 결과로
  useEffect(() => {
    const r = run.data;
    if (!r || r.status === 'running') return;
    const id = r.id;
    const t = setTimeout(() => {
      setRunId(null); store.set(null);
      quota.refetch(); runs.refetch();
      if (r.status === 'failed') toast(`AUTOPILOT을 마치지 못했습니다. ${r.error ?? ''}`.trim());
      else nav(`/advisor?run=${id}`);
    }, 700);
    return () => clearTimeout(t);
  }, [run.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // 바깥을 누르면 팝업 닫기
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', h); window.addEventListener('keydown', k);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); };
  }, [open]);
  useEffect(() => setOpen(false), [loc.pathname]);
  // 버튼은 대시보드 · 팀 목표 · 팀 성과에서만 보인다. 다른 화면에서는 실행 중이거나(결과 화면의 '다시 실행' 등으로) 팝업을 열었을 때만 잠깐 나타난다
  const home = SHOW_ON.includes(loc.pathname.replace(/\/+$/, '') || '/');
  const visible = home || open || busy;
  // 결과 화면 등 다른 곳에서 '실행'을 누르면 팝업을 연다
  useEffect(() => { const h = () => setOpen(true); window.addEventListener(AP_EVENT, h); return () => window.removeEventListener(AP_EVENT, h); }, []);

  const go = async () => {
    setOpen(false);
    try {
      setStartedAt(Date.now());
      const r = await start.mutateAsync();
      setRunId(r.run_id); store.set(r.run_id);
    } catch (e) { toast(errorText(e)); }
  };
  const q = quota.data;
  const left = q?.remaining ?? null;
  const canRun = hasMembers && (left == null || left > 0);
  const pr = progressOf(runId ? run.data?.step ?? 0 : 0, startedAt, !!runId && run.data?.status === 'done');
  const msg = pr.q === 0 ? '팀 데이터를 읽는 중' : pr.pct >= 100 ? '완료 · 결과를 여는 중' : `${pr.q}/7 · ${KEY_QUESTIONS[pr.q - 1]}`;

  return (
    <>
      <div ref={box} className={cx('fixed z-40 right-5 bottom-5 sm:right-9 sm:bottom-9 print:hidden transition-all duration-300', visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6 pointer-events-none')} aria-hidden={!visible}>
        <div role="dialog" aria-label="AUTOPILOT" aria-hidden={!open}
          className={cx('absolute right-0 bottom-[94px] sm:bottom-[108px] w-[380px] max-w-[calc(100vw-32px)] rounded-[20px] bg-white ring-1 ring-slate-200 shadow-[0_24px_60px_rgba(11,14,26,.28)] overflow-hidden origin-bottom-right transition-all duration-200',
            open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[.98] translate-y-2 pointer-events-none')}>
          <div className="bg-gradient-to-r from-[#0B0E1A] via-[#1E1B4B] to-[#2E1F7A] text-white px-[18px] py-4">
            <div className="flex items-center"><span className="inline-flex items-baseline gap-2"><span className="ap-font text-base">AUTOPILOT</span><span className="ap-on text-[13px] text-violet-400">ON</span></span>
              <button onClick={() => setOpen(false)} aria-label="닫기" className="ml-auto text-indigo-200 hover:text-white"><X size={16} /></button></div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-indigo-200">팀 데이터를 한 번에 읽고, 아래 핵심 질문에 답해 진단 · 시뮬레이션 · 바로 보낼 액션까지 준비합니다.</p>
          </div>
          <div className="px-[18px] pt-3.5 pb-4">
            <div className="text-[11px] font-extrabold tracking-wider text-slate-400 mb-1.5">KEY QUESTIONS</div>
            <ol className="space-y-0.5">
              {KEY_QUESTIONS.map((k, i) => (
                <li key={k} className="flex items-center gap-2.5 text-[13px] text-slate-800 py-1"><span className="w-5 h-5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-extrabold flex items-center justify-center shrink-0">{i + 1}</span>{k}</li>
              ))}
            </ol>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              {q && <>
                <b className="text-slate-800">{q.trial ? '체험 기간' : '이번 달'}</b>
                <span className="flex gap-[3px]">{Array.from({ length: q.limit }, (_, i) => <i key={i} className={cx('w-3.5 h-1.5 rounded-sm', i < q.used ? 'bg-violet-600' : 'bg-slate-200')} />)}</span>
                <span>{q.remaining}/{q.limit}회 남음</span>
              </>}
              <button onClick={() => { setOpen(false); setSettings(true); }} className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full px-2.5 py-1"><Settings2 size={12} />모드 · {MODE_LABEL[ap.mode]}</button>
            </div>
            <button onClick={go} disabled={!canRun || busy}
              className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-extrabold text-sm hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed">
              <span className="ap-font text-[11px]">AUTOPILOT</span>실행
            </button>
            {!hasMembers ? <p className="mt-2 text-[11.5px] text-slate-500 text-center">팀원을 초대하면 실행할 수 있습니다.</p>
              : left === 0 ? <p className="mt-2 text-[11.5px] text-slate-500 text-center">{q?.trial ? '체험 기간에는 1번 실행할 수 있습니다. 요금제를 시작하면 매달 다시 채워집니다.' : '이번 달 실행 횟수를 모두 썼습니다. 다음 달 1일에 다시 채워집니다.'}</p> : null}
          </div>
        </div>
        <button tabIndex={visible ? 0 : -1} onClick={() => (busy ? null : setOpen((x) => !x))} aria-label="AUTOPILOT" aria-expanded={open} title={busy ? 'AUTOPILOT 진행 중' : 'AUTOPILOT'}
          className="ap-fab block rounded-full">
          <AutopilotDial size={78} busy={busy} className="sm:hidden" />
          <AutopilotDial size={92} busy={busy} className="hidden sm:inline-block" />
        </button>
      </div>

      {/* 실행 중 — 하단 중앙에 떠 있는 로딩 바 (버튼과 세로 중심 맞춤) */}
      <div aria-live="polite" className={cx('fixed z-40 left-4 right-[110px] bottom-[41px] sm:right-auto sm:left-1/2 sm:bottom-[64px] sm:w-[min(860px,calc(100vw-240px))] sm:-translate-x-1/2 transition-all duration-500 print:hidden',
        busy ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[140%] pointer-events-none')}>
        <div className="relative h-9 rounded-full overflow-hidden bg-[#0B0E1A]/90 backdrop-blur ring-1 ring-violet-400/35 shadow-[0_18px_40px_rgba(11,14,26,.35),0_0_0_4px_rgba(124,58,237,.08),0_0_28px_rgba(124,58,237,.25)]">
          <div className="ap-fill absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-600/55 to-violet-600/75" style={{ width: `${busy ? Math.round(pr.pct) : 0}%` }} />
          <div className="relative h-full flex items-center gap-2.5 pl-2.5 pr-3.5 text-white text-[12.5px]">
            <span className="ap-rad w-[18px] h-[18px] rounded-full ring-[1.5px] ring-violet-300/60 shrink-0" />
            <span className="ap-font text-[10.5px] tracking-[.16em] shrink-0 hidden sm:inline">AUTOPILOT</span>
            <span className="w-px h-3.5 bg-white/20 shrink-0 hidden sm:block" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[calc(100%-110px)] sm:max-w-[calc(100%-300px)] truncate text-center text-violet-50">{msg}</span>
            <span className="ml-auto font-extrabold num">{Math.round(pr.pct)}%</span>
          </div>
        </div>
      </div>
      <AutopilotSettings open={setOpen2} onClose={() => setSettings(false)} />
    </>
  );
}
