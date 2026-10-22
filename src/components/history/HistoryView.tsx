// 과제 히스토리 화면 — 팀장(히스토리 관리)과 팀원(받은 히스토리)이 같이 쓴다
//   그림: 상태 칩 · 진행 흐름(줄기별 타임라인 + 진척) · 관계자 지도 · 요약 카드(3줄 + 더 보기)
//   문서: 모든 항목을 펼친 글 (인쇄·PDF용)
//   줄·점·사람을 누르면 오른쪽 세부 창 — 자세한 내용 · 근거 기록 · (팀장) 고정 · 숨김 · 문장 고치기
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleHelp, EyeOff, FileText, Flag, Link2, ListTree, Pencil, Pin, PinOff, RotateCcw, Rows3, X } from 'lucide-react';
import { cx, fmtDate } from '../../lib/format';
import { LISTS, type HEvent, type HistoryContent, type HistoryEdits, type HLine, type HPerson, type HRef, type ListKey } from '../../lib/history';
import { Button, inputCls } from '../ui';

const KIND: Record<string, { c: string; l: string }> = {
  doc: { c: '#6366F1', l: '결과물' }, decision: { c: '#059669', l: '결정' }, issue: { c: '#E11D48', l: '이슈' },
  feedback: { c: '#7C3AED', l: '팀장 피드백' }, change: { c: '#0EA5E9', l: '변경' }, plan: { c: '#64748B', l: '예정' },
};
const LANE_C = ['#6366F1', '#E11D48', '#0EA5E9', '#F59E0B', '#10B981', '#8B5CF6', '#64748B'];
const ICON: Record<ListKey, typeof CheckCircle2> = { fixed: CheckCircle2, open: Flag, risks: AlertTriangle, tried: RotateCcw, gaps: CircleHelp };
const TONE: Record<string, string> = {
  emerald: 'text-emerald-700 bg-emerald-50 ring-emerald-100', violet: 'text-violet-700 bg-violet-50 ring-violet-100', rose: 'text-rose-700 bg-rose-50 ring-rose-100',
  slate: 'text-slate-600 bg-slate-50 ring-slate-200', amber: 'text-amber-800 bg-amber-50 ring-amber-200', indigo: 'text-indigo-700 bg-indigo-50 ring-indigo-100',
};
const DAY = 86400000;
const t = (d: string) => Date.parse(`${d}T00:00:00`);
const today = () => new Date().toISOString().slice(0, 10);

type Pick =
  | { t: 'line'; list: ListKey; l: HLine }
  | { t: 'event'; e: HEvent }
  | { t: 'person'; p: HPerson }
  | null;

