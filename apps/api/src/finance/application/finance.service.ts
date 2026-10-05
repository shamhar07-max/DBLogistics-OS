import { Injectable, Inject } from '@nestjs/common';
import { D, money } from '@dbl/contracts';
import { audit, DomainError, emit, Db, expectVersion, isExternal, assertScope, type RequestContext, type Tx } from '../../platform';
import { accrualPosting, allocationPosting, billPosting, invoicePosting, invoiceTotals, receiptPosting } from '../domain/posting';
import { margins } from '../domain/margin';
import { assertOpenPeriod, postJournal } from './ledger';

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class FinanceService {
  constructor(@Inject(Db) private db: Db) {}

  private async job(tx: Tx, id: string) {
    const j = await tx.maybe(`SELECT id, legal_entity_id, currency, status, customer_party_id FROM logistics.jobs WHERE id=$1`, [id]);
    if (!j) throw new DomainError('NOT_FOUND', 'Job not found.');
    return j;
  }

  // ---------------------------------------------------------------- charges
  async createCharge(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const job = await this.job(tx, b.jobId);
      assertScope(ctx, 'charges.create', job.legal_entity_id);
      if (job.status === 'closed' || job.status === 'cancelled') throw new DomainError('INVALID_STATE_TRANSITION', `Job is ${job.status}.`);
      if (job.currency !== b.currency) throw new DomainError('CURRENCY_MISMATCH', 'Charge currency must equal the job currency (FX is not enabled in this release).');
      const row = await tx.maybe(
        `INSERT INTO finance.charges(tenant_id, job_id, shipment_id, kind, source_event_key, description, quantity, unit_amount, currency, tax_code, tax_rationale, party_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tenant_id, job_id, source_event_key) DO NOTHING RETURNING *`,
        [ctx.tenantId, b.jobId, b.shipmentId ?? null, b.kind, b.sourceEventKey, b.description, b.quantity, b.unitAmount, b.currency, b.taxCode, b.taxRationale ?? null, b.partyId ?? null]);
      if (!row) return { ...(await tx.one(`SELECT * FROM finance.charges WHERE job_id=$1 AND source_event_key=$2`, [b.jobId, b.sourceEventKey])), duplicate: true };
      await audit(tx, ctx, 'charge.created', 'charge', row.id, { sourceEventKey: b.sourceEventKey, kind: b.kind });
      await emit(tx, ctx, 'ChargeCreated', 'charge', row.id, { jobId: b.jobId });
      return { ...row, duplicate: false };
    });
  }
  /** Called by the commercial→logistics hand-over inside the SAME transaction as quote acceptance. */
  async createChargesFromQuote(tx: Tx, ctx: RequestContext, jobId: string, quote: { id: string; currency: string }, lines: any[]) {
    for (const l of lines) {
      await tx.q(`INSERT INTO finance.charges(tenant_id, job_id, kind, source_event_key, description, quantity, unit_amount, currency, tax_code, tax_rationale, party_id)
                  VALUES ($1,$2,'revenue',$3,$4,$5,$6,$7,$8,$9,(SELECT customer_party_id FROM logistics.jobs WHERE id=$2)) ON CONFLICT DO NOTHING`,
        [ctx.tenantId, jobId, `quote:${quote.id}:rev:${l.seq}`, l.description, l.quantity, l.unit_price, quote.currency, l.tax_code, l.tax_rationale]);
      if (D(l.expected_unit_cost).gt(0))
        await tx.q(`INSERT INTO finance.charges(tenant_id, job_id, kind, source_event_key, description, quantity, unit_amount, currency, tax_code, party_id)
                    VALUES ($1,$2,'cost',$3,$4,$5,$6,$7,'OOS',$8) ON CONFLICT DO NOTHING`,
          [ctx.tenantId, jobId, `quote:${quote.id}:cost:${l.seq}`, `Expected cost: ${l.description}`, l.quantity, l.expected_unit_cost, quote.currency, l.supplier_party_id]);
    }
  }
  async accrueCharge(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const c = await tx.maybe(`SELECT c.*, j.legal_entity_id FROM finance.charges c JOIN logistics.jobs j ON j.id=c.job_id WHERE c.id=$1 FOR UPDATE OF c`, [id]);
      if (!c) throw new DomainError('NOT_FOUND', 'Charge not found.');
      assertScope(ctx, 'charges.create', c.legal_entity_id);
      if (c.kind !== 'cost' || c.status !== 'open') throw new DomainError('INVALID_STATE_TRANSITION', `Only open cost charges can be accrued (this one is ${c.kind}/${c.status}).`);
      const jid = await postJournal(tx, ctx, { legalEntityId: c.legal_entity_id, postingDate: today(), currency: c.currency, sourceType: 'charge_accrual', sourceId: c.id, description: `Accrual: ${c.description}`,
        lines: accrualPosting(c.amount).map((l) => ({ ...l, jobId: c.job_id, partyId: c.party_id })) });
      await tx.q(`UPDATE finance.charges SET status='accrued', accrual_journal_id=$2 WHERE id=$1`, [id, jid]);
      await audit(tx, ctx, 'charge.accrued', 'charge', id, { amount: c.amount });
      return { id, status: 'accrued', journalId: jid };
    });
  }

  // ---------------------------------------------------------------- invoices
  async createInvoiceDraft(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const job = await this.job(tx, b.jobId);
      assertScope(ctx, 'invoices.draft', job.legal_entity_id);
      const charges = await tx.q(`SELECT * FROM finance.charges WHERE job_id=$1 AND kind='revenue' AND status='open' ${b.chargeIds ? 'AND id = ANY($2::uuid[])' : ''} ORDER BY created_at FOR UPDATE`, b.chargeIds ? [b.jobId, b.chargeIds] : [b.jobId]);
      if (!charges.length) throw new DomainError('VALIDATION_FAILED', 'No open revenue charges to invoice.');
      const t = invoiceTotals(charges.map((c) => ({ chargeId: c.id, description: c.description, net: c.amount, taxCode: c.tax_code, taxRationale: c.tax_rationale })));
      const inv = await tx.one(`INSERT INTO finance.invoices(tenant_id, legal_entity_id, job_id, customer_party_id, currency, subtotal, tax_total, total, due_date, drafted_by)
                                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, version`,
        [ctx.tenantId, job.legal_entity_id, job.id, job.customer_party_id, job.currency, t.subtotal.toFixed(4), t.taxTotal.toFixed(4), t.total.toFixed(4), b.dueDate ?? null, ctx.userId]);
      for (const l of t.lines) {
        await tx.q(`INSERT INTO finance.invoice_lines(tenant_id, invoice_id, charge_id, description, net_amount, tax_code, tax_rate, tax_amount, tax_rationale) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [ctx.tenantId, inv.id, l.chargeId, l.description, l.net.toFixed(4), l.taxCode, l.rate, l.tax.toFixed(4), l.taxRationale ?? null]);
        await tx.q(`UPDATE finance.charges SET status='invoiced', invoice_id=$2 WHERE id=$1`, [l.chargeId, inv.id]);
      }
      await tx.q(`UPDATE logistics.jobs SET finance_status = CASE WHEN EXISTS (SELECT 1 FROM finance.charges WHERE job_id=$1 AND kind='revenue' AND status='open') THEN 'partially_billed' ELSE 'billed' END WHERE id=$1 AND finance_status IN ('open','partially_billed')`, [job.id]);
      await audit(tx, ctx, 'invoice.drafted', 'invoice', inv.id, { total: money(t.total) });
      return { id: inv.id, version: inv.version, status: 'draft', subtotal: money(t.subtotal), taxTotal: money(t.taxTotal), total: money(t.total) };
    });
  }
  async approveInvoice(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const inv = await tx.maybe(`SELECT * FROM finance.invoices WHERE id=$1 FOR UPDATE`, [id]);
      if (!inv) throw new DomainError('NOT_FOUND', 'Invoice not found.');
      assertScope(ctx, 'invoices.approve', inv.legal_entity_id); expectVersion(inv.version, ctx);
      if (inv.status !== 'draft') throw new DomainError('INVALID_STATE_TRANSITION', `Invoice is ${inv.status}.`);
      if (inv.drafted_by === ctx.userId) throw new DomainError('SEPARATION_OF_DUTIES', 'The person who drafted an invoice cannot approve it.');
      await tx.q(`UPDATE finance.invoices SET status='approved', approved_by=$2 WHERE id=$1`, [id, ctx.userId]);
      await audit(tx, ctx, 'invoice.approved', 'invoice', id); await emit(tx, ctx, 'InvoiceApproved', 'invoice', id);
      return { id, status: 'approved', version: inv.version + 1 };
    });
  }
  /** One transaction: validate → period → totals → number → balanced journal → receivable → mark posted → audit → outbox. */
  async postInvoice(ctx: RequestContext, id: string, postingDate: string) {
    return this.db.run(ctx, async (tx) => {
      const inv = await tx.maybe(`SELECT * FROM finance.invoices WHERE id=$1 FOR UPDATE`, [id]);
      if (!inv) throw new DomainError('NOT_FOUND', 'Invoice not found.');
      assertScope(ctx, 'invoices.post', inv.legal_entity_id); expectVersion(inv.version, ctx);
      if (inv.status !== 'approved') throw new DomainError('INVALID_STATE_TRANSITION', `Only approved invoices can be posted (this one is ${inv.status}).`);
      await assertOpenPeriod(tx, inv.legal_entity_id, postingDate);
      const lines = await tx.q(`SELECT * FROM finance.invoice_lines WHERE invoice_id=$1`, [id]);
      const t = invoiceTotals(lines.map((l) => ({ chargeId: l.charge_id, description: l.description, net: l.net_amount, taxCode: l.tax_code })));
      const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('invoice:' || $1, 'INV') r`, [inv.legal_entity_id])).r;
      const jid = await postJournal(tx, ctx, { legalEntityId: inv.legal_entity_id, postingDate, currency: inv.currency, sourceType: 'invoice', sourceId: id, description: `Invoice ${ref}`,
        lines: invoicePosting(t).map((l) => ({ ...l, partyId: inv.customer_party_id, jobId: inv.job_id })) });
      await tx.q(`UPDATE finance.invoices SET status='posted', ref=$2, posting_date=$3, posted_journal_id=$4, posted_by=$5, subtotal=$6, tax_total=$7, total=$8, einvoice_status='pending',
                  due_date=COALESCE(due_date, $3::date + 30) WHERE id=$1`, [id, ref, postingDate, jid, ctx.userId, t.subtotal.toFixed(4), t.taxTotal.toFixed(4), t.total.toFixed(4)]);
      await audit(tx, ctx, 'invoice.posted', 'invoice', id, { ref, journalId: jid, total: money(t.total) });
      await emit(tx, ctx, 'InvoicePosted', 'invoice', id, { ref, jobId: inv.job_id, total: money(t.total) });
      return { id, ref, status: 'posted', journalId: jid, total: money(t.total), version: inv.version + 1 };
    });
  }
  async listInvoices(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT id, ref, status, einvoice_status, job_id, customer_party_id, currency, total, amount_allocated, posting_date, due_date, version FROM finance.invoices
      ${isExternal(ctx) ? 'WHERE customer_party_id = $1' : ''} ORDER BY created_at DESC LIMIT 200`, isExternal(ctx) ? [ctx.partyId] : []));
  }

  // ---------------------------------------------------------------- supplier bills
  async recordSupplierBill(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const job = await this.job(tx, b.jobId);
      assertScope(ctx, 'bills.record', job.legal_entity_id);
      if (job.currency !== b.currency) throw new DomainError('CURRENCY_MISMATCH', 'Bill currency must equal the job currency.');
      const accrued = await tx.q(`SELECT id, amount FROM finance.charges WHERE job_id=$1 AND kind='cost' AND status='accrued' AND party_id=$2 ORDER BY created_at FOR UPDATE`, [b.jobId, b.supplierPartyId]);
      const accruedTotal = accrued.reduce((a, c) => a.plus(c.amount), D(0));
      const { lines, variance } = billPosting(b.amount, accruedTotal);
      const bill = await tx.one(`INSERT INTO finance.supplier_bills(tenant_id, legal_entity_id, supplier_party_id, job_id, supplier_invoice_no, currency, amount, variance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [ctx.tenantId, job.legal_entity_id, b.supplierPartyId, b.jobId, b.supplierInvoiceNo, b.currency, b.amount, variance.toFixed(4)]);   // UNIQUE(supplier, invoice no) => duplicate bills rejected
      const jid = await postJournal(tx, ctx, { legalEntityId: job.legal_entity_id, postingDate: today(), currency: b.currency, sourceType: 'supplier_bill', sourceId: bill.id, description: `Supplier bill ${b.supplierInvoiceNo}`,
        lines: lines.map((l) => ({ ...l, partyId: b.supplierPartyId, jobId: b.jobId })) });
      await tx.q(`UPDATE finance.supplier_bills SET posted_journal_id=$2 WHERE id=$1`, [bill.id, jid]);
      for (const c of accrued) await tx.q(`UPDATE finance.charges SET status='billed', supplier_bill_id=$2 WHERE id=$1`, [c.id, bill.id]);
      await audit(tx, ctx, 'supplier_bill.posted', 'supplier_bill', bill.id, { variance: variance.toFixed(2), clearedAccruals: accrued.length });
      await emit(tx, ctx, 'SupplierBillPosted', 'supplier_bill', bill.id, { jobId: b.jobId, variance: variance.toFixed(2) });
      return { id: bill.id, journalId: jid, variance: variance.toFixed(2), accrualsCleared: accrued.length, accruedAmount: money(accruedTotal) };
    });
  }

  // ---------------------------------------------------------------- payments
  async recordPayment(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      assertScope(ctx, 'payments.record', b.legalEntityId);
      const p = await tx.one(`INSERT INTO finance.payments(tenant_id, legal_entity_id, party_id, currency, amount, received_on, bank_reference, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, version`,
        [ctx.tenantId, b.legalEntityId, b.partyId, b.currency, b.amount, b.receivedOn, b.bankReference ?? null, ctx.userId]);
      await postJournal(tx, ctx, { legalEntityId: b.legalEntityId, postingDate: b.receivedOn, currency: b.currency, sourceType: 'payment', sourceId: p.id, description: `Receipt ${b.bankReference ?? ''}`,
        lines: receiptPosting(b.amount).map((l) => ({ ...l, partyId: b.partyId })) });
      await audit(tx, ctx, 'payment.recorded', 'payment', p.id, { amount: b.amount });
      return { id: p.id, version: p.version, available: money(b.amount) };
    });
  }
  /** Locks payment and invoice in id order (deadlock-safe), then enforces both ceilings. */
  async allocatePayment(ctx: RequestContext, paymentId: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const prior = await tx.maybe(`SELECT a.*, p.amount - p.amount_allocated AS available FROM finance.payment_allocations a JOIN finance.payments p ON p.id=a.payment_id WHERE a.allocation_key=$1`, [b.allocationKey]);
      if (prior) return { id: prior.id, allocated: money(prior.amount), paymentAvailable: money(prior.available), duplicate: true };
      const locks = await tx.q(`SELECT 'p' k, id FROM finance.payments WHERE id=$1 UNION ALL SELECT 'i', id FROM finance.invoices WHERE id=$2`, [paymentId, b.invoiceId]);
      if (locks.length !== 2) throw new DomainError('NOT_FOUND', 'Payment or invoice not found.');
      const [first, second] = [...locks].sort((a, b2) => (a.id < b2.id ? -1 : 1));
      for (const l of [first, second]) await tx.q(`SELECT 1 FROM finance.${l.k === 'p' ? 'payments' : 'invoices'} WHERE id=$1 FOR UPDATE`, [l.id]);
      const pay = await tx.one(`SELECT * FROM finance.payments WHERE id=$1`, [paymentId]); const inv = await tx.one(`SELECT * FROM finance.invoices WHERE id=$1`, [b.invoiceId]);
      assertScope(ctx, 'payments.allocate', pay.legal_entity_id);
      if (inv.status !== 'posted') throw new DomainError('INVALID_STATE_TRANSITION', 'Payments can only be allocated to posted invoices.');
      if (pay.party_id !== inv.customer_party_id) throw new DomainError('VALIDATION_FAILED', 'Payment and invoice belong to different parties.');
      if (pay.currency !== inv.currency) throw new DomainError('CURRENCY_MISMATCH', 'Payment and invoice currencies differ.');
      const amt = D(b.amount);
      if (amt.gt(D(pay.amount).minus(pay.amount_allocated))) throw new DomainError('OVER_ALLOCATION', 'Allocation exceeds the available payment amount.', { available: money(D(pay.amount).minus(pay.amount_allocated)) });
      if (amt.gt(D(inv.total).minus(inv.amount_allocated))) throw new DomainError('OVER_ALLOCATION', 'Allocation exceeds the invoice balance.', { outstanding: money(D(inv.total).minus(inv.amount_allocated)) });
      const jid = await postJournal(tx, ctx, { legalEntityId: pay.legal_entity_id, postingDate: today(), currency: pay.currency, sourceType: 'payment_allocation', sourceId: (await tx.one<{ id: string }>(`SELECT gen_random_uuid() id`)).id,
        description: `Allocate to ${inv.ref}`, lines: allocationPosting(b.amount).map((l) => ({ ...l, partyId: pay.party_id, jobId: inv.job_id })) });
      const a = await tx.one(`INSERT INTO finance.payment_allocations(tenant_id, payment_id, invoice_id, amount, allocation_key, journal_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [ctx.tenantId, paymentId, b.invoiceId, b.amount, b.allocationKey, jid]);
      await tx.q(`UPDATE finance.payments SET amount_allocated = amount_allocated + $2 WHERE id=$1`, [paymentId, b.amount]);
      await tx.q(`UPDATE finance.invoices SET amount_allocated = amount_allocated + $2 WHERE id=$1`, [b.invoiceId, b.amount]);
      const unsettled = await tx.maybe(`SELECT 1 FROM finance.invoices WHERE job_id=$1 AND status='posted' AND amount_allocated < total`, [inv.job_id]);
      const open = await tx.maybe(`SELECT 1 FROM finance.charges WHERE job_id=$1 AND kind='revenue' AND status='open'`, [inv.job_id]);
      if (!unsettled && !open) await tx.q(`UPDATE logistics.jobs SET finance_status='settled' WHERE id=$1 AND finance_status IN ('billed','partially_billed')`, [inv.job_id]);
      await audit(tx, ctx, 'payment.allocated', 'payment', paymentId, { invoiceId: b.invoiceId, amount: b.amount });
      await emit(tx, ctx, 'PaymentAllocated', 'invoice', b.invoiceId, { jobId: inv.job_id, amount: b.amount });
      return { id: a.id, allocated: money(amt), paymentAvailable: money(D(pay.amount).minus(pay.amount_allocated).minus(amt)), duplicate: false };
    });
  }

  // ---------------------------------------------------------------- margins & closure
  async jobMargin(ctx: RequestContext, jobId: string) {
    return this.db.run(ctx, async (tx) => {
      const job = await this.job(tx, jobId);
      assertScope(ctx, 'jobs.margin.view', job.legal_entity_id);
      const q = await tx.one(`SELECT COALESCE(sum(l.quantity*l.unit_price),0) rev, COALESCE(sum(l.quantity*l.expected_unit_cost),0) cost
                              FROM commercial.quote_lines l JOIN logistics.jobs j ON j.quote_id=l.quote_id WHERE j.id=$1`, [jobId]);
      const ch = await tx.one(`SELECT COALESCE(sum(amount) FILTER (WHERE kind='revenue' AND status<>'cancelled'),0) rev, COALESCE(sum(amount) FILTER (WHERE kind='cost' AND status<>'cancelled'),0) cost,
                               COALESCE(sum(amount) FILTER (WHERE kind='revenue' AND status='open'),0) unbilled,
                               count(*) FILTER (WHERE kind='cost' AND status='open') missing_costs FROM finance.charges WHERE job_id=$1`, [jobId]);
      const gl = await tx.one(`SELECT COALESCE(sum(jl.credit-jl.debit) FILTER (WHERE a.system_key='REVENUE'),0) rev, COALESCE(sum(jl.debit-jl.credit) FILTER (WHERE a.system_key='COST'),0) cost
                               FROM finance.journal_lines jl JOIN finance.accounts a ON a.id=jl.account_id WHERE jl.job_id=$1`, [jobId]);
      const cash = await tx.one(`SELECT COALESCE(sum(pa.amount),0) c FROM finance.payment_allocations pa JOIN finance.invoices i ON i.id=pa.invoice_id WHERE i.job_id=$1`, [jobId]);
      return { jobId, currency: job.currency, ...margins({ quoted: { revenue: q.rev, cost: q.cost }, revenueCharges: ch.rev, costCharges: ch.cost, postedRevenue: gl.rev, postedCost: gl.cost, cashCollected: cash.c }),
               unbilledRevenue: money(ch.unbilled), costChargesNotYetAccrued: Number(ch.missing_costs) };
    });
  }
  /** Everything that must be resolved or explicitly acknowledged before a job closes. */
  async closureBlockers(tx: Tx, jobId: string): Promise<Array<{ key: string; message: string }>> {
    const out: Array<{ key: string; message: string }> = [];
    const open = await tx.one(`SELECT count(*) FILTER (WHERE kind='revenue' AND status='open') unbilled, count(*) FILTER (WHERE kind='cost' AND status='open') unaccrued, count(*) FILTER (WHERE kind='cost' AND status='accrued') unbilled_costs FROM finance.charges WHERE job_id=$1`, [jobId]);
    if (Number(open.unbilled)) out.push({ key: 'unbilled_revenue', message: `${open.unbilled} revenue charge(s) not invoiced` });
    if (Number(open.unaccrued)) out.push({ key: 'missing_costs', message: `${open.unaccrued} expected cost(s) neither accrued nor billed` });
    if (Number(open.unbilled_costs)) out.push({ key: 'unbilled_costs', message: `${open.unbilled_costs} accrued cost(s) still awaiting a supplier bill` });
    const inv = await tx.one(`SELECT count(*) FILTER (WHERE status IN ('draft','approved')) unposted, count(*) FILTER (WHERE status='posted' AND amount_allocated<total) outstanding FROM finance.invoices WHERE job_id=$1`, [jobId]);
    if (Number(inv.unposted)) out.push({ key: 'unposted_invoices', message: `${inv.unposted} invoice(s) not posted` });
    if (Number(inv.outstanding)) out.push({ key: 'outstanding_receivable', message: `${inv.outstanding} invoice(s) not fully collected` });
    return out;
  }
}
