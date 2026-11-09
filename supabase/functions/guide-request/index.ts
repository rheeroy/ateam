// 가이드북 신청 — 랜딩 /guidebook 폼 (로그인 없이 · JWT 검증 끔: config.toml)
//   저장 → 가이드북 링크를 메일로 보낸다 (화면에서는 받지 않는다 · 메일 주소 확인을 겸한다)
//   같은 이메일은 하루 3번까지 · 숨은 칸(website)을 채운 봇은 조용히 무시
//   Secrets: RESEND_API_KEY (없으면 메일만 건너뛴다 · _shared/mail.ts) · GUIDE_FROM (기본 "ATEAM <guide@leada.team>") · GUIDE_URL
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin } from '../_shared/supabase.ts';
import { sendMail, mailLayout, esc, MAIL_DOMAIN } from '../_shared/mail.ts';

type Body = { name?: string; email?: string; company?: string; job_title?: string; team_size?: string; phone?: string; consent?: boolean; marketing?: boolean; source?: string; website?: string };
const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
// 가이드북은 메일로만 준다 — 파일 주소는 추측하기 어렵게(뒤에 임의 문자열) 두고, 응답에는 주소를 싣지 않는다
const GUIDE_URL = Deno.env.get('GUIDE_URL') ?? 'https://leada.team/guide/ATEAM_guidebook_a0dc25536b75d6ba.pdf';
const FROM = Deno.env.get('GUIDE_FROM') ?? `ATEAM <guide@${MAIL_DOMAIN}>`;
const REPLY_TO = Deno.env.get('GUIDE_REPLY_TO') ?? 'steve@starthalf.com';
const SITE = 'https://leada.team';

const guideMail = (name: string) => mailLayout({
  eyebrow: '팀장님을 위한 개인용 AI Solution',
  title: '요청하신 ATEAM 가이드북을<br>보내 드립니다',
  body: `${esc(name)} 님, ATEAM 가이드북을 신청해 주셔서 감사합니다.<br><br>가이드북에는 <b>팀장 운영 유형 TEST</b>, 슈퍼에이전트가 팀장님의 한 주를 바꾸는 방식, 실제 화면으로 보는 기능 가이드, <b>내일 바로 쓰는 팀장 실전 체크리스트 10</b>을 담았습니다.`,
  button: { label: '가이드북 받기 (PDF)', url: GUIDE_URL },
  after: `직접 써 보시려면 카드 등록 없이 14일 동안 모든 기능을 무료로 쓸 수 있습니다.<br><a href="${SITE}/?utm_source=guidebook_mail" style="color:#4f46e5;font-weight:700">ATEAM 둘러보기 →</a>`,
  foot: '궁금한 점은 이 메일에 바로 답장해 주세요.',
});

serve(async (req) => {
  const b = await readJson<Body>(req);
  if (b.website) return json({ ok: true, emailed: true });
  const email = s(b.email, 160).toLowerCase();
  const name = s(b.name, 60), company = s(b.company, 100);
  if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, 'INVALID', '이름 · 회사 · 이메일을 확인해 주세요.');
  if (!b.consent) throw new HttpError(422, 'CONSENT', '개인정보 수집 · 이용에 동의해 주세요.');

  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await admin.from('guide_requests').select('id', { count: 'exact', head: true }).ilike('email', email).gte('created_at', since);
  if ((count ?? 0) >= 3) return json({ ok: true, emailed: true, repeat: true });

  const { data, error } = await admin.from('guide_requests').insert({
    name, email, company, job_title: s(b.job_title, 60), team_size: s(b.team_size, 20), phone: s(b.phone, 30),
    consent: true, marketing: !!b.marketing, source: s(b.source, 120),
  }).select('id').single();
  if (error) throw error;

  const err = await sendMail({ from: FROM, to: email, replyTo: REPLY_TO, subject: `[ATEAM] ${name} 님, 요청하신 가이드북입니다`, html: guideMail(name) });
  await admin.from('guide_requests').update(err ? { email_error: err } : { emailed_at: new Date().toISOString() }).eq('id', data.id);
  if (err) console.error('guide-request mail', err);
  return json({ ok: true, emailed: !err });
}, { anyOrigin: true });   // 랜딩(leada.team · www)에서 부른다 — APP_ORIGIN 제한을 받지 않는다
