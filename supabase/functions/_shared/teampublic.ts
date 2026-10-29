// 팀원에게 공개해도 되는 것만 모으는 도우미 — 팀 방향 · Sim.Box 가 쓴다
//   원칙: 허용 목록 — 팀원이 이미 볼 수 있는 것만 읽고, 팀장이 남에게 쓴 글은 '정해진 기준 목록' 분류에만 쓴다(문장은 밖으로 안 나감)
//   읽는 것: 팀 목표 · 공유 노하우 · (Sim.Box) 본인이 이미 본 피드백 · 칭찬 · 코칭
//   분류에만 쓰는 것: 팀장이 결과물에 남긴 피드백 · 팀원에게 보낸 요청 → STANDARDS 의 id 와 횟수만 남는다
//   읽지 않는 것: 위에서 온 것(팀장 메모) · 팀장 개인 메모 · 관찰 메모(본인 칭찬 제외) · 평가 · 컨디션 · 1on1 기록 · 다른 팀원의 Sim.Box
//   사람 이름은 넣기 전에도, 나온 뒤에도 가린다 (maskNames)
import { admin } from './supabase.ts';

export interface TeamPeople { leaderId: string | null; names: { id: string; name: string; leader: boolean }[] }

export async function teamPeople(teamId: string): Promise<TeamPeople> {
  const { data } = await admin.from('team_members').select('user_id, role, profiles(full_name)').eq('team_id', teamId).eq('status', 'active');
  const names = (data ?? []).map((m) => ({ id: m.user_id as string, name: ((m.profiles as unknown as { full_name?: string })?.full_name ?? '').trim(), leader: m.role === 'leader' }));
  return { leaderId: names.find((n) => n.leader)?.id ?? null, names };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 팀 사람 이름을 가린다 — 팀장은 '팀장님', 본인은 '본인', 나머지는 '팀원'. 성을 뺀 이름(다은님 · 다은 씨)도 */
export function maskNames(text: string, people: TeamPeople, selfId?: string | null): string {
  if (!text) return text;
  let out = text;
  const list = [...people.names].filter((n) => n.name.length >= 2).sort((a, b) => b.name.length - a.name.length);
  for (const p of list) {
    const to = p.leader ? '팀장님' : p.id === selfId ? '본인' : '팀원';
    out = out.replace(new RegExp(`${esc(p.name)}\\s*(님|씨|팀장님|팀장)?`, 'g'), to);
    if (p.name.length === 3) {
      const given = p.name.slice(1);
      out = out.replace(new RegExp(`(^|[^가-힣])${esc(given)}(\\s*(?:님|씨))`, 'g'), `$1${to}`);
    }
  }
  return out.replace(/팀장님\s*팀장님/g, '팀장님').replace(/팀원\s*팀원/g, '팀원');
}
export const hasName = (text: string, people: TeamPeople) => people.names.some((p) => p.name.length >= 2 && text.includes(p.name));
/** 팀원에게 보이면 안 되는 주제 — 팀 방향 문장에 걸리면 뺀다 (AI 지시와 별개로 한 번 더) */
export const SENSITIVE_RE = /인사\s*(발령|이동|조치|평가|고과|위원회)|발령|조직\s*개편|구조\s*조정|감원|인력\s*감축|희망\s*퇴직|퇴사|이직|(인사|성과|역량|업적|다면)\s*평가|고과|연봉|성과급|인센티브|승진|징계|대외비|기밀|미확정|내정|인수\s*합병|M&A|매각/i;

const DAY = 86400000;
const since = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const ymd = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : '');

export interface DirectionItem { text: string; why?: string; source?: string; date?: string; repeat?: number; new?: boolean }
export interface DirectionContent { title?: string; generated_at?: string; sections?: { key: string; title: string; sub?: string; items: DirectionItem[] }[] }

/** 저장된 팀 방향을 프롬프트용 글로 */
export function directionText(c: DirectionContent | null | undefined): string {
  if (!c?.sections?.length) return '';
  return c.sections.map((s) => `### ${s.title}\n${s.items.map((i, n) => `${n + 1}. ${i.text}${i.why ? ` — ${i.why}` : ''}`).join('\n')}`).join('\n');
}

