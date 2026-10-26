// 시작하기 — 새 팀장이 처음 한 번 거치는 3단계 (건너뛸 수 있음)
//   1. 자료 올리기 → Core AI가 팀목표 초안 + 상위 전략·방침(org_notes)·임원 기초정보 후보를 제안 (체크한 것만 반영)
//   2. 내 업무 기준·노하우 올리기 → 노하우 카드로 정리 (뒤에서 진행)
//   3. 팀원 초대
// 상태는 teams.settings.onboarding 에 둔다. 시작하기 안의 AI는 크레딧을 쓰지 않는다.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, BookOpen, Building2, Check, Copy, FileText, Image as ImageIcon, Link2, Plus, Presentation, Sheet, Target, Trash2, Upload, UserPlus, UserRound, X } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import { ACCEPT_ONBOARD, IMAGE_EXT, MAX_BYTES, extractText, safeName, shrinkImage } from '../lib/extract';
import { applyOps, useLevelNames, type PlanOp } from '../lib/items';
import { inviteNote, onboardingOf, saveInviteNote, saveOnboarding } from '../lib/onboarding';
import { PLAYBOOK } from '../lib/playbook';
import type { AiOutput, OrgNoteKind } from '../lib/types';
import { cx } from '../lib/format';
import { Button, ErrorBox, inputCls, useToast } from '../components/ui';
import { AiIcon, AteamAI, CoreAI, LogoBlock } from '../components/Brand';
import { ProvChip } from '../components/Prov';
import { ORG_KIND } from '../components/home/shared';

interface OrgCand { kind: string; title: string; body?: string; source?: string; event_date?: string | null; exec?: string }
interface ExecCand { name: string; title?: string; interests?: string }
interface OnboardOut { summary: string; ops: PlanOp[]; org?: OrgCand[]; execs?: ExecCand[]; onboarding?: boolean }

const MAX_FILES = 10;
const FREE_RUNS = 3;
const STEPS = [
  { n: 1, label: '팀목표 초안' },
  { n: 2, label: '업무 기준·노하우' },
  { n: 3, label: '팀원 초대' },
] as const;

const STEP_DESC: Record<1 | 2 | 3, string> = { 1: '자료로 목표 › 과제 › 할 일', 2: '팀장님 방식대로 일하는 기준', 3: '링크 하나로, 팀원은 무료' };
const STEP_ICON = { 1: Target, 2: BookOpen, 3: UserPlus } as const;

