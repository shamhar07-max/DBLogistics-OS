import { extractDocument, type ExtractionResult } from './extract/extract';
import type pg from 'pg';
import { conditionsHold, renderTemplate, WORKFLOW_LIMITS, type WorkflowEventContext } from '@dbl/contracts';
import { inTenant, type Q } from './db';
import { notifyCustomer } from './notify/queue';

export interface DomainEvent { id: string; tenantId: string; topic: string; aggregateType: string; aggregateId: string; payload: Record<string, any>; correlationId?: string }
const SYSTEM = '00000000-0000-0000-0000-000000000000';

/** Exactly-once EFFECT: the effect and its processed-events row commit in the same tenant transaction. */
async function once(q: Q, tenantId: string, consumer: string, eventId: string): Promise<boolean> {
  const r = await q.q(`INSERT INTO automation.processed_events(tenant_id, consumer, event_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id`, [tenantId, consumer, eventId]);
  return r.length === 1;
}
const audit = (q: Q, e: DomainEvent, action: string, detail: object) =>
  q.q(`INSERT INTO platform.audit_events(tenant_id, actor_kind, correlation_id, action, entity_type, entity_id, detail) VALUES ($1,'system',$2,$3,$4,$5,$6::jsonb)`, [e.tenantId, e.correlationId ?? null, action, e.aggregateType, e.aggregateId, JSON.stringify(detail)]);
const task = (q: Q, e: DomainEvent, title: string, dueInHours?: number) => q.q(`INSERT INTO collab.tasks(tenant_id, title, related_type, related_id, origin, due_at) VALUES ($1,$2,$3,$4,'automation', CASE WHEN $5::int IS NULL THEN NULL ELSE now() + ($5::int || ' hours')::interval END)`, [e.tenantId, title, e.aggregateType, e.aggregateId, dueInHours ?? null]);

/** Built-in reactions (the Logistics pack's default automations). */
export async function builtIns(q: Q, e: DomainEvent) {
  if (e.topic === 'DeliveryCompleted' && (await once(q, e.tenantId, 'billing-readiness', e.id))) { await task(q, e, 'Delivery completed — verify POD and prepare customer invoice'); await audit(q, e, 'automation.billing_readiness', { jobId: e.payload.jobId }); }
  if (e.topic === 'QuoteAccepted' && (await once(q, e.tenantId, 'job-handover', e.id))) { await task(q, e, 'Quote accepted — create operational plan and book carrier'); }
  if (e.topic === 'MessagePosted' && (await once(q, e.tenantId, 'message-posted', e.id))) {
    if (e.payload.direction === 'inbound') await task(q, e, `Customer message — reply in the conversation: “${String(e.payload.excerpt ?? '').slice(0, 80)}”`, 24);      // staff are told, never left to discover it
    else await notifyCustomer(q, { tenantId: e.tenantId, aggregateType: e.aggregateType, aggregateId: e.aggregateId, template: 'message_reply', vars: { excerpt: String(e.payload.excerpt ?? '') }, dedupeKey: `msg:${e.id}` });
  }
  if (e.topic === 'SupplierBillPosted' && Number(e.payload.variance) !== 0 && (await once(q, e.tenantId, 'bill-variance', e.id))) { await task(q, e, `Supplier bill variance ${e.payload.variance} — review recovery from customer`); }
}

