// 상향 관리 › 임원 브리핑 — 보고하는 곳이 아니라, 위를 만나기 전에 미리 챙기는 곳
//   왼쪽: AI 브리핑 (상위 관리자별 물어볼 것 · 챌린지할 것 · 답할 요청 · 먼저 알릴 것)
//   오른쪽: 입력 (상위 관리자 프로필 · 위에서 온 것)
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, ClipboardCopy, Lock, MessageCircleQuestion, Pencil, Plus, RefreshCw, Send, Trash2, UserRound } from 'lucide-react';
import { useTeam } from '../state/session';
import { useGenerate } from '../lib/hooks';
import { cx, fmtDate } from '../lib/format';
import { STYLE_PRESETS, useExecBrief, useExecutives, type ExecBriefOut, type Executive } from '../lib/upward';
import { Button, Card, Field, Modal, Spinner, inputCls, useToast } from '../components/ui';
import { periodRange } from '../components/AiBar';
import { ORG_KIND, OrgNoteModal, OrgNoteRow, dDay, orgStats, useOrgNotes } from '../components/home/shared';

const strip = (t?: string) => (t ?? '').replace(/\s*\[E\d+\]/g, '');

export default function Upward() {
  const { team, hasFeature } = useTeam();
  const ex = useExecutives(team.id);
  const brief = useExecBrief(team.id, team.is_demo);
  const gen = useGenerate('ai-exec-brief', [['ai']]);
  const ai = hasFeature('ai_core');
  const [noteOpen, setNoteOpen] = useState<{ exec: string | null } | null>(null);
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-sm"><UserRound size={20} /></span>
          <div>
            <div className="text-[11px] font-bold tracking-wide text-slate-400">상향 관리</div>
            <h1 className="text-2xl font-bold tracking-tight leading-tight">임원 브리핑</h1>
            <p className="text-sm text-slate-500">위가 이번 주 궁금해하거나 챌린지할 것을 미리 챙깁니다 — 보고는 팀장이 직접 합니다</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setNoteOpen({ exec: null })} className="text-sm rounded-xl px-3 py-2 bg-white ring-1 ring-slate-200 hover:ring-slate-300 inline-flex items-center gap-1.5"><Plus size={15} />위에서 온 것</button>
          {ai && <Button loading={gen.isPending} onClick={() => gen.mutate({ team_id: team.id, force: true })}><RefreshCw size={14} />{brief.out ? '브리핑 다시 만들기' : '브리핑 만들기'}</Button>}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-5 lg:gap-0 items-start">
        <div className="lg:col-span-2 space-y-4 lg:pr-6">
          <div className="flex items-end gap-2"><span className="text-sm font-bold text-slate-900">AI 브리핑</span><span className="text-xs text-slate-400">입력한 데이터와 팀 기록으로 이번 주 위를 미리 봅니다</span></div>
          {!ai ? <Card className="p-6 text-sm text-slate-600 flex items-center gap-2"><Lock size={15} />AI 브리핑은 Pro에서 쓸 수 있습니다. <Link to="/settings?tab=billing" className="text-indigo-700 font-semibold">요금제 보기 →</Link></Card>
            : brief.loading ? <Spinner /> : !brief.out ? <EmptyBrief hasExec={!!ex.list.length} /> : <Brief c={brief.out.content} at={brief.out.created_at} start={brief.out.period_start} stale={!brief.fresh} execs={ex.list} />}
        </div>
        <div className="space-y-4 lg:pl-6 lg:border-l lg:border-slate-200 lg:min-h-[480px] border-t lg:border-t-0 pt-5 lg:pt-0">
          <div className="flex items-end gap-2"><span className="text-sm font-bold text-slate-900">내가 입력한 데이터</span><span className="text-xs text-slate-400">브리핑의 재료</span></div>
          <ExecList teamId={team.id} onNote={(id) => setNoteOpen({ exec: id })} />
          <FromAbove teamId={team.id} execs={ex.list} />
        </div>
      </div>
      <OrgNoteModal teamId={team.id} open={!!noteOpen} execId={noteOpen?.exec ?? null} onClose={() => setNoteOpen(null)} />
    </div>
  );
}

