// 데모 링크 메일 본체 — demo-mail(관리자 승인 · 다시 보내기)과 demo-access(신청 즉시 자동 승인)가 함께 쓴다
//   함수끼리 HTTP로 부르지 않고 직접 보낸다 (서비스 키 형식 · JWT 확인에 영향받지 않게)
import { HttpError } from './http.ts';
import { admin } from './supabase.ts';
import { sendMail, plainMail, esc, MAIL_DOMAIN } from './mail.ts';

const APP_URL = (Deno.env.get('APP_URL') ?? 'https://app.leada.team').replace(/\/$/, '');
const REPLY_TO = Deno.env.get('DEMO_REPLY_TO') ?? 'steve@starthalf.com';
const fmt = (d: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(new Date(d));

/** 승인된 데모 신청에 링크 메일을 보내고 보낸 시각을 남긴다. 보낼 수 없으면 HttpError */
export async function sendDemoMail(id: string): Promise<string | null> {
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
  return data?.mailed_at ?? null;
}
