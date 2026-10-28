// AUTOPILOT 실행 모드 스위치 — 항공기 오토파일럿 패널의 점등 버튼 세 개 중 하나. 누르면 바로 바뀌고 옆에 짧은 설명
//   모드는 다음 실행부터 적용된다 (이미 나온 결과에는 영향 없음)
import { useEffect, useState } from 'react';
import { useSession, useTeam } from '../../state/session';
import { cx } from '../../lib/format';
import { errorText } from '../../lib/supabase';
import { MODE_LABEL, autopilotOf, saveApSettings, type ApMode } from '../../lib/autopilot';
import { useToast } from '../ui';

const MODES: { m: ApMode; en: string }[] = [{ m: 'direct', en: 'MAN' }, { m: 'semi', en: 'ASSIST' }, { m: 'auto', en: 'AUTO' }];
// 버튼 옆에 늘 보이는 짧은 설명 (자세한 건 설정에서)
const DESC: Record<ApMode, string> = {
  direct: '자동으로 보내지 않습니다. 결과를 보고 팀장님이 직접 보냅니다.',
  semi: '켜 둔 액션만 즉시 자동으로 보내고, 나머지는 확인 대기로 둡니다.',
  auto: '모든 액션을 결과가 나오는 즉시 자동으로 보냅니다.',
};

/** size 'lg' = 결과 화면 머리, 'sm' = 플로팅 팝업 안. 버튼 옆에 지금 모드의 짧은 설명 */
export function ModeSwitch({ size = 'lg', runMode }: { size?: 'lg' | 'sm'; runMode?: ApMode }) {
  const { team } = useTeam();
  const { refresh } = useSession();
  const toast = useToast();
  const saved = autopilotOf(team.settings);
  const [mode, setMode] = useState<ApMode>(saved.mode);
  const [busy, setBusy] = useState(false);
  // 설정 창 등 다른 곳에서 바뀐 값을 따라간다
  useEffect(() => { if (!busy) setMode(saved.mode); }, [saved.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const lg = size === 'lg';

  const pick = async (m: ApMode) => {
    if (m === mode || busy) return;
    const prev = mode; setMode(m); setBusy(true);
    try { await saveApSettings(team.id, { ...saved, mode: m }); refresh(); }
    catch (e) { setMode(prev); toast(errorText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="min-w-0">
      <div className={cx('ap-font tracking-[.2em] text-indigo-300 mb-1.5', lg ? 'text-[10px]' : 'text-[9px]')}>DRIVE MODE · 실행 모드</div>
      <div className={cx('flex', lg ? 'flex-col sm:flex-row sm:items-center gap-3 sm:gap-5' : 'items-center gap-3')}>
        {/* 콕핏 점등 버튼 — 오목한 패널 안의 키 세 개. 켜진 키는 눌려 들어간 채 LED가 켜진다 */}
        <div role="radiogroup" aria-label="실행 모드" className={cx('ap-keys grid grid-cols-3 shrink-0', lg ? 'gap-2 p-2 w-full sm:w-[300px]' : 'gap-1.5 p-1.5 w-[186px]')}>
          {MODES.map((x) => {
            const on = x.m === mode;
            return (
              <button key={x.m} type="button" role="radio" aria-checked={on} onClick={() => pick(x.m)} disabled={busy && !on}
                className={cx('ap-key', on && 'on', lg ? 'h-[66px]' : 'h-[50px] !gap-1')}>
                <span className={cx('ap-led', lg ? 'w-10' : 'w-6 !h-1')} />
                <span className={cx('ap-font ap-kt', lg ? 'text-[11px] tracking-[.12em]' : 'text-[8.5px] tracking-[.04em]')}>{x.en}</span>
                <span className={cx('font-bold ap-kk', lg ? 'text-[11px]' : 'text-[9.5px]')}>{MODE_LABEL[x.m]}</span>
              </button>
            );
          })}
        </div>
        <div className="min-w-0" aria-live="polite">
          <div className={cx('font-bold text-white', lg ? 'text-[14px]' : 'text-[12.5px]')}>{MODE_LABEL[mode]} <span className={cx('font-medium text-indigo-300', lg ? 'text-[12px]' : 'text-[10.5px]')}>· 다음 실행부터</span></div>
          <p className={cx('mt-0.5 leading-relaxed text-indigo-200', lg ? 'text-[12.5px] max-w-[300px]' : 'text-[11px]')}>{DESC[mode]}</p>
          {lg && runMode && runMode !== mode && <p className="mt-1 text-[11px] text-indigo-300/80">이번 결과는 {MODE_LABEL[runMode]}으로 실행됨</p>}
        </div>
      </div>
    </div>
  );
}
