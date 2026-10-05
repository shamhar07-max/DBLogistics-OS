import type pg from 'pg';
import { NOTIFICATION_TEMPLATES } from '@dbl/contracts';
import { inTenant, type Q } from '../db';
import { SendError, type ChannelAdapter } from './adapters';
import { renderNotification, type Issuer } from './templates';

export const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 30, 120, 360];                                   // minutes before attempt 2..5
const PORTAL = () => (process.env.PORTAL_BASE_URL ?? 'http://localhost:3002').replace(/\/$/, '');

export interface Contact { id: string; name: string; email: string | null; phone: string | null; preferred_channel: string | null; whatsapp_opt_in: boolean; email_opt_out: boolean }
/** One channel per contact per notification: respect preference, consent and opt-out. WhatsApp is used only with explicit opt-in and a phone number. */
export function pickChannel(c: Contact, requested?: 'email' | 'whatsapp'): 'email' | 'whatsapp' | null {
  const canEmail = !!c.email && !c.email_opt_out; const canWa = c.whatsapp_opt_in && !!c.phone;
  if (requested) return requested === 'email' ? (canEmail ? 'email' : null) : (canWa ? 'whatsapp' : null);
  if (c.preferred_channel === 'whatsapp' && canWa) return 'whatsapp';
  return canEmail ? 'email' : canWa ? 'whatsapp' : null;
}

export interface CustomerCtx { partyId: string; ref: string; link: string; extra: Record<string, string> }
/** The customer behind a shipment / job / invoice / quote, plus display values for templates. Links point at the portal screen for that record. */
export async function customerOf(q: Q, type: string, id: string): Promise<CustomerCtx | null> {
  const portal = PORTAL();
  if (type === 'shipment') { const r = (await q.q(`SELECT j.customer_party_id, s.ref, s.delivered_at FROM logistics.shipments s JOIN logistics.jobs j ON j.id = s.job_id WHERE s.id=$1`, [id]))[0]; return r && { partyId: r.customer_party_id, ref: r.ref, link: `${portal}/shipments/${id}`, extra: { shipmentRef: r.ref, deliveredAt: r.delivered_at ? new Date(r.delivered_at).toISOString().slice(0, 10) : '' } }; }
  if (type === 'job') { const r = (await q.q(`SELECT customer_party_id, ref FROM logistics.jobs WHERE id=$1`, [id]))[0]; return r && { partyId: r.customer_party_id, ref: r.ref, link: `${portal}/shipments`, extra: { ref: r.ref } }; }
  if (type === 'invoice') { const r = (await q.q(`SELECT customer_party_id, ref, total, currency, due_date FROM finance.invoices WHERE id=$1`, [id]))[0]; return r && { partyId: r.customer_party_id, ref: r.ref ?? '', link: `${portal}/invoices/${id}`, extra: { invoiceRef: r.ref ?? '', amount: `${r.currency} ${Number(r.total).toFixed(2)}`, dueDate: r.due_date ? String(r.due_date).slice(0, 10) : '' } }; }
  if (type === 'quote') { const r = (await q.q(`SELECT customer_party_id, ref, valid_until FROM commercial.quotes WHERE id=$1`, [id]))[0]; return r && { partyId: r.customer_party_id, ref: r.ref, link: `${portal}/quotes/${id}`, extra: { quoteRef: r.ref, validUntil: String(r.valid_until).slice(0, 10) } }; }
  return null;
}
export const issuerOf = async (q: Q): Promise<Issuer> => { const e = (await q.q(`SELECT name, tax_registration_number, address, email, phone, website FROM org.legal_entities ORDER BY created_at LIMIT 1`))[0]; return e ? { name: e.name, trn: e.tax_registration_number, address: e.address, email: e.email, phone: e.phone, website: e.website } : {}; };

