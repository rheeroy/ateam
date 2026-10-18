// 팀원: 내 기록 — 이번 분기에 내가 한 일 (승인된 결과물 · 마무리한 일 · 받은 칭찬 · 지킨 약속 · 체크인)
// 평가 점수나 근거 원장은 보여 주지 않는다. 본인 성과의 기록으로만.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Award, CheckCircle2, FileCheck2, Flag, PenLine } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q } from '../lib/supabase';
import { cx, fmtDate } from '../lib/format';
import { Card, PageHeader, Spinner } from '../components/ui';

function quarter(offset: number) {
  const d = new Date(); const qi = Math.floor(d.getMonth() / 3) + offset;
  const y = d.getFullYear() + Math.floor(qi / 4); const qq = ((qi % 4) + 4) % 4;
  const from = new Date(y, qq * 3, 1), to = new Date(y, qq * 3 + 3, 1);
  return { label: `${y}년 ${qq + 1}분기`, from: from.toISOString(), to: to.toISOString(), fromYmd: from.toISOString().slice(0, 10), toYmd: to.toISOString().slice(0, 10) };
}

export default function MyRecord() {
  const { team, uid, nameOf } = useTeam();
  const [off, setOff] = useState(0);
  const Q = quarter(off);
  const data = useQuery({
    queryKey: ['my-record', team.id, uid, Q.from],
    queryFn: async () => {
      const [subs, items, praise, acts, cis] = await Promise.all([
        q<{ id: string; title: string; approved_at: string | null; updated_at: string }[]>(supabase.from('submissions').select('id, title, approved_at, updated_at').eq('team_id', team.id).eq('author_id', uid).eq('status', 'approved').gte('updated_at', Q.from).lt('updated_at', Q.to).order('updated_at', { ascending: false })),
        q<{ id: string; title: string; done_at: string | null; updated_at: string }[]>(supabase.from('work_items').select('id, title, done_at, updated_at').eq('team_id', team.id).eq('owner_id', uid).eq('status', 'done').gte('updated_at', Q.from).lt('updated_at', Q.to).order('updated_at', { ascending: false })),
        q<{ id: string; author_id: string; body: string; occurred_at: string }[]>(supabase.from('observations').select('id, author_id, body, occurred_at').eq('team_id', team.id).eq('subject_id', uid).eq('kind', 'praise').gte('occurred_at', Q.from).lt('occurred_at', Q.to).order('occurred_at', { ascending: false })),
        q<{ id: string; title: string; done_at: string }[]>(supabase.from('action_items').select('id, title, done_at').eq('team_id', team.id).eq('owner_id', uid).gte('done_at', Q.from).lt('done_at', Q.to).order('done_at', { ascending: false })),
        q<{ id: string }[]>(supabase.from('checkins').select('id').eq('team_id', team.id).eq('user_id', uid).gte('week_start', Q.fromYmd).lt('week_start', Q.toYmd)),
      ]);
      return { subs, items, praise, acts, cis: cis.length };
    },
  });
  const d = data.data;
  // 분기 안에 시작한 주(월요일) 수 — 오늘까지
  const weeks = (() => { let n = 0; const end = Math.min(Date.now(), Date.parse(Q.to)); for (let t = Date.parse(Q.from); t < end; t += 86400000) if (new Date(t).getDay() === 1) n++; return Math.max(1, n); })();
  const stats = d ? [
    { k: '승인된 결과물', v: d.subs.length, I: FileCheck2, c: 'text-indigo-600 bg-indigo-50' },
    { k: '마무리한 일', v: d.items.length, I: Flag, c: 'text-emerald-600 bg-emerald-50' },
    { k: '받은 칭찬', v: d.praise.length, I: Award, c: 'text-amber-600 bg-amber-50' },
    { k: '지킨 약속', v: d.acts.length, I: CheckCircle2, c: 'text-teal-600 bg-teal-50' },
    { k: '체크인', v: `${Math.min(d.cis, weeks)}/${weeks}주`, I: PenLine, c: 'text-violet-600 bg-violet-50' },
  ] : [];
  return (
    <section>
      <PageHeader title="내 기록" sub="이번 분기에 내가 해낸 것들이 모입니다. 나만 보는 화면입니다"
        right={<div className="inline-flex rounded-lg bg-white ring-1 ring-slate-200 p-0.5 text-sm">
          {[0, -1].map((o) => <button key={o} onClick={() => setOff(o)} className={cx('px-3 py-1.5 rounded-md', off === o ? 'bg-slate-900 text-white font-semibold' : 'text-slate-600')}>{o === 0 ? '이번 분기' : '지난 분기'}</button>)}
        </div>} />
      {data.isLoading || !d ? <Spinner /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {stats.map((s) => (
              <Card key={s.k} className="p-4">
                <span className={cx('w-8 h-8 rounded-lg inline-flex items-center justify-center', s.c)}><s.I size={16} /></span>
                <div className="mt-2 text-2xl font-bold num">{s.v}</div>
                <div className="text-xs text-slate-500">{s.k}</div>
              </Card>
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-5 items-start">
            <Card className="p-5">
              <div className="font-semibold flex items-center gap-2"><Award size={16} className="text-amber-600" />받은 칭찬</div>
              {!d.praise.length ? <p className="mt-3 text-sm text-slate-500">{Q.label}에 받은 칭찬이 아직 없습니다.</p> : (
                <ul className="mt-3 space-y-3">{d.praise.map((o) => (
                  <li key={o.id} className="rounded-xl bg-amber-50/60 ring-1 ring-amber-100 px-3 py-2.5 text-sm">
                    <p className="text-slate-800">"{o.body.replace(/^\[칭찬 배지\]\s*/, '')}"</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{nameOf(o.author_id)} · {fmtDate(o.occurred_at)}</p>
                  </li>))}</ul>
              )}
            </Card>
            <div className="space-y-5">
              <Card className="p-5">
                <div className="font-semibold flex items-center gap-2"><FileCheck2 size={16} className="text-indigo-600" />승인된 결과물</div>
                {!d.subs.length ? <p className="mt-3 text-sm text-slate-500">아직 없습니다.</p> : (
                  <ul className="mt-2 divide-y divide-slate-100">{d.subs.map((s) => (
                    <li key={s.id}><Link to={`/work/${s.id}`} className="flex items-center gap-2 py-2 text-sm hover:text-indigo-700"><span className="flex-1 truncate">{s.title}</span><span className="text-xs text-slate-400">{fmtDate(s.approved_at ?? s.updated_at)}</span></Link></li>))}</ul>
                )}
              </Card>
              <Card className="p-5">
                <div className="font-semibold flex items-center gap-2"><Flag size={16} className="text-emerald-600" />마무리한 일</div>
                {!d.items.length ? <p className="mt-3 text-sm text-slate-500">아직 없습니다.</p> : (
                  <ul className="mt-2 space-y-1.5 text-sm">{d.items.map((i) => <li key={i.id} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 text-emerald-500 shrink-0" /><span className="flex-1">{i.title}</span><span className="text-xs text-slate-400">{fmtDate(i.done_at ?? i.updated_at)}</span></li>)}</ul>
                )}
              </Card>
              {!!d.acts.length && (
                <Card className="p-5">
                  <div className="font-semibold flex items-center gap-2"><CheckCircle2 size={16} className="text-teal-600" />1:1에서 지킨 약속</div>
                  <ul className="mt-2 space-y-1.5 text-sm">{d.acts.map((a) => <li key={a.id} className="flex gap-2"><span className="flex-1">{a.title}</span><span className="text-xs text-slate-400">{fmtDate(a.done_at)}</span></li>)}</ul>
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
