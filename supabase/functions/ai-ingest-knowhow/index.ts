// 팀장 노하우 정리 — 던져 넣은 원본을 읽고 '노하우 카드'로 나눠 저장한다 (2 크레딧)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader, must } from '../_shared/supabase.ts';
import { assertCredits, BASE_RULES } from '../_shared/gateway.ts';
import { callClaude, parseJson, toBase64, MODEL_SMART, type Block } from '../_shared/anthropic.ts';
import { INGEST } from '../_shared/prompts/index.ts';

const CREDITS = 2;
const FREE_ONBOARDING = 10;
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const KINDS = ['principle', 'rubric', 'framework', 'context', 'coaching', 'glossary'];
const FEATURES = ['review', 'prep', 'report', 'evaluation', 'briefing', 'strategy', 'scenario', 'plan'];

interface Out {
  summary: string;
  cards: { kind: string; title: string; body: string; rules?: string[]; applies_to?: string[]; keywords?: string[] }[];
}

serve(async (req) => {
  const { source_id } = await readJson<{ source_id: string }>(req);
  if (!source_id) throw new HttpError(400, 'MISSING_ID');
  const caller = await getCaller(req);
  const src = must(await admin.from('knowhow_sources').select('*').eq('id', source_id).maybeSingle());
  await assertLeader(caller, src.team_id);
  // 시작하기(온보딩) 중에 처음 정리하는 노하우는 크레딧을 쓰지 않는다
  //   팀 생성 30일 이내 · 무료 정리 팀당 10번까지(크레딧 원장 기준이라 지워도 다시 늘지 않음) · 이미 정리된 자료를 다시 돌리면 유료
  const { data: tm } = await admin.from('teams').select('settings, created_at').eq('id', src.team_id).single();
  const onboarding = ((tm?.settings as Record<string, unknown> | null)?.onboarding ?? {}) as { status?: string };
  let credits = CREDITS;
  const young = !!tm?.created_at && Date.now() - Date.parse(tm.created_at) < 30 * 86400000;
  if (onboarding.status === 'pending' && young && src.status !== 'done') {
    const { count } = await admin.from('credit_ledger').select('id', { count: 'exact', head: true })
      .eq('team_id', src.team_id).eq('ai_kind', 'knowhow_ingest').eq('delta', 0);
    if ((count ?? 0) < FREE_ONBOARDING) credits = 0;
  }
  await assertCredits(src.team_id, credits);

  await admin.from('knowhow_sources').update({ status: 'processing', error: null }).eq('id', src.id);
  try {
    const content: Block[] = [];
    if (src.mime_type === 'application/pdf' && src.file_path) {
      const { data: file, error } = await admin.storage.from('knowhow').download(src.file_path);
      if (error) throw error;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE');
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(bytes) }, title: src.title || src.file_name || '자료' });
    } else if (IMAGE_MIME.includes(src.mime_type) && src.file_path) {
      // 사진·캡처로 올린 기준표·양식
      const { data: file, error } = await admin.storage.from('knowhow').download(src.file_path);
      if (error) throw error;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > 5 * 1024 * 1024) throw new HttpError(413, 'FILE_TOO_LARGE');
      content.push({ type: 'image', source: { type: 'base64', media_type: src.mime_type, data: toBase64(bytes) } });
    } else if (!src.raw_text.trim()) {
      throw new HttpError(422, 'NO_TEXT', '내용이 비어 있습니다');
    }
    content.push({ type: 'text', text: [
      `자료 제목: ${src.title || src.file_name || '(제목 없음)'}`,
      src.raw_text.trim() ? `## 자료 본문\n${src.raw_text.slice(0, 60000)}` : `## 자료 본문\n(첨부 ${IMAGE_MIME.includes(src.mime_type) ? '이미지' : 'PDF'})`,
    ].join('\n\n') });

    const res = await callClaude({ model: MODEL_SMART, system: `${BASE_RULES}\n\n${INGEST}`, content, maxTokens: 3000 });
    const out = parseJson<Out>(res.text);

    const rows = (out.cards ?? []).slice(0, 12)
      .filter((c) => c.title && KINDS.includes(c.kind))
      .map((c) => ({
        team_id: src.team_id, owner_id: src.owner_id, source_id: src.id, kind: c.kind,
        title: String(c.title).slice(0, 60), body: String(c.body ?? '').slice(0, 800),
        rules: (c.rules ?? []).map((r) => String(r).slice(0, 80)).slice(0, 5),
        applies_to: (c.applies_to ?? []).filter((f) => FEATURES.includes(f)),
        keywords: (c.keywords ?? []).map(String).slice(0, 8), provenance: 'ai',
      }));
    if (rows.length) {
      const { error } = await admin.from('knowhow_cards').insert(rows);
      if (error) throw error;
    }
    await admin.from('knowhow_sources').update({ status: 'done', summary: out.summary ?? '', card_count: rows.length }).eq('id', src.id);
    await admin.rpc('consume_credits', {
      p_team: src.team_id, p_credits: credits, p_kind: 'knowhow_ingest', p_ai_output: null,
      p_model: res.model, p_in: res.inputTokens, p_out: res.outputTokens, p_cost: res.costUsd,
    });
    return json({ source_id: src.id, summary: out.summary, cards: rows.length });
  } catch (e) {
    await admin.from('knowhow_sources').update({ status: 'failed', error: e instanceof Error ? e.message.slice(0, 300) : 'error' }).eq('id', src.id);
    throw e;
  }
});
