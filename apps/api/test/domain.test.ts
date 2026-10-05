import { describe, expect, it } from 'vitest';
import { accrualPosting, allocationPosting, billPosting, invoicePosting, invoiceTotals, isBalanced, receiptPosting, reversal } from '../src/finance/domain/posting';
import { evaluateRelease } from '../src/warehouse/domain/release';
import { quoteTotals, canTransition, missingEnquiryInfo } from '../src/commercial/domain/quote';
import { currentMilestone } from '../src/logistics/domain/lifecycle';

describe('posting templates are always balanced (property-style)', () => {
  it('invoices: random lines and tax codes', () => {
    for (let i = 0; i < 500; i++) {
      const lines = Array.from({ length: 1 + (i % 6) }, (_, k) => ({ chargeId: String(k), description: 'x', net: (Math.random() * 100000).toFixed(4), taxCode: ['SR5', 'ZR', 'EX'][(i + k) % 3] }));
      const t = invoiceTotals(lines); expect(isBalanced(invoicePosting(t))).toBe(true); expect(t.total.toFixed(2)).toBe(t.subtotal.plus(t.taxTotal).toFixed(2));
    }
  });
  it('bills with positive / negative / zero variance and no accrual', () => {
    for (const [bill, acc] of [['1240', '1000'], ['900', '1000'], ['500', '0'], ['1000', '1000']]) { const r = billPosting(bill, acc); expect(isBalanced(r.lines)).toBe(true); }
    expect(billPosting('900', '1000').variance.toFixed(2)).toBe('-100.00');
  });
  it('accrual, receipt, allocation and reversals', () => { for (const l of [accrualPosting('12.3456'), receiptPosting('99.99'), allocationPosting('5')]) { expect(isBalanced(l)).toBe(true); expect(isBalanced(reversal(l))).toBe(true); } });
});
describe('release decision', () => {
  const lot = { qty_on_hand: '10', qty_reserved: '10', condition: 'good', customs_status: 'bonded' };
  it('orders its refusals: hold → stock → evidence', () => {
    expect(evaluateRelease(lot, '10', 1, true)).toMatchObject({ ok: false, code: 'STOCK_ON_HOLD' }); expect(evaluateRelease({ ...lot, qty_reserved: '4' }, '10', 0, true)).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(evaluateRelease(lot, '10', 0, false)).toMatchObject({ code: 'RELEASE_EVIDENCE_REQUIRED' }); expect(evaluateRelease(lot, '10', 0, true)).toEqual({ ok: true });
    expect(evaluateRelease({ ...lot, customs_status: 'duty_paid' }, '10', 0, false)).toEqual({ ok: true });
  });
});
describe('commercial & lifecycle rules', () => {
  it('quote totals, transitions and missing-info tasks', () => {
    expect(quoteTotals([{ quantity: '1', unit_price: '10000', expected_unit_cost: '7000', tax_code: 'ZR' }, { quantity: '1', unit_price: '1500.50', expected_unit_cost: '1000', tax_code: 'SR5' }])).toMatchObject({ net: '11500.50', tax: '75.03', margin: '3500.50', marginPercent: '30.4' });
    expect(canTransition('draft', 'accepted')).toBe(false); expect(canTransition('approved', 'accepted')).toBe(true); expect(canTransition('accepted', 'draft')).toBe(false);
    expect(missingEnquiryInfo({ cargo: { commodity: 'x' }, incoterm: null, mode: 'air' })).toEqual(expect.arrayContaining(['gross weight', 'incoterm', 'dimensions / volume']));
  });
  it('current milestone ignores arrival order and estimates', () => {
    expect(currentMilestone([{ code: 'ARRIVED', event_time: '2026-10-02', is_actual: true, source: 'carrier', received_at: '2026-10-02' }, { code: 'DEPARTED', event_time: '2026-10-01', is_actual: true, source: 'carrier', received_at: '2026-10-03' }, { code: 'ETA', event_time: '2026-10-09', is_actual: false, source: 'inferred', received_at: '2026-10-03' }])).toBe('ARRIVED');
  });
});
