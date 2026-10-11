import { useState } from 'react';
import { Link } from 'react-router-dom';
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
};

export default function MySubmissions() {
  const { team, uid } = useTeam();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ['subs', team.id, 'mine', uid],
    queryFn: () => q<(Submission & { submission_versions: Pick<SubmissionVersion, 'version'>[] })[]>(
      supabase.from('submissions').select('*, submission_versions(version)').eq('team_id', team.id).eq('author_id', uid).order('updated_at', { ascending: false })),
  });
  return (
    <section>
      <PageHeader title="내 결과물" sub="보고서·기획서를 올리면 버전별로 쌓이고, 팀장님 코멘트가 여기서 오갑니다"
        right={<Button onClick={() => setOpen(true)}><FileUp size={15} />결과물 올리기</Button>} />
      <div className="grid lg:grid-cols-3 gap-5 items-start">
      <Card className="lg:col-span-2">
        {list.isLoading ? <Spinner /> : !list.data?.length ? (
          <Empty icon={<FileUp size={18} />} title="아직 올린 결과물이 없습니다" action={<Button onClick={() => setOpen(true)}>첫 결과물 올리기</Button>}>
            결과물을 내지 않는 직무라면 올리지 않아도 됩니다. 체크인과 1:1만으로도 충분합니다.
          </Empty>
        ) : list.data.map((s) => (
          <Link key={s.id} to={`/reviews/${s.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100 first:border-t-0">
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
