// 상향 관리 › 임원 브리핑 — 상위 관리자 프로필 + AI 브리핑
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, q, errorText } from './supabase';
import { useLatestAi } from './hooks';
import { mondayOf } from './format';
import type { AiOutput } from './types';
import { useToast } from '../components/ui';

export interface Executive { id: string; team_id: string; name: string; title: string; style_tags: string[]; interests: string; prefs: string; sort: number }
export const STYLE_PRESETS = ['숫자·근거 중시', '결론 먼저', '디테일 확인', '리스크 민감', '속도 중시', '고객 관점', '비용·효율', '관계·맥락 중시', '새로운 시도 선호', '문서보다 대면'];

export interface ExecBriefOut {
  headline: string;
  execs: { exec_id: string; name: string; lens?: string; opener?: string;
    questions: { q: string; why?: string; prep?: string }[];
    challenges: { point: string; why?: string; prep?: string }[] }[];
  requests?: { note_id?: string; title: string; due?: string; status?: string; reply?: string }[];
  share_first?: { title: string; why?: string; tone?: 'good' | 'bad' }[];
  watch?: string;
}

export function useExecutives(teamId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery({
    queryKey: ['executives', teamId],
    queryFn: async () => {
      const { data, error } = await supabase.from('executives').select('*').eq('team_id', teamId).order('sort').order('created_at');
      return error ? [] : (data as Executive[]);
    },
  });
  const inval = () => qc.invalidateQueries({ queryKey: ['executives', teamId] });
  const onError = (e: unknown) => toast(errorText(e).includes('executives') ? '상위 관리자 테이블이 아직 없습니다. 11_exec_brief.sql 을 실행해 주세요.' : errorText(e));
  const save = useMutation({
    mutationFn: async (e: Partial<Executive> & { name: string }) => {
      const row = { team_id: teamId, name: e.name.trim(), title: e.title ?? '', style_tags: e.style_tags ?? [], interests: e.interests ?? '', prefs: e.prefs ?? '', updated_at: new Date().toISOString() };
      if (e.id) await q(supabase.from('executives').update(row).eq('id', e.id));
      else await q(supabase.from('executives').insert({ ...row, sort: (list.data?.length ?? 0) }));
    },
    onSuccess: () => { inval(); toast('저장했습니다. 다음 브리핑부터 반영됩니다.'); }, onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => q(supabase.from('executives').delete().eq('id', id)), onSuccess: inval, onError });
  return { list: list.data ?? [], loading: list.isLoading, save, remove };
}

/** 이번 주 브리핑 (데모 팀은 최근 것) */
export function useExecBrief(teamId: string, isDemo?: boolean) {
  const qy = useLatestAi<ExecBriefOut>(teamId, 'exec_brief');
  const out = qy.data as AiOutput<ExecBriefOut> | null | undefined;
  const week = mondayOf();
  const fresh = !!out && (isDemo || (out.period_start ?? '') >= week);
  return { out: out ?? null, fresh, loading: qy.isLoading };
}
