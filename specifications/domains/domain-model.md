# Domain model

```mermaid
erDiagram
  TENANT ||--o{ LEGAL_ENTITY : has
  LEGAL_ENTITY ||--o{ BRANCH : has
  LEGAL_ENTITY ||--o{ FACILITY : operates
  PARTY ||--o{ PARTY_ROLE : "is customer/supplier/agent…"
  ENQUIRY ||--o{ QUOTE : "quoted as"
  QUOTE ||--|{ QUOTE_LINE : "frozen after approval"
  QUOTE ||--o| JOB : "accepted → exactly one"
  JOB ||--o{ SHIPMENT : owns
  SHIPMENT ||--o{ LEG : routed
  SHIPMENT ||--o{ CARGO_UNIT : contains
  SHIPMENT ||--o{ BOOKING : booked
  SHIPMENT ||--o{ TRACKING_EVENT : "actual | estimated + source"
  CARGO_UNIT ||--o{ STOCK_LOT : "custody (owner = customer)"
  STOCK_LOT ||--o{ CUSTODY_MOVEMENT : "append-only ledger"
  STOCK_LOT ||--o{ HOLD : "quarantine/customs"
  JOB ||--o{ CUSTOMS_CASE : "needs"
  CUSTOMS_CASE ||--o| RELEASE_EVIDENCE : "authority doc required"
  JOB ||--o{ CHARGE : "revenue/cost, one per service event"
  CHARGE }o--o| INVOICE_LINE : invoiced
  INVOICE ||--|{ INVOICE_LINE : has
  INVOICE ||--o| JOURNAL : "posting"
  JOURNAL ||--|{ JOURNAL_LINE : "balanced at COMMIT"
  PAYMENT ||--o{ PAYMENT_ALLOCATION : "≤ available"
  INVOICE ||--o{ PAYMENT_ALLOCATION : "≤ outstanding"
```

**Customer order → Job → Shipment → Leg / Cargo → Booking / Tracking / Customs / Charges → Invoice → Journal → Cash.** A job owns commercial responsibility and profitability; shipments carry execution; stock lots carry custody; charges carry money. Documents link polymorphically (`related_type`, `related_id`) to the record they evidence.

Identity separation: tenant ≠ legal entity ≠ branch ≠ facility ≠ party ≠ user ≠ membership (`platform`, `org`, `parties` schemas). Branch kinds distinguish `operated_office` from `agent_office`; intercompany and partner-agent settlement are modelled as supplier/customer relationships, never as branches.

Schemas: `platform org parties commercial logistics transport warehouse trade finance collab automation integ ref`.
