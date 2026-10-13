// 업무플랫폼 › 팀원 스페이스 — 한 사람의 맡은 일 · 결과물(AI 1차 검토) · 최근 한 일 · 피드백과 소통을 한곳에서
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, MessageSquareText, Send, Target, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { buildTree, STATUS_META, useItems } from '../lib/items';
import { isOpenSub, latestAt, useSubmissionsAi } from '../lib/work';
import { useCheckins } from '../lib/people';
import { cx, fmtDate, fmtShort } from '../lib/format';
import { Avatar, Card, Pill, Spinner } from '../components/ui';
import { PlanBar } from '../components/goals/PlanBar';
import { RequestModal } from '../components/RequestModal';
import { WorkSummary } from '../components/people/WorkSummary';
import { ListHead, Row } from './Reviews';

type F = 'open' | 'all';

export default function WorkSpace() {
  const { id } = useParams();
  const { team, members } = useTeam();
  const mb = members.find((x) => x.user_id === id);
  const [req, setReq] = useState(false);
  if (!mb || !id) return <Navigate to="/work" replace />;
  const name = mb.profiles?.full_name ?? '팀원';
  return (
    <div className="space-y-5">
      <div>
        <Link to="/work" className="text-sm text-slate-500 hover:text-indigo-700 inline-flex items-center gap-1"><ArrowLeft size={14} />업무플랫폼</Link>
        <div className="mt-2 flex items-end justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Avatar name={name} size={9} />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{name} <span className="text-base font-medium text-slate-400">업무 스페이스</span></h1>
              <p className="text-sm text-slate-500">{mb.job_title || '직무 미입력'} · 맡은 일, 올린 자료, 피드백이 여기 한곳에 쌓입니다</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/people/${id}`} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Users size={15} />팀원관리</Link>
            <button onClick={() => setReq(true)} className="text-sm rounded-xl px-3 py-2 bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5"><Send size={15} />요청 · 자료 요청</button>
          </div>
        </div>
      </div>

      <WorkSummary uid={id} />

      <Outputs teamId={team.id} uid={id} />

      <div className="grid lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-4">
          <Items teamId={team.id} uid={id} />
        </div>
        <div className="space-y-4">
          <Recent teamId={team.id} uid={id} />
          <Talk teamId={team.id} uid={id} />
        </div>
      </div>
      <RequestModal open={req} onClose={() => setReq(false)} toId={id} defaultKind="share" />
    </div>
  );
}

function Outputs({ teamId, uid }: { teamId: string; uid: string }) {
  const subs = useSubmissionsAi(teamId, { authorId: uid });
  const items = useItems(teamId);
  const { byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  const [pick, setF] = useState<F | null>(null);
  const all = subs.data ?? [];
  const f: F = pick ?? (all.some(isOpenSub) ? 'open' : 'all');
  const rows = all.filter((s) => f === 'all' || isOpenSub(s)).sort((a, b) => latestAt(b).localeCompare(latestAt(a)));
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <span className="font-semibold text-sm">올린 결과물</span>
        <div className="ml-auto flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
          {([['open', `열린 업무 ${all.filter(isOpenSub).length}`], ['all', `전체 ${all.length}`]] as [F, string][]).map(([k, l]) => (
            <button key={k} onClick={() => setF(k)} className={cx('px-2 py-1 rounded-md', f === k ? 'bg-white shadow-sm font-semibold' : 'text-slate-600')}>{l}</button>
          ))}
        </div>
      </div>
      {subs.isLoading ? <Spinner /> : !rows.length ? <p className="px-4 py-5 text-sm text-slate-400">{f === 'open' ? '열린 업무가 없습니다.' : '올린 결과물이 없습니다.'}</p>
        : <><ListHead />{rows.map((s, i) => <Row key={s.id} s={s} byId={byId} no={i + 1} />)}</>}
    </Card>
  );
}

function Items({ teamId, uid }: { teamId: string; uid: string }) {
  const items = useItems(teamId);
  const { byId } = useMemo(() => buildTree((items.data ?? []).filter((x) => x.status !== 'dropped')), [items.data]);
  const mine = [...byId.values()].filter((n) => n.owner_id === uid && n.status !== 'done');
  const done = [...byId.values()].filter((n) => n.owner_id === uid && n.status === 'done').length;
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2"><Target size={15} className="text-indigo-600" /><span className="font-semibold text-sm">맡은 목표·과제</span>
        <span className="ml-auto text-xs text-slate-400">완료 {done}건</span><Link to="/goals" className="text-xs text-indigo-700 font-semibold">팀목표 →</Link></div>
      {items.isLoading ? <Spinner /> : !mine.length ? <p className="px-4 py-4 text-sm text-slate-400">진행 중인 담당 항목이 없습니다.</p> : (
        <ul className="divide-y divide-slate-100">
          {mine.map((n) => {
            const root = n.path.length ? byId.get(n.path[0]) : null;
            return (
              <li key={n.id} className="px-4 py-2.5 grid grid-cols-5 gap-3 items-center">
                <Link to={`/goals?item=${n.id}`} className="col-span-3 min-w-0 group">
                  <span className="block text-sm truncate group-hover:text-indigo-700">{n.title}</span>
                  <span className="block text-[11px] text-slate-400 truncate">{root ? `${root.title} › ` : '목표 · '}{n.due_date ? `~${fmtShort(n.due_date)}` : '기한 없음'}</span>
                </Link>
                <div className="col-span-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">{n.measure === 'recurring' ? <span className="text-xs text-slate-400">정기 업무</span> : <PlanBar item={n} compact />}</div>
                  {n.status !== 'active' && <Pill tone={STATUS_META[n.status].tone}>{STATUS_META[n.status].label}</Pill>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
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

/** 피드백·소통 — 결과물 리뷰 코멘트와 목표·과제 코멘트 */
function Talk({ teamId, uid }: { teamId: string; uid: string }) {
  const { nameOf } = useTeam();
  const subs = useSubmissionsAi(teamId, { authorId: uid });
  const items = useItems(teamId);
  const subIds = (subs.data ?? []).map((s) => s.id);
  const itemIds = (items.data ?? []).filter((n) => n.owner_id === uid).map((n) => n.id);
  const since = new Date(Date.now() - 45 * 86400000).toISOString();
  const feed = useQuery({
    queryKey: ['talk', teamId, uid, subIds.length, itemIds.length], enabled: !subs.isLoading && !items.isLoading,
    queryFn: async () => {
      const [rc, ic] = await Promise.all([
        subIds.length ? q<{ id: string; submission_id: string; author_id: string; body: string; section_ref: string | null; created_at: string }[]>(supabase.from('review_comments').select('id, submission_id, author_id, body, section_ref, created_at').in('submission_id', subIds).gte('created_at', since).order('created_at', { ascending: false }).limit(20)) : Promise.resolve([]),
        itemIds.length ? q<{ id: string; item_id: string; author_id: string; body: string; kind: string; created_at: string }[]>(supabase.from('work_item_comments').select('id, item_id, author_id, body, kind, created_at').in('item_id', itemIds).gte('created_at', since).order('created_at', { ascending: false }).limit(20)) : Promise.resolve([]),
      ]);
      return [
        ...rc.map((c) => ({ id: c.id, who: c.author_id, body: c.body, at: c.created_at, where: (subs.data ?? []).find((s) => s.id === c.submission_id)?.title ?? '결과물', to: `/work/${c.submission_id}`, tag: c.section_ref })),
        ...ic.map((c) => ({ id: c.id, who: c.author_id, body: c.body || (c.kind === 'approve' ? '승인했습니다' : ''), at: c.created_at, where: (items.data ?? []).find((n) => n.id === c.item_id)?.title ?? '항목', to: `/goals?item=${c.item_id}`, tag: null })),
      ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
    },
  });
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm flex items-center gap-2"><MessageSquareText size={15} className="text-sky-600" />피드백 · 소통 <span className="text-xs font-normal text-slate-400">최근 45일</span></div>
      {feed.isLoading ? <Spinner /> : !feed.data?.length ? <p className="px-4 py-4 text-sm text-slate-400">주고받은 피드백이 없습니다.</p> : (
        <ul className="divide-y divide-slate-100">{feed.data.map((f) => (
          <li key={f.id}><Link to={f.to} className="px-4 py-2.5 block hover:bg-slate-50">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><Avatar name={nameOf(f.who)} size={7} /><span className="font-semibold text-slate-700">{nameOf(f.who)}</span>· {fmtDate(f.at)}<ChevronRight size={11} className="ml-auto" /></div>
            <p className="mt-1 text-sm leading-snug line-clamp-2">{f.body}</p>
            <p className="text-[11px] text-slate-400 truncate">{f.where}{f.tag && ` · ${f.tag}`}</p>
          </Link></li>
        ))}</ul>
      )}
    </Card>
  );
}
