// 온보딩 1단계 — 팀 자료 정리 (화면 쪽)
//   ① 모으기: 고른 폴더를 하위 폴더까지 훑는다 (파일 원본은 올리지 않는다 — 글만 뽑아 보낸다)
//   ② 고르기: 읽을 수 있는 것 · 개인 정보로 보이는 것(기본 제외) · 못 읽는 것(한글·예전 형식·이미지)으로 나누고,
//            이름(사업계획·회의록…) · 최근 수정 · 형식으로 중요한 순서를 매긴다. 같은 문서의 옛 버전은 최신만 남긴다
//   ③ 읽기: 중요한 순서대로 글을 뽑아 5만 자 안팎 묶음으로 ai-folder-scan(digest)에 보낸다 (묶음당 2크레딧)
//            크레딧이 모자라면 거기서 멈추고 읽은 것까지로 마무리한다
import { extractText } from './extract';
import { invoke } from './supabase';

export interface ScanFile { file: File; path: string; key: string; score: number; reason: string; checked: boolean; sensitive: boolean }
export interface ScanResult {
  files: ScanFile[];            // 읽을 수 있는 것 (중요한 순)
  unreadable: { path: string; why: string }[];
  images: number;               // 사진·캡처 (팀 자료 정리에서는 읽지 않음)
  other: number;                // 그 밖의 파일 (동영상·압축 등)
  dupes: number;                // 옛 버전이라 뺀 것
  total: number;                // 훑은 파일 수
  folders: number;
}

export const READABLE = /\.(pdf|docx|pptx|xlsx|csv|txt|md)$/i;
const OLD = /\.(hwp|hwpx|doc|xls|ppt)$/i;
const IMG = /\.(png|jpe?g|gif|webp|heic|bmp)$/i;
const SKIP_DIR = /(^|\/)(\.[^/]+|node_modules|__MACOSX|\$RECYCLE\.BIN|System Volume Information)(\/|$)/i;
/** 개인 정보로 보이는 파일 이름 — 기본으로 빼 둔다 (팀장이 다시 고를 수 있다) */
export const SENSITIVE = /(연봉|급여|임금|보수|성과급|인사\s*평가|인사평가|평가표|평가\s*결과|고과|다면\s*평가|주민|개인\s*정보|이력서|면접|채용\s*평가|징계|건강|진단서|계좌|통장|비밀번호|패스워드|password|salary|payroll|resume|\bcv\b)/i;
const KEYWORDS: [RegExp, number, string][] = [
  [/(사업\s*계획|전략|중장기|로드맵|비전|목표|KPI|OKR)/i, 6, '계획·목표'],
  [/(업무\s*분장|R&R|RnR|역할|조직도|조직\s*개편)/i, 5, '업무 분장'],
  [/(인수\s*인계|히스토리|연혁|회고|리뷰|결산|성과\s*보고|실적)/i, 5, '흐름·결산'],
  [/(보고|임원|경영|본부장)/i, 4, '보고'],
  [/(회의록|미팅|회의|minutes)/i, 3, '회의록'],
  [/(가이드|매뉴얼|manual|guide|프로세스|절차|체크리스트|규정|원칙|템플릿|양식)/i, 3, '기준·가이드'],
  [/(계약|제휴|파트너|협약|MOU)/i, 2, '계약·제휴'],
  [/(예산|budget)/i, 2, '예산'],
];
export const MAX_SCAN = 5000;
const MAX_DEPTH = 12;
export const MAX_SIZE = 40 * 1024 * 1024;
export const DOC_CHARS = 12000;
export const BATCH_CHARS = 50000;
export const BATCH_DOCS = 30;
export const BATCH_CREDITS = 2;
/** 어림: 문서 하나가 평균 이만큼의 글이라 보고 묶음 수를 셈 (읽어 보면 달라진다) */
const AVG_CHARS = 6000;

// ---------- ① 모으기 ----------
export interface Picked { file: File; path: string }

/** 폴더째 고르기(input webkitdirectory) */
export const fromInput = (list: FileList | null): Picked[] =>
  Array.from(list ?? []).map((f) => ({ file: f, path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name }));