/** 팀장님이 일하는 방식 — 우리가 미리 쓴 문장. AI는 여기서 고르고 세기만 한다 (팀장 원문은 화면에 안 나감) */
export const STANDARDS: { id: string; group: string; text: string; why: string }[] = [
  { id: 'conclusion_first', group: '보고 · 문서', text: '결론을 첫 문단에 써 주세요', why: '읽는 사람이 가장 먼저 알아야 할 것부터 보이게' },
  { id: 'number_source', group: '보고 · 문서', text: '숫자에는 출처와 기준일을 함께 적어 주세요', why: '숫자를 믿고 바로 쓸 수 있게' },
  { id: 'options_risk', group: '보고 · 문서', text: '대안과 리스크를 함께 보여 주세요', why: '한 가지 안만 있으면 판단하기 어렵기 때문에' },
  { id: 'one_page', group: '보고 · 문서', text: '한 장 요약을 먼저 붙여 주세요', why: '바쁠 때도 핵심을 빠르게 볼 수 있게' },
  { id: 'evidence', group: '보고 · 문서', text: '주장에는 근거 자료를 붙여 주세요', why: '왜 그렇게 판단했는지 바로 확인할 수 있게' },
  { id: 'early_share', group: '소통', text: '막히면 일찍 공유해 주세요', why: '늦게 알수록 도울 수 있는 방법이 줄어들어서' },
  { id: 'proactive_update', group: '소통', text: '진행 상황은 묻기 전에 먼저 알려 주세요', why: '중간에 방향을 맞출 수 있게' },
  { id: 'align_peers', group: '소통', text: '유관부서와 미리 맞춰 주세요', why: '마지막에 뒤집히는 일을 줄이려고' },
  { id: 'customer_view', group: '소통', text: '고객 입장에서 한 번 더 봐 주세요', why: '받는 쪽에서 무엇이 중요한지 놓치지 않게' },
  { id: 'priority_check', group: '일 진행', text: '시작 전에 우선순위를 확인해 주세요', why: '중요한 일에 시간을 먼저 쓰도록' },
  { id: 'schedule_early', group: '일 진행', text: '일정 조정이 필요하면 미리 말해 주세요', why: '다른 일정까지 함께 조정할 수 있게' },
  { id: 'show_small', group: '일 진행', text: '완성 전에 작게 먼저 보여 주세요', why: '방향이 다르면 일찍 고칠 수 있게' },
  { id: 'retro', group: '일 진행', text: '끝나면 재발 방지까지 정리해 주세요', why: '같은 문제가 다시 생기지 않게' },
];

/** 팀원이 이미 볼 수 있는 것 — 팀 목표 · 공유 노하우 (팀 방향 · Sim.Box 공통) */
export async function publicBasics(teamId: string, people: TeamPeople) {
  const yr = new Date().getFullYear();
  const [{ data: team }, { data: items }, { data: kh }] = await Promise.all([
    admin.from('teams').select('name').eq('id', teamId).single(),
    admin.from('work_items').select('id, parent_id, title, status, due_date, start_date, created_at, priority, num_target, unit, role, updated_at').eq('team_id', teamId).not('status', 'in', '(dropped,proposed)'),
    admin.from('knowhow_cards').select('title, body, created_at, updated_at').eq('team_id', teamId).eq('active', true).eq('shared', true).neq('source', 'consulting').order('updated_at', { ascending: false }).limit(10),
  ]);
  const all = items ?? [];
  const roots = all.filter((x) => !x.parent_id && x.status !== 'done' && String(x.start_date ?? x.due_date ?? x.created_at).slice(0, 4) === String(yr))
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).slice(0, 4);
  const goals = roots.map((g) => {
    const kids = all.filter((x) => x.parent_id === g.id && x.role === 'metric').slice(0, 3).map((m) => `${m.title}${m.num_target != null ? ` ${Number(m.num_target).toLocaleString('ko-KR')}${m.unit ?? ''}` : ''}`);
    return { title: g.title as string, sub: kids.join(' · ') || (g.due_date ? `${ymd(g.due_date)}까지` : ''), date: ymd(g.updated_at), created: ymd(g.created_at) };
  });
  return {
    team: (team?.name ?? '') as string,
    goals,
    knowhow: (kh ?? []).map((k) => ({ title: maskNames(String(k.title ?? ''), people), body: maskNames(String(k.body ?? ''), people).replace(/\s+/g, ' ').slice(0, 300), created: ymd(k.created_at) })),
  };
}

