#!/usr/bin/env node
// ATEAM 플레이북 — supabase/playbook/playbook.json 하나로
//   ① supabase/migrations/20261107000034_playbook.sql  ② supabase/dashboard/29_playbook.sql  ③ docs/PLAYBOOK.md 를 만든다.
// 카드 내용을 고칠 때는 playbook.json 만 고치고 `node scripts/build-playbook.mjs` 를 다시 돌린다.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pb = JSON.parse(readFileSync(join(root, 'supabase/playbook/playbook.json'), 'utf8'));

// ---------- 검사 ----------
const KINDS = ['principle', 'rubric', 'framework', 'context', 'coaching', 'glossary'];
const FEATURES = ['review', 'prep', 'report', 'briefing', 'strategy', 'scenario', 'plan']; // evaluation 은 넣지 않는다 (평가에는 플레이북을 쓰지 않음)
const domains = pb.domains.map((d) => d.key);
const errs = [];
const seen = new Set();
for (const c of pb.cards) {
  const at = `[${c.key}]`;
  if (seen.has(c.key)) errs.push(`${at} key 중복`); seen.add(c.key);
  if (!domains.includes(c.domain)) errs.push(`${at} domain ${c.domain}`);
  if (!KINDS.includes(c.kind)) errs.push(`${at} kind ${c.kind}`);
  if (![1, 2].includes(c.tier)) errs.push(`${at} tier`);
  if (!['field', 'global'].includes(c.origin_type)) errs.push(`${at} origin_type`);
  for (const f of c.applies_to) if (!FEATURES.includes(f)) errs.push(`${at} applies_to ${f}`);
  if (!c.applies_to.length) errs.push(`${at} applies_to 비어 있음`);
  if (c.title.length > 30) errs.push(`${at} title ${c.title.length}자`);
  if (c.body.length > 260) errs.push(`${at} body ${c.body.length}자`);
  if (c.rules.length < 2 || c.rules.length > 4) errs.push(`${at} rules ${c.rules.length}개`);
  for (const r of c.rules) if (r.length > 40) errs.push(`${at} rule '${r}' ${r.length}자`);
  for (const k of ['situation', 'why', 'bad', 'good', 'origin']) if (!c[k]) errs.push(`${at} ${k} 비어 있음`);
}
if (errs.length) { console.error(errs.join('\n')); process.exit(1); }

// ---------- SQL ----------
const s = (v) => `'${String(v).replace(/'/g, "''")}'`;
const arr = (a) => `array[${a.map(s).join(', ')}]::text[]`;
const sortOf = (c) => (domains.indexOf(c.domain) + 1) * 100 + pb.cards.filter((x) => x.domain === c.domain).indexOf(c) + 1;
const rows = pb.cards.map((c) => `  (${[s(c.key), s(c.domain), `${s(c.kind)}::public.knowhow_kind`, c.tier, s(c.title), s(c.body), `${s(JSON.stringify(c.rules))}::jsonb`,
  arr(c.applies_to), arr(c.keywords), sortOf(c), s(c.situation), s(c.why), s(c.bad), s(c.good), s(c.origin), s(c.origin_type)].join(', ')})`).join(',\n');

const nGlobal = pb.cards.filter((c) => c.origin_type === 'global').length;
const nField = pb.cards.length - nGlobal;

