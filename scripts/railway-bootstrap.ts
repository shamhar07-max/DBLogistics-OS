/** One-shot production bootstrap (idempotent), run as the `bootstrap` Railway service:
 *  1. as the cluster superuser: least-privilege roles (migrator / app / worker), the `dbl` and `keycloak` databases, pgcrypto
 *  2. as the migrator: reviewed SQL migrations
 *  3. as the app role: provision the first tenant with its owner (the Keycloak user id is the OIDC subject)
 *  Then it idles, so the platform does not restart it in a loop. */
import pg from 'pg';
import { migrate } from '../database/migrate';
import { provisionTenant } from '../apps/api/src/provisioning';

const need = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
const admin = need('ADMIN_DATABASE_URL'); const host = need('PGHOST_PRIVATE'); const port = process.env.PGPORT_PRIVATE ?? '5432';
const pw = { migrator: need('DBL_MIGRATOR_PASSWORD'), app: need('DBL_APP_PASSWORD'), worker: need('DBL_WORKER_PASSWORD'), keycloak: need('KC_DB_PASSWORD') };
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const url = (u: string, p: string, db: string) => `postgres://${u}:${encodeURIComponent(p)}@${host}:${port}/${db}`;

async function main() {
  const a = new pg.Client({ connectionString: admin }); await a.connect();
  const role = async (name: string, password: string, extra: string) => {
    const ex = (await a.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [name])).rowCount;
    await a.query(`${ex ? 'ALTER' : 'CREATE'} ROLE ${name} LOGIN PASSWORD ${lit(password)} ${extra}`);
  };
  await role('dbl_migrator', pw.migrator, 'NOSUPERUSER NOBYPASSRLS CREATEROLE');
  await role('dbl_app', pw.app, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
  await role('dbl_worker', pw.worker, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
  await role('keycloak', pw.keycloak, 'NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
  for (const [db, owner] of [['dbl', 'dbl_migrator'], ['keycloak', 'keycloak']] as const)
    if (!(await a.query('SELECT 1 FROM pg_database WHERE datname=$1', [db])).rowCount) await a.query(`CREATE DATABASE ${db} OWNER ${owner}`);
  await a.end();
  const d = new pg.Client({ connectionString: admin.replace(/\/[^/?]+(\?|$)/, '/dbl$1') }); await d.connect();
  await d.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await d.end();
  console.log('migrations:', (await migrate(url('dbl_migrator', pw.migrator, 'dbl'))).join(', ') || 'up to date');

  const slug = process.env.TENANT_SLUG; const subject = process.env.OWNER_SUBJECT;
  if (slug && subject) {
    const app = new pg.Pool({ connectionString: url('dbl_app', pw.app, 'dbl') });
    try { const t = await provisionTenant(app, { slug, name: process.env.TENANT_NAME ?? slug, ownerSubject: subject, ownerEmail: process.env.OWNER_EMAIL, currency: process.env.TENANT_CURRENCY ?? 'AED' }); console.log('tenant provisioned', t.tenantId); }
    catch (e) { if (/duplicate key|already exists/i.test((e as Error).message)) console.log('tenant already provisioned'); else throw e; }
    await app.end();
  }
  console.log('bootstrap complete');
  await new Promise(() => setInterval(() => {}, 1 << 30));
}
main().catch((e) => { console.error(e); process.exit(1); });
