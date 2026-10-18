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
{ echo "-- ATEAM 데모 계정 — v2(04)를 적용한 프로젝트의 SQL Editor에서 Run. 다시 Run하면 데모가 처음 상태로 초기화됩니다."; echo; cat migrations/20261014000010_demo.sql; echo; cat migrations/20261015000011_org_notes.sql; echo; cat migrations/20261022000018_request_kinds.sql; echo; cat migrations/20261024000020_member_app.sql; echo; cat migrations/20261026000022_plan_window.sql; echo; cat migrations/20261027000023_work_groups.sql; echo; cat demo_accounts.sql; echo; cat migrations/20261020000016_leader_notes.sql; echo; cat migrations/20261021000017_coaching.sql; } > dashboard/06_demo_accounts.sql
# 07: 홈 개편 — 조직·전사(위에서 온 것) 메모. 이미 01·04를 실행한 프로젝트에서 한 번 (06을 먼저 돌렸다면 이미 포함)
{ echo "-- ATEAM 홈 개편: 조직·전사 메모(org_notes) + AI 영향 분석 종류 추가 — SQL Editor에서 한 번 Run"; echo; cat migrations/20261015000011_org_notes.sql; } > dashboard/07_org_notes.sql
# 08: 메뉴 재편(팀목표·업무플랫폼·팀원관리) — 요청 완료를 평가 근거로. 이미 01을 실행한 프로젝트에서 한 번
{ echo "-- ATEAM 메뉴 재편: 요청 완료 → 평가 근거 자동 기록 — SQL Editor에서 한 번 Run"; echo; cat migrations/20261016000012_people_work.sql; } > dashboard/08_people_work.sql
{ echo "-- ATEAM AI 남용·원가 방어 (시간당·하루 상한, 월 원가 상한, 같은 대상 반복 제한, 실패 호출 원가 기록) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261017000013_ai_guard.sql; } > dashboard/09_ai_guard.sql
{ echo "-- ATEAM A·Team의 제안(주간 운영 컨설팅) + 팀장 관심 지수 + 팀장 셀프 체크 — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261018000014_ateam_advice.sql; } > dashboard/10_ateam_advice.sql
{ echo "-- ATEAM 상향 관리 › 임원 브리핑 (상위 관리자 프로필 · 위에서 온 것 연결 · AI 브리핑) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261019000015_exec_brief.sql; } > dashboard/11_exec_brief.sql
{ echo "-- ATEAM 내 메모 (팀장 전용 메모 · 팀원·목표·임원에 붙이기) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261020000016_leader_notes.sql; } > dashboard/12_leader_notes.sql
{ echo "-- ATEAM의 코칭 (팀장이 누르면 AI 초안 → 팀장이 고쳐 보내는 개선 코칭, 보낸 사람 비표시) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261021000017_coaching.sql; } > dashboard/13_coaching.sql
{ echo "-- ATEAM 요청 종류 추가 (성장 제안 · 격려 — 팀원 상세의 육성 · 지원·격려 버튼용) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261022000018_request_kinds.sql; } > dashboard/14_request_kinds.sql
{ echo "-- ATEAM 팀원 앱 정비 (받은 칭찬 보기 · 팀원 1:1 요청 · AI 체크인 초안) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261024000020_member_app.sql; } > dashboard/15_member_app.sql
{ echo "-- ATEAM 컨설팅 기준 카드 (내 노하우 기본 제공 21장 · 새 팀 자동 · 다시 받기) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261025000021_consulting_cards.sql; } > dashboard/16_consulting_knowhow.sql
{ echo "-- ATEAM 팀원 목표 수정 켜기·끄기 (팀장이 켜 둔 동안만 팀원이 목표·과제 수정 · 할 일은 자유 · 변경 요청) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261026000022_plan_window.sql; } > dashboard/17_plan_window.sql
{ echo "-- ATEAM 업무플랫폼 그룹 스페이스 + 대화 첨부 (그룹 멤버가 함께 보고 대화 · 새 버전 · 그룹 알림) — SQL Editor에서 한 번 Run (다시 Run 해도 안전)"; echo; cat migrations/20261027000023_work_groups.sql; } > dashboard/18_work_groups.sql
echo "done: supabase/dashboard"
