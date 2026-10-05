'use client';
import * as React from 'react';
import Link from 'next/link';
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { QueryBoundary } from '@dbl/ui';
import { errView } from '@/lib/hooks';
import { inputCls } from '@/components/bits';

export interface TableQuery { status: 'pending' | 'error' | 'success'; error: unknown; data: unknown; isFetching?: boolean }
/** The one table used by every list screen: sortable, filterable, with loading / empty / error / forbidden / stale states built in. */
export function DataTable<T extends object>({ q, columns, empty, filterable = true, label = 'Filter' }: { q: TableQuery; columns: ColumnDef<T, any>[]; empty: string; filterable?: boolean; label?: string }) {
  const rows = (q.data as T[] | undefined) ?? []; const [sorting, setSorting] = React.useState<SortingState>([]); const [filter, setFilter] = React.useState('');
  const t = useReactTable({ data: rows, columns, state: { sorting, globalFilter: filter }, onSortingChange: setSorting, onGlobalFilterChange: setFilter, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel() });
  return (
    <QueryBoundary status={q.status} error={errView(q.error)} isEmpty={q.status === 'success' && !rows.length} empty={empty} stale={q.isFetching && rows.length > 0}>
      {filterable && rows.length > 6 && <input aria-label={label} className={inputCls + ' mb-3 max-w-xs'} placeholder={`${label}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />}
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead>{t.getHeaderGroups().map((g) => <tr key={g.id}>{g.headers.map((h) => <th key={h.id} onClick={h.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap border-b border-line bg-surface-2 px-3 py-2 text-left font-label text-[11px] font-semibold uppercase tracking-wider text-steel">{flexRender(h.column.columnDef.header, h.getContext())}{{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}</th>)}</tr>)}</thead>
        <tbody>{t.getRowModel().rows.map((r) => <tr key={r.id} className="border-b border-line transition hover:bg-brand-50">{r.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2.5 align-middle">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}</tr>)}</tbody>
      </table></div>
    </QueryBoundary>
  );
}
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-[12.5px]">{children}</span>;
export const RefLink = ({ href, children }: { href: string; children: React.ReactNode }) => <Link href={href} className="font-mono font-semibold underline-offset-2 hover:underline">{children}</Link>;
