// 노하우 라이브러리 › ATEAM 플레이북 — 기본 제공 방법론 카드를 영역(책등)별로 보고, 켜고 끄고, 우리 팀에 맞게 고친다
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Globe2, Library, Lock, Pin, RotateCcw, Search, Star, Users, X } from 'lucide-react';
import { supabase, q, errorText } from '../../lib/supabase';
import { DOMAINS, DOMAIN_ORDER, EVIDENCE, PLAYBOOK, type PlaybookCard, type PlaybookDomain } from '../../lib/playbook';
import { KH_FEATURE } from '../../lib/knowhow';
import type { KnowhowFeature } from '../../lib/types';
import { cx, fmtDate } from '../../lib/format';
import { Button, inputCls, useToast } from '../ui';

type Filter = 'all' | 'core' | 'on' | 'off';

/** 원본과 글자가 다르면 '우리 팀 수정' */
const isEdited = (c: PlaybookCard) => !!c.tpl && (c.title !== c.tpl.title || c.body !== c.tpl.body || JSON.stringify(c.rules) !== JSON.stringify(c.tpl.rules));
const domainOf = (c: PlaybookCard): PlaybookDomain => (c.tpl?.domain && c.tpl.domain in DOMAINS ? c.tpl.domain : 'goal');

function useCardUpdate() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<PlaybookCard> }) => q(supabase.from('knowhow_cards').update(patch).eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowhow-cards'] }),
    onError: (e) => toast(errorText(e)),
  });
}

/** 켜짐/꺼짐 스위치 */
function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={cx('relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
        on ? 'bg-indigo-600' : 'bg-slate-300', disabled && 'opacity-40 cursor-not-allowed')}>
      <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

