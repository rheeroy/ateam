// AUTOPILOT (자율주행) — 팀장이 버튼을 누르면 팀 데이터를 한 번에 읽고 핵심 질문 7개를 진단한다
//   1 지금 하지 않으면 크리티컬한 일 (상향·유관부서 포함) · 2 병목과 원인 (유관부서·팀장 본인 포함)
//   3 우선순위 대비 리소스 · 4 이번 분기 목표 시뮬레이션(계산값 + 리스크) · 5 사람관리
//   6 이렇게 해보세요(솔루션) · 7 한 걸음 물러서서
// 실행 횟수(autopilot_quota)를 쓰고, 오래 걸리므로 바로 run_id 를 돌려주고 뒤에서 만든다 (화면은 autopilot_runs 를 확인).
// 끝나면 팀 설정의 모드(실행 시점 값)에 따라 허용된 액션을 자동으로 보낸다 — 민감 내용은 어떤 모드에서도 보내지 않는다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { loadRaw, analyze, signalsFor, sectionOf, kstToday, addDaysYmd, DOMAIN_META, TYPE_LABEL, SECTION_NAME, type RawMember } from '../_shared/signals.ts';
import { NOTE_RULE, addLeaderNotes } from '../_shared/notes.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const DAY = 86400000;
const since = (d: number) => new Date(Date.now() - d * DAY).toISOString();

export const ACTION_TYPES = ['praise', 'cheer', 'push', 'progress', 'rework', 'thread', 'grow', 'plan', 'oo', 'memo'] as const;
type ActType = typeof ACTION_TYPES[number];
/** 반자동 추천값 — 화면(src/lib/autopilot.ts)과 같게 */
const SEMI_DEFAULT: Record<ActType, boolean> = { praise: true, cheer: true, progress: true, rework: true, push: true, thread: false, grow: false, plan: false, oo: false, memo: true };
const SENSITIVE = /(건강|병원|아프|아픈|질병|수술|진단|우울|불안|스트레스|번아웃|개인\s*사정|가족|육아|출산|임신|결혼|이혼|장례|이직|퇴사|그만두|면접|연봉|급여|보상|성과급|승진|평가\s*등급|등급|징계|갈등|다툼|괴롭힘|불화)/;
const AUTO_CAP_PER_MEMBER = 2;

