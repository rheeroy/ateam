// 핵심 업무 — 해마다 이름이 다른 과제를 AI가 같은 일의 연속으로 묶고, 여러 해의 흐름을 정리한다 (팀장 승인 없음 · 모두 자동)
//   매주 월요일 06:30 (과제 히스토리 업데이트 다음) · 팀장 [지금 정리]
//   ① 장 접기: 끝났거나 해가 지난 과제의 히스토리를 한 장으로 접어 고정 (빠른 모델 · 한 번만)
//   ② 묶기: 아직 안 묶인 과제 + 이번 주 바뀐 과제를 기존 핵심 업무와 비교해 묶기 · 옮기기 · 새로 만들기 (빠른 모델 · 한 번)
//      확실할 때만 묶는다. 애매하면 '단독 과제'로 두고 다음 주에 다시 본다
//   ③ 정리: 바뀐 핵심 업무만, 원본 기록이 아니라 장 + 진행 중 과제 히스토리 요약을 읽고 다시 쓴다 (정밀 모델)
//   읽지 않는 것: 과제 히스토리에 이미 빠져 있는 것(1on1 · 컨디션 · 관찰 메모 · 평가 · 코칭)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { getCaller, assertLeader, assertFeature } from '../_shared/supabase.ts';
import { runCoreWorks } from '../_shared/coreWorks.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

serve(async (req) => {
  const body = await readJson<{ team_id?: string; weekly?: boolean }>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const caller = await getCaller(req);
  await assertLeader(caller, body.team_id);
  await assertFeature(body.team_id, 'history');
  const work = runCoreWorks(body.team_id, caller.userId);
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return json({ status: 'running' });
});
