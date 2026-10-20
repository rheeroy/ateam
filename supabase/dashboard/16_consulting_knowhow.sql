-- ATEAM 컨설팅 기준 카드 (내 노하우 기본 제공 21장 · 새 팀 자동 · 다시 받기) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- ATEAM · 0021 컨설팅 기준 카드 (기본 제공 노하우)
--   · 모든 팀에 '컨설팅 기준' 카드 21장을 기본으로 넣는다 (knowhow_cards.source = 'consulting')
--   · 팀장 카드와 똑같이 켜고 끄고, 고치고, 지울 수 있다. AI는 팀장 카드를 먼저 읽고 남는 자리에 컨설팅 기준을 싣는다
--   · 평가 시뮬레이션·팀원 액션에는 싣지 않는다 (카드에 evaluation 적용처 없음, 팀원 액션은 함수에서 제외)
--   · 지운 카드는 '내 노하우 › 컨설팅 기준 다시 받기'로 되살릴 수 있다
-- 다시 Run 해도 안전합니다.
-- =====================================================================

alter table public.knowhow_cards add column if not exists source text not null default 'team';
alter table public.knowhow_cards add column if not exists template_key text;
do $$ begin
  alter table public.knowhow_cards add constraint knowhow_cards_source_chk check (source in ('team', 'consulting'));
exception when duplicate_object then null; end $$;
create unique index if not exists knowhow_cards_team_template on public.knowhow_cards (team_id, template_key) where template_key is not null;

-- ---------- 원본 (팀마다 복사되는 기준) ----------
create table if not exists public.knowhow_templates (
  key         text primary key,
  kind        public.knowhow_kind not null,
  title       text not null,
  body        text not null default '',
  rules       jsonb not null default '[]'::jsonb,
  applies_to  text[] not null default '{}',
  keywords    text[] not null default '{}',
  sort        int not null default 0,
  updated_at  timestamptz not null default now()
);
alter table public.knowhow_templates enable row level security;
drop policy if exists kt_read on public.knowhow_templates;
create policy kt_read on public.knowhow_templates for select to authenticated using (true);

insert into public.knowhow_templates (key, kind, title, body, rules, applies_to, keywords, sort) values
('goal_state', 'framework', '목표는 이루려는 상태로',
 '목표는 하는 일의 목록이 아니라 이루려는 상태다. 새로 만들 것(Build), 개선할 것(Improve), 다르게 바꿀 것(Innovate) 중 무엇인지가 드러나야 한다. 늘 하던 일, 무난히 되는 수치, 작년과 같은 목표는 목표가 아니다.',
 '["목표 제목에 이루려는 상태를 쓴다", "만들기·개선·혁신 중 성격을 밝힌다", "일상 업무 나열은 목표로 올리지 않는다", "작년 목표의 반복이면 무엇이 다른지 묻는다"]',
 '{plan,strategy}', '{목표,BII,목표수립}', 1),
('goal_check', 'rubric', '목표 점검 네 가지',
 '목표를 세운 뒤 네 가지를 본다. 집중(3~5개로 추렸는가), 정렬(상위 목표·전사 방침과 이어지는가), 도전(최선을 다하면 60~70% 달성할 수준인가), 추적(달성 여부를 무엇으로 알 수 있는가).',
 '["팀 목표는 3~5개", "상위 목표와 연결을 밝힌다", "60~70% 달성 수준으로 도전적으로", "달성 판단 기준이 없으면 붙인다"]',
 '{plan,strategy}', '{목표점검,집중,정렬,도전}', 2),
('measure_outcome', 'rubric', '결과를 재는 지표',
 '달성 지표는 한 일이 아니라 일어난 결과를 잰다. "~실시, ~수행, ~관리"는 과제다. 지표 하나에는 한 가지만 담고, 하위로 갈수록 과정 지표(선행), 팀 목표에는 결과 지표(후행)를 둔다.',
 '["활동이면 과제로 내리고 결과 지표를 찾는다", "지표 하나에 한 가지 내용만", "팀 목표엔 결과, 하위엔 과정 지표", "과정 지표만으로 성과를 판단하지 않는다"]',
 '{plan}', '{KR,지표,측정}', 3),
