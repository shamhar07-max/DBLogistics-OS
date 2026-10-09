import {z} from 'zod';
export const PeriodRequestBody=z.object({kind:z.enum(['close','reopen']),reason:z.string().trim().min(10).max(4000)}).strict();
export const PeriodDecisionBody=z.object({approve:z.boolean(),note:z.string().trim().min(10).max(4000)}).strict();
