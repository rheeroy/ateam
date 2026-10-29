// Sim.Box — 팀원 혼자 쓰는 시뮬레이션 · 메모 공간 (대화형)
//   · 대화는 본인만 읽는다(simbox_messages RLS). 팀장용 AI · 리포트 · AUTOPILOT 입력에 원문을 어떤 형태로도 넣지 않는다
//   · 읽는 것은 팀원이 이미 볼 수 있는 것만: 팀 방향(허용 목록으로 만든 것) · 팀 목표 · 공유 노하우 · 본인이 이미 본 피드백
//   · 원문을 옮기지 않는다: 자료와 14글자 이상 똑같이 겹치는 문장은 뺀다 · 자료가 없으면 없다고 말한다(지어내지 않음)
//   · 사람 이름은 넣기 전 · 나온 뒤 모두 가린다
//   · 팀장에게는 정해진 분류의 팀 전체 합계만 (simbox_tags → simbox_trends): 팀원 5명 이상 · 민감한 대화는 기록 안 함
//   · 횟수: simbox_take (요금제별 월 · 하루) · 원가는 팀 월 AI 원가 상한에 함께 센다
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { callClaude, parseJson, MODEL_SMART, type Block } from '../_shared/anthropic.ts';
import { teamPeople, maskNames, publicBasics, directionText, myFeedback, quotes, type DirectionContent } from '../_shared/teampublic.ts';

const CATS = ['evidence', 'structure', 'clarity', 'priority', 'reporting', 'stakeholder', 'planning', 'idea', 'data'];

const SYSTEM = `당신은 팀원 전용 공간 'Sim.Box'의 도우미입니다. 팀원이 팀장님께 올리기 전에 초안 · 아이디어 · 메일 · 보고 방법을 자유롭게 시뮬레이션하고 메모하는 곳입니다.
말투: 같은 팀 선배처럼 편하고 짧게, 부드러운 존댓말(~해요). 이모지 · 과장 없이. 답은 6문장 안팎(문서 검토일 때도 핵심만, 자세한 건 panel에).

근거 원칙:
- '팀장님이라면'은 아래 자료(팀 방향 · 팀 목표 · 내가 받은 의견 · 팀 노하우)에 드러난 기준으로만 추론합니다. 자료에 없는 팀장님의 생각 · 감정 · 평가 · 선호를 지어내지 않습니다.
- 자료가 없거나 질문과 관련된 자료가 없으면 솔직하게 말합니다. 예: "아직 팀장님 기준을 알 만한 기록이 많지 않아서, 일반적인 관점으로 말씀드릴게요." 이때 '팀장님은 ~을 좋아하신다' 같은 말을 하지 않고, panel.questions 도 '보통 이런 질문이 나올 수 있어요' 수준으로만 씁니다.
- 자료의 문장을 그대로 옮기지 않습니다. 따옴표 인용 · 원문 복사 없이 당신의 말로 풀어서 짧게 씁니다. 출처를 밝힐 때는 "팀 방향의 '일하는 방식'에 따르면"처럼 묶음 이름만 씁니다.
- 다른 팀원 · 사람 이름은 절대 쓰지 않습니다. 팀장님은 '팀장님'으로만 부릅니다.
- 다른 사람에 대한 정보, 팀장님의 사적인 생각, 평가 · 고과 · 보상 예측, 인사 정보를 물으면 정중히 '여기서는 답할 수 없다'고 하고, 할 수 있는 도움을 제안합니다.
- 팀원이 쓴 내용을 팀장님께 전하거나 기록한다고 말하지 않습니다(이 공간은 본인만 봅니다).

panel: 팀원이 문서 · 초안 · 메일 · 보고 내용을 보여 주며 의견을 구할 때만 채웁니다(그 밖의 질문이면 null).
  { "title": 검토 대상 이름, "questions": [{ "q": 팀장님이 물어볼 질문, "tip": 미리 준비할 것 }] (1~3), "fixes": [{ "t": 보완할 점, "d": 한 줄 설명 }] (0~3), "good": [{ "t": 잘한 점, "d": 한 줄 }] (0~2) }
chips: 이어서 물어볼 만한 짧은 문장 2~3개 (예: "고친 버전 다시 봐 줘").
digest: 이번 메시지에 파일 · 긴 글이 붙어 있으면, 다음 대화에서 참고할 요지(2000자 이내). 없으면 빈 문자열.
tags: 이 대화가 다룬 주제를 다음 중 0~2개 — evidence(근거·숫자) structure(구조·결론 위치) clarity(문장·전달력) priority(우선순위·방향 확인) reporting(보고 방법·타이밍) stakeholder(유관부서·대외 소통) planning(일정·계획) idea(아이디어 구상) data(데이터 분석).
sensitive: 대화에 건강 · 퇴사 · 이직 · 개인 사정 · 가족 · 평가 · 보상 · 팀장님이나 동료에 대한 불만 · 갈등이 담겼으면 true.
출력 JSON: { "reply": "...", "panel": {...} | null, "chips": ["..."], "digest": "", "tags": [], "sensitive": false }`;

