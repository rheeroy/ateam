// 업무플랫폼 올리기 — 새 글 · 새 버전 · 대화 첨부를 한곳에서 (빠른 올리기 바 · 상세 대화창이 같이 쓴다)
import { supabase, q, invoke } from './supabase';
import { MAX_BYTES, safeName } from './extract';
import { readFile } from '../components/Upload';
import type { RequestType, ShareKind, Submission, SubmissionVersion } from './types';

export const isUrl = (s: string) => /^https?:\/\/\S+$/.test(s.trim());
export const baseName = (n: string) => n.replace(/\.[^.]+$/, '').slice(0, 80);

/** 버전 하나 올리기 (파일이 있으면 저장소에 먼저) */
export async function addVersion(p: { teamId: string; uid: string; sub: Pick<Submission, 'id'>; version: number; file?: File | null; text?: string; note?: string; value?: number | null; read?: { text: string; mime: string } }) {
  if (p.file && p.file.size > MAX_BYTES) throw new Error('20MB 이하 파일만 올릴 수 있습니다');
  let read = { text: p.text ?? '', mime: 'text/plain' };
  if (p.file) read = p.read ?? await readFile(p.file);
  let path: string | null = null;
  if (p.file) {
    path = `${p.teamId}/${p.sub.id}/${p.version}-${safeName(p.file.name)}`;
    const { error } = await supabase.storage.from('submissions').upload(path, p.file, { contentType: read.mime || p.file.type, upsert: false });
    if (error) throw error;
  }
  return q<SubmissionVersion>(supabase.from('submission_versions').insert({
    submission_id: p.sub.id, team_id: p.teamId, version: p.version, file_path: path, file_name: p.file?.name ?? null,
    mime_type: p.file ? read.mime : 'text/plain', extracted_text: read.text || p.text || '', note: p.note ?? '', created_by: p.uid,
    value: p.value ?? null,
  }).select().single());
}

/** 새 글: 결과물 + v1 */
export async function createPost(p: {
  teamId: string; uid: string; groupId?: string | null; itemId?: string | null; req: RequestType;
  title: string; file?: File | null; text?: string; link?: string | null; kind?: ShareKind;
}) {
  let kind: ShareKind = p.kind ?? 'note';
  const read = p.file ? await readFile(p.file) : undefined;
  if (read) kind = read.kind;
  const sub = await q<Submission>(supabase.from('submissions').insert({
    team_id: p.teamId, author_id: p.uid, item_id: p.itemId || null, ...(p.groupId ? { group_id: p.groupId } : {}),
    kind, request_type: p.req, link_url: p.link ?? null, title: p.title.trim() || '공유',
  }).select().single());
  const ver = await addVersion({ teamId: p.teamId, uid: p.uid, sub, version: 1, file: p.file, text: p.text, read });
  return { sub, ver };
}

/** 승인·의견 요청 문서면 AI 1차 검토를 조용히 시작 (결과는 팀장만 본다) */
export function startReview(sub: Pick<Submission, 'request_type' | 'kind'>, versionId: string, aiOn: boolean, onDone?: () => void) {
  if (!aiOn || sub.request_type === 'share' || sub.kind === 'number' || sub.kind === 'note') return;
  invoke('ai-review-submission', { version_id: versionId }).then(() => onDone?.()).catch(() => { /* 팀장 화면에서 다시 시작할 수 있다 */ });
}

/** 대화에 붙이는 파일 */
export async function uploadAttachment(teamId: string, subId: string, file: File) {
  if (file.size > MAX_BYTES) throw new Error('20MB 이하 파일만 올릴 수 있습니다');
  const path = `${teamId}/${subId}/c-${Date.now()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from('submissions').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw error;
  return { file_path: path, file_name: file.name, mime_type: file.type || null };
}

/** 붙여 넣은 캡처에 이름 붙이기 */
export function namedPaste(f: File) {
  if (f.name && f.name !== 'image.png') return f;
  const d = new Date();
  const stamp = `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return new File([f], `캡처 ${stamp}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type });
}
