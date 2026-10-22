// 히스토리 관리 — 과제마다 '살아 있는 히스토리' 한 장 (Pro부터)
//   · 매주(cron {all:true}): 히스토리를 켠 팀마다, 지난번 이후 새 기록이 생긴 과제만 기존 히스토리에 합쳐 고쳐 쓴다 (빠른 모델)
//   · 팀장 [지금 업데이트] {team_id, item_id} / 처음 만들기 {team_id, item_ids} (처음은 정밀 모델)
//   · 낱개 기록을 늘어놓지 않고 줄기(lane)로 묶고, 원인→결과는 links로 잇는다. 팀장이 고정한 줄은 지우지 않는다
//   · 넣지 않는 것: 1on1 · 컨디션 · 관찰 메모 · 평가 · 코칭 · AI 허용 안 한 팀장 메모
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader, assertFeature } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, fmtDate, type Source } from '../_shared/gateway.ts';
import { MODEL_SMART, MODEL_FAST } from '../_shared/anthropic.ts';

const DAY = 86400000;
const WEEKLY_MAX = 10;      // 팀당 한 주에 업데이트하는 과제 수 (새 기록 많은 순)
const PARALLEL = 4;         // 한 번에 AI를 부르는 과제 수
const PER_SOURCE = 40;      // 처음 만들 때 출처별 최대 기록 수

type Ref = { type: string; id: string | null; label: string };
type Line = { id: string; text: string; detail?: string; since?: string; src?: (string | Ref)[] };
type Content = {
  summary?: string;
  lanes?: { id: string; title: string }[];
  events?: { id: string; lane: string; date: string; title: string; kind: string; detail?: string; future?: boolean; src?: (string | Ref)[] }[];
  links?: { from: string; to: string; label?: string }[];
  people?: { id: string; name: string; org?: string; scope: string; role?: string; check?: boolean; src?: (string | Ref)[] }[];
  fixed?: Line[]; open?: Line[]; tried?: Line[]; risks?: Line[]; gaps?: Line[];
  related?: { ref?: string; item_id?: string; title?: string; why?: string }[];
  progress?: { measure: string; unit: string; target: number | null; points: { date: string; value: number }[] };
  owner?: { id: string | null; name: string; previous: string[] };
  meta?: Record<string, unknown>;
};
type Edits = { pinned?: string[]; hidden?: string[]; text?: Record<string, string> };
type Item = { id: string; team_id: string; title: string; note: string; owner_id: string | null; parent_id: string | null; status: string; measure: string; progress: number;
  num_current: number | null; num_target: number | null; unit: string; start_date: string | null; due_date: string | null; created_at: string; role: string | null; stages: string[] | null };

