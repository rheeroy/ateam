// 핵심 업무 — 해마다 이름이 다른 과제를 AI가 같은 일의 연속으로 묶고, 여러 해의 흐름을 정리한다 (팀장 승인 없음 · 모두 자동)
//   매주 월요일 06:30 (과제 히스토리 업데이트 다음) · 팀장 [지금 정리]
//   ① 장 접기: 끝났거나 해가 지난 과제의 히스토리를 한 장으로 접어 고정 (빠른 모델 · 한 번만)
//   ② 묶기: 아직 안 묶인 과제 + 이번 주 바뀐 과제를 기존 핵심 업무와 비교해 묶기 · 옮기기 · 새로 만들기 (빠른 모델 · 한 번)
//      확실할 때만 묶는다. 애매하면 '단독 과제'로 두고 다음 주에 다시 본다
//   ③ 정리: 바뀐 핵심 업무만, 원본 기록이 아니라 장 + 진행 중 과제 히스토리 요약을 읽고 다시 쓴다 (정밀 모델)
//   읽지 않는 것: 과제 히스토리에 이미 빠져 있는 것(1on1 · 컨디션 · 관찰 메모 · 평가 · 코칭)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader, assertFeature } from '../_shared/supabase.ts';
import { runAi, SourceBook } from '../_shared/gateway.ts';
import { MODEL_SMART, MODEL_FAST } from '../_shared/anthropic.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const FOLD_MAX = 8;        // 한 번에 접는 과제 수
const LINK_MAX = 30;       // 한 번에 묶을지 보는 과제 수
const SYNTH_MAX = 4;       // 한 번에 다시 정리하는 핵심 업무 수
const DAY = 86400000;

type Item = { id: string; title: string; note: string; status: string; owner_id: string | null; parent_id: string | null; start_date: string | null; due_date: string | null; done_at: string | null; created_at: string };
type Hist = { item_id: string; content: Record<string, unknown>; updated_at: string };
type Chapter = { id: string; core_work_id: string | null; item_id: string | null; year: number; title: string; owner_name: string; period: string; content: Record<string, unknown> };
type Core = { id: string; title: string; summary: string; content: Record<string, unknown>; dirty: boolean; synced_at: string | null };
type Action = { at: string; core_work_id: string | null; text: string };

const yearOf = (i: Item) => Number((i.start_date ?? i.due_date ?? i.created_at).slice(0, 4));
const ym = (d: string | null) => (d ? d.slice(0, 7) : '');
const lines = (x: unknown, n = 6) => (Array.isArray(x) ? x : []).slice(0, n).map((l: { text?: string; name?: string; role?: string }) => l?.text ?? (l?.name ? `${l.name}${l.role ? `(${l.role})` : ''}` : '')).filter(Boolean).join(' / ');

// ---------- ① 장 접기 ----------
const FOLD = `과제 하나의 히스토리(JSON)를 '장(章)' 한 개로 접습니다. 몇 년 뒤 이 일을 넘겨받는 사람이 읽을 기록입니다.
- 사소한 진행은 버리고, 남길 가치가 있는 것만: 무엇을 정했고(이유와 함께), 결과가 어땠고, 배운 것, 다음으로 넘어간 숙제, 엮인 사람·조직.
- 히스토리에 없는 내용을 지어내지 않습니다. 문체는 개조식 명사형.
출력 JSON: {"summary":"이 과제가 한 일 한 문장 (60자)","key":"그해 핵심 한 줄 (24자 안팎, 연도별 흐름 칸에 들어감)",
 "decisions":["무엇을 왜 정했나 (60자)"],"results":"결과 한 문장","lessons":["배운 것 · 해 봤는데 안 된 것"],"carried":["다음으로 넘어간 숙제"],
 "people":["사람·조직 — 이 과제에서의 관계 (40자)"]}  각 목록 최대 5개.`;

