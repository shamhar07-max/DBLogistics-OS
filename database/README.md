# Database

* `migrations/*.sql` — reviewed, forward-only, hash-checked (a modified applied file aborts the runner). Runs as `dbl_migrator`; the API runs as `dbl_app` (no superuser, no BYPASSRLS), the worker as `dbl_worker`.
* `invariants.sql` — business invariants; run in CI, after migrations, and after every restore.
* RLS policies are generated from the catalog in `008_rls_grants.sql`; a test asserts no `tenant_id` table escapes it.
* Local: `infrastructure/local/pg-local.sh start` (no Docker needed) or `docker compose up postgres`.