const SYSTEM = `## 할 일
과제 하나의 '히스토리'를 관리합니다. 이 히스토리는 과제를 넘겨받는 사람이 맥락(왜 · 무엇이 정해졌고 · 무엇을 해 봤고 · 누가 엮여 있고 · 무엇이 남았는지)을 한 번에 파악하게 하는 문서입니다.
'기존 히스토리'(JSON)가 있으면 '새 기록'을 합쳐 고쳐 쓰고, 없으면 기록 전체로 처음 만듭니다.

## 원칙
- 낱개 기록을 나열하지 않습니다. 같은 흐름은 하나의 줄기(lanes)로 묶고, 원인과 결과는 links로 잇습니다.
- 기존 항목의 id는 그대로 유지합니다. 새 항목은 같은 접두어의 다음 번호를 씁니다 (L·V·P·F·O·T·K·G).
- '고정' 표시된 항목은 문장과 id를 바꾸지 말고 그대로 둡니다.
- 오래되고 사소한 사건은 합치거나 뺍니다. events 최대 24개, lanes 최대 6개, people 최대 10명, 각 목록 최대 8개.
- 근거는 src 배열에 기록의 태그를 그대로 넣습니다 (예: ["E3"]). 기존 항목을 그대로 두면 src는 비워도 됩니다.
- 사람·부서·회사는 기록에 이름이 나온 경우만 씁니다. 추측하지 않습니다. '팀원 목록'에 있으면 scope "team", 같은 회사 다른 부서는 "dept", 회사 밖은 "external". 확인이 필요한 관계는 check true.
- gaps(확인 필요)에는 넘겨받는 사람이 꼭 알아야 하는데 기록에 없는 것을 "무엇 — 기록 없음 → 누구에게 확인" 형태로 씁니다. 없으면 빈 배열.
- fixed(확정 사항)는 결정·승인·팀장 기준처럼 다시 묻지 않아도 되는 것, open(미결 사항)은 아직 정해지지 않은 것, tried(이전 시도)는 해 봤던 방법과 결과, risks(리스크)는 일정·목표를 흔들 수 있는 것.
- 문체: 개조식, 명사형 종결 (예: "A·C 2개사 축소안 검토 중"). text는 60자 안팎, detail은 배경·이유를 2~3문장.
- 날짜는 기록에 있는 날짜만 씁니다(YYYY-MM-DD). 앞으로 예정된 일은 기록에 예정일이 있을 때만 future true로 넣습니다.
- related(관련 과제)는 '팀의 다른 과제' 목록에서 기록상 실제로 엮인 것만 ref로 고릅니다.

## 출력 (JSON 객체 하나)
{"summary":"지금 현황 한두 문장 (90자 이내)",
 "lanes":[{"id":"L1","title":"줄기 이름 (8자 안팎)"}],
 "events":[{"id":"V1","lane":"L1","date":"YYYY-MM-DD","title":"12자 안팎","kind":"doc|decision|issue|feedback|plan|change","detail":"","future":false,"src":["E1"]}],
 "links":[{"from":"V2","to":"V5","label":"짧게"}],
 "people":[{"id":"P1","name":"이름 또는 조직","org":"부서·회사","scope":"team|dept|external","role":"이 과제에서의 역할 (20자)","check":false,"src":[]}],
 "fixed":[{"id":"F1","text":"","detail":"","since":"YYYY-MM-DD","src":[]}],
 "open":[{"id":"O1","text":"","detail":"","src":[]}],
 "tried":[{"id":"T1","text":"","detail":"","src":[]}],
 "risks":[{"id":"K1","text":"","detail":"","src":[]}],
 "gaps":[{"id":"G1","text":"","detail":"","src":[]}],
 "related":[{"ref":"R2","why":"20자"}]}`;

const LISTS = ['fixed', 'open', 'tried', 'risks', 'gaps'] as const;
const day = (s: string | null | undefined) => (s ?? '').slice(0, 10);
const clip = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const EVENT_TEXT: Record<string, string> = { created: '과제 생성', replan: '일정·목표 변경', status: '상태 변경', owner: '담당 변경', target: '목표 변경', approved: '계획 승인', changes_requested: '계획 수정 요청' };
const STATUS_KO: Record<string, string> = { proposed: '제안', changes_requested: '수정 요청', active: '진행', blocked: '막힘', done: '완료', dropped: '중단' };

/** 팀의 히스토리 대상 과제 — 목표·지표·할 일·끝난 지 오래된 것은 뺀다 */
async function teamItems(teamId: string, ids?: string[]) {
  let qb = admin.from('work_items').select('id, team_id, title, note, owner_id, parent_id, status, measure, progress, num_current, num_target, unit, start_date, due_date, created_at, role, stages, done_at')
    .eq('team_id', teamId).not('parent_id', 'is', null).neq('measure', 'check').in('status', ['active', 'blocked', 'done']);
  if (ids?.length) qb = qb.in('id', ids);
  const { data, error } = await qb.order('updated_at', { ascending: false }).limit(ids?.length ? 500 : 300);
  if (error) throw error;
  const cut = Date.now() - 60 * DAY;
  return ((data ?? []) as (Item & { done_at: string | null })[]).filter((i) => i.role !== 'metric' && i.role !== 'goal' && !(i.status === 'done' && i.done_at && Date.parse(i.done_at) < cut));
}

type Rec = { item: string; at: string; type: string; id: string | null; label: string; text: string };

/** 쿼리 결과 확인 — 출처 하나라도 실패하면 반영 시점을 넘기지 않도록 멈춘다 */
function must<T>(r: { data: T[] | null; error: { message: string } | null }, what: string): T[] {
  if (r.error) throw new HttpError(500, 'HISTORY_SOURCE', `${what}: ${r.error.message}`);
  return r.data ?? [];
}
/** id 목록이 길면 나눠서 (URL 길이) */
async function byChunks<T>(ids: string[], fn: (part: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, what: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 60) out.push(...must(await fn(ids.slice(i, i + 60)), what));
  return out;
}
const LIMIT = 1000;   // PostgREST 한 번 최대 — 최근 것부터 받아서 시간순으로 되돌린다

