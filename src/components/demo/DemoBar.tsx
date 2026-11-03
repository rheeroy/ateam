// 데모 링크로 들어왔을 때 화면 맨 위 띠 — 남은 기간 · 팀장/팀원 화면 전환 · 내 팀으로 시작하기
import { useEffect, useState } from 'react';
import { useTeam } from '../../state/session';
import { checkDemo, demoTeams, enterDemo, getDemo, leaveDemo } from '../../lib/demo';
import { errorText } from '../../lib/supabase';
import { cx } from '../../lib/format';
import { useToast } from '../ui';

const CHECKED = 'ateam.demo.checked';
// 팀원 고르기 — 이름 옆 직급 (데모 팀 전용)
const RANK: Record<string, string> = {
  김현정: '차장', 박서연: '과장', 정우성: '과장', 최다은: '대리', 이동욱: '대리', 한수진: '사원',
};

export function DemoBar() {
  const { team, members } = useTeam();
  const toast = useToast();
  const d = getDemo();
  const [busy, setBusy] = useState<string | null>(null);
  const [teams, setTeams] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => { if (d?.token) demoTeams(d.token).then(setTeams); }, [d?.token]);

  // 앱을 열 때 한 번: 링크가 끝났으면 나간다
  useEffect(() => {
    if (!d) return;
    let seen = false;
    try { seen = sessionStorage.getItem(CHECKED) === d.token; } catch { /* 저장소 없음 */ }
    if (Date.parse(d.expires_at) < Date.now()) { leaveDemo('/demo?expired=1'); return; }
    if (seen) return;
    checkDemo(d.token).then((ok) => {
      if (!ok) leaveDemo('/demo?expired=1');
      else try { sessionStorage.setItem(CHECKED, d.token); } catch { /* 저장소 없음 */ }
    });
  }, [d?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d || !team?.is_demo) return null;
  const left = Math.max(0, Math.ceil((Date.parse(d.expires_at) - Date.now()) / 86400000));
  const curTeam = (team.settings as { demo_key?: string } | null)?.demo_key ?? d.team;
  // 직급 — 팀 데모마다 다르다 (팀 설정 demo_ranks · 없으면 마케팅 기본표)
  const ranks = (team.settings as { demo_ranks?: Record<string, string> } | null)?.demo_ranks ?? RANK;
  const go = async (as: 'leader' | 'member', member?: string, teamKey?: string) => {
    if (busy || (!teamKey && as === d.as && (as === 'leader' || !member || member === d.name))) return;
    setBusy(teamKey ? 'team' : member ?? as);
    try { await enterDemo(d.token, as, member, teamKey ?? curTeam); } catch (e) { toast(errorText(e)); setBusy(null); }
  };
  const mates = members.filter((m) => m.role === 'member').map((m) => m.profiles?.full_name ?? '').filter(Boolean);
  return (
    <div className="bg-slate-900 text-white text-[13px]">
      <div className="px-4 md:px-8 py-2 flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        <span className="font-bold">데모 체험 중</span>
        {teams.length > 1 && (
          <select value={curTeam ?? ''} disabled={!!busy} onChange={(e) => go(d.as, undefined, e.target.value)} aria-label="데모 팀"
            className="bg-white/10 text-white rounded-md px-2 py-1 text-[13px] font-semibold border-0 focus:ring-1 focus:ring-indigo-400">
            {teams.map((t) => <option key={t.key} value={t.key} className="text-slate-900">{t.label} 팀</option>)}
          </select>
        )}
        {busy === 'team' && <span className="text-xs text-slate-300">팀 바꾸는 중…</span>}
        <span className="text-slate-400">D-{left} · AI는 기능마다 한 번씩 체험할 수 있어요</span>
        <div className="flex rounded-lg bg-white/10 p-0.5">
          {(['leader', 'member'] as const).map((k) => (
            <button key={k} onClick={() => go(k)} disabled={!!busy}
              className={cx('px-2.5 py-1 rounded-md font-semibold', d.as === k ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white')}>
              {busy === k ? '전환 중…' : k === 'leader' ? '팀장 화면' : '팀원 화면'}
            </button>
          ))}
        </div>
        {d.as === 'member' && mates.length > 1 && (
          <label className="inline-flex items-center gap-1.5 text-slate-300">
            <span className="hidden sm:inline">지금 보는 팀원</span>
            <select value={d.name ?? ''} disabled={!!busy} onChange={(e) => go('member', e.target.value)}
              className="bg-white/10 text-white rounded-md px-2 py-1 text-[13px] font-semibold border-0 focus:ring-1 focus:ring-indigo-400 max-w-[160px]">
              {mates.map((n) => <option key={n} value={n} className="text-slate-900">{n}{ranks[n] ? ` ${ranks[n]}` : ''}</option>)}
            </select>
            {busy && busy !== 'leader' && busy !== 'member' && <span className="text-xs">전환 중…</span>}
          </label>
        )}
        <button onClick={() => leaveDemo()} className="ml-auto rounded-lg bg-indigo-500 hover:bg-indigo-400 px-3 py-1.5 font-bold">내 팀으로 시작하기 →</button>
      </div>
    </div>
  );
}
