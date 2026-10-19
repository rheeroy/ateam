// 업무플랫폼 › 팀원 업무 스페이스 (팀장) — 맨 위 한 줄 요약(펼치면 업무 수행 결과 · 최근 한 일) + 채팅형 스페이스
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, Send, Sparkles, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { useItems } from '../lib/items';
import { useSubmissionsAi } from '../lib/work';
import { useCheckins } from '../lib/people';
import { usePeopleActions } from '../lib/peopleActions';
import { cx, fmtShort } from '../lib/format';
import { Avatar, Card, Spinner } from '../components/ui';
import { RequestModal } from '../components/RequestModal';
import { WorkSummary } from '../components/people/WorkSummary';
import { Space } from '../components/space/Space';

export default function WorkSpace() {
  const { id } = useParams();
  const { members } = useTeam();
  const mb = members.find((x) => x.user_id === id);
  const [req, setReq] = useState(false);
  const [more, setMore] = useState(false);
  if (!mb || !id) return <Navigate to="/work" replace />;
  const name = mb.profiles?.full_name ?? '팀원';
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <Link to="/work" className="text-sm text-slate-500 hover:text-indigo-700 inline-flex items-center gap-1"><ArrowLeft size={14} />업무플랫폼</Link>
          <div className="mt-1 flex items-center gap-2.5">
            <Avatar name={name} size={9} />
            <h1 className="text-2xl font-bold tracking-tight">{name} <span className="text-base font-medium text-slate-400">업무 스페이스</span></h1>
            <span className="text-sm text-slate-500 hidden sm:inline">{mb.job_title || ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link to={`/people/${id}`} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Users size={15} />팀원관리</Link>
          <button onClick={() => setReq(true)} className="text-sm rounded-xl px-3 py-2 bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5"><Send size={15} />요청 보내기</button>
        </div>
      </div>
      <SummaryLine uid={id} open={more} onToggle={() => setMore((x) => !x)} />
      {more && (
        <div className="grid lg:grid-cols-3 gap-3 items-start">
          <div className="lg:col-span-2"><WorkSummary uid={id} /></div>
          <Recent teamId={mb.team_id} uid={id} />
        </div>
      )}
      <Space space={{ kind: 'user', id }} leaderView offset={more ? '14rem' : '15rem'} />
      <RequestModal open={req} onClose={() => setReq(false)} toId={id} defaultKind="share" />
    </div>
  );
}

/** 맨 위 한 줄 요약 — 업무 상태 · AI 종합 판단 · 숫자, 펼치면 자세히 */
const WORK: Record<string, { label: string; cls: string }> = {
  good: { label: '순항', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  watch: { label: '주의', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  support: { label: '지원 필요', cls: 'bg-rose-50 text-rose-700 ring-rose-200' },
};
function SummaryLine({ uid, open, onToggle }: { uid: string; open: boolean; onToggle: () => void }) {
  const { team } = useTeam();
  const pa = usePeopleActions(team.id, team.is_demo);
  const view = pa.out?.content.members?.find((v) => v.user_id === uid);
  const items = useItems(team.id);
  const subs = useSubmissionsAi(team.id, { authorId: uid });
  const mine = (items.data ?? []).filter((n) => n.owner_id === uid && n.parent_id);
  const active = mine.filter((n) => n.status === 'active').length;
  const blocked = mine.filter((n) => n.status === 'blocked').length;
  const wait = (subs.data ?? []).filter((s) => s.status === 'in_review' && s.request_type !== 'share' && !s.closed_at).length;
  return (
    <button onClick={onToggle} className="w-full text-left rounded-xl bg-white ring-1 ring-slate-200 px-4 py-2.5 flex items-center gap-2.5 text-sm hover:ring-slate-300">
      {view && <span className={cx('shrink-0 text-[11px] font-semibold rounded-full ring-1 px-2 py-0.5', WORK[view.work_status]?.cls)}>{WORK[view.work_status]?.label}</span>}
      {view ? <><span className="shrink-0 text-[10px] font-bold text-white bg-violet-600 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5"><Sparkles size={10} />AI</span><span className="text-slate-700 truncate">{view.work_view.replace(/\s*\[E\d+\]/g, '')}</span></>
        : <span className="text-slate-500 truncate">업무 수행 경과 · 맡은 일과 최근 한 일</span>}
      <span className="ml-auto shrink-0 text-xs text-slate-500 num hidden md:inline">진행 {active} · 막힘 {blocked} · 결론 대기 {wait}</span>
      <span className="shrink-0 text-xs font-semibold text-indigo-700 inline-flex items-center gap-0.5">{open ? '접기' : '펼치기'}<ChevronDown size={12} className={open ? 'rotate-180' : ''} /></span>
    </button>
  );
}

/** 최근 한 일 — 주간 체크인 */
function Recent({ teamId, uid }: { teamId: string; uid: string }) {
  const ci = useCheckins(teamId, uid, 8);
  const rows = [...(ci.data ?? [])].reverse().slice(0, 5);
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm">최근 한 일 <span className="text-xs font-normal text-slate-400">주간 체크인</span></div>
      {ci.isLoading ? <Spinner /> : !rows.length ? <p className="px-4 py-4 text-sm text-slate-400">체크인이 없습니다.</p> : (
        <ol className="px-4 py-3 space-y-3 border-l-2 border-slate-100 ml-4">
          {rows.map((c) => (
            <li key={c.id} className="relative pl-3 text-sm">
              <span className="absolute -left-[22px] top-1 w-2.5 h-2.5 rounded-full bg-indigo-400 ring-2 ring-white" />
              <div className="text-[11px] text-slate-400">{fmtShort(c.week_start)} 주</div>
              {c.did && <p className="leading-snug"><b className="text-[11px] text-slate-500 mr-1">한 일</b>{c.did}</p>}
              {c.blocked && <p className="leading-snug text-rose-700"><b className="text-[11px] mr-1">막힘</b>{c.blocked}</p>}
              {c.next && <p className="leading-snug text-slate-600"><b className="text-[11px] text-slate-500 mr-1">다음</b>{c.next}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