/** 과제들의 기록을 출처별로 한 번에 모은다 (since 이후, 최근 것 우선) */
async function collect(teamId: string, items: Item[], since: string, nameOf: (id: string | null | undefined) => string, initial: boolean): Promise<Rec[]> {
  const ids = items.map((i) => i.id);
  const recs: Rec[] = [];
  const push = (r: Rec) => recs.push(r);
  const recent = <T,>(rows: T[]) => rows.reverse();

  const [ev, logs, cm, subs, rq, ln, sh] = await Promise.all([
    byChunks(ids, (x) => admin.from('work_item_events').select('id, item_id, kind, old, new, reason, actor_id, created_at').in('item_id', x).gt('created_at', since).order('created_at', { ascending: false }).limit(LIMIT), '변경 이력'),
    byChunks(ids, (x) => admin.from('work_item_logs').select('id, item_id, kind, period, value, done, note, created_at').in('item_id', x).gt('created_at', since).order('created_at', { ascending: false }).limit(LIMIT), '진척 기록'),
    byChunks(ids, (x) => admin.from('work_item_comments').select('id, item_id, kind, body, author_id, created_at').in('item_id', x).gt('created_at', since).order('created_at', { ascending: false }).limit(LIMIT), '과제 코멘트'),
    byChunks(ids, (x) => admin.from('submissions').select('id, item_id, title, request_type, kind, status, author_id, created_at').eq('team_id', teamId).in('item_id', x).limit(LIMIT), '결과물'),
    byChunks(ids, (x) => admin.from('team_requests').select('id, item_id, kind, title, body, status, response, from_id, to_id, created_at, responded_at').eq('team_id', teamId).in('item_id', x).or(`created_at.gt.${since},responded_at.gt.${since}`).limit(LIMIT), '요청'),
    byChunks(ids, (x) => admin.from('leader_notes').select('id, anchor_id, body, created_at').eq('team_id', teamId).eq('anchor_type', 'item').eq('ai_allowed', true).in('anchor_id', x).gt('created_at', since).limit(LIMIT), '팀장 메모'),
    byChunks(ids, (x) => admin.from('history_shares').select('id, item_id, note, from_id, to_id, sent_at, created_at, status').eq('team_id', teamId).in('item_id', x).limit(LIMIT), '전달'),
  ]);

  for (const e of recent(ev)) {
    // 트리거가 old/new 에 값 자체를 넣는다 (replan 만 객체)
    let t = EVENT_TEXT[e.kind] ?? e.kind;
    if (e.kind === 'owner') t = `담당 변경 ${nameOf(e.old as string) || '없음'} → ${nameOf(e.new as string) || '없음'}`;
    else if (e.kind === 'status' || e.kind === 'approved' || e.kind === 'changes_requested') t = `${t} (${STATUS_KO[String(e.old)] ?? e.old ?? ''} → ${STATUS_KO[String(e.new)] ?? e.new ?? ''})`;
    else if (e.kind === 'created') t = '과제 생성';
    else if (e.kind === 'replan' || e.kind === 'target') t = `${t}: ${JSON.stringify(e.old).slice(0, 120)} → ${JSON.stringify(e.new).slice(0, 120)}`;
    push({ item: e.item_id, at: e.created_at, type: 'task', id: e.item_id, label: '변경 이력', text: `${t}${e.reason ? ` (사유: ${clip(e.reason, 200)})` : ''} — ${nameOf(e.actor_id)}` });
  }
  for (const l of recent(logs)) {
    const v = l.kind === 'recurring' ? (l.done ? '완료' : '미완료') : l.value != null ? String(l.value) : '';
    push({ item: l.item_id, at: l.created_at, type: 'task', id: l.item_id, label: '진척 기록', text: `${l.kind === 'progress' ? '진척' : l.kind === 'number' ? '실적 값' : l.kind === 'recurring' ? '정기 업무' : '메모'} ${v} (${l.period})${l.note ? ` ${clip(l.note, 200)}` : ''}` });
  }
  for (const c of recent(cm)) {
    const k = c.kind === 'feedback' ? '팀장 피드백' : c.kind === 'approve' ? '계획 승인' : c.kind === 'changes' ? '계획 수정 요청' : '과제 코멘트';
    push({ item: c.item_id, at: c.created_at, type: 'task', id: c.item_id, label: k, text: `${nameOf(c.author_id)}: ${clip(c.body, 400)}` });
  }
  // 결과물 · 버전 · AI 검토 판단 · 피드백
  if (subs.length) {
    const sIds = subs.map((s) => s.id);
    const subOf = new Map(subs.map((s) => [s.id, s]));
    const [vers, rcs] = await Promise.all([
      byChunks(sIds, (x) => admin.from('submission_versions').select('id, submission_id, version, note, extracted_text, created_at').in('submission_id', x).gt('created_at', since).order('created_at', { ascending: false }).limit(LIMIT), '결과물 버전'),
      byChunks(sIds, (x) => admin.from('review_comments').select('id, submission_id, author_id, body, created_at').in('submission_id', x).gt('created_at', since).order('created_at', { ascending: false }).limit(LIMIT), '결과물 대화'),
    ]);
    const ais = await byChunks(vers.map((v) => v.id), (x) => admin.from('ai_outputs').select('ref_id, content, edited_content').eq('kind', 'review').eq('ref_table', 'submission_versions').in('ref_id', x), 'AI 검토');
    const aiOf = new Map(ais.map((a) => [a.ref_id, (a.edited_content ?? a.content) as { brief?: { text?: string }; summary?: string }]));
    const REQ: Record<string, string> = { approval: '컨펌 요청', feedback: '의견 요청', share: '공유' };
    for (const v of recent(vers)) {
      const s = subOf.get(v.submission_id)!;
      const ai = aiOf.get(v.id);
      push({ item: s.item_id, at: v.created_at, type: 'submission', id: s.id, label: `결과물 '${clip(s.title, 40)}' v${v.version}`,
        text: `${nameOf(s.author_id)} · ${s.kind === 'checkin' ? '성과입력' : REQ[s.request_type] ?? ''} · 상태 ${s.status}${v.note ? ` · 메모 ${clip(v.note, 150)}` : ''}${ai?.brief?.text || ai?.summary ? ` · AI 검토 ${clip(ai?.brief?.text || ai?.summary, 160)}` : ''}${v.extracted_text ? ` · 본문 ${clip(v.extracted_text, initial ? 500 : 350)}` : ''}` });
    }
    for (const c of recent(rcs)) {
      const s = subOf.get(c.submission_id)!;
      push({ item: s.item_id, at: c.created_at, type: 'submission', id: s.id, label: `'${clip(s.title, 30)}' 대화`, text: `${nameOf(c.author_id)}: ${clip(c.body, 300)}` });
    }
  }
  // 과제 태그 대화(최근 반년) + since 이후 글과 답글
  const roots = await byChunks(ids, (x) => admin.from('space_messages').select('id, item_id, body, author_id, created_at').eq('team_id', teamId).in('item_id', x).is('parent_id', null)
    .gt('created_at', new Date(Math.min(Date.parse(since), Date.now() - 180 * DAY)).toISOString()).order('created_at', { ascending: false }).limit(LIMIT), '업무 대화');
  const itemOfRoot = new Map(roots.map((r) => [r.id, r.item_id]));
  for (const m of recent(roots.filter((r) => r.created_at > since))) push({ item: m.item_id, at: m.created_at, type: 'space_message', id: m.id, label: '업무 대화', text: `${nameOf(m.author_id)}: ${clip(m.body, 300)}` });
  const reps = await byChunks(roots.map((r) => r.id), (x) => admin.from('space_messages').select('id, parent_id, body, author_id, created_at').in('parent_id', x).gt('created_at', since).order('created_at', { ascending: false }).limit(LIMIT), '업무 대화 답글');
  for (const m of recent(reps)) { const it = itemOfRoot.get(m.parent_id); if (it) push({ item: it, at: m.created_at, type: 'space_message', id: m.parent_id, label: '업무 대화 답글', text: `${nameOf(m.author_id)}: ${clip(m.body, 300)}` }); }

  for (const r of rq) {
    const at = r.responded_at && r.responded_at > since ? r.responded_at : r.created_at;
    push({ item: r.item_id, at, type: 'request', id: r.id, label: '요청', text: `${nameOf(r.from_id)} → ${nameOf(r.to_id)}: ${clip(r.title, 120)}${r.body ? ` (${clip(r.body, 160)})` : ''} · ${r.status === 'done' ? `완료${r.response ? ` — ${clip(r.response, 160)}` : ''}` : '열림'}` });
  }
  for (const n of ln) push({ item: n.anchor_id, at: n.created_at, type: 'leader_note', id: n.id, label: '팀장 메모', text: clip(n.body, 400) });
  // 전달 때 쓴 팀장 한마디 · 질문과 답 (그 과제의 맥락으로 남는다)
  const sent = sh.filter((s) => s.status !== 'requested');
  for (const s of sent) { const at = s.sent_at ?? s.created_at; if (s.note?.trim() && at > since) push({ item: s.item_id, at, type: 'history_share', id: s.id, label: '전달 때 팀장 한마디', text: `→ ${nameOf(s.to_id)}: ${clip(s.note, 300)}` }); }
  if (sent.length) {
    const itemOf = new Map(sent.map((s) => [s.id, s.item_id]));
    const msgs = await byChunks(sent.map((s) => s.id), (x) => admin.from('history_messages').select('id, share_id, author_id, body, created_at').in('share_id', x).gt('created_at', since).order('created_at', { ascending: false }).limit(LIMIT), '질문·답');
    for (const m of recent(msgs)) push({ item: itemOf.get(m.share_id)!, at: m.created_at, type: 'history_share', id: m.share_id, label: '히스토리 질문·답', text: `${nameOf(m.author_id)}: ${clip(m.body, 300)}` });
  }
  return recs;
}

