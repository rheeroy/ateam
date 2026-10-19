// 업무 스페이스 (채팅형) — 왼쪽 과제 레일 · 가운데 대화 흐름 · 오른쪽 스레드
//   그냥 말은 말풍선, 파일·링크는 말풍선 안의 '업무 카드'(상태·버전·승인). 대화는 스레드에서 이어 간다.
//   개인 스페이스(나↔팀장)와 그룹방이 같은 화면을 쓴다. AI 1차 검토는 팀장에게만.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, CircleDot, ExternalLink, FileText, FileUp, Hash, Image as ImageIcon, Inbox, Link2, Maximize2, MessageSquare, Paperclip, RotateCcw, Send, Sparkles, StickyNote, Target, Undo2, Upload, Users, X } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import { buildTree, useItems, type Node } from '../../lib/items';
import { REQ_TAG, useCloseSubmission } from '../../lib/work';
import { baseName, createPost, isUrl, namedPaste, startReview } from '../../lib/post';
import { buildEntries, lastOther, useSendMessage, useSpace, useSpaceRead, type Entry, type SpaceMessage, type SpaceRef, type SpaceSub } from '../../lib/space';
import type { WorkGroup } from '../../lib/groups';
import type { RequestType, ReviewComment, Submission, SubmissionVersion, TeamRequest } from '../../lib/types';
import { cx, fmtDate, fmtShort, fmtTime } from '../../lib/format';
import { Avatar, Button, Pill, Spinner, useToast } from '../ui';
import { FILE_ACCEPT, IMAGE } from '../Upload';
import { REQUEST_KIND } from '../RequestModal';
import { PlanBar } from '../goals/PlanBar';
import { AiReview, Bubble, Composer, VersionBody, type Review } from '../../pages/ReviewDetail';
import { STATUS } from '../../pages/MySubmissions';

type Filter = 'all' | 'wait' | 'fix' | 'unread' | 'none' | `i:${string}`;
type Sel = { t: 'sub' | 'msg' | 'req'; id: string } | null;

const dayLabel = (iso: string) => {
  const d = new Date(iso); const t = new Date(); const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === t.toDateString()) return '오늘';
  if (d.toDateString() === y.toDateString()) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};
const KIND_ICON = { document: FileText, image: ImageIcon, link: Link2, note: StickyNote, number: Hash } as const;

