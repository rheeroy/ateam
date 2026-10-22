// 성과입력 화면 조각 — 입력(모달) · 스트림 카드(작게) · 스레드 패널 내용 · 항목의 성과입력 이력
//   (코드·DB 이름은 checkin 그대로. 화면 이름만 '성과입력')
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, CheckCircle2, Crosshair, FileText, MessageSquare, RotateCcw } from 'lucide-react';
import { useTeam } from '../../state/session';
import { buildTree, useItems, type Node } from '../../lib/items';
import {
  checkinTypeFor, currentLabel, latestPayload, payloadLabel, payloadPct, useCreateCheckin, useDecideCheckin, useItemCheckins,
} from '../../lib/checkin';
import type { CheckinPayload, CheckinType, Submission, SubmissionVersion, WorkItem } from '../../lib/types';
import { cx, fmtDate, fmtShort } from '../../lib/format';
import { Button, Modal, inputCls } from '../ui';
import { GuidePanel, GuideSection } from '../GuidePanel';

type Evidence = NonNullable<CheckinPayload['evidence']>[number];

/** 성과입력 정의 — 화면 여러 곳(안내 카드 · 입력 창 · 버튼 설명)이 같은 말을 쓴다 */
export const PERF_DEF = '목표 달성에 대한 공식 성과를 입력하고 팀장님 승인을 받는 기능입니다';
export const PERF_TIP = '목표 달성에 대한 공식 성과를 입력하고 팀장님 승인을 받는 기능입니다. 승인되면 팀목표의 공식 진척에 반영됩니다';

/** 성과입력이 어떻게 반영되는지 — 3단계 */
export function PerfFlow({ className }: { className?: string }) {
  const steps = ['내가 입력', '팀장님 승인', '팀목표 진척에 반영'];
  return (
    <ol className={cx('flex items-center gap-1.5 text-[11px] text-slate-500', className)}>
      {steps.map((t, i) => (
        <li key={t} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate-300">→</span>}
          <span className="inline-flex items-center gap-1"><span className="w-4 h-4 rounded-full bg-slate-800 text-white text-[10px] font-bold flex items-center justify-center num">{i + 1}</span>{t}</span>
        </li>
      ))}
    </ol>
  );
}

/** 예전 안내 카드를 닫은 기록 — 있으면 첫 말풍선을 띄우지 않는다 */
export const PERF_GUIDE_LEGACY = 'ateam.guide.perf-input';

