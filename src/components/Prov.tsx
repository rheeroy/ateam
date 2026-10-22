// AI 출처 표시 체계: ✦ AI 생성 · Σ 모델 계산 · ✎ 팀장 수정 · ✓ 팀장 확정 · ◌ 판단 보류
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, BookOpen, CircleDashed, Library, PenLine, Sigma, Sparkles } from 'lucide-react';
import type { AiStatus, SourceRef } from '../lib/types';
import { cx } from '../lib/format';
import { PLAYBOOK, methodTitle } from '../lib/playbook';
import { AiMark, aiText } from './Brand';

/** 근거 중 '기준'(내 노하우 · ATEAM 플레이북)은 기록과 나눠 '적용한 기준'으로 보여 준다 */
const isMethod = (s: SourceRef | string) => typeof s !== 'string' && (s.type === 'knowhow' || s.type === 'consulting');

export type ProvKind = 'ai' | 'calc' | 'edited' | 'final' | 'hold';

const META: Record<ProvKind, { t: string; d: string; icon: typeof Sparkles; cls: string; iconCls: string }> = {
  ai: { t: 'AI 생성', d: 'AI가 아래 기록을 읽고 쓴 글입니다. 숫자를 지어내지 않습니다.', icon: Sparkles,
    cls: 'text-violet-700 bg-violet-50 border-violet-200 hover:border-violet-400', iconCls: 'text-violet-500' },
  calc: { t: '모델 계산', d: '통계·수식으로 계산한 값입니다. AI가 만든 숫자가 아닙니다.', icon: Sigma,
    cls: 'text-slate-700 bg-slate-50 border-slate-300 hover:border-slate-400', iconCls: 'text-slate-500' },
  edited: { t: 'AI 초안 · 팀장 수정', d: 'AI 초안을 팀장이 고쳤습니다. 원본은 따로 보관됩니다.', icon: PenLine,
    cls: 'text-slate-700 bg-white border-slate-300 hover:border-slate-400', iconCls: 'text-slate-700' },
  final: { t: '팀장 확정', d: '팀장이 확인하고 확정한 내용입니다. 이후 수정은 이력으로 남습니다.', icon: BadgeCheck,
    cls: 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:border-emerald-400', iconCls: 'text-emerald-600' },
  hold: { t: 'AI 판단 보류', d: '근거가 기준에 못 미쳐 AI가 판단하지 않았습니다.', icon: CircleDashed,
    cls: 'text-amber-800 bg-amber-50 border-amber-300 border-dashed hover:border-amber-500', iconCls: 'text-amber-600' },
};

export const kindFromStatus = (s: AiStatus): ProvKind =>
  s === 'draft' ? 'ai' : s === 'edited' ? 'edited' : s === 'final' ? 'final' : 'hold';

const DEPTH = ['', '얕음', '보통', '충분', '풍부'];

// ---------- 'AI 표시' 토글 ----------
const MarkCtx = createContext<{ on: boolean; toggle: () => void }>({ on: false, toggle: () => {} });
export function AiMarkProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  return <MarkCtx.Provider value={{ on, toggle: () => setOn((x) => !x) }}>{children}</MarkCtx.Provider>;
}
export const useAiMark = () => useContext(MarkCtx);

/** AI/모델이 만든 영역을 감싸면 'AI 표시'를 켰을 때 점선으로 드러난다 */
export function ProvBlock({ kind = 'ai', className, children, rail }: { kind?: 'ai' | 'calc'; className?: string; children: ReactNode; rail?: boolean }) {
  const { on } = useAiMark();
  return (
    <div data-prov={kind} className={cx('relative', rail && 'overflow-hidden', className,
      on && kind === 'ai' && 'outline outline-2 outline-dashed outline-violet-400 outline-offset-[3px] shadow-[0_0_0_7px_rgba(167,139,250,.14)]',
      on && kind === 'calc' && 'outline outline-2 outline-dashed outline-slate-400 outline-offset-[3px]')}>
      {rail && <span aria-hidden className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-violet-500 to-fuchsia-500" />}
      {children}
    </div>
  );
}

export function DepthBars({ depth, dark }: { depth: number; dark?: boolean }) {
  return (
    <span className="inline-flex gap-[2px] ml-0.5" aria-label={`데이터 깊이 ${DEPTH[depth] ?? ''}`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cx('w-[3px] h-[9px] rounded-[1px]', i <= depth ? (dark ? 'bg-slate-600' : 'bg-violet-600') : (dark ? 'bg-slate-200' : 'bg-violet-200'))} />
      ))}
    </span>
  );
}

interface ChipProps {
  kind: ProvKind;
  label?: string;
  sources?: (SourceRef | string)[];
  level?: string | null;
  depth?: number | null;
  note?: string;
  className?: string;
}

