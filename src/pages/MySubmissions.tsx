import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileUp, MessageSquare } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { Submission } from '../lib/types';
import { KIND_TAG, REQ_TAG } from '../lib/work';
import { cx, fmtDate } from '../lib/format';
import { Button, Card, Empty, PageHeader, Pill, Spinner } from '../components/ui';
import { UploadModal } from '../components/Upload';
import { LeaderGuide } from '../components/LeaderGuide';

export const STATUS = {
  in_review: { label: '리뷰 중', tone: 'indigo' as const },
  needs_work: { label: '보완 요청', tone: 'amber' as const },
  approved: { label: '승인', tone: 'emerald' as const },
  shared: { label: '공유됨', tone: 'slate' as const },
};

export default function MySubmissions() {
  const { team, uid, nameOf } = useTeam();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  type Row = Submission & { submission_versions: { version: number; created_at: string }[]; review_comments: { author_id: string; body: string; created_at: string }[] };
  const list = useQuery({
    queryKey: ['subs', team.id, 'mine', uid],
    queryFn: () => q<Row[]>(supabase.from('submissions').select('*, submission_versions(version, created_at), review_comments(author_id, body, created_at)').eq('team_id', team.id).eq('author_id', uid).order('updated_at', { ascending: false })),
  });
  const rows = (list.data ?? []).map((s) => {
    const vs = s.submission_versions ?? [];
    const lastVer = vs.reduce((m, v) => (v.created_at > m ? v.created_at : m), '');
    const cs = [...(s.review_comments ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const fb = cs.find((c) => c.author_id !== uid);
    const myLast = cs.find((c) => c.author_id === uid)?.created_at ?? '';
    const fresh = !!fb && fb.created_at > lastVer && fb.created_at > myLast;
    return { s, v: Math.max(0, ...vs.map((x) => x.version)), fb, fresh };
  }).sort((a, b) => Number(b.s.status === 'needs_work') - Number(a.s.status === 'needs_work') || Number(b.fresh) - Number(a.fresh) || b.s.updated_at.localeCompare(a.s.updated_at));
  return (
    <section>
      <PageHeader title="업무플랫폼" sub="문서·링크·캡처·숫자 무엇이든 올리면 AI가 먼저 검토하고 팀장님께 바로 갑니다. 피드백이 여기서 오갑니다"
        right={<Button onClick={() => setOpen(true)}><FileUp size={15} />공유하기</Button>} />
      <div className="grid lg:grid-cols-3 gap-5 items-start">
      <Card className="lg:col-span-2">
        {list.isLoading ? <Spinner /> : !rows.length ? (
          <Empty icon={<FileUp size={18} />} title="아직 공유한 것이 없습니다" action={<Button onClick={() => setOpen(true)}>공유하기</Button>}>
            전문 프로그램에서 일한다면 결과 화면 캡처나 링크, 숫자 한 줄이면 충분합니다. 공유할 게 없는 주는 체크인만 해도 됩니다.
          </Empty>
        ) : rows.map(({ s, v, fb, fresh }) => {
          const rq = REQ_TAG[s.request_type] ?? REQ_TAG.approval;
          return (
            <Link key={s.id} to={`/work/${s.id}`} className={cx('px-5 py-4 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0', s.status === 'needs_work' && 'bg-amber-50/40')}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={cx('text-[10px] font-bold rounded px-1.5 py-0.5', rq.cls)}>{rq.label}</span>
                  <span className="text-[10px] rounded px-1.5 py-0.5 ring-1 ring-slate-200 text-slate-500">{KIND_TAG[s.kind] ?? '문서'}</span>
                  <span className="font-semibold truncate">{s.title}</span>
                  <span className="font-mono text-xs text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5">v{v}</span>
                  {fresh && <span className="text-[10px] font-bold text-white bg-rose-500 rounded-full px-1.5 py-0.5">새 피드백</span>}
                </div>
                {fb ? <p className={cx('mt-1 text-sm truncate flex items-center gap-1.5', fresh ? 'text-slate-800' : 'text-slate-500')}><MessageSquare size={13} className="shrink-0 text-slate-400" /><span className="truncate">{nameOf(fb.author_id)}: {fb.body}</span></p>
                  : <p className="mt-1 text-sm text-slate-400">{fmtDate(s.updated_at)} 업데이트 · 아직 피드백 없음</p>}
              </div>
              <Pill tone={STATUS[s.status].tone}>{s.status === 'needs_work' ? '보완 요청 · 고쳐서 올리기' : STATUS[s.status].label}</Pill>
              <ChevronRight size={16} className="text-slate-300" />
            </Link>
          );
        })}
      </Card>
      <LeaderGuide teamId={team.id} kinds={['principle', 'rubric', 'framework', 'glossary']} title="올리기 전에 · 팀장 가이드" />
      </div>
      <UploadModal open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
