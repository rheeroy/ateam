// ATEAM의 코칭 — 팀장이 누르면 AI가 초안을 쓰고, 팀장이 고쳐서 보낸다. 팀원에게는 'ATEAM의 코칭'으로만 보인다(보낸 사람 표시 없음). 평가 근거로 남지 않는다.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, RefreshCw, Send } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, invoke, errorText } from '../../lib/supabase';
import type { AiOutput } from '../../lib/types';
import { cx, fmtDate } from '../../lib/format';
import { Button, Modal, Spinner, inputCls, useToast } from '../ui';
import { LogoMark } from '../Brand';

export interface CoachingNote { id: string; team_id: string; member_id: string; title: string; body: string; seen_at: string | null; acked_at: string | null; helpful: boolean | null; created_at: string }
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
const missing = (e: unknown) => /coaching_notes|coaching_mark/.test(errorText(e));

/** 팀원에게 보이는 카드 — 미리보기와 팀원 홈에서 같은 모양 */
export function CoachCard({ title, body, date, footer, highlight }: { title: string; body: string; date?: string; footer?: React.ReactNode; highlight?: boolean }) {
  const blocks = strip(body).split(/\n\s*\n/).map((b) => b.split('\n').filter((l) => l.trim()));
  return (
    <div className={cx('rounded-2xl bg-white ring-1 overflow-hidden', highlight ? 'ring-2 ring-indigo-400 shadow-lg' : 'ring-slate-200 shadow-sm')}>
      <div className="px-5 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white flex items-center gap-2">
        <span className="w-6 h-6 rounded-md bg-white/20 flex items-center justify-center"><LogoMark size={14} /></span>
        <span className="font-bold"><span className="font-extrabold">ATEAM</span><sup className="ml-0.5 text-[9px] font-bold opacity-80">AI</sup>의 코칭</span>
        {date && <span className="ml-auto text-xs text-indigo-100">{fmtDate(date)}</span>}
      </div>
      <div className="p-5">
        <div className="text-[17px] font-bold leading-snug">{title || '제목'}</div>
        <p className="mt-1 text-sm text-slate-500">ATEAM AI가 최근 업무 기록을 보고, 다음 리뷰 전에 미리 챙기면 좋을 것을 정리했어요.</p>
        {blocks.map((ls, i) => {
          const [head, ...rest] = ls;
          const isHead = rest.length > 0 && !head.startsWith('·') && head.length <= 14;
          const lines = isHead ? rest : ls;
          return (
            <div key={i} className="mt-4">
              {isHead && <div className="text-[11px] font-bold text-slate-400">{head}</div>}
              <div className="mt-1 space-y-1.5">
                {lines.map((l, j) => l.trim().startsWith('·')
                  ? <div key={j} className="flex gap-2 text-[13px] text-slate-700 leading-relaxed"><span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" /><span>{l.trim().replace(/^·\s*/, '')}</span></div>
                  : <p key={j} className="text-[13px] text-slate-700 leading-relaxed">{l}</p>)}
              </div>
            </div>
          );
        })}
      </div>
      {footer && <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center gap-2">{footer}</div>}
    </div>
  );
}

/** 팀장: 이 팀원에게 보낸 코칭 */
export function useCoachingFor(memberId: string) {
  const { team } = useTeam();
  return useQuery({
    queryKey: ['coaching', team.id, memberId],
    queryFn: async () => {
      const { data, error } = await supabase.from('coaching_notes').select('*').eq('team_id', team.id).eq('member_id', memberId).order('created_at', { ascending: false }).limit(10);
      if (error) { if (missing(error)) return [] as CoachingNote[]; throw new Error(error.message); }
      return data as CoachingNote[];
    },
  });
}

/** 팀장: ATEAM의 코칭 보내기 — 열면 바로 초안 생성 → 고치기 → 보내기 */
export function CoachModal({ memberId, name, onClose }: { memberId: string; name: string; onClose: () => void }) {
  const { team } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const sent = useCoachingFor(memberId);
  const [f, setF] = useState({ title: '', body: '' });
  const [preview, setPreview] = useState(false);
  const gen = useMutation({
    mutationFn: () => invoke<AiOutput<{ title: string; body: string }>>('ai-coach', { team_id: team.id, member_id: memberId }),
    onSuccess: (o) => setF({ title: strip(o.content?.title ?? ''), body: strip(o.content?.body ?? '') }),
  });
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('coaching_notes').insert({ team_id: team.id, member_id: memberId, title: f.title.trim(), body: f.body.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['coaching', team.id] }); toast(`${name} 님에게 'ATEAM AI의 코칭'을 보냈습니다.`); onClose(); },
    onError: (e) => toast(missing(e) ? '코칭 테이블이 아직 없습니다. 13_coaching.sql 을 실행해 주세요.' : /COACHING_LIMIT/.test(errorText(e)) ? '한 팀원에게는 7일 동안 2건까지 보낼 수 있습니다.' : errorText(e)),
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { gen.mutate(); }, []);
  const last = sent.data?.[0];
  return (
    <Modal open onClose={onClose} wide title={<span className="inline-flex items-center gap-2"><span className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center"><LogoMark size={13} /></span><span><span className="font-extrabold">ATEAM</span><sup className="ml-0.5 text-[9px] font-bold opacity-80">AI</sup> 코칭하기 · {name}</span></span>}>
      <p className="text-sm text-slate-600 leading-relaxed rounded-lg bg-indigo-50/70 px-3 py-2">
        직접 말하기 껄끄러운 개선점을 <b>ATEAM<sup className="ml-0.5 text-[9px] font-bold opacity-80">AI</sup> 코치</b>를 통해 전달하는 기능입니다. 보내면 {name} 님 홈에 <b>'ATEAM<sup className="ml-0.5 text-[9px] font-bold opacity-80">AI</sup>의 코칭'</b>으로 도착합니다. 자유롭게 수정해보세요.
      </p>
      {gen.isPending ? (
        <div className="py-12 text-center text-sm text-slate-500"><Spinner /><div className="mt-2">ATEAM AI가 {name} 님의 최근 업무 기록을 보고 초안을 쓰는 중…</div></div>
      ) : gen.isError && !f.body ? (
        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-6 text-sm text-slate-600 text-center">{errorText(gen.error)}
          <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => gen.mutate()}><RefreshCw size={13} />다시 만들기</Button></div></div>
      ) : (
        <div className="mt-4 space-y-2">
          <input className={cx(inputCls, 'font-semibold')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목" />
          <textarea rows={12} className={cx(inputCls, 'text-sm leading-relaxed')} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <div className="flex items-center gap-3 text-xs">
            <button onClick={() => setPreview(true)} className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1"><Eye size={13} />{name} 님에게 이렇게 보여요</button>
            <button onClick={() => gen.mutate()} className="text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"><RefreshCw size={12} />다시 만들기</button>
            {last && <span className="ml-auto text-slate-400">최근 보낸 코칭 {fmtDate(last.created_at)} · {last.acked_at ? '확인함' : last.seen_at ? '읽음' : '안 읽음'}</span>}
          </div>
        </div>
      )}
      <div className="mt-4 flex items-center gap-2">
        <span className="text-[11px] text-slate-400">보내기 전에는 {name} 님에게 아무것도 가지 않습니다</span>
        <Button className="ml-auto" disabled={!f.title.trim() || !f.body.trim() || gen.isPending} loading={send.isPending} onClick={() => send.mutate()}><Send size={14} />보내기</Button>
      </div>
      {preview && createPortal(
        <div className="fixed inset-0 z-[100] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setPreview(false)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 text-center text-xs text-white/80">{name} 님 홈에 이렇게 도착합니다 · 아무 곳이나 누르면 닫힙니다</div>
            <CoachCard title={f.title} body={f.body} date={new Date().toISOString()} footer={<><span className="text-[11px] text-slate-400">평가와 무관한 코칭이에요</span><span className="ml-auto text-sm rounded-lg ring-1 ring-slate-200 bg-white px-3 py-1.5">도움이 됐어요</span><span className="text-sm rounded-lg bg-teal-600 text-white font-semibold px-3 py-1.5">확인했어요</span></>} />
          </div>
        </div>, document.body)}
    </Modal>
  );
}

