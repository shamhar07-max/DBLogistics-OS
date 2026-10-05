'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { Button, Card, Chip, ConversationView, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, StatusChip } from '@/components/bits';
import { DataTable, Mono, fmtDate, fmtDateTime } from '@/components/DataTable';
import { FormGrid, SelectField, TextField } from '@/components/fields';

/** Conversation on a record. Staff decide per message whether the customer sees it; shared messages notify the customer (consent permitting). */
export function RecordConversation({ relatedType, relatedId }: { relatedType: 'job' | 'shipment' | 'quote'; relatedId: string }) {
  const q = useOp('listMessages', { query: { relatedType, relatedId } }); const post = useCmd('postMessage', { invalidate: ['listMessages'] });
  return (<Card title="Conversation · append-only"><QueryBoundary status={q.status} error={errView(q.error)}>
    <ConversationView items={(q.data as any[]) ?? []} fmt={fmtDateTime} shareToggle mine={(m) => m.direction !== 'inbound'} pending={post.isPending} error={<ErrorNote e={post.error} />}
      onSend={(body, shared) => post.mutate({ body: { relatedType, relatedId, channel: shared ? 'portal' : 'internal', direction: shared ? 'outbound' : 'internal', body, shared } as any })} /></QueryBoundary>
    <p className="mt-3 text-xs text-steel">Messages cannot be edited or deleted. Internal notes are never visible to customers.</p></Card>);
}

