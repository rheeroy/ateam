// 성과 체크인 화면 조각 — 입력(모달) · 스트림 카드(작게) · 스레드 패널 내용 · 항목의 체크인 이력
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

type Evidence = NonNullable<CheckinPayload['evidence']>[number];

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
    .filter((n) => n.owner_id === uid && n.depth <= 1 && ['active', 'blocked'].includes(n.status))
    .sort((a, b) => a.path.concat(a.id).join('/').localeCompare(b.path.concat(b.id).join('/'))), [byId, uid]);
  const [pick, setPick] = useState<string>(itemId ?? '');
  const n = byId.get(pick || itemId || '') ?? (resubmit ? null : mine[0] ?? null);
  const base = n ? checkinTypeFor(n) : 'note';
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
    <Modal open={open} onClose={onClose} title={<span className="inline-flex items-center gap-2"><Crosshair size={16} className="text-indigo-600" />성과 체크인<span className="text-xs font-normal text-slate-400">팀장님 승인 후 팀목표에 반영됩니다</span></span>}>
      <div className="space-y-4">
        <div>
          <div className="text-xs font-semibold text-slate-600 mb-1">어느 목표에</div>
          {resubmit && n ? <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm"># {n.title}</div> : !mine.length ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">진행 중인 내 목표·과제가 없습니다. 팀목표에서 승인된 항목에 체크인할 수 있어요.</p>
          ) : (
            <select className={inputCls} value={n?.id ?? ''} onChange={(e) => { setPick(e.target.value); setValue(''); setStage(null); setAsNote(false); }}>
              {mine.map((m) => <option key={m.id} value={m.id}>{'　'.repeat(m.depth)}# {m.title} — 지금 {currentLabel(m)}{m.measure === 'number' && m.num_target != null ? ` / ${m.num_target}${m.unit}` : ''}</option>)}
            </select>
          )}
        </div>

        {!n ? null : <>
        {(base !== 'note') && (
          <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs w-fit">
            <button onClick={() => setAsNote(false)} className={cx('px-3 py-1 rounded-md', !asNote ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>{base === 'done' ? '완료' : base === 'stage' ? '단계' : '값'} 체크인</button>
            <button onClick={() => setAsNote(true)} className={cx('px-3 py-1 rounded-md', asNote ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>성과로 기록</button>
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
          <div className="text-xs font-semibold text-slate-600 mb-1">{type === 'note' ? '어떤 성과인가요' : '한 줄'}{type !== 'note' && <span className="font-normal text-slate-400"> (선택)</span>}</div>
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

        <Button className="w-full" disabled={!full} loading={create.isPending} onClick={submit}><Crosshair size={14} />{resubmit ? '고쳐서 다시 올리기' : '체크인 승인 요청'}</Button>
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
        <b className="text-slate-700 truncate">{item?.title ?? s.title.replace(/^체크인 · /, '')}</b>
        <span className={cx('ml-auto font-semibold shrink-0', st.cls)}>{st.t}</span>
      </div>
      {c && (
        <div className="mt-1 flex items-center gap-2">
          <span className="text-sm min-w-0 truncate">
            {c.type === 'note' ? <span className="text-slate-700">성과 기록</span>
              : <>{c.prev && <span className="text-slate-400">{c.prev} → </span>}<b className="text-slate-900">{payloadLabel(c, item)}</b></>}
          </span>
          {pct != null && <span className="ml-auto flex items-center gap-1.5 shrink-0"><span className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden"><span className={cx('block h-full', s.status === 'approved' ? 'bg-emerald-500' : 'bg-indigo-400')} style={{ width: `${pct}%` }} /></span><span className="text-[11px] font-semibold num text-slate-600">{pct}%</span></span>}
        </div>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------
// 스레드 패널 안 — 체크인 내용 · 근거 · 팀장 승인 / 팀원 다시 올리기
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
// 팀목표 항목 — 체크인 이력 (점 하나가 체크인 하나)
// ---------------------------------------------------------------------
export function CheckinHistory({ item, canCheckin, onCheckin }: { item: Node; canCheckin: boolean; onCheckin: () => void }) {
  const { isLeader } = useTeam();
  const list = useItemCheckins(item.id);
  const decide = useDecideCheckin();
  const rows = list.data ?? [];
  return (
    <div className="rounded-xl border border-slate-200 p-3.5">
      <div className="flex items-center gap-2">
        <Crosshair size={14} className="text-indigo-600" /><span className="text-sm font-semibold">체크인</span>
        <span className="text-xs text-slate-400">지금 공식 {currentLabel(item)}</span>
        {canCheckin && <Button size="sm" variant="secondary" className="ml-auto" onClick={onCheckin}><Crosshair size={13} />체크인</Button>}
      </div>
      {!rows.length ? <p className="mt-2 text-xs text-slate-400">아직 체크인이 없습니다. 성과가 나면 업무플랫폼이나 여기서 점을 찍어 주세요 — 팀장님이 승인하면 공식 진척이 됩니다.</p> : (
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
                  <b className="text-slate-800">{c ? (c.type === 'note' ? '성과 기록' : payloadLabel(c, item)) : '체크인'}</b>
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
