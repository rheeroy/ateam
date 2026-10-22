// 목표·과제: 팀장(/goals)과 팀원(/my/goals)이 같은 구조를 다른 권한으로 쓴다
import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, ClipboardPaste, Crosshair, ListTree, Lock, LockOpen, Send, Settings2, Table2 } from 'lucide-react';
import { CheckinModal, PERF_TIP, PerfGuide } from '../components/checkin/Checkin';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { yearOf } from '../lib/plan';
import type { TeamRequest, WorkItem } from '../lib/types';
import { buildTree, flatten, isOverdue, useItemMutations, useItems, useLevelNames, usePlanRules, DEFAULT_LEVELS, type Node } from '../lib/items';
import { cx, fmtShort } from '../lib/format';
import { Button, Card, Empty, Field, Modal, PageHeader, Spinner, inputCls, useToast } from '../components/ui';
import { Outline } from '../components/goals/Outline';
import { TableView, PasteModal } from '../components/goals/TableView';
import { Timeline } from '../components/goals/Timeline';
import { ItemDetail } from '../components/goals/ItemDetail';
import { PlanDraftModal } from '../components/goals/PlanAI';
import { AiIcon, aiText } from '../components/Brand';

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
  const save = async () => {
    const l = levels.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 5);
    const { error } = await supabase.from('teams').update({ settings: { ...team.settings, level_names: l.length ? l : DEFAULT_LEVELS } }).eq('id', team.id);
    if (error) toast(error.message); else { refresh(); toast('저장했습니다'); onClose(); }
  };
  return (
    <Modal open={open} onClose={onClose} title="목표·과제 설정">
      <div className="space-y-4">
        <Field label="단계 이름" hint="쉼표로 구분, 위에서 아래로">
          <input className={inputCls} value={levels} onChange={(e) => setLevels(e.target.value)} placeholder="목표, 과제, 할 일" />
        </Field>
        <p className="text-xs text-slate-500 -mt-2">예) Objective, Key Result, 이니셔티브 / 본부과제, 세부과제, 실행 항목 — 회사에서 쓰는 말 그대로 쓰세요.</p>
        <p className="text-xs text-slate-500 rounded-lg bg-slate-50 px-3 py-2">팀원이 목표·과제를 고칠 수 있는지는 오른쪽 위 [팀원 목표수정] 토글로 켜고 끕니다. 할 일은 팀원이 자기 과제 아래에서 언제든 씁니다.</p>
        <Button className="w-full" onClick={save}>저장</Button>
      </div>
    </Modal>
  );
}

