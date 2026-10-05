import pg from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { makeParty, type Client, type World } from './helpers';

export async function invariants(url: string) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try { return (await c.query(readFileSync(new URL('../../../database/invariants.sql', import.meta.url), 'utf8'))).rows as Array<{ invariant: string; violations: number }>; } finally { await c.end(); }
}
/** quote → accept → job. Returns ids; sales drafts, pricing approves. */
export async function openJob(w: World, opts: { price?: string; cost?: string; currency?: string } = {}) {
  const sales = await w.member(w.a.tenantId, `s${randomUUID().slice(0, 4)}`, ['sales']);
  const pricing = await w.member(w.a.tenantId, `p${randomUUID().slice(0, 4)}`, ['pricing']);
  const customer = await makeParty(w.owner, `Customer ${randomUUID().slice(0, 5)}`, ['customer']);
  const supplier = await makeParty(w.owner, `Supplier ${randomUUID().slice(0, 5)}`, ['supplier']);
  const q = await sales.post('/quotes', { legalEntityId: w.a.legalEntityId, customerPartyId: customer, currency: opts.currency ?? 'AED', validUntil: '2099-01-01', mode: 'road', origin: 'Dubai', destination: 'Riyadh',
    lines: [{ description: 'Road freight', chargeType: 'fixed', quantity: '1', unitPrice: opts.price ?? '1000.00', expectedUnitCost: opts.cost ?? '700.00', taxCode: 'SR5', supplierPartyId: supplier }] });
  await pricing.cmd(`/quotes/${q.body.id}/approve`);
  const a = await sales.cmd(`/quotes/${q.body.id}/accept`, { acceptedByName: 'X', evidence: { channel: 'portal', reference: 'r' } });
  return { jobId: a.body.job.id as string, customer, supplier, quoteId: q.body.id as string };
}
export async function lot(w: World, c: Client, qty: string, over: Record<string, unknown> = {}) {
  const owner = await makeParty(w.owner, `Owner ${randomUUID().slice(0, 5)}`, ['customer']);
  const r = await c.post('/receipts', { facilityId: w.a.facilityId, ownerPartyId: owner, description: 'Pallets', quantity: qty, customsStatus: 'duty_paid', commandKey: randomUUID(), ...over });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { lotId: r.body.lotId as string, owner };
}
