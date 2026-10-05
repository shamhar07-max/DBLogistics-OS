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
  const people: Array<[string, string[]]> = [['omar', ['sales']], ['nadia', ['pricing']], ['faisal', ['finance_manager']], ['sana', ['accountant']], ['yusuf', ['warehouse_supervisor']], ['hamad', ['warehouse_operator']], ['rami', ['freight_ops']], ['cem', ['customs_specialist']], ['hana', ['hr']], ['qadir', ['quality_manager']]];
  for (const [sub, roles] of people) await addMemberToTenant(pool, t.tenantId, { subject: sub, roles });
  const as = (sub: string) => async (method: 'GET' | 'POST', path: string, body?: unknown, key?: string) => {
    const r = await fetch(`${API}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${await tok(sub)}`, 'X-Tenant-Id': t.tenantId, 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${sub} ${method} ${path} → ${r.status} ${JSON.stringify(j)}`); return j;
  };
  const [owner, omar, nadia, faisal, sana, yusuf, hamad, rami, hana, qadir] = ['layla', 'omar', 'nadia', 'faisal', 'sana', 'yusuf', 'hamad', 'rami', 'hana', 'qadir'].map(as);
  const party = (n: string, roles: string[]) => owner('POST', '/parties', { legalName: n, roles }).then((p) => p.id as string);
  const [pharma, foods, line, haulier] = await Promise.all([party('Gulf Pharma Distribution', ['customer']), party('Al Noor Foods Trading', ['customer']), party('Ocean Line One', ['carrier', 'supplier']), party('Desert Haulage', ['transporter', 'supplier'])]);
  // portal users: two customers (isolation demo), an air agent, and the haulier
  const agent = await party('Rhein-Main Air Agents', ['agent']);
  for (const [sub, role, ws, p] of [['pharma-user', 'customer_portal', 'customer', pharma], ['foods-user', 'customer_portal', 'customer', foods], ['agent-user', 'agent_portal', 'agent', agent], ['haulier-user', 'transporter_portal', 'transporter', haulier]] as const)
    await addMemberToTenant(pool, t.tenantId, { subject: sub, roles: [role], workspace: ws, partyId: p });
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
  let firstShipment: string | undefined;
  for (const [job, o, d, mode] of [[j1, 'Shanghai', 'Jebel Ali', 'ocean_fcl'], [j2, 'Mundra', 'Jebel Ali', 'ocean_fcl'], [j3, 'Frankfurt', 'Dubai', 'air']] as const) {
    const s = await rami('POST', '/shipments', { jobId: job, mode, origin: o, destination: d, cargo: [{ description: 'Palletised cargo', quantity: '22', ownerPartyId: pharma }], legs: [{ mode, origin: o, destination: d, operatorPartyId: mode === 'air' ? agent : line }] });
    firstShipment ??= s.id;
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
  // a quotation waiting for the pharma customer to accept in the portal
  const oq = await omar('POST', '/quotes', { legalEntityId: t.legalEntityId, customerPartyId: pharma, currency: 'AED', validUntil: '2099-12-31', mode: 'road', origin: 'Dubai', destination: 'Riyadh', incoterm: 'DAP', lines: [{ description: 'Road freight Dubai–Riyadh', chargeType: 'fixed', quantity: '1', unitPrice: '4200.00', expectedUnitCost: '3100.00', taxCode: 'ZR', taxRationale: 'International transport' }] });
  await nadia('POST', `/quotes/${oq.id}/approve`, {}, randomUUID());
  // people & quality: a driver with a valid licence, one without, an expiring forklift ticket, a trip, a task, a conversation, and a quality hold awaiting separate release
  const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const karim = await hana('POST', '/employees', { legalEntityId: t.legalEntityId, fullName: 'Karim Haddad', jobTitle: 'Driver', department: 'Transport' });
  await hana('POST', '/employees', { legalEntityId: t.legalEntityId, fullName: 'Bilal Rahman', jobTitle: 'Driver', department: 'Transport' });
  const sami = await hana('POST', '/employees', { legalEntityId: t.legalEntityId, fullName: 'Sami Idris', jobTitle: 'Forklift operator', department: 'Warehouse' });
  await hana('POST', `/employees/${karim.id}/qualifications`, { kind: 'driving', reference: 'DL-77120', issuedOn: plusDays(-400), validTo: plusDays(300) });
  await hana('POST', `/employees/${sami.id}/qualifications`, { kind: 'forklift', reference: 'FLT-5521', issuedOn: plusDays(-700), validTo: plusDays(20) });
  await hana('POST', '/assets', { kind: 'forklift', code: 'FLT-01', nextServiceDue: plusDays(14) });
  const trip = await rami('POST', '/trips', { transporterPartyId: haulier, driverEmployeeId: karim.id, vehicleRef: 'DXB A-48213', stops: [{ kind: 'pickup', address: 'Jebel Ali Port, Gate 4', ...(firstShipment ? { shipmentId: firstShipment } : {}) }, { kind: 'delivery', address: 'Dubai Investments Park', ...(firstShipment ? { shipmentId: firstShipment } : {}) }] });
  await owner('POST', `/trips/${trip.id}/dispatch`, {}, randomUUID());
  await rami('POST', '/tasks', { title: 'Chase carrier for amended bill of lading', relatedType: 'job', relatedId: j1, dueAt: new Date(Date.now() + 864e5).toISOString() });
  await rami('POST', '/messages', { relatedType: 'job', relatedId: j1, channel: 'email', direction: 'inbound', body: 'Consignee asks to deliver after 14:00 — gate pass issued for Thursday.' });
  await qadir('POST', '/incidents', { kind: 'temperature_excursion', severity: 'high', description: 'Logger shows 11 °C for 40 minutes during unloading', jobId: j1, lotId: lot.lotId, placeHold: true });
  await owner('POST', '/ai/tools/propose_payment_batch/invoke', { args: { summary: 'Pay Ocean Line One and Desert Haulage — AED 48,200', supplierPartyIds: [line, haulier] } });
  console.log(JSON.stringify({ tenantId: t.tenantId, login: 'layla (owner) · omar sales · nadia pricing · faisal finance_manager · sana accountant · yusuf warehouse_supervisor · hamad warehouse_operator · rami freight_ops · hana hr · qadir quality_manager · portal: pharma-user & foods-user (customers), agent-user (agent), haulier-user (transporter)', jobs: [j1, j2, j3] }, null, 2));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
