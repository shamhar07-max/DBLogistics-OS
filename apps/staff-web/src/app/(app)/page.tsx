'use client';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Link from 'next/link';
import { Card, Kpi, QueryBoundary } from '@dbl/ui';
import { useOp, errView, money } from '@/lib/hooks';
import { PageTitle } from '@/components/bits';
import { Attention } from '@/components/Attention';

const MODE_COLORS: Record<string, string> = { ocean_fcl: '#0B5E8E', ocean_lcl: '#0B5E8E', air: '#2FA3DC', road: '#F2A900', multimodal: '#1B7A6A', warehouse: '#A9793F', customs: '#5B4BB5' };
export default function Today() {
  const ov = useOp('getOwnerOverview'); const approvals = useOp('listApprovalRequests');
  const d = ov.data as any;
  const active = d ? d.jobsByStatus.filter((j: any) => !['closed', 'cancelled'].includes(j.status)).reduce((a: number, j: any) => a + j.n, 0) : 0;
  return (
    <>
      <PageTitle title="Owner overview" sub="Today · what is moving, at risk, earning, waiting for you" />
      <QueryBoundary status={ov.status} error={errView(ov.error)} stale={ov.isFetching && !!d}>
        {d && <>
          <section className="grid grid-cols-4 gap-4" aria-label="Owner questions">
            <Kpi label="What is moving?" value={active} hint="active jobs" />
            <Kpi label="What is at risk?" value={d.heldLots + d.expectedCostsNotAccrued} tone="risk" hint={`${d.heldLots} lots on hold · ${d.expectedCostsNotAccrued} costs not accrued`} />
            <Kpi label="What is earning money?" value={money(d.receivables.outstanding)} hint={`Receivables outstanding · ${money(d.receivables.overdue)} overdue`} />
            <Kpi label="What needs my decision?" value={d.pendingApprovals} hint={<Link href="/approvals" className="underline">open approvals inbox</Link>} />
          </section>
          <section className="grid grid-cols-3 gap-4">
            <Card title="Jobs by status"><div className="h-56"><ResponsiveContainer><BarChart data={d.jobsByStatus}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="status" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="n" fill="var(--dbl-forest-600)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
            <Card title="Active shipments by mode">{d.activeShipmentsByMode.length ? <div className="h-56"><ResponsiveContainer><PieChart><Pie data={d.activeShipmentsByMode} dataKey="n" nameKey="mode" innerRadius={50} outerRadius={80} paddingAngle={3}>{d.activeShipmentsByMode.map((m: any) => <Cell key={m.mode} fill={MODE_COLORS[m.mode] ?? '#8A9591'} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div> : <p className="text-sm text-steel">No active shipments.</p>}</Card>
            <Card title="Unbilled work"><div className="font-label text-4xl font-bold tabular-nums">{money(d.unbilledDelivered.amount)}</div><p className="mt-1 text-sm text-steel">{d.unbilledDelivered.jobs} delivered job(s) with revenue not yet invoiced</p><p className="mt-4 text-xs text-steel">As of {new Date(d.asOf).toLocaleTimeString()} · every figure is a live query on source records.</p></Card>
          </section>
          <Attention />
          <Card title="Approvals waiting"><QueryBoundary status={approvals.status} error={errView(approvals.error)} isEmpty={!(approvals.data as any[])?.length} empty="Nothing waiting for a decision.">
            <ul className="divide-y divide-line">{((approvals.data as any[]) ?? []).filter((a) => a.status === 'pending').slice(0, 5).map((a) => <li key={a.id} className="py-2 text-sm"><b>{a.kind}</b> — {a.summary}</li>)}</ul></QueryBoundary></Card>
        </>}
      </QueryBoundary>
    </>
  );
}
