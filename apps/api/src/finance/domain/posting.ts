/** Pure accounting rules — no I/O. Every function returns balanced journal lines keyed by SYSTEM account keys. */
import Decimal from 'decimal.js';
import { D, roundMoney, taxFor, TAX_RATES } from '@dbl/contracts';

export type SystemKey = 'AR' | 'AP' | 'BANK' | 'REVENUE' | 'COST' | 'ACCRUED_COST' | 'VAT_OUT' | 'VAT_IN' | 'ADVANCES';
export interface PostingLine { account: SystemKey; debit: string; credit: string; memo?: string }

export interface InvoiceLineInput { chargeId: string; description: string; net: Decimal.Value; taxCode: string; taxRationale?: string | null }
/** Policy: tax is rounded PER LINE (ROUND_HALF_UP to currency minor units), then summed. */
export function invoiceTotals(lines: InvoiceLineInput[], minor = 2) {
  const out = lines.map((l) => { const net = roundMoney(l.net, minor); const tax = taxFor(net, l.taxCode, minor); return { ...l, net, tax, rate: TAX_RATES[l.taxCode] ?? '0' }; });
  const subtotal = out.reduce((a, l) => a.plus(l.net), D(0)); const taxTotal = out.reduce((a, l) => a.plus(l.tax), D(0));
  return { lines: out, subtotal, taxTotal, total: subtotal.plus(taxTotal) };
}
const f = (v: Decimal.Value, minor = 2) => roundMoney(v, minor).toFixed(4);

/** Customer invoice posted: Dr Receivable (gross) / Cr Revenue (net) / Cr VAT output. */
export function invoicePosting(t: { subtotal: Decimal.Value; taxTotal: Decimal.Value; total: Decimal.Value }): PostingLine[] {
  const lines: PostingLine[] = [
    { account: 'AR', debit: f(t.total), credit: '0' }, { account: 'REVENUE', debit: '0', credit: f(t.subtotal) },
  ];
  if (D(t.taxTotal).gt(0)) lines.push({ account: 'VAT_OUT', debit: '0', credit: f(t.taxTotal) });
  return lines;
}
/** Supplier cost accrued: Dr Cost / Cr Accrued costs. */
export const accrualPosting = (amount: Decimal.Value): PostingLine[] => [{ account: 'COST', debit: f(amount), credit: '0' }, { account: 'ACCRUED_COST', debit: '0', credit: f(amount) }];
/**
 * Supplier bill posted. Accruals for the same supplier/job are CLEARED against the bill; the difference goes to cost.
 * bill 1,240 vs accrued 1,000  → Dr Accrued 1,000, Dr Cost 240, Cr AP 1,240
 * bill   900 vs accrued 1,000  → Dr Accrued 1,000, Cr Cost 100, Cr AP 900
 * bill   500 with no accrual   → Dr Cost 500, Cr AP 500      (late-arriving cost: never silently ignored)
 */
export function billPosting(bill: Decimal.Value, accrued: Decimal.Value): { lines: PostingLine[]; variance: Decimal } {
  const b = roundMoney(bill), a = roundMoney(accrued), lines: PostingLine[] = [];
  if (a.gt(0)) lines.push({ account: 'ACCRUED_COST', debit: f(a), credit: '0' });
  const diff = b.minus(a);
  if (diff.gt(0)) lines.push({ account: 'COST', debit: f(diff), credit: '0' });
  if (diff.lt(0)) lines.push({ account: 'COST', debit: '0', credit: f(diff.abs()) });
  lines.push({ account: 'AP', debit: '0', credit: f(b) });
  return { lines, variance: diff };
}
/** Receipt recorded: Dr Bank / Cr Customer advances (unallocated cash is a liability until applied). */
export const receiptPosting = (amount: Decimal.Value): PostingLine[] => [{ account: 'BANK', debit: f(amount), credit: '0' }, { account: 'ADVANCES', debit: '0', credit: f(amount) }];
/** Allocation: Dr Customer advances / Cr Receivable. */
export const allocationPosting = (amount: Decimal.Value): PostingLine[] => [{ account: 'ADVANCES', debit: f(amount), credit: '0' }, { account: 'AR', debit: '0', credit: f(amount) }];
/** Reversal: swap debit/credit — posted entries are corrected with a LINKED reversal, never edited. */
export const reversal = (lines: PostingLine[]): PostingLine[] => lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
export const isBalanced = (lines: PostingLine[]) => lines.reduce((a, l) => a.plus(l.debit).minus(l.credit), D(0)).isZero();
