import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import { errorText } from '../lib/supabase';
import { cx, initial } from '../lib/format';

// ---------- Button ----------
type Variant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
const V: Record<Variant, string> = {
  primary: 'text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300',
  secondary: 'text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:text-slate-400',
  soft: 'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:text-indigo-300',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'text-rose-700 bg-rose-50 hover:bg-rose-100',
};
export function Button({ variant = 'primary', size = 'md', loading, className, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-colors disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3.5 py-2',
        V[variant], className,
      )}
    >
      {loading && <Loader2 className="animate-spin" size={14} />}
      {children}
    </button>
  );
}

// ---------- Card ----------
export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx('bg-white rounded-2xl border border-slate-200', className)}>{children}</div>;
}
export function CardHead({ title, right, icon }: { title: ReactNode; right?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
      <h2 className="font-semibold inline-flex items-center gap-2">{icon}{title}</h2>
      {right && <div className="text-xs text-slate-500 flex items-center gap-2">{right}</div>}
    </div>
  );
}

export function PageHeader({ title, sub, right, back }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; back?: ReactNode }) {
  return (
    <div className="mb-6">
      {back}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {sub && <p className="text-sm text-slate-500 mt-1">{sub}</p>}
        </div>
        {right && <div className="flex gap-2 flex-wrap">{right}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
      <Loader2 className="animate-spin" size={16} />{label ?? '불러오는 중'}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="text-center py-10 px-6">
      {icon && <div className="mx-auto w-10 h-10 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center mb-3">{icon}</div>}
      <div className="font-semibold text-slate-800">{title}</div>
      {children && <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto leading-relaxed">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg bg-rose-50 text-rose-800 text-sm px-3 py-2">{errorText(error)}</div>;
}

export function Avatar({ name, tone = 'slate', size = 8 }: { name?: string | null; tone?: 'indigo' | 'slate' | 'rose' | 'amber'; size?: 7 | 8 | 9 }) {
  const tones = {
    indigo: 'bg-indigo-600 text-white', slate: 'bg-slate-700 text-white',
    rose: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-800',
  };
  const sz = { 7: 'w-7 h-7 text-xs', 8: 'w-8 h-8 text-xs', 9: 'w-9 h-9 text-sm' };
  return <span className={cx('rounded-full font-semibold flex items-center justify-center shrink-0', tones[tone], sz[size])}>{initial(name)}</span>;
}

export function Pill({ tone = 'slate', children, className }: { tone?: 'slate' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet'; children: ReactNode; className?: string }) {
  const t = {
    slate: 'bg-slate-100 text-slate-600', indigo: 'bg-indigo-50 text-indigo-700', emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800', rose: 'bg-rose-50 text-rose-700', violet: 'bg-violet-50 text-violet-700',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap', t[tone], className)}>{children}</span>;
}

export function Bar({ value, tone = 'indigo', h = 'h-1.5' }: { value: number; tone?: 'indigo' | 'violet' | 'slate' | 'amber' | 'emerald'; h?: string }) {
  const t = { indigo: 'bg-indigo-500', violet: 'bg-violet-500', slate: 'bg-slate-300', amber: 'bg-amber-500', emerald: 'bg-emerald-500' };
  return (
    <div className={cx('rounded-full bg-slate-100 overflow-hidden', h)}>
      <div className={cx('h-full rounded-full transition-all', t[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

// ---------- form ----------
export const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 bg-white';
export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      {hint && <span className="text-xs font-normal text-slate-400 ml-1.5">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

// ---------- Tabs ----------
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="flex gap-5 text-sm border-b border-slate-100 overflow-x-auto" role="tablist">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}
          className={cx('pb-2.5 border-b-2 -mb-px whitespace-nowrap inline-flex items-center gap-1.5',
            value === i.id ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-800')}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  // body 로 띄워서, 어두운 띠(AI 밴드·TOP PRIORITY) 안에서 열어도 글자색·정렬을 물려받지 않게
  return createPortal(
    <div className="fixed inset-0 z-50 bg-slate-900/40 text-slate-900 text-left font-normal flex items-start sm:items-center justify-center p-4 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" className={cx('bg-white rounded-2xl shadow-xl w-full my-8', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="font-semibold">{title}</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm rounded-lg px-4 py-2.5 shadow-lg z-[60] max-w-[calc(100%-2rem)]">{msg}</div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
