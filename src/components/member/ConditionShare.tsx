// 팀원: 이번 주 컨디션 — '팀장님과' 맨 위 한 줄. 업무 이야기는 넣지 않는다 (업무는 업무플랫폼에서).
//   기본은 한 줄(컨디션 1~5). 영향 요인·메모·지난 기록은 펼쳐서.
//   누르면 바로 공유: 컨디션 5단계 · 영향 요인(복수) · 선택 메모. (1on1 요청은 페이지 우측 상단 버튼)
//   팀장만 본다. 팀 컨디션 · 챙길 사람 신호 · 1on1 준비에만 쓰이고, 평가·주간보고에는 쓰지 않는다.
//   데이터: checkins(condition · moods · note) — 24_condition.sql
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Check, ChevronDown, Plus } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import type { Checkin as C } from '../../lib/types';
import { cx, mondayOf, weekLabel, weekRangeLabel } from '../../lib/format';
import { CONDITIONS, MOODS, condDot, conditionLabel, moodLabel } from '../../lib/condition';
import { Card, useToast } from '../ui';

export function useMyConditions() {
  const { team, uid } = useTeam();
  return useQuery({
    queryKey: ['checkins', team.id, uid],
    queryFn: () => q<C[]>(supabase.from('checkins').select('*').eq('team_id', team.id).eq('user_id', uid).order('week_start', { ascending: false }).limit(8)),
  });
}

type Cur = { condition: number | null; moods: string[]; note: string };

export function ConditionShare() {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const week = mondayOf();
  const history = useMyConditions();
  const mine = history.data?.find((c) => c.week_start === week);
  const past = (history.data ?? []).filter((c) => c.week_start !== week).slice(0, 6).reverse();

  const [cur, setCur] = useState<Cur>({ condition: null, moods: [], note: '' });
  const [noteOpen, setNoteOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const dirty = useRef(false);
  useEffect(() => {
    if (dirty.current) return;
    const c = { condition: mine?.condition ?? null, moods: mine?.moods ?? [], note: mine?.note ?? '' };
    setCur(c); setNoteDraft(c.note);
  }, [mine]);

  const save = useMutation({
    mutationFn: (c: Cur) => q(supabase.from('checkins').upsert(
      { team_id: team.id, user_id: uid, week_start: week, condition: c.condition, moods: c.moods, note: c.note },
      { onConflict: 'team_id,user_id,week_start' })),
    onSuccess: () => { dirty.current = false; ['checkins', 'member-badges'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e) => {
      dirty.current = false;
      const t = errorText(e);
      toast(/moods|note|column/i.test(t) ? '컨디션 SQL(24_condition.sql)을 먼저 실행해 주세요.' : t);
      qc.invalidateQueries({ queryKey: ['checkins'] });
    },
  });
  const push = (c: Cur) => { dirty.current = true; setCur(c); save.mutate(c); };

  const toggle = (k: string) => {
    const on = cur.moods.includes(k);
    push({ ...cur, moods: on ? cur.moods.filter((x) => x !== k) : [...cur.moods, k] });
  };
  const saveNote = () => { const v = noteDraft.trim().slice(0, 80); if (v !== cur.note) push({ ...cur, note: v }); if (!v) setNoteOpen(false); };


  const extra = cur.moods.length + (cur.note ? 1 : 0);
  const summary = cur.moods.length ? `${moodLabel(cur.moods[0])}${cur.moods.length > 1 ? ` 외 ${cur.moods.length - 1}` : ''}` : cur.note ? '메모' : '';

  return (
    <Card className="px-4 py-3">
      <div className="flex flex-col md:flex-row md:items-center gap-2.5 md:gap-4">
        <div className="flex items-baseline gap-2 shrink-0">
          <Activity size={15} className="text-slate-500 self-center" />
          <span className="font-semibold text-sm">이번 주 컨디션</span>
          <span className="text-[11px] text-slate-400">{weekRangeLabel(week)}</span>
        </div>
        <div className="flex-1 grid grid-cols-5 rounded-lg ring-1 ring-slate-200 overflow-hidden divide-x divide-slate-200" role="radiogroup" aria-label="이번 주 컨디션">
          {CONDITIONS.map((o) => {
            const on = cur.condition === o.n;
            return (
              <button key={o.n} type="button" role="radio" aria-checked={on} onClick={() => push({ ...cur, condition: on ? null : o.n })}
                className={cx('py-1.5 px-1 flex items-center justify-center gap-1.5 text-xs transition-colors', on ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-50')}>
                <span className={cx('font-mono num', on ? 'font-bold' : 'font-semibold text-slate-700')}>{o.n}</span>
                <span className="hidden sm:inline whitespace-nowrap">{o.label}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => setMore((x) => !x)} aria-expanded={more}
          className={cx('shrink-0 self-start md:self-auto inline-flex items-center gap-1 text-xs rounded-md px-2 py-1.5 hover:bg-slate-50', extra ? 'text-slate-700' : 'text-slate-500')}>
          {summary || '영향 요인 · 메모'}<ChevronDown size={13} className={cx('transition-transform', more && 'rotate-180')} />
        </button>
      </div>

      {more && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {MOODS.map((m) => {
              const on = cur.moods.includes(m.key);
              return (
                <button key={m.key} type="button" aria-pressed={on} onClick={() => toggle(m.key)}
                  className={cx('rounded-md px-2.5 py-1 text-xs ring-1 transition-colors inline-flex items-center gap-1',
                    on ? 'bg-slate-800 text-white ring-slate-800' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50')}>
                  {on && <Check size={11} />}{m.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {!noteOpen && !cur.note ? (
              <button type="button" onClick={() => setNoteOpen(true)} className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"><Plus size={12} />메모 추가 (선택)</button>
            ) : (
              <input autoFocus={noteOpen && !cur.note} value={noteDraft} maxLength={80} onChange={(e) => setNoteDraft(e.target.value)} onBlur={saveNote}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                placeholder="예) 이번 주 이사 일정으로 오후 시간이 유동적입니다"
                className="flex-1 min-w-[12rem] text-sm border-0 border-b border-slate-200 px-0 py-1 placeholder:text-slate-300 focus:outline-none focus:ring-0 focus:border-slate-500 bg-transparent" />
            )}
            {past.length > 0 && (
              <div className="ml-auto flex items-center gap-2.5">
                <span className="text-[11px] text-slate-400">최근</span>
                {past.map((c) => (
                  <span key={c.id} className="flex flex-col items-center gap-0.5"
                    title={[conditionLabel(c.condition) ?? '컨디션 미입력', ...(c.moods ?? []).map(moodLabel), c.note].filter(Boolean).join(' · ')}>
                    <span className={cx('w-2 h-2 rounded-full', condDot(c.condition))} />
                    <span className="font-mono text-[9px] text-slate-400">{weekLabel(c.week_start)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
