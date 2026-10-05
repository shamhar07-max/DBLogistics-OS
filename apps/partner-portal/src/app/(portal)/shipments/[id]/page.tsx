'use client';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { Button, Card, Chip, QueryBoundary, RouteLane } from '@dbl/ui';
import { useCmd, useOp, errView, money } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, RefLink, fmtDate } from '@/components/DataTable';
import { FormGrid, SelectField, TextField } from '@/components/fields';
import { SectionTabs } from '@/components/SectionTabs';
import { DocumentsTable, Only, TrackingCard } from '@/components/Common';
import { useWho } from '@/components/Me';
import { UploadDocument } from '@/components/UploadDocument';

const MILESTONES = ['PICKED_UP', 'LOADED', 'DEPARTED', 'ARRIVED', 'CUSTOMS_CLEARED', 'OUT_FOR_DELIVERY', 'DELIVERED_AT_DESTINATION'];
function ReportMilestone({ id }: { id: string }) {
  const rec = useCmd('recordTrackingEvent', { invalidate: ['getShipmentTimeline', 'getShipment'] }); const now = () => new Date().toISOString().slice(0, 16);
  const f = useForm<any>({ defaultValues: { code: 'DEPARTED', isActual: 'true', eventTime: now() } });
  return (<Card title="Report a milestone"><form className="grid gap-3" onSubmit={f.handleSubmit((v) => rec.mutate({ params: { id }, body: { code: v.code, eventTime: new Date(v.eventTime).toISOString(), source: 'supplier', isActual: v.isActual === 'true', detail: v.note ? { note: v.note } : {} } as any }, { onSuccess: () => f.reset({ code: 'DEPARTED', isActual: 'true', eventTime: now() }) } as any))}>
    <FormGrid><SelectField label="Milestone" {...f.register('code')}>{MILESTONES.map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}</SelectField><TextField label="When" type="datetime-local" {...f.register('eventTime', { required: true })} /></FormGrid>
    <FormGrid><SelectField label="This is" {...f.register('isActual')}><option value="true">Actual — it has happened</option><option value="false">Estimate — expected</option></SelectField><TextField label="Note (optional)" {...f.register('note')} /></FormGrid>
    <div><Button type="submit" disabled={rec.isPending}>Report</Button></div><ErrorNote e={rec.error} /><p className="text-xs text-steel">Your report is recorded under your company’s name; the forwarder confirms delivery.</p></form></Card>);
}
const lc = createColumnHelper<any>(), cc = createColumnHelper<any>(), ic = createColumnHelper<any>();
function Details({ s }: { s: any }) {
  const legs = useMemo(() => [lc.accessor('seq', { header: '#' }), lc.accessor('mode', { header: 'Mode', cell: (c) => c.getValue().replace('_', ' ') }), lc.accessor((r: any) => `${r.origin} → ${r.destination}`, { id: 'r', header: 'Route' }), lc.accessor('operator', { header: 'Operator', cell: (c) => c.getValue() ?? '—' }),
    lc.accessor('planned_arrival', { header: 'Planned', cell: (c) => fmtDate(c.getValue()) }), lc.accessor('estimated_arrival', { header: 'Estimated', cell: (c) => fmtDate(c.getValue()) }), lc.accessor('actual_arrival', { header: 'Arrived', cell: (c) => fmtDate(c.getValue()) })], []);
  const cargo = useMemo(() => [cc.accessor('description', { header: 'Cargo', cell: (c) => <b className="font-display">{c.getValue()}</b> }), cc.accessor('quantity', { header: 'Qty', cell: (c) => `${Number(c.getValue())} ${c.row.original.kind}` }), cc.accessor('gross_weight_kg', { header: 'Weight', cell: (c) => (c.getValue() ? `${Number(c.getValue())} kg` : '—') }), cc.accessor('hs_code', { header: 'HS code', cell: (c) => <Mono>{c.getValue() ?? '—'}</Mono> })], []);
  return (<div className="grid gap-5"><Card title="Route legs"><DataTable q={{ status: 'success', error: null, data: s.legs }} columns={legs as any} empty="Direct movement — no separate legs." filterable={false} /></Card><Card title="Cargo"><DataTable q={{ status: 'success', error: null, data: s.cargo }} columns={cargo as any} empty="No cargo lines." filterable={false} /></Card></div>);
}
function JobInvoices({ jobId }: { jobId: string }) {
  const q = useOp('listInvoices'); const rows = ((q.data as any[]) ?? []).filter((i) => i.job_id === jobId);
  const columns = useMemo(() => [ic.accessor('ref', { header: 'Invoice', cell: (c) => <RefLink href={`/invoices/${c.row.original.id}`}>{c.getValue()}</RefLink> }), ic.accessor('total', { header: 'Total', cell: (c) => money(c.getValue(), c.row.original.currency) }), ic.accessor((r: any) => Number(r.total) - Number(r.amount_allocated), { id: 'open', header: 'Open', cell: (c) => money(c.getValue(), c.row.original.currency) }), ic.accessor('due_date', { header: 'Due', cell: (c) => fmtDate(c.getValue()) })], []);
  return <Card title="Invoices for this job"><DataTable q={{ status: q.status, error: q.error, data: rows }} columns={columns as any} empty="No invoices issued yet." filterable={false} /></Card>;
}
export default function ShipmentPage() {
  const { id } = useParams<{ id: string }>(); const q = useOp('getShipment', { params: { id } }); const s = q.data as any; const { me } = useWho(); const docs = useOp('listDocuments', { query: { relatedId: id } }); void docs;
  const stepState = (k: 'p' | 't' | 'd') => (k === 'p' ? 'done' : k === 't' ? (s?.status === 'executing' ? 'now' : s?.status === 'planned' ? 'todo' : 'done') : s?.status === 'delivered' ? 'done' : 'todo') as 'done' | 'now' | 'todo';
  return (<Only workspaces={['customer', 'agent', 'transporter', 'driver']}>
    <PageTitle title={s?.ref ?? 'Shipment'} sub="Shipment">{s && <div className="flex flex-wrap gap-2"><StatusChip s={s.status} /><Chip tone="info">{s.mode.replace('_', ' ')}</Chip></div>}</PageTitle>
    <QueryBoundary status={q.status} error={errView(q.error)}>{s && <>
      <Card><div className="mb-3 text-sm"><b>{s.origin}</b> → <b>{s.destination}</b>{s.incoterm && <span className="ml-2 text-steel">{s.incoterm}</span>}{s.delivered_at && <span className="ml-3 text-steel">delivered {fmtDate(s.delivered_at)}</span>}</div>
        <RouteLane stops={[{ label: 'Planned', state: stepState('p') }, { label: 'In transit', state: stepState('t') }, { label: 'Delivered', sub: s.delivered_at ? fmtDate(s.delivered_at) : undefined, state: stepState('d') }]} /></Card>
      <SectionTabs sections={[{ id: 'tracking', label: 'Tracking', content: <div className="grid gap-5"><TrackingCard shipmentId={id} />{me?.workspace === 'agent' && <ReportMilestone id={id} />}</div> },
        { id: 'details', label: 'Route & cargo', content: <Details s={s} /> },
        { id: 'documents', label: 'Documents', content: <div className="grid gap-5"><Card title="Documents for this shipment"><DocumentsTable relatedId={id} /></Card><Card title="Upload a document"><UploadDocument relatedType="shipment" relatedId={id} defaultType={me?.workspace === 'customer' ? 'Commercial invoice' : 'Proof of delivery'} /></Card></div> },
        ...(me?.workspace === 'customer' ? [{ id: 'invoices', label: 'Invoices', content: <JobInvoices jobId={s.job_id} /> }] : [])]} /></>}</QueryBoundary></Only>);
}
