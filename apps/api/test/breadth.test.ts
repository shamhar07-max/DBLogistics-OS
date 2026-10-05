import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { approvedDocument, close, makeParty, SU_URL, world, type World } from './helpers';
import { invariants, lot, openJob } from './helpers2';

let w: World;
beforeAll(async () => { w = await world(); });
afterAll(async () => close(w));
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

describe('people, qualifications and trip dispatch', () => {
  it('an expired/missing driving qualification blocks dispatch; a valid one allows it; expiring list works', async () => {
    const hr = await w.member(w.a.tenantId, `hr${randomUUID().slice(0, 4)}`, ['hr']); const disp = await w.member(w.a.tenantId, `dp${randomUUID().slice(0, 4)}`, ['dispatcher']);
    const haulier = await makeParty(w.owner, 'Haulier X', ['transporter']);
    const emp = await hr.post('/employees', { legalEntityId: w.a.legalEntityId, fullName: 'Karim Driver', jobTitle: 'Driver' }); expect(emp.status).toBe(201);
    const trip = await disp.post('/trips', { transporterPartyId: haulier, driverEmployeeId: emp.body.id, stops: [{ kind: 'pickup', address: 'Jebel Ali' }, { kind: 'delivery', address: 'Dubai Investments Park' }] }); expect(trip.status).toBe(201);
    expect((await disp.cmd(`/trips/${trip.body.id}/dispatch`)).body.code).toBe('QUALIFICATION_REQUIRED');                         // none on file
    await hr.post(`/employees/${emp.body.id}/qualifications`, { kind: 'driving', issuedOn: plusDays(-400), validTo: plusDays(-5) });
    expect((await disp.cmd(`/trips/${trip.body.id}/dispatch`)).body.code).toBe('QUALIFICATION_REQUIRED');                         // expired
    await hr.post(`/employees/${emp.body.id}/qualifications`, { kind: 'driving', issuedOn: plusDays(-1), validTo: plusDays(20) });
    const ok = await disp.cmd(`/trips/${trip.body.id}/dispatch`); expect(ok.status).toBe(200); expect(ok.body.status).toBe('dispatched');
    expect((await disp.cmd(`/trips/${trip.body.id}/dispatch`)).body.code).toBe('INVALID_STATE_TRANSITION');
    const exp = await hr.get('/qualifications?withinDays=30'); expect(exp.body.map((q: any) => q.kind)).toContain('driving'); expect(exp.body.some((q: any) => q.expired)).toBe(true);
    const list = await disp.get('/trips'); expect(list.body.find((t: any) => t.id === trip.body.id).stops).toHaveLength(2);
    expect((await disp.post('/employees', { legalEntityId: w.a.legalEntityId, fullName: 'x y' })).status).toBe(403);                  // dispatcher cannot manage people
    const ast = await hr.post('/assets', { kind: 'forklift', code: `FL-${randomUUID().slice(0, 4)}`, nextServiceDue: plusDays(3) }); expect(ast.status).toBe(201);
    expect((await hr.get('/assets')).body.find((a: any) => a.id === ast.body.id).service_due_soon).toBe(true);
  });
});

