-- ATEAM 비용 줄이기 (안 읽음 수 함수 · AI 자동 검토 예산 확인) — 19 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 비용 줄이기
--   · space_unread : 탭 배지(안 읽음 수)를 스페이스마다 여러 번 조회하던 것을 함수 한 번으로
--   · ai_budget    : 이번 달 AI 원가 / 상한 (예외 없이 숫자만) — 자동 1차 검토는 상한의 60%까지만 쓰고
--                    나머지는 팀장이 직접 누르는 AI(코칭·인사이트·직접 검토) 몫으로 남긴다
-- 19_work_space.sql 다음에 Run. 다시 Run 해도 안전합니다.
-- =====================================================================

create or replace function public.space_unread(p_team uuid, p_keys text[]) returns table (space_key text, n int)
language sql stable security definer set search_path = public as $$
  with k as (
    select sk, split_part(sk, ':', 1) as kind, nullif(split_part(sk, ':', 2), '')::uuid as sid from unnest(p_keys) as sk
  ), ok as (
    select k.* from k
     where (k.kind = 'u' and (k.sid = auth.uid() or public.is_team_leader(p_team)))
        or (k.kind = 'g' and (public.in_work_group(k.sid) or public.is_team_leader(p_team)))
  ), r as (
    select ok.*, coalesce((select read_at from space_reads s where s.user_id = auth.uid() and s.space_key = ok.sk), '1970-01-01'::timestamptz) as since from ok
  )
  select r.sk, (
      (select count(*) from space_messages m
        where m.team_id = p_team and ((r.kind = 'u' and m.space_user = r.sid) or (r.kind = 'g' and m.group_id = r.sid))
          and m.author_id <> auth.uid() and m.created_at > r.since)
    + (select count(*) from review_comments c join submissions s on s.id = c.submission_id
        where c.team_id = p_team and ((r.kind = 'u' and s.space_id = r.sid) or (r.kind = 'g' and s.group_id = r.sid))
          and c.author_id <> auth.uid() and c.created_at > r.since)
    + (select count(*) from submission_versions v join submissions s on s.id = v.submission_id
        where v.team_id = p_team and ((r.kind = 'u' and s.space_id = r.sid) or (r.kind = 'g' and s.group_id = r.sid))
          and v.created_by <> auth.uid() and v.created_at > r.since)
    + (select count(*) from team_requests t
        where r.kind = 'u' and t.team_id = p_team and t.to_id = r.sid and t.from_id <> auth.uid()
          and t.kind not in ('meeting', 'change') and t.created_at > r.since)
    )::int
  from r;
$$;
grant execute on function public.space_unread(uuid, text[]) to authenticated;

create index if not exists review_comments_team_created_idx on public.review_comments (team_id, created_at);
create index if not exists space_messages_created_idx on public.space_messages (team_id, created_at);

-- 이번 달 AI 원가와 상한 (Edge Function 의 service role 만)
create or replace function public.ai_budget(p_team uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_plan plans; v_bal credit_balances; v_sub subscriptions; v_cost numeric; v_cap numeric;
begin
  select owner_id into v_owner from teams where id = p_team;
  if v_owner is null then return null; end if;
  v_plan := public.effective_plan_for_owner(v_owner);
  v_bal := public._ensure_credit_period(v_owner);
  select * into v_sub from subscriptions where owner_id = v_owner;
  v_cap := case when v_sub.status = 'trialing' then least(v_plan.ai_cost_cap_usd, 4) else v_plan.ai_cost_cap_usd end;
  select coalesce(sum(cost_usd), 0) into v_cost from credit_ledger
   where owner_id = v_owner and reason in ('core_usage', 'ai_error') and created_at >= v_bal.period_start;
  return jsonb_build_object('cost_usd', v_cost, 'cap_usd', v_cap);
end $$;
revoke all on function public.ai_budget(uuid) from public, anon, authenticated;
