import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, Ctx, Db, DomainError, Op, can, type RequestContext, type Tx } from '../platform';
import { FinanceModule, FinanceService } from '../finance';
import { AI_TOOLS } from './tools';

@Injectable()
export class IntelligenceService {
  constructor(@Inject(Db) private db: Db, @Inject(FinanceService) private finance: FinanceService) {}

  /** Same permissions and same application services as a human user; actions are attributed and audited. */
  async invokeTool(ctx: RequestContext, name: string, rawArgs: Record<string, unknown>) {
    const tool = AI_TOOLS.find((t) => t.name === name);
    if (!tool) throw new DomainError('AI_TOOL_DENIED', `Unknown tool ${name}`);
    if (!can(ctx, tool.permission)) throw new DomainError('AI_TOOL_DENIED', `The calling user lacks ${tool.permission}; the AI cannot exceed user permissions.`);
    const parsed = tool.args.safeParse(rawArgs); if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Invalid tool arguments.', { issues: parsed.error.issues.map((i) => i.message) });
    const aiCtx: RequestContext = { ...ctx, actorKind: 'ai' };
    await this.db.run(aiCtx, async (tx) => {
      const u = await tx.one(`INSERT INTO automation.ai_usage(tenant_id, day, workload, tool_calls, cost_micros) VALUES ($1, current_date, 'tools', 1, 1000)
                              ON CONFLICT (tenant_id, day, workload) DO UPDATE SET tool_calls = automation.ai_usage.tool_calls + 1, cost_micros = automation.ai_usage.cost_micros + 1000 RETURNING cost_micros, budget_micros`, [ctx.tenantId]);
      if (Number(u.cost_micros) > Number(u.budget_micros)) throw new DomainError('AI_BUDGET_EXCEEDED', 'Daily AI budget for this tenant is exhausted.');
    });
    const a = parsed.data as any;
    let result: unknown;
    switch (name) {
      case 'get_job_margin': result = await this.finance.jobMargin(aiCtx, a.jobId); break;
      case 'find_unbilled_deliveries': result = await this.db.run(aiCtx, (tx) => tx.q(`SELECT j.id, j.ref, COALESCE(sum(c.amount),0) unbilled FROM logistics.jobs j JOIN finance.charges c ON c.job_id=j.id AND c.kind='revenue' AND c.status='open' WHERE j.status='delivered' GROUP BY j.id, j.ref ORDER BY unbilled DESC`)); break;
      case 'list_missing_documents': result = await this.db.run(aiCtx, (tx) => tx.q(`SELECT s.id, s.ref, s.documents_status FROM logistics.shipments s WHERE s.documents_status <> 'approved' ${a.jobId ? 'AND s.job_id=$1' : ''}`, a.jobId ? [a.jobId] : [])); break;
      case 'create_followup_task': result = await this.db.run(aiCtx, async (tx) => tx.one(`INSERT INTO collab.tasks(tenant_id, title, related_type, related_id, origin) VALUES ($1,$2,$3,$4,'ai') RETURNING id, title`, [ctx.tenantId, a.title, a.relatedType ?? null, a.relatedId ?? null])); break;
      case 'propose_payment_batch': result = await this.db.run(aiCtx, async (tx) => { const r = await tx.one(`INSERT INTO collab.approval_requests(tenant_id, kind, subject_type, subject_id, summary, requested_by) VALUES ($1,'payment_batch','supplier',$2,$3,$4) RETURNING id, status`, [ctx.tenantId, a.supplierPartyIds[0], a.summary, ctx.userId]); return { ...r, note: 'Proposal only — a human approver must decide; nothing was paid.' }; }); break;
    }
    await this.db.run(aiCtx, (tx) => audit(tx, aiCtx, 'ai.tool.invoked', 'ai_tool', ctx.userId, { tool: name, risk: tool.risk, args: a }));
    return { tool: name, risk: tool.risk, result, evidence: { actor: 'ai-on-behalf-of-user', userId: ctx.userId, at: new Date().toISOString() } };
  }
  listTools(ctx: RequestContext) { return AI_TOOLS.map((t) => ({ name: t.name, description: t.description, permission: t.permission, risk: t.risk, allowed: can(ctx, t.permission) })); }
  /** Live owner overview. Each figure is a plain query so it can be drilled into. */
  ownerOverview(ctx: RequestContext) {
    return this.db.run(ctx, async (tx: Tx) => {
      const jobs = await tx.q(`SELECT status, count(*)::int n FROM logistics.jobs GROUP BY status`);
      const unbilled = await tx.one(`SELECT count(DISTINCT j.id)::int jobs, COALESCE(sum(c.amount),0) amount FROM logistics.jobs j JOIN finance.charges c ON c.job_id=j.id AND c.kind='revenue' AND c.status='open' WHERE j.status='delivered'`);
      const ar = await tx.one(`SELECT COALESCE(sum(total-amount_allocated),0) outstanding, COALESCE(sum(total-amount_allocated) FILTER (WHERE due_date < current_date),0) overdue FROM finance.invoices WHERE status='posted'`);
      const approvals = await tx.one(`SELECT count(*)::int n FROM collab.approval_requests WHERE status='pending'`);
      const held = await tx.one(`SELECT count(DISTINCT lot_id)::int n FROM warehouse.holds WHERE released_at IS NULL`);
      const missingCosts = await tx.one(`SELECT count(*)::int n FROM finance.charges WHERE kind='cost' AND status='open'`);
      const byMode = await tx.q(`SELECT mode, count(*)::int n FROM logistics.shipments WHERE status IN ('planned','executing') GROUP BY mode`);
      return { jobsByStatus: jobs, unbilledDelivered: unbilled, receivables: ar, pendingApprovals: approvals.n, heldLots: held.n, expectedCostsNotAccrued: missingCosts.n, activeShipmentsByMode: byMode, asOf: new Date().toISOString() };
    });
  }
}
@Controller()
export class IntelligenceController {
  constructor(@Inject(IntelligenceService) private s: IntelligenceService) {}
  @Op('invokeAiTool') ai(@Ctx() c: RequestContext, @Param('name') n: string, @Body() b: any) { return this.s.invokeTool(c, n, b.args); }
  @Op('listAiTools') lt(@Ctx() c: RequestContext) { return this.s.listTools(c); }
  @Op('getOwnerOverview') ov(@Ctx() c: RequestContext) { return this.s.ownerOverview(c); }
}
@Module({ imports: [FinanceModule], providers: [IntelligenceService], controllers: [IntelligenceController] }) export class IntelligenceModule {}