const body = `-- =====================================================================
-- ATEAM · 0034 ATEAM 플레이북 (컨설팅 기준 카드 확장 · ${pb.version})
--   · 기본 제공 카드를 ${pb.cards.length}장(${domains.length}개 영역)으로 늘린다: 현장 컨설팅 기준 ${nField} + 글로벌 방법론 ${nGlobal}
--     영역: ${pb.domains.map((d) => d.label).join(' · ')}
--   · 카드 원본(knowhow_templates)에 화면용 정보를 더한다: 영역 · 대표 여부 · 언제 쓰나 · 왜 효과적인가 · 나쁜 예/좋은 예 · 출처
--   · 팀장이 고치지 않은 기존 카드는 새 문안으로 바꾸고, 고친 카드는 그대로 둔다 (켜기/끄기·반영할 곳·공개 설정도 그대로)
--   · 모든 팀에 새 카드를 넣는다. Starter 팀은 기존 규칙대로 꺼진 채로 들어간다 (Pro부터 AI가 사용)
--   · 데모 팀에는 적용 이력과 AI 검토 기록을 함께 채운다 (seed_demo_playbook)
--   · 내부 이름(source = 'consulting', 기능 consulting_knowhow)은 그대로 둔다 — 화면 이름만 'ATEAM 플레이북'
-- 16_consulting_knowhow.sql 을 실행한 프로젝트에서 Run. 다시 Run 해도 안전합니다.
-- 원본: supabase/playbook/playbook.json → node scripts/build-playbook.mjs
-- =====================================================================

do $$ begin
  if to_regclass('public.knowhow_templates') is null then
    raise exception '먼저 16_consulting_knowhow.sql 을 실행해 주세요 (knowhow_templates 가 없습니다)';
  end if;
end $$;

-- ---------- 원본에 화면용 정보 ----------
alter table public.knowhow_templates add column if not exists domain text not null default 'goal';
alter table public.knowhow_templates add column if not exists tier smallint not null default 2;          -- 1 = 대표 방법론 (AI가 먼저 고려)
alter table public.knowhow_templates add column if not exists situation text not null default '';      -- 언제 쓰나
alter table public.knowhow_templates add column if not exists why text not null default '';            -- 왜 효과적인가
alter table public.knowhow_templates add column if not exists example_bad text not null default '';
alter table public.knowhow_templates add column if not exists example_good text not null default '';
alter table public.knowhow_templates add column if not exists origin text not null default '';         -- 출처·참고
alter table public.knowhow_templates add column if not exists origin_type text not null default 'field'; -- field = 현장 컨설팅 · global = 글로벌 방법론

-- ---------- 새 원본 ----------
drop table if exists pg_temp._pb;
create temp table _pb (
  key text primary key, domain text, kind public.knowhow_kind, tier smallint, title text, body text, rules jsonb,
  applies_to text[], keywords text[], sort int, situation text, why text, example_bad text, example_good text, origin text, origin_type text
);
insert into _pb values
${rows};

-- ① 팀장이 고치지 않은 카드(지금 원본과 글자까지 같은 카드)만 새 문안으로
update public.knowhow_cards c
   set title = p.title, body = p.body, rules = p.rules
  from public.knowhow_templates t
  join _pb p on p.key = t.key
 where c.source = 'consulting' and c.template_key = t.key
   and c.title = t.title and c.body = t.body and c.rules = t.rules
   and (c.title, c.body, c.rules) is distinct from (p.title, p.body, p.rules);
-- 키워드는 화면에 보이지 않고 AI가 상황에 맞는 카드를 고를 때만 쓴다 → 늘 최신으로
update public.knowhow_cards c set keywords = p.keywords
  from _pb p where c.source = 'consulting' and c.template_key = p.key and c.keywords is distinct from p.keywords;

-- ② 원본 갱신
insert into public.knowhow_templates (key, kind, title, body, rules, applies_to, keywords, sort, domain, tier, situation, why, example_bad, example_good, origin, origin_type, updated_at)
select key, kind, title, body, rules, applies_to, keywords, sort, domain, tier, situation, why, example_bad, example_good, origin, origin_type, now() from _pb
on conflict (key) do update set kind = excluded.kind, title = excluded.title, body = excluded.body, rules = excluded.rules,
  applies_to = excluded.applies_to, keywords = excluded.keywords, sort = excluded.sort, domain = excluded.domain, tier = excluded.tier,
  situation = excluded.situation, why = excluded.why, example_bad = excluded.example_bad, example_good = excluded.example_good,
  origin = excluded.origin, origin_type = excluded.origin_type, updated_at = now();
drop table if exists pg_temp._pb;

-- ③ 모든 팀에 새 카드 (없는 것만 · 고친 카드는 건드리지 않음)
do $$ declare r record; begin
  for r in select id from public.teams loop perform public._install_consulting_cards(r.id); end loop;
end $$;

-- ---------- 데모 팀: 플레이북이 실제로 쓰인 모습 ----------
create or replace function public.seed_demo_playbook(p_team uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v1 uuid; v2 uuid;
  k_concl uuid; k_plan uuid; k_num uuid;
  p_hyp uuid; p_pre uuid; p_pyr uuid; p_base uuid; p_root uuid; p_crit uuid;
  pick uuid; con jsonb;
begin
  if not exists (select 1 from teams where id = p_team and is_demo) then return; end if;
  perform public._install_consulting_cards(p_team);

  -- AI 결과에 반영된 횟수 (6개월 운영한 팀처럼)
  update knowhow_cards c set use_count = v.n, last_used_at = now() - make_interval(days => v.d)
  from (values ('pyramid', 23, 0), ('so_what', 14, 1), ('action_title', 12, 2), ('feedback_four', 11, 1), ('upward_report', 10, 3),
               ('hypothesis', 9, 0), ('number_sense', 9, 2), ('oo_flow', 9, 1), ('criteria_first', 8, 0), ('mece', 7, 4),
               ('early_check', 7, 2), ('grow', 7, 1), ('premortem', 6, 0), ('ghost_deck', 6, 5), ('recognition', 6, 3),
               ('psych_safety', 5, 6), ('work_ecs', 5, 7), ('customer_job', 5, 9), ('door_type', 4, 4), ('small_bet', 4, 8),
               ('onboarding', 4, 2), ('baseline_target', 3, 1), ('root_cause', 3, 1), ('clarify_ask', 3, 6), ('priority_matrix', 2, 10))
       as v(k, n, d)
  where c.team_id = p_team and c.template_key = v.k;
  -- 팀원에게 공개 (팀원 화면의 '팀장 가이드')
  update knowhow_cards set shared = true
  where team_id = p_team and source = 'consulting' and template_key in ('pyramid', 'action_title', 'clarify_ask', 'early_check', 'hypothesis');

  -- 업무플랫폼 AI 1차 검토: 내 노하우 + 플레이북을 함께 적용한 기록
  select id into k_concl from knowhow_cards where team_id = p_team and source = 'team' and title = '결론부터, 한 장으로' limit 1;
  select id into k_plan from knowhow_cards where team_id = p_team and source = 'team' and title = '좋은 기획서의 조건' limit 1;
  select id into k_num from knowhow_cards where team_id = p_team and source = 'team' and title = '숫자에는 출처와 비교 기준' limit 1;
  select id into p_hyp from knowhow_cards where team_id = p_team and template_key = 'hypothesis';
  select id into p_pre from knowhow_cards where team_id = p_team and template_key = 'premortem';
  select id into p_pyr from knowhow_cards where team_id = p_team and template_key = 'pyramid';
  select id into p_base from knowhow_cards where team_id = p_team and template_key = 'baseline_target';
  select id into p_root from knowhow_cards where team_id = p_team and template_key = 'root_cause';
  select id into p_crit from knowhow_cards where team_id = p_team and template_key = 'criteria_first';

  select sv.id into v1 from submission_versions sv join submissions s on s.id = sv.submission_id
    where s.team_id = p_team and s.title = '하반기 신제품 런칭 캠페인 기획서' order by sv.version desc limit 1;
  select sv.id into v2 from submission_versions sv join submissions s on s.id = sv.submission_id
    where s.team_id = p_team and s.title = '콘텐츠 제작 프로세스 개선안' order by sv.version desc limit 1;

  if v1 is not null then
    update ai_outputs set
      sources = jsonb_build_array(
        jsonb_build_object('tag', 'E1', 'type', 'knowhow', 'id', k_concl, 'label', '내 노하우 · 결론부터, 한 장으로'),
        jsonb_build_object('tag', 'E2', 'type', 'knowhow', 'id', k_plan, 'label', '내 노하우 · 좋은 기획서의 조건'),
        jsonb_build_object('tag', 'E3', 'type', 'knowhow', 'id', k_num, 'label', '내 노하우 · 숫자에는 출처와 비교 기준'),
        jsonb_build_object('tag', 'E4', 'type', 'consulting', 'id', p_hyp, 'label', 'ATEAM 플레이북 · 가설부터 세우고 검증한다'),
        jsonb_build_object('tag', 'E5', 'type', 'consulting', 'id', p_pre, 'label', 'ATEAM 플레이북 · 시작 전에 실패를 상상한다 (사전 부검)'),
        jsonb_build_object('tag', 'E6', 'type', 'submission', 'id', null, 'label', '이전 버전 v2')),
      content = content || jsonb_build_object('criteria_check', jsonb_build_array(
        jsonb_build_object('criterion', '결론부터, 한 장으로', 'met', false, 'note', '§1 시장 분석으로 시작해 결론(얼리버드 할인)이 §2에 묻혀 있습니다.', 'tag', 'E1'),
        jsonb_build_object('criterion', '좋은 기획서의 조건', 'met', true, 'note', '§2에서 정가 런칭·상시 할인을 비교하고 버린 이유를 밝혔습니다.', 'tag', 'E2'),
        jsonb_build_object('criterion', '숫자에는 출처와 비교 기준', 'met', true, 'note', '시장 규모·성장률·점유율에 수치를 달았습니다. 출처 표기는 보완하면 좋습니다.', 'tag', 'E3'),
        jsonb_build_object('criterion', '가설부터 세우고 검증한다', 'met', true, 'note', '가설마다 검증 방법(예약 페이지 데이터, FGI 12명)을 짝지었습니다.', 'tag', 'E4'),
        jsonb_build_object('criterion', '사전 부검', 'met', false, 'note', 'B사 데이터가 늦어질 때 같은 실패 시나리오와 대응이 없습니다.', 'tag', 'E5')))
    where team_id = p_team and kind = 'review' and ref_table = 'submission_versions' and ref_id = v1;
  end if;
  if v2 is not null then
    update ai_outputs set
      sources = jsonb_build_array(
        jsonb_build_object('tag', 'E1', 'type', 'knowhow', 'id', k_concl, 'label', '내 노하우 · 결론부터, 한 장으로'),
        jsonb_build_object('tag', 'E2', 'type', 'knowhow', 'id', k_plan, 'label', '내 노하우 · 좋은 기획서의 조건'),
        jsonb_build_object('tag', 'E3', 'type', 'consulting', 'id', p_base, 'label', 'ATEAM 플레이북 · 목표치엔 기준선과 산정 근거'),
        jsonb_build_object('tag', 'E4', 'type', 'consulting', 'id', p_root, 'label', 'ATEAM 플레이북 · 원인은 다섯 번 묻는다'),
        jsonb_build_object('tag', 'E5', 'type', 'consulting', 'id', p_crit, 'label', 'ATEAM 플레이북 · 기준을 먼저 정하고 대안을 본다')),
      content = content || jsonb_build_object('criteria_check', jsonb_build_array(
        jsonb_build_object('criterion', '결론부터, 한 장으로', 'met', true, 'note', '첫 줄에 개선안 세 가지를 먼저 밝혔습니다.', 'tag', 'E1'),
        jsonb_build_object('criterion', '좋은 기획서의 조건', 'met', false, 'note', '다른 개선 방법과 비교하거나 버린 이유가 없습니다.', 'tag', 'E2'),
        jsonb_build_object('criterion', '목표치엔 기준선과 산정 근거', 'met', false, 'note', '기준선(리드타임 3주)은 있지만 목표치와 개선별 단축 효과 추정이 없습니다.', 'tag', 'E3'),
        jsonb_build_object('criterion', '원인은 다섯 번 묻는다', 'met', false, 'note', '리드타임이 긴 원인을 단계별로 짚지 않고 일반적인 개선책으로 바로 갔습니다.', 'tag', 'E4')))
    where team_id = p_team and kind = 'review' and ref_table = 'submission_versions' and ref_id = v2;
  end if;

  -- 다른 AI 결과에도 '적용한 기준'이 남게 (가장 최근 것 하나씩, 이미 있으면 건너뜀)
  for pick, con in
    select o.id, x.c from (values
        ('one_on_one_prep', '[["oo_flow","1on1 대화 순서"],["grow","GROW로 코칭 대화를 이끈다"],["recognition","인정은 구체적으로, 고르게"]]'),
        ('weekly_report', '[["pyramid","결론 먼저, 근거는 그 아래 (피라미드 원칙)"],["upward_report","상향 보고의 순서"]]'),
        ('exec_brief', '[["boss_lens","상사의 관심사로 번역한다"],["answer_first","물으면 답부터, 설명은 그다음"],["bad_news","나쁜 소식은 먼저, 대응안과 함께"]]'),
        ('advisor_weekly', '[["work_ecs","업무를 핵심·공통·지원으로 나누기"],["priority_matrix","중요도와 긴급도로 나눈다"],["onboarding","새 팀원의 첫 30일을 설계한다"]]'),
        ('insight_weekly', '[["weekly_rhythm","목표는 매주 굴린다"],["psych_safety","말해도 안전한 팀을 만든다"]]'))
      as x(k, c)
    cross join lateral (select id from ai_outputs where team_id = p_team and kind::text = x.k order by created_at desc limit 1) o
  loop
    update ai_outputs a set sources = (case when jsonb_typeof(a.sources) = 'array' then a.sources else '[]'::jsonb end) || (
        select coalesce(jsonb_agg(jsonb_build_object('tag', 'E' || (90 + e.ord), 'type', 'consulting', 'id', kc.id, 'label', 'ATEAM 플레이북 · ' || (e.v ->> 1)) order by e.ord), '[]'::jsonb)
        from jsonb_array_elements(con::jsonb) with ordinality as e(v, ord)
        left join knowhow_cards kc on kc.team_id = p_team and kc.template_key = e.v ->> 0)
    where a.id = pick and not (coalesce(a.sources, '[]'::jsonb) @> '[{"type": "consulting"}]'::jsonb);
  end loop;
end $fn$;
revoke all on function public.seed_demo_playbook(uuid) from public, anon, authenticated;

do $$ declare r record; begin
  for r in select id from public.teams where is_demo loop perform public.seed_demo_playbook(r.id); end loop;
end $$;
`;

