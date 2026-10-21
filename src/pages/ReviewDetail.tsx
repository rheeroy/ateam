// 업무 상세 — 대화창: 올린 버전과 말풍선이 시간순으로 한 흐름. 맨 아래 대화창 하나로 보내기·파일(새 버전/첨부)
//   왼쪽은 이 업무 카드의 스레드(버전 + 대화). 스레드 안에서 또 답글을 달지는 않는다. 팀장은 오른쪽에서 AI 1차 검토를 본다(팀원에게는 보이지 않음).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, CheckCircle2, ChevronDown, ExternalLink, FileUp, Lock, MessageSquare, Paperclip, RotateCcw, Send, Sparkles, Undo2, Unlock, Users, X, XCircle } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi } from '../lib/hooks';
import type { ReviewComment, Submission, SubmissionVersion } from '../lib/types';
import { cx, fmtDate, fmtShort } from '../lib/format';
import { addVersion, namedPaste, startReview, uploadAttachment } from '../lib/post';
import { useGroups } from '../lib/groups';
import { KIND_TAG, REQ_TAG, useCloseSubmission } from '../lib/work';
import { Avatar, Button, Empty, Pill, Spinner, useToast } from '../components/ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../components/Prov';
import { FILE_ACCEPT, IMAGE } from '../components/Upload';
import { STATUS } from './MySubmissions';

export interface Review {
  depth_score: number; summary: string; decisions?: string[];
  brief?: { tone: 'risk' | 'watch' | 'good'; text: string; why?: string };
  strengths: { section: string; text: string }[]; gaps: { section: string; text: string }[];
  questions: string[]; change_from_previous?: string; trend_note?: string;
  criteria_check?: { criterion: string; met: boolean; note: string; tag?: string }[];
}
/** 오른쪽 AI 검토에서 보고 있는 버전 */
type Panel = string | null;

const DOT: Record<string, string> = { risk: 'bg-rose-500', watch: 'bg-amber-400', good: 'bg-emerald-500' };
/** 한 줄 판단에서 '~해 보입니다' 부분만 (버전 흐름용) */
const shortOf = (r?: Review) => {
  if (!r) return null;
  const t = r.brief?.text ?? '';
  const tail = t.includes("'") ? t.slice(t.lastIndexOf("'") + 1).replace(/^\s*(은|는|이|가|에|에는)\s+/, '') : t;
  return tail || r.summary?.split(/[.。]/)[0] || '검토됨';
};

