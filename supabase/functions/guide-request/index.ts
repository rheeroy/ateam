// 가이드북 신청 — 랜딩 /guidebook 폼 (로그인 없이 · JWT 검증 끔: config.toml)
//   저장 → 가이드북 다운로드 주소를 돌려준다(화면에서 바로 받기) → RESEND_API_KEY 가 있으면 같은 링크를 메일로도 보낸다
//   같은 이메일은 하루 3번까지 · 숨은 칸(website)을 채운 봇은 조용히 무시
//   Secrets: RESEND_API_KEY (없으면 메일만 건너뛴다) · GUIDE_FROM (기본 "ATEAM <guide@leada.team>") · GUIDE_URL (기본 https://leada.team/guide/ATEAM_guidebook.pdf)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin } from '../_shared/supabase.ts';

type Body = { name?: string; email?: string; company?: string; job_title?: string; team_size?: string; phone?: string; consent?: boolean; marketing?: boolean; source?: string; website?: string };
const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const GUIDE_URL = Deno.env.get('GUIDE_URL') ?? 'https://leada.team/guide/ATEAM_guidebook.pdf';
const FROM = Deno.env.get('GUIDE_FROM') ?? 'ATEAM <guide@leada.team>';
const REPLY_TO = Deno.env.get('GUIDE_REPLY_TO') ?? 'steve@starthalf.com';
const SITE = 'https://leada.team';

function mailHtml(name: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0B0F1E;padding:32px 32px 28px">
  <div style="font-size:18px;font-weight:800;color:#ffffff">ATEAM</div>
  <div style="margin-top:22px;font-size:14px;color:#c4b5fd;font-weight:700">팀장님을 위한 개인용 AI Solution</div>
  <div style="margin-top:8px;font-size:24px;line-height:1.35;font-weight:800;color:#ffffff">요청하신 ATEAM 가이드북을<br>보내 드립니다</div>
</td></tr>
<tr><td style="padding:28px 32px 8px;font-size:15px;line-height:1.75;color:#334155">
  ${esc(name)} 님, ATEAM 가이드북을 신청해 주셔서 감사합니다.<br><br>
  가이드북에는 <b>팀장 운영 유형 TEST</b>, 슈퍼에이전트가 팀장님의 한 주를 바꾸는 방식, 실제 화면으로 보는 기능 가이드, <b>내일 바로 쓰는 팀장 실전 체크리스트 10</b>을 담았습니다.
</td></tr>
<tr><td align="center" style="padding:20px 32px 8px">
  <a href="${GUIDE_URL}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px">가이드북 받기 (PDF)</a>
</td></tr>
<tr><td style="padding:20px 32px 28px;font-size:14px;line-height:1.75;color:#475569">
  직접 써 보시려면 카드 등록 없이 14일 동안 모든 기능을 무료로 쓸 수 있습니다.<br>
  <a href="${SITE}/?utm_source=guidebook_mail" style="color:#4f46e5;font-weight:700">ATEAM 둘러보기 →</a>
</td></tr>
<tr><td style="padding:18px 32px;background:#f8fafc;font-size:12px;line-height:1.7;color:#94a3b8">
  궁금한 점은 이 메일에 바로 답장해 주세요.<br>
  갓생맵(STARTHALF) · 대표 이경훈 · 사업자등록번호 553-65-00667 · 서울특별시 광진구 면목로 57 (중곡동)
</td></tr>
</table></td></tr></table></body></html>`;
}

async function sendMail(to: string, name: string): Promise<string> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return 'NO_KEY';
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: REPLY_TO, subject: `[ATEAM] ${name} 님, 요청하신 가이드북입니다`, html: mailHtml(name) }),
  });
  return r.ok ? '' : `${r.status} ${(await r.text()).slice(0, 300)}`;
}

serve(async (req) => {
  const b = await readJson<Body>(req);
  if (b.website) return json({ ok: true, url: GUIDE_URL, emailed: false });
  const email = s(b.email, 160).toLowerCase();
  const name = s(b.name, 60), company = s(b.company, 100);
  if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, 'INVALID', '이름 · 회사 · 이메일을 확인해 주세요.');
  if (!b.consent) throw new HttpError(422, 'CONSENT', '개인정보 수집 · 이용에 동의해 주세요.');

  const since = new Date(Date.now() - 86400000).toISOString();
  const { count } = await admin.from('guide_requests').select('id', { count: 'exact', head: true }).ilike('email', email).gte('created_at', since);
  if ((count ?? 0) >= 3) return json({ ok: true, url: GUIDE_URL, emailed: false, repeat: true });

  const { data, error } = await admin.from('guide_requests').insert({
    name, email, company, job_title: s(b.job_title, 60), team_size: s(b.team_size, 20), phone: s(b.phone, 30),
    consent: true, marketing: !!b.marketing, source: s(b.source, 120),
  }).select('id').single();
  if (error) throw error;

  const err = await sendMail(email, name).catch((e) => String(e).slice(0, 300));
  await admin.from('guide_requests').update(err ? { email_error: err } : { emailed_at: new Date().toISOString() }).eq('id', data.id);
  return json({ ok: true, url: GUIDE_URL, emailed: !err });
});