/** 폴더 읽기 창(크롬 · 엣지) — 브라우저가 '업로드'가 아니라 '파일 보기' 허용을 묻는다. 지원하지 않으면 null */
export async function fromPicker(onCount?: (n: number) => void, onPicked?: () => void): Promise<Picked[] | null> {
  const w = window as unknown as { showDirectoryPicker?: (o?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle> };
  if (typeof w.showDirectoryPicker !== 'function' || window.self !== window.top) return null;
  let root: FileSystemDirectoryHandle;
  try { root = await w.showDirectoryPicker({ mode: 'read' }); } catch { return []; }   // 취소
  onPicked?.();
  const out: Picked[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, path: string, depth: number): Promise<void> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const h of (dir as any).values() as AsyncIterable<FileSystemHandle>) {
      if (out.length >= MAX_SCAN) return;
      const p = `${path}/${h.name}`;
      if (h.kind === 'file') {
        try { out.push({ file: await (h as FileSystemFileHandle).getFile(), path: p }); } catch { /* 읽을 권한 없음 */ }
        if (out.length % 50 === 0) onCount?.(out.length);
      } else if (depth < MAX_DEPTH && !SKIP_DIR.test(`/${p}/`)) {
        await walk(h as FileSystemDirectoryHandle, p, depth + 1);
      }
    }
  };
  await walk(root, root.name, 0);
  onCount?.(out.length);
  return out;
}

/** 끌어 놓기 — 폴더면 하위 폴더까지 */
export async function fromDrop(dt: DataTransfer, onCount?: (n: number) => void): Promise<Picked[]> {
  const entries = Array.from(dt.items ?? []).map((i) => (i.kind === 'file' ? i.webkitGetAsEntry?.() : null)).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Array.from(dt.files).map((f) => ({ file: f, path: f.name }));
  const out: Picked[] = [];
  const walk = async (e: FileSystemEntry, depth: number): Promise<void> => {
    if (out.length >= MAX_SCAN) return;
    const path = e.fullPath.replace(/^\//, '');
    if (e.isFile) {
      try { out.push({ file: await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail)), path }); } catch { /* 읽을 권한 없음 */ }
      if (out.length % 50 === 0) onCount?.(out.length);
    } else if (e.isDirectory && depth < MAX_DEPTH && !SKIP_DIR.test(`/${path}/`)) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail)).catch(() => [] as FileSystemEntry[]);
        if (!batch.length) break;
        for (const c of batch) await walk(c, depth + 1);
      }
    }
  };
  for (const e of entries) await walk(e, 0);
  onCount?.(out.length);
  return out;
}

// ---------- ② 고르기 ----------
/** 같은 문서의 버전 표시를 지운 이름 (v2 · 최종 · final · 수정 · 사본 · (1)) — 날짜는 지우지 않는다 (날짜가 다른 회의록은 다른 문서) */
const versionKey = (path: string) => {
  const name = path.split('/').pop() ?? path;
  return name.toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/(\(\d+\)|\s-\s사본|사본|복사본|copy|[_\-\s]v\s?\d+(\.\d+)*|[_\-\s]ver\s?\d+|최종(본)?|진짜|final|수정(본)?|rev\d*|draft|초안)/g, '')
    .replace(/[_\-\s.()[\]]+/g, '');
};

export function classify(picked: Picked[]): ScanResult {
  const now = Date.now();
  const unreadable: ScanResult['unreadable'] = [];
  let images = 0, other = 0;
  const folders = new Set<string>();
  const cands: ScanFile[] = [];
  for (const { file, path } of picked.slice(0, MAX_SCAN)) {
    const name = file.name;
    folders.add(path.split('/').slice(0, -1).join('/'));
    if (name.startsWith('.') || name.startsWith('~$') || SKIP_DIR.test(`/${path}`)) continue;
    if (IMG.test(name)) { images++; continue; }
    if (OLD.test(name)) { unreadable.push({ path, why: /\.hwpx?$/i.test(name) ? '한글 파일' : '예전 형식' }); continue; }
    if (!READABLE.test(name)) { other++; continue; }
    if (file.size > MAX_SIZE) { unreadable.push({ path, why: '40MB 넘음' }); continue; }
    const sensitive = SENSITIVE.test(path);
    let score = 0;
    const why: string[] = [];
    for (const [re, w, label] of KEYWORDS) if (re.test(path)) { score += w; if (why.length < 2) why.push(label); }
    const age = (now - file.lastModified) / 86400000;
    score += age < 365 ? 4 : age < 730 ? 3 : age < 1460 ? 2 : age < 3650 ? 1 : 0;
    if (/\.(pptx|docx|pdf)$/i.test(name)) score += 1;
    if (/\.(csv|txt)$/i.test(name)) score -= 1;
    cands.push({ file, path, key: versionKey(path), score, reason: why.join(' · '), checked: !sensitive, sensitive });
  }
  // 같은 문서의 옛 버전은 최신만 (같은 폴더 안에서)
  const best = new Map<string, ScanFile>();
  for (const c of cands) {
    const k = `${c.path.split('/').slice(0, -1).join('/')}|${c.key}`;
    const b = best.get(k);
    if (!b || c.file.lastModified > b.file.lastModified) best.set(k, c);
  }
  const files = [...best.values()].sort((a, b) => b.score - a.score || b.file.lastModified - a.file.lastModified);
  return { files, unreadable, images, other, dupes: cands.length - files.length, total: picked.length, folders: folders.size };
}

