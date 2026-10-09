# Enterprise assessment and delivery plan

DBLogistics-OS is the implementation repository. ElvoraLogisticsOS is a feature and workflow reference, not a replacement architecture. This review covers both repository structures, manifests, CI, feature catalogues, database models, authentication/authorization paths, workflow controls, recovery instructions, and representative acceptance suites. It is not a claim that every source line or every production integration has been independently verified.

The complete scope index is [coverage.md](coverage.md), with 147 areas and machine-readable candidate evidence in [coverage.json](coverage.json). Areas remain partial until their full operational requirements and acceptance gates are satisfied. A table, endpoint or successful mock test is not a complete business feature.

## What the two repositories actually provide

| Concern | DBLogistics-OS | Elvora reference | Enterprise decision |
|---|---|---|---|
| Architecture | NestJS domain modules, shared contracts, separate worker and two web apps | Fastify, shared entity definitions driving schema/API/forms; one React app | Keep DBLogistics module boundaries and typed contracts. Borrow workflow requirements rather than copying the generic CRUD engine. |
| Database | PostgreSQL composite tenant foreign keys, forced RLS, distinct application/migration/worker roles | SQLite or PostgreSQL worker-thread bridge; production/demo separation | Keep database-enforced tenant isolation. Elvora's synchronous bridge blocks the main event loop per query and requires measured concurrency/latency evaluation before enterprise use. |
| Permissions | Membership grants carry entity and branch metadata; services implement individual checks | Module/action permissions and party-scoped customer access | Tenant isolation alone does not enforce branch or field permissions. Validate every read, mutation, export, search, report and AI tool against scope. |
| Finance | Decimal-string contract, PostgreSQL numeric amounts, balanced immutable journals; one currency per job | Integer cents, posting/FX/banking/year-end foundations | Preserve exact money and posting invariants. Add FX, reversals, accrual policies, WIP, periods and reconciliation as explicit domain commands with accounting acceptance. |
| Operations | Evidence-gated delivery, authority customs release, custody ledger and independent approval | Broader equipment, deposits, original-document custody, vendor hire and closure controls | Port the requirements with composite tenant relationships, evidence checks and concurrency tests; do not port only the screens. |
| Automation | Transactional outbox, BullMQ consumers and durable workflows | Durable work rules, handovers, queues and workflow acceptance checks | Extend the outbox-based worker with working calendars, human approval steps, escalation and dead-letter ownership. |
| Communication | Real SMTP and WhatsApp adapters tested with stand-ins, consent and retries | Mailbox connections, private drafts, AI writing and channel integrations | Add private inbound threading and accountable inbox assignment. Provider acceptance and recipient delivery remain distinct. |
| Documents | Immutable versions, private storage, scan gates, OCR suggestions, branded PDFs | BL/AWB controls, custody, OCR review and document matching | Add controlled originals, retention and revision distribution. Live antivirus signatures and storage recovery require deployment evidence. |
| AI | Permission-governed tools; no model orchestration | Model connection and AI employee/control foundations | Model access must inherit caller scope, cite evidence, respect budgets and require human approval for risky decisions. |
| Verification | Real PostgreSQL/Redis tests and browser suites | SQLite/PostgreSQL CI matrix and broad domain/API suites | Maintain contract conformance, negative authorization tests, recovery drills, browser workflows and reproducible build evidence. |

## Concrete findings and remaining risks

1. **Read scope needs a cross-module review.** `apps/api/src/platform/context.ts` checks legal entity only when explicitly supplied and does not apply branch restrictions. Existing commercial list queries do not filter legal entity. This is a same-tenant authorization gap; RLS protects tenants but does not resolve it. The new procurement workflow independently filters grants and refuses branch-only grants because RFQs have no branch field. This does not fix all existing modules.
2. **Session controls now revoke tenant access.** Membership lifecycle, issued-token cutoffs, role grant replacement and gateway identity revalidation are implemented. Device session inventories, provider logout, refresh rotation, privileged-action reauthentication and OIDC acceptance remain pending.
3. **Local health controls are implemented.** API liveness, database readiness (503 on failure) and scoped tenant queue counters now exist. Redis/storage/provider readiness, exported telemetry, capacity evidence and service-level alerts remain pending.
4. **The existing status document is stale in places.** It still describes some messaging/extraction capabilities as missing although code and tests exist. Use current source/test evidence, and reconcile each claim before treating the document as a release checklist.
5. **Finance coverage is deliberately bounded.** Single-currency jobs and verified postings are a strong foundation; they do not establish multicurrency valuation, group consolidation, statutory returns or full payroll accounting.
6. **Mock integrations are not live acceptance.** Carrier bookings, customs, UAE e-invoicing, WPS/banks, EDI partners and messaging require supported contracts, secure credentials, sandbox verification and reconciled outcomes. Do not label a generic adapter or XML export as regulatory certification.
7. **Recovery is local evidence.** The PostgreSQL dump/restore drill verifies business invariants. Production WAL/object-store restoration, encryption-key recovery, measured RPO/RTO and failover remain acceptance work.
8. **Mobile is a foundation.** Offline queue logic is tested; the driver/warehouse application and operational device workflow are not complete.
9. **Browser validation:** the ambiguous attention selector now uses the exact heading. All 33 staff scenarios passed before the new period scenario. Fresh portal fixtures are required because acceptance and delivery tests consume quotation and trip state.

