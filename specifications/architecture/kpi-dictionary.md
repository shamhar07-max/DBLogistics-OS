# KPI dictionary (implemented figures)

| KPI | Definition | Source | Exclusions |
|---|---|---|---|
| Active jobs | jobs with status ∉ {closed, cancelled} | `logistics.jobs` | — |
| Unbilled delivered | sum(`amount`) of revenue charges `status='open'` on jobs `status='delivered'` | `finance.charges` | cancelled charges |
| Receivables outstanding / overdue | sum(`total − amount_allocated`) of posted invoices; overdue = `due_date < today` | `finance.invoices` | drafts/credited |
| Quoted margin | (Σ qty×price − Σ qty×expected cost) of the accepted quote | `commercial.quote_lines` | — |
| Expected margin | revenue vs cost **charges** (non-cancelled) | `finance.charges` | — |
| Accounting margin | posted REVENUE credits − COST debits tagged to the job | `finance.journal_lines` | unposted/accrual-less items |
| Cash collected | Σ allocations to the job's invoices | `finance.payment_allocations` | unallocated receipts |
| Costs not accrued | cost charges `status='open'` | `finance.charges` | — |
| Held lots | distinct lots with an unreleased hold | `warehouse.holds` | — |
Further KPIs from blueprint §34 (on-time delivery, occupancy, ageing buckets, supplier reliability…) are **not yet implemented**; each needs a written definition before it is shown.
