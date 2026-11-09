// 데모 링크 메일 — 관리자가 데모 신청을 승인하면(또는 '메일 다시 보내기') 신청자에게 7일짜리 데모 링크를 보낸다 (Resend)
//   body: { id } · app_admins 계정만 · 승인 상태이고 링크가 살아 있을 때만 · 한 신청에 하루 5번까지
//   Secrets: RESEND_API_KEY · APP_URL (기본 https://app.leada.team) · DEMO_REPLY_TO (기본 steve@starthalf.com)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { sendMail, mailLayout, esc, MAIL_DOMAIN } from '../_shared/mail.ts';

const APP_URL = (Deno.env.get('APP_URL') ?? 'https://app.leada.team').replace(/\/$/, '');
const REPLY_TO = Deno.env.get('DEMO_REPLY_TO') ?? 'steve@starthalf.com';
const fmt = (d: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(new Date(d));

serve(async (req) => {
  const caller = await getCaller(req);
  if (!caller.isService) {
    const { data } = await admin.from('app_admins').select('user_id').eq('user_id', caller.userId!).maybeSingle();
    if (!data) throw new HttpError(403, 'forbidden');
  }
  const { id } = await readJson<{ id?: string }>(req);
  if (!id) throw new HttpError(400, 'MISSING_PARAMS');
  const { data: r } = await admin.from('demo_requests').select('id, name, email, status, token, expires_at, mailed_at, mail_count').eq('id', id).maybeSingle();
  if (!r) throw new HttpError(404, 'NOT_FOUND', '신청을 찾을 수 없습니다');
  if (r.status !== 'approved' || !r.token) throw new HttpError(409, 'NOT_APPROVED', '승인된 신청만 보낼 수 있습니다');
  if (r.expires_at && Date.parse(r.expires_at) < Date.now()) throw new HttpError(410, 'EXPIRED', '링크가 만료됐습니다. 7일 연장 후 보내 주세요');
  const recent = r.mailed_at && Date.now() - Date.parse(r.mailed_at) < 86400000;
  if (recent && (r.mail_count ?? 0) >= 5) throw new HttpError(429, 'TOO_MANY', '같은 신청에는 하루 5번까지 보낼 수 있습니다');

  const link = `${APP_URL}/demo?t=${r.token}`;
  const until = r.expires_at ? fmt(r.expires_at) : '7일 뒤';
  const html = mailLayout({
    eyebrow: '팀장님을 위한 개인용 AI Solution',
    title: 'ATEAM 데모가<br>준비됐습니다',
    body: `${esc(r.name)} 님, 데모를 신청해 주셔서 감사합니다.<br><br>
아래 버튼을 누르면 <b>6개월치 기록이 쌓인 데모 팀</b>으로 바로 들어갑니다. 위쪽 띠에서 팀장 화면과 팀원 화면을 오가며 둘러보실 수 있어요.`,
    button: { label: '데모 팀 들어가기', url: link },
    after: `· 링크는 <b>${until}</b>까지 쓸 수 있습니다.<br>
· AI 기능은 기능마다 한 번씩 직접 실행해 볼 수 있습니다.<br>
· 내 팀으로 바로 시작하시면 14일 동안 모든 기능을 무료로 쓰실 수 있습니다.<br><br>
<span style="font-size:12px;color:#94a3b8">버튼이 열리지 않으면 이 주소를 복사해 브라우저에 붙여 넣으세요.<br>${link}</span>`,
    foot: '궁금한 점은 이 메일에 바로 답장해 주세요.',
  });
  const err = await sendMail({ from: `ATEAM <demo@${MAIL_DOMAIN}>`, to: r.email, replyTo: REPLY_TO, subject: `[ATEAM] ${r.name} 님, 데모 링크를 보내 드립니다`, html });
  if (err) {
    console.error('demo-mail', err);
    throw new HttpError(502, 'MAIL_FAILED', err === 'NO_KEY' ? '메일 발송이 아직 설정되지 않았습니다' : '메일을 보내지 못했습니다');
  }
  const { data } = await admin.from('demo_requests')
    .update({ mailed_at: new Date().toISOString(), mail_count: recent ? (r.mail_count ?? 0) + 1 : 1 })
    .eq('id', r.id).select('mailed_at').single();
  return json({ ok: true, mailed_at: data?.mailed_at });
});
