import { describe, expect, it } from 'vitest';
import { D, money, roundMoney, taxFor } from './money';
import { ROLE_TEMPLATES, PERMISSIONS } from './permissions';
import { ROUTES } from './routes';
import { EVENT_TOPICS } from './events';

describe('money', () => {
  it('rounds half-up on exact decimals (no float drift)', () => {
    expect(roundMoney('75.025').toFixed(2)).toBe('75.03'); expect(roundMoney('0.125').toFixed(2)).toBe('0.13'); expect(D('0.1').plus('0.2').toFixed(1)).toBe('0.3');
    expect(taxFor('1500.50', 'SR5').toFixed(2)).toBe('75.03'); expect(taxFor('10000', 'ZR').toFixed(2)).toBe('0.00'); expect(money('1234.5')).toBe('1234.50');
  });
});
describe('route table = contract', () => {
  it('operation ids and method+path pairs are unique', () => { expect(new Set(ROUTES.map((r) => r.operationId)).size).toBe(ROUTES.length); expect(new Set(ROUTES.map((r) => r.method + r.path)).size).toBe(ROUTES.length); });
  it('every guarded route names a catalogued permission; every command that changes money or stock is idempotent or naturally keyed', () => {
    for (const r of ROUTES) if (r.permission) expect(PERMISSIONS).toContain(r.permission);
    for (const id of ['postInvoice', 'allocatePayment', 'authorizeRelease', 'recordSupplierBill', 'acceptQuote', 'closeJob', 'confirmBooking', 'completeDelivery', 'recordCustomsRelease']) expect(ROUTES.find((r) => r.operationId === id)!.idempotent).toBe(true);
  });
});
describe('role templates (separation of duties by construction)', () => {
  const has = (role: string, p: string) => (ROLE_TEMPLATES[role].permissions as string[]).includes(p);
  it('where the policy is ROLE-level separation, no non-owner role spans both sides', () => {
    // Warehouse release is split by role. (Quote, invoice and bank maker-checker is enforced per USER at runtime — drafter ≠ approver — see API risk tests.)
    for (const [role] of Object.entries(ROLE_TEMPLATES)) { if (role === 'owner') continue;
      expect(has(role, 'warehouse.release.request') && has(role, 'warehouse.release.authorize')).toBe(false); }
  });
  it('external roles can never see margins or approve anything', () => { for (const r of ['customer_portal', 'agent_portal', 'transporter_portal', 'driver']) for (const p of ['jobs.margin.view', 'invoices.approve', 'quotes.approve', 'payments.authorize']) expect(has(r, p)).toBe(false); });
  it('event topics are unique', () => { expect(new Set(EVENT_TOPICS).size).toBe(EVENT_TOPICS.length); });
});
