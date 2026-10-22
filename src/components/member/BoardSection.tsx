// 팀원 매니징 보드 — 칸 머리: 박스 위에 제목 · 한 줄 설명 · 오른쪽 버튼
import type { ReactNode } from 'react';
import { Card } from '../ui';

/** sub: 묶음 안의 소제목 (작게, 설명 없이) */
export function BoardSection({ icon, title, desc, right, sub, children }: { icon?: ReactNode; title: ReactNode; desc?: ReactNode; right?: ReactNode; sub?: boolean; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <div className={sub ? 'flex items-center gap-3 mb-2 px-1' : 'flex items-end gap-3 mb-2.5 px-1 min-h-[44px]'}>
        <div className="min-w-0">
          <h2 className={sub ? 'text-sm font-semibold text-slate-700 flex items-center gap-1.5' : 'text-[15px] font-bold text-slate-900 flex items-center gap-1.5'}>{icon}{title}</h2>
          {desc && <p className="text-xs text-slate-500 mt-0.5">{desc}</p>}
        </div>
        {right && <div className="ml-auto shrink-0 flex items-center gap-2">{right}</div>}
      </div>
      <Card>{children}</Card>
    </section>
  );
}
