// 결과물 AI 1차 검토 — 판단의 깊이, 고민이 담긴 부분, 보완점, 캐물어 볼 질문
// 팀원이 버전을 올리면 클라이언트가 호출한다(버전당 1회). 결과는 팀장에게만 보인다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, must } from '../_shared/supabase.ts';
import { runAi, SourceBook, depthOf, fmtDate, addKnowhow } from '../_shared/gateway.ts';
import { MODEL_SMART, toBase64, type Block } from '../_shared/anthropic.ts';
import { REVIEW, SELF_CHECK } from '../_shared/prompts/index.ts';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** 팀원이 올리기 전에 받는 셀프 점검 (팀장이 공개한 기준만 사용, 결과는 팀원에게 바로 돌려준다) */
async function selfCheck(caller: { userId: string | null }, body: { team_id: string; title: string; text?: string }) {
  const { data: m } = await admin.from('team_members').select('role')
    .eq('team_id', body.team_id).eq('user_id', caller.userId!).eq('status', 'active').maybeSingle();
  if (!m) throw new HttpError(403, 'forbidden');
  const content: Block[] = [];
  if (!body.text?.trim()) throw new HttpError(422, 'NO_TEXT', '점검할 본문이 없습니다');
  const book = new SourceBook();
  const n = await addKnowhow(book, body.team_id, 'review', 2600, true);
  content.push({ type: 'text', text: [`결과물 제목: ${body.title}`, n ? book.knowhowText() : '## 팀장의 기준\n(팀장이 공개한 기준 없음 — 일반적인 보고서 기준으로 점검)',
    `## 본문\n${body.text.slice(0, 40000)}`].join('\n\n') });
  const { output } = await runAi({
    teamId: body.team_id, kind: 'self_check', model: MODEL_SMART, system: SELF_CHECK, content, book,
    depth: 1, level: 'L1', createdBy: caller.userId, subjectUserId: caller.userId, visibility: 'subject', maxTokens: 1000,
  });
  return output;
}

serve(async (req) => {
  const body = await readJson<{ version_id?: string; mode?: string; team_id?: string; title?: string; text?: string }>(req);
  const caller = await getCaller(req);
  if (body.mode === 'self') {
    if (!body.team_id || !body.title) throw new HttpError(400, 'MISSING_FIELDS');
    return json(await selfCheck(caller, body as { team_id: string; title: string }));
  }
  const version_id = body.version_id;
  if (!version_id) throw new HttpError(400, 'MISSING_ID');

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

  // 공유(승인·피드백 없음)와 숫자 업데이트는 검토하지 않는다
  if (sub.request_type === 'share' || sub.kind === 'number') throw new HttpError(422, 'NO_REVIEW', '공유·숫자 업데이트는 AI 검토 대상이 아닙니다');

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

  await addKnowhow(book, sub.team_id, 'review');
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
