import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileText } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import type { Submission, SubmissionVersion } from '../lib/types';
import { fmtDate } from '../lib/format';
import { Card, Empty, PageHeader, Pill, Spinner, Tabs } from '../components/ui';
import { STATUS } from './MySubmissions';

type F = 'in_review' | 'needs_work' | 'approved' | 'all';

export default function Reviews() {
  const { team, nameOf } = useTeam();
  const [f, setF] = useState<F>('in_review');
  const list = useQuery({
    queryKey: ['subs', team.id, 'all'],
    queryFn: () => q<(Submission & { submission_versions: Pick<SubmissionVersion, 'version' | 'created_at'>[] })[]>(
      supabase.from('submissions').select('*, submission_versions(version, created_at)').eq('team_id', team.id).order('updated_at', { ascending: false }).limit(200)),
  });
  const rows = (list.data ?? []).filter((s) => f === 'all' || s.status === f);
  const count = (k: F) => (list.data ?? []).filter((s) => k === 'all' || s.status === k).length;
  return (
    <section>
      <PageHeader title="리뷰룸" sub="팀원이 올린 결과물을 버전별로 보고, AI 1차 검토와 함께 피드백을 주고받습니다" />
      <Card>
        <div className="px-5 pt-3">
          <Tabs value={f} onChange={setF} items={[
            { id: 'in_review', label: `리뷰 대기 ${count('in_review')}` },
            { id: 'needs_work', label: `보완 요청 ${count('needs_work')}` },
            { id: 'approved', label: `승인 ${count('approved')}` },
            { id: 'all', label: '전체' },
          ]} />
        </div>
        {list.isLoading ? <Spinner /> : !rows.length ? <Empty icon={<FileText size={18} />} title="결과물이 없습니다">팀원이 '내 결과물'에서 파일을 올리면 여기에 모입니다.</Empty> :
          rows.map((s) => {
            const latest = [...s.submission_versions].sort((a, b) => b.version - a.version)[0];
            return (
              <Link key={s.id} to={`/reviews/${s.id}`} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 border-t border-slate-100">
                <div className="w-9 h-11 rounded-md border border-slate-200 bg-white shrink-0 overflow-hidden"><div className="h-1.5 bg-indigo-500" /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{s.title} {latest && <span className="font-mono text-xs text-indigo-600 bg-indigo-50 rounded px-1.5 py-0.5 ml-1">v{latest.version}</span>}</div>
                  <div className="text-sm text-slate-500">{nameOf(s.author_id)} · {fmtDate(latest?.created_at ?? s.created_at)}</div>
                </div>
                <Pill tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Pill>
                <ChevronRight size={16} className="text-slate-300" />
              </Link>
            );
          })}
      </Card>
    </section>
  );
}
