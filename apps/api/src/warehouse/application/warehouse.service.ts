import { Injectable, Inject } from '@nestjs/common';
import { D } from '@dbl/contracts';
import { audit, assertScope, DomainError, emit, Db, type RequestContext } from '../../platform';
import { TradeService } from '../../trade';
import { availableQty, evaluateRelease } from '../domain/release';

@Injectable()
export class WarehouseService {
  constructor(@Inject(Db) private db: Db, @Inject(TradeService) private trade: TradeService) {}

  private async facilityScope(tx: any, ctx: RequestContext, perm: any, facilityId: string) {
    const f = await tx.maybe(`SELECT legal_entity_id FROM org.facilities WHERE id=$1`, [facilityId]);
    if (!f) throw new DomainError('NOT_FOUND', 'Facility not found.'); assertScope(ctx, perm, f.legal_entity_id);
  }
  /** Receipt creates CUSTODY stock owned by the customer; commandKey makes retries harmless. */
  receive(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      await this.facilityScope(tx, ctx, 'warehouse.receive', b.facilityId);
      const dup = await tx.maybe(`SELECT lot_id FROM warehouse.custody_movements WHERE command_key=$1`, [b.commandKey]);
      if (dup) return { lotId: dup.lot_id, duplicate: true };
      const lot = await tx.one(`INSERT INTO warehouse.stock_lots(tenant_id, facility_id, location_id, owner_party_id, cargo_unit_id, description, batch, qty_on_hand, customs_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, b.facilityId, b.locationId ?? null, b.ownerPartyId, b.cargoUnitId ?? null, b.description, b.batch ?? null, b.quantity, b.customsStatus]);
      await tx.q(`INSERT INTO warehouse.custody_movements(tenant_id, lot_id, kind, qty, ref_type, command_key, actor_user_id) VALUES ($1,$2,'receipt',$3,'receipt',$4,$5)`, [ctx.tenantId, lot.id, b.quantity, b.commandKey, ctx.userId]);
      await audit(tx, ctx, 'cargo.received', 'stock_lot', lot.id, { qty: b.quantity }); await emit(tx, ctx, 'CargoReceived', 'stock_lot', lot.id, { qty: b.quantity });
      return { lotId: lot.id, duplicate: false };
    });
  }
  listLots(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT l.id, l.description, l.batch, l.qty_on_hand, l.qty_reserved, l.qty_on_hand - l.qty_reserved AS qty_available, l.condition, l.customs_status, l.owner_party_id, l.facility_id, l.version,
      EXISTS (SELECT 1 FROM warehouse.holds h WHERE h.lot_id=l.id AND h.released_at IS NULL) AS on_hold FROM warehouse.stock_lots l ORDER BY l.created_at DESC LIMIT 500`));
  }
  placeHold(ctx: RequestContext, lotId: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const pre = await tx.maybe(`SELECT facility_id FROM warehouse.stock_lots WHERE id=$1`, [lotId]); if (!pre) throw new DomainError('NOT_FOUND', 'Lot not found.');
      await this.facilityScope(tx, ctx, 'warehouse.hold.place', pre.facility_id);
      const h = await this.placeHoldInTx(tx, ctx, lotId, b.reason, b.kind);
      return { holdId: h.holdId, lotId, condition: b.kind === 'quarantine' ? 'quarantined' : 'good' };
    });
  }
  /** Reserve: the lot row lock serialises competing requests for the same stock. */
  requestRelease(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const lot = await tx.maybe(`SELECT * FROM warehouse.stock_lots WHERE id=$1 FOR UPDATE`, [b.lotId]); if (!lot) throw new DomainError('NOT_FOUND', 'Lot not found.');
      await this.facilityScope(tx, ctx, 'warehouse.release.request', lot.facility_id);
      const holds = Number((await tx.one(`SELECT count(*) n FROM warehouse.holds WHERE lot_id=$1 AND released_at IS NULL`, [b.lotId])).n);
      if (holds || lot.condition === 'quarantined') throw new DomainError('STOCK_ON_HOLD', 'Cargo is on hold / quarantined.');
      if (availableQty(lot).lt(b.qty)) throw new DomainError('INSUFFICIENT_STOCK', 'Not enough unreserved quantity.', { available: availableQty(lot).toFixed(4) });
      const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('release','REL') r`)).r;
      const o = await tx.one(`INSERT INTO warehouse.release_orders(tenant_id, ref, lot_id, qty, consignee, customs_case_id, requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, ref, status`, [ctx.tenantId, ref, b.lotId, b.qty, b.consignee ?? null, b.customsCaseId ?? null, ctx.userId]);
      await tx.q(`UPDATE warehouse.stock_lots SET qty_reserved = qty_reserved + $2 WHERE id=$1`, [b.lotId, b.qty]);
      await tx.q(`INSERT INTO warehouse.custody_movements(tenant_id, lot_id, kind, qty, ref_type, ref_id, command_key, actor_user_id) VALUES ($1,$2,'reserve',$3,'release_order',$4,$5,$6)`, [ctx.tenantId, b.lotId, b.qty, o.id, `reserve:${o.id}`, ctx.userId]);
      await audit(tx, ctx, 'release.requested', 'release_order', o.id); return o;
    });
  }
  /** Authorize + execute. Order row lock → lot row lock → verdict → movement. A second concurrent authorise finds status='released' and fails. */
  authorize(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const o = await tx.maybe(`SELECT * FROM warehouse.release_orders WHERE id=$1 FOR UPDATE`, [id]); if (!o) throw new DomainError('NOT_FOUND', 'Release order not found.');
      if (o.status !== 'requested') throw new DomainError('INVALID_STATE_TRANSITION', `Release order is ${o.status}; stock cannot be released twice.`);
      if (o.requested_by === ctx.userId) throw new DomainError('SEPARATION_OF_DUTIES', 'A release must be authorised by someone other than the requester.');
      const lot = await tx.one(`SELECT * FROM warehouse.stock_lots WHERE id=$1 FOR UPDATE`, [o.lot_id]);
      await this.facilityScope(tx, ctx, 'warehouse.release.authorize', lot.facility_id);
      const holds = Number((await tx.one(`SELECT count(*) n FROM warehouse.holds WHERE lot_id=$1 AND released_at IS NULL`, [lot.id])).n);
      let evidence = true;
      if (lot.customs_status === 'bonded') { try { await this.trade.assertReleaseEvidence(tx, o.customs_case_id); } catch { evidence = false; } }
      const v = evaluateRelease(lot, o.qty, holds, evidence);
      if (!v.ok) throw new DomainError(v.code, v.message);
      await tx.q(`UPDATE warehouse.stock_lots SET qty_on_hand = qty_on_hand - $2, qty_reserved = qty_reserved - $2 WHERE id=$1`, [lot.id, o.qty]);
      await tx.q(`INSERT INTO warehouse.custody_movements(tenant_id, lot_id, kind, qty, ref_type, ref_id, command_key, actor_user_id) VALUES ($1,$2,'release',$3,'release_order',$4,$5,$6)`, [ctx.tenantId, lot.id, o.qty, o.id, `release:${o.id}`, ctx.userId]);
      await tx.q(`UPDATE warehouse.release_orders SET status='released', authorized_by=$2, released_at=now() WHERE id=$1`, [id, ctx.userId]);
      await audit(tx, ctx, 'release.executed', 'release_order', id, { qty: o.qty }); await emit(tx, ctx, 'CargoReleased', 'release_order', id, { lotId: lot.id, qty: o.qty });
      return { id, status: 'released', remainingOnHand: D(lot.qty_on_hand).minus(o.qty).toFixed(4) };
    });
  }

  /** Shared by the warehouse API and the quality module (incident → hold) so every hold is created the same way. */
  async placeHoldInTx(tx: any, ctx: RequestContext, lotId: string, reason: string, kind: string) {
    const lot = await tx.maybe(`SELECT * FROM warehouse.stock_lots WHERE id=$1 FOR UPDATE`, [lotId]); if (!lot) throw new DomainError('NOT_FOUND', 'Lot not found.');
    const h = await tx.one(`INSERT INTO warehouse.holds(tenant_id, lot_id, reason, kind, placed_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [ctx.tenantId, lotId, reason, kind, ctx.userId]);
    if (kind === 'quarantine' || kind === 'quality') await tx.q(`UPDATE warehouse.stock_lots SET condition='quarantined' WHERE id=$1`, [lotId]);
    await audit(tx, ctx, 'stock.hold_placed', 'stock_lot', lotId, { reason, kind, holdId: h.id });
    return { holdId: h.id as string, facilityId: lot.facility_id as string };
  }
  /** A hold is released explicitly by a different person with the quality release permission — never because a sensor "went back in range". */
  releaseHold(ctx: RequestContext, holdId: string, note: string) {
    return this.db.run(ctx, async (tx) => {
      const h = await tx.maybe(`SELECT * FROM warehouse.holds WHERE id=$1 FOR UPDATE`, [holdId]); if (!h) throw new DomainError('NOT_FOUND', 'Hold not found.');
      if (h.released_at) throw new DomainError('INVALID_STATE_TRANSITION', 'Hold already released.');
      if (h.placed_by === ctx.userId) throw new DomainError('SEPARATION_OF_DUTIES', 'A hold cannot be released by the person who placed it.');
      await tx.q(`UPDATE warehouse.holds SET released_at=now(), released_by=$2, release_note=$3 WHERE id=$1`, [holdId, ctx.userId, note]);
      const left = await tx.maybe(`SELECT 1 FROM warehouse.holds WHERE lot_id=$1 AND released_at IS NULL`, [h.lot_id]);
      if (!left) await tx.q(`UPDATE warehouse.stock_lots SET condition='good' WHERE id=$1 AND condition='quarantined'`, [h.lot_id]);
      await audit(tx, ctx, 'stock.hold_released', 'stock_lot', h.lot_id, { holdId, note }); await emit(tx, ctx, 'HoldReleased', 'hold', holdId, { lotId: h.lot_id });
      return { id: holdId, released: true, lotAvailable: !left };
    });
  }
  listHolds(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT h.id, h.lot_id, l.description AS lot, h.kind, h.reason, h.placed_at, h.released_at, h.release_note, (h.released_at IS NULL) AS active FROM warehouse.holds h JOIN warehouse.stock_lots l ON l.id = h.lot_id ORDER BY (h.released_at IS NULL) DESC, h.placed_at DESC LIMIT 300`));
  }
  listReleaseOrders(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT o.id, o.ref, o.status, o.qty, o.consignee, o.customs_case_id, o.requested_by, o.authorized_by, o.released_at, l.description AS lot, l.customs_status FROM warehouse.release_orders o JOIN warehouse.stock_lots l ON l.id = o.lot_id ORDER BY o.created_at DESC LIMIT 300`));
  }
}
