// 알림 종 (요청·검토 요청·피드백·결과물)
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useSession } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { AppNotification } from '../lib/types';
import { cx, daysAgo, fmtShort } from '../lib/format';

export function Notifications() {
  const { session, team, isLeader } = useSession();
  const uid = session?.user.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const list = useQuery({
    queryKey: ['notifications', uid, team?.id], enabled: !!uid, refetchInterval: 60_000,
    queryFn: () => q<AppNotification[]>(supabase.from('notifications').select('*').eq('user_id', uid!).order('created_at', { ascending: false }).limit(30)),
  });
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const rows = (list.data ?? []).filter((n) => !team || !n.team_id || n.team_id === team.id);
  const unread = rows.filter((n) => !n.read_at).length;
  const go = async (n: AppNotification) => {
    setOpen(false);
    if (!n.read_at) { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id); qc.invalidateQueries({ queryKey: ['notifications'] }); }
    // 팀원에게 온 팀장 요청 알림은 예전 링크가 '/'(업무플랫폼) — 받은 곳(팀장님과)으로
    const link = !isLeader && n.link === '/' && /^(request|praise|coaching)/.test(n.kind) ? '/my/one-on-ones' : n.link;
    if (link) nav(link);
  };
  const readAll = async () => {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', uid!).is('read_at', null);
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((x) => !x)} className="relative p-1.5 rounded-lg text-slate-500 hover:bg-slate-100" aria-label={`알림 ${unread}건`}>
        <Bell size={18} />
        {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-lg z-30 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between text-sm">
            <span className="font-semibold">알림</span>
            {unread > 0 && <button className="text-xs text-indigo-600" onClick={readAll}>모두 읽음</button>}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {!rows.length && <li className="px-4 py-6 text-sm text-slate-500 text-center">새 알림이 없습니다</li>}
            {rows.map((n) => (
              <li key={n.id}>
                <button onClick={() => go(n)} className={cx('w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-50', !n.read_at && 'bg-indigo-50/40')}>
                  <div className="flex items-start gap-2">
                    {!n.read_at && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{n.title}</div>
                      {n.body && <div className="text-xs text-slate-500 truncate">{n.body}</div>}
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">{daysAgo(n.created_at) === 0 ? '오늘' : fmtShort(n.created_at)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
