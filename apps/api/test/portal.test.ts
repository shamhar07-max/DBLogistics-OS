import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { approvedDocument, cleanDoc, close, makeParty, storage, world, type Client, type World } from './helpers';
import { openJob } from './helpers2';

let w: World;
beforeAll(async () => { w = await world(); });
afterAll(async () => close(w));
const u = () => randomUUID().slice(0, 4);
const ext = (workspace: string, role: string, partyId: string) => w.member(w.a.tenantId, `${workspace}${u()}`, [role], { workspace, partyId } as any);
/** Plans a shipment for a job, with an optional agent leg, as freight ops. */
async function shipment(jobId: string, owner: string, agent?: string) {
  const ops = await w.member(w.a.tenantId, `ops${u()}`, ['freight_ops']);
  const s = await ops.post('/shipments', { jobId, mode: 'air', origin: 'Frankfurt', destination: 'Dubai', cargo: [{ description: 'Parts', quantity: '3', ownerPartyId: owner }], legs: [{ mode: 'air', origin: 'Frankfurt', destination: 'Dubai', ...(agent ? { operatorPartyId: agent } : {}) }] });
  expect(s.status).toBe(201); return { id: s.body.id as string, ops };
}
async function upload(c: Client, over: Record<string, unknown>) {
  const intent = await c.post('/files/upload-intents', { contentType: 'application/pdf', sizeBytes: 900 });
  if (intent.status !== 201 && intent.status !== 200) return intent;
  const key = (await w.su.query(`SELECT storage_key FROM platform.upload_intents WHERE id=$1`, [intent.body.intentId])).rows[0].storage_key; storage.objects.set(key, 900);
  return c.post('/documents', { intentId: intent.body.intentId, docType: 'Packing list', issuerKind: 'authority', sha256: 'b'.repeat(64), ...over });
}

