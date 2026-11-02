// 데모 링크로 들어왔을 때 화면 맨 위 띠 — 남은 기간 · 팀장/팀원 화면 전환 · 내 팀으로 시작하기
import { useEffect, useState } from 'react';
import { useTeam } from '../../state/session';
import { checkDemo, enterDemo, getDemo, leaveDemo } from '../../lib/demo';
import { errorText } from '../../lib/supabase';
import { cx } from '../../lib/format';
import { useToast } from '../ui';

const CHECKED = 'ateam.demo.checked';

export function DemoBar() {
  const { team } = useTeam();
  const toast = useToast();
  const d = getDemo();
  const [busy, setBusy] = useState<'leader' | 'member' | null>(null);

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
  const go = async (as: 'leader' | 'member') => {
    if (as === d.as || busy) return;
    setBusy(as);
    try { await enterDemo(d.token, as); } catch (e) { toast(errorText(e)); setBusy(null); }
  };
  return (
    <div className="bg-slate-900 text-white text-[13px]">
      <div className="px-4 md:px-8 py-2 flex items-center gap-x-3 gap-y-1.5 flex-wrap">
        <span className="font-bold">데모 체험 중</span>
        <span className="text-slate-400">D-{left} · AI는 기능마다 한 번씩 체험할 수 있어요</span>
        <div className="flex rounded-lg bg-white/10 p-0.5">
          {(['leader', 'member'] as const).map((k) => (
            <button key={k} onClick={() => go(k)} disabled={!!busy}
              className={cx('px-2.5 py-1 rounded-md font-semibold', d.as === k ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white')}>
              {busy === k ? '전환 중…' : k === 'leader' ? '팀장 화면' : '팀원 화면'}
            </button>
          ))}
        </div>
        <button onClick={() => leaveDemo()} className="ml-auto rounded-lg bg-indigo-500 hover:bg-indigo-400 px-3 py-1.5 font-bold">내 팀으로 시작하기 →</button>
      </div>
    </div>
  );
}
