// 빠른 올리기 — 모달 없이 목록 맨 위에서. 파일 끌어다 놓기(화면 어디든) · 캡처 Ctrl+V · 링크 붙여넣기 · 글
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Hash, Image as ImageIcon, Link2, Paperclip, Send, Upload, X } from 'lucide-react';
import { useTeam } from '../../state/session';
import { supabase, q, errorText } from '../../lib/supabase';
import { baseName, createPost, isUrl, namedPaste, startReview } from '../../lib/post';
import type { RequestType, WorkItem } from '../../lib/types';
import { cx } from '../../lib/format';
import { Button, Card, useToast } from '../ui';
import { FILE_ACCEPT, IMAGE, UploadModal } from '../Upload';

const REQS: { id: RequestType; label: string }[] = [
  { id: 'approval', label: '컨펌 요청' },
  { id: 'feedback', label: '의견 요청' },
  { id: 'share', label: '공유만' },
];

export function QuickPost({ groupId, groupName }: { groupId?: string | null; groupName?: string }) {
  const { team, uid, isLeader, hasFeature } = useTeam();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [req, setReq] = useState<RequestType>('share');
  const [touched, setTouched] = useState(false);
  const [itemId, setItemId] = useState('');
  const [drag, setDrag] = useState(false);
  const [numOpen, setNumOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const items = useQuery({
    queryKey: ['items', team.id, 'quick', uid],
    queryFn: () => {
      let qb = supabase.from('work_items').select('id, title, owner_id, status, parent_id').eq('team_id', team.id).in('status', ['active', 'blocked']);
      if (!isLeader) qb = qb.eq('owner_id', uid);
      return q<Pick<WorkItem, 'id' | 'title' | 'owner_id' | 'status' | 'parent_id'>[]>(qb.order('sort'));
    },
  });

  const link = !file && isUrl(text) ? text.trim() : null;
  const kindLabel = file ? (IMAGE.test(file.type) ? '캡처' : '문서') : link ? '링크' : text.trim() ? '글' : null;
  // 기본 요청: 파일·긴 글은 컨펌, 짧은 글·링크는 공유 (직접 고르면 그대로)
  useEffect(() => {
    if (touched) return;
    setReq(file || text.trim().length > 200 ? 'approval' : 'share');
  }, [file, text, touched]);

  const pickFile = (f: File | null | undefined) => { if (!f) return; setFile(f); setTitle(baseName(f.name)); };

  // 화면 어디에 떨어뜨려도 여기로
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const enter = (e: DragEvent) => { if (!has(e)) return; depth++; setDrag(true); };
    const leave = (e: DragEvent) => { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDrag(false); };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth = 0; setDrag(false); pickFile(e.dataTransfer?.files?.[0]); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave); window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);

  const reset = () => { setText(''); setFile(null); setTitle(''); setTouched(false); setItemId(''); };
  const post = useMutation({
    mutationFn: () => {
      const body = text.trim();
      if (!file && !body) throw new Error('파일을 올리거나 내용을 써 주세요');
      const long = body.length > 200;
      const t = file ? (title.trim() || baseName(file.name)) : link ? link.slice(0, 80) : body.split('\n')[0].slice(0, 60);
      return createPost({
        teamId: team.id, uid, groupId, itemId: itemId || null, req, title: t, file, text: link ? '' : body, link,
        kind: link ? 'link' : long ? 'document' : 'note',
      });
    },
    onSuccess: ({ sub, ver }) => {
      toast(groupId ? `올렸습니다. ${groupName ?? '그룹'} 멤버와 팀장님께 알림이 갑니다.` : '올렸습니다. 팀장님께 알림이 갑니다.');
      ['subs', 'sub', 'review-queue', 'items', 'home-insights', 'member-badges'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      startReview(sub, ver.id, hasFeature('ai_core'), () => qc.invalidateQueries({ queryKey: ['ai'] }));
      reset();
    },
    onError: (e) => toast(errorText(e)),
  });

  return (
    <Card className={cx('p-3 transition-colors', drag && 'ring-2 ring-indigo-500 bg-indigo-50/70')}>
      {drag ? (
        <div className="h-[92px] flex flex-col items-center justify-center text-indigo-700 pointer-events-none">
          <Upload size={22} /><div className="mt-1.5 font-semibold text-sm">여기에 놓으면 올릴 준비가 됩니다</div><div className="text-xs text-indigo-500">문서 · PPT · 엑셀 · PDF · 캡처</div>
        </div>
      ) : (
        <>
          <input ref={fileRef} type="file" accept={FILE_ACCEPT} className="hidden" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} />
          {file && (
            <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2">
              {IMAGE.test(file.type) ? <ImageIcon size={16} className="text-indigo-600 shrink-0" /> : <FileText size={16} className="text-indigo-600 shrink-0" />}
              <input className="flex-1 min-w-0 bg-transparent text-sm font-medium focus:outline-none" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="제목" placeholder="제목" />
              <span className="text-[11px] text-slate-400 truncate max-w-[40%]">{file.name}</span>
              <button onClick={() => { setFile(null); setTitle(''); }} className="text-slate-400 hover:text-slate-700" aria-label="파일 빼기"><X size={15} /></button>
            </div>
          )}
          <div className="flex items-start gap-2">
            <button onClick={() => fileRef.current?.click()} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0" title="파일 첨부" aria-label="파일 첨부"><Paperclip size={17} /></button>
            <textarea rows={Math.min(6, Math.max(1, text.split('\n').length))} value={text} onChange={(e) => setText(e.target.value)}
              onPaste={(e) => { const f = e.clipboardData.files?.[0]; if (f) { e.preventDefault(); pickFile(namedPaste(f)); } }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if ((file || text.trim()) && !post.isPending) post.mutate(); } }}
              className="flex-1 resize-none text-sm py-2 leading-6 focus:outline-none placeholder:text-slate-400"
              placeholder={file ? '덧붙일 말 (선택) — Enter로 올리기' : '무엇을 공유할까요? 파일을 끌어다 놓거나, 캡처를 Ctrl+V, 링크를 붙여 넣어도 됩니다'} />
            <Button size="sm" className="shrink-0 mt-0.5" disabled={!file && !text.trim()} loading={post.isPending} onClick={() => post.mutate()}><Send size={14} />올리기</Button>
          </div>
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-1.5 flex-wrap text-xs">
            {kindLabel && <span className="inline-flex items-center gap-1 text-slate-500 mr-1">{link ? <Link2 size={12} /> : null}{kindLabel}</span>}
            {REQS.map((r) => (
              <button key={r.id} onClick={() => { setReq(r.id); setTouched(true); }}
                className={cx('rounded-full border px-2.5 py-1', req === r.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold' : 'border-slate-200 text-slate-500 hover:border-slate-300')}>{r.label}</button>
            ))}
            <select aria-label="연결 과제" value={itemId} onChange={(e) => setItemId(e.target.value)}
              className="ml-1 rounded-full border border-slate-200 px-2.5 py-1 bg-white text-slate-600 max-w-[220px]">
              <option value="">과제 연결 안 함</option>{(items.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            {!groupId && <button onClick={() => setNumOpen(true)} className="ml-auto inline-flex items-center gap-1 text-slate-500 hover:text-indigo-700"><Hash size={12} />숫자 업데이트</button>}
          </div>
        </>
      )}
      {numOpen && <UploadModal open onClose={() => setNumOpen(false)} />}
    </Card>
  );
}
