// 팀원관리 — 이번 주 AI 액션 추천(가로) + 팀원 보드(표준 지표)
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, CalendarPlus, ChevronRight, Send, StickyNote, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { useTeamMembersOnly } from '../lib/hooks';
import { cx } from '../lib/format';
import { LEVEL_CLS, ruleActions, type MemberIndex, type MemberView } from '../lib/peopleActions';
import { ActionsPanel } from '../components/people/ActionsPanel';
import { usePeopleIndex } from '../components/people/usePeopleIndex';
import { Avatar, Card, Spinner } from '../components/ui';
import { AiChip } from '../components/AiBar';
import { RequestModal } from '../components/RequestModal';
import { MemoModal, Sparkline, STATUS_META, useHomeModel, type InsightItem } from '../components/home/shared';
import { ScheduleModal } from './OneOnOnes';

export const FLAG: Record<string, string> = { condition_down: '컨디션 하락', blocked_repeat: '막힘 반복', no_one_on_one: '1:1 공백', checkin_missing: '체크인 없음' };
const strip = (t: string) => t.replace(/\s*\[E\d+\]/g, '');
/** AI 해석 중 이 사람을 언급한 항목 */
export const aiAbout = (items: InsightItem[], name?: string | null) => (name ? items.filter((it) => `${it.title} ${it.body}`.includes(name)) : []);

export default function People() {
  const { team } = useTeam();
  const m = useHomeModel('weekly');
  const [memo, setMemo] = useState<{ open: boolean; who: string | null }>({ open: false, who: null });
  const [params, setParams] = useSearchParams();
  const [oo, setOo] = useState<{ open: boolean; who: string | null }>({ open: !!params.get('new'), who: null });
  const [req, setReq] = useState<string | null | undefined>(undefined);
  const openMemo = (who: string | null = null) => setMemo({ open: true, who });
  const st = m.loading ? null : STATUS_META[m.status.people];
  const members = useTeamMembersOnly();
  const pi = usePeopleIndex(m);
  const k = m.k;
  const lv = (key: string) => members.map((mb) => pi.idx.get(mb.user_id)?.indices.find((i) => i.key === key)?.level);
  const flightHigh = members.filter((mb) => pi.idx.get(mb.user_id)?.flight.level === 'risk').length;
  const flightMid = members.filter((mb) => pi.idx.get(mb.user_id)?.flight.level === 'watch').length;
  const ooGap = lv('oo').filter((x) => x === 'risk' || x === 'watch').length;
  const over = lv('load').filter((x) => x === 'risk').length;
  const fallback = useMemo(() => ruleActions(members, pi.idx, m.raw), [members, pi.idx, m.raw]);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white flex items-center justify-center shadow-sm"><Users size={20} /></span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">팀원관리
              {st && <span className={cx('text-xs font-semibold border rounded-full px-2 py-0.5', st.cls)}>{st.label}</span>}</h1>
            <p className="text-sm text-slate-500">매주 AI가 누구에게 무엇을 할지 추천합니다 — 1:1 · 칭찬 · 관찰 · 육성 · 독려</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => openMemo()} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><StickyNote size={15} />관찰 메모</button>
          <button onClick={() => setReq(null)} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Send size={15} />요청</button>
          <button onClick={() => setOo({ open: true, who: null })} className="text-sm rounded-xl px-3 py-2 bg-teal-600 text-white hover:bg-teal-700 inline-flex items-center gap-1.5"><CalendarPlus size={15} />1:1 잡기</button>
        </div>
      </div>

      <ActionsPanel fallback={fallback} />

      {/* 팀 지표 */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y md:divide-y-0 divide-slate-100">
          <Stat label="팀 컨디션 (5점)" value={k.cond} sub={`체크인 ${k.ciThis}/${k.nMem}명`} viz={<Sparkline points={k.condTrend} labels={k.condWeeks} tone="teal" w={84} h={28} />} />
          <Stat label="이탈 가능성" value={`${flightHigh} · ${flightMid}`} tone={flightHigh ? 'rose' : flightMid ? 'amber' : undefined} sub="높음 · 주의 (명)" />
          <Stat label="1:1 2주 넘게 없음" value={ooGap} tone={ooGap ? 'amber' : undefined} sub={`팀원 ${members.length}명 중`} />
          <Stat label="업무 과부하" value={over} tone={over ? 'amber' : undefined} sub="가용 시간 110% 초과" />
          <Stat label="평가 근거 충분" value={k.evidenceAll ? `${k.evidenceOk}/${k.evidenceAll}` : '—'} sub="판단 근거 기준 충족" />
        </div>
      </Card>

      <div className="flex items-center gap-2"><Users size={15} className="text-teal-600" /><span className="font-semibold">팀원 보드</span><span className="text-xs text-slate-400">이탈 가능성 높은 순 · 누르면 상세</span></div>

      {(m.loading ? <Spinner /> : !members.length
        ? <Card className="p-6 text-sm text-slate-500">팀원을 초대하면 팀원별 카드가 생깁니다. <Link to="/settings?tab=members" className="text-indigo-700 font-semibold">초대하기 →</Link></Card>
        : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...members].sort((a, b) => (pi.idx.get(b.user_id)?.flight.score ?? 0) - (pi.idx.get(a.user_id)?.flight.score ?? 0)).map((mb) => (
              <MemberCard key={mb.user_id} name={mb.profiles?.full_name ?? '팀원'} job={mb.job_title} uid={mb.user_id} ix={pi.idx.get(mb.user_id)} view={pi.views.get(mb.user_id)}
                actions={(pi.actions.out?.content.actions ?? fallback).filter((a) => a.user_id === mb.user_id).length} />
            ))}
          </div>)}

      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
      <ScheduleModal open={oo.open} onClose={() => { setOo({ open: false, who: null }); if (params.get('new') || params.get('tab')) setParams({}, { replace: true }); }} memberId={oo.who} />
      <RequestModal open={req !== undefined} onClose={() => setReq(undefined)} toId={req ?? null} />
    </div>
  );
}

