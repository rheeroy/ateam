# Supabase 웹 대시보드로 세팅하기 (터미널 없이)

이 폴더(`supabase/dashboard`)에 있는 파일만 쓰면 됩니다.

| 파일 | 쓰는 곳 |
|---|---|
| `01_schema.sql` | SQL Editor에서 한 번 실행 — 테이블·권한·트리거·함수·스토리지 전부 |
| `02_schedules.sql` | SQL Editor에서 한 번 실행 — 월요일 브리핑·결제 갱신 예약 (나중에 해도 됨) |
| `03_add_knowhow.sql` | (예전 프로젝트용) '내 노하우' 추가분 — 새로 시작하면 01에 포함 |
| `04_upgrade_v2.sql` | **예전 `01_schema.sql`을 이미 실행한 프로젝트만** 한 번 실행 — v2 (목표·과제 자유 구조, 팀원 계획·승인, 요청·알림, 공유 유형, 과금 v2). 기존 목표·과제 데이터는 자동으로 옮겨짐 |
| `05_schedules_v2.sql` | **예전 `02_schedules.sql`을 이미 실행한 프로젝트만** 한 번 실행 — 일·주·월 AI 인사이트 예약 |
| `functions/*.ts` (10개) | Edge Functions 화면에 붙여넣기 — 파일 하나가 함수 하나 |

`supabase` 폴더의 나머지는 무시해도 됩니다.
- `config.toml` — 터미널(CLI)·로컬 개발용 설정. 웹에서는 안 씀. 같은 내용은 아래 5번에서 화면으로 설정.
- `migrations/` — `01_schema.sql`, `02_schedules.sql`의 원본(같은 내용을 나눠 둔 것).
- `functions/` — Edge Function 원본 코드. 대시보드에는 이걸 하나로 합친 `dashboard/functions/`를 씀.
- `seed.sql` — 로컬 데모 데이터. **운영 프로젝트에는 실행하지 마세요.**
- `tests/` — 개발 검증용.

---

## 순서

**1. 프로젝트 만들기** — supabase.com → New project (Region: Northeast Asia (Seoul))

**2. 스키마** — SQL Editor → New query → `01_schema.sql` 전체 붙여넣기 → Run
   "Success. No rows returned"가 나오면 끝. (한 번만 실행. 두 번 돌리면 '이미 있음' 오류가 납니다.)

**3. AI 키 등록** — Edge Functions → Secrets (또는 Project Settings → Edge Functions)
   - `ANTHROPIC_API_KEY` = Claude API 키 (필수)
   - `APP_ORIGIN` = Vercel 주소 예: `https://ateam.vercel.app` (선택, 보안 강화)
   - `TOSS_SECRET_KEY` = 토스 시크릿 키 (결제 쓸 때)

**4. 함수 10개 배포** — Edge Functions → Deploy a new function → Via Editor
   - 함수 이름을 **파일 이름과 똑같이** 입력: `ai-prep-1on1`, `ai-review-submission`, `ai-weekly-briefing`, `ai-weekly-report`, `ai-evaluation-draft`, `ai-interpret`, `ai-ingest-knowhow`, `ai-insights`, `ai-plan`, `billing`
   - 편집기의 예시 코드를 지우고 해당 `.ts` 파일 내용을 통째로 붙여넣기 → Deploy
   - JWT 검증(Verify JWT) 옵션은 켜 둔 채로 둡니다.

**5. 로그인 설정** — Authentication → URL Configuration
   - Site URL: Vercel 주소
   - Redirect URLs: `https://<vercel 주소>/**` 추가 (로컬 개발도 하면 `http://localhost:5173/**`)
   - Google 로그인을 쓰려면 Authentication → Sign In / Providers → Google 설정
   - 실제 사용자에게 메일을 보내려면 Authentication → Emails → SMTP 연결 권장 (기본 발송 한도가 작음)

**6. Vercel 환경 변수** — Project Settings → API(Data API / API Keys)에서 복사
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon(public) 키
   - `VITE_TOSS_CLIENT_KEY` = 토스 클라이언트 키 (결제 쓸 때)

**7. 예약 작업 (선택)** — Database → Extensions에서 `pg_cron`, `pg_net` 켜기 →
   `02_schedules.sql` 맨 위 두 줄의 `<...>`를 내 값으로 바꿔서 SQL Editor에서 Run.
   (이걸 안 하면 월요일 자동 브리핑만 안 돌고, 앱 안의 '지금 만들기' 버튼은 그대로 됩니다.)

---