/** 고른 문서를 다 읽는 데 드는 어림 크레딧 */
export function estimate(files: ScanFile[]) {
  const chars = files.reduce((a, f) => a + Math.min(DOC_CHARS, f.file.name.match(/\.(csv|txt|md)$/i) ? Math.min(f.file.size, DOC_CHARS) : AVG_CHARS), 0);
  const batches = Math.max(1, Math.ceil(chars / BATCH_CHARS), Math.ceil(files.length / BATCH_DOCS));
  return { batches, credits: batches * BATCH_CREDITS };
}

// ---------- ③ 읽기 ----------
/** PDF에서 글을 뽑는다 — 앞 40쪽까지. 글이 거의 없으면 스캔본으로 본다 */
async function pdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const out: string[] = [];
  let len = 0;
  try {
    for (let p = 1; p <= Math.min(doc.numPages, 40) && len < DOC_CHARS; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const t = tc.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+/g, ' ').trim();
      if (t) { out.push(`[${p}쪽] ${t}`); len += t.length; }
    }
  } finally { void doc.destroy(); }
  return out.join('\n');
}

export async function readDoc(f: ScanFile): Promise<string> {
  const text = f.file.name.toLowerCase().endsWith('.pdf') ? await pdfText(f.file) : (await extractText(f.file)).text;
  return text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, DOC_CHARS);
}

export interface ReadProgress { done: number; total: number; batches: number; credits: number; current: string; read: string[]; failed: { path: string; why: string }[] }
export interface ReadOutcome { read: number; batches: number; credits: number; stopped: 'done' | 'credits' | 'cancel'; standard: { name: string; text: string }[]; failed: { path: string; why: string }[]; skipped: string[] }

/** 중요한 순서대로 읽어 묶음으로 보낸다. 크레딧이 묶음 하나 값보다 적어지면 멈춘다 */
export async function readAll(opts: {
  teamId: string; job: string; files: ScanFile[]; credits: number;
  onProgress: (p: ReadProgress) => void; cancelled: () => boolean;
}): Promise<ReadOutcome> {
  const { teamId, job, files } = opts;
  let left = opts.credits;
  const failed: ReadProgress['failed'] = [];
  const read: string[] = [];
  const texts = new Map<string, string>();
  const standard = new Set<string>();
  const skipped: string[] = [];
  let batch: { name: string; path: string; modified: string; text: string }[] = [];
  let size = 0, batches = 0, used = 0, done = 0;
  let stopped: ReadOutcome['stopped'] = 'done';
  const progress = (current: string) => opts.onProgress({ done, total: files.length, batches, credits: used, current, read: [...read], failed: [...failed] });

  const send = async () => {
    if (!batch.length) return;
    const r = await invoke<{ read: number; skipped: string[]; standard: string[] }>('ai-folder-scan', { action: 'digest', team_id: teamId, job, batch: batches + 1, docs: batch });
    batches++; used += BATCH_CREDITS; left -= BATCH_CREDITS;
    for (const d of batch) if (!r.skipped?.includes(d.name)) read.push(d.path);
    skipped.push(...(r.skipped ?? []));
    for (const n of r.standard ?? []) standard.add(n);
    batch = []; size = 0;
  };

  for (const f of files) {
    if (opts.cancelled()) { stopped = 'cancel'; break; }
    if (left < BATCH_CREDITS) { stopped = 'credits'; break; }
    progress(f.path);
    try {
      const text = await readDoc(f);
      if (text.length < 80) failed.push({ path: f.path, why: f.file.name.toLowerCase().endsWith('.pdf') ? '스캔본(글 없음)' : '내용 없음' });
      else {
        texts.set(f.file.name, text);
        batch.push({ name: f.file.name, path: f.path.split('/').slice(0, -1).join('/'), modified: new Date(f.file.lastModified).toISOString(), text });
        size += text.length;
      }
    } catch {
      failed.push({ path: f.path, why: '열 수 없음(암호·보안)' });
    }
    done++;
    if (size >= BATCH_CHARS || batch.length >= BATCH_DOCS) await send();
  }
  if (left >= BATCH_CREDITS) await send();   // 멈춤을 눌렀어도 이미 뽑은 글은 보낸다
  progress('');
  return {
    read: read.length, batches, credits: used, stopped, failed, skipped,
    standard: [...standard].map((name) => ({ name, text: texts.get(name) ?? '' })).filter((s) => s.text),
  };
}
