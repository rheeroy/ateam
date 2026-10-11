import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BadgeCheck, BookOpen, ClipboardList, Copy, FileText, MessageSquare, PenLine, PenSquare, RefreshCw, StickyNote } from 'lucide-react';
import { useTeam } from '../state/session';
import { useGenerate, useLatestAi, useUpdateAi } from '../lib/hooks';
import { addDays, cx, fmtDate, mondayOf, weekRangeLabel } from '../lib/format';
import { Button, Card, Empty, PageHeader, Spinner, inputCls, useToast } from '../components/ui';
import { ProvBlock, ProvChip, useAiMark } from '../components/Prov';

interface Row { task: string; owner: string; status: string; note: string }
interface WR { highlights: string[]; progress: Row[]; issues: string[]; next_week: string[]; missing?: string[]; counts?: Record<string, number> }

const STATUS_TONE: Record<string, string> = { '정상': 'text-emerald-700 bg-emerald-50', '완료': 'text-emerald-700 bg-emerald-50', '지연 우려': 'text-amber-800 bg-amber-50', '막힘': 'text-rose-700 bg-rose-50' };
const COUNT_LABEL: Record<string, [string, typeof FileText]> = {
  checkin: ['팀원 체크인', PenLine], task: ['과제 현황', ClipboardList], leader_note: ['팀장 메모', StickyNote], knowhow: ['내 노하우', BookOpen], one_on_one: ['1:1 기록', MessageSquare], submission: ['승인된 결과물', FileText],
};

