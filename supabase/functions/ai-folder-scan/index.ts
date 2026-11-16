// 온보딩 1단계 — 팀 자료 정리 (팀 폴더의 지난 자료 읽기)
//   화면이 팀장 컴퓨터의 폴더를 하위 폴더까지 훑어 문서에서 글을 뽑고(파일 원본은 올리지 않는다), 묶음(배치)으로 보낸다.
//   action 'digest' : 문서 묶음 하나를 읽고 문서마다 요약 카드를 만든다 (빠른 모델 · 묶음당 2크레딧). 결과는 ai_outputs(folder_scan)에 쌓인다
//   action 'finish' : 쌓인 요약 카드를 모아 뒤에서
//      ① 목표·과제 초안 + 위에서 온 것 + 임원 (ai-onboard 와 같은 plan_draft · 시작하기 초안 횟수에 포함 · 크레딧 없음)
//      ② 지난 일의 흐름 → 핵심 업무 '장'(앱 밖 옛 과제, item_id 없음)으로 넣고 핵심 업무 정리를 돌린다 (처음 한 번만)
//   진행 상태는 ai-onboard 와 같은 teams.settings.onboarding.job — 화면은 같은 방식으로 기다린다
//   읽지 않는 것: 개인 평가 · 급여 · 인사 기록 (화면에서 파일 이름으로 먼저 빼고, 여기서도 내용으로 걸러 버린다)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { runAi, SourceBook, BASE_RULES, assertCredits } from '../_shared/gateway.ts';
import { MODEL_SMART, MODEL_FAST, callClaude, parseJson, type Block } from '../_shared/anthropic.ts';
import { ONBOARD_PLAN, ONBOARD_ORG, setJob } from '../_shared/onboard.ts';
import { kstToday } from '../_shared/signals.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

interface Doc { name: string; path?: string; modified?: string; text: string }
interface Body { action: 'digest' | 'finish'; team_id: string; job: string; batch?: number; docs?: Doc[] }
type Card = {
  n: number; name: string; skip?: boolean; kind: string; year: number | null; summary: string;
  goals?: string[]; org?: string[]; threads?: { topic: string; event: string; when?: string; owner?: string }[];
  standard?: boolean; recurring?: string[];
};

const FREE_RUNS = 3;              // ai-onboard 와 같은 시작하기 초안 횟수
const BATCH_CHARS = 60000;        // 한 묶음 글자 수 상한 (화면은 5만 자 안팎으로 묶는다)
const BATCH_DOCS = 40;
const DOC_CHARS = 14000;
const BATCH_CREDITS = 2;
const MAX_BATCHES = 40;           // 한 번 정리의 묶음 상한
const CORPUS_CHARS = 110000;      // 마무리에서 읽는 요약 카드 전체 상한

// ---------- 문서 묶음 → 요약 카드 ----------
const DIGEST = `과제: 팀장이 ATEAM을 처음 시작하며 맡긴 팀 폴더의 문서 묶음을 읽고, 문서마다 '요약 카드'를 만듭니다.
이 카드들을 모아 나중에 ① 팀목표 초안 ② 위에서 온 방침·임원 ③ 지난 몇 년의 업무 흐름(핵심 업무 히스토리) ④ 팀 표준 노하우를 만듭니다.
규칙:
- 문서에 있는 것만 씁니다. 추측하지 않습니다. 연도·날짜는 문서(또는 파일 이름·수정일)로 확인되는 것만.
- 개인 평가 · 연봉/급여 · 인사 기록 · 징계 · 건강 · 주민번호/계좌 같은 개인 정보 문서는 skip: true 로 두고 다른 칸은 비웁니다. 내용도 옮기지 않습니다.
- 업무 문서 안에 섞인 개인 평가·급여 정보도 옮기지 않습니다.
- kind: plan(사업계획·전략·목표·KPI) | report(보고·실적) | minutes(회의록) | roles(업무 분장·R&R·조직) | guide(매뉴얼·가이드·체크리스트·양식) | retro(회고·사후 분석) | handover(인수인계) | contract(계약·제휴) | other
- summary: 이 문서가 무엇인지 한 문장 (80자)
- goals: 팀이 이루려는 목표·과제·숫자 (문서에 있을 때만, 최대 4)
- org: 팀 위·바깥에서 온 방침·요청·일정·임원 관심사 — "누가(직책) · 무엇" (최대 3)
- threads: 해를 넘겨 이어지는 일의 사건 — topic 은 계속되는 일의 이름(예: "B사 제휴 운영"), event 는 그때 무엇을 정했고/했고/결과가 어땠는지 한 문장(80자), when 은 "YYYY" 또는 "YYYY-MM", owner 는 문서에 나온 담당(직책이나 이름, 모르면 빈 문자열). 최대 5
- standard: 팀이 계속 따라야 할 기준·절차·가이드라면 true (매뉴얼, 체크리스트, 업무 규칙)
- recurring: 해마다·분기마다 반복되는 일 (확인될 때만, 최대 3)
출력 JSON: {"docs":[{"n":문서 번호,"name":"파일 이름","skip":false,"kind":"plan","year":2025,"summary":"","goals":[],"org":[],"threads":[{"topic":"","event":"","when":"2025-03","owner":""}],"standard":false,"recurring":[]}]}`;

