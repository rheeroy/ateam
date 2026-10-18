import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp, Hash, Link2, MessageSquareText } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import { MAX_BYTES, extractText, safeName } from '../lib/extract';
import type { RequestType, ShareKind, Submission, SubmissionVersion, WorkItem } from '../lib/types';
import { cx } from '../lib/format';
import { Button, ErrorBox, Field, Modal, inputCls, useToast } from './ui';

export const FILE_ACCEPT = '.docx,.pdf,.pptx,.xlsx,.txt,.md,.png,.jpg,.jpeg,.gif,.webp,image/*,application/pdf';
export const IMAGE = /^image\/(png|jpe?g|gif|webp)$/;

export async function readFile(file: File): Promise<{ text: string; mime: string; kind: ShareKind }> {
  if (IMAGE.test(file.type)) return { text: '', mime: file.type, kind: 'image' };
  const n = file.name.toLowerCase();
  if (n.endsWith('.xlsx')) return { text: '', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'document' };
  const ex = await extractText(file);
  return { ...ex, kind: 'document' };
}

const MODES: { id: 'file' | 'link' | 'number' | 'note'; label: string; icon: typeof FileUp; hint: string }[] = [
  { id: 'file', label: '파일·캡처', icon: FileUp, hint: '문서, PPT, 엑셀, 화면 캡처' },
  { id: 'link', label: '링크', icon: Link2, hint: 'Figma, 노션, 대시보드, Jira…' },
  { id: 'number', label: '숫자 업데이트', icon: Hash, hint: '목표 숫자의 현재값' },
  { id: 'note', label: '글', icon: MessageSquareText, hint: '짧은 공유·질문' },
];
const REQ: { id: RequestType; label: string; desc: string }[] = [
  { id: 'approval', label: '승인 요청', desc: '팀장 검토 후 승인' },
  { id: 'feedback', label: '피드백 요청', desc: '의견만 받기' },
  { id: 'share', label: '공유만', desc: '확인용, 답 불필요' },
];

