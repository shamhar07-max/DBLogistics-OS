import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { close, makeParty, world, type World } from './helpers';

let w: World;
beforeAll(async () => { process.env.SECRET_WA_APP = 'meta-app-secret'; process.env.SECRET_WA_APP_VERIFY = 'verify-me'; w = await world(); });
afterAll(async () => close(w));
const u = () => randomUUID().slice(0, 4);
const sign = (body: string) => `sha256=${createHmac('sha256', 'meta-app-secret').update(body).digest('hex')}`;

describe('WhatsApp Cloud API webhook', () => {
  it('handshake needs the verify token; callbacks need a valid X-Hub-Signature-256; statuses and messages become deduplicated inbox events', async () => {
    await w.su.query(`INSERT INTO integ.connections(tenant_id, provider, capability, credential_ref, webhook_secret_ref) VALUES ($1,'whatsapp','messaging','sm://wa','WA_APP')`, [w.a.tenantId]);
    const base = `/api/v1/webhooks/whatsapp/${w.a.tenantId}`; const http = () => request(w.app.getHttpServer());
    const ok = await http().get(`${base}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345`); expect(ok.status).toBe(200); expect(ok.text).toBe('12345');
    expect((await http().get(`${base}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`)).status).toBe(403);
    expect((await http().get(`/api/v1/webhooks/whatsapp/${w.b.tenantId}?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1`)).status).toBe(403);       // other tenant has no connection
    expect((await http().get(`/api/v1/webhooks/whatsapp/not-a-tenant?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1`)).status).toBe(400);
    const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.A', status: 'delivered', recipient_id: '971501112233' }, { id: 'wamid.A', status: 'read', recipient_id: '971501112233' }, { id: 'wamid.B', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] }], messages: [{ id: 'wamid.M1', from: '971501112233', type: 'text', text: { body: 'Hello there' } }] } }] }] };
    const body = JSON.stringify(payload); const post = (sig: string, b = body) => http().post(base).set('X-Hub-Signature-256', sig).set('Content-Type', 'application/json').send(b);
    expect((await post('sha256=deadbeef')).status).toBe(401); expect((await post(sign(body) + '0')).status).toBe(401); expect((await post(sign(body.replace('Hello', 'Hullo')))).status).toBe(401);
    const a = await post(sign(body)); expect(a.status).toBe(202); expect(a.body).toEqual({ accepted: 4, new: 4 }); const b = await post(sign(body)); expect(b.body).toEqual({ accepted: 4, new: 0 });                          // Meta retries: no second effect
    const ev = (await w.su.query(`SELECT event_type, payload FROM integ.inbox_events WHERE tenant_id=$1 AND provider='whatsapp' ORDER BY event_type, external_event_id`, [w.a.tenantId])).rows;
    expect(ev.map((e) => e.event_type)).toEqual(['whatsapp.message', 'whatsapp.status', 'whatsapp.status', 'whatsapp.status']); expect(ev[0].payload).toEqual({ messageId: 'wamid.M1', from: '971501112233', kind: 'text', text: 'Hello there' });
    expect(ev.find((e) => e.payload.status === 'failed')!.payload.error).toBe('131026: Message undeliverable');
    expect((await w.su.query(`SELECT count(*)::int n FROM platform.outbox WHERE tenant_id=$1 AND topic='IntegrationEventReceived'`, [w.a.tenantId])).rows[0].n).toBeGreaterThanOrEqual(4);
  });
});

