// 목표·과제: 팀장(/goals)과 팀원(/my/goals)이 같은 구조를 다른 권한으로 쓴다
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, ClipboardPaste, ListTree, Settings2, Sparkles, Table2 } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { TeamRequest, WorkItem } from '../lib/types';
import { buildTree, flatten, isOverdue, useItemMutations, useItems, useLevelNames, DEFAULT_LEVELS, type Node } from '../lib/items';
import { cx, fmtShort } from '../lib/format';
import { Button, Card, Empty, Field, Modal, PageHeader, Spinner, inputCls, useToast } from '../components/ui';
import { Outline } from '../components/goals/Outline';
import { TableView, PasteModal } from '../components/goals/TableView';
import { Timeline } from '../components/goals/Timeline';
import { ItemDetail } from '../components/goals/ItemDetail';
import { PlanDraftModal, PlanEditBar } from '../components/goals/PlanAI';

type View = 'outline' | 'table' | 'timeline';
type Filter = 'all' | 'mine' | 'proposed' | 'blocked' | 'overdue' | 'replan' | 'stale' | 'changes';

const FILTERS: { id: Filter; label: string; test: (n: WorkItem, uid: string) => boolean; leader?: boolean }[] = [
  { id: 'all', label: '전체', test: () => true },
  { id: 'mine', label: '내 담당', test: (n, u) => n.owner_id === u },
  { id: 'proposed', label: '검토 대기', test: (n) => n.status === 'proposed' },
  { id: 'changes', label: '수정 요청', test: (n) => n.status === 'changes_requested' },
  { id: 'blocked', label: '막힘', test: (n) => n.status === 'blocked' },
  { id: 'overdue', label: '기한 지남', test: (n) => isOverdue(n) },
  { id: 'replan', label: '계획 변경', test: (n) => n.replan_count > 0 },
  { id: 'stale', label: '2주 업데이트 없음', test: (n) => !!n.parent_id && ['active', 'blocked'].includes(n.status) && n.measure !== 'check' && Date.now() - Date.parse(n.updated_at) > 14 * 86400000 },
];

function LevelSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { team, refresh } = useTeam();
  const toast = useToast();
  const [levels, setLevels] = useState(((team.settings?.level_names as string[]) ?? DEFAULT_LEVELS).join(', '));
  const [free, setFree] = useState(!!team.settings?.member_free_edit);
  const save = async () => {
    const l = levels.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5);
    const { error } = await supabase.from('teams').update({ settings: { ...team.settings, level_names: l.length ? l : DEFAULT_LEVELS, member_free_edit: free } }).eq('id', team.id);
    if (error) toast(error.message); else { refresh(); toast('저장했습니다'); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="목표·과제 설정">
      <div className="space-y-4">
        <Field label="단계 이름" hint="쉼표로 구분, 위에서 아래로">
          <input className={inputCls} value={levels} onChange={(e) => setLevels(e.target.value)} placeholder="목표, 과제, 할 일" />
        </Field>
        <p className="text-xs text-slate-500 -mt-2">예) Objective, Key Result, 이니셔티브 / 본부과제, 세부과제, 실행 항목 — 회사에서 쓰는 말 그대로 쓰세요.</p>
        <label className="flex items-start gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" className="mt-1 accent-indigo-600" checked={free} onChange={(e) => setFree(e.target.checked)} />
          <span>팀원도 자유롭게 편집<span className="block text-xs text-slate-500">끄면(기본) 팀원이 만든 항목은 팀장 승인 후 진행됩니다. 켜면 승인 없이 바로 진행되고 위치도 옮길 수 있습니다.</span></span>
        </label>
        <Button className="w-full" onClick={save}>저장</Button>
      </div>
    </Modal>
  );
}

