// 데모 신청 · 입장 — 랜딩 '데모 신청하기' → 관리자 승인(7일 링크) → 링크로 바로 데모 팀 입장
//   request: 신청서 저장 (로그인 없이). 같은 이메일은 하루 3번까지
//   enter:   승인된 링크면 데모 팀장/팀원 계정의 일회용 로그인 값을 돌려준다 (비밀번호 없이, 메일 발송 없이)
//   check:   링크가 아직 유효한지 (앱 상단 데모 띠가 부른다)
import { serve, readJson, json, HttpError } from '../_shared/http.ts';
import { admin } from '../_shared/supabase.ts';

type Body = {
  action?: 'request' | 'enter' | 'check' | 'teams';
  name?: string; company?: string; job_title?: string; team_size?: string; email?: string; phone?: string; note?: string; consent?: boolean; website?: string;
  token?: string; as?: 'leader' | 'member'; member?: string; dept?: string; team?: string;
};
const s = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_NAME = '정우성';   // 팀원 화면 기본(팀 설정 demo_default_member 가 없을 때) — member 로 다른 팀원 이름을 주면 그 사람
type DemoTeam = { id: string; name: string; settings: { demo_key?: string; demo_label?: string; demo_default_member?: string } | null };

serve(async (req) => {
  const b = await readJson<Body>(req);

  if (b.action === 'request') {
    if (b.website) return json({ ok: true });   // 봇이 채우는 숨은 칸
    const email = s(b.email, 160).toLowerCase();
    const name = s(b.name, 60), company = s(b.company, 100);
    if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, 'INVALID', '이름 · 회사 · 업무 이메일을 확인해 주세요.');
    if (!b.consent) throw new HttpError(422, 'CONSENT', '개인정보 수집 · 이용에 동의해 주세요.');
    const since = new Date(Date.now() - 86400000).toISOString();
    const { count } = await admin.from('demo_requests').select('id', { count: 'exact', head: true }).ilike('email', email).gte('created_at', since);
    if ((count ?? 0) >= 3) throw new HttpError(429, 'TOO_MANY', '이미 신청이 접수됐습니다. 확인 후 메일로 연락드릴게요.');
    const { error } = await admin.from('demo_requests').insert({
      name, company, email, job_title: s(b.job_title, 60), team_size: s(b.team_size, 20), dept: s(b.dept, 20), phone: s(b.phone, 30), note: s(b.note, 1000), consent: true,
    });
    if (error) throw error;
    return json({ ok: true });
  }

  if (b.action === 'enter' || b.action === 'check' || b.action === 'teams') {
    const token = s(b.token, 40);
    if (!UUID.test(token)) throw new HttpError(404, 'DEMO_LINK', '데모 링크가 올바르지 않습니다.');
    const { data: row, error } = await admin.rpc('demo_token_use', { p_token: token });
    if (error) throw error;
    const r = row as { id: string | null; expires_at: string; name: string; dept?: string } | null;
    if (!r?.id) throw new HttpError(410, 'DEMO_EXPIRED', '데모 기간이 끝났거나 아직 승인되지 않은 링크입니다.');
    if (b.action === 'check') return json({ ok: true, expires_at: r.expires_at });

    // 데모 팀들 — 고른 팀(team) → 신청서의 팀 직무(dept) → 마케팅 → 아무 데모 팀
    const { data: ts } = await admin.from('teams').select('id, name, settings').eq('is_demo', true).order('created_at');
    const teams = (ts ?? []) as DemoTeam[];
    if (b.action === 'teams') return json({ teams: teams.map((t) => ({ key: t.settings?.demo_key ?? t.id, label: t.settings?.demo_label ?? t.name.replace(/\s*\(데모\)$/, ''), name: t.name })) });
    const byKey = (k?: string) => (k ? teams.find((t) => (t.settings?.demo_key ?? t.id) === k) : undefined);
    const team = byKey(s(b.team, 40)) ?? byKey(r.dept) ?? byKey('marketing') ?? teams[teams.length - 1];
    if (!team) throw new HttpError(503, 'NO_DEMO', '데모 팀이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.');
    const defMember = team.settings?.demo_default_member || MEMBER_NAME;
    const { data: mem } = await admin.from('team_members').select('user_id, role, profiles(full_name)').eq('team_id', team.id).eq('status', 'active');
    const list = (mem ?? []) as unknown as { user_id: string; role: string; profiles: { full_name: string } | null }[];
    const pick = b.as === 'member'
      ? list.find((m) => m.role === 'member' && m.profiles?.full_name === s(b.member || defMember, 40)) ?? list.find((m) => m.role === 'member' && m.profiles?.full_name === defMember) ?? list.find((m) => m.role === 'member')
      : list.find((m) => m.role === 'leader');
    if (!pick) throw new HttpError(503, 'NO_DEMO', '데모 계정을 찾지 못했습니다.');
    const { data: u } = await admin.auth.admin.getUserById(pick.user_id);
    const email = u?.user?.email;
    if (!email) throw new HttpError(503, 'NO_DEMO', '데모 계정을 찾지 못했습니다.');
    // 메일을 보내지 않고 일회용 로그인 값만 만든다 → 앱이 verifyOtp 로 세션을 연다
    const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (le || !link?.properties?.hashed_token) throw le ?? new HttpError(500, 'LINK', '데모 입장에 실패했습니다.');
    return json({ token_hash: link.properties.hashed_token, expires_at: r.expires_at, as: b.as === 'member' ? 'member' : 'leader', name: pick.profiles?.full_name ?? '', team: team.settings?.demo_key ?? team.id, team_id: team.id });
  }

  throw new HttpError(400, 'BAD_ACTION');
});
