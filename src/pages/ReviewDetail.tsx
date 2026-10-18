// 업무 상세 — 버전 탭 대신 스크롤 피드: 올린 것(v1, v2…) 사이사이에 댓글, 누르면 오른쪽에 스레드
//   팀원은 맨 아래에서 바로 새 버전을 올리고(액자식), 모두 댓글로 주고받는다. 팀장은 오른쪽에서 AI 1차 검토를 본다.
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, CheckCircle2, ChevronDown, ExternalLink, FileUp, Lock, MessageSquare, Paperclip, RotateCcw, Send, Sparkles, Undo2, Unlock, X, XCircle } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi } from '../lib/hooks';
import type { ReviewComment, Submission, SubmissionVersion } from '../lib/types';
import { cx, fmtDate, fmtShort } from '../lib/format';
import { safeName } from '../lib/extract';
import { KIND_TAG, REQ_TAG, useCloseSubmission } from '../lib/work';
import { Avatar, Button, Empty, Pill, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../components/Prov';
import { FILE_ACCEPT, IMAGE, readFile } from '../components/Upload';
import { STATUS } from './MySubmissions';

interface Review {
  depth_score: number; summary: string; decisions?: string[];
  brief?: { tone: 'risk' | 'watch' | 'good'; text: string; why?: string };
  strengths: { section: string; text: string }[]; gaps: { section: string; text: string }[];
  questions: string[]; change_from_previous?: string; trend_note?: string;
  criteria_check?: { criterion: string; met: boolean; note: string; tag?: string }[];
}
type Panel = { kind: 'ai'; versionId: string } | { kind: 'thread'; commentId: string } | null;

const DOT: Record<string, string> = { risk: 'bg-rose-500', watch: 'bg-amber-400', good: 'bg-emerald-500' };
/** 한 줄 판단에서 '~해 보입니다' 부분만 (버전 흐름용) */
const shortOf = (r?: Review) => {
  if (!r) return null;
  const t = r.brief?.text ?? '';
  const tail = t.includes("'") ? t.slice(t.lastIndexOf("'") + 1).replace(/^\s*(은|는|이|가|에|에는)\s+/, '') : t;
  return tail || r.summary?.split(/[.。]/)[0] || '검토됨';
};

function AiReview({ teamId, version, versions, reviewOf, onPick, onToComments }: {
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
    queryFn: async () => (await supabase.from('knowhow_cards').select('id', { count: 'exact', head: true }).eq('team_id', teamId).eq('active', true).contains('applies_to', ['review'])).count ?? 0,
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
          팀원이 올릴 때 자동으로 시작되지만, 이번 달 기본 AI 사용량을 다 썼거나 오류가 났다면 여기서 다시 요청할 수 있습니다.
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
            <Button variant="soft" className="mt-3 w-full" onClick={() => onToComments(r.content.questions)}>질문을 댓글로 남기기</Button>
          )}
        </>
      )}
    </ProvBlock>
  );
}


function useSignedUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { setUrl(null); if (path) supabase.storage.from('submissions').createSignedUrl(path, 600).then(({ data }) => setUrl(data?.signedUrl ?? null)); }, [path]);
  return url;
}

