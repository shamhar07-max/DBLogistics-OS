'use client';
import { useState } from 'react';
import { Button, Card, Chip, Kpi, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip, inputCls } from '@/components/bits';
import { Mono } from '@/components/DataTable';
import { call } from '@/lib/api';

type Stop = { id: string; seq: number; kind: string; address: string; status: string; shipmentId?: string; shipmentRef?: string; pod: boolean; signedBy?: string };
type Trip = { id: string; ref: string; status: string; vehicle_ref?: string; driver?: string; stops: Stop[] };
const LABEL: Record<string, string> = { pickup: 'Confirm pickup', delivery: 'Capture proof of delivery', return_empty: 'Confirm empty return' };

/** One stop: the receiver signs (name) and the capture is sent as an idempotent device command. The delivery itself is completed by the forwarder after the POD document is reviewed. */
function StopRow({ trip, stop, last }: { trip: Trip; stop: Stop; last: boolean }) {
  const [name, setName] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null); const [busy, setBusy] = useState(false); const qc = useCmd('syncDeviceCommands', { invalidate: ['listTrips'] });
  const done = stop.status === 'done'; const open = ['dispatched', 'in_progress'].includes(trip.status) && !done;
  const send = async () => { setBusy(true); setMsg(null); try {
    const r: any = await qc.mutateAsync({ body: { deviceId: 'portal-web', commands: [{ commandId: crypto.randomUUID(), type: 'capture_pod', deviceTime: new Date().toISOString(), payload: { tripStopId: stop.id, signedBy: name.trim() } }] } });
    const res = r.results[0]; setMsg(res.status === 'accepted' ? { ok: true, text: 'Recorded.' } : { ok: false, text: `${res.error ?? res.status}: ${res.message ?? 'not accepted'}` }); setName(''); } catch (e: any) { setMsg({ ok: false, text: e?.message ?? 'Failed' }); } finally { setBusy(false); } };
  return (<li className="grid gap-2 rounded-sm border border-line p-3 text-sm" data-testid="stop"><div className="flex flex-wrap items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand-800 font-mono text-xs text-white">{stop.seq}</span><b className="font-display capitalize">{stop.kind.replace('_', ' ')}</b><span>{stop.address}</span>{stop.shipmentRef && <Mono>{stop.shipmentRef}</Mono>}
      <span className="flex-1" />{done ? <Chip tone="ok">done{stop.signedBy ? ` · signed by ${stop.signedBy}` : ''}</Chip> : <Chip tone="hold">pending</Chip>}</div>
    {open && <div className="flex flex-wrap items-end gap-2"><label className="grid flex-1 gap-1.5"><span className="font-label text-[11px] font-semibold uppercase tracking-[.09em] text-steel">Received by (name)</span><input aria-label={`Received by, stop ${stop.seq}`} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <Button size="sm" disabled={name.trim().length < 2 || busy} onClick={send}>{LABEL[stop.kind] ?? 'Capture'}{last ? ' & finish trip' : ''}</Button></div>}
    {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-status-ok' : 'text-[#A80000]'}>{msg.text}</p>}<ErrorNote e={qc.error} /></li>);
}
export function TripsBoard() {
  const q = useOp('listTrips'); const trips = (q.data as Trip[]) ?? []; const open = trips.filter((t) => ['dispatched', 'in_progress'].includes(t.status));
  return (<><PageTitle title="Your trips" sub="Transporter portal" />
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-3"><Kpi label="Open trips" value={open.length} /><Kpi label="Stops to complete" value={open.reduce((n, t) => n + t.stops.filter((s) => s.status !== 'done').length, 0)} /><Kpi label="Completed" value={trips.filter((t) => t.status === 'completed').length} /></section>
    <QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!trips.length} empty="No dispatched trips. New trips appear here when the forwarder dispatches them.">
      <div className="grid gap-5">{trips.map((t) => <Card key={t.id} title={<span className="flex flex-wrap items-center gap-2"><Mono>{t.ref}</Mono><StatusChip s={t.status} />{t.vehicle_ref && <span className="text-xs font-normal text-steel">{t.vehicle_ref}</span>}{t.driver && <span className="text-xs font-normal text-steel">driver {t.driver}</span>}</span>}>
        <ol className="grid gap-2">{t.stops.map((s, i) => <StopRow key={s.id} trip={t} stop={s} last={i === t.stops.length - 1} />)}</ol></Card>)}</div></QueryBoundary></>);
}
void call;
