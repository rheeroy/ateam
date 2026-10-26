// 항목 상세 패널: 편집 · 계획 대비 · 기록 · 대화/피드백 · 승인
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, GitPullRequestArrow, History, Lock, MessageSquare, Plus, Send, Trash2, X } from 'lucide-react';
import { NotesBox } from '../notes/Notes';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import type { Hypothesis, ItemMeasure, ItemStatus, Metric, Submission, WorkItem, WorkItemComment, WorkItemEvent, WorkItemLog } from '../../lib/types';
import { CheckinHistory, CheckinModal } from '../checkin/Checkin';
import { MetricModal } from './GoalForms';
import { MEASURE_META, STATUS_META, slipDays, useItemMutations, useLevelNames, usePlanRules, type Node } from '../../lib/items';
import { cx, fmtDate, fmtShort } from '../../lib/format';
import { Avatar, Bar, Button, Field, Modal, Pill, inputCls, useToast } from '../ui';
import { RequestModal } from '../RequestModal';
import { useLeaderId } from '../member/Member';
import { AiIcon } from '../Brand';

const EVENT_LABEL: Record<string, string> = {
  created: '만듦', replan: '일정 변경', target: '목표값 변경', status: '상태 변경', owner: '담당 변경', approved: '승인', changes_requested: '수정 요청',
};
const evText = (e: WorkItemEvent, nameOf: (id: string) => string) => {
  const fmt = (v: unknown) => {
    if (v && typeof v === 'object') { const o = v as Record<string, string | null>; return `${o.start ? fmtShort(o.start) : '-'}~${o.due ? fmtShort(o.due) : '-'}`; }
    if (typeof v === 'string' && STATUS_META[v as ItemStatus]) return STATUS_META[v as ItemStatus].label;
    if (typeof v === 'string' && v.length === 36) return nameOf(v) || '미정';
    return v == null ? '-' : String(v);
  };
  if (e.kind === 'created') return '';
  return `${fmt(e.old)} → ${fmt(e.new)}`;
};

function Sparkline({ logs }: { logs: WorkItemLog[] }) {
  const pts = logs.filter((l) => l.kind === 'progress' && l.value != null).sort((a, b) => a.period.localeCompare(b.period)).slice(-12);
  if (pts.length < 2) return <p className="text-xs text-slate-400">진척 기록이 2번 이상 쌓이면 추세가 보입니다.</p>;
  const w = 220, h = 44;
  const t0 = Date.parse(pts[0].period), t1 = Date.parse(pts[pts.length - 1].period) || t0 + 1;
  const xy = pts.map((p) => [((Date.parse(p.period) - t0) / Math.max(1, t1 - t0)) * (w - 8) + 4, h - 4 - (Number(p.value) / 100) * (h - 8)]);
  return (
    <svg width={w} height={h} className="overflow-visible" role="img" aria-label="진척 추세">
      <polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke="#6366F1" strokeWidth={2} strokeLinejoin="round" />
      {xy.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3} fill="#fff" stroke="#6366F1" strokeWidth={2}><title>{`${fmtShort(pts[i].period)} ${pts[i].value}%`}</title></circle>)}
    </svg>
  );
}

const PENDING: string[] = ['proposed', 'changes_requested'];
const PLAN_KEYS = ['title', 'note', 'start_date', 'due_date', 'num_target', 'measure', 'unit', 'higher_is_better', 'recur', 'parent_id'];

