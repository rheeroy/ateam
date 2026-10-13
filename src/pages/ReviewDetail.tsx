import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, ExternalLink, FileUp, Lock, RotateCcw, Send, Sparkles, Unlock, XCircle } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi } from '../lib/hooks';
import type { ReviewComment, Submission, SubmissionVersion } from '../lib/types';
import { cx, fmtDate, fmtShort, num } from '../lib/format';
import { Avatar, Button, Card, Empty, PageHeader, Pill, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../components/Prov';
import { UploadModal } from '../components/Upload';
import { STATUS } from './MySubmissions';

interface Review {
  depth_score: number; summary: string;
  strengths: { section: string; text: string }[]; gaps: { section: string; text: string }[];
  questions: string[]; change_from_previous?: string; trend_note?: string;
  criteria_check?: { criterion: string; met: boolean; note: string; tag?: string }[];
}

function AiReview({ teamId, version, onToComments }: { teamId: string; version: SubmissionVersion; onToComments: (qs: string[]) => void }) {
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
        <div className="flex items-center gap-2 font-semibold">1차 검토
          {r && <ProvChip kind={kindFromStatus(r.status)} label="AI 생성" sources={r.sources} level={r.level} depth={r.depth}
            note="점수는 참고용 눈금입니다. 판단은 팀장님 코멘트로 남습니다." />}
        </div>
        <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Lock size={11} />팀장에게만 보임</span>
      </div>
      {rv.isLoading ? <Spinner /> : !r ? (
        <Empty icon={<Sparkles size={18} />} title="아직 1차 검토가 없습니다"
          action={<Button loading={gen.isPending} onClick={() => gen.mutate({ version_id: version.id })}>지금 검토하기 · 3 크레딧</Button>}>
          팀원이 올릴 때 자동으로 시작되지만, 크레딧이 부족했거나 오류가 났다면 여기서 다시 요청할 수 있습니다.
        </Empty>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3">
            <span className="text-xs text-slate-500 shrink-0">사고의 깊이</span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(r.content.depth_score / 4) * 100}%` }} /></div>
            <span className="font-mono text-sm font-semibold num">{num(r.content.depth_score)}<span className="text-slate-400">/4</span></span>
          </div>
          {r.content.summary && <p className="mt-3 text-sm text-slate-700 leading-relaxed">{r.content.summary}</p>}
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
              <div className="rounded-lg bg-emerald-50 p-3"><div className="text-xs font-semibold text-emerald-700 mb-1">고민이 담긴 부분</div>
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
            <Button variant="soft" className="mt-3 w-full" onClick={() => onToComments(r.content.questions)}>질문을 코멘트로 옮기기</Button>
          )}
        </>
      )}
    </ProvBlock>
  );
}

function Comments({ sub, versions, current }: { sub: Submission; versions: SubmissionVersion[]; current: SubmissionVersion }) {
  const { uid, nameOf, team } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [section, setSection] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['comments', sub.id],
    queryFn: () => q<ReviewComment[]>(supabase.from('review_comments').select('*').eq('submission_id', sub.id).order('created_at')),
  });
  const add = useMutation({
    mutationFn: (p: { body: string; section?: string; parent?: string | null }) => q(supabase.from('review_comments').insert({
      submission_id: sub.id, version_id: current.id, team_id: team.id, author_id: uid,
      body: p.body, section_ref: p.section || null, parent_id: p.parent ?? null,
    })),
    onSuccess: () => { setBody(''); setSection(''); setReplyTo(null); qc.invalidateQueries({ queryKey: ['comments', sub.id] }); },
    onError: (e) => toast(errorText(e)),
  });
  const roots = (list.data ?? []).filter((c) => !c.parent_id);
  const vnum = (id: string | null) => versions.find((v) => v.id === id)?.version;
  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100 font-semibold">코멘트 <span className="text-slate-400 font-normal text-sm">{list.data?.length ?? 0}</span></div>
      <div className="divide-y divide-slate-100 text-sm max-h-[560px] overflow-y-auto">
        {!roots.length && <p className="px-5 py-5 text-slate-500">첫 코멘트를 남겨 보세요. 섹션을 지정하면 어느 부분 얘기인지 분명해집니다.</p>}
        {roots.map((c) => (
          <div key={c.id}>
            <div className="px-5 py-4 flex gap-3">
              <Avatar name={nameOf(c.author_id)} tone={c.author_id === sub.author_id ? 'slate' : 'indigo'} />
              <div className="flex-1 min-w-0">
                <div><b>{nameOf(c.author_id)}</b> <span className="text-xs text-slate-400 ml-1">{fmtShort(c.created_at)} · v{vnum(c.version_id)}</span></div>
                {c.section_ref && <span className="inline-block mt-1 text-[11px] text-indigo-700 border border-indigo-200 rounded px-1.5">{c.section_ref}</span>}
                <p className="mt-1 text-slate-700 whitespace-pre-wrap">{c.body}</p>
                <button className="mt-1 text-xs text-slate-400 hover:text-indigo-600" onClick={() => setReplyTo(c.id)}>답글</button>
              </div>
            </div>
            {(list.data ?? []).filter((r) => r.parent_id === c.id).map((r) => (
              <div key={r.id} className="px-5 py-3 pl-14 bg-slate-50/60 flex gap-3">
                <Avatar name={nameOf(r.author_id)} tone={r.author_id === sub.author_id ? 'slate' : 'indigo'} size={7} />
                <div><div><b>{nameOf(r.author_id)}</b> <span className="text-xs text-slate-400 ml-1">{fmtShort(r.created_at)}</span></div><p className="mt-1 text-slate-700 whitespace-pre-wrap">{r.body}</p></div>
              </div>
            ))}
            {replyTo === c.id && (
              <form className="px-5 py-3 pl-14 bg-slate-50/60 flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = (e.currentTarget.elements.namedItem('reply') as HTMLInputElement).value; if (t.trim()) add.mutate({ body: t, parent: c.id }); }}>
                <input name="reply" autoFocus className={inputCls} placeholder="답글" />
                <Button type="submit" size="sm">보내기</Button>
              </form>
            )}
          </div>
        ))}
      </div>
      <form className="p-4 border-t border-slate-100 space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) add.mutate({ body, section }); }}>
        <div className="flex gap-2">
          <input aria-label="섹션" className={cx(inputCls, 'w-36')} value={section} onChange={(e) => setSection(e.target.value)} placeholder="섹션 (예: §2)" />
          <span className="text-xs text-slate-400 self-center">v{current.version}에 남깁니다</span>
        </div>
        <div className="flex gap-2">
          <textarea aria-label="코멘트" rows={2} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} placeholder="코멘트 남기기" />
          <Button type="submit" className="self-end" loading={add.isPending} title="보내기"><Send size={15} /></Button>
        </div>
      </form>
    </Card>
  );
}

export default function ReviewDetail() {
  const { id } = useParams();
  const { isLeader, nameOf, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [verId, setVerId] = useState<string | null>(null);
  const [upload, setUpload] = useState(false);

  const subQ = useQuery({ queryKey: ['sub', id], queryFn: () => q<Submission>(supabase.from('submissions').select('*').eq('id', id!).single()) });
  const versQ = useQuery({ queryKey: ['sub', id, 'versions'], queryFn: () => q<SubmissionVersion[]>(supabase.from('submission_versions').select('*').eq('submission_id', id!).order('version')) });
  const scores = useQuery({
    queryKey: ['sub', id, 'scores'], enabled: isLeader,
    queryFn: () => q<{ version_id: string; score: number }[]>(supabase.from('judgment_scores').select('version_id, score').eq('submission_id', id!)),
  });
  const versions = versQ.data ?? [];
  const current = useMemo(() => versions.find((v) => v.id === verId) ?? versions[versions.length - 1], [versions, verId]);
  useEffect(() => { setVerId(null); }, [id]);

  const [fileUrl, setFileUrl] = useState<string | null>(null);
  useEffect(() => {
    setFileUrl(null);
    if (current?.file_path) supabase.storage.from('submissions').createSignedUrl(current.file_path, 600).then(({ data }) => setFileUrl(data?.signedUrl ?? null));
  }, [current?.file_path]);

  const setStatus = useMutation({
    mutationFn: (status: 'approved' | 'needs_work') => q(supabase.from('submissions').update({ status }).eq('id', id!)),
    onSuccess: (_d, s) => { toast(s === 'approved' ? '승인했습니다. 근거로 쌓입니다.' : '보완을 요청했습니다.'); qc.invalidateQueries({ queryKey: ['sub', id] }); qc.invalidateQueries({ queryKey: ['subs'] }); qc.invalidateQueries({ queryKey: ['review-queue'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const toComments = useMutation({
    mutationFn: (qs: string[]) => q(supabase.from('review_comments').insert(qs.map((body) => ({ submission_id: id, version_id: current!.id, team_id: subQ.data!.team_id, author_id: uid, body })))),
    onSuccess: () => { toast('질문을 코멘트로 옮겼습니다'); qc.invalidateQueries({ queryKey: ['comments', id] }); },
    onError: (e) => toast(errorText(e)),
  });

  if (subQ.isLoading || versQ.isLoading) return <Spinner />;
  const sub = subQ.data;
  if (!sub || !current) return <Empty title="결과물을 찾을 수 없습니다" />;
  const isAuthor = sub.author_id === uid;

  return (
    <section>
      <PageHeader
        back={<Link to={isLeader ? '/work' : '/my/submissions'} className="text-sm text-slate-500 hover:text-slate-800">← 목록으로</Link>}
        title={sub.title}
        sub={<>{nameOf(sub.author_id)} · {fmtDate(current.created_at)} 제출 · <Pill tone={STATUS[sub.status].tone}>{STATUS[sub.status].label}</Pill></>}
        right={<>
          <div className="flex gap-1.5 font-mono text-xs">
            {versions.map((v) => (
              <button key={v.id} onClick={() => setVerId(v.id)}
                className={cx('border rounded-lg px-2.5 py-1.5', v.id === current.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-500 bg-white')}>
                v{v.version}{v.id === versions[versions.length - 1].id ? ' · 최신' : ''}
              </button>
            ))}
          </div>
          {isAuthor && <Button variant="secondary" onClick={() => setUpload(true)}><FileUp size={15} />새 버전</Button>}
          {isLeader && !isAuthor && <>
            <Button variant="secondary" loading={setStatus.isPending && setStatus.variables === 'needs_work'} onClick={() => setStatus.mutate('needs_work')}><RotateCcw size={14} />보완 요청</Button>
            <Button loading={setStatus.isPending && setStatus.variables === 'approved'} onClick={() => setStatus.mutate('approved')}><CheckCircle2 size={15} />이대로 좋음</Button>
          </>}
        </>}
      />

      <div className="grid lg:grid-cols-5 gap-5 items-start">
        <div className="lg:col-span-3 space-y-5">
          <Card className="p-6 md:p-8">
            <div className="flex items-start justify-between gap-3">
              <div className="text-lg font-bold">{sub.title} <span className="font-mono text-sm text-slate-400">v{current.version}</span></div>
              {fileUrl && <a href={fileUrl} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 inline-flex items-center gap-1 shrink-0">{current.file_name ?? '원본'} <ExternalLink size={13} /></a>}
            </div>
            {current.note && <p className="mt-2 text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2"><b>이번 버전</b> · {current.note}</p>}
            {current.mime_type === 'application/pdf' ? (
              fileUrl ? <iframe title="PDF" src={fileUrl} className="mt-5 w-full h-[640px] rounded-lg border border-slate-200" /> : <Spinner />
            ) : (<>
              {sub.link_url && <a href={sub.link_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm text-indigo-700 font-semibold break-all hover:underline">{sub.link_url} ↗</a>}
              {current.value != null && <div className="mt-4 text-3xl font-bold num">{current.value}</div>}
              {fileUrl && current.mime_type?.startsWith('image/') && <img src={fileUrl} alt={sub.title} className="mt-4 max-h-[560px] rounded-lg border border-slate-200" />}
              {(current.extracted_text || (!sub.link_url && current.value == null && !current.mime_type?.startsWith('image/'))) && (
                <div className="mt-5 text-[15px] leading-7 text-slate-800 whitespace-pre-wrap max-h-[640px] overflow-y-auto">{current.extracted_text || '(본문 없음 — 첨부 파일을 열어 보세요)'}</div>
              )}
            </>)}
          </Card>
          {versions.length > 1 && (
            <Card className="p-5">
              <div className="font-semibold">버전 흐름</div>
              <ol className="mt-4 relative border-l border-slate-200 ml-2 space-y-4">
                {versions.map((v) => {
                  const sc = scores.data?.find((s) => s.version_id === v.id)?.score;
                  return (
                    <li key={v.id} className="ml-4">
                      <span className="absolute -left-[5px] mt-1.5 w-2.5 h-2.5 rounded-full bg-indigo-500" />
                      <div className="text-sm"><b className="font-mono">v{v.version}</b> <span className="text-slate-400 text-xs ml-1">{fmtDate(v.created_at)}</span>
                        {isLeader && sc !== undefined && <span className="ml-2 text-xs text-slate-500">사고의 깊이 <b className="font-mono">{num(sc)}</b></span>}</div>
                      {v.note && <p className="text-sm text-slate-600">{v.note}</p>}
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}
        </div>
        <div className="lg:col-span-2 space-y-5">
          {isLeader && <AiReview teamId={sub.team_id} version={current} onToComments={(qs) => toComments.mutate(qs)} />}
          <Comments sub={sub} versions={versions} current={current} />
        </div>
      </div>
      <UploadModal open={upload} onClose={() => setUpload(false)} submission={sub} onDone={() => setVerId(null)} />
    </section>
  );
}