## 이미 세팅한 프로젝트를 v2로 올리기
1. SQL Editor → `04_upgrade_v2.sql` 붙여넣기 → Run (03을 아직 안 했다면 03 먼저)
2. SQL Editor → `05_schedules_v2.sql` → Run (02를 실행했던 경우만)
3. Edge Functions → 새 함수 2개 배포: `ai-insights`, `ai-plan`
4. 기존 함수 8개도 새 파일로 코드 교체 후 Deploy (과금 v2·새 구조 반영)

## 이미 세팅한 프로젝트에 '내 노하우' 추가하기
1. SQL Editor → `03_add_knowhow.sql` 붙여넣기 → Run (테이블 2개 + `knowhow` 스토리지 버킷 생성)
2. Edge Functions → 새 함수 `ai-ingest-knowhow` 배포
3. 기존 함수 6개(`ai-prep-1on1`, `ai-review-submission`, `ai-weekly-briefing`, `ai-weekly-report`, `ai-evaluation-draft`, `ai-interpret`)도 새 파일로 코드 교체 후 Deploy — 노하우를 프롬프트에 반영하는 부분이 들어갔습니다

## 나중에 코드가 바뀌면
- 함수 수정 → 해당 함수 화면에서 코드 교체 후 Deploy
- 스키마 수정 → 바뀐 부분만 담은 SQL을 따로 받아서 실행 (`01_schema.sql`을 다시 돌리지 않기)
- 개발자가 원본을 고쳤다면 `npm run build:dashboard`로 이 폴더를 다시 만들 수 있습니다.

## 컨설팅 기준 카드 + 고도화 v1 (2026-10)
1. SQL Editor → `16_consulting_knowhow.sql` 붙여넣기 → Run (다시 Run 해도 안전). 지금 있는 모든 팀에 '컨설팅 기준' 카드 21장이 들어가고, 새 팀은 자동으로 받습니다.
2. Edge Functions → 아래 15개를 새 파일로 코드 교체 후 Deploy (공통 코드 `_shared`가 바뀌어 모두 다시 배포)
   `ai-advisor` `ai-checkin-draft` `ai-coach` `ai-evaluation-draft` `ai-exec-brief` `ai-ingest-knowhow` `ai-insights` `ai-interpret` `ai-org-impact` `ai-people-actions` `ai-plan` `ai-prep-1on1` `ai-review-submission` `ai-weekly-briefing` `ai-weekly-report` `ai-work-brief`
   - Verify JWT: **끈 상태(OFF) 그대로** 둡니다 (지금 쓰는 설정과 같게). `billing`은 바뀌지 않아 다시 배포하지 않아도 됩니다.
3. 프런트(Vercel)는 SQL을 먼저 실행한 뒤 배포하세요. (순서가 바뀌면 '내 노하우'의 컨설팅 기준 칸이 잠깐 비어 보입니다)

## ATEAM 플레이북 (2026-11) — 컨설팅 기준 21장 → 방법론 78장
1. SQL Editor → `29_playbook.sql` 붙여넣기 → Run (16 다음 · 다시 Run 해도 안전)
   - 모든 팀에 새 카드가 들어갑니다. 팀장이 고친 카드·켜고 끈 상태·반영할 곳은 그대로 둡니다.
   - Starter 팀은 지금처럼 꺼진 채로 들어가고(읽기만 가능), Pro부터 AI가 씁니다.
   - 데모 팀에는 적용 이력과 AI 검토의 '기준 점검'이 함께 채워집니다. (`06_demo_accounts.sql` 을 다시 돌려도 자동으로 채워짐)
2. Edge Functions → 아래 16개를 새 파일로 코드 교체 후 Deploy (공통 코드 `_shared/gateway.ts` 가 바뀜 · `billing`은 그대로)
   `ai-advisor` `ai-checkin-draft` `ai-coach` `ai-evaluation-draft` `ai-exec-brief` `ai-ingest-knowhow` `ai-insights` `ai-interpret` `ai-org-impact` `ai-people-actions` `ai-plan` `ai-prep-1on1` `ai-review-submission` `ai-weekly-briefing` `ai-weekly-report` `ai-work-brief`
3. 프런트(Vercel) 배포 — SQL을 먼저 실행한 뒤. (SQL 전이면 플레이북 화면의 '언제 쓰나·예시·출처'가 비어 보입니다)
- 카드 문안을 고치려면 `supabase/playbook/playbook.json` 을 고치고 `node scripts/build-playbook.mjs` → 새 `29_playbook.sql` 을 다시 Run.