/** 올린 것 한 건(버전)의 본문 — 길면 접어 둔다 */
function VersionBody({ sub, v, older }: { sub: Submission; v: SubmissionVersion; older?: boolean }) {
  const url = useSignedUrl(v.file_path);
  const [open, setOpen] = useState(false);
  const long = (v.extracted_text ?? '').length > (older ? 160 : 600);
  return (
    <div className="mt-3">
      {url && v.file_name && <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm rounded-lg ring-1 ring-slate-200 px-2.5 py-1.5 hover:bg-slate-50"><Paperclip size={13} className="text-slate-400" />{v.file_name}<ExternalLink size={12} className="text-slate-400" /></a>}
      {v.mime_type === 'application/pdf' && url && <iframe title="PDF" src={url} className="mt-3 w-full h-[520px] rounded-lg border border-slate-200" />}
      {url && v.mime_type && IMAGE.test(v.mime_type) && <img src={url} alt={sub.title} className="mt-3 max-h-[480px] rounded-lg border border-slate-200" />}
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

export default function ReviewDetail() {
  const { id } = useParams();
  const { isLeader, nameOf, uid, team } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const subQ = useQuery({ queryKey: ['sub', id], queryFn: () => q<Submission>(supabase.from('submissions').select('*').eq('id', id!).single()) });
  const versQ = useQuery({ queryKey: ['sub', id, 'versions'], queryFn: () => q<SubmissionVersion[]>(supabase.from('submission_versions').select('*').eq('submission_id', id!).order('version')) });
  const comQ = useQuery({ queryKey: ['comments', id], queryFn: () => q<ReviewComment[]>(supabase.from('review_comments').select('*').eq('submission_id', id!).order('created_at')) });
  const versions = versQ.data ?? [];
  const vIds = versions.map((v) => v.id);
  const aiQ = useQuery({
    queryKey: ['ai', team.id, 'review', 'by-sub', id, vIds.length], enabled: isLeader && vIds.length > 0,
    queryFn: () => q<{ ref_id: string; content: Review }[]>(supabase.from('ai_outputs').select('ref_id, content').eq('team_id', team.id).eq('kind', 'review').eq('ref_table', 'submission_versions').in('ref_id', vIds).order('created_at', { ascending: false })),
  });
  const aiOf = (vid: string) => aiQ.data?.find((a) => a.ref_id === vid)?.content;
  const latest = versions[versions.length - 1];
  const [panel, setPanel] = useState<Panel>(null);
  const [target, setTarget] = useState<string | null>(null);
  const composer = useRef<HTMLDivElement>(null);
  const close = useCloseSubmission(team.id);
  const setStatus = useMutation({
    mutationFn: (status: 'approved' | 'needs_work') => q(supabase.from('submissions').update({ status }).eq('id', id!)),
    onSuccess: (_d, s) => { toast(s === 'approved' ? '승인했습니다. 근거로 쌓입니다.' : '보완을 요청했습니다.'); qc.invalidateQueries({ queryKey: ['sub', id] }); qc.invalidateQueries({ queryKey: ['subs'] }); qc.invalidateQueries({ queryKey: ['review-queue'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const toComments = useMutation({
    mutationFn: (qs: string[]) => q(supabase.from('review_comments').insert(qs.map((body) => ({ submission_id: id, version_id: latest!.id, team_id: team.id, author_id: uid, body })))),
    onSuccess: () => { toast('질문을 댓글로 옮겼습니다'); qc.invalidateQueries({ queryKey: ['comments', id] }); },
    onError: (e) => toast(errorText(e)),
  });
  useEffect(() => { setPanel(null); setTarget(null); }, [id]);

  if (subQ.isLoading || versQ.isLoading) return <Spinner />;
  const sub = subQ.data;
  if (!sub || !latest) return <Empty title="업무를 찾을 수 없습니다" />;
  const isAuthor = sub.author_id === uid;
  const all = comQ.data ?? [];
  const roots = all.filter((c) => !c.parent_id);
  const rootsOf = (v: SubmissionVersion) => roots.filter((c) => (c.version_id ?? latest.id) === v.id);
  const cur: Panel = panel ?? (isLeader && !isAuthor ? { kind: 'ai', versionId: latest.id } : null);
  const rq = REQ_TAG[sub.request_type] ?? REQ_TAG.approval;

  return (
    <section>
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link to={isLeader ? (isAuthor ? '/work' : `/work/u/${sub.author_id}`) : '/my/submissions'} className="text-sm text-slate-500 hover:text-indigo-700">← {isLeader && !isAuthor ? `${nameOf(sub.author_id)} 업무 스페이스` : '목록으로'}</Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight flex items-center gap-2 flex-wrap">
            <span className={cx('text-[11px] font-bold rounded px-1.5 py-0.5', rq.cls)}>{rq.label}</span>{sub.title}</h1>
          <p className="mt-1 text-sm text-slate-500 flex items-center gap-2 flex-wrap">{nameOf(sub.author_id)} · 처음 올림 {fmtDate(sub.created_at)} · {KIND_TAG[sub.kind] ?? '문서'} · 버전 {versions.length}개
            {sub.closed_at ? <span className="text-[11px] font-semibold rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">완료함</span> : <Pill tone={STATUS[sub.status].tone}>{STATUS[sub.status].label}</Pill>}</p>
        </div>
        {isLeader && !isAuthor && (
          <div className="flex items-center gap-2 flex-wrap">
            {sub.request_type !== 'share' && <>
              <Button variant="secondary" loading={setStatus.isPending && setStatus.variables === 'needs_work'} onClick={() => setStatus.mutate('needs_work')}><RotateCcw size={14} />보완 요청</Button>
              <Button loading={setStatus.isPending && setStatus.variables === 'approved'} onClick={() => setStatus.mutate('approved')}><CheckCircle2 size={15} />이대로 좋음</Button>
            </>}
            {sub.closed_at
              ? <Button variant="ghost" onClick={() => close.mutate({ id: sub.id, close: false, uid }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['sub', id] }) })}><Undo2 size={14} />다시 열기</Button>
              : <Button variant="secondary" onClick={() => close.mutate({ id: sub.id, close: true, uid }, { onSuccess: () => qc.invalidateQueries({ queryKey: ['sub', id] }) })}><Check size={14} />완료</Button>}
          </div>
        )}
      </div>

      {isAuthor && !sub.closed_at && sub.request_type !== 'share' && (() => {
        const fbs = all.filter((c) => c.author_id !== uid && !c.parent_id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 2);
        const toComposer = () => composer.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (sub.status === 'needs_work') return (
          <div className="mt-4 rounded-2xl bg-amber-50 ring-1 ring-amber-200 p-4 flex items-start gap-3">
            <RotateCcw size={18} className="text-amber-700 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-amber-900">팀장님이 보완을 요청했어요</div>
              {fbs.length ? <ul className="mt-1 space-y-0.5 text-sm text-slate-700">{fbs.map((c) => <li key={c.id} className="truncate">· {c.section_ref ? <b className="font-semibold">{c.section_ref} </b> : null}{c.body}</li>)}</ul>
                : <p className="mt-1 text-sm text-slate-600">아래 댓글을 확인하고 고친 자료를 새 버전으로 올려 주세요.</p>}
              <p className="mt-1 text-xs text-amber-800">고친 자료를 새 버전으로 올리면 다시 리뷰 중으로 바뀌고, 이전 버전과 대화는 그대로 남습니다.</p>
            </div>
            <Button size="sm" onClick={toComposer}><FileUp size={14} />고쳐서 새 버전 올리기</Button>
          </div>
        );
        if (sub.status === 'approved') return (
          <div className="mt-4 rounded-2xl bg-emerald-50 ring-1 ring-emerald-200 px-4 py-3 text-sm text-emerald-900 flex items-center gap-2"><CheckCircle2 size={16} className="text-emerald-600" />승인됐어요. 수고했어요 — 내 기록에 남습니다.</div>
        );
        return (
          <div className="mt-4 rounded-2xl bg-slate-50 ring-1 ring-slate-200 px-4 py-3 text-sm text-slate-600 flex items-center gap-2"><MessageSquare size={15} className="text-indigo-600" />팀장님 리뷰를 기다리는 중이에요. 피드백이 오면 알림과 함께 여기에 보입니다.</div>
        );
      })()}
      <div className="mt-5 grid lg:grid-cols-5 gap-5 items-start">
        {/* 피드 */}
        <div className="lg:col-span-3">
          <ol className="relative space-y-4 before:absolute before:left-[19px] before:top-4 before:bottom-4 before:w-px before:bg-slate-200">
            {versions.map((v) => {
              const r = isLeader ? aiOf(v.id) : undefined;
              const cs = rootsOf(v);
              return (
                <li key={v.id} className="relative pl-12">
                  <span className="absolute left-0 top-3"><Avatar name={nameOf(v.created_by)} size={9} /></span>
                  <article className="rounded-2xl bg-white ring-1 ring-slate-900/[0.07] shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                    <div className="px-5 pt-4">
                      <div className="flex items-center gap-2 text-sm flex-wrap">
                        <b>{nameOf(v.created_by)}</b>
                        <span className="font-mono text-[11px] font-semibold rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5">v{v.version}</span>
                        <span className="text-slate-400 text-xs">{v.version === 1 ? '올림' : '새 버전'} · {fmtDate(v.created_at)}</span>
                        {v.id === latest.id && versions.length > 1 && <span className="text-[10px] font-semibold text-indigo-700">최신</span>}
                        {isLeader && !isAuthor && sub.request_type !== 'share' && sub.kind !== 'number' && (
                          <button onClick={() => setPanel({ kind: 'ai', versionId: v.id })} className={cx('ml-auto text-[11px] font-semibold rounded-full px-2 py-0.5 inline-flex items-center gap-1 ring-1',
                            cur?.kind === 'ai' && cur.versionId === v.id ? 'bg-violet-600 text-white ring-violet-600' : r ? 'bg-violet-50 text-violet-700 ring-violet-200 hover:bg-violet-100' : 'bg-white text-slate-400 ring-slate-200 hover:text-slate-600')}>
                            <Sparkles size={11} />{r ? 'AI 검토' : 'AI 검토 전'}</button>
                        )}
                      </div>
                      {v.note && <p className="mt-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{v.note}</p>}
                      <VersionBody sub={sub} v={v} older={v.id !== latest.id} />
                    </div>
                    {/* 이 버전에 달린 댓글 */}
                    <div className="mt-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
                      {cs.map((c) => {
                        const reps = all.filter((x) => x.parent_id === c.id);
                        const on = cur?.kind === 'thread' && cur.commentId === c.id;
                        return (
                          <button key={c.id} onClick={() => setPanel({ kind: 'thread', commentId: c.id })}
                            className={cx('w-full text-left px-5 py-2.5 flex gap-2.5 border-b border-slate-100 last:border-b-0 hover:bg-white', on && 'bg-white ring-1 ring-inset ring-violet-300')}>
                            <Avatar name={nameOf(c.author_id)} tone={c.author_id === sub.author_id ? 'slate' : 'indigo'} size={7} />
                            <span className="min-w-0 flex-1">
                              <span className="text-xs"><b>{nameOf(c.author_id)}</b> <span className="text-slate-400">{fmtShort(c.created_at)}</span>
                                {c.section_ref && <span className="ml-1.5 text-[10px] text-indigo-700 border border-indigo-200 rounded px-1">{c.section_ref}</span>}</span>
                              <span className="block text-sm text-slate-700 line-clamp-2 whitespace-pre-wrap">{c.body}</span>
                              {!!reps.length && <span className="mt-0.5 text-[11px] font-semibold text-indigo-700 inline-flex items-center gap-1"><MessageSquare size={11} />답글 {reps.length} · {nameOf(reps[reps.length - 1].author_id)}</span>}
                            </span>
                          </button>
                        );
                      })}
                      <button onClick={() => { setTarget(v.id); composer.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}
                        className="w-full text-left px-5 py-2.5 text-xs text-slate-400 hover:text-indigo-700 inline-flex items-center gap-1"><MessageSquare size={12} />v{v.version}에 댓글 달기</button>
                    </div>
                  </article>
                </li>
              );
            })}
            {/* 맨 아래: 댓글 / 새 버전 올리기 */}
            <li className="relative pl-12" ref={composer as never}>
              <span className="absolute left-0 top-3"><Avatar name={nameOf(uid)} tone="indigo" size={9} /></span>
              <Composer sub={sub} versions={versions} target={target ?? latest.id} setTarget={setTarget} canUpload={isAuthor} />
            </li>
          </ol>
        </div>

        {/* 오른쪽: 스레드 / AI 1차 검토 */}
        <aside className="lg:col-span-2 lg:sticky lg:top-4 space-y-4">
          {cur?.kind === 'thread' ? <Thread sub={sub} versions={versions} comments={all} rootId={cur.commentId} onClose={() => setPanel(null)} />
            : cur?.kind === 'ai' ? <AiReview teamId={sub.team_id} version={versions.find((v) => v.id === cur.versionId) ?? latest} versions={versions} reviewOf={aiOf} onPick={(vid) => setPanel({ kind: 'ai', versionId: vid })} onToComments={(qs) => toComments.mutate(qs)} />
            : (
              <div className="rounded-2xl bg-white ring-1 ring-slate-900/[0.07] p-5 text-sm text-slate-500">
                <div className="font-semibold text-slate-800 flex items-center gap-2"><MessageSquare size={15} className="text-indigo-600" />대화 보기</div>
                <p className="mt-1.5">왼쪽 댓글을 누르면 여기에 그 대화가 열리고 바로 답글을 달 수 있습니다.{isAuthor && ' 고친 자료는 맨 아래에서 바로 새 버전으로 올리세요 — 이전 버전과 대화가 위에 그대로 남습니다.'}</p>
              </div>
            )}
        </aside>
      </div>
    </section>
  );
}

/** 맨 아래 입력: 댓글, 또는(올린 사람이면) 새 버전 바로 올리기 */
function Composer({ sub, versions, target, setTarget, canUpload }: { sub: Submission; versions: SubmissionVersion[]; target: string; setTarget: (v: string) => void; canUpload: boolean }) {
  const { uid, team, hasFeature } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<'comment' | 'version'>('comment');
  const [body, setBody] = useState('');
  const [section, setSection] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const tv = versions.find((v) => v.id === target) ?? versions[versions.length - 1];
  const add = useMutation({
    mutationFn: () => q(supabase.from('review_comments').insert({ submission_id: sub.id, version_id: tv.id, team_id: team.id, author_id: uid, body, section_ref: section || null })),
    onSuccess: () => { setBody(''); setSection(''); qc.invalidateQueries({ queryKey: ['comments', sub.id] }); qc.invalidateQueries({ queryKey: ['talk'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const up = useMutation({
    mutationFn: async () => {
      if (!file && !text.trim()) throw new Error('파일을 첨부하거나 내용을 써 주세요');
      let read = { text, mime: 'text/plain' };
      if (file) read = await readFile(file);
      const version = Math.max(0, ...versions.map((v) => v.version)) + 1;
      let path: string | null = null;
      if (file) {
        path = `${team.id}/${sub.id}/${version}-${safeName(file.name)}`;
        const { error } = await supabase.storage.from('submissions').upload(path, file, { contentType: read.mime || file.type, upsert: false });
        if (error) throw error;
      }
      return q<SubmissionVersion>(supabase.from('submission_versions').insert({
        submission_id: sub.id, team_id: team.id, version, file_path: path, file_name: file?.name ?? null,
        mime_type: file ? read.mime : 'text/plain', extracted_text: read.text || text, note, created_by: uid,
      }).select().single());
    },
    onSuccess: (ver) => {
      const reviewable = sub.request_type !== 'share' && sub.kind !== 'number' && sub.kind !== 'note' && hasFeature('ai_core');
      toast(`v${ver.version}을 올렸습니다.${reviewable ? ' AI가 1차 검토를 시작합니다.' : ''}`);
      setFile(null); setNote(''); setText(''); setMode('comment');
      ['subs', 'sub', 'review-queue', 'items'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (reviewable) invoke('ai-review-submission', { version_id: ver.id }).then(() => qc.invalidateQueries({ queryKey: ['ai'] })).catch(() => {});
    },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <div className="rounded-2xl bg-white ring-1 ring-indigo-200 shadow-sm">
      {canUpload && (
        <div className="px-4 pt-3 flex gap-1 text-xs">
          {([['comment', '댓글', MessageSquare], ['version', '새 버전 올리기', FileUp]] as const).map(([k, l, I]) => (
            <button key={k} onClick={() => setMode(k)} className={cx('px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1', mode === k ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-500 hover:bg-slate-50')}><I size={13} />{l}</button>
          ))}
        </div>
      )}
      {mode === 'comment' ? (
        <form className="p-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
          <textarea aria-label="댓글" rows={2} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="댓글을 남기세요 — 질문, 의견, 확인 부탁" />
          <div className="flex items-center gap-2">
            <select aria-label="버전" value={tv.id} onChange={(e) => setTarget(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
              {versions.map((v) => <option key={v.id} value={v.id}>v{v.version}에 남기기</option>)}
            </select>
            <input aria-label="섹션" className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-28" value={section} onChange={(e) => setSection(e.target.value)} placeholder="섹션 (선택)" />
            <Button type="submit" size="sm" className="ml-auto" loading={add.isPending}><Send size={13} />보내기</Button>
          </div>
        </form>
      ) : (
        <form className="p-4 space-y-2.5" onSubmit={(e) => { e.preventDefault(); up.mutate(); }}>
          <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}
            className="w-full rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 px-4 py-4 text-sm text-slate-500 text-center">
            {file ? <span className="inline-flex items-center gap-1.5 text-slate-800 font-medium"><Paperclip size={14} />{file.name} <span className="text-xs text-slate-400">(바꾸려면 누르기)</span></span>
              : <span className="inline-flex items-center gap-1.5"><FileUp size={15} />파일을 끌어 놓거나 눌러서 첨부 · 문서·PDF·PPT·캡처</span>}
          </button>
          <textarea rows={2} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="또는 본문을 바로 쓰기" />
          <div className="flex items-center gap-2">
            <input className={cx(inputCls, 'flex-1')} value={note} onChange={(e) => setNote(e.target.value)} placeholder="이번에 바꾼 점 (예: 피드백 반영해 §2 수정)" />
            <Button type="submit" loading={up.isPending}><FileUp size={14} />v{Math.max(0, ...versions.map((v) => v.version)) + 1} 올리기</Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** 오른쪽 스레드: 댓글 하나와 답글 */
function Thread({ sub, versions, comments, rootId, onClose }: { sub: Submission; versions: SubmissionVersion[]; comments: ReviewComment[]; rootId: string; onClose: () => void }) {
  const { uid, team, nameOf } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const root = comments.find((c) => c.id === rootId);
  const reps = comments.filter((c) => c.parent_id === rootId);
  const add = useMutation({
    mutationFn: () => q(supabase.from('review_comments').insert({ submission_id: sub.id, version_id: root?.version_id ?? null, team_id: team.id, author_id: uid, body, parent_id: rootId })),
    onSuccess: () => { setBody(''); qc.invalidateQueries({ queryKey: ['comments', sub.id] }); },
    onError: (e) => toast(errorText(e)),
  });
  if (!root) return null;
  const vnum = versions.find((v) => v.id === root.version_id)?.version;
  const Msg = ({ c }: { c: ReviewComment }) => (
    <div className="flex gap-2.5">
      <Avatar name={nameOf(c.author_id)} tone={c.author_id === sub.author_id ? 'slate' : 'indigo'} size={8} />
      <div className="min-w-0 flex-1">
        <div className="text-xs"><b className="text-sm">{nameOf(c.author_id)}</b> <span className="text-slate-400 ml-1">{fmtDate(c.created_at)}</span></div>
        {c.section_ref && <span className="inline-block mt-0.5 text-[10px] text-indigo-700 border border-indigo-200 rounded px-1">{c.section_ref}</span>}
        <p className="mt-1 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">{c.body}</p>
      </div>
    </div>
  );
  return (
    <section className="rounded-2xl bg-white ring-1 ring-violet-200 shadow-sm flex flex-col max-h-[calc(100vh-6rem)]">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2"><MessageSquare size={15} className="text-violet-600" /><span className="font-semibold text-sm">대화</span>
        {vnum && <span className="font-mono text-[10px] rounded bg-indigo-50 text-indigo-700 px-1.5 py-0.5">v{vnum}</span>}
        <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={16} /></button></div>
      <div className="p-4 space-y-4 overflow-y-auto">
        <Msg c={root} />
        {reps.length > 0 && <div className="pl-5 border-l-2 border-slate-100 space-y-4">{reps.map((r) => <Msg key={r.id} c={r} />)}</div>}
      </div>
      <form className="p-3 border-t border-slate-100 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate(); }}>
        <textarea rows={2} autoFocus className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="답글" />
        <Button type="submit" className="self-end" loading={add.isPending}><Send size={14} /></Button>
      </form>
    </section>
  );
}
