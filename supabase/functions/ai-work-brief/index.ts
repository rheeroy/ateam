// 업무플랫폼 Core Insight — 리뷰 기다리는 결과물들을 AI가 먼저 읽고 '무엇부터 어떻게 볼지'를 한 줄씩 (코어 AI)
//   근거: 결과물마다 이미 있는 AI 1차 검토(질 평가 다섯 축 · 보완점) + 요청 종류 + 기다린 날 + 본문 앞부분
//   새 결과물·새 검토가 없으면 AI를 다시 부르지 않고 마지막 브리핑을 돌려준다 (force 로 다시 읽기)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART } from '../_shared/anthropic.ts';
import { WORK_BRIEF } from '../_shared/prompts/index.ts';

const DAY = 86400000;
const AXIS: Record<string, string> = { completeness: '완성도', depth: '고민의 깊이', logic: '논리성', originality: '창의성', clarity: '전달력' };
type Q = Record<string, { score: number | null; note?: string } | undefined>;
type Rv = { depth_score?: number; summary?: string; quality?: Q; gaps?: { section?: string; text: string }[]; criteria_check?: { criterion: string; met: boolean }[] };

serve(async (req) => {
  const { team_id, force } = await readJson<{ team_id: string; force?: boolean }>(req);
  if (!team_id) throw new HttpError(400, 'MISSING_TEAM');
  const caller = await getCaller(req);
  await assertLeader(caller, team_id);

  const { data: subs } = await admin.from('submissions').select('id, author_id, title, request_type, kind, created_at, updated_at')
    .eq('team_id', team_id).eq('status', 'in_review').order('updated_at', { ascending: false }).limit(15);
  if (!subs?.length) throw new HttpError(422, 'NO_DATA', '리뷰를 기다리는 결과물이 없습니다');

  const { data: ppl } = await admin.from('profiles').select('id, full_name').in('id', [...new Set(subs.map((s) => s.author_id))]);
  const nameOf = (id: string) => (ppl ?? []).find((p) => p.id === id)?.full_name ?? '팀원';
  // 결과물별 최신 버전 + 그 버전의 AI 검토
  const rows: { s: typeof subs[number]; ver: { id: string; version: number; created_at: string; extracted_text: string | null } | null; rv: Rv | null; rvAt: string | null }[] = [];
  for (const s of subs) {
    const { data: ver } = await admin.from('submission_versions').select('id, version, created_at, extracted_text').eq('submission_id', s.id).order('version', { ascending: false }).limit(1).maybeSingle();
    let rv: Rv | null = null, rvAt: string | null = null;
    if (ver) {
      const { data: r } = await admin.from('ai_outputs').select('content, edited_content, created_at').eq('kind', 'review').eq('ref_table', 'submission_versions').eq('ref_id', ver.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (r) { rv = (r.edited_content ?? r.content) as Rv; rvAt = r.created_at; }
    }
    rows.push({ s, ver, rv, rvAt });
  }

  // 새로 바뀐 게 없으면 마지막 브리핑 그대로
  const changedAt = rows.reduce((m, r) => [r.ver?.created_at, r.rvAt, r.s.updated_at].reduce((a, b) => (b && b > a ? b : a), m), '');
  if (!force) {
    const { data: last } = await admin.from('ai_outputs').select('*').eq('team_id', team_id).eq('kind', 'work_brief').order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (last && last.created_at > changedAt) return json({ ...last, reused: true });
  }

  const book = new SourceBook();
  const blocks: string[] = [];
  for (const { s, ver, rv } of rows) {
    const name = nameOf(s.author_id);
    const waited = Math.floor((Date.now() - Date.parse(ver?.created_at ?? s.created_at)) / DAY);
    const q = rv?.quality ?? {};
    const axes = Object.keys(AXIS).map((k) => q[k]?.score != null ? `${AXIS[k]} ${q[k]!.score}/4${q[k]!.note ? `(${q[k]!.note})` : ''}` : null).filter(Boolean).join(' · ');
    const unmet = (rv?.criteria_check ?? []).filter((c) => !c.met).map((c) => c.criterion);
    const text = [
      `id=${s.id} / 올린 사람 ${name} / 요청 ${({ approval: '승인', feedback: '피드백', share: '공유' } as Record<string, string>)[s.request_type] ?? s.request_type} / ${waited}일째 대기${ver && ver.version > 1 ? ` / v${ver.version}` : ''}`,
      rv ? `AI 검토: ${axes || `판단 깊이 ${rv.depth_score ?? '-'}/4`}${rv.summary ? ` / 총평 ${rv.summary}` : ''}${rv.gaps?.length ? ` / 보완점 ${rv.gaps.map((g) => g.text).join('; ')}` : ''}${unmet.length ? ` / 팀장 기준 미충족 ${unmet.join(', ')}` : ''}` : 'AI 검토: 아직 없음',
      ver?.extracted_text?.trim() ? `본문 앞부분: ${ver.extracted_text.slice(0, 700)}` : '',
    ].filter(Boolean).join(' / ');
    const tag = book.add('submission', s.id, `${name} · ${s.title}`, text);
    blocks.push(`- '${s.title}' ${tag}`);
  }
  await addKnowhow(book, team_id, 'review', 800);
  const input = [
    `## 리뷰를 기다리는 결과물 (${rows.length}건)\n${blocks.join('\n')}`,
    book.knowhowText(),
    book.text('결과물별 기록'),
  ].filter(Boolean).join('\n\n');

  const { output } = await runAi({
    teamId: team_id, kind: 'work_brief', model: MODEL_SMART, system: WORK_BRIEF, content: [{ type: 'text', text: input }], book,
    depth: depthOf(rows.filter((r) => r.rv).length, [2, 5, 9]), level: 'L2', createdBy: caller.userId, maxTokens: 1500,
  });
  return json(output);
});
