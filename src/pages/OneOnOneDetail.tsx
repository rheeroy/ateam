import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { NotesBox } from '../components/notes/Notes';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, ListChecks, Lock, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, errorText } from '../lib/supabase';
import { useGenerate, useLatestAi } from '../lib/hooks';
import type { ActionItem, OneOnOne } from '../lib/types';
import { cx, fmtDate, fmtTime } from '../lib/format';
import { Button, Card, Empty, PageHeader, Pill, Spinner, Tabs, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, TaggedText, kindFromStatus } from '../components/Prov';

interface Prep {
  last_time: string;
  since: { tag?: string; text: string }[];
  open_promises: { owner: string; text: string; overdue?: boolean }[];
  recent_work: string;
  watch: string;
  questions: string[];
}

function PrepPanel({ oo, onAddQuestion }: { oo: OneOnOne; onAddQuestion: (q: string) => void }) {
  const prep = useLatestAi<Prep>(oo.team_id, 'one_on_one_prep', { ref_table: 'one_on_ones', ref_id: oo.id });
  const gen = useGenerate('ai-prep-1on1');
  const p = prep.data;
  return (
    <ProvBlock rail className="lg:col-span-2 bg-white rounded-2xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold">준비 노트
          {p && <ProvChip kind={kindFromStatus(p.status)} label="AI 생성" sources={p.sources} level={p.level} depth={p.depth}
            note="질문은 기록에서 비어 있는 부분을 짚도록 만들었습니다." />}
        </div>
        {p && <Button size="sm" variant="ghost" loading={gen.isPending} onClick={() => gen.mutate({ one_on_one_id: oo.id })}><RefreshCw size={12} />다시</Button>}
      </div>
      {prep.isLoading ? <Spinner /> : !p ? (
        <Empty icon={<Sparkles size={18} />} title="면담 전 2분 요약"
          action={<Button loading={gen.isPending} onClick={() => gen.mutate({ one_on_one_id: oo.id })}>준비 노트 만들기 · 구독 포함</Button>}>
          지난 1on1 이후의 컨디션 공유, 남은 약속, 최근 결과물을 읽고 오늘 물어볼 질문을 정리합니다.
        </Empty>
      ) : (
        <div className="p-5 space-y-5 text-sm">
          {p.content.last_time && (
            <div><div className="text-xs font-semibold text-slate-400 mb-1.5">지난 1on1</div>
              <p className="leading-relaxed text-slate-700"><TaggedText text={p.content.last_time} sources={p.sources} /></p></div>
          )}
          {!!p.content.since?.length && (
            <div><div className="text-xs font-semibold text-slate-400 mb-2">그 사이 있었던 일</div>
              <ul className="space-y-1.5">{p.content.since.map((s, i) => (
                <li key={i} className="flex gap-2 text-slate-700"><span className="text-slate-300">·</span><span><TaggedText text={s.text} sources={p.sources} />{s.tag && <TaggedText text={` [${s.tag}]`} sources={p.sources} />}</span></li>
              ))}</ul></div>
          )}
          {!!p.content.open_promises?.length && (
            <div><div className="text-xs font-semibold text-slate-400 mb-2">아직 안 끝난 약속</div>
              <ul className="space-y-1.5">{p.content.open_promises.map((a, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className={cx('text-[10px] font-semibold rounded px-1.5 py-0.5', a.owner.includes('팀장') ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600')}>{a.owner}</span>
                  <span className="flex-1">{a.text}</span>{a.overdue && <span className="text-xs text-rose-600">기한 지남</span>}
                </li>
              ))}</ul></div>
          )}
          {p.content.recent_work && <div className="rounded-xl border border-slate-200 p-3"><div className="text-xs font-semibold text-slate-400 mb-1">최근 결과물</div><TaggedText text={p.content.recent_work} sources={p.sources} /></div>}
          {p.content.watch && <div className="rounded-xl bg-amber-50 text-amber-900 p-3"><div className="text-xs font-semibold mb-1">오늘 살필 점</div><TaggedText text={p.content.watch} sources={p.sources} /></div>}
          <div><div className="text-xs font-semibold text-slate-400 mb-2">오늘 물어볼 만한 질문</div>
            <ol className="space-y-2">{(p.content.questions ?? []).map((qq, i) => (
              <li key={i} className="flex gap-2 items-start"><span className="font-mono text-xs text-indigo-600 mt-0.5">{i + 1}</span><span className="flex-1">{qq}</span>
                <button className="text-slate-400 hover:text-indigo-600" title="노트에 추가" onClick={() => onAddQuestion(qq)}><Plus size={15} /></button></li>
            ))}</ol></div>
        </div>
      )}
    </ProvBlock>
  );
}

function ActionItems({ oo }: { oo: OneOnOne }) {
  const { uid, nameOf, isLeader } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState(oo.member_id);
  const [due, setDue] = useState('');
  const items = useQuery({
    queryKey: ['actions', oo.id],
    queryFn: () => q<ActionItem[]>(supabase.from('action_items').select('*').eq('one_on_one_id', oo.id).order('created_at')),
  });
  const add = useMutation({
    mutationFn: () => q(supabase.from('action_items').insert({ team_id: oo.team_id, one_on_one_id: oo.id, owner_id: owner, title, due_date: due || null, created_by: uid })),
    onSuccess: () => { setTitle(''); setDue(''); qc.invalidateQueries({ queryKey: ['actions', oo.id] }); qc.invalidateQueries({ queryKey: ['promises'] }); },
    onError: (e) => toast(errorText(e)),
  });
  const toggle = useMutation({
    mutationFn: (a: ActionItem) => q(supabase.from('action_items').update({ done_at: a.done_at ? null : new Date().toISOString() }).eq('id', a.id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['actions', oo.id] }); qc.invalidateQueries({ queryKey: ['promises'] }); },
  });
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-2"><ListChecks size={16} className="text-indigo-600" />액션아이템</div><span className="text-xs text-slate-400">다음 1on1 준비 노트에서 자동으로 확인합니다</span></div>
      <ul className="mt-3 space-y-2 text-sm">
        {(items.data ?? []).map((a) => (
          <li key={a.id} className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2">
            <button onClick={() => toggle.mutate(a)} className={a.done_at ? 'text-emerald-600' : 'text-slate-300 hover:text-indigo-600'} title="완료 표시">
              {a.done_at ? <CheckCircle2 size={16} /> : <Circle size={16} />}
            </button>
            <span className={cx('text-[10px] font-semibold rounded px-1.5 py-0.5', a.owner_id === oo.leader_id ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600')}>{a.owner_id === oo.leader_id ? '팀장' : nameOf(a.owner_id)}</span>
            <span className={cx('flex-1', a.done_at && 'line-through text-slate-400')}>{a.title}</span>
            <span className="text-xs text-slate-500">{a.due_date ? fmtDate(a.due_date) : ''}</span>
          </li>
        ))}
      </ul>
      <form className="mt-3 grid grid-cols-2 sm:grid-cols-[1fr_auto_auto_auto] gap-2" onSubmit={(e) => { e.preventDefault(); if (title.trim()) add.mutate(); }}>
        <input aria-label="새 액션아이템" value={title} onChange={(e) => setTitle(e.target.value)} className={cx(inputCls, 'col-span-2 sm:col-span-1')} placeholder="할 일 추가…" />
        <select aria-label="담당" value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls}>
          <option value={oo.member_id}>{nameOf(oo.member_id)}</option>
          <option value={oo.leader_id}>팀장{isLeader ? '(나)' : ''}</option>
        </select>
        <input aria-label="기한" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
        <Button type="submit" variant="soft" loading={add.isPending}>추가</Button>
      </form>
    </Card>
  );
}

export default function OneOnOneDetail() {
  const { id } = useParams();
  const { isLeader, nameOf, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'shared' | 'private'>('shared');
  const [shared, setShared] = useState('');
  const [priv, setPriv] = useState('');

  const oo = useQuery({ queryKey: ['oo-detail', id], queryFn: () => q<OneOnOne>(supabase.from('one_on_ones').select('*').eq('id', id!).single()) });
  const privQ = useQuery({
    queryKey: ['oo-private', id], enabled: isLeader,
    queryFn: () => q<{ notes: string } | null>(supabase.from('one_on_one_private').select('notes').eq('one_on_one_id', id!).maybeSingle()),
  });
  useEffect(() => { if (oo.data) setShared(oo.data.shared_notes); }, [oo.data]);
  useEffect(() => { if (privQ.data) setPriv(privQ.data.notes); }, [privQ.data]);

  const saveShared = useMutation({
    mutationFn: () => q(supabase.from('one_on_ones').update({ shared_notes: shared }).eq('id', id!)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['oo-detail', id] }),
    onError: (e) => toast(errorText(e)),
  });
  const savePriv = useMutation({
    mutationFn: () => q(supabase.from('one_on_one_private').upsert({ one_on_one_id: id, team_id: oo.data!.team_id, leader_id: uid, notes: priv })),
    onError: (e) => toast(errorText(e)),
  });
  const complete = useMutation({
    mutationFn: async () => {
      await q(supabase.from('one_on_ones').update({ shared_notes: shared }).eq('id', id!));
      if (priv) await q(supabase.from('one_on_one_private').upsert({ one_on_one_id: id, team_id: oo.data!.team_id, leader_id: uid, notes: priv }));
      return q(supabase.from('one_on_ones').update({ status: 'done' }).eq('id', id!));
    },
    onSuccess: () => { toast('면담을 기록했습니다. 노트는 근거로 쌓입니다.'); qc.invalidateQueries({ queryKey: ['oo-detail', id] }); qc.invalidateQueries({ queryKey: ['oo'] }); qc.invalidateQueries({ queryKey: ['insight'] }); },
    onError: (e) => toast(errorText(e)),
  });

  if (oo.isLoading) return <Spinner />;
  if (!oo.data) return <Empty title="면담을 찾을 수 없습니다" />;
  const o = oo.data;
  const addQuestion = (text: string) => { setShared((s) => (s ? s + '\n' : '') + `· ${text}`); setTab('shared'); toast('노트에 추가했습니다'); };

  return (
    <section>
      <PageHeader
        back={<Link to={isLeader ? '/people' : '/my/one-on-ones'} className="text-sm text-slate-500 hover:text-slate-800">← 목록으로</Link>}
        title={isLeader ? `${nameOf(o.member_id)} 님과의 1on1` : `${nameOf(o.leader_id)} 팀장님과의 1on1`}
        sub={`${fmtDate(o.scheduled_at, true)} ${fmtTime(o.scheduled_at)} · ${o.duration_min}분`}
        right={o.status === 'done' ? <Pill tone="emerald"><CheckCircle2 size={12} />완료됨</Pill>
          : isLeader ? <Button loading={complete.isPending} onClick={() => complete.mutate()}><CheckCircle2 size={15} />면담 완료로 기록</Button> : <Pill>예정</Pill>}
      />
      <div className={cx('grid gap-5 items-start', isLeader && 'lg:grid-cols-5')}>
        {isLeader && <PrepPanel oo={o} onAddQuestion={addQuestion} />}
        <div className={cx('space-y-5', isLeader && 'lg:col-span-3')}>
          <Card>
            <div className="px-5 pt-3">
              <Tabs value={tab} onChange={setTab} items={isLeader
                ? [{ id: 'shared', label: '함께 보는 노트' }, { id: 'private', label: <><Lock size={13} />팀장 메모</> }]
                : [{ id: 'shared', label: '함께 보는 노트' }]} />
            </div>
            {tab === 'shared' ? (
              <div className="p-5">
                <textarea aria-label="함께 보는 노트" rows={10} value={shared} onChange={(e) => setShared(e.target.value)} onBlur={() => shared !== o.shared_notes && saveShared.mutate()}
                  className={cx(inputCls, 'leading-7 min-h-[200px]')} placeholder="면담하면서 정리하세요. 팀원도 볼 수 있고, 함께 고칠 수 있습니다." />
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>이 노트와 액션아이템은 {isLeader ? `${nameOf(o.member_id)} 님도` : '팀장님도'} 볼 수 있습니다.</span>
                  <span>{saveShared.isPending ? '저장 중…' : '입력 칸을 벗어나면 저장됩니다'}</span>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <textarea aria-label="팀장 메모" rows={8} value={priv} onChange={(e) => setPriv(e.target.value)} onBlur={() => savePriv.mutate()}
                  className={cx(inputCls, 'leading-7')} placeholder="팀장만 보는 메모. 평가 초안의 근거로 쓰일 수 있습니다." />
                <p className="mt-2 text-[11px] text-slate-400 inline-flex items-center gap-1"><Lock size={11} />팀장만 볼 수 있습니다. 평가 초안의 근거로 쓰일 수 있습니다.</p>
              </div>
            )}
          </Card>
          <ActionItems oo={o} />
          {isLeader && <NotesBox anchor={{ type: 'member', id: o.member_id, label: nameOf(o.member_id) }} title={`${nameOf(o.member_id)} 님에 대한 내 메모`} />}
        </div>
      </div>
    </section>
  );
}
