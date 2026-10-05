'use client';
import { useState } from 'react';
import { Button, Card, Chip, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, Field, PageTitle, StatusChip, inputCls } from '@/components/bits';

export default function Warehouse() {
  const lots = useOp('listLots'); const hold = useCmd('placeHold', { invalidate: ['listLots'] }); const rel = useCmd('requestRelease', { invalidate: ['listLots'] }); const auth = useCmd('authorizeRelease', { invalidate: ['listLots'] });
  const [qty, setQty] = useState('1'); const [last, setLast] = useState<string>(''); const rows = (lots.data as any[]) ?? [];
  return (<><PageTitle title="Warehouse custody" sub="Customer-owned stock · never the forwarder's inventory" />
    <Card><QueryBoundary status={lots.status} error={errView(lots.error)} isEmpty={!rows.length} empty="No custody stock. Receive cargo to create lots.">
      <table className="w-full text-sm"><thead><tr className="text-left font-label text-[11px] uppercase tracking-wider text-steel"><th className="py-2">Lot</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Condition</th><th>Customs</th><th /></tr></thead><tbody>{rows.map((l) => <tr key={l.id} className="border-t border-line">
        <td className="py-2.5"><b>{l.description}</b><div className="font-mono text-[11px] text-steel">{l.id.slice(0, 8)}</div></td><td className="font-mono">{Number(l.qty_on_hand)}</td><td className="font-mono">{Number(l.qty_reserved)}</td><td className="font-mono font-bold">{Number(l.qty_available)}</td>
        <td>{l.on_hold ? <Chip tone="stop">on hold</Chip> : <StatusChip s={l.condition} />}</td><td><Chip tone={l.customs_status === 'bonded' ? 'hold' : 'ok'}>{l.customs_status.replace('_', ' ')}</Chip></td>
        <td className="space-x-1.5 text-right"><Button size="sm" variant="ghost" onClick={() => hold.mutate({ params: { id: l.id }, body: { reason: 'Quarantine — quality review', kind: 'quarantine' } })}>Quarantine</Button>
          <Button size="sm" variant="ghost" onClick={() => rel.mutate({ body: { lotId: l.id, qty } }, { onSuccess: (o: any) => setLast(o.id) } as any)}>Request release</Button></td></tr>)}</tbody></table></QueryBoundary>
      <div className="mt-4 flex items-end gap-3"><Field label="Release quantity"><input className={inputCls + ' w-28 font-mono'} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Release order to authorise (second person)"><input className={inputCls + ' w-80 font-mono'} value={last} onChange={(e) => setLast(e.target.value)} /></Field><Button disabled={!last} onClick={() => auth.mutate({ params: { id: last } })}>Authorise & release</Button></div>
      <ErrorNote e={hold.error ?? rel.error ?? auth.error} /></Card></>);
}
