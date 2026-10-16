// 1:1 준비 노트 — 지난 면담 이후 바뀐 것, 남은 약속, 오늘 물어볼 질문
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader, must } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, fmtDate, weekLabel, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { PREP } from '../_shared/prompts/index.ts';
import { NOTE_RULE, addLeaderNotes } from '../_shared/notes.ts';

serve(async (req) => {
  const { one_on_one_id } = await readJson<{ one_on_one_id: string }>(req);
  if (!one_on_one_id) throw new HttpError(400, 'MISSING_ID');
  const caller = await getCaller(req);

  const oo = must(await admin.from('one_on_ones').select('*').eq('id', one_on_one_id).maybeSingle());
  await assertLeader(caller, oo.team_id);

  const member = must(await admin.from('profiles').select('id, full_name').eq('id', oo.member_id).maybeSingle());
  const book = new SourceBook();

  // 지난 1:1 (완료된 것 중 가장 최근)
  const { data: last } = await admin
    .from('one_on_ones')
    .select('id, scheduled_at, shared_notes')
    .eq('team_id', oo.team_id).eq('member_id', oo.member_id).eq('status', 'done')
    .lt('scheduled_at', oo.scheduled_at)
    .order('scheduled_at', { ascending: false }).limit(1).maybeSingle();
  const since = last?.scheduled_at ?? new Date(Date.now() - 28 * 86400000).toISOString();
  if (last) {
    book.add('one_on_one', last.id, `지난 1:1 ${fmtDate(last.scheduled_at)}`, last.shared_notes || '(노트 없음)');
    const { data: priv } = await admin.from('one_on_one_private').select('notes').eq('one_on_one_id', last.id).maybeSingle();
    if (priv?.notes) book.add('leader_note', last.id, `팀장 메모 ${fmtDate(last.scheduled_at)}`, priv.notes);
  }

  const { data: checkins } = await admin
    .from('checkins').select('id, week_start, did, blocked, next, condition')
    .eq('team_id', oo.team_id).eq('user_id', oo.member_id).gte('week_start', since.slice(0, 10))
    .order('week_start').limit(6);
  for (const c of checkins ?? []) {
    book.add('checkin', c.id, `체크인 ${weekLabel(c.week_start)}`,
      `한 일: ${c.did} / 막힘: ${c.blocked || '없음'} / 다음: ${c.next} / 컨디션: ${c.condition ?? '-'}`);
  }

  const { data: items } = await admin
    .from('action_items').select('id, title, owner_id, due_date, done_at')
    .eq('team_id', oo.team_id).is('done_at', null)
    .in('owner_id', [oo.leader_id, oo.member_id]).limit(10);
  const today = new Date().toISOString().slice(0, 10);
  for (const a of items ?? []) {
    const who = a.owner_id === oo.leader_id ? '팀장' : '팀원';
    book.add('action_item', a.id, `약속 · ${who}`, `${a.title} (기한 ${a.due_date ?? '없음'}${a.due_date && a.due_date < today ? ', 기한 지남' : ''})`);
  }

  const { data: subs } = await admin
    .from('submissions').select('id, title, status, updated_at')
    .eq('team_id', oo.team_id).eq('author_id', oo.member_id).gte('updated_at', since)
    .order('updated_at', { ascending: false }).limit(3);
  for (const s of subs ?? []) {
    const { data: vers } = await admin.from('submission_versions').select('id').eq('submission_id', s.id);
    const { data: rv } = await admin.from('ai_outputs').select('content')
      .eq('ref_table', 'submission_versions').in('ref_id', (vers ?? []).map((v) => v.id)).eq('kind', 'review')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const summary = (rv?.content as { summary?: string } | undefined)?.summary ?? '';
    book.add('submission', s.id, `결과물 · ${s.title}`, `상태 ${s.status}. ${summary}`);
  }

  const { data: obs } = await admin
    .from('observations').select('id, kind, body, occurred_at')
    .eq('team_id', oo.team_id).eq('subject_id', oo.member_id).gte('occurred_at', since.slice(0, 10)).limit(5);
  for (const o of obs ?? []) book.add('observation', o.id, `관찰 메모 ${fmtDate(o.occurred_at)}`, `[${o.kind}] ${o.body}`);
  // 팀장 개인 메모 — 이 팀원(또는 이 1:1)에 붙이고 AI 참고를 허용한 것
  await addLeaderNotes(book, oo.team_id, oo.leader_id, { types: ['member', 'one_on_one'], ids: [oo.member_id, oo.id], limit: 6, nameOf: () => member.full_name });

  // 담당 목표·과제 (계획 대비)
  const { data: its } = await admin.from('work_items').select('id, title, status, progress, due_date, base_due, replan_count, needs_plan')
    .eq('team_id', oo.team_id).eq('owner_id', oo.member_id).in('status', ['proposed', 'changes_requested', 'active', 'blocked']).limit(15);
  const ST: Record<string, string> = { proposed: '팀장 검토 대기', changes_requested: '수정 요청됨', active: '진행', blocked: '막힘' };
  for (const it of its ?? []) {
    book.add('task', it.id, `담당 항목 · ${it.title}`, `${ST[it.status] ?? it.status}, 진척 ${it.progress}%, 마감 ${it.due_date ?? '-'}${it.base_due && it.due_date && it.base_due !== it.due_date ? ` (처음 계획 ${it.base_due}, 변경 ${it.replan_count}회)` : ''}${it.needs_plan ? ', 하위 계획 요청 중' : ''}`);
  }
  await addKnowhow(book, oo.team_id, 'prep');
  const prompt = `팀원: ${member.full_name}\n면담 일시: ${oo.scheduled_at}\n\n${book.knowhowText()}\n\n${book.text('기록')}`;
  const { output } = await runAi({
    teamId: oo.team_id,
    kind: 'one_on_one_prep',
    model: MODEL_SMART,
    system: PREP + NOTE_RULE,
    content: [{ type: 'text', text: prompt }],
    book,
    depth: depthOf(book.size, [3, 6, 10]),
    level: book.byType()['checkin'] >= 2 ? 'L2' : 'L1',
    createdBy: caller.userId,
    subjectUserId: oo.member_id,
    refTable: 'one_on_ones',
    refId: oo.id,
    maxTokens: 1200,
  });
  return json(output);
});
