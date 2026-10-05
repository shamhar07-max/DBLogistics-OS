'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Card, Chip, QueryBoundary, RouteLane, SourceBadge, Tabs, TabsContent, TabsList, TabsTrigger, Button } from '@dbl/ui';
import { useCmd, useOp, errView, money } from '@/lib/hooks';
import { ErrorNote, Field, PageTitle, StatusChip, inputCls } from '@/components/bits';
import { UploadDocument } from '@/components/UploadDocument';
import { AuditTab, BookingsTab, CargoTab, ConversationsTab, IncidentsTab, PlanTab, TasksTab, TrackingForms } from '@/components/JobTabs';

const TABS = ['overview', 'plan', 'bookings', 'cargo', 'documents', 'customs', 'tracking', 'tasks', 'conversations', 'costs', 'billing', 'incidents', 'audit'] as const;
const TAB_LABEL: Record<string, string> = { costs: 'Costs & Revenue' };

export default function JobWorkspace() {
  const { id } = useParams<{ id: string }>(); const job = useOp('getJob', { params: { id } });
  const j = job.data as any; const first = j?.shipments?.[0];
  return (<>
    <PageTitle title={j?.ref ?? 'Job'} sub="Shipment workspace">{j && <div className="flex gap-2"><StatusChip s={j.status} /><StatusChip s={j.finance_status} /></div>}</PageTitle>
    <QueryBoundary status={job.status} error={errView(job.error)}>
      {j && <Tabs defaultValue="overview"><TabsList className="mb-4 flex flex-wrap gap-0.5 border-b border-line">{TABS.map((t) => <TabsTrigger key={t} value={t} className="relative px-3.5 py-2.5 font-display text-[13px] font-semibold capitalize text-steel data-[state=active]:text-ink data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-[3px] data-[state=active]:after:bg-signal">{TAB_LABEL[t] ?? t}</TabsTrigger>)}</TabsList>
        <TabsContent value="overview"><Overview j={j} /></TabsContent>
        <TabsContent value="tracking"><div className="grid gap-5"><Tracking shipmentId={first?.id} />{first && <TrackingForms shipmentId={first.id} jobId={id} />}</div></TabsContent>
        <TabsContent value="documents"><Card title="Documents"><p className="mb-3 text-sm text-steel">Upload goes direct to private storage; the file becomes an immutable version once scanned. Authority documents and internal forms are tagged by issuer.</p>{first ? <UploadDocument relatedType="shipment" relatedId={first.id} /> : <p className="text-sm text-steel">Create a shipment first.</p>}</Card></TabsContent>
        <TabsContent value="customs"><Customs jobId={id} /></TabsContent>
        <TabsContent value="costs"><Margin jobId={id} /></TabsContent>
        <TabsContent value="billing"><Billing jobId={id} /></TabsContent>
        <TabsContent value="plan"><PlanTab jobId={id} /></TabsContent>
        <TabsContent value="bookings"><BookingsTab jobId={id} /></TabsContent>
        <TabsContent value="cargo"><CargoTab jobId={id} /></TabsContent>
        <TabsContent value="tasks"><TasksTab jobId={id} /></TabsContent>
        <TabsContent value="conversations"><ConversationsTab jobId={id} /></TabsContent>
        <TabsContent value="incidents"><IncidentsTab jobId={id} /></TabsContent>
        <TabsContent value="audit"><AuditTab jobId={id} /></TabsContent>
      </Tabs>}
    </QueryBoundary></>);
}
function Overview({ j }: { j: any }) {
  return <div className="grid gap-4"><Card title="Shipments">{j.shipments.length ? j.shipments.map((s: any) => <div key={s.id} className="mb-4 last:mb-0"><div className="mb-2 flex items-center gap-3 text-sm"><b className="font-mono">{s.ref}</b><span>{s.origin} → {s.destination}</span><StatusChip s={s.status} /><Chip tone={s.documents_status === 'approved' ? 'ok' : 'hold'}>docs {s.documents_status}</Chip></div>
    <RouteLane stops={[{ label: 'Planned', state: 'done' }, { label: 'In transit', state: s.status === 'executing' ? 'now' : s.status === 'planned' ? 'todo' : 'done' }, { label: 'Delivered', sub: s.delivered_at ? new Date(s.delivered_at).toLocaleDateString() : undefined, state: s.status === 'delivered' ? 'done' : 'todo' }]} /></div>) : <p className="text-sm text-steel">No shipments yet.</p>}</Card></div>;
}
function Tracking({ shipmentId }: { shipmentId?: string }) {
  const q = useOp('getShipmentTimeline', { params: { id: shipmentId ?? '' }, enabled: !!shipmentId }); const d = q.data as any;
  if (!shipmentId) return <p className="text-sm text-steel">No shipment yet.</p>;
  return <Card title="Tracking timeline" actions={d && <Chip tone="info">current: {d.currentMilestone ?? '—'}</Chip>}><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!d?.events.length} empty="No tracking events recorded.">
    <ol className="space-y-2">{d?.events.map((e: any, i: number) => <li key={i} className="flex items-center gap-3 text-sm"><span className="w-44 font-mono text-xs text-steel">{new Date(e.event_time).toLocaleString()}</span><b className="font-display">{e.code}</b><SourceBadge source={e.source} actual={e.is_actual} /><span className="text-xs text-steel">received {new Date(e.received_at).toLocaleTimeString()}</span></li>)}</ol></QueryBoundary></Card>;
}
function Margin({ jobId }: { jobId: string }) {
  const q = useOp('getJobMargin', { params: { id: jobId } }); const m = q.data as any;
  return <Card title="Cost & margin — four separate views"><QueryBoundary status={q.status} error={errView(q.error)}>{m && <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
    {[['Quoted', m.quoted], ['Expected', m.expected], ['Accounting (posted)', m.accounting]].map(([l, v]: any) => <div key={l} className="rounded-md bg-paper p-4"><div className="font-label text-xs uppercase tracking-wider text-steel">{l}</div><div className="mt-1 font-label text-2xl font-bold tabular-nums">{money(v.amount, m.currency)}</div><div className="text-xs text-steel">{v.percent ?? '—'}%</div></div>)}
    <div className="rounded-md bg-paper p-4"><div className="font-label text-xs uppercase tracking-wider text-steel">Cash collected</div><div className="mt-1 font-label text-2xl font-bold tabular-nums">{money(m.cash.collected, m.currency)}</div><div className="text-xs text-steel">Unbilled {money(m.unbilledRevenue, m.currency)} · {m.costChargesNotYetAccrued} cost(s) not accrued</div></div></div>}</QueryBoundary></Card>;
}
function Billing({ jobId }: { jobId: string }) {
  const inv = useOp('listInvoices'); const draft = useCmd('createInvoiceDraft', { invalidate: ['listInvoices'] }); const approve = useCmd('approveInvoice', { invalidate: ['listInvoices'] }); const post = useCmd('postInvoice', { invalidate: ['listInvoices', 'getJobMargin'] });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const rows = ((inv.data as any[]) ?? []).filter((i) => i.job_id === jobId); const err = draft.error ?? approve.error ?? post.error;
  return <Card title="Billing" actions={<Button size="sm" onClick={() => draft.mutate({ body: { jobId } })}>Draft invoice from open charges</Button>}><ErrorNote e={err} />
    <QueryBoundary status={inv.status} error={errView(inv.error)} isEmpty={!rows.length} empty="No invoices for this job."><table className="mt-3 w-full text-sm"><tbody>{rows.map((i) => <tr key={i.id} className="border-b border-line"><td className="py-2 font-mono">{i.ref ?? 'DRAFT'}</td><td><StatusChip s={i.status} /></td><td className="tabular-nums">{money(i.total, i.currency)}</td><td className="text-right">
      {i.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => approve.mutate({ params: { id: i.id }, ifMatch: i.version })}>Approve</Button>}
      {i.status === 'approved' && <span className="inline-flex items-center gap-2"><input aria-label="Posting date" type="date" className={inputCls + ' h-8 w-40'} value={date} onChange={(e) => setDate(e.target.value)} /><Button size="sm" onClick={() => post.mutate({ params: { id: i.id }, body: { postingDate: date }, ifMatch: i.version })}>Post</Button></span>}</td></tr>)}</tbody></table></QueryBoundary></Card>;
}
function Customs({ jobId }: { jobId: string }) {
  const parties = useOp('listParties'); const [importer, setImporter] = useState('');
  const create = useCmd('createCustomsCase', { onSuccess: (c) => setCase(c.id) }); const release = useCmd('recordCustomsRelease'); const [caseId, setCase] = useState(''); const [docId, setDoc] = useState(''); const [ref, setRef] = useState('');
  return <Card title="Customs & trade"><p className="mb-3 text-sm text-steel">Authority status and internal workflow status are separate. “Released” can only be recorded with an approved authority document.</p>
    <div className="grid max-w-xl gap-3"><Field label="Importer"><select className={inputCls} value={importer} onChange={(e) => setImporter(e.target.value)}><option value="">Select…</option>{((parties.data as any[]) ?? []).map((p) => <option key={p.id} value={p.id}>{p.legal_name}</option>)}</select></Field>
      <Button size="sm" variant="ghost" disabled={!importer} onClick={() => create.mutate({ body: { jobId, importerPartyId: importer, procedure: 'import' } })}>Open import case</Button>
      <Field label="Case id"><input className={inputCls + ' font-mono'} value={caseId} onChange={(e) => setCase(e.target.value)} /></Field><Field label="Evidence document id"><input className={inputCls + ' font-mono'} value={docId} onChange={(e) => setDoc(e.target.value)} /></Field><Field label="Authority reference"><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      <Button disabled={!caseId || !docId || !ref} onClick={() => release.mutate({ params: { id: caseId }, body: { documentId: docId, authorityReference: ref } })}>Record release</Button><ErrorNote e={create.error ?? release.error} />{release.data && <Chip tone="ok">{release.data.authorityStatus}</Chip>}</div></Card>;
}
