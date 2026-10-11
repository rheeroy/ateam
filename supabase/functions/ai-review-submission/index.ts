// 결과물 AI 1차 검토 — 판단의 깊이, 고민이 담긴 부분, 보완점, 캐물어 볼 질문
// 팀원이 버전을 올리면 클라이언트가 호출한다(버전당 1회). 결과는 팀장에게만 보인다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, must } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, fmtDate, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART, toBase64, type Block } from '../_shared/anthropic.ts';
import { REVIEW } from '../_shared/prompts/index.ts';

serve(async (req) => {
  const { version_id } = await readJson<{ version_id: string }>(req);
  if (!version_id) throw new HttpError(400, 'MISSING_ID');
  const caller = await getCaller(req);

  const ver = must(await admin.from('submission_versions').select('*').eq('id', version_id).maybeSingle());
  const sub = must(await admin.from('submissions').select('*').eq('id', ver.submission_id).maybeSingle());

  // 권한: 작성자 또는 팀장
  if (!caller.isService && caller.userId !== sub.author_id) {
    const { data: m } = await admin.from('team_members').select('role')
      .eq('team_id', sub.team_id).eq('user_id', caller.userId!).maybeSingle();
    if (m?.role !== 'leader') throw new HttpError(403, 'forbidden');
  }

  // 버전당 한 번만
  const { data: existing } = await admin.from('ai_outputs').select('*')
    .eq('kind', 'review').eq('ref_table', 'submission_versions').eq('ref_id', ver.id).maybeSingle();
  if (existing) return json(existing);

  const book = new SourceBook();
  const content: Block[] = [];

  // 본문: docx/txt 는 추출 텍스트, pdf 는 문서 블록으로 직접 읽힌다
  if (ver.mime_type === 'application/pdf' && ver.file_path) {
    const { data: file, error } = await admin.storage.from('submissions').download(ver.file_path);
    if (error) throw error;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE');
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) }, title: sub.title });
  } else if (!ver.extracted_text?.trim()) {
    throw new HttpError(422, 'NO_TEXT', '본문 텍스트가 없습니다. docx·pdf·txt·md 파일을 올려 주세요.');
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

  await addKnowhow(book, sub.team_id, 'review');
  const text = [
    `결과물 제목: ${sub.title} (v${ver.version})`,
    ver.note ? `이번 버전 변경 메모: ${ver.note}` : '',
    `역량 목록: ${(comps ?? []).map((c) => c.name).join(', ')}`,
    `지난 검토 기록 수: ${history?.length ?? 0}`,
    book.knowhowText(),
    book.text('참고 기록'),
    ver.extracted_text?.trim() ? `## 본문\n${ver.extracted_text.slice(0, 60000)}` : '## 본문\n(첨부 PDF)',
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
    maxTokens: 1600,
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
  return json(output);
});
