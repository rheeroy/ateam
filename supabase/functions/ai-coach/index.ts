// ATEAM 업무 피드백(코칭) — 팀장이 누르면 팀원의 최근 업무 기록에서 약한 면을 골라 초안을 쓴다 (형식 지시 없이 진단 + 점검 질문) (코어 AI, 팀장이 누를 때만)
//   초안은 팀장에게만 돌아가고, 팀장이 고쳐서 보내면 coaching_notes에 저장된다(여기서는 저장·발송하지 않음).
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader, must } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, fmtDate, weekLabel, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { COACH } from '../_shared/prompts/index.ts';

const DAY = 86400000;
const since = (d: number) => new Date(Date.now() - d * DAY).toISOString();

serve(async (req) => {
  const { team_id, member_id } = await readJson<{ team_id: string; member_id: string }>(req);
  if (!team_id || !member_id) throw new HttpError(400, 'MISSING_ID');
  const caller = await getCaller(req);
  await assertLeader(caller, team_id);
  const member = must(await admin.from('profiles').select('id, full_name').eq('id', member_id).maybeSingle());
  const today = new Date().toISOString().slice(0, 10);
  const book = new SourceBook();

  // 1) 결과물과 AI 리뷰 (판단 깊이 · 보완점)
  const { data: subs } = await admin.from('submissions').select('id, title, status, updated_at')
    .eq('team_id', team_id).eq('author_id', member_id).gte('updated_at', since(42)).order('updated_at', { ascending: false }).limit(6);
  const gapCount = new Map<string, number>();
  for (const s of subs ?? []) {
    const { data: vers } = await admin.from('submission_versions').select('id, version').eq('submission_id', s.id).order('version', { ascending: false }).limit(3);
    const { data: rvs } = await admin.from('ai_outputs').select('content').eq('kind', 'review').eq('ref_table', 'submission_versions').in('ref_id', (vers ?? []).map((v) => v.id)).order('created_at', { ascending: false }).limit(2);
    const rv = (rvs ?? [])[0]?.content as { depth_score?: number; gaps?: { section?: string; text: string }[]; summary?: string } | undefined;
    for (const g of rv?.gaps ?? []) { const k = (g.section ?? '').replace(/^§\d+\s*/, '') || g.text.slice(0, 12); gapCount.set(k, (gapCount.get(k) ?? 0) + 1); }
    book.add('submission', s.id, `결과물 '${s.title}'`, `상태 ${({ in_review: '리뷰 중', needs_work: '보완 요청', approved: '승인', shared: '공유' } as Record<string, string>)[s.status] ?? s.status} · ${fmtDate(s.updated_at)}`
      + (rv ? ` · AI 판단 깊이 ${rv.depth_score ?? '-'}/4 · 보완점: ${(rv.gaps ?? []).map((g) => `${g.section ? `${g.section} ` : ''}${g.text}`).join(' / ') || '없음'}` : '') + ` · 버전 ${(vers ?? []).length}개`);
  }
  const repeat = [...gapCount.entries()].filter(([, n]) => n >= 2);
  if (repeat.length) book.add('pattern', null, '반복되는 보완점', repeat.map(([k, n]) => `${k} ${n}회`).join(' / '));

  // 2) 맡은 과제 — 기한 지남 · 계획보다 늦음 · 막힘
  const { data: items } = await admin.from('work_items').select('id, title, status, progress, start_date, due_date, base_due, updated_at')
    .eq('team_id', team_id).eq('owner_id', member_id).in('status', ['active', 'blocked']).limit(20);
  for (const i of items ?? []) {
    const late = i.due_date && i.due_date < today ? Math.round((Date.parse(today) - Date.parse(i.due_date)) / DAY) : 0;
    const plan = i.start_date && i.due_date && i.due_date > i.start_date ? Math.min(100, Math.max(0, ((Date.now() - Date.parse(i.start_date)) / (Date.parse(i.due_date) - Date.parse(i.start_date))) * 100)) : null;
    const behind = plan != null ? Math.round(plan - i.progress) : 0;
    const quiet = Math.round((Date.now() - Date.parse(i.updated_at)) / DAY);
    if (late > 0 || behind >= 15 || i.status === 'blocked')
      book.add('task', i.id, `과제 '${i.title}'`, `진척 ${i.progress}%${plan != null ? ` (계획상 ${Math.round(plan)}%)` : ''} · 마감 ${i.due_date ?? '-'}${late ? ` · ${late}일 지남` : ''}${i.status === 'blocked' ? ' · 막힘' : ''} · 마지막 업데이트 ${quiet}일 전`);
  }

  // 3) 받은 요청 중 기한 넘긴 것
  const { data: reqs } = await admin.from('team_requests').select('id, title, due_date, status').eq('team_id', team_id).eq('to_id', member_id).eq('status', 'open').lt('due_date', today).limit(5);
  for (const r of reqs ?? []) book.add('request', r.id, `요청 '${r.title}'`, `기한 ${r.due_date} 지남 · 아직 답 없음`);

  // 4) (컨디션 공유는 코칭 근거로 쓰지 않는다 — 사람의 상태는 팀장만 보는 것)

  // 5) 최근에 보낸 코칭 — 같은 말 반복 피하기
  const { data: prev } = await admin.from('coaching_notes').select('title, created_at').eq('team_id', team_id).eq('member_id', member_id).gte('created_at', since(30)).order('created_at', { ascending: false }).limit(3);
  const prevText = (prev ?? []).map((p) => `${fmtDate(p.created_at)} "${p.title}"`).join(' / ');

  if (book.size === 0) throw new HttpError(422, 'NO_DATA', `${member.full_name} 님의 최근 업무 기록이 아직 적어 코칭할 점을 찾지 못했습니다.`);
  // 팀장님 업무 원칙: 팀원에게 공개한 '팀장 가이드'만 (공개 안 한 개인 노하우는 싣지 않음 — 팀원에게 그대로 보이는 글)
  await addKnowhow(book, team_id, 'review', 1200, true, false, '', true);
  // ATEAM 플레이북(컨설팅 DB): 이 팀원의 약한 면에 맞는 방법론 몇 장
  await addKnowhow(book, team_id, 'review', 1600, false, true, '', false);
  const playbook = book.knowhowText();
  const text = [
    `오늘: ${today} / 팀원: ${member.full_name}`,
    prevText ? `## 최근 30일에 이미 보낸 코칭 (같은 내용 반복 금지)\n${prevText}` : '',
    playbook,
    book.text('최근 업무 기록'),
  ].filter(Boolean).join('\n\n');
  const { output } = await runAi({
    teamId: team_id, kind: 'coaching', model: MODEL_SMART, system: COACH, content: [{ type: 'text', text }], book,
    depth: depthOf(book.size, [2, 4, 7]), level: 'L2', createdBy: caller.userId, subjectUserId: member_id, maxTokens: 1500,
  });
  // 본문이 비면(응답이 잘렸거나 형식이 깨짐) 빈 초안을 돌려주지 않는다
  const c = (output as { content?: { title?: string; body?: string } }).content;
  if (!c?.body?.trim()) throw new HttpError(502, 'AI_BAD_OUTPUT', '초안 본문이 비어 있습니다. 다시 만들기를 눌러 주세요.');
  return json(output);
});
