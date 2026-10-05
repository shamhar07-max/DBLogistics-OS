import { Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { Body } from '@nestjs/common';
import { audit, Ctx, Db, DomainError, Op, Qry, type RequestContext } from '../platform';

@Injectable()
export class AutomationService {
  constructor(@Inject(Db) private db: Db) {}
  list(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT d.id, d.key, d.version, d.description, d.trigger_topic, d.status, d.definition, d.created_at, d.activated_at, d.retired_at,
      (SELECT count(*)::int FROM automation.workflow_runs r WHERE r.definition_id = d.id) AS runs_total,
      (SELECT count(*)::int FROM automation.workflow_runs r WHERE r.definition_id = d.id AND r.status = 'failed') AS runs_failed
      FROM automation.workflow_definitions d ORDER BY d.key, d.version DESC`));
  }
  runs(ctx: RequestContext, q: { status?: string; definitionId?: string }) {
    const w: string[] = []; const a: unknown[] = []; if (q.status) { a.push(q.status); w.push(`r.status = $${a.length}`); } if (q.definitionId) { a.push(q.definitionId); w.push(`r.definition_id = $${a.length}`); }
    return this.db.run(ctx, (tx) => tx.q(`SELECT r.id, r.status, r.started_at, r.finished_at, r.resume_at, r.attempts, r.last_error, d.key, d.version, d.trigger_topic, r.state -> 'index' AS step
      FROM automation.workflow_runs r JOIN automation.workflow_definitions d ON d.id = r.definition_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY r.started_at DESC LIMIT 200`, a));
  }
  getRun(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const r = await tx.maybe(`SELECT r.id, r.status, r.started_at, r.finished_at, r.resume_at, r.attempts, r.last_error, r.state, r.log, d.id AS definition_id, d.key, d.version, d.trigger_topic, d.definition
        FROM automation.workflow_runs r JOIN automation.workflow_definitions d ON d.id = r.definition_id WHERE r.id=$1`, [id]);
      if (!r) throw new DomainError('NOT_FOUND', 'Run not found.'); return r;
    });
  }
  create(ctx: RequestContext, b: { key: string; triggerTopic: string; description?: string; definition: unknown }) {
    return this.db.run(ctx, async (tx) => {
      await tx.q(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`wf:${ctx.tenantId}:${b.key}`]);       // two authors publishing the same key get distinct versions
      const v = Number((await tx.one(`SELECT COALESCE(max(version),0)+1 v FROM automation.workflow_definitions WHERE key=$1`, [b.key])).v);
      const w = await tx.one(`INSERT INTO automation.workflow_definitions(tenant_id, key, version, trigger_topic, description, definition, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id, key, version, status`, [ctx.tenantId, b.key, v, b.triggerTopic, b.description ?? null, JSON.stringify(b.definition), ctx.userId]);
      await audit(tx, ctx, 'workflow.created', 'workflow', w.id, { key: b.key, version: v }); return w;
    });
  }
  /** Only a draft can be activated; the previous active version of the key is retired in the same transaction (running instances finish on their own version). */
  activate(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const w = await tx.maybe(`SELECT * FROM automation.workflow_definitions WHERE id=$1 FOR UPDATE`, [id]); if (!w) throw new DomainError('NOT_FOUND', 'Workflow not found.');
      if (w.status !== 'draft') throw new DomainError('INVALID_STATE_TRANSITION', `Only a draft can be activated; this version is ${w.status}. Publish a new version to change it.`);
      await tx.q(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`wf:${ctx.tenantId}:${w.key}`]);
      await tx.q(`UPDATE automation.workflow_definitions SET status='retired', retired_at=now() WHERE key=$1 AND status='active'`, [w.key]);
      await tx.q(`UPDATE automation.workflow_definitions SET status='active', activated_by=$2, activated_at=now() WHERE id=$1`, [id, ctx.userId]);
      await audit(tx, ctx, 'workflow.activated', 'workflow', id, { key: w.key, version: w.version }); return { id, status: 'active', version: w.version };
    });
  }
  retire(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const w = await tx.maybe(`SELECT * FROM automation.workflow_definitions WHERE id=$1 FOR UPDATE`, [id]); if (!w) throw new DomainError('NOT_FOUND', 'Workflow not found.');
      if (w.status !== 'active') throw new DomainError('INVALID_STATE_TRANSITION', `Only an active workflow can be retired; this version is ${w.status}.`);
      await tx.q(`UPDATE automation.workflow_definitions SET status='retired', retired_at=now() WHERE id=$1`, [id]);
      await audit(tx, ctx, 'workflow.retired', 'workflow', id, { key: w.key, version: w.version }); return { id, status: 'retired' };
    });
  }
  cancelRun(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const r = await tx.maybe(`SELECT status FROM automation.workflow_runs WHERE id=$1 FOR UPDATE`, [id]); if (!r) throw new DomainError('NOT_FOUND', 'Run not found.');
      if (!['running', 'waiting', 'failed'].includes(r.status)) throw new DomainError('INVALID_STATE_TRANSITION', `A ${r.status} run cannot be cancelled.`);
      await tx.q(`UPDATE automation.workflow_runs SET status='cancelled', finished_at=now(), resume_at=NULL, cancelled_by=$2, log = log || $3::jsonb WHERE id=$1`, [id, ctx.userId, JSON.stringify([{ at: new Date().toISOString(), note: 'Cancelled by a user' }])]);
      await audit(tx, ctx, 'workflow.run_cancelled', 'workflow_run', id); return { id, status: 'cancelled' };
    });
  }
  /** Retry = put the run back on the durable timer; the worker resumes it from the last committed step (a failed step rolled back completely). */
  retryRun(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const r = await tx.maybe(`SELECT status FROM automation.workflow_runs WHERE id=$1 FOR UPDATE`, [id]); if (!r) throw new DomainError('NOT_FOUND', 'Run not found.');
      if (r.status !== 'failed') throw new DomainError('INVALID_STATE_TRANSITION', `Only a failed run can be retried; this one is ${r.status}.`);
      await tx.q(`UPDATE automation.workflow_runs SET status='waiting', resume_at=now(), finished_at=NULL, log = log || $2::jsonb WHERE id=$1`, [id, JSON.stringify([{ at: new Date().toISOString(), note: 'Retry requested' }])]);
      await audit(tx, ctx, 'workflow.run_retried', 'workflow_run', id); return { id, status: 'waiting' };
    });
  }
}
@Controller() export class AutomationController { constructor(@Inject(AutomationService) private s: AutomationService) {}
  @Op('listWorkflows') lw(@Ctx() c: RequestContext) { return this.s.list(c); }
  @Op('listWorkflowRuns') lwr(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.runs(c, q); }
  @Op('getWorkflowRun') gr(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.getRun(c, id); }
  @Op('createWorkflow') c(@Ctx() c: RequestContext, @Body() b: any) { return this.s.create(c, b); }
  @Op('activateWorkflow') a(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.activate(c, id); }
  @Op('retireWorkflow') r(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.retire(c, id); }
  @Op('cancelWorkflowRun') cr(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.cancelRun(c, id); }
  @Op('retryWorkflowRun') rr(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.retryRun(c, id); } }
@Module({ providers: [AutomationService], controllers: [AutomationController] }) export class AutomationModule {}
