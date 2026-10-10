import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import pg from 'pg';
import { CONFIG, type Config } from './config';
import { DomainError, mapPgError } from './errors';
import type { RequestContext } from './context';

export interface Tx {
  q<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T = any>(sql: string, params?: unknown[]): Promise<T>;
  maybe<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
}
const wrap = (c: pg.PoolClient): Tx => ({
  q: async (s, p) => (await c.query(s, p as any[])).rows,
  one: async (s, p) => { const r = (await c.query(s, p as any[])).rows; if (r.length !== 1) throw new DomainError('NOT_FOUND', 'Record not found.'); return r[0]; },
  maybe: async (s, p) => (await c.query(s, p as any[])).rows[0],
});
const RETRYABLE = new Set(['40001', '40P01']);

@Injectable()
export class Db implements OnModuleInit, OnModuleDestroy {
  readonly pool: pg.Pool;
  constructor(@Inject(CONFIG) cfg: Config) { this.pool = new pg.Pool({ connectionString: cfg.DATABASE_URL, max: cfg.RAILWAY_FREE_PILOT ? Math.min(cfg.DB_POOL_MAX, 2) : cfg.DB_POOL_MAX, idleTimeoutMillis:10000, connectionTimeoutMillis:5000 }); }

  /** Refuse to run with a role that can bypass row-level security (superuser / BYPASSRLS). */
  async onModuleInit() {
    const r = await this.pool.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
    if (r.rows[0]?.rolsuper || r.rows[0]?.rolbypassrls) throw new Error('Runtime database role must not be SUPERUSER or BYPASSRLS');
  }
  async onModuleDestroy() { await this.pool.end(); }

  /** Identity lookups before a tenant is selected (memberships are readable by their own user). */
  async asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
      const out = await fn(wrap(c)); await c.query('COMMIT'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw mapPgError(e); } finally { c.release(); }
  }
  async unscoped<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> { const c = await this.pool.connect(); try { return await fn(c); } finally { c.release(); } }

  /**
   * Unit of work: ONE transaction with tenant context set, optional atomic idempotency, bounded retry on
   * serialization failures / deadlocks. Business effect + audit + outbox + idempotency record commit together.
   */
  async run<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>, opts: { isolation?: 'read committed' | 'repeatable read' | 'serializable' } = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const c = await this.pool.connect();
      try {
        await c.query(`BEGIN ISOLATION LEVEL ${opts.isolation ?? 'read committed'}`);
        await c.query(`SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`, [ctx.tenantId, ctx.userId]);
        const tx = wrap(c);
        if (ctx.idem) {
          const ins = await c.query(
            `INSERT INTO platform.idempotency_keys(tenant_id, user_id, operation, key, request_hash) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING key`,
            [ctx.tenantId, ctx.userId, ctx.idem.operation, ctx.idem.key, ctx.idem.hash]);
          if (ins.rowCount === 0) {
            const prev = (await c.query(`SELECT request_hash, response_body FROM platform.idempotency_keys WHERE tenant_id=$1 AND user_id=$2 AND operation=$3 AND key=$4`,
              [ctx.tenantId, ctx.userId, ctx.idem.operation, ctx.idem.key])).rows[0];
            await c.query('ROLLBACK');
            if (prev.request_hash !== ctx.idem.hash) throw new DomainError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request.');
            return prev.response_body as T;
          }
        }
        const out = await fn(tx);
        if (ctx.idem) await c.query(`UPDATE platform.idempotency_keys SET status_code=200, response_body=$5::jsonb WHERE tenant_id=$1 AND user_id=$2 AND operation=$3 AND key=$4`,
          [ctx.tenantId, ctx.userId, ctx.idem.operation, ctx.idem.key, JSON.stringify(out ?? null)]);
        await c.query('COMMIT');
        return out;
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => {});
        if (RETRYABLE.has(e?.code) && attempt < 3) continue;
        throw mapPgError(e);
      } finally { c.release(); }
    }
  }
}

export const audit = (tx: Tx, ctx: RequestContext, action: string, entityType: string, entityId: string, detail: Record<string, unknown> = {}) =>
  tx.q(`INSERT INTO platform.audit_events(tenant_id, actor_user_id, actor_kind, request_id, correlation_id, action, entity_type, entity_id, detail) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8::jsonb)`,
    [ctx.tenantId, ctx.userId, ctx.actorKind ?? 'user', ctx.requestId, action, entityType, entityId, JSON.stringify(detail)]);
export const emit = (tx: Tx, ctx: RequestContext, topic: string, aggregateType: string, aggregateId: string, payload: Record<string, unknown> = {}) =>
  tx.q(`INSERT INTO platform.outbox(tenant_id, topic, aggregate_type, aggregate_id, payload, correlation_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
    [ctx.tenantId, topic, aggregateType, aggregateId, JSON.stringify(payload), ctx.requestId]);
