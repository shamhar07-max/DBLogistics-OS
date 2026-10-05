/** Permission catalogue + default role templates (seeded per tenant). Scope (entity/branch/party) is attached to the GRANT, not the permission. */
export const PERMISSIONS = [
  'parties.view', 'parties.create', 'bank-details.change.propose', 'bank-details.change.approve',
  'enquiries.view', 'enquiries.create', 'enquiries.qualify',
  'quotes.view', 'quotes.create', 'quotes.approve', 'quotes.accept',
  'rates.view', 'rates.manage',
  'jobs.view', 'jobs.margin.view', 'jobs.close',
  'shipments.view', 'shipments.create', 'shipments.events.record', 'shipments.delivery.complete',
  'bookings.create', 'bookings.confirm',
  'transport.view', 'transport.dispatch', 'transport.pod.capture',
  'warehouse.view', 'warehouse.receive', 'warehouse.adjust.approve', 'warehouse.release.request', 'warehouse.release.authorize', 'warehouse.hold.place',
  'customs.view', 'customs.manage', 'customs.release.record',
  'documents.view', 'documents.upload', 'documents.approve',
  'charges.create', 'invoices.view', 'invoices.draft', 'invoices.approve', 'invoices.post',
  'bills.record', 'payments.record', 'payments.allocate', 'payments.authorize',
  'approvals.request', 'approvals.decide',
  'automation.manage', 'integrations.manage', 'webhooks.receive',
  'ai.use', 'ai.tools.finance', 'ai.tools.operations', 'reports.owner.view', 'reports.finance.view', 'audit.view', 'admin.tenant',
  'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post',
  'people.view', 'people.manage', 'quality.view', 'quality.manage', 'quality.hold.release',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const all = [...PERMISSIONS] as Permission[];
const pick = (...p: Permission[]) => p;
const STAFF_COMMON: Permission[] = ['tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post'];
export const ROLE_TEMPLATES: Record<string, { name: string; permissions: Permission[] }> = {
  owner: { name: 'Owner', permissions: all },
  sales: { name: 'Sales', permissions: pick('parties.view', 'parties.create', 'enquiries.view', 'enquiries.create', 'enquiries.qualify', 'quotes.view', 'quotes.create', 'quotes.accept', 'rates.view', 'jobs.view', 'documents.view', 'ai.use', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post') },
  pricing: { name: 'Pricing', permissions: pick('parties.view', 'enquiries.view', 'quotes.view', 'quotes.create', 'quotes.approve', 'rates.view', 'rates.manage', 'jobs.margin.view', 'ai.use', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post') },
  freight_ops: { name: 'Freight operations', permissions: pick('parties.view', 'jobs.view', 'shipments.view', 'shipments.create', 'shipments.events.record', 'shipments.delivery.complete', 'bookings.create', 'bookings.confirm', 'transport.view', 'transport.dispatch', 'documents.view', 'documents.upload', 'charges.create', 'approvals.request', 'ai.use', 'ai.tools.operations', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post', 'quality.view', 'quality.manage', 'customs.view') },
  customer_service: { name: 'Customer service', permissions: pick('parties.view', 'enquiries.view', 'enquiries.create', 'jobs.view', 'shipments.view', 'documents.view', 'ai.use', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post', 'quality.view') },
  dispatcher: { name: 'Dispatcher', permissions: pick('shipments.view', 'transport.view', 'transport.dispatch', 'transport.pod.capture', 'documents.view', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post', 'people.view') },
  warehouse_supervisor: { name: 'Warehouse supervisor', permissions: pick('parties.view', 'warehouse.view', 'warehouse.receive', 'warehouse.adjust.approve', 'warehouse.release.authorize', 'warehouse.hold.place', 'jobs.view', 'shipments.view', 'documents.view', 'documents.upload', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post', 'quality.view', 'quality.manage', 'people.view') },
  warehouse_operator: { name: 'Warehouse operator', permissions: pick('parties.view', 'warehouse.view', 'warehouse.receive', 'warehouse.release.request', 'shipments.view', 'documents.upload', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post', 'quality.view') },
  customs_specialist: { name: 'Customs specialist', permissions: pick('customs.view', 'customs.manage', 'customs.release.record', 'documents.view', 'documents.upload', 'documents.approve', 'jobs.view', 'shipments.view', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post') },
  accountant: { name: 'Accountant', permissions: pick('parties.view', 'jobs.view', 'jobs.margin.view', 'charges.create', 'invoices.view', 'invoices.draft', 'bills.record', 'payments.record', 'payments.allocate', 'documents.view', 'ai.use', 'ai.tools.finance', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post', 'reports.finance.view') },
  finance_manager: { name: 'Finance manager', permissions: pick('parties.view', 'bank-details.change.propose', 'bank-details.change.approve', 'jobs.view', 'jobs.margin.view', 'jobs.close', 'charges.create', 'invoices.view', 'invoices.draft', 'invoices.approve', 'invoices.post', 'bills.record', 'payments.record', 'payments.allocate', 'payments.authorize', 'approvals.request', 'approvals.decide', 'reports.owner.view', 'audit.view', 'ai.use', 'ai.tools.finance', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post', 'reports.finance.view', 'people.view', 'integrations.manage') },
  hr: { name: 'HR', permissions: pick('people.view', 'people.manage', 'tasks.view', 'tasks.manage', 'parties.view') },
  quality_manager: { name: 'Quality manager', permissions: pick('quality.view', 'quality.manage', 'quality.hold.release', 'warehouse.view', 'shipments.view', 'jobs.view', 'documents.view', 'customs.view', 'tasks.view', 'tasks.manage', 'conversations.view', 'conversations.post', 'people.view') },
  auditor: { name: 'Auditor', permissions: pick('jobs.view', 'invoices.view', 'documents.view', 'audit.view', 'warehouse.view', 'customs.view', 'reports.finance.view', 'quality.view') },
  customer_portal: { name: 'Customer (portal)', permissions: pick('jobs.view', 'shipments.view', 'documents.view', 'documents.upload', 'invoices.view', 'quotes.view', 'quotes.accept', 'enquiries.view', 'enquiries.create') },
  agent_portal: { name: 'Agent (portal)', permissions: pick('shipments.view', 'shipments.events.record', 'documents.view', 'documents.upload') },
  transporter_portal: { name: 'Transporter (portal)', permissions: pick('transport.view', 'shipments.view', 'transport.pod.capture', 'documents.upload') },
  driver: { name: 'Driver', permissions: pick('transport.view', 'shipments.view', 'transport.pod.capture', 'documents.upload') },
};