describe('customer portal scoping', () => {
  it('a customer sees only their own shipments, approved documents and posted invoices — never drafts or other customers’ records', async () => {
    const mine = await openJob(w); const theirs = await openJob(w);
    const cust = await ext('customer', 'customer_portal', mine.customer); const sMine = await shipment(mine.jobId, mine.customer); const sOther = await shipment(theirs.jobId, theirs.customer);
    expect((await cust.get('/shipments')).body.map((x: any) => x.id)).toEqual([sMine.id]);
    expect((await cust.get(`/shipments/${sOther.id}`)).status).toBe(404); expect((await cust.get(`/shipments/${sOther.id}/timeline`)).status).toBe(404);
    expect((await cust.get(`/shipments/${sMine.id}`)).body.legal_entity_id).toBeUndefined(); expect((await cust.get(`/shipments/${sMine.id}`)).body.bookings).toEqual([]);

    const owner = w.owner; const docMine = await approvedDocument(w, owner, { docType: 'Bill of lading', issuerKind: 'carrier', relatedType: 'shipment', relatedId: sMine.id });
    const docOther = await approvedDocument(w, owner, { docType: 'Bill of lading', issuerKind: 'carrier', relatedType: 'shipment', relatedId: sOther.id });
    const internal = await approvedDocument(w, owner, { docType: 'Margin sheet', issuerKind: 'internal', relatedType: 'shipment', relatedId: sMine.id });
    const ids = (await cust.get('/documents')).body.map((d: any) => d.id);
    expect(ids).toContain(docMine); expect(ids).not.toContain(docOther); expect(ids).not.toContain(internal);
    expect((await cust.get(`/documents/${docMine}/download-url`)).status).toBe(200);
    expect((await cust.get(`/documents/${docOther}/download-url`)).status).toBe(404); expect((await cust.get(`/documents/${internal}/download-url`)).status).toBe(404);

    const acct = await w.member(w.a.tenantId, `ac${u()}`, ['accountant']); const fin = await w.member(w.a.tenantId, `fm${u()}`, ['finance_manager']);
    const inv = await acct.post('/invoices', { jobId: mine.jobId }); expect(inv.status).toBe(201);
    expect((await cust.get('/invoices')).body).toEqual([]); expect((await cust.get(`/invoices/${inv.body.id}`)).status).toBe(404);            // draft is internal
    await fin.cmd(`/invoices/${inv.body.id}/approve`); await fin.cmd(`/invoices/${inv.body.id}/post`, { postingDate: new Date().toISOString().slice(0, 10) });
    const list = await cust.get('/invoices'); expect(list.body.map((i: any) => i.id)).toEqual([inv.body.id]);
    const det = await cust.get(`/invoices/${inv.body.id}`); expect(det.body.lines.length).toBeGreaterThan(0); expect(det.body.balance).toBe(det.body.total.includes('.') ? Number(det.body.total).toFixed(2) : det.body.total);
    const other = await ext('customer', 'customer_portal', theirs.customer); expect((await other.get(`/invoices/${inv.body.id}`)).status).toBe(404);
  });
  it('portal uploads are attached only to the customer’s own records and can never claim to be an authority or internal issuer', async () => {
    const mine = await openJob(w); const theirs = await openJob(w); const cust = await ext('customer', 'customer_portal', mine.customer); const sMine = await shipment(mine.jobId, mine.customer); const sOther = await shipment(theirs.jobId, theirs.customer);
    expect((await upload(cust, { relatedType: 'shipment', relatedId: sOther.id })).status).toBe(404);
    const ok = await upload(cust, { relatedType: 'shipment', relatedId: sMine.id, issuerKind: 'authority' }); expect(ok.status).toBe(201);
    expect((await w.su.query(`SELECT issuer_kind FROM platform.documents WHERE id=$1`, [ok.body.id])).rows[0].issuer_kind).toBe('customer');        // forced
    await cleanDoc(w, ok.body.id); expect((await cust.get('/documents')).body.map((d: any) => d.id)).toContain(ok.body.id);                              // uploader sees own, even before approval
    expect((await upload(cust, { relatedType: 'trip', relatedId: randomUUID() })).status).toBe(404);
    const colleague = await ext('customer', 'customer_portal', mine.customer); expect((await colleague.get('/documents')).body.map((d: any) => d.id)).not.toContain(ok.body.id);   // not approved yet
  });
});

describe('customer portal: quotes and enquiries', () => {
  it('customers never see draft quotes or internal columns; they can raise an enquiry for themselves; acceptance evidence is server-set', async () => {
    const sales = await w.member(w.a.tenantId, `s${u()}`, ['sales']); const pricing = await w.member(w.a.tenantId, `p${u()}`, ['pricing']);
    const customer = await makeParty(w.owner, `Cust ${u()}`, ['customer']); const cust = await ext('customer', 'customer_portal', customer);
    const q = await sales.post('/quotes', { legalEntityId: w.a.legalEntityId, customerPartyId: customer, currency: 'AED', validUntil: '2099-01-01', mode: 'road', origin: 'Dubai', destination: 'Muscat', lines: [{ description: 'Road freight', chargeType: 'fixed', quantity: '1', unitPrice: '900.00', expectedUnitCost: '600.00', taxCode: 'SR5' }] });
    expect((await cust.get('/quotes')).body).toEqual([]); expect((await cust.get(`/quotes/${q.body.id}`)).status).toBe(404);                      // draft is internal
    await pricing.cmd(`/quotes/${q.body.id}/approve`);
    expect((await cust.get('/quotes')).body.map((x: any) => x.id)).toEqual([q.body.id]);
    const det = (await cust.get(`/quotes/${q.body.id}`)).body; expect(Object.keys(det)).not.toEqual(expect.arrayContaining(['approved_by']));
    for (const k of ['approved_by', 'created_by', 'accepted_by', 'acceptance_evidence', 'legal_entity_id']) expect(det).not.toHaveProperty(k);
    expect(JSON.stringify(det)).not.toMatch(/expected_unit_cost/);
    const enq = await cust.post('/enquiries', { mode: 'air', origin: 'Frankfurt', destination: 'Dubai', cargo: { commodity: 'Spare parts' } }); expect(enq.status).toBe(201);
    const row = (await w.su.query(`SELECT customer_party_id, source FROM commercial.enquiries WHERE id=$1`, [enq.body.id])).rows[0]; expect(row).toEqual({ customer_party_id: customer, source: 'portal' });
    expect((await cust.get('/enquiries')).body.map((x: any) => x.id)).toEqual([enq.body.id]);
    expect((await sales.post('/enquiries', { mode: 'air', origin: 'A1', destination: 'B1' })).status).toBe(422);                               // staff must name the customer and entity
    const acc = await cust.cmd(`/quotes/${q.body.id}/accept`, { acceptedByName: 'Ops lead', evidence: { channel: 'signed_pdf', reference: 'forged' } }); expect(acc.status).toBe(200);
    expect((await w.su.query(`SELECT acceptance_evidence FROM commercial.quotes WHERE id=$1`, [q.body.id])).rows[0].acceptance_evidence.evidence).toEqual({ channel: 'portal', reference: expect.stringMatching(/^user:/) });
    const me = await cust.get('/me'); expect(me.body).toMatchObject({ workspace: 'customer', partyId: customer, partyName: expect.stringContaining('Cust ') });
  });
});