/** Contacts with explicit consent flags: WhatsApp needs an opt-in; email can be switched off. */
export function ContactsCard({ partyId, contacts }: { partyId: string; contacts: any[] }) {
  const add = useCmd('addContact', { invalidate: ['getParty'] }); const upd = useCmd('updateContact', { invalidate: ['getParty'] });
  const f = useForm<any>({ defaultValues: { whatsappOptIn: false, emailOptOut: false } });
  return (<Card title="Contacts & consent">
    {contacts.length ? <ul className="mb-4 grid gap-2">{contacts.map((c) => <li key={c.id} data-testid="contact" className="rounded-sm border border-line p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><b className="font-display">{c.name}</b><span className="text-steel">{[c.email, c.phone].filter(Boolean).join(' · ') || 'no address'}</span></div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs"><label className="flex items-center gap-1.5"><input type="checkbox" aria-label={`${c.name} WhatsApp opt-in`} checked={!!c.whatsapp_opt_in} disabled={!c.phone || upd.isPending} onChange={(e) => upd.mutate({ params: { id: c.id }, body: { whatsappOptIn: e.target.checked } as any })} /> WhatsApp opt-in{!c.phone && <i className="text-steel"> (needs a phone)</i>}</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" aria-label={`${c.name} email opt-out`} checked={!!c.email_opt_out} disabled={!c.email || upd.isPending} onChange={(e) => upd.mutate({ params: { id: c.id }, body: { emailOptOut: e.target.checked } as any })} /> Do not email</label></div></li>)}</ul> : <p className="mb-4 text-sm text-steel">No contacts recorded.</p>}
    <form className="grid gap-3 border-t border-line pt-4" onSubmit={f.handleSubmit((v) => add.mutate({ params: { id: partyId }, body: { name: v.name, ...(v.email ? { email: v.email } : {}), ...(v.phone ? { phone: v.phone } : {}), whatsappOptIn: !!v.whatsappOptIn && !!v.phone, emailOptOut: false } as any }, { onSuccess: () => f.reset({ whatsappOptIn: false }) } as any))}>
      <FormGrid><TextField label="Name" {...f.register('name', { required: true, minLength: 2 })} /><TextField label="Email" type="email" {...f.register('email')} /></FormGrid>
      <FormGrid><TextField label="Mobile (international)" placeholder="+971501234567" {...f.register('phone', { pattern: { value: /^\+[1-9]\d{6,14}$/, message: 'Use +971…' } })} /><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" {...f.register('whatsappOptIn')} /> Customer agreed to WhatsApp</label></FormGrid>
      <div><Button type="submit" variant="ghost" disabled={add.isPending}>Add contact</Button></div><ErrorNote e={add.error ?? upd.error} /><p className="text-xs text-steel">We only message people on WhatsApp after they agree; the opt-in is recorded here.</p></form></Card>);
}

/** Registered profile of the party: address and tax registration number (printed on invoices). */
export function PartyProfileForm({ party }: { party: any }) {
  const upd = useCmd('updateParty', { invalidate: ['getParty'] });
  const f = useForm<any>({ defaultValues: { tradingName: party.trading_name ?? '', taxRegistrationNumber: party.tax_registration_number ?? '', country: party.country ?? '', address: party.address ?? '' } });
  return (<form className="grid gap-3" onSubmit={f.handleSubmit((v) => upd.mutate({ params: { id: party.id }, body: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) as any }))}>
    <FormGrid><TextField label="Trading name" {...f.register('tradingName')} /><TextField label="Tax reg. no. (TRN)" {...f.register('taxRegistrationNumber')} /></FormGrid>
    <FormGrid><TextField label="Country (ISO-2)" maxLength={2} {...f.register('country')} /><TextField label="Address" {...f.register('address')} /></FormGrid>
    <div className="flex items-center gap-3"><Button type="submit" variant="ghost" disabled={upd.isPending}>Save profile</Button>{upd.isSuccess && <span className="text-xs text-status-ok" role="status">Saved</span>}</div><ErrorNote e={upd.error} /></form>);
}

/** Issuer profile printed in the header/footer of every generated document. */
export function CompanyProfile() {
  const q = useOp('listLegalEntities'); const rows = (q.data as any[]) ?? [];
  return (<QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!rows.length} empty="No legal entities."><div className="grid gap-5 lg:grid-cols-2">{rows.map((le) => <EntityProfile key={le.id} le={le} />)}</div></QueryBoundary>);
}
function EntityProfile({ le }: { le: any }) {
  const upd = useCmd('updateLegalEntity', { invalidate: ['listLegalEntities'] });
  const f = useForm<any>({ defaultValues: { name: le.name, tradeLicense: le.trade_license ?? '', taxRegistrationNumber: le.tax_registration_number ?? '', address: le.address ?? '', email: le.email ?? '', phone: le.phone ?? '', website: le.website ?? '', bankName: le.bank_name ?? '', bankAccountName: le.bank_account_name ?? '', bankIban: le.bank_iban ?? '', bankSwift: le.bank_swift ?? '' } });
  return (<Card title={`${le.name} · ${le.base_currency}`}><form className="grid gap-3" onSubmit={f.handleSubmit((v) => upd.mutate({ params: { id: le.id }, body: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== '')) as any }))}>
    <TextField label="Legal name" {...f.register('name', { required: true, minLength: 2 })} /><FormGrid><TextField label="Trade licence no." {...f.register('tradeLicense')} /><TextField label="Tax reg. no. (TRN)" {...f.register('taxRegistrationNumber')} /></FormGrid>
    <TextField label="Registered address" {...f.register('address')} /><FormGrid><TextField label="Email" type="email" {...f.register('email')} /><TextField label="Phone" {...f.register('phone')} /></FormGrid><TextField label="Website" {...f.register('website')} />
    <h4 className="font-display text-sm font-semibold">Bank details printed on invoices</h4><FormGrid><TextField label="Bank" {...f.register('bankName')} /><TextField label="Account name" {...f.register('bankAccountName')} /></FormGrid><FormGrid><TextField label="IBAN" {...f.register('bankIban')} /><TextField label="SWIFT" {...f.register('bankSwift')} /></FormGrid>
    <div className="flex items-center gap-3"><Button type="submit" disabled={upd.isPending}>Save company profile</Button>{upd.isSuccess && <span className="text-xs text-status-ok" role="status">Saved</span>}</div><ErrorNote e={upd.error} />
    <p className="text-xs text-steel">These details appear in the header and footer of invoices, quotations and reports.</p></form></Card>);
}

