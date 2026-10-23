// 결과물 AI 1차 검토 — 판단의 깊이, 고민이 담긴 부분, 보완점, 캐물어 볼 질문
// 팀원이 버전을 올리면 클라이언트가 호출한다(버전당 1회, auto). 결과는 팀장에게만 보인다.
// 비용: ① 본문이 이전 버전과 거의 같으면 AI를 부르지 않고 이전 검토를 이어 쓴다
//       ② 자동 검토는 이번 달 AI 원가 상한의 60%까지만 — 나머지는 팀장이 직접 누르는 AI 몫
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, must } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, fmtDate, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART, toBase64, type Block } from '../_shared/anthropic.ts';
import { REVIEW } from '../_shared/prompts/index.ts';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const AUTO_SHARE = 0.75;

/** 두 본문이 얼마나 같은가 (줄 단위, 공백 무시) — 0~1 */
function sameness(a: string, b: string) {
  const lines = (t: string) => t.split(/\n+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const A = lines(a), B = lines(b);
  if (!A.length || !B.length) return 0;
  const setB = new Map<string, number>();
  for (const x of B) setB.set(x, (setB.get(x) ?? 0) + 1);
  let hit = 0;
  for (const x of A) { const c = setB.get(x) ?? 0; if (c) { hit++; setB.set(x, c - 1); } }
  const lenA = A.join('').length, lenB = B.join('').length;
  return Math.min(hit / Math.max(A.length, B.length), Math.min(lenA, lenB) / Math.max(lenA, lenB));
}

serve(async (req) => {
  const body = await readJson<{ version_id?: string; mode?: string; team_id?: string; title?: string; text?: string; auto?: boolean; force?: boolean }>(req);
  const caller = await getCaller(req);
  if (body.mode === 'self') throw new HttpError(410, 'SELF_CHECK_REMOVED', '셀프 점검은 더 이상 제공하지 않습니다');
  const version_id = body.version_id;
  if (!version_id) throw new HttpError(400, 'MISSING_ID');

  const ver = must(await admin.from('submission_versions').select('*').eq('id', version_id).maybeSingle());
  const sub = must(await admin.from('submissions').select('*').eq('id', ver.submission_id).maybeSingle());

  // 권한: 작성자 또는 팀장 (다시 검토(force)는 팀장만)
  let isLeader = caller.isService;
  if (!caller.isService) {
    const { data: m } = await admin.from('team_members').select('role')
      .eq('team_id', sub.team_id).eq('user_id', caller.userId!).maybeSingle();
    isLeader = m?.role === 'leader';
    if (caller.userId !== sub.author_id && !isLeader) throw new HttpError(403, 'forbidden');
  }
  const force = !!body.force && isLeader;
  // 검토 결과(팀장 전용 · visibility leader)는 팀장에게만 돌려준다 — 작성자의 자동 검토 호출에는 완료 여부만
  const reply = (row: { id?: string } | null | undefined) => json(isLeader ? row : { ok: true, id: row?.id ?? null });

  // 버전당 한 번만 (팀장이 '다시 검토'를 누르면 새로)
  if (!force) {
    const { data: existing } = await admin.from('ai_outputs').select('*')
      .eq('kind', 'review').eq('ref_table', 'submission_versions').eq('ref_id', ver.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existing) return reply(existing);
  }

  const book = new SourceBook();
  const content: Block[] = [];

  // 공유(승인·피드백 없음)와 숫자 업데이트는 검토하지 않는다
  if (sub.request_type === 'share' || sub.kind === 'number') throw new HttpError(422, 'NO_REVIEW', '공유·숫자 업데이트는 AI 검토 대상이 아닙니다');

  // ② 자동 검토는 월 상한의 60%까지 (팀장이 직접 누르면 상한까지)
  if (body.auto && !force) {
    const { data: bud, error: be } = await admin.rpc('ai_budget', { p_team: sub.team_id });
    const b = bud as { cost_usd: number; cap_usd: number } | null;
    if (!be && b && Number(b.cap_usd) > 0 && Number(b.cost_usd) >= Number(b.cap_usd) * AUTO_SHARE) {
      return json({ skipped: 'budget', message: '이번 달 자동 검토 몫을 다 써서 건너뜁니다. 팀장 화면에서 직접 검토할 수 있습니다.' });
    }
  }

  // ① 본문이 이전 버전과 거의 같으면 이전 검토를 이어 쓴다 (AI 호출 없음)
  if (!force && ver.version > 1 && ver.extracted_text?.trim()) {
    const { data: pv } = await admin.from('submission_versions').select('id, version, extracted_text')
      .eq('submission_id', sub.id).lt('version', ver.version).order('version', { ascending: false }).limit(1).maybeSingle();
    const { data: prevAi } = pv ? await admin.from('ai_outputs').select('*').eq('kind', 'review').eq('ref_table', 'submission_versions').eq('ref_id', pv.id)
      .order('created_at', { ascending: false }).limit(1).maybeSingle() : { data: null };
    const same = pv?.extracted_text ? sameness(ver.extracted_text, pv.extracted_text) : 0;
    if (prevAi && same >= 0.97) {
      const pct = Math.max(0, Math.round((1 - same) * 100));
      const content0 = prevAi.edited_content ?? prevAi.content;
      const { data: row, error: ce } = await admin.from('ai_outputs').insert({
        team_id: sub.team_id, kind: 'review', subject_user_id: sub.author_id, ref_table: 'submission_versions', ref_id: ver.id,
        status: 'draft', visibility: prevAi.visibility ?? 'leader', level: prevAi.level, depth: prevAi.depth,
        content: { ...content0, carried_from: pv!.id, change_from_previous: `v${pv!.version}과 본문이 거의 같습니다(바뀐 분량 약 ${pct}%) — 이전 검토를 이어 씁니다. 크게 고쳤다면 '다시 검토'를 눌러 주세요.` },
        sources: prevAi.sources ?? [], model: 'carried', input_tokens: 0, output_tokens: 0, created_by: caller.userId,
      }).select().single();
      if (!ce) return reply(row);
    }
  }

  // 본문: docx/txt 는 추출 텍스트, pdf·이미지는 직접 읽힌다, 링크는 설명과 주소
  if ((ver.mime_type === 'application/pdf' || IMAGE_TYPES.includes(ver.mime_type ?? '')) && ver.file_path) {
    const { data: file, error } = await admin.storage.from('submissions').download(ver.file_path);
    if (error) throw error;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE');
    content.push(ver.mime_type === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) }, title: sub.title }
      : { type: 'image', source: { type: 'base64', media_type: ver.mime_type as 'image/png', data: toBase64(bytes) } });
  } else if (!ver.extracted_text?.trim() && !sub.link_url) {
    throw new HttpError(422, 'NO_TEXT', '본문 텍스트가 없습니다. 파일을 올리거나 내용을 붙여 넣어 주세요.');
  }

  // 이전 버전
  const { data: prev } = await admin.from('submission_versions')
    .select('id, version, note, extracted_text').eq('submission_id', sub.id).lt('version', ver.version)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (prev) book.add('submission', prev.id, `이전 버전 v${prev.version}`, `변경 메모: ${prev.note || '없음'} / 본문 앞부분: ${prev.extracted_text.slice(0, 1500)}`);

  // 같은 팀원의 지난 검토 기록 (데이터가 쌓이면 '추세 비교'가 열린다)
  const { data: history } = await admin.from('judgment_scores')
    .select('id, score, scored_at, submission_id').eq('team_id', sub.team_id).eq('user_id', sub.author_id)
    .order('scored_at', { ascending: false }).limit(8);
  for (const h of history ?? []) book.add('judgment', h.id, `지난 검토 ${fmtDate(h.scored_at)}`, `판단 깊이 ${h.score}`);

  // 팀장 코멘트 (이번 결과물)
  const { data: comments } = await admin.from('review_comments').select('id, section_ref, body, author_id')
    .eq('submission_id', sub.id).neq('author_id', sub.author_id).order('created_at').limit(10);
  for (const c of comments ?? []) book.add('review_comment', c.id, `팀장 코멘트 ${c.section_ref ?? ''}`, c.body);

  const { data: comps } = await admin.from('competencies').select('name')
    .or(`team_id.is.null,team_id.eq.${sub.team_id}`).order('sort');

  // 플레이북은 이 결과물 본문에 맞는 방법론부터 고른다 (제목·변경 메모·본문 앞부분)
  await addKnowhow(book, sub.team_id, 'review', undefined, false, true, [sub.title, ver.note ?? '', (ver.extracted_text ?? '').slice(0, 6000)].join('\n'));
  const { data: author } = await admin.from('profiles').select('full_name').eq('id', sub.author_id).maybeSingle();
  const text = [
    `결과물 제목: ${sub.title} (v${ver.version})`,
    `올린 사람: ${author?.full_name ?? '팀원'} / 요청 종류: ${({ approval: '승인 요청', feedback: '피드백 요청', share: '공유' } as Record<string, string>)[sub.request_type] ?? sub.request_type}`,
    ver.note ? `이번 버전 변경 메모: ${ver.note}` : '',
    `역량 목록: ${(comps ?? []).map((c) => c.name).join(', ')}`,
    `지난 검토 기록 수: ${history?.length ?? 0}`,
    book.knowhowText(),
    book.text('참고 기록'),
    sub.link_url ? `링크 (AI는 열어 보지 않음, 설명만 읽음): ${sub.link_url}` : '',
    ver.extracted_text?.trim() ? `## 본문\n${ver.extracted_text.slice(0, 60000)}` : '## 본문\n(첨부 파일)',
  ].filter(Boolean).join('\n\n');
  content.push({ type: 'text', text });

  const { output, parsed } = await runAi<{ depth_score: number; competency_signals?: Record<string, number> }>({
    teamId: sub.team_id,
    kind: 'review',
    model: MODEL_SMART,
    system: REVIEW,
    content,
    book,
    depth: depthOf((history?.length ?? 0) + 1, [2, 4, 8]),
    level: (history?.length ?? 0) >= 3 ? 'L3' : 'L1',
    createdBy: caller.userId,
    subjectUserId: sub.author_id,
    refTable: 'submission_versions',
    refId: ver.id,
    maxTokens: 2200,
    force,
  });

  const score = Math.max(1, Math.min(4, Math.round((Number(parsed.depth_score) || 2) * 2) / 2));
  await admin.from('judgment_scores').insert({
    team_id: sub.team_id, user_id: sub.author_id, submission_id: sub.id, version_id: ver.id,
    score, competencies: parsed.competency_signals ?? {}, ai_output_id: output.id,
  });
  // 역량 신호를 근거 원장에 남긴다 (출처: ai)
  for (const [name, sig] of Object.entries(parsed.competency_signals ?? {})) {
    if (!sig) continue;
    await admin.from('evidence').insert({
      team_id: sub.team_id, subject_user_id: sub.author_id, source: 'ai', source_id: null,
      competency: name, polarity: sig > 0 ? 'positive' : 'concern', provenance: 'ai',
      summary: `${sub.title} v${ver.version} — ${name} ${sig > 0 ? '강함' : '약함'} 신호 (AI 1차 검토)`,
    });
  }
  return reply(output);
});
