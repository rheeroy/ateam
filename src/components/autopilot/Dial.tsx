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

// 옆면 홈 — 원기둥을 비스듬히 볼 때처럼 가장자리로 갈수록 촘촘해진다
const knurl = (() => {
  let d = '';
  for (let i = 2; i < 47; i++) { const x = 50 - Math.cos((i / 48) * Math.PI) * 49; d += `M${x.toFixed(2)} 40V100`; }
  return d;
})();

/** D1-a 다이얼을 살짝 눕혀(윗면 세로 0.9) 아래쪽 두께가 보이게 한 버전 */
export function AutopilotDial({ size = 84, busy, className }: { size?: number; busy?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <span className={cx('ap-dial inline-block leading-none', busy && 'busy', className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
        <defs>
          <radialGradient id={`f${id}`} cx="50%" cy="38%" r="72%"><stop offset="0" stopColor="#262B52" /><stop offset=".6" stopColor="#151A36" /><stop offset="1" stopColor="#0B0E1F" /></radialGradient>
          <linearGradient id={`s${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4F46E5" stopOpacity="0" /><stop offset="1" stopColor="#A78BFA" stopOpacity=".85" /></linearGradient>
          {/* 옆면 — 가운데가 은은하게 밝고 양끝은 어둡게 */}
          <linearGradient id={`w${id}`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#0B0E1F" /><stop offset=".3" stopColor="#353B66" /><stop offset=".5" stopColor="#3F4677" /><stop offset=".7" stopColor="#2A2F55" /><stop offset="1" stopColor="#0B0E1F" /></linearGradient>
          <clipPath id={`c${id}`}><ellipse cx="50" cy="52.5" rx="49" ry="44.1" /></clipPath>
        </defs>
        {/* 옆면(두께) */}
        <ellipse cx="50" cy="52.5" rx="49" ry="44.1" fill={`url(#w${id})`} />
        <path d={knurl} stroke="#05060F" strokeOpacity=".3" strokeWidth=".5" clipPath={`url(#c${id})`} />
        {/* 윗면 — 초기 D1-a 그대로, 세로만 0.9 */}
        <g transform="translate(50 45.5) scale(1 .9) translate(-50 -50)">
          <circle cx="50" cy="50" r="49" fill={`url(#f${id})`} stroke="#4A5185" />
          <g className="sw r"><path d="M50 50 L50 6 A44 44 0 0 1 80.4 18.2 Z" fill={`url(#s${id})`} opacity=".6" /></g>
          <circle cx="50" cy="50" r="44" fill="none" stroke="#818CF8" strokeOpacity=".35" />
          <circle cx="50" cy="50" r="30" fill="none" stroke="#818CF8" strokeOpacity=".22" />
          <path d="M50 20v60M20 50h60" stroke="#818CF8" strokeOpacity=".14" />
          <g className="seg r"><path d="M50 3v7M50 90v7M3 50h7M90 50h7" stroke="#C4B5FD" strokeWidth="1.6" /><g dangerouslySetInnerHTML={{ __html: ticks }} /></g>
          <circle className="dot r" cx="64" cy="33" r="1.9" fill="#F0ABFC" />
          <circle className="dot r" cx="29" cy="72" r="1.5" fill="#C4B5FD" />
          <circle className="dot r" cx="73" cy="73" r="1.2" fill="#A5B4FC" />
          <text x="50" y="49.5" textAnchor="middle" fontFamily="Michroma, sans-serif" fontSize="8.3" letterSpacing=".7" fill="#fff">AUTOPILOT</text>
          <text x="50.8" y="66.5" textAnchor="middle" fontFamily="Orbitron, sans-serif" fontWeight="800" fontSize="13.5" letterSpacing="2.6" fill="#A78BFA">ON</text>
        </g>
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
