// 팀원관리: 사람 단위로 모아 보는 데이터 (1:1 · 판단 깊이 · 관찰 · 근거 원장 · 체크인)
import { useQuery } from '@tanstack/react-query';
import { supabase, q } from './supabase';
import type { Checkin, Observation, OneOnOne } from './types';

const since = (days: number) => new Date(Date.now() - days * 86400000).toISOString();

/** 팀원별 마지막 1:1(완료)과 다음 1:1(예정) */
export function useOneOnOneMap(teamId: string) {
  return useQuery({
    queryKey: ['oo', teamId, 'map'],
    queryFn: async () => {
      const rows = await q<OneOnOne[]>(supabase.from('one_on_ones').select('*').eq('team_id', teamId).order('scheduled_at', { ascending: false }).limit(300));
      const last = new Map<string, OneOnOne>(); const next = new Map<string, OneOnOne>();
      for (const o of rows) {
        if (o.status === 'done' && !last.has(o.member_id)) last.set(o.member_id, o);
        if (o.status === 'scheduled') next.set(o.member_id, o); // 내림차순이라 마지막에 남는 것이 가장 가까운 일정
      }
      return { rows, last, next };
    },
  });
}

export interface ScoreRow { user_id: string; score: number; scored_at: string }
/** 결과물 판단 깊이 점수 (AI 1차 검토가 남김, 0~4) */
export function useJudgmentScores(teamId: string, userId?: string) {
  return useQuery({
    queryKey: ['jscores', teamId, userId ?? 'all'],
    queryFn: () => {
      let qb = supabase.from('judgment_scores').select('user_id, score, scored_at').eq('team_id', teamId).gte('scored_at', since(240));
      if (userId) qb = qb.eq('user_id', userId);
      return q<ScoreRow[]>(qb.order('scored_at'));
    },
  });
}

export function useObservations(teamId: string, userId?: string, days = 120) {
  return useQuery({
    queryKey: ['obs', teamId, userId ?? 'all', days],
    queryFn: () => {
      let qb = supabase.from('observations').select('*').eq('team_id', teamId).gte('occurred_at', since(days));
      if (userId) qb = qb.eq('subject_id', userId);
      return q<Observation[]>(qb.order('occurred_at', { ascending: false }).limit(200));
    },
  });
}

export interface EvidenceRow { id: string; subject_user_id: string; source: string; summary: string; polarity: string; occurred_at: string }
/** 근거 원장 — 체크인·1:1·결과물·리뷰 코멘트·관찰·요청 완료가 자동으로 쌓인다 */
export function useEvidence(teamId: string, userId?: string, days = 183) {
  return useQuery({
    queryKey: ['evidence', teamId, userId ?? 'all', days],
    queryFn: () => {
      let qb = supabase.from('evidence').select('id, subject_user_id, source, summary, polarity, occurred_at').eq('team_id', teamId).gte('occurred_at', since(days));
      if (userId) qb = qb.eq('subject_user_id', userId);
      return q<EvidenceRow[]>(qb.order('occurred_at', { ascending: false }).limit(400));
    },
  });
}
export const EVIDENCE_LABEL: Record<string, string> = {
  checkin: '체크인', one_on_one: '1:1', leader_note: '팀장 메모', submission: '결과물', review_comment: '리뷰 피드백',
  observation: '관찰 메모', task: '업무 완료', metric: '실적', decision: '결정', ai: 'AI 검토',
};

export function useCheckins(teamId: string, userId: string, weeks = 12) {
  return useQuery({
    queryKey: ['checkins', teamId, userId, weeks],
    queryFn: () => q<Checkin[]>(supabase.from('checkins').select('*').eq('team_id', teamId).eq('user_id', userId)
      .gte('week_start', new Date(Date.now() - weeks * 7 * 86400000).toISOString().slice(0, 10)).order('week_start')),
  });
}

/** 점수 목록 → 최근 n개 평균과 그 전 n개 평균 */
export function trendOf(scores: number[], n = 3): { now: number | null; prev: number | null } {
  if (!scores.length) return { now: null, prev: null };
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);
  return { now: avg(scores.slice(-n)), prev: avg(scores.slice(-2 * n, -n)) };
}
