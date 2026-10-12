# ATEAM — 팀장의 성과관리 도구

Vite + React + TypeScript + Tailwind · Supabase(Postgres·Auth·Storage·Edge Functions) · Claude API · Vercel

팀장이 1:1, 결과물 리뷰, 주간보고, 평가를 한곳에서 하고, 쌓인 기록으로 AI가 브리핑·검토·평가 초안·실적 전망·What-if를 돕는다.
**내 노하우**: 팀장이 가진 보고 원칙·기획서 기준·프레임워크·사업 맥락을 아무 형식으로 넣으면 AI가 카드로 정리하고, 팀장이 확인한 카드는 리뷰·주간보고·1:1·평가 등 모든 AI 기능에 '팀장의 기준'으로 반영된다. 공개한 카드는 팀원 화면에 '팀장 가이드'로 보인다.
숫자는 SQL 모델이 계산하고 AI는 해석만 한다. 모든 AI 결과에는 출처 표시(✦ AI 생성 · Σ 모델 계산 · ✎ 팀장 수정 · ✓ 팀장 확정 · ◌ 판단 보류)가 붙는다.

---

## 폴더 구조

```
src/
  pages/            화면 (팀장: 홈·목표·과제·내 노하우·1:1·리뷰룸·주간보고·팀 성과·팀 전략·시뮬레이션·평가·AI 인사이트·팀원·설정 / 팀원: 홈·내 목표·과제·체크인·공유하기·내 1:1)
  components/       ui · Prov(출처 표시) · charts(SVG) · Upload · MetricEditor · Layout
  lib/              supabase 클라이언트 · 타입 · sim(What-if 모델) · extract(docx·pptx 텍스트 추출)
  state/session.tsx 로그인·현재 팀·구성원·요금제
supabase/
  migrations/       0001 스키마 · 0002 RLS · 0003 과금 · 0004 트리거·RPC·분석 함수 · 0005 스토리지 · 0006 스케줄(cron) · 0007 내 노하우 · 0008 목표·과제 자유 구조·요청·알림·과금 v2 · 0009 AI 인사이트 예약
  functions/        ai-prep-1on1 · ai-review-submission · ai-weekly-briefing · ai-weekly-report · ai-evaluation-draft · ai-interpret · ai-ingest-knowhow · ai-insights · ai-plan · billing
    _shared/signals.ts 팀 신호 엔진 (홈 화면과 AI 인사이트가 같이 씀)
    _shared/        http · supabase · anthropic · gateway(크레딧·출처·판단 보류) · prompts
  seed.sql          로컬 데모 데이터 (팀장 1 + 팀원 6, 26주치 기록)
  tests/            로컬 Postgres 검증용 스텁·시나리오 테스트
docs/PRICING.md     과금 정책
```

---

## 1. 로컬에서 실행하기

