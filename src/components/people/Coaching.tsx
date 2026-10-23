// ATEAM 코칭 — 팀장이 누르면 AI가 초안을 쓰고, 팀장이 고쳐서 보낸다. 팀원에게는 'ATEAM 업무 피드백'으로만 보인다(보낸 사람 표시 없음). 평가 근거로 남지 않는다.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Library, RefreshCw, Send } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, invoke, errorText } from '../../lib/supabase';
import type { AiOutput } from '../../lib/types';
import { cx, fmtDate } from '../../lib/format';
import { Button, Modal, Spinner, inputCls, useToast } from '../ui';
import { AiSup, AteamAI, LogoMark } from '../Brand';
import { methodTitle } from '../../lib/playbook';

export interface CoachingNote { id: string; team_id: string; member_id: string; title: string; body: string; seen_at: string | null; acked_at: string | null; helpful: boolean | null; created_at: string }
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
const missing = (e: unknown) => /coaching_notes|coaching_mark/.test(errorText(e));

/** 미리보기 — 팀원 매니징 보드 › Feedback 의 'ATEAM 업무 피드백' 줄과 같은 모양 (FromLeader.tsx) */
export function CoachCard({ title, body, date }: { title: string; body: string; date?: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-semibold text-slate-700">Feedback</div>
      <div className="px-5 py-3.5 flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-violet-50 text-violet-600"><LogoMark size={15} weight={4} /></span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="font-semibold text-slate-500"><AteamAI /> 업무 피드백</span>{date && <span>· {fmtDate(date)}</span>}
          </div>
          <div className="mt-0.5 text-sm font-semibold leading-snug text-slate-900">{title || '제목'}</div>
          <div className="text-sm text-slate-600 mt-0.5 whitespace-pre-line">{strip(body)}</div>
          <div className="mt-2 flex items-center gap-2">
            <span className="ml-auto text-xs font-medium text-slate-600 px-2 py-1">도움됐어요</span>
            <span className="text-xs font-medium rounded-lg ring-1 ring-slate-200 px-2.5 py-1 text-slate-700">확인</span>
          </div>
        </div>
      </div>
      <div className="px-5 py-2 border-t border-slate-100 bg-slate-50/60 text-[11px] text-slate-400">목록에서는 본문 두 줄만 보이고, 팀원이 '전체 보기'로 펼칩니다. 보낸 사람은 표시되지 않습니다.</div>
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
  const [methods, setMethods] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [empty, setEmpty] = useState(false);   // 초안 본문이 비어서 온 경우 (응답이 잘림)
  const gen = useMutation({
    mutationFn: () => invoke<AiOutput<{ title: string; body: string }>>('ai-coach', { team_id: team.id, member_id: memberId }),
    onSuccess: (o) => {
      setF({ title: strip(o.content?.title ?? ''), body: strip(o.content?.body ?? '') });
      setEmpty(!(o.content?.body ?? '').trim());
      // 초안에 실제로 녹인 플레이북 방법론 (본문에 제목이 들어간 것만)
      const body = `${o.content?.title ?? ''} ${o.content?.body ?? ''}`;
      setMethods((o.sources ?? []).filter((s) => s.type === 'consulting').map((s) => methodTitle(s.label)).filter((t) => body.includes(t.split(' (')[0])));
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('coaching_notes').insert({ team_id: team.id, member_id: memberId, title: f.title.trim(), body: f.body.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['coaching', team.id] }); toast(`${name} 님에게 코칭을 보냈습니다. ${name} 님에게는 'ATEAM 업무 피드백'으로 보입니다.`); onClose(); },
    onError: (e) => toast(missing(e) ? '코칭 테이블이 아직 없습니다. 13_coaching.sql 을 실행해 주세요.' : /COACHING_LIMIT/.test(errorText(e)) ? '한 팀원에게는 7일 동안 2건까지 보낼 수 있습니다.' : errorText(e)),
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { gen.mutate(); }, []);
  const last = sent.data?.[0];
  return (
    <Modal open onClose={onClose} wide title={<span className="inline-flex items-center gap-2"><span className="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center"><LogoMark size={13} /></span><span><span className="font-extrabold">ATEAM</span><AiSup className="opacity-80" /> 코칭하기 · {name}</span></span>}>
      <p className="text-sm text-slate-600 leading-relaxed rounded-lg bg-indigo-50/70 px-3 py-2">
        직접 말하기 껄끄러운 개선점을 <b>ATEAM<AiSup className="opacity-80" /> 코치</b>를 통해 전달하는 기능입니다. 보내면 {name} 님 매니징 보드 › Feedback에 <b>'ATEAM<AiSup className="opacity-80" /> 업무 피드백'</b>으로 도착합니다. 자유롭게 수정해보세요.
      </p>
      {gen.isPending ? (
        <div className="py-12 text-center text-sm text-slate-500"><Spinner /><div className="mt-2"><AteamAI />가 {name} 님의 최근 업무 기록을 보고 초안을 쓰는 중…</div></div>
      ) : (gen.isError || empty) && !f.body ? (
        <div className="mt-4 rounded-lg bg-slate-50 px-4 py-6 text-sm text-slate-600 text-center">{gen.isError ? errorText(gen.error) : '초안 본문이 비어 있습니다. 다시 만들기를 눌러 주세요.'}
          <div className="mt-3"><Button size="sm" variant="secondary" onClick={() => gen.mutate()}><RefreshCw size={13} />다시 만들기</Button></div></div>
      ) : (
        <div className="mt-4 space-y-2">
          <input className={cx(inputCls, 'font-semibold')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="제목" />
          <textarea rows={12} className={cx(inputCls, 'text-sm leading-relaxed')} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <div className="flex items-center gap-3 text-xs">
            <button onClick={() => setPreview(true)} className="font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1"><Eye size={13} />{name} 님에게 이렇게 보여요</button>
            <button onClick={() => gen.mutate()} className="text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"><RefreshCw size={12} />다시 만들기</button>
            {methods.length > 0 && <span className="inline-flex items-center gap-1 text-[#7D5414]" title="ATEAM Method™에서 이 팀원의 보완점에 맞는 방법론을 골라 녹였습니다"><Library size={12} />{methods.join(', ')}</span>}
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
            <div className="mb-2 text-center text-xs text-white/80">{name} 님 매니징 보드 › Feedback에 이렇게 보입니다 · 아무 곳이나 누르면 닫힙니다</div>
            <CoachCard title={f.title} body={f.body} date={new Date().toISOString()} />
          </div>
        </div>, document.body)}
    </Modal>
  );
}
