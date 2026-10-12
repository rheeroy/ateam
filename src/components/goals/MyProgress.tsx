// 팀원의 '내 항목 진척' — 체크인과 팀원 홈에서 쓴다. 측정 방식마다 가장 빠른 입력 하나만.
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../../state/session';
import { supabase, errorText } from '../../lib/supabase';
import { buildTree, isOverdue, useItemMutations, useItems, type Node } from '../../lib/items';
import { cx, fmtShort } from '../../lib/format';
import { Card, CardHead, Pill, useToast } from '../ui';

export function MyProgress({ title = '내 목표·과제', limit = 8 }: { title?: string; limit?: number }) {
  const { team, uid } = useTeam();
  const items = useItems(team.id);
  const { update } = useItemMutations(team.id);
  const toast = useToast();
  const qc = useQueryClient();
  const logRecurring = useMutation({
    mutationFn: async (n: Node) => {
      const d = new Date();
      const period = n.recur === 'weekly'
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).toISOString().slice(0, 10)
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const { error } = await supabase.from('work_item_logs').upsert({ item_id: n.id, team_id: team.id, kind: 'recurring', period, done: true }, { onConflict: 'item_id,kind,period' });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items', team.id] }); toast('이번 기간 완료로 기록했습니다'); },
    onError: (e) => toast(errorText(e)),
  });
  const { byId } = buildTree(items.data ?? []);
  const mine = [...byId.values()]
    .filter((n) => n.owner_id === uid && ['active', 'blocked', 'proposed', 'changes_requested'].includes(n.status) && n.measure !== 'check')
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
    .slice(0, limit);
  if (!items.isLoading && !mine.length) return null;
  return (
    <Card>
      <CardHead title={title} right={<Link to="/my/goals" className="text-indigo-600">전체</Link>} />
      <ul className="divide-y divide-slate-100">
        {mine.map((n) => {
          const ro = n.status === 'proposed' || n.status === 'changes_requested';
          const checks = n.children.filter((c) => c.measure === 'check' && c.status !== 'dropped');
          return (
            <li key={n.id} className="px-5 py-3.5 text-sm">
              <div className="flex items-center gap-2">
                <Link to={`/my/goals?item=${n.id}`} className="flex-1 min-w-0 truncate font-medium hover:text-indigo-700">{n.title}</Link>
                {ro && <Pill tone={n.status === 'proposed' ? 'violet' : 'amber'}>{n.status === 'proposed' ? '검토 대기' : '수정 요청'}</Pill>}
                {n.due_date && <span className={cx('text-xs num', isOverdue(n) ? 'text-rose-600 font-semibold' : 'text-slate-400')}>{fmtShort(n.due_date)}</span>}
              </div>
              {!ro && (
                <div className="mt-2">
                  {n.measure === 'percent' && (
                    <div className="flex items-center gap-2">
                      <input type="range" min={0} max={100} step={5} defaultValue={n.progress} key={n.progress} aria-label={`${n.title} 진척률`} className="flex-1 accent-indigo-600"
                        onPointerUp={(e) => update.mutate({ id: n.id, patch: { progress: Number((e.target as HTMLInputElement).value) } })}
                        onKeyUp={(e) => update.mutate({ id: n.id, patch: { progress: Number((e.target as HTMLInputElement).value) } })} />
                      <span className="font-mono text-xs w-9 text-right">{n.progress}%</span>
                    </div>
                  )}
                  {n.measure === 'number' && (
                    <div className="flex items-center gap-2 text-xs">
                      <input type="number" defaultValue={n.num_current ?? ''} key={String(n.num_current)} disabled={!!n.metric_id} aria-label={`${n.title} 현재값`}
                        className="w-24 border border-slate-200 rounded px-2 py-1" onBlur={(e) => e.target.value !== String(n.num_current ?? '') && update.mutate({ id: n.id, patch: { num_current: e.target.value === '' ? null : Number(e.target.value) } })} />
                      <span className="text-slate-500">/ {n.num_target ?? '-'}{n.unit}</span><span className="ml-auto font-mono">{n.progress}%</span>
                    </div>
                  )}
                  {n.measure === 'recurring' && (
                    <button className="text-xs border border-slate-200 rounded-lg px-2.5 py-1 hover:border-indigo-300" onClick={() => logRecurring.mutate(n)}>
                      이번 {n.recur === 'weekly' ? '주' : '달'} 완료 · 준수 {n.progress}%</button>
                  )}
                  {n.measure === 'children' && (
                    checks.length ? (
                      <ul className="space-y-1">{checks.slice(0, 5).map((c) => (
                        <li key={c.id}><label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input type="checkbox" className="accent-indigo-600" checked={c.status === 'done'} disabled={c.owner_id !== uid || c.status === 'proposed'}
                            onChange={(e) => update.mutate({ id: c.id, patch: { status: e.target.checked ? 'done' : 'active' } })} />
                          <span className={cx(c.status === 'done' && 'line-through text-slate-400')}>{c.title}</span></label></li>
                      ))}</ul>
                    ) : <div className="text-xs text-slate-500">하위 항목 진척 {n.progress}%</div>
                  )}
                  <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer">
                    <input type="checkbox" className="accent-rose-500" checked={n.status === 'blocked'} onChange={(e) => update.mutate({ id: n.id, patch: { status: e.target.checked ? 'blocked' : 'active' } })} />
                    막혀 있음 (팀장에게 알림)</label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