필요: Node 20+, Docker, [Supabase CLI](https://supabase.com/docs/guides/cli)

```bash
npm install
supabase start                # 로컬 Postgres·Auth·Storage + 마이그레이션 + seed.sql
cp .env.example .env.local    # supabase start 출력의 API URL·anon key를 넣는다
npm run dev                   # http://localhost:5173
```

- 데모 계정: `leader@demo.ateam`(팀장), `kim@demo.ateam`(팀원) 등. 로그인 링크는 로컬 메일함(Inbucket, `http://localhost:54324`)에서 연다.
- AI 기능을 로컬에서 쓰려면:
  ```bash
  echo "ANTHROPIC_API_KEY=sk-ant-..." > supabase/functions/.env
  supabase functions serve --env-file supabase/functions/.env
  ```

---

## 2. 배포하기 (Supabase + Vercel)

> **터미널 없이 Supabase 웹 대시보드로만 하려면 → [`supabase/dashboard/README.md`](supabase/dashboard/README.md)** (SQL 2개 + 함수 10개 붙여넣기)
> 아래는 CLI를 쓰는 방법입니다.

### 2-1. Supabase

1. supabase.com에서 새 프로젝트 생성 (리전: 서울 `ap-northeast-2` 권장)
2. 연결하고 스키마를 올린다
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push              # migrations 0001~0006 적용 (seed.sql은 운영에 넣지 않음)
   ```
   - 0006(스케줄)은 `pg_cron`, `pg_net`을 쓴다. 대시보드 Database → Extensions에서 켜져 있는지 확인.
   - 그 다음 SQL Editor에서 한 번 실행:
     ```sql
     select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
     select vault.create_secret('<service_role key>', 'service_role_key');
     ```
3. Edge Function 비밀값과 배포
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set TOSS_SECRET_KEY=test_sk_...          # 결제 쓸 때
   supabase secrets set APP_ORIGIN=https://<your-app>.vercel.app
   # 선택: 모델 교체
   supabase secrets set AI_MODEL_SMART=claude-sonnet-5-5 AI_MODEL_FAST=claude-haiku-4-5
   supabase functions deploy
   ```
4. Auth 설정 (대시보드 Authentication)
   - URL Configuration: Site URL = `https://<your-app>.vercel.app`, Redirect URLs에 `https://<your-app>.vercel.app/**` 추가
   - Providers: Email(매직 링크) 기본. Google을 쓰려면 Google Cloud OAuth 클라이언트를 만들어 등록
   - 운영 메일은 SMTP(예: Resend)를 연결해야 발송 한도에 걸리지 않는다

### 2-2. Vercel

1. 이 폴더를 GitHub 저장소로 올린다
2. Vercel에서 Import → Framework: Vite (자동 인식) → 환경 변수:
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TOSS_CLIENT_KEY`
3. Deploy. `vercel.json`이 SPA 라우팅을 처리한다.

### 2-3. 결제 (토스페이먼츠)

- 토스페이먼츠 가맹 후 **자동결제(빌링)** 계약 필요. 테스트 키로 먼저 확인.
- 클라이언트 키는 `VITE_TOSS_CLIENT_KEY`, 시크릿 키는 Supabase secrets `TOSS_SECRET_KEY`.
- 흐름: 설정 → 요금제 → 카드 등록(결제창) → `billing` 함수가 빌링키 발급 + 첫 결제 → 매일 03:00 cron이 갱신 결제.
- `supabase/functions/billing/index.ts` 상단 주석의 API 경로·필드를 토스 개발자센터 문서로 한 번 더 확인할 것.

---

## 3. 데이터 원칙

- **데이터는 소급할 수 없다** — 쓰지 않는 화면이 있어도 업무 객체·이벤트 로그·근거 원장·실적 지표 테이블은 처음부터 쌓는다.
- **사람에 대한 기록은 팀장만** — 관찰 메모·팀장 메모·근거 원장·평가 초안은 RLS로 팀장만 읽는다. 체크인은 본인과 팀장만.
- **AI 원본은 덮어쓰지 않는다** — `ai_outputs.content`(AI 원본)와 `edited_content`(팀장 수정본)를 따로 보관하고, 트리거가 원본 변경을 막는다.
- **판단 보류** — 판단 근거(결과물·관찰·리뷰 코멘트·팀장 메모·과제 완료)가 기준(기본 8건, 팀 설정에서 변경) 미만이면 AI를 호출하지 않고 '판단 보류'를 남긴다. 크레딧도 차감하지 않는다.

---

## 4. 검증

```bash
npm run build                                   # 타입 체크 + 프로덕션 빌드
cd supabase && ./tests/run.sh                   # 로컬 Postgres(5499)에 스텁+마이그레이션+RLS 시나리오 테스트
deno check supabase/functions/*/index.ts        # Edge Function 타입 체크
```

`tests/run.sh`는 Supabase 없이 순수 Postgres 16으로 RLS·트리거·분석 함수·크레딧 차감을 확인한다 (팀원이 남의 체크인·팀장 메모·근거를 못 보는지, 팀원이 1:1 상태를 못 바꾸는지, AI 원본이 보호되는지 등).

---

## 5. 알려진 한계 / 다음 작업

- 업로드 파일 본문 추출: docx·txt·md는 브라우저에서 추출, PDF는 AI가 원본을 직접 읽는다. hwp는 미지원(PDF로 저장해 올리도록 안내).
- 초대 메일은 자동 발송하지 않는다(링크 복사). Resend 연동 시 `invitations` insert 트리거로 붙이면 된다.
- 캘린더·메신저 연동, 본부 롤업, Batch API 브리핑은 다음 단계.
- `npm run db:types`로 Supabase 생성 타입을 쓰면 `src/lib/types.ts`의 수기 타입을 대체할 수 있다.
