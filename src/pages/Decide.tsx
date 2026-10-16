// 의사결정 보드 — 수많은 기록에서 결정이 필요한 것과 지켜볼 리스크를 한 판에
//   왼쪽 60%: 지켜볼 리스크 → 결정 필요 → 검토 중 → 결정함 → 회고 대기 (5단 보드, 세로로 길게)  /  오른쪽 40%: 선택한 카드 상세 + 성과 영향 × 시급성 지도
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Check, ChevronRight, Eye, Gavel, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import type { Decision } from '../lib/types';
import type { Signal } from '../lib/insights';
import { cx, daysAgo, fmtDate, fmtShort } from '../lib/format';
import { Button, Card, Field, Modal, Spinner, inputCls, useToast } from '../components/ui';
import { AiBar } from '../components/AiBar';
import { EvidenceChips, riskCards, useBoard, usePriorities, type Prio } from '../components/decide/priorities';
import { MemoModal, PeriodTabs, STATUS_META, todayYmd, useHomeModel, usePeriod, useSignalAct } from '../components/home/shared';

type Sel = { kind: 'prio'; p: Prio; no: number } | { kind: 'risk'; key: string; s: Signal; no: number } | null;
const RATING = { hit: { label: '적중', cls: 'bg-emerald-50 text-emerald-700' }, partial: { label: '일부', cls: 'bg-amber-50 text-amber-800' }, miss: { label: '빗나감', cls: 'bg-rose-50 text-rose-700' } } as const;

