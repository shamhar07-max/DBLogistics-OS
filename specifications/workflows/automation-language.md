# Automation workflows — language and execution semantics

Source of truth: `packages/contracts/src/workflow.ts` (validation, conditions, templates and dry-run are **one implementation** used by the API, the worker and the staff designer).

## Definition
```json
{ "conditions": [{ "field": "payload.amount", "op": "gt", "value": 100 }],
  "actions": [ { "type": "create_task", "title": "Chase POD for {{payload.jobId}}", "dueInHours": 24 },
               { "type": "wait", "seconds": 7200 },
               { "type": "notify", "channel": "internal", "template": "pod-reminder" } ] }
```
* **Trigger** — one event topic from the event catalog (`DeliveryCompleted`, `InvoicePosted`, …).
* **Conditions** (all must hold, ≤ 5): `field` is `payload.<name>[.<name>…]`, `aggregateType`, `aggregateId` or `topic` — nothing else is addressable. Operators: `eq ne gt gte lt lte contains exists`. Numbers compare numerically when both sides are numeric.
* **Actions** (1–20, in order): `create_task` (title template, optional due date), `notify` (channel + template; audited, channel adapters plug in), `wait` (1 s – 30 days; a workflow cannot end with a wait).
* **Templates**: `{{payload.jobId}}` etc.; unknown paths render empty, never throw.

## Lifecycle
`draft → active → retired`. A published definition is **immutable** (DB trigger); changing it means publishing a new version. Activating a draft retires the previous active version of the same key in the same transaction; a partial unique index guarantees at most one active version per key. Instances already running finish on the version they started on.

## Execution (worker)
* One run per (definition, triggering event) — duplicate deliveries cannot start a workflow twice. If conditions are not met the run is recorded as `skipped` with the reason.
* The trigger payload is stored with the run, so templates and diagnostics see what the workflow saw.
* Each advance executes steps in **one transaction** together with the state change. If a step throws (including an unknown action type — never silently skipped), the transaction rolls back (no half-created tasks), the run becomes `failed` with `last_error`, `attempts + 1` and a log entry.
* **Retry** puts a failed run back on the durable timer; it resumes from the last committed step. **Cancel** is allowed for running/waiting/failed runs.
* Waits are rows (`resume_at`), not Redis timers. The poller resumes due waits and recovers runs orphaned by a crash (`running` with no heartbeat for 5 minutes). One failing run never blocks the others.
* Every create/activate/retire/cancel/retry is audited.