// ---------- ② 묶기 ----------
const LINK = `팀의 과제들을 '핵심 업무'로 묶습니다. 핵심 업무는 해가 바뀌어도 계속되는 일입니다 (예: 제휴사 파트너십 운영, 연간 예산 편성).
해마다 과제 이름은 달라도 같은 일이 이어지는지를 봅니다. 판단 근거(중요한 순서):
1) 같은 관계자(외부 회사 · 유관 부서)가 이어서 나옴  2) 앞 과제의 숙제 · 이슈 · 결정이 다음 과제에 이어짐  3) 같은 지표 · 숫자를 다룸  4) 담당자 흐름  5) 제목 · 설명 (보조로만)
규칙:
- 확실할 때만 묶습니다. 애매하면 core 를 null 로 둡니다 (단독 과제로 남고 다음 주에 다시 봄).
- 새 핵심 업무는 서로 이어지는 과제가 2개 이상일 때만 만듭니다 (아래 '과제'와 '장' 모두 셉니다). 이름은 '○○ 운영 · ○○ 관리'처럼 계속되는 일의 이름으로 (14자 안팎). 그해 목표 이름(○○ 확대 · ○○ 달성)으로 짓지 않습니다.
- 이미 묶인 과제는 근거가 분명히 달라졌을 때만 옮기거나 뺍니다 (keep 이 기본).
- reason 은 화면에 그대로 보입니다: 무엇이 같아서 묶었는지 짧게 (예: "관계자 B사 · 지표 '제휴 신규 고객'이 같음").
출력 JSON: {"new":[{"key":"N1","title":"..."}],
 "assign":[{"n":과제 번호,"core":"C1 같은 기존 id 또는 N1 같은 새 key 또는 null","keep":true/false,"reason":"..."}],
 "chapters":[{"n":장 번호,"core":"C1 또는 N1 또는 null","reason":"..."}]}`;

// ---------- ③ 정리 ----------
const SYNTH = `'핵심 업무' 하나의 여러 해 흐름을 정리합니다. 이 일을 처음 넘겨받는 사람이 하루 만에 맥락을 파악하게 하는 문서입니다.
재료: 해마다 접어 둔 '장'(끝난 과제)과 지금 진행 중인 과제의 히스토리 요약. 기존 정리가 있으면 고쳐 씁니다.
원칙:
- 재료에 있는 것만 씁니다. 추측하지 않습니다. 연도는 재료에 있는 것만.
- 낱개 사건을 늘어놓지 말고, 여러 해에 걸쳐 의미 있는 것으로 올려 정리합니다.
- principles: 지켜 온 원칙 · 확정 사항 (언제 무슨 일로 정해졌는지 year 와 함께)
- recurring: 해마다 · 분기마다 반복되는 일 (when: "매년 3월" 같이 재료로 확인되는 것만)
- tried: 해 봤는데 안 된 것 (year)
- people: 오래 이어진 관계자 — 조직 · 사람과 관계의 변화 (since: 처음 나온 해)
- open: 지금 열려 있는 숙제 (since: 처음 생긴 해)
- cautions: 넘겨받는 사람이 조심할 것 (재료에 근거가 있을 때만)
- gaps: 넘겨받는 사람에게 꼭 필요한데 재료에 없는 것 "무엇 — 기록 없음 → 누구에게 확인"
- eras: 담당자 시기 (재료의 담당자와 기간으로) [{name, from:"YYYY-MM", to:"YYYY-MM" 또는 null(지금)}]
- 문체: 개조식 명사형, 각 줄 50자 안팎. 각 목록 최대 6개.
출력 JSON: {"summary":"지금까지의 흐름과 현황 두 문장 (120자)",
 "eras":[{"name":"","from":"","to":null}],
 "principles":[{"text":"","year":2021}],"recurring":[{"text":"","when":""}],"tried":[{"text":"","year":2023}],
 "people":[{"text":"","since":2019}],"open":[{"text":"","since":2024}],"cautions":[{"text":""}],"gaps":[{"text":""}]}`;

async function load(teamId: string) {
  const [{ data: hs }, { data: items }, { data: chs }, { data: cores }, { data: links }, { data: mem }] = await Promise.all([
    admin.from('task_histories').select('item_id, content, updated_at').eq('team_id', teamId),
    admin.from('work_items').select('id, title, note, status, owner_id, parent_id, start_date, due_date, done_at, created_at').eq('team_id', teamId).limit(2000),
    admin.from('core_work_chapters').select('id, core_work_id, item_id, year, title, owner_name, period, content').eq('team_id', teamId).order('year'),
    admin.from('core_works').select('id, title, summary, content, dirty, synced_at').eq('team_id', teamId),
    admin.from('core_work_items').select('item_id, core_work_id, reason').eq('team_id', teamId),
    admin.from('team_members').select('user_id, profiles(full_name)').eq('team_id', teamId),
  ]);
  const names = new Map(((mem ?? []) as unknown as { user_id: string; profiles: { full_name: string } | null }[]).map((m) => [m.user_id, m.profiles?.full_name ?? '']));
  return {
    hists: (hs ?? []) as Hist[], items: new Map(((items ?? []) as Item[]).map((i) => [i.id, i])), chapters: (chs ?? []) as Chapter[],
    cores: (cores ?? []) as Core[], links: (links ?? []) as { item_id: string; core_work_id: string; reason: string }[],
    nameOf: (id: string | null) => (id ? names.get(id) ?? '' : ''),
  };
}

