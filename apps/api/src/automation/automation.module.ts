import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { EVENT_TOPICS } from '@dbl/contracts';
import { audit, Ctx, Db, DomainError, Op, type RequestContext } from '../platform';

@Injectable()
export class AutomationService {
  constructor(@Inject(Db) private db: Db) {}
  list(ctx: RequestContext) { return this.db.run(ctx, (tx) => tx.q(`SELECT id, key, version, trigger_topic, status, definition, created_at FROM automation.workflow_definitions ORDER BY key, version DESC`)); }
  runs(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT r.id, r.status, r.started_at, r.finished_at, r.resume_at, r.attempts, r.last_error, r.state, d.key, d.version, d.trigger_topic FROM automation.workflow_runs r JOIN automation.workflow_definitions d ON d.id = r.definition_id ORDER BY r.started_at DESC LIMIT 200`));
  }
  create(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      if (!(EVENT_TOPICS as readonly string[]).includes(b.triggerTopic)) throw new DomainError('VALIDATION_FAILED', `Unknown trigger topic ${b.triggerTopic}`);
      const v = Number((await tx.one(`SELECT COALESCE(max(version),0)+1 v FROM automation.workflow_definitions WHERE key=$1`, [b.key])).v);
      const w = await tx.one(`INSERT INTO automation.workflow_definitions(tenant_id, key, version, trigger_topic, definition, owner_user_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id, key, version, status`, [ctx.tenantId, b.key, v, b.triggerTopic, JSON.stringify(b.definition), ctx.userId]);
      await audit(tx, ctx, 'workflow.created', 'workflow', w.id); return w;
    });
  }
  activate(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const w = await tx.maybe(`SELECT * FROM automation.workflow_definitions WHERE id=$1 FOR UPDATE`, [id]); if (!w) throw new DomainError('NOT_FOUND', 'Workflow not found.');
      await tx.q(`UPDATE automation.workflow_definitions SET status='retired' WHERE key=$1 AND status='active'`, [w.key]);
      await tx.q(`UPDATE automation.workflow_definitions SET status='active' WHERE id=$1`, [id]);
      await audit(tx, ctx, 'workflow.activated', 'workflow', id, { version: w.version }); return { id, status: 'active', version: w.version };
    });
  }
}
@Controller() export class AutomationController { constructor(@Inject(AutomationService) private s: AutomationService) {}
  @Op('listWorkflows') lw(@Ctx() c: RequestContext) { return this.s.list(c); }
  @Op('listWorkflowRuns') lwr(@Ctx() c: RequestContext) { return this.s.runs(c); }
  @Op('createWorkflow') c(@Ctx() c: RequestContext, @Body() b: any) { return this.s.create(c, b); }
  @Op('activateWorkflow') a(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.activate(c, id); } }
@Module({ providers: [AutomationService], controllers: [AutomationController] }) export class AutomationModule {}