/** 진척 추이 (AI 없이 계산) */
async function progressOf(it: Item): Promise<Content['progress']> {
  const kind = it.measure === 'number' ? 'number' : 'progress';
  const { data } = await admin.from('work_item_logs').select('period, value').eq('item_id', it.id).eq('kind', kind).not('value', 'is', null).order('period').limit(60);
  const points = (data ?? []).map((l) => ({ date: day(l.period), value: Number(l.value) }));
  const now = kind === 'number' ? it.num_current : it.progress;
  if (now != null) { const today = new Date().toISOString().slice(0, 10); if (!points.length || points[points.length - 1].date !== today) points.push({ date: today, value: Number(now) }); }
  return { measure: it.measure, unit: kind === 'number' ? it.unit || '' : '%', target: kind === 'number' ? it.num_target : 100, points };
}

/** AI 출력 정리: 근거 태그 → 출처, 기존 항목의 출처·고정 줄 유지, 관련 과제 연결 */
function finalize(out: Content, prev: Content | null, edits: Edits, tags: Map<string, Source>, rel: Map<string, { id: string; title: string }>): Content {
  const resolve = (src: (string | Ref)[] | undefined, old?: (string | Ref)[]): Ref[] => {
    const r = (Array.isArray(src) ? src : []).map((t) => (typeof t === 'string' ? tags.get(t.replace(/[[\]]/g, '')) : t)).filter((x): x is Source => !!x)
      .map((s) => ({ type: s.type, id: s.id, label: s.label }));
    const uniq = [...new Map(r.map((x) => [`${x.type}:${x.id}:${x.label}`, x])).values()].slice(0, 6);
    return uniq.length ? uniq : ((old ?? []).filter((x) => typeof x !== 'string') as Ref[]);
  };
  const pinned = new Set(edits.pinned ?? []);
  const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
  /** 고정 줄을 맨 앞에 두고(AI가 뺐어도 되살림) 나머지는 출처를 붙인 뒤 자른다 */
  const fix = <T extends { id: string; src?: (string | Ref)[] }>(list: T[] | undefined, old: T[] | undefined, ok: (x: T) => boolean, max: number): T[] => {
    const prevById = new Map((old ?? []).map((x) => [x.id, x]));
    const keep = [...pinned].map((id) => prevById.get(id)).filter((x): x is T => !!x);
    const keepIds = new Set(keep.map((x) => x.id));
    const now = (Array.isArray(list) ? list : []).filter((x) => x && str(x.id) && ok(x) && !keepIds.has(x.id))
      .map((x) => ({ ...x, src: resolve(x.src, prevById.get(x.id)?.src) }));
    return [...keep, ...now].slice(0, Math.max(max, keep.length));
  };
  const events = fix(out.events, prev?.events, (e) => str(e.title) && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date ?? '')) && str(e.lane), 30);
  // 줄기: AI 것 + 고정된 사건이 쓰는 예전 줄기
  const lanes = (Array.isArray(out.lanes) ? out.lanes : []).filter((l) => l && str(l.id) && str(l.title)).slice(0, 6);
  for (const e of events) if (pinned.has(e.id) && !lanes.some((l) => l.id === e.lane)) { const pl = prev?.lanes?.find((l) => l.id === e.lane); if (pl) lanes.push(pl); }
  const laneIds = new Set(lanes.map((l) => l.id));
  const c: Content = {
    summary: clip(out.summary, 160),
    lanes,
    events: events.filter((e) => laneIds.has(e.lane)),
    people: fix(out.people, prev?.people, (p) => str(p.name), 12),
    related: (Array.isArray(out.related) ? out.related : []).map((r) => { const t = r?.ref ? rel.get(r.ref) : null; return t ? { item_id: t.id, title: t.title, why: clip(r.why, 40) } : null; }).filter(Boolean) as Content['related'],
  };
  for (const k of LISTS) c[k] = fix(out[k], prev?.[k], (l) => str(l.text), 12);
  const evIds = new Set((c.events ?? []).map((e) => e.id));
  c.links = (Array.isArray(out.links) ? out.links : []).filter((l) => l && evIds.has(l.from) && evIds.has(l.to)).slice(0, 16);
  return c;
}

