import { z } from 'zod';
import { CurrencyCode, MoneyString } from './money';

export const Uuid = z.string().uuid();
const Mode = z.enum(['ocean_fcl', 'ocean_lcl', 'air', 'road', 'multimodal', 'warehouse', 'customs']);
const PartyRole = z.enum(['customer', 'supplier', 'shipper', 'consignee', 'agent', 'transporter', 'carrier', 'insurer', 'broker']);
const TaxCode = z.enum(['SR5', 'ZR', 'EX', 'OOS']);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.string().datetime({ offset: true });

export const Page = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional() });

// ---- Parties
export const CreatePartyBody = z.object({
  legalName: z.string().min(1), tradingName: z.string().optional(), taxRegistrationNumber: z.string().optional(),
  country: z.string().length(2).optional(), roles: z.array(PartyRole).min(1),
});
export const BankChangeBody = z.object({ accountName: z.string().min(1), iban: z.string().min(8), swift: z.string().optional(), currency: CurrencyCode });
export const ApproveBankChangeBody = z.object({ callbackVerified: z.literal(true) });

// ---- Commercial
export const CreateEnquiryBody = z.object({
  legalEntityId: Uuid.optional(), customerPartyId: Uuid.optional(),             // staff must supply both; portal users never do (the server fills them)
  mode: Mode, origin: z.string().min(2), destination: z.string().min(2),
  incoterm: z.string().optional(), cargo: z.record(z.unknown()).default({}),
  source: z.enum(['staff', 'email', 'whatsapp', 'portal', 'api', 'website']).default('staff'),
});
export const QuoteLineIn = z.object({
  description: z.string().min(1), chargeType: z.enum(['fixed', 'estimated', 'at_cost', 'conditional']),
  chargeGroup: z.enum(['origin', 'main', 'destination', 'customs', 'warehouse', 'other']).default('main'),
  quantity: MoneyString, unit: z.string().default('shipment'), unitPrice: MoneyString, expectedUnitCost: MoneyString.default('0'),
  taxCode: TaxCode.default('SR5'), taxRationale: z.string().optional(), supplierPartyId: Uuid.optional(),
});
export const CreateQuoteBody = z.object({
  legalEntityId: Uuid, enquiryId: Uuid.optional(), customerPartyId: Uuid, currency: CurrencyCode, validUntil: IsoDate,
  mode: Mode, origin: z.string(), destination: z.string(), incoterm: z.string().optional(), lines: z.array(QuoteLineIn).min(1),
});
export const AcceptQuoteBody = z.object({
  acceptedByName: z.string().min(1), evidence: z.object({ channel: z.enum(['portal', 'email', 'whatsapp', 'signed_pdf']), reference: z.string() }),
});

// ---- Logistics
export const CreateShipmentBody = z.object({
  jobId: Uuid, mode: Mode, origin: z.string(), destination: z.string(), incoterm: z.string().optional(),
  cargo: z.array(z.object({ description: z.string(), quantity: MoneyString, kind: z.string().default('pallet'), grossWeightKg: MoneyString.optional(), ownerPartyId: Uuid, hsCode: z.string().optional() })).min(1),
  legs: z.array(z.object({ mode: Mode, origin: z.string(), destination: z.string(), operatorPartyId: Uuid.optional() })).default([]),
});
export const RequestBookingBody = z.object({ shipmentId: Uuid, carrierPartyId: Uuid, requestKey: z.string().min(8) });
export const ConfirmBookingBody = z.object({ externalRef: z.string().min(1) });
export const TrackingEventBody = z.object({
  code: z.string().min(2), eventTime: IsoDateTime, source: z.enum(['carrier', 'supplier', 'manual', 'device', 'inferred']),
  isActual: z.boolean(), externalEventId: z.string().optional(), detail: z.record(z.unknown()).default({}),
});
export const CompleteDeliveryBody = z.object({ deliveredAt: IsoDateTime, podDocumentId: Uuid });
export const CloseJobBody = z.object({ acknowledgedExceptions: z.array(z.string()).default([]) });

// ---- Documents
export const UploadIntentBody = z.object({ contentType: z.string(), sizeBytes: z.number().int().positive().max(50_000_000) });
export const RegisterDocumentBody = z.object({
  intentId: Uuid, docType: z.string(), issuerKind: z.enum(['carrier', 'authority', 'customer', 'supplier', 'internal']), issuerName: z.string().optional(),
  externalReference: z.string().optional(), relatedType: z.string(), relatedId: Uuid, sha256: z.string().length(64),
});

// ---- Finance
export const CreateChargeBody = z.object({
  jobId: Uuid, shipmentId: Uuid.optional(), kind: z.enum(['revenue', 'cost']), sourceEventKey: z.string().min(3), description: z.string(),
  quantity: MoneyString, unitAmount: MoneyString, currency: CurrencyCode, taxCode: TaxCode.default('SR5'), taxRationale: z.string().optional(), partyId: Uuid.optional(),
});
export const CreateInvoiceBody = z.object({ jobId: Uuid, chargeIds: z.array(Uuid).optional(), dueDate: IsoDate.optional() });
export const PostInvoiceBody = z.object({ postingDate: IsoDate });
export const SupplierBillBody = z.object({ legalEntityId: Uuid, supplierPartyId: Uuid, jobId: Uuid, supplierInvoiceNo: z.string(), currency: CurrencyCode, amount: MoneyString });
export const PaymentBody = z.object({ legalEntityId: Uuid, partyId: Uuid, currency: CurrencyCode, amount: MoneyString, receivedOn: IsoDate, bankReference: z.string().optional() });
export const AllocatePaymentBody = z.object({ invoiceId: Uuid, amount: MoneyString, allocationKey: z.string().min(8) });

