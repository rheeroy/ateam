// 업로드 파일에서 본문 텍스트를 뽑는다. PDF는 AI가 원본을 직접 읽으므로 비워 둔다.
export const ACCEPT = '.docx,.pdf,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
/** 노하우에는 PPT 프레임워크·엑셀 표도 받는다 */
export const ACCEPT_KNOWHOW = ACCEPT + ',.pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation'
  + ',.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';
/** 시작하기: 문서·PPT·엑셀에 사진·캡처까지 */
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
export const ACCEPT_ONBOARD = ACCEPT_KNOWHOW + ',.png,.jpg,.jpeg,.gif,.webp,image/png,image/jpeg,image/gif,image/webp';
export const MAX_BYTES = 20 * 1024 * 1024;

export async function extractText(file: File): Promise<{ text: string; mime: string }> {
  try {
    return await readText(file);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith(file.name) || /만 올릴 수 있습니다$/.test(msg)) throw e;   // 이미 안내 문구
    // 손상된 파일 · 사내 보안(DRM)으로 잠긴 문서는 zip 으로 열리지 않는다
    throw new Error(`${file.name}: 파일을 열 수 없습니다. 손상됐거나 보안(DRM)·암호가 걸린 문서일 수 있습니다. 보안을 해제하거나 PDF로 저장해 올려 주세요`);
  }
}

async function readText(file: File): Promise<{ text: string; mime: string }> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return { text: '', mime: 'application/pdf' };
  if (name.endsWith('.txt') || name.endsWith('.md')) return { text: await file.text(), mime: file.type || 'text/plain' };
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return { text: value, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (name.endsWith('.pptx')) return { text: await pptxText(file), mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  if (name.endsWith('.xlsx')) return { text: await xlsxText(file), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  if (name.endsWith('.csv')) return { text: (await file.text()).slice(0, 100000), mime: 'text/csv' };
  if (name.endsWith('.hwp') || name.endsWith('.hwpx')) throw new Error(`${file.name}: 한글(.hwp) 파일은 읽을 수 없습니다. PDF로 저장해 올려 주세요`);
  if (name.endsWith('.xls') || name.endsWith('.ppt') || name.endsWith('.doc')) throw new Error(`${file.name}: 예전 형식(.xls·.ppt·.doc)은 읽을 수 없습니다. 새 형식(.xlsx·.pptx·.docx)으로 저장해 올려 주세요`);
  throw new Error('docx, pptx, xlsx, csv, pdf, txt, md 파일만 올릴 수 있습니다');
}

/** 사진·캡처: 긴 변 2000px 이하 JPEG로 줄인다 (AI가 읽기 충분하고, 요청 한도 안에 들어가게) */
export async function shrinkImage(file: File, max = 2000): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, fail) => {
      const el = new Image();
      el.onload = () => ok(el);
      el.onerror = () => fail(new Error(`${file.name}: 이미지를 열 수 없습니다 (PNG·JPG·GIF·WEBP만 됩니다)`));
      el.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('이미지를 줄이지 못했습니다'))), 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const unxml = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** xlsx: 시트별로 표를 탭 구분 글로 바꾼다 (시트당 500행·40열까지) */
async function xlsxText(file: File): Promise<string> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const read = async (p: string) => (zip.files[p] ? zip.files[p].async('string') : '');
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unxml([...m[1].matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join('')));
  const rels = new Map([...(await read('xl/_rels/workbook.xml.rels')).matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1] ?? ''; const target = /Target="([^"]+)"/.exec(m[0])?.[1] ?? '';
    return [id, target.startsWith('/') ? target.slice(1) : `xl/${target}`];
  }));
  const sheets = [...(await read('xl/workbook.xml')).matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: unxml(/name="([^"]*)"/.exec(m[0])?.[1] ?? ''), path: rels.get(/r:id="([^"]+)"/.exec(m[0])?.[1] ?? '') ?? '',
  }));
  // 날짜 서식 셀은 일련번호(예: 46356) 대신 YYYY-MM-DD 로
  const styles = await read('xl/styles.xml');
  const customFmt = new Map([...styles.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map((m) => [Number(m[1]), unxml(m[2])]));
  const isDateFmt = (id: number) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47)
    || (customFmt.has(id) && /[ymd]/i.test(customFmt.get(id)!.replace(/\[[^\]]*\]|"[^"]*"/g, '')) && !/^[#0.,%\s]+$/.test(customFmt.get(id)!));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*>/g)].map((m) => isDateFmt(Number(/numFmtId="(\d+)"/.exec(m[0])?.[1] ?? 0)));
  const serialToDate = (n: number) => {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
    return d.toISOString().slice(0, n % 1 ? 16 : 10).replace('T', ' ');
  };
  const colOf = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const out: string[] = [];
  for (const sh of sheets) {
    const xml = await read(sh.path);
    if (!xml) continue;
    const rows: string[] = [];
    for (const r of [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 500)) {
      const cells: string[] = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]; const inner = c[2] ?? '';
        const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]; const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        let val = '';
        if (t === 's' && v != null) val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = unxml([...inner.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((x) => x[1]).join(''));
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null) {
          const st = Number(/\bs="(\d+)"/.exec(attrs)?.[1] ?? -1);
          val = st >= 0 && dateStyle[st] && !Number.isNaN(Number(v)) ? serialToDate(Number(v)) : unxml(v);
        }
        const col = ref ? colOf(ref) : cells.length;
        if (col >= 40) continue;
        while (cells.length < col) cells.push('');
        cells[col] = val.replace(/[\t\r\n]+/g, ' ').trim();
      }
      if (cells.some((x) => x)) rows.push(cells.join('\t').replace(/\t+$/, ''));
    }
    if (rows.length) out.push(`[시트: ${sh.name}]\n${rows.join('\n')}`);
  }
  return out.join('\n\n').slice(0, 100000);
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