export function AiReview({ teamId, version, versions, reviewOf, onPick, onToComments }: {
  teamId: string; version: SubmissionVersion; versions: SubmissionVersion[]; reviewOf: (vid: string) => Review | undefined; onPick: (vid: string) => void; onToComments: (qs: string[]) => void;
}) {
  const rv = useLatestAi<Review>(teamId, 'review', { ref_table: 'submission_versions', ref_id: version.id });
  const gen = useGenerate('ai-review-submission');
  const approved = useQuery({
    queryKey: ['approved-count', teamId],
    queryFn: async () => (await supabase.from('submissions').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('status', 'approved')).count ?? 0,
  });
  const kh = useQuery({
    queryKey: ['knowhow-count', teamId, 'review'],
    queryFn: async () => (await supabase.from('knowhow_cards').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('active', true).neq('source', 'consulting').contains('applies_to', ['review'])).count ?? 0,
  });
  const r = rv.data;
  return (
    <ProvBlock rail className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 font-semibold">AI 검토 <span className="font-mono text-xs font-semibold rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5">v{version.version}</span>
          {r && <ProvChip kind={kindFromStatus(r.status)} label="AI 생성" sources={r.sources} level={r.level} depth={r.depth}
            note="올릴 때마다 그 버전을 AI가 먼저 읽은 의견입니다. 판단은 팀장님 코멘트로 남습니다." />}
        </div>
        <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Lock size={11} />팀장에게만 보임</span>
      </div>
      {versions.length > 1 && (
        <ol className="mt-3 rounded-xl bg-slate-50 ring-1 ring-slate-100 p-1.5 space-y-0.5">
          {versions.map((v) => {
            const vr = reviewOf(v.id);
            const on = v.id === version.id;
            return (
              <li key={v.id}>
                <button onClick={() => onPick(v.id)} className={cx('w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs', on ? 'bg-white ring-1 ring-indigo-200 shadow-sm' : 'hover:bg-white/70')}>
                  <span className={cx('font-mono font-semibold rounded px-1.5 py-0.5', on ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200')}>v{v.version}</span>
                  <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', vr?.brief ? DOT[vr.brief.tone] : vr ? 'bg-indigo-300' : 'bg-slate-300')} />
                  <span className={cx('truncate', vr ? 'text-slate-700' : 'text-slate-400')}>{vr ? shortOf(vr) : 'AI 검토 전'}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-slate-400">{fmtShort(v.created_at)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {rv.isLoading ? <Spinner /> : !r ? (
        <Empty icon={<Sparkles size={18} />} title="아직 1차 검토가 없습니다"
          action={<Button loading={gen.isPending} onClick={() => gen.mutate({ version_id: version.id })}>지금 검토하기 · 구독 포함</Button>}>
          팀원이 올릴 때 자동으로 시작됩니다. 자동 검토는 이번 달 AI 사용량의 60%까지만 쓰고 나머지는 팀장님 몫으로 남겨 두니, 비어 있으면 여기서 직접 요청하세요.
        </Empty>
      ) : (
        <>
          {r.content.summary && <p className="mt-4 text-sm text-slate-800 leading-relaxed">{r.content.summary}</p>}
          {!!r.content.decisions?.length && (
            <div className="mt-3 rounded-lg bg-rose-50/60 ring-1 ring-rose-100 px-3 py-2 text-sm">
              <div className="text-xs font-semibold text-rose-700 mb-1">팀장님이 정할 것</div>
              <ul className="space-y-0.5">{r.content.decisions.map((d, i) => <li key={i} className="text-slate-700">· {d}</li>)}</ul>
            </div>
          )}
          {!!r.content.criteria_check?.length ? (
            <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-sm">
              <div className="text-xs font-semibold text-indigo-800 mb-1.5 inline-flex items-center gap-1"><BookOpen size={12} />팀장님 기준으로 본 결과</div>
              <ul className="space-y-1.5">
                {r.content.criteria_check.map((c, i) => (
                  <li key={i} className="flex gap-2">
                    {c.met ? <CheckCircle2 size={15} className="text-emerald-600 mt-0.5 shrink-0" /> : <XCircle size={15} className="text-rose-500 mt-0.5 shrink-0" />}
                    <span className="text-slate-700"><b className="font-semibold">{c.criterion}</b> — {c.note}{c.tag && <TaggedText text={` [${c.tag}]`} sources={r.sources} />}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : kh.data === 0 ? (
            <Link to="/knowhow" className="mt-4 block rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600 hover:border-indigo-300">
              <b>내 기준으로 검토받기</b> — '좋은 기획서의 기준' 같은 팀장님 기준을 <span className="text-indigo-700">내 노하우</span>에 넣어 두면, 다음 검토부터 그 기준에 맞는지 먼저 짚습니다.
            </Link>
          ) : null}
          <div className="mt-4 space-y-3 text-sm">
            {!!r.content.strengths?.length && (
              <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs font-semibold text-emerald-700 mb-1">잘된 부분</div>
                {r.content.strengths.map((s, i) => <p key={i} className="text-slate-700 leading-relaxed"><b className="font-semibold">{s.section}</b> — {s.text}</p>)}</div>
            )}
            {!!r.content.gaps?.length && (
              <div className="rounded-lg bg-amber-50 p-3"><div className="text-xs font-semibold text-amber-800 mb-1">보완이 필요한 부분</div>
                {r.content.gaps.map((s, i) => <p key={i} className="text-slate-700 leading-relaxed"><b className="font-semibold">{s.section}</b> — {s.text}</p>)}</div>
            )}
            {!!r.content.questions?.length && (
              <div className="rounded-lg border border-slate-200 p-3"><div className="text-xs font-semibold text-slate-500 mb-1">캐물어 볼 질문</div>
                {r.content.questions.map((qq, i) => <p key={i} className="text-slate-700">· {qq}</p>)}</div>
            )}
            {r.content.change_from_previous && <p className="text-xs text-slate-600"><b>이전 버전 대비</b> · {r.content.change_from_previous}</p>}
            {(r.content as Review & { carried_from?: string }).carried_from && (
              <Button size="sm" variant="secondary" loading={gen.isPending} onClick={() => gen.mutate({ version_id: version.id, force: true })}><Sparkles size={13} />이 버전으로 다시 검토</Button>
            )}
          </div>
          <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/50 p-3 text-xs space-y-2.5">
            <div className="font-semibold text-violet-800">기록이 쌓여 새로 보이는 것</div>
            {r.content.trend_note ? (
              <div className="flex gap-2"><Unlock size={14} className="text-violet-600 mt-0.5 shrink-0" /><span className="text-slate-700"><b>지난 결과물과 비교</b> — {r.content.trend_note}</span></div>
            ) : (
              <div className="flex gap-2"><Lock size={14} className="text-slate-400 mt-0.5 shrink-0" /><span className="text-slate-500"><b className="text-slate-600">지난 결과물과 비교</b> — 이 팀원의 검토 기록이 3건 쌓이면 열립니다.</span></div>
            )}
            <div className="flex gap-2"><Lock size={14} className="text-slate-400 mt-0.5 shrink-0" />
              <span className="text-slate-500 flex-1"><b className="text-slate-600">우리 팀 기준으로 검토</b> — 팀장님이 승인한 결과물들의 공통점을 기준 삼아 봅니다.
                <span className="mt-1.5 flex items-center gap-2"><span className="flex-1 h-1 rounded-full bg-slate-200"><span className="block h-1 rounded-full bg-violet-400" style={{ width: `${Math.min(100, ((approved.data ?? 0) / 20) * 100)}%` }} /></span><span className="font-mono num">{approved.data ?? 0}/20건</span></span>
              </span></div>
          </div>
          {!!r.content.questions?.length && (
            <Button variant="soft" className="mt-3 w-full" onClick={() => onToComments(r.content.questions)}>AI가 짚은 질문을 대화창에 남기기</Button>
          )}
        </>
      )}
    </ProvBlock>
  );
}


export function useSignedUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { setUrl(null); if (path) supabase.storage.from('submissions').createSignedUrl(path, 600).then(({ data }) => setUrl(data?.signedUrl ?? null)); }, [path]);
  return url;
}

/** 올린 것 한 건(버전)의 본문 — 길면 접어 둔다 */
export function VersionBody({ sub, v, older, preview = true }: { sub: Submission; v: SubmissionVersion; older?: boolean; /** 파일 미리보기(PDF·이미지) — 좁은 스레드에선 끈다 */ preview?: boolean }) {
  const url = useSignedUrl(v.file_path);
  const [open, setOpen] = useState(false);
  const long = (v.extracted_text ?? '').length > (older ? 160 : 600);
  return (
    <div className="mt-3">
      {v.file_name && (
        <a href={url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl ring-1 ring-slate-200 bg-white px-3 py-2.5 hover:ring-indigo-300 hover:bg-indigo-50/30 max-w-md">
          <span className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0"><Paperclip size={16} /></span>
          <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-800 truncate">{v.file_name}</span><span className="block text-[11px] text-slate-400 uppercase">{(v.file_name.split('.').pop() ?? '').slice(0, 5)} 파일</span></span>
          <span className="text-xs font-semibold text-indigo-700 inline-flex items-center gap-0.5 shrink-0">열기<ExternalLink size={12} /></span>
        </a>
      )}
      {preview && v.mime_type === 'application/pdf' && url && <iframe title="PDF" src={url} className="mt-3 w-full h-[520px] rounded-lg border border-slate-200" />}
      {preview && url && v.mime_type && IMAGE.test(v.mime_type) && <img src={url} alt={sub.title} className="mt-3 max-h-[480px] rounded-lg border border-slate-200" />}
      {v.version === 1 && sub.link_url && <a href={sub.link_url} target="_blank" rel="noreferrer" className="mt-2 block text-sm text-indigo-700 font-semibold break-all hover:underline">{sub.link_url} ↗</a>}
      {v.value != null && <div className="mt-2 text-3xl font-bold num">{v.value}</div>}
      {!!v.extracted_text && (
        <div className="relative mt-2">
          <div className={cx('text-[15px] leading-7 text-slate-800 whitespace-pre-wrap', !open && long && (older ? 'max-h-20 overflow-hidden' : 'max-h-60 overflow-hidden'))}>{v.extracted_text}</div>
          {long && !open && <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />}
          {long && <button onClick={() => setOpen((x) => !x)} className="relative mt-1 text-xs font-semibold text-indigo-700 inline-flex items-center gap-0.5">{open ? '접기' : '전체 보기'}<ChevronDown size={12} className={open ? 'rotate-180' : ''} /></button>}
        </div>
      )}
    </div>
  );
}

type Item = { t: 'v'; at: string; v: SubmissionVersion } | { t: 'c'; at: string; c: ReviewComment };

export default function ReviewDetail() {
  const { id } = useParams();
  const { isLeader, nameOf, uid, team } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const live = { refetchInterval: 15_000 };
  const subQ = useQuery({ queryKey: ['sub', id], queryFn: () => q<Submission>(supabase.from('submissions').select('*').eq('id', id!).single()), ...live });
  // 버전(본문 포함)은 15초마다 다시 받지 않는다 — 결과물 행(가벼움)의 updated_at 이 바뀔 때만
  const versQ = useQuery({ queryKey: ['sub', id, 'versions', subQ.data?.updated_at ?? ''], enabled: !!subQ.data, queryFn: () => q<SubmissionVersion[]>(supabase.from('submission_versions').select('*').eq('submission_id', id!).order('version')), placeholderData: (p) => p });
  const comQ = useQuery({ queryKey: ['comments', id], queryFn: () => q<ReviewComment[]>(supabase.from('review_comments').select('*').eq('submission_id', id!).order('created_at')), ...live });
  const groups = useGroups();
  const versions = versQ.data ?? [];
  const vIds = versions.map((v) => v.id);
  const aiQ = useQuery({
    queryKey: ['ai', team.id, 'review', 'by-sub', id, vIds.length], enabled: isLeader && vIds.length > 0,
    queryFn: () => q<{ ref_id: string; content: Review }[]>(supabase.from('ai_outputs').select('ref_id, content').eq('team_id', team.id).eq('kind', 'review').eq('ref_table', 'submission_versions').in('ref_id', vIds).order('created_at', { ascending: false })),
  });
  const aiOf = (vid: string) => aiQ.data?.find((a) => a.ref_id === vid)?.content;
  const latest = versions[versions.length - 1];
  const [panel, setPanel] = useState<Panel>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const close = useCloseSubmission(team.id);
  const setStatus = useMutation({
    mutationFn: (status: 'approved' | 'needs_work') => q(supabase.from('submissions').update({ status }).eq('id', id!)),
    onSuccess: (_d, s) => { toast(s === 'approved' ? '승인했습니다. 근거로 쌓입니다.' : '보완을 요청했습니다. 대화창에 무엇을 고칠지 남겨 주세요.'); qc.invalidateQueries({ queryKey: ['sub', id] }); qc.invalidateQueries({ queryKey: ['subs'] }); qc.invalidateQueries({ queryKey: ['review-queue'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const toComments = useMutation({
    mutationFn: (qs: string[]) => q(supabase.from('review_comments').insert(qs.map((body) => ({ submission_id: id, version_id: latest!.id, team_id: team.id, author_id: uid, body })))),
    onSuccess: () => { toast('질문을 대화창에 남겼습니다'); qc.invalidateQueries({ queryKey: ['comments', id] }); },
    onError: (e) => toast(errorText(e)),
  });
  useEffect(() => { setPanel(null); setFile(null); }, [id]);

  // 대화 흐름: 올린 버전 + 댓글(답글 제외)을 시간순으로
  const all = comQ.data ?? [];
  const stream: Item[] = useMemo(() => [
    ...versions.map((v) => ({ t: 'v' as const, at: v.created_at, v })),
    ...all.map((c) => ({ t: 'c' as const, at: c.created_at, c })),  // 예전 답글도 흐름에 그대로 (스레드 안 답글은 없앰)
  ].sort((a, b) => a.at.localeCompare(b.at)), [versions, all]);
  const scroller = useRef<HTMLDivElement>(null);
  const seen = useRef(0);
  useEffect(() => {
    if (!stream.length || stream.length === seen.current) return;
    const first = seen.current === 0;
    seen.current = stream.length;
    requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: first ? 'auto' : 'smooth' }));
  }, [stream.length]);

  if (subQ.isLoading || (subQ.data && versQ.isPending)) return <Spinner />;
  const sub = subQ.data;
  if (!sub || !latest) return <Empty title="업무를 찾을 수 없습니다" />;
  // 체크인은 업무플랫폼 대화 안에서 본다 (알림 링크도 여기로)
  if (sub.kind === 'checkin') {
    const to = isLeader
      ? (sub.group_id ? `/work/g/${sub.group_id}?open=${sub.id}` : `/work/u/${sub.space_id ?? sub.author_id}?open=${sub.id}`)
      : `/my/submissions?${sub.group_id ? `g=${sub.group_id}&` : ''}open=${sub.id}`;
    return <Navigate to={to} replace />;
  }
  const isAuthor = sub.author_id === uid;
  const group = sub.group_id ? (groups.data ?? []).find((g) => g.id === sub.group_id) ?? null : null;
  const inGroup = !!group?.work_group_members.some((m) => m.user_id === uid);
  const canUpload = isAuthor || inGroup;
  const leaderView = isLeader && !isAuthor;
  const showAi = leaderView && sub.request_type !== 'share' && sub.kind !== 'number';
  const aiVer = panel ?? latest.id;
  const setAiVer = (vid: string) => setPanel(vid);
  const rq = REQ_TAG[sub.request_type] ?? REQ_TAG.approval;
  const makers = [...new Set(versions.map((v) => v.created_by))];
  const back = isLeader
    ? (group ? { to: '/work', label: '업무플랫폼' } : isAuthor ? { to: '/work', label: '업무플랫폼' } : { to: `/work/u/${sub.author_id}`, label: `${nameOf(sub.author_id)} 업무 스페이스` })
    : (group ? { to: `/my/submissions?g=${group.id}`, label: group.name } : { to: '/my/submissions', label: '내 스페이스' });

  return (
    <section>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link to={back.to} className="text-sm text-slate-500 hover:text-indigo-700">← {back.label}</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">
            <span className={cx('text-[11px] font-bold rounded px-1.5 py-0.5', rq.cls)}>{rq.label}</span>{sub.title}
            <span className="font-mono text-sm font-semibold rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5">v{latest.version}</span></h1>
          <p className="mt-1 text-sm text-slate-500 flex items-center gap-2 flex-wrap">
            {group && <span className="inline-flex items-center gap-1 text-indigo-700 font-medium"><Users size={13} />{group.name}</span>}
            {makers.length > 1 ? `${makers.map(nameOf).join(' · ')} 공동` : nameOf(sub.author_id)} · 처음 올림 {fmtDate(sub.created_at)} · {KIND_TAG[sub.kind] ?? '문서'}
            {sub.closed_at ? <span className="text-[11px] font-semibold rounded-full bg-slate-100 text-slate-500 px-2 py-0.5">정리됨</span> : <Pill tone={STATUS[sub.status].tone}>{STATUS[sub.status].label}</Pill>}</p>
        </div>
        {leaderView && (
          <div className="flex items-center gap-2 flex-wrap">
            {sub.request_type !== 'share' && <>
              <Button variant="secondary" loading={setStatus.isPending && setStatus.variables === 'needs_work'} onClick={() => setStatus.mutate('needs_work')}><RotateCcw size={14} />보완 요청</Button>
              <Button loading={setStatus.isPending && setStatus.variables === 'approved'} onClick={() => setStatus.mutate('approved')}><CheckCircle2 size={15} />승인</Button>
            </>}
            {sub.closed_at
              ? <Button variant="ghost" onClick={() => close.mutate({ id: sub.id, close: false, uid }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['sub', id] }) })}><Undo2 size={14} />다시 열기</Button>
              : sub.status !== 'approved' && <Button variant="ghost" title="승인 없이 목록에서 정리합니다 (스페이스에는 남습니다)" onClick={() => close.mutate({ id: sub.id, close: true, uid }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['sub', id] }) })}><Check size={14} />정리</Button>}
          </div>
        )}
      </div>

      {canUpload && !sub.closed_at && sub.request_type !== 'share' && sub.status === 'needs_work' && (
        <div className="mt-4 rounded-2xl bg-amber-50 ring-1 ring-amber-200 px-4 py-3 text-sm flex items-start gap-2.5">
          <RotateCcw size={16} className="text-amber-700 mt-0.5 shrink-0" />
          <span className="text-amber-900"><b>팀장님이 보완을 요청했어요.</b> 대화를 확인하고, 고친 파일을 아래 대화창에 끌어다 놓으면 새 버전(v{latest.version + 1})으로 올라갑니다. 이전 버전과 대화는 그대로 남습니다.</span>
        </div>
      )}
      {isAuthor && sub.status === 'approved' && (
        <div className="mt-4 rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 text-sm text-emerald-900 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" />승인됐어요. 수고했어요 — 성과 기록으로 남습니다.</div>
      )}

      <div className="mt-5 grid lg:grid-cols-5 gap-5 items-start">
        {/* 대화 */}
        <div className={cx(showAi ? 'lg:col-span-3' : 'lg:col-span-5', 'rounded-2xl bg-white ring-1 ring-slate-900/[0.07] shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col h-[calc(100vh-15rem)] min-h-[520px] relative', drag && 'ring-2 ring-indigo-500')}
          onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) setDrag(true); }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag(false); }}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}>
          {drag && (
            <div className="absolute inset-0 z-10 rounded-2xl bg-indigo-50/90 flex flex-col items-center justify-center text-indigo-700 pointer-events-none">
              <FileUp size={24} /><div className="mt-1.5 font-semibold">{canUpload ? `놓으면 새 버전(v${latest.version + 1})으로 올릴 준비가 됩니다` : '놓으면 대화에 첨부됩니다'}</div>
            </div>
          )}
          {/* 이 화면의 왼쪽 = 업무 스페이스에서 이 카드를 눌렀을 때 열리던 스레드를 크게 본 것 */}
          <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center gap-2 rounded-t-2xl bg-white">
            <MessageSquare size={15} className="text-indigo-600 shrink-0" /><span className="font-semibold text-sm">스레드</span>
            <span className="text-xs text-slate-400 truncate">이 업무 카드의 버전과 대화</span>
            <span className="ml-auto shrink-0 text-[11px] text-slate-500">버전 {versions.length} · 대화 {all.length}</span>
          </div>
          <div ref={scroller} className="flex-1 overflow-y-auto px-4 sm:px-5 py-4 space-y-4 bg-slate-50/60">
            {stream.map((it) => it.t === 'v' ? (
              <VersionCard key={it.v.id} sub={sub} v={it.v} latest={it.v.id === latest.id}
                ai={showAi ? { has: !!aiOf(it.v.id), on: aiVer === it.v.id, open: () => setAiVer(it.v.id) } : undefined} />
            ) : (
              <Bubble key={it.c.id} c={it.c} mine={it.c.author_id === uid} />
            ))}
          </div>
          <Composer sub={sub} latest={latest} canUpload={canUpload} file={file} setFile={setFile} />
        </div>

        {/* 오른쪽: AI 1차 검토 (팀장, 컨펌·의견 요청만) */}
        {showAi && (
          <aside className="lg:col-span-2 lg:sticky lg:top-4 space-y-3">
            <AiReview teamId={sub.team_id} version={versions.find((v) => v.id === aiVer) ?? latest} versions={versions} reviewOf={aiOf} onPick={setAiVer} onToComments={(qs) => toComments.mutate(qs)} />
          </aside>
        )}
      </div>
    </section>
  );
}

/** 대화 흐름 속 버전 카드 — 누가 몇 번째 버전을 올렸고 무엇이 바뀌었는지 + 파일·본문 (이전 버전은 흐리게·접힘) */
function VersionCard({ sub, v, latest, ai }: { sub: Submission; v: SubmissionVersion; latest: boolean; ai?: { has: boolean; on: boolean; open: () => void } }) {
  const { nameOf } = useTeam();
  return (
    <article className={cx('rounded-2xl bg-white overflow-hidden ring-1', latest ? 'ring-indigo-200 shadow-[0_2px_8px_rgba(79,70,229,0.08)]' : 'ring-slate-200')}>
      <div className={cx('px-4 py-3 flex items-center gap-3 border-b', latest ? 'bg-indigo-50/70 border-indigo-100' : 'bg-slate-50 border-slate-100')}>
        <span className={cx('w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0 text-white', latest ? 'bg-indigo-600' : 'bg-slate-400')}>
          <FileUp size={15} /><span className="text-[10px] font-bold font-mono leading-none mt-0.5">v{v.version}</span>
        </span>
        <div className="min-w-0">
          <div className="text-sm text-slate-800"><b>{nameOf(v.created_by)}</b> 님이 {v.version === 1 ? '처음 올렸습니다' : <><b className="text-indigo-700">새 버전 v{v.version}</b>을 올렸습니다</>}</div>
          <div className="text-xs text-slate-500">{fmtDate(v.created_at)}{latest ? <span className="ml-1.5 text-[10px] font-semibold text-white bg-indigo-600 rounded px-1.5 py-0.5">최신</span> : <span className="ml-1.5 text-[10px] text-slate-400">이전 버전</span>}</div>
        </div>
        {ai && <button onClick={ai.open} className={cx('ml-auto shrink-0 text-[11px] font-semibold rounded-full px-2.5 py-1 inline-flex items-center gap-1 ring-1',
          ai.on ? 'bg-violet-600 text-white ring-violet-600' : ai.has ? 'bg-white text-violet-700 ring-violet-200 hover:bg-violet-50' : 'bg-white text-slate-400 ring-slate-200 hover:text-slate-600')}><Sparkles size={11} />{ai.has ? 'AI 검토' : 'AI 검토 전'}</button>}
      </div>
      <div className="px-4 pb-4">
        {v.note && <p className="mt-3 text-sm text-slate-700"><span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded px-1.5 py-0.5 mr-1.5">{v.version === 1 ? '메모' : '바뀐 점'}</span>{v.note}</p>}
        <VersionBody sub={sub} v={v} older={!latest} />
      </div>
    </article>
  );
}

function Attachment({ c, mine }: { c: ReviewComment; mine?: boolean }) {
  const url = useSignedUrl(c.file_path ?? null);
  if (!c.file_path) return null;
  const img = !!c.mime_type && IMAGE.test(c.mime_type);
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className={cx('mt-1 inline-flex flex-col rounded-xl ring-1 bg-white text-sm overflow-hidden max-w-full', mine ? 'ring-indigo-200' : 'ring-slate-200')}>
      {img && url && <img src={url} alt={c.file_name ?? ''} className="max-h-56 object-contain bg-slate-50" />}
      <span className="inline-flex items-center gap-2 px-3 py-2"><Paperclip size={14} className="text-indigo-600 shrink-0" /><span className="truncate">{c.file_name}</span><ExternalLink size={12} className="text-slate-400 shrink-0" /></span>
    </a>
  );
}

/** 말풍선 — 내 말은 오른쪽 */
export function Bubble({ c, mine }: { c: ReviewComment; mine: boolean }) {
  const { nameOf } = useTeam();
  return (
    <div className={cx('flex gap-2.5 group', mine && 'flex-row-reverse')}>
      <Avatar name={nameOf(c.author_id)} size={8} tone={mine ? 'indigo' : 'slate'} />
      <div className={cx('max-w-[80%] min-w-0 flex flex-col', mine ? 'items-end' : 'items-start')}>
        <div className="text-[11px] text-slate-400 mb-0.5"><b className="text-slate-600 font-semibold">{nameOf(c.author_id)}</b> · {fmtDate(c.created_at)}
          {c.section_ref && <span className="ml-1.5 text-[10px] text-indigo-700 border border-indigo-200 rounded px-1">{c.section_ref}</span>}</div>
        {!!c.body && <div className={cx('rounded-2xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words', mine ? 'bg-indigo-600 text-white rounded-tr-sm' : 'bg-white ring-1 ring-slate-200 rounded-tl-sm text-slate-800')}>{c.body}</div>}
        <Attachment c={c} mine={mine} />
      </div>
    </div>
  );
}

/** 대화창 — Enter 보내기 · 파일은 끌어다 놓기/📎/붙여넣기. 올린 사람(그룹 멤버)이 파일을 보내면 새 버전 */
export function Composer({ sub, latest, canUpload, file, setFile }: { sub: Submission; latest: SubmissionVersion; canUpload: boolean; file: File | null; setFile: (f: File | null) => void }) {
  const { uid, team, hasFeature } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [asVersion, setAsVersion] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const nextV = latest.version + 1;
  const newVersion = !!file && canUpload && asVersion;
  const send = useMutation({
    mutationFn: async () => {
      const text = body.trim();
      if (newVersion) {
        const ver = await addVersion({ teamId: team.id, uid, sub, version: nextV, file, note: text });
        return { kind: 'version' as const, ver };
      }
      const att = file ? await uploadAttachment(team.id, sub.id, file) : {};
      await q(supabase.from('review_comments').insert({ submission_id: sub.id, version_id: latest.id, team_id: team.id, author_id: uid, body: text, ...att }));
      return { kind: 'comment' as const };
    },
    onSuccess: (r) => {
      setBody(''); setFile(null); setAsVersion(true);
      qc.invalidateQueries({ queryKey: ['comments', sub.id] });
      if (r.kind === 'version') {
        toast(`v${r.ver.version}을 올렸습니다`);
        ['sub', 'review-queue', 'items'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        startReview(sub, r.ver.id, hasFeature('ai_core'), () => qc.invalidateQueries({ queryKey: ['ai'] }));
      }
      // 업무 스페이스 흐름은 '바뀐 것만' 받고, 다른 목록만 새로
      qc.invalidateQueries({ queryKey: ['space-delta'] });
      qc.invalidateQueries({ queryKey: ['subs'], predicate: (x) => x.queryKey[2] !== 'space' });
    },
    onError: (e) => toast(errorText(e).includes('file_path') ? '대화 첨부는 18_work_groups.sql 실행 후 쓸 수 있습니다.' : errorText(e)),
  });
  const ready = !!file || !!body.trim();
  return (
    <div className="p-3 border-t border-slate-100">
      <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2 text-sm flex-wrap">
          <Paperclip size={14} className="text-indigo-600 shrink-0" /><span className="truncate font-medium min-w-0 flex-1">{file.name}</span>
          {canUpload && (
            <span className="flex gap-1 text-xs">
              <button onClick={() => setAsVersion(true)} className={cx('rounded-full border px-2 py-0.5', asVersion ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-500')}>새 버전 v{nextV}으로</button>
              <button onClick={() => setAsVersion(false)} className={cx('rounded-full border px-2 py-0.5', !asVersion ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-500')}>첨부만</button>
            </span>
          )}
          <button onClick={() => setFile(null)} className="text-slate-400 hover:text-slate-700" aria-label="파일 빼기"><X size={15} /></button>
        </div>
      )}
      <div className="rounded-xl ring-1 ring-slate-200 bg-white focus-within:ring-indigo-400">
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} aria-label="메시지"
          onPaste={(e) => { const f = e.clipboardData.files?.[0]; if (f) { e.preventDefault(); setFile(namedPaste(f)); } }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (ready && !send.isPending) send.mutate(); } }}
          className="w-full resize-none text-sm px-3.5 pt-2.5 leading-6 focus:outline-none placeholder:text-slate-400 rounded-t-xl"
          placeholder={newVersion ? '이번에 바꾼 점 (선택) — Enter로 올리기' : '메시지 — Enter 보내기 · Shift+Enter 줄바꿈'} />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button onClick={() => fileRef.current?.click()} className="p-1.5 rounded text-slate-500 hover:bg-slate-100" title="파일 첨부" aria-label="파일 첨부"><Paperclip size={16} /></button>
          <span className="text-[11px] text-slate-400 ml-1 truncate">{canUpload ? `파일을 끌어다 놓거나 캡처를 붙여 넣으면 새 버전(v${nextV})으로 올라갑니다` : '파일을 끌어다 놓거나 캡처를 붙여 넣으면 첨부됩니다'}</span>
          <Button size="sm" className="ml-auto shrink-0" disabled={!ready} loading={send.isPending} onClick={() => send.mutate()}>{newVersion ? <><FileUp size={13} />v{nextV} 올리기</> : <><Send size={13} />보내기</>}</Button>
        </div>
      </div>
    </div>
  );
}
