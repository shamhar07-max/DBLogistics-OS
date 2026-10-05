import { applyDecorators, CanActivate, ExecutionContext, Get, HttpCode, Injectable, Post, SetMetadata, createParamDecorator, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID, createHash } from 'node:crypto';
import { ROUTES, type Permission, type RouteDef } from '@dbl/contracts';
import { AuthService } from './auth.service';
import { Db } from './db.service';
import { DomainError } from './errors';
import type { Grant, RequestContext } from './context';

const META = 'dbl:route';
/** Binds a controller method to a contract route: path, verb, status, permission, idempotency, validation all come from ROUTES. */
export const Op = (operationId: string) => {
  const route = ROUTES.find((r) => r.operationId === operationId);
  if (!route) throw new Error(`Unknown operationId ${operationId}`);
  return applyDecorators(route.method === 'GET' ? Get(route.path) : Post(route.path), HttpCode(route.status ?? 200), SetMetadata(META, route));
};
export const Ctx = createParamDecorator((_d, ec: ExecutionContext): RequestContext => ec.switchToHttp().getRequest().ctx);
export const RawReq = createParamDecorator((_d, ec: ExecutionContext) => ec.switchToHttp().getRequest());

@Injectable()
export class OpGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector, @Inject(AuthService) private auth: AuthService, @Inject(Db) private db: Db) {}
  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const route = this.reflector.get<RouteDef | undefined>(META, ec.getHandler());
    const req = ec.switchToHttp().getRequest(); const res = ec.switchToHttp().getResponse();
    req.requestId = (req.headers['x-request-id'] as string) ?? `req_${randomUUID().slice(0, 12)}`;
    res.setHeader('X-Request-Id', req.requestId);
    if (!route) return true;
    if (route.public) return true;

    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!bearer) throw new DomainError('UNAUTHENTICATED', 'Missing bearer token.');
    const ident = await this.auth.verify(bearer);
    const userId = await this.auth.resolveUser(ident);

    if (route.path === '/me/memberships') { req.ctx = { requestId: req.requestId, userId } as RequestContext; return true; }

    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new DomainError('TENANT_REQUIRED', 'Send a valid X-Tenant-Id header.');
    const { membership, rows } = await this.db.asUser(userId, async (tx) => {
      await tx.q(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const membership = await tx.maybe(`SELECT id, workspace, party_id FROM platform.memberships WHERE tenant_id=$1 AND user_id=$2 AND status='active'`, [tenantId, userId]);
      if (!membership) return { membership: undefined, rows: [] as any[] };
      const rows = await tx.q(`SELECT rp.permission, mr.legal_entity_id, mr.branch_id FROM platform.membership_roles mr
                               JOIN platform.role_permissions rp ON rp.tenant_id = mr.tenant_id AND rp.role_id = mr.role_id
                               WHERE mr.tenant_id=$1 AND mr.membership_id=$2`, [tenantId, membership.id]);
      return { membership, rows };
    });
    if (!membership) throw new DomainError('FORBIDDEN', 'You are not a member of this tenant.');   // identical response for unknown/foreign tenants
    const permissions = new Map<Permission, Grant[]>();
    for (const r of rows) { const g = permissions.get(r.permission) ?? []; g.push({ legalEntityId: r.legal_entity_id, branchId: r.branch_id }); permissions.set(r.permission, g); }
    if (route.permission && !permissions.has(route.permission)) throw new DomainError('FORBIDDEN', `Missing permission ${route.permission}`);

    const ctx: RequestContext = { requestId: req.requestId, tenantId, userId, membershipId: membership.id, workspace: membership.workspace, partyId: membership.party_id, email: ident.email, permissions };
    if (route.idempotent) {
      const key = req.headers['idempotency-key'] as string | undefined;
      if (!key || key.length < 8) throw new DomainError('IDEMPOTENCY_KEY_REQUIRED', 'This command requires an Idempotency-Key header.');
      ctx.idem = { operation: route.operationId + ':' + JSON.stringify(req.params), key, hash: createHash('sha256').update(JSON.stringify({ m: req.method, p: req.path, b: req.body ?? null })).digest('hex') };
    }
    const ifm = req.headers['if-match'] as string | undefined;
    if (ifm) { const n = Number(ifm.replace(/"/g, '')); if (!Number.isInteger(n)) throw new DomainError('VALIDATION_FAILED', 'If-Match must be a record version.'); ctx.ifMatch = n; }
    else if (route.ifMatch && process.env.REQUIRE_IF_MATCH === '1') throw new DomainError('VALIDATION_FAILED', 'If-Match header required.');

    if (route.body) {
      const parsed = route.body.safeParse(req.body ?? {});
      if (!parsed.success) throw new DomainError('VALIDATION_FAILED', 'Request body is invalid.', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      req.body = parsed.data;
    }
    req.ctx = ctx;
    return true;
  }
}
