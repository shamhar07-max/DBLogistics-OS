'use client';
import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, Card, Chip, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView, money } from '@/lib/hooks';
import { ErrorNote, PageTitle, StatusChip } from '@/components/bits';
import { DataTable, RefLink } from '@/components/DataTable';
import { SectionTabs } from '@/components/SectionTabs';

type P = { id: string; ref: string; status: string; finance_status: string; currency: string; revenue: string; cost: string; posted_revenue: string; posted_cost: string };
const pc = createColumnHelper<P>();
function Ageing() {
  const q = useOp('getReceivablesAgeing'); const d = q.data as any;
  return (<QueryBoundary status={q.status} error={errView(q.error)}>{d && d.currencies.length === 0 ? <Card title="Receivables ageing"><p className="text-sm text-steel">No outstanding receivables.</p></Card> : d?.currencies.map((c: any) => <Card key={c.currency} title={`Receivables ageing · ${c.currency} · as of ${d.asOf}`}>
    <div className="h-56"><ResponsiveContainer><BarChart data={c.buckets.map((b: any) => ({ bucket: b.bucket, outstanding: Number(b.outstanding) }))}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="bucket" /><YAxis /><Tooltip formatter={(v: number) => money(v, c.currency)} /><Bar dataKey="outstanding" fill="#E12509" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div>
    <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-steel"><th>Bucket (days past due)</th><th>Invoices</th><th className="text-right">Outstanding</th></tr></thead><tbody>{c.buckets.map((b: any) => <tr key={b.bucket} className="border-t border-line"><td className="py-1.5">{b.bucket}</td><td>{b.invoices}</td><td className="text-right font-mono">{money(b.outstanding, c.currency)}</td></tr>)}</tbody></table></Card>)}</QueryBoundary>);
}
function Profit() {
  const q = useOp('getJobProfitability');
  const columns = useMemo(() => [pc.accessor('ref', { header: 'Job', cell: (c) => <RefLink href={`/jobs/${c.row.original.id}`}>{c.getValue()}</RefLink> }), pc.accessor('status', { header: 'Status', cell: (c) => <StatusChip s={c.getValue()} /> }),
    pc.accessor('revenue', { header: 'Revenue (charges)', cell: (c) => money(c.getValue(), c.row.original.currency) }), pc.accessor('cost', { header: 'Cost (charges)', cell: (c) => money(c.getValue(), c.row.original.currency) }),
    pc.accessor((r) => Number(r.revenue) - Number(r.cost), { id: 'est', header: 'Estimated margin', cell: (c) => <b className={c.getValue() < 0 ? 'text-[#A80000]' : ''}>{money(c.getValue(), c.row.original.currency)}</b> }),
    pc.accessor((r) => Number(r.posted_revenue) - Number(r.posted_cost), { id: 'act', header: 'Posted margin', cell: (c) => money(c.getValue(), c.row.original.currency) })], []);
  return <Card title="Job profitability"><DataTable q={q} columns={columns} empty="No jobs." label="Filter jobs" /><p className="mt-3 text-xs text-steel">Estimated comes from charges; posted comes only from the ledger. They differ until invoices and bills are posted.</p></Card>;
}
function Console() {
  const tools = useOp('listAiTools'); const invoke = useCmd('invokeAiTool'); const [name, setName] = useState(''); const [args, setArgs] = useState('{}'); const [out, setOut] = useState<unknown>(); const [bad, setBad] = useState('');
  const list = (tools.data as Array<{ name: string; description: string; permission: string; allowed: boolean }>) ?? [];
  const run = () => { let a: Record<string, unknown>; try { a = JSON.parse(args || '{}'); setBad(''); } catch { setBad('Arguments must be valid JSON.'); return; } invoke.mutate({ params: { name } as any, body: { args: a } }, { onSuccess: (d: any) => setOut(d) } as any); };
  return (<div className="grid grid-cols-1 lg:grid-cols-2 items-start gap-5"><Card title="Controlled tools"><p className="mb-3 text-sm text-steel">The assistant can only use these tools, with <b>your</b> permissions. It cannot post to the ledger, approve, or release.</p>
    <ul className="grid gap-2">{list.map((t) => <li key={t.name}><button type="button" disabled={!t.allowed} onClick={() => setName(t.name)} className={`w-full rounded-sm border p-3 text-left ${name === t.name ? 'border-brand-500 bg-paper' : 'border-line'} disabled:opacity-50`}><span className="flex items-center gap-2"><Mono2>{t.name}</Mono2><Chip tone={t.allowed ? 'ok' : 'idle'}>{t.allowed ? 'allowed' : `needs ${t.permission}`}</Chip></span><span className="text-xs text-steel">{t.description}</span></button></li>)}</ul></Card>
    <Card title="Run"><div className="grid gap-3"><label className="grid gap-1.5 text-sm"><span className="font-display text-xs uppercase tracking-wide text-steel">Tool</span><input readOnly value={name} placeholder="Select a tool" className="h-10 rounded-sm border border-line-strong px-3 font-mono text-sm" /></label>
      <label className="grid gap-1.5 text-sm"><span className="font-display text-xs uppercase tracking-wide text-steel">Arguments (JSON)</span><textarea rows={4} value={args} onChange={(e) => setArgs(e.target.value)} className="rounded-sm border border-line-strong p-3 font-mono text-xs" /></label>
      <Button disabled={!name || invoke.isPending} onClick={run}>Run tool</Button>{bad && <p role="alert" className="text-sm text-[#A80000]">{bad}</p>}<ErrorNote e={invoke.error} />{out !== undefined && <pre aria-label="Tool result" className="max-h-72 overflow-auto rounded-sm bg-ink p-3 text-xs text-white">{JSON.stringify(out, null, 2)}</pre>}</div></Card></div>);
}
const Mono2 = ({ children }: { children: React.ReactNode }) => <span className="font-mono text-xs font-semibold">{children}</span>;
export default function Intelligence() {
  return (<><PageTitle title="Intelligence" sub="Finance reports and the controlled AI assistant" />
    <SectionTabs sections={[{ id: 'ageing', label: 'Receivables ageing', content: <Ageing /> }, { id: 'profit', label: 'Job profitability', content: <Profit /> }, { id: 'ai', label: 'AI tools', content: <Console /> }]} /></>);
}