function Stat({ label, value, sub, tone, viz }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'amber' | 'rose'; viz?: ReactNode }) {
  return (
    <div className="px-5 py-4">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-end gap-3">
        <span className={cx('text-2xl font-bold num leading-none', tone === 'amber' && 'text-amber-600', tone === 'rose' && 'text-rose-600')}>{value}</span>{viz}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-400 truncate">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------
// 팀원 카드 — 표준 지표 6개 (컨디션 · 이탈 가능성 · 업무 부하 · 성장 · 1:1 · 평가 근거)
// ---------------------------------------------------------------------
export function IndexGrid({ ix, cols = 3 }: { ix?: MemberIndex; cols?: 3 | 6 }) {
  if (!ix) return null;
  return (
    <dl className={cx('grid gap-1.5', cols === 6 ? 'grid-cols-3 md:grid-cols-6' : 'grid-cols-3')}>
      {ix.indices.map((i) => {
        const c = LEVEL_CLS[i.level];
        return (
          <div key={i.key} className={cx('rounded-lg bg-slate-50 border-t-2 px-2 py-1.5', c.ring)}>
            <dt className="text-[10px] text-slate-500">{i.label}</dt>
            <dd className={cx('text-sm font-bold num leading-tight', i.level === 'risk' && 'text-rose-600', i.level === 'watch' && 'text-amber-700')}>{i.value}</dd>
            {i.pct != null && <div className="mt-1 h-1 rounded-full bg-slate-200"><div className={cx('h-1 rounded-full', c.bar)} style={{ width: `${Math.max(4, i.pct)}%` }} /></div>}
            {i.sub && <dd className="mt-0.5 text-[10px] text-slate-400 truncate">{i.sub}</dd>}
          </div>
        );
      })}
    </dl>
  );
}

const WORK: Record<string, { label: string; cls: string }> = { good: { label: '순항', cls: 'bg-emerald-50 text-emerald-700' }, watch: { label: '주의', cls: 'bg-amber-50 text-amber-800' }, support: { label: '지원 필요', cls: 'bg-rose-50 text-rose-700' } };
function MemberCard({ name, job, uid, ix, view, actions }: { name: string; job: string; uid: string; ix?: MemberIndex; view?: MemberView; actions: number }) {
  const fl = ix?.flight.level ?? 'none';
  return (
    <Link to={`/people/${uid}`} className={cx('group rounded-2xl bg-white ring-1 p-4 flex flex-col shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md hover:-translate-y-0.5 transition-all',
      fl === 'risk' ? 'ring-rose-200' : 'ring-slate-900/[0.07]')}>
      <div className="flex items-center gap-3">
        <span className={cx('rounded-full ring-2 ring-offset-2 shrink-0', fl === 'risk' ? 'ring-rose-400' : fl === 'watch' ? 'ring-amber-400' : 'ring-emerald-400')}><Avatar name={name} size={9} /></span>
        <span className="min-w-0"><span className="block font-semibold truncate group-hover:text-teal-700">{name}</span><span className="block text-xs text-slate-500 truncate">{job || '직무 미입력'}</span></span>
        <span className="ml-auto flex flex-col items-end gap-1">
          {view && <span className={cx('text-[10px] font-semibold rounded-full px-2 py-0.5', WORK[view.work_status]?.cls)}>업무 {WORK[view.work_status]?.label}</span>}
          {actions > 0 && <span className="text-[10px] font-semibold rounded-full bg-violet-600 text-white px-2 py-0.5">이번 주 액션 {actions}</span>}
        </span>
      </div>
      <div className="mt-3"><IndexGrid ix={ix} /></div>
      {view?.work_view ? (
        <p className="mt-2.5 text-xs text-slate-600 leading-relaxed line-clamp-2"><AiChip label="AI 업무 판단" className="mr-1" />{strip(view.work_view)}</p>
      ) : ix?.flight.note ? <p className="mt-2.5 text-xs text-slate-500">{ix.flight.note}</p> : null}
      <span className="mt-auto pt-3 text-xs font-semibold text-teal-700 inline-flex items-center gap-0.5 self-end">상세<ChevronRight size={13} /></span>
    </Link>
  );
}

export function Delta({ d }: { d: number }) {
  const r = Math.round(d * 10) / 10;
  if (Math.abs(r) < 0.1) return <span className="text-slate-400">변화 없음</span>;
  return r > 0 ? <span className="text-emerald-700 inline-flex items-center"><ArrowUpRight size={10} />{r}</span> : <span className="text-rose-600 inline-flex items-center"><ArrowDownRight size={10} />{Math.abs(r)}</span>;
}

