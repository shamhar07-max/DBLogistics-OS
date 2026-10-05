'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useFieldArray, useForm } from 'react-hook-form';
import { Button, Card, Chip, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, StatusChip } from '@/components/bits';
import { DataTable, Mono, fmtDate, fmtDateTime } from '@/components/DataTable';
import { AreaField, FormGrid, PartyPicker, SelectField, TextField } from '@/components/fields';

const MODES = ['ocean_fcl', 'ocean_lcl', 'air', 'road', 'multimodal'] as const;
const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));

/** Plan: shipments for this job, each with legs; create-shipment form. */
export function PlanTab({ jobId, onCreated }: { jobId: string; onCreated?: () => void }) {
  const q = useOp('listShipments', { query: { jobId } }); const create = useCmd('createShipment', { invalidate: ['listShipments', 'getJob'], onSuccess: onCreated });
  const { register, control, handleSubmit, reset } = useForm<any>({ defaultValues: { mode: 'ocean_fcl', cargo: [{ description: '', quantity: '1', kind: 'pallet' }], legs: [] } });
  const cargo = useFieldArray({ control, name: 'cargo' }); const legs = useFieldArray({ control, name: 'legs' });
  const shipments = (q.data as any[]) ?? [];
  return (<div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] items-start gap-5">
    <Card title="Shipments & routing"><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!shipments.length} empty="No shipment planned yet.">{shipments.map((s) => <ShipmentPlan key={s.id} id={s.id} />)}</QueryBoundary></Card>
    <Card title="Plan a shipment"><form className="grid gap-3" onSubmit={handleSubmit((v) => create.mutate({ body: { jobId, mode: v.mode, origin: v.origin, destination: v.destination, incoterm: v.incoterm || undefined,
      cargo: v.cargo.map((c: any) => clean({ ...c, ownerPartyId: v.ownerPartyId })), legs: v.legs.map((l: any) => clean(l)) } as any }, { onSuccess: () => reset() } as any))}>
      <FormGrid><SelectField label="Mode" {...register('mode')}>{MODES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</SelectField><TextField label="Incoterm" maxLength={3} {...register('incoterm')} /></FormGrid>
      <FormGrid><TextField label="Origin" {...register('origin', { required: true })} /><TextField label="Destination" {...register('destination', { required: true })} /></FormGrid>
      <PartyPicker label="Cargo owner" {...register('ownerPartyId', { required: true })} />
      {cargo.fields.map((f, i) => <div key={f.id} className="grid gap-2 rounded-sm bg-paper p-3"><FormGrid><TextField label={`Cargo ${i + 1}`} {...register(`cargo.${i}.description`, { required: true })} /><TextField label="Quantity" inputMode="decimal" {...register(`cargo.${i}.quantity`)} /></FormGrid>
        <FormGrid><TextField label="Gross kg" inputMode="decimal" {...register(`cargo.${i}.grossWeightKg`)} /><TextField label="HS code" {...register(`cargo.${i}.hsCode`)} /></FormGrid>{cargo.fields.length > 1 && <button type="button" className="text-left text-xs text-steel underline" onClick={() => cargo.remove(i)}>Remove cargo line</button>}</div>)}
      <Button type="button" size="sm" variant="ghost" onClick={() => cargo.append({ description: '', quantity: '1', kind: 'pallet' })}>+ Cargo line</Button>
      {legs.fields.map((f, i) => <div key={f.id} className="grid gap-2 rounded-sm bg-paper p-3"><FormGrid cols={3}><SelectField label={`Leg ${i + 1}`} {...register(`legs.${i}.mode`)}>{MODES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}</SelectField><TextField label="From" {...register(`legs.${i}.origin`, { required: true })} /><TextField label="To" {...register(`legs.${i}.destination`, { required: true })} /></FormGrid><PartyPicker label="Operator" {...register(`legs.${i}.operatorPartyId`)} /><button type="button" className="text-left text-xs text-steel underline" onClick={() => legs.remove(i)}>Remove leg</button></div>)}
      <Button type="button" size="sm" variant="ghost" onClick={() => legs.append({ mode: 'road', origin: '', destination: '' })}>+ Leg</Button><Button type="submit" disabled={create.isPending}>Create shipment</Button><ErrorNote e={create.error} /></form></Card></div>);
}
function ShipmentPlan({ id }: { id: string }) {
  const q = useOp('getShipment', { params: { id } }); const s = q.data as any; if (!s) return null;
  return (<div className="mb-5 last:mb-0"><div className="mb-2 flex items-center gap-3 text-sm"><Mono>{s.ref}</Mono><b>{s.origin} → {s.destination}</b><Chip tone="info">{s.mode.replace('_', ' ')}</Chip><StatusChip s={s.status} />{s.incoterm && <span className="text-steel">{s.incoterm}</span>}</div>
    {s.legs.length ? <table className="w-full text-sm"><thead><tr className="text-left font-label text-[11px] uppercase tracking-wider text-steel"><th>#</th><th>Mode</th><th>Route</th><th>Operator</th><th>Planned</th><th>ETA (estimate)</th><th>Arrived (actual)</th></tr></thead><tbody>{s.legs.map((l: any) => <tr key={l.id} className="border-t border-line"><td className="py-1.5 font-mono">{l.seq}</td><td>{l.mode.replace('_', ' ')}</td><td>{l.origin} → {l.destination}</td><td>{l.operator ?? '—'}</td><td>{fmtDate(l.planned_arrival)}</td><td>{fmtDate(l.estimated_arrival)}</td><td>{l.actual_arrival ? fmtDate(l.actual_arrival) : '—'}</td></tr>)}</tbody></table> : <p className="text-sm text-steel">Direct movement — no separate legs.</p>}</div>);
}

/** Bookings: request / confirm / mark outcome unknown, per shipment. */
export function BookingsTab({ jobId }: { jobId: string }) {
  const sh = useOp('listShipments', { query: { jobId } }); const request = useCmd('requestBooking', { invalidate: ['getShipment'] }); const confirm = useCmd('confirmBooking', { invalidate: ['getShipment'] }); const unknown = useCmd('markBookingOutcomeUnknown', { invalidate: ['getShipment'] });
  const { register, handleSubmit, reset } = useForm<any>(); const [refs, setRefs] = useState<Record<string, string>>({}); const shipments = (sh.data as any[]) ?? [];
  return (<div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] items-start gap-5"><Card title="Bookings"><QueryBoundary status={sh.status} error={errView(sh.error)} isEmpty={!shipments.length} empty="Plan a shipment before booking carriers.">{shipments.map((s) => <Bookings key={s.id} id={s.id} refs={refs} setRefs={setRefs} confirm={confirm} unknown={unknown} />)}</QueryBoundary><ErrorNote e={confirm.error ?? unknown.error} /></Card>
    <Card title="Request booking"><form className="grid gap-3" onSubmit={handleSubmit((v) => request.mutate({ body: { shipmentId: v.shipmentId, carrierPartyId: v.carrierPartyId, requestKey: crypto.randomUUID() } }, { onSuccess: () => reset() } as any))}>
      <SelectField label="Shipment" {...register('shipmentId', { required: true })}><option value="">Select…</option>{shipments.map((s) => <option key={s.id} value={s.id}>{s.ref} · {s.origin} → {s.destination}</option>)}</SelectField>
      <PartyPicker role="carrier" label="Carrier" {...register('carrierPartyId', { required: true })} /><Button type="submit" disabled={request.isPending}>Request booking</Button><ErrorNote e={request.error} />
      <p className="text-xs text-steel">Safe to retry: requests are idempotent. If a carrier call times out, mark the outcome unknown so it cannot be re-submitted blindly.</p></form></Card></div>);
}
function Bookings({ id, refs, setRefs, confirm, unknown }: { id: string; refs: Record<string, string>; setRefs: (r: Record<string, string>) => void; confirm: any; unknown: any }) {
  const q = useOp('getShipment', { params: { id } }); const s = q.data as any; if (!s?.bookings.length) return null;
  return <div className="mb-4 last:mb-0"><div className="mb-1 font-mono text-xs text-steel">{s.ref}</div><ul className="grid gap-2">{s.bookings.map((b: any) => <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-sm border border-line p-3 text-sm"><b className="font-display">{b.carrier}</b><StatusChip s={b.status} />{b.outcome_unknown && <Chip tone="hold">outcome unknown — reconcile</Chip>}{b.external_ref && <Mono>{b.external_ref}</Mono>}<span className="text-xs text-steel">{fmtDateTime(b.created_at)}</span>
    {b.status !== 'confirmed' && <span className="ml-auto flex items-center gap-1.5"><input aria-label="Carrier reference" placeholder="Carrier reference" className="h-8 w-36 rounded-sm border border-line-strong px-2 text-xs" value={refs[b.id] ?? ''} onChange={(e) => setRefs({ ...refs, [b.id]: e.target.value })} /><Button size="sm" disabled={!refs[b.id]} onClick={() => confirm.mutate({ params: { id: b.id }, body: { externalRef: refs[b.id] }, ifMatch: b.version })}>Confirm</Button>{!b.outcome_unknown && <Button size="sm" variant="ghost" onClick={() => unknown.mutate({ params: { id: b.id } })}>Mark outcome unknown</Button>}</span>}</li>)}</ul></div>;
}

/** Cargo: read-only table of cargo units across the job's shipments. */
export function CargoTab({ jobId }: { jobId: string }) {
  const sh = useOp('listShipments', { query: { jobId } }); const shipments = (sh.data as any[]) ?? [];
  return <Card title="Cargo"><QueryBoundary status={sh.status} error={errView(sh.error)} isEmpty={!shipments.length} empty="No cargo recorded — plan a shipment first.">{shipments.map((s) => <CargoOf key={s.id} id={s.id} />)}</QueryBoundary></Card>;
}
function CargoOf({ id }: { id: string }) {
  const q = useOp('getShipment', { params: { id } }); const s = q.data as any; if (!s) return null;
  return <div className="mb-4 last:mb-0"><div className="mb-1 font-mono text-xs text-steel">{s.ref}</div><table className="w-full text-sm"><thead><tr className="text-left font-label text-[11px] uppercase tracking-wider text-steel"><th>Description</th><th>Qty</th><th>Weight</th><th>Volume</th><th>HS</th><th>Owner</th></tr></thead><tbody>{s.cargo.map((c: any) => <tr key={c.id} className="border-t border-line"><td className="py-1.5"><b>{c.description}</b></td><td className="font-mono">{Number(c.quantity)} {c.kind}</td><td className="font-mono">{c.gross_weight_kg ? `${Number(c.gross_weight_kg)} kg` : '—'}</td><td className="font-mono">{c.volume_cbm ? `${Number(c.volume_cbm)} cbm` : '—'}</td><td className="font-mono">{c.hs_code ?? '—'}</td><td>{c.owner}</td></tr>)}</tbody></table></div>;
}

/** Tracking forms: record an event, complete delivery with POD. */
export function TrackingForms({ shipmentId, jobId }: { shipmentId: string; jobId: string }) {
  const rec = useCmd('recordTrackingEvent', { invalidate: ['getShipmentTimeline', 'getJob'] }); const done = useCmd('completeDelivery', { invalidate: ['getShipmentTimeline', 'getJob', 'listDocuments'] }); const docs = useOp('listDocuments');
  const f = useForm<any>({ defaultValues: { source: 'manual', isActual: 'true', eventTime: new Date().toISOString().slice(0, 16) } }); const g = useForm<any>({ defaultValues: { deliveredAt: new Date().toISOString().slice(0, 16) } });
  const pods = ((docs.data as any[]) ?? []).filter((d) => d.related_id === jobId || d.related_id === shipmentId).filter((d) => /pod|proof/i.test(d.doc_type) && d.scan_status === 'clean');
  return (<div className="grid grid-cols-1 gap-5 lg:grid-cols-2"><Card title="Record tracking event"><form className="grid gap-3" onSubmit={f.handleSubmit((v) => rec.mutate({ params: { id: shipmentId }, body: { code: v.code, source: v.source, isActual: v.isActual === 'true', eventTime: new Date(v.eventTime).toISOString(), detail: {} } as any }, { onSuccess: () => f.reset({ source: 'manual', isActual: 'true', eventTime: new Date().toISOString().slice(0, 16) }) } as any))}>
      <FormGrid><TextField label="Milestone code" placeholder="DEPARTED" {...f.register('code', { required: true, minLength: 2 })} /><TextField label="Event time" type="datetime-local" {...f.register('eventTime', { required: true })} /></FormGrid>
      <FormGrid><SelectField label="Source" {...f.register('source')}>{['carrier', 'supplier', 'manual', 'device', 'inferred'].map((x) => <option key={x}>{x}</option>)}</SelectField><SelectField label="Kind" {...f.register('isActual')}><option value="true">Actual</option><option value="false">Estimate</option></SelectField></FormGrid>
      <Button type="submit" disabled={rec.isPending}>Record event</Button><ErrorNote e={rec.error} /></form></Card>
    <Card title="Complete delivery"><form className="grid gap-3" onSubmit={g.handleSubmit((v) => done.mutate({ params: { id: shipmentId }, body: { deliveredAt: new Date(v.deliveredAt).toISOString(), podDocumentId: v.podDocumentId } }))}>
      <TextField label="Delivered at" type="datetime-local" {...g.register('deliveredAt', { required: true })} />
      <SelectField label="Proof of delivery" {...g.register('podDocumentId', { required: true })}><option value="">{pods.length ? 'Select…' : 'No scanned POD on file — upload one first'}</option>{pods.map((d) => <option key={d.id} value={d.id}>{d.doc_type} · {fmtDate(d.created_at)}</option>)}</SelectField>
      <Button type="submit" disabled={done.isPending}>Complete delivery</Button><ErrorNote e={done.error} /><p className="text-xs text-steel">Delivery cannot be completed without an approved proof-of-delivery document.</p></form></Card></div>);
}

/** Tasks linked to the job. */
const tc = createColumnHelper<any>();
export function TasksTab({ jobId }: { jobId: string }) {
  const q = useOp('listTasks', { query: { relatedType: 'job', relatedId: jobId } }); const create = useCmd('createTask', { invalidate: ['listTasks'] }); const complete = useCmd('completeTask', { invalidate: ['listTasks'] }); const f = useForm<any>();
  const columns = useMemo(() => [tc.accessor('title', { header: 'Task', cell: (c) => <b className={c.row.original.status === 'done' ? 'text-steel line-through' : 'font-display'}>{c.getValue()}</b> }), tc.accessor('origin', { header: 'Origin', cell: (c) => <Chip tone="idle">{c.getValue()}</Chip> }), tc.accessor('due_at', { header: 'Due', cell: (c) => fmtDate(c.getValue()) }),
    tc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }), tc.display({ id: 'a', header: '', cell: (c) => c.row.original.status !== 'done' ? <Button size="sm" variant="ghost" onClick={() => complete.mutate({ params: { id: c.row.original.id } })}>Complete</Button> : null })], [complete]);
  return (<div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] items-start gap-5"><Card title="Tasks"><DataTable q={q} columns={columns} empty="No tasks on this job." filterable={false} /><ErrorNote e={complete.error} /></Card>
    <Card title="Add task"><form className="grid gap-3" onSubmit={f.handleSubmit((v) => create.mutate({ body: clean({ title: v.title, relatedType: 'job', relatedId: jobId, dueAt: v.dueAt ? new Date(v.dueAt).toISOString() : '' }) as any }, { onSuccess: () => f.reset() } as any))}><TextField label="Title" {...f.register('title', { required: true, minLength: 3 })} /><TextField label="Due" type="datetime-local" {...f.register('dueAt')} /><Button type="submit" disabled={create.isPending}>Add task</Button><ErrorNote e={create.error} /></form></Card></div>);
}

