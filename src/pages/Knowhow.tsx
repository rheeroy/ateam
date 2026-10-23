// 노하우 라이브러리 — AI가 일할 때 따르는 기준: ① 팀장님의 노하우(직접 넣은 카드) ② ATEAM Method™(기본 제공 방법론)
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, FileUp, Library, Pencil, Pin, PinOff, Plus, RefreshCw, Sparkles, Trash2, Users } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import { ACCEPT_KNOWHOW, MAX_BYTES, extractText, safeName } from '../lib/extract';
import type { KnowhowCard, KnowhowFeature, KnowhowKind, KnowhowSource } from '../lib/types';
import { KH_FEATURE, KH_KIND } from '../lib/knowhow';
import { PLAYBOOK, usePlaybookTemplates, type PlaybookCard } from '../lib/playbook';
import { cx, fmtDate } from '../lib/format';
import { Button, Card, CardHead, Empty, ErrorBox, PageHeader, Pill, Spinner, Tabs, inputCls, useToast } from '../components/ui';
import { ProvChip } from '../components/Prov';
import { PlaybookTab } from '../components/knowhow/Playbook';
import { AiIcon, aiText, CoreAI } from '../components/Brand';

export const KIND = KH_KIND;
export const FEATURE = KH_FEATURE;
const isConsulting = (c: Pick<KnowhowCard, 'source'>) => c.source === 'consulting';
const EXAMPLES: { label: string; text: string }[] = [
  { label: '보고 원칙', text: '우리 팀 보고서 원칙\n1. 첫 문장에 결론. 배경 설명은 뒤로.\n2. 숫자 없는 주장은 받지 않는다. 출처를 단다.\n3. 대안 2개 이상을 비교하고 버린 이유를 쓴다.\n4. 리스크와 다음 행동(누가, 언제)을 마지막에.' },
  { label: '좋은 기획서 기준', text: '좋은 기획서의 기준\n- 문제 정의가 고객 관점에서 한 문장으로 된다\n- 가설과 검증 방법이 짝을 이룬다\n- 자원(사람·돈·시간) 추정이 있다\n- 실패하면 무엇을 배우는지가 적혀 있다' },
  { label: '1on1 원칙', text: '내 1on1 원칙\n- 업무 진척은 묻지 않는다(성과입력으로 본다). 막힌 것, 하고 싶은 것을 묻는다.\n- 매번 "내가 도울 일 하나"로 끝낸다.\n- 칭찬은 구체적 행동으로, 우려는 사실로 말한다.' },
  { label: '사업 현황', text: '올해 우리 팀 상황\n- 신사업 2개 검증 중(신제품 진입, 파트너 채널). 연말까지 하나는 접는다.\n- 본부장은 "작게 빨리 검증"을 가장 중시한다.\n- 경쟁사 A가 3분기에 가격을 15% 내렸다.' },
];

