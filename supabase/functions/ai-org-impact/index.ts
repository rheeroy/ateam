// 위에서 온 것(조직·전사 메모) → 우리 팀 목표·과제·결정에 주는 영향 분석 (팀장 전용)
//   배포본(대시보드)에만 있던 함수를 소스로 되살림. 동작은 배포본과 같다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { ORG_IMPACT } from '../_shared/prompts/index.ts';
import { kstToday } from '../_shared/signals.ts';

const KIND: Record<string, string> = { strategy: '전략·방향 변경', exec: '임원 관심사', request: '상위 요청', peer: '유관 부서', calendar: '전사 일정', other: '기타' };
const ST: Record<string, string> = { proposed: '제안', changes_requested: '수정요청', active: '진행', blocked: '막힘', done: '완료' };

serve(async (req) => {
  const body = await readJson<{ team_id: string; note_id: string }>(req);
  if (!body.team_id || !body.note_id) throw new HttpError(400, 'MISSING_FIELDS');
  const caller = await getCaller(req);
  await assertLeader(caller, body.team_id);

  const { data: note } = await admin.from('org_notes').select('*').eq('id', body.note_id).eq('team_id', body.team_id).maybeSingle();
  if (!note) throw new HttpError(404, 'NOT_FOUND');
  const { data: team } = await admin.from('teams').select('name, mission, parent_link').eq('id', body.team_id).single();
  const { data: tm } = await admin.from('team_members').select('user_id, profiles(full_name)').eq('team_id', body.team_id).eq('status', 'active');
  const nameOf = new Map((tm ?? []).map((m) => [m.user_id, (m.profiles as unknown as { full_name: string })?.full_name ?? '']));

  const { data: items } = await admin.from('work_items').select('id, parent_id, owner_id, title, status, progress, due_date')
    .eq('team_id', body.team_id).not('status', 'in', '(dropped,done)').order('sort').limit(200);
  const all = items ?? [];
  const tops = all.filter((i) => !i.parent_id);
  const topIds = new Set(tops.map((t) => t.id));
  const second = all.filter((i) => i.parent_id && topIds.has(i.parent_id));

  const book = new SourceBook();
  const noteTag = book.add('org_note', note.id, `위에서 온 것 · ${KIND[note.kind] ?? note.kind}`,
    `${note.title}${note.source ? ` (출처: ${note.source})` : ''}${note.event_date ? ` · 일정 ${note.event_date}` : ''}\n${note.body ?? ''}`);
  const { data: others } = await admin.from('org_notes').select('id, kind, title, created_at').eq('team_id', body.team_id).eq('status', 'open').neq('id', note.id)
    .gte('created_at', new Date(Date.now() - 45 * 864e5).toISOString()).limit(5);
  for (const o of others ?? []) book.add('org_note', o.id, `최근 다른 소식 · ${KIND[o.kind] ?? o.kind}`, o.title);
  const { data: decs } = await admin.from('decisions').select('id, title, rationale, expected_outcome, decided_at').eq('team_id', body.team_id).order('decided_at', { ascending: false }).limit(6);
  for (const d of decs ?? []) book.add('decision', d.id, `최근 결정 · ${d.title}`, `근거: ${d.rationale || '-'} · 기대: ${d.expected_outcome || '-'} · ${String(d.decided_at).slice(0, 10)}`);
  await addKnowhow(book, body.team_id, 'briefing', 1200);

  const tree = tops.map((t) => {
    const kids = second.filter((s) => s.parent_id === t.id)
      .map((s) => `   - [${s.id}] ${s.title} · ${nameOf.get(s.owner_id ?? '') || '담당 없음'} · ${ST[s.status] ?? s.status} ${s.progress}%${s.due_date ? ` · 마감 ${s.due_date}` : ''}`);
    return [`- [${t.id}] ${t.title}${t.due_date ? ` (마감 ${t.due_date})` : ''}`, ...kids].join('\n');
  }).join('\n');

  const text = [
    `오늘: ${kstToday()} / 팀: ${team?.name} / 미션: ${team?.mission || '-'}${team?.parent_link ? ` / 상위 연결: ${team.parent_link}` : ''}`,
    `## 분석할 소식\n${noteTag} 를 중심으로 봅니다.`,
    `## 팀의 현재 목표·과제\n${tree || '(목표 없음)'}`,
    book.knowhowText(),
    book.text('소식과 최근 결정'),
  ].filter(Boolean).join('\n\n');

  const { output } = await runAi({
    teamId: body.team_id, kind: 'org_impact', model: MODEL_SMART, system: ORG_IMPACT,
    content: [{ type: 'text', text }], book,
    depth: Math.min(3, 1 + Math.floor(book.size / 4)), level: 'L2', createdBy: caller.userId,
    refTable: 'org_notes', refId: note.id, maxTokens: 900,
  });
  return json(output);
});
