// 월요일 팀 브리핑 — 팀장 요청 시 해당 팀, cron({all:true}) 시 브리핑 기능이 있는 모든 팀
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, fmtDate, weekLabel, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { BRIEFING } from '../_shared/prompts/index.ts';

async function briefTeam(teamId: string, createdBy: string | null) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const book = new SourceBook();
  const { data: members } = await admin.from('team_members').select('user_id, profiles(full_name)')
    .eq('team_id', teamId).eq('status', 'active');
  const nameOf = new Map((members ?? []).map((m) => [m.user_id, (m.profiles as unknown as { full_name: string })?.full_name ?? '']));

  const { data: checkins } = await admin.from('checkins').select('id, user_id, week_start, did, blocked, condition')
    .eq('team_id', teamId).gte('updated_at', since);
  for (const c of checkins ?? []) {
    book.add('checkin', c.id, `체크인 ${nameOf.get(c.user_id)} ${weekLabel(c.week_start)}`,
      `한 일: ${c.did} / 막힘: ${c.blocked || '없음'} / 컨디션 ${c.condition ?? '-'}`);
  }
  // 직전 주 체크인 (반복 여부 판단용)
  const prevWeek = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: prevChecks } = await admin.from('checkins').select('id, user_id, week_start, blocked, condition')
    .eq('team_id', teamId).gte('updated_at', prevWeek).lt('updated_at', since);
  for (const c of prevChecks ?? []) {
    book.add('checkin', c.id, `지난주 체크인 ${nameOf.get(c.user_id)}`, `막힘: ${c.blocked || '없음'} / 컨디션 ${c.condition ?? '-'}`);
  }

  const { data: oos } = await admin.from('one_on_ones').select('id, member_id, scheduled_at, shared_notes')
    .eq('team_id', teamId).eq('status', 'done').gte('scheduled_at', since);
  for (const o of oos ?? []) book.add('one_on_one', o.id, `1:1 ${nameOf.get(o.member_id)} ${fmtDate(o.scheduled_at)}`, o.shared_notes);

  const { data: vers } = await admin.from('submission_versions').select('id, version, note, submissions(title, author_id)')
    .eq('team_id', teamId).gte('created_at', since);
  for (const v of vers ?? []) {
    const s = v.submissions as unknown as { title: string; author_id: string };
    const { data: rv } = await admin.from('ai_outputs').select('content').eq('ref_table', 'submission_versions').eq('ref_id', v.id).maybeSingle();
    book.add('submission', v.id, `제출 ${s?.title} v${v.version} (${nameOf.get(s?.author_id)})`,
      `${v.note} ${(rv?.content as { summary?: string })?.summary ?? ''}`);
  }

  const { data: tasks } = await admin.from('work_items').select('id, title, status, progress, due_date, owner_id, base_due, replan_count')
    .eq('team_id', teamId).in('status', ['active', 'blocked']).not('parent_id', 'is', null).neq('measure', 'check').limit(40);
  for (const t of tasks ?? []) {
    book.add('task', t.id, `과제 ${t.title}`, `상태 ${t.status === 'blocked' ? '막힘' : '진행'}, 진척 ${t.progress}%, 마감 ${t.due_date ?? '-'}${t.base_due && t.due_date && t.base_due !== t.due_date ? ` (처음 계획 ${t.base_due}, 변경 ${t.replan_count}회)` : ''}, 담당 ${nameOf.get(t.owner_id) ?? '-'}`);
  }

  const { data: radar } = await admin.rpc('care_radar', { p_team: teamId });
  for (const r of radar ?? []) {
    book.add('signal', r.user_id, `케어 신호 ${r.full_name}`, (r.signals as { label: string }[]).map((s) => s.label).join(', '));
  }

  if (book.size === 0) return null;
  await addKnowhow(book, teamId, 'briefing', 1500);
  const memberCount = (members ?? []).filter((m) => m.user_id).length - 1;
  const submitted = new Set((checkins ?? []).map((c) => c.user_id)).size;
  const conds = (checkins ?? []).map((c) => c.condition).filter((x): x is number => typeof x === 'number');
  const avg = conds.length ? Math.round((conds.reduce((a, b) => a + b, 0) / conds.length) * 10) / 10 : null;

  const { output } = await runAi({
    teamId,
    kind: 'briefing',
    model: MODEL_SMART,
    system: BRIEFING,
    content: [{ type: 'text', text: `계산된 값: 체크인 ${submitted}/${memberCount}명 제출, 평균 컨디션 ${avg ?? '-'}\n\n${book.knowhowText()}\n\n${book.text('지난 7일 기록')}` }],
    book,
    depth: depthOf(book.size, [5, 12, 25]),
    level: 'L2',
    createdBy,
    periodStart: since.slice(0, 10),
    periodEnd: new Date().toISOString().slice(0, 10),
    maxTokens: 1000,
    extra: { stats: { submitted, members: memberCount, avg_condition: avg }, counts: book.byType() },
  });
  return output;
}

serve(async (req) => {
  const body = await readJson<{ team_id?: string; all?: boolean }>(req);
  const caller = await getCaller(req);

  if (body.all) {
    if (!caller.isService) throw new HttpError(403, 'forbidden');
    const { data: teams } = await admin.from('teams').select('id');
    const results: Record<string, string> = {};
    for (const t of teams ?? []) {
      try {
        const out = await briefTeam(t.id, null);
        results[t.id] = out ? 'ok' : 'empty';
      } catch (e) {
        results[t.id] = e instanceof Error ? e.message.slice(0, 80) : 'error';
      }
    }
    return json({ results });
  }

  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  await assertLeader(caller, body.team_id);
  const out = await briefTeam(body.team_id, caller.userId);
  if (!out) throw new HttpError(422, 'NO_DATA', '지난 7일 동안 쌓인 기록이 없습니다');
  return json(out);
});
