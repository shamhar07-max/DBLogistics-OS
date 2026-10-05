import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, Ctx, Db, DomainError, emit, Op, Qry, type RequestContext } from '../platform';

@Injectable()
export class CollaborationService {
  constructor(@Inject(Db) private db: Db) {}
  list(ctx: RequestContext) { return this.db.run(ctx, (tx) => tx.q(`SELECT id, kind, subject_type, subject_id, summary, status, requested_by, decided_by, created_at FROM collab.approval_requests ORDER BY (status='pending') DESC, created_at DESC LIMIT 200`)); }
  listTasks(ctx: RequestContext, q: { relatedType?: string; relatedId?: string; status?: string }) {
    const w: string[] = []; const a: unknown[] = []; const add = (c: string, v: unknown) => { a.push(v); w.push(c.replace('?', `$${a.length}`)); };
    if (q.relatedType) add('related_type = ?', q.relatedType); if (q.relatedId) add('related_id = ?', q.relatedId); if (q.status) add('status = ?', q.status);
    return this.db.run(ctx, (tx) => tx.q(`SELECT id, title, related_type, related_id, status, origin, due_at, created_at, completed_at FROM collab.tasks ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY (status = 'done'), due_at NULLS LAST, created_at DESC LIMIT 300`, a));
  }
  createTask(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => { const t = await tx.one(`INSERT INTO collab.tasks(tenant_id, title, related_type, related_id, assignee_user_id, due_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, title, status`, [ctx.tenantId, b.title, b.relatedType ?? null, b.relatedId ?? null, b.assigneeUserId ?? null, b.dueAt ?? null]); await audit(tx, ctx, 'task.created', 'task', t.id); return t; });
  }
  completeTask(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const t = await tx.maybe(`SELECT status FROM collab.tasks WHERE id=$1 FOR UPDATE`, [id]); if (!t) throw new DomainError('NOT_FOUND', 'Task not found.'); if (t.status !== 'open') throw new DomainError('INVALID_STATE_TRANSITION', `Task is ${t.status}.`);
      await tx.q(`UPDATE collab.tasks SET status='done', completed_by=$2, completed_at=now() WHERE id=$1`, [id, ctx.userId]); await audit(tx, ctx, 'task.completed', 'task', id); return { id, status: 'done' };
    });
  }
  listMessages(ctx: RequestContext, q: { relatedType?: string; relatedId?: string }) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT m.id, m.channel, m.direction, m.body, m.created_at, m.related_type, m.related_id, u.subject AS author FROM collab.messages m LEFT JOIN platform.users u ON u.id = m.author_user_id
      WHERE ($1::text IS NULL OR m.related_type = $1) AND ($2::uuid IS NULL OR m.related_id = $2) ORDER BY m.id DESC LIMIT 300`, [q.relatedType ?? null, q.relatedId ?? null]));
  }
  postMessage(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => { const m = await tx.one(`INSERT INTO collab.messages(tenant_id, related_type, related_id, channel, direction, body, author_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`, [ctx.tenantId, b.relatedType, b.relatedId, b.channel, b.direction, b.body, ctx.userId]); return m; });
  }
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
  @Op('listTasks') lt(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.listTasks(c, q); }
  @Op('createTask') ct(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createTask(c, b); }
  @Op('completeTask') dt(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.completeTask(c, id); }
  @Op('listMessages') lm(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.listMessages(c, q); }
  @Op('postMessage') pm(@Ctx() c: RequestContext, @Body() b: any) { return this.s.postMessage(c, b); }
  @Op('listApprovalRequests') l(@Ctx() c: RequestContext) { return this.s.list(c); }
  @Op('createApprovalRequest') c(@Ctx() c: RequestContext, @Body() b: any) { return this.s.create(c, b); }
  @Op('approveRequest') a(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.decide(c, id, true, b.note); }
  @Op('rejectRequest') r(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.decide(c, id, false, b.note); }
}
@Module({ providers: [CollaborationService], controllers: [CollaborationController], exports: [CollaborationService] }) export class CollaborationModule {}
