import pg from 'pg';
export type Q = { q<T = any>(sql: string, p?: unknown[]): Promise<T[]> };
export const makePool = (url = process.env.WORKER_DATABASE_URL ?? 'postgres://dbl_worker:dbl_worker_dev@localhost:54329/dbl') => new pg.Pool({ connectionString: url, max: 5 });
/** Transaction bound to ONE tenant: all domain access by the worker is tenant-scoped through RLS, exactly like the API. */
export async function inTenant<T>(pool: pg.Pool, tenantId: string, fn: (q: Q) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
    const out = await fn({ q: async (s, p) => (await c.query(s, p as any[])).rows }); await c.query('COMMIT'); return out;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