/** Conversation log: append-only. */
export function ConversationsTab({ jobId }: { jobId: string }) {
  const q = useOp('listMessages', { query: { relatedType: 'job', relatedId: jobId } }); const post = useCmd('postMessage', { invalidate: ['listMessages'] }); const f = useForm<any>({ defaultValues: { channel: 'internal', direction: 'internal' } }); const rows = (q.data as any[]) ?? [];
  return (<div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] items-start gap-5"><Card title="Conversation log · append-only"><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!rows.length} empty="No messages yet.">
    <ol className="grid gap-3">{rows.map((m) => <li key={m.id} className="rounded-sm border border-line p-3 text-sm"><div className="mb-1 flex items-center gap-2 text-xs text-steel"><b className="text-ink">{m.author ?? 'system'}</b><Chip tone="idle">{m.channel}</Chip><Chip tone={m.direction === 'inbound' ? 'info' : 'idle'}>{m.direction}</Chip><span className="ml-auto">{fmtDateTime(m.created_at)}</span></div>{m.body}</li>)}</ol></QueryBoundary></Card>
    <Card title="Post a message"><form className="grid gap-3" onSubmit={f.handleSubmit((v) => post.mutate({ body: { relatedType: 'job', relatedId: jobId, channel: v.channel, direction: v.direction, body: v.body } as any }, { onSuccess: () => f.reset({ channel: 'internal', direction: 'internal' }) } as any))}>
      <FormGrid><SelectField label="Channel" {...f.register('channel')}>{['internal', 'email', 'whatsapp', 'call'].map((x) => <option key={x}>{x}</option>)}</SelectField><SelectField label="Direction" {...f.register('direction')}>{['internal', 'inbound', 'outbound'].map((x) => <option key={x}>{x}</option>)}</SelectField></FormGrid>
      <AreaField label="Message" {...f.register('body', { required: true })} /><Button type="submit" disabled={post.isPending}>Post</Button><ErrorNote e={post.error} /><p className="text-xs text-steel">Messages cannot be edited or deleted.</p></form></Card></div>);
}

