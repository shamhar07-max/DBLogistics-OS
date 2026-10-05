/** Event catalog — topics published through the transactional outbox. */
export const EVENT_TOPICS = [
  'EnquiryQualified', 'QuoteApproved', 'QuoteAccepted', 'JobOpened', 'BookingRequested', 'BookingConfirmed',
  'ShipmentEventRecorded', 'CargoReceived', 'ReleaseAuthorized', 'CargoReleased', 'CustomsReleaseRecorded',
  'DeliveryCompleted', 'ChargeCreated', 'InvoiceApproved', 'InvoicePosted', 'SupplierBillPosted', 'PaymentAllocated', 'JobClosed',
  'DocumentApproved', 'ApprovalDecided', 'IntegrationEventReceived',
] as const;
export type EventTopic = (typeof EVENT_TOPICS)[number];
