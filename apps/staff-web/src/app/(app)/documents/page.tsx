'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd, useOp } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, fmtDate } from '@/components/DataTable';
import { SelectField } from '@/components/fields';
import { UploadDocument } from '@/components/UploadDocument';
import { call } from '@/lib/api';

type D = { id: string; doc_type: string; issuer_kind: string; issuer_name?: string; external_reference?: string; related_type: string; related_id: string; status: string; version: number; created_at: string; scan_status: string; size_bytes: string };
const col = createColumnHelper<D>();
export default function Documents() {
  const q = useOp('listDocuments'); const approve = useCmd('approveDocument', { invalidate: ['listDocuments'] }); const jobs = useOp('listJobs'); const [job, setJob] = useState(''); const [err, setErr] = useState<unknown>();
  const columns = useMemo(() => [
    col.accessor('doc_type', { header: 'Document', cell: (c) => <b className="font-display">{c.getValue()}</b> }),
    col.accessor('issuer_kind', { header: 'Issuer', cell: (c) => <Chip tone={c.getValue() === 'authority' ? 'info' : 'idle'}>{c.getValue()}</Chip> }), col.accessor('external_reference', { header: 'Reference', cell: (c) => <Mono>{c.getValue() ?? '—'}</Mono> }),
    col.accessor('related_type', { header: 'Linked to', cell: (c) => `${c.getValue()} ${c.row.original.related_id.slice(0, 8)}` }),
    col.accessor('scan_status', { header: 'Scan', cell: (c) => <Chip tone={c.getValue() === 'clean' ? 'ok' : c.getValue() === 'pending' ? 'hold' : 'stop'}>{c.getValue()}</Chip> }), col.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }),
    col.accessor('created_at', { header: 'Added', cell: (c) => fmtDate(c.getValue()) }),
    col.display({ id: 'a', header: '', cell: (c) => { const d = c.row.original; return <span className="flex gap-1.5">
      {d.status !== 'approved' && <Button size="sm" variant="ghost" disabled={d.scan_status !== 'clean'} title={d.scan_status !== 'clean' ? 'Awaiting malware scan' : undefined} onClick={() => approve.mutate({ params: { id: d.id }, ifMatch: d.version })}>Approve</Button>}
      <Button size="sm" variant="ghost" disabled={d.scan_status !== 'clean'} onClick={async () => { try { const r: any = await call('getDocumentDownloadUrl', { params: { id: d.id } }); window.open(r.url, '_blank', 'noopener'); } catch (e) { setErr(e); } }}>Download</Button></span>; } }),
  ], [approve]);
  return (<>
    <PageTitle title="Documents" sub="Operations · controlled evidence — immutable versions, scan before use" />
    <Card title="Library"><DataTable q={q} columns={columns} empty="No documents yet." label="Filter documents" /><ErrorNote e={approve.error ?? err} /></Card>
    <Card title="Upload"><div className="grid max-w-md gap-3"><SelectField label="Attach to job" value={job} onChange={(e) => setJob(e.target.value)}><option value="">Select…</option>{((jobs.data as any[]) ?? []).map((j) => <option key={j.id} value={j.id}>{j.ref}</option>)}</SelectField>
      {job ? <UploadDocument relatedType="job" relatedId={job} /> : <p className="text-sm text-steel">Choose a job to attach the document to. Shipment-level uploads live in the job workspace.</p>}</div></Card></>);
}
