import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, Ctx, Db, DomainError, emit, Op, type RequestContext } from '../platform';

@Injectable()
export class CollaborationService {
  constructor(@Inject(Db) private db: Db) {}
  list(ctx: RequestContext) { return this.db.run(ctx, (tx) => tx.q(`SELECT id, kind, subject_type, subject_id, summary, status, requested_by, decided_by, created_at FROM collab.approval_requests ORDER BY (status='pending') DESC, created_at DESC LIMIT 200`)); }
  create(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => { const a = await tx.one(`INSERT INTO collab.approval_requests(tenant_id, kind, subject_type, subject_id, summary, requested_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status`, [ctx.tenantId, b.kind, b.subjectType, b.subjectId, b.summary, ctx.userId]); await audit(tx, ctx, 'approval.requested', 'approval_request', a.id); return a; });
  }
  decide(ctx: RequestContext, id: string, approve: boolean, note?: string) {
    return this.db.run(ctx, async (tx) => {
      const a = await tx.maybe(`SELECT * FROM collab.approval_requests WHERE id=$1 FOR UPDATE`, [id]);
      if (!a) throw new DomainError('NOT_FOUND', 'Approval request not found.');
      if (a.status !== 'pending') throw new DomainError('INVALID_STATE_TRANSITION', `Request is ${a.status}.`);
      if (a.requested_by === ctx.userId) throw new DomainError('SEPARATION_OF_DUTIES', 'Requesters cannot decide their own approval request.');
      const st = approve ? 'approved' : 'rejected';
      await tx.q(`UPDATE collab.approval_requests SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1`, [id, st, ctx.userId, note ?? null]);
      await audit(tx, ctx, `approval.${st}`, 'approval_request', id); await emit(tx, ctx, 'ApprovalDecided', 'approval_request', id, { status: st, kind: a.kind, subjectType: a.subject_type, subjectId: a.subject_id });
      return { id, status: st };
    });
  }
}
@Controller()
export class CollaborationController {
  constructor(@Inject(CollaborationService) private s: CollaborationService) {}
  @Op('listApprovalRequests') l(@Ctx() c: RequestContext) { return this.s.list(c); }
  @Op('createApprovalRequest') c(@Ctx() c: RequestContext, @Body() b: any) { return this.s.create(c, b); }
  @Op('approveRequest') a(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.decide(c, id, true, b.note); }
  @Op('rejectRequest') r(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.decide(c, id, false, b.note); }
}
@Module({ providers: [CollaborationService], controllers: [CollaborationController], exports: [CollaborationService] }) export class CollaborationModule {}
