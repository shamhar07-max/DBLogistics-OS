import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, canTouch, Ctx, Db, DomainError, emit, isExternal, Op, Qry, type RequestContext } from '../platform';

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
  /** Staff see every message; customers see ONLY messages marked shared on records they own, with staff shown as "Team". */
  listMessages(ctx: RequestContext, q: { relatedType?: string; relatedId?: string }) {
    return this.db.run(ctx, async (tx) => {
      if (isExternal(ctx)) {
        if (!q.relatedType || !q.relatedId || !(await canTouch(tx, ctx, q.relatedType, q.relatedId))) throw new DomainError('NOT_FOUND', 'Conversation not found.');
        return tx.q(`SELECT m.id, m.channel, m.direction, m.body, m.created_at, m.related_type, m.related_id, (m.author_user_id = $3) AS mine, CASE WHEN m.author_user_id = $3 THEN 'You' WHEN m.direction = 'outbound' THEN 'DigitalBurj team' ELSE 'Your colleague' END AS author
          FROM collab.messages m WHERE m.related_type = $1 AND m.related_id = $2 AND m.visibility = 'shared' ORDER BY m.id DESC LIMIT 300`, [q.relatedType, q.relatedId, ctx.userId]);
      }
      return tx.q(`SELECT m.id, m.channel, m.direction, m.visibility, m.body, m.created_at, m.related_type, m.related_id, u.subject AS author FROM collab.messages m LEFT JOIN platform.users u ON u.id = m.author_user_id
        WHERE ($1::text IS NULL OR m.related_type = $1) AND ($2::uuid IS NULL OR m.related_id = $2) ORDER BY m.id DESC LIMIT 300`, [q.relatedType ?? null, q.relatedId ?? null]);
    });
  }
  /**
   * Customers can only write inbound, shared messages on their own shipments/jobs/quotes (rate-limited). Staff choose per message whether the
   * customer sees it ("shared": also notifies the customer's contacts); everything else stays an internal note.
   */
  postMessage(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      let { channel, direction, shared } = b as { channel: string; direction: string; shared: boolean };
      if (isExternal(ctx)) {
        if (ctx.workspace !== 'customer' || !['shipment', 'job', 'quote'].includes(b.relatedType) || !(await canTouch(tx, ctx, b.relatedType, b.relatedId))) throw new DomainError('NOT_FOUND', 'Conversation not found.');
        const recent = await tx.one<{ n: number }>(`SELECT count(*)::int n FROM collab.messages WHERE author_user_id=$1 AND created_at > now() - interval '1 hour'`, [ctx.userId]);
        if (recent.n >= 30) throw new DomainError('RATE_LIMITED', 'You have sent many messages in the last hour. Please wait a little before sending more.');
        channel = 'portal'; direction = 'inbound'; shared = true;
      } else if (shared) {
        if (!['shipment', 'job', 'quote'].includes(b.relatedType)) throw new DomainError('VALIDATION_FAILED', 'Only shipment, job and quote conversations can be shared with the customer.');
        channel = 'portal'; direction = 'outbound';
      } else if (channel === 'portal') throw new DomainError('VALIDATION_FAILED', 'Portal messages are shared messages.');
      const m = await tx.one(`INSERT INTO collab.messages(tenant_id, related_type, related_id, channel, direction, body, author_user_id, visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, created_at`,
        [ctx.tenantId, b.relatedType, b.relatedId, channel, direction, b.body, ctx.userId, shared ? 'shared' : 'internal']);
      if (shared) await emit(tx, ctx, 'MessagePosted', b.relatedType, b.relatedId, { messageId: m.id, direction, relatedType: b.relatedType, excerpt: String(b.body).slice(0, 160) });
      return m;
    });
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
