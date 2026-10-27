#!/bin/sh
# supabase/functions·migrations 를 고친 뒤 대시보드용 파일(supabase/dashboard)을 다시 만든다
set -e
cd "$(dirname "$0")/../supabase"
mkdir -p dashboard/functions
for d in functions/*/; do
  f=$(basename "$d"); [ "$f" = "_shared" ] && continue
  npx -y esbuild@0.25.10 "functions/$f/index.ts" --bundle --format=esm --platform=neutral --target=es2022 \
    --external:'npm:*' --log-level=error --outfile="dashboard/functions/$f.ts"
done
# 01: 스케줄(0006)을 뺀 전체 스키마 합본 — 새 프로젝트에서 한 번
{ echo "-- ATEAM · 대시보드용 스키마 합본 (migrations, 스케줄 제외) — 새 프로젝트의 SQL Editor 에서 한 번 Run"; \
  for f in migrations/*.sql; do case "$f" in *_schedules.sql) continue;; esac; echo; echo "-- >>>>>>>>>> $(basename "$f")"; cat "$f"; done; } > dashboard/01_schema.sql
# 02: 예약 작업 (vault 값 두 줄 + 0006 + 0009)
{ sed -n '1,9p' dashboard/_schedules_head.sql; echo; cat migrations/20261006000006_schedules.sql; echo; cat migrations/20261013000009_insight_schedules.sql; } > dashboard/02_schedules.sql
# 03: 이전 01_schema.sql 을 이미 실행한 프로젝트용 추가분 (노하우)
cp migrations/20261011000007_knowhow.sql dashboard/03_add_knowhow.sql
# 04·05: v2 업그레이드 — 이미 01을 실행한 프로젝트용 (목표·과제 자유 구조, 요청·알림, 과금 v2 / AI 인사이트 예약)
{ echo "-- ATEAM v2 업그레이드 — 예전 01_schema.sql 을 이미 실행한 프로젝트에서 한 번 Run (새 프로젝트는 01에 포함되어 있으니 건너뜀)"; echo "-- 기존 전략 목표·과제·마일스톤 데이터는 새 구조(work_items)로 옮겨집니다."; echo; cat migrations/20261013000008_work_items.sql; } > dashboard/04_upgrade_v2.sql
{ echo "-- ATEAM v2 — AI 인사이트 예약 (02_schedules.sql 을 이미 실행한 프로젝트에서 한 번 Run)"; echo; cat migrations/20261013000009_insight_schedules.sql; } > dashboard/05_schedules_v2.sql
# 06: 데모 계정 (팀장 1 + 팀원 6, 데모 팀 기록) — 다시 Run하면 초기화
{ echo "-- ATEAM 데모 계정 — v2(04)를 적용한 프로젝트의 SQL Editor에서 Run. 다시 Run하면 데모가 처음 상태로 초기화됩니다."; echo; cat migrations/20261014000010_demo.sql; echo; cat migrations/20261015000011_org_notes.sql; echo; cat migrations/20261022000018_request_kinds.sql; echo; cat migrations/20261024000020_member_app.sql; echo; cat migrations/20261026000022_plan_window.sql; echo; cat migrations/20261027000023_work_groups.sql; echo; cat migrations/20261028000024_work_space.sql; echo; cat migrations/20261031000027_checkin.sql; echo; cat migrations/20261101000028_goal_metrics.sql; echo; cat migrations/20261102000029_condition.sql; echo; cat migrations/20261103000030_oo_entries.sql; echo; cat demo_accounts.sql; echo; cat migrations/20261020000016_leader_notes.sql; echo; cat migrations/20261021000017_coaching.sql; echo; cat migrations/20261110000037_review_fixes.sql; echo; cat migrations/20261112000039_invite_note.sql; } > dashboard/06_demo_accounts.sql
# 07: 홈 개편 — 조직·전사(위에서 온 것) 메모. 이미 01·04를 실행한 프로젝트에서 한 번 (06을 먼저 돌렸다면 이미 포함)
{ echo "-- ATEAM 홈 개편: 조직·전사 메모(org_notes) + AI 영향 분석 종류 추가 — SQL Editor에서 한 번 Run"; echo; cat migrations/20261015000011_org_notes.sql; } > dashboard/07_org_notes.sql
# 08: 메뉴 재편(팀목표·업무플랫폼·팀원관리) — 요청 완료를 평가 근거로. 이미 01을 실행한 프로젝트에서 한 번
{ echo "-- ATEAM 메뉴 재편: 요청 완료 → 평가 근거 자동 기록 — SQL Editor에서 한 번 Run"; echo; cat migrations/20261016000012_people_work.sql; } > dashboard/08_people_work.sql
{ echo "-- ATEAM AI 남용·원가 방어 (시간당·하루 상한, 월 원가 상한, 같은 대상 반복 제한, 실패 호출 원가 기록) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261017000013_ai_guard.sql; } > dashboard/09_ai_guard.sql
{ echo "-- ATEAM A·Team의 제안(주간 운영 컨설팅) + 팀장 관심 지수 + 팀장 셀프 체크 — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261018000014_ateam_advice.sql; } > dashboard/10_ateam_advice.sql
{ echo "-- ATEAM 상향 관리 › 임원 브리핑 (상위 관리자 프로필 · 위에서 온 것 연결 · AI 브리핑) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261019000015_exec_brief.sql; } > dashboard/11_exec_brief.sql
{ echo "-- ATEAM 내 메모 (팀장 전용 메모 · 팀원·목표·임원에 붙이기) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261020000016_leader_notes.sql; } > dashboard/12_leader_notes.sql
{ echo "-- ATEAM의 코칭 (팀장이 누르면 AI 초안 → 팀장이 고쳐 보내는 개선 코칭, 보낸 사람 비표시) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261021000017_coaching.sql; echo; cat migrations/20261110000037_review_fixes.sql; } > dashboard/13_coaching.sql
{ echo "-- ATEAM 요청 종류 추가 (성장 제안 · 격려 — 팀원 상세의 육성 · 지원·격려 버튼용) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261022000018_request_kinds.sql; } > dashboard/14_request_kinds.sql
{ echo "-- ATEAM 팀원 앱 정비 (받은 칭찬 보기 · 팀원 1:1 요청 · AI 체크인 초안) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261024000020_member_app.sql; } > dashboard/15_member_app.sql
{ echo "-- ATEAM 컨설팅 기준 카드 (내 노하우 기본 제공 21장 · 새 팀 자동 · 다시 받기) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261025000021_consulting_cards.sql; } > dashboard/16_consulting_knowhow.sql
{ echo "-- ATEAM 팀원 목표 수정 켜기·끄기 (팀장이 켜 둔 동안만 팀원이 목표·과제 수정 · 할 일은 자유 · 변경 요청) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261026000022_plan_window.sql; } > dashboard/17_plan_window.sql
{ echo "-- ATEAM 업무플랫폼 그룹 스페이스 + 대화 첨부 (그룹 멤버가 함께 보고 대화 · 새 버전 · 그룹 알림) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261027000023_work_groups.sql; } > dashboard/18_work_groups.sql
{ echo "-- ATEAM 업무 스페이스 채팅형 (스페이스 칸 · 대화 메시지 · 읽음 표시 · 팀장 글) — 18 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261028000024_work_space.sql; } > dashboard/19_work_space.sql
{ echo "-- ATEAM 비용 줄이기 (안 읽음 수 함수 · AI 자동 검토 예산 확인) — 19 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261029000025_cost_guard.sql; } > dashboard/20_cost_guard.sql
{ echo "-- ATEAM 요금제 v3 (Starter 5명 · Pro 10명 · Pro+ 20명, 모두 1팀 · Free 없음 · 체험 14일 · AI 원가 상한 조정) — 20 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261030000026_plans_v3.sql; } > dashboard/21_plans_v3.sql
{ echo "-- ATEAM 성과 체크인 (업무플랫폼에서 목표에 성과를 점찍고 팀장 승인 → 팀목표 공식 값 · 정성 '단계' 측정 · 숫자 즉시 반영 없앰) — 21 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261031000027_checkin.sql; } > dashboard/22_checkin.sql
{ echo "-- ATEAM 목표 = 지표 + 과제 (지표가 있으면 목표 진척은 지표 평균 · 지표 값은 체크인/실적으로만 · 기존 항목 자동 분류) — 22 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261101000028_goal_metrics.sql; } > dashboard/23_goal_metrics.sql
echo "done: supabase/dashboard"
{ echo "-- ATEAM 컨디션 공유 + 팀장님과 개편 + 1on1 이름 통일 (영향 요인 · 메모 칸 · 컨디션을 평가 근거에서 제외 · 칭찬 알림 · 코칭 알림 링크 · 알림 문구 1on1) — 23_goal_metrics 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261102000029_condition.sql; } > dashboard/24_condition.sql
{ echo "-- ATEAM 1on1 함께 보는 노트 글 쌓기 (작성자·시간이 붙은 글 · 내 글만 수정 · 기존 노트 옮기기) — 24_condition 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261103000030_oo_entries.sql; } > dashboard/25_oo_entries.sql
{ echo "-- ATEAM 이름 바꾸기: 성과 체크인 → 성과입력 (이미 올라간 카드·알림의 제목 머리말) — 25_oo_entries 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261104000031_perf_input_name.sql; } > dashboard/26_perf_input_name.sql
{ echo "-- ATEAM 업무 스페이스 실시간 반영 — 26_perf_input_name 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261105000032_realtime.sql; } > dashboard/27_realtime.sql
{ echo "-- ATEAM AI 분석 완료 실시간 반영 — 27_realtime 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261106000033_realtime_ai.sql; } > dashboard/28_realtime_ai.sql
# 29: ATEAM 플레이북 — supabase/playbook/playbook.json 에서 만든다 (migrations 0034 · docs/PLAYBOOK.md 도 같이)
node ../scripts/build-playbook.mjs
{ echo "-- ATEAM 히스토리 관리 (과제별 히스토리 · 팀원에게 전달 · 질문/답 · 매주 월요일 06:00 자동 업데이트 · Pro부터) — 29_playbook 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261108000035_history.sql; } > dashboard/30_history.sql
{ echo "-- ATEAM 초대 메일 확인 (초대받은 메일로만 합류 · 로그인 전 초대 미리보기) — 30_history 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261109000036_invite_email.sql; } > dashboard/31_invite_email.sql
{ echo "-- ATEAM 검토 수정 (요청 알림 링크·이름 · 히스토리/요청/코칭 팀 확인 · 내 메모는 팀장만 · 초대 보완 · 요금제 history 확인) — 31_invite_email 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261110000037_review_fixes.sql; } > dashboard/32_review_fixes.sql
{ echo "-- ATEAM 요금제 가격 조정 (Starter 29,000 · Pro 49,000 · Pro+ 79,000 · AI 원가 상한 8/14/28달러) — 32_review_fixes 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261111000038_plans_price.sql; } > dashboard/33_plans_price.sql
{ echo "-- ATEAM 초대 메모(강점·보완할 점 → 합류하면 팀장 개인 메모, AI 참고) — 33_plans_price 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261112000039_invite_note.sql; } > dashboard/34_invite_note.sql
{ echo "-- ATEAM AUTOPILOT(자율주행) — 34_invite_note 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261113000040_autopilot.sql; } > dashboard/35_autopilot.sql
