# Recovery plan

**Planning targets (to be agreed with the customer and *proven by drills*): RPO ≤ 15 min, RTO ≤ 4 h.** Nothing here claims they are met in production.

## What is backed up
PostgreSQL (continuous WAL archiving + daily base backup → PITR) · object storage (versioning, MFA-delete, cross-region copy) · identity-provider config (realm export) · infrastructure state/config (Terraform) · KMS key policies (deletion protection). Redis is *not* a system of record: queue contents are re-derivable from `platform.outbox` (unpublished rows) and `automation.workflow_runs`.

## Restore procedure
1. Restore a base backup + WAL to the target time into a **new** instance.
2. `psql -f database/invariants.sql` — every row must show `violations = 0` (journals balance, custody ledger equals lot balances, allocations equal payments/invoices, no release without authoriser/evidence, …).
3. Compare counts of journals / custody movements / audit events with the last known monitoring values.
4. Verify object-store references: sample `platform.document_versions.storage_key` heads.
5. Re-enable workers; unpublished outbox rows republish (consumers are idempotent); inspect `integ.inbox_events` with `status='received'`.
6. Re-run provider reconciliations (bookings with `outcome_unknown`, e-invoice submissions).

## Drill evidence in this repo
`apps/api/test/risks.test.ts › a restored backup satisfies every business invariant` performs steps 1–2 locally (`pg_dump -Fc | pg_restore`) and asserts live ⇄ restored invariants and row counts are identical.