/** 결과물·업무 공유 / 새 버전 올리기 */
export function UploadModal({ open, onClose, submission, onDone, presetItem }: {
  open: boolean; onClose: () => void; submission?: Submission | null; onDone?: (submissionId: string) => void; presetItem?: string | null;
}) {
  const { team, uid, isLeader, hasFeature } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('file');
  const [req, setReq] = useState<RequestType>('approval');
  const [title, setTitle] = useState('');
  const [itemId, setItemId] = useState(presetItem ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [value, setValue] = useState('');
  const isNew = !submission;
  const items = useQuery({
    queryKey: ['items', team.id, 'upload', uid], enabled: open && isNew,
    queryFn: () => {
      let qb = supabase.from('work_items').select('*').eq('team_id', team.id).in('status', ['active', 'blocked', 'proposed']);
      if (!isLeader) qb = qb.eq('owner_id', uid);
      return q<WorkItem[]>(qb.order('sort'));
    },
  });
  const numberItems = (items.data ?? []).filter((i) => i.measure === 'number' && !i.metric_id);
  const pick = (m: typeof mode) => { setMode(m); setReq(m === 'file' ? 'approval' : 'share'); };
  const reset = () => { setTitle(''); setFile(null); setText(''); setNote(''); setUrl(''); setValue(''); setItemId(presetItem ?? ''); };

  const up = useMutation({
    mutationFn: async () => {
      const m = isNew ? mode : 'file';
      if (m === 'file' && !file && !text.trim()) throw new Error('파일을 고르거나 본문을 붙여 넣어 주세요');
      if (m === 'link' && !/^https?:\/\//.test(url.trim())) throw new Error('http로 시작하는 링크를 넣어 주세요');
      if (m === 'number' && (!itemId || value === '')) throw new Error('항목과 숫자를 넣어 주세요');
      if (m === 'note' && !text.trim()) throw new Error('내용을 써 주세요');
      if (file && file.size > MAX_BYTES) throw new Error('20MB 이하 파일만 올릴 수 있습니다');
      let read = { text, mime: 'text/plain', kind: (m === 'file' ? 'document' : m) as ShareKind };
      if (file) read = await readFile(file);
      let sub = submission ?? null;
      if (!sub) {
        const numItem = numberItems.find((i) => i.id === itemId);
        sub = await q<Submission>(supabase.from('submissions').insert({
          team_id: team.id, author_id: uid, item_id: itemId || null, kind: m === 'file' ? read.kind : m,
          request_type: m === 'number' ? 'share' : req, link_url: m === 'link' ? url.trim() : null,
          title: title.trim() || (m === 'number' && numItem ? `${numItem.title} ${value}${numItem.unit}` : m === 'link' ? url.trim().slice(0, 80) : '공유'),
        }).select().single());
      }
      const prev = await q<Pick<SubmissionVersion, 'version'>[]>(supabase.from('submission_versions').select('version').eq('submission_id', sub.id).order('version', { ascending: false }).limit(1));
      const version = (prev[0]?.version ?? 0) + 1;
      let path: string | null = null;
      if (file) {
        path = `${team.id}/${sub.id}/${version}-${safeName(file.name)}`;
        const { error } = await supabase.storage.from('submissions').upload(path, file, { contentType: read.mime || file.type, upsert: false });
        if (error) throw error;
      }
      const ver = await q<SubmissionVersion>(supabase.from('submission_versions').insert({
        submission_id: sub.id, team_id: team.id, version, file_path: path, file_name: file?.name ?? null,
        mime_type: file ? read.mime : 'text/plain', extracted_text: read.text || text, note, created_by: uid,
        value: m === 'number' ? Number(value) : null,
      }).select().single());
      return { sub, ver };
    },
    onSuccess: ({ sub, ver }) => {
      const reviewable = sub.request_type !== 'share' && sub.kind !== 'number' && sub.kind !== 'note' && hasFeature('ai_core');
      toast(sub.request_type === 'share' ? '공유했습니다. 팀장님께 알림이 갑니다.' : `v${ver.version}을 올렸습니다.${reviewable && isLeader ? ' AI가 1차 검토를 시작합니다.' : ' 팀장님께 알림이 갑니다.'}`);
      ['subs', 'sub', 'review-queue', 'items', 'home-insights'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      if (reviewable) {
        invoke('ai-review-submission', { version_id: ver.id })
          .then(() => qc.invalidateQueries({ queryKey: ['ai'] }))
          .catch(() => { /* 검토는 팀장 화면에서 다시 시작할 수 있다 */ });
      }
      reset(); onClose(); onDone?.(sub.id);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={submission ? `새 버전 올리기 · ${submission.title}` : '공유하기'} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); up.mutate(); }}>
        {isNew && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {MODES.filter((x) => x.id !== 'number' || numberItems.length).map((x) => (
              <button type="button" key={x.id} onClick={() => pick(x.id)}
                className={cx('rounded-xl border p-2.5 text-left', mode === x.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300')}>
                <span className="flex items-center gap-1.5 text-sm font-semibold"><x.icon size={14} />{x.label}</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">{x.hint}</span>
              </button>
            ))}
          </div>
        )}
        {isNew && mode !== 'number' && (
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2"><Field label="제목" hint={mode === 'file' ? undefined : '선택'}><input required={mode === 'file'} className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === 'link' ? '10월 캠페인 성과 대시보드' : mode === 'note' ? 'A안/B안 의견 부탁드립니다' : '신제품 진입 기획서'} /></Field></div>
            <Field label="연결 항목" hint="선택">
              <select className={inputCls} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">없음</option>{(items.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
          </div>
        )}
        {(mode === 'file' || !isNew) && (
          <>
            <Field label="파일" hint="Word · PDF · PPT · 엑셀 · 이미지, 20MB 이하">
              <label className="flex items-center gap-3 border border-dashed border-slate-300 rounded-xl px-4 py-5 cursor-pointer hover:border-indigo-400">
                <FileUp size={20} className="text-indigo-600" />
                <span className="text-sm text-slate-600 flex-1 truncate">{file ? file.name : '파일을 고르세요'}</span>
                <input type="file" accept={FILE_ACCEPT} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </Field>
            {!file && <Field label="또는 본문 붙여 넣기"><textarea rows={5} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="전문 프로그램에서 작업했다면 핵심 내용을 붙여 넣어도 됩니다." /></Field>}
          </>
        )}
        {isNew && mode === 'link' && (
          <>
            <Field label="링크"><input type="url" className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>
            <Field label="무엇을 봐 주면 되는지" hint="AI와 팀장이 읽습니다"><textarea rows={3} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="예) 10월 캠페인 CTR 2.1%, B소재가 1.4배 높음. 11월 예산 배분 의견 부탁드려요" /></Field>
          </>
        )}
        {isNew && mode === 'number' && (
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2"><Field label="어떤 숫자인가요?">
              <select className={inputCls} value={itemId} onChange={(e) => setItemId(e.target.value)}>
                <option value="">선택</option>{numberItems.map((t) => <option key={t.id} value={t.id}>{t.title} (지금 {t.num_current ?? 0}/{t.num_target ?? '-'}{t.unit})</option>)}
              </select></Field></div>
            <Field label="현재값"><input type="number" step="any" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
          </div>
        )}
        {isNew && mode === 'note' && (
          <Field label="내용"><textarea rows={5} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="팀장에게 공유하거나 묻고 싶은 것" /></Field>
        )}
        {isNew && mode !== 'number' && (
          <div className="flex flex-wrap gap-2">
            {REQ.map((r) => (
              <button type="button" key={r.id} onClick={() => setReq(r.id)}
                className={cx('text-xs border rounded-lg px-3 py-1.5', req === r.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200')}>
                {r.label} <span className="font-normal text-slate-500">· {r.desc}</span></button>
            ))}
          </div>
        )}
        <Field label={submission ? '이번 버전에서 바뀐 점' : '메모'} hint="선택">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={submission ? '예) 가격 전략을 침투가로 전면 수정' : '팀장님께 남길 말'} />
        </Field>

        <ErrorBox error={up.error ? errorText(up.error) : null} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">{req === 'share' || mode === 'number' ? '팀장님께 알림만 갑니다. 승인 절차는 없습니다.' : (isLeader ? '올리면 AI가 먼저 읽고 1차 검토를 남깁니다.' : '올리면 팀장님께 알림이 갑니다.')}</p>
          <Button type="submit" loading={up.isPending}>{req === 'share' || mode === 'number' ? '공유' : '올리기'}</Button>
        </div>
      </form>
    </Modal>
  );
}
