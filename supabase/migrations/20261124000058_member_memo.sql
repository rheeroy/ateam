-- =====================================================================
-- 팀원 메모 — 팀원 왼쪽 메뉴 '나만 보기 › 📝 메모'
--   같은 표(leader_notes)를 쓰되, 팀원은 '대상 연결 없음 · AI 참고 끔' 메모만 쓸 수 있다
--   (AI는 팀장 본인의 메모만 읽는다. 팀원 메모는 어떤 AI 기능에도 들어가지 않는다)
--   읽기 · 지우기는 예전처럼 쓴 사람만. 다시 Run 해도 안전합니다.
-- =====================================================================
do $$
begin
  if to_regclass('public.leader_notes') is null then return; end if;
  drop policy if exists leader_notes_owner on public.leader_notes;
  create policy leader_notes_owner on public.leader_notes for all to authenticated
    using (owner_id = auth.uid() and public.is_team_member(team_id))
    with check (owner_id = auth.uid() and public.is_team_member(team_id)
      and (public.is_team_leader(team_id) or (ai_allowed = false and anchor_type = 'none')));
end $$;
