// 업무플랫폼 그룹 스페이스 — 프로젝트·TF 단위로 멤버를 묶어 함께 올리고 대화한다
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, errorText } from './supabase';
import { useToast } from '../components/ui';
import { useTeam } from '../state/session';

export interface WorkGroup {
  id: string; team_id: string; name: string; item_id: string | null; created_by: string | null; created_at: string;
  work_group_members: { user_id: string }[];
}

/** 내가 볼 수 있는 그룹 (팀장: 전부, 팀원: 내가 속한 것) — 테이블이 아직 없으면 빈 목록 */
export function useGroups() {
  const { team } = useTeam();
  return useQuery({
    queryKey: ['work-groups', team.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('work_groups').select('*, work_group_members(user_id)').eq('team_id', team.id).order('created_at');
      if (error) return [] as WorkGroup[];
      return (data ?? []) as WorkGroup[];
    },
  });
}

/** 그룹 만들기 · 고치기 (이름 · 연결 목표 · 멤버) */
export function useSaveGroup() {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (g: { id?: string; name: string; item_id: string | null; members: string[] }) => {
      let id = g.id;
      if (id) {
        await q(supabase.from('work_groups').update({ name: g.name.trim(), item_id: g.item_id }).eq('id', id));
      } else {
        const row = await q<{ id: string }>(supabase.from('work_groups').insert({ team_id: team.id, name: g.name.trim(), item_id: g.item_id, created_by: uid }).select('id').single());
        id = row.id;
      }
      const cur = await q<{ user_id: string }[]>(supabase.from('work_group_members').select('user_id').eq('group_id', id));
      const want = new Set(g.members);
      const del = cur.filter((m) => !want.has(m.user_id)).map((m) => m.user_id);
      const add = [...want].filter((u) => !cur.some((m) => m.user_id === u));
      if (del.length) await q(supabase.from('work_group_members').delete().eq('group_id', id).in('user_id', del));
      if (add.length) await q(supabase.from('work_group_members').insert(add.map((user_id) => ({ group_id: id, user_id, team_id: team.id }))));
      return id!;
    },
    onSuccess: (_id, g) => { qc.invalidateQueries({ queryKey: ['work-groups'] }); toast(g.id ? '그룹을 고쳤습니다' : `'${g.name}' 그룹을 만들었습니다`); },
    onError: (e) => toast(errorText(e).includes('work_groups') ? '그룹 기능 SQL(18_work_groups.sql)을 먼저 실행해 주세요.' : errorText(e)),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: (id: string) => q(supabase.from('work_groups').delete().eq('id', id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work-groups'] }); qc.invalidateQueries({ queryKey: ['subs'] }); toast('그룹을 지웠습니다. 올린 자료는 각자의 스페이스에 남습니다.'); },
    onError: (e) => toast(errorText(e)),
  });
}
