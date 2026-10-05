import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseFields, type ExtractedFields } from './parse';

const run = promisify(execFile);
export const OCR_PAGE_CAP = 10;           // scanned PDFs: OCR at most this many pages
export const OCR_TIMEOUT_MS = 90_000;
const MIN_TEXT_LAYER = 40;                // fewer characters than this on a PDF means "scanned": fall back to OCR
const IMAGE = /^image\/(png|jpe?g|tiff?|bmp|webp)$/;

export interface ExtractionResult { status: 'done' | 'failed' | 'unsupported'; engine: string; pageCount?: number; text?: string; fields?: ExtractedFields; confidence?: number; error?: string }

async function ocrImage(path: string, langs: string): Promise<{ text: string; confidence: number }> {
  const text = (await run('tesseract', [path, 'stdout', '-l', langs, '--psm', '3'], { timeout: OCR_TIMEOUT_MS, maxBuffer: 16 << 20 })).stdout;
  let confidence = 0;
  try {                                    // mean word confidence from the TSV output
    const tsv = (await run('tesseract', [path, 'stdout', '-l', langs, '--psm', '3', 'tsv'], { timeout: OCR_TIMEOUT_MS, maxBuffer: 32 << 20 })).stdout;
    const cs = tsv.split('\n').slice(1).map((l) => l.split('\t')).filter((c) => c.length >= 12 && Number(c[10]) >= 0 && (c[11] ?? '').trim()).map((c) => Number(c[10]));
    confidence = cs.length ? cs.reduce((a, b) => a + b, 0) / cs.length : 0;
  } catch { /* confidence stays 0 */ }
  return { text, confidence };
}

/** Free, local engines only: poppler `pdftotext` for text layers, Tesseract (English + Arabic) for scans and photos. Never throws: failures are recorded, not retried forever. */
export async function extractDocument(bytes: Buffer, contentType: string, langs = process.env.OCR_LANGS ?? 'eng+ara'): Promise<ExtractionResult> {
  const dir = await mkdtemp(join(tmpdir(), 'dbl-extract-'));
  try {
    if (contentType === 'application/pdf') {
      const pdf = join(dir, 'in.pdf'); await writeFile(pdf, bytes);
      let pages: number | undefined;
      try { const info = (await run('pdfinfo', [pdf], { timeout: 20_000 })).stdout; pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]) || undefined; } catch { /* unreadable PDF handled below */ }
      let text = '';
      try { text = (await run('pdftotext', ['-layout', pdf, '-'], { timeout: 30_000, maxBuffer: 32 << 20 })).stdout; } catch { /* fall through to OCR */ }
      if (text.replace(/\s/g, '').length >= MIN_TEXT_LAYER) return { status: 'done', engine: 'pdftotext', pageCount: pages, text, fields: parseFields(text), confidence: 100 };
      await run('pdftoppm', ['-r', '200', '-png', '-l', String(OCR_PAGE_CAP), pdf, join(dir, 'p')], { timeout: OCR_TIMEOUT_MS });
      const imgs = (await readdir(dir)).filter((f) => f.startsWith('p') && f.endsWith('.png')).sort();
      if (!imgs.length) return { status: 'failed', engine: 'tesseract', error: 'no pages could be rendered' };
      const parts: string[] = []; let conf = 0;
      for (const f of imgs) { const r = await ocrImage(join(dir, f), langs); parts.push(r.text); conf += r.confidence; }
      text = parts.join('\n\f\n');
      return { status: 'done', engine: `tesseract(${langs})`, pageCount: pages ?? imgs.length, text, fields: parseFields(text), confidence: Math.round((conf / imgs.length) * 100) / 100 };
    }
    if (IMAGE.test(contentType)) {
      const f = join(dir, 'in'); await writeFile(f, bytes);
      const r = await ocrImage(f, langs);
      return { status: 'done', engine: `tesseract(${langs})`, pageCount: 1, text: r.text, fields: parseFields(r.text), confidence: Math.round(r.confidence * 100) / 100 };
    }
    if (contentType.startsWith('text/')) { const text = bytes.toString('utf8'); return { status: 'done', engine: 'plain', text, fields: parseFields(text), confidence: 100 }; }
    return { status: 'unsupported', engine: 'none', error: `no extractor for ${contentType}` };
  } catch (e) {
    return { status: 'failed', engine: 'tesseract', error: (e as Error).message.slice(0, 500) };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
