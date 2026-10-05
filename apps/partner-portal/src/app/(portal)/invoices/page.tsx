'use client';
import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Card, Chip } from '@dbl/ui';
import { useOp, money } from '@/lib/hooks';
import { PageTitle, StatusChip } from '@/components/bits';
import { DataTable, RefLink, fmtDate } from '@/components/DataTable';
import { Only } from '@/components/Common';

const ic = createColumnHelper<any>(); const today = () => new Date().toISOString().slice(0, 10);
export default function Invoices() {
  const q = useOp('listInvoices');
  const columns = useMemo(() => [ic.accessor('ref', { header: 'Invoice', cell: (c) => <RefLink href={`/invoices/${c.row.original.id}`}>{c.getValue()}</RefLink> }), ic.accessor('posting_date', { header: 'Date', cell: (c) => fmtDate(c.getValue()) }), ic.accessor('total', { header: 'Total', cell: (c) => money(c.getValue(), c.row.original.currency) }),
    ic.accessor((r: any) => Number(r.total) - Number(r.amount_allocated), { id: 'open', header: 'Balance', cell: (c) => money(c.getValue(), c.row.original.currency) }), ic.accessor('due_date', { header: 'Due', cell: (c) => fmtDate(c.getValue()) }),
    ic.display({ id: 's', header: 'Status', cell: (c) => { const i = c.row.original; const open = Number(i.total) - Number(i.amount_allocated); return i.status === 'credited' ? <StatusChip s="credited" /> : open <= 0 ? <Chip tone="ok">paid</Chip> : i.due_date && i.due_date < today() ? <Chip tone="stop">overdue</Chip> : <Chip tone="hold">due</Chip>; } })], []);
  return (<Only workspaces={['customer']}><PageTitle title="Invoices" sub="Issued by DigitalBurj Logistics" /><Card><DataTable q={q} columns={columns as any} empty="No invoices yet." label="Filter invoices" /></Card></Only>);
}