// ---------- 지난 흐름 → 장 ----------
const HIST = `과제: 팀 폴더 문서들의 요약 카드에서 '해를 넘겨 이어지는 일'을 찾아, 해마다 한 장(章)씩 정리합니다.
이 장들은 앱의 '핵심 업무 히스토리'로 들어가, 몇 년 뒤 이 일을 넘겨받는 사람이 읽습니다.
규칙:
- 요약 카드에 있는 것만. 추측하지 않습니다. 연도는 카드로 확인되는 것만 (모르는 연도는 만들지 않음).
- 한 장 = 한 가지 일의 한 해. 같은 일이 여러 해 나오면 해마다 따로 장을 만들고 title 을 그해 일 이름으로 씁니다.
- 한 해에 한 번만 나오고 이어지지 않는 일도 의미가 크면 장으로 남겨도 됩니다 (회의 한 번 같은 사소한 것은 버림).
- 개인 평가·급여·인사 내용은 넣지 않습니다. people 에는 관계자(외부 회사·유관 부서·임원 직책)만.
- owner_name: 카드에 나온 담당(직책이나 이름), 모르면 빈 문자열. period: "YYYY-MM ~ YYYY-MM" (모르면 "YYYY").
- 문체: 개조식 명사형. 장은 최대 24개, 각 목록 최대 4개.
출력 JSON: {"chapters":[{"year":2024,"title":"","owner_name":"","period":"",
  "summary":"이 일이 그해 한 것 한 문장 (60자)","key":"그해 핵심 한 줄 (24자 안팎)",
  "decisions":["무엇을 왜 정했나"],"results":"결과 한 문장","lessons":["배운 것 · 안 된 것"],"carried":["다음 해로 넘어간 숙제"],"people":["관계자 — 관계"]}]}`;

async function context(teamId: string, userId: string) {
  const { data: me } = await admin.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (!me || me.role !== 'leader') throw new HttpError(403, 'LEADER_ONLY', '팀장만 쓸 수 있습니다');
  const { data: team } = await admin.from('teams').select('name, mission, settings, created_at').eq('id', teamId).single();
  const settings = (team?.settings ?? {}) as Record<string, unknown>;
  const onboarding = (settings.onboarding ?? {}) as Record<string, unknown>;
  const young = !!team?.created_at && Date.now() - Date.parse(team.created_at) < 30 * 86400000;
  if (!young) throw new HttpError(403, 'ONBOARDING_EXPIRED', '팀을 만든 지 30일이 지나 팀 자료 정리는 쓸 수 없습니다');
  if (onboarding.status !== 'pending') throw new HttpError(403, 'ONBOARDING_DONE', '시작하기 단계에서만 쓸 수 있습니다');
  return { team, settings, onboarding };
}