/** 팀원 수정 켜기·끄기 — 켜 두면 팀원이 목표·과제를 고치고, 고친 것은 승인 후 반영 */
function PlanToggle() {
  const { team, refresh } = useTeam();
  const { open } = usePlanRules();
  const qc = useQueryClient();
  const toast = useToast();
  const flip = useMutation({
    mutationFn: async () => {
      const cur = await q<{ settings: Record<string, unknown> }>(supabase.from('teams').select('settings').eq('id', team.id).single());
      return q(supabase.from('teams').update({ settings: { ...cur.settings, plan_open: !open } }).eq('id', team.id));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plan-window'] }); refresh(); toast(open ? '팀원 목표수정을 불가로 바꿨습니다' : '팀원 목표수정을 열었습니다. 팀원이 고친 목표·과제는 검토 대기로 올라옵니다.'); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <div className="flex items-start gap-2.5 text-right">
      <div className="leading-tight">
        <div className="text-sm font-semibold text-slate-800">팀원 목표수정 {open ? '가능' : '불가'}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">켜면 팀원들이 목표를 추가하거나 수정할 수 있습니다</div>
      </div>
      <button role="switch" aria-checked={open} aria-label="팀원 목표수정" disabled={flip.isPending} onClick={() => flip.mutate()}
        className={cx('relative mt-0.5 w-10 h-[22px] rounded-full transition-colors shrink-0 disabled:opacity-60', open ? 'bg-indigo-600' : 'bg-slate-300')}>
        <span className={cx('absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all', open ? 'left-[21px]' : 'left-[3px]')} />
      </button>
    </div>
  );
}

/** 팀장 → 팀원: 처음부터 목표·과제를 세워 달라고 요청 (특정 항목 없이도) */
function PlanRequestModal({ year, roots, onClose }: { year: number; roots: Node[]; onClose: () => void }) {
  const { team, uid, members, refresh } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const people = members.filter((m) => m.user_id !== uid);
  const [who, setWho] = useState<Set<string>>(new Set(people.map((m) => m.user_id)));
  const [parent, setParent] = useState('');
  const [title, setTitle] = useState(`${year}년 내 목표와 과제를 세워 주세요`);
  const [body, setBody] = useState('');
  const [due, setDue] = useState('');
  const send = useMutation({
    mutationFn: () => q(supabase.from('team_requests').insert([...who].map((to) => ({
      team_id: team.id, from_id: uid, to_id: to, kind: 'plan', item_id: parent || null, title: title.trim() || `${year}년 내 목표와 과제를 세워 주세요`, body, due_date: due || null,
    })))),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requests'] }); qc.invalidateQueries({ queryKey: ['plan-window'] }); refresh(); toast(`${who.size}명에게 계획 요청을 보냈습니다. 팀원 목표 수정도 켜졌습니다.`); onClose(); },
    onError: (e) => toast(errorText(e)),
  });
  const flip = (id: string) => setWho((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Modal open onClose={onClose} title={<span className="inline-flex items-center gap-2"><Send size={16} className="text-indigo-600" />팀원에게 계획 요청</span>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600 rounded-lg bg-slate-50 px-3 py-2">팀원이 자기 목표·과제를 직접 세우도록 요청합니다. 팀원이 올린 계획은 '검토 대기'에서 승인합니다. 보내면 팀원 목표 수정이 자동으로 켜집니다.</p>
        <Field label="받는 사람">
          <div className="flex flex-wrap gap-1.5">
            {people.map((m) => <button key={m.user_id} type="button" onClick={() => flip(m.user_id)}
              className={cx('text-xs rounded-full border px-2.5 py-1', who.has(m.user_id) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-500')}>{m.profiles?.full_name}</button>)}
          </div>
        </Field>
        <Field label="어디에 이어서" hint="선택 — 비우면 처음부터 내 목표로">
          <select className={inputCls} value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">처음부터 (팀원 본인 목표)</option>
            {roots.map((r) => <option key={r.id} value={r.id}>{r.title} 아래에</option>)}
          </select>
        </Field>
        <Field label="요청"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="덧붙일 말" hint="선택"><textarea rows={2} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="예) 팀 목표 3개 중 본인이 기여할 것 위주로, 과제는 분기별로 나눠 주세요" /></Field>
        <Field label="언제까지" hint="선택"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Button className="w-full" disabled={!who.size} loading={send.isPending} onClick={() => send.mutate()}>{who.size}명에게 보내기</Button>
      </div>
    </Modal>
  );
}

export default function Goals({ mode = 'leader' }: { mode?: 'leader' | 'member' }) {
  const { team, uid, isLeader, members, nameOf } = useTeam();
  const levelName = useLevelNames();
  const rules = usePlanRules();
  const qc = useQueryClient();
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
  const [ck, setCk] = useState(false);
  const [settings, setSettings] = useState(false);
  const [askPlan, setAskPlan] = useState(false);
  const [addRoot, setAddRoot] = useState(0);
  const nowYear = new Date().getFullYear();
  const year = Number(params.get('year') ?? nowYear);
  // 팀장: 팀원이 보낸 목표 변경 요청
  const changeReqs = useQuery({
    queryKey: ['requests', team.id, 'change', uid], enabled: isLeader && mode === 'leader',
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('to_id', uid).eq('status', 'open').eq('kind', 'change').order('created_at', { ascending: false })),
  });
  const closeChange = useMutation({
    mutationFn: (id: string) => q(supabase.from('team_requests').update({ status: 'done', response: '반영했습니다' }).eq('id', id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requests'] }); toast('처리함으로 표시했습니다. 팀원에게 알림이 갑니다.'); },
    onError: (e) => toast(errorText(e)),
  });
  const requests = useQuery({
    queryKey: ['requests', team.id, 'to', uid], enabled: mode === 'member',
    queryFn: () => q<TeamRequest[]>(supabase.from('team_requests').select('*').eq('team_id', team.id).eq('to_id', uid).eq('status', 'open').eq('kind', 'plan')),
  });

  const { roots: allRoots, byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  // 연도 판: 최상위 목표의 연도를 하위가 따른다 (올해·내년은 항상 고를 수 있다)
  const years = useMemo(() => [...new Set([...allRoots.map((r) => yearOf(r)), nowYear, nowYear + 1])].sort((a, b) => b - a), [allRoots, nowYear]);
  const roots = useMemo(() => allRoots.filter((r) => yearOf(r) === year), [allRoots, year]);
  const inYear = useMemo(() => new Set(roots.flatMap((r) => { const out: string[] = []; const walk = (n: Node) => { out.push(n.id); n.children.forEach(walk); }; walk(r); return out; })), [roots]);
  const rootDefaults = year !== nowYear ? { start_date: `${year}-01-01`, due_date: `${year}-12-31` } : undefined;
  const canEditItem = (n: WorkItem) => rules.canEditPlan(byId.get(n.id) ?? { ...n, depth: 0 });
  const canProgress = (n: WorkItem) => rules.canProgress(byId.get(n.id) ?? { ...n, depth: 0 });
  const canAddUnder = rules.canAddUnder;
  const canStructure = isLeader;

  // 필터: 걸린 항목 + 그 위 단계(맥락) + (내 담당일 때) 그 아래
  const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
  const { rows, context } = useMemo(() => {
    const hit = new Set<string>(); const ctx = new Set<string>();
    for (const n of byId.values()) {
      if (!inYear.has(n.id)) continue;
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
  }, [byId, roots, collapsed, filter, owner, hideDone, uid, f, inYear]);
  const toggle = (id: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = [...byId.values()].filter((n) => inYear.has(n.id));
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
      <PageHeader title={<span className="inline-flex items-center gap-2">{mode === 'member' ? '팀목표' : '팀목표 · 수정'}
          <select aria-label="연도" value={year} onChange={(e) => setParam('year', Number(e.target.value) === nowYear ? null : e.target.value)}
            className="text-base font-semibold rounded-lg border border-slate-200 bg-white px-2 py-0.5">
            {years.map((y) => <option key={y} value={y}>{y}년{y > nowYear ? ' (준비)' : y < nowYear ? ' (지난)' : ''}</option>)}
          </select></span>}
        back={mode === 'leader' ? (
          <div className="flex items-start justify-between gap-4 mb-1">
            <Link to={`/goals${year !== nowYear ? `?year=${year}` : ''}`} className="text-sm text-slate-500 hover:text-indigo-700">← 팀목표 타임라인</Link>
            {isLeader && <PlanToggle />}
          </div>) : undefined}
        sub={mode === 'member' ? '목표 달성에 대한 공식 성과는 [성과입력]으로 올려 팀장님 승인을 받으세요 — 승인되면 팀목표 진척에 반영됩니다. 내 과제 아래 할 일은 자유롭게 씁니다.' : `단계: ${[0, 1, 2].map(levelName).join(' › ')} · 연도별로 판을 나눠 세웁니다. 팀원에게 처음부터 계획을 요청할 수도 있습니다`}
        right={mode === 'member' && !isLeader ? <div className="flex gap-2">
          {rules.open && <Button variant="secondary" onClick={() => setPaste(true)}><ClipboardPaste size={15} />붙여 넣기</Button>}
          <Button onClick={() => setCk(true)} title={PERF_TIP}><Crosshair size={15} />성과입력</Button></div> : undefined} />
      {ck && <CheckinModal open onClose={() => setCk(false)} spaceId={uid} />}
      {/* 팀장 도구 — 제목 아래 줄에 고정 (오른쪽 위는 팀원 목표수정 토글) */}
      {mode === 'leader' && isLeader && (
        <div className="-mt-2 mb-6 flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => setAskPlan(true)}><Send size={15} />팀원에게 계획 요청</Button>
          <Button variant="soft" onClick={() => setDraft({ open: true, parent: null })}><AiIcon size={16} />계획 만들기</Button>
          <Button variant="secondary" onClick={() => setPaste(true)}><ClipboardPaste size={15} />붙여 넣기</Button>
          <Button variant="ghost" onClick={() => setSettings(true)} aria-label="설정"><Settings2 size={15} /></Button>
        </div>
      )}

      {/* 팀원: 성과입력이 무엇인지 (처음 한 번, 닫으면 다시 안 뜸) */}
      {mode === 'member' && !isLeader && <div className="mb-3"><PerfGuide onStart={() => setCk(true)} /></div>}
      {/* 팀원: 지금 고칠 수 있는 것 */}
      {mode === 'member' && !isLeader && (
        <div className={cx('mb-3 rounded-xl px-4 py-2.5 text-sm flex items-start gap-2.5', rules.open ? 'bg-emerald-50 text-emerald-900' : 'bg-slate-50 text-slate-700')}>
          {rules.open ? <LockOpen size={15} className="mt-0.5 shrink-0 text-emerald-600" /> : <Lock size={15} className="mt-0.5 shrink-0 text-slate-400" />}
          <p>{rules.open
            ? <><b>지금은 목표·과제를 고칠 수 있어요.</b> 새로 쓰거나 고친 목표·과제는 팀장님 승인 후 반영됩니다. 할 일은 언제든 자유롭게 쓰세요.</>
            : <><b>지금은 목표·과제 수정이 꺼져 있습니다.</b> 성과입력과 내 과제 아래 할 일은 언제든 할 수 있어요. 목표·과제를 바꿔야 하면 항목을 열어 [변경 요청]을 보내세요.</>}</p>
        </div>
      )}

      {/* 팀장: 팀원이 보낸 목표 변경 요청 */}
      {mode === 'leader' && !!changeReqs.data?.length && (
        <div className="mb-4 space-y-2">
          {changeReqs.data.map((r) => {
            const it = r.item_id ? byId.get(r.item_id) : null;
            return (
              <div key={r.id} className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{nameOf(r.from_id)} 님의 변경 요청 · {it?.title ?? r.title}</div>
                  <div className="text-xs text-slate-600">{r.body || r.title} · {fmtShort(r.created_at)}</div>
                </div>
                {it && <Button size="sm" variant="secondary" onClick={() => setParam('item', it.id)}>열기</Button>}
                <Button size="sm" variant="ghost" loading={closeChange.isPending && closeChange.variables === r.id} onClick={() => closeChange.mutate(r.id)}>처리함</Button>
              </div>
            );
          })}
        </div>
      )}

      {/* 팀원: 계획 요청 */}
      {mode === 'member' && !!requests.data?.length && (
        <div className="mb-4 space-y-2">
          {requests.data.map((r) => {
            const it = r.item_id ? byId.get(r.item_id) : null;
            return (
              <div key={r.id} className="rounded-xl bg-violet-50 border border-violet-100 px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0"><div className="font-semibold text-sm">팀장 요청 · {r.title}</div>
                  <div className="text-xs text-slate-600">{it ? `'${it.title}' 아래에 계획을 세워 주세요` : '처음부터 내 목표·과제를 세워 주세요'}{r.body && ` · ${r.body}`}{r.due_date && ` · ${fmtShort(r.due_date)}까지`}</div></div>
                <Button size="sm" onClick={() => { if (it) setParam('item', it.id); else { setParam('view', null); setAddRoot((x) => x + 1); } }}>직접 쓰기</Button>
                <Button size="sm" variant="ghost" onClick={async () => { await supabase.from('team_requests').update({ status: 'done', response: '계획을 올렸습니다' }).eq('id', r.id); requests.refetch(); }}>완료</Button>
              </div>
            );
          })}
        </div>
      )}

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
        {items.isLoading ? <Spinner /> : !all.length && !addRoot ? (
          <Empty title={mode === 'member' ? '아직 내 목표·과제가 없습니다' : `${year}년 목표를 세워 보세요`}
            action={<div className="flex gap-2 justify-center flex-wrap">
              {isLeader && <Button onClick={() => setDraft({ open: true, parent: null })}><AiIcon size={15} />계획서로 초안 만들기</Button>}
              {canAddUnder(null) && <Button variant={isLeader ? 'secondary' : 'primary'} onClick={() => { setParam('view', null); setAddRoot((x) => x + 1); }}>직접 쓰기</Button>}
              {isLeader && mode === 'leader' && <Button variant="secondary" onClick={() => setAskPlan(true)}><Send size={14} />팀원에게 계획 요청</Button>}
              {(isLeader || rules.open) && <Button variant="secondary" onClick={() => setPaste(true)}><ClipboardPaste size={14} />붙여 넣기</Button>}
            </div>}>
            {mode === 'member' ? (rules.open ? `${year}년 내 목표·과제가 아직 없습니다. 직접 쓰거나 정리해 둔 내용을 붙여 넣어 시작하세요.` : `${year}년 목표·과제가 아직 없습니다. 팀장님이 팀원 수정을 켜거나 계획을 요청하면 직접 세울 수 있어요.`) : aiText('계획서나 업무 분장표를 넣으면 AI가 목표 › 과제 › 할 일 초안을 만듭니다. 한 줄씩 직접 써도 됩니다.')}
          </Empty>
        ) : view === 'table' ? <TableView rows={flatten(roots, new Set(), (n) => rows.some((r) => r.id === n.id))} onOpen={(id) => setParam('item', id)} canEditItem={canEditItem} canProgress={canProgress} />
          : view === 'timeline' ? <Timeline rows={rows} collapsed={collapsed} toggle={toggle} onOpen={(id) => setParam('item', id)} canEditItem={canEditItem} />
            : <Outline rows={rows} byId={byId} collapsed={collapsed} toggle={toggle} onOpen={(id) => setParam('item', id)}
              canEditItem={canEditItem} canProgress={canProgress} canAddUnder={canAddUnder} canStructure={canStructure} dim={(n) => context.has(n.id)} rootDefaults={rootDefaults} addRootSignal={addRoot} />}
      </Card>
      {view === 'outline' && !!all.length && <p className="mt-2 text-[11px] text-slate-400">제목을 눌러 바로 고칩니다 · Enter 다음 줄 · Tab 들여쓰기 · Shift+Tab 내어쓰기 · 왼쪽 손잡이로 끌어서 옮기기</p>}
      {view === 'timeline' && <p className="mt-2 text-[11px] text-slate-400">회색 선은 처음 계획(승인 시점)입니다 · 막대를 끌면 일정이 옮겨지고 변경 이력이 남습니다</p>}

      {open && <ItemDetail key={open.id} item={open} byId={byId} mode={mode} onClose={() => setParam('item', null)} onAiPlan={isLeader ? (pid) => setDraft({ open: true, parent: pid }) : undefined} />}
      {isLeader && <PlanDraftModal open={draft.open} onClose={() => setDraft({ open: false, parent: null })} byId={byId} parentId={draft.parent} year={year} />}
      {askPlan && <PlanRequestModal year={year} roots={roots} onClose={() => setAskPlan(false)} />}
      <PasteModal open={paste} onClose={() => setPaste(false)} byId={byId} defaultParent={mode === 'member' ? (all.find((n) => n.owner_id === uid)?.id ?? null) : null} />
      {isLeader && <LevelSettings open={settings} onClose={() => setSettings(false)} />}
    </section>
  );
}
