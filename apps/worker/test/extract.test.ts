import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { iso6346Valid, parseFields } from '../src/extract/parse';
import { extractDocument } from '../src/extract/extract';

const SAMPLE = [
  'BILL OF LADING NO: MAEU123456789', 'Shipper: Gulf Trading LLC   TRN 100123456700003',
  'Container: CSQU3054383 / MSKU 123456 7 / TEMU0000000', 'HS Code 8471.30.00  Incoterm: FOB Jebel Ali',
  'Gross weight 12,450.50 KGS   Freight USD 1,250.00 and 3,400.00 AED', 'Date: 14/03/2026  shipped 2026-03-15 and 02 Apr 2026',
].join('\n');
const pdf = (text: string) => new Promise<Buffer>((res) => { const d = new PDFDocument(); const b: Buffer[] = []; d.on('data', (c) => b.push(c)); d.on('end', () => res(Buffer.concat(b))); d.fontSize(12).text(text); d.end(); });

describe('field parser', () => {
  it('validates ISO 6346 check digits', () => {
    expect(iso6346Valid('CSQU3054383')).toBe(true);
    expect(iso6346Valid('CSQU3054384')).toBe(false);
    expect(iso6346Valid('csqu3054383')).toBe(false);
  });
  it('extracts trade fields and flags bad container check digits', () => {
    const f = parseFields(SAMPLE);
    expect(f.containerNumbers.find((c) => c.value === 'CSQU3054383')?.checkDigitValid).toBe(true);
    expect(f.containerNumbers.find((c) => c.value === 'TEMU0000000')?.checkDigitValid).toBe(false);
    expect(f.hsCodes).toContain('84713000');
    expect(f.incoterm).toBe('FOB');
    expect(f.billOfLading).toContain('MAEU123456789');
    expect(f.trn).toContain('100123456700003');
    expect(f.weightsKg).toContain(12450.5);
    expect(f.amounts).toEqual(expect.arrayContaining([{ currency: 'USD', value: 1250 }, { currency: 'AED', value: 3400 }]));
    expect(f.dates).toEqual(expect.arrayContaining(['2026-03-14', '2026-03-15', '2026-04-02']));
  });
});

describe('extraction engines (real pdftotext + tesseract)', () => {
  it('reads a PDF text layer', async () => {
    const r = await extractDocument(await pdf(SAMPLE), 'application/pdf');
    expect(r.status).toBe('done'); expect(r.engine).toBe('pdftotext');
    expect(r.fields?.containerNumbers.map((c) => c.value)).toContain('CSQU3054383');
  });
  it('OCRs a scanned PDF (no text layer) and a photo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ocr-test-'));
    const png = join(dir, 's.png'); const scan = join(dir, 's.pdf');
    execFileSync('convert', ['-density', '200', '-background', 'white', '-fill', 'black', '-font', 'DejaVu-Sans', '-pointsize', '26', `label:${SAMPLE}`, '-bordercolor', 'white', '-border', '40', png]);
    execFileSync('convert', [png, '-density', '200', scan]);
    const s = await extractDocument(readFileSync(scan), 'application/pdf');
    expect(s.status).toBe('done'); expect(s.engine).toMatch(/^tesseract/);
    expect(s.fields?.containerNumbers.map((c) => c.value)).toContain('CSQU3054383');
    expect(s.fields?.incoterm).toBe('FOB');
    const p = await extractDocument(readFileSync(png), 'image/png');
    expect(p.status).toBe('done'); expect(p.confidence).toBeGreaterThan(60);
    expect(p.text).toMatch(/MAEU123456789/);
  }, 120_000);
  it('records unsupported types and corrupt files instead of throwing', async () => {
    expect((await extractDocument(Buffer.from('x'), 'application/zip')).status).toBe('unsupported');
    expect((await extractDocument(Buffer.from('%PDF-1.4 garbage'), 'application/pdf')).status).toBe('failed');
  });
});