describe('contacts, company profile and delivery log', () => {
  it('contacts carry consent: WhatsApp opt-in needs an international phone number; changes are audited; only staff with the permission may edit', async () => {
    const sales = await w.member(w.a.tenantId, `s${u()}`, ['sales']); const hr = await w.member(w.a.tenantId, `hr${u()}`, ['hr']); const p = await makeParty(w.owner, `Notify ${u()}`, ['customer']);
    expect((await sales.post(`/parties/${p}/contacts`, { name: 'No details' })).status).toBe(422); expect((await sales.post(`/parties/${p}/contacts`, { name: 'Bad phone', phone: '0501234567' })).status).toBe(422);
    expect((await sales.post(`/parties/${p}/contacts`, { name: 'Needs phone', email: 'a@b.ae', whatsappOptIn: true })).body.code).toBe('VALIDATION_FAILED');
    const c = await sales.post(`/parties/${p}/contacts`, { name: 'Amal Hassan', email: 'amal@cust.ae', phone: '+971501234567', preferredChannel: 'whatsapp', whatsappOptIn: true }); expect(c.status).toBe(201);
    const party = (await sales.get(`/parties/${p}`)).body; expect(party.contacts).toEqual([expect.objectContaining({ name: 'Amal Hassan', whatsapp_opt_in: true, email_opt_out: false, preferred_channel: 'whatsapp' })]);
    expect((await sales.post(`/contacts/${c.body.id}`, { whatsappOptIn: false, emailOptOut: true })).status).toBe(200);
    expect((await w.su.query(`SELECT whatsapp_opt_in, email_opt_out FROM parties.contacts WHERE id=$1`, [c.body.id])).rows[0]).toEqual({ whatsapp_opt_in: false, email_opt_out: true });
    expect((await w.su.query(`SELECT count(*)::int n FROM platform.audit_events WHERE entity_id=$1 AND action IN ('contact.added','contact.updated')`, [p])).rows[0].n).toBe(2);
    expect((await hr.post(`/parties/${p}/contacts`, { name: 'Nope', email: 'x@y.ae' })).status).toBe(403); expect((await sales.post(`/parties/${randomUUID()}/contacts`, { name: 'Ghost', email: 'x@y.ae' })).status).toBe(404);
  });
  it('the issuer profile (address, contacts, bank) is editable by tenant admins only and audited; party address and TRN are editable and TRN stays unique', async () => {
    const e = await w.owner.post(`/legal-entities/${w.a.legalEntityId}`, { address: 'Dubai, UAE', bankIban: 'AE070331234567890123456', email: 'accounts@demo.ae' }); expect(e.status).toBe(200);
    const row = (await w.owner.get('/legal-entities')).body.find((x: any) => x.id === w.a.legalEntityId); expect(row).toMatchObject({ address: 'Dubai, UAE', bank_iban: 'AE070331234567890123456', email: 'accounts@demo.ae' });
    expect((await w.owner.post(`/legal-entities/${w.a.legalEntityId}`, { email: 'not-an-email' })).status).toBe(422); expect((await w.owner.post(`/legal-entities/${w.a.legalEntityId}`, {})).status).toBe(422);
    const fm = await w.member(w.a.tenantId, `fm${u()}`, ['finance_manager']); expect((await fm.post(`/legal-entities/${w.a.legalEntityId}`, { address: 'x' })).status).toBe(403);
    expect((await w.su.query(`SELECT count(*)::int n FROM platform.audit_events WHERE action='legal_entity.updated' AND entity_id=$1`, [w.a.legalEntityId])).rows[0].n).toBeGreaterThanOrEqual(1);
    const p1 = await makeParty(w.owner, `P1 ${u()}`, ['customer']); const p2 = await makeParty(w.owner, `P2 ${u()}`, ['customer']); const trn = `1009${Math.floor(Math.random() * 1e9)}`;
    expect((await w.owner.post(`/parties/${p1}`, { taxRegistrationNumber: trn, address: 'Abu Dhabi' })).status).toBe(200); expect((await w.owner.post(`/parties/${p2}`, { taxRegistrationNumber: trn })).status).toBe(409);
  });
  it('delivery log: filter by status/channel; failed messages can be retried, queued ones cancelled, nothing else; needs integrations.manage', async () => {
    const fm = await w.member(w.a.tenantId, `fm${u()}`, ['finance_manager']); const sales = await w.member(w.a.tenantId, `s${u()}`, ['sales']);
    const mk = async (status: string, channel = 'email') => (await w.su.query(`INSERT INTO integ.outbound_messages(tenant_id, channel, to_address, template, status, dedupe_key, last_error) VALUES ($1,$2,'x@y.ae','shipment_update',$3,$4,$5) RETURNING id`, [w.a.tenantId, channel, status, randomUUID(), status === 'failed' ? 'SMTP 550: mailbox unavailable' : null])).rows[0].id as string;
    const failed = await mk('failed'); const queued = await mk('queued', 'whatsapp'); const sent = await mk('sent');
    const all = (await fm.get('/outbound-messages')).body.map((m: any) => m.id); expect(all).toEqual(expect.arrayContaining([failed, queued, sent]));
    expect((await fm.get('/outbound-messages?status=failed')).body.map((m: any) => m.id)).toEqual([failed]); expect((await fm.get('/outbound-messages?channel=whatsapp')).body.map((m: any) => m.id)).toEqual([queued]); expect((await fm.get('/outbound-messages?status=bogus')).status).toBe(422);
    expect((await fm.post(`/outbound-messages/${sent}/retry`)).body.code).toBe('INVALID_STATE_TRANSITION'); expect((await fm.post(`/outbound-messages/${failed}/cancel`)).body.code).toBe('INVALID_STATE_TRANSITION');
    expect((await fm.post(`/outbound-messages/${failed}/retry`)).body.status).toBe('queued'); expect((await w.su.query(`SELECT status, attempts, last_error FROM integ.outbound_messages WHERE id=$1`, [failed])).rows[0]).toEqual({ status: 'queued', attempts: 0, last_error: null });
    expect((await fm.post(`/outbound-messages/${queued}/cancel`)).body.status).toBe('cancelled'); expect((await sales.get('/outbound-messages')).status).toBe(403); expect((await fm.post(`/outbound-messages/${randomUUID()}/retry`)).status).toBe(404);
  });
});
