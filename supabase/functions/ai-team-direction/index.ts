// 팀 방향 — 팀원 업무플랫폼의 고정 탭 [📌 팀 방향] · 매니징 보드 '팀장님 주요 지침'
//   허용 목록 방식: 화면에 나가는 문장은 ① 팀 목표 제목(팀원이 이미 보는 것) ② 우리가 미리 쓴 기준 문장(STANDARDS)
//   ③ 공유된 노하우 제목뿐이다. AI는 팀장이 남긴 피드백 · 요청을 STANDARDS 로 분류해 '어느 기준이 몇 번'만 돌려준다.
//   위에서 온 것(팀장 메모)은 읽지 않는다. 기록이 적으면 적은 대로 비워 둔다 (지어내지 않음)
//   팀원이 탭을 열 때 7일이 지났으면 새로 정리한다 (팀장은 1시간에 한 번 '새로 정리' 가능). 뒤에서 만들고 화면은 상태를 다시 읽는다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { runAi, SourceBook } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { teamPeople, directionMaterials, hasName, SENSITIVE_RE, STANDARDS, type DirectionContent, type DirectionItem } from '../_shared/teampublic.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const PROMPT = `과제: 팀장이 결과물에 남긴 의견과 팀원에게 보낸 요청(아래 '기록', 번호 붙음)을 읽고, 각 기록이 아래 '기준 목록' 중 어디에 해당하는지 분류합니다.
- 기록 하나가 여러 기준에 해당할 수 있습니다. 분명히 해당할 때만 넣고, 애매하면 넣지 않습니다.
- 어느 기준에도 맞지 않는 기록은 버립니다. 새 기준을 만들지 않습니다. 문장을 쓰지 않습니다.
기준 목록:
${STANDARDS.map((x) => `- ${x.id}: ${x.text}`).join('\n')}
출력 JSON: { "matches": [{ "id": 기준 id, "records": [기록 번호, ...] }] }`;

type Out = { matches?: { id?: string; records?: number[] }[] };
const DAY = 86400000;

serve(async (req) => {
  const body = await readJson<{ team_id?: string; force?: boolean }>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const teamId = body.team_id;
  const caller = await getCaller(req);
  let leader = caller.isService;
  if (!caller.isService) {
    const { data: m } = await admin.from('team_members').select('role, status').eq('team_id', teamId).eq('user_id', caller.userId!).maybeSingle();
    if (!m || m.status !== 'active') throw new HttpError(403, 'forbidden');
    leader = m.role === 'leader';
  }
  const { data: go, error } = await admin.rpc('team_direction_claim', { p_team: teamId, p_force: !!body.force && leader });
  if (error) throw error;
  if (!go) {
    const { data: row } = await admin.from('team_directions').select('*').eq('team_id', teamId).maybeSingle();
    return json(row ?? { status: 'ready', content: {} });
  }

  const work = async () => {
    try {
      const people = await teamPeople(teamId);
      const mat = await directionMaterials(teamId, people);
      const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
      const isNew = (d: string) => !!d && Date.parse(today) - Date.parse(d) <= 7 * DAY;
      const safe = (t: string) => !!t && !hasName(t, people) && !SENSITIVE_RE.test(t);

      // ① 이번 분기 방향 — 팀 목표 그대로 (AI 없음)
      const quarter: DirectionItem[] = mat.goals.filter((g) => safe(g.title)).map((g) => ({ text: g.title, why: g.sub, source: '팀 목표', date: g.date, repeat: 1, new: isNew(g.created) }));

      // ② 일하는 방식 — 기록을 기준 목록으로 분류만. 서로 다른 기록 2번 이상인 기준만
      let ways: DirectionItem[] = [];
      if (mat.occasions.length >= 2) {
        const text = mat.occasions.map((o, i) => `[${i + 1}] ${o.date} ${o.text}`).join('\n');
        const { parsed } = await runAi<Out>({
          teamId, kind: 'team_direction', model: MODEL_SMART, system: PROMPT, content: [{ type: 'text', text: `## 기록\n${text}` }], book: new SourceBook(),
          depth: 2, level: 'L2', createdBy: caller.userId, visibility: 'team', credits: 0, force: true,
          maxTokens: 1500, timeoutMs: 90_000, thinking: 'fast', effort: 'low',
        });
        ways = (parsed.matches ?? []).flatMap((m) => {
          const st = STANDARDS.find((x) => x.id === m?.id);
          const recs = [...new Set((m?.records ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= mat.occasions.length))];
          if (!st || recs.length < 2) return [];
          const last = recs.map((n) => mat.occasions[n - 1].date).sort().pop() ?? '';
          return [{ text: st.text, why: st.why, source: st.group, date: last, repeat: recs.length, new: false }];
        }).sort((x, y) => (y.repeat ?? 0) - (x.repeat ?? 0)).slice(0, 5);
      }

      // ③ 최근 바뀐 것 — 2주 안에 새로 생긴 팀 목표 · 공유된 노하우 (제목만)
      const changes: DirectionItem[] = [
        ...mat.goals.filter((g) => Date.parse(today) - Date.parse(g.created) <= 14 * DAY && safe(g.title)).map((g) => ({ text: `새 목표: ${g.title}`, why: g.sub, source: '팀 목표', date: g.created, repeat: 1, new: isNew(g.created) })),
        ...mat.knowhow.filter((k) => Date.parse(today) - Date.parse(k.created) <= 14 * DAY && safe(k.title)).map((k) => ({ text: k.title, why: '팀 노하우로 공유됐습니다', source: '팀 노하우', date: k.created, repeat: 1, new: isNew(k.created) })),
      ].slice(0, 3);

      const content: DirectionContent = {
        title: `${mat.team || "우리 팀"} — 지금 중요하게 보는 것`,
        generated_at: new Date().toISOString(),
        sections: [
          { key: 'quarter', title: '이번 분기 방향', sub: '팀 목표', items: quarter },
          { key: 'ways', title: '팀장님이 일하는 방식', sub: '결과물 의견 · 요청에서 2번 이상 나온 기준', items: ways },
          { key: 'changes', title: '최근 바뀐 것', sub: '2주 안에 새로 생긴 목표 · 노하우', items: changes },
        ].filter((s) => s.items.length),
      };
      await admin.from('team_directions').update({ content, status: 'ready', updated_at: new Date().toISOString() }).eq('team_id', teamId);
    } catch (e) {
      console.error('team direction failed', e);
      await admin.from('team_directions').update({ status: 'failed' }).eq('team_id', teamId);
    }
  };
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work());
  else await work();
  return json({ status: 'running' });
});
