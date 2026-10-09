# Enterprise work control and governance

Open **Today → Work control** for department queues, workload, handovers, templates and calendars. Open **Today → Knowledge & risk** for controlled knowledge and the risk register. **Administration → Access control / Operations health** exposes access changes and tenant operational counters.

## Identity and operations

Tenant-wide internal administrators can suspend, revoke or reactivate another membership, replace scoped role grants and revoke previously issued access tokens. Every request re-resolves active membership and current grants; a per-membership issuance cutoff rejects older tokens, including tokens without an issuance time after revocation. A new token must be issued after the cutoff second. Status and grant changes record a reason and audit evidence, use idempotency/version controls, and retain an active tenant-wide administrator. External memberships require matching portal role templates. Branch grants require their matching legal entity.

The gateway checks current API membership before returning browser identity and clears revoked/expired cookies. Provider outages return unavailable instead of trusting stale identity. This is tenant access revocation, not an OIDC-provider logout implementation. Device session inventories, privileged-action reauthentication and refresh-token rotation remain outstanding.

`GET /api/v1/health` reports API liveness. `GET /api/v1/health/ready` probes the database and returns HTTP 503 on failure. Tenant-wide administration can read pending outbox count/age, failed workflows/messages, pending scans and active membership counts. These counters do not establish Redis/storage/provider readiness, exported telemetry, capacity, or alerting.

## Calendars, templates and work queues

Calendars have immutable versions, a validated timezone, ISO weekdays, working-day start/end minutes and explicit holidays. SLA durations count time inside working intervals, including timezone offset changes; weekends/holidays are skipped. Calendars use one interval per day; split shifts, overnight intervals and ambiguous daylight-saving boundary policies need further configuration work.

Templates have immutable versions and up to 30 steps. Step keys are unique, dependencies refer to earlier steps, and each step has a department, business-minute SLA and complexity. Starting a template atomically creates one work instance. Dependent steps remain blocked until all their dependencies complete; their SLA starts on release. Cancelling a dependency keeps downstream steps blocked, requiring an explicit operator decision instead of silently completing them.

Work items carry entity and optional branch scope. Read, detail, mutation, workload, configuration and handover services apply current grants; forced RLS and composite tenant relationships also isolate database records. Active internal assignees need work permission in the destination scope. There are explicit start/pause/resume/complete/cancel commands, record versions, required notes, audit history and transactional events. Pause preserves remaining business time; resume calculates a new deadline. Closed work cannot be reopened or modified by raw SQL.

The worker records one breach per work item, atomically with audit and outbox, using tenant context and restricted update-column privileges. Concurrent timers and the manual check skip/serialize locked rows. State changes also retain a breach if an overdue item is paused or completed before the timer processes it. Breach events are not a claim that an email or WhatsApp escalation was delivered.

Capacity profiles record scoped department points and availability. Workload shows outstanding items, complexity points, overdue counts and utilization; closed work is excluded. It supports manager-reviewed reassignment, not automatic skill or staffing optimization. Full employee availability calendars and certified-skill routing remain outstanding.

Handovers include selected outstanding work assigned to the sender, a named recipient and instructions. Preparing one does not transfer responsibility. Only the named recipient can acknowledge; all items must remain at the captured versions and within both users' current scope. Assignment changes and acknowledgement commit together. Current access filters handover items and redacts instructions if any items become inaccessible. Full shift rosters, linked communications, reminders and unacknowledged-handover escalation remain outstanding.

## Controlled knowledge

Knowledge supports SOPs, policies, manuals, customer SOPs, carrier instructions, customs guides and training. Drafts preserve content, change note, author, revision and database-generated SHA-256. Amendments create a new revision. Independent authorized publication retains the review note; old drafts cannot supersede a newer revision. Published content is immutable. Staff acknowledgements bind the specific revision and hash, so an acknowledgement of an old revision does not acknowledge its replacement.

Search, draft visibility and actions apply entity/branch grants; external users cannot access these internal records. This is controlled knowledge publication, not automatic customer/lane SOP enforcement. Mandatory readers, reminders, attachments, approvals/delegation tiers and operational policy acceptance remain outstanding.

## Formal risk register

Financial, operational, customer, carrier, compliance, security and legal risks have a scoped record, an active authorized owner, inherent likelihood/impact, residual scoring, mitigation and review date. Scores use an explicit 1–5 × 1–5 matrix; the application does not infer an organization's risk appetite or acceptance thresholds.

An independent authorized reviewer records mitigation, residual scoring, outcome, next review date and evidence. Authors and owners cannot review their own risks. Closure requires a clean approved document attached to that risk. Reviews are append-only; original definitions and closed risks are immutable. Risk evidence can be uploaded and approved from the risk detail using existing document permissions.

The register does not yet include configurable appetite/authority tiers, reassignment/amendment workflows, automatic review notifications or linked financial limits. Customer-specific policy and regulatory acceptance remain required.

## Scope boundaries

These controls improve areas 2–3, 77–80, 83, 106, 113, 128 and 141 of the 147-area ledger. They do not complete unrelated finance, transport, customs, HR, mobile or provider integrations. Existing modules outside these new workflows still require cross-module entity/branch and export-scope hardening.
