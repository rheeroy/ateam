-- 데모 팀 표시 (데모 띠의 팀 고르기 · 직급 · 팀원 화면 기본 계정)
update public.teams set settings = coalesce(settings, '{}'::jsonb)
  || '{"demo_key": "marketing", "demo_label": "마케팅", "demo_default_member": "정우성", "demo_ranks": {"김현정": "차장", "박서연": "과장", "정우성": "과장", "최다은": "대리", "이동욱": "대리", "한수진": "사원"}}'::jsonb
 where is_demo and name = '마케팅기획팀 (데모)';
