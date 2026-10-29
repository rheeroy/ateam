// 파일에서 실적 뽑기 — 성과입력(팀원) · 실적 한 번에 채우기(팀장)
//   파일(엑셀 · CSV · 문서는 화면에서 글로 바꿔 보내고, PDF · 사진은 원본)을 읽어 항목별로 '이렇게 등록할까요?' 값을 제안한다.
//   등록은 하지 않는다 — 팀원은 확인한 것만 성과입력(팀장 승인), 팀장은 확인한 것만 바로 반영한다.
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { runAi, SourceBook } from '../_shared/gateway.ts';
import { MODEL_SMART, type Block } from '../_shared/anthropic.ts';

const PROMPT = `과제: 올린 파일에서 아래 목표 항목(P#)의 '현재 실적 값'을 찾아 제안합니다. 사람이 확인한 뒤 등록하므로, 확실하지 않으면 그렇다고 표시합니다.
- 파일에 근거가 있는 항목만 씁니다. 근거가 없으면 그 항목은 빼고, 숫자를 지어내지 않습니다.
- value: 항목 단위에 맞춘 숫자 하나 (number: 그 단위의 값, percent: 0~100). 누적인지 기간 값인지 항목 설명과 맞춰 고릅니다.
  stage 항목은 stage(1부터 단계 번호), done 항목은 완료가 확인될 때만 done: true.
- period: 값이 가리키는 기간 (예: "10월", "10/1~10/31", "3분기 누계"). 모르면 빈 문자열.
- location: 파일 안 위치 (엑셀은 "시트!셀" 예: "요약!C7", 문서는 "3쪽 표" 처럼).
- candidates: 그럴듯한 값이 둘 이상이면 [{ "value": 숫자, "location": "..." }]. 하나면 빈 배열.
- issue: 확인이 필요하면 짧게 ("값 2개 · 골라 주세요", "기간 불명확", "단위 다름(천원)"), 아니면 빈 문자열.
- note: 한 줄 설명 (예: "요약 시트 10월 합계") — 성과입력의 한 줄 설명으로 씁니다.
출력 JSON: { "rows": [ { "ref": "P1", "value": 12480, "stage": null, "done": false, "period": "...", "location": "...", "candidates": [], "issue": "", "note": "..." } ] }`;

type Row = { ref: string; value?: number | null; stage?: number | null; done?: boolean; period?: string; location?: string; candidates?: { value: number; location?: string }[]; issue?: string; note?: string };

serve(async (req) => {
  const body = await readJson<{ team_id?: string; item_ids?: string[]; mode?: 'member' | 'leader'; file_name?: string; text?: string; pdf?: string; image?: string; image_type?: string }>(req);
  if (!body.team_id || !body.item_ids?.length) throw new HttpError(400, 'MISSING');
  const caller = await getCaller(req);
  if (caller.isService) throw new HttpError(403, 'forbidden');
  const { data: me } = await admin.from('team_members').select('role, status').eq('team_id', body.team_id).eq('user_id', caller.userId!).maybeSingle();
  if (!me || me.status !== 'active') throw new HttpError(403, 'forbidden');
  const leader = me.role === 'leader';
  if (body.mode === 'leader' && !leader) throw new HttpError(403, 'forbidden');
  if (!body.text?.trim() && !body.pdf && !body.image) throw new HttpError(422, 'NO_TEXT', '파일에서 읽을 내용이 없습니다');
  if ((body.pdf?.length ?? 0) > 14_000_000 || (body.image?.length ?? 0) > 8_000_000) throw new HttpError(413, 'FILE_TOO_LARGE', '파일이 너무 큽니다 (PDF 10MB까지)');

  const { data: items } = await admin.from('work_items').select('id, title, owner_id, measure, unit, num_target, num_current, progress, stages, stage_current, status, team_id')
    .in('id', body.item_ids.slice(0, 40)).eq('team_id', body.team_id);
  // 팀원은 본인 담당 항목만
  const list = (items ?? []).filter((x) => x.status !== 'dropped' && (body.mode === 'leader' ? true : x.owner_id === caller.userId));
  if (!list.length) throw new HttpError(422, 'NO_ITEMS', '실적을 넣을 항목이 없습니다');
  const ref = new Map(list.map((x, i) => [`P${i + 1}`, x]));
  const kind = (m: string) => (m === 'number' ? 'number' : m === 'percent' ? 'percent' : m === 'stage' ? 'stage' : m === 'check' ? 'done' : 'percent');
  const lines = [...ref.entries()].map(([r, x]) => `${r} ${x.title} · 방식 ${kind(x.measure)}${x.measure === 'number' ? ` · 단위 '${x.unit ?? ''}' · 목표 ${x.num_target ?? '-'} · 지금 ${x.num_current ?? '-'}` : ''}${x.measure === 'stage' ? ` · 단계 ${(x.stages ?? []).map((s: string, i: number) => `${i + 1}.${s}`).join(' ')}` : ''}${x.measure === 'percent' ? ` · 지금 ${x.progress}%` : ''}`);

  const content: Block[] = [];
  if (body.pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: body.pdf }, title: body.file_name ?? '파일' });
  if (body.image) content.push({ type: 'image', source: { type: 'base64', media_type: (body.image_type as 'image/jpeg') ?? 'image/jpeg', data: body.image } });
  content.push({ type: 'text', text: [`파일: ${body.file_name ?? ''}`, `## 목표 항목 (P#)\n${lines.join('\n')}`, body.text?.trim() ? `## 파일 내용\n${body.text.slice(0, 80000)}` : ''].filter(Boolean).join('\n\n') });

  const { parsed } = await runAi<{ rows?: Row[] }>({
    teamId: body.team_id, kind: 'perf_extract', model: MODEL_SMART, system: PROMPT, content, book: new SourceBook(),
    depth: 1, level: 'L1', createdBy: caller.userId, subjectUserId: caller.userId, visibility: body.mode === 'leader' ? 'leader' : 'subject', credits: 0, force: true,
    maxTokens: 3500, timeoutMs: 120_000, thinking: 'fast', effort: 'low',
  });
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const rows = (Array.isArray(parsed.rows) ? parsed.rows : []).flatMap((r) => {
    const x = ref.get(String(r?.ref ?? ''));
    if (!x) return [];
    const k = kind(x.measure);
    const value = num(r.value);
    const stage = num(r.stage);
    if (k === 'number' && value == null) return [];
    if (k === 'percent' && (value == null || value < 0 || value > 100)) return [];
    if (k === 'stage' && (stage == null || stage < 1 || stage > (x.stages ?? []).length)) return [];
    if (k === 'done' && !r.done) return [];
    return [{
      item_id: x.id, type: k, value: k === 'number' || k === 'percent' ? value : null, stage: k === 'stage' ? Math.round(stage!) : null,
      period: String(r.period ?? '').slice(0, 40), location: String(r.location ?? '').slice(0, 60), issue: String(r.issue ?? '').slice(0, 40), note: String(r.note ?? '').slice(0, 120),
      candidates: (Array.isArray(r.candidates) ? r.candidates : []).map((c) => ({ value: num(c?.value), location: String(c?.location ?? '').slice(0, 60) })).filter((c) => c.value != null).slice(0, 3),
    }];
  });
  return json({ rows });
});
