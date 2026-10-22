// ATEAM 로고 — 기울어진 T(지렛대) : 받침 위의 막대가 한쪽을 들어 올린다
import { cx } from '../lib/format';

/** 지렛대 마크 (선 색 = currentColor) */
export function LogoMark({ className, weight = 3.4, size }: { className?: string; weight?: number; size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 33 L34 7.8" />
      <path d="M23 17.7 V33" />
    </svg>
  );
}

/** 인디고 블록 안의 지렛대 마크 */
export function LogoBlock({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center justify-center rounded-[28%] bg-indigo-600 text-white shrink-0', className)} style={{ width: size, height: size }}>
      <LogoMark className="w-[82%] h-[82%]" />
    </span>
  );
}

/** 워드마크 ATEAM */
export function ATeam({ className }: { className?: string; supCls?: string }) {
  return <span className={cx('font-black tracking-tight leading-none', className)}>ATEAM</span>;
}

/** 메뉴·제목용: ATEAM의 제안 */
export function ATeamAdvice({ className }: { className?: string; supCls?: string }) {
  return <span className={cx('inline-flex items-baseline', className)}><span className="font-extrabold">ATEAM</span>의 제안</span>;
}

/** AI 마크 — 꼭짓점만 남은 A + 머리가 떠 있는 T. 'AI' 글자 대신 쓴다 (선 색 = currentColor) */
export function AiMark({ className, size = 12, weight = 2.8, title = 'AI' }: { className?: string; size?: number; weight?: number; title?: string }) {
  return (
    <svg viewBox="0 0 30 20" width={size * 1.5} height={size} className={cx('inline-block shrink-0', className)} fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={title}>
      <path d="M2 18 L9 2.5 L16 18" />
      <path d="M19.5 2.5 H28" />
      <path d="M23.75 7 V18" />
    </svg>
  );
}

/** 위첨자 자리 (ATEAM·Core 뒤에 붙는 AI) */
export function AiSup({ className }: { className?: string }) {
  return <AiMark size={7} weight={3.2} className={cx('ml-0.5 align-super', className)} />;
}