const oc = createColumnHelper<any>();
const msgTone = (s: string) => (['sent', 'delivered', 'read'].includes(s) ? 'ok' : s === 'failed' ? 'stop' : s === 'cancelled' ? 'idle' : 'hold') as any;
/** Email / WhatsApp delivery log with retry and cancel. */
export function DeliveryLog() {
  const [channel, setChannel] = useState(''); const q = useOp('listOutboundMessages', { query: channel ? { channel } : undefined });
  const retry = useCmd('retryOutboundMessage', { invalidate: ['listOutboundMessages'] }); const cancel = useCmd('cancelOutboundMessage', { invalidate: ['listOutboundMessages'] });
  const columns = useMemo(() => [oc.accessor('created_at', { header: 'Queued', cell: (c) => fmtDateTime(c.getValue()) }), oc.accessor('channel', { header: 'Channel', cell: (c) => <Chip tone="info">{c.getValue()}</Chip> }),
    oc.accessor('to_name', { header: 'To', cell: (c) => <span>{c.getValue() ?? '—'}<br /><span className="text-xs text-steel">{c.row.original.to_address}</span></span> }), oc.accessor('template', { header: 'Template', cell: (c) => <Mono>{c.getValue()}</Mono> }),
    oc.accessor('status', { header: 'Status', cell: (c) => <Chip tone={msgTone(c.getValue())}>{c.getValue()}</Chip> }), oc.accessor('attempts', { header: 'Tries' }), oc.accessor('last_error', { header: 'Detail', cell: (c) => <span className="text-xs text-steel">{c.getValue() ?? (c.row.original.delivered_at ? `delivered ${fmtDate(c.row.original.delivered_at)}` : '')}</span> }),
    oc.display({ id: 'a', header: '', cell: (c) => { const m = c.row.original; return <span className="flex gap-1.5">{m.status === 'failed' && <Button size="sm" variant="ghost" onClick={() => retry.mutate({ params: { id: m.id } })}>Retry</Button>}{m.status === 'queued' && <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ params: { id: m.id } })}>Cancel</Button>}</span>; } })], [retry, cancel]);
  return (<Card title="Delivery log · email & WhatsApp" actions={<SelectField label="" aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)}><option value="">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option></SelectField>}>
    <DataTable q={q} columns={columns as any} empty="Nothing has been sent yet." label="Filter messages" /><ErrorNote e={retry.error ?? cancel.error} /><StatusNote /></Card>);
}
const StatusNote = () => <p className="mt-3 text-xs text-steel">Customers are only messaged with consent. WhatsApp business-initiated messages use pre-approved templates (named <Mono>dbl_&lt;template&gt;</Mono>); email goes through the configured SMTP / Microsoft 365 account.</p>;
void StatusChip;

/** OCR / text-layer output for the latest version of a document: suggestions for a person to verify, never authoritative. */
export function ExtractionPanel({ documentId }: { documentId: string }) {
  const q = useOp('getDocumentExtraction', { params: { id: documentId } }); const d = q.data as any; const f = d?.fields ?? {};
  const rows: Array<[string, React.ReactNode]> = [
    ['Container numbers', f.containerNumbers?.length ? f.containerNumbers.map((c: any) => <span key={c.value} className="mr-2 inline-flex items-center gap-1"><Mono>{c.value}</Mono>{c.checkDigitValid ? <Chip tone="ok">valid</Chip> : <Chip tone="hold">check digit?</Chip>}</span>) : null],
    ['Bill of lading', f.billOfLading?.map((x: string) => <Mono key={x}>{x} </Mono>)], ['Air waybill', f.airWaybill?.map((x: string) => <Mono key={x}>{x} </Mono>)], ['HS codes', f.hsCodes?.map((x: string) => <Mono key={x}>{x} </Mono>)], ['Incoterm', f.incoterm],
    ['Amounts', f.amounts?.map((a: any) => `${a.currency} ${a.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`).join(' · ')], ['Weights (kg)', f.weightsKg?.join(' · ')], ['Dates', f.dates?.join(' · ')], ['Tax reg. no.', f.trn?.join(' · ')],
  ];
  return (<QueryBoundary status={q.status} error={errView(q.error)}>{d && <div className="grid gap-4" data-testid="extraction">
    <div className="flex flex-wrap items-center gap-2 text-sm"><StatusChip s={d.status === 'done' ? 'completed' : d.status === 'pending' || d.status === 'waiting_for_scan' ? 'pending' : 'failed'} /> {d.engine && <Chip tone="idle">{d.engine}</Chip>}{d.confidence != null && <Chip tone={d.confidence >= 80 ? 'ok' : 'hold'}>{d.confidence}% confidence</Chip>}{d.pageCount && <span className="text-xs text-steel">{d.pageCount} page(s)</span>}</div>
    {d.status === 'done' ? <><dl className="grid grid-cols-[150px_1fr] gap-y-2 text-sm">{rows.filter(([, v]) => v && (!Array.isArray(v) || v.length)).map(([k, v]) => <><dt key={k} className="text-steel">{k}</dt><dd key={k + 'v'}>{v}</dd></>)}</dl>
      <details><summary className="cursor-pointer text-sm font-semibold">Extracted text</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-paper p-3 font-mono text-xs">{d.text}</pre></details>
      <p className="text-xs text-steel">Read automatically (text layer or OCR). Always check against the document before relying on a value.</p></>
      : <p className="text-sm text-steel">{d.status === 'pending' ? 'Extraction is queued.' : d.status === 'waiting_for_scan' ? 'Waiting for the malware scan to finish.' : d.status === 'unsupported' ? 'This file type cannot be read automatically.' : d.error ?? 'Nothing could be extracted.'}</p>}</div>}</QueryBoundary>);
}
