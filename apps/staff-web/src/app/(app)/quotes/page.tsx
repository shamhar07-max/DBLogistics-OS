'use client';
import Link from 'next/link';
import { Button, Card, PdfLink, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';

export default function Quotes() {
  const q = useOp('listQuotes'); const approve = useCmd('approveQuote', { invalidate: ['listQuotes'] }); const accept = useCmd('acceptQuote', { invalidate: ['listQuotes', 'listJobs'] }); const rows = (q.data as any[]) ?? [];
  return (<><PageTitle title="Quotations" sub="Commercial"><Link href="/quotes/new"><Button variant="signal">New quote</Button></Link></PageTitle>
    <Card><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!rows.length} empty="No quotations yet."><table className="w-full text-sm"><tbody>{rows.map((r) => <tr key={r.id} className="border-b border-line"><td className="py-2.5 font-mono font-semibold">{r.ref} r{r.revision}</td><td><StatusChip s={r.status} /></td><td className="text-steel">valid to {r.valid_until?.slice(0, 10)}</td><td className="space-x-2 text-right"><PdfLink href={`/api/proxy/api/v1/quotes/${r.id}/pdf`} testId="quote-pdf">PDF</PdfLink>
      {r.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => approve.mutate({ params: { id: r.id }, ifMatch: r.version })}>Approve</Button>}
      {r.status === 'approved' && <Button size="sm" onClick={() => accept.mutate({ params: { id: r.id }, ifMatch: r.version, body: { acceptedByName: 'Staff on behalf of customer', evidence: { channel: 'email', reference: 'manual' } } })}>Mark accepted → open job</Button>}</td></tr>)}</tbody></table></QueryBoundary>
      <ErrorNote e={approve.error ?? accept.error} /></Card></>);
}
