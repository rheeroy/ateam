// Sim.Box — 팀원 업무플랫폼 탭. 자유롭게 시뮬레이션하고 메모하는 곳 (본인만 봄)
//   왼쪽: 대화(파일 · 초안을 끌어다 놓기 · 물어보기 · 메모) — 대화 전에는 사용법 3줄 + 예시 질문
//   오른쪽: 짚어 볼 포인트(예상 질문 · 보완할 점 · 잘한 점) — 가장 최근 것
//   기록 찾기는 없다 — [새로 시작]하면 지금 대화를 지운다 (30일 지나면 자동 삭제)
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileText, FlaskConical, Lock, NotebookPen, Paperclip, RotateCcw, Send, X } from 'lucide-react';
import { useTeam } from '../../state/session';
import { useSimMessages, useSimQuota, useSimReset, useSimSend, type SimAttachment, type SimMessage, type SimPanel } from '../../lib/simbox';
import { errorText } from '../../lib/supabase';
import { extractText, shrinkImage, IMAGE_EXT, MAX_BYTES } from '../../lib/extract';
import { cx } from '../../lib/format';
import { Spinner, useToast } from '../ui';

const EXAMPLES: [string, string][] = [
  ['💬', '우리 팀장님이라면 이 보고서에 뭐라고 하실까?'],
  ['🎯', '최근 팀장님의 주 관심사는?'],
  ['📈', '요즘 본부에서 중요하게 보는 건?'],
  ['🧭', '이 내용을 팀장님께 어떻게 보고하면 좋을까?'],
  ['🔁', '내 결과물에서 자주 지적받는 부분은?'],
  ['✉️', '이 메일 톤 괜찮을까?'],
];
const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.gif,.webp';

const toB64 = (blob: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => fail(new Error('파일을 읽지 못했습니다'));
  r.readAsDataURL(blob);
});

/** 파일 → 보낼 첨부 (문서 · 표는 글로, PDF · 사진은 원본) */
async function readAttachment(file: File): Promise<SimAttachment> {
  if (file.size > Math.min(MAX_BYTES, 10 * 1024 * 1024)) throw new Error(`${file.name}: 10MB 이하 파일만 올릴 수 있습니다`);
  if (IMAGE_EXT.test(file.name)) return { name: file.name, kind: 'image', data: await toB64(await shrinkImage(file)), media_type: 'image/jpeg' };
  if (/\.pdf$/i.test(file.name)) return { name: file.name, kind: 'pdf', data: await toB64(file) };
  const { text } = await extractText(file);
  if (!text.trim()) throw new Error(`${file.name}: 읽을 글이 없습니다`);
  return { name: file.name, kind: 'text', text: text.slice(0, 60000) };
}

/** **굵게** 정도만 */
function Rich({ text }: { text: string }) {
  return <>{text.split('\n').map((line, i) => (
    <span key={i} className="block min-h-[0.5em]">{line.split(/(\*\*[^*]+\*\*)/g).map((p, k) => (p.startsWith('**') && p.endsWith('**') ? <b key={k}>{p.slice(2, -2)}</b> : p))}</span>
  ))}</>;
}

