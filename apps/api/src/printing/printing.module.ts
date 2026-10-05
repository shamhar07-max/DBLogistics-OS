import { Controller, Inject, Injectable, Module, Param, Res, StreamableFile } from '@nestjs/common';
import { TAX_RATES } from '@dbl/contracts';
import { renderInvoice, renderQuotation, renderShipmentReport, type Issuer, type Party } from '@dbl/documents';
import { audit, Ctx, Db, isExternal, Op, type RequestContext, type Tx } from '../platform';
import { CommercialModule, CommercialService } from '../commercial';
import { FinanceModule, FinanceService } from '../finance';
import { LogisticsModule, LogisticsService } from '../logistics';

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_');
interface Rendered { buffer: Buffer; filename: string }

/**
 * Branded PDFs. Authorisation and party scoping are NOT re-implemented here: every document is built from the output of the
 * owning service (getInvoice / getQuote / getShipment), so a customer can only print what they can already see.
 */
@Injectable()
export class PrintingService {
  constructor(@Inject(Db) private db: Db, @Inject(FinanceService) private finance: FinanceService, @Inject(CommercialService) private commercial: CommercialService, @Inject(LogisticsService) private logistics: LogisticsService) {}
  private issuer = async (tx: Tx, legalEntityId: string): Promise<Issuer> => {
    const e = await tx.one<any>(`SELECT name, trade_license, tax_registration_number, address, email, phone, website, bank_name, bank_account_name, bank_iban, bank_swift FROM org.legal_entities WHERE id=$1`, [legalEntityId]);
    return { name: e.name, licence: e.trade_license, trn: e.tax_registration_number, address: e.address, email: e.email, phone: e.phone, website: e.website, bank: { bankName: e.bank_name, accountName: e.bank_account_name, iban: e.bank_iban, swift: e.bank_swift } };
  };
  private party = async (tx: Tx, id: string): Promise<Party> => { const p = await tx.one<any>(`SELECT legal_name, trading_name, tax_registration_number, address, country FROM parties.parties WHERE id=$1`, [id]); return { name: p.legal_name, address: p.address, trn: p.tax_registration_number, country: p.country }; };

  async invoice(ctx: RequestContext, id: string): Promise<Rendered> {
    const i: any = await this.finance.getInvoice(ctx, id);                                    // scoped: customers only get posted invoices of their own company
    return this.db.run(ctx, async (tx) => {
      const meta = await tx.one<any>(`SELECT legal_entity_id FROM finance.invoices WHERE id=$1`, [id]);
      const buffer = await renderInvoice({ issuer: await this.issuer(tx, meta.legal_entity_id), customer: await this.party(tx, i.customer_party_id), number: i.ref, status: i.status, issueDate: i.posting_date, dueDate: i.due_date, currency: i.currency, jobRef: i.job_ref, einvoiceStatus: i.einvoice_status,
        lines: i.lines.map((l: any) => ({ description: l.description, net: l.net_amount, taxCode: l.tax_code, taxRate: l.tax_rate, tax: l.tax_amount })), subtotal: i.subtotal, taxTotal: i.tax_total, total: i.total, paid: i.amount_allocated, balance: i.balance });
      await audit(tx, ctx, 'invoice.pdf_generated', 'invoice', id); return { buffer, filename: `${safeName(i.ref ?? `draft-${id.slice(0, 8)}`)}.pdf` };
    });
  }
  async quotation(ctx: RequestContext, id: string): Promise<Rendered> {
    const q: any = await this.commercial.getQuote(ctx, id);
    return this.db.run(ctx, async (tx) => {
      const meta = await tx.one<any>(`SELECT legal_entity_id FROM commercial.quotes WHERE id=$1`, [id]);
      const buffer = await renderQuotation({ issuer: await this.issuer(tx, meta.legal_entity_id), customer: await this.party(tx, q.customer_party_id), number: q.ref, revision: q.revision, status: q.status, currency: q.currency, validUntil: String(q.valid_until).slice(0, 10), mode: q.mode, origin: q.origin, destination: q.destination, incoterm: q.incoterm,
        lines: q.lines.map((l: any) => ({ description: l.description, chargeType: l.charge_type, quantity: l.quantity, unit: l.unit, unitPrice: l.unit_price, taxCode: l.tax_code, taxRate: TAX_RATES[l.tax_code] ?? '0' })), totals: { net: q.totals.net, tax: q.totals.tax, total: q.totals.total } });     // expected cost / margin are never passed to the renderer
      await audit(tx, ctx, 'quotation.pdf_generated', 'quote', id); return { buffer, filename: `${safeName(q.ref)}-r${q.revision}.pdf` };
    });
  }
  async shipmentReport(ctx: RequestContext, id: string): Promise<Rendered> {
    const s: any = await this.logistics.getShipment(ctx, id); const tl: any = await this.logistics.timeline(ctx, id);
    return this.db.run(ctx, async (tx) => {
      const meta = await tx.one<any>(`SELECT j.legal_entity_id, j.customer_party_id FROM logistics.shipments s JOIN logistics.jobs j ON j.id = s.job_id WHERE s.id=$1`, [id]);
      const showCustomer = !isExternal(ctx) || ctx.workspace === 'customer';             // agents and transporters do not learn who the customer is
      const buffer = await renderShipmentReport({ issuer: await this.issuer(tx, meta.legal_entity_id), customer: showCustomer ? await this.party(tx, meta.customer_party_id) : null, ref: s.ref, jobRef: showCustomer ? s.job_ref : null, mode: s.mode, status: s.status, origin: s.origin, destination: s.destination, incoterm: s.incoterm, deliveredAt: s.delivered_at, currentMilestone: tl.currentMilestone,
        legs: s.legs.map((l: any) => ({ seq: l.seq, mode: l.mode, origin: l.origin, destination: l.destination, operator: l.operator, plannedArrival: l.planned_arrival, estimatedArrival: l.estimated_arrival, actualArrival: l.actual_arrival })),
        cargo: s.cargo.map((c: any) => ({ description: c.description, quantity: c.quantity, kind: c.kind, grossWeightKg: c.gross_weight_kg, hsCode: c.hs_code })), events: tl.events.map((e: any) => ({ code: e.code, time: e.event_time, source: e.source, actual: e.is_actual })) });
      await audit(tx, ctx, 'shipment.report_generated', 'shipment', id); return { buffer, filename: `${safeName(s.ref)}-status.pdf` };
    });
  }
}
const send = (res: any, r: Rendered) => { res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }); return new StreamableFile(r.buffer); };
@Controller()
export class PrintingController {
  constructor(@Inject(PrintingService) private s: PrintingService) {}
  @Op('getInvoicePdf') async inv(@Ctx() c: RequestContext, @Param('id') id: string, @Res({ passthrough: true }) res: any) { return send(res, await this.s.invoice(c, id)); }
  @Op('getQuotePdf') async quo(@Ctx() c: RequestContext, @Param('id') id: string, @Res({ passthrough: true }) res: any) { return send(res, await this.s.quotation(c, id)); }
  @Op('getShipmentReportPdf') async shp(@Ctx() c: RequestContext, @Param('id') id: string, @Res({ passthrough: true }) res: any) { return send(res, await this.s.shipmentReport(c, id)); }
}
@Module({ imports: [FinanceModule, CommercialModule, LogisticsModule], providers: [PrintingService], controllers: [PrintingController] })
export class PrintingModule {}
