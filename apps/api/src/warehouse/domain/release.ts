import { D } from '@dbl/contracts';
export interface Lot { qty_on_hand: string; qty_reserved: string; condition: string; customs_status: string }
export type ReleaseVerdict = { ok: true } | { ok: false; code: 'STOCK_ON_HOLD' | 'INSUFFICIENT_STOCK' | 'RELEASE_EVIDENCE_REQUIRED'; message: string };
/** Pure release decision. Evidence presence is resolved by the caller (customs case lookup). */
export function evaluateRelease(lot: Lot, qty: string, activeHolds: number, hasReleaseEvidence: boolean): ReleaseVerdict {
  if (activeHolds > 0 || lot.condition === 'quarantined') return { ok: false, code: 'STOCK_ON_HOLD', message: 'Cargo is on hold / quarantined and cannot be released.' };
  if (D(lot.qty_on_hand).lt(qty) || D(lot.qty_reserved).lt(qty)) return { ok: false, code: 'INSUFFICIENT_STOCK', message: 'Quantity on hand or reserved is lower than the release quantity.' };
  if (lot.customs_status === 'bonded' && !hasReleaseEvidence) return { ok: false, code: 'RELEASE_EVIDENCE_REQUIRED', message: 'Bonded cargo requires recorded customs release evidence.' };
  return { ok: true };
}
export const availableQty = (lot: Lot) => D(lot.qty_on_hand).minus(lot.qty_reserved);