/** 팀원 → 팀장: 팀원 수정이 꺼져 있을 때 목표·과제를 바꿔 달라는 요청 */
function ChangeRequestModal({ item, onClose }: { item: Node; onClose: () => void }) {
  const { team, uid } = useTeam();
  const leader = useLeaderId();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const send = useMutation({
    mutationFn: () => q(supabase.from('team_requests').insert({ team_id: team.id, from_id: uid, to_id: leader, kind: 'change', item_id: item.id, title: `${item.title} — 변경 요청`, body: body.trim() })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['requests'] }); toast('팀장님께 변경 요청을 보냈습니다. 처리되면 알림이 갑니다.'); onClose(); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Modal open onClose={onClose} title={<span className="inline-flex items-center gap-2"><GitPullRequestArrow size={17} className="text-indigo-600" />변경 요청</span>}>
      <p className="text-sm text-slate-600 rounded-lg bg-slate-50 px-3 py-2">'{item.title}'을(를) 어떻게 바꾸고 싶은지, 왜인지 적어 주세요. 팀장님이 보고 직접 고치거나 팀원 수정을 켜 줍니다.</p>
      <textarea rows={4} className={`${inputCls} mt-3`} value={body} onChange={(e) => setBody(e.target.value)} autoFocus
        placeholder="예) 마감을 2주 미루고 싶어요 — 외주 일정이 밀렸습니다 / 목표값을 20건에서 15건으로 / 이 과제는 다음 분기로 넘기고 싶어요" />
      <Button className="mt-3 w-full" disabled={!body.trim() || !leader} loading={send.isPending} onClick={() => send.mutate()}>보내기</Button>
    </Modal>
  );
}