/** 앱 위에 크게 뜨는 팝업 — 왼쪽 진행 패널 + 오른쪽 작업 영역 (모바일은 전체 화면) */
export default function Setup() {
  const { team, refresh, profile } = useTeam();
  const [step, setStep] = useState<1 | 2 | 3>(() => onboardingOf(team.settings).step ?? 1);
  const [leaving, setLeaving] = useState(false);
  const [finishErr, setFinishErr] = useState<string | null>(null);
  const go = (n: 1 | 2 | 3) => { setStep(n); void saveOnboarding(team.id, { step: n }).catch(() => {}); };
  // 마치거나 건너뛰면 'done' — settings 가 바뀌면 팝업이 닫히고 뒤의 앱이 그대로 쓰인다
  const finish = async () => {
    setLeaving(true); setFinishErr(null);
    try { await saveOnboarding(team.id, { status: 'done' }); refresh(); } catch (e) { setFinishErr(errorText(e)); setLeaving(false); }
  };
  // 팝업이 떠 있는 동안 뒤 화면은 스크롤되지 않게
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);
  const first = (profile?.full_name ?? '').trim();

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-[3px] flex items-center justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="ATEAM 시작하기">
      <div className="w-full h-full sm:h-[min(880px,calc(100vh-48px))] max-w-[1120px] bg-white sm:rounded-3xl shadow-2xl overflow-hidden flex">
        {/* 왼쪽 — ATEAM AI 인사 + 진행 단계 */}
        <aside className="hidden md:flex w-[300px] shrink-0 relative flex-col bg-slate-950 text-white p-7 overflow-hidden">
          <div aria-hidden className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-violet-600/30 blur-3xl" />
          <div aria-hidden className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-indigo-600/25 blur-3xl" />
          <div className="relative flex items-center gap-2.5"><LogoBlock size={28} /><span className="font-black tracking-tight">ATEAM</span></div>
          <div className="relative mt-10">
            <div className="text-[11px] font-semibold tracking-widest text-violet-300">시작하기 · 약 5분</div>
            <p className="mt-3 text-[17px] font-semibold leading-relaxed">
              안녕하세요{first ? `, ${first} 팀장님` : ''}.<br />
              저는 <AteamAI supCls="text-violet-300" />입니다. {team.name}이 바로 쓸 수 있게 세 가지만 같이 정리해 볼게요.
            </p>
          </div>
          <ol className="relative mt-8 space-y-1" aria-label="시작하기 단계">
            {STEPS.map((st) => {
              const on = st.n === step, done = st.n < step;
              const I = done ? Check : STEP_ICON[st.n];
              return (
                <li key={st.n} className={cx('flex items-start gap-3 rounded-xl px-3 py-2.5', on && 'bg-white/[0.08] ring-1 ring-white/10')}>
                  <span className={cx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', on ? 'bg-violet-600 text-white' : done ? 'bg-violet-500/25 text-violet-200' : 'bg-white/10 text-slate-400')}><I size={15} /></span>
                  <span className="min-w-0">
                    <span className={cx('block text-sm font-semibold', on ? 'text-white' : done ? 'text-violet-200' : 'text-slate-400')}>{st.label}</span>
                    <span className="block text-xs text-slate-500">{STEP_DESC[st.n]}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={finish} disabled={leaving} className="relative mt-auto text-left text-sm text-slate-400 hover:text-white disabled:opacity-50">
            나중에 하고 바로 시작 →
          </button>
        </aside>

        {/* 오른쪽 — 단계 화면 */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="md:hidden flex items-center gap-3 px-5 py-3.5 border-b border-slate-100">
            <LogoBlock size={24} />
            <div className="flex gap-1.5">{STEPS.map((st) => <span key={st.n} className={cx('h-1.5 rounded-full', st.n === step ? 'w-7 bg-indigo-600' : st.n < step ? 'w-4 bg-indigo-300' : 'w-4 bg-slate-200')} />)}</div>
            <span className="text-xs text-slate-400">{step} / 3</span>
            <button type="button" onClick={finish} disabled={leaving} className="ml-auto text-xs text-slate-500">나중에 하기</button>
          </div>
          <div key={step} className="flex-1 overflow-y-auto px-5 sm:px-10 pt-7 sm:pt-9 flex flex-col">
            <div className="text-xs font-semibold text-indigo-600 mb-1.5">{step}단계 / 3</div>
            {finishErr && <div className="mb-4"><ErrorBox error={`시작하기를 마치지 못했습니다: ${finishErr}`} /></div>}
            {step === 1 && <StepPlan onNext={() => go(2)} />}
            {step === 2 && <StepKnowhow onBack={() => go(1)} onNext={() => go(3)} />}
            {step === 3 && <StepInvite onBack={() => go(2)} onFinish={finish} finishing={leaving} />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 공통 조각
// ---------------------------------------------------------------------
function StepHead({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl sm:text-[26px] font-bold tracking-tight">{title}</h1>
      <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{children}</p>
    </div>
  );
}

function StepFoot({ onBack, backLabel = '이전', left, right }: { onBack?: () => void; backLabel?: string; left?: ReactNode; right: ReactNode }) {
  return (
    <><div className="h-6 shrink-0" /><div className="sticky bottom-0 mt-auto -mx-5 sm:-mx-10 px-5 sm:px-10 py-4 bg-white/95 backdrop-blur border-t border-slate-100 flex items-center gap-2 flex-wrap">
      {onBack && <Button variant="ghost" onClick={onBack} aria-label={backLabel}><ArrowLeft size={15} /><span className="hidden sm:inline">{backLabel}</span></Button>}
      {left && <span className="text-xs text-slate-500 min-w-0">{left}</span>}
      <div className="ml-auto flex items-center gap-1 sm:gap-2 flex-wrap justify-end">{right}</div>
    </div></>
  );
}

const kindIcon = (name: string) => {
  const n = name.toLowerCase();
  if (IMAGE_EXT.test(n)) return ImageIcon;
  if (n.endsWith('.pptx')) return Presentation;
  if (n.endsWith('.xlsx') || n.endsWith('.csv')) return Sheet;
  return FileText;
};
const sizeLabel = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);

/** 여러 파일 고르기 — 끌어 놓기 · 클릭 */
function FileDrop({ files, onChange, disabled }: { files: File[]; onChange: (f: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const add = (list: FileList | null) => {
    if (!list) return;
    setErr(null);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) { setErr(`${f.name}: 20MB 이하 파일만 올릴 수 있습니다`); continue; }
      if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
      next.push(f);
    }
    if (next.length > MAX_FILES) setErr(`한 번에 ${MAX_FILES}개까지 올릴 수 있습니다`);
    onChange(next.slice(0, MAX_FILES));
  };
  return (
    <div>
      <button type="button" disabled={disabled} onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) add(e.dataTransfer.files); }}
        className={cx('w-full rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors disabled:opacity-60',
          over ? 'border-indigo-400 bg-indigo-50/60' : 'border-slate-300 bg-slate-50/60 hover:border-indigo-300 hover:bg-indigo-50/30')}>
        <Upload size={20} className="mx-auto text-indigo-600" />
        <div className="mt-2 text-sm font-semibold text-slate-800">파일을 끌어 놓거나 눌러서 고르세요</div>
        <div className="mt-1 text-xs text-slate-500">PDF · PPT · 엑셀 · 워드 · 이미지(사진·캡처) · 텍스트 — {MAX_FILES}개까지, 파일당 20MB</div>
      </button>
      <input ref={input} type="file" multiple accept={ACCEPT_ONBOARD} className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      <ErrorBox error={err} />
      {!!files.length && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {files.map((f, i) => {
            const I = kindIcon(f.name);
            return (
              <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 rounded-lg bg-white ring-1 ring-slate-200 pl-2 pr-1 py-1 text-xs max-w-full">
                <I size={13} className="text-slate-500 shrink-0" />
                <span className="truncate max-w-[220px] text-slate-700">{f.name}</span>
                <span className="text-slate-400 shrink-0">{sizeLabel(f.size)}</span>
                {!disabled && <button type="button" aria-label={`${f.name} 빼기`} onClick={() => onChange(files.filter((_, j) => j !== i))} className="p-0.5 rounded text-slate-400 hover:text-rose-600"><X size={12} /></button>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const RAW_LIMIT = 16 * 1024 * 1024;   // PDF·이미지 합계 (서버 한도와 같게)

/** 올리기 전에 파일을 읽어 둔다 — PDF·이미지는 원본(이미지는 줄인 JPEG), 나머지는 글로 */
interface Prepared { file: File; text: string; mime: string | null; blob: Blob | null }
async function prepare(f: File): Promise<Prepared> {
  const n = f.name.toLowerCase();
  if (IMAGE_EXT.test(n)) return { file: f, text: '', mime: 'image/jpeg', blob: await shrinkImage(f) };
  if (n.endsWith('.pdf')) return { file: f, text: '', mime: 'application/pdf', blob: f };
  const ex = await extractText(f);
  return { file: f, text: ex.text, mime: ex.mime, blob: null };
}

/** 원본을 스토리지에 올린다 (원본이 없는 문서는 노하우 보관용으로 파일 그대로) */
async function uploadBlob(teamId: string, p: Prepared, prefix: string): Promise<{ path: string; mime: string }> {
  const img = p.mime === 'image/jpeg' && IMAGE_EXT.test(p.file.name);
  const blob = p.blob ?? p.file;
  const mime = p.blob ? (p.mime ?? 'application/pdf') : (p.file.type || 'application/octet-stream');
  const name = img ? safeName(p.file.name).replace(/\.[^.]+$/, '') + '.jpg' : safeName(p.file.name);
  const path = `${teamId}/${prefix}-${crypto.randomUUID()}-${name}`;
  const { error } = await supabase.storage.from('knowhow').upload(path, blob, { contentType: mime });
  if (error) throw error;
  return { path, mime };
}

// ---------------------------------------------------------------------
// 1단계 — 자료 → 팀목표 초안 + 위에서 온 것 + 임원
// ---------------------------------------------------------------------
const RUN_MSGS = ['자료를 올리는 중…', '자료를 읽는 중…', '목표 › 과제 › 할 일로 구조화하는 중…', '위에서 내려온 방침·요청·일정을 골라내는 중…', '초안을 다듬는 중…'];

function StepPlan({ onNext }: { onNext: () => void }) {
  const { team } = useTeam();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<AiOutput<OnboardOut> | null>(null);
  const [redo, setRedo] = useState(false);

  // 이전에 만들어 두고 아직 반영하지 않은 초안이 있으면 이어서 검토
  const prev = useQuery({
    queryKey: ['onboard-out', team.id],
    queryFn: async () => q<AiOutput<OnboardOut>[]>(supabase.from('ai_outputs').select('*')
      .eq('team_id', team.id).eq('kind', 'plan_draft').eq('content->>onboarding', 'true').order('created_at', { ascending: false })),
  });
  const runs = prev.data?.length ?? 0;
  const applied = onboardingOf(team.settings).plan_applied;
  const latest = prev.data?.[0];
  const shown = out ?? (!redo && latest && latest.id !== applied ? latest : null);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setMsg((m) => Math.min(m + 1, RUN_MSGS.length - 1)), 9000);
    return () => clearInterval(t);
  }, [busy]);

  const run = async () => {
    setBusy(true); setErr(null); setMsg(0);
    try {
      // 먼저 모든 파일을 읽어 본다 (중간에 실패하면 아무것도 올리지 않도록)
      const prepared = await Promise.all(files.map(prepare));
      const rawBytes = prepared.reduce((a, p) => a + (p.blob?.size ?? 0), 0);
      if (rawBytes > RAW_LIMIT) throw new Error(`PDF·이미지는 합쳐서 ${RAW_LIMIT / 1024 / 1024}MB까지 올릴 수 있습니다. 큰 PDF는 필요한 쪽만 남기거나 나눠 올려 주세요`);
      const texts = prepared.filter((p) => p.text.trim()).map((p) => `### ${p.file.name}\n${p.text}`);
      if (!prepared.some((p) => p.blob) && !texts.length && !text.trim()) throw new Error('자료를 올리거나 내용을 붙여 넣어 주세요');
      const raws: { path: string; mime: string; name: string }[] = [];
      for (const p of prepared) if (p.blob) raws.push({ ...(await uploadBlob(team.id, p, 'onboard')), name: p.file.name });
      setMsg(1);
      const r = await invoke<AiOutput<OnboardOut>>('ai-onboard', { team_id: team.id, text: [text.trim(), ...texts].filter(Boolean).join('\n\n'), files: raws });
      setOut(r); setRedo(false);
      void prev.refetch();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  if (shown) return <PlanReview out={shown} canRedo={runs < FREE_RUNS} onRedo={() => { setOut(null); setRedo(true); }} onNext={onNext} />;

  // 초안 만드는 중 — 입력 화면 대신 진행 화면으로 넘어간다
  if (busy) return (
    <section className="flex-1 flex flex-col">
      <StepHead title="자료를 읽고 초안을 만들고 있습니다">
        <CoreAI />가 {files.length ? `올린 자료 ${files.length}개${text.trim() ? '와 붙여 넣은 글을' : '를'}` : '붙여 넣은 글을'} 읽고 있습니다. 자료 양에 따라 1~2분 걸리니 이 창을 닫지 말아 주세요.
      </StepHead>
      <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/70 p-6 sm:p-8" role="status" aria-live="polite">
        <ol className="space-y-4">
          {RUN_MSGS.map((t, i) => {
            const done = i < msg, on = i === msg;
            return (
              <li key={t} className="flex items-center gap-3">
                {done ? <span className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0"><Check size={13} /></span>
                  : on ? <span className="w-6 h-6 rounded-full border-[3px] border-indigo-200 border-t-indigo-600 animate-spin shrink-0" />
                  : <span className="w-6 h-6 rounded-full border-2 border-slate-200 shrink-0" />}
                <span className={cx('text-[15px]', done ? 'text-slate-500' : on ? 'text-slate-900 font-semibold' : 'text-slate-400')}>{t.replace(/…$/, '')}</span>
              </li>
            );
          })}
        </ol>
        {!!files.length && (
          <ul className="mt-6 pt-5 border-t border-slate-200/70 flex flex-wrap gap-1.5">
            {files.map((f, i) => { const I = kindIcon(f.name); return <li key={i} className="inline-flex items-center gap-1 text-xs text-slate-500 bg-white ring-1 ring-slate-200 rounded-md px-2 py-0.5"><I size={12} />{f.name}</li>; })}
          </ul>
        )}
      </div>
      <StepFoot left="초안이 나오면 바로 이 화면에서 확인합니다" right={null} />
    </section>
  );

  const blocked = runs >= FREE_RUNS;
  return (
    <section className="flex-1 flex flex-col">
      <StepHead title="가지고 있는 자료로 팀목표 초안을 만듭니다">
        사업계획서, 업무 분장표, 회의록, 임원 보고 자료처럼 이미 있는 자료를 그대로 올려 주세요. 정리되지 않아도 괜찮습니다.
        {' '}<CoreAI />가 목표 › 과제 › 할 일 초안을 만들고, 위에서 내려온 방침·요청·일정은 임원 브리핑에 쓸 '상위 전략·방침'으로 따로 골라 둡니다.
      </StepHead>
      <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/70 p-5 sm:p-6 space-y-4">
        <FileDrop files={files} onChange={setFiles} />
        <div>
          <label className="text-xs font-semibold text-slate-600" htmlFor="ob-text">붙여 넣기 <span className="font-normal text-slate-400">(선택)</span></label>
          <textarea id="ob-text" rows={4} className={cx(inputCls, 'mt-1')} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="메일·메신저로 받은 방침, 회의 메모, 올해 하려는 일을 그대로 붙여 넣어도 됩니다" />
        </div>
        <ErrorBox error={err} />
      </div>
      <StepFoot
        left={blocked
          ? `시작하기에서는 초안을 ${FREE_RUNS}번까지 만들 수 있습니다. 팀목표 화면에서 이어서 다듬어 주세요`
          : `시작하기에서는 크레딧을 쓰지 않습니다${runs ? ` · ${FREE_RUNS - runs}번 남음` : ''}`}
        right={<>
          <Button variant="ghost" onClick={onNext}>건너뛰기</Button>
          <Button onClick={run} disabled={(!files.length && !text.trim()) || blocked}><AiIcon size={16} />초안 만들기<ArrowRight size={15} /></Button>
        </>} />
    </section>
  );
}

const ORG_KINDS = Object.keys(ORG_KIND) as OrgNoteKind[];
/** 실제로 있는 날짜만 (2026-02-30 같은 값은 DB에서 거부되므로 빼 둔다) */
const isDate = (d?: string | null) => {
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

function PlanReview({ out, canRedo, onRedo, onNext }: { out: AiOutput<OnboardOut>; canRedo: boolean; onRedo: () => void; onNext: () => void }) {
  const { team, members, refresh } = useTeam();
  const levelName = useLevelNames();
  const qc = useQueryClient();
  const toast = useToast();
  const ops = useMemo(() => (out.content.ops ?? []).filter((o) => o.op === 'add'), [out]);
  const org = out.content.org ?? [];
  const execs = out.content.execs ?? [];
  const [selOps, setSelOps] = useState(() => new Set(ops.map((_, i) => i)));
  const [selOrg, setSelOrg] = useState(() => new Set(org.map((_, i) => i)));
  const [selEx, setSelEx] = useState(() => new Set(execs.map((_, i) => i)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 다시 누를 때 이미 넣은 것을 또 넣지 않도록 단계별로 기억
  const done = useRef<{ ex?: Map<string, string>; exN?: number; org?: number; ops?: number; opsErr?: string[] }>({});

  const depthOf = (o: PlanOp, seen = 0): number => {
    if (!o.parent || seen > 5) return 0;
    const p = ops.find((x) => x.ref === o.parent);
    return p ? depthOf(p, seen + 1) + 1 : 0;
  };
  const toggle = (s: Set<number>, set: (n: Set<number>) => void, i: number) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); set(n); };

  const apply = async () => {
    setBusy(true); setErr(null);
    try {
      // 1) 임원 → 2) 위에서 온 것(임원과 연결) → 3) 목표·과제
      const d = done.current;
      if (!d.ex) {
        const exRows = execs.filter((_, i) => selEx.has(i)).map((e, i) => ({
          team_id: team.id, name: String(e.name ?? '').slice(0, 60) || '임원', title: String(e.title ?? '').slice(0, 60), interests: String(e.interests ?? '').slice(0, 400), sort: i,
        }));
        const ids = new Map<string, string>();
        if (exRows.length) for (const m of await q<{ id: string; name: string }[]>(supabase.from('executives').insert(exRows).select('id, name'))) ids.set(m.name, m.id);
        d.ex = ids; d.exN = exRows.length;
      }
      if (d.org == null) {
        const orgRows = org.filter((_, i) => selOrg.has(i)).map((n) => ({
          team_id: team.id, kind: ORG_KINDS.includes(n.kind as OrgNoteKind) ? n.kind : 'other',
          title: String(n.title ?? '').slice(0, 120) || '위에서 온 것', body: String(n.body ?? '').slice(0, 1000), source: String(n.source ?? '').slice(0, 120),
          event_date: isDate(n.event_date) ? n.event_date : null, exec_id: (n.exec && d.ex?.get(n.exec)) || null,
        }));
        if (orgRows.length) await q(supabase.from('org_notes').insert(orgRows));
        d.org = orgRows.length;
      }
      if (d.ops == null) {
        const chosen = ops.filter((_, i) => selOps.has(i));
        const refs = new Set(chosen.map((o) => o.ref));
        const fixed = chosen.map((o) => (o.parent && !refs.has(o.parent) ? { ...o, parent: null } : o));
        d.opsErr = fixed.length ? await applyOps(team.id, fixed, members) : [];
        d.ops = fixed.length;
      }
      await saveOnboarding(team.id, { plan_applied: out.id, step: 2 });
      refresh();
      qc.invalidateQueries();
      if (d.opsErr?.length) toast(`일부 반영 실패: ${d.opsErr[0]}`);
      else if (d.ops || d.org || d.exN) toast(`팀목표 ${d.ops}건 · 상위 전략·방침 ${d.org}건 · 임원 기초정보 ${d.exN}명을 반영했습니다`);
      onNext();
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };

  const total = selOps.size + selOrg.size + selEx.size;
  return (
    <section className="flex-1 flex flex-col">
      <StepHead title="초안을 확인하고 반영할 것만 고르세요">
        체크한 것만 반영됩니다. 반영한 뒤에도 팀목표와 임원 브리핑에서 자유롭게 고칠 수 있습니다.
      </StepHead>
      <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/70 p-5 sm:p-6 space-y-6">
        <div className="flex items-start gap-2 text-sm text-slate-700">
          <ProvChip kind="ai" label="AI 제안" sources={out.sources} level={out.level} depth={out.depth} note="올린 자료에 있는 내용만 구조화했습니다. 없는 목표나 숫자는 만들지 않습니다." />
          <p className="flex-1 leading-relaxed">{out.content.summary}</p>
        </div>

        <ReviewBlock icon={<FileText size={15} />} title="팀목표 초안" count={ops.length} sel={selOps.size} empty="자료에서 목표·과제를 찾지 못했습니다."
          onAll={(on) => setSelOps(on ? new Set(ops.map((_, i) => i)) : new Set())}>
          <ul className="divide-y divide-slate-100">
            {ops.map((o, i) => {
              const d = depthOf(o);
              return (
                <li key={i} className="py-2 pr-2 flex gap-2.5 text-sm" style={{ paddingLeft: 8 + d * 18 }}>
                  <input type="checkbox" className="mt-[3px] self-start shrink-0 accent-indigo-600" checked={selOps.has(i)} onChange={() => toggle(selOps, setSelOps, i)} aria-label={`${o.title} 반영`} />
                  <div className="min-w-0 flex-1 leading-snug">
                    <div>
                      <span className={cx('text-[11px] mr-1.5', o.role === 'metric' ? 'text-indigo-600 font-semibold' : 'text-slate-400')}>{o.role === 'metric' ? '지표' : levelName(d)}</span>
                      <span className={cx(d === 0 ? 'font-semibold text-slate-900' : 'text-slate-800')}>{o.title}</span>
                      {o.num_target != null && <span className="ml-1.5 text-xs text-slate-500 whitespace-nowrap">목표 {o.num_target}{o.unit}</span>}
                      {!!o.stages?.length && <span className="ml-1.5 text-xs text-slate-400">{o.stages.join(' → ')}</span>}
                    </div>
                    {o.reason && <div className="text-[11px] text-slate-400 mt-0.5 truncate">{o.reason}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </ReviewBlock>

        <ReviewBlock icon={<Building2 size={15} />} title="상위 전략·방침" dest="임원 브리핑 · 대시보드 조직·전사" count={org.length} sel={selOrg.size}
          empty="자료에서 전사 방침·임원 요청·일정을 찾지 못했습니다. 나중에 임원 브리핑에서 직접 남길 수 있습니다."
          onAll={(on) => setSelOrg(on ? new Set(org.map((_, i) => i)) : new Set())}>
          <ul className="divide-y divide-slate-100">
            {org.map((n, i) => {
              const k = ORG_KIND[(ORG_KINDS.includes(n.kind as OrgNoteKind) ? n.kind : 'other') as OrgNoteKind];
              return (
                <li key={i} className="py-2.5 pl-2 pr-2 flex gap-2.5 text-sm">
                  <input type="checkbox" className="mt-[3px] self-start shrink-0 accent-indigo-600" checked={selOrg.has(i)} onChange={() => toggle(selOrg, setSelOrg, i)} aria-label={`${n.title} 반영`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cx('text-[10px] rounded px-1.5 py-0.5 shrink-0', k.cls)}>{k.label}</span>
                      <span className="font-medium text-slate-900">{n.title}</span>
                      {isDate(n.event_date) && <span className="text-xs text-slate-500 num">{n.event_date}</span>}
                    </div>
                    {n.body && <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{n.body}</p>}
                    {(n.source || n.exec) && <div className="text-[11px] text-slate-400 mt-0.5">{[n.exec, n.source].filter(Boolean).join(' · ')}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </ReviewBlock>

        <ReviewBlock icon={<UserRound size={15} />} title="임원 기초정보" dest="임원 브리핑" count={execs.length} sel={selEx.size}
          empty="자료에 나온 임원이 없습니다. 임원 브리핑에서 직접 추가할 수 있습니다."
          onAll={(on) => setSelEx(on ? new Set(execs.map((_, i) => i)) : new Set())}>
          <ul className="divide-y divide-slate-100">
            {execs.map((e, i) => (
              <li key={i} className="py-2.5 pl-2 pr-2 flex gap-2.5 text-sm">
                <input type="checkbox" className="mt-[3px] self-start shrink-0 accent-indigo-600" checked={selEx.has(i)} onChange={() => toggle(selEx, setSelEx, i)} aria-label={`${e.name} 반영`} />
                <div className="min-w-0 flex-1">
                  <span className="font-medium text-slate-900">{e.name}</span>{e.title && <span className="ml-1.5 text-xs text-slate-500">{e.title}</span>}
                  {e.interests && <p className="text-xs text-slate-600 mt-0.5">{e.interests}</p>}
                </div>
              </li>
            ))}
          </ul>
        </ReviewBlock>
        <ErrorBox error={err} />
      </div>
      <StepFoot
        onBack={canRedo ? onRedo : undefined} backLabel="자료 바꿔 다시 만들기"
        right={<>
          <Button variant="ghost" onClick={onNext} disabled={busy}><span className="sm:hidden">반영 안 함</span><span className="hidden sm:inline">반영하지 않고 다음</span></Button>
          <Button onClick={apply} loading={busy}>{total ? <><span className="sm:hidden">{total}건 반영</span><span className="hidden sm:inline">선택한 {total}건 반영하고 다음</span></> : '다음'}<ArrowRight size={15} /></Button>
        </>} />
    </section>
  );
}

function ReviewBlock({ icon, title, dest, count, sel, empty, onAll, children }: {
  icon: ReactNode; title: string; dest?: string; count: number; sel: number; empty: string; onAll: (on: boolean) => void; children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <span className="text-slate-500">{icon}</span>
        <span className="font-semibold text-sm whitespace-nowrap">{title}</span>
        <span className="text-xs text-slate-400 num">{count ? `${sel}/${count}` : '0'}</span>
        {dest && <span className="hidden sm:inline text-[11px] text-slate-400">→ {dest}</span>}
        {count > 0 && (
          <button type="button" onClick={() => onAll(sel < count)} className="ml-auto text-xs text-slate-500 hover:text-indigo-700 whitespace-nowrap">
            {sel < count ? '모두 선택' : '모두 해제'}
          </button>
        )}
      </div>
      {count ? children : <p className="pt-3 text-sm text-slate-500">{empty}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------
// 2단계 — 내 업무 기준·노하우
// ---------------------------------------------------------------------
const KH_EXAMPLES = ['평가 기준표', '보고서 양식', '회의 운영 원칙', '신입 온보딩 자료', '자주 하는 피드백', '의사결정 기준'];

function StepKnowhow({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setErr(null);
    const ids: string[] = [];
    const sent: File[] = [];
    try {
      // 먼저 모든 파일을 읽어 본다 — 읽을 수 없는 파일이 있으면 아무것도 올리지 않는다
      const prepared = await Promise.all(files.map(prepare));
      const make = async (title: string, raw: string, p: Prepared | null) => {
        const src = await q<{ id: string }>(supabase.from('knowhow_sources').insert({
          team_id: team.id, owner_id: uid, title: title.slice(0, 80), raw_text: raw.slice(0, 100000), file_name: p?.file.name ?? null, mime_type: p?.mime ?? null,
        }).select('id').single());
        if (p) {
          try {
            const up = await uploadBlob(team.id, p, src.id);
            await q(supabase.from('knowhow_sources').update({ file_path: up.path }).eq('id', src.id));
          } catch (e) {
            await supabase.from('knowhow_sources').delete().eq('id', src.id);   // 원본이 없는 빈 자료를 남기지 않는다
            throw e;
          }
          sent.push(p.file);
        }
        ids.push(src.id);
      };
      for (const p of prepared) await make(p.file.name, p.text, p);
      if (text.trim()) { await make(text.trim().split('\n')[0].slice(0, 40) || '내 업무 기준', text, null); setText(''); }
      toast(`자료 ${ids.length}건을 올렸습니다. 카드 정리는 뒤에서 이어집니다 — 노하우 라이브러리에서 확인하세요`);
      setFiles([]);
      onNext();
    } catch (e) {
      // 중간에 실패하면 이미 올린 것은 목록에서 빼고(다시 눌러도 겹치지 않게) 남은 것만 다시 올리게 한다
      setFiles((fs) => fs.filter((f) => !sent.includes(f)));
      setErr(`${errorText(e)}${ids.length ? ` — 앞의 ${ids.length}건은 올라갔습니다. 남은 것만 다시 올려 주세요` : ''}`);
    } finally {
      // 카드 정리는 뒤에서 — 기다리지 않고 진행 (실패하면 노하우 라이브러리에 '실패'로 남아 다시 돌릴 수 있다)
      for (const id of ids) {
        void invoke('ai-ingest-knowhow', { source_id: id })
          .then(() => { qc.invalidateQueries({ queryKey: ['knowhow-sources'] }); qc.invalidateQueries({ queryKey: ['knowhow-cards'] }); })
          .catch(() => {});
      }
      setBusy(false);
    }
  };

  return (
    <section className="flex-1 flex flex-col">
      <StepHead title="팀장님이 일하는 기준을 알려 주세요">
        평가 기준표, 보고서 양식, 일하는 원칙, 자주 하는 피드백을 올려 주세요. <CoreAI />가 카드로 정리해 결과물 검토 · 1on1 준비 · 보고 초안을 쓸 때 {PLAYBOOK}보다 먼저 적용합니다.
      </StepHead>
      <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/70 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {KH_EXAMPLES.map((x) => <span key={x} className="text-xs rounded-full bg-slate-100 text-slate-600 px-2.5 py-1">{x}</span>)}
        </div>
        <FileDrop files={files} onChange={setFiles} disabled={busy} />
        <div>
          <label className="text-xs font-semibold text-slate-600" htmlFor="kh-text">직접 적기 <span className="font-normal text-slate-400">(선택)</span></label>
          <textarea id="kh-text" rows={4} className={cx(inputCls, 'mt-1')} value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
            placeholder={'예) 보고서는 결론을 첫 줄에 쓴다.\n숫자에는 비교 기준(전월·목표)을 함께 적는다.'} />
        </div>
        <ErrorBox error={err} />
        <p className="text-xs text-slate-500">올린 자료는 노하우 라이브러리에 남고, 카드 정리에는 1~2분 걸립니다. 시작하기에서는 처음 10건까지 크레딧을 쓰지 않습니다.</p>
      </div>
      <StepFoot onBack={onBack} right={<>
        <Button variant="ghost" onClick={onNext} disabled={busy}>건너뛰기</Button>
        <Button onClick={submit} loading={busy} disabled={!files.length && !text.trim()}>올리고 다음<ArrowRight size={15} /></Button>
      </>} />
    </section>
  );
}

// ---------------------------------------------------------------------
// 3단계 — 팀원 초대
// ---------------------------------------------------------------------
interface Row { email: string; title: string; strength: string; weak: string }
interface Made { email: string; link?: string; error?: string }

function StepInvite({ onBack, onFinish, finishing }: { onBack: () => void; onFinish: () => void; finishing: boolean }) {
  const { team } = useTeam();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([{ email: '', title: '', strength: '', weak: '' }, { email: '', title: '', strength: '', weak: '' }, { email: '', title: '', strength: '', weak: '' }]);
  const [made, setMade] = useState<Made[]>([]);
  const [busy, setBusy] = useState(false);
  const link = (t: string) => `${window.location.origin}/invite/${t}`;
  // 이전 단계에 다녀와도 이미 만든 초대가 보이도록 — 대기 중인 초대를 불러온다
  const pending = useQuery({
    queryKey: ['invites', team.id, 'setup'],
    queryFn: () => q<{ email: string; token: string; expires_at: string }[]>(supabase.from('invitations').select('email, token, expires_at')
      .eq('team_id', team.id).is('accepted_at', null).order('created_at', { ascending: true })),
  });
  useEffect(() => {
    if (!pending.data) return;
    setMade((m) => {
      const have = new Set(m.map((x) => x.email.toLowerCase()));
      return [...pending.data.filter((i) => !have.has(i.email.toLowerCase()) && new Date(i.expires_at) > new Date()).map((i) => ({ email: i.email, link: link(i.token) })), ...m];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.data]);
  const invited = new Set(made.filter((x) => x.link).map((x) => x.email.toLowerCase()));
  const valid = rows.filter((r) => /^\S+@\S+\.\S+$/.test(r.email.trim()) && !invited.has(r.email.trim().toLowerCase()));

  const create = async () => {
    setBusy(true);
    const res: Made[] = [];
    for (const r of valid) {
      try {
        const token = await q<string>(supabase.rpc('create_invitation', { p_team: team.id, p_email: r.email.trim(), p_job_title: r.title.trim() }));
        res.push({ email: r.email.trim(), link: link(token) });
        // 메모 저장이 실패해도 초대는 그대로 쓴다
        await saveInviteNote(team.id, token, inviteNote(r.strength, r.weak)).catch(() => toast(`${r.email.trim()}: 메모는 저장하지 못했습니다. 합류 후 팀원관리에서 남겨 주세요`));
      } catch (e) {
        const t = errorText(e);
        res.push({ email: r.email.trim(), error: t.includes('PLAN_LIMIT') ? '요금제 인원 한도를 넘었습니다' : t });
      }
    }
    setMade((m) => [...m.filter((x) => x.link || !res.some((r) => r.email === x.email)), ...res]);
    // 실패한 줄은 고쳐서 다시 보낼 수 있게 입력란에 남긴다
    const failed = rows.filter((r) => res.some((x) => x.error && x.email === r.email.trim()));
    setRows(failed.length ? failed : [{ email: '', title: '', strength: '', weak: '' }]);
    setBusy(false);
    const ok = res.filter((x) => x.link);
    if (ok.length) {
      navigator.clipboard?.writeText(ok.map((x) => `${x.email}  ${x.link}`).join('\n')).catch(() => {});
      toast(`초대 링크 ${ok.length}개를 만들어 복사했습니다. 메신저나 메일로 보내 주세요`);
    }
  };
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const okLinks = made.filter((x) => x.link);

  return (
    <section className="flex-1 flex flex-col">
      <StepHead title="팀원을 초대하세요">
        초대 링크를 만들어 메신저나 메일로 보내 주세요. 팀원이 초대한 메일 주소로 로그인하면 바로 합류합니다. 팀원은 무료이고, 링크는 14일 동안 유효합니다.
      </StepHead>
      <div className="rounded-2xl bg-slate-50/70 ring-1 ring-slate-200/70 p-5 sm:p-6 space-y-4">
        <div className="space-y-2.5">
          <p className="text-xs text-slate-500">강점·보완할 점은 선택입니다. 적어 두면 1on1 준비와 팀원관리 추천에 참고하며, <b className="font-semibold text-slate-700">팀원에게는 보이지 않습니다.</b></p>
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl bg-white ring-1 ring-slate-200 p-3 space-y-2">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)_2rem] gap-2 items-center">
                <input type="email" className={inputCls} value={r.email} onChange={(e) => set(i, 'email', e.target.value)} placeholder="member@company.com" aria-label={`${i + 1}번째 이메일`} />
                <input className={inputCls} value={r.title} onChange={(e) => set(i, 'title', e.target.value)} placeholder="직무 (예: 기획)" aria-label={`${i + 1}번째 직무`} />
                {rows.length > 1
                  ? <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="p-1.5 text-slate-400 hover:text-rose-600" aria-label="이 사람 빼기"><Trash2 size={14} /></button>
                  : <span />}
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <input className={inputCls} value={r.strength} onChange={(e) => set(i, 'strength', e.target.value)} placeholder="강점 (예: 기획 속도가 빠르고 꼼꼼함)" aria-label={`${i + 1}번째 강점`} />
                <input className={inputCls} value={r.weak} onChange={(e) => set(i, 'weak', e.target.value)} placeholder="보완할 점 (예: 숫자 근거가 약함)" aria-label={`${i + 1}번째 보완할 점`} />
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setRows([...rows, { email: '', title: '', strength: '', weak: '' }])} className="text-sm text-indigo-700 font-semibold inline-flex items-center gap-1"><Plus size={14} />한 명 더</button>
        </div>
        <Button onClick={create} loading={busy} disabled={!valid.length}><Link2 size={15} />{valid.length ? `초대 링크 ${valid.length}개 만들기` : '초대 링크 만들기'}</Button>

        {!!made.length && (
          <div className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <UserPlus size={14} className="text-indigo-600" /><span className="text-sm font-semibold">만든 초대 링크</span>
              {okLinks.length > 1 && (
                <button type="button" className="ml-auto text-xs text-indigo-700 font-semibold inline-flex items-center gap-1"
                  onClick={() => { void navigator.clipboard.writeText(okLinks.map((x) => `${x.email}  ${x.link}`).join('\n')); toast('모두 복사했습니다'); }}>
                  <Copy size={12} />모두 복사
                </button>
              )}
            </div>
            <ul className="space-y-1.5 text-xs">
              {made.map((m, i) => (
                <li key={i} className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-slate-700 shrink-0 max-w-[40%] truncate">{m.email}</span>
                  {m.link
                    ? <><span className="text-slate-500 truncate flex-1">{m.link}</span>
                      <button type="button" className="text-slate-400 hover:text-indigo-700 shrink-0" aria-label="링크 복사" onClick={() => { void navigator.clipboard.writeText(m.link!); toast('복사했습니다'); }}><Copy size={13} /></button></>
                    : <span className="text-rose-600 flex-1 truncate">{m.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <StepFoot onBack={onBack} right={
        <Button onClick={onFinish} loading={finishing}>{okLinks.length ? 'ATEAM 시작하기' : '건너뛰고 시작하기'}<ArrowRight size={15} /></Button>
      } />
    </section>
  );
}
