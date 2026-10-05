import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { D, money } from '@dbl/contracts';

const here = dirname(fileURLToPath(import.meta.url));
const FONT = (f: string) => join(here, '..', 'fonts', `${f}.ttf`);
const LOGO = readFileSync(join(here, '..', 'assets', 'logo.png'));   // the master logo, byte-identical to brand/assets/logo

/** Brand tokens (brand/tokens): container green, signal red, paper. */
export const C = { green: '#04302A', signal: '#E12509', ink: '#12201D', steel: '#5B6B66', line: '#D9D6CC', paper: '#F3F1EB', ok: '#0C6B3F' } as const;
export interface Party { name: string; address?: string | null; trn?: string | null; email?: string | null; phone?: string | null; website?: string | null; country?: string | null }
export interface Issuer extends Party { licence?: string | null; bank?: { bankName?: string | null; accountName?: string | null; iban?: string | null; swift?: string | null } | null }
export interface DocMeta { type: string; number: string; issuer: Issuer; subtitle?: string; watermark?: string; generatedAt?: Date }

export const fmt = (v: string | number | null | undefined) => { if (v == null || v === '') return '—'; const [i, d] = D(v).toFixed(2).split('.'); return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d}`; };
export const fmtDate = (v?: string | Date | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const fmtDateTime = (v?: string | Date | null) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '—');
export { money };

export type Col = { key: string; header: string; width: number; align?: 'left' | 'right' | 'center'; mono?: boolean };
/**
 * A4 document with the brand header and footer on EVERY page: logo + document type/number + rule at the top;
 * issuer identity, registration numbers, contact details, "Page x of y" and generation stamp at the bottom.
 */
export class BrandedDoc {
  readonly doc: PDFKit.PDFDocument; private chunks: Buffer[] = []; private M = 42; private headerH = 96; private footerH = 70;
  constructor(private meta: DocMeta) {
    this.doc = new PDFDocument({ size: 'A4', margins: { top: this.headerH + 16, bottom: this.footerH + 12, left: this.M, right: this.M }, bufferPages: true,
      info: { Title: `${meta.type} ${meta.number}`, Author: meta.issuer.name, Subject: meta.subtitle ?? meta.type, Creator: 'DigitalBurj Logistics OS', Producer: 'DigitalBurj Logistics OS', CreationDate: meta.generatedAt ?? new Date() } });
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    for (const [n, f] of Object.entries({ Body: 'barlow-latin-400-normal', BodyMed: 'barlow-latin-500-normal', BodySemi: 'barlow-latin-600-normal', BodyBold: 'barlow-latin-700-normal', Label: 'barlow-condensed-latin-600-normal', LabelBold: 'barlow-condensed-latin-700-normal', Display: 'chakra-petch-latin-600-normal', DisplayBold: 'chakra-petch-latin-700-normal', Mono: 'ibm-plex-mono-latin-400-normal', MonoBold: 'ibm-plex-mono-latin-600-normal' })) this.doc.registerFont(n, FONT(f));
    this.doc.on('pageAdded', () => this.header()); this.header();
  }
  get width() { return this.doc.page.width - this.M * 2; } get left() { return this.M; } get right() { return this.doc.page.width - this.M; }
  private header() {
    const d = this.doc; const w = 150; const h = (w * 480) / 1760;
    d.save(); d.rect(this.M, 30, w, h).clip(); d.image(LOGO, this.M - 0.0767 * w, 30 - 0.2917 * h, { width: w * 1.1267 }); d.restore();   // unmodified master logo, empty margin trimmed by the clip
    d.font('DisplayBold').fontSize(17).fillColor(C.green).text(this.meta.type.toUpperCase(), this.M, 32, { width: this.width, align: 'right', lineBreak: false });
    d.font('Mono').fontSize(9.5).fillColor(C.ink).text(this.meta.number, this.M, 54, { width: this.width, align: 'right', lineBreak: false });
    if (this.meta.subtitle) d.font('Body').fontSize(8.5).fillColor(C.steel).text(this.meta.subtitle, this.M, 69, { width: this.width, align: 'right', lineBreak: false });
    d.rect(this.M, this.headerH - 4, this.width, 1.6).fill(C.green); d.rect(this.M, this.headerH - 4, 54, 1.6).fill(C.signal);
    d.x = this.M; d.y = this.headerH + 16; d.fillColor(C.ink);
  }
  private footers() {
    const d = this.doc; const range = d.bufferedPageRange(); const i = this.meta.issuer; const gen = (this.meta.generatedAt ?? new Date()).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    for (let p = 0; p < range.count; p++) {
      d.switchToPage(range.start + p); const top = d.page.height - this.footerH; const bm = d.page.margins.bottom; d.page.margins.bottom = 0;      // write inside the footer zone without triggering a new page
      d.rect(this.M, top, this.width, 0.8).fill(C.line);
      d.font('BodySemi').fontSize(8).fillColor(C.green).text(i.name, this.M, top + 8, { width: this.width * 0.7, lineBreak: false });
      const reg = [i.trn ? `TRN ${i.trn}` : '', i.licence ? `Licence ${i.licence}` : ''].filter(Boolean).join('  ·  ');
      d.font('Body').fontSize(7.5).fillColor(C.steel);
      if (reg) d.text(reg, this.M, top + 20, { width: this.width * 0.7, lineBreak: false });
      d.text([i.address, i.email, i.phone, i.website].filter(Boolean).join('  ·  '), this.M, top + 31, { width: this.width * 0.78, height: 20 });
      d.font('LabelBold').fontSize(9).fillColor(C.green).text(`Page ${p + 1} of ${range.count}`, this.M, top + 8, { width: this.width, align: 'right', lineBreak: false });
      d.font('Body').fontSize(7).fillColor(C.steel).text(`Generated ${gen} · DigitalBurj Logistics OS`, this.M, top + 21, { width: this.width, align: 'right', lineBreak: false });
      d.font('Label').fontSize(7.5).fillColor(C.signal).text('One system. Every operation.', this.M, top + 33, { width: this.width, align: 'right', lineBreak: false });
      if (this.meta.watermark) { d.save(); d.rotate(-32, { origin: [d.page.width / 2, d.page.height / 2] }); d.font('DisplayBold').fontSize(74).fillColor('#E12509').fillOpacity(0.08).text(this.meta.watermark, 0, d.page.height / 2 - 40, { width: d.page.width, align: 'center', lineBreak: false }); d.restore(); d.fillOpacity(1); }
      d.page.margins.bottom = bm;
    }
  }
  finish(): Promise<Buffer> { return new Promise((resolve) => { this.doc.on('end', () => resolve(Buffer.concat(this.chunks))); this.footers(); this.doc.end(); }); }

  // ---- building blocks
  ensure(h: number) { if (this.doc.y + h > this.doc.page.height - this.doc.page.margins.bottom) this.doc.addPage(); }
  label(text: string, x = this.doc.x, y = this.doc.y, width?: number) { this.doc.font('LabelBold').fontSize(8).fillColor(C.steel).text(text.toUpperCase(), x, y, { width, characterSpacing: 0.6 }); }
  /** Two-column party/meta blocks. */
  block(title: string, lines: Array<string | null | undefined>, x: number, y: number, width: number) {
    const d = this.doc; this.label(title, x, y, width); let cy = y + 12; const ls = lines.filter((l): l is string => !!l);
    ls.forEach((l, k) => { d.font(k === 0 ? 'BodyBold' : 'Body').fontSize(k === 0 ? 10.5 : 9).fillColor(C.ink).text(l, x, cy, { width }); cy = d.y + 1; }); return cy;
  }
  facts(rows: Array<[string, string | null | undefined]>, x: number, y: number, width: number) {
    const d = this.doc; const filtered = rows.filter(([, v]) => v); const h = filtered.length * 15 + 12; d.rect(x, y, width, h).fill(C.paper);
    filtered.forEach(([k, v], i) => { const ry = y + 8 + i * 15; d.font('Label').fontSize(8.5).fillColor(C.steel).text(k.toUpperCase(), x + 10, ry + 1, { width: width * 0.42, lineBreak: false }); d.font('MonoBold').fontSize(8.5).fillColor(C.ink).text(v!, x + width * 0.42, ry, { width: width * 0.58 - 10, align: 'right', lineBreak: false }); });
    return y + h;
  }
  heading(text: string) { this.ensure(40); const d = this.doc; d.moveDown(0.6); d.font('DisplayBold').fontSize(11).fillColor(C.green).text(text, this.M, d.y); d.rect(this.M, d.y + 2, 28, 1.4).fill(C.signal); d.y += 10; d.fillColor(C.ink); }
  /** Table with a repeating header row and page-break-safe rows. */
  table(cols: Col[], rows: Array<Record<string, string>>, opts: { zebra?: boolean } = {}) {
    const d = this.doc; const total = cols.reduce((s, c) => s + c.width, 0); const k = this.width / total; const xs: number[] = []; let acc = this.M; for (const c of cols) { xs.push(acc); acc += c.width * k; }
    const head = () => { const y = d.y; d.rect(this.M, y, this.width, 18).fill(C.green); cols.forEach((c, i) => d.font('LabelBold').fontSize(8.5).fillColor('#FFFFFF').text(c.header.toUpperCase(), xs[i] + 5, y + 5, { width: c.width * k - 10, align: c.align ?? 'left', lineBreak: false, characterSpacing: 0.5 })); d.y = y + 18; };
    head();
    rows.forEach((r, ri) => {
      const hs = cols.map((c) => { d.font(c.mono ? 'Mono' : 'Body').fontSize(9); return d.heightOfString(r[c.key] ?? '', { width: c.width * k - 10 }); }); const h = Math.max(...hs, 11) + 9;
      if (d.y + h > d.page.height - d.page.margins.bottom) { d.addPage(); head(); }
      const y = d.y; if (opts.zebra !== false && ri % 2 === 1) d.rect(this.M, y, this.width, h).fill('#FAF9F5');
      cols.forEach((c, i) => d.font(c.mono ? 'Mono' : 'Body').fontSize(9).fillColor(C.ink).text(r[c.key] ?? '', xs[i] + 5, y + 4.5, { width: c.width * k - 10, align: c.align ?? 'left' }));
      d.rect(this.M, y + h - 0.5, this.width, 0.5).fill(C.line); d.y = y + h;
    });
    d.x = this.M;
  }
  /** Right-aligned totals; the last row is emphasised. */
  totals(rows: Array<[string, string]>, emphasise = true) {
    const d = this.doc; const w = 230; const x = this.right - w; this.ensure(rows.length * 18 + 14); d.y += 8;
    rows.forEach(([k, v], i) => { const last = emphasise && i === rows.length - 1; const y = d.y; if (last) d.rect(x, y - 2, w, 22).fill(C.green);
      d.font(last ? 'BodyBold' : 'Body').fontSize(last ? 10.5 : 9.5).fillColor(last ? '#FFFFFF' : C.ink).text(k, x + 8, y + (last ? 3 : 0), { width: w * 0.5, lineBreak: false }); d.font(last ? 'MonoBold' : 'Mono').text(v, x + w * 0.45, y + (last ? 3 : 0), { width: w * 0.55 - 8, align: 'right', lineBreak: false }); d.y = y + (last ? 24 : 17); });
    d.fillColor(C.ink); d.x = this.M;
  }
  paragraph(text: string, o: { size?: number; color?: string; font?: string } = {}) { this.ensure(30); this.doc.font(o.font ?? 'Body').fontSize(o.size ?? 8.8).fillColor(o.color ?? C.steel).text(text, this.M, this.doc.y, { width: this.width, lineGap: 1.5 }); this.doc.fillColor(C.ink); }
}
