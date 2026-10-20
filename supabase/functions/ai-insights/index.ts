// AI 인사이트 (일간·주간·월간) — 규칙·모델 신호를 사실로 받아 엮고 해석한다 (코어 AI, 구독 포함)
// 팀장 요청: {team_id, period}  /  예약 작업: {all: true, period}
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, addKnowhow, weekLabel, type AiKind } from '../_shared/gateway.ts';
import { MODEL_FAST, MODEL_SMART } from '../_shared/anthropic.ts';
import { INSIGHT, INSIGHT_PERIOD } from '../_shared/prompts/index.ts';
import { conditionText, HEAVY_MOODS } from '../_shared/condition.ts';
import { analyze, loadRaw, signalsFor, kstToday, kstMonday, addDaysYmd, DOMAIN_META, TYPE_LABEL, type Period, type RawMember } from '../_shared/signals.ts';

const KIND: Record<Period, AiKind> = { daily: 'insight_daily', weekly: 'insight_weekly', monthly: 'insight_monthly' };
const SPAN: Record<Period, number> = { daily: 2, weekly: 7, monthly: 31 };

async function insightFor(teamId: string, period: Period, createdBy: string | null) {
  const { data: team } = await admin.from('teams').select('id, name, mission, settings').eq('id', teamId).single();
  const { data: tm } = await admin.from('team_members').select('user_id, role, job_title, profiles(full_name)').eq('team_id', teamId).eq('status', 'active');
  const members: RawMember[] = (tm ?? []).map((m) => ({ user_id: m.user_id, role: m.role, name: (m.profiles as unknown as { full_name: string })?.full_name ?? '' }));
  const leader = members.find((m) => m.role === 'leader');
  if (!leader) throw new HttpError(422, 'NO_LEADER');
  const nameOf = new Map(members.map((m) => [m.user_id, m.name]));
  const minEv = Number((team?.settings as Record<string, unknown>)?.min_judgment_evidence ?? 8);

  const raw = await loadRaw(admin, teamId, leader.user_id, minEv);
  const { signals, domains } = analyze(raw, members);
  const picked = signalsFor(period, signals).slice(0, 18);

  const book = new SourceBook();
  for (const s of picked) book.add('signal', null, `${DOMAIN_META[s.domain].name} · ${TYPE_LABEL[s.type]}`, `${s.title}${s.detail ? ` — ${s.detail}` : ''} (규칙: ${s.rule})`);
  const domainLine = domains.map((d) => `${DOMAIN_META[d.domain].name}: 상태 ${d.status}, ${d.kpiLabel} ${d.kpi}, 데이터 충실도 ${d.confidence}/3`).join('\n');

  // 기간 원본 기록 (짧게)
  const since = new Date(Date.now() - SPAN[period] * 86400000).toISOString();
  const { data: cis } = await admin.from('checkins').select('id, user_id, week_start, condition, moods, note')
    .eq('team_id', teamId).gte('updated_at', period === 'daily' ? new Date(Date.now() - 7 * 86400000).toISOString() : since).limit(30);
  // 하루 인사이트는 신경 쓸 만한 것만 (컨디션 2 이하 · 부담 요인)
  const notable = (c: { condition: number | null; moods: string[] | null }) => (c.condition != null && c.condition <= 2) || (c.moods ?? []).some((k) => HEAVY_MOODS.includes(k));
  for (const c of cis ?? []) if (period !== 'daily' || notable(c)) book.add('checkin', c.id, `컨디션 공유 ${nameOf.get(c.user_id)} ${weekLabel(c.week_start)}`, conditionText(c));
  const { data: cms } = await admin.from('work_item_comments').select('id, item_id, author_id, body, kind, work_items(title)').eq('team_id', teamId).gte('created_at', since).limit(15);
  for (const c of cms ?? []) book.add('item_comment', c.id, `코멘트 · ${(c.work_items as unknown as { title: string })?.title}`, `${nameOf.get(c.author_id)}: ${c.body}`);
  const { data: evs } = await admin.from('work_item_events').select('id, item_id, kind, reason, old, new, work_items(title)').eq('team_id', teamId).in('kind', ['replan', 'target']).gte('created_at', since).limit(15);
  for (const e of evs ?? []) book.add('item_event', null, `계획 변경 · ${(e.work_items as unknown as { title: string })?.title}`, `${JSON.stringify(e.old)} → ${JSON.stringify(e.new)} 사유: ${e.reason ?? '없음'}`);
  if (period === 'daily') {
    const today = kstToday();
    const { data: oos } = await admin.from('one_on_ones').select('id, member_id, scheduled_at').eq('team_id', teamId).eq('status', 'scheduled')
      .gte('scheduled_at', `${today}T00:00:00+09:00`).lt('scheduled_at', `${addDaysYmd(today, 1)}T00:00:00+09:00`);
    for (const o of oos ?? []) book.add('one_on_one', o.id, `오늘 1on1 · ${nameOf.get(o.member_id)}`, `예정 ${o.scheduled_at.slice(11, 16)}`);
  }
  if (book.size === 0) return null;
  await addKnowhow(book, teamId, 'briefing', 1500);

  const text = [
    `팀: ${team?.name} / 미션: ${team?.mission || '-'}`,
    INSIGHT_PERIOD[period],
    `## 영역별 상태 (계산값)\n${domainLine}`,
    book.knowhowText(),
    book.text('팀 신호와 기록'),
  ].filter(Boolean).join('\n\n');

  const periodStart = period === 'daily' ? kstToday() : period === 'weekly' ? kstMonday() : `${kstToday().slice(0, 7)}-01`;
  const { output } = await runAi({
    teamId, kind: KIND[period], model: period === 'daily' ? MODEL_FAST : MODEL_SMART,
    system: INSIGHT, content: [{ type: 'text', text }], book,
    depth: depthOf(book.size, [5, 12, 25]), level: period === 'monthly' ? 'L3' : 'L2',
    createdBy, periodStart, periodEnd: kstToday(), maxTokens: period === 'monthly' ? 2200 : 1400,
    extra: { period, signal_count: picked.length },
  });
  return output;
}

serve(async (req) => {
  const body = await readJson<{ team_id?: string; all?: boolean; period?: Period }>(req);
  const period: Period = (['daily', 'weekly', 'monthly'] as const).includes(body.period as Period) ? body.period as Period : 'weekly';
  const caller = await getCaller(req);

  if (body.all) {
    if (!caller.isService) throw new HttpError(403, 'forbidden');
    const { data: ids } = await admin.rpc('active_ai_teams');
    const results: Record<string, string> = {};
    for (const id of (ids ?? []) as string[]) {
      try {
        const out = await insightFor(id, period, null);
        results[id] = out ? 'ok' : 'empty';
      } catch (e) {
        results[id] = e instanceof Error ? e.message.slice(0, 80) : 'error';
      }
    }
    return json({ results });
  }
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  await assertLeader(caller, body.team_id);
  const out = await insightFor(body.team_id, period, caller.userId);
  if (!out) throw new HttpError(422, 'NO_DATA', '분석할 기록이 아직 없습니다');
  return json(out);
});
