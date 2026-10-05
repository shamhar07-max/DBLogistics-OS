/**
 * Customer notification templates. The catalogue is shared by the workflow designer (what a notify step may use), the API (validation)
 * and the worker (rendering). WhatsApp business-initiated messages must use templates approved in Meta Business Manager: each template
 * `<name>` is sent as the approved WhatsApp template `dbl_<name>` with the listed variables as positional body parameters, in order.
 */
export interface TemplateSpec { name: string; title: string; description: string; vars: readonly string[] }
export const NOTIFICATION_TEMPLATES = [
  { name: 'shipment_update', title: 'Shipment update', description: 'A new milestone was recorded on a shipment.', vars: ['customerName', 'shipmentRef', 'milestone', 'link'] },
  { name: 'delivery_completed', title: 'Delivery completed', description: 'The shipment was delivered and proof of delivery is on file.', vars: ['customerName', 'shipmentRef', 'deliveredAt', 'link'] },
  { name: 'invoice_posted', title: 'Invoice issued', description: 'A tax invoice is available in the portal.', vars: ['customerName', 'invoiceRef', 'amount', 'dueDate', 'link'] },
  { name: 'payment_reminder', title: 'Payment reminder', description: 'An invoice is approaching or past its due date.', vars: ['customerName', 'invoiceRef', 'amount', 'dueDate', 'link'] },
  { name: 'quote_ready', title: 'Quotation ready', description: 'A quotation is ready for the customer to review and accept.', vars: ['customerName', 'quoteRef', 'validUntil', 'link'] },
  { name: 'message_reply', title: 'Reply from our team', description: 'Our team replied to the customer in the portal conversation.', vars: ['customerName', 'ref', 'excerpt', 'link'] },
] as const satisfies readonly TemplateSpec[];
export type NotificationTemplateName = (typeof NOTIFICATION_TEMPLATES)[number]['name'];
export const TEMPLATE_NAMES = NOTIFICATION_TEMPLATES.map((t) => t.name) as [NotificationTemplateName, ...NotificationTemplateName[]];
export const whatsappTemplateName = (n: string) => `dbl_${n}`;
