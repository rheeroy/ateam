// 의사결정 카드: 홈 TOP PRIORITY와 의사결정 보드가 같은 원천을 쓴다
//   AI 의사결정 해석 + 규칙(목표 조정 · 방침 대응 · 배분 · 우선순위 · 반복 지연) / 리스크는 근거로 붙거나 '지켜볼 것'으로
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../../state/session';
import { supabase } from '../../lib/supabase';
import { errorText } from '../../lib/supabase';
import { cx } from '../../lib/format';
import type { Signal } from '../../lib/insights';
import { useToast } from '../ui';
import { AI_LINKS, dDay, sectionHref, type HomeModel } from '../home/shared';

export interface Prio {
  key: string; score: number; kind: string; title: string; why?: string; impact?: string; options?: string[]; evidence: Signal[];
  action?: string; to?: string; ai?: boolean;
  /** 보드 위치 0~1: 성과 영향(위로 클수록), 시급성(오른쪽일수록) */
  y: number; x: number;
}
export type Stage = 'reviewing' | 'promoted' | 'watching' | 'dismissed' | 'decided';
export interface BoardRow { card_key: string; title: string; stage: Stage; note: string; decision_id: string | null; updated_at: string }

const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
const keyOf = (prefix: string, title: string) => `${prefix}:${title.replace(/\s+/g, '').slice(0, 48)}`;
const clamp = (v: number) => Math.max(0.04, Math.min(0.96, v));

