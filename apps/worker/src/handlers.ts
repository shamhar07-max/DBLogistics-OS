import type pg from 'pg';
import { inTenant, type Q } from './db';

export interface DomainEvent { id: string; tenantId: string; topic: string; aggregateType: string; aggregateId: string; payload: Record<string, any>; correlationId?: string }
const SYSTEM = '00000000-0000-0000-0000-000000000000';

/** Exactly-once EFFECT: the effect and its processed-events row commit in the same tenant transaction. */
async function once(q: Q, tenantId: string, consumer: string, eventId: string): Promise<boolean> {
  const r = await q.q(`INSERT INTO automation.processed_events(tenant_id, consumer, event_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id`, [tenantId, consumer, eventId]);
  return r.length === 1;
}
const audit = (q: Q, e: DomainEvent, action: string, detail: object) =>
  q.q(`INSERT INTO platform.audit_events(tenant_id, actor_kind, correlation_id, action, entity_type, entity_id, detail) VALUES ($1,'system',$2,$3,$4,$5,$6::jsonb)`, [e.tenantId, e.correlationId ?? null, action, e.aggregateType, e.aggregateId, JSON.stringify(detail)]);
const task = (q: Q, e: DomainEvent, title: string) => q.q(`INSERT INTO collab.tasks(tenant_id, title, related_type, related_id, origin) VALUES ($1,$2,$3,$4,'automation')`, [e.tenantId, title, e.aggregateType, e.aggregateId]);

/** Built-in reactions (the Logistics pack's default automations). */
export async function builtIns(q: Q, e: DomainEvent) {
  if (e.topic === 'DeliveryCompleted' && (await once(q, e.tenantId, 'billing-readiness', e.id))) { await task(q, e, 'Delivery completed — verify POD and prepare customer invoice'); await audit(q, e, 'automation.billing_readiness', { jobId: e.payload.jobId }); }
  if (e.topic === 'QuoteAccepted' && (await once(q, e.tenantId, 'job-handover', e.id))) { await task(q, e, 'Quote accepted — create operational plan and book carrier'); }
  if (e.topic === 'SupplierBillPosted' && Number(e.payload.variance) !== 0 && (await once(q, e.tenantId, 'bill-variance', e.id))) { await task(q, e, `Supplier bill variance ${e.payload.variance} — review recovery from customer`); }
}

/** Tenant-defined workflows (versioned). One run per (definition, event): retries can never run a workflow twice. */
export async function runWorkflows(pool: pg.Pool, e: DomainEvent) {
  const defs = await pool.query(`SELECT id, key, version, definition FROM automation.workflow_definitions WHERE tenant_id=$1 AND status='active' AND trigger_topic=$2`, [e.tenantId, e.topic]);
  for (const d of defs.rows) {
    const created = await inTenant(pool, e.tenantId, async (q) => (await q.q(`INSERT INTO automation.workflow_runs(tenant_id, definition_id, trigger_event_id, state) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id`, [e.tenantId, d.id, e.id, JSON.stringify({ index: 0, event: { aggregateType: e.aggregateType, aggregateId: e.aggregateId } })])));
    if (created.length) await advanceRun(pool, created[0].id, e.tenantId);
  }
}
/** Executes actions until the end or a durable wait. State and timers live in PostgreSQL, not in Redis. */
export async function advanceRun(pool: pg.Pool, runId: string, tenantId: string) {
  await inTenant(pool, tenantId, async (q) => {
    const run = (await q.q(`SELECT r.*, d.definition FROM automation.workflow_runs r JOIN automation.workflow_definitions d ON d.id=r.definition_id WHERE r.id=$1 FOR UPDATE OF r`, [runId]))[0];
    if (!run || !['running', 'waiting'].includes(run.status)) return;
    const actions: any[] = run.definition.actions ?? []; let i = run.state.index ?? 0;
    const ev = { tenantId, aggregateType: run.state.event.aggregateType, aggregateId: run.state.event.aggregateId, id: String(run.trigger_event_id), topic: '', payload: {} } as DomainEvent;
    while (i < actions.length) {
      const a = actions[i];
      if (a.type === 'wait') { await q.q(`UPDATE automation.workflow_runs SET status='waiting', resume_at = now() + ($2 || ' seconds')::interval, state = jsonb_set(state, '{index}', to_jsonb($3::int)) WHERE id=$1`, [runId, String(a.seconds ?? 0), i + 1]); return; }
      if (a.type === 'create_task') await task(q, ev, a.title);
      else if (a.type === 'notify') await audit(q, ev, 'automation.notify', { channel: a.channel, template: a.template });   // channel adapters plug in here
      i++;
    }
    await q.q(`UPDATE automation.workflow_runs SET status='completed', finished_at=now(), state = jsonb_set(state, '{index}', to_jsonb($2::int)) WHERE id=$1`, [runId, i]);
  });
}
/** Timer poller: resumes due waits (survives restarts because timers are rows). */
export async function resumeDueRuns(pool: pg.Pool): Promise<number> {
  const due = (await pool.query(`SELECT id, tenant_id FROM automation.workflow_runs WHERE status='waiting' AND resume_at <= now() ORDER BY resume_at LIMIT 50`)).rows;
  for (const r of due) { await inTenant(pool, r.tenant_id, (q) => q.q(`UPDATE automation.workflow_runs SET status='running', resume_at=NULL WHERE id=$1`, [r.id])); await advanceRun(pool, r.id, r.tenant_id); }
  return due.length;
}