/** Tenant-defined workflows (versioned). One run per (definition, event): retries can never run a workflow twice. */
export async function runWorkflows(pool: pg.Pool, e: DomainEvent) {
  const defs = await pool.query(`SELECT id, key, version, definition FROM automation.workflow_definitions WHERE tenant_id=$1 AND status='active' AND trigger_topic=$2`, [e.tenantId, e.topic]);
  const ctx: WorkflowEventContext = { topic: e.topic, aggregateType: e.aggregateType, aggregateId: e.aggregateId, payload: e.payload ?? {} };
  for (const d of defs.rows) {
    const holds = conditionsHold(d.definition.conditions, ctx);
    const state = { index: 0, event: ctx };
    const log = holds ? [] : [{ at: new Date().toISOString(), note: 'Conditions not met — workflow did not run' }];
    const created = await inTenant(pool, e.tenantId, async (q) => (await q.q(
      `INSERT INTO automation.workflow_runs(tenant_id, definition_id, trigger_event_id, state, status, finished_at, log) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
      [e.tenantId, d.id, e.id, JSON.stringify(state), holds ? 'running' : 'skipped', holds ? null : new Date().toISOString(), JSON.stringify(log)])));
    if (created.length && holds) await advanceRun(pool, created[0].id, e.tenantId);
  }
}
const errText = (err: unknown) => String((err as any)?.message ?? err).slice(0, 500);

/**
 * Executes actions until the end or a durable wait. State and timers live in PostgreSQL, not in Redis.
 * Every action runs inside one transaction with the state change: if anything throws, the whole step rolls back
 * (no half-created tasks) and the run is marked failed with the reason, ready for a manual retry from the same step.
 */
export async function advanceRun(pool: pg.Pool, runId: string, tenantId: string) {
  try {
    await inTenant(pool, tenantId, async (q) => {
      const run = (await q.q(`SELECT r.*, d.definition FROM automation.workflow_runs r JOIN automation.workflow_definitions d ON d.id=r.definition_id WHERE r.id=$1 FOR UPDATE OF r`, [runId]))[0];
      if (!run || !['running', 'waiting'].includes(run.status)) return;
      const actions: any[] = run.definition.actions ?? []; let i = run.state.index ?? 0; const log: any[] = [];
      const st = run.state.event ?? {};
      const ctx: WorkflowEventContext = { topic: st.topic ?? '', aggregateType: st.aggregateType ?? '', aggregateId: st.aggregateId ?? '', payload: st.payload ?? {} };
      const ev = { tenantId, aggregateType: ctx.aggregateType, aggregateId: ctx.aggregateId, id: String(run.trigger_event_id), topic: ctx.topic, payload: ctx.payload } as DomainEvent;
      const at = () => new Date().toISOString();
      while (i < actions.length) {
        const a = actions[i];
        if (a.type === 'wait') {
          const seconds = Math.min(Math.max(Number(a.seconds) || 0, 0), WORKFLOW_LIMITS.maxWaitSeconds); log.push({ at: at(), index: i, type: 'wait', note: `Waiting ${seconds} s` });
          await q.q(`UPDATE automation.workflow_runs SET status='waiting', resume_at = now() + ($2 || ' seconds')::interval, heartbeat_at=now(), last_error=NULL, state = jsonb_set(state, '{index}', to_jsonb($3::int)), log = log || $4::jsonb WHERE id=$1`, [runId, String(seconds), i + 1, JSON.stringify(log)]); return;
        }
        if (a.type === 'create_task') { const title = renderTemplate(String(a.title ?? ''), ctx).trim() || 'Workflow task'; await task(q, ev, title, a.dueInHours); log.push({ at: at(), index: i, type: a.type, note: `Task created: ${title}` }); }
        else if (a.type === 'notify') {
          await audit(q, ev, 'automation.notify', { channel: a.channel, template: a.template });
          if (a.channel === 'internal') log.push({ at: at(), index: i, type: a.type, note: `Internal notification recorded (${a.template})` });
          else {                                                           // real delivery: queued per eligible contact, sent by the sender loop with retries
            const vars: Record<string, string> = {}; for (const [k, val] of Object.entries(ctx.payload)) if (['string', 'number', 'boolean'].includes(typeof val)) vars[k] = String(val); if (ctx.payload.code) vars.milestone = String(ctx.payload.code).replace(/_/g, ' ');
            const r = await notifyCustomer(q, { tenantId, aggregateType: ctx.aggregateType, aggregateId: ctx.aggregateId, template: a.template, channel: a.channel, vars, dedupeKey: `wf:${runId}:${i}` });
            log.push({ at: at(), index: i, type: a.type, note: r.queued ? `${r.queued} ${a.channel} message(s) queued (${a.template})` : `No ${a.channel} message queued — no contact with ${a.channel === 'whatsapp' ? 'WhatsApp opt-in and a phone number' : 'an email address that has not opted out'}` });
          }
        }
        else throw new Error(`Unknown action type "${a.type}" at step ${i + 1}`);                  // never silently skip a step
        i++;
      }
      await q.q(`UPDATE automation.workflow_runs SET status='completed', finished_at=now(), heartbeat_at=now(), last_error=NULL, resume_at=NULL, state = jsonb_set(state, '{index}', to_jsonb($2::int)), log = log || $3::jsonb WHERE id=$1`, [runId, i, JSON.stringify(log)]);
    });
  } catch (err) {
    await inTenant(pool, tenantId, (q) => q.q(`UPDATE automation.workflow_runs SET status='failed', attempts = attempts + 1, last_error=$2, finished_at=now(), heartbeat_at=now(), resume_at=NULL, log = log || $3::jsonb WHERE id=$1 AND status IN ('running','waiting')`,
      [runId, errText(err), JSON.stringify([{ at: new Date().toISOString(), note: `Failed: ${errText(err)}` }])]));
  }
}
/**
 * Timer poller: resumes due waits and recovers runs orphaned by a crash (status 'running' with no heartbeat for 5 minutes).
 * Timers are rows, so this survives restarts. One failing run never blocks the others (advanceRun contains its own errors).
 */
export async function resumeDueRuns(pool: pg.Pool): Promise<number> {
  const due = (await pool.query(`SELECT id, tenant_id FROM automation.workflow_runs WHERE (status='waiting' AND resume_at <= now()) OR (status='running' AND heartbeat_at < now() - interval '5 minutes') ORDER BY COALESCE(resume_at, heartbeat_at) LIMIT 50`)).rows;
  for (const r of due) { await inTenant(pool, r.tenant_id, (q) => q.q(`UPDATE automation.workflow_runs SET status='running', resume_at=NULL, heartbeat_at=now() WHERE id=$1`, [r.id])); await advanceRun(pool, r.id, r.tenant_id); }
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
    if (ev.event_type === 'whatsapp.status') {                         // delivery receipts: never move a message backwards (read > delivered > sent)
      const rank = `CASE status WHEN 'queued' THEN 0 WHEN 'sending' THEN 0 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE -1 END`;
      if (p.status === 'failed') await q.q(`UPDATE integ.outbound_messages SET status='failed', last_error=$2 WHERE provider='whatsapp' AND provider_message_id=$1 AND status IN ('sent','sending','queued')`, [p.messageId, String(p.error ?? 'WhatsApp reported the message as failed').slice(0, 500)]);
      else if (['delivered', 'read'].includes(p.status)) await q.q(`UPDATE integ.outbound_messages SET status=$2, delivered_at = COALESCE(delivered_at, now()) WHERE provider='whatsapp' AND provider_message_id=$1 AND ${rank} < (CASE $2::text WHEN 'delivered' THEN 2 ELSE 3 END)`, [p.messageId, p.status]);
      await q.q(`UPDATE integ.inbox_events SET status='processed', processed_at=now() WHERE id=$1`, [ev.id]); return;
    }
    if (ev.event_type === 'whatsapp.message') {                        // a customer wrote to us on WhatsApp: file it on the party, tell staff
      const digits = String(p.from ?? '').replace(/\D/g, '');
      const c = digits ? (await q.q(`SELECT c.id, c.name, c.party_id FROM parties.contacts c WHERE regexp_replace(coalesce(c.phone,''), '\\D', '', 'g') = $1 LIMIT 1`, [digits]))[0] : null;
      if (!c) { await q.q(`UPDATE integ.inbox_events SET status='ignored', error='unknown sender', processed_at=now() WHERE id=$1`, [ev.id]); return; }
      await q.q(`INSERT INTO collab.messages(tenant_id, related_type, related_id, channel, direction, body, author_user_id, visibility) VALUES ($1,'party',$2,'whatsapp','inbound',$3,$4,'internal')`, [e.tenantId, c.party_id, String(p.text ?? '[non-text message]').slice(0, 4000), SYSTEM]);
      await q.q(`INSERT INTO collab.tasks(tenant_id, title, related_type, related_id, origin, due_at) VALUES ($1,$2,'party',$3,'automation', now() + interval '4 hours')`, [e.tenantId, `WhatsApp from ${c.name}: “${String(p.text ?? '').slice(0, 80)}”`, c.party_id]);
      await q.q(`UPDATE integ.inbox_events SET status='processed', processed_at=now() WHERE id=$1`, [ev.id]); return;
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

/** Text/field extraction for a freshly scanned CLEAN document version. Slow engines run outside any DB transaction; the result is stored once per version. */
export async function extractVersion(pool: pg.Pool, reader: { read(key: string): Promise<Buffer> }, e: DomainEvent) {
  if (e.payload.stage !== 'registered') return;
  const v = await inTenant(pool, e.tenantId, async (q) => (await q.q(`SELECT v.id, v.storage_key, v.content_type, v.scan_status, (SELECT 1 FROM platform.document_extractions x WHERE x.document_version_id = v.id) AS done FROM platform.document_versions v WHERE v.id=$1`, [e.payload.versionId]))[0]);
  if (!v || v.scan_status !== 'clean' || v.done) return;               // never read bytes that did not pass the scan
  let r: ExtractionResult;
  try { r = await extractDocument(await reader.read(v.storage_key), v.content_type); } catch (err) { r = { status: 'failed', engine: 'reader', error: (err as Error).message.slice(0, 500) }; }
  await inTenant(pool, e.tenantId, async (q) => {
    await q.q(`INSERT INTO platform.document_extractions(tenant_id, document_version_id, engine, status, page_count, text, fields, confidence, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id, document_version_id) DO NOTHING`,
      [e.tenantId, v.id, r.engine, r.status, r.pageCount ?? null, r.text?.replace(/\u0000/g, '') ?? null, JSON.stringify(r.fields ?? {}), r.confidence ?? null, r.error ?? null]);
    await audit(q, e, 'document.extracted', { status: r.status, engine: r.engine });
  });
}

export async function handleEvent(pool: pg.Pool, scanner: ScanPort, e: DomainEvent, reader?: { read(key: string): Promise<Buffer> }) {
  await inTenant(pool, e.tenantId, (q) => builtIns(q, e));
  await runWorkflows(pool, e);
  if (e.topic === 'IntegrationEventReceived') await normalizeInbox(pool, e);
  if (e.topic === 'DocumentApproved') { await scanDocument(pool, scanner, e); if (reader) await extractVersion(pool, reader, e); }
}
export const SYSTEM_USER = SYSTEM;