const histText = (h: Hist, i: Item, nameOf: (id: string | null) => string) => {
  const c = h.content as Record<string, unknown>;
  const owner = (c.owner as { name?: string; previous?: string[] } | undefined);
  return [`과제: ${i.title} (${yearOf(i)}년 · 상태 ${i.status} · 담당 ${[...(owner?.previous ?? []), owner?.name ?? nameOf(i.owner_id)].filter(Boolean).join(' → ')})`,
    c.summary ? `현황: ${c.summary}` : '', lines(c.people, 8) ? `관계자: ${lines(c.people, 8)}` : '',
    lines(c.fixed) ? `확정: ${lines(c.fixed)}` : '', lines(c.open) ? `미결: ${lines(c.open)}` : '', lines(c.tried) ? `이전 시도: ${lines(c.tried)}` : '',
    lines(c.risks) ? `리스크: ${lines(c.risks)}` : '', i.note ? `설명: ${i.note.slice(0, 200)}` : ''].filter(Boolean).join('\n');
};
const chapterText = (c: Chapter) => {
  const x = c.content as { summary?: string; decisions?: string[]; results?: string; lessons?: string[]; carried?: string[]; people?: string[] };
  return [`${c.year}년 · ${c.title} (담당 ${c.owner_name || '미상'}${c.period ? ` · ${c.period}` : ''})`, x.summary ?? '',
    x.decisions?.length ? `정한 것: ${x.decisions.join(' / ')}` : '', x.results ? `결과: ${x.results}` : '',
    x.lessons?.length ? `배운 것: ${x.lessons.join(' / ')}` : '', x.carried?.length ? `넘어간 숙제: ${x.carried.join(' / ')}` : '',
    x.people?.length ? `관계자: ${x.people.join(' / ')}` : ''].filter(Boolean).join('\n');
};