export function SimBox() {
  const { team, uid } = useTeam();
  const toast = useToast();
  const msgs = useSimMessages(team.id, uid);
  const quota = useSimQuota(team.id);
  const send = useSimSend(team.id, uid);
  const reset = useSimReset(team.id, uid);
  const [text, setText] = useState('');
  const [att, setAtt] = useState<SimAttachment | null>(null);
  const [reading, setReading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [sure, setSure] = useState(false);
  const [pending, setPending] = useState<{ text: string; att: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const list = msgs.data ?? [];
  const lastAi = [...list].reverse().find((m) => m.role === 'assistant');
  const panel = [...list].reverse().find((m) => m.role === 'assistant' && m.meta?.panel)?.meta?.panel ?? null;
  const q = quota.data;
  const out = !!q && (q.remaining <= 0 || q.day_remaining <= 0);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [list.length, pending]);

  const pick = async (file?: File | null) => {
    if (!file) return;
    setReading(true);
    try { setAtt(await readAttachment(file)); } catch (e) { toast(errorText(e)); } finally { setReading(false); }
  };
  const go = (t = text) => {
    const body = t.trim();
    if ((!body && !att) || send.isPending || out) return;
    setPending({ text: body, att: att?.name ?? null });
    send.mutate({ text: body, attachment: att }, {
      onSuccess: () => { setText(''); setAtt(null); },
      onError: (e) => toast(errorText(e)),
      onSettled: () => setPending(null),
    });
  };

  if (msgs.isError) return <p className="text-sm text-slate-500 py-8 text-center">Sim.Box를 쓰려면 DB 업데이트(36_workspace_plus.sql)가 필요합니다.</p>;
  return (
    <div className="space-y-3">
      {/* 소개 — 한 줄 */}
      <div className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 bg-gradient-to-r from-indigo-50 via-violet-50 to-fuchsia-50 ring-1 ring-indigo-100 min-w-0">
        <FlaskConical size={16} className="text-indigo-600 shrink-0" />
        <span className="ap-font text-[13px] text-indigo-800 shrink-0">Sim.Box</span>
        <b className="text-[13.5px] text-slate-800 shrink-0">자유롭게 시뮬레이션하고 메모하는 곳</b>
        <span className="text-[13px] text-slate-500 truncate hidden md:inline">· 초안 · 아이디어 · 보내기 전 메일, 뭐든 편하게 던져 보세요. 팀장님이라면 어떻게 볼지 바로 답해 드려요. 몇 번을 다시 해도 괜찮아요.</span>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
          className={cx('rounded-2xl bg-white ring-1 flex flex-col h-[calc(100vh-16rem)] min-h-[460px]', drag ? 'ring-2 ring-indigo-400' : 'ring-slate-200')}>
          {!!list.length && (
            <div className="flex items-center gap-2 px-5 pt-3 pb-2 border-b border-slate-100">
              <span className="ap-font text-[11px] text-indigo-700">Sim.Box</span>
              <span className="hidden sm:inline text-[11.5px] text-slate-400">새로 시작하면 지금 대화는 지워집니다</span>
              {sure ? (
                <span className="ml-auto flex items-center gap-1.5 text-xs">
                  <span className="text-slate-500">지금 대화를 지울까요?</span>
                  <button onClick={() => reset.mutate(undefined, { onSettled: () => setSure(false) })} className="font-bold text-rose-600 px-2 py-1 rounded-md hover:bg-rose-50">지우기</button>
                  <button onClick={() => setSure(false)} className="text-slate-500 px-2 py-1 rounded-md hover:bg-slate-50">취소</button>
                </span>
              ) : <button onClick={() => setSure(true)} className="ml-auto text-xs font-semibold text-slate-600 rounded-lg px-2.5 py-1.5 ring-1 ring-slate-200 hover:bg-slate-50 inline-flex items-center gap-1 whitespace-nowrap"><RotateCcw size={12} />새로 시작</button>}
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {msgs.isLoading ? <Spinner /> : !list.length && !pending ? (
              <Start onAsk={(t) => (att ? go(t) : setText(t))} />
            ) : (
              <div className="flex flex-col gap-2.5">
                {list.map((m) => <Bubble key={m.id} m={m} />)}
                {pending && <>
                  <Bubble m={{ id: 'p', role: 'user', body: pending.text, created_at: '', attachment: pending.att ? { name: pending.att } : null, meta: null }} />
                  <div className="self-start rounded-2xl rounded-bl-md bg-slate-50 ring-1 ring-slate-200 px-4 py-2.5 text-[13px] text-slate-500 inline-flex items-center gap-2"><span className="ap-rad w-3.5 h-3.5 rounded-full ring-1 ring-violet-300" />생각하는 중…</div>
                </>}
                {!pending && !!lastAi?.meta?.chips?.length && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {lastAi.meta.chips.map((c) => <button key={c} onClick={() => go(c)} disabled={out} className="text-xs font-semibold text-indigo-700 bg-white ring-1 ring-indigo-100 rounded-full px-3 py-1.5 hover:bg-indigo-50 disabled:opacity-50">{c}</button>)}
                  </div>
                )}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="px-4 pb-3">
            {(att || reading) && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-lg bg-slate-50 ring-1 ring-slate-200 px-2.5 py-1.5 text-xs text-slate-700 max-w-full">
                <FileText size={13} className="text-indigo-600 shrink-0" />{reading ? '파일 읽는 중…' : <span className="truncate">{att!.name}</span>}
                {att && <button onClick={() => setAtt(null)} aria-label="첨부 빼기" className="text-slate-400 hover:text-slate-700"><X size={13} /></button>}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl bg-white ring-1 ring-slate-200 shadow-[0_4px_14px_rgba(15,23,42,.05)] px-3 py-2 focus-within:ring-indigo-300">
              <button onClick={() => fileRef.current?.click()} title="파일 올리기" className="p-1.5 text-slate-400 hover:text-indigo-600 shrink-0"><Paperclip size={17} /></button>
              <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
              <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} disabled={out}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }}
                placeholder={out ? '이번 기간 Sim.Box 횟수를 모두 썼어요' : list.length ? '이어서 물어보거나 메모하세요' : '무엇이든 올리거나 물어보세요 — 파일은 끌어다 놓아도 됩니다'}
                className="flex-1 resize-none bg-transparent text-sm py-1.5 max-h-40 focus:outline-none placeholder:text-slate-400" />
              <button onClick={() => go()} disabled={(!text.trim() && !att) || send.isPending || out}
                className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-indigo-600 text-white text-[13px] font-bold px-3.5 py-2 hover:bg-indigo-700 disabled:opacity-40"><Send size={13} />보내기</button>
            </div>
            <div className="flex items-center gap-1.5 pt-2 text-[12px] text-slate-500">
              <Lock size={12} className="text-slate-400" /><b className="text-slate-700 font-semibold">여기서 쓴 내용은 나만 볼 수 있습니다.</b>
              {q && <span className="ml-auto">이번 달 <b className="text-slate-700 num">{q.remaining}/{q.limit}회</b> 남음{q.day_remaining < q.remaining ? <span className="text-slate-400"> · 오늘 {q.day_remaining}회</span> : null}</span>}
            </div>
          </div>
        </div>

        <PanelCard panel={panel} />
      </div>
    </div>
  );
}

function Start({ onAsk }: { onAsk: (t: string) => void }) {
  const steps: [string, ReactNode][] = [['1', <>파일이나 초안을<br />끌어다 놓거나 붙여 넣기</>], ['2', <>궁금한 걸 그냥 물어보기<br /><span className="text-[11.5px] text-slate-400">오른쪽에 피드백이 정리됩니다</span></>], ['3', <>떠오른 생각은<br />메모처럼 남겨 두기</>]];
  return (
    <div className="pt-2">
      <div className="text-[11px] font-extrabold tracking-wider text-indigo-500 mb-2">이렇게 써 보세요</div>
      <div className="grid sm:grid-cols-3 gap-2.5">
        {steps.map(([n, t]) => <div key={n} className="rounded-xl bg-slate-50 px-3.5 py-3 text-[13px] leading-snug text-slate-700"><b className="text-indigo-600 mr-1">{n}</b>{t}</div>)}
      </div>
      <div className="text-[11px] font-extrabold tracking-wider text-indigo-500 mt-6 mb-2">이런 걸 물어볼 수 있어요</div>
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map(([i, t]) => <button key={t} onClick={() => onAsk(t)} className="text-[12.5px] font-semibold text-indigo-800 bg-white ring-1 ring-indigo-100 rounded-full px-3 py-1.5 hover:bg-indigo-50"><span className="mr-1">{i}</span>{t}</button>)}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: SimMessage }) {
  if (m.role === 'user') return (
    <div className="self-end max-w-[78%] rounded-2xl rounded-br-md bg-indigo-600 text-white px-4 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap">
      {m.attachment && <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2 py-1 text-xs"><FileText size={12} />{m.attachment.name}</div>}
      {m.body && <div>{m.body}</div>}
    </div>
  );
  return <div className="self-start max-w-[84%] rounded-2xl rounded-bl-md bg-white ring-1 ring-slate-200 px-4 py-2.5 text-[13.5px] leading-relaxed text-slate-800"><Rich text={m.body} /></div>;
}

function PanelCard({ panel }: { panel: SimPanel | null }) {
  if (!panel) return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 px-5 py-10 text-center hidden lg:block">
      <span className="mx-auto w-12 h-12 rounded-2xl bg-violet-50 text-violet-500 flex items-center justify-center"><NotebookPen size={20} /></span>
      <b className="block mt-3 text-sm text-slate-700">짚어 볼 포인트가 여기에 모입니다</b>
      <p className="mt-1.5 text-[12.5px] text-slate-400 leading-relaxed">초안이나 파일을 보여 주면<br />예상 질문 · 보완할 점 · 잘한 점을 대화와 따로 모아 드려요</p>
    </div>
  );
  const Sec = ({ title, tone, rows }: { title: string; tone: string; rows: { a: string; b?: string }[] }) => !rows.length ? null : (
    <div className="mt-4 first:mt-0">
      <div className="text-[11px] font-extrabold tracking-wider text-indigo-500 mb-2">{title}</div>
      {rows.map((r, i) => <div key={i} className={cx('border-l-[3px] pl-3 mb-3', tone)}><b className="text-[13.5px] text-slate-900">{r.a}</b>{r.b && <div className="text-[12.5px] text-slate-500 leading-relaxed mt-0.5">{r.b}</div>}</div>)}
    </div>
  );
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 px-5 py-4">
      <div className="flex items-baseline gap-2 mb-3"><b className="text-sm">짚어 볼 포인트</b><span className="text-[11.5px] text-slate-400 truncate">{panel.title}</span></div>
      <Sec title="예상 질문" tone="border-violet-400" rows={panel.questions.map((x) => ({ a: `"${x.q.replace(/^"|"$/g, '')}"`, b: x.tip }))} />
      <Sec title="보완할 점" tone="border-amber-400" rows={panel.fixes.map((x) => ({ a: x.t, b: x.d }))} />
      <Sec title="잘한 점" tone="border-emerald-400" rows={panel.good.map((x) => ({ a: x.t, b: x.d }))} />
      <p className="mt-2 pt-3 border-t border-slate-100 text-[11.5px] text-slate-400">참고한 것: 팀 방향 · 팀 목표 · 내가 받은 의견 · 팀 노하우</p>
    </div>
  );
}
