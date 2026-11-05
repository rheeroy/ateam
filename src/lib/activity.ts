// 팀원 활동 지수 — 팀원이 앱에 남긴 업무 기록(대화 · 결과물 · 업데이트 · 응답 · 컨디션 공유)을 주 단위로 본다 (50_member_activity.sql)
//   목적은 감시가 아니라 '흐름이 바뀐 사람'을 일찍 알아채는 것 — 같은 사람의 지난 4주와 비교하는 것이 기본, 팀 비교는 보조
//   판단(읽기)은 부하 · 컨디션과 엮어서 한다: 과부하 · 의욕 저하 신호 · 활동 줄어듦 · 업무 여유 · 활발 · 보통
import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { lastMondays } from './load';

export interface ActWeek { user_id: string; week_start: string; total: number; off_hours: number; talk: number; output: number; updates: number; replies: number; checkin: number }

export function useActivity(teamId: string, weeks = 8) {
  return useQuery({
    queryKey: ['member-activity', teamId, weeks], staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('member_activity', { p_team: teamId, p_weeks: weeks });
      if (error) return [] as ActWeek[]; // 50_member_activity.sql 전이면 지수만 비어 보임
      return (data ?? []) as ActWeek[];
    },
  });
}

const median = (a: number[]) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const h = Math.floor(b.length / 2); return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface ActStat {
  weeks: { week: string; total: number; off: number }[]; // 오래된 것부터, 마지막이 이번 주(진행 중)
  recent: number;      // 최근 2주(지난주 · 지지난주) 주평균
  base: number | null; // 그 앞 4주 주평균 (기록 쌓인 주가 2주 이상일 때)
  change: number | null; // recent / base - 1
  teamMedian: number;  // 팀원 최근 2주 주평균의 중앙값
  rel: number | null;  // recent / teamMedian
  offShare: number;    // 최근 2주 시간외 비율
  joinedWeeks: number;
}

/** 팀원 한 명의 활동 통계 — mondays 는 lastMondays(8) */
export function actStat(rows: ActWeek[], uid: string, joinedAt: string, mondays = lastMondays(8)): ActStat {
  const by = (u: string) => mondays.map((w) => { const r = rows.find((x) => x.user_id === u && x.week_start === w); return { week: w, total: r?.total ?? 0, off: r?.off_hours ?? 0 }; });
  const joined = joinedAt.slice(0, 10);
  const live = (w: string) => w >= joined || Date.parse(joined) - Date.parse(w) < 7 * 864e5;
  const weeks = by(uid);
  const full = weeks.slice(0, -1); // 이번 주는 진행 중이라 비교에서 뺀다
  const rec = full.slice(-2).filter((w) => live(w.week));
  const bas = full.slice(-6, -2).filter((w) => live(w.week));
  const recent = r1(avg(rec.map((w) => w.total)));
  const base = bas.length >= 2 ? r1(avg(bas.map((w) => w.total))) : null;
  const uids = [...new Set(rows.map((r) => r.user_id))];
  const teamMedian = r1(median(uids.map((u) => avg(by(u).slice(0, -1).slice(-2).map((w) => w.total)))));
  const recTot = rec.reduce((a, w) => a + w.total, 0);
  return {
    weeks, recent, base,
    change: base != null && base >= 1 ? r1(recent / base - 1) : null,
    teamMedian, rel: teamMedian > 0 ? r1(recent / teamMedian) : null,
    offShare: recTot ? rec.reduce((a, w) => a + w.off, 0) / recTot : 0,
    joinedWeeks: weeks.filter((w) => live(w.week)).length,
  };
}

export type ReadKey = 'overload' | 'motivation' | 'drop' | 'slack' | 'busy' | 'steady' | 'none';
export interface ActRead { key: ReadKey; label: string; tone: 'risk' | 'watch' | 'good' | 'none'; why: string }

/** 활동 · 부하 · 컨디션을 엮은 한 줄 판단 — 판정이 아니라 '확인해 볼 것'의 출발점 */
export function readActivity(s: ActStat | null, p: { load: number | null; cond: number | null; condPrev: number | null; checkinGap: boolean; newbie: boolean }): ActRead {
  if (!s || (s.recent === 0 && s.base == null && s.weeks.every((w) => w.total === 0))) return { key: 'none', label: '기록 적음', tone: 'none', why: '앱에 남은 업무 기록이 아직 적어 판단하지 않습니다' };
  const drop = s.change != null && s.change <= -0.4;
  const condDown = (p.cond != null && p.condPrev != null && p.cond < p.condPrev) || (p.cond != null && p.cond <= 2);
  const off = Math.round(s.offShare * 100);
  if ((p.load != null && p.load > 110) || (s.offShare >= 0.3 && s.rel != null && s.rel >= 1)) {
    return { key: 'overload', label: '과부하', tone: 'risk', why: [p.load != null && p.load > 110 ? `업무 부하 ${p.load}%` : '', s.offShare >= 0.2 ? `기록의 ${off}%가 밤·주말` : ''].filter(Boolean).join(' · ') || '활동이 팀보다 많고 시간외 비중이 큽니다' };
  }
  if (drop && (condDown || p.checkinGap)) {
    return { key: 'motivation', label: '의욕 저하 신호', tone: 'risk', why: `활동이 지난 4주보다 ${Math.round(-s.change! * 100)}% 줄었고 ${p.checkinGap ? '컨디션 공유도 끊겼습니다' : '컨디션도 내려갔습니다'}` };
  }
  if (drop) return { key: 'drop', label: '활동 줄어듦', tone: 'watch', why: `최근 2주 기록이 지난 4주보다 ${Math.round(-s.change! * 100)}% 적습니다 (주 ${s.base} → ${s.recent}건)` };
  if (!p.newbie && p.load != null && p.load < 60 && s.rel != null && s.rel < 0.6) {
    return { key: 'slack', label: '업무 여유', tone: 'watch', why: `맡은 일 부하 ${p.load}% · 기록이 팀 중앙값의 ${s.rel}배` };
  }
  if (p.newbie && s.rel != null && s.rel < 0.6) return { key: 'slack', label: '적응 중 · 일 적음', tone: 'watch', why: `합류 초기 · 기록이 팀 중앙값의 ${s.rel}배` };
  if (s.rel != null && s.rel >= 1.3 && (p.cond == null || p.cond >= 3)) return { key: 'busy', label: '활발', tone: 'good', why: `기록이 팀 중앙값의 ${s.rel}배${s.change != null && s.change >= 0.2 ? ` · 지난 4주보다 ${Math.round(s.change * 100)}% 늘어남` : ''}` };
  return { key: 'steady', label: '평소대로', tone: 'good', why: s.base != null ? `주 ${s.base} → ${s.recent}건 · 큰 변화 없음` : `주 ${s.recent}건` };
}
