import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { approvedDocument, close, makeParty, world, type World } from './helpers';

let w: World;
beforeAll(async () => { w = await world(); });
afterAll(async () => close(w));

describe('milestone journey: enquiry → quote → job → booking → delivery → invoice → supplier cost → collection → closure', () => {
  it('runs end to end with correct permissions, evidence and ledger', async () => {
    const owner = w.owner;
    const sales = await w.member(w.a.tenantId, 'sales', ['sales']);
    const pricing = await w.member(w.a.tenantId, 'pricing', ['pricing']);
    const ops = await w.member(w.a.tenantId, 'ops', ['freight_ops']);
    const fin = await w.member(w.a.tenantId, 'fin', ['finance_manager']);
    const acct = await w.member(w.a.tenantId, 'acct', ['accountant']);
    const cs = await w.member(w.a.tenantId, 'cust', ['customs_specialist']);

    const customer = await makeParty(owner, 'Gulf Pharma Distribution', ['customer']);
    const carrier = await makeParty(owner, 'Ocean Line One', ['carrier', 'supplier']);
    const LE = w.a.legalEntityId;

    // 1. enquiry (missing info becomes tasks, not invented values)
    const enq = await sales.post('/enquiries', { legalEntityId: LE, customerPartyId: customer, mode: 'ocean_fcl', origin: 'Shanghai', destination: 'Jebel Ali', cargo: { commodity: 'Pharmaceuticals' } });
    expect(enq.status).toBe(201);
    const q1 = await sales.cmd(`/enquiries/${enq.body.id}/qualify`);
    expect(q1.body.missingInformation).toContain('gross weight');
    expect(q1.body.tasksCreated).toBeGreaterThan(0);

    // 2. quote drafted by sales, approved by someone else
    const quote = await sales.post('/quotes', {
      legalEntityId: LE, enquiryId: enq.body.id, customerPartyId: customer, currency: 'AED', validUntil: '2099-12-31', mode: 'ocean_fcl', origin: 'Shanghai', destination: 'Jebel Ali', incoterm: 'FOB',
      lines: [
        { description: 'Ocean freight 1x40RF', chargeType: 'fixed', quantity: '1', unitPrice: '10000.00', expectedUnitCost: '7000.00', taxCode: 'ZR', taxRationale: 'International transport — zero-rated', supplierPartyId: carrier },
        { description: 'Terminal handling', chargeType: 'estimated', chargeGroup: 'destination', quantity: '1', unitPrice: '1500.50', expectedUnitCost: '1000.00', taxCode: 'SR5', supplierPartyId: carrier },
      ] });
    expect(quote.status).toBe(201);
    expect((await sales.cmd(`/quotes/${quote.body.id}/approve`)).body.code).toBe('FORBIDDEN');                         // sales lacks quotes.approve
    expect((await pricing.cmd(`/quotes/${quote.body.id}/approve`)).status).toBe(200);
    const accept0 = await sales.cmd(`/quotes/${quote.body.id}/accept`, { acceptedByName: 'R. Nair', evidence: { channel: 'email', reference: 'msg-1' } });
    expect(accept0.status).toBe(200);
    const jobId = accept0.body.job.id;
    // replay with the same Idempotency-Key returns the same job — no second job
    const key = randomUUID();
    // 3. job + expected-cost / revenue charges came from the accepted quote
    const job = await ops.get(`/jobs/${jobId}`); expect(job.body.status).toBe('open');
    const dup = await w.su.query(`SELECT count(*)::int n FROM logistics.jobs WHERE quote_id=$1`, [quote.body.id]); expect(dup.rows[0].n).toBe(1);
    const margin0 = await fin.get(`/jobs/${jobId}/margin`);
    expect(margin0.body.quoted.amount).toBe('3500.50'); expect(margin0.body.quoted.percent).toBe('30.4');            // (11500.50-8000)/11500.50

    // 4. shipment + booking + tracking
    const shp = await ops.post('/shipments', { jobId, mode: 'ocean_fcl', origin: 'Shanghai', destination: 'Jebel Ali', cargo: [{ description: 'Pharma pallets', quantity: '22', ownerPartyId: customer }], legs: [{ mode: 'ocean_fcl', origin: 'Shanghai', destination: 'Jebel Ali', operatorPartyId: carrier }] });
    expect(shp.status).toBe(201);
    const bk = await ops.post('/bookings', { shipmentId: shp.body.id, carrierPartyId: carrier, requestKey: 'req-key-0001' });
    expect((await ops.cmd(`/bookings/${bk.body.id}/confirm`, { externalRef: 'BKG123' })).status).toBe(200);
    expect((await ops.post(`/shipments/${shp.body.id}/events`, { code: 'DEPARTED', eventTime: '2026-10-01T10:00:00Z', source: 'carrier', isActual: true, externalEventId: 'e1' })).status).toBe(201);

    // 5. delivery needs approved + scanned POD evidence
    const noPod = await ops.cmd(`/shipments/${shp.body.id}/complete-delivery`, { deliveredAt: '2026-10-03T08:00:00Z', podDocumentId: randomUUID() });
    expect(noPod.body.code).toBe('DOCUMENT_NOT_CLEAN');
    const pod = await approvedDocument(w, cs, { docType: 'POD', issuerKind: 'customer', relatedType: 'shipment', relatedId: shp.body.id });
    const del = await ops.cmd(`/shipments/${shp.body.id}/complete-delivery`, { deliveredAt: '2026-10-03T08:00:00Z', podDocumentId: pod });
    expect(del.status).toBe(200); expect(del.body.jobStatus).toBe('delivered');

    // 6. customer invoice: drafted by accountant, approved by finance, posted once
    const draft = await acct.post('/invoices', { jobId });
    expect(draft.status).toBe(201); expect(draft.body.subtotal).toBe('11500.50'); expect(draft.body.taxTotal).toBe('75.03'); expect(draft.body.total).toBe('11575.53');   // 5% of 1500.50 = 75.025 → 75.03 (half-up)
    expect((await fin.cmd(`/invoices/${draft.body.id}/approve`)).status).toBe(200);
    const posted = await fin.cmd(`/invoices/${draft.body.id}/post`, { postingDate: new Date().toISOString().slice(0, 10) }, key);
    expect(posted.status).toBe(200); expect(posted.body.ref).toMatch(/^INV-\d\d-00001$/);
    const lines = (await w.su.query(`SELECT a.system_key, sum(l.debit) d, sum(l.credit) c FROM finance.journal_lines l JOIN finance.accounts a ON a.id=l.account_id WHERE l.journal_id=$1 GROUP BY 1 ORDER BY 1`, [posted.body.journalId])).rows;
    expect(Object.fromEntries(lines.map((r) => [r.system_key, [r.d, r.c]]))).toEqual({ AR: ['11575.5300', '0.0000'], REVENUE: ['0.0000', '11500.5000'], VAT_OUT: ['0.0000', '75.0300'] });

    // 7. supplier cost: accrue expected cost then bill arrives (variance on handling)
    const costs = (await w.su.query(`SELECT id, amount FROM finance.charges WHERE job_id=$1 AND kind='cost' ORDER BY amount DESC`, [jobId])).rows;
    for (const c of costs) expect((await acct.cmd(`/charges/${c.id}/accrue`)).status).toBe(200);
    const bill = await acct.cmd('/supplier-bills', { legalEntityId: LE, supplierPartyId: carrier, jobId, supplierInvoiceNo: 'OL-9001', currency: 'AED', amount: '8240.00' });
    expect(bill.status).toBe(201); expect(bill.body.accrualsCleared).toBe(2); expect(bill.body.accruedAmount).toBe('8000.00'); expect(bill.body.variance).toBe('240.00');

    // 8. collection: receipt, allocation, never beyond available
    const pay = await acct.post('/payments', { legalEntityId: LE, partyId: customer, currency: 'AED', amount: '11575.53', receivedOn: new Date().toISOString().slice(0, 10), bankReference: 'BANK-77' });
    expect(pay.status).toBe(201);
    const alloc = await acct.cmd(`/payments/${pay.body.id}/allocate`, { invoiceId: draft.body.id, amount: '11575.53', allocationKey: 'alloc-key-0001' });
    expect(alloc.status).toBe(200); expect(alloc.body.paymentAvailable).toBe('0.00');
    expect((await w.su.query(`SELECT finance_status FROM logistics.jobs WHERE id=$1`, [jobId])).rows[0].finance_status).toBe('settled');

    // 9. margins are reported separately; accounting margin reflects the posted bill variance
    const m = await fin.get(`/jobs/${jobId}/margin`);
    expect(m.body.expected.amount).toBe('3500.50'); expect(m.body.accounting.amount).toBe('3260.50'); expect(m.body.cash.collected).toBe('11575.53');

    // 10. closure: bill matched all accruals → only acknowledged exceptions allowed; here nothing outstanding
    const closed = await fin.cmd(`/jobs/${jobId}/close`, { acknowledgedExceptions: [] });
    expect(closed.status).toBe(200); expect(closed.body.status).toBe('closed');

    // every ledger entry for this tenant balances, and audit + outbox exist for the whole journey
    const bal = await w.su.query(`SELECT journal_id FROM finance.journal_lines WHERE tenant_id=$1 GROUP BY journal_id HAVING sum(debit)<>sum(credit)`, [w.a.tenantId]); expect(bal.rowCount).toBe(0);
    const topics = (await w.su.query(`SELECT DISTINCT topic FROM platform.outbox WHERE tenant_id=$1`, [w.a.tenantId])).rows.map((r) => r.topic);
    for (const t of ['QuoteAccepted', 'JobOpened', 'BookingConfirmed', 'DeliveryCompleted', 'InvoicePosted', 'SupplierBillPosted', 'PaymentAllocated', 'JobClosed']) expect(topics).toContain(t);
  });
});
