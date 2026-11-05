// 팀원 활동(업무 기록 수) 요약 — 50_member_activity.sql 의 member_activity() 를 AI 입력용 한 줄로
//   '주별(오래된 → 지난주) · 최근 2주 시간외 비율 · 지난 4주 대비 변화' — 이번 주는 진행 중이라 뺀다
import { admin } from './supabase.ts';

type Row = { user_id: string; week_start: string; total: number; off_hours: number };
const KST = 9 * 3600000;
function mondays(n: number): string[] {
  const d = new Date(Date.now() + KST); const dow = (d.getUTCDay() + 6) % 7;
  const mon = Date.parse(d.toISOString().slice(0, 10) + 'T00:00:00Z') - dow * 86400000;
  return Array.from({ length: n }, (_, i) => new Date(mon - (n - 1 - i) * 7 * 86400000).toISOString().slice(0, 10));
}

export async function activityLines(teamId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data, error } = await admin.rpc('member_activity', { p_team: teamId, p_weeks: 8 });
  if (error || !data) return out;
  const rows = data as Row[];
  const ws = mondays(8).slice(0, -1);
  for (const uid of new Set(rows.map((r) => r.user_id))) {
    const wk = ws.map((w) => rows.find((r) => r.user_id === uid && r.week_start === w) ?? { total: 0, off_hours: 0 });
    const rec = wk.slice(-2), bas = wk.slice(-6, -2);
    const avg = (a: { total: number }[]) => a.reduce((x, y) => x + y.total, 0) / Math.max(1, a.length);
    const r = avg(rec), b = avg(bas);
    const recTot = rec.reduce((a, w) => a + w.total, 0);
    const off = recTot ? Math.round((100 * rec.reduce((a, w) => a + w.off_hours, 0)) / recTot) : 0;
    const ch = b >= 1 ? Math.round((r / b - 1) * 100) : null;
    out.set(uid, `업무 기록(앱의 대화·진척·결과물·응답) 주별 ${wk.map((w) => w.total).join('→')}건 · 최근 2주 주평균 ${Math.round(r * 10) / 10}건${ch != null ? ` (지난 4주 대비 ${ch > 0 ? '+' : ''}${ch}%)` : ''} · 시간외(21시~7시·주말) ${off}%`);
  }
  return out;
}
