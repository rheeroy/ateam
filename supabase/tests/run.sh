#!/bin/sh
# 로컬 Postgres(5499)에 스텁 + 마이그레이션(스케줄 제외) + 시나리오 테스트
set -e
P="psql -h /var/tmp -p 5499 -U postgres"
$P -q -c "drop database if exists t" -c "create database t"
$P -d t -v ON_ERROR_STOP=1 -q -f tests/_supabase_stub.sql 2>/dev/null
for f in migrations/*.sql; do
  case "$f" in *_schedules.sql) continue;; esac
  $P -d t -v ON_ERROR_STOP=1 -q -f "$f"
done
$P -d t -v ON_ERROR_STOP=1 -f tests/behavior.sql
