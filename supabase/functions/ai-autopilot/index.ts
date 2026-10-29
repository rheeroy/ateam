// AUTOPILOT (자율주행) — 팀장이 버튼을 누르면 팀 데이터를 한 번에 읽고 핵심 질문 7개를 진단한다
//   결과는 질문별 보고서가 아니라 '한 줄 = 알아야 할 것 + 바로 할 액션' 목록(items). 각 줄에 관련 핵심 질문 번호가 붙고 질문 순서로 놓인다.
//   1 크리티컬 (상향·유관부서 포함) · 2 병목 (유관부서·팀장 본인 포함) · 3 리소스 · 4 분기 목표 전망(계산값 + 리스크) · 5 사람 · 6 솔루션 · 7 관점
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
/** 결과 목록 전체 줄 수 한도 (보낼 액션 · 팀장 할 일 · 알아 둘 것 · 목표 전망 각각 한 줄) */
const MAX_LINES = 20;

const AUTOPILOT = `과제: 당신은 팀장의 'AUTOPILOT(자율주행)'입니다. 팀장이 버튼을 한 번 누르면, 팀 데이터를 읽고 아래 핵심 질문에 답해 '한눈에 훑고 바로 처리하는 목록'을 만듭니다. 질문별 보고서가 아닙니다. 목록의 한 줄 = 팀장이 알아야 할 것 하나 + (있으면) 바로 할 수 있는 액션.
입력: 계산된 팀 신호, 팀원(M#)·과제(I#)·결과물(S#)·목표(G#) 목록, 위에서 온 것(전사·임원·상위 요청·유관부서·전사 일정), 팀장 운영 부담, 목표별 분기 말 예상치(계산값).

시간 축: 이 목록은 '현안'과 '전망'입니다. 지금 열려 있는 것(오래됐어도 아직 안 풀렸으면 현안 — 며칠째인지가 신호), 최근 2~4주의 변화, 앞으로 2주의 마감·일정과 분기 말 전망을 봅니다. 이미 끝난 지난 일은 지금도 영향을 줄 때만 씁니다.

핵심 질문 (q 번호):
1 지금 하지 않으면 크리티컬한 일 — 이번 주~2주 안에 손대지 않으면 문제가 되는 것. 팀 안(기한 임박·계획보다 늦은 항목·막힘)과 위·옆(상위 요청 마감·전사 일정·방침 변경·유관부서와 주고받을 것).
2 병목과 원인 — 일이 멈춘 구조적 원인. 팀 안(막힘·리뷰 대기·결정 대기·재계획 반복), 위·옆(유관부서 일정·외부 의존·전사 방침과의 충돌), 팀장 본인이 병목인 것(리뷰 적체·답 안 한 요청).
3 우선순위 대비 리소스 — 기여도는 높은데 투입이 적은 곳, 한 사람에게 몰린 일, 손대지 않은 중요 과제.
4 이번 분기 목표 전망 — 목표별 '지금 속도' 예상치는 시스템이 계산해서 따로 보여 줍니다. 당신은 분기 목표를 흔들 리스크(가능성×영향)를 항목으로 쓰고, forecast 에 목표별 변화폭만 판단합니다.
5 사람관리 — 컨디션 하락·이탈 신호·1on1 공백·인정이 필요한 사람·성장 기회.
6 이렇게 해보세요 — 1~5를 종합해 결과를 가장 크게 바꿀 행동 2~3개. 효과가 가장 큰 것을 맨 앞에.
7 한 걸음 물러서서 — 팀 상황을 다른 틀로 보게 하는 관점 한 개. 할 일 목록이 아닙니다.

items 원칙:
- 목록의 줄 수에 한도가 있습니다(입력 첫머리의 '목록 한도'). 보낼 액션 하나 · 팀장 할 일 하나가 각각 한 줄이고, 둘 다 없는 항목은 한 줄입니다. 한도 안에서 정말 중요한 것만 고르고, 한도를 채우려고 덜 중요한 것을 넣지 않습니다.
- q 순서(1→7)로, 같은 q 안에서는 중요한 순서로. 해당 없는 q 는 건너뜁니다(7은 1개).
- q: 가장 맞는 질문 번호 하나. also: 함께 해당하는 다른 질문 번호(없으면 빈 배열, 최대 2개).
- level: high(이번 주 꼭) | mid | low(참고).
- 말투: 팀장이 읽고 바로 이해하는 자연스러운 문장으로. 컨설팅 용어(레버 · 임팩트 · 얼라인 등)는 써도 되지만 문장 안에서 매끄럽게 쓰고, '가장 크게 움직이는 레버'처럼 용어만 덩그러니 제목이 되는 어색한 표현은 피합니다.
- title: 한 줄(35자 이내, 넘기지 않음 — 숫자를 늘어놓지 말고 핵심만). 훑어보기만 해도 무엇인지 알게 — 누가/무엇이 어떤 상태인지. 근거 태그 없이.
- detail: 1~3문장. 왜 그런지 입력의 사실과 계산값으로, 문장 끝에 근거 [E#]. 같은 사실을 여러 항목에 반복하지 않습니다.
- tag: 출처를 짧게(예: "상위 요청", "유관부서 · 영업팀", "팀목표", "컨디션 공유", "팀장 본인").
- effect: 짧은 효과·영향(선택). 4번 리스크는 "제휴 목표 −18%p", 6번은 "달성률 +12%p 기대"처럼. 숫자는 계산값에 근거.
- goal: 관련 목표 G#(없으면 null).
- actions: 이 항목을 처리하려고 팀원에게 바로 보낼 메시지 0~2개. 팀원에게 보낼 게 아니면 빈 배열. 이 항목의 title · detail 이 다루는 바로 그 사람 · 과제 · 결과물에 대한 액션만 넣습니다. 다른 사람이나 다른 결과물에 보낼 일이면 그 상황을 다루는 항목을 따로 만듭니다(화면에서 항목 설명이 액션의 근거로 함께 보입니다).
- todo: 팀원에게 보내지 않고 팀장이 직접 할 일(상위 보고·유관부서 협의·담당 조정·결정·리뷰)이 있으면 { "text": 할 일 한 문장, "why": 왜 지금 해야 하는지 한 줄(30자 안팎), "link": goals|work|people|upward|decide|knowhow|none }, 없으면 null.
- 액션도 할 일도 없는 항목(알아만 두면 되는 것, 7번 관점)도 괜찮습니다.

액션(actions) 원칙 — 팀장 이름으로 그대로 나가는 메시지입니다:
- type: praise(칭찬 배지) · cheer(지원·격려) · push(업무 독려, 과제 지정 없음) · progress(진척 공유·성과입력 리마인드, item 필수) · rework(보완 요청한 결과물 리마인드, submission 필수, 상태가 보완 요청인 것만) · thread(결과물 스레드에 남길 짧은 피드백, submission 필수) · grow(육성 제안) · plan(계획을 세워 달라는 요청, item 있으면 지정) · oo(1on1 제안) · memo(팀장만 보는 관찰 메모 — 팀원에게 가지 않음).
- member 는 입력의 M#. item 은 I#, submission 은 S#. 목록에 없는 대상은 쓰지 않습니다.
- message: 팀장의 말투로 1~2문장, 부드러운 존댓말("~해 줄래요?", "~고마워요"). 근거 태그를 넣지 않습니다.
  구체적인 업무 지시(무엇을 언제까지 어떻게)는 쓰지 않습니다. "진척이 계획보다 느려 보여요, 상황을 한 번 공유해 줄래요?"처럼 관찰과 방향만 씁니다.
  칭찬은 무엇을 잘했는지 구체적으로(입력에 있는 사실로). memo 는 "[잘한 점] ..." 또는 "[우려] ..."로 시작하는 관찰 기록.
- why: 이 액션이 왜 필요한지 한 줄(30자 안팎, 근거 태그 없이). 받는 사람 본인의 상황으로 씁니다. 예: "제안서가 9일째 막힘 · 마감 11/15". 화면 목록에 그대로 보입니다.
- sensitive: 메시지나 그 이유가 건강·개인 사정·이탈·평가·보상·갈등에 닿으면 그 내용을 짧게(예: "개인 사정 언급"), 아니면 빈 문자열.
- 전체 최대 10개, 한 사람에게 3개를 넘기지 않습니다. 같은 사람에게 비슷한 메시지를 두 번 보내지 않습니다.

forecast.goals: 입력의 G# 마다 { "ref": "G1", "risk_delta": -18, "plan_delta": 12, "note": "한 줄" }. risk_delta 는 4번 리스크가 터졌을 때 분기 말 달성률 변화(%p, -40~0), plan_delta 는 6번을 실행했을 때(0~+30). 근거가 약하면 0에 가깝게.
headline: 이번 실행의 한 문장 요약.

출력 JSON:
{
  "headline": "...",
  "items": [
    { "q": 1, "also": [2], "level": "high", "title": "...", "detail": "... [E1]", "tag": "...", "effect": "", "goal": null,
      "actions": [{ "type": "push", "member": "M2", "item": null, "submission": null, "message": "...", "why": "...", "sensitive": "" }],
      "todo": { "text": "...", "why": "...", "link": "upward" } }
  ],
  "forecast": { "goals": [{ "ref": "G1", "risk_delta": -10, "plan_delta": 8, "note": "..." }] }
}`;

