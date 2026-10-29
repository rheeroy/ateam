// 파일로 실적 입력 — 파일을 올리면 Core AI가 항목별 값을 찾아 '이렇게 등록할까요?'로 보여 준다
//   팀원(성과입력 창): 확인한 것만 성과입력으로 올린다 → 팀장 승인 흐름 그대로
//   팀장(팀목표 › 파일로 실적 채우기): 확인한 것만 바로 반영한다 (첫 가입 때 지난 실적 채우기에도)
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Crosshair, FileSpreadsheet, Upload } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, invoke, errorText } from '../../lib/supabase';
import { extractText, shrinkImage, IMAGE_EXT } from '../../lib/extract';
import { currentLabel, payloadLabel, useCreateCheckin } from '../../lib/checkin';
import { ITEMS_KEY, type Node } from '../../lib/items';
import type { CheckinPayload, CheckinType } from '../../lib/types';
import { cx } from '../../lib/format';
import { Button, Spinner, useToast } from '../ui';

type Row = { item_id: string; type: CheckinType; value: number | null; stage: number | null; period: string; location: string; issue: string; note: string; candidates: { value: number; location: string }[] };
const ACCEPT = '.xlsx,.csv,.pdf,.docx,.pptx,.txt,.png,.jpg,.jpeg,.webp';
const toB64 = (blob: Blob) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => fail(new Error('파일을 읽지 못했습니다')); r.readAsDataURL(blob); });

