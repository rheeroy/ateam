import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { HttpError } from './http.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** service_role 클라이언트: RLS를 우회하므로 반드시 권한 확인 후에만 쓴다 */
export const admin: SupabaseClient = createClient(URL, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface Caller {
  userId: string | null; // null = 서비스 호출(cron)
  isService: boolean;
  client: SupabaseClient; // 호출자 권한(RLS 적용) 클라이언트
}

export async function getCaller(req: Request): Promise<Caller> {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'UNAUTHENTICATED');
  if (token === SERVICE) return { userId: null, isService: true, client: admin };
  const client = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, 'UNAUTHENTICATED');
  return { userId: data.user.id, isService: false, client };
}

export async function assertLeader(caller: Caller, teamId: string) {
  if (caller.isService) return;
  const { data } = await admin
    .from('team_members')
    .select('role,status')
    .eq('team_id', teamId)
    .eq('user_id', caller.userId!)
    .maybeSingle();
  if (!data || data.role !== 'leader' || data.status !== 'active') throw new HttpError(403, 'forbidden');
}

export async function assertFeature(teamId: string, feature: string) {
  const { data, error } = await admin.rpc('team_has_feature', { p_team: teamId, p_feature: feature });
  if (error) throw error;
  if (!data) throw new HttpError(402, 'PLAN_FEATURE', `요금제에 '${feature}' 기능이 없습니다`);
}

export function must<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  if (res.data === null) throw new HttpError(404, 'NOT_FOUND');
  return res.data as NonNullable<T>;
}
