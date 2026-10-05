'use client';
import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useFieldArray, useForm } from 'react-hook-form';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd, useOp } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono } from '@/components/DataTable';
import { EmployeePicker, FormGrid, PartyPicker, SelectField, ShipmentPicker, TextField } from '@/components/fields';

type Trip = { id: string; ref: string; status: string; vehicle_ref?: string; transporter: string; driver?: string; stops: Array<{ id: string; seq: number; kind: string; address: string; status: string; shipmentRef?: string; pod: boolean; signedBy?: string }> };
const col = createColumnHelper<Trip>();
export default function Transport() {
  const q = useOp('listTrips'); const create = useCmd('createTrip', { invalidate: ['listTrips'] }); const dispatch = useCmd('dispatchTrip', { invalidate: ['listTrips'] });
  const { register, control, handleSubmit, reset } = useForm<any>({ defaultValues: { stops: [{ kind: 'pickup', address: '' }, { kind: 'delivery', address: '' }] } }); const { fields, append, remove } = useFieldArray({ control, name: 'stops' });
  const columns = useMemo(() => [
    col.accessor('ref', { header: 'Trip', cell: (c) => <span><Mono>{c.getValue()}</Mono>{c.row.original.vehicle_ref && <div className="text-xs text-steel">{c.row.original.vehicle_ref}</div>}</span> }), col.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }),
    col.accessor('transporter', { header: 'Transporter' }), col.accessor('driver', { header: 'Driver', cell: (c) => c.getValue() ?? '—' }),
    col.accessor('stops', { header: 'Stops · proof of delivery', enableSorting: false, cell: (c) => <ol className="space-y-0.5 text-xs">{c.getValue().map((s) => <li key={s.id} className="flex items-center gap-2"><span className="font-mono text-steel">{s.seq}</span><b className="capitalize">{s.kind.replace('_', ' ')}</b><span>{s.address}</span>{s.shipmentRef && <Mono>{s.shipmentRef}</Mono>}{s.kind === 'delivery' && (s.pod ? <Chip tone="ok">POD · {s.signedBy}</Chip> : <Chip tone="hold">awaiting POD</Chip>)}</li>)}</ol> }),
    col.display({ id: 'act', header: '', cell: (c) => c.row.original.status === 'planned' ? <Button size="sm" onClick={() => dispatch.mutate({ params: { id: c.row.original.id } })}>Dispatch</Button> : null }),
  ], [dispatch]);
  return (<>
    <PageTitle title="Transport & dispatch" sub="Operations · subcontracted trips, evidence from the driver app" />
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] items-start gap-5">
      <Card title="Trips"><DataTable q={q} columns={columns} empty="No trips planned." label="Filter trips" /><ErrorNote e={dispatch.error} /></Card>
      <Card title="Plan a trip"><form className="grid gap-3" onSubmit={handleSubmit((v) => create.mutate({ body: { transporterPartyId: v.transporterPartyId, driverEmployeeId: v.driverEmployeeId || undefined, vehicleRef: v.vehicleRef || undefined, stops: v.stops.map((s: any) => ({ kind: s.kind, address: s.address, shipmentId: s.shipmentId || undefined })) } as any }, { onSuccess: () => reset() } as any))}>
        <PartyPicker role="transporter" label="Transporter" {...register('transporterPartyId', { required: true })} /><FormGrid><EmployeePicker label="Driver" {...register('driverEmployeeId')} /><TextField label="Vehicle" {...register('vehicleRef')} /></FormGrid>
        {fields.map((f, i) => <div key={f.id} className="grid gap-2 rounded-sm bg-paper p-3"><FormGrid><SelectField label={`Stop ${i + 1}`} {...register(`stops.${i}.kind`)}><option value="pickup">pickup</option><option value="delivery">delivery</option><option value="return_empty">return empty</option></SelectField><TextField label="Address" {...register(`stops.${i}.address`, { required: true })} /></FormGrid><ShipmentPicker label="Shipment" {...register(`stops.${i}.shipmentId`)} />{fields.length > 1 && <button type="button" className="text-left text-xs text-steel underline" onClick={() => remove(i)}>Remove stop</button>}</div>)}
        <Button type="button" size="sm" variant="ghost" onClick={() => append({ kind: 'delivery', address: '' })}>+ Add stop</Button><Button type="submit" disabled={create.isPending}>Plan trip</Button><ErrorNote e={create.error} />
        <p className="text-xs text-steel">Dispatch is refused if the driver has no valid <b>driving</b> qualification (People &amp; Assets).</p></form></Card>
    </div></>);
}
