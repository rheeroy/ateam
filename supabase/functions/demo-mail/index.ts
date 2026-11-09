// 데모 링크 메일 — 관리자가 데모 신청을 승인하면(또는 '메일 다시 보내기') 신청자에게 7일짜리 데모 링크를 보낸다 (Resend)
//   body: { id } · app_admins 계정만 · 승인 상태이고 링크가 살아 있을 때만 · 한 신청에 하루 5번까지
//   Secrets: RESEND_API_KEY · APP_URL (기본 https://app.leada.team) · DEMO_REPLY_TO (기본 steve@starthalf.com)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { sendMail, plainMail, esc, MAIL_DOMAIN } from '../_shared/mail.ts';

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
  // 사람이 쓴 안내 메일처럼 — 프로모션 탭으로 덜 가게 (배너 · 큰 버튼 · 홍보 문구 없음, 일반 텍스트 함께)
  const m = plainMail({
    paras: [`${esc(r.name)} 님, 안녕하세요.`, `신청하신 ATEAM 데모 링크를 보내 드립니다. 아래 링크를 누르면 6개월치 기록이 쌓인 데모 팀으로 바로 들어갑니다. 위쪽 띠에서 팀장 화면과 팀원 화면을 오가며 보실 수 있어요.`],
    link: { label: '데모 팀 들어가기', url: link },
    after: [`링크는 ${until}까지 쓸 수 있고, AI 기능은 기능마다 한 번씩 직접 실행해 보실 수 있습니다.`, '둘러보시다 궁금한 점이 있으면 이 메일에 편하게 답장 주세요.'],
  });
  const err = await sendMail({ from: `Steve (ATEAM) <steve@${MAIL_DOMAIN}>`, to: r.email, replyTo: REPLY_TO, subject: `${r.name} 님, 요청하신 ATEAM 데모 링크입니다`, html: m.html, text: m.text });
  if (err) {
    console.error('demo-mail', err);
    throw new HttpError(502, 'MAIL_FAILED', err === 'NO_KEY' ? '메일 발송이 아직 설정되지 않았습니다' : '메일을 보내지 못했습니다');
  }
  const { data } = await admin.from('demo_requests')
    .update({ mailed_at: new Date().toISOString(), mail_count: recent ? (r.mail_count ?? 0) + 1 : 1 })
    .eq('id', r.id).select('mailed_at').single();
  return json({ ok: true, mailed_at: data?.mailed_at });
});
