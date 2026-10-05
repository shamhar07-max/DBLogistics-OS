import { NOTIFICATION_TEMPLATES, whatsappTemplateName } from '@dbl/contracts';

export interface Issuer { name?: string; address?: string; email?: string; phone?: string; website?: string; trn?: string }
export interface Rendered { email: { subject: string; text: string; html: string }; whatsapp: { name: string; language: string; params: string[] } }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const v = (vars: Record<string, string>, k: string) => (vars[k] ?? '').toString();

interface Copy { subject: (x: Record<string, string>) => string; paragraphs: (x: Record<string, string>) => string[]; cta: string }
const COPY: Record<string, Copy> = {
  shipment_update: { subject: (x) => `Shipment ${v(x, 'shipmentRef')}: ${v(x, 'milestone') || 'update'}`, cta: 'Track shipment', paragraphs: (x) => [`There is a new update on your shipment ${v(x, 'shipmentRef')}.`, v(x, 'milestone') ? `Latest milestone: ${v(x, 'milestone')}.` : ''] },
  delivery_completed: { subject: (x) => `Shipment ${v(x, 'shipmentRef')} has been delivered`, cta: 'View shipment and documents', paragraphs: (x) => [`Your shipment ${v(x, 'shipmentRef')} was delivered${v(x, 'deliveredAt') ? ` on ${v(x, 'deliveredAt')}` : ''}.`, 'Proof of delivery is on file and available in the portal.'] },
  invoice_posted: { subject: (x) => `Invoice ${v(x, 'invoiceRef')} from ${v(x, 'issuerName') || 'DigitalBurj Logistics'}`, cta: 'View and download invoice', paragraphs: (x) => [`A new tax invoice ${v(x, 'invoiceRef')} is available${v(x, 'amount') ? ` for ${v(x, 'amount')}` : ''}.`, v(x, 'dueDate') ? `Payment is due by ${v(x, 'dueDate')}.` : ''] },
  payment_reminder: { subject: (x) => `Payment reminder: invoice ${v(x, 'invoiceRef')}`, cta: 'View invoice', paragraphs: (x) => [`This is a friendly reminder that invoice ${v(x, 'invoiceRef')}${v(x, 'amount') ? ` (${v(x, 'amount')})` : ''} is due${v(x, 'dueDate') ? ` on ${v(x, 'dueDate')}` : ''}.`, 'If you have already paid, thank you — please disregard this message.'] },
  quote_ready: { subject: (x) => `Your quotation ${v(x, 'quoteRef')} is ready`, cta: 'Review quotation', paragraphs: (x) => [`Your quotation ${v(x, 'quoteRef')} is ready for review${v(x, 'validUntil') ? ` and valid until ${v(x, 'validUntil')}` : ''}.`, 'You can accept it online in a few clicks.'] },
  message_reply: { subject: (x) => `New message about ${v(x, 'ref') || 'your shipment'}`, cta: 'Read and reply', paragraphs: (x) => [`Our team replied to your conversation about ${v(x, 'ref') || 'your shipment'}:`, v(x, 'excerpt') ? `“${v(x, 'excerpt')}”` : ''] },
};

/** Email: responsive, table-based HTML (works in Outlook/Gmail), brand header with the unmodified master logo, one clear action, issuer footer. Every variable is escaped. */
export function renderNotification(name: string, vars: Record<string, string>, issuer: Issuer = {}, language = 'en', waLanguage = process.env.WHATSAPP_TEMPLATE_LANG ?? 'en'): Rendered {
  const spec = NOTIFICATION_TEMPLATES.find((t) => t.name === name); const copy = COPY[name]; if (!spec || !copy) throw new Error(`Unknown notification template "${name}"`);
  const greeting = `Hello${v(vars, 'customerName') ? ` ${v(vars, 'customerName')}` : ''},`; const paras = copy.paragraphs(vars).filter(Boolean); const link = v(vars, 'link'); const subject = copy.subject({ ...vars, issuerName: issuer.name ?? '' });
  const footerLines = [issuer.name, issuer.trn ? `TRN ${issuer.trn}` : '', issuer.address, [issuer.email, issuer.phone, issuer.website].filter(Boolean).join(' · ')].filter(Boolean) as string[];
  const text = [greeting, '', ...paras, '', link ? `${copy.cta}: ${link}` : '', '', '—', ...footerLines, 'Sent by DigitalBurj Logistics OS. Please do not reply to this automated message.'].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  const html = `<!doctype html><html lang="${esc(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F3F1EB;font-family:Arial,Helvetica,sans-serif;color:#12201D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F1EB"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:6px;overflow:hidden">
<tr><td style="padding:22px 28px 14px 28px;background:#FFFFFF"><img src="cid:dbl-logo" alt="DigitalBurj Logistics OS" width="210" style="display:block;border:0;height:auto"></td></tr>
<tr><td style="height:3px;background:#04302A;line-height:3px;font-size:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="60" style="height:3px;background:#E12509;font-size:0;line-height:3px">&nbsp;</td><td style="font-size:0">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:26px 28px 8px 28px;font-size:15px;line-height:22px"><p style="margin:0 0 14px 0;font-weight:bold">${esc(greeting)}</p>${paras.map((p) => `<p style="margin:0 0 12px 0">${esc(p)}</p>`).join('')}</td></tr>
${link ? `<tr><td style="padding:10px 28px 26px 28px"><a href="${esc(link)}" style="display:inline-block;background:#E12509;color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:14px;padding:12px 22px;border-radius:3px">${esc(copy.cta)}</a><p style="margin:12px 0 0 0;font-size:12px;color:#5B6B66">Or open: <a href="${esc(link)}" style="color:#5B6B66">${esc(link)}</a></p></td></tr>` : ''}
<tr><td style="padding:16px 28px 22px 28px;background:#F3F1EB;font-size:12px;line-height:18px;color:#5B6B66"><strong style="color:#04302A">${esc(issuer.name ?? 'DigitalBurj Logistics')}</strong>${footerLines.slice(1).map((l) => `<br>${esc(l)}`).join('')}<br><span style="color:#E12509">One system. Every operation.</span><br>This is an automated message — please do not reply.</td></tr>
</table></td></tr></table></body></html>`;
  return { email: { subject, text, html }, whatsapp: { name: whatsappTemplateName(name), language: waLanguage, params: spec.vars.map((k) => v(vars, k) || '-') } };
}
