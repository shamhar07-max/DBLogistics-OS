'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd, useOp } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, fmtDateTime } from '@/components/DataTable';
import { FormGrid, PartyPicker, SelectField, TextField } from '@/components/fields';
import { SectionTabs } from '@/components/SectionTabs';

type Lot = { id: string; description: string; batch?: string; qty_on_hand: string; qty_reserved: string; qty_available: string; condition: string; customs_status: string; on_hold: boolean };
type RO = { id: string; ref: string; status: string; qty: string; consignee?: string; lot: string; customs_status: string; requested_by: string; authorized_by?: string; released_at?: string };
type H = { id: string; lot: string; kind: string; reason: string; placed_at: string; released_at?: string; active: boolean };
const lc = createColumnHelper<Lot>(), rc = createColumnHelper<RO>(), hc = createColumnHelper<H>();

function Stock() {
  const q = useOp('listLots'); const hold = useCmd('placeHold', { invalidate: ['listLots', 'listHolds'] }); const rel = useCmd('requestRelease', { invalidate: ['listLots', 'listReleaseOrders'] }); const [qty, setQty] = useState('1');
  const columns = useMemo(() => [lc.accessor('description', { header: 'Lot', cell: (c) => <span><b className="font-display">{c.getValue()}</b><br /><Mono>{c.row.original.id.slice(0, 8)}</Mono></span> }), lc.accessor((r) => Number(r.qty_on_hand), { id: 'oh', header: 'On hand' }), lc.accessor((r) => Number(r.qty_reserved), { id: 'rs', header: 'Reserved' }), lc.accessor((r) => Number(r.qty_available), { id: 'av', header: 'Available' }),
    lc.accessor('condition', { header: 'Condition', cell: (c) => c.row.original.on_hold ? <Chip tone="stop">on hold</Chip> : <StatusChip s={c.getValue()} /> }), lc.accessor('customs_status', { header: 'Customs', cell: (c) => <Chip tone={c.getValue() === 'bonded' ? 'hold' : 'ok'}>{c.getValue().replace('_', ' ')}</Chip> }),
    lc.display({ id: 'a', header: '', cell: (c) => <span className="flex justify-end gap-1.5"><Button size="sm" variant="ghost" onClick={() => hold.mutate({ params: { id: c.row.original.id }, body: { reason: 'Quarantine — quality review', kind: 'quarantine' } })}>Quarantine</Button><Button size="sm" variant="ghost" onClick={() => rel.mutate({ body: { lotId: c.row.original.id, qty } })}>Request release</Button></span> })], [hold, rel, qty]);
  return (<Card title="Custody stock" actions={<label className="flex items-center gap-2 text-xs text-steel">Release qty<input aria-label="Release quantity" className="h-8 w-20 rounded-sm border border-line-strong px-2 font-mono text-sm text-ink" value={qty} onChange={(e) => setQty(e.target.value)} /></label>}>
    <DataTable q={q} columns={columns} empty="No custody stock. Receive cargo to create lots." label="Filter lots" /><ErrorNote e={hold.error ?? rel.error} /></Card>);
}
function Receive() {
  const fac = useOp('listFacilities'); const [key, setKey] = useState(() => crypto.randomUUID()); const [done, setDone] = useState<string>(); const f = useForm<any>({ defaultValues: { customsStatus: 'bonded' } });
  const receive = useCmd('receiveCargo', { invalidate: ['listLots'], onSuccess: (d: any) => { setDone(d.id ?? d.lotId ?? 'recorded'); setKey(crypto.randomUUID()); f.reset({ customsStatus: 'bonded' }); } });
  const facilities = (fac.data as any[]) ?? []; const sel = facilities.find((x) => x.id === f.watch('facilityId'));
  return (<Card title="Receive cargo into custody"><form className="grid max-w-2xl gap-3" onSubmit={f.handleSubmit((v) => { setDone(undefined); receive.mutate({ body: { facilityId: v.facilityId, ...(v.locationId ? { locationId: v.locationId } : {}), ownerPartyId: v.ownerPartyId, description: v.description, ...(v.batch ? { batch: v.batch } : {}), quantity: v.quantity, customsStatus: v.customsStatus, commandKey: key } as any }); })}>
    <FormGrid><SelectField label="Facility" {...f.register('facilityId', { required: true })}><option value="">Select…</option>{facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField>
      <SelectField label="Location" {...f.register('locationId')}><option value="">Unassigned</option>{(sel?.locations ?? []).map((l: any) => <option key={l.id} value={l.id}>{l.code}{l.zone ? ` · ${l.zone}` : ''}</option>)}</SelectField></FormGrid>
    <PartyPicker label="Owner (customer — goods are never ours)" {...f.register('ownerPartyId', { required: true })} /><TextField label="Description" {...f.register('description', { required: true })} />
    <FormGrid cols={3}><TextField label="Quantity" inputMode="decimal" {...f.register('quantity', { required: true })} /><TextField label="Batch" {...f.register('batch')} /><SelectField label="Customs status" {...f.register('customsStatus')}><option value="bonded">bonded</option><option value="duty_paid">duty paid</option><option value="free_circulation">free circulation</option></SelectField></FormGrid>
    <div className="flex items-center gap-3"><Button type="submit" disabled={receive.isPending}>Receive into custody</Button>{done && <Chip tone="ok">Received — stock lot created</Chip>}</div><ErrorNote e={receive.error} />
    <p className="text-xs text-steel">Submitting twice with the same command is safe — the receipt is recorded once.</p></form></Card>);
}
function Releases() {
  const q = useOp('listReleaseOrders'); const auth = useCmd('authorizeRelease', { invalidate: ['listReleaseOrders', 'listLots'] });
  const columns = useMemo(() => [rc.accessor('ref', { header: 'Order', cell: (c) => <Mono>{c.getValue()}</Mono> }), rc.accessor('lot', { header: 'Lot' }), rc.accessor((r) => Number(r.qty), { id: 'q', header: 'Qty' }), rc.accessor('consignee', { header: 'Consignee', cell: (c) => c.getValue() ?? '—' }),
    rc.accessor('customs_status', { header: 'Customs', cell: (c) => <Chip tone={c.getValue() === 'bonded' ? 'hold' : 'ok'}>{c.getValue().replace('_', ' ')}</Chip> }), rc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }), rc.accessor('released_at', { header: 'Released', cell: (c) => fmtDateTime(c.getValue()) }),
    rc.display({ id: 'a', header: '', cell: (c) => c.row.original.status === 'requested' ? <Button size="sm" onClick={() => auth.mutate({ params: { id: c.row.original.id } })}>Authorise release</Button> : null })], [auth]);
  return (<Card title="Release orders"><DataTable q={q} columns={columns} empty="No release orders." label="Filter release orders" /><ErrorNote e={auth.error} /><p className="mt-3 text-xs text-steel">Maker-checker: the person who requested a release cannot authorise it. Bonded stock needs an approved authority document; holds block release.</p></Card>);
}
function Holds() {
  const q = useOp('listHolds');
  const columns = useMemo(() => [hc.accessor('lot', { header: 'Lot' }), hc.accessor('kind', { header: 'Type', cell: (c) => c.getValue().replace('_', ' ') }), hc.accessor('reason', { header: 'Reason', enableSorting: false }), hc.accessor('placed_at', { header: 'Placed', cell: (c) => fmtDateTime(c.getValue()) }), hc.accessor('active', { header: 'State', cell: (c) => c.getValue() ? <Chip tone="hold">active</Chip> : <Chip tone="ok">released</Chip> })], []);
  return <Card title="Holds" actions={<Link href="/quality" className="text-xs underline">Release holds in Service &amp; quality →</Link>}><DataTable q={q} columns={columns} empty="No holds." label="Filter holds" /></Card>;
}
export default function Warehouse() {
  return (<><PageTitle title="Warehouse custody" sub="Customer-owned stock · never the forwarder's inventory" />
    <SectionTabs sections={[{ id: 'stock', label: 'Stock', content: <Stock /> }, { id: 'receive', label: 'Receive', content: <Receive /> }, { id: 'releases', label: 'Release orders', content: <Releases /> }, { id: 'holds', label: 'Holds', content: <Holds /> }]} /></>);
}
