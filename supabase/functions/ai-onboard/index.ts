// 온보딩 1단계 — 처음 올린 자료 여러 개(PDF·이미지·PPT/엑셀/워드에서 뽑은 글)를 한 번에 읽고
//   ① 팀목표 초안(목표 › 과제 › 할 일 — ai-plan 초안과 같은 ops 형식)
//   ② 위에서 온 것 후보(전사 방향·임원 관심사·상위 요청·유관 부서·전사 일정 → org_notes)
//   ③ 임원 후보(이름·직책·관심사 → executives)
// 을 '제안'으로 돌려준다. 화면에서 팀장이 체크한 것만 반영한다.
// 팀이 온보딩 중(settings.onboarding.status = 'pending')일 때만 쓰고, 크레딧을 쓰지 않는다 (팀당 3번까지).
// 자료가 많으면 오래 걸리므로(요청 대기 한도 150초) 바로 '시작함'을 돌려주고 뒤에서 만든다.
//   진행 상태는 teams.settings.onboarding.job { id, status: running|done|failed, error } — 화면이 이것과 ai_outputs 를 확인한다.
//   목표·과제 초안과 상위 전략·방침·임원 추출은 두 번의 AI 호출로 나눠 동시에 돌려 시간을 줄인다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { runAi, SourceBook, addKnowhow, BASE_RULES } from '../_shared/gateway.ts';
import { MODEL_SMART, callClaude, parseJson, toBase64, type Block } from '../_shared/anthropic.ts';
import { PLAN_DRAFT } from '../_shared/prompts/index.ts';
import { kstToday } from '../_shared/signals.ts';

interface FileRef { path: string; mime: string; name: string }
interface Body { team_id: string; text?: string; files?: FileRef[] }

const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
const MAX_FILES = 10;
const MAX_TOTAL = 16 * 1024 * 1024;   // PDF·이미지 합계 (base64로 늘어난 뒤에도 요청 한도 32MB 안에서)
const FREE_RUNS = 3;

// ① 목표·과제 초안 — 계획 초안과 같은 규칙
const ONBOARD_PLAN = `${PLAN_DRAFT}

[온보딩] 이 자료는 팀장이 ATEAM을 처음 시작하며 한꺼번에 올린 것입니다(사업계획서, 업무 분장, 회의록, 임원 보고 자료, 화면 캡처 등).
팀이 스스로 이룰 목표·과제만 ops 로 만듭니다. 위(전사·임원·다른 팀)에서 정해지거나 요구된 방침·요청·일정은 따로 정리하므로 ops 에 넣지 않습니다.`;