describe('agent portal scoping', () => {
  it('an agent sees and reports only on shipments where they operate a leg; reports are marked as supplier-sourced', async () => {
    const j = await openJob(w); const agentParty = await makeParty(w.owner, `Agent ${u()}`, ['agent']); const otherAgent = await makeParty(w.owner, `Agent ${u()}`, ['agent']);
    const mine = await shipment(j.jobId, j.customer, agentParty); const notMine = await shipment(j.jobId, j.customer, otherAgent); const agent = await ext('agent', 'agent_portal', agentParty);
    expect((await agent.get('/shipments')).body.map((s: any) => s.id)).toEqual([mine.id]);
    const det = await agent.get(`/shipments/${mine.id}`); expect(det.status).toBe(200); expect(det.body.customer_party_id).toBeUndefined(); expect(det.body.job_ref).toBeUndefined();
    expect((await agent.get(`/shipments/${notMine.id}`)).status).toBe(404);
    const ev = await agent.post(`/shipments/${mine.id}/events`, { code: 'ARRIVED_ORIGIN', eventTime: new Date().toISOString(), source: 'carrier', isActual: true, detail: {} }); expect(ev.status).toBe(201);
    expect((await w.su.query(`SELECT source FROM logistics.tracking_events WHERE shipment_id=$1 AND code='ARRIVED_ORIGIN'`, [mine.id])).rows[0].source).toBe('supplier');
    expect((await agent.post(`/shipments/${notMine.id}/events`, { code: 'X1', eventTime: new Date().toISOString(), source: 'supplier', isActual: true, detail: {} })).status).toBe(404);
    expect((await agent.get('/invoices')).status).toBe(403); expect((await agent.get('/jobs')).status).toBe(403);
  });
});

