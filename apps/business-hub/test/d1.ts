import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import type { D1, D1Stmt } from '../src/types';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
/** A D1-shaped adapter over node:sqlite so the Worker runs unchanged in tests. */
export function memoryD1(): D1 {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  const stmt = (sql: string, args: unknown[] = []): D1Stmt => ({
    bind: (...v) => stmt(sql, v),
    first: async <T,>() => ((db.prepare(sql).get(...(args as any[])) as T | undefined) ?? null),
    all: async <T,>() => ({ results: db.prepare(sql).all(...(args as any[])) as T[], success: true }),
    run: async () => { db.prepare(sql).run(...(args as any[])); return { results: [], success: true }; },
  });
  return { prepare: (sql) => stmt(sql), batch: async (ss) => { db.exec('BEGIN'); try { for (const s of ss) await s.run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return ss.map(() => ({ results: [], success: true })); } };
}
