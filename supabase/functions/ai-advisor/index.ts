// A·Team의 제안 — 주간 운영 컨설팅 (실행·인력·사람·외부·팀장 자신·운영 체계 6개 레버) (코어 AI)
// 팀장 요청: {team_id}  /  예약 작업(월요일 07:30 KST): {all: true}
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { ADVISOR } from '../_shared/prompts/index.ts';
import { analyze, loadRaw, signalsFor, sectionOf, kstToday, kstMonday, addDaysYmd, DOMAIN_META, TYPE_LABEL, SECTION_NAME, type RawMember } from '../_shared/signals.ts';
import { NOTE_RULE, addLeaderNotes } from '../_shared/notes.ts';

const DAY = 86400000;
const since = (d: number) => new Date(Date.now() - d * DAY).toISOString();
type Sec = { summary?: string; items?: { title: string }[] };

async function adviceFor(teamId: string, createdBy: string | null) {
  const { data: team } = await admin.from('teams').select('id, name, mission, settings').eq('id', teamId).single();
  const { data: tm } = await admin.from('team_members').select('user_id, role, job_title, weekly_hours, joined_at, profiles(full_name)').eq('team_id', teamId).eq('status', 'active');
  const all: RawMember[] = (tm ?? []).map((m) => ({ user_id: m.user_id, role: m.role, name: (m.profiles as unknown as { full_name: string })?.full_name ?? '' }));
  const leader = all.find((m) => m.role === 'leader');
  if (!leader) throw new HttpError(422, 'NO_LEADER');
  const members = (tm ?? []).filter((m) => m.role === 'member');
  if (!members.length) return null;
  const nameOf = new Map(all.map((m) => [m.user_id, m.name]));
  const today = kstToday();
  const mon = kstMonday();
  const minEv = Number((team?.settings as Record<string, unknown>)?.min_judgment_evidence ?? 8);
  const book = new SourceBook();
  const parts: string[] = [];

  // 1) 팀 신호 (계산값)
  const raw = await loadRaw(admin, teamId, leader.user_id, minEv);
  const { signals, domains } = analyze(raw, all);
  for (const s of signalsFor('weekly', signals).slice(0, 18)) book.add('signal', null, `[${SECTION_NAME[sectionOf(s)]}] ${DOMAIN_META[s.domain].name} · ${TYPE_LABEL[s.type]}`, `${s.title}${s.detail ? ` — ${s.detail}` : ''}`);
  parts.push(`## 영역별 상태 (계산값)\n${domains.map((d) => `${DOMAIN_META[d.domain].name}: ${d.status}, ${d.kpiLabel} ${d.kpi}`).join('\n')}`);

  // 2) 이번 주 진단 · 팀원관리 요약 (다른 AI의 결과 — 반복하지 말고 그 위에서 처방)
  const latest = async (kind: string) => (await admin.from('ai_outputs').select('id, content, period_start, created_at').eq('team_id', teamId).eq('kind', kind).neq('status', 'withheld').order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  const ins = await latest('insight_weekly') ?? await latest('insight_daily');
  if (ins) {
    const c = ins.content as { headline?: string; sections?: Record<string, Sec> };
    const secs = Object.entries(c.sections ?? {}).filter(([, v]) => v?.summary).map(([k, v]) => `${k}: ${v.summary}`).join(' / ');
    book.add('insight', ins.id, `AI 인사이트 진단 ${String(ins.period_start ?? ins.created_at).slice(0, 10)}`, `${c.headline ?? ''} / ${secs}`.replace(/\s*\[E\d+\]/g, ''));
  }
  const pa = await latest('people_actions');
  if (pa) {
    const c = pa.content as { summary?: string; actions?: { title: string; type: string }[] };
    book.add('people_actions', pa.id, '이번 주 팀원관리 액션 (이미 추천됨)', `${c.summary ?? ''} / ${(c.actions ?? []).slice(0, 6).map((a) => a.title).join(' · ')}`.replace(/\s*\[E\d+\]/g, ''));
  }

  // 3) 인력 — 팀원별 부하 · 막힘 · 한 사람 의존 · 팀장 접점
  const [{ data: items }, { data: attnRows }] = await Promise.all([
    admin.from('work_items').select('id, owner_id, parent_id, title, status, progress, due_date, est_hours_per_week, measure').eq('team_id', teamId).not('status', 'in', '(dropped,proposed,done)'),
    admin.rpc('leader_attention', { p_team: teamId, p_days: 28 }),
  ]);
  const attn = new Map(((attnRows ?? []) as { user_id: string; touch: number; resp_hours: number | null; waiting: number; oo: number }[]).map((r) => [r.user_id, r]));
  const touches = [...attn.values()].map((r) => Number(r.touch));
  const totTouch = touches.reduce((a, b) => a + b, 0);
  const lines: string[] = [];
  for (const m of members) {
    const mine = (items ?? []).filter((i) => i.owner_id === m.user_id);
    const hours = mine.reduce((a, i) => a + Number(i.est_hours_per_week ?? 0), 0);
    const a = attn.get(m.user_id);
    const care = (raw.care ?? []).find((c) => c.user_id === m.user_id);
    lines.push(`${nameOf.get(m.user_id)}(${m.job_title || '-'}, 입사 ${Math.floor((Date.now() - Date.parse(m.joined_at)) / DAY)}일): 진행 ${mine.length}건 · 막힘 ${mine.filter((i) => i.status === 'blocked').length} · 주 ${hours}h/가용 ${m.weekly_hours}h (${m.weekly_hours ? Math.round((hours / m.weekly_hours) * 100) : '-'}%)`
      + (a ? ` · 팀장 접점 28일 ${a.touch}${totTouch ? `(${Math.round((Number(a.touch) / totTouch) * 100)}%)` : ''} · 1:1 ${a.oo} · 리뷰 첫 반응 ${a.resp_hours ?? '-'}h · 반응 대기 ${a.waiting}` : '')
      + (care?.signals.length ? ` · 신호: ${care.signals.map((s) => s.label.replace('체크인 미제출', '컨디션 공유 없음')).join(', ')}` : ''));
  }
  // 한 사람 의존: 진행 중 하위 항목이 모두 한 사람에게 있는 목표
  const roots = (items ?? []).filter((i) => !i.parent_id);
  const solo = roots.map((r) => ({ r, kids: (items ?? []).filter((i) => i.parent_id === r.id) })).filter((x) => x.kids.length >= 2 && new Set(x.kids.map((k) => k.owner_id)).size === 1);
  book.add('staffing', null, '팀원별 부하 · 팀장 접점 (최근 28일, 앱 기록 기준)', lines.join(' | '));
  if (solo.length) book.add('staffing', null, '한 사람에게 몰린 목표', solo.map((x) => `${x.r.title} → ${nameOf.get(x.kids[0].owner_id ?? '')} 혼자 ${x.kids.length}건`).join(' / '));

  // 4) 결정 · 위에서 온 것
  const [{ data: board }, { data: decs }, { data: notes }] = await Promise.all([
    admin.from('decision_board').select('card_key, title, stage, updated_at').eq('team_id', teamId).in('stage', ['reviewing', 'promoted']),
    admin.from('decisions').select('id, title, decided_at, review_on, outcome').eq('team_id', teamId).is('outcome', null).order('decided_at').limit(6),
    admin.from('org_notes').select('id, kind, title, body, event_date').eq('team_id', teamId).eq('status', 'open').gte('created_at', since(45)).order('created_at', { ascending: false }).limit(6),
  ]);
  if (board?.length) book.add('decision_board', null, '의사결정 보드 · 검토 중', board.map((b) => `${b.title} (${Math.floor((Date.now() - Date.parse(b.updated_at)) / DAY)}일째)`).join(' / '));
  for (const d of (decs ?? []).filter((x) => (x.review_on ? x.review_on <= today : Date.now() - Date.parse(x.decided_at) > 30 * DAY))) book.add('decision', d.id, `돌아볼 결정 · ${d.title}`, `결정 ${String(d.decided_at).slice(0, 10)} · 결과 미기록`);
  for (const n of notes ?? []) book.add('org_note', n.id, `위에서 온 것 · ${n.title}`, `${n.body ?? ''}${n.event_date ? ` (일정 ${n.event_date})` : ''}`.slice(0, 400));

  // 5) 팀장 자신 — 리뷰 적체 · 미결 결정 · 늦은 시간 사용 · 셀프 체크
  const [{ data: waitSubs }, { data: evs }, { data: self }] = await Promise.all([
    admin.from('submissions').select('id, updated_at').eq('team_id', teamId).eq('status', 'in_review'),
    admin.from('events').select('created_at').eq('team_id', teamId).eq('actor_id', leader.user_id).gte('created_at', since(14)).limit(1000),
    admin.from('leader_selfcheck').select('week_start, energy, burden, note').eq('team_id', teamId).eq('user_id', leader.user_id).gte('week_start', addDaysYmd(mon, -21)).order('week_start'),
  ]);
  const kstHour = (iso: string) => (new Date(iso).getUTCHours() + 9) % 24;
  const kstDow = (iso: string) => new Date(Date.parse(iso) + 9 * 3600000).getUTCDay();
  const late = (evs ?? []).filter((e) => kstHour(e.created_at) >= 22 || kstHour(e.created_at) < 6 || [0, 6].includes(kstDow(e.created_at))).length;
  const oldest = (waitSubs ?? []).map((s) => Math.floor((Date.now() - Date.parse(s.updated_at)) / DAY)).sort((a, b) => b - a)[0];
  book.add('leader', null, '팀장 운영 부담',
    `리뷰 대기 ${waitSubs?.length ?? 0}건${oldest != null ? ` (가장 오래 ${oldest}일)` : ''} · 검토 중 결정 ${board?.length ?? 0}건 · 최근 14일 앱 활동 ${evs?.length ?? 0}회 중 밤 10시 이후·주말 ${late}회`
    + (self?.length ? ` · 셀프 체크(에너지/부담 5점): ${self.map((x) => `${x.week_start.slice(5)} ${x.energy ?? '-'}/${x.burden ?? '-'}${x.note ? ` "${x.note}"` : ''}`).join(', ')}` : ' · 셀프 체크 없음'));

  // 6) 지난주 제안과 상태
  const { data: prev } = await admin.from('ai_outputs').select('id, content, period_start').eq('team_id', teamId).eq('kind', 'advisor_weekly').lt('period_start', mon).order('period_start', { ascending: false }).limit(1).maybeSingle();
  if (prev) {
    const { data: st } = await admin.from('advice_status').select('advice_key, status').eq('team_id', teamId).like('advice_key', `${prev.period_start}:%`);
    const stOf = new Map((st ?? []).map((x) => [x.advice_key.split(':').pop(), x.status]));
    const LBL: Record<string, string> = { adopted: '채택', held: '보류', done: '완료' };
    const adv = ((prev.content as { advice?: { id: string; title: string; lever: string }[] }).advice ?? []);
    if (adv.length) book.add('advice_prev', prev.id, `지난주(${prev.period_start}) 제안과 팀장의 선택`, adv.map((a) => `${a.id} [${a.lever}] ${a.title.replace(/\s*\[E\d+\]/g, '')} → ${LBL[stOf.get(a.id) ?? ''] ?? '표시 없음'}`).join(' / '));
  }
  // 한 걸음 물러서 보기 — 최근 4주에 쓴 관점(반복 금지) · 다가오는 시기
  const { data: recent } = await admin.from('ai_outputs').select('content, period_start').eq('team_id', teamId).eq('kind', 'advisor_weekly').lt('period_start', mon).order('period_start', { ascending: false }).limit(4);
  type Pv = { big?: { lens?: string }; reframe?: { lens?: string }; experiment?: { title?: string } };
  const used = (recent ?? []).flatMap((r) => { const p = (r.content as { perspective?: Pv }).perspective; return p ? [p.big?.lens, p.reframe?.lens, p.experiment?.title].filter(Boolean) as string[] : []; });
  const month = Number(today.slice(5, 7));
  const season = [
    [3, 6, 9, 12].includes(month) ? '이번 달이 분기 말' : [2, 5, 8, 11].includes(month) ? '다음 달이 분기 말' : '',
    month >= 10 ? '연말 평가와 내년 목표 수립이 다가오는 시기' : month <= 2 ? '올해 목표를 세우고 시작하는 시기' : month === 6 || month === 7 ? '상반기를 돌아보고 하반기를 조정하는 시기' : '',
  ].filter(Boolean).join(' · ');
  parts.push(`## 한 걸음 물러서 보기 참고\n다가오는 시기: ${season || '특이 시기 없음'}\n최근 쓴 관점(다시 쓰지 않음): ${used.length ? used.join(' / ') : '없음'}`);

  // 목표 진척 (기록으로 변화 확인용)
  if (raw.goals?.length) book.add("goals", null, "목표 진척 · 달성 가능성(모델)", raw.goals.slice(0, 6).map((g) => `${g.title} 진척 ${g.progress}% · 달성 가능성 ${g.probability ?? "-"}% · 막힘 ${g.blocked}`).join(" / "));

  // 팀장 개인 메모 (AI 참고 허용한 것) — 운영 처방의 맥락
  await addLeaderNotes(book, teamId, leader.user_id, { limit: 12, nameOf: (n) => (n.anchor_type === 'member' && n.anchor_id ? nameOf.get(n.anchor_id) : undefined) });
  await addKnowhow(book, teamId, 'briefing', 1500);
  const text = [
    `오늘: ${today} (이번 주 시작 ${mon}) / 팀: ${team?.name} / 미션: ${team?.mission || '-'} / 팀원 ${members.length}명`,
    ...parts,
    book.knowhowText(),
    book.text('사실과 기록'),
  ].filter(Boolean).join('\n\n');
  const { output } = await runAi({
    teamId, kind: 'advisor_weekly', model: MODEL_SMART, system: ADVISOR + NOTE_RULE, content: [{ type: 'text', text }], book,
    depth: depthOf(book.size, [6, 12, 20]), level: 'L3', createdBy, periodStart: mon, periodEnd: addDaysYmd(mon, 6), maxTokens: 9000,
  });
  return output;
}

serve(async (req) => {
  const body = await readJson<{ team_id?: string; all?: boolean }>(req);
  const caller = await getCaller(req);
  if (body.all) {
    if (!caller.isService) throw new HttpError(403, 'forbidden');
    const { data: ids } = await admin.rpc('active_ai_teams');
    const results: Record<string, string> = {};
    for (const id of (ids ?? []) as string[]) {
      try { results[id] = (await adviceFor(id, null)) ? 'ok' : 'empty'; } catch (e) { results[id] = e instanceof Error ? e.message.slice(0, 80) : 'error'; }
    }
    return json({ results });
  }
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  await assertLeader(caller, body.team_id);
  const out = await adviceFor(body.team_id, caller.userId);
  if (!out) throw new HttpError(422, 'NO_DATA', '팀원이 아직 없습니다');
  return json(out);
});
