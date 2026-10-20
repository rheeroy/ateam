// 평가 의견 초안 — 근거 원장 기반. 판단 근거가 기준 미만이면 AI를 부르지 않고 '판단 보류'.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader, assertFeature, must } from '../_shared/supabase.ts';
import { runAi, withhold, SourceBook, depthOf, fmtDate, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { EVALUATION } from '../_shared/prompts/index.ts';

const LABEL: Record<string, string> = {
  checkin: '컨디션 공유', one_on_one: '1on1', submission: '결과물', review_comment: '리뷰 코멘트',
  observation: '관찰 메모', leader_note: '팀장 메모', task: '과제', metric: '실적', decision: '의사결정', ai: 'AI 검토 신호',
};
const JUDGMENT = ['submission', 'observation', 'review_comment', 'leader_note', 'task'];

serve(async (req) => {
  const b = await readJson<{ team_id: string; member_id: string; period_start: string; period_end: string }>(req);
  if (!b.team_id || !b.member_id || !b.period_start || !b.period_end) throw new HttpError(400, 'MISSING_PARAMS');
  const caller = await getCaller(req);
  await assertLeader(caller, b.team_id);
  await assertFeature(b.team_id, 'evaluation');

  const member = must(await admin.from('team_members').select('job_title, profiles(full_name)')
    .eq('team_id', b.team_id).eq('user_id', b.member_id).maybeSingle());
  const name = (member.profiles as unknown as { full_name: string })?.full_name ?? '';
  const { data: team } = await admin.from('teams').select('settings').eq('id', b.team_id).single();
  const minEvidence = Number((team?.settings as Record<string, unknown>)?.min_judgment_evidence ?? 8);

  const { data: ev } = await admin.from('evidence')
    .select('id, source, competency, polarity, summary, occurred_at, provenance')
    .eq('team_id', b.team_id).eq('subject_user_id', b.member_id).neq('source', 'checkin')   // 컨디션은 평가 근거가 아니다
    .gte('occurred_at', b.period_start).lte('occurred_at', `${b.period_end}T23:59:59Z`)
    .order('occurred_at').limit(160);

  const book = new SourceBook();
  // 판단 근거를 먼저, 맥락(1on1)은 뒤에 요약 수준으로
  const judg = (ev ?? []).filter((e) => JUDGMENT.includes(e.source));
  const ctx = (ev ?? []).filter((e) => !JUDGMENT.includes(e.source)).slice(-40);
  for (const e of [...judg, ...ctx]) {
    book.add(e.source, e.id, `${LABEL[e.source] ?? e.source} ${fmtDate(e.occurred_at)}`,
      `${e.polarity !== 'neutral' ? `[${e.polarity}] ` : ''}${e.competency ? `(${e.competency}) ` : ''}${e.summary}${e.provenance === 'ai' ? ' — AI 신호' : ''}`);
  }

  const common = {
    teamId: b.team_id, kind: 'evaluation_draft' as const, book, depth: depthOf(judg.length, [4, 8, 16]),
    level: 'L3', createdBy: caller.userId, subjectUserId: b.member_id,
    refTable: 'profiles', refId: b.member_id, periodStart: b.period_start, periodEnd: b.period_end,
  };

  if (judg.length < minEvidence) {
    const out = await withhold(common, `판단 근거가 ${judg.length}건으로 기준(${minEvidence}건)에 못 미칩니다.`, {
      current: judg.length, required: minEvidence,
      suggestion: '결과물 리뷰나 관찰 메모를 남기면 근거가 쌓입니다.',
    });
    return json(out);
  }

  const { data: scores } = await admin.from('judgment_scores').select('score, scored_at')
    .eq('team_id', b.team_id).eq('user_id', b.member_id).gte('scored_at', b.period_start).order('scored_at');
  const { data: comps } = await admin.from('competencies').select('name')
    .or(`team_id.is.null,team_id.eq.${b.team_id}`).order('sort');
  await addKnowhow(book, b.team_id, 'evaluation');
  const trend = (scores ?? []).map((s) => `${fmtDate(s.scored_at)}:${s.score}`).join(', ');

  const { output } = await runAi({
    ...common,
    model: MODEL_SMART,
    system: EVALUATION,
    content: [{ type: 'text', text: [
      `팀원: ${name} (${member.job_title})`,
      `평가 기간: ${b.period_start} ~ ${b.period_end}`,
      `역량 목록: ${(comps ?? []).map((c) => c.name).join(', ')}`,
      `판단 깊이 추이(모델 기록): ${trend || '없음'}`,
      book.knowhowText(),
      book.text('근거'),
    ].join('\n') }],
    maxTokens: 2200,
    extra: { evidence_counts: book.byType(), judgment_evidence: judg.length },
  });
  return json(output);
});
