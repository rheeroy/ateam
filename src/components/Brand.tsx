// ATEAM 로고 — 기울어진 T(지렛대) : 받침 위의 막대가 한쪽을 들어 올린다
import { Fragment, type ReactNode } from 'react';
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

/** 위첨자 마크 — 글자 크기에 맞춰 커지고 작아진다 (ATEAM·Core 뒤에 붙는 AI) */
export function AiSup({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 20" className={cx('inline-block shrink-0 ml-[0.12em] align-[0.62em] h-[0.48em] w-[0.72em]', className)} fill="none" stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="AI">
      <path d="M2 18 L9 2.5 L16 18" /><path d="M19.5 2.5 H28" /><path d="M23.75 7 V18" />
    </svg>
  );
}

/** 뒤에서 읽고 정리하는 AI — 'Core AI' */
export function CoreAI({ className, supCls = 'text-violet-600' }: { className?: string; supCls?: string }) {
  return <span className={cx('whitespace-nowrap', className)}>Core<AiSup className={supCls} /></span>;
}

/** 사람에게 말을 거는 AI — 'ATEAM AI' (코칭·제안·브리핑) */
export function AteamAI({ className, supCls = 'text-violet-600' }: { className?: string; supCls?: string }) {
  return <span className={cx('whitespace-nowrap', className)}><span className="font-extrabold">ATEAM</span><AiSup className={supCls} /></span>;
}

/** 사용자가 눌러 쓰는 AI 기능 아이콘 — lucide 아이콘 자리에 같은 size로 넣는다 */
export function AiIcon({ size = 14, className }: { size?: number; className?: string }) {
  return <AiMark size={Math.round(size * 0.72)} weight={3} className={className} />;
}

/** 문장 속 'AI'를 바꿔 그린다. core = Core AI, mark = 마크만 (칩·라벨용). 'ATEAM AI'는 언제나 ATEAM AI */
export function aiText(s: string, mode: 'core' | 'mark' = 'core'): ReactNode {
  const parts = s.split(/(ATEAM AI|(?<![A-Za-z])AI(?![A-Za-z]))/);
  if (parts.length === 1) return s;
  return parts.map((p, i) => {
    if (p === 'ATEAM AI') return <AteamAI key={i} />;
    if (p === 'AI') return mode === 'core' ? <CoreAI key={i} /> : <AiMark key={i} size={8} weight={3.2} className="mr-[0.2em] align-[0.05em]" />;
    return <Fragment key={i}>{mode === 'mark' && parts[i - 1] === 'AI' ? p.replace(/^ /, '') : p}</Fragment>;
  });
}