/** 근거 기록 링크 */
function srcLink(r: HRef): string | null {
  if (r.type === 'submission' && r.id) return `/work/${r.id}`;
  return null;
}
function Sources({ src }: { src?: HRef[] }) {
  if (!src?.length) return <p className="text-xs text-slate-400">연결된 원본 기록이 없습니다.</p>;
  return (
    <ul className="space-y-1">{src.map((r, i) => {
      const to = srcLink(r);
      const body = <><FileText size={12} className="shrink-0 text-slate-400" /><span className="truncate">{r.label}</span></>;
      return <li key={i}>{to ? <Link to={to} className="inline-flex items-center gap-1.5 text-xs text-indigo-700 hover:underline max-w-full">{body}</Link>
        : <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 max-w-full">{body}</span>}</li>;
    })}</ul>
  );
}

// ---------------------------------------------------------------------
// 진행 흐름
// ---------------------------------------------------------------------
function Timeline({ c, onPick, sel }: { c: HistoryContent; onPick: (p: Pick) => void; sel: string | null }) {
  const [allLanes, setAllLanes] = useState(false);
  const [full, setFull] = useState(false);
  const lanesAll = (c.lanes ?? []).filter((l) => (c.events ?? []).some((e) => e.lane === l.id));
  const lanes = allLanes ? lanesAll : lanesAll.slice(0, 5);
  const evs = (c.events ?? []).filter((e) => lanes.some((l) => l.id === e.lane));
  const pts = c.progress?.points ?? [];
  const dates = [...evs.map((e) => e.date), ...pts.map((p) => p.date), today()].filter(Boolean).map(t);
  if (!lanes.length) return <p className="text-sm text-slate-400 py-6 text-center">아직 묶을 만한 흐름이 없습니다. 기록이 쌓이면 자동으로 채워집니다.</p>;
  const maxD = Math.max(...dates, t(today()) + 14 * DAY) + 8 * DAY;
  let minD = Math.min(...dates) - 4 * DAY;
  const long = maxD - minD > 120 * DAY;
  if (long && !full) minD = Math.max(minD, t(today()) - 90 * DAY);
  const X0 = 84, W = 456, H = 46, top = 30;
  const x = (d: string) => X0 + Math.max(0, Math.min(1, (t(d) - minD) / (maxD - minD))) * W;
  const months: { d: string; l: string }[] = [];
  for (let m = new Date(minD); m.getTime() <= maxD; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const d = new Date(m.getFullYear(), m.getMonth(), 1);
    if (d.getTime() >= minD) months.push({ d: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, l: `${d.getMonth() + 1}월` });
  }
  const showProg = pts.length >= 2;
  const progH = showProg ? 70 : 0;
  const height = top + lanes.length * H + progH + 16;
  const pos = new Map<string, { x: number; y: number }>();
  lanes.forEach((ln, i) => { for (const e of evs.filter((v) => v.lane === ln.id)) pos.set(e.id, { x: x(e.date), y: top + i * H + H / 2 }); });
  const tx = x(today());
  // 진척 축
  const vmax = Math.max(c.progress?.target ?? 0, ...pts.map((p) => p.value), 1);
  const py = (v: number) => top + lanes.length * H + progH - 8 - (v / vmax) * (progH - 26);
  return (
    <div>
      <svg viewBox={`0 0 ${X0 + W + 16} ${height}`} className="w-full h-auto font-sans select-none">
        <defs>{Object.entries(KIND).map(([k, v]) => <marker key={k} id={`ar-${k}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill={v.c} /></marker>)}</defs>
        {months.map((m) => <g key={m.d}><line x1={x(m.d)} x2={x(m.d)} y1={top - 8} y2={height - 6} stroke="#E2E8F0" /><text x={x(m.d) + 4} y={top - 14} fontSize="11" fill="#94A3B8">{m.l}</text></g>)}
        <rect x={tx} y={top - 8} width={Math.max(0, X0 + W - tx)} height={height - top + 2} fill="#F8FAFC" />
        <line x1={tx} x2={tx} y1={top - 20} y2={height - 6} stroke="#7C3AED" strokeWidth="1.5" strokeDasharray="3 3" />
        <text x={tx + 4} y={top - 22} fontSize="10" fontWeight="700" fill="#7C3AED">오늘</text>
        {lanes.map((ln, i) => {
          const y = top + i * H + H / 2; const col = LANE_C[i % LANE_C.length];
          const es = evs.filter((e) => e.lane === ln.id).sort((a, b) => a.date.localeCompare(b.date));
          const past = es.filter((e) => !e.future); const fut = es.filter((e) => e.future);
          let lastUp = -999, lastDown = -999;
          return (
            <g key={ln.id}>
              <text x={2} y={y + 4} fontSize="12" fontWeight="600" fill="#334155">{ln.title.length > 7 ? `${ln.title.slice(0, 7)}…` : ln.title}</text>
              {past.length > 1 && <line x1={x(past[0].date)} x2={x(past[past.length - 1].date)} y1={y} y2={y} stroke={col} strokeWidth="3" strokeLinecap="round" opacity="0.35" />}
              {fut.length > 0 && <line x1={x((past.at(-1) ?? fut[0]).date)} x2={x(fut[fut.length - 1].date)} y1={y} y2={y} stroke={col} strokeWidth="2" strokeDasharray="4 4" opacity="0.5" />}
              {es.map((e) => {
                const k = KIND[e.kind] ?? KIND.doc; const ex = x(e.date);
                // 글자 겹침 피하기: 아래 → 위 → 아래
                let up = false;
                if (ex - lastDown < 64) { up = ex - lastUp >= 64; }
                if (up) lastUp = ex; else lastDown = ex;
                const on = sel === e.id;
                return (
                  <g key={e.id} className="cursor-pointer" onClick={() => onPick({ t: 'event', e })}>
                    <circle cx={ex} cy={y} r="12" fill="transparent" />
                    {e.kind === 'decision' ? <rect x={ex - 6} y={y - 6} width="12" height="12" transform={`rotate(45 ${ex} ${y})`} fill={e.future ? '#fff' : k.c} stroke={k.c} strokeWidth={on ? 3 : 2} />
                      : <circle cx={ex} cy={y} r={on ? 7.5 : 6} fill={e.future ? '#fff' : k.c} stroke={k.c} strokeWidth="2" strokeDasharray={e.future ? '2 2' : undefined} />}
                    <text x={Math.min(ex, X0 + W - 4)} y={up ? y - 13 : y + 19} fontSize="11" textAnchor={ex > X0 + W - 30 ? 'end' : 'middle'} fill={e.future ? '#64748B' : on ? '#4338CA' : '#334155'} fontWeight={on ? 700 : 400}>
                      {e.title.length > 9 ? `${e.title.slice(0, 9)}…` : e.title}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
        {(c.links ?? []).map((l, i) => {
          const a = pos.get(l.from), b = pos.get(l.to); if (!a || !b) return null;
          const k = (c.events ?? []).find((e) => e.id === l.from)?.kind ?? 'doc';
          const mx = (a.x + b.x) / 2; const my = Math.min(a.y, b.y) - 14;
          return <path key={i} d={`M ${a.x} ${a.y + (b.y > a.y ? 7 : -7)} Q ${mx} ${my} ${b.x} ${b.y + (b.y > a.y ? -7 : 7)}`} fill="none" stroke={(KIND[k] ?? KIND.doc).c} strokeWidth="1.3" opacity="0.8" markerEnd={`url(#ar-${KIND[k] ? k : 'doc'})`} />;
        })}
        {showProg && (
          <g>
            <text x={2} y={py(vmax / 2) + 4} fontSize="12" fontWeight="600" fill="#334155">진척</text>
            {c.progress?.target != null && <line x1={X0} x2={X0 + W} y1={py(c.progress.target)} y2={py(c.progress.target)} stroke="#CBD5E1" strokeDasharray="3 3" />}
            <polyline points={pts.filter((p) => t(p.date) >= minD).map((p) => `${x(p.date)},${py(p.value)}`).join(' ')} fill="none" stroke="#6366F1" strokeWidth="2" />
            {(() => { const lp = pts[pts.length - 1]; return <text x={x(lp.date) - 4} y={py(lp.value) - 6} fontSize="10.5" textAnchor="end" fill="#4F46E5" fontWeight="700">{lp.value.toLocaleString('ko-KR')}{c.progress?.unit}</text>; })()}
          </g>
        )}
      </svg>
      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
        {Object.entries(KIND).map(([k, v]) => <span key={k} className="inline-flex items-center gap-1"><span className={cx('w-2 h-2', k === 'decision' ? 'rotate-45' : 'rounded-full')} style={{ background: v.c }} />{v.l}</span>)}
        <span className="ml-auto flex gap-3">
          {lanesAll.length > 5 && <button className="text-indigo-700 font-semibold" onClick={() => setAllLanes((v) => !v)}>{allLanes ? '줄기 접기' : `줄기 ${lanesAll.length - 5}개 더`}</button>}
          {long && <button className="text-indigo-700 font-semibold" onClick={() => setFull((v) => !v)}>{full ? '최근 3개월' : '전체 기간'}</button>}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 관계자 지도
// ---------------------------------------------------------------------
const SCOPE: Record<string, { bg: string; fg: string; l: string }> = {
  team: { bg: '#EEF2FF', fg: '#4338CA', l: '팀 내부' }, dept: { bg: '#FFFBEB', fg: '#B45309', l: '타 부서' }, external: { bg: '#F1F5F9', fg: '#334155', l: '외부' },
};
function People({ c, title, onPick, sel }: { c: HistoryContent; title: string; onPick: (p: Pick) => void; sel: string | null }) {
  const [more, setMore] = useState(false);
  const ppl = c.people ?? [];
  if (!ppl.length) return <p className="text-sm text-slate-400 py-6 text-center">기록에 이름이 나온 관계자가 아직 없습니다.</p>;
  const shown = ppl.slice(0, 8);
  const rest = ppl.length - shown.length;
  const Wd = 420, Hd = 300, cx0 = Wd / 2, cy0 = Hd / 2;
  const n = shown.length + (rest > 0 ? 1 : 0);
  const at = (i: number) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return { x: cx0 + Math.cos(a) * 158, y: cy0 + Math.sin(a) * 112 }; };
  return (
    <div>
      <svg viewBox={`0 0 ${Wd} ${Hd}`} className="w-full h-auto font-sans select-none">
        {shown.map((p, i) => { const q = at(i); return <line key={p.id} x1={cx0} y1={cy0} x2={q.x} y2={q.y} stroke={p.check ? '#F59E0B' : '#CBD5E1'} strokeDasharray={p.check ? '4 3' : undefined} />; })}
        <rect x={cx0 - 70} y={cy0 - 17} width="140" height="34" rx="10" fill="#4F46E5" />
        <text x={cx0} y={cy0 + 4} fontSize="12.5" fontWeight="700" fill="#fff" textAnchor="middle">{title.length > 12 ? `${title.slice(0, 12)}…` : title}</text>
        {shown.map((p, i) => {
          const q = at(i); const s = SCOPE[p.scope] ?? SCOPE.external; const on = sel === p.id;
          return (
            <g key={p.id} className="cursor-pointer" onClick={() => onPick({ t: 'person', p })}>
              <rect x={q.x - 62} y={q.y - 20} width="124" height="40" rx="9" fill={s.bg} stroke={p.check ? '#F59E0B' : on ? s.fg : 'none'} strokeWidth={on ? 2 : 1} />
              <text x={q.x} y={q.y - 3} fontSize="12" fontWeight="700" fill={s.fg} textAnchor="middle">{p.name.length > 9 ? `${p.name.slice(0, 9)}…` : p.name}</text>
              <text x={q.x} y={q.y + 12} fontSize="10.5" fill="#64748B" textAnchor="middle">{(p.role ?? p.org ?? '').slice(0, 13)}</text>
            </g>
          );
        })}
        {rest > 0 && (() => { const q = at(shown.length); return (
          <g className="cursor-pointer" onClick={() => setMore((v) => !v)}><rect x={q.x - 30} y={q.y - 14} width="60" height="28" rx="14" fill="#fff" stroke="#CBD5E1" /><text x={q.x} y={q.y + 4} fontSize="11" fill="#475569" textAnchor="middle" fontWeight="600">+{rest}명</text></g>); })()}
      </svg>
      <div className="flex gap-3 text-[11px] text-slate-500 flex-wrap">
        {Object.values(SCOPE).map((s) => <span key={s.l} className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded" style={{ background: s.bg, outline: `1px solid ${s.fg}33` }} />{s.l}</span>)}
        <span className="inline-flex items-center gap-1 text-amber-700"><span className="w-3 border-t border-dashed border-amber-500" />확인 필요</span>
      </div>
      {more && <ul className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs space-y-1">{ppl.slice(8).map((p) => <li key={p.id}><button className="hover:text-indigo-700" onClick={() => onPick({ t: 'person', p })}><b>{p.name}</b> {p.org && <span className="text-slate-400">{p.org}</span>} — {p.role}</button></li>)}</ul>}
    </div>
  );
}

// ---------------------------------------------------------------------
// 요약 카드
// ---------------------------------------------------------------------
function ListCard({ k, label, tone, lines, pinned, onPick, sel, wide }: { k: ListKey; label: string; tone: string; lines: HLine[]; pinned: Set<string>; onPick: (p: Pick) => void; sel: string | null; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  const I = ICON[k];
  const shown = open ? lines : lines.slice(0, wide ? 4 : 3);
  return (
    <div className={cx('rounded-2xl p-4 ring-1', k === 'gaps' ? 'bg-amber-50 ring-amber-200' : 'bg-white ring-slate-200')}>
      <div className={cx('text-xs font-bold mb-2 flex items-center gap-1', TONE[tone].split(' ')[0])}><I size={13} />{label}<span className="font-normal text-slate-400">{lines.length}</span>
        {wide && <span className="ml-2 font-normal text-amber-700">넘겨받는 사람이 꼭 알아야 하는데 기록에 없는 것 — 팀장 한마디나 자료로 채우면 다음 업데이트에 반영</span>}</div>
      <ul className={cx(wide ? 'grid sm:grid-cols-2 gap-x-6 gap-y-1' : 'space-y-1')}>
        {shown.map((l) => (
          <li key={l.id}>
            <button onClick={() => onPick({ t: 'line', list: k, l })} className={cx('w-full text-left flex gap-1.5 rounded-md px-1 -mx-1 py-0.5 text-[12.5px] leading-relaxed hover:bg-slate-100/70', sel === l.id && 'bg-indigo-50', k === 'gaps' ? 'text-amber-900' : 'text-slate-700')}>
              {pinned.has(l.id) ? <Pin size={11} className="text-violet-600 mt-1 shrink-0" /> : <span className="mt-2 w-1 h-1 rounded-full bg-slate-300 shrink-0" />}
              <span className="flex-1">{l.text}</span>
            </button>
          </li>
        ))}
      </ul>
      {lines.length > (wide ? 4 : 3) && <button onClick={() => setOpen((v) => !v)} className="mt-1.5 text-[11px] font-semibold text-indigo-700">{open ? '접기' : `+${lines.length - (wide ? 4 : 3)}개 더 보기`}</button>}
    </div>
  );
}

// ---------------------------------------------------------------------
// 세부 창
// ---------------------------------------------------------------------
function Detail({ pick, onClose, editable, edits, onEdit }: { pick: NonNullable<Pick>; onClose: () => void; editable?: boolean; edits: HistoryEdits; onEdit?: (e: HistoryEdits) => void }) {
  const id = pick.t === 'line' ? pick.l.id : pick.t === 'event' ? pick.e.id : pick.p.id;
  const [editing, setEditing] = useState(false);
  const base = pick.t === 'line' ? pick.l.text : pick.t === 'event' ? pick.e.title : pick.p.name;
  const [draft, setDraft] = useState(base);
  const pinned = (edits.pinned ?? []).includes(id);
  const set = (patch: Partial<HistoryEdits>) => onEdit?.({ ...edits, ...patch });
  const togglePin = () => set({ pinned: pinned ? (edits.pinned ?? []).filter((x) => x !== id) : [...(edits.pinned ?? []), id] });
  const hide = () => { set({ hidden: [...new Set([...(edits.hidden ?? []), id])] }); onClose(); };
  const saveText = () => { set({ text: { ...(edits.text ?? {}), [id]: draft.trim() }, pinned: [...new Set([...(edits.pinned ?? []), id])] }); setEditing(false); };
  const head = pick.t === 'line' ? LISTS.find((x) => x.k === pick.list)?.label : pick.t === 'event' ? `${(KIND[pick.e.kind] ?? KIND.doc).l} · ${fmtDate(pick.e.date)}${pick.e.future ? ' (예정)' : ''}` : (SCOPE[pick.p.scope] ?? SCOPE.external).l;
  const detail = pick.t === 'line' ? pick.l.detail : pick.t === 'event' ? pick.e.detail : [pick.p.org, pick.p.role].filter(Boolean).join(' · ');
  const src = pick.t === 'line' ? pick.l.src : pick.t === 'event' ? pick.e.src : pick.p.src;
  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full sm:w-[400px] bg-white shadow-2xl border-l border-slate-200 flex flex-col">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2"><span className="text-xs font-semibold text-slate-500">{head}</span>
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={18} /></button></div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {editing ? (
          <div className="space-y-2"><textarea rows={3} className={inputCls} value={draft} onChange={(e) => setDraft(e.target.value)} />
            <div className="flex gap-1.5 justify-end"><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>취소</Button><Button size="sm" disabled={!draft.trim()} onClick={saveText}>저장 · 고정</Button></div>
            <p className="text-[11px] text-slate-400">고친 문장은 고정되어 다음 자동 업데이트에서도 그대로 남습니다.</p></div>
        ) : <p className="text-[15px] font-semibold text-slate-900 leading-snug">{base}</p>}
        {pick.t === 'line' && pick.l.since && <p className="text-xs text-slate-500">{fmtDate(pick.l.since)}부터</p>}
        {detail ? <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{detail}</p> : null}
        {pick.t === 'person' && pick.p.check && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">관계나 합의 내용을 확인해야 합니다.</p>}
        <div><div className="text-[11px] font-semibold text-slate-400 mb-1.5">근거 기록</div><Sources src={src} /></div>
      </div>
      {editable && (
        <div className="border-t border-slate-100 px-5 py-3 flex gap-1.5 flex-wrap">
          <Button size="sm" variant="secondary" onClick={togglePin}>{pinned ? <><PinOff size={13} />고정 풀기</> : <><Pin size={13} />고정</>}</Button>
          {pick.t !== 'person' && <Button size="sm" variant="secondary" onClick={() => { setDraft(base); setEditing(true); }}><Pencil size={13} />문장 고치기</Button>}
          <Button size="sm" variant="ghost" onClick={hide}><EyeOff size={13} />숨기기</Button>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------
// 본체
// ---------------------------------------------------------------------
export function HistoryView({ content, edits, editable, onEdit, title }: {
  content: HistoryContent; edits?: HistoryEdits; editable?: boolean; onEdit?: (e: HistoryEdits) => void; title: string;
}) {
  const [mode, setMode] = useState<'visual' | 'doc'>('visual');
  const [pick, setPick] = useState<Pick>(null);
  const [showHidden, setShowHidden] = useState(false);
  const ed = edits ?? {};
  const pinned = useMemo(() => new Set(ed.pinned ?? []), [ed.pinned]);
  const c = content;
  const selId = pick ? (pick.t === 'line' ? pick.l.id : pick.t === 'event' ? pick.e.id : pick.p.id) : null;
  const counts = LISTS.map((x) => ({ ...x, n: (c[x.k] ?? []).length })).filter((x) => x.n > 0);
  const hiddenN = (ed.hidden ?? []).length;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {counts.map((x) => { const I = ICON[x.k]; return <span key={x.k} className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ring-1', TONE[x.tone])}><I size={12} />{x.label} {x.n}</span>; })}
        {!!c.related?.length && <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ring-1', TONE.indigo)}><Link2 size={12} />관련 과제 {c.related.length}</span>}
        <span className="ml-auto flex rounded-lg bg-slate-100 p-0.5">
          <button onClick={() => setMode('visual')} className={cx('px-2.5 py-1 rounded-md inline-flex items-center gap-1', mode === 'visual' ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}><ListTree size={12} />그림</button>
          <button onClick={() => setMode('doc')} className={cx('px-2.5 py-1 rounded-md inline-flex items-center gap-1', mode === 'doc' ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}><Rows3 size={12} />문서</button>
        </span>
      </div>

      {mode === 'visual' ? (
        <>
          <div className="grid xl:grid-cols-[minmax(0,1fr)_380px] gap-3">
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 min-w-0">
              <div className="flex items-center gap-2 mb-1"><b className="text-sm">진행 흐름</b><span className="text-[11px] text-slate-400">점을 누르면 자세한 내용과 원본 기록</span></div>
              <Timeline c={c} onPick={setPick} sel={selId} />
            </div>
            <div className="rounded-2xl bg-white ring-1 ring-slate-200 p-4 min-w-0">
              <div className="flex items-center gap-2 mb-1"><b className="text-sm">관계자</b><span className="text-[11px] text-slate-400">대화·자료에서 자동 추출</span></div>
              <People c={c} title={title} onPick={setPick} sel={selId} />
            </div>
          </div>
          {(() => { const main = counts.filter((x) => x.k !== 'gaps'); const gaps = counts.find((x) => x.k === 'gaps'); return (<>
            {!!main.length && (
              <div className={cx('grid gap-3 sm:grid-cols-2', main.length >= 4 ? 'xl:grid-cols-4' : main.length === 3 ? 'xl:grid-cols-3' : '')}>
                {main.map((x) => <ListCard key={x.k} k={x.k} label={x.label} tone={x.tone} lines={c[x.k] ?? []} pinned={pinned} onPick={setPick} sel={selId} />)}
              </div>
            )}
            {gaps && <ListCard k="gaps" label={gaps.label} tone={gaps.tone} lines={c.gaps ?? []} pinned={pinned} onPick={setPick} sel={selId} wide />}
          </>); })()}
        </>
      ) : (
        <div className="rounded-2xl bg-white ring-1 ring-slate-200 px-6 py-5 space-y-5 text-sm leading-relaxed">
          <section><h3 className="font-bold mb-1">현황</h3><p className="text-slate-700">{c.summary}</p></section>
          {LISTS.map((x) => (c[x.k] ?? []).length ? (
            <section key={x.k}><h3 className="font-bold mb-1.5">{x.label}</h3>
              <ul className="space-y-2">{(c[x.k] ?? []).map((l) => <li key={l.id}><div className="text-slate-800">· {l.text}{l.since && <span className="text-xs text-slate-400"> ({fmtDate(l.since)}~)</span>}</div>
                {l.detail && <div className="pl-3 text-slate-500 text-[13px]">{l.detail}</div>}{!!l.src?.length && <div className="pl-3 text-[11px] text-slate-400">근거: {l.src.map((s) => s.label).join(' · ')}</div>}</li>)}</ul></section>
          ) : null)}
          {!!(c.events ?? []).length && (
            <section><h3 className="font-bold mb-1.5">진행 흐름</h3>
              {(c.lanes ?? []).map((ln) => { const es = (c.events ?? []).filter((e) => e.lane === ln.id).sort((a, b) => a.date.localeCompare(b.date)); return es.length ? (
                <div key={ln.id} className="mb-2"><div className="text-[13px] font-semibold text-slate-600">{ln.title}</div>
                  <ul className="pl-3">{es.map((e) => <li key={e.id} className="text-slate-700"><span className="text-xs text-slate-400 num">{fmtDate(e.date)}</span> {e.title}{e.future && <span className="text-xs text-slate-400"> (예정)</span>}{e.detail && <span className="text-slate-500"> — {e.detail}</span>}</li>)}</ul></div>) : null; })}
            </section>
          )}
          {!!(c.people ?? []).length && (
            <section><h3 className="font-bold mb-1.5">관계자</h3>
              <ul className="space-y-1">{(c.people ?? []).map((p) => <li key={p.id} className="text-slate-700">· <b>{p.name}</b>{p.org && <span className="text-slate-500"> ({p.org})</span>} — {p.role}{p.check && <span className="text-amber-700 text-xs"> · 확인 필요</span>}</li>)}</ul></section>
          )}
        </div>
      )}

      {!!c.related?.length && (
        <div className="flex items-center gap-2 flex-wrap text-xs"><span className="text-slate-500 font-semibold inline-flex items-center gap-1"><Link2 size={12} />관련 과제</span>
          {c.related.map((r) => { const body = <>{r.title}{r.why && <span className="text-slate-400"> · {r.why}</span>}</>; return editable
            ? <Link key={r.item_id} to={`/history?item=${r.item_id}`} className="rounded-full bg-white ring-1 ring-slate-200 px-2.5 py-1 text-slate-700 hover:ring-indigo-300">{body}</Link>
            : <span key={r.item_id} className="rounded-full bg-white ring-1 ring-slate-200 px-2.5 py-1 text-slate-700">{body}</span>; })}</div>
      )}

      {editable && hiddenN > 0 && (
        <div className="text-xs text-slate-500">
          <button onClick={() => setShowHidden((v) => !v)} className="inline-flex items-center gap-1 hover:text-slate-800"><EyeOff size={12} />숨긴 항목 {hiddenN}개</button>
          {showHidden && <button onClick={() => onEdit?.({ ...ed, hidden: [] })} className="ml-3 font-semibold text-indigo-700">모두 다시 보이기</button>}
        </div>
      )}

      {pick && <Detail key={selId} pick={pick} onClose={() => setPick(null)} editable={editable} edits={ed} onEdit={onEdit} />}
    </div>
  );
}
