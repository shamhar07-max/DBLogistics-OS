import { ROLE_TEMPLATES, type Permission } from '../../../packages/contracts/src/permissions';

/** Roles come from the Logistics OS permission model (packages/contracts), so the hub and the OS can never disagree about what a role may do. */
export const ROLES = ROLE_TEMPLATES;
export const EXTERNAL_ROLES = new Set(['customer_portal', 'agent_portal', 'transporter_portal', 'driver']);
export const ROLE_KEYS = Object.keys(ROLES);
export const INVITABLE_ROLES = ROLE_KEYS.filter((r) => r !== 'owner');
export const can = (role: string, p: Permission) => !!ROLES[role]?.permissions.includes(p);
export const canAny = (role: string, ps: readonly Permission[]) => ps.some((p) => can(role, p));

export interface Module { key: string; title: string; blurb: string; needs: Permission[]; scope: Permission[]; steps: string[]; external?: boolean }
/** Every module of the Logistics & Freight workspace, gated by permission. `needs` = any one grants entry; `scope` = what the role can do inside it. */
export const MODULES: Module[] = [
  { key: 'enquiries', title: 'Enquiries & quotes', blurb: 'Capture enquiries, build quotations with live totals, send, and convert acceptance into a job.', needs: ['enquiries.view', 'quotes.view'], scope: ['enquiries.view', 'enquiries.create', 'enquiries.qualify', 'quotes.view', 'quotes.create', 'quotes.approve', 'quotes.accept'], steps: ['Enquiry', 'Rate comparison', 'Quote', 'Accepted', 'Job'] },
  { key: 'rates', title: 'Rates & pricing', blurb: 'Versioned rate library for carriers and agents; margin rules owned by pricing.', needs: ['rates.view'], scope: ['rates.view', 'rates.manage', 'jobs.margin.view'], steps: ['Carrier rate', 'Validity', 'Margin rule', 'Quote line'] },
  { key: 'jobs', title: 'Jobs & shipments', blurb: 'One workspace per job: plan legs, bookings, cargo, tracking with estimates kept apart from actuals.', needs: ['jobs.view', 'shipments.view'], scope: ['jobs.view', 'jobs.margin.view', 'jobs.close', 'shipments.view', 'shipments.create', 'shipments.events.record', 'shipments.delivery.complete', 'bookings.create', 'bookings.confirm'], steps: ['Plan', 'Book', 'Move', 'Deliver', 'Close'] },
  { key: 'transport', title: 'Transport & dispatch', blurb: 'Assign vehicles and qualified drivers; trips complete with proof of delivery per stop.', needs: ['transport.view'], scope: ['transport.view', 'transport.dispatch', 'transport.pod.capture'], steps: ['Trip', 'Vehicle + driver', 'Dispatch', 'POD'] },
  { key: 'warehouse', title: 'Warehouse & custody', blurb: 'Receive cargo into customer custody, reserve, release with authority evidence, hold and quarantine.', needs: ['warehouse.view'], scope: ['warehouse.view', 'warehouse.receive', 'warehouse.adjust.approve', 'warehouse.release.request', 'warehouse.release.authorize', 'warehouse.hold.place'], steps: ['Receive', 'Putaway', 'Reserve', 'Release request', 'Authorise'] },
  { key: 'customs', title: 'Customs & trade', blurb: 'Customs cases; release recorded only against authority-issued approved evidence.', needs: ['customs.view'], scope: ['customs.view', 'customs.manage', 'customs.release.record', 'documents.approve'], steps: ['Case', 'Documents', 'Declaration', 'Release'] },
  { key: 'documents', title: 'Documents', blurb: 'Immutable versions, malware scan before use, approval, signed downloads; OCR suggestions for staff.', needs: ['documents.view'], scope: ['documents.view', 'documents.upload', 'documents.approve'], steps: ['Upload', 'Scan', 'Extract', 'Approve'] },
  { key: 'finance', title: 'Invoices & collections', blurb: 'Draft, approve (different person), post to ledger, receive and allocate payments.', needs: ['invoices.view'], scope: ['invoices.view', 'invoices.draft', 'invoices.approve', 'invoices.post', 'charges.create', 'bills.record', 'payments.record', 'payments.allocate', 'payments.authorize', 'bank-details.change.propose', 'bank-details.change.approve'], steps: ['Charges', 'Draft', 'Approve', 'Post', 'Collect'] },
  { key: 'approvals', title: 'Approvals', blurb: 'Maker-checker decisions queue: high-value, bank changes, adjustments.', needs: ['approvals.decide', 'approvals.request'], scope: ['approvals.request', 'approvals.decide'], steps: ['Request', 'Review', 'Decide'] },
  { key: 'people', title: 'People & quality', blurb: 'Employees, driver qualifications, incidents, holds and separately authorised release.', needs: ['people.view', 'quality.view'], scope: ['people.view', 'people.manage', 'quality.view', 'quality.manage', 'quality.hold.release'], steps: ['Roster', 'Qualification', 'Incident', 'Hold', 'Release'] },
  { key: 'reports', title: 'Owner & finance reports', blurb: 'Cash, receivables ageing, job profitability (estimated vs posted).', needs: ['reports.owner.view', 'reports.finance.view'], scope: ['reports.owner.view', 'reports.finance.view', 'jobs.margin.view'], steps: ['Overview', 'Ageing', 'Profitability'] },
  { key: 'automation', title: 'Automation & integrations', blurb: 'Validated workflow designer, email and WhatsApp delivery log, webhook inbox.', needs: ['automation.manage', 'integrations.manage'], scope: ['automation.manage', 'integrations.manage', 'ai.use'], steps: ['Trigger', 'Condition', 'Action', 'Run log'] },
  { key: 'portal', title: 'Customer & partner portal', blurb: 'Your shipments, documents, quotations, invoices and messages with the forwarder.', needs: ['shipments.view'], scope: ['shipments.view', 'documents.view', 'documents.upload', 'invoices.view', 'quotes.view', 'quotes.accept', 'conversations.post', 'transport.pod.capture', 'shipments.events.record'], steps: ['Track', 'Documents', 'Quotes', 'Invoices'], external: true },
];
/** External roles (customer / agent / transporter / driver) only ever see the portal module; staff roles never see it. */
export const modulesFor = (role: string) => MODULES.filter((m) => (EXTERNAL_ROLES.has(role) ? !!m.external : !m.external) && canAny(role, m.needs));
export const moduleFor = (role: string, key: string) => modulesFor(role).find((m) => m.key === key);
export const scopeOf = (role: string, m: Module) => m.scope.filter((p) => can(role, p));
