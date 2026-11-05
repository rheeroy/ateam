// 팀원 상세 — 활동 · 부하 흐름 (8주): 주별 업무 기록 수(밤·주말 분리) + 부하 · 컨디션과 엮은 한 줄 판단
import { Activity } from 'lucide-react';
import { cx, fmtShort } from '../../lib/format';
import type { ActWeek } from '../../lib/activity';
import type { MemberIndex } from '../../lib/peopleActions';
import { Card } from '../ui';

const TONE: Record<string, string> = {
  risk: 'bg-rose-50 text-rose-700 ring-rose-200', watch: 'bg-amber-50 text-amber-800 ring-amber-200',
  good: 'bg-emerald-50 text-emerald-700 ring-emerald-200', none: 'bg-slate-100 text-slate-500 ring-slate-200',
};

export function ActivityCard({ uid, ix, rows }: { uid: string; ix?: MemberIndex; rows: ActWeek[] }) {
  const s = ix?.act?.stat;
  const rd = ix?.act?.read;
  if (!ix || !rd) return null;
  const weeks = s?.weeks ?? [];
  const max = Math.max(4, ...weeks.map((w) => w.total), s?.teamMedian ?? 0);
  const mine = rows.filter((r) => r.user_id === uid);
  const last2 = weeks.slice(-3, -1).map((w) => w.week);
  const sum = (k: keyof Pick<ActWeek, 'talk' | 'output' | 'updates' | 'replies' | 'checkin'>) => mine.filter((r) => last2.includes(r.week_start)).reduce((a, r) => a + r[k], 0);
  const parts = ([['talk', '대화'], ['updates', '진척 · 상태 업데이트'], ['output', '결과물'], ['replies', '답 · 코멘트'], ['checkin', '컨디션 공유']] as const).map(([k, l]) => ({ l, n: sum(k) })).filter((p) => p.n);
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Activity size={15} className="text-teal-600" />
        <span className="text-sm font-bold">활동 · 부하 흐름</span>
        <span className={cx('text-[11px] font-bold rounded-full px-2 py-0.5 ring-1', TONE[rd.tone])}>{rd.label}</span>
        <span className="text-xs text-slate-500 truncate">{rd.why}</span>
      </div>
      {s && rd.key !== 'none' && (
        <>
          <div className="mt-3 flex items-end gap-1.5 h-28">
            {weeks.map((w, i) => {
              const cur = i === weeks.length - 1;
              const h = (n: number) => `${Math.max(n ? 6 : 2, Math.round((n / max) * 100))}%`;
              return (
                <div key={w.week} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${fmtShort(w.week)} 주 · 기록 ${w.total}건 · 밤·주말 ${w.off}건${cur ? ' · 진행 중' : ''}`}>
                  <span className="text-[10px] text-slate-500 num">{w.total || ''}</span>
                  <div className={cx('w-full max-w-[34px] rounded-md flex flex-col justify-end overflow-hidden', cur ? 'bg-teal-100/60 ring-1 ring-dashed ring-teal-300' : 'bg-teal-500/90')} style={{ height: h(w.total) }}>
                    {w.off > 0 && <div className={cx(cur ? 'bg-violet-300' : 'bg-violet-600')} style={{ height: `${Math.round((w.off / Math.max(1, w.total)) * 100)}%` }} />}
                  </div>
                  <span className={cx('text-[10px] num', cur ? 'text-teal-700 font-semibold' : 'text-slate-400')}>{cur ? '이번 주' : fmtShort(w.week)}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-teal-500" />업무 기록</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-600" />밤 9시 이후 · 주말</span>
            <span className="ml-auto">최근 2주 주 <b className="text-slate-800 num">{s.recent}</b>건 · 지난 4주 {s.base ?? '—'}건 · 팀 중앙값 {s.teamMedian}건 · 부하 {ix.load != null ? `${ix.load}%` : '—'}</span>
          </div>
          {!!parts.length && <p className="mt-1.5 text-[11px] text-slate-500">최근 2주: {parts.map((p) => `${p.l} ${p.n}`).join(' · ')}</p>}
        </>
      )}
      <p className="mt-2 text-[10.5px] text-slate-400">앱에 남은 업무 기록만 셉니다(접속 · 열람은 세지 않음). 구두 · 메일로 한 일은 빠져 있으니, 판단이 아니라 대화를 시작하는 단서로 쓰세요.</p>
    </Card>
  );
}
