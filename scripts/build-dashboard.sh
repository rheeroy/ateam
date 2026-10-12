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
echo "done: supabase/dashboard"
