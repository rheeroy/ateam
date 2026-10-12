import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import type { Metric, MetricValue, Pipeline, WorkItem } from '../lib/types';
import { ymd } from '../lib/format';
import { Button, ErrorBox, Field, Modal, inputCls, useToast } from './ui';

function months(start: string, end: string) {
  const out: string[] = [];
  const d = new Date(start.slice(0, 7) + '-01T00:00:00');
  const e = new Date(end.slice(0, 7) + '-01T00:00:00');
  while (d <= e && out.length < 36) { out.push(ymd(d)); d.setMonth(d.getMonth() + 1); }
  return out;
}

export function NewMetricModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (id: string) => void }) {
  const { team } = useTeam();
  const qc = useQueryClient();
  const now = new Date();
  const qStart = ymd(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 - 3, 1));
  const qEnd = ymd(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3 + 2, 1));
  const [f, setF] = useState({ name: '', unit: '억', target: '', period_start: qStart, period_end: qEnd, item_id: '', cumulative: true });
  const goals = useQuery({ queryKey: ['items', team.id, 'roots'], enabled: open, queryFn: () => q<WorkItem[]>(supabase.from('work_items').select('*').eq('team_id', team.id).is('parent_id', null).not('status', 'in', '(dropped,proposed,changes_requested)').order('sort')) });
  const create = useMutation({
    mutationFn: () => q<Metric>(supabase.from('metrics').insert({
      team_id: team.id, name: f.name, unit: f.unit, target: f.target === '' ? null : Number(f.target),
      period_start: f.period_start, period_end: f.period_end, item_id: f.item_id || null, cumulative: f.cumulative,
    }).select().single()),
    onSuccess: (m) => { qc.invalidateQueries({ queryKey: ['metrics'] }); onClose(); onCreated?.(m.id); },
  });
  return (
    <Modal open={open} onClose={onClose} title="실적 지표 추가">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label="지표 이름"><input required className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="파트너 계약 금액" /></Field></div>
          <Field label="단위"><input className={inputCls} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="목표"><input type="number" step="any" className={inputCls} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
          <Field label="시작 월"><input type="month" className={inputCls} value={f.period_start.slice(0, 7)} onChange={(e) => setF({ ...f, period_start: e.target.value + '-01' })} /></Field>
          <Field label="마감 월"><input type="month" className={inputCls} value={f.period_end.slice(0, 7)} onChange={(e) => setF({ ...f, period_end: e.target.value + '-01' })} /></Field>
        </div>
        <Field label="연결할 전략 목표" hint="선택">
          <select className={inputCls} value={f.item_id} onChange={(e) => setF({ ...f, item_id: e.target.value })}>
            <option value="">없음</option>{(goals.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-indigo-600" checked={f.cumulative} onChange={(e) => setF({ ...f, cumulative: e.target.checked })} />누적 지표 (매출·계약액처럼 월별 실적을 더해 가는 지표)</label>
        <ErrorBox error={create.error ? errorText(create.error) : null} />
        <Button type="submit" className="w-full" loading={create.isPending}>추가</Button>
      </form>
    </Modal>
  );
}

export function MetricDataModal({ metric, open, onClose }: { metric: Metric; open: boolean; onClose: () => void }) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const vals = useQuery({ queryKey: ['metric-values', metric.id], enabled: open, queryFn: () => q<MetricValue[]>(supabase.from('metric_values').select('*').eq('metric_id', metric.id)) });
  const pipe = useQuery({ queryKey: ['pipeline', metric.id], enabled: open, queryFn: () => q<Pipeline[]>(supabase.from('metric_pipeline').select('*').eq('metric_id', metric.id).eq('closed', false).order('created_at')) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [deal, setDeal] = useState({ label: '', amount: '', probability: '50', expected_close: '' });
  useEffect(() => {
    if (vals.data) setDraft(Object.fromEntries(vals.data.map((v) => [v.period, String(v.value)])));
  }, [vals.data]);
  const today = ymd(new Date());
  const ms = months(metric.period_start, metric.period_end).filter((m) => m <= today);
  const inval = () => { qc.invalidateQueries({ queryKey: ['forecast'] }); qc.invalidateQueries({ queryKey: ['metric-values'] }); qc.invalidateQueries({ queryKey: ['pipeline'] }); qc.invalidateQueries({ queryKey: ['goal-outlook'] }); qc.invalidateQueries({ queryKey: ['insight'] }); };
  const saveVals = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(draft).filter(([, v]) => v !== '').map(([period, v]) => ({ metric_id: metric.id, team_id: team.id, period, value: Number(v), created_by: uid }));
      if (rows.length) await q(supabase.from('metric_values').upsert(rows, { onConflict: 'metric_id,period' }));
    },
    onSuccess: () => { inval(); toast('실적을 저장했습니다'); },
    onError: (e) => toast(errorText(e)),
  });
  const addDeal = useMutation({
    mutationFn: () => q(supabase.from('metric_pipeline').insert({ metric_id: metric.id, team_id: team.id, label: deal.label, amount: Number(deal.amount), probability: Number(deal.probability) / 100, expected_close: deal.expected_close || null })),
    onSuccess: () => { setDeal({ label: '', amount: '', probability: '50', expected_close: '' }); inval(); },
    onError: (e) => toast(errorText(e)),
  });
  const closeDeal = useMutation({
    mutationFn: (id: string) => q(supabase.from('metric_pipeline').update({ closed: true }).eq('id', id)),
    onSuccess: inval,
  });
  return (
    <Modal open={open} onClose={onClose} title={`${metric.name} · 실적과 진행 중 딜`} wide>
      <div className="space-y-6">
        <div>
          <div className="text-sm font-semibold">월별 실적 <span className="font-normal text-slate-400">({metric.unit}, {metric.cumulative ? '그 달에 새로 생긴 값' : '그 달의 값'})</span></div>
          <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {ms.map((m) => (
              <label key={m} className="text-xs text-slate-500">{Number(m.slice(5, 7))}월
                <input type="number" step="any" className={`${inputCls} mt-1`} value={draft[m] ?? ''} onChange={(e) => setDraft({ ...draft, [m]: e.target.value })} />
              </label>
            ))}
          </div>
          <Button className="mt-3" size="sm" loading={saveVals.isPending} onClick={() => saveVals.mutate()}>실적 저장</Button>
        </div>
        <div>
          <div className="text-sm font-semibold">진행 중 딜 <span className="font-normal text-slate-400">(확률 가중으로 전망에 반영)</span></div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {(pipe.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <span className="flex-1">{p.label}</span><span className="font-mono">{p.amount}{metric.unit}</span><span className="text-xs text-slate-500">{Math.round(p.probability * 100)}%</span>
                <button className="text-slate-400 hover:text-rose-600" title="종료(성사·무산)" onClick={() => closeDeal.mutate(p.id)}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
          <form className="mt-2 grid grid-cols-[1.4fr_.8fr_.7fr_1fr_auto] gap-2" onSubmit={(e) => { e.preventDefault(); if (deal.label && deal.amount) addDeal.mutate(); }}>
            <input aria-label="딜 이름" className={inputCls} placeholder="B사 제휴" value={deal.label} onChange={(e) => setDeal({ ...deal, label: e.target.value })} />
            <input aria-label="금액" type="number" step="any" className={inputCls} placeholder="금액" value={deal.amount} onChange={(e) => setDeal({ ...deal, amount: e.target.value })} />
            <input aria-label="확률" type="number" min={0} max={100} className={inputCls} placeholder="%" value={deal.probability} onChange={(e) => setDeal({ ...deal, probability: e.target.value })} />
            <input aria-label="예상 종료일" type="date" className={inputCls} value={deal.expected_close} onChange={(e) => setDeal({ ...deal, expected_close: e.target.value })} />
            <Button type="submit" variant="soft" title="추가"><Plus size={15} /></Button>
          </form>
        </div>
      </div>
    </Modal>
  );
}