export function Space({ space, group, leaderView, offset = '14rem' }: { space: SpaceRef; group?: WorkGroup | null; leaderView?: boolean; offset?: string }) {
  const { team, uid } = useTeam();
  const [params, setParams] = useSearchParams();
  const data = useSpace(space);
  const items = useItems(team.id);
  const { byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  const subs = data.subs.data ?? [];
  const msgs = data.msgs.data ?? [];
  const reqs = data.reqs.data ?? [];
  const entries = useMemo(() => buildEntries(subs, msgs, reqs), [subs, msgs, reqs]);
  const loaded = !data.subs.isLoading && !data.msgs.isLoading;
  const latest = useMemo(() => [...entries.map((e) => e.at), ...msgs.map((m) => m.created_at), ...subs.flatMap((s) => (s.review_comments ?? []).map((c) => c.created_at))].reduce((m, t) => (t > m ? t : m), ''), [entries, msgs, subs]);
  const seenAt = useSpaceRead(space, loaded, latest);
  const unread = (e: Entry) => lastOther(e, uid, msgs) > seenAt;

  const [filter, setFilter] = useState<Filter>('all');
  const [sel, setSelState] = useState<Sel>(() => (params.get('open') ? { t: 'sub', id: params.get('open')! } : null));
  const setSel = (s: Sel) => { setSelState(s); if (params.get('open')) { const p = new URLSearchParams(params); p.delete('open'); setParams(p, { replace: true }); } };
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [answering, setAnswering] = useState<TeamRequest | null>(null);
  useEffect(() => { setFilter('all'); setSelState(params.get('open') ? { t: 'sub', id: params.get('open')! } : null); setFile(null); setAnswering(null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [space.kind, space.id]);

  const inGroup = !!group?.work_group_members.some((m) => m.user_id === uid);
  const canUpload = (s: Pick<Submission, 'author_id'>) => s.author_id === uid || inGroup;

  // 레일의 과제: 개인은 그 팀원이 맡은 과제, 그룹은 연결 목표 아래 과제 (+ 태그로 쓰인 것)
  const itemOf = (e: Entry) => (e.t === 'msg' ? e.m.item_id : e.t === 'req' ? e.r.item_id : e.s.item_id);
  const tasks = useMemo(() => {
    const used = new Set(entries.map(itemOf).filter(Boolean) as string[]);
    const all = [...byId.values()];
    const base = space.kind === 'user'
      ? all.filter((n) => n.owner_id === space.id && n.depth >= 1 && n.status !== 'done')
      : group?.item_id ? all.filter((n) => n.path.includes(group.item_id!) && n.status !== 'done') : [];
    const ids = new Set([...base.map((n) => n.id), ...used]);
    return [...ids].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => a!.path.concat(a!.id).join('/').localeCompare(b!.path.concat(b!.id).join('/'))) as Node[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byId, entries, space.kind, space.id, group?.item_id]);
  const tagged = (e: Entry, id: string) => { const it = itemOf(e); return !!it && (it === id || !!byId.get(it)?.path.includes(id)); };
  const countFor = (id: string) => entries.filter((e) => e.t !== 'ver' && tagged(e, id)).length;
  const subWait = (s: SpaceSub) => s.status === 'in_review' && s.request_type !== 'share' && !s.closed_at;
  const pass = (e: Entry) => {
    if (filter === 'all') return true;
    if (filter === 'unread') return unread(e);
    if (filter === 'wait') return (e.t === 'post' && subWait(e.s)) || (e.t === 'req' && e.r.status === 'open');
    if (filter === 'fix') return e.t === 'post' && e.s.status === 'needs_work' && !e.s.closed_at;
    if (filter === 'none') return e.t !== 'ver' && !itemOf(e);
    return tagged(e, filter.slice(2));
  };
  const shown = entries.filter(pass);
  const filterItem = filter.startsWith('i:') ? byId.get(filter.slice(2)) ?? null : null;
  const lastEntryOf = useMemo(() => { const m = new Map<string, string>(); for (const e of entries) if (e.t === 'post' || e.t === 'ver') m.set(e.s.id, e.id); return m; }, [entries]);

  // 흐름은 맨 아래부터 — 처음 열 때, 필터를 바꿀 때, 새 글이 왔는데 아래쪽을 보고 있을 때
  const scroller = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => { first.current = true; }, [filter, space.id]);
  useEffect(() => {
    const el = scroller.current;
    if (!loaded || !el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (!first.current && !near) return;
    const go = () => el.scrollTo({ top: el.scrollHeight, behavior: first.current ? 'auto' : 'smooth' });
    requestAnimationFrame(go); const t = setTimeout(() => { go(); first.current = false; }, 120);
    return () => clearTimeout(t);
  }, [loaded, shown.length, latest, filter]);

  if (data.missing) return <div className="rounded-2xl bg-amber-50 ring-1 ring-amber-200 p-5 text-sm text-amber-900">업무 스페이스 SQL(<b>19_work_space.sql</b>)을 먼저 실행해 주세요. 실행하면 대화·업무 카드가 여기에 모입니다.</div>;

  const counts = {
    all: entries.filter((e) => e.t !== 'ver').length,
    wait: entries.filter((e) => (e.t === 'post' && subWait(e.s)) || (e.t === 'req' && e.r.status === 'open')).length,
    fix: entries.filter((e) => e.t === 'post' && e.s.status === 'needs_work' && !e.s.closed_at).length,
    unread: entries.filter(unread).length,
    none: entries.filter((e) => e.t !== 'ver' && !itemOf(e)).length,
  };
  const defaultTag = filterItem?.id ?? null;

  const panel = sel?.t === 'sub' ? <SubPanel key={sel.id} id={sel.id} onClose={() => setSel(null)} leaderView={!!leaderView} canUploadFor={canUpload} byId={byId} />
    : sel?.t === 'msg' ? <MsgPanel key={sel.id} space={space} root={msgs.find((m) => m.id === sel.id)} replies={msgs.filter((m) => m.parent_id === sel.id)} byId={byId} onClose={() => setSel(null)} />
    : sel?.t === 'req' ? <ReqPanel key={sel.id} r={reqs.find((r) => r.id === sel.id)} onAnswer={(r) => setAnswering(r)} onClose={() => setSel(null)} />
    : filterItem ? <TaskPanel n={filterItem} entries={entries.filter((e) => tagged(e, filterItem.id))} />
    : <InfoPanel space={space} group={group} />;

  return (
    <div className="grid lg:grid-cols-[220px_minmax(0,1fr)_380px] gap-3 lg:h-[var(--sp-h)] lg:min-h-[520px]" style={{ ['--sp-h' as string]: `calc(100vh - ${offset})` }}>
      {/* 왼쪽 레일 */}
      <aside className="rounded-2xl bg-white ring-1 ring-slate-200 p-2.5 lg:overflow-y-auto">
        <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold text-slate-400 hidden lg:block">모아보기</div>
        <div className="flex lg:block gap-1 overflow-x-auto">
          <RailItem on={filter === 'all'} onClick={() => setFilter('all')} icon={<Inbox size={14} />} label="전체" n={counts.all} />
          <RailItem on={filter === 'wait'} onClick={() => setFilter('wait')} icon={<CircleDot size={14} className="text-indigo-500" />} label="결론 대기" n={counts.wait} />
          <RailItem on={filter === 'fix'} onClick={() => setFilter('fix')} icon={<RotateCcw size={14} className="text-amber-500" />} label="보완 중" n={counts.fix} />
          <RailItem on={filter === 'unread'} onClick={() => setFilter('unread')} icon={<MessageSquare size={14} className="text-rose-500" />} label="안 읽음" n={counts.unread} dot={counts.unread > 0} />
        </div>
        <div className="mt-2 border-t border-slate-100 pt-2">
          <div className="px-2 pb-1.5 text-[11px] font-semibold text-slate-400 flex items-center gap-1"><Target size={11} />{space.kind === 'user' ? '맡은 과제' : '그룹 과제'}</div>
          <div className="flex lg:block gap-1 overflow-x-auto">
            {tasks.map((n) => (
              <button key={n.id} onClick={() => setFilter(`i:${n.id}`)} className={cx('shrink-0 lg:w-full rounded-lg px-2.5 py-2 text-left', filter === `i:${n.id}` ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50')}>
                <div className="flex items-center gap-1.5 text-sm"><Hash size={13} className="text-slate-400 shrink-0" />
                  <span className={cx('flex-1 truncate max-w-[180px]', filter === `i:${n.id}` ? 'font-semibold text-indigo-800' : 'text-slate-700')}>{n.title}</span>
                  <span className="text-[11px] text-slate-400 num">{countFor(n.id)}</span></div>
                <div className="mt-1.5 ml-5 hidden lg:flex items-center gap-2"><span className="flex-1 h-1 rounded-full bg-slate-100"><span className="block h-1 rounded-full bg-indigo-500" style={{ width: `${n.progress}%` }} /></span>
                  <span className="text-[10px] text-slate-400 num">{n.progress}%{n.due_date ? ` · ~${fmtShort(n.due_date)}` : ''}</span></div>
              </button>
            ))}
            <RailItem on={filter === 'none'} onClick={() => setFilter('none')} icon={<Hash size={13} className="text-slate-300" />} label="기타 (태그 없음)" n={counts.none} />
          </div>
        </div>
      </aside>

      {/* 가운데 대화 흐름 */}
      <section className={cx('rounded-2xl bg-slate-50/80 ring-1 ring-slate-200 flex flex-col h-[72vh] lg:h-auto lg:min-h-0 relative overflow-hidden', drag && 'ring-2 ring-indigo-500')}
        onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) setDrag(true); }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDrag(false); }}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}>
        {drag && <div className="absolute inset-0 z-10 bg-indigo-50/90 flex flex-col items-center justify-center text-indigo-700 pointer-events-none"><Upload size={24} /><div className="mt-1.5 font-semibold">놓으면 업무 카드로 올릴 준비가 됩니다</div></div>}
        <div className="px-4 py-2.5 border-b border-slate-200 bg-white flex items-center gap-2 text-sm">
          {filterItem ? <><Hash size={14} className="text-indigo-600" /><b className="truncate">{filterItem.title}</b><span className="text-xs text-slate-400 shrink-0">이 과제 태그가 붙은 것만</span></>
            : <><Inbox size={14} className="text-slate-500" /><b>{({ all: '전체', wait: '결론 대기', fix: '보완 중', unread: '안 읽음', none: '기타 (태그 없음)' } as Record<string, string>)[filter]}</b><span className="text-xs text-slate-400 truncate">대화와 올린 업무가 시간순으로 · 업무는 스레드에서 이어 갑니다</span></>}
          {filter !== 'all' && <button onClick={() => setFilter('all')} className="ml-auto text-xs text-slate-500 hover:text-indigo-700 shrink-0">전체 보기</button>}
        </div>
        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-4 space-y-3.5">
          {loaded && data.days < 400 && (
            <div className="text-center"><button onClick={data.more} className="text-xs text-slate-500 hover:text-indigo-700 rounded-full bg-white ring-1 ring-slate-200 px-3 py-1">이전 기록 더 보기 · 지금은 최근 {data.days}일</button></div>
          )}
          {!loaded ? <Spinner /> : !shown.length ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-sm text-slate-500 py-10">
              <MessageSquare size={22} className="text-slate-300" />
              <p className="mt-2">{filter === 'all' ? (space.kind === 'group' ? '그룹방의 첫 이야기를 남겨 보세요.' : '아직 대화가 없습니다. 메시지를 남기거나 파일을 끌어다 놓아 보세요.') : '해당하는 것이 없습니다.'}</p>
            </div>
          ) : shown.map((e, i) => {
            const prev = shown[i - 1];
            const day = !prev || dayLabel(prev.at) !== dayLabel(e.at) ? dayLabel(e.at) : null;
            return (
              <div key={e.id} className="space-y-3.5">
                {day && <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400"><span className="flex-1 h-px bg-slate-200" />{day}<span className="flex-1 h-px bg-slate-200" /></div>}
                <EntryView e={e} msgs={msgs} byId={byId} unread={unread(e)} group={!!group} leaderView={!!leaderView}
                  showThread={e.t === 'post' || e.t === 'ver' ? lastEntryOf.get(e.s.id) === e.id : true}
                  sel={sel} onSel={setSel} onAnswer={(r) => setAnswering(r)} />
              </div>
            );
          })}
        </div>
        <SpaceComposer space={space} tasks={tasks} defaultTag={defaultTag} file={file} setFile={setFile} answering={answering} clearAnswer={() => setAnswering(null)} />
      </section>

      {/* 오른쪽 스레드 — 좁은 화면에선 덮어서 */}
      <div className={cx('lg:block lg:min-h-0 lg:h-full', sel ? 'fixed inset-0 z-40 bg-white p-2 lg:static lg:p-0 lg:bg-transparent' : 'hidden')}>{panel}</div>
    </div>
  );
}

