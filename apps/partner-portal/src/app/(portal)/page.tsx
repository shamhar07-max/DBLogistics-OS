'use client';
import Link from 'next/link';
import { Card, Chip, Kpi } from '@dbl/ui';
import { useOp, money } from '@/lib/hooks';
import { PageTitle } from '@/components/bits';
import { Mono, fmtDate } from '@/components/DataTable';
import { ACTIVE, ShipmentsTable } from '@/components/Common';
import { isTransporter, useWho } from '@/components/Me';
import { TripsBoard } from '@/components/Trips';

const today = () => new Date().toISOString().slice(0, 10);
function CustomerHome() {
  const ships = useOp('listShipments'); const quotes = useOp('listQuotes'); const invoices = useOp('listInvoices');
  const active = ((ships.data as any[]) ?? []).filter((s) => ACTIVE(s.status)); const open = ((quotes.data as any[]) ?? []).filter((q) => ['approved', 'sent'].includes(q.status) && q.valid_until >= today());
  const unpaid = ((invoices.data as any[]) ?? []).filter((i) => i.status === 'posted' && Number(i.total) > Number(i.amount_allocated));
  const byCur = unpaid.reduce<Record<string, number>>((m, i) => ({ ...m, [i.currency]: (m[i.currency] ?? 0) + Number(i.total) - Number(i.amount_allocated) }), {}); const overdue = unpaid.filter((i) => i.due_date && i.due_date < today());
  return (<>
    <PageTitle title="Your shipments" sub="Customer portal" />
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Summary"><Kpi label="Active shipments" value={active.length} hint="in progress right now" /><Kpi label="Quotes to accept" value={open.length} hint={<Link href="/quotes" className="underline">review quotes</Link>} tone={open.length ? 'risk' : undefined} />
      <Kpi label="Outstanding" value={Object.keys(byCur).length ? Object.entries(byCur).map(([c, v]) => money(v, c)).join(' · ') : money(0)} hint={<Link href="/invoices" className="underline">view invoices</Link>} /><Kpi label="Overdue invoices" value={overdue.length} tone={overdue.length ? 'risk' : undefined} /></section>
    {open.length > 0 && <Card title="Waiting for your acceptance"><ul className="divide-y divide-line">{open.map((q) => <li key={q.id} className="flex flex-wrap items-center gap-3 py-2 text-sm"><Mono>{q.ref}</Mono><span className="text-steel">valid until {fmtDate(q.valid_until)}</span><span className="flex-1" /><Link href={`/quotes/${q.id}`} className="font-semibold underline">Review &amp; accept</Link></li>)}</ul></Card>}
    <Card title="Recent shipments" actions={<Link href="/shipments" className="text-xs underline">All shipments</Link>}><ShipmentsTable limit={8} /></Card>
  </>);
}
function AgentHome() {
  const ships = useOp('listShipments'); const rows = (ships.data as any[]) ?? []; const moving = rows.filter((s) => s.status === 'executing').length;
  return (<><PageTitle title="Your shipments" sub="Agent portal" />
    <section className="grid grid-cols-2 gap-4 lg:grid-cols-3"><Kpi label="Assigned to you" value={rows.length} /><Kpi label="In transit" value={moving} /><Kpi label="Delivered" value={rows.filter((s) => s.status === 'delivered').length} /></section>
    <Card title="Shipments you operate" actions={<Chip tone="info">report milestones on each shipment</Chip>}><ShipmentsTable /></Card></>);
}
export default function Home() {
  const { me } = useWho(); if (!me) return null;
  if (isTransporter(me.workspace)) return <TripsBoard />;
  return me.workspace === 'agent' ? <AgentHome /> : <CustomerHome />;
}
