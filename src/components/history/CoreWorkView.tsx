// 핵심 업무 화면 — 팀장(히스토리 관리)과 팀원(받은 히스토리 · 사본)이 같이 쓴다
//   연도별 흐름(담당자 시기 띠 + 해마다 과제 칸 + 그해 핵심 한 줄) · 지켜 온 원칙 · 반복되는 일 · 해 봤는데 안 된 것 ·
//   오래 이어진 관계자 · 열린 숙제 · 조심할 것 · 확인 필요
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Flag, Repeat, RotateCcw, Waypoints } from 'lucide-react';
import { cx } from '../../lib/format';
import type { CLine, CoreContent, CoreTask } from '../../lib/coreWorks';
import { Card } from '../ui';

const ERA_C = ['bg-slate-300', 'bg-sky-300', 'bg-teal-300', 'bg-amber-300', 'bg-indigo-300', 'bg-rose-300', 'bg-violet-300'];
const ym = (s: string | null | undefined, end: number) => {
  if (!s) return end;
  const [y, m] = s.split('-').map(Number);
  return y + ((m || 1) - 1) / 12;
};

/** 머리에 쓰는 담당 순서 */
export const eraChain = (c: CoreContent) => (c.eras ?? []).map((e) => e.name).filter(Boolean).join(' → ');

export function CoreWorkView({ content, tasks, sinceYear, onOpenTask }: {
  content: CoreContent; tasks: CoreTask[]; sinceYear: number | null; onOpenTask?: (itemId: string) => void;
}) {
  const now = new Date().getFullYear();
  const ys = [...tasks.map((t) => t.year), ...(content.eras ?? []).map((e) => Math.floor(ym(e.from, now))), sinceYear ?? now];
  const y0 = Math.min(...ys), y1 = Math.max(now, ...tasks.map((t) => t.year));
  const years = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i);
  const span = years.length;
  const x = (v: number) => ((Math.min(Math.max(v, y0), y1 + 1) - y0) / span) * 100;
  const cols = { display: 'grid', gridTemplateColumns: `repeat(${span}, minmax(112px, 1fr))` } as const;

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="text-sm font-bold mb-3">연도별 흐름 <span className="text-[11px] font-normal text-slate-400">· 해마다 이름이 다른 과제를 AI가 이 업무로 묶었습니다 · 위 띠는 담당자 시기</span></div>
        <div className="overflow-x-auto"><div style={{ minWidth: span * 112 }}>
          <div style={cols} className="text-[11px] text-slate-500 num mb-1.5">{years.map((y) => <div key={y} className="pl-1 border-l border-slate-200">{y}</div>)}</div>
          {!!content.eras?.length && (
            <div className="relative h-6 mb-3">{content.eras.map((e, i) => {
              const a = ym(e.from, y0), b = ym(e.to, y1 + 1);
              return <div key={`${e.name}${i}`} title={`${e.name} · ${e.from}~${e.to ?? '지금'}`} className={cx('absolute top-0 h-6 rounded-md text-[11px] font-semibold text-slate-800 flex items-center px-2 truncate', ERA_C[i % ERA_C.length])}
                style={{ left: `${x(a)}%`, width: `calc(${Math.max(x(b) - x(a), 3)}% - 3px)` }}>{e.name}</div>;
            })}</div>
          )}
          <div style={{ ...cols, gap: 4 }}>{years.map((y) => {
            const ts = tasks.filter((t) => t.year === y);
            const key = ts.find((t) => t.key)?.key;
            return (
              <div key={y} className={cx('rounded-xl p-2 min-h-[120px] flex flex-col gap-1', y === now ? 'bg-indigo-50 ring-1 ring-indigo-100' : 'bg-slate-50')}>
                {ts.map((t, i) => {
                  const cls = cx('text-left text-[11.5px] leading-snug rounded-md px-1.5 py-1 bg-white ring-1', t.status === 'blocked' ? 'ring-rose-200 text-rose-800' : t.status === 'active' ? 'ring-indigo-200 text-indigo-900 font-semibold' : 'ring-slate-200 text-slate-700');
                  return onOpenTask && t.item_id ? <button key={i} onClick={() => onOpenTask(t.item_id!)} className={cx(cls, 'hover:ring-indigo-400')}>{t.title}</button> : <div key={i} className={cls}>{t.title}</div>;
                })}
                {!ts.length && <div className="text-[11px] text-slate-300">—</div>}
                {key && <div className="mt-auto text-[10.5px] text-slate-500 leading-snug"><span className="inline-block w-1.5 h-1.5 rotate-45 bg-emerald-500 mr-1 align-middle" />{key}</div>}
              </div>
            );
          })}</div>
        </div></div>
      </Card>
      <div className="grid md:grid-cols-2 gap-3">
        <Card className="p-4 space-y-4">
          <Sec icon={<CheckCircle2 size={13} />} title="지켜 온 원칙 · 확정 사항" tone="text-emerald-700" lines={content.principles} tail={(l) => l.year} />
          <Sec icon={<Repeat size={13} />} title="해마다 반복되는 일" tone="text-indigo-700" lines={content.recurring} tail={(l) => l.when} />
          <Sec icon={<RotateCcw size={13} />} title="해 봤는데 안 된 것" tone="text-slate-600" lines={content.tried} tail={(l) => l.year} />
        </Card>
        <Card className="p-4 space-y-4">
          <Sec icon={<Waypoints size={13} />} title="오래 이어진 관계자" tone="text-violet-700" lines={content.people} tail={(l) => (l.since ? `${l.since}~` : null)} />
          <Sec icon={<Flag size={13} />} title="지금 열린 숙제" tone="text-amber-700" lines={content.open} tail={(l) => (l.since ? `${l.since}부터` : null)} />
          <Sec icon={<AlertTriangle size={13} />} title="넘겨받는 사람이 조심할 것" tone="text-rose-700" lines={content.cautions} />
          <Sec icon={<CircleHelp size={13} />} title="기록에 없어 확인이 필요한 것" tone="text-slate-500" lines={content.gaps} />
        </Card>
      </div>
    </div>
  );
}

function Sec({ icon, title, tone, lines, tail }: { icon: ReactNode; title: string; tone: string; lines?: CLine[]; tail?: (l: CLine) => string | number | null | undefined }) {
  if (!lines?.length) return null;
  return (
    <div>
      <div className={cx('text-xs font-bold mb-2 flex items-center gap-1', tone)}>{icon}{title}<span className="font-normal text-slate-400">{lines.length}</span></div>
      <ul className="space-y-1.5 text-[13px] text-slate-700">{lines.map((l, i) => {
        const t = tail?.(l);
        return <li key={i} className="flex gap-2"><span className="mt-2 w-1 h-1 rounded-full bg-slate-300 shrink-0" /><span className="flex-1">{l.text}</span>{t != null && t !== '' && <span className="text-[11px] text-slate-400 num shrink-0">{t}</span>}</li>;
      })}</ul>
    </div>
  );
}