/** Incidents and audit for the job. */
const ic = createColumnHelper<any>();
export function IncidentsTab({ jobId }: { jobId: string }) {
  const q = useOp('listIncidents', { query: { jobId } });
  const columns = useMemo(() => [ic.accessor('ref', { header: 'Incident', cell: (c) => <Mono>{c.getValue()}</Mono> }), ic.accessor('kind', { header: 'Type', cell: (c) => c.getValue().replace('_', ' ') }), ic.accessor('severity', { header: 'Severity', cell: (c) => <Chip tone={c.getValue() === 'high' ? 'stop' : c.getValue() === 'medium' ? 'hold' : 'idle'}>{c.getValue()}</Chip> }), ic.accessor('description', { header: 'What happened', enableSorting: false }), ic.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> })], []);
  return <Card title="Incidents on this job"><DataTable q={q} columns={columns} empty="No incidents on this job." filterable={false} /><p className="mt-3 text-xs text-steel">Report and resolve incidents under Service &amp; quality.</p></Card>;
}
const ac = createColumnHelper<any>();
export function AuditTab({ jobId }: { jobId: string }) {
  const q = useOp('listAuditEvents', { query: { entityType: 'job', entityId: jobId, limit: 100 } });
  const columns = useMemo(() => [ac.accessor('at', { header: 'When', cell: (c) => fmtDateTime(c.getValue()) }), ac.accessor('actor', { header: 'Actor', cell: (c) => c.getValue() ?? c.row.original.actor_kind }), ac.accessor('action', { header: 'Action', cell: (c) => <Mono>{c.getValue()}</Mono> })], []);
  return <Card title="Audit trail · append-only"><DataTable q={q} columns={columns} empty="No audited changes on the job record itself yet." filterable={false} /></Card>;
}
