// 업로드 파일에서 본문 텍스트를 뽑는다. PDF는 AI가 원본을 직접 읽으므로 비워 둔다.
export const ACCEPT = '.docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
/** 노하우에는 PPT 프레임워크도 받는다 */
export const ACCEPT_KNOWHOW = ACCEPT + ',.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const MAX_BYTES = 20 * 1024 * 1024;

export async function extractText(file: File): Promise<{ text: string; mime: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return { text: '', mime: 'application/pdf' };
  if (name.endsWith('.txt') || name.endsWith('.md')) return { text: await file.text(), mime: file.type || 'text/plain' };
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: value, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (name.endsWith('.pptx')) return { text: await pptxText(file), mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  throw new Error('docx, pptx, pdf, txt, md 파일만 올릴 수 있습니다');
}

/** 스토리지 키는 ASCII만 안전하다. 원래 파일명은 file_name 컬럼에 따로 저장한다 */
export const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(-60) || 'file';

/** pptx: 슬라이드별 텍스트(a:t)를 순서대로 모은다 */
async function pptxText(file: File): Promise<string> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  const out: string[] = [];
  for (const [i, n] of slides.entries()) {
    const xml = await zip.files[n].async('string');
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).filter((t) => t.trim());
    if (paras.length) out.push(`[슬라이드 ${i + 1}]\n${paras.join('\n')}`);
  }
  return out.join('\n\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
