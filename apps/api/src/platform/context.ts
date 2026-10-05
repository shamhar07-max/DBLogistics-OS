import type { Permission } from '@dbl/contracts';
import { DomainError } from './errors';

export interface Grant { legalEntityId: string | null; branchId: string | null }
export interface RequestContext {
  requestId: string; tenantId: string; userId: string; membershipId: string; workspace: string; partyId: string | null;
  email?: string; permissions: Map<Permission, Grant[]>;
  idem?: { operation: string; key: string; hash: string }; ifMatch?: number; actorKind?: 'user' | 'ai' | 'system' | 'integration' | 'device';
}
export const can = (ctx: RequestContext, p: Permission) => ctx.permissions.has(p);
/** Scope check: a grant with legalEntityId=null covers all entities; otherwise it must match. */
export function assertScope(ctx: RequestContext, p: Permission, legalEntityId?: string | null) {
  const grants = ctx.permissions.get(p);
  if (!grants) throw new DomainError('FORBIDDEN', `Missing permission ${p}`);
  if (legalEntityId && !grants.some((g) => g.legalEntityId === null || g.legalEntityId === legalEntityId))
    throw new DomainError('FORBIDDEN', `Permission ${p} is not granted for this legal entity`);
}
export const isExternal = (ctx: RequestContext) => ctx.workspace !== 'staff' && ctx.workspace !== 'platform_admin';
export function expectVersion(actual: number, ctx: RequestContext) {
  if (ctx.ifMatch !== undefined && ctx.ifMatch !== actual) throw new DomainError('VERSION_CONFLICT', 'The record changed since you loaded it.', { expected: ctx.ifMatch, actual });
}
