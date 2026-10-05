import { z } from 'zod';
import { EVENT_TOPICS } from './events';

/**
 * Workflow definition language — ONE implementation shared by the API (validation), the worker (execution) and the
 * staff designer (live preview), so what the designer shows is what the engine does.
 */
export const WORKFLOW_LIMITS = { maxActions: 20, maxConditions: 5, maxWaitSeconds: 30 * 24 * 3600, maxTitle: 200 } as const;

/** Paths a condition/template may read: the event envelope or its payload. Nothing else is addressable. */
export const FIELD_PATH = /^(aggregateType|aggregateId|topic|payload(\.[A-Za-z0-9_]+)+)$/;
export const CONDITION_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'] as const;
export const WorkflowCondition = z.object({
  field: z.string().regex(FIELD_PATH, 'Use payload.<name>, aggregateType, aggregateId or topic'),
  op: z.enum(CONDITION_OPS), value: z.union([z.string(), z.number(), z.boolean()]).optional(),
}).refine((c) => c.op === 'exists' || c.value !== undefined, { message: 'A value is required', path: ['value'] });

export const WorkflowAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create_task'), title: z.string().min(3).max(WORKFLOW_LIMITS.maxTitle), dueInHours: z.number().int().min(1).max(8760).optional() }),
  z.object({ type: z.literal('notify'), channel: z.enum(['internal', 'email', 'whatsapp']), template: z.string().min(2).max(100) }),
  z.object({ type: z.literal('wait'), seconds: z.number().int().min(1).max(WORKFLOW_LIMITS.maxWaitSeconds) }),
]);
export const WorkflowDefinition = z.object({
  conditions: z.array(WorkflowCondition).max(WORKFLOW_LIMITS.maxConditions).default([]),
  actions: z.array(WorkflowAction).min(1, 'Add at least one action').max(WORKFLOW_LIMITS.maxActions),
}).refine((d) => d.actions[d.actions.length - 1]?.type !== 'wait', { message: 'A workflow cannot end with a wait', path: ['actions'] });
export type WorkflowDefinitionT = z.infer<typeof WorkflowDefinition>;
export type WorkflowActionT = z.infer<typeof WorkflowAction>;
export type WorkflowConditionT = z.infer<typeof WorkflowCondition>;

export const WorkflowBody = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/, 'Lower-case letters, digits and dashes (3–61 characters)'),
  triggerTopic: z.enum(EVENT_TOPICS), description: z.string().max(300).optional(), definition: WorkflowDefinition,
});

/** What a running workflow can see of the event that started it. */
export interface WorkflowEventContext { topic: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> }
export function readPath(ctx: WorkflowEventContext, path: string): unknown {
  const parts = path.split('.'); let cur: any = ctx;
  for (const p of parts) { if (cur == null || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, p)) return undefined; cur = cur[p]; }
  return cur;
}
export function evaluateCondition(c: WorkflowConditionT, ctx: WorkflowEventContext): boolean {
  const v = readPath(ctx, c.field);
  if (c.op === 'exists') return v !== undefined && v !== null;
  if (v === undefined || v === null) return c.op === 'ne';
  const num = typeof c.value === 'number' || (typeof c.value === 'string' && c.value.trim() !== '' && !Number.isNaN(Number(c.value)));
  switch (c.op) {
    case 'eq': return num && !Number.isNaN(Number(v)) ? Number(v) === Number(c.value) : String(v) === String(c.value);
    case 'ne': return num && !Number.isNaN(Number(v)) ? Number(v) !== Number(c.value) : String(v) !== String(c.value);
    case 'gt': return Number(v) > Number(c.value);
    case 'gte': return Number(v) >= Number(c.value);
    case 'lt': return Number(v) < Number(c.value);
    case 'lte': return Number(v) <= Number(c.value);
    case 'contains': return String(v).toLowerCase().includes(String(c.value).toLowerCase());
  }
}
export const conditionsHold = (cs: WorkflowConditionT[] | undefined, ctx: WorkflowEventContext) => (cs ?? []).every((c) => evaluateCondition(c, ctx));
/** {{payload.jobId}} / {{aggregateId}} … — unknown paths render empty, never throw. */
export const renderTemplate = (tpl: string, ctx: WorkflowEventContext) =>
  tpl.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, p: string) => { const v = FIELD_PATH.test(p) ? readPath(ctx, p) : undefined; return v === undefined || v === null || typeof v === 'object' ? '' : String(v); });

export interface PlannedStep { index: number; type: WorkflowActionT['type']; summary: string }
/** Dry run for the designer: what would happen for this event (no side effects). */
export function previewWorkflow(def: WorkflowDefinitionT, ctx: WorkflowEventContext): { matches: boolean; steps: PlannedStep[] } {
  if (!conditionsHold(def.conditions, ctx)) return { matches: false, steps: [] };
  return { matches: true, steps: def.actions.map((a, index) => ({ index, type: a.type, summary:
    a.type === 'create_task' ? `Create task “${renderTemplate(a.title, ctx)}”${a.dueInHours ? ` due in ${a.dueInHours} h` : ''}`
    : a.type === 'notify' ? `Notify via ${a.channel} using template “${a.template}”` : `Wait ${a.seconds >= 3600 ? `${+(a.seconds / 3600).toFixed(1)} h` : `${a.seconds} s`}, then continue` })) };
}
