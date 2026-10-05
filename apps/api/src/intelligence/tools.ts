import { z } from 'zod';
import type { Permission } from '@dbl/contracts';

/** Controlled AI tools. Every tool declares schema, permission, risk class and approval policy. The model can NEVER widen these. */
export interface AiTool { name: string; description: string; permission: Permission; risk: 'read' | 'write_low' | 'write_high'; args: z.ZodTypeAny }
export const AI_TOOLS: AiTool[] = [
  { name: 'get_job_margin', description: 'Quoted/expected/accounting margin and cash for a job', permission: 'jobs.margin.view', risk: 'read', args: z.object({ jobId: z.string().uuid() }) },
  { name: 'find_unbilled_deliveries', description: 'Delivered jobs with open revenue charges', permission: 'ai.tools.finance', risk: 'read', args: z.object({}) },
  { name: 'list_missing_documents', description: 'Shipments whose documents are not approved', permission: 'ai.tools.operations', risk: 'read', args: z.object({ jobId: z.string().uuid().optional() }) },
  { name: 'create_followup_task', description: 'Create a follow-up task (low-risk write)', permission: 'ai.tools.operations', risk: 'write_low', args: z.object({ title: z.string().min(3), relatedType: z.string().optional(), relatedId: z.string().uuid().optional() }) },
  { name: 'propose_payment_batch', description: 'Propose a supplier payment batch — ALWAYS becomes an approval request, never executes', permission: 'ai.tools.finance', risk: 'write_high', args: z.object({ summary: z.string().min(5), supplierPartyIds: z.array(z.string().uuid()).min(1) }) },
];