/** 팀 방향 재료 — 화면에 나갈 수 있는 것(goals · knowhow)과 분류에만 쓸 것(occasions)을 나눠 돌려준다 */
export async function directionMaterials(teamId: string, people: TeamPeople) {
  const [basics, { data: reqs }, { data: comments }] = await Promise.all([
    publicBasics(teamId, people),
    people.leaderId ? admin.from('team_requests').select('id, title, body, created_at').eq('team_id', teamId).eq('from_id', people.leaderId).neq('status', 'canceled').gte('created_at', since(60)).order('created_at', { ascending: false }).limit(40) : Promise.resolve({ data: [] }),
    people.leaderId ? admin.from('review_comments').select('submission_id, body, created_at').eq('team_id', teamId).eq('author_id', people.leaderId).eq('provenance', 'human').gte('created_at', since(90)).order('created_at', { ascending: false }).limit(80) : Promise.resolve({ data: [] }),
  ]);
  // 분류용: 한 결과물 / 한 요청 = 한 번 (같은 결과물에 여러 의견이 달려도 1번)
  const occ = new Map<string, { date: string; text: string }>();
  for (const c of comments ?? []) {
    const k = `s:${c.submission_id}`; const prev = occ.get(k);
    occ.set(k, { date: prev?.date && prev.date > ymd(c.created_at) ? prev.date : ymd(c.created_at), text: `${prev?.text ? prev.text + ' / ' : ''}${maskNames(String(c.body ?? ''), people).replace(/\s+/g, ' ').slice(0, 200)}`.slice(0, 600) });
  }
  for (const r of reqs ?? []) occ.set(`r:${r.id}`, { date: ymd(r.created_at), text: maskNames(`${r.title ?? ''} ${r.body ?? ''}`, people).replace(/\s+/g, ' ').slice(0, 300) });
  return { ...basics, occasions: [...occ.values()].slice(0, 80) };
}

/** 같은 문장 그대로 옮겼나 — 공백 뺀 14글자 이상이 원문과 겹치면 true */
export function quotes(out: string, sources: string[], n = 14): boolean {
  const norm = (t: string) => t.replace(/[\s"'“”‘’「」.,·:;!?()\[\]-]/g, '');
  const o = norm(out); if (o.length < n) return false;
  const src = sources.map(norm).filter((x) => x.length >= n);
  for (let i = 0; i + n <= o.length; i++) { const w = o.slice(i, i + n); if (src.some((x) => x.includes(w))) return true; }
  return false;
}

/** Sim.Box: 이 팀원 본인에게 온 피드백 · 칭찬 · 코칭 (본인이 이미 본 것만) */
export async function myFeedback(teamId: string, userId: string, people: TeamPeople): Promise<{ text: string; raw: string[] }> {
  const { data: subs } = await admin.from('submissions').select('id, title').eq('team_id', teamId).eq('author_id', userId).gte('updated_at', since(90)).limit(60);
  const ids = (subs ?? []).map((s) => s.id);
  const [{ data: cm }, { data: pr }, { data: co }] = await Promise.all([
    ids.length ? admin.from('review_comments').select('body, submission_id, created_at').in('submission_id', ids).neq('author_id', userId).eq('provenance', 'human').order('created_at', { ascending: false }).limit(30) : Promise.resolve({ data: [] }),
    admin.from('observations').select('body, occurred_at').eq('team_id', teamId).eq('subject_id', userId).eq('kind', 'praise').gte('occurred_at', since(120).slice(0, 10)).order('occurred_at', { ascending: false }).limit(8),
    admin.from('coaching_notes').select('title, body, created_at').eq('team_id', teamId).eq('member_id', userId).not('seen_at', 'is', null).gte('created_at', since(120)).order('created_at', { ascending: false }).limit(6),
  ]);
  const title = new Map((subs ?? []).map((s) => [s.id, s.title]));
  const m = (t: string) => maskNames(String(t ?? ''), people, userId).replace(/\s+/g, ' ').trim();
  const lines = [
    ...(cm ?? []).map((c) => `- [결과물 피드백 · ${m(title.get(c.submission_id) ?? '')}] ${m(c.body).slice(0, 240)}`),
    ...(pr ?? []).map((p) => `- [칭찬] ${m(p.body).replace(/^\[칭찬 배지\]\s*/, '').slice(0, 200)}`),
    ...(co ?? []).map((c) => `- [코칭] ${m(c.title)}: ${m(c.body).slice(0, 240)}`),
  ];
  const raw = [...(cm ?? []).map((c) => m(c.body)), ...(pr ?? []).map((p) => m(p.body)), ...(co ?? []).map((c) => m(c.body))];
  return { text: lines.join('\n') || '(아직 없음)', raw };
}
