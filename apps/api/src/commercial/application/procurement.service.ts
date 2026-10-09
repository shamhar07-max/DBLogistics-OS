import { Inject, Injectable } from '@nestjs/common';
import type { Permission } from '@dbl/contracts';
import { audit, Db, DomainError, emit, expectVersion, isExternal, type RequestContext, type Tx } from '../../platform';

@Injectable()
export class ProcurementService {
  constructor(@Inject(Db) private db: Db) {}
  private grants(ctx: RequestContext, permission: Permission) {
    const grants = (ctx.permissions.get(permission) ?? []).filter(g => g.branchId === null);
    if (isExternal(ctx) || !grants.length) throw new DomainError('FORBIDDEN', 'Rate procurement requires an internal legal-entity grant.');
    return grants;
  }
  private scope(ctx: RequestContext, permission: Permission, entity: string) {
    if (!this.grants(ctx, permission).some(g => g.legalEntityId === null || g.legalEntityId === entity))
      throw new DomainError('FORBIDDEN', 'Rate procurement is outside your legal-entity scope.');
  }
  private async rfq(tx: Tx, ctx: RequestContext, id: string, permission: Permission, lock = false) {
    this.grants(ctx, permission);
    const r = await tx.maybe(`SELECT *, response_deadline > now() AS accepting_responses FROM commercial.rfqs WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [id]);
    if (!r) throw new DomainError('NOT_FOUND', 'Rate request not found.');
    this.scope(ctx, permission, r.legal_entity_id);
    return r;
  }
  async list(ctx: RequestContext) {
    const grants = this.grants(ctx, 'rates.view');
    return this.db.run(ctx, tx => tx.q(`SELECT r.*, (SELECT count(*)::int FROM commercial.rfq_offers o WHERE o.rfq_id=r.id) AS response_count
      FROM commercial.rfqs r WHERE $1::boolean OR legal_entity_id=ANY($2::uuid[]) ORDER BY created_at DESC,id LIMIT 200`,
    [grants.some(g => g.legalEntityId === null), grants.map(g => g.legalEntityId).filter(Boolean)]));
  }
  async get(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async tx => {
      const rfq = await this.rfq(tx, ctx, id, 'rates.view');
      const suppliers = await tx.q(`SELECT s.supplier_party_id, p.legal_name FROM commercial.rfq_suppliers s JOIN parties.parties p ON p.id=s.supplier_party_id WHERE s.rfq_id=$1 ORDER BY p.legal_name`, [id]);
      const history = await tx.q(`SELECT o.*, p.legal_name AS supplier_name,
        o.revision=max(o.revision) OVER (PARTITION BY o.supplier_party_id) AS latest,
        o.valid_until>=CURRENT_DATE AS valid
        FROM commercial.rfq_offers o JOIN parties.parties p ON p.id=o.supplier_party_id WHERE o.rfq_id=$1 ORDER BY o.created_at DESC,o.id`, [id]);
      // Same-currency amounts are PostgreSQL decimals. Do not compare decimal strings lexically or convert them to floats.
      const comparison = await tx.q(`SELECT o.*,p.legal_name AS supplier_name,o.valid_until>=CURRENT_DATE AS eligible
        FROM commercial.rfq_offers o JOIN parties.parties p ON p.id=o.supplier_party_id
        WHERE o.rfq_id=$1 AND NOT EXISTS (SELECT 1 FROM commercial.rfq_offers newer WHERE newer.rfq_id=o.rfq_id AND newer.supplier_party_id=o.supplier_party_id AND newer.revision>o.revision)
        ORDER BY (o.valid_until>=CURRENT_DATE) DESC,o.total,o.transit_days,o.id`, [id]);
      return { ...rfq, suppliers, comparison, history };
    });
  }
  async create(ctx: RequestContext, b: any) {
    this.scope(ctx, 'rates.manage', b.legalEntityId);
    return this.db.run(ctx, async tx => {
      const deadline = await tx.one(`SELECT $1::timestamptz > now() AS future`, [b.responseDeadline]);
      if (!deadline.future) throw new DomainError('VALIDATION_FAILED', 'Response deadline must be in the future.');
      const suppliers = await tx.q(`SELECT p.id FROM parties.parties p WHERE p.id=ANY($1::uuid[]) AND p.status='active'
        AND EXISTS (SELECT 1 FROM parties.party_roles pr WHERE pr.party_id=p.id AND pr.role IN ('supplier','carrier','agent'))`, [b.supplierPartyIds]);
      if (suppliers.length !== b.supplierPartyIds.length) throw new DomainError('VALIDATION_FAILED', 'Invite active suppliers, carriers or agents belonging to this tenant.');
      const { ref } = await tx.one(`SELECT platform.next_ref('rfq','RFQ') AS ref`);
      const r = await tx.one(`INSERT INTO commercial.rfqs(tenant_id,legal_entity_id,ref,mode,origin,destination,requirements,currency,response_deadline,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [ctx.tenantId,b.legalEntityId,ref,b.mode,b.origin,b.destination,b.requirements,b.currency,b.responseDeadline,ctx.userId]);
      for (const supplier of b.supplierPartyIds) await tx.q(`INSERT INTO commercial.rfq_suppliers(tenant_id,rfq_id,supplier_party_id) VALUES ($1,$2,$3)`, [ctx.tenantId,r.id,supplier]);
      await audit(tx, ctx, 'rfq.created', 'rfq', r.id, { supplierCount: suppliers.length });
      return r;
    });
  }
  async issue(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async tx => {
      const r = await this.rfq(tx, ctx, id, 'rates.manage', true); expectVersion(r.version, ctx);
      if (r.status !== 'draft' || !r.accepting_responses) throw new DomainError('INVALID_STATE_TRANSITION', 'Only a draft with a future deadline can be issued.');
      const out = await tx.one(`UPDATE commercial.rfqs SET status='issued',issued_at=now() WHERE id=$1 RETURNING *`, [id]);
      await audit(tx, ctx, 'rfq.issued', 'rfq', id, { distribution: 'manual' });
      await emit(tx, ctx, 'RfqIssued', 'rfq', id, { distribution: 'manual' });
      return out;
    });
  }
  async offer(ctx: RequestContext, id: string, b: any) {
    return this.db.run(ctx, async tx => {
      const r = await this.rfq(tx, ctx, id, 'rates.manage', true);
      if (r.status !== 'issued' || !r.accepting_responses) throw new DomainError('INVALID_STATE_TRANSITION', 'Responses require an issued request before its deadline.');
      if (!await tx.maybe(`SELECT 1 FROM commercial.rfq_suppliers s JOIN parties.parties p ON p.id=s.supplier_party_id WHERE s.rfq_id=$1 AND s.supplier_party_id=$2 AND p.status='active'`, [id,b.supplierPartyId]))
        throw new DomainError('VALIDATION_FAILED', 'Supplier is not invited or is inactive.');
      if (!(await tx.one(`SELECT $1::date >= CURRENT_DATE AS valid`, [b.validUntil])).valid) throw new DomainError('VALIDATION_FAILED', 'Response validity has expired.');
      const o = await tx.one(`INSERT INTO commercial.rfq_offers(tenant_id,rfq_id,supplier_party_id,revision,freight,local_charges,transit_days,free_days,valid_until,terms,created_by)
        SELECT $1,$2,$3,COALESCE(max(revision),0)+1,$4,$5,$6,$7,$8,$9,$10 FROM commercial.rfq_offers WHERE rfq_id=$2 AND supplier_party_id=$3 RETURNING *`,
      [ctx.tenantId,id,b.supplierPartyId,b.freight,b.localCharges,b.transitDays,b.freeDays,b.validUntil,b.terms,ctx.userId]);
      await audit(tx, ctx, 'rfq.offer-recorded', 'rfq', id, { offerId: o.id, revision: o.revision });
      return o;
    });
  }
  async award(ctx: RequestContext, id: string, b: any) {
    return this.db.run(ctx, async tx => {
      const r = await this.rfq(tx, ctx, id, 'rates.manage', true); expectVersion(r.version, ctx);
      if (r.status !== 'issued') throw new DomainError('INVALID_STATE_TRANSITION', 'Only an issued request can be awarded.');
      const offer = await tx.maybe(`SELECT o.*,o.valid_until>=CURRENT_DATE AS valid,p.status AS supplier_status FROM commercial.rfq_offers o JOIN parties.parties p ON p.id=o.supplier_party_id WHERE o.rfq_id=$1 AND o.id=$2`, [id,b.offerId]);
      if (!offer) throw new DomainError('NOT_FOUND', 'Response not found in this request.');
      if (r.created_by === ctx.userId || offer.created_by === ctx.userId) throw new DomainError('SEPARATION_OF_DUTIES', 'The request author and response recorder cannot award their own work.');
      if (!offer.valid || offer.supplier_status !== 'active') throw new DomainError('INVALID_STATE_TRANSITION', 'Select a valid response from an active supplier.');
      if (await tx.maybe(`SELECT 1 FROM commercial.rfq_offers WHERE rfq_id=$1 AND supplier_party_id=$2 AND revision>$3`, [id,offer.supplier_party_id,offer.revision])) throw new DomainError('INVALID_STATE_TRANSITION', 'Select the latest supplier revision.');
      const rate = await tx.one(`INSERT INTO commercial.rate_versions(tenant_id,supplier_party_id,lane,service,billing_unit,amount,currency,valid_from,valid_to,conditions)
        VALUES ($1,$2,$3,$4,'shipment',$5,$6,CURRENT_DATE,$7,$8::jsonb) RETURNING id`,
      [ctx.tenantId,offer.supplier_party_id,`${r.origin} → ${r.destination}`,r.mode,offer.total,r.currency,offer.valid_until,
        JSON.stringify({ rfqId: id, offerId: offer.id, freight: offer.freight, localCharges: offer.local_charges, transitDays: offer.transit_days, freeDays: offer.free_days, terms: offer.terms })]);
      const out = await tx.one(`UPDATE commercial.rfqs SET status='awarded',awarded_offer_id=$2,awarded_rate_id=$3,awarded_by=$4,awarded_at=now(),award_reason=$5 WHERE id=$1 RETURNING *`, [id,offer.id,rate.id,ctx.userId,b.reason]);
      await audit(tx, ctx, 'rfq.awarded', 'rfq', id, { offerId: offer.id, rateId: rate.id, reason: b.reason });
      await emit(tx, ctx, 'RfqAwarded', 'rfq', id, { offerId: offer.id, rateId: rate.id });
      return out;
    });
  }
}
