import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { audit, canTouch, Ctx, Db, DomainError, documentVisibility, emit, expectVersion, externalIssuerKind, isExternal, Op, Qry, STORAGE, type RequestContext, type StoragePort } from '../platform';

@Injectable()
export class DocumentsService {
  constructor(@Inject(Db) private db: Db, @Inject(STORAGE) private storage: StoragePort) {}
  /** 1. authorise a direct-to-storage upload into a private location. */
  createUploadIntent(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const key = `${ctx.tenantId}/incoming/${randomUUID()}`;
      const i = await tx.one(`INSERT INTO platform.upload_intents(tenant_id, storage_key, content_type, max_bytes, created_by, expires_at) VALUES ($1,$2,$3,$4,$5, now() + interval '15 minutes') RETURNING id, expires_at`, [ctx.tenantId, key, b.contentType, b.sizeBytes, ctx.userId]);
      return { intentId: i.id, uploadUrl: await this.storage.presignUpload(key, b.contentType, 900), expiresAt: i.expires_at };
    });
  }
  /** 2. after upload: verify object, create document + immutable version (scan pending until the worker marks it clean). */
  register(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const i = await tx.maybe(`SELECT * FROM platform.upload_intents WHERE id=$1 FOR UPDATE`, [b.intentId]);
      if (!i || i.created_by !== ctx.userId) throw new DomainError('NOT_FOUND', 'Upload intent not found.');
      if (i.consumed_at) throw new DomainError('DUPLICATE', 'Upload intent already used.');
      if (new Date(i.expires_at) < new Date()) throw new DomainError('VALIDATION_FAILED', 'Upload intent expired.');
      if (isExternal(ctx)) {                                              // portal uploads: only onto records they can see, and never claiming to be an authority/internal issuer
        if (!(await canTouch(tx, ctx, b.relatedType, b.relatedId))) throw new DomainError('NOT_FOUND', 'Record not found.');
        const kind = externalIssuerKind(ctx); if (!kind) throw new DomainError('FORBIDDEN', 'This workspace cannot upload documents.'); b = { ...b, issuerKind: kind };
      }
      const head = await this.storage.head(i.storage_key);
      if (!head) throw new DomainError('VALIDATION_FAILED', 'File was not uploaded.');
      if (head.size > Number(i.max_bytes)) throw new DomainError('VALIDATION_FAILED', 'File is larger than authorised.');
      const d = await tx.one(`INSERT INTO platform.documents(tenant_id, doc_type, issuer_kind, issuer_name, external_reference, related_type, related_id, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'received',$8) RETURNING id, version`,
        [ctx.tenantId, b.docType, b.issuerKind, b.issuerName ?? null, b.externalReference ?? null, b.relatedType, b.relatedId, ctx.userId]);
      const v = await tx.one(`INSERT INTO platform.document_versions(tenant_id, document_id, version_no, storage_key, sha256, size_bytes, content_type) VALUES ($1,$2,1,$3,$4,$5,$6) RETURNING id`, [ctx.tenantId, d.id, i.storage_key, b.sha256, head.size, i.content_type]);
      await tx.q(`UPDATE platform.upload_intents SET consumed_at=now() WHERE id=$1`, [b.intentId]);
      await audit(tx, ctx, 'document.registered', 'document', d.id, { docType: b.docType, sha256: b.sha256 }); await emit(tx, ctx, 'DocumentApproved', 'document', d.id, { stage: 'registered', versionId: v.id });
      return { id: d.id, versionId: v.id, version: d.version, scanStatus: 'pending' };
    });
  }
  list(ctx: RequestContext, q: { relatedType?: string; relatedId?: string; docType?: string }) {
    const w: string[] = []; const a: unknown[] = []; const add = (c: string, v: unknown) => { a.push(v); w.push(c.replace('?', `$${a.length}`)); };
    if (isExternal(ctx)) { a.push(ctx.userId, ctx.partyId); w.push(documentVisibility(ctx, 'd', 1, 2)); }
    if (q.relatedType) add('d.related_type = ?', q.relatedType); if (q.relatedId) add('d.related_id = ?', q.relatedId); if (q.docType) add('d.doc_type = ?', q.docType);
    return this.db.run(ctx, (tx) => tx.q(`SELECT d.id, d.doc_type, d.issuer_kind, d.issuer_name, d.external_reference, d.related_type, d.related_id, d.status, d.version, d.created_at, d.approved_at, v.scan_status, v.size_bytes, v.content_type, v.sha256
      FROM platform.documents d JOIN LATERAL (SELECT * FROM platform.document_versions WHERE document_id = d.id ORDER BY version_no DESC LIMIT 1) v ON true ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY d.created_at DESC LIMIT 300`, a));
  }
  /** Signed, short-lived download — only for versions that passed the scan. */
  downloadUrl(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const v = await tx.maybe(`SELECT v.storage_key, v.scan_status, v.sha256, v.content_type FROM platform.document_versions v JOIN platform.documents d ON d.id = v.document_id WHERE v.document_id=$1 AND ${documentVisibility(ctx, 'd', 2, 3)} ORDER BY v.version_no DESC LIMIT 1`, isExternal(ctx) ? [id, ctx.userId, ctx.partyId] : [id]);
      if (!v) throw new DomainError('NOT_FOUND', 'Document not found.');
      if (v.scan_status !== 'clean') throw new DomainError('DOCUMENT_NOT_CLEAN', 'The document has not passed the malware scan.', { scanStatus: v.scan_status });
      await audit(tx, ctx, 'document.downloaded', 'document', id);
      return { url: await this.storage.presignDownload(v.storage_key, 300), expiresInSeconds: 300, sha256: v.sha256, contentType: v.content_type };
    });
  }
  /** OCR / text-layer output for the latest version. Staff only; derived data that a human still has to confirm. */
  extraction(ctx: RequestContext, id: string) {
    if (isExternal(ctx)) throw new DomainError('NOT_FOUND', 'Document not found.');
    return this.db.run(ctx, async (tx) => {
      const v = await tx.maybe(`SELECT v.id, v.scan_status, x.engine, x.status, x.page_count, x.text, x.fields, x.confidence, x.error, x.created_at
        FROM platform.document_versions v LEFT JOIN platform.document_extractions x ON x.document_version_id = v.id WHERE v.document_id=$1 ORDER BY v.version_no DESC LIMIT 1`, [id]);
      if (!v) throw new DomainError('NOT_FOUND', 'Document not found.');
      if (!v.status) return { versionId: v.id, status: v.scan_status === 'clean' ? 'pending' : v.scan_status === 'pending' ? 'waiting_for_scan' : 'not_available', fields: {}, text: null };
      return { versionId: v.id, status: v.status, engine: v.engine, pageCount: v.page_count, text: v.text, fields: v.fields, confidence: v.confidence === null ? null : Number(v.confidence), error: v.error, extractedAt: v.created_at };
    });
  }
  approve(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const d = await tx.maybe(`SELECT * FROM platform.documents WHERE id=$1 FOR UPDATE`, [id]);
      if (!d) throw new DomainError('NOT_FOUND', 'Document not found.'); expectVersion(d.version, ctx);
      const v = await tx.one(`SELECT scan_status FROM platform.document_versions WHERE document_id=$1 ORDER BY version_no DESC LIMIT 1`, [id]);
      if (v.scan_status !== 'clean') throw new DomainError('DOCUMENT_NOT_CLEAN', 'The document has not passed the malware scan.', { scanStatus: v.scan_status });
      await tx.q(`UPDATE platform.documents SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1`, [id, ctx.userId]);
      await audit(tx, ctx, 'document.approved', 'document', id); await emit(tx, ctx, 'DocumentApproved', 'document', id, { stage: 'approved' });
      return { id, status: 'approved', version: d.version + 1 };
    });
  }
}
@Controller()
export class DocumentsController {
  constructor(@Inject(DocumentsService) private s: DocumentsService) {}
  @Op('createUploadIntent') ui(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createUploadIntent(c, b); }
  @Op('registerDocument') rd(@Ctx() c: RequestContext, @Body() b: any) { return this.s.register(c, b); }
  @Op('listDocuments') ld(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.list(c, q); }
  @Op('getDocumentDownloadUrl') dl(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.downloadUrl(c, id); }
  @Op('getDocumentExtraction') ex(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.extraction(c, id); }
  @Op('approveDocument') ad(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.approve(c, id); }
}
@Module({ providers: [DocumentsService], controllers: [DocumentsController], exports: [DocumentsService] }) export class DocumentsModule {}
