// AUTOPILOT 다이얼 (D1-a) — 레이더가 돌고 바깥 눈금은 반대로 천천히. busy 면 눈금이 빨라지고 보라빛으로 맥박
import { useId } from 'react';
import { cx } from '../../lib/format';

const ticks = (() => {
  let s = '';
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    s += `<line x1="${(50 + Math.cos(a) * 47).toFixed(2)}" y1="${(50 + Math.sin(a) * 47).toFixed(2)}" x2="${(50 + Math.cos(a) * 45).toFixed(2)}" y2="${(50 + Math.sin(a) * 45).toFixed(2)}" stroke="#A5B4FC" stroke-width="${i % 9 === 0 ? 0.96 : 0.6}"/>`;
  }
  return s;
})();

export function AutopilotDial({ size = 72, busy, className }: { size?: number; busy?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <span className={cx('ap-dial inline-block leading-none', busy && 'busy', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
        <defs>
          <radialGradient id={`f${id}`} cx="50%" cy="38%" r="72%"><stop offset="0" stopColor="#262B52" /><stop offset=".6" stopColor="#151A36" /><stop offset="1" stopColor="#0B0E1F" /></radialGradient>
          <linearGradient id={`s${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4F46E5" stopOpacity="0" /><stop offset="1" stopColor="#A78BFA" stopOpacity=".85" /></linearGradient>
        </defs>
        <circle cx="50" cy="50" r="49" fill={`url(#f${id})`} stroke="#353B66" />
        <g className="sw r"><path d="M50 50 L50 6 A44 44 0 0 1 80.4 18.2 Z" fill={`url(#s${id})`} opacity=".6" /></g>
        <circle cx="50" cy="50" r="44" fill="none" stroke="#818CF8" strokeOpacity=".35" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="#818CF8" strokeOpacity=".22" />
        <path d="M50 20v60M20 50h60" stroke="#818CF8" strokeOpacity=".14" />
        <g className="seg r"><path d="M50 3v7M50 90v7M3 50h7M90 50h7" stroke="#C4B5FD" strokeWidth="1.6" /><g dangerouslySetInnerHTML={{ __html: ticks }} /></g>
        <circle className="dot r" cx="64" cy="33" r="1.9" fill="#F0ABFC" />
        <circle className="dot r" cx="29" cy="72" r="1.5" fill="#C4B5FD" />
        <circle className="dot r" cx="73" cy="73" r="1.2" fill="#A5B4FC" />
        <text x="50" y="49" textAnchor="middle" fontFamily="Michroma, sans-serif" fontSize="7.6" letterSpacing="1.2" fill="#fff">AUTOPILOT</text>
        <text x="50.6" y="64.5" textAnchor="middle" fontFamily="Orbitron, sans-serif" fontWeight="800" fontSize="10.5" letterSpacing="2.4" fill="#A78BFA">ON</text>
      </svg>
    </span>
  );
}

/** 제목용 워드마크: AUTOPILOT ON */
export function AutopilotMark({ className, onCls = 'text-violet-400' }: { className?: string; onCls?: string }) {
  return <span className={cx('inline-flex items-baseline gap-2 whitespace-nowrap', className)}><span className="ap-font">AUTOPILOT</span><span className={cx('ap-on text-[0.8em]', onCls)}>ON</span></span>;
}

/** 팀원 화면 — 자동으로 보낸 것에 붙는 작은 표시 */
export function ViaAutopilot({ className }: { className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-700 bg-violet-50 rounded-full px-1.5 py-px whitespace-nowrap', className)} title="팀장님이 정해 둔 AUTOPILOT 설정에 따라 ATEAM이 팀장님 대신 보냈습니다"><span className="w-1.5 h-1.5 rounded-full bg-violet-500" />팀장님 설정에 따라 ATEAM이 보냄</span>;
}
