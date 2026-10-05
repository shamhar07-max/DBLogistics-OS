'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd, useOp } from '@/lib/hooks';
import { ErrorNote, Field, PageTitle, StatusChip, inputCls } from '@/components/bits';
import { DataTable, Mono, RefLink, fmtDate } from '@/components/DataTable';
import { JobPicker, PartyPicker, SelectField } from '@/components/fields';

type C = { id: string; ref: string; procedure: string; internal_status: string; authority_status?: string; authority_reference?: string; job_id: string; job_ref: string; importer: string; created_at: string; has_evidence: boolean };
const col = createColumnHelper<C>();
export default function Customs() {
  const q = useOp('listCustomsCases'); const docs = useOp('listDocuments'); const create = useCmd('createCustomsCase', { invalidate: ['listCustomsCases'] }); const release = useCmd('recordCustomsRelease', { invalidate: ['listCustomsCases'] });
  const [job, setJob] = useState(''); const [importer, setImporter] = useState(''); const [procedure, setProcedure] = useState('import'); const [target, setTarget] = useState(''); const [doc, setDoc] = useState(''); const [ref, setRef] = useState('');
  const evidence = ((docs.data as any[]) ?? []).filter((d) => d.status === 'approved' && d.issuer_kind === 'authority' && d.scan_status === 'clean');
  const columns = useMemo(() => [
    col.accessor('ref', { header: 'Case', cell: (c) => <Mono>{c.getValue()}</Mono> }), col.accessor('job_ref', { header: 'Job', cell: (c) => <RefLink href={`/jobs/${c.row.original.job_id}`}>{c.getValue()}</RefLink> }),
    col.accessor('importer', { header: 'Importer' }), col.accessor('procedure', { header: 'Procedure', cell: (c) => c.getValue().replace('_', '-') }),
    col.accessor('authority_status', { header: 'Authority says', cell: (c) => c.getValue() ? <Chip tone={c.getValue() === 'released' ? 'ok' : 'hold'}>{c.getValue()}</Chip> : <Chip tone="hold">awaiting authority response</Chip> }),
    col.accessor('internal_status', { header: 'Internal workflow', cell: (c) => <StatusChip s={c.getValue()} /> }),
    col.accessor('has_evidence', { header: 'Evidence', cell: (c) => c.getValue() ? <Chip tone="ok">on file · {c.row.original.authority_reference}</Chip> : <span className="text-xs text-steel">none</span> }),
    col.accessor('created_at', { header: 'Opened', cell: (c) => fmtDate(c.getValue()) }),
  ], []);
  return (<>
    <PageTitle title="Customs & trade" sub="Operations · authority status and internal status are never conflated" />
    <Card title="Cases"><DataTable q={q} columns={columns} empty="No customs cases." label="Filter cases" /></Card>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="Open a case"><div className="grid gap-3"><JobPicker label="Job" value={job} onChange={(e) => setJob(e.target.value)} /><PartyPicker label="Importer / exporter" value={importer} onChange={(e) => setImporter(e.target.value)} />
        <SelectField label="Procedure" value={procedure} onChange={(e) => setProcedure(e.target.value)}>{['import', 'export', 'transit', 're_export', 'warehouse_entry'].map((p) => <option key={p}>{p}</option>)}</SelectField>
        <Button disabled={!job || !importer} onClick={() => create.mutate({ body: { jobId: job, importerPartyId: importer, procedure: procedure as any } })}>Open case</Button><ErrorNote e={create.error} /></div></Card>
      <Card title="Record authority release"><p className="mb-3 text-sm text-steel">Only <b>approved, scanned, authority-issued</b> documents appear here. “Released” cannot be set without one.</p>
        <div className="grid gap-3"><SelectField label="Case" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Select…</option>{((q.data as C[]) ?? []).filter((c) => c.internal_status !== 'release_recorded').map((c) => <option key={c.id} value={c.id}>{c.ref} · {c.importer}</option>)}</SelectField>
          <SelectField label="Evidence document" value={doc} onChange={(e) => setDoc(e.target.value)}><option value="">{evidence.length ? 'Select…' : 'No eligible authority documents'}</option>{evidence.map((d) => <option key={d.id} value={d.id}>{d.doc_type} · {d.external_reference ?? d.id.slice(0, 8)}</option>)}</SelectField>
          <Field label="Authority reference"><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
          <Button disabled={!target || !doc || !ref} onClick={() => release.mutate({ params: { id: target }, body: { documentId: doc, authorityReference: ref } })}>Record release</Button><ErrorNote e={release.error} /></div></Card></div></>);
}
