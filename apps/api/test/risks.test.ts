import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { ROUTES } from '@dbl/contracts';
import { APP_URL, approvedDocument, close, makeParty, sign, SU_URL, world, type World } from './helpers';
import { invariants, lot, openJob } from './helpers2';

let w: World;
beforeAll(async () => { w = await world(); });
afterAll(async () => close(w));
const today = () => new Date().toISOString().slice(0, 10);

describe('tenant isolation', () => {
  it('denies a cross-tenant record request without leaking existence', async () => {
    const { jobId } = await openJob(w);
    const ownerB = w.as(`owner-b-${w.b.tenantId.slice(0, 0)}`, w.b.tenantId);   // not a real subject for B → membership missing
    const realB = await w.su.query(`SELECT subject FROM platform.users u JOIN platform.memberships m ON m.user_id=u.id WHERE m.tenant_id=$1`, [w.b.tenantId]);
    const bUser = w.as(realB.rows[0].subject, w.b.tenantId);
    expect((await bUser.get(`/jobs/${jobId}`)).status).toBe(404);                        // own tenant context: A's job simply does not exist
    expect((await bUser.get('/jobs')).body).toEqual([]);                                // listing shows nothing of A
    const spoof = w.as(realB.rows[0].subject, w.a.tenantId);                            // claims tenant A
    const r = await spoof.get(`/jobs/${jobId}`); expect(r.status).toBe(403); expect(r.body.code).toBe('FORBIDDEN');
    void ownerB;
  });
  it('is enforced by PostgreSQL itself (RLS) — even with a hand-written query', async () => {
    const { jobId } = await openJob(w);
    const c = await w.appPool.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [w.b.tenantId]);
      expect((await c.query(`SELECT count(*)::int n FROM logistics.jobs WHERE id=$1`, [jobId])).rows[0].n).toBe(0);
      await expect(c.query(`INSERT INTO parties.parties(tenant_id, legal_name) VALUES ($1,'Sneaky')`, [w.a.tenantId])).rejects.toThrow(/row-level security/);
      await c.query('ROLLBACK');
      await c.query('BEGIN');   // no tenant set at all → no rows
      expect((await c.query(`SELECT count(*)::int n FROM logistics.jobs`)).rows[0].n).toBe(0); await c.query('ROLLBACK');
    } finally { c.release(); }
  });
  it('every tenant_id table has FORCE ROW LEVEL SECURITY; runtime role cannot bypass it', async () => {
    const t = await w.su.query(`SELECT c.table_schema s, c.table_name t, cl.relrowsecurity rls, cl.relforcerowsecurity force FROM information_schema.columns c
      JOIN pg_class cl ON cl.relname=c.table_name JOIN pg_namespace n ON n.oid=cl.relnamespace AND n.nspname=c.table_schema
      WHERE c.column_name='tenant_id' AND c.table_schema NOT IN ('information_schema','pg_catalog') AND cl.relkind='r'`);
    expect(t.rowCount).toBeGreaterThan(40);
    expect(t.rows.filter((r) => !r.rls || !r.force).map((r) => `${r.s}.${r.t}`)).toEqual([]);
    const role = (await w.su.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='dbl_app'`)).rows[0]; expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe('financial integrity', () => {
  async function postable(price = '1000.00') {
    const j = await openJob(w, { price }); const acct = await w.member(w.a.tenantId, `ac${randomUUID().slice(0, 4)}`, ['accountant']); const fin = await w.member(w.a.tenantId, `fm${randomUUID().slice(0, 4)}`, ['finance_manager']);
    const d = await acct.post('/invoices', { jobId: j.jobId }); await fin.cmd(`/invoices/${d.body.id}/approve`);
    return { ...j, acct, fin, invoiceId: d.body.id as string };
  }
  it('repeated invoice-post command → one posting; reused key with different body is refused', async () => {
    const p = await postable(); const key = randomUUID();
    const [r1, r2] = await Promise.all([p.fin.cmd(`/invoices/${p.invoiceId}/post`, { postingDate: today() }, key), p.fin.cmd(`/invoices/${p.invoiceId}/post`, { postingDate: today() }, key)]);
    expect([r1.status, r2.status]).toEqual([200, 200]); expect(r1.body.ref).toBe(r2.body.ref); expect(r1.body.journalId).toBe(r2.body.journalId);
    expect((await w.su.query(`SELECT count(*)::int n FROM finance.journals WHERE source_type='invoice' AND source_id=$1`, [p.invoiceId])).rows[0].n).toBe(1);
    expect((await p.fin.cmd(`/invoices/${p.invoiceId}/post`, { postingDate: '2026-01-02' }, key)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const other = await p.fin.cmd(`/invoices/${p.invoiceId}/post`, { postingDate: today() });             // new key, already posted → state error, never a 2nd posting
    expect(other.body.code).toBe('INVALID_STATE_TRANSITION');
    expect((await p.fin.post(`/invoices/${p.invoiceId}/post`, { postingDate: today() })).body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('rejects posting into a closed accounting period', async () => {
    const p = await postable(); await w.su.query(`UPDATE finance.accounting_periods SET status='closed' WHERE legal_entity_id=$1 AND $2::date BETWEEN start_date AND end_date`, [w.a.legalEntityId, today()]);
    const r = await p.fin.cmd(`/invoices/${p.invoiceId}/post`, { postingDate: today() }); expect(r.status).toBe(422); expect(r.body.code).toBe('ACCOUNTING_PERIOD_CLOSED'); expect(r.body.details.postingDate).toBe(today());
    await w.su.query(`UPDATE finance.accounting_periods SET status='open' WHERE legal_entity_id=$1`, [w.a.legalEntityId]);
  });
  it('separation of duties: drafter cannot approve own invoice', async () => {
    const j = await openJob(w); const both = await w.member(w.a.tenantId, 'both', ['finance_manager']);
    const d = await both.post('/invoices', { jobId: j.jobId }); expect((await both.cmd(`/invoices/${d.body.id}/approve`)).body.code).toBe('SEPARATION_OF_DUTIES');
  });
  it('payment cannot be allocated beyond its available amount or the invoice balance', async () => {
    const p = await postable('500.00'); await p.fin.cmd(`/invoices/${p.invoiceId}/post`, { postingDate: today() });      // total 525.00
    const pay = await p.acct.post('/payments', { legalEntityId: w.a.legalEntityId, partyId: p.customer, currency: 'AED', amount: '300.00', receivedOn: today() });
    const over = await p.acct.cmd(`/payments/${pay.body.id}/allocate`, { invoiceId: p.invoiceId, amount: '300.01', allocationKey: randomUUID() }); expect(over.body.code).toBe('OVER_ALLOCATION');
    const [a, b] = await Promise.all([200, 200].map((x) => p.acct.cmd(`/payments/${pay.body.id}/allocate`, { invoiceId: p.invoiceId, amount: `${x}.00`, allocationKey: randomUUID() })));
    expect([a.status, b.status].sort()).toEqual([200, 422]);                              // concurrent: only one 200 fits in 300
    const dupKey = 'same-allocation-key'; const ok = await p.acct.cmd(`/payments/${pay.body.id}/allocate`, { invoiceId: p.invoiceId, amount: '50.00', allocationKey: dupKey }); const again = await p.acct.cmd(`/payments/${pay.body.id}/allocate`, { invoiceId: p.invoiceId, amount: '50.00', allocationKey: dupKey });
    expect(ok.body.duplicate ?? false).toBe(false); expect(again.body.duplicate).toBe(true);
    expect((await invariants(SU_URL)).filter((i) => i.violations)).toEqual([]);
  });
  it('duplicate supplier bill is rejected; late bill with no accrual is expensed (never ignored)', async () => {
    const j = await openJob(w); const acct = await w.member(w.a.tenantId, `ab${randomUUID().slice(0, 4)}`, ['accountant']);
    const body = { legalEntityId: w.a.legalEntityId, supplierPartyId: j.supplier, jobId: j.jobId, supplierInvoiceNo: 'LATE-1', currency: 'AED', amount: '650.00' };
    const r = await acct.cmd('/supplier-bills', body); expect(r.status).toBe(201); expect(r.body.accrualsCleared).toBe(0); expect(r.body.variance).toBe('650.00');
    expect((await acct.cmd('/supplier-bills', body)).body.code).toBe('DUPLICATE');
  });
  it('database refuses unbalanced journals, edits to posted journals, and audit tampering', async () => {
    const c = await w.su.connect();   // even a superuser-owned session cannot commit an unbalanced journal
    try {
      const acc = (await c.query(`SELECT id FROM finance.accounts WHERE legal_entity_id=$1 AND system_key='BANK'`, [w.a.legalEntityId])).rows[0].id;
      await c.query('BEGIN');
      const j = (await c.query(`INSERT INTO finance.journals(tenant_id, legal_entity_id, ref, posting_date, currency, source_type, source_id) VALUES ($1,$2,'JNL-X-1',current_date,'AED','test',gen_random_uuid()) RETURNING id`, [w.a.tenantId, w.a.legalEntityId])).rows[0].id;
      await c.query(`INSERT INTO finance.journal_lines(tenant_id, journal_id, account_id, debit) VALUES ($1,$2,$3,100)`, [w.a.tenantId, j, acc]);
      await expect(c.query('COMMIT')).rejects.toThrow(/unbalanced/);
    } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
    await expect(w.su.query(`UPDATE finance.journal_lines SET debit = debit + 1`)).rejects.toThrow(/append-only/);
    await expect(w.su.query(`DELETE FROM platform.audit_events`)).rejects.toThrow(/append-only/);
    const ac = await w.appPool.connect(); try { await ac.query('BEGIN'); await ac.query(`SELECT set_config('app.tenant_id',$1,true)`, [w.a.tenantId]); await expect(ac.query(`UPDATE finance.journals SET description='x'`)).rejects.toThrow(/permission denied/); } finally { await ac.query('ROLLBACK'); ac.release(); }
  });
  it('job closure requires unresolved items to be explicitly acknowledged', async () => {
    const j = await openJob(w); const fin = await w.member(w.a.tenantId, `c${randomUUID().slice(0, 4)}`, ['finance_manager']);
    const r = await fin.cmd(`/jobs/${j.jobId}/close`, { acknowledgedExceptions: [] }); expect(r.body.code).toBe('JOB_NOT_CLOSABLE'); expect(r.body.details.blockers.map((b: any) => b.key)).toEqual(expect.arrayContaining(['unbilled_revenue', 'missing_costs']));
    const ack = await fin.cmd(`/jobs/${j.jobId}/close`, { acknowledgedExceptions: ['unbilled_revenue', 'missing_costs'] }); expect(ack.status).toBe(200);
    expect((await w.su.query(`SELECT closure_notes FROM logistics.jobs WHERE id=$1`, [j.jobId])).rows[0].closure_notes.acknowledged).toContain('unbilled_revenue');
  });
});

describe('warehouse custody', () => {
  it('concurrent authorisation can release the stock only once; ledger reconciles', async () => {
    const wh = await w.member(w.a.tenantId, `wh${randomUUID().slice(0, 4)}`, ['warehouse_operator']);
    const s1 = await w.member(w.a.tenantId, `sup${randomUUID().slice(0, 4)}`, ['warehouse_supervisor']); const s2 = await w.member(w.a.tenantId, `sup${randomUUID().slice(0, 4)}`, ['warehouse_supervisor']);
    const { lotId } = await lot(w, s1, '10'); const o = await wh.post('/release-orders', { lotId, qty: '10' }); expect(o.status).toBe(201);
    const [a, b] = await Promise.all([s1.cmd(`/release-orders/${o.body.id}/authorize`), s2.cmd(`/release-orders/${o.body.id}/authorize`)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = (await w.su.query(`SELECT qty_on_hand, qty_reserved FROM warehouse.stock_lots WHERE id=$1`, [lotId])).rows[0]; expect([row.qty_on_hand, row.qty_reserved]).toEqual(['0.0000', '0.0000']);
    expect((await w.su.query(`SELECT count(*)::int n FROM warehouse.custody_movements WHERE lot_id=$1 AND kind='release'`, [lotId])).rows[0].n).toBe(1);
  });
  it('two requests for the same last units: one reserves, the other is refused', async () => {
    const wh = await w.member(w.a.tenantId, `wh${randomUUID().slice(0, 4)}`, ['warehouse_operator']); const sup = await w.member(w.a.tenantId, `sup${randomUUID().slice(0, 4)}`, ['warehouse_supervisor']);
    const { lotId } = await lot(w, sup, '10'); const [a, b] = await Promise.all([wh.post('/release-orders', { lotId, qty: '6' }), wh.post('/release-orders', { lotId, qty: '6' })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]); expect([a, b].find((x) => x.status === 409)!.body.code).toBe('INSUFFICIENT_STOCK');
  });
  it('receipt retried with the same command key creates one lot; requester cannot authorise own release; quarantine blocks dispatch', async () => {
    const sup = await w.member(w.a.tenantId, `sup${randomUUID().slice(0, 4)}`, ['warehouse_supervisor']); const owner = await makeParty(w.owner, 'Own', ['customer']); const commandKey = randomUUID();
    const body = { facilityId: w.a.facilityId, ownerPartyId: owner, description: 'X', quantity: '5', customsStatus: 'duty_paid', commandKey };
    const r1 = await sup.post('/receipts', body); const r2 = await sup.post('/receipts', body); expect(r2.body.lotId).toBe(r1.body.lotId); expect(r2.body.duplicate).toBe(true);
    const wh = await w.member(w.a.tenantId, `wh${randomUUID().slice(0, 4)}`, ['warehouse_operator', 'warehouse_supervisor']);
    const { lotId } = await lot(w, wh, '5'); const o = await wh.post('/release-orders', { lotId, qty: '2' });
    expect((await wh.cmd(`/release-orders/${o.body.id}/authorize`)).body.code).toBe('SEPARATION_OF_DUTIES');
    await sup.post(`/warehouse/lots/${lotId}/holds`, { reason: 'Temperature excursion', kind: 'quarantine' });
    expect((await sup.cmd(`/release-orders/${o.body.id}/authorize`)).body.code).toBe('STOCK_ON_HOLD');
    expect((await wh.post('/release-orders', { lotId, qty: '1' })).body.code).toBe('STOCK_ON_HOLD');
  });
  it('bonded cargo cannot leave without authority-issued, approved release evidence', async () => {
    const j = await openJob(w); const cs = await w.member(w.a.tenantId, `cu${randomUUID().slice(0, 4)}`, ['customs_specialist']); const wh = await w.member(w.a.tenantId, `wh${randomUUID().slice(0, 4)}`, ['warehouse_operator']); const sup = await w.member(w.a.tenantId, `sup${randomUUID().slice(0, 4)}`, ['warehouse_supervisor']);
    const { lotId } = await lot(w, sup, '4', { customsStatus: 'bonded' });
    const cc = await cs.post('/customs-cases', { jobId: j.jobId, importerPartyId: j.customer, procedure: 'import' }); expect(cc.status).toBe(201);
    const o = await wh.post('/release-orders', { lotId, qty: '4', customsCaseId: cc.body.id });
    expect((await sup.cmd(`/release-orders/${o.body.id}/authorize`)).body.code).toBe('RELEASE_EVIDENCE_REQUIRED');
    const internalDoc = await approvedDocument(w, cs, { docType: 'Checklist', issuerKind: 'internal', relatedType: 'customs_case', relatedId: cc.body.id });
    expect((await cs.cmd(`/customs-cases/${cc.body.id}/record-release`, { documentId: internalDoc, authorityReference: 'DO-1' })).body.code).toBe('RELEASE_EVIDENCE_REQUIRED');   // internal paperwork ≠ authority evidence
    expect((await cs.cmd(`/customs-cases/${cc.body.id}/record-release`, { documentId: randomUUID(), authorityReference: 'DO-1' })).body.code).toBe('RELEASE_EVIDENCE_REQUIRED');
    const auth = await approvedDocument(w, cs, { docType: 'Release', issuerKind: 'authority', relatedType: 'customs_case', relatedId: cc.body.id });
    const rel = await cs.cmd(`/customs-cases/${cc.body.id}/record-release`, { documentId: auth, authorityReference: 'DO-9981' }); expect(rel.body).toMatchObject({ internalStatus: 'release_recorded', authorityStatus: 'released' });
    expect((await sup.cmd(`/release-orders/${o.body.id}/authorize`)).status).toBe(200);
    expect((await invariants(SU_URL)).filter((i) => i.violations)).toEqual([]);
  });
});

describe('integrations, tracking and offline', () => {
  it('webhook: bad signature refused; duplicate delivery has exactly one effect', async () => {
    await w.su.query(`INSERT INTO integ.connections(tenant_id, provider, capability, credential_ref, webhook_secret_ref) VALUES ($1,'carrierx','tracking','sm://carrierx','WH_STRIPE')`, [w.a.tenantId]);
    const { default: request } = await import('supertest'); const body = JSON.stringify({ id: 'evt-1', type: 'tracking.update', occurredAt: '2026-10-01T00:00:00Z' });
    const send = (sig: string) => request(w.app.getHttpServer()).post('/api/v1/webhooks/carrierx').set('X-Tenant-Id', w.a.tenantId).set('X-DBL-Signature', sig).set('Content-Type', 'application/json').send(body);
    expect((await send('sha256=deadbeef')).status).toBe(401);
    const ok1 = await send(sign('whsec_test', body)); const ok2 = await send(sign('whsec_test', body));
    expect([ok1.status, ok2.status]).toEqual([202, 202]); expect(ok1.body.duplicate).toBe(false); expect(ok2.body.duplicate).toBe(true);
    expect((await w.su.query(`SELECT count(*)::int n FROM integ.inbox_events WHERE external_event_id='evt-1' AND tenant_id=$1`, [w.a.tenantId])).rows[0].n).toBe(1);
    expect((await w.su.query(`SELECT count(*)::int n FROM platform.outbox WHERE topic='IntegrationEventReceived' AND tenant_id=$1`, [w.a.tenantId])).rows[0].n).toBe(1);
  });
  it('late / duplicate / inferred tracking events keep history intact and never fake an actual', async () => {
    const j = await openJob(w); const ops = await w.member(w.a.tenantId, `o${randomUUID().slice(0, 4)}`, ['freight_ops']);
    const s = await ops.post('/shipments', { jobId: j.jobId, mode: 'road', origin: 'A', destination: 'B', cargo: [{ description: 'c', quantity: '1', ownerPartyId: j.customer }] });
    const ev = (code: string, t: string, extra: object) => ops.post(`/shipments/${s.body.id}/events`, { code, eventTime: t, source: 'carrier', isActual: true, ...extra });
    await ev('ARRIVED', '2026-10-02T10:00:00Z', { externalEventId: 'e-arr' });
    await ev('DEPARTED', '2026-10-01T10:00:00Z', { externalEventId: 'e-dep' });             // arrives LATE (received after ARRIVED)
    expect((await ev('DEPARTED', '2026-10-01T10:00:00Z', { externalEventId: 'e-dep' })).body.duplicate).toBe(true);
    const tl = await ops.get(`/shipments/${s.body.id}/timeline`); expect(tl.body.events.map((e: any) => e.code)).toEqual(['DEPARTED', 'ARRIVED']); expect(tl.body.currentMilestone).toBe('ARRIVED');
    const fake = await ops.post(`/shipments/${s.body.id}/events`, { code: 'DELIVERED', eventTime: '2026-10-03T10:00:00Z', source: 'inferred', isActual: true }); expect(fake.status).toBe(422);
    const est = await ops.post(`/shipments/${s.body.id}/events`, { code: 'ETA', eventTime: '2026-10-05T10:00:00Z', source: 'inferred', isActual: false }); expect(est.status).toBe(201);
    expect((await ops.get(`/shipments/${s.body.id}/timeline`)).body.currentMilestone).toBe('ARRIVED');      // estimate never becomes the current milestone
  });
  it('booking timeout: re-submission is blocked until the unknown outcome is reconciled', async () => {
    const j = await openJob(w); const ops = await w.member(w.a.tenantId, `o${randomUUID().slice(0, 4)}`, ['freight_ops']); const carrier = await makeParty(w.owner, 'Carrier', ['carrier']);
    const s = await ops.post('/shipments', { jobId: j.jobId, mode: 'ocean_fcl', origin: 'A', destination: 'B', cargo: [{ description: 'c', quantity: '1', ownerPartyId: j.customer }] });
    const b1 = await ops.post('/bookings', { shipmentId: s.body.id, carrierPartyId: carrier, requestKey: 'bk-request-1' });
    expect((await ops.post('/bookings', { shipmentId: s.body.id, carrierPartyId: carrier, requestKey: 'bk-request-1' })).body.duplicate).toBe(true);   // retry same key → same booking
    await ops.post(`/bookings/${b1.body.id}/mark-outcome-unknown`);
    const blocked = await ops.post('/bookings', { shipmentId: s.body.id, carrierPartyId: carrier, requestKey: 'bk-request-2' }); expect(blocked.body.code).toBe('BOOKING_OUTCOME_UNKNOWN');
    expect((await ops.cmd(`/bookings/${b1.body.id}/confirm`, { externalRef: 'FOUND-ON-CARRIER-PORTAL' })).status).toBe(200);
    expect((await w.su.query(`SELECT outcome_unknown FROM logistics.bookings WHERE id=$1`, [b1.body.id])).rows[0].outcome_unknown).toBe(false);
  });
  it('offline command submitted twice → one accepted effect; POD evidence is not delivery completion', async () => {
    const j = await openJob(w); const ops = await w.member(w.a.tenantId, `o${randomUUID().slice(0, 4)}`, ['freight_ops']); const driver = await w.member(w.a.tenantId, `d${randomUUID().slice(0, 4)}`, ['driver']);
    const s = await ops.post('/shipments', { jobId: j.jobId, mode: 'road', origin: 'A', destination: 'B', cargo: [{ description: 'c', quantity: '1', ownerPartyId: j.customer }] });
    const tr = await makeParty(w.owner, 'Haulier', ['transporter']);
    const trip = (await w.su.query(`INSERT INTO transport.trips(tenant_id, ref, transporter_party_id) VALUES ($1,$2,$3) RETURNING id`, [w.a.tenantId, `TRP-${randomUUID().slice(0, 6)}`, tr])).rows[0].id;
    const stop = (await w.su.query(`INSERT INTO transport.trip_stops(tenant_id, trip_id, seq, kind, shipment_id, address) VALUES ($1,$2,1,'delivery',$3,'Riyadh') RETURNING id`, [w.a.tenantId, trip, s.body.id])).rows[0].id;
    const commandId = randomUUID(); const batch = { deviceId: 'dev-1', commands: [{ commandId, type: 'capture_pod', deviceTime: '2026-10-02T08:00:00Z', payload: { tripStopId: stop, signedBy: 'Khalid' } }] };
    const first = await driver.post('/device/commands', batch); const second = await driver.post('/device/commands', batch);
    expect(first.body.results[0]).toMatchObject({ status: 'accepted', replay: false }); expect(second.body.results[0]).toMatchObject({ status: 'accepted', replay: true });
    expect((await w.su.query(`SELECT count(*)::int n FROM transport.proofs_of_delivery WHERE trip_stop_id=$1`, [stop])).rows[0].n).toBe(1);
    const other = await driver.post('/device/commands', { deviceId: 'dev-2', commands: [{ commandId: randomUUID(), type: 'capture_pod', deviceTime: '2026-10-02T08:05:00Z', payload: { tripStopId: stop, signedBy: 'Someone else' } }] });
    expect(other.body.results[0].status).toBe('conflict');                                  // a second device cannot overwrite
    expect((await w.su.query(`SELECT status FROM logistics.shipments WHERE id=$1`, [s.body.id])).rows[0].status).not.toBe('delivered');
  });
});

describe('maker-checker, AI and external users', () => {
  it('bank detail changes need a different approver with call-back verification', async () => {
    const maker = await w.member(w.a.tenantId, `m${randomUUID().slice(0, 4)}`, ['finance_manager']); const checker = await w.member(w.a.tenantId, `k${randomUUID().slice(0, 4)}`, ['finance_manager']); const clerk = await w.member(w.a.tenantId, `a${randomUUID().slice(0, 4)}`, ['accountant']);
    const sup = await makeParty(w.owner, 'Supplier Bank', ['supplier']);
    expect((await clerk.post(`/parties/${sup}/bank-detail-changes`, { accountName: 'X', iban: 'AE070331234567890123456', currency: 'AED' })).status).toBe(403);     // accountant cannot even propose
    const ch = await maker.post(`/parties/${sup}/bank-detail-changes`, { accountName: 'Supplier LLC', iban: 'AE070331234567890123456', currency: 'AED' }); expect(ch.status).toBe(201);
    expect((await maker.post(`/bank-detail-changes/${ch.body.id}/approve`, { callbackVerified: true })).body.code).toBe('SEPARATION_OF_DUTIES');
    expect((await checker.post(`/bank-detail-changes/${ch.body.id}/approve`, { callbackVerified: false })).status).toBe(422);
    expect((await checker.post(`/bank-detail-changes/${ch.body.id}/approve`, { callbackVerified: true })).status).toBe(200);
    expect((await w.su.query(`SELECT count(*)::int n FROM parties.bank_details WHERE party_id=$1 AND active_to IS NULL`, [sup])).rows[0].n).toBe(1);
  });
  it('AI tools obey the calling user’s permissions; high-risk actions only create approval requests; budget is enforced', async () => {
    const sales = await w.member(w.a.tenantId, `sl${randomUUID().slice(0, 4)}`, ['sales']); const fin = await w.member(w.a.tenantId, `fn${randomUUID().slice(0, 4)}`, ['finance_manager']);
    expect((await sales.post('/ai/tools/find_unbilled_deliveries/invoke', { args: {} })).body.code).toBe('AI_TOOL_DENIED');
    expect((await sales.post('/ai/tools/delete_everything/invoke', {})).body.code).toBe('AI_TOOL_DENIED');
    const sup = await makeParty(w.owner, 'S', ['supplier']);
    const p = await fin.post('/ai/tools/propose_payment_batch/invoke', { args: { summary: 'Pay 3 suppliers AED 20k', supplierPartyIds: [sup] } });
    expect(p.status).toBe(200); expect(p.body.result.status).toBe('pending'); expect(p.body.result.note).toMatch(/nothing was paid/);
    expect((await fin.post('/ai/tools/get_job_margin/invoke', { args: { jobId: 'not-a-uuid' } })).status).toBe(422);
    expect((await w.su.query(`SELECT count(*)::int n FROM platform.audit_events WHERE tenant_id=$1 AND actor_kind='ai'`, [w.a.tenantId])).rows[0].n).toBeGreaterThan(0);
    await w.su.query(`UPDATE automation.ai_usage SET budget_micros=1 WHERE tenant_id=$1`, [w.a.tenantId]);
    expect((await fin.post('/ai/tools/find_unbilled_deliveries/invoke', { args: {} })).body.code).toBe('AI_BUDGET_EXCEEDED');
  });
  it('external customers see only their own records and never internal margin', async () => {
    const j = await openJob(w); const other = await openJob(w); const cust = await w.member(w.a.tenantId, `cu${randomUUID().slice(0, 4)}`, ['customer_portal'], { workspace: 'customer', partyId: j.customer });
    const jobs = await cust.get('/jobs'); expect(jobs.body.map((x: any) => x.id)).toEqual([j.jobId]);
    expect((await cust.get(`/jobs/${other.jobId}`)).status).toBe(404);
    expect((await cust.get(`/jobs/${j.jobId}/margin`)).status).toBe(403);
    const q = await cust.get(`/quotes/${j.quoteId}`); expect(q.status).toBe(200); expect(JSON.stringify(q.body)).not.toMatch(/expected_unit_cost|margin|expectedCost/);
    expect((await cust.get(`/quotes/${other.quoteId}`)).status).toBe(404);
  });
});

describe('contract and recovery', () => {
  it('every contract route is implemented, and every implemented route is in the contract', () => {
    const stack: any[] = (w.app.getHttpAdapter().getInstance() as any)._router.stack.filter((l: any) => l.route);
    const impl = new Set(stack.map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path.replace('/api/v1', '')}`));
    const contract = new Set(ROUTES.map((r) => `${r.method} ${r.path}`));
    expect([...contract].filter((x) => !impl.has(x))).toEqual([]); expect([...impl].filter((x) => !contract.has(x))).toEqual([]);
  });
  it('error bodies are structured with a request id', async () => {
    const r = await w.owner.get('/jobs/00000000-0000-0000-0000-000000000000'); expect(r.status).toBe(404); expect(r.body).toMatchObject({ code: 'NOT_FOUND', requestId: expect.stringMatching(/^req_/) }); expect(r.headers['x-request-id']).toBe(r.body.requestId);
    expect((await w.as('nobody', w.a.tenantId).get('/jobs')).status).toBe(403);
  });
  it('a restored backup satisfies every business invariant (journals, custody, allocations)', async () => {
    const bin = '/usr/lib/postgresql/16/bin'; const admin = new pg.Client({ connectionString: 'postgres://postgres@localhost:54329/postgres' }); await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS dbl_restore WITH (FORCE)'); await admin.query('CREATE DATABASE dbl_restore'); await admin.end();
    execSync(`${bin}/pg_dump -h localhost -p 54329 -U postgres -Fc dbl_test | ${bin}/pg_restore -h localhost -p 54329 -U postgres -d dbl_restore --no-owner`, { stdio: 'pipe', shell: '/bin/bash' });
    const live = await invariants(SU_URL); const restored = await invariants('postgres://postgres@localhost:54329/dbl_restore');
    expect(restored.length).toBeGreaterThan(10); expect(restored.filter((i) => i.violations)).toEqual([]); expect(restored).toEqual(live);
    const counts = async (u: string) => { const c = new pg.Client({ connectionString: u }); await c.connect(); const r = (await c.query(`SELECT (SELECT count(*) FROM finance.journals) j, (SELECT count(*) FROM warehouse.custody_movements) m, (SELECT count(*) FROM platform.audit_events) a`)).rows[0]; await c.end(); return r; };
    expect(await counts('postgres://postgres@localhost:54329/dbl_restore')).toEqual(await counts(SU_URL));
  });
});
void APP_URL;
