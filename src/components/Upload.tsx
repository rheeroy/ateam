import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useTeam } from '../state/session';
import { supabase, q, invoke, errorText } from '../lib/supabase';
import { ACCEPT, MAX_BYTES, extractText, safeName } from '../lib/extract';
import type { Submission, SubmissionVersion, Task } from '../lib/types';
import { Button, ErrorBox, Field, Modal, inputCls, useToast } from './ui';

/** 결과물 새로 올리기 / 새 버전 올리기 */
export function UploadModal({ open, onClose, submission, onDone }: {
  open: boolean; onClose: () => void; submission?: Submission | null; onDone?: (submissionId: string) => void;
}) {
  const { team, uid } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [taskId, setTaskId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const tasks = useQuery({
    queryKey: ['my-tasks', team.id, uid], enabled: open && !submission,
    queryFn: () => q<Task[]>(supabase.from('tasks').select('*').eq('team_id', team.id).in('status', ['planned', 'in_progress', 'blocked']).order('created_at')),
  });

  const up = useMutation({
    mutationFn: async () => {
      if (!file && !text.trim()) throw new Error('파일을 고르거나 본문을 붙여 넣어 주세요');
      if (file && file.size > MAX_BYTES) throw new Error('20MB 이하 파일만 올릴 수 있습니다');
      let sub = submission ?? null;
      if (!sub) {
        sub = await q<Submission>(supabase.from('submissions').insert({ team_id: team.id, author_id: uid, title: title.trim(), task_id: taskId || null }).select().single());
      }
      const prev = await q<Pick<SubmissionVersion, 'version'>[]>(supabase.from('submission_versions').select('version').eq('submission_id', sub.id).order('version', { ascending: false }).limit(1));
      const version = (prev[0]?.version ?? 0) + 1;
      let path: string | null = null, mime = 'text/plain', extracted = text;
      if (file) {
        const ex = await extractText(file);
        mime = ex.mime; extracted = ex.text || text;
        path = `${team.id}/${sub.id}/${version}-${safeName(file.name)}`;
        const { error } = await supabase.storage.from('submissions').upload(path, file, { contentType: mime, upsert: false });
        if (error) throw error;
      }
      const ver = await q<SubmissionVersion>(supabase.from('submission_versions').insert({
        submission_id: sub.id, team_id: team.id, version, file_path: path, file_name: file?.name ?? null,
        mime_type: mime, extracted_text: extracted, note, created_by: uid,
      }).select().single());
      return { sub, ver };
    },
    onSuccess: ({ sub, ver }) => {
      toast(`v${ver.version}을 올렸습니다. AI가 1차 검토를 시작합니다.`);
      qc.invalidateQueries({ queryKey: ['subs'] });
      qc.invalidateQueries({ queryKey: ['sub'] });
      qc.invalidateQueries({ queryKey: ['review-queue'] });
      // 1차 검토는 백그라운드로 (팀장 크레딧 사용). 실패해도 업로드는 유지.
      invoke('ai-review-submission', { version_id: ver.id })
        .then(() => qc.invalidateQueries({ queryKey: ['ai'] }))
        .catch((e) => toast(`AI 1차 검토를 시작하지 못했습니다: ${errorText(e)}`));
      setTitle(''); setFile(null); setText(''); setNote(''); setTaskId('');
      onClose();
      onDone?.(sub.id);
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={submission ? `새 버전 올리기 · ${submission.title}` : '결과물 올리기'} wide>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); up.mutate(); }}>
        {!submission && (
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2"><Field label="제목"><input required className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="신제품 진입 기획서" /></Field></div>
            <Field label="연결 과제" hint="선택">
              <select className={inputCls} value={taskId} onChange={(e) => setTaskId(e.target.value)}>
                <option value="">없음</option>
                {(tasks.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
          </div>
        )}
        <Field label="파일" hint="docx · pdf · txt · md, 20MB 이하">
          <label className="flex items-center gap-3 border border-dashed border-slate-300 rounded-xl px-4 py-5 cursor-pointer hover:border-indigo-400">
            <FileUp size={20} className="text-indigo-600" />
            <span className="text-sm text-slate-600 flex-1 truncate">{file ? file.name : '파일을 고르세요'}</span>
            <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        </Field>
        {!file && (
          <Field label="또는 본문 붙여 넣기"><textarea rows={5} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="전문 프로그램에서 작업했다면 핵심 내용을 붙여 넣어도 됩니다." /></Field>
        )}
        <Field label={submission ? '이번 버전에서 바뀐 점' : '메모'} hint="선택">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={submission ? '예) 가격 전략을 침투가로 전면 수정' : '팀장님께 남길 말'} />
        </Field>
        <ErrorBox error={up.error ? errorText(up.error) : null} />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">올리면 AI가 먼저 읽고 팀장님께 1차 검토를 전달합니다. 검토 내용은 팀장님만 봅니다.</p>
          <Button type="submit" loading={up.isPending}>올리기</Button>
        </div>
      </form>
    </Modal>
  );
}
