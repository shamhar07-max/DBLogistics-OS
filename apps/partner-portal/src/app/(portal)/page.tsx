'use client';
import Link from 'next/link';
import { Button, Card, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView, money } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';

export default function Home() {
  const jobs = useOp('listJobs'); const quotes = useOp('listQuotes'); const invoices = useOp('listInvoices'); const accept = useCmd('acceptQuote', { invalidate: ['listQuotes', 'listJobs'] });
  const open = ((quotes.data as any[]) ?? []).filter((q) => ['approved', 'sent'].includes(q.status));
  return (<>
    <PageTitle title="My shipments" sub="Customer portal" />
    {open.length > 0 && <Card title="Quotations awaiting your acceptance">{open.map((q) => <div key={q.id} className="flex items-center gap-4 border-b border-line py-2 text-sm last:border-0"><b className="font-mono">{q.ref}</b><span className="text-steel">valid to {q.valid_until?.slice(0, 10)}</span><span className="flex-1" /><Button size="sm" onClick={() => accept.mutate({ params: { id: q.id }, ifMatch: q.version, body: { acceptedByName: 'Portal user', evidence: { channel: 'portal', reference: 'portal-click' } } })}>Accept quotation</Button></div>)}<ErrorNote e={accept.error} /></Card>}
    <Card title="Jobs"><QueryBoundary status={jobs.status} error={errView(jobs.error)} isEmpty={!(jobs.data as any[])?.length} empty="No shipments yet."><ul className="divide-y divide-line">{((jobs.data as any[]) ?? []).map((j) => <li key={j.id} className="flex items-center gap-4 py-3 text-sm"><Link className="font-mono font-semibold underline" href={`/jobs/${j.id}`}>{j.ref}</Link><StatusChip s={j.status} /></li>)}</ul></QueryBoundary></Card>
    <Card title="Invoices"><QueryBoundary status={invoices.status} error={errView(invoices.error)} isEmpty={!(invoices.data as any[])?.length} empty="No invoices."><ul className="divide-y divide-line">{((invoices.data as any[]) ?? []).map((i) => <li key={i.id} className="flex items-center gap-4 py-2 text-sm"><b className="font-mono">{i.ref ?? 'draft'}</b><StatusChip s={i.status} /><span className="flex-1" /><span className="font-mono">{money(i.total, i.currency)}</span></li>)}</ul></QueryBoundary></Card></>);
}