const AUTOPILOT = `과제: 당신은 팀장의 'AUTOPILOT(자율주행)'입니다. 팀장이 버튼을 한 번 누르면, 팀 데이터를 읽고 아래 핵심 질문에 답하고, 팀원에게 바로 보낼 수 있는 짧은 메시지까지 준비합니다.
입력: 계산된 팀 신호, 팀원(M#)·과제(I#)·결과물(S#)·목표(G#) 목록, 위에서 온 것(전사·임원·상위 요청·유관부서·전사 일정), 팀장 운영 부담, 목표별 분기 말 예상치(계산값).

핵심 질문과 출력 위치:
1 critical — 지금 하지 않으면 크리티컬한 일은? 이번 주~2주 안에 손대지 않으면 문제가 되는 것. 팀 안(기한 임박·계획보다 늦은 항목·막힘)과 위·옆(상위 요청 마감·전사 일정·방침 변경으로 바로 손봐야 할 것·유관부서와 주고받을 것)을 함께 봅니다.
2 bottleneck — 현재 팀의 병목과 원인은? 일이 멈춘 구조적 원인. 팀 안(막힘·리뷰 대기·결정 대기·재계획 반복)과 위·옆(유관부서 일정·외부 의존·전사 방침과의 충돌), 팀장 본인이 병목인 것(리뷰 적체·답 안 한 요청)까지.
3 resource — 우선순위는 높은데 리소스가 적게 투입되는 곳은? 기여도 대비 투입 시간, 한 사람에게 몰린 일, 손대지 않은 중요 과제.
4 forecast — 이대로 가면 이번 분기 목표 달성은 어떻게 될까? 목표별 '지금 속도' 예상치는 입력의 계산값을 그대로 쓰고, 당신은 리스크가 터졌을 때와 제안을 실행했을 때의 변화폭(%p)만 판단합니다.
5 people — 사람관리에서 내가 놓치거나 챙기면 좋은 것은? 컨디션 하락·이탈 신호·1on1 공백·인정이 필요한 사람·성장 기회.
6 solutions — 문제를 해결하거나 성과를 높이기 위해서는 이렇게 해보세요. 1~5를 종합한 우선순위 행동 3개.
7 perspective — 한 걸음 물러서서, 관점을 다르게 보기. 생각할 거리 하나. 할 일 목록이 아닙니다.

진단(diagnosis) 원칙:
- 질문마다 1~4줄. 입력에 있는 사실만, 숫자는 입력의 계산값만. 문장 끝에 근거 [E#]. tag 는 출처를 짧게(예: "임원 브리핑 · 상위 요청", "유관부서 · 영업팀", "팀목표", "컨디션 공유").
- level: high(이번 주 꼭) | mid. 해당하는 것이 없으면 diagnosis 를 빈 배열로 두고 note 에 "이번엔 특별히 없습니다"처럼 한 줄.
- 같은 사실을 여러 질문에 반복하지 않습니다. 1은 '지금', 2는 '왜', 4는 '앞으로'로 나눕니다.

팀원에게 보낼 액션(actions) 원칙 — 팀장 이름으로 그대로 나가는 메시지입니다:
- type: praise(칭찬 배지) · cheer(지원·격려) · push(업무 독려, 과제 지정 없음) · progress(진척 공유·성과입력 리마인드, item 필수) · rework(보완 요청한 결과물 리마인드, submission 필수, 상태가 보완 요청인 것만) · thread(결과물 스레드에 남길 짧은 피드백, submission 필수) · grow(육성 제안) · plan(계획을 세워 달라는 요청, item 있으면 지정) · oo(1on1 제안) · memo(팀장만 보는 관찰 메모 — 팀원에게 가지 않음).
- member 는 입력의 M#. item 은 I#, submission 은 S#. 목록에 없는 대상은 쓰지 않습니다.
- message: 팀장의 말투로 1~2문장, 부드러운 존댓말("~해 줄래요?", "~고마워요"). 근거 태그를 넣지 않습니다.
  구체적인 업무 지시(무엇을 언제까지 어떻게)는 쓰지 않습니다. "진척이 계획보다 느려 보여요, 상황을 한 번 공유해 줄래요?", "가설 2는 근거를 한 번 더 고민해 보면 좋겠어요"처럼 관찰과 방향만 씁니다.
  칭찬은 무엇을 잘했는지 구체적으로(입력에 있는 사실로). memo 는 "[잘한 점] ..." 또는 "[우려] ..."로 시작하는 관찰 기록.
- sensitive: 메시지나 그 이유가 건강·개인 사정·이탈·평가·보상·갈등에 닿으면 그 내용을 짧게(예: "개인 사정 언급"), 아니면 빈 문자열.
- 질문당 최대 3개, 전체 최대 10개. 한 사람에게 3개를 넘기지 않습니다. 1on1·지원·칭찬은 5 people 에, 독려·리마인드는 1·2에 둡니다.

팀장 할 일(todos): 팀원에게 보내지 않고 팀장이 직접 할 일(상위 보고·유관부서 협의·담당 조정·결정·리뷰). text 한 문장, link 는 goals|work|people|upward|decide|knowhow|none, label 은 버튼 문구(예: "임원 브리핑에서 보기").

forecast:
- goals: 입력의 G# 마다 { "ref": "G1", "risk_delta": -18, "plan_delta": 12, "note": "한 줄" }. risk_delta 는 아래 risks 가 터졌을 때 분기 말 달성률 변화(%p, -40~0), plan_delta 는 6 solutions 를 실행했을 때(0~+30). 근거가 약하면 0에 가깝게.
- risks: 최대 4개 { "title", "likelihood": "high|mid", "impact": "제휴 −18%p" 처럼 짧게, "detail": 한 줄 [E#] }. 가능성 × 영향이 큰 순.
- lever: 결과를 가장 크게 움직이는 레버 하나 { "text": 한두 문장, "goal_ref": "G2" }.
- todos: 위에 먼저 알리기·리스크 대응 과제 추가 같은 팀장 할 일.

solutions: 정확히 3개, 우선순위 순 { "title": 명령형 한 문장, "why": 한두 문장 [E#], "effect": 기대 효과 짧게(숫자는 계산값만), "link", "label" }.
perspective: { "text": 3~4문장. 이번 주 할 일을 다시 쓰지 않고, 팀 상황을 다른 틀로 보게 하는 관점. "sources": 적용한 팀장 노하우·ATEAM Method™ 이름(없으면 빈 문자열) }.
headline: 이번 실행의 한 문장 요약.

출력 JSON:
{
  "headline": "...",
  "sections": {
    "critical":   { "diagnosis": [{ "text": "... [E1]", "level": "high", "tag": "..." }], "note": "", "actions": [{ "type": "push", "member": "M2", "item": null, "submission": null, "message": "...", "sensitive": "" }], "todos": [{ "text": "...", "link": "upward", "label": "..." }] },
    "bottleneck": { ... }, "resource": { ... }, "people": { ... }
  },
  "forecast": { "goals": [...], "risks": [...], "lever": {...}, "todos": [...] },
  "solutions": [...],
  "perspective": { "text": "...", "sources": "" }
}`;