async function setFolder(teamId: string, folder: Record<string, unknown>) {
  const { data } = await admin.from('teams').select('settings').eq('id', teamId).single();
  const settings = (data?.settings ?? {}) as Record<string, unknown>;
  const onboarding = (settings.onboarding ?? {}) as Record<string, unknown>;
  await admin.from('teams').update({ settings: { ...settings, onboarding: { ...onboarding, folder: { ...(onboarding.folder as object ?? {}), ...folder } } } }).eq('id', teamId);
}

const clean = (s: string) => s.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

serve(async (req) => {
  const body = await readJson<Body>(req);
  if (!body.team_id || !body.job || !/^[0-9a-f-]{36}$/i.test(body.job)) throw new HttpError(400, 'MISSING_FIELDS');
  const caller = await getCaller(req);
  const { team, settings, onboarding } = await context(body.team_id, caller.userId!);

  // ---------- 묶음 하나 읽기 ----------
  if (body.action === 'digest') {
    const docs = (body.docs ?? []).filter((d) => d?.name && d.text?.trim()).slice(0, BATCH_DOCS);
    if (!docs.length) throw new HttpError(422, 'NO_TEXT', '읽을 글이 없습니다');
    const { count: done } = await admin.from('ai_outputs').select('id', { count: 'exact', head: true })
      .eq('team_id', body.team_id).eq('kind', 'folder_scan').eq('content->>job', body.job);
    if ((done ?? 0) >= MAX_BATCHES) throw new HttpError(429, 'FOLDER_LIMIT', `한 번에 ${MAX_BATCHES}묶음까지 읽습니다`);
    // 마무리(초안) 횟수가 이미 다 찼으면 읽기부터 막는다 — 크레딧만 쓰고 초안을 못 만드는 일이 없게
    const { count: runs } = await admin.from('ai_outputs').select('id', { count: 'exact', head: true })
      .eq('team_id', body.team_id).eq('kind', 'plan_draft').eq('content->>onboarding', 'true');
    if ((runs ?? 0) >= FREE_RUNS) throw new HttpError(429, 'ONBOARD_LIMIT', `시작하기에서는 초안을 ${FREE_RUNS}번까지 만들 수 있습니다. 팀목표 화면에서 이어서 다듬어 주세요`);
    await assertCredits(body.team_id, BATCH_CREDITS);

    let left = BATCH_CHARS;
    const parts: string[] = [];
    docs.forEach((d, i) => {
      if (left <= 0) return;
      const t = clean(d.text).slice(0, Math.min(DOC_CHARS, left));
      left -= t.length;
      parts.push(`### 문서 ${i + 1}: ${d.name.slice(0, 160)}${d.path ? ` (폴더: ${d.path.slice(0, 160)})` : ''}${d.modified ? ` · 수정 ${d.modified.slice(0, 10)}` : ''}\n${t}`);
    });
    const content: Block[] = [{ type: 'text', text: `오늘: ${kstToday()}\n팀: ${team?.name}\n\n${parts.join('\n\n')}` }];
    const { output, parsed } = await runAi<{ docs: Card[] }>({
      teamId: body.team_id, kind: 'folder_scan', model: MODEL_FAST, system: DIGEST, content, book: new SourceBook(),
      depth: 1, level: 'L1', createdBy: caller.userId, credits: BATCH_CREDITS, visibility: 'leader', maxTokens: 8000,
      force: true, thinking: 'fast', extra: { job: body.job, batch: body.batch ?? 0, names: docs.map((d) => d.name.slice(0, 160)) },
    });
    const cards = (parsed.docs ?? []).map((c) => ({ ...c, name: docs[(c.n ?? 0) - 1]?.name ?? c.name }));
    return json({
      output_id: output.id,
      read: cards.filter((c) => !c.skip).length,
      skipped: cards.filter((c) => c.skip).map((c) => c.name),
      standard: cards.filter((c) => !c.skip && c.standard).map((c) => c.name),
    });
  }

  if (body.action !== 'finish') throw new HttpError(400, 'BAD_ACTION');

  // ---------- 마무리: 초안 + 지난 흐름 ----------
  const running = (onboarding.job ?? {}) as { status?: string; at?: string };
  if (running.status === 'running' && running.at && Date.now() - Date.parse(running.at) < 7 * 60000) {
    throw new HttpError(409, 'ONBOARD_RUNNING', '초안을 만들고 있습니다. 잠시 뒤 다시 확인해 주세요');
  }
  const { count } = await admin.from('ai_outputs').select('id', { count: 'exact', head: true })
    .eq('team_id', body.team_id).eq('kind', 'plan_draft').eq('content->>onboarding', 'true');
  if ((count ?? 0) >= FREE_RUNS) throw new HttpError(429, 'ONBOARD_LIMIT', `시작하기에서는 초안을 ${FREE_RUNS}번까지 만들 수 있습니다. 팀목표 화면에서 이어서 다듬어 주세요`);

  const { data: outs } = await admin.from('ai_outputs').select('content').eq('team_id', body.team_id).eq('kind', 'folder_scan')
    .eq('content->>job', body.job).order('created_at');
  const cards = (outs ?? []).flatMap((o) => ((o.content as { docs?: Card[] }).docs ?? [])).filter((c) => !c.skip && c.summary);
  if (!cards.length) throw new HttpError(422, 'NO_TEXT', '읽은 문서가 없습니다. 다른 폴더를 골라 주세요');

  const corpus = cards.map((c) => [
    `- [${c.name}] (${c.kind}${c.year ? ` · ${c.year}` : ''}) ${c.summary}`,
    c.goals?.length ? `  목표·과제: ${c.goals.join(' / ')}` : '',
    c.org?.length ? `  위에서 온 것: ${c.org.join(' / ')}` : '',
    c.threads?.length ? `  흐름: ${c.threads.map((t) => `${t.topic}${t.when ? `(${t.when})` : ''}: ${t.event}${t.owner ? ` — ${t.owner}` : ''}`).join(' / ')}` : '',
    c.recurring?.length ? `  반복: ${c.recurring.join(' / ')}` : '',
  ].filter(Boolean).join('\n')).join('\n').slice(0, CORPUS_CHARS);

  const levels = (settings.level_names as string[] | undefined) ?? ['목표', '과제', '할 일'];
  const { data: tm } = await admin.from('team_members').select('user_id, job_title, profiles(full_name)').eq('team_id', body.team_id).eq('status', 'active');
  const people = (tm ?? []).map((m) => ({ id: m.user_id, name: (m.profiles as unknown as { full_name: string })?.full_name ?? '', job: m.job_title }));
  const year = kstToday().slice(0, 4);
  const header = [
    `오늘: ${kstToday()}`, `팀: ${team?.name} / 미션: ${team?.mission || '-'}`,
    `단계 이름: ${levels.join(' > ')}`,
    `팀원: ${people.map((p) => `${p.name}(${p.job || '-'})`).join(', ')} — 아직 팀원을 초대하기 전이라 담당자는 대부분 비워 둡니다`,
    `계획 연도: ${year}년 — 처음 시작하는 팀이므로 자료가 다른 해를 다뤄도 올해(${year}년) 팀목표로 만듭니다. 지난 해 자료는 흐름을 이해하는 데만 쓰고, 올해·최근 자료를 우선합니다. 날짜는 오늘부터 ${year}-12-31 사이로만 잡고, 그 안에 맞출 수 없으면 비워 둡니다`,
    '## 현재 목표·과제\n(없음 — 처음 시작하는 팀)',
  ].join('\n\n');
  const content: Block[] = [{ type: 'text', text: `${header}\n\n## 자료 — 팀장이 맡긴 팀 폴더의 문서 ${cards.length}개를 문서마다 요약한 카드 (원문이 아니라 요약)\n${corpus}` }];
  const seedHistory = !(onboarding.folder as { history_at?: string } | undefined)?.history_at;

  const jobId = body.job;
  const at = new Date().toISOString();
  const book = new SourceBook();
  const work = async () => {
    try {
      const plan = runAi<{ summary: string; ops: unknown[] }>({
        teamId: body.team_id, kind: 'plan_draft', model: MODEL_SMART,
        system: ONBOARD_PLAN, content, book, depth: 1, level: 'L1',
        createdBy: caller.userId, credits: 0, visibility: 'leader', maxTokens: 6000, force: true,
        extra: { onboarding: true, folder: true, job: jobId, scope: null, org: [], execs: [], docs: cards.length, people: people.map((p) => ({ id: p.id, name: p.name })) },
      });
      const log = (res: Awaited<ReturnType<typeof callClaude>>) => admin.rpc('consume_credits', { p_team: body.team_id, p_credits: 0, p_kind: 'folder_scan', p_ai_output: null, p_model: res.model, p_in: res.inputTokens, p_out: res.outputTokens, p_cost: res.costUsd });
      const orgCall = callClaude({ model: MODEL_SMART, system: `${BASE_RULES}\n\n${ONBOARD_ORG}`, content, maxTokens: 3000 })
        .then(async (res) => { await log(res); return parseJson<{ org?: unknown[]; execs?: unknown[] }>(res.text); })
        .catch((e) => { console.error('folder org failed', e); return { org: [], execs: [] }; });
      const histCall = seedHistory
        ? callClaude({ model: MODEL_SMART, system: `${BASE_RULES}\n\n${HIST}`, content: [{ type: 'text', text: `오늘: ${kstToday()}\n팀: ${team?.name}\n\n## 요약 카드\n${corpus}` }], maxTokens: 8000 })
          .then(async (res) => { await log(res); return parseJson<{ chapters?: Record<string, unknown>[] }>(res.text); })
          .catch((e) => { console.error('folder history failed', e); return { chapters: [] }; })
        : Promise.resolve({ chapters: [] as Record<string, unknown>[] });
      const [{ output }, extra, hist] = await Promise.all([plan, orgCall, histCall]);

      // 지난 흐름 → 장 (앱 밖 옛 과제). 올해 이후 연도·연도 없는 것은 넣지 않는다
      const thisYear = Number(year);
      const str = (x: unknown, n: number) => String(x ?? '').slice(0, n);
      const arr = (x: unknown, n = 4) => (Array.isArray(x) ? x : []).map((v) => str(v, 120)).filter(Boolean).slice(0, n);
      const rows = (hist.chapters ?? []).slice(0, 24)
        .filter((c) => Number.isInteger(Number(c.year)) && Number(c.year) >= thisYear - 15 && Number(c.year) <= thisYear && str(c.title, 80).trim())
        .map((c) => ({
          team_id: body.team_id, item_id: null, core_work_id: null, year: Number(c.year), title: str(c.title, 80),
          owner_name: str(c.owner_name, 40), period: str(c.period, 30),
          content: { summary: str(c.summary, 160), key: str(c.key, 40), decisions: arr(c.decisions), results: str(c.results, 200), lessons: arr(c.lessons), carried: arr(c.carried), people: arr(c.people), source: 'folder' },
        }));
      if (rows.length) {
        const { error } = await admin.from('core_work_chapters').insert(rows);
        if (error) console.error('folder chapters insert failed', error);
        else await admin.functions.invoke('ai-core-works', { body: { team_id: body.team_id } }).catch((e) => console.error('core works kick failed', e));
      }

      const merged = { ...(output.content as Record<string, unknown>), org: (extra.org ?? []).slice(0, 8), execs: (extra.execs ?? []).slice(0, 5) };
      await admin.from('ai_outputs').update({ content: merged }).eq('id', output.id as string);
      await setFolder(body.team_id, { at, docs: cards.length, chapters: rows.length, ...(seedHistory && rows.length ? { history_at: at } : {}) });
      await setJob(body.team_id, { id: jobId, status: 'done', at, output_id: output.id });
    } catch (e) {
      console.error('folder finish failed', e);
      const msg = e instanceof HttpError ? e.message : e instanceof Error ? e.message : String(e);
      await setJob(body.team_id, { id: jobId, status: 'failed', at, error: String(msg).slice(0, 300) });
    }
  };
  await setJob(body.team_id, { id: jobId, status: 'running', at });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work());
  else await work();
  return json({ job: jobId, status: 'running', at, docs: cards.length });
});