export default function Decide() {
  const { team } = useTeam();
  const [params] = useSearchParams();
  const [period, setPeriod] = usePeriod();
  const m = useHomeModel(period);
  const board = useBoard(team.id);
  const all = usePriorities(m, { hidden: true });
  const stageOf = (k: string) => board.map.get(k)?.stage;
  const need = all.filter((p) => !stageOf(p.key) || stageOf(p.key) === 'promoted');
  const reviewing = all.filter((p) => stageOf(p.key) === 'reviewing');
  const watchingPrio = all.filter((p) => stageOf(p.key) === 'watching');
  const risks = riskCards(m, board);
  const decisions = useQuery({ queryKey: ['decisions', team.id], queryFn: () => q<Decision[]>(supabase.from('decisions').select('*').eq('team_id', team.id).order('decided_at', { ascending: false }).limit(40)) });
  const today = todayYmd();
  const isDue = (d: Decision) => !d.outcome_rating && (d.review_on ? d.review_on <= today : daysAgo(d.decided_at) >= 30);
  const decided = (decisions.data ?? []).filter((d) => !d.outcome_rating && !isDue(d));
  const due = (decisions.data ?? []).filter(isDue);
  const rated = (decisions.data ?? []).filter((d) => d.outcome_rating);
  const hitRate = rated.length ? Math.round(((rated.filter((d) => d.outcome_rating === 'hit').length + rated.filter((d) => d.outcome_rating === 'partial').length * 0.5) / rated.length) * 100) : null;

  // 번호: 결정 1..n (점수순), 리스크 R1..
  const active = [...need, ...reviewing].sort((a, b) => b.score - a.score);
  const noOf = new Map(active.map((p, i) => [p.key, i + 1]));
  const [sel, setSel] = useState<Sel>(null);
  const firstSel: Sel = params.get('f') === 'risk' && risks[0] ? { kind: 'risk', key: risks[0].key, s: risks[0].s, no: 1 } : active[0] ? { kind: 'prio', p: active[0], no: 1 } : risks[0] ? { kind: 'risk', key: risks[0].key, s: risks[0].s, no: 1 } : null;
  const cur = sel ?? firstSel;

  const [rec, setRec] = useState<{ open: boolean; p?: Prio }>({ open: false });
  const [outcome, setOutcome] = useState<Decision | null>(null);
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const act = useSignalAct((who) => setMemo({ open: true, who }));
  const st = m.loading ? null : STATUS_META[m.status.decide];
  const move = (key: string, title: string, stage: Parameters<typeof board.set.mutate>[0]['stage']) => { board.set.mutate({ key, title, stage }); setSel(null); };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center shadow-sm"><Gavel size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">의사결정
              {st && <span className={cx('text-xs font-semibold border rounded-full px-2 py-0.5', st.cls)}>{st.label}</span>}</h1>
            <p className="text-sm text-slate-500">목표 · 팀원 · 위에서 온 것 · 결과물 — 경계 없이 결정이 필요한 것과 리스크를 한 판에 모읍니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodTabs period={period} setPeriod={setPeriod} />
          <Button onClick={() => setRec({ open: true })}><Plus size={15} />결정 기록</Button>
        </div>
      </div>

      <AiBar section="decide" label="의사결정" />

      {/* 본문: 왼쪽 단계별 보드(세로) · 오른쪽 선택한 카드 + 결정 지도 */}
      <div className="flex items-center gap-2 flex-wrap"><Gavel size={15} className="text-slate-700" /><span className="font-semibold">의사결정 보드</span>
        <span className="text-xs text-slate-400">지켜볼 리스크부터 회고까지 단계별로 추적 · 카드를 누르면 오른쪽에 상세와 지도 위치가 보입니다</span></div>
      <div className="grid lg:grid-cols-5 gap-4 items-stretch">
        <div className="lg:col-span-3 overflow-x-auto -mx-1 px-1"><div className="grid grid-cols-5 gap-2 min-w-[560px] h-full min-h-[600px]">
          <Col title="지켜볼 리스크" tone="rose" n={risks.length + watchingPrio.length} hint="결정이 필요해지면 올립니다">
            {risks.map((r, i) => <MiniCard key={r.key} on={cur?.kind === 'risk' && cur.key === r.key} onClick={() => setSel({ kind: 'risk', key: r.key, s: r.s, no: i + 1 })}
              badge={<span className="text-rose-600 font-bold">R{i + 1}</span>} kind={r.s.severity >= 3 ? '지금 확인' : '주의'} title={r.s.title} />)}
            {watchingPrio.map((p) => <MiniCard key={p.key} on={cur?.kind === 'prio' && cur.p.key === p.key} onClick={() => setSel({ kind: 'prio', p, no: 0 })} badge={<Eye size={12} className="text-slate-400" />} kind={`${p.kind} · 지켜보기`} title={p.title} />)}
          </Col>
          <Col title="결정 필요" tone="slate" n={need.length} hint="성과에 걸린 순서">
            {need.map((p) => <MiniCard key={p.key} on={cur?.kind === 'prio' && cur.p.key === p.key} onClick={() => setSel({ kind: 'prio', p, no: noOf.get(p.key)! })}
              badge={<b className="num">{noOf.get(p.key)}</b>} kind={p.kind} ai={p.ai} title={p.title} />)}
          </Col>
          <Col title="검토 중" tone="indigo" n={reviewing.length} hint="선택지를 따져 보는 중">
            {reviewing.map((p) => <MiniCard key={p.key} on={cur?.kind === 'prio' && cur.p.key === p.key} onClick={() => setSel({ kind: 'prio', p, no: noOf.get(p.key)! })}
              badge={<b className="num">{noOf.get(p.key)}</b>} kind={p.kind} ai={p.ai} title={p.title} />)}
          </Col>
          <Col title="결정함" tone="emerald" n={decided.length} hint={hitRate != null ? `판단 적중률 ${hitRate}% (${rated.length}건)` : '기대한 결과와 검증일을 남겨 둡니다'}>
            {decided.slice(0, 8).map((d) => (
              <div key={d.id} className="rounded-xl bg-white ring-1 ring-slate-200 p-2 text-[13px]">
                <div className="font-medium leading-snug">{d.title}</div>
                <div className="mt-1 text-[11px] text-slate-500">{fmtShort(d.decided_at)} 결정{d.review_on && ` · ${fmtShort(d.review_on)} 검증`}</div>
                {d.expected_outcome && <div className="text-[11px] text-slate-500 line-clamp-1">기대: {d.expected_outcome}</div>}
              </div>
            ))}
          </Col>
          <Col title="회고 대기" tone="amber" n={due.length} hint="결과를 기록하면 판단 적중률이 됩니다">
            {due.map((d) => (
              <button key={d.id} onClick={() => setOutcome(d)} className="w-full text-left rounded-xl bg-white ring-1 ring-amber-200 p-2 text-[13px] hover:ring-amber-400">
                <div className="font-medium leading-snug">{d.title}</div>
                <div className="mt-1 text-[11px] text-amber-800 font-semibold">결과 기록하기 →</div>
                <div className="text-[11px] text-slate-500">{fmtShort(d.decided_at)} 결정 · 기대: {d.expected_outcome || '-'}</div>
              </button>
            ))}
            {rated.slice(0, 3).map((d) => (
              <div key={d.id} className="rounded-xl bg-white/70 p-2 text-xs flex items-center gap-1.5"><span className={cx('shrink-0 font-semibold rounded px-1.5 py-0.5', RATING[d.outcome_rating!].cls)}>{RATING[d.outcome_rating!].label}</span><span className="truncate">{d.title}</span></div>
            ))}
          </Col>
        </div></div>
        <div className="lg:col-span-2 space-y-4">
          <Card className="p-5 flex flex-col">
            {!cur ? <p className="text-sm text-slate-400 m-auto">지금 결정할 것도, 커지는 리스크도 없습니다.</p>
              : cur.kind === 'prio' ? <PrioDetail p={cur.p} no={noOf.get(cur.p.key) ?? cur.no} stage={stageOf(cur.p.key)} onAct={act}
                onReview={() => move(cur.p.key, cur.p.title, 'reviewing')} onBack={() => move(cur.p.key, cur.p.title, null)}
                onWatch={() => move(cur.p.key, cur.p.title, 'watching')} onDismiss={() => move(cur.p.key, cur.p.title, 'dismissed')} onRecord={() => setRec({ open: true, p: cur.p })} />
              : <RiskDetail s={cur.s} no={cur.no} onAct={act} onPromote={() => move(cur.key, cur.s.title, 'promoted')} onDismiss={() => move(cur.key, cur.s.title, 'dismissed')} />}
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-500">
              <span className="font-semibold text-sm text-slate-800">결정 지도</span>
              <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-slate-900 text-white text-[9px] flex items-center justify-center font-bold">1</span>결정할 것</span>
              <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full ring-2 ring-violet-400 bg-slate-900" />AI가 찾은 결정</span>
              <span className="inline-flex items-center gap-1"><span className="w-3.5 h-3.5 rounded-full bg-rose-100 ring-2 ring-rose-400" />지켜볼 리스크</span>
              <span className="ml-auto">위치는 AI·규칙이 매긴 성과 영향과 시급성</span>
            </div>
            {m.loading ? <Spinner /> : <Matrix active={active} risks={risks} noOf={noOf} sel={cur} onSel={setSel} reviewingKeys={new Set(reviewing.map((p) => p.key))} />}
          </Card>
        </div>
      </div>

      <RecordModal open={rec.open} p={rec.p} onClose={() => setRec({ open: false })} onSaved={(id) => { if (rec.p) board.set.mutate({ key: rec.p.key, title: rec.p.title, stage: 'decided', decision_id: id }); setSel(null); }} />
      <OutcomeModal d={outcome} onClose={() => setOutcome(null)} />
      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
    </div>
  );
}