/** Inbound integration events → normalised domain effects. Unknown types are recorded as ignored, never silently dropped. */
export async function normalizeInbox(pool: pg.Pool, e: DomainEvent) {
  await inTenant(pool, e.tenantId, async (q) => {
    if (!(await once(q, e.tenantId, 'inbox-normalizer', e.id))) return;
    const ev = (await q.q(`SELECT * FROM integ.inbox_events WHERE id=$1`, [e.aggregateId]))[0]; if (!ev) return;
    const p = ev.payload;
    if (ev.event_type === 'tracking.update' && p.shipmentRef && p.code) {
      const s = (await q.q(`SELECT id FROM logistics.shipments WHERE ref=$1`, [p.shipmentRef]))[0];
      if (s) { await q.q(`INSERT INTO logistics.tracking_events(tenant_id, shipment_id, code, event_time, source, is_actual, external_event_id, detail) VALUES ($1,$2,$3,$4,'carrier',$5,$6,$7::jsonb) ON CONFLICT DO NOTHING`, [e.tenantId, s.id, p.code, p.occurredAt ?? ev.received_at, p.actual !== false, `${ev.provider}:${ev.external_event_id}`, JSON.stringify({ inboxEventId: ev.id })]); await q.q(`UPDATE integ.inbox_events SET status='processed', processed_at=now() WHERE id=$1`, [ev.id]); return; }
      await q.q(`UPDATE integ.inbox_events SET status='failed', error='shipment not found', processed_at=now() WHERE id=$1`, [ev.id]); return;
    }
    await q.q(`UPDATE integ.inbox_events SET status='ignored', processed_at=now() WHERE id=$1`, [ev.id]);
  });
}

/** Malware-scan port. Production wires ClamAV (clamd INSTREAM) behind this interface; the default checks the EICAR test signature. */
export interface ScanPort { scan(storageKey: string): Promise<'clean' | 'infected' | 'failed'> }
export async function scanDocument(pool: pg.Pool, scanner: ScanPort, e: DomainEvent) {
  if (e.payload.stage !== 'registered') return;
  await inTenant(pool, e.tenantId, async (q) => {
    if (!(await once(q, e.tenantId, 'doc-scan', e.id))) return;
    const v = (await q.q(`SELECT id, storage_key FROM platform.document_versions WHERE id=$1`, [e.payload.versionId]))[0]; if (!v) return;
    const status = await scanner.scan(v.storage_key);
    await q.q(`UPDATE platform.document_versions SET scan_status=$2 WHERE id=$1`, [v.id, status]);
    await audit(q, e, 'document.scanned', { status });
  });
}

export async function handleEvent(pool: pg.Pool, scanner: ScanPort, e: DomainEvent) {
  await inTenant(pool, e.tenantId, (q) => builtIns(q, e));
  await runWorkflows(pool, e);
  if (e.topic === 'IntegrationEventReceived') await normalizeInbox(pool, e);
  if (e.topic === 'DocumentApproved') await scanDocument(pool, scanner, e);
}
export const SYSTEM_USER = SYSTEM;
