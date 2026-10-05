import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { audit, assertScope, DomainError, emit, Db, expectVersion, isExternal, type RequestContext, type Tx } from '../../platform';
import { FinanceService } from '../../finance';
import { canBooking, canShipment, currentMilestone } from '../domain/lifecycle';

@Injectable()
export class LogisticsService {
  constructor(@Inject(Db) private db: Db, @Inject(FinanceService) private finance: FinanceService) {}

  /** Called by commercial inside the quote-acceptance transaction. */
  async openJobFromQuote(tx: Tx, ctx: RequestContext, q: any) {
    const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('job','JOB') r`)).r;
    const job = await tx.one(`INSERT INTO logistics.jobs(tenant_id, legal_entity_id, ref, quote_id, customer_party_id, currency, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, ref, status`,
      [ctx.tenantId, q.legal_entity_id, ref, q.id, q.customer_party_id, q.currency, ctx.userId]);          // UNIQUE(tenant, quote_id): one job per accepted quote
    const lines = await tx.q(`SELECT * FROM commercial.quote_lines WHERE quote_id=$1 ORDER BY seq`, [q.id]);
    await this.finance.createChargesFromQuote(tx, ctx, job.id, { id: q.id, currency: q.currency }, lines);
    await audit(tx, ctx, 'job.opened', 'job', job.id, { quoteId: q.id }); await emit(tx, ctx, 'JobOpened', 'job', job.id, { quoteId: q.id });
    return job;
  }

  private scope(ctx: RequestContext, alias = 'j') { return isExternal(ctx) ? { sql: ` AND ${alias}.customer_party_id = $2`, args: [ctx.partyId] } : { sql: '', args: [] as unknown[] }; }
  async listJobs(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT id, ref, status, finance_status, customer_party_id, currency, version, created_at FROM logistics.jobs j WHERE true ${isExternal(ctx) ? 'AND customer_party_id=$1' : ''} ORDER BY created_at DESC LIMIT 200`, isExternal(ctx) ? [ctx.partyId] : []));
  }
  async getJob(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const j = await tx.maybe(`SELECT * FROM logistics.jobs j WHERE id=$1 ${this.scope(ctx).sql.replace('$2', '$2')}`, [id, ...this.scope(ctx).args]);
      if (!j) throw new DomainError('NOT_FOUND', 'Job not found.');
      const shipments = await tx.q(`SELECT id, ref, mode, origin, destination, status, documents_status, delivered_at, version FROM logistics.shipments WHERE job_id=$1 ORDER BY created_at`, [id]);
      return { ...j, shipments };
    });
  }

  async createShipment(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const job = await tx.maybe(`SELECT * FROM logistics.jobs WHERE id=$1 FOR UPDATE`, [b.jobId]);
      if (!job) throw new DomainError('NOT_FOUND', 'Job not found.');
      assertScope(ctx, 'shipments.create', job.legal_entity_id);
      if (['closed', 'cancelled'].includes(job.status)) throw new DomainError('INVALID_STATE_TRANSITION', `Job is ${job.status}.`);
      const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('shipment','SHP') r`)).r;
      const s = await tx.one(`INSERT INTO logistics.shipments(tenant_id, job_id, ref, mode, origin, destination, incoterm) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, ref, status, version`, [ctx.tenantId, b.jobId, ref, b.mode, b.origin, b.destination, b.incoterm ?? null]);
      const cargo: any[] = [];
      for (const c of b.cargo) cargo.push(await tx.one(`INSERT INTO logistics.cargo_units(tenant_id, shipment_id, kind, description, quantity, gross_weight_kg, owner_party_id, hs_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [ctx.tenantId, s.id, c.kind, c.description, c.quantity, c.grossWeightKg ?? null, c.ownerPartyId, c.hsCode ?? null]));
      let seq = 1; for (const l of b.legs) await tx.q(`INSERT INTO logistics.legs(tenant_id, shipment_id, seq, mode, operator_party_id, origin, destination) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.tenantId, s.id, seq++, l.mode, l.operatorPartyId ?? null, l.origin, l.destination]);
      if (job.status === 'open') await tx.q(`UPDATE logistics.jobs SET status='executing' WHERE id=$1`, [b.jobId]);
      await audit(tx, ctx, 'shipment.created', 'shipment', s.id); return { ...s, cargo: cargo.map((c) => c.id) };
    });
  }
  async timeline(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const s = await tx.maybe(`SELECT s.id, s.status, j.customer_party_id FROM logistics.shipments s JOIN logistics.jobs j ON j.id=s.job_id WHERE s.id=$1`, [id]);
      if (!s || (isExternal(ctx) && s.customer_party_id !== ctx.partyId)) throw new DomainError('NOT_FOUND', 'Shipment not found.');
      const events = await tx.q(`SELECT code, event_time, received_at, source, is_actual, external_event_id, detail FROM logistics.tracking_events WHERE shipment_id=$1 ORDER BY event_time, received_at`, [id]);
      return { shipmentId: id, status: s.status, currentMilestone: currentMilestone(events as any), events: events.map((e: any) => ({ ...e, kind: e.is_actual ? 'actual' : 'estimated' })) };
    });
  }
  async recordEvent(ctx: RequestContext, shipmentId: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const s = await tx.maybe(`SELECT s.*, j.legal_entity_id FROM logistics.shipments s JOIN logistics.jobs j ON j.id=s.job_id WHERE s.id=$1 FOR UPDATE OF s`, [shipmentId]);
      if (!s) throw new DomainError('NOT_FOUND', 'Shipment not found.');
      assertScope(ctx, 'shipments.events.record', s.legal_entity_id);
      const ev = await tx.maybe(`INSERT INTO logistics.tracking_events(tenant_id, shipment_id, code, event_time, source, is_actual, external_event_id, detail) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
                                 ON CONFLICT (tenant_id, source, external_event_id) DO NOTHING RETURNING id`, [ctx.tenantId, shipmentId, b.code, b.eventTime, b.source, b.isActual, b.externalEventId ?? null, JSON.stringify(b.detail)]);
      if (!ev) return { duplicate: true };
      if (b.isActual && s.status === 'planned' && ['DEPARTED', 'LOADED', 'PICKED_UP'].includes(b.code) && canShipment('planned', 'executing')) await tx.q(`UPDATE logistics.shipments SET status='executing' WHERE id=$1`, [shipmentId]);
      await emit(tx, ctx, 'ShipmentEventRecorded', 'shipment', shipmentId, { code: b.code, actual: b.isActual, source: b.source });
      return { duplicate: false, id: ev.id };
    });
  }
  async completeDelivery(ctx: RequestContext, shipmentId: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const s = await tx.maybe(`SELECT s.*, j.legal_entity_id FROM logistics.shipments s JOIN logistics.jobs j ON j.id=s.job_id WHERE s.id=$1 FOR UPDATE OF s`, [shipmentId]);
      if (!s) throw new DomainError('NOT_FOUND', 'Shipment not found.');
      assertScope(ctx, 'shipments.delivery.complete', s.legal_entity_id);
      if (!canShipment(s.status, 'delivered')) throw new DomainError('INVALID_STATE_TRANSITION', `Shipment is ${s.status}.`);
      const pod = await tx.maybe(`SELECT d.status, v.scan_status FROM platform.documents d JOIN platform.document_versions v ON v.document_id=d.id WHERE d.id=$1 AND d.related_type='shipment' AND d.related_id=$2 ORDER BY v.version_no DESC LIMIT 1`, [b.podDocumentId, shipmentId]);
      if (!pod || pod.status !== 'approved' || pod.scan_status !== 'clean') throw new DomainError('DOCUMENT_NOT_CLEAN', 'An approved, scanned proof of delivery for this shipment is required.');
      await tx.q(`UPDATE logistics.shipments SET status='delivered', delivered_at=$2, documents_status='approved' WHERE id=$1`, [shipmentId, b.deliveredAt]);
      await tx.q(`INSERT INTO logistics.tracking_events(tenant_id, shipment_id, code, event_time, source, is_actual) VALUES ($1,$2,'DELIVERED',$3,'manual',true)`, [ctx.tenantId, shipmentId, b.deliveredAt]);
      const pending = await tx.maybe(`SELECT 1 FROM logistics.shipments WHERE job_id=$1 AND status NOT IN ('delivered','cancelled')`, [s.job_id]);
      if (!pending) await tx.q(`UPDATE logistics.jobs SET status='delivered' WHERE id=$1 AND status IN ('open','executing')`, [s.job_id]);
      await audit(tx, ctx, 'shipment.delivered', 'shipment', shipmentId, { podDocumentId: b.podDocumentId }); await emit(tx, ctx, 'DeliveryCompleted', 'shipment', shipmentId, { jobId: s.job_id });
      return { id: shipmentId, status: 'delivered', jobStatus: pending ? 'executing' : 'delivered' };
    });
  }

  async requestBooking(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const s = await tx.maybe(`SELECT s.id, j.legal_entity_id FROM logistics.shipments s JOIN logistics.jobs j ON j.id=s.job_id WHERE s.id=$1`, [b.shipmentId]);
      if (!s) throw new DomainError('NOT_FOUND', 'Shipment not found.'); assertScope(ctx, 'bookings.create', s.legal_entity_id);
      const same = await tx.maybe(`SELECT * FROM logistics.bookings WHERE request_key=$1`, [b.requestKey]);
      if (same) return { ...same, duplicate: true };
      const unknown = await tx.maybe(`SELECT id FROM logistics.bookings WHERE shipment_id=$1 AND carrier_party_id=$2 AND outcome_unknown AND status='requested'`, [b.shipmentId, b.carrierPartyId]);
      if (unknown) throw new DomainError('BOOKING_OUTCOME_UNKNOWN', 'A previous booking request to this carrier has an unknown outcome. Reconcile it before submitting again.', { bookingId: unknown.id });
      const bk = await tx.one(`INSERT INTO logistics.bookings(tenant_id, shipment_id, carrier_party_id, request_key) VALUES ($1,$2,$3,$4) RETURNING id, status, version`, [ctx.tenantId, b.shipmentId, b.carrierPartyId, b.requestKey]);
      await emit(tx, ctx, 'BookingRequested', 'booking', bk.id); await audit(tx, ctx, 'booking.requested', 'booking', bk.id); return { ...bk, duplicate: false };
    });
  }
  async markOutcomeUnknown(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => { await tx.one(`UPDATE logistics.bookings SET outcome_unknown=true WHERE id=$1 AND status='requested' RETURNING id`, [id]); await audit(tx, ctx, 'booking.outcome_unknown', 'booking', id); return { id, outcomeUnknown: true }; });
  }
  async confirmBooking(ctx: RequestContext, id: string, externalRef: string) {
    return this.db.run(ctx, async (tx) => {
      const bk = await tx.maybe(`SELECT b.*, j.legal_entity_id FROM logistics.bookings b JOIN logistics.shipments s ON s.id=b.shipment_id JOIN logistics.jobs j ON j.id=s.job_id WHERE b.id=$1 FOR UPDATE OF b`, [id]);
      if (!bk) throw new DomainError('NOT_FOUND', 'Booking not found.'); assertScope(ctx, 'bookings.confirm', bk.legal_entity_id); expectVersion(bk.version, ctx);
      if (!canBooking(bk.status, 'confirmed')) throw new DomainError('INVALID_STATE_TRANSITION', `Booking is ${bk.status}.`);
      await tx.q(`UPDATE logistics.bookings SET status='confirmed', external_ref=$2, outcome_unknown=false WHERE id=$1`, [id, externalRef]);
      await audit(tx, ctx, 'booking.confirmed', 'booking', id, { externalRef }); await emit(tx, ctx, 'BookingConfirmed', 'booking', id, { externalRef });
      return { id, status: 'confirmed', version: bk.version + 1 };
    });
  }

  /** Closure requires: shipments delivered/cancelled, finance blockers resolved OR explicitly acknowledged. */
  async closeJob(ctx: RequestContext, id: string, acknowledged: string[]) {
    return this.db.run(ctx, async (tx) => {
      const j = await tx.maybe(`SELECT * FROM logistics.jobs WHERE id=$1 FOR UPDATE`, [id]);
      if (!j) throw new DomainError('NOT_FOUND', 'Job not found.'); assertScope(ctx, 'jobs.close', j.legal_entity_id); expectVersion(j.version, ctx);
      if (j.status === 'closed') throw new DomainError('INVALID_STATE_TRANSITION', 'Job is already closed.');
      const blockers: Array<{ key: string; message: string }> = [];
      const open = await tx.one(`SELECT count(*) n FROM logistics.shipments WHERE job_id=$1 AND status NOT IN ('delivered','cancelled')`, [id]);
      if (Number(open.n)) blockers.push({ key: 'shipments_open', message: `${open.n} shipment(s) not delivered` });
      blockers.push(...(await this.finance.closureBlockers(tx, id)));
      const hard = blockers.filter((b) => b.key === 'shipments_open' || b.key === 'unposted_invoices');       // never acknowledgeable
      const unresolved = blockers.filter((b) => !acknowledged.includes(b.key));
      if (hard.length || unresolved.length) throw new DomainError('JOB_NOT_CLOSABLE', 'Resolve or explicitly acknowledge the outstanding items.', { blockers: unresolved.length ? unresolved : hard });
      await tx.q(`UPDATE logistics.jobs SET status='closed', finance_status='closed', closed_at=now(), closure_notes=$2::jsonb WHERE id=$1`, [id, JSON.stringify({ acknowledged, blockers })]);
      await audit(tx, ctx, 'job.closed', 'job', id, { acknowledged }); await emit(tx, ctx, 'JobClosed', 'job', id, { acknowledged });
      return { id, status: 'closed', acknowledged };
    });
  }
}
