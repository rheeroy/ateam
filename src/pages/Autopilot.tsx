// ATEAM AI의 제안 — AUTOPILOT 결과. 핵심 질문 7개에 대한 진단 · 시뮬레이션 · 바로 보낼 액션
//   ?run=<id> 가 없으면 가장 최근 실행을 보여 주고, 실행한 적이 없으면 시작 안내를 보여 준다
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, History, Settings2 } from 'lucide-react';
import { useTeam } from '../state/session';
import { cx, fmtDate } from '../lib/format';
import {
  AP_EVENT, AP_TYPES, KEY_QUESTIONS, LINKS, MODE_LABEL, stripTags, useApAct, useApQuota, useApRun, useApRuns,
  type ApAction, type ApActState, type ApOutput, type ApRun, type ApSection, type ApTodo,
} from '../lib/autopilot';
import { Avatar, Card, Spinner, inputCls } from '../components/ui';
import { AutopilotDial } from '../components/autopilot/Dial';
import { AutopilotSettings } from '../components/autopilot/Settings';

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
const openPilot = () => window.dispatchEvent(new Event(AP_EVENT));

export default function Autopilot() {
  const { team } = useTeam();
  const [params, setParams] = useSearchParams();
  const runs = useApRuns(team.id);
  const quota = useApQuota(team.id);
  const [settings, setSettings] = useState(false);
  const [hist, setHist] = useState(false);
  const latest = runs.data?.find((r) => r.status === 'done');
  const runId = params.get('run') ?? latest?.id ?? null;
  const run = useApRun(runId);

  if (runs.isLoading) return <Spinner />;
  if (runs.error) return <Card className="p-6 text-sm text-slate-600">AUTOPILOT을 쓰려면 DB 업데이트(35_autopilot.sql)가 필요합니다.</Card>;
  const r = run.data;
  return (
    <div className="-mx-4 md:-mx-8 -mt-6 md:-mt-8">
      <Head run={r ?? null} quotaText={quota.data ? `${quota.data.trial ? '체험 기간' : '이번 달'} 남은 횟수 ${quota.data.remaining}/${quota.data.limit}` : ''}
        onSettings={() => setSettings(true)} onHistory={() => setHist((x) => !x)} hasHistory={(runs.data?.length ?? 0) > 1} />
      <div className="px-4 md:px-8 pt-5 pb-28 max-w-[1100px] space-y-4">
        {hist && (
          <Card className="p-3">
            <div className="text-xs font-bold text-slate-500 px-1 pb-2">지난 실행</div>
            <ul className="divide-y divide-slate-100">
              {(runs.data ?? []).map((x) => {
                const sent = Object.values(x.actions ?? {}).filter((a) => a.status === 'sent').length;
                return (
                  <li key={x.id}><button onClick={() => { setParams({ run: x.id }); setHist(false); }} className={cx('w-full text-left px-2 py-2 rounded-lg text-sm flex items-center gap-3 hover:bg-slate-50', x.id === runId && 'bg-violet-50')}>
                    <span className="font-semibold num">{fmtDate(x.created_at)} {fmtTime(x.created_at)}</span>
                    <span className="text-xs text-slate-500">{MODE_LABEL[x.mode]}</span>
                    <span className="ml-auto text-xs text-slate-500">{x.status === 'done' ? `보냄 ${sent}` : x.status === 'running' ? '진행 중' : '실패'}</span>
                  </button></li>
                );
              })}
            </ul>
          </Card>
        )}
        {!runId ? <Empty /> : run.isError ? <Card className="p-6 text-sm text-slate-600">이 실행 결과를 열 수 없습니다.</Card> : !r ? <Spinner /> : r.status === 'running' ? <Card className="p-8 text-center text-sm text-slate-500">AUTOPILOT이 진행 중입니다. 화면 아래 로딩 바가 끝나면 결과가 열립니다.</Card>
          : r.status === 'failed' || !r.output ? <Card className="p-6 text-sm text-slate-600">이 실행은 마치지 못했습니다. {r.error ?? ''}</Card>
          : <Result run={r} out={r.output} />}
      </div>
      <AutopilotSettings open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

function Head({ run, quotaText, onSettings, onHistory, hasHistory }: { run: ApRun | null; quotaText: string; onSettings: () => void; onHistory: () => void; hasHistory: boolean }) {
  const acts = run?.output?.actions ?? [];
  const st = run?.actions ?? {};
  const sent = acts.filter((a) => st[a.key]?.status === 'sent').length;
  const wait = acts.filter((a) => !st[a.key]).length;
  const todos = run?.output ? [...Object.values(run.output.sections).flatMap((s) => s.todos ?? []), ...(run.output.forecast.todos ?? [])].length : 0;
  return (
    <div className="bg-gradient-to-r from-[#0B0E1A] via-[#1E1B4B] to-[#2E1F7A] text-white">
      <div className="px-4 md:px-8 pt-6 pb-6 max-w-[1100px]">
        <div className="flex items-center gap-4 flex-wrap">
          <AutopilotDial size={54} />
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5"><span className="ap-font text-xl">AUTOPILOT</span><span className="ap-on text-base text-violet-400">ON</span></div>
            <div className="text-[12.5px] text-indigo-200 mt-1">ATEAM AI의 제안 · {run ? `${fmtDate(run.created_at)} ${fmtTime(run.created_at)} 실행` : '아직 실행하지 않았습니다'}{quotaText ? ` · ${quotaText}` : ''}</div>
          </div>
          <div className="ml-auto flex gap-2">
            {hasHistory && <button onClick={onHistory} className="text-[13px] rounded-xl px-3 py-2 ring-1 ring-white/20 hover:bg-white/10 inline-flex items-center gap-1.5"><History size={14} />지난 실행</button>}
            <button onClick={onSettings} className="text-[13px] rounded-xl px-3 py-2 ring-1 ring-white/20 hover:bg-white/10 inline-flex items-center gap-1.5"><Settings2 size={14} />설정</button>
            <button onClick={openPilot} className="text-[13px] font-bold rounded-xl px-3.5 py-2 bg-white text-indigo-900 hover:bg-indigo-50">다시 실행</button>
          </div>
        </div>
        {run?.output && (
          <>
            {run.output.headline && <p className="mt-4 text-[15px] font-semibold leading-relaxed">{stripTags(run.output.headline)}</p>}
            <div className="mt-4 flex gap-2.5 flex-wrap">
              {[['실행 모드', MODE_LABEL[run.mode]], ['바로 보냄', sent], ['확인 대기', wait], ['팀장님 할 일', todos], ['진단한 신호', run.output.counts?.signals ?? '—']].map(([k, v], i) => (
                <div key={String(k)} className={cx('rounded-xl px-3.5 py-2.5 min-w-[110px] ring-1', i === 0 ? 'ring-white/40 bg-white/10' : 'ring-white/15 bg-white/[.06]')}>
                  <div className="text-[11px] text-indigo-200">{k}</div><div className={cx('font-extrabold num mt-0.5', i === 0 ? 'text-[15px]' : 'text-[22px]')}>{v}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <Card className="p-8 text-center">
      <AutopilotDial size={96} />
      <h2 className="mt-4 text-lg font-extrabold">버튼 한 번으로 팀을 진단하고, 바로 보낼 액션까지 준비합니다</h2>
      <p className="mt-2 text-sm text-slate-500 leading-relaxed">화면 오른쪽 아래 AUTOPILOT 버튼을 누르면 팀 데이터를 한 번에 읽고 핵심 질문 7개에 답합니다.</p>
      <ol className="mt-4 inline-flex flex-col items-start gap-1 text-sm text-slate-700">{KEY_QUESTIONS.map((k, i) => <li key={k}><b className="text-violet-600 mr-2">{i + 1}</b>{k}</li>)}</ol>
      <div className="mt-5"><button onClick={openPilot} className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-extrabold text-sm"><span className="ap-font text-[11px]">AUTOPILOT</span>실행하기</button></div>
    </Card>
  );
}

const SECS: { k: keyof ApOutput['sections']; no: number }[] = [{ k: 'critical', no: 1 }, { k: 'bottleneck', no: 2 }, { k: 'resource', no: 3 }];
function Result({ run, out }: { run: ApRun; out: ApOutput }) {
  const byKey = new Map(out.actions.map((a) => [a.key, a]));
  const acts = (s: ApSection) => s.action_keys.map((k) => byKey.get(k)).filter(Boolean) as ApAction[];
  return (
    <>
      {SECS.map(({ k, no }) => <Sec key={k} no={no} title={KEY_QUESTIONS[no - 1]} kind="진단"><Diagnosis s={out.sections[k]} /><Acts run={run} list={acts(out.sections[k])} /><Todos list={out.sections[k].todos} /></Sec>)}
      <Sec no={4} title="이대로 가면 이번 분기 목표 달성은 어떻게 될까?" kind="시뮬레이션" tone="f"><Forecast f={out.forecast} /></Sec>
      <Sec no={5} title="사람관리에서 내가 놓치거나 챙기면 좋은 것들은?" kind="진단"><Diagnosis s={out.sections.people} /><Acts run={run} list={acts(out.sections.people)} /><Todos list={out.sections.people.todos} /></Sec>
      <Sec no={6} title="문제를 해결하거나 성과를 높이기 위해서는 이렇게 해보세요" kind="솔루션" tone="s">
        <div className="space-y-2.5">
          {out.solutions.map((s, i) => (
            <div key={i} className="flex gap-3.5 items-start rounded-xl ring-1 ring-slate-200 px-4 py-3.5">
              <span className="text-xl font-black text-violet-600 w-5 num">{i + 1}</span>
              <div className="flex-1 min-w-0"><div className="text-[14.5px] font-bold leading-snug">{stripTags(s.title)}</div>
                {s.why && <div className="text-[13px] text-slate-500 mt-1 leading-relaxed">{stripTags(s.why)}</div>}
                {s.effect && <div className="text-xs font-bold text-emerald-700 mt-1.5">{stripTags(s.effect)}</div>}</div>
              {s.link && LINKS[s.link] && <Link to={LINKS[s.link]} className="text-[12.5px] font-bold text-indigo-600 inline-flex items-center gap-1 shrink-0">{s.label || '보기'}<ArrowRight size={13} /></Link>}
            </div>
          ))}
        </div>
      </Sec>
      <Sec no={7} title="한 걸음 물러서서, 관점을 다르게 보기" kind="관점" tone="p">
        <div className="rounded-2xl bg-gradient-to-br from-[#0F1330] to-[#1E1B4B] text-indigo-100 px-6 py-5 text-[15px] leading-[1.8]">
          {stripTags(out.perspective?.text) || '이번 실행에서는 따로 짚을 관점이 없습니다.'}
          {out.perspective?.sources && <div className="mt-3 text-xs text-indigo-300">적용한 기준 · {out.perspective.sources}</div>}
        </div>
      </Sec>
    </>
  );
}

function Sec({ no, title, kind, tone = 'd', children }: { no: number; title: string; kind: string; tone?: 'd' | 'f' | 's' | 'p'; children: React.ReactNode }) {
  const cls = { d: 'text-indigo-700 bg-indigo-50', f: 'text-violet-700 bg-violet-50', s: 'text-emerald-700 bg-emerald-50', p: 'text-slate-600 bg-slate-100' }[tone];
  return (
    <section className="rounded-[18px] bg-white ring-1 ring-slate-200 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <span className="w-7 h-7 rounded-lg bg-[#0B0E1A] text-white text-[13px] font-extrabold flex items-center justify-center shrink-0">{no}</span>
        <h2 className="font-extrabold text-base">{title}</h2>
        <span className={cx('ml-auto text-[11px] font-bold rounded-full px-2.5 py-0.5 shrink-0', cls)}>{kind}</span>
      </div>
      <div className="px-5 pt-4 pb-5">{children}</div>
    </section>
  );
}

function Diagnosis({ s }: { s: ApSection }) {
  if (!s.diagnosis.length) return <p className="text-sm text-slate-500">{stripTags(s.note) || '이번엔 특별히 없습니다.'}</p>;
  return (
    <ul className="space-y-2">
      {s.diagnosis.map((d, i) => (
        <li key={i} className="relative pl-4 text-sm leading-relaxed text-slate-800">
          <span className={cx('absolute left-0 top-[9px] w-1.5 h-1.5 rounded-full', d.level === 'high' ? 'bg-rose-500' : 'bg-violet-600')} />
          {stripTags(d.text)}{d.tag && <span className="ml-1.5 align-[1px] whitespace-nowrap text-[11px] text-indigo-600 bg-indigo-50 rounded-md px-1.5 py-px">{d.tag}</span>}
        </li>
      ))}
    </ul>
  );
}

function Todos({ list }: { list: ApTodo[] | undefined }) {
  if (!list?.length) return null;
  return (
    <div className="mt-3 space-y-2">
      {list.map((t, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl ring-1 ring-indigo-100 bg-indigo-50/40 px-3.5 py-2.5">
          <span className="text-[10.5px] font-bold text-indigo-700 bg-indigo-100 rounded-full px-2 py-0.5 shrink-0">팀장님 할 일</span>
          <span className="flex-1 text-[13.5px] text-slate-800 leading-snug">{stripTags(t.text)}</span>
          {t.link && LINKS[t.link] && <Link to={LINKS[t.link]} className="text-[12.5px] font-bold text-indigo-600 inline-flex items-center gap-1 shrink-0">{t.label || '바로 가기'}<ArrowRight size={13} /></Link>}
        </div>
      ))}
    </div>
  );
}

function Acts({ run, list }: { run: ApRun; list: ApAction[] }) {
  if (!list.length) return null;
  return <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">{list.map((a) => <ActCard key={a.key} run={run} a={a} st={run.actions?.[a.key]} />)}</div>;
}

function ActCard({ run, a, st }: { run: ApRun; a: ApAction; st: ApActState | undefined }) {
  const { team, nameOf } = useTeam();
  const { send, undo, mark } = useApAct(run.id, team.id);
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(a.message);
  const T = AP_TYPES[a.type];
  const name = nameOf(a.member_id) || '팀원';
  const canUndo = st?.status === 'sent' && Date.now() - Date.parse(st.at) < 10 * 60000;
  const where = a.submission_title ? `${a.submission_title} · 스레드` : a.item_title ? `${T.to} · ${a.item_title}` : T.to;
  return (
    <div className={cx('rounded-xl ring-1 px-3.5 py-3 flex flex-col gap-2', st?.status === 'sent' ? 'ring-violet-200 bg-violet-50/30' : st?.status === 'skip' ? 'ring-slate-200 opacity-60' : 'ring-slate-200 bg-white')}>
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <Avatar name={name} size={7} /><b className="text-[13px]">{name}</b>
        <span className={cx('text-[10.5px] font-bold rounded-full px-2 py-0.5', T.cls)}>{T.label}</span>
        {a.sensitive && <span className="text-[10.5px] font-bold text-rose-700 bg-rose-50 rounded-md px-1.5 py-0.5">{a.sensitive} · 직접 확인</span>}
      </div>
      {edit && !st ? <textarea rows={3} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} />
        : <div className="text-[13.5px] leading-relaxed text-slate-700 whitespace-pre-wrap">{st?.body ?? a.message}</div>}
      <div className="text-[11px] text-slate-400 truncate">{where}</div>
      <div className="flex items-center gap-1.5 text-xs">
        {st?.status === 'sent' ? (<>
          <span className="font-bold text-violet-700">✓ {a.type === 'memo' ? '기록함' : '보냄'} · {fmtTime(st.at)}{st.auto ? ' · 자동' : ''}</span>
          {canUndo && <button onClick={() => undo.mutate(a.key)} disabled={undo.isPending} className="ml-auto text-slate-400 hover:text-slate-700">되돌리기</button>}
        </>) : st?.status === 'skip' ? (<>
          <span className="text-slate-400">건너뜀</span><button onClick={() => mark.mutate({ key: a.key, status: 'wait' })} className="ml-auto text-slate-400 hover:text-slate-700">다시 보기</button>
        </>) : (<>
          <button onClick={() => send.mutate({ key: a.key, body: edit ? body : undefined }, { onSuccess: () => setEdit(false) })} disabled={send.isPending}
            className="font-bold rounded-lg px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">{a.type === 'memo' ? '기록하기' : '보내기'}</button>
          {!edit && <button onClick={() => setEdit(true)} className="font-bold rounded-lg px-3 py-1.5 ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50">고쳐서 보내기</button>}
          {edit && <button onClick={() => { setEdit(false); setBody(a.message); }} className="rounded-lg px-2 py-1.5 text-slate-500">취소</button>}
          <button onClick={() => mark.mutate({ key: a.key, status: 'skip' })} className="ml-auto text-slate-400 hover:text-slate-700">건너뛰기</button>
        </>)}
      </div>
    </div>
  );
}

function Forecast({ f }: { f: ApOutput['forecast'] }) {
  const bars: [string, 'base' | 'risk' | 'exec', string][] = [['지금 속도', 'base', '#6366F1'], ['리스크 시', 'risk', '#F43F5E'], ['제안 실행 시', 'exec', '#10B981']];
  const lever = f.lever?.goal_id ? f.goals.find((g) => g.goal_id === f.lever!.goal_id) : null;
  return (
    <>
      {!f.goals.length ? <p className="text-sm text-slate-500">진행 중인 올해 목표가 없어 시뮬레이션할 수 없습니다. <Link to="/goals" className="text-indigo-600 font-semibold">팀목표 세우기 →</Link></p> : (
        <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5">
          <div>
            <div className="flex gap-3.5 flex-wrap text-[11px] text-slate-500 mb-3">{bars.map(([l, , c]) => <span key={l} className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}<span className="text-slate-400">분기 말({fmtDate(f.quarter_end)}) 예상 달성률</span></div>
            {f.goals.map((g) => (
              <div key={g.goal_id} className="mb-3.5">
                <div className="flex justify-between gap-3 text-[13.5px] font-bold"><span className="truncate">{g.title}</span><span className="text-xs font-medium text-slate-400 shrink-0">현재 {g.progress}%{g.plan_now != null ? ` · 계획 ${g.plan_now}%` : ''}</span></div>
                {bars.map(([l, k, c]) => (
                  <div key={k} className="flex items-center gap-2 mt-1.5 text-[11.5px] text-slate-600">
                    <span className="w-[72px] shrink-0">{l}</span>
                    <span className="flex-1 h-2.5 rounded bg-slate-100 overflow-hidden"><span className="block h-full rounded" style={{ width: `${g[k]}%`, background: c }} /></span>
                    <span className="w-10 text-right font-extrabold num" style={{ color: c }}>{g[k]}%</span>
                  </div>
                ))}
                {g.note && <div className="text-[11.5px] text-slate-500 mt-1">{stripTags(g.note)}</div>}
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 mb-2">튀어나올 수 있는 리스크 · 가능성 × 영향</div>
            {!f.risks.length ? <p className="text-sm text-slate-500">눈에 띄는 리스크가 없습니다.</p> : (
              <div className="space-y-2">{f.risks.map((r, i) => (
                <div key={i} className="rounded-xl ring-1 ring-slate-200 px-3 py-2.5 text-[13px] leading-snug">
                  <div className="flex items-center gap-1.5 mb-0.5"><span className={cx('text-[10.5px] font-bold rounded px-1.5 py-px', r.likelihood === 'high' ? 'text-rose-700 bg-rose-100' : 'text-amber-700 bg-amber-100')}>가능성 {r.likelihood === 'high' ? '높음' : '중간'}</span><b className="truncate">{stripTags(r.title)}</b>{r.impact && <span className="ml-auto font-extrabold text-rose-600 text-xs shrink-0">{r.impact}</span>}</div>
                  {r.detail && <div className="text-slate-600">{stripTags(r.detail)}</div>}
                </div>
              ))}</div>
            )}
          </div>
        </div>
      )}
      {f.lever?.text && (
        <div className="mt-4 rounded-2xl px-4 py-3.5 bg-gradient-to-r from-indigo-50 to-violet-50 ring-1 ring-violet-200 flex items-center gap-4">
          <div className="min-w-0"><div className="text-[11px] font-extrabold tracking-wider text-violet-600">가장 크게 움직이는 레버</div><div className="text-sm font-semibold text-indigo-950 leading-relaxed">{stripTags(f.lever.text)}</div></div>
          {lever && <div className="ml-auto text-2xl font-black text-indigo-700 num whitespace-nowrap">{lever.base} → {lever.exec}%</div>}
        </div>
      )}
      <Todos list={f.todos} />
      <p className="mt-3 text-xs text-slate-400">지금 속도는 지금까지의 진척 속도를 남은 기간에 그대로 적용한 계산값이고, 리스크 · 제안 실행 시의 변화폭은 Core AI가 근거를 보고 판단한 값입니다.</p>
    </>
  );
}
