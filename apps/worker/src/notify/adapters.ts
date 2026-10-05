import { readFileSync } from 'node:fs';
import { createTransport, type Transporter } from 'nodemailer';
import type { Rendered } from './templates';

export interface Outbound { id: string; channel: 'email' | 'whatsapp'; to: string; toName?: string | null; rendered: Rendered }
export interface SendResult { provider: string; providerMessageId: string }
/** `retryable` separates "try again later" (network, 5xx, rate limit) from "this will never work" (bad address, unapproved template, no credentials). */
export class SendError extends Error { constructor(message: string, public retryable: boolean, public code?: string) { super(message); } }
export interface ChannelAdapter { readonly channel: 'email' | 'whatsapp'; readonly name: string; send(m: Outbound): Promise<SendResult> }

const LOGO = (() => { try { return readFileSync(new URL('../../../../packages/documents/assets/logo.png', import.meta.url)); } catch { return null; } })();

/** Real SMTP via nodemailer (any provider: SES/Mailgun/Postmark SMTP, Google Workspace, Mailpit in development). */
export class SmtpEmailAdapter implements ChannelAdapter {
  readonly channel = 'email' as const; readonly name = 'smtp'; private t: Transporter;
  constructor(url: string, private from: string, private replyTo?: string) { this.t = createTransport(`${url}${url.includes('?') ? '&' : '?'}pool=true&maxConnections=3&connectionTimeout=10000&socketTimeout=20000`); }
  async send(m: Outbound): Promise<SendResult> {
    try {
      const info = await this.t.sendMail({ from: this.from, to: m.toName ? { name: m.toName, address: m.to } : m.to, replyTo: this.replyTo, subject: m.rendered.email.subject, text: m.rendered.email.text, html: m.rendered.email.html,
        attachments: LOGO ? [{ filename: 'logo.png', content: LOGO, cid: 'dbl-logo', contentType: 'image/png' }] : [], headers: { 'X-Auto-Response-Suppress': 'All', 'Auto-Submitted': 'auto-generated' } });
      if (info.rejected?.length) throw new SendError(`Recipient rejected: ${info.rejected.join(', ')}`, false, 'REJECTED');
      return { provider: 'smtp', providerMessageId: String(info.messageId) };
    } catch (e: any) {
      if (e instanceof SendError) throw e;
      const code = Number(e?.responseCode); const permanent = code >= 500 && code < 600;            // 5xx = mailbox/policy problems; 4xx and network errors = try again
      throw new SendError(`SMTP ${e?.responseCode ?? e?.code ?? 'error'}: ${String(e?.response ?? e?.message ?? e).slice(0, 300)}`, !permanent, String(e?.code ?? code));
    }
  }
}

/** WhatsApp Cloud API (Meta). Business-initiated messages are template messages; delivery/read receipts arrive on the webhook. */
export class WhatsAppCloudAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const; readonly name = 'whatsapp-cloud';
  constructor(private cfg: { token: string; phoneNumberId: string; apiBase?: string; fetch?: typeof fetch; timeoutMs?: number }) {}
  async send(m: Outbound): Promise<SendResult> {
    const base = (this.cfg.apiBase ?? 'https://graph.facebook.com/v21.0').replace(/\/$/, ''); const f = this.cfg.fetch ?? fetch; const w = m.rendered.whatsapp;
    const body = { messaging_product: 'whatsapp', recipient_type: 'individual', to: m.to.replace(/^\+/, ''), type: 'template', template: { name: w.name, language: { code: w.language }, components: [{ type: 'body', parameters: w.params.map((text) => ({ type: 'text', text: text.slice(0, 1024) })) }] } };
    let res: Response;
    try { res = await f(`${base}/${this.cfg.phoneNumberId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${this.cfg.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000) }); }
    catch (e: any) { throw new SendError(`WhatsApp network error: ${e?.message ?? e}`, true, 'NETWORK'); }
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.messages?.[0]?.id) return { provider: 'whatsapp', providerMessageId: String(j.messages[0].id) };
    const err = j?.error ?? {}; const code = String(err.code ?? res.status); const msg = `WhatsApp ${code}${err.error_subcode ? `/${err.error_subcode}` : ''}: ${String(err.message ?? res.statusText).slice(0, 300)}`;
    const retryable = res.status === 429 || res.status >= 500 || ['4', '17', '80007', '130429', '131056'].includes(code);          // throttling / transient platform errors
    throw new SendError(msg, retryable, code);                                                                                         // e.g. 190 expired token, 131026 undeliverable, 132001 template missing, 131047 outside 24h window: fix, then retry manually
  }
}
const notConfigured = (channel: 'email' | 'whatsapp', hint: string): ChannelAdapter => ({ channel, name: 'not-configured', async send() { throw new SendError(`${channel} is not configured: ${hint}`, false, 'NOT_CONFIGURED'); } });
export function pickAdapters(env: Record<string, string | undefined> = process.env): { adapters: Record<'email' | 'whatsapp', ChannelAdapter>; summary: string } {
  const email = env.SMTP_URL ? new SmtpEmailAdapter(env.SMTP_URL, env.SMTP_FROM ?? 'DigitalBurj Logistics <no-reply@localhost>', env.SMTP_REPLY_TO) : notConfigured('email', 'set SMTP_URL (and SMTP_FROM)');
  const wa = env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? new WhatsAppCloudAdapter({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID, apiBase: env.WHATSAPP_API_BASE }) : notConfigured('whatsapp', 'set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID');
  return { adapters: { email, whatsapp: wa }, summary: `email: ${email.name} · whatsapp: ${wa.name}` };
}