('kpi_five', 'rubric', '좋은 지표의 다섯 조건',
 '전략과 이어지는가(전략 연계), 자의적으로 부풀릴 수 없는가(객관성), 데이터를 쉽게 얻는가(측정 용이), 담당자가 결과를 움직일 수 있는가(통제 가능), 중요한 업무를 재는가(업무 대표). 통제가 어려운 지표는 기여 정도로 바꿔 잰다.',
 '["다섯 조건 중 빠진 것을 짚는다", "통제 어려운 지표는 기여도로 바꾼다", "질·양·비용·시간 중 두 축 이상"]',
 '{plan,strategy}', '{KPI,지표품질}', 4),
('qual_measure', 'framework', '정성 성과를 재는 다섯 방법',
 '숫자로 안 나오는 성과도 잴 수 있다. 고객·사용자 만족 조사(Survey), 난이도·적시성·완결성 점수(표준화), 수준별 행동 기준(행동기준), 단계별 완료와 가중치(마일스톤), 필수 요소 유무(체크리스트). 어느 방법이든 등급별 판단 기준을 미리 정한다.',
 '["정성 목표엔 측정 방법을 고른다", "등급별 판단 기준을 함께 쓴다", "마일스톤은 단계별 가중치를 둔다"]',
 '{plan}', '{정성지표,마일스톤,측정방식}', 5),
('goal_change', 'principle', '목표 수정은 세 가지 경우에만',
 '목표는 상위 목표가 바뀌었을 때, 업무 분장이 바뀌었을 때, 중대한 새 과업이 생겼을 때 고친다. "달성이 어려워서"는 수정 이유가 아니다. 고칠 때는 이유를 남긴다.',
 '["수정 이유가 세 경우인지 확인한다", "어렵다는 이유로 목표를 낮추지 않는다", "수정할 때 사유를 기록한다"]',
 '{plan,prep,strategy}', '{목표수정,재계획}', 6),
('keep_stop', 'framework', '지속·보완·중단 회고',
 '분기마다 목표를 지속·보완·중단 중 하나로 정한다. 일찍·크게 넘었다면 목표가 쉬웠는지, 실제로 상위 목표에 기여했는지 본다. 통제할 수 없는 이유로 막혔다면 수정·중단을, 순항이면 지속을. 중단할 때는 배운 것을 남긴다.',
 '["초과 달성이면 목표 난이도를 되묻는다", "외부 요인 막힘이면 수정·중단 검토", "중단할 때 배운 점을 기록한다"]',
 '{strategy,briefing}', '{회고,분기점검}', 7),
('task_naming', 'principle', '과제 이름은 효과가 보이게',
 '과제 이름은 "(효과)를 위한 (활동)" 또는 "(활동)을 통한 (효과)"로 쓴다. "검토 철저", "관리 강화"처럼 끝을 알 수 없는 이름은 무엇이 되면 끝인지 드러나게 고친다. 할 일은 담당자가 바로 손댈 수 있는 행동 단위로.',
 '["과제명에 효과와 활동을 함께", "끝이 안 보이는 이름은 고친다", "할 일은 행동 단위로 쪼갠다"]',
 '{plan}', '{과제명,과제설계}', 8),
('depth_scale', 'rubric', '고민의 깊이 눈금',
 '1 지시된 것을 정리해 사실을 나열한다. 2 표준 기준으로 구조화한다(빠짐·겹침 없음). 3 상황에 맞게 해석해 원인과 시사점을 낸다. 4 정답이 없는 문제에서 선택지를 설계·비교하고 권고와 리스크를 밝힌다.',
 '["현상→원인→시사점→권고 중 어디까지 왔는지 본다", "빠진 단계를 보완점으로 짚는다", "대안 비교와 버린 이유가 있으면 높게 본다"]',
 '{review}', '{판단깊이,결과물품질}', 9),
('doc_check', 'rubric', '문서 유형별 점검',
 '기획서: 풀 질문·범위·일정·역할·리스크·성공 기준. 진행 보고: 결론과 요청 먼저, 계획 대비 숫자, 이슈는 원인→영향→대응. 분석: 질문과 가설, 출처·기간·표본, 비교 기준, 한계. 제안: 진단과 처방의 연결, 대안 2개 이상, 실행 계획, 기대 효과.',
 '["문서 유형에 맞는 빠진 요소를 짚는다", "수치와 인용엔 출처가 있는지 본다", "세부 데이터는 참고로 분리했는지 본다"]',
 '{review}', '{기획서,보고서,분석,제안서}', 10),