// ---------------------------------------------------------------------
function Matrix({ active, risks, noOf, sel, onSel, reviewingKeys }: {
  active: Prio[]; risks: ReturnType<typeof riskCards>; noOf: Map<string, number>; sel: Sel; onSel: (s: Sel) => void; reviewingKeys: Set<string>;
}) {
  // 겹치는 점은 조금씩 비켜 놓는다
  const placed: { x: number; y: number }[] = [];
  const nudge = (x: number, y: number) => {
    let nx = x, ny = y;
    for (let i = 0; i < 8 && placed.some((p) => Math.abs(p.x - nx) < 0.05 && Math.abs(p.y - ny) < 0.07); i++) { nx += 0.045 * (i % 2 ? -1 : 1); ny -= 0.05; }
    placed.push({ x: nx, y: ny });
    return { x: Math.max(0.05, Math.min(0.88, nx)), y: Math.max(0.12, Math.min(0.84, ny)) };
  };
  return (
    <div className="mt-3 relative h-[330px] rounded-xl overflow-hidden ring-1 ring-slate-200">
      <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
        <Quad label="계획해서 결정" sub="영향 큼 · 여유 있음" cls="bg-slate-50" pos="tl" />
        <Quad label="지금 결정" sub="영향 큼 · 급함" cls="bg-violet-50/70" pos="tr" />
        <Quad label="지켜보기" sub="영향 작음 · 여유 있음" cls="bg-white" pos="bl" />
        <Quad label="빠르게 처리" sub="영향 작음 · 급함" cls="bg-slate-50/60" pos="br" />
      </div>
      <span className="absolute left-1/2 top-1.5 -translate-x-1/2 text-[10px] text-slate-400">↑ 성과 영향</span>
      <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-slate-400">시급성 →</span>
      {risks.map((r, i) => {
        const p = nudge(r.x, r.y);
        const on = sel?.kind === 'risk' && sel.key === r.key;
        return (
          <button key={r.key} onClick={() => onSel({ kind: 'risk', key: r.key, s: r.s, no: i + 1 })} title={r.s.title}
            className={cx('absolute -translate-x-1/2 translate-y-1/2 w-6 h-6 rounded-full bg-rose-100 ring-2 ring-rose-400 text-[9px] font-bold text-rose-700 flex items-center justify-center transition-transform hover:scale-110', on && 'scale-125 ring-4 z-20')}
            style={{ left: `${p.x * 100}%`, bottom: `${p.y * 100}%` }}>R{i + 1}</button>
        );
      })}
      {active.map((pr) => {
        const p = nudge(pr.x, pr.y);
        const on = sel?.kind === 'prio' && sel.p.key === pr.key;
        const no = noOf.get(pr.key)!;
        return (
          <button key={pr.key} onClick={() => onSel({ kind: 'prio', p: pr, no })} title={pr.title}
            className={cx('absolute -translate-x-1/2 translate-y-1/2 w-8 h-8 rounded-full text-white text-xs font-bold flex items-center justify-center shadow-md transition-transform hover:scale-110 z-10',
              reviewingKeys.has(pr.key) ? 'bg-indigo-600' : 'bg-slate-900', pr.ai && 'ring-2 ring-violet-400', on && 'scale-125 ring-4 ring-violet-300 z-20')}
            style={{ left: `${p.x * 100}%`, bottom: `${p.y * 100}%` }}>{no}</button>
        );
      })}
      {!active.length && !risks.length && <p className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">표시할 것이 없습니다</p>}
    </div>
  );
}
function Quad({ label, sub, cls, pos }: { label: string; sub: string; cls: string; pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  return (
    <div className={cx('relative border-slate-200', cls, pos === 'tl' && 'border-r border-b', pos === 'tr' && 'border-b', pos === 'bl' && 'border-r')}>
      <div className={cx('absolute text-[11px] leading-tight', pos[0] === 't' ? 'top-2' : 'bottom-5', pos[1] === 'l' ? 'left-6' : 'right-2.5 text-right')}>
        <div className={cx('font-semibold', pos === 'tr' ? 'text-violet-800' : 'text-slate-500')}>{label}</div><div className="text-[10px] text-slate-400">{sub}</div>
      </div>
    </div>
  );
}

function PrioDetail({ p, no, stage, onAct, onReview, onBack, onWatch, onDismiss, onRecord }: {
  p: Prio; no: number; stage?: string; onAct: (s: Signal) => void; onReview: () => void; onBack: () => void; onWatch: () => void; onDismiss: () => void; onRecord: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="w-6 h-6 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center">{no || '·'}</span>
        <span className="font-semibold text-slate-600">{p.kind}</span>
        {p.ai && <span className="text-violet-700 font-semibold inline-flex items-center gap-0.5"><Sparkles size={11} />AI가 엮은 판단</span>}
        {stage === 'reviewing' && <span className="ml-auto rounded-full bg-indigo-50 text-indigo-700 font-semibold px-2 py-0.5">검토 중</span>}
        {stage === 'watching' && <span className="ml-auto rounded-full bg-slate-100 text-slate-600 font-semibold px-2 py-0.5">지켜보기</span>}
      </div>
      <h3 className="mt-2 text-lg font-bold leading-snug tracking-tight">{p.title}</h3>
      {p.why && <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{p.why}</p>}
      {p.impact && <div className="mt-2.5 rounded-xl bg-indigo-50 ring-1 ring-indigo-100 px-3 py-2 text-sm"><span className="text-[11px] font-bold text-indigo-700 block">기대 효과 · 걸린 목표</span>{p.impact}</div>}
      {!!p.options?.length && (
        <ol className="mt-2.5 space-y-1.5">{p.options.slice(0, 3).map((o, i) => <li key={i} className="text-sm rounded-lg ring-1 ring-slate-200 px-2.5 py-1.5 flex gap-2"><b className="text-indigo-600">{String.fromCharCode(65 + i)}</b>{o}</li>)}</ol>
      )}
      {p.evidence.length > 0 && <div className="mt-2.5"><div className="text-[11px] font-bold text-slate-500 mb-1">근거</div><EvidenceChips list={p.evidence} onAct={onAct} /></div>}
      <div className="mt-auto pt-4 flex items-center gap-1.5 flex-wrap">
        <Button size="sm" onClick={onRecord}><Check size={13} />결정 기록</Button>
        {stage === 'reviewing' || stage === 'watching' ? <Button size="sm" variant="secondary" onClick={onBack}><RotateCcw size={13} />결정 필요로</Button>
          : <Button size="sm" variant="secondary" onClick={onReview}>검토 시작</Button>}
        {stage !== 'watching' && <Button size="sm" variant="ghost" onClick={onWatch}><Eye size={13} />지켜보기</Button>}
        <Button size="sm" variant="ghost" onClick={onDismiss}><X size={13} />빼기</Button>
        {p.to && <Link to={p.to} className="ml-auto text-xs font-semibold text-indigo-700 inline-flex items-center">{p.action ?? '관련 화면'}<ChevronRight size={13} /></Link>}
      </div>
    </>
  );
}

function RiskDetail({ s, no, onAct, onPromote, onDismiss }: { s: Signal; no: number; onAct: (s: Signal) => void; onPromote: () => void; onDismiss: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="w-6 h-6 rounded-full bg-rose-100 ring-2 ring-rose-400 text-rose-700 font-bold flex items-center justify-center text-[9px]">R{no}</span>
        <span className="font-semibold text-rose-700">{s.severity >= 3 ? '지금 확인' : '주의'} · 리스크</span>
      </div>
      <h3 className="mt-2 text-lg font-bold leading-snug tracking-tight">{s.title}</h3>
      {s.detail && <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{s.detail}</p>}
      <p className="mt-2.5 text-xs text-slate-500 rounded-lg bg-slate-50 px-3 py-2">자동 감지 · {s.rule}</p>
      <div className="mt-auto pt-4 flex items-center gap-1.5 flex-wrap">
        <Button size="sm" onClick={onPromote}><ArrowUpRight size={13} />결정으로 올리기</Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}><X size={13} />빼기</Button>
        {s.action && <button onClick={() => onAct(s)} className="ml-auto text-xs font-semibold text-indigo-700 inline-flex items-center">{s.action.label}<ChevronRight size={13} /></button>}
      </div>
    </>
  );
}

function Col({ title, n, hint, tone, children }: { title: string; n: number; hint?: string; tone: 'rose' | 'slate' | 'indigo' | 'emerald' | 'amber'; children: ReactNode }) {
  const bar = { rose: 'bg-rose-400', slate: 'bg-slate-800', indigo: 'bg-indigo-500', emerald: 'bg-emerald-500', amber: 'bg-amber-400' }[tone];
  return (
    <section className="rounded-2xl bg-slate-100/70 p-2 flex flex-col h-full">
      <div className="px-1 pb-2">
        <div className="flex items-center gap-2"><span className={cx('w-2 h-2 rounded-full', bar)} /><span className="text-sm font-semibold">{title}</span><span className="ml-auto text-xs text-slate-500 num">{n}</span></div>
        {hint && <div className="text-[10px] text-slate-400 mt-0.5 leading-snug">{hint}</div>}
      </div>
      <div className="space-y-2">{n ? children : <p className="text-xs text-slate-400 px-1">없음</p>}</div>
    </section>
  );
}
function MiniCard({ badge, kind, title, ai, on, onClick }: { badge: ReactNode; kind: string; title: string; ai?: boolean; on?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx('w-full text-left rounded-xl bg-white p-2 ring-1 transition-shadow', on ? 'ring-2 ring-violet-500 shadow-md' : 'ring-slate-200 hover:ring-slate-300')}>
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500"><span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] text-slate-800">{badge}</span>{kind}
        {ai && <span className="ml-auto text-violet-700 font-semibold inline-flex items-center gap-0.5"><Sparkles size={10} />AI</span>}</div>
      <div className="mt-1 text-[13px] font-medium leading-snug line-clamp-4" title={title}>{title}</div>
    </button>
  );
}

