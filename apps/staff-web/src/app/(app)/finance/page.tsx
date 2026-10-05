'use client';
import { useState } from 'react';
import { Button, Card, QueryBoundary } from '@dbl/ui';
import { useCmd, useOp, errView, money } from '@/lib/hooks';
import { ErrorNote, Field, PageTitle, StatusChip, inputCls } from '@/components/bits';

export default function Finance() {
  const inv = useOp('listInvoices'); const alloc = useCmd('allocatePayment', { invalidate: ['listInvoices'] }); const [pid, setPid] = useState(''); const [iid, setIid] = useState(''); const [amt, setAmt] = useState(''); const rows = (inv.data as any[]) ?? [];
  return (<><PageTitle title="Money" sub="Billing → ledger → e-invoice are separate states" />
    <Card title="Invoices"><QueryBoundary status={inv.status} error={errView(inv.error)} isEmpty={!rows.length} empty="No invoices yet."><table className="w-full text-sm"><thead><tr className="text-left font-label text-[11px] uppercase tracking-wider text-steel"><th className="py-2">Invoice</th><th>Status</th><th>e-Invoice</th><th>Total</th><th>Allocated</th><th>Due</th></tr></thead><tbody>{rows.map((i) => <tr key={i.id} className="border-t border-line"><td className="py-2.5 font-mono font-semibold">{i.ref ?? 'draft'}</td><td><StatusChip s={i.status} /></td><td><StatusChip s={i.einvoice_status} /></td><td className="font-mono">{money(i.total, i.currency)}</td><td className="font-mono">{money(i.amount_allocated, i.currency)}</td><td>{i.due_date?.slice(0, 10) ?? '—'}</td></tr>)}</tbody></table></QueryBoundary></Card>
    <Card title="Allocate a receipt"><div className="grid max-w-3xl grid-cols-[1fr_1fr_160px_auto] items-end gap-3"><Field label="Payment id"><input className={inputCls + ' font-mono'} value={pid} onChange={(e) => setPid(e.target.value)} /></Field><Field label="Invoice"><select className={inputCls} value={iid} onChange={(e) => setIid(e.target.value)}><option value="">Select…</option>{rows.filter((i) => i.status === 'posted').map((i) => <option key={i.id} value={i.id}>{i.ref}</option>)}</select></Field><Field label="Amount"><input className={inputCls + ' font-mono'} value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
      <Button disabled={!pid || !iid || !amt} onClick={() => alloc.mutate({ params: { id: pid }, body: { invoiceId: iid, amount: amt, allocationKey: crypto.randomUUID() } })}>Allocate</Button></div><p className="mt-2 text-xs text-steel">The server refuses allocations beyond the payment’s available amount or the invoice balance.</p><ErrorNote e={alloc.error} /></Card></>);
}
