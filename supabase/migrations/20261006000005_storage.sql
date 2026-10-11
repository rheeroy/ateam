-- =====================================================================
-- ATEAM · 0005 storage
-- 경로 규칙: submissions/{team_id}/{submission_id}/{version}-{file_name}
-- 읽기: 작성자 + 팀장 / 쓰기: 작성자(본인 결과물 폴더)
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('submissions', 'submissions', false, 26214400)   -- 25MB
on conflict (id) do nothing;

create policy "submissions read" on storage.objects for select to authenticated
using (
  bucket_id = 'submissions'
  and public.can_see_submission(((storage.foldername(name))[2])::uuid)
);

create policy "submissions upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'submissions'
  and public.is_team_member(((storage.foldername(name))[1])::uuid)
  and exists (select 1 from public.submissions s
              where s.id = ((storage.foldername(name))[2])::uuid and s.author_id = auth.uid())
);
