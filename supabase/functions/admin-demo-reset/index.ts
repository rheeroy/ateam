// 관리자 — 데모 데이터 초기화: SQL Editor에서 06_demo_accounts.sql 을 Run 하는 것과 똑같이 돌린다
//   데모 계정 7개를 지우고 새로 만든 뒤 6개월치 기록을 다시 넣는다. 데모 신청 · 승인 링크(demo_requests)는 그대로
//   SQL 본문은 reset_sql.ts (scripts/build-dashboard.sh 가 06_demo_accounts.sql 에서 만든다 — 손으로 고치지 않는다)
//   DB 직접 연결: Supabase 가 함수에 기본으로 넣어 주는 SUPABASE_DB_URL
import postgres from 'npm:postgres@3.4.5';
import { serve, json, readJson, HttpError } from '../_shared/http.ts';
import { admin, getCaller } from '../_shared/supabase.ts';
import { RESET_SQL } from './reset_sql.ts';

let running = false;

serve(async (req) => {
  // { team?: 'marketing' | 'sales' | … } — 팀마다 따로 (한 번에 다 돌리면 함수 시간 제한에 걸릴 수 있어 화면이 팀별로 차례로 부른다)
  //   { list: true } → 초기화할 수 있는 팀 목록
  const body = await readJson<{ team?: string; list?: boolean }>(req).catch(() => ({} as { team?: string; list?: boolean }));
  const caller = await getCaller(req);
  if (!caller.isService) {
    const { data } = await admin.from('app_admins').select('user_id').eq('user_id', caller.userId!).maybeSingle();
    if (!data) throw new HttpError(403, 'forbidden');
  }
  const keys = Object.keys(RESET_SQL);
  if (body.list) return json({ teams: keys });
  const key = body.team ?? 'marketing';
  const text = RESET_SQL[key];
  if (!text) throw new HttpError(400, 'NO_TEAM', `데모 팀 '${key}' 이 없습니다`);
  const url = Deno.env.get('SUPABASE_DB_URL');
  if (!url) throw new HttpError(500, 'NO_DB_URL', '함수에 SUPABASE_DB_URL 이 없습니다');
  if (running) throw new HttpError(409, 'RESET_RUNNING', '이미 초기화하는 중입니다. 잠시 뒤 다시 확인하세요.');
  running = true;
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15, onnotice: () => {} });
  const t0 = Date.now();
  try {
    await sql.unsafe(text);
    const { count } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('is_demo', true);
    return json({ ok: true, team: key, ms: Date.now() - t0, demo_teams: count ?? 0 });
  } catch (e) {
    console.error('demo reset failed', e);
    throw new HttpError(500, 'RESET_FAILED', `초기화하지 못했습니다 — ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  } finally {
    running = false;
    await sql.end({ timeout: 5 }).catch(() => {});
  }
});
