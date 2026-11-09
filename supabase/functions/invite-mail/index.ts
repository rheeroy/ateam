// 팀원 초대 메일 — 팀장이 초대를 만들면(또는 '메일 다시 보내기') 초대받은 주소로 합류 링크를 보낸다 (Resend)
//   body: { token } · 그 초대가 속한 팀의 팀장만 부를 수 있다 · 데모 팀은 보내지 않는다
//   한 초대에 하루 5번까지 · 답장은 초대한 팀장 메일로 간다
//   메일에는 팀 이름 · 초대한 팀장 이름 · 직무만 담는다 (팀장이 적은 강점 · 보완점 메모는 넣지 않는다)
//   Secrets: RESEND_API_KEY · APP_URL (기본 https://app.leada.team)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller, assertLeader } from '../_shared/supabase.ts';
import { sendMail, mailLayout, esc, MAIL_DOMAIN } from '../_shared/mail.ts';

const APP_URL = (Deno.env.get('APP_URL') ?? 'https://app.leada.team').replace(/\/$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fmt = (d: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(new Date(d));

serve(async (req) => {
  const caller = await getCaller(req);
  const { token } = await readJson<{ token?: string }>(req);
  if (!token || !UUID.test(token)) throw new HttpError(400, 'MISSING_PARAMS');

  const { data: inv } = await admin.from('invitations')
    .select('id, team_id, email, job_title, invited_by, accepted_at, expires_at, mailed_at, mail_count, teams(name, is_demo)')
    .eq('token', token).maybeSingle();
  if (!inv) throw new HttpError(404, 'NOT_FOUND', '초대를 찾을 수 없습니다');
  await assertLeader(caller, inv.team_id);
  const team = inv.teams as unknown as { name: string; is_demo: boolean } | null;
  if (team?.is_demo) throw new HttpError(403, 'DEMO_READONLY', '데모 팀에서는 초대 메일을 보내지 않습니다');
  if (inv.accepted_at) throw new HttpError(409, 'ACCEPTED', '이미 합류한 초대입니다');
  if (new Date(inv.expires_at) < new Date()) throw new HttpError(410, 'EXPIRED', '만료된 초대입니다. 새로 초대해 주세요');
  const recent = inv.mailed_at && Date.now() - new Date(inv.mailed_at).getTime() < 86400000;
  if (recent && (inv.mail_count ?? 0) >= 5) throw new HttpError(429, 'TOO_MANY', '같은 초대 메일은 하루 5번까지 보낼 수 있습니다');

  const inviterId = caller.userId ?? inv.invited_by;
  const [{ data: prof }, { data: au }] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', inviterId).maybeSingle(),
    admin.auth.admin.getUserById(inviterId),
  ]);
  const inviter = (prof?.full_name || '팀장').trim();
  const teamName = (team?.name ?? '').trim() || '우리 팀';
  const link = `${APP_URL}/invite/${token}`;

  const html = mailLayout({
    eyebrow: `${esc(teamName)} · 팀 초대`,
    title: `${esc(inviter)} 팀장님이<br>ATEAM으로 초대했습니다`,
    body: `안녕하세요. <b>${esc(teamName)}</b>의 ${esc(inviter)} 팀장님이 ATEAM에서 함께 일하자고 초대했습니다${inv.job_title ? ` (직무: ${esc(inv.job_title)})` : ''}.<br><br>
ATEAM에서는 팀 목표와 내 과제를 한눈에 보고, 성과를 바로 입력하고, 팀의 기준과 1on1 기록을 한곳에서 볼 수 있습니다. 팀원은 무료로 씁니다.`,
    button: { label: '초대 수락하고 합류하기', url: link },
    after: `<b>${esc(inv.email)}</b> 주소로 가입하거나 로그인하면 바로 합류합니다. 다른 주소로는 합류할 수 없습니다.<br>
이 링크는 <b>${fmt(inv.expires_at)}</b>까지 유효합니다.<br><br>
<span style="font-size:12px;color:#94a3b8">버튼이 열리지 않으면 이 주소를 복사해 브라우저에 붙여 넣으세요.<br>${link}</span>`,
    foot: `초대를 받은 적이 없다면 이 메일은 무시하셔도 됩니다. 이 메일에 답장하면 ${esc(inviter)} 팀장님께 전달됩니다.`,
  });
  const err = await sendMail({
    from: `${inviter.replace(/[<>"]/g, '')} (ATEAM) <invite@${MAIL_DOMAIN}>`,
    to: inv.email, replyTo: au?.user?.email ?? undefined,
    subject: `[ATEAM] ${inviter} 팀장님이 ${teamName}에 초대했습니다`, html,
  });
  if (err) {
    console.error('invite-mail', err);
    throw new HttpError(502, 'MAIL_FAILED', err === 'NO_KEY' ? '메일 발송이 아직 설정되지 않았습니다. 링크를 복사해 보내 주세요' : '메일을 보내지 못했습니다. 링크를 복사해 보내 주세요');
  }
  const { data } = await admin.from('invitations')
    .update({ mailed_at: new Date().toISOString(), mail_count: recent ? (inv.mail_count ?? 0) + 1 : 1 })
    .eq('id', inv.id).select('mailed_at').single();
  return json({ ok: true, mailed_at: data?.mailed_at });
});
