import { Controller, Get, Inject, Injectable, Module, Post, Param, Req, HttpCode, Headers, SetMetadata } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ROUTES } from '@dbl/contracts';
import { Ctx, Db, DomainError, emit, type RequestContext } from '../platform';

const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
/** Resolves a connection's webhook secret from the secrets manager (env in dev). Tenant rows hold only a REFERENCE. */
export const SECRET_RESOLVER = Symbol('SECRET_RESOLVER');
export const envSecretResolver = (ref: string) => process.env[`SECRET_${ref.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`];

@Injectable()
export class IntegrationsService {
  constructor(@Inject(Db) private db: Db, @Inject(SECRET_RESOLVER) private secrets: (ref: string) => string | undefined) {}
  list(ctx: RequestContext) {
    return this.db.run(ctx, async (tx) => ({
      connections: await tx.q(`SELECT id, provider, capability, status, external_account, mapping_version, last_success_at, last_error FROM integ.connections ORDER BY provider`),            // credential references are never returned
      inbox: await tx.q(`SELECT provider, status, count(*)::int AS n, max(received_at) AS last_received FROM integ.inbox_events GROUP BY provider, status ORDER BY provider, status`),
    }));
  }
  /**
   * Inbound webhook: verify provider signature → record external event id (dedupe) → store payload → acknowledge; business
   * processing happens asynchronously in the worker from the outbox. A duplicate delivery has NO additional effect.
   */
  async receive(provider: string, tenantId: string | undefined, rawBody: Buffer, signature: string | undefined, body: any) {
    if (!tenantId) throw new DomainError('TENANT_REQUIRED', 'X-Tenant-Id required on webhook endpoint.');
    const ctx = { requestId: `wh_${Date.now()}`, tenantId, userId: SYSTEM_USER, actorKind: 'integration', permissions: new Map(), membershipId: '', workspace: 'integration', partyId: null } as unknown as RequestContext;
    return this.db.run(ctx, async (tx) => {
      const conn = await tx.maybe(`SELECT id, webhook_secret_ref FROM integ.connections WHERE provider=$1 AND status='active' LIMIT 1`, [provider]);
      const secret = conn?.webhook_secret_ref ? this.secrets(conn.webhook_secret_ref) : undefined;
      const expected = secret ? createHmac('sha256', secret).update(rawBody).digest('hex') : null;
      const given = (signature ?? '').replace(/^sha256=/, '');
      if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Signature verification failed.');
      const id = body?.id ?? body?.eventId; if (!id) throw new DomainError('VALIDATION_FAILED', 'Event id missing.');
      const row = await tx.maybe(`INSERT INTO integ.inbox_events(tenant_id, provider, external_event_id, event_type, payload, event_time) VALUES ($1,$2,$3,$4,$5::jsonb,$6)
                                  ON CONFLICT (tenant_id, provider, external_event_id) DO NOTHING RETURNING id`, [tenantId, provider, String(id), body.type ?? 'unknown', JSON.stringify(body), body.occurredAt ?? null]);
      if (!row) return { accepted: true, duplicate: true };
      await tx.q(`UPDATE integ.connections SET last_success_at=now() WHERE id=$1`, [conn!.id]);
      await emit(tx, ctx, 'IntegrationEventReceived', 'inbox_event', row.id, { provider, type: body.type });
      return { accepted: true, duplicate: false, eventId: row.id };
    });
  }
}
const route = ROUTES.find((r) => r.operationId === 'receiveWebhook')!;
const listRoute = ROUTES.find((r) => r.operationId === 'listIntegrations')!;
@Controller()
export class IntegrationsController {
  constructor(@Inject(IntegrationsService) private s: IntegrationsService) {}
  @Get(listRoute.path) @SetMetadata('dbl:route', listRoute) listIntegrations(@Ctx() ctx: RequestContext) { return this.s.list(ctx); }
  @Post(route.path) @HttpCode(202) @SetMetadata('dbl:route', route)
  hook(@Param('provider') provider: string, @Headers('x-tenant-id') tenant: string, @Headers('x-dbl-signature') sig: string, @Req() req: any) {
    return this.s.receive(provider, tenant, req.rawBody ?? Buffer.from(JSON.stringify(req.body)), sig, req.body);
  }
}
@Module({ providers: [IntegrationsService, { provide: SECRET_RESOLVER, useValue: envSecretResolver }], controllers: [IntegrationsController] })
export class IntegrationsModule {}
