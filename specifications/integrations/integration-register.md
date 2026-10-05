# Integration register

| Family | Mechanism in this repo | Status |
|---|---|---|
| Provider webhooks (carriers, airlines, etc.) | `POST /webhooks/:provider` — HMAC-SHA256 over the **raw body** with a secret resolved from `integ.connections.webhook_secret_ref`; `UNIQUE(tenant, provider, external_event_id)`; async normalisation in the worker | ✅ tested (bad signature, duplicates, one outbox effect) |
| Tracking normalisation | worker `normalizeInbox`: `tracking.update` → `logistics.tracking_events` (source `carrier`); unknown → `ignored`; unresolvable → `failed` (visible, never dropped) | ✅ tested |
| Booking submission to carriers | `bookings.outcome_unknown` + `request_key`; no outbound adapter | 🟡 state model only |
| Documents / storage | S3-compatible port with signed URLs | ✅ (S3 + memory adapters) |
| Malware scan | `ScanPort` | 🟡 stub (clean) — wire ClamAV |
| E-invoice (UAE PINT-AE via accredited provider) | `finance.invoices.einvoice_status`; adapter interface to be added | ❌ validate the current official requirements and the chosen provider's API at implementation time |
| Email / WhatsApp | enquiry `source` field; no connectors | ❌ |
| Bank statements / payments | `payments.bank_reference` unique; no feed | ❌ |
| Authority systems (customs, excise) | evidence-capture model (authority document + reference) — **no assumption that public APIs exist**; use API/EDI/SFTP/controlled import/manual evidence per authority | 🟡 manual evidence |
| Existing freight software | export/import migration — discovery first | ❌ |

Credentials: owner, scope, expiry and rotation are tracked per connection (`integ.connections`); the secret itself lives only in the secrets manager.
