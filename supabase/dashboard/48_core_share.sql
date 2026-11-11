-- ATEAM 핵심 업무 인수인계 전달 권한 고침 — 47_folder_scan 다음에 SQL Editor에서 한 번 Run (다시 Run 해도 안전)

-- =====================================================================
-- 핵심 업무 인수인계 — 전달(history_shares) 권한 고침
--   37_review_fixes 의 전달 규칙이 '같은 팀 과제(item_id)'만 허용해서, 과제 없이 핵심 업무만 보내는 인수인계가 막혔다
--   → 같은 팀 과제 또는 같은 팀 핵심 업무 중 하나면 된다 (나머지 규칙은 그대로)
-- 다시 Run 해도 안전합니다.
-- =====================================================================
drop policy if exists hs_insert on public.history_shares;
create policy hs_insert on public.history_shares for insert to authenticated
  with check (
    (
      exists (select 1 from work_items w where w.id = history_shares.item_id and w.team_id = history_shares.team_id)
      or exists (select 1 from core_works c where c.id = history_shares.core_work_id and c.team_id = history_shares.team_id)
    )
    and (
      (public.is_team_leader(team_id) and status = 'sent'
        and exists (select 1 from team_members m where m.team_id = history_shares.team_id and m.user_id = history_shares.to_id and m.status = 'active'))
      or (to_id = auth.uid() and status = 'requested' and from_id is null and public.is_team_member(team_id)
        and public.team_has_feature(team_id, 'history'))
    ));
