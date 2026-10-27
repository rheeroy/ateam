// AUTOPILOT 설정 — 직접(기본) · 반자동 · 완전 자동. 모드는 다음 실행부터 적용된다
import { useEffect, useState } from 'react';
import { useSession, useTeam } from '../../state/session';
import { cx } from '../../lib/format';
import { errorText } from '../../lib/supabase';
import { AP_TYPES, AP_TYPE_KEYS, MODE_LABEL, SEMI_DEFAULT, allowedIn, autopilotOf, saveApSettings, useApQuota, type ApMode, type ApSettings, type ApType } from '../../lib/autopilot';
import { Modal, useToast } from '../ui';
import { AutopilotMark } from './Dial';

const MODES: [ApMode, string][] = [
  ['direct', '아무것도 바로 보내지 않습니다. 결과를 보고 팀장님이 하나씩 보냅니다.'],
  ['semi', '허용해 둔 액션만 바로 보내고, 나머지는 확인 대기로 남깁니다. 추천값이 들어 있고 액션별로 바꿀 수 있습니다.'],
  ['auto', '모든 액션을 바로 보냅니다. 액션별 설정은 할 수 없습니다.'],
];

export function AutopilotSettings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { team } = useTeam();
  const { refresh } = useSession();
  const toast = useToast();
  const quota = useApQuota(team.id);
  const [s, setS] = useState<ApSettings>(() => autopilotOf(team.settings));
  useEffect(() => { if (open) setS(autopilotOf(team.settings)); }, [open, team.settings]);
  const save = async (next: ApSettings) => {
    const prev = s; setS(next);
    try { await saveApSettings(team.id, next); refresh(); } catch (e) { setS(prev); toast(errorText(e)); }
  };
  const toggle = (t: ApType) => { if (s.mode === 'semi') save({ ...s, allow: { ...s.allow, [t]: !s.allow[t] } }); };
  const changed = (t: ApType) => s.mode === 'semi' && s.allow[t] !== SEMI_DEFAULT[t];
  const qd = quota.data;
  return (
    <Modal open={open} onClose={onClose} wide title={<span className="inline-flex items-center gap-2"><AutopilotMark className="text-[13px] text-slate-900" onCls="text-violet-600" /><span>설정</span></span>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">AUTOPILOT을 실행했을 때, 어떤 액션을 팀장님 확인 없이 바로 보낼지 정합니다. 처음에는 <b className="text-slate-700">직접</b>으로 시작합니다.</p>
        <div className="grid sm:grid-cols-3 gap-2.5">
          {MODES.map(([m, d]) => (
            <button key={m} type="button" onClick={() => save({ ...s, mode: m })} aria-pressed={s.mode === m}
              className={cx('text-left rounded-xl border-[1.5px] p-3.5 flex flex-col justify-start gap-1.5', s.mode === m ? 'border-violet-600 bg-violet-50 ring-[3px] ring-violet-600/10' : 'border-slate-200 hover:border-slate-300')}>
              <span className="flex items-center gap-2 font-extrabold text-[15px]">{MODE_LABEL[m]}{m === 'direct' && <span className="text-[10.5px] font-bold text-slate-600 bg-slate-100 rounded-full px-2 py-px">기본</span>}</span>
              <span className="block text-[12.5px] text-slate-500 leading-relaxed">{d}</span>
            </button>
          ))}
        </div>
        {s.mode === 'direct'
          ? <div className="text-[12.5px] leading-relaxed rounded-xl px-3.5 py-3 bg-slate-50 ring-1 ring-slate-200 text-slate-600">지금은 <b>직접</b> 모드입니다. AUTOPILOT을 실행해도 팀원에게 자동으로 가는 것은 없고, 모든 액션은 결과 화면에서 팀장님이 [보내기]를 눌러야 발송됩니다.</div>
          : <div className="text-[12.5px] leading-relaxed rounded-xl px-3.5 py-3 bg-violet-50 ring-1 ring-violet-200 text-violet-950"><b>{MODE_LABEL[s.mode]}</b>으로 바꾸면, <b>다음번 AUTOPILOT을 실행할 때부터</b> {s.mode === 'auto' ? '모든 액션이' : '아래에서 켜 둔 액션이'} 결과가 나오는 즉시 팀원에게 자동으로 발송됩니다. 이미 나온 결과에는 적용되지 않습니다.</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-slate-400 border-b border-slate-200"><th className="text-left font-semibold py-2 px-1.5">액션</th><th className="text-left font-semibold px-1.5">팀원이 받는 곳</th><th className="text-right font-semibold px-1.5">바로 보내기</th></tr></thead>
            <tbody>
              {AP_TYPE_KEYS.map((t) => {
                const on = allowedIn(s, t); const dis = s.mode !== 'semi';
                return (
                  <tr key={t} className="border-b border-slate-100">
                    <td className="py-2.5 px-1.5"><span className={cx('text-[11px] font-bold rounded-full px-2 py-0.5', AP_TYPES[t].cls)}>{AP_TYPES[t].label}</span>{changed(t) && <span className="ml-1.5 text-[10.5px] text-violet-600">변경됨</span>}</td>
                    <td className="px-1.5 text-xs text-slate-500">{AP_TYPES[t].to}</td>
                    <td className="px-1.5 text-right">
                      <button type="button" role="switch" aria-checked={on} aria-label={`${AP_TYPES[t].label} 바로 보내기`} disabled={dis} onClick={() => toggle(t)}
                        className={cx('relative inline-block w-[38px] h-[22px] rounded-full transition-colors', on ? 'bg-violet-600' : 'bg-slate-300', dis && 'opacity-45 cursor-not-allowed')}>
                        <span className={cx('absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all', on ? 'left-[19px]' : 'left-[3px]')} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {s.mode === 'semi' && <div className="text-right mt-2.5"><button type="button" onClick={() => save({ ...s, allow: { ...SEMI_DEFAULT } })} className="text-xs font-semibold rounded-lg px-2.5 py-1.5 ring-1 ring-slate-200 hover:bg-slate-50">추천값으로 되돌리기</button></div>}
        </div>
        <div className="text-[12.5px] text-slate-600 leading-relaxed rounded-xl px-3.5 py-3 bg-slate-50 ring-1 ring-slate-200">
          <b className="text-slate-800">어떤 모드에서도 지키는 것</b><br />
          · 구체적인 업무 지시는 쓰지 않습니다. 관찰과 방향만 담습니다 ("진척이 계획보다 느려 보여요" 수준).<br />
          · 건강 · 개인 사정 · 이탈 · 평가·보상이 언급되는 메시지는 바로 보내지 않고, 팀장님이 확인하도록 남깁니다.<br />
          · 한 번 실행에 한 사람에게 자동으로 가는 것은 2건까지입니다.<br />
          · 팀원 화면에는 <b>"팀장님 설정에 따라 ATEAM이 보냄"</b>이 표시되고, 보낸 뒤 10분 안에는 되돌릴 수 있습니다.
        </div>
        {qd && (
          <div className="flex items-center gap-3 text-[13px] flex-wrap">
            <b>{qd.trial ? '체험 기간' : '이번 달'} 실행</b>
            <span className="flex gap-1">{Array.from({ length: qd.limit }, (_, i) => <i key={i} className={cx('w-5 h-2 rounded', i < qd.used ? 'bg-violet-600' : 'bg-slate-200')} />)}</span>
            <span className="text-slate-500">{qd.limit}회 중 {qd.used}회 사용{qd.resets_at ? ` · ${new Date(qd.resets_at).getMonth() + 1}월 1일 초기화` : ''}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
