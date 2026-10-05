import { Controller, Get, Inject, Injectable, Module, Post, Param, Req, HttpCode, Headers, SetMetadata } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ROUTES } from '@dbl/contracts';
import { audit, Ctx, Db, DomainError, emit, Op, Qry, type RequestContext } from '../platform';

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

  private sysCtx(tenantId: string) { return { requestId: `wh_${Date.now()}`, tenantId, userId: SYSTEM_USER, actorKind: 'integration', permissions: new Map(), membershipId: '', workspace: 'integration', partyId: null } as unknown as RequestContext; }
  private okTenant(t: string) { if (!/^[0-9a-f-]{36}$/i.test(t)) throw new DomainError('TENANT_REQUIRED', 'Invalid tenant in webhook URL.'); return t; }
  /** Meta's subscription handshake: echo hub.challenge only when the verify token matches the one held in the secret store. */
  async verifyWhatsapp(tenantId: string, q: Record<string, string>) {
    return this.db.run(this.sysCtx(this.okTenant(tenantId)), async (tx) => {
      const conn = await tx.maybe(`SELECT webhook_secret_ref FROM integ.connections WHERE provider='whatsapp' AND status='active' LIMIT 1`);
      const token = conn?.webhook_secret_ref ? this.secrets(`${conn.webhook_secret_ref}_VERIFY`) : undefined;
      if (q['hub.mode'] !== 'subscribe' || !token || q['hub.verify_token'] !== token) throw new DomainError('FORBIDDEN', 'Webhook verification failed.');
      return String(q['hub.challenge'] ?? '');
    });
  }
  /** WhatsApp Cloud API callback: verify X-Hub-Signature-256 (HMAC-SHA256 with the app secret), split into individual status / message events (deduped by Meta's ids). */
  async receiveWhatsapp(tenantId: string, rawBody: Buffer, signature: string | undefined, body: any) {
    return this.db.run(this.sysCtx(this.okTenant(tenantId)), async (tx) => {
      const ctx = this.sysCtx(tenantId);
      const conn = await tx.maybe(`SELECT id, webhook_secret_ref FROM integ.connections WHERE provider='whatsapp' AND status='active' LIMIT 1`);
      const secret = conn?.webhook_secret_ref ? this.secrets(conn.webhook_secret_ref) : undefined;
      const expected = secret ? createHmac('sha256', secret).update(rawBody).digest('hex') : null; const given = (signature ?? '').replace(/^sha256=/, '');
      if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new DomainError('WEBHOOK_SIGNATURE_INVALID', 'Signature verification failed.');
      const events: Array<{ id: string; type: string; payload: Record<string, unknown> }> = [];
      for (const entry of body?.entry ?? []) for (const ch of entry?.changes ?? []) {
        const v = ch?.value ?? {};
        for (const st of v.statuses ?? []) events.push({ id: `status:${st.id}:${st.status}`, type: 'whatsapp.status', payload: { messageId: st.id, status: st.status, to: st.recipient_id, error: st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title ?? st.errors[0].message ?? ''}` : undefined } });
        for (const m of v.messages ?? []) events.push({ id: `msg:${m.id}`, type: 'whatsapp.message', payload: { messageId: m.id, from: m.from, kind: m.type, text: m.type === 'text' ? m.text?.body : undefined } });
      }
      let fresh = 0;
      for (const ev of events) {
        const row = await tx.maybe(`INSERT INTO integ.inbox_events(tenant_id, provider, external_event_id, event_type, payload) VALUES ($1,'whatsapp',$2,$3,$4::jsonb) ON CONFLICT (tenant_id, provider, external_event_id) DO NOTHING RETURNING id`, [tenantId, ev.id, ev.type, JSON.stringify(ev.payload)]);
        if (row) { fresh++; await emit(tx, ctx, 'IntegrationEventReceived', 'inbox_event', row.id, { provider: 'whatsapp', type: ev.type }); }
      }
      if (fresh) await tx.q(`UPDATE integ.connections SET last_success_at=now() WHERE id=$1`, [conn!.id]);
      return { accepted: events.length, new: fresh };
    });
  }
  listOutbound(ctx: RequestContext, q: { status?: string; channel?: string }) {
    const w: string[] = []; const a: unknown[] = []; if (q.status) { a.push(q.status); w.push(`status = $${a.length}`); } if (q.channel) { a.push(q.channel); w.push(`channel = $${a.length}`); }
    return this.db.run(ctx, (tx) => tx.q(`SELECT id, channel, to_name, to_address, template, status, attempts, provider, provider_message_id, last_error, related_type, related_id, created_at, sent_at, delivered_at, next_attempt_at FROM integ.outbound_messages ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 300`, a));
  }
  retryOutbound(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const m = await tx.maybe(`SELECT status FROM integ.outbound_messages WHERE id=$1 FOR UPDATE`, [id]); if (!m) throw new DomainError('NOT_FOUND', 'Message not found.');
      if (m.status !== 'failed') throw new DomainError('INVALID_STATE_TRANSITION', `Only a failed message can be retried; this one is ${m.status}.`);
      await tx.q(`UPDATE integ.outbound_messages SET status='queued', attempts=0, next_attempt_at=now(), last_error=NULL WHERE id=$1`, [id]); await audit(tx, ctx, 'outbound.retried', 'outbound_message', id); return { id, status: 'queued' };
    });
  }
  cancelOutbound(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const m = await tx.maybe(`SELECT status FROM integ.outbound_messages WHERE id=$1 FOR UPDATE`, [id]); if (!m) throw new DomainError('NOT_FOUND', 'Message not found.');
      if (m.status !== 'queued') throw new DomainError('INVALID_STATE_TRANSITION', `Only a queued message can be cancelled; this one is ${m.status}.`);
      await tx.q(`UPDATE integ.outbound_messages SET status='cancelled' WHERE id=$1`, [id]); await audit(tx, ctx, 'outbound.cancelled', 'outbound_message', id); return { id, status: 'cancelled' };
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
  @Op('verifyWhatsappWebhook') vw(@Param('tenantId') t: string, @Req() req: any) { return this.s.verifyWhatsapp(t, req.query); }
  @Op('receiveWhatsappWebhook') rw(@Param('tenantId') t: string, @Headers('x-hub-signature-256') sig: string, @Req() req: any) { return this.s.receiveWhatsapp(t, req.rawBody ?? Buffer.from(JSON.stringify(req.body)), sig, req.body); }
  @Op('listOutboundMessages') lo(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.listOutbound(c, q); }
  @Op('retryOutboundMessage') ro(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.retryOutbound(c, id); }
  @Op('cancelOutboundMessage') co(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.cancelOutbound(c, id); }
}
@Module({ providers: [IntegrationsService, { provide: SECRET_RESOLVER, useValue: envSecretResolver }], controllers: [IntegrationsController] })
export class IntegrationsModule {}
