// 팀원관리 — 이번 주 AI 액션 추천(가로) + 팀원 보드(표준 지표)
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Award, CalendarPlus, StickyNote, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { useTeamMembersOnly } from '../lib/hooks';
import { cx } from '../lib/format';
import { LEVEL_CLS, attnSkew, ruleActions, type Level, type MemberIndex, type MemberView, type PeopleAction } from '../lib/peopleActions';
import { ActionsPanel, PraiseModal } from '../components/people/ActionsPanel';
import { usePeopleIndex } from '../components/people/usePeopleIndex';
import { Avatar, Card, Spinner } from '../components/ui';
import { AiChip } from '../components/AiBar';
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
  const [praise, setPraise] = useState<{ uid: string; name: string } | null>(null);
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
  const attnLow = lv('attn').filter((x) => x === 'risk' || x === 'watch').length;
  const skew = attnSkew(pi.attn);
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
          <button onClick={() => setOo({ open: true, who: null })} className="text-sm rounded-xl px-3 py-2 bg-teal-600 text-white hover:bg-teal-700 inline-flex items-center gap-1.5"><CalendarPlus size={15} />1:1 잡기</button>
        </div>
      </div>

      <ActionsPanel fallback={fallback} />

      {/* 팀 지표 */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-2 md:grid-cols-6 divide-x divide-y md:divide-y-0 divide-slate-100">
          <Stat label="팀 컨디션 (5점)" value={k.cond} sub={`체크인 ${k.ciThis}/${k.nMem}명`} viz={<Sparkline points={k.condTrend} labels={k.condWeeks} tone="teal" w={84} h={28} />} />
          <Stat label="이탈 가능성" value={`${flightHigh} · ${flightMid}`} tone={flightHigh ? 'rose' : flightMid ? 'amber' : undefined} sub="높음 · 주의 (명)" />
          <Stat label="1:1 2주 넘게 없음" value={ooGap} tone={ooGap ? 'amber' : undefined} sub={`팀원 ${members.length}명 중`} />
          <Stat label="팀장 관심 부족" value={pi.attn.length ? attnLow : '—'} tone={attnLow ? 'amber' : undefined}
            sub={skew ? `접점 ${skew.top2}%가 2명에게 몰림` : '최근 4주 · 앱 기록 기준'} />
          <Stat label="업무 과부하" value={over} tone={over ? 'amber' : undefined} sub="가용 시간 110% 초과" />
          <Stat label="평가 근거 충분" value={k.evidenceAll ? `${k.evidenceOk}/${k.evidenceAll}` : '—'} sub="판단 근거 기준 충족" />
        </div>
      </Card>

      <div className="flex items-end gap-2 flex-wrap"><span className="text-sm font-bold text-slate-900">팀원 보드</span><span className="text-xs text-slate-400">챙길 사람부터 · 색은 주의(주황)·위험(빨강)일 때만 · 줄을 누르면 상세</span></div>

      {(m.loading ? <Spinner /> : !members.length
        ? <Card className="p-6 text-sm text-slate-500">팀원을 초대하면 팀원별 카드가 생깁니다. <Link to="/settings?tab=members" className="text-indigo-700 font-semibold">초대하기 →</Link></Card>
        : <MemberTable rows={members.map((mb) => ({ uid: mb.user_id, name: mb.profiles?.full_name ?? '팀원', job: mb.job_title, ix: pi.idx.get(mb.user_id), view: pi.views.get(mb.user_id),
            actions: (pi.actions.out?.content.actions ?? fallback).filter((a) => a.user_id === mb.user_id).length }))} onPraise={(uid, name) => setPraise({ uid, name })} />)}
      {praise && <PraiseModal a={{ user_id: praise.uid, type: 'praise' } as PeopleAction} name={praise.name} onClose={() => setPraise(null)} onSent={() => {}} />}

      <MemoModal teamId={team.id} open={memo.open} preset={memo.who} onClose={() => setMemo({ open: false, who: null })} />
      <ScheduleModal open={oo.open} onClose={() => { setOo({ open: false, who: null }); if (params.get('new') || params.get('tab')) setParams({}, { replace: true }); }} memberId={oo.who} />
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
export function IndexGrid({ ix, cols = 3 }: { ix?: MemberIndex; cols?: 3 | 6 | 7 }) {
  if (!ix) return null;
  return (
    <dl className={cx('grid gap-1.5', cols === 3 ? 'grid-cols-4' : 'grid-cols-4 md:grid-cols-7')}>
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

const WORK: Record<string, { label: string; cls: string }> = { good: { label: '순항', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' }, watch: { label: '주의', cls: 'bg-amber-50 text-amber-800 ring-amber-200' }, support: { label: '지원 필요', cls: 'bg-rose-50 text-rose-700 ring-rose-200' } };
type Row = { uid: string; name: string; job: string; ix?: MemberIndex; view?: MemberView; actions: number };
type Group = 'care' | 'watch' | 'ok';
const GROUP: Record<Group, { label: string; dot: string; ring: string }> = {
  care: { label: '지금 챙길 사람', dot: 'bg-rose-500', ring: 'ring-rose-400' },
  watch: { label: '지켜볼 사람', dot: 'bg-amber-400', ring: 'ring-amber-400' },
  ok: { label: '순항', dot: 'bg-emerald-500', ring: 'ring-emerald-400' },
};
/** 묶는 기준: 이탈 위험 · 업무 지원 필요 · 위험 지표 2개 이상 → 챙길 사람 / 주의 신호 하나라도 → 지켜볼 사람 / 그 외 순항 */
function groupOf(r: Row): Group {
  const lv = (r.ix?.indices ?? []).map((i) => i.level);
  if (r.ix?.flight.level === 'risk' || r.view?.work_status === 'support' || lv.filter((l) => l === 'risk').length >= 2) return 'care';
  if (lv.some((l) => l === 'risk' || l === 'watch') || r.view?.work_status === 'watch') return 'watch';
  return 'ok';
}
const sev = (r: Row) => (r.ix?.indices ?? []).reduce((a, i) => a + (i.level === 'risk' ? 3 : i.level === 'watch' ? 1 : 0), 0) + (r.ix?.flight.score ?? 0) / 100;
const CELL: Record<Level, string> = { risk: 'text-rose-600', watch: 'text-amber-700', good: 'text-slate-800', none: 'text-slate-300' };

/** 팀원 보드 — 한 사람 한 줄, 같은 지표를 세로로 맞춰 사람끼리 비교 */
function MemberTable({ rows, onPraise }: { rows: Row[]; onPraise: (uid: string, name: string) => void }) {
  const nav = useNavigate();
  const cols = rows.find((r) => r.ix)?.ix?.indices.map((i) => ({ key: i.key, label: i.label === '이탈 가능성' ? '이탈' : i.label === '업무 부하' ? '부하' : i.label === '평가 근거' ? '근거' : i.label })) ?? [];
  const groups = (['care', 'watch', 'ok'] as Group[]).map((g) => ({ g, list: rows.filter((r) => groupOf(r) === g).sort((a, b) => sev(b) - sev(a)) })).filter((x) => x.list.length);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[980px]">
        <thead>
          <tr className="text-[11px] text-slate-400 bg-slate-50/80">
            <th className="text-left font-semibold pl-4 py-2.5">팀원</th>
            <th className="text-left font-semibold px-2">업무</th>
            {cols.map((c) => <th key={c.key} className="font-semibold px-2 whitespace-nowrap">{c.label}</th>)}
            <th className="text-left font-semibold px-3">AI 업무 판단</th>
            <th className="text-right font-semibold pr-4">이번 주</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ g, list }) => [
            <tr key={`g-${g}`}><td colSpan={cols.length + 4} className="px-4 pt-4 pb-1.5">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600"><span className={cx('w-2 h-2 rounded-full', GROUP[g].dot)} />{GROUP[g].label}<span className="font-normal text-slate-400">{list.length}명</span></span></td></tr>,
            ...list.map((r) => (
              <tr key={r.uid} onClick={() => nav(`/people/${r.uid}`)} className="border-t border-slate-100 hover:bg-slate-50/70 cursor-pointer">
                <td className="pl-4 pr-2 py-3">
                  <Link to={`/people/${r.uid}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2.5 min-w-0">
                    <span className={cx('rounded-full ring-2 ring-offset-2 shrink-0', GROUP[g].ring)}><Avatar name={r.name} size={9} /></span>
                    <span className="min-w-0"><span className="block font-semibold text-[14px] truncate hover:text-teal-700">{r.name}</span><span className="block text-[11px] text-slate-500 truncate">{r.job || '직무 미입력'}</span></span>
                  </Link>
                </td>
                <td className="px-2 py-3">{r.view ? <span className={cx('text-[11px] font-semibold rounded-full px-2 py-0.5 ring-1 whitespace-nowrap', WORK[r.view.work_status]?.cls)}>업무 {WORK[r.view.work_status]?.label}</span> : <span className="text-[11px] text-slate-300">—</span>}</td>
                {cols.map((c) => {
                  const i = r.ix?.indices.find((x) => x.key === c.key);
                  return (
                    <td key={c.key} className="px-2 py-3 text-center" title={i ? `${i.label} ${i.value}${i.sub ? ` · ${i.sub}` : ''}` : undefined}>
                      {i ? <span className={cx('inline-flex items-center gap-1 text-[13px] font-semibold num whitespace-nowrap', CELL[i.level])}>
                        {(i.level === 'risk' || i.level === 'watch') && <span className={cx('w-1.5 h-1.5 rounded-full', i.level === 'risk' ? 'bg-rose-500' : 'bg-amber-400')} />}{i.value}</span> : <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-xs text-slate-600 leading-snug max-w-[320px]">
                  {r.view?.work_view ? <span className="line-clamp-2"><AiChip label="AI" className="mr-1" />{strip(r.view.work_view)}</span> : <span className="text-slate-400 line-clamp-2">{r.ix?.flight.note ?? ''}</span>}
                </td>
                <td className="pr-4 py-3 text-right whitespace-nowrap">
                  <button onClick={(e) => { e.stopPropagation(); onPraise(r.uid, r.name); }}
                    className="text-xs font-semibold rounded-lg bg-amber-50 text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100 px-2.5 py-1.5 inline-flex items-center gap-1"><Award size={13} />칭찬 배지</button>
                  {r.actions > 0 && <div className="mt-1 text-[10px] font-semibold text-violet-700">이번 주 액션 {r.actions}</div>}
                </td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </Card>
  );
}

export function Delta({ d }: { d: number }) {
  const r = Math.round(d * 10) / 10;
  if (Math.abs(r) < 0.1) return <span className="text-slate-400">변화 없음</span>;
  return r > 0 ? <span className="text-emerald-700 inline-flex items-center"><ArrowUpRight size={10} />{r}</span> : <span className="text-rose-600 inline-flex items-center"><ArrowDownRight size={10} />{Math.abs(r)}</span>;
}

