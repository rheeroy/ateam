// 팀원 컨디션 공유 초안 — 이번 주 앱 기록(결과물 · 진척 · 마무리 · 요청 · 피드백 · 지난주 계획)으로 '한 일 · 막힌 일 · 다음 주'를 채운다 (코어 AI, 본인에게만)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { runAi, SourceBook } from '../_shared/gateway.ts';
import { MODEL_FAST } from '../_shared/anthropic.ts';
import { CHECKIN_DRAFT } from '../_shared/prompts/index.ts';
import { kstToday, kstMonday, addDaysYmd } from '../_shared/signals.ts';

serve(async (req) => {
  const { team_id } = await readJson<{ team_id: string }>(req);
  if (!team_id) throw new HttpError(400, 'MISSING_TEAM');
  const caller = await getCaller(req);
  if (!caller.userId) throw new HttpError(403, 'forbidden');
  const uid = caller.userId;
  const { data: m } = await admin.from('team_members').select('role').eq('team_id', team_id).eq('user_id', uid).eq('status', 'active').maybeSingle();
  if (!m) throw new HttpError(403, 'forbidden');
  const mon = kstMonday(), today = kstToday();
  const from = new Date(Date.parse(`${mon}T00:00:00+09:00`)).toISOString();
  const book = new SourceBook();

  const { data: last } = await admin.from('checkins').select('id, week_start, next').eq('team_id', team_id).eq('user_id', uid).lt('week_start', mon).order('week_start', { ascending: false }).limit(1).maybeSingle();
  if (last?.next?.trim()) book.add('checkin', last.id, '지난주에 적은 다음 주 할 일', last.next);

  const { data: subs } = await admin.from('submissions').select('id, title, status, updated_at, submission_versions(version, note, created_at)').eq('team_id', team_id).eq('author_id', uid).gte('updated_at', from).limit(8);
  for (const s of subs ?? []) {
    const vs = ((s.submission_versions ?? []) as { version: number; note: string; created_at: string }[]).filter((v) => v.created_at >= from);
    book.add('submission', s.id, `결과물 '${s.title}'`, `상태 ${({ in_review: '리뷰 중', needs_work: '보완 요청 받음', approved: '승인', shared: '공유' } as Record<string, string>)[s.status] ?? s.status}${vs.length ? ` · 이번 주 올린 버전 ${vs.map((v) => `v${v.version}${v.note ? `(${v.note})` : ''}`).join(', ')}` : ''}`);
  }
  const { data: items } = await admin.from('work_items').select('id, title, status, progress, due_date, done_at, updated_at').eq('team_id', team_id).eq('owner_id', uid).neq('status', 'dropped');
  const { data: logs } = await admin.from('work_item_logs').select('item_id, kind, value, done, note, created_at').eq('team_id', team_id).eq('author_id', uid).gte('created_at', from);
  for (const i of items ?? []) {
    const ls = (logs ?? []).filter((l) => l.item_id === i.id);
    const doneNow = i.status === 'done' && (i.done_at ?? i.updated_at) >= from;
    const soon = i.due_date && i.due_date <= addDaysYmd(today, 10) && i.status !== 'done';
    if (!ls.length && !doneNow && !soon && i.status !== 'blocked') continue;
    book.add('task', i.id, `과제 '${i.title}'`, [
      doneNow ? '이번 주 마무리' : `진척 ${i.progress}%`,
      ls.length ? `이번 주 기록 ${ls.map((l) => l.note || (l.kind === 'progress' ? `${l.value}%` : l.kind === 'recurring' ? '정기 완료' : `${l.value ?? ''}`)).filter(Boolean).join(', ')}` : '',
      i.status === 'blocked' ? '막힘' : '',
      i.due_date ? `마감 ${i.due_date}${i.due_date < today && i.status !== 'done' ? ' (지남)' : ''}` : '',
    ].filter(Boolean).join(' · '));
  }
  const { data: reqs } = await admin.from('team_requests').select('id, title, status, response, responded_at, due_date').eq('team_id', team_id).eq('to_id', uid)
    .or(`responded_at.gte.${from},status.eq.open`).limit(8);
  for (const r of reqs ?? []) book.add('request', r.id, `팀장 요청 '${r.title}'`, r.status === 'done' ? `이번 주 답함${r.response ? ` — ${r.response}` : ''}` : `아직 열림${r.due_date ? ` · 기한 ${r.due_date}` : ''}`);
  const { data: acts } = await admin.from('action_items').select('id, title, done_at, due_date').eq('team_id', team_id).eq('owner_id', uid).or(`done_at.gte.${from},done_at.is.null`).limit(8);
  for (const a of acts ?? []) book.add('promise', a.id, `1on1 약속 '${a.title}'`, a.done_at ? '이번 주 완료' : `남음${a.due_date ? ` · ${a.due_date}` : ''}`);

  if (book.size === 0) throw new HttpError(422, 'NO_DATA', '이번 주 앱에 남은 기록이 아직 없어 초안을 만들지 못했습니다. 직접 적어 주세요.');
  const { output } = await runAi({
    teamId: team_id, kind: 'checkin_draft', model: MODEL_FAST, system: CHECKIN_DRAFT,
    content: [{ type: 'text', text: `이번 주: ${mon} ~ ${addDaysYmd(mon, 6)} / 오늘 ${today}\n\n${book.text('이번 주 기록')}` }], book,
    depth: 1, level: 'L1', createdBy: uid, subjectUserId: uid, visibility: 'subject', periodStart: mon, maxTokens: 800,
  });
  return json(output);
});