writeFileSync(join(root, 'supabase/migrations/20261107000034_playbook.sql'), body);
writeFileSync(join(root, 'supabase/dashboard/29_playbook.sql'),
  `-- ATEAM 플레이북 (기본 제공 카드 ${pb.cards.length}장 · ${domains.length}개 영역 · 화면용 정보 · 데모 적용 이력) — 28_realtime_ai 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)\n\n${body}`);

// ---------- 문서 ----------
const FEAT = { review: '1차 검토', prep: '1on1 준비', report: '보고', briefing: '브리핑·제안', strategy: '전략 점검', scenario: '시나리오', plan: '목표 초안' };
let md = `# ATEAM 플레이북 — 카드 목록 (${pb.version})

> 자동 생성 문서입니다. 원본은 \`supabase/playbook/playbook.json\`, 다시 만들려면 \`node scripts/build-playbook.mjs\`.

**${pb.cards.length}장 · ${domains.length}개 영역** — 현장 컨설팅 기준 ${nField}장 + 글로벌 방법론 ${nGlobal}장 · ★ 대표 방법론 ${pb.cards.filter((c) => c.tier === 1).length}장

AI는 기능마다 이 카드들 중 지금 상황(결과물 본문·기록)에 맞는 것을 골라 읽습니다. 팀장의 기준(내 노하우)이 항상 먼저이고, 둘이 어긋나면 팀장의 기준을 따릅니다. 평가 초안·팀원 액션에는 쓰지 않습니다.

| 영역 | 카드 수 |
|---|---|
${pb.domains.map((d) => `| ${d.label} — ${d.sub} | ${pb.cards.filter((c) => c.domain === d.key).length} |`).join('\n')}

`;
for (const d of pb.domains) {
  md += `\n## ${d.label}\n_${d.sub}_\n`;
  for (const c of pb.cards.filter((x) => x.domain === d.key)) {
    md += `\n### ${c.tier === 1 ? '★ ' : ''}${c.title}\n`;
    md += `- **언제** ${c.situation} · **반영** ${c.applies_to.map((f) => FEAT[f]).join(', ')} · **출처** ${c.origin}${c.origin_type === 'field' ? ' _(현장)_' : ''}\n`;
    md += `- ${c.body}\n`;
    md += `- **AI 규칙**: ${c.rules.join(' / ')}\n`;
    md += `- **왜**: ${c.why}\n`;
    md += `- ✗ ${c.bad}\n- ✓ ${c.good}\n`;
  }
}
writeFileSync(join(root, 'docs/PLAYBOOK.md'), md);
console.log(`playbook: ${pb.cards.length} cards (${nField} field + ${nGlobal} global) → migration 0034 · dashboard 29 · docs/PLAYBOOK.md`);
for (const d of pb.domains) console.log(`  ${d.key.padEnd(9)} ${pb.cards.filter((c) => c.domain === d.key).length}`);
