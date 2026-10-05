/** Local-only database prep (idempotent): creates the `dbl` database owned by the migrator role and the pgcrypto extension.
 *  Works against the docker-compose Postgres (postgres/postgres) and the throw-away pg-local.sh cluster (trust auth). */
import pg from 'pg';
const admin = process.env.ADMIN_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/postgres';
const a = new pg.Client({ connectionString: admin }); await a.connect();
if (!(await a.query(`SELECT 1 FROM pg_database WHERE datname='dbl'`)).rowCount) await a.query('CREATE DATABASE dbl OWNER dbl_migrator');
await a.end();
const d = new pg.Client({ connectionString: admin.replace(/\/[^/?]+(\?|$)/, '/dbl$1') }); await d.connect();
await d.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await d.end();
console.log('database ready');
