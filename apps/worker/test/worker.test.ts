import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { migrate } from '../../../database/migrate';
import { makePool } from '../src/db';
import { EVENTS_QUEUE, relayOutbox } from '../src/relay';
import { handleEvent, resumeDueRuns, type ScanPort } from '../src/handlers';

const SU = 'postgres://postgres@localhost:54329/dbl_wtest';
const WURL = 'postgres://dbl_worker:dbl_worker_dev@localhost:54329/dbl_wtest';
let su: pg.Pool, pool: pg.Pool, redis: ChildProcess, conn: Redis, queue: Queue, tenant: string, le: string, party: string;
const scanner: ScanPort = { async scan(k) { return k.includes('eicar') ? 'infected' : 'clean'; } };
const tasks = async (title?: string) => (await su.query(`SELECT count(*)::int n FROM collab.tasks WHERE tenant_id=$1 ${title ? "AND title LIKE '%' || $2 || '%'" : ''}`, title ? [tenant, title] : [tenant])).rows[0].n;
const emit = async (topic: string, aggId = randomUUID(), payload = {}) => Number((await su.query(`INSERT INTO platform.outbox(tenant_id, topic, aggregate_type, aggregate_id, payload) VALUES ($1,$2,'x',$3,$4::jsonb) RETURNING id`, [tenant, topic, aggId, JSON.stringify(payload)])).rows[0].id);

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: 'postgres://postgres@localhost:54329/postgres' }); await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS dbl_wtest WITH (FORCE)'); await admin.query('CREATE DATABASE dbl_wtest OWNER dbl_migrator'); await admin.end();
  const s = new pg.Client({ connectionString: SU }); await s.connect(); await s.query('CREATE EXTENSION pgcrypto'); await s.end();
  await migrate('postgres://dbl_migrator:dbl_migrator_dev@localhost:54329/dbl_wtest');
  su = new pg.Pool({ connectionString: SU }); pool = makePool(WURL);
  tenant = (await su.query(`INSERT INTO platform.tenants(slug,name) VALUES ('w-test','W') RETURNING id`)).rows[0].id;
  le = (await su.query(`INSERT INTO org.legal_entities(tenant_id,name,base_currency) VALUES ($1,'LE','AED') RETURNING id`, [tenant])).rows[0].id;
  party = (await su.query(`INSERT INTO parties.parties(tenant_id,legal_name) VALUES ($1,'C') RETURNING id`, [tenant])).rows[0].id;
  redis = spawn('redis-server', ['--port', '6391', '--save', '', '--appendonly', 'no'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 800));
  conn = new Redis('redis://localhost:6391', { maxRetriesPerRequest: null }); queue = new Queue(EVENTS_QUEUE, { connection: conn });
});
afterAll(async () => { await queue.obliterate({ force: true }).catch(() => {}); await queue.close(); conn.disconnect(); redis.kill(); await pool.end(); await su.end(); });

