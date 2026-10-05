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
  it('the worker role is tenant-bound: without a tenant context it sees no domain rows', async () => {
    const r = await pool.query(`SELECT count(*)::int n FROM collab.tasks`); expect(r.rows[0].n).toBe(0);
    await expect(pool.query(`SELECT * FROM finance.invoices`)).rejects.toThrow(/permission denied/);
    await expect(pool.query(`UPDATE platform.outbox SET payload='{}'`)).rejects.toThrow(/permission denied/);
  });
});
void QueueEvents;