('upward_report', 'framework', '상향 보고의 순서',
 '첫 줄에 결론과 요청, 그다음 근거 숫자, 마지막에 필요한 결정과 지원. 결정이 필요하면 선택지 두 개 이상을 장단점과 함께. 한 장에 한 메시지, 세부는 참고로 뺀다.',
 '["결론과 요청을 첫 줄에", "결정 사항은 선택지 2개 이상으로", "한 장에 한 메시지"]',
 '{report}', '{보고,임원보고,상향관리}', 11),
('bad_news', 'principle', '나쁜 소식은 먼저, 대응안과 함께',
 '위에서 다른 경로로 듣기 전에 팀장이 먼저 말한다. 원인 → 영향 → 대응안 순서로, 대응안이 여럿이면 권하는 안을 밝힌다. 목표 대비 부족이 구조적이면 추세·바뀐 환경·필요한 자원을 근거로 재협의를 준비한다.',
 '["나쁜 소식은 원인→영향→대응안", "권하는 대응안을 밝힌다", "구조적 부족은 재협의 근거를 준비"]',
 '{report,briefing}', '{리스크보고,에스컬레이션}', 12),
('oo_flow', 'coaching', '1on1 대화 순서',
 '근황과 지난 이후 변화 → 잘된 것과 어려웠던 것(그 원인) → 앞으로의 우선순위와 목표 유지·수정 → 내가 도울 것. 팀장이 지키지 못한 약속이 있으면 그것부터 꺼낸다. 진척 확인은 체크인으로 보고, 1on1에서는 사람과 막힘을 본다.',
 '["밀린 팀장 약속을 첫 안건으로", "마지막 질문은 내가 도울 것", "1on1에서 진척 점검만 하지 않는다"]',
 '{prep}', '{1on1,면담}', 13),
('ask_or_tell', 'coaching', '팀원 수준에 맞춘 대화',
 '스스로 판단할 수 있는 팀원에게는 질문으로 깨닫게 하는 대화를 80%, 아직 기준이 서지 않은 팀원에게는 기대와 방법을 직접 알려 주는 대화를 80%로 한다. 질문은 무엇을·어떻게로 열고, 추궁형(언제까지, 왜 안 했나)은 쓰지 않는다.',
 '["판단 깊이 높으면 질문형으로", "판단 깊이 낮으면 방법과 예시 먼저", "추궁형 질문은 쓰지 않는다"]',
 '{prep,review}', '{코칭,질문}', 14),
('feedback_four', 'coaching', '피드백은 관찰→영향→기대→질문',
 '관찰한 행동을 사실로 말하고, 그 행동이 일이나 팀에 준 영향을 말하고, 기대하는 다음 행동을 말한 뒤, 상대의 생각을 묻는다. "항상, 늘" 같은 일반화와 성격·태도 판단은 쓰지 않는다.',
 '["사실→영향→기대→질문 순서로", "일반화·성격 판단은 쓰지 않는다", "기대는 관찰 가능한 행동으로"]',
 '{prep,review}', '{피드백,SBI}', 15),
('recognition', 'coaching', '인정은 구체적으로, 고르게',
 '인정은 구체적 행동과 그 결과를 짚어 바로 한다. 성과가 있는데 인정이 끊기면 사람은 "내가 뭘 했지"를 느낀다. 인정이 한두 사람에게 몰리지 않게 고르게 나누고, 위로 보고할 때 기여한 사람의 이름을 넣는다.',
 '["행동과 결과를 짚어 칭찬한다", "인정이 몰리지 않게 고르게", "상향 보고에 기여자 이름을 넣는다"]',
 '{prep,briefing}', '{칭찬,인정,동기}', 16),
('demotivation', 'coaching', '동기 저하 원인별 대응',
 '비판에 민감해진 사람에게는 구체적인 기준과 지침을, 소외감을 느끼는 사람에게는 핵심 업무에 참여할 기회를, 일의 의미를 잃은 사람에게는 그 일이 목표와 고객에 어떻게 이어지는지를 준다. 성장하고 싶은 사람에게는 성공 가능성 50~70% 정도의 한 단계 어려운 일을 맡긴다.',
 '["원인을 먼저 구분하고 대응한다", "도전 과제는 성공 가능성 50~70%로", "컨디션이 낮을 때는 독려보다 지원"]',
 '{prep}', '{동기부여,몰입,이탈}', 17),
