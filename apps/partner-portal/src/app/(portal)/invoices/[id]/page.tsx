'use client';
import { useParams } from 'next/navigation';
import { Button, Card, Chip, Kpi, QueryBoundary } from '@dbl/ui';
import { useOp, errView, money } from '@/lib/hooks';
import { PageTitle } from '@/components/bits';
import { Mono, fmtDate } from '@/components/DataTable';
import { Only } from '@/components/Common';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>(); const q = useOp('getInvoice', { params: { id } }); const i = q.data as any; const paid = i && Number(i.balance) <= 0;
  return (<Only workspaces={['customer']}><PageTitle title={i?.ref ?? 'Invoice'} sub="Tax invoice">{i && <div className="flex gap-2">{i.status === 'credited' ? <Chip tone="stop">credited</Chip> : paid ? <Chip tone="ok">paid</Chip> : <Chip tone="hold">balance due</Chip>}<Button size="sm" variant="ghost" onClick={() => window.print()}>Print</Button></div>}</PageTitle>
    <QueryBoundary status={q.status} error={errView(q.error)}>{i && <>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4"><Kpi label="Total" value={money(i.total, i.currency)} /><Kpi label="Balance" value={money(i.balance, i.currency)} tone={!paid && i.due_date < new Date().toISOString().slice(0, 10) ? 'risk' : undefined} /><Kpi label="Invoice date" value={fmtDate(i.posting_date)} /><Kpi label="Due" value={fmtDate(i.due_date)} /></section>
      <Card title={`Job ${i.job_ref}`}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left font-label text-[11px] uppercase tracking-wider text-steel"><th className="py-2">Description</th><th className="text-right">Net</th><th>Tax</th><th className="text-right">Tax amount</th></tr></thead>
        <tbody>{i.lines.map((l: any, k: number) => <tr key={k} className="border-t border-line"><td className="py-2">{l.description}</td><td className="text-right font-mono">{money(l.net_amount, i.currency)}</td><td className="font-mono text-xs">{l.tax_code} · {Number(l.tax_rate) * 100}%</td><td className="text-right font-mono">{money(l.tax_amount, i.currency)}</td></tr>)}</tbody>
        <tfoot><tr className="border-t border-line-strong font-semibold"><td className="py-2">Total</td><td className="text-right font-mono">{money(i.subtotal, i.currency)}</td><td /><td className="text-right font-mono">{money(i.tax_total, i.currency)}</td></tr></tfoot></table></div>
        <p className="mt-3 text-xs text-steel">Reference <Mono>{i.ref}</Mono> when paying by bank transfer. E-invoice status: {String(i.einvoice_status).replace('_', ' ')}.</p></Card></>}</QueryBoundary></Only>);
}
