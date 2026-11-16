// 시작하기 1단계 — 팀 자료 정리 (팀 폴더의 지난 자료 읽기)
//   폴더 고르기 → 목록 확인(애니메이션) → 고르기(읽을 것 · 뺀 것 · 못 읽는 것 · 크레딧 어림) → 읽기(묶음별 진행 · 크레딧 모자라면 멈춤) → 마무리(초안 + 히스토리)
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, FileText, FolderOpen, Presentation, Sheet } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../../state/session';
import { supabase, q, invoke, errorText } from '../../lib/supabase';
import { classify, estimate, fromDrop, fromInput, fromPicker, readAll, BATCH_CREDITS, type Picked, type ReadOutcome, type ReadProgress, type ScanFile, type ScanResult } from '../../lib/folderScan';
import { cx } from '../../lib/format';
import { Button, ErrorBox } from '../ui';
import { AiIcon, CoreAI } from '../Brand';

type Phase = 'pick' | 'scanning' | 'review' | 'reading' | 'finishing' | 'done';
const KH_MAX = 5;   // 기준·가이드 문서는 노하우로도 (시작하기 무료 정리 안에서)

const iconOf = (n: string) => (/\.pptx$/i.test(n) ? Presentation : /\.(xlsx|csv)$/i.test(n) ? Sheet : FileText);
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '.');
const base = (p: string) => p.split('/').pop() ?? p;
const dir = (p: string) => p.split('/').slice(0, -1).join(' / ');

interface FolderInfo { at?: string; docs?: number; chapters?: number }
const folderOf = (settings: Record<string, unknown> | undefined): FolderInfo => (((settings?.onboarding ?? {}) as { folder?: FolderInfo }).folder ?? {});

/** 뒤에서 만드는 정리가 끝날 때까지 4초마다 확인 (최대 8분) */
async function waitJob(teamId: string, jobId: string) {
  const until = Date.now() + 8 * 60000;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data } = await supabase.from('teams').select('settings').eq('id', teamId).single();
    const job = (((data?.settings ?? {}) as { onboarding?: { job?: { id?: string; status?: string; error?: string } } }).onboarding?.job ?? {});
    if (job.id !== jobId) continue;
    if (job.status === 'failed') throw new Error(job.error ? `정리하지 못했습니다: ${job.error}` : '정리하지 못했습니다. 다시 시도해 주세요');
    if (job.status === 'done') return;
  }
  throw new Error('예상보다 오래 걸리고 있습니다. 잠시 뒤 시작하기를 다시 열면 결과를 이어서 확인할 수 있습니다');
}

