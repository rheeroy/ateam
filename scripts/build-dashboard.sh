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
# 03: 이전 01_schema.sql 을 이미 실행한 프로젝트용 추가분
cp migrations/20261011000007_knowhow.sql dashboard/03_add_knowhow.sql
echo "done: supabase/dashboard"
