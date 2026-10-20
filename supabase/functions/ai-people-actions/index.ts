// 팀원관리 주간 액션 — 팀원별 사실을 모아 이번 주에 할 관리 행동(1:1 · 칭찬 · 관찰 · 육성 · 독려 · 지원 · 조정)과 업무 수행 경과 판단 (코어 AI)
// 팀장 요청: {team_id}  /  예약 작업(월요일): {all: true}
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, addKnowhow, weekLabel } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { PEOPLE_ACTIONS } from '../_shared/prompts/index.ts';
import { conditionText } from '../_shared/condition.ts';
import { kstToday, kstMonday, addDaysYmd, loadRaw, flagsFor } from '../_shared/signals.ts';
import { NOTE_RULE, addNote, loadLeaderNotes } from '../_shared/notes.ts';

const DAY = 86400000;
const since = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const avg = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : null);

async function actionsFor(teamId: string, createdBy: string | null) {
  const { data: team } = await admin.from('teams').select('name, mission').eq('id', teamId).single();
  const { data: tm } = await admin.from('team_members').select('user_id, role, job_title, weekly_hours, joined_at, profiles(full_name)').eq('team_id', teamId).eq('status', 'active');
  const members = (tm ?? []).filter((m) => m.role === 'member');
  if (!members.length) return null;
  const today = kstToday();
  const mon = kstMonday();
  const { data: attnRows } = await admin.rpc('leader_attention', { p_team: teamId, p_days: 28 });
  const attn = new Map(((attnRows ?? []) as { user_id: string; oo: number; comments: number; obs: number; praise: number; reqs: number; item_comments: number; touch: number; resp_hours: number | null; waiting: number }[]).map((r) => [r.user_id, r]));
  const touches = [...attn.values()].map((r) => Number(r.touch)).sort((a, b) => a - b);
  const medTouch = touches.length ? touches[Math.floor(touches.length / 2)] : null;
  const [cis, oos, obs, scores, items, subs, reqs] = await Promise.all([
    admin.from('checkins').select('id, user_id, week_start, condition, moods, note').eq('team_id', teamId).gte('week_start', addDaysYmd(mon, -42)).order('week_start'),
    admin.from('one_on_ones').select('id, member_id, scheduled_at, status').eq('team_id', teamId).gte('scheduled_at', since(120)),
    admin.from('observations').select('id, subject_id, kind, body, occurred_at').eq('team_id', teamId).gte('occurred_at', addDaysYmd(today, -60)),
    admin.from('judgment_scores').select('user_id, score, scored_at').eq('team_id', teamId).gte('scored_at', since(240)).order('scored_at'),
    admin.from('work_items').select('id, owner_id, title, status, progress, start_date, due_date, base_start, base_due, created_at, est_hours_per_week, measure, replan_count').eq('team_id', teamId).not('status', 'in', '(dropped,proposed)'),
    admin.from('submissions').select('id, author_id, title, status, updated_at').eq('team_id', teamId).gte('updated_at', since(45)),
    admin.from('team_requests').select('id, to_id, title, status, due_date, responded_at, created_at').eq('team_id', teamId).gte('created_at', since(45)),
  ]);
  const book = new SourceBook();
  const blocks: string[] = [];
  // 팀장 개인 메모 중 AI 참고를 허용한 것 (팀원에 붙인 것만)
  const leaderId = (tm ?? []).find((x) => x.role === 'leader')?.user_id;
  const myNotes = leaderId ? await loadLeaderNotes(teamId, leaderId, { types: ['member'], limit: 40 }) : [];
  // 팀원별 선행 신호 (인정 공백 · 의지는 있는데 막힘 · 성장 정체 · 팀장 약속 밀림 · 참여 위축) — 홈·팀원 지수와 같은 규칙
  const raw = leaderId ? await loadRaw(admin, teamId, leaderId, 8).catch(() => null) : null;
  for (const m of members) {
    const uid = m.user_id;
    const name = (m.profiles as unknown as { full_name: string })?.full_name ?? '팀원';
    const ci = (cis.data ?? []).filter((c) => c.user_id === uid);
    const cond = ci.map((c) => c.condition).filter((x): x is number => x != null);
    const lastCi = ci[ci.length - 1];
    const done = (oos.data ?? []).filter((o) => o.member_id === uid && o.status === 'done').sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));
    const next = (oos.data ?? []).filter((o) => o.member_id === uid && o.status === 'scheduled' && o.scheduled_at >= new Date().toISOString());
    const ob = (obs.data ?? []).filter((o) => o.subject_id === uid);
    const sc = (scores.data ?? []).filter((s) => s.user_id === uid).map((s) => Number(s.score));
    const its = (items.data ?? []).filter((i) => i.owner_id === uid);
    const active = its.filter((i) => i.status === 'active' || i.status === 'blocked');
    const behind = active.filter((i) => {
      const e = i.base_due ?? i.due_date; if (!e || i.measure === 'recurring') return false;
      const s = Date.parse((i.base_start ?? i.start_date ?? i.created_at).slice(0, 10)); const E = Date.parse(e) + DAY;
      const plan = E > s ? Math.max(0, Math.min(1, (Date.now() - s) / (E - s))) * 100 : 100;
      return i.progress - plan <= -15;
    });
    const overdue = active.filter((i) => i.due_date && i.due_date < today);
    const hours = active.reduce((a, i) => a + Number(i.est_hours_per_week ?? 0), 0);
    const doneRecent = its.filter((i) => i.status === 'done');
    const sb = (subs.data ?? []).filter((s) => s.author_id === uid);
    const rq = (reqs.data ?? []).filter((r) => r.to_id === uid);
    const rqLate = rq.filter((r) => r.status === 'open' && r.due_date && r.due_date < today);
    const rqOnTime = rq.filter((r) => r.status === 'done' && (!r.due_date || (r.responded_at ?? '').slice(0, 10) <= r.due_date));

    const facts = [
      `id=${uid}`, `직무 ${m.job_title || '-'}`, `주 가용 ${m.weekly_hours}시간`,
      `컨디션 최근 ${cond.slice(-6).join('→') || '기록 없음'}`,
      `마지막 1:1 ${done[0] ? `${Math.floor((Date.now() - Date.parse(done[0].scheduled_at)) / DAY)}일 전` : '기록 없음'}${next.length ? ` · 다음 1:1 예정 ${next[0].scheduled_at.slice(0, 10)}` : ''}`,
      `관찰 60일 칭찬 ${ob.filter((o) => o.kind === 'praise').length} · 우려 ${ob.filter((o) => o.kind === 'concern').length} · 메모 ${ob.filter((o) => o.kind === 'note').length}`,
      `결과물 판단 깊이 최근 ${avg(sc.slice(-3)) ?? '-'} (이전 ${avg(sc.slice(-6, -3)) ?? '-'}) /4`,
      `맡은 일 진행 ${active.length}건 · 막힘 ${active.filter((i) => i.status === 'blocked').length} · 계획보다 15%p 이상 늦음 ${behind.length} · 기한 지남 ${overdue.length} · 완료 ${doneRecent.length} · 주당 예상 ${hours}시간`,
      `결과물 45일 ${sb.length}건 (리뷰 중 ${sb.filter((s) => s.status === 'in_review').length} · 보완 요청 ${sb.filter((s) => s.status === 'needs_work').length} · 승인 ${sb.filter((s) => s.status === 'approved').length})`,
      `요청 45일 ${rq.length}건 (기한 안 완료 ${rqOnTime.length} · 기한 지남 ${rqLate.length})`,
      ...(attn.get(uid) ? [(() => { const a = attn.get(uid)!; return `팀장 접점 28일 ${a.touch} (팀 중앙값 ${medTouch ?? '-'}; 1:1 ${a.oo} · 리뷰 코멘트 ${a.comments} · 관찰 ${a.obs} · 칭찬 ${a.praise} · 요청 ${a.reqs} · 과제 코멘트 ${a.item_comments}) · 리뷰 첫 반응 평균 ${a.resp_hours ?? '-'}시간 · 반응 기다리는 결과물 ${a.waiting}`; })()] : []),
      `입사 ${Math.floor((Date.now() - Date.parse(m.joined_at)) / DAY)}일`,
      (() => { const f = raw ? flagsFor(raw, uid) : []; return `선행 신호 ${f.length ? f.map((x) => `${x.label}(${x.detail})`).join(' · ') : '없음'}`; })(),
    ].join(' / ');
    const tag = book.add('member', uid, `${name} 이번 주 사실`, facts);
    const extra: string[] = [];
    if (lastCi) extra.push(book.add('checkin', lastCi.id, `컨디션 공유 ${name} ${weekLabel(lastCi.week_start)}`, conditionText(lastCi)));
    for (const o of ob.filter((x) => x.kind !== 'note').slice(-2)) extra.push(book.add('observation', o.id, `관찰 ${name} ${o.occurred_at}`, `${o.kind === 'praise' ? '칭찬' : '우려'}: ${o.body}`));
    for (const i of [...overdue, ...behind].slice(0, 2)) extra.push(book.add('task', i.id, `${name} 담당 · ${i.title}`, `진척 ${i.progress}% · 마감 ${i.due_date ?? '-'} · 상태 ${i.status}${i.replan_count ? ` · 계획 변경 ${i.replan_count}회` : ''}`));
    for (const s of sb.filter((x) => x.status === 'approved').slice(0, 1)) extra.push(book.add('submission', s.id, `${name} 결과물 승인`, s.title));
    for (const n of myNotes.filter((x) => x.anchor_id === uid).slice(0, 2)) extra.push(addNote(book, n, name));
    blocks.push(`### ${name} ${tag}${extra.length ? ` (관련 기록 ${extra.join(' ')})` : ''}`);
  }
  await addKnowhow(book, teamId, 'prep', 1000, false, false); // 팀원 액션은 컨설팅 기준 카드를 싣지 않는다
  const text = [
    `오늘: ${today} (이번 주 시작 ${mon}) / 팀: ${team?.name} / 미션: ${team?.mission || '-'}`,
    `## 팀원 (${members.length}명)\n${blocks.join('\n')}`,
    book.knowhowText(),
    book.text('팀원별 사실과 기록'),
  ].filter(Boolean).join('\n\n');
  const { output } = await runAi({
    teamId, kind: 'people_actions', model: MODEL_SMART, system: PEOPLE_ACTIONS + NOTE_RULE, content: [{ type: 'text', text }], book,
    depth: depthOf(book.size, [6, 14, 26]), level: 'L2', createdBy, periodStart: mon, periodEnd: addDaysYmd(mon, 6), maxTokens: 4000,
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
      try { results[id] = (await actionsFor(id, null)) ? 'ok' : 'empty'; } catch (e) { results[id] = e instanceof Error ? e.message.slice(0, 80) : 'error'; }
    }
    return json({ results });
  }
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  await assertLeader(caller, body.team_id);
  const out = await actionsFor(body.team_id, caller.userId);
  if (!out) throw new HttpError(422, 'NO_DATA', '팀원이 아직 없습니다');
  return json(out);
});