export default function Goals({ mode = 'leader' }: { mode?: 'leader' | 'member' }) {
  const { team, uid, isLeader, members } = useTeam();
  const levelName = useLevelNames();
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View) ?? 'outline';
  const filter = (params.get('filter') as Filter) ?? (mode === 'member' ? 'mine' : 'all');
  const openId = params.get('item');
  const setParam = (k: string, v: string | null) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }); };

  const items = useItems(team.id);
  const { update } = useItemMutations(team.id);
  const toast = useToast();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hideDone, setHideDone] = useState(false);
  const [owner, setOwner] = useState('');
  const [draft, setDraft] = useState<{ open: boolean; parent: string | null }>({ open: false, parent: null });
  const [paste, setPaste] = useState(false);
  const [settings, setSettings] = useState(false);
  const requests = useQuery({
    queryKey: ['requests', team.id, 'to', uid], enabled: mode === 'member',
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('to_id', uid).eq('status', 'open').eq('kind', 'plan')),
  });

  const { roots, byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  const free = !!team.settings?.member_free_edit;
  const canEditItem = (n: WorkItem) => isLeader || n.owner_id === uid;
  const canAddUnder = (p: Node | null) => isLeader || free || !p || p.owner_id === uid;
  const canStructure = isLeader || free;

  // 필터: 걸린 항목 + 그 위 단계(맥락) + (내 담당일 때) 그 아래
  const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
  const { rows, context } = useMemo(() => {
    const hit = new Set<string>(); const ctx = new Set<string>();
    for (const n of byId.values()) {
      if (hideDone && n.status === 'done') continue;
      if (owner && n.owner_id !== owner) continue;
      if (!f.test(n, uid)) continue;
      hit.add(n.id);
      n.path.forEach((p) => ctx.add(p));
      if (filter === 'mine') { const add = (x: Node) => x.children.forEach((c) => { hit.add(c.id); add(c); }); add(n); }
    }
    const show = (n: Node) => hit.has(n.id) || ctx.has(n.id);
    const all = filter === 'all' && !owner && !hideDone;
    return { rows: flatten(roots, collapsed, all ? undefined : show), context: all ? new Set<string>() : new Set([...ctx].filter((x) => !hit.has(x))) };
  }, [byId, roots, collapsed, filter, owner, hideDone, uid, f]);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = [...byId.values()];
  const count = (id: Filter) => all.filter((n) => (FILTERS.find((x) => x.id === id)!).test(n, uid)).length;
  const proposed = all.filter((n) => n.status === 'proposed');
  const open = openId ? byId.get(openId) : null;

  const approveAll = () => {
    if (!confirm(`검토 대기 ${proposed.length}건을 모두 승인할까요?`)) return;
    proposed.forEach((n) => update.mutate({ id: n.id, patch: { status: 'active' } }));
    toast(`${proposed.length}건을 승인했습니다`);
  };

  return (
    <section>
      <PageHeader title={mode === 'member' ? '내 목표·과제' : '목표·과제'}
        sub={mode === 'member' ? '팀장이 맡긴 목표 아래 내 계획을 세우고 진척을 남깁니다. 만든 계획은 팀장 검토 후 진행됩니다.' : `단계: ${[0, 1, 2].map(levelName).join(' › ')} · 팀원이 세운 계획을 검토하고 계획 대비를 봅니다`}
        right={<>
          <Button variant="soft" onClick={() => setDraft({ open: true, parent: mode === 'member' ? (requests.data?.[0]?.item_id ?? all.find((n) => n.owner_id === uid && !n.parent_id)?.id ?? null) : null })}><Sparkles size={15} />AI로 계획 만들기</Button>
          <Button variant="secondary" onClick={() => setPaste(true)}><ClipboardPaste size={15} />붙여 넣기</Button>
          {isLeader && <Button variant="ghost" onClick={() => setSettings(true)} aria-label="설정"><Settings2 size={15} /></Button>}
        </>} />

      {/* 팀원: 계획 요청 */}
      {mode === 'member' && !!requests.data?.length && (
        <div className="mb-4 space-y-2">
          {requests.data.map((r) => {
            const it = r.item_id ? byId.get(r.item_id) : null;
            return (
              <div key={r.id} className="rounded-xl bg-violet-50 border border-violet-100 px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0"><div className="font-semibold text-sm">팀장 요청 · {r.title}</div>
                  <div className="text-xs text-slate-600">{it ? `'${it.title}' 아래에 계획을 세워 주세요` : r.body}{r.due_date && ` · ${fmtShort(r.due_date)}까지`}</div></div>
                {it && <Button size="sm" onClick={() => setDraft({ open: true, parent: it.id })}><Sparkles size={13} />AI로 초안</Button>}
                {it && <Button size="sm" variant="secondary" onClick={() => setParam('item', it.id)}>직접 쓰기</Button>}
                <Button size="sm" variant="ghost" onClick={async () => { await supabase.from('team_requests').update({ status: 'done', response: '계획을 올렸습니다' }).eq('id', r.id); requests.refetch(); }}>완료</Button>
              </div>
            );
          })}
        </div>
      )}

      <PlanEditBar byId={byId} scopeId={null} />

      {/* 필터 */}
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5" role="tablist" aria-label="보기">
          {([['outline', '아웃라인', ListTree], ['table', '표', Table2], ['timeline', '타임라인', CalendarRange]] as const).map(([id, label, I]) => (
            <button key={id} role="tab" aria-selected={view === id} onClick={() => setParam('view', id === 'outline' ? null : id)}
              className={cx('text-xs px-2.5 py-1.5 rounded-md inline-flex items-center gap-1', view === id ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-600')}><I size={13} />{label}</button>
          ))}
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {FILTERS.filter((x) => x.id === 'all' || x.id === 'mine' || count(x.id) > 0).map((x) => (
            <button key={x.id} onClick={() => setParam('filter', x.id === (mode === 'member' ? 'mine' : 'all') ? null : x.id)}
              className={cx('text-xs rounded-full px-2.5 py-1 border whitespace-nowrap', filter === x.id ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 bg-white',
                x.id === 'proposed' && filter !== x.id && 'border-violet-300 text-violet-700')}>
              {x.label}{x.id !== 'all' && ` ${count(x.id)}`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-600">
          {isLeader && (
            <select aria-label="담당자" className="border border-slate-200 rounded-lg px-2 py-1 bg-white" value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">모든 담당자</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
            </select>
          )}
          <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" className="accent-indigo-600" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />완료 숨기기</label>
        </div>
      </div>
      {isLeader && filter === 'proposed' && proposed.length > 1 && (
        <div className="mt-3 rounded-xl bg-violet-50 px-4 py-2.5 text-sm flex items-center gap-3">팀원이 올린 계획 {proposed.length}건 — 하나씩 열어 피드백하거나 한꺼번에 승인할 수 있습니다.
          <Button size="sm" className="ml-auto" onClick={approveAll}>모두 승인</Button></div>
      )}

      <Card className="mt-3 overflow-hidden">
        {items.isLoading ? <Spinner /> : !all.length ? (
          <Empty title={mode === 'member' ? '아직 내 목표·과제가 없습니다' : '목표를 세워 보세요'}
            action={<div className="flex gap-2 justify-center flex-wrap">
              <Button onClick={() => setDraft({ open: true, parent: null })}><Sparkles size={14} />계획서로 AI 초안</Button>
              <Button variant="secondary" onClick={() => setPaste(true)}><ClipboardPaste size={14} />붙여 넣기</Button>
            </div>}>
            {mode === 'member' ? '팀장이 목표를 맡기면 여기에 뜹니다. 내 목표를 직접 올릴 수도 있습니다.' : '계획서나 업무 분장표를 넣으면 AI가 목표 › 과제 › 할 일 초안을 만듭니다. 한 줄씩 직접 써도 됩니다.'}
          </Empty>
        ) : view === 'table' ? <TableView rows={flatten(roots, new Set(), (n) => rows.some((r) => r.id === n.id))} onOpen={(id) => setParam('item', id)} canEditItem={canEditItem} />
          : view === 'timeline' ? <Timeline rows={rows} collapsed={collapsed} toggle={toggle} onOpen={(id) => setParam('item', id)} canEditItem={canEditItem} />
            : <Outline rows={rows} byId={byId} collapsed={collapsed} toggle={toggle} onOpen={(id) => setParam('item', id)}
              canEditItem={canEditItem} canAddUnder={canAddUnder} canStructure={canStructure} dim={(n) => context.has(n.id)} />}
      </Card>
      {view === 'outline' && !!all.length && <p className="mt-2 text-[11px] text-slate-400">제목을 눌러 바로 고칩니다 · Enter 다음 줄 · Tab 들여쓰기 · Shift+Tab 내어쓰기 · 왼쪽 손잡이로 끌어서 옮기기</p>}
      {view === 'timeline' && <p className="mt-2 text-[11px] text-slate-400">회색 선은 처음 계획(승인 시점)입니다 · 막대를 끌면 일정이 옮겨지고 변경 이력이 남습니다</p>}

      {open && <ItemDetail key={open.id} item={open} byId={byId} mode={mode} onClose={() => setParam('item', null)} onAiPlan={(pid) => setDraft({ open: true, parent: pid })} />}
      <PlanDraftModal open={draft.open} onClose={() => setDraft({ open: false, parent: null })} byId={byId} parentId={draft.parent} />
      <PasteModal open={paste} onClose={() => setPaste(false)} byId={byId} defaultParent={mode === 'member' ? (all.find((n) => n.owner_id === uid)?.id ?? null) : null} />
      {isLeader && <LevelSettings open={settings} onClose={() => setSettings(false)} />}
    </section>
  );
}
