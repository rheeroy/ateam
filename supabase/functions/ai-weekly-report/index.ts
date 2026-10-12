// 주간 업무 보고 초안 — 상위 조직장에게 보낼 문서. 팀장이 고친 문장은 edited_content 로 따로 남는다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, fmtDate, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { WEEKLY_REPORT } from '../_shared/prompts/index.ts';

function mondayOf(d: Date) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() - day + 1);
  return x.toISOString().slice(0, 10);
}

serve(async (req) => {
  const body = await readJson<{ team_id: string; week_start?: string; leader_notes?: string }>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const caller = await getCaller(req);
  await assertLeader(caller, body.team_id);
  const week = body.week_start ?? mondayOf(new Date());
  const weekEnd = new Date(new Date(week).getTime() + 6 * 86400000).toISOString().slice(0, 10);

  const { data: team } = await admin.from('teams').select('name, mission').eq('id', body.team_id).single();
  const { data: members } = await admin.from('team_members').select('user_id, role, profiles(full_name)')
    .eq('team_id', body.team_id).eq('status', 'active');
  const nameOf = new Map((members ?? []).map((m) => [m.user_id, (m.profiles as unknown as { full_name: string })?.full_name ?? '']));
  const book = new SourceBook();

  const { data: checkins } = await admin.from('checkins').select('id, user_id, did, blocked, next')
    .eq('team_id', body.team_id).eq('week_start', week);
  for (const c of checkins ?? []) {
    book.add('checkin', c.id, `체크인 ${nameOf.get(c.user_id)}`, `한 일: ${c.did} / 막힘: ${c.blocked || '없음'} / 다음 주: ${c.next}`);
  }
  const missing = (members ?? [])
    .filter((m) => m.role === 'member' && !(checkins ?? []).some((c) => c.user_id === m.user_id))
    .map((m) => nameOf.get(m.user_id));

  const { data: tasks } = await admin.from('work_items').select('id, title, status, progress, due_date, owner_id, base_due, replan_count, measure')
    .eq('team_id', body.team_id).in('status', ['active', 'blocked', 'done']).not('parent_id', 'is', null)
    .gte('updated_at', new Date(Date.now() - 21 * 86400000).toISOString()).limit(50);
  const ST: Record<string, string> = { active: '진행', blocked: '막힘', done: '완료' };
  for (const t of tasks ?? []) {
    book.add('task', t.id, `과제 ${t.title}`, `상태 ${ST[t.status] ?? t.status}, 진척 ${t.progress}%, 마감 ${t.due_date ?? '-'}${t.base_due && t.due_date && t.base_due !== t.due_date ? ` (처음 계획 ${t.base_due})` : ''}, 담당 ${nameOf.get(t.owner_id) ?? '-'}`);
  }

  const { data: oos } = await admin.from('one_on_ones').select('id, member_id, scheduled_at, shared_notes')
    .eq('team_id', body.team_id).eq('status', 'done').gte('scheduled_at', week).lte('scheduled_at', `${weekEnd}T23:59:59Z`);
  for (const o of oos ?? []) book.add('one_on_one', o.id, `1:1 ${nameOf.get(o.member_id)} ${fmtDate(o.scheduled_at)}`, o.shared_notes);

  const { data: approved } = await admin.from('submissions').select('id, title, author_id')
    .eq('team_id', body.team_id).eq('status', 'approved').gte('approved_at', week);
  for (const s of approved ?? []) book.add('submission', s.id, `승인된 결과물`, `${s.title} (${nameOf.get(s.author_id)})`);

  const notes = (body.leader_notes ?? '').trim().slice(0, 4000);
  if (notes) book.add('leader_note', null, '팀장 메모', notes);
  if (book.size === 0) throw new HttpError(422, 'NO_DATA', '이번 주 체크인·과제 기록이 없습니다. 팀장 메모를 몇 줄 적으면 그것으로 초안을 씁니다.');
  await addKnowhow(book, body.team_id, 'report');

  const { output } = await runAi({
    teamId: body.team_id,
    kind: 'weekly_report',
    model: MODEL_SMART,
    system: WEEKLY_REPORT,
    content: [{ type: 'text', text: `팀: ${team?.name}\n미션: ${team?.mission}\n보고 주간: ${week} ~ ${weekEnd}\n체크인 미제출: ${missing.join(', ') || '없음'}\n\n${book.knowhowText()}\n\n${book.text('이번 주 기록')}` }],
    book,
    depth: depthOf(book.size, [4, 10, 20]),
    level: 'L1',
    createdBy: caller.userId,
    periodStart: week,
    periodEnd: weekEnd,
    maxTokens: 1400,
    extra: { missing, counts: book.byType(), leader_notes: notes || undefined },
  });
  return json(output);
});