describe('transporter portal scoping', () => {
  it('a transporter sees only its own dispatched trips and can capture proof of delivery only on them; the trip completes with its last stop', async () => {
    const j = await openJob(w); const t1 = await makeParty(w.owner, `Haulier ${u()}`, ['transporter']); const t2 = await makeParty(w.owner, `Haulier ${u()}`, ['transporter']);
    const sh = await shipment(j.jobId, j.customer); const disp = await w.member(w.a.tenantId, `dp${u()}`, ['dispatcher']);
    const mk = async (tp: string) => (await disp.post('/trips', { transporterPartyId: tp, stops: [{ kind: 'pickup', address: 'Port gate 4' }, { kind: 'delivery', address: 'DIP warehouse', shipmentId: sh.id }] })).body.id as string;
    const mine = await mk(t1); const theirs = await mk(t2); const tr = await ext('transporter', 'transporter_portal', t1);
    expect((await tr.get('/trips')).body).toEqual([]);                                   // planned trips are internal
    await disp.cmd(`/trips/${mine}/dispatch`); await disp.cmd(`/trips/${theirs}/dispatch`);
    const list = (await tr.get('/trips')).body; expect(list.map((t: any) => t.id)).toEqual([mine]);
    const stops = list[0].stops as Array<{ id: string; kind: string }>;
    const capture = (stopId: string, key = randomUUID()) => tr.post('/device/commands', { deviceId: 'dev-1', commands: [{ commandId: key, type: 'capture_pod', deviceTime: new Date().toISOString(), payload: { tripStopId: stopId, signedBy: 'Receiver A' } }] });
    const theirStop = (await w.su.query(`SELECT id FROM transport.trip_stops WHERE trip_id=$1 LIMIT 1`, [theirs])).rows[0].id;
    expect((await capture(theirStop)).body.results[0]).toMatchObject({ status: 'rejected', error: 'NOT_FOUND' });         // someone else's stop
    expect((await capture(stops[0].id)).body.results[0].status).toBe('accepted');
    expect((await w.su.query(`SELECT status FROM transport.trips WHERE id=$1`, [mine])).rows[0].status).toBe('in_progress');
    expect((await capture(stops[1].id)).body.results[0].status).toBe('accepted');
    expect((await w.su.query(`SELECT status FROM transport.trips WHERE id=$1`, [mine])).rows[0].status).toBe('completed');
    expect((await capture(stops[1].id)).body.results[0].status).toMatch(/conflict|rejected/);                        // trip no longer open
    const planned = await mk(t1); const ps = (await w.su.query(`SELECT id FROM transport.trip_stops WHERE trip_id=$1 LIMIT 1`, [planned])).rows[0].id;
    expect((await capture(ps)).body.results[0].status).toMatch(/conflict|rejected/);                                  // planned, not dispatched
    // the transporter sees the shipment on its trip (read-only) and can attach POD documents to it, but nothing else
    expect((await tr.get(`/shipments/${sh.id}`)).status).toBe(200); expect((await tr.get('/shipments')).body.map((s: any) => s.id)).toContain(sh.id);
    const pod = await upload(tr, { relatedType: 'shipment', relatedId: sh.id, docType: 'POD', issuerKind: 'authority' }); expect(pod.status).toBe(201);
    expect((await w.su.query(`SELECT issuer_kind FROM platform.documents WHERE id=$1`, [pod.body.id])).rows[0].issuer_kind).toBe('carrier');
    const other = await shipment((await openJob(w)).jobId, j.customer); expect((await upload(tr, { relatedType: 'shipment', relatedId: other.id })).status).toBe(404);
    expect((await tr.get('/jobs')).status).toBe(403);
  });
});

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const havePdftotext = spawnSync('pdftotext', ['-v']).status !== null;
const pdfText = (b: Buffer) => { const f = join(mkdtempSync(join(tmpdir(), 'api-pdf-')), 'x.pdf'); writeFileSync(f, b); return execFileSync('pdftotext', ['-layout', f, '-']).toString(); };