/** 팀원 홈: 받은 코칭 (확인하지 않은 것 위주) */
export function MyCoaching({ focusId }: { focusId?: string | null }) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const qy = useQuery({
    queryKey: ['my-coaching', team.id, uid],
    queryFn: async () => {
      const { data, error } = await supabase.from('coaching_notes').select('*').eq('team_id', team.id).eq('member_id', uid).order('created_at', { ascending: false }).limit(6);
      return error ? [] : (data as CoachingNote[]);
    },
  });
  const mark = useMutation({
    mutationFn: async (p: { id: string; ack?: boolean; helpful?: boolean }) => { await supabase.rpc('coaching_mark', { p_id: p.id, p_ack: !!p.ack, p_helpful: p.helpful ?? null }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-coaching', team.id, uid] }),
  });
  const list = (qy.data ?? []).filter((c) => !c.acked_at || c.id === focusId);
  // 화면에 보이면 '읽음'
  useEffect(() => { for (const c of list) if (!c.seen_at) mark.mutate({ id: c.id }); }, [qy.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list.length) return null;
  return (
    <div className="space-y-3">
      {list.slice(0, 2).map((c) => (
        <CoachCard key={c.id} title={c.title} body={c.body} date={c.created_at} highlight={c.id === focusId}
          footer={<>
            <span className="text-[11px] text-slate-400">평가와 무관한 코칭이에요</span>
            <button disabled={c.helpful === true} onClick={() => mark.mutate({ id: c.id, helpful: true })} className={cx('ml-auto text-sm rounded-lg ring-1 px-3 py-1.5', c.helpful ? 'ring-indigo-300 bg-indigo-50 text-indigo-700' : 'ring-slate-200 bg-white hover:bg-slate-50')}>{c.helpful ? '도움이 됐어요 ✓' : '도움이 됐어요'}</button>
            <button onClick={() => mark.mutate({ id: c.id, ack: true })} className="text-sm rounded-lg bg-teal-600 text-white font-semibold px-3 py-1.5 hover:bg-teal-700">{c.acked_at ? '확인함' : '확인했어요'}</button>
          </>} />
      ))}
    </div>
  );
}