export function FolderScan({ onNext }: { onNext: () => void }) {
  const { team, uid, credits, refresh } = useTeam();
  const qc = useQueryClient();
  const prevDone = folderOf(team.settings);
  const [phase, setPhase] = useState<Phase>(prevDone.at ? 'done' : 'pick');
  const [kh, setKh] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<ScanResult | null>(null);
  const [files, setFiles] = useState<ScanFile[]>([]);
  const [seen, setSeen] = useState<{ n: number; names: string[] }>({ n: 0, names: [] });
  const [prog, setProg] = useState<ReadProgress | null>(null);
  const [outcome, setOutcome] = useState<ReadOutcome | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef(false);
  const left = (credits?.monthly_remaining ?? 0) + (credits?.topup_remaining ?? 0);

  // 훑기 — 파일 이름이 빠르게 지나가는 화면 (폴더 고르기는 한 번에 다 들어오므로 1.6초 동안 보여 준다)
  const scan = async (picked: Picked[]) => {
    setErr(null);
    if (!picked.length) { setPhase('pick'); setErr('폴더에서 파일을 찾지 못했습니다. 다른 폴더를 골라 주세요'); return; }
    setPhase('scanning');
    const r = classify(picked);
    const steps = 24;
    for (let i = 1; i <= steps; i++) {
      const k = Math.round((picked.length * i) / steps);
      setSeen({ n: k, names: picked.slice(Math.max(0, k - 5), k).map((p) => p.path) });
      await new Promise((ok) => setTimeout(ok, 65));
    }
    setRes(r);
    setFiles(r.files);
    setPhase('review');
  };

  const chosen = useMemo(() => files.filter((f) => f.checked), [files]);
  const est = useMemo(() => estimate(chosen), [chosen]);
  const short = est.credits > left;
  /** 크레딧으로 읽을 수 있는 어림 문서 수 */
  const canRead = short ? Math.max(0, Math.floor((Math.floor(left / BATCH_CREDITS) / est.batches) * chosen.length)) : chosen.length;

  // 읽기를 마친 뒤 마무리에서 실패하면, 다시 누를 때 읽은 것을 그대로 쓰고 마무리만 다시 한다 (크레딧을 두 번 쓰지 않게)
  const jobRef = useRef<string | null>(null);
  const start = async () => {
    setErr(null); cancel.current = false;
    let out = outcome;
    try {
      if (!out?.read || !jobRef.current) {
        if (left < BATCH_CREDITS) throw new Error(`크레딧이 부족합니다 (묶음 하나에 ${BATCH_CREDITS}크레딧, 남음 ${left})`);
        jobRef.current = crypto.randomUUID();
        setPhase('reading');
        out = await readAll({ teamId: team.id, job: jobRef.current, files: chosen, credits: left, onProgress: setProg, cancelled: () => cancel.current });
        setOutcome(out);
        qc.invalidateQueries({ queryKey: ['credits'] });
        if (!out.read) throw new Error(out.stopped === 'credits' ? '크레딧이 부족해 문서를 읽지 못했습니다' : '읽은 문서가 없습니다. 다른 폴더를 골라 주세요');
        // 기준·가이드 문서는 노하우 카드로도 (뒤에서 · 한 번만)
        setKh(Math.min(KH_MAX, out.standard.length));
        for (const s of out.standard.slice(0, KH_MAX)) {
          try {
            const src = await q<{ id: string }>(supabase.from('knowhow_sources').insert({
              team_id: team.id, owner_id: uid, title: s.name.replace(/\.[^.]+$/, '').slice(0, 80), raw_text: s.text.slice(0, 100000), file_name: s.name, mime_type: null,
            }).select('id').single());
            void invoke('ai-ingest-knowhow', { source_id: src.id }).then(() => qc.invalidateQueries({ queryKey: ['knowhow-sources'] })).catch(() => {});
          } catch { /* 노하우는 덤 — 실패해도 초안은 계속 */ }
        }
      }
      setPhase('finishing');
      await invoke('ai-folder-scan', { action: 'finish', team_id: team.id, job: jobRef.current });
      await waitJob(team.id, jobRef.current!);
      refresh();
      qc.invalidateQueries({ queryKey: ['onboard-out', team.id] });
      setPhase('done');
    } catch (e) {
      setErr(errorText(e));
      setPhase('review');
    }
  };

  // 크롬 · 엣지는 폴더 읽기 창('파일 보기' 허용)으로, 그 밖의 브라우저는 폴더 선택 창으로
  const pick = async () => {
    setErr(null);
    try {
      const viaPicker = await fromPicker((n) => setSeen((x) => ({ ...x, n })), () => setPhase('scanning'));
      if (viaPicker === null) { input.current?.click(); return; }
      if (viaPicker.length) void scan(viaPicker); else setPhase('pick');
    } catch { setPhase('pick'); setErr('폴더를 읽지 못했습니다. 다시 골라 주세요'); }
  };

  // ---------- 고르기 전 ----------
  if (phase === 'pick') return (
    <Shell title="폴더 하나로 운영에 필요한 기초 정보를 한방에"
      desc={<>팀 관련 자료들을 한데 모은 폴더를 지정하면 팀 운영에 필요한 목표, 성과, 팀원관리, 업무 기준 등을 한번에 세팅합니다.</>}>
      <button type="button" onClick={pick}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false); setPhase('scanning');
          fromDrop(e.dataTransfer, (n) => setSeen((s) => ({ ...s, n }))).then(scan).catch(() => { setPhase('pick'); setErr('폴더를 읽지 못했습니다. 눌러서 골라 주세요'); });
        }}
        className={cx('w-full rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
          over ? 'border-indigo-400 bg-indigo-50/70' : 'border-indigo-200 bg-indigo-50/30 hover:border-indigo-300 hover:bg-indigo-50/60')}>
        <FolderOpen size={30} className="mx-auto text-indigo-600" />
        <div className="mt-3 text-base font-semibold text-slate-800">폴더를 끌어 놓거나 눌러서 고르세요</div>
        <div className="mt-1 text-xs text-slate-500">상위 폴더 하나면 하위 폴더까지 함께 봅니다 · 최대 5,000개 파일</div>
      </button>
      <input ref={input} type="file" multiple className="hidden" {...({ webkitdirectory: '' } as Record<string, string>)}
        onChange={(e) => { const p = fromInput(e.target.files); e.target.value = ''; void scan(p); }} />
      <ErrorBox error={err} />
      <Foot left="폴더가 없거나 나중에 하려면 건너뛰어도 됩니다 · 다음 단계에서 파일 몇 개만 올릴 수도 있습니다"
        right={<Button variant="ghost" onClick={onNext}>건너뛰기</Button>} />
    </Shell>
  );

  // ---------- 훑는 중 ----------
  if (phase === 'scanning') return (
    <Shell title="파일 목록을 확인하고 있습니다" desc="하위 폴더까지 어떤 파일이 있는지 보는 중입니다. 아직 아무것도 읽지 않습니다">
      <div className="rounded-2xl bg-slate-950 text-slate-300 p-6 sm:p-8 overflow-hidden relative" role="status" aria-live="polite">
        <div aria-hidden className="absolute -top-20 -right-16 w-64 h-64 rounded-full bg-indigo-600/25 blur-3xl" />
        <div className="relative flex items-baseline gap-2">
          <span className="text-4xl font-black text-white tabular-nums">{seen.n.toLocaleString()}</span>
          <span className="text-sm text-slate-400">개 파일</span>
        </div>
        <div className="relative mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full w-1/3 bg-gradient-to-r from-indigo-400 to-violet-400 rounded-full animate-[scan_1.1s_ease-in-out_infinite]" /></div>
        <ul className="relative mt-5 space-y-1.5 font-mono text-[12px] min-h-[110px]">
          {seen.names.map((n, i) => (
            <li key={`${n}-${i}`} className={cx('truncate', i === seen.names.length - 1 ? 'text-indigo-200' : 'text-slate-500')}>{n}</li>
          ))}
        </ul>
      </div>
      <style>{'@keyframes scan{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
    </Shell>
  );

  // ---------- 읽는 중 · 마무리 ----------
  if (phase === 'reading' || phase === 'finishing') {
    const total = prog?.total ?? chosen.length;
    const pct = phase === 'finishing' ? 100 : Math.round(((prog?.done ?? 0) / Math.max(1, total)) * 100);
    return (
      <Shell title={phase === 'reading' ? '폴더의 문서를 읽고 있습니다' : '읽은 내용으로 기반을 만들고 있습니다'}
        desc={phase === 'reading'
          ? <><CoreAI />가 중요한 문서부터 읽습니다. 문서 양에 따라 몇 분 걸리니 이 창을 닫지 말아 주세요.</>
          : <>읽은 문서의 요약으로 팀목표 초안과 핵심 업무 히스토리를 만듭니다. 1~2분 걸립니다.</>}>
        <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/70 p-6 sm:p-8" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-sm text-slate-700"><b className="text-2xl font-black text-slate-900 tabular-nums">{prog?.done ?? 0}</b> / {total}개 읽음</div>
            <div className="text-xs text-slate-500">묶음 {prog?.batches ?? 0}개 · {prog?.credits ?? 0}크레딧 사용</div>
          </div>
          <div className="mt-3 h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-indigo-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} /></div>
          {phase === 'reading' && prog?.current && <div className="mt-3 text-xs text-slate-500 truncate">읽는 중 · {prog.current}</div>}
          <ol className="mt-6 space-y-3.5">
            {[
              ['문서 읽고 요약 카드 만들기', phase === 'reading' ? 'on' : 'done'],
              ['목표 › 과제 › 할 일 초안', phase === 'finishing' ? 'on' : 'wait'],
              ['위에서 온 방침 · 임원 골라내기', phase === 'finishing' ? 'on' : 'wait'],
              ['지난 몇 년의 흐름 → 핵심 업무 히스토리', phase === 'finishing' ? 'on' : 'wait'],
            ].map(([t, s]) => (
              <li key={t} className="flex items-center gap-3">
                {s === 'done' ? <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0"><Check size={13} /></span>
                  : s === 'on' ? <span className="w-6 h-6 rounded-full border-[3px] border-indigo-200 border-t-indigo-600 animate-spin shrink-0" />
                  : <span className="w-6 h-6 rounded-full border-2 border-slate-200 shrink-0" />}
                <span className={cx('text-[15px]', s === 'done' ? 'text-slate-500' : s === 'on' ? 'text-slate-900 font-semibold' : 'text-slate-400')}>{t}</span>
              </li>
            ))}
          </ol>
          {outcome?.stopped === 'credits' && <p className="mt-5 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">크레딧을 모두 써서 중요한 문서 {outcome.read}개까지 읽고 멈췄습니다. 읽은 것으로 초안을 만듭니다.</p>}
        </div>
        <Foot left={phase === 'reading' ? '멈추면 그때까지 읽은 문서로 초안을 만듭니다' : '초안이 나오면 바로 이 화면에서 확인합니다'}
          right={phase === 'reading' ? <Button variant="ghost" onClick={() => { cancel.current = true; }}>여기까지 읽고 마무리</Button> : null} />
      </Shell>
    );
  }

  // ---------- 정리 끝 ----------
  if (phase === 'done') {
    const f = folderOf(team.settings);
    const docs = outcome?.read ?? f.docs ?? 0;
    const rows: [string, ReactNode, string][] = [
      ['읽은 문서', <><b>{docs}개</b></>, '고르신 파일 가운데 글을 읽을 수 있었던 것'],
      ['팀목표 초안', <b>준비됨</b>, '다음 단계에서 확인하고 반영할 것만 고릅니다'],
      ['핵심 업무 히스토리', f.chapters ? <><b>지난 흐름 {f.chapters}장</b></> : <span className="text-slate-500">찾은 흐름 없음</span>, '히스토리 관리 › 핵심 업무에서 연도별로 이어서 정리됩니다'],
      ...(kh ? [['업무 기준 · 노하우', <b key="k">{kh}건</b>, '가이드 · 체크리스트 문서를 노하우 카드로 정리합니다'] as [string, ReactNode, string]] : []),
    ];
    return (
      <Shell title="팀 자료를 정리했습니다" desc={<><CoreAI />가 읽은 내용으로 팀 운영의 기반을 만들어 두었습니다. 반영 여부는 다음 단계에서 팀장님이 정합니다.</>}>
        <ul className="rounded-2xl ring-1 ring-slate-200 divide-y divide-slate-100 overflow-hidden">
          {rows.map(([t, v, d]) => (
            <li key={t} className="flex items-start gap-3 px-5 py-4">
              <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5"><Check size={13} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-slate-900">{t}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{d}</span>
              </span>
              <span className="text-sm text-slate-800 shrink-0">{v}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-500">파일 원본은 저장하지 않았습니다. 읽은 문서의 요약만 팀장님 전용으로 남아 있습니다.</p>
        <Foot left={null}
          right={<>
            <Button variant="ghost" onClick={() => { setOutcome(null); setRes(null); jobRef.current = null; setPhase('pick'); }}>다른 폴더로 다시</Button>
            <Button onClick={onNext}>팀목표 초안 확인<ArrowRight size={15} /></Button>
          </>} />
      </Shell>
    );
  }

  // ---------- 고르기 ----------
  const r = res!;
  const normal = files.filter((f) => !f.sensitive);
  const sens = files.filter((f) => f.sensitive);
  const toggle = (path: string) => setFiles((fs) => fs.map((f) => (f.path === path ? { ...f, checked: !f.checked } : f)));
  const setAll = (on: boolean) => setFiles((fs) => fs.map((f) => (f.sensitive ? f : { ...f, checked: on })));
  return (
    <Shell title={`파일 ${r.total.toLocaleString()}개를 찾았습니다`} onBack={() => { setPhase('pick'); setRes(null); }} backLabel="다른 폴더"
      desc={<>중요해 보이는 순서로 정리했습니다. 읽을 문서를 확인하고 시작하세요. 체크를 풀면 그 문서는 읽지 않습니다.</>}>
      <div className="flex flex-wrap gap-2">
        <Stat n={normal.filter((f) => f.checked).length} t="읽을 문서" tone="indigo" />
        <Stat n={sens.length} t="개인 정보로 보여 뺌" tone="amber" />
        <Stat n={r.unreadable.length} t="못 읽는 파일" />
        <Stat n={r.images} t="사진 · 캡처 (읽지 않음)" />
        {!!r.dupes && <Stat n={r.dupes} t="옛 버전 (최신만)" />}
      </div>

      <div className={cx('mt-4 rounded-xl px-4 py-3 text-sm ring-1', short ? 'bg-amber-50 ring-amber-200 text-amber-900' : 'bg-indigo-50/60 ring-indigo-100 text-slate-700')}>
        <div className="font-semibold">
          문서 {chosen.length}개 · 약 {est.credits}크레딧 <span className="font-normal text-slate-500">(남은 크레딧 {left})</span>
        </div>
        <div className="mt-0.5 text-xs leading-relaxed">
          {short
            ? <>남은 크레딧으로 다 읽지 못할 수 있습니다. 중요한 순서대로 읽다가 크레딧이 떨어지면 멈추고(어림으로 {canRead}개 이상), 남은 크레딧을 모두 씁니다. 읽은 것으로 초안 · 히스토리를 만듭니다.</>
            : <>문서를 5만 자 안팎 묶음으로 읽고 묶음마다 {BATCH_CREDITS}크레딧을 씁니다. 실제로는 글 양에 따라 달라지고, 모자라면 거기서 멈춥니다.</>}
          {' '}초안 · 히스토리 정리는 크레딧을 쓰지 않습니다.
        </div>
      </div>

      <div className="mt-4 rounded-2xl ring-1 ring-slate-200 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs">
          <span className="font-semibold text-slate-700">읽을 문서</span>
          <span className="text-slate-400">중요한 순</span>
          <button type="button" className="ml-auto text-indigo-700 hover:underline" onClick={() => setAll(true)}>모두 고르기</button>
          <span className="text-slate-300">·</span>
          <button type="button" className="text-slate-500 hover:underline" onClick={() => setAll(false)}>모두 풀기</button>
        </div>
        <FileList files={normal} onToggle={toggle} />
      </div>

      {!!sens.length && (
        <Fold title={`개인 정보로 보여 뺀 파일 ${sens.length}개`} note="급여 · 평가 · 이력서 같은 이름의 파일입니다. 업무 문서라면 체크해서 넣을 수 있습니다">
          <FileList files={sens} onToggle={toggle} />
        </Fold>
      )}
      {!!r.unreadable.length && (
        <Fold title={`읽지 못하는 파일 ${r.unreadable.length}개`} note="한글(.hwp)은 PDF로, 예전 형식(.doc · .xls · .ppt)은 새 형식으로 저장하면 아래 '자료 올리기'로 넣을 수 있습니다">
          <ul className="divide-y divide-slate-100">
            {r.unreadable.slice(0, 200).map((u) => (
              <li key={u.path} className="flex items-center gap-2 px-4 py-2 text-xs">
                <span className="truncate text-slate-600">{u.path}</span>
                <span className="ml-auto shrink-0 rounded bg-slate-100 text-slate-500 px-1.5 py-0.5">{u.why}</span>
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {outcome?.failed.length ? <p className="mt-3 text-xs text-slate-500">열지 못한 문서 {outcome.failed.length}개 · {outcome.failed.slice(0, 3).map((f) => base(f.path)).join(' · ')}</p> : null}
      <div className="mt-3"><ErrorBox error={err} /></div>
      <Foot left="파일 원본은 올리지 않습니다 · 개인 평가 · 급여 내용은 옮기지 않습니다"
        right={outcome?.read
          ? <Button onClick={start}><AiIcon size={16} />읽은 {outcome.read}개로 다시 마무리</Button>
          : <Button onClick={start} disabled={!chosen.length}><AiIcon size={16} />{chosen.length}개 읽고 초안 만들기</Button>} />
    </Shell>
  );
}

function FileList({ files, onToggle }: { files: ScanFile[]; onToggle: (path: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? files : files.slice(0, 40);
  return (
    <>
      <ul className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">
        {shown.map((f) => {
          const I = iconOf(f.file.name);
          return (
            <li key={f.path}>
              <label className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" className="accent-indigo-600 shrink-0" checked={f.checked} onChange={() => onToggle(f.path)} />
                <I size={15} className={cx('shrink-0', f.checked ? 'text-indigo-600' : 'text-slate-300')} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block truncate text-sm', f.checked ? 'text-slate-800' : 'text-slate-400')}>{f.file.name}</span>
                  {dir(f.path) && <span className="block truncate text-[11px] text-slate-400">{dir(f.path)}</span>}
                </span>
                {f.reason && <span className="hidden sm:inline shrink-0 text-[11px] rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5">{f.reason}</span>}
                <span className="shrink-0 text-[11px] text-slate-400 tabular-nums">{ymd(f.file.lastModified)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {files.length > 40 && !all && (
        <button type="button" onClick={() => setAll(true)} className="w-full border-t border-slate-100 py-2 text-xs text-slate-500 hover:text-indigo-700">{files.length - 40}개 더 보기</button>
      )}
    </>
  );
}

function Fold({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-2xl ring-1 ring-slate-200 overflow-hidden">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-2.5 bg-slate-50 text-left text-xs">
        <span className="font-semibold text-slate-700">{title}</span>
        <ChevronDown size={14} className={cx('ml-auto text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && <><p className="px-4 py-2 text-[11px] text-slate-500 border-b border-slate-100">{note}</p>{children}</>}
    </div>
  );
}

function Stat({ n, t, tone }: { n: number; t: string; tone?: 'indigo' | 'amber' }) {
  return (
    <span className={cx('inline-flex items-baseline gap-1.5 rounded-xl px-3 py-2 ring-1',
      tone === 'indigo' ? 'bg-indigo-600 text-white ring-indigo-600' : tone === 'amber' ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white text-slate-700 ring-slate-200')}>
      <b className="text-lg font-black tabular-nums">{n.toLocaleString()}</b><span className="text-xs">{t}</span>
    </span>
  );
}

function Shell({ title, desc, onBack, backLabel = '이전', children }: { title: string; desc: ReactNode; onBack?: () => void; backLabel?: string; children: ReactNode }) {
  useEffect(() => { document.querySelector('[data-setup-scroll]')?.scrollTo({ top: 0 }); }, [title]);
  return (
    <section className="flex-1 flex flex-col">
      <div className="mb-5">
        {onBack && <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-700"><ArrowLeft size={13} />{backLabel}</button>}
        <h1 className="text-xl sm:text-[26px] font-bold tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{desc}</p>
      </div>
      {children}
    </section>
  );
}

function Foot({ left, right }: { left?: ReactNode; right: ReactNode }) {
  return (
    <><div className="h-6 shrink-0" /><div className="sticky bottom-0 mt-auto -mx-5 sm:-mx-10 px-5 sm:px-10 py-4 bg-white/95 backdrop-blur border-t border-slate-100 flex items-center gap-2 flex-wrap">
      {left && <span className="text-xs text-slate-500 min-w-0">{left}</span>}
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </div></>
  );
}
