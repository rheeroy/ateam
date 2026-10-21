// 목표 세우기 · 지표 더하기 — 목표는 지표(결과를 재는 항목) 없이 만들 수 없다
//   지표를 달거나(OKR처럼) · 목표에 숫자를 바로 건다(KPI처럼). 사용자는 KPI/OKR을 고르지 않는다
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import type { ItemMeasure, Metric, WorkItem } from '../../lib/types';
import { cx } from '../../lib/format';
import { Button, Field, Modal, inputCls, useToast } from '../ui';

type Kind = 'number' | 'percent' | 'stage';
interface MetricDraft { title: string; kind: Kind; start: string; target: string; unit: string; lower: boolean; stages: string }
const blank = (): MetricDraft => ({ title: '', kind: 'number', start: '', target: '', unit: '', lower: false, stages: '' });
const num = (v: string) => (v.trim() === '' ? null : Number(v));
const valid = (m: MetricDraft) => !!m.title.trim() && (m.kind === 'percent' || (m.kind === 'number' ? num(m.target) != null : m.stages.split('\n').filter((x) => x.trim()).length >= 2));
const toRow = (m: MetricDraft): Partial<WorkItem> => ({
  measure: m.kind as ItemMeasure,
  ...(m.kind === 'number' ? { num_current: num(m.start), num_target: num(m.target), unit: m.unit.trim(), higher_is_better: !m.lower } : {}),
  ...(m.kind === 'stage' ? { stages: m.stages.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8) } : {}),
});

/** 지표 한 줄 입력 — 이름 · 재는 방식 · 값 */
function MetricFields({ m, set, onRemove, hideName }: { m: MetricDraft; set: (m: MetricDraft) => void; onRemove?: () => void; hideName?: boolean }) {
  const S = <K extends keyof MetricDraft>(k: K) => (v: MetricDraft[K]) => set({ ...m, [k]: v });
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
      {!hideName && <div className="flex items-center gap-2">
        <input className={cx(inputCls, 'flex-1')} value={m.title} onChange={(e) => S('title')(e.target.value)} placeholder="예) 제휴 고객 30일 재방문율" aria-label="지표 이름" />
        {onRemove && <button onClick={onRemove} className="text-slate-400 hover:text-slate-700" aria-label="지표 빼기"><X size={16} /></button>}
      </div>}
      <div className="flex gap-1 text-xs">
        {([['number', '숫자'], ['percent', '퍼센트'], ['stage', '단계']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => S('kind')(k)} className={cx('rounded-lg px-3 py-1 ring-1', m.kind === k ? 'bg-indigo-600 text-white ring-indigo-600 font-semibold' : 'bg-white text-slate-600 ring-slate-200')}>{l}</button>
        ))}
      </div>
      {m.kind === 'number' && (
        <div className="grid grid-cols-3 gap-2">
          <Field label="지금"><input type="number" className={inputCls} value={m.start} onChange={(e) => S('start')(e.target.value)} placeholder="0" /></Field>
          <Field label="목표"><input type="number" className={inputCls} value={m.target} onChange={(e) => S('target')(e.target.value)} placeholder="35" /></Field>
          <Field label="단위"><input className={inputCls} value={m.unit} onChange={(e) => S('unit')(e.target.value)} placeholder="%, 건, 억" /></Field>
          <label className="col-span-3 inline-flex items-center gap-1.5 text-xs text-slate-500"><input type="checkbox" className="accent-indigo-600" checked={m.lower} onChange={(e) => S('lower')(e.target.checked)} />낮을수록 좋아요 (리드타임 · 불량률처럼)</label>
        </div>
      )}
      {m.kind === 'percent' && <p className="text-xs text-slate-500">진척률(0~100%)로 봅니다.</p>}
      {m.kind === 'stage' && (
        <Field label="단계" hint="한 줄에 하나 · 순서대로">
          <textarea rows={4} className={inputCls} value={m.stages} onChange={(e) => S('stages')(e.target.value)} placeholder={'착수\n초안\n검증\n확정'} />
        </Field>
      )}
    </div>
  );
}