function CardItem({ c }: { c: KnowhowCard }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(c.title);
  const [body, setBody] = useState(c.body);
  const [rules, setRules] = useState(c.rules.join('\n'));
  const upd = useMutation({
    mutationFn: (patch: Partial<KnowhowCard>) => q(supabase.from('knowhow_cards').update(patch).eq('id', c.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowhow-cards'] }),
    onError: (e) => toast(errorText(e)),
  });
  const del = useMutation({
    mutationFn: () => q(supabase.from('knowhow_cards').delete().eq('id', c.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowhow-cards'] }),
  });
  const k = KIND[c.kind];
  const prov = c.provenance === 'ai' ? <ProvChip kind="ai" label="AI 정리" note="던져 넣은 자료를 AI가 카드로 정리했습니다. 고치면 '팀장 수정'으로 바뀝니다." />
    : c.provenance === 'human_edit' ? <ProvChip kind="edited" label="팀장 수정" /> : <ProvChip kind="final" label="직접 작성" />;
  const toggleFeature = (f: KnowhowFeature) =>
    upd.mutate({ applies_to: c.applies_to.includes(f) ? c.applies_to.filter((x) => x !== f) : [...c.applies_to, f] });

  return (
    <div className={cx('rounded-xl border p-4 bg-white', c.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-60')}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Pill tone={k.tone}>{k.label}</Pill>
          {c.pinned && <Pill tone="indigo"><Pin size={11} />항상 반영</Pill>}
          {c.shared && <Pill tone="emerald"><Users size={11} />팀원 공개</Pill>}
          {prov}
        </div>
        <div className="flex items-center gap-1 shrink-0 text-slate-400">
          <button title={c.pinned ? '고정 해제' : '항상 먼저 반영'} className="hover:text-indigo-600 p-1" onClick={() => upd.mutate({ pinned: !c.pinned })}>{c.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>
          <button title="고치기" className="hover:text-indigo-600 p-1" onClick={() => setEdit((x) => !x)}><Pencil size={14} /></button>
          <button title="삭제" className="hover:text-rose-600 p-1" onClick={() => { if (confirm('이 카드를 지울까요?')) del.mutate(); }}><Trash2 size={14} /></button>
        </div>
      </div>
      {edit ? (
        <div className="mt-3 space-y-2">
          <input aria-label="제목" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea aria-label="내용" rows={3} className={inputCls} value={body} onChange={(e) => setBody(e.target.value)} />
          <textarea aria-label="규칙" rows={3} className={inputCls} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="AI가 지킬 규칙 (한 줄에 하나)" />
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>취소</Button>
            <Button size="sm" onClick={() => { upd.mutate({ title, body, rules: rules.split('\n').map((r) => r.trim()).filter(Boolean) }); setEdit(false); }}>저장</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 font-semibold">{c.title}</div>
          {c.body && <p className="mt-1 text-sm text-slate-600 leading-relaxed">{c.body}</p>}
          {c.rules.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-sm text-slate-800">
              {c.rules.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-indigo-500">›</span>{r}</li>)}
            </ul>
          )}
        </>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="text-slate-400 mr-0.5">반영할 곳</span>
        {(Object.keys(FEATURE) as KnowhowFeature[]).map((f) => (
          <button key={f} onClick={() => toggleFeature(f)}
            className={cx('rounded-full border px-2 py-0.5', c.applies_to.includes(f) ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-400 hover:text-slate-600')}>
            {FEATURE[f]}
          </button>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-3 flex-wrap text-xs text-slate-500">
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-1.5 cursor-pointer"><input type="checkbox" className="accent-indigo-600" checked={c.active} onChange={(e) => upd.mutate({ active: e.target.checked })} /><span><CoreAI />가 사용</span></label>
          <label className="inline-flex items-center gap-1.5 cursor-pointer" title="팀원 화면의 '팀장 가이드'에 보입니다"><input type="checkbox" className="accent-indigo-600" checked={c.shared} onChange={(e) => upd.mutate({ shared: e.target.checked })} />팀원에게 공개</label>
        </div>
        <span>{c.use_count > 0 ? aiText(`AI 결과에 ${c.use_count}번 반영 · 최근 ${fmtDate(c.last_used_at)}`) : '아직 반영 전'}</span>
      </div>
    </div>
  );
}

function Dump({ onDone }: { onDone: () => void }) {
  const { team, uid, credits } = useTeam();
  const toast = useToast();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      if (!text.trim() && !file) throw new Error('글을 붙여 넣거나 파일을 고르세요');
      if (file && file.size > MAX_BYTES) throw new Error('20MB 이하 파일만 올릴 수 있습니다');
      let raw = text, mime: string | null = null;
      if (file) { const ex = await extractText(file); raw = [text, ex.text].filter(Boolean).join('\n\n'); mime = ex.mime; }
      const src = await q<KnowhowSource>(supabase.from('knowhow_sources').insert({
        team_id: team.id, owner_id: uid, title: title || file?.name || text.split('\n')[0].slice(0, 40), raw_text: raw.slice(0, 100000),
        file_name: file?.name ?? null, mime_type: mime,
      }).select().single());
      if (file) {
        const path = `${team.id}/${src.id}-${safeName(file.name)}`;
        const { error } = await supabase.storage.from('knowhow').upload(path, file, { contentType: mime ?? undefined });
        if (error) throw error;
        await q(supabase.from('knowhow_sources').update({ file_path: path }).eq('id', src.id));
      }
      qc.invalidateQueries({ queryKey: ['knowhow-sources'] });
      return invoke<{ cards: number; summary: string }>('ai-ingest-knowhow', { source_id: src.id });
    },
    onSuccess: (r) => {
      toast(`카드 ${r.cards}개로 정리했습니다. 확인하고 필요 없는 건 끄세요.`);
      setTitle(''); setText(''); setFile(null);
      qc.invalidateQueries({ queryKey: ['knowhow-sources'] });
      qc.invalidateQueries({ queryKey: ['knowhow-cards'] });
      qc.invalidateQueries({ queryKey: ['credits'] });
      onDone();
    },
    onError: (e) => { toast(errorText(e)); qc.invalidateQueries({ queryKey: ['knowhow-sources'] }); },
  });
  return (
    <Card className="p-5">
      <div className="font-semibold flex items-center gap-2"><Sparkles size={16} className="text-violet-600" />던져 넣기</div>
      <p className="text-xs text-slate-500 mt-1 leading-relaxed">정리 안 된 메모, 예전 보고서, 평가 기준표, 강의 자료, PPT 프레임워크 — 무엇이든 그대로 넣으세요. 나누고 정리하는 건 <CoreAI />가 합니다.</p>
      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {EXAMPLES.map((e) => <button key={e.label} onClick={() => { setText(e.text); setTitle(e.label); }} className="border border-slate-200 rounded-full px-2.5 py-1 hover:border-indigo-300">예시 · {e.label}</button>)}
      </div>
      <input aria-label="제목" className={cx(inputCls, 'mt-3')} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (비워 두면 자동)" />
      <textarea aria-label="노하우 본문" rows={8} className={cx(inputCls, 'mt-2 leading-6')} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={'여기에 붙여 넣거나, 생각나는 대로 적으세요.\n예) 우리 팀은 숫자 없는 보고는 받지 않는다. 결론부터 쓴다. …'} />
      <label className="mt-2 flex items-center gap-3 border border-dashed border-slate-300 rounded-xl px-4 py-3 cursor-pointer hover:border-indigo-400">
        <FileUp size={18} className="text-indigo-600" />
        <span className="text-sm text-slate-600 flex-1 truncate">{file ? file.name : '파일 첨부 (docx · pptx · pdf · txt · md)'}</span>
        <input type="file" accept={ACCEPT_KNOWHOW} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <ErrorBox error={run.error ? errorText(run.error) : null} />
      <Button className="mt-3 w-full" loading={run.isPending} onClick={() => run.mutate()}>
        {run.isPending ? '읽고 정리하는 중…' : <><AiIcon size={15} />정리 맡기기 · 2 크레딧<ArrowRight size={14} /></>}
      </Button>
      {credits && <p className="mt-2 text-[11px] text-slate-400 text-center">남은 크레딧 {credits.monthly_remaining + credits.topup_remaining}</p>}
    </Card>
  );
}

function QuickAdd() {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<KnowhowKind>('principle');
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: () => {
      const [first, ...rest] = text.split('\n').map((s) => s.trim()).filter(Boolean);
      return q(supabase.from('knowhow_cards').insert({
        team_id: team.id, owner_id: uid, kind, title: first.slice(0, 60), body: rest.join(' '),
        rules: [first.slice(0, 80)], applies_to: ['review', 'prep', 'report', 'evaluation'], provenance: 'human',
      }));
    },
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['knowhow-cards'] }); toast('카드를 추가했습니다'); },
    onError: (e) => toast(errorText(e)),
  });
  return (
    <Card className="p-5">
      <div className="font-semibold flex items-center gap-2"><Plus size={16} className="text-indigo-600" />한 줄 바로 추가 <span className="text-xs font-normal text-slate-400">크레딧 없음</span></div>
      <div className="mt-3 flex gap-2">
        <select aria-label="종류" className={cx(inputCls, 'w-36')} value={kind} onChange={(e) => setKind(e.target.value as KnowhowKind)}>
          {(Object.keys(KIND) as KnowhowKind[]).map((k) => <option key={k} value={k}>{KIND[k].label}</option>)}
        </select>
        <input aria-label="한 줄" className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="예) 대안 없는 문제 제기는 받지 않는다" onKeyDown={(e) => e.key === 'Enter' && text.trim() && add.mutate()} />
        <Button variant="soft" disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate()}>추가</Button>
      </div>
    </Card>
  );
}

type Tab = 'playbook' | 'mine';
const TAB_KEY = 'ateam.knowhow.tab';

export default function Knowhow() {
  const { team, hasFeature } = useTeam();
  const locked = !hasFeature('consulting_knowhow');
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'mine' || params.get('tab') === 'playbook' ? (params.get('tab') as Tab)
    : (() => { try { return (localStorage.getItem(TAB_KEY) as Tab) || 'playbook'; } catch { return 'playbook'; } })();
  const setTab = (t: Tab) => { setParams({ tab: t }, { replace: true }); try { localStorage.setItem(TAB_KEY, t); } catch { /* 저장 불가 */ } };
  const [kind, setKind] = useState<KnowhowKind | 'all'>('all');
  const cards = useQuery({ queryKey: ['knowhow-cards', team.id], queryFn: () => q<KnowhowCard[]>(supabase.from('knowhow_cards').select('*').eq('team_id', team.id).order('pinned', { ascending: false }).order('created_at', { ascending: false })) });
  const tpls = usePlaybookTemplates();
  const sources = useQuery({
    queryKey: ['knowhow-sources', team.id],
    queryFn: () => q<KnowhowSource[]>(supabase.from('knowhow_sources').select('id, team_id, owner_id, title, file_name, mime_type, status, error, summary, card_count, created_at, file_path, raw_text').eq('team_id', team.id).order('created_at', { ascending: false }).limit(30)),
    refetchInterval: (qq) => (qq.state.data?.some((s) => s.status === 'processing') ? 3000 : false),
  });
  const retry = useMutation({
    mutationFn: (id: string) => invoke('ai-ingest-knowhow', { source_id: id }),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['knowhow-sources'] }); qc.invalidateQueries({ queryKey: ['knowhow-cards'] }); },
  });
  const delSrc = useMutation({
    mutationFn: async (s: KnowhowSource) => {
      if (s.file_path) await supabase.storage.from('knowhow').remove([s.file_path]);
      return q(supabase.from('knowhow_sources').delete().eq('id', s.id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowhow-sources'] }),
  });

  const mine = useMemo(() => (cards.data ?? []).filter((c) => !isConsulting(c)), [cards.data]);
  const playbook = useMemo<PlaybookCard[]>(() => {
    const byKey = new Map((tpls.data ?? []).map((t) => [t.key, t]));
    return (cards.data ?? []).filter(isConsulting).map((c) => ({ ...c, tpl: byKey.get(c.template_key ?? '') }));
  }, [cards.data, tpls.data]);
  const list = useMemo(() => mine.filter((c) => kind === 'all' || c.kind === kind), [mine, kind]);
  const counts = useMemo(() => mine.reduce((a, c) => ((a[c.kind] = (a[c.kind] ?? 0) + 1), a), {} as Record<string, number>), [mine]);
  const active = mine.filter((c) => c.active).length;
  const used = mine.reduce((a, c) => a + c.use_count, 0);

  return (
    <section>
      <PageHeader title="노하우 라이브러리" sub={aiText('AI가 일할 때 따르는 기준입니다 — 팀장님이 넣은 노하우가 먼저, 그다음 ATEAM Method™')} />
      <div className="mb-6">
        <Tabs value={tab} onChange={setTab} items={[
          { id: 'playbook', label: <><Library size={15} />{PLAYBOOK} <span className="num text-xs text-slate-400">{playbook.length}</span></> },
          { id: 'mine', label: <><BookOpen size={15} />내 노하우 <span className="num text-xs text-slate-400">{mine.length}</span></> },
        ]} />
      </div>

      {tab === 'playbook' ? (
        cards.isLoading ? <Spinner /> : !playbook.length ? (
          <Card><Empty icon={<Library size={18} />} title="Method 카드가 아직 없습니다">
            관리자가 29_playbook.sql 을 실행하면 이 팀에 기본 방법론 카드가 들어옵니다.
          </Empty></Card>
        ) : <PlaybookTab cards={playbook} locked={locked} ready={!tpls.isLoading} onAddMine={() => setTab('mine')} />
      ) : (
        <>
          <div className="mb-5 grid sm:grid-cols-3 gap-3 text-sm">
            {[['1', '던져 넣기', '메모·문서·PPT를 그대로'], ['2', 'AI가 카드로 정리', '원칙·기준·양식·맥락으로 나눠서'], ['3', '내 방식대로 일하는 AI', '리뷰·1on1·보고·평가에 가장 먼저 반영']].map(([n, t, d]) => (
              <div key={n} className="rounded-xl bg-white border border-slate-200 px-4 py-3 flex gap-3 items-start">
                <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{n}</span>
                <div><div className="font-semibold">{aiText(t)}</div><div className="text-xs text-slate-500">{d}</div></div>
              </div>
            ))}
          </div>
          <div className="grid lg:grid-cols-5 gap-5 items-start">
            <div className="lg:col-span-2 space-y-5">
              <Dump onDone={() => setKind('all')} />
              <QuickAdd />
              <Card>
                <CardHead title="넣은 자료" right={<span className="num">{sources.data?.length ?? 0}건</span>} />
                {!sources.data?.length ? <p className="px-5 py-4 text-sm text-slate-500">아직 없습니다.</p> : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {sources.data.map((s) => (
                      <li key={s.id} className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex-1 font-medium truncate">{s.title || s.file_name || '(제목 없음)'}</span>
                          {s.status === 'done' && <Pill tone="emerald">카드 {s.card_count}</Pill>}
                          {s.status === 'processing' && <Pill tone="violet"><span className="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse" />정리 중</Pill>}
                          {s.status === 'failed' && <Pill tone="rose">실패</Pill>}
                          {s.status === 'pending' && <Pill>대기</Pill>}
                          {(s.status === 'failed' || s.status === 'pending') && <button title="다시 정리" className="text-slate-400 hover:text-indigo-600" onClick={() => retry.mutate(s.id)}><RefreshCw size={13} /></button>}
                          <button title="자료 삭제 (카드는 남음)" className="text-slate-400 hover:text-rose-600" onClick={() => delSrc.mutate(s)}><Trash2 size={13} /></button>
                        </div>
                        {s.summary && <p className="text-xs text-slate-500 mt-1">{s.summary}</p>}
                        {s.status === 'failed' && <p className="text-xs text-rose-600 mt-1">{errorText(s.error ?? '')}</p>}
                        <p className="text-[11px] text-slate-400 mt-0.5">{fmtDate(s.created_at)}{s.file_name && ` · ${s.file_name}`}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>

            <div className="lg:col-span-3 space-y-4">
              <div className="text-sm text-slate-600">카드 <b className="font-mono">{mine.length}</b> · <CoreAI />가 사용 <b className="font-mono">{active}</b> · 지금까지 <CoreAI /> 결과에 <b className="font-mono">{used}</b>번 반영</div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-2.5 text-xs text-slate-600 leading-relaxed">
                팀장님 카드는 모든 <CoreAI /> 기능에서 <b>가장 먼저</b> 읽힙니다. {PLAYBOOK}와 어긋나면 팀장님 카드를 따릅니다.
              </div>
              <div className="flex gap-1.5 flex-wrap text-xs">
                <button onClick={() => setKind('all')} className={cx('rounded-full border px-3 py-1', kind === 'all' ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 bg-white')}>전체 {mine.length}</button>
                {(Object.keys(KIND) as KnowhowKind[]).map((k) => (
                  <button key={k} onClick={() => setKind(k)} title={KIND[k].desc}
                    className={cx('rounded-full border px-3 py-1', kind === k ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 bg-white')}>{KIND[k].label} {counts[k] ?? 0}</button>
                ))}
              </div>
              {cards.isLoading ? <Spinner /> : !list.length ? (
                <Card><Empty icon={<BookOpen size={18} />} title="아직 내 노하우가 없습니다">
                  왼쪽에 평소 쓰는 원칙이나 자료를 넣어 보세요. 예를 들어 "숫자 없는 보고는 받지 않는다"를 넣어 두면,
                  팀원이 결과물을 올렸을 때 <CoreAI /> 1차 검토가 그 기준에 맞는지부터 짚어 드립니다.
                </Empty></Card>
              ) : list.map((c) => <CardItem key={c.id} c={c} />)}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
