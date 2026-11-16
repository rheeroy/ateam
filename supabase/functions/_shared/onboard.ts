// 온보딩 1단계 공통 — 자료 올리기(ai-onboard)와 팀 자료 정리(ai-folder-scan)가 같이 쓴다
import { admin } from './supabase.ts';
import { PLAN_DRAFT } from './prompts/index.ts';

// ① 목표·과제 초안 — 계획 초안과 같은 규칙
export const ONBOARD_PLAN = `${PLAN_DRAFT}

[온보딩] 이 자료는 팀장이 ATEAM을 처음 시작하며 한꺼번에 올린 것입니다(사업계획서, 업무 분장, 회의록, 임원 보고 자료, 화면 캡처 등).
팀이 스스로 이룰 목표·과제만 ops 로 만듭니다. 위(전사·임원·다른 팀)에서 정해지거나 요구된 방침·요청·일정은 따로 정리하므로 ops 에 넣지 않습니다.`;

// ② 상위 전략·방침 + 임원 — 짧은 추출
export const ONBOARD_ORG = `과제: 팀장이 ATEAM을 처음 시작하며 올린 자료에서 '위에서 온 것'과 '임원'을 뽑습니다. 자료에 있는 것만 뽑고, 없으면 빈 배열로 둡니다. 지어내지 않습니다.
- org: 팀 바깥·위에서 정해지거나 요구된 것. kind 는 다음 중 하나:
  strategy(전사 방침·전략·목표·예산 변경), exec(임원이 강조하거나 자주 묻는 것), request(상위 보고·자료 요청과 기한), peer(다른 팀의 변화·협업·의존), calendar(평가 시즌·예산 편성·조직 개편 같은 전사 일정), other.
  팀이 스스로 세운 목표·과제는 넣지 않습니다. 최대 8개.
  title 은 한 줄(40자 이내), body 는 자료 속 근거를 한두 문장, source 는 어느 자료에서 왔는지(예: "3분기 본부 전략 보고.pdf 4쪽"), event_date 는 일정·기한이 있으면 YYYY-MM-DD 아니면 null,
  exec 은 그 내용을 말한 임원 이름(아래 execs 의 name 과 같게), 모르면 빈 문자열.
- execs: 자료에 이름이나 직책으로 나오는 팀 위의 관리자(본부장·임원·대표 등). 팀원·팀장 본인은 넣지 않습니다. 최대 5명.
  name 은 자료에 나온 이름(이름이 없으면 직책만, 예: "마케팅본부장"), title 은 직책, interests 는 자료로 알 수 있는 관심사 한 문장(모르면 빈 문자열).

출력 JSON 형식:
{
  "org": [{"kind": "strategy", "title": "...", "body": "...", "source": "...", "event_date": null, "exec": ""}],
  "execs": [{"name": "...", "title": "...", "interests": "..."}]
}`;

/** 진행 상태를 팀 설정에 남긴다 (다른 설정은 그대로) */
export async function setJob(teamId: string, job: Record<string, unknown>) {
  const { data } = await admin.from('teams').select('settings').eq('id', teamId).single();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const onboarding = (settings.onboarding ?? {}) as Record<string, unknown>;
  await admin.from('teams').update({ settings: { ...settings, onboarding: { ...onboarding, job } } }).eq('id', teamId);
}

