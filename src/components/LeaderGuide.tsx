import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { supabase, q } from '../lib/supabase';
import type { KnowhowCard } from '../lib/types';
import { Card } from './ui';

/** 팀장이 '팀원에게 공개'한 노하우 카드 (팀원 화면용) */
export function LeaderGuide({ teamId, kinds, title = '팀장 가이드' }: { teamId: string; kinds?: string[]; title?: string }) {
  const g = useQuery({
    queryKey: ['knowhow-shared', teamId],
    queryFn: () => q<KnowhowCard[]>(supabase.from('knowhow_cards').select('*').eq('team_id', teamId).eq('shared', true).eq('active', true).order('pinned', { ascending: false })),
  });
  const list = (g.data ?? []).filter((c) => !kinds || kinds.includes(c.kind));
  if (!list.length) return null;
  return (
    <Card className="p-5">
      <div className="font-semibold flex items-center gap-2"><BookOpen size={16} className="text-indigo-600" />{title}</div>
      <p className="text-xs text-slate-500 mt-1">팀장님이 공유한 기준입니다. AI 1차 검토도 이 기준으로 봅니다.</p>
      <ul className="mt-3 space-y-3 text-sm">
        {list.slice(0, 6).map((c) => (
          <li key={c.id}>
            <div className="font-medium">{c.title}</div>
            {c.rules.length > 0 ? (
              <ul className="mt-0.5 text-slate-600">{c.rules.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-indigo-500">›</span>{r}</li>)}</ul>
            ) : <p className="text-slate-600">{c.body}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
