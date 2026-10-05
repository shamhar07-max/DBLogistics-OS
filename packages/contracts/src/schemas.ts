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
  legalEntityId: Uuid, customerPartyId: Uuid, mode: Mode, origin: z.string().min(2), destination: z.string().min(2),
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
export const WorkflowBody = z.object({ key: z.string(), triggerTopic: z.string(), definition: z.record(z.unknown()) });