/** 팀목표 [ⓘ 성과입력 가이드] → 오른쪽 도움말 패널 (한 장짜리, 단계 넘김 없음) */
export function PerfGuidePanel({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart?: () => void }) {
  const EX: [string, string][] = [
    ['숫자 지표', '신규 계약 12건 → 15건'],
    ['단계 목표', '기획 → 개발 착수'],
    ['한 번에 끝나는 일', '완료로 표시'],
    ['숫자로 못 재는 성과', '고객 인터뷰 12건, 핵심 니즈 3개 도출'],
  ];
  const FLOW: [string, string][] = [
    ['내가 입력', '목표·과제를 고르고 지금 값(또는 성과)과 한 줄 설명, 필요하면 근거 자료를 붙입니다.'],
    ['팀장님 승인', '팀장님이 보고 승인하거나 보완을 요청합니다. 보완 요청이 오면 고쳐서 다시 올립니다.'],
    ['팀목표 진척에 반영', '승인된 값이 팀목표의 공식 진척이 됩니다.'],
  ];
  return (
    <GuidePanel open={open} onClose={onClose} title="성과입력" icon={<span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Crosshair size={15} /></span>}
      footer={onStart ? <><Button variant="ghost" size="sm" onClick={onClose}>닫기</Button><Button size="sm" onClick={() => { onClose(); onStart(); }}><Crosshair size={13} />성과입력 하기</Button></> : undefined}>
      <GuideSection title="성과입력이란">
        <p><b className="text-slate-800">{PERF_DEF}.</b></p>
        <p>일하면서 나눈 대화나 올린 자료는 그 자체로는 진척에 반영되지 않습니다. 성과입력으로 올려 승인받아야 공식 성과가 됩니다.</p>
      </GuideSection>
      <GuideSection title="어떻게 반영되나요">
        <ol className="space-y-2.5">
          {FLOW.map(([t, d], i) => (
            <li key={t} className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-slate-800 text-white text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5 num">{i + 1}</span>
              <span><b className="block text-slate-800 font-semibold">{t}</b>{d}</span>
            </li>
          ))}
        </ol>
      </GuideSection>
      <GuideSection title="무엇을 올리나요">
        <p>목표·과제에 정한 방식에 맞춰 입력 칸이 바뀝니다.</p>
        <div className="grid grid-cols-2 gap-1.5">
          {EX.map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-3 py-2 text-xs"><span className="text-slate-500">{k}</span><span className="block text-slate-800 font-medium mt-0.5">{v}</span></div>
          ))}
        </div>
      </GuideSection>
      <GuideSection title="언제 하나요">
        <ul className="list-disc pl-4 space-y-1">
          <li>숫자가 바뀌었을 때</li>
          <li>단계가 넘어갔을 때</li>
          <li>일이 끝났을 때</li>
        </ul>
        <p>업무플랫폼에 올린 결과물에서 바로 성과입력을 할 수도 있습니다.</p>
      </GuideSection>
    </GuidePanel>
  );
}