// ---------- 책장 ----------
function Shelf({ counts, value, onPick }: { counts: Record<PlaybookDomain, number>; value: PlaybookDomain | 'all'; onPick: (d: PlaybookDomain | 'all') => void }) {
  const heights = [178, 196, 168, 188, 174, 198, 182, 170];
  return (
    <div className="relative">
      <div className="flex items-end gap-[5px] h-[212px] overflow-x-auto overflow-y-hidden pt-4 px-1 -mx-1" role="tablist" aria-label="플레이북 영역">
        {DOMAIN_ORDER.map((d, i) => {
          const m = DOMAINS[d];
          const on = value === d;
          return (
            <button key={d} role="tab" aria-selected={on} title={`${m.label} — ${m.sub}`} onClick={() => onPick(on ? 'all' : d)}
              style={{ height: heights[i], width: 30 + (counts[d] ?? 0) * 1.6 }}
              className={cx('group relative shrink-0 rounded-t-[3px] rounded-b-[1px] text-white flex flex-col items-center justify-between py-2.5 transition-transform duration-200 motion-reduce:transition-none',
                m.spine, on ? '-translate-y-3 ring-2 ring-[#D9B970] ring-offset-2 ring-offset-[#101A33]' : value !== 'all' ? 'opacity-55 hover:opacity-90' : 'hover:-translate-y-1.5',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#D9B970]')}>
              <span aria-hidden className="absolute inset-x-0 top-[14px] h-px bg-white/25" />
              <span aria-hidden className="absolute inset-x-0 bottom-[30px] h-px bg-white/25" />
              <span className="mt-3 text-[12.5px] font-semibold tracking-[0.04em] [writing-mode:vertical-rl] whitespace-nowrap">{m.short}</span>
              <span className="num text-[11px] font-bold text-white/85">{counts[d] ?? 0}</span>
            </button>
          );
        })}
      </div>
      <div aria-hidden className="h-[6px] rounded-sm bg-[#2A3757] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.6)]" />
    </div>
  );
}

// ---------- 카드 한 줄 ----------
function Row({ c, locked, onOpen }: { c: PlaybookCard; locked: boolean; onOpen: () => void }) {
  const upd = useCardUpdate();
  const d = DOMAINS[domainOf(c)];
  const on = locked ? !!c.locked_active : c.active;
  return (
    <li>
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
        className={cx('relative bg-white rounded-xl border pl-5 pr-4 py-3.5 cursor-pointer hover:border-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500',
          on ? 'border-slate-200' : 'border-slate-200 bg-slate-50/70')}>
        <span aria-hidden className={cx('absolute left-0 top-3 bottom-3 w-[3px] rounded-r', d.bar, !on && 'opacity-30')} />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className={cx('font-semibold leading-snug flex items-start gap-1.5', !on && 'text-slate-500')}>
              {c.tpl?.tier === 1 && <Star size={13} className="mt-[3px] shrink-0 fill-[#C9A24A] text-[#C9A24A]" aria-label="대표 방법론" />}
              <span>{c.title}</span>
            </div>
            {c.tpl?.situation && <div className="mt-0.5 text-xs text-slate-500">{c.tpl.situation}에</div>}
            <p className="mt-1.5 text-[13px] text-slate-600 leading-relaxed line-clamp-2">{c.body}</p>
            <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-slate-400">
              {c.tpl?.origin && <span className="inline-flex items-center gap-1 min-w-0">{c.tpl.origin_type === 'field' ? <Library size={11} /> : <Globe2 size={11} />}<span className="truncate max-w-[260px]">{c.tpl.origin}</span></span>}
              {c.use_count > 0 && <span className="text-slate-500">AI 적용 <b className="num font-semibold">{c.use_count}</b>회</span>}
              {c.pinned && <span className="inline-flex items-center gap-0.5 text-indigo-600"><Pin size={10} />항상 먼저</span>}
              {c.shared && <span className="inline-flex items-center gap-0.5 text-emerald-700"><Users size={10} />팀원 공개</span>}
              {isEdited(c) && <span className="text-slate-600">우리 팀 수정</span>}
            </div>
          </div>
          <div className="pt-0.5" title={locked ? 'Pro부터 AI가 사용합니다' : on ? 'AI가 사용 중' : '꺼 둠 — AI가 읽지 않습니다'}>
            <Switch on={on} disabled={locked} label={`${c.title} AI 사용`} onChange={(v) => upd.mutate({ id: c.id, patch: { active: v } })} />
          </div>
        </div>
      </div>
    </li>
  );
}

// ---------- 자세히 (오른쪽 패널) ----------
function Detail({ c, locked, onClose }: { c: PlaybookCard; locked: boolean; onClose: () => void }) {
  const upd = useCardUpdate();
  const toast = useToast();
  const dk = domainOf(c);
  const d = DOMAINS[dk];
  const Icon = d.icon;
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ title: c.title, body: c.body, rules: c.rules.join('\n') });
  useEffect(() => { setF({ title: c.title, body: c.body, rules: c.rules.join('\n') }); setEdit(false); }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const save = (patch: Partial<PlaybookCard>, msg?: string) => upd.mutate({ id: c.id, patch }, { onSuccess: () => msg && toast(msg) });
  const on = locked ? !!c.locked_active : c.active;
  const t = c.tpl;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/25" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 w-full sm:w-[460px] bg-white shadow-2xl border-l border-slate-200 flex flex-col" aria-label={c.title}>
        <div className="px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', d.chip)}><Icon size={12} />{d.label}</span>
            {t?.tier === 1 && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#8A6420]"><Star size={11} className="fill-[#C9A24A] text-[#C9A24A]" />대표 방법론</span>}
            <button onClick={onClose} className="ml-auto text-slate-400 hover:text-slate-700" aria-label="닫기"><X size={18} /></button>
          </div>
          <h3 className="mt-2.5 text-[19px] font-bold leading-snug tracking-tight">{c.title}</h3>
          {t?.situation && <p className="mt-1 text-sm text-slate-500">{t.situation}에 씁니다</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6 text-sm">
          {edit ? (
            <div className="space-y-2">
              <input aria-label="제목" className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
              <textarea aria-label="내용" rows={5} className={cx(inputCls, 'leading-relaxed')} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
              <textarea aria-label="AI가 지킬 규칙" rows={4} className={inputCls} value={f.rules} onChange={(e) => setF({ ...f, rules: e.target.value })} placeholder="AI가 지킬 규칙 (한 줄에 하나)" />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>취소</Button>
                <Button size="sm" loading={upd.isPending} onClick={() => { save({ title: f.title.trim(), body: f.body.trim(), rules: f.rules.split('\n').map((r) => r.trim()).filter(Boolean) }, '우리 팀에 맞게 고쳤습니다'); setEdit(false); }}>저장</Button>
              </div>
            </div>
          ) : (
            <>
              <section>
                <p className="text-slate-800 leading-[1.75]">{c.body}</p>
              </section>
              {c.rules.length > 0 && (
                <section>
                  <h4 className="text-[13px] font-bold text-slate-900">AI는 이렇게 적용합니다</h4>
                  <ul className="mt-2 space-y-1.5">
                    {c.rules.map((r, i) => <li key={i} className="flex gap-2 text-slate-700"><Check size={14} className="mt-[3px] shrink-0 text-indigo-500" />{r}</li>)}
                  </ul>
                </section>
              )}
            </>
          )}

          {t && (t.example_bad || t.example_good) && (
            <section>
              <h4 className="text-[13px] font-bold text-slate-900">예시</h4>
              <div className="mt-2 rounded-xl border border-slate-200 overflow-hidden">
                {t.example_bad && <div className="flex gap-2.5 px-3.5 py-3 bg-slate-50/80"><X size={14} className="mt-[3px] shrink-0 text-rose-500" /><span className="text-slate-500 leading-relaxed">{t.example_bad}</span></div>}
                {t.example_good && <div className="flex gap-2.5 px-3.5 py-3 border-t border-slate-200"><Check size={14} className="mt-[3px] shrink-0 text-emerald-600" /><span className="text-slate-800 leading-relaxed">{t.example_good}</span></div>}
              </div>
            </section>
          )}

          {t?.why && (
            <section>
              <h4 className="text-[13px] font-bold text-slate-900">왜 효과가 있나</h4>
              <p className="mt-1.5 text-slate-600 leading-relaxed">{t.why}</p>
            </section>
          )}

          {t?.origin && (
            <section className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3.5 py-3 text-[13px]">
              {t.origin_type === 'field' ? <Library size={15} className="mt-0.5 shrink-0 text-slate-500" /> : <Globe2 size={15} className="mt-0.5 shrink-0 text-slate-500" />}
              <div>
                <div className="text-slate-700">{t.origin}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{t.origin_type === 'field' ? '국내 기업 성과관리 현장 컨설팅에서 써 온 기준' : '널리 검증된 방법론을 ATEAM이 실무 카드로 정리'}</div>
              </div>
            </section>
          )}

          <section className="border-t border-slate-100 pt-5 space-y-4">
            {locked && (
              <div className="rounded-lg bg-[#FAF1E1] text-[#6B4A12] px-3.5 py-2.5 text-xs leading-relaxed flex gap-2">
                <Lock size={13} className="mt-0.5 shrink-0" /><span>지금 요금제에서는 읽기만 할 수 있습니다. Pro부터 AI가 플레이북을 함께 씁니다. <Link to="/settings?tab=billing" className="font-semibold underline">요금제 보기</Link></span>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-semibold">AI가 사용</div><div className="text-xs text-slate-500">끄면 어떤 AI 기능도 이 카드를 읽지 않습니다</div></div>
              <Switch on={on} disabled={locked} label="AI가 사용" onChange={(v) => save({ active: v })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-semibold">항상 먼저 반영</div><div className="text-xs text-slate-500">상황과 상관없이 이 카드를 먼저 싣습니다</div></div>
              <Switch on={c.pinned} disabled={locked} label="항상 먼저 반영" onChange={(v) => save({ pinned: v })} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-semibold">팀원에게 공개</div><div className="text-xs text-slate-500">팀원 화면의 '팀장 가이드'에 보입니다</div></div>
              <Switch on={c.shared} label="팀원에게 공개" onChange={(v) => save({ shared: v })} />
            </div>
            <div>
              <div className="font-semibold">반영할 곳</div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {(Object.keys(KH_FEATURE) as KnowhowFeature[]).filter((x) => x !== 'evaluation').map((x) => {
                  const has = c.applies_to.includes(x);
                  return (
                    <button key={x} disabled={locked} onClick={() => save({ applies_to: has ? c.applies_to.filter((y) => y !== x) : [...c.applies_to, x] })}
                      className={cx('rounded-full border px-2.5 py-1', has ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-400 hover:text-slate-600', locked && 'opacity-50')}>
                      {KH_FEATURE[x]}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">평가 초안과 팀원 액션에는 플레이북을 쓰지 않습니다.</p>
            </div>
          </section>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 text-xs">
          <span className="text-slate-400">{c.use_count > 0 ? `AI 결과에 ${c.use_count}번 적용 · 최근 ${fmtDate(c.last_used_at)}` : '아직 적용 전'}</span>
          <span className="ml-auto flex gap-1.5">
            {isEdited(c) && t && !edit && (
              <Button size="sm" variant="ghost" onClick={() => save({ title: t.title, body: t.body, rules: t.rules }, '원래 문안으로 되돌렸습니다')}><RotateCcw size={13} />원래대로</Button>
            )}
            {!edit && <Button size="sm" variant="secondary" onClick={() => setEdit(true)}>우리 팀에 맞게 고치기</Button>}
          </span>
        </div>
      </aside>
    </div>,
    document.body,
  );
}

// ---------- 탭 본문 ----------
export function PlaybookTab({ cards, locked, onAddMine, ready }: { cards: PlaybookCard[]; locked: boolean; onAddMine: () => void; ready: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [domain, setDomain] = useState<PlaybookDomain | 'all'>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = useMemo(() => cards.reduce((a, c) => ((a[domainOf(c)] = (a[domainOf(c)] ?? 0) + 1), a), {} as Record<PlaybookDomain, number>), [cards]);
  const isOn = (c: PlaybookCard) => (locked ? !!c.locked_active : c.active);
  const nOn = locked ? 0 : cards.filter(isOn).length;
  const used = cards.reduce((a, c) => a + c.use_count, 0);
  const nGlobal = cards.filter((c) => c.tpl?.origin_type === 'global').length;

  const list = useMemo(() => {
    const qq = query.trim().toLowerCase();
    return cards
      .filter((c) => domain === 'all' || domainOf(c) === domain)
      .filter((c) => filter === 'all' || (filter === 'core' ? c.tpl?.tier === 1 : filter === 'on' ? isOn(c) : !isOn(c)))
      .filter((c) => !qq || [c.title, c.body, c.tpl?.situation, c.tpl?.origin, ...(c.keywords ?? [])].some((x) => x?.toLowerCase().includes(qq)))
      .sort((a, b) => (DOMAIN_ORDER.indexOf(domainOf(a)) - DOMAIN_ORDER.indexOf(domainOf(b))) || ((a.tpl?.sort ?? 0) - (b.tpl?.sort ?? 0)));
  }, [cards, domain, filter, query]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = DOMAIN_ORDER.map((d) => ({ d, items: list.filter((c) => domainOf(c) === d) })).filter((g) => g.items.length);
  const open = cards.find((c) => c.id === openId) ?? null;

  const restore = useMutation({
    mutationFn: (teamId: string) => q<number>(supabase.rpc('restore_consulting_cards', { p_team: teamId })),
    onSuccess: (n) => { toast(n ? `지웠던 플레이북 카드 ${n}장을 다시 넣었습니다` : '빠진 플레이북 카드가 없습니다'); qc.invalidateQueries({ queryKey: ['knowhow-cards'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const teamId = cards[0]?.team_id;

  return (
    <div className="space-y-6">
      {/* 표지 + 책장 */}
      <section className="rounded-2xl bg-[#101A33] text-white overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_auto] gap-x-10 gap-y-6 p-6 sm:p-8">
          <div className="max-w-[34rem] self-center">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[#D9B970]"><Library size={15} />{PLAYBOOK}</div>
            <h2 className="mt-3 text-[26px] sm:text-[30px] font-extrabold leading-[1.28] tracking-[-0.025em]">일 잘하는 방법 {cards.length || 78}가지를<br />AI가 상황에 맞게 꺼내 씁니다</h2>
            <p className="mt-3 text-[14px] leading-[1.75] text-slate-300">
              글로벌 컨설팅펌·연구기관이 검증한 방법론과 국내 성과관리 현장 컨설팅의 기준을 실무 카드로 정리했습니다.
              결과물 검토, 1on1 준비, 보고 초안을 쓸 때 AI가 지금 상황에 맞는 카드를 골라 근거 표시와 함께 적용합니다.
            </p>
            <dl className="mt-6 grid grid-cols-3 gap-4 max-w-md">
              <div><dt className="text-[11px] text-slate-400">AI가 쓰는 카드</dt><dd className="mt-0.5 text-lg font-bold num">{nOn}<span className="text-sm font-medium text-slate-400"> / {cards.length}</span></dd></div>
              <div><dt className="text-[11px] text-slate-400">글로벌 · 현장</dt><dd className="mt-0.5 text-lg font-bold num">{nGlobal}<span className="text-sm font-medium text-slate-400"> · {cards.length - nGlobal}</span></dd></div>
              <div><dt className="text-[11px] text-slate-400">AI 적용 횟수</dt><dd className="mt-0.5 text-lg font-bold num">{used}<span className="text-sm font-medium text-slate-400">회</span></dd></div>
            </dl>
          </div>
          <div className="lg:w-[440px] min-w-0">
            <Shelf counts={counts} value={domain} onPick={setDomain} />
            <p className="mt-2.5 text-[11px] text-slate-400">{domain === 'all' ? '책을 누르면 그 영역만 봅니다' : `${DOMAINS[domain].label} — ${DOMAINS[domain].sub}`}</p>
          </div>
        </div>
      </section>

      {/* AI가 기준을 고르는 순서 + 근거 */}
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4">
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <h3 className="font-semibold">AI가 판단할 때 기준을 쓰는 순서</h3>
          <ol className="mt-3 space-y-2.5 text-sm">
            <li className="flex gap-3"><span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0 num">1</span>
              <span><b>팀장님의 노하우</b> <span className="text-slate-500">— 늘 가장 먼저. 플레이북과 어긋나면 팀장님 기준을 따릅니다</span></span></li>
            <li className="flex gap-3"><span className="w-5 h-5 rounded-full bg-[#101A33] text-[#D9B970] text-[11px] font-bold flex items-center justify-center shrink-0 num">2</span>
              <span><b>{PLAYBOOK}</b> <span className="text-slate-500">— 결과물 본문과 기록을 읽고 맞는 카드를 최대 8장 골라 씁니다</span></span></li>
            <li className="flex gap-3"><span className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-bold flex items-center justify-center shrink-0 num">3</span>
              <span className="text-slate-500">일반적인 상식</span></li>
          </ol>
          <p className="mt-3 text-xs text-slate-500 leading-relaxed">적용한 카드는 AI 결과의 출처 표시(✦)에 '적용한 기준'으로 남습니다. 평가 초안과 팀원 액션에는 쓰지 않습니다.</p>
          <button onClick={onAddMine} className="mt-3 text-xs font-semibold text-indigo-700 hover:underline">팀장님 노하우 더하기</button>
        </section>
        <section className="rounded-2xl bg-white border border-slate-200 p-5">
          <h3 className="font-semibold">왜 방법론이 성과를 바꾸나</h3>
          <ul className="mt-3 grid sm:grid-cols-2 gap-x-5 gap-y-3.5">
            {EVIDENCE.map((e) => (
              <li key={e.src}>
                <div className="text-[17px] font-extrabold tracking-tight text-[#101A33] num">{e.stat}</div>
                <p className="text-[13px] text-slate-700 leading-snug mt-0.5">{e.text}</p>
                <div className="text-[11px] text-slate-400 mt-0.5">{e.src}</div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {locked && (
        <div className="rounded-xl bg-[#FAF1E1] border border-[#EBD9B3] px-4 py-3 text-sm text-[#6B4A12] flex items-start gap-2.5">
          <Lock size={15} className="mt-0.5 shrink-0" />
          <span className="flex-1">지금 요금제에서는 플레이북을 읽어 볼 수만 있습니다. <b>Pro부터 AI가 {cards.length}개 방법론을 결과물 검토·1on1·보고에 함께 씁니다.</b> 팀장님 노하우는 지금 요금제에서도 그대로 반영됩니다.</span>
          <Link to="/settings?tab=billing" className="shrink-0 font-semibold underline whitespace-nowrap">요금제 보기</Link>
        </div>
      )}

      {/* 찾기 */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className={cx(inputCls, 'pl-9')} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="방법론 찾기 — 예: 보고서, 가설, 피드백" aria-label="방법론 찾기" />
        </label>
        <div className="flex gap-1 text-xs" role="group" aria-label="보기">
          {([['all', '전체'], ['core', '대표 방법론'], ['on', 'AI 사용 중'], ['off', '꺼 둔 카드']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={cx('rounded-lg px-3 py-1.5 border', filter === k ? 'border-slate-800 bg-slate-800 text-white font-semibold' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>{l}</button>
          ))}
        </div>
        {domain !== 'all' && <button onClick={() => setDomain('all')} className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"><X size={12} />{DOMAINS[domain].label} 필터 해제</button>}
      </div>

      {/* 목록 */}
      {!ready ? null : !list.length ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">조건에 맞는 카드가 없습니다. 검색어나 보기를 바꿔 보세요.</p>
      ) : (
        <div className="space-y-8">
          {groups.map(({ d, items }) => {
            const m = DOMAINS[d]; const Icon = m.icon;
            return (
              <section key={d}>
                <div className="flex items-baseline gap-2.5 mb-3">
                  <span className={cx('self-center w-7 h-7 rounded-lg flex items-center justify-center text-white', m.spine)}><Icon size={15} /></span>
                  <h3 className="text-[17px] font-bold tracking-tight">{m.label}</h3>
                  <span className="text-sm text-slate-500 hidden sm:inline">{m.sub}</span>
                  <span className="ml-auto text-xs text-slate-400 num">{items.length}장</span>
                </div>
                <ul className="grid md:grid-cols-2 gap-2.5">
                  {items.map((c) => <Row key={c.id} c={c} locked={locked} onOpen={() => setOpenId(c.id)} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {!locked && teamId && (
        <div className="pt-2 text-center">
          <button className="text-xs text-slate-400 hover:text-slate-700 inline-flex items-center gap-1" disabled={restore.isPending} onClick={() => restore.mutate(teamId)}>
            <RotateCcw size={12} />지웠던 플레이북 카드 다시 받기
          </button>
        </div>
      )}
      {open && <Detail c={open} locked={locked} onClose={() => setOpenId(null)} />}
    </div>
  );
}
