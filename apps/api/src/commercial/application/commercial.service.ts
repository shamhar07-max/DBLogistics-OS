import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { audit, assertScope, DomainError, emit, Db, expectVersion, isExternal, type RequestContext } from '../../platform';
import { canTransition, missingEnquiryInfo, quoteTotals } from '../domain/quote';
import { LogisticsService } from '../../logistics';
import { can } from '../../platform';

@Injectable()
export class CommercialService {
  constructor(@Inject(Db) private db: Db, @Inject(forwardRef(() => LogisticsService)) private logistics: LogisticsService) {}

  async createEnquiry(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      assertScope(ctx, 'enquiries.create', b.legalEntityId);
      const party = isExternal(ctx) ? ctx.partyId : b.customerPartyId;           // portal users can only raise enquiries for themselves
      const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('enquiry','ENQ') r`)).r;
      const e = await tx.one(`INSERT INTO commercial.enquiries(tenant_id, legal_entity_id, ref, customer_party_id, mode, origin, destination, incoterm, cargo, source, created_by)
                              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11) RETURNING id, ref, status, version`,
        [ctx.tenantId, b.legalEntityId, ref, party, b.mode, b.origin, b.destination, b.incoterm ?? null, JSON.stringify(b.cargo), b.source, ctx.userId]);
      await audit(tx, ctx, 'enquiry.created', 'enquiry', e.id); return e;
    });
  }
  async listEnquiries(ctx: RequestContext) { return this.db.run(ctx, (tx) => tx.q(`SELECT id, ref, status, mode, origin, destination, customer_party_id, missing_information, created_at FROM commercial.enquiries ${isExternal(ctx) ? 'WHERE customer_party_id=$1' : ''} ORDER BY created_at DESC LIMIT 200`, isExternal(ctx) ? [ctx.partyId] : [])); }
  async qualifyEnquiry(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const e = await tx.maybe(`SELECT * FROM commercial.enquiries WHERE id=$1 FOR UPDATE`, [id]);
      if (!e) throw new DomainError('NOT_FOUND', 'Enquiry not found.');
      assertScope(ctx, 'enquiries.qualify', e.legal_entity_id);
      if (!['new', 'qualified'].includes(e.status)) throw new DomainError('INVALID_STATE_TRANSITION', `Enquiry is ${e.status}.`);
      const missing = missingEnquiryInfo({ cargo: e.cargo, incoterm: e.incoterm, mode: e.mode });
      for (const m of missing) await tx.q(`INSERT INTO collab.tasks(tenant_id, title, related_type, related_id, origin) VALUES ($1,$2,'enquiry',$3,'automation')`, [ctx.tenantId, `Obtain from customer: ${m}`, id]);
      await tx.q(`UPDATE commercial.enquiries SET status='qualified', missing_information=$2::jsonb WHERE id=$1`, [id, JSON.stringify(missing)]);
      await audit(tx, ctx, 'enquiry.qualified', 'enquiry', id, { missing }); await emit(tx, ctx, 'EnquiryQualified', 'enquiry', id, { missing });
      return { id, status: 'qualified', missingInformation: missing, tasksCreated: missing.length };
    });
  }

  async createQuote(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      assertScope(ctx, 'quotes.create', b.legalEntityId);
      const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('quote','QT') r`)).r;
      const q = await tx.one(`INSERT INTO commercial.quotes(tenant_id, legal_entity_id, ref, enquiry_id, customer_party_id, currency, valid_until, mode, origin, destination, incoterm, created_by)
                              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, ref, revision, status, version`,
        [ctx.tenantId, b.legalEntityId, ref, b.enquiryId ?? null, b.customerPartyId, b.currency, b.validUntil, b.mode, b.origin, b.destination, b.incoterm ?? null, ctx.userId]);
      let seq = 1;
      for (const l of b.lines) await tx.q(`INSERT INTO commercial.quote_lines(tenant_id, quote_id, seq, description, charge_type, charge_group, quantity, unit, unit_price, expected_unit_cost, tax_code, tax_rationale, supplier_party_id)
                                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [ctx.tenantId, q.id, seq++, l.description, l.chargeType, l.chargeGroup, l.quantity, l.unit, l.unitPrice, l.expectedUnitCost, l.taxCode, l.taxRationale ?? null, l.supplierPartyId ?? null]);
      if (b.enquiryId) await tx.q(`UPDATE commercial.enquiries SET status='quoted' WHERE id=$1 AND status IN ('new','qualified')`, [b.enquiryId]);
      await audit(tx, ctx, 'quote.created', 'quote', q.id); return q;
    });
  }
  async getQuote(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const q = await tx.maybe(`SELECT * FROM commercial.quotes WHERE id=$1`, [id]);
      if (!q || (isExternal(ctx) && q.customer_party_id !== ctx.partyId)) throw new DomainError('NOT_FOUND', 'Quote not found.');
      const lines = await tx.q(`SELECT seq, description, charge_type, charge_group, quantity, unit, unit_price, expected_unit_cost, tax_code, tax_rationale FROM commercial.quote_lines WHERE quote_id=$1 ORDER BY seq`, [id]);
      const t = quoteTotals(lines as any);
      const showMargin = !isExternal(ctx) && can(ctx, 'jobs.margin.view');          // internal margin never leaves the staff workspace
      const visibleLines = lines.map((l: any) => { if (showMargin) return l; const { expected_unit_cost, ...rest } = l; return rest; });
      return { ...q, lines: visibleLines, totals: showMargin ? t : { net: t.net, tax: t.tax, total: t.total } };
    });
  }
  async listQuotes(ctx: RequestContext) { return this.db.run(ctx, (tx) => tx.q(`SELECT id, ref, revision, status, customer_party_id, currency, valid_until, version FROM commercial.quotes ${isExternal(ctx) ? 'WHERE customer_party_id=$1' : ''} ORDER BY created_at DESC LIMIT 200`, isExternal(ctx) ? [ctx.partyId] : [])); }
  async approveQuote(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const q = await tx.maybe(`SELECT * FROM commercial.quotes WHERE id=$1 FOR UPDATE`, [id]);
      if (!q) throw new DomainError('NOT_FOUND', 'Quote not found.');
      assertScope(ctx, 'quotes.approve', q.legal_entity_id); expectVersion(q.version, ctx);
      if (!canTransition(q.status, 'approved')) throw new DomainError('INVALID_STATE_TRANSITION', `Quote is ${q.status}.`);
      if (q.created_by === ctx.userId) throw new DomainError('SEPARATION_OF_DUTIES', 'A quotation cannot be approved by the person who prepared it.');
      await tx.q(`UPDATE commercial.quotes SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`, [id, ctx.userId]);
      await audit(tx, ctx, 'quote.approved', 'quote', id); await emit(tx, ctx, 'QuoteApproved', 'quote', id);
      return { id, status: 'approved', version: q.version + 1 };
    });
  }
  /** Acceptance, job opening, and the revenue / expected-cost charges commit in ONE transaction. */
  async acceptQuote(ctx: RequestContext, id: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const q = await tx.maybe(`SELECT * FROM commercial.quotes WHERE id=$1 FOR UPDATE`, [id]);
      if (!q || (isExternal(ctx) && q.customer_party_id !== ctx.partyId)) throw new DomainError('NOT_FOUND', 'Quote not found.');
      assertScope(ctx, 'quotes.accept', q.legal_entity_id); expectVersion(q.version, ctx);
      if (!canTransition(q.status, 'accepted')) throw new DomainError('INVALID_STATE_TRANSITION', `Quote is ${q.status}; only an approved quote can be accepted.`);
      if (new Date(q.valid_until) < new Date(new Date().toISOString().slice(0, 10))) throw new DomainError('INVALID_STATE_TRANSITION', 'Quote validity has expired.');
      await tx.q(`UPDATE commercial.quotes SET status='accepted', accepted_by=$2, accepted_at=now(), acceptance_evidence=$3::jsonb WHERE id=$1`, [id, ctx.userId, JSON.stringify(b)]);
      const job = await this.logistics.openJobFromQuote(tx, ctx, q);
      await audit(tx, ctx, 'quote.accepted', 'quote', id, { jobId: job.id, evidence: b.evidence });
      await emit(tx, ctx, 'QuoteAccepted', 'quote', id, { jobId: job.id });
      return { id, status: 'accepted', job };
    });
  }
}