export function FileExtract({ items, mode, onDone }: { items: Node[]; mode: 'member' | 'leader'; onDone: () => void }) {
  const { team } = useTeam();
  const toast = useToast();
  const qc = useQueryClient();
  const create = useCreateCheckin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<'read' | 'save' | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});
  const byId = useMemo(() => new Map(items.map((n) => [n.id, n])), [items]);

  const run = async (f: File) => {
    setFile(f); setRows(null); setBusy('read');
    try {
      if (f.size > 10 * 1024 * 1024) throw new Error('10MB 이하 파일만 올릴 수 있습니다');
      const body: Record<string, unknown> = { team_id: team.id, item_ids: items.map((n) => n.id), mode, file_name: f.name };
      if (/\.pdf$/i.test(f.name)) body.pdf = await toB64(f);
      else if (IMAGE_EXT.test(f.name)) { body.image = await toB64(await shrinkImage(f)); body.image_type = 'image/jpeg'; }
      else body.text = (await extractText(f)).text;
      const r = await invoke<{ rows: Row[] }>('ai-perf-extract', body);
      setRows(r.rows);
      setOn(Object.fromEntries(r.rows.map((x) => [x.item_id, !x.issue])));
    } catch (e) { toast(errorText(e)); setFile(null); }
    finally { setBusy(null); }
  };
  const setVal = (id: string, v: string) => setRows((rs) => (rs ?? []).map((r) => (r.item_id === id ? { ...r, value: v === '' ? null : Number(v), issue: '' } : r)));
  const picked = (rows ?? []).filter((r) => on[r.item_id] && (r.type === 'stage' ? r.stage : r.type === 'done' ? true : r.value != null && Number.isFinite(r.value)));

  const save = async () => {
    if (!picked.length || !file) return;
    setBusy('save');
    let ok = 0;
    try {
      for (const r of picked) {
        const n = byId.get(r.item_id);
        if (!n) continue;
        const where = [`파일 「${file.name}」`, r.location, r.period].filter(Boolean).join(' · ');
        if (mode === 'member') {
          const payload: CheckinPayload = r.type === 'stage' ? { type: 'stage', stage: r.stage! } : r.type === 'done' ? { type: 'done' } : { type: r.type, value: r.value! };
          await create.mutateAsync({ item: n, payload: { ...payload, prev: currentLabel(n), label: payloadLabel(payload, n), evidence: [] }, note: [r.note, where].filter(Boolean).join(' — ') });
        } else {
          const patch = r.type === 'number' ? { num_current: r.value } : r.type === 'percent' ? { progress: Math.round(r.value!) } : r.type === 'stage' ? { stage_current: r.stage } : { status: 'done' };
          await q(supabase.from('work_items').update(patch).eq('id', n.id));
        }
        ok++;
      }
      if (mode === 'leader') { qc.invalidateQueries({ queryKey: ITEMS_KEY(team.id) }); qc.invalidateQueries({ queryKey: ['goal-outlook'] }); }
      toast(mode === 'member' ? `${ok}건을 팀장님께 승인 요청했습니다.` : `${ok}건을 팀목표에 반영했습니다.`);
      onDone();
    } catch (e) { toast(`${ok}건 처리 후 멈췄습니다 — ${errorText(e)}`); }
    finally { setBusy(null); }
  };

  if (!items.length) return <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">{mode === 'member' ? '숫자 · 진척 · 단계로 재는 내 목표·과제가 없습니다.' : '숫자 · 진척 · 단계로 재는 목표 항목이 없습니다.'}</p>;
  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }} />
      {!file ? (
        <button onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) run(f); }}
          className="w-full rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 px-4 py-8 text-center">
          <Upload size={20} className="mx-auto text-indigo-500" />
          <b className="block mt-2 text-sm text-slate-800">실적 파일을 올리거나 끌어다 놓으세요</b>
          <span className="block mt-1 text-xs text-slate-500">엑셀 · CSV · PDF · 문서 · 캡처 — {mode === 'member' ? '내가 맡은' : '팀'} 목표 항목 {items.length}개와 맞는 숫자를 찾아 드립니다</span>
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3.5 py-2.5">
          <FileSpreadsheet size={20} className="text-emerald-600 shrink-0" />
          <div className="min-w-0 flex-1"><b className="text-sm block truncate">{file.name}</b><span className="text-[11.5px] text-slate-500">{busy === 'read' ? '항목과 맞는 숫자를 찾는 중…' : rows ? `${rows.length}개 항목에서 값을 찾았습니다${rows.some((r) => r.issue) ? ` · ${rows.filter((r) => r.issue).length}개는 확인이 필요합니다` : ''}` : ''}</span></div>
          {busy !== 'read' && <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold text-slate-500 hover:text-indigo-700">다른 파일</button>}
        </div>
      )}
      {busy === 'read' && <Spinner />}
      {rows && !rows.length && <p className="rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">이 파일에서 목표 항목과 맞는 숫자를 찾지 못했습니다. 다른 파일을 올리거나 직접 입력해 주세요.</p>}
      {!!rows?.length && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-slate-400 border-b border-slate-200"><th className="w-8" /><th className="text-left font-semibold py-2 px-1.5">목표 항목</th><th className="text-left font-semibold px-1.5">찾은 값</th><th className="text-left font-semibold px-1.5">기간 · 위치</th><th className="text-left font-semibold px-1.5">확인</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const n = byId.get(r.item_id);
                if (!n) return null;
                return (
                  <tr key={r.item_id} className={cx('border-b border-slate-100 align-middle', r.issue && 'bg-amber-50/60')}>
                    <td className="px-1.5"><input type="checkbox" className="accent-indigo-600 w-4 h-4" checked={!!on[r.item_id]} onChange={(e) => setOn({ ...on, [r.item_id]: e.target.checked })} aria-label={`${n.title} 등록`} /></td>
                    <td className="py-2.5 px-1.5"><b className="block leading-snug">{n.title}</b><span className="text-[11px] text-slate-400">지금 {currentLabel(n)}{n.measure === 'number' && n.num_target != null ? ` / 목표 ${n.num_target}${n.unit}` : ''}</span></td>
                    <td className="px-1.5 whitespace-nowrap">
                      {r.type === 'number' || r.type === 'percent' ? (
                        <span className="inline-flex items-center gap-1">
                          <input type="number" value={r.value ?? ''} onChange={(e) => setVal(r.item_id, e.target.value)} className="w-28 rounded-md border border-slate-200 px-2 py-1 font-bold num" />
                          <span className="text-xs text-slate-500">{r.type === 'percent' ? '%' : n.unit}</span>
                        </span>
                      ) : <b>{r.type === 'stage' ? (n.stages ?? [])[(r.stage ?? 1) - 1] ?? `${r.stage}단계` : '완료'}</b>}
                      {!!r.candidates.length && (
                        <div className="mt-1 flex gap-1 flex-wrap">{r.candidates.map((c) => <button key={`${c.value}${c.location}`} onClick={() => setVal(r.item_id, String(c.value))} className="text-[10.5px] rounded-full bg-white ring-1 ring-amber-300 text-amber-800 px-1.5 py-0.5" title={c.location}>{c.value.toLocaleString('ko-KR')}</button>)}</div>
                      )}
                    </td>
                    <td className="px-1.5 text-xs text-slate-500"><div>{r.period || '기간 표시 없음'}</div>{r.location && <code className="text-[10.5px] text-indigo-600 bg-indigo-50 rounded px-1">{r.location}</code>}</td>
                    <td className="px-1.5">{r.issue ? <span className="text-[11px] font-bold rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 whitespace-nowrap">{r.issue}</span> : <span className="text-[11px] font-bold rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5">일치</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11.5px] text-slate-400 px-1">숫자는 고칠 수 있습니다 · 체크한 것만 {mode === 'member' ? '등록 요청됩니다 · 한 줄 설명에 파일 이름과 위치가 남습니다' : '팀목표에 바로 반영됩니다'}</p>
        </div>
      )}
      {!!rows?.length && (
        <Button className="w-full" disabled={!picked.length} loading={busy === 'save'} onClick={save}>
          <Crosshair size={14} />{mode === 'member' ? `${picked.length}건 팀장님께 승인 요청` : `${picked.length}건 팀목표에 반영`}
        </Button>
      )}
    </div>
  );
}