type RawAct = { type: string; member?: string; item?: string | null; submission?: string | null; message?: string; why?: string; sensitive?: string };
type Todo = { text: string; link?: string; label?: string; why?: string };
type RawItem = { q?: number; also?: number[]; level?: string; title?: string; detail?: string; tag?: string; effect?: string; goal?: string | null; actions?: RawAct[]; todo?: Todo | null };
interface Out {
  headline?: string;
  items?: RawItem[];
  forecast?: { goals?: { ref: string; risk_delta?: number; plan_delta?: number; note?: string }[] };
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
const noTag = (v: unknown) => str(v).replace(/\s*\[E\d+(?:\s*,\s*E\d+)*\]/g, '').trim();
const cleanTodo = (t: unknown) => (t && typeof t === 'object' && str((t as Todo).text) ? { text: noTag((t as Todo).text), why: noTag((t as Todo).why).slice(0, 80), link: str((t as Todo).link), label: str((t as Todo).label) } : null);
const qOf = (v: unknown) => { const n = Math.round(Number(v)); return n >= 1 && n <= 7 ? n : 0; };

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
    // 위에서 온 것은 '아직 열려 있으면' 오래돼도 현안 — 기간으로 자르지 않고 며칠째인지 붙인다
    admin.from('org_notes').select('id, kind, title, body, source, event_date, created_at').eq('team_id', teamId).eq('status', 'open').order('created_at', { ascending: false }).limit(12),
    admin.from('decision_board').select('title, stage, updated_at').eq('team_id', teamId).in('stage', ['reviewing', 'promoted']),
    admin.from('submissions').select('id, updated_at').eq('team_id', teamId).eq('status', 'in_review').is('closed_at', null),
    admin.from('team_requests').select('id, created_at').eq('team_id', teamId).eq('to_id', leaderId).eq('status', 'open'),
  ]);
  const KIND: Record<string, string> = { strategy: '전사 방침', exec: '임원 관심사', request: '상위 요청', peer: '유관부서', calendar: '전사 일정', other: '기타' };
  for (const n of notes ?? []) book.add('org_note', n.id, `${KIND[n.kind] ?? '위에서 온 것'} · ${n.title}`, `${n.body ?? ''}${n.source ? ` (출처 ${n.source})` : ''}${n.event_date ? ` · 일정 ${n.event_date} (D-${ymdDiff(n.event_date, today)})` : ''} · 등록 ${Math.max(0, ymdDiff(today, String(n.created_at).slice(0, 10)))}일째 열려 있음`.slice(0, 400));
  // 앞으로 2주 — 마감 · 일정 · 다시 볼 결정 (전망의 가까운 쪽)
  const in14 = addDaysYmd(today, 14);
  const { data: dueDec } = await admin.from('decisions').select('title, review_on').eq('team_id', teamId).is('outcome', null).gte('review_on', today).lte('review_on', in14).limit(6);
  const soon = [
    ...(items ?? []).filter((x) => x.status !== 'done' && x.due_date && String(x.due_date) >= addDaysYmd(today, -7) && String(x.due_date) <= in14)
      .map((x) => ({ d: String(x.due_date), t: `${iRef.get(x.id) ?? gRef.get(x.id) ?? ''} ${x.title} 마감 · 진척 ${x.progress}% · 담당 ${mRef.get(x.owner_id ?? '') ?? (x.owner_id === leaderId ? '팀장' : '-')}${String(x.due_date) < today ? ' (이미 지남)' : ''}` })),
    ...(notes ?? []).filter((n) => n.event_date && n.event_date >= today && n.event_date <= in14).map((n) => ({ d: n.event_date as string, t: `${KIND[n.kind] ?? '위에서 온 것'} · ${n.title}` })),
    ...(dueDec ?? []).map((d) => ({ d: String(d.review_on), t: `결정 다시 보기 · ${d.title}` })),
  ].sort((a, b) => a.d.localeCompare(b.d)).slice(0, 15);
  parts.push(`## 앞으로 2주 (${today} ~ ${in14}) — 마감 · 일정\n${soon.map((x) => `${x.d} (D${ymdDiff(x.d, today) >= 0 ? '-' : '+'}${Math.abs(ymdDiff(x.d, today))}) ${x.t.trim()}`).join('\n') || '(없음)'}`);
  if (board?.length) book.add('decision_board', null, '의사결정 보드 · 검토 중', board.map((b) => `${b.title} (${Math.floor((Date.now() - Date.parse(b.updated_at)) / DAY)}일째)`).join(' / '));
  const oldest = (waitSubs ?? []).map((s) => Math.floor((Date.now() - Date.parse(s.updated_at)) / DAY)).sort((a, b) => b - a)[0];
  book.add('leader', null, '팀장 본인 대기', `리뷰 대기 ${waitSubs?.length ?? 0}건${oldest != null ? ` (가장 오래 ${oldest}일)` : ''} · 팀장이 답할 요청 ${openReq?.length ?? 0}건 · 검토 중 결정 ${board?.length ?? 0}건`);
  if (raw.goals?.length) book.add('goals', null, '목표 진척 · 달성 가능성(모델)', raw.goals.slice(0, 6).map((g) => `${g.title} 진척 ${g.progress}% · 달성 가능성 ${g.probability ?? '-'}% · 막힘 ${g.blocked}`).join(' / '));
  await addLeaderNotes(book, teamId, leaderId, { limit: 10, nameOf: (n) => (n.anchor_type === 'member' && n.anchor_id ? nameOf.get(n.anchor_id) : undefined) });
  // 팀원들이 Sim.Box에서 많이 다듬는 주제 — 이름 없는 팀 전체 합계만 (팀원 5명 이상 · 3명 이상이 쓴 분류)
  const { data: sbt } = await admin.rpc('simbox_trends', { p_team: teamId, p_days: 30 });
  const sb = sbt as { available?: boolean; rows?: { category: string; share: number }[] } | null;
  const SB: Record<string, string> = { evidence: '근거·숫자', structure: '구조·결론 위치', clarity: '문장·전달력', priority: '우선순위·방향 확인', reporting: '보고 방법·타이밍', stakeholder: '유관부서·대외 소통', planning: '일정·계획', idea: '아이디어 구상', data: '데이터 분석' };
  if (sb?.available && sb.rows?.length) book.add('simbox_trend', null, '팀원들이 Sim.Box에서 많이 다듬는 것 (팀 전체 합계 · 개인 구분 없음)', sb.rows.map((r) => `${SB[r.category] ?? r.category} ${r.share}%`).join(' · '));
  await addKnowhow(book, teamId, 'briefing', 1800);
  await setRun(runId, { step: 3 });

  const itemBudget = Math.max(12, MAX_LINES - goals.length);
  // 입력은 양을 정해 두고 자른다 — 데이터가 많은 팀도 시간 안에 끝나게 (앞쪽일수록 중요한 순서)
  const head = [
    `오늘: ${today} · 이번 분기 말 ${qEnd} (남은 ${ymdDiff(qEnd, today)}일) / 팀: ${team?.name} / 미션: ${team?.mission || '-'} / 팀원 ${members.length}명`,
    `목록 한도: 당신이 쓰는 줄은 최대 ${itemBudget}줄 (목표 전망 ${goals.length}줄은 시스템이 따로 붙임 · 전체 ${MAX_LINES}줄)`,
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
    teamId, kind: 'autopilot', model: MODEL_SMART, system: AUTOPILOT + NOTE_RULE + (compact ? '\n\n[간결 모드] 목록은 12줄 이내, detail 은 한 문장, 액션은 전체 6개 이내로 짧게 씁니다.' : ''),
    content: [{ type: 'text', text: compose(compact ? 24000 : 60000) }], book,
    depth: depthOf(book.size, [6, 12, 20]), level: 'L3', createdBy: leaderId, credits: 0,
    // 먼저 생각하지 않고 바로 JSON 을 쓴다 — 기본(생각 후 답)은 입력이 큰 팀에서 출력 한도를 생각에 다 써서 빈 응답이 났다
    thinking: 'fast', effort: compact ? 'low' : 'medium',
    maxTokens: compact ? 5000 : 9000, timeoutMs: compact ? 120_000 : 180_000, force: true,
  });
  // 한 번 실패하면(시간 초과 · 응답 형식 오류 · 일시 장애) 입력과 출력을 줄여 한 번 더 — 전체가 함수 실행 한도(400초) 안에 끝나게
  let res: Awaited<ReturnType<typeof call>>;
  try { res = await call(false); }
  catch (e) {
    const code = e instanceof HttpError ? e.code : '';
    if (['AI_RATE_HOUR', 'AI_RATE_DAY', 'AI_COST_CAP', 'AI_LOCKED', 'CORE_LIMIT', 'AI_NOT_CONFIGURED'].includes(code) || Date.now() - t0 > 250_000) throw e;
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
  const fixActs = (q: number, list: unknown) => arr<RawAct>(list, 2).filter((a) => a && typeof a === 'object').flatMap((a) => {
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
    const act = { key, section: `q${q}`, type, member_id: member, item_id: item, submission_id: submission, message, sensitive, why: noTag(a.why).slice(0, 80),
      item_title: item ? (items ?? []).find((x) => x.id === item)?.title ?? null : null,
      submission_title: submission ? (subs ?? []).find((s) => s.id === submission)?.title ?? null : null };
    actions.push(act);
    return [key];
  });
  // 목록 — q 순서 · 같은 q 안에서는 중요도 순 (모델 순서를 기본으로 유지)
  const LV: Record<string, number> = { high: 0, mid: 1, low: 2 };
  const list = arr<RawItem>(parsed.items, 24).filter((x) => x && typeof x === 'object' && qOf(x.q) && str(x.title).trim())
    .map((x, i) => ({ x, i, q: qOf(x.q), lv: x.level === 'high' || x.level === 'low' ? x.level : 'mid' }))
    .sort((a, b) => a.q - b.q || LV[a.lv] - LV[b.lv] || a.i - b.i)
    .map(({ x, q, lv }, i) => ({
      id: `i${i + 1}`, q, also: arr<number>(x.also, 2).map(qOf).filter((v) => v && v !== q), level: lv,
      title: str(x.title).replace(/\s*\[E\d+(?:\s*,\s*E\d+)*\]/g, '').trim().slice(0, 120), detail: str(x.detail), tag: str(x.tag), effect: str(x.effect),
      goal_id: x.goal ? gId.get(str(x.goal)) ?? null : null,
      action_keys: fixActs(q, x.actions), todo: cleanTodo(x.todo),
    }));
  // 한도를 넘으면 덜 중요한 항목(참고 → 보통, 같은 수준이면 뒤쪽)부터 뺀다. 관점(7)은 하나 남긴다
  const lines = (x: (typeof list)[number]) => Math.max(1, x.action_keys.length + (x.todo ? 1 : 0));
  let total = list.reduce((n, x) => n + lines(x), 0);
  while (total > itemBudget + 2) {
    let at = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i];
      if (x.level === 'high' || (x.q === 7 && list.filter((y) => y.q === 7).length === 1)) continue;
      if (at < 0 || LV[x.level] > LV[list[at].level]) at = i;
    }
    if (at < 0) break;
    const [cut] = list.splice(at, 1);
    total -= lines(cut);
    for (const k of cut.action_keys) { const j = actions.findIndex((a) => a.key === k); if (j >= 0) actions.splice(j, 1); }
  }
  const fg = new Map(arr<{ ref: string; risk_delta?: number; plan_delta?: number; note?: string }>(parsed.forecast?.goals, 12).filter((g) => g && typeof g === 'object').map((g) => [str(g.ref), g]));
  const forecast = {
    quarter_end: qEnd,
    goals: goals.map((g) => {
      const f = fg.get(g.ref);
      const rd = Math.max(-40, Math.min(0, Number(f?.risk_delta ?? 0)));
      const pd = Math.max(0, Math.min(30, Number(f?.plan_delta ?? 0)));
      return { goal_id: g.id, title: g.title, progress: g.progress, plan_now: g.planNow, plan_q: g.planQ, base: g.base, risk: clamp(g.base + (Number.isFinite(rd) ? rd : 0)), exec: clamp(g.base + (Number.isFinite(pd) ? pd : 0)), note: str(f?.note) };
    }),
  };
  const result = {
    v: 2, headline: str(parsed.headline), items: list, forecast,
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