async function runTeam(teamId: string, createdBy: string | null) {
  const actions: Action[] = [];
  const now = () => new Date().toISOString();
  const ai = <T>(system: string, text: string, smart = false, maxTokens = 1800) => runAi<T>({
    teamId, kind: 'core_work', model: smart ? MODEL_SMART : MODEL_FAST, system, content: [{ type: 'text', text }], book: new SourceBook(),
    depth: 2, level: 'L2', createdBy, visibility: 'leader', credits: 0, force: true, maxTokens, timeoutMs: 90_000, thinking: 'fast', effort: 'low',
  }).then((r) => r.parsed);

  let d = await load(teamId);
  const histOf = new Map(d.hists.map((h) => [h.item_id, h]));
  const thisYear = Number(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 4));

  // ① 장 접기 — 끝났거나 해가 지난 과제, 아직 장이 없는 것
  const folded = new Set(d.chapters.map((c) => c.item_id).filter(Boolean));
  const toFold = d.hists.map((h) => d.items.get(h.item_id)).filter((i): i is Item => !!i && !folded.has(i.id)
    && (i.status === 'done' || yearOf(i) < thisYear || (!!i.due_date && Date.parse(i.due_date) < Date.now() - 30 * DAY))).slice(0, FOLD_MAX);
  for (const i of toFold) {
    try {
      const h = histOf.get(i.id)!;
      const out = await ai<{ summary?: string; key?: string }>(FOLD, `## 과제 히스토리\n${histText(h, i, d.nameOf)}\n\n## 원본 JSON\n${JSON.stringify(h.content).slice(0, 9000)}`);
      const owner = (h.content.owner as { name?: string } | undefined)?.name ?? d.nameOf(i.owner_id);
      const link = d.links.find((l) => l.item_id === i.id);
      await admin.from('core_work_chapters').insert({ team_id: teamId, item_id: i.id, core_work_id: link?.core_work_id ?? null, year: yearOf(i), title: i.title,
        owner_name: owner, period: [ym(i.start_date ?? i.created_at), ym(i.done_at ?? i.due_date)].filter(Boolean).join(' ~ '), content: out });
      if (link) await admin.from('core_works').update({ dirty: true }).eq('id', link.core_work_id);
      actions.push({ at: now(), core_work_id: link?.core_work_id ?? null, text: `${yearOf(i)} '${i.title}'을 장으로 접어 고정` });
    } catch (e) { console.error('fold failed', i.id, e); }
  }
  if (toFold.length) d = await load(teamId);

  // ② 묶기 — 안 묶인 과제(히스토리 있는 것) + 이번 주 히스토리가 바뀐 묶인 과제 + 어디에도 안 붙은 장
  const linked = new Map(d.links.map((l) => [l.item_id, l]));
  const week = Date.now() - 8 * DAY;
  const cand = d.hists.map((h) => ({ h, i: d.items.get(h.item_id) })).filter((x): x is { h: Hist; i: Item } => !!x.i)
    .filter((x) => !linked.has(x.i.id) || Date.parse(x.h.updated_at) > week).slice(0, LINK_MAX);
  const looseCh = d.chapters.filter((c) => !c.core_work_id && !(c.item_id && cand.some((x) => x.i.id === c.item_id)) && !(c.item_id && linked.has(c.item_id))).slice(0, 20);
  if (cand.some((x) => !linked.has(x.i.id)) || looseCh.length) {
    const coreIds = d.cores.map((c, k) => ({ key: `C${k + 1}`, c }));
    const keyOf = new Map(coreIds.map((x) => [x.c.id, x.key]));
    const text = [
      '## 기존 핵심 업무', coreIds.length ? coreIds.map((x) => `[${x.key}] ${x.c.title} — ${x.c.summary || '(정리 전)'}\n  관계자: ${lines((x.c.content as { people?: unknown }).people, 6) || '-'}\n  묶인 장: ${d.chapters.filter((ch) => ch.core_work_id === x.c.id).map((ch) => `${ch.year} ${ch.title}`).join(', ') || '-'}`).join('\n') : '(없음)',
      '', '## 과제', cand.map((x, k) => `[${k + 1}] ${linked.has(x.i.id) ? `(지금 ${keyOf.get(linked.get(x.i.id)!.core_work_id) ?? '?'}에 묶여 있음) ` : ''}${histText(x.h, x.i, d.nameOf)}`).join('\n\n'),
      '', '## 어디에도 안 붙은 장 (끝난 과제)', looseCh.length ? looseCh.map((c, k) => `[${k + 1}] ${chapterText(c)}`).join('\n\n') : '(없음)',
    ].join('\n');
    try {
      const out = await ai<{ new?: { key: string; title: string }[]; assign?: { n: number; core: string | null; keep?: boolean; reason?: string }[]; chapters?: { n: number; core: string | null; reason?: string }[] }>(LINK, text, false, 2500);
      // 새 핵심 업무는 실제로 2개 이상이 붙을 때만 만든다
      const uses = new Map<string, number>();
      for (const a of [...(out.assign ?? []), ...(out.chapters ?? [])]) if (a.core?.startsWith('N')) uses.set(a.core, (uses.get(a.core) ?? 0) + 1);
      const created = new Map<string, string>();
      for (const n of out.new ?? []) {
        if ((uses.get(n.key) ?? 0) < 2 || !n.title?.trim()) continue;
        const { data } = await admin.from('core_works').insert({ team_id: teamId, title: n.title.trim().slice(0, 40), dirty: true }).select('id').single();
        if (data) { created.set(n.key, data.id); actions.push({ at: now(), core_work_id: data.id, text: `새 핵심 업무 '${n.title.trim()}'을 만듦` }); }
      }
      const resolve = (k: string | null) => (!k ? null : k.startsWith('N') ? created.get(k) ?? null : coreIds.find((x) => x.key === k)?.c.id ?? null);
      for (const a of out.assign ?? []) {
        const x = cand[Number(a.n) - 1]; if (!x) continue;
        const cur = linked.get(x.i.id);
        if (cur && (a.keep !== false)) continue;
        const to = resolve(a.core);
        const reason = (a.reason ?? '').slice(0, 120);
        if (to && to !== cur?.core_work_id) {
          await admin.from('core_work_items').upsert({ item_id: x.i.id, core_work_id: to, team_id: teamId, reason, linked_at: now() });
          await admin.from('core_work_chapters').update({ core_work_id: to }).eq('item_id', x.i.id);
          await admin.from('core_works').update({ dirty: true }).in('id', [to, cur?.core_work_id].filter(Boolean) as string[]);
          const title = d.cores.find((c) => c.id === to)?.title ?? (out.new ?? []).find((n) => created.get(n.key) === to)?.title ?? '';
          actions.push({ at: now(), core_work_id: to, text: `${yearOf(x.i)} '${x.i.title}'을 ${cur ? '옮겨 ' : ''}'${title}'에 묶음${reason ? ` (${reason})` : ''}` });
        } else if (!to && cur && a.keep === false) {
          await admin.from('core_work_items').delete().eq('item_id', x.i.id);
          await admin.from('core_work_chapters').update({ core_work_id: null }).eq('item_id', x.i.id);
          await admin.from('core_works').update({ dirty: true }).eq('id', cur.core_work_id);
          actions.push({ at: now(), core_work_id: cur.core_work_id, text: `'${x.i.title}'을 단독 과제로 뺌${reason ? ` (${reason})` : ''}` });
        }
      }
      for (const a of out.chapters ?? []) {
        const c = looseCh[Number(a.n) - 1]; const to = resolve(a.core); if (!c || !to) continue;
        await admin.from('core_work_chapters').update({ core_work_id: to }).eq('id', c.id);
        await admin.from('core_works').update({ dirty: true }).eq('id', to);
        actions.push({ at: now(), core_work_id: to, text: `${c.year} '${c.title}' 장을 묶음${a.reason ? ` (${a.reason.slice(0, 80)})` : ''}` });
      }
    } catch (e) { console.error('link failed', e); }
    d = await load(teamId);
  }

  // ③ 정리 — 바뀐 핵심 업무 (묶인 과제 히스토리가 지난 정리 이후 바뀐 것 포함)
  const changed = d.cores.filter((c) => c.dirty || d.links.some((l) => l.core_work_id === c.id && Date.parse(d.hists.find((h) => h.item_id === l.item_id)?.updated_at ?? '1970') > Date.parse(c.synced_at ?? '1970')))
    .slice(0, SYNTH_MAX);
  for (const c of changed) {
    const chs = d.chapters.filter((x) => x.core_work_id === c.id).sort((a, b) => a.year - b.year);
    const live = d.links.filter((l) => l.core_work_id === c.id && !chs.some((x) => x.item_id === l.item_id))
      .map((l) => ({ h: d.hists.find((h) => h.item_id === l.item_id), i: d.items.get(l.item_id) })).filter((x): x is { h: Hist; i: Item } => !!x.h && !!x.i);
    if (!chs.length && !live.length) continue;
    try {
      const out = await ai<Record<string, unknown> & { summary?: string }>(SYNTH, [
        `## 핵심 업무: ${c.title}`, c.summary ? `## 기존 정리\n${JSON.stringify(c.content).slice(0, 6000)}` : '',
        '## 장 (끝난 과제, 오래된 순)', chs.map(chapterText).join('\n\n') || '(없음)',
        '## 진행 중인 과제', live.map((x) => histText(x.h, x.i, d.nameOf)).join('\n\n') || '(없음)'].filter(Boolean).join('\n\n'), true, 3000);
      const years = [...chs.map((x) => x.year), ...live.map((x) => yearOf(x.i))];
      await admin.from('core_works').update({ summary: (out.summary ?? '').slice(0, 300), content: out, since_year: years.length ? Math.min(...years) : null,
        dirty: false, synced_at: now(), updated_at: now() }).eq('id', c.id);
      actions.push({ at: now(), core_work_id: c.id, text: `'${c.title}' 흐름을 다시 정리 (장 ${chs.length}개 · 진행 중 과제 ${live.length}개)` });
    } catch (e) { console.error('synth failed', c.id, e); }
  }

  const { data: st } = await admin.from('core_work_state').select('actions').eq('team_id', teamId).maybeSingle();
  await admin.from('core_work_state').update({ status: 'ready', finished_at: now(), actions: [...actions.reverse(), ...((st?.actions as Action[]) ?? [])].slice(0, 40) }).eq('team_id', teamId);
  return { folded: toFold.length, actions: actions.length };
}

serve(async (req) => {
  const body = await readJson<{ team_id?: string; weekly?: boolean }>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const caller = await getCaller(req);
  await assertLeader(caller, body.team_id);
  await assertFeature(body.team_id, 'history');
  const { data: go, error } = await admin.rpc('core_work_claim', { p_team: body.team_id });
  if (error) throw error;
  if (!go) return json({ status: 'running' });
  const work = runTeam(body.team_id, caller.userId).catch(async (e) => {
    console.error('core works failed', e);
    await admin.from('core_work_state').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('team_id', body.team_id!);
  });
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else await work;
  return json({ status: 'running' });
});
