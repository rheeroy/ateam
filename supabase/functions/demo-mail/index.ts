// 데모 링크 메일 — 관리자가 데모 신청을 승인하면(또는 '메일 다시 보내기') 신청자에게 7일짜리 데모 링크를 보낸다 (Resend)
//   body: { id } · app_admins 계정만 · 승인 상태이고 링크가 살아 있을 때만 · 한 신청에 하루 5번까지
//   Secrets: RESEND_API_KEY · APP_URL (기본 https://app.leada.team) · DEMO_REPLY_TO (기본 steve@starthalf.com)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { sendDemoMail } from '../_shared/demoMail.ts';

serve(async (req) => {
  const caller = await getCaller(req);
  if (!caller.isService) {
    const { data } = await admin.from('app_admins').select('user_id').eq('user_id', caller.userId!).maybeSingle();
    if (!data) throw new HttpError(403, 'forbidden');
  }
  const { id } = await readJson<{ id?: string }>(req);
  if (!id) throw new HttpError(400, 'MISSING_PARAMS');
  const mailed_at = await sendDemoMail(id);
  return json({ ok: true, mailed_at });
});
