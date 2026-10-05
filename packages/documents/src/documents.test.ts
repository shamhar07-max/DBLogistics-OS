import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderInvoice, renderQuotation, renderShipmentReport, type Issuer } from './index';

const have = spawnSync('pdftotext', ['-v']).status !== null;
const text = (buf: Buffer) => { const f = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'x.pdf'); writeFileSync(f, buf); return execFileSync('pdftotext', ['-layout', f, '-']).toString(); };
const pages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
const issuer: Issuer = { name: 'Demo Freight LLC', trn: '100234567800003', licence: 'DED-778812', address: 'Warehouse 14, Jebel Ali Free Zone, Dubai, UAE', email: 'accounts@demofreight.ae', phone: '+971 4 555 0100', website: 'demofreight.ae', bank: { bankName: 'Emirates NBD', accountName: 'Demo Freight LLC', iban: 'AE070331234567890123456', swift: 'EBILAEAD' } };
const customer = { name: 'Gulf Pharma Distribution LLC', address: 'Dubai Silicon Oasis, Dubai', trn: '100998877600003' };
const line = (n: number) => ({ description: `Ocean freight Shanghai to Jebel Ali, container ${n}`, net: '1000.00', taxCode: 'SR5', taxRate: '0.05', tax: '50.00' });

describe.runIf(have)('branded documents', () => {
  it('tax invoice: header, supplier/customer TRNs, per-line VAT, totals, payment instructions and a footer with page x of y on every page', async () => {
    const buf = await renderInvoice({ issuer, customer, number: 'INV-26-00042', status: 'posted', issueDate: '2026-10-01', dueDate: '2026-10-31', currency: 'AED', jobRef: 'JOB-26-00007', lines: [line(1), { description: 'Customs clearance', net: '350.00', taxCode: 'ZR', taxRate: '0', tax: '0.00' }], subtotal: '1350.00', taxTotal: '50.00', total: '1400.00', paid: '400.00', balance: '1000.00' });
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-'); const t = text(buf);
    for (const s of ['TAX INVOICE', 'INV-26-00042', 'Demo Freight LLC', 'TRN 100234567800003', 'TRN 100998877600003', 'Gulf Pharma Distribution LLC', 'JOB-26-00007', 'SR5 5%', 'ZR 0%', '1,350.00', '1,400.00', '1,000.00', 'AE070331234567890123456', 'Page 1 of 1', 'One system. Every operation.', 'accounts@demofreight.ae']) expect(t, s).toContain(s);
    expect(t).not.toContain('DRAFT');
  });
  it('a long invoice paginates with the header, table heading and "Page n of N" repeated on every page', async () => {
    const buf = await renderInvoice({ issuer, customer, number: 'INV-26-00043', status: 'posted', issueDate: '2026-10-01', dueDate: '2026-10-31', currency: 'AED', jobRef: 'JOB-26-00008', lines: Array.from({ length: 60 }, (_, i) => line(i + 1)), subtotal: '60000.00', taxTotal: '3000.00', total: '63000.00', paid: '0.00', balance: '63000.00' });
    const n = pages(buf); expect(n).toBeGreaterThan(1); const t = text(buf);
    for (let p = 1; p <= n; p++) expect(t).toContain(`Page ${p} of ${n}`); expect((t.match(/TAX INVOICE/g) ?? []).length).toBe(n); expect((t.match(/Demo Freight LLC/g) ?? []).length).toBeGreaterThanOrEqual(n); expect(t).toContain('63,000.00');
  });
  it('a draft invoice is watermarked and says it is not a tax invoice', async () => {
    const t = text(await renderInvoice({ issuer, customer, number: null, status: 'draft', currency: 'AED', jobRef: 'JOB-1', lines: [line(1)], subtotal: '1000.00', taxTotal: '50.00', total: '1050.00', paid: '0.00', balance: '1050.00' }));
    expect(t).toContain('DRAFT INVOICE'); expect(t).toContain('NOT A TAX INVOICE'); expect(t).not.toContain('Payment instructions');
  });
  it('quotation shows validity, route, conditions and the acceptance block; shipment report lists legs, cargo and tracking with source and kind', async () => {
    const q = text(await renderQuotation({ issuer, customer, number: 'QT-26-00009', revision: 2, status: 'approved', currency: 'AED', validUntil: '2026-12-31', mode: 'ocean_fcl', origin: 'Shanghai', destination: 'Jebel Ali', incoterm: 'FOB', lines: [{ description: 'Ocean freight', chargeType: 'fixed', quantity: '2', unit: 'x40HC', unitPrice: '4100.00', taxCode: 'ZR', taxRate: '0' }], totals: { net: '8200.00', tax: '0.00', total: '8200.00' } }));
    for (const s of ['QUOTATION', 'QT-26-00009', 'revision 2', 'Valid until 31 Dec 2026', 'Shanghai to Jebel Ali', 'FOB', '8,200.00', 'Conditions', 'ACCEPTANCE', 'Page 1 of 1']) expect(q, s).toContain(s);
    const r = text(await renderShipmentReport({ issuer, customer, ref: 'SHP-26-00003', jobRef: 'JOB-26-00007', mode: 'air', status: 'executing', origin: 'Frankfurt', destination: 'Dubai', currentMilestone: 'DEPARTED', legs: [{ seq: 1, mode: 'air', origin: 'FRA', destination: 'DXB', operator: 'Lufthansa Cargo', plannedArrival: '2026-10-08' }], cargo: [{ description: 'Pharma cartons', quantity: '22', kind: 'pallet', grossWeightKg: '1450', hsCode: '3004.90' }], events: [{ code: 'DEPARTED', time: '2026-10-04T10:00:00Z', source: 'carrier', actual: true }, { code: 'ETA_DXB', time: '2026-10-08T06:00:00Z', source: 'inferred', actual: false }] }));
    for (const s of ['SHIPMENT STATUS REPORT', 'SHP-26-00003', 'Lufthansa Cargo', 'Pharma cartons', '1,450.00 kg', 'DEPARTED', 'Actual', 'Estimate', 'inferred', 'Page 1 of 1']) expect(r, s).toContain(s);
  });
});
