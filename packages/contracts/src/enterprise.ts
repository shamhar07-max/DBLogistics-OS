import { z } from 'zod';
const uuid=z.string().uuid();
export const MembershipStatusBody=z.object({status:z.enum(['active','suspended','revoked']),reason:z.string().trim().min(10).max(2000)}).strict();
export const RevokeSessionsBody=z.object({reason:z.string().trim().min(10).max(2000)}).strict();
export const ReplaceGrantsBody=z.object({reason:z.string().trim().min(10).max(2000),grants:z.array(z.object({role:z.string().min(1).max(80),legalEntityId:uuid.nullable().default(null),branchId:uuid.nullable().default(null)}).strict().refine(g=>!g.branchId||!!g.legalEntityId,'Branch grants require a legal entity')).min(1).max(30)}).strict();