describe('quality: incident → hold → separately authorised release', () => {
  it('resolving an incident never auto-releases stock; release needs another person with the quality permission', async () => {
    const sup = await w.member(w.a.tenantId, `sup${randomUUID().slice(0, 4)}`, ['warehouse_supervisor']); const qa = await w.member(w.a.tenantId, `qa${randomUUID().slice(0, 4)}`, ['quality_manager']); const ops = await w.member(w.a.tenantId, `ops${randomUUID().slice(0, 4)}`, ['freight_ops']);
    const { lotId } = await lot(w, sup, '10');
    const inc = await sup.post('/incidents', { kind: 'temperature_excursion', severity: 'high', description: 'Reefer zone reached 11°C for 40 minutes', lotId, placeHold: true }); expect(inc.status).toBe(201); expect(inc.body.hold_id).toBeTruthy();
    expect((await w.su.query(`SELECT condition FROM warehouse.stock_lots WHERE id=$1`, [lotId])).rows[0].condition).toBe('quarantined');
    expect((await sup.post(`/incidents/${inc.body.id}/investigate`)).body.status).toBe('investigating');
    const res = await sup.post(`/incidents/${inc.body.id}/resolve`, { resolutionNote: 'Logger shows recovery; product stability data requested' }); expect(res.body).toMatchObject({ status: 'resolved', holdStillActive: true });
    expect((await w.su.query(`SELECT condition FROM warehouse.stock_lots WHERE id=$1`, [lotId])).rows[0].condition).toBe('quarantined');        // sensor back in range ≠ release
    expect((await sup.cmd(`/warehouse/holds/${inc.body.hold_id}/release`, { note: 'ok to release' })).status).toBe(403);                         // warehouse supervisor lacks quality.hold.release
    expect((await ops.cmd(`/warehouse/holds/${inc.body.hold_id}/release`, { note: 'ok to release' })).status).toBe(403);
    // the placer holding release permission still cannot release their own hold
    const both = await w.member(w.a.tenantId, `both${randomUUID().slice(0, 4)}`, ['quality_manager', 'warehouse_supervisor']);
    const own = await both.post('/incidents', { kind: 'damage', description: 'Crushed cartons on pallet 3', lotId, placeHold: true }); expect(own.status).toBe(201);
    expect((await both.cmd(`/warehouse/holds/${own.body.hold_id}/release`, { note: 'releasing my own hold' })).body.code).toBe('SEPARATION_OF_DUTIES');
    const rel1 = await qa.cmd(`/warehouse/holds/${inc.body.hold_id}/release`, { note: 'Stability data reviewed — product acceptable' }); expect(rel1.status).toBe(200); expect(rel1.body.lotAvailable).toBe(false);   // second hold still active
    const rel2 = await qa.cmd(`/warehouse/holds/${own.body.hold_id}/release`, { note: 'Damaged cartons re-packed and inspected' }); expect(rel2.body.lotAvailable).toBe(true);
    expect((await w.su.query(`SELECT condition FROM warehouse.stock_lots WHERE id=$1`, [lotId])).rows[0].condition).toBe('good');
    const cl = await qa.post('/claims', { incidentId: inc.body.id, amount: '12500.00', currency: 'AED' }); expect(cl.status).toBe(201); expect((await qa.get('/claims')).body).toHaveLength(1);
    expect((await qa.get('/warehouse/holds')).body.filter((h: any) => h.active)).toHaveLength(0);
    expect((await invariants(SU_URL)).filter((i) => i.violations)).toEqual([]);
  });
});

