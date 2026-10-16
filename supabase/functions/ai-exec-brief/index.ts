// 상향 관리 › 임원 브리핑 — 상위 관리자 시선으로 이번 주 물어볼 것 · 챌린지할 것 · 답할 요청 · 먼저 알릴 것 (코어 AI, 팀장이 누를 때만)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { EXEC_BRIEF } from '../_shared/prompts/index.ts';
import { NOTE_RULE, addLeaderNotes } from '../_shared/notes.ts';
import { analyze, loadRaw, signalsFor, sectionOf, kstToday, kstMonday, addDaysYmd, DOMAIN_META, TYPE_LABEL, SECTION_NAME, type RawMember } from '../_shared/signals.ts';

const DAY = 86400000;
const ORGK: Record<string, string> = { strategy: '전략·방향 변경', exec: '임원 관심사', request: '상위 요청', peer: '유관 부서', calendar: '전사 일정', other: '기타' };
const strip = (t?: string) => (t ?? '').replace(/\s*\[E\d+\]/g, '');

serve(async (req) => {
  const body = await readJson<{ team_id?: string; force?: boolean }>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const caller = await getCaller(req);
  await assertLeader(caller, body.team_id);
  const teamId = body.team_id;

  const { data: team } = await admin.from('teams').select('id, name, mission, settings').eq('id', teamId).single();
  const { data: tm } = await admin.from('team_members').select('user_id, role, profiles(full_name)').eq('team_id', teamId).eq('status', 'active');
  const all: RawMember[] = (tm ?? []).map((m) => ({ user_id: m.user_id, role: m.role, name: (m.profiles as unknown as { full_name: string })?.full_name ?? '' }));
  const leader = all.find((m) => m.role === 'leader');
  if (!leader) throw new HttpError(422, 'NO_LEADER');
  const today = kstToday();
  const mon = kstMonday();
  const book = new SourceBook();

  // 1) 상위 관리자 프로필
  const { data: execs } = await admin.from('executives').select('id, name, title, style_tags, interests, prefs').eq('team_id', teamId).order('sort');
  const execName = new Map((execs ?? []).map((e) => [e.id, e.name]));
  const execLines = (execs ?? []).map((e) => `id=${e.id} / ${e.name}${e.title ? ` (${e.title})` : ''} / 성향: ${(e.style_tags ?? []).join(', ') || '-'} / 관심사: ${e.interests || '-'} / 보고 선호: ${e.prefs || '-'}`);

  // 2) 위에서 내려온 것 (열린 것 + 최근 처리한 것 일부) + AI 영향 분석
  const { data: notes } = await admin.from('org_notes').select('id, kind, title, body, source, event_date, status, exec_id, created_at').eq('team_id', teamId)
    .gte('created_at', new Date(Date.now() - 60 * DAY).toISOString()).order('created_at', { ascending: false }).limit(14);
  const ids = (notes ?? []).map((n) => n.id);
  const { data: imps } = ids.length ? await admin.from('ai_outputs').select('ref_id, content').eq('kind', 'org_impact').in('ref_id', ids) : { data: [] };
  for (const n of notes ?? []) {
    const im = (imps ?? []).find((i) => i.ref_id === n.id)?.content as { summary?: string; report_line?: string; level?: string } | undefined;
    book.add('org_note', n.id, `위에서 온 것 · ${ORGK[n.kind] ?? n.kind}${n.exec_id && execName.get(n.exec_id) ? ` · ${execName.get(n.exec_id)}` : ''}`,
      `id=${n.id} / ${n.title}${n.event_date ? ` (기한·일정 ${n.event_date})` : ''}${n.status === 'done' ? ' [처리함]' : ''} / ${n.body ?? ''}${n.source ? ` / 출처 ${n.source}` : ''}${im?.summary ? ` / 팀 영향(${im.level ?? '-'}): ${strip(im.summary)}` : ''}${im?.report_line ? ` / 보고 문장 초안: ${strip(im.report_line)}` : ''}`.slice(0, 900));
  }

  // 3) 팀 상태 (계산값)
  const minEv = Number((team?.settings as Record<string, unknown>)?.min_judgment_evidence ?? 8);
  const raw = await loadRaw(admin, teamId, leader.user_id, minEv);
  const { signals, domains } = analyze(raw, all);
  for (const s of signalsFor('weekly', signals).filter((x) => x.type !== 'data').slice(0, 14))
    book.add('signal', null, `[${SECTION_NAME[sectionOf(s)]}] ${DOMAIN_META[s.domain].name} · ${TYPE_LABEL[s.type]}`, `${s.title}${s.detail ? ` — ${s.detail}` : ''}`);
  if (raw.goals?.length) book.add('goals', null, '목표 진척 · 달성 가능성(모델)', raw.goals.slice(0, 6).map((g) => `${g.title} 진척 ${g.progress}% · 달성 가능성 ${g.probability ?? '-'}% · 막힘 ${g.blocked}`).join(' / '));
  for (const f of (raw.forecasts ?? []).filter((x) => !x.insufficient).slice(0, 3)) book.add('forecast', null, `실적 전망 · ${f.name}`, `목표 ${f.target ?? '-'}${f.unit} · 기준 전망 ${f.base ?? '-'}${f.unit} (범위 ${f.low ?? '-'}~${f.high ?? '-'}) · 달성 확률 ${f.probability ?? '-'}%`);
  const { data: decs } = await admin.from('decisions').select('id, title, decided_at, review_on').eq('team_id', teamId).is('outcome', null).order('decided_at', { ascending: false }).limit(4);
  for (const d of decs ?? []) book.add('decision', d.id, `결정 · ${d.title}`, `결정 ${String(d.decided_at).slice(0, 10)}${d.review_on ? ` · 돌아볼 날 ${d.review_on}` : ''} · 결과 미기록`);

  // 4) 이번 주 진단 · ATEAM의 제안 중 위와 관련된 것
  const latest = async (kind: string) => (await admin.from('ai_outputs').select('id, content, period_start, created_at').eq('team_id', teamId).eq('kind', kind).neq('status', 'withheld').order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  const ins = await latest('insight_weekly') ?? await latest('insight_daily');
  if (ins) {
    const c = ins.content as { headline?: string; sections?: Record<string, { summary?: string }> };
    book.add('insight', ins.id, 'AI 인사이트 진단', strip(`${c.headline ?? ''} / 성과: ${c.sections?.perf?.summary ?? '-'} / 조직: ${c.sections?.org?.summary ?? '-'} / 리스크: ${c.sections?.risk?.summary ?? '-'}`));
  }
  const adv = await latest('advisor_weekly');
  if (adv) {
    const c = adv.content as { headline?: string; advice?: { title: string; lever: string; route: string; script?: string }[] };
    const up = (c.advice ?? []).filter((a) => a.lever === 'external' || a.route === 'report' || a.lever === 'staffing');
    if (up.length) book.add('advisor', adv.id, 'ATEAM의 제안 중 위와 관련된 것', up.map((a) => `${strip(a.title)}${a.script ? ` (보고 문장: ${strip(a.script)})` : ''}`).join(' / '));
  }
  // 팀장 개인 메모 (AI 참고 허용한 것) — 상위 관리자 · 목표 · 결정에 붙인 것과 붙이지 않은 것
  await addLeaderNotes(book, teamId, leader.user_id, { types: ['exec', 'item', 'decision', 'none'], limit: 10, nameOf: (n) => (n.anchor_type === 'exec' && n.anchor_id ? execName.get(n.anchor_id) : undefined) });
  if (book.size === 0 && !execLines.length) throw new HttpError(422, 'NO_DATA', '상위 관리자나 위에서 온 것을 먼저 하나 남겨 주세요.');
  await addKnowhow(book, teamId, 'report', 1200);

  const text = [
    `오늘: ${today} (이번 주 ${mon} ~ ${addDaysYmd(mon, 6)}) / 팀: ${team?.name} / 미션: ${team?.mission || '-'}`,
    `## 상위 관리자\n${execLines.length ? execLines.join('\n') : '(등록된 프로필 없음 — "상위 조직장" 한 명으로 쓰세요)'}`,
    `## 영역별 상태 (계산값)\n${domains.map((d) => `${DOMAIN_META[d.domain].name}: ${d.status}, ${d.kpiLabel} ${d.kpi}`).join('\n')}`,
    book.knowhowText(),
    book.text('위에서 온 것과 팀 사실'),
  ].filter(Boolean).join('\n\n');

  const { output } = await runAi({
    teamId, kind: 'exec_brief', model: MODEL_SMART, system: EXEC_BRIEF + NOTE_RULE, content: [{ type: 'text', text }], book,
    depth: depthOf(book.size, [5, 10, 18]), level: 'L3', createdBy: caller.userId, periodStart: mon, periodEnd: addDaysYmd(mon, 6),
    maxTokens: 9000, force: !!body.force,
  });
  return json(output);
});
