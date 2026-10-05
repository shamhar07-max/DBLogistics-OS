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
    expect((await cust.get(`/shipments/${sMine.id}`)).body.legal_entity_id).toBeUndefined();

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