// ② 상위 전략·방침 + 임원 — 짧은 추출
const ONBOARD_ORG = `과제: 팀장이 ATEAM을 처음 시작하며 올린 자료에서 '위에서 온 것'과 '임원'을 뽑습니다. 자료에 있는 것만 뽑고, 없으면 빈 배열로 둡니다. 지어내지 않습니다.
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

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** 진행 상태를 팀 설정에 남긴다 (다른 설정은 그대로) */
async function setJob(teamId: string, job: Record<string, unknown>) {
  const { data } = await admin.from('teams').select('settings').eq('id', teamId).single();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const onboarding = (settings.onboarding ?? {}) as Record<string, unknown>;
  await admin.from('teams').update({ settings: { ...settings, onboarding: { ...onboarding, job } } }).eq('id', teamId);
}

serve(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_FIELDS');
  const caller = await getCaller(req);
  const { data: me } = await admin.from('team_members').select('role').eq('team_id', body.team_id).eq('user_id', caller.userId!).eq('status', 'active').maybeSingle();
  if (!me || me.role !== 'leader') throw new HttpError(403, 'LEADER_ONLY', '팀장만 쓸 수 있습니다');

  const { data: team } = await admin.from('teams').select('name, mission, settings, created_at').eq('id', body.team_id).single();
  const settings = (team?.settings ?? {}) as Record<string, unknown>;
  const onboarding = (settings.onboarding ?? {}) as { status?: string };
  const young = !!team?.created_at && Date.now() - Date.parse(team.created_at) < 30 * 86400000;
  if (!young) throw new HttpError(403, 'ONBOARDING_EXPIRED', '팀을 만든 지 30일이 지나 시작하기 초안은 쓸 수 없습니다. 팀목표 화면의 계획 초안 기능을 써 주세요');
  if (onboarding.status !== 'pending') throw new HttpError(403, 'ONBOARDING_DONE', '시작하기 단계에서만 쓸 수 있습니다. 팀목표 화면의 계획 초안 기능을 써 주세요');
  const { count } = await admin.from('ai_outputs').select('id', { count: 'exact', head: true })
    .eq('team_id', body.team_id).eq('kind', 'plan_draft').eq('content->>onboarding', 'true');
  const running = ((onboarding as Record<string, unknown>).job ?? {}) as { status?: string; at?: string };
  if (running.status === 'running' && running.at && Date.now() - Date.parse(running.at) < 7 * 60000) {
    throw new HttpError(409, 'ONBOARD_RUNNING', '초안을 만들고 있습니다. 잠시 뒤 다시 확인해 주세요');
  }
  if ((count ?? 0) >= FREE_RUNS) throw new HttpError(429, 'ONBOARD_LIMIT', `시작하기에서는 초안을 ${FREE_RUNS}번까지 만들 수 있습니다. 팀목표 화면에서 이어서 다듬어 주세요`);

  const files = (body.files ?? []).slice(0, MAX_FILES);
  const text = (body.text ?? '').trim();
  if (!files.length && !text) throw new HttpError(422, 'NO_TEXT', '자료를 올리거나 내용을 붙여 넣어 주세요');

  const levels = (settings.level_names as string[] | undefined) ?? ['목표', '과제', '할 일'];
  const { data: tm } = await admin.from('team_members').select('user_id, job_title, profiles(full_name)').eq('team_id', body.team_id).eq('status', 'active');
  const people = (tm ?? []).map((m) => ({ id: m.user_id, name: (m.profiles as unknown as { full_name: string })?.full_name ?? '', job: m.job_title }));

  const content: Block[] = [];
  let total = 0;
  for (const f of files) {
    if (!f.path?.startsWith(`${body.team_id}/`) || f.path.includes('..') || f.path.includes('\\')) throw new HttpError(403, 'forbidden');
    const isPdf = f.mime === 'application/pdf';
    const isImg = (IMAGE_MIME as readonly string[]).includes(f.mime);
    if (!isPdf && !isImg) throw new HttpError(415, 'UNSUPPORTED_FILE', `${f.name}: PDF·이미지만 원본으로 올릴 수 있습니다`);
    const { data: file, error } = await admin.storage.from('knowhow').download(f.path);
    if (error) throw error;
    const bytes = new Uint8Array(await file.arrayBuffer());
    total += bytes.length;
    if (total > MAX_TOTAL) throw new HttpError(413, 'FILE_TOO_LARGE', 'PDF·이미지는 합쳐서 16MB까지 올릴 수 있습니다. 큰 PDF는 필요한 쪽만 남기거나 나눠 올려 주세요');
    content.push(isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) }, title: f.name.slice(0, 120) }
      : { type: 'image', source: { type: 'base64', media_type: f.mime as typeof IMAGE_MIME[number], data: toBase64(bytes) } });
    if (isImg) content.push({ type: 'text', text: `(위 이미지: ${f.name})` });
  }

  const book = new SourceBook();
  await addKnowhow(book, body.team_id, 'plan', 2000, false);
  const header = [
    `오늘: ${kstToday()}`, `팀: ${team?.name} / 미션: ${team?.mission || '-'}`,
    `단계 이름: ${levels.join(' > ')}`,
    `팀원: ${people.map((p) => `${p.name}(${p.job || '-'})`).join(', ')} — 아직 팀원을 초대하기 전이라 담당자는 대부분 비워 둡니다`,
    `계획 연도: ${kstToday().slice(0, 4)}년 — 처음 시작하는 팀이므로 자료가 다른 해(예: 내년 사업계획)를 다뤄도 올해(${kstToday().slice(0, 4)}년) 팀목표로 만듭니다. 날짜는 오늘부터 ${kstToday().slice(0, 4)}-12-31 사이로만 잡고, 그 안에 맞출 수 없으면 비워 둡니다`,
    book.knowhowText(),
    '## 현재 목표·과제\n(없음 — 처음 시작하는 팀)',
  ].filter(Boolean).join('\n\n');
  content.push({ type: 'text', text: `${header}\n\n## 자료 (PDF·이미지는 위에 첨부, 아래는 PPT·엑셀·워드에서 뽑은 글과 붙여 넣은 글)\n${text.slice(0, 120000) || '(첨부만)'}` });

  const jobId = crypto.randomUUID();
  const at = new Date().toISOString();
  const work = async () => {
    try {
      const plan = runAi<{ summary: string; ops: unknown[] }>({
        teamId: body.team_id, kind: 'plan_draft', model: MODEL_SMART,
        system: ONBOARD_PLAN, content, book, depth: 1, level: 'L1',
        createdBy: caller.userId, credits: 0, visibility: 'leader', maxTokens: 6000,
        extra: { onboarding: true, job: jobId, scope: null, org: [], execs: [], people: people.map((p) => ({ id: p.id, name: p.name })) },
      });
      const orgCall = callClaude({ model: MODEL_SMART, system: `${BASE_RULES}\n\n${ONBOARD_ORG}`, content, maxTokens: 3000 })
        .then(async (res) => {
          await admin.rpc('consume_credits', { p_team: body.team_id, p_credits: 0, p_kind: 'plan_draft', p_ai_output: null, p_model: res.model, p_in: res.inputTokens, p_out: res.outputTokens, p_cost: res.costUsd });
          return parseJson<{ org?: unknown[]; execs?: unknown[] }>(res.text);
        })
        .catch((e) => { console.error('onboard org failed', e); return { org: [], execs: [] }; });   // 이쪽이 실패해도 목표 초안은 보여 준다
      const [{ output }, extra] = await Promise.all([plan, orgCall]);
      const merged = { ...(output.content as Record<string, unknown>), org: (extra.org ?? []).slice(0, 8), execs: (extra.execs ?? []).slice(0, 5) };
      await admin.from('ai_outputs').update({ content: merged }).eq('id', output.id as string);
      await setJob(body.team_id, { id: jobId, status: 'done', at, output_id: output.id });
    } catch (e) {
      console.error('onboard failed', e);
      const msg = e instanceof HttpError ? e.message : e instanceof Error ? e.message : String(e);
      await setJob(body.team_id, { id: jobId, status: 'failed', at, error: String(msg).slice(0, 300) });
    }
  };
  // '시작함'을 먼저 남기고 일을 시작한다 (순서가 바뀌면 빨리 끝난 결과를 '진행 중'이 덮어쓸 수 있다)
  await setJob(body.team_id, { id: jobId, status: 'running', at });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work());
  else await work();
  return json({ job: jobId, status: 'running', at });
});
