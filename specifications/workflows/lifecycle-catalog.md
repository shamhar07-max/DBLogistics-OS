# Lifecycle catalog

Each transition = command + required current state + actor/scope + evidence + validations + approvals + transactional effects + audit + domain event. Generic status editing is not exposed.

| Object | States | Command → transition | Guards (all enforced) |
|---|---|---|---|
| Enquiry | new → qualified → quoted → converted/lost | `qualifyEnquiry` | missing data becomes **tasks**, never invented values |
| Quote | draft → approved → (sent) → accepted / expired / superseded | `approveQuote`, `acceptQuote` | approver ≠ author; lines **immutable** once not draft (trigger); accept needs approved + in-validity; external users only own quotes; acceptance evidence stored; **one job per quote** (unique) |
| Job | open → executing → delivered → closed (cancelled) | `createShipment`, `completeDelivery`, `closeJob` | close needs shipments delivered/cancelled + every finance blocker resolved or **explicitly acknowledged** (`unbilled_revenue`, `missing_costs`, `unbilled_costs`, `outstanding_receivable`); unposted invoices can never be waived |
| Job finance | open → partially_billed → billed → settled → closed | invoice draft/post, allocation | derived from charges/invoices/allocations |
| Shipment | planned → executing → delivered (cancelled) | tracking events, `completeDelivery` | delivery needs **approved + clean-scanned POD** for that shipment |
| Booking | requested → confirmed ⇄ amended → cancelled | `requestBooking`, `confirmBooking` | `request_key` idempotent; **outcome_unknown** blocks re-submission until reconciled |
| Tracking event | actual / estimated + source | `recordTrackingEvent` | dedupe `(source, external_event_id)`; `inferred ⇒ not actual` (CHECK); current milestone = latest *actual* by event time |
| Document | draft/received → approved → superseded | `registerDocument`, `approveDocument` | upload intent (15 min, one use); object must exist and fit size; **scan clean** before approval; versions immutable |
| Customs case | preparing → submitted → held → release_recorded | `recordCustomsRelease` | evidence doc **approved, clean, issuer=authority**; authority status stored separately from internal status |
| Stock lot | qty/condition (good, damaged, quarantined) + holds | `receiveCargo`, `placeHold` | `command_key` idempotent receipt; `0 ≤ reserved ≤ on_hand` (CHECK) |
| Release order | requested → released (rejected) | `requestRelease`, `authorizeRelease` | reserve under row lock; authoriser ≠ requester; no active hold; bonded ⇒ release evidence; second authorise fails |
| Invoice | draft → approved → posted (credited) | `createInvoiceDraft`, `approveInvoice`, `postInvoice` | approver ≠ drafter; open period; totals recomputed server-side; number allocated **at posting**; balanced journal; one posting per source (unique) |
| Payment | recorded → allocated | `recordPayment`, `allocatePayment` | `allocated ≤ amount`, `allocated ≤ invoice outstanding` (CHECK + service); same party & currency; `allocation_key` idempotent; locks in id order (deadlock-safe) |
| Bank detail change | proposed → approved/rejected | `proposeBankChange`, `approveBankChange` | approver ≠ proposer; call-back attested; history preserved (`active_to`) |
| Approval request | pending → approved/rejected | `approveRequest` | decider ≠ requester |
| Workflow definition | draft → active → retired | `activateWorkflow` | versioned; one active version per key; runs unique per `(definition, event)` |
