import { D, roundMoney, taxFor } from '@dbl/contracts';

export interface QLine { quantity: string; unit_price: string; expected_unit_cost: string; tax_code: string }
export function quoteTotals(lines: QLine[], minor = 2) {
  let net = D(0), tax = D(0), cost = D(0);
  for (const l of lines) { const n = roundMoney(D(l.quantity).mul(l.unit_price), minor); net = net.plus(n); tax = tax.plus(taxFor(n, l.tax_code, minor)); cost = cost.plus(roundMoney(D(l.quantity).mul(l.expected_unit_cost), minor)); }
  const margin = net.minus(cost);
  return { net: net.toFixed(2), tax: tax.toFixed(2), total: net.plus(tax).toFixed(2), expectedCost: cost.toFixed(2), margin: margin.toFixed(2), marginPercent: net.isZero() ? null : margin.div(net).mul(100).toFixed(1) };
}
export const QUOTE_TRANSITIONS: Record<string, string[]> = { draft: ['approved'], approved: ['sent', 'accepted', 'expired', 'superseded'], sent: ['accepted', 'expired', 'superseded'], accepted: [], expired: [], superseded: [] };
export const canTransition = (from: string, to: string) => QUOTE_TRANSITIONS[from]?.includes(to) ?? false;
/** Enquiry data completeness: missing data becomes TASKS, never invented values. */
export function missingEnquiryInfo(e: { cargo: Record<string, unknown>; incoterm?: string | null; mode: string }): string[] {
  const m: string[] = []; const c = e.cargo ?? {};
  if (!c.commodity) m.push('commodity'); if (!c.packages && !c.pallets && !c.containers) m.push('package count or container type'); if (!c.grossWeightKg) m.push('gross weight');
  if (!e.incoterm) m.push('incoterm'); if (!c.readyDate) m.push('cargo ready date');
  if (['ocean_lcl', 'air'].includes(e.mode) && !c.volumeCbm && !c.dimensions) m.push('dimensions / volume');
  return m;
}
