import type pg from 'pg';
import type { Queue } from 'bullmq';

export const EVENTS_QUEUE = 'domain-events';
/**
 * Transactional-outbox relay. Claims unpublished rows with SKIP LOCKED (many relays can run), enqueues each with a
 * deterministic jobId (broker-level dedupe), then marks published. Delivery is at-least-once; consumers are idempotent.
 */
export async function relayOutbox(pool: pg.Pool, queue: Queue, batch = 100): Promise<number> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const rows = (await c.query(`SELECT id, tenant_id, topic, aggregate_type, aggregate_id, payload, correlation_id, occurred_at FROM platform.outbox WHERE published_at IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [batch])).rows;
    for (const r of rows) {
      try {
        await queue.add(r.topic, { id: String(r.id), tenantId: r.tenant_id, topic: r.topic, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id, payload: r.payload, correlationId: r.correlation_id }, { jobId: `outbox-${r.id}`, attempts: 5, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: 1000, removeOnFail: false });
        await c.query(`UPDATE platform.outbox SET published_at = now() WHERE id=$1`, [r.id]);
      } catch (e: any) { await c.query(`UPDATE platform.outbox SET attempts = attempts + 1, last_error=$2 WHERE id=$1`, [r.id, String(e?.message).slice(0, 500)]); }
    }
    await c.query('COMMIT'); return rows.length;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
