// 도움말 패널 — 화면 오른쪽에서 열리는 한 장짜리 가이드 (단계 넘김 없이 위에서 아래로 읽는다)
//   GuideLink: 페이지 위에 두는 'ⓘ ○○ 가이드' 링크. 처음 한 번만 작은 말풍선으로 알려 준다 (닫거나 열면 다시 안 뜸)
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Info, X } from 'lucide-react';
import { useTeam } from '../state/session';

const seenKey = (id: string, uid: string) => `ateam.guide.${id}.${uid}`;
function readSeen(keys: string[]) { try { return keys.some((k) => localStorage.getItem(k) === '1'); } catch { return true; } }
function writeSeen(key: string) { try { localStorage.setItem(key, '1'); } catch { /* 저장 못 해도 이번엔 닫힘 */ } }

export function GuidePanel({ open, onClose, title, icon, children, footer }: {
  open: boolean; onClose: () => void; title: ReactNode; icon?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[40]">
      <div className="absolute inset-0 bg-slate-900/20" onClick={onClose} />
      <aside role="dialog" aria-label="가이드" className="absolute inset-y-0 right-0 w-full sm:w-[440px] bg-white shadow-2xl flex flex-col">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <span className="text-[11px] font-semibold tracking-wide text-slate-400 inline-flex items-center gap-1"><BookOpen size={13} />가이드</span>
          <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">{icon}{title}</h2>
          <div className="mt-4 space-y-6">{children}</div>
        </div>
        {footer && <div className="px-6 py-3.5 border-t border-slate-100 flex items-center justify-end gap-2">{footer}</div>}
      </aside>
    </div>,
    document.body,
  );
}

export function GuideSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-[13px] font-bold text-slate-800 mb-2">{title}</h3>
      <div className="text-[13px] text-slate-600 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

/** 'ⓘ ○○ 가이드' 링크 + 처음 한 번 말풍선. legacyKeys: 예전에 닫은 기록(있으면 말풍선 안 띄움) */
export function GuideLink({ id, label, hint, onOpen, legacyKeys = [] }: { id: string; label: string; hint: string; onOpen: () => void; legacyKeys?: string[] }) {
  const { uid } = useTeam();
  const key = seenKey(id, uid);
  const [seen, setSeen] = useState(() => readSeen([key, ...legacyKeys]));
  const done = () => { setSeen(true); writeSeen(key); };
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={() => { done(); onOpen(); }}
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-800 px-1.5 py-0.5 rounded-md hover:bg-indigo-50">
        <Info size={15} />{label}
      </button>
      {!seen && (
        <span role="status" className="absolute top-full left-0 mt-2 z-20 w-[230px] rounded-xl bg-slate-900 text-white text-xs leading-relaxed px-3 py-2.5 shadow-lg">
          <span className="absolute -top-1.5 left-6 w-3 h-3 rotate-45 bg-slate-900" />
          <span className="relative flex items-start gap-2">
            <span className="flex-1">{hint}</span>
            <button type="button" onClick={done} className="text-slate-400 hover:text-white shrink-0" aria-label="알림 닫기"><X size={13} /></button>
          </span>
        </span>
      )}
    </span>
  );
}
