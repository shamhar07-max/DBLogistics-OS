import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, Ctx, Db, DomainError, emit, Op, Qry, type RequestContext } from '../platform';
import { WarehouseModule, WarehouseService } from '../warehouse';

@Injectable()
export class QualityService {
  constructor(@Inject(Db) private db: Db, @Inject(WarehouseService) private wh: WarehouseService) {}
  list(ctx: RequestContext, q: { jobId?: string; relatedId?: string; status?: string }) {
    const w: string[] = []; const a: unknown[] = []; const add = (c: string, v: unknown) => { a.push(v); w.push(c.replaceAll('?', `$${a.length}`)); };
    if (q.jobId) add('i.job_id = ?', q.jobId); if (q.relatedId) add('(i.shipment_id = ? OR i.lot_id = ?)', q.relatedId); if (q.status) add('i.status = ?', q.status);
    return this.db.run(ctx, (tx) => tx.q(`SELECT i.id, i.ref, i.kind, i.severity, i.status, i.description, i.job_id, i.shipment_id, i.lot_id, i.hold_id, i.resolution_note, i.created_at, i.resolved_at, i.version,
        (h.id IS NOT NULL AND h.released_at IS NULL) AS hold_active, j.ref AS job_ref FROM quality.incidents i LEFT JOIN warehouse.holds h ON h.id = i.hold_id LEFT JOIN logistics.jobs j ON j.id = i.job_id
        ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY (i.status = 'resolved'), i.created_at DESC LIMIT 300`, a));
  }
  /** Reporting an incident can place a QUALITY hold on the affected lot in the same transaction. */
  create(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('incident','INC') r`)).r; let holdId: string | null = null;
      if (b.placeHold) { if (!b.lotId) throw new DomainError('VALIDATION_FAILED', 'placeHold needs a lotId.'); holdId = (await this.wh.placeHoldInTx(tx, ctx, b.lotId, `${b.kind}: ${b.description}`.slice(0, 200), 'quality')).holdId; }
      const i = await tx.one(`INSERT INTO quality.incidents(tenant_id, ref, kind, severity, description, job_id, shipment_id, lot_id, hold_id, reported_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, ref, status, hold_id`,
        [ctx.tenantId, ref, b.kind, b.severity, b.description, b.jobId ?? null, b.shipmentId ?? null, b.lotId ?? null, holdId, ctx.userId]);
      await audit(tx, ctx, 'incident.reported', 'incident', i.id, { kind: b.kind, holdPlaced: !!holdId }); await emit(tx, ctx, 'IncidentReported', 'incident', i.id, { kind: b.kind, severity: b.severity });
      return i;
    });
  }
  investigate(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const i = await tx.maybe(`SELECT * FROM quality.incidents WHERE id=$1 FOR UPDATE`, [id]); if (!i) throw new DomainError('NOT_FOUND', 'Incident not found.');
      if (i.status !== 'open') throw new DomainError('INVALID_STATE_TRANSITION', `Incident is ${i.status}.`);
      await tx.q(`UPDATE quality.incidents SET status='investigating' WHERE id=$1`, [id]); await audit(tx, ctx, 'incident.investigating', 'incident', id); return { id, status: 'investigating' };
    });
  }
  /** Resolving documents the outcome. It does NOT release the hold: the hold needs its own, separately authorised release. */
  resolve(ctx: RequestContext, id: string, note: string) {
    return this.db.run(ctx, async (tx) => {
      const i = await tx.maybe(`SELECT * FROM quality.incidents WHERE id=$1 FOR UPDATE`, [id]); if (!i) throw new DomainError('NOT_FOUND', 'Incident not found.');
      if (i.status === 'resolved') throw new DomainError('INVALID_STATE_TRANSITION', 'Incident already resolved.');
      await tx.q(`UPDATE quality.incidents SET status='resolved', resolution_note=$2, resolved_by=$3, resolved_at=now() WHERE id=$1`, [id, note, ctx.userId]);
      const hold = i.hold_id ? await tx.maybe(`SELECT released_at FROM warehouse.holds WHERE id=$1`, [i.hold_id]) : null;
      await audit(tx, ctx, 'incident.resolved', 'incident', id); await emit(tx, ctx, 'IncidentResolved', 'incident', id, {});
      return { id, status: 'resolved', holdStillActive: !!hold && !hold.released_at };
    });
  }
  createClaim(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      if (!(await tx.maybe(`SELECT 1 FROM quality.incidents WHERE id=$1`, [b.incidentId]))) throw new DomainError('NOT_FOUND', 'Incident not found.');
      const c = await tx.one(`INSERT INTO quality.claims(tenant_id, incident_id, claimant_party_id, insurer_party_id, amount, currency, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, status`, [ctx.tenantId, b.incidentId, b.claimantPartyId ?? null, b.insurerPartyId ?? null, b.amount, b.currency, ctx.userId]);
      await audit(tx, ctx, 'claim.opened', 'claim', c.id, { incidentId: b.incidentId, amount: b.amount }); return c;
    });
  }
  listClaims(ctx: RequestContext) { return this.db.run(ctx, (tx) => tx.q(`SELECT c.id, c.status, c.amount, c.currency, c.incident_id, i.ref AS incident_ref, i.kind, c.created_at FROM quality.claims c JOIN quality.incidents i ON i.id = c.incident_id ORDER BY c.created_at DESC LIMIT 300`)); }
}
@Controller()
export class QualityController {
  constructor(@Inject(QualityService) private s: QualityService) {}
  @Op('listIncidents') li(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.list(c, q); }
  @Op('createIncident') ci(@Ctx() c: RequestContext, @Body() b: any) { return this.s.create(c, b); }
  @Op('investigateIncident') ii(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.investigate(c, id); }
  @Op('resolveIncident') ri(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.resolve(c, id, b.resolutionNote); }
  @Op('listClaims') lc(@Ctx() c: RequestContext) { return this.s.listClaims(c); }
  @Op('createClaim') cc(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createClaim(c, b); }
}
@Module({ imports: [WarehouseModule], providers: [QualityService], controllers: [QualityController] }) export class QualityModule {}
