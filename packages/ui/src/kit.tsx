'use client';
import * as React from 'react';
import clsx from 'clsx';
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import * as Dialog from '@radix-ui/react-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Chip, QueryBoundary, type Tone } from './primitives';

/** Shared page-level building blocks: identical in the staff app and the partner portal, so both look and behave the same. */
export const statusTone = (s: string): Tone => (['delivered', 'closed', 'posted', 'approved', 'accepted', 'released', 'settled', 'clean', 'confirmed', 'completed', 'active', 'resolved'].includes(s) ? 'ok' : ['executing', 'in_transit', 'in_progress', 'billed', 'sent', 'open', 'requested', 'qualified', 'dispatched', 'running', 'waiting', 'investigating'].includes(s) ? 'info' : ['draft', 'new', 'planned', 'pending', 'partially_billed', 'proposed', 'received'].includes(s) ? 'hold' : ['cancelled', 'rejected', 'expired', 'quarantined', 'failed', 'infected', 'credited'].includes(s) ? 'stop' : 'idle');
export const StatusChip = ({ s }: { s: string }) => <Chip tone={statusTone(s)}>{s.replace(/_/g, ' ')}</Chip>;
export const Field = ({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) => <label className="grid gap-1.5"><span className="font-label text-[11px] font-semibold uppercase tracking-[.09em] text-steel">{label}</span>{children}{error && <span role="alert" className="text-xs text-status-stop">{error}</span>}</label>;
export const inputCls = 'h-10 w-full rounded-sm border border-line-strong bg-surface px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20';
/** Shows an API error as CODE — message (duck-typed so this package does not depend on the API client). */
export const ErrorNote = ({ e }: { e: unknown }) => { if (!e) return null; const x = e as { code?: string; message?: string }; return <p role="alert" className={clsx('rounded-sm px-3 py-2 text-sm', 'bg-status-stop-100 text-[#A80000]')}>{x.code ? <><b>{x.code}</b> — {x.message}</> : String(x.message ?? e)}</p>; };
export const PageTitle = ({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) => <div className="flex flex-wrap items-end gap-3 sm:gap-4"><div className="min-w-0"><div className="font-label text-xs font-semibold uppercase tracking-[.1em] text-steel">{sub}</div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1></div><span className="flex-1" />{children}</div>;
export const Mono = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-[12.5px]">{children}</span>;
export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (v?: string | null) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const money = (v: string | number | null | undefined, cur = 'AED') => (v == null ? '—' : new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur }).format(Number(v)));
export const errView = (e: unknown) => (e ? { status: (e as any).status, code: (e as any).code, message: (e as any).message ?? String(e) } : null);

type Base = { label: string; error?: string };
/** React 19: `ref` is a normal prop, so react-hook-form's register() spreads straight onto these. */
export function TextField({ label, error, className, ...p }: Base & React.InputHTMLAttributes<HTMLInputElement>) { return <Field label={label} error={error}><input {...p} className={clsx(inputCls, className)} /></Field>; }
export function AreaField({ label, error, className, ...p }: Base & React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <Field label={label} error={error}><textarea {...p} className={clsx(inputCls, 'h-24 py-2', className)} /></Field>; }
export function SelectField({ label, error, children, className, ...p }: Base & React.SelectHTMLAttributes<HTMLSelectElement>) { return <Field label={label} error={error}><select {...p} className={clsx(inputCls, className)}>{children}</select></Field>; }
export function FormGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 1 | 2 | 3 | 4 }) { return <div className={clsx('grid gap-3', { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-3', 4: 'grid-cols-2 sm:grid-cols-4' }[cols])}>{children}</div>; }

export interface Section { id: string; label: string; content: React.ReactNode }
/** One tab style across every screen. */
export function SectionTabs({ sections, defaultId }: { sections: Section[]; defaultId?: string }) {
  return (<Tabs defaultValue={defaultId ?? sections[0].id}>
    <TabsList className="mb-4 flex gap-0.5 overflow-x-auto border-b border-line">
      {sections.map((s) => <TabsTrigger key={s.id} value={s.id} className="relative shrink-0 whitespace-nowrap px-3.5 py-2.5 font-display text-[13px] font-semibold text-steel data-[state=active]:text-ink data-[state=active]:after:absolute data-[state=active]:after:inset-x-2.5 data-[state=active]:after:-bottom-px data-[state=active]:after:h-[3px] data-[state=active]:after:bg-signal">{s.label}</TabsTrigger>)}
    </TabsList>
    {sections.map((s) => <TabsContent key={s.id} value={s.id}>{s.content}</TabsContent>)}
  </Tabs>);
}

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

/** Inline preview of a signed file URL: images and PDFs render in place; anything else offers a download. */
export function FilePreview({ url, contentType, name }: { url: string; contentType?: string | null; name: string }) {
  const t = contentType ?? '';
  if (t.startsWith('image/')) return <img src={url} alt={name} className="mx-auto max-h-[70vh] max-w-full rounded-sm border border-line object-contain" />;
  if (t === 'application/pdf') return <iframe src={url} title={`Preview of ${name}`} className="h-[70vh] w-full rounded-sm border border-line" />;
  if (t.startsWith('text/')) return <iframe src={url} title={`Preview of ${name}`} className="h-[50vh] w-full rounded-sm border border-line bg-white" />;
  return <p className="rounded-sm bg-paper p-4 text-sm text-steel">No inline preview for this file type ({t || 'unknown'}). <a className="underline" href={url} target="_blank" rel="noopener noreferrer">Download it</a>.</p>;
}

/** Accessible modal (focus-trapped, Esc closes); a bottom sheet on phones. */
export function Modal({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: React.ReactNode }) {
  return (<Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-50 bg-ink/50" />
    <Dialog.Content aria-describedby={undefined} className="fixed inset-x-0 bottom-0 top-10 z-50 overflow-y-auto rounded-t-lg bg-white p-5 shadow-raised sm:inset-auto sm:left-1/2 sm:top-1/2 sm:max-h-[90vh] sm:w-[min(760px,94vw)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg">
      <div className="mb-4 flex items-center gap-3"><Dialog.Title className="font-display text-lg font-bold">{title}</Dialog.Title><span className="flex-1" /><Dialog.Close className="rounded-sm px-2 py-1 text-sm text-steel underline" aria-label="Close">Close</Dialog.Close></div>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>);
}