export interface NotifyInput { tenantId: string; aggregateType: string; aggregateId: string; template: string; channel?: 'email' | 'whatsapp'; vars?: Record<string, string>; dedupeKey: string; createdBy?: string | null }
/** Queue one message per eligible contact of the customer. Returns how many were queued; the same dedupeKey can never queue twice. */
export async function notifyCustomer(q: Q, n: NotifyInput): Promise<{ queued: number; skipped: number }> {
  if (!NOTIFICATION_TEMPLATES.some((t) => t.name === n.template)) throw new Error(`Unknown notification template "${n.template}"`);
  const c = await customerOf(q, n.aggregateType, n.aggregateId); if (!c) throw new Error(`No customer can be resolved for ${n.aggregateType} ${n.aggregateId}`);
  const contacts = await q.q<Contact>(`SELECT id, name, email, phone, preferred_channel, whatsapp_opt_in, email_opt_out FROM parties.contacts WHERE party_id=$1 ORDER BY name`, [c.partyId]);
  const issuer = await issuerOf(q); let queued = 0, skipped = 0;
  for (const k of contacts) {
    const ch = pickChannel(k, n.channel); if (!ch) { skipped++; continue; }
    const to = ch === 'email' ? k.email! : k.phone!; const vars = { ref: c.ref, link: c.link, ...c.extra, ...n.vars, customerName: k.name, issuerName: issuer.name ?? '' };
    const r = await q.q(`INSERT INTO integ.outbound_messages(tenant_id, channel, to_address, to_name, template, vars, related_type, related_id, party_id, dedupe_key, created_by)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING id`, [n.tenantId, ch, to, k.name, n.template, JSON.stringify({ ...vars, _issuer: issuer }), n.aggregateType, n.aggregateId, c.partyId, `${n.dedupeKey}:${k.id}:${ch}`, n.createdBy ?? null]);
    if (r.length) queued++;
  }
  return { queued, skipped };
}

/**
 * Sender loop (run every few seconds). Claims due rows with SKIP LOCKED (many workers can run), sends OUTSIDE any transaction, records the provider id.
 * Transient failures back off (1m, 5m, 30m, 2h, 6h); permanent ones fail at once with the provider's reason so staff can fix the cause and retry.
 * A crash between "provider accepted" and "row updated" can cause one duplicate send after the 10-minute recovery window: at-least-once, never silently lost.
 */
export async function sendDue(pool: pg.Pool, adapters: Record<'email' | 'whatsapp', ChannelAdapter>, limit = 20): Promise<number> {
  await pool.query(`UPDATE integ.outbound_messages SET status='queued', next_attempt_at=now() WHERE status='sending' AND claimed_at < now() - interval '10 minutes'`);
  const rows = (await pool.query(`UPDATE integ.outbound_messages SET status='sending', claimed_at=now(), attempts=attempts+1 WHERE id IN (SELECT id FROM integ.outbound_messages WHERE status='queued' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`, [limit])).rows;
  for (const r of rows) {
    const done = (sql: string, p: unknown[]) => inTenant(pool, r.tenant_id, (q) => q.q(sql, p));
    try {
      const { _issuer, ...vars } = r.vars as Record<string, any>; const rendered = renderNotification(r.template, vars, _issuer ?? {}, r.language);
      const out = await adapters[r.channel as 'email' | 'whatsapp'].send({ id: r.id, channel: r.channel, to: r.to_address, toName: r.to_name, rendered });
      await done(`UPDATE integ.outbound_messages SET status='sent', sent_at=now(), provider=$2, provider_message_id=$3, last_error=NULL WHERE id=$1`, [r.id, out.provider, out.providerMessageId]);
    } catch (e: any) {
      const retryable = e instanceof SendError ? e.retryable : false; const final = !retryable || r.attempts >= MAX_ATTEMPTS; const msg = String(e?.message ?? e).slice(0, 500);
      await done(`UPDATE integ.outbound_messages SET status=$2, last_error=$3, next_attempt_at = now() + ($4 || ' minutes')::interval WHERE id=$1`, [r.id, final ? 'failed' : 'queued', msg, String(BACKOFF_MIN[Math.min(r.attempts - 1, BACKOFF_MIN.length - 1)])]);
    }
  }
  return rows.length;
}