// ---- Warehouse & trade
export const ReceiptBody = z.object({
  facilityId: Uuid, locationId: Uuid.optional(), ownerPartyId: Uuid, cargoUnitId: Uuid.optional(), description: z.string(), batch: z.string().optional(),
  quantity: MoneyString, customsStatus: z.enum(['bonded', 'duty_paid', 'free_circulation']).default('bonded'), commandKey: z.string().min(8),
});
export const ReleaseOrderBody = z.object({ lotId: Uuid, qty: MoneyString, consignee: z.string().optional(), customsCaseId: Uuid.optional() });
export const HoldBody = z.object({ reason: z.string().min(3), kind: z.enum(['quarantine', 'customs', 'quality', 'legal']).default('quarantine') });
export const CustomsCaseBody = z.object({ jobId: Uuid, shipmentId: Uuid.optional(), importerPartyId: Uuid, procedure: z.enum(['import', 'export', 'transit', 're_export', 'warehouse_entry']) });
export const RecordCustomsReleaseBody = z.object({ documentId: Uuid, authorityReference: z.string().min(3) });

// ---- Collaboration, devices, integrations, AI
export const ApprovalRequestBody = z.object({ kind: z.string(), subjectType: z.string(), subjectId: Uuid, summary: z.string() });
export const DecideBody = z.object({ note: z.string().optional() });
export const DeviceCommandBatchBody = z.object({
  deviceId: z.string(),
  commands: z.array(z.object({
    commandId: Uuid, type: z.enum(['capture_pod', 'scan_count', 'attach_photo']), observedVersion: z.number().int().optional(), deviceTime: IsoDateTime,
    payload: z.record(z.unknown()),
  })).min(1).max(100),
});
export const AiToolInvokeBody = z.object({ args: z.record(z.unknown()).default({}) });
export const WorkflowRunQuery = z.object({ status: z.enum(['running', 'waiting', 'completed', 'failed', 'cancelled', 'skipped']).optional(), definitionId: Uuid.optional() });
export const CreateFacilityBody = z.object({ legalEntityId: Uuid, name: z.string().min(2).max(120), kind: z.enum(['warehouse', 'yard', 'office', 'cfs']) });
export const CreateLocationBody = z.object({ code: z.string().min(1).max(40), zone: z.string().max(40).optional() });

// ---- Transport
export const CreateTripBody = z.object({
  transporterPartyId: Uuid, driverEmployeeId: Uuid.optional(), vehicleRef: z.string().optional(),
  stops: z.array(z.object({ kind: z.enum(['pickup', 'delivery', 'return_empty']), address: z.string().min(3), shipmentId: Uuid.optional() })).min(1),
});
// ---- Collaboration
export const CreateTaskBody = z.object({ title: z.string().min(3), relatedType: z.string().optional(), relatedId: Uuid.optional(), assigneeUserId: Uuid.optional(), dueAt: IsoDateTime.optional() });
export const PostMessageBody = z.object({ relatedType: z.string(), relatedId: Uuid, channel: z.enum(['internal', 'email', 'whatsapp', 'call']).default('internal'), direction: z.enum(['inbound', 'outbound', 'internal']).default('internal'), body: z.string().min(1).max(4000) });
// ---- People & assets
export const CreateEmployeeBody = z.object({ legalEntityId: Uuid, fullName: z.string().min(2), jobTitle: z.string().optional(), department: z.string().optional(), hiredOn: IsoDate.optional() });
export const AddQualificationBody = z.object({ kind: z.enum(['forklift', 'dg_handling', 'driving', 'customs_broker', 'first_aid', 'reefer_handling']), reference: z.string().optional(), issuedOn: IsoDate, validTo: IsoDate });
export const CreateAssetBody = z.object({ facilityId: Uuid.optional(), kind: z.enum(['forklift', 'scanner', 'reefer_unit', 'vehicle', 'temperature_logger']), code: z.string().min(2), nextServiceDue: IsoDate.optional(), calibrationDue: IsoDate.optional() });
// ---- Quality
export const CreateIncidentBody = z.object({
  kind: z.enum(['damage', 'shortage', 'temperature_excursion', 'delay', 'document_error', 'other']), severity: z.enum(['low', 'medium', 'high']).default('medium'),
  description: z.string().min(5), jobId: Uuid.optional(), shipmentId: Uuid.optional(), lotId: Uuid.optional(), placeHold: z.boolean().default(false),
});
export const ResolveIncidentBody = z.object({ resolutionNote: z.string().min(5) });
export const CreateClaimBody = z.object({ incidentId: Uuid, claimantPartyId: Uuid.optional(), insurerPartyId: Uuid.optional(), amount: MoneyString, currency: CurrencyCode });
export const ReleaseHoldBody = z.object({ note: z.string().min(5) });
// ---- Admin
export const AddMemberBody = z.object({ subject: z.string().min(3), email: z.string().email().optional(), role: z.string(), workspace: z.enum(['staff', 'customer', 'agent', 'transporter', 'driver', 'warehouse']).default('staff'), partyId: Uuid.optional(), legalEntityId: Uuid.optional() });

// ---- Query strings
export const JobQuery = z.object({ jobId: Uuid.optional() });
export const RelatedQuery = z.object({ relatedType: z.string().optional(), relatedId: Uuid.optional(), jobId: Uuid.optional(), status: z.string().optional() });
export const DocumentQuery = z.object({ relatedType: z.string().optional(), relatedId: Uuid.optional(), docType: z.string().optional() });
export const ExpiringQuery = z.object({ withinDays: z.coerce.number().int().min(0).max(3650).optional() });
export const AuditQuery = z.object({ entityType: z.string().optional(), entityId: Uuid.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
