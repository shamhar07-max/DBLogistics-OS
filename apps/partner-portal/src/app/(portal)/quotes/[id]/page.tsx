'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, Chip, Kpi, PdfLink, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView, money } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip, inputCls } from '@/components/bits';
import { fmtDate } from '@/components/DataTable';
import { Conversation, Only } from '@/components/Common';

export default function QuotePage() {
  const { id } = useParams<{ id: string }>(); const q = useOp('getQuote', { params: { id } }); const d = q.data as any; const [name, setName] = useState(''); const [agree, setAgree] = useState(false);
  const accept = useCmd('acceptQuote', { invalidate: ['getQuote', 'listQuotes', 'listShipments'] }); const done = accept.data as any;
  const open = d && ['approved', 'sent'].includes(d.status) && d.valid_until >= new Date().toISOString().slice(0, 10);
  return (<Only workspaces={['customer']}><PageTitle title={d ? `${d.ref}${d.revision > 1 ? ` r${d.revision}` : ''}` : 'Quotation'} sub="Quotation">{d && <div className="flex flex-wrap gap-2"><StatusChip s={d.status} /><PdfLink href={`/api/proxy/api/v1/quotes/${id}/pdf`}>Download PDF</PdfLink></div>}</PageTitle>
    <QueryBoundary status={q.status} error={errView(q.error)}>{d && <>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4"><Kpi label="Net" value={money(d.totals.net, d.currency)} /><Kpi label="Tax" value={money(d.totals.tax, d.currency)} /><Kpi label="Total" value={money(d.totals.total, d.currency)} /><Kpi label="Valid until" value={fmtDate(d.valid_until)} /></section>
      <Card title={`${d.origin} → ${d.destination}`} actions={<Chip tone="info">{d.mode.replace('_', ' ')}{d.incoterm ? ` · ${d.incoterm}` : ''}</Chip>}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left font-label text-[11px] uppercase tracking-wider text-steel"><th className="py-2">Description</th><th>Qty</th><th className="text-right">Unit price</th><th>Tax</th></tr></thead>
        <tbody>{d.lines.map((l: any) => <tr key={l.seq} className="border-t border-line"><td className="py-2"><b>{l.description}</b>{l.charge_type !== 'fixed' && <span className="ml-2 text-xs text-steel">{l.charge_type.replace('_', ' ')}</span>}</td><td className="font-mono">{Number(l.quantity)} {l.unit ?? ''}</td><td className="text-right font-mono">{money(l.unit_price, d.currency)}</td><td className="font-mono text-xs">{l.tax_code}</td></tr>)}</tbody></table></div></Card>
      {done ? <Card><div className="grid gap-2"><Chip tone="ok">Accepted — thank you</Chip><p className="text-sm">We’ve opened your job and will start planning. Follow it under <Link href="/shipments" className="underline">Shipments</Link>.</p></div></Card>
        : open ? <Card title="Accept this quotation"><div className="grid max-w-md gap-3"><label className="grid gap-1.5"><span className="font-label text-[11px] font-semibold uppercase tracking-[.09em] text-steel">Your full name</span><input aria-label="Your full name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I accept this quotation, its prices and conditions on behalf of my company.</label>
          <Button disabled={!agree || name.trim().length < 2 || accept.isPending} onClick={() => accept.mutate({ params: { id }, body: { acceptedByName: name.trim(), evidence: { channel: 'portal', reference: 'portal' } }, ifMatch: d.version })}>Accept quotation</Button><ErrorNote e={accept.error} /></div></Card>
        : <p className="text-sm text-steel">{d.status === 'accepted' ? `Accepted ${fmtDate(d.accepted_at)}.` : d.status === 'expired' || d.valid_until < new Date().toISOString().slice(0, 10) ? 'This quotation has expired — request a new one.' : 'This quotation can no longer be accepted.'}</p>}
      <Conversation relatedType="quote" relatedId={id} /></>}</QueryBoundary></Only>);
}
