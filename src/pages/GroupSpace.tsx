// 업무플랫폼 › 그룹방 (팀장) — 그룹 멤버와 함께 쓰는 채팅형 스페이스
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useGroups, type WorkGroup } from '../lib/groups';
import { Spinner } from '../components/ui';
import { GroupModal } from '../components/work/GroupModal';
import { Space } from '../components/space/Space';
import { GroupBar } from './MySubmissions';

export default function GroupSpace() {
  const { id } = useParams();
  const groups = useGroups();
  const [edit, setEdit] = useState<WorkGroup | null>(null);
  if (groups.isLoading) return <Spinner />;
  const g = (groups.data ?? []).find((x) => x.id === id);
  if (!g) return <Navigate to="/work" replace />;
  return (
    <div className="space-y-3">
      <div>
        <Link to="/work" className="text-sm text-slate-500 hover:text-indigo-700 inline-flex items-center gap-1"><ArrowLeft size={14} />업무플랫폼</Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{g.name} <span className="text-base font-medium text-slate-400">그룹방</span></h1>
      </div>
      <GroupBar g={g} onEdit={() => setEdit(g)} />
      <Space space={{ kind: 'group', id: g.id }} group={g} leaderView offset="18rem" />
      {edit && <GroupModal group={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}