function EmptyBrief({ hasExec }: { hasExec: boolean }) {
  return (
    <Card className="p-6">
      <p className="font-semibold">아직 이번 주 브리핑이 없습니다.</p>
      <p className="mt-1 text-sm text-slate-600 leading-relaxed">'브리핑 만들기'를 누르면 상위 관리자의 성향·관심사와 위에서 내려온 것, 팀의 목표·전망·리스크를 함께 보고
        <b> 이번 주 물어볼 것 · 챌린지할 것 · 답해야 할 요청 · 먼저 알리면 좋은 것</b>을 관리자별로 정리합니다.</p>
      {!hasExec && <p className="mt-3 text-xs rounded-lg bg-amber-50 text-amber-800 px-3 py-2">오른쪽에 상위 관리자를 먼저 등록하면, 그분의 눈으로 본 브리핑이 나옵니다. 등록하지 않으면 '상위 조직장' 한 명 기준으로 씁니다.</p>}
    </Card>
  );
}

function Brief({ c, at, start, stale, execs }: { c: ExecBriefOut; at: string; start: string | null; stale: boolean; execs: Executive[] }) {
  const [pick, setPick] = useState(0);
  const toast = useToast();
  const e = c.execs[Math.min(pick, c.execs.length - 1)];
  const findExec = (id?: string, name?: string) => execs.find((x) => x.id === id) ?? execs.find((x) => x.name === name);
  const prof = findExec(e?.exec_id, e?.name);
  const copy = (t: string) => { navigator.clipboard?.writeText(t); toast('복사했습니다'); };
  return (
    <>

      {/* 관리자 탭 — 박스 밖, 이름 + 직급 */}
      {!!c.execs.length && (
        <div className="flex items-end gap-2 flex-wrap">
          {c.execs.map((x, i) => {
            const p = findExec(x.exec_id, x.name);
            const on = i === pick;
            return (
              <button key={i} onClick={() => setPick(i)}
                className={cx('group flex items-center gap-2.5 rounded-xl pl-2 pr-4 py-2 transition-all text-left', on ? 'bg-slate-900 text-white shadow-[0_10px_24px_-14px_rgba(15,23,42,0.9)]' : 'bg-white ring-1 ring-slate-200 text-slate-700 hover:ring-slate-400')}>
                <span className={cx('w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold', on ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-600')}>{x.name.slice(0, 1)}</span>
                <span className="leading-tight">
                  <span className={cx('block text-[11px] font-semibold tracking-wide', on ? 'text-indigo-200' : 'text-slate-400')}>{p?.title || '상위 관리자'}</span>
                  <span className="block text-[15px] font-bold">{x.name}</span>
                </span>
              </button>
            );
          })}
          <span className="ml-auto text-[11px] text-slate-400 num pb-1">WEEKLY {periodRange('weekly', start)} · {fmtDate(at)} 만듦{stale ? ' · 지난주 브리핑' : ''}</span>
        </div>
      )}
      {!!c.execs.length && (
        <Card className="overflow-hidden">
          <div className="px-4 pt-4 pb-1">
            <div className="flex items-center gap-1.5 flex-wrap">{(prof?.style_tags ?? []).map((t) => <span key={t} className="text-[10px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{t}</span>)}</div>
            {e.lens && <p className="mt-1 text-sm text-slate-600"><b className="text-slate-800 mr-1">이번 주 이분의 렌즈</b>{strip(e.lens)}</p>}
            {e.opener && <p className="mt-2 text-sm rounded-lg bg-indigo-50 text-indigo-900 px-3 py-2"><b className="mr-1">먼저 꺼낼 말</b>“{strip(e.opener)}”</p>}
          </div>
          <div className="grid md:grid-cols-2 gap-0 md:divide-x divide-slate-100 border-t border-slate-100 mt-3">
            <div className="p-4">
              <div className="text-sm font-bold flex items-center gap-1.5"><MessageCircleQuestion size={15} className="text-indigo-600" />물어볼 것</div>
              <ol className="mt-2 space-y-3">{e.questions.map((x, i) => (
                <li key={i} className="text-sm">
                  <p className="font-semibold leading-snug"><span className="text-indigo-600 mr-1 num">Q{i + 1}.</span>{strip(x.q)}</p>
                  {x.why && <p className="mt-0.5 text-xs text-slate-500">{strip(x.why)}</p>}
                  {x.prep && <p className="mt-1 text-xs rounded-lg bg-slate-50 ring-1 ring-slate-200 px-2.5 py-1.5 text-slate-700"><b className="mr-1">답 준비</b>{strip(x.prep)}</p>}
                </li>))}</ol>
            </div>
            <div className="p-4 border-t md:border-t-0 border-slate-100">
              <div className="text-sm font-bold flex items-center gap-1.5"><AlertTriangle size={15} className="text-rose-600" />챌린지할 것</div>
              <ol className="mt-2 space-y-3">{e.challenges.map((x, i) => (
                <li key={i} className="text-sm">
                  <p className="font-semibold leading-snug text-rose-900">{strip(x.point)}</p>
                  {x.why && <p className="mt-0.5 text-xs text-slate-500">{strip(x.why)}</p>}
                  {x.prep && <p className="mt-1 text-xs rounded-lg bg-rose-50/60 ring-1 ring-rose-100 px-2.5 py-1.5 text-slate-700"><b className="mr-1">대응</b>{strip(x.prep)}</p>}
                </li>))}</ol>
            </div>
          </div>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-5 items-start">
        <Card>
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm flex items-center gap-1.5"><Send size={14} className="text-slate-500" />답해야 할 요청</div>
          {!c.requests?.length ? <p className="px-4 py-4 text-sm text-slate-400">지금 답할 요청이 없습니다.</p> : (
            <ul className="divide-y divide-slate-100">{c.requests.map((r, i) => {
              const d = r.due ? dDay(r.due) : null;
              return (
                <li key={i} className="px-4 py-3">
                  <div className="flex items-center gap-1.5 text-[11px]">
                    {r.status && <span className={cx('font-bold rounded px-1.5 py-px', r.status === '미답' ? 'bg-rose-50 text-rose-700' : r.status === '진행 중' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700')}>{r.status}</span>}
                    {d != null && <span className={cx('font-semibold', d < 0 ? 'text-rose-600' : d <= 3 ? 'text-amber-700' : 'text-slate-500')}>{d < 0 ? `${-d}일 지남` : d === 0 ? '오늘' : `D-${d}`}</span>}
                  </div>
                  <p className="mt-1 text-sm font-semibold leading-snug">{strip(r.title)}</p>
                  {r.reply && <div className="mt-1.5 text-xs rounded-lg bg-slate-50 ring-1 ring-slate-200 px-2.5 py-1.5 text-slate-700 flex gap-2">
                    <span className="flex-1"><b className="mr-1">답 초안</b>{strip(r.reply)}</span>
                    <button onClick={() => copy(strip(r.reply))} title="복사" className="shrink-0 text-slate-400 hover:text-slate-800"><ClipboardCopy size={13} /></button></div>}
                </li>
              );
            })}</ul>
          )}
        </Card>
        <Card>
          <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm">먼저 알리면 좋은 것 <span className="text-xs font-normal text-slate-400">다른 경로로 듣기 전에</span></div>
          {!c.share_first?.length ? <p className="px-4 py-4 text-sm text-slate-400">특별히 먼저 알릴 것이 없습니다.</p> : (
            <ul className="divide-y divide-slate-100">{c.share_first.map((x, i) => (
              <li key={i} className="px-4 py-3 flex gap-2.5">
                <span className={cx('mt-1.5 w-2 h-2 rounded-full shrink-0', x.tone === 'good' ? 'bg-emerald-500' : 'bg-rose-500')} />
                <div><p className="text-sm font-semibold leading-snug">{strip(x.title)}</p>{x.why && <p className="mt-0.5 text-xs text-slate-500">{strip(x.why)}</p>}</div>
              </li>))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ExecList({ teamId, onNote }: { teamId: string; onNote: (id: string) => void }) {
  const ex = useExecutives(teamId);
  const [edit, setEdit] = useState<Partial<Executive> | null>(null);
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-100"><div className="font-semibold">상위 관리자</div><div className="text-xs text-slate-400">성향·관심사를 적어 두면 브리핑이 그분의 눈으로 나옵니다</div></div>
      {ex.loading ? <Spinner /> : !ex.list.length ? <p className="px-4 py-4 text-sm text-slate-500">아직 등록한 분이 없습니다. 보고를 받는 분(본부장, 임원 등)을 한 명 이상 등록하세요.</p> : (
        <ul className="divide-y divide-slate-100">{ex.list.map((e) => (
          <li key={e.id} className="px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-slate-900 text-white text-sm font-bold flex items-center justify-center shrink-0">{e.name.slice(0, 1)}</span>
              <div className="min-w-0 flex-1"><div className="text-sm font-bold truncate">{e.name}</div><div className="text-[11px] text-slate-500 truncate">{e.title || '직책 미입력'}</div></div>
              <button onClick={() => onNote(e.id)} title="이분에게서 온 것 남기기" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100"><Plus size={14} /></button>
              <button onClick={() => setEdit(e)} title="고치기" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100"><Pencil size={14} /></button>
            </div>
            {!!e.style_tags.length && <div className="mt-2 flex flex-wrap gap-1">{e.style_tags.map((t) => <span key={t} className="text-[10px] rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{t}</span>)}</div>}
            {e.interests && <p className="mt-1.5 text-xs text-slate-600 line-clamp-2"><b className="mr-1 text-slate-500">관심사</b>{e.interests}</p>}
          </li>
        ))}</ul>
      )}
      <div className="px-4 py-3 border-t border-slate-100"><Button size="sm" variant="secondary" onClick={() => setEdit({ name: '', style_tags: [] })}><Plus size={13} />상위 관리자 추가</Button></div>
      {edit && <ExecModal init={edit} onClose={() => setEdit(null)} onSave={(v) => ex.save.mutate(v, { onSuccess: () => setEdit(null) })} onDelete={edit.id ? () => ex.remove.mutate(edit.id!, { onSuccess: () => setEdit(null) }) : undefined} saving={ex.save.isPending} />}
    </Card>
  );
}

function ExecModal({ init, onClose, onSave, onDelete, saving }: { init: Partial<Executive>; onClose: () => void; onSave: (v: Partial<Executive> & { name: string }) => void; onDelete?: () => void; saving: boolean }) {
  const [v, setV] = useState({ name: init.name ?? '', title: init.title ?? '', style_tags: init.style_tags ?? [], interests: init.interests ?? '', prefs: init.prefs ?? '' });
  const [custom, setCustom] = useState('');
  const toggle = (t: string) => setV({ ...v, style_tags: v.style_tags.includes(t) ? v.style_tags.filter((x) => x !== t) : [...v.style_tags, t] });
  const tags = [...new Set([...STYLE_PRESETS, ...v.style_tags])];
  return (
    <Modal open onClose={onClose} title={init.id ? '상위 관리자 고치기' : '상위 관리자 추가'}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (v.name.trim()) onSave({ ...init, ...v }); }}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="이름"><input className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="예: 김정훈" /></Field>
          <Field label="직책"><input className={inputCls} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="예: 마케팅본부장" /></Field>
        </div>
        <Field label="성향" hint="여러 개 고를 수 있습니다">
          <div className="flex flex-wrap gap-1.5">{tags.map((t) => (
            <button type="button" key={t} onClick={() => toggle(t)} className={cx('text-xs rounded-full px-2.5 py-1 ring-1', v.style_tags.includes(t) ? 'bg-slate-900 text-white ring-slate-900' : 'ring-slate-200 text-slate-600 hover:ring-slate-400')}>{t}</button>
          ))}</div>
          <div className="mt-1.5 flex gap-1.5"><input className={cx(inputCls, 'text-xs')} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="직접 추가 (예: 경쟁사 비교를 꼭 물음)" />
            <Button type="button" size="sm" variant="secondary" onClick={() => { if (custom.trim()) { setV({ ...v, style_tags: [...v.style_tags, custom.trim()] }); setCustom(''); } }}>추가</Button></div>
        </Field>
        <Field label="요즘 관심사 · 자주 묻는 것"><textarea rows={3} className={inputCls} value={v.interests} onChange={(e) => setV({ ...v, interests: e.target.value })} placeholder="예: 제휴 채널 성과, CAC 개선 속도. 숫자를 지난달과 비교해서 물음" /></Field>
        <Field label="보고 선호"><input className={inputCls} value={v.prefs} onChange={(e) => setV({ ...v, prefs: e.target.value })} placeholder="예: 월요일 주간회의 · 1페이지 · 결론 먼저" /></Field>
        <div className="flex items-center gap-2">
          {onDelete && <button type="button" onClick={onDelete} className="text-xs text-rose-600 inline-flex items-center gap-1"><Trash2 size={12} />삭제</button>}
          <div className="ml-auto flex gap-2"><Button type="button" variant="ghost" onClick={onClose}>취소</Button><Button type="submit" loading={saving} disabled={!v.name.trim()}>저장</Button></div>
        </div>
      </form>
    </Modal>
  );
}

function FromAbove({ teamId, execs }: { teamId: string; execs: Executive[] }) {
  const org = useOrgNotes(teamId);
  const st = orgStats(org.data, []);
  const [showDone, setShowDone] = useState(false);
  const nameOf = (id?: string | null) => execs.find((e) => e.id === id)?.name;
  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-100"><div className="font-semibold">위에서 온 것</div><div className="text-xs text-slate-400">코멘트 · 자료 · 요청 · 방침 · 일정 — 대시보드 '조직·전사' 칸에도 쓰입니다</div></div>
      {org.isLoading ? <Spinner /> : !st.open.length ? <p className="px-4 py-4 text-sm text-slate-500">열린 것이 없습니다. 위의 '위에서 온 것'으로 남기면 브리핑과 대시보드 '조직·전사' 칸에 함께 쓰입니다.</p>
        : <ul className="[&>li]:px-4">{st.open.map((n) => <OrgNoteRow key={n.id} teamId={teamId} note={n} impact={org.data?.impactOf.get(n.id)} execName={nameOf(n.exec_id)} />)}</ul>}
      {st.upcoming.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-500 flex items-center gap-1.5"><CalendarClock size={13} />다가오는 일정·기한</div>
          <ul className="mt-2 space-y-1.5">{st.upcoming.map((n) => { const dd = dDay(n.event_date!); return (
            <li key={n.id} className="text-sm flex items-center gap-2"><span className={cx('font-mono text-xs w-12 shrink-0 font-semibold', dd < 0 ? 'text-rose-600' : dd <= 7 ? 'text-amber-700' : 'text-slate-500')}>{dd < 0 ? `+${-dd}일` : dd === 0 ? '오늘' : `D-${dd}`}</span>
              <span className="flex-1 min-w-0 truncate">{n.title}</span><span className={cx('text-[10px] rounded px-1.5 py-0.5 shrink-0', ORG_KIND[n.kind].cls)}>{ORG_KIND[n.kind].label}</span></li>); })}</ul>
        </div>
      )}
      {st.doneN > 0 && (
        <div className="border-t border-slate-100">
          <button onClick={() => setShowDone(!showDone)} className="px-4 py-2.5 text-xs text-slate-500 hover:text-slate-800">{showDone ? '처리한 것 접기' : `처리한 것 ${st.doneN}건`}</button>
          {showDone && <ul className="[&>li]:px-4">{st.notes.filter((n) => n.status === 'done').map((n) => <OrgNoteRow key={n.id} teamId={teamId} note={n} impact={org.data?.impactOf.get(n.id)} execName={nameOf(n.exec_id)} />)}</ul>}
        </div>
      )}
    </Card>
  );
}
