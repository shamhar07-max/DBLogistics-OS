# Event catalog (generated)

Published through the **transactional outbox** (`platform.outbox`) in the same transaction as the business change, relayed to BullMQ by the worker (SKIP LOCKED claim, deterministic job id). Delivery is **at-least-once**; every consumer records `automation.processed_events(tenant, consumer, event)` in the same transaction as its effect → **exactly-once effect**. Tenant-defined workflows (`automation.workflow_definitions`) can trigger on any topic.

| Topic | Producer module(s) | Built-in consumers |
|---|---|---|
| `EnquiryQualified` | commercial | — |
| `QuoteApproved` | commercial | — |
| `QuoteAccepted` | commercial | job-handover task |
| `JobOpened` | logistics | — |
| `BookingRequested` | logistics | — |
| `BookingConfirmed` | logistics | — |
| `ShipmentEventRecorded` | logistics | — |
| `CargoReceived` | warehouse | — |
| `ReleaseAuthorized` | — (reserved) | — |
| `CargoReleased` | warehouse | — |
| `CustomsReleaseRecorded` | trade | — |
| `DeliveryCompleted` | logistics | billing-readiness task |
| `ChargeCreated` | finance | — |
| `InvoiceApproved` | finance | — |
| `InvoicePosted` | finance | — |
| `SupplierBillPosted` | finance | bill-variance task (if variance ≠ 0) |
| `PaymentAllocated` | finance | — |
| `JobClosed` | logistics | — |
| `DocumentApproved` | documents | malware scan (stage=registered) |
| `ApprovalDecided` | collaboration | — |
| `IntegrationEventReceived` | integrations | inbox normaliser → tracking events |

Event time vs received time: tracking events store both (`event_time`, `received_at`) plus `source`; late or duplicate events never corrupt current state (see `logistics/domain/lifecycle.ts`).
