import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileUp } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { Submission, SubmissionVersion } from '../lib/types';
import { fmtDate } from '../lib/format';
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
  const { team, uid } = useTeam();
  const [params] = useSearchParams();
  const [open, setOpen] = useState(params.get('new') === '1');
  const list = useQuery({
    queryKey: ['subs', team.id, 'mine', uid],
    queryFn: () => q<(Submission & { submission_versions: Pick<SubmissionVersion, 'version'>[] })[]>(
      supabase.from('submissions').select('*, submission_versions(version)').eq('team_id', team.id).eq('author_id', uid).order('updated_at', { ascending: false })),
  });
  return (
    <section>
      <PageHeader title="업무플랫폼" sub="문서·링크·캡처·숫자 무엇이든 올리면 AI가 먼저 검토하고 팀장님께 바로 갑니다. 피드백이 여기서 오갑니다"
        right={<Button onClick={() => setOpen(true)}><FileUp size={15} />공유하기</Button>} />
      <div className="grid lg:grid-cols-3 gap-5 items-start">
      <Card className="lg:col-span-2">
        {list.isLoading ? <Spinner /> : !list.data?.length ? (
          <Empty icon={<FileUp size={18} />} title="아직 공유한 것이 없습니다" action={<Button onClick={() => setOpen(true)}>공유하기</Button>}>
            전문 프로그램에서 일한다면 결과 화면 캡처나 링크, 숫자 한 줄이면 충분합니다. 공유할 게 없는 주는 체크인만 해도 됩니다.
          </Empty>
        ) : list.data.map((s) => (
          <Link key={s.id} to={`/work/${s.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{s.title} <span className="font-mono text-xs text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 ml-1">v{Math.max(0, ...s.submission_versions.map((v) => v.version))}</span></div>
              <div className="text-sm text-slate-500">{fmtDate(s.updated_at)} 업데이트</div>
            </div>
            <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill>
            <ChevronRight size={16} className="text-slate-300" />
          </Link>
        ))}
      </Card>
      <LeaderGuide teamId={team.id} kinds={['principle', 'rubric', 'framework', 'glossary']} title="올리기 전에 · 팀장 가이드" />
      </div>
      <UploadModal open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
