// ATEAM AI의 제안 — AUTOPILOT 결과. 질문별 보고서가 아니라 한눈에 훑고 바로 처리하는 목록
//   한 줄 = 알아야 할 것 + (있으면) 바로 보낼 액션 · 팀장 할 일. 줄마다 관련 핵심 질문이 붙고 질문 순서로 놓인다. 근거·자세한 내용은 접어 둔다
//   ?run=<id> 가 없으면 가장 최근 실행을 보여 주고, 실행한 적이 없으면 시작 안내를 보여 준다
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, History, Settings2 } from 'lucide-react';
import { useTeam } from '../state/session';
import { cx, fmtDate } from '../lib/format';
import {
  AP_EVENT, AP_TYPES, KEY_QUESTIONS, KQ_SHORT, LINKS, MODE_LABEL, itemsOf, stripTags, useApAct, useApQuota, useApRun, useApRuns,
  type ApAction, type ApActState, type ApGoalForecast, type ApItem, type ApOutput, type ApRun,
} from '../lib/autopilot';
import { Avatar, Card, Spinner, inputCls } from '../components/ui';
import { AutopilotDial } from '../components/autopilot/Dial';
import { AutopilotSettings } from '../components/autopilot/Settings';
import { ModeSwitch } from '../components/autopilot/ModeSwitch';

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
  const items = run?.output ? itemsOf(run.output) : [];
  const todos = items.filter((x) => x.todo?.text).length;
  const high = items.filter((x) => x.level === 'high').length;
  return (
    <div className="bg-gradient-to-r from-[#0B0E1A] via-[#1E1B4B] to-[#2E1F7A] text-white">
      <div className="px-4 md:px-8 pt-6 pb-6 max-w-[1100px]">
        <div className="flex items-center gap-4 flex-wrap">
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
        <div className="mt-5 flex flex-col md:flex-row md:items-start gap-4">
          <ModeSwitch runMode={run?.mode} />
          {run?.output && (
            <dl className="md:ml-auto shrink-0 grid grid-cols-4 md:grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl px-3.5 py-2.5 bg-white/[.05] ring-1 ring-white/10 text-[12px] text-indigo-200">
              {[['이번 주 꼭', high], ['보낼 액션', wait], ['바로 보냄', sent], ['할 일', todos]].map(([k, v]) => (
                <div key={String(k)} className="flex items-baseline gap-1.5 whitespace-nowrap"><dt>{k}</dt><dd className="font-extrabold num text-[14px] text-white">{v}</dd></div>
              ))}
            </dl>
          )}
        </div>
        {run?.output?.headline && <p className="mt-4 text-[15px] font-semibold leading-relaxed">{stripTags(run.output.headline)}</p>}
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

function Result({ run, out }: { run: ApRun; out: ApOutput }) {
  const items = itemsOf(out);
  const byKey = new Map(out.actions.map((a) => [a.key, a]));
  const st = run.actions ?? {};
  const [q, setQ] = useState(0);
  const [todoOnly, setTodoOnly] = useState(false);
  const [openAll, setOpenAll] = useState(false);
  const pending = (x: ApItem) => x.action_keys.some((k) => !st[k]) || !!x.todo?.text;
  const shown = items.filter((x) => (!q || x.q === q || x.also.includes(q)) && (!todoOnly || pending(x)));
  const qs = [1, 2, 3, 4, 5, 6, 7].filter((n) => items.some((x) => x.q === n));
  const chip = (on: boolean) => cx('text-[12.5px] rounded-full px-3 py-1.5 ring-1 whitespace-nowrap', on ? 'bg-[#0B0E1A] text-white ring-[#0B0E1A]' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50');
  return (
    <>
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
        <button onClick={() => setQ(0)} className={chip(!q)}>전체 <b className="num">{items.length}</b></button>
        {qs.map((n) => (
          <button key={n} onClick={() => setQ(q === n ? 0 : n)} title={KEY_QUESTIONS[n - 1]} className={chip(q === n)}>
            <b className="num mr-1">{n}</b>{KQ_SHORT[n - 1]} <span className="num opacity-60">{items.filter((x) => x.q === n || x.also.includes(n)).length}</span>
          </button>
        ))}
        <span className="ml-auto" />
        <span className="hidden md:inline-flex shrink-0 items-center gap-2.5 text-[11.5px] text-slate-400 mr-2"><span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-rose-500" />이번 주 꼭</span><span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-violet-400" />보통</span><span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-slate-300" />참고</span></span>
        <label className="shrink-0 inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 cursor-pointer px-1"><input type="checkbox" checked={todoOnly} onChange={(e) => setTodoOnly(e.target.checked)} className="accent-violet-600" />처리할 것만</label>
        <button onClick={() => setOpenAll((x) => !x)} className="shrink-0 text-[12.5px] text-slate-500 hover:text-slate-800 px-2">{openAll ? '모두 접기' : '모두 펼치기'}</button>
      </div>
      <div className="rounded-[18px] bg-white ring-1 ring-slate-200 overflow-hidden">
        {!shown.length ? <p className="px-5 py-8 text-center text-sm text-slate-500">{todoOnly ? '처리할 것이 남아 있지 않습니다.' : '해당하는 항목이 없습니다.'}</p>
          : shown.map((x, i) => (
            <Row key={`${x.id}-${openAll}`} run={run} x={x} acts={x.action_keys.map((k) => byKey.get(k)).filter(Boolean) as ApAction[]} first={i === 0} newGroup={i > 0 && shown[i - 1].q !== x.q} defaultOpen={openAll} quarterEnd={out.forecast.quarter_end} />
          ))}
      </div>
      <p className="text-xs text-slate-400 px-1">분기 전망의 ‘지금 속도’는 지금까지의 진척 속도를 남은 기간에 그대로 적용한 계산값이고, 리스크 · 제안 실행 시의 변화폭은 Core AI가 근거를 보고 판단한 값입니다.</p>
    </>
  );
}

const LEVEL_DOT = { high: 'bg-rose-500', mid: 'bg-violet-400', low: 'bg-slate-300' };

/** 한 줄 — 접힌 상태에서는 제목 · 한 줄 요약 · 오른쪽 버튼 하나만. 근거 · 메시지 원문 · 할 일은 펼치면 */
function Row({ run, x, acts, first, newGroup, defaultOpen, quarterEnd }: { run: ApRun; x: ApItem; acts: ApAction[]; first: boolean; newGroup: boolean; defaultOpen: boolean; quarterEnd: string }) {
  const { team, nameOf } = useTeam();
  const { send } = useApAct(run.id, team.id);
  const [open, setOpen] = useState(defaultOpen);
  const st = run.actions ?? {};
  const waiting = acts.filter((a) => !st[a.key]);
  const sent = acts.filter((a) => st[a.key]?.status === 'sent');
  const todo = x.todo && (x.todo.text || x.todo.link) ? x.todo : null;
  const to = todo?.link ? LINKS[todo.link] : undefined;
  const who = (a: ApAction) => `${nameOf(a.member_id) || '팀원'} · ${AP_TYPES[a.type].label}`;
  // 접힌 줄의 한 줄 요약
  const sub = acts.length ? `${who(acts[0])}${acts.length > 1 ? ` 외 ${acts.length - 1}건` : ''} — ${acts[0].message}`
    : todo?.text ? `직접 · ${stripTags(todo.text)}`
      : x.forecast ? `현재 ${x.forecast.progress}%${x.forecast.plan_now != null ? ` · 계획상 오늘 ${x.forecast.plan_now}%` : ''} · 리스크 시 ${x.forecast.risk}%`
        : stripTags(x.detail);
  const one = waiting.length === 1 && !waiting[0].sensitive ? waiting[0] : null;
  const btn = 'text-[12.5px] font-bold rounded-lg px-3 py-1.5 whitespace-nowrap';
  const cta = one ? <button onClick={() => send.mutate({ key: one.key })} disabled={send.isPending} className={cx(btn, 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50')}>{one.type === 'memo' ? '기록' : '보내기'}</button>
    : waiting.length ? <button onClick={() => setOpen(true)} className={cx(btn, 'ring-1 ring-indigo-200 text-indigo-700 hover:bg-indigo-50')}>{waiting.some((a) => a.sensitive) ? '직접 확인' : `${waiting.length}건 확인`}</button>
      : sent.length ? <span className="text-[12px] font-bold text-violet-600 whitespace-nowrap">✓ {sent.some((a) => st[a.key]?.auto) ? '자동 보냄' : '보냄'}</span>
        : to ? <Link to={to} className={cx(btn, 'ring-1 ring-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1')}>{todo?.label || '바로 가기'}<ArrowRight size={12} /></Link>
          : null;
  return (
    <div className={cx(!first && (newGroup ? 'border-t border-slate-200' : 'border-t border-slate-100'), open && 'bg-slate-50/60')}>
      <div onClick={() => setOpen((v) => !v)} className="group flex items-start sm:items-center gap-3 px-4 sm:px-5 py-3 cursor-pointer hover:bg-slate-50/70">
        <span className={cx('w-2 h-2 rounded-full shrink-0 mt-[7px] sm:mt-0', LEVEL_DOT[x.level])} title={x.level === 'high' ? '이번 주 꼭' : x.level === 'low' ? '참고' : '보통'} />
        <span title={KEY_QUESTIONS[x.q - 1]} className="hidden sm:block w-[78px] shrink-0 text-[12px] text-slate-500"><b className="num text-slate-800 mr-1">{x.q}</b>{KQ_SHORT[x.q - 1]}</span>
        <div className="flex-1 min-w-0">
          <div className="sm:hidden text-[11.5px] text-slate-500 mb-0.5"><b className="num text-slate-800 mr-1">{x.q}</b>{KQ_SHORT[x.q - 1]}</div>
          <div className="text-[14.5px] font-semibold text-slate-900 leading-snug">
            {stripTags(x.title)}
            {x.effect && <span className={cx('ml-2 text-[12px] font-bold whitespace-nowrap', /[−-]\s?\d/.test(x.effect) ? 'text-rose-600' : 'text-emerald-600')}>{stripTags(x.effect)}</span>}
          </div>
          {sub && <div className="mt-0.5 text-[12.5px] text-slate-500 truncate">{sub}</div>}
        </div>
        <div className="shrink-0 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {cta}
          <button onClick={() => setOpen((v) => !v)} aria-label={open ? '접기' : '자세히'} className="p-1 rounded-md text-slate-400 hover:text-slate-700"><ChevronDown size={16} className={cx('transition-transform', open && 'rotate-180')} /></button>
        </div>
      </div>
      {open && (
        <div className="px-4 sm:pl-[130px] sm:pr-[60px] pb-4 -mt-0.5 space-y-3 text-[13px] leading-relaxed text-slate-600">
          {x.forecast && <GoalBars g={x.forecast} quarterEnd={quarterEnd} />}
          {x.detail && <p className={cx('whitespace-pre-wrap', x.q === 7 && 'text-[14px] text-slate-700 leading-[1.8]')}>{stripTags(x.detail)}</p>}
          {(x.tag || x.also.length > 0) && <div className="text-[11.5px] text-slate-400">{[x.tag, ...x.also.map((n) => `관련 질문 ${n} ${KQ_SHORT[n - 1]}`)].filter(Boolean).join(' · ')}</div>}
          {acts.map((a) => <ActRow key={a.key} run={run} a={a} st={st[a.key]} />)}
          {todo && (
            <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
              <span className="text-[11px] font-bold text-slate-500 shrink-0">팀장님 할 일</span>
              <span className="flex-1 min-w-0 text-slate-800">{stripTags(todo.text) || todo.label}</span>
              {to && <Link to={to} className="text-[12.5px] font-bold text-indigo-600 inline-flex items-center gap-1 shrink-0">{todo.label || '바로 가기'}<ArrowRight size={13} /></Link>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActRow({ run, a, st }: { run: ApRun; a: ApAction; st: ApActState | undefined }) {
  const { team, nameOf } = useTeam();
  const { send, undo, mark } = useApAct(run.id, team.id);
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(a.message);
  const T = AP_TYPES[a.type];
  const name = nameOf(a.member_id) || '팀원';
  const canUndo = st?.status === 'sent' && Date.now() - Date.parse(st.at) < 10 * 60000;
  const where = a.submission_title ? `${a.submission_title} · 스레드` : a.item_title ? `${T.to} · ${a.item_title}` : T.to;
  return (
    <div className={cx('rounded-xl px-3 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 ring-1', st?.status === 'sent' ? 'bg-violet-50/50 ring-violet-100' : st?.status === 'skip' ? 'bg-white ring-slate-100 opacity-60' : 'bg-white ring-slate-200')}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <Avatar name={name} size={7} /><b className="text-[13px]">{name}</b>
          <span className={cx('text-[10.5px] font-bold rounded-full px-2 py-0.5', T.cls)}>{T.label}</span>
          {a.sensitive && <span className="text-[10.5px] font-bold text-rose-700 bg-rose-50 rounded-md px-1.5 py-0.5">{a.sensitive} · 직접 확인</span>}
          <span className="text-[11px] text-slate-400 truncate max-w-[260px]">→ {where}</span>
        </div>
        {edit && !st ? <textarea rows={3} autoFocus className={cx(inputCls, 'mt-1.5')} value={body} onChange={(e) => setBody(e.target.value)} />
          : <div className="mt-1 text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap">{st?.body ?? a.message}</div>}
      </div>
      <div className="flex items-center gap-1.5 text-xs shrink-0 sm:pt-0.5">
        {st?.status === 'sent' ? (<>
          <span className="font-bold text-violet-700 whitespace-nowrap">✓ {a.type === 'memo' ? '기록함' : '보냄'} · {fmtTime(st.at)}{st.auto ? ' · 자동' : ''}</span>
          {canUndo && <button onClick={() => undo.mutate(a.key)} disabled={undo.isPending} className="text-slate-400 hover:text-slate-700 px-1">되돌리기</button>}
        </>) : st?.status === 'skip' ? (<>
          <span className="text-slate-400">건너뜀</span><button onClick={() => mark.mutate({ key: a.key, status: 'wait' })} className="text-slate-400 hover:text-slate-700 px-1">다시 보기</button>
        </>) : (<>
          <button onClick={() => send.mutate({ key: a.key, body: edit ? body : undefined }, { onSuccess: () => setEdit(false) })} disabled={send.isPending}
            className="font-bold rounded-lg px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap">{a.type === 'memo' ? '기록' : '보내기'}</button>
          {!edit ? <button onClick={() => setEdit(true)} className="font-bold rounded-lg px-2.5 py-1.5 ring-1 ring-slate-200 bg-white text-slate-600 hover:bg-slate-50">고치기</button>
            : <button onClick={() => { setEdit(false); setBody(a.message); }} className="rounded-lg px-2 py-1.5 text-slate-500">취소</button>}
          <button onClick={() => mark.mutate({ key: a.key, status: 'skip' })} className="text-slate-400 hover:text-slate-700 px-1">건너뛰기</button>
        </>)}
      </div>
    </div>
  );
}

function GoalBars({ g, quarterEnd }: { g: ApGoalForecast; quarterEnd: string }) {
  const bars: [string, 'base' | 'risk' | 'exec', string][] = [['지금 속도', 'base', '#6366F1'], ['리스크 시', 'risk', '#F43F5E'], ['제안 실행 시', 'exec', '#10B981']];
  return (
    <div className="rounded-xl ring-1 ring-slate-200 px-3.5 py-3 max-w-[560px]">
      <div className="text-[11.5px] text-slate-500 mb-1">현재 {g.progress}%{g.plan_now != null ? ` · 계획상 오늘 ${g.plan_now}%` : ''} · 분기 말({fmtDate(quarterEnd)}) 예상</div>
      {bars.map(([l, k, c]) => (
        <div key={k} className="flex items-center gap-2 mt-1.5 text-[11.5px] text-slate-600">
          <span className="w-[72px] shrink-0">{l}</span>
          <span className="flex-1 h-2.5 rounded bg-slate-100 overflow-hidden"><span className="block h-full rounded" style={{ width: `${g[k]}%`, background: c }} /></span>
          <span className="w-10 text-right font-extrabold num" style={{ color: c }}>{g[k]}%</span>
        </div>
      ))}
    </div>
  );
}