export function ProvChip({ kind, label, sources = [], level, depth, note, className }: ChipProps) {
  const m = META[kind];
  const Icon = m.icon;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const r = btn.current!.getBoundingClientRect();
    const W = 288, H = pop.current?.offsetHeight ?? 260;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
    let top = r.bottom + 8;
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - H - 8);
    setPos({ left, top });
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'mousedown' && (pop.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('scroll', close, { passive: true });
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('scroll', close);
    };
  }, [open]);

  const d = depth ?? 0;
  const dark = kind === 'calc' || kind === 'edited';
  return (
    <>
      <button ref={btn} type="button" data-chip
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((x) => !x); }}
        className={cx('inline-flex items-center gap-1 text-[11px] font-semibold leading-none border rounded-full px-2 py-[5px] whitespace-nowrap align-middle', m.cls, className)}
        title="출처 보기">
        {kind === 'ai' && /^AI(\s|$)/.test(label ?? m.t) ? <AiMark size={8} weight={3.2} className={m.iconCls} /> : <Icon size={12} className={m.iconCls} />}
        {kind === 'ai' ? (label ?? m.t).replace(/^AI\s*/, '') || null : aiText(label ?? m.t, 'mark')}
        {d > 0 && <DepthBars depth={d} dark={dark} />}
      </button>
      {open && (
        <div ref={pop} role="dialog" aria-label="이 내용의 출처" style={{ left: pos.left, top: pos.top }}
          className="fixed z-50 w-72 bg-white rounded-xl border border-slate-200 shadow-xl p-4 text-sm text-left font-normal">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">{aiText(m.t, 'mark')}</span>
            {level && <span className="font-mono text-[11px] font-bold text-violet-700 bg-violet-50 rounded px-1.5 py-0.5">{level}</span>}
          </div>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{aiText(m.d)}</p>
          {note && <p className="text-[13px] text-slate-700 mt-2 leading-relaxed">{aiText(note)}</p>}
          {(() => {
            const methods = sources.filter(isMethod) as SourceRef[];
            const records = sources.filter((s) => !isMethod(s));
            return (
              <>
                {records.length > 0 && (
                  <>
                    <div className="mt-3 text-[11px] font-semibold text-slate-400">근거 {records.length}건</div>
                    <ul className="mt-1 space-y-0.5 text-[13px] text-slate-700 max-h-40 overflow-y-auto">
                      {records.slice(0, 30).map((s, i) => (
                        <li key={i}>· {typeof s === 'string' ? s : s.label}</li>
                      ))}
                    </ul>
                  </>
                )}
                {methods.length > 0 && (
                  <>
                    <div className="mt-3 text-[11px] font-semibold text-slate-400">적용한 기준 {methods.length}개</div>
                    <ul className="mt-1 space-y-1 text-[13px] max-h-40 overflow-y-auto">
                      {methods.slice(0, 12).map((s, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          {s.type === 'consulting'
                            ? <Library size={13} className="mt-[3px] shrink-0 text-[#9A6A1F]" aria-label={PLAYBOOK} />
                            : <BookOpen size={13} className="mt-[3px] shrink-0 text-indigo-500" aria-label="내 노하우" />}
                          <span className="text-slate-700">{methodTitle(s.label)}<span className="ml-1 text-[11px] text-slate-400">{s.type === 'consulting' ? '플레이북' : '내 노하우'}</span></span>
                        </li>
                      ))}
                    </ul>
                    <Link to={methods.some((m) => m.type === 'consulting') ? '/knowhow?tab=playbook' : '/knowhow?tab=mine'} onClick={() => setOpen(false)}
                      className="mt-1.5 inline-block text-[11px] font-semibold text-slate-500 hover:text-slate-900">노하우 라이브러리에서 보기</Link>
                  </>
                )}
              </>
            );
          })()}
          {d > 0 && (
            <div className="mt-3 flex items-center justify-between text-xs">
              <span className="text-slate-500">데이터 깊이</span>
              <span className="inline-flex items-center gap-1.5"><DepthBars depth={d} /><span className="font-semibold text-slate-700">{DEPTH[d]}</span></span>
            </div>
          )}
          <Link to="/insight" onClick={() => setOpen(false)} className="mt-3 block text-center text-xs font-semibold text-violet-700 bg-violet-50 rounded-lg py-1.5">
            데이터가 쌓이면 무엇이 보이나 →
          </Link>
        </div>
      )}
    </>
  );
}

export function ProvLegend() {
  const { on } = useAiMark();
  if (!on) return null;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 flex-wrap justify-center bg-white/95 backdrop-blur border border-violet-200 shadow-lg rounded-full px-4 py-2 text-xs max-w-[calc(100%-2rem)]">
      <span className="font-semibold text-violet-700">출처 표시</span>
      {(Object.keys(META) as ProvKind[]).map((k) => {
        const m = META[k]; const Icon = m.icon;
        return <span key={k} className={cx('inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-1', m.cls)}>{k === 'ai' ? <AiMark size={8} weight={3.2} className={m.iconCls} /> : <Icon size={12} className={m.iconCls} />}{k === 'edited' ? '팀장 수정' : k === 'hold' ? '판단 보류' : k === 'ai' ? '생성' : m.t}</span>;
      })}
    </div>
  );
}

/** AI 문장 속 [E3] 근거 태그를 작은 각주로 바꿔 보여 준다 (마우스를 올리면 근거 이름) */
export function TaggedText({ text, sources = [] }: { text: string; sources?: SourceRef[] }) {
  const parts = (text ?? '').split(/(\[E\d+(?:\s*,\s*E\d+)*\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[(E\d+(?:\s*,\s*E\d+)*)\]$/);
        if (!m) return <span key={i}>{p}</span>;
        const tags = m[1].split(/\s*,\s*/);
        const label = tags.map((t) => sources.find((s) => s.tag === t)?.label ?? t).join(' · ');
        return (
          <sup key={i} title={label} className="ml-0.5 font-mono text-[10px] text-violet-600 cursor-help">
            {tags.map((t) => t.replace('E', '')).join(',')}
          </sup>
        );
      })}
    </>
  );
}