type Att = { name?: string; kind?: 'text' | 'pdf' | 'image'; text?: string; data?: string; media_type?: string };
type Out = { reply?: string; panel?: { title?: string; questions?: { q: string; tip?: string }[]; fixes?: { t: string; d?: string }[]; good?: { t: string; d?: string }[] } | null; chips?: string[]; digest?: string; tags?: string[]; sensitive?: boolean };

serve(async (req) => {
  const body = await readJson<{ team_id?: string; action?: 'send' | 'reset'; text?: string; attachment?: Att | null }>(req);
  if (!body.team_id) throw new HttpError(400, 'MISSING_TEAM');
  const teamId = body.team_id;
  const caller = await getCaller(req);
  if (caller.isService) throw new HttpError(403, 'forbidden');
  const uid = caller.userId!;
  const { data: me } = await admin.from('team_members').select('role, status').eq('team_id', teamId).eq('user_id', uid).maybeSingle();
  if (!me || me.status !== 'active' || me.role !== 'member') throw new HttpError(403, 'forbidden', 'Sim.Box는 팀원 공간입니다');

  // 새로 시작 — 내 대화를 지운다
  if (body.action === 'reset') {
    await admin.from('simbox_messages').delete().eq('team_id', teamId).eq('user_id', uid);
    return json({ ok: true });
  }

  const text = String(body.text ?? '').trim().slice(0, 4000);
  const att = body.attachment && (body.attachment.text || body.attachment.data) ? body.attachment : null;
  if (!text && !att) throw new HttpError(422, 'EMPTY', '내용을 입력해 주세요');
  if ((att?.data?.length ?? 0) > 14_000_000) throw new HttpError(413, 'FILE_TOO_LARGE', '파일이 너무 큽니다 (PDF 10MB까지)');

  // 30일 지난 대화 정리 (본인 것)
  await admin.from('simbox_messages').delete().eq('user_id', uid).lt('created_at', new Date(Date.now() - 30 * 86400000).toISOString());

  // 팀 월 AI 원가 상한
  const { data: bud } = await admin.rpc('ai_budget', { p_team: teamId });
  const b = bud as { cost_usd: number; cap_usd: number } | null;
  if (b && Number(b.cap_usd) > 0 && Number(b.cost_usd) >= Number(b.cap_usd)) throw new HttpError(429, 'AI_COST_CAP', '이번 달 팀의 AI 사용량을 모두 썼습니다. 다음 결제 주기에 다시 열립니다.');

  // 횟수 (잠금 안에서 확인 후 기록)
  const { data: take, error: te } = await admin.rpc('simbox_take', { p_team: teamId, p_user: uid });
  if (te) {
    if (/SIMBOX_LIMIT/.test(te.message)) throw new HttpError(429, 'SIMBOX_LIMIT', /day/.test(`${te.hint ?? ''}`) ? '오늘 Sim.Box 횟수를 모두 썼습니다. 내일 다시 쓸 수 있어요.' : '이번 달 Sim.Box 횟수를 모두 썼습니다. 다음 달 1일에 다시 채워집니다.');
    throw te;
  }
  const usageId = take as number;

  try {
    const people = await teamPeople(teamId);
    const mask = (t: string) => maskNames(t, people, uid);
    const [{ data: dir }, mat, fb, { data: hist }] = await Promise.all([
      admin.from('team_directions').select('content').eq('team_id', teamId).maybeSingle(),
      publicBasics(teamId, people),
      myFeedback(teamId, uid, people),
      admin.from('simbox_messages').select('role, body, attachment, created_at').eq('team_id', teamId).eq('user_id', uid).order('created_at', { ascending: false }).limit(16),
    ]);
    const history = [...(hist ?? [])].reverse();
    // 지난 대화의 첨부 중 가장 최근 것 하나만 (요지 또는 본문 일부)
    const lastAtt = [...history].reverse().find((h) => h.attachment)?.attachment as Att & { digest?: string } | undefined;
    const dirText = directionText(dir?.content as DirectionContent);
    const goalsText = mat.goals.map((g) => `- ${g.title}${g.sub ? ` (${g.sub})` : ''}`).join('\n');
    const khText = mat.knowhow.map((k) => `- ${k.title}: ${k.body}`).join('\n');
    const have = [dirText && '팀 방향', goalsText && '팀 목표', khText && '팀 노하우', fb.raw.length && '내가 받은 의견'].filter(Boolean);
    const ctx = [
      `## 자료 상태\n${have.length ? `있는 자료: ${have.join(' · ')}` : '팀장님 기준을 알 만한 자료가 거의 없습니다 — 그렇다고 먼저 말하고 일반적인 관점으로만 답하세요'}${fb.raw.length + (dirText ? 1 : 0) < 2 ? ' (팀장님 관련 자료가 적음 — 단정하지 말 것)' : ''}`,
      `## 팀 방향\n${dirText || '(아직 없음)'}`,
      `## 팀 목표\n${goalsText || '(없음)'}`,
      `## 팀 노하우 (공유된 것)\n${khText || '(없음)'}`,
      `## 내가 받은 의견 · 칭찬 · 코칭 (본인이 이미 본 것)\n${fb.text}`,
    ].join('\n\n');
    const convo = history.map((h) => `${h.role === 'user' ? '나' : 'Sim.Box'}: ${mask(h.body).slice(0, 1200)}${h.attachment ? ` [첨부: ${(h.attachment as Att).name ?? '파일'}]` : ''}`).join('\n');

    const content: Block[] = [];
    if (att?.kind === 'pdf' && att.data) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: att.data }, title: att.name ?? '파일' });
    if (att?.kind === 'image' && att.data) content.push({ type: 'image', source: { type: 'base64', media_type: (att.media_type as 'image/jpeg') ?? 'image/jpeg', data: att.data } });
    content.push({ type: 'text', text: [
      ctx,
      lastAtt && !att ? `## 앞서 올린 파일 「${lastAtt.name ?? ''}」\n${mask(lastAtt.digest || lastAtt.text || '').slice(0, 12000)}` : '',
      convo ? `## 지금까지의 대화\n${convo}` : '',
      att?.kind === 'text' && att.text ? `## 이번에 올린 파일 「${att.name ?? ''}」\n${mask(att.text).slice(0, 40000)}` : '',
      `## 이번 메시지\n${mask(text) || '(파일만 올림 — 이 자료를 팀장님 관점에서 봐 달라는 뜻으로 이해)'}`,
    ].filter(Boolean).join('\n\n') });

    const res = await callClaude({ model: MODEL_SMART, system: SYSTEM, content, maxTokens: 2600, timeoutMs: 90_000, thinking: 'fast', effort: 'medium' });
    // 원가는 답을 못 쓰더라도 남긴다 (실패하면 횟수만 돌려준다)
    await admin.rpc('simbox_cost', { p_id: usageId, p_model: res.model, p_in: res.inputTokens, p_out: res.outputTokens, p_cost: res.costUsd });
    const out = parseJson<Out>(res.text);

    // 원문 그대로 옮긴 문장은 뺀다 (자료 원문 기준 · 팀원이 올린 파일 · 대화는 제외)
    const src = [...fb.raw, ...mat.knowhow.map((k) => k.body)];
    const noQuote = (t: string) => t.split(/(?<=[.!?。]|요\.|다\.)\s+/).filter((x) => !quotes(x, src)).join(' ');
    const s = (v: unknown, n: number) => noQuote(mask(String(v ?? '')).replace(/\s*\[E\d+\]/g, '').trim()).slice(0, n);
    const panel = out.panel && typeof out.panel === 'object' ? {
      title: s(out.panel.title, 80),
      questions: (out.panel.questions ?? []).slice(0, 3).map((x) => ({ q: s(x?.q, 120), tip: s(x?.tip, 200) })).filter((x) => x.q),
      fixes: (out.panel.fixes ?? []).slice(0, 3).map((x) => ({ t: s(x?.t, 80), d: s(x?.d, 200) })).filter((x) => x.t),
      good: (out.panel.good ?? []).slice(0, 2).map((x) => ({ t: s(x?.t, 80), d: s(x?.d, 200) })).filter((x) => x.t),
    } : null;
    const reply = s(out.reply, 2400) || '다시 한 번 말씀해 주시겠어요?';
    const chips = (out.chips ?? []).slice(0, 3).map((c) => s(c, 40)).filter(Boolean);

    const attRow = att ? { name: String(att.name ?? '파일').slice(0, 120), kind: att.kind, text: att.kind === 'text' ? String(att.text ?? '').slice(0, 30000) : undefined, digest: s(out.digest, 2500) || undefined } : null;
    const now = Date.now();
    const { error: ie } = await admin.from('simbox_messages').insert([
      { team_id: teamId, user_id: uid, role: 'user', body: text, attachment: attRow, created_at: new Date(now).toISOString() },
      { team_id: teamId, user_id: uid, role: 'assistant', body: reply, meta: { panel: panel && (panel.questions.length || panel.fixes.length || panel.good.length) ? panel : null, chips }, created_at: new Date(now + 1).toISOString() },
    ]);
    if (ie) throw ie;

    // 팀장용 가공: 정해진 분류만 · 민감하면 기록 안 함 · 팀원 5명 이상 팀만
    const memberCount = people.names.filter((n) => !n.leader).length;
    const tags = [...new Set((out.tags ?? []).filter((t) => CATS.includes(t)))].slice(0, 2);
    if (!out.sensitive && memberCount >= 5 && tags.length) {
      await admin.from('simbox_tags').insert(tags.map((category) => ({ team_id: teamId, user_id: uid, category })));
    }
    return json({ ok: true });
  } catch (e) {
    await admin.rpc('simbox_refund', { p_id: usageId });
    throw e;
  }
});
