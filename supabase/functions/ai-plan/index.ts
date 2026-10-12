// 목표·과제 계획 AI
//  · draft : 계획서·업무 분장·메모를 읽고 목표 > 과제 > 할 일 초안 (팀장: 프리미엄 2크레딧 / 상위 항목 아래 초안: 코어)
//  · edit  : "제안서 마감 2주 미루고 김도현에게 넘겨줘" 같은 말을 변경안(ops)으로 (코어)
// 결과는 '제안'이다. 화면에서 팀장(또는 팀원)이 항목별로 수락해야 반영된다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { runAi, SourceBook, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART, toBase64, type Block } from '../_shared/anthropic.ts';
import { PLAN_DRAFT, PLAN_EDIT } from '../_shared/prompts/index.ts';
import { kstToday } from '../_shared/signals.ts';

interface Body { team_id: string; mode: 'draft' | 'edit'; text?: string; file_path?: string; parent_id?: string | null; instruction?: string }
interface Item { id: string; parent_id: string | null; owner_id: string | null; title: string; status: string; measure: string; progress: number; start_date: string | null; due_date: string | null; num_target: number | null; unit: string }

const ST: Record<string, string> = { proposed: '제안', changes_requested: '수정요청', active: '진행', blocked: '막힘', done: '완료' };

serve(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.team_id || !['draft', 'edit'].includes(body.mode)) throw new HttpError(400, 'MISSING_FIELDS');
  const caller = await getCaller(req);
  const { data: me } = await admin.from('team_members').select('role').eq('team_id', body.team_id).eq('user_id', caller.userId!).eq('status', 'active').maybeSingle();
  if (!me) throw new HttpError(403, 'forbidden');
  const leader = me.role === 'leader';

  const { data: team } = await admin.from('teams').select('name, mission, settings').eq('id', body.team_id).single();
  const levels = ((team?.settings as Record<string, unknown>)?.level_names as string[] | undefined) ?? ['목표', '과제', '할 일'];
  const { data: tm } = await admin.from('team_members').select('user_id, job_title, profiles(full_name)').eq('team_id', body.team_id).eq('status', 'active');
  const people = (tm ?? []).map((m) => ({ id: m.user_id, name: (m.profiles as unknown as { full_name: string })?.full_name ?? '', job: m.job_title }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const { data: all } = await admin.from('work_items')
    .select('id, parent_id, owner_id, title, status, measure, progress, start_date, due_date, num_target, unit')
    .eq('team_id', body.team_id).neq('status', 'dropped').order('sort').limit(400);
  const items = (all ?? []) as Item[];

  // 범위: 팀장은 전체(또는 지정한 상위 항목 아래), 팀원은 본인이 담당한 상위 항목 아래만
  let scopeRoot: Item | null = null;
  if (body.parent_id) {
    scopeRoot = items.find((i) => i.id === body.parent_id) ?? null;
    if (!scopeRoot) throw new HttpError(404, 'NOT_FOUND');
  }
  const memberOwn = !leader && !scopeRoot && body.mode === 'edit';
  if (!leader && !memberOwn) {
    if (!scopeRoot) throw new HttpError(403, 'forbidden', '팀원은 담당 항목 아래에서만 AI 계획 초안을 쓸 수 있습니다');
    const { data: rq } = await admin.from('team_requests').select('id').eq('team_id', body.team_id).eq('to_id', caller.userId!).eq('item_id', scopeRoot.id).limit(1);
    if (scopeRoot.owner_id !== caller.userId && !rq?.length) throw new HttpError(403, 'forbidden');
  }
  const inScope = (id: string): boolean => {
    if (memberOwn) {   // 팀원의 '말로 고치기': 내가 담당한 항목과 그 아래만
      let cur = items.find((i) => i.id === id);
      while (cur) { if (cur.owner_id === caller.userId) return true; cur = items.find((i) => i.id === cur!.parent_id); }
      return false;
    }
    if (!scopeRoot) return true;
    let cur = items.find((i) => i.id === id);
    while (cur) { if (cur.id === scopeRoot.id) return true; cur = items.find((i) => i.id === cur!.parent_id); }
    return false;
  };
  const depthOf = (i: Item) => { let d = 0; let c = i; while (c.parent_id) { d++; c = items.find((x) => x.id === c.parent_id) ?? { ...c, parent_id: null }; } return d; };
  const tree = items.filter((i) => inScope(i.id))
    .map((i) => `${'  '.repeat(depthOf(i))}[${i.id}] ${levels[Math.min(depthOf(i), levels.length - 1)]} · ${i.title} · ${ST[i.status] ?? i.status} · 담당 ${nameOf.get(i.owner_id ?? '') || '-'} · ${i.start_date ?? ''}~${i.due_date ?? ''} · 진척 ${i.progress}%${i.num_target != null ? ` · 목표 ${i.num_target}${i.unit}` : ''}`)
    .join('\n');

  const book = new SourceBook();
  await addKnowhow(book, body.team_id, 'plan', 2000, !leader);
  const content: Block[] = [];
  const header = [
    `오늘: ${kstToday()}`, `팀: ${team?.name} / 미션: ${team?.mission || '-'}`,
    `단계 이름: ${levels.join(' > ')}`,
    `팀원: ${people.map((p) => `${p.name}(${p.job || '-'})`).join(', ')}`,
    !leader ? `요청한 사람: ${nameOf.get(caller.userId!)} (본인을 담당자로 둡니다)` : '',
    scopeRoot ? `상위 항목: [${scopeRoot.id}] ${scopeRoot.title} — 이 아래만 다룹니다` : '',
    book.knowhowText(),
    `## 현재 목표·과제\n${tree || '(없음)'}`,
  ].filter(Boolean).join('\n\n');

  if (body.mode === 'draft') {
    if (body.file_path) {
      if (!leader || !body.file_path.startsWith(`${body.team_id}/`)) throw new HttpError(403, 'forbidden');
      const { data: file, error } = await admin.storage.from('knowhow').download(body.file_path);
      if (error) throw error;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE');
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) }, title: '계획 자료' });
    } else if (!body.text?.trim()) throw new HttpError(422, 'NO_TEXT', '자료 내용이 비어 있습니다');
    content.push({ type: 'text', text: `${header}\n\n## 자료\n${(body.text ?? '(첨부 PDF)').slice(0, 50000)}` });
  } else {
    if (!body.instruction?.trim()) throw new HttpError(422, 'NO_TEXT', '무엇을 바꿀지 적어 주세요');
    content.push({ type: 'text', text: `${header}\n\n## 지시\n${body.instruction.slice(0, 2000)}` });
  }

  const scoped = body.mode === 'draft' && !!scopeRoot;
  const { output } = await runAi({
    teamId: body.team_id, kind: body.mode === 'draft' ? 'plan_draft' : 'plan_edit', model: MODEL_SMART,
    system: body.mode === 'draft' ? PLAN_DRAFT : PLAN_EDIT, content, book, depth: 1, level: 'L1',
    createdBy: caller.userId, credits: scoped ? 0 : undefined, refTable: scopeRoot ? 'work_items' : undefined, refId: scopeRoot?.id,
    visibility: leader ? 'leader' : 'subject', maxTokens: 3500,
    extra: { scope: scopeRoot?.id ?? null, people: people.map((p) => ({ id: p.id, name: p.name })) },
  });
  return json(output);
});
