'use client';
import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Card } from '@dbl/ui';
import { useOp } from '@/lib/hooks';
import { PageTitle, StatusChip } from '@/components/bits';
import { DataTable, RefLink, fmtDate } from '@/components/DataTable';

type Job = { id: string; ref: string; status: string; finance_status: string; currency: string; created_at: string };
const col = createColumnHelper<Job>();
export default function Jobs() {
  const q = useOp('listJobs');
  const columns = useMemo(() => [col.accessor('ref', { header: 'Job', cell: (c) => <RefLink href={`/jobs/${c.row.original.id}`}>{c.getValue()}</RefLink> }), col.accessor('status', { header: 'Execution', cell: (c) => <StatusChip s={c.getValue()} /> }), col.accessor('finance_status', { header: 'Finance', cell: (c) => <StatusChip s={c.getValue()} /> }), col.accessor('currency', { header: 'Currency' }), col.accessor('created_at', { header: 'Opened', cell: (c) => fmtDate(c.getValue()) })], []);
  return (<><PageTitle title="Shipments & jobs" sub="Operations" /><Card><DataTable q={q} columns={columns} empty="No jobs yet — accept a quote to open one." label="Filter jobs" /></Card></>);
}
