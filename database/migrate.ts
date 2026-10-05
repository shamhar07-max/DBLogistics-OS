/* Plain-SQL migration runner. Runs files in database/migrations in order inside one transaction each.
   Uses the MIGRATION role (owner of schemas) — never the runtime role. */
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export async function migrate(url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://dbl_migrator:dbl_migrator_dev@localhost:54329/dbl') {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map((await c.query('SELECT name, sha256 FROM public.schema_migrations')).rows.map((r) => [r.name, r.sha256]));
    const applied: string[] = [];
    for (const f of files) {
      const sql = readFileSync(join(dir, f), 'utf8');
      const sha = createHash('sha256').update(sql).digest('hex');
      if (done.has(f)) {
        if (done.get(f) !== sha) throw new Error(`Migration ${f} was modified after being applied — add a new migration instead.`);
        continue;
      }
      await c.query('BEGIN');
      try { await c.query(sql); await c.query('INSERT INTO public.schema_migrations(name, sha256) VALUES ($1,$2)', [f, sha]); await c.query('COMMIT'); applied.push(f); }
      catch (e) { await c.query('ROLLBACK'); throw new Error(`Migration ${f} failed: ${(e as Error).message}`); }
    }
    return applied;
  } finally { await c.end(); }
}
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  migrate().then((a) => console.log(a.length ? `applied: ${a.join(', ')}` : 'up to date')).catch((e) => { console.error(e.message); process.exit(1); });
}