// ---------------------------------------------------------------------
// 입력 — 어느 목표에 · 지금 값(또는 성과) · 한 줄 · 근거
// ---------------------------------------------------------------------
export function CheckinModal({ open, onClose, itemId, evidence, recent, spaceId, groupId, resubmit }: {
  open: boolean; onClose: () => void; itemId?: string | null; evidence?: Evidence | null;
  /** 근거로 고를 수 있는 최근 업무 카드 */ recent?: { id: string; title: string }[];
  spaceId?: string | null; groupId?: string | null;
  resubmit?: { id: string; version: number; payload: CheckinPayload | null; note: string } | null;
}) {
  const { team, uid } = useTeam();
  const items = useItems(team.id);
  const { byId } = useMemo(() => buildTree(items.data ?? []), [items.data]);
  // 내가 맡은 목표·과제 (진행 중)
  const mine = useMemo(() => [...byId.values()]
    // 지표 · 숫자를 건 목표 · 과제 (지표로 판단하는 목표 자체에는 입력하지 않는다 — 그 아래 지표에)
    .filter((n) => n.owner_id === uid && n.depth <= 1 && ['active', 'blocked'].includes(n.status) && !(n.depth === 0 && n.measure === 'children'))
    .sort((a, b) => Number(b.role === 'metric' || b.depth === 0) - Number(a.role === 'metric' || a.depth === 0))
    .sort((a, b) => a.path.concat(a.id).join('/').localeCompare(b.path.concat(b.id).join('/'))), [byId, uid]);
  const [pick, setPick] = useState<string>(itemId ?? '');
  const n = byId.get(pick || itemId || '') ?? (resubmit ? null : mine[0] ?? null);
  const linked = !!n?.metric_id;   // 실적 데이터와 연결된 지표: 값은 실적이 정한다 → 서술만
  const base = n && !linked ? checkinTypeFor(n) : 'note';
  const [asNote, setAsNote] = useState(resubmit?.payload?.type === 'note');
  const type: CheckinType = asNote ? 'note' : base;
  const [value, setValue] = useState<string>(resubmit?.payload?.value != null ? String(resubmit.payload.value) : '');
  const [stage, setStage] = useState<number | null>(resubmit?.payload?.stage ?? null);
  const [note, setNote] = useState(resubmit?.note ?? '');
  const [ev, setEv] = useState<Evidence[]>(resubmit?.payload?.evidence ?? (evidence ? [evidence] : []));
  const create = useCreateCheckin();

  const payload: CheckinPayload | null = !n ? null
    : type === 'number' || type === 'percent' ? (value.trim() === '' ? null : { type, value: Number(value) })
    : type === 'stage' ? (stage ? { type, stage } : null)
    : type === 'done' ? { type }
    : note.trim() ? { type: 'note' } : null;
  const full = payload && n ? { ...payload, prev: currentLabel(n), label: type === 'note' ? null : payloadLabel(payload, n), evidence: ev } : null;
  const pct = full && n ? payloadPct(full, n) : null;
  const submit = () => full && n && create.mutate({ item: n, payload: full, note: note.trim(), spaceId, groupId, resubmit: resubmit ? { id: resubmit.id, version: resubmit.version } : undefined }, { onSuccess: onClose });

  return (
    <Modal open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Crosshair size={16} className="text-indigo-600" />성과입력</span>}>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-slate-600">{PERF_DEF}.</p>
          <PerfFlow className="mt-2" />
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">어느 목표에</div>
          {resubmit && n ? <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm"># {n.title}</div> : !mine.length ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">진행 중인 내 목표·과제가 없습니다. 팀목표에서 승인된 항목에 성과입력을 할 수 있어요.</p>
          ) : (
            <select className={inputCls} value={n?.id ?? ''} onChange={(e) => { setPick(e.target.value); setValue(''); setStage(null); setAsNote(false); }}>
              {mine.map((m) => <option key={m.id} value={m.id}>{m.role === 'metric' || m.depth === 0 ? '[지표] ' : '[과제] '}{m.title} — 지금 {currentLabel(m)}{m.measure === 'number' && m.num_target != null ? ` / ${m.num_target}${m.unit}` : ''}</option>)}
            </select>
          )}
        </div>

        {!n ? null : <>
        {linked && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">이 지표는 월별 실적 데이터로 값이 자동 반영됩니다. 여기에는 무엇이 그 숫자를 만들었는지만 남겨 주세요.</p>}
        {(base !== 'note') && (
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs w-fit">
            <button onClick={() => setAsNote(false)} className={cx('px-3 py-1 rounded-md', !asNote ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>{base === 'done' ? '완료' : base === 'stage' ? '단계' : '숫자'}로 입력</button>
            <button onClick={() => setAsNote(true)} className={cx('px-3 py-1 rounded-md', asNote ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>서술로 입력</button>
          </div>
        )}

        {n && type === 'number' && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">지금 값 <span className="font-normal text-slate-400">· 지금 공식 {currentLabel(n)}</span></div>
            <div className="flex items-center gap-2">
              <input type="number" inputMode="decimal" className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-xl font-bold num" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
              <span className="font-semibold">{n.unit}</span>
              {n.num_target != null && <span className="text-sm text-slate-500">/ {n.num_target}{n.unit}{pct != null && <b className="ml-1.5 text-indigo-700">→ {pct}%</b>}</span>}
            </div>
          </div>
        )}
        {n && type === 'percent' && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">진척률 <span className="font-normal text-slate-400">· 지금 공식 {n.progress}%</span></div>
            <div className="flex items-center gap-3">
              <input type="range" min={0} max={100} step={5} className="flex-1 accent-indigo-600" value={value === '' ? n.progress : Number(value)} onChange={(e) => setValue(e.target.value)} aria-label="진척률" />
              <span className="w-12 text-right font-bold num">{value === '' ? n.progress : value}%</span>
            </div>
          </div>
        )}
        {n && type === 'stage' && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">어디까지 왔나 <span className="font-normal text-slate-400">· 지금 {currentLabel(n)}</span></div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(n.stages ?? []).map((s, i) => (
                <button key={i} onClick={() => setStage(i + 1)} className={cx('rounded-full px-3 py-1 text-sm ring-1',
                  stage === i + 1 ? 'bg-indigo-600 text-white ring-indigo-600 font-semibold' : (n.stage_current ?? 0) > i ? 'bg-indigo-50 text-indigo-700 ring-indigo-200' : 'bg-white text-slate-600 ring-slate-200')}>{i + 1}. {s}</button>
              ))}
              {!(n.stages ?? []).length && <span className="text-xs text-slate-400">단계 이름이 아직 없습니다. 팀목표에서 단계를 정해 주세요.</span>}
            </div>
          </div>
        )}
        {n && type === 'done' && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">승인되면 이 항목이 '완료'로 바뀝니다.</p>}

        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">{type === 'note' ? '어떤 성과인가요' : '한 줄 설명'}{type !== 'note' && <span className="font-normal text-slate-400"> (선택)</span>}</div>
          {type === 'note'
            ? <textarea rows={3} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) 고객 인터뷰 12건 완료, 핵심 니즈 3개 도출 — 다음 기획에 반영" />
            : <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="예) A사 1차 계약분 3억 반영" />}
        </div>

        {(!!ev.length || !!recent?.length) && (
          <div>
            <div className="text-xs font-semibold text-slate-600 mb-1">근거 <span className="font-normal text-slate-400">(선택)</span></div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {ev.map((x) => (
                <button key={x.id} onClick={() => setEv(ev.filter((y) => y.id !== x.id))} title="빼기" className="rounded-full bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 px-2.5 py-1 inline-flex items-center gap-1 max-w-[260px]">
                  {x.t === 'msg' ? <MessageSquare size={11} /> : <FileText size={11} />}<span className="truncate">{x.title}</span></button>
              ))}
              {!!recent?.filter((r) => !ev.some((y) => y.id === r.id)).length && (
                <select className="rounded-full border border-slate-200 px-2 py-1 bg-white text-slate-500 max-w-[220px]" value="" onChange={(e) => { const r = recent.find((x) => x.id === e.target.value); if (r) setEv([...ev, { t: 'sub', id: r.id, title: r.title }]); }}>
                  <option value="">+ 업무 카드 연결</option>
                  {recent.filter((r) => !ev.some((y) => y.id === r.id)).map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </select>
              )}
            </div>
          </div>
        )}

        <Button className="w-full" disabled={!full} loading={create.isPending} onClick={submit}><Crosshair size={14} />{resubmit ? '고쳐서 다시 올리기' : '팀장님께 승인 요청'}</Button>
        </>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// 스트림 카드 — 한 줄짜리 크기
// ---------------------------------------------------------------------
export function CheckinCard({ s, on, onClick, item }: { s: Submission & { submission_versions?: Pick<SubmissionVersion, 'version' | 'checkin'>[] }; on: boolean; onClick: () => void; item?: Pick<WorkItem, 'title' | 'unit' | 'stages' | 'num_target' | 'higher_is_better'> | null }) {
  const c = latestPayload(s);
  const pct = c ? payloadPct(c, item) : null;
  const st = s.status === 'approved' ? { t: '승인', cls: 'text-emerald-700' } : s.status === 'needs_work' ? { t: '보완 요청', cls: 'text-amber-700' } : { t: '승인 대기', cls: 'text-indigo-700' };
  return (
    <button onClick={onClick} className={cx('text-left rounded-xl bg-white ring-1 px-3 py-2 w-[340px] max-w-full hover:ring-indigo-300', on ? 'ring-2 ring-indigo-500' : s.status === 'approved' ? 'ring-emerald-200' : 'ring-indigo-200')}>
      <div className="flex items-center gap-1.5 text-[11px]">
        <Crosshair size={12} className={s.status === 'approved' ? 'text-emerald-600' : 'text-indigo-600'} />
        <b className="text-slate-700 truncate">{item?.title ?? s.title.replace(/^(체크인|성과입력) · /, '')}</b>
        <span className={cx('ml-auto font-semibold shrink-0', st.cls)}>{st.t}</span>
      </div>
      {c && (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm min-w-0 truncate">
            {c.type === 'note' ? <span className="text-slate-700">서술 성과</span>
              : <>{c.prev && <span className="text-slate-400">{c.prev} → </span>}<b className="text-slate-900">{payloadLabel(c, item)}</b></>}
          </span>
          {pct != null && <span className="ml-auto flex items-center gap-1.5 shrink-0"><span className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className={cx('block h-full', s.status === 'approved' ? 'bg-emerald-500' : 'bg-indigo-400')} style={{ width: `${pct}%` }} /></span><span className="text-[11px] font-semibold num text-slate-600">{pct}%</span></span>}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------
// 스레드 패널 안 — 성과입력 내용 · 근거 · 팀장 승인 / 팀원 다시 올리기
// ---------------------------------------------------------------------
export function CheckinDetail({ sub, versions, leaderView }: { sub: Submission; versions: SubmissionVersion[]; leaderView: boolean }) {
  const { team, uid } = useTeam();
  const items = useItems(team.id);
  const item = (items.data ?? []).find((x) => x.id === sub.item_id) ?? null;
  const v = [...versions].sort((a, b) => b.version - a.version)[0];
  const c = v?.checkin ?? null;
  const decide = useDecideCheckin();
  const [prog, setProg] = useState<string>('');
  const [redo, setRedo] = useState(false);
  if (!c) return null;
  const pct = payloadPct(c, item);
  const wait = sub.status === 'in_review';
  return (
    <div className="rounded-xl ring-1 ring-indigo-200 bg-indigo-50/30 p-3.5 space-y-2">
      <div className="text-[11px] text-slate-500">{item ? <Link to={`/${leaderView ? 'goals' : 'my/goals'}?item=${item.id}`} className="hover:text-indigo-700"># {item.title}</Link> : '목표 없음'}{v && ` · v${v.version} · ${fmtDate(v.created_at)}`}</div>
      {c.type !== 'note' && (
        <div className="flex items-baseline gap-2 flex-wrap">
          {c.prev && <span className="text-sm text-slate-400">{c.prev} →</span>}
          <span className="text-xl font-bold num">{payloadLabel(c, item)}</span>
          {pct != null && c.type !== 'percent' && <span className="text-sm font-semibold text-indigo-700 num">{pct}%</span>}
          {item?.measure === 'number' && item.num_target != null && <span className="text-xs text-slate-400">목표 {item.num_target}{item.unit}</span>}
        </div>
      )}
      {v?.note && <p className={cx('text-sm whitespace-pre-wrap', c.type === 'note' ? 'text-slate-800 font-medium' : 'text-slate-600')}>{v.note}</p>}
      {!!c.evidence?.length && (
        <div className="flex flex-wrap gap-1.5 text-[11px]">{c.evidence.map((e) => (
          <span key={e.id} className="rounded-full bg-white ring-1 ring-slate-200 px-2 py-0.5 inline-flex items-center gap-1 text-slate-600 max-w-[240px]">{e.t === 'msg' ? <MessageSquare size={10} /> : <FileText size={10} />}<span className="truncate">{e.title}</span></span>
        ))}</div>
      )}
      {sub.status === 'approved' && <p className="text-xs font-semibold text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={13} />승인 · 팀목표에 반영됨{sub.approved_at && ` · ${fmtDate(sub.approved_at)}`}</p>}
      {leaderView && wait && <p className="text-[11px] text-slate-500">팀원이 목표 달성에 대한 공식 성과를 입력했습니다. 승인하면 이 값이 팀목표의 공식 진척이 됩니다.</p>}
      {leaderView && wait && (
        <div className="pt-1 flex items-center gap-1.5 flex-wrap">
          {c.type === 'note' && item?.measure === 'percent' && (
            <label className="text-xs text-slate-600 inline-flex items-center gap-1 mr-auto">진척률도 <input type="number" min={0} max={100} className="w-14 rounded border border-slate-200 px-1.5 py-0.5" placeholder={String(item.progress)} value={prog} onChange={(e) => setProg(e.target.value)} />%로</label>
          )}
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" loading={decide.isPending && decide.variables?.ok === false} onClick={() => decide.mutate({ id: sub.id, ok: false })}><RotateCcw size={12} />보완</Button>
            <Button size="sm" loading={decide.isPending && decide.variables?.ok === true} onClick={() => decide.mutate({ id: sub.id, ok: true, progress: prog === '' ? null : Number(prog) })}><Check size={12} />승인</Button>
          </span>
        </div>
      )}
      {!leaderView && sub.author_id === uid && sub.status === 'needs_work' && (
        <Button size="sm" variant="soft" onClick={() => setRedo(true)}><RotateCcw size={12} />고쳐서 다시 올리기</Button>
      )}
      {redo && <CheckinModal open onClose={() => setRedo(false)} itemId={sub.item_id} resubmit={{ id: sub.id, version: v.version, payload: c, note: v.note }} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// 팀목표 항목 — 성과입력 이력 (점 하나가 성과입력 하나)
// ---------------------------------------------------------------------
export function CheckinHistory({ item, canCheckin, onCheckin }: { item: Node; canCheckin: boolean; onCheckin: () => void }) {
  const { isLeader } = useTeam();
  const list = useItemCheckins(item.id);
  const decide = useDecideCheckin();
  const rows = list.data ?? [];
  return (
    <div className="rounded-xl border border-slate-200 p-3.5">
      <div className="flex items-center gap-2">
        <Crosshair size={14} className="text-indigo-600" /><span className="text-sm font-semibold">성과입력</span>
        <span className="text-xs text-slate-400">지금 공식 {currentLabel(item)}</span>
        {canCheckin && <Button size="sm" variant="secondary" className="ml-auto" title={PERF_TIP} onClick={onCheckin}><Crosshair size={13} />성과입력</Button>}
      </div>
      {!rows.length ? <p className="mt-2 text-xs text-slate-400">아직 성과입력이 없습니다. 숫자가 바뀌거나 단계가 넘어가면 [성과입력]으로 남겨 주세요 — 팀장님이 승인하면 팀목표 진척에 반영됩니다.</p> : (
        <ol className="mt-2.5 space-y-1.5">
          {[...rows].reverse().map((s) => {
            const c = latestPayload(s);
            const v = [...(s.submission_versions ?? [])].sort((a, b) => b.version - a.version)[0];
            const wait = s.status === 'in_review';
            return (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <span className={cx('mt-1 w-2 h-2 rounded-full shrink-0', s.status === 'approved' ? 'bg-indigo-600' : s.status === 'needs_work' ? 'bg-amber-400' : 'ring-2 ring-indigo-400 bg-white')} />
                <span className="text-slate-400 w-10 shrink-0 num">{fmtShort(s.created_at)}</span>
                <span className="min-w-0 flex-1">
                  <b className="text-slate-800">{c ? (c.type === 'note' ? '서술 성과' : payloadLabel(c, item)) : '성과입력'}</b>
                  <span className={cx('ml-1.5', s.status === 'approved' ? 'text-slate-400' : s.status === 'needs_work' ? 'text-amber-700' : 'text-indigo-600 font-semibold')}>{s.status === 'approved' ? '승인' : s.status === 'needs_work' ? '보완 요청' : '승인 대기'}</span>
                  {v?.note && <span className="block text-slate-500 truncate">{v.note}</span>}
                </span>
                {isLeader && wait && <Button size="sm" variant="soft" loading={decide.isPending && decide.variables?.id === s.id} onClick={() => decide.mutate({ id: s.id, ok: true })}><Check size={12} />승인</Button>}
                <Link to={`/work/${s.id}`} className="text-slate-400 hover:text-indigo-700 shrink-0">대화</Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