type Diag = { text: string; level?: string; tag?: string };
type RawAct = { type: string; member?: string; item?: string | null; submission?: string | null; message?: string; sensitive?: string };
type Todo = { text: string; link?: string; label?: string };
type Sec = { diagnosis?: Diag[]; note?: string; actions?: RawAct[]; todos?: Todo[] };
interface Out {
  headline?: string;
  sections?: Record<'critical' | 'bottleneck' | 'resource' | 'people', Sec>;
  forecast?: { goals?: { ref: string; risk_delta?: number; plan_delta?: number; note?: string }[]; risks?: { title: string; likelihood?: string; impact?: string; detail?: string }[]; lever?: { text?: string; goal_ref?: string }; todos?: Todo[] };
  solutions?: { title: string; why?: string; effect?: string; link?: string; label?: string }[];
  perspective?: { text?: string; sources?: string };
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const ymdDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
function quarterEnd(today: string) {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const qm = Math.ceil(m / 3) * 3;
  return `${y}-${String(qm).padStart(2, '0')}-${qm === 6 || qm === 9 ? '30' : '31'}`;
}

async function setRun(id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from('autopilot_runs').update(patch).eq('id', id);
  if (error) console.error('autopilot setRun failed', id, error.message);
}
// 모델 출력이 기대와 다른 모양이어도 화면이 깨지지 않게
const arr = <T,>(v: unknown, n: number): T[] => (Array.isArray(v) ? (v as T[]).slice(0, n) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const cleanDiag = (v: unknown) => arr<Diag>(v, 4).filter((d) => d && typeof d === 'object').map((d) => ({ text: str(d.text), level: d.level === 'high' ? 'high' : 'mid', tag: str(d.tag) })).filter((d) => d.text);
const cleanTodo = (v: unknown) => arr<Todo>(v, 3).filter((t) => t && typeof t === 'object').map((t) => ({ text: str(t.text), link: str(t.link), label: str(t.label) })).filter((t) => t.text);

async function build(teamId: string, leaderId: string, runId: string) {
  const { data: team } = await admin.from('teams').select('id, name, mission, settings').eq('id', teamId).single();
  const { data: tm } = await admin.from('team_members').select('user_id, role, job_title, weekly_hours, joined_at, profiles(full_name)').eq('team_id', teamId).eq('status', 'active');
  const all: RawMember[] = (tm ?? []).map((m) => ({ user_id: m.user_id, role: m.role, name: (m.profiles as unknown as { full_name: string })?.full_name ?? '' }));
  const members = (tm ?? []).filter((m) => m.role === 'member');
  const nameOf = new Map(all.map((m) => [m.user_id, m.name]));
  const today = kstToday();
  const qEnd = quarterEnd(today);
  const minEv = Number((team?.settings as Record<string, unknown>)?.min_judgment_evidence ?? 8);
  const book = new SourceBook();
  const parts: string[] = [];

  // 팀 신호 (계산값)
  const raw = await loadRaw(admin, teamId, leaderId, minEv);
  const { signals, domains } = analyze(raw, all);
  for (const s of signalsFor('weekly', signals).slice(0, 20)) book.add('signal', null, `[${SECTION_NAME[sectionOf(s)]}] ${DOMAIN_META[s.domain].name} · ${TYPE_LABEL[s.type]}`, `${s.title}${s.detail ? ` — ${s.detail}` : ''}`);
  parts.push(`## 영역별 상태 (계산값)\n${domains.map((d) => `${DOMAIN_META[d.domain].name}: ${d.status}, ${d.kpiLabel} ${d.kpi}`).join('\n')}`);
  await setRun(runId, { step: 1 });

  // 팀원 (M#) — 부하 · 컨디션 추이 · 1on1 · 마지막 칭찬 · 팀장 접점
  const [{ data: items }, { data: ck }, { data: oos }, { data: praises }, { data: attnRows }] = await Promise.all([
    admin.from('work_items').select('id, owner_id, parent_id, title, status, progress, start_date, due_date, base_start, base_due, created_at, est_hours_per_week, contribution, replan_count').eq('team_id', teamId).not('status', 'in', '(dropped,proposed)'),
    admin.from('checkins').select('user_id, week_start, condition, moods').eq('team_id', teamId).gte('week_start', addDaysYmd(today, -35)).order('week_start'),
    admin.from('one_on_ones').select('member_id, scheduled_at, status').eq('team_id', teamId).gte('scheduled_at', since(90)).order('scheduled_at', { ascending: false }),
    admin.from('observations').select('subject_id, occurred_at').eq('team_id', teamId).eq('kind', 'praise').gte('occurred_at', addDaysYmd(today, -90)),
    admin.rpc('leader_attention', { p_team: teamId, p_days: 28 }),
  ]);
  const attn = new Map(((attnRows ?? []) as { user_id: string; touch: number; oo: number; waiting: number }[]).map((r) => [r.user_id, r]));
  const mRef = new Map<string, string>(); const mId = new Map<string, string>();
  const mLines = members.map((m, i) => {
    const ref = `M${i + 1}`; mRef.set(m.user_id, ref); mId.set(ref, m.user_id);
    const mine = (items ?? []).filter((x) => x.owner_id === m.user_id && x.status !== 'done');
    const hours = mine.reduce((a, x) => a + Number(x.est_hours_per_week ?? 0), 0);
    const conds = (ck ?? []).filter((c) => c.user_id === m.user_id && c.condition != null).map((c) => c.condition);
    const moods = (ck ?? []).filter((c) => c.user_id === m.user_id).slice(-1)[0]?.moods ?? [];
    const lastOo = (oos ?? []).find((o) => o.member_id === m.user_id && o.status !== 'canceled');
    const lastPraise = (praises ?? []).filter((p) => p.subject_id === m.user_id).map((p) => p.occurred_at).sort().slice(-1)[0];
    const a = attn.get(m.user_id);
    return `${ref} ${nameOf.get(m.user_id)} (${m.job_title || '-'}, 입사 ${Math.floor((Date.now() - Date.parse(m.joined_at)) / DAY)}일): 진행 ${mine.length}건 · 막힘 ${mine.filter((x) => x.status === 'blocked').length} · 부하 주 ${hours}h/${m.weekly_hours}h(${m.weekly_hours ? Math.round((hours / m.weekly_hours) * 100) : '-'}%)`
      + ` · 컨디션(5점) ${conds.length ? conds.join('→') : '공유 없음'}${moods.length ? ` · 최근 고른 요인 ${moods.join(', ')}` : ''}`
      + ` · 마지막 1on1 ${lastOo ? `${Math.floor((Date.now() - Date.parse(lastOo.scheduled_at)) / DAY)}일 전` : '90일 내 없음'} · 마지막 칭찬 ${lastPraise ? `${Math.max(0, ymdDiff(today, String(lastPraise).slice(0, 10)))}일 전` : '90일 내 없음'}`
      + (a ? ` · 팀장 접점 28일 ${a.touch} · 반응 대기 ${a.waiting}` : '');
  });
  book.add('members', null, '팀원 현황 (M#)', mLines.join(' | '));

  // 목표 (G#) — 분기 말 예상치 계산
  const yr = today.slice(0, 4);
  const roots = (items ?? []).filter((x) => !x.parent_id && x.status !== 'done' && String(x.start_date ?? x.base_start ?? x.due_date ?? x.created_at).slice(0, 4) === yr);
  const gRef = new Map<string, string>(); const gId = new Map<string, string>();
  const outlook = new Map((raw.goals ?? []).map((g) => [g.goal_id, g]));
  const goals = roots.slice(0, 6).map((g, i) => {
    const ref = `G${i + 1}`; gRef.set(g.id, ref); gId.set(ref, g.id);
    const start = String(g.start_date ?? g.base_start ?? g.created_at).slice(0, 10);
    const due = g.due_date ? String(g.due_date) : null;
    const elapsed = Math.max(7, ymdDiff(today, start));
    const left = Math.max(0, ymdDiff(qEnd, today));
    const p = Number(g.progress ?? 0);
    const base = clamp(p + (p / elapsed) * left);
    const planNow = due ? clamp(((Date.parse(today) - Date.parse(start)) / Math.max(DAY, Date.parse(due) - Date.parse(start))) * 100) : null;
    const planQ = due ? clamp(((Date.parse(qEnd) - Date.parse(start)) / Math.max(DAY, Date.parse(due) - Date.parse(start))) * 100) : null;
    const o = outlook.get(g.id);
    return { ref, id: g.id, title: g.title, progress: p, planNow, planQ, base, due, probability: o?.probability ?? null, blocked: o?.blocked ?? 0 };
  });
  parts.push(`## 목표 (G#) — 분기 말(${qEnd}) 예상 (계산값: 지금까지의 진척 속도를 남은 기간에 그대로 적용)\n${goals.map((g) => `${g.ref} ${g.title}: 현재 ${g.progress}%${g.planNow != null ? ` · 계획상 오늘 ${g.planNow}%` : ''} · 지금 속도면 분기 말 ${g.base}%${g.planQ != null ? ` (계획상 분기 말 ${g.planQ}%)` : ''}${g.due ? ` · 마감 ${g.due}` : ''}${g.probability != null ? ` · 달성 가능성 모델 ${g.probability}%` : ''} · 막힘 ${g.blocked}`).join('\n') || '(진행 중인 올해 목표 없음)'}`);

  // 과제 (I#) — 진행 중 하위 항목
  const iRef = new Map<string, string>(); const iId = new Map<string, string>();
  const kids = (items ?? []).filter((x) => x.parent_id && x.status !== 'done').sort((a, b) => String(a.due_date ?? '9999').localeCompare(String(b.due_date ?? '9999'))).slice(0, 40);
  parts.push(`## 과제 (I#)\n${kids.map((x, i) => {
    const ref = `I${i + 1}`; iRef.set(x.id, ref); iId.set(ref, x.id);
    const goal = gRef.get(x.parent_id!) ?? '';
    return `${ref} ${x.title}${goal ? ` (${goal})` : ''} · 담당 ${mRef.get(x.owner_id ?? '') ?? (x.owner_id === leaderId ? '팀장' : '없음')} · ${x.status} · 진척 ${x.progress}%${x.due_date ? ` · 마감 ${x.due_date}` : ''}${x.est_hours_per_week ? ` · 주 ${x.est_hours_per_week}h` : ''} · 기여도 ${x.contribution}/5${x.replan_count ? ` · 재계획 ${x.replan_count}회` : ''}`;
  }).join('\n') || '(없음)'}`);

  // 결과물 (S#) — 열린 것
  const { data: subs } = await admin.from('submissions').select('id, author_id, title, status, request_type, updated_at, closed_at').eq('team_id', teamId).is('closed_at', null).in('status', ['in_review', 'needs_work']).order('updated_at').limit(15);
  const sRef = new Map<string, string>(); const sId = new Map<string, string>();
  parts.push(`## 열린 결과물 (S#)\n${(subs ?? []).map((s, i) => {
    const ref = `S${i + 1}`; sRef.set(s.id, ref); sId.set(ref, s.id);
    return `${ref} ${s.title} · ${mRef.get(s.author_id) ?? nameOf.get(s.author_id) ?? '-'} · ${s.status === 'needs_work' ? '보완 요청' : '리뷰 대기'} ${Math.floor((Date.now() - Date.parse(s.updated_at)) / DAY)}일째`;
  }).join('\n') || '(없음)'}`);
  // 최근 AI 1차 검토 요약 (결과물 피드백 근거)
  const { data: revs } = await admin.from('ai_outputs').select('id, ref_id, content').eq('team_id', teamId).eq('kind', 'review').gte('created_at', since(30)).order('created_at', { ascending: false }).limit(12);
  for (const r of revs ?? []) {
    const c = r.content as { summary?: string; headline?: string };
    const s = (subs ?? []).find((x) => x.id === r.ref_id);
    if (c.summary || c.headline) book.add('review', r.id, `결과물 1차 검토${s ? ` · ${sRef.get(s.id)}` : ''}`, `${c.headline ?? ''} ${c.summary ?? ''}`.replace(/\s*\[E\d+\]/g, '').slice(0, 300));
  }
  await setRun(runId, { step: 2 });

  // 위에서 온 것 · 유관부서 · 결정
  const [{ data: notes }, { data: board }, { data: waitSubs }, { data: openReq }] = await Promise.all([
    admin.from('org_notes').select('id, kind, title, body, source, event_date').eq('team_id', teamId).eq('status', 'open').gte('created_at', since(60)).order('created_at', { ascending: false }).limit(10),
    admin.from('decision_board').select('title, stage, updated_at').eq('team_id', teamId).in('stage', ['reviewing', 'promoted']),
    admin.from('submissions').select('id, updated_at').eq('team_id', teamId).eq('status', 'in_review').is('closed_at', null),
    admin.from('team_requests').select('id, created_at').eq('team_id', teamId).eq('to_id', leaderId).eq('status', 'open'),
  ]);
  const KIND: Record<string, string> = { strategy: '전사 방침', exec: '임원 관심사', request: '상위 요청', peer: '유관부서', calendar: '전사 일정', other: '기타' };
  for (const n of notes ?? []) book.add('org_note', n.id, `${KIND[n.kind] ?? '위에서 온 것'} · ${n.title}`, `${n.body ?? ''}${n.source ? ` (출처 ${n.source})` : ''}${n.event_date ? ` · 일정 ${n.event_date} (D-${ymdDiff(n.event_date, today)})` : ''}`.slice(0, 400));
  if (board?.length) book.add('decision_board', null, '의사결정 보드 · 검토 중', board.map((b) => `${b.title} (${Math.floor((Date.now() - Date.parse(b.updated_at)) / DAY)}일째)`).join(' / '));
  const oldest = (waitSubs ?? []).map((s) => Math.floor((Date.now() - Date.parse(s.updated_at)) / DAY)).sort((a, b) => b - a)[0];
  book.add('leader', null, '팀장 본인 대기', `리뷰 대기 ${waitSubs?.length ?? 0}건${oldest != null ? ` (가장 오래 ${oldest}일)` : ''} · 팀장이 답할 요청 ${openReq?.length ?? 0}건 · 검토 중 결정 ${board?.length ?? 0}건`);
  if (raw.goals?.length) book.add('goals', null, '목표 진척 · 달성 가능성(모델)', raw.goals.slice(0, 6).map((g) => `${g.title} 진척 ${g.progress}% · 달성 가능성 ${g.probability ?? '-'}% · 막힘 ${g.blocked}`).join(' / '));
  await addLeaderNotes(book, teamId, leaderId, { limit: 10, nameOf: (n) => (n.anchor_type === 'member' && n.anchor_id ? nameOf.get(n.anchor_id) : undefined) });
  await addKnowhow(book, teamId, 'briefing', 1800);
  await setRun(runId, { step: 3 });

  // 입력은 양을 정해 두고 자른다 — 데이터가 많은 팀도 시간 안에 끝나게 (앞쪽일수록 중요한 순서)
  const head = [
    `오늘: ${today} · 이번 분기 말 ${qEnd} (남은 ${ymdDiff(qEnd, today)}일) / 팀: ${team?.name} / 미션: ${team?.mission || '-'} / 팀원 ${members.length}명`,
    `## 팀원 (M#)\n${mLines.join('\n')}`,
    ...parts,
  ].join('\n\n');
  const facts = book.text('사실과 기록');
  const kh = book.knowhowText();
  const compose = (budget: number) => {
    const h = head.slice(0, Math.floor(budget * 0.55));
    const left = budget - h.length;
    const f = facts.length > left * 0.75 ? `${facts.slice(0, Math.floor(left * 0.75))}\n(기록이 많아 일부만 실었습니다)` : facts;
    const k = kh.slice(0, Math.max(0, left - f.length));
    return [h, k, f].filter(Boolean).join('\n\n');
  };
  const t0 = Date.now();
  const call = (compact: boolean) => runAi<Out>({
    teamId, kind: 'autopilot', model: MODEL_SMART, system: AUTOPILOT + NOTE_RULE + (compact ? '\n\n[간결 모드] 질문마다 진단 2줄 · 액션 2개 이내로 짧게 씁니다.' : ''),
    content: [{ type: 'text', text: compose(compact ? 24000 : 60000) }], book,
    depth: depthOf(book.size, [6, 12, 20]), level: 'L3', createdBy: leaderId, credits: 0,
    maxTokens: compact ? 4500 : 7000, timeoutMs: compact ? 110_000 : 170_000, force: true,
  });
  // 한 번 실패하면(시간 초과 · 응답 형식 오류 · 일시 장애) 입력과 출력을 줄여 한 번 더 — 전체가 함수 실행 한도(400초) 안에 끝나게
  let res: Awaited<ReturnType<typeof call>>;
  try { res = await call(false); }
  catch (e) {
    const code = e instanceof HttpError ? e.code : '';
    if (['AI_RATE_HOUR', 'AI_RATE_DAY', 'AI_COST_CAP', 'AI_LOCKED', 'CORE_LIMIT', 'AI_NOT_CONFIGURED'].includes(code) || Date.now() - t0 > 200_000) throw e;
    console.warn('autopilot retry compact', e instanceof Error ? e.message : e);
    await setRun(runId, { step: 4 });
    res = await call(true);
  }
  const { output, parsed } = res;
  await setRun(runId, { step: 7 });

  // ---- 정리: 참조 → id, 액션 검증, 시뮬레이션 계산 ----
  const actions: Record<string, unknown>[] = [];
  const perMember = new Map<string, number>();
  let n = 0;
  const fixActs = (sec: string, list: unknown) => arr<RawAct>(list, 3).filter((a) => a && typeof a === 'object').flatMap((a) => {
    const type = a.type as ActType;
    if (!ACTION_TYPES.includes(type)) return [];
    const member = mId.get(String(a.member ?? ''));
    if (!member) return [];
    const item = a.item ? iId.get(a.item) ?? gId.get(a.item) ?? null : null;
    const submission = a.submission ? sId.get(a.submission) ?? null : null;
    if (type === 'progress' && !item) return [];
    if ((type === 'thread' || type === 'rework') && !submission) return [];
    if (type === 'rework' && (subs ?? []).find((s) => s.id === submission)?.status !== 'needs_work') return [];
    const message = String(a.message ?? '').replace(/\s*\[E\d+(?:\s*,\s*E\d+)*\]/g, '').trim().slice(0, 500);
    if (!message) return [];
    const c = (perMember.get(member) ?? 0) + 1;
    if (c > 3 || actions.length >= 10) return [];
    perMember.set(member, c);
    const sensitive = String(a.sensitive ?? '').trim() || (SENSITIVE.test(message) ? '민감 내용' : '');
    const key = `a${++n}`;
    const act = { key, section: sec, type, member_id: member, item_id: item, submission_id: submission, message, sensitive,
      item_title: item ? (items ?? []).find((x) => x.id === item)?.title ?? null : null,
      submission_title: submission ? (subs ?? []).find((s) => s.id === submission)?.title ?? null : null };
    actions.push(act);
    return [key];
  });
  const S = parsed.sections ?? ({} as NonNullable<Out['sections']>);
  const sec = (k: 'critical' | 'bottleneck' | 'resource' | 'people') => ({
    diagnosis: cleanDiag(S[k]?.diagnosis), note: str(S[k]?.note), todos: cleanTodo(S[k]?.todos),
    action_keys: fixActs(k, S[k]?.actions),
  });
  const sections = { critical: sec('critical'), bottleneck: sec('bottleneck'), resource: sec('resource'), people: sec('people') };
  const fg = new Map(arr<{ ref: string; risk_delta?: number; plan_delta?: number; note?: string }>(parsed.forecast?.goals, 12).filter((g) => g && typeof g === 'object').map((g) => [str(g.ref), g]));
  const forecast = {
    quarter_end: qEnd,
    goals: goals.map((g) => {
      const f = fg.get(g.ref);
      const rd = Math.max(-40, Math.min(0, Number(f?.risk_delta ?? 0)));
      const pd = Math.max(0, Math.min(30, Number(f?.plan_delta ?? 0)));
      return { goal_id: g.id, title: g.title, progress: g.progress, plan_now: g.planNow, plan_q: g.planQ, base: g.base, risk: clamp(g.base + (Number.isFinite(rd) ? rd : 0)), exec: clamp(g.base + (Number.isFinite(pd) ? pd : 0)), note: str(f?.note) };
    }),
    risks: arr<{ title: string; likelihood?: string; impact?: string; detail?: string }>(parsed.forecast?.risks, 4).filter((r) => r && typeof r === 'object')
      .map((r) => ({ title: str(r.title), likelihood: r.likelihood === 'high' ? 'high' : 'mid', impact: str(r.impact), detail: str(r.detail) })).filter((r) => r.title),
    lever: parsed.forecast?.lever && typeof parsed.forecast.lever === 'object' ? { text: str(parsed.forecast.lever.text), goal_id: gId.get(str(parsed.forecast.lever.goal_ref)) ?? null } : null,
    todos: cleanTodo(parsed.forecast?.todos),
  };
  const result = {
    headline: str(parsed.headline), sections, forecast,
    solutions: arr<{ title: string; why?: string; effect?: string; link?: string; label?: string }>(parsed.solutions, 3).filter((x) => x && typeof x === 'object')
      .map((x) => ({ title: str(x.title), why: str(x.why), effect: str(x.effect), link: str(x.link), label: str(x.label) })).filter((x) => x.title),
    perspective: parsed.perspective && typeof parsed.perspective === 'object' ? { text: str(parsed.perspective.text), sources: str(parsed.perspective.sources) } : null,
    actions, sources: output.sources ?? [], counts: { signals: signals.length, members: members.length },
  };
  return { result, aiOutputId: output.id as string };
}

serve(async (req) => {
  const body = await readJson<{ team_id?: string }>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const caller = await getCaller(req);
  if (caller.isService || !caller.userId) throw new HttpError(403, 'forbidden', '팀장이 직접 실행합니다');
  await assertLeader(caller, body.team_id);
  const teamId = body.team_id;

  const { count: mc } = await admin.from('team_members').select('user_id', { count: 'exact', head: true }).eq('team_id', teamId).eq('status', 'active').eq('role', 'member');
  if (!mc) throw new HttpError(422, 'NO_MEMBERS', '팀원을 초대하면 AUTOPILOT을 쓸 수 있습니다');
  const { data: team } = await admin.from('teams').select('settings').eq('id', teamId).single();
  const ap = ((team?.settings as Record<string, unknown>)?.autopilot ?? {}) as { mode?: string; allow?: Record<string, boolean> };
  const mode = ap.mode === 'auto' || ap.mode === 'semi' ? ap.mode : 'direct';
  const allow = { ...SEMI_DEFAULT, ...(ap.allow ?? {}) };
  // 팀 단위 잠금 안에서 진행 중 확인 · 횟수 확인 · 기록 (두 번 눌러도 하나만 실행)
  const { data: st, error } = await admin.rpc('autopilot_start', { p_team: teamId, p_leader: caller.userId, p_mode: mode, p_allow: allow });
  if (error) {
    if (/AUTOPILOT_LIMIT/.test(error.message)) throw new HttpError(429, 'AUTOPILOT_LIMIT', /trial/.test(`${error.hint ?? ''}`) ? '체험 기간에는 AUTOPILOT을 1번 실행할 수 있습니다' : '이번 달 AUTOPILOT 실행 횟수를 모두 썼습니다');
    throw error;
  }
  const run = { id: (st as { run_id: string }).run_id };
  if ((st as { existing?: boolean }).existing) return json({ run_id: run.id, status: 'running' });

  const work = async () => {
    try {
      const { result, aiOutputId } = await build(teamId, caller.userId!, run.id);
      await setRun(run.id, { output: result, ai_output_id: aiOutputId, step: 8 });
      // 실행할 때의 모드로 자동 발송 — 민감 내용은 보내지 않고, 한 사람에게 2건까지
      if (mode !== 'direct') {
        const sent = new Map<string, number>();
        for (const a of result.actions as { key: string; type: ActType; member_id: string; sensitive: string }[]) {
          if (a.sensitive) continue;
          if (mode === 'semi' && !allow[a.type]) continue;
          const c = sent.get(a.member_id) ?? 0;
          if (a.type !== 'memo' && c >= AUTO_CAP_PER_MEMBER) continue;
          const { error: sErr } = await admin.rpc('autopilot_send', { p_run: run.id, p_key: a.key, p_body: null, p_auto: true });
          if (sErr) { console.error('autopilot auto send failed', a.key, sErr.message); continue; }
          if (a.type !== 'memo') sent.set(a.member_id, c + 1);
        }
      }
      await setRun(run.id, { status: 'done', finished_at: new Date().toISOString() });
    } catch (e) {
      console.error('autopilot failed', e);
      const msg = e instanceof HttpError ? e.message : e instanceof Error ? e.message : String(e);
      await setRun(run.id, { status: 'failed', error: String(msg).slice(0, 300), finished_at: new Date().toISOString() });
    }
  };
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work());
  else await work();
  return json({ run_id: run.id, status: 'running' });
});
