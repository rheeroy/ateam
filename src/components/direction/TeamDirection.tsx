// 팀 방향 — 팀원 업무플랫폼 고정 탭 [📌 팀 방향] 의 본문 · 매니징 보드 '팀장님 주요 지침' 카드
//   카드 대신 한 장짜리 문서: 묶음 제목 아래 번호 붙은 문장 (굵은 한 줄 = 핵심, 회색 한 줄 = 이유, 오른쪽 = 출처 · 날짜)
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Pin } from 'lucide-react';
import { useTeam } from '../../state/session';
import { allItems, useTeamDirection, type DirectionContent, type DirectionItem } from '../../lib/direction';
import { cx, fmtShort } from '../../lib/format';
import { Spinner } from '../ui';

const SEEN = (t: string) => `ateam.direction.seen.${t}`;
/** 팀 방향 탭 배지: 마지막으로 본 뒤 새로 정리됐으면 NEW 항목 수 */
export function useDirectionBadge() {
  const { team } = useTeam();
  const d = useTeamDirection(team.id, { refresh: false });
  const c = d.data?.content;
  let seen = '';
  try { seen = localStorage.getItem(SEEN(team.id)) ?? ''; } catch { /* 저장소 없음 */ }
  if (!c?.generated_at || seen >= c.generated_at) return 0;
  return allItems(c).filter((i) => i.new).length;
}
const markSeen = (teamId: string, at?: string) => { try { if (at) localStorage.setItem(SEEN(teamId), at); } catch { /* 저장소 없음 */ } };

function Meta({ i }: { i: DirectionItem }) {
  return (
    <div className="text-[11px] text-slate-400 text-right leading-relaxed shrink-0 w-[150px] hidden sm:block">
      <div className="flex justify-end gap-1">
        {i.new && <span className="rounded-full bg-amber-100 text-amber-700 font-bold px-1.5 py-px">NEW</span>}
        {(i.repeat ?? 1) >= 2 && <span className="rounded-full bg-indigo-50 text-indigo-700 font-bold px-1.5 py-px">자주 강조 ×{i.repeat}</span>}
      </div>
      <div className="mt-0.5">{[i.source, i.date ? fmtShort(i.date) : ''].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

export function TeamDirection() {
  const { team } = useTeam();
  const d = useTeamDirection(team.id);
  const c: DirectionContent | undefined = d.data?.content;
  const running = d.data?.status === 'running';
  useEffect(() => { markSeen(team.id, c?.generated_at); }, [team.id, c?.generated_at]);
  if (d.isLoading) return <Spinner />;
  if (d.isError) return <p className="text-sm text-slate-500 py-8 text-center">팀 방향을 쓰려면 DB 업데이트(36_workspace_plus.sql)가 필요합니다.</p>;
  if (!c?.sections?.length) return (
    <div className="py-14 text-center text-sm text-slate-500">
      {running || !d.data ? <><Spinner /><p className="mt-2">ATEAM이 팀 목표와 팀장님이 반복해서 강조한 기준을 정리하고 있어요. 잠시만 기다려 주세요.</p></>
        : <p>아직 정리할 기록이 거의 없어요. 억지로 채우지 않고, 팀 목표와 결과물 의견이 쌓이면 여기에 정리됩니다.</p>}
    </div>
  );
  let n = 0;
  return (
    <div className="max-w-[860px] pb-16">
      <div className="flex items-baseline gap-2.5 flex-wrap">
        <h2 className="text-[17px] font-bold text-slate-900">{c.title || '우리 팀이 지금 중요하게 보는 것'}</h2>
        <span className="text-xs text-slate-400">{c.generated_at ? `${fmtShort(c.generated_at)} 정리` : ''} · 팀 목표와 팀장님이 2번 이상 강조한 기준만 ATEAM이 정리 · 매주 새로 정리됩니다{running ? ' · 지금 다시 정리하는 중' : ''}</span>
      </div>
      {c.sections.map((s) => (
        <section key={s.key} className="mt-6">
          <div className="flex items-baseline gap-2.5 pb-1.5 border-b border-slate-200">
            <b className="text-[13px] text-indigo-700">{s.title}</b>{s.sub && <span className="text-xs text-slate-400">{s.sub}</span>}
          </div>
          {s.items.map((i) => (
            <div key={`${s.key}-${i.text}`} className="flex gap-3 py-3 border-b border-dashed border-slate-200">
              <span className="w-6 shrink-0 text-[15px] font-extrabold text-slate-300 num">{++n}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] font-bold text-slate-900 leading-snug">{i.text}</div>
                {i.why && <div className="mt-1 text-[13px] text-slate-500 leading-relaxed">{i.why}</div>}
              </div>
              <Meta i={i} />
            </div>
          ))}
        </section>
      ))}
      {!c.sections.some((s) => s.key === 'ways') && (
        <p className="mt-6 text-[13px] text-slate-500 bg-slate-50 rounded-lg px-3.5 py-3">팀장님이 일하는 방식은 아직 기록이 적어 정리하지 않았어요. 결과물 의견이 더 쌓이면 여기에 나옵니다.</p>
      )}
    </div>
  );
}

/** 매니징 보드 — 팀장님 주요 지침 3줄 (팀 방향 앞부분) */
export function DirectionCard() {
  const { team } = useTeam();
  const d = useTeamDirection(team.id);
  const c = d.data?.content;
  const top = allItems(c).sort((a, b) => Number(!!b.new) - Number(!!a.new) || (b.repeat ?? 1) - (a.repeat ?? 1)).slice(0, 3);
  return (
    <div className="rounded-2xl bg-white ring-1 ring-slate-200 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <Pin size={14} className="text-indigo-600" />
        <b className="text-sm">팀장님 주요 지침</b>
        {c?.generated_at && <span className="text-[11px] text-slate-400">{fmtShort(c.generated_at)} 정리</span>}
        <Link to="/my/submissions?t=direction" className="ml-auto text-xs font-bold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-0.5">팀 방향 전체 보기<ArrowRight size={12} /></Link>
      </div>
      {d.isLoading ? <div className="py-3"><Spinner /></div> : !top.length ? (
        <p className="mt-2 text-[13px] text-slate-500">{d.data?.status === 'running' || !d.data ? 'ATEAM이 팀 방향을 정리하고 있어요.' : '아직 정리된 지침이 없어요.'}</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {top.map((i, k) => (
            <li key={k} className="flex gap-2 text-[13.5px] leading-snug">
              <span className="text-slate-400 font-bold num w-4 shrink-0">{k + 1}.</span>
              <span className="min-w-0"><b className="text-slate-800">{i.text}</b>
                {i.new ? <span className="ml-1.5 text-[10px] rounded-full bg-amber-100 text-amber-700 font-bold px-1.5 py-px align-[1px]">NEW</span>
                  : (i.repeat ?? 1) >= 2 ? <span className={cx('ml-1.5 text-[11px] text-slate-400')}>· 자주 강조</span> : null}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
