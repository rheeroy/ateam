// 해석 전용 함수 — 숫자는 SQL 모델(또는 결정론적 시뮬레이터)이 내고, AI는 그 의미만 풀어 쓴다.
// kind: forecast_note | strategy_check | scenario_note
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader, assertFeature, must } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_FAST, MODEL_SMART } from '../_shared/anthropic.ts';
import { FORECAST_NOTE, STRATEGY_CHECK, SCENARIO_NOTE } from '../_shared/prompts/index.ts';

type Body =
  | { kind: 'forecast_note'; team_id: string; metric_id: string }
  | { kind: 'strategy_check'; team_id: string }
  | { kind: 'scenario_note'; team_id: string; scenario_id: string };

serve(async (req) => {
  const b = await readJson<Body>(req);
  if (!b.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const caller = await getCaller(req);
  await assertLeader(caller, b.team_id);
  const book = new SourceBook();

  if (b.kind === 'forecast_note') {
    await assertFeature(b.team_id, 'forecast');
    const metric = must(await admin.from('metrics').select('id, team_id, name').eq('id', b.metric_id).maybeSingle());
    if (metric.team_id !== b.team_id) throw new HttpError(403, 'forbidden');
    const { data: fc, error } = await admin.rpc('metric_forecast', { p_metric: b.metric_id });
    if (error) throw error;
    if (fc.insufficient) throw new HttpError(422, 'INSUFFICIENT_DATA', '실적이 2개월 이상 쌓여야 해석할 수 있습니다');
    book.add('metric', metric.id, `실적 전망 · ${metric.name}`, JSON.stringify({ ...fc, series: undefined }));
    const { data: pipe } = await admin.from('metric_pipeline').select('id, label, amount, probability').eq('metric_id', metric.id).eq('closed', false);
    for (const p of pipe ?? []) book.add('pipeline', p.id, `진행 중 딜 ${p.label}`, `금액 ${p.amount}, 확률 ${p.probability}`);
    const { output } = await runAi({
      teamId: b.team_id, kind: 'forecast_note', model: MODEL_FAST, system: FORECAST_NOTE,
      content: [{ type: 'text', text: book.text('모델 계산 결과') }], book,
      depth: depthOf(fc.months_of_data, [2, 4, 6]), level: 'L4', createdBy: caller.userId,
      refTable: 'metrics', refId: metric.id, maxTokens: 500,
    });
    return json(output);
  }

  if (b.kind === 'strategy_check') {
    await assertFeature(b.team_id, 'strategy');
    const { data: team } = await admin.from('teams').select('mission, parent_link').eq('id', b.team_id).single();
    const { data: goals } = await admin.rpc('goal_outlook', { p_team: b.team_id });
    if (!goals?.length) throw new HttpError(422, 'NO_GOALS', '전략 목표를 먼저 등록해 주세요');
    for (const g of goals) book.add('goal', g.goal_id, `전략 목표 · ${g.title}`, `진척 ${g.progress}%, 달성 전망 ${g.probability ?? '계산 불가'}% (근거: ${g.basis}), 막힌 과제 ${g.blocked}건`);
    const { data: port } = await admin.rpc('task_portfolio', { p_team: b.team_id });
    for (const t of port ?? []) book.add('task', t.task_id, `과제 · ${t.title}`, `팀 시간 비중 ${t.share_pct ?? 0}%, 미션 기여도 ${t.mission_contribution}/5, 연결 목표 ${goals.find((g: { goal_id: string }) => g.goal_id === t.goal_id)?.title ?? '없음'}`);
    const { data: hyps } = await admin.from('hypotheses').select('id, statement, signal, status').eq('team_id', b.team_id);
    for (const h of hyps ?? []) book.add('hypothesis', h.id, `가설`, `${h.statement} — 신호: ${h.signal} (${h.status})`);
    const { data: decs } = await admin.from('decisions').select('id, title, expected_outcome, outcome_rating').eq('team_id', b.team_id).order('decided_at', { ascending: false }).limit(5);
    for (const d of decs ?? []) book.add('decision', d.id, `최근 의사결정`, `${d.title} — 기대: ${d.expected_outcome} / 결과: ${d.outcome_rating ?? '미기록'}`);
    await addKnowhow(book, b.team_id, 'strategy');
    const { output } = await runAi({
      teamId: b.team_id, kind: 'strategy_check', model: MODEL_SMART, system: STRATEGY_CHECK,
      content: [{ type: 'text', text: `팀 미션: ${team?.mission}\n상위 연결: ${team?.parent_link}\n\n${book.knowhowText()}\n\n${book.text('현황 (모델 계산 포함)')}` }],
      book, depth: depthOf(book.size, [4, 10, 18]), level: 'L4', createdBy: caller.userId, maxTokens: 900,
    });
    return json(output);
  }

  if (b.kind === 'scenario_note') {
    await assertFeature(b.team_id, 'simulation');
    const sc = must(await admin.from('scenarios').select('*').eq('id', b.scenario_id).maybeSingle());
    if (sc.team_id !== b.team_id) throw new HttpError(403, 'forbidden');
    book.add('scenario', sc.id, `시나리오 · ${sc.name}`, `입력: ${JSON.stringify(sc.inputs)}\n결과: ${JSON.stringify(sc.results)}`);
    await addKnowhow(book, b.team_id, 'scenario', 1200);
    const { output } = await runAi({
      teamId: b.team_id, kind: 'scenario_note', model: MODEL_FAST, system: SCENARIO_NOTE,
      content: [{ type: 'text', text: `${book.knowhowText()}\n\n${book.text('시뮬레이터 계산 결과')}` }], book,
      depth: 2, level: 'L4', createdBy: caller.userId, refTable: 'scenarios', refId: sc.id, maxTokens: 700,
    });
    return json(output);
  }

  throw new HttpError(400, 'UNKNOWN_KIND');
});
