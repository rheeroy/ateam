import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Library, X } from 'lucide-react';
import { supabase, q } from '../lib/supabase';
import type { KnowhowCard } from '../lib/types';
import { Button, Card } from './ui';

function useSharedGuide(teamId: string, kinds?: string[]) {
  const g = useQuery({
    queryKey: ['knowhow-shared', teamId],
    queryFn: () => q<KnowhowCard[]>(supabase.from('knowhow_cards').select('*').eq('team_id', teamId).eq('shared', true).eq('active', true).order('pinned', { ascending: false })),
  });
  return (g.data ?? []).filter((c) => !kinds || kinds.includes(c.kind));
}

function GuideList({ list, max = 6 }: { list: KnowhowCard[]; max?: number }) {
  return (
    <ul className="space-y-3 text-sm">
      {list.slice(0, max).map((c) => (
        <li key={c.id}>
          <div className="font-medium">{c.title}{c.source === 'consulting' && <span className="ml-1.5 align-[1px] inline-flex items-center gap-0.5 rounded px-1 py-px text-[10px] font-semibold text-[#7D5414] bg-[#FAF1E1]"><Library size={10} />ATEAM Method™</span>}</div>
          {c.rules.length > 0 ? (
            <ul className="mt-0.5 text-slate-600">{c.rules.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-indigo-500">›</span>{r}</li>)}</ul>
          ) : <p className="text-slate-600 whitespace-pre-wrap">{c.body}</p>}
        </li>
      ))}
    </ul>
  );
}

/** 팀장이 '팀원에게 공개'한 노하우 카드 (팀원 화면용) */
export function LeaderGuide({ teamId, kinds, title = '팀장 가이드' }: { teamId: string; kinds?: string[]; title?: string }) {
  const list = useSharedGuide(teamId, kinds);
  if (!list.length) return null;
  return (
    <Card className="p-5">
      <div className="font-semibold flex items-center gap-2"><BookOpen size={16} className="text-indigo-600" />{title}</div>
      <p className="text-xs text-slate-500 mt-1">팀장님이 공유한 기준입니다.</p>
      <div className="mt-3"><GuideList list={list} /></div>
    </Card>
  );
}

/** [팀장 가이드] 버튼 — 누르면 오른쪽에서 열린다. 공유된 기준이 없으면 숨김 */
export function GuideButton({ teamId, kinds }: { teamId: string; kinds?: string[] }) {
  const list = useSharedGuide(teamId, kinds);
  const [open, setOpen] = useState(false);
  if (!list.length) return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><BookOpen size={14} />팀장 가이드</Button>
      {open && createPortal(
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/20" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 right-0 w-full sm:w-[400px] bg-white shadow-2xl border-l border-slate-200 flex flex-col" aria-label="팀장 가이드">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
              <BookOpen size={17} className="text-indigo-600" /><span className="font-semibold">팀장 가이드</span>
              <button onClick={() => setOpen(false)} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <p className="text-xs text-slate-500 mb-4">팀장님이 공유한 기준입니다. 올리기 전에 한 번 확인해 보세요.</p>
              <GuideList list={list} max={30} />
            </div>
          </aside>
        </div>, document.body)}
    </>
  );
}
