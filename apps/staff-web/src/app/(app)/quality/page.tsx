'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd, useOp, money } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, RefLink, fmtDateTime } from '@/components/DataTable';
import { FormGrid, JobPicker, LotPicker, SelectField, TextField, AreaField } from '@/components/fields';
import { SectionTabs } from '@/components/SectionTabs';

type I = { id: string; ref: string; kind: string; severity: string; status: string; description: string; job_id?: string; job_ref?: string; hold_id?: string; created_at: string; resolution_note?: string };
type H = { id: string; lot: string; kind: string; reason: string; placed_at: string; released_at?: string; release_note?: string; active: boolean };
type C = { id: string; status: string; amount: string; currency: string; incident_ref: string; kind: string; created_at: string };
const ic = createColumnHelper<I>(), hc = createColumnHelper<H>(), cc = createColumnHelper<C>();
const sev = (s: string) => <Chip tone={s === 'high' ? 'stop' : s === 'medium' ? 'hold' : 'idle'}>{s}</Chip>;

function Incidents() {
  const q = useOp('listIncidents'); const create = useCmd('createIncident', { invalidate: ['listIncidents', 'listHolds'] }); const inv = useCmd('investigateIncident', { invalidate: ['listIncidents'] }); const res = useCmd('resolveIncident', { invalidate: ['listIncidents'] });
  const f = useForm<any>({ defaultValues: { kind: 'damage', severity: 'medium', placeHold: false } }); const [note, setNote] = useState<Record<string, string>>({});
  const columns = useMemo(() => [ic.accessor('ref', { header: 'Incident', cell: (c) => <Mono>{c.getValue()}</Mono> }), ic.accessor('kind', { header: 'Type', cell: (c) => c.getValue().replace('_', ' ') }), ic.accessor('severity', { header: 'Severity', cell: (c) => sev(c.getValue()) }),
    ic.accessor('description', { header: 'What happened', enableSorting: false }), ic.accessor('job_ref', { header: 'Job', cell: (c) => c.getValue() ? <RefLink href={`/jobs/${c.row.original.job_id}`}>{c.getValue()}</RefLink> : '—' }),
    ic.accessor('status', { header: 'Status', cell: (c) => <span className="flex items-center gap-1.5"><StatusChip s={c.getValue()} />{c.row.original.hold_id && <Chip tone="hold">hold placed</Chip>}</span> }), ic.accessor('created_at', { header: 'Reported', cell: (c) => fmtDateTime(c.getValue()) }),
    ic.display({ id: 'a', header: '', cell: (c) => { const i = c.row.original; if (i.status === 'resolved') return null; return <span className="flex items-center gap-1.5">
      {i.status === 'open' && <Button size="sm" variant="ghost" onClick={() => inv.mutate({ params: { id: i.id } })}>Investigate</Button>}
      <input aria-label={`Resolution note for ${i.ref}`} placeholder="Resolution note" className="h-8 w-40 rounded-sm border border-line-strong px-2 text-xs" value={note[i.id] ?? ''} onChange={(e) => setNote({ ...note, [i.id]: e.target.value })} />
      <Button size="sm" disabled={(note[i.id] ?? '').length < 5} onClick={() => res.mutate({ params: { id: i.id }, body: { resolutionNote: note[i.id] } })}>Resolve</Button></span>; } })], [inv, res, note]);
  return (<div className="grid grid-cols-[1fr_360px] items-start gap-5">
    <Card title="Incidents"><DataTable q={q} columns={columns} empty="No incidents recorded." label="Filter incidents" /><ErrorNote e={inv.error ?? res.error} /><p className="mt-3 text-xs text-steel">Resolving an incident never releases its hold — release is a separate, separately authorised step.</p></Card>
    <Card title="Report incident"><form className="grid gap-3" onSubmit={f.handleSubmit((b) => create.mutate({ body: Object.fromEntries(Object.entries(b).filter(([, v]) => v !== '')) as any }, { onSuccess: () => f.reset({ kind: 'damage', severity: 'medium', placeHold: false }) } as any))}>
      <FormGrid><SelectField label="Type" {...f.register('kind')}>{['damage', 'shortage', 'temperature_excursion', 'delay', 'document_error', 'other'].map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</SelectField><SelectField label="Severity" {...f.register('severity')}>{['low', 'medium', 'high'].map((k) => <option key={k}>{k}</option>)}</SelectField></FormGrid>
      <AreaField label="Description" {...f.register('description', { required: true })} /><JobPicker label="Job" {...f.register('jobId')} /><LotPicker label="Stock lot" {...f.register('lotId')} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...f.register('placeHold')} /> Place a quality hold on the lot now</label><Button type="submit" disabled={create.isPending}>Report</Button><ErrorNote e={create.error} /></form></Card></div>);
}
function Claims() {
  const q = useOp('listClaims'); const inc = useOp('listIncidents'); const create = useCmd('createClaim', { invalidate: ['listClaims'] }); const f = useForm<any>({ defaultValues: { currency: 'AED' } });
  const columns = useMemo(() => [cc.accessor('incident_ref', { header: 'Incident', cell: (c) => <Mono>{c.getValue()}</Mono> }), cc.accessor('kind', { header: 'Type', cell: (c) => c.getValue().replace('_', ' ') }), cc.accessor('amount', { header: 'Amount', cell: (c) => money(c.getValue(), c.row.original.currency) }), cc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }), cc.accessor('created_at', { header: 'Raised', cell: (c) => fmtDateTime(c.getValue()) })], []);
  return (<div className="grid grid-cols-[1fr_340px] items-start gap-5"><Card title="Claims"><DataTable q={q} columns={columns} empty="No claims." label="Filter claims" /></Card>
    <Card title="Raise claim"><form className="grid gap-3" onSubmit={f.handleSubmit((b) => create.mutate({ body: b }, { onSuccess: () => f.reset({ currency: 'AED' }) } as any))}>
      <SelectField label="Incident" {...f.register('incidentId', { required: true })}><option value="">Select…</option>{((inc.data as I[]) ?? []).map((i) => <option key={i.id} value={i.id}>{i.ref} · {i.kind.replace('_', ' ')}</option>)}</SelectField>
      <FormGrid><TextField label="Amount" inputMode="decimal" {...f.register('amount', { required: true })} /><TextField label="Currency" maxLength={3} {...f.register('currency')} /></FormGrid><Button type="submit" disabled={create.isPending}>Raise claim</Button><ErrorNote e={create.error} /></form></Card></div>);
}
function Holds() {
  const q = useOp('listHolds'); const rel = useCmd('releaseHold', { invalidate: ['listHolds', 'listIncidents'] }); const [note, setNote] = useState<Record<string, string>>({});
  const columns = useMemo(() => [hc.accessor('lot', { header: 'Lot' }), hc.accessor('kind', { header: 'Hold type', cell: (c) => c.getValue().replace('_', ' ') }), hc.accessor('reason', { header: 'Reason', enableSorting: false }), hc.accessor('placed_at', { header: 'Placed', cell: (c) => fmtDateTime(c.getValue()) }),
    hc.accessor('active', { header: 'State', cell: (c) => c.getValue() ? <Chip tone="hold">active</Chip> : <Chip tone="ok">released · {c.row.original.release_note}</Chip> }),
    hc.display({ id: 'a', header: '', cell: (c) => { const h = c.row.original; if (!h.active) return null; return <span className="flex items-center gap-1.5"><input aria-label="Release note" placeholder="Release note" className="h-8 w-40 rounded-sm border border-line-strong px-2 text-xs" value={note[h.id] ?? ''} onChange={(e) => setNote({ ...note, [h.id]: e.target.value })} /><Button size="sm" disabled={(note[h.id] ?? '').length < 5} onClick={() => rel.mutate({ params: { id: h.id }, body: { note: note[h.id] } })}>Release</Button></span>; } })], [rel, note]);
  return <Card title="Holds"><DataTable q={q} columns={columns} empty="No holds." label="Filter holds" /><ErrorNote e={rel.error} /><p className="mt-3 text-xs text-steel">Maker-checker: the person who placed a hold cannot release it, and needs the <b>quality.hold.release</b> permission.</p></Card>;
}
export default function Quality() {
  return (<><PageTitle title="Service & quality" sub="Incidents, claims and holds — evidence trail from report to release" />
    <SectionTabs sections={[{ id: 'incidents', label: 'Incidents', content: <Incidents /> }, { id: 'claims', label: 'Claims', content: <Claims /> }, { id: 'holds', label: 'Holds', content: <Holds /> }]} /></>);
}