/** 과제 하나 업데이트 (records 가 비었고 기존 히스토리가 있으면 AI를 부르지 않는다) */
async function updateOne(it: Item, recs: Rec[], ctx: { teamId: string; createdBy: string | null; nameOf: (id: string | null | undefined) => string; members: string; others: Item[]; startedAt: string; force?: boolean }) {
  const { data: row } = await admin.from('task_histories').select('*').eq('item_id', it.id).maybeSingle();
  const prev = (row?.content ?? null) as Content | null;
  const edits = (row?.edits ?? {}) as Edits;
  const initial = !row || !prev?.summary;
  if (!initial && !recs.length && !ctx.force) return { item_id: it.id, skipped: 'no_new_records' as const };

  const book = new SourceBook();
  const tags = new Map<string, Source>();
  const lines: string[] = [];
  for (const r of recs.sort((a, b) => a.at.localeCompare(b.at))) {
    const tag = book.add(r.type, r.id, r.label, `[${day(r.at)}] ${r.text}`);
    tags.set(tag, book.sources[book.sources.length - 1]);
    lines.push(tag);
  }
  // 이전 담당자 (변경 이력에서)
  const { data: owners } = await admin.from('work_item_events').select('old, new').eq('item_id', it.id).eq('kind', 'owner').order('created_at');
  const previous = [...new Set((owners ?? []).map((o) => ctx.nameOf(o.old as string)).filter((n) => n && n !== ctx.nameOf(it.owner_id)))];
  const { data: parent } = it.parent_id ? await admin.from('work_items').select('title').eq('id', it.parent_id).maybeSingle() : { data: null };
  const rel = new Map<string, { id: string; title: string }>();
  ctx.others.filter((o) => o.id !== it.id).slice(0, 30).forEach((o, i) => rel.set(`R${i + 1}`, { id: o.id, title: o.title }));
  const pinned = new Set(edits.pinned ?? []);
  const prevForAi = prev ? JSON.stringify({ ...prev, progress: undefined, owner: undefined, meta: undefined }, (k, v) => (k === 'src' ? undefined : v)) : '';
  const input = [
    `## 과제\n${it.title} / 상위 목표 ${parent?.title ?? '-'} / 담당 ${ctx.nameOf(it.owner_id) || '없음'}${previous.length ? ` (이전 담당 ${previous.join(', ')})` : ''} / 상태 ${STATUS_KO[it.status] ?? it.status} / 진척 ${it.measure === 'number' ? `${it.num_current ?? '-'} / ${it.num_target ?? '-'}${it.unit}` : `${it.progress}%`} / 기간 ${it.start_date ?? '-'} ~ ${it.due_date ?? '-'} / 오늘 ${new Date().toISOString().slice(0, 10)}${it.note ? `\n설명: ${clip(it.note, 400)}` : ''}`,
    `## 팀원 목록\n${ctx.members}`,
    `## 팀의 다른 과제 (related 고를 때만)\n${[...rel.entries()].map(([k, v]) => `${k}: ${v.title}`).join('\n') || '(없음)'}`,
    prev ? `## 기존 히스토리\n${prevForAi}${pinned.size ? `\n고정 항목 (그대로 둘 것): ${[...pinned].join(', ')}` : ''}` : '## 기존 히스토리\n(없음 — 처음 만듭니다)',
    book.text(prev ? `새 기록 (${fmtDate(row?.synced_at)} 이후)` : '기록 전체'),
  ].join('\n\n');

  const { parsed, output } = await runAi<Content>({
    teamId: ctx.teamId, kind: 'task_history', model: initial ? MODEL_SMART : MODEL_FAST, system: SYSTEM,
    content: [{ type: 'text', text: input }], book, depth: depthOf(recs.length, [5, 15, 40]), level: 'L2',
    createdBy: ctx.createdBy, refTable: 'work_items', refId: it.id, maxTokens: initial ? 4000 : 3000, force: true,
  });
  const content = finalize(parsed, prev, edits, tags, rel);
  content.progress = await progressOf(it);
  content.owner = { id: it.owner_id, name: ctx.nameOf(it.owner_id), previous };
  content.meta = { model: (output as { model?: string }).model, ai_output_id: (output as { id?: string }).id, records: (row?.record_count ?? 0) + recs.length };
  const up = {
    item_id: it.id, team_id: ctx.teamId, content, synced_at: ctx.startedAt,
    record_count: (row?.record_count ?? 0) + recs.length, new_count: recs.length, updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('task_histories').upsert(up, { onConflict: 'item_id' });
  if (error) throw error;
  return { item_id: it.id, updated: true, new_records: recs.length };
}

async function runTeam(teamId: string, opts: { createdBy: string | null; itemIds?: string[]; weekly?: boolean; force?: boolean }) {
  const startedAt = new Date(Date.now() - 1000).toISOString();
  const all = await teamItems(teamId);
  // 이름은 팀을 떠난 사람까지 (이전 담당·작성자) — 팀원 목록은 지금 있는 사람만
  const { data: mem } = await admin.from('team_members').select('user_id, role, job_title, status, profiles(full_name)').eq('team_id', teamId);
  const names = new Map((mem ?? []).map((m) => [m.user_id, (m.profiles as unknown as { full_name: string } | null)?.full_name ?? '']));
  const nameOf = (id: string | null | undefined) => (id ? names.get(id) ?? '' : '');
  const members = (mem ?? []).filter((m) => m.status === 'active').map((m) => `${names.get(m.user_id)} (${m.role === 'leader' ? '팀장' : m.job_title || '팀원'})`).join(', ');

  let targets = opts.itemIds?.length ? await teamItems(teamId, opts.itemIds) : all;
  const { data: hs } = await admin.from('task_histories').select('item_id, synced_at').eq('team_id', teamId);
  const syncedOf = new Map((hs ?? []).map((h) => [h.item_id, h.synced_at as string | null]));
  if (opts.weekly) {
    // 히스토리를 켠 팀만 (한 번이라도 만든 팀) — 새 과제도 함께 만든다
    if (!syncedOf.size) return { team_id: teamId, skipped: 'not_enabled' };
    const { data: bud } = await admin.rpc('ai_budget', { p_team: teamId });
    const b = bud as { cost_usd: number; cap_usd: number } | null;
    if (b && Number(b.cap_usd) > 0 && Number(b.cost_usd) >= Number(b.cap_usd) * 0.7) return { team_id: teamId, skipped: 'budget' };
  }
  if (!targets.length) return { team_id: teamId, results: [] };

  // 기록 모으기: 업데이트는 마지막 반영 이후, 처음은 전체
  const fresh = targets.filter((t) => !syncedOf.get(t.id));
  const old = targets.filter((t) => syncedOf.get(t.id));
  const recs: Rec[] = [];
  if (fresh.length) recs.push(...await collect(teamId, fresh, '1970-01-01T00:00:00Z', nameOf, true));
  if (old.length) {
    // 가장 오래 안 바뀐 과제가 창을 너무 넓히지 않게 — 최대 60일
    const minSince = [old.map((t) => syncedOf.get(t.id)!).sort()[0], new Date(Date.now() - 60 * DAY).toISOString()].sort()[1];
    const got = await collect(teamId, old, minSince, nameOf, false);
    recs.push(...got.filter((r) => r.at > (syncedOf.get(r.item) ?? '')));
  }
  const byItem = new Map<string, Rec[]>();
  for (const r of recs) { if (!byItem.has(r.item)) byItem.set(r.item, []); byItem.get(r.item)!.push(r); }
  // 처음 만들 때 출처가 너무 많으면 최근 것 위주로
  for (const [k, v] of byItem) if (!syncedOf.get(k) && v.length > 120) byItem.set(k, v.sort((a, b) => a.at.localeCompare(b.at)).slice(-120));

  if (opts.weekly) {
    targets = targets.filter((t) => (byItem.get(t.id)?.length ?? 0) > 0)   // 새 기록이 있는 과제만 (아직 없던 과제도 기록이 있으면 새로 만든다)
      .sort((a, b) => (byItem.get(b.id)?.length ?? 0) - (byItem.get(a.id)?.length ?? 0)).slice(0, WEEKLY_MAX);
  }
  const ctx = { teamId, createdBy: opts.createdBy, nameOf, members, others: all, startedAt, force: opts.force };
  const results: unknown[] = [];
  for (let i = 0; i < targets.length; i += PARALLEL) {
    const chunk = targets.slice(i, i + PARALLEL);
    const got = await Promise.allSettled(chunk.map((t) => updateOne(t, byItem.get(t.id) ?? [], ctx)));
    got.forEach((g, j) => results.push(g.status === 'fulfilled' ? g.value : { item_id: chunk[j].id, error: (g.reason as HttpError)?.code ?? 'ERROR', message: String((g.reason as Error)?.message ?? g.reason) }));
    // 원가·횟수 상한에 걸리면 멈춘다
    if (got.some((g) => g.status === 'rejected' && /AI_(COST_CAP|RATE_HOUR|RATE_DAY)|CORE_LIMIT|AI_LOCKED/.test(`${(g.reason as HttpError)?.code ?? ''} ${(g.reason as Error)?.message ?? ''}`))) break;
  }
  return { team_id: teamId, results };
}

serve(async (req) => {
  const body = await readJson<{ team_id?: string; item_id?: string; item_ids?: string[]; all?: boolean; weekly?: boolean; force?: boolean }>(req);
  const caller = await getCaller(req);

  // 수동 전체 실행 (예약 작업은 SQL에서 팀마다 따로 부른다 — 30_history.sql)
  if (body.all) {
    if (!caller.isService) throw new HttpError(403, 'forbidden');
    const ids = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('task_histories').select('team_id').order('team_id').range(from, from + 999);
      if (error) throw error;
      (data ?? []).forEach((t) => ids.add(t.team_id));
      if ((data ?? []).length < 1000) break;
    }
    const out: unknown[] = [];
    for (const team_id of ids) {
      const { data: on } = await admin.rpc('team_has_feature', { p_team: team_id, p_feature: 'history' });
      if (on) out.push(await runTeam(team_id, { createdBy: null, weekly: true }).catch((e) => ({ team_id, error: String((e as Error).message) })));
    }
    return json({ teams: out });
  }

  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  await assertLeader(caller, body.team_id);
  await assertFeature(body.team_id, 'history');
  if (body.weekly) return json(await runTeam(body.team_id, { createdBy: null, weekly: true }));
  const itemIds = body.item_id ? [body.item_id] : (body.item_ids ?? []).slice(0, PARALLEL * 2);
  if (!itemIds.length) throw new HttpError(400, 'MISSING_ITEM');
  return json(await runTeam(body.team_id, { createdBy: caller.userId, itemIds, force: !!body.force }));
});
