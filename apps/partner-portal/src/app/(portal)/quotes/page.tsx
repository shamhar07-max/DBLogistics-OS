'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button, Card, Chip } from '@dbl/ui';
import { useOp } from '@/lib/hooks';
import { PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, RefLink, fmtDate } from '@/components/DataTable';
import { SectionTabs } from '@/components/SectionTabs';
import { Only } from '@/components/Common';

const qc = createColumnHelper<any>(), ec = createColumnHelper<any>(); const today = () => new Date().toISOString().slice(0, 10);
function Quotations() {
  const q = useOp('listQuotes');
  const columns = useMemo(() => [qc.accessor('ref', { header: 'Quotation', cell: (c) => <RefLink href={`/quotes/${c.row.original.id}`}>{c.getValue()}{c.row.original.revision > 1 ? ` r${c.row.original.revision}` : ''}</RefLink> }), qc.accessor('currency', { header: 'Currency' }),
    qc.accessor('valid_until', { header: 'Valid until', cell: (c) => fmtDate(c.getValue()) }), qc.accessor('status', { header: 'Status', cell: (c) => ['approved', 'sent'].includes(c.getValue()) ? (c.row.original.valid_until >= today() ? <Chip tone="hold">awaiting your acceptance</Chip> : <Chip tone="stop">expired</Chip>) : <StatusChip s={c.getValue()} /> })], []);
  return <Card title="Quotations"><DataTable q={q} columns={columns as any} empty="No quotations yet. Request one and we’ll come back to you." label="Filter quotations" /></Card>;
}
function Requests() {
  const q = useOp('listEnquiries');
  const columns = useMemo(() => [ec.accessor('ref', { header: 'Request', cell: (c) => <Mono>{c.getValue()}</Mono> }), ec.accessor((r: any) => `${r.origin} → ${r.destination}`, { id: 'r', header: 'Route' }), ec.accessor('mode', { header: 'Mode', cell: (c) => c.getValue().replace('_', ' ') }), ec.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }), ec.accessor('created_at', { header: 'Sent', cell: (c) => fmtDate(c.getValue()) })], []);
  return <Card title="Your quote requests"><DataTable q={q} columns={columns as any} empty="You haven’t requested a quote yet." label="Filter requests" /></Card>;
}
export default function Quotes() {
  return (<Only workspaces={['customer']}><PageTitle title="Quotes" sub="Prices and requests"><Link href="/quotes/new"><Button variant="signal">Request a quote</Button></Link></PageTitle>
    <SectionTabs sections={[{ id: 'quotes', label: 'Quotations', content: <Quotations /> }, { id: 'requests', label: 'My requests', content: <Requests /> }]} /></Only>);
}
