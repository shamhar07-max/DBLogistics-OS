'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button, Card, Chip, FilePreview, QueryBoundary, SourceBadge } from '@dbl/ui';
import { call } from '@/lib/api';
import { errView, useOp } from '@/lib/hooks';
import { ErrorNote, StatusChip } from '@/components/bits';
import { DataTable, Mono, RefLink, fmtDate, fmtDateTime } from '@/components/DataTable';
import { useWho } from '@/components/Me';
import { Modal } from '@/components/Modal';

/** Renders children only for the listed workspaces; anyone else sees the standard "not available" state. */
export function Only({ workspaces, children }: { workspaces: string[]; children: React.ReactNode }) {
  const { me } = useWho(); if (!me) return null;
  if (!workspaces.includes(me.workspace)) return <div role="alert" data-testid="forbidden" className="rounded-md border border-status-hold bg-status-hold-100 p-6 text-sm"><b>Not available for your account.</b> This section is for {workspaces.join(' / ')} users.</div>;
  return <>{children}</>;
}
export const ACTIVE = (s: string) => !['delivered', 'cancelled', 'closed'].includes(s);

type Sh = { id: string; ref: string; mode: string; origin: string; destination: string; status: string; documents_status: string; delivered_at?: string; job_id: string; job_ref?: string };
const sc = createColumnHelper<Sh>();
export function ShipmentsTable({ limit }: { limit?: number }) {
  const q = useOp('listShipments'); const { me } = useWho();
  const columns = useMemo(() => [sc.accessor('ref', { header: 'Shipment', cell: (c) => <RefLink href={`/shipments/${c.row.original.id}`}>{c.getValue()}</RefLink> }), sc.accessor((r) => `${r.origin} → ${r.destination}`, { id: 'route', header: 'Route' }), sc.accessor('mode', { header: 'Mode', cell: (c) => <Chip tone="info">{c.getValue().replace('_', ' ')}</Chip> }),
    sc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }), sc.accessor('delivered_at', { header: 'Delivered', cell: (c) => fmtDate(c.getValue()) }),
    ...(me?.workspace === 'customer' ? [sc.accessor('documents_status', { header: 'Documents', cell: (c) => <StatusChip s={c.getValue() ?? 'pending'} /> })] : [])], [me?.workspace]);
  const view = limit && q.data ? { ...q, data: (q.data as Sh[]).slice(0, limit) } : q;
  return <DataTable q={view} columns={columns as any} empty="No shipments yet." label="Filter shipments" />;
}

/** Tracking: estimates and actuals are visibly different, with their source. */
export function TrackingCard({ shipmentId }: { shipmentId: string }) {
  const q = useOp('getShipmentTimeline', { params: { id: shipmentId } }); const d = q.data as any;
  return (<Card title="Tracking" actions={d && <Chip tone="info">current: {d.currentMilestone ?? '—'}</Chip>}><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!d?.events.length} empty="No tracking updates yet.">
    <ol className="grid gap-2">{d?.events.map((e: any, i: number) => <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="w-40 font-mono text-xs text-steel">{fmtDateTime(e.event_time)}</span><b className="font-display">{e.code.replace(/_/g, ' ')}</b><SourceBadge source={e.source} actual={e.is_actual} /></li>)}</ol></QueryBoundary></Card>);
}

type Doc = { id: string; doc_type: string; issuer_kind: string; external_reference?: string; related_type: string; related_id: string; status: string; scan_status: string; created_at: string; content_type?: string };
const dc = createColumnHelper<Doc>();
/** Document library for a record (or everything the user may see): preview and download use short-lived signed links. */
export function DocumentsTable({ relatedId }: { relatedId?: string }) {
  const q = useOp('listDocuments', { query: relatedId ? { relatedId } : undefined }); const [prev, setPrev] = useState<{ d: Doc; url: string } | null>(null); const [err, setErr] = useState<unknown>();
  const url = async (d: Doc) => ((await call('getDocumentDownloadUrl', { params: { id: d.id } })) as any).url as string;
  const columns = useMemo(() => [dc.accessor('doc_type', { header: 'Document', cell: (c) => <b className="font-display">{c.getValue()}</b> }), dc.accessor('external_reference', { header: 'Reference', cell: (c) => <Mono>{c.getValue() ?? '—'}</Mono> }),
    dc.accessor('status', { header: 'Status', cell: (c) => c.getValue() === 'approved' ? <Chip tone="ok">approved</Chip> : <Chip tone="hold">{c.row.original.scan_status === 'pending' ? 'being scanned' : 'awaiting review'}</Chip> }), dc.accessor('created_at', { header: 'Added', cell: (c) => fmtDate(c.getValue()) }),
    dc.display({ id: 'a', header: '', cell: (c) => { const d = c.row.original; const ok = d.scan_status === 'clean'; return <span className="flex justify-end gap-1.5"><Button size="sm" variant="ghost" disabled={!ok} onClick={async () => { try { setPrev({ d, url: await url(d) }); } catch (e) { setErr(e); } }}>Preview</Button>
      <Button size="sm" variant="ghost" disabled={!ok} onClick={async () => { try { window.open(await url(d), '_blank', 'noopener'); } catch (e) { setErr(e); } }}>Download</Button></span>; } })], []);
  return (<><DataTable q={q} columns={columns as any} empty="No documents yet." label="Filter documents" /><ErrorNote e={err} />
    <Modal open={!!prev} onOpenChange={(o) => !o && setPrev(null)} title={prev?.d.doc_type ?? ''}>{prev && <FilePreview url={prev.url} contentType={prev.d.content_type} name={prev.d.doc_type} />}</Modal></>);
}