// ---------------------------------------------------------------------
function RecordModal({ open, p, onClose, onSaved }: { open: boolean; p?: Prio; onClose: () => void; onSaved: (id: string) => void }) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const plus30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const init = useMemo(() => ({ title: p?.title.replace(/할지[,，].*$/, '').replace(/할지$/, '') ?? '', rationale: p?.why ?? '', expected_outcome: p?.impact ?? '', review_on: plus30, pick: -1 }), [p, plus30]);
  const [f, setF] = useState(init);
  const [last, setLast] = useState(p);
  if (last !== p) { setLast(p); setF(init); }
  const save = useMutation({
    mutationFn: () => q<Decision>(supabase.from('decisions').insert({
      team_id: team.id, decided_by: uid, title: f.pick >= 0 && p?.options ? `${p.options[f.pick]}` : f.title,
      rationale: [f.pick >= 0 && p ? `결정할 것: ${p.title}` : '', f.rationale].filter(Boolean).join('\n'), expected_outcome: f.expected_outcome, review_on: f.review_on || null,
    }).select().single()),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['decisions'] }); qc.invalidateQueries({ queryKey: ['home-insights'] }); qc.invalidateQueries({ queryKey: ['recent-decisions'] }); toast('결정을 기록했습니다. 검증일에 결과를 남기면 판단 적중률이 됩니다.'); onSaved(d.id); onClose(); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title="결정 기록">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        {p && <p className="text-sm rounded-lg bg-slate-50 px-3 py-2"><span className="text-[11px] text-slate-500 block">결정할 것</span>{p.title}</p>}
        {!!p?.options?.length && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-600">고른 선택지</div>
            {p.options.map((o, i) => (
              <button type="button" key={i} onClick={() => setF({ ...f, pick: i })} className={cx('w-full text-left text-sm rounded-lg border px-3 py-2', f.pick === i ? 'border-indigo-500 bg-indigo-50 font-semibold' : 'border-slate-200')}>
                <b className="text-indigo-600 mr-1.5">{String.fromCharCode(65 + i)}</b>{o}</button>
            ))}
            <button type="button" onClick={() => setF({ ...f, pick: -1 })} className={cx('w-full text-left text-sm rounded-lg border px-3 py-2', f.pick === -1 ? 'border-indigo-500 bg-indigo-50 font-semibold' : 'border-slate-200')}>직접 쓰기</button>
          </div>
        )}
        {f.pick === -1 && <Field label="결정"><input required className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="예) 제휴 목표를 16만 명으로 조정" /></Field>}
        <Field label="근거"><textarea rows={2} className={inputCls} value={f.rationale} onChange={(e) => setF({ ...f, rationale: e.target.value })} /></Field>
        <Field label="기대하는 결과"><input className={inputCls} value={f.expected_outcome} onChange={(e) => setF({ ...f, expected_outcome: e.target.value })} /></Field>
        <Field label="검증할 날"><input type="date" className={inputCls} value={f.review_on} onChange={(e) => setF({ ...f, review_on: e.target.value })} /></Field>
        <Button type="submit" className="w-full" loading={save.isPending}>기록</Button>
      </form>
    </Modal>
  );
}

function OutcomeModal({ d, onClose }: { d: Decision | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rating, setRating] = useState<'hit' | 'partial' | 'miss'>('hit');
  const [text, setText] = useState('');
  const save = useMutation({
    mutationFn: () => q(supabase.from('decisions').update({ outcome: text, outcome_rating: rating }).eq('id', d!.id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['decisions'] }); qc.invalidateQueries({ queryKey: ['home-insights'] }); toast('결과를 기록했습니다. 판단 적중률에 반영됩니다.'); setText(''); onClose(); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Modal open={!!d} onClose={onClose} title={`결과 기록 · ${d?.title ?? ''}`}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className="text-sm text-slate-600">{d && `${fmtDate(d.decided_at)} 결정`} · 기대: {d?.expected_outcome || '-'}</p>
        <div className="grid grid-cols-3 gap-2 text-sm">
          {(['hit', 'partial', 'miss'] as const).map((r) => (
            <button type="button" key={r} onClick={() => setRating(r)} className={cx('border rounded-lg py-2', rating === r ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>{RATING[r].label}</button>
          ))}
        </div>
        <Field label="실제 결과"><textarea rows={2} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <Button type="submit" className="w-full" loading={save.isPending}>저장</Button>
      </form>
    </Modal>
  );
}
