// 메일 발송 (Resend) — 가이드북 · 팀원 초대가 쓴다
//   Secrets: RESEND_API_KEY (없으면 'NO_KEY'를 돌려주고 보내지 않는다)
//   보내는 주소는 Resend에서 인증한 도메인(leada.team)이어야 한다
export const MAIL_DOMAIN = Deno.env.get('MAIL_DOMAIN') ?? 'leada.team';
export const COMPANY_LINE = '갓생맵(STARTHALF) · 대표 이경훈 · 사업자등록번호 553-65-00667 · 서울특별시 광진구 면목로 57 (중곡동)';

export const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 보내면 '' · 실패하면 이유 문자열 (호출한 쪽이 기록한다) */
export async function sendMail(m: { from: string; to: string; subject: string; html: string; text?: string; replyTo?: string }): Promise<string> {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return 'NO_KEY';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, ...(m.text ? { text: m.text } : {}), ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
    });
    return r.ok ? '' : `${r.status} ${(await r.text()).slice(0, 300)}`;
  } catch (e) {
    return String(e).slice(0, 300);
  }
}

/** ATEAM 메일 공통 틀 — 어두운 머리 + 본문 + 버튼 + 사업자 정보 */
export function mailLayout(o: { eyebrow: string; title: string; body: string; button?: { label: string; url: string }; after?: string; foot?: string }): string {
  return `<!doctype html><html><body style="margin:0;word-break:keep-all;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0B0F1E;padding:32px 32px 28px">
  <div style="font-size:18px;font-weight:800;color:#ffffff">ATEAM</div>
  <div style="margin-top:22px;font-size:14px;color:#c4b5fd;font-weight:700">${o.eyebrow}</div>
  <div style="margin-top:8px;font-size:24px;line-height:1.35;font-weight:800;color:#ffffff">${o.title}</div>
</td></tr>
<tr><td style="padding:28px 32px 8px;font-size:15px;line-height:1.75;color:#334155">${o.body}</td></tr>
${o.button ? `<tr><td align="center" style="padding:20px 32px 8px"><a href="${o.button.url}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;padding:14px 28px;border-radius:12px">${o.button.label}</a></td></tr>` : ''}
${o.after ? `<tr><td style="padding:20px 32px 28px;font-size:14px;line-height:1.75;color:#475569">${o.after}</td></tr>` : '<tr><td style="padding:12px"></td></tr>'}
<tr><td style="padding:18px 32px;background:#f8fafc;font-size:12px;line-height:1.7;color:#94a3b8">${o.foot ? `${o.foot}<br>` : ''}${COMPANY_LINE}</td></tr>
</table></td></tr></table></body></html>`;
}

/** 사람이 쓴 것 같은 안내 메일 (데모 링크 · 팀원 초대) — 지메일 '기본' 탭에 오기 쉽도록 배너 · 큰 버튼 · 홍보 문구 없이 글 위주로.
 *  paras: 문단 HTML(이미 esc 된 것) · link: 본문 링크 한 줄 · 같은 내용의 일반 텍스트도 함께 돌려준다 */
export function plainMail(o: { paras: string[]; link: { label: string; url: string }; after?: string[]; sign?: string }): { html: string; text: string } {
  const p = (t: string) => `<p style="margin:0 0 14px">${t}</p>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#ffffff;word-break:keep-all;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:15px;line-height:1.7;color:#1f2937">
<div style="max-width:560px">
${o.paras.map(p).join('\n')}
${p(`<a href="${o.link.url}" style="color:#4f46e5;font-weight:600">${o.link.label}</a><br><span style="font-size:13px;color:#6b7280">${o.link.url}</span>`)}
${(o.after ?? []).map(p).join('\n')}
${p(o.sign ?? 'Steve 드림<br>ATEAM')}
<p style="margin:24px 0 0;font-size:12px;color:#9ca3af">ATEAM · leada.team</p>
</div></body></html>`;
  const strip = (t: string) => t.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const text = [...o.paras, `${o.link.label}\n${o.link.url}`, ...(o.after ?? []), o.sign ?? 'Steve 드림<br>ATEAM'].map(strip).join('\n\n') + '\n\n-- \nATEAM · leada.team\n';
  return { html, text };
}
