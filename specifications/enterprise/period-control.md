# Reviewed accounting period controls

Implemented in migration 022, the finance period service, shared contracts and the Money screen. Accountants request changes; a different finance manager or owner decides them. Permissions are limited to tenant-wide or matching legal-entity grants; branch-only grants do not authorize an entity-wide close.

An ended open period can be proposed for close only with balanced, nonempty journals and no unposted invoice blockers. The request records exact account movement by currency, journal identities and draft invoice state in a SHA-256 reconciliation snapshot. Approval requires an unchanged snapshot and period version. A changed ledger requires rejection and a new request. Reopening uses the same independent decision path and requires a reason.

The database prohibits overlapping periods, immutable request changes, unreviewed application period status changes, additional lines on committed journals, and journal creation in a closed period. Posting takes a shared period lock; period decisions take an exclusive lock. Audit and outbox records accompany decisions in the same transaction. HTTP commands use idempotency and optimistic concurrency.

Five API tests cover exact movement, premature close, overlap, requester self-approval, closed-period posting, stale snapshots, reopen and scoped permissions. The staff browser scenario exercises accountant proposal and independent finance approval.

These balances represent period movement, not a full opening-to-closing trial balance. Bank reconciliation, close checklists, accrual policy approval, reversals, statutory reports, fiscal year governance, FX revaluation and group consolidation are not supplied by this workflow. They remain separate acceptance requirements in the 147-area ledger.
