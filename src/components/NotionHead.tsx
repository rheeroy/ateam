// 팀원 화면 머리 — 노션 페이지처럼 이모지 + 큰 제목 + 회색 설명 (업무 스레드 · 팀 방향 · Sim.Box · 1on1 · 피드백 · 받은 히스토리)
import type { ReactNode } from 'react';

/** 노션 페이지 머리 — 이모지 + 큰 제목 + 회색 설명 */
export function NotionHead({ emoji, title, sub, right }: { emoji: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end gap-3 flex-wrap pb-3 mb-3 border-b border-[#EDEDEB]">
      <h1 className="flex items-center gap-2.5 text-[26px] font-extrabold tracking-tight text-[#37352F] min-w-0">
        <span className="text-[30px] leading-none">{emoji}</span><span className="truncate">{title}</span>
      </h1>
      {sub && <div className="text-sm text-slate-500 pb-1 min-w-0">{sub}</div>}
      {right && <div className="ml-auto pb-0.5 shrink-0">{right}</div>}
    </div>
  );
}

