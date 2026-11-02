// 팀원이 대화에서 물은 결정 — 후보(DB가 표현으로 걸러 둔 것)를 모아 진짜 결정 요청인지 가린다
//   팀장이 의사결정 화면을 열 때 후보가 있으면 부른다. 한 번에 최대 25건 · 빠른 모델 · 코어 AI(크레딧 없음)
//   결과: decision_asks.status = 'ask'(보드에 올림) 또는 'not', ai = { title, options, due }
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { runAi, SourceBook } from '../_shared/gateway.ts';
import { MODEL_FAST } from '../_shared/anthropic.ts';

const PROMPT = `과제: 팀원이 업무 대화에 쓴 글(번호 붙음)을 읽고, 각 글이 '팀장이 골라 주거나 정해 줘야 다음으로 갈 수 있는 결정 요청'인지 가립니다.
- 결정 요청: 두 가지 이상 중 고르기, 진행 여부 승인, 범위 · 일정 · 예산 · 방향을 정해 달라는 것.
- 결정 요청이 아님: 단순 보고 · 공유 · 감사 · 일정 알림, 자료 요청, 팀장 말고 다른 사람에게 묻는 것, 이미 스스로 정했다고 알리는 것, 가벼운 잡담.
- 애매하면 결정 요청이 아닌 것으로 봅니다.
결정 요청이면:
- title: 팀장이 정할 것을 한 줄로. "~할지" 꼴, 40자 안. 글에 없는 내용을 보태지 않습니다.
- options: 글에 나온 선택지만 (없으면 빈 배열, 최대 3개, 각 30자 안). 지어내지 않습니다.
- due: 글에 기한이 있으면 그대로 짧게 (예: "금요일까지"), 없으면 null.
출력 JSON: { "results": [{ "n": 번호, "ask": true/false, "title": "...", "options": ["..."], "due": null }] }`;

type Out = { results?: { n?: number; ask?: boolean; title?: string; options?: string[]; due?: string | null }[] };

serve(async (req) => {
  const body = await readJson<{ team_id?: string }>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const teamId = body.team_id;
  const caller = await getCaller(req);
  if (!caller.isService) {
    const { data: m } = await admin.from('team_members').select('role, status').eq('team_id', teamId).eq('user_id', caller.userId!).maybeSingle();
    if (!m || m.status !== 'active' || m.role !== 'leader') throw new HttpError(403, 'forbidden');
  }

  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data: rows, error } = await admin.from('decision_asks').select('id, body, created_at').eq('team_id', teamId).eq('status', 'candidate')
    .gte('created_at', since).order('created_at').limit(25);
  if (error) throw error;
  if (!rows?.length) return json({ checked: 0, asks: 0 });

  const text = rows.map((r, i) => `[${i + 1}] ${r.body.replace(/\s+/g, ' ').trim().slice(0, 600)}`).join('\n');
  const { parsed } = await runAi<Out>({
    teamId, kind: 'decision_asks', model: MODEL_FAST, system: PROMPT, content: [{ type: 'text', text: `## 팀원이 쓴 글\n${text}` }], book: new SourceBook(),
    depth: 1, level: 'L1', createdBy: caller.userId, visibility: 'leader', credits: 0, force: true,
    maxTokens: 2000, timeoutMs: 60_000, thinking: 'fast', effort: 'low',
  });

  const by = new Map((parsed.results ?? []).map((r) => [Number(r.n), r]));
  const now = new Date().toISOString();
  let asks = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = by.get(i + 1);
    const ok = !!r?.ask && !!r.title?.trim();
    if (ok) asks++;
    await admin.from('decision_asks').update(ok
      ? { status: 'ask', classified_at: now, ai: { title: r!.title!.trim().slice(0, 60), options: (r!.options ?? []).filter((o) => typeof o === 'string' && o.trim()).slice(0, 3).map((o) => o.trim().slice(0, 40)), due: r!.due ?? null } }
      : { status: 'not', classified_at: now })
      .eq('id', rows[i].id).eq('status', 'candidate');   // 그사이 팀장이 답했으면 그대로 둔다
  }
  return json({ checked: rows.length, asks });
});
