# Accounting manual (implemented subset)

> This is the **proposed** policy encoded in code; the company's approved accounting and tax policy must replace it before go-live.

**Chart (system keys per legal entity):** 1000 Bank · 1100 Receivable (`AR`) · 1150 VAT input · 2100 Payable (`AP`) · 2150 Accrued costs · 2200 VAT output · 2300 Customer advances · 4000 Revenue · 5000 Cost. Periods: monthly, `open`/`closed`.

| Event | Journal |
|---|---|
| Invoice posted | Dr AR **gross** · Cr Revenue **net** · Cr VAT output |
| Cost accrued (expected supplier cost, per charge) | Dr Cost · Cr Accrued costs |
| Supplier bill posted | Dr Accrued (cleared amount) · Dr/Cr Cost (**variance**) · Cr AP **bill amount**. *No accrual → fully expensed (late bills are never ignored).* |
| Receipt recorded | Dr Bank · Cr **Customer advances** (unallocated cash is a liability) |
| Allocation | Dr Customer advances · Cr AR |
| Correction | **linked reversal** (`reverses_journal_id`) — posted journals are immutable (trigger + revoked privileges) |

**Rounding:** `numeric(18,4)` storage; tax and net rounded to the currency's minor units **half-up per invoice line**, then summed. Totals are recomputed on the server at posting; client values are never trusted. Worked example in `apps/api/test/journey.test.ts` (5 % of 1,500.50 = 75.025 → 75.03).

**Tax:** each line keeps its tax code (`SR5`, `ZR`, `EX`, `OOS`) and a free-text **rationale**. Treatment depends on transaction facts and the legal entity — the codes are inputs the tax specialist assigns; they are not inferred from "international" or "free-zone" labels.

**Journal integrity:** debit XOR credit per line; balance asserted in code **and** by a deferred constraint trigger at COMMIT; one posting journal per source document; posting date must fall in an open period (`ACCOUNTING_PERIOD_CLOSED` / `PERIOD_NOT_FOUND`).

**Custody stock is never forwarder inventory** — no inventory accounts are touched by warehouse movements.

**Margins (reported separately, never blended):** *quoted* (quote lines), *expected* (non-cancelled revenue and cost charges), *accounting* (posted journal lines tagged with the job), *cash* (allocations to the job's invoices). A delivered job with missing supplier bills shows `costChargesNotYetAccrued` and blocks closure.

**Not implemented (must be specified before use):** FX conversion & revaluation, credit notes (template `reversal()` exists), disbursement vs revenue treatment of pass-through authority charges, deposits, intercompany, consolidation-cost allocation, period-close workflow, VAT returns, e-invoice (PINT-AE) exchange — `invoices.einvoice_status` exists as an independent state; adapter for the selected accredited provider is **not built**.
