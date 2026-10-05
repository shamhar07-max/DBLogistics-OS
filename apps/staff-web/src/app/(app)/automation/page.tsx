'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button, Card, Chip } from '@dbl/ui';
import { useCmd, useOp } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, fmtDateTime } from '@/components/DataTable';
import { SectionTabs } from '@/components/SectionTabs';

type W = { id: string; key: string; version: number; trigger_topic: string; status: string; definition: { steps?: unknown[] }; created_at: string };
type R = { id: string; key: string; version: number; trigger_topic: string; status: string; started_at: string; finished_at?: string; resume_at?: string; attempts: number; last_error?: string };
const wc = createColumnHelper<W>(), rc = createColumnHelper<R>();
function Workflows() {
  const q = useOp('listWorkflows'); const act = useCmd('activateWorkflow', { invalidate: ['listWorkflows'] });
  const columns = useMemo(() => [wc.accessor('key', { header: 'Workflow', cell: (c) => <b className="font-display">{c.getValue()}</b> }), wc.accessor('version', { header: 'Version', cell: (c) => `v${c.getValue()}` }), wc.accessor('trigger_topic', { header: 'Starts on event', cell: (c) => <Mono>{c.getValue()}</Mono> }),
    wc.accessor((r) => r.definition?.steps?.length ?? 0, { id: 'steps', header: 'Steps' }), wc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }), wc.accessor('created_at', { header: 'Created', cell: (c) => fmtDateTime(c.getValue()) }),
    wc.display({ id: 'a', header: '', cell: (c) => c.row.original.status === 'draft' ? <Button size="sm" onClick={() => act.mutate({ params: { id: c.row.original.id } })}>Activate</Button> : null })], [act]);
  return <Card title="Workflow definitions"><DataTable q={q} columns={columns} empty="No workflows defined." label="Filter workflows" /><ErrorNote e={act.error} /><p className="mt-3 text-xs text-steel">Definitions are versioned; a running instance keeps the version it started on.</p></Card>;
}
function Runs() {
  const q = useOp('listWorkflowRuns'); const [open, setOpen] = useState<string>();
  const columns = useMemo(() => [rc.accessor('key', { header: 'Workflow', cell: (c) => <span><b className="font-display">{c.getValue()}</b> <span className="text-xs text-steel">v{c.row.original.version}</span></span> }), rc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }),
    rc.accessor('started_at', { header: 'Started', cell: (c) => fmtDateTime(c.getValue()) }), rc.accessor('resume_at', { header: 'Waiting until', cell: (c) => c.getValue() ? fmtDateTime(c.getValue()) : '—' }), rc.accessor('attempts', { header: 'Attempts' }),
    rc.accessor('last_error', { header: 'Last error', enableSorting: false, cell: (c) => c.getValue() ? <button type="button" className="text-left text-xs text-[#A80000] underline" onClick={() => setOpen(open === c.row.original.id ? undefined : c.row.original.id)}>{open === c.row.original.id ? c.getValue() : 'show'}</button> : <Chip tone="ok">none</Chip>, })], [open]);
  return <Card title="Runs"><DataTable q={q} columns={columns} empty="No runs yet — workflows start when their event fires." label="Filter runs" /></Card>;
}
export default function Automation() {
  return (<><PageTitle title="Automation" sub="Durable workflows driven by the outbox — exactly-once effects, resumable timers" />
    <SectionTabs sections={[{ id: 'workflows', label: 'Workflows', content: <Workflows /> }, { id: 'runs', label: 'Runs', content: <Runs /> }]} /></>);
}