export function ItemDetail({ item, byId, onClose, onAiPlan, mode }: {
  item: Node; byId: Map<string, Node>; onClose: () => void; onAiPlan?: (parentId: string) => void; mode: 'leader' | 'member';
}) {
  const { team, uid, members, nameOf, isLeader, hasFeature } = useTeam();
  const [handover, setHandover] = useState<string | null>(null);
  const levelName = useLevelNames();
  const { update, remove } = useItemMutations(team.id);
  const toast = useToast();
  const qc = useQueryClient();
  const mine = item.owner_id === uid;
  const rules = usePlanRules();
  const canPlan = rules.canEditPlan(item);           // 계획 자체 (목표·과제는 팀원 수정이 켜져 있을 때만)
  const canEdit = rules.canProgress(item);           // 진척·상태
  const canStructure = isLeader;
  const locked = !isLeader && mine && !canPlan;      // 기간이 닫혀 있는 내 목표·과제
  const [changeOpen, setChangeOpen] = useState(false);
  const [f, setF] = useState(item);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [reqOpen, setReqOpen] = useState(false);
  const [ck, setCk] = useState(false);
  const [metricOpen, setMetricOpen] = useState(false);
  useEffect(() => { setF(item); setReason(''); }, [item]);

  const logs = useQuery({ queryKey: ['item-logs', item.id], queryFn: () => q<WorkItemLog[]>(supabase.from('work_item_logs').select('*').eq('item_id', item.id).order('period', { ascending: false }).limit(40)) });
  const events = useQuery({ queryKey: ['item-events', item.id], queryFn: () => q<WorkItemEvent[]>(supabase.from('work_item_events').select('*').eq('item_id', item.id).order('created_at', { ascending: false }).limit(30)) });
  const comments = useQuery({ queryKey: ['item-comments', item.id], queryFn: () => q<WorkItemComment[]>(supabase.from('work_item_comments').select('*').eq('item_id', item.id).order('created_at')) });
  const subs = useQuery({ queryKey: ['item-subs', item.id], queryFn: () => q<Submission[]>(supabase.from('submissions').select('*').eq('item_id', item.id).order('updated_at', { ascending: false }).limit(10)) });
  const metrics = useQuery({ queryKey: ['metrics', team.id], enabled: isLeader, queryFn: () => q<Metric[]>(supabase.from('metrics').select('*').eq('team_id', team.id)) });
  const hyps = useQuery({ queryKey: ['hyps', team.id, item.id], enabled: !item.parent_id, queryFn: () => q<Hypothesis[]>(supabase.from('hypotheses').select('*').eq('item_id', item.id).order('created_at')) });
  const inval = () => ['item-logs', 'item-events', 'item-comments'].forEach((k) => qc.invalidateQueries({ queryKey: [k, item.id] }));

  const dirty = useMemo(() => (Object.keys(f) as (keyof WorkItem)[]).some((k) => JSON.stringify(f[k]) !== JSON.stringify(item[k])), [f, item]);
  const planChanged = !!item.baselined_at && (f.due_date !== item.due_date || f.start_date !== item.start_date || f.num_target !== item.num_target);
  const save = () => {
    const keys: (keyof WorkItem)[] = ['title', 'note', 'owner_id', 'status', 'measure', 'progress', 'num_current', 'num_target', 'unit', 'higher_is_better', 'recur', 'stages', 'stage_current',
      'start_date', 'due_date', 'contribution', 'priority', 'est_hours_per_week', 'metric_id', 'tags', 'parent_id'];
    const patch: Record<string, unknown> = {};
    for (const k of keys) if (JSON.stringify(f[k]) !== JSON.stringify(item[k])) patch[k] = f[k];
    if (planChanged && reason.trim()) patch.change_reason = reason.trim();
    const reapprove = rules.reapproves(item) && PLAN_KEYS.some((k) => k in patch);
    update.mutate({ id: item.id, patch: patch as Partial<WorkItem> }, { onSuccess: () => { inval(); if (isLeader && patch.owner_id && hasFeature('history')) setHandover(patch.owner_id as string); toast(reapprove ? '고친 계획을 팀장님께 올렸습니다. 승인 전까지 검토 대기로 표시됩니다.' : '저장했습니다'); } });
  };
  const decide = (status: ItemStatus, kind: WorkItemComment['kind'], body: string) => {
    update.mutate({ id: item.id, patch: { status } }, {
      onSuccess: async () => {
        if (body.trim() || kind === 'approve') await supabase.from('work_item_comments').insert({ item_id: item.id, team_id: team.id, kind, body: body.trim() });
        setComment(''); inval(); toast(kind === 'approve' ? '승인했습니다. 지금 일정이 기준선으로 저장됩니다.' : '수정을 요청했습니다');
      },
    });
  };
  const post = useMutation({
    mutationFn: () => q(supabase.from('work_item_comments').insert({ item_id: item.id, team_id: team.id, kind: isLeader && !mine ? 'feedback' : 'comment', body: comment.trim() })),
    onSuccess: () => { setComment(''); inval(); },
    onError: (e) => toast(errorText(e)),
  });
  const logRecurring = useMutation({
    mutationFn: (done: boolean) => {
      const d = new Date();
      const period = item.recur === 'weekly'
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).toISOString().slice(0, 10)
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      return q(supabase.from('work_item_logs').upsert({ item_id: item.id, team_id: team.id, kind: 'recurring', period, done }, { onConflict: 'item_id,kind,period' }));
    },
    onSuccess: () => { inval(); qc.invalidateQueries({ queryKey: ['items', team.id] }); toast('기록했습니다'); },
    onError: (e) => toast(errorText(e)),
  });
  const [hyp, setHyp] = useState('');
  const addHyp = useMutation({ mutationFn: () => q(supabase.from('hypotheses').insert({ team_id: team.id, item_id: item.id, statement: hyp })), onSuccess: () => { setHyp(''); qc.invalidateQueries({ queryKey: ['hyps', team.id, item.id] }); } });
  const setHypStatus = useMutation({ mutationFn: (h: { id: string; status: Hypothesis['status'] }) => q(supabase.from('hypotheses').update({ status: h.status }).eq('id', h.id)), onSuccess: () => qc.invalidateQueries({ queryKey: ['hyps', team.id, item.id] }) });

  const slip = slipDays(item);
  const parentOptions = [...byId.values()].filter((n) => n.id !== item.id && !n.path.includes(item.id) && n.status !== 'dropped');
  const ro = !canPlan;
  const pro = !canEdit;
  // 목표·과제의 성과 값(숫자·진척률·단계)은 팀원이 직접 못 바꾼다 — 성과입력 → 팀장 승인
  const isMetric = item.role === 'metric' || (item.depth === 0 && item.measure !== 'children');
  const valLock = pro || (!isLeader && isMetric);   // 지표 값은 성과입력 → 팀장 승인 (과제 진척은 자유)
  const canCheckin = !isLeader && mine && item.depth < 2 && ['active', 'blocked'].includes(item.status) && !(item.depth === 0 && item.measure === 'children');
  const noMetric = item.depth === 0 && item.measure === 'children' && !item.children.some((c) => c.role === 'metric' && c.status !== 'dropped');
  const S = (k: keyof WorkItem) => (v: unknown) => setF((p) => ({ ...p, [k]: v }));

  return (
    <aside className="fixed inset-0 z-40 lg:inset-y-0 lg:left-auto lg:w-[460px] bg-white border-l border-slate-200 shadow-2xl flex flex-col" aria-label="항목 상세">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <span className="text-xs text-slate-500">{levelName(item.depth)}</span>
        {item.path.length > 0 && <span className="text-xs text-slate-400 truncate">· {item.path.map((p) => byId.get(p)?.title).join(' › ')}</span>}
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* 담당이 바뀌면 — 히스토리도 넘길지 */}
        {handover && (
          <div className="rounded-xl bg-violet-50 ring-1 ring-violet-100 p-3.5 text-sm flex items-start gap-2.5">
            <History size={16} className="text-violet-600 mt-0.5 shrink-0" />
            <div className="flex-1"><div className="font-semibold text-violet-900">담당자가 {nameOf(handover)} 님으로 바뀌었습니다</div>
              <p className="text-xs text-violet-800 mt-0.5">이 과제의 지금까지 흐름 · 확정 사항 · 관계자를 히스토리로 함께 넘길까요?</p>
              <Link to={`/history?item=${item.id}&send=1&to=${handover}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-white bg-violet-600 rounded-lg px-3 py-1.5"><Send size={12} />히스토리 전달</Link></div>
            <button onClick={() => setHandover(null)} className="text-violet-400 hover:text-violet-700" aria-label="닫기"><X size={14} /></button>
          </div>
        )}
        {/* 승인 흐름 */}
        {(item.status === 'proposed' || item.status === 'changes_requested') && (
          <div className={cx('rounded-xl p-3.5 text-sm', item.status === 'proposed' ? 'bg-violet-50' : 'bg-amber-50')}>
            <div className="font-semibold">{item.status === 'proposed' ? `${nameOf(item.owner_id) || '팀원'}님이 올린 계획입니다` : '팀장이 수정을 요청했습니다'}</div>
            <p className="text-xs text-slate-600 mt-0.5">{item.status === 'proposed'
              ? (isLeader ? '승인하면 지금 일정이 처음 계획(기준선)으로 저장되고, 이후 변경은 이력으로 남습니다.'
                : rules.open ? '팀장 승인을 기다리고 있습니다. 승인 전까지 고칠 수 있습니다.' : '팀장 승인을 기다리고 있습니다. 팀원 수정이 꺼져 있어 지금은 고칠 수 없습니다.')
              : (isLeader ? '팀원이 고치면 자동으로 다시 검토 대기로 올라옵니다.'
                : rules.open ? '아래 코멘트를 보고 고치면 자동으로 다시 검토 요청됩니다.' : '아래 코멘트를 확인해 두세요. 팀장님이 팀원 수정을 켜면 고칠 수 있습니다.')}</p>
            {isLeader && !rules.open && <p className="text-[11px] text-amber-800 mt-1">지금은 팀원 목표 수정이 꺼져 있어, 수정을 요청해도 팀원이 바로 고칠 수 없습니다. 오른쪽 위 [팀원 목표수정] 토글을 켜 주세요.</p>}
            {isLeader && item.status === 'proposed' && (
              <div className="mt-3 space-y-2">
                <textarea rows={2} className={inputCls} placeholder="피드백 (수정 요청 시 필수)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={noMetric} title={noMetric ? '지표를 먼저 달아 주세요' : undefined} onClick={() => decide('active', 'approve', comment)} loading={update.isPending}><Check size={13} />승인</Button>
                  <Button size="sm" variant="secondary" disabled={!comment.trim()} onClick={() => decide('changes_requested', 'changes', comment)}>수정 요청</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {locked && (
          <div className="rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600 flex gap-2">
            <Lock size={13} className="mt-0.5 shrink-0 text-slate-400" />
            <span>{PENDING.includes(item.status)
              ? <>지금은 팀원 수정이 꺼져 있어 검토 중인 계획도 고칠 수 없어요. 팀장님이 켜면 고칠 수 있습니다.</>
              : <>지금은 팀원 수정이 꺼져 있어 {levelName(item.depth)}는 성과입력과 상태만 남길 수 있어요. 일정·목표값·내용을 바꿔야 하면 아래 <b>[변경 요청]</b>으로 팀장님께 알려 주세요. 하위 할 일은 언제든 자유롭게 씁니다.</>}</span>
          </div>
        )}
        {!isLeader && mine && canPlan && rules.reapproves(item) && item.status !== 'changes_requested' && (
          <p className="rounded-xl bg-emerald-50 px-3.5 py-2 text-xs text-emerald-800">계획을 고쳐 저장하면 팀장님 승인 후 반영됩니다.</p>
        )}
        <Field label="제목"><input className={inputCls} value={f.title} disabled={ro} onChange={(e) => S('title')(e.target.value)} /></Field>
        <Field label="설명"><textarea rows={3} className={inputCls} value={f.note} disabled={ro} placeholder="무엇을, 왜, 어떤 상태면 끝인지" onChange={(e) => S('note')(e.target.value)} /></Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="담당">
            <select className={inputCls} value={f.owner_id ?? ''} disabled={!isLeader} onChange={(e) => S('owner_id')(e.target.value || null)}>
              <option value="">미정</option>{members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
            </select>
          </Field>
          <Field label="상태">
            <select className={inputCls} value={f.status} disabled={pro} onChange={(e) => S('status')(e.target.value)}>
              {(Object.keys(STATUS_META) as ItemStatus[]).filter((s) => isLeader || s === item.status || (PENDING.includes(item.status) ? [...PENDING, 'dropped'].includes(s)
                : !PENDING.includes(s) && (item.depth >= 2 || s !== 'dropped')))
                .map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </Field>
          <Field label="시작"><input type="date" className={inputCls} value={f.start_date ?? ''} disabled={ro} onChange={(e) => S('start_date')(e.target.value || null)} /></Field>
          <Field label="마감"><input type="date" className={inputCls} value={f.due_date ?? ''} disabled={ro} onChange={(e) => S('due_date')(e.target.value || null)} /></Field>
        </div>
        {planChanged && (
          <Field label="일정을 바꾸는 이유" hint="선택 · 계획 대비 이력에 남습니다">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예) 고객 일정 변경" />
          </Field>
        )}

        {noMetric && (
          <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200 px-3.5 py-3 text-sm text-amber-900 flex items-center gap-2 flex-wrap">
            <span className="flex-1 min-w-[200px]"><b>지표가 없는 목표입니다.</b> 이 목표를 이뤘는지 무엇으로 볼지 지표를 1개 이상 달아 주세요{isLeader && item.status === 'proposed' ? ' — 지표가 있어야 승인할 수 있습니다' : ''}.</span>
            {(isLeader || (mine && rules.open)) && <Button size="sm" onClick={() => setMetricOpen(true)}>지표 더하기</Button>}
          </div>
        )}
        {metricOpen && <MetricModal open onClose={() => setMetricOpen(false)} goal={item} />}
        {item.depth < 2 && !PENDING.includes(item.status) && !(item.depth === 0 && item.measure === 'children') && <CheckinHistory item={item} canCheckin={canCheckin} metric={isMetric} onCheckin={() => setCk(true)} />}
        {ck && <CheckinModal open onClose={() => setCk(false)} itemId={item.id} spaceId={uid} />}

        {/* 측정 방식 */}
        <div className="rounded-xl border border-slate-200 p-3.5 space-y-3">
          <Field label="진척을 재는 방식">
            <select className={inputCls} value={f.measure} disabled={ro} onChange={(e) => S('measure')(e.target.value as ItemMeasure)}>
              {(Object.keys(MEASURE_META) as ItemMeasure[]).filter((m) => item.role === 'metric' ? ['number', 'percent', 'stage'].includes(m) : item.depth === 0 ? ['children', 'number', 'percent', 'stage'].includes(m) : m !== 'stage')
                .map((m) => <option key={m} value={m}>{item.depth === 0 && m === 'children' ? '지표 기준 — 아래 지표들의 진척으로 자동 계산' : `${MEASURE_META[m].label} — ${MEASURE_META[m].hint}`}</option>)}
            </select>
          </Field>
          {f.measure === 'percent' && (
            <div><div className="flex justify-between text-xs text-slate-500"><span>진척률</span><span className="font-mono">{f.progress}%</span></div>
              <input type="range" min={0} max={100} step={5} value={f.progress} disabled={valLock} onChange={(e) => S('progress')(Number(e.target.value))} className="w-full accent-indigo-600" aria-label="진척률" /></div>
          )}
          {f.measure === 'number' && (
            <div className="grid grid-cols-3 gap-2">
              <Field label="현재"><input type="number" className={inputCls} value={f.num_current ?? ''} disabled={valLock || !!f.metric_id} onChange={(e) => S('num_current')(e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="목표"><input type="number" className={inputCls} value={f.num_target ?? ''} disabled={ro} onChange={(e) => S('num_target')(e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <Field label="단위"><input className={inputCls} value={f.unit} disabled={ro} onChange={(e) => S('unit')(e.target.value)} placeholder="건, 억" /></Field>
              {isLeader && (
                <div className="col-span-3"><Field label="실적 지표와 연결" hint="연결하면 월 실적이 현재값으로 자동 반영">
                  <select className={inputCls} value={f.metric_id ?? ''} onChange={(e) => S('metric_id')(e.target.value || null)}>
                    <option value="">연결 안 함</option>{(metrics.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select></Field></div>
              )}
            </div>
          )}
          {f.measure === 'recurring' && (
            <div className="space-y-2">
              <div className="flex gap-2">{(['weekly', 'monthly'] as const).map((r) => (
                <button key={r} type="button" disabled={ro} onClick={() => S('recur')(r)} className={cx('text-sm border rounded-lg px-3 py-1.5', f.recur === r ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>{r === 'weekly' ? '매주' : '매달'}</button>
              ))}</div>
              {canEdit && item.measure === 'recurring' && (
                <div className="flex items-center gap-2 text-sm"><span className="text-slate-500">이번 {item.recur === 'weekly' ? '주' : '달'}</span>
                  <Button size="sm" variant="soft" onClick={() => logRecurring.mutate(true)}>완료</Button>
                  <Button size="sm" variant="ghost" onClick={() => logRecurring.mutate(false)}>못 함</Button></div>
              )}
            </div>
          )}
          {f.measure === 'stage' && (
            <div className="space-y-2">
              <Field label="단계" hint="한 줄에 하나씩 · 3~5개 · 순서대로">
                <textarea rows={4} className={inputCls} value={(f.stages ?? []).join('\n')} disabled={ro} placeholder={'착수\n초안\n검증\n확정\n확산'}
                  onChange={(e) => S('stages')(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8))} />
              </Field>
              {!!(f.stages ?? []).length && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-500 mr-1">지금</span>
                  {(f.stages ?? []).map((st, i) => (
                    <button key={i} type="button" disabled={valLock} onClick={() => S('stage_current')(f.stage_current === i + 1 ? null : i + 1)}
                      className={cx('rounded-full px-2.5 py-0.5 ring-1', (f.stage_current ?? 0) >= i + 1 ? 'bg-indigo-600 text-white ring-indigo-600' : 'bg-white text-slate-600 ring-slate-200', valLock && 'cursor-default')}>{i + 1}. {st}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!isLeader && isMetric && <p className="text-[11px] text-slate-400">성과 값은 위의 [성과입력]으로 남기고, 팀장님이 승인하면 바뀝니다.</p>}
          {f.measure === 'children' && <p className="text-xs text-slate-500">하위 항목 {item.children.length}개의 평균 진척 {item.progress}% (제안·중단 제외)</p>}
        </div>

        {isLeader && (
          <details className="rounded-xl border border-slate-200 p-3.5">
            <summary className="text-sm font-semibold cursor-pointer">관리 속성 (선택)</summary>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Field label="기여도" hint="1~5"><input type="number" min={1} max={5} className={inputCls} value={f.contribution} onChange={(e) => S('contribution')(Number(e.target.value))} /></Field>
              <Field label="우선순위" hint="1~3"><input type="number" min={1} max={3} className={inputCls} value={f.priority} onChange={(e) => S('priority')(Number(e.target.value))} /></Field>
              <Field label="주당 시간"><input type="number" className={inputCls} value={f.est_hours_per_week ?? ''} onChange={(e) => S('est_hours_per_week')(e.target.value === '' ? null : Number(e.target.value))} /></Field>
              <div className="col-span-3"><Field label="태그" hint="쉼표로 구분"><input className={inputCls} value={f.tags.join(', ')} onChange={(e) => S('tags')(e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} /></Field></div>
            </div>
          </details>
        )}
        {canStructure && (
          <Field label="위치 (상위 항목)">
            <select className={inputCls} value={f.parent_id ?? ''} onChange={(e) => S('parent_id')(e.target.value || null)}>
              <option value="">최상위 ({levelName(0)})</option>
              {parentOptions.map((n) => <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.title}</option>)}
            </select>
          </Field>
        )}

        {dirty && canEdit && (
          <div className="sticky bottom-0 bg-white/95 backdrop-blur py-2 flex gap-2">
            <Button onClick={save} loading={update.isPending} className="flex-1">저장</Button>
            <Button variant="ghost" onClick={() => { setF(item); setReason(''); }}>되돌리기</Button>
          </div>
        )}

        {/* 계획 대비 */}
        <section>
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><History size={14} />계획 대비</h3>
          {item.baselined_at ? (
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 py-2"><div className="text-[11px] text-slate-500">처음 마감</div><div className="text-sm font-semibold">{item.base_due ? fmtShort(item.base_due) : '-'}</div></div>
              <div className="rounded-lg bg-slate-50 py-2"><div className="text-[11px] text-slate-500">지금 마감</div><div className="text-sm font-semibold">{item.due_date ? fmtShort(item.due_date) : '-'}</div></div>
              <div className={cx('rounded-lg py-2', (slip ?? 0) > 0 ? 'bg-amber-50' : 'bg-slate-50')}><div className="text-[11px] text-slate-500">변경 {item.replan_count}회</div><div className="text-sm font-semibold">{slip ? `${slip > 0 ? '+' : ''}${slip}일` : '그대로'}</div></div>
            </div>
          ) : <p className="mt-1 text-xs text-slate-500">승인되거나 진행 상태가 되면 그때의 일정이 처음 계획으로 저장됩니다.</p>}
          <div className="mt-3"><Sparkline logs={logs.data ?? []} /></div>
          {!!events.data?.filter((e) => e.kind !== 'created').length && (
            <ul className="mt-3 space-y-1.5 text-xs">
              {events.data.filter((e) => e.kind !== 'created').slice(0, 8).map((e) => (
                <li key={e.id} className="flex gap-2"><span className="text-slate-400 w-12 shrink-0">{fmtShort(e.created_at)}</span>
                  <span><b className="font-semibold">{EVENT_LABEL[e.kind] ?? e.kind}</b> {evText(e, nameOf)}{e.reason && <span className="text-slate-500"> · {e.reason}</span>}<span className="text-slate-400"> · {nameOf(e.actor_id) || '시스템'}</span></span></li>
              ))}
            </ul>
          )}
        </section>

        {/* 하위 항목 요약 */}
        {item.children.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold">{levelName(item.depth + 1)} {item.children.length}개</h3>
            <ul className="mt-2 space-y-1.5">{item.children.slice(0, 8).map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-sm"><span className="flex-1 truncate">{c.title}</span>
                <Pill tone={STATUS_META[c.status].tone}>{STATUS_META[c.status].label}</Pill><span className="w-16"><Bar value={c.progress} /></span></li>
            ))}</ul>
          </section>
        )}

        {/* 목표의 가설 */}
        {!item.parent_id && isLeader && (
          <section>
            <h3 className="text-sm font-semibold">검증할 가설</h3>
            <ul className="mt-2 space-y-1.5 text-sm">{(hyps.data ?? []).map((h) => (
              <li key={h.id} className="flex items-start gap-2"><span className="flex-1">{h.statement}{h.signal && <span className="block text-xs text-slate-500">신호: {h.signal}</span>}</span>
                <select aria-label="가설 상태" className="text-xs border border-slate-200 rounded px-1 py-0.5" value={h.status} onChange={(e) => setHypStatus.mutate({ id: h.id, status: e.target.value as Hypothesis['status'] })}>
                  <option value="testing">검증 중</option><option value="validated">맞음</option><option value="refuted">틀림</option></select></li>
            ))}</ul>
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (hyp.trim()) addHyp.mutate(); }}>
              <input className={inputCls} placeholder="예) 침투가로 전환율 20% 이상" value={hyp} onChange={(e) => setHyp(e.target.value)} />
              <Button size="sm" variant="soft" type="submit"><Plus size={12} /></Button></form>
          </section>
        )}

        {/* 연결된 결과물 */}
        {!!subs.data?.length && (
          <section><h3 className="text-sm font-semibold">연결된 결과물·공유</h3>
            <ul className="mt-2 space-y-1 text-sm">{subs.data.map((s) => <li key={s.id}><Link className="text-indigo-700 hover:underline" to={`/work/${s.id}`}>{s.title}</Link> <span className="text-xs text-slate-400">{fmtDate(s.updated_at)}</span></li>)}</ul></section>
        )}

        {/* 팀장 전용 메모 (팀원에게 보이지 않음) */}
        {isLeader && <NotesBox anchor={{ type: 'item', id: item.id, label: item.title }} />}

        {/* 대화·피드백 */}
        <section>
          <h3 className="text-sm font-semibold flex items-center gap-1.5"><MessageSquare size={14} />대화·피드백</h3>
          <ul className="mt-2 space-y-2.5">
            {(comments.data ?? []).map((c) => (
              <li key={c.id} className="flex gap-2.5">
                <Avatar name={nameOf(c.author_id)} size={7} tone={c.kind === 'comment' ? 'slate' : 'indigo'} />
                <div className="flex-1 min-w-0 text-sm">
                  <div className="text-xs text-slate-500">{nameOf(c.author_id)} · {fmtShort(c.created_at)}
                    {c.kind !== 'comment' && <span className={cx('ml-1.5 font-semibold', c.kind === 'changes' ? 'text-amber-700' : c.kind === 'approve' ? 'text-emerald-700' : 'text-indigo-700')}>{{ feedback: '피드백', approve: '승인', changes: '수정 요청' }[c.kind]}</span>}</div>
                  {c.body && <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>}
                </div>
              </li>
            ))}
            {!comments.data?.length && <li className="text-xs text-slate-400">{isLeader ? '피드백을 남기면 팀원에게 알림이 가고, 평가 근거로도 쌓입니다.' : '팀장에게 묻거나 공유할 것을 남겨 보세요.'}</li>}
          </ul>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (comment.trim()) post.mutate(); }}>
            <input className={inputCls} placeholder={isLeader && !mine ? '피드백 남기기' : '코멘트'} value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button type="submit" size="sm" loading={post.isPending} aria-label="보내기"><Send size={13} /></Button>
          </form>
        </section>
      </div>
      <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
        {canEdit && onAiPlan && <Button size="sm" variant="soft" onClick={() => onAiPlan(item.id)}><AiIcon size={13} />하위 계획</Button>}
        {isLeader && item.owner_id && item.owner_id !== uid && <Button size="sm" variant="secondary" onClick={() => setReqOpen(true)}><Send size={13} />요청 보내기</Button>}
        {locked && item.depth < 2 && !PENDING.includes(item.status) && <Button size="sm" variant="secondary" onClick={() => setChangeOpen(true)}><GitPullRequestArrow size={13} />변경 요청</Button>}
        {rules.canDelete(item) && (
          <button className="ml-auto text-xs text-slate-400 hover:text-rose-600 inline-flex items-center gap-1"
            onClick={() => { if (confirm(item.children.length ? '하위 항목까지 모두 지웁니다. 계속할까요?' : '이 항목을 지울까요?')) { remove.mutate(item.id); onClose(); } }}>
            <Trash2 size={12} />삭제</button>
        )}
        {mode === 'member' && !isLeader && !locked && item.depth < 2 && <span className="ml-auto text-[11px] text-slate-400">고친 목표·과제는 팀장님 승인 후 반영됩니다</span>}
      </div>
      {changeOpen && <ChangeRequestModal item={item} onClose={() => setChangeOpen(false)} />}
      <RequestModal open={reqOpen} onClose={() => setReqOpen(false)} toId={item.owner_id} itemId={item.id}
        defaultKind={item.children.length ? 'progress' : 'plan'} defaultTitle={item.children.length ? `${item.title} — 진척 공유 부탁해요` : `${item.title} — 하위 계획을 세워 주세요`} />
    </aside>
  );
}
