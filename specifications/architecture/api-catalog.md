# API catalog (generated)

Base path `/api/v1`. Full schemas: [`openapi.json`](./openapi.json). Money is a decimal **string**. 🔁 = requires `Idempotency-Key`; 🏷 = honours `If-Match: "<version>"`.

| Operation | Method & path | Permission | Notes |
|---|---|---|---|
| `getMe` | GET `/api/v1/me` | authenticated | Current user, tenant and effective permissions |
| `listMemberships` | GET `/api/v1/me/memberships` | authenticated | Tenants the user belongs to |
| `listLegalEntities` | GET `/api/v1/legal-entities` | `parties.view` | Legal entities |
| `listFacilities` | GET `/api/v1/facilities` | `parties.view` | Facilities (warehouses, yards, offices) and their locations |
| `listParties` | GET `/api/v1/parties` | `parties.view` | List parties |
| `createParty` | POST `/api/v1/parties` | `parties.create` | Create party |
| `proposeBankChange` | POST `/api/v1/parties/:id/bank-detail-changes` | `bank-details.change.propose` | Propose bank-detail change (maker) |
| `approveBankChange` | POST `/api/v1/bank-detail-changes/:id/approve` | `bank-details.change.approve` | Approve bank-detail change (checker, after call-back) |
| `listEnquiries` | GET `/api/v1/enquiries` | `enquiries.view` | List enquiries |
| `createEnquiry` | POST `/api/v1/enquiries` | `enquiries.create` | Create enquiry |
| `qualifyEnquiry` | POST `/api/v1/enquiries/:id/qualify` | `enquiries.qualify` | 🔁 Qualify enquiry; missing data becomes tasks |
| `listQuotes` | GET `/api/v1/quotes` | `quotes.view` | List quotes |
| `getQuote` | GET `/api/v1/quotes/:id` | `quotes.view` | Quote with lines and margin (if permitted) |
| `createQuote` | POST `/api/v1/quotes` | `quotes.create` | Create draft quote |
| `approveQuote` | POST `/api/v1/quotes/:id/approve` | `quotes.approve` | 🔁 🏷 Approve quote (not by its author) |
| `acceptQuote` | POST `/api/v1/quotes/:id/accept` | `quotes.accept` | 🔁 🏷 Accept quote → opens job |
| `listJobs` | GET `/api/v1/jobs` | `jobs.view` | List jobs |
| `getJob` | GET `/api/v1/jobs/:id` | `jobs.view` | Job workspace overview |
| `getJobMargin` | GET `/api/v1/jobs/:id/margin` | `jobs.margin.view` | Quoted, expected, accounting margin and cash |
| `closeJob` | POST `/api/v1/jobs/:id/close` | `jobs.close` | 🔁 🏷 Close job; unresolved items must be acknowledged |
| `createShipment` | POST `/api/v1/shipments` | `shipments.create` | Create shipment with cargo and legs |
| `getShipmentTimeline` | GET `/api/v1/shipments/:id/timeline` | `shipments.view` | Tracking timeline (source + actual/estimated) |
| `recordTrackingEvent` | POST `/api/v1/shipments/:id/events` | `shipments.events.record` | Record tracking event (dedupes by external id) |
| `completeDelivery` | POST `/api/v1/shipments/:id/complete-delivery` | `shipments.delivery.complete` | 🔁 Complete delivery with POD evidence |
| `requestBooking` | POST `/api/v1/bookings` | `bookings.create` | Request booking (idempotent by requestKey) |
| `confirmBooking` | POST `/api/v1/bookings/:id/confirm` | `bookings.confirm` | 🔁 🏷 Confirm booking with carrier reference |
| `markBookingOutcomeUnknown` | POST `/api/v1/bookings/:id/mark-outcome-unknown` | `bookings.create` | Provider call timed out: block re-submission until reconciled |
| `receiveCargo` | POST `/api/v1/receipts` | `warehouse.receive` | Receive cargo into custody |
| `listLots` | GET `/api/v1/warehouse/lots` | `warehouse.view` | Custody stock lots |
| `placeHold` | POST `/api/v1/warehouse/lots/:id/holds` | `warehouse.hold.place` | Quarantine / hold a lot |
| `requestRelease` | POST `/api/v1/release-orders` | `warehouse.release.request` | Request release (reserves quantity) |
| `authorizeRelease` | POST `/api/v1/release-orders/:id/authorize` | `warehouse.release.authorize` | 🔁 Authorize + execute release; checks holds, evidence, quantity |
| `createCustomsCase` | POST `/api/v1/customs-cases` | `customs.manage` | Open customs case |
| `recordCustomsRelease` | POST `/api/v1/customs-cases/:id/record-release` | `customs.release.record` | 🔁 Record authority release — evidence document required |
| `createUploadIntent` | POST `/api/v1/files/upload-intents` | `documents.upload` | Authorize a direct-to-storage upload |
| `registerDocument` | POST `/api/v1/documents` | `documents.upload` | Register uploaded file as an immutable document version |
| `approveDocument` | POST `/api/v1/documents/:id/approve` | `documents.approve` | 🏷 Approve document (clean scan required) |
| `createCharge` | POST `/api/v1/charges` | `charges.create` | Create revenue/cost charge for a service event (idempotent by event key) |
| `accrueCharge` | POST `/api/v1/charges/:id/accrue` | `charges.create` | 🔁 Accrue a cost charge (Dr cost / Cr accrued) |
| `createInvoiceDraft` | POST `/api/v1/invoices` | `invoices.draft` | Draft invoice from open revenue charges |
| `approveInvoice` | POST `/api/v1/invoices/:id/approve` | `invoices.approve` | 🔁 🏷 Approve invoice (not by its drafter) |
| `postInvoice` | POST `/api/v1/invoices/:id/post` | `invoices.post` | 🔁 🏷 Post invoice: one transaction, balanced journal, number allocation |
| `listInvoices` | GET `/api/v1/invoices` | `invoices.view` | List invoices |
| `recordSupplierBill` | POST `/api/v1/supplier-bills` | `bills.record` | 🔁 Record supplier bill; clears accrual; duplicate detection |
| `recordPayment` | POST `/api/v1/payments` | `payments.record` | Record customer receipt |
| `allocatePayment` | POST `/api/v1/payments/:id/allocate` | `payments.allocate` | 🔁 Allocate payment to invoice (never beyond available) |
| `listApprovalRequests` | GET `/api/v1/approval-requests` | `approvals.request` | Approval inbox |
| `createApprovalRequest` | POST `/api/v1/approval-requests` | `approvals.request` | Request approval |
| `approveRequest` | POST `/api/v1/approval-requests/:id/approve` | `approvals.decide` | Approve (not by requester) |
| `rejectRequest` | POST `/api/v1/approval-requests/:id/reject` | `approvals.decide` | Reject |
| `syncDeviceCommands` | POST `/api/v1/device/commands` | `transport.pod.capture` | Offline command sync — one effect per commandId |
| `receiveWebhook` | POST `/api/v1/webhooks/:provider` | public (HMAC) | Signed provider webhook; dedupes by external event id |
| `createWorkflow` | POST `/api/v1/workflows` | `automation.manage` | Create workflow definition (draft) |
| `activateWorkflow` | POST `/api/v1/workflows/:id/activate` | `automation.manage` | Activate workflow version |
| `invokeAiTool` | POST `/api/v1/ai/tools/:name/invoke` | `ai.use` | Invoke a controlled AI tool as the calling user |
| `getOwnerOverview` | GET `/api/v1/reports/owner-overview` | `reports.owner.view` | Owner overview KPIs (live, drill-down ready) |
| `getParty` | GET `/api/v1/parties/:id` | `parties.view` | Party 360: roles, bank details, open work |
| `listBankChanges` | GET `/api/v1/bank-detail-changes` | `bank-details.change.propose` | Bank-detail change requests |
| `listShipments` | GET `/api/v1/shipments` | `shipments.view` | Shipments (optionally by job) |
| `getShipment` | GET `/api/v1/shipments/:id` | `shipments.view` | Shipment with legs, cargo, bookings |
| `listTrips` | GET `/api/v1/trips` | `transport.view` | Trips with stops and POD state |
| `createTrip` | POST `/api/v1/trips` | `transport.dispatch` | Plan a trip |
| `dispatchTrip` | POST `/api/v1/trips/:id/dispatch` | `transport.dispatch` | 🔁 Dispatch trip (driver must hold a valid driving qualification) |
| `listCustomsCases` | GET `/api/v1/customs-cases` | `customs.view` | Customs cases: authority vs internal status |
| `listDocuments` | GET `/api/v1/documents` | `documents.view` | Document library |
| `getDocumentDownloadUrl` | GET `/api/v1/documents/:id/download-url` | `documents.view` | Short-lived signed download URL (clean documents only) |
| `listTasks` | GET `/api/v1/tasks` | `tasks.view` | Tasks |
| `createTask` | POST `/api/v1/tasks` | `tasks.manage` | Create task |
| `completeTask` | POST `/api/v1/tasks/:id/complete` | `tasks.manage` | Complete task |
| `listMessages` | GET `/api/v1/messages` | `conversations.view` | Conversation log for a record (append-only) |
| `postMessage` | POST `/api/v1/messages` | `conversations.post` | Log a message / call note against a record |
| `listEmployees` | GET `/api/v1/employees` | `people.view` | Employees |
| `createEmployee` | POST `/api/v1/employees` | `people.manage` | Create employee |
| `addQualification` | POST `/api/v1/employees/:id/qualifications` | `people.manage` | Record a qualification with validity |
| `listQualifications` | GET `/api/v1/qualifications` | `people.view` | Qualifications (filter: expiring within N days) |
| `listAssets` | GET `/api/v1/assets` | `people.view` | Operating assets with service / calibration due |
| `createAsset` | POST `/api/v1/assets` | `people.manage` | Register asset |
| `listIncidents` | GET `/api/v1/incidents` | `quality.view` | Incidents |
| `createIncident` | POST `/api/v1/incidents` | `quality.manage` | Report incident (optionally placing a hold on a lot) |
| `investigateIncident` | POST `/api/v1/incidents/:id/investigate` | `quality.manage` | Start investigation |
| `resolveIncident` | POST `/api/v1/incidents/:id/resolve` | `quality.manage` | Resolve incident — never auto-releases holds |
| `listClaims` | GET `/api/v1/claims` | `quality.view` | Claims |
| `createClaim` | POST `/api/v1/claims` | `quality.manage` | Open claim against an incident |
| `listHolds` | GET `/api/v1/warehouse/holds` | `warehouse.view` | Holds (active and released) |
| `releaseHold` | POST `/api/v1/warehouse/holds/:id/release` | `quality.hold.release` | 🔁 Release hold (quality role, not the person who placed it) |
| `listReleaseOrders` | GET `/api/v1/release-orders` | `warehouse.view` | Release orders |
| `listCharges` | GET `/api/v1/charges` | `jobs.margin.view` | Charges for a job (cost data → margin permission) |
| `listPayments` | GET `/api/v1/payments` | `invoices.view` | Customer receipts |
| `listSupplierBills` | GET `/api/v1/supplier-bills` | `bills.record` | Supplier bills |
| `getReceivablesAgeing` | GET `/api/v1/reports/receivables-ageing` | `reports.finance.view` | Receivables ageing by due date |
| `getJobProfitability` | GET `/api/v1/reports/job-profitability` | `reports.finance.view` | Per-job expected vs accounting margin |
| `listAiTools` | GET `/api/v1/ai/tools` | `ai.use` | Controlled AI tools and whether the caller may use them |
| `listWorkflows` | GET `/api/v1/workflows` | `automation.manage` | Workflow definitions (versioned) |
| `listWorkflowRuns` | GET `/api/v1/workflow-runs` | `automation.manage` | Workflow executions |
| `listIntegrations` | GET `/api/v1/integrations` | `integrations.manage` | Connections and health (no secrets) |
| `listMembers` | GET `/api/v1/admin/members` | `admin.tenant` | Tenant members and roles |
| `addMember` | POST `/api/v1/admin/members` | `admin.tenant` | Add member with a role template |
| `listRoles` | GET `/api/v1/admin/roles` | `admin.tenant` | Roles and their permissions |
| `listAuditEvents` | GET `/api/v1/audit-events` | `audit.view` | Append-only audit log |
