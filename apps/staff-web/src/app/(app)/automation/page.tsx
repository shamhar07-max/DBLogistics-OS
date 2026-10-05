'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Button, Card, Chip, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, Mono, fmtDateTime } from '@/components/DataTable';
import { SectionTabs } from '@/components/SectionTabs';
import { draftFrom, emptyDraft, Modal, WorkflowDesigner, type Draft } from '@/components/WorkflowDesigner';

type W = { id: string; key: string; version: number; description?: string; trigger_topic: string; status: string; definition: any; created_at: string; runs_total: number; runs_failed: number };
type R = { id: string; key: string; version: number; trigger_topic: string; status: string; started_at: string; resume_at?: string; attempts: number; last_error?: string; step: number };
const wc = createColumnHelper<W>(), rc = createColumnHelper<R>();

function Workflows() {
  const q = useOp('listWorkflows'); const act = useCmd('activateWorkflow', { invalidate: ['listWorkflows'] }); const retire = useCmd('retireWorkflow', { invalidate: ['listWorkflows'] });
  const [draft, setDraft] = useState<{ d: Draft; locked: boolean } | null>(null); const [view, setView] = useState<W | null>(null);
  const columns = useMemo(() => [
    wc.accessor('key', { header: 'Workflow', cell: (c) => <span><button type="button" className="font-display font-bold underline-offset-2 hover:underline" onClick={() => setView(c.row.original)}>{c.getValue()}</button> <span className="text-xs text-steel">v{c.row.original.version}</span>{c.row.original.description && <div className="text-xs text-steel">{c.row.original.description}</div>}</span> }),
    wc.accessor('trigger_topic', { header: 'Starts on event', cell: (c) => <Mono>{c.getValue()}</Mono> }), wc.accessor((r) => r.definition?.actions?.length ?? 0, { id: 'steps', header: 'Steps' }),
    wc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }),
    wc.accessor('runs_total', { header: 'Runs', cell: (c) => <span>{c.getValue()}{c.row.original.runs_failed > 0 && <> · <Chip tone="stop">{c.row.original.runs_failed} failed</Chip></>}</span> }),
    wc.display({ id: 'a', header: '', cell: (c) => { const w = c.row.original; return <span className="flex flex-wrap justify-end gap-1.5">
      {w.status === 'draft' && <Button size="sm" onClick={() => act.mutate({ params: { id: w.id } })}>Activate</Button>}{w.status === 'active' && <Button size="sm" variant="ghost" onClick={() => retire.mutate({ params: { id: w.id } })}>Retire</Button>}
      <Button size="sm" variant="ghost" onClick={() => setDraft({ d: draftFrom(w), locked: true })}>New version</Button></span>; } })], [act, retire]);
  return (<Card title="Workflow definitions" actions={<Button size="sm" onClick={() => setDraft({ d: emptyDraft(), locked: false })}>New workflow</Button>}>
    <DataTable q={q} columns={columns} empty="No workflows yet — create the first with “New workflow”." label="Filter workflows" /><ErrorNote e={act.error ?? retire.error} />
    <p className="mt-3 text-xs text-steel">Versions are immutable. Activating a version retires the previous one; instances already running finish on the version they started with.</p>
    <Modal open={!!draft} onOpenChange={(o) => !o && setDraft(null)} title={draft?.locked ? 'Publish a new version' : 'New workflow'}>{draft && <WorkflowDesigner initial={draft.d} locked={draft.locked} onClose={() => setDraft(null)} />}</Modal>
    <Modal open={!!view} onOpenChange={(o) => !o && setView(null)} title={view ? `${view.key} · v${view.version}` : ''}>{view && <div className="grid gap-3 text-sm"><div className="flex flex-wrap gap-2"><StatusChip s={view.status} /><Mono>{view.trigger_topic}</Mono></div>
      {view.definition.conditions?.length > 0 && <p><b>Only if</b> {view.definition.conditions.map((c: any) => `${c.field} ${c.op}${c.value !== undefined ? ' ' + c.value : ''}`).join(' and ')}</p>}
      <ol className="grid gap-1">{view.definition.actions.map((a: any, i: number) => <li key={i} className="flex gap-2"><span className="font-mono text-steel">{i + 1}.</span>{a.type === 'create_task' ? `Create task “${a.title}”${a.dueInHours ? ` (due in ${a.dueInHours} h)` : ''}` : a.type === 'notify' ? `Notify via ${a.channel} (${a.template})` : `Wait ${a.seconds} s`}</li>)}</ol></div>}</Modal></Card>);
}
function Runs() {
  const [status, setStatus] = useState(''); const q = useOp('listWorkflowRuns', { query: status ? { status } : undefined }); const [open, setOpen] = useState<string | null>(null);
  const columns = useMemo(() => [rc.accessor('key', { header: 'Workflow', cell: (c) => <button type="button" className="text-left" onClick={() => setOpen(c.row.original.id)}><b className="font-display underline-offset-2 hover:underline">{c.getValue()}</b> <span className="text-xs text-steel">v{c.row.original.version}</span></button> }),
    rc.accessor('trigger_topic', { header: 'Event', cell: (c) => <Mono>{c.getValue()}</Mono> }), rc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }),
    rc.accessor('started_at', { header: 'Started', cell: (c) => fmtDateTime(c.getValue()) }), rc.accessor('resume_at', { header: 'Waiting until', cell: (c) => c.getValue() ? fmtDateTime(c.getValue()) : '—' }), rc.accessor('attempts', { header: 'Attempts' }),
    rc.accessor('last_error', { header: 'Last error', enableSorting: false, cell: (c) => c.getValue() ? <span className="text-xs text-[#A80000]">{c.getValue()}</span> : <Chip tone="ok">none</Chip> })], []);
  return (<Card title="Runs" actions={<select aria-label="Filter by status" className="h-8 rounded-sm border border-line-strong bg-white px-2 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['running', 'waiting', 'completed', 'failed', 'cancelled', 'skipped'].map((s) => <option key={s}>{s}</option>)}</select>}>
    <DataTable q={q} columns={columns} empty="No runs — workflows start when their event fires." label="Filter runs" />
    <Modal open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Run detail">{open && <RunDetail id={open} />}</Modal></Card>);
}
function RunDetail({ id }: { id: string }) {
  const q = useOp('getWorkflowRun', { params: { id } }); const retry = useCmd('retryWorkflowRun', { invalidate: ['getWorkflowRun', 'listWorkflowRuns'] }); const cancel = useCmd('cancelWorkflowRun', { invalidate: ['getWorkflowRun', 'listWorkflowRuns'] }); const r = q.data as any;
  return (<QueryBoundary status={q.status} error={errView(q.error)}>{r && <div className="grid gap-3 text-sm">
    <div className="flex flex-wrap items-center gap-2"><b className="font-display">{r.key} v{r.version}</b><StatusChip s={r.status} /><Mono>{r.trigger_topic}</Mono><span className="text-steel">attempt {r.attempts || 1}</span></div>
    {r.last_error && <p role="alert" className="rounded-sm bg-status-stop-100 p-2 text-[#A80000]">{r.last_error}</p>}
    <h4 className="font-display font-semibold">Step log</h4>{r.log.length ? <ol className="grid gap-1">{r.log.map((l: any, i: number) => <li key={i} className="flex gap-2"><span className="font-mono text-xs text-steel">{fmtDateTime(l.at)}</span>{l.note}</li>)}</ol> : <p className="text-steel">No steps executed yet.</p>}
    <h4 className="font-display font-semibold">Trigger payload</h4><pre className="max-h-40 overflow-auto rounded-sm bg-paper p-2 font-mono text-xs">{JSON.stringify(r.state?.event?.payload ?? {}, null, 2)}</pre>
    <div className="flex gap-2">{r.status === 'failed' && <Button size="sm" onClick={() => retry.mutate({ params: { id } })}>Retry from last step</Button>}{['running', 'waiting', 'failed'].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ params: { id } })}>Cancel run</Button>}</div><ErrorNote e={retry.error ?? cancel.error} /></div>}</QueryBoundary>);
}
export default function Automation() {
  return (<><PageTitle title="Automation" sub="Durable workflows driven by the outbox — exactly-once effects, resumable timers" />
    <SectionTabs sections={[{ id: 'workflows', label: 'Workflows', content: <Workflows /> }, { id: 'runs', label: 'Runs', content: <Runs /> }]} /></>);
}