/** 팀장이 보드에서 옮긴 상태 (테이블이 아직 없으면 빈 상태로) */
export function useBoard(teamId: string) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['decision-board', teamId],
    queryFn: async () => {
      const { data, error } = await supabase.from('decision_board').select('card_key, title, stage, note, decision_id, updated_at').eq('team_id', teamId);
      return error ? [] : (data as BoardRow[]);
    },
    staleTime: 30_000,
  });
  const map = new Map((q.data ?? []).map((r) => [r.card_key, r]));
  const set = useMutation({
    mutationFn: async (p: { key: string; title: string; stage: Stage | null; decision_id?: string | null }) => {
      if (p.stage === null) {
        const { error } = await supabase.from('decision_board').delete().eq('team_id', teamId).eq('card_key', p.key);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from('decision_board').upsert({ team_id: teamId, card_key: p.key, title: p.title, stage: p.stage, decision_id: p.decision_id ?? null, updated_at: new Date().toISOString() });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decision-board', teamId] }),
    onError: (e) => toast(errorText(e).includes('decision_board') ? '의사결정 보드 테이블이 아직 없습니다. 08_people_work.sql 을 실행해 주세요.' : errorText(e)),
  });
  return { rows: q.data ?? [], map, set, loading: q.isLoading };
}

/** 결정할 것 (점수순). hidden = 보드에서 뺐거나 이미 결정한 카드도 포함 */
export function usePriorities(m: HomeModel, opts: { hidden?: boolean } = {}): Prio[] {
  const { team, members } = useTeam();
  const board = useBoard(team.id);
  const names = members.map((x) => x.profiles?.full_name).filter(Boolean) as string[];
  const goals = m.raw?.goals ?? [];
  const items = m.raw?.items ?? [];
  const tokens = (t: string) => t.split(/[\s·,()'"‘’]+/).filter((w) => w.length >= 2 && !/^(목표|과제|확대|성공|관리|운영|개선|정책|확정)$/.test(w));
  const evidenceFor = (text: string, goalId?: string) => {
    const hitGoals = goals.filter((g) => g.goal_id === goalId || tokens(g.title).some((w) => text.includes(w)));
    const kids = items.filter((i) => hitGoals.some((g) => i.parent_id === g.goal_id)).map((i) => i.title);
    const keys = [...names.filter((n) => text.includes(n)), ...hitGoals.map((g) => g.title), ...kids];
    return m.riskList.filter((s) => keys.some((k) => (s.title + (s.detail ?? '')).includes(k))).slice(0, 3);
  };
  const decideText = m.insight ? m.ai.decide.items.map((it) => `${it.title} ${it.body} ${it.impact ?? ''}`).join(' ') : '';
  const overlaps = (t: string) => !!decideText && tokens(t).some((w) => w.length >= 3 && decideText.includes(w));
  const TASKY = /D-\d|제출|마감|기한|리뷰|1:1|약속|결과 기록/;
  const out: Prio[] = [];
  if (m.insight) {
    m.ai.decide.items.forEach((it, i) => {
      if (TASKY.test(it.title)) return;
      out.push({ key: keyOf('ai-d', it.title), score: 200 + it.severity * 10 - i, kind: '결정', title: strip(it.title), why: strip(it.body), impact: it.impact ? strip(it.impact) : undefined,
        options: it.options, evidence: evidenceFor(`${it.title} ${it.body} ${it.action ?? ''} ${it.impact ?? ''}`), action: it.action ? strip(it.action) : undefined,
        to: it.link ? AI_LINKS[it.link] : '/decide', ai: true, y: 0.55 + it.severity * 0.13, x: [0.35, 0.4, 0.62, 0.86][it.severity] ?? 0.5 });
    });
    (['perf', 'org'] as const).forEach((sec) => m.ai[sec].items.filter((it) => it.severity >= 2 && it.action && !overlaps(it.title) && !TASKY.test(it.title)).forEach((it, i) => {
      out.push({ key: keyOf(`ai-${sec}`, it.title), score: 120 + it.severity * 10 - i, kind: sec === 'perf' ? '성과 판단' : '방침 대응', title: strip(it.title), why: strip(it.body),
        evidence: evidenceFor(`${it.title} ${it.body} ${it.action ?? ''}`), action: it.action ? strip(it.action) : undefined, to: it.link ? AI_LINKS[it.link] : sectionHref(sec), ai: true,
        y: 0.45 + it.severity * 0.1, x: it.severity >= 3 ? 0.75 : 0.5 });
    }));
  }
  for (const g of m.lowGoals) out.push({ key: `goal:${g.goal_id}`, score: 170 - (g.probability ?? 0), kind: '목표 결정',
    title: `'${g.title}' 목표를 조정할지, 자원을 더 넣어 지킬지`, impact: `달성 가능성 ${g.probability}% · 진척 ${g.progress}%${g.blocked ? ` · 막힌 하위 항목 ${g.blocked}건` : ''}`,
    options: ['목표 수준을 현실에 맞게 조정', '사람·예산을 더 넣어 목표 유지', '범위를 줄이고 핵심만 지킴'], evidence: evidenceFor(g.title, g.goal_id), action: '무엇을 바꾸면 되는지 시뮬레이션', to: '/sim',
    y: 0.95 - (g.probability ?? 0) / 200, x: 0.78 - (g.probability ?? 0) / 300 });
  for (const n of m.orgSt.high) {
    const im = m.org.data?.impactOf.get(n.id)?.content;
    if (overlaps(`${n.title} ${im?.summary ?? ''}`)) continue;
    const d = n.event_date ? dDay(n.event_date) : null;
    out.push({ key: `org:${n.id}`, score: 150, kind: '방침 대응', title: `'${n.title}'에 맞춰 무엇을 바꿀지`, why: im?.summary ? strip(im.summary) : undefined,
      options: im?.actions?.slice(0, 3).map((a) => a.label), impact: im?.affected?.length ? `영향받는 목표: ${im.affected.map((a) => a.title).join(' · ')}` : undefined,
      evidence: [], action: '영향 분석 보기', to: '/brief/org', y: 0.72, x: d != null ? 1 - Math.min(Math.max(d, 0), 60) / 60 : 0.5 });
  }
  const conc = m.visible.find((s) => s.id.startsWith('exec-conc-'));
  if (conc) out.push({ key: `rule:${conc.id}`, score: 130, kind: '배분 결정', title: '몰린 일을 다시 나눌지', why: conc.title, impact: '한 사람이 막히면 팀 일정 전체가 밀리는 구조를 풉니다', evidence: [conc], action: '재배분 시뮬레이션', to: '/sim', y: 0.6, x: 0.55 });
  const low = m.visible.find((s) => s.id === 'exec-lowvalue');
  if (low) out.push({ key: `rule:${low.id}`, score: 125, kind: '우선순위 결정', title: '기여가 낮은 과제를 줄이고 핵심 목표에 시간을 돌릴지', why: low.title, evidence: [low], action: '시간 배분 보기', to: '/goals/edit?view=table', y: 0.55, x: 0.35 });
  const replan = m.visible.find((s) => s.id.startsWith('exec-replan-'));
  if (replan) out.push({ key: `rule:${replan.id}`, score: 110, kind: '계획 결정', title: '반복해서 밀리는 과제의 범위·일정을 다시 정할지', why: replan.detail ?? replan.title, evidence: [replan], action: '계획 대비 보기', to: '/goals', y: 0.5, x: 0.6 });
  // 리스크를 결정으로 올린 것
  for (const r of board.rows.filter((b) => b.stage === 'promoted' || (b.stage === 'reviewing' && b.card_key.startsWith('risk:')))) {
    const s = m.riskList.find((x) => `risk:${x.id}` === r.card_key);
    out.push({ key: r.card_key, score: 140 + (s?.severity ?? 2) * 5, kind: '리스크 대응', title: `${s?.title ?? r.title} — 어떻게 대응할지`, why: s?.detail, evidence: s ? [s] : [],
      action: s?.action?.label, to: s?.action?.to, y: 0.35 + (s?.severity ?? 2) * 0.15, x: (s?.severity ?? 2) >= 3 ? 0.88 : 0.66 });
  }
  const aiText = out.filter((p) => p.ai).map((p) => p.title + (p.why ?? '')).join(' ');
  const dup = (p: Prio) => !p.ai && goals.some((g) => p.title.includes(g.title) && aiText.includes(g.title.slice(0, 5)));
  return out.filter((p) => !dup(p)).filter((p) => opts.hidden || !['dismissed', 'decided', 'watching'].includes(board.map.get(p.key)?.stage ?? ''))
    .map((p) => ({ ...p, x: clamp(p.x), y: clamp(p.y) })).sort((a, b) => b.score - a.score);
}

/** 지켜볼 리스크 (아직 결정으로 올리지 않은 것) */
export function riskCards(m: HomeModel, board: ReturnType<typeof useBoard>) {
  return m.riskList.filter((s) => { const st = board.map.get(`risk:${s.id}`)?.stage; return st !== 'promoted' && st !== 'dismissed' && !(st === 'reviewing'); })
    .map((s) => ({ key: `risk:${s.id}`, s, x: clamp(s.severity >= 3 ? 0.88 : s.severity === 2 ? 0.62 : 0.38), y: clamp(0.18 + s.severity * 0.12 + (s.domain === 'goal' ? 0.1 : 0)) }));
}

export function EvidenceChips({ list, onAct, dark }: { list: Signal[]; onAct: (s: Signal) => void; dark?: boolean }) {
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((s) => (
        <button key={s.id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAct(s); }}
          className={cx('text-[11px] rounded-full px-2 py-0.5 inline-flex items-center gap-1 max-w-full', dark ? 'bg-white/10 text-slate-200 hover:bg-white/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
          <span className={cx('w-1.5 h-1.5 rounded-full shrink-0', s.severity >= 3 ? 'bg-rose-400' : 'bg-amber-400')} /><span className="truncate">{s.title}</span>
        </button>
      ))}
    </div>
  );
}