describe('branded PDF documents', () => {
  it('invoice PDF: customers get only their own posted invoices; staff can print drafts (watermarked); content carries issuer profile, TRNs, lines and totals', async () => {
    const mine = await openJob(w); const theirs = await openJob(w); const cust = await ext('customer', 'customer_portal', mine.customer); const other = await ext('customer', 'customer_portal', theirs.customer);
    await w.owner.post(`/legal-entities/${w.a.legalEntityId}`, { address: 'Warehouse 14, Jebel Ali Free Zone', email: 'accounts@demo.ae', taxRegistrationNumber: '100234567800003', bankIban: 'AE070331234567890123456', bankName: 'Emirates NBD' });
    await w.owner.post(`/parties/${mine.customer}`, { address: 'Dubai Silicon Oasis', taxRegistrationNumber: '100998877600003' });
    const acct = await w.member(w.a.tenantId, `ac${u()}`, ['accountant']); const fin = await w.member(w.a.tenantId, `fm${u()}`, ['finance_manager']);
    const inv = await acct.post('/invoices', { jobId: mine.jobId }); expect(inv.status).toBe(201);
    expect((await cust.getBinary(`/invoices/${inv.body.id}/pdf`)).status).toBe(404);                                                    // draft is internal
    const draft = await acct.getBinary(`/invoices/${inv.body.id}/pdf`); expect(draft.status).toBe(200); expect(draft.headers['content-type']).toBe('application/pdf'); expect(draft.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    await fin.cmd(`/invoices/${inv.body.id}/approve`); await fin.cmd(`/invoices/${inv.body.id}/post`, { postingDate: new Date().toISOString().slice(0, 10) });
    const pdf = await cust.getBinary(`/invoices/${inv.body.id}/pdf`); expect(pdf.status).toBe(200); expect(pdf.headers['content-disposition']).toMatch(/inline; filename="INV-/); expect(pdf.headers['cache-control']).toContain('no-store');
    expect((await other.getBinary(`/invoices/${inv.body.id}/pdf`)).status).toBe(404);
    if (havePdftotext) { const t = pdfText(pdf.buffer); for (const s of ['TAX INVOICE', 'TRN 100234567800003', 'TRN 100998877600003', 'Warehouse 14, Jebel Ali Free Zone', 'Dubai Silicon Oasis', 'AE070331234567890123456', 'Page 1 of 1', 'Road freight']) expect(t, s).toContain(s); expect(t).not.toContain('DRAFT'); expect(pdfText(draft.buffer)).toContain('NOT A TAX INVOICE'); }
  });
  it('quotation PDF never contains internal cost or margin and is hidden while a quote is a draft; shipment report hides the customer from agents', async () => {
    const sales = await w.member(w.a.tenantId, `s${u()}`, ['sales']); const pricing = await w.member(w.a.tenantId, `p${u()}`, ['pricing']);
    const customer = await makeParty(w.owner, `Cust ${u()}`, ['customer']); const cust = await ext('customer', 'customer_portal', customer);
    const q = await sales.post('/quotes', { legalEntityId: w.a.legalEntityId, customerPartyId: customer, currency: 'AED', validUntil: '2099-01-01', mode: 'road', origin: 'Dubai', destination: 'Muscat', lines: [{ description: 'Road freight', chargeType: 'fixed', quantity: '1', unitPrice: '900.00', expectedUnitCost: '612.34', taxCode: 'SR5' }] });
    expect((await cust.getBinary(`/quotes/${q.body.id}/pdf`)).status).toBe(404);
    const staffDraft = await sales.getBinary(`/quotes/${q.body.id}/pdf`); expect(staffDraft.status).toBe(200);
    await pricing.cmd(`/quotes/${q.body.id}/approve`); const pdf = await cust.getBinary(`/quotes/${q.body.id}/pdf`); expect(pdf.status).toBe(200);
    expect(pdf.buffer.toString('latin1')).not.toContain('612.34');
    if (havePdftotext) { const t = pdfText(pdf.buffer); expect(t).toContain('QUOTATION'); expect(t).toContain('Muscat'); expect(t).toContain('945.00'); expect(t).not.toContain('612.34'); expect(t).not.toContain('Margin'); }
    const j = await openJob(w); const agentParty = await makeParty(w.owner, `Agent ${u()}`, ['agent']); const sh = await shipment(j.jobId, j.customer, agentParty); const agent = await ext('agent', 'agent_portal', agentParty);
    const rep = await agent.getBinary(`/shipments/${sh.id}/report`); expect(rep.status).toBe(200);
    if (havePdftotext) { const t = pdfText(rep.buffer); expect(t).toContain('SHIPMENT STATUS REPORT'); expect(t).not.toContain('Customer'); }
    const stranger = await ext('agent', 'agent_portal', await makeParty(w.owner, `Agent ${u()}`, ['agent'])); expect((await stranger.getBinary(`/shipments/${sh.id}/report`)).status).toBe(404);
    const custRep = await (await ext('customer', 'customer_portal', j.customer)).getBinary(`/shipments/${sh.id}/report`); expect(custRep.status).toBe(200);
  });
});

describe('customer messaging', () => {
  it('customers converse on their own records; staff choose what is shared; internal notes never leak; other customers and non-customers are refused; rate limit applies', async () => {
    const mine = await openJob(w); const theirs = await openJob(w); const cust = await ext('customer', 'customer_portal', mine.customer); const other = await ext('customer', 'customer_portal', theirs.customer);
    const sMine = await shipment(mine.jobId, mine.customer); const ops = sMine.ops;
    expect((await cust.post('/messages', { relatedType: 'shipment', relatedId: sMine.id, body: 'Can you deliver after 14:00?', channel: 'internal', direction: 'internal' })).status).toBe(201);
    const row = (await w.su.query(`SELECT channel, direction, visibility FROM collab.messages WHERE related_id=$1`, [sMine.id])).rows[0]; expect(row).toEqual({ channel: 'portal', direction: 'inbound', visibility: 'shared' });                      // forced by the server
    expect((await ops.post('/messages', { relatedType: 'shipment', relatedId: sMine.id, body: 'INTERNAL: customer is a slow payer', channel: 'internal', direction: 'internal' })).status).toBe(201);
    const reply = await ops.post('/messages', { relatedType: 'shipment', relatedId: sMine.id, body: 'Yes — we will book the 14:30 slot.', shared: true }); expect(reply.status).toBe(201);
    const seen = (await cust.get(`/messages?relatedType=shipment&relatedId=${sMine.id}`)).body; expect(seen.map((m: any) => m.body)).toEqual(['Yes — we will book the 14:30 slot.', 'Can you deliver after 14:00?']); expect(seen.map((m: any) => m.author)).toEqual(['DigitalBurj team', 'You']);
    expect(JSON.stringify(seen)).not.toMatch(/slow payer|subject|visibility/);
    const staff = (await ops.get(`/messages?relatedType=shipment&relatedId=${sMine.id}`)).body; expect(staff).toHaveLength(3); expect(staff.filter((m: any) => m.visibility === 'internal')).toHaveLength(1);
    expect((await w.su.query(`SELECT count(*)::int n FROM platform.outbox WHERE topic='MessagePosted' AND aggregate_id=$1`, [sMine.id])).rows[0].n).toBe(2);                                // both shared messages notify; the internal note does not
    expect((await other.get(`/messages?relatedType=shipment&relatedId=${sMine.id}`)).status).toBe(404); expect((await other.post('/messages', { relatedType: 'shipment', relatedId: sMine.id, body: 'hello' })).status).toBe(404);
    expect((await cust.post('/messages', { relatedType: 'party', relatedId: mine.customer, body: 'x' })).status).toBe(404); expect((await cust.get('/messages')).status).toBe(404);
    expect((await ops.post('/messages', { relatedType: 'party', relatedId: mine.customer, body: 'x1', shared: true })).status).toBe(422);                                              // only customer-visible records can be shared
    const agentParty = await makeParty(w.owner, `Agent ${u()}`, ['agent']); const agent = await ext('agent', 'agent_portal', agentParty); expect((await agent.get(`/messages?relatedType=shipment&relatedId=${sMine.id}`)).status).toBe(403);
    for (let k = 0; k < 29; k++) await cust.post('/messages', { relatedType: 'shipment', relatedId: sMine.id, body: `spam ${k}` });
    expect((await cust.post('/messages', { relatedType: 'shipment', relatedId: sMine.id, body: 'one too many' })).body.code).toBe('RATE_LIMITED');
    await expect(w.su.query(`UPDATE collab.messages SET body='tampered' WHERE related_id=$1`, [sMine.id])).rejects.toThrow();                                                            // append-only
  });
});