/** 한 줄이 AI 원문과 같으면 AI 문장, 다르면 팀장이 고친 문장 */
function Line({ text, original }: { text: string; original: string[] }) {
  const { on } = useAiMark();
  const human = !original.includes(text);
  return (
    <p className={cx('text-slate-700 rounded px-1 -mx-1', on && !human && 'bg-violet-50', on && human && 'bg-white shadow-[inset_3px_0_0_#334155] pl-2')}>
      · {text}
      {human && <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-600 border border-slate-300 rounded px-1 ml-1.5 align-[2px]"><PenLine size={10} />팀장 수정</span>}
    </p>
  );
}

export default function Report() {
  const { team } = useTeam();
  const toast = useToast();
  const [week, setWeek] = useState(mondayOf());
  const NOTE_KEY = `ateam.report.notes.${team.id}.${week}`;
  const [notes, setNotesState] = useState('');
  useEffect(() => { try { setNotesState(localStorage.getItem(NOTE_KEY) ?? ''); } catch { setNotesState(''); } }, [NOTE_KEY]);
  const setNotes = (v: string) => { setNotesState(v); try { localStorage.setItem(NOTE_KEY, v); } catch { /* 저장 불가 환경 */ } };
  const rep = useLatestAi<WR>(team.id, 'weekly_report', { period_start: week });
  const gen = useGenerate('ai-weekly-report');
  const upd = useUpdateAi();
  const r = rep.data;
  const view: WR | null = r ? (r.edited_content ?? r.content) : null;
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<{ highlights: string; issues: string; next_week: string; progress: Row[] }>({ highlights: '', issues: '', next_week: '', progress: [] });
  useEffect(() => {
    if (view) setDraft({ highlights: view.highlights.join('\n'), issues: view.issues.join('\n'), next_week: view.next_week.join('\n'), progress: view.progress ?? [] });
    setEdit(false);
  }, [r?.id, r?.edited_at]);

  const lines = (s: string) => s.split('\n').map((x) => x.replace(/^[·\-\s]+/, '').trim()).filter(Boolean);
  function save() {
    if (!r) return;
    upd.mutate({ id: r.id, edited_content: { ...r.content, highlights: lines(draft.highlights), issues: lines(draft.issues), next_week: lines(draft.next_week), progress: draft.progress } });
    setEdit(false);
  }
  function asText(w: WR) {
    return [
      `[${team.name}] 주간 업무 보고 · ${weekRangeLabel(week)}`, '',
      '1. 주요 성과', ...w.highlights.map((x) => `· ${x}`), '',
      '2. 진행 현황', ...(w.progress ?? []).map((p) => `· ${p.task} (${p.owner}) — ${p.status}${p.note ? `: ${p.note}` : ''}`), '',
      '3. 이슈 및 요청 사항', ...w.issues.map((x) => `· ${x}`), '',
      '4. 다음 주 계획', ...w.next_week.map((x) => `· ${x}`),
    ].join('\n');
  }
  const kind = !r ? 'ai' : r.status === 'final' ? 'final' : r.status === 'edited' ? 'edited' : 'ai';
  const original = r ? [...r.content.highlights, ...r.content.issues, ...r.content.next_week] : [];

  return (
    <section>
      <PageHeader title="주간 업무 보고 초안" sub={`${team.name} · ${weekRangeLabel(week)}`}
        right={<>
          <div className="flex bg-slate-100 rounded-lg p-0.5 text-[13px]">
            {[mondayOf(), addDays(mondayOf(), -7)].map((w, i) => (
              <button key={w} onClick={() => setWeek(w)} className={cx('px-3 py-1 rounded-md', week === w ? 'bg-white shadow-sm font-semibold' : 'text-slate-500')}>{i === 0 ? '이번 주' : '지난주'}</button>
            ))}
          </div>
          {r && <Button variant="secondary" loading={gen.isPending} onClick={() => gen.mutate({ team_id: team.id, week_start: week, leader_notes: notes })}><RefreshCw size={14} />다시 만들기</Button>}
          {view && <Button variant="secondary" onClick={() => { navigator.clipboard.writeText(asText(view)); toast('클립보드에 복사했습니다'); }}><Copy size={14} />복사</Button>}
          {r && r.status !== 'final' && <Button onClick={() => upd.mutate({ id: r.id, status: 'final' })} loading={upd.isPending}><BadgeCheck size={15} />확정</Button>}
        </>} />

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <ProvBlock rail className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6 md:p-8 text-[15px] leading-7">
          {rep.isLoading ? <Spinner /> : !r || !view ? (
            <Empty icon={<ClipboardList size={18} />} title="이번 주 초안이 아직 없습니다"
              action={<Button loading={gen.isPending} onClick={() => gen.mutate({ team_id: team.id, week_start: week, leader_notes: notes })}>초안 만들기 · 2 크레딧</Button>}>
              팀원 체크인, 과제 현황, 1:1 기록과 오른쪽의 내 메모를 읽고 상위 조직장에게 보낼 보고서 초안을 씁니다. 팀원이 아직 없어도 메모 몇 줄이면 됩니다.
            </Empty>
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap mb-5">
                <ProvChip kind={kind} label={kind === 'edited' ? 'AI 초안 · 팀장 수정' : kind === 'final' ? '팀장 확정' : 'AI 초안'} sources={r.sources} level={r.level} depth={r.depth}
                  note="AI가 쓴 문장과 팀장님이 고친 문장을 구분해 보관합니다. 확정 전까지는 초안입니다." />
                {r.status !== 'final' && <span className="text-xs text-slate-400">확인 후 보내세요</span>}
                <span className="flex-1" />
                {!edit ? <Button size="sm" variant="ghost" onClick={() => setEdit(true)}><PenSquare size={13} />고치기</Button>
                  : <><Button size="sm" variant="ghost" onClick={() => setEdit(false)}>취소</Button><Button size="sm" onClick={save}>수정본 저장</Button></>}
              </div>
              {edit ? (
                <div className="space-y-5 text-sm">
                  {(['highlights', 'issues', 'next_week'] as const).map((k) => (
                    <label key={k} className="block"><span className="font-bold">{k === 'highlights' ? '1. 주요 성과' : k === 'issues' ? '3. 이슈 및 요청 사항' : '4. 다음 주 계획'}</span>
                      <textarea rows={4} className={cx(inputCls, 'mt-1.5 leading-6')} value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                      <span className="text-xs text-slate-400">한 줄에 한 항목</span>
                    </label>
                  ))}
                  <div><span className="font-bold">2. 진행 현황</span>
                    {draft.progress.map((p, i) => (
                      <div key={i} className="mt-2 grid grid-cols-[1fr_90px_110px_1.3fr] gap-2">
                        {(['task', 'owner', 'status', 'note'] as const).map((f) => (
                          <input key={f} aria-label={f} className={inputCls} value={p[f]} onChange={(e) => {
                            const next = [...draft.progress]; next[i] = { ...p, [f]: e.target.value }; setDraft({ ...draft, progress: next });
                          }} />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="font-bold text-slate-900">1. 주요 성과</h3>
                  {view.highlights.map((x, i) => <Line key={i} text={x} original={original} />)}
                  <h3 className="font-bold text-slate-900 mt-5">2. 진행 현황</h3>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-sm border border-slate-200 rounded-lg overflow-hidden">
                      <thead className="bg-slate-50 text-slate-500"><tr><th className="text-left font-semibold px-3 py-2">과제</th><th className="text-left font-semibold px-3 py-2">담당</th><th className="text-left font-semibold px-3 py-2">상태</th><th className="text-left font-semibold px-3 py-2">비고</th></tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {(view.progress ?? []).map((p, i) => (
                          <tr key={i}><td className="px-3 py-2">{p.task}</td><td className="px-3 py-2">{p.owner}</td>
                            <td className="px-3 py-2"><span className={cx('rounded px-1.5 text-xs font-semibold', STATUS_TONE[p.status] ?? 'bg-slate-100 text-slate-600')}>{p.status}</span></td>
                            <td className="px-3 py-2 text-slate-500">{p.note}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h3 className="font-bold text-slate-900 mt-5">3. 이슈 및 요청 사항</h3>
                  {view.issues.map((x, i) => <Line key={i} text={x} original={original} />)}
                  <h3 className="font-bold text-slate-900 mt-5">4. 다음 주 계획</h3>
                  {view.next_week.map((x, i) => <Line key={i} text={x} original={original} />)}
                </>
              )}
            </>
          )}
        </ProvBlock>

        <div className="space-y-5">
          <Card className="p-5 text-sm">
            <div className="font-semibold">이번 주 내 메모</div>
            <p className="text-xs text-slate-500 mt-1">체크인에 없는 것 — 본부 회의 결정, 내가 처리한 일, 윗선에 꼭 말할 것. 초안에 함께 반영됩니다.</p>
            <textarea aria-label="이번 주 내 메모" rows={5} className={cx(inputCls, 'mt-2 leading-6')} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={'예)\n- 본부 회의: 4분기 파트너 목표 유지 결정\n- B사 미팅, 데이터 공유 다음 주 확답\n- 채용 1명 승인 요청 예정'} />
            <p className="mt-1 text-[11px] text-slate-400">이 브라우저에 임시 저장됩니다. 초안을 만들면 근거로 기록됩니다.</p>
          </Card>
          {r && (
            <Card className="p-5 text-sm">
              <div className="font-semibold">이 초안의 근거</div>
              <ul className="mt-3 space-y-2 text-slate-600">
                {Object.entries(r.content.counts ?? {}).map(([k, v]) => {
                  const [label, Icon] = COUNT_LABEL[k] ?? [k, FileText];
                  return <li key={k} className="flex items-center gap-2"><Icon size={15} className="text-indigo-600" />{label} {v}건</li>;
                })}
              </ul>
              <p className="mt-3 text-xs text-slate-400">{fmtDate(r.created_at, true)} 생성 · {r.model}</p>
            </Card>
          )}
          {!!r?.content.missing?.length && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm">
              <div className="font-semibold text-amber-900 flex items-center gap-2"><AlertTriangle size={15} />빠진 내용이 있어요</div>
              <p className="mt-2 text-amber-900/80">{r.content.missing.join(', ')} 님이 이번 주 체크인을 내지 않았습니다. 해당 과제는 지난 기록 기준으로 작성됐습니다.</p>
              <button className="mt-3 text-sm font-semibold text-amber-900 underline underline-offset-2"
                onClick={() => { navigator.clipboard.writeText(`이번 주 체크인 부탁드립니다. 1분이면 됩니다 → ${window.location.origin}/checkin`); toast('체크인 요청 문구를 복사했습니다. 메신저에 붙여 넣으세요.'); }}>
                체크인 요청 문구 복사
              </button>
            </div>
          )}
          <Card className="p-5 text-xs text-slate-500 leading-relaxed">
            보고서는 체크인과 과제 기록에서 나옵니다. 팀원이 체크인을 꾸준히 쓰면 초안 품질이 올라갑니다. <Link to="/insight" className="text-violet-700">AI 인사이트 레벨 보기</Link>
          </Card>
        </div>
      </div>
    </section>
  );
}