describe('tasks, conversations, documents, audit', () => {
  it('tasks complete once; the conversation log is append-only', async () => {
    const j = await openJob(w); const ops = await w.member(w.a.tenantId, `o${randomUUID().slice(0, 4)}`, ['freight_ops']);
    const t = await ops.post('/tasks', { title: 'Chase carrier for VGM cut-off', relatedType: 'job', relatedId: j.jobId }); expect(t.status).toBe(201);
    expect((await ops.get(`/tasks?relatedType=job&relatedId=${j.jobId}`)).body.length).toBeGreaterThanOrEqual(1);
    expect((await ops.post(`/tasks/${t.body.id}/complete`)).body.status).toBe('done'); expect((await ops.post(`/tasks/${t.body.id}/complete`)).body.code).toBe('INVALID_STATE_TRANSITION');
    const m = await ops.post('/messages', { relatedType: 'job', relatedId: j.jobId, channel: 'call', direction: 'outbound', body: 'Called Ocean Line — cut-off moved to Friday 14:00' }); expect(m.status).toBe(201);
    expect((await ops.get(`/messages?relatedType=job&relatedId=${j.jobId}`)).body[0].body).toMatch(/cut-off moved/);
    await expect(w.su.query(`UPDATE collab.messages SET body='edited'`)).rejects.toThrow(/append-only/);
    expect((await ops.get('/messages?relatedId=not-a-uuid')).status).toBe(422);                                                   // query strings are validated by the contract
  });
  it('document library, signed download only for clean files, and audit trail visibility', async () => {
    const j = await openJob(w); const cs = await w.member(w.a.tenantId, `cu${randomUUID().slice(0, 4)}`, ['customs_specialist']); const fin = await w.member(w.a.tenantId, `fm${randomUUID().slice(0, 4)}`, ['finance_manager']); const ops = await w.member(w.a.tenantId, `o${randomUUID().slice(0, 4)}`, ['freight_ops']);
    const intent = await cs.post('/files/upload-intents', { contentType: 'application/pdf', sizeBytes: 500 });
    const key = (await w.su.query(`SELECT storage_key FROM platform.upload_intents WHERE id=$1`, [intent.body.intentId])).rows[0].storage_key; (await import('./helpers')).storage.objects.set(key, 500);
    const reg = await cs.post('/documents', { intentId: intent.body.intentId, docType: 'Invoice', issuerKind: 'supplier', relatedType: 'job', relatedId: j.jobId, sha256: 'b'.repeat(64) });
    expect((await cs.get(`/documents/${reg.body.id}/download-url`)).body.code).toBe('DOCUMENT_NOT_CLEAN');
    await w.su.query(`UPDATE platform.document_versions SET scan_status='clean' WHERE document_id=$1`, [reg.body.id]);
    const dl = await cs.get(`/documents/${reg.body.id}/download-url`); expect(dl.status).toBe(200); expect(dl.body.url).toMatch(/^memory:\/\/download\//); expect(dl.body.expiresInSeconds).toBe(300);
    const lib = await cs.get(`/documents?relatedType=job&relatedId=${j.jobId}`); expect(lib.body).toHaveLength(1); expect(lib.body[0].scan_status).toBe('clean');
    await approvedDocument(w, cs, { docType: 'POD', issuerKind: 'customer', relatedType: 'job', relatedId: j.jobId });
    const audit = await fin.get(`/audit-events?entityType=document&limit=50`); expect(audit.body.map((e: any) => e.action)).toEqual(expect.arrayContaining(['document.registered', 'document.downloaded', 'document.approved']));
    expect((await ops.get('/audit-events')).status).toBe(403);                                                                     // freight ops cannot read the audit log
  });
});

describe('administration, reports, party 360, integrations, AI tool list', () => {
  it('owner adds members with role templates; external members need a party; roles list is accurate', async () => {
    const customer = await makeParty(w.owner, 'Portal Customer', ['customer']); const sub = `newbie-${randomUUID().slice(0, 5)}`;
    expect((await w.owner.post('/admin/members', { subject: sub, role: 'nonexistent' })).status).toBe(422);
    expect((await w.owner.post('/admin/members', { subject: `${sub}x`, role: 'customer_portal', workspace: 'customer' })).status).toBe(422);
    const ok = await w.owner.post('/admin/members', { subject: sub, role: 'sales', email: 'new@acme.test' }); expect(ok.status).toBe(201);
    const asNew = w.as(sub); expect((await asNew.get('/enquiries')).status).toBe(200); expect((await asNew.get('/admin/members')).status).toBe(403);
    expect((await w.owner.post('/admin/members', { subject: `${sub}p`, role: 'customer_portal', workspace: 'customer', partyId: customer })).status).toBe(201);
    const members = await w.owner.get('/admin/members'); expect(members.body.find((m: any) => m.subject === sub).roles[0].role).toBe('sales');
    const roles = await w.owner.get('/admin/roles'); const sales = roles.body.find((r: any) => r.key === 'sales'); expect(sales.permissions).toContain('quotes.create'); expect(sales.permissions).not.toContain('quotes.approve');
  });
  it('receivables ageing buckets and per-job profitability reflect posted data', async () => {
    const j = await openJob(w, { price: '1000.00' }); const acct = await w.member(w.a.tenantId, `ac${randomUUID().slice(0, 4)}`, ['accountant']); const fin = await w.member(w.a.tenantId, `fm${randomUUID().slice(0, 4)}`, ['finance_manager']);
    const d = await acct.post('/invoices', { jobId: j.jobId, dueDate: plusDays(-45) }); await fin.cmd(`/invoices/${d.body.id}/approve`); await fin.cmd(`/invoices/${d.body.id}/post`, { postingDate: today() });
    const ag = await fin.get('/reports/receivables-ageing'); const aed = ag.body.currencies.find((c: any) => c.currency === 'AED'); const b = Object.fromEntries(aed.buckets.map((x: any) => [x.bucket, x]));
    expect(Number(b['31-60'].outstanding)).toBeGreaterThanOrEqual(1050); expect(b['31-60'].invoices).toBeGreaterThanOrEqual(1);
    const pr = await fin.get('/reports/job-profitability'); const row = pr.body.find((r: any) => r.id === j.jobId); expect(Number(row.revenue)).toBe(1000); expect(Number(row.cost)).toBe(700); expect(Number(row.posted_revenue)).toBe(1000);
    expect((await w.as('nobody-x').get('/reports/receivables-ageing')).status).toBe(403);
  });
  it('party 360, bank-change inbox, shipment detail, integrations (no secrets), AI tool permissions', async () => {
    const j = await openJob(w); const maker = await w.member(w.a.tenantId, `m${randomUUID().slice(0, 4)}`, ['finance_manager']); const ops = await w.member(w.a.tenantId, `o${randomUUID().slice(0, 4)}`, ['freight_ops']);
    const p = await w.owner.get(`/parties/${j.customer}`); expect(p.body.roles).toContain('customer'); expect(p.body.work.open_quotes).toBe(0); expect(p.body.work.jobs).toBe(1);
    await maker.post(`/parties/${j.customer}/bank-detail-changes`, { accountName: 'A', iban: 'AE070331234567890123456', currency: 'AED' });
    expect((await maker.get('/bank-detail-changes')).body[0]).toMatchObject({ status: 'proposed', party: expect.any(String) });
    const s = await ops.post('/shipments', { jobId: j.jobId, mode: 'ocean_fcl', origin: 'A', destination: 'B', cargo: [{ description: 'Pallets', quantity: '5', ownerPartyId: j.customer }], legs: [{ mode: 'ocean_fcl', origin: 'A', destination: 'B' }] });
    const det = await ops.get(`/shipments/${s.body.id}`); expect(det.body.legs).toHaveLength(1); expect(det.body.cargo[0].owner).toBeTruthy(); expect((await ops.get(`/shipments?jobId=${j.jobId}`)).body).toHaveLength(1);
    await w.su.query(`INSERT INTO integ.connections(tenant_id, provider, capability, credential_ref, webhook_secret_ref) VALUES ($1,'bankfeed','statements','sm://secret-ref','WH_X') ON CONFLICT DO NOTHING`, [w.a.tenantId]);
    const ints = await maker.get('/integrations'); expect(ints.status).toBe(200); expect(JSON.stringify(ints.body)).not.toMatch(/credential_ref|sm:\/\/|webhook_secret/);
    const tools = await ops.get('/ai/tools'); const t = Object.fromEntries(tools.body.map((x: any) => [x.name, x.allowed])); expect(t.list_missing_documents).toBe(true); expect(t.propose_payment_batch).toBe(false);
    const wf = await w.owner.post('/workflows', { key: 'late-booking', triggerTopic: 'BookingConfirmed', definition: { actions: [{ type: 'create_task', title: 'Check cut-offs' }] } }); expect(wf.status).toBe(201);
    await w.owner.post(`/workflows/${wf.body.id}/activate`); expect((await w.owner.get('/workflows')).body[0]).toMatchObject({ key: 'late-booking', status: 'active' }); expect(Array.isArray((await w.owner.get('/workflow-runs')).body)).toBe(true);
  });
  it('new tenant-scoped tables are isolated per tenant', async () => {
    const hrA = await w.member(w.a.tenantId, `hrA${randomUUID().slice(0, 4)}`, ['hr']); await hrA.post('/employees', { legalEntityId: w.a.legalEntityId, fullName: 'Isolated Person' });
    const sub = (await w.su.query(`SELECT u.subject FROM platform.users u JOIN platform.memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 LIMIT 1`, [w.b.tenantId])).rows[0].subject;
    expect((await w.as(sub, w.b.tenantId).get('/employees')).body).toEqual([]); expect((await w.as(sub, w.b.tenantId).get('/incidents')).body).toEqual([]);
  });
  it('facilities list for receiving: warehouse roles can pick a facility and owner, tenants are isolated', async () => {
    const wh = await w.member(w.a.tenantId, `wh${randomUUID().slice(0, 4)}`, ['warehouse_operator']);
    const f = await wh.get('/facilities'); expect(f.status).toBe(200); expect(f.body.map((x: any) => x.id)).toContain(w.a.facilityId); expect(Array.isArray(f.body[0].locations)).toBe(true);
    expect((await wh.get('/parties')).status).toBe(200);
    const sub = (await w.su.query(`SELECT u.subject FROM platform.users u JOIN platform.memberships m ON m.user_id=u.id WHERE m.tenant_id=$1 LIMIT 1`, [w.b.tenantId])).rows[0].subject;
    expect((await w.as(sub, w.b.tenantId).get('/facilities')).body.map((x: any) => x.id)).not.toContain(w.a.facilityId);
    expect((await w.as('stranger-x').get('/facilities')).status).toBe(403);
  });
});
