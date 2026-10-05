'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { createColumnHelper, flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type SortingState } from '@tanstack/react-table';
import { Card, QueryBoundary } from '@dbl/ui';
import { useOp, errView } from '@/lib/hooks';
import { PageTitle, StatusChip, inputCls } from '@/components/bits';

type Job = { id: string; ref: string; status: string; finance_status: string; currency: string; created_at: string };
const col = createColumnHelper<Job>();
export default function Jobs() {
  const q = useOp('listJobs'); const [sorting, setSorting] = useState<SortingState>([]); const [filter, setFilter] = useState('');
  const columns = useMemo(() => [
    col.accessor('ref', { header: 'Job', cell: (c) => <Link className="font-mono font-semibold underline-offset-2 hover:underline" href={`/jobs/${c.row.original.id}`}>{c.getValue()}</Link> }),
    col.accessor('status', { header: 'Execution', cell: (c) => <StatusChip s={c.getValue()} /> }),
    col.accessor('finance_status', { header: 'Finance', cell: (c) => <StatusChip s={c.getValue()} /> }),
    col.accessor('currency', { header: 'Currency' }), col.accessor('created_at', { header: 'Opened', cell: (c) => new Date(c.getValue()).toLocaleDateString() }),
  ], []);
  const t = useReactTable({ data: (q.data as Job[]) ?? [], columns, state: { sorting, globalFilter: filter }, onSortingChange: setSorting, onGlobalFilterChange: setFilter, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel() });
  return (<>
    <PageTitle title="Shipments & jobs" sub="Operations"><input aria-label="Filter jobs" className={inputCls + ' max-w-xs'} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} /></PageTitle>
    <Card><QueryBoundary status={q.status} error={errView(q.error)} isEmpty={!(q.data as Job[])?.length} empty="No jobs yet — accept a quote to open one.">
      <table className="w-full text-sm"><thead>{t.getHeaderGroups().map((g) => <tr key={g.id}>{g.headers.map((h) => <th key={h.id} onClick={h.column.getToggleSortingHandler()} className="cursor-pointer select-none border-b border-line bg-surface-2 px-3 py-2 text-left font-label text-[11px] font-semibold uppercase tracking-wider text-steel">{flexRender(h.column.columnDef.header, h.getContext())}{{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}</th>)}</tr>)}</thead>
        <tbody>{t.getRowModel().rows.map((r) => <tr key={r.id} className="border-b border-line hover:bg-brand-50">{r.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2.5">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>)}</tbody></table>
    </QueryBoundary></Card></>);
}
