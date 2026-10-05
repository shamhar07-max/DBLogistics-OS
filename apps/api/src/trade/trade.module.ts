import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, assertScope, Ctx, Db, DomainError, emit, Op, type RequestContext, type Tx } from '../platform';

@Injectable()
export class TradeService {
  constructor(@Inject(Db) private db: Db) {}
  createCase(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const j = await tx.maybe(`SELECT legal_entity_id FROM logistics.jobs WHERE id=$1`, [b.jobId]); if (!j) throw new DomainError('NOT_FOUND', 'Job not found.');
      assertScope(ctx, 'customs.manage', j.legal_entity_id);
      const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('customs','CUS') r`)).r;
      const c = await tx.one(`INSERT INTO trade.customs_cases(tenant_id, ref, job_id, shipment_id, importer_party_id, procedure) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, ref, internal_status, authority_status`, [ctx.tenantId, ref, b.jobId, b.shipmentId ?? null, b.importerPartyId, b.procedure]);
      await audit(tx, ctx, 'customs.case_opened', 'customs_case', c.id); return c;
    });
  }
  /** "Customs released" is only ever set with an APPROVED evidence document. Authority status is recorded as reported, separate from internal workflow. */
  recordRelease(ctx: RequestContext, id: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const c = await tx.maybe(`SELECT cc.*, j.legal_entity_id FROM trade.customs_cases cc JOIN logistics.jobs j ON j.id=cc.job_id WHERE cc.id=$1 FOR UPDATE OF cc`, [id]);
      if (!c) throw new DomainError('NOT_FOUND', 'Customs case not found.'); assertScope(ctx, 'customs.release.record', c.legal_entity_id);
      if (c.internal_status === 'release_recorded') return { id, internalStatus: 'release_recorded', authorityStatus: c.authority_status, duplicate: true };
      const d = await tx.maybe(`SELECT d.status, d.issuer_kind, v.scan_status FROM platform.documents d JOIN platform.document_versions v ON v.document_id=d.id WHERE d.id=$1 ORDER BY v.version_no DESC LIMIT 1`, [b.documentId]);
      if (!d || d.status !== 'approved' || d.scan_status !== 'clean') throw new DomainError('RELEASE_EVIDENCE_REQUIRED', 'Release cannot be recorded without an approved, scanned evidence document.');
      if (d.issuer_kind !== 'authority') throw new DomainError('RELEASE_EVIDENCE_REQUIRED', 'Evidence must be an authority-issued document (issuer kind: authority).');
      await tx.q(`INSERT INTO trade.release_evidence(tenant_id, case_id, document_id, authority_reference, recorded_by) VALUES ($1,$2,$3,$4,$5)`, [ctx.tenantId, id, b.documentId, b.authorityReference, ctx.userId]);
      await tx.q(`UPDATE trade.customs_cases SET internal_status='release_recorded', authority_status='released', authority_reference=$2 WHERE id=$1`, [id, b.authorityReference]);
      await audit(tx, ctx, 'customs.release_recorded', 'customs_case', id, { authorityReference: b.authorityReference }); await emit(tx, ctx, 'CustomsReleaseRecorded', 'customs_case', id, { jobId: c.job_id });
      return { id, internalStatus: 'release_recorded', authorityStatus: 'released', duplicate: false };
    });
  }
  listCases(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT c.id, c.ref, c.procedure, c.internal_status, c.authority_status, c.authority_reference, c.job_id, j.ref AS job_ref, p.legal_name AS importer, c.created_at, c.version,
      EXISTS (SELECT 1 FROM trade.release_evidence e WHERE e.case_id = c.id) AS has_evidence FROM trade.customs_cases c JOIN logistics.jobs j ON j.id = c.job_id JOIN parties.parties p ON p.id = c.importer_party_id ORDER BY c.created_at DESC LIMIT 300`));
  }
  /** Used by warehouse (public API of this module). */
  async assertReleaseEvidence(tx: Tx, caseId: string | null) {
    if (!caseId) throw new DomainError('RELEASE_EVIDENCE_REQUIRED', 'Bonded stock needs a customs case with recorded release evidence.');
    const e = await tx.maybe(`SELECT 1 FROM trade.release_evidence WHERE case_id=$1`, [caseId]);
    if (!e) throw new DomainError('RELEASE_EVIDENCE_REQUIRED', 'Customs release has not been recorded for this case.');
  }
}
@Controller()
export class TradeController {
  constructor(@Inject(TradeService) private s: TradeService) {}
  @Op('listCustomsCases') lc(@Ctx() c: RequestContext) { return this.s.listCases(c); }
  @Op('createCustomsCase') c(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createCase(c, b); }
  @Op('recordCustomsRelease') r(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.recordRelease(c, id, b); }
}
@Module({ providers: [TradeService], controllers: [TradeController], exports: [TradeService] }) export class TradeModule {}