## Implemented in this delivery: carrier rate procurement

[Workflow and API guide](rate-procurement.md). This introduces real migrations, six contract-bound API operations, a staff workspace, independently approved awards and approved-rate publication. It is a complete local procurement slice, not completion of all 147 enterprise areas. Supplier email distribution, external response portals, FX comparison, booking submission, cancellation and configurable approval tiers remain explicitly outside this slice.

## Enterprise controls added in the next delivery

[Work control and governance guide](work-control.md) documents membership/token revocation, scoped role grant management, health counters, immutable business calendars and dependency templates, paused SLA deadlines, department queues, capacity, acknowledged handover, controlled knowledge and evidence-gated risk review. These are implemented local workflows; they do not complete all 147 areas.

## Validation evidence for this delivery

The latest regression passed module boundaries, all workspace type checks and 139 automated tests; one optional live ClamAV test was skipped. All 33 staff and 13 partner portal browser scenarios passed. Portal scenarios ran with a fresh tenant because quotation acceptance and delivery change fixture state. The independent accounting-period browser scenario also passed, bringing the verified browser total to 47. The final production workspace build also passed. See [local validation evidence](validation.md).

The Elvora reference passed type checking, its production build and the eight selected suites: auth-security, enterprise-controls, workflow-controls, work-controls, enterprise-modules, cargo-docs, deposits and OCR. Other reference suites and live provider/regulatory acceptance were not rerun. These results validate the reviewed local foundations, not complete enterprise readiness.

## Delivery sequence and acceptance gates

| Stage | Deliverables | Acceptance gate |
|---|---|---|
| 1: Enterprise controls | Cross-module entity/branch/field/export scopes, session/device revocation, authority matrices, audit retention, readiness and telemetry | Negative tests for every access surface; independent approval and revocation tests; operational dashboards and measured failure behavior. |
| 2: Commercial to execution | Customer/vendor onboarding, tariffs/RFQs, margin controls, booking/cut-offs, master/house consolidation, container free-time and deposits, BL/AWB and original custody | Complete enquiry-to-delivery scenarios, latest-valid-contract checks, allocation/return invariants and supported carrier acceptance. |
| 3: Warehouse and finance | Putaway/picking/counts/billing, procurement matching, accruals/WIP, credit exposure, bank reconciliation, FX, fiscal close, assets and consolidation | Stock/custody reconciliation, balanced journal/reversal/period tests and finance-owner sign-off. |
| 4: Work, communication and partners | SOPs, SLA calendars, workload/handovers, inbound email/WhatsApp, customer/agent/vendor portals, notification delivery and document retention | Scoped partner scenarios, interruption/retry drills, opt-in/template checks and complete evidence trails. |
| 5: People, quality and intelligence | HR/payroll/WPS/EOSB, training, CAPA/HSE/risk, governed BI/report builder, sourced AI assistance | Accepted payroll calculations/provider files, competency gates, accountable corrective actions, reconciled metrics and AI permission/budget tests. |
| 6: Production and mobile | Offline driver/warehouse workflows, migration tooling, live integrations, load tests, recovery/failover and release promotion | Device/conflict/POD tests, trial migration reconciliation, contracted provider acceptance, measured capacity and witnessed recovery drills. |

Each stage must preserve all 147 areas in the ledger, record its source/acceptance evidence and keep remaining requirements visible. Production readiness requires accepted business policies, supported infrastructure and provider/regulatory validation; it is not implied by this local build.

[Accounting period controls](period-control.md) add scoped period movement trial balances, independent close/reopen review, immutable reconciliation snapshots and database posting locks. Full statutory close, FX and consolidation remain outstanding.