describe('outbox relay + consumers', () => {
  it('delivers a committed event once through BullMQ even with two relays racing; redelivery has no second effect', async () => {
    const id = await emit('DeliveryCompleted', randomUUID(), { jobId: 'j1' });
    const [a, b] = await Promise.all([relayOutbox(pool, queue), relayOutbox(pool, queue)]);
    expect(a + b).toBe(1);                                                          // SKIP LOCKED: only one relay claimed it
    const seen: any[] = []; const done = new Promise<void>((resolve) => {
      const w = new Worker(EVENTS_QUEUE, async (job) => { seen.push(job.data); await handleEvent(pool, scanner, job.data); }, { connection: conn });
      w.on('completed', async () => { await w.close(); resolve(); });
    });
    await done; expect(seen).toHaveLength(1); expect(await tasks('verify POD')).toBe(1);
    await handleEvent(pool, scanner, seen[0]); await handleEvent(pool, scanner, seen[0]);   // simulated redelivery
    expect(await tasks('verify POD')).toBe(1);
    expect((await su.query(`SELECT published_at FROM platform.outbox WHERE id=$1`, [id])).rows[0].published_at).not.toBeNull();
  });
  it('workflows: versioned definition runs once per event, durable wait resumes from the database', async () => {
    await su.query(`INSERT INTO automation.workflow_definitions(tenant_id,key,version,trigger_topic,definition,status,owner_user_id) VALUES ($1,'late-pod',1,'BookingConfirmed',$2::jsonb,'active',$3)`,
      [tenant, JSON.stringify({ actions: [{ type: 'create_task', title: 'WF step one' }, { type: 'wait', seconds: 3600 }, { type: 'create_task', title: 'WF step two' }] }), randomUUID()]);
    const id = await emit('BookingConfirmed'); const evt = { id: String(id), tenantId: tenant, topic: 'BookingConfirmed', aggregateType: 'x', aggregateId: randomUUID(), payload: {} };
    await handleEvent(pool, scanner, evt); await handleEvent(pool, scanner, evt);       // duplicate delivery
    expect(await tasks('WF step one')).toBe(1); expect(await tasks('WF step two')).toBe(0);
    let run = (await su.query(`SELECT status FROM automation.workflow_runs WHERE tenant_id=$1`, [tenant])).rows; expect(run).toEqual([{ status: 'waiting' }]);
    expect(await resumeDueRuns(pool)).toBe(0);                                          // not due yet
    await su.query(`UPDATE automation.workflow_runs SET resume_at = now() - interval '1 second' WHERE tenant_id=$1`, [tenant]);
    expect(await resumeDueRuns(pool)).toBe(1); expect(await tasks('WF step two')).toBe(1);
    run = (await su.query(`SELECT status FROM automation.workflow_runs WHERE tenant_id=$1`, [tenant])).rows; expect(run).toEqual([{ status: 'completed' }]);
  });
  it('integration inbox events become tracking events once; unknown types are marked ignored', async () => {
    const job = (await su.query(`INSERT INTO logistics.jobs(tenant_id,legal_entity_id,ref,customer_party_id,currency) VALUES ($1,$2,'JOB-W-1',$3,'AED') RETURNING id`, [tenant, le, party])).rows[0].id;
    await su.query(`INSERT INTO logistics.shipments(tenant_id,job_id,ref,mode,origin,destination) VALUES ($1,$2,'SHP-W-1','ocean_fcl','A','B')`, [tenant, job]);
    const mk = async (extId: string, type: string, payload: object) => { const r = (await su.query(`INSERT INTO integ.inbox_events(tenant_id,provider,external_event_id,event_type,payload) VALUES ($1,'carrierx',$2,$3,$4::jsonb) RETURNING id`, [tenant, extId, type, JSON.stringify(payload)])).rows[0].id; const oid = await emit('IntegrationEventReceived', r); return { id: String(oid), tenantId: tenant, topic: 'IntegrationEventReceived', aggregateType: 'inbox_event', aggregateId: r, payload: {} }; };
    const e1 = await mk('x1', 'tracking.update', { shipmentRef: 'SHP-W-1', code: 'DISCHARGED', occurredAt: '2026-10-02T00:00:00Z' });
    await handleEvent(pool, scanner, e1); await handleEvent(pool, scanner, e1);
    expect((await su.query(`SELECT count(*)::int n FROM logistics.tracking_events WHERE tenant_id=$1 AND code='DISCHARGED'`, [tenant])).rows[0].n).toBe(1);
    const e2 = await mk('x2', 'weather.alert', {}); await handleEvent(pool, scanner, e2);
    expect((await su.query(`SELECT status FROM integ.inbox_events WHERE external_event_id='x2'`)).rows[0].status).toBe('ignored');
    const e3 = await mk('x3', 'tracking.update', { shipmentRef: 'NOPE', code: 'X' }); await handleEvent(pool, scanner, e3);
    expect((await su.query(`SELECT status FROM integ.inbox_events WHERE external_event_id='x3'`)).rows[0].status).toBe('failed');
  });
  it('document scan marks versions clean or infected', async () => {
    const mkDoc = async (key: string) => { const d = (await su.query(`INSERT INTO platform.documents(tenant_id,doc_type,issuer_kind,related_type,related_id) VALUES ($1,'BL','carrier','job',gen_random_uuid()) RETURNING id`, [tenant])).rows[0].id; const v = (await su.query(`INSERT INTO platform.document_versions(tenant_id,document_id,version_no,storage_key,sha256,size_bytes,content_type) VALUES ($1,$2,1,$3,'a','1','application/pdf') RETURNING id`, [tenant, d, key])).rows[0].id; return { d, v }; };
    for (const [key, expected] of [['t/ok.pdf', 'clean'], ['t/eicar.com', 'infected']] as const) {
      const { v } = await mkDoc(key); const oid = await emit('DocumentApproved', randomUUID(), { stage: 'registered', versionId: v });
      await handleEvent(pool, scanner, { id: String(oid), tenantId: tenant, topic: 'DocumentApproved', aggregateType: 'document', aggregateId: v, payload: { stage: 'registered', versionId: v } });
      expect((await su.query(`SELECT scan_status FROM platform.document_versions WHERE id=$1`, [v])).rows[0].scan_status).toBe(expected);
    }
  });
  it('extracts fields after a clean scan, only once, and never reads an infected file', async () => {
    const reads: string[] = []; const reader = { read: async (k: string) => { reads.push(k); return Buffer.from('BL NO: MAEU123456789 container CSQU3054383 FOB USD 100.00 ' + (k.includes('eicar') ? 'X' : '')); } };
    for (const [key, scan] of [['x/ok.txt', 'clean'], ['x/eicar.txt', 'infected']] as const) {
      const d = (await su.query(`INSERT INTO platform.documents(tenant_id,doc_type,issuer_kind,related_type,related_id) VALUES ($1,'BL','carrier','job',gen_random_uuid()) RETURNING id`, [tenant])).rows[0].id;
      const v = (await su.query(`INSERT INTO platform.document_versions(tenant_id,document_id,version_no,storage_key,sha256,size_bytes,content_type) VALUES ($1,$2,1,$3,'a','1','text/plain') RETURNING id`, [tenant, d, key])).rows[0].id;
      const ev = { id: String(await emit('DocumentApproved', randomUUID(), { stage: 'registered', versionId: v })), tenantId: tenant, topic: 'DocumentApproved', aggregateType: 'document', aggregateId: d, payload: { stage: 'registered', versionId: v } };
      await handleEvent(pool, scanner, ev, reader); await handleEvent(pool, scanner, ev, reader);          // redelivery
      const rows = (await su.query(`SELECT status, fields FROM platform.document_extractions WHERE document_version_id=$1`, [v])).rows;
      if (scan === 'clean') { expect(rows).toHaveLength(1); expect(rows[0].status).toBe('done'); expect(rows[0].fields.incoterm).toBe('FOB'); expect(rows[0].fields.containerNumbers[0].checkDigitValid).toBe(true); }
      else expect(rows).toHaveLength(0);
    }
    expect(reads).toEqual(['x/ok.txt']);                                                                 // one read for the clean file; infected bytes were never opened
  });
  it('the worker role is tenant-bound: without a tenant context it sees no domain rows', async () => {
    const r = await pool.query(`SELECT count(*)::int n FROM collab.tasks`); expect(r.rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int n FROM finance.invoices`)).rows[0].n).toBe(0);                      // readable (to resolve the customer for notifications) but only inside a tenant context
    expect((await pool.query(`SELECT count(*)::int n FROM parties.contacts`)).rows[0].n).toBe(0);
    await expect(pool.query(`SELECT * FROM finance.journals`)).rejects.toThrow(/permission denied/);                   // the ledger stays off limits
    await expect(pool.query(`UPDATE finance.invoices SET status='posted'`)).rejects.toThrow(/permission denied/);
    await expect(pool.query(`UPDATE platform.outbox SET payload='{}'`)).rejects.toThrow(/permission denied/);
  });
describe('workflow engine (validated language, failure handling, recovery)', () => {
  const def = async (key: string, topic: string, definition: object) => (await su.query(`INSERT INTO automation.workflow_definitions(tenant_id,key,version,trigger_topic,definition,status,owner_user_id) VALUES ($1,$2,1,$3,$4::jsonb,'active',$5) RETURNING id`, [tenant, key, topic, JSON.stringify(definition), randomUUID()])).rows[0].id as string;
  const fire = (topic: string, payload: object) => handleEvent(pool, scanner, { id: String(Math.floor(Math.random() * 1e12)), tenantId: tenant, topic, aggregateType: 'job', aggregateId: randomUUID(), payload });
  const runs = async (id: string) => (await su.query(`SELECT status, attempts, last_error, log, state FROM automation.workflow_runs WHERE definition_id=$1 ORDER BY started_at`, [id])).rows;

  it('conditions gate a run (skipped runs are recorded with the reason); templates read the stored trigger payload; due dates are set', async () => {
    const id = await def('big-job', 'JobClosed', { conditions: [{ field: 'payload.amount', op: 'gt', value: 100 }], actions: [{ type: 'create_task', title: 'Review {{payload.jobRef}} ({{aggregateType}})', dueInHours: 24 }] });
    await fire('JobClosed', { amount: 50, jobRef: 'J-1' }); await fire('JobClosed', { amount: 500, jobRef: 'J-77' });
    const r = await runs(id); expect(r.map((x) => x.status)).toEqual(['skipped', 'completed']); expect(r[0].log[0].note).toMatch(/Conditions not met/); expect(r[1].state.event.payload.jobRef).toBe('J-77');
    const t = (await su.query(`SELECT title, due_at, origin FROM collab.tasks WHERE tenant_id=$1 AND title LIKE 'Review J-%'`, [tenant])).rows; expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ title: 'Review J-77 (job)', origin: 'automation' }); expect(t[0].due_at).not.toBeNull();
  });
  it('an action that cannot run fails the run with the reason and rolls the whole step back; retry resumes from the same step and fails visibly again, never half-applied', async () => {
    const id = await def('bad-step', 'ChargeCreated', { actions: [{ type: 'create_task', title: 'Half applied?' }, { type: 'teleport', where: 'moon' }] });
    await fire('ChargeCreated', {});
    let r = (await runs(id))[0]; expect(r).toMatchObject({ status: 'failed', attempts: 1 }); expect(r.last_error).toMatch(/Unknown action type "teleport" at step 2/); expect(await tasks('Half applied?')).toBe(0);
    await su.query(`UPDATE automation.workflow_runs SET status='waiting', resume_at=now() WHERE definition_id=$1`, [id]);          // what POST /workflow-runs/:id/retry does
    expect(await resumeDueRuns(pool)).toBeGreaterThanOrEqual(1); r = (await runs(id))[0]; expect(r).toMatchObject({ status: 'failed', attempts: 2 }); expect(await tasks('Half applied?')).toBe(0);
  });
  it('one failing run never starves the others in the timer poller; a cancelled run never advances', async () => {
    const bad = await def('poison', 'InvoicePosted', { actions: [{ type: 'wait', seconds: 1 }, { type: 'nope' }] }); const good = await def('healthy', 'InvoicePosted', { actions: [{ type: 'wait', seconds: 1 }, { type: 'create_task', title: 'Healthy after wait' }] });
    const cancelled = await def('to-cancel', 'InvoicePosted', { actions: [{ type: 'wait', seconds: 1 }, { type: 'create_task', title: 'Must not exist' }] });
    await fire('InvoicePosted', {}); await su.query(`UPDATE automation.workflow_runs SET status='cancelled' WHERE definition_id=$1`, [cancelled]);
    await su.query(`UPDATE automation.workflow_runs SET resume_at = now() - interval '1 second' WHERE status='waiting' AND definition_id IN ($1,$2)`, [bad, good]);
    expect(await resumeDueRuns(pool)).toBe(2); expect((await runs(good))[0].status).toBe('completed'); expect((await runs(bad))[0].status).toBe('failed'); expect(await tasks('Healthy after wait')).toBe(1); expect(await tasks('Must not exist')).toBe(0);
  });
  it('runs orphaned by a worker crash (running, no heartbeat for 5 minutes) are recovered; fresh running runs are left alone', async () => {
    const id = await def('orphan', 'PaymentAllocated', { actions: [{ type: 'create_task', title: 'Recovered after crash' }] });
    const mk = async (ageMinutes: number) => (await su.query(`INSERT INTO automation.workflow_runs(tenant_id, definition_id, trigger_event_id, status, state, heartbeat_at) VALUES ($1,$2,$3,'running',$4::jsonb, now() - ($5 || ' minutes')::interval) RETURNING id`, [tenant, id, Math.floor(Math.random() * 1e12), JSON.stringify({ index: 0, event: { topic: 'PaymentAllocated', aggregateType: 'x', aggregateId: randomUUID(), payload: {} } }), String(ageMinutes)])).rows[0].id;
    await mk(1); await mk(30); expect(await resumeDueRuns(pool)).toBe(1); expect(await tasks('Recovered after crash')).toBe(1);
    expect((await runs(id)).map((x) => x.status).sort()).toEqual(['completed', 'running']);
  });
});
});
void QueueEvents;

describe('document scanner', () => {
  it('flags the EICAR signature, passes clean files, and treats unreadable files as failed — never clean; storage layout is pinned to the API', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const { DiskScanner, EICAR, diskPath, pickScanner } = await import('../src/scanner');
    const dir = mkdtempSync(join(tmpdir(), 'scan-')); writeFileSync(diskPath(dir, 'k/clean'), 'hello'); writeFileSync(diskPath(dir, 'k/bad'), `pre ${EICAR} post`);
    const s = new DiskScanner(dir); expect(await s.scan('k/clean')).toBe('clean'); expect(await s.scan('k/bad')).toBe('infected'); expect(await s.scan('k/missing')).toBe('failed');
    expect(diskPath('/d', 't1/incoming/abc')).toBe('/d/499a6a003dee3817acc4eecd02ad76cd1bb7859ac791faf29261d5db3b8887e9');                  // same literal as apps/api/test/devfiles.test.ts
    expect(await pickScanner({}).scanner.scan('x')).toBe('failed'); expect(pickScanner({ DEV_STORAGE_DIR: dir }).scanner).toBeInstanceOf(DiskScanner);
    expect(await pickScanner({ ALLOW_UNSCANNED_DOCUMENTS: 'true', NODE_ENV: 'production' }).scanner.scan('x')).toBe('failed');
  });
});

// ---------------------------------------------------------------------------------------------------- notifications
import { createServer, type Server } from 'node:http';
import { SMTPServer } from 'smtp-server';
import { simpleParser, type ParsedMail } from 'mailparser';
import { pickAdapters, SendError, SmtpEmailAdapter, WhatsAppCloudAdapter } from '../src/notify/adapters';
import { renderNotification } from '../src/notify/templates';
import { notifyCustomer, pickChannel, sendDue } from '../src/notify/queue';
import { inTenant } from '../src/db';
import { NOTIFICATION_TEMPLATES } from '@dbl/contracts';

describe('notifications: real SMTP and WhatsApp Cloud API adapters, consent-aware queue, retries, receipts', () => {
  let smtp: SMTPServer, smtpPort = 0; const mails: ParsedMail[] = []; let rcptRule: (addr: string) => { code: number; msg: string } | null = () => null;
  let graph: Server, graphPort = 0; const calls: Array<{ path: string; auth?: string; body: any }> = []; let graphReply: () => { status: number; body: any } = () => ({ status: 200, body: { messages: [{ id: `wamid.${Math.random().toString(36).slice(2)}` }] } });
  let jobId = '', shipmentId = '', partyN = '', contacts: Record<string, string> = {};
  const wa = () => new WhatsAppCloudAdapter({ token: 'TKN', phoneNumberId: '1234567890', apiBase: `http://127.0.0.1:${graphPort}/v21.0` });
  const mail = () => new SmtpEmailAdapter(`smtp://127.0.0.1:${smtpPort}`, 'DigitalBurj Logistics <no-reply@dbl.test>');
  const adapters = () => ({ email: mail(), whatsapp: wa() });
  const rows = async (where = '') => (await su.query(`SELECT * FROM integ.outbound_messages WHERE tenant_id=$1 ${where} ORDER BY created_at, id`, [tenant])).rows;

  beforeAll(async () => {
    smtp = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onRcptTo(a, _s, cb) { const r = rcptRule(a.address); cb(r ? Object.assign(new Error(r.msg), { responseCode: r.code }) : undefined); },
      onData(stream, _s, cb) { simpleParser(stream).then((m) => { mails.push(m); cb(); }, cb); } });
    await new Promise<void>((r) => smtp.listen(0, '127.0.0.1', () => r())); smtpPort = (smtp.server.address() as any).port;
    graph = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { calls.push({ path: req.url!, auth: req.headers.authorization, body: JSON.parse(b || '{}') }); const r = graphReply(); res.writeHead(r.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.body)); }); });
    await new Promise<void>((r) => graph.listen(0, '127.0.0.1', () => r())); graphPort = (graph.address() as any).port;
    partyN = (await su.query(`INSERT INTO parties.parties(tenant_id,legal_name) VALUES ($1,'Notify Customer LLC') RETURNING id`, [tenant])).rows[0].id;
    const ins = async (name: string, email: string | null, phone: string | null, pref: string | null, optIn: boolean, optOut: boolean) => (await su.query(`INSERT INTO parties.contacts(tenant_id,party_id,name,email,phone,preferred_channel,whatsapp_opt_in,email_opt_out) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [tenant, partyN, name, email, phone, pref, optIn, optOut])).rows[0].id;
    contacts = { amal: await ins('Amal', 'amal@cust.test', null, null, false, false), bilal: await ins('Bilal', null, '+971501112233', 'whatsapp', true, false), chen: await ins('Chen', 'chen@cust.test', null, null, false, true), dina: await ins('Dina', 'dina@cust.test', '+971509998877', 'whatsapp', false, false), eli: await ins('Eli', 'eli@cust.test', '+971505554433', null, true, false) };
    jobId = (await su.query(`INSERT INTO logistics.jobs(tenant_id,legal_entity_id,ref,customer_party_id,currency) VALUES ($1,$2,'JOB-N-1',$3,'AED') RETURNING id`, [tenant, le, partyN])).rows[0].id;
    shipmentId = (await su.query(`INSERT INTO logistics.shipments(tenant_id,job_id,ref,mode,origin,destination) VALUES ($1,$2,'SHP-N-1','air','Frankfurt','Dubai') RETURNING id`, [tenant, jobId])).rows[0].id;
    await su.query(`UPDATE org.legal_entities SET address='Warehouse 14, Jebel Ali', email='ops@dbl.test', phone='+971 4 555 0100' WHERE id=$1`, [le]);
  });
  afterAll(async () => { await new Promise((r) => smtp.close(() => r(null))); await new Promise((r) => graph.close(() => r(null))); });

  it('every catalogue template renders email (escaped, with the brand logo and call to action) and WhatsApp parameters in the documented order', () => {
    for (const t of NOTIFICATION_TEMPLATES) {
      const vars = Object.fromEntries(t.vars.map((k) => [k, k === 'link' ? 'https://portal.test/x?a=1&b=2' : `<b>${k}</b>`])); const r = renderNotification(t.name, vars, { name: 'Demo Freight LLC', address: 'Dubai', trn: '1002' });
      expect(r.email.subject.length).toBeGreaterThan(5); expect(r.email.html).toContain('cid:dbl-logo'); expect(r.email.html).toContain('One system. Every operation.'); expect(r.email.html).not.toContain('<b>customerName</b>'); expect(r.email.html).toContain('&lt;b&gt;'); expect(r.email.html).toContain('a=1&amp;b=2');
      expect(r.whatsapp.name).toBe(`dbl_${t.name}`); expect(r.whatsapp.params).toHaveLength(t.vars.length); expect(r.whatsapp.params[0]).toBe('<b>customerName</b>'); expect(r.email.text).toContain('Demo Freight LLC');
    }
    expect(() => renderNotification('nope', {})).toThrow(/Unknown notification template/);
  });
  it('SMTP adapter delivers a real message (HTML + text + inline logo); 5xx is permanent, 4xx and network failure are retryable', async () => {
    mails.length = 0; const r = renderNotification('invoice_posted', { customerName: 'Amal', invoiceRef: 'INV-1', amount: 'AED 105.00', dueDate: '2026-11-01', link: 'https://portal.test/invoices/1' }, { name: 'Demo Freight LLC' });
    const out = await mail().send({ id: 'x', channel: 'email', to: 'amal@cust.test', toName: 'Amal', rendered: r }); expect(out.provider).toBe('smtp'); expect(out.providerMessageId).toBeTruthy();
    const m = mails[0]; expect(m.subject).toBe('Invoice INV-1 from Demo Freight LLC'); expect(m.to).toMatchObject({ value: [{ address: 'amal@cust.test', name: 'Amal' }] }); expect(m.html).toContain('View and download invoice'); expect(m.text).toContain('https://portal.test/invoices/1'); expect(m.attachments.find((a) => a.cid === 'dbl-logo')?.contentType).toBe('image/png');
    expect(m.headers.get('auto-submitted')).toBe('auto-generated');
    rcptRule = () => ({ code: 550, msg: 'mailbox unavailable' }); await expect(mail().send({ id: 'x', channel: 'email', to: 'gone@cust.test', rendered: r })).rejects.toMatchObject({ retryable: false });
    rcptRule = () => ({ code: 451, msg: 'try later' }); await expect(mail().send({ id: 'x', channel: 'email', to: 'busy@cust.test', rendered: r })).rejects.toMatchObject({ retryable: true });
    rcptRule = () => null; await expect(new SmtpEmailAdapter('smtp://127.0.0.1:1', 'a@b.test').send({ id: 'x', channel: 'email', to: 'a@b.test', rendered: r })).rejects.toMatchObject({ retryable: true });
  });
  it('WhatsApp adapter posts a template message to the Graph API with bearer auth; 190/131047 are permanent, 429/5xx and network errors retryable', async () => {
    calls.length = 0; const r = renderNotification('shipment_update', { customerName: 'Bilal', shipmentRef: 'SHP-9', milestone: 'DEPARTED', link: 'https://p.test/s/9' });
    const out = await wa().send({ id: 'x', channel: 'whatsapp', to: '+971501112233', rendered: r }); expect(out.providerMessageId).toMatch(/^wamid\./);
    expect(calls[0].path).toBe('/v21.0/1234567890/messages'); expect(calls[0].auth).toBe('Bearer TKN'); expect(calls[0].body).toMatchObject({ messaging_product: 'whatsapp', to: '971501112233', type: 'template', template: { name: 'dbl_shipment_update', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Bilal' }, { type: 'text', text: 'SHP-9' }, { type: 'text', text: 'DEPARTED' }, { type: 'text', text: 'https://p.test/s/9' }] }] } });
    const fail = async (status: number, code: number) => { graphReply = () => ({ status, body: { error: { code, message: 'nope' } } }); try { await wa().send({ id: 'x', channel: 'whatsapp', to: '+971501112233', rendered: r }); } catch (e) { return e as SendError; } };
    expect((await fail(401, 190))!.retryable).toBe(false); expect((await fail(400, 131047))!.retryable).toBe(false); expect((await fail(400, 132001))!.message).toMatch(/132001/); expect((await fail(429, 130429))!.retryable).toBe(true); expect((await fail(503, 2))!.retryable).toBe(true);
    graphReply = () => ({ status: 200, body: { messages: [{ id: 'wamid.reset' }] } });
    await expect(new WhatsAppCloudAdapter({ token: 't', phoneNumberId: '1', apiBase: 'http://127.0.0.1:1' }).send({ id: 'x', channel: 'whatsapp', to: '+9715', rendered: r })).rejects.toMatchObject({ retryable: true });
  });
  it('consent: one channel per contact — preference honoured only with opt-in, opt-outs respected, WhatsApp needs opt-in and a phone', () => {
    const c = (o: Partial<Parameters<typeof pickChannel>[0]>) => ({ id: 'c', name: 'n', email: 'a@b.c', phone: '+971500000000', preferred_channel: null, whatsapp_opt_in: false, email_opt_out: false, ...o });
    expect(pickChannel(c({}))).toBe('email'); expect(pickChannel(c({ preferred_channel: 'whatsapp' }))).toBe('email'); expect(pickChannel(c({ preferred_channel: 'whatsapp', whatsapp_opt_in: true }))).toBe('whatsapp');
    expect(pickChannel(c({ email_opt_out: true }))).toBeNull(); expect(pickChannel(c({ email_opt_out: true, whatsapp_opt_in: true }))).toBe('whatsapp'); expect(pickChannel(c({ whatsapp_opt_in: true, phone: null, email_opt_out: true }))).toBeNull(); expect(pickChannel(c({ whatsapp_opt_in: true }), 'whatsapp')).toBe('whatsapp'); expect(pickChannel(c({}), 'whatsapp')).toBeNull();
  });
  it('a customer notification queues one message per eligible contact, never twice for the same key, then sends through the real adapters and records provider ids', async () => {
    const q1 = await inTenant(pool, tenant, (q) => notifyCustomer(q, { tenantId: tenant, aggregateType: 'shipment', aggregateId: shipmentId, template: 'shipment_update', vars: { milestone: 'DEPARTED' }, dedupeKey: 'test:1' }));
    expect(q1).toEqual({ queued: 4, skipped: 1 });                                                            // Chen opted out of email and has no WhatsApp consent
    const again = await inTenant(pool, tenant, (q) => notifyCustomer(q, { tenantId: tenant, aggregateType: 'shipment', aggregateId: shipmentId, template: 'shipment_update', dedupeKey: 'test:1' })); expect(again.queued).toBe(0);
    const byName = Object.fromEntries((await rows()).map((r) => [r.to_name, r.channel])); expect(byName).toEqual({ Amal: 'email', Bilal: 'whatsapp', Dina: 'email', Eli: 'email' });
    mails.length = 0; calls.length = 0; expect(await sendDue(pool, adapters())).toBe(4);
    const sent = await rows(); expect(sent.every((r) => r.status === 'sent' && r.attempts === 1 && r.provider_message_id)).toBe(true); expect(mails).toHaveLength(3); expect(calls).toHaveLength(1); expect(calls[0].body.template.components[0].parameters[0].text).toBe('Bilal');
    expect(mails.map((m) => m.subject)).toEqual(Array(3).fill('Shipment SHP-N-1: DEPARTED')); expect(mails[0].html).toContain('Warehouse 14, Jebel Ali'); expect(mails[0].html).toContain('/shipments/' + shipmentId); expect(await sendDue(pool, adapters())).toBe(0);
    await expect(inTenant(pool, tenant, (q) => notifyCustomer(q, { tenantId: tenant, aggregateType: 'shipment', aggregateId: shipmentId, template: 'bogus', dedupeKey: 'x' }))).rejects.toThrow(/Unknown notification template/);
  });
  it('transient failures back off and succeed later; permanent ones fail at once with the reason; attempts are capped; retry resets; not-configured fails visibly', async () => {
    await su.query(`DELETE FROM integ.outbound_messages WHERE tenant_id=$1`, [tenant]);
    const queue = (key: string) => inTenant(pool, tenant, (q) => notifyCustomer(q, { tenantId: tenant, aggregateType: 'shipment', aggregateId: shipmentId, template: 'delivery_completed', channel: 'whatsapp', dedupeKey: key })); await queue('t:1');
    graphReply = () => ({ status: 503, body: { error: { code: 2, message: 'temporarily unavailable' } } }); await sendDue(pool, adapters());
    let r = (await rows())[0]; expect(r).toMatchObject({ status: 'queued', attempts: 1 }); expect(r.last_error).toMatch(/503|WhatsApp 2/); expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30_000); expect(await sendDue(pool, adapters())).toBe(0);      // backing off
    await su.query(`UPDATE integ.outbound_messages SET next_attempt_at=now() WHERE tenant_id=$1`, [tenant]); graphReply = () => ({ status: 200, body: { messages: [{ id: 'wamid.second' }] } }); await sendDue(pool, adapters());
    r = (await rows())[0]; expect(r).toMatchObject({ status: 'sent', attempts: 2, provider_message_id: 'wamid.second', last_error: null });
    await su.query(`DELETE FROM integ.outbound_messages WHERE tenant_id=$1`, [tenant]); await queue('t:2'); graphReply = () => ({ status: 401, body: { error: { code: 190, message: 'Error validating access token' } } }); await sendDue(pool, adapters());
    r = (await rows())[0]; expect(r.status).toBe('failed'); expect(r.last_error).toMatch(/190/);
    await su.query(`UPDATE integ.outbound_messages SET status='queued', attempts=4, next_attempt_at=now() WHERE tenant_id=$1`, [tenant]); graphReply = () => ({ status: 500, body: {} }); await sendDue(pool, adapters()); r = (await rows())[0]; expect(r).toMatchObject({ status: 'failed', attempts: 5 });             // cap reached
    await su.query(`UPDATE integ.outbound_messages SET status='queued', attempts=0, next_attempt_at=now() WHERE tenant_id=$1`, [tenant]); graphReply = () => ({ status: 200, body: { messages: [{ id: 'wamid.third' }] } }); await sendDue(pool, adapters()); expect((await rows())[0].status).toBe('sent');
    await su.query(`DELETE FROM integ.outbound_messages WHERE tenant_id=$1`, [tenant]); await queue('t:3'); await sendDue(pool, pickAdapters({}).adapters); r = (await rows())[0]; expect(r.status).toBe('failed'); expect(r.last_error).toMatch(/not configured.*WHATSAPP_TOKEN/);
    await su.query(`UPDATE integ.outbound_messages SET status='sending', claimed_at=now() - interval '30 minutes' WHERE tenant_id=$1`, [tenant]); await sendDue(pool, { email: mail(), whatsapp: wa() }); expect((await rows())[0].status).toBe('sent');                                  // crash recovery: stale claim is re-queued
  });
  it('workflow notify steps and built-in reactions deliver for real: milestone email, customer reply notification, staff task for inbound messages', async () => {
    await su.query(`DELETE FROM integ.outbound_messages WHERE tenant_id=$1`, [tenant]); mails.length = 0; graphReply = () => ({ status: 200, body: { messages: [{ id: 'wamid.wf' }] } });
    await su.query(`INSERT INTO automation.workflow_definitions(tenant_id,key,version,trigger_topic,definition,status,owner_user_id) VALUES ($1,'tell-customer',1,'ShipmentEventRecorded',$2::jsonb,'active',$3)`, [tenant, JSON.stringify({ actions: [{ type: 'notify', channel: 'email', template: 'shipment_update', recipient: 'customer' }, { type: 'notify', channel: 'whatsapp', template: 'shipment_update', recipient: 'customer' }] }), randomUUID()]);
    const ev = (topic: string, payload: object, id = String(Math.floor(Math.random() * 1e12))) => ({ id, tenantId: tenant, topic, aggregateType: 'shipment', aggregateId: shipmentId, payload });
    await handleEvent(pool, scanner, ev('ShipmentEventRecorded', { code: 'CUSTOMS_CLEARED' }));
    const run = (await su.query(`SELECT r.status, r.log FROM automation.workflow_runs r JOIN automation.workflow_definitions d ON d.id=r.definition_id WHERE d.key='tell-customer'`)).rows[0]; expect(run.status).toBe('completed'); expect(run.log.map((l: any) => l.note)).toEqual(['3 email message(s) queued (shipment_update)', '2 whatsapp message(s) queued (shipment_update)']);
    await sendDue(pool, adapters()); expect(mails.map((m) => m.subject)).toEqual(Array(3).fill('Shipment SHP-N-1: CUSTOMS CLEARED'));
    await su.query(`DELETE FROM integ.outbound_messages WHERE tenant_id=$1`, [tenant]); const reply = ev('MessagePosted', { direction: 'outbound', excerpt: 'We booked the 14:30 slot.' }, '777001');
    await handleEvent(pool, scanner, reply); await handleEvent(pool, scanner, reply); expect((await rows()).filter((r) => r.template === 'message_reply')).toHaveLength(4);                // duplicate delivery: no second notification
    const before = await tasks('Customer message'); await handleEvent(pool, scanner, ev('MessagePosted', { direction: 'inbound', excerpt: 'Can you deliver after 14:00?' }, '777002')); expect(await tasks('Customer message')).toBe(before + 1);
  });
  it('WhatsApp receipts advance status without regressing; failures are recorded; inbound customer messages are filed on the party with a task; unknown senders are ignored', async () => {
    await su.query(`DELETE FROM integ.outbound_messages WHERE tenant_id=$1`, [tenant]);
    await inTenant(pool, tenant, (q) => notifyCustomer(q, { tenantId: tenant, aggregateType: 'shipment', aggregateId: shipmentId, template: 'delivery_completed', channel: 'whatsapp', dedupeKey: 'rcpt' })); graphReply = () => ({ status: 200, body: { messages: [{ id: 'wamid.rcpt1' }] } }); await sendDue(pool, adapters());
    const inbox = async (type: string, payload: object, ext = Math.random().toString(36)) => { const id = (await su.query(`INSERT INTO integ.inbox_events(tenant_id,provider,external_event_id,event_type,payload) VALUES ($1,'whatsapp',$2,$3,$4::jsonb) RETURNING id`, [tenant, ext, type, JSON.stringify(payload)])).rows[0].id; await handleEvent(pool, scanner, { id: String(Math.floor(Math.random() * 1e12)), tenantId: tenant, topic: 'IntegrationEventReceived', aggregateType: 'inbox_event', aggregateId: id, payload: {} }); return id; };
    const st = async () => (await rows())[0].status;
    await inbox('whatsapp.status', { messageId: 'wamid.rcpt1', status: 'delivered' }); expect(await st()).toBe('delivered'); await inbox('whatsapp.status', { messageId: 'wamid.rcpt1', status: 'read' }); expect(await st()).toBe('read'); await inbox('whatsapp.status', { messageId: 'wamid.rcpt1', status: 'delivered' }); expect(await st()).toBe('read');
    await su.query(`UPDATE integ.outbound_messages SET status='sent', provider_message_id='wamid.rcpt2' WHERE tenant_id=$1`, [tenant]); await inbox('whatsapp.status', { messageId: 'wamid.rcpt2', status: 'failed', error: '131026: Message undeliverable' }); expect((await rows())[0]).toMatchObject({ status: 'failed', last_error: '131026: Message undeliverable' });
    const t0 = await tasks('WhatsApp from Bilal'); const mid = await inbox('whatsapp.message', { from: '971501112233', text: 'Please call me about SHP-N-1' });
    expect(await tasks('WhatsApp from Bilal')).toBe(t0 + 1); expect((await su.query(`SELECT channel, direction, visibility, body FROM collab.messages WHERE related_id=$1`, [partyN])).rows[0]).toEqual({ channel: 'whatsapp', direction: 'inbound', visibility: 'internal', body: 'Please call me about SHP-N-1' });
    const unknown = await inbox('whatsapp.message', { from: '971400000000', text: 'hello?' }); expect((await su.query(`SELECT status, error FROM integ.inbox_events WHERE id=$1`, [unknown])).rows[0]).toEqual({ status: 'ignored', error: 'unknown sender' }); void mid;
  });
});

describe('ClamAV scanner (clamd INSTREAM)', () => {
  const live = process.env.CLAMD_TEST_PORT ? Number(process.env.CLAMD_TEST_PORT) : 0;
  const mem = (m: Record<string, Buffer>) => ({ read: async (k: string) => { if (!m[k]) throw new Error('missing'); return m[k]!; } });
  it.skipIf(!live)('flags EICAR and passes clean bytes against a real clamd', async () => {
    const { ClamdScanner, EICAR } = await import('../src/scanner');
    const s = new ClamdScanner(mem({ bad: Buffer.from('hello ' + EICAR), good: Buffer.alloc(300_000, 'a') }), { host: '127.0.0.1', port: live });
    expect(await s.ping()).toBe(true);
    expect(await s.scan('bad')).toBe('infected');
    expect(s.detail.get('bad')).toMatch(/^Eicar-Test-Signature/);
    expect(await s.scan('good')).toBe('clean');
    expect(await s.scan('absent')).toBe('failed');
  });
  it('throws (so the job retries) when clamd is unreachable, never clean', async () => {
    const { ClamdScanner, ScannerUnavailable } = await import('../src/scanner');
    const s = new ClamdScanner(mem({ a: Buffer.from('x') }), { host: '127.0.0.1', port: 1 }, 2000);
    await expect(s.scan('a')).rejects.toBeInstanceOf(ScannerUnavailable);
  });
});
