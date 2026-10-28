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
  type ApAction, type ApGoalForecast, type ApItem, type ApOutput, type ApRun, type ApTodo,
} from '../lib/autopilot';
import { Card, Spinner, inputCls } from '../components/ui';
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
            <dl className="md:ml-auto shrink-0 grid grid-cols-3 gap-x-4 gap-y-1.5 rounded-xl px-3.5 py-2.5 bg-white/[.05] ring-1 ring-white/10 text-[12px] text-indigo-200">
              {[['보낼 액션', wait], ['바로 보냄', sent], ['할 일', todos]].map(([k, v]) => (
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

/** 화면의 한 줄 — 팀원에게 보낼 액션 하나 · 팀장님 할 일 하나 · (둘 다 없으면) 알아 둘 것 하나 */
type Line = { key: string; x: ApItem } & ({ kind: 'act'; a: ApAction } | { kind: 'todo'; t: ApTodo } | { kind: 'info' });

function linesOf(items: ApItem[], byKey: Map<string, ApAction>): Line[] {
  return items.flatMap((x) => {
    const acts = x.action_keys.map((k) => byKey.get(k)).filter(Boolean) as ApAction[];
    const L: Line[] = acts.map((a) => ({ key: a.key, x, kind: 'act' as const, a }));
    if (x.todo && (x.todo.text || x.todo.link)) L.push({ key: `${x.id}-todo`, x, kind: 'todo', t: x.todo });
    if (!L.length) L.push({ key: x.id, x, kind: 'info' });
    return L;
  });
}

function Result({ run, out }: { run: ApRun; out: ApOutput }) {
  const items = itemsOf(out);
  const byKey = new Map(out.actions.map((a) => [a.key, a]));
  const st = run.actions ?? {};
  const lines = linesOf(items, byKey);
  const [q, setQ] = useState(0);
  const [todoOnly, setTodoOnly] = useState(false);
  const [openAll, setOpenAll] = useState(false);
  const pending = (l: Line) => (l.kind === 'act' ? st[l.a.key]?.status !== 'sent' : l.kind === 'todo');
  const inQ = (l: Line, n: number) => l.x.q === n || l.x.also.includes(n);
  const shown = lines.filter((l) => (!q || inQ(l, q)) && (!todoOnly || pending(l)));
  const qs = [1, 2, 3, 4, 5, 6, 7].filter((n) => items.some((x) => x.q === n));
  const chip = (on: boolean) => cx('text-[12.5px] rounded-full px-3 py-1.5 ring-1 whitespace-nowrap', on ? 'bg-[#0B0E1A] text-white ring-[#0B0E1A]' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50');
  return (
    <>
      <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
        <button onClick={() => setQ(0)} className={chip(!q)}>전체 <b className="num">{lines.length}</b></button>
        {qs.map((n) => (
          <button key={n} onClick={() => setQ(q === n ? 0 : n)} title={KEY_QUESTIONS[n - 1]} className={chip(q === n)}>
            <b className="num mr-1">{n}</b>{KQ_SHORT[n - 1]} <span className="num opacity-60">{lines.filter((l) => inQ(l, n)).length}</span>
          </button>
        ))}
        <span className="ml-auto" />
        <label className="shrink-0 inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 cursor-pointer px-1"><input type="checkbox" checked={todoOnly} onChange={(e) => setTodoOnly(e.target.checked)} className="accent-violet-600" />처리할 것만</label>
        <button onClick={() => setOpenAll((x) => !x)} className="shrink-0 text-[12.5px] text-slate-500 hover:text-slate-800 px-2">{openAll ? '모두 접기' : '모두 펼치기'}</button>
      </div>
      <div className="rounded-[18px] bg-white ring-1 ring-slate-200 overflow-hidden">
        {!shown.length ? <p className="px-5 py-8 text-center text-sm text-slate-500">{todoOnly ? '처리할 것이 남아 있지 않습니다.' : '해당하는 항목이 없습니다.'}</p>
          : shown.map((l, i) => (
            <Row key={`${l.key}-${openAll}`} run={run} l={l} first={i === 0} newGroup={i > 0 && shown[i - 1].x.q !== l.x.q} defaultOpen={openAll} quarterEnd={out.forecast.quarter_end} />
          ))}
      </div>
      <p className="text-xs text-slate-400 px-1">분기 전망의 ‘지금 속도’는 지금까지의 진척 속도를 남은 기간에 그대로 적용한 계산값이고, 리스크 · 제안 실행 시의 변화폭은 Core AI가 근거를 보고 판단한 값입니다.</p>
    </>
  );
}

const firstSentence = (t: string) => stripTags(t).split(/(?<=[.!?。])\s|\n/)[0] ?? '';

/** 한 줄 — 제목(무엇을) · 한 줄 이유(왜) · 오른쪽 버튼 하나. 펼치면 자세한 설명과 (액션이면) 보낼 메시지 */
function Row({ run, l, first, newGroup, defaultOpen, quarterEnd }: { run: ApRun; l: Line; first: boolean; newGroup: boolean; defaultOpen: boolean; quarterEnd: string }) {
  const { team, nameOf } = useTeam();
  const { send, undo } = useApAct(run.id, team.id);
  const [open, setOpen] = useState(defaultOpen);
  const [edit, setEdit] = useState(false);
  const x = l.x;
  const a = l.kind === 'act' ? l.a : null;
  const st = a ? run.actions?.[a.key] : undefined;
  const sent = st?.status === 'sent';
  const [body, setBody] = useState(a?.message ?? '');
  const to = l.kind === 'todo' && l.t.link ? LINKS[l.t.link] : undefined;

  // 제목 = 무엇을, 이유 = 왜 (액션 · 할 일마다 AI가 쓴 짧은 이유, 없으면 항목 제목)
  const title = a ? `${nameOf(a.member_id) || '팀원'}에게 ${AP_TYPES[a.type].label}` : l.kind === 'todo' ? stripTags(l.t.text) || stripTags(x.title) : stripTags(x.title);
  const why = a ? stripTags(a.why) || stripTags(x.title) : l.kind === 'todo' ? stripTags(l.t.why) || stripTags(x.title) : x.forecast ? `현재 ${x.forecast.progress}%${x.forecast.plan_now != null ? ` · 계획상 오늘 ${x.forecast.plan_now}%` : ''} · 리스크 시 ${x.forecast.risk}%` : firstSentence(x.detail);
  const more = !!(x.detail || x.forecast || a);
  const btn = 'text-[12.5px] font-bold rounded-lg px-3 py-1.5 whitespace-nowrap';
  const canUndo = sent && Date.now() - Date.parse(st!.at) < 10 * 60000;

  const cta = a ? (sent
    ? <span className="inline-flex items-center gap-2 text-[12px]"><b className="text-violet-600 whitespace-nowrap">✓ {a.type === 'memo' ? '기록함' : '보냄'}{st?.auto ? ' · 자동' : ''}</b>{canUndo && <button onClick={() => undo.mutate(a.key)} disabled={undo.isPending} className="text-slate-400 hover:text-slate-700">되돌리기</button>}</span>
    : a.sensitive && !open ? <button onClick={() => setOpen(true)} className={cx(btn, 'ring-1 ring-rose-200 text-rose-700 hover:bg-rose-50')}>확인 후 보내기</button>
      : <button onClick={() => send.mutate({ key: a.key, body: edit ? body : undefined }, { onSuccess: () => setEdit(false) })} disabled={send.isPending} className={cx(btn, 'bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50')}>{a.type === 'memo' ? '기록' : '보내기'}</button>)
    : to ? <ArrowRight size={16} className="text-indigo-500" /> : null;

  const head = (
    <>
      <span title={KEY_QUESTIONS[x.q - 1]} className="hidden sm:block w-[78px] shrink-0 text-[12px] text-slate-500"><b className="num text-slate-800 mr-1">{x.q}</b>{KQ_SHORT[x.q - 1]}</span>
      <div className="flex-1 min-w-0">
        <div className="sm:hidden text-[11.5px] text-slate-500 mb-0.5"><b className="num text-slate-800 mr-1">{x.q}</b>{KQ_SHORT[x.q - 1]}</div>
        <div className="min-w-0 leading-snug">
          <span className={cx('text-[14.5px] font-semibold text-slate-900 leading-snug', to && 'group-hover:text-indigo-700')}>{title}</span>
          {l.kind === 'todo' && <span className="ml-1.5 align-[2px] whitespace-nowrap text-[10.5px] font-bold text-indigo-700 bg-indigo-50 rounded px-1.5 py-0.5">팀장님 할 일</span>}
          {x.effect && l.kind === 'info' && <span className={cx('ml-1.5 whitespace-nowrap text-[12px] font-bold', /[−-]\s?\d/.test(x.effect) ? 'text-rose-600' : 'text-emerald-600')}>{stripTags(x.effect)}</span>}
          {a?.sensitive && <span className="ml-1.5 align-[2px] whitespace-nowrap text-[10.5px] font-bold text-rose-700 bg-rose-50 rounded px-1.5 py-0.5">{a.sensitive}</span>}
        </div>
        {why && <div className="mt-0.5 text-[12.5px] text-slate-500 truncate">{why}</div>}
      </div>
    </>
  );

  return (
    <div className={cx(!first && (newGroup ? 'border-t border-slate-200' : 'border-t border-slate-100'), open && 'bg-slate-50/60')}>
      <div className="flex items-start sm:items-center gap-3 pr-4 sm:pr-5">
        {/* 할 일은 줄 전체를 누르면 해당 화면으로, 나머지는 줄을 누르면 펼침 */}
        {to ? <Link to={to} className="group flex-1 min-w-0 flex items-start sm:items-center gap-3 pl-4 sm:pl-5 py-3 hover:bg-slate-50/70">{head}</Link>
          : <div onClick={() => more && setOpen((v) => !v)} className={cx('flex-1 min-w-0 flex items-start sm:items-center gap-3 pl-4 sm:pl-5 py-3', more && 'cursor-pointer hover:bg-slate-50/70')}>{head}</div>}
        <div className="shrink-0 flex items-center gap-1.5 py-3">
          {cta}
          {more ? <button onClick={() => setOpen((v) => !v)} aria-label={open ? '접기' : '자세히'} className="p-1 rounded-md text-slate-400 hover:text-slate-700"><ChevronDown size={16} className={cx('transition-transform', open && 'rotate-180')} /></button>
            : <span className="w-6" />}
        </div>
      </div>
      {open && (
        <div className="px-4 sm:pl-[110px] sm:pr-[60px] pb-4 -mt-0.5 space-y-3 text-[13px] leading-relaxed text-slate-600">
          {x.forecast && <GoalBars g={x.forecast} quarterEnd={quarterEnd} />}
          {x.detail && <p className={cx('whitespace-pre-wrap', x.q === 7 && 'text-[14px] text-slate-700 leading-[1.8]')}>{stripTags(x.detail)}</p>}
          {a && (
            <div className={cx('rounded-xl ring-1 px-3.5 py-3', sent ? 'bg-violet-50/50 ring-violet-100' : 'bg-white ring-slate-200')}>
              <div className="flex items-center gap-2 text-[11.5px] text-slate-400 mb-1.5">
                <span className="font-bold text-slate-500">{sent ? (a.type === 'memo' ? '기록한 내용' : '보낸 메시지') : a.type === 'memo' ? '기록할 내용' : '보낼 메시지'}</span>
                <span className="truncate">→ {a.submission_title ? `${a.submission_title} · 스레드` : a.item_title ? `${AP_TYPES[a.type].to} · ${a.item_title}` : AP_TYPES[a.type].to}</span>
                {!sent && !edit && <button onClick={() => setEdit(true)} className="ml-auto shrink-0 font-bold text-slate-500 hover:text-slate-800">고치기</button>}
                {edit && <button onClick={() => { setEdit(false); setBody(a.message); }} className="ml-auto shrink-0 text-slate-500">취소</button>}
              </div>
              {edit && !sent ? <textarea rows={3} autoFocus className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} />
                : <div className="text-[13.5px] text-slate-800 whitespace-pre-wrap">{st?.body ?? a.message}</div>}
              {a.sensitive && !sent && <p className="mt-2 text-[11.5px] text-rose-600">{a.sensitive} — 자동으로는 보내지 않았습니다. 내용을 확인하고 보내 주세요.</p>}
            </div>
          )}
          {(x.tag || x.also.length > 0) && <div className="text-[11.5px] text-slate-400">{[x.tag, ...x.also.map((n) => `관련 질문 ${n} ${KQ_SHORT[n - 1]}`)].filter(Boolean).join(' · ')}</div>}
        </div>
      )}
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