function RailItem({ on, onClick, icon, label, n, dot }: { on: boolean; onClick: () => void; icon: React.ReactNode; label: string; n: number; dot?: boolean }) {
  return (
    <button onClick={onClick} className={cx('shrink-0 lg:w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-left whitespace-nowrap', on ? 'bg-indigo-50 text-indigo-800 font-semibold' : 'text-slate-600 hover:bg-slate-50')}>
      {icon}<span className="flex-1 truncate">{label}</span>{dot && <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />}<span className="text-[11px] text-slate-400 num">{n}</span>
    </button>
  );
}

// ---------------------------------------------------------------------
// 흐름 한 칸
// ---------------------------------------------------------------------
function EntryView({ e, msgs, byId, unread, showThread, sel, onSel, onAnswer }: {
  e: Entry; msgs: SpaceMessage[]; byId: Map<string, Node>; unread: boolean; group?: boolean; leaderView?: boolean; showThread: boolean; sel: Sel; onSel: (s: Sel) => void; onAnswer: (r: TeamRequest) => void;
}) {
  const { uid, nameOf, members } = useTeam();
  const leaderId = members.find((m) => m.role === 'leader')?.user_id;
  const who = e.t === 'msg' ? e.m.author_id : e.t === 'req' ? e.r.from_id : e.t === 'ver' ? e.v.created_by : e.s.author_id;
  const me = who === uid;
  const nm = (w: string) => (w === uid ? '나' : w === leaderId ? `${nameOf(w)} 팀장님` : nameOf(w));
  const tag = (() => { const it = e.t === 'msg' ? e.m.item_id : e.t === 'req' ? e.r.item_id : e.s.item_id; return it ? byId.get(it)?.title ?? null : null; })();
  const thread = (() => {
    if (!showThread) return null;
    if (e.t === 'msg') { const r = msgs.filter((m) => m.parent_id === e.m.id); return r.length ? { n: r.length, last: r[r.length - 1].author_id, body: r[r.length - 1].body, open: () => onSel({ t: 'msg', id: e.m.id }) } : { n: 0, open: () => onSel({ t: 'msg', id: e.m.id }) }; }
    if (e.t === 'req') return null;
    const cs = [...(e.s.review_comments ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const l = cs[cs.length - 1];
    return { n: cs.length, last: l?.author_id, body: l ? (l.body || l.file_name || '파일') : '', open: () => onSel({ t: 'sub', id: e.s.id }) };
  })();
  const isSel = (e.t === 'msg' && sel?.t === 'msg' && sel.id === e.m.id) || ((e.t === 'post' || e.t === 'ver') && sel?.t === 'sub' && sel.id === e.s.id) || (e.t === 'req' && sel?.t === 'req' && sel.id === e.r.id);
  const time = fmtTime(e.at);
  return (
    <div className={cx('flex gap-2.5 group', me && 'flex-row-reverse')}>
      <Avatar name={nameOf(who)} size={8} tone={me ? 'indigo' : 'slate'} />
      <div className={cx('max-w-[82%] sm:max-w-[75%] min-w-0 flex flex-col gap-1', me ? 'items-end' : 'items-start')}>
        <div className="text-[11px] text-slate-400"><b className="text-slate-600">{nm(who)}</b> · {time}{unread && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-rose-500 align-middle" />}</div>

        {e.t === 'msg' && (
          <button onClick={() => onSel({ t: 'msg', id: e.m.id })} className={cx('text-left rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words', me ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white ring-1 ring-slate-200 text-slate-800 rounded-tl-sm', isSel && 'ring-2 ring-violet-400')}>{e.m.body}</button>
        )}

        {e.t === 'req' && (
          <div className={cx('rounded-2xl bg-white ring-1 px-3.5 py-2.5 w-[340px] max-w-full', isSel ? 'ring-2 ring-violet-500' : 'ring-violet-200', me ? 'rounded-tr-sm' : 'rounded-tl-sm')}>
            <button onClick={() => onSel({ t: 'req', id: e.r.id })} className="w-full text-left">
              <div className="flex items-center gap-1.5 text-xs"><Send size={12} className="text-violet-600" /><b className="text-violet-700">요청 · {REQUEST_KIND[e.r.kind]?.label ?? '요청'}</b>
                <span className={cx('ml-auto font-semibold', e.r.status === 'open' ? 'text-violet-700' : 'text-emerald-700')}>{e.r.status === 'open' ? (e.r.due_date ? `${fmtShort(e.r.due_date)}까지` : '열림') : '완료'}</span></div>
              <div className="mt-1 text-sm font-semibold text-slate-800">{e.r.title}</div>
              {e.r.body && <div className="mt-0.5 text-xs text-slate-500 line-clamp-2">{e.r.body}</div>}
              {e.r.status === 'done' && e.r.response && <div className="mt-1.5 text-xs text-emerald-800 bg-emerald-50 rounded px-2 py-1">답: {e.r.response}</div>}
            </button>
            {e.r.status === 'open' && e.r.to_id === uid && <Button size="sm" variant="soft" className="mt-2" onClick={() => onAnswer(e.r)}><FileUp size={13} />답하기</Button>}
          </div>
        )}

        {(e.t === 'post' || e.t === 'ver') && (
          <>
            {e.t === 'post' && e.v?.note && <div className={cx('rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words', me ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white ring-1 ring-slate-200 text-slate-800 rounded-tl-sm')}>{e.v.note}</div>}
            {e.t === 'ver' && <div className={cx('rounded-2xl px-3.5 py-2 text-sm leading-relaxed', me ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white ring-1 ring-slate-200 text-slate-800 rounded-tl-sm')}><b>새 버전 v{e.v.version}</b>을 올렸어요{e.v.note ? ` — ${e.v.note}` : ''}</div>}
            <WorkCard s={e.s} v={e.t === 'ver' ? e.v : null} on={isSel} onClick={() => onSel({ t: 'sub', id: e.s.id })} />
          </>
        )}

        {(tag || (thread && (thread.n > 0 || e.t === 'msg'))) && (
          <div className={cx('flex items-center gap-2 text-[11px] max-w-full', me && 'flex-row-reverse')}>
            {tag && <span className="rounded-full bg-slate-100 text-slate-500 px-2 py-0.5 truncate max-w-[180px]"># {tag}</span>}
            {thread && thread.n > 0 ? (
              <button onClick={thread.open} className="text-indigo-700 font-semibold inline-flex items-center gap-1 hover:underline min-w-0"><MessageSquare size={11} className="shrink-0" /><span className="shrink-0 whitespace-nowrap">답글 {thread.n}</span>
                <span className="font-normal text-slate-500 truncate max-w-[220px]">· {thread.last === uid ? '나' : nameOf(thread.last!)}: {thread.body}</span></button>
            ) : thread && <button onClick={thread.open} className="text-slate-400 hover:text-indigo-700 opacity-0 group-hover:opacity-100 focus:opacity-100 inline-flex items-center gap-1"><MessageSquare size={11} />답글</button>}
          </div>
        )}
      </div>
    </div>
  );
}

/** 말풍선 안의 업무 카드 — 제목 · 버전 · 요청 · 상태 */
function WorkCard({ s, v, on, onClick }: { s: SpaceSub; v: { version: number; file_name: string | null } | null; on: boolean; onClick: () => void }) {
  const vs = s.submission_versions ?? [];
  const latestV = vs.reduce((m, x) => (x.version > m.version ? x : m), vs[0] ?? { version: 1, file_name: null } as never);
  const Icon = KIND_ICON[s.kind as keyof typeof KIND_ICON] ?? FileText;
  const rq = REQ_TAG[s.request_type] ?? REQ_TAG.approval;
  const fileName = (v ?? latestV)?.file_name;
  return (
    <button onClick={onClick} className={cx('text-left rounded-xl bg-white ring-1 px-3 py-2.5 w-[360px] max-w-full flex items-center gap-2.5 hover:ring-indigo-300', on ? 'ring-2 ring-indigo-500' : 'ring-slate-200')}>
      <span className={cx('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', s.kind === 'note' ? 'bg-amber-50 text-amber-600' : 'bg-indigo-50 text-indigo-600')}><Icon size={16} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5"><span className="text-sm font-semibold text-slate-800 truncate">{s.title}</span><span className="shrink-0 font-mono text-[10px] text-indigo-600">v{v?.version ?? latestV?.version ?? 1}</span></span>
        <span className="block text-[11px] text-slate-500 truncate"><span className={cx('font-semibold', s.request_type === 'approval' ? 'text-indigo-700' : s.request_type === 'feedback' ? 'text-sky-700' : 'text-slate-500')}>{rq.label}</span>{fileName ? ` · ${fileName}` : s.link_url ? ` · ${s.link_url}` : ''}</span>
      </span>
      {s.closed_at ? <span className="text-[10px] font-semibold rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 shrink-0">완료</span> : <Pill tone={STATUS[s.status].tone} className="shrink-0">{STATUS[s.status].label}</Pill>}
    </button>
  );
}

// ---------------------------------------------------------------------
// 입력창 — 평소엔 메시지. 파일·링크가 붙으면 업무 카드(요청 종류 선택)
// ---------------------------------------------------------------------
function SpaceComposer({ space, tasks, defaultTag, file, setFile, answering, clearAnswer }: {
  space: SpaceRef; tasks: Node[]; defaultTag: string | null; file: File | null; setFile: (f: File | null) => void; answering: TeamRequest | null; clearAnswer: () => void;
}) {
  const { team, uid, isLeader, hasFeature } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const send = useSendMessage(space);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [req, setReq] = useState<RequestType>('approval');
  const [tag, setTag] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (defaultTag) setTag(defaultTag); }, [defaultTag]);
  useEffect(() => { if (file) { setTitle(baseName(file.name)); area.current?.focus({ preventScroll: true }); } }, [file]);
  useEffect(() => { if (answering) { if (answering.item_id) setTag(answering.item_id); setReq('share'); area.current?.focus({ preventScroll: true }); } }, [answering]);
  const link = !file && isUrl(text) ? text.trim() : null;
  const work = !!file || !!link;
  const post = useMutation({
    mutationFn: async () => {
      const body = text.trim();
      if (work) {
        const r = await createPost({
          teamId: team.id, uid, ...(space.kind === 'user' ? { spaceId: space.id } : { groupId: space.id }), itemId: tag || null,
          req: isLeader ? 'share' : req, title: file ? (title.trim() || baseName(file.name)) : link!.slice(0, 80), file, text: '', link,
          kind: link ? 'link' : undefined, note: file ? body : '',
        });
        if (answering) await supabase.from('team_requests').update({ status: 'done', response: `자료 올림: ${r.sub.title}` }).eq('id', answering.id);
        return { kind: 'work' as const, ...r };
      }
      await send.mutateAsync({ body, item_id: tag || null });
      if (answering) await supabase.from('team_requests').update({ status: 'done', response: body.slice(0, 300) }).eq('id', answering.id);
      return { kind: 'msg' as const };
    },
    onSuccess: (r) => {
      setText(''); setFile(null); setTitle('');
      if (answering) { clearAnswer(); qc.invalidateQueries({ queryKey: ['requests'] }); toast('요청에 답했습니다. 완료로 바뀝니다.'); }
      if (r.kind === 'work') {
        // 이 스페이스는 '바뀐 것만' 받아 합치고, 다른 화면의 목록만 새로
        qc.invalidateQueries({ queryKey: ['space-delta'] });
        qc.invalidateQueries({ queryKey: ['subs'], predicate: (x) => x.queryKey[2] !== 'space' });
        ['review-queue', 'member-badges'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        if (!isLeader) startReview(r.sub, r.ver.id, hasFeature('ai_core'), () => qc.invalidateQueries({ queryKey: ['ai'] }));
      }
    },
    onError: (e) => toast(errorText(e)),
  });
  const ready = !!file || !!text.trim();
  return (
    <div className="p-3 border-t border-slate-100 bg-white">
      <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />
      {answering && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-violet-50 ring-1 ring-violet-200 px-3 py-1.5 text-xs text-violet-800">
          <Send size={12} /><span className="truncate">요청에 답하는 중 · <b>{answering.title}</b> — 메시지나 파일로 답하면 완료로 바뀝니다</span>
          <button onClick={clearAnswer} className="ml-auto text-violet-500 hover:text-violet-800" aria-label="답하기 취소"><X size={14} /></button>
        </div>
      )}
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2">
          {IMAGE.test(file.type) ? <ImageIcon size={16} className="text-indigo-600 shrink-0" /> : <FileText size={16} className="text-indigo-600 shrink-0" />}
          <input className="flex-1 min-w-0 bg-transparent text-sm font-medium focus:outline-none" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="제목" placeholder="제목" />
          <span className="text-[11px] text-slate-400 truncate max-w-[35%]">{file.name}</span>
          <button onClick={() => setFile(null)} className="text-slate-400 hover:text-slate-700" aria-label="파일 빼기"><X size={15} /></button>
        </div>
      )}
      <div className="rounded-xl ring-1 ring-slate-200 focus-within:ring-indigo-400">
        <textarea ref={area} rows={Math.min(5, Math.max(1, text.split('\n').length))} value={text} onChange={(e) => setText(e.target.value)} aria-label="메시지"
          onPaste={(e) => { const f = e.clipboardData.files?.[0]; if (f) { e.preventDefault(); setFile(namedPaste(f)); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (ready && !post.isPending) post.mutate(); } }}
          className="w-full resize-none text-sm px-3.5 pt-2.5 leading-6 focus:outline-none placeholder:text-slate-400 rounded-t-xl"
          placeholder={work ? '덧붙일 말 (선택) — Enter로 올리기' : '메시지 — Enter 보내기 · 파일을 끌어다 놓거나 캡처를 붙여 넣으면 업무 카드로 올라갑니다'} />
        <div className="flex items-center gap-1.5 px-2 pb-2 text-xs flex-wrap">
          <button onClick={() => fileRef.current?.click()} className="p-1.5 rounded text-slate-500 hover:bg-slate-100" title="파일 첨부" aria-label="파일 첨부"><Paperclip size={16} /></button>
          <select aria-label="과제 태그" value={tag} onChange={(e) => setTag(e.target.value)}
            className={cx('rounded-full border px-2.5 py-1 bg-white max-w-[200px]', tag ? 'border-indigo-300 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-500')}>
            <option value=""># 과제 태그 (선택)</option>{tasks.map((t) => <option key={t.id} value={t.id}># {t.title}</option>)}
          </select>
          {work && !isLeader && (['approval', 'feedback', 'share'] as RequestType[]).map((r) => (
            <button key={r} onClick={() => setReq(r)} className={cx('rounded-full border px-2.5 py-1', req === r ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-500')}>{REQ_TAG[r].label}</button>
          ))}
          {work && isLeader && <span className="text-slate-400">팀장님이 올린 자료는 '공유'로 올라갑니다</span>}
          <Button size="sm" className="ml-auto" disabled={!ready} loading={post.isPending} onClick={() => post.mutate()}>{work ? <><FileUp size={13} />올리기</> : <><Send size={13} />보내기</>}</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 오른쪽 패널들
// ---------------------------------------------------------------------
function PanelShell({ title, sub, actions, onClose, children, footer }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; onClose?: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <aside className="rounded-2xl bg-white ring-1 ring-slate-200 flex flex-col h-full min-h-0 max-h-[calc(100vh-1rem)] lg:max-h-none overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2 min-w-0">{title}{onClose && <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700 shrink-0" aria-label="닫기"><X size={16} /></button>}</div>
        {sub && <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 flex-wrap">{sub}</div>}
        {actions && <div className="mt-2 flex items-center gap-1.5 flex-wrap">{actions}</div>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      {footer}
    </aside>
  );
}

/** 업무 카드 스레드 — 버전 · 대화 · (팀장) AI 검토 · 승인 */
function SubPanel({ id, onClose, leaderView, canUploadFor, byId }: { id: string; onClose: () => void; leaderView: boolean; canUploadFor: (s: Submission) => boolean; byId: Map<string, Node> }) {
  const { team, uid, nameOf } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const live = { refetchInterval: 15_000 };
  const subQ = useQuery({ queryKey: ['sub', id], queryFn: () => q<Submission>(supabase.from('submissions').select('*').eq('id', id).single()), ...live });
  // 버전(본문 포함)은 결과물 행의 updated_at 이 바뀔 때만 다시 받는다
  const versQ = useQuery({ queryKey: ['sub', id, 'versions', subQ.data?.updated_at ?? ''], enabled: !!subQ.data, queryFn: () => q<SubmissionVersion[]>(supabase.from('submission_versions').select('*').eq('submission_id', id).order('version')), placeholderData: (p) => p });
  const comQ = useQuery({ queryKey: ['comments', id], queryFn: () => q<ReviewComment[]>(supabase.from('review_comments').select('*').eq('submission_id', id).order('created_at')), ...live });
  const versions = versQ.data ?? [];
  const vIds = versions.map((v) => v.id);
  const aiQ = useQuery({
    queryKey: ['ai', team.id, 'review', 'by-sub', id, vIds.length], enabled: leaderView && vIds.length > 0,
    queryFn: () => q<{ ref_id: string; content: Review }[]>(supabase.from('ai_outputs').select('ref_id, content').eq('team_id', team.id).eq('kind', 'review').eq('ref_table', 'submission_versions').in('ref_id', vIds).order('created_at', { ascending: false })),
  });
  const aiOf = (vid: string) => aiQ.data?.find((a) => a.ref_id === vid)?.content;
  const [tab, setTab] = useState<'talk' | 'ai'>('talk');
  const [aiVer, setAiVer] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const close = useCloseSubmission(team.id);
  const setStatus = useMutation({
    mutationFn: (status: 'approved' | 'needs_work') => q(supabase.from('submissions').update({ status }).eq('id', id)),
    onSuccess: (_d, s) => { toast(s === 'approved' ? '승인했습니다. 근거로 쌓입니다.' : '보완을 요청했습니다. 무엇을 고칠지 아래에 남겨 주세요.'); ['sub', 'review-queue', 'space-delta'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); qc.invalidateQueries({ queryKey: ['subs'], predicate: (x) => x.queryKey[2] !== 'space' }); },
    onError: (e) => toast(errorText(e)),
  });
  const toComments = useMutation({
    mutationFn: (qs: string[]) => q(supabase.from('review_comments').insert(qs.map((body) => ({ submission_id: id, version_id: versions[versions.length - 1]?.id ?? null, team_id: team.id, author_id: uid, body })))),
    onSuccess: () => { toast('질문을 대화에 남겼습니다'); setTab('talk'); qc.invalidateQueries({ queryKey: ['comments', id] }); },
  });
  const scroller = useRef<HTMLDivElement>(null);
  const n = versions.length + (comQ.data?.length ?? 0);
  useEffect(() => { requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight })); }, [n, tab]);
  const sub = subQ.data;
  const latest = versions[versions.length - 1];
  if (!sub || !latest) return <PanelShell title={<span className="text-sm text-slate-500">불러오는 중…</span>} onClose={onClose}><Spinner /></PanelShell>;
  const rq = REQ_TAG[sub.request_type] ?? REQ_TAG.approval;
  const tag = sub.item_id ? byId.get(sub.item_id)?.title : null;
  const flow = [...versions.map((v) => ({ at: v.created_at, v, c: null as ReviewComment | null })), ...(comQ.data ?? []).map((c) => ({ at: c.created_at, v: null as SubmissionVersion | null, c }))].sort((a, b) => a.at.localeCompare(b.at));
  const isLeaderPost = leaderView && sub.author_id === uid;
  return (
    <PanelShell onClose={onClose}
      title={<><span className={cx('shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5', rq.cls)}>{rq.label}</span><span className="font-semibold text-sm truncate">{sub.title}</span>
        <Link to={`/work/${sub.id}`} className="shrink-0 text-slate-400 hover:text-indigo-700" title="크게 보기" aria-label="크게 보기"><Maximize2 size={14} /></Link></>}
      sub={<>{tag && <span className="inline-flex items-center gap-0.5"><Hash size={11} />{tag}</span>}
        {sub.closed_at ? <span className="text-[10px] font-semibold rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">완료함</span> : <Pill tone={STATUS[sub.status].tone}>{STATUS[sub.status].label}</Pill>}
        <span>{nameOf(sub.author_id)} · {fmtDate(sub.created_at)}</span></>}
      actions={leaderView && !isLeaderPost ? <>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
          <button onClick={() => setTab('talk')} className={cx('px-2.5 py-1 rounded-md', tab === 'talk' ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>대화</button>
          <button onClick={() => setTab('ai')} className={cx('px-2.5 py-1 rounded-md inline-flex items-center gap-1', tab === 'ai' ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}><Sparkles size={11} className="text-violet-600" />AI 검토</button>
        </div>
        <span className="ml-auto flex gap-1">
          {sub.request_type !== 'share' && <>
            <Button size="sm" variant="ghost" loading={setStatus.isPending && setStatus.variables === 'needs_work'} onClick={() => setStatus.mutate('needs_work')}><RotateCcw size={12} />보완</Button>
            <Button size="sm" loading={setStatus.isPending && setStatus.variables === 'approved'} onClick={() => setStatus.mutate('approved')}><CheckCircle2 size={12} />승인</Button>
          </>}
          {sub.closed_at ? <Button size="sm" variant="ghost" onClick={() => close.mutate({ id: sub.id, close: false, uid })}><Undo2 size={12} />다시 열기</Button>
            : <Button size="sm" variant="ghost" onClick={() => close.mutate({ id: sub.id, close: true, uid })}><Check size={12} />완료</Button>}
        </span>
      </> : undefined}
      footer={tab === 'talk' ? <div onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true); } }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }} className={cx(drag && 'ring-2 ring-inset ring-indigo-400')}>
        <Composer sub={sub} latest={latest} canUpload={canUploadFor(sub)} file={file} setFile={setFile} /></div> : undefined}>
      {tab === 'ai' ? (
        <div className="p-3"><AiReview teamId={sub.team_id} version={versions.find((v) => v.id === aiVer) ?? latest} versions={versions} reviewOf={aiOf} onPick={setAiVer} onToComments={(qs) => toComments.mutate(qs)} /></div>
      ) : (
        <div ref={scroller} className="p-3.5 space-y-3 bg-slate-50/50 min-h-full">
          {flow.map((x) => x.v ? <VersionMini key={x.v.id} sub={sub} v={x.v} latest={x.v.id === latest.id} /> : <Bubble key={x.c!.id} c={x.c!} mine={x.c!.author_id === uid} />)}
        </div>
      )}
    </PanelShell>
  );
}

function VersionMini({ sub, v, latest }: { sub: Submission; v: SubmissionVersion; latest: boolean }) {
  const { nameOf } = useTeam();
  const [open, setOpen] = useState(latest);
  return (
    <div className={cx('rounded-xl ring-1 bg-white overflow-hidden', latest ? 'ring-indigo-200' : 'ring-slate-200')}>
      <button onClick={() => setOpen((x) => !x)} className={cx('w-full px-3 py-2.5 flex items-center gap-2.5 text-left', latest ? 'bg-indigo-50/60' : 'bg-slate-50')}>
        <span className={cx('w-8 h-8 rounded-lg text-white flex flex-col items-center justify-center shrink-0', latest ? 'bg-indigo-600' : 'bg-slate-400')}><FileUp size={12} /><span className="text-[9px] font-bold font-mono leading-none">v{v.version}</span></span>
        <span className="min-w-0 flex-1"><span className="block text-[13px] text-slate-800"><b>{nameOf(v.created_by)}</b> 님이 {v.version === 1 ? '처음 올림' : `새 버전 v${v.version} 올림`}</span>
          <span className="block text-[11px] text-slate-500 truncate">{v.note || (latest ? '최신' : '이전 버전')} · {fmtDate(v.created_at)}</span></span>
        <span className="text-[11px] font-semibold text-indigo-700 shrink-0">{open ? '접기' : '보기'}</span>
      </button>
      {open && <div className="px-3 pb-3"><VersionBody sub={sub} v={v} older={!latest} /></div>}
    </div>
  );
}

/** 대화 스레드 */
function MsgPanel({ space, root, replies, byId, onClose }: { space: SpaceRef; root?: SpaceMessage; replies: SpaceMessage[]; byId: Map<string, Node>; onClose: () => void }) {
  const { uid, nameOf } = useTeam();
  const send = useSendMessage(space);
  const [body, setBody] = useState('');
  if (!root) return null;
  const Msg = ({ m }: { m: SpaceMessage }) => {
    const me = m.author_id === uid;
    return (
      <div className={cx('flex gap-2', me && 'flex-row-reverse')}>
        <Avatar name={nameOf(m.author_id)} size={7} tone={me ? 'indigo' : 'slate'} />
        <div className={cx('max-w-[82%] flex flex-col', me ? 'items-end' : 'items-start')}>
          <div className="text-[10px] text-slate-400 mb-0.5"><b className="text-slate-600">{me ? '나' : nameOf(m.author_id)}</b> · {fmtDate(m.created_at)}</div>
          <div className={cx('rounded-2xl px-3 py-1.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words', me ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-slate-100 text-slate-800 rounded-tl-sm')}>{m.body}</div>
        </div>
      </div>
    );
  };
  const submit = () => { if (body.trim()) send.mutate({ body, parent_id: root.id }, { onSuccess: () => setBody('') }); };
  return (
    <PanelShell onClose={onClose} title={<><MessageSquare size={15} className="text-violet-600" /><span className="font-semibold text-sm">스레드</span></>}
      sub={root.item_id && byId.get(root.item_id) ? <span className="inline-flex items-center gap-0.5"><Hash size={11} />{byId.get(root.item_id)!.title}</span> : undefined}
      footer={<div className="p-3 border-t border-slate-100 flex gap-2">
        <textarea rows={1} ref={(el) => { if (el && !el.dataset.f) { el.dataset.f = '1'; el.focus({ preventScroll: true }); } }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="답글 — Enter 보내기"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          className="flex-1 resize-none text-sm rounded-xl ring-1 ring-slate-200 px-3 py-2 focus:outline-none focus:ring-indigo-400" />
        <Button onClick={submit} loading={send.isPending} aria-label="보내기"><Send size={14} /></Button></div>}>
      <div className="p-3.5 space-y-3 bg-slate-50/50 min-h-full">
        <Msg m={root} />
        <div className="text-[11px] text-slate-400 flex items-center gap-2"><span className="flex-1 h-px bg-slate-200" />답글 {replies.length}개<span className="flex-1 h-px bg-slate-200" /></div>
        {replies.map((r) => <Msg key={r.id} m={r} />)}
      </div>
    </PanelShell>
  );
}

/** 팀장 요청 */
function ReqPanel({ r, onAnswer, onClose }: { r?: TeamRequest; onAnswer: (r: TeamRequest) => void; onClose: () => void }) {
  const { uid, nameOf } = useTeam();
  const qc = useQueryClient();
  const done = useMutation({
    mutationFn: () => q(supabase.from('team_requests').update({ status: 'done', response: '확인했습니다' }).eq('id', r!.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['requests'] }),
  });
  if (!r) return null;
  const mine = r.to_id === uid;
  return (
    <PanelShell onClose={onClose} title={<><Send size={15} className="text-violet-600" /><span className="font-semibold text-sm">요청 · {REQUEST_KIND[r.kind]?.label}</span></>}
      sub={<><span>{nameOf(r.from_id)} → {nameOf(r.to_id)}</span><span>· {fmtDate(r.created_at)}</span>{r.due_date && <span className="font-semibold text-violet-700">· {fmtShort(r.due_date)}까지</span>}</>}>
      <div className="p-4 space-y-3 text-sm">
        <div className="font-semibold text-base">{r.title}</div>
        {r.body && <p className="text-slate-700 whitespace-pre-wrap">{r.body}</p>}
        {r.status === 'done' ? (
          <div className="rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-3 text-emerald-900"><b>완료</b>{r.responded_at && ` · ${fmtDate(r.responded_at)}`}{r.response && <p className="mt-1 text-sm">{r.response}</p>}</div>
        ) : mine ? (
          <div className="space-y-2">
            <Button className="w-full" onClick={() => onAnswer(r)}><FileUp size={14} />메시지나 자료로 답하기</Button>
            <Button variant="ghost" className="w-full" loading={done.isPending} onClick={() => done.mutate()}>확인만 하고 완료로 표시</Button>
          </div>
        ) : <p className="text-slate-500">아직 답을 기다리는 중입니다.</p>}
      </div>
    </PanelShell>
  );
}

/** 과제로 모아볼 때 — 과제 요약 */
function TaskPanel({ n, entries }: { n: Node; entries: Entry[] }) {
  const posts = entries.filter((e) => e.t === 'post');
  const wait = posts.filter((e) => e.t === 'post' && e.s.status === 'in_review' && e.s.request_type !== 'share').length;
  const last = entries.reduce((m, e) => (e.at > m ? e.at : m), '');
  return (
    <PanelShell title={<><Target size={15} className="text-indigo-600" /><span className="font-semibold text-sm truncate">{n.title}</span></>}
      sub={<span>{n.due_date ? `~${fmtShort(n.due_date)}` : '기한 없음'}</span>}>
      <div className="p-4 space-y-4 text-sm">
        <div><div className="text-xs text-slate-500 mb-1">진척</div>{n.measure === 'recurring' ? <span className="text-xs text-slate-400">정기 업무</span> : <PlanBar item={n} />}</div>
        <div className="rounded-xl bg-slate-50 p-3 space-y-1.5 text-xs text-slate-600">
          <div className="flex justify-between"><span>이 과제로 올린 업무</span><b className="text-slate-800">{posts.length}건</b></div>
          <div className="flex justify-between"><span>결론 대기</span><b className="text-indigo-700">{wait}건</b></div>
          <div className="flex justify-between"><span>대화·요청 포함 전체</span><b className="text-slate-800">{entries.filter((e) => e.t !== 'ver').length}건</b></div>
          <div className="flex justify-between"><span>마지막 활동</span><b className="text-slate-800">{last ? fmtDate(last) : '—'}</b></div>
        </div>
        <Link to={`/goals?item=${n.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700">팀목표에서 보기<ExternalLink size={12} /></Link>
        <p className="text-xs text-slate-400">말풍선이나 업무 카드를 누르면 이 자리에 스레드가 열립니다.</p>
      </div>
    </PanelShell>
  );
}

function InfoPanel({ space, group }: { space: SpaceRef; group?: WorkGroup | null }) {
  const { nameOf, uid } = useTeam();
  return (
    <PanelShell title={<><MessageSquare size={15} className="text-indigo-600" /><span className="font-semibold text-sm">이렇게 쓰세요</span></>}>
      <div className="p-4 space-y-3 text-sm text-slate-600">
        <ul className="space-y-2 list-disc pl-4">
          <li>그냥 말은 <b className="text-slate-800">메시지</b>로 보냅니다. 기록으로만 남습니다.</li>
          <li>파일·링크·캡처를 올리면 <b className="text-slate-800">업무 카드</b>가 됩니다. 컨펌·의견·공유를 고르면 상태와 버전이 따라갑니다.</li>
          <li><b className="text-slate-800"># 과제 태그</b>를 붙이면 왼쪽에서 과제별로 모아 볼 수 있습니다.</li>
          <li>말풍선이나 카드를 누르면 여기에서 <b className="text-slate-800">스레드</b>로 이어 갑니다.</li>
        </ul>
        {space.kind === 'group' && group && (
          <div className="pt-3 border-t border-slate-100">
            <div className="text-xs font-semibold text-slate-600 mb-1.5 inline-flex items-center gap-1"><Users size={12} />{group.name}</div>
            <div className="flex flex-wrap gap-1.5">{group.work_group_members.map((m) => <span key={m.user_id} className="inline-flex items-center gap-1 text-xs text-slate-600"><Avatar name={nameOf(m.user_id)} size={7} tone={m.user_id === uid ? 'indigo' : 'slate'} />{nameOf(m.user_id)}</span>)}</div>
            <p className="mt-2 text-xs text-slate-400">팀장님도 함께 봅니다.</p>
          </div>
        )}
      </div>
    </PanelShell>
  );
}