/** 새 목표 — 지표를 1개 이상 달거나, 목표에 숫자를 바로 건다 */
export function GoalModal({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: Partial<WorkItem> }) {
  const { team, uid, isLeader, members } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState(uid);
  const [mode, setMode] = useState<'metrics' | 'self'>('metrics');
  const [metrics, setMetrics] = useState<MetricDraft[]>([blank()]);
  const [self, setSelf] = useState<MetricDraft>(blank());
  const [busy, setBusy] = useState(false);
  const ok = !!title.trim() && (mode === 'self' ? valid({ ...self, title }) : metrics.some(valid) && metrics.every((m) => !m.title.trim() || valid(m)));
  const save = async () => {
    setBusy(true);
    try {
      const goal = await q<WorkItem>(supabase.from('work_items').insert({
        team_id: team.id, parent_id: null, title: title.trim(), owner_id: isLeader ? owner : uid, sort: Date.now() / 1000,
        status: isLeader ? 'active' : 'proposed', ...(defaults ?? {}),
        ...(mode === 'self' ? toRow(self) : { measure: 'children' }),
      }).select().single());
      if (mode === 'metrics') {
        let sort = 0;
        for (const m of metrics.filter(valid)) {
          await q(supabase.from('work_items').insert({
            team_id: team.id, parent_id: goal.id, title: m.title.trim(), owner_id: goal.owner_id, role: 'metric', sort: sort++,
            status: isLeader ? 'active' : 'proposed', start_date: goal.start_date, due_date: goal.due_date, ...toRow(m),
          }));
        }
      }
      qc.invalidateQueries({ queryKey: ['items', team.id] });
      toast(isLeader ? '목표를 세웠습니다' : '목표를 올렸습니다. 팀장님 승인 후 진행됩니다.');
      setTitle(''); setMetrics([blank()]); setSelf(blank()); onClose();
    } catch (e) { toast(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="새 목표" wide>
      <div className="space-y-4">
        <Field label="목표"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예) 제휴 채널을 두 번째 성장 축으로 만든다" autoFocus /></Field>
        {isLeader && (
          <Field label="담당"><select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
            {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name}</option>)}
          </select></Field>
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">지표</span>
            <span className="text-xs text-slate-400">무엇으로 이 목표를 볼지 · 1개 이상</span>
            <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
              <button onClick={() => setMode('metrics')} className={cx('px-2.5 py-1 rounded-md', mode === 'metrics' ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>지표 달기</button>
              <button onClick={() => setMode('self')} className={cx('px-2.5 py-1 rounded-md', mode === 'self' ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>목표에 숫자 바로 걸기</button>
            </div>
          </div>
          <div className="mt-2 space-y-2">
            {mode === 'self' ? (
              <>
                <MetricFields m={self} set={setSelf} hideName />
                <p className="text-[11px] text-slate-400">예) '상반기 매출 20억'처럼 목표 자체가 숫자일 때. 아래에는 과제만 답니다.</p>
              </>
            ) : (
              <>
                {metrics.map((m, i) => <MetricFields key={i} m={m} set={(x) => setMetrics(metrics.map((y, j) => (j === i ? x : y)))} onRemove={metrics.length > 1 ? () => setMetrics(metrics.filter((_, j) => j !== i)) : undefined} />)}
                {metrics.length < 5 && <button onClick={() => setMetrics([...metrics, blank()])} className="text-xs font-semibold text-indigo-700 inline-flex items-center gap-1"><Plus size={13} />지표 더하기</button>}
              </>
            )}
          </div>
        </div>
        <p className="text-[11px] text-slate-400">과제는 목표를 만든 뒤 아래에 더할 수 있어요.</p>
        <Button className="w-full" disabled={!ok} loading={busy} onClick={save}>목표 세우기</Button>
      </div>
    </Modal>
  );
}

/** 기존 목표에 지표 더하기 */
export function MetricModal({ open, onClose, goal }: { open: boolean; onClose: () => void; goal: WorkItem }) {
  const { team, uid, isLeader, members } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [m, setM] = useState<MetricDraft>(blank());
  const [owner, setOwner] = useState(goal.owner_id ?? uid);
  const [metricId, setMetricId] = useState('');
  const [busy, setBusy] = useState(false);
  const metricsQ = useQuery({ queryKey: ['metrics', team.id], enabled: isLeader && open, queryFn: () => q<Metric[]>(supabase.from('metrics').select('*').eq('team_id', team.id)) });
  const save = async () => {
    setBusy(true);
    try {
      await q(supabase.from('work_items').insert({
        team_id: team.id, parent_id: goal.id, title: m.title.trim(), owner_id: isLeader ? owner : uid, role: 'metric', sort: Date.now() / 1000,
        status: isLeader ? 'active' : 'proposed', start_date: goal.start_date, due_date: goal.due_date, ...toRow(m),
        ...(isLeader && metricId && m.kind === 'number' ? { metric_id: metricId } : {}),
      }));
      qc.invalidateQueries({ queryKey: ['items', team.id] });
      toast('지표를 더했습니다'); setM(blank()); onClose();
    } catch (e) { toast(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={<span>지표 더하기 <span className="text-xs font-normal text-slate-400">· {goal.title}</span></span>}>
      <div className="space-y-3">
        <MetricFields m={m} set={setM} />
        {isLeader && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="담당"><select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
              {members.map((x) => <option key={x.user_id} value={x.user_id}>{x.profiles?.full_name}</option>)}
            </select></Field>
            {m.kind === 'number' && (
              <Field label="실적 데이터와 연결" hint="연결하면 월 실적이 값이 됩니다">
                <select className={inputCls} value={metricId} onChange={(e) => setMetricId(e.target.value)}>
                  <option value="">연결 안 함 (성과입력으로)</option>{(metricsQ.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select></Field>
            )}
          </div>
        )}
        <Button className="w-full" disabled={!valid(m)} loading={busy} onClick={save}>지표 더하기</Button>
      </div>
    </Modal>
  );
}
