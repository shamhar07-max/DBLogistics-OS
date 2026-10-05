import pg from 'pg';
import { migrate } from '../../../database/migrate';

/** Creates a fresh database, runs ALL migrations as the migration role, and leaves runtime-role access to the tests. */
export default async function setup() {
  const admin = new pg.Client({ connectionString: process.env.TEST_ADMIN_URL ?? 'postgres://postgres@localhost:54329/postgres' });
  await admin.connect();
  await admin.query('DROP DATABASE IF EXISTS dbl_test WITH (FORCE)');
  await admin.query('CREATE DATABASE dbl_test OWNER dbl_migrator');
  await admin.end();
  const su = new pg.Client({ connectionString: 'postgres://postgres@localhost:54329/dbl_test' }); await su.connect();
  await su.query('CREATE EXTENSION IF NOT EXISTS pgcrypto'); await su.end();
  await migrate('postgres://dbl_migrator:dbl_migrator_dev@localhost:54329/dbl_test');
}
