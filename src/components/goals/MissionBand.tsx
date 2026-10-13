// 팀 미션 띠 — 팀목표 맨 위와 팀 전략에서 같이 쓴다
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link2, Pencil } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q } from '../../lib/supabase';
import { Button, inputCls } from '../ui';

export function MissionBand({ right }: { right?: React.ReactNode }) {
  const { team, refresh, isLeader } = useTeam();
  const [edit, setEdit] = useState(false);
  const [mission, setMission] = useState(team.mission);
  const save = useMutation({ mutationFn: () => q(supabase.from('teams').update({ mission }).eq('id', team.id)), onSuccess: () => { setEdit(false); refresh(); } });
  return (
    <div className="relative overflow-hidden rounded-2xl bg-slate-900 text-white p-6">
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_90%_-20%,rgba(99,102,241,0.45),transparent_50%)]" />
      <div className="relative flex items-start gap-4 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2"><span className="text-xs font-semibold tracking-wider text-indigo-300">팀 미션</span>
            {!edit && isLeader && <button className="text-slate-400 hover:text-white" onClick={() => { setMission(team.mission); setEdit(true); }} title="고치기" aria-label="팀 미션 고치기"><Pencil size={13} /></button>}</div>
          {edit ? (
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <input autoFocus className={`${inputCls} text-slate-900`} value={mission} onChange={(e) => setMission(e.target.value)} />
              <Button type="submit" loading={save.isPending}>저장</Button><Button type="button" variant="ghost" onClick={() => setEdit(false)}>취소</Button>
            </form>
          ) : <div className="mt-1.5 text-xl font-bold leading-snug">{team.mission || '팀 미션을 적어 주세요'}</div>}
          {team.parent_link && <div className="mt-2.5 text-sm text-slate-300 inline-flex items-center gap-1.5"><Link2 size={14} />상위 연결 · {team.parent_link}</div>}
        </div>
        {right && <div className="relative">{right}</div>}
      </div>
    </div>
  );
}
