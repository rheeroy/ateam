// AI 계획: 자료 → 초안 / 말 → 변경안. 언제나 '제안'이고, 수락한 것만 반영한다.
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileUp, Sparkles, Wand2 } from 'lucide-react';
import { yearOf } from '../../lib/plan';
import { useTeam } from '../../state/session';
import { supabase, invoke, errorText } from '../../lib/supabase';
import type { AiOutput } from '../../lib/types';
import { ACCEPT_KNOWHOW, extractText, safeName } from '../../lib/extract';
import { applyOps, ownerIdOf, useLevelNames, type Node, type PlanOp } from '../../lib/items';
import { cx, fmtShort } from '../../lib/format';
import { Button, ErrorBox, Field, Modal, inputCls, useToast } from '../ui';
import { ProvChip } from '../Prov';

interface PlanOut { summary: string; ops: PlanOp[] }

const OP_META = {
  add: { label: '추가', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  update: { label: '수정', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  move: { label: '이동', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  delete: { label: '중단', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
} as const;
const FIELD_LABEL: Record<string, string> = { title: '제목', note: '설명', owner: '담당', start_date: '시작', due_date: '마감', status: '상태', measure: '측정', num_target: '목표값', progress: '진척', priority: '우선순위', contribution: '기여도' };

/** 변경안 검토 화면 (항목별 체크 → 반영) */
function OpsReview({ out, byId, onDone, parentId, year }: { out: AiOutput<PlanOut>; byId: Map<string, Node>; onDone: () => void; parentId?: string | null; year?: number }) {
  const { team, members, isLeader, uid, nameOf } = useTeam();
  const levelName = useLevelNames();
  const toast = useToast();
  const qc = useQueryClient();
  const ops = out.content.ops ?? [];
  const [sel, setSel] = useState<Set<number>>(() => new Set(ops.map((_, i) => i)));
  const [busy, setBusy] = useState(false);
  const refTitle = (p: string | null | undefined) => (p == null ? null : byId.get(p)?.title ?? ops.find((o) => o.ref === p)?.title ?? p);
  const depthOfOp = (o: PlanOp): number => {
    if (!o.parent) return parentId ? (byId.get(parentId)?.depth ?? -1) + 1 : 0;
    const ex = byId.get(o.parent); if (ex) return ex.depth + 1;
    const par = ops.find((x) => x.ref === o.parent); return par ? depthOfOp(par) + 1 : 0;
  };
  const apply = async () => {
    setBusy(true);
    const chosen = ops.filter((_, i) => sel.has(i));
    // 부모를 빼고 자식만 고르면 자식은 상위(범위)로 붙는다
    const refs = new Set(chosen.filter((o) => o.op === 'add').map((o) => o.ref));
    const fixed = chosen.map((o) => (o.op === 'add' && o.parent && !byId.has(o.parent) && !refs.has(o.parent) ? { ...o, parent: null } : o));
    const errs = await applyOps(team.id, fixed, members, { asMember: isLeader ? undefined : uid, fallbackParent: parentId ?? null, rootYear: year });
    setBusy(false);
    qc.invalidateQueries({ queryKey: ['items', team.id] });
    qc.invalidateQueries({ queryKey: ['home-insights'] });
    if (errs.length) toast(`일부 반영 실패: ${errs[0]}`); else toast(isLeader ? `${chosen.length}건 반영했습니다` : `${chosen.length}건을 팀장에게 검토 요청했습니다`);
    onDone();
  };
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-sm text-slate-700">
        <ProvChip kind="ai" label="AI 제안" sources={out.sources} level={out.level} depth={out.depth} note="수락한 항목만 반영됩니다. 반영 후에도 자유롭게 고칠 수 있습니다." />
        <p className="flex-1">{out.content.summary}</p>
      </div>
      {!ops.length ? <p className="text-sm text-slate-500">바꿀 것을 찾지 못했습니다. 지시를 조금 더 구체적으로 적어 보세요.</p> : (
        <ul className="max-h-[50vh] overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {ops.map((o, i) => {
            const meta = OP_META[o.op] ?? OP_META.update;
            const target = o.id ? byId.get(o.id) : null;
            const owner = o.op === 'add' ? o.owner : (o.set?.owner as string | undefined);
            const ownerMissing = owner && !ownerIdOf(owner, members);
            return (
              <li key={i} className="px-3 py-2.5 flex gap-2.5 text-sm" style={{ paddingLeft: o.op === 'add' ? 12 + depthOfOp(o) * 16 : 12 }}>
                <input type="checkbox" className="mt-1 accent-indigo-600" checked={sel.has(i)} aria-label="이 변경 반영"
                  onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(i); else n.delete(i); setSel(n); }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cx('text-[11px] font-semibold border rounded px-1.5', meta.cls)}>{meta.label}</span>
                    {o.op === 'add' && <span className="text-[11px] text-slate-400">{levelName(depthOfOp(o))}</span>}
                    <span className="font-medium">{o.op === 'add' ? o.title : target?.title ?? o.id}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 space-x-2">
                    {o.op === 'add' && <>
                      {o.parent && <span>상위: {refTitle(o.parent)}</span>}
                      {owner && <span className={ownerMissing ? 'text-rose-600' : ''}>담당 {owner}{ownerMissing ? '(팀원 아님 → 미정)' : ''}</span>}
                      {(o.start_date || o.due_date) && <span>{o.start_date ? fmtShort(o.start_date) : ''}~{o.due_date ? fmtShort(o.due_date) : ''}</span>}
                      {o.num_target != null && <span>목표 {o.num_target}{o.unit}</span>}
                    </>}
                    {o.op === 'update' && Object.entries(o.set ?? {}).map(([k, v]) => {
                      const raw = (target as unknown as Record<string, unknown>)?.[k === 'owner' ? 'owner_id' : k];
                      const before = k === 'owner' ? (nameOf(raw as string) || '미정') : String(raw ?? '-');
                      return <span key={k}>{FIELD_LABEL[k] ?? k}: <s className="text-slate-400">{before.slice(0, 20)}</s> → <b className="text-slate-700">{String(v)}</b></span>;
                    })}
                    {o.op === 'move' && <span>→ {refTitle(o.parent) ?? '최상위'}</span>}
                  </div>
                  {o.reason && <div className="text-[11px] text-slate-400 mt-0.5">{o.reason}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex gap-2">
        <Button onClick={apply} loading={busy} disabled={!sel.size} className="flex-1">{isLeader ? `선택한 ${sel.size}건 반영` : `선택한 ${sel.size}건 검토 요청`}</Button>
        <Button variant="ghost" onClick={onDone}>닫기</Button>
      </div>
    </div>
  );
}

/** 자료 → 계획 초안 */
export function PlanDraftModal({ open, onClose, byId, parentId, year }: { open: boolean; onClose: () => void; byId: Map<string, Node>; parentId?: string | null; year?: number }) {
  const { team, isLeader, credits, uid } = useTeam();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [scope, setScope] = useState<string>(parentId ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<AiOutput<PlanOut> | null>(null);
  useEffect(() => { if (open) { setOut(null); setErr(null); setScope(parentId ?? ''); } }, [open, parentId]);
  const scoped = !!scope;
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      let body: Record<string, unknown> = { team_id: team.id, mode: 'draft', parent_id: scope || null, text, year: year ?? null };
      if (file) {
        if (file.type === 'application/pdf') {
          if (!isLeader) throw new Error('PDF는 팀장만 올릴 수 있습니다. 내용을 붙여 넣어 주세요.');
          const path = `${team.id}/plan-${crypto.randomUUID()}-${safeName(file.name)}`;
          const { error } = await supabase.storage.from('knowhow').upload(path, file, { contentType: file.type });
          if (error) throw error;
          body = { ...body, file_path: path, text: text || '' };
        } else {
          const t = await extractText(file);
          body = { ...body, text: `${text}\n\n${t.text}`.trim() };
        }
      }
      setOut(await invoke<AiOutput<PlanOut>>('ai-plan', body));
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  const inYear = (n: Node) => !year || yearOf(byId.get(n.path[0] ?? n.id) ?? n) === year;
  // 팀장: 팀 전체 목표·과제 / 팀원: 내가 담당한 것 + 요청받은 항목(parentId)
  const roots = [...byId.values()].filter((n) => n.status !== 'dropped' && n.depth <= 1 && inYear(n) && (isLeader || n.owner_id === uid || n.id === parentId));
  return (
    <Modal open={open} onClose={onClose} wide title={<span className="inline-flex items-center gap-2"><Sparkles size={16} className="text-violet-600" />AI로 계획 만들기</span>}>
      {out ? <OpsReview out={out} byId={byId} parentId={scope || null} year={year} onDone={onClose} /> : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{isLeader ? '사업계획서, 업무 분장표, 회의 메모를 그대로 넣으세요. AI가 단계별 계획 초안을 만들고, 반영할 것만 고르면 됩니다.'
            : '올해 내가 맡은 일, 하고 싶은 것, 팀장님과 이야기한 내용을 편하게 적으세요. AI가 내 목표 › 과제 › 할 일 초안을 만들고, 고른 것만 팀장님께 검토 요청합니다.'}</p>
          <Field label="어디 아래에 만들까요?">
            <select className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">{isLeader ? `팀 전체 (새 목표부터${year ? ` · ${year}년` : ''})` : `내 목표 새로 만들기 (처음부터${year ? ` · ${year}년` : ''})`}</option>
              {roots.map((n) => <option key={n.id} value={n.id}>{'— '.repeat(n.depth)}{n.title}</option>)}
            </select>
          </Field>
          <textarea rows={8} className={inputCls} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={isLeader ? '예) 하반기 목표: 파트너 채널 매출 20억\n- 10월까지 파트너 후보 10곳 발굴 (정우성)\n- 11월 제안서 3건 (김현정) ...' : '예) 제휴 채널 신규 고객 확대를 맡음 — 상반기 A·C사 제휴 오픈, 월 1만 명 유입\n- CRM 웰컴 메시지 개편으로 재방문율 높이기\n- 데이터 분석 역량 키우고 싶음'} />
          <label className="flex items-center gap-2 text-sm cursor-pointer w-fit text-slate-600 hover:text-indigo-700">
            <FileUp size={15} />{file ? file.name : '파일 첨부 (Word·PowerPoint·텍스트' + (isLeader ? '·PDF' : '') + ')'}
            <input type="file" className="sr-only" accept={ACCEPT_KNOWHOW} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <ErrorBox error={err} />
          <div className="flex items-center gap-3">
            <Button onClick={run} loading={busy} disabled={!text.trim() && !file}><Wand2 size={14} />초안 만들기</Button>
            <span className="text-xs text-slate-400">{isLeader && !scoped ? `프리미엄 2크레딧 · 남은 ${(credits?.monthly_remaining ?? 0) + (credits?.topup_remaining ?? 0)}` : '구독에 포함'}</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** 말로 고치기 */
export function PlanEditBar({ byId, scopeId }: { byId: Map<string, Node>; scopeId?: string | null }) {
  const { team, isLeader } = useTeam();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<AiOutput<PlanOut> | null>(null);
  const examples = useMemo(() => isLeader
    ? ['제안서 마감 2주 미루고 김현정에게 넘겨줘', '팀 역량 강화 아래 과제를 3개로 쪼개줘', '완료된 할 일은 정리하고 막힌 과제는 우선순위 1로']
    : ['내 과제 마감을 다음 주 금요일로 옮겨줘', '이 과제를 할 일 3개로 쪼개줘'], [isLeader]);
  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { setOut(await invoke<AiOutput<PlanOut>>('ai-plan', { team_id: team.id, mode: 'edit', instruction: text, parent_id: scopeId ?? null })); }
    catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <form className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-2" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <Sparkles size={15} className="text-violet-600 shrink-0" />
        <input className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-slate-400 min-w-0" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={`AI에게 말로 고치기 · 예) ${examples[0]}`} aria-label="AI에게 말로 고치기" />
        <Button size="sm" type="submit" loading={busy} disabled={!text.trim()}>변경안 보기<ArrowRight size={12} /></Button>
      </form>
      {err && <div className="mt-2"><ErrorBox error={err} /></div>}
      <Modal open={!!out} onClose={() => setOut(null)} wide title="AI 변경안">
        {out && <OpsReview out={out} byId={byId} parentId={scopeId ?? null} onDone={() => { setOut(null); setText(''); }} />}
      </Modal>
    </>
  );
}