('work_ecs', 'framework', '업무를 핵심·공통·지원으로 나누기',
 '업무를 중요도와 난이도로 나누면 핵심(강화·집중), 공통(표준화·매뉴얼), 지원(축소·자동화·외부)으로 갈린다. 사람이 아니라 업무 기준으로 본다. 경험 많은 사람이 지원 업무를 오래 들고 있거나, 신입이 핵심 업무에 과부하면 배분을 다시 본다.',
 '["업무를 핵심·공통·지원으로 나눈다", "지원 업무부터 줄이거나 넘긴다", "업무 가치와 담당자 수준을 맞춘다"]',
 '{strategy,scenario,briefing}', '{업무분류,재배분,업무량}', 18),
('delegation', 'principle', '위임 판단 세 가지 축',
 '팀 안에서 끝나는 일인가, 해 본 적 있는 일인가, 실행 성격의 일인가. 셋 다 맞으면 팀원이 결정하게 넘긴다. 처음 하는 일·방향을 정하는 일은 팀장이 쥐고, 돈·법·인사가 걸린 일은 한 단계 위로 올린다. 과제마다 최종 책임자는 한 명이다.',
 '["팀 내·기존·실행 업무는 팀원에게 위임", "신규·기획 업무는 팀장이 쥔다", "과제마다 최종 책임자는 한 명"]',
 '{briefing,strategy}', '{위임,권한,RACI}', 19),
('staffing', 'principle', '충원 요청 전에 먼저 볼 것',
 '충원을 말하기 전에 축소·중단, 재배분, 위임, 프로세스 개선·자동화를 먼저 검토하고 남는 부족분만 요청한다. 요청에는 지금 업무량과 필요한 인원, 늘어난 이유, 내부에서 해 본 것, 선택지(정규·한시·지원), 충원하지 않으면 생길 일을 담는다.',
 '["충원 전에 내부 해소안을 먼저", "부족분은 숫자로 보인다", "미충원 시 영향을 함께 쓴다"]',
 '{briefing,report,scenario}', '{충원,인력운영,채용}', 20),
('meeting_default', 'framework', '회의·지시의 기본값',
 '회의는 결정·공유·논의 중 목적을 정하고, 공유가 목적이면 글로 대신한다. 끝날 때 결정·담당·기한을 남긴다. 지시할 때는 목적, 결과물 모양, 기한, 판단 기준 네 가지를 함께 준다. 같은 결과물이 여러 번 다시 돌아오면 착수 때 결론과 목차를 먼저 맞춘다.',
 '["공유 목적 회의는 글로 대신한다", "회의마다 결정·담당·기한을 남긴다", "지시엔 목적·결과물·기한·기준", "재작업 반복이면 목차부터 합의"]',
 '{briefing}', '{회의,지시,운영체계}', 21)
on conflict (key) do update set kind = excluded.kind, title = excluded.title, body = excluded.body, rules = excluded.rules,
  applies_to = excluded.applies_to, keywords = excluded.keywords, sort = excluded.sort, updated_at = now();

-- ---------- 팀에 넣기 ----------
-- 없는 것만 넣는다 (팀장이 고친 카드는 덮어쓰지 않음)
create or replace function public._install_consulting_cards(p_team uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_n int;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return 0; end if;
  insert into knowhow_cards (team_id, owner_id, kind, title, body, rules, applies_to, keywords, active, pinned, shared, provenance, source, template_key)
  select p_team, v_owner, t.kind, t.title, t.body, t.rules, t.applies_to, t.keywords, true, false, false, 'human', 'consulting', t.key
  from knowhow_templates t
  where not exists (select 1 from knowhow_cards c where c.team_id = p_team and c.template_key = t.key)
  order by t.sort;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public._install_consulting_cards(uuid) from public, anon, authenticated;

-- 팀장이 '컨설팅 기준 다시 받기'를 누를 때
create or replace function public.restore_consulting_cards(p_team uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team_leader(p_team) then raise exception 'forbidden'; end if;
  return public._install_consulting_cards(p_team);
end $$;
grant execute on function public.restore_consulting_cards(uuid) to authenticated;

-- 새 팀이 만들어지면 자동으로
create or replace function public.trg_team_consulting_cards() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._install_consulting_cards(new.id);
  return new;
end $$;
drop trigger if exists t_team_consulting_cards on public.teams;
create trigger t_team_consulting_cards after insert on public.teams for each row execute function public.trg_team_consulting_cards();

-- 지금 있는 팀 전부
do $$ declare r record; begin
  for r in select id from public.teams loop perform public._install_consulting_cards(r.id); end loop;
end $$;
