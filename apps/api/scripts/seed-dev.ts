/**
 * Dev seed: provisions a demo tenant and builds a realistic scenario THROUGH THE API (so every rule — maker/checker,
 * idempotency, RLS — applies exactly as in production). Requires the API running on API_URL with DEV_AUTH_SECRET set.
 *   npx tsx apps/api/scripts/seed-dev.ts
 */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { addMemberToTenant, provisionTenant } from '../src/provisioning';

const API = process.env.API_URL ?? 'http://localhost:3001'; const SECRET = process.env.DEV_AUTH_SECRET ?? 'dev-secret-dev-secret-dev-secret-00';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://dbl_app:dbl_app_dev@localhost:54329/dbl' });
const slug = process.env.SEED_SLUG ?? 'demo-freight';
const tok = (sub: string) => new SignJWT({ email: `${sub}@demo.test` }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setAudience('dbl-api').setExpirationTime('2h').sign(new TextEncoder().encode(SECRET));

async function main() {
  const t = await provisionTenant(pool, { slug, name: 'Demo Freight LLC', ownerSubject: 'layla' });
  const people: Array<[string, string[]]> = [['omar', ['sales']], ['nadia', ['pricing']], ['faisal', ['finance_manager']], ['sana', ['accountant']], ['yusuf', ['warehouse_supervisor']], ['hamad', ['warehouse_operator']], ['rami', ['freight_ops']], ['cem', ['customs_specialist']]];
  for (const [sub, roles] of people) await addMemberToTenant(pool, t.tenantId, { subject: sub, roles });
  const as = (sub: string) => async (method: 'GET' | 'POST', path: string, body?: unknown, key?: string) => {
    const r = await fetch(`${API}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${await tok(sub)}`, 'X-Tenant-Id': t.tenantId, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${sub} ${method} ${path} → ${r.status} ${JSON.stringify(j)}`); return j;
  };
  const [owner, omar, nadia, faisal, sana, yusuf, hamad, rami] = ['layla', 'omar', 'nadia', 'faisal', 'sana', 'yusuf', 'hamad', 'rami'].map(as);
  const party = (n: string, roles: string[]) => owner('POST', '/parties', { legalName: n, roles }).then((p) => p.id as string);
  const [pharma, foods, line, haulier] = await Promise.all([party('Gulf Pharma Distribution', ['customer']), party('Al Noor Foods Trading', ['customer']), party('Ocean Line One', ['carrier', 'supplier']), party('Desert Haulage', ['transporter', 'supplier'])]);
  const today = new Date().toISOString().slice(0, 10);

  async function wonJob(customer: string, price: string, cost: string, origin: string, destination: string, mode = 'ocean_fcl') {
    const enq = await omar('POST', '/enquiries', { legalEntityId: t.legalEntityId, customerPartyId: customer, mode, origin, destination, cargo: { commodity: 'General cargo', grossWeightKg: 12000 }, incoterm: 'FOB' });
    await omar('POST', `/enquiries/${enq.id}/qualify`, {}, randomUUID());
    const q = await omar('POST', '/quotes', { legalEntityId: t.legalEntityId, enquiryId: enq.id, customerPartyId: customer, currency: 'AED', validUntil: '2099-12-31', mode, origin, destination, incoterm: 'FOB',
      lines: [{ description: `${mode === 'air' ? 'Air' : 'Ocean'} freight`, chargeType: 'fixed', quantity: '1', unitPrice: price, expectedUnitCost: cost, taxCode: 'ZR', taxRationale: 'International transport', supplierPartyId: line }, { description: 'Terminal handling', chargeType: 'estimated', chargeGroup: 'destination', quantity: '1', unitPrice: '1500.50', expectedUnitCost: '1000.00', taxCode: 'SR5', supplierPartyId: line }] });
    await nadia('POST', `/quotes/${q.id}/approve`, {}, randomUUID());
    const a = await omar('POST', `/quotes/${q.id}/accept`, { acceptedByName: 'Customer ops', evidence: { channel: 'email', reference: 'seed' } }, randomUUID());
    return a.job.id as string;
  }
  const j1 = await wonJob(pharma, '10000.00', '7000.00', 'Shanghai', 'Jebel Ali');
  const j2 = await wonJob(foods, '6400.00', '4200.00', 'Mundra', 'Jebel Ali');
  const j3 = await wonJob(pharma, '2300.00', '1500.00', 'Frankfurt', 'Dubai', 'air');
  for (const [job, o, d, mode] of [[j1, 'Shanghai', 'Jebel Ali', 'ocean_fcl'], [j2, 'Mundra', 'Jebel Ali', 'ocean_fcl'], [j3, 'Frankfurt', 'Dubai', 'air']] as const) {
    const s = await rami('POST', '/shipments', { jobId: job, mode, origin: o, destination: d, cargo: [{ description: 'Palletised cargo', quantity: '22', ownerPartyId: pharma }], legs: [{ mode, origin: o, destination: d, operatorPartyId: line }] });
    const bk = await rami('POST', '/bookings', { shipmentId: s.id, carrierPartyId: line, requestKey: `seed-${s.id}` }); await rami('POST', `/bookings/${bk.id}/confirm`, { externalRef: `BKG-${s.ref}` }, randomUUID());
    await rami('POST', `/shipments/${s.id}/events`, { code: 'DEPARTED', eventTime: new Date(Date.now() - 4 * 864e5).toISOString(), source: 'carrier', isActual: true, externalEventId: `dep-${s.id}` });
    await rami('POST', `/shipments/${s.id}/events`, { code: 'ETA_JEBEL_ALI', eventTime: new Date(Date.now() + 3 * 864e5).toISOString(), source: 'inferred', isActual: false });
  }
  // invoice one job all the way through (drafted by accountant, approved + posted by finance)
  const inv = await sana('POST', '/invoices', { jobId: j2 }); await faisal('POST', `/invoices/${inv.id}/approve`, {}, randomUUID()); await faisal('POST', `/invoices/${inv.id}/post`, { postingDate: today }, randomUUID());
  // custody stock + a quarantine + a pending approval
  const lot = await yusuf('POST', '/receipts', { facilityId: t.facilityId, ownerPartyId: pharma, description: 'Insulin pens 2–8 °C', batch: 'B-2210', quantity: '120', customsStatus: 'duty_paid', commandKey: randomUUID() });
  await yusuf('POST', '/receipts', { facilityId: t.facilityId, ownerPartyId: foods, description: 'Canned goods', quantity: '800', customsStatus: 'bonded', commandKey: randomUUID() });
  await hamad('POST', '/release-orders', { lotId: lot.lotId, qty: '20' });
  await owner('POST', '/ai/tools/propose_payment_batch/invoke', { args: { summary: 'Pay Ocean Line One and Desert Haulage — AED 48,200', supplierPartyIds: [line, haulier] } });
  console.log(JSON.stringify({ tenantId: t.tenantId, login: 'layla (owner) · omar sales · nadia pricing · faisal finance_manager · sana accountant · yusuf warehouse_supervisor · hamad warehouse_operator · rami freight_ops', jobs: [j1, j2, j3] }, null, 2));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
