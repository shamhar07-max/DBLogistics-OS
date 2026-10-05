import type { ZodTypeAny } from 'zod';
import type { Permission } from './permissions';
import * as S from './schemas';

export interface RouteDef {
  method: 'GET' | 'POST'; path: string; operationId: string; tag: string; summary: string;
  permission: Permission | null; idempotent?: boolean; ifMatch?: boolean; body?: ZodTypeAny; query?: ZodTypeAny; public?: boolean; status?: number;
}
const r = <const T extends RouteDef>(d: T): T => d;

/** Single source of truth: controllers are verified against this table by a conformance test; OpenAPI + typed client derive from it. */
export const ROUTE_TABLE = [
  r({ method: 'GET', path: '/me', operationId: 'getMe', tag: 'Session', summary: 'Current user, tenant and effective permissions', permission: null }),
  r({ method: 'GET', path: '/me/memberships', operationId: 'listMemberships', tag: 'Session', summary: 'Tenants the user belongs to', permission: null }),
  r({ method: 'GET', path: '/legal-entities', operationId: 'listLegalEntities', tag: 'Organization', summary: 'Legal entities', permission: 'parties.view' }),
  r({ method: 'GET', path: '/facilities', operationId: 'listFacilities', tag: 'Organization', summary: 'Facilities (warehouses, yards, offices) and their locations', permission: 'parties.view' }),
  r({ method: 'GET', path: '/parties', operationId: 'listParties', tag: 'Parties', summary: 'List parties', permission: 'parties.view' }),
  r({ method: 'POST', path: '/parties', operationId: 'createParty', tag: 'Parties', summary: 'Create party', permission: 'parties.create', body: S.CreatePartyBody, status: 201 }),
  r({ method: 'POST', path: '/parties/:id/bank-detail-changes', operationId: 'proposeBankChange', tag: 'Parties', summary: 'Propose bank-detail change (maker)', permission: 'bank-details.change.propose', body: S.BankChangeBody, status: 201 }),
  r({ method: 'POST', path: '/bank-detail-changes/:id/approve', operationId: 'approveBankChange', tag: 'Parties', summary: 'Approve bank-detail change (checker, after call-back)', permission: 'bank-details.change.approve', body: S.ApproveBankChangeBody }),
  r({ method: 'GET', path: '/enquiries', operationId: 'listEnquiries', tag: 'Commercial', summary: 'List enquiries', permission: 'enquiries.view' }),
  r({ method: 'POST', path: '/enquiries', operationId: 'createEnquiry', tag: 'Commercial', summary: 'Create enquiry', permission: 'enquiries.create', body: S.CreateEnquiryBody, status: 201 }),
  r({ method: 'POST', path: '/enquiries/:id/qualify', operationId: 'qualifyEnquiry', tag: 'Commercial', summary: 'Qualify enquiry; missing data becomes tasks', permission: 'enquiries.qualify', idempotent: true }),
  r({ method: 'GET', path: '/quotes', operationId: 'listQuotes', tag: 'Commercial', summary: 'List quotes', permission: 'quotes.view' }),
  r({ method: 'GET', path: '/quotes/:id', operationId: 'getQuote', tag: 'Commercial', summary: 'Quote with lines and margin (if permitted)', permission: 'quotes.view' }),
  r({ method: 'POST', path: '/quotes', operationId: 'createQuote', tag: 'Commercial', summary: 'Create draft quote', permission: 'quotes.create', body: S.CreateQuoteBody, status: 201 }),
  r({ method: 'POST', path: '/quotes/:id/approve', operationId: 'approveQuote', tag: 'Commercial', summary: 'Approve quote (not by its author)', permission: 'quotes.approve', idempotent: true, ifMatch: true }),
  r({ method: 'POST', path: '/quotes/:id/accept', operationId: 'acceptQuote', tag: 'Commercial', summary: 'Accept quote → opens job', permission: 'quotes.accept', idempotent: true, ifMatch: true, body: S.AcceptQuoteBody }),
  r({ method: 'GET', path: '/jobs', operationId: 'listJobs', tag: 'Logistics', summary: 'List jobs', permission: 'jobs.view' }),
  r({ method: 'GET', path: '/jobs/:id', operationId: 'getJob', tag: 'Logistics', summary: 'Job workspace overview', permission: 'jobs.view' }),
  r({ method: 'GET', path: '/jobs/:id/margin', operationId: 'getJobMargin', tag: 'Logistics', summary: 'Quoted, expected, accounting margin and cash', permission: 'jobs.margin.view' }),
  r({ method: 'POST', path: '/jobs/:id/close', operationId: 'closeJob', tag: 'Logistics', summary: 'Close job; unresolved items must be acknowledged', permission: 'jobs.close', idempotent: true, ifMatch: true, body: S.CloseJobBody }),
  r({ method: 'POST', path: '/shipments', operationId: 'createShipment', tag: 'Logistics', summary: 'Create shipment with cargo and legs', permission: 'shipments.create', body: S.CreateShipmentBody, status: 201 }),
  r({ method: 'GET', path: '/shipments/:id/timeline', operationId: 'getShipmentTimeline', tag: 'Logistics', summary: 'Tracking timeline (source + actual/estimated)', permission: 'shipments.view' }),
  r({ method: 'POST', path: '/shipments/:id/events', operationId: 'recordTrackingEvent', tag: 'Logistics', summary: 'Record tracking event (dedupes by external id)', permission: 'shipments.events.record', body: S.TrackingEventBody, status: 201 }),
  r({ method: 'POST', path: '/shipments/:id/complete-delivery', operationId: 'completeDelivery', tag: 'Logistics', summary: 'Complete delivery with POD evidence', permission: 'shipments.delivery.complete', idempotent: true, body: S.CompleteDeliveryBody }),
  r({ method: 'POST', path: '/bookings', operationId: 'requestBooking', tag: 'Logistics', summary: 'Request booking (idempotent by requestKey)', permission: 'bookings.create', body: S.RequestBookingBody, status: 201 }),
  r({ method: 'POST', path: '/bookings/:id/confirm', operationId: 'confirmBooking', tag: 'Logistics', summary: 'Confirm booking with carrier reference', permission: 'bookings.confirm', idempotent: true, ifMatch: true, body: S.ConfirmBookingBody }),
  r({ method: 'POST', path: '/bookings/:id/mark-outcome-unknown', operationId: 'markBookingOutcomeUnknown', tag: 'Logistics', summary: 'Provider call timed out: block re-submission until reconciled', permission: 'bookings.create' }),
  r({ method: 'POST', path: '/receipts', operationId: 'receiveCargo', tag: 'Warehouse', summary: 'Receive cargo into custody', permission: 'warehouse.receive', body: S.ReceiptBody, status: 201 }),
  r({ method: 'GET', path: '/warehouse/lots', operationId: 'listLots', tag: 'Warehouse', summary: 'Custody stock lots', permission: 'warehouse.view' }),
  r({ method: 'POST', path: '/warehouse/lots/:id/holds', operationId: 'placeHold', tag: 'Warehouse', summary: 'Quarantine / hold a lot', permission: 'warehouse.hold.place', body: S.HoldBody, status: 201 }),
  r({ method: 'POST', path: '/release-orders', operationId: 'requestRelease', tag: 'Warehouse', summary: 'Request release (reserves quantity)', permission: 'warehouse.release.request', body: S.ReleaseOrderBody, status: 201 }),
  r({ method: 'POST', path: '/release-orders/:id/authorize', operationId: 'authorizeRelease', tag: 'Warehouse', summary: 'Authorize + execute release; checks holds, evidence, quantity', permission: 'warehouse.release.authorize', idempotent: true }),
  r({ method: 'POST', path: '/customs-cases', operationId: 'createCustomsCase', tag: 'Trade', summary: 'Open customs case', permission: 'customs.manage', body: S.CustomsCaseBody, status: 201 }),
  r({ method: 'POST', path: '/customs-cases/:id/record-release', operationId: 'recordCustomsRelease', tag: 'Trade', summary: 'Record authority release — evidence document required', permission: 'customs.release.record', idempotent: true, body: S.RecordCustomsReleaseBody }),
  r({ method: 'POST', path: '/files/upload-intents', operationId: 'createUploadIntent', tag: 'Documents', summary: 'Authorize a direct-to-storage upload', permission: 'documents.upload', body: S.UploadIntentBody, status: 201 }),
  r({ method: 'POST', path: '/documents', operationId: 'registerDocument', tag: 'Documents', summary: 'Register uploaded file as an immutable document version', permission: 'documents.upload', body: S.RegisterDocumentBody, status: 201 }),
  r({ method: 'POST', path: '/documents/:id/approve', operationId: 'approveDocument', tag: 'Documents', summary: 'Approve document (clean scan required)', permission: 'documents.approve', ifMatch: true }),
  r({ method: 'POST', path: '/charges', operationId: 'createCharge', tag: 'Finance', summary: 'Create revenue/cost charge for a service event (idempotent by event key)', permission: 'charges.create', body: S.CreateChargeBody, status: 201 }),
  r({ method: 'POST', path: '/charges/:id/accrue', operationId: 'accrueCharge', tag: 'Finance', summary: 'Accrue a cost charge (Dr cost / Cr accrued)', permission: 'charges.create', idempotent: true }),
  r({ method: 'POST', path: '/invoices', operationId: 'createInvoiceDraft', tag: 'Finance', summary: 'Draft invoice from open revenue charges', permission: 'invoices.draft', body: S.CreateInvoiceBody, status: 201 }),
  r({ method: 'POST', path: '/invoices/:id/approve', operationId: 'approveInvoice', tag: 'Finance', summary: 'Approve invoice (not by its drafter)', permission: 'invoices.approve', ifMatch: true, idempotent: true }),
  r({ method: 'POST', path: '/invoices/:id/post', operationId: 'postInvoice', tag: 'Finance', summary: 'Post invoice: one transaction, balanced journal, number allocation', permission: 'invoices.post', idempotent: true, ifMatch: true, body: S.PostInvoiceBody }),
  r({ method: 'GET', path: '/invoices', operationId: 'listInvoices', tag: 'Finance', summary: 'List invoices', permission: 'invoices.view' }),
  r({ method: 'POST', path: '/supplier-bills', operationId: 'recordSupplierBill', tag: 'Finance', summary: 'Record supplier bill; clears accrual; duplicate detection', permission: 'bills.record', idempotent: true, body: S.SupplierBillBody, status: 201 }),
  r({ method: 'POST', path: '/payments', operationId: 'recordPayment', tag: 'Finance', summary: 'Record customer receipt', permission: 'payments.record', body: S.PaymentBody, status: 201 }),
  r({ method: 'POST', path: '/payments/:id/allocate', operationId: 'allocatePayment', tag: 'Finance', summary: 'Allocate payment to invoice (never beyond available)', permission: 'payments.allocate', idempotent: true, body: S.AllocatePaymentBody }),
  r({ method: 'GET', path: '/approval-requests', operationId: 'listApprovalRequests', tag: 'Collaboration', summary: 'Approval inbox', permission: 'approvals.request' }),
  r({ method: 'POST', path: '/approval-requests', operationId: 'createApprovalRequest', tag: 'Collaboration', summary: 'Request approval', permission: 'approvals.request', body: S.ApprovalRequestBody, status: 201 }),
  r({ method: 'POST', path: '/approval-requests/:id/approve', operationId: 'approveRequest', tag: 'Collaboration', summary: 'Approve (not by requester)', permission: 'approvals.decide', body: S.DecideBody }),
  r({ method: 'POST', path: '/approval-requests/:id/reject', operationId: 'rejectRequest', tag: 'Collaboration', summary: 'Reject', permission: 'approvals.decide', body: S.DecideBody }),
  r({ method: 'POST', path: '/device/commands', operationId: 'syncDeviceCommands', tag: 'Mobile', summary: 'Offline command sync — one effect per commandId', permission: 'transport.pod.capture', body: S.DeviceCommandBatchBody }),
  r({ method: 'POST', path: '/webhooks/:provider', operationId: 'receiveWebhook', tag: 'Integrations', summary: 'Signed provider webhook; dedupes by external event id', permission: null, public: true }),
  r({ method: 'POST', path: '/workflows', operationId: 'createWorkflow', tag: 'Automation', summary: 'Create workflow definition (draft)', permission: 'automation.manage', body: S.WorkflowBody, status: 201 }),
  r({ method: 'POST', path: '/workflows/:id/activate', operationId: 'activateWorkflow', tag: 'Automation', summary: 'Activate workflow version', permission: 'automation.manage' }),
  r({ method: 'POST', path: '/ai/tools/:name/invoke', operationId: 'invokeAiTool', tag: 'Intelligence', summary: 'Invoke a controlled AI tool as the calling user', permission: 'ai.use', body: S.AiToolInvokeBody }),
  r({ method: 'GET', path: '/reports/owner-overview', operationId: 'getOwnerOverview', tag: 'Intelligence', summary: 'Owner overview KPIs (live, drill-down ready)', permission: 'reports.owner.view' }),
  // ---- breadth release: remaining staff areas ----
  r({ method: 'GET', path: '/parties/:id', operationId: 'getParty', tag: 'Parties', summary: 'Party 360: roles, bank details, open work', permission: 'parties.view' }),
  r({ method: 'GET', path: '/bank-detail-changes', operationId: 'listBankChanges', tag: 'Parties', summary: 'Bank-detail change requests', permission: 'bank-details.change.propose' }),
  r({ method: 'GET', path: '/shipments', operationId: 'listShipments', tag: 'Logistics', summary: 'Shipments (optionally by job)', permission: 'shipments.view', query: S.JobQuery }),
  r({ method: 'GET', path: '/shipments/:id', operationId: 'getShipment', tag: 'Logistics', summary: 'Shipment with legs, cargo, bookings', permission: 'shipments.view' }),
  r({ method: 'GET', path: '/trips', operationId: 'listTrips', tag: 'Transport', summary: 'Trips with stops and POD state', permission: 'transport.view' }),
  r({ method: 'POST', path: '/trips', operationId: 'createTrip', tag: 'Transport', summary: 'Plan a trip', permission: 'transport.dispatch', body: S.CreateTripBody, status: 201 }),
  r({ method: 'POST', path: '/trips/:id/dispatch', operationId: 'dispatchTrip', tag: 'Transport', summary: 'Dispatch trip (driver must hold a valid driving qualification)', permission: 'transport.dispatch', idempotent: true }),
  r({ method: 'GET', path: '/customs-cases', operationId: 'listCustomsCases', tag: 'Trade', summary: 'Customs cases: authority vs internal status', permission: 'customs.view' }),
  r({ method: 'GET', path: '/documents', operationId: 'listDocuments', tag: 'Documents', summary: 'Document library', permission: 'documents.view', query: S.DocumentQuery }),
  r({ method: 'GET', path: '/documents/:id/download-url', operationId: 'getDocumentDownloadUrl', tag: 'Documents', summary: 'Short-lived signed download URL (clean documents only)', permission: 'documents.view' }),
  r({ method: 'GET', path: '/tasks', operationId: 'listTasks', tag: 'Collaboration', summary: 'Tasks', permission: 'tasks.view', query: S.RelatedQuery }),
  r({ method: 'POST', path: '/tasks', operationId: 'createTask', tag: 'Collaboration', summary: 'Create task', permission: 'tasks.manage', body: S.CreateTaskBody, status: 201 }),
  r({ method: 'POST', path: '/tasks/:id/complete', operationId: 'completeTask', tag: 'Collaboration', summary: 'Complete task', permission: 'tasks.manage' }),
  r({ method: 'GET', path: '/messages', operationId: 'listMessages', tag: 'Collaboration', summary: 'Conversation log for a record (append-only)', permission: 'conversations.view', query: S.RelatedQuery }),
  r({ method: 'POST', path: '/messages', operationId: 'postMessage', tag: 'Collaboration', summary: 'Log a message / call note against a record', permission: 'conversations.post', body: S.PostMessageBody, status: 201 }),
  r({ method: 'GET', path: '/employees', operationId: 'listEmployees', tag: 'People', summary: 'Employees', permission: 'people.view' }),
  r({ method: 'POST', path: '/employees', operationId: 'createEmployee', tag: 'People', summary: 'Create employee', permission: 'people.manage', body: S.CreateEmployeeBody, status: 201 }),
  r({ method: 'POST', path: '/employees/:id/qualifications', operationId: 'addQualification', tag: 'People', summary: 'Record a qualification with validity', permission: 'people.manage', body: S.AddQualificationBody, status: 201 }),
  r({ method: 'GET', path: '/qualifications', operationId: 'listQualifications', tag: 'People', summary: 'Qualifications (filter: expiring within N days)', permission: 'people.view', query: S.ExpiringQuery }),
  r({ method: 'GET', path: '/assets', operationId: 'listAssets', tag: 'People', summary: 'Operating assets with service / calibration due', permission: 'people.view' }),
  r({ method: 'POST', path: '/assets', operationId: 'createAsset', tag: 'People', summary: 'Register asset', permission: 'people.manage', body: S.CreateAssetBody, status: 201 }),
  r({ method: 'GET', path: '/incidents', operationId: 'listIncidents', tag: 'Quality', summary: 'Incidents', permission: 'quality.view', query: S.RelatedQuery }),
  r({ method: 'POST', path: '/incidents', operationId: 'createIncident', tag: 'Quality', summary: 'Report incident (optionally placing a hold on a lot)', permission: 'quality.manage', body: S.CreateIncidentBody, status: 201 }),
  r({ method: 'POST', path: '/incidents/:id/investigate', operationId: 'investigateIncident', tag: 'Quality', summary: 'Start investigation', permission: 'quality.manage' }),
  r({ method: 'POST', path: '/incidents/:id/resolve', operationId: 'resolveIncident', tag: 'Quality', summary: 'Resolve incident — never auto-releases holds', permission: 'quality.manage', body: S.ResolveIncidentBody }),
  r({ method: 'GET', path: '/claims', operationId: 'listClaims', tag: 'Quality', summary: 'Claims', permission: 'quality.view' }),
  r({ method: 'POST', path: '/claims', operationId: 'createClaim', tag: 'Quality', summary: 'Open claim against an incident', permission: 'quality.manage', body: S.CreateClaimBody, status: 201 }),
  r({ method: 'GET', path: '/warehouse/holds', operationId: 'listHolds', tag: 'Warehouse', summary: 'Holds (active and released)', permission: 'warehouse.view' }),
  r({ method: 'POST', path: '/warehouse/holds/:id/release', operationId: 'releaseHold', tag: 'Warehouse', summary: 'Release hold (quality role, not the person who placed it)', permission: 'quality.hold.release', body: S.ReleaseHoldBody, idempotent: true }),
  r({ method: 'GET', path: '/release-orders', operationId: 'listReleaseOrders', tag: 'Warehouse', summary: 'Release orders', permission: 'warehouse.view' }),
  r({ method: 'GET', path: '/charges', operationId: 'listCharges', tag: 'Finance', summary: 'Charges for a job (cost data → margin permission)', permission: 'jobs.margin.view', query: S.JobQuery }),
  r({ method: 'GET', path: '/payments', operationId: 'listPayments', tag: 'Finance', summary: 'Customer receipts', permission: 'invoices.view' }),
  r({ method: 'GET', path: '/supplier-bills', operationId: 'listSupplierBills', tag: 'Finance', summary: 'Supplier bills', permission: 'bills.record' }),
  r({ method: 'GET', path: '/reports/receivables-ageing', operationId: 'getReceivablesAgeing', tag: 'Intelligence', summary: 'Receivables ageing by due date', permission: 'reports.finance.view' }),
  r({ method: 'GET', path: '/reports/job-profitability', operationId: 'getJobProfitability', tag: 'Intelligence', summary: 'Per-job expected vs accounting margin', permission: 'reports.finance.view' }),
  r({ method: 'GET', path: '/ai/tools', operationId: 'listAiTools', tag: 'Intelligence', summary: 'Controlled AI tools and whether the caller may use them', permission: 'ai.use' }),
  r({ method: 'GET', path: '/workflows', operationId: 'listWorkflows', tag: 'Automation', summary: 'Workflow definitions (versioned)', permission: 'automation.manage' }),
  r({ method: 'GET', path: '/workflow-runs', operationId: 'listWorkflowRuns', tag: 'Automation', summary: 'Workflow executions', permission: 'automation.manage' }),
  r({ method: 'GET', path: '/integrations', operationId: 'listIntegrations', tag: 'Integrations', summary: 'Connections and health (no secrets)', permission: 'integrations.manage' }),
  r({ method: 'GET', path: '/admin/members', operationId: 'listMembers', tag: 'Administration', summary: 'Tenant members and roles', permission: 'admin.tenant' }),
  r({ method: 'POST', path: '/admin/members', operationId: 'addMember', tag: 'Administration', summary: 'Add member with a role template', permission: 'admin.tenant', body: S.AddMemberBody, status: 201 }),
  r({ method: 'GET', path: '/admin/roles', operationId: 'listRoles', tag: 'Administration', summary: 'Roles and their permissions', permission: 'admin.tenant' }),
  r({ method: 'GET', path: '/audit-events', operationId: 'listAuditEvents', tag: 'Administration', summary: 'Append-only audit log', permission: 'audit.view', query: S.AuditQuery }),
];

export const ROUTES: readonly RouteDef[] = ROUTE_TABLE;
export type Route = (typeof ROUTE_TABLE)[number];
export type OperationId = Route['operationId'];
type ById<Id extends OperationId> = Extract<Route, { operationId: Id }>;
/** Request body type for an operation (input side of its Zod schema). */
export type BodyOf<Id extends OperationId> = ById<Id> extends { body: infer B extends ZodTypeAny } ? import('zod').z.input<B> : undefined;
export type PathParamsOf<P extends string> = P extends `${string}:${infer Rest}` ? (Rest extends `${infer N}/${infer T}` ? { [K in N]: string } & PathParamsOf<T> : { [K in Rest]: string }) : {};
export type ParamsOf<Id extends OperationId> = PathParamsOf<ById<Id>['path']>;
export const ROUTE_BY_ID: Record<string, RouteDef> = Object.fromEntries(ROUTE_TABLE.map((x) => [x.operationId, x]));
